import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserWorldSnapshot,
  initBrowserWorldInventory,
  markBrowserWorldTabAiCreated,
  resetBrowserWorldInventoryForTests,
} from '@/entrypoints/background/browser-world-inventory';

type Listener = (...args: any[]) => void;

function hook(bucket: Listener[]) {
  return {
    addListener: vi.fn((listener: Listener) => bucket.push(listener)),
    removeListener: vi.fn((listener: Listener) => {
      const index = bucket.indexOf(listener);
      if (index >= 0) bucket.splice(index, 1);
    }),
  };
}

describe('browser world inventory', () => {
  const listeners = {
    tabCreated: [] as Listener[],
    tabUpdated: [] as Listener[],
    tabRemoved: [] as Listener[],
    tabActivated: [] as Listener[],
    tabReplaced: [] as Listener[],
    windowCreated: [] as Listener[],
    windowRemoved: [] as Listener[],
    windowFocusChanged: [] as Listener[],
  };

  beforeEach(() => {
    resetBrowserWorldInventoryForTests();
    for (const bucket of Object.values(listeners)) bucket.length = 0;
    (chrome.tabs as any).onCreated = hook(listeners.tabCreated);
    (chrome.tabs as any).onUpdated = hook(listeners.tabUpdated);
    (chrome.tabs as any).onRemoved = hook(listeners.tabRemoved);
    (chrome.tabs as any).onActivated = hook(listeners.tabActivated);
    (chrome.tabs as any).onReplaced = hook(listeners.tabReplaced);
    (chrome as any).windows = {
      getAll: vi.fn().mockResolvedValue([
        {
          id: 1,
          focused: true,
          state: 'normal',
          type: 'normal',
          width: 1280,
          height: 720,
          left: 0,
          top: 0,
          tabs: [
            {
              id: 10,
              windowId: 1,
              url: 'https://example.test/a',
              title: 'A',
              active: true,
              status: 'complete',
            },
            {
              id: 11,
              windowId: 1,
              url: 'chrome://extensions',
              title: 'Extensions',
              active: false,
              status: 'complete',
            },
          ],
        },
      ]),
      onCreated: hook(listeners.windowCreated),
      onRemoved: hook(listeners.windowRemoved),
      onFocusChanged: hook(listeners.windowFocusChanged),
    };
  });

  it('keeps a local window/tab snapshot without a bridge connection', async () => {
    initBrowserWorldInventory();

    const snapshot = await getBrowserWorldSnapshot();

    expect(snapshot.source).toBe('extension_browser_world_inventory');
    expect(snapshot.windowCount).toBe(1);
    expect(snapshot.tabCount).toBe(2);
    expect(snapshot.focusedWindowId).toBe(1);
    expect(snapshot.browserActiveTabId).toBe(10);
    expect(snapshot.userOrPageOpenedTabIds).toEqual([10, 11]);
    expect(snapshot.operableTabIds).toEqual([10]);
    expect(snapshot.tabs[0]).toMatchObject({
      tabId: 10,
      openedBy: 'user_or_page',
      canTabrixOperate: true,
    });
    expect(snapshot.tabs[1]).toMatchObject({
      tabId: 11,
      canTabrixOperate: false,
      operabilityReason: 'browser_internal_page',
    });
  });

  it('tracks tab create, update, activation, close, and AI ownership marks locally', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiCreated(20);
    listeners.tabCreated[0]?.({
      id: 20,
      windowId: 1,
      url: 'https://ai-opened.test/',
      title: 'AI opened',
      active: false,
      status: 'loading',
    });
    listeners.tabUpdated[0]?.(
      20,
      { status: 'complete' },
      {
        id: 20,
        windowId: 1,
        url: 'https://ai-opened.test/done',
        title: 'AI opened done',
        active: false,
        status: 'complete',
      },
    );
    listeners.tabActivated[0]?.({ tabId: 20, windowId: 1 });

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.aiOpenedTabIds).toEqual([20]);
    expect(snapshot.browserActiveTabId).toBe(20);
    expect(snapshot.tabs.find((tab) => tab.tabId === 20)).toMatchObject({
      url: 'https://ai-opened.test/done',
      openedBy: 'ai',
      active: true,
    });

    listeners.tabRemoved[0]?.(20, { windowId: 1, isWindowClosing: false });
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.some((tab) => tab.tabId === 20)).toBe(false);
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_removed',
      tabId: 20,
      openedBy: 'ai',
    });
  });
});
