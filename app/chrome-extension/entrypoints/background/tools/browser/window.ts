import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { refreshBrowserWorldSnapshot } from '../../browser-world-inventory';

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
