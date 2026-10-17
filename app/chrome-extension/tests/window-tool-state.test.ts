import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowTool } from '@/entrypoints/background/tools/browser/window';
import { resetBrowserWorldInventoryForTests } from '@/entrypoints/background/browser-world-inventory';

function setWindows(windows: chrome.windows.Window[]) {
  (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows = {
    getAll: vi.fn().mockResolvedValue(windows),
  };
}

function parseResult(result: Awaited<ReturnType<typeof windowTool.execute>>) {
  return JSON.parse((result.content[0] as { text: string }).text) as WindowToolResultPayload;
}

type WindowToolResultPayload = {
  windows: Array<{
    tabs: Array<{ tabId: number; active: boolean; pageState: string; pageStateLabel: string }>;
  }>;
  currentPage?: { tabId: number; pageState: string };
  compactSummary: {
    stateCounts: Record<string, number>;
    windows: Array<{ tabs: unknown[] }>;
  };
};

describe('get_windows_and_tabs product surface', () => {
  beforeEach(() => {
    resetBrowserWorldInventoryForTests();
    setWindows([]);
  });

  it('returns tab page states without exposing internal AI routing commentary', async () => {
    setWindows([
      {
        id: 10,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs: [
          {
            id: 101,
            url: 'https://example.test/',
            pendingUrl: '',
            title: 'Example',
            active: false,
            status: 'complete',
          },
          {
            id: 102,
            url: 'https://example.test/search',
            pendingUrl: '',
            title: 'Search',
            active: true,
            status: 'loading',
          },
        ],
      },
    ] as chrome.windows.Window[]);

    const result = await windowTool.execute();
    const payload = parseResult(result);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      source: 'chrome_windows_get_all',
      windowCount: 1,
      tabCount: 2,
      currentPage: {
        tabId: 102,
        windowId: 10,
        title: 'Search',
        url: 'https://example.test/search',
        pageState: 'foreground',
        pageStateLabel: '前台页',
        loadState: 'loading',
      },
      compactSummary: {
        stateCounts: {
          foreground: 1,
          running: 1,
          loading: 0,
          closed: 0,
          restricted: 0,
        },
      },
    });
    expect(payload.compactSummary.windows[0].tabs).toHaveLength(2);
    expect(payload.compactSummary).not.toHaveProperty('aiRoutingBrief');
    expect(payload.compactSummary).not.toHaveProperty('operationTargetBrief');
    expect(payload.compactSummary).not.toHaveProperty('aiActionReadiness');
    expect(payload.compactSummary).not.toHaveProperty('claimBoundary');
    expect(payload).not.toHaveProperty('baselineReadiness');
  });

  it('marks browser-restricted pages as restricted instead of pretending they are operable', async () => {
    setWindows([
      {
        id: 20,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs: [
          {
            id: 201,
            url: 'chrome://extensions/',
            pendingUrl: '',
            title: 'Extensions',
            active: true,
            status: 'complete',
          },
        ],
      },
    ] as chrome.windows.Window[]);

    const payload = parseResult(await windowTool.execute());

    expect(payload.currentPage).toMatchObject({
      tabId: 201,
      pageState: 'restricted',
      pageStateLabel: '受限页',
      canTabrixOperate: false,
    });
    expect(payload.compactSummary.stateCounts).toMatchObject({
      restricted: 1,
      foreground: 0,
    });
  });

  it('uses the global browser active tab as the only foreground page', async () => {
    setWindows([
      {
        id: 21,
        state: 'normal',
        focused: false,
        type: 'normal',
        incognito: false,
        tabs: [
          {
            id: 211,
            url: 'https://background.example/',
            pendingUrl: '',
            title: 'Background active tab',
            active: true,
            status: 'complete',
          },
        ],
      },
      {
        id: 22,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs: [
          {
            id: 221,
            url: 'https://foreground.example/',
            pendingUrl: '',
            title: 'Foreground active tab',
            active: true,
            status: 'complete',
          },
        ],
      },
    ] as chrome.windows.Window[]);

    const payload = parseResult(await windowTool.execute());
    const allTabs = payload.windows.flatMap((window) => window.tabs);

    expect(payload.currentPage).toMatchObject({ tabId: 221, pageState: 'foreground' });
    expect(payload.compactSummary.stateCounts).toMatchObject({
      foreground: 1,
      running: 1,
    });
    expect(allTabs.find((tab) => tab.tabId === 211)).toMatchObject({
      active: true,
      pageState: 'running',
      pageStateLabel: '运行中',
    });
    expect(allTabs.find((tab) => tab.tabId === 221)).toMatchObject({
      active: true,
      pageState: 'foreground',
      pageStateLabel: '前台页',
    });
  });

  it('keeps compact tab lists bounded while preserving the active tab', async () => {
    const tabs = Array.from({ length: 20 }, (_, index) => {
      const id = 101 + index;
      return {
        id,
        url: `https://example.test/${id}`,
        pendingUrl: '',
        title: `Tab ${id}`,
        active: id === 120,
        status: 'complete',
      };
    });
    setWindows([
      {
        id: 30,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs,
      },
    ] as chrome.windows.Window[]);

    const payload = parseResult(await windowTool.execute());

    expect(payload.tabCount).toBe(20);
    expect(payload.currentPage).toMatchObject({ tabId: 120, pageState: 'foreground' });
    expect(payload.compactSummary.windows[0]).toMatchObject({
      windowId: 30,
      tabCount: 20,
      omittedTabCount: 8,
    });
    expect(payload.compactSummary.windows[0].tabs).toHaveLength(12);
    expect(payload.compactSummary.windows[0].tabs.at(-1)).toMatchObject({
      tabId: 120,
      active: true,
      pageState: 'foreground',
    });
    expect(payload.compactSummary.tabIds.running).toMatchObject({
      ids: Array.from({ length: 12 }, (_, index) => 101 + index),
      omittedCount: 7,
    });
  });
});
