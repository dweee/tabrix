import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closeTabsTool } from '@/entrypoints/background/tools/browser/common';

describe('chrome_close_tabs hygiene guard', () => {
  beforeEach(() => {
    vi.mocked(chrome.tabs.query).mockReset();
    vi.mocked(chrome.tabs.get).mockReset();
    vi.mocked(chrome.tabs.remove).mockReset();
    (chrome as unknown as { windows: { getAll: ReturnType<typeof vi.fn> } }).windows = {
      getAll: vi.fn(),
    };
  });

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
      .mockResolvedValueOnce([
        { id: 1, focused: false },
        { id: 2, focused: true },
      ] as chrome.windows.Window[])
      .mockResolvedValueOnce([{ id: 1, focused: true }] as chrome.windows.Window[]);
    vi.mocked(chrome.tabs.remove).mockResolvedValue(undefined);

    const result = await closeTabsTool.execute({ tabIds: [10] });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.browserHygieneEvidence.tabWindowBaselineUnchanged).toBe(true);
    expect(payload.browserHygieneEvidence.activeTabRestored).toBe(true);
  });

  it('still flags hygiene failure when more tabs disappear than requested', async () => {
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
});
