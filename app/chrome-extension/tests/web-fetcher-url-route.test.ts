import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';

describe('web fetcher URL route', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    (chrome as unknown as { windows: typeof chrome.windows }).windows ??=
      {} as typeof chrome.windows;
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 42,
      windowId: 7,
      active: true,
      status: 'loading',
      url: 'https://example.test/docs',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 42,
      windowId: 7,
      active: true,
      status: 'complete',
      url: 'https://example.test/docs',
      title: 'Docs',
    } as chrome.tabs.Tab);
    (chrome.windows as any).update = vi.fn().mockResolvedValue({ id: 7, focused: true });
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 42,
      windowId: 7,
      active: true,
      status: 'complete',
      url: 'https://example.test/docs',
      title: 'Docs',
    } as chrome.tabs.Tab);
  });

  it('uses a longer bounded settle budget for URL-created content reads', async () => {
    const waitForTabSettled = vi
      .spyOn(webFetcherTool as any, 'waitForTabSettled')
      .mockResolvedValue({
        tab: {
          id: 42,
          windowId: 7,
          active: true,
          status: 'loading',
          url: 'https://example.test/docs',
          title: 'Docs',
        },
        settled: false,
        timedOut: true,
        reason: 'timeout',
        waitedMs: 30000,
        readyState: 'interactive',
      });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockImplementation(
      async (
        _tabId: number,
        _files: string[],
        _injectImmediately?: boolean,
        _world?: unknown,
        _allFrames?: boolean,
        _frameIds?: number[],
        onTiming?: (timing: unknown) => void,
      ) => {
        onTiming?.({
          pingMs: 300,
          pingStatus: 'failed_or_timeout',
          executeScriptMs: 42,
          injected: true,
          totalMs: 342,
        });
      },
    );
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent: 'Installation manual content '.repeat(40),
      textMode: 'body',
      textContentSource: 'readability_body_text',
    });

    const result = await webFetcherTool.execute({
      url: 'https://example.test/docs',
      textContent: true,
    });

    expect(result.isError).toBe(false);
    expect(waitForTabSettled).toHaveBeenCalledWith(42, { timeoutMs: 30000 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      createdTabForUrl: true,
      textMode: 'body',
      textContentSource: 'readability_body_text',
      settle: {
        timedOut: true,
        readyState: 'interactive',
      },
    });
    expect(payload.textSummary.completeTextAvailable).toBe(true);
    expect(payload.contentScriptInjection).toEqual(
      expect.objectContaining({
        pingMs: expect.any(Number),
        pingStatus: expect.any(String),
        executeScriptMs: expect.any(Number),
        injected: true,
        totalMs: expect.any(Number),
      }),
    );
    expect(payload.timing).toEqual(
      expect.objectContaining({
        resolveTabMs: expect.any(Number),
        focusMs: expect.any(Number),
        injectContentScriptMs: expect.any(Number),
        textContentRequestMs: expect.any(Number),
        refreshTabMetadataMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
  });

  it('still honors an explicit URL settle budget', async () => {
    const waitForTabSettled = vi
      .spyOn(webFetcherTool as any, 'waitForTabSettled')
      .mockResolvedValue({
        tab: {
          id: 42,
          windowId: 7,
          active: true,
          status: 'complete',
          url: 'https://example.test/docs',
          title: 'Docs',
        },
        settled: true,
        timedOut: false,
        reason: 'complete',
        waitedMs: 1000,
        readyState: 'complete',
      });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent: 'Short docs content',
      textMode: 'full-visible',
      textContentSource: 'document_body_innerText',
    });

    const result = await webFetcherTool.execute({
      url: 'https://example.test/docs',
      textContent: true,
      textMode: 'full-visible',
      settleTimeoutMs: 12000,
    });

    expect(result.isError).toBe(false);
    expect(waitForTabSettled).toHaveBeenCalledWith(42, { timeoutMs: 12000 });
  });
});
