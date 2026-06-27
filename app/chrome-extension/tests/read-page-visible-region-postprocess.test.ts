import { describe, expect, it } from 'vitest';
import type { ReadPageVisibleRegionRejectionReason } from '@tabrix/shared';
import {
  completeVisibleRegionRows,
  reconcilePageUnderstandingWithVisibleRows,
  suppressVisibleRowsForContentDetail,
} from '../entrypoints/background/tools/browser/read-page-visible-region-postprocess';
import type { VisibleRegionRowsResult } from '../entrypoints/background/tools/browser/visible-region-rows';

function rejectionDistribution(
  overrides: Partial<Record<ReadPageVisibleRegionRejectionReason, number>> = {},
): Record<ReadPageVisibleRegionRejectionReason, number> {
  return {
    low_value_region: 0,
    footer_like_region: 0,
    navigation_like_region: 0,
    target_ref_coverage_insufficient: 0,
    single_isolated_text: 0,
    empty_shell: 0,
    broad_page_shell: 0,
    dom_region_rows_unavailable: 0,
    ...overrides,
  };
}

function makeRows(overrides: Partial<VisibleRegionRowsResult> = {}): VisibleRegionRowsResult {
  return {
    sourceDataSource: 'dom_region_rows',
    rows: [
      {
        rowId: 'row_1',
        title: 'Result title',
        primaryText: 'Primary',
        secondaryText: null,
        summary: null,
        metaText: null,
        interactionText: null,
        visibleTextFields: ['Result title', 'Primary'],
        targetRef: 'tgt_abc123',
        targetRefCoverageRate: 1,
        boundingBox: { x: 1, y: 2, width: 100, height: 50 },
        regionId: 'region_1',
        sourceRegion: 'login_required',
        confidence: 0.8,
        qualityReasons: ['has_target'],
      },
    ],
    rowCount: 1,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion: 'login_required',
    rowExtractionConfidence: 0.8,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.7,
    cardRowsCount: 1,
    rowOrder: 'visual_order',
    targetRefCoverageRate: 1,
    regionQualityScore: 0.8,
    visibleDomRowsCandidateCount: 1,
    visibleDomRowsSelectedCount: 1,
    lowValueRegionRejectedCount: 0,
    footerLikeRejectedCount: 0,
    navigationLikeRejectedCount: 0,
    targetRefCoverageRejectedCount: 0,
    rejectedRegionReasonDistribution: rejectionDistribution(),
    pageInfo: {
      url: 'https://neutral.example.test/search',
      title: 'Neutral Search',
      viewport: { width: 1280, height: 720, dpr: 1 },
      scrollY: 0,
      pixelsAbove: 0,
      pixelsBelow: 500,
      visibleRegionCount: 1,
      candidateRegionCount: 1,
    },
    ...overrides,
  };
}

describe('read-page visible region postprocess', () => {
  it('reclassifies login-required pages when visible result rows are usable', () => {
    const payload: Record<string, any> = {
      pageRole: 'login_required',
      primaryRegion: 'auth',
      primaryRegionConfidence: 'high',
      footerOnly: true,
      visibleRegionRows: makeRows(),
    };

    reconcilePageUnderstandingWithVisibleRows(payload);

    expect(payload).toMatchObject({
      pageRole: 'unknown',
      primaryRegion: 'visible_results',
      primaryRegionConfidence: 'medium',
      footerOnly: false,
    });
    expect(payload.visibleRegionRows.sourceRegion).toBe('visible_results');
    expect(payload.visibleRegionRows.rows[0].sourceRegion).toBe('visible_results');
  });

  it('keeps completed visible rows instead of re-extracting them', () => {
    const rows = makeRows();

    expect(
      completeVisibleRegionRows({
        rows,
        pageContent: 'ignored',
        visibleTextContent: null,
        primaryRegion: null,
        interactiveElements: [],
        currentUrl: 'https://neutral.example.test',
        currentTitle: 'Neutral',
        viewport: { width: null, height: null, dpr: null },
      }),
    ).toBe(rows);
  });

  it('suppresses broad visible rows on content detail pages', () => {
    const rows = makeRows({ lowValueRegionRejectedCount: 2 });

    const suppressed = suppressVisibleRowsForContentDetail(rows, 'content_detail');

    expect(suppressed.visibleRegionRowsUsed).toBe(false);
    expect(suppressed.visibleRegionRowsRejectedReason).toBe('broad_page_shell');
    expect(suppressed.sourceRegion).toBe('content_detail');
    expect(suppressed.rows).toEqual([]);
    expect(suppressed.lowValueRegionRejectedCount).toBe(3);
    expect(suppressed.rejectedRegionReasonDistribution.broad_page_shell).toBe(1);
  });
});
