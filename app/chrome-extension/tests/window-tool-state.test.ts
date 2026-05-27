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
});
