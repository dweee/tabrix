import { beforeEach, describe, expect, it, vi } from 'vitest';
import { windowTool } from '@/entrypoints/background/tools/browser/window';
import {
  getBrowserWorldSnapshot,
  markBrowserWorldTabAiOperated,
  resetBrowserWorldInventoryForTests,
} from '@/entrypoints/background/browser-world-inventory';

describe('get_windows_and_tabs state inventory', () => {
  beforeEach(() => {
    resetBrowserWorldInventoryForTests();
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
    expect(payload.windowCount).toBe(2);
    expect(payload.tabCount).toBe(2);
    expect(payload.baselineReadiness).toMatchObject({
      ready: true,
      status: 'resynced',
      continuity: 'resynced_current_state_history_not_proven',
      resyncAttempted: true,
      resyncSucceeded: true,
    });
    expect(payload.compactSummary.baselineReadiness).toMatchObject({
      ready: true,
      status: 'resynced',
    });

    expect(payload.compactSummary.activeObject).toMatchObject({
      windowId: 10,
      windowState: 'normal',
      windowVisibilityState: 'visible',
      tabId: 102,
      tabWindowId: 10,
      url: 'https://example.test/active',
      title: 'Active',
      openedBy: 'user_or_page',
      openedBySource: 'page_opener',
      tabStatus: 'loading',
      tabOperabilityReason: 'regular_web_page',
      windowOperabilityReason: 'active_tab_operable_in_visible_window',
      canTabrixOperate: true,
    });
    expect(payload.compactSummary.objectInventory).toMatchObject({
      objectModel: 'BrowserWorldObject -> BrowserWindowObject[] -> BrowserTabObject[]',
      compactIdLimit: 12,
      windowObjectCount: 2,
      tabPageObjectCount: 2,
      activeWindowId: 10,
      browserActiveTabId: 102,
      latestAiOperatedTabId: null,
      latestAiOperationConfidence: null,
      latestAiOperationReason: null,
      currentOperationRelation: 'no_ai_operation_observed',
      canContinueOnLatestAiOperatedTab: null,
      aiOpened: { ids: [], omittedCount: 0 },
      userOrPageOpened: { ids: [101, 102], omittedCount: 0 },
      pageOpened: { ids: [102], omittedCount: 0 },
      userOrUnknownOpened: { ids: [101], omittedCount: 0 },
      unknownOpened: { ids: [], omittedCount: 0 },
      operable: { ids: [101, 102], omittedCount: 0 },
      inoperable: { ids: [], omittedCount: 0 },
      recentlyOperatedByAi: { ids: [], omittedCount: 0 },
      summary:
        'Browser object inventory: windows=2, tabs=2, activeTab=102, aiOpened=0, pageOpened=1, userOrUnknownOpened=1, userOrPageOpened=2, operable=2, currentOperation=no_ai_operation_observed.',
      claimBoundary:
        'Object inventory summary contains browser lifecycle ids and routing facts only; it does not prove page content understanding, account state, login success, or API/CDP reuse.',
    });
    expect(payload.compactSummary.browserActiveObject).toMatchObject({
      objectKind: 'BrowserTabObject',
      role: 'browser_active_tab',
      tabId: 102,
      windowId: 10,
      title: 'Active',
      url: 'https://example.test/active',
      active: true,
      status: 'loading',
      openedBy: 'user_or_page',
      openedBySource: 'page_opener',
      openedByConfidence: 0.85,
      openedByReason: 'chrome_tabs_openerTabId_present',
      aiOperationState: 'idle',
      lastAiOperation: null,
      lastAiOperationConfidence: null,
      lastAiOperationReason: null,
      canTabrixOperate: true,
      operabilityReason: 'regular_web_page',
      cleanupEligibility: 'not_eligible',
      cleanupEligibilityReason: 'user_or_page_owned_tab_protected_from_cleanup',
    });
    expect(payload.compactSummary.routingDecisionSummary).toBe(
      'routing=target_selection_required, blockingReason=no_ai_operated_tab_observed, next=read_or_select_intended_target',
    );
    expect(payload.compactSummary.latestAiOperatedObject).toMatchObject({
      objectKind: 'BrowserTabObject',
      role: 'latest_ai_operated_tab',
      tabId: null,
      windowId: null,
      operabilityReason: 'tab_not_observed',
      cleanupEligibility: 'unknown',
      cleanupEligibilityReason: 'tab_not_observed',
    });
    expect(payload.compactSummary.operationRouting).toMatchObject({
      browserActiveTabId: 102,
      latestAiOperatedTabId: null,
      relationToBrowserActiveTab: 'no_ai_operation_observed',
      canContinueOnLatestAiOperatedTab: null,
      latestAiOperation: null,
      latestAiOperationConfidence: null,
      latestAiOperationReason: null,
      summary:
        'routing=target_selection_required, blockingReason=no_ai_operated_tab_observed, next=read_or_select_intended_target',
      claimBoundary:
        'Operation routing identifies browser tab objects only; it does not prove page action postconditions or task completion.',
    });
    expect(payload.compactSummary.aiRoutingBrief).toMatchObject({
      summary:
        'AI routing brief: browser-active tab=102, activeTab=operable, latestAiOperatedTab=none; no prior AI tab operation is known.',
      recommendedNextCheck:
        'Read or select the intended target before assuming the active page is the AI operation target.',
      canContinueOnLatestAiOperatedTab: null,
      claimBoundary:
        'Browser routing brief uses tab/window lifecycle state only; it does not prove page content, task success, or action postconditions.',
    });
    expect(payload.compactSummary.operationTargetBrief).toMatchObject({
      targetTabId: 102,
      targetWindowId: 10,
      targetRole: 'browser_active_tab_candidate',
      targetBasis: 'no_ai_operated_tab_observed',
      targetCanTabrixOperate: true,
      targetOperabilityReason: 'regular_web_page',
      browserActiveTabId: 102,
      latestAiOperatedTabId: null,
      relationToBrowserActiveTab: 'no_ai_operation_observed',
      shouldReselectBeforeAction: false,
      nextRequiredCheck: 'read_or_select_intended_target',
      summary:
        'Operation target brief: no AI-operated tab is known; browser-active tab 102 is only a candidate target until it is read or explicitly selected.',
      claimBoundary:
        'Target brief uses browser object routing only; it does not prove page content, user intent, or task success.',
    });
    expect(payload.compactSummary.aiActionReadiness).toMatchObject({
      readiness: 'ready_for_page_level_check',
      targetRole: 'browser_active_tab_candidate',
      targetTabId: 102,
      browserActiveTabId: 102,
      latestAiOperatedTabId: null,
      canProceedToPageLevelCheck: true,
      requiredBeforeAction: 'read_or_select_intended_target',
      summary:
        'AI action readiness: targetRole=browser_active_tab_candidate, targetTab=102 is browser-operable; proceed only to read_or_select_intended_target.',
      claimBoundary:
        'Action readiness permits only the next page-level verification step; it is not task success, page understanding, or postcondition proof.',
    });
    expect(payload.compactSummary.windows).toMatchObject([
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
            cleanupEligibility: 'not_eligible',
          },
          {
            tabId: 102,
            title: 'Active',
            active: true,
            openedBy: 'user_or_page',
            canTabrixOperate: true,
            cleanupEligibility: 'not_eligible',
          },
        ],
      },
      {
        windowId: 20,
        visibilityState: 'minimized',
        canTabrixOperate: false,
        tabCount: 0,
      },
    ]);
    expect(payload.compactSummary.windowStateMatrix).toMatchObject({
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
    });
    expect(payload.compactSummary.windowStateConclusion).toBe(
      'Window object matrix: 2 window(s), visible=1, minimized=1, focused=1, operable=1, focusedWindow=10, focusedWindowOperable=yes.',
    );
    expect(payload.compactSummary.windowOperationState).toMatchObject({
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
    });
    expect(payload.compactSummary.currentWindowConclusion).toBe(
      'Current window object: focused window 10 is visible and operable; activeTab=102.',
    );
    expect(payload.compactSummary.tabStateMatrix).toMatchObject({
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
      pageOpened: 1,
      userOrUnknownOpened: 1,
      unknownOpened: 0,
      recentlyOperatedByAi: 0,
      idleForAi: 2,
      closedRetained: 0,
      operable: 2,
      inoperable: 0,
      operabilityUnknown: 0,
      statusCounts: { complete: 1, loading: 1 },
      ownerCounts: { ai: 0, user_or_page: 2, unknown: 0 },
      openedBySourceCounts: { ai_tool: 0, page_opener: 1, user_or_unknown: 1, unknown: 0 },
    });
    expect(payload.compactSummary.tabStateConclusion).toBe(
      'Tab page object matrix: 2 tab(s), active=1, background=1, loading=1, complete=1, aiOpened=0, pageOpened=1, userOrUnknownOpened=1, userOrPageOpened=2, operable=2, activeTab=102, latestAiOperatedTab=none.',
    );
    expect(payload.compactSummary.tabLifecycleState).toMatchObject({
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
    });
    expect(payload.compactSummary.tabLifecycleConclusion).toBe(
      'Tab page object lifecycle: no tab lifecycle event observed; retainedTabs=2, activeTab=102.',
    );
    expect(payload.compactSummary.aiOperationState).toMatchObject({
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
    });
    expect(payload.compactSummary.currentOperationConclusion).toBe(
      'Current operation object: no AI-operated tab page object has been observed yet.',
    );
    expect(payload.compactSummary.browserObjectEdgeSummary).toBe(
      'Browser object edge state: windows total=2, visible=1, minimized=1, focused=1, operable=1; tabs total=2, active=1, background=1, loading=1, operable=2, aiOpened=0, pageOpened=1, userOrUnknownOpened=1, userOrPageOpened=2; currentWindow=focused_window_visible_operable; currentOperation=no_ai_operation_observed',
    );
    expect(payload.compactSummary.actionableObjectChangeSummary).toBe(
      'Actionable object change: no recent browser object change; activeTab=102 page-opened status=loading operable=yes; next=read_or_select_intended_target.',
    );
    expect(payload.compactSummary.objectChangeSummary).toBe(
      'Object change summary: no recent browser object change; active tab 102 is loading and operable; no AI-operated tab is known yet.',
    );
    expect(payload.compactSummary.dynamicObjectUpdateSummary).toBe(
      'Dynamic object update: no browser object change observed; retainedWindows=2, retainedTabs=2, activeTab=102.',
    );
    expect(payload.compactSummary.retentionPolicy).toMatchObject({
      recentEventLimit: 50,
      windowObjectsRetained: 2,
      tabObjectsRetained: 2,
      refreshMode: 'event_driven_with_on_demand_chrome_resync',
      minFullChromeResyncIntervalMs: 250,
    });
    expect(payload.compactSummary.claimBoundary).toBe(
      'Browser lifecycle summary only; page content, account state, login success, and API/CDP reuse require separate evidence.',
    );
    expect(payload.windows).toMatchObject([
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
            openedBySource: 'user_or_unknown',
            openedByConfidence: 0.55,
            openedByReason: 'observed_by_chrome_inventory_without_ai_marker_or_opener',
            canTabrixOperate: true,
            operabilityReason: 'regular_web_page',
            cleanupEligibility: 'not_eligible',
            cleanupEligibilityReason: 'user_or_page_owned_tab_protected_from_cleanup',
            aiOperationState: 'idle',
            lastAiOperation: null,
            lastAiOperationConfidence: null,
            lastAiOperationReason: null,
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
            openedBySource: 'page_opener',
            openedByConfidence: 0.85,
            openedByReason: 'chrome_tabs_openerTabId_present',
            canTabrixOperate: true,
            operabilityReason: 'regular_web_page',
            cleanupEligibility: 'not_eligible',
            cleanupEligibilityReason: 'user_or_page_owned_tab_protected_from_cleanup',
            aiOperationState: 'idle',
            lastAiOperation: null,
            lastAiOperationConfidence: null,
            lastAiOperationReason: null,
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
    ]);
    expect(payload.compactSummary.currentTabAttributeGroups).toMatchObject({
      identity: {
        objectKind: 'BrowserTabObject',
        tabId: 102,
        windowId: 10,
        url: 'https://example.test/active',
        title: 'Active',
      },
      runtime: {
        active: true,
        status: 'loading',
        discarded: false,
        audible: true,
        muted: true,
        pinned: true,
        openerTabId: 101,
      },
      ownership: {
        openedBy: 'user_or_page',
        openedBySource: 'page_opener',
        confidence: 0.85,
        reason: 'chrome_tabs_openerTabId_present',
        aiOperationState: 'idle',
      },
      operability: {
        canTabrixOperate: true,
        reason: 'regular_web_page',
      },
      cleanup: {
        cleanupEligibility: 'not_eligible',
        reason: 'user_or_page_owned_tab_protected_from_cleanup',
      },
    });
    expect(payload.compactSummary.lastAiOperatedTabAttributeGroups).toBeNull();
    expect(payload.compactSummary.tabAttributeGroupClaimBoundary).toContain(
      'browser object identity/runtime/ownership/operability/cleanup only',
    );
  });

  it('surfaces browser-active and latest AI-operated objects for routing decisions', async () => {
    const windows = [
      {
        id: 10,
        state: 'normal',
        focused: true,
        type: 'normal',
        incognito: false,
        tabs: [
          {
            id: 201,
            url: 'https://example.test/active',
            pendingUrl: '',
            title: 'Active User Page',
            active: true,
            status: 'complete',
            discarded: false,
            audible: false,
            mutedInfo: { muted: false },
            pinned: false,
          },
          {
            id: 202,
            url: 'https://example.test/ai-target',
            pendingUrl: '',
            title: 'AI Target',
            active: false,
            status: 'complete',
            discarded: false,
            audible: false,
            mutedInfo: { muted: false },
            pinned: false,
          },
        ],
      },
    ] as chrome.windows.Window[];

    (
      chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }
    ).windows.getAll.mockResolvedValue(windows);

    await getBrowserWorldSnapshot();
    markBrowserWorldTabAiOperated(202, 'read_page');

    const result = await windowTool.execute();
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.compactSummary.browserActiveObject).toMatchObject({
      role: 'browser_active_tab',
      tabId: 201,
      title: 'Active User Page',
      active: true,
      openedBy: 'user_or_page',
      canTabrixOperate: true,
    });
    expect(payload.compactSummary.latestAiOperatedObject).toMatchObject({
      role: 'latest_ai_operated_tab',
      tabId: 202,
      title: 'AI Target',
      active: false,
      lastAiOperation: 'read_page',
      lastAiOperationConfidence: 0.95,
      lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
      canTabrixOperate: true,
    });
    expect(payload.compactSummary.currentTabAttributeGroups).toMatchObject({
      identity: {
        tabId: 201,
        title: 'Active User Page',
      },
      runtime: {
        active: true,
        status: 'complete',
      },
      ownership: {
        openedBy: 'user_or_page',
        aiOperationState: 'idle',
      },
      operability: {
        canTabrixOperate: true,
      },
    });
    expect(payload.compactSummary.lastAiOperatedTabAttributeGroups).toMatchObject({
      identity: {
        tabId: 202,
        title: 'AI Target',
      },
      runtime: {
        active: false,
        status: 'complete',
      },
      ownership: {
        openedBy: 'user_or_page',
        aiOperationState: 'recently_operated',
        lastAiOperation: 'read_page',
        lastAiOperationConfidence: 0.95,
        lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
      },
      operability: {
        canTabrixOperate: true,
      },
    });
    expect(payload.compactSummary.operationRouting).toMatchObject({
      browserActiveTabId: 201,
      latestAiOperatedTabId: 202,
      relationToBrowserActiveTab: 'latest_ai_operated_background_tab',
      canContinueOnLatestAiOperatedTab: false,
      latestAiOperation: 'read_page',
      latestAiOperationConfidence: 0.95,
      latestAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
    });
    expect(payload.compactSummary.operationRouting.summary).toContain(
      'routing=latest_ai_operated_background_tab',
    );
    expect(payload.compactSummary.operationRouting.summary).toContain(
      'blockingReason=latest_ai_operated_tab_not_browser_active',
    );
    expect(payload.compactSummary.aiRoutingBrief).toMatchObject({
      summary:
        'AI routing brief: latest AI-operated tab=202 is background while browser-active tab=201; operation=read_page.',
      recommendedNextCheck:
        'Reselect or reread the latest AI-operated tab before continuing the task.',
      canContinueOnLatestAiOperatedTab: false,
      claimBoundary:
        'Browser routing brief proves the operation target is not the browser-active tab; it does not prove page content or task result.',
    });
    expect(payload.compactSummary.operationTargetBrief).toMatchObject({
      targetTabId: 202,
      targetWindowId: 10,
      targetRole: 'latest_ai_operated_background_tab',
      targetBasis: 'latest_ai_operated_tab_differs_from_browser_active_tab',
      targetCanTabrixOperate: true,
      targetOperabilityReason: 'regular_web_page',
      browserActiveTabId: 201,
      latestAiOperatedTabId: 202,
      relationToBrowserActiveTab: 'latest_ai_operated_background_tab',
      shouldReselectBeforeAction: true,
      nextRequiredCheck: 'reselect_or_reread_latest_ai_operated_tab',
      summary:
        'Operation target brief: latest AI-operated tab 202 is not browser-active; active tab is 201, so do not act until the intended tab is reselected or reread.',
      claimBoundary:
        'Target brief proves a browser object mismatch only; it does not decide user intent or task success.',
    });
    expect(payload.compactSummary.aiActionReadiness).toMatchObject({
      readiness: 'reselect_or_reread_required',
      targetRole: 'latest_ai_operated_background_tab',
      targetTabId: 202,
      browserActiveTabId: 201,
      latestAiOperatedTabId: 202,
      canProceedToPageLevelCheck: false,
      requiredBeforeAction: 'reselect_or_reread_latest_ai_operated_tab',
      summary:
        'AI action readiness: targetRole=latest_ai_operated_background_tab, targetTab=202, browserActiveTab=201; reselect_or_reread_latest_ai_operated_tab is required before acting.',
      claimBoundary:
        'Action readiness uses browser object state only; it does not prove page content, task intent, action postconditions, or task success.',
    });
    expect(payload.compactSummary.objectChangeSummary).toBe(
      'Object change summary: AI operation read_page was recorded on tab 202; AI last operated tab 202, but the active tab is 201; reselect or reread before continuing.',
    );
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
      tabStatus: 'complete',
      tabOperabilityReason: 'regular_web_page',
      windowOperabilityReason: 'active_tab_operable_in_visible_window',
      canTabrixOperate: true,
    });
    expect(payload.compactSummary.objectInventory).toMatchObject({
      compactIdLimit: 12,
      windowObjectCount: 1,
      tabPageObjectCount: 20,
      browserActiveTabId: 120,
      currentOperationRelation: 'no_ai_operation_observed',
      aiOpened: { ids: [], omittedCount: 0 },
      userOrPageOpened: {
        ids: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112],
        omittedCount: 8,
      },
      pageOpened: { ids: [], omittedCount: 0 },
      userOrUnknownOpened: {
        ids: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112],
        omittedCount: 8,
      },
      operable: {
        ids: [101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112],
        omittedCount: 8,
      },
      summary:
        'Browser object inventory: windows=1, tabs=20, activeTab=120, aiOpened=0, pageOpened=0, userOrUnknownOpened=20, userOrPageOpened=20, operable=20, currentOperation=no_ai_operation_observed.',
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
