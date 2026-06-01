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

function makeVisibleRows(
  sourceRegion: string,
  rowCount = 2,
  options: { includeTargetRefs?: boolean } = {},
): TaskVisibleRegionRowsData {
  const includeTargetRefs = options.includeTargetRefs ?? true;
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const rowNumber = index + 1;
    return {
      rowId: `row_${rowNumber}`,
      title: `${rowNumber === 1 ? 'First' : rowNumber === 2 ? 'Second' : `Result ${rowNumber}`} result`,
      primaryText: `Result ${rowNumber} summary`,
      secondaryText: null,
      summary: null,
      metaText: null,
      interactionText: null,
      targetRef: includeTargetRefs ? `ref_${rowNumber}` : null,
      visibleTextFields: ['title', 'primaryText'],
      targetRefCoverageRate: includeTargetRefs ? 1 : 0,
      boundingBox: null,
      regionId: 'region_1',
      sourceRegion,
      confidence: 0.91,
      qualityReasons: ['visible_result_row'],
    };
  });

  return {
    sourceDataSource: 'dom_region_rows',
    sourceTabId: 101,
    available: true,
    rowCount,
    confidence: 0.91,
    rows,
    targetRefCoverageRate: includeTargetRefs ? 1 : 0,
    regionQualityScore: 0.9,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion,
    rowExtractionConfidence: 0.91,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.88,
    cardRowsCount: rowCount,
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

  it('marks two reliable visible rows as partial top-N evidence', () => {
    const { result, operationLog } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 2),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNReadbackEvidence).toMatchObject({
      status: 'partial_rows_only',
      requestedN: null,
      defaultTopN: 10,
      availableReliableRowCount: 2,
      visibleRowCount: 2,
      targetRefRowCount: 2,
      canSatisfyDefaultTopN: false,
      missingRowCountForDefaultTopN: 8,
      nextRequiredCheck: 'scroll_or_request_more_rows_before_claiming_top_n_complete',
    });
    expect(payload.topNReadbackEvidence.claimBoundary).toContain(
      'not full result-set completeness',
    );
    expect(operationLog.metadata).toMatchObject({
      topNReadbackStatus: 'partial_rows_only',
      topNDefaultN: '10',
      topNAvailableReliableRowCount: '2',
      topNTargetRefRowCount: '2',
      topNCanSatisfyDefault: 'false',
    });
  });

  it('marks ten reliable targetable visible rows as ready for default top-N summary', () => {
    const { result, operationLog } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 10),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNReadbackEvidence).toMatchObject({
      status: 'ready_for_default_top_n',
      defaultTopN: 10,
      availableReliableRowCount: 10,
      visibleRowCount: 10,
      targetRefRowCount: 10,
      canSatisfyDefaultTopN: true,
      missingRowCountForDefaultTopN: 0,
      nextRequiredCheck: 'rows_ready_for_top_n_summary',
    });
    expect(operationLog.metadata).toMatchObject({
      topNReadbackStatus: 'ready_for_default_top_n',
      topNCanSatisfyDefault: 'true',
    });
  });

  it('does not mark top-N ready when reliable rows lack targetRefs', () => {
    const { result } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 10, { includeTargetRefs: false }),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNReadbackEvidence).toMatchObject({
      status: 'partial_rows_only',
      availableReliableRowCount: 10,
      targetRefRowCount: 0,
      canSatisfyDefaultTopN: false,
      missingRowCountForDefaultTopN: 10,
      nextRequiredCheck: 'scroll_or_request_more_rows_before_claiming_top_n_complete',
    });
  });

  it('attaches multi-read top-N accumulation evidence when provided', () => {
    const { result, operationLog } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 6),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 2,
      topNAccumulationEvidence: {
        status: 'ready_for_default_top_n',
        defaultTopN: 10,
        accumulationScope: 'task_tab_source_region',
        sourceTabId: 123,
        sourceRegion: 'result_list',
        observedReadCount: 2,
        currentReadReliableRowCount: 6,
        currentReadTargetableRowCount: 6,
        currentReadNewUniqueRowCount: 4,
        duplicateReliableRowCount: 2,
        uniqueReliableRowCount: 10,
        uniqueTargetableRowCount: 10,
        uniqueTargetRefCount: 10,
        rowOrder: 'visual_order',
        canSatisfyDefaultTopN: true,
        missingRowCountForDefaultTopN: 0,
        nextRequiredCheck: 'accumulated_rows_ready_for_top_n_summary',
        claimBoundary: 'deterministic task/session accumulation fixture only',
      },
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNAccumulationEvidence).toMatchObject({
      status: 'ready_for_default_top_n',
      observedReadCount: 2,
      currentReadNewUniqueRowCount: 4,
      duplicateReliableRowCount: 2,
      uniqueTargetableRowCount: 10,
      canSatisfyDefaultTopN: true,
    });
    expect(operationLog.metadata).toMatchObject({
      topNAccumulationStatus: 'ready_for_default_top_n',
      topNAccumulatedUniqueTargetableRowCount: '10',
      topNAccumulatedObservedReadCount: '2',
      topNAccumulationCanSatisfyDefault: 'true',
    });
  });
});
