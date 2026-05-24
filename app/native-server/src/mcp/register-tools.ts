import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_NAMES, TOOL_SCHEMAS, getRequiredCapability } from '@tabrix/shared';
import { isToolAllowedByPolicy } from '../policy/phase0-opt-in';
import { getCurrentCapabilityEnv, isCapabilityEnabled } from '../policy/capabilities';
import {
  attachRuntimePolicyAuditToResult,
  evaluateNonInterferencePreflight,
  isImpactToolName,
} from '../policy/non-interference-preflight';
import { sessionManager } from '../execution/session-manager';
import type {
  TaskPageRuntimeFields,
  TaskSessionContext,
  TaskVisibleRegionRowsData,
} from '../execution/task-session-context';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { planSkipRead, type SkipReadPlan } from '../execution/skip-read-orchestrator';
import { readApiKnowledgeEndpointPlan } from '../api/api-knowledge';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import { routeDataSource, type DataSourceDecision } from '../execution/data-source-router';
import { runPostProcessor } from './tool-post-processors';
import { getNativeToolHandler } from './native-tool-handlers';
import type {
  DispatchBridgedFn,
  ReplayOutcomeWriter,
  ReplayStepRecorder,
  SupportedReplayToolName,
} from './experience-replay';
import {
  callWithBridgeRecovery,
  getBridgeSnapshot,
  isRecoverableBridgeIssue,
} from './bridge-recovery';
import {
  buildGenericFailurePayload,
  createCapabilityDeniedResult,
  createErrorResult,
  createPolicyDeniedResult,
} from './tool-call-results';
import {
  extractClosedTabIdsFromCallToolResult,
  extractInvalidTabIdsFromCallToolResult,
  extractTabIdFromCallToolResult,
  extractRequestedLayer,
  READ_PAGE_DEFAULT_LAYER,
  resolveTaskContextKey,
} from './task-context-key';
import {
  buildDomRegionRowsRejectedLogHint,
  buildDomRegionRowsSuccessResult,
  buildVisibleRowsRejectionReason,
  inferDomRegionRowsTaskIntent,
  type ReadPageOperationLogHint,
} from './read-page-dom-region-rows-result';
import {
  apiFaultDataPurposeOverride,
  apiFaultFetchOverride,
  estimateApiRowsTokenSavings,
  normalizeApiFallbackCause,
  readAcceptanceApiFault,
  stripInternalReadPageArgs,
  withFallbackEvidence,
  type ApiReadFallbackEvidence,
} from './read-page-api-fallback';
import { buildKnowledgeApiRowsSuccessResult } from './read-page-api-rows-result';
import {
  buildLiveObservedApiRowsSuccessResult,
  buildLiveObservedRejectedLogHint,
} from './read-page-live-observed-result';
import { buildReadPageWarningResult } from './read-page-warning-result';
import { buildReadPageSkipResult } from './read-page-skip-result';
import {
  filterToolsByCapability,
  filterToolsByEnvironment,
  filterToolsByPolicy,
  isToolAllowed,
} from './tool-registry-filters';
import { listDynamicFlowTools } from './dynamic-flow-tools';
import { proxyDynamicFlowTool } from './dynamic-flow-proxy';
import {
  recordPrimaryTabCleanupOutcome,
  recordPrimaryTabNavigationOutcome,
  resolvePrimaryTabOutgoingArgs,
} from './primary-tab-outgoing-args';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { getDefaultPrimaryTabController } from '../runtime/primary-tab-controller';
import {
  evaluateStructuredReadGate,
  type StructuredReadGateResult,
} from '../runtime/structured-read-gate';
import { produceToolFailureLifecycleEvidenceArtifact } from '../runtime/lifecycle-evidence-collector';
import type {
  BrowserDataSourceDecisionEvidence,
  BrowserPageOwnerType,
  BrowserPageThingProjection,
  BrowserTaskStateVerdict,
  ReadPageCompactSnapshot,
  ReadPageMode,
  ReadPageOwnershipRuntimeSummary,
  ReadPageSelectedDataSource,
} from '@tabrix/shared';
import { buildBrowserTaskStateVerdict } from '@tabrix/shared';

const DEFAULT_AUTO_TASK_CONTEXT_KEY = 'mcp:auto:tab:default';
const TOOL_FAILURE_ARTIFACT_SCENARIO_ID = 'mcp:chrome_read_page:page_unreadable';

type TaskContextKeySource = 'external_task_key' | 'internal_task_id';

interface TaskContextAttachment {
  toolName: string;
  taskContext: TaskSessionContext | null;
  taskContextKey: string;
  taskContextKeySource: TaskContextKeySource;
}

/**
 * Production wiring for the `experience_replay` handler.
 * Binds:
 *   - `dispatchBridged` to the existing `invokeExtensionCommand`
 *     round-trip (with the same recovery-aware wrapper used for
 *     ordinary tool calls).
 *   - `recorder` to `sessionManager.startStep` / `completeStep`
 *     against the wrapper-owned session, so each replayed sub-step
 *     gets its own `memory_steps` row carrying the underlying
 *     tool name.
 *   - `updateTaskIntent` to `sessionManager.updateTaskIntent` so the
 *     wrapper-owned session is re-tagged with
 *     `experience_replay:<actionPathId>`.
 *
 * Lookup of the wrapper-owned session/task happens inside the
 * recorder closure (instead of capturing the live `ExecutionSession`
 * object) so the production code path stays compatible with future
 * persistence-mode changes (`'off'` does not produce a real session,
 * but the handler short-circuits before we reach that branch).
 */
function buildReplayDeps(wrapperSessionId: string): {
  dispatchBridged: DispatchBridgedFn;
  recorder: ReplayStepRecorder;
  updateTaskIntent: (intent: string) => void;
  outcomeWriter: ReplayOutcomeWriter;
} {
  const dispatchBridged: DispatchBridgedFn = async (toolName, toolArgs) => {
    const { response, bridgeFailure } = await callWithBridgeRecovery(
      () => invokeExtensionCommand('call_tool', { name: toolName, args: toolArgs }, 120000),
      `tool:${toolName}`,
    );
    if (response?.status === 'success') {
      const normalized = normalizeToolCallResult(toolName, response.data);
      // Pass through the underlying tool's CallToolResult shape so
      // the ReplayEngine can extract `historyRef` from its content.
      return (
        response.data ?? {
          content: [{ type: 'text' as const, text: normalized.stepSummary ?? '' }],
          isError: false,
        }
      );
    }
    return {
      content: [
        {
          type: 'text' as const,
          text: bridgeFailure
            ? JSON.stringify(bridgeFailure)
            : JSON.stringify({
                code: 'TABRIX_TOOL_CALL_FAILED',
                message: String(response?.error ?? 'Unknown tool error'),
              }),
        },
      ],
      isError: true,
    };
  };

  const recorder: ReplayStepRecorder = {
    startStep(input) {
      const child = sessionManager.startStep({
        sessionId: wrapperSessionId,
        toolName: input.toolName,
        stepType: 'tool_call',
        inputSummary: input.inputSummary,
      });
      return child.stepId;
    },
    completeStep(stepId, update) {
      sessionManager.completeStep(wrapperSessionId, stepId, {
        status: 'completed',
        resultSummary: update.resultSummary,
        artifactRefs: update.artifactRefs,
      });
    },
    failStep(stepId, update) {
      sessionManager.completeStep(wrapperSessionId, stepId, {
        status: 'failed',
        errorCode: update.failureCode,
        errorSummary: update.errorSummary,
      });
    },
  };

  const updateTaskIntent = (intent: string) => {
    // Resolve the live wrapper session → its taskId and forward to
    // the SessionManager. Wrapped in try/catch because tagging is
    // best-effort: a missing session must never mask the real
    // experience_replay outcome.
    try {
      const wrapperSession = sessionManager.getSession(wrapperSessionId);
      sessionManager.updateTaskIntent(wrapperSession.taskId, intent);
    } catch {
      // Session no longer present (e.g. test fixture reset between
      // invocation and tagging) — ignore.
    }
  };

  // Per-step write-back hook. Isolation is enforced TWICE:
  //   1. here, where any thrown SQLite error is caught and downgraded
  //      to a structured warning row (so the user's replay path stays
  //      alive); and
  //   2. inside `ReplayEngine.tryWriteOutcome`, which already wraps
  //      the call in its own try/catch as defense-in-depth.
  // We deliberately swallow the inner `recordWritebackWarning` failure
  // for the same reason the score-step handler does — at that point even
  // the warning row could not land, but throwing would defeat the
  // isolation contract.
  const outcomeWriter: ReplayOutcomeWriter = {
    recordReplayStepOutcome(input) {
      const experience = sessionManager.experience;
      if (!experience) return;
      const nowIso = new Date().toISOString();
      try {
        experience.recordReplayStepOutcome({
          actionPathId: input.actionPathId,
          stepIndex: input.stepIndex,
          observedOutcome: input.observedOutcome,
          nowIso,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const warningId = `warn_replay_outcome_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
        try {
          experience.recordWritebackWarning({
            warningId,
            source: 'experience_score_step',
            actionPathId: input.actionPathId,
            stepIndex: input.stepIndex,
            sessionId: wrapperSessionId,
            replayId: null,
            observedOutcome: input.observedOutcome,
            errorCode: 'replay_outcome_write_failed',
            errorMessage: message.slice(0, 512),
            payloadBlob: null,
            createdAt: nowIso,
          });
        } catch {
          // Warning row also failed — stay silent by isolation
          // contract. Operator-side telemetry will surface the
          // underlying SQLite issue separately.
        }
      }
    },
  };

  return { dispatchBridged, recorder, updateTaskIntent, outcomeWriter };
}

async function invokeExtensionCommand(
  action: 'call_tool' | 'list_published_flows',
  payload: any,
  timeoutMs: number,
): Promise<any> {
  const snapshot = getBridgeSnapshot();
  if (snapshot.commandChannelConnected && bridgeCommandChannel.isConnected()) {
    return await bridgeCommandChannel.sendCommand(action, payload, timeoutMs);
  }

  if (action === 'call_tool') {
    return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
      payload,
      NativeMessageType.CALL_TOOL,
      timeoutMs,
    );
  }

  return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
    {},
    'rr_list_published_flows',
    timeoutMs,
  );
}

export const setupTools = (server: McpServer) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const dynamicTools = await listDynamicFlowTools(invokeExtensionCommand);
    const byEnv = filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]);
    const byPolicy = filterToolsByPolicy(byEnv);
    return { tools: filterToolsByCapability(byPolicy, getCurrentCapabilityEnv()) };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

export const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  const toolCallStartedAtMs = Date.now();
  const task = sessionManager.createTask({
    taskType: name.startsWith('flow.') ? 'flow-call' : 'tool-call',
    title: `Execute ${name}`,
    intent: `Run MCP tool ${name}`,
    origin: 'mcp',
    labels: ['mcp', name.startsWith('flow.') ? 'flow' : 'tool'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'mcp',
    clientName: 'mcp-server',
  });
  const step = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: name,
    stepType: name.startsWith('flow.') ? 'flow_call' : 'tool_call',
    inputSummary: JSON.stringify(args ?? {}),
  });

  try {
    const dynamicTools = await listDynamicFlowTools(invokeExtensionCommand);
    const allowedTools = filterToolsByEnvironment([...TOOL_SCHEMAS, ...dynamicTools]);

    if (!isToolAllowed(name, allowedTools)) {
      const result = createErrorResult(
        `Tool "${name}" is disabled or not available in the current server configuration.`,
      );
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'tool_not_available',
        errorSummary: `Tool "${name}" is disabled or unavailable`,
        resultSummary: 'Tool rejected by current configuration',
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} rejected by configuration`,
      });
      return result;
    }

    if (!isToolAllowedByPolicy(name, process.env)) {
      const result = createPolicyDeniedResult(name);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'policy_denied_p3',
        errorSummary: `Tool "${name}" blocked by Tabrix Policy (P3 opt-in required)`,
        resultSummary: 'Tool rejected by Tabrix Policy',
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} rejected by Tabrix Policy`,
      });
      return result;
    }

    // Capability gate (defense-in-depth — `filterToolsByCapability`
    // already removed disabled tools from `listTools`, but a curious
    // client may still try to call one directly). Returns the same
    // `denied / capability_off` payload shape the experience_replay
    // handler would produce, so callers branch on `error.code` not on
    // the source of the denial.
    const requiredCapability = getRequiredCapability(name);
    if (requiredCapability && !isCapabilityEnabled(requiredCapability, getCurrentCapabilityEnv())) {
      const result = createCapabilityDeniedResult(name, requiredCapability);
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'capability_off',
        errorSummary: `Tool "${name}" denied — capability '${requiredCapability}' is not enabled`,
        resultSummary: `Tool ${name} denied by capability gate`,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} denied by capability gate`,
      });
      return result;
    }

    // Resolve the task context BEFORE we branch into the native handler
    // so `tabrix_choose_context` (a native-handled tool) can write its
    // decision into the same `TaskSessionContext` the `chrome_read_page`
    // shim later peeks. Auto-keying covers the schema-strict client case
    // (chooser's public schema does not advertise `taskSessionId /
    // tabId`) so the pair lands on the same `mcp:auto:tab:<id|default>`
    // key without spying on `getTaskContext`. Tools outside the auto set
    // still get the freshly-minted internal `taskId` fallback so their
    // contract is preserved bit-for-bit.
    const bridgeForKeyEarly = bridgeRuntimeState.getSnapshot();
    const externalTaskKeyEarly = resolveTaskContextKey(name, args, {
      primaryTabId: bridgeForKeyEarly.primaryTabId,
    });
    const taskContextEarly = externalTaskKeyEarly
      ? sessionManager.getOrCreateExternalTaskContext(externalTaskKeyEarly)
      : sessionManager.getTaskContext(task.taskId);

    // Native-handled tools short-circuit the extension round-trip — see
    // `mcp/native-tool-handlers.ts`. Currently Experience read-side
    // queries, the context selector, and the `experience_replay`
    // write-side tool qualify; everything else still goes through the
    // Chrome extension via `invokeExtensionCommand`.
    const nativeHandler = getNativeToolHandler(name);
    if (nativeHandler) {
      // Only the experience_replay handler needs the bridge adapter +
      // per-step recorder + intent re-tagger. The other native handlers
      // ignore them, but always passing them keeps the deps shape
      // uniform.
      const replayDeps =
        name === TOOL_NAMES.EXPERIENCE.REPLAY ? buildReplayDeps(session.sessionId) : {};
      const nativeResult = await nativeHandler(args, {
        sessionManager,
        capabilityEnv: getCurrentCapabilityEnv(),
        // Carries the `TaskSessionContext` the `tabrix_choose_context`
        // handler writes into via `noteChooseContextDecision`. `null`
        // for tools outside the auto-key set when there is no live
        // external context; handlers that do not need it (e.g.
        // experience suggest / record-outcome) ignore the field.
        taskContext: taskContextEarly,
        ...replayDeps,
      });
      if (nativeResult.isError) {
        let errorSummary = `Native tool ${name} failed`;
        const firstContent = nativeResult.content?.[0];
        if (firstContent && firstContent.type === 'text') {
          const text = String(firstContent.text ?? '');
          if (text) {
            try {
              const parsed = JSON.parse(text) as { message?: string };
              if (parsed && typeof parsed.message === 'string') errorSummary = parsed.message;
            } catch {
              // Non-JSON error payload — fall back to the generic summary.
            }
          }
        }
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'failed',
          errorCode: 'native_tool_error',
          errorSummary,
          resultSummary: `Native tool ${name} failed`,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'failed',
          summary: `Native tool ${name} failed`,
        });
        return nativeResult;
      }
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: `Native tool ${name} completed`,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'completed',
        summary: `Native tool ${name} completed`,
      });
      return nativeResult;
    }

    // If calling a dynamic flow tool (name starts with flow.), proxy to common flow-run tool
    if (name && name.startsWith('flow.')) {
      return await proxyDynamicFlowTool({
        name,
        args,
        sessionId: session.sessionId,
        stepId: step.stepId,
        invokeExtensionCommand,
      });
    }
    // Primary Tab Controller hook. When
    // `TABRIX_PRIMARY_TAB_ENFORCE=true`, inject `tabId: primaryTabId`
    // into `chrome_navigate` args before forwarding to the extension so
    // multi-site flows reuse the primary tab. When the env flag is off
    // (default), `getInjectedTabId()` returns null and `args` is
    // forwarded unchanged — bit-identical to legacy behaviour. The
    // `args.tabId` caller-provided value always wins so allowlisted
    // scenarios that explicitly want a fresh tab still get it.
    const primaryTabController = getDefaultPrimaryTabController();
    let outgoingArgs: any = resolvePrimaryTabOutgoingArgs(name, args, primaryTabController);
    // Task Session Context read-budget gate. Only the `chrome_read_page`
    // hot path is gated; everything else passes through. The gate is
    // fail-soft: when no task context is attached (persistence off, or
    // `startSession` was bypassed) we forward the call unchanged so the
    // legacy happy path is preserved bit-for-bit.
    //
    // Resolve the gate's task key from a ladder that BOTH honours an
    // explicit caller-supplied key AND remains usable for
    // schema-following MCP clients that cannot see `taskSessionId /
    // taskId / clientTaskId` (those names are not in the public
    // `chrome_read_page` schema, so a strict client may strip them on
    // the wire). See `resolveTaskContextKey` above for the full ladder;
    // the short version is: explicit > args.tabId > bridge.primaryTabId
    // > single-process `mcp:auto:tab:default`. Auto-keying only fires
    // for `chrome_read_page` and `chrome_navigate`, so click/fill /
    // navigate-adjacent tools cannot mint phantom contexts.
    //
    // When `resolveTaskContextKey` returns null (only possible for
    // tools outside the auto set without an explicit key), we fall
    // back to the freshly-minted internal `taskId` so the contract for
    // those tools is preserved bit-for-bit.
    //
    // Decisions returned by `shouldAllowReadPage`:
    //   * `read_budget_exceeded` → return a structured warning
    //     CallToolResult immediately, WITHOUT a bridge round-trip.
    //   * `read_redundant`       → same: avoid the round-trip and
    //     point the agent at its previous projection.
    //   * `layer_demotion` / `''` → forward to the bridge as usual.
    //
    // `chrome_navigate` resolves the SAME key so a navigate followed
    // by a read on the same tab shares one context — `noteUrlChange`
    // wipes `lastReadLayer` / `targetRefsSeen` and the next read is
    // treated as a fresh first read on the new page.
    // Reuse the same `TaskSessionContext` we resolved before the
    // native-handler branch. Re-resolving here would be functionally
    // equivalent under the current
    // `getOrCreateExternalTaskContext` LRU semantics, but the fewer
    // resolution sites the harder it is for a future edit to drift
    // the chooser-write and reader-peek apart.
    const taskContext = taskContextEarly;
    const taskContextAttachment: TaskContextAttachment = {
      toolName: name,
      taskContext,
      taskContextKey: externalTaskKeyEarly ?? task.taskId,
      taskContextKeySource: externalTaskKeyEarly ? 'external_task_key' : 'internal_task_id',
    };
    // When the orchestrator returns `'fallback_required'` we MUST
    // forward to the bridge with the clamped fallback entry layer (`L0`
    // / `L0+L1`), never the caller's original `requestedLayer`.
    // Otherwise an upstream `requestedLayer='L0+L1+L2'` (the schema
    // default) would silently re-widen the read on the failure path.
    // `null` means "no fallback fired, keep the caller's original layer
    // bit-identical to the legacy path".
    let forcedReadPageLayer: 'L0' | 'L0+L1' | null = null;
    let operationLogHint: ReadPageOperationLogHint | null = null;
    let apiFallbackEvidence: ApiReadFallbackEvidence | null = null;
    if (taskContext && name === 'chrome_read_page') {
      const acceptanceApiFaultForLiveObserved = readAcceptanceApiFault(args);
      const liveObserved = acceptanceApiFaultForLiveObserved
        ? null
        : taskContext.peekLiveObservedApiData();
      if (liveObserved) {
        taskContext.noteSkipRead({
          source: liveObserved.selectedDataSource === 'api_detail' ? 'api_detail' : 'api_list',
          layer: 'L0+L1',
          tokensSavedEstimate: 0,
          actionPathId: null,
          apiFamily: liveObserved.endpointFamily,
        });
        const totals = taskContext.getTaskTotals();
        const { result: apiCallResult, operationLog } = buildLiveObservedApiRowsSuccessResult({
          liveObserved,
          taskTotals: totals,
        });
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: 'chrome_read_page fulfilled via current-task observed API data',
          operationLog,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: 'chrome_read_page fulfilled via current-task observed API data',
        });
        return apiCallResult;
      }
      const liveObservedEvidence = taskContext.peekLiveObservedApiEvidence();
      if (liveObservedEvidence.length > 0) {
        operationLogHint = buildLiveObservedRejectedLogHint(liveObservedEvidence);
      }
      // Skip-read orchestrator hook. We consult it BEFORE the existing
      // budget gate because a `'skip'` plan means we never round-trip
      // the bridge AND never spend the budget on a read we proved we
      // could avoid.
      //
      // Hard rules:
      //   * The orchestrator only fires when `choose_context` has
      //     ALREADY recorded a decision into this task context. Any
      //     in-flight read without a recorded decision keeps the
      //     legacy happy path bit-identical.
      //   * On `'skip'` we return a STRUCTURED skip envelope —
      //     never a synthetic `chrome_read_page` compact payload.
      //     A consumer can tell the read was avoided by the explicit
      //     `kind: 'read_page_skipped'` discriminator.
      //   * On `'fallback_required'` / `'forward'` we drop straight
      //     into the existing budget gate so the legacy short-circuit
      //     warnings still fire.
      const recordedDecision = taskContext.peekChooseContextDecision();
      if (recordedDecision !== null) {
        const skipPlan: SkipReadPlan = planSkipRead({
          decision: recordedDecision,
          taskCtx: {
            readPageCount: taskContext.readPageCount,
            readBudget: taskContext.readBudget,
            lastReadLayer: taskContext.lastReadLayer,
            currentUrl: taskContext.currentUrl,
          },
        });
        if (skipPlan.action === 'skip') {
          if (skipPlan.requiresApiCall) {
            const cap = recordedDecision.apiCapability;
            const acceptanceApiFault = readAcceptanceApiFault(args);
            // When `tabrix_choose_context` already executed the API
            // inline (executionMode='direct_api'), reuse the cached rows
            // verbatim instead of re-issuing the request. One
            // user-visible task maps to one API round-trip. The
            // acceptance-fault override is only honoured when the cached
            // result is absent so tests can still simulate a fresh-API
            // failure path.
            const cachedDirect =
              recordedDecision.executionMode === 'direct_api' &&
              recordedDecision.directApiResult &&
              !acceptanceApiFault
                ? recordedDecision.directApiResult
                : null;
            const apiResult = cachedDirect
              ? ({
                  status: 'ok' as const,
                  endpointFamily: cachedDirect.endpointFamily,
                  dataPurpose: cachedDirect.dataPurpose,
                  rows: cachedDirect.rows,
                  rowCount: cachedDirect.rowCount,
                  compact: cachedDirect.compact,
                  rawBodyStored: cachedDirect.rawBodyStored,
                  // Surface the cached empty-result envelope so the
                  // shim consumes the same closed shape regardless of
                  // whether the chooser executed inline or the shim
                  // issued the read here.
                  emptyResult: cachedDirect.emptyResult,
                  emptyReason: cachedDirect.emptyReason,
                  emptyMessage: cachedDirect.emptyMessage,
                  telemetry: cachedDirect.telemetry,
                } as Awaited<ReturnType<typeof readApiKnowledgeEndpointPlan>>)
              : await readApiKnowledgeEndpointPlan({
                  endpointFamily: cap?.family ?? '',
                  dataPurpose: apiFaultDataPurposeOverride(acceptanceApiFault, cap?.dataPurpose),
                  method: 'GET',
                  params: cap?.params ?? {},
                  fetchFn: apiFaultFetchOverride(acceptanceApiFault),
                });
            if (apiResult.status === 'ok') {
              const tokenSavings = estimateApiRowsTokenSavings({
                rows: apiResult.rows,
                rowCount: apiResult.rowCount,
                recordedFullReadTokenEstimate: recordedDecision.fullReadTokenEstimate,
                // When the API returned a verified-empty result we
                // MUST NOT inflate `tokensSavedEstimate` off a
                // hypothetical full-read estimate; pin it to the
                // conservative `unavailable_empty_api_rows` bucket.
                emptyResult: apiResult.emptyResult ?? false,
              });
              taskContext.noteSkipRead({
                source: skipPlan.sourceKind,
                layer: recordedDecision.chosenLayer,
                tokensSavedEstimate: tokenSavings.tokensSavedEstimate,
                actionPathId: null,
                apiFamily: apiResult.endpointFamily,
              });
              const totals = taskContext.getTaskTotals();
              const { result: apiCallResult, operationLog } = buildKnowledgeApiRowsSuccessResult({
                recordedDecision,
                skipPlan,
                apiResult,
                tokenSavings,
                endpointSource: cachedDirect?.endpointSource ?? 'seed_adapter',
                taskTotals: totals,
              });
              sessionManager.completeStep(session.sessionId, step.stepId, {
                status: 'completed',
                resultSummary: `chrome_read_page fulfilled via ${skipPlan.sourceKind} (saved ~${tokenSavings.tokensSavedEstimate} tok)`,
                operationLog,
              });
              sessionManager.finishSession(session.sessionId, {
                status: 'completed',
                summary: `chrome_read_page fulfilled via ${skipPlan.sourceKind}`,
              });
              return apiCallResult;
            }
            const fallbackCause = normalizeApiFallbackCause(apiResult.reason);
            forcedReadPageLayer = apiResult.fallbackEntryLayer;
            apiFallbackEvidence = {
              kind: 'read_page_fallback',
              readPageAvoided: false,
              sourceKind: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              fallbackCause,
              fallbackUsed: 'dom_compact',
              fallbackEntryLayer: apiResult.fallbackEntryLayer,
              apiFamily: apiResult.endpointFamily,
              apiTelemetry: apiResult.telemetry,
            };
            operationLogHint = {
              requestedLayer: apiResult.fallbackEntryLayer,
              selectedDataSource: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              decisionReason: fallbackCause,
              resultKind: 'read_page_fallback',
              fallbackUsed: 'dom_compact',
            };
          } else {
            taskContext.noteSkipRead({
              source: skipPlan.sourceKind,
              layer: recordedDecision.chosenLayer,
              tokensSavedEstimate: skipPlan.tokensSavedEstimate,
              actionPathId: recordedDecision.replayCandidate?.actionPathId ?? null,
              apiFamily: recordedDecision.apiCapability?.family ?? null,
            });
            const totals = taskContext.getTaskTotals();
            const { result: skipResult, operationLog } = buildReadPageSkipResult({
              recordedDecision,
              skipPlan,
              taskTotals: totals,
            });
            sessionManager.completeStep(session.sessionId, step.stepId, {
              status: 'completed',
              resultSummary: `chrome_read_page skipped via ${skipPlan.sourceKind} (saved ~${skipPlan.tokensSavedEstimate} tok)`,
              operationLog,
            });
            sessionManager.finishSession(session.sessionId, {
              status: 'completed',
              summary: `chrome_read_page skipped via ${skipPlan.sourceKind}`,
            });
            return skipResult;
          }
        }
        // `fallback_required` / `forward` falls through to the existing
        // budget gate path below. The chooser decision stays recorded so
        // a follow-up read on the same page can re-evaluate API
        // availability without needing a fresh chooser run.
        if (skipPlan.action === 'fallback_required') {
          // Pin the bridge-side `requestedLayer` to the orchestrator's
          // clamped fallback entry layer. Used below by the budget gate,
          // the bridge `call_tool` payload, and the post-success
          // `noteReadPage` bookkeeping so the three sites cannot drift
          // back to `'L0+L1+L2'`.
          forcedReadPageLayer = skipPlan.fallbackEntryLayer;
          if (skipPlan.sourceRoute === 'knowledge_supported_read') {
            apiFallbackEvidence = {
              kind: 'read_page_fallback',
              readPageAvoided: false,
              sourceKind: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              fallbackCause: 'api_unavailable',
              fallbackUsed: 'dom_compact',
              fallbackEntryLayer: 'L0+L1',
              apiTelemetry: {
                method: 'GET',
                reason: skipPlan.fallbackCause || 'fallback_required',
                status: null,
                waitedMs: 0,
                readAllowed: false,
                fallbackEntryLayer: 'L0+L1',
              },
            };
          }
          operationLogHint = {
            requestedLayer: skipPlan.fallbackEntryLayer,
            selectedDataSource: 'dom_json',
            sourceRoute: skipPlan.sourceRoute,
            decisionReason: skipPlan.diagnostic,
            resultKind: 'read_page_fallback',
            fallbackUsed: skipPlan.fallbackUsed,
          };
        }
      }
      // Read the public `requestedLayer` field (with legacy `layer`
      // fallback) instead of `(args as any).layer`, and default to the
      // MCP-schema default `'L0+L1+L2'` when nothing is supplied. When
      // the orchestrator demanded a fallback, override the
      // caller-supplied layer with the clamped fallback entry layer so
      // the gate decision matches what we are about to forward to the
      // bridge.
      const requestedLayer =
        forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
      const decision = taskContext.shouldAllowReadPage({ requestedLayer });
      if (!decision.allowed || decision.reason === 'read_redundant') {
        const shouldReuseCachedProjection = decision.reason === 'read_redundant';
        const cachedProjection = shouldReuseCachedProjection
          ? taskContext.peekLastPageProjection()
          : null;
        const {
          result: warningResult,
          warning,
          operationLog,
        } = buildReadPageWarningResult({
          decision,
          requestedLayer,
          operationLogHint,
          cachedProjection,
          cachedDeltaContext: cachedProjection
            ? taskContext.buildCachedPageProjectionDelta()
            : null,
          cachedDataSourceDecision: cachedProjection
            ? taskContext.buildCachedDataSourceDecision()
            : null,
          lifecycleTimeline: cachedProjection ? taskContext.getLifecycleTimeline() : null,
          runtimeFields: shouldReuseCachedProjection
            ? taskContext.peekLastPageRuntimeFields()
            : null,
        });
        const normalizedWarning = normalizeToolCallResult(name, warningResult);
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: normalizedWarning.stepSummary,
          operationLog,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: normalizedWarning.executionResult.summary,
        });
        return cachedProjection
          ? attachAiFacingOwnershipRuntime(warningResult, taskContextAttachment)
          : attachTaskContextEnvelopeToJsonResult(warningResult, taskContextAttachment);
      }
    }
    const nonInterferenceVerdict = evaluateNonInterferencePreflight({
      toolName: name,
      args: outgoingArgs,
      taskContext,
    });
    if (!nonInterferenceVerdict.allowed) {
      const payload = {
        ok: false,
        code:
          nonInterferenceVerdict.audit.verdict === 'collaboration_required'
            ? 'TABRIX_ACTION_COLLABORATION_REQUIRED'
            : 'TABRIX_NON_INTERFERENCE_BLOCKED',
        message: nonInterferenceVerdict.message,
        actionPreflight: {
          verdict: nonInterferenceVerdict.audit.verdict,
          reason: nonInterferenceVerdict.audit.reason,
        },
        runtimePolicyAudit: nonInterferenceVerdict.audit,
      };
      const result = attachTaskContextEnvelopeToJsonResult(
        createErrorResult(JSON.stringify(payload)),
        taskContextAttachment,
      );
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: 'non_interference_blocked',
        resultSummary: `${name} blocked by non-interference policy`,
        operationLog: {
          decisionReason: nonInterferenceVerdict.audit.reason,
          metadata: {
            decisionReason: nonInterferenceVerdict.audit.reason,
            actionOutcome: 'blocked',
            executionMode: 'non_interference_policy',
          },
        },
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `${name} blocked by non-interference policy`,
      });
      return result;
    }

    if (taskContext && name === 'chrome_navigate') {
      const url =
        args && typeof args === 'object' && typeof (args as any).url === 'string'
          ? ((args as any).url as string)
          : null;
      taskContext.noteUrlChange(url);
      if (externalTaskKeyEarly === null && url !== null) {
        sessionManager.peekExternalTaskContext(DEFAULT_AUTO_TASK_CONTEXT_KEY)?.noteUrlChange(url);
      }
    }
    // When the orchestrator demanded a fallback for `chrome_read_page`,
    // replace the caller's `requestedLayer` (which may be the schema
    // default `'L0+L1+L2'`) with the clamped fallback entry layer (`L0`
    // / `L0+L1`). Every other field on `args` (`tabId` / `windowId` /
    // `refId` / …) is preserved verbatim so call-site contracts that
    // rely on them are unaffected.
    if (name === 'chrome_read_page' && forcedReadPageLayer) {
      outgoingArgs = {
        ...(outgoingArgs && typeof outgoingArgs === 'object' ? outgoingArgs : {}),
        requestedLayer: forcedReadPageLayer,
      };
    }
    if (name === 'chrome_read_page') {
      outgoingArgs = stripInternalReadPageArgs(outgoingArgs);
    }
    const { response, bridgeFailure } = await callWithBridgeRecovery(
      () =>
        invokeExtensionCommand(
          'call_tool',
          {
            name,
            args: outgoingArgs,
          },
          120000,
        ),
      `tool:${name}`,
    );
    // Regardless of the enforcement gate, observe every
    // `chrome_navigate` outcome so the bridge runtime snapshot exposes
    // hygiene metrics (`primaryTabReuseRate`, `benchmarkOwnedTabCount`)
    // that benchmark transformers and any operator UI can read.
    // Defensive: tolerate missing / malformed `tabId` in the response
    // without throwing.
    recordPrimaryTabNavigationOutcome({ name, args, response, primaryTabController });
    if (response.status === 'success') {
      if (taskContext && name === 'chrome_navigate') {
        const returnedTabId = extractTabIdFromCallToolResult(response.data);
        const explicitTabId = readPositiveInteger(args, 'tabId');
        if (returnedTabId !== null && explicitTabId === null) {
          taskContext.noteRunOwnedTab(returnedTabId);
          sessionManager
            .getOrCreateExternalTaskContext(`mcp:auto:tab:${returnedTabId}`)
            .noteRunOwnedTab(returnedTabId);
        }
      }
      if (taskContext && shouldInvalidateReadAfterInteraction(name)) {
        taskContext.notePageInteraction({
          action: name,
          tabId: readPositiveInteger(args, 'tabId'),
        });
      }
      const postResult = runPostProcessor({
        toolName: name,
        rawResult: response.data,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager,
        taskContext: taskContextEarly,
        args,
      });
      let rawResultWithEvidence = withFallbackEvidence(postResult.rawResult, apiFallbackEvidence);
      let readPageRecorded = false;
      const recordSuccessfulReadPage = (
        source: 'unknown' | 'dom_region_rows',
        targetRefs?: ReadonlyArray<string> | null,
      ): void => {
        if (readPageRecorded || name !== 'chrome_read_page' || !taskContext) return;
        if (postResult.rawResult.isError === true) return;
        const requestedLayer =
          forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
        taskContext.noteReadPage({
          layer: requestedLayer,
          source,
          targetRefs,
        });
        readPageRecorded = true;
      };
      if (name === 'chrome_read_page' && taskContext && rawResultWithEvidence.isError !== true) {
        const visibleRows = taskContext.peekVisibleRegionRows();
        if (visibleRows) {
          const requestedLayer =
            forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
          const readPageRenderMode = extractReadPageRenderMode(args);
          const recordedDecisionForRows = taskContext.peekChooseContextDecision();
          const apiUnavailableReason =
            apiFallbackEvidence?.fallbackCause ??
            operationLogHint?.decisionReason ??
            'api_rows_unavailable_dom_region_rows_available';
          const routerDecision = routeDataSource({
            sourceRoute: recordedDecisionForRows?.sourceRoute ?? 'read_page_required',
            chosenLayer: recordedDecisionForRows?.chosenLayer ?? requestedLayer,
            layerDispatchReason: recordedDecisionForRows?.decisionReason,
            apiCandidateAvailable: false,
            dispatcherInputSource: recordedDecisionForRows?.dispatcherInputSource ?? null,
            taskIntent: inferDomRegionRowsTaskIntent(recordedDecisionForRows, visibleRows),
            readinessVerdict: 'ready',
            domRegionRowsEvidence: taskContext.peekVisibleRegionRowsEvidence(),
          });

          if (
            readPageRenderMode !== 'markdown' &&
            routerDecision.selectedDataSource === 'dom_region_rows'
          ) {
            recordSuccessfulReadPage(
              'dom_region_rows',
              visibleRows.rows
                .map((row) => row.targetRef)
                .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
            );
            const layerContract = mapDataSourceToLayerContract({
              dataSource: 'dom_region_rows',
              requestedLayer,
              fallbackEntryLayer: 'L0+L1',
            });
            const ownerType: BrowserPageOwnerType =
              typeof visibleRows.sourceTabId === 'number' && visibleRows.sourceTabId > 0
                ? taskContext.isRunOwnedTab(visibleRows.sourceTabId)
                  ? 'run_owned'
                  : 'user_owned'
                : 'unknown';
            const { result: domRowsResult, operationLog } = buildDomRegionRowsSuccessResult({
              requestedLayer,
              routerDecision,
              layerContract,
              visibleRows,
              ownerType,
              apiRowsUnavailableReason: apiUnavailableReason,
              readCount: taskContext.readPageCount,
            });
            const compatDomRowsResult = mergeReadPagePayloadMetadata(
              rawResultWithEvidence,
              domRowsResult,
              { omitFullPageContent: true },
            );
            const aiFacingDomRowsResult = attachAiFacingDeltaContext(
              compatDomRowsResult,
              taskContextAttachment,
            );
            sessionManager.completeStep(session.sessionId, step.stepId, {
              status: 'completed',
              resultSummary: 'chrome_read_page fulfilled via visible DOM region rows',
              artifactRefs:
                postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
              operationLog,
            });
            sessionManager.finishSession(session.sessionId, {
              status: 'completed',
              summary: 'chrome_read_page fulfilled via visible DOM region rows',
            });
            return aiFacingDomRowsResult;
          }

          const rejectedReason =
            readPageRenderMode === 'markdown'
              ? 'markdown_reading_surface_preferred'
              : buildVisibleRowsRejectionReason(visibleRows);
          if (readPageRenderMode === 'markdown') {
            const preferVisibleRowsForAi = shouldPreferVisibleRowsForMarkdownAiContext(
              visibleRows,
              routerDecision,
            );
            rawResultWithEvidence = attachReadPagePayloadMetadata(rawResultWithEvidence, {
              selectedDataSource: 'markdown',
              dataSource: 'markdown',
              decisionReason: 'markdown_reading_surface_preferred',
              visibleRegionRowsUsed: preferVisibleRowsForAi,
              visibleRegionRowCount: visibleRows.rowCount,
              visibleRegionRowsRejectedReason: preferVisibleRowsForAi ? null : rejectedReason,
              apiRowsUnavailableReason: apiUnavailableReason,
              ...(preferVisibleRowsForAi
                ? {
                    aiPreferredDataSource: 'dom_region_rows',
                    aiPreferredDataSourceReason: routerDecision.decisionReason,
                    rows: visibleRows.rows,
                    rowCount: visibleRows.rowCount,
                    targetRefCoverageRate: visibleRows.targetRefCoverageRate ?? null,
                    regionQualityScore: visibleRows.regionQualityScore ?? null,
                    rowExtractionConfidence: visibleRows.rowExtractionConfidence,
                    sourceRegion: visibleRows.sourceRegion,
                    sourceTabId:
                      typeof visibleRows.sourceTabId === 'number' && visibleRows.sourceTabId > 0
                        ? visibleRows.sourceTabId
                        : null,
                  }
                : {}),
            });
          }
          operationLogHint = buildDomRegionRowsRejectedLogHint({
            existing: operationLogHint,
            visibleRows,
            rejectedReason,
            apiRowsUnavailableReason: apiUnavailableReason,
            routerDecision,
          });
        }
      }
      // Record a successful chrome_read_page so the budget reflects
      // bridge-confirmed reads (failed reads do NOT consume the budget).
      // dom_region_rows may replace the payload, but it is still one
      // bridge-confirmed read_page call.
      recordSuccessfulReadPage('unknown');
      if (name === 'chrome_close_tabs' && taskContext && rawResultWithEvidence.isError !== true) {
        const closedTabIds = extractClosedTabIdsFromCallToolResult(rawResultWithEvidence);
        recordPrimaryTabCleanupOutcome({ closedTabIds, primaryTabController });
        for (const closedTabId of closedTabIds) {
          taskContext.releaseRunOwnedTab(closedTabId);
        }
        for (const invalidTabId of extractInvalidTabIdsFromCallToolResult(rawResultWithEvidence)) {
          taskContext.releaseRunOwnedTab(invalidTabId);
        }
        taskContext.noteCleanup({
          action: 'chrome_close_tabs',
          targetIds: readNumericArray(args, 'tabIds'),
        });
      }
      const aiFacingResult =
        name === 'chrome_read_page' && taskContext
          ? attachAiFacingDeltaContext(rawResultWithEvidence, taskContextAttachment)
          : name === 'chrome_close_tabs' && taskContext
            ? attachLifecycleTimelineContext(rawResultWithEvidence, taskContextAttachment)
            : rawResultWithEvidence;
      maybeRecordReadPageFailureLifecycleArtifact({
        name,
        args,
        result: aiFacingResult,
        startedAtMs: toolCallStartedAtMs,
        endedAtMs: Date.now(),
      });
      const resultWithPolicyAudit =
        isImpactToolName(name) && rawResultWithEvidence.isError !== true
          ? attachRuntimePolicyAuditToResult(aiFacingResult, nonInterferenceVerdict.audit)
          : aiFacingResult;
      const normalized = normalizeToolCallResult(name, resultWithPolicyAudit);
      const toolResultFailed = resultWithPolicyAudit.isError === true;
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'completed',
        resultSummary: normalized.stepSummary,
        artifactRefs:
          postResult.extraArtifactRefs.length > 0 ? postResult.extraArtifactRefs : undefined,
        operationLog:
          name === 'chrome_read_page'
            ? {
                ...(operationLogHint ?? {}),
                requestedLayer:
                  operationLogHint?.requestedLayer ??
                  extractRequestedLayer(outgoingArgs) ??
                  READ_PAGE_DEFAULT_LAYER,
                selectedDataSource: operationLogHint?.selectedDataSource ?? 'dom_json',
                resultKind:
                  operationLogHint?.resultKind ??
                  (toolResultFailed ? 'read_page_failed' : 'read_page'),
                success: operationLogHint?.success ?? (toolResultFailed ? false : undefined),
                decisionReason:
                  operationLogHint?.decisionReason ??
                  (toolResultFailed ? 'read_page_tool_error' : undefined),
              }
            : undefined,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'completed',
        summary: normalized.executionResult.summary,
      });
      return resultWithPolicyAudit;
    } else {
      const responseError = String(response.error || 'Unknown tool error');
      const isBridgeError =
        Boolean(bridgeFailure) ||
        responseError.includes('TABRIX_BRIDGE_') ||
        isRecoverableBridgeIssue(responseError);
      const failurePayload = bridgeFailure
        ? bridgeFailure
        : buildGenericFailurePayload(
            isBridgeError ? 'TABRIX_BRIDGE_OPERATION_ERROR' : 'TABRIX_TOOL_CALL_FAILED',
            responseError,
            false,
          );
      const result = createErrorResult(JSON.stringify(failurePayload));
      sessionManager.completeStep(session.sessionId, step.stepId, {
        status: 'failed',
        errorCode: bridgeFailure
          ? bridgeFailure.code.toLowerCase()
          : isBridgeError
            ? 'browser_bridge_not_ready'
            : 'tool_call_error',
        errorSummary: bridgeFailure ? bridgeFailure.message : responseError,
        resultSummary: `Tool ${name} failed`,
        operationLog:
          name === 'chrome_read_page'
            ? {
                ...(operationLogHint ?? {}),
                requestedLayer:
                  operationLogHint?.requestedLayer ??
                  extractRequestedLayer(outgoingArgs) ??
                  READ_PAGE_DEFAULT_LAYER,
                selectedDataSource: operationLogHint?.selectedDataSource ?? 'dom_json',
                resultKind: 'read_page_failed',
                decisionReason:
                  operationLogHint?.decisionReason ??
                  (bridgeFailure ? bridgeFailure.code : 'tool_call_error'),
                success: false,
              }
            : undefined,
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `Tool ${name} failed`,
      });
      return result;
    }
  } catch (error: any) {
    const result = createErrorResult(
      JSON.stringify(
        buildGenericFailurePayload(
          'TABRIX_TOOL_CALL_EXCEPTION',
          error?.message || String(error),
          false,
        ),
      ),
    );
    sessionManager.completeStep(session.sessionId, step.stepId, {
      status: 'failed',
      errorCode: 'tool_call_exception',
      errorSummary: error.message,
      resultSummary: `Tool ${name} threw an exception`,
    });
    sessionManager.finishSession(session.sessionId, {
      status: 'failed',
      summary: `Tool ${name} threw an exception`,
    });
    return result;
  }
};

function attachReadPagePayloadMetadata(
  result: CallToolResult,
  metadata: Record<string, unknown>,
  options: { omitFullPageContent?: boolean } = {},
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  const mergedPayload = { ...payload, ...metadata };
  if (options.omitFullPageContent) {
    delete mergedPayload.pageContent;
  }

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(mergedPayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

function maybeRecordReadPageFailureLifecycleArtifact(input: {
  name: string;
  args: unknown;
  result: CallToolResult;
  startedAtMs: number;
  endedAtMs: number;
}): void {
  if (input.name !== 'chrome_read_page') return;
  const payload = readJsonObjectFromCallToolResult(input.result);
  if (!payload) return;
  if (payload.success !== false) return;
  if (payload.reason !== 'page_unreadable') return;
  if (payload.pageType !== 'browser_error_page') return;
  const tabId = readPositiveInteger(input.args, 'tabId');
  if (tabId === null) return;

  produceToolFailureLifecycleEvidenceArtifact({
    artifactId: `mcp-read-failure-${input.startedAtMs}-${tabId}`,
    evidenceLevel: 'integration',
    scenarioId: TOOL_FAILURE_ARTIFACT_SCENARIO_ID,
    scenarioClass: 'postcondition_failure_v1',
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    actionId: `mcp:chrome_read_page:${tabId}:${input.startedAtMs}`,
    actionKind: 'unknown',
    tabId,
    reason: 'page_unreadable',
    observedOutcome: 'unknown',
    observedOutcomeConfidence: 0.85,
  });
}

function readJsonObjectFromCallToolResult(result: CallToolResult): Record<string, unknown> | null {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return null;

  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mergeReadPagePayloadMetadata(
  baseResult: CallToolResult,
  metadataResult: CallToolResult,
  options: { omitFullPageContent?: boolean } = {},
): CallToolResult {
  const first = metadataResult.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return baseResult;

  let metadata: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return baseResult;
    metadata = parsed as Record<string, unknown>;
  } catch {
    return baseResult;
  }

  return attachReadPagePayloadMetadata(baseResult, metadata, options);
}

function shouldPreferVisibleRowsForMarkdownAiContext(
  visibleRows: TaskVisibleRegionRowsData,
  routerDecision: DataSourceDecision,
): boolean {
  if (routerDecision.selectedDataSource !== 'dom_region_rows') return false;

  const region = visibleRows.sourceRegion.toLowerCase();
  const semanticListRegion =
    region.includes('result') ||
    region.includes('list') ||
    region.includes('search') ||
    region.includes('feed') ||
    region.includes('grid') ||
    region.includes('card');

  return semanticListRegion || visibleRows.cardRowsCount > 0 || visibleRows.cardExtractorUsed;
}

function shouldInvalidateReadAfterInteraction(toolName: string): boolean {
  return (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD
  );
}

function attachAiFacingOwnershipRuntime(
  result: CallToolResult,
  attachment: TaskContextAttachment,
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  const projection = payload.pageProjection;
  if (!isBrowserPageThingProjectionLike(projection)) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment);
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment);
  }

  const payloadSelectedDataSource = readPayloadSelectedDataSource(payload);
  const selectedDataSource = readSelectedDataSource(payload, projection);
  const aiFacingProjection = normalizeAiFacingProjectionDataSource(
    projection,
    selectedDataSource,
    payload,
  );
  const normalizedAiFacingProjection = normalizeAiFacingProjectionOwnerType(
    attachment.taskContext,
    aiFacingProjection,
    selectedDataSource,
    payload,
  );
  const runtimeFields: TaskPageRuntimeFields = {
    currentWindowId: readPositiveInteger(payload, 'currentWindowId'),
    isCurrentTabActive: readBoolean(payload, 'isCurrentTabActive'),
    isCurrentWindowFocused: readBoolean(payload, 'isCurrentWindowFocused'),
  };

  payload.pageProjection = normalizedAiFacingProjection;
  payload.ownershipRuntime = buildAiFacingOwnershipRuntimeSummary(
    attachment.taskContext,
    normalizedAiFacingProjection,
    runtimeFields,
  );
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  const aiContextEnvelope = readObject(payload.aiContextEnvelope);
  if (aiContextEnvelope) {
    payload.aiContextEnvelope = {
      ...aiContextEnvelope,
      taskContext: buildTaskContextEnvelope(attachment),
    };
  }

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function attachAiFacingDeltaContext(
  result: CallToolResult,
  attachment: TaskContextAttachment,
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  const projection = payload.pageProjection;
  if (!isBrowserPageThingProjectionLike(projection)) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment);
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment);
  }

  const payloadSelectedDataSource = readPayloadSelectedDataSource(payload);
  const selectedDataSource = readSelectedDataSource(payload, projection);
  const aiFacingProjection = normalizeAiFacingProjectionDataSource(
    projection,
    selectedDataSource,
    payload,
  );
  const normalizedAiFacingProjection = normalizeAiFacingProjectionOwnerType(
    attachment.taskContext,
    aiFacingProjection,
    selectedDataSource,
    payload,
  );
  const runtimeFields: TaskPageRuntimeFields = {
    currentWindowId: readPositiveInteger(payload, 'currentWindowId'),
    isCurrentTabActive: readBoolean(payload, 'isCurrentTabActive'),
    isCurrentWindowFocused: readBoolean(payload, 'isCurrentWindowFocused'),
  };
  const deltaContext = attachment.taskContext.notePageProjectionAndBuildDelta(
    normalizedAiFacingProjection,
    runtimeFields,
  );
  const selectedReason =
    selectedDataSource === readString(payload.aiPreferredDataSource)
      ? (readString(payload.aiPreferredDataSourceReason) ?? 'ai_context_prefers_visible_rows')
      : selectedDataSource !== payloadSelectedDataSource &&
          selectedDataSource === aiFacingProjection.chosenDataSource
        ? 'projection_chosen_data_source'
        : (readString(payload.decisionReason) ?? readString(payload.selectedReason));
  const fallbackReason =
    readString(payload.fallbackReason) ??
    readString(payload.fallbackCause) ??
    readString(payload.apiRowsUnavailableReason);
  const dataSourceDecision = buildAiFacingDataSourceDecision({
    payload,
    projection: aiFacingProjection,
    selectedDataSource,
    selectedReason,
    fallbackReason,
  });
  const taskState = buildAiFacingTaskState({
    payload,
    projection: aiFacingProjection,
    fallbackReason,
  });
  const structuredReadGate = buildStructuredReadGate(payload, normalizedAiFacingProjection);

  payload.pageProjection = normalizedAiFacingProjection;
  payload.ownershipRuntime = buildAiFacingOwnershipRuntimeSummary(
    attachment.taskContext,
    normalizedAiFacingProjection,
    runtimeFields,
  );
  payload.structuredReadGate = structuredReadGate;
  payload.deltaContext = deltaContext;
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  payload.aiContextEnvelope = {
    envelopeKind: 'delta_context',
    contextSource: 'page_projection_delta',
    taskContext: buildTaskContextEnvelope(attachment),
    taskState,
    selectedDataSource,
    dataSourceDecision,
    structuredReadGate,
    deltaContext,
    lifecycleTimeline: attachment.taskContext.getLifecycleTimeline(),
  };

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function buildStructuredReadGate(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): StructuredReadGateResult {
  return evaluateStructuredReadGate({
    snapshot: payload as unknown as ReadPageCompactSnapshot,
    readMode: readReadPageMode(payload.mode),
    nowMs: Date.now(),
    gateId: `structured-read-gate:${projection.projectionId}`,
  });
}

function readReadPageMode(value: unknown): ReadPageMode {
  return value === 'normal' || value === 'full' || value === 'compact' ? value : 'compact';
}

function normalizeAiFacingProjectionDataSource(
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
  payload: Record<string, unknown>,
): BrowserPageThingProjection {
  if (
    selectedDataSource !== 'dom_region_rows' ||
    projection.chosenDataSource === 'dom_region_rows' ||
    !hasVisibleRowsEvidence(payload)
  ) {
    return projection;
  }

  return {
    ...projection,
    chosenDataSource: 'dom_region_rows',
    sourceLineage: 'dom',
    sourceConfidence: readNumber(payload.rowExtractionConfidence) ?? projection.sourceConfidence,
  };
}

function normalizeAiFacingProjectionOwnerType(
  taskContext: TaskSessionContext,
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
  payload: Record<string, unknown>,
): BrowserPageThingProjection {
  const sourceTabId = resolveOwnerTypeSourceTabId(selectedDataSource, projection, payload);

  if (sourceTabId === null) {
    return {
      ...projection,
      ownerType: 'unknown',
    };
  }

  const ownerType: BrowserPageOwnerType = taskContext.isRunOwnedTab(sourceTabId)
    ? 'run_owned'
    : projection.ownerType === 'baseline'
      ? 'baseline'
      : 'user_owned';
  return {
    ...projection,
    ownerType,
  };
}

function resolveOwnerTypeSourceTabId(
  selectedDataSource: ReadPageSelectedDataSource,
  projection: BrowserPageThingProjection,
  payload: Record<string, unknown>,
): number | null {
  if (selectedDataSource === 'dom_region_rows') {
    const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
    return (
      readPositiveInteger(payload, 'sourceTabId') ??
      readPositiveInteger(rowsPayload, 'sourceTabId') ??
      readProjectionTabId(projection)
    );
  }
  return readProjectionTabId(projection);
}

function readProjectionTabId(projection: BrowserPageThingProjection): number | null {
  return Number.isInteger(projection.tabId) && projection.tabId > 0 ? projection.tabId : null;
}

function hasVisibleRowsEvidence(payload: Record<string, unknown>): boolean {
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(rowsPayload, 'rowCount');
  return (
    (payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true) &&
    rowCount !== null &&
    rowCount > 0
  );
}

function buildAiFacingOwnershipRuntimeSummary(
  taskContext: TaskSessionContext,
  projection: BrowserPageThingProjection,
  runtimeFields: TaskPageRuntimeFields,
): ReadPageOwnershipRuntimeSummary {
  const snapshot = getBridgeSnapshot();
  const runOwnedTabIds = [...taskContext.getRunOwnedTabIds()];
  const currentTabId =
    Number.isInteger(projection.tabId) && projection.tabId > 0 ? projection.tabId : null;
  const { currentWindowId, isCurrentTabActive, isCurrentWindowFocused } = runtimeFields;
  const isCurrentTabRunOwnedByTask =
    currentTabId !== null && taskContext.isRunOwnedTab(currentTabId);
  // Trust the normalized projection's ownerType as the single source of
  // truth. normalizeAiFacingProjectionOwnerType() already derives the
  // authoritative value from the same taskContext + tabId inputs, so
  // re-deriving here would create a second independent chain that could
  // drift out of sync.
  const currentOwnerType: BrowserPageOwnerType = projection.ownerType;
  const currentTabRunOwnershipVerdict =
    currentTabId === null
      ? 'unknown'
      : isCurrentTabRunOwnedByTask
        ? 'run_owned_by_task'
        : 'not_run_owned_by_task';
  const currentTabPrimaryRelationVerdict =
    currentTabId === null
      ? 'current_tab_unknown'
      : snapshot.primaryTabId === null
        ? 'primary_tab_unknown'
        : currentTabId === snapshot.primaryTabId
          ? 'current_tab_is_primary'
          : 'current_tab_differs_from_primary';
  const protectedScopeVerdict =
    currentTabId === null
      ? 'unknown'
      : !isCurrentTabRunOwnedByTask || currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
        ? 'protected'
        : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
          ? 'unknown'
          : 'not_protected';
  const cleanupEligibility =
    currentTabId === null
      ? 'unknown'
      : !isCurrentTabRunOwnedByTask || currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
        ? 'not_eligible'
        : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
          ? 'unknown'
          : 'eligible';
  const protectReason =
    currentTabId === null
      ? 'current_tab_unknown'
      : !isCurrentTabRunOwnedByTask
        ? 'not_run_owned_by_task'
        : currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
          ? 'current_tab_is_primary'
          : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
            ? 'primary_tab_unknown'
            : null;

  return {
    currentTabId,
    currentWindowId,
    isCurrentTabActive,
    isCurrentWindowFocused,
    currentOwnerType,
    currentTabRunOwnershipVerdict,
    currentTabPrimaryRelationVerdict,
    protectedScopeVerdict,
    cleanupEligibility,
    protectReason,
    isCurrentTabRunOwnedByTask,
    runOwnedTabIds,
    runOwnedTabCount: runOwnedTabIds.length,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: snapshot.bridgeState ?? null,
    primaryTabId: snapshot.primaryTabId,
    primaryTabReuseRate: snapshot.primaryTabReuseRate,
    benchmarkOwnedTabCount: snapshot.benchmarkOwnedTabCount,
    heartbeatTabCount: snapshot.heartbeat.tabCount,
    heartbeatWindowCount: snapshot.heartbeat.windowCount,
  };
}

function buildTaskContextEnvelope(attachment: TaskContextAttachment): Record<string, unknown> {
  const { taskContext } = attachment;
  if (!taskContext) {
    return {
      envelopeKind: 'task_context',
      status: 'context_missing',
      source: 'unavailable',
      taskContextKey: attachment.taskContextKey,
      taskContextKeySource: attachment.taskContextKeySource,
      toolName: attachment.toolName,
      reason: 'task_session_context_unavailable',
      evidenceBoundary: {
        deterministicOnly: true,
        realBrowserProven: false,
        commercialDeliveryProven: false,
      },
    };
  }

  return {
    envelopeKind: 'task_context',
    status: 'attached',
    source: 'task_session_context',
    taskContextKey: attachment.taskContextKey,
    taskContextKeySource: attachment.taskContextKeySource,
    toolName: attachment.toolName,
    currentUrlKnown: taskContext.currentUrl !== null,
    pageRoleKnown: taskContext.pageRole !== null,
    readPageCount: taskContext.readPageCount,
    readBudget: taskContext.readBudget,
    readPageRemainingBudget: Math.max(0, taskContext.readBudget - taskContext.readPageCount),
    lastReadLayer: taskContext.lastReadLayer,
    lastReadSource: taskContext.lastReadSource,
    lifecycleEventCount: taskContext.getLifecycleTimeline().length,
    runOwnedTabCount: taskContext.getRunOwnedTabIds().length,
    taskTotals: taskContext.getTaskTotals(),
    evidenceBoundary: {
      deterministicOnly: true,
      realBrowserProven: false,
      commercialDeliveryProven: false,
    },
  };
}

function attachTaskContextEnvelopeToJsonResult(
  result: CallToolResult,
  attachment: TaskContextAttachment,
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function buildAiFacingTaskState(args: {
  payload: Record<string, unknown>;
  projection: BrowserPageThingProjection;
  fallbackReason: string | null;
}): BrowserTaskStateVerdict {
  const readinessReason =
    readString(args.payload.readinessReason) ??
    readString(args.payload.blockedReadinessReason) ??
    args.fallbackReason;
  const policyDeniedReason =
    readString(args.payload.policyDeniedReason) ?? readString(args.payload.policyReason);
  const externalBlockedReason =
    readString(args.payload.externalBlockedReason) ?? readString(args.payload.externalBlockReason);
  return buildBrowserTaskStateVerdict({
    projection: args.projection,
    readinessReason,
    policyDeniedReason,
    externalBlockedReason,
  });
}

function buildAiFacingDataSourceDecision(args: {
  payload: Record<string, unknown>;
  projection: BrowserPageThingProjection;
  selectedDataSource: ReadPageSelectedDataSource;
  selectedReason: string | null;
  fallbackReason: string | null;
}): BrowserDataSourceDecisionEvidence {
  const availableSources = inferAvailableDataSources(args.payload, args.selectedDataSource);
  const rejectedSources = inferRejectedDataSources(args.payload, args.selectedDataSource);
  const metadataCompleteness = inferMetadataCompleteness(args.payload, args.projection);
  const regionCorrelation =
    args.projection.regionEvidenceRefs.length > 0 || args.projection.changedRegions.length > 0
      ? 1
      : null;

  return {
    availableSources,
    selectedSource: args.selectedDataSource,
    selectedReason: args.selectedReason ?? 'not_reported',
    rejectedSources,
    regionCorrelation,
    taskRelevance: null,
    privacySafety: 'redacted',
    metadataCompleteness,
    sourceFreshness: args.projection.sourceFreshness,
    sourceConfidence: args.projection.sourceConfidence,
    fallbackReason: args.fallbackReason,
  };
}

function inferAvailableDataSources(
  payload: Record<string, unknown>,
  selectedDataSource: ReadPageSelectedDataSource,
): ReadPageSelectedDataSource[] {
  const sources = new Set<ReadPageSelectedDataSource>([selectedDataSource]);
  if (readPositiveInteger(payload, 'rowCount') !== null) sources.add(selectedDataSource);
  if (payload.visibleRegionRowsUsed === true || payload.visibleRegionRowCount !== undefined) {
    sources.add('dom_region_rows');
  }
  if (payload.markdown !== undefined) sources.add('markdown');
  return [...sources];
}

function inferRejectedDataSources(
  payload: Record<string, unknown>,
  selectedDataSource: ReadPageSelectedDataSource,
): BrowserDataSourceDecisionEvidence['rejectedSources'] {
  const rejectedSources: BrowserDataSourceDecisionEvidence['rejectedSources'] = [];
  const apiRowsUnavailableReason = readString(payload.apiRowsUnavailableReason);
  if (
    apiRowsUnavailableReason &&
    selectedDataSource !== 'api_rows' &&
    selectedDataSource !== 'cdp_enhanced_api_rows'
  ) {
    rejectedSources.push({ source: 'api_rows', reason: apiRowsUnavailableReason });
  }

  const visibleRowsRejectedReason = readString(payload.visibleRegionRowsRejectedReason);
  if (visibleRowsRejectedReason && selectedDataSource !== 'dom_region_rows') {
    rejectedSources.push({ source: 'dom_region_rows', reason: visibleRowsRejectedReason });
  }

  return rejectedSources;
}

function inferMetadataCompleteness(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): number | null {
  const explicitCompleteness = readNumber(payload.metadataCompleteness);
  if (explicitCompleteness !== null) return clampUnitInterval(explicitCompleteness);
  const targetRefCoverageRate = readNumber(payload.targetRefCoverageRate);
  if (targetRefCoverageRate !== null) return clampUnitInterval(targetRefCoverageRate);
  if (projection.refreshedRefs.length > 0 && projection.changedRegions.length > 0) return 1;
  return null;
}

function attachLifecycleTimelineContext(
  result: CallToolResult,
  attachment: TaskContextAttachment,
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  payload.lifecycleTimeline = attachment.taskContext?.getLifecycleTimeline() ?? [];

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function isBrowserPageThingProjectionLike(input: unknown): input is BrowserPageThingProjection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const projection = input as Partial<BrowserPageThingProjection>;
  return (
    typeof projection.projectionId === 'string' &&
    typeof projection.contextChars === 'number' &&
    Array.isArray(projection.changedRegions) &&
    Array.isArray(projection.reusedRegions) &&
    Array.isArray(projection.invalidatedRefs) &&
    Array.isArray(projection.refreshedRefs)
  );
}

function readSelectedDataSource(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): ReadPageSelectedDataSource {
  const aiPreferred = readString(payload.aiPreferredDataSource);
  if (aiPreferred === 'dom_region_rows' && hasReliableVisibleRows(payload)) {
    return aiPreferred;
  }
  if (projection.chosenDataSource === 'dom_region_rows' && hasReliableVisibleRows(payload)) {
    return projection.chosenDataSource;
  }
  const selected = readString(payload.selectedDataSource) ?? readString(payload.dataSource);
  return (selected ?? projection.chosenDataSource) as ReadPageSelectedDataSource;
}

function readPayloadSelectedDataSource(
  payload: Record<string, unknown>,
): ReadPageSelectedDataSource | null {
  const selected = readString(payload.selectedDataSource) ?? readString(payload.dataSource);
  return selected ? (selected as ReadPageSelectedDataSource) : null;
}

function hasReliableVisibleRows(payload: Record<string, unknown>): boolean {
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(rowsPayload, 'rowCount');
  const coverage =
    readNumber(payload.targetRefCoverageRate) ?? readNumber(rowsPayload.targetRefCoverageRate);
  const quality =
    readNumber(payload.regionQualityScore) ?? readNumber(rowsPayload.regionQualityScore);
  return (
    (payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true) &&
    rowCount !== null &&
    rowCount > 0 &&
    (coverage === null || coverage >= 0.8) &&
    (quality === null || quality >= 0.7)
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractReadPageRenderMode(input: unknown): 'json' | 'markdown' | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const render = (input as Record<string, unknown>).render;
  return render === 'json' || render === 'markdown' ? render : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readBoolean(input: unknown, key: string): boolean | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === 'boolean' ? raw : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampUnitInterval(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readNumericArray(input: unknown, key: string): number[] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((value): value is number => Number.isInteger(value));
  return values.length > 0 ? values : null;
}

function readPositiveInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
}
