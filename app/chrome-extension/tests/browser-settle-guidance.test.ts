import { beforeEach, describe, expect, it, vi } from 'vitest';
import { navigateTool, switchTabTool } from '@/entrypoints/background/tools/browser/common';
import { webFetcherTool } from '@/entrypoints/background/tools/browser/web-fetcher';
import { readPageTool } from '@/entrypoints/background/tools/browser/read-page';

describe('browser settle guidance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    await vi.advanceTimersByTimeAsync(5000);
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

    const result = await switchTabTool.execute({ tabId: 30 });

    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      activated: true,
      activationTimedOut: false,
      activationWaitedMs: 120,
      settled: true,
      settleReason: 'complete',
      settleWaitedMs: 380,
      readyState: 'complete',
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

    const result = await webFetcherTool.execute({
      url: 'http://127.0.0.1:62100/page2',
    });

    expect((webFetcherTool as any).waitForTabSettled).toHaveBeenCalledWith(20);
    expect(result.isError).toBe(false);
    const payload = JSON.parse((result.content[0] as { text: string }).text);
    expect(payload).toMatchObject({
      success: true,
      url: 'http://127.0.0.1:62100/page2',
      title: 'Settled Page',
    });
    expect(payload.textSummary).toMatchObject({
      quality: 'usable',
      sparse: false,
    });
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
    expect(Array.isArray(payload.interactiveElements)).toBe(true);
    expect(Array.isArray(payload.candidateActions)).toBe(true);
    expect(Array.isArray(payload.artifactRefs)).toBe(true);
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
