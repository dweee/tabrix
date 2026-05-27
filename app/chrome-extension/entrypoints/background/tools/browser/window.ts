import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { refreshBrowserWorldSnapshot } from '../../browser-world-inventory';

const COMPACT_TABS_PER_WINDOW_LIMIT = 12;

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

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const browserWorld = await refreshBrowserWorldSnapshot();

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
            canTabrixOperate:
              browserWorld.summary.activeTab.canTabrixOperate === false ||
              browserWorld.summary.activeWindow.canTabrixOperate === false
                ? false
                : (browserWorld.summary.activeTab.canTabrixOperate ??
                  browserWorld.summary.activeWindow.canTabrixOperate),
          },
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
          recentChangeSummary: browserWorld.summary.recentChangeSummary,
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
