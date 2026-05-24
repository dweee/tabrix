import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

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
  expect(payload.frameContext).toBeNull();
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
    scopeKind: expect.stringMatching(/^(search|form|long_content|loading|idle|unknown)$/),
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
  expect(payload.L2).toMatchObject({
    available: true,
    defaultAccess: expect.any(String),
    detailRefs: expect.any(Array),
    expansions: expect.any(Array),
    boundary: expect.any(String),
  });
}

describe('read_page mode', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('defaults mode to compact', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 5201,
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

    const result = await readPageTool.execute({});
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(result.isError).toBe(false);
    expectCommonSnapshotShape(payload, 'compact');
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
    expect(payload.pageProjection.userActivityLevel).toBe('active');
    expect(payload.diagnostics).toBeUndefined();
    expect(payload.fullSnapshot).toBeUndefined();
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
          matchReason: expect.stringContaining('primary action'),
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

  it('marks inferred fields (activeRegion) as non-fact in sourceTruthChain', async () => {
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
    const activeRegionProv = fieldProvenances.find(
      (fp: { field: string; origin: string; isFact: boolean }) =>
        fp.field === 'pageProjection.activeRegion',
    );
    expect(
      fieldProvenances.some((fp: { field: string }) => fp.field === 'pageProjection.pageRole'),
    ).toBe(false);
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
