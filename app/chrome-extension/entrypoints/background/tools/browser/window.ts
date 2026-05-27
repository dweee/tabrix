import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;
  async execute(): Promise<ToolResult> {
    try {
      const windows = await chrome.windows.getAll({ populate: true });
      let tabCount = 0;

      const structuredWindows = windows.map((window) => {
        const tabs =
          window.tabs?.map((tab) => {
            tabCount++;
            return {
              tabId: tab.id || 0,
              url: tab.url || '',
              title: tab.title || '',
              active: tab.active || false,
            };
          }) || [];
        const activeTab = tabs.find((tab) => tab.active === true) || null;

        return {
          windowId: window.id || 0,
          state: window.state || 'unknown',
          focused: typeof window.focused === 'boolean' ? window.focused : null,
          type: window.type || 'unknown',
          incognito: typeof window.incognito === 'boolean' ? window.incognito : null,
          width: Number.isInteger(window.width) ? window.width : null,
          height: Number.isInteger(window.height) ? window.height : null,
          left: Number.isInteger(window.left) ? window.left : null,
          top: Number.isInteger(window.top) ? window.top : null,
          activeTabId: activeTab ? activeTab.tabId : null,
          tabCount: tabs.length,
          tabs,
        };
      });

      const result = {
        windowCount: windows.length,
        tabCount: tabCount,
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
