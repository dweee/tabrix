import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionWorld } from '@/common/constants';
import { injectScriptTool } from '@/entrypoints/background/tools/browser/inject-script';

describe('inject script tool', () => {
  let updatedListeners: Array<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    updatedListeners = [];
    chrome.tabs.onUpdated.addListener = vi.fn((listener) => {
      updatedListeners.push(listener);
    }) as typeof chrome.tabs.onUpdated.addListener;
    chrome.tabs.onUpdated.removeListener = vi.fn() as typeof chrome.tabs.onUpdated.removeListener;
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 88,
      windowId: 7,
      active: true,
      status: 'loading',
      url: 'https://example.test/app',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 88,
      windowId: 7,
      active: true,
      status: 'loading',
      url: 'https://example.test/app',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 88,
      windowId: 7,
      active: true,
      status: 'complete',
      url: 'https://example.test/app',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.windows.update).mockResolvedValue({
      id: 7,
      focused: true,
    } as chrome.windows.Window);
    vi.mocked(chrome.scripting.executeScript).mockResolvedValue([]);
  });

  it('continues after the created tab reports complete instead of sleeping for the full cap', async () => {
    const pending = injectScriptTool.execute({
      url: 'https://example.test/app',
      type: ExecutionWorld.ISOLATED,
      jsScript: 'window.__tabrixInjected = true;',
    });

    await vi.waitFor(() => {
      expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();

    const completeTab = {
      id: 88,
      windowId: 7,
      active: true,
      status: 'complete',
      url: 'https://example.test/app',
    } as chrome.tabs.Tab;
    updatedListeners[0](88, { status: 'complete' }, completeTab);

    const result = await pending;

    expect(result.isError).toBe(false);
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual({ injected: true });
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledWith(updatedListeners[0]);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 88 },
        world: ExecutionWorld.ISOLATED,
      }),
    );
  });
});
