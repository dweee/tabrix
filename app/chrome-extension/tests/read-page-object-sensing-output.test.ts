import { beforeEach, describe, expect, it } from 'vitest';
import type { ReadPageCompactSnapshot, ReadPageLoadReadiness } from '@tabrix/shared';

import { buildAndRememberReadPageObjectSensingOutput } from '../entrypoints/background/tools/browser/read-page-object-sensing-output';
import {
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
});
