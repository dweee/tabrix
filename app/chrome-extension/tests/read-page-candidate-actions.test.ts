import { describe, expect, it } from 'vitest';
import type { ReadPageCandidateAction, ReadPageInteractiveElement } from '@tabrix/shared';
import { buildCandidateActions } from '@/entrypoints/background/tools/browser/read-page-candidate-actions';
import { buildPageOperationMap } from '@/entrypoints/background/tools/browser/read-page-operation-map';

function element(overrides: Partial<ReadPageInteractiveElement>): ReadPageInteractiveElement {
  return {
    ref: overrides.ref ?? 'ref_1',
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Search',
    matchSource: overrides.matchSource ?? 'visible_text',
    actionability: overrides.actionability ?? 'actionable',
  };
}

function visibleRowsForTarget(targetRef: string) {
  return {
    sourceDataSource: 'dom_region_rows',
    rows: [
      {
        rowId: 'row_1',
        title: 'Practical guide to AI poster creation',
        primaryText: 'Practical guide to AI poster creation',
        secondaryText: 'Design Lab',
        metaText: 'today',
        interactionText: '128 saves',
        visibleTextFields: ['Practical guide to AI poster creation'],
        targetRef,
        targetRefCoverageRate: 1,
        boundingBox: null,
        regionId: 'region_row_1',
        sourceRegion: 'content',
        confidence: 0.86,
        qualityReasons: ['target_ref_available'],
      },
    ],
    rowCount: 1,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion: 'content',
    rowExtractionConfidence: 0.86,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.82,
    cardRowsCount: 1,
    rowOrder: 'visual_order',
    targetRefCoverageRate: 1,
    regionQualityScore: 0.78,
    visibleDomRowsCandidateCount: 1,
    visibleDomRowsSelectedCount: 1,
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
      url: 'https://example.com/search',
      title: 'Search results',
      viewport: { width: 1280, height: 720, dpr: 1 },
      scrollY: 0,
      pixelsAbove: 0,
      pixelsBelow: 0,
      visibleRegionCount: 1,
      candidateRegionCount: 1,
    },
  } as const;
}

describe('read_page candidate action intents', () => {
  it('marks search inputs as query entry without leaking their label into locatorChain', () => {
    const actions = buildCandidateActions(
      [element({ ref: 'ref_search_input', role: 'searchbox', name: 'Search projects' })],
      [{ ref: 'ref_search_input', selector: 'input[type="search"]' }],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'fill',
      targetRef: 'ref_search_input',
      intent: 'search.enter_query',
    });
    expect(actions[0].locatorChain).toEqual([
      { type: 'ref', value: 'ref_search_input' },
      { type: 'css', value: 'input[type="search"]' },
    ]);
  });

  it('marks search buttons as search submit while preserving auth intent precedence', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_search_button', role: 'button', name: 'Search' }),
        element({ ref: 'ref_login_button', role: 'button', name: 'Login' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_search_button')?.intent).toBe(
      'search.submit',
    );
    expect(actions.find((action) => action.targetRef === 'ref_login_button')?.intent).toBe(
      'auth.submit_login',
    );
  });

  it('does not turn placeholder-only action words into clickable search submit intent', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_placeholder',
          role: 'button',
          name: 'Search',
          matchSource: 'placeholder',
        }),
      ],
      [],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_placeholder',
    });
    expect(actions[0].intent).toBeUndefined();
  });

  it('does not emit executable candidates for blocked or not-actionable elements', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_blocked_request_otp',
          role: 'button',
          name: 'Get code',
          actionability: 'blocked',
        }),
        element({
          ref: 'ref_not_actionable_terms',
          role: 'button',
          name: 'Agree and continue',
          actionability: 'not_actionable',
        }),
        element({
          ref: 'ref_ready_search',
          role: 'button',
          name: 'Search',
          actionability: 'actionable',
        }),
      ],
      [],
    );

    expect(actions.map((action) => action.targetRef)).toEqual(['ref_ready_search']);
    expect(actions[0]).toMatchObject({
      actionType: 'click',
      intent: 'search.submit',
      targetRef: 'ref_ready_search',
    });
  });

  it('preserves candidate action intent in derived operation-map executable actions', () => {
    const candidateAction: ReadPageCandidateAction = {
      id: 'ca_click_ref_search',
      actionType: 'click',
      targetRef: 'ref_search',
      confidence: 0.93,
      matchReason: 'primary action inferred from interactive label',
      locatorChain: [{ type: 'ref', value: 'ref_search' }],
      intent: 'search.submit',
    };

    const operationMap = buildPageOperationMap([], {
      candidateActions: [candidateAction],
      interactiveElements: [element({ ref: 'ref_search', role: 'button', name: 'Search' })],
    });

    const zone = operationMap.zones.find(
      (item) => item.zoneId === 'zone_search_entry_ca_click_ref_search',
    );
    expect(zone?.primaryAction?.toolArgs.candidateAction.intent).toBe('search.submit');
  });

  it('marks explicit detail links as detail-opening intent without treating search links as detail', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_detail', role: 'link', name: 'View details' }),
        element({ ref: 'ref_search', role: 'link', name: 'Search results' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_detail')?.intent).toBe(
      'content.open_detail',
    );
    expect(actions.find((action) => action.targetRef === 'ref_search')?.intent).toBe(
      'search.submit',
    );
  });

  it('binds visible result row targets to detail-opening intent without detail wording', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_row_title',
          role: 'link',
          name: 'Practical guide to AI poster creation',
        }),
      ],
      [{ ref: 'ref_row_title', selector: 'article:nth-of-type(1) a' }],
      {
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [
            {
              rowId: 'row_1',
              title: 'Practical guide to AI poster creation',
              primaryText: 'Practical guide to AI poster creation',
              secondaryText: 'Design Lab',
              metaText: 'today',
              interactionText: '128 saves',
              visibleTextFields: ['Practical guide to AI poster creation'],
              targetRef: 'ref_row_title',
              targetRefCoverageRate: 1,
              boundingBox: null,
              regionId: 'region_row_1',
              sourceRegion: 'content',
              confidence: 0.86,
              qualityReasons: ['target_ref_available'],
            },
          ],
          rowCount: 1,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'content',
          rowExtractionConfidence: 0.86,
          cardExtractorUsed: true,
          cardPatternConfidence: 0.82,
          cardRowsCount: 1,
          rowOrder: 'visual_order',
          targetRefCoverageRate: 1,
          regionQualityScore: 0.78,
          visibleDomRowsCandidateCount: 1,
          visibleDomRowsSelectedCount: 1,
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
            url: 'https://example.com/search',
            title: 'Search results',
            viewport: { width: 1280, height: 720, dpr: 1 },
            scrollY: 0,
            pixelsAbove: 0,
            pixelsBelow: 0,
            visibleRegionCount: 1,
            candidateRegionCount: 1,
          },
        },
      },
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_row_title',
      intent: 'content.open_detail',
      matchReason: 'content row target inferred from visible region rows',
    });
    expect(actions[0].locatorChain).toEqual([
      { type: 'ref', value: 'ref_row_title' },
      { type: 'aria', value: 'Practical guide to AI poster creation' },
      { type: 'css', value: 'article:nth-of-type(1) a' },
    ]);
  });

  it('does not bind not-actionable visible row targets to detail actions', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_row_title',
          role: 'link',
          name: 'Practical guide to AI poster creation',
          actionability: 'not_actionable',
        }),
      ],
      [{ ref: 'ref_row_title', selector: 'article:nth-of-type(1) a' }],
      {
        visibleRegionRows: visibleRowsForTarget('ref_row_title'),
      },
    );

    expect(actions).toEqual([]);
  });

  it('does not let visible rows override auth or search intent precedence', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_search_button', role: 'button', name: 'Search' }),
        element({ ref: 'ref_login_button', role: 'button', name: 'Login' }),
      ],
      [],
      {
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [
            {
              rowId: 'row_search',
              title: 'Search',
              primaryText: 'Search',
              secondaryText: '',
              metaText: '',
              interactionText: '',
              visibleTextFields: ['Search'],
              targetRef: 'ref_search_button',
              targetRefCoverageRate: 1,
              boundingBox: null,
              regionId: 'region_row_search',
              sourceRegion: 'content',
              confidence: 0.88,
              qualityReasons: ['target_ref_available'],
            },
            {
              rowId: 'row_login',
              title: 'Login',
              primaryText: 'Login',
              secondaryText: '',
              metaText: '',
              interactionText: '',
              visibleTextFields: ['Login'],
              targetRef: 'ref_login_button',
              targetRefCoverageRate: 1,
              boundingBox: null,
              regionId: 'region_row_login',
              sourceRegion: 'content',
              confidence: 0.88,
              qualityReasons: ['target_ref_available'],
            },
          ],
          rowCount: 2,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'content',
          rowExtractionConfidence: 0.88,
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
            url: 'https://example.com/search',
            title: 'Search results',
            viewport: { width: 1280, height: 720, dpr: 1 },
            scrollY: 0,
            pixelsAbove: 0,
            pixelsBelow: 0,
            visibleRegionCount: 1,
            candidateRegionCount: 1,
          },
        },
      },
    );

    expect(actions.find((action) => action.targetRef === 'ref_search_button')?.intent).toBe(
      'search.submit',
    );
    expect(actions.find((action) => action.targetRef === 'ref_login_button')?.intent).toBe(
      'auth.submit_login',
    );
  });
});
