import type {
  BrowserSourceTruthChain,
  BrowserStreamEvent,
  PostconditionResult,
} from '@tabrix/shared';
import { produceLifecycleEvidenceArtifact } from './lifecycle-evidence-artifact';

const T0 = 1_700_000_000_000;
const PRODUCED_AT = T0 + 9_999;

function makeStreamEvent(overrides: Partial<BrowserStreamEvent> = {}): BrowserStreamEvent {
  return {
    streamEventId: overrides.streamEventId ?? 'stream-1',
    correlationGroupId: overrides.correlationGroupId ?? 'tab:1:1700000000',
    kind: overrides.kind ?? 'observation_action_outcome',
    observedAtMs: overrides.observedAtMs ?? T0,
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/list',
    sourceObservationKind: overrides.sourceObservationKind ?? 'action_outcome',
    sourcePayload: overrides.sourcePayload ?? { rawText: 'PRIVATE_TEXT_SHOULD_NOT_APPEAR' },
  };
}

function makePostcondition(overrides: Partial<PostconditionResult> = {}): PostconditionResult {
  return {
    actionId: overrides.actionId ?? 'act-1',
    actionKind: overrides.actionKind ?? 'click',
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/list',
    verdict: overrides.verdict ?? 'passed',
    reason: overrides.reason ?? 'outcome_supports_click',
    observedOutcome: overrides.observedOutcome ?? 'spa_partial_update',
    observedOutcomeConfidence: overrides.observedOutcomeConfidence ?? 0.85,
    sourceEventRefs: overrides.sourceEventRefs ?? [
      {
        kind: 'action_outcome',
        id: 'action_outcome:act-1',
        origin: 'action_outcome_classifier',
      },
    ],
    sourceOrigins: overrides.sourceOrigins ?? ['runtime', 'action_outcome_classifier', 'inference'],
    producedAtMs: overrides.producedAtMs ?? T0 + 500,
  };
}

function makeSourceTruthChain(): BrowserSourceTruthChain {
  return {
    primaryOrigin: 'browser_runtime',
    fieldProvenances: [
      { field: 'pageProjection.tabId', origin: 'browser_runtime', isFact: true },
      { field: 'pageProjection.activeRegion', origin: 'inference', isFact: false },
    ],
    provenanceCreatedAt: '2026-05-24T00:00:00.000Z',
  };
}

describe('lifecycle-evidence-artifact — artifact shape', () => {
  it('always emits every required section', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-1',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-1',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
      },
      { now: () => PRODUCED_AT },
    );

    expect(artifact).toMatchObject({
      artifactId: 'artifact-1',
      version: 1,
      evidenceLevel: 'unit',
      scenarioId: 'scenario-1',
      scenarioClass: 'search_result_delta_v1',
      producedAtMs: PRODUCED_AT,
    });
    expect(artifact.baseline).toBeDefined();
    expect(artifact.eventTimeline).toBeDefined();
    expect(artifact.signalSequence).toEqual({
      available: false,
      reason: 'bns_02_not_available',
    });
    expect(artifact.scopeTransitions).toEqual({
      available: false,
      reason: 'bns_03_not_available',
    });
    expect(artifact.actionLog).toBeDefined();
    expect(artifact.browserHygiene).toBeDefined();
    expect(artifact.claimBoundary).toBeDefined();
    expect(artifact.finalVerdict).toBeDefined();
  });

  it('round-trips as JSON without losing source truth isFact provenance', () => {
    const sourceTruthChain = makeSourceTruthChain();
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-2',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-2',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        sourceTruthChain,
      },
      { now: () => PRODUCED_AT },
    );

    const parsed = JSON.parse(JSON.stringify(artifact));
    expect(parsed.sourceTruthChain.fieldProvenances).toEqual(sourceTruthChain.fieldProvenances);
    expect(parsed.sourceTruthChain.fieldProvenances[1].isFact).toBe(false);
  });
});

describe('lifecycle-evidence-artifact — event timeline', () => {
  it('counts BNS-01 events by kind and records first/last observed timestamps', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-3',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-3',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        streamEvents: [
          makeStreamEvent({
            streamEventId: 'stream-1',
            kind: 'observation_lifecycle',
            observedAtMs: T0 + 30,
          }),
          makeStreamEvent({
            streamEventId: 'stream-2',
            kind: 'observation_action_outcome',
            observedAtMs: T0 + 10,
          }),
          makeStreamEvent({
            streamEventId: 'stream-3',
            kind: 'observation_action_outcome',
            observedAtMs: T0 + 20,
          }),
        ],
      },
      { now: () => PRODUCED_AT },
    );

    expect(artifact.eventTimeline.available).toBe(true);
    expect(artifact.eventTimeline.totalEvents).toBe(3);
    expect(artifact.eventTimeline.eventsByKind).toEqual({
      observation_lifecycle: 1,
      observation_action_outcome: 2,
    });
    expect(artifact.eventTimeline.firstEventAtMs).toBe(T0 + 10);
    expect(artifact.eventTimeline.lastEventAtMs).toBe(T0 + 30);
  });

  it('bounds key events and excludes raw sourcePayload content', () => {
    const events = Array.from({ length: 5 }, (_, index) =>
      makeStreamEvent({
        streamEventId: `stream-${index}`,
        observedAtMs: T0 + index,
        sourcePayload: {
          rawText: 'PRIVATE_TEXT_SHOULD_NOT_APPEAR',
          Authorization: 'secret',
        },
      }),
    );

    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-4',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-4',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        streamEvents: events,
      },
      { now: () => PRODUCED_AT, maxKeyEvents: 2 },
    );

    expect(artifact.eventTimeline.keyEvents).toHaveLength(2);
    const serialized = JSON.stringify(artifact.eventTimeline.keyEvents);
    expect(serialized).not.toContain('PRIVATE_TEXT_SHOULD_NOT_APPEAR');
    expect(serialized).not.toContain('Authorization');
  });
});

describe('lifecycle-evidence-artifact — action log and verdicts', () => {
  it('summarizes BNS-04A postcondition results without changing verdicts', () => {
    const entries = [
      makePostcondition({ actionId: 'act-pass', verdict: 'passed' }),
      makePostcondition({ actionId: 'act-fail', verdict: 'failed' }),
      makePostcondition({ actionId: 'act-unknown', verdict: 'unknown' }),
    ];

    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-5',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-5',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        postconditionResults: entries,
      },
      { now: () => PRODUCED_AT },
    );

    expect(artifact.actionLog).toMatchObject({
      available: true,
      totalActions: 3,
      passed: 1,
      failed: 1,
      unknown: 1,
    });
    expect(artifact.actionLog.entries.map((entry) => entry.verdict)).toEqual([
      'passed',
      'failed',
      'unknown',
    ]);
  });

  it('derives task_success when all postconditions pass', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-6',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-6',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        postconditionResults: [makePostcondition({ verdict: 'passed' })],
      },
      { now: () => PRODUCED_AT },
    );
    expect(artifact.finalVerdict.verdict).toBe('task_success');
  });

  it('derives task_failed when any postcondition fails', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-7',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-7',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        postconditionResults: [
          makePostcondition({ verdict: 'passed' }),
          makePostcondition({ verdict: 'failed' }),
        ],
      },
      { now: () => PRODUCED_AT },
    );
    expect(artifact.finalVerdict.verdict).toBe('task_failed');
  });

  it('derives partial_success for mixed passed and unknown postconditions', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-8',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-8',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        postconditionResults: [
          makePostcondition({ verdict: 'passed' }),
          makePostcondition({ verdict: 'unknown' }),
        ],
      },
      { now: () => PRODUCED_AT },
    );
    expect(artifact.finalVerdict.verdict).toBe('partial_success');
  });

  it('derives unknown when no postcondition result exists', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-9',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-9',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
      },
      { now: () => PRODUCED_AT },
    );
    expect(artifact.finalVerdict.verdict).toBe('unknown');
  });
});

describe('lifecycle-evidence-artifact — claim boundary', () => {
  it('does not let deterministic artifacts claim real-browser, commercial, or competitor proof', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-10',
        evidenceLevel: 'unit',
        scenarioId: 'scenario-10',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
        sourceTruthChain: makeSourceTruthChain(),
      },
      { now: () => PRODUCED_AT },
    );

    expect(artifact.claimBoundary).toMatchObject({
      deterministicArtifactOnly: true,
      realBrowserProven: false,
      commercialGradeProven: false,
      competitorSuperiorityProven: false,
      sourceRouteProven: true,
    });
  });

  it('still refuses commercial-grade proof even when evidenceLevel is real_browser', () => {
    const artifact = produceLifecycleEvidenceArtifact(
      {
        artifactId: 'artifact-11',
        evidenceLevel: 'real_browser',
        scenarioId: 'scenario-11',
        scenarioClass: 'search_result_delta_v1',
        startedAtMs: T0,
      },
      { now: () => PRODUCED_AT },
    );

    expect(artifact.claimBoundary.deterministicArtifactOnly).toBe(false);
    expect(artifact.claimBoundary.realBrowserProven).toBe(false);
    expect(artifact.claimBoundary.commercialGradeProven).toBe(false);
  });
});
