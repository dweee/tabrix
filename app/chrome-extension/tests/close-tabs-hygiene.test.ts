import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTabsTool } from '@/entrypoints/background/tools/browser/common';
import {
  markBrowserWorldTabAiCreated,
  resetBrowserWorldInventoryForTests,
} from '@/entrypoints/background/browser-world-inventory';

describe('chrome_close_tabs hygiene guard', () => {
  beforeEach(() => {
    resetBrowserWorldInventoryForTests();
    vi.mocked(chrome.tabs.query).mockReset();
    vi.mocked(chrome.tabs.get).mockReset();
    vi.mocked(chrome.tabs.remove).mockReset();
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows = {
      getAll: vi.fn(),
    };
  });

  function aiOwnedWindowInventory(tabId = 10): chrome.windows.Window[] {
    return [
      {
        id: 1,
        focused: false,
        state: 'normal',
        type: 'normal',
        tabs: [{ id: 1, windowId: 1, active: true, url: 'https://user.test/' }],
      },
      {
        id: 2,
        focused: true,
        state: 'normal',
        type: 'normal',
        tabs: [
          {
            id: tabId,
            windowId: 2,
            active: true,
            url: 'https://example.test/',
            title: 'AI opened',
            status: 'complete',
          },
        ],
      },
    ] as chrome.windows.Window[];
  }

  it('refuses empty args instead of closing the active user tab', async () => {
    const removeSpy = vi.spyOn(chrome.tabs, 'remove');

    const result = await closeTabsTool.execute({});

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      'Refusing to close the active tab without explicit tabIds or url',
    );
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('treats a run-owned one-tab window close as clean browser hygiene', async () => {
    markBrowserWorldTabAiCreated(10);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 2,
      active: true,
      url: 'https://example.test/',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([
        { id: 1, windowId: 1, active: true },
        { id: 10, windowId: 2, active: true },
      ] as chrome.tabs.Tab[])
      .mockResolvedValueOnce([{ id: 1, windowId: 1, active: true }] as chrome.tabs.Tab[]);
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows.getAll
      .mockResolvedValueOnce(aiOwnedWindowInventory())
      .mockResolvedValueOnce([
        { id: 1, focused: false },
        { id: 2, focused: true },
      ] as chrome.windows.Window[])
      .mockResolvedValueOnce([{ id: 1, focused: true }] as chrome.windows.Window[]);
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);

    const result = await closeTabsTool.execute({ tabIds: [10] });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.closePreflightEvidence.verdict).toBe('allowed');
    expect(payload.closePreflightEvidence.allowedTabIds).toEqual([10]);
    expect(payload.browserHygieneEvidence.tabWindowBaselineUnchanged).toBe(true);
    expect(payload.browserHygieneEvidence.activeTabRestored).toBe(true);
  });

  it('still flags hygiene failure when more tabs disappear than requested', async () => {
    markBrowserWorldTabAiCreated(10);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 2,
      active: true,
      url: 'https://example.test/',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([
        { id: 1, windowId: 1, active: true },
        { id: 10, windowId: 2, active: true },
        { id: 11, windowId: 2, active: false },
      ] as chrome.tabs.Tab[])
      .mockResolvedValueOnce([{ id: 1, windowId: 1, active: true }] as chrome.tabs.Tab[]);
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows.getAll
      .mockResolvedValueOnce(aiOwnedWindowInventory())
      .mockResolvedValueOnce([
        { id: 1, focused: false },
        { id: 2, focused: true },
      ] as chrome.windows.Window[])
      .mockResolvedValueOnce([{ id: 1, focused: true }] as chrome.windows.Window[]);
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);

    const result = await closeTabsTool.execute({ tabIds: [10] });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.browserHygieneEvidence.tabWindowBaselineUnchanged).toBe(false);
  });

  it('blocks a user-owned tab before chrome.tabs.remove is called', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 2,
      active: true,
      url: 'https://example.test/',
    } as chrome.tabs.Tab);
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows.getAll
      .mockResolvedValueOnce(aiOwnedWindowInventory())
      .mockResolvedValueOnce(aiOwnedWindowInventory());

    const result = await closeTabsTool.execute({ tabIds: [10] });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(true);
    expect(payload.blockedByPolicy).toBe(true);
    expect(payload.closePreflightEvidence.verdict).toBe('blocked');
    expect(payload.closePreflightEvidence.blockedTabs[0]).toMatchObject({
      tabId: 10,
      reason: 'tab_not_ai_owned',
      openedBy: 'user_or_page',
      cleanupEligibility: 'not_eligible',
    });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('blocks when BrowserWorld cannot prove a fresh close baseline', async () => {
    markBrowserWorldTabAiCreated(10);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 2,
      active: true,
      url: 'https://example.test/',
    } as chrome.tabs.Tab);
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows.getAll
      .mockRejectedValueOnce(new Error('chrome inventory unavailable'))
      .mockRejectedValueOnce(new Error('chrome inventory unavailable'));

    const result = await closeTabsTool.execute({ tabIds: [10] });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(true);
    expect(payload.closePreflightEvidence.verdict).toBe('blocked');
    expect(payload.closePreflightEvidence.baselineReady).toBe(false);
    expect(payload.closePreflightEvidence.blockedTabs[0]).toMatchObject({
      tabId: 10,
      reason: 'browser_world_baseline_not_ready',
    });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });

  it('applies windowId to URL-based close before preflight', async () => {
    markBrowserWorldTabAiCreated(20);
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([
        {
          id: 20,
          windowId: 5,
          active: true,
          url: 'https://example.test/path',
        },
      ] as chrome.tabs.Tab[])
      .mockResolvedValueOnce([{ id: 20, windowId: 5, active: true }] as chrome.tabs.Tab[])
      .mockResolvedValueOnce([] as chrome.tabs.Tab[]);
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows.getAll
      .mockResolvedValueOnce([
        {
          id: 5,
          focused: true,
          state: 'normal',
          type: 'normal',
          tabs: [
            {
              id: 20,
              windowId: 5,
              active: true,
              url: 'https://example.test/path',
              status: 'complete',
            },
          ],
        },
      ] as chrome.windows.Window[])
      .mockResolvedValueOnce([{ id: 5, focused: true }] as chrome.windows.Window[])
      .mockResolvedValueOnce([{ id: 5, focused: true }] as chrome.windows.Window[]);

    const result = await closeTabsTool.execute({
      url: 'https://example.test/path',
      windowId: 5,
    });

    expect(result.isError).toBe(false);
    expect(chrome.tabs.query).toHaveBeenCalledWith({
      url: 'https://example.test/path/*',
      windowId: 5,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith([20]);
  });
});
