import type {
  BridgeObservationMessage,
  BridgeObservationMessagePayload,
  ObservationKind,
} from '@tabrix/shared';
import { dispatchBridgeObservationToStream, resetEventStream } from './browser-event-stream';
import {
  ensureLifecycleEvidenceCollectorRegistered,
  getLifecycleEvidenceCollectorSnapshot,
  produceRuntimeLifecycleEvidenceArtifact,
  resetLifecycleEvidenceCollectorForTests,
  setLifecycleEvidenceCollectorMaxBufferedEventsForTests,
  unregisterLifecycleEvidenceCollector,
} from './lifecycle-evidence-collector';

const T0 = 1_700_000_000_000;

function makeBridgeMessage(
  kind: ObservationKind,
  overrides: {
    tabId?: number;
    urlPattern?: string | null;
    observedAtMs?: number;
    sentAt?: number;
    data?: Record<string, unknown>;
  } = {},
): BridgeObservationMessage {
  const dataObj = {
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/path',
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

beforeEach(() => {
  resetEventStream();
  resetLifecycleEvidenceCollectorForTests();
});

describe('lifecycle-evidence-collector — registration', () => {
  it('does not register on import or reset', () => {
    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      registered: false,
      bufferedEvents: 0,
      bufferedSignals: 0,
      droppedEvents: 0,
      droppedSignals: 0,
      lastEventAtMs: null,
      lastSignalAtMs: null,
    });
  });

  it('registers exactly once and reports idempotent success', () => {
    expect(ensureLifecycleEvidenceCollectorRegistered()).toBe(true);
    expect(ensureLifecycleEvidenceCollectorRegistered()).toBe(true);
    expect(getLifecycleEvidenceCollectorSnapshot().registered).toBe(true);
  });

  it('unregisters and leaves buffered data untouched until reset', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event'));

    expect(unregisterLifecycleEvidenceCollector()).toBe(true);
    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      registered: false,
      bufferedEvents: 1,
    });
  });

  it('reset clears buffered data and drop counters', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    setLifecycleEvidenceCollectorMaxBufferedEventsForTests(1);
    dispatchBridgeObservationToStream(makeBridgeMessage('lifecycle_event', { observedAtMs: T0 }));
    dispatchBridgeObservationToStream(makeBridgeMessage('fact_snapshot', { observedAtMs: T0 + 1 }));

    expect(getLifecycleEvidenceCollectorSnapshot().droppedEvents).toBe(1);
    resetLifecycleEvidenceCollectorForTests();
    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      registered: false,
      bufferedEvents: 0,
      bufferedSignals: 0,
      droppedEvents: 0,
      droppedSignals: 0,
      lastEventAtMs: null,
      lastSignalAtMs: null,
    });
  });
});

describe('lifecycle-evidence-collector — event window artifacts', () => {
  it('collects sanitized stream events after explicit registration', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 42, observedAtMs: T0 + 10 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 42, observedAtMs: T0 + 20 }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-1',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-1',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.eventTimeline.available).toBe(true);
    expect(artifact.eventTimeline.totalEvents).toBe(2);
    expect(artifact.eventTimeline.eventsByKind).toEqual({
      observation_lifecycle: 1,
      observation_fact_snapshot: 1,
    });
  });

  it('derives wait_for_stability signal sequence from runtime stream events', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', {
        tabId: 42,
        observedAtMs: T0 + 10,
        data: { eventKind: 'before_navigate' },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-signals',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-signals',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      eventWindow: { tabIds: [42] },
    });

    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      bufferedSignals: 1,
      lastSignalAtMs: T0 + 10,
    });
    expect(artifact.signalSequence).toMatchObject({
      available: true,
      totalSignals: 1,
      signalsByKind: { wait_for_stability: 1 },
    });
  });

  it('does not derive a wait signal for stable lifecycle completion', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', {
        tabId: 42,
        observedAtMs: T0 + 10,
        data: { eventKind: 'document_complete' },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-stable',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-stable',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      eventWindow: { tabIds: [42] },
    });

    expect(getLifecycleEvidenceCollectorSnapshot().bufferedSignals).toBe(0);
    expect(artifact.signalSequence).toEqual({
      available: false,
      reason: 'bns_02_not_available',
    });
  });

  it('filters out before-window, after-window, and other-tab events', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 7, observedAtMs: T0 - 1 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 7, observedAtMs: T0 + 10 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('tab_event', { tabId: 8, observedAtMs: T0 + 20 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', { tabId: 7, observedAtMs: T0 + 101 }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-2',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-2',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 100,
      eventWindow: { tabIds: [7] },
    });

    expect(artifact.eventTimeline.totalEvents).toBe(1);
    expect(artifact.eventTimeline.keyEvents[0]).toMatchObject({
      kind: 'observation_fact_snapshot',
      tabId: 7,
      observedAtMs: T0 + 10,
    });
    expect(artifact.signalSequence).toEqual({
      available: false,
      reason: 'bns_02_not_available',
    });
  });

  it('uses correlation groups only as an intersection filter', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', { tabId: 10, observedAtMs: T0 }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', { tabId: 20, observedAtMs: T0 }),
    );

    const allTabTen = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-3a',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-3a',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 1,
      eventWindow: { tabIds: [10] },
    });
    const tabTenGroup = allTabTen.eventTimeline.keyEvents[0].streamEventId;

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-3b',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-3b',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 1,
      eventWindow: { tabIds: [20], correlationGroupIds: [tabTenGroup] },
    });

    expect(artifact.eventTimeline.totalEvents).toBe(0);
  });

  it('does not retain or emit raw sourcePayload content', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          rawText: 'PRIVATE_TEXT_SHOULD_NOT_APPEAR',
          Authorization: 'secret-token',
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-private',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-private',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain('PRIVATE_TEXT_SHOULD_NOT_APPEAR');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('sourcePayload');
  });

  it('does not emit raw sourcePayload through derived semantic signals', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          eventKind: 'before_navigate',
          rawText: 'PRIVATE_TEXT_SHOULD_NOT_APPEAR',
          Authorization: 'secret-token',
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-signal-private',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-signal-private',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    const serialized = JSON.stringify(artifact.signalSequence);
    expect(serialized).toContain('wait_for_stability');
    expect(serialized).not.toContain('PRIVATE_TEXT_SHOULD_NOT_APPEAR');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('sourcePayload');
  });

  it('keeps runtime artifact verdict unknown because no BNS-04/Hygiene adapter is wired', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', { tabId: 42, observedAtMs: T0 }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-verdict',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-verdict',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.actionLog.available).toBe(false);
    expect(artifact.finalVerdict).toEqual({
      verdict: 'unknown',
      confidence: 0,
      reason: 'no_postcondition_results',
    });
  });
});

describe('lifecycle-evidence-collector — bounds and validation', () => {
  it('evicts old events when the buffer is bounded', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    setLifecycleEvidenceCollectorMaxBufferedEventsForTests(2);
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', {
        observedAtMs: T0,
        data: { eventKind: 'before_navigate' },
      }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('lifecycle_event', {
        observedAtMs: T0 + 1,
        data: { eventKind: 'committed' },
      }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('tab_event', {
        observedAtMs: T0 + 2,
        data: { eventKind: 'tab_removed' },
      }),
    );

    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      bufferedEvents: 2,
      bufferedSignals: 2,
      droppedEvents: 1,
      droppedSignals: 1,
      lastEventAtMs: T0 + 2,
      lastSignalAtMs: T0 + 2,
    });
  });

  it('rejects missing hard tab scope', () => {
    expect(() =>
      produceRuntimeLifecycleEvidenceArtifact({
        artifactId: 'runtime-artifact-invalid',
        evidenceLevel: 'integration',
        scenarioId: 'scenario-invalid',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        endedAtMs: T0,
        eventWindow: { tabIds: [] },
      }),
    ).toThrow(/non-empty tabIds/);
  });

  it('rejects invalid time bounds', () => {
    expect(() =>
      produceRuntimeLifecycleEvidenceArtifact({
        artifactId: 'runtime-artifact-invalid-time',
        evidenceLevel: 'integration',
        scenarioId: 'scenario-invalid-time',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0 + 1,
        endedAtMs: T0,
        eventWindow: { tabIds: [42] },
      }),
    ).toThrow(/endedAtMs >= startedAtMs/);
  });
});
