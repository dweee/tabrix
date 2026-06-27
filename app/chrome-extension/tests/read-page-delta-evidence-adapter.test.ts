import { describe, expect, it } from 'vitest';
import { derivePostActionDeltaEvidenceFromReadPageDelta } from '@tabrix/shared';
import type { ReadPagePageDeltaReport } from '@tabrix/shared';

function makeReport(overrides: Partial<ReadPagePageDeltaReport> = {}): ReadPagePageDeltaReport {
  return {
    source: 'read_page_delta_report',
    actionId: null,
    beforeSnapshotId: 'snap-before-001',
    afterSnapshotId: 'snap-after-001',
    beforeObservedAt: '2026-06-16T10:00:00.000Z',
    afterObservedAt: '2026-06-16T10:00:05.000Z',
    deltaKind: 'list_refreshed',
    changedRegions: ['main_list'],
    changedObjects: ['obj-1', 'obj-2'],
    recommendation: 'proceed',
    claimBoundary: 'Read-page delta evidence; DOM-layer only.',
    ...overrides,
  };
}

describe('derivePostActionDeltaEvidenceFromReadPageDelta', () => {
  describe('objectDelta.status mapping', () => {
    it('maps to "observed" when changedObjects is non-empty', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ changedObjects: ['obj-a', 'obj-b'] }),
      );
      expect(evidence.objectDelta.status).toBe('observed');
      expect(evidence.objectDelta.changedObjectIds).toEqual(['obj-a', 'obj-b']);
    });

    it('maps to "not_observed" when deltaKind is no_useful_change', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ changedObjects: [], deltaKind: 'no_useful_change' }),
      );
      expect(evidence.objectDelta.status).toBe('not_observed');
    });

    it('maps to "unknown" when deltaKind is blocked', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ changedObjects: [], deltaKind: 'blocked' }),
      );
      expect(evidence.objectDelta.status).toBe('unknown');
    });

    it('defaults to "observed" for other deltaKinds with empty changedObjects', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ changedObjects: [], deltaKind: 'spa_route_change' }),
      );
      expect(evidence.objectDelta.status).toBe('observed');
    });
  });

  describe('networkSignalSummary mapping', () => {
    it('maps to "observed" when requestStartedDelta is present', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({
          networkSignals: { requestStartedDelta: 5, failedRequestDelta: 1 },
        }),
      );
      expect(evidence.networkSignalSummary.status).toBe('observed');
      expect(evidence.networkSignalSummary.observedRequestCount).toBe(5);
      expect(evidence.networkSignalSummary.observedResponseCount).toBeNull();
    });

    it('maps to "not_checked" when networkSignals is absent', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ networkSignals: undefined }),
      );
      expect(evidence.networkSignalSummary.status).toBe('not_checked');
      expect(evidence.networkSignalSummary.observedRequestCount).toBeNull();
    });

    it('maps to "not_checked" when requestStartedDelta is null', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ networkSignals: { requestStartedDelta: null } }),
      );
      expect(evidence.networkSignalSummary.status).toBe('not_checked');
    });
  });

  describe('recommendedNextAction mapping', () => {
    const cases: Array<[ReadPagePageDeltaReport['recommendation'], string]> = [
      ['proceed', 'continue_with_post_action_delta_context'],
      ['wait', 'wait_for_settle_then_read'],
      ['refresh', 'refresh_then_read'],
      ['retry', 'retry_action_then_read'],
      ['stop', 'stop_and_report'],
      ['needs_user', 'escalate_to_user'],
    ];

    for (const [recommendation, expected] of cases) {
      it(`maps "${recommendation}" to "${expected}"`, () => {
        const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
          makeReport({ recommendation }),
        );
        expect(evidence.recommendedNextAction).toBe(expected);
      });
    }
  });

  describe('deltaKind mapping', () => {
    it('maps to post_action_delta when actionId is present', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ actionId: 'action-click-123' }),
      );
      expect(evidence.deltaKind).toBe('post_action_delta');
      expect(evidence.actionId).toBe('action-click-123');
    });

    it('maps to read_refresh_delta when actionId is null', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ actionId: null }),
      );
      expect(evidence.deltaKind).toBe('read_refresh_delta');
    });
  });

  describe('field pass-through and structure', () => {
    it('passes through changedRegions and snapshot IDs', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({
          targetObjectId: 'obj-target-1',
          changedRegions: ['sidebar', 'main_content'],
          beforeSnapshotId: 'snap-before-999',
          afterSnapshotId: 'snap-after-999',
          networkSignals: { requestStartedDelta: 3, failedRequestDelta: 1 },
          consoleSignals: { errorCountDelta: 2, warningCountDelta: 4 },
        }),
      );
      expect(evidence.changedRegions).toEqual(['sidebar', 'main_content']);
      expect(evidence.beforeProjectionId).toBe('snap-before-999');
      expect(evidence.afterProjectionId).toBe('snap-after-999');
      expect(evidence.watchId).toBe('watch:snap-after-999');
      expect(evidence.targetObjectId).toBe('obj-target-1');
      expect(evidence.observedChangeKind).toBe('list_refreshed');
      expect(evidence.observedSignalDeltas).toEqual({
        requestStartedDelta: 3,
        failedRequestDelta: 1,
        errorCountDelta: 2,
        warningCountDelta: 4,
      });
    });

    it('uses conservative navigationDelta and focusDelta', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(makeReport());
      expect(evidence.navigationDelta.status).toBe('unknown');
      expect(evidence.navigationDelta.beforeUrl).toBeNull();
      expect(evidence.navigationDelta.afterUrl).toBeNull();
      expect(evidence.focusDelta.status).toBe('unknown');
    });

    it('maps read-page URL signals into observed navigationDelta', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({
          deltaKind: 'url_changed',
          navigationSignals: {
            beforeUrl: 'https://example.test/search?q=old',
            afterUrl: 'https://example.test/search?q=new',
          },
        }),
      );

      expect(evidence.navigationDelta).toEqual({
        status: 'observed',
        beforeUrl: 'https://example.test/search?q=old',
        afterUrl: 'https://example.test/search?q=new',
      });
    });

    it('maps unchanged read-page URL signals into not_observed navigationDelta', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({
          deltaKind: 'no_useful_change',
          navigationSignals: {
            beforeUrl: 'https://example.test/search?q=same',
            afterUrl: 'https://example.test/search?q=same',
          },
        }),
      );

      expect(evidence.navigationDelta).toEqual({
        status: 'not_observed',
        beforeUrl: 'https://example.test/search?q=same',
        afterUrl: 'https://example.test/search?q=same',
      });
    });

    it('passes through target state changes into objectDelta', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({
          deltaKind: 'target_state_changed',
          changedObjects: ['obj-card-1'],
          targetStateSignals: {
            changedTargetIds: ['target-open-card'],
            changes: [
              {
                targetId: 'target-open-card',
                objectId: 'obj-card-1',
                changeKind: 'visibility',
                beforeVisibility: {
                  domVisible: true,
                  inViewport: false,
                  centerHitTarget: null,
                  occluded: null,
                },
                afterVisibility: {
                  domVisible: true,
                  inViewport: true,
                  centerHitTarget: true,
                  occluded: false,
                },
              },
            ],
          },
        }),
      );

      expect(evidence.objectDelta).toMatchObject({
        status: 'observed',
        changedObjectIds: ['obj-card-1'],
        targetStateChanges: [
          {
            targetId: 'target-open-card',
            objectId: 'obj-card-1',
            changeKind: 'visibility',
          },
        ],
      });
    });

    it('sets evidenceBoundary to source level (not real_browser)', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(makeReport());
      expect(evidence.evidenceBoundary).toEqual({
        evidenceLevel: 'source',
        realBrowserClaim: false,
      });
    });

    it('wraps claimBoundary string into array', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ claimBoundary: 'Custom boundary text.' }),
      );
      expect(evidence.claimBoundary).toEqual(['Custom boundary text.']);
    });

    it('passes through options.tabId', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(makeReport(), { tabId: 42 });
      expect(evidence.tabId).toBe(42);
      expect(evidence.focusDelta.afterTabId).toBe(42);
    });

    it('leaves invalidatedRefs and refreshedRefs empty', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(makeReport());
      expect(evidence.invalidatedRefs).toEqual([]);
      expect(evidence.refreshedRefs).toEqual([]);
    });

    it('uses afterObservedAt as producedAt', () => {
      const evidence = derivePostActionDeltaEvidenceFromReadPageDelta(
        makeReport({ afterObservedAt: '2026-06-16T12:30:00.000Z' }),
      );
      expect(evidence.producedAt).toBe('2026-06-16T12:30:00.000Z');
    });
  });
});
