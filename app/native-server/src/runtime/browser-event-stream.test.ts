/**
 * BNS-01 — unit + integration tests for the browser event stream.
 *
 * Every test feeds typed BridgeObservationMessage records; none of them
 * touches the real bridge, chrome.*, or makes network calls.
 */

import type {
  BridgeObservationMessage,
  BridgeObservationMessagePayload,
  BrowserStreamEvent,
  ObservationKind,
} from '@tabrix/shared';
import {
  BROWSER_STREAM_EVENT_KINDS,
  OBSERVATION_KINDS,
  OBSERVATION_TO_STREAM_EVENT_KIND,
} from '@tabrix/shared';
import {
  CORRELATION_WINDOW_MS,
  deriveCorrelationGroupId,
  dispatchBridgeObservationToStream,
  getEventStreamHealthSnapshot,
  getEventStreamSubscriberCount,
  registerEventStreamSubscriber,
  resetEventStream,
  unregisterEventStreamSubscriber,
  type EventStreamSubscriber,
} from './browser-event-stream';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const T0 = 1_700_000_000_000;

function makeBridgeMessage(
  kind: ObservationKind,
  overrides: {
    tabId?: number;
    urlPattern?: string | null;
    observedAtMs?: number;
    sentAt?: number;
    actionKind?: string;
    data?: Record<string, unknown>;
  } = {},
): BridgeObservationMessage {
  const dataObj = {
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? null,
    observedAtMs: overrides.observedAtMs ?? T0,
    ...overrides.data,
  };

  const payload: BridgeObservationMessagePayload = {
    kind,
    data: dataObj,
  };

  return {
    type: 'observation',
    kind,
    connectionId: 'test-conn',
    extensionId: 'test-ext',
    sentAt: overrides.sentAt ?? T0,
    payload,
  };
}

function makeRecordingSubscriber(id: string): {
  subscriber: EventStreamSubscriber;
  events: BrowserStreamEvent[];
} {
  const events: BrowserStreamEvent[] = [];
  return {
    events,
    subscriber: {
      subscriberId: id,
      onEvent(event: BrowserStreamEvent) {
        events.push(event);
      },
      healthCheck() {
        return { healthy: true };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetEventStream();
});

// ---------------------------------------------------------------------------
// Sub-task 2.1: Core vocabulary mapping
// ---------------------------------------------------------------------------

describe('BNS-01 stream event kind mapping', () => {
  it('every ObservationKind maps to a valid BrowserStreamEventKind', () => {
    for (const ok of OBSERVATION_KINDS) {
      const mapped = OBSERVATION_TO_STREAM_EVENT_KIND[ok as ObservationKind];
      expect(BROWSER_STREAM_EVENT_KINDS).toContain(mapped);
    }
    // Unknown must map to observation_unknown
    expect(OBSERVATION_TO_STREAM_EVENT_KIND['unknown']).toBe('observation_unknown');
  });

  it('maps lifecycle_event -> observation_lifecycle', () => {
    expect(OBSERVATION_TO_STREAM_EVENT_KIND['lifecycle_event']).toBe('observation_lifecycle');
  });

  it('maps fact_snapshot -> observation_fact_snapshot', () => {
    expect(OBSERVATION_TO_STREAM_EVENT_KIND['fact_snapshot']).toBe('observation_fact_snapshot');
  });

  it('maps action_outcome -> observation_action_outcome', () => {
    expect(OBSERVATION_TO_STREAM_EVENT_KIND['action_outcome']).toBe('observation_action_outcome');
  });

  it('maps tab_event -> observation_tab_event', () => {
    expect(OBSERVATION_TO_STREAM_EVENT_KIND['tab_event']).toBe('observation_tab_event');
  });
});

// ---------------------------------------------------------------------------
// Sub-task 2.2: Correlation group id derivation
// ---------------------------------------------------------------------------

describe('BNS-01 correlation group id', () => {
  it('returns same group for events on the same tab within the window', () => {
    const g1 = deriveCorrelationGroupId(100, T0);
    const g2 = deriveCorrelationGroupId(100, T0 + CORRELATION_WINDOW_MS);
    expect(g2).toBe(g1);
  });

  it('returns a new group for events on the same tab outside the window', () => {
    const g1 = deriveCorrelationGroupId(100, T0);
    const g2 = deriveCorrelationGroupId(100, T0 + CORRELATION_WINDOW_MS + 1);
    expect(g2).not.toBe(g1);
  });

  it('returns different groups for different tabs', () => {
    const g1 = deriveCorrelationGroupId(100, T0);
    const g2 = deriveCorrelationGroupId(200, T0 + 1);
    expect(g2).not.toBe(g1);
  });

  it('returns a new group for each null tabId', () => {
    const g1 = deriveCorrelationGroupId(null, T0);
    const g2 = deriveCorrelationGroupId(null, T0 + 1);
    expect(g2).not.toBe(g1);
  });

  it('group ids are stable format: corr_NNNNNNNN', () => {
    const g = deriveCorrelationGroupId(42, T0);
    expect(g).toMatch(/^corr_\d{8}$/);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 2.3: Subscriber registration / unregistration
// ---------------------------------------------------------------------------

describe('BNS-01 subscriber registry', () => {
  it('registers a subscriber', () => {
    const { subscriber } = makeRecordingSubscriber('s1');
    expect(registerEventStreamSubscriber(subscriber)).toBe(true);
    expect(getEventStreamSubscriberCount()).toBe(1);
  });

  it('rejects duplicate subscriber id', () => {
    const { subscriber: s1a } = makeRecordingSubscriber('s1');
    const { subscriber: s1b } = makeRecordingSubscriber('s1');
    expect(registerEventStreamSubscriber(s1a)).toBe(true);
    expect(registerEventStreamSubscriber(s1b)).toBe(false);
    expect(getEventStreamSubscriberCount()).toBe(1);
  });

  it('unregisters a subscriber', () => {
    const { subscriber } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);
    expect(unregisterEventStreamSubscriber('s1')).toBe(true);
    expect(getEventStreamSubscriberCount()).toBe(0);
  });

  it('unregister is idempotent for unknown ids', () => {
    expect(unregisterEventStreamSubscriber('nonexistent')).toBe(false);
  });

  it('returns zero subscriber count when empty', () => {
    expect(getEventStreamSubscriberCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 2.4: Event dispatch (fan-out)
// ---------------------------------------------------------------------------

describe('BNS-01 event dispatch', () => {
  it('dispatches a lifecycle_event to a registered subscriber', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 42, observedAtMs: T0 }),
    );

    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('observation_lifecycle');
    expect(events[0].sourceObservationKind).toBe('lifecycle_event');
    expect(events[0].tabId).toBe(42);
    expect(events[0].correlationGroupId).toMatch(/^corr_\d{8}$/);
    expect(typeof events[0].streamEventId).toBe('string');
  });

  it('dispatches all four observation kinds to a subscriber', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 1, observedAtMs: T0 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 1, observedAtMs: T0 + 100 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', { tabId: 1, observedAtMs: T0 + 200 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('tab_event', { tabId: 1, observedAtMs: T0 + 300 }),
    );

    expect(events.length).toBe(4);
    expect(events[0].kind).toBe('observation_lifecycle');
    expect(events[1].kind).toBe('observation_fact_snapshot');
    expect(events[2].kind).toBe('observation_action_outcome');
    expect(events[3].kind).toBe('observation_tab_event');
  });

  it('events on the same tab within the window share a correlation group', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 42, observedAtMs: T0 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 42, observedAtMs: T0 + 500 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', { tabId: 42, observedAtMs: T0 + 1000 }),
    );

    expect(events.length).toBe(3);
    // All three events share the same correlation group id
    expect(events[0].correlationGroupId).toBe(events[1].correlationGroupId);
    expect(events[1].correlationGroupId).toBe(events[2].correlationGroupId);
  });

  it('events on different tabs get different correlation groups', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 1, observedAtMs: T0 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 2, observedAtMs: T0 }),
    );

    expect(events.length).toBe(2);
    expect(events[0].correlationGroupId).not.toBe(events[1].correlationGroupId);
  });

  it('dispatches to multiple subscribers', () => {
    const r1 = makeRecordingSubscriber('s1');
    const r2 = makeRecordingSubscriber('s2');
    registerEventStreamSubscriber(r1.subscriber);
    registerEventStreamSubscriber(r2.subscriber);

    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 }));

    expect(r1.events.length).toBe(1);
    expect(r2.events.length).toBe(1);
    // Both subscribers receive the same event id
    expect(r1.events[0].streamEventId).toBe(r2.events[0].streamEventId);
  });

  it('a throwing subscriber does not block other subscribers', () => {
    const { subscriber: badSub } = makeRecordingSubscriber('bad');
    badSub.onEvent = () => {
      throw new Error('intentional crash');
    };
    const { subscriber: goodSub, events: goodEvents } = makeRecordingSubscriber('good');

    registerEventStreamSubscriber(badSub);
    registerEventStreamSubscriber(goodSub);

    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 }));

    // Good subscriber still receives the event
    expect(goodEvents.length).toBe(1);
  });

  it('a subscriber that throws still gets its dropped counter updated', () => {
    const { subscriber: badSub } = makeRecordingSubscriber('bad');
    badSub.onEvent = () => {
      throw new Error('intentional crash');
    };
    registerEventStreamSubscriber(badSub);

    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 }));

    const health = getEventStreamHealthSnapshot();
    expect(health.totalEventsDispatched).toBe(1);
    expect(health.totalEventsDropped).toBe(1);

    const badHealth = health.subscribers.find((s) => s.subscriberId === 'bad')!;
    expect(badHealth.eventsDropped).toBe(1);
    expect(badHealth.eventsDispatched).toBe(1); // dispatch was attempted
  });

  it('does not crash when there are no subscribers (fire-and-forget)', () => {
    expect(() =>
      dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 })),
    ).not.toThrow();
  });

  it('counts dropped events for null messages', () => {
    dispatchBridgeObservationToStream(null as unknown as BridgeObservationMessage);
    const health = getEventStreamHealthSnapshot();
    expect(health.totalEventsDropped).toBe(1);
    expect(health.totalEventsDispatched).toBe(0);
  });

  it('urlPattern is propagated from source payload', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { urlPattern: 'example.com/search', tabId: 42 }),
    );

    expect(events[0].urlPattern).toBe('example.com/search');
  });
});

// ---------------------------------------------------------------------------
// Sub-task 2.5: Health snapshot
// ---------------------------------------------------------------------------

describe('BNS-01 health snapshot', () => {
  it('returns zero counts when no events have been dispatched', () => {
    const health = getEventStreamHealthSnapshot();
    expect(health.totalEventsDispatched).toBe(0);
    expect(health.totalEventsDropped).toBe(0);
    expect(health.subscriberCount).toBe(0);
    expect(health.subscribers).toEqual([]);
    expect(typeof health.producedAtMs).toBe('number');
  });

  it('reports subscriber counts after dispatch', () => {
    const { subscriber } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 }));

    const health = getEventStreamHealthSnapshot();
    expect(health.totalEventsDispatched).toBe(1);
    expect(health.subscriberCount).toBe(1);
    expect(health.subscribers[0].subscriberId).toBe('s1');
    expect(health.subscribers[0].eventsDispatched).toBe(1);
    expect(health.subscribers[0].eventsDropped).toBe(0);
    expect(health.subscribers[0].healthy).toBe(true);
  });

  it('reports healthy when subscriber has acknowledged events', () => {
    const { subscriber } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { tabId: 42 }));

    const health = getEventStreamHealthSnapshot();
    expect(health.subscribers[0].healthy).toBe(true);
  });

  it('reports subscriber count after registration', () => {
    const { subscriber: s1 } = makeRecordingSubscriber('s1');
    const { subscriber: s2 } = makeRecordingSubscriber('s2');
    registerEventStreamSubscriber(s1);
    registerEventStreamSubscriber(s2);

    const health = getEventStreamHealthSnapshot();
    expect(health.subscriberCount).toBe(2);
    expect(health.subscribers.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Sub-task 2.6: Stream event envelope
// ---------------------------------------------------------------------------

describe('BNS-01 stream event envelope', () => {
  it('each event has a unique streamEventId', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 42, observedAtMs: T0 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 42, observedAtMs: T0 + 100 }),
    );

    expect(events.length).toBe(2);
    expect(events[0].streamEventId).not.toBe(events[1].streamEventId);
  });

  it('sourcePayload is forwarded unchanged', () => {
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    const msg = makeBridgeMessage('lifecycle_event', { tabId: 42, observedAtMs: T0 });
    dispatchBridgeObservationToStream(msg);

    expect(events[0].sourcePayload).toEqual(msg.payload);
  });

  it('sourceObservationKind is null for null payload message dispatching', () => {
    // This tests the internal build path for invalid messages
    const { subscriber, events } = makeRecordingSubscriber('s1');
    registerEventStreamSubscriber(subscriber);

    // Simulate a stripped message
    const msg: BridgeObservationMessage = {
      type: 'observation',
      kind: 'unknown',
      connectionId: 'test',
      extensionId: 'test',
      sentAt: T0,
      payload: { kind: 'unknown' } as BridgeObservationMessagePayload,
    };
    dispatchBridgeObservationToStream(msg);

    expect(events[0].sourceObservationKind).toBe('unknown');
  });
});
