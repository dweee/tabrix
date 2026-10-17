/**
 * Browser Event Stream (BNS-01).
 *
 * What this module is:
 * - A subscriber-based event stream that fans out `BrowserStreamEvent`
 *   instances to registered subscribers after bridge observation
 *   ingestion.
 * - The correlation-group derivation is a pure function over (tabId,
 *   observedAtMs) — same tab + within CORRELATION_WINDOW_MS = same group.
 * - Health snapshots are pure data; no raw event payloads leak.
 *
 * What this module is NOT:
 * - It does NOT replace the bridge transport or `BridgeObservationMessage`.
 * - It does NOT persist events.
 * - It does NOT expose events through MCP tools.
 * - It does NOT define semantic signals.
 *
 * Cross-ref:
 * - Shared types: `packages/shared/src/browser-fact.ts` (BNS-01 section).
 * - Ingest funnel: `observation-ingest.ts`.
 * - Diagnostics: `observation-diagnostics.ts`.
 */

import type {
  BridgeObservationMessage,
  BrowserStreamEvent,
  BrowserStreamEventKind,
  CorrelationGroupId,
  ObservationKind,
  StreamHealthSnapshot,
  StreamSubscriberHealth,
} from '@tabrix/shared';
import { BROWSER_STREAM_EVENT_KINDS, OBSERVATION_TO_STREAM_EVENT_KIND } from '@tabrix/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Time window (ms) within which events on the same tab share a
 * correlation group. Pinned by the snapshot test for
 * `browser-event-stream.test.ts`.
 */
export const CORRELATION_WINDOW_MS = 2000 as const;

/** Maximum subscribers before registration is refused. */
const MAX_SUBSCRIBERS = 32;

// ---------------------------------------------------------------------------
// Subscriber interface
// ---------------------------------------------------------------------------

/**
 * Runtime subscriber contract. Downstream modules implement this to
 * receive stream events. Each subscriber tracks its own health state;
 * the stream router snapshots health on demand.
 *
 * This interface is native-server-side only — the shared package carries
 * the pure-data `StreamSubscriberHealth` snapshot.
 */
export interface EventStreamSubscriber {
  /** Unique subscriber id assigned at registration. */
  subscriberId: string;
  /** Called for each dispatched event. Implementations must not throw. */
  onEvent(event: BrowserStreamEvent): void;
  /** Called by the health-check loop. Returns current health status. */
  healthCheck(): { healthy: boolean };
}

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

interface MutableSubscriberState {
  subscriber: EventStreamSubscriber;
  registeredAtMs: number;
  eventsDispatched: number;
  eventsDropped: number;
  lastAcknowledgedAtMs: number | null;
}

interface PerTabCorrelation {
  groupId: CorrelationGroupId;
  lastEventMs: number;
}

const subscribers: MutableSubscriberState[] = [];
let nextGroupCounter = 0;

/** Per-tab correlation state. Keyed by tabId. */
const tabCorrelationMap = new Map<number, PerTabCorrelation>();

let totalEventsDispatched = 0;
let totalEventsDropped = 0;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic correlation group id derivation.
 *
 * Rules:
 * - Same `tabId` + observedAtMs within `CORRELATION_WINDOW_MS` of the
 *   previous event = same group id.
 * - Different `tabId`, or event outside the window = new group id.
 * - `tabId` = null or undefined always produces a new group id.
 * - `observedAtMs` = null uses `Date.now()` internally (non-deterministic,
 *   used only in production paths; tests inject explicit timestamps).
 */
export function deriveCorrelationGroupId(
  tabId: number | null,
  observedAtMs: number | null,
): CorrelationGroupId {
  if (tabId === null || tabId === undefined || !Number.isFinite(tabId)) {
    nextGroupCounter += 1;
    const id = `corr_${String(nextGroupCounter).padStart(8, '0')}`;
    return id;
  }

  const now = Number.isFinite(observedAtMs) ? (observedAtMs as number) : Date.now();
  const existing = tabCorrelationMap.get(tabId);

  if (existing && now - existing.lastEventMs <= CORRELATION_WINDOW_MS) {
    existing.lastEventMs = now;
    return existing.groupId;
  }

  nextGroupCounter += 1;
  const newId = `corr_${String(nextGroupCounter).padStart(8, '0')}`;
  tabCorrelationMap.set(tabId, { groupId: newId, lastEventMs: now });
  return newId;
}

/**
 * Produce a unique stream event id. Format: `evt_<10-hex>`.
 * Uses a monotonic counter for determinism; tests reset it.
 */
let nextEventCounter = 0;

function nextStreamEventId(): string {
  nextEventCounter += 1;
  return `evt_${nextEventCounter.toString(16).padStart(10, '0')}`;
}

/**
 * Map a `BridgeObservationMessage` payload kind to the corresponding
 * stream event kind. Uses the frozen mapping from shared so downstream
 * subscribers see stable kinds.
 */
function mapObservationKindToStreamKind(kind: ObservationKind): BrowserStreamEventKind {
  return OBSERVATION_TO_STREAM_EVENT_KIND[kind] ?? 'observation_unknown';
}

/**
 * Build a `BrowserStreamEvent` from a bridge observation message.
 * Pure transformation — no side effects, no correlation tracking.
 * The caller is responsible for deriving the correlation group id
 * after the event is built (so `tabId` and `observedAtMs` are available).
 */
function buildStreamEvent(
  message: BridgeObservationMessage,
  correlationGroupId: CorrelationGroupId,
): BrowserStreamEvent {
  const payload = message?.payload;
  const sourceKind: ObservationKind =
    payload && typeof payload === 'object' && typeof payload.kind === 'string'
      ? (payload.kind as ObservationKind)
      : 'unknown';

  let tabId: number | null = null;
  let urlPattern: string | null = null;
  let observedAtMs = message?.sentAt ?? Date.now();

  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.tabId === 'number') tabId = d.tabId;
      if (typeof d.urlPattern === 'string') urlPattern = d.urlPattern;
      if (typeof d.observedAtMs === 'number') observedAtMs = d.observedAtMs;
    }
  }

  return {
    streamEventId: nextStreamEventId(),
    correlationGroupId,
    kind: mapObservationKindToStreamKind(sourceKind),
    observedAtMs,
    tabId,
    urlPattern,
    sourceObservationKind: sourceKind,
    sourcePayload: payload ?? null,
  };
}

// ---------------------------------------------------------------------------
// Subscriber registry
// ---------------------------------------------------------------------------

/**
 * Register a subscriber. Returns `true` on success, `false` if the
 * subscriber id is already registered or the max subscriber count is
 * reached.
 */
export function registerEventStreamSubscriber(subscriber: EventStreamSubscriber): boolean {
  if (!subscriber?.subscriberId || typeof subscriber.onEvent !== 'function') {
    return false;
  }

  const exists = subscribers.find((s) => s.subscriber.subscriberId === subscriber.subscriberId);
  if (exists) return false;

  if (subscribers.length >= MAX_SUBSCRIBERS) return false;

  subscribers.push({
    subscriber,
    registeredAtMs: Date.now(),
    eventsDispatched: 0,
    eventsDropped: 0,
    lastAcknowledgedAtMs: null,
  });

  return true;
}

/**
 * Unregister a subscriber by id. Returns `true` if the subscriber was
 * found and removed.
 */
export function unregisterEventStreamSubscriber(subscriberId: string): boolean {
  const idx = subscribers.findIndex((s) => s.subscriber.subscriberId === subscriberId);
  if (idx === -1) return false;
  subscribers.splice(idx, 1);
  return true;
}

/**
 * Get the count of currently registered subscribers.
 */
export function getEventStreamSubscriberCount(): number {
  return subscribers.length;
}

// ---------------------------------------------------------------------------
// Event dispatch (fan-out)
// ---------------------------------------------------------------------------

/**
 * Ingest a bridge observation message into the stream. This is the
 * main fan-out entry point called by `observation-ingest.ts`.
 *
 * Dispatch is fire-and-forget: each subscriber is called in sequence,
 * and a slow or throwing subscriber is isolated (its error is counted
 * in `eventsDropped` but does not block other subscribers).
 */
export function dispatchBridgeObservationToStream(message: BridgeObservationMessage): void {
  if (!message) {
    totalEventsDropped += 1;
    return;
  }

  // Extract tabId + observedAtMs from the payload for correlation
  const payload = message?.payload;
  let tabId: number | null = null;
  let observedAtMs: number | null = null;

  if (payload && typeof payload === 'object') {
    const data = (payload as Record<string, unknown>).data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      if (typeof d.tabId === 'number') tabId = d.tabId;
      if (typeof d.observedAtMs === 'number') observedAtMs = d.observedAtMs;
    }
  }

  if (observedAtMs === null) {
    observedAtMs = message?.sentAt ?? Date.now();
  }

  const correlationGroupId = deriveCorrelationGroupId(tabId, observedAtMs);
  const event = buildStreamEvent(message, correlationGroupId);

  totalEventsDispatched += 1;

  if (subscribers.length === 0) {
    totalEventsDropped += 1;
    return;
  }

  for (const state of subscribers) {
    state.eventsDispatched += 1;
    try {
      state.subscriber.onEvent(event);
      state.lastAcknowledgedAtMs = Date.now();
    } catch {
      state.eventsDropped += 1;
      totalEventsDropped += 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Health snapshot
// ---------------------------------------------------------------------------

/**
 * Produce a `StreamHealthSnapshot` for the diagnostics surface.
 * Pure-data output — no mutable state escapes.
 */
export function getEventStreamHealthSnapshot(): StreamHealthSnapshot {
  const now = Date.now();

  const subscriberSnapshots: StreamSubscriberHealth[] = subscribers.map((state) => {
    const healthy = state.subscriber.healthCheck().healthy && state.eventsDropped === 0;

    return {
      subscriberId: state.subscriber.subscriberId,
      subscribedKinds: [...BROWSER_STREAM_EVENT_KINDS],
      eventsDispatched: state.eventsDispatched,
      eventsDropped: state.eventsDropped,
      lastAcknowledgedAtMs: state.lastAcknowledgedAtMs,
      healthy,
    };
  });

  return {
    totalEventsDispatched,
    totalEventsDropped,
    subscriberCount: subscribers.length,
    subscribers: subscriberSnapshots,
    producedAtMs: now,
  };
}

// ---------------------------------------------------------------------------
// Reset (for tests)
// ---------------------------------------------------------------------------

/**
 * Reset all mutable state. Intended for unit tests only; must not be
 * called in production.
 */
export function resetEventStream(): void {
  subscribers.length = 0;
  tabCorrelationMap.clear();
  nextGroupCounter = 0;
  nextEventCounter = 0;
  totalEventsDispatched = 0;
  totalEventsDropped = 0;
}
