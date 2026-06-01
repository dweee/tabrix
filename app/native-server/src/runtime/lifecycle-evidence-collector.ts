import type {
  ActionOutcomeEventEnvelope,
  ActionKind,
  BrowserSourceTruthChain,
  BrowserStreamEvent,
  BrowserStreamEventKind,
  BrowserTaskEvidenceLevel,
  BrowserTaskScenarioClass,
  CorrelationGroupId,
  LifecycleEvidenceArtifact,
  LifecycleEvidenceBrowserHygiene,
  LifecycleEvidenceBrowserHygieneCheck,
  LifecycleEvidenceScopeTransition,
  ObservationKind,
  PostconditionResult,
  SemanticSignal,
} from '@tabrix/shared';
import { ACTION_KINDS, BROWSER_TASK_LOCAL_EVIDENCE_LEVEL_VALUES } from '@tabrix/shared';
import {
  registerEventStreamSubscriber,
  unregisterEventStreamSubscriber,
  type EventStreamSubscriber,
} from './browser-event-stream';
import { classifyActionOutcome } from './action-outcome-classifier';
import {
  getActionPostconditionCoverageMatrix,
  type RegionStatePostconditionResult,
  verifyActionPostcondition,
} from './action-postcondition-verifier';
import { recordLifecycleEvidenceArtifact } from './lifecycle-evidence-artifact-store';
import { produceLifecycleEvidenceArtifact } from './lifecycle-evidence-artifact';
import {
  getDefaultPrimaryTabController,
  type PrimaryTabControllerSnapshot,
} from './primary-tab-controller';
import {
  derivePostconditionFailedSignal,
  deriveWaitForStabilitySignal,
} from './semantic-signal-aggregator';
import { deriveDynamicWatchScope, type DynamicWatchScope } from './dynamic-watch-scope';

const SUBSCRIBER_ID = 'bns05_lifecycle_evidence_collector';
const DEFAULT_MAX_BUFFERED_EVENTS = 500;

type RuntimeEvidenceLevel = (typeof BROWSER_TASK_LOCAL_EVIDENCE_LEVEL_VALUES)[number];

interface BufferedLifecycleEvidenceEvent {
  streamEventId: string;
  correlationGroupId: CorrelationGroupId;
  kind: BrowserStreamEventKind;
  observedAtMs: number;
  tabId: number | null;
  urlPattern: string | null;
  sourceObservationKind: ObservationKind | null;
}

interface BufferedSemanticSignal {
  signal: SemanticSignal;
  correlationGroupId: CorrelationGroupId;
}

interface BufferedPostconditionResult {
  result: PostconditionResult;
  correlationGroupId: CorrelationGroupId;
}

export interface LifecycleEvidenceCollectorSnapshot {
  registered: boolean;
  bufferedEvents: number;
  bufferedSignals: number;
  bufferedPostconditions: number;
  droppedEvents: number;
  droppedSignals: number;
  droppedPostconditions: number;
  lastEventAtMs: number | null;
  lastSignalAtMs: number | null;
  lastPostconditionAtMs: number | null;
  maxBufferedEvents: number;
}

export interface RuntimeLifecycleEvidenceArtifactInput {
  artifactId: string;
  evidenceLevel: RuntimeEvidenceLevel;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass | string;
  startedAtMs: number;
  endedAtMs: number;
  eventWindow: {
    tabIds: number[];
    correlationGroupIds?: string[];
  };
  taskContext?: {
    intent?: string | null;
    pageRole?: string | null;
    pageStability?: 'stable' | 'loading' | 'changing' | 'stale' | 'unknown';
  };
  sourceTruthChain?: BrowserSourceTruthChain | null;
}

export interface ToolFailureLifecycleEvidenceArtifactInput {
  artifactId: string;
  evidenceLevel: RuntimeEvidenceLevel;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass | string;
  startedAtMs: number;
  endedAtMs: number;
  actionId: string;
  actionKind: ActionKind;
  tabId: number | null;
  reason: string;
  observedOutcome?: PostconditionResult['observedOutcome'];
  observedOutcomeConfidence?: number;
  sourceTruthChain?: BrowserSourceTruthChain | null;
  semanticSignals?: SemanticSignal[];
}

export interface ToolCloseoutLifecycleEvidenceArtifactInput {
  artifactId: string;
  evidenceLevel: RuntimeEvidenceLevel;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass | string;
  startedAtMs: number;
  endedAtMs: number;
  actionId: string;
  actionKind: ActionKind;
  tabId: number | null;
  reason: string;
  observedOutcome?: PostconditionResult['observedOutcome'];
  observedOutcomeConfidence?: number;
  unsupportedPostconditionReason?: string;
  sourceTruthChain?: BrowserSourceTruthChain | null;
  browserHygiene: Partial<LifecycleEvidenceBrowserHygiene>;
}

export interface TaskLifecycleTimelineEventInput {
  eventId: string;
  index: number;
  at: string;
  kind: string;
  tabId?: number;
  url?: string | null;
  pageRole?: string | null;
}

export interface UnifiedTaskCloseoutLifecycleEvidenceArtifactInput {
  artifactId: string;
  evidenceLevel: RuntimeEvidenceLevel;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass | string;
  startedAtMs: number;
  endedAtMs: number;
  tabIds: number[];
  taskTimeline: readonly TaskLifecycleTimelineEventInput[];
  readAction?: {
    actionId: string;
    tabId: number | null;
    verdict: PostconditionResult['verdict'];
    reason: string;
    observedOutcome?: PostconditionResult['observedOutcome'];
    observedOutcomeConfidence?: number;
  } | null;
  closeAction: {
    actionId: string;
    tabId: number | null;
    reason: string;
    observedOutcome?: PostconditionResult['observedOutcome'];
    observedOutcomeConfidence?: number;
  };
  regionStatePostconditions?: readonly {
    tabId?: number | null;
    actionKind: ActionKind;
    result: RegionStatePostconditionResult;
  }[];
  sourceTruthChain?: BrowserSourceTruthChain | null;
  browserHygiene: Partial<LifecycleEvidenceBrowserHygiene>;
}

const bufferedEvents: BufferedLifecycleEvidenceEvent[] = [];
const bufferedSignals: BufferedSemanticSignal[] = [];
const bufferedPostconditions: BufferedPostconditionResult[] = [];
let hygieneSnapshotProvider: (() => PrimaryTabControllerSnapshot) | null = null;
let registered = false;
let droppedEvents = 0;
let droppedSignals = 0;
let droppedPostconditions = 0;
let lastEventAtMs: number | null = null;
let lastSignalAtMs: number | null = null;
let lastPostconditionAtMs: number | null = null;
let maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS;

const subscriber: EventStreamSubscriber = {
  subscriberId: SUBSCRIBER_ID,
  onEvent(event) {
    const sanitized = sanitizeEvent(event);
    bufferedEvents.push(sanitized);
    lastEventAtMs = sanitized.observedAtMs;
    const signal = deriveWaitForStabilitySignal([event], event.observedAtMs);
    if (signal) {
      bufferedSignals.push({ signal, correlationGroupId: event.correlationGroupId });
      lastSignalAtMs = signal.producedAtMs;
    }
    const postcondition = derivePostconditionResult(event);
    if (postcondition) {
      bufferedPostconditions.push({
        result: postcondition,
        correlationGroupId: event.correlationGroupId,
      });
      lastPostconditionAtMs = postcondition.producedAtMs;
      const postconditionSignal = derivePostconditionFailedSignal(
        postcondition,
        event,
        postcondition.producedAtMs,
      );
      if (postconditionSignal) {
        bufferedSignals.push({
          signal: postconditionSignal,
          correlationGroupId: event.correlationGroupId,
        });
        lastSignalAtMs = postconditionSignal.producedAtMs;
      }
    }

    while (bufferedEvents.length > maxBufferedEvents) {
      bufferedEvents.shift();
      droppedEvents += 1;
    }
    while (bufferedSignals.length > maxBufferedEvents) {
      bufferedSignals.shift();
      droppedSignals += 1;
    }
    while (bufferedPostconditions.length > maxBufferedEvents) {
      bufferedPostconditions.shift();
      droppedPostconditions += 1;
    }
  },
  healthCheck() {
    return { healthy: true };
  },
};

export function ensureLifecycleEvidenceCollectorRegistered(): boolean {
  if (registered) return true;
  const ok = registerEventStreamSubscriber(subscriber);
  registered = ok;
  return ok;
}

export function unregisterLifecycleEvidenceCollector(): boolean {
  const removed = unregisterEventStreamSubscriber(SUBSCRIBER_ID);
  registered = false;
  return removed;
}

export function resetLifecycleEvidenceCollector(): void {
  bufferedEvents.length = 0;
  bufferedSignals.length = 0;
  bufferedPostconditions.length = 0;
  droppedEvents = 0;
  droppedSignals = 0;
  droppedPostconditions = 0;
  lastEventAtMs = null;
  lastSignalAtMs = null;
  lastPostconditionAtMs = null;
}

export function resetLifecycleEvidenceCollectorForTests(): void {
  unregisterLifecycleEvidenceCollector();
  resetLifecycleEvidenceCollector();
  maxBufferedEvents = DEFAULT_MAX_BUFFERED_EVENTS;
  hygieneSnapshotProvider = null;
}

export function setLifecycleEvidenceCollectorMaxBufferedEventsForTests(max: number): void {
  maxBufferedEvents = Math.max(0, Math.floor(max));
  while (bufferedEvents.length > maxBufferedEvents) {
    bufferedEvents.shift();
    droppedEvents += 1;
  }
  while (bufferedSignals.length > maxBufferedEvents) {
    bufferedSignals.shift();
    droppedSignals += 1;
  }
  while (bufferedPostconditions.length > maxBufferedEvents) {
    bufferedPostconditions.shift();
    droppedPostconditions += 1;
  }
}

export function getLifecycleEvidenceCollectorSnapshot(): LifecycleEvidenceCollectorSnapshot {
  return {
    registered,
    bufferedEvents: bufferedEvents.length,
    bufferedSignals: bufferedSignals.length,
    bufferedPostconditions: bufferedPostconditions.length,
    droppedEvents,
    droppedSignals,
    droppedPostconditions,
    lastEventAtMs,
    lastSignalAtMs,
    lastPostconditionAtMs,
    maxBufferedEvents,
  };
}

export function setLifecycleEvidenceCollectorHygieneSnapshotProviderForTests(
  provider: (() => PrimaryTabControllerSnapshot) | null,
): void {
  hygieneSnapshotProvider = provider;
}

export function produceRuntimeLifecycleEvidenceArtifact(
  input: RuntimeLifecycleEvidenceArtifactInput,
): LifecycleEvidenceArtifact {
  assertValidRuntimeArtifactInput(input);
  const tabIds = new Set(input.eventWindow.tabIds);
  const correlationGroupIds = new Set(input.eventWindow.correlationGroupIds ?? []);
  const hasCorrelationFilter = correlationGroupIds.size > 0;

  const streamEvents = bufferedEvents
    .filter(
      (event) => event.observedAtMs >= input.startedAtMs && event.observedAtMs <= input.endedAtMs,
    )
    .filter((event) => event.tabId !== null && tabIds.has(event.tabId))
    .filter((event) => !hasCorrelationFilter || correlationGroupIds.has(event.correlationGroupId))
    .map(toSanitizedStreamEvent);
  const semanticSignals = bufferedSignals
    .filter(
      (entry) =>
        entry.signal.producedAtMs >= input.startedAtMs &&
        entry.signal.producedAtMs <= input.endedAtMs,
    )
    .filter((entry) => entry.signal.tabId !== null && tabIds.has(entry.signal.tabId))
    .filter((entry) => !hasCorrelationFilter || correlationGroupIds.has(entry.correlationGroupId))
    .map((entry) => entry.signal);
  const postconditionResults = bufferedPostconditions
    .filter(
      (entry) =>
        entry.result.producedAtMs >= input.startedAtMs &&
        entry.result.producedAtMs <= input.endedAtMs,
    )
    .filter((entry) => entry.result.tabId !== null && tabIds.has(entry.result.tabId))
    .filter((entry) => !hasCorrelationFilter || correlationGroupIds.has(entry.correlationGroupId))
    .map((entry) => entry.result);

  const artifact = produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents,
    semanticSignals,
    scopeTransitions: buildRuntimeScopeTransitions(input, streamEvents),
    postconditionEvidence: {
      source: 'bns_04_verifier',
      results: postconditionResults,
    },
    browserHygiene: buildRuntimeBrowserHygiene(),
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
  recordLifecycleEvidenceArtifact(artifact);
  return artifact;
}

export function produceToolFailureLifecycleEvidenceArtifact(
  input: ToolFailureLifecycleEvidenceArtifactInput,
): LifecycleEvidenceArtifact {
  assertValidToolFailureArtifactInput(input);
  const postconditionResult: PostconditionResult = {
    actionId: input.actionId,
    actionKind: input.actionKind,
    tabId: input.tabId,
    urlPattern: null,
    verdict: 'failed',
    reason: input.reason,
    observedOutcome: input.observedOutcome ?? 'unknown',
    observedOutcomeConfidence: input.observedOutcomeConfidence ?? 0.85,
    sourceEventRefs: [{ kind: 'unknown', id: input.actionId, origin: 'runtime' }],
    sourceOrigins: ['runtime', 'inference'],
    producedAtMs: input.endedAtMs,
  };

  const artifact = produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents: [],
    semanticSignals: input.semanticSignals ?? [],
    scopeTransitions: [],
    postconditionEvidence: {
      source: 'bns_04_verifier',
      results: [postconditionResult],
    },
    browserHygiene: buildRuntimeBrowserHygiene(),
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
  recordLifecycleEvidenceArtifact(artifact);
  return artifact;
}

export function produceToolCloseoutLifecycleEvidenceArtifact(
  input: ToolCloseoutLifecycleEvidenceArtifactInput,
): LifecycleEvidenceArtifact {
  assertValidToolCloseoutArtifactInput(input);
  const supportedPostcondition = isSupportedCloseoutPostconditionAction(input.actionKind);
  const postconditionResult: PostconditionResult = {
    actionId: input.actionId,
    actionKind: input.actionKind,
    tabId: input.tabId,
    urlPattern: null,
    verdict: supportedPostcondition ? 'passed' : 'unknown',
    reason: supportedPostcondition
      ? input.reason
      : (input.unsupportedPostconditionReason ?? 'unsupported_action_kind_postcondition'),
    observedOutcome: input.observedOutcome ?? 'unknown',
    observedOutcomeConfidence: input.observedOutcomeConfidence ?? 0.75,
    sourceEventRefs: [{ kind: 'unknown', id: input.actionId, origin: 'runtime' }],
    sourceOrigins: ['runtime', 'inference'],
    producedAtMs: input.endedAtMs,
  };

  const artifact = produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents: [],
    semanticSignals: [],
    scopeTransitions: [],
    postconditionEvidence: {
      source: 'bns_04_verifier',
      results: [postconditionResult],
    },
    browserHygiene: {
      ...input.browserHygiene,
      available: true,
    },
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
  recordLifecycleEvidenceArtifact(artifact);
  return artifact;
}

export function produceUnifiedTaskCloseoutLifecycleEvidenceArtifact(
  input: UnifiedTaskCloseoutLifecycleEvidenceArtifactInput,
): LifecycleEvidenceArtifact {
  assertValidUnifiedTaskCloseoutArtifactInput(input);
  const streamEvents = input.taskTimeline.map((event, index) =>
    taskTimelineEventToStreamEvent(event, input, index),
  );
  const semanticSignals = deriveTaskTimelineSemanticSignals(streamEvents, input.taskTimeline);
  const postconditionResults = buildUnifiedTaskPostconditionResults(input);

  const artifact = produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents,
    semanticSignals,
    scopeTransitions: buildUnifiedTaskScopeTransitions(input),
    postconditionEvidence: {
      source: 'bns_04_verifier',
      results: postconditionResults,
    },
    browserHygiene: {
      ...input.browserHygiene,
      available: true,
    },
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
  recordLifecycleEvidenceArtifact(artifact);
  return artifact;
}

function buildRuntimeScopeTransitions(
  input: RuntimeLifecycleEvidenceArtifactInput,
  streamEvents: BrowserStreamEvent[],
): LifecycleEvidenceScopeTransition[] {
  if (!input.taskContext) return [];

  const scope = deriveDynamicWatchScope({
    tabId: input.eventWindow.tabIds[0] ?? null,
    intent: input.taskContext.intent ?? null,
    pageRole: input.taskContext.pageRole ?? null,
    pageStability: input.taskContext.pageStability ?? 'unknown',
    evidenceWindow: {
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      eventsByKind: countEventsByKind(streamEvents),
    },
    nowMs: input.endedAtMs,
  });

  return [toLifecycleScopeTransition(scope)];
}

function toLifecycleScopeTransition(scope: DynamicWatchScope): LifecycleEvidenceScopeTransition {
  return {
    scopeKind: scope.scopeKind,
    tabId: scope.tabId,
    regions: scope.regions.map((region) => ({
      regionId: region.regionId,
      regionPurpose: region.regionPurpose,
      expectedRole: region.expectedRole,
    })),
    confidence: scope.confidence,
    reason: scope.reason,
    producedAtMs: scope.producedAtMs,
  };
}

function countEventsByKind(events: BrowserStreamEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function derivePostconditionResult(event: BrowserStreamEvent): PostconditionResult | null {
  if (event.sourceObservationKind !== 'action_outcome') return null;
  const envelope = extractActionOutcomeEnvelope(event.sourcePayload);
  if (!envelope) return null;

  try {
    const snapshot = classifyActionOutcome(envelope, {
      now: () => event.observedAtMs,
    });
    return verifyActionPostcondition(envelope, snapshot, {
      now: () => event.observedAtMs,
    });
  } catch {
    return null;
  }
}

function extractActionOutcomeEnvelope(sourcePayload: unknown): ActionOutcomeEventEnvelope | null {
  if (!sourcePayload || typeof sourcePayload !== 'object') return null;
  const payload = sourcePayload as { data?: unknown };
  if (!payload.data || typeof payload.data !== 'object') return null;
  const data = payload.data as Partial<ActionOutcomeEventEnvelope>;
  if (
    typeof data.actionId !== 'string' ||
    !isActionKind(data.actionKind) ||
    typeof data.tabId !== 'number' ||
    !Number.isFinite(data.tabId) ||
    typeof data.observedAtMs !== 'number' ||
    !Number.isFinite(data.observedAtMs) ||
    !Array.isArray(data.signals)
  ) {
    return null;
  }
  return {
    actionId: data.actionId,
    actionKind: data.actionKind,
    tabId: data.tabId,
    urlPattern: typeof data.urlPattern === 'string' ? data.urlPattern : null,
    observedAtMs: data.observedAtMs,
    signals: data.signals,
  };
}

function isActionKind(value: unknown): value is ActionKind {
  return typeof value === 'string' && (ACTION_KINDS as readonly string[]).includes(value);
}

function isSupportedCloseoutPostconditionAction(actionKind: ActionKind): boolean {
  const coverageRow = getActionPostconditionCoverageMatrix().find(
    (row) => row.sharedActionKind === actionKind,
  );
  return coverageRow?.status === 'supported';
}

function taskTimelineEventToStreamEvent(
  event: TaskLifecycleTimelineEventInput,
  input: UnifiedTaskCloseoutLifecycleEvidenceArtifactInput,
  index: number,
): BrowserStreamEvent {
  const observedAtMs = Date.parse(event.at);
  return {
    streamEventId: `task_${sanitizeIdentifier(event.eventId || `event_${index + 1}`)}`,
    correlationGroupId: `task_${sanitizeIdentifier(input.scenarioId)}`,
    kind: 'observation_unknown',
    observedAtMs: Number.isFinite(observedAtMs) ? observedAtMs : input.startedAtMs + index,
    tabId: normalizeTimelineTabId(event.tabId, input.tabIds),
    urlPattern: null,
    sourceObservationKind: null,
    sourcePayload: null,
  };
}

function deriveTaskTimelineSemanticSignals(
  streamEvents: BrowserStreamEvent[],
  timeline: readonly TaskLifecycleTimelineEventInput[],
): SemanticSignal[] {
  const signals: SemanticSignal[] = [];
  for (let index = 0; index < timeline.length; index += 1) {
    const event = timeline[index];
    const streamEvent = streamEvents[index];
    if (!streamEvent) continue;
    if (event.kind === 'readiness_observed' || event.kind === 'projection_created') {
      signals.push({
        signalId: `sig_ready_${streamEvent.streamEventId}`,
        kind: 'ready_to_act',
        confidence: 0.75,
        tabId: streamEvent.tabId,
        urlPattern: null,
        sourceEventRefs: [
          {
            streamEventId: streamEvent.streamEventId,
            eventKind: streamEvent.kind,
            sourceObservationKind: null,
            observedAtMs: streamEvent.observedAtMs,
          },
        ],
        sourceOrigins: ['page_projection'],
        producedAtMs: streamEvent.observedAtMs,
      });
    }
    if (event.kind === 'region_changed' || event.kind === 'delta_created') {
      signals.push({
        signalId: `sig_results_${streamEvent.streamEventId}`,
        kind: 'results_changed',
        confidence: 0.7,
        tabId: streamEvent.tabId,
        urlPattern: null,
        sourceEventRefs: [
          {
            streamEventId: streamEvent.streamEventId,
            eventKind: streamEvent.kind,
            sourceObservationKind: null,
            observedAtMs: streamEvent.observedAtMs,
          },
        ],
        sourceOrigins: ['page_projection'],
        producedAtMs: streamEvent.observedAtMs,
      });
    }
  }
  return signals;
}

function buildUnifiedTaskPostconditionResults(
  input: UnifiedTaskCloseoutLifecycleEvidenceArtifactInput,
): PostconditionResult[] {
  const results: PostconditionResult[] = [];
  if (input.readAction) {
    results.push({
      actionId: input.readAction.actionId,
      actionKind: 'read',
      tabId: input.readAction.tabId,
      urlPattern: null,
      verdict: input.readAction.verdict,
      reason: input.readAction.reason,
      observedOutcome: input.readAction.observedOutcome ?? 'unknown',
      observedOutcomeConfidence: input.readAction.observedOutcomeConfidence ?? 0.7,
      sourceEventRefs: [{ kind: 'unknown', id: input.readAction.actionId, origin: 'runtime' }],
      sourceOrigins: ['runtime', 'inference'],
      producedAtMs: input.endedAtMs,
    });
  }
  for (const regionState of input.regionStatePostconditions ?? []) {
    const regionStateTabId = normalizeRegionStatePostconditionTabId(regionState.tabId);
    results.push({
      actionId: regionState.result.actionId,
      actionKind: regionState.actionKind,
      tabId: regionStateTabId ?? (input.tabIds.length === 1 ? (input.tabIds[0] ?? null) : null),
      urlPattern: null,
      verdict: regionState.result.verdict,
      reason: buildRegionStatePostconditionReason(regionState.result),
      observedOutcome: 'unknown',
      observedOutcomeConfidence: regionState.result.verdict === 'unknown' ? 0.5 : 0.75,
      sourceEventRefs: [
        {
          kind: 'unknown',
          id: `region_state:${regionState.result.kind}:${regionState.result.actionId}`,
          origin: 'inference',
        },
      ],
      sourceOrigins: ['runtime', 'inference'],
      producedAtMs: regionState.result.producedAtMs,
    });
  }
  results.push({
    actionId: input.closeAction.actionId,
    actionKind: 'close',
    tabId: input.closeAction.tabId,
    urlPattern: null,
    verdict: 'passed',
    reason: input.closeAction.reason,
    observedOutcome: input.closeAction.observedOutcome ?? 'unknown',
    observedOutcomeConfidence: input.closeAction.observedOutcomeConfidence ?? 0.75,
    sourceEventRefs: [{ kind: 'unknown', id: input.closeAction.actionId, origin: 'runtime' }],
    sourceOrigins: ['runtime', 'inference'],
    producedAtMs: input.endedAtMs,
  });
  return results;
}

function buildRegionStatePostconditionReason(result: RegionStatePostconditionResult): string {
  const before = result.beforeSummary.join('|') || 'none';
  const after = result.afterSummary.join('|') || 'none';
  return [
    `region_state_${result.kind}`,
    result.reason,
    `before=${before}`,
    `after=${after}`,
    buildDetailFieldReadbackReason(result.detailFieldReadbackEvidence),
    result.claimBoundary,
  ]
    .filter(Boolean)
    .join(';')
    .slice(0, 600);
}

function buildDetailFieldReadbackReason(
  evidence: RegionStatePostconditionResult['detailFieldReadbackEvidence'],
): string | null {
  if (!evidence) return null;
  const counts = evidence.fieldCounts;
  return [
    'detail_field_readback',
    `status=${evidence.status}`,
    `summaryReady=${evidence.canSupportDetailSummary}`,
    `targetBinding=${evidence.targetBindingProven}`,
    `semantic=${evidence.semanticMatch}`,
    `structured=${counts.totalStructuredObjects}`,
    `title=${counts.titleLikeObjects}`,
    `body=${counts.bodyLikeObjects}`,
    `metadata=${counts.metadataLikeObjects}`,
    `next=${evidence.nextRequiredCheck}`,
  ].join(':');
}

function normalizeRegionStatePostconditionTabId(tabId: unknown): number | null {
  if (typeof tabId === 'number' && Number.isInteger(tabId) && tabId > 0) return tabId;
  return null;
}

function buildUnifiedTaskScopeTransitions(
  input: UnifiedTaskCloseoutLifecycleEvidenceArtifactInput,
): LifecycleEvidenceScopeTransition[] {
  const pageRole = inferTimelinePageRole(input.taskTimeline);
  const scope = deriveDynamicWatchScope({
    tabId: input.tabIds[0] ?? null,
    intent: inferTimelineIntent(input.taskTimeline),
    pageRole,
    pageStability: 'stable',
    evidenceWindow: {
      startedAtMs: input.startedAtMs,
      endedAtMs: input.endedAtMs,
      eventsByKind: countTimelineEventsByKind(input.taskTimeline),
    },
    nowMs: input.endedAtMs,
  });
  return [toLifecycleScopeTransition(scope)];
}

function inferTimelineIntent(timeline: readonly TaskLifecycleTimelineEventInput[]): string {
  const hasCleanup = timeline.some((event) => event.kind === 'cleanup');
  const hasRead = timeline.some(
    (event) => event.kind === 'readiness_observed' || event.kind === 'projection_created',
  );
  const hasNavigation = timeline.some((event) => event.kind === 'navigation');
  if (hasNavigation && hasRead && hasCleanup) return 'navigate_read_close';
  if (hasRead && hasCleanup) return 'read_close';
  return 'task_closeout';
}

function inferTimelinePageRole(
  timeline: readonly TaskLifecycleTimelineEventInput[],
): string | null {
  const eventWithPageRole = timeline.find(
    (event): event is TaskLifecycleTimelineEventInput & { pageRole: string } =>
      typeof (event as TaskLifecycleTimelineEventInput & { pageRole?: unknown }).pageRole ===
        'string' &&
      ((event as TaskLifecycleTimelineEventInput & { pageRole?: string }).pageRole?.length ?? 0) >
        0,
  );
  return eventWithPageRole?.pageRole ?? null;
}

function countTimelineEventsByKind(
  timeline: readonly TaskLifecycleTimelineEventInput[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of timeline) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function normalizeTimelineTabId(tabId: unknown, tabIds: readonly number[]): number | null {
  if (typeof tabId === 'number' && Number.isInteger(tabId) && tabId > 0) return tabId;
  return tabIds[0] ?? null;
}

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 120);
}

function buildRuntimeBrowserHygiene(): Partial<LifecycleEvidenceBrowserHygiene> | null {
  const snapshot = getRuntimeHygieneSnapshot();
  if (
    snapshot.expectedPrimaryTabNavigations === 0 &&
    snapshot.benchmarkOwnedTabCount === 0 &&
    snapshot.violations.length === 0
  ) {
    return null;
  }

  const baselineChanged =
    snapshot.violations.length > 0 ||
    (snapshot.primaryTabReuseRate !== null && snapshot.primaryTabReuseRate < 1);
  const notes = [
    `primaryTabReuseRate=${formatNullableNumber(snapshot.primaryTabReuseRate)}`,
    `benchmarkOwnedTabCount=${snapshot.benchmarkOwnedTabCount}`,
    `violations=${snapshot.violations.length}`,
  ];

  return {
    available: true,
    baselineTabs: null,
    runOwnedTabsClosed: null,
    baselineChanged,
    checks: buildRuntimeBrowserHygieneChecks(snapshot, baselineChanged),
    notes,
  };
}

function buildRuntimeBrowserHygieneChecks(
  snapshot: PrimaryTabControllerSnapshot,
  baselineChanged: boolean,
): LifecycleEvidenceBrowserHygieneCheck[] {
  const primaryTabRestoreObserved =
    snapshot.expectedPrimaryTabNavigations > 0 && snapshot.primaryTabReuseRate !== null;
  const activeTabRestoreVerdict =
    primaryTabRestoreObserved && snapshot.primaryTabReuseRate !== null
      ? snapshot.primaryTabReuseRate >= 1
        ? 'pass'
        : 'fail'
      : 'unknown';

  return [
    {
      kind: 'tab_window_baseline',
      verdict: baselineChanged ? 'fail' : 'pass',
      reason: baselineChanged
        ? 'pre_post_tab_window_baseline_changed'
        : 'pre_post_tab_window_baseline_unchanged',
    },
    {
      kind: 'active_tab_restore',
      verdict: activeTabRestoreVerdict,
      reason:
        activeTabRestoreVerdict === 'pass'
          ? 'active_tab_restored'
          : activeTabRestoreVerdict === 'fail'
            ? 'active_tab_not_restored'
            : 'browser_hygiene_check_not_reported',
    },
    {
      kind: 'run_owned_cleanup',
      verdict: 'unknown',
      reason: 'browser_hygiene_check_not_reported',
    },
    {
      kind: 'user_owned_protection',
      verdict: 'unknown',
      reason: 'browser_hygiene_check_not_reported',
    },
    {
      kind: 'failure_cleanup',
      verdict: 'unknown',
      reason: 'browser_hygiene_check_not_reported',
    },
  ];
}

function getRuntimeHygieneSnapshot(): PrimaryTabControllerSnapshot {
  return hygieneSnapshotProvider
    ? hygieneSnapshotProvider()
    : getDefaultPrimaryTabController().getSnapshot();
}

function formatNullableNumber(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3);
}

function sanitizeEvent(event: BrowserStreamEvent): BufferedLifecycleEvidenceEvent {
  return {
    streamEventId: event.streamEventId,
    correlationGroupId: event.correlationGroupId,
    kind: event.kind,
    observedAtMs: event.observedAtMs,
    tabId: event.tabId,
    urlPattern: event.urlPattern,
    sourceObservationKind: event.sourceObservationKind,
  };
}

function toSanitizedStreamEvent(event: BufferedLifecycleEvidenceEvent): BrowserStreamEvent {
  return {
    ...event,
    sourcePayload: null,
  };
}

function assertValidRuntimeArtifactInput(input: RuntimeLifecycleEvidenceArtifactInput): void {
  if (!isRuntimeEvidenceLevel(input.evidenceLevel)) {
    throw new Error(
      'BNS-05 runtime collector only accepts source, unit, integration, or local_runner evidence',
    );
  }
  if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.endedAtMs)) {
    throw new Error('BNS-05 runtime collector requires finite startedAtMs and endedAtMs');
  }
  if (input.endedAtMs < input.startedAtMs) {
    throw new Error('BNS-05 runtime collector requires endedAtMs >= startedAtMs');
  }
  if (!Array.isArray(input.eventWindow.tabIds) || input.eventWindow.tabIds.length === 0) {
    throw new Error('BNS-05 runtime collector requires a non-empty tabIds event window');
  }
}

function assertValidToolFailureArtifactInput(
  input: ToolFailureLifecycleEvidenceArtifactInput,
): void {
  if (!isRuntimeEvidenceLevel(input.evidenceLevel)) {
    throw new Error(
      'BNS-05 tool failure collector only accepts source, unit, integration, or local_runner evidence',
    );
  }
  if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.endedAtMs)) {
    throw new Error('BNS-05 tool failure collector requires finite startedAtMs and endedAtMs');
  }
  if (input.endedAtMs < input.startedAtMs) {
    throw new Error('BNS-05 tool failure collector requires endedAtMs >= startedAtMs');
  }
  if (input.actionId.length === 0) {
    throw new Error('BNS-05 tool failure collector requires actionId');
  }
  if (!isActionKind(input.actionKind)) {
    throw new Error('BNS-05 tool failure collector requires a valid actionKind');
  }
  if (input.reason.length === 0) {
    throw new Error('BNS-05 tool failure collector requires reason');
  }
}

function assertValidToolCloseoutArtifactInput(
  input: ToolCloseoutLifecycleEvidenceArtifactInput,
): void {
  if (!isRuntimeEvidenceLevel(input.evidenceLevel)) {
    throw new Error(
      'BNS-05 tool closeout collector only accepts source, unit, integration, or local_runner evidence',
    );
  }
  if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.endedAtMs)) {
    throw new Error('BNS-05 tool closeout collector requires finite startedAtMs and endedAtMs');
  }
  if (input.endedAtMs < input.startedAtMs) {
    throw new Error('BNS-05 tool closeout collector requires endedAtMs >= startedAtMs');
  }
  if (input.actionId.length === 0) {
    throw new Error('BNS-05 tool closeout collector requires actionId');
  }
  if (!isActionKind(input.actionKind)) {
    throw new Error('BNS-05 tool closeout collector requires a valid actionKind');
  }
  if (input.reason.length === 0) {
    throw new Error('BNS-05 tool closeout collector requires reason');
  }
  if (input.browserHygiene.baselineChanged !== false) {
    throw new Error('BNS-05 tool closeout collector requires unchanged browser hygiene');
  }
}

function assertValidUnifiedTaskCloseoutArtifactInput(
  input: UnifiedTaskCloseoutLifecycleEvidenceArtifactInput,
): void {
  if (!isRuntimeEvidenceLevel(input.evidenceLevel)) {
    throw new Error(
      'BNS-05 unified task closeout only accepts source, unit, integration, or local_runner evidence',
    );
  }
  if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.endedAtMs)) {
    throw new Error('BNS-05 unified task closeout requires finite startedAtMs and endedAtMs');
  }
  if (input.endedAtMs < input.startedAtMs) {
    throw new Error('BNS-05 unified task closeout requires endedAtMs >= startedAtMs');
  }
  if (!Array.isArray(input.tabIds) || input.tabIds.length === 0) {
    throw new Error('BNS-05 unified task closeout requires at least one tabId');
  }
  if (!Array.isArray(input.taskTimeline) || input.taskTimeline.length === 0) {
    throw new Error('BNS-05 unified task closeout requires a non-empty task timeline');
  }
  if (input.browserHygiene.baselineChanged !== false) {
    throw new Error('BNS-05 unified task closeout requires unchanged browser hygiene');
  }
}

function isRuntimeEvidenceLevel(
  evidenceLevel: BrowserTaskEvidenceLevel,
): evidenceLevel is RuntimeEvidenceLevel {
  return (BROWSER_TASK_LOCAL_EVIDENCE_LEVEL_VALUES as readonly BrowserTaskEvidenceLevel[]).includes(
    evidenceLevel,
  );
}
