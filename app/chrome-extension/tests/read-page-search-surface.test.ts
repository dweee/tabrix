import { describe, expect, it } from 'vitest';
import type {
  ReadPageAssistantGuidance,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageVisibleRegionRows,
} from '@tabrix/shared';
import {
  buildSearchSurface,
  parseCollectionCountCandidate,
} from '@/entrypoints/background/tools/browser/read-page-search-surface';

function interactive(overrides: Partial<ReadPageInteractiveElement>): ReadPageInteractiveElement {
  return {
    ref: overrides.ref ?? 'ref_button',
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Filter',
    matchSource: overrides.matchSource ?? 'visible_text',
    actionability: overrides.actionability ?? 'actionable',
    valueState: overrides.valueState,
  };
}

function candidate(overrides: Partial<ReadPageCandidateAction>): ReadPageCandidateAction {
  return {
    id: overrides.id ?? 'ca_click_ref_button',
    actionType: overrides.actionType ?? 'click',
    targetRef: overrides.targetRef ?? 'ref_button',
    confidence: overrides.confidence ?? 0.9,
    matchReason: overrides.matchReason ?? 'test candidate',
    locatorChain: overrides.locatorChain ?? [
      { type: 'ref', value: overrides.targetRef ?? 'ref_button' },
    ],
    intent: overrides.intent,
  };
}

function visibleRows(): ReadPageVisibleRegionRows {
  return {
    sourceDataSource: 'dom_region_rows',
    rows: [
      {
        rowId: 'row_1',
        title: 'AI poster workflow for shopping season',
        primaryText: 'AI poster workflow for shopping season',
        summary: null,
        secondaryText: 'Design Lab',
        metaText: 'today',
        interactionText: '收藏 2,945',
        visibleTextFields: ['AI poster workflow for shopping season'],
        targetRef: 'ref_card_1',
        targetRefCoverageRate: 1,
        boundingBox: null,
        regionId: 'region_row_1',
        sourceRegion: 'content',
        confidence: 0.86,
        qualityReasons: ['target_ref_available'],
      },
      {
        rowId: 'row_2',
        title: 'Prompt patterns for poster variants',
        primaryText: 'Prompt patterns for poster variants',
        summary: null,
        secondaryText: 'Creative Ops',
        metaText: 'yesterday',
        interactionText: '1.8万收藏',
        visibleTextFields: ['Prompt patterns for poster variants'],
        targetRef: 'ref_card_2',
        targetRefCoverageRate: 1,
        boundingBox: null,
        regionId: 'region_row_2',
        sourceRegion: 'content',
        confidence: 0.84,
        qualityReasons: ['target_ref_available'],
      },
    ],
    rowCount: 2,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion: 'content',
    rowExtractionConfidence: 0.86,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.82,
    cardRowsCount: 2,
    rowOrder: 'visual_order',
    targetRefCoverageRate: 1,
    regionQualityScore: 0.78,
    visibleDomRowsCandidateCount: 2,
    visibleDomRowsSelectedCount: 2,
    lowValueRegionRejectedCount: 0,
    footerLikeRejectedCount: 0,
    navigationLikeRejectedCount: 0,
    targetRefCoverageRejectedCount: 0,
    rejectedRegionReasonDistribution: {
      low_value_region: 0,
      footer_like_region: 0,
      navigation_like_region: 0,
      target_ref_coverage_insufficient: 0,
      single_isolated_text: 0,
      empty_shell: 0,
      broad_page_shell: 0,
      dom_region_rows_unavailable: 0,
    },
    pageInfo: {
      url: 'https://example.com/search?q=poster',
      title: 'Search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      scrollY: 0,
      pixelsAbove: 0,
      pixelsBelow: 0,
      visibleRegionCount: 1,
      candidateRegionCount: 1,
    },
  };
}

describe('parseCollectionCountCandidate', () => {
  it('parses compact and comma-form collection counts', () => {
    expect(parseCollectionCountCandidate('收藏 2,945')).toBe(2945);
    expect(parseCollectionCountCandidate('1.8万收藏')).toBe(18000);
    expect(parseCollectionCountCandidate('42 saves')).toBe(42);
    expect(parseCollectionCountCandidate('views 999')).toBeUndefined();
  });
});

describe('buildSearchSurface', () => {
  const guidance: ReadPageAssistantGuidance = {
    taskKind: 'search',
    requestedObjects: ['search_input', 'result_cards', 'detail_metrics'],
  };

  it('returns search controls and result cards when the assistant asks for search objects', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_search',
          role: 'searchbox',
          name: 'Search',
          valueState: 'non_empty',
        }),
        interactive({ ref: 'ref_filter', role: 'button', name: '筛选' }),
        interactive({ ref: 'ref_sort', role: 'option', name: '最多收藏' }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_sort',
          targetRef: 'ref_sort',
          intent: 'filter.sort_most_collected',
        }),
      ],
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.controls.map((control) => control.kind)).toEqual([
      'search_input',
      'filter_trigger',
      'sort_most_collected',
    ]);
    expect(surface?.resultCards).toHaveLength(2);
    expect(surface?.resultCards?.[0]).toMatchObject({
      title: 'AI poster workflow for shopping season',
      collectionCountCandidate: 2945,
      targetRef: 'ref_card_1',
    });
    expect(surface?.resultCards?.[1]?.collectionCountCandidate).toBe(18000);
    expect(surface?.claimBoundary).toContain('observation');
  });

  it('does not run the search projection when the caller did not ask for search work', () => {
    expect(
      buildSearchSurface({
        assistantGuidance: { taskKind: 'auth', authPreference: 'qr' },
        interactiveElements: [interactive({ ref: 'ref_filter', name: '筛选' })],
        candidateActions: [],
        visibleRegionRows: visibleRows(),
      }),
    ).toBeUndefined();
  });
});
