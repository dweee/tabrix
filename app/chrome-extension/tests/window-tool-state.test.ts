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
            title: 'Example',
            active: false,
          },
          {
            id: 102,
            url: 'https://example.test/active',
            title: 'Active',
            active: true,
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
          focused: true,
          type: 'normal',
          incognito: false,
          width: 1280,
          height: 720,
          left: 100,
          top: 50,
          activeTabId: 102,
          tabCount: 2,
          tabs: [
            {
              tabId: 101,
              url: 'https://example.test/',
              title: 'Example',
              active: false,
            },
            {
              tabId: 102,
              url: 'https://example.test/active',
              title: 'Active',
              active: true,
            },
          ],
        },
        {
          windowId: 20,
          state: 'minimized',
          focused: false,
          type: 'popup',
          incognito: true,
          width: null,
          height: null,
          left: null,
          top: null,
          activeTabId: null,
          tabCount: 0,
          tabs: [],
        },
      ],
    });
  });
});
