import { beforeEach, describe, expect, it } from 'vitest';
import type { ReadPageCompactSnapshot, ReadPageLoadReadiness } from '@tabrix/shared';

import {
  bindSearchResultDeltaToPostActionEvidence,
  buildAndRememberReadPageObjectSensingOutput,
} from '../entrypoints/background/tools/browser/read-page-object-sensing-output';
import {
  peekPendingActionBinding,
  recordPendingActionBinding,
  resetObjectLifecycleCacheForTests,
} from '../entrypoints/background/tools/browser/read-page-object-delta';
import type { CandidateActionSeed } from '../entrypoints/background/tools/browser/read-page-candidate-actions';

const ready: ReadPageLoadReadiness = {
  status: 'ready',
  confidence: 0.9,
  reason: 'test fixture',
  canUseSnapshotForBusinessAction: true,
};

function region(
  objects: ReadPageCompactSnapshot['pageRegions'][number]['objects'] = [],
): ReadPageCompactSnapshot['pageRegions'][number] {
  return {
    regionId: 'results',
    regionType: 'result_list',
    label: 'Results',
    confidence: 0.9,
    objects,
    claimBoundary: 'test fixture',
  };
}

function action(overrides: Partial<CandidateActionSeed> = {}): CandidateActionSeed {
  return {
    id: 'ca_open_result',
    actionType: 'click',
    label: 'Open result',
    targetRef: 'ref_result_1',
    confidence: 0.88,
    matchReason: 'test fixture',
    locatorChain: [{ type: 'ref', value: 'ref_result_1' }],
    ...overrides,
  };
}

function buildInput(
  overrides: Partial<Parameters<typeof buildAndRememberReadPageObjectSensingOutput>[0]> = {},
): Parameters<typeof buildAndRememberReadPageObjectSensingOutput>[0] {
  return {
    tabId: 44,
    currentUrl: 'https://example.test/search',
    currentTitle: 'Search',
    pageRegions: [
      region([
        {
          objectId: 'card_1',
          objectType: 'result_card',
          label: 'Result card',
          parentObjectId: 'results',
          sourceProvenance: ['dom'],
          targetRef: 'ref_result_1',
          actionTypes: ['click'],
          freshness: 'fresh',
        },
      ]),
    ],
    candidateActions: [action()],
    pageType: 'web_page',
    pageRole: 'search_results',
    pageStability: 'stable',
    loadReadiness: ready,
    visibleTextContent: 'Result card',
    ...overrides,
  };
}

describe('read_page object sensing output', () => {
  beforeEach(() => {
    resetObjectLifecycleCacheForTests();
  });

  it('creates and remembers the first object snapshot without inventing post-action evidence', () => {
    const output = buildAndRememberReadPageObjectSensingOutput(buildInput());

    expect(output.pageObjectSnapshot.source).toBe('read_page_object_snapshot');
    expect(output.pageObjectSnapshot.objectCount).toBeGreaterThan(0);
    expect(output.pageObjectSnapshot.actionableObjectCount).toBe(1);
    expect(output.pageDeltaReport).toBeUndefined();
    expect(output.postActionDeltaEvidence).toBeUndefined();
  });

  it('binds pending action context when the next snapshot produces a page delta', () => {
    buildAndRememberReadPageObjectSensingOutput(buildInput());
    recordPendingActionBinding(44, {
      actionId: 'act_open_result',
      targetRef: 'ref_result_1',
    });

    const output = buildAndRememberReadPageObjectSensingOutput(
      buildInput({
        currentTitle: 'Search Updated',
        pageRegions: [
          region([
            {
              objectId: 'card_1',
              objectType: 'result_card',
              label: 'Result card',
              parentObjectId: 'results',
              sourceProvenance: ['dom'],
              targetRef: 'ref_result_1',
              actionTypes: ['click'],
              freshness: 'fresh',
            },
            {
              objectId: 'card_2',
              objectType: 'result_card',
              label: 'Second result card',
              parentObjectId: 'results',
              sourceProvenance: ['dom'],
              targetRef: 'ref_result_2',
              actionTypes: ['click'],
              freshness: 'fresh',
            },
          ]),
        ],
        candidateActions: [
          action(),
          action({
            id: 'ca_open_second_result',
            label: 'Open second result',
            targetRef: 'ref_result_2',
            locatorChain: [{ type: 'ref', value: 'ref_result_2' }],
          }),
        ],
      }),
    );

    expect(output.pageDeltaReport).toMatchObject({
      actionId: 'act_open_result',
      targetObjectId: 'card_1',
      deltaKind: 'list_refreshed',
    });
    expect(output.postActionDeltaEvidence).toMatchObject({
      actionId: 'act_open_result',
      tabId: 44,
      targetObjectId: 'card_1',
      observedChangeKind: 'list_refreshed',
    });
  });

  it('binds a changed result set to a scoped floating filter action', () => {
    const resultDelta = {
      status: 'changed',
      attribution: 'observation_only',
      actionId: null,
      beforeResultCount: 3,
      afterResultCount: 4,
      retainedCount: 2,
      addedCount: 2,
      removedCount: 1,
      reorderedCount: 1,
      overlapRate: 0.5,
      changedEnough: true,
      sampleAddedResultKeys: ['added-1'],
      sampleRemovedResultKeys: ['removed-1'],
      observation: {
        documentEpoch: 'epoch:1',
        sequence: 2,
        previousSequence: 1,
        observedAt: '2026-07-26T00:00:02.000Z',
        previousObservedAt: '2026-07-26T00:00:00.000Z',
        snapshotTtlMs: 30_000,
      },
      reason: 'result list changed',
      claimBoundary: 'observation only',
    } as any;

    expect(
      bindSearchResultDeltaToPostActionEvidence(
        resultDelta,
        { actionId: 'filter-action', watchId: 'watch:filter-action' } as any,
        {
          actionId: 'filter-action',
          targetObjectId: 'filter-option',
          targetRef: 'ref_floating_option_sort',
          actionIntent: 'search.apply_filter.sort',
          recordedAtMs: Date.parse('2026-07-26T00:00:01.000Z'),
        },
      ),
    ).toMatchObject({
      attribution: 'action_bound',
      actionId: 'filter-action',
      postActionWatchId: 'watch:filter-action',
    });
  });

  it('retains a filter action across an obscured read and hover recovery', () => {
    const previousObservedAtMs = Date.now() - 1_000;
    buildAndRememberReadPageObjectSensingOutput(
      buildInput({
        searchResultDelta: {
          status: 'baseline',
          attribution: 'observation_only',
          actionId: null,
          beforeResultCount: 0,
          afterResultCount: 1,
          retainedCount: 0,
          addedCount: 1,
          removedCount: 0,
          reorderedCount: 0,
          overlapRate: null,
          changedEnough: false,
          sampleAddedResultKeys: ['card-1'],
          sampleRemovedResultKeys: [],
          observation: {
            documentEpoch: 'epoch:1',
            sequence: 1,
            previousSequence: null,
            observedAt: new Date(previousObservedAtMs).toISOString(),
            previousObservedAt: null,
            snapshotTtlMs: 30_000,
          },
          reason: 'baseline',
          claimBoundary: 'test fixture',
        } as any,
      }),
    );
    recordPendingActionBinding(44, {
      actionId: 'filter-action',
      targetRef: 'ref_floating_option_sort',
      actionIntent: 'search.apply_filter.sort',
    });

    buildAndRememberReadPageObjectSensingOutput(
      buildInput({
        searchResultDelta: {
          status: 'not_available',
          attribution: 'observation_only',
          actionId: null,
          beforeResultCount: 1,
          afterResultCount: 0,
          retainedCount: 0,
          addedCount: 0,
          removedCount: 1,
          reorderedCount: 0,
          overlapRate: null,
          changedEnough: false,
          sampleAddedResultKeys: [],
          sampleRemovedResultKeys: ['card-1'],
          reason: 'floating panel obscures result cards',
          claimBoundary: 'test fixture',
        } as any,
      }),
    );
    recordPendingActionBinding(
      44,
      {
        actionId: 'hover-action',
        targetRef: 'ref_outside_panel',
        actionIntent: 'navigation.open',
      },
      { preserveResultChangingAction: true },
    );

    expect(peekPendingActionBinding(44)?.actionId).toBe('filter-action');

    const output = buildAndRememberReadPageObjectSensingOutput(
      buildInput({
        currentTitle: 'Search Updated',
        pageRegions: [
          region([
            {
              objectId: 'card_2',
              objectType: 'result_card',
              label: 'Second result card',
              parentObjectId: 'results',
              sourceProvenance: ['dom'],
              targetRef: 'ref_result_2',
              actionTypes: ['click'],
              freshness: 'fresh',
            },
          ]),
        ],
        candidateActions: [
          action({
            id: 'ca_open_second_result',
            label: 'Open second result',
            targetRef: 'ref_result_2',
            locatorChain: [{ type: 'ref', value: 'ref_result_2' }],
          }),
        ],
        searchResultDelta: {
          status: 'changed',
          attribution: 'observation_only',
          actionId: null,
          beforeResultCount: 1,
          afterResultCount: 1,
          retainedCount: 0,
          addedCount: 1,
          removedCount: 1,
          reorderedCount: 0,
          overlapRate: 0,
          changedEnough: true,
          sampleAddedResultKeys: ['card-2'],
          sampleRemovedResultKeys: ['card-1'],
          observation: {
            documentEpoch: 'epoch:1',
            sequence: 3,
            previousSequence: 1,
            observedAt: new Date(Date.now() + 1_000).toISOString(),
            previousObservedAt: new Date(previousObservedAtMs).toISOString(),
            snapshotTtlMs: 30_000,
          },
          reason: 'result list changed',
          claimBoundary: 'test fixture',
        } as any,
      }),
    );

    expect(output.searchResultDelta).toMatchObject({
      attribution: 'action_bound',
      actionId: 'filter-action',
    });
    expect(peekPendingActionBinding(44)).toBeNull();
  });
});
