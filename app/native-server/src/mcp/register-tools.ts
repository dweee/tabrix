import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import { NativeMessageType, TOOL_NAMES, TOOL_SCHEMAS } from '@tabrix/shared';
import type { BuildPostActionDeltaEvidenceInput, PostActionDeltaEvidence } from '@tabrix/shared';
import type { ReadPageObjectLibraryHint } from '@tabrix/shared';
import { isToolAllowedByPolicy } from '../policy/phase0-opt-in';
import {
  attachRuntimePolicyAuditToResult,
  evaluateNonInterferencePreflight,
  isImpactToolName,
  type NonInterferencePreflightVerdict,
} from '../policy/non-interference-preflight';
import { sessionManager } from '../execution/session-manager';
import type {
  TaskSessionContext,
  TaskPageInteractionSnapshot,
  TaskVisibleRegionRowsData,
} from '../execution/task-session-context';
import { normalizeToolCallResult } from '../execution/result-normalizer';
import { planSkipRead, type SkipReadPlan } from '../execution/skip-read-orchestrator';
import { readApiKnowledgeEndpointPlan } from '../api/api-knowledge';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import { routeDataSource } from '../execution/data-source-router';
import { runPostProcessor } from './tool-post-processors';
import {
  callWithBridgeRecovery,
  getBridgeSnapshot,
  isRecoverableBridgeIssue,
} from './bridge-recovery';
import {
  buildGenericFailurePayload,
  createErrorResult,
  createPolicyDeniedResult,
} from './tool-call-results';
import { logger } from '../logging/logger';
import {
  extractCreatedTabForUrlFromCallToolResult,
  extractPostActionIdFromCallToolResult,
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
  evaluateReadPageTargetBinding,
  shouldPreferVisibleRowsForMarkdownAiContext,
  shouldRecordDomRegionRowsReadback,
} from './read-page-target-binding';
import {
  inferActionKindForToolName,
  inferPageInteractionChangeCause,
  readCandidateActionMetadata,
  readInteractionTargetRefs,
  shouldInvalidateReadAfterWindowFocusChange,
  shouldRecordPageInteractionAfterResult,
} from './browser-action-readback';
export { bindPostActionDeltaEvidenceToPendingInteraction } from './browser-action-readback';
import { attachLifecycleTimelineContext } from './close-tabs-action-evidence';
import {
  filterToolsByEnvironment,
  filterToolsByPolicy,
  isToolAllowed,
} from './tool-registry-filters';
import { readTabrixToolMetadata, stripTabrixToolMetadata } from './tabrix-metadata-envelope';
import { buildMcpToolListResponse } from './mcp-tool-list';
import {
  applyPreviousBusinessFeedback,
  createMkeMemoryTraceRecorder,
} from './mcp-tool-memory-trace';
import { finishAndRecordToolCallResult, finishToolCallLifecycle } from './mcp-tool-call-lifecycle';
import {
  attachReadPagePayloadMetadata,
  mergeReadPagePayloadMetadata,
  readJsonObjectFromCallToolResult,
} from './register-tool-result-json';
import { dispatchNativeToolIfAvailable } from './native-tool-dispatch';
import {
  buildReadPageRequestKey,
  extractReadPageRenderMode,
  shouldIncludeVerboseReadPageContext,
} from './read-page-request-shape';
import { extractVisibleRegionRowsDataFromPayload } from './read-page-visible-region-rows';
import { attachObjectLibraryHintsToReadPageResult } from './read-page-object-library-hints';
import { attachAiFacingDeltaContext } from './read-page-ai-facing-delta-context';
import { attachAiFacingOwnershipRuntime } from './read-page-ai-facing-ownership-context';
import { recordSuccessfulReadPageCall } from './read-page-success-recorder';
import { maybeRunAutoTaskFreshReadbackBeforeImpact } from './mcp-auto-fresh-readback';
import { ensureStructuredLegacyActionResult } from './mcp-legacy-action-result';
import {
  maybeRecordReadPageFailureLifecycleArtifact,
  maybeRecordStructuredReadGateLifecycleArtifact,
} from './mcp-tool-lifecycle-artifacts';
import { stripReadPageDiagnosticNoiseFromJsonResult } from './read-page-ai-output';
import {
  readBoolean,
  readFirstString,
  readInteger,
  readNonNegativeInteger,
  readNullableBoolean,
  readNumericArray,
  readNumber,
  readObject,
  readPositiveInteger,
  readSafeReuseRecord,
  readString,
  readStringArray,
  readUnknownArray,
} from './register-tool-value-readers';
import {
  recordPrimaryTabNavigationOutcome,
  resolvePrimaryTabOutgoingArgs,
} from './primary-tab-outgoing-args';
import { recordCloseTabsSuccessPostprocess } from './close-tabs-postprocess';
import { bridgeRuntimeState } from '../server/bridge-state';
import { bridgeCommandChannel } from '../server/bridge-command-channel';
import { getDefaultPrimaryTabController } from '../runtime/primary-tab-controller';
import type {
  BrowserPageChangeCause,
  BrowserPageOwnerType,
  ReadPageMode,
  ReadPageRequestedLayer,
} from '@tabrix/shared';
import {
  attachTaskContextEnvelopeToJsonResult,
  buildTaskContextEnvelope,
  type TaskContextAttachment,
} from './task-context-envelope';

const DEFAULT_AUTO_TASK_CONTEXT_KEY = 'mcp:auto:tab:default';

const BACKGROUND_CAPABLE_BROWSER_TOOLS = new Set<string>([
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.WEB_FETCHER,
]);

function applyTaskOwnedBackgroundExecutionPolicy(toolName: string, args: unknown): unknown {
  if (!BACKGROUND_CAPABLE_BROWSER_TOOLS.has(toolName)) return args;
  if (!args || typeof args !== 'object') return args;
  if (readBoolean(args, 'background') !== null) return args;

  const desiredExecutionMode = readRuntimePolicyString(args, 'desiredExecutionMode');
  const focusPolicy = readRuntimePolicyString(args, 'focusPolicy');
  const wantsBackground =
    desiredExecutionMode === 'background' ||
    desiredExecutionMode === 'run_owned' ||
    focusPolicy === 'no_steal';
  if (!wantsBackground) return args;

  return {
    ...(args as Record<string, unknown>),
    background: true,
  };
}

function applyTaskOwnedFinalizeCleanupPolicy(
  toolName: string,
  args: unknown,
  taskContext: TaskSessionContext | null,
): unknown {
  if (toolName !== TOOL_NAMES.BROWSER.CLOSE_TABS) return args;
  if (!args || typeof args !== 'object') return args;
  if (readRuntimePolicyString(args, 'cleanupPolicy') !== 'close_run_owned') return args;
  if (readNumericArray(args, 'tabIds') !== null) return args;
  if (readString(readObject(args)?.url) !== null) return args;
  if (readInteger(args, 'windowId') !== null) return args;

  const runOwnedTabIds = taskContext?.getRunOwnedTabIds() ?? [];
  if (runOwnedTabIds.length === 0) return args;

  return {
    ...(args as Record<string, unknown>),
    tabIds: [...runOwnedTabIds],
  };
}

function readRuntimePolicyString(args: unknown, key: string): string | null {
  const record = readObject(args);
  const direct = readString(record?.[key]);
  if (direct) return direct;
  const runtimePolicy = readObject(record?.runtimePolicy);
  return readString(runtimePolicy?.[key]);
}

async function invokeExtensionCommand(
  action: 'call_tool',
  payload: any,
  timeoutMs: number,
): Promise<any> {
  const snapshot = getBridgeSnapshot();
  if (snapshot.commandChannelConnected && bridgeCommandChannel.isConnected()) {
    return await bridgeCommandChannel.sendCommand(action, payload, timeoutMs);
  }

  return await nativeMessagingHostInstance.sendRequestToExtensionAndWait(
    payload,
    NativeMessageType.CALL_TOOL,
    timeoutMs,
  );
}

export const setupTools = (server: McpServer) => {
  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => buildMcpToolListResponse());

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    handleToolCall(request.params.name, request.params.arguments || {}),
  );
};

export const handleToolCall = async (name: string, args: any): Promise<CallToolResult> => {
  const toolCallStartedAtMs = Date.now();
  const tabrixMetadata = readTabrixToolMetadata(args);
  const toolArgs = stripTabrixToolMetadata(args);
  args = toolArgs;
  const taskIntent = tabrixMetadata.intentTitle ?? `Run MCP tool ${name}`;
  const task = sessionManager.createTask({
    taskType: 'tool-call',
    title: tabrixMetadata.intentTitle
      ? `Execute ${name}: ${tabrixMetadata.intentTitle}`
      : `Execute ${name}`,
    intent: taskIntent,
    origin: 'mcp',
    labels: ['mcp', 'tool'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'mcp',
    clientName: 'mcp-server',
  });
  const step = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: name,
    stepType: 'tool_call',
    inputSummary: JSON.stringify(args ?? {}),
  });
  let previousFeedbackResults: ReturnType<typeof applyPreviousBusinessFeedback> = [];
  const mkeMemoryTraceRecorder = createMkeMemoryTraceRecorder({
    sessionManager,
    task,
    taskIntent,
    aiClient: session.clientName,
    toolName: name,
    step,
    requestStartedAtMs: toolCallStartedAtMs,
    defaultRequestParams: args,
    metadata: tabrixMetadata,
    getPreviousFeedbackResults: () => previousFeedbackResults,
  });
  const recordAndAttachMkeMemoryTrace = (
    result: CallToolResult,
    input?: {
      requestParams?: unknown;
      resultSummary?: string | null;
      errorCode?: string | null;
      browserContextKey?: string | null;
    },
  ): CallToolResult => mkeMemoryTraceRecorder.recordAndAttach(result, input);

  try {
    previousFeedbackResults = applyPreviousBusinessFeedback({
      metadata: tabrixMetadata,
      sessionManager,
      sourceToolName: name,
      sourceToolCallId: step.stepId,
      receivedAtMs: toolCallStartedAtMs,
    });
    const allowedTools = filterToolsByEnvironment(TOOL_SCHEMAS);

    if (!isToolAllowed(name, allowedTools)) {
      const result = createErrorResult(
        `Tool "${name}" is disabled or not available in the current server configuration.`,
      );
      return finishAndRecordToolCallResult({
        sessionManager,
        sessionId: session.sessionId,
        stepId: step.stepId,
        step: {
          status: 'failed',
          errorCode: 'tool_not_available',
          errorSummary: `Tool "${name}" is disabled or unavailable`,
          resultSummary: 'Tool rejected by current configuration',
        },
        session: {
          status: 'failed',
          summary: `Tool ${name} rejected by configuration`,
        },
        result,
        recordTrace: recordAndAttachMkeMemoryTrace,
        trace: {
          errorCode: 'tool_not_available',
          resultSummary: 'Tool rejected by current configuration',
        },
      });
    }

    if (!isToolAllowedByPolicy(name, process.env)) {
      const result = createPolicyDeniedResult(name);
      return finishAndRecordToolCallResult({
        sessionManager,
        sessionId: session.sessionId,
        stepId: step.stepId,
        step: {
          status: 'failed',
          errorCode: 'policy_denied_p3',
          errorSummary: `Tool "${name}" blocked by Tabrix Policy (P3 opt-in required)`,
          resultSummary: 'Tool rejected by Tabrix Policy',
        },
        session: {
          status: 'failed',
          summary: `Tool ${name} rejected by Tabrix Policy`,
        },
        result,
        recordTrace: recordAndAttachMkeMemoryTrace,
        trace: {
          errorCode: 'policy_denied_p3',
          resultSummary: 'Tool rejected by Tabrix Policy',
        },
      });
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
    const taskContextAttachment: TaskContextAttachment = {
      toolName: name,
      taskContext: taskContextEarly,
      taskContextKey: externalTaskKeyEarly ?? task.taskId,
      taskContextKeySource: externalTaskKeyEarly ? 'external_task_key' : 'internal_task_id',
      requestArgs: args,
    };

    const nativeDispatch = await dispatchNativeToolIfAvailable({
      name,
      args,
      sessionManager,
      taskContext: taskContextEarly,
      taskContextAttachment,
      session,
      step,
      recordAndAttachMkeMemoryTrace,
    });
    if (nativeDispatch.handled) {
      return nativeDispatch.result;
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
    outgoingArgs = applyTaskOwnedBackgroundExecutionPolicy(name, outgoingArgs);
    outgoingArgs = applyTaskOwnedFinalizeCleanupPolicy(name, outgoingArgs, taskContextEarly);
    taskContextAttachment.requestArgs = outgoingArgs;
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
    // > single-process `mcp:auto:tab:default`. Auto-keying fires only
    // for read/navigate and page-changing interaction tools, so the
    // next read after a click/fill/keyboard action can verify fresh
    // page state without screenshots or manual cache busting.
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
          apiFamily: liveObserved.endpointFamily,
        });
        const totals = taskContext.getTaskTotals();
        const { result: apiCallResult, operationLog } = buildLiveObservedApiRowsSuccessResult({
          liveObserved,
          taskTotals: totals,
        });
        const finalApiCallResult = shouldIncludeVerboseReadPageContext(
          args,
          extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER,
        )
          ? apiCallResult
          : stripReadPageDiagnosticNoiseFromJsonResult(apiCallResult);
        return finishAndRecordToolCallResult({
          sessionManager,
          sessionId: session.sessionId,
          stepId: step.stepId,
          step: {
            status: 'completed',
            resultSummary: 'chrome_read_page fulfilled via current-task observed API data',
            operationLog,
          },
          session: {
            status: 'completed',
            summary: 'chrome_read_page fulfilled via current-task observed API data',
          },
          result: finalApiCallResult,
          recordTrace: recordAndAttachMkeMemoryTrace,
          trace: {
            requestParams: outgoingArgs,
            resultSummary: 'chrome_read_page fulfilled via current-task observed API data',
            browserContextKey: taskContextAttachment.taskContextKey,
          },
        });
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
                apiFamily: apiResult.endpointFamily,
              });
              const totals = taskContext.getTaskTotals();
              const { result: apiCallResult, operationLog } = buildKnowledgeApiRowsSuccessResult({
                recordedDecision,
                skipPlan,
                apiResult,
                tokenSavings,
                endpointSource: cachedDirect?.endpointSource ?? 'observed',
                taskTotals: totals,
              });
              const resultSummary = `chrome_read_page fulfilled via ${skipPlan.sourceKind} (saved ~${tokenSavings.tokensSavedEstimate} tok)`;
              return finishAndRecordToolCallResult({
                sessionManager,
                sessionId: session.sessionId,
                stepId: step.stepId,
                step: {
                  status: 'completed',
                  resultSummary,
                  operationLog,
                },
                session: {
                  status: 'completed',
                  summary: `chrome_read_page fulfilled via ${skipPlan.sourceKind}`,
                },
                result: apiCallResult,
                recordTrace: recordAndAttachMkeMemoryTrace,
                trace: {
                  requestParams: outgoingArgs,
                  resultSummary,
                  browserContextKey: taskContextAttachment.taskContextKey,
                },
              });
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
              apiFamily: recordedDecision.apiCapability?.family ?? null,
            });
            const totals = taskContext.getTaskTotals();
            const { result: skipResult, operationLog } = buildReadPageSkipResult({
              recordedDecision,
              skipPlan,
              taskTotals: totals,
            });
            const resultSummary = `chrome_read_page skipped via ${skipPlan.sourceKind} (saved ~${skipPlan.tokensSavedEstimate} tok)`;
            return finishAndRecordToolCallResult({
              sessionManager,
              sessionId: session.sessionId,
              stepId: step.stepId,
              step: {
                status: 'completed',
                resultSummary,
                operationLog,
              },
              session: {
                status: 'completed',
                summary: `chrome_read_page skipped via ${skipPlan.sourceKind}`,
              },
              result: skipResult,
              recordTrace: recordAndAttachMkeMemoryTrace,
              trace: {
                requestParams: outgoingArgs,
                resultSummary,
                browserContextKey: taskContextAttachment.taskContextKey,
              },
            });
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
            const fallbackCause = normalizeApiFallbackCause(skipPlan.fallbackCause);
            apiFallbackEvidence = {
              kind: 'read_page_fallback',
              readPageAvoided: false,
              sourceKind: 'dom_json',
              sourceRoute: skipPlan.sourceRoute,
              fallbackCause,
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
      // MCP-schema default `'L0+L1'` when nothing is supplied. When
      // the orchestrator demanded a fallback, override the
      // caller-supplied layer with the clamped fallback entry layer so
      // the gate decision matches what we are about to forward to the
      // bridge.
      const requestedLayer =
        forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
      const readPageRequestKey = buildReadPageRequestKey(args, requestedLayer);
      const decision = taskContext.shouldAllowReadPage({
        requestedLayer,
        requestKey: readPageRequestKey,
        forceRefresh: readBoolean(args, 'forceRefresh') === true,
      });
      if (!decision.allowed || decision.reason === 'read_redundant') {
        const shouldAttachCachedProjection =
          decision.reason === 'read_redundant' || decision.reason === 'read_budget_exceeded';
        const cachedProjection = shouldAttachCachedProjection
          ? taskContext.peekLastPageProjection()
          : null;
        const { result: warningResult, operationLog } = buildReadPageWarningResult({
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
          runtimeFields: shouldAttachCachedProjection
            ? taskContext.peekLastPageRuntimeFields()
            : null,
          cachedAuthResumeGate: shouldAttachCachedProjection
            ? taskContext.peekLastAuthResumeGate()
            : null,
          cachedTaskResumeReadiness:
            shouldAttachCachedProjection && cachedProjection
              ? taskContext.buildTaskResumeReadiness({ tabId: cachedProjection.tabId })
              : null,
        });
        const normalizedWarning = normalizeToolCallResult(name, warningResult);
        const finalWarningResult = cachedProjection
          ? attachAiFacingOwnershipRuntime(warningResult, taskContextAttachment, {
              includeAiContextEnvelope: shouldIncludeVerboseReadPageContext(args, requestedLayer),
            })
          : attachTaskContextEnvelopeToJsonResult(warningResult, taskContextAttachment, {
              stripReadPageDiagnostics: !shouldIncludeVerboseReadPageContext(args, requestedLayer),
            });
        return finishAndRecordToolCallResult({
          sessionManager,
          sessionId: session.sessionId,
          stepId: step.stepId,
          step: {
            status: 'completed',
            resultSummary: normalizedWarning.stepSummary,
            operationLog,
          },
          session: {
            status: 'completed',
            summary: normalizedWarning.executionResult.summary,
          },
          result: finalWarningResult,
          recordTrace: recordAndAttachMkeMemoryTrace,
          trace: {
            requestParams: outgoingArgs,
            resultSummary: normalizedWarning.stepSummary,
            errorCode: decision.reason ?? 'read_page_warning',
            browserContextKey: taskContextAttachment.taskContextKey,
          },
        });
      }
    }
    let nonInterferenceVerdict = evaluateNonInterferencePreflight({
      toolName: name,
      args: outgoingArgs,
      taskContext,
    });
    const autoFreshReadback = await maybeRunAutoTaskFreshReadbackBeforeImpact({
      toolName: name,
      args: outgoingArgs,
      taskContext,
      verdict: nonInterferenceVerdict,
      readPage: (readArgs) => handleToolCall(TOOL_NAMES.BROWSER.READ_PAGE, readArgs),
    });
    if (autoFreshReadback.retryVerdict) {
      nonInterferenceVerdict = autoFreshReadback.retryVerdict;
    }
    if (!nonInterferenceVerdict.allowed) {
      const taskResumeHandoff =
        nonInterferenceVerdict.audit.taskResumeReadiness?.handoffSummary ?? null;
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
          ...(taskResumeHandoff
            ? {
                taskResumeHandoffStatus: taskResumeHandoff.status,
                taskResumeHandoffNextAction: taskResumeHandoff.nextAction,
                taskResumeCanContinue: taskResumeHandoff.canContinue,
              }
            : {}),
        },
        ...(autoFreshReadback.attempted
          ? {
              autoFreshReadback: {
                attempted: true,
                status: autoFreshReadback.status,
                tabId: autoFreshReadback.tabId,
                retryReason: autoFreshReadback.retryVerdict?.audit.reason ?? null,
                claimBoundary:
                  'automatic fresh readback only refreshes runtime evidence; it does not prove business success',
              },
            }
          : {}),
        ...(taskResumeHandoff ? { taskResumeHandoff } : {}),
        runtimePolicyAudit: nonInterferenceVerdict.audit,
      };
      const result = attachTaskContextEnvelopeToJsonResult(
        createErrorResult(JSON.stringify(payload)),
        taskContextAttachment,
      );
      return finishAndRecordToolCallResult({
        sessionManager,
        sessionId: session.sessionId,
        stepId: step.stepId,
        step: {
          status: 'failed',
          errorCode: 'non_interference_blocked',
          resultSummary: `${name} blocked by non-interference policy`,
          operationLog: {
            decisionReason: nonInterferenceVerdict.audit.reason,
            metadata: {
              decisionReason: nonInterferenceVerdict.audit.reason,
              actionOutcome: 'blocked',
              executionMode: 'non_interference_policy',
              ...(taskResumeHandoff
                ? {
                    taskResumeHandoffStatus: taskResumeHandoff.status,
                    taskResumeHandoffNextAction: taskResumeHandoff.nextAction,
                    taskResumeCanContinue: taskResumeHandoff.canContinue,
                  }
                : {}),
            },
          },
        },
        session: {
          status: 'failed',
          summary: `${name} blocked by non-interference policy`,
        },
        result,
        recordTrace: recordAndAttachMkeMemoryTrace,
        trace: {
          requestParams: outgoingArgs,
          resultSummary: `${name} blocked by non-interference policy`,
          errorCode: 'non_interference_blocked',
          browserContextKey: taskContextAttachment.taskContextKey,
        },
      });
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
    // default `'L0+L1'`) with the clamped fallback entry layer (`L0`
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
          const actionId = extractPostActionIdFromCallToolResult(response.data);
          const claim = actionId
            ? {
                aiRunId: actionId,
                aiClaimId: `navigate_${returnedTabId}`,
                aiClaimState: 'claimed' as const,
                aiClaimedAtMs: Date.now(),
                aiClaimReason: 'native_background_navigation_claim',
              }
            : null;
          taskContext.noteRunOwnedTab(returnedTabId, claim);
          sessionManager
            .getOrCreateExternalTaskContext(`mcp:auto:tab:${returnedTabId}`)
            .noteRunOwnedTab(returnedTabId, claim);
        }
      }
      if (taskContext && name === TOOL_NAMES.BROWSER.WEB_FETCHER) {
        const returnedTabId = extractTabIdFromCallToolResult(response.data);
        const explicitTabId = readPositiveInteger(args, 'tabId');
        const createdTabForUrl = extractCreatedTabForUrlFromCallToolResult(response.data);
        if (returnedTabId !== null && explicitTabId === null && createdTabForUrl) {
          taskContext.noteRunOwnedTab(returnedTabId);
          sessionManager
            .getOrCreateExternalTaskContext(`mcp:auto:tab:${returnedTabId}`)
            .noteRunOwnedTab(returnedTabId);
        }
      }
      if (shouldInvalidateReadAfterWindowFocusChange(name, outgoingArgs)) {
        sessionManager.noteWindowFocusMayHaveChangedForExternalTaskContexts({
          action: name,
          sourceExternalKey: externalTaskKeyEarly,
          tabId: readPositiveInteger(outgoingArgs, 'tabId'),
        });
      }
      const postProcessorRawResult = ensureStructuredLegacyActionResult(name, response.data, args);
      if (
        taskContext &&
        shouldRecordPageInteractionAfterResult(name, args, postProcessorRawResult)
      ) {
        const candidateActionMetadata = readCandidateActionMetadata(args);
        taskContext.notePageInteraction({
          action: name,
          tabId: readPositiveInteger(args, 'tabId'),
          changeCause: inferPageInteractionChangeCause(name, postProcessorRawResult),
          targetRefs: readInteractionTargetRefs(args),
          candidateActionId: candidateActionMetadata.candidateActionId,
          candidateActionIntent: candidateActionMetadata.candidateActionIntent,
          actionKind: inferActionKindForToolName(name),
        });
      }
      const postResult = runPostProcessor({
        toolName: name,
        rawResult: postProcessorRawResult,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager,
        taskContext: taskContextEarly,
        args,
      });
      let rawResultWithEvidence = withFallbackEvidence(postResult.rawResult, apiFallbackEvidence);
      let readPageRecorded = false;
      if (
        name === 'chrome_read_page' &&
        rawResultWithEvidence.isError !== true &&
        readPositiveInteger(args, 'tabId') !== null
      ) {
        const requestedTabId = readPositiveInteger(args, 'tabId')!;
        const targetBinding = evaluateReadPageTargetBinding(rawResultWithEvidence, requestedTabId);
        if (targetBinding.verdict === 'mismatch') {
          const payload = {
            ok: false,
            code: 'TABRIX_READ_PAGE_TARGET_MISMATCH',
            message:
              'chrome_read_page returned evidence for a different tab than the explicit requested tabId; refusing to treat this as a valid page read.',
            targetBinding,
          };
          const mismatchResult = attachTaskContextEnvelopeToJsonResult(
            createErrorResult(JSON.stringify(payload)),
            taskContextAttachment,
            {
              stripReadPageDiagnostics: !shouldIncludeVerboseReadPageContext(
                args,
                extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER,
              ),
            },
          );
          return finishAndRecordToolCallResult({
            sessionManager,
            sessionId: session.sessionId,
            stepId: step.stepId,
            step: {
              status: 'failed',
              errorCode: 'read_page_target_mismatch',
              resultSummary: 'chrome_read_page blocked because returned target did not match tabId',
              operationLog: {
                decisionReason: 'read_page_target_mismatch',
                metadata: {
                  actionOutcome: 'blocked',
                  executionMode: 'runtime_truth_target_binding',
                },
              },
            },
            session: {
              status: 'failed',
              summary: 'chrome_read_page blocked because returned target did not match tabId',
            },
            result: mismatchResult,
            recordTrace: recordAndAttachMkeMemoryTrace,
            trace: {
              requestParams: outgoingArgs,
              resultSummary: 'chrome_read_page blocked because returned target did not match tabId',
              errorCode: 'read_page_target_mismatch',
              browserContextKey: taskContextAttachment.taskContextKey,
            },
          });
        }
      }
      if (name === 'chrome_read_page' && taskContext && rawResultWithEvidence.isError !== true) {
        const readPagePayload = readJsonObjectFromCallToolResult(rawResultWithEvidence);
        const visibleRows =
          taskContext.peekVisibleRegionRows() ??
          extractVisibleRegionRowsDataFromPayload(readPagePayload);
        if (visibleRows) {
          taskContext.noteVisibleRegionRows(visibleRows);
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
          const topNAccumulationEvidence = shouldRecordDomRegionRowsReadback(visibleRows)
            ? taskContext.noteDomRegionRowsReadback(visibleRows)
            : null;

          if (
            readPageRenderMode !== 'markdown' &&
            routerDecision.selectedDataSource === 'dom_region_rows'
          ) {
            readPageRecorded = recordSuccessfulReadPageCall({
              alreadyRecorded: readPageRecorded,
              toolName: name,
              taskContext,
              rawResult: postResult.rawResult,
              args,
              forcedReadPageLayer,
              source: 'dom_region_rows',
              targetRefs: visibleRows.rows
                .map((row) => row.targetRef)
                .filter((ref): ref is string => typeof ref === 'string' && ref.length > 0),
            });
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
              topNAccumulationEvidence,
            });
            const compatDomRowsResult = mergeReadPagePayloadMetadata(
              rawResultWithEvidence,
              domRowsResult,
              { omitFullPageContent: true },
            );
            const aiFacingDomRowsResult = attachAiFacingDeltaContext(
              compatDomRowsResult,
              taskContextAttachment,
              {
                readStartedAtMs: toolCallStartedAtMs,
                includeAiContextEnvelope: shouldIncludeVerboseReadPageContext(
                  outgoingArgs,
                  requestedLayer,
                ),
              },
            );
            return finishAndRecordToolCallResult({
              sessionManager,
              sessionId: session.sessionId,
              stepId: step.stepId,
              step: {
                status: 'completed',
                resultSummary: 'chrome_read_page fulfilled via visible DOM region rows',
                artifactRefs:
                  postResult.extraArtifactRefs.length > 0
                    ? postResult.extraArtifactRefs
                    : undefined,
                operationLog,
              },
              session: {
                status: 'completed',
                summary: 'chrome_read_page fulfilled via visible DOM region rows',
              },
              result: aiFacingDomRowsResult,
              recordTrace: recordAndAttachMkeMemoryTrace,
              trace: {
                requestParams: outgoingArgs,
                resultSummary: 'chrome_read_page fulfilled via visible DOM region rows',
                browserContextKey: taskContextAttachment.taskContextKey,
              },
            });
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
                    topNAccumulationEvidence,
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
      readPageRecorded = recordSuccessfulReadPageCall({
        alreadyRecorded: readPageRecorded,
        toolName: name,
        taskContext,
        rawResult: postResult.rawResult,
        args,
        forcedReadPageLayer,
        source: 'unknown',
      });
      if (name === 'chrome_close_tabs' && taskContext && rawResultWithEvidence.isError !== true) {
        recordCloseTabsSuccessPostprocess({
          args: outgoingArgs,
          result: rawResultWithEvidence,
          taskContext,
          sessionManager,
          primaryTabController,
          startedAtMs: toolCallStartedAtMs,
          endedAtMs: Date.now(),
        });
      }
      const aiFacingResult =
        name === 'chrome_read_page' && taskContext
          ? attachAiFacingDeltaContext(rawResultWithEvidence, taskContextAttachment, {
              readStartedAtMs: toolCallStartedAtMs,
              includeAiContextEnvelope: shouldIncludeVerboseReadPageContext(
                outgoingArgs,
                extractRequestedLayer(outgoingArgs) ?? READ_PAGE_DEFAULT_LAYER,
              ),
            })
          : name === 'chrome_read_page' &&
              !shouldIncludeVerboseReadPageContext(
                outgoingArgs,
                extractRequestedLayer(outgoingArgs) ?? READ_PAGE_DEFAULT_LAYER,
              )
            ? stripReadPageDiagnosticNoiseFromJsonResult(rawResultWithEvidence)
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
      maybeRecordStructuredReadGateLifecycleArtifact({
        name,
        args,
        result: aiFacingResult,
        startedAtMs: toolCallStartedAtMs,
        endedAtMs: Date.now(),
      });
      const resultWithPolicyAudit = isImpactToolName(name)
        ? attachRuntimePolicyAuditToResult(aiFacingResult, nonInterferenceVerdict.audit)
        : aiFacingResult;
      const resultWithPolicyAndActionEvidence = ensureStructuredLegacyActionResult(
        name,
        resultWithPolicyAudit,
        args,
      );
      const normalized = normalizeToolCallResult(name, resultWithPolicyAndActionEvidence);
      const toolResultFailed = resultWithPolicyAndActionEvidence.isError === true;
      const finalToolResultBase =
        name === 'chrome_read_page' &&
        !shouldIncludeVerboseReadPageContext(
          outgoingArgs,
          extractRequestedLayer(outgoingArgs) ?? READ_PAGE_DEFAULT_LAYER,
        )
          ? stripReadPageDiagnosticNoiseFromJsonResult(resultWithPolicyAndActionEvidence)
          : resultWithPolicyAndActionEvidence;
      const finalToolResult =
        name === 'chrome_read_page'
          ? attachObjectLibraryHintsToReadPageResult(
              finalToolResultBase,
              sessionManager.browserObjects,
              (errorMessage) => {
                logger.debug('mcp.register-tools', 'object library hint lookup failed', {
                  errorMessage,
                });
              },
            )
          : finalToolResultBase;
      return finishAndRecordToolCallResult({
        sessionManager,
        sessionId: session.sessionId,
        stepId: step.stepId,
        step: {
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
        },
        session: {
          status: 'completed',
          summary: normalized.executionResult.summary,
        },
        result: finalToolResult,
        recordTrace: recordAndAttachMkeMemoryTrace,
        trace: {
          requestParams: outgoingArgs,
          resultSummary: normalized.stepSummary,
          errorCode: toolResultFailed ? 'tool_result_error' : null,
          browserContextKey: taskContextAttachment.taskContextKey,
        },
      });
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
      const errorCode = bridgeFailure
        ? bridgeFailure.code.toLowerCase()
        : isBridgeError
          ? 'browser_bridge_not_ready'
          : 'tool_call_error';
      return finishAndRecordToolCallResult({
        sessionManager,
        sessionId: session.sessionId,
        stepId: step.stepId,
        step: {
          status: 'failed',
          errorCode,
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
        },
        session: {
          status: 'failed',
          summary: `Tool ${name} failed`,
        },
        result,
        recordTrace: recordAndAttachMkeMemoryTrace,
        trace: {
          requestParams: outgoingArgs,
          resultSummary: `Tool ${name} failed`,
          errorCode,
          browserContextKey: taskContextAttachment.taskContextKey,
        },
      });
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
    return finishAndRecordToolCallResult({
      sessionManager,
      sessionId: session.sessionId,
      stepId: step.stepId,
      step: {
        status: 'failed',
        errorCode: 'tool_call_exception',
        errorSummary: error.message,
        resultSummary: `Tool ${name} threw an exception`,
      },
      session: {
        status: 'failed',
        summary: `Tool ${name} threw an exception`,
      },
      result,
      recordTrace: recordAndAttachMkeMemoryTrace,
      trace: {
        resultSummary: `Tool ${name} threw an exception`,
        errorCode: 'tool_call_exception',
      },
    });
  }
};
