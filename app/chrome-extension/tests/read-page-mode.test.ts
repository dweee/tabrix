import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import { buildInteractiveElements } from '@/entrypoints/background/tools/browser/read-page-interactive-elements';
import * as browserWorldInventory from '@/entrypoints/background/browser-world-inventory';
import {
  buildFallbackRefMap,
  formatElementsAsPageContent,
} from '@/entrypoints/background/tools/browser/read-page-fallback-format';
import { buildCandidateActions } from '@/entrypoints/background/tools/browser/read-page-candidate-actions';
import { extractVisibleRegionRows } from '@/entrypoints/background/tools/browser/visible-region-rows';
import { inferPageUnderstanding } from '@/entrypoints/background/tools/browser/read-page-understanding';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

const MODE_MINIMUM_FIELDS: Record<'compact' | 'normal' | 'full', string[]> = {
  compact: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs'],
  normal: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'diagnostics'],
  full: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'fullSnapshot'],
};

function hasNestedOwnProperty(target: unknown, path: string): boolean {
  const segments = path.split('.');
  let current: unknown = target;

  for (const segment of segments) {
    if (
      current === null ||
      typeof current !== 'object' ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return false;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return true;
}

function expectCommonSnapshotShape(payload: any, mode: 'compact' | 'normal' | 'full') {
  for (const field of MODE_MINIMUM_FIELDS[mode]) {
    expect(payload).toHaveProperty(field);
  }
  expect(payload.mode).toBe(mode);
  expect(['compact', 'task', 'delta', 'full', 'debug']).toContain(payload.observationProfile);
  expect(payload.coverage).toMatchObject({
    overall: expect.stringMatching(/^(covered|degraded|unsupported|visible_unresolved)$/),
    iframe: expect.stringMatching(/^(covered|degraded|unsupported|visible_unresolved)$/),
    shadowDom: expect.stringMatching(/^(covered|degraded|unsupported|visible_unresolved)$/),
    virtualList: expect.stringMatching(/^(covered|degraded|unsupported|visible_unresolved)$/),
    dynamicPanel: expect.stringMatching(/^(covered|degraded|unsupported|visible_unresolved)$/),
    claimBoundary: expect.stringContaining('postcondition verification'),
  });
  expect(Array.isArray(payload.coverage.capabilityGaps)).toBe(true);
  expect(Array.isArray(payload.evidenceSource)).toBe(true);
  expect(payload.evidenceSource.length).toBeGreaterThan(0);
  for (const source of payload.evidenceSource) {
    expect([
      'dom',
      'ax',
      'visible_text',
      'network',
      'api',
      'watch_delta',
      'screenshot_fallback',
      'experience',
    ]).toContain(source);
  }
  expect(payload.page).toMatchObject({
    url: expect.any(String),
    title: expect.any(String),
    pageType: expect.any(String),
  });
  expect(payload.summary).toEqual(expect.any(Object));
  expect(Array.isArray(payload.interactiveElements)).toBe(true);
  expect(Array.isArray(payload.candidateActions)).toBe(true);
  expect(Array.isArray(payload.artifactRefs)).toBe(true);
  expect(payload.artifactRefs[0]).toMatchObject({
    kind: 'dom_snapshot',
    ref: expect.any(String),
  });
  expect(payload.artifactRefs.map((artifact: { ref: string }) => artifact.ref)).toEqual(
    expect.arrayContaining([expect.stringContaining('/normal'), expect.stringContaining('/full')]),
  );
  expect(payload.pageContext).toMatchObject({
    filter: expect.any(String),
    scheme: expect.any(String),
    viewport: expect.any(Object),
    fallbackUsed: expect.any(Boolean),
    refMapCount: expect.any(Number),
  });
  expect(payload.frameContext === null || typeof payload.frameContext === 'object').toBe(true);
  expect(payload.pageProjection).toMatchObject({
    projectionId: expect.any(String),
    projectionKind: 'read_snapshot_projection',
    projectionCreatedAt: expect.any(String),
    sourceObservedAt: expect.any(String),
    sourceLineage: expect.any(String),
    regionEvidenceRefs: expect.any(Array),
    pageId: expect.any(String),
    tabId: expect.any(Number),
    ownerType: 'unknown',
    readiness: expect.any(String),
    stability: expect.stringMatching(/^(stable|loading|changing|stale|unknown)$/),
    chosenDataSource: expect.any(String),
    sourceFreshness: 'fresh',
    interferenceRisk: 'medium',
  });
  expect(payload.tabId).toBe(payload.pageProjection.tabId);
  expect(['none', 'active', 'recent_input', 'unknown']).toContain(
    payload.pageProjection.userActivityLevel,
  );
  expect(payload.currentWindowId).toEqual(expect.any(Number));
  expect(payload.isCurrentTabActive).toEqual(expect.any(Boolean));
  expect([true, false, null]).toContain(payload.isCurrentWindowFocused);
  expect(Date.parse(payload.pageProjection.projectionCreatedAt)).not.toBeNaN();
  expect(Date.parse(payload.pageProjection.sourceObservedAt)).not.toBeNaN();
  expect(payload.pageProjection.interferenceRisk).not.toBe('none');
  expect(payload.watchScope).toMatchObject({
    scopeKind: expect.stringMatching(
      /^(search|form|auth|challenge|long_content|multi_tab|error_recovery|user_takeover|loading|idle|unknown)$/,
    ),
    boundary: {
      deterministicGuidanceOnly: true,
      realBrowserProven: false,
      commercialGradeProven: false,
    },
  });
  expect(Array.isArray(payload.watchScope.regions)).toBe(true);
  // B-011: historyRef is now populated with `read://<host>/<role>/<sha8>` whenever
  // the snapshot has a URL. Degraded paths (e.g. unsupported pages) keep null.
  if (payload.historyRef !== null) {
    expect(typeof payload.historyRef).toBe('string');
    expect(payload.historyRef).toMatch(/^read:\/\/[^/]+\/[^/]+\/[0-9a-f]{8}$/);
  }
  expect(Array.isArray(payload.memoryHints)).toBe(true);
  expect(payload.taskMode).toEqual(expect.any(String));
  expect(payload.complexityLevel).toEqual(expect.any(String));
  expect(payload.sourceKind).toEqual(expect.any(String));
  expect(Array.isArray(payload.highValueObjects)).toBe(true);
  expect(payload.L0).toMatchObject({
    summary: expect.any(String),
    taskMode: expect.any(String),
    pageRole: expect.any(String),
  });
  expect(payload.L1).toMatchObject({
    overview: expect.any(String),
    highValueObjectIds: expect.any(Array),
    candidateActionIds: expect.any(Array),
  });
}

describe('read_page mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (readPageTool as any).__resetObjectLifecycleCacheForTests?.();
    if (!chrome.windows) {
      (chrome as any).windows = {
        get: vi.fn().mockResolvedValue({ id: 1, focused: true }),
      };
    } else {
      (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    }
  });

  it('returns an error for unsupported mode values', async () => {
    const result = await readPageTool.execute({ mode: 'invalid' as any });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'mode must be one of compact | normal | full',
    );
  });

  it('does not fall back to the active tab when an explicit tabId is missing', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue(null);
    const activeSpy = vi
      .spyOn(readPageTool as any, 'getActiveTabOrThrowInWindow')
      .mockResolvedValue({
        id: 5209,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'https://example.com/active-tab',
        title: 'Wrong active tab',
      });

    const result = await readPageTool.execute({ tabId: 5208, mode: 'compact' });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'requested tabId 5208 was not found',
    );
    expect(activeSpy).not.toHaveBeenCalled();
  });

  it('defaults mode to compact', async () => {
    vi.spyOn(browserWorldInventory, 'getBrowserWorldSnapshot').mockResolvedValue({
      summary: {
        primaryConclusion: 'primary-summary-that-should-not-flow-into-routing-field',
        routingDecisionSummary:
          'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
        objectChangeSummary: 'Object change summary: no relevant browser object change observed.',
        actionableObjectChangeSummary:
          'Actionable object change: no actionable browser object transition observed.',
        currentOperationConclusion:
          'Current operation conclusion: browser object state is stable enough for page-level inspection.',
      },
      tabs: [],
    } as any);
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5201,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/checkout',
      title: 'Checkout',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Checkout" [ref=ref_0] (x=640,y=300)\n  - textbox "Email" [ref=ref_1] (x=600,y=260)\n  - textbox "Card number" [ref=ref_2] (x=600,y=300)\n  - button "Submit order" [ref=ref_3] (x=600,y=340)\n  - link "Back to cart" [ref=ref_4] (x=500,y=340)\n- heading "Checkout" [ref=ref_5] (x=320,y=100)\n- generic "Secure payment" [ref=ref_6] (x=320,y=140)\n- generic "Order summary" [ref=ref_7] (x=900,y=220)\n- generic "Terms" [ref=ref_8] (x=300,y=520)\n- generic "Footer" [ref=ref_9] (x=300,y=560)',
      refMap: [
        { ref: 'ref_1', selector: '#email' },
        { ref: 'ref_2', selector: '#card-number' },
        { ref: 'ref_3', selector: 'button[type=submit]' },
      ],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({});
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.observationProfile).toBe('task');
    expect(payload.L2 ?? null).toBeNull();
    expect(payload.coverage.overall).toMatch(/^(degraded|visible_unresolved|covered)$/);
    expect(payload.evidenceSource).toEqual(expect.arrayContaining(['ax', 'dom']));
    expect(payload.page).toMatchObject({
      url: 'https://example.com/checkout',
      title: 'Checkout',
      pageType: 'web_page',
    });
    expect(payload.summary).toMatchObject({
      quality: 'usable',
    });
    expect(payload.taskMode).toBe('read');
    expect(payload.sourceKind).toBe('dom_semantic');
    expect(Array.isArray(payload.interactiveElements)).toBe(true);
    expect(Array.isArray(payload.artifactRefs)).toBe(true);
    expect(payload.artifactRefs[0].kind).toBe('dom_snapshot');
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(payload.candidateActions.length).toBeGreaterThan(0);
    expect(payload.candidateActions[0]).toMatchObject({
      id: expect.any(String),
      actionType: expect.any(String),
      targetRef: expect.any(String),
      confidence: expect.any(Number),
      matchReason: expect.any(String),
      locatorChain: expect.any(Array),
    });
    expect(payload.candidateActions[0].locatorChain[0]).toMatchObject({
      type: expect.any(String),
      value: expect.any(String),
    });
    expect(payload.ownershipRuntime).toMatchObject({
      currentTabId: 5201,
      currentTabUrl: 'https://example.com/checkout',
      currentTabTitle: 'Checkout',
      currentTabRuntimeStateSource: expect.any(String),
      browserWorldObjectChangeSummary: expect.stringContaining('Object change summary:'),
      browserWorldActionableObjectChangeSummary: expect.stringContaining(
        'Actionable object change:',
      ),
      browserWorldCurrentOperationConclusion: expect.any(String),
      browserWorldRoutingDecisionSummary:
        'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
    });
    expect(payload.ownershipRuntime.browserWorldRoutingDecisionSummary).not.toBe(
      'primary-summary-that-should-not-flow-into-routing-field',
    );
    expect(payload.browserPageObjectCompact.facts.tab).toMatchObject({
      objectKind: 'BrowserTabObject',
      currentTabId: 5201,
      currentTabUrl: 'https://example.com/checkout',
      currentTabTitle: 'Checkout',
      runtimeStateSource: expect.any(String),
      browserWorldObjectChangeSummary: expect.stringContaining('Object change summary:'),
      browserWorldActionableObjectChangeSummary: expect.stringContaining(
        'Actionable object change:',
      ),
      browserWorldCurrentOperationConclusion: expect.any(String),
      browserWorldRoutingDecisionSummary:
        'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
      actionReadiness: 'reselect_or_reread_required',
      canProceedToPageLevelCheck: false,
      requiredBeforeAction: 'refresh_browser_object_snapshot',
    });
    expect(payload.pageProjection.userActivityLevel).toBe('active');
    expect(payload.diagnostics).toBeUndefined();
    expect(payload.fullSnapshot).toBeUndefined();
  });

  it('surfaces the responding frame context from the accessibility-tree snapshot', async () => {
    vi.spyOn(browserWorldInventory, 'getBrowserWorldSnapshot').mockResolvedValue({
      summary: {
        routingDecisionSummary:
          'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
        objectChangeSummary: 'Object change summary: no relevant browser object change observed.',
        actionableObjectChangeSummary:
          'Actionable object change: no actionable browser object transition observed.',
        currentOperationConclusion:
          'Current operation conclusion: browser object state is stable enough for page-level inspection.',
      },
      tabs: [],
    } as any);
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5217,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/embedded',
      title: 'Embedded App',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Embedded App" [ref=ref_0] (x=320,y=100)',
        '  - heading "Inner checkout" [ref=ref_1] (x=320,y=140)',
        '  - button "Continue" [ref=ref_2] (x=320,y=180)',
        '  - link "Help" [ref=ref_3] (x=320,y=220)',
        '  - generic "Summary" [ref=ref_4] (x=320,y=260)',
        '  - generic "Footer" [ref=ref_5] (x=320,y=300)',
        '  - generic "Status" [ref=ref_6] (x=320,y=340)',
        '  - generic "Total" [ref=ref_7] (x=320,y=380)',
        '  - generic "Notice" [ref=ref_8] (x=320,y=420)',
        '  - generic "Controls" [ref=ref_9] (x=320,y=460)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: '#continue' },
        { ref: 'ref_3', selector: '#help' },
        { ref: 'ref_9', selector: '#controls' },
      ],
      frameContext: {
        frameUrl: 'https://example.com/embed/checkout',
        frameName: 'checkout-frame',
        frameScope: 'subframe',
        isTopFrame: false,
        source: 'content_script_runtime',
        coverage: 'responding_frame_only',
        claimBoundary:
          'this read_page snapshot describes the frame that answered the content-script request; it does not prove every iframe was fully covered',
      },
      stats: { processed: 8, included: 6, durationMs: 10 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ frameId: 37 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      5217,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
      }),
      37,
    );
    expect(payload.frameContext).toMatchObject({
      frameId: 37,
      frameUrl: 'https://example.com/embed/checkout',
      frameName: 'checkout-frame',
      frameScope: 'subframe',
      isTopFrame: false,
      source: 'content_script_runtime',
      coverage: 'responding_frame_only',
      claimBoundary: expect.stringContaining('does not prove every iframe was fully covered'),
    });
    expect(
      payload.candidateActions.find((action: any) => action.targetRef === 'ref_2'),
    ).toMatchObject({
      frameId: 37,
    });
    expect(payload.coverage.iframe).toBe('covered');
  });

  it('surfaces read-only file input bindings without claiming upload success', async () => {
    vi.spyOn(browserWorldInventory, 'getBrowserWorldSnapshot').mockResolvedValue({
      summary: {
        routingDecisionSummary:
          'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
        objectChangeSummary: 'Object change summary: no relevant browser object change observed.',
        actionableObjectChangeSummary:
          'Actionable object change: no actionable browser object transition observed.',
        currentOperationConclusion:
          'Current operation conclusion: browser object state is stable enough for page-level inspection.',
      },
      tabs: [],
    } as any);
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5237,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/publish',
      title: 'Publish',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- form "Publish" [ref=ref_0] (x=640,y=300)',
        '  - button "Upload image" [ref=ref_1] (x=600,y=260)',
        '  - textbox "Title" [ref=ref_2] (x=600,y=300)',
        '  - textbox "Body" [ref=ref_3] (x=600,y=340)',
        '  - button "Save draft" [ref=ref_4] (x=600,y=380)',
        '  - link "Back" [ref=ref_5] (x=500,y=420)',
        '- heading "Publish" [ref=ref_6] (x=320,y=100)',
        '- generic "Upload requirements" [ref=ref_7] (x=320,y=140)',
        '- generic "Preview" [ref=ref_8] (x=900,y=220)',
        '- generic "Footer" [ref=ref_9] (x=300,y=560)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_1', selector: '.upload-trigger' },
        { ref: 'ref_2', selector: 'input[name=title]' },
        { ref: 'ref_3', selector: 'textarea[name=body]' },
      ],
      stats: { processed: 10, included: 10, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });
    vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([
      {
        result: [
          {
            selector: 'input[type="file"][name="images"]',
            accept: 'image/png,image/jpeg',
            multiple: true,
            disabled: false,
            visible: false,
          },
        ],
      },
    ] as any);

    const result = await readPageTool.execute({});
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.L2 ?? null).toBeNull();
    expect(payload.fileInputBindings).toEqual([
      expect.objectContaining({
        selector: 'input[type="file"][name="images"]',
        accept: 'image/png,image/jpeg',
        multiple: true,
        disabled: false,
        visible: false,
        bindingSource: 'dom_input_type_file',
        nextRequiredTool: 'chrome_upload_file',
        nextRequiredCheck:
          'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
        claimBoundary: expect.stringContaining('does not prove upload authorization'),
      }),
    ]);
    expect(payload.publishFormReadiness).toMatchObject({
      status: 'not_ready_candidate',
      businessSuccessProven: false,
      nextRequiredTool: 'chrome_upload_file',
      nextRequiredSelector: 'input[type="file"][name="images"]',
      nextRequiredCheck:
        'complete_required_fields_then_run_fresh_same_tab_read_before_publish_submit',
      claimBoundary: expect.stringContaining('does not prove upload execution'),
    });
    expect(payload.publishFormReadiness.requiredFields).toEqual([
      expect.objectContaining({
        field: 'media',
        status: 'not_proven',
        evidenceSource: 'file_input_binding',
        selector: 'input[type="file"][name="images"]',
        nextRequiredTool: 'chrome_upload_file',
      }),
      expect.objectContaining({
        field: 'title',
        status: 'not_proven',
        targetRef: 'ref_2',
      }),
      expect.objectContaining({
        field: 'body_or_description',
        status: 'not_proven',
        targetRef: 'ref_3',
      }),
    ]);
    expect(payload.publishFormReadiness.blockingReasons).toEqual(
      expect.arrayContaining([
        'media:not_proven',
        'title:not_proven',
        'body_or_description:not_proven',
      ]),
    );
    expect(payload.pageRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionType: 'form',
          state: 'publish_not_ready_candidate',
          readiness: 'not_ready_candidate',
          readinessBlockingReasons: expect.arrayContaining([
            'media:not_proven',
            'title:not_proven',
            'body_or_description:not_proven',
          ]),
          nextRequiredTool: 'chrome_upload_file',
          nextRequiredSelector: 'input[type="file"][name="images"]',
          nextRequiredCheck:
            'complete_required_fields_then_run_fresh_same_tab_read_before_publish_submit',
        }),
      ]),
    );
    expect(payload.pageOperationMap.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          zoneId: 'zone_form',
          regionType: 'form',
          state: 'publish_not_ready_candidate',
          readiness: 'needs_expand',
          regionReadiness: 'not_ready_candidate',
          readinessBlockingReasons: expect.arrayContaining([
            'media:not_proven',
            'title:not_proven',
            'body_or_description:not_proven',
          ]),
          nextRequiredTool: 'chrome_upload_file',
          nextRequiredSelector: 'input[type="file"][name="images"]',
          nextRequiredCheck:
            'complete_required_fields_then_run_fresh_same_tab_read_before_publish_submit',
        }),
      ]),
    );
    expect(payload.browserPageObjectCompact.operationSummary).toContain(
      'Publish readiness: not_ready_candidate',
    );
    expect(payload.browserPageObjectCompact.operationSummary).toContain(
      'businessSuccessProven=false',
    );
    expect(payload.browserPageObjectCompact.primaryConclusion).toContain(
      'Publish readiness: not_ready_candidate',
    );
  });

  it('marks task-cropped requested layers with the task observation profile', async () => {
    vi.spyOn(browserWorldInventory, 'getBrowserWorldSnapshot').mockResolvedValue({
      summary: {
        routingDecisionSummary:
          'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
        objectChangeSummary: 'Object change summary: no relevant browser object change observed.',
        actionableObjectChangeSummary:
          'Actionable object change: no actionable browser object transition observed.',
        currentOperationConclusion:
          'Current operation conclusion: browser object state is stable enough for page-level inspection.',
      },
      tabs: [],
    } as any);
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5226,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/task-view',
      title: 'Task View',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Task View" [ref=ref_main] (x=320,y=100)',
        '  - heading "Task View" [ref=ref_heading] (x=320,y=140)',
        '  - button "Open filters" [ref=ref_filter] (x=320,y=180)',
        '  - link "First item" [ref=ref_item] (x=320,y=220)',
        '  - article "Result card" [ref=ref_card] (x=320,y=260)',
        '    - link "Second item" [ref=ref_second] (x=320,y=300)',
        '    - generic "Updated today" [ref=ref_meta] (x=320,y=340)',
        '  - generic "Status ready" [ref=ref_status] (x=320,y=380)',
        '  - generic "Footer" [ref=ref_footer] (x=320,y=700)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_filter', selector: 'button.filters' },
        { ref: 'ref_item', selector: 'a.item' },
        { ref: 'ref_second', selector: 'a.second-item' },
      ],
      stats: { processed: 9, included: 9, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ requestedLayer: 'L0' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.observationProfile).toBe('task');
    expect(payload.L0).toBeDefined();
    expect(payload.L1).toBeUndefined();
    expect(payload.L2).toBeUndefined();
  });

  it.each(['normal', 'full'] as const)(
    'preserves BrowserWorld routing summary in %s read_page output',
    async (mode) => {
      vi.spyOn(browserWorldInventory, 'getBrowserWorldSnapshot').mockResolvedValue({
        summary: {
          primaryConclusion: 'primary-summary-that-should-not-flow-into-routing-field',
          routingDecisionSummary:
            'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
          objectChangeSummary: 'Object change summary: no relevant browser object change observed.',
          actionableObjectChangeSummary:
            'Actionable object change: no actionable browser object transition observed.',
          currentOperationConclusion:
            'Current operation conclusion: browser object state is stable enough for page-level inspection.',
        },
        tabs: [],
      } as any);
      vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
        id: 5202,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'https://example.com/checkout',
        title: 'Checkout',
      });
      vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
      vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
        success: true,
        pageContent:
          '- form "Checkout" [ref=ref_0] (x=640,y=300)\n  - textbox "Email" [ref=ref_1] (x=600,y=260)\n  - textbox "Card number" [ref=ref_2] (x=600,y=300)\n  - button "Submit order" [ref=ref_3] (x=600,y=340)\n  - link "Back to cart" [ref=ref_4] (x=500,y=340)\n- heading "Checkout" [ref=ref_5] (x=320,y=100)\n- generic "Secure payment" [ref=ref_6] (x=320,y=140)\n- generic "Order summary" [ref=ref_7] (x=900,y=220)\n- generic "Terms" [ref=ref_8] (x=300,y=520)\n- generic "Footer" [ref=ref_9] (x=300,y=560)',
        refMap: [
          { ref: 'ref_1', selector: '#email' },
          { ref: 'ref_2', selector: '#card-number' },
          { ref: 'ref_3', selector: 'button[type=submit]' },
        ],
        stats: { processed: 12, included: 8, durationMs: 11 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      });

      const result = await readPageTool.execute({ mode });
      const payload = JSON.parse((result.content[0] as { text: string }).text);

      expect(result.isError).toBe(false);
      expectCommonSnapshotShape(payload, mode);
      expect(payload.observationProfile).toBe(mode === 'normal' ? 'debug' : 'full');
      expect(payload.ownershipRuntime.browserWorldRoutingDecisionSummary).toBe(
        'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
      );
      expect(payload.ownershipRuntime.browserWorldRoutingDecisionSummary).not.toBe(
        'primary-summary-that-should-not-flow-into-routing-field',
      );
      expect(payload.browserPageObjectCompact.facts.tab.browserWorldRoutingDecisionSummary).toBe(
        'routing=ready_for_page_level_check, blockingReason=none, next=page_level_content_or_postcondition_check',
      );
      expect(payload.browserPageObjectCompact.claimBoundary).toContain('candidate evidence only');
    },
  );

  it('preserves recovered text menu targets when the accessibility snapshot already has enough actions', () => {
    const elements = buildInteractiveElements(
      [
        '- button "Home" [ref=ref_home] (x=40,y=40)',
        '- button "Search" [ref=ref_search] (x=40,y=80)',
        '- button "Messages" [ref=ref_messages] (x=40,y=120)',
        '- button "Profile" [ref=ref_profile] (x=40,y=160)',
      ].join('\n'),
      [
        {
          ref: 'ref_text_menu_more',
          text: 'More',
          role: 'button',
          selector: '[data-menu-more]',
          isInteractive: true,
        },
      ],
      8,
      'full',
      'https://example.com/app',
    );

    expect(elements.map((element) => element.ref)).toContain('ref_text_menu_more');
  });

  it('preserves recovered dynamic surface targets when compact actions are already dense', () => {
    const elements = buildInteractiveElements(
      Array.from(
        { length: 24 },
        (_item, index) => `- button "Toolbar ${index}" [ref=ref_toolbar_${index}] (x=40,y=40)`,
      ).join('\n'),
      [
        {
          ref: 'ref_dynamic_surface_9',
          text: 'Past week',
          role: 'button',
          selector: '[data-surface-option="week"]',
          isInteractive: true,
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        },
      ],
      8,
      'compact',
      'https://example.com/app',
    );

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'ref_dynamic_surface_9',
          name: 'Past week',
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        }),
      ]),
    );
  });

  it('preserves privacy-safe input value state without exposing raw values', () => {
    const elements = buildInteractiveElements(
      [
        '- searchbox "Search" [ref=ref_search] valueState="non_empty"',
        '- textbox "Comment" [ref=ref_comment] value-state="empty"',
      ].join('\n'),
      [
        {
          ref: 'ref_fallback_filter',
          text: 'Filter',
          role: 'input',
          selector: '[data-filter]',
          isInteractive: true,
          valueState: 'non_empty',
        },
      ],
      8,
      'full',
      'https://example.com/app',
    );

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_search', valueState: 'non_empty' }),
        expect.objectContaining({ ref: 'ref_comment', valueState: 'empty' }),
        expect.objectContaining({ ref: 'ref_fallback_filter', valueState: 'non_empty' }),
      ]),
    );
  });

  it('formats fallback value state as a redacted state only', () => {
    const refMap = buildFallbackRefMap([
      {
        selector: '[data-search]',
        text: 'Search',
        type: 'input',
        valueState: 'non_empty',
        value: 'private search text',
      },
    ]);
    const pageContent = formatElementsAsPageContent(
      [
        {
          selector: '[data-search]',
          text: 'Search',
          type: 'input',
          valueState: 'non_empty',
          value: 'private search text',
        },
      ],
      refMap,
    );

    expect(refMap[0]).toMatchObject({ valueState: 'non_empty' });
    expect(pageContent).toContain('valueState="non_empty"');
    expect(pageContent).not.toContain('private search text');
  });

  it('recovers target refs for visible text menu labels that exist only as non-targetable text', async () => {
    const collectInteractiveElementsFallback = vi
      .spyOn(readPageTool as any, 'collectInteractiveElementsFallback')
      .mockImplementation(async (_tabId: number, options: { textQuery?: string }) => {
        if (options.textQuery === '退出登录') {
          return {
            success: true,
            elements: [
              {
                type: 'text',
                selector:
                  'body > main > nav > div:nth-of-type(7) > div > div:nth-of-type(3) > span',
                text: '退出登录',
                isInteractive: true,
                coordinates: {
                  x: 64,
                  y: 620,
                  rect: { x: 32, y: 610, width: 64, height: 18 },
                },
              },
            ],
          };
        }
        if (options.textQuery !== '更多') return { success: true, elements: [] };
        return {
          success: true,
          elements: [
            {
              type: 'text',
              selector: 'body > main > nav > div:nth-of-type(7) > span',
              text: '更多',
              isInteractive: true,
              coordinates: {
                x: 84,
                y: 806,
                rect: { x: 68, y: 796, width: 32, height: 18 },
              },
            },
          ],
        };
      });
    const basePayload: any = {
      visibleTextContent: [
        '首页',
        '点点',
        'ai',
        '直播',
        '发布',
        '消息',
        '我',
        '点点 ai',
        '更多',
        '帮助与客服',
        '设置',
        '退出登录',
        '关于我们',
      ].join('\n'),
      elements: [
        { text: '更多' },
        ...Array.from({ length: 150 }, (_item, index) => ({ text: `Content ${index}` })),
      ],
      refMap: Array.from({ length: 150 }, (_item, index) => ({
        ref: `ref_existing_${index}`,
        selector: `[data-content="${index}"]`,
      })),
      count: 151,
    };

    const recovered = await (readPageTool as any).recoverGlobalMenuTextTargets({
      tabId: 5218,
      basePayload,
    });

    expect(recovered).toBe(true);
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5218,
      expect.objectContaining({ textQuery: '更多' }),
    );
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5218,
      expect.objectContaining({ textQuery: '退出登录' }),
    );
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_menu_/),
          role: 'button',
          selector: 'body > main > nav > div:nth-of-type(7)',
          text: '更多',
        }),
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_menu_/),
          role: 'button',
          selector: 'body > main > nav > div:nth-of-type(7) > div > div:nth-of-type(3)',
          text: '退出登录',
        }),
      ]),
    );
    expect(basePayload.elements[0]).toMatchObject({
      selector: 'body > main > nav > div:nth-of-type(7)',
      text: '更多',
    });
  });

  it('recovers target refs for visible search toolbar labels in neutral search pages', async () => {
    const bindScript = vi
      .spyOn(chrome.scripting, 'executeScript')
      .mockResolvedValue([{ result: { bound: 5 } }] as any);
    const collectInteractiveElementsFallback = vi
      .spyOn(readPageTool as any, 'collectInteractiveElementsFallback')
      .mockImplementation(async (_tabId: number, options: { textQuery?: string }) => {
        const selectors: Record<string, string> = {
          全部: 'body > main > div.toolbar > span:nth-of-type(1)',
          图文: 'body > main > div.toolbar > span:nth-of-type(2)',
          视频: 'body > main > div.toolbar > span:nth-of-type(3)',
          用户: 'body > main > div.toolbar > span:nth-of-type(4)',
          筛选: 'body > main > div.toolbar > span:nth-of-type(5)',
        };
        const selector = options.textQuery ? selectors[options.textQuery] : undefined;
        if (!selector) return { success: true, elements: [] };
        return {
          success: true,
          elements: [
            {
              type: 'text',
              role: options.textQuery === '筛选' ? 'button' : 'tab',
              selector,
              text: options.textQuery,
              isInteractive: true,
              coordinates: {
                x: 100,
                y: 88,
                rect: { x: 80, y: 72, width: 48, height: 32 },
              },
            },
          ],
        };
      });
    const basePayload: any = {
      visibleTextContent: ['全部 图文 视频 用户', '筛选'].join('\n'),
      elements: [],
      refMap: [],
      count: 0,
    };

    const recovered = await (readPageTool as any).recoverSearchToolbarTextTargets({
      tabId: 5220,
      basePayload,
      assistantGuidance: {
        taskKind: 'search',
        requestedObjects: ['search_input', 'result_cards'],
      },
      frameId: 7,
    });

    expect(recovered).toBe(true);
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5220,
      expect.objectContaining({ textQuery: '筛选', includeCoordinates: true, frameId: 7 }),
    );
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_search_toolbar_/),
          role: 'button',
          type: 'button',
          selector: 'body > main > div.toolbar > span:nth-of-type(5)',
          text: '筛选',
        }),
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_search_toolbar_/),
          role: 'tab',
          type: 'button',
          text: '图文',
        }),
      ]),
    );
    expect(basePayload.fallbackSource).toBe('search_toolbar_target_recovery');
    expect(bindScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 5220, frameIds: [7] },
        world: 'ISOLATED',
        args: [
          expect.arrayContaining([
            expect.objectContaining({
              ref: expect.stringMatching(/^ref_text_search_toolbar_/),
              selector: 'body > main > div.toolbar > span:nth-of-type(5)',
            }),
          ]),
        ],
      }),
    );

    const interactiveElements = buildInteractiveElements(
      formatElementsAsPageContent(basePayload.elements, basePayload.refMap),
      basePayload.elements,
      20,
      'normal',
      'https://example.com/search?q=neutral',
    );
    const actions = buildCandidateActions(interactiveElements, basePayload.refMap, {
      frameId: 7,
    });

    expect(actions.find((action) => action.targetRef.endsWith('_5'))).toMatchObject({
      intent: 'filter.open',
      frameId: 7,
      locatorChain: expect.arrayContaining([
        { type: 'aria', value: '筛选' },
        { type: 'css', value: 'body > main > div.toolbar > span:nth-of-type(5)' },
      ]),
    });
    expect(
      actions.find((action) => action.locatorChain.some((item) => item.value === '图文')),
    ).toMatchObject({
      intent: 'search.category_select',
      frameId: 7,
    });
  });

  it('recovers short visible text controls without requiring screenshots or coordinates first', async () => {
    const bindScript = vi
      .spyOn(chrome.scripting, 'executeScript')
      .mockResolvedValue([{ result: { bound: 1 } }] as any);
    const collectInteractiveElementsFallback = vi
      .spyOn(readPageTool as any, 'collectInteractiveElementsFallback')
      .mockImplementation(async (_tabId: number, options: { textQuery?: string }) => {
        if (options.textQuery !== '上传图文') return { success: true, elements: [] };
        return {
          success: true,
          elements: [
            {
              type: 'text',
              role: 'tab',
              selector: 'body > main > div.creator-tabs > span.title',
              text: '上传图文',
              isInteractive: true,
              coordinates: {
                x: 188,
                y: 92,
                rect: { x: 148, y: 72, width: 80, height: 32 },
              },
            },
          ],
        };
      });
    const basePayload: any = {
      visibleTextContent: ['上传视频', '上传图文', '支持上传的图片大小，', '发布笔记'].join('\n'),
      elements: [],
      refMap: [],
      count: 0,
    };

    const recovered = await (readPageTool as any).recoverVisibleTextControlTargets({
      tabId: 5331,
      basePayload,
      frameId: 11,
    });

    expect(recovered).toBe(true);
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5331,
      expect.objectContaining({ textQuery: '上传图文', includeCoordinates: true, frameId: 11 }),
    );
    expect(collectInteractiveElementsFallback).not.toHaveBeenCalledWith(
      5331,
      expect.objectContaining({ textQuery: '支持上传的图片大小，' }),
    );
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_control_/),
          role: 'tab',
          type: 'button',
          selector: 'body > main > div.creator-tabs > span.title',
          text: '上传图文',
        }),
      ]),
    );
    expect(basePayload.fallbackSource).toBe('visible_text_control_recovery');
    expect(bindScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 5331, frameIds: [11] },
        world: 'ISOLATED',
        args: [
          expect.arrayContaining([
            expect.objectContaining({
              ref: expect.stringMatching(/^ref_text_control_/),
              selector: 'body > main > div.creator-tabs > span.title',
            }),
          ]),
        ],
      }),
    );

    const interactiveElements = buildInteractiveElements(
      formatElementsAsPageContent(basePayload.elements, basePayload.refMap),
      basePayload.elements,
      20,
      'normal',
      'https://example.com/create',
    );
    const actions = buildCandidateActions(interactiveElements, basePayload.refMap, {
      frameId: 11,
    });

    expect(
      actions.find((action) => action.targetRef.startsWith('ref_text_control_')),
    ).toMatchObject({
      actionType: 'click',
      frameId: 11,
      locatorChain: expect.arrayContaining([
        { type: 'aria', value: '上传图文' },
        { type: 'css', value: 'body > main > div.creator-tabs > span.title' },
      ]),
    });
  });

  it('keeps recovered visible text controls actionable when the page already has navigation controls', () => {
    const pageContent = [
      '- button "首页" [ref=ref_1]',
      '- button "笔记管理" [ref=ref_2]',
      '- button "数据看板" [ref=ref_3]',
      '- button "上传视频" [ref=ref_4]',
    ].join('\n');
    const fallbackElements = [
      {
        ref: 'ref_text_control_5',
        role: 'tab',
        type: 'button',
        selector: 'body > main > div.creator-tabs > span:nth-of-type(2)',
        text: '上传图文',
        name: '上传图文',
        isInteractive: true,
        actionability: 'actionable',
      },
    ];
    const refMap = [
      {
        ref: 'ref_text_control_5',
        selector: 'body > main > div.creator-tabs > span:nth-of-type(2)',
      },
    ];

    const interactiveElements = buildInteractiveElements(
      pageContent,
      fallbackElements,
      20,
      'normal',
      'https://creator.example/publish',
    );
    const actions = buildCandidateActions(interactiveElements, refMap);

    expect(interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'ref_text_control_5',
          role: 'tab',
          name: '上传图文',
        }),
      ]),
    );
    expect(actions.find((action) => action.targetRef === 'ref_text_control_5')).toMatchObject({
      actionType: 'click',
      confidence: 0.93,
      locatorChain: expect.arrayContaining([
        { type: 'aria', value: '上传图文' },
        { type: 'css', value: 'body > main > div.creator-tabs > span:nth-of-type(2)' },
      ]),
    });
  });

  it('does not treat creator upload and publish controls as a search task', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5290,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://creator.example/publish',
      title: 'Creator Workspace',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Creator workspace" [ref=ref_main] (x=640,y=360)',
        '  - navigation "Creator menu" [ref=ref_nav] (x=120,y=360)',
        '    - button "Home" [ref=ref_home] (x=80,y=160)',
        '    - button "Posts" [ref=ref_posts] (x=80,y=210)',
        '    - button "Analytics" [ref=ref_analytics] (x=80,y=260)',
        '  - tablist "Creation type" [ref=ref_tabs] (x=520,y=96)',
        '    - tab "上传视频" [ref=ref_video] (x=300,y=96)',
        '    - tab "上传图文" [ref=ref_image_text] (x=410,y=96)',
        '  - region "Draft media" [ref=ref_upload_region] (x=820,y=420)',
        '    - button "上传图片，或写文字生成图片" [ref=ref_upload_prompt] (x=860,y=420)',
        '    - button "上传图片" [ref=ref_upload_image] (x=840,y=470)',
        '    - button "文字配图" [ref=ref_generate_image] (x=980,y=470)',
        '  - button "发布笔记" [ref=ref_publish] (x=88,y=90)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_video', selector: '[data-tab="video"]' },
        { ref: 'ref_image_text', selector: '[data-tab="image-text"]' },
        { ref: 'ref_upload_prompt', selector: '[data-upload-prompt]' },
        { ref: 'ref_upload_image', selector: 'button.upload-image' },
        { ref: 'ref_generate_image', selector: 'button.generate-image' },
        { ref: 'ref_publish', selector: 'button.publish' },
      ],
      stats: { processed: 13, included: 13, durationMs: 8 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'normal' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'normal');
    expect(payload.summary).toMatchObject({
      pageRole: 'publish_form',
      primaryRegion: 'form',
    });
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '上传图文' }),
        expect.objectContaining({ name: '上传图片' }),
        expect.objectContaining({ name: '发布笔记' }),
      ]),
    );
    expect(payload.taskMode).toBe('read');
    expect(payload.watchScope.scopeKind).toBe('form');
    expect(payload.watchScope.reason).toBe('generic_form_category_match');
  });

  it('classifies sparse generic publish routes as form workflow pages', () => {
    const summary = inferPageUnderstanding(
      'https://creator.example/publish/publish?source=official',
      'Creator publishing platform',
      [
        '- main "Creator publishing platform" [ref=ref_main] (x=640,y=360)',
        '  - button "上传视频" [ref=ref_upload_video] (x=600,y=180)',
      ].join('\n'),
    );

    expect(summary).toMatchObject({
      pageRole: 'publish_form',
      primaryRegion: 'form',
      primaryRegionConfidence: 'medium',
    });
  });

  it('prefers compact search toolbar matches over broad text-query matches', async () => {
    vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([
      { result: { bound: 1 } },
    ] as any);
    vi.spyOn(readPageTool as any, 'collectInteractiveElementsFallback').mockResolvedValue({
      success: true,
      elements: [
        {
          type: 'text',
          role: 'generic',
          selector: 'body > main > section.results > article:nth-of-type(1)',
          text: '如何筛选高价值搜索结果',
          isInteractive: false,
          coordinates: {
            x: 500,
            y: 420,
            rect: { x: 240, y: 360, width: 620, height: 180 },
          },
        },
        {
          type: 'text_action',
          role: 'button',
          selector: 'body > main > div.toolbar > span:nth-of-type(5)',
          text: '筛选',
          isInteractive: true,
          coordinates: {
            x: 100,
            y: 88,
            rect: { x: 80, y: 72, width: 48, height: 32 },
          },
        },
      ],
    });
    const basePayload: any = {
      visibleTextContent:
        'Home Explore Messages Notifications neutral navigation words 全部 图文 视频 用户 筛选',
      elements: [],
      refMap: [],
      count: 0,
    };

    const recovered = await (readPageTool as any).recoverSearchToolbarTextTargets({
      tabId: 5221,
      basePayload,
      assistantGuidance: {
        taskKind: 'search',
        requestedObjects: ['result_cards'],
      },
    });

    expect(recovered).toBe(true);
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: 'body > main > div.toolbar > span:nth-of-type(5)',
          text: '筛选',
          role: 'button',
        }),
      ]),
    );
    expect(basePayload.elements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: 'body > main > section.results > article:nth-of-type(1)',
        }),
      ]),
    );
  });

  it('recovers locator-backed target refs for dynamic filter panel labels', async () => {
    const bindScript = vi
      .spyOn(chrome.scripting, 'executeScript')
      .mockResolvedValue([{ result: { bound: 3 } }] as any);
    const collectInteractiveElementsFallback = vi
      .spyOn(readPageTool as any, 'collectInteractiveElementsFallback')
      .mockImplementation(async (_tabId: number, options: { textQuery?: string }) => {
        const selectors: Record<string, string> = {
          最多收藏: 'body > main > div.filter-panel > div:nth-of-type(1) > div.tags:nth-of-type(5)',
          一天内: 'body > main > div.filter-panel > div:nth-of-type(2) > div.tags:nth-of-type(2)',
          未看过: 'body > main > div.filter-panel > div:nth-of-type(3) > div.tags:nth-of-type(3)',
        };
        const selector = options.textQuery ? selectors[options.textQuery] : undefined;
        if (!selector) return { success: true, elements: [] };
        return {
          success: true,
          elements: [
            {
              type: 'text',
              role: 'generic',
              selector: 'body > main > section.results > article:nth-of-type(1)',
              text: `结果正文也提到了${options.textQuery}`,
              isInteractive: false,
              actionability: 'not_actionable',
              coordinates: {
                x: 500,
                y: 520,
                rect: { x: 240, y: 480, width: 620, height: 180 },
              },
            },
            {
              type: 'text_action',
              role: 'button',
              selector,
              text: options.textQuery,
              isInteractive: true,
              actionability: 'actionable',
              coordinates: {
                x: 980,
                y: 320,
                rect: { x: 940, y: 304, width: 72, height: 32 },
              },
            },
          ],
        };
      });
    const basePayload: any = {
      visibleTextContent:
        '排序依据 综合 最新 最多点赞 最多评论 最多收藏 发布时间 不限 一天内 一周内 半年内 搜索范围 不限 已看过 未看过 已关注 位置距离 不限 同城 附近 重置 收起',
      elements: [],
      refMap: [],
      count: 0,
    };

    const recovered = await (readPageTool as any).recoverFilterPanelTextTargets({
      tabId: 5222,
      basePayload,
      assistantGuidance: {
        taskKind: 'search',
        requestedObjects: ['search_input', 'result_cards'],
      },
      frameId: 7,
    });

    expect(recovered).toBe(true);
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5222,
      expect.objectContaining({ textQuery: '最多收藏', includeCoordinates: true, frameId: 7 }),
    );
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_filter_panel_/),
          role: 'button',
          selector: 'body > main > div.filter-panel > div:nth-of-type(1) > div.tags:nth-of-type(5)',
          text: '最多收藏',
        }),
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_filter_panel_/),
          selector: 'body > main > div.filter-panel > div:nth-of-type(2) > div.tags:nth-of-type(2)',
          text: '一天内',
        }),
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_filter_panel_/),
          selector: 'body > main > div.filter-panel > div:nth-of-type(3) > div.tags:nth-of-type(3)',
          text: '未看过',
        }),
      ]),
    );
    expect(basePayload.elements).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: 'body > main > section.results > article:nth-of-type(1)',
        }),
      ]),
    );
    expect(basePayload.fallbackSource).toBe('filter_panel_target_recovery');
    expect(bindScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 5222, frameIds: [7] },
        world: 'ISOLATED',
        args: [
          expect.arrayContaining([
            expect.objectContaining({
              ref: expect.stringMatching(/^ref_text_filter_panel_/),
              selector:
                'body > main > div.filter-panel > div:nth-of-type(1) > div.tags:nth-of-type(5)',
            }),
          ]),
        ],
      }),
    );

    const interactiveElements = buildInteractiveElements(
      formatElementsAsPageContent(basePayload.elements, basePayload.refMap),
      basePayload.elements,
      20,
      'normal',
      'https://example.com/search?q=neutral',
    );
    const actions = buildCandidateActions(interactiveElements, basePayload.refMap, {
      frameId: 7,
    });

    expect(
      actions.find((action) => action.locatorChain.some((item) => item.value === '最多收藏')),
    ).toMatchObject({
      intent: 'filter.sort_most_collected',
      frameId: 7,
      locatorChain: expect.arrayContaining([
        {
          type: 'css',
          value: 'body > main > div.filter-panel > div:nth-of-type(1) > div.tags:nth-of-type(5)',
        },
      ]),
    });
    expect(
      actions.find((action) => action.locatorChain.some((item) => item.value === '一天内')),
    ).toMatchObject({
      actionType: 'click',
      frameId: 7,
    });
    expect(
      actions.find((action) => action.locatorChain.some((item) => item.value === '未看过')),
    ).toMatchObject({
      actionType: 'click',
      frameId: 7,
    });
  });

  it('recovers open filter panel targets from visible text without assistant guidance', async () => {
    const selectorFor = (label: string) =>
      `body > main > div.filter-panel > div[data-label="${label}"] > span`;
    const collectInteractiveElementsFallback = vi.spyOn(
      readPageTool as any,
      'collectInteractiveElementsFallback',
    );
    collectInteractiveElementsFallback.mockImplementation(async (_tabId, options: any) => ({
      success: true,
      elements: [
        {
          type: 'text_action',
          role: 'button',
          selector: selectorFor(options.textQuery),
          text: options.textQuery,
          isInteractive: true,
          actionability: 'actionable',
          coordinates: {
            x: 960,
            y: 320,
            rect: { x: 930, y: 304, width: 88, height: 32 },
          },
        },
      ],
    }));
    const basePayload: any = {
      visibleTextContent:
        '全部 图文 视频 用户 筛选 排序依据 综合 最新 最多收藏 发布时间 不限 一周内 清除 确认',
      elements: [],
      refMap: [],
      count: 0,
    };

    const recovered = await (readPageTool as any).recoverFilterPanelTextTargets({
      tabId: 5223,
      basePayload,
    });

    expect(recovered).toBe(true);
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5223,
      expect.objectContaining({ textQuery: '最多收藏', includeCoordinates: true }),
    );
    expect(collectInteractiveElementsFallback).toHaveBeenCalledWith(
      5223,
      expect.objectContaining({ textQuery: '一周内', includeCoordinates: true }),
    );
    expect(basePayload.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_filter_panel_/),
          selector: expect.stringContaining('data-label="最多收藏"'),
          text: '最多收藏',
        }),
        expect.objectContaining({
          ref: expect.stringMatching(/^ref_text_filter_panel_/),
          selector: expect.stringContaining('data-label="一周内"'),
          text: '一周内',
        }),
      ]),
    );
    expect(basePayload.fallbackSource).toBe('filter_panel_target_recovery');
  });

  it('keeps recovered text menu actions ahead of long content lists', () => {
    const contentElements = Array.from({ length: 40 }, (_item, index) => ({
      ref: `ref_content_${index}`,
      role: 'link',
      name: `Content card ${index}`,
    }));
    const actions = buildCandidateActions(
      [
        ...contentElements,
        { ref: 'ref_text_menu_more', role: 'button', name: '更多' },
        { ref: 'ref_text_menu_logout', role: 'button', name: '退出登录' },
      ],
      [
        ...contentElements.map((element, index) => ({
          ref: element.ref,
          selector: `[data-card="${index}"]`,
        })),
        { ref: 'ref_text_menu_more', selector: '[data-menu-more]' },
        { ref: 'ref_text_menu_logout', selector: '[data-menu-logout]' },
      ],
    );

    expect(
      actions
        .map((action) => action.targetRef)
        .slice(0, 2)
        .sort(),
    ).toEqual(['ref_text_menu_logout', 'ref_text_menu_more']);
    expect(actions.find((action) => action.targetRef === 'ref_text_menu_more')).toMatchObject({
      actionType: 'click',
      locatorChain: expect.arrayContaining([{ type: 'css', value: '[data-menu-more]' }]),
    });
  });

  it('keeps visible result-row detail actions when generic candidates hit the cap', () => {
    const shellElements = Array.from({ length: 24 }, (_item, index) => ({
      ref: `ref_shell_${index}`,
      role: 'button',
      name: `Confirm ${index}`,
    }));
    const resultElements = [
      {
        ref: 'ref_fallback_25',
        role: 'link',
        name: 'Case study one',
        selector: '[data-result="one"]',
      },
      {
        ref: 'ref_fallback_26',
        role: 'link',
        name: 'Case study two',
        selector: '[data-result="two"]',
      },
    ];

    const actions = buildCandidateActions([...shellElements, ...resultElements], [], {
      visibleRegionRows: {
        visibleRegionRowsUsed: true,
        rowCount: 2,
        targetRefCoverageRate: 0.99,
        extractionSource: 'visible_text',
        quality: 'usable',
        qualityReasons: ['target_ref_available'],
        rows: [
          {
            rowId: 'viewport_visible_text_row_1',
            title: 'Case study one',
            targetRef: 'ref_fallback_25',
            targetRefCoverageRate: 0.99,
            confidence: 0.82,
            qualityReasons: ['target_ref_available'],
          },
          {
            rowId: 'viewport_visible_text_row_2',
            title: 'Case study two',
            targetRef: 'ref_fallback_26',
            targetRefCoverageRate: 0.99,
            confidence: 0.82,
            qualityReasons: ['target_ref_available'],
          },
        ],
      },
    });

    expect(actions).toHaveLength(20);
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_fallback_25',
          intent: 'content.open_detail',
          locatorChain: expect.arrayContaining([
            expect.objectContaining({ type: 'css', value: '[data-result="one"]' }),
          ]),
        }),
        expect.objectContaining({
          targetRef: 'ref_fallback_26',
          intent: 'content.open_detail',
          locatorChain: expect.arrayContaining([
            expect.objectContaining({ type: 'css', value: '[data-result="two"]' }),
          ]),
        }),
      ]),
    );
  });

  it('binds visible result-row detail actions from fallback text targets', () => {
    const elements = [
      {
        ref: 'ref_fallback_1',
        role: 'generic',
        name: 'Case study one',
        selector: '[data-result="one"]',
      },
      {
        ref: 'ref_search',
        role: 'searchbox',
        name: 'Search',
        selector: '[data-search]',
      },
    ];

    const actions = buildCandidateActions(elements, [], {
      visibleRegionRows: {
        visibleRegionRowsUsed: true,
        rowCount: 1,
        targetRefCoverageRate: 0.99,
        extractionSource: 'visible_text',
        quality: 'usable',
        qualityReasons: ['target_ref_available'],
        rows: [
          {
            rowId: 'viewport_visible_text_row_1',
            title: 'Case study one',
            targetRef: 'ref_fallback_1',
            targetRefCoverageRate: 0.99,
            confidence: 0.82,
            qualityReasons: ['target_ref_available'],
          },
        ],
      },
    });

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_fallback_1',
          actionType: 'click',
          intent: 'content.open_detail',
          locatorChain: expect.arrayContaining([
            expect.objectContaining({ type: 'css', value: '[data-result="one"]' }),
          ]),
        }),
      ]),
    );
    expect(actions.find((action) => action.targetRef === 'ref_search')).toMatchObject({
      intent: 'search.enter_query',
    });
  });

  it('binds visible result-row detail actions from trusted row refs missing from interactive elements', () => {
    const actions = buildCandidateActions(
      [
        {
          ref: 'ref_search',
          role: 'searchbox',
          name: 'Search',
          selector: '[data-search]',
        },
      ],
      [{ ref: 'ref_fallback_53', selector: '[data-result="one"]' }],
      {
        visibleRegionRows: {
          visibleRegionRowsUsed: true,
          rowCount: 1,
          targetRefCoverageRate: 0.99,
          extractionSource: 'visible_text',
          quality: 'usable',
          qualityReasons: ['target_ref_available'],
          rows: [
            {
              rowId: 'viewport_visible_text_row_1',
              title: 'Case study one',
              targetRef: 'ref_fallback_53',
              targetRefCoverageRate: 0.99,
              confidence: 0.82,
              qualityReasons: ['target_ref_available'],
            },
          ],
        },
      },
    );

    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_fallback_53',
          actionType: 'click',
          intent: 'content.open_detail',
          locatorChain: [
            { type: 'ref', value: 'ref_fallback_53' },
            { type: 'css', value: '[data-result="one"]' },
          ],
        }),
      ]),
    );
    expect(actions.find((action) => action.targetRef === 'ref_search')).toMatchObject({
      intent: 'search.enter_query',
    });
  });

  it('preserves auth action metadata and emits OTP candidate intents', () => {
    const elements = buildInteractiveElements(
      [
        '- textbox "手机号" [ref=ref_phone] valueState="non_empty" matchSource="placeholder" actionability="actionable"',
        '- textbox "验证码" [ref=ref_code] valueState="empty" matchSource="placeholder" actionability="actionable"',
        '- button "获取验证码" [ref=ref_request] matchSource="visible_text" actionability="actionable"',
        '- checkbox "我已阅读并同意用户协议和隐私政策" [ref=ref_terms] checked="false" matchSource="nearby_text" actionability="actionable"',
        '- button "登录" [ref=ref_login] matchSource="visible_text" actionability="actionable"',
      ].join('\n'),
      [],
      10,
      'full',
      'https://example.test/login',
    );
    const actions = buildCandidateActions(elements, [
      { ref: 'ref_request', selector: '.otp-send' },
      { ref: 'ref_terms', selector: '.terms-check' },
      { ref: 'ref_login', selector: '.login-submit' },
    ]);

    expect(elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'ref_request',
          matchSource: 'visible_text',
          actionability: 'actionable',
        }),
        expect.objectContaining({
          ref: 'ref_terms',
          checked: false,
          matchSource: 'nearby_text',
        }),
      ]),
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_request', intent: 'auth.request_otp' }),
        expect.objectContaining({ targetRef: 'ref_terms', intent: 'auth.accept_terms' }),
        expect.objectContaining({ targetRef: 'ref_login', intent: 'auth.submit_login' }),
      ]),
    );
    const serializedActions = JSON.stringify(actions);
    expect(serializedActions).not.toContain('手机号');
    expect(serializedActions).not.toContain('验证码');
    expect(actions.find((action) => action.targetRef === 'ref_request')).toMatchObject({
      locatorChain: expect.arrayContaining([
        { type: 'ref', value: 'ref_request' },
        { type: 'css', value: '.otp-send' },
      ]),
    });
  });

  it('does not assign auth.request_otp intent to placeholder-only textboxes', () => {
    const elements = buildInteractiveElements(
      '- textbox "获取验证码" [ref=ref_code] valueState="empty" matchSource="placeholder" actionability="actionable"',
      [],
      10,
      'full',
      'https://example.test/login',
    );
    const actions = buildCandidateActions(elements, []);

    expect(actions).toEqual([
      expect.objectContaining({
        targetRef: 'ref_code',
        actionType: 'fill',
      }),
    ]);
    expect(actions[0]).not.toHaveProperty('intent', 'auth.request_otp');
    expect(JSON.stringify(actions[0].locatorChain)).not.toContain('获取验证码');
  });

  it('returns null window focus truth when chrome.windows.get is unavailable', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5202,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/profile',
      title: 'Profile',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockRejectedValue(new Error('windows api unavailable'));
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Profile" [ref=ref_0] (x=640,y=300)\n  - textbox "Display name" [ref=ref_1] (x=600,y=260)\n  - textbox "Email" [ref=ref_2] (x=600,y=300)\n  - button "Save" [ref=ref_3] (x=600,y=340)\n  - link "Security" [ref=ref_4] (x=500,y=340)\n- heading "Profile" [ref=ref_5] (x=320,y=100)\n- generic "Account settings" [ref=ref_6] (x=320,y=140)\n- generic "Sidebar" [ref=ref_7] (x=900,y=220)\n- generic "Footer" [ref=ref_8] (x=300,y=560)',
      refMap: [
        { ref: 'ref_1', selector: '#display-name' },
        { ref: 'ref_2', selector: '#email' },
        { ref: 'ref_3', selector: 'button[type=submit]' },
        { ref: 'ref_4', selector: 'a[href="/security"]' },
      ],
      stats: { processed: 12, included: 8, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.mode).toBe('compact');
    expect(payload.currentWindowId).toBe(1);
    expect(payload.isCurrentTabActive).toBe(true);
    expect(payload.isCurrentWindowFocused).toBeNull();
    expect(payload.pageProjection.userActivityLevel).toBe('unknown');
  });

  it('marks user activity as none when the current tab is not active', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5203,
      windowId: 1,
      active: false,
      status: 'complete',
      url: 'https://example.com/docs',
      title: 'Docs',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const collectInteractiveElementsFallback = vi.spyOn(
      readPageTool as any,
      'collectInteractiveElementsFallback',
    );
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Docs" [ref=ref_0] (x=320,y=100)',
        '  - heading "API reference" [ref=ref_1] (x=320,y=140)',
        '  - link "Get started" [ref=ref_2] (x=320,y=180)',
        '  - link "Quickstart" [ref=ref_3] (x=320,y=220)',
        '  - button "Copy example" [ref=ref_4] (x=320,y=260)',
        '  - generic "Installation" [ref=ref_5] (x=320,y=300)',
        '  - generic "Configuration" [ref=ref_6] (x=320,y=340)',
        '  - generic "Usage" [ref=ref_7] (x=320,y=380)',
        '  - generic "Examples" [ref=ref_8] (x=320,y=420)',
        '  - generic "Footer" [ref=ref_9] (x=320,y=460)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a[href="/get-started"]' },
        { ref: 'ref_3', selector: 'a[href="/quickstart"]' },
        { ref: 'ref_4', selector: 'button.copy-example' },
      ],
      stats: { processed: 10, included: 8, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 5203 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(collectInteractiveElementsFallback).not.toHaveBeenCalled();
    expect(payload.isCurrentTabActive).toBe(false);
    expect(payload.isCurrentWindowFocused).toBe(true);
    expect(payload.pageProjection.userActivityLevel).toBe('none');
    expect(payload.browserPageObjectCompact.facts.tab).toMatchObject({
      objectKind: 'BrowserTabObject',
      currentTabId: 5203,
      isActive: false,
    });
    expect(payload.browserPageObjectCompact.facts.window).toMatchObject({
      objectKind: 'BrowserWindowObject',
      isFocused: true,
      isCurrentWindowFocused: true,
    });
    expect(payload.browserPageObjectCompact.facts.visualReliability).toMatchObject({
      objectKind: 'BrowserVisualReliability',
      isCurrentWindowFocused: true,
      isCurrentTabActive: false,
      visualReliabilityCandidate: false,
      degraded: true,
    });
  });

  it('surfaces minimized and unfocused window state as degraded BrowserWindowObject evidence', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5220,
      windowId: 77,
      active: true,
      status: 'complete',
      url: 'https://example.test/window-state',
      title: 'Window State',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({
      id: 77,
      focused: false,
      state: 'minimized',
      width: 900,
      height: 640,
      left: 12,
      top: 34,
    });
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Window state page" [ref=ref_main] (x=320,y=100)',
        '  - heading "Window state" [ref=ref_heading] (x=320,y=140)',
        '  - button "Open menu" [ref=ref_menu] (x=320,y=180)',
        '  - link "Details" [ref=ref_details] (x=320,y=220)',
        '- footer "Footer" [ref=ref_footer] (x=320,y=680)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_menu', selector: 'button.menu' },
        { ref: 'ref_details', selector: 'a.details' },
        { ref: 'ref_heading', selector: 'h1' },
      ],
      stats: { processed: 5, included: 5, durationMs: 7 },
      viewport: { width: 900, height: 640, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.currentWindowId).toBe(77);
    expect(payload.currentWindowState).toBe('minimized');
    expect(payload.currentWindowWidth).toBe(900);
    expect(payload.currentWindowHeight).toBe(640);
    expect(payload.currentWindowLeft).toBe(12);
    expect(payload.currentWindowTop).toBe(34);
    expect(payload.isCurrentWindowFocused).toBe(false);
    expect(payload.browserPageObjectCompact.facts.window).toMatchObject({
      objectKind: 'BrowserWindowObject',
      currentWindowId: 77,
      currentWindowState: 'minimized',
      isFocused: false,
      isCurrentWindowFocused: false,
      isMinimized: true,
      width: 900,
      height: 640,
    });
    expect(payload.browserPageObjectCompact.facts.visualReliability).toMatchObject({
      objectKind: 'BrowserVisualReliability',
      isCurrentWindowFocused: false,
      isCurrentTabActive: true,
      isWindowMinimized: true,
      visualReliabilityCandidate: false,
      degraded: true,
    });
  });

  it('retries once when the first accessibility tree is sparse and the page hydrates late', async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
        id: 5210,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'https://example.com/search',
        title: 'Search',
      });
      vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
      const send = vi
        .spyOn(readPageTool as any, 'sendMessageToTab')
        .mockResolvedValueOnce({
          success: true,
          pageContent: '- generic "Loading" [ref=ref_loading] (x=640,y=300)',
          refMap: [],
          stats: { processed: 1, included: 1, durationMs: 4 },
          viewport: { width: 1280, height: 720, dpr: 1 },
        })
        .mockResolvedValueOnce({
          success: true,
          pageContent: [
            '- main "Results" [ref=ref_main] (x=620,y=360)',
            '  - article "Result card" [ref=ref_card_1] (x=300,y=240)',
            '    - link "First hydrated result" [ref=ref_card_1_link] (x=300,y=210) href="/items/1"',
            '    - generic "Source One" [ref=ref_card_1_source] (x=300,y=248)',
            '  - article "Result card" [ref=ref_card_2] (x=700,y=250)',
            '    - link "Second hydrated result" [ref=ref_card_2_link] (x=700,y=220) href="/items/2"',
            '    - generic "Source Two" [ref=ref_card_2_source] (x=700,y=258)',
            '    - generic "today" [ref=ref_card_2_meta] (x=700,y=290)',
            '  - article "Result card" [ref=ref_card_3] (x=980,y=250)',
            '    - link "Third hydrated result" [ref=ref_card_3_link] (x=980,y=220) href="/items/3"',
            '    - generic "Source Three" [ref=ref_card_3_source] (x=980,y=258)',
          ].join('\n'),
          refMap: [
            { ref: 'ref_card_1_link', selector: 'a[href="/items/1"]' },
            { ref: 'ref_card_2_link', selector: 'a[href="/items/2"]' },
            { ref: 'ref_card_3_link', selector: 'a[href="/items/3"]' },
          ],
          stats: { processed: 9, included: 7, durationMs: 8 },
          viewport: { width: 1280, height: 720, dpr: 1 },
        });

      const pending = readPageTool.execute({ mode: 'compact' });
      await vi.advanceTimersByTimeAsync(450);
      const result = await pending;
      const payload = JSON.parse((result.content[0] as { text: string }).text);

      expect(result.isError).toBe(false);
      expect(send).toHaveBeenCalledTimes(2);
      expect(payload.visibleRegionRows.visibleRegionRowsUsed).toBe(true);
      expect(payload.visibleRegionRows.rows.map((row: { title: string }) => row.title)).toEqual([
        'First hydrated result',
        'Second hydrated result',
        'Third hydrated result',
      ]);
      expect(payload.pageContext.sparse).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns normal mode diagnostics block', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5203,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/list',
      title: 'List',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- heading "Inventory" [ref=ref_1] (x=200,y=120)\n- textbox "Search" [ref=ref_2] (x=280,y=180)\n- button "Open item" [ref=ref_3] (x=420,y=180)\n- link "Details" [ref=ref_4] (x=520,y=180)\n- generic "Row Item A" [ref=ref_5] (x=280,y=240)\n- generic "Row Item B" [ref=ref_6] (x=280,y=280)\n- generic "Row Item C" [ref=ref_7] (x=280,y=320)\n- generic "Status Ready" [ref=ref_8] (x=280,y=360)\n- generic "Panel" [ref=ref_9] (x=760,y=220)\n- generic "Footer" [ref=ref_10] (x=760,y=520)',
      refMap: [
        { ref: 'ref_2', selector: 'input[name=search]' },
        { ref: 'ref_3', selector: 'button.open-item' },
        { ref: 'ref_4', selector: 'a.details-link' },
      ],
      stats: { processed: 10, included: 8, durationMs: 8 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'normal' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'normal');
    expect(payload.diagnostics).toBeDefined();
    expect(payload.fullSnapshot).toBeUndefined();
  });

  it('maps issue triage pages to search task mode in read_page output', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5204,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/issues',
      title: 'Issues · example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- heading "Issues" [ref=ref_heading] (x=220,y=120)',
        '- textbox "Search Issues" [ref=ref_search] (x=320,y=180)',
        '- combobox "Filter issues" [ref=ref_filter] (x=520,y=180)',
        '- link "Issue entries" [ref=ref_issue_entry] (x=400,y=240)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_search', selector: 'input[aria-label="Search Issues"]' },
        { ref: 'ref_filter', selector: 'button[aria-label="Filter issues"]' },
        { ref: 'ref_issue_entry', selector: 'a[href*="/issues/"]' },
      ],
      stats: { processed: 12, included: 9, durationMs: 10 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary.pageRole).toBe('issues_list');
    expect(payload.summary.primaryRegion).toBe('issues_results');
    expect(payload.taskMode).toBe('search');
  });

  it('maps generic search result rows to search task mode and watch scope', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5205,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Search results for workflow" [ref=ref_main] (x=640,y=370)',
        '  - listitem "Result" [ref=ref_result_1] (x=280,y=160)',
        '    - link "Workflow planning guide for distributed teams" [ref=ref_result_1_link] (x=280,y=150) href="/items/workflow-planning"',
        '    - generic "Practical steps for coordinating browser tasks across reviewers." [ref=ref_result_1_desc] (x=280,y=186)',
        '    - generic "Updated today" [ref=ref_result_1_meta] (x=280,y=224)',
        '  - listitem "Result" [ref=ref_result_2] (x=280,y=270)',
        '    - link "Operations checklist for reliable browser handoffs" [ref=ref_result_2_link] (x=280,y=260) href="/items/browser-handoffs"',
        '    - generic "A field checklist for keeping evidence, ownership, and actions aligned." [ref=ref_result_2_desc] (x=280,y=296)',
        '    - generic "Updated yesterday" [ref=ref_result_2_meta] (x=280,y=334)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_result_1_link', selector: 'a[href="/items/workflow-planning"]' },
        { ref: 'ref_result_2_link', selector: 'a[href="/items/browser-handoffs"]' },
      ],
      stats: { processed: 8, included: 8, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload).toMatchObject({
      taskMode: 'search',
      rowCount: 2,
      visibleRegionRowsUsed: true,
      readinessVerdict: 'ready',
    });
    expect(payload.watchScope.scopeKind).toBe('search');
    expect(payload.visibleRegionRows.rows.map((row: { title: string }) => row.title)).toEqual([
      'Workflow planning guide for distributed teams',
      'Operations checklist for reliable browser handoffs',
    ]);
  });

  it('keeps search scope when result pages include a global publish navigation control', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5209,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search_result?keyword=AIGC',
      title: 'AIGC - 搜索',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "AIGC 搜索结果" [ref=ref_main] (x=640,y=370)',
        '  - navigation "Global navigation" [ref=ref_nav] (x=80,y=300)',
        '    - link "首页" [ref=ref_home] (x=80,y=140) href="/home"',
        '    - link "发布" [ref=ref_publish_nav] (x=80,y=196) href="/publish"',
        '  - listitem "Result" [ref=ref_result_1] (x=420,y=180)',
        '    - link "AIGC prompt workflow examples" [ref=ref_result_1_link] (x=420,y=170) href="/items/aigc-prompt-workflow"',
        '    - generic "Concrete before and after examples for creator workflows." [ref=ref_result_1_desc] (x=420,y=206)',
        '  - listitem "Result" [ref=ref_result_2] (x=420,y=300)',
        '    - link "Creator image generation checklist" [ref=ref_result_2_link] (x=420,y=290) href="/items/image-generation-checklist"',
        '    - generic "A reusable checklist for evaluating generated images." [ref=ref_result_2_desc] (x=420,y=326)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_home', selector: 'a[href="/home"]' },
        { ref: 'ref_publish_nav', selector: 'a[href="/publish"]' },
        { ref: 'ref_result_1_link', selector: 'a[href="/items/aigc-prompt-workflow"]' },
        { ref: 'ref_result_2_link', selector: 'a[href="/items/image-generation-checklist"]' },
      ],
      stats: { processed: 10, included: 10, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload).toMatchObject({
      taskMode: 'search',
      rowCount: 2,
      visibleRegionRowsUsed: true,
      readinessVerdict: 'ready',
    });
    expect(payload.watchScope.scopeKind).toBe('search');
    expect(payload.summary).toMatchObject({
      pageRole: 'search_results',
      primaryRegion: 'search_results',
    });
    expect(payload.pageRegions.map((item: any) => item.regionType)).toEqual(
      expect.arrayContaining(['navigation', 'form', 'content']),
    );
    expect(payload.pageRegions.find((item: any) => item.regionType === 'form')).toMatchObject({
      state: 'input_available_candidate',
      candidateActionIds: expect.arrayContaining([expect.any(String)]),
    });
    const publishNavAction = payload.candidateActions.find(
      (action: any) => action.targetRef === 'ref_publish_nav',
    );
    expect(publishNavAction).toMatchObject({
      label: '发布',
      intent: 'publish.open_entry',
    });
    expect(publishNavAction.intentBoundary).toContain('not final publish submission');
  });

  it('derives a conservative summary from page regions when URL/title understanding stays unknown', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5217,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/explore',
      title: 'Interest Community',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Interest Community" [ref=ref_main] (x=640,y=370)',
        '  - navigation "Global navigation" [ref=ref_nav] (x=80,y=300)',
        '    - link "Home" [ref=ref_home] (x=80,y=140) href="/home"',
        '    - link "Publish" [ref=ref_publish_nav] (x=80,y=196) href="/publish"',
        '  - listitem "Recommended creator workflow" [ref=ref_result_1] (x=420,y=180)',
        '    - link "Recommended creator workflow" [ref=ref_result_1_link] (x=420,y=170) href="/items/workflow"',
        '  - button "Messages" [ref=ref_messages] (x=80,y=252)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_home', selector: 'a[href="/home"]' },
        { ref: 'ref_publish_nav', selector: 'a[href="/publish"]' },
        { ref: 'ref_result_1_link', selector: 'a[href="/items/workflow"]' },
        { ref: 'ref_messages', selector: 'button.messages' },
      ],
      stats: { processed: 8, included: 8, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.pageRegions.map((item: any) => item.regionType)).toEqual(
      expect.arrayContaining(['navigation', 'form', 'content']),
    );
    expect(payload.summary).toMatchObject({
      pageRole: 'multi_region_page',
      primaryRegion: 'content',
    });
    expect(payload.pageProjection).toMatchObject({
      pageRole: 'multi_region_page',
      activeRegion: 'content',
    });
  });

  it('keeps sparse exact search_result routes in search scope instead of content detail scope', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5212,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search_result?query=neutral',
      title: 'Neutral topic - 搜索',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Neutral topic 搜索结果" [ref=ref_main] (x=640,y=370)',
        '  - searchbox "搜索" [ref=ref_search] (x=520,y=40)',
        '  - navigation "Global navigation" [ref=ref_nav] (x=80,y=300)',
        '    - link "Home" [ref=ref_home] (x=80,y=140) href="/home"',
        '    - link "Publish" [ref=ref_publish_nav] (x=80,y=196) href="/publish"',
        '  - generic "Content creator prompt examples" [ref=ref_content_hint] (x=520,y=220)',
        '  - button "Follow" [ref=ref_follow] (x=760,y=260)',
        '  - button "Like" [ref=ref_like] (x=420,y=320)',
        '  - button "Collect" [ref=ref_collect] (x=520,y=320)',
        '  - button "Share" [ref=ref_share] (x=620,y=320)',
        '  - generic "Comments" [ref=ref_comments] (x=520,y=380)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_search', selector: '#search-input' },
        { ref: 'ref_home', selector: 'a[href="/home"]' },
        { ref: 'ref_publish_nav', selector: 'a[href="/publish"]' },
        { ref: 'ref_follow', selector: 'button.follow' },
        { ref: 'ref_like', selector: 'button.like' },
        { ref: 'ref_collect', selector: 'button.collect' },
        { ref: 'ref_share', selector: 'button.share' },
      ],
      stats: { processed: 11, included: 11, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary).toMatchObject({
      pageRole: 'search_results',
      primaryRegion: 'search_results',
    });
    expect(payload.taskMode).toBe('search');
    expect(payload.watchScope.scopeKind).toBe('search');
    expect(payload.pageProjection.pageRole).toBe('search_results');
    expect(payload.visibleRegionRowsUsed).toBe(false);
    expect(
      payload.highValueObjects.some(
        (item: { id?: string; kind?: string }) =>
          item.kind === 'page_role_seed' && String(item.id || '').startsWith('hvo_content_detail'),
      ),
    ).toBe(false);
  });

  it('maps generic content detail pages to read scope without promoting related cards as result rows', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5210,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/item/aigc-creator-workflow',
      title: 'AIGC creator workflow case study',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "AIGC creator workflow case study" [ref=ref_main] (x=640,y=370)',
        '  - article "AIGC creator workflow case study" [ref=ref_article] (x=520,y=260)',
        '    - heading "AIGC creator workflow case study" [ref=ref_heading] (x=520,y=140)',
        '    - link "Author profile" [ref=ref_author] (x=360,y=190) href="/creator/aigc-owner"',
        '    - button "Follow" [ref=ref_follow] (x=760,y=190)',
        '    - generic "Image and prompt example for one repeatable creator workflow." [ref=ref_body] (x=520,y=250)',
        '    - button "Like 1200" [ref=ref_like] (x=420,y=360)',
        '    - button "Collect 860" [ref=ref_collect] (x=520,y=360)',
        '    - button "Share" [ref=ref_share] (x=620,y=360)',
        '    - textbox "Add a comment" [ref=ref_comment] (x=520,y=460)',
        '    - generic "Comments 128" [ref=ref_comments] (x=520,y=520)',
        '  - complementary "Related content" [ref=ref_related] (x=980,y=320)',
        '    - article "Related" [ref=ref_related_1] (x=980,y=180)',
        '      - link "Modern content workflow example" [ref=ref_related_1_link] (x=980,y=170) href="/item/modern-workflow"',
        '      - generic "A short example for adapting prompts into assets." [ref=ref_related_1_desc] (x=980,y=206)',
        '    - article "Related" [ref=ref_related_2] (x=980,y=300)',
        '      - link "Creator image review checklist" [ref=ref_related_2_link] (x=980,y=290) href="/item/image-review"',
        '      - generic "A checklist for deciding whether an image is publishable." [ref=ref_related_2_desc] (x=980,y=326)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_author', selector: 'a[href="/creator/aigc-owner"]' },
        { ref: 'ref_follow', selector: 'button.follow' },
        { ref: 'ref_like', selector: 'button.like' },
        { ref: 'ref_collect', selector: 'button.collect' },
        { ref: 'ref_share', selector: 'button.share' },
        { ref: 'ref_comment', selector: 'textarea.comment' },
        { ref: 'ref_related_1_link', selector: 'a[href="/item/modern-workflow"]' },
        { ref: 'ref_related_2_link', selector: 'a[href="/item/image-review"]' },
      ],
      stats: { processed: 18, included: 18, durationMs: 8 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary).toMatchObject({
      pageRole: 'content_detail',
      primaryRegion: 'content_detail',
    });
    expect(payload).toMatchObject({
      taskMode: 'read',
      selectedDataSource: 'dom_json',
      rowCount: 0,
      visibleRegionRowsUsed: false,
    });
    expect(payload.watchScope.scopeKind).toBe('long_content');
    expect(payload.pageProjection.pageRole).toBe('content_detail');
    const expectedContentDetailSeedIds = new Set([
      'hvo_content_detail_seed_body',
      'hvo_content_detail_seed_author',
      'hvo_content_detail_seed_feedback',
    ]);
    const contentDetailSeeds = payload.highValueObjects.filter(
      (item: { kind?: string; id?: string }) =>
        item.kind === 'page_role_seed' && expectedContentDetailSeedIds.has(String(item.id || '')),
    );
    expect(contentDetailSeeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'hvo_content_detail_seed_body',
          objectType: 'doc_block',
          region: 'content_detail',
        }),
        expect.objectContaining({
          id: 'hvo_content_detail_seed_author',
          objectType: 'entry',
          region: 'account',
        }),
        expect.objectContaining({
          id: 'hvo_content_detail_seed_feedback',
          objectType: 'status_item',
          region: 'feedback',
        }),
      ]),
    );
    expect(contentDetailSeeds).toHaveLength(3);
    expect(
      contentDetailSeeds.some((item: { actions?: unknown[]; targetRef?: string }) => {
        return Boolean(item.targetRef) || Boolean(item.actions?.length);
      }),
    ).toBe(false);
    expect(payload.pageRegions.map((item: any) => item.regionType)).toEqual(
      expect.arrayContaining(['account', 'content', 'feedback']),
    );
    expect(payload.objectLifecycle.items.map((item: any) => item.objectFamily)).toEqual(
      expect.arrayContaining(['account_identity', 'content_collection', 'feedback_surface']),
    );
    expect(
      payload.candidateActions.map((action: { intent?: string }) => action.intent),
    ).not.toContain('content.open_detail');
  });

  it('keeps sparse generic content detail routes in read scope when the routed title is specific', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5211,
      windowId: 1,
      active: false,
      status: 'complete',
      url: 'https://example.test/explore/6a02dfb70000000007024c8a',
      title: 'Creator workflow lessons after two months',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(
      [
        'Creator workflow lessons after two months',
        'A practical detail page body with examples, author notes, and comments visible in the viewport.',
      ].join('\n'),
    );
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- generic "Application shell" [ref=ref_shell] (x=640,y=360)',
        '  - textbox "Search or enter any question" [ref=ref_search] (x=520,y=40)',
        '  - link "Home" [ref=ref_home] (x=80,y=120) href="/home"',
        '  - link "Publish" [ref=ref_publish] (x=80,y=180) href="/publish"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_search', selector: '#search-input' },
        { ref: 'ref_home', selector: 'a[href="/home"]' },
        { ref: 'ref_publish', selector: 'a[href="/publish"]' },
      ],
      stats: { processed: 4, included: 4, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary).toMatchObject({
      pageRole: 'content_detail',
      primaryRegion: 'content_detail',
    });
    expect(payload.taskMode).toBe('read');
    expect(payload.watchScope.scopeKind).toBe('long_content');
    expect(payload.selectedDataSource).toBe('dom_json');
    expect(payload.readinessVerdict).toBe('ready');
    expect(payload.evidenceSource).toContain('visible_text');
    expect(payload.pageProjection.pageRole).toBe('content_detail');
  });

  it('links visible-text result rows when fallback links expose type but empty role', () => {
    const rows = extractVisibleRegionRows({
      pageContent: '- generic "Search shell" [ref=ref_shell] (x=640,y=300)',
      visibleTextContent: [
        'AIGC prompt workflow examples',
        'Concrete before and after examples for creator workflows.',
        'Creator image generation checklist',
        'A reusable checklist for evaluating generated images.',
      ].join('\n'),
      sourceRegion: 'viewport',
      url: 'https://example.test/search_result?keyword=AIGC',
      title: 'AIGC - 搜索',
      fallbackInteractiveElements: [
        {
          ref: 'ref_result_1_link',
          role: '',
          type: 'link',
          text: 'AIGC prompt workflow examples',
          href: '/items/aigc-prompt-workflow',
        },
        {
          ref: 'ref_result_2_link',
          role: '',
          type: 'link',
          text: 'Creator image generation checklist',
          href: '/items/image-generation-checklist',
        },
      ],
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.targetRefCoverageRate).toBe(0.99);
    expect(rows.rows.map((row) => row.targetRef)).toEqual([
      'ref_result_1_link',
      'ref_result_2_link',
    ]);
    expect(rows.rows.map((row) => row.qualityReasons)).toEqual([
      expect.arrayContaining(['target_ref_available']),
      expect.arrayContaining(['target_ref_available']),
    ]);
  });

  it('does not map shell-only search pages to search watch scope', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5206,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- banner "Site header" [ref=ref_banner] (x=640,y=40)',
          '  - link "Home" [ref=ref_home] (x=40,y=40) href="/"',
          '- search "Search controls" [ref=ref_search] (x=420,y=96)',
          '  - searchbox "Search query" [ref=ref_query] (x=420,y=96)',
          '  - button "Search" [ref=ref_search_button] (x=760,y=96)',
          '- navigation "Result filters" [ref=ref_filters] (x=220,y=160)',
          '  - button "All" [ref=ref_all] (x=220,y=160)',
          '  - button "Recent" [ref=ref_recent] (x=280,y=160)',
          '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
          '  - link "Privacy" [ref=ref_privacy] (x=600,y=680) href="/privacy"',
          '  - link "Terms" [ref=ref_terms] (x=680,y=680) href="/terms"',
        ].join('\n'),
        refMap: [
          { ref: 'ref_home', selector: 'a[href="/"]' },
          { ref: 'ref_query', selector: 'input[type="search"]' },
          { ref: 'ref_search_button', selector: 'button.search' },
        ],
        stats: { processed: 10, included: 10, durationMs: 7 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "Search shell" [ref=ref_shell] (x=640,y=300)',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          { type: 'link', text: 'Home', selector: 'a[href="/"]', href: '/' },
          { type: 'button', text: 'Search', selector: 'button.search' },
          { type: 'button', text: 'All', selector: 'button.all' },
          { type: 'link', text: 'Privacy', selector: 'a[href="/privacy"]', href: '/privacy' },
        ],
        scrollY: 0,
        pixelsBelow: 0,
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload).toMatchObject({
      taskMode: 'read',
      rowCount: 0,
      visibleRegionRowsUsed: false,
    });
    expect(payload.watchScope.scopeKind).not.toBe('search');
    expect(payload.visibleRegionRows.rows).toEqual([]);
  });

  it('recovers search rows from body-visible text when a non-sparse tree is shell-heavy', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5207,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sampleVisibleText = vi
      .spyOn(readPageTool as any, 'sampleVisibleTextContent')
      .mockResolvedValue(
        [
          'Search results for workflow',
          'Workflow planning guide for distributed teams',
          'Practical steps for coordinating browser tasks across reviewers.',
          'Updated today',
          'Operations checklist for reliable browser handoffs',
          'A field checklist for keeping evidence, ownership, and actions aligned.',
          'Updated yesterday',
        ].join('\n'),
      );
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- banner "Site header" [ref=ref_banner] (x=640,y=40)',
        '  - link "Home" [ref=ref_home] (x=40,y=40) href="/"',
        '- search "Search controls" [ref=ref_search] (x=420,y=96)',
        '  - searchbox "Search query" [ref=ref_query] (x=420,y=96)',
        '  - button "Search" [ref=ref_search_button] (x=760,y=96)',
        '- navigation "Result filters" [ref=ref_filters] (x=220,y=160)',
        '  - button "All" [ref=ref_all] (x=220,y=160)',
        '  - button "Recent" [ref=ref_recent] (x=280,y=160)',
        '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
        '  - link "Privacy" [ref=ref_privacy] (x=600,y=680) href="/privacy"',
        '  - link "Terms" [ref=ref_terms] (x=680,y=680) href="/terms"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_home', selector: 'a[href="/"]' },
        { ref: 'ref_query', selector: 'input[type="search"]' },
        { ref: 'ref_search_button', selector: 'button.search' },
        { ref: 'ref_all', selector: 'button.all' },
        { ref: 'ref_recent', selector: 'button.recent' },
      ],
      stats: { processed: 10, included: 10, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(sampleVisibleText).toHaveBeenCalled();
    expect(payload).toMatchObject({
      taskMode: 'search',
      rowCount: 2,
      visibleRegionRowsUsed: true,
      readinessVerdict: 'ready',
    });
    expect(payload.pageContext.fallbackSource).toBe('visible_text');
    expect(payload.watchScope.scopeKind).toBe('search');
    expect(payload.visibleRegionRows.sourceRegion).toBe('visible_text');
    expect(payload.visibleRegionRows.rows.map((row: { title: string }) => row.title)).toEqual([
      'Workflow planning guide for distributed teams',
      'Operations checklist for reliable browser handoffs',
    ]);
  });

  it('supplements shell-heavy reads with DOM interactive controls when snapshot actions are too sparse', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5208,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/app',
      title: 'Workspace',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(null);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- main "Application shell" [ref=ref_main]',
          '  - button "Open" [ref=ref_open]',
          '  - generic "Workspace heading" [ref=ref_heading]',
          '  - generic "Recent activity" [ref=ref_recent]',
          '  - generic "Pinned area" [ref=ref_pinned]',
          '  - generic "Status area" [ref=ref_status]',
          '  - generic "Footer link group" [ref=ref_footer]',
          '  - generic "Help text" [ref=ref_help]',
          '  - generic "Legal text" [ref=ref_legal]',
          '  - generic "Version text" [ref=ref_version]',
        ].join('\n'),
        refMap: [{ ref: 'ref_open', selector: 'button.open' }],
        stats: { processed: 10, included: 10, durationMs: 8 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          { type: 'button', text: 'Menu', selector: 'button.menu', isInteractive: true },
          {
            type: 'interactive',
            text: 'Account',
            selector: '[data-user-menu]',
            isInteractive: true,
          },
          { type: 'input', text: 'Search', selector: 'input.search', isInteractive: true },
        ],
      });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.browserPageObject).toBeUndefined();
    expect(payload.browserPageObjectCompact).toMatchObject({
      source: 'read_page_browser_page_object_compact',
      rootObjectId: expect.any(String),
      facts: expect.objectContaining({
        window: expect.objectContaining({ objectKind: 'BrowserWindowObject' }),
        tab: expect.objectContaining({ objectKind: 'BrowserTabObject' }),
        page: expect.objectContaining({ objectKind: 'BrowserPageObject' }),
      }),
      primaryConclusion: expect.any(String),
      claimBoundary: expect.stringContaining('candidate'),
    });
    expect(JSON.stringify(payload.browserPageObjectCompact)).not.toContain('attributeGroups');
    expect(JSON.stringify(payload.browserPageObjectCompact)).not.toContain('semanticEvents');
    expect(payload.browserPageObjectCompact).toMatchObject({
      watchStatus: expect.any(String),
      changedGroups: expect.any(Array),
      transitionCount: expect.any(Number),
    });
    expect(payload.browserPageObjectCompact).toEqual(
      expect.objectContaining({
        claimBoundary: expect.stringContaining('candidate evidence only'),
      }),
    );
    expect(payload.pageContext.fallbackSource).toBe('interactive_shell_supplement');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_open', role: 'button' }),
        expect.objectContaining({
          ref: 'ref_fallback_1',
          role: 'button',
          name: 'menu action candidate',
        }),
        expect.objectContaining({
          ref: 'ref_fallback_2',
          role: 'button',
          name: 'account action candidate',
        }),
        expect.objectContaining({ ref: 'ref_fallback_3', role: 'textbox', name: 'Search' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_fallback_1', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_fallback_3', actionType: 'fill' }),
      ]),
    );
    expect(payload.pageOperationMap.zones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'open_menu' }),
        expect.objectContaining({ purpose: 'search' }),
      ]),
    );
  });

  it('compares object lifecycle against the previous same-tab read_page snapshot', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5219,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/app',
      title: 'Workspace',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(null);
    vi.spyOn(readPageTool as any, 'collectInteractiveElementsFallback').mockResolvedValue({
      success: true,
      elements: [],
    });
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- navigation "Primary navigation" [ref=ref_nav] (x=100,y=360)',
          '  - button "Menu" [ref=ref_menu] (x=60,y=120)',
          '- main "Workspace content" [ref=ref_main] (x=640,y=360)',
          '  - heading "Overview" [ref=ref_heading] (x=320,y=120)',
          '  - generic "Status ready" [ref=ref_status] (x=320,y=180)',
          '  - generic "Recent activity" [ref=ref_activity] (x=320,y=240)',
          '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
        ].join('\n'),
        refMap: [
          { ref: 'ref_menu', selector: 'button.menu' },
          { ref: 'ref_heading', selector: 'h1' },
          { ref: 'ref_status', selector: '[data-status]' },
        ],
        stats: { processed: 7, included: 7, durationMs: 7 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          '- navigation "Primary navigation" [ref=ref_nav] (x=100,y=360)',
          '  - button "Menu" [ref=ref_menu] (x=60,y=120)',
          '  - button "Settings" [ref=ref_settings] (x=60,y=180)',
          '  - button "Help" [ref=ref_help] (x=60,y=240)',
          '- main "Workspace content" [ref=ref_main] (x=640,y=360)',
          '  - heading "Overview" [ref=ref_heading] (x=320,y=120)',
          '  - generic "Status ready" [ref=ref_status] (x=320,y=180)',
          '  - generic "Recent activity" [ref=ref_activity] (x=320,y=240)',
          '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
        ].join('\n'),
        refMap: [
          { ref: 'ref_menu', selector: 'button.menu' },
          { ref: 'ref_settings', selector: 'button.settings' },
          { ref: 'ref_help', selector: 'button.help' },
        ],
        stats: { processed: 9, included: 9, durationMs: 8 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      });

    const first = await readPageTool.execute({ mode: 'compact' });
    const second = await readPageTool.execute({ mode: 'compact' });
    const firstPayload = JSON.parse((first.content[0] as { text: string }).text);
    const secondPayload = JSON.parse((second.content[0] as { text: string }).text);

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(firstPayload.objectLifecycle).toMatchObject({
      status: 'single_snapshot',
      changedObjectCount: 0,
    });
    expect(secondPayload.objectLifecycle).toMatchObject({
      status: 'compared_snapshot',
    });
    expect(secondPayload.objectLifecycle.changedObjectCount).toBeGreaterThan(0);
    expect(secondPayload.browserPageObjectCompact).toMatchObject({
      watchStatus: expect.stringContaining('candidate'),
      transitionCount: expect.any(Number),
    });
    expect(secondPayload.browserPageObjectCompact.transitionCount).toBeGreaterThan(0);
    expect(secondPayload.browserPageObjectCompact.primaryConclusion).toMatch(
      /Menu expanded candidate/i,
    );
    expect(secondPayload.browserPageObjectCompact.primaryConclusion).not.toMatch(
      /^Page state changed/i,
    );
  });

  it('compares bounded watch-loop runtime state across same-tab read_page snapshots', async () => {
    const tabSequence = [
      {
        id: 5221,
        windowId: 78,
        active: true,
        status: 'complete',
        url: 'https://example.test/runtime-watch',
        title: 'Runtime Watch',
      },
      {
        id: 5221,
        windowId: 78,
        active: false,
        status: 'complete',
        url: 'https://example.test/runtime-watch',
        title: 'Runtime Watch',
      },
    ];
    vi.spyOn(readPageTool as any, 'tryGetTab')
      .mockResolvedValueOnce(tabSequence[0])
      .mockResolvedValueOnce(tabSequence[1]);
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(null);
    vi.spyOn(readPageTool as any, 'collectInteractiveElementsFallback').mockResolvedValue({
      success: true,
      elements: [],
    });
    (chrome.windows as any).get = vi
      .fn()
      .mockResolvedValueOnce({
        id: 78,
        focused: true,
        state: 'normal',
        width: 1200,
        height: 800,
        left: 20,
        top: 30,
      })
      .mockResolvedValueOnce({
        id: 78,
        focused: false,
        state: 'minimized',
        width: 1200,
        height: 800,
        left: 20,
        top: 30,
      });
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Runtime watch page" [ref=ref_main] (x=320,y=100)',
        '  - heading "Runtime watch" [ref=ref_heading] (x=320,y=140)',
        '  - button "Open menu" [ref=ref_menu] (x=320,y=180)',
        '  - link "Details" [ref=ref_details] (x=320,y=220)',
        '  - generic "Status ready" [ref=ref_status] (x=320,y=260)',
        '  - generic "Activity" [ref=ref_activity] (x=320,y=300)',
        '  - generic "Panel" [ref=ref_panel] (x=320,y=340)',
        '  - generic "Sidebar" [ref=ref_sidebar] (x=760,y=220)',
        '  - generic "Footer text" [ref=ref_footer_text] (x=320,y=620)',
        '- footer "Footer" [ref=ref_footer] (x=320,y=680)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_menu', selector: 'button.menu' },
        { ref: 'ref_details', selector: 'a.details' },
        { ref: 'ref_heading', selector: 'h1' },
      ],
      stats: { processed: 10, included: 10, durationMs: 7 },
      viewport: { width: 1200, height: 800, dpr: 1 },
    });

    const first = await readPageTool.execute({ mode: 'compact' });
    const second = await readPageTool.execute({ mode: 'compact' });
    const firstPayload = JSON.parse((first.content[0] as { text: string }).text);
    const secondPayload = JSON.parse((second.content[0] as { text: string }).text);

    expect(first.isError).toBe(false);
    expect(second.isError).toBe(false);
    expect(firstPayload.browserPageObjectCompact.facts.window).toMatchObject({
      currentWindowState: 'normal',
      isFocused: true,
      isMinimized: false,
    });
    expect(secondPayload.objectLifecycle.status).toBe('compared_snapshot');
    expect(secondPayload.browserPageObjectCompact.transitionCount).toBeGreaterThan(0);
    expect(secondPayload.browserPageObjectCompact.changedGroups).toEqual(
      expect.arrayContaining(['window_state', 'tab_state', 'visual_reliability']),
    );
    expect(secondPayload.browserPageObjectCompact.facts.window).toMatchObject({
      currentWindowState: 'minimized',
      isFocused: false,
      isMinimized: true,
    });
    expect(secondPayload.browserPageObjectCompact.facts.tab).toMatchObject({
      isActive: false,
    });
    expect(secondPayload.browserPageObjectCompact.facts.visualReliability).toMatchObject({
      degraded: true,
      visualReliabilityCandidate: false,
    });
  });

  it('recovers search rows from body-visible text for shallow explicit depth reads', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5217,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sampleVisibleText = vi
      .spyOn(readPageTool as any, 'sampleVisibleTextContent')
      .mockResolvedValue(
        [
          'Search results for workflow',
          'Workflow planning guide for distributed teams',
          'Practical steps for coordinating browser tasks across reviewers.',
          'Updated today',
          'Operations checklist for reliable browser handoffs',
          'A field checklist for keeping evidence, ownership, and actions aligned.',
          'Updated yesterday',
        ].join('\n'),
      );
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- banner "Site header" [ref=ref_banner] (x=640,y=40)',
        '  - link "Home" [ref=ref_home] (x=40,y=40) href="/"',
        '- search "Search controls" [ref=ref_search] (x=420,y=96)',
        '  - searchbox "Search query" [ref=ref_query] (x=420,y=96)',
        '  - button "Search" [ref=ref_search_button] (x=760,y=96)',
        '- navigation "Result filters" [ref=ref_filters] (x=220,y=160)',
        '  - button "All" [ref=ref_all] (x=220,y=160)',
        '  - button "Recent" [ref=ref_recent] (x=280,y=160)',
        '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_home', selector: 'a[href="/"]' },
        { ref: 'ref_query', selector: 'input[type="search"]' },
        { ref: 'ref_search_button', selector: 'button.search' },
        { ref: 'ref_all', selector: 'button.all' },
        { ref: 'ref_recent', selector: 'button.recent' },
      ],
      stats: { processed: 9, included: 9, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', depth: 3 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(sampleVisibleText).toHaveBeenCalled();
    expect(payload.pageContext.depth).toBe(3);
    expect(payload.pageContext.fallbackSource).toBe('visible_text');
    expect(payload).toMatchObject({
      taskMode: 'search',
      rowCount: 2,
      visibleRegionRowsUsed: true,
      readinessVerdict: 'ready',
    });
    expect(payload.watchScope.scopeKind).toBe('search');
  });

  it('echoes explicit full mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5202,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/checkout',
      title: 'Checkout',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Checkout" [ref=ref_0] (x=640,y=300)\n  - textbox "Email" [ref=ref_1] (x=600,y=260)\n  - textbox "Card number" [ref=ref_2] (x=600,y=300)\n  - button "Submit order" [ref=ref_3] (x=600,y=340)\n  - link "Back to cart" [ref=ref_4] (x=500,y=340)\n- heading "Checkout" [ref=ref_5] (x=320,y=100)\n- generic "Secure payment" [ref=ref_6] (x=320,y=140)\n- generic "Order summary" [ref=ref_7] (x=900,y=220)\n- generic "Terms" [ref=ref_8] (x=300,y=520)\n- generic "Footer" [ref=ref_9] (x=300,y=560)',
      refMap: [
        { ref: 'ref_1', selector: '#email' },
        { ref: 'ref_2', selector: '#card-number' },
        { ref: 'ref_3', selector: 'button[type=submit]' },
      ],
      stats: { processed: 12, included: 8, durationMs: 11 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'full' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'full');
    expect(payload.fullSnapshot).toBeDefined();
    expect(payload.diagnostics).toBeUndefined();
    expect(payload.fullSnapshot.pageContent).toContain('button "Submit order"');
  });

  it('keeps structured skeleton for unsupported page types', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5208,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'chrome://extensions',
      title: 'Extensions',
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expect(payload.success).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.pageType).toBe('browser_internal_page');
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.candidateActions).toEqual([]);
  });

  it('captures login page candidate actions in compact mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5210,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/login',
      title: 'Sign in',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'collectInteractiveElementsFallback').mockResolvedValue(null);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        '- form "Sign in" [ref=ref_0] (x=640,y=300)\n  - textbox "手机号" [ref=ref_phone] (x=600,y=260)\n  - textbox "验证码" [ref=ref_code] (x=600,y=300)\n  - button "登录" [ref=ref_login] (x=600,y=340)\n- generic "请输入手机号和验证码登录" [ref=ref_5] (x=580,y=220)\n- generic "用户协议" [ref=ref_6] (x=580,y=380)\n- generic "隐私政策" [ref=ref_7] (x=580,y=410)\n- generic "联系我们" [ref=ref_8] (x=580,y=440)\n- generic "帮助中心" [ref=ref_9] (x=580,y=470)\n- generic "页面底部信息" [ref=ref_10] (x=580,y=520)',
      refMap: [
        { ref: 'ref_phone', selector: 'input[name=phone]' },
        { ref: 'ref_code', selector: 'input[name=captcha]' },
        { ref: 'ref_login', selector: 'button[type=submit]' },
      ],
      stats: { processed: 14, included: 9, durationMs: 9 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.summary.pageRole).toBe('login_required');
    expect(payload.taskMode).toBe('read');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_phone', role: 'textbox' }),
        expect.objectContaining({ ref: 'ref_code', role: 'textbox' }),
        expect.objectContaining({ ref: 'ref_login', role: 'button' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'fill',
          targetRef: 'ref_phone',
        }),
        expect.objectContaining({
          actionType: 'click',
          targetRef: 'ref_login',
          intent: 'auth.submit_login',
          locatorChain: expect.arrayContaining([
            { type: 'ref', value: 'ref_login' },
            { type: 'css', value: 'button[type=submit]' },
          ]),
        }),
      ]),
    );
  });

  it('reports auth_or_login_required when a sparse page is a login boundary', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5244,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/login',
      title: 'Sign in',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(
      '请先登录后继续访问此页面。手机号登录 扫码登录',
    );
    vi.spyOn(readPageTool as any, 'collectInteractiveElementsFallback').mockResolvedValue(null);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "登录提示" [ref=ref_main] (x=640,y=260)',
        '  - heading "请先登录" [ref=ref_heading] (x=640,y=180)',
        '  - generic "请先登录后继续访问此页面。手机号登录 扫码登录" [ref=ref_login_hint] (x=640,y=220)',
        '  - textbox "手机号" [ref=ref_phone] (x=600,y=280)',
        '  - textbox "验证码" [ref=ref_code] (x=600,y=330)',
        '  - button "登录" [ref=ref_login_button] (x=640,y=380)',
        '  - link "用户协议" [ref=ref_terms] (x=580,y=430)',
        '  - link "隐私政策" [ref=ref_privacy] (x=700,y=430)',
        '  - link "帮助中心" [ref=ref_help] (x=820,y=430)',
        '  - generic "登录后可继续查看内容" [ref=ref_notice] (x=640,y=470)',
      ].join('\n'),
      refMap: [],
      stats: { processed: 1, included: 1, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.readinessVerdict).toBe('blocked');
    expect(payload.readinessReason).toBe('auth_or_login_required');
    expect(payload.rowCount).toBe(0);
    expect(payload.visibleRegionRowsUsed).toBe(false);
  });

  it('reports challenge_or_verification when a sparse page is a verification boundary', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5245,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/security-check',
      title: 'Security Check',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(
      '请完成安全验证，拖动滑块通过人机验证后继续访问。',
    );
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "安全验证" [ref=ref_main] (x=640,y=260)',
        '  - heading "请完成安全验证" [ref=ref_heading] (x=640,y=180)',
        '  - generic "拖动滑块通过人机验证后继续访问。" [ref=ref_verify] (x=640,y=220)',
        '  - slider "滑块验证" [ref=ref_slider] (x=640,y=300)',
        '  - button "刷新验证" [ref=ref_refresh] (x=640,y=360)',
        '  - link "帮助" [ref=ref_help] (x=640,y=420)',
        '  - generic "请勿关闭页面" [ref=ref_hint] (x=640,y=460)',
        '  - generic "验证完成后自动继续" [ref=ref_continue] (x=640,y=500)',
        '  - link "反馈问题" [ref=ref_feedback] (x=640,y=540)',
        '  - generic "页面底部信息" [ref=ref_footer] (x=640,y=680)',
      ].join('\n'),
      refMap: [],
      stats: { processed: 1, included: 1, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.readinessVerdict).toBe('blocked');
    expect(payload.readinessReason).toBe('challenge_or_verification');
    expect(payload.rowCount).toBe(0);
    expect(payload.visibleRegionRowsUsed).toBe(false);
  });

  it('keeps compact short and full detailed on complex pages', async () => {
    const mockSend = vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- application "Enterprise console" [ref=ref_root] (x=640,y=100)',
        '  - navigation "Main menu" [ref=ref_nav] (x=140,y=240)',
        '    - link "Dashboard" [ref=ref_dash] (x=120,y=180)',
        '    - link "Settings" [ref=ref_settings] (x=120,y=220)',
        '  - main "Workspace" [ref=ref_main] (x=780,y=320)',
        '    - region "Filters" [ref=ref_filter_region] (x=480,y=190)',
        '      - textbox "Search records" [ref=ref_search] (x=520,y=220)',
        '      - combobox "Status" [ref=ref_status] (x=720,y=220)',
        '      - button "Apply filters" [ref=ref_apply] (x=920,y=220)',
        '    - region "Results table" [ref=ref_table] (x=760,y=360)',
        '      - row "Record A" [ref=ref_row_a] (x=760,y=300)',
        '      - row "Record B" [ref=ref_row_b] (x=760,y=340)',
        '      - row "Record C" [ref=ref_row_c] (x=760,y=380)',
        '    - region "Bulk actions" [ref=ref_bulk] (x=980,y=500)',
        '      - button "Export CSV" [ref=ref_export] (x=980,y=520)',
        '      - button "Archive selected" [ref=ref_archive] (x=1120,y=520)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_search', selector: 'input[name=q]' },
        { ref: 'ref_status', selector: 'select[name=status]' },
        { ref: 'ref_apply', selector: 'button.apply-filters' },
        { ref: 'ref_export', selector: 'button.export-csv' },
        { ref: 'ref_archive', selector: 'button.archive-selected' },
      ],
      stats: { processed: 42, included: 24, durationMs: 15 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5211,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/admin/console',
      title: 'Enterprise Console',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);

    const compactResult = await readPageTool.execute({ mode: 'compact' });
    const compactPayload = JSON.parse((compactResult.content[0] as { text: string }).text);
    const fullResult = await readPageTool.execute({ mode: 'full' });
    const fullPayload = JSON.parse((fullResult.content[0] as { text: string }).text);

    expect(compactResult.isError).toBe(false);
    expect(fullResult.isError).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expectCommonSnapshotShape(compactPayload, 'compact');
    expectCommonSnapshotShape(fullPayload, 'full');
    expect(compactPayload.fullSnapshot).toBeUndefined();
    expect(fullPayload.fullSnapshot).toBeDefined();
    expect(fullPayload.fullSnapshot.pageContent).toContain('Results table');
    expect(JSON.stringify(compactPayload).length).toBeLessThan(JSON.stringify(fullPayload).length);
  });

  it('prioritizes named task controls over shell noise in compact mode', async () => {
    const shellLines = Array.from({ length: 26 }, (_, index) => {
      const ref = `ref_shell_${index + 1}`;
      const role = index % 3 === 0 ? 'button' : 'link';
      return `- ${role} "" [ref=${ref}] (x=${120 + index * 12},y=64)`;
    });
    const pageSpecificLines = [
      '- link "Skip to content" [ref=ref_skip] (x=40,y=20)',
      '- button "Search or jump to…" [ref=ref_search] (x=280,y=20)',
      '- button "Open Copilot…" [ref=ref_copilot] (x=420,y=20)',
      '- link "Issues" [ref=ref_issues] (x=180,y=200)',
      '- link "Pull requests" [ref=ref_pulls] (x=280,y=200)',
      '- link "Actions" [ref=ref_actions] (x=400,y=200)',
      '- combobox "Filter workflow runs" [ref=ref_filter] (x=540,y=200)',
      '- link "Run 1052 of CI" [ref=ref_run] (x=760,y=240)',
    ];

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5212,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions',
      title: 'Actions · example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [...shellLines, ...pageSpecificLines].join('\n'),
      refMap: [
        { ref: 'ref_issues', selector: 'a[data-tab-item="issues-tab"]' },
        { ref: 'ref_pulls', selector: 'a[data-tab-item="pull-requests-tab"]' },
        { ref: 'ref_actions', selector: 'a[data-tab-item="actions-tab"]' },
        { ref: 'ref_filter', selector: 'select[aria-label="Filter workflow runs"]' },
        { ref: 'ref_run', selector: 'a[href*="/actions/runs/"]' },
      ],
      stats: { processed: 40, included: 34, durationMs: 17 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const orderedRefs = payload.interactiveElements.map((element: { ref: string }) => element.ref);

    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_issues', name: 'Issues' }),
        expect.objectContaining({ ref: 'ref_pulls', name: 'Pull requests' }),
        expect.objectContaining({ ref: 'ref_actions', name: 'Actions' }),
        expect.objectContaining({ ref: 'ref_filter', name: 'Filter workflow runs' }),
        expect.objectContaining({ ref: 'ref_run', name: 'Run 1052 of CI' }),
      ]),
    );
    expect(orderedRefs.indexOf('ref_filter')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(orderedRefs.indexOf('ref_actions')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(orderedRefs.indexOf('ref_run')).toBeLessThan(orderedRefs.indexOf('ref_skip'));
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_actions', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_filter', actionType: 'fill' }),
        expect.objectContaining({ targetRef: 'ref_run', actionType: 'click' }),
      ]),
    );
  });

  it('hydrates nested generic labels onto interactive wrappers in compact mode', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5213,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project',
      title: 'example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Repository" [ref=ref_nav] (x=180,y=72)',
        '  - link [ref=ref_issues_link] (x=160,y=76)',
        '    - generic "Issues" [ref=ref_issues_label] (x=148,y=76)',
        '  - link [ref=ref_pulls_link] (x=300,y=76)',
        '    - generic "Pull requests" [ref=ref_pulls_label] (x=292,y=76)',
        '  - link [ref=ref_actions_link] (x=440,y=76)',
        '    - generic "Actions" [ref=ref_actions_label] (x=432,y=76)',
        '  - button [ref=ref_jobs_button] (x=580,y=76)',
        '    - generic "Jobs" [ref=ref_jobs_label] (x=568,y=76)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_issues_link', selector: 'a[href$="/issues"]' },
        { ref: 'ref_pulls_link', selector: 'a[href$="/pulls"]' },
        { ref: 'ref_actions_link', selector: 'a[href$="/actions"]' },
        { ref: 'ref_jobs_button', selector: 'button[data-panel="jobs"]' },
      ],
      stats: { processed: 18, included: 9, durationMs: 7 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.summary.pageRole).toBe('repo_home');
    expect(payload.summary.primaryRegion).toBe('repo_primary_nav');
    expect(payload.taskMode).toBe('read');
    expect(
      payload.highValueObjects.slice(0, 3).map((item: { label: string }) => item.label),
    ).toEqual(['Pull requests', 'Issues', 'Actions']);
    expect(payload.L0.summary).toContain('focus on Pull requests, Issues, Actions');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_issues_link', name: 'Issues' }),
        expect.objectContaining({ ref: 'ref_pulls_link', name: 'Pull requests' }),
        expect.objectContaining({ ref: 'ref_actions_link', name: 'Actions' }),
        expect.objectContaining({ ref: 'ref_jobs_button', name: 'Jobs' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_issues_link', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_actions_link', actionType: 'click' }),
        expect.objectContaining({ targetRef: 'ref_jobs_button', actionType: 'click' }),
      ]),
    );
  });

  it('prefers action-oriented descendant labels over status text for compact workflow buttons', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5214,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions/runs/1',
      title: 'Workflow run',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Workflow run" [ref=ref_nav] (x=163,y=521)',
        '  - link [ref=ref_actions_link] (x=120,y=190)',
        '    - generic "Actions" [ref=ref_actions_label] (x=132,y=190)',
        '  - link [ref=ref_run_link] (x=160,y=210)',
        '    - generic "Run" [ref=ref_run_label] (x=172,y=210)',
        '  - button [ref=ref_jobs_button] (x=484,y=440)',
        '    - generic "1 job completed" [ref=ref_jobs_status] (x=451,y=432)',
        '    - generic "Show all jobs" [ref=ref_jobs_label] (x=425,y=451)',
        '  - link [ref=ref_summary_link] (x=163,y=230)',
        '    - generic "Summary" [ref=ref_summary_label] (x=175,y=230)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_actions_link', selector: 'a[href$="/actions"]' },
        { ref: 'ref_run_link', selector: 'a[href*="/actions/runs/"]' },
        { ref: 'ref_jobs_button', selector: 'button.show-all-jobs' },
        { ref: 'ref_summary_link', selector: 'a[href$="/actions/runs/1"]' },
      ],
      stats: { processed: 18, included: 10, durationMs: 6 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.summary.pageRole).toBe('workflow_run_detail');
    expect(payload.summary.primaryRegion).toBe('workflow_run_summary');
    expect(payload.taskMode).toBe('monitor');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_jobs_button', name: 'Show all jobs' }),
        expect.objectContaining({ ref: 'ref_summary_link', name: 'Summary' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_jobs_button', actionType: 'click' }),
      ]),
    );
  });

  it('keeps pageRole=workflow_run_detail before diagnostics hydrate, surfacing shell via primaryRegion only', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5217,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions/runs/42',
      title: 'Release Tabrix',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Actions" [ref=ref_actions] (x=120,y=190)',
        '  - link "Actions" [ref=ref_actions_link] (x=132,y=190)',
        '  - link "Run 42" [ref=ref_run_link] (x=172,y=210)',
        '  - generic "Release Tabrix" [ref=ref_title] (x=220,y=230)',
        '  - generic "Queued" [ref=ref_status] (x=240,y=250)',
        '  - generic "Started" [ref=ref_started] (x=260,y=270)',
        '  - generic "Checks" [ref=ref_checks] (x=280,y=290)',
        '  - generic "Workflow run" [ref=ref_shell_label] (x=300,y=310)',
        '  - generic "Actions shell" [ref=ref_shell_hint] (x=320,y=330)',
        '- generic "Loading" [ref=ref_loading] (x=420,y=451)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_actions_link', selector: 'a[href$="/actions"]' },
        { ref: 'ref_run_link', selector: 'a[href*="/actions/runs/42"]' },
        { ref: 'ref_loading', selector: '.workflow-run-loading' },
      ],
      stats: { processed: 14, included: 9, durationMs: 4 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    // T5.4.5 contract: URL-derived pageRole is stable; content-derived
    // primaryRegion independently reports hydration progress.
    expect(payload.summary.pageRole).toBe('workflow_run_detail');
    expect(payload.summary.primaryRegion).toBe('workflow_run_shell');
    expect(payload.taskMode).toBe('monitor');
  });

  it('prioritizes workflow run detail task links over commit metadata when labels are href-only', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5216,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions/runs/42',
      title: 'Workflow run detail',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- generic [ref=ref_root] (x=854,y=423)',
        '  - link [ref=ref_summary] (x=168,y=230) href="/example/project/actions/runs/42"',
        '  - link [ref=ref_jobs] (x=152,y=318) href="/example/project/actions/runs/42/job/1001"',
        '  - link [ref=ref_artifacts] (x=168,y=396) href="/example/project/actions/runs/42/usage"',
        '  - link [ref=ref_workflow] (x=168,y=428) href="/example/project/actions/runs/42/workflow"',
        '  - link [ref=ref_logs] (x=524,y=661) href="/example/project/actions/runs/42/job/1001#step:12:92"',
        '  - link "guodaxia103" [ref=ref_author] (x=431,y=262) href="/guodaxia103"',
        '  - link "bbfda4e" [ref=ref_commit] (x=570,y=263) href="/example/project/commit/bbfda4e5d826eeb157e9e92fd6d889a93512357"',
        '  - link "main" [ref=ref_branch] (x=624,y=262) href="/example/project/tree/refs/heads/main"',
        '  - link "54s" [ref=ref_duration] (x=840,y=260) href="/example/project/actions/runs/42/usage"',
        '  - button "Search or jump to…" [ref=ref_search] (x=1301,y=32) type="button"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_summary', selector: 'a[href$="/actions/runs/42"]' },
        { ref: 'ref_jobs', selector: 'a[href*="/actions/runs/42/job/1001"]' },
        { ref: 'ref_artifacts', selector: 'a[href$="/actions/runs/42/usage"]' },
        { ref: 'ref_workflow', selector: 'a[href$="/actions/runs/42/workflow"]' },
        { ref: 'ref_logs', selector: 'a[href*="#step:12:92"]' },
        { ref: 'ref_author', selector: 'a[href="/guodaxia103"]' },
        { ref: 'ref_commit', selector: 'a[href*="/commit/"]' },
        { ref: 'ref_branch', selector: 'a[href*="/tree/refs/heads/main"]' },
        { ref: 'ref_duration', selector: 'a[href$="/actions/runs/42/usage"]' },
        { ref: 'ref_search', selector: 'button[aria-label="Search or jump to…"]' },
      ],
      stats: { processed: 22, included: 14, durationMs: 8 },
      viewport: { width: 1707, height: 846, dpr: 1.5 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const orderedRefs = payload.interactiveElements.map((element: { ref: string }) => element.ref);

    expect(result.isError).toBe(false);
    expect(payload.summary.pageRole).toBe('workflow_run_detail');
    expect(payload.summary.primaryRegion).toBe('workflow_run_summary');
    expect(payload.taskMode).toBe('monitor');
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_summary', name: 'Summary' }),
        expect.objectContaining({ ref: 'ref_jobs', name: 'Jobs' }),
        expect.objectContaining({ ref: 'ref_logs', name: 'Logs' }),
      ]),
    );
    expect(orderedRefs.indexOf('ref_summary')).toBeLessThan(orderedRefs.indexOf('ref_commit'));
    expect(orderedRefs.indexOf('ref_jobs')).toBeLessThan(orderedRefs.indexOf('ref_branch'));
    expect(orderedRefs.indexOf('ref_artifacts')).toBeLessThan(orderedRefs.indexOf('ref_duration'));
  });

  it('prioritizes run detail links over workflow catalog links on actions list pages', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5215,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/actions',
      title: 'Workflow runs',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- navigation "Repository" [ref=ref_nav] (x=180,y=72)',
        '  - link [ref=ref_issues] (x=160,y=76)',
        '    - generic "Issues" [ref=ref_issues_label] (x=148,y=76)',
        '  - link [ref=ref_pulls] (x=300,y=76)',
        '    - generic "Pull requests" [ref=ref_pulls_label] (x=292,y=76)',
        '  - link [ref=ref_actions] (x=440,y=76)',
        '    - generic "Actions" [ref=ref_actions_label] (x=432,y=76)',
        '- navigation "Actions Workflows" [ref=ref_workflows] (x=168,y=470)',
        '  - link [ref=ref_close_issues] (x=168,y=323)',
        '    - generic "Close issues" [ref=ref_close_issues_label] (x=168,y=323)',
        '  - link [ref=ref_code_scan] (x=168,y=356)',
        '    - generic "Code Scanning - Action" [ref=ref_code_scan_label] (x=168,y=356)',
        '- search [ref=ref_search] (x=1490,y=132)',
        '  - combobox "Filter workflow runs" [ref=ref_filter] (x=1490,y=132)',
        '- link "completed successfully: Run 1052 of Close issues." [ref=ref_run_detail] (x=688,y=285)',
        '  - generic "Close issues" [ref=ref_run_detail_label] (x=689,y=285)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_issues', selector: 'a[href$="/issues"]' },
        { ref: 'ref_pulls', selector: 'a[href$="/pulls"]' },
        { ref: 'ref_actions', selector: 'a[href$="/actions"]' },
        { ref: 'ref_close_issues', selector: 'a[href$="/actions/workflows/close-issues.yml"]' },
        { ref: 'ref_code_scan', selector: 'a[href$="/actions/workflows/codeql.yml"]' },
        { ref: 'ref_filter', selector: 'input[placeholder="Filter workflow runs"]' },
        { ref: 'ref_run_detail', selector: 'a[href*="/actions/runs/24593977415"]' },
      ],
      stats: { processed: 30, included: 15, durationMs: 9 },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    const orderedRefs = payload.interactiveElements.map((element: { ref: string }) => element.ref);

    expect(result.isError).toBe(false);
    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: 'ref_run_detail',
          name: 'completed successfully: Run 1052 of Close issues.',
        }),
        expect.objectContaining({ ref: 'ref_close_issues', name: 'Close issues' }),
        expect.objectContaining({ ref: 'ref_filter', name: 'Filter workflow runs' }),
      ]),
    );
    expect(payload.taskMode).toBe('monitor');
    expect(orderedRefs.indexOf('ref_run_detail')).toBeLessThan(
      orderedRefs.indexOf('ref_close_issues'),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetRef: 'ref_run_detail', actionType: 'click' }),
      ]),
    );
  });

  it('aligns fallback refMap with elements when early rows have no selector (sparse tree)', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5399,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.test/page',
      title: 'Page',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'ensureInteractiveElementsHelper').mockResolvedValue(undefined);
    const sendMessage = vi.spyOn(readPageTool as any, 'sendMessageToTab');
    sendMessage
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "thin"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        pageContent: '- generic "thin"',
        refMap: [],
        stats: { processed: 1, included: 1, durationMs: 4 },
        viewport: { width: 1280, height: 720, dpr: 1 },
      })
      .mockResolvedValueOnce({
        success: true,
        elements: [
          {
            type: 'generic',
            text: 'No selector row',
            coordinates: { x: 10, y: 10 },
          },
          {
            type: 'link',
            text: 'Second link',
            selector: 'a.second',
            href: '/second',
            coordinates: { x: 20, y: 20 },
          },
        ],
        scrollY: 0,
        pixelsBelow: 0,
      });

    const result = await readPageTool.execute({ mode: 'full' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.pageContext.fallbackUsed).toBe(true);
    expect(payload.pageContext.refMapCount).toBe(1);

    const lines = String(payload.fullSnapshot.pageContent)
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);
    expect(lines[0]).not.toContain('[ref=');
    expect(lines[1]).toContain('[ref=ref_fallback_2]');
    expect(lines[1]).toContain('selector="a.second"');

    expect(payload.fullSnapshot.refMap[0]).toBeNull();
    expect(payload.fullSnapshot.refMap[1]).toEqual({
      ref: 'ref_fallback_2',
      selector: 'a.second',
    });

    expect(payload.interactiveElements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ref: 'ref_fallback_2', name: 'Second link', role: 'link' }),
      ]),
    );
    expect(payload.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetRef: 'ref_fallback_2',
          actionType: 'click',
          locatorChain: expect.arrayContaining([
            expect.objectContaining({ type: 'css', value: 'a.second' }),
          ]),
        }),
      ]),
    );
  });

  it('surfaces complete visible text as a body-region route hint without dumping the body', async () => {
    const longBody = [
      '基于你提出的“一切皆对象”与“万物互联”思想，我对物模型进行了体系化扩展。',
      '这段正文故意模拟分享页里可见但结构稀疏的长文本内容，用来证明 read_page 能识别完整正文存在。',
      'AI 助手应看到 completeTextRegion 证据，然后按需调用 chrome_get_web_content 获取完整正文。',
    ].join('');
    const repeatedLongBody = longBody.repeat(12);

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5242,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/shared-long-content',
      title: 'Shared Long Content',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(repeatedLongBody);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Shared conversation" [ref=ref_main] (x=300,y=80)',
        '  - article "Shared answer" [ref=ref_answer] (x=360,y=120)',
        '    - generic "短摘要" [ref=ref_summary] (x=360,y=150)',
        '    - generic "已思考（用时 38 秒）" [ref=ref_meta] (x=360,y=190)',
        '  - textbox "发送消息" [ref=ref_input] (x=360,y=600)',
        '  - button "深度思考" [ref=ref_button] (x=520,y=600)',
        '  - link "历史对话" [ref=ref_history] (x=120,y=200) href="/history"',
        '  - generic "侧边栏" [ref=ref_sidebar] (x=80,y=120)',
        '  - generic "页面底部" [ref=ref_footer] (x=80,y=700)',
        '  - generic "更多内容" [ref=ref_more] (x=360,y=240)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_answer', selector: 'article' },
        { ref: 'ref_input', selector: 'textarea' },
        { ref: 'ref_button', selector: 'button.deep' },
        { ref: 'ref_history', selector: 'a.history' },
      ],
      stats: { processed: 10, included: 9, durationMs: 8 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', render: 'markdown' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.completeTextRegion).toMatchObject({
      sourceDataSource: 'web_content_text',
      sourceRoute: 'visible_text_sample',
      completeTextAvailable: true,
      recommendation: 'use_chrome_get_web_content_for_full_body',
      reason: 'complete_visible_text_available_but_structurally_sparse',
    });
    expect(payload.completeTextRegion.normalizedLength).toBeGreaterThan(500);
    expect(payload.markdown).not.toContain(repeatedLongBody);
  });

  it('samples bounded visible text for full deep reads so page regions can recover dynamic state', async () => {
    const visibleText = [
      'window.__APP_STATE__={"authenticated":true,"userInfo":{"id":"private-user-id","displayName":"Private Name"}};',
      'Home Messages Notifications Publish navigation area.',
      'Warning: optional browser capability unavailable.',
      'Main feed content '.repeat(40),
    ].join(' ');

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5249,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/dynamic-app',
      title: 'Dynamic App',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const visibleTextSpy = vi
      .spyOn(readPageTool as any, 'sampleVisibleTextContent')
      .mockResolvedValue(visibleText);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- document "Dynamic App" [ref=ref_doc] (x=0,y=0)',
        '  - generic "" [ref=ref_generic_1] (x=10,y=10)',
        '  - generic "" [ref=ref_generic_2] (x=20,y=20)',
        '  - generic "" [ref=ref_generic_3] (x=30,y=30)',
      ].join('\n'),
      refMap: [{ ref: 'ref_generic_1', selector: 'main' }],
      stats: { processed: 4, included: 4, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'full', depth: 8 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(visibleTextSpy).toHaveBeenCalled();
    expect(payload.pageRegions.map((item: any) => item.regionType)).toEqual(
      expect.arrayContaining(['account', 'navigation', 'content', 'feedback']),
    );
    expect(payload.pageRegions.find((item: any) => item.regionType === 'account')).toMatchObject({
      state: 'logged_in_candidate',
      targetability: 'not_clickable',
    });
    expect(payload.pageOperationMap.zones.map((item: any) => item.purpose)).toEqual(
      expect.arrayContaining(['account', 'navigate', 'read_content', 'observe_feedback']),
    );
    expect(
      payload.pageOperationMap.zones.find((item: any) => item.purpose === 'account'),
    ).toMatchObject({
      label: 'account area candidate',
      readiness: 'not_targetable',
    });
    const serialized = JSON.stringify(payload.pageRegions);
    expect(serialized).not.toContain('private-user-id');
    expect(serialized).not.toContain('Private Name');
    expect(JSON.stringify(payload.pageOperationMap)).not.toContain('private-user-id');
    expect(JSON.stringify(payload.pageOperationMap)).not.toContain('Private Name');
  });

  it('keeps complete visible text route hints when visible rows are already usable', async () => {
    const longBody = [
      '如下是我个人对物模型的设想和定义。',
      '物模型包含静态属性、时序属性、可控调节属性和服务/动作。',
      '这段长内容模拟分享页中已经被结构化 rows 捕获，但仍需要完整正文 route hint。',
    ].join('');
    const repeatedLongBody = longBody.repeat(10);

    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5243,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/shared-rows-and-long-content',
      title: 'Shared Rows And Long Content',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sampleVisibleTextContent').mockResolvedValue(repeatedLongBody);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Shared conversation" [ref=ref_main] (x=300,y=80)',
        '  - article "Shared answer" [ref=ref_card_1] (x=360,y=120)',
        `    - link "${longBody}" [ref=ref_card_1_link] (x=360,y=150) href="/share/answer-1"`,
        '    - generic "来自分享的对话" [ref=ref_card_1_source] (x=360,y=190)',
        '  - article "Shared answer" [ref=ref_card_2] (x=360,y=460)',
        '    - link "根据你的解释 哪可控调节属性 是不是也归属到 服务/动作中？" [ref=ref_card_2_link] (x=360,y=490) href="/share/answer-2"',
        '    - generic "继续聊" [ref=ref_card_2_source] (x=360,y=530)',
        '    - generic "正文段落 A" [ref=ref_card_1_body_a] (x=360,y=220)',
        '    - generic "正文段落 B" [ref=ref_card_1_body_b] (x=360,y=250)',
        '    - generic "正文段落 C" [ref=ref_card_1_body_c] (x=360,y=280)',
        '    - generic "正文段落 D" [ref=ref_card_1_body_d] (x=360,y=310)',
        '    - generic "正文段落 E" [ref=ref_card_1_body_e] (x=360,y=340)',
        '    - generic "正文段落 F" [ref=ref_card_1_body_f] (x=360,y=370)',
        '    - generic "正文段落 G" [ref=ref_card_1_body_g] (x=360,y=400)',
        '    - generic "正文段落 H" [ref=ref_card_1_body_h] (x=360,y=430)',
        '  - textbox "发送消息" [ref=ref_input] (x=360,y=600)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_card_1_link', selector: 'a[href="/share/answer-1"]' },
        { ref: 'ref_card_2_link', selector: 'a[href="/share/answer-2"]' },
        { ref: 'ref_input', selector: 'textarea' },
      ],
      stats: { processed: 20, included: 3, durationMs: 12 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', render: 'markdown' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.visibleRegionRows.visibleRegionRowsUsed).toBe(true);
    expect(payload.completeTextRegion).toMatchObject({
      completeTextAvailable: true,
      recommendation: 'use_chrome_get_web_content_for_full_body',
    });
    expect(payload.completeTextRegion.normalizedLength).toBeGreaterThan(500);
    expect(payload.markdown).not.toContain(repeatedLongBody);
  });

  it('returns recent_input when tab is inactive but system idle state is active', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5301,
      windowId: 1,
      active: false,
      status: 'complete',
      url: 'https://example.com/background-tab',
      title: 'Background Tab',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Background" [ref=ref_0] (x=320,y=100)',
        '  - heading "Dashboard" [ref=ref_1] (x=320,y=140)',
        '  - link "Home" [ref=ref_2] (x=320,y=180)',
        '  - link "Settings" [ref=ref_3] (x=320,y=220)',
        '  - button "Refresh" [ref=ref_4] (x=320,y=260)',
        '  - generic "Status" [ref=ref_5] (x=320,y=300)',
        '  - generic "Metrics" [ref=ref_6] (x=320,y=340)',
        '  - generic "Activity" [ref=ref_7] (x=320,y=380)',
        '  - generic "Footer" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a[href="/home"]' },
        { ref: 'ref_3', selector: 'a[href="/settings"]' },
        { ref: 'ref_4', selector: 'button.refresh' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 5301 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.isCurrentTabActive).toBe(false);
    expect(payload.isCurrentWindowFocused).toBe(true);
    expect(payload.pageProjection.userActivityLevel).toBe('recent_input');
  });
  it('returns loading stability when tab status is loading', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6401,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'https://example.com/test-6401',
      title: 'Test Tab 6401',
    });
    Object.defineProperty(readPageTool, 'waitForTabSettled', {
      value: vi.fn().mockResolvedValue({
        tab: {
          id: 6401,
          windowId: 1,
          active: true,
          status: 'loading',
          url: 'https://example.com/test-6401',
          title: 'Test Tab 6401',
        },
        settled: false,
        timedOut: true,
        reason: 'timeout',
        waitedMs: 100,
        readyState: null,
      }),
      writable: true,
      configurable: true,
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6401 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.pageProjection.stability).toBe('loading');
  });

  it('returns stale stability when tab is discarded', async () => {
    (chrome.tabs.get as any).mockResolvedValueOnce({
      id: 6402,
      windowId: 1,
      active: false,
      status: 'complete',
      discarded: true,
      url: 'https://example.com/test-6402',
      title: 'Test Tab 6402',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('idle');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6402 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.pageProjection.stability).toBe('stale');
  });

  it('returns stale stability when tab status is unloaded', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6403,
      windowId: 1,
      active: false,
      status: 'unloaded',
      url: 'https://example.com/test-6403',
      title: 'Test Tab 6403',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('idle');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6403 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.pageProjection.stability).toBe('stale');
  });

  it('returns none when tab is inactive and system is locked', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5302,
      windowId: 1,
      active: false,
      status: 'complete',
      url: 'https://example.com/locked-tab',
      title: 'Locked Tab',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('locked');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Locked" [ref=ref_0] (x=320,y=100)',
        '  - heading "Session" [ref=ref_1] (x=320,y=140)',
        '  - link "Login" [ref=ref_2] (x=320,y=180)',
        '  - link "Help" [ref=ref_3] (x=320,y=220)',
        '  - button "Retry" [ref=ref_4] (x=320,y=260)',
        '  - generic "Info" [ref=ref_5] (x=320,y=300)',
        '  - generic "Details" [ref=ref_6] (x=320,y=340)',
        '  - generic "Options" [ref=ref_7] (x=320,y=380)',
        '  - generic "Footer" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a[href="/login"]' },
        { ref: 'ref_3', selector: 'a[href="/help"]' },
        { ref: 'ref_4', selector: 'button.retry' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 5302 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.isCurrentTabActive).toBe(false);
    expect(payload.isCurrentWindowFocused).toBe(true);
    expect(payload.pageProjection.userActivityLevel).toBe('none');
  });

  it('returns recent_input when window is unfocused but system idle state is active', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5303,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/unfocused-window',
      title: 'Unfocused Window',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: false });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '- main "Unfocused" [ref=ref_0] (x=320,y=100)',
        '  - heading "Editor" [ref=ref_1] (x=320,y=140)',
        '  - link "File" [ref=ref_2] (x=320,y=180)',
        '  - link "Edit" [ref=ref_3] (x=320,y=220)',
        '  - button "Save" [ref=ref_4] (x=320,y=260)',
        '  - generic "Canvas" [ref=ref_5] (x=320,y=300)',
        '  - generic "Layers" [ref=ref_6] (x=320,y=340)',
        '  - generic "Properties" [ref=ref_7] (x=320,y=380)',
        '  - generic "Toolbar" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a[href="/file"]' },
        { ref: 'ref_3', selector: 'a[href="/edit"]' },
        { ref: 'ref_4', selector: 'button.save' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 5303 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.isCurrentTabActive).toBe(true);
    expect(payload.isCurrentWindowFocused).toBe(false);
    expect(payload.pageProjection.userActivityLevel).toBe('recent_input');
  });

  it('includes sourceTruthChain with correct primaryOrigin in projection output', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6501,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/test-6501',
      title: 'Test Tab 6501',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6501 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.pageProjection.sourceTruthChain).toBeDefined();
    expect(payload.pageProjection.sourceTruthChain.primaryOrigin).toMatch(
      /^(dom|accessibility|api|cdp|text|browser_runtime|inference|unknown)$/,
    );
    expect(Array.isArray(payload.pageProjection.sourceTruthChain.fieldProvenances)).toBe(true);
    expect(payload.pageProjection.sourceTruthChain.fieldProvenances.length).toBeGreaterThan(0);
    expect(Date.parse(payload.pageProjection.sourceTruthChain.provenanceCreatedAt)).not.toBeNaN();
  });

  it('marks browser runtime metadata fields with browser_runtime origin', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6502,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/test-6502',
      title: 'Test Tab 6502',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6502 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    const { fieldProvenances } = payload.pageProjection.sourceTruthChain;
    const runtimeFields = [
      'pageProjection.pageId',
      'pageProjection.tabId',
      'pageProjection.stability',
    ];
    for (const field of runtimeFields) {
      expect(fieldProvenances).toContainEqual(
        expect.objectContaining({ field, origin: 'browser_runtime', isFact: true }),
      );
    }
  });

  it('marks inferred fields (pageRole and activeRegion) as non-fact in sourceTruthChain', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6502,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/test-6502',
      title: 'Test Tab 6502',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6502 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    const { fieldProvenances } = payload.pageProjection.sourceTruthChain;
    const pageRoleProv = fieldProvenances.find(
      (fp: { field: string; origin: string; isFact: boolean }) =>
        fp.field === 'pageProjection.pageRole',
    );
    const activeRegionProv = fieldProvenances.find(
      (fp: { field: string; origin: string; isFact: boolean }) =>
        fp.field === 'pageProjection.activeRegion',
    );
    expect(payload.pageProjection.pageRole).toBe('unknown');
    expect(pageRoleProv).toBeDefined();
    expect(pageRoleProv.origin).toBe('inference');
    expect(pageRoleProv.isFact).toBe(false);
    expect(activeRegionProv).toBeDefined();
    expect(activeRegionProv.origin).toBe('inference');
    expect(activeRegionProv.isFact).toBe(false);
  });

  it('maps every sourceTruthChain field provenance to an actual pageProjection property', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 6503,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://example.com/test-6503',
      title: 'Test Tab 6503',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1, focused: true });
    (chrome.idle.queryState as any).mockResolvedValue('active');
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        '  - generic "Row0" [ref=ref_0] (x=320,y=100)',
        '  - generic "Row1" [ref=ref_1] (x=320,y=140)',
        '  - generic "Row2" [ref=ref_2] (x=320,y=180)',
        '  - generic "Row3" [ref=ref_3] (x=320,y=220)',
        '  - generic "Row4" [ref=ref_4] (x=320,y=260)',
        '  - generic "Row5" [ref=ref_5] (x=320,y=300)',
        '  - generic "Row6" [ref=ref_6] (x=320,y=340)',
        '  - generic "Row7" [ref=ref_7] (x=320,y=380)',
        '  - generic "Row8" [ref=ref_8] (x=320,y=420)',
      ].join('\n'),
      refMap: [
        { ref: 'ref_2', selector: 'a.a' },
        { ref: 'ref_3', selector: 'a.b' },
        { ref: 'ref_4', selector: 'button.c' },
      ],
      stats: { processed: 10, included: 9, durationMs: 5 },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'compact', tabId: 6503 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    for (const provenance of payload.pageProjection.sourceTruthChain.fieldProvenances) {
      expect(hasNestedOwnProperty(payload, provenance.field)).toBe(true);
    }
  });
});
