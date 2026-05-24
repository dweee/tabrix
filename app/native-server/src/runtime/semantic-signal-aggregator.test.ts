import type { BrowserStreamEvent, PostconditionResult } from '@tabrix/shared';
import { SEMANTIC_SIGNAL_KINDS } from '@tabrix/shared';
import {
  derivePostconditionFailedSignal,
  deriveWaitForStabilitySignal,
} from './semantic-signal-aggregator';

const T0 = 1_700_000_000_000;
const PRODUCED_AT = T0 + 9_999;

function makeEvent(overrides: Partial<BrowserStreamEvent> = {}): BrowserStreamEvent {
  return {
    streamEventId: overrides.streamEventId ?? 'stream-1',
    correlationGroupId: overrides.correlationGroupId ?? 'corr_00000001',
    kind: overrides.kind ?? 'observation_lifecycle',
    observedAtMs: overrides.observedAtMs ?? T0,
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/list',
    sourceObservationKind: overrides.sourceObservationKind ?? 'lifecycle_event',
    sourcePayload: overrides.sourcePayload ?? {
      kind: 'lifecycle_event',
      data: {
        eventKind: 'before_navigate',
        tabId: overrides.tabId ?? 100,
        urlPattern: overrides.urlPattern ?? 'example.test/list',
        observedAtMs: overrides.observedAtMs ?? T0,
      },
    },
  };
}

describe('semantic-signal-aggregator — wait_for_stability', () => {
  it('emits wait_for_stability for a lifecycle loading event', () => {
    const signal = deriveWaitForStabilitySignal([makeEvent()], PRODUCED_AT);

    expect(signal).toMatchObject({
      kind: 'wait_for_stability',
      confidence: 0.8,
      tabId: 100,
      urlPattern: 'example.test/list',
      sourceOrigins: ['browser_stream'],
      producedAtMs: PRODUCED_AT,
    });
    expect(signal?.signalId).toBe(`sig_wait_for_stability_stream-1_${PRODUCED_AT}`);
  });

  it('does not emit wait_for_stability for a stable document_complete event', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          sourcePayload: {
            kind: 'lifecycle_event',
            data: { eventKind: 'document_complete', observedAtMs: T0 },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toBeNull();
  });

  it('does not throw or guess when the latest payload is malformed', () => {
    const signal = deriveWaitForStabilitySignal(
      [makeEvent({ sourcePayload: { kind: 'lifecycle_event', data: 'bad' } })],
      PRODUCED_AT,
    );

    expect(signal).toBeNull();
  });

  it('returns unknown for malformed payload only when explicit fallback is requested', () => {
    const signal = deriveWaitForStabilitySignal(
      [makeEvent({ sourcePayload: { kind: 'lifecycle_event', data: 'bad' } })],
      PRODUCED_AT,
      { explicitUnknownFallback: true },
    );

    expect(signal).toMatchObject({
      kind: 'unknown',
      confidence: 0.2,
      sourceOrigins: ['browser_stream'],
    });
    expect(signal?.sourceEventRefs).toHaveLength(1);
  });

  it('stamps complete stream evidence refs', () => {
    const event = makeEvent({
      streamEventId: 'stream-42',
      kind: 'observation_lifecycle',
      sourceObservationKind: 'lifecycle_event',
      observedAtMs: T0 + 42,
    });

    const signal = deriveWaitForStabilitySignal([event], PRODUCED_AT);

    expect(signal?.sourceEventRefs).toEqual([
      {
        streamEventId: 'stream-42',
        eventKind: 'observation_lifecycle',
        sourceObservationKind: 'lifecycle_event',
        observedAtMs: T0 + 42,
      },
    ]);
  });

  it('clamps confidence to [0, 1]', () => {
    const high = deriveWaitForStabilitySignal([makeEvent()], PRODUCED_AT, { confidence: 2 });
    const low = deriveWaitForStabilitySignal([makeEvent()], PRODUCED_AT, { confidence: -1 });

    expect(high?.confidence).toBe(1);
    expect(low?.confidence).toBe(0);
  });

  it('emits wait_for_stability for a readiness snapshot that proves not-ready', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-1',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'false',
                  routeStable: 'unknown',
                  keyRegionReady: 'unknown',
                  networkQuiet: 'unknown',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal?.kind).toBe('wait_for_stability');
  });

  it('emits ready_to_act for a readiness snapshot that proves all readiness gates', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          streamEventId: 'ready-fact',
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-ready',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'true',
                  routeStable: 'true',
                  keyRegionReady: 'true',
                  networkQuiet: 'true',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toMatchObject({
      kind: 'ready_to_act',
      confidence: 0.85,
      sourceOrigins: ['browser_stream'],
    });
    expect(signal?.signalId).toBe(`sig_ready_to_act_ready-fact_${PRODUCED_AT}`);
  });

  it('does not emit ready_to_act when any readiness gate is unknown', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-not-ready',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'true',
                  routeStable: 'true',
                  keyRegionReady: 'unknown',
                  networkQuiet: 'true',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toBeNull();
  });

  it('emits user_took_over only for explicit recent input with high interference risk', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          streamEventId: 'user-activity-fact',
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-user-took-over',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'true',
                  routeStable: 'true',
                  keyRegionReady: 'true',
                  networkQuiet: 'true',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
                userActivityLevel: 'recent_input',
                interferenceRisk: 'high',
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toMatchObject({
      kind: 'user_took_over',
      confidence: 0.9,
      sourceOrigins: ['browser_stream'],
    });
    expect(signal?.signalId).toBe(`sig_user_took_over_user-activity-fact_${PRODUCED_AT}`);
  });

  it('prioritizes user_took_over over page readiness waits when recent input is high risk', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          streamEventId: 'user-activity-not-ready',
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-user-took-over-not-ready',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'false',
                  routeStable: 'false',
                  keyRegionReady: 'unknown',
                  networkQuiet: 'unknown',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
                userActivityLevel: 'recent_input',
                interferenceRisk: 'high',
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal?.kind).toBe('user_took_over');
  });

  it('does not infer user_took_over from weak or unknown user activity facts', () => {
    const activeLow = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-active-low',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'true',
                  routeStable: 'true',
                  keyRegionReady: 'true',
                  networkQuiet: 'true',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
                userActivityLevel: 'active',
                interferenceRisk: 'low',
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );
    const unknownHigh = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-unknown-high',
              observedAtMs: T0,
              payload: {
                eventKind: 'readiness_signal',
                signals: {
                  documentComplete: 'true',
                  routeStable: 'true',
                  keyRegionReady: 'true',
                  networkQuiet: 'true',
                  observedAtMs: T0,
                },
                tabId: 100,
                urlPattern: 'example.test/list',
                sessionId: null,
                userActivityLevel: 'unknown',
                interferenceRisk: 'high',
              },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(activeLow?.kind).toBe('ready_to_act');
    expect(unknownHigh?.kind).toBe('ready_to_act');
  });

  it('does not infer user_took_over from window focus changes alone', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_tab_event',
          sourceObservationKind: 'tab_event',
          sourcePayload: {
            kind: 'tab_event',
            data: {
              eventKind: 'window_focus_changed',
              tabId: -1,
              windowId: -1,
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toBeNull();
  });

  it('emits results_changed for action outcomes with explicit DOM region evidence', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          streamEventId: 'action-dom-change',
          kind: 'observation_action_outcome',
          sourceObservationKind: 'action_outcome',
          sourcePayload: {
            kind: 'action_outcome',
            data: {
              actionId: 'act-dom-change',
              outcome: 'changed_region',
              outcomeConfidence: 0.9,
              observedSignalKinds: ['dom_region_changed'],
              producedAtMs: T0,
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal).toMatchObject({
      kind: 'results_changed',
      confidence: 0.8,
      sourceOrigins: ['browser_stream'],
    });
    expect(signal?.signalId).toBe(`sig_results_changed_action-dom-change_${PRODUCED_AT}`);
    expect(signal?.sourceEventRefs).toEqual([
      {
        streamEventId: 'action-dom-change',
        eventKind: 'observation_action_outcome',
        sourceObservationKind: 'action_outcome',
        observedAtMs: T0,
      },
    ]);
  });

  it('does not emit results_changed without explicit DOM region evidence', () => {
    const onlyNetwork = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_action_outcome',
          sourceObservationKind: 'action_outcome',
          sourcePayload: {
            kind: 'action_outcome',
            data: {
              actionId: 'act-network',
              outcome: 'network_activity',
              outcomeConfidence: 0.9,
              observedSignalKinds: ['network_completed'],
              producedAtMs: T0,
            },
          },
        }),
      ],
      PRODUCED_AT,
    );
    const missingSignals = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_action_outcome',
          sourceObservationKind: 'action_outcome',
          sourcePayload: {
            kind: 'action_outcome',
            data: {
              actionId: 'act-missing',
              outcome: 'changed_region',
              outcomeConfidence: 0.9,
              producedAtMs: T0,
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(onlyNetwork).toBeNull();
    expect(missingSignals).toBeNull();
  });

  it('does not emit for unsupported fact payloads or live bfcache tab events', () => {
    const unsupportedFact = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-2',
              observedAtMs: T0,
              payload: { eventKind: 'network_request' },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    const liveBfcache = deriveWaitForStabilitySignal(
      [
        makeEvent({
          kind: 'observation_tab_event',
          sourceObservationKind: 'tab_event',
          sourcePayload: {
            kind: 'tab_event',
            data: {
              eventKind: 'bfcache_restored',
              stableRefRevalidation: { outcome: 'live' },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(unsupportedFact).toBeNull();
    expect(liveBfcache).toBeNull();
  });

  it('uses the latest relevant event instead of guessing from a newer unsupported event', () => {
    const signal = deriveWaitForStabilitySignal(
      [
        makeEvent({
          streamEventId: 'older-loading',
          observedAtMs: T0,
        }),
        makeEvent({
          streamEventId: 'newer-network',
          kind: 'observation_fact_snapshot',
          sourceObservationKind: 'fact_snapshot',
          observedAtMs: T0 + 1_000,
          sourcePayload: {
            kind: 'fact_snapshot',
            data: {
              factSnapshotId: 'fact-3',
              observedAtMs: T0 + 1_000,
              payload: { eventKind: 'network_request' },
            },
          },
        }),
      ],
      PRODUCED_AT,
    );

    expect(signal?.kind).toBe('wait_for_stability');
    expect(signal?.sourceEventRefs[0].streamEventId).toBe('older-loading');
  });

  it('keeps the shared semantic signal contract explicit', () => {
    expect(SEMANTIC_SIGNAL_KINDS).toEqual([
      'wait_for_stability',
      'ready_to_act',
      'user_took_over',
      'results_changed',
      'postcondition_failed',
      'unknown',
    ]);
  });
});

describe('semantic-signal-aggregator — postcondition_failed', () => {
  function makePostcondition(overrides: Partial<PostconditionResult> = {}): PostconditionResult {
    return {
      actionId: overrides.actionId ?? 'act-1',
      actionKind: overrides.actionKind ?? 'click',
      tabId: overrides.tabId ?? 100,
      urlPattern: overrides.urlPattern ?? 'example.test/list',
      verdict: overrides.verdict ?? 'failed',
      reason: overrides.reason ?? 'no_relevant_effect_observed',
      observedOutcome: overrides.observedOutcome ?? 'no_observed_change',
      observedOutcomeConfidence: overrides.observedOutcomeConfidence ?? 0.9,
      sourceEventRefs: overrides.sourceEventRefs ?? [
        { kind: 'unknown', id: 'act-1', origin: 'runtime' },
      ],
      sourceOrigins: overrides.sourceOrigins ?? ['runtime'],
      producedAtMs: overrides.producedAtMs ?? T0,
    };
  }

  it('emits postcondition_failed for failed postconditions', () => {
    const event = makeEvent({
      streamEventId: 'action-event-1',
      kind: 'observation_action_outcome',
      sourceObservationKind: 'action_outcome',
    });
    const signal = derivePostconditionFailedSignal(
      makePostcondition({ verdict: 'failed' }),
      event,
      PRODUCED_AT,
    );

    expect(signal).toMatchObject({
      kind: 'postcondition_failed',
      confidence: 0.85,
      tabId: 100,
      urlPattern: 'example.test/list',
      sourceOrigins: ['browser_stream'],
      producedAtMs: PRODUCED_AT,
    });
    expect(signal?.signalId).toBe(`sig_postcondition_failed_action-event-1_${PRODUCED_AT}`);
    expect(signal?.sourceEventRefs).toEqual([
      {
        streamEventId: 'action-event-1',
        eventKind: 'observation_action_outcome',
        sourceObservationKind: 'action_outcome',
        observedAtMs: T0,
      },
    ]);
  });

  it('does not emit for passed or unknown postconditions', () => {
    const event = makeEvent({ sourceObservationKind: 'action_outcome' });

    expect(
      derivePostconditionFailedSignal(makePostcondition({ verdict: 'passed' }), event, PRODUCED_AT),
    ).toBeNull();
    expect(
      derivePostconditionFailedSignal(
        makePostcondition({ verdict: 'unknown' }),
        event,
        PRODUCED_AT,
      ),
    ).toBeNull();
  });
});
