import { describe, expect, it } from 'vitest';
import type { MkeBrowserObjectSummary } from '@tabrix/shared';
import { buildMkeObjectLibraryView } from '@/entrypoints/sidepanel/tabs/mke-object-library-view';

const NOW = '2026-06-10T10:00:00.000Z';

function page(input: Partial<MkeBrowserObjectSummary>): MkeBrowserObjectSummary {
  return {
    objectId: input.objectId ?? 'page-1',
    tabId: input.tabId ?? null,
    title: input.title ?? 'Example page',
    url: input.url ?? 'https://example.test/search',
    location: input.location ?? 'example.test',
    status: input.status ?? 'running',
    detailReason: input.detailReason ?? null,
    createdAt: input.createdAt ?? NOW,
    updatedAt: input.updatedAt ?? NOW,
    ...input,
  };
}

describe('MKE Object Library view model', () => {
  it('turns browser page summaries into a simple tab webpage list', () => {
    const view = buildMkeObjectLibraryView([
      page({
        objectId: 'tab-open',
        tabId: '20',
        title: 'Search results - Example',
        url: 'https://example.test/search?q=ai',
        location: 'example.test/search',
        status: 'running',
      }),
      page({
        objectId: 'tab-closed',
        tabId: '21',
        title: 'Closed Dashboard',
        location: 'example.test/closed',
        status: 'closed',
        updatedAt: '2026-06-10T09:00:00.000Z',
      }),
    ]);

    expect(view.webPages).toHaveLength(2);
    expect(view.webPages[0]).toMatchObject({
      id: 'tab-open',
      tabId: '20',
      title: 'Search results - Example',
      location: 'example.test/search',
      lifecycleLabel: '运行中',
      isClosed: false,
    });
    expect(view.webPages[1]).toMatchObject({
      id: 'tab-closed',
      lifecycleLabel: '已关闭',
      isClosed: true,
    });
    expect(JSON.stringify(view.webPages)).not.toContain('页面对象');
    expect(JSON.stringify(view.webPages)).not.toContain('可操作功能');
    expect(JSON.stringify(view.webPages)).not.toContain('数据/API');
    expect(JSON.stringify(view.webPages)).not.toContain('生命周期');
  });

  it('uses the live Chrome foreground tab id instead of guessing from stored data', () => {
    const view = buildMkeObjectLibraryView(
      [
        page({
          objectId: 'tab-front',
          tabId: '31',
          title: 'Currently viewed page',
          status: 'running',
        }),
        page({
          objectId: 'tab-background',
          tabId: '32',
          title: 'Background page',
          status: 'running',
        }),
      ],
      { foregroundTabId: '31' },
    );

    expect(view.webPages.map((item) => [item.id, item.lifecycleLabel])).toEqual([
      ['tab-front', '前台页'],
      ['tab-background', '运行中'],
    ]);
  });

  it('keeps the webpage status vocabulary to five user-facing states', () => {
    const view = buildMkeObjectLibraryView(
      [
        page({ objectId: 'tab-foreground', tabId: '41', status: 'running' }),
        page({ objectId: 'tab-running', tabId: '42', status: 'running' }),
        page({ objectId: 'tab-loading', tabId: '43', status: 'loading' }),
        page({ objectId: 'tab-closed', tabId: '44', status: 'closed' }),
        page({ objectId: 'tab-restricted', tabId: '45', status: 'restricted' }),
      ],
      { foregroundTabId: '41' },
    );

    expect(view.webPages.map((item) => [item.id, item.lifecycleLabel])).toEqual([
      ['tab-foreground', '前台页'],
      ['tab-running', '运行中'],
      ['tab-loading', '加载中'],
      ['tab-restricted', '受限页'],
      ['tab-closed', '已关闭'],
    ]);
    const labels = new Set(view.webPages.map((item) => item.lifecycleLabel));
    expect(labels).toEqual(new Set(['前台页', '运行中', '加载中', '受限页', '已关闭']));
    expect([...labels]).not.toEqual(expect.arrayContaining(['已完成', '当前激活', '需刷新']));
  });

  it('does not turn closed pages into foreground pages', () => {
    const view = buildMkeObjectLibraryView(
      [page({ objectId: 'tab-closed', tabId: '51', status: 'closed' })],
      { foregroundTabId: '51' },
    );

    expect(view.webPages[0]).toMatchObject({
      lifecycleLabel: '已关闭',
      isClosed: true,
    });
  });
});
