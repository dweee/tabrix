import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserWorldSnapshot,
  initBrowserWorldInventory,
  markBrowserWorldTabAiCreated,
  markBrowserWorldTabAiOperated,
  refreshBrowserWorldSnapshot,
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
    windowBoundsChanged: [] as Listener[],
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
              discarded: false,
              audible: false,
              mutedInfo: { muted: false },
              pinned: false,
            },
            {
              id: 11,
              windowId: 1,
              url: 'chrome://extensions',
              title: 'Extensions',
              active: false,
              status: 'complete',
              discarded: false,
              audible: false,
              mutedInfo: { muted: false },
              pinned: true,
            },
          ],
        },
      ]),
      onCreated: hook(listeners.windowCreated),
      onRemoved: hook(listeners.windowRemoved),
      onFocusChanged: hook(listeners.windowFocusChanged),
      onBoundsChanged: hook(listeners.windowBoundsChanged),
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
    expect(snapshot.summary.activeWindow).toMatchObject({
      windowId: 1,
      state: 'normal',
      visibilityState: 'visible',
      focused: true,
      canTabrixOperate: true,
    });
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      visibilityState: 'visible',
      isFocused: true,
      isMinimized: false,
      activeTabCanOperate: true,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.summary.currentTabObject).toMatchObject({
      objectKind: 'BrowserTabObject',
      tabId: 10,
      windowId: 1,
      url: 'https://example.test/a',
      pendingUrl: '',
      title: 'A',
      active: true,
      status: 'complete',
      discarded: false,
      audible: false,
      muted: false,
      pinned: false,
      openerTabId: null,
      openedBy: 'user_or_page',
      canTabrixOperate: true,
      operabilityReason: 'regular_web_page',
    });
    expect(snapshot.summary.currentTabAttributeGroups).toMatchObject({
      identity: {
        objectKind: 'BrowserTabObject',
        tabId: 10,
        windowId: 1,
        url: 'https://example.test/a',
      },
      runtime: {
        active: true,
        status: 'complete',
        pinned: false,
      },
      ownership: {
        openedBy: 'user_or_page',
        confidence: 0.7,
        aiOperationState: 'idle',
      },
      operability: {
        canTabrixOperate: true,
        reason: 'regular_web_page',
      },
    });
    expect(snapshot.summary.lastAiOperatedTabObject).toBeNull();
    expect(snapshot.summary.lastAiOperatedTabAttributeGroups).toBeNull();
    expect(snapshot.tabs[0]).toMatchObject({
      tabId: 10,
      openedBy: 'user_or_page',
      openedByReason: 'observed_by_chrome_inventory_without_ai_marker',
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
      discarded: false,
      audible: true,
      mutedInfo: { muted: true },
      pinned: true,
      openerTabId: 10,
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
        discarded: false,
        audible: true,
        mutedInfo: { muted: true },
        pinned: true,
        openerTabId: 10,
      },
    );

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.summary.recentChangeSummary).toContain(
      'tab 20 was updated; openedBy=ai, status=complete',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 20 was updated; owner=ai, status=complete',
    );

    listeners.tabActivated[0]?.({ tabId: 20, windowId: 1 });

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.aiOpenedTabIds).toEqual([20]);
    expect(snapshot.browserActiveTabId).toBe(20);
    expect(snapshot.summary.objectChangeConclusion).toContain('Current page object is tab 20');
    expect(snapshot.summary.objectChangeConclusion).toContain('runtime=status complete');
    expect(snapshot.summary.objectChangeConclusion).toContain('ownership=ai');
    expect(snapshot.summary.currentTabObject).toMatchObject({
      tabId: 20,
      status: 'complete',
      discarded: false,
      audible: true,
      muted: true,
      pinned: true,
      openerTabId: 10,
    });
    expect(snapshot.summary.currentTabAttributeGroups).toMatchObject({
      identity: {
        tabId: 20,
        windowId: 1,
        url: 'https://ai-opened.test/done',
      },
      runtime: {
        active: true,
        status: 'complete',
        audible: true,
        muted: true,
        pinned: true,
        openerTabId: 10,
      },
      ownership: {
        openedBy: 'ai',
        confidence: 0.95,
        reason: 'marked_by_tabrix_navigation_before_tabs_onCreated',
        aiOperationState: 'recently_operated',
      },
      operability: {
        canTabrixOperate: true,
        reason: 'regular_web_page',
      },
    });
    expect(snapshot.tabs.find((tab) => tab.tabId === 20)).toMatchObject({
      url: 'https://ai-opened.test/done',
      status: 'complete',
      discarded: false,
      audible: true,
      muted: true,
      pinned: true,
      openerTabId: 10,
      openedBy: 'ai',
      openedByReason: 'marked_by_tabrix_navigation_before_tabs_onCreated',
      active: true,
    });

    listeners.tabRemoved[0]?.(20, { windowId: 1, isWindowClosing: false });
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.some((tab) => tab.tabId === 20)).toBe(false);
    expect(snapshot.summary.objectChangeConclusion).toContain('Page object tab 20 was removed');
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_removed',
      tabId: 20,
      openedBy: 'ai',
    });
    expect(snapshot.recentEvents.some((event) => 'url' in event)).toBe(false);
  });

  it('summarizes tab replacement as an object lifecycle transition', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiCreated(30);
    listeners.tabCreated[0]?.({
      id: 30,
      windowId: 1,
      url: 'https://replace.test/loading',
      title: 'Replacing',
      active: false,
      status: 'loading',
    });
    listeners.tabReplaced[0]?.(31, 30);

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.some((tab) => tab.tabId === 30)).toBe(false);
    expect(snapshot.tabs.find((tab) => tab.tabId === 31)).toMatchObject({
      tabId: 31,
      openedBy: 'ai',
      status: 'loading',
      url: 'https://replace.test/loading',
    });
    expect(snapshot.summary.recentChangeSummary).toContain('tab 30 was replaced by tab 31');
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 30 was replaced by tab 31; owner=ai',
    );
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_replaced',
      tabId: 31,
      replacedTabId: 30,
      openedBy: 'ai',
    });
  });

  it('adds and removes BrowserWindowObject instances with their contained tab objects', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.windowCreated[0]?.({
      id: 2,
      focused: false,
      state: 'normal',
      type: 'normal',
      width: 900,
      height: 700,
      left: 20,
      top: 30,
      tabs: [
        {
          id: 21,
          windowId: 2,
          url: 'https://new-window.test/',
          title: 'New window',
          active: true,
          status: 'complete',
          discarded: false,
          audible: false,
          mutedInfo: { muted: false },
          pinned: false,
        },
      ],
    } as chrome.windows.Window);

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windowCount).toBe(2);
    expect(snapshot.tabCount).toBe(3);
    expect(snapshot.browserActiveTabId).toBe(10);
    expect(snapshot.windows.find((window) => window.windowId === 2)).toMatchObject({
      windowId: 2,
      activeTabId: 21,
      tabCount: 1,
      canTabrixOperate: true,
    });
    expect(snapshot.tabs.find((tab) => tab.tabId === 21)).toMatchObject({
      tabId: 21,
      windowId: 2,
      url: 'https://new-window.test/',
      active: true,
      canTabrixOperate: true,
    });
    expect(snapshot.summary.recentChangeSummary).toContain('window 2 was created');

    listeners.windowRemoved[0]?.(2);
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windowCount).toBe(1);
    expect(snapshot.tabs.some((tab) => tab.windowId === 2)).toBe(false);
    expect(snapshot.summary.recentChangeSummary).toContain('window 2 was removed');
  });

  it('keeps BrowserWindowObject focus and operability in sync when active state changes', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.tabActivated[0]?.({ tabId: 11, windowId: 1 });

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.browserActiveTabId).toBe(11);
    expect(snapshot.windows[0]).toMatchObject({
      activeTabId: 11,
      activeTabCanOperate: false,
      canTabrixOperate: false,
      operabilityReason: 'active_tab_not_operable',
    });

    listeners.windowFocusChanged[0]?.(-1);
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.focusedWindowId).toBeNull();
    expect(snapshot.windows[0]).toMatchObject({
      focused: false,
      isFocused: false,
    });

    listeners.windowFocusChanged[0]?.(1);
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.focusedWindowId).toBe(1);
    expect(snapshot.windows[0]).toMatchObject({
      focused: true,
      isFocused: true,
    });
  });

  it('preserves AI ownership and operation state across full Chrome refreshes', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiCreated(10);
    markBrowserWorldTabAiOperated(10, 'read_page');

    const operated = await getBrowserWorldSnapshot();
    expect(operated.summary.objectChangeConclusion).toContain(
      'Latest AI-operated page object is tab 10',
    );

    const refreshed = await refreshBrowserWorldSnapshot();

    expect(refreshed.aiOpenedTabIds).toEqual([10]);
    expect(refreshed.summary).toMatchObject({
      activeTab: {
        tabId: 10,
        openedBy: 'ai',
        canTabrixOperate: true,
      },
      currentTabObject: {
        tabId: 10,
        url: 'https://example.test/a',
        title: 'A',
        status: 'complete',
        openedBy: 'ai',
        aiOperationState: 'recently_operated',
        lastAiOperation: 'read_page',
        canTabrixOperate: true,
      },
      lastAiOperatedTabObject: {
        tabId: 10,
        openedBy: 'ai',
        aiOperationState: 'recently_operated',
        lastAiOperation: 'read_page',
        canTabrixOperate: true,
      },
      lastAiOperatedTabAttributeGroups: {
        identity: {
          tabId: 10,
          windowId: 1,
        },
        ownership: {
          openedBy: 'ai',
          aiOperationState: 'recently_operated',
          lastAiOperation: 'read_page',
        },
        operability: {
          canTabrixOperate: true,
        },
      },
      counts: {
        windows: 1,
        tabs: 2,
        aiOpenedTabs: 1,
        userOrPageOpenedTabs: 1,
        operableTabs: 1,
      },
    });
    expect(refreshed.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      openedBy: 'ai',
      openedByReason: 'marked_by_tabrix_navigation_result',
      aiOperationState: 'recently_operated',
      lastAiOperation: 'read_page',
      canTabrixOperate: true,
    });
    expect(refreshed.summary.objectChangeConclusion).toContain(
      'Latest AI-operated page object is tab 10',
    );
  });

  it('updates BrowserWindowObject operability when window state changes', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.windowBoundsChanged[0]?.({
      id: 1,
      focused: false,
      state: 'minimized',
      type: 'normal',
      tabs: [
        {
          id: 10,
          windowId: 1,
          url: 'https://example.test/a',
          title: 'A',
          active: true,
          status: 'complete',
        },
      ],
    } as chrome.windows.Window);

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      visibilityState: 'minimized',
      isMinimized: true,
      canTabrixOperate: false,
      operabilityReason: 'window_minimized',
    });
    expect(snapshot.summary.recentChangeSummary).toContain('bounds or state changed');

    listeners.windowBoundsChanged[0]?.({
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
      ],
    } as chrome.windows.Window);

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      visibilityState: 'visible',
      isMinimized: false,
      isFocused: true,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.summary.objectChangeConclusion).toContain('visibility=visible');
  });

  it('caps recent browser lifecycle events under high tab churn without storing URLs in events', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    for (let index = 0; index < 60; index += 1) {
      const tabId = 1000 + index;
      listeners.tabUpdated[0]?.(
        tabId,
        { status: 'complete' },
        {
          id: tabId,
          windowId: 1,
          url: `https://bulk-tabs.test/${index}`,
          title: `Bulk ${index}`,
          active: false,
          status: 'complete',
        },
      );
    }

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.recentEvents).toHaveLength(50);
    expect(snapshot.recentEvents[0]).toMatchObject({
      eventKind: 'tab_updated',
      tabId: 1010,
    });
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_updated',
      tabId: 1059,
    });
    expect(snapshot.recentEvents.some((event) => 'url' in event)).toBe(false);
  });
});
