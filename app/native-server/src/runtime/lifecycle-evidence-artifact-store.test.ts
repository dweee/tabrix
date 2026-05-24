import type { LifecycleEvidenceArtifact } from '@tabrix/shared';
import {
  getLifecycleEvidenceArtifactStoreSnapshot,
  listLifecycleEvidenceArtifacts,
  recordLifecycleEvidenceArtifact,
  resetLifecycleEvidenceArtifactStoreForTests,
  setLifecycleEvidenceArtifactStoreMaxArtifactsForTests,
} from './lifecycle-evidence-artifact-store';

const T0 = 1_700_000_000_000;

function makeArtifact(
  overrides: Partial<LifecycleEvidenceArtifact> = {},
): LifecycleEvidenceArtifact {
  return {
    artifactId: overrides.artifactId ?? 'artifact-1',
    version: 1,
    evidenceLevel: 'integration',
    scenarioId: 'scenario-1',
    scenarioClass: 'search_result_delta_v1',
    baseline: {
      scenarioId: 'scenario-1',
      scenarioClass: 'search_result_delta_v1',
      evidenceLevel: 'integration',
      startedAtMs: T0,
    },
    eventTimeline: {
      available: false,
      totalEvents: 0,
      eventsByKind: {},
      firstEventAtMs: null,
      lastEventAtMs: null,
      keyEvents: [],
    },
    signalSequence: {
      available: false,
      reason: 'bns_02_not_available',
    },
    scopeTransitions: {
      available: false,
      reason: 'bns_03_not_available',
    },
    actionLog: {
      available: false,
      totalActions: 0,
      passed: 0,
      failed: 0,
      unknown: 0,
      entries: [],
    },
    browserHygiene: {
      available: false,
      baselineTabs: null,
      runOwnedTabsClosed: null,
      baselineChanged: null,
      notes: [],
    },
    sourceTruthChain: null,
    claimBoundary: {
      deterministicArtifactOnly: true,
      realBrowserProven: false,
      commercialGradeProven: false,
      competitorSuperiorityProven: false,
      fallbackSuccessSeparated: false,
      sourceRouteProven: false,
    },
    finalVerdict: {
      verdict: 'unknown',
      confidence: 0,
      reason: 'no_postcondition_results',
    },
    producedAtMs: T0,
    ...overrides,
  };
}

beforeEach(() => {
  resetLifecycleEvidenceArtifactStoreForTests();
});

describe('lifecycle-evidence-artifact-store', () => {
  it('records artifacts and exposes a compact snapshot', () => {
    recordLifecycleEvidenceArtifact(
      makeArtifact({
        artifactId: 'artifact-success',
        finalVerdict: {
          verdict: 'task_success',
          confidence: 0.8,
          reason: 'postconditions_passed',
        },
        producedAtMs: T0 + 10,
      }),
    );

    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toEqual({
      bufferedArtifacts: 1,
      droppedArtifacts: 0,
      lastArtifactId: 'artifact-success',
      lastFinalVerdict: 'task_success',
      lastProducedAtMs: T0 + 10,
      maxArtifacts: 20,
    });
  });

  it('returns cloned artifacts so callers cannot mutate store state', () => {
    recordLifecycleEvidenceArtifact(makeArtifact({ artifactId: 'artifact-immutable' }));
    const listed = listLifecycleEvidenceArtifacts();
    listed[0].artifactId = 'mutated';

    expect(listLifecycleEvidenceArtifacts()[0].artifactId).toBe('artifact-immutable');
  });

  it('evicts old artifacts when bounded', () => {
    setLifecycleEvidenceArtifactStoreMaxArtifactsForTests(2);
    recordLifecycleEvidenceArtifact(makeArtifact({ artifactId: 'artifact-1' }));
    recordLifecycleEvidenceArtifact(makeArtifact({ artifactId: 'artifact-2' }));
    recordLifecycleEvidenceArtifact(makeArtifact({ artifactId: 'artifact-3' }));

    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toMatchObject({
      bufferedArtifacts: 2,
      droppedArtifacts: 1,
      lastArtifactId: 'artifact-3',
    });
    expect(listLifecycleEvidenceArtifacts().map((artifact) => artifact.artifactId)).toEqual([
      'artifact-2',
      'artifact-3',
    ]);
  });
});
