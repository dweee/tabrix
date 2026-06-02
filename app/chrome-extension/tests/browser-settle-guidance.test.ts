import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateTool, switchTabTool } from '@/entrypoints/background/tools/browser/common';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';
import { resetBrowserWorldInventoryForTests } from '@/entrypoints/background/browser-world-inventory';

describe('browser settle guidance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetBrowserWorldInventoryForTests();
    if (!chrome.tabs.reload) {
      (chrome.tabs as any).reload = vi.fn().mockResolvedValue(undefined);
    } else {
      (chrome.tabs.reload as any) = vi.fn().mockResolvedValue(undefined);
    }
    if (!chrome.windows) {
      (chrome as any).windows = {
        update: vi.fn().mockResolvedValue({ id: 1, focused: true }),
        getAll: vi.fn().mockResolvedValue([]),
        getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
        get: vi.fn().mockResolvedValue({ id: 1 }),
        create: vi.fn().mockResolvedValue({ id: 2, tabs: [{ id: 21, url: 'about:blank' }] }),
      };
    } else {
      (chrome.windows as any).update = vi.fn().mockResolvedValue({ id: 1, focused: true });
      (chrome.windows as any).getAll = vi.fn().mockResolvedValue([]);
      (chrome.windows as any).getLastFocused = vi.fn().mockResolvedValue({ id: 1 });
      (chrome.windows as any).get = vi.fn().mockResolvedValue({ id: 1 });
      (chrome.windows as any).create = vi
        .fn()
        .mockResolvedValue({ id: 2, tabs: [{ id: 21, url: 'about:blank' }] });
    }
    vi.mocked(chrome.tabs.query).mockResolvedValue([]);
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'http://127.0.0.1:62100/',
      title: 'Smoke',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page2',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page2',
      title: 'Loading',
    } as chrome.tabs.Tab);
  });

  it('retries content script injection once when Chrome swaps away the main frame', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValue(new Error('receiver missing'));
    vi.mocked(chrome.scripting.executeScript)
      .mockRejectedValueOnce(new Error('Frame with ID 0 was removed.'))
      .mockResolvedValueOnce([]);

    await expect(
      (readPageTool as any).injectContentScript(20, [
        '/inject-scripts/accessibility-tree-helper.js',
      ]),
    ).resolves.toBeUndefined();

    expect(chrome.scripting.executeScript).toHaveBeenCalledTimes(2);
    expect(chrome.scripting.executeScript).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        target: { tabId: 20 },
        files: ['/inject-scripts/accessibility-tree-helper.js'],
      }),
    );
  });

  it('returns settle metadata after navigating a newly created tab', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page2',
        title: 'Page 2',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 240,
      readyState: 'complete',
    });

    const result = await navigateTool.execute({
      url: 'http://127.0.0.1:62100/page2',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      requestedUrl: 'http://127.0.0.1:62100/page2',
      finalUrl: 'http://127.0.0.1:62100/page2',
      settled: true,
      settleReason: 'complete',
      waitedMs: 240,
      readyState: 'complete',
      pageReadable: true,
      canAttemptStructuredRead: true,
      nextStepHint: 'safe_to_read_page',
    });
  });

  it('opens new tabs in an existing same-site window before falling back to last-focused', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    (chrome.windows.get as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (id: number) => ({ id }),
    );
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([
        {
          id: 90,
          windowId: 9,
          active: false,
          discarded: false,
          status: 'complete',
          url: 'https://github.com/dashboard',
          title: 'GitHub',
        } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([
        {
          id: 90,
          windowId: 9,
          active: false,
          discarded: false,
          status: 'complete',
          url: 'https://github.com/dashboard',
          title: 'GitHub',
        } as chrome.tabs.Tab,
      ]);
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 91,
      windowId: 9,
      active: false,
      status: 'loading',
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 91,
        windowId: 9,
        active: false,
        status: 'complete',
        url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
        title: 'Search',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 300,
      readyState: 'complete',
    });

    const result = await navigateTool.execute({
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      background: true,
    });

    expect(result.isError).toBe(false);
    expect(chrome.windows.get).toHaveBeenCalledWith(9, { populate: false });
    expect(chrome.windows.getLastFocused).not.toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      windowId: 9,
      active: false,
    });
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      windowId: 9,
      targetWindowReason: 'same_site_existing_window',
      pageReadable: true,
    });
  });

  it('passes a bounded custom settle timeout to new-tab navigation waits', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    const waitForTabSettled = vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://example.com/search?q=browser',
        title: 'Search',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 9000,
      readyState: 'complete',
    });

    const result = await navigateTool.execute({
      url: 'https://example.com/search?q=browser',
      background: true,
      settleTimeoutMs: 90000,
    } as any);

    expect(result.isError).toBe(false);
    expect(waitForTabSettled).toHaveBeenCalledWith(20, { timeoutMs: 60000 });
  });

  it('allows structured reads when navigation is interactive with a document URL', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'loading',
        url: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
        title: 'Repository search results',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: 'interactive',
    });

    const result = await navigateTool.execute({
      url: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      finalUrl: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
      status: 'loading',
      settled: false,
      settleReason: 'timeout',
      waitedMs: 8000,
      readyState: 'interactive',
      pageReadable: false,
      canAttemptStructuredRead: true,
      nextStepHint: 'navigation_interactive; structured_read_may_succeed',
    });
  });

  it('treats an interactive document URL as settled before waiting for full load', async () => {
    vi.useFakeTimers();
    (chrome as any).scripting = {
      executeScript: vi
        .fn()
        .mockResolvedValue([{ result: 'interactive' } as chrome.scripting.InjectionResult<string>]),
    };
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: false,
      status: 'loading',
      url: 'https://example.com/search?q=browser',
      title: 'Loading',
    } as chrome.tabs.Tab);

    const result = await (navigateTool as any).waitForTabSettled(20);

    expect(result).toMatchObject({
      settled: true,
      timedOut: false,
      reason: 'interactive',
      readyState: 'interactive',
    });
    expect(chrome.tabs.onUpdated.addListener).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('marks timed out new-tab navigation as not readable before read_page', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'loading',
        url: '',
        title: '',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: null,
    });

    const result = await navigateTool.execute({
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      requestedUrl: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      status: 'loading',
      settled: false,
      settleReason: 'timeout',
      waitedMs: 8000,
      readyState: null,
      pageReadable: false,
      canAttemptStructuredRead: false,
      nextStepHint:
        'navigation_not_readable; avoid chrome_read_page until navigation reaches a document',
    });
  });

  it('allows structured reads when navigation reaches a document URL but readyState probing times out', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'loading',
        url: 'https://www.npmjs.com/search?q=playwright',
        title: 'Search | npm',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: null,
    });

    const result = await navigateTool.execute({
      url: 'https://www.npmjs.com/search?q=playwright',
      background: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      requestedUrl: 'https://www.npmjs.com/search?q=playwright',
      finalUrl: 'https://www.npmjs.com/search?q=playwright',
      status: 'loading',
      settled: false,
      settleReason: 'timeout',
      waitedMs: 8000,
      readyState: null,
      pageReadable: false,
      canAttemptStructuredRead: true,
      nextStepHint: 'navigation_document_url_detected; structured_read_may_succeed',
    });
  });

  it('uses pendingUrl for timed out new-tab navigation readiness guidance', async () => {
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'loading',
        url: '',
        pendingUrl: 'https://github.com/search?q=ACP&type=repositories',
        title: 'Repository search results',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: 'interactive',
    });

    const result = await navigateTool.execute({
      url: 'https://github.com/search?q=ACP&type=repositories',
      background: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      requestedUrl: 'https://github.com/search?q=ACP&type=repositories',
      finalUrl: 'https://github.com/search?q=ACP&type=repositories',
      status: 'loading',
      settled: false,
      settleReason: 'timeout',
      waitedMs: 8000,
      readyState: 'interactive',
      pageReadable: false,
      canAttemptStructuredRead: true,
      nextStepHint: 'navigation_interactive; structured_read_may_succeed',
    });
  });

  it('bounds new background tab creation timeout and cleans only newly-created blank tabs', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 11,
          windowId: 1,
          active: false,
          status: 'complete',
          url: 'about:blank',
          title: 'Existing Blank',
        } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([
        {
          id: 11,
          windowId: 1,
          active: false,
          status: 'complete',
          url: 'about:blank',
          title: 'Existing Blank',
        } as chrome.tabs.Tab,
        {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: '',
          title: '',
        } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([
        {
          id: 11,
          windowId: 1,
          active: false,
          status: 'complete',
          url: 'about:blank',
          title: 'Existing Blank',
        } as chrome.tabs.Tab,
        {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: '',
          title: '',
        } as chrome.tabs.Tab,
      ])
      .mockResolvedValueOnce([
        {
          id: 11,
          windowId: 1,
          active: false,
          status: 'complete',
          url: 'about:blank',
          title: 'Existing Blank',
        } as chrome.tabs.Tab,
        {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: '',
          title: '',
        } as chrome.tabs.Tab,
      ]);
    vi.mocked(chrome.tabs.create).mockImplementation(() => new Promise<chrome.tabs.Tab>(() => {}));
    vi.mocked(chrome.tabs.get).mockImplementation(async (tabId: number) => {
      if (tabId === 20) {
        return {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: '',
          title: '',
        } as chrome.tabs.Tab;
      }
      return {
        id: tabId,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'about:blank',
        title: 'Existing Blank',
      } as chrome.tabs.Tab;
    });

    const executePromise = navigateTool.execute({
      url: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      background: true,
    });
    await vi.advanceTimersByTimeAsync(5250);
    const result = await executePromise;

    expect(result.isError).toBe(true);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: false,
      message: 'Failed to create navigation tab within bounded timeout',
      requestedUrl: 'https://github.com/search?q=ACP&type=repositories&s=stars&o=desc',
      windowId: 1,
      cleanupTabIds: [20],
      pageReadable: false,
      canAttemptStructuredRead: false,
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(20);
    expect(chrome.tabs.remove).not.toHaveBeenCalledWith(11);
    vi.useRealTimers();
  });

  it('returns a readable tab when tab creation times out after the document tab appears', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.spyOn(navigateTool as any, 'waitForTabSettled');
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: 'https://nextjs.org/docs/app/getting-started/installation',
          title: 'Getting Started: Installation | Next.js',
        } as chrome.tabs.Tab,
      ]);
    vi.mocked(chrome.tabs.create).mockImplementation(() => new Promise<chrome.tabs.Tab>(() => {}));

    const executePromise = navigateTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    const result = await executePromise;

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      message: 'Opened URL in new tab after create timeout',
      tabId: 20,
      requestedUrl: 'https://nextjs.org/docs/app/getting-started/installation',
      finalUrl: 'https://nextjs.org/docs/app/getting-started/installation',
      status: 'loading',
      settled: false,
      settleReason: 'create_timeout_but_document_tab_found',
      readyState: 'interactive',
      pageReadable: false,
      canAttemptStructuredRead: true,
      nextStepHint: 'navigation_interactive; structured_read_may_succeed',
    });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('waits briefly for a pending URL tab after creation timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue(null);
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 21,
          windowId: 1,
          active: false,
          status: 'loading',
          url: '',
          pendingUrl: 'https://nextjs.org/docs/app/getting-started/installation',
          title: 'Getting Started: Installation | Next.js',
        } as chrome.tabs.Tab,
      ]);
    vi.mocked(chrome.tabs.create).mockImplementation(() => new Promise<chrome.tabs.Tab>(() => {}));

    const executePromise = navigateTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
    });
    await vi.advanceTimersByTimeAsync(5250);
    const result = await executePromise;

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 21,
      finalUrl: 'https://nextjs.org/docs/app/getting-started/installation',
      canAttemptStructuredRead: true,
    });
    vi.useRealTimers();
  });

  it('returns structured-read guidance after explicit tab navigation times out at interactive', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 10,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'https://github.com/example/project',
        title: 'example/project',
      } as chrome.tabs.Tab,
    ]);
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project',
      title: 'example/project',
    } as chrome.tabs.Tab);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 10,
        windowId: 1,
        active: true,
        status: 'loading',
        url: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
        title: 'Repository search results',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: 'interactive',
    });

    const result = await navigateTool.execute({
      tabId: 10,
      url: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      usedExistingTab: true,
      navigatedExplicitTab: true,
      finalUrl: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
      settled: false,
      readyState: 'interactive',
      pageReadable: false,
      canAttemptStructuredRead: true,
      nextStepHint: 'navigation_interactive; structured_read_may_succeed',
    });
  });

  it('blocks structured-read guidance when explicit navigation is still on the previous URL', async () => {
    vi.mocked(chrome.tabs.query).mockResolvedValue([
      {
        id: 10,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'https://github.com/example/project',
        title: 'example/project',
      } as chrome.tabs.Tab,
    ]);
    vi.spyOn(navigateTool as any, 'tryGetTab').mockResolvedValue({
      id: 10,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project',
      title: 'example/project',
    } as chrome.tabs.Tab);
    vi.spyOn(navigateTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 10,
        windowId: 1,
        active: true,
        status: 'loading',
        url: 'https://github.com/example/project',
        title: 'example/project',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 8000,
      readyState: 'complete',
    });

    const result = await navigateTool.execute({
      tabId: 10,
      url: 'https://github.com/search?type=repositories&q=ACP&s=stars&o=desc',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      finalUrl: 'https://github.com/example/project',
      settled: false,
      readyState: 'complete',
      pageReadable: false,
      canAttemptStructuredRead: false,
      nextStepHint:
        'navigation_not_readable; avoid chrome_read_page until navigation reaches a document',
    });
  });

  it('returns activation and settle metadata after switching to an incomplete tab', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 30,
      windowId: 2,
      active: false,
      status: 'loading',
      url: 'http://127.0.0.1:62100/page3',
      title: 'Page 3',
    } as chrome.tabs.Tab);
    vi.spyOn(switchTabTool as any, 'waitForTabActivated').mockResolvedValue({
      tab: {
        id: 30,
        windowId: 2,
        active: true,
        status: 'loading',
        url: 'http://127.0.0.1:62100/page3',
        title: 'Page 3',
      },
      activated: true,
      timedOut: false,
      waitedMs: 120,
      windowFocused: true,
    });
    vi.spyOn(switchTabTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 30,
        windowId: 2,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page3',
        title: 'Page 3',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 380,
      readyState: 'complete',
    });
    vi.spyOn(switchTabTool as any, 'waitForTabForegroundProof').mockResolvedValue({
      kind: 'tab_foreground_proof_v1',
      verdict: 'proven_foreground',
      tabId: 30,
      chromeWindowFocused: true,
      chromeTabActive: true,
      documentVisibilityState: 'visible',
      documentHasFocus: true,
      documentHidden: false,
      waitedMs: 40,
      timedOut: false,
      reason: 'document is visible and focused after tab/window activation',
    });

    const result = await switchTabTool.execute({ tabId: 30 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      activated: true,
      activationTimedOut: false,
      activationWaitedMs: 120,
      foregroundActivationVerdict: 'proven_foreground',
      documentVisibilityState: 'visible',
      documentHasFocus: true,
      settled: true,
      settleReason: 'complete',
      settleWaitedMs: 380,
      readyState: 'complete',
    });
    expect(payload.foregroundActivation).toMatchObject({
      kind: 'tab_foreground_proof_v1',
      verdict: 'proven_foreground',
      tabId: 30,
      chromeWindowFocused: true,
      chromeTabActive: true,
      documentVisibilityState: 'visible',
      documentHasFocus: true,
    });
  });

  it('surfaces when Chrome activation is not enough to prove page foreground focus', async () => {
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 31,
      windowId: 2,
      active: false,
      status: 'complete',
      url: 'http://127.0.0.1:62100/page4',
      title: 'Page 4',
    } as chrome.tabs.Tab);
    vi.spyOn(switchTabTool as any, 'waitForTabActivated').mockResolvedValue({
      tab: {
        id: 31,
        windowId: 2,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page4',
        title: 'Page 4',
      },
      activated: true,
      timedOut: false,
      waitedMs: 100,
      windowFocused: true,
    });
    vi.spyOn(switchTabTool as any, 'waitForTabForegroundProof').mockResolvedValue({
      kind: 'tab_foreground_proof_v1',
      verdict: 'needs_os_foreground_activation',
      tabId: 31,
      chromeWindowFocused: true,
      chromeTabActive: true,
      documentVisibilityState: 'visible',
      documentHasFocus: false,
      documentHidden: false,
      waitedMs: 1500,
      timedOut: true,
      reason: 'Chrome reports the tab/window active, but the page document is not focused',
    });

    const result = await switchTabTool.execute({ tabId: 31 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      activated: true,
      windowFocused: true,
      foregroundActivationVerdict: 'needs_os_foreground_activation',
      documentVisibilityState: 'visible',
      documentHasFocus: false,
      settled: true,
      settleReason: 'already_complete',
    });
  });

  it('waits for a new tab to settle before extracting visible text', async () => {
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: true,
        status: 'complete',
        url: 'http://127.0.0.1:62100/page2',
        title: 'Settled Page',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Line one describes the feature in detail.\nLine two explains the safe path for browser automation.\nLine three confirms the page is stable and ready for structured extraction.\nLine four adds enough visible text to move this sample beyond sparse mode.',
      metadata: { lang: 'en' },
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'http://127.0.0.1:62100/page2',
      title: 'Settled Page',
    } as chrome.tabs.Tab);

    const result = await webFetcherTool.execute({
      url: 'http://127.0.0.1:62100/page2',
    });

    expect((webFetcherTool as any).waitForTabSettled).toHaveBeenCalledWith(20, {
      timeoutMs: 30000,
    });
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 20,
      createdTabForUrl: true,
      url: 'http://127.0.0.1:62100/page2',
      title: 'Settled Page',
      settle: {
        settled: true,
        timedOut: false,
        reason: 'complete',
      },
      textContentRequest: {
        attempts: 1,
        timedOutBeforeRetry: false,
      },
    });
    expect(payload.textSummary).toMatchObject({
      quality: 'usable',
      sparse: false,
    });
  });

  it('honors a bounded custom settle timeout before extracting web content', async () => {
    const waitForTabSettled = vi
      .spyOn(webFetcherTool as any, 'waitForTabSettled')
      .mockResolvedValue({
        tab: {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: 'https://nextjs.org/docs/app/getting-started/installation',
          title: 'Getting Started: Installation | Next.js',
        },
        settled: false,
        timedOut: true,
        reason: 'timeout',
        waitedMs: 1000,
        readyState: 'interactive',
      });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Manual installation\nSystem requirements\nRun the development server\nCreate the app directory',
      textMode: 'body',
      textContentSource: 'readability_body_text',
      metadata: { lang: 'en' },
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: false,
      status: 'loading',
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      title: 'Getting Started: Installation | Next.js',
    } as chrome.tabs.Tab);

    const result = await webFetcherTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
      settleTimeoutMs: 90000,
    } as any);

    expect(waitForTabSettled).toHaveBeenCalledWith(20, { timeoutMs: 60000 });
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.settle).toMatchObject({
      timedOut: true,
      reason: 'timeout',
      readyState: 'interactive',
    });
    expect(payload.textContent).toContain('Manual installation');
  });

  it('does not hang when document readyState probing never resolves', async () => {
    const originalScripting = chrome.scripting;
    try {
      vi.mocked(chrome.tabs.get).mockResolvedValue({
        id: 20,
        windowId: 1,
        active: false,
        status: 'loading',
        url: 'https://nextjs.org/docs/app/getting-started/installation',
        title: 'Loading',
      } as chrome.tabs.Tab);
      (chrome as any).scripting = {
        executeScript: vi.fn().mockImplementation(() => new Promise(() => {})),
      };

      const result = await (webFetcherTool as any).waitForTabSettled(20, { timeoutMs: 1 });

      expect(result).toMatchObject({
        settled: false,
        timedOut: true,
        reason: 'timeout',
        readyState: null,
      });
    } finally {
      (chrome as any).scripting = originalScripting;
    }
  });

  it('retries visible text extraction when the first content request hangs', async () => {
    vi.useFakeTimers();
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://nextjs.org/docs/app/getting-started/installation',
        title: 'Getting Started: Installation | Next.js',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    const injectContentScript = vi
      .spyOn(webFetcherTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendMessageToTab = vi
      .spyOn(webFetcherTool as any, 'sendMessageToTab')
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValueOnce({
        success: true,
        textContent:
          'Manual installation. Create a new Next.js app. Terminal examples and package manager options are visible in the page body. This text proves the real document body can be extracted after a bounded retry.',
        article: {
          title: 'Getting Started: Installation',
          byline: 'Vercel',
          siteName: 'Next.js',
          excerpt: '',
        },
      });

    const executePromise = webFetcherTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
      textContent: true,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await executePromise;

    expect(result.isError).toBe(false);
    expect(injectContentScript).toHaveBeenCalledTimes(2);
    expect(sendMessageToTab).toHaveBeenCalledTimes(2);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 20,
      createdTabForUrl: true,
      textContentRequest: {
        attempts: 2,
        timedOutBeforeRetry: true,
      },
      article: {
        title: 'Getting Started: Installation',
        byline: 'Vercel',
      },
    });
    expect(payload.textContent).toContain('Manual installation');
    vi.useRealTimers();
  });

  it('retries empty visible text from a newly created dynamic page before reporting success', async () => {
    vi.useFakeTimers();
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://chat.deepseek.com/share/example',
        title: 'DeepSeek - 探索未至之境',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendMessageToTab = vi
      .spyOn(webFetcherTool as any, 'sendMessageToTab')
      .mockResolvedValueOnce({
        success: true,
        textContent: '',
        textMode: 'full-visible',
        textContentSource: 'document_body_innerText',
      })
      .mockResolvedValueOnce({
        success: true,
        textContent: '物模型包含静态属性、时序属性和可控调节属性。延迟渲染后的分享页正文已经可见。',
        textMode: 'full-visible',
        textContentSource: 'document_body_innerText',
      });

    const executePromise = webFetcherTool.execute({
      url: 'https://chat.deepseek.com/share/example',
      background: true,
      textMode: 'full-visible',
    });

    await vi.advanceTimersByTimeAsync(1_000);
    const result = await executePromise;

    expect(result.isError).toBe(false);
    expect(sendMessageToTab).toHaveBeenCalledTimes(2);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      createdTabForUrl: true,
      textContentRequest: {
        attempts: 2,
        emptyContentRetries: 1,
      },
      textMode: 'full-visible',
      textContentSource: 'document_body_innerText',
    });
    expect(payload.textContent).toContain('可控调节属性');
    vi.useRealTimers();
  });

  it('recovers a readable web content tab when tab creation times out after the document appears', async () => {
    vi.useFakeTimers();
    vi.mocked(chrome.tabs.query)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 20,
          windowId: 1,
          active: false,
          status: 'loading',
          url: 'https://nextjs.org/docs/app/getting-started/installation',
          pendingUrl: undefined,
          title: 'Getting Started: Installation | Next.js',
        } as chrome.tabs.Tab,
      ]);
    vi.mocked(chrome.tabs.create).mockImplementation(() => new Promise<chrome.tabs.Tab>(() => {}));
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://nextjs.org/docs/app/getting-started/installation',
        title: 'Getting Started: Installation | Next.js',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Next.js installation docs are visible after recovering the tab created by Chrome even though tabs.create did not resolve in time.',
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: false,
      status: 'complete',
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      title: 'Getting Started: Installation | Next.js',
    } as chrome.tabs.Tab);

    const executePromise = webFetcherTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
      textContent: true,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(250);
    const result = await executePromise;

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 20,
      createdTabForUrl: true,
      createTimedOutRecovered: true,
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      title: 'Getting Started: Installation | Next.js',
    });
    expect(payload.textContent).toContain('recovering the tab');
    vi.useRealTimers();
  });

  it('does not treat long single-line article text as incomplete sparse content', async () => {
    const articleText = [
      'If Codex does not feel useful yet, the missing piece is often the browser and skill context around it.',
      'This article walks through five concrete tools, explains when each one matters, and includes enough detail for a reader to recover the full list without opening another page.',
      'The body is intentionally normalized into one visible text line because many article pages collapse readable content that way after extraction.',
      'A quality model should still tell the assistant that the text body is available, while separately warning that UI structure and target refs require chrome_read_page.',
      'awesome-codex-skills, repomix, follow-builders, codex-plusplus, and keep-codex-fast are all present in the extracted text body.',
    ].join(' ');

    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://example.com/article',
        title: 'Long Article',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent: articleText,
      article: { title: 'Long Article', byline: 'Author', siteName: 'Example', excerpt: '' },
    });

    const result = await webFetcherTool.execute({
      url: 'https://example.com/article',
      background: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.textSummary).toMatchObject({
      quality: 'complete_text_sparse_structure',
      sparse: false,
      structureSparse: true,
      contentSparse: false,
      completeTextAvailable: true,
    });
    expect(payload.extractionHint).toContain('structurally sparse');
    expect(payload.extractionHint).not.toContain('higher-risk tools');
  });

  it('labels full-visible web content mode without changing the default body mode', async () => {
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://nextjs.org/docs/app/getting-started/installation',
        title: 'Getting Started: Installation | Next.js',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendMessageToTab = vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Docs API Reference Version 16 Installation Manual installation and system requirements are visible.',
      textMode: 'full-visible',
      textContentSource: 'document_body_innerText',
      metadata: { lang: 'en' },
    });

    const result = await webFetcherTool.execute({
      url: 'https://nextjs.org/docs/app/getting-started/installation',
      background: true,
      textMode: 'full-visible',
    });

    expect(sendMessageToTab).toHaveBeenCalledWith(
      20,
      expect.objectContaining({
        action: 'getTextContent',
        textMode: 'full-visible',
      }),
    );
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      textMode: 'full-visible',
      textContentSource: 'document_body_innerText',
    });
    expect(payload.textContent).toContain('API Reference');
  });

  it('does not call medium single-line text complete when structure is sparse', async () => {
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://chat.deepseek.com/share/example',
        title: 'DeepSeek',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: false,
      status: 'loading',
      url: 'https://chat.deepseek.com/share/example',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      textContent:
        'Shared conversation prompt text is visible, but the generated answer body is not present in the current DOM.',
      contentDiagnostics: {
        extractedLength: 98,
        scrollContainerCandidateCount: 1,
        bestScrollableTextLength: 900,
        longScrollableContentLikely: true,
        scrollContainers: [
          {
            tagName: 'TEXTAREA',
            className: 'conversation-scroll-area',
            scrollTop: 0,
            scrollHeight: 1600,
            clientHeight: 320,
            textLength: 900,
            textPreview: null,
            textPreviewRedacted: true,
          },
        ],
      },
      metadata: { lang: 'en' },
    });

    const result = await webFetcherTool.execute({
      url: 'https://chat.deepseek.com/share/example',
      background: true,
      textContent: true,
    });

    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.textSummary).toMatchObject({
      quality: 'sparse',
      sparse: true,
      structureSparse: true,
      contentSparse: false,
      completeTextAvailable: false,
      warning:
        'Visible text has limited structure and may be incomplete. Prefer chrome_read_page or htmlContent when completeness matters.',
    });
    expect(payload.extractionHint).toBe(
      'Visible text has limited structure and may be incomplete for this route. Use chrome_read_page or htmlContent when completeness matters.',
    );
    expect(payload.extractionHint).not.toContain('appears complete');
    expect(payload.contentDiagnostics).toMatchObject({
      scrollContainerCandidateCount: 1,
      longScrollableContentLikely: true,
    });
  });

  it('returns plain text evidence when htmlContent is requested', async () => {
    vi.spyOn(webFetcherTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 20,
        windowId: 1,
        active: false,
        status: 'complete',
        url: 'https://chat.deepseek.com/share/example',
        title: 'DeepSeek',
      },
      settled: true,
      timedOut: false,
      reason: 'complete',
      waitedMs: 200,
      readyState: 'complete',
    });
    vi.mocked(chrome.tabs.create).mockResolvedValue({
      id: 20,
      windowId: 1,
      active: false,
      status: 'loading',
      url: 'https://chat.deepseek.com/share/example',
      title: 'Loading',
    } as chrome.tabs.Tab);
    vi.spyOn(webFetcherTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(webFetcherTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      htmlContent:
        '<html><body><main>物模型 静态属性 时序属性 可控调节属性 服务/动作</main></body></html>',
      htmlTextContent:
        '物模型 静态属性 时序属性 可控调节属性 服务/动作。这个 HTML 派生文本比可见文本路径更完整，用于长内容完整度证据。',
      htmlTextContentSource: 'cleaned_html_textContent',
    });

    const result = await webFetcherTool.execute({
      url: 'https://chat.deepseek.com/share/example',
      background: true,
      htmlContent: true,
    });

    expect(result.isError).toBe(false);
    expect((webFetcherTool as any).sendMessageToTab).toHaveBeenCalledTimes(1);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.htmlContent).toContain('物模型');
    expect(payload.htmlTextContent).toContain('可控调节属性');
    expect(payload.htmlTextContentSource).toBe('cleaned_html_textContent');
    expect(payload.htmlTextSummary).toMatchObject({
      quality: 'sparse',
      completeTextAvailable: false,
    });
  });

  it('returns compact structured snapshot from read_page', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 41,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'http://127.0.0.1:62100/',
      title: 'Smoke',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows.getAll as any).mockResolvedValueOnce([
      {
        id: 1,
        focused: true,
        state: 'normal',
        type: 'normal',
        tabs: [
          {
            id: 41,
            windowId: 1,
            active: true,
            status: 'complete',
            url: 'http://127.0.0.1:62100/',
            title: 'Smoke',
          },
        ],
      },
    ]);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent:
        'Button "Continue"\nTextbox "Search"\nLink "Docs"\nStatus "Ready"\nHint "Use refs first"\nBanner "Safe automation starts with structured reads"\nPanel "Use read_page and interactive refs before screenshots or coordinate fallbacks"\nSection "Confirm the page has settled before using visual fallbacks"\nChecklist "Prefer refs, then screenshots, then higher-risk tools"\nFooter "End of stable content"',
      refMap: ['ref_1', 'ref_2', 'ref_3'],
      stats: {
        processed: 20,
        included: 6,
        durationMs: 12,
      },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ filter: 'interactive', depth: 3 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.mode).toBe('compact');
    expect(payload.summary).toMatchObject({
      quality: 'usable',
    });
    expect(payload.page).toMatchObject({
      pageType: 'web_page',
    });
    expect(payload.pageProjection).toMatchObject({
      ownerType: 'user_owned',
    });
    expect(payload.pageContext.loadReadiness).toMatchObject({
      status: 'stable',
      pageStability: 'stable',
      waitedForPendingDocument: false,
      canUseSnapshotForBusinessAction: true,
      nextStepHint: 'safe_to_use_structured_refs_with_postcondition_verification',
    });
    expect(payload.ownershipRuntime).toMatchObject({
      currentOwnerType: 'user_owned',
    });
    expect(Array.isArray(payload.interactiveElements)).toBe(true);
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(Array.isArray(payload.artifactRefs)).toBe(true);
  });

  it('exposes provisional read_page load evidence when a target tab is still loading after wait', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 43,
      windowId: 1,
      active: true,
      status: 'loading',
      url: 'http://127.0.0.1:62100/loading',
      title: 'Loading',
    });
    vi.spyOn(readPageTool as any, 'waitForTabSettled').mockResolvedValue({
      tab: {
        id: 43,
        windowId: 1,
        active: true,
        status: 'loading',
        url: 'http://127.0.0.1:62100/loading',
        title: 'Loading',
      },
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 5000,
      readyState: 'interactive',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    (chrome.windows.get as any).mockResolvedValue({
      id: 1,
      focused: true,
      state: 'normal',
      tabs: [
        {
          id: 43,
          windowId: 1,
          active: true,
          status: 'loading',
          url: 'http://127.0.0.1:62100/loading',
          title: 'Loading',
        },
      ],
    });
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: [
        'generic "Loading shell one"',
        'generic "Loading shell two"',
        'generic "Loading shell three"',
        'generic "Loading shell four"',
        'generic "Loading shell five"',
        'generic "Loading shell six"',
        'generic "Loading shell seven"',
        'generic "Loading shell eight"',
        'generic "Loading shell nine"',
        'generic "Loading shell ten"',
      ].join('\n'),
      refMap: ['ref_1', 'ref_2', 'ref_3'],
      stats: {
        processed: 10,
        included: 10,
        durationMs: 16,
      },
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const result = await readPageTool.execute({ tabId: 43, mode: 'normal' });

    expect((readPageTool as any).waitForTabSettled).toHaveBeenCalledWith(43, {
      timeoutMs: 5000,
    });
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.readinessVerdict).toBe('blocked');
    expect(payload.readinessReason).toBe('page_load_not_stable');
    expect(payload.pageProjection).toMatchObject({
      stability: 'loading',
    });
    expect(payload.pageContext.loadReadiness).toMatchObject({
      status: 'loading_after_wait',
      pageStability: 'loading',
      initialTabStatus: 'loading',
      finalTabStatus: 'loading',
      waitedForPendingDocument: true,
      settled: false,
      timedOut: true,
      settleReason: 'timeout',
      waitedMs: 5000,
      readyState: 'interactive',
      canUseSnapshotForBusinessAction: false,
      nextStepHint: 'wait_then_force_fresh_read_page_before_business_actions',
    });
    expect(payload.pageContext.loadReadiness.claimBoundary).toContain(
      'candidate objects as provisional',
    );
  });

  it('classifies github issues_list pages in read_page metadata (public baseline)', async () => {
    vi.spyOn(readPageTool as any, 'tryGetTab').mockResolvedValue({
      id: 42,
      windowId: 1,
      active: true,
      status: 'complete',
      url: 'https://github.com/example/project/issues',
      title: 'Issues · example/project',
    });
    vi.spyOn(readPageTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(readPageTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      pageContent: 'Search Issues\nFilter by assignee\nLabels\nMilestone\nNew issue\nissue entries',
      refMap: ['ref_10', 'ref_11', 'ref_12'],
      stats: {
        processed: 18,
        included: 8,
        durationMs: 14,
      },
      viewport: { width: 1440, height: 900, dpr: 1 },
    });

    const result = await readPageTool.execute({ mode: 'normal' });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload.page).toMatchObject({
      pageType: 'web_page',
    });
    expect(payload.pageContext).toMatchObject({
      scheme: 'https',
    });
    expect(payload.summary).toMatchObject({
      pageRole: 'issues_list',
      primaryRegion: 'issues_results',
      primaryRegionConfidence: 'high',
      footerOnly: false,
    });
  });
});
