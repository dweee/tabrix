import { describe, expect, it } from '@jest/globals';
import type { ReadPageRequestedLayer } from '@tabrix/shared';
import type { DataSourceDecision } from '../execution/data-source-router';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import type { TaskVisibleRegionRowsData } from '../execution/task-session-context';
import { buildDomRegionRowsSuccessResult } from './read-page-dom-region-rows-result';

function makeRouterDecision(): DataSourceDecision {
  return {
    sourceRoute: 'read_page_required',
    dataSource: 'dom_region_rows',
    chosenSource: 'dom_region_rows',
    confidence: 0.9,
    costEstimate: {
      chosenTokens: 200,
      fullReadTokens: 2000,
      savedTokensEstimate: 1800,
    },
    riskTier: 'low',
    fallbackPlan: {
      dataSource: 'dom_json',
      entryLayer: 'L0+L1',
      reason: 'api_rows_unavailable',
    },
    decisionReason: 'visible_dom_rows_selected',
    dispatcherInputSource: 'read_page_required',
    layerContract: mapDataSourceToLayerContract({
      dataSource: 'dom_region_rows',
      requestedLayer: 'L0+L1',
      fallbackEntryLayer: 'L0+L1',
    }),
    selectedDataSource: 'dom_region_rows',
    selectedLayer: 'L0+L1',
    requestedLayer: 'L0+L1',
    contextVersion: null,
    factSnapshotVerdict: 'unknown',
    decisionRuleId: 'R_DOM_REGION_ROWS_READY',
    publicSurfaceDelta: 'none',
  };
}

function makeVisibleRows(sourceRegion: string): TaskVisibleRegionRowsData {
  return {
    sourceDataSource: 'dom_region_rows',
    sourceTabId: 101,
    available: true,
    rowCount: 2,
    confidence: 0.91,
    rows: [
      {
        rowId: 'row_1',
        title: 'First result',
        primaryText: 'First result summary',
        secondaryText: null,
        summary: null,
        metaText: null,
        interactionText: null,
        targetRef: 'ref_1',
        visibleTextFields: ['title', 'primaryText'],
        targetRefCoverageRate: 1,
        boundingBox: null,
        regionId: 'region_1',
        sourceRegion,
        confidence: 0.91,
        qualityReasons: ['visible_result_row'],
      },
      {
        rowId: 'row_2',
        title: 'Second result',
        primaryText: 'Second result summary',
        secondaryText: null,
        summary: null,
        metaText: null,
        interactionText: null,
        targetRef: 'ref_2',
        visibleTextFields: ['title', 'primaryText'],
        targetRefCoverageRate: 1,
        boundingBox: null,
        regionId: 'region_1',
        sourceRegion,
        confidence: 0.91,
        qualityReasons: ['visible_result_row'],
      },
    ],
    targetRefCoverageRate: 1,
    regionQualityScore: 0.9,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion,
    rowExtractionConfidence: 0.91,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.88,
    cardRowsCount: 2,
    rowOrder: 'visual_order',
  };
}

describe('buildDomRegionRowsSuccessResult', () => {
  it('projects viewport-backed search rows as result_list for AI-facing delta', () => {
    const requestedLayer: ReadPageRequestedLayer = 'L0+L1';
    const { result } = buildDomRegionRowsSuccessResult({
      requestedLayer,
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer,
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport'),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.sourceRegion).toBe('viewport');
    expect(payload.pageProjection).toMatchObject({
      activeRegion: 'result_list',
      changedRegions: ['result_list'],
      chosenDataSource: 'dom_region_rows',
      ownerType: 'run_owned',
      regionEvidenceRefs: ['region:result_list', 'row:row_1', 'row:row_2'],
      refreshedRefs: ['ref_1', 'ref_2'],
    });
  });

  it('preserves explicit non-viewport source regions', () => {
    const { result } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('article_body'),
      ownerType: 'user_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.sourceRegion).toBe('article_body');
    expect(payload.pageProjection).toMatchObject({
      activeRegion: 'article_body',
      changedRegions: ['article_body'],
      ownerType: 'user_owned',
    });
  });

  it('keeps unknown ownership when no source tab is available', () => {
    const { result } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: { ...makeVisibleRows('viewport'), sourceTabId: 0 },
      ownerType: 'unknown',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.pageProjection).toMatchObject({
      ownerType: 'unknown',
    });
  });
});
