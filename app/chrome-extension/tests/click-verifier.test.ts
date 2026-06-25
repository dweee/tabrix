// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLICK_VERIFIER_READBACK_MAX_MS,
  CLICK_VERIFIER_SETTLE_DELAY_MS,
  evaluateClickVerifier,
  isVerifierContextActive,
  isVerifierContextRequested,
  runClickVerifier,
  waitForPostClickReadbackReady,
} from '@/entrypoints/background/tools/browser/click-verifier';
import {
  clickTool,
  NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS,
} from '@/entrypoints/background/tools/browser/interaction';

describe('isVerifierContextRequested', () => {
  it('returns false when context is missing or key is empty', () => {
    expect(isVerifierContextRequested(undefined)).toBe(false);
    expect(isVerifierContextRequested(null)).toBe(false);
    expect(isVerifierContextRequested({})).toBe(false);
    expect(isVerifierContextRequested({ verifierKey: '' })).toBe(false);
  });

  it('returns true for any non-empty verifier key', () => {
    expect(isVerifierContextRequested({ verifierKey: 'site.nav.details' })).toBe(true);
  });
});

describe('isVerifierContextActive', () => {
  it('does not activate verifier contexts without an explicit generic verifier registry', () => {
    expect(isVerifierContextActive(undefined)).toBe(false);
    expect(isVerifierContextActive(null)).toBe(false);
    expect(isVerifierContextActive({})).toBe(false);
    expect(isVerifierContextActive({ verifierKey: '' })).toBe(false);
    expect(isVerifierContextActive({ verifierKey: 'site.nav.details' })).toBe(false);
  });
});

describe('evaluateClickVerifier', () => {
  it('fails closed for unknown verifier keys without applying site-specific logic', () => {
    const result = evaluateClickVerifier(
      { verifierKey: 'site.nav.details' },
      'https://example.test/list',
      {
        url: 'https://example.test/detail/123',
        title: 'Detail',
        bodyText: 'Detail page content',
      },
    );
    expect(result).toEqual({
      passed: false,
      reason: 'verifier_key_unknown:site.nav.details',
      beforeUrl: 'https://example.test/list',
      afterUrl: 'https://example.test/detail/123',
      pageRoleAfter: null,
    });
  });

  it('keeps the public postClickState field shape stable', () => {
    const result = evaluateClickVerifier(
      { verifierKey: 'site.nav.details' },
      'https://example.test/list',
      {
        url: 'https://example.test/detail/123',
        title: 'Detail',
        bodyText: 'Detail page content',
      },
    );
    expect(Object.keys(result).sort()).toEqual(
      ['passed', 'reason', 'beforeUrl', 'afterUrl', 'pageRoleAfter'].sort(),
    );
  });
});

describe('runClickVerifier', () => {
  const mockChrome = globalThis.chrome as unknown as {
    tabs: { get: ReturnType<typeof vi.fn> };
    scripting?: { executeScript: ReturnType<typeof vi.fn> };
  };
  let updatedListeners: Array<
    (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void
  > = [];

  beforeEach(() => {
    vi.useFakeTimers();
    updatedListeners = [];
    chrome.tabs.onUpdated.addListener = vi.fn((listener) => {
      updatedListeners.push(listener as (typeof updatedListeners)[number]);
    }) as any;
    chrome.tabs.onUpdated.removeListener = vi.fn((listener) => {
      updatedListeners = updatedListeners.filter((entry) => entry !== listener);
    }) as any;
    mockChrome.scripting = {
      executeScript: vi.fn(),
    };
  });

  it('returns null when no verifier context is requested', async () => {
    const promise = runClickVerifier(1, {}, 'https://example.test/list');
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBeNull();
    expect(mockChrome.tabs.get).not.toHaveBeenCalled();
    expect(mockChrome.scripting!.executeScript).not.toHaveBeenCalled();
  });

  it('does not treat an initial complete tab with an unchanged URL as ready', async () => {
    const unchangedComplete = {
      id: 1,
      url: 'https://example.test/list',
      title: 'List',
      status: 'complete',
    } as chrome.tabs.Tab;
    mockChrome.tabs.get
      .mockResolvedValueOnce(unchangedComplete)
      .mockResolvedValueOnce(unchangedComplete);

    const promise = waitForPostClickReadbackReady(1, 'https://example.test/list', {
      maxMs: 250,
    });
    await Promise.resolve();

    expect(updatedListeners).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toMatchObject({
      reason: 'timeout',
      tab: unchangedComplete,
    });
  });

  it('returns tab_complete only after an onUpdated complete event', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://example.test/list',
      title: 'List',
      status: 'complete',
    } as chrome.tabs.Tab);

    const promise = waitForPostClickReadbackReady(1, 'https://example.test/list', {
      maxMs: 250,
    });
    await Promise.resolve();
    expect(updatedListeners).toHaveLength(1);

    updatedListeners[0]!(1, { status: 'complete' }, {
      id: 1,
      url: 'https://example.test/list',
      title: 'List',
      status: 'complete',
    } as chrome.tabs.Tab);

    await expect(promise).resolves.toMatchObject({ reason: 'tab_complete' });
  });

  it('returns url_changed immediately when the initial tab URL differs', async () => {
    mockChrome.tabs.get.mockResolvedValueOnce({
      id: 1,
      url: 'https://example.test/detail/123',
      title: 'Detail',
      status: 'complete',
    } as chrome.tabs.Tab);

    const readiness = await waitForPostClickReadbackReady(1, 'https://example.test/list', {
      maxMs: 250,
    });

    expect(readiness.reason).toBe('url_changed');
    expect(readiness.waitedMs).toBeLessThan(250);
    expect(chrome.tabs.onUpdated.addListener).not.toHaveBeenCalled();
  });

  it('uses the max cap only when no observable tab condition appears', async () => {
    const loadingTab = {
      id: 1,
      url: 'https://example.test/list',
      title: 'List',
      status: 'loading',
    } as chrome.tabs.Tab;
    mockChrome.tabs.get.mockResolvedValueOnce(loadingTab).mockResolvedValueOnce(loadingTab);

    const promise = waitForPostClickReadbackReady(1, 'https://example.test/list', {
      maxMs: 250,
    });
    await Promise.resolve();
    expect(updatedListeners).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toMatchObject({ reason: 'timeout', tab: loadingTab });
    expect(chrome.tabs.onUpdated.removeListener).toHaveBeenCalledTimes(1);
  });
});

describe('clickTool integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('emits lane="tabrix_owned" on the click response', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4106,
      title: 'List',
      url: 'https://example.test/list',
      windowId: 7,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      dispatchSucceeded: true,
      elementInfo: { tagName: 'A' },
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://example.test/list',
        urlAfter: 'https://example.test/list',
        hashBefore: '',
        hashAfter: '',
        domChanged: true,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });

    const result = await clickTool.execute({
      tabId: 4106,
      selector: '#some-button',
    } as any);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.lane).toBe('tabrix_owned');
  });

  it('emits clickDiff=no_change when no click facts changed', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4107,
      title: 'List',
      url: 'https://example.test/list',
      windowId: 7,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      dispatchSucceeded: true,
      elementInfo: { tagName: 'BUTTON' },
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://example.test/list',
        urlAfter: 'https://example.test/list',
        hashBefore: '',
        hashAfter: '',
        domChanged: false,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });

    const result = await clickTool.execute({
      tabId: 4107,
      selector: '#noop',
    } as any);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.clickDiff).toEqual({ kind: 'no_change' });
  });

  it('emits clickDiff=change with facts-only signal deltas', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4108,
      title: 'List',
      url: 'https://example.test/list',
      windowId: 7,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      dispatchSucceeded: true,
      elementInfo: { tagName: 'A' },
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://example.test/list',
        urlAfter: 'https://example.test/detail/123',
        hashBefore: '',
        hashAfter: '',
        domChanged: false,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });

    const result = await clickTool.execute({
      tabId: 4108,
      selector: '#details-link',
    } as any);
    const payload = JSON.parse((result.content[0] as { text: string }).text);

    expect(result.isError).toBe(false);
    expect(payload.clickDiff).toEqual({
      kind: 'change',
      urlDelta: 'same_origin',
      hashChanged: false,
      newTabOpened: false,
      beforeUnloadFired: false,
      domChanged: false,
      dialogAdded: false,
      menuAdded: false,
      focusChanged: false,
      stateChanged: false,
    });
  });
});

describe('verifier timing contract', () => {
  it('NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS covers the verifier settle delay', () => {
    expect(NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS).toBeGreaterThanOrEqual(
      CLICK_VERIFIER_SETTLE_DELAY_MS,
    );
  });

  it('CLICK_VERIFIER_SETTLE_DELAY_MS is a positive number', () => {
    expect(typeof CLICK_VERIFIER_SETTLE_DELAY_MS).toBe('number');
    expect(CLICK_VERIFIER_SETTLE_DELAY_MS).toBeGreaterThan(0);
  });

  it('CLICK_VERIFIER_SETTLE_DELAY_MS covers the action-outcome settle window', () => {
    expect(CLICK_VERIFIER_SETTLE_DELAY_MS).toBeGreaterThanOrEqual(1500);
  });

  it('CLICK_VERIFIER_READBACK_MAX_MS remains bounded', () => {
    expect(CLICK_VERIFIER_READBACK_MAX_MS).toBeGreaterThanOrEqual(CLICK_VERIFIER_SETTLE_DELAY_MS);
  });
});
