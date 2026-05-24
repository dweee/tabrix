import type {
  BrowserStreamEvent,
  FactObservationPayload,
  LifecycleEventKind,
  PostconditionResult,
  SemanticSignal,
  SemanticSignalKind,
  SignalEvidenceRef,
  TabWindowEventKind,
} from '@tabrix/shared';

export interface DeriveWaitForStabilitySignalOptions {
  explicitUnknownFallback?: boolean;
  confidence?: number;
}

const WAIT_LIFECYCLE_EVENTS = new Set<LifecycleEventKind>([
  'before_navigate',
  'committed',
  'dom_content_loaded',
  'history_state_updated',
  'tab_removed',
]);

const STABLE_LIFECYCLE_EVENTS = new Set<LifecycleEventKind>(['document_complete']);

const WAIT_TAB_EVENTS = new Set<TabWindowEventKind>(['tab_removed', 'tab_replaced']);

/**
 * Pure BNS-02 Batch A rule. It derives only the approved
 * `wait_for_stability` signal, or `unknown` when the caller explicitly asks
 * for fallback and the latest event is not safely understood.
 */
export function deriveWaitForStabilitySignal(
  events: readonly BrowserStreamEvent[],
  nowMs: number,
  options: DeriveWaitForStabilitySignalOptions = {},
): SemanticSignal | null {
  let latestUnknown: BrowserStreamEvent | null = null;
  for (const event of sortNewestFirst(events)) {
    const verdict = classifyEvent(event);
    if (verdict === 'wait_for_stability') {
      return buildSignal(event, 'wait_for_stability', nowMs, options.confidence ?? 0.8);
    }
    if (verdict === 'ready_to_act') {
      return buildSignal(event, 'ready_to_act', nowMs, options.confidence ?? 0.85);
    }
    if (verdict === 'stable') return null;
    latestUnknown ??= event;
  }
  if (!options.explicitUnknownFallback) return null;
  if (!latestUnknown) return null;
  return buildSignal(latestUnknown, 'unknown', nowMs, options.confidence ?? 0.2);
}

export function derivePostconditionFailedSignal(
  postcondition: PostconditionResult,
  streamEvent: BrowserStreamEvent,
  nowMs: number,
): SemanticSignal | null {
  if (postcondition.verdict !== 'failed') return null;
  return buildSignal(streamEvent, 'postcondition_failed', nowMs, 0.85);
}

function sortNewestFirst(events: readonly BrowserStreamEvent[]): BrowserStreamEvent[] {
  return events
    .filter(
      (event): event is BrowserStreamEvent => !!event && typeof event.observedAtMs === 'number',
    )
    .slice()
    .sort((a, b) => b.observedAtMs - a.observedAtMs);
}

type EventVerdict = 'wait_for_stability' | 'ready_to_act' | 'stable' | 'unknown';

function classifyEvent(event: BrowserStreamEvent): EventVerdict {
  const data = getBridgeData(event.sourcePayload);
  if (!data) return 'unknown';

  if (event.kind === 'observation_lifecycle' || event.sourceObservationKind === 'lifecycle_event') {
    return classifyLifecycleData(data);
  }
  if (
    event.kind === 'observation_fact_snapshot' ||
    event.sourceObservationKind === 'fact_snapshot'
  ) {
    return classifyFactSnapshotData(data);
  }
  if (event.kind === 'observation_tab_event' || event.sourceObservationKind === 'tab_event') {
    return classifyTabData(data);
  }
  return 'unknown';
}

function classifyLifecycleData(data: Record<string, unknown>): EventVerdict {
  const eventKind = data.eventKind;
  if (isLifecycleEventKind(eventKind)) {
    if (WAIT_LIFECYCLE_EVENTS.has(eventKind)) return 'wait_for_stability';
    if (STABLE_LIFECYCLE_EVENTS.has(eventKind)) return 'stable';
  }
  return 'unknown';
}

function classifyFactSnapshotData(data: Record<string, unknown>): EventVerdict {
  const envelope = data as { payload?: unknown };
  const payload = asRecord(envelope.payload);
  if (!payload) return 'unknown';

  const eventKind = payload.eventKind;
  if (eventKind !== 'readiness_signal') return 'unknown';

  const signals = asRecord(
    (payload as Extract<FactObservationPayload, { eventKind: 'readiness_signal' }>).signals,
  );
  if (!signals) return 'unknown';

  if (signals.routeStable === 'false' || signals.documentComplete === 'false') {
    return 'wait_for_stability';
  }
  if (
    signals.documentComplete === 'true' &&
    signals.routeStable === 'true' &&
    signals.keyRegionReady === 'true' &&
    signals.networkQuiet === 'true'
  ) {
    return 'ready_to_act';
  }
  if (signals.routeStable === 'true' || signals.documentComplete === 'true') {
    return 'stable';
  }
  return 'unknown';
}

function classifyTabData(data: Record<string, unknown>): EventVerdict {
  const eventKind = data.eventKind;
  if (isTabWindowEventKind(eventKind)) {
    if (WAIT_TAB_EVENTS.has(eventKind)) return 'wait_for_stability';
    if (eventKind === 'bfcache_restored') {
      const stableRefRevalidation = asRecord(data.stableRefRevalidation);
      return stableRefRevalidation?.outcome === 'stale' ? 'wait_for_stability' : 'unknown';
    }
  }
  return 'unknown';
}

function buildSignal(
  event: BrowserStreamEvent,
  kind: SemanticSignalKind,
  producedAtMs: number,
  confidence: number,
): SemanticSignal {
  return {
    signalId: `sig_${kind}_${event.streamEventId}_${producedAtMs}`,
    kind,
    confidence: clampUnit(confidence),
    tabId: event.tabId,
    urlPattern: event.urlPattern,
    sourceEventRefs: [toEvidenceRef(event)],
    sourceOrigins: ['browser_stream'],
    producedAtMs,
  };
}

function toEvidenceRef(event: BrowserStreamEvent): SignalEvidenceRef {
  return {
    streamEventId: event.streamEventId,
    eventKind: event.kind,
    sourceObservationKind: event.sourceObservationKind,
    observedAtMs: event.observedAtMs,
  };
}

function getBridgeData(payload: unknown): Record<string, unknown> | null {
  const record = asRecord(payload);
  if (!record) return null;
  const data = asRecord(record.data);
  return data;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isLifecycleEventKind(value: unknown): value is LifecycleEventKind {
  return typeof value === 'string' && WAIT_LIFECYCLE_EVENTS.has(value as LifecycleEventKind)
    ? true
    : value === 'document_complete' || value === 'unknown';
}

function isTabWindowEventKind(value: unknown): value is TabWindowEventKind {
  return (
    value === 'tab_created' ||
    value === 'tab_removed' ||
    value === 'tab_replaced' ||
    value === 'window_focus_changed' ||
    value === 'bfcache_restored' ||
    value === 'unknown'
  );
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}
