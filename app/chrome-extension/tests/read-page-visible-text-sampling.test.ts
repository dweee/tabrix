import { describe, expect, it } from 'vitest';
import type { ReadPageVisibleRegionRejectionReason } from '@tabrix/shared';
import { shouldSampleVisibleText } from '../entrypoints/background/tools/browser/read-page-visible-text-sampling';
import type { VisibleRegionRowsResult } from '../entrypoints/background/tools/browser/visible-region-rows';

function rejectionDistribution(): Record<ReadPageVisibleRegionRejectionReason, number> {
  return {
    low_value_region: 0,
    footer_like_region: 0,
    navigation_like_region: 0,
    target_ref_coverage_insufficient: 0,
    single_isolated_text: 0,
    empty_shell: 0,
    broad_page_shell: 0,
    dom_region_rows_unavailable: 0,
  };
}

function rows(visibleRegionRowsUsed: boolean): VisibleRegionRowsResult {
  return {
    sourceDataSource: 'dom_region_rows',
    rows: [],
    rowCount: 0,
    visibleRegionRowsUsed,
    visibleRegionRowsRejectedReason: visibleRegionRowsUsed ? null : 'dom_region_rows_unavailable',
    sourceRegion: 'unknown',
    rowExtractionConfidence: visibleRegionRowsUsed ? 0.8 : 0,
    cardExtractorUsed: false,
    cardPatternConfidence: 0,
    cardRowsCount: 0,
    rowOrder: 'visual_order',
    targetRefCoverageRate: 0,
    regionQualityScore: 0,
    visibleDomRowsCandidateCount: 0,
    visibleDomRowsSelectedCount: 0,
    lowValueRegionRejectedCount: 0,
    footerLikeRejectedCount: 0,
    navigationLikeRejectedCount: 0,
    targetRefCoverageRejectedCount: 0,
    rejectedRegionReasonDistribution: rejectionDistribution(),
    pageInfo: {
      url: null,
      title: null,
      viewport: { width: null, height: null, dpr: null },
      scrollY: null,
      pixelsAbove: null,
      pixelsBelow: null,
      visibleRegionCount: 0,
      candidateRegionCount: 0,
    },
  };
}

describe('read-page visible text sampling decision', () => {
  it('does not sample when the accessibility tree failed or a focused ref read is requested', () => {
    expect(
      shouldSampleVisibleText({
        treeOk: false,
        userControlled: true,
        mode: 'compact',
        requestedDepth: 2,
        focusRefId: undefined,
        rows: rows(false),
      }),
    ).toBe(false);
    expect(
      shouldSampleVisibleText({
        treeOk: true,
        userControlled: true,
        mode: 'compact',
        requestedDepth: 2,
        focusRefId: 'ref_1',
        rows: rows(false),
      }),
    ).toBe(false);
  });

  it('samples for full, publish form, search result, and shallow reads when rows are absent', () => {
    const base = {
      treeOk: true,
      userControlled: true,
      requestedDepth: undefined,
      focusRefId: undefined,
      rows: rows(false),
    };

    expect(shouldSampleVisibleText({ ...base, mode: 'full' })).toBe(true);
    expect(shouldSampleVisibleText({ ...base, mode: 'compact', pageRole: 'publish_form' })).toBe(
      true,
    );
    expect(shouldSampleVisibleText({ ...base, mode: 'compact', pageRole: 'search_results' })).toBe(
      true,
    );
    expect(shouldSampleVisibleText({ ...base, mode: 'compact', requestedDepth: 3 })).toBe(true);
  });

  it('skips sampling when user-controlled rows are already usable', () => {
    expect(
      shouldSampleVisibleText({
        treeOk: true,
        userControlled: true,
        mode: 'compact',
        requestedDepth: undefined,
        focusRefId: undefined,
        rows: rows(true),
      }),
    ).toBe(false);
  });

  it('samples when the page is not user-controlled so Tabrix can recover context', () => {
    expect(
      shouldSampleVisibleText({
        treeOk: true,
        userControlled: false,
        mode: 'compact',
        requestedDepth: undefined,
        focusRefId: undefined,
        rows: rows(true),
      }),
    ).toBe(true);
  });
});
