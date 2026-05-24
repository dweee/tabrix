import type { BrowserStreamEvent } from '@tabrix/shared';
import { SEMANTIC_SIGNAL_KINDS } from '@tabrix/shared';
import { deriveWaitForStabilitySignal } from './semantic-signal-aggregator';

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

  it('keeps unsupported semantic signal kinds out of shared contract', () => {
    expect(SEMANTIC_SIGNAL_KINDS).toEqual(['wait_for_stability', 'unknown']);
    expect(SEMANTIC_SIGNAL_KINDS).not.toContain('ready_to_act');
    expect(SEMANTIC_SIGNAL_KINDS).not.toContain('user_took_over');
    expect(SEMANTIC_SIGNAL_KINDS).not.toContain('postcondition_failed');
  });
});
