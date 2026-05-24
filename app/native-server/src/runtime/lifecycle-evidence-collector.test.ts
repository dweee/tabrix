import type {
  BridgeObservationMessage,
  BridgeObservationMessagePayload,
  LifecycleEvidenceBrowserHygieneCheck,
  ObservationKind,
} from '@tabrix/shared';
import { dispatchBridgeObservationToStream, resetEventStream } from './browser-event-stream';
import {
  getLifecycleEvidenceArtifactStoreSnapshot,
  listLifecycleEvidenceArtifacts,
  resetLifecycleEvidenceArtifactStoreForTests,
} from './lifecycle-evidence-artifact-store';
import {
  ensureLifecycleEvidenceCollectorRegistered,
  getLifecycleEvidenceCollectorSnapshot,
  produceToolCloseoutLifecycleEvidenceArtifact,
  produceRuntimeLifecycleEvidenceArtifact,
  produceToolFailureLifecycleEvidenceArtifact,
  resetLifecycleEvidenceCollectorForTests,
  setLifecycleEvidenceCollectorHygieneSnapshotProviderForTests,
  setLifecycleEvidenceCollectorMaxBufferedEventsForTests,
  unregisterLifecycleEvidenceCollector,
} from './lifecycle-evidence-collector';
import type { PrimaryTabHygieneViolationKind } from './primary-tab-controller';

const T0 = 1_700_000_000_000;

function setRuntimeHygieneSnapshot(overrides: {
  primaryTabReuseRate?: number | null;
  benchmarkOwnedTabCount?: number;
  expectedPrimaryTabNavigations?: number;
  samePrimaryTabNavigations?: number;
  violations?: Array<{ scenarioId: string | null; kind: string; detail?: string }>;
}): void {
  setLifecycleEvidenceCollectorHygieneSnapshotProviderForTests(() => ({
    primaryTabId: 42,
    primaryTabReuseRate: overrides.primaryTabReuseRate ?? 1,
    benchmarkOwnedTabCount: overrides.benchmarkOwnedTabCount ?? 1,
    samePrimaryTabNavigations: overrides.samePrimaryTabNavigations ?? 1,
    expectedPrimaryTabNavigations: overrides.expectedPrimaryTabNavigations ?? 1,
    observedTabIds: [42],
    allowsNewTabScenarioIds: [],
    violations: (overrides.violations ?? []).map((violation) => ({
      scenarioId: violation.scenarioId,
      kind: violation.kind as PrimaryTabHygieneViolationKind,
      ...(violation.detail ? { detail: violation.detail } : {}),
    })),
  }));
}

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

function makeCleanHygieneChecks(): LifecycleEvidenceBrowserHygieneCheck[] {
  return [
    {
      kind: 'tab_window_baseline',
      verdict: 'pass',
      reason: 'pre_post_tab_window_baseline_unchanged',
    },
    { kind: 'active_tab_restore', verdict: 'pass', reason: 'active_tab_restored' },
    { kind: 'run_owned_cleanup', verdict: 'pass', reason: 'run_owned_tabs_cleaned' },
    { kind: 'user_owned_protection', verdict: 'pass', reason: 'user_owned_tabs_protected' },
    { kind: 'failure_cleanup', verdict: 'pass', reason: 'failure_cleanup_not_needed' },
  ];
}

beforeEach(() => {
  resetEventStream();
  resetLifecycleEvidenceCollectorForTests();
  resetLifecycleEvidenceArtifactStoreForTests();
});

describe('lifecycle-evidence-collector — registration', () => {
  it('does not register on import or reset', () => {
    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      registered: false,
      bufferedEvents: 0,
      bufferedSignals: 0,
      bufferedPostconditions: 0,
      droppedEvents: 0,
      droppedSignals: 0,
      droppedPostconditions: 0,
      lastEventAtMs: null,
      lastSignalAtMs: null,
      lastPostconditionAtMs: null,
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
      bufferedPostconditions: 0,
      droppedEvents: 0,
      droppedSignals: 0,
      droppedPostconditions: 0,
      lastEventAtMs: null,
      lastSignalAtMs: null,
      lastPostconditionAtMs: null,
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

  it('derives ready_to_act signal sequence from runtime readiness facts', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', {
        tabId: 42,
        observedAtMs: T0 + 10,
        data: {
          factSnapshotId: 'fact-ready',
          payload: {
            eventKind: 'readiness_signal',
            signals: {
              documentComplete: 'true',
              routeStable: 'true',
              keyRegionReady: 'true',
              networkQuiet: 'true',
              observedAtMs: T0 + 10,
            },
            tabId: 42,
            urlPattern: 'example.test/list',
            sessionId: null,
          },
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-ready-to-act',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-ready-to-act',
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
      signalsByKind: { ready_to_act: 1 },
    });
    expect(artifact.signalSequence.signals[0]).toMatchObject({
      kind: 'ready_to_act',
      confidence: 0.85,
      sourceOrigins: ['browser_stream'],
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
    expect(artifact.actionLog.available).toBe(false);
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
    expect(JSON.stringify(listLifecycleEvidenceArtifacts())).not.toContain(
      'PRIVATE_TEXT_SHOULD_NOT_APPEAR',
    );
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

  it('derives BNS-04 postcondition action log from runtime action outcome events', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-click-1',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 10 }],
        },
      }),
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

    expect(getLifecycleEvidenceCollectorSnapshot()).toMatchObject({
      bufferedPostconditions: 1,
      lastPostconditionAtMs: T0,
    });
    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      passed: 1,
      failed: 0,
      unknown: 0,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'act-click-1',
      actionKind: 'click',
      verdict: 'passed',
      observedOutcome: 'spa_partial_update',
    });
    expect(artifact.finalVerdict).toEqual({
      verdict: 'unknown',
      confidence: 0.3,
      reason: 'browser_hygiene_unavailable',
    });
  });

  it('keeps verdict unknown when runtime hygiene leaves cleanup checks unproven', () => {
    setRuntimeHygieneSnapshot({ primaryTabReuseRate: 1, benchmarkOwnedTabCount: 1 });
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-click-clean-hygiene',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-clean-hygiene',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-clean-hygiene',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.browserHygiene).toMatchObject({
      available: true,
      baselineTabs: null,
      runOwnedTabsClosed: null,
      baselineChanged: false,
    });
    expect(artifact.browserHygiene.notes).toEqual([
      'primaryTabReuseRate=1.000',
      'benchmarkOwnedTabCount=1',
      'violations=0',
    ]);
    expect(artifact.browserHygiene.checks).toEqual([
      {
        kind: 'tab_window_baseline',
        verdict: 'pass',
        reason: 'pre_post_tab_window_baseline_unchanged',
      },
      { kind: 'active_tab_restore', verdict: 'pass', reason: 'active_tab_restored' },
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
    ]);
    expect(artifact.finalVerdict).toEqual({
      verdict: 'unknown',
      confidence: 0.4,
      reason: 'browser_hygiene_check_incomplete',
    });
  });

  it('surfaces runtime hygiene violations on lifecycle artifacts', () => {
    setRuntimeHygieneSnapshot({
      primaryTabReuseRate: 0.5,
      benchmarkOwnedTabCount: 2,
      expectedPrimaryTabNavigations: 2,
      samePrimaryTabNavigations: 1,
      violations: [
        {
          scenarioId: 'scenario-hygiene-violation',
          kind: 'tab_id_changed_after_navigation',
        },
      ],
    });
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-click-hygiene-violation',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-hygiene-violation',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-hygiene-violation',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.browserHygiene).toMatchObject({
      available: true,
      baselineChanged: true,
    });
    expect(artifact.browserHygiene.notes).toEqual([
      'primaryTabReuseRate=0.500',
      'benchmarkOwnedTabCount=2',
      'violations=1',
    ]);
    expect(artifact.browserHygiene.checks).toEqual([
      {
        kind: 'tab_window_baseline',
        verdict: 'fail',
        reason: 'pre_post_tab_window_baseline_changed',
      },
      { kind: 'active_tab_restore', verdict: 'fail', reason: 'active_tab_not_restored' },
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
    ]);
    expect(artifact.finalVerdict).toEqual({
      verdict: 'blocked',
      confidence: 0.7,
      reason: 'browser_hygiene_changed',
    });
  });

  it('turns no-observed-change action outcomes into failed postconditions', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-click-noop',
          actionKind: 'click',
          signals: [],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-failed-postcondition',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-failed-postcondition',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      passed: 0,
      failed: 1,
      unknown: 0,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'act-click-noop',
      verdict: 'failed',
      observedOutcome: 'no_observed_change',
      reason: 'no_relevant_effect_observed',
    });
    expect(artifact.signalSequence).toMatchObject({
      available: true,
      totalSignals: 1,
      signalsByKind: { postcondition_failed: 1 },
    });
    expect(artifact.signalSequence.signals[0]).toMatchObject({
      kind: 'postcondition_failed',
      confidence: 0.85,
      sourceOrigins: ['browser_stream'],
    });
    expect(artifact.finalVerdict).toEqual({
      verdict: 'task_failed',
      confidence: 0.85,
      reason: 'postcondition_failed',
    });
  });

  it('filters postcondition evidence by artifact window and tab scope', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 7,
        observedAtMs: T0 - 1,
        data: {
          actionId: 'act-before-window',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
        },
      }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 8,
        observedAtMs: T0 + 10,
        data: {
          actionId: 'act-other-tab',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 10 }],
        },
      }),
    );
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 7,
        observedAtMs: T0 + 20,
        data: {
          actionId: 'act-in-scope',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 20 }],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-filtered-postconditions',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-filtered-postconditions',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      eventWindow: { tabIds: [7] },
    });

    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      passed: 1,
    });
    expect(artifact.actionLog.entries.map((entry) => entry.actionId)).toEqual(['act-in-scope']);
  });

  it('drops malformed action outcome payloads instead of guessing postconditions', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-malformed',
          actionKind: 'close',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-malformed-postcondition',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-malformed-postcondition',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(getLifecycleEvidenceCollectorSnapshot().bufferedPostconditions).toBe(0);
    expect(artifact.actionLog.available).toBe(false);
  });

  it('does not emit raw sourcePayload through derived postcondition evidence', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-private',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
          rawText: 'PRIVATE_TEXT_SHOULD_NOT_APPEAR',
          Authorization: 'secret-token',
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-postcondition-private',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-postcondition-private',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    const serialized = JSON.stringify(artifact.actionLog);
    expect(serialized).toContain('act-private');
    expect(serialized).not.toContain('PRIVATE_TEXT_SHOULD_NOT_APPEAR');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('sourcePayload');
  });

  it('records produced artifacts as first-class runtime evidence', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-store',
          actionKind: 'click',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 }],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-store',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-store',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 1,
      lastArtifactId: 'runtime-artifact-store',
      lastFinalVerdict: artifact.finalVerdict.verdict,
    });
    expect(listLifecycleEvidenceArtifacts()[0]).toMatchObject({
      artifactId: 'runtime-artifact-store',
      actionLog: { available: true, totalActions: 1 },
    });
  });

  it('records bounded failed tool evidence without raw payload content', () => {
    const artifact = produceToolFailureLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-tool-failure',
      evidenceLevel: 'integration',
      scenarioId: 'tool-failure-read-page',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 10,
      actionId: 'mcp:chrome_read_page:42',
      actionKind: 'unknown',
      tabId: 42,
      reason: 'page_unreadable',
      observedOutcome: 'unknown',
      observedOutcomeConfidence: 0.85,
      semanticSignals: [
        {
          signalId: 'sig-error-page-detected',
          kind: 'error_page_detected',
          confidence: 0.9,
          tabId: 42,
          urlPattern: null,
          sourceEventRefs: [
            {
              streamEventId: 'mcp-read-failure-42',
              eventKind: 'observation_unknown',
              sourceObservationKind: null,
              observedAtMs: T0 + 10,
            },
          ],
          sourceOrigins: ['runtime_inference'],
          producedAtMs: T0 + 10,
        },
      ],
    });

    expect(artifact.finalVerdict).toMatchObject({
      verdict: 'task_failed',
      reason: 'postcondition_failed',
    });
    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      failed: 1,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'mcp:chrome_read_page:42',
      actionKind: 'unknown',
      tabId: 42,
      verdict: 'failed',
      reason: 'page_unreadable',
      sourceEventRefs: [{ kind: 'unknown', id: 'mcp:chrome_read_page:42', origin: 'runtime' }],
      sourceOrigins: ['runtime', 'inference'],
    });
    expect(artifact.signalSequence).toMatchObject({
      available: true,
      totalSignals: 1,
      signalsByKind: { error_page_detected: 1 },
    });
    expect(artifact.signalSequence.signals[0]).toMatchObject({
      kind: 'error_page_detected',
      sourceOrigins: ['runtime_inference'],
    });
    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 1,
      lastArtifactId: 'runtime-artifact-tool-failure',
      lastFinalVerdict: 'task_failed',
    });
    const serialized = JSON.stringify(listLifecycleEvidenceArtifacts());
    expect(serialized).not.toContain('sourcePayload');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('PRIVATE_PAGE_BODY_SHOULD_NOT_APPEAR');
  });

  it('records bounded successful tool closeout evidence for supported actions with browser hygiene', () => {
    const artifact = produceToolCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-tool-closeout',
      evidenceLevel: 'integration',
      scenarioId: 'tool-close-tabs-success',
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 10,
      actionId: 'mcp:chrome_click_element:42',
      actionKind: 'click',
      tabId: 42,
      reason: 'click_postcondition_succeeded',
      browserHygiene: {
        available: true,
        baselineTabs: null,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
        notes: ['closedTabCount=1'],
      },
    });

    expect(artifact.finalVerdict).toMatchObject({
      verdict: 'task_success',
      reason: 'postconditions_passed',
    });
    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      passed: 1,
      failed: 0,
      unknown: 0,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'mcp:chrome_click_element:42',
      actionKind: 'click',
      tabId: 42,
      verdict: 'passed',
      reason: 'click_postcondition_succeeded',
    });
    expect(artifact.browserHygiene).toMatchObject({
      available: true,
      runOwnedTabsClosed: 1,
      baselineChanged: false,
    });
    expect(artifact.claimBoundary).toMatchObject({
      deterministicArtifactOnly: true,
      realBrowserProven: false,
      commercialGradeProven: false,
      competitorSuperiorityProven: false,
    });
    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 1,
      lastArtifactId: 'runtime-artifact-tool-closeout',
      lastFinalVerdict: 'task_success',
    });
    const serialized = JSON.stringify(listLifecycleEvidenceArtifacts());
    expect(serialized).not.toContain('sourcePayload');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('secret-token');
  });

  it('downgrades closeout postconditions for unsupported action kinds instead of claiming success', () => {
    const baseInput = {
      artifactId: 'runtime-artifact-tool-closeout-unsupported',
      evidenceLevel: 'integration' as const,
      scenarioId: 'tool-close-tabs-success',
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 10,
      actionId: 'mcp:chrome_close_tabs:42',
      tabId: 42,
      reason: 'close_tabs_cleanup_succeeded',
      browserHygiene: {
        available: true,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
      },
    };

    const unknownArtifact = produceToolCloseoutLifecycleEvidenceArtifact({
      ...baseInput,
      actionKind: 'unknown',
    });
    const keyboardArtifact = produceToolCloseoutLifecycleEvidenceArtifact({
      ...baseInput,
      artifactId: 'runtime-artifact-tool-closeout-keyboard',
      actionKind: 'keyboard',
    });

    for (const artifact of [unknownArtifact, keyboardArtifact]) {
      expect(artifact.finalVerdict).toMatchObject({
        verdict: 'unknown',
        reason: 'postconditions_unknown',
      });
      expect(artifact.actionLog).toMatchObject({
        available: true,
        totalActions: 1,
        passed: 0,
        failed: 0,
        unknown: 1,
      });
      expect(artifact.actionLog.entries[0]).toMatchObject({
        verdict: 'unknown',
        reason: 'unsupported_action_kind_postcondition',
      });
    }
    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 2,
      lastFinalVerdict: 'unknown',
    });
  });

  it('keeps close-tab closeout honest when the shared action-kind contract has no close kind', () => {
    const artifact = produceToolCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-tool-closeout-close-contract-gap',
      evidenceLevel: 'integration',
      scenarioId: 'tool-close-tabs-success',
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 10,
      actionId: 'mcp:chrome_close_tabs:42',
      actionKind: 'unknown',
      tabId: 42,
      reason: 'close_tabs_cleanup_succeeded',
      unsupportedPostconditionReason: 'close_action_kind_blocked_by_shared_contract',
      browserHygiene: {
        available: true,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
        notes: ['v3RequiredAction=close'],
      },
    });

    expect(artifact.finalVerdict).toMatchObject({
      verdict: 'unknown',
      reason: 'postconditions_unknown',
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionKind: 'unknown',
      tabId: 42,
      verdict: 'unknown',
      reason: 'close_action_kind_blocked_by_shared_contract',
    });
    expect(artifact.browserHygiene.notes).toContain('v3RequiredAction=close');
  });

  it('rejects closeout success when browser hygiene changed', () => {
    expect(() =>
      produceToolCloseoutLifecycleEvidenceArtifact({
        artifactId: 'runtime-artifact-tool-closeout-changed',
        evidenceLevel: 'integration',
        scenarioId: 'tool-close-tabs-success',
        scenarioClass: 'browser_hygiene_closeout_v1',
        startedAtMs: T0,
        endedAtMs: T0 + 10,
        actionId: 'mcp:chrome_close_tabs:42',
        actionKind: 'click',
        tabId: 42,
        reason: 'close_tabs_cleanup_succeeded',
        browserHygiene: {
          available: true,
          runOwnedTabsClosed: 1,
          baselineChanged: true,
        },
      }),
    ).toThrow(/unchanged browser hygiene/);
  });

  it('derives BNS-03 dynamic watch scope transitions from task context', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('fact_snapshot', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          stable: true,
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-scope',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-scope',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
      taskContext: {
        intent: 'search for release notes',
        pageRole: 'search_results',
        pageStability: 'stable',
      },
    });

    expect(artifact.scopeTransitions).toMatchObject({
      available: true,
      totalTransitions: 1,
      transitions: [
        {
          scopeKind: 'search',
          tabId: 42,
          reason: 'generic_search_category_match',
          producedAtMs: T0,
        },
      ],
    });
    expect(
      artifact.scopeTransitions.available ? artifact.scopeTransitions.transitions[0].regions : [],
    ).toEqual([
      { regionId: 'query_input', regionPurpose: 'input', expectedRole: 'searchbox' },
      { regionId: 'result_region', regionPurpose: 'output', expectedRole: null },
      { regionId: 'empty_state', regionPurpose: 'feedback', expectedRole: null },
    ]);
  });

  it.each([
    {
      name: 'auth',
      taskContext: {
        intent: 'resume auth collaboration',
        pageRole: 'login_required',
        pageStability: 'stable' as const,
      },
      expectedScopeKind: 'auth',
      expectedReason: 'generic_auth_category_match',
      expectedRegion: {
        regionId: 'credential_input',
        regionPurpose: 'input',
        expectedRole: 'textbox',
      },
    },
    {
      name: 'challenge',
      taskContext: {
        intent: 'resume verification collaboration',
        pageRole: 'challenge_required',
        pageStability: 'stable' as const,
      },
      expectedScopeKind: 'challenge',
      expectedReason: 'generic_challenge_category_match',
      expectedRegion: {
        regionId: 'challenge_prompt',
        regionPurpose: 'feedback',
        expectedRole: 'status',
      },
    },
    {
      name: 'multi_tab',
      taskContext: {
        intent: 'review multi tab state',
        pageRole: 'tab_management',
        pageStability: 'stable' as const,
      },
      expectedScopeKind: 'multi_tab',
      expectedReason: 'generic_multi_tab_category_match',
      expectedRegion: {
        regionId: 'tab_set',
        regionPurpose: 'navigation',
        expectedRole: null,
      },
    },
    {
      name: 'user_takeover',
      taskContext: {
        intent: 'pause for user takeover',
        pageRole: 'user_took_over',
        pageStability: 'stable' as const,
      },
      expectedScopeKind: 'user_takeover',
      expectedReason: 'generic_user_takeover_category_match',
      expectedRegion: {
        regionId: 'user_activity_region',
        regionPurpose: 'feedback',
        expectedRole: null,
      },
    },
    {
      name: 'error_recovery',
      taskContext: {
        intent: 'recover from error state',
        pageRole: 'error_page_detected',
        pageStability: 'stable' as const,
      },
      expectedScopeKind: 'error_recovery',
      expectedReason: 'generic_error_recovery_category_match',
      expectedRegion: {
        regionId: 'error_indicator',
        regionPurpose: 'feedback',
        expectedRole: 'alert',
      },
    },
  ])(
    'derives BNS-03 $name watch scope transitions into runtime artifacts',
    ({ taskContext, expectedScopeKind, expectedReason, expectedRegion }) => {
      ensureLifecycleEvidenceCollectorRegistered();
      dispatchBridgeObservationToStream(
        makeBridgeMessage('fact_snapshot', {
          tabId: 42,
          observedAtMs: T0,
          data: {
            stable: true,
          },
        }),
      );

      const artifact = produceRuntimeLifecycleEvidenceArtifact({
        artifactId: `runtime-artifact-scope-${expectedScopeKind}`,
        evidenceLevel: 'integration',
        scenarioId: `scenario-scope-${expectedScopeKind}`,
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        endedAtMs: T0,
        eventWindow: { tabIds: [42] },
        taskContext,
      });

      expect(artifact.scopeTransitions).toMatchObject({
        available: true,
        totalTransitions: 1,
        transitions: [
          {
            scopeKind: expectedScopeKind,
            tabId: 42,
            reason: expectedReason,
            producedAtMs: T0,
          },
        ],
      });
      expect(
        artifact.scopeTransitions.available ? artifact.scopeTransitions.transitions[0].regions : [],
      ).toEqual(expect.arrayContaining([expectedRegion]));
      expect(artifact.claimBoundary).toMatchObject({
        realBrowserProven: false,
        commercialGradeProven: false,
      });
    },
  );

  it('keeps BNS-03 unavailable when task context is absent', () => {
    ensureLifecycleEvidenceCollectorRegistered();

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-no-scope',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-no-scope',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(artifact.scopeTransitions).toEqual({
      available: false,
      reason: 'bns_03_not_available',
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
