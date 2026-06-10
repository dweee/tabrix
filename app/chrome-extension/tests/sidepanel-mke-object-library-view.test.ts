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

    expect(view.summary).toMatchObject({
      liveLabel: '实时监控中',
      openWebPages: 1,
      closedWebPages: 1,
      pageObjects: 2,
      actions: 1,
      dataApis: 1,
    });

    const activePage = view.webPages[0];
    expect(activePage).toMatchObject({
      id: 'tab-active',
      title: 'Search results - Example',
      lifecycleLabel: '当前激活',
      activityLabel: '当前激活',
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
      expect.objectContaining({ label: '浏览器加载', value: '加载完成' }),
    );

    const closedPage = view.webPages.find((page) => page.id === 'tab-closed');
    expect(closedPage).toMatchObject({
      lifecycleLabel: '已关闭',
      activityLabel: '最近关闭',
      isClosed: true,
    });
  });
});
