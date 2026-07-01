import { describe, expect, it } from 'vitest';
import type {
  ReadPageAssistantGuidance,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageVisibleRegionRows,
} from '@tabrix/shared';
import {
  buildSearchSurface,
  extractFilterPanelLabelsFromVisibleText,
  parseCollectionCountCandidate,
} from '@/entrypoints/background/tools/browser/read-page-search-surface';

function interactive(overrides: Partial<ReadPageInteractiveElement>): ReadPageInteractiveElement {
  const element: ReadPageInteractiveElement = {
    ref: overrides.ref ?? 'ref_button',
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Filter',
    matchSource: overrides.matchSource ?? 'visible_text',
    actionability: overrides.actionability ?? 'actionable',
    valueState: overrides.valueState,
    checked: overrides.checked,
    rect: overrides.rect,
  };
  const selector = (overrides as Partial<ReadPageInteractiveElement> & { selector?: string })
    .selector;
  if (selector) {
    (element as ReadPageInteractiveElement & { selector: string }).selector = selector;
  }
  return element;
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
          intent: 'filter.option_select',
        }),
      ],
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.controls.map((control) => control.kind)).toEqual([
      'search_input',
      'filter_trigger',
      'filter_panel_option',
    ]);
    expect(surface?.resultCards).toHaveLength(2);
    expect(surface?.resultCards?.[0]).toMatchObject({
      title: 'AI poster workflow for shopping season',
      primaryText: 'Design Lab',
      secondaryText: 'Design Lab',
      metaText: 'today',
      interactionText: '收藏 2,945',
      collectionCountCandidate: 2945,
      targetRef: 'ref_card_1',
    });
    expect(surface?.resultCards?.[1]?.collectionCountCandidate).toBe(18000);
    expect(surface?.sortEvidence).toMatchObject({
      requestedSort: 'sort_observed',
      appliedCandidate: false,
    });
    expect(surface?.topNCompleteness).toMatchObject({
      requestedMinResults: 10,
      observedResultCount: 2,
      status: 'insufficient',
    });
    expect(surface?.claimBoundary).toContain('observation');
  });

  it('recognizes a search textbox by stable structural identity when its visible label is dynamic', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_dynamic_search',
          role: 'textbox',
          name: '葡萄牙1点开战',
          matchSource: 'attribute',
          selector: '#search-input-in-feeds',
          valueState: 'empty',
        } as Partial<ReadPageInteractiveElement>),
      ],
      candidateActions: [
        candidate({
          id: 'ca_fill_ref_dynamic_search',
          actionType: 'fill',
          targetRef: 'ref_dynamic_search',
          intent: 'search.enter_query',
        }),
      ],
    });

    expect(surface?.controls[0]).toMatchObject({
      kind: 'search_input',
      targetRef: 'ref_dynamic_search',
      candidateActionId: 'ca_fill_ref_dynamic_search',
      label: '葡萄牙1点开战',
    });
    expect(surface?.queryState).toBe('empty');
  });

  it('does not treat an out-of-band side panel filter label as the search filter trigger', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_search',
          role: 'searchbox',
          name: 'Search',
          rect: { x: 496, y: 83, width: 879, height: 41 },
        }),
        interactive({
          ref: 'ref_sort_default',
          role: 'button',
          name: '综合',
          rect: { x: 122, y: 116, width: 64, height: 36 },
        }),
        interactive({
          ref: 'ref_side_panel_filter',
          role: 'button',
          name: '筛选',
          rect: { x: 1591, y: 116, width: 84, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_side_panel_filter',
          targetRef: 'ref_side_panel_filter',
          intent: 'filter.open',
        }),
      ],
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.controls.some((control) => control.kind === 'filter_trigger')).toBe(false);
    expect(surface?.controls.map((control) => control.kind)).toContain('search_input');
  });

  it('does not treat a far side panel filter label as search trigger when only one toolbar chip is observed', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_sort_default',
          role: 'button',
          name: '综合',
          rect: { x: 122, y: 116, width: 64, height: 36 },
        }),
        interactive({
          ref: 'ref_side_panel_filter',
          role: 'button',
          name: '筛选',
          rect: { x: 1607, y: 126, width: 32, height: 19 },
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_side_panel_filter',
          targetRef: 'ref_side_panel_filter',
          intent: 'filter.open',
        }),
      ],
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.controls.some((control) => control.kind === 'filter_trigger')).toBe(false);
    expect(surface?.controls.find((control) => control.label === '综合')).toBeDefined();
  });

  it('keeps a locator-backed filter trigger when it is aligned with the search toolbar row', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_search',
          role: 'searchbox',
          name: 'Search',
          rect: { x: 240, y: 80, width: 640, height: 40 },
        }),
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '筛选',
          rect: { x: 900, y: 82, width: 72, height: 36 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
      ],
    });

    expect(surface?.controls.find((control) => control.kind === 'filter_trigger')).toMatchObject({
      targetRef: 'ref_filter',
      candidateActionId: 'ca_filter',
    });
  });

  it('surfaces visible toolbar labels as unresolved when no target refs are available', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleTextContent: ['全部 图文 视频 用户', '筛选'].join('\n'),
    });

    expect(surface?.status).toBe('detected');
    expect(surface?.categoryTabs?.map((control) => control.label)).toEqual([
      '全部',
      '图文',
      '视频',
      '用户',
    ]);
    expect(surface?.categoryTabs?.map((control) => control.source)).toEqual([
      'visible_text_unresolved',
      'visible_text_unresolved',
      'visible_text_unresolved',
      'visible_text_unresolved',
    ]);
    expect(surface?.visibleButUnresolved?.map((control) => control.label)).toEqual([
      '全部',
      '图文',
      '视频',
      '用户',
      '筛选',
    ]);
    expect(
      surface?.visibleButUnresolved?.find((control) => control.label === '筛选'),
    ).toMatchObject({
      kind: 'filter_trigger',
      source: 'visible_text_unresolved',
    });
    expect(surface?.categoryState).toMatchObject({
      selectedLabels: [],
      unresolvedLabels: ['全部', '图文', '视频', '用户'],
    });
    expect(surface?.observationCoverage?.capabilityGaps).toContain('visible_text_without_locator');
    expect(surface?.resultCards).toEqual([]);
  });

  it('promotes recovered search toolbar candidate actions to text-recovery controls', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_text_search_toolbar_1',
          role: 'button',
          name: '筛选',
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_click_ref_text_search_toolbar_1',
          targetRef: 'ref_text_search_toolbar_1',
          intent: 'filter.open',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_1' },
            { type: 'aria', value: '筛选' },
            { type: 'css', value: '.toolbar-filter' },
          ],
        }),
      ],
      visibleTextContent: '筛选',
    });

    expect(surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          label: '筛选',
          targetRef: 'ref_text_search_toolbar_1',
          candidateActionId: 'ca_click_ref_text_search_toolbar_1',
          source: 'text_recovery',
        }),
      ]),
    );
    expect(surface?.visibleButUnresolved).toEqual([]);
  });

  it('links toolbar controls to locator-backed actions even when recovered refs drift', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_text_search_toolbar_155',
          role: 'button',
          name: '筛选',
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_filter_locator_backed',
          targetRef: 'ref_text_search_toolbar_12',
          intent: 'filter.open',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_12' },
            { type: 'aria', value: '筛选' },
            { type: 'css', value: '.toolbar-filter' },
          ],
        }),
      ],
      visibleTextContent: '筛选',
    });

    expect(surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          label: '筛选',
          targetRef: 'ref_text_search_toolbar_155',
          candidateActionId: 'ca_filter_locator_backed',
        }),
      ]),
    );
  });

  it('treats applied-filter toolbar state text as the filter trigger', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_text_search_toolbar_9',
          role: 'button',
          name: '已筛选',
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_click_ref_text_search_toolbar_9',
          targetRef: 'ref_text_search_toolbar_9',
          intent: 'filter.open',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_9' },
            { type: 'aria', value: '已筛选' },
            { type: 'css', value: '.toolbar-filter-applied' },
          ],
        }),
      ],
      visibleTextContent: '全部 图文 视频 用户 已筛选',
    });

    expect(surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          label: '已筛选',
          targetRef: 'ref_text_search_toolbar_9',
          candidateActionId: 'ca_click_ref_text_search_toolbar_9',
          source: 'text_recovery',
        }),
      ]),
    );
  });

  it('keeps category tabs out of result cards when toolbar refs are recovered', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_text_search_toolbar_1', role: 'tab', name: '全部' }),
        interactive({ ref: 'ref_text_search_toolbar_2', role: 'tab', name: '图文' }),
        interactive({ ref: 'ref_text_search_toolbar_3', role: 'tab', name: '视频' }),
        interactive({ ref: 'ref_text_search_toolbar_4', role: 'tab', name: '用户' }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_click_ref_text_search_toolbar_1',
          targetRef: 'ref_text_search_toolbar_1',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_1' },
            { type: 'aria', value: '全部' },
            { type: 'css', value: '.tab-all' },
          ],
        }),
        candidate({
          id: 'ca_click_ref_text_search_toolbar_2',
          targetRef: 'ref_text_search_toolbar_2',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_2' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.tab-image' },
          ],
        }),
        candidate({
          id: 'ca_click_ref_text_search_toolbar_3',
          targetRef: 'ref_text_search_toolbar_3',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_3' },
            { type: 'aria', value: '视频' },
            { type: 'css', value: '.tab-video' },
          ],
        }),
        candidate({
          id: 'ca_click_ref_text_search_toolbar_4',
          targetRef: 'ref_text_search_toolbar_4',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_4' },
            { type: 'aria', value: '用户' },
            { type: 'css', value: '.tab-user' },
          ],
        }),
      ],
      visibleTextContent: '全部 图文 视频 用户',
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.categoryTabs?.map((control) => control.label)).toEqual([
      '全部',
      '图文',
      '视频',
      '用户',
    ]);
    expect(surface?.categoryTabs?.every((control) => control.source === 'text_recovery')).toBe(
      true,
    );
    expect(surface?.resultCards?.map((card) => card.title)).toEqual([
      'AI poster workflow for shopping season',
      'Prompt patterns for poster variants',
    ]);
  });

  it('does not classify lower filter-panel options as top search category tabs', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_text_search_toolbar_1',
          role: 'tab',
          name: '全部',
          rect: { x: 220, y: 88, width: 40, height: 32 },
        }),
        interactive({
          ref: 'ref_text_search_toolbar_2',
          role: 'button',
          name: '筛选',
          rect: { x: 1040, y: 96, width: 56, height: 32 },
        }),
        interactive({
          ref: 'ref_text_search_toolbar_3',
          role: 'button',
          name: '图文',
          rect: { x: 960, y: 335, width: 48, height: 32 },
        }),
        interactive({
          ref: 'ref_text_search_toolbar_4',
          role: 'button',
          name: '视频',
          rect: { x: 1030, y: 335, width: 48, height: 32 },
        }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_tab_all',
          targetRef: 'ref_text_search_toolbar_1',
          intent: 'search.category_select',
        }),
        candidate({
          id: 'ca_filter',
          targetRef: 'ref_text_search_toolbar_2',
          intent: 'filter.open',
        }),
        candidate({
          id: 'ca_panel_images',
          targetRef: 'ref_text_search_toolbar_3',
        }),
        candidate({
          id: 'ca_panel_videos',
          targetRef: 'ref_text_search_toolbar_4',
        }),
      ],
      visibleTextContent: ['全部 筛选', '图文 视频'].join('\n'),
    });

    expect(surface?.categoryTabs?.map((control) => control.label)).toEqual(['全部']);
    expect(surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          label: '筛选',
        }),
      ]),
    );
    expect(surface?.categoryState).toMatchObject({
      selectedLabels: [],
      unresolvedLabels: [],
    });
  });

  it('does not classify result-card prose that merely contains toolbar words as controls', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleTextContent: ['如何筛选高价值结果', '排序不是这个卡片的按钮'].join('\n'),
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.categoryTabs).toEqual([]);
    expect(surface?.visibleButUnresolved).toEqual([]);
    expect(surface?.controls).toEqual([]);
    expect(surface?.resultCards).toHaveLength(2);
  });

  it('extracts short toolbar labels from a long visible header line', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleTextContent: [
        'Home Explore Messages Notifications Profile Search query text neutral navigation words 全部 图文 视频 用户 筛选',
        'Result card text stays below the toolbar projection',
      ].join('\n'),
      visibleRegionRows: visibleRows(),
    });

    expect(surface?.categoryTabs?.map((control) => control.label)).toEqual([
      '全部',
      '图文',
      '视频',
      '用户',
    ]);
    expect(
      surface?.visibleButUnresolved?.find((control) => control.label === '筛选'),
    ).toMatchObject({
      kind: 'filter_trigger',
      source: 'visible_text_unresolved',
    });
  });

  it('marks most-collected sort as an applied candidate only when the fresh control state says so', () => {
    const rows = visibleRows();
    rows.rows = Array.from({ length: 10 }, (_, index) => ({
      ...rows.rows[index % 2],
      rowId: `row_${index + 1}`,
      title: `Result ${index + 1}`,
      primaryText: `Result ${index + 1}`,
      targetRef: `ref_card_${index + 1}`,
    }));
    rows.rowCount = rows.rows.length;
    rows.cardRowsCount = rows.rows.length;
    rows.visibleDomRowsCandidateCount = rows.rows.length;
    rows.visibleDomRowsSelectedCount = rows.rows.length;

    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_filter', role: 'button', name: '筛选' }),
        interactive({ ref: 'ref_sort', role: 'option', name: '最多收藏 已选', checked: true }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_sort',
          targetRef: 'ref_sort',
          intent: 'filter.option_select',
        }),
      ],
      visibleRegionRows: rows,
    });

    expect(surface?.sortEvidence).toMatchObject({
      requestedSort: 'sort_observed',
      appliedCandidate: true,
    });
    expect(surface?.topNCompleteness).toMatchObject({
      observedResultCount: 10,
      status: 'sufficient',
    });
  });

  it('reports selected category tab state from structured interactive evidence', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_tab_all', role: 'tab', name: '全部' }),
        interactive({ ref: 'ref_tab_image', role: 'tab', name: '图文', checked: true }),
        interactive({ ref: 'ref_tab_video', role: 'tab', name: '视频' }),
        interactive({ ref: 'ref_tab_user', role: 'tab', name: '用户' }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_tab_image',
          targetRef: 'ref_tab_image',
          intent: 'search.category_select',
        }),
      ],
      visibleTextContent: '全部 图文 视频 用户',
    });

    expect(surface?.categoryTabs?.find((control) => control.label === '图文')).toMatchObject({
      kind: 'category_tab',
      state: expect.objectContaining({ selected: true, current: true }),
    });
    expect(surface?.categoryState).toMatchObject({
      selectedLabels: ['图文'],
      ambiguousLabels: [],
      unresolvedLabels: [],
    });
  });

  it('reports filter panel and sort menu options from short visible toolbar text', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [interactive({ ref: 'ref_sort_menu', role: 'button', name: '排序' })],
      candidateActions: [
        candidate({ id: 'ca_sort_menu', targetRef: 'ref_sort_menu', intent: 'filter.open' }),
      ],
      visibleTextContent: [
        '全部 图文 视频 用户',
        '排序',
        '综合 最新 最多收藏 不限',
        '清除 确认',
      ].join('\n'),
    });

    expect(surface?.controls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'sort_menu',
          label: '排序',
        }),
      ]),
    );
    expect(surface?.filterPanel).toMatchObject({
      status: 'open_candidate',
      optionLabels: expect.arrayContaining(['综合', '最新', '最多收藏', '不限']),
      clearActionObserved: true,
      confirmActionObserved: true,
    });
    expect(surface?.sortEvidence).toMatchObject({
      requestedSort: 'sort_menu',
      menuOpenCandidate: true,
      optionLabels: ['综合', '最新', '最多收藏'],
    });
  });

  it('extracts content type and time range labels for filter-panel target recovery', () => {
    const labels = extractFilterPanelLabelsFromVisibleText(
      '排序依据 综合 最新 最多收藏 笔记类型 不限 视频 图文 发布时间 不限 一天内 一周内 半年内',
    );

    expect(labels).toEqual(
      expect.arrayContaining(['综合', '最多收藏', '图文', '视频', '一天内', '一周内']),
    );
  });

  it('reports targetable recovered filter panel options from long visible text', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_text_filter_panel_1', role: 'button', name: '最多收藏' }),
        interactive({ ref: 'ref_text_filter_panel_2', role: 'button', name: '一天内' }),
        interactive({ ref: 'ref_text_filter_panel_3', role: 'button', name: '未看过' }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_click_ref_text_filter_panel_1',
          targetRef: 'ref_text_filter_panel_1',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_1' },
            { type: 'aria', value: '最多收藏' },
            { type: 'css', value: '.filter-panel .tag-most-saved' },
          ],
        }),
        candidate({
          id: 'ca_click_ref_text_filter_panel_2',
          targetRef: 'ref_text_filter_panel_2',
          intent: 'filter.time_range_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_2' },
            { type: 'aria', value: '一天内' },
            { type: 'css', value: '.filter-panel .tag-one-day' },
          ],
        }),
        candidate({
          id: 'ca_click_ref_text_filter_panel_3',
          targetRef: 'ref_text_filter_panel_3',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_3' },
            { type: 'aria', value: '未看过' },
            { type: 'css', value: '.filter-panel .tag-unseen' },
          ],
        }),
      ],
      visibleTextContent:
        '排序依据 综合 最新 最多点赞 最多评论 最多收藏 发布时间 不限 一天内 一周内 半年内 搜索范围 不限 已看过 未看过 已关注 位置距离 不限 同城 附近 重置 收起',
    });

    expect(surface?.filterPanel).toMatchObject({
      status: 'open_candidate',
      optionLabels: expect.arrayContaining(['最多收藏', '一天内', '未看过']),
      clearActionObserved: true,
    });
    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '最多收藏',
          targetRef: 'ref_text_filter_panel_1',
          candidateActionId: 'ca_click_ref_text_filter_panel_1',
          source: 'text_recovery',
          filterGroup: 'sort',
        }),
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '一天内',
          targetRef: 'ref_text_filter_panel_2',
          candidateActionId: 'ca_click_ref_text_filter_panel_2',
          source: 'text_recovery',
          filterGroup: 'time_range',
        }),
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '未看过',
          targetRef: 'ref_text_filter_panel_3',
          candidateActionId: 'ca_click_ref_text_filter_panel_3',
          source: 'text_recovery',
          filterGroup: 'other',
        }),
      ]),
    );
  });

  it('does not treat filter-panel options as toolbar filter-open controls', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_text_filter_panel_1', role: 'button', name: '综合' }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_click_ref_text_filter_panel_1',
          targetRef: 'ref_text_filter_panel_1',
          intent: 'filter.open',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_1' },
            { type: 'aria', value: '综合' },
            { type: 'css', value: '.filter-panel .sort-default' },
          ],
        }),
      ],
      visibleTextContent: ['排序依据', '综合 最新 最多收藏'].join('\n'),
    });

    expect(surface?.controls ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          candidateActionId: 'ca_click_ref_text_filter_panel_1',
        }),
      ]),
    );
    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '综合',
          candidateActionId: 'ca_click_ref_text_filter_panel_1',
        }),
      ]),
    );
  });

  it('treats out-of-band content type options as selected filter-panel options', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_tab_all',
          role: 'tab',
          name: '全部',
          rect: { x: 196, y: 88, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '已筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_panel_image_text',
          role: 'button',
          name: '图文',
          checked: true,
          rect: { x: 1480, y: 334, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_panel_video',
          role: 'button',
          name: '视频',
          rect: { x: 1380, y: 334, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_text_filter_panel_sort',
          role: 'button',
          name: '最多收藏',
          checked: true,
          rect: { x: 1260, y: 248, width: 96, height: 40 },
        }),
        interactive({
          ref: 'ref_text_filter_panel_week',
          role: 'button',
          name: '一周内',
          checked: true,
          rect: { x: 1480, y: 422, width: 96, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_tab_all', targetRef: 'ref_tab_all', intent: 'search.category_select' }),
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({ id: 'ca_panel_image_text', targetRef: 'ref_panel_image_text' }),
        candidate({ id: 'ca_panel_video', targetRef: 'ref_panel_video' }),
        candidate({
          id: 'ca_sort',
          targetRef: 'ref_text_filter_panel_sort',
          intent: 'filter.option_select',
        }),
        candidate({ id: 'ca_week', targetRef: 'ref_text_filter_panel_week' }),
      ],
      visibleTextContent: [
        '全部 已筛选',
        '排序依据 综合 最新 最多点赞 最多评论 最多收藏',
        '内容类型 不限 视频 图文',
        '发布时间 不限 一天内 一周内 半年内',
      ].join('\n'),
    });

    expect(surface?.categoryTabs?.map((control) => control.label)).toEqual(['全部']);
    expect(surface?.categoryState).toMatchObject({
      selectedLabels: [],
      unresolvedLabels: [],
    });
    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '图文',
          targetRef: 'ref_panel_image_text',
          filterGroup: 'content_type',
          state: expect.objectContaining({ selected: true }),
        }),
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '最多收藏',
          targetRef: 'ref_text_filter_panel_sort',
          filterGroup: 'sort',
          state: expect.objectContaining({ selected: true }),
        }),
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: '一周内',
          targetRef: 'ref_text_filter_panel_week',
          filterGroup: 'time_range',
          state: expect.objectContaining({ selected: true }),
        }),
      ]),
    );
    expect(surface?.filterPanel?.appliedFilterLabels).toEqual(
      expect.arrayContaining(['图文', '最多收藏', '一周内']),
    );
    expect(surface?.filterState).toMatchObject({
      status: 'observed',
      selected: {
        contentType: '图文',
        sort: '最多收藏',
        timeRange: '一周内',
      },
      missingGroups: [],
      ambiguous: false,
      contentType: {
        selected: '图文',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            label: '图文',
            selected: true,
            targetRef: 'ref_panel_image_text',
            candidateActionId: 'ca_panel_image_text',
          }),
        ]),
      },
      sort: {
        selected: '最多收藏',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            label: '最多收藏',
            selected: true,
            targetRef: 'ref_text_filter_panel_sort',
            candidateActionId: 'ca_sort',
          }),
        ]),
      },
      timeRange: {
        selected: '一周内',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            label: '一周内',
            selected: true,
            targetRef: 'ref_text_filter_panel_week',
            candidateActionId: 'ca_week',
          }),
        ]),
      },
    });
    expect(surface?.filterState?.appliedLabels).not.toContain('综合');
  });

  it('promotes ordinary DOM filter-panel options into targetable grouped filter state', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '已筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_panel_image_text',
          role: '',
          name: '图文',
          rect: { x: 1480, y: 334, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_panel_saved',
          role: '',
          name: '最多收藏',
          rect: { x: 1260, y: 248, width: 96, height: 40 },
        }),
        interactive({
          ref: 'ref_panel_week',
          role: '',
          name: '一周内',
          rect: { x: 1480, y: 422, width: 96, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_panel_image_text',
          targetRef: 'ref_panel_image_text',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_panel_image_text' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.filter-panel .tag-image-text' },
          ],
        }),
        candidate({
          id: 'ca_panel_saved',
          targetRef: 'ref_panel_saved',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_panel_saved' },
            { type: 'aria', value: '最多收藏' },
            { type: 'css', value: '.filter-panel .tag-most-saved' },
          ],
        }),
        candidate({
          id: 'ca_panel_week',
          targetRef: 'ref_panel_week',
          intent: 'filter.time_range_select',
          locatorChain: [
            { type: 'ref', value: 'ref_panel_week' },
            { type: 'aria', value: '一周内' },
            { type: 'css', value: '.filter-panel .tag-week' },
          ],
        }),
      ],
      visibleTextContent: [
        '全部 已筛选',
        '排序依据 综合 最新 最多点赞 最多评论 最多收藏',
        '笔记类型 不限 视频 图文',
        '发布时间 不限 一天内 一周内 半年内',
      ].join('\n'),
    });

    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '图文',
          targetRef: 'ref_panel_image_text',
          candidateActionId: 'ca_panel_image_text',
          filterGroup: 'content_type',
          source: 'interactive_elements',
        }),
        expect.objectContaining({
          label: '最多收藏',
          targetRef: 'ref_panel_saved',
          candidateActionId: 'ca_panel_saved',
          filterGroup: 'sort',
          source: 'interactive_elements',
        }),
        expect.objectContaining({
          label: '一周内',
          targetRef: 'ref_panel_week',
          candidateActionId: 'ca_panel_week',
          filterGroup: 'time_range',
          source: 'interactive_elements',
        }),
      ]),
    );
    expect(surface?.filterState).toMatchObject({
      status: 'partial',
      contentType: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ label: '图文', targetRef: 'ref_panel_image_text' }),
        ]),
      },
      sort: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ label: '最多收藏', targetRef: 'ref_panel_saved' }),
        ]),
      },
      timeRange: {
        candidates: expect.arrayContaining([
          expect.objectContaining({ label: '一周内', targetRef: 'ref_panel_week' }),
        ]),
      },
    });
  });

  it('merges locator-backed visible filter candidate actions into the filter panel summary', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({ ref: 'ref_filter_trigger', role: 'button', name: 'Filters' }),
      ],
      candidateActions: [
        candidate({
          id: 'ca_open_filters',
          targetRef: 'ref_filter_trigger',
          intent: 'filter.open',
          matchReason: 'visible_filter_trigger',
        }),
        candidate({
          id: 'ca_visible_sort_saved',
          targetRef: 'ref_filter_sort_saved',
          intent: 'search.apply_filter.sort',
          label: '最多收藏',
          matchReason: 'visible_filter_option',
          locatorChain: [
            { type: 'ref', value: 'ref_filter_sort_saved' },
            { type: 'aria', value: '最多收藏' },
            { type: 'css', value: '.floating-panel [data-filter="saved"]' },
          ],
        }),
        candidate({
          id: 'ca_visible_content_image_text',
          targetRef: 'ref_filter_content_image_text',
          intent: 'search.apply_filter.content_type',
          label: '图文',
          matchReason: 'visible_filter_option',
          locatorChain: [
            { type: 'ref', value: 'ref_filter_content_image_text' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.floating-panel [data-filter="image-text"]' },
          ],
        }),
        candidate({
          id: 'ca_visible_time_week',
          targetRef: 'ref_filter_time_week',
          intent: 'search.apply_filter.time_range',
          label: '一周内',
          matchReason: 'visible_filter_option',
          locatorChain: [
            { type: 'ref', value: 'ref_filter_time_week' },
            { type: 'aria', value: '一周内' },
            { type: 'css', value: '.floating-panel [data-filter="week"]' },
          ],
        }),
      ],
      visibleTextContent: 'Filters 综合',
    });

    expect(surface?.filterPanel).toMatchObject({
      status: 'open_candidate',
      optionLabels: expect.arrayContaining(['最多收藏', '图文', '一周内']),
    });
    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '最多收藏',
          targetRef: 'ref_filter_sort_saved',
          candidateActionId: 'ca_visible_sort_saved',
          filterGroup: 'sort',
        }),
        expect.objectContaining({
          label: '图文',
          targetRef: 'ref_filter_content_image_text',
          candidateActionId: 'ca_visible_content_image_text',
          filterGroup: 'content_type',
        }),
        expect.objectContaining({
          label: '一周内',
          targetRef: 'ref_filter_time_week',
          candidateActionId: 'ca_visible_time_week',
          filterGroup: 'time_range',
        }),
      ]),
    );
  });

  it('merges visible DOM/style filter state when structured controls only prove defaults', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '已筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_default_sort',
          role: 'button',
          name: '综合',
          checked: true,
          rect: { x: 1260, y: 248, width: 72, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_default_sort',
          targetRef: 'ref_default_sort',
          intent: 'filter.option_select',
        }),
      ],
      visibleSearchFilterState: {
        status: 'observed',
        appliedLabels: ['图文', '最多收藏', '一周内'],
        contentType: '图文',
        sort: '最多收藏',
        timeRange: '一周内',
        groups: {
          contentType: {
            selected: '图文',
            candidates: ['不限', '视频', '图文'],
            source: 'visual_style_state',
            confidence: 0.78,
            ambiguous: false,
            reason: 'selected option inferred from visible style',
          },
          sort: {
            selected: '最多收藏',
            candidates: ['综合', '最新', '最多收藏'],
            source: 'dom_active_state',
            confidence: 0.9,
            ambiguous: false,
            reason: 'selected option inferred from active DOM state',
          },
          timeRange: {
            selected: '一周内',
            candidates: ['不限', '一天内', '一周内'],
            source: 'visual_style_state',
            confidence: 0.78,
            ambiguous: false,
            reason: 'selected option inferred from visible style',
          },
        },
        filterGroups: [
          {
            groupId: 'sort',
            groupLabel: 'sort',
            selected: '最多收藏',
            candidates: ['综合', '最新', '最多收藏'],
            source: 'dom_active_state',
            confidence: 0.9,
            ambiguous: false,
            reason: 'selected option inferred from active DOM state',
          },
        ],
      },
      visibleTextContent: [
        '全部 已筛选',
        '排序依据 综合 最新 最多收藏',
        '笔记类型 不限 视频 图文',
        '发布时间 不限 一天内 一周内',
      ].join('\n'),
    });

    expect(surface?.filterState).toMatchObject({
      status: 'observed',
      selected: {
        contentType: '图文',
        sort: '最多收藏',
        timeRange: '一周内',
      },
      missingGroups: [],
      ambiguous: false,
      appliedLabels: expect.arrayContaining(['图文', '最多收藏', '一周内']),
      sort: {
        selected: '最多收藏',
        candidates: expect.arrayContaining([
          expect.objectContaining({ label: '综合', selected: false }),
          expect.objectContaining({
            label: '最多收藏',
            selected: true,
            source: 'dom_active_state',
          }),
        ]),
      },
    });
  });

  it('preserves observed English image filter labels without mapping them to task-specific text', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: 'Filters',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_panel_image',
          role: 'button',
          name: 'Image',
          checked: true,
          rect: { x: 1480, y: 334, width: 64, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({ id: 'ca_panel_image', targetRef: 'ref_panel_image' }),
      ],
      visibleTextContent: ['Filters', 'Content type All Video Image'].join('\n'),
    });

    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_panel_option',
          label: 'Image',
          targetRef: 'ref_panel_image',
          filterGroup: 'content_type',
          state: expect.objectContaining({ selected: true }),
        }),
      ]),
    );
    expect(surface?.filterState).toMatchObject({
      selected: { contentType: 'Image' },
      contentType: {
        selected: 'Image',
        candidates: expect.arrayContaining([
          expect.objectContaining({
            label: 'Image',
            targetRef: 'ref_panel_image',
            candidateActionId: 'ca_panel_image',
          }),
        ]),
      },
    });
  });

  it('does not treat result-card Image links as content-type filter options', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_text_search_toolbar_152',
          role: 'link',
          name: 'Image',
          rect: { x: 480, y: 620, width: 240, height: 320 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_click_ref_text_search_toolbar_152',
          targetRef: 'ref_text_search_toolbar_152',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_152' },
            { type: 'aria', value: 'Image' },
            { type: 'css', value: 'section:nth-of-type(8) a' },
          ],
        }),
      ],
      visibleTextContent: ['筛选', 'Content type All Video Image'].join('\n'),
    });

    const targetableLabels =
      surface?.filterPanel?.targetableOptions?.map((option) => option.label) ?? [];
    expect(targetableLabels).not.toContain('图文');
    expect(surface?.filterState?.contentType?.selected).toBeUndefined();
  });

  it('does not bind same-label result-card actions to filter-panel options', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '已筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_panel_image_text',
          role: 'button',
          name: '图文',
          rect: { x: 1480, y: 334, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_card_image_text',
          role: 'link',
          name: '图文',
          rect: { x: 620, y: 260, width: 220, height: 300 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_card_image_text',
          targetRef: 'ref_card_image_text',
          intent: 'content.open_detail',
          locatorChain: [
            { type: 'ref', value: 'ref_card_image_text' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: 'section:nth-of-type(2) a' },
          ],
        }),
        candidate({
          id: 'ca_panel_image_text',
          targetRef: 'ref_panel_image_text',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_panel_image_text' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.filter-panel [data-label="图文"]' },
          ],
        }),
      ],
      visibleTextContent: ['全部 图文 视频 用户 已筛选', '笔记类型 不限 视频 图文'].join('\n'),
    });

    const imageTextOptions =
      surface?.filterPanel?.targetableOptions?.filter((option) => option.label === '图文') ?? [];
    expect(imageTextOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_panel_image_text',
          candidateActionId: 'ca_panel_image_text',
          filterGroup: 'content_type',
        }),
      ]),
    );
    expect(imageTextOptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_card_image_text',
          candidateActionId: 'ca_card_image_text',
        }),
      ]),
    );
    expect(surface?.filterState?.contentType.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '图文',
          targetRef: 'ref_panel_image_text',
          candidateActionId: 'ca_panel_image_text',
        }),
      ]),
    );
  });

  it('treats top-band content-type labels as filter options when they come from the open filter panel', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_filter',
          role: 'button',
          name: '已筛选',
          rect: { x: 1500, y: 96, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_text_search_toolbar_152',
          role: 'button',
          name: '图文',
          rect: { x: 220, y: 156, width: 72, height: 36 },
        }),
        interactive({
          ref: 'ref_text_filter_panel_153',
          role: 'button',
          name: '最多收藏',
          rect: { x: 1480, y: 148, width: 96, height: 40 },
        }),
        interactive({
          ref: 'ref_text_filter_panel_156',
          role: 'button',
          name: '图文',
          rect: { x: 1480, y: 196, width: 72, height: 40 },
        }),
        interactive({
          ref: 'ref_card_image_text',
          role: 'link',
          name: '图文',
          rect: { x: 620, y: 260, width: 220, height: 300 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_filter', targetRef: 'ref_filter', intent: 'filter.open' }),
        candidate({
          id: 'ca_toolbar_image_text',
          targetRef: 'ref_text_search_toolbar_152',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_search_toolbar_152' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.search-tabs [role="button"]' },
          ],
        }),
        candidate({
          id: 'ca_panel_saved',
          targetRef: 'ref_text_filter_panel_153',
          intent: 'filter.option_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_153' },
            { type: 'aria', value: '最多收藏' },
            { type: 'css', value: '.filter-panel [data-label="最多收藏"]' },
          ],
        }),
        candidate({
          id: 'ca_panel_image_text',
          targetRef: 'ref_text_filter_panel_156',
          intent: 'search.category_select',
          locatorChain: [
            { type: 'ref', value: 'ref_text_filter_panel_156' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: '.filter-panel [data-label="图文"]' },
          ],
        }),
        candidate({
          id: 'ca_card_image_text',
          targetRef: 'ref_card_image_text',
          intent: 'content.open_detail',
          locatorChain: [
            { type: 'ref', value: 'ref_card_image_text' },
            { type: 'aria', value: '图文' },
            { type: 'css', value: 'section:nth-of-type(2) a' },
          ],
        }),
      ],
      visibleTextContent: [
        '全部 图文 视频 用户 已筛选',
        '排序依据 综合 最新 最多收藏',
        '笔记类型 不限 视频 图文',
      ].join('\n'),
    });

    expect(surface?.filterPanel?.targetableOptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '图文',
          targetRef: 'ref_text_filter_panel_156',
          candidateActionId: 'ca_panel_image_text',
          filterGroup: 'content_type',
        }),
      ]),
    );
    expect(surface?.filterPanel?.targetableOptions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '图文',
          candidateActionId: 'ca_toolbar_image_text',
        }),
        expect.objectContaining({
          label: '图文',
          candidateActionId: 'ca_card_image_text',
        }),
      ]),
    );
  });

  it('marks grouped filter state as ambiguous when one group has multiple selected values', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_panel_image_text',
          role: 'button',
          name: '图文',
          checked: true,
          rect: { x: 1480, y: 334, width: 64, height: 40 },
        }),
        interactive({
          ref: 'ref_panel_video',
          role: 'button',
          name: '视频',
          checked: true,
          rect: { x: 1380, y: 334, width: 64, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_panel_image_text', targetRef: 'ref_panel_image_text' }),
        candidate({ id: 'ca_panel_video', targetRef: 'ref_panel_video' }),
      ],
      visibleTextContent: '内容类型 不限 视频 图文',
    });

    expect(surface?.filterState).toMatchObject({
      status: 'ambiguous',
      ambiguous: true,
      contentType: {
        ambiguous: true,
        candidates: expect.arrayContaining([
          expect.objectContaining({ label: '图文', selected: true }),
          expect.objectContaining({ label: '视频', selected: true }),
        ]),
      },
    });
  });

  it('projects non-content-platform selected filters into generic filter groups', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [
        interactive({
          ref: 'ref_brand_acme',
          role: 'button',
          name: 'Acme',
          checked: true,
          rect: { x: 720, y: 220, width: 88, height: 40 },
        }),
        interactive({
          ref: 'ref_rating_four',
          role: 'checkbox',
          name: '4 stars & up',
          checked: true,
          rect: { x: 720, y: 280, width: 128, height: 40 },
        }),
      ],
      candidateActions: [
        candidate({ id: 'ca_brand_acme', targetRef: 'ref_brand_acme' }),
        candidate({ id: 'ca_rating_four', targetRef: 'ref_rating_four' }),
      ],
      visibleTextContent: ['Brand Acme Globex Umbrella', 'Rating 4 stars & up 3 stars & up'].join(
        '\n',
      ),
    });

    expect(surface?.filterState?.filterGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: 'brand',
          groupLabel: 'Brand',
          selected: 'Acme',
          candidates: expect.arrayContaining([
            expect.objectContaining({
              label: 'Acme',
              selected: true,
              targetRef: 'ref_brand_acme',
              candidateActionId: 'ca_brand_acme',
            }),
          ]),
        }),
        expect.objectContaining({
          groupId: 'rating',
          groupLabel: 'Rating',
          selected: '4 stars & up',
          candidates: expect.arrayContaining([
            expect.objectContaining({
              label: '4 stars & up',
              selected: true,
              targetRef: 'ref_rating_four',
              candidateActionId: 'ca_rating_four',
            }),
          ]),
        }),
      ]),
    );
    expect(surface?.filterState?.selected).toEqual({});
  });

  it('reports result coverage as incomplete when more content or load-more is visible', () => {
    const rows = visibleRows();
    rows.pageInfo.pixelsBelow = 1600;
    rows.rowCount = 20;

    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleRegionRows: rows,
      visibleTextContent: '加载更多',
    });

    expect(surface?.resultCoverage).toMatchObject({
      observedResultCount: 2,
      pixelsBelow: 1600,
      loadMoreCandidateObserved: true,
      virtualizedListCandidate: true,
      status: 'scroll_or_load_more_required',
    });
    expect(surface?.observationCoverage?.capabilityGaps).toContain(
      'top_n_result_completeness_not_proven',
    );
  });

  it('reports frame and shadow coverage boundaries instead of hiding them', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleTextContent: '筛选',
      frameContext: {
        frameScope: 'subframe',
        coverage: 'responding_frame_only',
        source: 'content_script_runtime',
      },
    });

    expect(surface?.observationCoverage).toMatchObject({
      frameCoverage: 'responding_frame_only',
      iframeCoverage: 'explicit_frame_read',
      shadowDomCoverage: 'not_inspected',
    });
    expect(surface?.observationCoverage?.capabilityGaps).toContain(
      'shadow_dom_coverage_not_inspected',
    );
  });

  it('surfaces a visible filter trigger even when the icon/text control has no resolved target yet', () => {
    const surface = buildSearchSurface({
      assistantGuidance: guidance,
      interactiveElements: [],
      candidateActions: [],
      visibleTextContent: ['笔记 用户 问点点', '综合 宣传图 生成指令 免费版', '筛选'].join('\n'),
    });

    expect(surface?.visibleButUnresolved).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          label: '筛选',
          source: 'visible_text_unresolved',
        }),
      ]),
    );
    expect(
      surface?.visibleButUnresolved?.find(
        (item) => item.kind === 'filter_trigger' && item.label === '筛选',
      ),
    ).not.toHaveProperty('candidateActionId');
    expect(surface?.controls).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'filter_trigger',
          actionability: true,
        }),
      ]),
    );
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
