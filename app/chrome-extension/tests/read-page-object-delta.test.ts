import { describe, expect, it } from 'vitest';
import type {
  ReadPageCompactSnapshot,
  ReadPageActionableTargetSummary,
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

function actionableTarget(
  overrides: Partial<ReadPageActionableTargetSummary> = {},
): ReadPageActionableTargetSummary {
  return {
    targetId: 'target_open_result',
    objectId: 'card_1',
    kind: 'button',
    label: 'Open result',
    targetRef: 'ref_result_1',
    ref: 'ref_result_1',
    sourceProvenance: 'dom',
    locatorChain: [{ type: 'ref', value: 'ref_result_1' }],
    actionability: 'actionable',
    actionabilityReason: 'target is visible and enabled',
    visibility: {
      source: 'mixed',
      domVisible: true,
      inViewport: true,
      centerHitTarget: true,
      occluded: false,
    },
    freshness: 'fresh',
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

  it('does not mark object provenance as CDP when only runtime network or console signals exist', () => {
    const result = buildReadPageSnapshotSourceStats({
      tabId: 100,
      currentUrl: 'https://example.test/search?q=ai',
      currentTitle: 'Search',
      cdpSensing: {
        source: 'cdp_page_sensing',
        available: true,
        readiness: 'complete',
        likelyLoading: false,
        networkActivity: {
          requestStartedCount: 3,
          inFlightCount: 0,
          failedRequestCount: 0,
        },
        console: {
          errorCount: 0,
          warningCount: 1,
        },
        claimBoundary: 'test fixture',
      },
      pageRegions: [region()],
      candidateActions: [],
      pageType: 'search',
      pageRole: 'search_page',
      pageStability: 'stable',
      loadReadiness: ready,
    });

    expect(result.sourceProvenance).toEqual(['dom']);
    expect(result.objects[0].sourceProvenance).toEqual(['dom', 'visible_text']);
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

  it('carries before and after URL signals when the page URL changes', () => {
    const report = buildReadPagePageDeltaReport({
      tabId: 100,
      previousSnapshot: snapshot({
        snapshotId: 'before',
        pageUrl: 'https://example.test/search?q=old',
      }),
      currentSnapshot: snapshot({
        snapshotId: 'after',
        pageUrl: 'https://example.test/search?q=new',
      }),
    });

    expect(report).toMatchObject({
      deltaKind: 'url_changed',
      recommendation: 'proceed',
      navigationSignals: {
        beforeUrl: 'https://example.test/search?q=old',
        afterUrl: 'https://example.test/search?q=new',
      },
    });
  });

  it('reports actionable target state changes after a fresh read', () => {
    const before = snapshot({
      snapshotId: 'before',
      objects: [
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
      actionableTargets: [
        actionableTarget({
          actionability: 'blocked',
          actionabilityReason: 'target is disabled while loading',
          visibility: {
            source: 'mixed',
            domVisible: true,
            inViewport: false,
            centerHitTarget: null,
            occluded: null,
          },
        }),
      ],
      objectCount: 1,
      actionableObjectCount: 1,
    });
    const after = snapshot({
      snapshotId: 'after',
      observedAt: '2026-06-26T00:00:01.000Z',
      objects: before.objects,
      actionableTargets: [actionableTarget()],
      objectCount: 1,
      actionableObjectCount: 1,
    });

    expect(
      buildReadPagePageDeltaReport({
        tabId: 100,
        previousSnapshot: before,
        currentSnapshot: after,
      }),
    ).toMatchObject({
      deltaKind: 'target_state_changed',
      recommendation: 'proceed',
      changedObjects: ['card_1'],
      targetStateSignals: {
        changedTargetIds: ['target_open_result'],
        changes: [
          {
            targetId: 'target_open_result',
            objectId: 'card_1',
            changeKind: 'actionability_and_visibility',
            beforeActionability: 'blocked',
            afterActionability: 'actionable',
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
    });
  });

  it('matches target state changes by stable target ref before object id', () => {
    const before = snapshot({
      snapshotId: 'before',
      objects: [
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
      actionableTargets: [
        actionableTarget({
          targetId: 'target_open_card',
          targetRef: 'ref_open_card',
          ref: 'ref_open_card',
          actionability: 'actionable',
        }),
        actionableTarget({
          targetId: 'target_like_card',
          targetRef: 'ref_like_card',
          ref: 'ref_like_card',
          actionability: 'actionable',
        }),
      ],
      objectCount: 1,
      actionableObjectCount: 2,
    });
    const after = snapshot({
      snapshotId: 'after',
      observedAt: '2026-06-26T00:00:01.000Z',
      objects: before.objects,
      actionableTargets: [
        actionableTarget({
          targetId: 'target_open_card',
          targetRef: 'ref_open_card',
          ref: 'ref_open_card',
          actionability: 'actionable',
        }),
        actionableTarget({
          targetId: 'target_like_card',
          targetRef: 'ref_like_card',
          ref: 'ref_like_card',
          actionability: 'blocked',
          actionabilityReason: 'like action is disabled after click',
        }),
      ],
      objectCount: 1,
      actionableObjectCount: 2,
    });

    expect(
      buildReadPagePageDeltaReport({
        tabId: 100,
        previousSnapshot: before,
        currentSnapshot: after,
      })?.targetStateSignals?.changedTargetIds,
    ).toEqual(['target_like_card']);
  });

  it('returns restricted when the current snapshot is an unsupported browser surface', () => {
    const report = buildReadPagePageDeltaReport({
      tabId: 100,
      previousSnapshot: snapshot({ snapshotId: 'before' }),
      currentSnapshot: snapshot({
        snapshotId: 'after',
        pageType: 'unsupported_page',
        pageState: {
          pageStability: 'changed_without_target_transition',
          readiness: 'blocked',
          baseUrl: 'chrome://settings',
          frameCount: 1,
        },
      }),
    });

    expect(report).toMatchObject({
      deltaKind: 'restricted',
      recommendation: 'stop',
      changedRegions: ['access_state'],
    });
  });

  it('returns blocked when the current snapshot readiness says the page cannot be used', () => {
    const report = buildReadPagePageDeltaReport({
      tabId: 100,
      previousSnapshot: snapshot({ snapshotId: 'before' }),
      currentSnapshot: snapshot({
        snapshotId: 'after',
        pageState: {
          pageStability: 'runtime_degraded',
          readiness: 'blocked',
          baseUrl: 'example.test',
          frameCount: 1,
        },
      }),
    });

    expect(report).toMatchObject({
      deltaKind: 'blocked',
      recommendation: 'refresh',
      changedRegions: ['access_state'],
    });
  });
});
