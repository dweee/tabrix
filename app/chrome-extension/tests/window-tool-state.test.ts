import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowTool } from '@/entrypoints/background/tools/browser/window';

describe('get_windows_and_tabs state inventory', () => {
  beforeEach(() => {
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows = {
      getAll: vi.fn(),
    };
  });

  it('includes read-only BrowserWindowObject state fields without changing tab shape', async () => {
    (
      chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }
    ).windows.getAll.mockResolvedValueOnce([
      {
        id: 10,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        width: 1280,
        height: 720,
        left: 100,
        top: 50,
        tabs: [
          {
            id: 101,
            url: 'https://example.test/',
            pendingUrl: '',
            title: 'Example',
            active: false,
            status: 'complete',
            discarded: false,
            audible: false,
            mutedInfo: { muted: false },
            pinned: false,
          },
          {
            id: 102,
            url: 'https://example.test/active',
            pendingUrl: '',
            title: 'Active',
            active: true,
            status: 'loading',
            discarded: false,
            audible: true,
            mutedInfo: { muted: true },
            pinned: true,
            openerTabId: 101,
          },
        ],
      },
      {
        id: 20,
        state: 'minimized',
        focused: false,
        type: 'popup',
        incognito: true,
        tabs: [],
      },
    ] as chrome.windows.Window[]);

    const result = await windowTool.execute();
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      windowCount: 2,
      tabCount: 2,
      compactSummary: {
        activeObject: {
          windowId: 10,
          windowState: 'normal',
          windowVisibilityState: 'visible',
          tabId: 102,
          tabWindowId: 10,
          url: 'https://example.test/active',
          title: 'Active',
          openedBy: 'user_or_page',
          canTabrixOperate: true,
        },
        windows: [
          {
            windowId: 10,
            focused: true,
            activeTabId: 102,
            canTabrixOperate: true,
            tabCount: 2,
            tabs: [
              {
                tabId: 101,
                title: 'Example',
                active: false,
                openedBy: 'user_or_page',
                canTabrixOperate: true,
              },
              {
                tabId: 102,
                title: 'Active',
                active: true,
                openedBy: 'user_or_page',
                canTabrixOperate: true,
              },
            ],
          },
          {
            windowId: 20,
            visibilityState: 'minimized',
            canTabrixOperate: false,
            tabCount: 0,
          },
        ],
        windowStateMatrix: {
          total: 2,
          visible: 1,
          minimized: 1,
          unknownVisibility: 0,
          focused: 1,
          unfocused: 1,
          focusUnknown: 0,
          operable: 1,
          inoperable: 1,
          operabilityUnknown: 0,
          stateCounts: { normal: 1, minimized: 1 },
          typeCounts: { normal: 1, popup: 1 },
        },
        windowStateConclusion:
          'Window object matrix: 2 window(s), visible=1, minimized=1, focused=1, operable=1, focusedWindow=10, focusedWindowOperable=yes.',
        windowOperationState: {
          focusedWindowId: 10,
          focusedWindowState: 'normal',
          focusedWindowVisibilityState: 'visible',
          focusedWindowCanOperate: true,
          focusedWindowActiveTabId: 102,
          focusedWindowActiveTabCanOperate: true,
          relationToCurrentOperableWindow: 'focused_window_visible_operable',
          canOperateFocusedWindow: true,
          visibleWindowCount: 1,
          minimizedWindowCount: 1,
          operableWindowCount: 1,
          inoperableWindowCount: 1,
        },
        currentWindowConclusion:
          'Current window object: focused window 10 is visible and operable; activeTab=102.',
        tabStateMatrix: {
          total: 2,
          active: 1,
          background: 1,
          activityUnknown: 0,
          loading: 1,
          complete: 1,
          statusUnknown: 0,
          discarded: 0,
          audible: 1,
          muted: 1,
          pinned: 1,
          withOpener: 1,
          aiOpened: 0,
          userOrPageOpened: 2,
          unknownOpened: 0,
          recentlyOperatedByAi: 0,
          idleForAi: 2,
          closedRetained: 0,
          operable: 2,
          inoperable: 0,
          operabilityUnknown: 0,
          statusCounts: { complete: 1, loading: 1 },
          ownerCounts: { ai: 0, user_or_page: 2, unknown: 0 },
        },
        tabStateConclusion:
          'Tab page object matrix: 2 tab(s), active=1, background=1, loading=1, complete=1, aiOpened=0, userOrPageOpened=2, operable=2, activeTab=102, latestAiOperatedTab=none.',
        tabLifecycleState: {
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
          activeTabId: 102,
          aiOpenedRetainedCount: 0,
          userOrPageOpenedRetainedCount: 2,
        },
        tabLifecycleConclusion:
          'Tab page object lifecycle: no tab lifecycle event observed; retainedTabs=2, activeTab=102.',
        aiOperationState: {
          browserActiveTabId: 102,
          latestAiOperatedTabId: null,
          latestAiOperation: null,
          latestAiOperationAtMs: null,
          latestAiOperatedTabActive: null,
          latestAiOperatedTabWindowId: null,
          latestAiOperatedTabOpenedBy: null,
          latestAiOperatedTabCanOperate: null,
          relationToBrowserActiveTab: 'no_ai_operation_observed',
          canContinueOnLatestAiOperatedTab: null,
          aiOpenedTabCount: 0,
          recentlyOperatedTabCount: 0,
          closedRetainedTabCount: 0,
        },
        currentOperationConclusion:
          'Current operation object: no AI-operated tab page object has been observed yet.',
        retentionPolicy: {
          recentEventLimit: 50,
          windowObjectsRetained: 2,
          tabObjectsRetained: 2,
          refreshMode: 'event_driven_with_on_demand_chrome_resync',
        },
        claimBoundary:
          'Browser lifecycle summary only; page content, account state, login success, and API/CDP reuse require separate evidence.',
      },
      windows: [
        {
          windowId: 10,
          state: 'normal',
          visibilityState: 'visible',
          focused: true,
          isFocused: true,
          isMinimized: false,
          type: 'normal',
          incognito: false,
          width: 1280,
          height: 720,
          left: 100,
          top: 50,
          activeTabId: 102,
          activeTabCanOperate: true,
          canTabrixOperate: true,
          operabilityReason: 'active_tab_operable_in_visible_window',
          tabCount: 2,
          tabs: [
            {
              tabId: 101,
              url: 'https://example.test/',
              pendingUrl: '',
              title: 'Example',
              active: false,
              status: 'complete',
              discarded: false,
              audible: false,
              muted: false,
              pinned: false,
              openerTabId: null,
              openedBy: 'user_or_page',
              openedByConfidence: 0.7,
              openedByReason: 'observed_by_chrome_inventory_without_ai_marker',
              canTabrixOperate: true,
              operabilityReason: 'regular_web_page',
              aiOperationState: 'idle',
              lastAiOperation: null,
            },
            {
              tabId: 102,
              url: 'https://example.test/active',
              pendingUrl: '',
              title: 'Active',
              active: true,
              status: 'loading',
              discarded: false,
              audible: true,
              muted: true,
              pinned: true,
              openerTabId: 101,
              openedBy: 'user_or_page',
              openedByConfidence: 0.7,
              openedByReason: 'chrome_tabs_openerTabId_present',
              canTabrixOperate: true,
              operabilityReason: 'regular_web_page',
              aiOperationState: 'idle',
              lastAiOperation: null,
            },
          ],
        },
        {
          windowId: 20,
          state: 'minimized',
          visibilityState: 'minimized',
          focused: false,
          isFocused: false,
          isMinimized: true,
          type: 'popup',
          incognito: true,
          width: null,
          height: null,
          left: null,
          top: null,
          activeTabId: null,
          activeTabCanOperate: null,
          canTabrixOperate: false,
          operabilityReason: 'window_minimized',
          tabCount: 0,
          tabs: [],
        },
      ],
    });
  });

  it('keeps compactSummary bounded while preserving full window tab detail', async () => {
    const tabs = Array.from({ length: 20 }, (_, index) => {
      const tabId = 101 + index;
      return {
        id: tabId,
        url: `https://many-tabs.test/${tabId}`,
        pendingUrl: '',
        title: `Tab ${tabId}`,
        active: tabId === 120,
        status: 'complete',
        discarded: false,
        audible: false,
        mutedInfo: { muted: false },
        pinned: false,
      };
    });

    (
      chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }
    ).windows.getAll.mockResolvedValueOnce([
      {
        id: 10,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs,
      },
    ] as chrome.windows.Window[]);

    const result = await windowTool.execute();
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.windowCount).toBe(1);
    expect(payload.tabCount).toBe(20);
    expect(payload.windows[0].tabs).toHaveLength(20);
    expect(payload.compactSummary.windows[0]).toMatchObject({
      windowId: 10,
      tabCount: 20,
      compactTabLimit: 12,
      omittedTabCount: 8,
      activeTabId: 120,
    });
    expect(payload.compactSummary.retentionPolicy).toMatchObject({
      recentEventLimit: 50,
      windowObjectsRetained: 1,
      tabObjectsRetained: 20,
    });
    expect(payload.compactSummary.retentionPolicy.recentEventsRetained).toBeGreaterThanOrEqual(1);
    expect(payload.compactSummary.retentionPolicy.recentEventsRetained).toBeLessThanOrEqual(
      payload.compactSummary.retentionPolicy.recentEventLimit,
    );
    expect(payload.compactSummary.windows[0].tabs).toHaveLength(12);
    expect(payload.compactSummary.windows[0].tabs.at(-1)).toMatchObject({
      tabId: 120,
      active: true,
      title: 'Tab 120',
    });
    expect(payload.compactSummary.activeObject).toMatchObject({
      tabId: 120,
      title: 'Tab 120',
      canTabrixOperate: true,
    });
    expect(payload.compactSummary.windowStateMatrix).toMatchObject({
      total: 1,
      visible: 1,
      minimized: 0,
      focused: 1,
      operable: 1,
      stateCounts: { normal: 1 },
      typeCounts: { normal: 1 },
    });
    expect(payload.compactSummary.tabStateMatrix).toMatchObject({
      total: 20,
      active: 1,
      background: 19,
      complete: 20,
      aiOpened: 0,
      userOrPageOpened: 20,
      operable: 20,
      statusCounts: { complete: 20 },
      ownerCounts: { ai: 0, user_or_page: 20, unknown: 0 },
    });
    expect(payload.compactSummary.tabStateConclusion).toContain(
      'Tab page object matrix: 20 tab(s), active=1, background=19',
    );
  });
});
