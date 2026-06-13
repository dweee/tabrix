/**
 * Native-handled MCP tools.
 *
 * Most Tabrix MCP tools delegate to the Chrome extension because they
 * touch the browser. Tools registered here are the exception: their
 * data lives entirely in the native-server (SQLite Memory/Experience
 * tables) and routing them through the extension would just add a
 * round-trip and a failure mode.
 *
 * Routing contract for `register-tools.ts`:
 *   1. After the tool passes `filterToolsByEnvironment` and
 *      `isToolAllowedByPolicy`, look it up in `nativeToolHandlers`.
 *   2. If a handler exists, call it instead of `invokeExtensionCommand`.
 *      The handler is responsible for returning a `CallToolResult`.
 *   3. The wrapper still records `step.completeStep` /
 *      `session.finishSession` based on whether the result was an error.
 *
 * The handlers themselves are pure functions of `(args, deps)` — `deps`
 * is injected so tests can supply a stub `SessionManager` without
 * touching the singleton.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';
import { MkeAiFeedbackValidationError } from '../memory/mke-memory-trace-service';
import {
  runTabrixChooseContext,
  runTabrixChooseContextRecordOutcome,
  runTabrixChooseContextWithDirectApi,
  type TabrixChooseContextRouterTelemetry,
} from './choose-context';
import { createLivePageContextProvider } from './page-context-provider';
import type { SessionManager } from '../execution/session-manager';
import type { TaskSessionContext } from '../execution/task-session-context';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';
import type { LayerSourceRoute, TabrixChooseContextResult } from '@tabrix/shared';
import { resolveApiKnowledgeCandidate } from '../api/api-knowledge';

type AcceptanceApiFault = 'network_timeout' | 'semantic_mismatch';

function readAcceptanceApiFault(args: unknown): AcceptanceApiFault | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const value = (args as { __tabrixAcceptanceApiFault?: unknown }).__tabrixAcceptanceApiFault;
  return value === 'network_timeout' || value === 'semantic_mismatch' ? value : null;
}

export interface NativeToolHandlerDeps {
  sessionManager: Pick<
    SessionManager,
    'getPersistenceStatus' | 'knowledgeApi' | 'chooseContextTelemetry' | 'flushAndProjectMkeIdle'
  > & {
    memoryTraces?: SessionManager['memoryTraces'];
    findReusableMkeExperienceRecipes?: SessionManager['findReusableMkeExperienceRecipes'];
  };
  /**
   * Externally-keyed `TaskSessionContext` the dispatcher resolved for
   * this tool call. Wired exclusively for `tabrix_choose_context` so its
   * decision (sourceRoute / chosenLayer / token estimate / replay
   * candidate / API capability) lands in the SAME context the
   * `chrome_read_page` shim later peeks via `peekChooseContextDecision`.
   * Other handlers ignore the field.
   *
   * `null` when the wrapper resolved no context (tools outside the
   * auto-key set without an explicit `taskSessionId`). The chooser
   * handler treats that as "no context to write to" and leaves the
   * skip-read execution loop dormant — same as the v2.5 happy path.
   */
  taskContext?: TaskSessionContext | null;
}

export type NativeToolHandler = (
  args: unknown,
  deps: NativeToolHandlerDeps,
) => Promise<CallToolResult> | CallToolResult;

function jsonResult(payload: unknown, isError: boolean): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload),
      },
    ],
    isError,
  };
}

const MEMORY_FEEDBACK_STATUSES = new Set(['achieved', 'partial', 'not_achieved', 'unknown']);

function readObjectArg(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function readStringArg(args: Record<string, unknown>, field: string): string | null {
  const value = args[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readConfidenceArg(args: Record<string, unknown>): number | null {
  const value = args.confidence;
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function readIntegerArg(args: Record<string, unknown>, field: string): number | null {
  const value = args[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

const handleMemoryRecordAiFeedback: NativeToolHandler = async (args, deps) => {
  const persistenceMode = deps.sessionManager.getPersistenceStatus().mode;
  if (persistenceMode === 'off' || !deps.sessionManager.memoryTraces) {
    return jsonResult(
      {
        status: 'memory_unavailable',
        persistenceMode,
      },
      false,
    );
  }

  const object = readObjectArg(args);
  const traceId = readStringArg(object, 'traceId');
  const feedbackToken =
    readStringArg(object, 'feedbackToken') ?? readStringArg(object, 'traceBindingHash');
  const businessStatus = readStringArg(object, 'businessStatus');
  if (
    !traceId ||
    !feedbackToken ||
    !businessStatus ||
    !MEMORY_FEEDBACK_STATUSES.has(businessStatus)
  ) {
    return jsonResult(
      {
        status: 'invalid_input',
        message: 'traceId, feedbackToken, and a valid businessStatus are required.',
      },
      true,
    );
  }

  let updated;
  try {
    updated = deps.sessionManager.memoryTraces.recordAiBusinessFeedback({
      traceId,
      taskId: readStringArg(object, 'taskId'),
      toolName: readStringArg(object, 'toolName'),
      toolCallId: readStringArg(object, 'toolCallId'),
      sequenceIndex: readIntegerArg(object, 'sequenceIndex'),
      traceBindingHash: feedbackToken,
      evaluationScope:
        object.evaluationScope === 'task' || object.evaluationScope === 'step'
          ? object.evaluationScope
          : undefined,
      businessStatus,
      confidence: readConfidenceArg(object),
      reasonCode: readStringArg(object, 'reasonCode'),
      summary: readStringArg(object, 'summary'),
      receivedAt: new Date().toISOString(),
      sourceToolName: TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
      sourceToolCallId: null,
    });
  } catch (error) {
    if (error instanceof MkeAiFeedbackValidationError) {
      return jsonResult(
        {
          status: error.code,
          message: error.message,
          traceId,
          persistenceMode,
        },
        true,
      );
    }
    throw error;
  }

  if (!updated) {
    return jsonResult(
      {
        status: 'unknown_trace',
        traceId,
        persistenceMode,
      },
      false,
    );
  }

  const projection = await deps.sessionManager.flushAndProjectMkeIdle().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  });

  return jsonResult(
    {
      status: 'recorded',
      traceId,
      businessStatus,
      confidence: updated.aiFeedbackScore,
      persistenceMode,
      projection:
        projection && 'error' in projection
          ? {
              status: 'failed',
              message: projection.error,
            }
          : {
              status: 'projected',
              knowledgeUpserted: projection?.knowledge?.upsertedKnowledgeCount ?? null,
              experienceSaved: projection?.experience?.savedExperienceCount ?? null,
              experienceIds: projection?.experience?.experienceIds ?? [],
            },
    },
    false,
  );
};

const handleTabrixChooseContext: NativeToolHandler = async (args, deps) => {
  // The old `memory_page_snapshots` table is retired. Until chooser context is
  // backed by Object Library live facts, surface an explicit fallback-zero
  // input instead of reading stale snapshot rows.
  const pageContext = createLivePageContextProvider(null);
  // Wrap the synchronous chooser with the direct-api-executor so a
  // high-confidence read-only `knowledge_supported_read` route may
  // execute the API inline (compact rows arrive on
  // `result.directApiExecution`). For every other route the wrapper returns
  // the synchronous chooser result bit-identical, so the legacy happy path is
  // preserved.
  const result = await runTabrixChooseContextWithDirectApi(args, {
    knowledgeApi: deps.sessionManager.knowledgeApi,
    experienceRecipes: deps.sessionManager.findReusableMkeExperienceRecipes
      ? {
          findReusableByContext: (input) =>
            deps.sessionManager.findReusableMkeExperienceRecipes?.(input) ?? [],
        }
      : null,
    telemetry: deps.sessionManager.chooseContextTelemetry,
    pageContext,
    domRegionRowsEvidence: deps.taskContext?.peekVisibleRegionRowsEvidence() ?? null,
    // Private acceptance fault injection is exercised on the
    // read-side shim. Disable chooser-inline API execution so fallback
    // scenarios do not emit ignored api_rows evidence before the
    // product under test reaches chrome_read_page.
    directApiEnabled: readAcceptanceApiFault(args) ? false : undefined,
  });
  // Close the read-routing loop. When the wrapper provided a
  // `TaskSessionContext` AND the chooser produced an actionable
  // layer-dispatch result, write the decision into the context BEFORE
  // we return. The next `chrome_read_page` call on the same key reads it
  // via `peekChooseContextDecision` and the orchestrator decides whether
  // API Knowledge can satisfy the read or the bridge should continue.
  // Hard rules:
  //   * `noteUrlChange` runs FIRST so a chooser call against a
  //     different page than the one currently held in the context
  //     wipes the prior decision (per task-session-context tests).
  //   * `apiCapability` is attached only when the API Knowledge layer
  //     can resolve a real read-only API candidate for the
  //     `knowledge_supported_read`
  //     route — never fake `available: true`.
  if (deps.taskContext && result.status === 'ok') {
    persistChooseContextDecision(args, result, deps.taskContext);
  }
  return jsonResult(result, result.status === 'invalid_input');
};

/**
 * Translate the chooser result + raw args into a
 * {@link ChooseContextDecisionSnapshot} and write it onto the live
 * `TaskSessionContext`. Pure-ish: only side-effect is the two
 * setters on the context. Skips the write when `chosenLayer` /
 * `sourceRoute` are absent (would mean the chooser hit a
 * legacy path that has no layer dispatch attached — extremely unlikely
 * on the production code path, but the sentinel keeps the read-side
 * `planSkipRead` happy because it would otherwise see `undefined`
 * fields and force `'forward'`).
 */
function persistChooseContextDecision(
  rawArgs: unknown,
  result: TabrixChooseContextResult,
  taskContext: TaskSessionContext,
): void {
  if (!result.chosenLayer || !result.sourceRoute) return;

  const argsObj =
    rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  const url = typeof argsObj.url === 'string' && argsObj.url.length > 0 ? argsObj.url : null;
  const pageRole =
    typeof argsObj.pageRole === 'string' && argsObj.pageRole.length > 0
      ? argsObj.pageRole
      : (result.resolved?.pageRole ?? null);

  // Always sync the URL/pageRole first. If they changed since the
  // prior read on this context, `noteUrlChange` clears `lastReadLayer`
  // / `targetRefsSeen` AND any prior chooser decision so the snapshot
  // we are about to write is the only authority. Idempotent same-page
  // calls are a no-op so a chooser that re-runs on the SAME page does
  // not clobber its own decision.
  taskContext.noteUrlChange(url, pageRole);

  const sourceRoute = result.sourceRoute as LayerSourceRoute;

  let apiCapability: ChooseContextDecisionSnapshot['apiCapability'] = null;
  if (sourceRoute === 'knowledge_supported_read') {
    const candidate = resolveApiKnowledgeCandidate({
      intent: typeof argsObj.intent === 'string' ? argsObj.intent : '',
      url: url ?? undefined,
      pageRole: pageRole ?? undefined,
    });
    if (candidate) {
      apiCapability = {
        available: true,
        family: candidate.endpointFamily,
        dataPurpose: candidate.dataPurpose,
        params: candidate.params,
      };
    }
  }

  const snapshot: ChooseContextDecisionSnapshot = {
    sourceRoute,
    chosenLayer: result.chosenLayer,
    fullReadTokenEstimate:
      typeof result.tokenEstimateFullRead === 'number' &&
      Number.isFinite(result.tokenEstimateFullRead) &&
      result.tokenEstimateFullRead > 0
        ? Math.floor(result.tokenEstimateFullRead)
        : 0,
    apiCapability,
    // Echo the closed-enum execution mode the chooser produced so the
    // orchestrator's `SkipReadPlan` carries the same signal downstream.
    // Defaults to `'via_read_page'` for every non-direct-api route —
    // same wire shape as legacy output plus an explicit declarative flag.
    executionMode:
      result.directApiExecution?.executionMode === 'direct_api' ? 'direct_api' : 'via_read_page',
    // Persist the inline direct-api rows so the read-side shim can
    // short-circuit its own `readApiKnowledgeEndpointPlan` call. Without
    // this the wrapper executes the API once and a follow-up
    // `chrome_read_page` would issue a redundant second fetch.
    directApiResult:
      result.directApiExecution?.executionMode === 'direct_api' &&
      result.directApiExecution.rows &&
      result.directApiExecution.endpointFamily &&
      result.directApiExecution.apiTelemetry
        ? {
            endpointFamily: result.directApiExecution.endpointFamily,
            dataPurpose: apiCapability?.dataPurpose ?? result.directApiExecution.endpointFamily,
            rows: result.directApiExecution.rows.map((row) => ({ ...row })),
            rowCount: result.directApiExecution.rowCount ?? result.directApiExecution.rows.length,
            compact: true,
            rawBodyStored: false,
            // Pipe the empty-result envelope through the cached snapshot
            // so a follow-up `chrome_read_page` does not re-derive the
            // verdict from `rowCount === 0`. The chooser-side path
            // already filled these fields when the executor reached a
            // reader on the `direct_api` branch; null-coalesce the
            // optionals to keep the shape closed.
            emptyResult: result.directApiExecution.emptyResult ?? false,
            emptyReason: result.directApiExecution.emptyReason ?? null,
            emptyMessage: result.directApiExecution.emptyMessage ?? null,
            // Pipe the closed-enum endpoint-source marker onto the
            // cached snapshot so the read-side shim can attribute the
            // cached api_rows reply into the same `observed` /
            // `seed_adapter` / `manual_seed` bucket as the chooser-side
            // direct-API record without consulting the executor again.
            endpointSource: result.directApiExecution.endpointSource ?? null,
            telemetry: result.directApiExecution.apiTelemetry,
          }
        : null,
  };
  const routerFields = result as TabrixChooseContextRouterTelemetry;
  if (routerFields.chosenSource) snapshot.chosenSource = routerFields.chosenSource;
  if (routerFields.dataSource) snapshot.dataSource = routerFields.dataSource;
  if (routerFields.decisionReason) snapshot.decisionReason = routerFields.decisionReason;
  if (routerFields.dispatcherInputSource) {
    snapshot.dispatcherInputSource = routerFields.dispatcherInputSource;
  }
  if (routerFields.fallbackPlan) snapshot.fallbackPlan = routerFields.fallbackPlan;
  taskContext.noteChooseContextDecision(snapshot);
}

const handleTabrixChooseContextRecordOutcome: NativeToolHandler = (args, deps) => {
  const result = runTabrixChooseContextRecordOutcome(args, {
    telemetry: deps.sessionManager.chooseContextTelemetry,
  });
  // Only `invalid_input` is a structural error; `unknown_decision` is
  // a legitimate response the caller can branch on.
  return jsonResult(result, result.status === 'invalid_input');
};

/**
 * Experience replay adapter. Reshapes the handler's typed deps
 * (`ExperienceReplayHandlerDeps`) into the generic
 * {@link NativeToolHandlerDeps} contract so it slots into the
 * existing dispatch table without leaking replay-specific types
 * upward. The replay handler itself uses a structural cast back to
 * its real deps shape.
 */
const NATIVE_HANDLERS: ReadonlyMap<string, NativeToolHandler> = new Map([
  [TOOL_NAMES.CONTEXT.CHOOSE, handleTabrixChooseContext],
  [TOOL_NAMES.CONTEXT.RECORD_OUTCOME, handleTabrixChooseContextRecordOutcome],
  [TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK, handleMemoryRecordAiFeedback],
]);

export function getNativeToolHandler(toolName: string): NativeToolHandler | undefined {
  return NATIVE_HANDLERS.get(toolName);
}

/**
 * Convenience wrapper for `register-tools.ts`. Resolves the default
 * sessionManager singleton at call time so callers do not need to
 * pass it through.
 */
export async function invokeNativeToolHandler(
  toolName: string,
  args: unknown,
): Promise<CallToolResult | undefined> {
  const handler = getNativeToolHandler(toolName);
  if (!handler) return undefined;
  return await handler(args, {
    sessionManager: defaultSessionManager,
  });
}
