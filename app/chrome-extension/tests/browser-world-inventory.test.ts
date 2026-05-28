import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserWorldSnapshot,
  initBrowserWorldInventory,
  markBrowserWorldTabAiCreated,
  markBrowserWorldTabAiOperated,
  refreshBrowserWorldSnapshot,
  resetBrowserWorldInventoryForTests,
} from '@/entrypoints/background/browser-world-inventory';

type Listener = (...args: any[]) => void;

const FORBIDDEN_EVENT_KEYS = [
  'url',
  'rawUrl',
  'privateUrl',
  'pendingUrl',
  'title',
  'rawTitle',
  'pageText',
  'markdown',
  'screenshot',
  'screenshots',
  'rawScreenshot',
  'rawImage',
  'cookie',
  'cookies',
  'authorization',
  'authToken',
  'token',
  'secret',
  'networkRequest',
  'networkResponse',
  'networkBody',
  'rawNetworkBody',
  'requestBody',
  'responseBody',
  'account',
  'accountId',
  'accountName',
  'accountState',
  'profileName',
  'qrCode',
  'qrImage',
  'qrPayload',
];

const FORBIDDEN_EVENT_STRING_PATTERNS = [
  /https?:\/\//i,
  /data:image\//i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
  /\b(?:Cookie|Set-Cookie):\s*[^;\s=]+=/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
];

function hook(bucket: Listener[]) {
  return {
    addListener: vi.fn((listener: Listener) => bucket.push(listener)),
    removeListener: vi.fn((listener: Listener) => {
      const index = bucket.indexOf(listener);
      if (index >= 0) bucket.splice(index, 1);
    }),
  };
}

function expectRecentEventsPublicSafe(events: Array<Record<string, unknown>>) {
  for (const event of events) {
    for (const key of FORBIDDEN_EVENT_KEYS) {
      expect(event).not.toHaveProperty(key);
    }
  }
  const serialized = JSON.stringify(events);
  for (const pattern of FORBIDDEN_EVENT_STRING_PATTERNS) {
    expect(serialized).not.toMatch(pattern);
  }
}

describe('browser world inventory', () => {
  const listeners = {
    tabCreated: [] as Listener[],
    tabUpdated: [] as Listener[],
    tabRemoved: [] as Listener[],
    tabActivated: [] as Listener[],
    tabReplaced: [] as Listener[],
    tabAttached: [] as Listener[],
    tabDetached: [] as Listener[],
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
    (chrome.tabs as any).onAttached = hook(listeners.tabAttached);
    (chrome.tabs as any).onDetached = hook(listeners.tabDetached);
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a local window/tab snapshot without a bridge connection', async () => {
    initBrowserWorldInventory();

    const snapshot = await getBrowserWorldSnapshot();

    expect(snapshot.source).toBe('extension_browser_world_inventory');
    expect(snapshot.windowCount).toBe(1);
    expect(snapshot.tabCount).toBe(2);
    expect(snapshot.retentionPolicy).toMatchObject({
      recentEventLimit: 50,
      windowObjectsRetained: 1,
      tabObjectsRetained: 2,
      refreshMode: 'event_driven_with_on_demand_chrome_resync',
      minFullChromeResyncIntervalMs: 250,
    });
    expect(snapshot.refreshHealth).toMatchObject({
      fullChromeResyncCount: expect.any(Number),
      skippedChromeResyncCount: 0,
      minFullChromeResyncIntervalMs: 250,
      lastFullChromeResyncStatus: 'success',
      lastFullChromeResyncReason: 'initial_seed',
      lastRefreshDecision: 'full_chrome_resync',
    });
    expect(snapshot.refreshHealth.fullChromeResyncCount).toBeGreaterThanOrEqual(1);
    expect(snapshot.refreshHealth.lastFullChromeResyncDurationMs).not.toBeNull();
    expect(snapshot.retentionPolicy.recentEventsRetained).toBeGreaterThanOrEqual(1);
    expect(snapshot.retentionPolicy.recentEventsRetained).toBeLessThanOrEqual(
      snapshot.retentionPolicy.recentEventLimit,
    );
    expect(snapshot.retentionPolicy.eventPrivacyBoundary).toContain('do not retain tab URLs');
    expect(snapshot.retentionPolicy.detailBoundary).toContain('live tab URLs and titles');
    expect(snapshot.focusedWindowId).toBe(1);
    expect(snapshot.browserActiveTabId).toBe(10);
    expect(snapshot.userOrPageOpenedTabIds).toEqual([10, 11]);
    expect(snapshot.operableTabIds).toEqual([10]);
    expect(snapshot.summary.primaryConclusion).toBe(
      'Browser object snapshot: focusedWindow=1, visibility=visible, operable=yes; activeTab=10, status=complete, owner=user_or_page, source=user_or_unknown, operable=yes; latestAiTab=none, relation=no_ai_operation_observed; inventory=windows:1, tabs:2, ai:0, page:0, userOrUnknown:2, userOrPage:2, operable:1; recent=Last change: browser world inventory was refreshed from Chrome.; next=read_or_select_intended_target',
    );
    expect(snapshot.summary.activeWindow).toMatchObject({
      windowId: 1,
      state: 'normal',
      visibilityState: 'visible',
      focused: true,
      canTabrixOperate: true,
    });
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      total: 1,
      visible: 1,
      minimized: 0,
      unknownVisibility: 0,
      focused: 1,
      unfocused: 0,
      focusUnknown: 0,
      operable: 1,
      inoperable: 0,
      operabilityUnknown: 0,
      stateCounts: { normal: 1 },
      typeCounts: { normal: 1 },
    });
    expect(snapshot.summary.windowStateConclusion).toContain(
      'Window object matrix: 1 window(s), visible=1, minimized=0, focused=1, operable=1',
    );
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 1,
      focusedWindowState: 'normal',
      focusedWindowVisibilityState: 'visible',
      focusedWindowCanOperate: true,
      focusedWindowActiveTabId: 10,
      focusedWindowActiveTabCanOperate: true,
      relationToCurrentOperableWindow: 'focused_window_visible_operable',
      canOperateFocusedWindow: true,
      visibleWindowCount: 1,
      minimizedWindowCount: 0,
      operableWindowCount: 1,
      inoperableWindowCount: 0,
    });
    expect(snapshot.summary.currentWindowConclusion).toContain(
      'focused window 1 is visible and operable',
    );
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: null,
      latestEventWindowId: null,
      retainedWindowCount: 1,
      focusedWindowId: 1,
      visibleWindowCount: 1,
      minimizedWindowCount: 0,
      operableWindowCount: 1,
    });
    expect(snapshot.summary.windowLifecycleConclusion).toContain(
      'Window object lifecycle: no window lifecycle event observed',
    );
    expect(snapshot.summary.tabStateMatrix).toMatchObject({
      total: 2,
      active: 1,
      background: 1,
      activityUnknown: 0,
      loading: 0,
      complete: 2,
      statusUnknown: 0,
      discarded: 0,
      audible: 0,
      muted: 0,
      pinned: 1,
      withOpener: 0,
      aiOpened: 0,
      userOrPageOpened: 2,
      pageOpened: 0,
      userOrUnknownOpened: 2,
      unknownOpened: 0,
      recentlyOperatedByAi: 0,
      idleForAi: 2,
      closedRetained: 0,
      operable: 1,
      inoperable: 1,
      operabilityUnknown: 0,
      statusCounts: { complete: 2 },
      ownerCounts: { ai: 0, user_or_page: 2, unknown: 0 },
      openedBySourceCounts: { ai_tool: 0, page_opener: 0, user_or_unknown: 2, unknown: 0 },
    });
    expect(snapshot.summary.tabStateConclusion).toContain(
      'Tab page object matrix: 2 tab(s), active=1, background=1',
    );
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: null,
      latestEventTabId: null,
      latestEventWindowId: null,
      latestEventStatus: null,
      latestReplacedTabId: null,
      recentCreatedCount: 0,
      recentUpdatedCount: 0,
      recentActivatedCount: 0,
      recentReplacedCount: 0,
      recentRemovedCount: 0,
      retainedTabCount: 2,
      activeTabId: 10,
      aiOpenedRetainedCount: 0,
      userOrPageOpenedRetainedCount: 2,
    });
    expect(snapshot.summary.tabLifecycleConclusion).toContain('no tab lifecycle event observed');
    expect(snapshot.summary.aiOperationState).toMatchObject({
      browserActiveTabId: 10,
      latestAiOperatedTabId: null,
      latestAiOperation: null,
      latestAiOperatedTabActive: null,
      relationToBrowserActiveTab: 'no_ai_operation_observed',
      canContinueOnLatestAiOperatedTab: null,
      aiOpenedTabCount: 0,
      recentlyOperatedTabCount: 0,
      closedRetainedTabCount: 0,
    });
    expect(snapshot.summary.currentOperationConclusion).toBe(
      'Current operation object: no AI-operated tab page object has been observed yet.',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toBe(
      'Browser object edge state: windows total=1, visible=1, minimized=0, focused=1, operable=1; tabs total=2, active=1, background=1, loading=0, operable=1, aiOpened=0, pageOpened=0, userOrUnknownOpened=2, userOrPageOpened=2; currentWindow=focused_window_visible_operable; currentOperation=no_ai_operation_observed',
    );
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
      openedBySource: 'user_or_unknown',
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
        openedBySource: 'user_or_unknown',
        confidence: 0.55,
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
      openedBySource: 'user_or_unknown',
      openedByReason: 'observed_by_chrome_inventory_without_ai_marker_or_opener',
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

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      activeTabId: 10,
      activeTabCanOperate: true,
      tabCount: 3,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_created',
      latestEventTabId: 20,
      retainedTabCount: 3,
      activeTabId: 10,
    });

    listeners.tabUpdated[0]?.(
      20,
      {
        url: 'https://ai-opened.test/done',
        title: 'AI opened done',
        status: 'complete',
        audible: true,
        mutedInfo: { muted: true },
        pinned: true,
        discarded: false,
      },
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

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.summary.recentChangeSummary).toContain(
      'tab 20 was updated; changed=url,title,status,audible,muted,pinned,discarded, openedBy=ai, status=complete',
    );
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_updated',
      latestEventTabId: 20,
      latestEventWindowId: 1,
      latestEventStatus: 'complete',
      latestUrlChanged: true,
      latestTitleChanged: true,
      latestStatusChanged: true,
      latestAudibleChanged: true,
      latestMutedChanged: true,
      latestPinnedChanged: true,
      latestDiscardedChanged: true,
      recentCreatedCount: 1,
      recentUpdatedCount: 1,
      recentUrlChangedCount: 1,
      recentTitleChangedCount: 1,
      recentStatusChangedCount: 1,
      recentAudibleChangedCount: 1,
      recentMutedChangedCount: 1,
      recentPinnedChangedCount: 1,
      recentDiscardedChangedCount: 1,
      recentActivatedCount: 0,
      recentReplacedCount: 0,
      recentRemovedCount: 0,
      retainedTabCount: 3,
      activeTabId: 10,
      aiOpenedRetainedCount: 1,
      userOrPageOpenedRetainedCount: 2,
    });
    expect(snapshot.summary.tabLifecycleConclusion).toContain('latest=tab_updated, tab=20');
    expect(snapshot.summary.tabLifecycleConclusion).toContain(
      'changed=url,title,status,audible,muted,pinned,discarded',
    );
    expect(snapshot.summary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: tab 20 was updated; changed=url,title,status,audible,muted,pinned,discarded, owner=ai, status=complete, currentActiveTab=10, latestAiOperated=yes.',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 20 was updated; changed=url,title,status,audible,muted,pinned,discarded, owner=ai, status=complete',
    );
    expect(snapshot.summary.objectChangeSummary).toBe(
      'Object change summary: the latest AI-operated page tab 20 changed attributes=url,title,status,audible,muted,pinned,discarded with status complete; active tab 10 is complete and operable; AI last operated tab 20, but the active tab is 10; reselect or reread before continuing.',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'activeTab=10, status=complete, owner=user_or_page, source=user_or_unknown, operable=yes',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'latestAiTab=20, relation=latest_ai_operated_background_tab, canContinue=no',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'next=reselect_or_reread_latest_ai_operated_tab',
    );
    expect(snapshot.summary.aiOperationState).toMatchObject({
      browserActiveTabId: 10,
      latestAiOperatedTabId: 20,
      latestAiOperation: 'tab_created',
      latestAiOperationConfidence: 0.95,
      latestAiOperationReason: 'marked_by_tabrix_navigation_before_tabs_onCreated',
      latestAiOperatedTabActive: false,
      latestAiOperatedTabOpenedBy: 'ai',
      latestAiOperatedTabCanOperate: true,
      relationToBrowserActiveTab: 'latest_ai_operated_background_tab',
      canContinueOnLatestAiOperatedTab: false,
      aiOpenedTabCount: 1,
      recentlyOperatedTabCount: 1,
    });
    expect(snapshot.summary.currentOperationConclusion).toContain(
      'latest AI-operated tab 20 is not browser-active',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toBe(
      'Browser object edge state: windows total=1, visible=1, minimized=0, focused=1, operable=1; tabs total=3, active=1, background=2, loading=0, operable=2, aiOpened=1, pageOpened=0, userOrUnknownOpened=2, userOrPageOpened=2; currentWindow=focused_window_visible_operable; currentOperation=latest_ai_operated_background_tab',
    );

    listeners.tabActivated[0]?.({ tabId: 20, windowId: 1 });

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.aiOpenedTabIds).toEqual([20]);
    expect(snapshot.browserActiveTabId).toBe(20);
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_activated',
      latestEventTabId: 20,
      latestEventWindowId: 1,
      recentCreatedCount: 1,
      recentUpdatedCount: 1,
      recentActivatedCount: 1,
      activeTabId: 20,
    });
    expect(snapshot.summary.objectChangeConclusion).toContain('Current page object is tab 20');
    expect(snapshot.summary.objectChangeSummary).toBe(
      'Object change summary: current page switched to tab 20; active tab 20 is complete and operable; AI can continue on tab 20 if the next page-level check still passes.',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'activeTab=20, status=complete, owner=ai, source=ai_tool, operable=yes',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'latestAiTab=20, relation=same_as_browser_active, canContinue=yes',
    );
    expect(snapshot.summary.primaryConclusion).toContain(
      'next=page_level_read_or_postcondition_check',
    );
    expect(snapshot.summary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: current page object switched to tab 20; owner=ai, status=complete, operable=yes, focusedWindow=1.',
    );
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
    expect(snapshot.summary.tabStateMatrix).toMatchObject({
      total: 3,
      active: 1,
      background: 2,
      complete: 3,
      audible: 1,
      muted: 1,
      pinned: 2,
      withOpener: 1,
      aiOpened: 1,
      userOrPageOpened: 2,
      recentlyOperatedByAi: 1,
      idleForAi: 2,
      operable: 2,
      inoperable: 1,
      statusCounts: { complete: 3 },
      ownerCounts: { ai: 1, user_or_page: 2, unknown: 0 },
    });
    expect(snapshot.summary.tabStateConclusion).toContain('activeTab=20');
    expect(snapshot.summary.aiOperationState).toMatchObject({
      browserActiveTabId: 20,
      latestAiOperatedTabId: 20,
      latestAiOperation: 'tab_created',
      latestAiOperatedTabActive: true,
      latestAiOperatedTabOpenedBy: 'ai',
      latestAiOperatedTabCanOperate: true,
      relationToBrowserActiveTab: 'same_as_browser_active',
      canContinueOnLatestAiOperatedTab: true,
      aiOpenedTabCount: 1,
      recentlyOperatedTabCount: 1,
    });
    expect(snapshot.summary.currentOperationConclusion).toContain(
      'latest AI-operated tab 20 is also the browser-active tab',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toBe(
      'Browser object edge state: windows total=1, visible=1, minimized=0, focused=1, operable=1; tabs total=3, active=1, background=2, loading=0, operable=2, aiOpened=1, pageOpened=0, userOrUnknownOpened=2, userOrPageOpened=2; currentWindow=focused_window_visible_operable; currentOperation=same_as_browser_active',
    );
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
    expect(snapshot.windows[0]).toMatchObject({
      activeTabId: null,
      activeTabCanOperate: null,
      tabCount: 2,
      canTabrixOperate: null,
      operabilityReason: 'active_tab_operability_unknown',
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_removed',
      latestEventTabId: 20,
      latestEventWindowId: 1,
      latestEventStatus: null,
      recentRemovedCount: 1,
      retainedTabCount: 2,
    });
    expect(snapshot.summary.tabLifecycleConclusion).toContain('latest=tab_removed, tab=20');
    expect(snapshot.summary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: tab 20 was removed; previousOwner=ai, retainedTabs=2, aiOpenedRetained=0, activeTab=unknown.',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain('Page object tab 20 was removed');
    expect(snapshot.summary.objectChangeSummary).toBe(
      'Object change summary: tab 20 was removed; retained tabs=2; active tab=unknown; the removed tab was AI-owned, so do not continue on tab 20.',
    );
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_removed',
      tabId: 20,
      openedBy: 'ai',
    });
    expectRecentEventsPublicSafe(snapshot.recentEvents);
  });

  it('resyncs the window active tab immediately when a new active tab is created', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.tabCreated[0]?.({
      id: 21,
      windowId: 1,
      url: 'https://active-new.test/',
      title: 'Active new',
      active: true,
      status: 'complete',
      discarded: false,
      audible: false,
      mutedInfo: { muted: false },
      pinned: false,
      openerTabId: 10,
    });

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.browserActiveTabId).toBe(21);
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      activeTabId: 21,
      activeTabCanOperate: true,
      tabCount: 3,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({ active: false });
    expect(snapshot.tabs.find((tab) => tab.tabId === 21)).toMatchObject({
      active: true,
      openedBy: 'user_or_page',
      canTabrixOperate: true,
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_created',
      latestEventTabId: 21,
      retainedTabCount: 3,
      activeTabId: 21,
    });
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
    expect(snapshot.summary.tabStateMatrix).toMatchObject({
      total: 3,
      loading: 1,
      complete: 2,
      aiOpened: 1,
      recentlyOperatedByAi: 1,
      statusCounts: { complete: 2, loading: 1 },
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_replaced',
      latestEventTabId: 31,
      latestReplacedTabId: 30,
      recentCreatedCount: 1,
      recentReplacedCount: 1,
      retainedTabCount: 3,
    });
    expect(snapshot.summary.tabLifecycleConclusion).toContain(
      'latest=tab_replaced, tab=31, replacedTab=30',
    );
    expect(snapshot.summary.recentChangeSummary).toContain('tab 30 was replaced by tab 31');
    expect(snapshot.summary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: tab 30 was replaced by tab 31; owner=ai, retainedTabs=3, activeTab=10.',
    );
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

  it('preserves close-request AI operation evidence when removing a user-opened tab', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiOperated(10, 'close_tabs_requested');
    listeners.tabRemoved[0]?.(10, { windowId: 1, isWindowClosing: false });

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.some((tab) => tab.tabId === 10)).toBe(false);
    expect(snapshot.windows[0]).toMatchObject({
      activeTabId: null,
      activeTabCanOperate: null,
      tabCount: 1,
      canTabrixOperate: null,
      operabilityReason: 'active_tab_operability_unknown',
    });
    expect(snapshot.summary.recentChangeSummary).toContain(
      'tab 10 was removed; previousOpenedBy=user_or_page, lastAiOperation=close_tabs_requested',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 10 was removed; previousOwner=user_or_page, lastAiOperation=close_tabs_requested',
    );
    expect(snapshot.summary.objectChangeSummary).toBe(
      'Object change summary: tab 10 was removed; retained tabs=1; active tab=unknown; the removed tab had AI operation close_tabs_requested, so do not continue on tab 10.',
    );
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_removed',
      tabId: 10,
      windowId: 1,
      openedBy: 'user_or_page',
      aiOperation: 'close_tabs_requested',
      aiOperationReason: 'marked_by_tabrix_tool_execution:close_tabs_requested',
    });
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('example.test');
  });

  it('applies pending AI operation evidence when a tab is observed after the tool call', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiOperated(40, 'read_page');
    listeners.tabCreated[0]?.({
      id: 40,
      windowId: 1,
      url: 'https://late-observed.test/',
      title: 'Late observed',
      active: false,
      status: 'complete',
      discarded: false,
      audible: false,
      mutedInfo: { muted: false },
      pinned: false,
    });

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.aiOpenedTabIds).toEqual([]);
    expect(snapshot.userOrPageOpenedTabIds).toEqual([10, 11, 40]);
    expect(snapshot.tabs.find((tab) => tab.tabId === 40)).toMatchObject({
      tabId: 40,
      openedBy: 'user_or_page',
      openedBySource: 'user_or_unknown',
      openedByConfidence: 0.55,
      aiOperationState: 'recently_operated',
      lastAiOperation: 'read_page',
      lastAiOperationConfidence: 0.95,
      lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
      canTabrixOperate: true,
    });
    expect(snapshot.summary.aiOperationState).toMatchObject({
      browserActiveTabId: 10,
      latestAiOperatedTabId: 40,
      latestAiOperation: 'read_page',
      latestAiOperationConfidence: 0.95,
      latestAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
      latestAiOperatedTabOpenedBy: 'user_or_page',
      relationToBrowserActiveTab: 'latest_ai_operated_background_tab',
      canContinueOnLatestAiOperatedTab: false,
    });
    expect(snapshot.summary.currentOperationConclusion).toContain(
      'latest AI-operated tab 40 is not browser-active',
    );
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_created',
      tabId: 40,
      openedBy: 'user_or_page',
      status: 'complete',
    });
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('late-observed.test');
  });

  it('summarizes multi-tab cleanup as one dynamic object-state conclusion', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    for (const tabId of [21, 22]) {
      markBrowserWorldTabAiCreated(tabId);
      listeners.tabCreated[0]?.({
        id: tabId,
        windowId: 1,
        url: `https://cleanup-tabs.test/${tabId}`,
        title: `Cleanup ${tabId}`,
        active: false,
        status: 'complete',
      });
    }

    listeners.tabRemoved[0]?.(21, { windowId: 1, isWindowClosing: false });
    listeners.tabRemoved[0]?.(22, { windowId: 1, isWindowClosing: false });

    const snapshot = await getBrowserWorldSnapshot();

    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_removed',
      latestEventTabId: 22,
      recentCreatedCount: 2,
      recentRemovedCount: 2,
      retainedTabCount: 2,
      activeTabId: 10,
      aiOpenedRetainedCount: 0,
    });
    expect(snapshot.summary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: 2 tab page object(s) were removed recently; latestRemovedTab=22, previousOwner=ai, retainedTabs=2, aiOpenedRetained=0, activeTab=10.',
    );
    expect(snapshot.recentEvents.some((event) => 'url' in event)).toBe(false);
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('cleanup-tabs.test');
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
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: 'window_created',
      latestEventWindowId: 2,
      latestEventState: 'normal',
      latestEventVisibilityState: 'visible',
      latestEventCanTabrixOperate: true,
      recentCreatedCount: 1,
      retainedWindowCount: 2,
      focusedWindowId: 1,
    });
    expect(snapshot.summary.windowLifecycleConclusion).toContain('latest=window_created, window=2');

    listeners.windowRemoved[0]?.(2);
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windowCount).toBe(1);
    expect(snapshot.tabs.some((tab) => tab.windowId === 2)).toBe(false);
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'window_removed',
      windowId: 2,
      removedTabCount: 1,
      removedAiOpenedTabCount: 0,
    });
    expect(snapshot.summary.recentChangeSummary).toContain(
      'window 2 was removed; removedTabs=1, removedAiOpenedTabs=0',
    );
    expect(snapshot.summary.dynamicObjectUpdateSummary).toContain(
      'window 2 was removed; removedTabs=1, removedAiOpenedTabs=0',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Window object 2 was removed; removedTabs=1, removedAiOpenedTabs=0',
    );
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: 'window_removed',
      latestEventWindowId: 2,
      latestRemovedTabCount: 1,
      latestRemovedAiOpenedTabCount: 0,
      recentCreatedCount: 1,
      recentRemovedCount: 1,
      retainedWindowCount: 1,
      focusedWindowId: 1,
    });
    expect(snapshot.summary.windowLifecycleConclusion).toContain(
      'latest=window_removed, window=2, removedTabs=1',
    );
  });

  it('keeps only the newly created focused BrowserWindowObject focused', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.windowCreated[0]?.({
      id: 2,
      focused: true,
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
          url: 'https://focused-window.test/',
          title: 'Focused window',
          active: true,
          status: 'complete',
          discarded: false,
          audible: false,
          mutedInfo: { muted: false },
          pinned: false,
        },
      ],
    } as chrome.windows.Window);

    const snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.focusedWindowId).toBe(2);
    expect(snapshot.browserActiveTabId).toBe(21);
    expect(snapshot.windows.find((window) => window.windowId === 1)).toMatchObject({
      windowId: 1,
      focused: false,
      isFocused: false,
    });
    expect(snapshot.windows.find((window) => window.windowId === 2)).toMatchObject({
      windowId: 2,
      focused: true,
      isFocused: true,
      activeTabId: 21,
      activeTabCanOperate: true,
      canTabrixOperate: true,
    });
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      total: 2,
      focused: 1,
      unfocused: 1,
      operable: 2,
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 2,
      focusedWindowActiveTabId: 21,
      relationToCurrentOperableWindow: 'focused_window_visible_operable',
      canOperateFocusedWindow: true,
    });
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: 'window_created',
      latestEventWindowId: 2,
      retainedWindowCount: 2,
      focusedWindowId: 2,
      visibleWindowCount: 2,
      operableWindowCount: 2,
    });
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
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      total: 1,
      focused: 0,
      unfocused: 1,
      operable: 0,
      inoperable: 1,
      operabilityUnknown: 0,
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: null,
      relationToCurrentOperableWindow: 'no_focused_window',
      canOperateFocusedWindow: null,
      visibleWindowCount: 1,
      operableWindowCount: 0,
      inoperableWindowCount: 1,
    });
    expect(snapshot.summary.currentWindowConclusion).toContain('no focused browser window');
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: 'window_focus_changed',
      latestEventWindowId: -1,
      recentFocusChangedCount: 1,
      retainedWindowCount: 1,
      focusedWindowId: null,
    });

    listeners.windowFocusChanged[0]?.(1);
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.focusedWindowId).toBe(1);
    expect(snapshot.windows[0]).toMatchObject({
      focused: true,
      isFocused: true,
    });
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      focused: 1,
      unfocused: 0,
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 1,
      relationToCurrentOperableWindow: 'focused_window_not_operable',
      canOperateFocusedWindow: false,
    });
    expect(snapshot.summary.windowLifecycleState).toMatchObject({
      latestEventKind: 'window_focus_changed',
      latestEventWindowId: 1,
      recentFocusChangedCount: 2,
      retainedWindowCount: 1,
      focusedWindowId: 1,
    });
  });

  it('refreshes BrowserWindowObject operability when the active tab URL changes', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.tabUpdated[0]?.(
      10,
      { status: 'complete', url: 'chrome://settings' },
      {
        id: 10,
        windowId: 1,
        url: 'chrome://settings',
        title: 'Settings',
        active: true,
        status: 'complete',
      },
    );

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      tabId: 10,
      active: true,
      canTabrixOperate: false,
      operabilityReason: 'browser_internal_page',
    });
    expect(snapshot.windows[0]).toMatchObject({
      activeTabId: 10,
      activeTabCanOperate: false,
      canTabrixOperate: false,
      operabilityReason: 'active_tab_not_operable',
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 1,
      focusedWindowActiveTabCanOperate: false,
      relationToCurrentOperableWindow: 'focused_window_not_operable',
    });

    listeners.tabUpdated[0]?.(
      10,
      { status: 'complete', url: 'https://example.test/restored' },
      {
        id: 10,
        windowId: 1,
        url: 'https://example.test/restored',
        title: 'Restored',
        active: true,
        status: 'complete',
      },
    );

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      tabId: 10,
      active: true,
      canTabrixOperate: true,
      operabilityReason: 'regular_web_page',
    });
    expect(snapshot.windows[0]).toMatchObject({
      activeTabId: 10,
      activeTabCanOperate: true,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 1,
      focusedWindowActiveTabCanOperate: true,
      relationToCurrentOperableWindow: 'focused_window_visible_operable',
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
        lastAiOperationConfidence: 0.95,
        lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
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
          lastAiOperationConfidence: 0.95,
          lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
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
      tabStateMatrix: {
        total: 2,
        aiOpened: 1,
        userOrPageOpened: 1,
        recentlyOperatedByAi: 1,
        idleForAi: 1,
        operable: 1,
        inoperable: 1,
      },
      aiOperationState: {
        browserActiveTabId: 10,
        latestAiOperatedTabId: 10,
        latestAiOperation: 'read_page',
        latestAiOperationConfidence: 0.95,
        latestAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
        latestAiOperatedTabActive: true,
        latestAiOperatedTabOpenedBy: 'ai',
        latestAiOperatedTabCanOperate: true,
        relationToBrowserActiveTab: 'same_as_browser_active',
        canContinueOnLatestAiOperatedTab: true,
        aiOpenedTabCount: 1,
        recentlyOperatedTabCount: 1,
        closedRetainedTabCount: 0,
      },
    });
    expect(refreshed.summary.currentOperationConclusion).toContain(
      'latest AI-operated tab 10 is also the browser-active tab',
    );
    expect(refreshed.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      openedBy: 'ai',
      openedByReason: 'marked_by_tabrix_navigation_result',
      aiOperationState: 'recently_operated',
      lastAiOperation: 'read_page',
      lastAiOperationConfidence: 0.95,
      lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
      canTabrixOperate: true,
    });
    expect(refreshed.summary.objectChangeConclusion).toContain(
      'Latest AI-operated page object is tab 10',
    );
  });

  it('does not let repeated Chrome refreshes evict real lifecycle events', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.tabUpdated[0]?.(
      10,
      { status: 'complete' },
      {
        id: 10,
        windowId: 1,
        url: 'https://example.test/a',
        title: 'A refreshed',
        active: true,
        status: 'complete',
      },
    );

    const changed = await getBrowserWorldSnapshot();
    expect(
      changed.recentEvents.filter((event) => event.eventKind === 'inventory_seeded'),
    ).toHaveLength(1);
    expect(changed.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_updated',
      tabId: 10,
    });

    for (let index = 0; index < 60; index += 1) {
      await refreshBrowserWorldSnapshot();
    }

    const refreshed = await getBrowserWorldSnapshot();
    expect(
      refreshed.recentEvents.filter((event) => event.eventKind === 'inventory_seeded'),
    ).toHaveLength(1);
    expect(refreshed.recentEvents.some((event) => event.eventKind === 'tab_updated')).toBe(true);
    expect(refreshed.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_updated',
      latestEventTabId: 10,
      recentUpdatedCount: 1,
    });
  });

  it('throttles repeated full Chrome resyncs while keeping the local snapshot readable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);

    const first = await refreshBrowserWorldSnapshot();
    expect(chrome.windows.getAll).toHaveBeenCalledTimes(1);
    expect(first.refreshHealth).toMatchObject({
      fullChromeResyncCount: 1,
      skippedChromeResyncCount: 0,
      lastFullChromeResyncStatus: 'success',
      lastFullChromeResyncReason: 'on_demand_refresh',
      lastRefreshDecision: 'full_chrome_resync',
    });

    vi.setSystemTime(1_100);
    const skipped = await refreshBrowserWorldSnapshot();
    expect(chrome.windows.getAll).toHaveBeenCalledTimes(1);
    expect(skipped.windowCount).toBe(1);
    expect(skipped.tabCount).toBe(2);
    expect(skipped.refreshHealth).toMatchObject({
      fullChromeResyncCount: 1,
      skippedChromeResyncCount: 1,
      minFullChromeResyncIntervalMs: 250,
      lastRefreshDecision: 'skipped_recent_resync',
    });
    expect(skipped.refreshHealth.lastRefreshDecisionReason).toContain(
      'Browser World snapshot was refreshed recently',
    );

    vi.setSystemTime(1_260);
    const refreshed = await refreshBrowserWorldSnapshot();
    expect(chrome.windows.getAll).toHaveBeenCalledTimes(2);
    expect(refreshed.refreshHealth).toMatchObject({
      fullChromeResyncCount: 2,
      skippedChromeResyncCount: 1,
      lastRefreshDecision: 'full_chrome_resync',
    });
  });

  it('updates BrowserWindowObject operability when window state changes', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    listeners.windowBoundsChanged[0]?.({
      id: 1,
      focused: false,
      state: 'minimized',
      type: 'normal',
    } as chrome.windows.Window);

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      activeTabId: 10,
      activeTabCanOperate: true,
      tabCount: 2,
      visibilityState: 'minimized',
      isMinimized: true,
      canTabrixOperate: false,
      operabilityReason: 'window_minimized',
    });
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      visible: 0,
      minimized: 1,
      focused: 0,
      inoperable: 1,
      stateCounts: { minimized: 1 },
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: null,
      relationToCurrentOperableWindow: 'no_focused_window',
      visibleWindowCount: 0,
      minimizedWindowCount: 1,
      operableWindowCount: 0,
      inoperableWindowCount: 1,
    });
    expect(snapshot.summary.recentChangeSummary).toContain(
      'bounds or state changed; state=minimized, visibility=minimized',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toContain(
      'windows total=1, visible=0, minimized=1, focused=0, operable=0',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toContain('currentWindow=no_focused_window');

    listeners.windowBoundsChanged[0]?.({
      id: 1,
      focused: true,
      state: 'normal',
      type: 'normal',
      width: 1280,
      height: 720,
      left: 0,
      top: 0,
    } as chrome.windows.Window);

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.windows[0]).toMatchObject({
      windowId: 1,
      activeTabId: 10,
      activeTabCanOperate: true,
      tabCount: 2,
      visibilityState: 'visible',
      isMinimized: false,
      isFocused: true,
      canTabrixOperate: true,
      operabilityReason: 'active_tab_operable_in_visible_window',
    });
    expect(snapshot.summary.windowStateMatrix).toMatchObject({
      visible: 1,
      minimized: 0,
      focused: 1,
      operable: 1,
      stateCounts: { normal: 1 },
    });
    expect(snapshot.summary.windowOperationState).toMatchObject({
      focusedWindowId: 1,
      focusedWindowState: 'normal',
      focusedWindowVisibilityState: 'visible',
      focusedWindowCanOperate: true,
      relationToCurrentOperableWindow: 'focused_window_visible_operable',
      canOperateFocusedWindow: true,
    });
    expect(snapshot.summary.currentWindowConclusion).toContain(
      'focused window 1 is visible and operable',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toContain(
      'windows total=1, visible=1, minimized=0, focused=1, operable=1',
    );
    expect(snapshot.summary.browserObjectEdgeSummary).toContain(
      'currentWindow=focused_window_visible_operable',
    );
    expect(snapshot.summary.objectChangeConclusion).toContain('visibility=visible');
  });

  it('tracks tab page object detach and attach across browser windows', async () => {
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
      tabs: [],
    } as chrome.windows.Window);
    listeners.tabDetached[0]?.(10, { oldWindowId: 1, oldPosition: 0 });

    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      tabId: 10,
      windowId: null,
      active: false,
      openedBy: 'user_or_page',
    });
    expect(snapshot.windows.find((window) => window.windowId === 1)).toMatchObject({
      windowId: 1,
      activeTabId: null,
      tabCount: 1,
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_detached',
      latestEventTabId: 10,
      latestEventWindowId: 1,
      recentDetachedCount: 1,
      retainedTabCount: 2,
    });
    expect(snapshot.summary.recentChangeSummary).toContain('tab 10 detached from window 1');
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 10 detached from window 1',
    );
    expect(snapshot.summary.objectChangeSummary).toContain('tab 10 detached from window 1');
    expect(snapshot.summary.dynamicObjectUpdateSummary).toContain('tab 10 detached from window 1');
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_detached',
      tabId: 10,
      windowId: 1,
      oldWindowId: 1,
      openedBy: 'user_or_page',
    });
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('example.test');

    listeners.tabAttached[0]?.(10, { newWindowId: 2, newPosition: 0 });

    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      tabId: 10,
      windowId: 2,
      active: false,
      openedBy: 'user_or_page',
      canTabrixOperate: true,
    });
    expect(snapshot.windows.find((window) => window.windowId === 2)).toMatchObject({
      windowId: 2,
      activeTabId: null,
      tabCount: 1,
      canTabrixOperate: null,
      operabilityReason: 'active_tab_operability_unknown',
    });
    expect(snapshot.summary.tabLifecycleState).toMatchObject({
      latestEventKind: 'tab_attached',
      latestEventTabId: 10,
      latestEventWindowId: 2,
      recentAttachedCount: 1,
      recentDetachedCount: 1,
      retainedTabCount: 2,
    });
    expect(snapshot.summary.recentChangeSummary).toContain('tab 10 attached to window 2');
    expect(snapshot.summary.objectChangeConclusion).toContain(
      'Page object tab 10 attached to window 2',
    );
    expect(snapshot.summary.objectChangeSummary).toContain('tab 10 attached to window 2');
    expect(snapshot.summary.dynamicObjectUpdateSummary).toContain('tab 10 attached to window 2');
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_attached',
      tabId: 10,
      windowId: 2,
      newWindowId: 2,
      openedBy: 'user_or_page',
    });
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('example.test');
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
    expect(snapshot.retentionPolicy).toMatchObject({
      recentEventLimit: 50,
      recentEventsRetained: 50,
      windowObjectsRetained: 1,
      tabObjectsRetained: 62,
    });
    expect(snapshot.recentEvents[0]).toMatchObject({
      eventKind: 'tab_updated',
      tabId: 1010,
    });
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'tab_updated',
      tabId: 1059,
    });
    expectRecentEventsPublicSafe(snapshot.recentEvents);
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('bulk-tabs.test');
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('Bulk 59');
  });

  it('sanitizes AI operation labels before they enter Browser World events', async () => {
    initBrowserWorldInventory();
    await getBrowserWorldSnapshot();

    markBrowserWorldTabAiOperated(10, 'https://private.example.test/token?secret=1');

    const snapshot = await getBrowserWorldSnapshot();

    expect(snapshot.tabs.find((tab) => tab.tabId === 10)).toMatchObject({
      lastAiOperation: 'unknown_ai_operation',
      lastAiOperationReason: 'marked_by_tabrix_tool_execution:unknown_ai_operation',
    });
    expect(snapshot.recentEvents.at(-1)).toMatchObject({
      eventKind: 'ai_tab_marked',
      tabId: 10,
      aiOperation: 'unknown_ai_operation',
      aiOperationReason: 'marked_by_tabrix_tool_execution:unknown_ai_operation',
    });
    expectRecentEventsPublicSafe(snapshot.recentEvents);
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('private.example.test');
    expect(JSON.stringify(snapshot.recentEvents)).not.toContain('secret=1');
  });
});
