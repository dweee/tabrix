import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import {
  refreshBrowserWorldSnapshot,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';

const COMPACT_TABS_PER_WINDOW_LIMIT = 12;
const COMPACT_OBJECT_ID_LIMIT = 12;

type StructuredTabForWindowSummary = {
  tabId: number;
  title: string;
  url: string;
  active: boolean;
  status: string | null;
  openedBy: string;
  canTabrixOperate: boolean | null;
  operabilityReason: string;
};

function selectCompactTabsForWindow(
  tabs: StructuredTabForWindowSummary[],
): StructuredTabForWindowSummary[] {
  if (tabs.length <= COMPACT_TABS_PER_WINDOW_LIMIT) return tabs;
  const selected = tabs.slice(0, COMPACT_TABS_PER_WINDOW_LIMIT);
  const activeTab = tabs.find((tab) => tab.active === true);
  if (activeTab && !selected.some((tab) => tab.tabId === activeTab.tabId)) {
    selected[selected.length - 1] = activeTab;
  }
  return selected;
}

function buildCompactIdSet(ids: number[]) {
  return {
    ids: ids.slice(0, COMPACT_OBJECT_ID_LIMIT),
    omittedCount: Math.max(0, ids.length - COMPACT_OBJECT_ID_LIMIT),
  };
}

function buildCompactTabObject(tab: BrowserWorldTabObject | null, role: string) {
  if (!tab) {
    return {
      objectKind: 'BrowserTabObject',
      role,
      tabId: null,
      windowId: null,
      title: null,
      url: null,
      active: null,
      status: null,
      openedBy: null,
      openedByConfidence: null,
      openedByReason: null,
      aiOperationState: null,
      lastAiOperation: null,
      lastAiOperationConfidence: null,
      lastAiOperationReason: null,
      canTabrixOperate: null,
      operabilityReason: 'tab_not_observed',
    };
  }
  return {
    objectKind: tab.objectKind,
    role,
    tabId: tab.tabId,
    windowId: tab.windowId,
    title: tab.title,
    url: tab.url,
    active: tab.active,
    status: tab.status,
    openedBy: tab.openedBy,
    openedByConfidence: tab.openedByConfidence,
    openedByReason: tab.openedByReason,
    aiOperationState: tab.aiOperationState,
    lastAiOperation: tab.lastAiOperation,
    lastAiOperationConfidence: tab.lastAiOperationConfidence,
    lastAiOperationReason: tab.lastAiOperationReason,
    canTabrixOperate: tab.canTabrixOperate,
    operabilityReason: tab.operabilityReason,
  };
}

function buildAiRoutingBrief(args: {
  browserActiveTabId: number | null;
  latestAiOperatedTabId: number | null;
  latestAiOperation: string | null;
  relationToBrowserActiveTab: string;
  canContinueOnLatestAiOperatedTab: boolean | null;
  activeTabCanOperate: boolean | null;
}) {
  const activeTabText = args.browserActiveTabId ?? 'unknown';
  const latestAiTabText = args.latestAiOperatedTabId ?? 'none';
  const operationText = args.latestAiOperation ?? 'none';
  const activeOperability =
    args.activeTabCanOperate === true
      ? 'operable'
      : args.activeTabCanOperate === false
        ? 'not_operable'
        : 'operability_unknown';

  if (args.relationToBrowserActiveTab === 'no_ai_operation_observed') {
    return {
      summary: `AI routing brief: browser-active tab=${activeTabText}, activeTab=${activeOperability}, latestAiOperatedTab=none; no prior AI tab operation is known.`,
      recommendedNextCheck:
        'Read or select the intended target before assuming the active page is the AI operation target.',
      canContinueOnLatestAiOperatedTab: null,
      claimBoundary:
        'Browser routing brief uses tab/window lifecycle state only; it does not prove page content, task success, or action postconditions.',
    };
  }

  if (args.relationToBrowserActiveTab === 'same_as_browser_active') {
    return {
      summary: `AI routing brief: latest AI-operated tab=${latestAiTabText} is also browser-active; operation=${operationText}; activeTab=${activeOperability}.`,
      recommendedNextCheck:
        args.canContinueOnLatestAiOperatedTab === true
          ? 'Continue only after the next page-level read/postcondition check still passes.'
          : 'Refresh the target tab state before continuing.',
      canContinueOnLatestAiOperatedTab: args.canContinueOnLatestAiOperatedTab,
      claimBoundary:
        'Browser routing brief proves object routing only; page action completion needs separate evidence.',
    };
  }

  if (args.relationToBrowserActiveTab === 'latest_ai_operated_background_tab') {
    return {
      summary: `AI routing brief: latest AI-operated tab=${latestAiTabText} is background while browser-active tab=${activeTabText}; operation=${operationText}.`,
      recommendedNextCheck:
        'Reselect or reread the latest AI-operated tab before continuing the task.',
      canContinueOnLatestAiOperatedTab: false,
      claimBoundary:
        'Browser routing brief proves the operation target is not the browser-active tab; it does not prove page content or task result.',
    };
  }

  if (args.relationToBrowserActiveTab === 'browser_active_not_latest_ai_operated') {
    return {
      summary: `AI routing brief: browser-active tab=${activeTabText} differs from latest AI-operated tab=${latestAiTabText}; operation=${operationText}.`,
      recommendedNextCheck:
        'Refresh routing and explicitly choose the intended tab before taking the next action.',
      canContinueOnLatestAiOperatedTab: false,
      claimBoundary:
        'Browser routing brief identifies object mismatch only; it does not choose the task target.',
    };
  }

  return {
    summary: `AI routing brief: browser-active tab=${activeTabText}, latestAiOperatedTab=${latestAiTabText}, relation=${args.relationToBrowserActiveTab}; operation=${operationText}.`,
    recommendedNextCheck: 'Refresh browser object routing before continuing.',
    canContinueOnLatestAiOperatedTab: null,
    claimBoundary:
      'Browser routing brief is uncertain and must not be treated as task success evidence.',
  };
}

function buildOperationTargetBrief(args: {
  browserActiveTab: BrowserWorldTabObject | null;
  latestAiOperatedTab: BrowserWorldTabObject | null;
  relationToBrowserActiveTab: string;
  canContinueOnLatestAiOperatedTab: boolean | null;
}) {
  const activeTabId = args.browserActiveTab?.tabId ?? null;
  const latestAiTabId = args.latestAiOperatedTab?.tabId ?? null;

  if (args.relationToBrowserActiveTab === 'no_ai_operation_observed') {
    return {
      targetTabId: activeTabId,
      targetWindowId: args.browserActiveTab?.windowId ?? null,
      targetRole: 'browser_active_tab_candidate',
      targetBasis: 'no_ai_operated_tab_observed',
      targetCanTabrixOperate: args.browserActiveTab?.canTabrixOperate ?? null,
      targetOperabilityReason:
        args.browserActiveTab?.operabilityReason ?? 'active_tab_not_observed',
      browserActiveTabId: activeTabId,
      latestAiOperatedTabId: null,
      relationToBrowserActiveTab: args.relationToBrowserActiveTab,
      shouldReselectBeforeAction: false,
      nextRequiredCheck: 'read_or_select_intended_target',
      summary:
        activeTabId === null
          ? 'Operation target brief: no AI-operated tab is known and no browser-active tab is observed; select a target before acting.'
          : `Operation target brief: no AI-operated tab is known; browser-active tab ${activeTabId} is only a candidate target until it is read or explicitly selected.`,
      claimBoundary:
        'Target brief uses browser object routing only; it does not prove page content, user intent, or task success.',
    };
  }

  if (args.relationToBrowserActiveTab === 'same_as_browser_active') {
    return {
      targetTabId: latestAiTabId,
      targetWindowId: args.latestAiOperatedTab?.windowId ?? null,
      targetRole: 'latest_ai_operated_active_tab',
      targetBasis: 'latest_ai_operated_tab_matches_browser_active_tab',
      targetCanTabrixOperate: args.latestAiOperatedTab?.canTabrixOperate ?? null,
      targetOperabilityReason:
        args.latestAiOperatedTab?.operabilityReason ?? 'latest_ai_operated_tab_not_observed',
      browserActiveTabId: activeTabId,
      latestAiOperatedTabId: latestAiTabId,
      relationToBrowserActiveTab: args.relationToBrowserActiveTab,
      shouldReselectBeforeAction: false,
      nextRequiredCheck:
        args.canContinueOnLatestAiOperatedTab === true
          ? 'page_level_read_or_postcondition_check'
          : 'refresh_target_state',
      summary: `Operation target brief: latest AI-operated tab ${latestAiTabId ?? 'unknown'} is also browser-active; continue only after page-level evidence is refreshed.`,
      claimBoundary:
        'Target brief proves routing alignment only; page action completion still needs read/postcondition evidence.',
    };
  }

  if (args.relationToBrowserActiveTab === 'latest_ai_operated_background_tab') {
    return {
      targetTabId: latestAiTabId,
      targetWindowId: args.latestAiOperatedTab?.windowId ?? null,
      targetRole: 'latest_ai_operated_background_tab',
      targetBasis: 'latest_ai_operated_tab_differs_from_browser_active_tab',
      targetCanTabrixOperate: args.latestAiOperatedTab?.canTabrixOperate ?? null,
      targetOperabilityReason:
        args.latestAiOperatedTab?.operabilityReason ?? 'latest_ai_operated_tab_not_observed',
      browserActiveTabId: activeTabId,
      latestAiOperatedTabId: latestAiTabId,
      relationToBrowserActiveTab: args.relationToBrowserActiveTab,
      shouldReselectBeforeAction: true,
      nextRequiredCheck: 'reselect_or_reread_latest_ai_operated_tab',
      summary: `Operation target brief: latest AI-operated tab ${latestAiTabId ?? 'unknown'} is not browser-active; active tab is ${activeTabId ?? 'unknown'}, so do not act until the intended tab is reselected or reread.`,
      claimBoundary:
        'Target brief proves a browser object mismatch only; it does not decide user intent or task success.',
    };
  }

  if (args.relationToBrowserActiveTab === 'browser_active_not_latest_ai_operated') {
    return {
      targetTabId: latestAiTabId,
      targetWindowId: args.latestAiOperatedTab?.windowId ?? null,
      targetRole: 'ambiguous_latest_ai_operated_tab',
      targetBasis: 'browser_active_tab_differs_from_latest_ai_operated_tab',
      targetCanTabrixOperate: args.latestAiOperatedTab?.canTabrixOperate ?? null,
      targetOperabilityReason:
        args.latestAiOperatedTab?.operabilityReason ?? 'latest_ai_operated_tab_not_observed',
      browserActiveTabId: activeTabId,
      latestAiOperatedTabId: latestAiTabId,
      relationToBrowserActiveTab: args.relationToBrowserActiveTab,
      shouldReselectBeforeAction: true,
      nextRequiredCheck: 'refresh_routing_and_choose_target',
      summary: `Operation target brief: browser-active tab ${activeTabId ?? 'unknown'} differs from latest AI-operated tab ${latestAiTabId ?? 'unknown'}; refresh routing before acting.`,
      claimBoundary:
        'Target brief identifies target ambiguity only; it must not be treated as a page or task verdict.',
    };
  }

  return {
    targetTabId: null,
    targetWindowId: null,
    targetRole: 'unknown',
    targetBasis: 'routing_relation_unknown',
    targetCanTabrixOperate: null,
    targetOperabilityReason: 'routing_relation_unknown',
    browserActiveTabId: activeTabId,
    latestAiOperatedTabId: latestAiTabId,
    relationToBrowserActiveTab: args.relationToBrowserActiveTab,
    shouldReselectBeforeAction: true,
    nextRequiredCheck: 'refresh_browser_object_snapshot',
    summary:
      'Operation target brief: browser object routing is unknown; refresh the browser snapshot before acting.',
    claimBoundary:
      'Target brief is uncertain and must not be used as operation permission or task evidence.',
  };
}

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const browserWorld = await refreshBrowserWorldSnapshot();
      const browserActiveTab =
        browserWorld.tabs.find((tab) => tab.tabId === browserWorld.browserActiveTabId) ?? null;
      const latestAiOperatedTab =
        browserWorld.tabs.find(
          (tab) => tab.tabId === browserWorld.summary.aiOperationState.latestAiOperatedTabId,
        ) ?? null;

      const structuredWindows = browserWorld.windows.map((window) => {
        const tabs = browserWorld.tabs
          .filter((tab) => tab.windowId === window.windowId)
          .map((tab) => {
            return {
              tabId: tab.tabId,
              url: tab.url || '',
              pendingUrl: tab.pendingUrl || '',
              title: tab.title || '',
              active: tab.active || false,
              status: tab.status,
              discarded: tab.discarded,
              audible: tab.audible,
              muted: tab.muted,
              pinned: tab.pinned,
              openerTabId: tab.openerTabId,
              openedBy: tab.openedBy,
              openedByConfidence: tab.openedByConfidence,
              openedByReason: tab.openedByReason,
              canTabrixOperate: tab.canTabrixOperate,
              operabilityReason: tab.operabilityReason,
              aiOperationState: tab.aiOperationState,
              lastAiOperation: tab.lastAiOperation,
              lastAiOperationAtMs: tab.lastAiOperationAtMs,
              lastAiOperationConfidence: tab.lastAiOperationConfidence,
              lastAiOperationReason: tab.lastAiOperationReason,
            };
          });
        const activeTab = tabs.find((tab) => tab.active === true) || null;

        return {
          windowId: window.windowId,
          state: window.state || 'unknown',
          visibilityState: window.visibilityState,
          focused: typeof window.focused === 'boolean' ? window.focused : null,
          isFocused: window.isFocused,
          isMinimized: window.isMinimized,
          type: window.type || 'unknown',
          incognito: typeof window.incognito === 'boolean' ? window.incognito : null,
          width: Number.isInteger(window.width) ? window.width : null,
          height: Number.isInteger(window.height) ? window.height : null,
          left: Number.isInteger(window.left) ? window.left : null,
          top: Number.isInteger(window.top) ? window.top : null,
          activeTabId: activeTab ? activeTab.tabId : null,
          activeTabCanOperate: window.activeTabCanOperate,
          canTabrixOperate: window.canTabrixOperate,
          operabilityReason: window.operabilityReason,
          tabCount: tabs.length,
          tabs,
        };
      });

      const result = {
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        windowCount: browserWorld.windowCount,
        tabCount: browserWorld.tabCount,
        compactSummary: {
          primaryConclusion: browserWorld.summary.primaryConclusion,
          activeObject: {
            windowId: browserWorld.summary.activeWindow.windowId,
            windowState: browserWorld.summary.activeWindow.state,
            windowVisibilityState: browserWorld.summary.activeWindow.visibilityState,
            tabId: browserWorld.summary.activeTab.tabId,
            tabWindowId: browserWorld.summary.activeTab.windowId,
            url: browserWorld.summary.activeTab.url,
            title: browserWorld.summary.activeTab.title,
            openedBy: browserWorld.summary.activeTab.openedBy,
            tabStatus: browserWorld.summary.currentTabObject?.status ?? null,
            tabOperabilityReason:
              browserWorld.summary.currentTabObject?.operabilityReason ?? 'active_tab_not_observed',
            windowOperabilityReason:
              structuredWindows.find(
                (window) => window.windowId === browserWorld.summary.activeWindow.windowId,
              )?.operabilityReason ?? 'active_window_not_observed',
            canTabrixOperate:
              browserWorld.summary.activeTab.canTabrixOperate === false ||
              browserWorld.summary.activeWindow.canTabrixOperate === false
                ? false
                : (browserWorld.summary.activeTab.canTabrixOperate ??
                  browserWorld.summary.activeWindow.canTabrixOperate),
          },
          objectInventory: {
            objectModel: 'BrowserWorldObject -> BrowserWindowObject[] -> BrowserTabObject[]',
            compactIdLimit: COMPACT_OBJECT_ID_LIMIT,
            windowObjectCount: browserWorld.windowCount,
            tabPageObjectCount: browserWorld.tabCount,
            activeWindowId: browserWorld.summary.activeWindow.windowId,
            browserActiveTabId: browserWorld.browserActiveTabId,
            latestAiOperatedTabId: browserWorld.summary.aiOperationState.latestAiOperatedTabId,
            latestAiOperationConfidence:
              browserWorld.summary.aiOperationState.latestAiOperationConfidence,
            latestAiOperationReason: browserWorld.summary.aiOperationState.latestAiOperationReason,
            currentOperationRelation:
              browserWorld.summary.aiOperationState.relationToBrowserActiveTab,
            canContinueOnLatestAiOperatedTab:
              browserWorld.summary.aiOperationState.canContinueOnLatestAiOperatedTab,
            aiOpened: buildCompactIdSet(browserWorld.aiOpenedTabIds),
            userOrPageOpened: buildCompactIdSet(browserWorld.userOrPageOpenedTabIds),
            unknownOpened: buildCompactIdSet(
              browserWorld.tabs.filter((tab) => tab.openedBy === 'unknown').map((tab) => tab.tabId),
            ),
            operable: buildCompactIdSet(browserWorld.operableTabIds),
            inoperable: buildCompactIdSet(
              browserWorld.tabs
                .filter((tab) => tab.canTabrixOperate === false)
                .map((tab) => tab.tabId),
            ),
            recentlyOperatedByAi: buildCompactIdSet(
              browserWorld.tabs
                .filter((tab) => tab.aiOperationState === 'recently_operated')
                .map((tab) => tab.tabId),
            ),
            summary: `Browser object inventory: windows=${browserWorld.windowCount}, tabs=${browserWorld.tabCount}, activeTab=${browserWorld.browserActiveTabId ?? 'unknown'}, aiOpened=${browserWorld.aiOpenedTabIds.length}, userOrPageOpened=${browserWorld.userOrPageOpenedTabIds.length}, operable=${browserWorld.operableTabIds.length}, currentOperation=${browserWorld.summary.aiOperationState.relationToBrowserActiveTab}.`,
            claimBoundary:
              'Object inventory summary contains browser lifecycle ids and routing facts only; it does not prove page content understanding, account state, login success, or API/CDP reuse.',
          },
          browserActiveObject: buildCompactTabObject(browserActiveTab, 'browser_active_tab'),
          latestAiOperatedObject: buildCompactTabObject(
            latestAiOperatedTab,
            'latest_ai_operated_tab',
          ),
          operationRouting: {
            browserActiveTabId: browserWorld.browserActiveTabId,
            latestAiOperatedTabId: browserWorld.summary.aiOperationState.latestAiOperatedTabId,
            relationToBrowserActiveTab:
              browserWorld.summary.aiOperationState.relationToBrowserActiveTab,
            canContinueOnLatestAiOperatedTab:
              browserWorld.summary.aiOperationState.canContinueOnLatestAiOperatedTab,
            latestAiOperation: browserWorld.summary.aiOperationState.latestAiOperation,
            latestAiOperationConfidence:
              browserWorld.summary.aiOperationState.latestAiOperationConfidence,
            latestAiOperationReason: browserWorld.summary.aiOperationState.latestAiOperationReason,
            summary: browserWorld.summary.currentOperationConclusion,
            claimBoundary:
              'Operation routing identifies browser tab objects only; it does not prove page action postconditions or task completion.',
          },
          aiRoutingBrief: buildAiRoutingBrief({
            browserActiveTabId: browserWorld.browserActiveTabId,
            latestAiOperatedTabId: browserWorld.summary.aiOperationState.latestAiOperatedTabId,
            latestAiOperation: browserWorld.summary.aiOperationState.latestAiOperation,
            relationToBrowserActiveTab:
              browserWorld.summary.aiOperationState.relationToBrowserActiveTab,
            canContinueOnLatestAiOperatedTab:
              browserWorld.summary.aiOperationState.canContinueOnLatestAiOperatedTab,
            activeTabCanOperate: browserActiveTab?.canTabrixOperate ?? null,
          }),
          operationTargetBrief: buildOperationTargetBrief({
            browserActiveTab,
            latestAiOperatedTab,
            relationToBrowserActiveTab:
              browserWorld.summary.aiOperationState.relationToBrowserActiveTab,
            canContinueOnLatestAiOperatedTab:
              browserWorld.summary.aiOperationState.canContinueOnLatestAiOperatedTab,
          }),
          windows: structuredWindows.map((window) => ({
            windowId: window.windowId,
            state: window.state,
            visibilityState: window.visibilityState,
            focused: window.focused,
            activeTabId: window.activeTabId,
            canTabrixOperate: window.canTabrixOperate,
            operabilityReason: window.operabilityReason,
            tabCount: window.tabCount,
            compactTabLimit: COMPACT_TABS_PER_WINDOW_LIMIT,
            omittedTabCount: Math.max(0, window.tabs.length - COMPACT_TABS_PER_WINDOW_LIMIT),
            tabs: selectCompactTabsForWindow(
              window.tabs.map((tab) => ({
                tabId: tab.tabId,
                title: tab.title,
                url: tab.url,
                active: tab.active,
                status: tab.status,
                openedBy: tab.openedBy,
                canTabrixOperate: tab.canTabrixOperate,
                operabilityReason: tab.operabilityReason,
              })),
            ),
          })),
          windowStateMatrix: browserWorld.summary.windowStateMatrix,
          windowStateConclusion: browserWorld.summary.windowStateConclusion,
          windowOperationState: browserWorld.summary.windowOperationState,
          currentWindowConclusion: browserWorld.summary.currentWindowConclusion,
          tabStateMatrix: browserWorld.summary.tabStateMatrix,
          tabStateConclusion: browserWorld.summary.tabStateConclusion,
          tabLifecycleState: browserWorld.summary.tabLifecycleState,
          tabLifecycleConclusion: browserWorld.summary.tabLifecycleConclusion,
          aiOperationState: browserWorld.summary.aiOperationState,
          currentOperationConclusion: browserWorld.summary.currentOperationConclusion,
          browserObjectEdgeSummary: browserWorld.summary.browserObjectEdgeSummary,
          recentChangeSummary: browserWorld.summary.recentChangeSummary,
          objectChangeSummary: browserWorld.summary.objectChangeSummary,
          dynamicObjectUpdateSummary: browserWorld.summary.dynamicObjectUpdateSummary,
          objectChangeConclusion: browserWorld.summary.objectChangeConclusion,
          retentionPolicy: browserWorld.retentionPolicy,
          claimBoundary:
            'Browser lifecycle summary only; page content, account state, login success, and API/CDP reuse require separate evidence.',
        },
        summary: browserWorld.summary,
        browserWorld,
        windows: structuredWindows,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in WindowTool.execute:', error);
      return createErrorResponse(
        `Error getting windows and tabs information: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const windowTool = new WindowTool();
