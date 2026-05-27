import type {
  BrowserWorldAiOperationRelation,
  BrowserWorldAiOperationState,
  BrowserWorldEvent,
  BrowserWorldTabAttributeGroups,
  BrowserWorldTabLifecycleEventKind,
  BrowserWorldTabLifecycleState,
  BrowserWorldTabObject,
  BrowserWorldTabOpenedBy,
  BrowserWorldTabStateMatrix,
  BrowserWorldTabStateSummary,
  BrowserWorldWindowObject,
  BrowserWorldWindowOperationRelation,
  BrowserWorldWindowOperationState,
  BrowserWorldWindowStateMatrix,
} from './browser-world-inventory';

export function buildTabStateMatrix(
  tabs: readonly BrowserWorldTabObject[],
): BrowserWorldTabStateMatrix {
  const statusCounts: Record<string, number> = {};
  const ownerCounts: Record<BrowserWorldTabOpenedBy, number> = {
    ai: 0,
    user_or_page: 0,
    unknown: 0,
  };
  for (const tab of tabs) {
    const status = String(tab.status || 'unknown');
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    ownerCounts[tab.openedBy] = (ownerCounts[tab.openedBy] ?? 0) + 1;
  }
  return {
    total: tabs.length,
    active: tabs.filter((tab) => tab.active === true).length,
    background: tabs.filter((tab) => tab.active === false).length,
    activityUnknown: tabs.filter((tab) => tab.active === null).length,
    loading: tabs.filter((tab) => tab.status === 'loading').length,
    complete: tabs.filter((tab) => tab.status === 'complete').length,
    statusUnknown: tabs.filter((tab) => !tab.status).length,
    discarded: tabs.filter((tab) => tab.discarded === true).length,
    audible: tabs.filter((tab) => tab.audible === true).length,
    muted: tabs.filter((tab) => tab.muted === true).length,
    pinned: tabs.filter((tab) => tab.pinned === true).length,
    withOpener: tabs.filter((tab) => tab.openerTabId !== null).length,
    aiOpened: tabs.filter((tab) => tab.openedBy === 'ai').length,
    userOrPageOpened: tabs.filter((tab) => tab.openedBy === 'user_or_page').length,
    unknownOpened: tabs.filter((tab) => tab.openedBy === 'unknown').length,
    recentlyOperatedByAi: tabs.filter((tab) => tab.aiOperationState === 'recently_operated').length,
    idleForAi: tabs.filter((tab) => tab.aiOperationState === 'idle').length,
    closedRetained: tabs.filter((tab) => tab.aiOperationState === 'closed').length,
    operable: tabs.filter((tab) => tab.canTabrixOperate === true).length,
    inoperable: tabs.filter((tab) => tab.canTabrixOperate === false).length,
    operabilityUnknown: tabs.filter((tab) => tab.canTabrixOperate === null).length,
    statusCounts,
    ownerCounts,
  };
}

export function summarizeTabStateMatrix(
  matrix: BrowserWorldTabStateMatrix,
  activeTab: BrowserWorldTabObject | null,
  lastAiOperatedTab: BrowserWorldTabObject | null,
): string {
  if (matrix.total === 0) {
    return 'Tab page object matrix: no tab page object is currently retained.';
  }
  return `Tab page object matrix: ${matrix.total} tab(s), active=${matrix.active}, background=${matrix.background}, loading=${matrix.loading}, complete=${matrix.complete}, aiOpened=${matrix.aiOpened}, userOrPageOpened=${matrix.userOrPageOpened}, operable=${matrix.operable}, activeTab=${activeTab?.tabId ?? 'unknown'}, latestAiOperatedTab=${lastAiOperatedTab?.tabId ?? 'none'}.`;
}

function isTabLifecycleEvent(event: BrowserWorldEvent): event is BrowserWorldEvent & {
  eventKind: BrowserWorldTabLifecycleEventKind;
} {
  return (
    event.eventKind === 'tab_created' ||
    event.eventKind === 'tab_updated' ||
    event.eventKind === 'tab_removed' ||
    event.eventKind === 'tab_activated' ||
    event.eventKind === 'tab_replaced'
  );
}

export function buildTabLifecycleState(
  events: readonly BrowserWorldEvent[],
  tabs: readonly BrowserWorldTabObject[],
  activeTab: BrowserWorldTabObject | null,
): BrowserWorldTabLifecycleState {
  const tabEvents = events.filter(isTabLifecycleEvent);
  const latest = tabEvents.at(-1) ?? null;
  return {
    latestEventKind: latest?.eventKind ?? null,
    latestEventTabId: latest?.tabId ?? null,
    latestEventWindowId: latest?.windowId ?? null,
    latestEventStatus: latest?.status ?? null,
    latestReplacedTabId: latest?.replacedTabId ?? null,
    recentCreatedCount: tabEvents.filter((event) => event.eventKind === 'tab_created').length,
    recentUpdatedCount: tabEvents.filter((event) => event.eventKind === 'tab_updated').length,
    recentActivatedCount: tabEvents.filter((event) => event.eventKind === 'tab_activated').length,
    recentReplacedCount: tabEvents.filter((event) => event.eventKind === 'tab_replaced').length,
    recentRemovedCount: tabEvents.filter((event) => event.eventKind === 'tab_removed').length,
    retainedTabCount: tabs.length,
    activeTabId: activeTab?.tabId ?? null,
    aiOpenedRetainedCount: tabs.filter((tab) => tab.openedBy === 'ai').length,
    userOrPageOpenedRetainedCount: tabs.filter((tab) => tab.openedBy === 'user_or_page').length,
  };
}

export function summarizeTabLifecycle(state: BrowserWorldTabLifecycleState): string {
  if (!state.latestEventKind) {
    return `Tab page object lifecycle: no tab lifecycle event observed; retainedTabs=${state.retainedTabCount}, activeTab=${state.activeTabId ?? 'unknown'}.`;
  }
  if (state.latestEventKind === 'tab_replaced') {
    return `Tab page object lifecycle: latest=${state.latestEventKind}, tab=${state.latestEventTabId ?? 'unknown'}, replacedTab=${state.latestReplacedTabId ?? 'unknown'}, retainedTabs=${state.retainedTabCount}, activeTab=${state.activeTabId ?? 'unknown'}, created=${state.recentCreatedCount}, updated=${state.recentUpdatedCount}, activated=${state.recentActivatedCount}, replaced=${state.recentReplacedCount}, removed=${state.recentRemovedCount}.`;
  }
  return `Tab page object lifecycle: latest=${state.latestEventKind}, tab=${state.latestEventTabId ?? 'unknown'}, status=${state.latestEventStatus ?? 'unknown'}, retainedTabs=${state.retainedTabCount}, activeTab=${state.activeTabId ?? 'unknown'}, created=${state.recentCreatedCount}, updated=${state.recentUpdatedCount}, activated=${state.recentActivatedCount}, replaced=${state.recentReplacedCount}, removed=${state.recentRemovedCount}.`;
}

export function buildAiOperationState(
  tabs: readonly BrowserWorldTabObject[],
  activeTab: BrowserWorldTabObject | null,
  lastAiOperatedTab: BrowserWorldTabObject | null,
): BrowserWorldAiOperationState {
  const relationToBrowserActiveTab = classifyAiOperationRelation(activeTab, lastAiOperatedTab);
  const canContinueOnLatestAiOperatedTab =
    lastAiOperatedTab === null
      ? null
      : relationToBrowserActiveTab === 'same_as_browser_active' &&
        lastAiOperatedTab.canTabrixOperate === true;

  return {
    browserActiveTabId: activeTab?.tabId ?? null,
    latestAiOperatedTabId: lastAiOperatedTab?.tabId ?? null,
    latestAiOperation: lastAiOperatedTab?.lastAiOperation ?? null,
    latestAiOperationAtMs: lastAiOperatedTab?.lastAiOperationAtMs ?? null,
    latestAiOperatedTabActive: lastAiOperatedTab?.active ?? null,
    latestAiOperatedTabWindowId: lastAiOperatedTab?.windowId ?? null,
    latestAiOperatedTabOpenedBy: lastAiOperatedTab?.openedBy ?? null,
    latestAiOperatedTabCanOperate: lastAiOperatedTab?.canTabrixOperate ?? null,
    relationToBrowserActiveTab,
    canContinueOnLatestAiOperatedTab,
    aiOpenedTabCount: tabs.filter((tab) => tab.openedBy === 'ai').length,
    recentlyOperatedTabCount: tabs.filter((tab) => tab.aiOperationState === 'recently_operated')
      .length,
    closedRetainedTabCount: tabs.filter((tab) => tab.aiOperationState === 'closed').length,
  };
}

function classifyAiOperationRelation(
  activeTab: BrowserWorldTabObject | null,
  lastAiOperatedTab: BrowserWorldTabObject | null,
): BrowserWorldAiOperationRelation {
  if (!lastAiOperatedTab) return 'no_ai_operation_observed';
  if (!activeTab) return 'unknown';
  if (activeTab.tabId === lastAiOperatedTab.tabId) return 'same_as_browser_active';
  if (lastAiOperatedTab.active === false) return 'latest_ai_operated_background_tab';
  return 'browser_active_not_latest_ai_operated';
}

export function summarizeCurrentOperation(state: BrowserWorldAiOperationState): string {
  if (state.relationToBrowserActiveTab === 'no_ai_operation_observed') {
    return 'Current operation object: no AI-operated tab page object has been observed yet.';
  }
  if (state.relationToBrowserActiveTab === 'same_as_browser_active') {
    return `Current operation object: latest AI-operated tab ${state.latestAiOperatedTabId ?? 'unknown'} is also the browser-active tab; operation=${state.latestAiOperation ?? 'unknown'}, operable=${state.canContinueOnLatestAiOperatedTab === true ? 'yes' : 'no_or_unknown'}.`;
  }
  if (state.relationToBrowserActiveTab === 'latest_ai_operated_background_tab') {
    return `Current operation object: latest AI-operated tab ${state.latestAiOperatedTabId ?? 'unknown'} is not browser-active; browserActiveTab=${state.browserActiveTabId ?? 'unknown'}, operation=${state.latestAiOperation ?? 'unknown'}. Do not assume the AI target is still the active page without reselecting or rereading it.`;
  }
  if (state.relationToBrowserActiveTab === 'browser_active_not_latest_ai_operated') {
    return `Current operation object: browser-active tab ${state.browserActiveTabId ?? 'unknown'} is different from latest AI-operated tab ${state.latestAiOperatedTabId ?? 'unknown'}; operation=${state.latestAiOperation ?? 'unknown'}. Treat the operation target as uncertain until refreshed.`;
  }
  return `Current operation object: latest AI-operated tab ${state.latestAiOperatedTabId ?? 'unknown'} exists but relation to browser-active tab is unknown.`;
}

export function buildWindowStateMatrix(
  windows: readonly BrowserWorldWindowObject[],
): BrowserWorldWindowStateMatrix {
  const stateCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  for (const window of windows) {
    const state = String(window.state || 'unknown');
    const type = String(window.type || 'unknown');
    stateCounts[state] = (stateCounts[state] ?? 0) + 1;
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }
  return {
    total: windows.length,
    visible: windows.filter((window) => window.visibilityState === 'visible').length,
    minimized: windows.filter((window) => window.visibilityState === 'minimized').length,
    unknownVisibility: windows.filter((window) => window.visibilityState === 'unknown').length,
    focused: windows.filter((window) => window.focused === true || window.isFocused === true)
      .length,
    unfocused: windows.filter((window) => window.focused === false || window.isFocused === false)
      .length,
    focusUnknown: windows.filter((window) => window.focused === null && window.isFocused === null)
      .length,
    operable: windows.filter((window) => window.canTabrixOperate === true).length,
    inoperable: windows.filter((window) => window.canTabrixOperate === false).length,
    operabilityUnknown: windows.filter((window) => window.canTabrixOperate === null).length,
    stateCounts,
    typeCounts,
  };
}

export function summarizeWindowStateMatrix(
  matrix: BrowserWorldWindowStateMatrix,
  focusedWindow: BrowserWorldWindowObject | null,
): string {
  if (matrix.total === 0) {
    return 'Window object matrix: no browser window object is currently retained.';
  }
  return `Window object matrix: ${matrix.total} window(s), visible=${matrix.visible}, minimized=${matrix.minimized}, focused=${matrix.focused}, operable=${matrix.operable}, focusedWindow=${focusedWindow?.windowId ?? 'unknown'}, focusedWindowOperable=${focusedWindow?.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
}

export function buildWindowOperationState(
  matrix: BrowserWorldWindowStateMatrix,
  focusedWindow: BrowserWorldWindowObject | null,
): BrowserWorldWindowOperationState {
  const relationToCurrentOperableWindow = classifyWindowOperationRelation(matrix, focusedWindow);
  return {
    focusedWindowId: focusedWindow?.windowId ?? null,
    focusedWindowState: focusedWindow?.state ?? null,
    focusedWindowVisibilityState: focusedWindow?.visibilityState ?? null,
    focusedWindowCanOperate: focusedWindow?.canTabrixOperate ?? null,
    focusedWindowActiveTabId: focusedWindow?.activeTabId ?? null,
    focusedWindowActiveTabCanOperate: focusedWindow?.activeTabCanOperate ?? null,
    relationToCurrentOperableWindow,
    canOperateFocusedWindow:
      relationToCurrentOperableWindow === 'focused_window_visible_operable'
        ? true
        : focusedWindow
          ? false
          : null,
    visibleWindowCount: matrix.visible,
    minimizedWindowCount: matrix.minimized,
    operableWindowCount: matrix.operable,
    inoperableWindowCount: matrix.inoperable,
  };
}

function classifyWindowOperationRelation(
  matrix: BrowserWorldWindowStateMatrix,
  focusedWindow: BrowserWorldWindowObject | null,
): BrowserWorldWindowOperationRelation {
  if (matrix.total === 0) return 'no_window_observed';
  if (!focusedWindow) return 'no_focused_window';
  if (focusedWindow.visibilityState === 'minimized') return 'focused_window_minimized';
  if (focusedWindow.canTabrixOperate === true && focusedWindow.visibilityState === 'visible') {
    return 'focused_window_visible_operable';
  }
  if (focusedWindow.canTabrixOperate === false) return 'focused_window_not_operable';
  return 'focused_window_operability_unknown';
}

export function summarizeCurrentWindow(state: BrowserWorldWindowOperationState): string {
  if (state.relationToCurrentOperableWindow === 'no_window_observed') {
    return 'Current window object: no browser window object is currently retained.';
  }
  if (state.relationToCurrentOperableWindow === 'no_focused_window') {
    return `Current window object: no focused browser window; visible=${state.visibleWindowCount}, minimized=${state.minimizedWindowCount}, operable=${state.operableWindowCount}. Do not assume an active operation container until focus is restored.`;
  }
  if (state.relationToCurrentOperableWindow === 'focused_window_visible_operable') {
    return `Current window object: focused window ${state.focusedWindowId ?? 'unknown'} is visible and operable; activeTab=${state.focusedWindowActiveTabId ?? 'unknown'}.`;
  }
  if (state.relationToCurrentOperableWindow === 'focused_window_minimized') {
    return `Current window object: focused window ${state.focusedWindowId ?? 'unknown'} is minimized; activeTab=${state.focusedWindowActiveTabId ?? 'unknown'}. Browser actions that require visible UI should wait for restore.`;
  }
  if (state.relationToCurrentOperableWindow === 'focused_window_not_operable') {
    return `Current window object: focused window ${state.focusedWindowId ?? 'unknown'} is visibleState=${state.focusedWindowVisibilityState ?? 'unknown'} but not operable; reason is represented by BrowserWindowObject.operabilityReason.`;
  }
  return `Current window object: focused window ${state.focusedWindowId ?? 'unknown'} has unknown operability; state=${state.focusedWindowState ?? 'unknown'}, visibility=${state.focusedWindowVisibilityState ?? 'unknown'}.`;
}

export function buildTabAttributeGroups(
  tab: BrowserWorldTabObject,
): BrowserWorldTabAttributeGroups {
  return {
    identity: {
      objectKind: 'BrowserTabObject',
      tabId: tab.tabId,
      windowId: tab.windowId,
      url: tab.url,
      title: tab.title,
    },
    runtime: {
      active: tab.active,
      status: tab.status,
      pendingUrl: tab.pendingUrl,
      discarded: tab.discarded,
      audible: tab.audible,
      muted: tab.muted,
      pinned: tab.pinned,
      openerTabId: tab.openerTabId,
    },
    ownership: {
      openedBy: tab.openedBy,
      confidence: tab.openedByConfidence,
      reason: tab.openedByReason,
      aiOperationState: tab.aiOperationState,
      lastAiOperation: tab.lastAiOperation,
      lastAiOperationAtMs: tab.lastAiOperationAtMs,
    },
    operability: {
      canTabrixOperate: tab.canTabrixOperate,
      reason: tab.operabilityReason,
    },
  };
}

export function summarizeTabState(tab: BrowserWorldTabObject): BrowserWorldTabStateSummary {
  return {
    objectKind: 'BrowserTabObject',
    tabId: tab.tabId,
    windowId: tab.windowId,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    active: tab.active,
    status: tab.status,
    discarded: tab.discarded,
    audible: tab.audible,
    muted: tab.muted,
    pinned: tab.pinned,
    openerTabId: tab.openerTabId,
    openedBy: tab.openedBy,
    openedByConfidence: tab.openedByConfidence,
    openedByReason: tab.openedByReason,
    aiOperationState: tab.aiOperationState,
    lastAiOperation: tab.lastAiOperation,
    lastAiOperationAtMs: tab.lastAiOperationAtMs,
    canTabrixOperate: tab.canTabrixOperate,
    operabilityReason: tab.operabilityReason,
  };
}

export function summarizeObjectChangeConclusion(
  events: readonly BrowserWorldEvent[],
  activeTab: BrowserWorldTabObject | null,
  lastAiOperatedTab: BrowserWorldTabObject | null,
  focusedWindow: BrowserWorldWindowObject | null,
): string {
  const last =
    [...events].reverse().find((event) => event.eventKind !== 'inventory_seeded') ?? events.at(-1);
  if (!last) {
    return 'No browser object change has been observed yet.';
  }
  if (last.eventKind === 'tab_activated' && activeTab) {
    return `Current page object is tab ${activeTab.tabId}; identity=window ${activeTab.windowId ?? 'unknown'}, runtime=status ${activeTab.status ?? 'unknown'}, ownership=${activeTab.openedBy}, operable=${activeTab.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
  }
  if (last.eventKind === 'tab_created') {
    return `Page object tab ${last.tabId ?? 'unknown'} was created; owner=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}.`;
  }
  if (last.eventKind === 'tab_updated') {
    return `Page object tab ${last.tabId ?? 'unknown'} was updated; owner=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}.`;
  }
  if (last.eventKind === 'tab_replaced') {
    return `Page object tab ${last.replacedTabId ?? 'unknown'} was replaced by tab ${last.tabId ?? 'unknown'}; owner=${last.openedBy ?? 'unknown'}.`;
  }
  if (last.eventKind === 'ai_tab_marked' && lastAiOperatedTab) {
    return `Latest AI-operated page object is tab ${lastAiOperatedTab.tabId}; operation=${lastAiOperatedTab.lastAiOperation ?? 'unknown'}, operable=${lastAiOperatedTab.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
  }
  if (last.eventKind === 'tab_removed') {
    return `Page object tab ${last.tabId ?? 'unknown'} was removed; previousOwner=${last.openedBy ?? 'unknown'}.`;
  }
  if (last.eventKind === 'window_bounds_changed' && focusedWindow) {
    return `Active window object is ${focusedWindow.windowId}; visibility=${focusedWindow.visibilityState}, operable=${focusedWindow.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
  }
  if (last.eventKind === 'window_focus_changed') {
    return `Focused window object changed to ${last.windowId ?? 'unknown'}.`;
  }
  if (lastAiOperatedTab) {
    return `Latest AI-operated page object is tab ${lastAiOperatedTab.tabId}; operation=${lastAiOperatedTab.lastAiOperation ?? 'unknown'}, operable=${lastAiOperatedTab.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
  }
  return summarizeRecentEvents(events);
}

export function summarizeDynamicObjectUpdate(
  events: readonly BrowserWorldEvent[],
  activeTab: BrowserWorldTabObject | null,
  lastAiOperatedTab: BrowserWorldTabObject | null,
  focusedWindow: BrowserWorldWindowObject | null,
  lifecycleState: BrowserWorldTabLifecycleState,
  aiOperationState: BrowserWorldAiOperationState,
  windowOperationState: BrowserWorldWindowOperationState,
): string {
  const last =
    [...events].reverse().find((event) => event.eventKind !== 'inventory_seeded') ?? events.at(-1);
  if (!last || last.eventKind === 'inventory_seeded') {
    return `Dynamic object update: no browser object change observed; retainedWindows=${windowOperationState.visibleWindowCount + windowOperationState.minimizedWindowCount}, retainedTabs=${lifecycleState.retainedTabCount}, activeTab=${lifecycleState.activeTabId ?? 'unknown'}.`;
  }
  if (last.eventKind === 'tab_removed') {
    return `Dynamic object update: tab ${last.tabId ?? 'unknown'} was removed; previousOwner=${last.openedBy ?? 'unknown'}, retainedTabs=${lifecycleState.retainedTabCount}, aiOpenedRetained=${lifecycleState.aiOpenedRetainedCount}, activeTab=${lifecycleState.activeTabId ?? 'unknown'}.`;
  }
  if (last.eventKind === 'tab_activated' && activeTab) {
    return `Dynamic object update: current page object switched to tab ${activeTab.tabId}; owner=${activeTab.openedBy}, status=${activeTab.status ?? 'unknown'}, operable=${activeTab.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}, focusedWindow=${focusedWindow?.windowId ?? 'unknown'}.`;
  }
  if (last.eventKind === 'tab_created') {
    return `Dynamic object update: tab ${last.tabId ?? 'unknown'} was created; owner=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}, retainedTabs=${lifecycleState.retainedTabCount}, aiOpenedRetained=${lifecycleState.aiOpenedRetainedCount}.`;
  }
  if (last.eventKind === 'tab_updated') {
    const isLatestAiOperated = last.tabId === lastAiOperatedTab?.tabId;
    return `Dynamic object update: tab ${last.tabId ?? 'unknown'} was updated; owner=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}, currentActiveTab=${activeTab?.tabId ?? 'unknown'}, latestAiOperated=${isLatestAiOperated ? 'yes' : 'no_or_unknown'}.`;
  }
  if (last.eventKind === 'tab_replaced') {
    return `Dynamic object update: tab ${last.replacedTabId ?? 'unknown'} was replaced by tab ${last.tabId ?? 'unknown'}; owner=${last.openedBy ?? 'unknown'}, retainedTabs=${lifecycleState.retainedTabCount}, activeTab=${lifecycleState.activeTabId ?? 'unknown'}.`;
  }
  if (last.eventKind === 'ai_tab_marked') {
    return `Dynamic object update: latest AI-operated page object is tab ${aiOperationState.latestAiOperatedTabId ?? last.tabId ?? 'unknown'}; operation=${aiOperationState.latestAiOperation ?? 'unknown'}, relationToActive=${aiOperationState.relationToBrowserActiveTab}, canContinue=${aiOperationState.canContinueOnLatestAiOperatedTab === true ? 'yes' : 'no_or_unknown'}.`;
  }
  if (last.eventKind === 'window_focus_changed') {
    return `Dynamic object update: focused window changed to ${last.windowId ?? 'unknown'}; relation=${windowOperationState.relationToCurrentOperableWindow}, visibleWindows=${windowOperationState.visibleWindowCount}, minimizedWindows=${windowOperationState.minimizedWindowCount}.`;
  }
  if (last.eventKind === 'window_bounds_changed' || last.eventKind === 'window_created') {
    return `Dynamic object update: window ${last.windowId ?? 'unknown'} changed; state=${last.windowState ?? 'unknown'}, visibility=${last.windowVisibilityState ?? 'unknown'}, operable=${last.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}, focusedWindow=${focusedWindow?.windowId ?? 'unknown'}.`;
  }
  if (last.eventKind === 'window_removed') {
    return `Dynamic object update: window ${last.windowId ?? 'unknown'} was removed; visibleWindows=${windowOperationState.visibleWindowCount}, minimizedWindows=${windowOperationState.minimizedWindowCount}, retainedTabs=${lifecycleState.retainedTabCount}.`;
  }
  return `Dynamic object update: browser object changed; latestEvent=${last.eventKind}, activeTab=${activeTab?.tabId ?? 'unknown'}, retainedTabs=${lifecycleState.retainedTabCount}.`;
}

export function summarizeRecentEvents(events: readonly BrowserWorldEvent[]): string {
  const last =
    [...events].reverse().find((event) => event.eventKind !== 'inventory_seeded') ?? events.at(-1);
  if (!last) return 'No browser lifecycle event observed yet.';
  switch (last.eventKind) {
    case 'tab_created':
      return `Last change: tab ${last.tabId ?? 'unknown'} was created in window ${last.windowId ?? 'unknown'}; openedBy=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}.`;
    case 'tab_updated':
      return `Last change: tab ${last.tabId ?? 'unknown'} was updated; openedBy=${last.openedBy ?? 'unknown'}, status=${last.status ?? 'unknown'}.`;
    case 'tab_removed':
      return `Last change: tab ${last.tabId ?? 'unknown'} was removed; previousOpenedBy=${last.openedBy ?? 'unknown'}.`;
    case 'tab_activated':
      return `Last change: tab ${last.tabId ?? 'unknown'} became active in window ${last.windowId ?? 'unknown'}.`;
    case 'window_focus_changed':
      return `Last change: focused window is ${last.windowId ?? 'unknown'}; state=${last.windowState ?? 'unknown'}, visibility=${last.windowVisibilityState ?? 'unknown'}, operable=${last.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
    case 'window_bounds_changed':
      return `Last change: window ${last.windowId ?? 'unknown'} bounds or state changed; state=${last.windowState ?? 'unknown'}, visibility=${last.windowVisibilityState ?? 'unknown'}, operable=${last.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
    case 'window_created':
      return `Last change: window ${last.windowId ?? 'unknown'} was created; state=${last.windowState ?? 'unknown'}, visibility=${last.windowVisibilityState ?? 'unknown'}, operable=${last.canTabrixOperate === true ? 'yes' : 'no_or_unknown'}.`;
    case 'window_removed':
      return `Last change: window ${last.windowId ?? 'unknown'} was removed.`;
    case 'tab_replaced':
      return `Last change: tab ${last.replacedTabId ?? 'unknown'} was replaced by tab ${last.tabId ?? 'unknown'}.`;
    case 'ai_tab_marked':
      return `Last change: tab ${last.tabId ?? 'unknown'} was marked as operated by Tabrix.`;
    case 'inventory_seeded':
      return 'Last change: browser world inventory was refreshed from Chrome.';
    default:
      return 'Last change: browser lifecycle event observed.';
  }
}
