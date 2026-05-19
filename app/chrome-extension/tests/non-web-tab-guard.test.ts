import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickTool, fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';

describe('non-web tab guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a structured unsupported_page_type response for chrome_read_page on extension tabs', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3101,
      title: 'Tabrix Connect',
      url: 'chrome-extension://test-extension-id/connect.html',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await readPageTool.execute({ tabId: 3101 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.pageType).toBe('extension_page');
    expect(payload.recommendedAction).toBe('switch_to_http_tab');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_click_element on extension tabs', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 3102,
      title: 'Tabrix Connect',
      url: 'chrome-extension://test-extension-id/connect.html',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await clickTool.execute({ tabId: 3102, selector: '#connect' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('click');
    expect(payload.pageType).toBe('extension_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_fill_or_select on browser-internal tabs', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 3103,
      title: 'Extensions',
      url: 'chrome://extensions/',
    });
    const injectSpy = vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);

    const result = await fillTool.execute({ tabId: 3103, selector: '#search', value: 'tabrix' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('fill');
    expect(payload.pageType).toBe('browser_internal_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('returns a structured unsupported_page_type response for chrome_read_page on error tabs', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3104,
      title: 'This site can’t be reached',
      url: 'chrome-error://chromewebdata/',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await readPageTool.execute({ tabId: 3104 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.scheme).toBe('chrome-error');
    expect(payload.pageType).toBe('browser_internal_page');
    expect(payload.recommendedAction).toBe('switch_to_http_tab');
    expect(injectSpy).not.toHaveBeenCalled();
  });

  it('waits for explicit pending http tabs before applying the non-web guard', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3108,
      title: '',
      url: '',
      pendingUrl: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
    });
    const waitSpy = vi.spyOn(readPageTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 3108,
        title: 'Search · ACP · GitHub',
        url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
        status: 'complete',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 120,
      readyState: 'complete',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        'Link "repo-one/acp"',
        'Link "repo-two/mcp-agent"',
        'Text "Repository results sorted by stars"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_1', role: 'link', name: 'repo-one/acp' },
        { ref: 'ref_2', role: 'link', name: 'repo-two/mcp-agent' },
        { ref: 'ref_3', role: 'text', name: 'Repository results sorted by stars' },
      ],
      viewport: { width: 1280, height: 720, dpr: 1 },
      stats: { processed: 3, included: 3, durationMs: 1 },
    });

    const result = await readPageTool.execute({ tabId: 3108 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(waitSpy).toHaveBeenCalledWith(3108, { timeoutMs: 5000 });
    expect(injectSpy).toHaveBeenCalled();
    expect(payload.reason).not.toBe('unsupported_page_type');
    expect(payload.page.url).toBe(
      'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
    );
  });

  it('waits for explicit loading http tabs before injecting read_page helpers', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3109,
      title: 'Search · ACP · GitHub',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      status: 'loading',
    });
    const waitSpy = vi.spyOn(readPageTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 3109,
        title: 'Search · ACP · GitHub',
        url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
        status: 'complete',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 120,
      readyState: 'complete',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        'Link "repo-one/acp"',
        'Link "repo-two/mcp-agent"',
        'Text "Repository results sorted by stars"',
      ].join('\n'),
      refMap: [
        { ref: 'ref_1', role: 'link', name: 'repo-one/acp' },
        { ref: 'ref_2', role: 'link', name: 'repo-two/mcp-agent' },
        { ref: 'ref_3', role: 'text', name: 'Repository results sorted by stars' },
      ],
      viewport: { width: 1280, height: 720, dpr: 1 },
      stats: { processed: 3, included: 3, durationMs: 1 },
    });

    const result = await readPageTool.execute({ tabId: 3109 });

    expect(result.isError).toBe(false);
    expect(waitSpy).toHaveBeenCalledWith(3109, { timeoutMs: 5000 });
    expect(injectSpy).toHaveBeenCalled();
  });

  it('reinjects the read_page helper when the first content message has no receiver', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3110,
      title: 'Search · ACP · GitHub',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      status: 'complete',
    });
    const injectSpy = vi
      .spyOn(readPageTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendMessageSpy = vi
      .spyOn(readPageTool as any, 'sendMessageToTab')
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({
        success: true,
        pageContent: [
          'Link "repo-one/acp"',
          'Link "repo-two/mcp-agent"',
          'Text "Repository results sorted by stars"',
        ].join('\n'),
        refMap: [
          { ref: 'ref_1', role: 'link', name: 'repo-one/acp' },
          { ref: 'ref_2', role: 'link', name: 'repo-two/mcp-agent' },
          { ref: 'ref_3', role: 'text', name: 'Repository results sorted by stars' },
        ],
        viewport: { width: 1280, height: 720, dpr: 1 },
        stats: { processed: 3, included: 3, durationMs: 1 },
      });

    const result = await readPageTool.execute({ tabId: 3110 });

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalledTimes(2);
    expect(sendMessageSpy).toHaveBeenCalledTimes(2);
  });

  it('returns a structured page_unreadable response when read_page injection hits an error page', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 3106,
      title: 'github.com',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockRejectedValue(
      new Error(
        'Tool execution failed: Failed to inject content script in tab 3106: Frame with ID 0 is showing error page',
      ),
    );

    const result = await readPageTool.execute({ tabId: 3106 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      success: false,
      reason: 'page_unreadable',
      pageType: 'browser_error_page',
      recommendedAction: 'retry_navigation_or_use_browser_status',
      nextStepHint:
        'page_unreadable; return BLOCKED or retry navigation before attempting structured reads',
    });
  });

  it('returns a structured page_unreadable response when web content injection hits an error page', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 3107,
      title: 'github.com',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
    } as chrome.tabs.Tab);
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockRejectedValue(
      new Error(
        'Tool execution failed: Failed to inject content script in tab 3107: Frame with ID 0 is showing error page',
      ),
    );

    const result = await webFetcherTool.execute({ tabId: 3107 });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      success: false,
      reason: 'page_unreadable',
      pageType: 'browser_error_page',
      recommendedAction: 'retry_navigation_or_use_browser_status',
      nextStepHint:
        'page_unreadable; return BLOCKED or retry navigation before attempting content extraction',
    });
  });

  it('returns a structured unsupported_page_type response for chrome_click_element on view-source tabs', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 3105,
      title: 'view-source',
      url: 'view-source:https://example.com/',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);

    const result = await clickTool.execute({ tabId: 3105, selector: 'body' });
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.reason).toBe('unsupported_page_type');
    expect(payload.action).toBe('click');
    expect(payload.scheme).toBe('view-source');
    expect(payload.pageType).toBe('unsupported_page');
    expect(injectSpy).not.toHaveBeenCalled();
  });
});
