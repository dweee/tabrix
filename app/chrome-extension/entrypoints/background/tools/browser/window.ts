import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import {
  refreshBrowserWorldSnapshot,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';

const COMPACT_TABS_PER_WINDOW_LIMIT = 12;
const COMPACT_ID_LIMIT = 12;

type PageState = 'foreground' | 'running' | 'loading' | 'closed' | 'restricted';

type WindowToolParams = {
  includeDiagnostics?: boolean;
};

type TabSummary = {
  tabId: number;
  windowId: number | null;
  title: string;
  url: string;
  active: boolean | null;
  pageState: PageState;
  pageStateLabel: string;
  loadState: string | null;
  canTabrixOperate: boolean | null;
  operabilityReason: string;
};

function toPageState(tab: BrowserWorldTabObject, foregroundTabId: number | null): PageState {
  if (tab.aiOperationState === 'closed' || tab.closedAtMs !== null) return 'closed';
  if (tab.canTabrixOperate === false) return 'restricted';
  if (typeof foregroundTabId === 'number' && tab.tabId === foregroundTabId) return 'foreground';
  if (tab.status === 'loading') return 'loading';
  return 'running';
}

function toPageStateLabel(state: PageState): string {
  switch (state) {
    case 'foreground':
      return '前台页';
    case 'running':
      return '运行中';
    case 'loading':
      return '加载中';
    case 'closed':
      return '已关闭';
    case 'restricted':
      return '受限页';
  }
}

function toTabSummary(tab: BrowserWorldTabObject, foregroundTabId: number | null): TabSummary {
  const pageState = toPageState(tab, foregroundTabId);
  return {
    tabId: tab.tabId,
    windowId: tab.windowId,
    title: tab.title || '',
    url: tab.url || '',
    active: tab.active,
    pageState,
    pageStateLabel: toPageStateLabel(pageState),
    loadState: tab.status,
    canTabrixOperate: tab.canTabrixOperate,
    operabilityReason: tab.operabilityReason,
  };
}

function compactTabs(tabs: TabSummary[]): TabSummary[] {
  if (tabs.length <= COMPACT_TABS_PER_WINDOW_LIMIT) return tabs;
  const selected = tabs.slice(0, COMPACT_TABS_PER_WINDOW_LIMIT);
  const activeTab = tabs.find((tab) => tab.active === true);
  if (activeTab && !selected.some((tab) => tab.tabId === activeTab.tabId)) {
    selected[selected.length - 1] = activeTab;
  }
  return selected;
}

function compactIds(ids: number[]) {
  return {
    ids: ids.slice(0, COMPACT_ID_LIMIT),
    omittedCount: Math.max(0, ids.length - COMPACT_ID_LIMIT),
  };
}

function countByPageState(tabs: TabSummary[]) {
  return tabs.reduce(
    (counts, tab) => {
      counts[tab.pageState] += 1;
      return counts;
    },
    {
      foreground: 0,
      running: 0,
      loading: 0,
      closed: 0,
      restricted: 0,
    } satisfies Record<PageState, number>,
  );
}

class WindowTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS;

  async execute(args: WindowToolParams = {}): Promise<ToolResult> {
    try {
      const browserWorld = await refreshBrowserWorldSnapshot({ ensureBaselineReady: true });
      const tabs = browserWorld.tabs.map((tab) =>
        toTabSummary(tab, browserWorld.browserActiveTabId),
      );
      const currentPage =
        tabs.find((tab) => tab.tabId === browserWorld.browserActiveTabId) ??
        tabs.find((tab) => tab.active === true) ??
        null;

      const windows = browserWorld.windows.map((window) => {
        const windowTabs = tabs.filter((tab) => tab.windowId === window.windowId);
        return {
          windowId: window.windowId,
          focused: window.focused,
          state: window.state,
          visibilityState: window.visibilityState,
          activeTabId: window.activeTabId,
          canTabrixOperate: window.canTabrixOperate,
          operabilityReason: window.operabilityReason,
          tabCount: windowTabs.length,
          omittedTabCount: Math.max(0, windowTabs.length - COMPACT_TABS_PER_WINDOW_LIMIT),
          tabs: compactTabs(windowTabs),
        };
      });

      const stateCounts = countByPageState(tabs);
      const result = {
        source: 'chrome_windows_get_all',
        windowCount: browserWorld.windowCount,
        tabCount: browserWorld.tabCount,
        currentPage,
        compactSummary: {
          currentPage,
          stateCounts,
          tabIds: {
            foreground: compactIds(
              tabs.filter((tab) => tab.pageState === 'foreground').map((tab) => tab.tabId),
            ),
            running: compactIds(
              tabs.filter((tab) => tab.pageState === 'running').map((tab) => tab.tabId),
            ),
            loading: compactIds(
              tabs.filter((tab) => tab.pageState === 'loading').map((tab) => tab.tabId),
            ),
            restricted: compactIds(
              tabs.filter((tab) => tab.pageState === 'restricted').map((tab) => tab.tabId),
            ),
          },
          windows,
        },
        windows,
        ...(args?.includeDiagnostics === true
          ? {
              diagnostics: {
                baselineReadiness: browserWorld.baselineReadiness,
                refreshHealth: browserWorld.refreshHealth,
                retentionPolicy: browserWorld.retentionPolicy,
                recentEvents: browserWorld.recentEvents,
                summary: browserWorld.summary,
              },
            }
          : {}),
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
