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
        actionLog: {
          available: true,
          totalActions: 1,
          passed: 1,
          failed: 0,
          unknown: 0,
          entries: [
            {
              actionId: 'action-1',
              actionKind: 'click',
              tabId: 42,
              urlPattern: null,
              verdict: 'passed',
              reason: 'outcome_supports_click',
              observedOutcome: 'modal_opened',
              observedOutcomeConfidence: 0.8,
              sourceEventRefs: [{ kind: 'unknown', id: 'action-1', origin: 'runtime' }],
              sourceOrigins: ['runtime'],
              producedAtMs: T0 + 10,
            },
          ],
        },
        producedAtMs: T0 + 10,
      }),
    );

    expect(getLifecycleEvidenceArtifactStoreSnapshot()).toEqual({
      bufferedArtifacts: 1,
      droppedArtifacts: 0,
      lastArtifactId: 'artifact-success',
      lastFinalVerdict: 'task_success',
      lastFinalVerdictReason: 'postconditions_passed',
      lastScenarioId: 'scenario-1',
      lastScenarioClass: 'search_result_delta_v1',
      lastActionKind: 'click',
      lastPostconditionVerdict: 'passed',
      lastPostconditionReason: 'outcome_supports_click',
      lastProducedAtMs: T0 + 10,
      maxArtifacts: 20,
    });
  });

  it('exposes only redaction-safe last artifact reasons in the compact snapshot', () => {
    recordLifecycleEvidenceArtifact(
      makeArtifact({
        artifactId: 'artifact-close-action-kind',
        scenarioId: 'mcp:chrome_close_tabs:cleanup_success',
        scenarioClass: 'browser_hygiene_closeout_v1',
        actionLog: {
          available: true,
          totalActions: 1,
          passed: 1,
          failed: 0,
          unknown: 0,
          entries: [
            {
              actionId: 'mcp:chrome_close_tabs:42',
              actionKind: 'close',
              tabId: 42,
              urlPattern: 'private.example/should-not-be-in-snapshot',
              verdict: 'passed',
              reason: 'close_tabs_cleanup_succeeded',
              observedOutcome: 'unknown',
              observedOutcomeConfidence: 0.75,
              sourceEventRefs: [{ kind: 'unknown', id: 'action-1', origin: 'runtime' }],
              sourceOrigins: ['runtime'],
              producedAtMs: T0 + 1,
            },
          ],
        },
        finalVerdict: {
          verdict: 'unknown',
          confidence: 0.2,
          reason: 'postconditions_unknown',
        },
      }),
    );

    const snapshot = getLifecycleEvidenceArtifactStoreSnapshot();
    expect(snapshot).toMatchObject({
      lastArtifactId: 'artifact-close-action-kind',
      lastFinalVerdict: 'unknown',
      lastFinalVerdictReason: 'postconditions_unknown',
      lastScenarioId: 'mcp:chrome_close_tabs:cleanup_success',
      lastScenarioClass: 'browser_hygiene_closeout_v1',
      lastActionKind: 'close',
      lastPostconditionVerdict: 'passed',
      lastPostconditionReason: 'close_tabs_cleanup_succeeded',
    });
    expect(JSON.stringify(snapshot)).not.toContain('private.example');
    expect(JSON.stringify(snapshot)).not.toContain('urlPattern');
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
