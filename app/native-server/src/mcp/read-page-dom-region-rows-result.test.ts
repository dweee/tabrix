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
  options: {
    includeTargetRefs?: boolean;
    includeText?: boolean;
    includeSupportingText?: boolean;
    includeMetaText?: boolean;
  } = {},
): TaskVisibleRegionRowsData {
  const includeTargetRefs = options.includeTargetRefs ?? true;
  const includeText = options.includeText ?? true;
  const includeSupportingText = options.includeSupportingText ?? includeText;
  const includeMetaText = options.includeMetaText ?? false;
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const rowNumber = index + 1;
    return {
      rowId: `row_${rowNumber}`,
      title: includeText
        ? `${rowNumber === 1 ? 'First' : rowNumber === 2 ? 'Second' : `Result ${rowNumber}`} result`
        : '',
      primaryText: includeSupportingText ? `Result ${rowNumber} summary` : null,
      secondaryText: null,
      summary: null,
      metaText: includeMetaText ? `Result ${rowNumber} metadata` : null,
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
      summarizableRowCount: 2,
      titleRowCount: 2,
      supportingTextRowCount: 2,
      metadataRowCount: 0,
      canSatisfyDefaultTopN: false,
      canSupportDefaultTopNSummary: false,
      canSupportDefaultTopNFieldSummary: false,
      missingRowCountForDefaultTopN: 8,
      missingSummarizableRowCountForDefaultTopN: 8,
      missingTitleRowCountForDefaultTopN: 8,
      fieldCoverageStatus: 'insufficient_title_fields',
      nextRequiredCheck: 'scroll_or_request_more_rows_before_claiming_top_n_complete',
      summaryNextRequiredCheck: 'more_rows_or_text_fields_required_before_top_n_summary',
      summaryQualityNextRequiredCheck: 'collect_more_titled_rows_before_top_n_summary',
    });
    expect(payload.topNReadbackEvidence.claimBoundary).toContain(
      'not full result-set completeness',
    );
    expect(operationLog.metadata).toMatchObject({
      topNReadbackStatus: 'partial_rows_only',
      topNDefaultN: '10',
      topNAvailableReliableRowCount: '2',
      topNTargetRefRowCount: '2',
      topNSummarizableRowCount: '2',
      topNTitleRowCount: '2',
      topNSupportingTextRowCount: '2',
      topNCanSatisfyDefault: 'false',
      topNSummaryReady: 'false',
      topNFieldCoverageStatus: 'insufficient_title_fields',
      topNFieldSummaryReady: 'false',
      topNMissingSummarizableRowsForDefault: '8',
      topNMissingTitleRowsForDefault: '8',
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
      summarizableRowCount: 10,
      titleRowCount: 10,
      supportingTextRowCount: 10,
      metadataRowCount: 0,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: true,
      canSupportDefaultTopNFieldSummary: true,
      missingRowCountForDefaultTopN: 0,
      missingSummarizableRowCountForDefaultTopN: 0,
      missingTitleRowCountForDefaultTopN: 0,
      fieldCoverageStatus: 'structured_summary_fields_ready',
      nextRequiredCheck: 'rows_ready_for_top_n_summary',
      summaryNextRequiredCheck: 'top_n_summary_ready',
      summaryQualityNextRequiredCheck: 'structured_top_n_summary_ready',
    });
    expect(operationLog.metadata).toMatchObject({
      topNReadbackStatus: 'ready_for_default_top_n',
      topNCanSatisfyDefault: 'true',
      topNSummaryReady: 'true',
      topNFieldCoverageStatus: 'structured_summary_fields_ready',
      topNFieldSummaryReady: 'true',
    });
  });

  it('marks title-only top-N rows as not enough for structured field summary', () => {
    const { result, operationLog } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 10, { includeSupportingText: false }),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNReadbackEvidence).toMatchObject({
      status: 'ready_for_default_top_n',
      targetRefRowCount: 10,
      summarizableRowCount: 10,
      titleRowCount: 10,
      supportingTextRowCount: 0,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: true,
      canSupportDefaultTopNFieldSummary: false,
      missingTitleRowCountForDefaultTopN: 0,
      fieldCoverageStatus: 'title_only_fields',
      summaryQualityNextRequiredCheck: 'collect_supporting_text_or_detail_before_rich_summary',
    });
    expect(operationLog.metadata).toMatchObject({
      topNFieldCoverageStatus: 'title_only_fields',
      topNFieldSummaryReady: 'false',
      topNMissingTitleRowsForDefault: '0',
      topNSummaryQualityNextRequiredCheck: 'collect_supporting_text_or_detail_before_rich_summary',
    });
  });

  it('does not mark default top-N summary ready when rows have refs but no readable fields', () => {
    const { result, operationLog } = buildDomRegionRowsSuccessResult({
      requestedLayer: 'L0+L1',
      routerDecision: makeRouterDecision(),
      layerContract: mapDataSourceToLayerContract({
        dataSource: 'dom_region_rows',
        requestedLayer: 'L0+L1',
        fallbackEntryLayer: 'L0+L1',
      }),
      visibleRows: makeVisibleRows('viewport', 10, { includeText: false }),
      ownerType: 'run_owned',
      apiRowsUnavailableReason: 'api_rows_unavailable',
      readCount: 1,
    });

    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.topNReadbackEvidence).toMatchObject({
      status: 'ready_for_default_top_n',
      availableReliableRowCount: 10,
      targetRefRowCount: 10,
      summarizableRowCount: 0,
      titleRowCount: 0,
      supportingTextRowCount: 0,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: false,
      canSupportDefaultTopNFieldSummary: false,
      missingRowCountForDefaultTopN: 0,
      missingSummarizableRowCountForDefaultTopN: 10,
      missingTitleRowCountForDefaultTopN: 10,
      fieldCoverageStatus: 'insufficient_title_fields',
      summaryNextRequiredCheck: 'more_rows_or_text_fields_required_before_top_n_summary',
      summaryQualityNextRequiredCheck: 'collect_more_titled_rows_before_top_n_summary',
    });
    expect(operationLog.metadata).toMatchObject({
      topNCanSatisfyDefault: 'true',
      topNSummaryReady: 'false',
      topNFieldCoverageStatus: 'insufficient_title_fields',
      topNFieldSummaryReady: 'false',
      topNMissingSummarizableRowsForDefault: '10',
      topNMissingTitleRowsForDefault: '10',
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
      summarizableRowCount: 0,
      titleRowCount: 10,
      supportingTextRowCount: 10,
      canSatisfyDefaultTopN: false,
      canSupportDefaultTopNSummary: false,
      canSupportDefaultTopNFieldSummary: true,
      missingRowCountForDefaultTopN: 10,
      missingSummarizableRowCountForDefaultTopN: 10,
      missingTitleRowCountForDefaultTopN: 0,
      fieldCoverageStatus: 'structured_summary_fields_ready',
      nextRequiredCheck: 'scroll_or_request_more_rows_before_claiming_top_n_complete',
      summaryNextRequiredCheck: 'more_rows_or_text_fields_required_before_top_n_summary',
      summaryQualityNextRequiredCheck: 'structured_top_n_summary_ready',
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
        currentReadSummarizableRowCount: 6,
        currentReadTitleRowCount: 6,
        currentReadSupportingTextRowCount: 6,
        currentReadMetadataRowCount: 0,
        currentReadNewUniqueRowCount: 4,
        duplicateReliableRowCount: 2,
        uniqueReliableRowCount: 10,
        uniqueTargetableRowCount: 10,
        uniqueSummarizableRowCount: 10,
        uniqueTitleRowCount: 10,
        uniqueSupportingTextRowCount: 10,
        uniqueMetadataRowCount: 0,
        uniqueTargetRefCount: 10,
        rowOrder: 'visual_order',
        canSatisfyDefaultTopN: true,
        missingRowCountForDefaultTopN: 0,
        canSupportDefaultTopNSummary: true,
        missingSummarizableRowCountForDefaultTopN: 0,
        fieldCoverageStatus: 'structured_summary_fields_ready',
        canSupportDefaultTopNFieldSummary: true,
        missingTitleRowCountForDefaultTopN: 0,
        nextRequiredCheck: 'accumulated_rows_ready_for_top_n_summary',
        summaryNextRequiredCheck: 'top_n_summary_ready',
        summaryQualityNextRequiredCheck: 'structured_top_n_summary_ready',
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
      uniqueSummarizableRowCount: 10,
      uniqueTitleRowCount: 10,
      uniqueSupportingTextRowCount: 10,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: true,
      canSupportDefaultTopNFieldSummary: true,
    });
    expect(operationLog.metadata).toMatchObject({
      topNAccumulationStatus: 'ready_for_default_top_n',
      topNAccumulatedUniqueTargetableRowCount: '10',
      topNAccumulatedUniqueSummarizableRowCount: '10',
      topNAccumulatedObservedReadCount: '2',
      topNAccumulationCanSatisfyDefault: 'true',
      topNAccumulationSummaryReady: 'true',
      topNAccumulationFieldCoverageStatus: 'structured_summary_fields_ready',
      topNAccumulationFieldSummaryReady: 'true',
    });
  });
});
