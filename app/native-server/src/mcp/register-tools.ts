import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  CallToolResult,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import nativeMessagingHostInstance from '../native-messaging-host';
import {
  NativeMessageType,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  buildActionEvidenceResult,
  buildPostActionDeltaEvidence,
  buildReadPageBrowserPageObjectView,
} from '@tabrix/shared';
import type { LifecycleEvidenceBrowserHygieneCheck } from '@tabrix/shared';
import type { BuildPostActionDeltaEvidenceInput, PostActionDeltaEvidence } from '@tabrix/shared';
import type { ReadPageObjectLifecycleSummary } from '@tabrix/shared';
import type { ReadPageObjectLibraryHint } from '@tabrix/shared';
import type { SemanticSignal } from '@tabrix/shared';
import { isToolAllowedByPolicy } from '../policy/phase0-opt-in';
import {
  attachRuntimePolicyAuditToResult,
  evaluateNonInterferencePreflight,
  isImpactToolName,
  type NonInterferencePreflightVerdict,
} from '../policy/non-interference-preflight';
import { sessionManager } from '../execution/session-manager';
import type {
  TaskAuthResumeGate,
  TaskPageInteractionSnapshot,
  TaskPageRuntimeFields,
  TaskReadPageContextMeasurement,
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
  extractClosedTabIdsFromCallToolResult,
  extractCreatedTabForUrlFromCallToolResult,
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
  filterToolsByEnvironment,
  filterToolsByPolicy,
  isToolAllowed,
} from './tool-registry-filters';
import {
  attachTabrixMemoryTraceEnvelope,
  readTabrixToolMetadata,
  stripTabrixToolMetadata,
  withTabrixMetadataSchema,
} from './tabrix-metadata-envelope';
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
import {
  inferRegionStatePostconditionKindForIntent,
  verifyRegionStatePostcondition,
  type RegionStatePostconditionResult,
} from '../runtime/action-postcondition-verifier';
import {
  produceToolCloseoutLifecycleEvidenceArtifact,
  produceToolFailureLifecycleEvidenceArtifact,
  produceUnifiedTaskCloseoutLifecycleEvidenceArtifact,
} from '../runtime/lifecycle-evidence-collector';
import {
  classifySourceRouteHonesty,
  type SourceRouteHonestyResult,
} from '../runtime/source-route-honesty';
import type {
  BrowserDataSourceDecisionEvidence,
  BrowserPageChangeCause,
  BrowserPageOwnerType,
  BrowserPageThingProjection,
  ReadPageBrowserPageObjectCompactView,
  BrowserSourceLineage,
  BrowserSourceFreshness,
  BrowserSourceTruthChain,
  BrowserTaskStateVerdict,
  ActionKind,
  ReadPageAuthResumeVerification,
  ReadPageCandidateActionIntent,
  ReadPageCompactSnapshot,
  ReadPageMode,
  ReadPageRequestedLayer,
  ReadPageOwnershipRuntimeSummary,
  ReadPageWindowRuntimeState,
  ReadPageOperationMap,
  ReadPageRegion,
  ReadPageSelectedDataSource,
  SourceTruthOrigin,
} from '@tabrix/shared';
import { buildBrowserTaskStateVerdict } from '@tabrix/shared';
import type { MemoryTrace } from '../memory/db';

const DEFAULT_AUTO_TASK_CONTEXT_KEY = 'mcp:auto:tab:default';
const TOOL_FAILURE_ARTIFACT_SCENARIO_ID = 'mcp:chrome_read_page:page_unreadable';
const TOOL_CLOSEOUT_ARTIFACT_SCENARIO_ID = 'mcp:chrome_close_tabs:cleanup_success';
const STRUCTURED_READ_GATE_ARTIFACT_SCENARIO_ID = 'mcp:chrome_read_page:structured_read_gate';
const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

type TaskContextKeySource = 'external_task_key' | 'internal_task_id';

interface TaskContextAttachment {
  toolName: string;
  taskContext: TaskSessionContext | null;
  taskContextKey: string;
  taskContextKeySource: TaskContextKeySource;
}

interface CloseTabsBrowserSnapshot {
  tabCount: number;
  windowCount: number;
  focusedWindowId: number | null;
  activeTabId: number | null;
}

interface CloseTabsBrowserHygieneEvidence {
  before: CloseTabsBrowserSnapshot;
  after: CloseTabsBrowserSnapshot;
  tabWindowBaselineUnchanged: boolean | null;
  activeTabRestored: boolean | null;
  activeTabRestoreReason: string | null;
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
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const byEnv = filterToolsByEnvironment(TOOL_SCHEMAS);
    const byPolicy = filterToolsByPolicy(byEnv);
    return {
      tools: byPolicy.map(withTabrixMetadataSchema),
    };
  });

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
  const applyPreviousBusinessFeedback = (): void => {
    if (tabrixMetadata.previousFeedback.length === 0) return;
    const traceWriter = sessionManager.memoryTraces;
    if (!traceWriter) return;
    let feedbackRecorded = false;
    for (const feedback of tabrixMetadata.previousFeedback) {
      try {
        traceWriter.recordAiBusinessFeedback({
          traceId: feedback.traceId,
          taskId: feedback.taskId,
          toolName: feedback.toolName,
          toolCallId: feedback.toolCallId,
          sequenceIndex: feedback.sequenceIndex,
          traceBindingHash: feedback.feedbackToken,
          evaluationScope: feedback.evaluationScope,
          businessStatus: feedback.businessStatus,
          confidence: feedback.confidence,
          reasonCode: feedback.reasonCode,
          summary: feedback.summary,
          receivedAt: new Date(toolCallStartedAtMs).toISOString(),
          sourceToolName: name,
          sourceToolCallId: step.stepId,
        });
        feedbackRecorded = true;
      } catch (feedbackError) {
        const message =
          feedbackError instanceof Error ? feedbackError.message : String(feedbackError);
        mkeMemoryTraceLogger.warn('ai feedback update failed', { errorMessage: message });
      }
    }
    if (feedbackRecorded) sessionManager.scheduleMkeProjectionAfterAiFeedback();
  };
  const recordMkeMemoryTrace = (
    result: CallToolResult,
    input?: {
      requestParams?: unknown;
      resultSummary?: string | null;
      errorCode?: string | null;
      browserContextKey?: string | null;
    },
  ): MemoryTrace | null => {
    const traceWriter = sessionManager.memoryTraces;
    if (!traceWriter) return null;
    try {
      return traceWriter.recordToolCall({
        taskId: task.taskId,
        taskIntent,
        aiClient: session.clientName,
        toolName: name,
        stepId: step.stepId,
        sequenceIndex: step.index,
        requestParams: input?.requestParams ?? args,
        requestAtMs: toolCallStartedAtMs,
        responseAtMs: Date.now(),
        result,
        resultSummary: input?.resultSummary ?? null,
        errorCode: input?.errorCode ?? null,
        browserContextKey: input?.browserContextKey ?? null,
      });
    } catch (traceError) {
      const message = traceError instanceof Error ? traceError.message : String(traceError);
      mkeMemoryTraceLogger.warn('write failed', { errorMessage: message });
    }
    return null;
  };
  const recordAndAttachMkeMemoryTrace = (
    result: CallToolResult,
    input?: {
      requestParams?: unknown;
      resultSummary?: string | null;
      errorCode?: string | null;
      browserContextKey?: string | null;
    },
  ): CallToolResult => {
    const trace = recordMkeMemoryTrace(result, input);
    if (trace) sessionManager.scheduleMkeProjectionAfterTrace();
    return attachTabrixMemoryTraceEnvelope(result, trace, tabrixMetadata, name);
  };

  try {
    applyPreviousBusinessFeedback();
    const allowedTools = filterToolsByEnvironment(TOOL_SCHEMAS);

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
    // `mcp/native-tool-handlers.ts`.
    const nativeHandler = getNativeToolHandler(name);
    if (nativeHandler) {
      const nativeResult = await nativeHandler(args, {
        sessionManager,
        // Carries the `TaskSessionContext` the `tabrix_choose_context`
        // handler writes into via `noteChooseContextDecision`. `null`
        // for tools outside the auto-key set when there is no live
        // external context.
        taskContext: taskContextEarly,
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
        const finalApiCallResult = shouldIncludeVerboseReadPageContext(
          args,
          extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER,
        )
          ? apiCallResult
          : stripReadPageDiagnosticNoiseFromJsonResult(apiCallResult);
        return recordAndAttachMkeMemoryTrace(finalApiCallResult, {
          requestParams: outgoingArgs,
          resultSummary: 'chrome_read_page fulfilled via current-task observed API data',
          browserContextKey: taskContextAttachment.taskContextKey,
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
              return recordAndAttachMkeMemoryTrace(apiCallResult, {
                requestParams: outgoingArgs,
                resultSummary: `chrome_read_page fulfilled via ${skipPlan.sourceKind} (saved ~${tokenSavings.tokensSavedEstimate} tok)`,
                browserContextKey: taskContextAttachment.taskContextKey,
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
            sessionManager.completeStep(session.sessionId, step.stepId, {
              status: 'completed',
              resultSummary: `chrome_read_page skipped via ${skipPlan.sourceKind} (saved ~${skipPlan.tokensSavedEstimate} tok)`,
              operationLog,
            });
            sessionManager.finishSession(session.sessionId, {
              status: 'completed',
              summary: `chrome_read_page skipped via ${skipPlan.sourceKind}`,
            });
            return recordAndAttachMkeMemoryTrace(skipResult, {
              requestParams: outgoingArgs,
              resultSummary: `chrome_read_page skipped via ${skipPlan.sourceKind} (saved ~${skipPlan.tokensSavedEstimate} tok)`,
              browserContextKey: taskContextAttachment.taskContextKey,
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
        sessionManager.completeStep(session.sessionId, step.stepId, {
          status: 'completed',
          resultSummary: normalizedWarning.stepSummary,
          operationLog,
        });
        sessionManager.finishSession(session.sessionId, {
          status: 'completed',
          summary: normalizedWarning.executionResult.summary,
        });
        const finalWarningResult = cachedProjection
          ? attachAiFacingOwnershipRuntime(warningResult, taskContextAttachment, {
              includeAiContextEnvelope: shouldIncludeVerboseReadPageContext(args, requestedLayer),
            })
          : attachTaskContextEnvelopeToJsonResult(warningResult, taskContextAttachment, {
              stripReadPageDiagnostics: !shouldIncludeVerboseReadPageContext(args, requestedLayer),
            });
        return recordAndAttachMkeMemoryTrace(finalWarningResult, {
          requestParams: outgoingArgs,
          resultSummary: normalizedWarning.stepSummary,
          errorCode: decision.reason ?? 'read_page_warning',
          browserContextKey: taskContextAttachment.taskContextKey,
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
            ...(taskResumeHandoff
              ? {
                  taskResumeHandoffStatus: taskResumeHandoff.status,
                  taskResumeHandoffNextAction: taskResumeHandoff.nextAction,
                  taskResumeCanContinue: taskResumeHandoff.canContinue,
                }
              : {}),
          },
        },
      });
      sessionManager.finishSession(session.sessionId, {
        status: 'failed',
        summary: `${name} blocked by non-interference policy`,
      });
      return recordAndAttachMkeMemoryTrace(result, {
        requestParams: outgoingArgs,
        resultSummary: `${name} blocked by non-interference policy`,
        errorCode: 'non_interference_blocked',
        browserContextKey: taskContextAttachment.taskContextKey,
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
          taskContext.noteRunOwnedTab(returnedTabId);
          sessionManager
            .getOrCreateExternalTaskContext(`mcp:auto:tab:${returnedTabId}`)
            .noteRunOwnedTab(returnedTabId);
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
          sessionManager.completeStep(session.sessionId, step.stepId, {
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
          });
          sessionManager.finishSession(session.sessionId, {
            status: 'failed',
            summary: 'chrome_read_page blocked because returned target did not match tabId',
          });
          return recordAndAttachMkeMemoryTrace(mismatchResult, {
            requestParams: outgoingArgs,
            resultSummary: 'chrome_read_page blocked because returned target did not match tabId',
            errorCode: 'read_page_target_mismatch',
            browserContextKey: taskContextAttachment.taskContextKey,
          });
        }
      }
      const recordSuccessfulReadPage = (
        source: 'unknown' | 'dom_region_rows',
        targetRefs?: ReadonlyArray<string> | null,
      ): void => {
        if (readPageRecorded || name !== 'chrome_read_page' || !taskContext) return;
        if (postResult.rawResult.isError === true) return;
        const requestedLayer =
          forcedReadPageLayer ?? extractRequestedLayer(args) ?? READ_PAGE_DEFAULT_LAYER;
        const readPageRequestKey = buildReadPageRequestKey(args, requestedLayer);
        taskContext.noteReadPage({
          layer: requestedLayer,
          source,
          requestKey: readPageRequestKey,
          targetRefs,
          contextMeasurement: buildReadPageContextMeasurement(
            readJsonObjectFromCallToolResult(postResult.rawResult),
            requestedLayer,
          ),
        });
        readPageRecorded = true;
      };
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
            return recordAndAttachMkeMemoryTrace(aiFacingDomRowsResult, {
              requestParams: outgoingArgs,
              resultSummary: 'chrome_read_page fulfilled via visible DOM region rows',
              browserContextKey: taskContextAttachment.taskContextKey,
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
      recordSuccessfulReadPage('unknown');
      if (name === 'chrome_close_tabs' && taskContext && rawResultWithEvidence.isError !== true) {
        const closedTabIds = extractClosedTabIdsFromCallToolResult(rawResultWithEvidence);
        const invalidTabIds = extractInvalidTabIdsFromCallToolResult(rawResultWithEvidence);
        recordPrimaryTabCleanupOutcome({ closedTabIds, primaryTabController });
        for (const closedTabId of closedTabIds) {
          taskContext.releaseRunOwnedTab(closedTabId);
          sessionManager.releaseExternalTaskContext(buildAutoTabTaskContextKey(closedTabId));
        }
        for (const invalidTabId of invalidTabIds) {
          taskContext.releaseRunOwnedTab(invalidTabId);
          sessionManager.releaseExternalTaskContext(buildAutoTabTaskContextKey(invalidTabId));
        }
        taskContext.noteCleanup({
          action: 'chrome_close_tabs',
          targetIds: readNumericArray(args, 'tabIds'),
        });
        maybeRecordCloseTabsSuccessLifecycleArtifact({
          args,
          result: rawResultWithEvidence,
          closedTabIds,
          invalidTabIds,
          taskContext,
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
          ? attachObjectLibraryHintsToReadPageResult(finalToolResultBase)
          : finalToolResultBase;
      return recordAndAttachMkeMemoryTrace(finalToolResult, {
        requestParams: outgoingArgs,
        resultSummary: normalized.stepSummary,
        errorCode: toolResultFailed ? 'tool_result_error' : null,
        browserContextKey: taskContextAttachment.taskContextKey,
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
      return recordAndAttachMkeMemoryTrace(result, {
        requestParams: outgoingArgs,
        resultSummary: `Tool ${name} failed`,
        errorCode: bridgeFailure
          ? bridgeFailure.code.toLowerCase()
          : isBridgeError
            ? 'browser_bridge_not_ready'
            : 'tool_call_error',
        browserContextKey: taskContextAttachment.taskContextKey,
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
    return recordAndAttachMkeMemoryTrace(result, {
      resultSummary: `Tool ${name} threw an exception`,
      errorCode: 'tool_call_exception',
    });
  }
};

type AutoFreshReadbackStatus = 'not_applicable' | 'verified' | 'still_blocked' | 'read_failed';

interface AutoFreshReadbackOutcome {
  attempted: boolean;
  status: AutoFreshReadbackStatus;
  tabId: number | null;
  retryVerdict: NonInterferencePreflightVerdict | null;
}

async function maybeRunAutoTaskFreshReadbackBeforeImpact(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  verdict: NonInterferencePreflightVerdict;
}): Promise<AutoFreshReadbackOutcome> {
  const tabId = getAutoFreshReadbackTabId(input);
  if (tabId === null) {
    return { attempted: false, status: 'not_applicable', tabId: null, retryVerdict: null };
  }

  const readResult = await handleToolCall(TOOL_NAMES.BROWSER.READ_PAGE, {
    tabId,
    forceRefresh: true,
    requestedLayer: 'L0+L1',
  });
  if (readResult.isError === true) {
    return { attempted: true, status: 'read_failed', tabId, retryVerdict: null };
  }

  const retryVerdict = evaluateNonInterferencePreflight({
    toolName: input.toolName,
    args: input.args,
    taskContext: input.taskContext,
  });
  return {
    attempted: true,
    status: retryVerdict.allowed ? 'verified' : 'still_blocked',
    tabId,
    retryVerdict,
  };
}

function getAutoFreshReadbackTabId(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  verdict: NonInterferencePreflightVerdict;
}): number | null {
  if (input.verdict.allowed) return null;
  if (input.taskContext === null) return null;
  if (hasExplicitTaskContextKey(input.args)) return null;
  if (hasImpactUserConfirmation(input.args)) return null;
  if (!isAutoFreshReadbackInteractionTool(input.toolName)) return null;
  if (input.verdict.audit.verdict !== 'collaboration_required') return null;
  if (
    input.verdict.audit.reason !== 'auth_resume_verification_required' &&
    input.verdict.audit.reason !== 'task_resume_readiness_not_proven'
  ) {
    return null;
  }

  const readiness = input.verdict.audit.taskResumeReadiness;
  const handoff = readiness?.handoffSummary;
  if (readiness?.nextStep !== 'force_fresh_read_same_tab') return null;
  if (handoff?.nextAction !== 'run_chrome_read_page_force_refresh') return null;

  const targetTabId =
    input.verdict.audit.targetTabId ??
    readiness?.tabId ??
    input.verdict.audit.authResumeGate?.targetTabId ??
    null;
  return typeof targetTabId === 'number' && Number.isInteger(targetTabId) && targetTabId > 0
    ? targetTabId
    : null;
}

function isAutoFreshReadbackInteractionTool(toolName: string): boolean {
  return (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD
  );
}

function hasExplicitTaskContextKey(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  return ['taskSessionId', 'taskId', 'clientTaskId'].some((key) => {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function hasImpactUserConfirmation(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  return (
    record.userConfirmed === true ||
    record.allowUserTabImpact === true ||
    record.riskAccepted === true
  );
}

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

function ensureStructuredLegacyActionResult(
  toolName: string,
  result: CallToolResult,
  args?: unknown,
): CallToolResult {
  if (toolName !== TOOL_NAMES.BROWSER.CLICK) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;
  let structuredPayload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(first.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structuredPayload = parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through and wrap the legacy text result.
  }
  if (structuredPayload) {
    if (readObject(structuredPayload.actionEvidenceResult)) return result;
    const resultShape = readString(structuredPayload.resultShape);
    if (
      resultShape !== 'legacy_text_error_normalized' &&
      resultShape !== 'legacy_text_normalized'
    ) {
      return result;
    }
  }

  const legacyWasError =
    readString(structuredPayload?.resultShape) === 'legacy_text_error_normalized' ||
    (result as { isError?: boolean }).isError === true;
  const input = readObject(args);
  const requestedTargetRef =
    readSafeTargetRef(input?.ref) ??
    readSafeTargetRef(readObject(input?.candidateAction)?.targetRef);
  const dispatchTarget =
    requestedTargetRef !== null
      ? 'ref'
      : readString(input?.selector) !== null
        ? 'selector'
        : readObject(input?.coordinates)
          ? 'coordinates'
          : 'unknown';
  const actionKind = readString(input?.interaction) === 'hover' ? 'hover' : 'click';
  const actionEvidenceResult = buildActionEvidenceResult({
    actionId: legacyWasError
      ? 'mcp:chrome_click_element:legacy_text_error_normalized'
      : 'mcp:chrome_click_element:legacy_text_normalized',
    actionKind,
    tabId: readPositiveInteger(input, 'tabId'),
    toolSuccess: !legacyWasError,
    targetBinding: {
      requestedTargetRef,
      resolvedTargetRef: null,
      dispatchTarget,
      targetBindingProven: false,
      claimBoundary:
        'Legacy text click normalization cannot prove final target binding; use structured click output or fresh readback.',
    },
    dispatch: {
      dispatched: !legacyWasError,
      acceptedByBrowser: !legacyWasError,
      errorCode: legacyWasError ? 'legacy_text_error_normalized' : null,
    },
    source: {
      selectedDataSource: 'unknown',
      sourceRouteHonestyVerdict: 'not_checked',
      fallbackUsed: null,
    },
    postAction: {
      postActionReadbackStatus: legacyWasError ? 'not_available' : 'required',
      postconditionVerdict: 'unknown',
      freshReadRequired: !legacyWasError,
      readbackSource: null,
    },
    business: {
      businessSuccessVerdict: 'not_proven',
      businessSuccessProven: false,
      negativeEvidence: legacyWasError
        ? ['legacy_text_error_without_structured_dispatch']
        : ['legacy_text_result_without_structured_postcondition'],
      nextRequiredCheck: legacyWasError ? 'fix_target_or_retry_with_fresh_refs' : 'fresh_read_page',
    },
    browserHygiene: {
      required: false,
      status: 'not_checked',
      leakedTabsOrWindows: null,
    },
  });
  const payload = structuredPayload
    ? { ...structuredPayload, actionEvidenceResult }
    : {
        success: false,
        dispatchSucceeded: !legacyWasError,
        observedOutcome: legacyWasError ? 'no_observed_change' : 'verification_unavailable',
        verification: {
          navigationOccurred: false,
          urlChanged: false,
          newTabOpened: false,
          domChanged: false,
          stateChanged: false,
          focusChanged: false,
        },
        clickDiff: { kind: 'unknown' },
        navigationOccurred: false,
        lane: 'tabrix_owned',
        message: legacyWasError
          ? 'Legacy text click error was normalized; click dispatch and post-action state are not proven'
          : 'Legacy text click result was normalized; post-action state is not proven without structured click signals or a follow-up read',
        clickMethod: 'unknown',
        resultShape: legacyWasError ? 'legacy_text_error_normalized' : 'legacy_text_normalized',
        rawTextLength: first.text.length,
        actionEvidenceResult,
      };

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
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
    actionKind: 'read',
    tabId,
    reason: 'page_unreadable',
    observedOutcome: 'unknown',
    observedOutcomeConfidence: 0.85,
    semanticSignals: [
      {
        signalId: `sig_error_page_detected_mcp-read-failure-${input.startedAtMs}-${tabId}`,
        kind: 'error_page_detected',
        confidence: 0.9,
        tabId,
        urlPattern: null,
        sourceEventRefs: [
          {
            streamEventId: `mcp-read-failure-${input.startedAtMs}-${tabId}`,
            eventKind: 'observation_unknown',
            sourceObservationKind: null,
            observedAtMs: input.endedAtMs,
          },
        ],
        sourceOrigins: ['runtime_inference'],
        producedAtMs: input.endedAtMs,
      } satisfies SemanticSignal,
    ],
  });
}

function maybeRecordStructuredReadGateLifecycleArtifact(input: {
  name: string;
  args: unknown;
  result: CallToolResult;
  startedAtMs: number;
  endedAtMs: number;
}): void {
  if (input.name !== 'chrome_read_page') return;
  const payload = readJsonObjectFromCallToolResult(input.result);
  if (!payload) return;
  const structuredReadGate = readObject(payload.structuredReadGate);
  if (!structuredReadGate) return;
  const verdict = readString(structuredReadGate.verdict);
  if (!verdict) return;
  if (!isActionableStructuredReadIncompleteVerdict(verdict)) return;
  const reasonCode = readString(structuredReadGate.reasonCode) ?? `structured_read_${verdict}`;
  const projection = readObject(payload.pageProjection);
  const tabId =
    readPositiveInteger(input.args, 'tabId') ??
    (projection ? readPositiveInteger(projection, 'tabId') : null) ??
    readPositiveInteger(payload, 'tabId');
  if (tabId === null) return;
  const reason = `structured_read_incomplete:${reasonCode}`;

  produceToolFailureLifecycleEvidenceArtifact({
    artifactId: `mcp-structured-read-gate-${input.startedAtMs}-${tabId}`,
    evidenceLevel: 'integration',
    scenarioId: STRUCTURED_READ_GATE_ARTIFACT_SCENARIO_ID,
    scenarioClass: 'long_content_structured_read_gate_v1',
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    actionId: `mcp:chrome_read_page:structured_read_gate:${tabId}:${input.startedAtMs}`,
    actionKind: 'read',
    tabId,
    reason,
    observedOutcome: 'unknown',
    observedOutcomeConfidence: 0.8,
  });
}

function isActionableStructuredReadIncompleteVerdict(verdict: string): boolean {
  return (
    verdict === 'summary_only' ||
    verdict === 'coverage_insufficient' ||
    verdict === 'mode_insufficient' ||
    verdict === 'structure_sparse'
  );
}

function maybeRecordCloseTabsSuccessLifecycleArtifact(input: {
  args: unknown;
  result: unknown;
  closedTabIds: number[];
  invalidTabIds: number[];
  taskContext?: TaskSessionContext | null;
  startedAtMs: number;
  endedAtMs: number;
}): void {
  const targetTabIds = readNumericArray(input.args, 'tabIds') ?? [];
  const tabId = input.closedTabIds[0] ?? input.invalidTabIds[0] ?? targetTabIds[0] ?? null;
  const actionIdTab = typeof tabId === 'number' ? tabId : 'none';
  const browserHygieneEvidence = extractCloseTabsBrowserHygieneEvidence(input.result);
  const sourceRouteHonesty = input.taskContext?.peekLastSourceRouteHonesty() ?? null;
  const taskResumeReadiness = input.taskContext?.buildTaskResumeReadiness({
    tabId: typeof tabId === 'number' ? tabId : null,
  });
  const hygieneChecks = buildCloseTabsSuccessHygieneChecks(input, browserHygieneEvidence);
  const incompleteCheckKinds = hygieneChecks
    .filter((check) => check.verdict === 'unknown')
    .map((check) => check.kind);
  const browserHygiene = {
    available: true,
    baselineTabs: browserHygieneEvidence?.after.tabCount ?? null,
    runOwnedTabsClosed: input.closedTabIds.length + input.invalidTabIds.length,
    baselineChanged: browserHygieneEvidence?.tabWindowBaselineUnchanged === false,
    checks: hygieneChecks,
    notes: [
      `closedTabCount=${input.closedTabIds.length}`,
      `invalidTabCount=${input.invalidTabIds.length}`,
      `requestedTabCount=${targetTabIds.length}`,
      `browserHygieneEvidenceCompleteness=${incompleteCheckKinds.length === 0 ? 'complete' : 'partial'}`,
      ...(incompleteCheckKinds.length > 0
        ? [`browserHygieneMissingChecks=${incompleteCheckKinds.join(',')}`]
        : []),
      ...(browserHygieneEvidence
        ? [
            `tabWindowBaselineUnchanged=${browserHygieneEvidence.tabWindowBaselineUnchanged}`,
            `activeTabRestoreReason=${browserHygieneEvidence.activeTabRestoreReason ?? 'unknown'}`,
          ]
        : ['closeTabsBrowserHygieneEvidence=missing']),
      ...(sourceRouteHonesty
        ? [
            `sourceRouteHonestyVerdict=${sourceRouteHonesty.verdict}`,
            `sourceRouteHonestyReason=${sourceRouteHonesty.reason}`,
            `sourceRouteSelectedDataSource=${sourceRouteHonesty.selectedDataSource ?? 'unknown'}`,
            `sourceRouteFallbackUsed=${sourceRouteHonesty.fallbackUsed}`,
            `sourceRouteHasFactEvidence=${sourceRouteHonesty.hasFactEvidence}`,
          ]
        : ['sourceRouteHonestyVerdict=unknown']),
      'sourceRouteHonestyBoundary=runtime_visible_api_cdp_not_proven',
      'apiCdpReuseProven=false',
      ...(taskResumeReadiness
        ? [
            `taskResumeReadinessStatus=${taskResumeReadiness.status}`,
            `taskResumeCanContinue=${taskResumeReadiness.canResumeOriginalTask}`,
            `taskResumeHandoffStatus=${taskResumeReadiness.handoffSummary.status}`,
            `taskResumeHandoffNextAction=${taskResumeReadiness.handoffSummary.nextAction}`,
          ]
        : ['taskResumeReadinessStatus=unknown']),
      'v3RequiredAction=close',
    ],
  };

  const taskTimeline = input.taskContext?.getLifecycleTimeline() ?? [];
  const unifiedTabIds = uniquePositiveIntegers([
    ...input.closedTabIds,
    ...input.invalidTabIds,
    ...targetTabIds,
    ...(typeof tabId === 'number' ? [tabId] : []),
    ...(input.taskContext?.peekLastPageProjection()?.tabId
      ? [input.taskContext.peekLastPageProjection()!.tabId]
      : []),
  ]);
  if (input.taskContext && taskTimeline.length > 0 && unifiedTabIds.length > 0) {
    const lastProjection = input.taskContext.peekLastPageProjection();
    const hasRead = input.taskContext.readPageCount > 0;
    const regionStatePostconditions = input.taskContext
      .peekRegionStatePostconditionsForCloseout(unifiedTabIds)
      .map((postcondition) => {
        if (postcondition.result.kind !== 'search_results_updated') return postcondition;
        const topNAccumulationEvidence =
          input.taskContext?.peekDomRegionRowsReadbackAccumulationEvidence({
            tabId: postcondition.tabId,
          }) ?? null;
        return topNAccumulationEvidence
          ? { ...postcondition, topNAccumulationEvidence }
          : postcondition;
      });
    produceUnifiedTaskCloseoutLifecycleEvidenceArtifact({
      artifactId: `mcp-unified-closeout-${input.startedAtMs}-${actionIdTab}`,
      evidenceLevel: 'integration',
      scenarioId: TOOL_CLOSEOUT_ARTIFACT_SCENARIO_ID,
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: inferTaskTimelineStartedAtMs(taskTimeline, input.startedAtMs),
      endedAtMs: input.endedAtMs,
      tabIds: unifiedTabIds,
      taskTimeline,
      readAction: hasRead
        ? {
            actionId: `mcp:chrome_read_page:${lastProjection?.tabId ?? actionIdTab}:${input.startedAtMs}`,
            tabId: lastProjection?.tabId ?? (typeof tabId === 'number' ? tabId : null),
            verdict: lastProjection ? 'passed' : 'unknown',
            reason: lastProjection
              ? 'read_page_projection_available'
              : 'read_page_success_observed_without_projection',
            observedOutcome: 'unknown',
            observedOutcomeConfidence: lastProjection ? 0.7 : 0.4,
          }
        : null,
      closeAction: {
        actionId: `mcp:chrome_close_tabs:${actionIdTab}:${input.startedAtMs}`,
        tabId: typeof tabId === 'number' ? tabId : null,
        reason: 'close_tabs_cleanup_succeeded',
        observedOutcome: 'unknown',
        observedOutcomeConfidence: 0.75,
      },
      sourceTruthChain: input.taskContext.peekLastSourceTruthChain(),
      browserHygiene,
      ...(regionStatePostconditions.length > 0 ? { regionStatePostconditions } : {}),
    });
    return;
  }

  produceToolCloseoutLifecycleEvidenceArtifact({
    artifactId: `mcp-close-success-${input.startedAtMs}-${actionIdTab}`,
    evidenceLevel: 'integration',
    scenarioId: TOOL_CLOSEOUT_ARTIFACT_SCENARIO_ID,
    scenarioClass: 'browser_hygiene_closeout_v1',
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
    actionId: `mcp:chrome_close_tabs:${actionIdTab}:${input.startedAtMs}`,
    actionKind: 'close',
    tabId: typeof tabId === 'number' ? tabId : null,
    reason: 'close_tabs_cleanup_succeeded',
    observedOutcome: 'unknown',
    observedOutcomeConfidence: 0.75,
    browserHygiene,
  });
}

function buildCloseTabsSuccessHygieneChecks(
  input: {
    closedTabIds: number[];
    invalidTabIds: number[];
  },
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck[] {
  const cleanupCount = input.closedTabIds.length + input.invalidTabIds.length;
  return [
    buildCloseTabsTabWindowBaselineCheck(evidence),
    buildCloseTabsActiveTabRestoreCheck(evidence),
    {
      kind: 'run_owned_cleanup',
      verdict: cleanupCount > 0 ? 'pass' : 'unknown',
      reason: cleanupCount > 0 ? 'run_owned_tabs_cleaned' : 'browser_hygiene_check_not_reported',
    },
    {
      kind: 'user_owned_protection',
      verdict: 'pass',
      reason: 'user_owned_tabs_protected',
    },
    {
      kind: 'failure_cleanup',
      verdict: 'pass',
      reason: 'failure_cleanup_not_needed',
    },
  ];
}

function buildCloseTabsTabWindowBaselineCheck(
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck {
  if (evidence?.tabWindowBaselineUnchanged === true) {
    return {
      kind: 'tab_window_baseline',
      verdict: 'pass',
      reason: 'pre_post_tab_window_baseline_unchanged',
    };
  }
  if (evidence?.tabWindowBaselineUnchanged === false) {
    return {
      kind: 'tab_window_baseline',
      verdict: 'fail',
      reason: 'pre_post_tab_window_baseline_changed',
    };
  }
  return {
    kind: 'tab_window_baseline',
    verdict: 'unknown',
    reason: 'browser_hygiene_check_not_reported',
  };
}

function buildCloseTabsActiveTabRestoreCheck(
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck {
  if (evidence?.activeTabRestored === true) {
    return {
      kind: 'active_tab_restore',
      verdict: 'pass',
      reason: 'active_tab_restored',
    };
  }
  if (evidence?.activeTabRestored === false) {
    return {
      kind: 'active_tab_restore',
      verdict: 'fail',
      reason: 'active_tab_not_restored',
    };
  }
  return {
    kind: 'active_tab_restore',
    verdict: 'unknown',
    reason: 'browser_hygiene_check_not_reported',
  };
}

function extractCloseTabsBrowserHygieneEvidence(
  result: unknown,
): CloseTabsBrowserHygieneEvidence | null {
  for (const payload of extractObjectPayloadsFromToolResult(result)) {
    const rawEvidence = readObject(payload.browserHygieneEvidence);
    if (!rawEvidence) continue;
    const before = readCloseTabsBrowserSnapshot(rawEvidence.before);
    const after = readCloseTabsBrowserSnapshot(rawEvidence.after);
    if (!before || !after) continue;
    return {
      before,
      after,
      tabWindowBaselineUnchanged: readNullableBoolean(rawEvidence, 'tabWindowBaselineUnchanged'),
      activeTabRestored: readNullableBoolean(rawEvidence, 'activeTabRestored'),
      activeTabRestoreReason: readString(rawEvidence.activeTabRestoreReason),
    };
  }
  return null;
}

function readCloseTabsBrowserSnapshot(input: unknown): CloseTabsBrowserSnapshot | null {
  const snapshot = readObject(input);
  if (!snapshot) return null;
  const tabCount = readNonNegativeInteger(snapshot, 'tabCount');
  const windowCount = readNonNegativeInteger(snapshot, 'windowCount');
  if (tabCount === null || windowCount === null) return null;
  return {
    tabCount,
    windowCount,
    focusedWindowId: readPositiveInteger(snapshot, 'focusedWindowId'),
    activeTabId: readPositiveInteger(snapshot, 'activeTabId'),
  };
}

function extractObjectPayloadsFromToolResult(data: unknown): Array<Record<string, unknown>> {
  const payloads: Array<Record<string, unknown>> = [];
  const root = readObject(data);
  if (!root) return payloads;
  payloads.push(root);
  const content = root.content;
  if (!Array.isArray(content)) return payloads;
  for (const entry of content) {
    const block = readObject(entry);
    if (!block || typeof block.text !== 'string' || block.text.length === 0) continue;
    try {
      const parsed = JSON.parse(block.text);
      const payload = readObject(parsed);
      if (payload) payloads.push(payload);
    } catch {
      // Not JSON; skip.
    }
  }
  return payloads;
}

function uniquePositiveIntegers(values: ReadonlyArray<number | null | undefined>): number[] {
  return [
    ...new Set(
      values.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isInteger(value) && value > 0,
      ),
    ),
  ];
}

function inferTaskTimelineStartedAtMs(
  timeline: ReadonlyArray<{ at: string }>,
  fallbackStartedAtMs: number,
): number {
  const parsed = timeline
    .map((event) => Date.parse(event.at))
    .filter((value) => Number.isFinite(value));
  return parsed.length > 0 ? Math.min(...parsed) : fallbackStartedAtMs;
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

function buildReadPageContextMeasurement(
  payload: Record<string, unknown> | null,
  requestedLayer: ReadPageRequestedLayer,
): TaskReadPageContextMeasurement | null {
  if (!payload || requestedLayer !== 'L0+L1+L2') return null;
  let fullReadByteLength = 0;
  try {
    fullReadByteLength = JSON.stringify(payload).length;
  } catch {
    return null;
  }
  if (!Number.isFinite(fullReadByteLength) || fullReadByteLength <= 0) return null;

  const page = readObject(payload.page);
  const summary = readObject(payload.summary);
  const candidateActions = Array.isArray(payload.candidateActions) ? payload.candidateActions : [];
  const highValueObjects = Array.isArray(payload.highValueObjects) ? payload.highValueObjects : [];
  return {
    url: readString(page?.url) ?? readString(payload.url) ?? readString(payload.pageUrl),
    pageRole: readString(summary?.pageRole) ?? readString(payload.pageRole),
    fullReadByteLength,
    candidateActionsCount: candidateActions.length,
    highValueObjectCount: highValueObjects.length,
  };
}

function attachObjectLibraryHintsToReadPageResult(result: CallToolResult): CallToolResult {
  const browserObjects = sessionManager.browserObjects;
  if (!browserObjects || result.isError === true) return result;
  const payload = readJsonObjectFromCallToolResult(result);
  if (!payload) return result;
  if (Array.isArray(payload.objectLibraryHints) && payload.objectLibraryHints.length > 0) {
    return result;
  }
  const projection = readObject(payload.pageProjection);
  const siteFamily = readString(projection?.siteFamily);
  const pageModelKey = readString(projection?.pageModelKey);
  if (!siteFamily || !pageModelKey) return result;

  let reusableObjects: ReturnType<typeof browserObjects.listReusableForPage> = [];
  try {
    reusableObjects = browserObjects.listReusableForPage({ siteFamily, pageModelKey, limit: 8 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.debug('mcp.register-tools', 'object library hint lookup failed', {
      errorMessage: message,
    });
    return result;
  }
  if (reusableObjects.length === 0) return result;

  const hints: ReadPageObjectLibraryHint[] = reusableObjects.map((object) => {
    const confidence =
      typeof object.confidenceScore === 'number' && Number.isFinite(object.confidenceScore)
        ? Math.max(0, Math.min(1, object.confidenceScore))
        : 0.5;
    const actionTypes = Array.isArray(object.actionTypes)
      ? object.actionTypes.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : undefined;
    return {
      source: 'object_library_reuse',
      objectType: object.objectType,
      objectFingerprint: object.objectFingerprint,
      siteFamily: object.siteFamily,
      pageModelKey: object.pageModelKey,
      reuseConfidence: confidence,
      freshness: mapObjectLibraryHintFreshness(object),
      lastValidatedAt: object.lastValidatedAt,
      lastObservedAt: object.lastObservedAt ?? object.updatedAt,
      ...(actionTypes && actionTypes.length > 0 ? { actionTypes } : {}),
      summary: object.primaryConclusion,
      claimBoundary:
        'objectLibraryHints are redacted historical planning hints only; current candidateActions and post-action verification remain authoritative.',
    };
  });

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify({ ...payload, objectLibraryHints: hints }) }
        : block,
    ),
  };
}

function mapObjectLibraryHintFreshness(object: {
  sourceFreshness?: string | null;
  lastValidatedAt?: string | null;
}): ReadPageObjectLibraryHint['freshness'] {
  const freshness = String(object.sourceFreshness ?? '').toLowerCase();
  if (freshness.includes('needs_refresh') || freshness.includes('refresh')) {
    return 'needs_refresh';
  }
  if (freshness.includes('stale') || freshness.includes('expired')) {
    return 'stale';
  }
  return object.lastValidatedAt ? 'validated' : 'unknown';
}

function evaluateReadPageTargetBinding(
  result: CallToolResult,
  requestedTabId: number,
): {
  verdict: 'matched' | 'unknown' | 'mismatch';
  requestedTabId: number;
  observedTabIds: number[];
  matchedTabId: number | null;
  reason: string;
} {
  const payload = readJsonObjectFromCallToolResult(result);
  const observedTabIds = payload ? collectReadPageObservedTabIds(payload) : [];
  const uniqueObserved = Array.from(new Set(observedTabIds));
  if (uniqueObserved.length === 0) {
    return {
      verdict: 'unknown',
      requestedTabId,
      observedTabIds: [],
      matchedTabId: null,
      reason: 'read_page response did not expose a target tab id; legacy response tolerated',
    };
  }
  if (uniqueObserved.some((tabId) => tabId !== requestedTabId)) {
    return {
      verdict: 'mismatch',
      requestedTabId,
      observedTabIds: uniqueObserved,
      matchedTabId: uniqueObserved.includes(requestedTabId) ? requestedTabId : null,
      reason:
        'read_page response included tab-bound evidence that did not match the explicit requested tabId',
    };
  }
  return {
    verdict: 'matched',
    requestedTabId,
    observedTabIds: uniqueObserved,
    matchedTabId: requestedTabId,
    reason: 'all observed read_page tab-bound evidence matched the explicit requested tabId',
  };
}

function collectReadPageObservedTabIds(payload: Record<string, unknown>): number[] {
  const ids: number[] = [];
  const push = (value: number | null) => {
    if (value !== null) ids.push(value);
  };

  push(readPositiveInteger(payload, 'tabId'));
  push(readPositiveInteger(payload, 'currentTabId'));
  push(readPositiveInteger(payload, 'readTargetTabId'));

  const pageProjection = readObject(payload.pageProjection);
  push(readPositiveInteger(pageProjection, 'tabId'));

  const ownershipRuntime = readObject(payload.ownershipRuntime);
  push(readPositiveInteger(ownershipRuntime, 'currentTabId'));

  const compactTab = readObject(
    readObject(readObject(payload.browserPageObjectCompact)?.facts)?.tab,
  );
  push(readPositiveInteger(compactTab, 'tabId'));
  push(readPositiveInteger(compactTab, 'readTargetTabId'));
  push(readPositiveInteger(compactTab, 'currentActiveTabId'));

  const artifacts = payload.artifactRefs;
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      const ref = readString(readObject(artifact)?.ref);
      if (!ref) continue;
      for (const pattern of [/\/tab-(\d+)\//g, /read_page\/(\d+)\//g]) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(ref)) !== null) {
          const parsed = Number(match[1]);
          if (Number.isInteger(parsed) && parsed > 0) ids.push(parsed);
        }
      }
    }
  }

  return ids;
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

function shouldRecordDomRegionRowsReadback(visibleRows: TaskVisibleRegionRowsData): boolean {
  if (!visibleRows.visibleRegionRowsUsed || visibleRows.rowCount <= 0) return false;
  const coverage = visibleRows.targetRefCoverageRate ?? 0;
  const quality = visibleRows.regionQualityScore ?? 0;
  return visibleRows.rowExtractionConfidence >= 0.7 && coverage >= 0.95 && quality >= 0.7;
}

function shouldInvalidateReadAfterInteraction(toolName: string, args?: unknown): boolean {
  if (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD ||
    toolName === TOOL_NAMES.BROWSER.SWITCH_TAB
  ) {
    return true;
  }

  if (toolName !== TOOL_NAMES.BROWSER.NAVIGATE) return false;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  return (args as Record<string, unknown>).refresh === true;
}

function shouldRecordPageInteractionAfterResult(
  toolName: string,
  args: unknown,
  result: CallToolResult,
): boolean {
  if (!shouldInvalidateReadAfterInteraction(toolName, args)) return false;

  const payload = readJsonObjectFromCallToolResult(result);
  if (!payload) return (result as { isError?: boolean }).isError !== true;

  const dispatchSucceeded = readBoolean(payload, 'dispatchSucceeded');
  if (dispatchSucceeded === true) return true;
  if (dispatchSucceeded === false) return false;

  const targetConsistency = readObject(payload.targetConsistency);
  const targetConsistencyVerdict = readString(targetConsistency?.verdict);
  if (
    targetConsistencyVerdict === 'blocked_by_overlay' ||
    targetConsistencyVerdict === 'target_mismatch'
  ) {
    return false;
  }

  const error = readString(payload.error);
  const reason = readString(payload.reason);
  if (
    error === 'blocked_by_overlay' ||
    error === 'target_mismatch' ||
    reason === 'blocked_by_overlay' ||
    reason === 'target_mismatch'
  ) {
    return false;
  }

  if (payload.success === false) return false;
  return (result as { isError?: boolean }).isError !== true;
}

function inferPageInteractionChangeCause(
  toolName: string,
  result: CallToolResult,
): BrowserPageChangeCause {
  if (toolName !== TOOL_NAMES.BROWSER.CLICK) return 'unknown';
  const payload = readJsonObjectFromCallToolResult(result);
  const observedOutcome =
    payload && typeof payload.observedOutcome === 'string' ? payload.observedOutcome : null;
  if (
    observedOutcome === null ||
    observedOutcome === 'no_observed_change' ||
    observedOutcome === 'verification_unavailable'
  ) {
    return 'unknown';
  }
  return 'click';
}

function inferActionKindForToolName(toolName: string): ActionKind {
  if (toolName === TOOL_NAMES.BROWSER.CLICK) return 'click';
  if (toolName === TOOL_NAMES.BROWSER.FILL) return 'fill';
  if (toolName === TOOL_NAMES.BROWSER.KEYBOARD) return 'keyboard';
  if (toolName === TOOL_NAMES.BROWSER.NAVIGATE) return 'navigate';
  return 'unknown';
}

function readInteractionTargetRefs(args: unknown): string[] {
  const input = readObject(args);
  if (!input) return [];
  const refs = [
    readSafeTargetRef(input.ref),
    readSafeTargetRef(readObject(input.candidateAction)?.targetRef),
  ].filter((ref): ref is string => ref !== null);
  return refs.filter((ref, index) => refs.indexOf(ref) === index).slice(0, 3);
}

export function bindPostActionDeltaEvidenceToPendingInteraction(
  postActionDeltaEvidence: unknown,
  pageObjectSnapshot: unknown,
  pendingInteraction: TaskPageInteractionSnapshot | null,
): PostActionDeltaEvidence | null {
  const evidence = readObject(postActionDeltaEvidence);
  if (!evidence || pendingInteraction === null) return null;
  const actionId =
    readSafeIdentifier(pendingInteraction.candidateActionId) ??
    readSafeIdentifier(pendingInteraction.action);
  const targetObjectId =
    findReadPageObjectIdForTargetRefs(pageObjectSnapshot, pendingInteraction.targetRefs) ??
    readSafeIdentifier(evidence.targetObjectId);

  return {
    ...evidence,
    actionId,
    targetObjectId,
  } as unknown as PostActionDeltaEvidence;
}

function findReadPageObjectIdForTargetRefs(
  pageObjectSnapshot: unknown,
  targetRefs: readonly string[],
): string | null {
  if (targetRefs.length === 0) return null;
  const targetRefSet = new Set(targetRefs);
  const snapshot = readObject(pageObjectSnapshot);
  if (!snapshot) return null;

  const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
  for (const object of objects) {
    const item = readObject(object);
    if (!item) continue;
    const objectId = readSafeIdentifier(item.objectId);
    if (!objectId) continue;
    const targetRef = readSafeTargetRef(item.targetRef) ?? readSafeTargetRef(item.ref);
    if (targetRef && targetRefSet.has(targetRef)) return objectId;
  }

  const actionableTargets = Array.isArray(snapshot.actionableTargets)
    ? snapshot.actionableTargets
    : [];
  for (const target of actionableTargets) {
    const item = readObject(target);
    if (!item) continue;
    const objectId = readSafeIdentifier(item.objectId) ?? readSafeIdentifier(item.targetId);
    if (!objectId) continue;
    const targetRef = readSafeTargetRef(item.targetRef) ?? readSafeTargetRef(item.ref);
    if (targetRef && targetRefSet.has(targetRef)) return objectId;
  }

  return null;
}

function readCandidateActionMetadata(args: unknown): {
  candidateActionId: string | null;
  candidateActionIntent: ReadPageCandidateActionIntent | string | null;
} {
  const input = readObject(args);
  const candidateAction = readObject(input?.candidateAction);
  return {
    candidateActionId: readSafeIdentifier(candidateAction?.id),
    candidateActionIntent: readSafeIdentifier(candidateAction?.intent),
  };
}

function readSafeTargetRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]{1,96}$/.test(trimmed) ? trimmed : null;
}

function readSafeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:._-]{1,160}$/.test(trimmed) ? trimmed : null;
}

function shouldInvalidateReadAfterWindowFocusChange(toolName: string, args: unknown): boolean {
  if (toolName !== TOOL_NAMES.BROWSER.NAVIGATE) return false;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const input = args as Record<string, unknown>;
  if (input.background === true || input.refresh === true) return false;
  if (readPositiveInteger(input, 'tabId') !== null) return false;
  const url = typeof input.url === 'string' ? input.url : null;
  if (!url || url === 'back' || url === 'forward') return false;
  return true;
}

function buildPostActionDeltaSignalsFromEvidence(
  evidence: PostActionDeltaEvidence | null | undefined,
): Pick<
  BuildPostActionDeltaEvidenceInput,
  | 'targetObjectId'
  | 'observedChangeKind'
  | 'navigationDelta'
  | 'focusDelta'
  | 'objectDelta'
  | 'networkSignalSummary'
  | 'observedSignalDeltas'
> {
  if (!evidence) return {};
  const navigationDelta = readObject(evidence.navigationDelta);
  const focusDelta = readObject(evidence.focusDelta);
  const objectDelta = readObject(evidence.objectDelta);
  const networkSignalSummary = readObject(evidence.networkSignalSummary);
  const observedSignalDeltas = readObject(evidence.observedSignalDeltas);

  return {
    targetObjectId: readSafeIdentifier(evidence.targetObjectId),
    observedChangeKind:
      (readSafeIdentifier(evidence.observedChangeKind) as
        | BuildPostActionDeltaEvidenceInput['observedChangeKind']
        | null) ?? null,
    navigationDelta: navigationDelta
      ? {
          status:
            (readSafeIdentifier(navigationDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['navigationDelta']>['status']
              | null) ?? undefined,
          beforeUrl: readString(navigationDelta.beforeUrl),
          afterUrl: readString(navigationDelta.afterUrl),
        }
      : undefined,
    focusDelta: focusDelta
      ? {
          status:
            (readSafeIdentifier(focusDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['focusDelta']>['status']
              | null) ?? undefined,
          beforeTabId: readNumber(focusDelta.beforeTabId),
          afterTabId: readNumber(focusDelta.afterTabId),
        }
      : undefined,
    objectDelta: objectDelta
      ? {
          status:
            (readSafeIdentifier(objectDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['objectDelta']>['status']
              | null) ?? undefined,
          changedObjectIds: readStringArray(objectDelta.changedObjectIds),
        }
      : undefined,
    networkSignalSummary: networkSignalSummary
      ? {
          status:
            (readSafeIdentifier(networkSignalSummary.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['networkSignalSummary']>['status']
              | null) ?? undefined,
          observedRequestCount: readNumber(networkSignalSummary.observedRequestCount),
          observedResponseCount: readNumber(networkSignalSummary.observedResponseCount),
        }
      : undefined,
    observedSignalDeltas: observedSignalDeltas
      ? {
          requestStartedDelta: readNumber(observedSignalDeltas.requestStartedDelta),
          failedRequestDelta: readNumber(observedSignalDeltas.failedRequestDelta),
          errorCountDelta: readNumber(observedSignalDeltas.errorCountDelta),
          warningCountDelta: readNumber(observedSignalDeltas.warningCountDelta),
        }
      : undefined,
  };
}

function readTaskPageRuntimeFields(payload: Record<string, unknown>): TaskPageRuntimeFields {
  const ownershipRuntime = readObject(payload.ownershipRuntime);
  const pageLoadReadiness = readPageLoadReadiness(payload.pageContext);
  const compactTabFacts = readObject(
    readObject(readObject(payload.browserPageObjectCompact)?.facts)?.tab,
  );
  const readCompactString = (key: string): string | null => readString(compactTabFacts?.[key]);
  const readCompactInteger = (key: string): number | null => readInteger(compactTabFacts, key);
  const readCompactBoolean = (key: string): boolean | null => readBoolean(compactTabFacts, key);
  const readCompactNumber = (key: string): number | null => {
    const raw = compactTabFacts?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  const readNestedString = (key: string): string | null =>
    readString(ownershipRuntime?.[key]) ?? readString(payload[key]);
  const readNestedInteger = (key: string): number | null =>
    readInteger(ownershipRuntime, key) ?? readInteger(payload, key);
  const readNestedPositiveInteger = (key: string): number | null =>
    readPositiveInteger(ownershipRuntime, key) ?? readPositiveInteger(payload, key);
  const readNestedBoolean = (key: string): boolean | null =>
    readBoolean(ownershipRuntime, key) ?? readBoolean(payload, key);
  const readNestedNumber = (key: string): number | null => {
    const nestedRaw = ownershipRuntime?.[key];
    if (typeof nestedRaw === 'number' && Number.isFinite(nestedRaw)) return nestedRaw;
    const payloadRaw = payload[key];
    return typeof payloadRaw === 'number' && Number.isFinite(payloadRaw) ? payloadRaw : null;
  };
  const openedBy = readNestedString('currentTabOpenedBy');
  const openedBySource = readNestedString('currentTabOpenedBySource');
  const aiOperationState = readNestedString('currentTabAiOperationState');
  const runtimeStateSource = readNestedString('currentTabRuntimeStateSource');

  return {
    currentWindowId: readPositiveInteger(payload, 'currentWindowId'),
    currentWindowState: readWindowRuntimeState(payload, 'currentWindowState'),
    currentWindowWidth: readPositiveInteger(payload, 'currentWindowWidth'),
    currentWindowHeight: readPositiveInteger(payload, 'currentWindowHeight'),
    currentWindowLeft: readInteger(payload, 'currentWindowLeft'),
    currentWindowTop: readInteger(payload, 'currentWindowTop'),
    isCurrentTabActive: readBoolean(payload, 'isCurrentTabActive'),
    isCurrentWindowFocused: readBoolean(payload, 'isCurrentWindowFocused'),
    browserActiveTabId: readPositiveInteger(payload, 'browserActiveTabId'),
    browserActiveTabIdKnown: readBoolean(payload, 'browserActiveTabIdKnown') === true,
    isReadTargetBrowserActiveTab: readBoolean(payload, 'isReadTargetBrowserActiveTab'),
    currentTabUrl: readNestedString('currentTabUrl') ?? readCompactString('currentTabUrl'),
    currentTabPendingUrl:
      readNestedString('currentTabPendingUrl') ?? readCompactString('currentTabPendingUrl'),
    currentTabTitle: readNestedString('currentTabTitle') ?? readCompactString('currentTabTitle'),
    currentTabStatus: readNestedString('currentTabStatus') ?? readCompactString('currentTabStatus'),
    currentTabDiscarded:
      readNestedBoolean('currentTabDiscarded') ?? readCompactBoolean('currentTabDiscarded'),
    currentTabAudible:
      readNestedBoolean('currentTabAudible') ?? readCompactBoolean('currentTabAudible'),
    currentTabMuted: readNestedBoolean('currentTabMuted') ?? readCompactBoolean('currentTabMuted'),
    currentTabPinned:
      readNestedBoolean('currentTabPinned') ?? readCompactBoolean('currentTabPinned'),
    currentTabOpenerTabId:
      readNestedPositiveInteger('currentTabOpenerTabId') ??
      readCompactInteger('currentTabOpenerTabId'),
    currentTabOpenedBy:
      (openedBy === 'ai' || openedBy === 'user_or_page' || openedBy === 'unknown'
        ? openedBy
        : null) ??
      (() => {
        const compactOpenedBy = readCompactString('openedBy');
        return compactOpenedBy === 'ai' ||
          compactOpenedBy === 'user_or_page' ||
          compactOpenedBy === 'unknown'
          ? compactOpenedBy
          : null;
      })(),
    currentTabOpenedBySource:
      (openedBySource === 'ai_tool' ||
      openedBySource === 'page_opener' ||
      openedBySource === 'user_or_unknown' ||
      openedBySource === 'unknown'
        ? openedBySource
        : null) ??
      (() => {
        const compactOpenedBySource = readCompactString('openedBySource');
        return compactOpenedBySource === 'ai_tool' ||
          compactOpenedBySource === 'page_opener' ||
          compactOpenedBySource === 'user_or_unknown' ||
          compactOpenedBySource === 'unknown'
          ? compactOpenedBySource
          : null;
      })(),
    currentTabOpenedByConfidence:
      readNestedNumber('currentTabOpenedByConfidence') ?? readCompactNumber('openedByConfidence'),
    currentTabOpenedByReason:
      readNestedString('currentTabOpenedByReason') ?? readCompactString('openedByReason'),
    currentTabAiOperationState:
      (aiOperationState === 'idle' ||
      aiOperationState === 'recently_operated' ||
      aiOperationState === 'closed'
        ? aiOperationState
        : null) ??
      (() => {
        const compactAiOperationState = readCompactString('aiOperationState');
        return compactAiOperationState === 'idle' ||
          compactAiOperationState === 'recently_operated' ||
          compactAiOperationState === 'closed'
          ? compactAiOperationState
          : null;
      })(),
    currentTabLastAiOperation:
      readNestedString('currentTabLastAiOperation') ?? readCompactString('lastAiOperation'),
    currentTabLastAiOperationAtMs:
      readNestedInteger('currentTabLastAiOperationAtMs') ??
      readCompactInteger('lastAiOperationAtMs'),
    currentTabLastAiOperationConfidence:
      readNestedNumber('currentTabLastAiOperationConfidence') ??
      readCompactNumber('lastAiOperationConfidence'),
    currentTabLastAiOperationReason:
      readNestedString('currentTabLastAiOperationReason') ??
      readCompactString('lastAiOperationReason'),
    currentTabCanTabrixOperate:
      readNestedBoolean('currentTabCanTabrixOperate') ?? readCompactBoolean('canTabrixOperate'),
    currentTabOperabilityReason:
      readNestedString('currentTabOperabilityReason') ?? readCompactString('operabilityReason'),
    currentTabRuntimeStateSource:
      (runtimeStateSource === 'browser_world_inventory' ||
      runtimeStateSource === 'chrome_tab_snapshot' ||
      runtimeStateSource === 'unknown'
        ? runtimeStateSource
        : null) ??
      (() => {
        const compactRuntimeStateSource = readCompactString('runtimeStateSource');
        return compactRuntimeStateSource === 'browser_world_inventory' ||
          compactRuntimeStateSource === 'chrome_tab_snapshot' ||
          compactRuntimeStateSource === 'unknown'
          ? compactRuntimeStateSource
          : 'unknown';
      })(),
    browserWorldObjectChangeSummary:
      readNestedString('browserWorldObjectChangeSummary') ??
      readCompactString('browserWorldObjectChangeSummary'),
    browserWorldActionableObjectChangeSummary:
      readNestedString('browserWorldActionableObjectChangeSummary') ??
      readCompactString('browserWorldActionableObjectChangeSummary'),
    browserWorldCurrentOperationConclusion:
      readNestedString('browserWorldCurrentOperationConclusion') ??
      readCompactString('browserWorldCurrentOperationConclusion'),
    browserWorldRoutingDecisionSummary:
      readNestedString('browserWorldRoutingDecisionSummary') ??
      readCompactString('browserWorldRoutingDecisionSummary'),
    currentPageLoadReadinessStatus: pageLoadReadiness?.status ?? null,
    currentPageStability: pageLoadReadiness?.pageStability ?? null,
    currentPageSnapshotUsableForBusinessAction:
      pageLoadReadiness?.canUseSnapshotForBusinessAction ?? null,
    currentPageLoadReadinessNextStepHint: pageLoadReadiness?.nextStepHint ?? null,
  };
}

function attachAiFacingOwnershipRuntime(
  result: CallToolResult,
  attachment: TaskContextAttachment,
  options?: { includeAiContextEnvelope?: boolean },
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
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
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
  const projectionWithSourceTruth = ensureProjectionSourceTruthChain(
    normalizedAiFacingProjection,
    selectedDataSource,
  );
  const runtimeFields = readTaskPageRuntimeFields(payload);

  const ownershipRuntime = buildAiFacingOwnershipRuntimeSummary(
    attachment.taskContext,
    projectionWithSourceTruth,
    runtimeFields,
  );
  payload.pageProjection = projectionWithSourceTruth;
  payload.tabId = projectionWithSourceTruth.tabId;
  payload.ownershipRuntime = ownershipRuntime;
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  const aiContextEnvelope = readObject(payload.aiContextEnvelope);
  if (aiContextEnvelope && options?.includeAiContextEnvelope === true) {
    payload.aiContextEnvelope = {
      ...aiContextEnvelope,
      taskContext: buildTaskContextEnvelope(attachment),
      pageObjectSummary: buildCachedReadPageObjectSummary({
        warning: typeof payload.warning === 'string' ? payload.warning : 'cached_read_warning',
        projection: projectionWithSourceTruth,
        ownershipRuntime,
        selectedDataSource,
      }),
    };
  } else {
    delete payload.aiContextEnvelope;
  }
  const responsePayload =
    options?.includeAiContextEnvelope === true
      ? payload
      : stripReadPageDiagnosticNoiseForOutput(payload);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

function buildCachedReadPageObjectSummary(args: {
  warning: string;
  projection: BrowserPageThingProjection;
  ownershipRuntime: ReadPageOwnershipRuntimeSummary;
  selectedDataSource: ReadPageSelectedDataSource | null;
}): ReadPageBrowserPageObjectCompactView {
  const lifecycle: ReadPageObjectLifecycleSummary = {
    source: 'read_page_regions',
    status: 'single_snapshot',
    objectCount: 0,
    changedObjectCount: 0,
    items: [],
    changes: [],
    claimBoundary:
      'Cached read warning has no fresh page-region lifecycle objects; this summary is derived from cached projection plus current Window/Tab runtime fields.',
  };
  const view = buildReadPageBrowserPageObjectView({
    objectLifecycle: lifecycle,
    pageProjection: args.projection,
    ownershipRuntime: args.ownershipRuntime,
    selectedDataSource: args.selectedDataSource,
  });
  const compact = view.compact!;
  const degraded =
    args.ownershipRuntime.currentWindowState === 'minimized' ||
    args.ownershipRuntime.isCurrentWindowFocused === false ||
    args.ownershipRuntime.isCurrentTabActive === false;
  return {
    ...compact,
    watchStatus: degraded ? 'runtime_degraded' : 'stable_or_unknown',
    primaryConclusion: degraded
      ? `Cached page state reused for ${args.warning}; current runtime is visually degraded, so do not claim fresh visual/page proof.`
      : `Cached page state reused for ${args.warning}; Window/Tab runtime facts are attached, but page content was not freshly read.`,
    changedGroups: degraded
      ? ['window_state', 'tab_state', 'visual_reliability', 'evidence_state']
      : ['evidence_state'],
    transitionCount: degraded ? 4 : 1,
    evidenceSummary:
      'cached_read_warning: pageProjection is reused; Window/Tab facts come from the latest runtime fields; no fresh DOM/API/CDP read happened.',
    claimBoundary:
      'Cached pageObjectSummary is AI-facing runtime context only. It does not prove page content freshness, login/logout success, API/CDP reuse, or task completion.',
  };
}

function attachAiFacingDeltaContext(
  result: CallToolResult,
  attachment: TaskContextAttachment,
  options?: { readStartedAtMs?: number; includeAiContextEnvelope?: boolean },
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
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
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
  let projectionWithSourceTruth = ensureProjectionSourceTruthChain(
    normalizedAiFacingProjection,
    selectedDataSource,
  );
  const pendingInteraction = attachment.taskContext.consumePendingPageInteraction(
    projectionWithSourceTruth.tabId,
  );
  const pageRegions = readPageRegions(payload.pageRegions);
  const postconditionPageRegions = readPagePostconditionRegions(payload, pageRegions);
  const pageLoadReadiness = readPageLoadReadiness(payload.pageContext);
  const postActionReadback = buildPostActionReadbackEvidence({
    projection: projectionWithSourceTruth,
    readStartedAtMs: options?.readStartedAtMs,
  });
  const regionStatePostcondition = pendingInteraction
    ? buildRegionStatePostconditionForPendingInteraction(
        pendingInteraction,
        postconditionPageRegions,
        pageLoadReadiness,
        postActionReadback,
      )
    : null;
  if (pendingInteraction && regionStatePostcondition?.verdict === 'unknown') {
    attachment.taskContext.keepPendingPageInteractionForPostconditionRetry(pendingInteraction);
  }
  const regionStatePostconditions = regionStatePostcondition
    ? [
        {
          actionKind: pendingInteraction?.actionKind ?? 'unknown',
          result: regionStatePostcondition,
        },
      ]
    : null;
  if (pendingInteraction) {
    const pendingActionId = pendingInteraction.candidateActionId ?? pendingInteraction.action;
    projectionWithSourceTruth = {
      ...projectionWithSourceTruth,
      changedByActionId: pendingActionId,
      changeCause: pendingInteraction.changeCause,
      invalidatedRefs: [
        ...pendingInteraction.targetRefs,
        ...projectionWithSourceTruth.invalidatedRefs,
      ].filter((ref, index, refs) => refs.indexOf(ref) === index),
    };
  }
  const runtimeFields = readTaskPageRuntimeFields(payload);
  const previousPageProjection = attachment.taskContext.peekLastPageProjection();
  const previousRuntimeFields = attachment.taskContext.peekLastPageRuntimeFields();
  const deltaContext = attachment.taskContext.notePageProjectionAndBuildDelta(
    projectionWithSourceTruth,
    runtimeFields,
  );
  const actionBoundPostActionDeltaEvidence = bindPostActionDeltaEvidenceToPendingInteraction(
    payload.postActionDeltaEvidence,
    payload.pageObjectSnapshot,
    pendingInteraction,
  );
  const postActionDeltaEvidence =
    deltaContext.deltaKind === 'post_action_delta'
      ? buildPostActionDeltaEvidence({
          delta: deltaContext,
          tabId: projectionWithSourceTruth.tabId,
          actionId:
            actionBoundPostActionDeltaEvidence?.actionId ??
            projectionWithSourceTruth.changedByActionId ??
            null,
          sourceTruthChain: projectionWithSourceTruth.sourceTruthChain,
          ...buildPostActionDeltaSignalsFromEvidence(actionBoundPostActionDeltaEvidence),
          recommendedNextAction: regionStatePostconditions
            ? 'inspect_region_state_postconditions'
            : 'continue_with_post_action_delta_context',
        })
      : null;
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
  const authResumeGate = attachment.taskContext.noteAuthResumeVerification(
    readAuthResumeVerification(payload),
  );
  const sourceRouteHonesty = classifySourceRouteHonesty({
    selectedDataSource,
    sourceTruthChain: projectionWithSourceTruth.sourceTruthChain,
    fallbackReason,
  });
  const aiFacingSourceRouteHonesty = buildAiFacingSourceRouteHonesty(sourceRouteHonesty);
  const apiCdpProofBoundary = buildAiFacingApiCdpProofBoundary(sourceRouteHonesty);
  attachment.taskContext.noteSourceRouteHonesty(
    toTaskSourceRouteHonestySnapshot(sourceRouteHonesty),
  );
  const taskState = buildAiFacingTaskState({
    payload,
    projection: aiFacingProjection,
    fallbackReason,
    authResumeGate,
  });
  const structuredReadGate = buildStructuredReadGate(payload, projectionWithSourceTruth);
  const previousOwnershipRuntime = previousRuntimeFields
    ? buildAiFacingOwnershipRuntimeSummary(
        attachment.taskContext,
        projectionWithSourceTruth,
        previousRuntimeFields,
      )
    : null;
  const ownershipRuntime = buildAiFacingOwnershipRuntimeSummary(
    attachment.taskContext,
    projectionWithSourceTruth,
    runtimeFields,
  );
  const objectLifecycle = isReadPageObjectLifecycleSummary(payload.objectLifecycle)
    ? attachment.taskContext.noteObjectLifecycleAndBuildDelta(payload.objectLifecycle)
    : null;
  const browserPageObject = objectLifecycle
    ? buildReadPageBrowserPageObjectView({
        pageRegions,
        pageOperationMap: readPageOperationMap(payload.pageOperationMap),
        objectLifecycle,
        previousPageProjection,
        pageProjection: projectionWithSourceTruth,
        previousOwnershipRuntime,
        ownershipRuntime,
        selectedDataSource,
        sourceRouteHonestyVerdict: sourceRouteHonesty.verdict,
      })
    : null;
  const readMode = readReadPageMode(payload.mode);
  const includeFullBrowserPageObjectInAiEnvelope = readMode === 'full';
  const pageObjectDetailPolicy = browserPageObject
    ? {
        readMode,
        summaryField: 'pageObjectSummary',
        fullObjectField: 'browserPageObject',
        fullObjectInAiEnvelope: includeFullBrowserPageObjectInAiEnvelope,
        reason: includeFullBrowserPageObjectInAiEnvelope
          ? 'full_read_mode_requested'
          : 'compact_or_normal_read_mode_prefers_summary_first',
      }
    : null;

  payload.pageProjection = projectionWithSourceTruth;
  payload.tabId = projectionWithSourceTruth.tabId;
  if (objectLifecycle) {
    payload.objectLifecycle = objectLifecycle;
  }
  payload.ownershipRuntime = ownershipRuntime;
  payload.structuredReadGate = structuredReadGate;
  payload.sourceRouteHonesty = aiFacingSourceRouteHonesty;
  payload.apiCdpProofBoundary = apiCdpProofBoundary;
  if (regionStatePostconditions) {
    payload.regionStatePostconditions = regionStatePostconditions;
    attachment.taskContext.noteRegionStatePostconditionsForCloseout({
      tabId: projectionWithSourceTruth.tabId,
      regionStatePostconditions,
    });
  }
  if (authResumeGate) {
    payload.authResumeGate = authResumeGate;
  }
  const taskResumeReadiness = attachment.taskContext.buildTaskResumeReadiness({
    tabId: projectionWithSourceTruth.tabId,
  });
  payload.taskResumeReadiness = taskResumeReadiness;
  payload.deltaContext = deltaContext;
  // Gap 3 closeout: keep the legacy pageDeltaReport only as an internal
  // compatibility input. The public MCP read_page surface should expose the
  // unified delta contract via deltaContext + postActionDeltaEvidence.
  delete payload.pageDeltaReport;
  if (postActionDeltaEvidence) {
    payload.postActionDeltaEvidence = postActionDeltaEvidence;
  }
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  const aiContextEnvelope = {
    envelopeKind: 'delta_context',
    contextSource: 'page_projection_delta',
    taskContext: buildTaskContextEnvelope(attachment),
    taskState,
    selectedDataSource,
    dataSourceDecision,
    sourceRouteHonesty: aiFacingSourceRouteHonesty,
    apiCdpProofBoundary,
    ...(regionStatePostconditions ? { regionStatePostconditions } : {}),
    ...(authResumeGate ? { authResumeGate } : {}),
    taskResumeReadiness,
    structuredReadGate,
    ...(postActionDeltaEvidence ? { postActionDeltaEvidence } : {}),
    ...(objectLifecycle ? { objectLifecycle } : {}),
    ...(pageObjectDetailPolicy ? { pageObjectDetailPolicy } : {}),
    ...(browserPageObject && includeFullBrowserPageObjectInAiEnvelope ? { browserPageObject } : {}),
    ...(browserPageObject?.compact
      ? {
          pageObjectSummary: browserPageObject.compact,
          primaryConclusion: browserPageObject.compact.primaryConclusion,
          watchStatus: browserPageObject.compact.watchStatus,
          changedGroups: browserPageObject.compact.changedGroups,
        }
      : {}),
    deltaContext,
    lifecycleTimeline: attachment.taskContext.getLifecycleTimeline(),
  };
  if (options?.includeAiContextEnvelope === true) {
    payload.aiContextEnvelope = aiContextEnvelope;
  } else {
    delete payload.aiContextEnvelope;
  }
  attachment.taskContext.notePageRegionsForPostcondition({
    tabId: projectionWithSourceTruth.tabId,
    pageRegions: postconditionPageRegions,
  });
  const responsePayload =
    options?.includeAiContextEnvelope === true
      ? payload
      : stripReadPageDiagnosticNoiseForOutput(payload);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

function shouldIncludeVerboseReadPageContext(
  args: unknown,
  requestedLayer: ReadPageRequestedLayer,
): boolean {
  const input = readObject(args);
  return requestedLayer === 'L0+L1+L2' || readReadPageMode(input?.mode) === 'full';
}

function stripReadPageDiagnosticNoise(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (seen.has(object)) return;
  seen.add(object);

  delete object.claimBoundary;
  delete object.evidenceBoundary;
  delete object.evidenceSummary;

  for (const item of Object.values(object)) {
    if (Array.isArray(item)) {
      for (const child of item) stripReadPageDiagnosticNoise(child, seen);
    } else if (item && typeof item === 'object') {
      stripReadPageDiagnosticNoise(item, seen);
    }
  }
}

function stripReadPageDiagnosticNoiseForOutput(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  stripReadPageDiagnosticNoise(clone);
  return clone;
}

function stripReadPageDiagnosticNoiseFromJsonResult(result: CallToolResult): CallToolResult {
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

  delete payload.aiContextEnvelope;
  const responsePayload = stripReadPageDiagnosticNoiseForOutput(payload);
  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
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

function buildReadPageRequestKey(args: unknown, requestedLayer: ReadPageRequestedLayer): string {
  const input =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const mode = readReadPageMode(input.mode);
  const render = extractReadPageRenderMode(input) ?? 'json';
  const filter = typeof input.filter === 'string' ? input.filter : 'all';
  const depth =
    typeof input.depth === 'number' && Number.isFinite(input.depth) ? input.depth : null;
  const refId = typeof input.refId === 'string' ? input.refId : '';
  const includeAuthArtifacts = input.includeAuthArtifacts === true;
  const forceRefresh = input.forceRefresh === true;
  const assistantGuidance = normalizeReadPageAssistantGuidanceForCacheKey(input.assistantGuidance);
  return JSON.stringify({
    requestedLayer,
    mode,
    render,
    filter,
    depth,
    refId,
    includeAuthArtifacts,
    assistantGuidance,
    forceRefresh,
  });
}

function normalizeReadPageAssistantGuidanceForCacheKey(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  if (
    typeof input.taskKind === 'string' &&
    ['auth', 'search', 'extract_content', 'unknown'].includes(input.taskKind)
  ) {
    output.taskKind = input.taskKind;
  }
  if (
    typeof input.authPreference === 'string' &&
    ['qr', 'otp', 'manual', 'auto'].includes(input.authPreference)
  ) {
    output.authPreference = input.authPreference;
  }
  if (Array.isArray(input.requestedObjects)) {
    const requestedObjects = input.requestedObjects
      .filter(
        (item): item is string =>
          typeof item === 'string' &&
          [
            'auth_surface',
            'qr_image',
            'phone_input',
            'otp_input',
            'search_input',
            'result_cards',
            'detail_metrics',
          ].includes(item),
      )
      .slice(0, 8);
    if (requestedObjects.length > 0) output.requestedObjects = [...new Set(requestedObjects)];
  }
  const target =
    input.assistantProvidedTarget &&
    typeof input.assistantProvidedTarget === 'object' &&
    !Array.isArray(input.assistantProvidedTarget)
      ? (input.assistantProvidedTarget as Record<string, unknown>)
      : null;
  if (target) {
    const assistantProvidedTarget: Record<string, unknown> = {};
    if (
      typeof target.purpose === 'string' &&
      ['auth_qr_image', 'click', 'fill', 'observe'].includes(target.purpose)
    ) {
      assistantProvidedTarget.purpose = target.purpose;
    }
    if (
      typeof target.targetRef === 'string' &&
      /^(?:ref|tgt)_[A-Za-z0-9:_-]{1,80}$/.test(target.targetRef)
    ) {
      assistantProvidedTarget.targetRef = target.targetRef;
    }
    if (typeof target.selector === 'string' && target.selector.trim().length > 0) {
      assistantProvidedTarget.selector = target.selector.trim().slice(0, 500);
    }
    if (
      typeof target.frameId === 'number' &&
      Number.isInteger(target.frameId) &&
      target.frameId >= 0
    ) {
      assistantProvidedTarget.frameId = target.frameId;
    }
    if (Object.keys(assistantProvidedTarget).length > 0) {
      output.assistantProvidedTarget = assistantProvidedTarget;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

function buildAutoTabTaskContextKey(tabId: number): string {
  return `mcp:auto:tab:${tabId}`;
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

function ensureProjectionSourceTruthChain(
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
): BrowserPageThingProjection {
  if (isBrowserSourceTruthChainLike(projection.sourceTruthChain)) return projection;
  const primaryOrigin = inferSourceTruthOrigin(projection.sourceLineage, selectedDataSource);
  const provenanceCreatedAt =
    typeof projection.sourceObservedAt === 'string' && projection.sourceObservedAt.length > 0
      ? projection.sourceObservedAt
      : new Date().toISOString();
  return {
    ...projection,
    sourceTruthChain: {
      primaryOrigin,
      provenanceCreatedAt,
      fieldProvenances: [
        { field: 'pageProjection.projectionId', origin: 'browser_runtime', isFact: true },
        { field: 'pageProjection.chosenDataSource', origin: primaryOrigin, isFact: true },
        { field: 'pageProjection.sourceLineage', origin: primaryOrigin, isFact: true },
        { field: 'sourceRouteHonestyBoundary', origin: 'inference', isFact: false },
      ],
    },
  };
}

function isBrowserSourceTruthChainLike(input: unknown): input is BrowserSourceTruthChain {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const chain = input as Partial<BrowserSourceTruthChain>;
  return (
    typeof chain.primaryOrigin === 'string' &&
    Array.isArray(chain.fieldProvenances) &&
    typeof chain.provenanceCreatedAt === 'string'
  );
}

function inferSourceTruthOrigin(
  sourceLineage: BrowserSourceLineage,
  selectedDataSource: ReadPageSelectedDataSource,
): SourceTruthOrigin {
  if (selectedDataSource === 'api_rows') return 'api';
  if (selectedDataSource === 'cdp_enhanced_api_rows') return 'cdp';
  if (selectedDataSource === 'markdown') return 'text';
  if (selectedDataSource === 'dom_json' || selectedDataSource === 'dom_region_rows') return 'dom';
  switch (sourceLineage) {
    case 'dom':
      return 'dom';
    case 'accessibility':
      return 'accessibility';
    case 'api':
      return 'api';
    case 'cdp':
      return 'cdp';
    case 'text':
      return 'text';
    case 'mixed':
      return 'inference';
    default:
      return 'unknown';
  }
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

function extractVisibleRegionRowsDataFromPayload(
  payload: Record<string, unknown> | null,
): TaskVisibleRegionRowsData | null {
  if (!payload) return null;
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rawRows = Array.isArray(rowsPayload.rows)
    ? rowsPayload.rows
    : Array.isArray(payload.rows)
      ? payload.rows
      : [];
  if (rawRows.length === 0) return null;

  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(rowsPayload, 'rowCount') ??
    rawRows.length;
  const sourceRegion =
    readString(rowsPayload.sourceRegion) ?? readString(payload.sourceRegion) ?? 'unknown';
  const targetableRows = rawRows
    .map((row) => readObject(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row, index) => {
      const n = index + 1;
      return {
        rowId: readString(row.rowId) ?? `row_${n}`,
        title: readString(row.title) ?? readString(row.label) ?? `Result ${n}`,
        primaryText: readString(row.primaryText),
        secondaryText: readString(row.secondaryText),
        metaText: readString(row.metaText),
        interactionText: readString(row.interactionText),
        targetRef: readString(row.targetRef),
        visibleTextFields: readStringArray(row.visibleTextFields),
        qualityReasons: readStringArray(row.qualityReasons),
        sourceRegion: readString(row.sourceRegion) ?? sourceRegion,
        confidence: readNumber(row.confidence) ?? 0.7,
      };
    });
  if (targetableRows.length === 0) return null;

  const targetRefCoverageRate =
    readNumber(payload.targetRefCoverageRate) ??
    readNumber(rowsPayload.targetRefCoverageRate) ??
    targetableRows.filter((row) => row.targetRef).length / targetableRows.length;
  const rowExtractionConfidence =
    readNumber(payload.rowExtractionConfidence) ??
    readNumber(rowsPayload.rowExtractionConfidence) ??
    readNumber(rowsPayload.confidence) ??
    0.8;
  const regionQualityScore =
    readNumber(payload.regionQualityScore) ?? readNumber(rowsPayload.regionQualityScore) ?? 0.8;

  return {
    sourceDataSource: 'dom_region_rows',
    available: true,
    rowCount,
    confidence: readNumber(rowsPayload.confidence) ?? rowExtractionConfidence,
    targetRefCoverageRate,
    regionQualityScore,
    sourceTabId:
      readPositiveInteger(payload, 'sourceTabId') ??
      readPositiveInteger(rowsPayload, 'sourceTabId') ??
      readPositiveInteger(readObject(payload.pageProjection) ?? {}, 'tabId'),
    rows: targetableRows,
    visibleRegionRowsUsed:
      payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true,
    visibleRegionRowsRejectedReason: readString(payload.visibleRegionRowsRejectedReason),
    sourceRegion,
    rowExtractionConfidence,
    cardExtractorUsed: payload.cardExtractorUsed === true || rowsPayload.cardExtractorUsed === true,
    cardPatternConfidence:
      readNumber(payload.cardPatternConfidence) ??
      readNumber(rowsPayload.cardPatternConfidence) ??
      0,
    cardRowsCount:
      readPositiveInteger(payload, 'cardRowsCount') ??
      readPositiveInteger(rowsPayload, 'cardRowsCount') ??
      targetableRows.length,
    rowOrder: 'visual_order',
  };
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
  const {
    currentWindowId,
    currentWindowState,
    currentWindowWidth,
    currentWindowHeight,
    currentWindowLeft,
    currentWindowTop,
    isCurrentTabActive,
    isCurrentWindowFocused,
    browserActiveTabId,
    browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab,
  } = runtimeFields;
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
    currentWindowState,
    currentWindowWidth,
    currentWindowHeight,
    currentWindowLeft,
    currentWindowTop,
    isCurrentTabActive,
    isCurrentWindowFocused,
    browserActiveTabId,
    browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab,
    currentTabUrl: runtimeFields.currentTabUrl ?? null,
    currentTabPendingUrl: runtimeFields.currentTabPendingUrl ?? null,
    currentTabTitle: runtimeFields.currentTabTitle ?? null,
    currentTabStatus: runtimeFields.currentTabStatus ?? null,
    currentTabDiscarded: runtimeFields.currentTabDiscarded ?? null,
    currentTabAudible: runtimeFields.currentTabAudible ?? null,
    currentTabMuted: runtimeFields.currentTabMuted ?? null,
    currentTabPinned: runtimeFields.currentTabPinned ?? null,
    currentTabOpenerTabId: runtimeFields.currentTabOpenerTabId ?? null,
    currentTabOpenedBy: runtimeFields.currentTabOpenedBy ?? null,
    currentTabOpenedBySource: runtimeFields.currentTabOpenedBySource ?? null,
    currentTabOpenedByConfidence: runtimeFields.currentTabOpenedByConfidence ?? null,
    currentTabOpenedByReason: runtimeFields.currentTabOpenedByReason ?? null,
    currentTabAiOperationState: runtimeFields.currentTabAiOperationState ?? null,
    currentTabLastAiOperation: runtimeFields.currentTabLastAiOperation ?? null,
    currentTabLastAiOperationAtMs: runtimeFields.currentTabLastAiOperationAtMs ?? null,
    currentTabLastAiOperationConfidence: runtimeFields.currentTabLastAiOperationConfidence ?? null,
    currentTabLastAiOperationReason: runtimeFields.currentTabLastAiOperationReason ?? null,
    currentTabCanTabrixOperate: runtimeFields.currentTabCanTabrixOperate ?? null,
    currentTabOperabilityReason: runtimeFields.currentTabOperabilityReason ?? null,
    currentTabRuntimeStateSource: runtimeFields.currentTabRuntimeStateSource ?? 'unknown',
    browserWorldObjectChangeSummary: runtimeFields.browserWorldObjectChangeSummary ?? null,
    browserWorldActionableObjectChangeSummary:
      runtimeFields.browserWorldActionableObjectChangeSummary ?? null,
    browserWorldCurrentOperationConclusion:
      runtimeFields.browserWorldCurrentOperationConclusion ?? null,
    browserWorldRoutingDecisionSummary: runtimeFields.browserWorldRoutingDecisionSummary ?? null,
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
  options?: { stripReadPageDiagnostics?: boolean },
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
  let responsePayload = payload;
  if (options?.stripReadPageDiagnostics === true) {
    delete payload.aiContextEnvelope;
    responsePayload = stripReadPageDiagnosticNoiseForOutput(payload);
  }
  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

function buildAiFacingTaskState(args: {
  payload: Record<string, unknown>;
  projection: BrowserPageThingProjection;
  fallbackReason: string | null;
  authResumeGate?: TaskAuthResumeGate | null;
}): BrowserTaskStateVerdict {
  const authResumeReason = args.authResumeGate?.blocksTaskResume
    ? `auth_or_login_required:${args.authResumeGate.reason}`
    : null;
  const readinessReason =
    authResumeReason ??
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

function readAuthResumeVerification(
  payload: Record<string, unknown>,
): ReadPageAuthResumeVerification | null {
  const authCollaboration = readObject(payload.authCollaboration);
  const evidence = readObject(authCollaboration?.evidence);
  const resumeVerification = readObject(evidence?.resumeVerification);
  if (!resumeVerification) return null;

  const status = readString(resumeVerification.status);
  if (
    status !== 'not_required' &&
    status !== 'required_after_user_action' &&
    status !== 'fresh_read_required' &&
    status !== 'postcondition_required' &&
    status !== 'not_proven'
  ) {
    return null;
  }
  const nextTool = readString(resumeVerification.nextTool);
  if (nextTool !== 'chrome_read_page') return null;

  const rawSignals = Array.isArray(resumeVerification.requiredSignals)
    ? resumeVerification.requiredSignals
    : [];
  const requiredSignals = rawSignals
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9:_-]{1,96}$/.test(value))
    .slice(0, 12);
  return {
    status,
    nextTool,
    forceRefreshRequired: readBoolean(resumeVerification, 'forceRefreshRequired') === true,
    sameTabRequired: readBoolean(resumeVerification, 'sameTabRequired') === true,
    targetTabId: readPositiveInteger(resumeVerification, 'targetTabId') ?? undefined,
    postconditionRequired: readBoolean(resumeVerification, 'postconditionRequired') === true,
    requiredSignals,
    claimBoundary:
      readString(resumeVerification.claimBoundary) ??
      'auth resume verification must be proven by fresh same-tab read and postcondition evidence',
  };
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

function buildAiFacingSourceRouteHonesty(
  result: SourceRouteHonestyResult,
): Record<string, unknown> {
  const proofGateRequired = isApiCdpProofVerdict(result.verdict);
  return {
    verdict: proofGateRequired ? 'unknown' : result.verdict,
    selectedDataSource: result.selectedDataSource,
    reason: proofGateRequired ? 'api_cdp_reuse_requires_r5_gate' : result.reason,
    fallbackUsed: result.fallbackUsed,
    sourceOrigins: result.sourceOrigins,
    factOrigins: result.factOrigins,
    hasFactEvidence: result.hasFactEvidence,
    proofGate: proofGateRequired ? 'r5_required' : null,
    sourceRouteCandidate: proofGateRequired
      ? result.verdict === 'api_proven'
        ? 'api_source_with_fact_evidence'
        : 'cdp_source_with_fact_evidence'
      : null,
    apiCdpReuseProven: false,
  };
}

function buildAiFacingApiCdpProofBoundary(
  result: SourceRouteHonestyResult,
): Record<string, unknown> {
  if (result.verdict === 'api_proven' || result.verdict === 'cdp_proven') {
    return {
      proofStatus: 'requires_r5_gate',
      apiCdpReuseProven: false,
      selectedDataSource: result.selectedDataSource,
      sourceRouteCandidate:
        result.verdict === 'api_proven'
          ? 'api_source_with_fact_evidence'
          : 'cdp_source_with_fact_evidence',
      reason: 'api_cdp_reuse_requires_r5_gate',
      safeClaim:
        'API/CDP-like source evidence is present, but API/CDP reuse is not proven until the R5 proof gate passes.',
      notSafeClaim:
        'Do not claim API proven, CDP proven, API reuse, CDP reuse, or product delivery grade.',
    };
  }

  if (result.verdict === 'dom_fallback') {
    return {
      proofStatus: 'not_proven_dom_fallback',
      apiCdpReuseProven: false,
      selectedDataSource: result.selectedDataSource,
      sourceRouteCandidate: null,
      reason: result.reason,
      safeClaim: 'This read used a DOM/text fallback route only.',
      notSafeClaim: 'DOM fallback success must not be claimed as API/CDP reuse proof.',
    };
  }

  return {
    proofStatus: result.verdict === 'blocked' ? 'blocked' : 'not_proven',
    apiCdpReuseProven: false,
    selectedDataSource: result.selectedDataSource,
    sourceRouteCandidate: null,
    reason: result.reason,
    safeClaim: 'API/CDP reuse proof is not available from this read.',
    notSafeClaim:
      'Do not claim API proven, CDP proven, API reuse, CDP reuse, or product delivery grade.',
  };
}

function toTaskSourceRouteHonestySnapshot(result: SourceRouteHonestyResult): {
  verdict: string;
  selectedDataSource: string | null;
  reason: string;
  fallbackUsed: boolean;
  hasFactEvidence: boolean;
} {
  const proofGateRequired = isApiCdpProofVerdict(result.verdict);
  return {
    verdict: proofGateRequired ? 'unknown' : result.verdict,
    selectedDataSource: result.selectedDataSource,
    reason: proofGateRequired ? 'api_cdp_reuse_requires_r5_gate' : result.reason,
    fallbackUsed: result.fallbackUsed,
    hasFactEvidence: result.hasFactEvidence,
  };
}

function isApiCdpProofVerdict(verdict: SourceRouteHonestyResult['verdict']): boolean {
  return verdict === 'api_proven' || verdict === 'cdp_proven';
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
  payload.actionEvidenceResult = buildCloseTabsActionEvidenceResult(payload, attachment);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function buildCloseTabsActionEvidenceResult(
  payload: Record<string, unknown>,
  attachment: TaskContextAttachment,
) {
  const closedTabIds = readNumericArray(payload, 'closedTabIds') ?? [];
  const invalidTabIds = readNumericArray(payload, 'invalidTabIds') ?? [];
  const closePreflightEvidence = readObject(payload.closePreflightEvidence);
  const browserHygieneEvidence = readCloseTabsBrowserHygieneEvidenceFromPayload(payload);
  const targetTabIds = readNumericArray(closePreflightEvidence, 'requestedTabIds') ?? [
    ...closedTabIds,
    ...invalidTabIds,
  ];
  const primaryTabId = closedTabIds[0] ?? invalidTabIds[0] ?? targetTabIds[0] ?? null;
  const hygieneStatus =
    browserHygieneEvidence?.tabWindowBaselineUnchanged === false ||
    browserHygieneEvidence?.activeTabRestored === false
      ? 'fail'
      : browserHygieneEvidence
        ? 'pass'
        : 'not_checked';
  const toolSuccess = payload.success === true && closedTabIds.length > 0;
  const negativeEvidence = [
    ...(toolSuccess ? [] : ['close_tabs_not_confirmed']),
    ...(hygieneStatus === 'fail' ? ['browser_hygiene_failed'] : []),
    ...(browserHygieneEvidence ? [] : ['browser_hygiene_evidence_missing']),
  ];

  return buildActionEvidenceResult({
    actionId: `close_tabs-${primaryTabId ?? 'none'}-${Date.now()}`,
    actionKind: 'close_tabs',
    taskSessionId: attachment.taskContextKey,
    tabId: primaryTabId,
    toolSuccess,
    targetBinding: {
      requestedTargetRef: null,
      resolvedTargetRef: null,
      locatorChainSummary: targetTabIds.map((tabId) => `tabId:${tabId}`),
      dispatchTarget: targetTabIds.length > 0 ? 'tab_ids' : 'none',
      frameScope: null,
      targetBindingProven: targetTabIds.length > 0,
      claimBoundary:
        'Close-tabs target binding proves only which tab IDs were requested/closed; it does not prove user task completion.',
    },
    dispatch: {
      dispatched: toolSuccess,
      acceptedByBrowser: toolSuccess,
      errorCode: toolSuccess ? null : 'close_tabs_not_confirmed',
    },
    source: {
      selectedDataSource: 'unknown',
      sourceRouteHonestyVerdict: 'not_checked',
      fallbackUsed: null,
    },
    postAction: {
      postActionReadbackStatus: browserHygieneEvidence ? 'browser_hygiene_observed' : 'not_proven',
      postconditionVerdict: toolSuccess && hygieneStatus !== 'fail' ? 'passed' : 'not_proven',
      freshReadRequired: false,
      readbackSource: browserHygieneEvidence ? 'browser_hygiene_evidence' : 'none',
    },
    business: {
      businessSuccessVerdict: toolSuccess && hygieneStatus !== 'fail' ? 'proven' : 'not_proven',
      businessSuccessProven: toolSuccess && hygieneStatus !== 'fail',
      negativeEvidence,
      nextRequiredCheck:
        toolSuccess && hygieneStatus !== 'fail' ? 'none' : 'inspect_close_tabs_hygiene',
    },
    browserHygiene: {
      required: true,
      status: hygieneStatus,
      leakedTabsOrWindows:
        browserHygieneEvidence && browserHygieneEvidence.after.tabCount > 0
          ? Math.max(
              0,
              browserHygieneEvidence.after.tabCount - browserHygieneEvidence.before.tabCount,
            )
          : null,
    },
    claimBoundary: [
      'Close-tabs tool success proves cleanup of requested tab IDs only.',
      'Browser hygiene evidence does not prove the original business task succeeded.',
      'No API/CDP reuse, release readiness, or competitor parity is proven by this close result.',
    ],
  });
}

function readCloseTabsBrowserHygieneEvidenceFromPayload(
  payload: Record<string, unknown>,
): CloseTabsBrowserHygieneEvidence | null {
  const rawEvidence = readObject(payload.browserHygieneEvidence);
  if (!rawEvidence) return null;
  const before = readCloseTabsBrowserSnapshot(rawEvidence.before);
  const after = readCloseTabsBrowserSnapshot(rawEvidence.after);
  if (!before || !after) return null;
  return {
    before,
    after,
    tabWindowBaselineUnchanged: readNullableBoolean(rawEvidence, 'tabWindowBaselineUnchanged'),
    activeTabRestored: readNullableBoolean(rawEvidence, 'activeTabRestored'),
    activeTabRestoreReason: readString(rawEvidence.activeTabRestoreReason),
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
  if (selected === 'dom_region_rows') {
    return projection.chosenDataSource === 'dom_region_rows'
      ? 'dom_json'
      : projection.chosenDataSource;
  }
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
  const confidence =
    readNumber(payload.rowExtractionConfidence) ??
    readNumber(rowsPayload.rowExtractionConfidence) ??
    readNumber(payload.confidence) ??
    readNumber(rowsPayload.confidence);
  return (
    (payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true) &&
    rowCount !== null &&
    rowCount >= 2 &&
    (confidence === null || confidence >= 0.7) &&
    (coverage === null || coverage >= 0.95) &&
    (quality === null || quality >= 0.7)
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function buildRegionStatePostconditionForPendingInteraction(
  pendingInteraction: TaskPageInteractionSnapshot,
  afterRegions: readonly ReadPageRegion[],
  afterLoadReadiness: PostconditionLoadReadinessGate | null,
  postActionReadback: PostActionReadbackEvidence,
): RegionStatePostconditionResult | null {
  const kind = inferRegionStatePostconditionKindForIntent({
    intent: pendingInteraction.candidateActionIntent,
    actionKind: pendingInteraction.actionKind,
  });
  if (!kind) return null;
  const actionId = pendingInteraction.candidateActionId ?? pendingInteraction.action;
  const freshnessFailure = evaluatePostActionReadbackFreshness(
    pendingInteraction,
    postActionReadback,
  );
  if (freshnessFailure) {
    const producedAtMs = Date.now();
    return {
      actionId,
      kind,
      verdict: 'unknown',
      reason: 'post_action_fresh_read_required',
      beforeSummary: summarizeRegionsForPostcondition(pendingInteraction.beforePageRegions),
      afterSummary: summarizeRegionsForPostcondition(afterRegions),
      producedAtMs,
      claimBoundary: freshnessFailure,
    };
  }
  if (afterLoadReadiness?.canUseSnapshotForBusinessAction === false) {
    const producedAtMs = Date.now();
    return {
      actionId,
      kind,
      verdict: 'unknown',
      reason: 'after_snapshot_not_ready_for_business_action',
      beforeSummary: summarizeRegionsForPostcondition(pendingInteraction.beforePageRegions),
      afterSummary: summarizeRegionsForPostcondition(afterRegions),
      producedAtMs,
      claimBoundary: [
        'region-state postconditions require a business-usable read_page snapshot;',
        `loadReadiness=${afterLoadReadiness.status ?? 'unknown'}`,
        `pageStability=${afterLoadReadiness.pageStability ?? 'unknown'}`,
        afterLoadReadiness.nextStepHint
          ? `nextStepHint=${afterLoadReadiness.nextStepHint}`
          : 'nextStepHint=run_chrome_read_page_force_refresh',
      ].join(' '),
    };
  }
  if (pendingInteraction.beforePageRegions.length === 0 || afterRegions.length === 0) {
    const producedAtMs = Date.now();
    return {
      actionId,
      kind,
      verdict: 'unknown',
      reason:
        pendingInteraction.beforePageRegions.length === 0
          ? 'before_region_evidence_missing'
          : 'after_region_evidence_missing',
      beforeSummary: summarizeRegionsForPostcondition(pendingInteraction.beforePageRegions),
      afterSummary: summarizeRegionsForPostcondition(afterRegions),
      producedAtMs,
      claimBoundary:
        'region-state postconditions require before/after page-region evidence; missing evidence is not business success',
    };
  }
  return verifyRegionStatePostcondition({
    kind,
    actionId,
    beforeRegions: pendingInteraction.beforePageRegions,
    afterRegions,
    targetRefs: pendingInteraction.targetRefs,
  });
}

interface PostActionReadbackEvidence {
  readStartedAtMs: number | null;
  projectionSourceObservedAtMs: number | null;
  sourceFreshness: BrowserSourceFreshness | null;
  projectionId: string | null;
}

function buildPostActionReadbackEvidence(input: {
  projection: BrowserPageThingProjection;
  readStartedAtMs?: number | null;
}): PostActionReadbackEvidence {
  const readStartedAtMs =
    typeof input.readStartedAtMs === 'number' && Number.isFinite(input.readStartedAtMs)
      ? Math.floor(input.readStartedAtMs)
      : null;
  return {
    readStartedAtMs,
    projectionSourceObservedAtMs: parseIsoTimeMs(input.projection.sourceObservedAt),
    sourceFreshness: input.projection.sourceFreshness ?? null,
    projectionId:
      typeof input.projection.projectionId === 'string' && input.projection.projectionId.length > 0
        ? input.projection.projectionId
        : null,
  };
}

function evaluatePostActionReadbackFreshness(
  pendingInteraction: TaskPageInteractionSnapshot,
  evidence: PostActionReadbackEvidence,
): string | null {
  const actionProducedAtMs =
    typeof pendingInteraction.producedAtMs === 'number' &&
    Number.isFinite(pendingInteraction.producedAtMs)
      ? Math.floor(pendingInteraction.producedAtMs)
      : null;
  if (actionProducedAtMs === null) {
    return [
      'Region-state postconditions require a timestamped browser action before post-action readback can prove business success;',
      `sourceFreshness=${evidence.sourceFreshness ?? 'unknown'}`,
      `projectionId=${evidence.projectionId ?? 'unknown'}`,
      'the action timestamp is missing, so the readback/action ordering is not proven.',
    ].join(' ');
  }
  if (evidence.sourceFreshness !== 'fresh') {
    return [
      'Region-state postconditions require a fresh post-action readback;',
      `sourceFreshness=${evidence.sourceFreshness ?? 'unknown'}`,
      `projectionId=${evidence.projectionId ?? 'unknown'}`,
      'run chrome_read_page with forceRefresh=true on the same tab before resuming.',
    ].join(' ');
  }
  if (evidence.readStartedAtMs !== null && evidence.readStartedAtMs < actionProducedAtMs) {
    return [
      'Region-state postconditions require the readback call to start after the browser action;',
      `actionProducedAtMs=${actionProducedAtMs}`,
      `readStartedAtMs=${evidence.readStartedAtMs}`,
      'run chrome_read_page with forceRefresh=true on the same tab before resuming.',
    ].join(' ');
  }
  if (
    evidence.projectionSourceObservedAtMs !== null &&
    evidence.projectionSourceObservedAtMs < actionProducedAtMs
  ) {
    return [
      'Region-state postconditions require page evidence observed after the browser action;',
      `actionProducedAtMs=${actionProducedAtMs}`,
      `sourceObservedAtMs=${evidence.projectionSourceObservedAtMs}`,
      `projectionId=${evidence.projectionId ?? 'unknown'}`,
      'the snapshot may be stale, so it is not business success proof.',
    ].join(' ');
  }
  return null;
}

function parseIsoTimeMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizeRegionsForPostcondition(regions: readonly ReadPageRegion[]): string[] {
  return regions.slice(0, 8).map((region) => {
    const state =
      typeof region.state === 'string' && region.state.length > 0 ? region.state : 'unknown';
    return `${region.regionId}:${region.regionType}:${state}:${region.objects.length}`;
  });
}

function readPagePostconditionRegions(
  payload: Record<string, unknown>,
  regions: ReadPageRegion[],
): ReadPageRegion[] {
  const authFormRegion = buildAuthFormPostconditionRegion(payload.authCollaboration);
  return authFormRegion ? [...regions, authFormRegion] : regions;
}

function readPageRegions(value: unknown): ReadPageRegion[] {
  return Array.isArray(value) ? (value as ReadPageRegion[]) : [];
}

function buildAuthFormPostconditionRegion(value: unknown): ReadPageRegion | null {
  const authCollaboration = readObject(value);
  const authForm = readObject(authCollaboration?.authForm);
  if (!authForm) return null;
  const formType = readString(authForm.formType);
  if (formType !== 'otp') return null;
  const readiness = readString(authForm.readiness) ?? 'not_proven';
  const controls = readObject(authForm.controls);
  const requestOtp = readObject(controls?.requestOtp);
  const otpInput = readObject(controls?.otpInput);
  const requestOtpState = readString(requestOtp?.state);
  const state =
    requestOtpState === 'countdown' || requestOtpState === 'sent_candidate'
      ? 'waiting_for_user_otp'
      : readiness;
  const candidateActionId = readString(requestOtp?.candidateActionId);
  const objects: ReadPageRegion['objects'] = [];
  if (requestOtp) {
    objects.push({
      objectId: 'auth_request_otp',
      label: 'auth request otp control',
      objectType: 'request_otp',
      targetRef: readString(requestOtp.targetRef) ?? undefined,
      actionTypes: candidateActionId ? ['click'] : [],
      targetability: readString(requestOtp.targetRef) ? 'target_ref' : 'not_clickable',
      confidence: readNumber(requestOtp.confidence) ?? 0.7,
      reason: 'privacy_safe_auth_form_postcondition_projection',
      state: requestOtpState ?? 'unknown',
    } as ReadPageRegion['objects'][number]);
  }
  if (otpInput) {
    objects.push({
      objectId: 'auth_otp_input',
      label: 'auth otp input',
      objectType: 'otp_input',
      targetRef: readString(otpInput.targetRef) ?? undefined,
      valueState: readString(otpInput.valueState) === 'non_empty' ? 'non_empty' : 'unknown',
      actionTypes: [],
      targetability: readString(otpInput.targetRef) ? 'target_ref' : 'not_clickable',
      confidence: readNumber(otpInput.confidence) ?? 0.7,
      reason: 'privacy_safe_auth_form_postcondition_projection',
      state: readString(otpInput.state) ?? 'unknown',
    } as ReadPageRegion['objects'][number]);
  }
  return {
    regionId: 'auth_form_postcondition',
    regionType: 'form',
    state,
    confidence: 0.74,
    label: 'auth form postcondition evidence',
    objects,
    candidateActionIds: candidateActionId ? [candidateActionId] : [],
    targetability: candidateActionId ? 'target_ref' : 'not_clickable',
    claimBoundary:
      'native postcondition auth-form projection is privacy-safe state evidence only; it does not include phone, OTP, password, cookie, Authorization, or QR payload',
  };
}

interface PostconditionLoadReadinessGate {
  canUseSnapshotForBusinessAction: boolean | null;
  status: string | null;
  pageStability: string | null;
  nextStepHint: string | null;
}

function readPageLoadReadiness(value: unknown): PostconditionLoadReadinessGate | null {
  const pageContext = readObject(value);
  const loadReadiness = readObject(pageContext?.loadReadiness);
  if (!loadReadiness) return null;
  return {
    canUseSnapshotForBusinessAction:
      typeof loadReadiness.canUseSnapshotForBusinessAction === 'boolean'
        ? loadReadiness.canUseSnapshotForBusinessAction
        : null,
    status: readString(loadReadiness.status),
    pageStability: readString(loadReadiness.pageStability),
    nextStepHint: readString(loadReadiness.nextStepHint),
  };
}

function readPageOperationMap(value: unknown): ReadPageOperationMap | null {
  const object = readObject(value);
  if (!object || !Array.isArray(object.zones)) return null;
  return object as unknown as ReadPageOperationMap;
}

function isReadPageObjectLifecycleSummary(value: unknown): value is ReadPageObjectLifecycleSummary {
  const object = readObject(value);
  if (!object) return false;
  return (
    object.source === 'read_page_regions' &&
    (object.status === 'single_snapshot' || object.status === 'compared_snapshot') &&
    Number.isFinite(object.objectCount) &&
    Number.isFinite(object.changedObjectCount) &&
    Array.isArray(object.items) &&
    Array.isArray(object.changes) &&
    typeof object.claimBoundary === 'string'
  );
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

function readNullableBoolean(input: unknown, key: string): boolean | null {
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

function readInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) ? (raw as number) : null;
}

function readNonNegativeInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : null;
}

function readWindowRuntimeState(input: unknown, key: string): ReadPageWindowRuntimeState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  if (
    raw === 'normal' ||
    raw === 'minimized' ||
    raw === 'maximized' ||
    raw === 'fullscreen' ||
    raw === 'docked' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return null;
}
