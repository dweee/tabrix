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
  ObservationKind,
  PostconditionResult,
  SemanticSignal,
} from '@tabrix/shared';
import { ACTION_KINDS } from '@tabrix/shared';
import {
  registerEventStreamSubscriber,
  unregisterEventStreamSubscriber,
  type EventStreamSubscriber,
} from './browser-event-stream';
import { classifyActionOutcome } from './action-outcome-classifier';
import { verifyActionPostcondition } from './action-postcondition-verifier';
import { produceLifecycleEvidenceArtifact } from './lifecycle-evidence-artifact';
import { deriveWaitForStabilitySignal } from './semantic-signal-aggregator';

const SUBSCRIBER_ID = 'bns05_lifecycle_evidence_collector';
const DEFAULT_MAX_BUFFERED_EVENTS = 500;

type RuntimeEvidenceLevel = Exclude<BrowserTaskEvidenceLevel, 'real_browser' | 'competitor'>;

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
  sourceTruthChain?: BrowserSourceTruthChain | null;
}

const bufferedEvents: BufferedLifecycleEvidenceEvent[] = [];
const bufferedSignals: BufferedSemanticSignal[] = [];
const bufferedPostconditions: BufferedPostconditionResult[] = [];
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

  return produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents,
    semanticSignals,
    postconditionEvidence: {
      source: 'bns_04_verifier',
      results: postconditionResults,
    },
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
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
  const evidenceLevel = input.evidenceLevel as BrowserTaskEvidenceLevel;
  if (evidenceLevel === 'real_browser' || evidenceLevel === 'competitor') {
    throw new Error('BNS-05 runtime collector does not accept real_browser or competitor evidence');
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
