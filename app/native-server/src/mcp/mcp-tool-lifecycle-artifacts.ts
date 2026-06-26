import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SemanticSignal } from '@tabrix/shared';
import type { TaskSessionContext } from '../execution/task-session-context';
import {
  produceToolCloseoutLifecycleEvidenceArtifact,
  produceToolFailureLifecycleEvidenceArtifact,
  produceUnifiedTaskCloseoutLifecycleEvidenceArtifact,
} from '../runtime/lifecycle-evidence-collector';
import {
  buildCloseTabsSuccessHygieneChecks,
  extractCloseTabsBrowserHygieneEvidence,
} from './close-tabs-hygiene-evidence';
import { readJsonObjectFromCallToolResult } from './register-tool-result-json';
import {
  readNumericArray,
  readObject,
  readPositiveInteger,
  readString,
} from './register-tool-value-readers';

const TOOL_FAILURE_ARTIFACT_SCENARIO_ID = 'mcp:chrome_read_page:page_unreadable';
const TOOL_CLOSEOUT_ARTIFACT_SCENARIO_ID = 'mcp:chrome_close_tabs:cleanup_success';
const STRUCTURED_READ_GATE_ARTIFACT_SCENARIO_ID = 'mcp:chrome_read_page:structured_read_gate';

export function maybeRecordReadPageFailureLifecycleArtifact(input: {
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

export function maybeRecordStructuredReadGateLifecycleArtifact(input: {
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

export function maybeRecordCloseTabsSuccessLifecycleArtifact(input: {
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
