import { describe, expect, it } from 'vitest';
import type {
  ReadPageCandidateAction,
  ReadPageFileInputBinding,
  ReadPageHighValueObject,
  ReadPageInteractiveElement,
} from '@tabrix/shared';
import { buildCandidateActions } from '@/entrypoints/background/tools/browser/read-page-candidate-actions';
import { buildPageOperationMap } from '@/entrypoints/background/tools/browser/read-page-operation-map';
import { mergeHighValueObjectActionsIntoCandidateActions } from '@/entrypoints/background/tools/browser/read-page';

function element(overrides: Partial<ReadPageInteractiveElement>): ReadPageInteractiveElement {
  return {
    ref: overrides.ref ?? 'ref_1',
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Search',
    matchSource: overrides.matchSource ?? 'visible_text',
    actionability: overrides.actionability ?? 'actionable',
    rect: overrides.rect,
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
  const fileInputBinding: ReadPageFileInputBinding = {
    selector: 'input[type="file"]:nth-of-type(1)',
    accept: '.jpg,.jpeg,.png,.webp',
    multiple: true,
    disabled: false,
    visible: false,
    bindingSource: 'dom_input_type_file',
    nextRequiredTool: 'chrome_upload_file',
    nextRequiredCheck: 'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
    claimBoundary:
      'file input selector is snapshot-local and does not prove upload success before chrome_upload_file and fresh readback',
  };

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

  it('carries frameId from a frame-targeted read into candidate actions', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_frame_button',
          role: 'button',
          name: 'Continue',
        }),
      ],
      [{ ref: 'ref_frame_button', selector: 'iframe button.continue' }],
      { frameId: 12 },
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_frame_button',
      frameId: 12,
    });
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

  it('does not promote footer legal links into AI candidate actions on result pages', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_search_input', role: 'searchbox', name: '搜索或输入任何问题' }),
        element({ ref: 'ref_result_card', role: 'link', name: 'AI 图片创作提示词合集' }),
        element({
          ref: 'ref_footer_icp',
          role: 'link',
          name: 'ICP备案',
          href: 'https://beian.miit.gov.cn',
        } as Partial<ReadPageInteractiveElement>),
        element({
          ref: 'ref_footer_privacy',
          role: 'link',
          name: '隐私政策',
          href: '/privacy',
        } as Partial<ReadPageInteractiveElement>),
        element({
          ref: 'ref_footer_terms',
          role: 'link',
          name: '用户协议',
          href: '/terms',
        } as Partial<ReadPageInteractiveElement>),
      ],
      [
        { ref: 'ref_search_input', selector: 'input[type="search"]' },
        { ref: 'ref_result_card', selector: '.result-card a' },
        { ref: 'ref_footer_icp', selector: 'footer a.icp' },
        { ref: 'ref_footer_privacy', selector: 'footer a.privacy' },
        { ref: 'ref_footer_terms', selector: 'footer a.terms' },
      ],
      { visibleRegionRows: visibleRowsForTarget('ref_result_card') },
    );

    expect(actions.map((action) => action.targetRef)).toContain('ref_search_input');
    expect(actions.find((action) => action.targetRef === 'ref_result_card')).toMatchObject({
      intent: 'content.open_detail',
      label: 'Practical guide to AI poster creation',
    });
    expect(actions.map((action) => action.targetRef)).not.toEqual(
      expect.arrayContaining(['ref_footer_icp', 'ref_footer_privacy', 'ref_footer_terms']),
    );
  });

  it('labels and prioritizes publish workflow controls without treating them as search', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_nav_home', role: 'button', name: '首页' }),
        element({ ref: 'ref_nav_notes', role: 'button', name: '笔记管理' }),
        element({ ref: 'ref_upload_video', role: 'button', name: '上传视频' }),
        element({ ref: 'ref_upload_image_text', role: 'button', name: '上传图文' }),
        element({ ref: 'ref_upload_dropzone', role: 'button', name: '拖拽视频到此或点击上传' }),
        element({ ref: 'ref_upload_image', role: 'button', name: '上传图片' }),
        element({ ref: 'ref_decorative_image', role: 'button', name: 'Image: jpg' }),
        element({ ref: 'ref_publish_note', role: 'button', name: '发布笔记' }),
      ],
      [
        { ref: 'ref_upload_image_text', selector: '.creator-tabs .image-text' },
        { ref: 'ref_publish_note', selector: 'button.publish' },
      ],
      { fileInputBindings: [fileInputBinding] },
    );

    expect(actions.slice(0, 5).map((action) => action.targetRef)).toEqual([
      'ref_upload_video',
      'ref_upload_image_text',
      'ref_upload_dropzone',
      'ref_upload_image',
      'ref_publish_note',
    ]);
    expect(actions.find((action) => action.targetRef === 'ref_upload_image_text')).toMatchObject({
      label: '上传图文',
      intent: 'publish.select_media_type',
      actionability: 'actionable',
      actionabilityReason: expect.stringContaining(
        'business_success_not_proven_by_candidate_action',
      ),
      locatorChain: expect.arrayContaining([
        { type: 'aria', value: '上传图文' },
        { type: 'css', value: '.creator-tabs .image-text' },
      ]),
    });
    expect(actions.find((action) => action.targetRef === 'ref_upload_dropzone')).toMatchObject({
      label: '拖拽视频到此或点击上传',
      intent: 'publish.upload_media',
      actionabilityReason: expect.stringContaining(
        'media_upload_requires_file_selection_or_upload_tool_evidence',
      ),
      intentBoundary: expect.stringContaining('upload-entry candidate only'),
      nextRequiredTool: 'chrome_upload_file',
      nextRequiredSelector: 'input[type="file"]:nth-of-type(1)',
      nextRequiredSelectorSource: 'dom_input_type_file',
      nextRequiredCheck: 'prove_file_input_or_file_picker_binding_then_run_fresh_same_tab_read',
    });
    expect(actions.find((action) => action.targetRef === 'ref_upload_image')).toMatchObject({
      label: '上传图片',
      intent: 'publish.upload_media',
      nextRequiredTool: 'chrome_upload_file',
      nextRequiredSelector: 'input[type="file"]:nth-of-type(1)',
      nextRequiredSelectorSource: 'dom_input_type_file',
      nextRequiredCheck: 'prove_file_input_or_file_picker_binding_then_run_fresh_same_tab_read',
    });
    expect(actions.find((action) => action.targetRef === 'ref_decorative_image')?.intent).toBe(
      undefined,
    );
    expect(actions.find((action) => action.targetRef === 'ref_publish_note')).toMatchObject({
      label: '发布笔记',
      intent: 'publish.open_entry',
      intentBoundary: expect.stringContaining('not final publish submission'),
    });
    expect(
      actions.find((action) => action.targetRef === 'ref_publish_note')?.actionabilityReason,
    ).toContain('publish_entry_not_final_submit');
    expect(actions.map((action) => action.intent)).not.toContain('search.submit');
    expect(actions.map((action) => action.intent)).not.toContain('search.category_select');
  });

  it('keeps final publish wording separate from publish-entry wording', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_publish_entry', role: 'button', name: '发布笔记' }),
        element({ ref: 'ref_publish_submit', role: 'button', name: '立即发布' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_publish_entry')).toMatchObject({
      intent: 'publish.open_entry',
      intentBoundary: expect.stringContaining('not final publish submission'),
    });
    expect(actions.find((action) => action.targetRef === 'ref_publish_submit')).toMatchObject({
      intent: 'publish.submit',
      actionability: 'actionable',
      actionabilityReason: expect.stringContaining(
        'business_success_requires_required_fields_and_post_action_readback',
      ),
      intentBoundary: expect.stringContaining('publish success requires'),
    });
  });

  it('does not expose account-like mixed identifiers as candidate action labels or aria locators', () => {
    const actions = buildCandidateActions(
      [element({ ref: 'ref_account', role: 'button', name: 'Creator640C1D3B' })],
      [],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_account',
    });
    expect(actions[0].label).toBeUndefined();
    expect(actions[0].locatorChain).toEqual([{ type: 'ref', value: 'ref_account' }]);
  });

  it('marks filter and most-collected controls with lightweight filter intents', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_filter', role: 'button', name: '筛选' }),
        element({ ref: 'ref_filter_applied', role: 'button', name: '已筛选' }),
        element({ ref: 'ref_sort', role: 'button', name: '排序' }),
        element({ ref: 'ref_category', role: 'tab', name: '图文' }),
        element({ ref: 'ref_sort_saves', role: 'option', name: '最多收藏' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_filter')).toMatchObject({
      actionType: 'click',
      intent: 'filter.open',
    });
    expect(actions.find((action) => action.targetRef === 'ref_filter_applied')).toMatchObject({
      actionType: 'click',
      intent: 'filter.open',
    });
    expect(actions.find((action) => action.targetRef === 'ref_sort')).toMatchObject({
      actionType: 'click',
      intent: 'filter.open',
    });
    expect(actions.find((action) => action.targetRef === 'ref_category')).toMatchObject({
      actionType: 'click',
      intent: 'search.category_select',
    });
    expect(actions.find((action) => action.targetRef === 'ref_sort_saves')).toMatchObject({
      actionType: 'click',
      intent: 'filter.sort_most_collected',
    });
  });

  it('turns recovered search toolbar text actions into locator-backed filter actions', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_text_search_toolbar_155',
          role: 'text_action',
          name: '筛选',
        }),
      ],
      [
        {
          ref: 'ref_text_search_toolbar_155',
          selector: 'body > main > div.search-layout__top > div.filter',
        },
      ],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_text_search_toolbar_155',
      intent: 'filter.open',
      locatorChain: expect.arrayContaining([
        { type: 'css', value: 'body > main > div.search-layout__top > div.filter' },
      ]),
    });
  });

  it('keeps recovered filter-panel options executable and prioritized', () => {
    const actions = buildCandidateActions(
      [
        ...Array.from({ length: 24 }, (_, index) =>
          element({
            ref: `ref_result_${index + 1}`,
            role: 'link',
            name: `Neutral result ${index + 1}`,
          }),
        ),
        element({
          ref: 'ref_text_filter_panel_1',
          role: 'button',
          name: '最多收藏',
        }),
        element({
          ref: 'ref_text_filter_panel_2',
          role: 'button',
          name: '一天内',
        }),
        element({
          ref: 'ref_text_filter_panel_3',
          role: 'button',
          name: '未看过',
        }),
      ],
      [
        { ref: 'ref_text_filter_panel_1', selector: '.filter-panel .tag-most-saved' },
        { ref: 'ref_text_filter_panel_2', selector: '.filter-panel .tag-one-day' },
        { ref: 'ref_text_filter_panel_3', selector: '.filter-panel .tag-unseen' },
      ],
    );

    expect(actions.slice(0, 3).map((action) => action.targetRef)).toEqual([
      'ref_text_filter_panel_1',
      'ref_text_filter_panel_2',
      'ref_text_filter_panel_3',
    ]);
    expect(actions.find((action) => action.targetRef === 'ref_text_filter_panel_1')).toMatchObject({
      actionType: 'click',
      intent: 'filter.sort_most_collected',
      locatorChain: expect.arrayContaining([
        { type: 'css', value: '.filter-panel .tag-most-saved' },
      ]),
    });
    expect(actions.find((action) => action.targetRef === 'ref_text_filter_panel_2')).toMatchObject({
      actionType: 'click',
      intent: 'filter.open',
      locatorChain: expect.arrayContaining([{ type: 'css', value: '.filter-panel .tag-one-day' }]),
    });
    expect(actions.find((action) => action.targetRef === 'ref_text_filter_panel_3')).toMatchObject({
      actionType: 'click',
      intent: 'filter.open',
      locatorChain: expect.arrayContaining([{ type: 'css', value: '.filter-panel .tag-unseen' }]),
    });
  });

  it('keeps visible search result cards ahead of low-value utility actions', () => {
    const resultRows = {
      ...visibleRowsForTarget('ref_result_1'),
      rows: [
        {
          ...visibleRowsForTarget('ref_result_1').rows[0],
          rowId: 'row_1',
          title: 'Practical guide to AI image creation',
          primaryText: 'Practical guide to AI image creation',
          targetRef: 'ref_result_1',
        },
        {
          ...visibleRowsForTarget('ref_result_2').rows[0],
          rowId: 'row_2',
          title: 'How teams review generated visuals',
          primaryText: 'How teams review generated visuals',
          targetRef: 'ref_result_2',
        },
        {
          ...visibleRowsForTarget('ref_result_3').rows[0],
          rowId: 'row_3',
          title: 'Prompt workflow checklist for creators',
          primaryText: 'Prompt workflow checklist for creators',
          targetRef: 'ref_result_3',
        },
      ],
      rowCount: 3,
      visibleDomRowsCandidateCount: 3,
      visibleDomRowsSelectedCount: 3,
    };
    const utilityActions = Array.from({ length: 24 }, (_, index) =>
      element({
        ref: `ref_text_menu_${index + 1}`,
        role: 'button',
        name: index % 2 === 0 ? '菜单' : '设置',
      }),
    );

    const actions = buildCandidateActions(
      [
        ...utilityActions,
        element({
          ref: 'ref_result_1',
          role: 'link',
          name: 'Card shell',
          matchSource: 'visible_text',
        }),
        element({
          ref: 'ref_result_2',
          role: 'link',
          name: 'Card shell',
          matchSource: 'visible_text',
        }),
        element({
          ref: 'ref_result_3',
          role: 'link',
          name: 'Card shell',
          matchSource: 'visible_text',
        }),
      ],
      [],
      { visibleRegionRows: resultRows },
    );

    const contentActions = actions.filter((action) => action.intent === 'content.open_detail');
    expect(contentActions.map((action) => action.targetRef)).toEqual([
      'ref_result_1',
      'ref_result_2',
      'ref_result_3',
    ]);
    expect(contentActions.map((action) => action.label)).toEqual([
      'Practical guide to AI image creation',
      'How teams review generated visuals',
      'Prompt workflow checklist for creators',
    ]);
    expect(actions.slice(0, 3).map((action) => action.targetRef)).toEqual([
      'ref_result_1',
      'ref_result_2',
      'ref_result_3',
    ]);
    expect(actions).toHaveLength(20);
  });

  it('binds trusted visible-text result rows even when the repaired target is generic', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_fallback_53',
          role: 'generic',
          name: 'Card text container',
          actionability: 'not_actionable',
          matchSource: 'visible_text',
        }),
      ],
      [],
      { visibleRegionRows: visibleRowsForTarget('ref_fallback_53') },
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_fallback_53',
      intent: 'content.open_detail',
      actionability: 'actionable',
      label: 'Practical guide to AI poster creation',
    });
  });

  it('does not mark lower filter-panel category-like options as search category selects', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_tab_all',
          role: 'tab',
          name: '全部',
          rect: { x: 220, y: 88, width: 40, height: 32 },
        }),
        element({
          ref: 'ref_filter',
          role: 'button',
          name: '筛选',
          rect: { x: 1040, y: 96, width: 56, height: 32 },
        }),
        element({
          ref: 'ref_panel_images',
          role: 'button',
          name: '图文',
          rect: { x: 960, y: 335, width: 48, height: 32 },
        }),
        element({
          ref: 'ref_panel_videos',
          role: 'button',
          name: '视频',
          rect: { x: 1030, y: 335, width: 48, height: 32 },
        }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_tab_all')).toMatchObject({
      intent: 'search.category_select',
    });
    expect(actions.find((action) => action.targetRef === 'ref_filter')).toMatchObject({
      intent: 'filter.open',
    });
    expect(
      actions.find((action) => action.targetRef === 'ref_panel_images')?.intent,
    ).toBeUndefined();
    expect(
      actions.find((action) => action.targetRef === 'ref_panel_videos')?.intent,
    ).toBeUndefined();
  });

  it('marks QR refresh controls without treating them as OTP or login submit', () => {
    const actions = buildCandidateActions(
      [element({ ref: 'ref_qr_refresh', role: 'button', name: '二维码已过期 点击刷新' })],
      [],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      intent: 'auth.refresh_qr',
      targetRef: 'ref_qr_refresh',
    });
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
      label: 'Search',
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
    expect(zone?.primaryAction?.toolArgs.candidateAction.label).toBe('Search');
  });

  it('maps publish upload and entry form regions to preparation instead of final submit', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_upload_image_text', role: 'button', name: '上传图文' }),
        element({ ref: 'ref_upload_image', role: 'button', name: '上传图片' }),
        element({ ref: 'ref_publish_entry', role: 'button', name: '发布笔记' }),
      ],
      [
        { ref: 'ref_upload_image_text', selector: '.creator-tabs .image-text' },
        { ref: 'ref_upload_image', selector: '.upload-area input[type="file"]' },
      ],
      { fileInputBindings: [fileInputBinding] },
    );
    const mediaTypeAction = actions.find((action) => action.targetRef === 'ref_upload_image_text')!;
    const uploadAction = actions.find((action) => action.targetRef === 'ref_upload_image')!;
    const entryAction = actions.find((action) => action.targetRef === 'ref_publish_entry')!;

    const operationMap = buildPageOperationMap([
      {
        regionId: 'region_form',
        regionType: 'form',
        state: 'input_available_candidate',
        confidence: 0.84,
        label: 'form: upload/publish entry',
        objects: [
          {
            objectId: 'media_type_object',
            label: '上传图文',
            objectType: 'control',
            role: 'button',
            targetRef: mediaTypeAction.targetRef,
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: mediaTypeAction.confidence,
            reason: mediaTypeAction.matchReason,
            primaryAction: {
              candidateActionId: mediaTypeAction.id,
              actionType: mediaTypeAction.actionType,
              targetRef: mediaTypeAction.targetRef,
              locatorChain: mediaTypeAction.locatorChain,
              toolName: 'chrome_click_element',
              toolArgs: { candidateAction: mediaTypeAction },
              claimBoundary: 'test action boundary',
            },
          },
          {
            objectId: 'upload_object',
            label: '上传图片',
            objectType: 'control',
            role: 'button',
            targetRef: uploadAction.targetRef,
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: uploadAction.confidence,
            reason: uploadAction.matchReason,
            primaryAction: {
              candidateActionId: uploadAction.id,
              actionType: uploadAction.actionType,
              targetRef: uploadAction.targetRef,
              locatorChain: uploadAction.locatorChain,
              toolName: 'chrome_click_element',
              toolArgs: { candidateAction: uploadAction },
              claimBoundary: 'test action boundary',
            },
          },
          {
            objectId: 'entry_object',
            label: '发布笔记',
            objectType: 'control',
            role: 'button',
            targetRef: entryAction.targetRef,
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: entryAction.confidence,
            reason: entryAction.matchReason,
            primaryAction: {
              candidateActionId: entryAction.id,
              actionType: entryAction.actionType,
              targetRef: entryAction.targetRef,
              locatorChain: entryAction.locatorChain,
              toolName: 'chrome_click_element',
              toolArgs: { candidateAction: entryAction },
              claimBoundary: 'test action boundary',
            },
          },
        ],
        candidateActionIds: [mediaTypeAction.id, uploadAction.id, entryAction.id],
        targetability: 'target_ref',
        claimBoundary: 'test region boundary',
      },
    ]);

    expect(operationMap.zones[0]).toMatchObject({
      purpose: 'prepare_publish',
      label: 'publish preparation area',
      readiness: 'ready',
    });
    expect(operationMap.zones[0].primaryAction?.toolArgs.candidateAction).toMatchObject({
      intent: 'publish.upload_media',
      nextRequiredTool: 'chrome_upload_file',
      nextRequiredSelector: 'input[type="file"]:nth-of-type(1)',
      nextRequiredSelectorSource: 'dom_input_type_file',
      nextRequiredCheck: 'prove_file_input_or_file_picker_binding_then_run_fresh_same_tab_read',
    });
    expect(operationMap.zones[0].claimBoundary).toContain('final publish submission is not proven');
  });

  it('selects upload media as publish preparation primary action from candidate ids when region objects omit it', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_upload_video', role: 'button', name: '上传视频' }),
        element({ ref: 'ref_upload_image_text', role: 'button', name: '上传图文' }),
        element({
          ref: 'ref_upload_image_prompt',
          role: 'button',
          name: '上传图片，或写文字生成图片',
        }),
      ],
      [
        { ref: 'ref_upload_video', selector: '.tabs .video' },
        { ref: 'ref_upload_image_text', selector: '.tabs .image-text' },
        { ref: 'ref_upload_image_prompt', selector: '.upload-panel .upload-prompt' },
      ],
      { fileInputBindings: [fileInputBinding] },
    );
    const videoAction = actions.find((action) => action.targetRef === 'ref_upload_video')!;
    const imageTextAction = actions.find((action) => action.targetRef === 'ref_upload_image_text')!;
    const uploadPromptAction = actions.find(
      (action) => action.targetRef === 'ref_upload_image_prompt',
    )!;

    const operationMap = buildPageOperationMap(
      [
        {
          regionId: 'region_form',
          regionType: 'form',
          state: 'input_available_candidate',
          confidence: 0.84,
          label: 'form: image-text upload prompt',
          objects: [
            {
              objectId: 'video_tab_object',
              label: '上传视频',
              objectType: 'control',
              role: 'button',
              targetRef: videoAction.targetRef,
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: videoAction.confidence,
              reason: videoAction.matchReason,
              primaryAction: {
                candidateActionId: videoAction.id,
                actionType: videoAction.actionType,
                targetRef: videoAction.targetRef,
                locatorChain: videoAction.locatorChain,
                toolName: 'chrome_click_element',
                toolArgs: { candidateAction: videoAction },
                claimBoundary: 'test action boundary',
              },
            },
            {
              objectId: 'image_text_tab_object',
              label: '上传图文',
              objectType: 'control',
              role: 'button',
              targetRef: imageTextAction.targetRef,
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: imageTextAction.confidence,
              reason: imageTextAction.matchReason,
              primaryAction: {
                candidateActionId: imageTextAction.id,
                actionType: imageTextAction.actionType,
                targetRef: imageTextAction.targetRef,
                locatorChain: imageTextAction.locatorChain,
                toolName: 'chrome_click_element',
                toolArgs: { candidateAction: imageTextAction },
                claimBoundary: 'test action boundary',
              },
            },
          ],
          candidateActionIds: [videoAction.id, imageTextAction.id, uploadPromptAction.id],
          targetability: 'target_ref',
          claimBoundary: 'test region boundary',
        },
      ],
      { candidateActions: actions },
    );

    expect(operationMap.zones[0].primaryAction?.toolArgs.candidateAction).toMatchObject({
      intent: 'publish.upload_media',
      label: '上传图片，或写文字生成图片',
      nextRequiredTool: 'chrome_upload_file',
      nextRequiredSelector: 'input[type="file"]:nth-of-type(1)',
      nextRequiredSelectorSource: 'dom_input_type_file',
      nextRequiredCheck: 'prove_file_input_or_file_picker_binding_then_run_fresh_same_tab_read',
    });
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
        frameId: 33,
      },
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_row_title',
      intent: 'content.open_detail',
      matchReason: 'content row target inferred from visible region rows',
      frameId: 33,
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

  it('does not expose content row candidates behind a broad blocked overlay', () => {
    const visibleRegionRows = visibleRowsForTarget('ref_row_title');
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_overlay',
          role: 'button',
          name: 'assistant overlay',
          actionability: 'blocked',
          rect: { x: 160, y: 0, width: 1500, height: 3000 },
        }),
        element({
          ref: 'ref_row_title',
          role: 'link',
          name: 'Practical guide to AI poster creation',
          actionability: 'actionable',
        }),
        element({
          ref: 'ref_publish',
          role: 'link',
          name: '发布',
          actionability: 'actionable',
        }),
      ],
      [{ ref: 'ref_row_title', selector: 'article:nth-of-type(1) a' }],
      {
        visibleRegionRows: {
          ...visibleRegionRows,
          sourceRegion: 'visible_text',
          rows: visibleRegionRows.rows.map((row) => ({
            ...row,
            sourceRegion: 'visible_text',
            qualityReasons: ['visible_text_fallback', 'target_ref_available'],
          })),
        },
      },
    );

    expect(actions.find((action) => action.targetRef === 'ref_row_title')).toBeUndefined();
    expect(actions.find((action) => action.targetRef === 'ref_publish')?.intent).toBe(
      'publish.open_entry',
    );
    expect(actions.find((action) => action.targetRef === 'ref_publish')?.intentBoundary).toContain(
      'not final publish submission',
    );
    expect(actions.find((action) => action.targetRef === 'ref_publish')?.actionability).toBe(
      'actionable',
    );
  });

  it('does not treat a broad blocked page container as a blocking overlay without modal evidence', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_page_shell',
          role: 'button',
          name: 'Page shell',
          actionability: 'blocked',
          rect: { x: 0, y: 0, width: 1500, height: 3000 },
        }),
        element({
          ref: 'ref_row_title',
          role: 'link',
          name: 'Practical guide to AI poster creation',
          actionability: 'actionable',
        }),
      ],
      [{ ref: 'ref_row_title', selector: 'article:nth-of-type(1) a' }],
      {
        visibleRegionRows: {
          ...visibleRowsForTarget('ref_row_title'),
          sourceRegion: 'visible_text',
        },
      },
    );

    expect(actions.find((action) => action.targetRef === 'ref_row_title')).toMatchObject({
      intent: 'content.open_detail',
      label: 'Practical guide to AI poster creation',
    });
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

  it('bridges high value visible rows into executable content detail actions', () => {
    const existingActions: ReadPageCandidateAction[] = [
      {
        id: 'ca_fill_ref_search',
        actionType: 'fill',
        targetRef: 'ref_search',
        confidence: 0.93,
        matchReason: 'primary action inferred from interactive label',
        locatorChain: [{ type: 'ref', value: 'ref_search' }],
        intent: 'search.enter_query',
      },
      {
        id: 'ca_click_ref_menu',
        actionType: 'click',
        targetRef: 'ref_menu',
        label: 'menu action candidate',
        confidence: 0.72,
        matchReason: 'redacted_menu_action_signal',
        locatorChain: [{ type: 'ref', value: 'ref_menu' }],
      },
    ];
    const highValueObjects: ReadPageHighValueObject[] = [
      {
        id: 'hvo_visible_region_row_menu',
        kind: 'visible_region_row',
        label: 'menu action candidate',
        reason: 'navigation shell row must not become content detail action',
        objectType: 'record',
        region: 'search_results',
        importance: 0.9,
        sourceKind: 'dom_semantic',
        reasons: ['visible_region_row', 'read_fact', 'target_ref_available'],
        confidence: 0.78,
        ref: 'ref_menu_shell',
        actionType: 'click',
        actions: [{ type: 'open_detail', ref: 'ref_menu_shell', actionType: 'click' }],
      },
      {
        id: 'hvo_visible_region_row_1',
        kind: 'visible_region_row',
        label: 'Practical AI image prompt guide',
        reason: 'visible region result row surfaced as a readable and targetable content object',
        objectType: 'record',
        region: 'search_results',
        importance: 0.9,
        sourceKind: 'dom_semantic',
        reasons: ['visible_region_row', 'read_fact', 'target_ref_available'],
        confidence: 0.68,
        ref: 'ref_result_1',
        actionType: 'click',
        actions: [{ type: 'open_detail', ref: 'ref_result_1', actionType: 'click' }],
      },
    ];

    const actions = mergeHighValueObjectActionsIntoCandidateActions(
      existingActions,
      highValueObjects,
      undefined,
    );

    expect(actions.map((action) => action.intent).slice(0, 2)).toEqual([
      'search.enter_query',
      'content.open_detail',
    ]);
    const detailAction = actions.find((action) => action.targetRef === 'ref_result_1');
    expect(detailAction).toMatchObject({
      actionType: 'click',
      intent: 'content.open_detail',
      label: 'Practical AI image prompt guide',
      actionability: 'actionable',
    });
    expect(actions.find((action) => action.targetRef === 'ref_menu_shell')).toBeUndefined();
  });
});
