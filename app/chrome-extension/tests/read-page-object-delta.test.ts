import { describe, expect, it } from 'vitest';
import type {
  ReadPageCompactSnapshot,
  ReadPageLoadReadiness,
  ReadPageObjectSnapshot,
} from '@tabrix/shared';

import {
  buildReadPagePageDeltaReport,
  buildReadPageSnapshotSourceStats,
} from '../entrypoints/background/tools/browser/read-page-object-delta';
import type { CandidateActionSeed } from '../entrypoints/background/tools/browser/read-page-candidate-actions';

const ready: ReadPageLoadReadiness = {
  status: 'ready',
  confidence: 0.9,
  reason: 'test fixture',
  canUseSnapshotForBusinessAction: true,
};

function region(
  overrides: Partial<ReadPageCompactSnapshot['pageRegions'][number]> = {},
): ReadPageCompactSnapshot['pageRegions'][number] {
  return {
    regionId: 'results',
    regionType: 'result_list',
    label: 'Results',
    confidence: 0.9,
    objects: [],
    claimBoundary: 'test fixture',
    ...overrides,
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

function snapshot(overrides: Partial<ReadPageObjectSnapshot> = {}): ReadPageObjectSnapshot {
  return {
    source: 'read_page_object_snapshot',
    snapshotId: 'snap_before',
    observedAt: '2026-06-26T00:00:00.000Z',
    pageUrl: 'https://example.test/search',
    pageTitle: 'Search',
    pageType: 'search',
    pageRole: 'search_page',
    pageState: {
      pageStability: 'stable_or_unknown',
      readiness: 'ready',
      baseUrl: 'example.test',
      frameCount: 1,
    },
    sourceProvenance: ['dom'],
    freshness: 'fresh',
    objects: [],
    actionableTargets: [],
    objectCount: 0,
    actionableObjectCount: 0,
    claimBoundary: 'test fixture',
    ...overrides,
  };
}

describe('read_page object snapshot and delta', () => {
  it('records DOM, CDP, AX, and visible-text provenance without raw source payloads', () => {
    const result = buildReadPageSnapshotSourceStats({
      tabId: 100,
      currentUrl: 'https://example.test/search?q=private',
      currentTitle: 'Search',
      cdpSensing: {
        source: 'cdp_page_sensing',
        available: true,
        readiness: 'complete',
        likelyLoading: false,
        accessibility: {
          totalNodes: 4,
          actionableNodeCount: 1,
          actionableRoleTop: [{ role: 'button', count: 1 }],
          actionableSampleLabels: ['Open result'],
          stateSignals: {
            checkedCount: 0,
            selectedCount: 0,
            expandedCount: 0,
            disabledCount: 0,
            editableCount: 0,
          },
          locatorCoverage: {
            backendDomNodeIdCount: 1,
            explicitDomIdentifierCount: 1,
            locatorCoverageRate: 1,
          },
          objectCandidates: [],
        },
        networkActivity: {
          requestStartedCount: 2,
          inFlightCount: 0,
          failedRequestCount: 0,
        },
        console: {
          errorCount: 0,
          warningCount: 1,
        },
        claimBoundary: 'test fixture',
      },
      pageRegions: [
        region({
          objects: [
            {
              objectId: 'card_1',
              objectType: 'result_card',
              label: 'Result card',
              parentObjectId: 'results',
              sourceProvenance: ['ax'],
              targetRef: 'ref_result_1',
              actionTypes: ['click'],
              freshness: 'fresh',
            },
          ],
        }),
      ],
      candidateActions: [action()],
      pageType: 'search',
      pageRole: 'search_page',
      pageStability: 'stable',
      loadReadiness: ready,
      visibleTextContent: 'Result card',
    });

    expect(result.sourceProvenance).toEqual(
      expect.arrayContaining(['dom', 'cdp', 'ax', 'visible_text']),
    );
    expect(result.objects.map((object) => object.objectId)).toEqual(['results', 'card_1']);
    expect(result.actionableTargets).toHaveLength(1);
    expect(result.actionableTargets[0]).toMatchObject({
      targetId: 'ca_open_result',
      label: 'Open result',
      targetRef: 'ref_result_1',
      locatorChain: [{ type: 'ref', value: 'ref_result_1' }],
      matchReason: 'test fixture',
      sourceProvenanceDetail: expect.arrayContaining(['dom']),
    });
    expect(JSON.stringify(result)).not.toContain('private-token');
    expect(result.claimBoundary).toContain('object-awareness summary only');
  });

  it('preserves executable target details in the object snapshot for Object Library reuse', () => {
    const result = buildReadPageSnapshotSourceStats({
      tabId: 100,
      currentUrl: 'https://example.test/search?q=ai',
      currentTitle: 'Search',
      pageRegions: [region()],
      candidateActions: [
        action({
          actionability: 'actionable',
          actionabilityReason: 'visible input is enabled',
          intent: 'search.enter_query',
          intentBoundary: 'Search input only; submit separately.',
          nextRequiredTool: 'chrome_keyboard',
          nextRequiredSelector: 'input[aria-label="Search"]',
          nextRequiredSelectorSource: 'candidate_action_locator',
          nextRequiredCheck: 'Search query should be visible before submitting.',
          locatorChain: [
            { type: 'ref', value: 'ref_result_1' },
            { type: 'css', value: 'input[aria-label="Search"]' },
          ],
          visibility: {
            source: 'mixed',
            domVisible: true,
            inViewport: true,
            centerHitTarget: true,
            occluded: false,
            reason: 'dom_and_cdp_box_model',
          },
        }),
      ],
      pageType: 'search',
      pageRole: 'search_page',
      pageStability: 'stable',
      loadReadiness: ready,
      visibleTextContent: 'Search',
    });

    expect(result.actionableTargets[0]).toMatchObject({
      targetId: 'ca_open_result',
      label: 'Open result',
      kind: 'click',
      targetRef: 'ref_result_1',
      sourceProvenance: 'dom',
      sourceProvenanceDetail: expect.arrayContaining(['dom', 'cdp']),
      locatorChain: [
        { type: 'ref', value: 'ref_result_1' },
        { type: 'css', value: 'input[aria-label="Search"]' },
      ],
      intent: 'search.enter_query',
      intentBoundary: 'Search input only; submit separately.',
      matchReason: 'test fixture',
      actionability: 'actionable',
      actionabilityReason: 'visible input is enabled',
      visibility: {
        source: 'mixed',
        domVisible: true,
        inViewport: true,
        centerHitTarget: true,
        occluded: false,
      },
      nextRequiredTool: 'chrome_keyboard',
      nextRequiredSelector: 'input[aria-label="Search"]',
      nextRequiredSelectorSource: 'candidate_action_locator',
      nextRequiredCheck: 'Search query should be visible before submitting.',
    });
  });

  it('prioritizes route and console changes before generic object changes', () => {
    const before = snapshot({
      snapshotId: 'before',
      objects: [
        {
          objectId: 'results',
          kind: 'result_list',
          label: 'Results',
          objectType: 'container',
          sourceProvenance: ['dom'],
          freshness: 'fresh',
        },
      ],
      objectCount: 1,
    });
    const after = snapshot({
      snapshotId: 'after',
      observedAt: '2026-06-26T00:00:01.000Z',
      objects: [
        {
          objectId: 'results',
          kind: 'result_list',
          label: 'Results',
          objectType: 'container',
          sourceProvenance: ['dom'],
          freshness: 'fresh',
        },
        {
          objectId: 'card_1',
          kind: 'result_card',
          label: 'Card',
          objectType: 'result_card',
          regionType: 'result_list',
          sourceProvenance: ['dom'],
          freshness: 'fresh',
        },
      ],
      objectCount: 2,
    });

    expect(
      buildReadPagePageDeltaReport({
        tabId: 100,
        previousSnapshot: before,
        currentSnapshot: after,
        previousCdpSignals: { routeFingerprint: 'route:before', errorCount: 0 },
        cdpSignals: { routeFingerprint: 'route:after', errorCount: 2 },
      }),
    ).toMatchObject({
      deltaKind: 'spa_route_change',
      recommendation: 'proceed',
      changedObjects: ['card_1'],
    });

    expect(
      buildReadPagePageDeltaReport({
        tabId: 100,
        previousSnapshot: before,
        currentSnapshot: after,
        previousCdpSignals: { errorCount: 0 },
        cdpSignals: { errorCount: 2 },
      }),
    ).toMatchObject({
      deltaKind: 'console_error',
      recommendation: 'stop',
    });
  });

  it('returns network_completed when only CDP network completion moved', () => {
    const report = buildReadPagePageDeltaReport({
      tabId: 100,
      previousSnapshot: snapshot({ snapshotId: 'before' }),
      currentSnapshot: snapshot({ snapshotId: 'after' }),
      previousCdpSignals: { networkStartedCount: 1, networkInFlightCount: 1 },
      cdpSignals: { networkStartedCount: 3, networkInFlightCount: 0 },
    });

    expect(report).toMatchObject({
      deltaKind: 'network_completed',
      recommendation: 'proceed',
      networkSignals: {
        requestStartedDelta: 2,
      },
    });
  });
});
