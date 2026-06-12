import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowTool } from '@/entrypoints/background/tools/browser/window';
import { resetBrowserWorldInventoryForTests } from '@/entrypoints/background/browser-world-inventory';

function setWindows(windows: chrome.windows.Window[]) {
  (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows = {
    getAll: vi.fn().mockResolvedValue(windows),
  };
}

function parseResult(result: Awaited<ReturnType<typeof windowTool.execute>>) {
  return JSON.parse((result.content[0] as { text: string }).text);
}

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
