import type {
  BridgeObservationMessage,
  BridgeObservationMessagePayload,
  LifecycleEvidenceBrowserHygieneCheck,
  ObservationKind,
  ReadPageRegion,
  ReadPageRegionType,
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
  produceUnifiedTaskCloseoutLifecycleEvidenceArtifact,
  resetLifecycleEvidenceCollectorForTests,
  setLifecycleEvidenceCollectorHygieneSnapshotProviderForTests,
  setLifecycleEvidenceCollectorMaxBufferedEventsForTests,
  unregisterLifecycleEvidenceCollector,
} from './lifecycle-evidence-collector';
import { verifyRegionStatePostcondition } from './action-postcondition-verifier';
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

function region(
  regionType: ReadPageRegionType,
  state: string,
  overrides: Partial<ReadPageRegion> = {},
): ReadPageRegion {
  return {
    regionId: overrides.regionId ?? `${regionType}-1`,
    regionType,
    state,
    confidence: overrides.confidence ?? 0.8,
    objects: overrides.objects ?? [],
    candidateActionIds: overrides.candidateActionIds ?? [],
    targetability: overrides.targetability ?? 'unknown',
    claimBoundary: overrides.claimBoundary ?? 'deterministic test fixture only',
  };
}

function resultRow(suffix: string, objectType: 'record' | 'entry' = 'record') {
  return {
    objectId: `row-${suffix}`,
    label: 'redacted row',
    objectType,
    targetRef: `tgt_row_${suffix}`,
    actionTypes: ['open_detail'],
    targetability: 'target_ref' as const,
    confidence: 0.8,
    reason: 'deterministic row fixture',
  };
}

function resultCollection(...rows: ReturnType<typeof resultRow>[]): ReadPageRegion[] {
  return [region('content', 'result_collection_candidate', { objects: rows })];
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 10, regionTag: 'main' }],
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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

  it('keeps no-observed-change action outcomes as unproven postconditions', () => {
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
      failed: 0,
      unknown: 1,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'act-click-noop',
      verdict: 'unknown',
      observedOutcome: 'no_observed_change',
      reason: 'low_confidence',
    });
    expect(artifact.signalSequence).toEqual({
      available: false,
      reason: 'bns_02_not_available',
    });
    expect(artifact.finalVerdict).toEqual({
      verdict: 'unknown',
      confidence: 0.2,
      reason: 'postconditions_unknown',
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 10, regionTag: 'main' }],
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0 + 20, regionTag: 'main' }],
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
          actionKind: 'scroll',
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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

  it('keeps action outcomes with malformed signal entries as unknown postconditions', () => {
    ensureLifecycleEvidenceCollectorRegistered();
    dispatchBridgeObservationToStream(
      makeBridgeMessage('action_outcome', {
        tabId: 42,
        observedAtMs: T0,
        data: {
          actionId: 'act-malformed-signal',
          actionKind: 'click',
          signals: [null],
        },
      }),
    );

    const artifact = produceRuntimeLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-malformed-signal-postcondition',
      evidenceLevel: 'integration',
      scenarioId: 'scenario-malformed-signal-postcondition',
      scenarioClass: 'postcondition_failure_v1',
      startedAtMs: T0,
      endedAtMs: T0,
      eventWindow: { tabIds: [42] },
    });

    expect(getLifecycleEvidenceCollectorSnapshot().bufferedPostconditions).toBe(1);
    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 1,
      passed: 0,
      failed: 0,
      unknown: 1,
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionId: 'act-malformed-signal',
      actionKind: 'click',
      verdict: 'unknown',
      reason: 'action_outcome_classification_failed',
      observedOutcome: 'unknown',
      observedOutcomeConfidence: 0,
    });
    expect(JSON.stringify(artifact.actionLog)).not.toContain('sourcePayload');
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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
          signals: [{ kind: 'dom_region_changed', observedAtMs: T0, regionTag: 'main' }],
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

  it('records a unified navigate/read/close task closeout without leaking raw timeline URLs', () => {
    const artifact = produceUnifiedTaskCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-unified-closeout',
      evidenceLevel: 'integration',
      scenarioId: 'tool-unified-closeout',
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      tabIds: [42],
      taskTimeline: [
        {
          eventId: 'lifecycle:1',
          index: 1,
          at: new Date(T0).toISOString(),
          kind: 'navigation',
          tabId: 42,
          url: 'https://private.example/account?token=SECRET',
        },
        {
          eventId: 'lifecycle:2',
          index: 2,
          at: new Date(T0 + 10).toISOString(),
          kind: 'projection_created',
          tabId: 42,
        },
        {
          eventId: 'lifecycle:3',
          index: 3,
          at: new Date(T0 + 20).toISOString(),
          kind: 'cleanup',
          tabId: 42,
        },
      ],
      readAction: {
        actionId: 'mcp:chrome_read_page:42',
        tabId: 42,
        verdict: 'passed',
        reason: 'read_page_projection_available',
        observedOutcome: 'content_changed',
      },
      closeAction: {
        actionId: 'mcp:chrome_close_tabs:42',
        tabId: 42,
        reason: 'close_tabs_cleanup_succeeded',
      },
      sourceTruthChain: {
        primaryOrigin: 'dom',
        provenanceCreatedAt: new Date(T0).toISOString(),
        fieldProvenances: [
          { field: 'pageProjection.chosenDataSource', origin: 'dom', isFact: true },
        ],
      },
      browserHygiene: {
        available: true,
        baselineTabs: null,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
        notes: ['sourceRouteHonestyBoundary=not_integrated_until_R3'],
      },
    });

    expect(artifact.eventTimeline).toMatchObject({
      available: true,
      totalEvents: 3,
      eventsByKind: { observation_unknown: 3 },
    });
    expect(artifact.signalSequence).toMatchObject({
      available: true,
      signalsByKind: { ready_to_act: 1 },
    });
    expect(artifact.scopeTransitions).toMatchObject({ available: true, totalTransitions: 1 });
    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 2,
      passed: 2,
    });
    expect(artifact.sourceTruthChain?.primaryOrigin).toBe('dom');
    expect(artifact.claimBoundary.sourceRouteProven).toBe(false);
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain('private.example');
    expect(serialized).not.toContain('SECRET');
  });

  it('carries region-state postconditions into the unified lifecycle action log', () => {
    const logoutState = verifyRegionStatePostcondition({
      kind: 'logout_completed',
      actionId: 'act-logout',
      beforeRegions: [region('account', 'logged_in_candidate')],
      afterRegions: [region('account', 'logged_out_candidate')],
      now: () => T0 + 15,
    });
    const qrState = verifyRegionStatePostcondition({
      kind: 'qr_waiting',
      actionId: 'act-qr',
      beforeRegions: [],
      afterRegions: [region('qr_code', 'waiting_scan_candidate')],
      now: () => T0 + 16,
    });

    const artifact = produceUnifiedTaskCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-unified-region-state-closeout',
      evidenceLevel: 'integration',
      scenarioId: 'tool-unified-region-state-closeout',
      scenarioClass: 'auth_state_change_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      tabIds: [42],
      taskTimeline: [
        {
          eventId: 'lifecycle:1',
          index: 1,
          at: new Date(T0).toISOString(),
          kind: 'projection_created',
          tabId: 42,
          pageRole: 'login_required',
        },
        {
          eventId: 'lifecycle:2',
          index: 2,
          at: new Date(T0 + 20).toISOString(),
          kind: 'region_changed',
          tabId: 42,
        },
        {
          eventId: 'lifecycle:3',
          index: 3,
          at: new Date(T0 + 30).toISOString(),
          kind: 'cleanup',
          tabId: 42,
        },
      ],
      readAction: {
        actionId: 'mcp:chrome_read_page:42',
        tabId: 42,
        verdict: 'passed',
        reason: 'read_page_projection_available',
      },
      regionStatePostconditions: [
        { actionKind: 'click', result: logoutState },
        { actionKind: 'read', result: qrState },
      ],
      closeAction: {
        actionId: 'mcp:chrome_close_tabs:42',
        tabId: 42,
        reason: 'close_tabs_cleanup_succeeded',
      },
      browserHygiene: {
        available: true,
        baselineTabs: null,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
      },
    });

    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 4,
      passed: 4,
    });
    expect(artifact.actionLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'act-logout',
          actionKind: 'click',
          verdict: 'passed',
          reason: expect.stringContaining('region_state_logout_completed'),
        }),
        expect.objectContaining({
          actionId: 'act-qr',
          actionKind: 'read',
          verdict: 'passed',
          reason: expect.stringContaining('QR presence alone is not business success'),
        }),
      ]),
    );
    const serialized = JSON.stringify(artifact);
    expect(serialized).toContain('before=account:logged_in_candidate:unknown:actions:0');
    expect(serialized).toContain('after=account:logged_out_candidate:unknown:actions:0');
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('Authorization');
  });

  it('carries search list and detail region-state postconditions into unified closeout evidence', () => {
    const detailTarget = { ...resultRow('2', 'entry'), label: 'alpha launch poster' };
    const resultRows = resultCollection(resultRow('1'), detailTarget);
    const searchState = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search',
      beforeRegions: [region('form', 'search_ready_candidate')],
      afterRegions: resultRows,
      now: () => T0 + 15,
    });
    const detailState = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultRows,
      afterRegions: [
        region('content', 'detail_open_candidate', {
          label: 'alpha launch poster detail',
          objects: [
            {
              objectId: 'detail-alpha-launch-poster-title',
              label: 'alpha launch poster',
              objectType: 'title',
              confidence: 0.8,
            },
            {
              objectId: 'detail-alpha-launch-poster-body',
              label: 'alpha launch poster expanded content',
              objectType: 'article',
              confidence: 0.8,
            },
          ],
        }),
      ],
      targetRefs: [detailTarget.targetRef],
      now: () => T0 + 20,
    });

    const artifact = produceUnifiedTaskCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-search-detail-region-state-closeout',
      evidenceLevel: 'integration',
      scenarioId: 'tool-search-detail-region-state-closeout',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      tabIds: [42],
      taskTimeline: [
        {
          eventId: 'lifecycle:1',
          index: 1,
          at: new Date(T0).toISOString(),
          kind: 'projection_created',
          tabId: 42,
          pageRole: 'search_list',
        },
        {
          eventId: 'lifecycle:2',
          index: 2,
          at: new Date(T0 + 20).toISOString(),
          kind: 'region_changed',
          tabId: 42,
        },
      ],
      regionStatePostconditions: [
        {
          actionKind: 'submit',
          result: searchState,
          topNAccumulationEvidence: {
            status: 'ready_for_default_top_n',
            defaultTopN: 10,
            accumulationScope: 'task_tab_source_region',
            sourceTabId: 42,
            sourceRegion: 'result_list',
            observedReadCount: 2,
            currentReadReliableRowCount: 6,
            currentReadTargetableRowCount: 6,
            currentReadSummarizableRowCount: 6,
            currentReadTitleRowCount: 6,
            currentReadSupportingTextRowCount: 6,
            currentReadMetadataRowCount: 0,
            currentReadNewUniqueRowCount: 4,
            duplicateReliableRowCount: 2,
            uniqueReliableRowCount: 10,
            uniqueTargetableRowCount: 10,
            uniqueSummarizableRowCount: 10,
            uniqueTitleRowCount: 10,
            uniqueSupportingTextRowCount: 10,
            uniqueMetadataRowCount: 0,
            uniqueTargetRefCount: 10,
            rowOrder: 'visual_order',
            canSatisfyDefaultTopN: true,
            missingRowCountForDefaultTopN: 0,
            canSupportDefaultTopNSummary: true,
            missingSummarizableRowCountForDefaultTopN: 0,
            fieldCoverageStatus: 'structured_summary_fields_ready',
            canSupportDefaultTopNFieldSummary: true,
            missingTitleRowCountForDefaultTopN: 0,
            nextRequiredCheck: 'accumulated_rows_ready_for_top_n_summary',
            summaryNextRequiredCheck: 'top_n_summary_ready',
            summaryQualityNextRequiredCheck: 'structured_top_n_summary_ready',
            claimBoundary:
              'Only unique targetable and summarizable DOM rows observed in this task/session are proven.',
          },
        },
        { actionKind: 'click', result: detailState },
      ],
      closeAction: {
        actionId: 'mcp:chrome_close_tabs:42',
        tabId: 42,
        reason: 'close_tabs_cleanup_succeeded',
      },
      browserHygiene: {
        available: true,
        baselineTabs: null,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
      },
    });

    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 3,
      passed: 3,
    });
    expect(artifact.actionLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'act-search',
          actionKind: 'submit',
          verdict: 'passed',
          reason: expect.stringContaining('region_state_search_results_updated'),
        }),
        expect.objectContaining({
          actionId: 'act-open-detail',
          actionKind: 'click',
          verdict: 'passed',
          reason: expect.stringContaining('region_state_detail_opened'),
        }),
      ]),
    );
    const serialized = JSON.stringify(artifact);
    expect(serialized).toContain('after=content:result_collection_candidate:unknown:actions:0');
    expect(serialized).toContain('after=content:detail_open_candidate:unknown:actions:0');
    expect(serialized).toContain('top_n_accumulation:status=ready_for_default_top_n');
    expect(serialized).toContain('summaryReady=true');
    expect(serialized).toContain('fieldSummaryReady=true');
    expect(serialized).toContain('fieldCoverage=structured_summary_fields_ready');
    expect(serialized).toContain('defaultN=10');
    expect(serialized).toContain('uniqueTargetable=10');
    expect(serialized).toContain('uniqueTitle=10');
    expect(serialized).toContain('uniqueSupporting=10');
    expect(serialized).toContain('missing=0');
    expect(serialized).toContain('detail_field_readback:status=structured_fields_present');
    expect(serialized).toContain('summaryReady=true');
    expect(serialized).toContain('semantic=matched');
    const searchEntry = artifact.actionLog.entries.find((entry) => entry.actionId === 'act-search');
    expect(searchEntry?.reason).not.toContain('alpha launch poster');
    expect(serialized).not.toContain('cookie');
    expect(serialized).not.toContain('Authorization');
  });

  it('keeps each region-state postcondition bound to its source tab in multi-tab closeout', () => {
    const searchState = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search-tab-7',
      beforeRegions: [region('form', 'search_ready_candidate')],
      afterRegions: resultCollection(resultRow('1'), resultRow('2')),
      now: () => T0 + 15,
    });
    const detailState = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-detail-tab-9',
      beforeRegions: resultCollection(resultRow('1'), resultRow('2', 'entry')),
      afterRegions: [
        region('content', 'detail_open_candidate', {
          label: 'second result detail',
          objects: [
            {
              objectId: 'detail-second-result',
              label: 'second result detail body',
              objectType: 'article',
              confidence: 0.82,
            },
          ],
        }),
      ],
      targetRefs: ['tgt_row_2'],
      now: () => T0 + 20,
    });

    const artifact = produceUnifiedTaskCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-multitab-region-state-closeout',
      evidenceLevel: 'integration',
      scenarioId: 'tool-multitab-region-state-closeout',
      scenarioClass: 'search_result_delta_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 30,
      tabIds: [9, 7],
      taskTimeline: [
        {
          eventId: 'lifecycle:tab7',
          index: 1,
          at: new Date(T0).toISOString(),
          kind: 'projection_created',
          tabId: 7,
          pageRole: 'search_list',
        },
        {
          eventId: 'lifecycle:tab9',
          index: 2,
          at: new Date(T0 + 20).toISOString(),
          kind: 'region_changed',
          tabId: 9,
        },
      ],
      regionStatePostconditions: [
        { tabId: 7, actionKind: 'submit', result: searchState },
        { tabId: 9, actionKind: 'click', result: detailState },
      ],
      closeAction: {
        actionId: 'mcp:chrome_close_tabs:9',
        tabId: 9,
        reason: 'close_tabs_cleanup_succeeded',
      },
      browserHygiene: {
        available: true,
        baselineTabs: null,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
      },
    });

    expect(artifact.actionLog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionId: 'act-search-tab-7',
          actionKind: 'submit',
          tabId: 7,
        }),
        expect.objectContaining({
          actionId: 'act-detail-tab-9',
          actionKind: 'click',
          tabId: 9,
        }),
      ]),
    );
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

  it('uses the close action kind for close-tab closeout once the shared contract supports it', () => {
    const artifact = produceToolCloseoutLifecycleEvidenceArtifact({
      artifactId: 'runtime-artifact-tool-closeout-close-action-kind',
      evidenceLevel: 'integration',
      scenarioId: 'tool-close-tabs-success',
      scenarioClass: 'browser_hygiene_closeout_v1',
      startedAtMs: T0,
      endedAtMs: T0 + 10,
      actionId: 'mcp:chrome_close_tabs:42',
      actionKind: 'close',
      tabId: 42,
      reason: 'close_tabs_cleanup_succeeded',
      browserHygiene: {
        available: true,
        runOwnedTabsClosed: 1,
        baselineChanged: false,
        checks: makeCleanHygieneChecks(),
        notes: ['v3RequiredAction=close'],
      },
    });

    expect(artifact.finalVerdict).toMatchObject({
      verdict: 'task_success',
      reason: 'postconditions_passed',
    });
    expect(artifact.actionLog.entries[0]).toMatchObject({
      actionKind: 'close',
      tabId: 42,
      verdict: 'passed',
      reason: 'close_tabs_cleanup_succeeded',
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

  it.each([
    'real_browser',
    'private_scenario',
    'competitor',
    'same_scenario_competitor',
    'release_gate',
  ])('rejects %s evidence from runtime collectors', (evidenceLevel) => {
    expect(() =>
      produceRuntimeLifecycleEvidenceArtifact({
        artifactId: `runtime-artifact-${evidenceLevel}`,
        evidenceLevel,
        scenarioId: `scenario-${evidenceLevel}`,
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        endedAtMs: T0,
        eventWindow: { tabIds: [42] },
      } as any),
    ).toThrow(/only accepts source, unit, integration, or local_runner evidence/);

    expect(() =>
      produceToolFailureLifecycleEvidenceArtifact({
        artifactId: `tool-failure-artifact-${evidenceLevel}`,
        evidenceLevel,
        scenarioId: `scenario-${evidenceLevel}`,
        scenarioClass: 'postcondition_failure_v1',
        startedAtMs: T0,
        endedAtMs: T0,
        actionId: 'action-1',
        actionKind: 'click',
        tabId: 42,
        reason: 'failure reason',
      } as any),
    ).toThrow(/only accepts source, unit, integration, or local_runner evidence/);

    expect(() =>
      produceToolCloseoutLifecycleEvidenceArtifact({
        artifactId: `tool-closeout-artifact-${evidenceLevel}`,
        evidenceLevel,
        scenarioId: `scenario-${evidenceLevel}`,
        scenarioClass: 'browser_hygiene_closeout_v1',
        startedAtMs: T0,
        endedAtMs: T0,
        actionId: 'action-2',
        actionKind: 'click',
        tabId: 42,
        reason: 'closeout reason',
        browserHygiene: { available: true },
      } as any),
    ).toThrow(/only accepts source, unit, integration, or local_runner evidence/);
  });
});
