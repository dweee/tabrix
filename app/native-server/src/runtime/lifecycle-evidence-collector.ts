import type {
  BrowserSourceTruthChain,
  BrowserStreamEvent,
  BrowserStreamEventKind,
  BrowserTaskEvidenceLevel,
  BrowserTaskScenarioClass,
  CorrelationGroupId,
  LifecycleEvidenceArtifact,
  ObservationKind,
  SemanticSignal,
} from '@tabrix/shared';
import {
  registerEventStreamSubscriber,
  unregisterEventStreamSubscriber,
  type EventStreamSubscriber,
} from './browser-event-stream';
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

export interface LifecycleEvidenceCollectorSnapshot {
  registered: boolean;
  bufferedEvents: number;
  bufferedSignals: number;
  droppedEvents: number;
  droppedSignals: number;
  lastEventAtMs: number | null;
  lastSignalAtMs: number | null;
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
let registered = false;
let droppedEvents = 0;
let droppedSignals = 0;
let lastEventAtMs: number | null = null;
let lastSignalAtMs: number | null = null;
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

    while (bufferedEvents.length > maxBufferedEvents) {
      bufferedEvents.shift();
      droppedEvents += 1;
    }
    while (bufferedSignals.length > maxBufferedEvents) {
      bufferedSignals.shift();
      droppedSignals += 1;
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
  droppedEvents = 0;
  droppedSignals = 0;
  lastEventAtMs = null;
  lastSignalAtMs = null;
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
}

export function getLifecycleEvidenceCollectorSnapshot(): LifecycleEvidenceCollectorSnapshot {
  return {
    registered,
    bufferedEvents: bufferedEvents.length,
    bufferedSignals: bufferedSignals.length,
    droppedEvents,
    droppedSignals,
    lastEventAtMs,
    lastSignalAtMs,
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

  return produceLifecycleEvidenceArtifact({
    artifactId: input.artifactId,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    startedAtMs: input.startedAtMs,
    streamEvents,
    semanticSignals,
    sourceTruthChain: input.sourceTruthChain ?? null,
  });
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
