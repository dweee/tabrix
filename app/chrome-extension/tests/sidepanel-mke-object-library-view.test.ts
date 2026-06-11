import { describe, expect, it } from 'vitest';
import type { MkeBrowserObjectSummary } from '@tabrix/shared';
import { buildMkeObjectLibraryView } from '@/entrypoints/sidepanel/tabs/mke-object-library-view';

const NOW = '2026-06-10T10:00:00.000Z';

function object(input: Partial<MkeBrowserObjectSummary>): MkeBrowserObjectSummary {
  return {
    browserObjectId: input.browserObjectId ?? `${input.objectType}-1`,
    objectType: input.objectType ?? 'unknown',
    siteFamily: input.siteFamily ?? 'example.test',
    currentRoute: input.currentRoute ?? 'https://example.test/search',
    rootRoute: input.rootRoute ?? 'https://example.test/search',
    pageModelKey: input.pageModelKey ?? 'tab:example.test',
    objectFingerprint: input.objectFingerprint ?? `${input.objectType}:example.test`,
    observationCount: input.observationCount ?? 1,
    redactionState: input.redactionState ?? 'redacted',
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
    ...input,
  };
}

describe('MKE Object Library view model', () => {
  it('groups a browser tab with page objects, actions, data API hints, and lifecycle state', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'window-focused',
        objectType: 'window',
        siteFamily: 'browser',
        currentRoute: 'browser',
        rootRoute: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: 'window:10',
        isActive: true,
        facts: { activeTabId: 20, focused: true },
      }),
      object({
        browserObjectId: 'tab-active',
        objectType: 'tab',
        browserContextKey: 'bridge-connection-1',
        objectFingerprint: 'tab:10:20',
        isActive: true,
        canTabrixOperate: true,
        tabStatus: 'complete',
        facts: { titleSummary: 'Search results - Example' },
        display: { title: 'Search results - Example', locationLabel: 'example.test' },
      }),
      object({
        browserObjectId: 'page-active',
        objectType: 'page',
        browserContextKey: 'mcp:auto:tab:20',
        objectFingerprint: 'page:example.test:search_results:20',
        pageRole: 'search_results',
      }),
      object({
        browserObjectId: 'region-form',
        objectType: 'region',
        browserContextKey: 'mcp:auto:tab:20',
        facts: { regionType: 'form' },
      }),
      object({
        browserObjectId: 'target-submit',
        objectType: 'action_target',
        browserContextKey: 'mcp:auto:tab:20',
        actionTypes: ['click'],
        canTabrixOperate: true,
      }),
      object({
        browserObjectId: 'api-list',
        objectType: 'data_source',
        browserContextKey: 'mcp:auto:tab:20',
        selectedDataSource: 'api_endpoint_list',
      }),
      object({
        browserObjectId: 'tab-closed',
        objectType: 'tab',
        currentRoute: 'https://example.test/closed',
        rootRoute: 'https://example.test/closed',
        pageModelKey: 'tab:closed.example.test',
        objectFingerprint: 'tab:closed.example.test',
        lifecycleState: 'closed',
        canTabrixOperate: false,
        isActive: false,
        display: { title: 'Closed Dashboard', locationLabel: 'example.test/closed' },
      }),
    ]);

    const activePage = view.webPages[0];
    expect(activePage).toMatchObject({
      id: 'tab-active',
      title: 'Search results - Example',
      lifecycleLabel: '前台页',
    });
    expect(activePage.sections.map((section) => section.title)).toEqual([
      '页面对象',
      '可操作功能',
      '数据/API',
      '生命周期',
    ]);
    expect(activePage.sections[0].items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '页面', value: '1 个' }),
        expect.objectContaining({ label: '表单', value: '1 个' }),
      ]),
    );
    expect(activePage.sections[1].items).toContainEqual(
      expect.objectContaining({ label: '点击', value: '1 个目标' }),
    );
    expect(activePage.sections[2].items).toContainEqual(
      expect.objectContaining({ label: '接口线索', value: '已观察' }),
    );
    expect(activePage.sections[3].items).toContainEqual(
      expect.objectContaining({ label: '浏览器加载', value: '已完成' }),
    );

    const closedPage = view.webPages.find((page) => page.id === 'tab-closed');
    expect(closedPage).toMatchObject({
      lifecycleLabel: '已关闭',
      isClosed: true,
    });
  });

  it('keeps stale snapshot evidence separate from tab lifecycle', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'tab-stale',
        objectType: 'tab',
        currentRoute: 'https://example.test/stale',
        rootRoute: 'https://example.test/stale',
        objectFingerprint: 'tab:example.test:stale',
        sourceFreshness: 'stale',
        canTabrixOperate: true,
        tabStatus: 'complete',
        display: { title: 'Stale Snapshot', locationLabel: 'example.test/stale' },
      }),
    ]);

    const page = view.webPages[0];
    expect(page.lifecycleLabel).toBe('已打开');
    expect(page.sections[3].items).toContainEqual(
      expect.objectContaining({ label: '证据新鲜度', value: '快照待同步' }),
    );
    expect(page.sections[3].items).toContainEqual(
      expect.objectContaining({ label: '浏览器加载', value: '已完成' }),
    );
  });

  it('labels only the focused window active tab as the foreground page', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'window-focused',
        objectType: 'window',
        siteFamily: 'browser',
        currentRoute: 'browser',
        rootRoute: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: 'window:10',
        isActive: true,
        facts: { activeTabId: 21, focused: true },
      }),
      object({
        browserObjectId: 'window-background',
        objectType: 'window',
        siteFamily: 'browser',
        currentRoute: 'browser',
        rootRoute: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: 'window:11',
        isActive: false,
        facts: { activeTabId: 22, focused: false },
      }),
      object({
        browserObjectId: 'tab-focused',
        objectType: 'tab',
        objectFingerprint: 'tab:10:21',
        isActive: true,
        canTabrixOperate: true,
        display: { title: 'Focused tab', locationLabel: 'focused.example' },
      }),
      object({
        browserObjectId: 'tab-background-window-active',
        objectType: 'tab',
        objectFingerprint: 'tab:11:22',
        isActive: true,
        canTabrixOperate: true,
        display: { title: 'Background window selected tab', locationLabel: 'background.example' },
      }),
    ]);

    expect(view.webPages.map((page) => [page.id, page.lifecycleLabel])).toEqual([
      ['tab-focused', '前台页'],
      ['tab-background-window-active', '已打开'],
    ]);
    expect(view.webPages.filter((page) => page.lifecycleLabel === '前台页')).toHaveLength(1);
  });

  it('uses a single active tab as the foreground page when window focus evidence is missing', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'tab-only-active',
        objectType: 'tab',
        objectFingerprint: 'tab:10:51',
        isActive: true,
        canTabrixOperate: true,
        display: { title: 'Only active tab', locationLabel: 'only-active.example' },
      }),
      object({
        browserObjectId: 'tab-open',
        objectType: 'tab',
        objectFingerprint: 'tab:10:52',
        isActive: false,
        canTabrixOperate: true,
        display: { title: 'Open tab', locationLabel: 'open.example' },
      }),
    ]);

    expect(view.webPages.map((page) => [page.id, page.lifecycleLabel])).toEqual([
      ['tab-only-active', '前台页'],
      ['tab-open', '已打开'],
    ]);
  });

  it('does not guess the foreground page when multiple active-tab hints conflict', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'tab-window-1-active',
        objectType: 'tab',
        objectFingerprint: 'tab:10:61',
        isActive: true,
        canTabrixOperate: true,
        display: { title: 'Window 1 active tab', locationLabel: 'window-1.example' },
      }),
      object({
        browserObjectId: 'tab-window-2-active',
        objectType: 'tab',
        objectFingerprint: 'tab:11:62',
        isActive: true,
        canTabrixOperate: true,
        display: { title: 'Window 2 active tab', locationLabel: 'window-2.example' },
      }),
    ]);

    expect(view.webPages.map((page) => [page.id, page.lifecycleLabel])).toEqual([
      ['tab-window-1-active', '已打开'],
      ['tab-window-2-active', '已打开'],
    ]);
    expect(view.webPages.filter((page) => page.lifecycleLabel === '前台页')).toHaveLength(0);
  });

  it('keeps the webpage status vocabulary to five user-facing states', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'window-focused',
        objectType: 'window',
        siteFamily: 'browser',
        currentRoute: 'browser',
        rootRoute: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: 'window:10',
        isActive: true,
        facts: { activeTabId: 31, focused: true },
      }),
      object({
        browserObjectId: 'tab-foreground',
        objectType: 'tab',
        objectFingerprint: 'tab:10:31',
        isActive: true,
        canTabrixOperate: true,
        tabStatus: 'complete',
        display: { title: 'Foreground', locationLabel: 'foreground.example' },
      }),
      object({
        browserObjectId: 'tab-open',
        objectType: 'tab',
        objectFingerprint: 'tab:10:32',
        isActive: false,
        canTabrixOperate: true,
        tabStatus: 'complete',
        updatedAt: '2026-06-10T09:59:00.000Z',
        display: { title: 'Open', locationLabel: 'open.example' },
      }),
      object({
        browserObjectId: 'tab-loading',
        objectType: 'tab',
        objectFingerprint: 'tab:10:33',
        isActive: false,
        canTabrixOperate: true,
        tabStatus: 'loading',
        updatedAt: '2026-06-10T09:58:00.000Z',
        display: { title: 'Loading', locationLabel: 'loading.example' },
      }),
      object({
        browserObjectId: 'tab-limited',
        objectType: 'tab',
        objectFingerprint: 'tab:10:34',
        isActive: false,
        canTabrixOperate: false,
        tabStatus: 'complete',
        updatedAt: '2026-06-10T09:57:00.000Z',
        display: { title: 'Limited', locationLabel: 'chrome://newtab/' },
      }),
      object({
        browserObjectId: 'tab-closed',
        objectType: 'tab',
        objectFingerprint: 'tab:10:35',
        lifecycleState: 'closed',
        canTabrixOperate: false,
        updatedAt: '2026-06-10T09:56:00.000Z',
        display: { title: 'Closed', locationLabel: 'closed.example' },
      }),
    ]);

    expect(view.webPages.map((page) => [page.id, page.lifecycleLabel])).toEqual([
      ['tab-foreground', '前台页'],
      ['tab-open', '已打开'],
      ['tab-loading', '加载中'],
      ['tab-limited', '受限页'],
      ['tab-closed', '已关闭'],
    ]);
    expect(new Set(view.webPages.map((page) => page.lifecycleLabel))).toEqual(
      new Set(['前台页', '已打开', '加载中', '受限页', '已关闭']),
    );
  });

  it('shows a foreground tab as limited when Tabrix cannot operate it', () => {
    const view = buildMkeObjectLibraryView([
      object({
        browserObjectId: 'window-focused',
        objectType: 'window',
        siteFamily: 'browser',
        currentRoute: 'browser',
        rootRoute: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: 'window:10',
        isActive: true,
        facts: { activeTabId: 41, focused: true },
      }),
      object({
        browserObjectId: 'tab-foreground-limited',
        objectType: 'tab',
        objectFingerprint: 'tab:10:41',
        isActive: true,
        canTabrixOperate: false,
        operabilityReason: 'browser_internal_page',
        tabStatus: 'complete',
        display: { title: 'Extensions', locationLabel: 'chrome://extensions/' },
      }),
    ]);

    expect(view.webPages[0]).toMatchObject({
      id: 'tab-foreground-limited',
      lifecycleLabel: '受限页',
      lifecycleTone: 'warn',
    });
    expect(view.webPages[0].sections[3].items).toContainEqual(
      expect.objectContaining({ label: '操作能力', value: '受限', tone: 'warn' }),
    );
  });
});
