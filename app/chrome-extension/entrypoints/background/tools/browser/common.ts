import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { captureFrameOnAction, isAutoCaptureActive } from './gif-auto-capture';
import {
  markBrowserWorldTabAiCreated,
  markBrowserWorldTabAiOperated,
} from '../../browser-world-inventory';
import { preflightCloseTabs, type CloseTabsPreflightEvidence } from './close-tabs-preflight';
import { recordPendingActionBinding } from './read-page-object-delta';

// Default window dimensions
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;
const NAVIGATE_CREATE_TAB_TIMEOUT_MS = 5000;

interface NavigateToolParams {
  url?: string;
  newWindow?: boolean;
  width?: number;
  height?: number;
  refresh?: boolean;
  tabId?: number;
  windowId?: number;
  background?: boolean; // when true, do not activate tab or focus window
  settleTimeoutMs?: number;
}

type NavigationActionKind =
  | 'navigate'
  | 'navigate_existing_tab'
  | 'activate_existing_tab'
  | 'navigate_new_tab'
  | 'navigate_new_window_tab'
  | 'navigate_fallback_window_tab'
  | 'refresh'
  | 'history';

type NavigationUrlDelta = 'none' | 'hash_only' | 'same_origin' | 'cross_origin' | 'unavailable';

type NavigationPostActionDelta = {
  deltaKind: 'post_action_tool_delta';
  actionId: string | null;
  actionKind: NavigationActionKind;
  tabId: number | null;
  targetRef: null;
  observedOutcome: string | null;
  changed: boolean;
  changedSignals: string[];
  urlDelta: NavigationUrlDelta | null;
  hashChanged: boolean | null;
  beforeUnloadFired: null;
  readbackStatus: string | null;
  recommendation: string | null;
  businessSuccessProven: false;
  claimBoundary: string[];
};

function createNavigationActionId(actionKind: NavigationActionKind, tabId?: number | null): string {
  return `navigate-${actionKind}-${tabId ?? 'unknown'}-${Date.now()}`;
}

function recordNavigationPendingAction(tabId: number | null | undefined, actionId: string): void {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
  recordPendingActionBinding(tabId, {
    actionId,
    targetObjectId: null,
    targetRef: null,
  });
}

function classifyNavigationUrlDelta(
  previousUrl?: string | null,
  finalUrl?: string | null,
): NavigationUrlDelta {
  if (!previousUrl || !finalUrl) return 'unavailable';
  if (previousUrl === finalUrl) return 'none';
  try {
    const previous = new URL(previousUrl);
    const final = new URL(finalUrl);
    const previousWithoutHash = `${previous.origin}${previous.pathname}${previous.search}`;
    const finalWithoutHash = `${final.origin}${final.pathname}${final.search}`;
    if (previousWithoutHash === finalWithoutHash && previous.hash !== final.hash) {
      return 'hash_only';
    }
    return previous.origin === final.origin ? 'same_origin' : 'cross_origin';
  } catch {
    return normalizeComparableUrl(previousUrl) === normalizeComparableUrl(finalUrl)
      ? 'none'
      : 'unavailable';
  }
}

export function buildNavigationPostActionDelta(input: {
  actionId?: string | null;
  actionKind: NavigationActionKind;
  tabId?: number | null;
  previousUrl?: string | null;
  finalUrl?: string | null;
  newTabOpened?: boolean;
  settled?: boolean | null;
  readbackStatus?: string | null;
}): NavigationPostActionDelta {
  const urlDelta = classifyNavigationUrlDelta(input.previousUrl, input.finalUrl);
  const changedSignals = [
    input.newTabOpened ? 'new_tab_opened' : null,
    input.actionKind === 'activate_existing_tab' ? 'tab_activated' : null,
    input.actionKind === 'refresh' ? 'page_reloaded' : null,
    input.actionKind === 'history' ? 'history_navigation' : null,
    urlDelta !== 'none' && urlDelta !== 'unavailable' ? 'url_changed' : null,
    urlDelta === 'hash_only' ? 'hash_changed' : null,
    input.settled === false ? 'navigation_unsettled' : null,
  ].filter((entry): entry is string => Boolean(entry));
  const uniqueChangedSignals = [...new Set(changedSignals)];
  const observedOutcome =
    input.newTabOpened === true
      ? 'new_tab_opened'
      : input.actionKind === 'activate_existing_tab'
        ? 'activated_existing_tab'
        : input.actionKind === 'refresh'
          ? 'page_reloaded'
          : input.settled === false
            ? 'navigation_unsettled'
            : urlDelta !== 'none' && urlDelta !== 'unavailable'
              ? 'url_changed'
              : 'navigation_completed';

  return {
    deltaKind: 'post_action_tool_delta',
    actionId: input.actionId ?? null,
    actionKind: input.actionKind,
    tabId: input.tabId ?? null,
    targetRef: null,
    observedOutcome,
    changed: uniqueChangedSignals.length > 0,
    changedSignals: uniqueChangedSignals,
    urlDelta,
    hashChanged: urlDelta === 'hash_only',
    beforeUnloadFired: null,
    readbackStatus:
      input.readbackStatus ??
      (input.settled === false ? 'navigation_unsettled' : 'fresh_read_required'),
    recommendation:
      input.settled === false
        ? 'wait_or_run_chrome_read_page_force_refresh_when_document_is_reachable'
        : 'run_chrome_read_page_force_refresh_same_tab',
    businessSuccessProven: false,
    claimBoundary: [
      'This is browser-observed navigation evidence, not AI business evaluation.',
      'No site-specific interpretation or coordinate knowledge is included.',
      'Historical targets must be revalidated by a fresh page read before reuse.',
    ],
  };
}

function buildNavigationReadinessFields(input: {
  settled?: boolean;
  readyState?: string | null;
  finalUrl?: string | null;
  previousUrl?: string | null;
  status?: string | null;
}) {
  const finalUrl = input.finalUrl || '';
  const hasDocumentUrl = finalUrl.length > 0 && finalUrl !== 'about:blank';
  const previousUrl = input.previousUrl || '';
  const staleAfterAttempt =
    previousUrl.length > 0 &&
    normalizeComparableUrl(previousUrl) === normalizeComparableUrl(finalUrl);
  const hasReachedTargetDocument = hasDocumentUrl && !staleAfterAttempt;
  const hasReadableReadyState =
    input.readyState === 'interactive' || input.readyState === 'complete';
  const hasDocumentUrlWithUnknownReadyState = hasReachedTargetDocument && input.readyState == null;
  const canAttemptStructuredRead =
    hasReachedTargetDocument && (hasReadableReadyState || hasDocumentUrlWithUnknownReadyState);
  const pageReadable =
    input.settled === true &&
    input.readyState === 'complete' &&
    hasDocumentUrl &&
    !staleAfterAttempt;

  return {
    pageReadable,
    canAttemptStructuredRead,
    nextStepHint: pageReadable
      ? 'safe_to_read_page'
      : canAttemptStructuredRead
        ? hasReadableReadyState
          ? 'navigation_interactive; structured_read_may_succeed'
          : 'navigation_document_url_detected; structured_read_may_succeed'
        : 'navigation_not_readable; avoid chrome_read_page until navigation reaches a document',
  };
}

function getTabNavigationUrl(tab?: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'> | null): string {
  return tab?.url || tab?.pendingUrl || '';
}

async function waitForCreatedDocumentTabAfterTimeout(input: {
  windowId: number;
  existingTabIds: ReadonlySet<number>;
  targetUrl: string;
  pickBestMatch: (target: string, tabsToPick: chrome.tabs.Tab[]) => chrome.tabs.Tab | undefined;
}): Promise<chrome.tabs.Tab | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tabs = await chrome.tabs.query({ windowId: input.windowId });
    const createdDocumentTabs = tabs.filter((tab) => {
      const tabUrl = getTabNavigationUrl(tab);
      return (
        typeof tab.id === 'number' &&
        !input.existingTabIds.has(tab.id) &&
        tabUrl &&
        tabUrl !== 'about:blank'
      );
    });
    const matched = input.pickBestMatch(input.targetUrl, createdDocumentTabs);
    if (matched) return matched;
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  return undefined;
}

function normalizeSettleTimeoutMs(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), 1000), 60000);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function removeBlankTabIfPresent(tabId: number): Promise<boolean> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || tab.pendingUrl || '';
    if (url === '' || url === 'about:blank') {
      await chrome.tabs.remove(tabId);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function shouldAddWwwVariant(hostname: string): boolean {
  if (!hostname || hostname === 'localhost') {
    return false;
  }

  // IPv6 literals arrive without brackets in URL.hostname.
  if (hostname.includes(':')) {
    return false;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) {
    return false;
  }

  return hostname.includes('.');
}

function normalizeComparableUrl(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const normalizedPath =
      parsed.pathname !== '/' && parsed.pathname.endsWith('/')
        ? parsed.pathname.slice(0, -1)
        : parsed.pathname || '/';
    return `${parsed.origin}${normalizedPath}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

async function getPreferredWindowForUrl(
  url: string,
  candidateTabs: chrome.tabs.Tab[],
): Promise<{ window: chrome.windows.Window | null; reason: string }> {
  const candidateWindowId = candidateTabs.find(
    (tab) => typeof tab.windowId === 'number' && !tab.discarded,
  )?.windowId;

  if (typeof candidateWindowId === 'number') {
    try {
      return {
        window: await chrome.windows.get(candidateWindowId, { populate: false }),
        reason: 'same_site_existing_window',
      };
    } catch (error) {
      void error;
      // Fall through to the normal last-focused window path.
    }
  }

  try {
    return {
      window: await chrome.windows.getLastFocused({ populate: false }),
      reason: 'last_focused_window',
    };
  } catch {
    return { window: null, reason: 'no_window_available' };
  }
}

export function buildNavigateUrlPatterns(input: string): string[] {
  const patterns = new Set<string>();

  try {
    if (!input.includes('*')) {
      const u = new URL(input);
      const pathWildcard = '/*';

      const hostNoWww = u.host.replace(/^www\./, '');
      const hostWithWww = shouldAddWwwVariant(u.hostname)
        ? hostNoWww.startsWith('www.')
          ? hostNoWww
          : `www.${hostNoWww}`
        : null;

      patterns.add(`${u.protocol}//${u.host}${pathWildcard}`);
      patterns.add(`${u.protocol}//${hostNoWww}${pathWildcard}`);
      if (hostWithWww) {
        patterns.add(`${u.protocol}//${hostWithWww}${pathWildcard}`);
      }

      const altProtocol = u.protocol === 'https:' ? 'http:' : 'https:';
      patterns.add(`${altProtocol}//${u.host}${pathWildcard}`);
      patterns.add(`${altProtocol}//${hostNoWww}${pathWildcard}`);
      if (hostWithWww) {
        patterns.add(`${altProtocol}//${hostWithWww}${pathWildcard}`);
      }
    } else {
      patterns.add(input);
    }
  } catch {
    patterns.add(input.endsWith('/') ? `${input}*` : `${input}/*`);
  }

  return Array.from(patterns);
}

/**
 * Tool for navigating to URLs in browser tabs or windows
 */
class NavigateTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.NAVIGATE;

  /**
   * Trigger GIF auto-capture after successful navigation
   */
  private async triggerAutoCapture(tabId: number, url?: string): Promise<void> {
    if (!isAutoCaptureActive(tabId)) {
      return;
    }
    try {
      await captureFrameOnAction(tabId, { type: 'navigate', url });
    } catch (error) {
      console.warn('[NavigateTool] Auto-capture failed:', error);
    }
  }

  async execute(args: NavigateToolParams): Promise<ToolResult> {
    const {
      newWindow = false,
      width,
      height,
      url,
      refresh = false,
      tabId,
      background,
      windowId,
      settleTimeoutMs,
    } = args;
    const settleOptions = { timeoutMs: normalizeSettleTimeoutMs(settleTimeoutMs) };

    console.log(
      `Attempting to ${refresh ? 'refresh current tab' : `open URL: ${url}`} with options:`,
      args,
    );

    try {
      // Handle refresh option first
      if (refresh) {
        console.log('Refreshing current active tab');
        const explicit = await this.tryGetTab(tabId);
        // Get target tab (explicit or active in provided window)
        const targetTab = explicit || (await this.getActiveTabOrThrowInWindow(windowId));
        if (!targetTab.id) return createErrorResponse('No target tab found to refresh');
        const previousUrl = targetTab.url;
        await chrome.tabs.reload(targetTab.id);
        const settleResult = await this.waitForTabSettled(targetTab.id, {
          previousUrl,
          requireUrlChange: false,
          ...settleOptions,
        });

        console.log(`Refreshed tab ID: ${targetTab.id}`);

        // Get updated tab information
        const updatedTab = settleResult.tab;

        // Trigger auto-capture on refresh
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);
        const actionId = createNavigationActionId('refresh', updatedTab.id);
        recordNavigationPendingAction(updatedTab.id, actionId);
        const postActionDelta = buildNavigationPostActionDelta({
          actionId,
          actionKind: 'refresh',
          tabId: updatedTab.id,
          previousUrl,
          finalUrl: updatedTab.url,
          settled: settleResult.settled,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: 'Successfully refreshed current tab',
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                url: updatedTab.url,
                status: updatedTab.status,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
                postActionDelta,
                ...buildNavigationReadinessFields({
                  settled: settleResult.settled,
                  readyState: settleResult.readyState,
                  finalUrl: updatedTab.url,
                  status: updatedTab.status,
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      // Validate that url is provided when not refreshing
      if (!url) {
        return createErrorResponse('URL parameter is required when refresh is not true');
      }

      // Handle history navigation: url="back" or url="forward"
      if (url === 'back' || url === 'forward') {
        const explicitTab = await this.tryGetTab(tabId);
        const targetTab = explicitTab || (await this.getActiveTabOrThrowInWindow(windowId));
        if (!targetTab.id) {
          return createErrorResponse('No target tab found for history navigation');
        }

        // Respect background flag for focus behavior
        await this.ensureFocus(targetTab, {
          activate: background !== true,
          focusWindow: background !== true,
        });
        const previousUrl = targetTab.url;

        if (url === 'forward') {
          await chrome.tabs.goForward(targetTab.id);
          console.log(`Navigated forward in tab ID: ${targetTab.id}`);
        } else {
          await chrome.tabs.goBack(targetTab.id);
          console.log(`Navigated back in tab ID: ${targetTab.id}`);
        }

        const settleResult = await this.waitForTabSettled(targetTab.id, {
          previousUrl,
          requireUrlChange: true,
          ...settleOptions,
        });
        const updatedTab = settleResult.tab;

        // Trigger auto-capture on history navigation
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);
        const actionId = createNavigationActionId('history', updatedTab.id);
        recordNavigationPendingAction(updatedTab.id, actionId);
        const postActionDelta = buildNavigationPostActionDelta({
          actionId,
          actionKind: 'history',
          tabId: updatedTab.id,
          previousUrl,
          finalUrl: updatedTab.url,
          settled: settleResult.settled,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Successfully navigated ${url} in browser history`,
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                url: updatedTab.url,
                status: updatedTab.status,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
                postActionDelta,
                ...buildNavigationReadinessFields({
                  settled: settleResult.settled,
                  readyState: settleResult.readyState,
                  finalUrl: updatedTab.url,
                  previousUrl,
                  status: updatedTab.status,
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      // 1. Check if URL is already open
      // Prefer Chrome's URL match patterns for robust matching (host/path variations)
      console.log(`Checking if URL is already open: ${url}`);

      // Build robust match patterns from the provided URL.
      // This mirrors the approach in CloseTabsTool: ensure wildcard path and
      // add common variants (www/no-www, http/https) to handle real-world redirects.
      const urlPatterns = buildNavigateUrlPatterns(url);
      const candidateTabs = await chrome.tabs.query({ url: urlPatterns });
      console.log(`Found ${candidateTabs.length} matching tabs with patterns:`, urlPatterns);

      // Prefer strict match when user specifies a concrete path/query.
      // Only fall back to host-level activation when the target is site root.
      const pickBestMatch = (target: string, tabsToPick: chrome.tabs.Tab[]) => {
        let targetUrl: URL | undefined;
        try {
          targetUrl = new URL(target);
        } catch {
          // Not a fully-qualified URL; cannot do structured comparison
          return tabsToPick[0];
        }

        const normalizePath = (p: string) => {
          if (!p) return '/';
          // Ensure leading slash
          const withLeading = p.startsWith('/') ? p : `/${p}`;
          // Remove trailing slash except when root
          return withLeading !== '/' && withLeading.endsWith('/')
            ? withLeading.slice(0, -1)
            : withLeading;
        };

        const hostBase = (h: string) => h.replace(/^www\./, '').toLowerCase();
        const isRootTarget = normalizePath(targetUrl.pathname) === '/' && !targetUrl.search;
        const targetPath = normalizePath(targetUrl.pathname);
        const targetSearch = targetUrl.search || '';
        const targetHostBase = hostBase(targetUrl.host);

        let best: { tab?: chrome.tabs.Tab; score: number } = { score: -1 };

        for (const tab of tabsToPick) {
          const tabUrlStr = getTabNavigationUrl(tab);
          let tabUrl: URL | undefined;
          try {
            tabUrl = new URL(tabUrlStr);
          } catch {
            continue;
          }

          const tabHostBase = hostBase(tabUrl.host);
          if (tabHostBase !== targetHostBase) continue;

          const tabPath = normalizePath(tabUrl.pathname);
          const tabSearch = tabUrl.search || '';

          // Scoring:
          // 3 - exact path match and (if target has query) exact query match
          // 2 - exact path match ignoring query (target without query)
          // 1 - same host, any path (only if target is root)
          let score = -1;
          const pathEqual = tabPath === targetPath;
          const searchEqual = tabSearch === targetSearch;

          if (pathEqual && (targetSearch ? searchEqual : true)) {
            score = 3;
          } else if (pathEqual && !targetSearch) {
            score = 2;
          }

          if (score > best.score) {
            best = { tab, score };
            if (score === 3) break; // Cannot do better
          }
        }

        return best.tab;
      };

      const explicitTab = await this.tryGetTab(tabId);
      const existingTab = explicitTab || pickBestMatch(url, candidateTabs);
      if (existingTab?.id !== undefined) {
        console.log(
          `URL already open in Tab ID: ${existingTab.id}, Window ID: ${existingTab.windowId}`,
        );
        const previousUrl = existingTab.url;
        const shouldNavigateExplicitTab =
          explicitTab?.id === existingTab.id &&
          normalizeComparableUrl(explicitTab.url) !== normalizeComparableUrl(url);

        // Update URL only when explicit tab specified and url differs
        if (shouldNavigateExplicitTab && explicitTab && typeof explicitTab.id === 'number') {
          await chrome.tabs.update(explicitTab.id, { url });
        }
        // Optionally bring to foreground based on background flag
        await this.ensureFocus(existingTab, {
          activate: background !== true,
          focusWindow: background !== true,
        });

        console.log(`Activated existing Tab ID: ${existingTab.id}`);
        const settleResult = await this.waitForTabSettled(existingTab.id, {
          previousUrl,
          requireUrlChange: shouldNavigateExplicitTab,
          ...settleOptions,
        });
        const updatedTab = settleResult.tab;
        markBrowserWorldTabAiOperated(
          updatedTab.id,
          shouldNavigateExplicitTab ? 'navigate_existing_tab' : 'activate_existing_tab',
        );

        // Trigger auto-capture on existing tab activation
        await this.triggerAutoCapture(updatedTab.id!, updatedTab.url);
        const actionKind: NavigationActionKind = shouldNavigateExplicitTab
          ? 'navigate_existing_tab'
          : 'activate_existing_tab';
        const actionId = createNavigationActionId(actionKind, updatedTab.id);
        recordNavigationPendingAction(updatedTab.id, actionId);
        const postActionDelta = buildNavigationPostActionDelta({
          actionId,
          actionKind,
          tabId: updatedTab.id,
          previousUrl,
          finalUrl: updatedTab.url,
          settled: settleResult.settled,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: shouldNavigateExplicitTab
                  ? 'Navigated explicit tab to requested URL'
                  : 'Activated matching existing tab',
                tabId: updatedTab.id,
                windowId: updatedTab.windowId,
                requestedUrl: url,
                finalUrl: updatedTab.url,
                status: updatedTab.status,
                activated: background !== true,
                usedExistingTab: true,
                navigatedExplicitTab: shouldNavigateExplicitTab,
                settled: settleResult.settled,
                settleReason: settleResult.reason,
                waitedMs: settleResult.waitedMs,
                readyState: settleResult.readyState,
                postActionDelta,
                ...buildNavigationReadinessFields({
                  settled: settleResult.settled,
                  readyState: settleResult.readyState,
                  finalUrl: updatedTab.url,
                  previousUrl,
                  status: updatedTab.status,
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      // 2. If URL is not already open, decide how to open it based on options
      const openInNewWindow = newWindow || typeof width === 'number' || typeof height === 'number';

      if (openInNewWindow) {
        console.log('Opening URL in a new window.');

        // Create new window
        const newWindow = await chrome.windows.create({
          url: url,
          width: typeof width === 'number' ? width : DEFAULT_WINDOW_WIDTH,
          height: typeof height === 'number' ? height : DEFAULT_WINDOW_HEIGHT,
          focused: background === true ? false : true,
        });

        if (newWindow && newWindow.id !== undefined) {
          console.log(`URL opened in new Window ID: ${newWindow.id}`);

          // Trigger auto-capture if the new window has a tab
          const firstTab = newWindow.tabs?.[0];
          if (firstTab?.id) {
            markBrowserWorldTabAiCreated(firstTab.id);
            const settleResult = await this.waitForTabSettled(firstTab.id, settleOptions);
            markBrowserWorldTabAiOperated(settleResult.tab.id, 'navigate_new_window_tab');
            await this.triggerAutoCapture(firstTab.id, settleResult.tab.url);
            const actionId = createNavigationActionId(
              'navigate_new_window_tab',
              settleResult.tab.id,
            );
            recordNavigationPendingAction(settleResult.tab.id, actionId);
            const postActionDelta = buildNavigationPostActionDelta({
              actionId,
              actionKind: 'navigate_new_window_tab',
              tabId: settleResult.tab.id,
              finalUrl: settleResult.tab.url,
              newTabOpened: true,
              settled: settleResult.settled,
            });

            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: true,
                    message: 'Opened URL in new window',
                    windowId: newWindow.id,
                    tabId: settleResult.tab.id,
                    requestedUrl: url,
                    finalUrl: settleResult.tab.url,
                    status: settleResult.tab.status,
                    settled: settleResult.settled,
                    settleReason: settleResult.reason,
                    waitedMs: settleResult.waitedMs,
                    readyState: settleResult.readyState,
                    postActionDelta,
                    tabs: newWindow.tabs
                      ? newWindow.tabs.map((tab) => ({
                          tabId: tab.id,
                          url: tab.url,
                        }))
                      : [],
                  }),
                },
              ],
              isError: false,
            };
          }
        }
      } else {
        console.log('Opening URL in the last active window.');
        // Try to open a new tab in the specified window, otherwise the most recently active window
        let targetWindow: chrome.windows.Window | null = null;
        let targetWindowReason = 'explicit_window';
        if (typeof windowId === 'number') {
          targetWindow = await chrome.windows.get(windowId, { populate: false });
        }
        if (!targetWindow) {
          const preferred = await getPreferredWindowForUrl(url, candidateTabs);
          targetWindow = preferred.window;
          targetWindowReason = preferred.reason;
        }

        if (targetWindow && targetWindow.id !== undefined) {
          console.log(`Found target Window ID: ${targetWindow.id}`);

          const tabsBeforeCreate = await chrome.tabs.query({ windowId: targetWindow.id });
          const existingTabIds = new Set(
            tabsBeforeCreate
              .map((tab) => tab.id)
              .filter((id): id is number => typeof id === 'number'),
          );
          let newTab: chrome.tabs.Tab;
          try {
            newTab = await withTimeout(
              chrome.tabs.create({
                url: url,
                windowId: targetWindow.id,
                active: background === true ? false : true,
              }),
              NAVIGATE_CREATE_TAB_TIMEOUT_MS,
              `chrome.tabs.create timed out after ${NAVIGATE_CREATE_TAB_TIMEOUT_MS}ms`,
            );
            markBrowserWorldTabAiCreated(newTab.id);
          } catch (error) {
            const timeoutNavigationTab = await waitForCreatedDocumentTabAfterTimeout({
              windowId: targetWindow.id,
              existingTabIds,
              targetUrl: url,
              pickBestMatch,
            });
            if (timeoutNavigationTab?.id !== undefined) {
              markBrowserWorldTabAiCreated(timeoutNavigationTab.id);
              const finalNavigationUrl = getTabNavigationUrl(timeoutNavigationTab);
              const readyState =
                timeoutNavigationTab.status === 'complete' ? 'complete' : 'interactive';
              const actionId = createNavigationActionId(
                'navigate_new_tab',
                timeoutNavigationTab.id,
              );
              recordNavigationPendingAction(timeoutNavigationTab.id, actionId);
              const postActionDelta = buildNavigationPostActionDelta({
                actionId,
                actionKind: 'navigate_new_tab',
                tabId: timeoutNavigationTab.id,
                finalUrl: finalNavigationUrl,
                newTabOpened: true,
                settled: false,
              });
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: 'Opened URL in new tab after create timeout',
                      tabId: timeoutNavigationTab.id,
                      windowId: targetWindow.id,
                      targetWindowReason,
                      requestedUrl: url,
                      finalUrl: finalNavigationUrl,
                      status: timeoutNavigationTab.status,
                      settled: false,
                      settleReason: 'create_timeout_but_document_tab_found',
                      waitedMs: NAVIGATE_CREATE_TAB_TIMEOUT_MS,
                      readyState,
                      postActionDelta,
                      ...buildNavigationReadinessFields({
                        settled: false,
                        readyState,
                        finalUrl: finalNavigationUrl,
                        status: timeoutNavigationTab.status,
                      }),
                    }),
                  },
                ],
                isError: false,
              };
            }
            const tabsAfterTimeout = await chrome.tabs.query({ windowId: targetWindow.id });
            const blankTabs = tabsAfterTimeout.filter((tab) => {
              const tabUrl = tab.url || tab.pendingUrl || '';
              return (
                typeof tab.id === 'number' &&
                !existingTabIds.has(tab.id) &&
                (tabUrl === '' || tabUrl === 'about:blank')
              );
            });
            const cleanupTabIds: number[] = [];
            for (const tab of blankTabs) {
              if (typeof tab.id === 'number' && (await removeBlankTabIfPresent(tab.id))) {
                cleanupTabIds.push(tab.id);
              }
            }
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    success: false,
                    message: 'Failed to create navigation tab within bounded timeout',
                    requestedUrl: url,
                    windowId: targetWindow.id,
                    error: error instanceof Error ? error.message : String(error),
                    cleanupTabIds,
                    pageReadable: false,
                    canAttemptStructuredRead: false,
                    nextStepHint:
                      'navigation_failed_before_document; retry navigation or inspect browser status',
                  }),
                },
              ],
              isError: true,
            };
          }
          if (background !== true) {
            await chrome.windows.update(targetWindow.id, { focused: true });
          }

          console.log(
            `URL opened in new Tab ID: ${newTab.id} in existing Window ID: ${targetWindow.id}`,
          );

          const settleResult = newTab.id
            ? await this.waitForTabSettled(newTab.id, settleOptions)
            : null;
          markBrowserWorldTabAiOperated(settleResult?.tab.id || newTab.id, 'navigate_new_tab');

          // Trigger auto-capture on new tab
          if (newTab.id) {
            await this.triggerAutoCapture(
              newTab.id,
              getTabNavigationUrl(settleResult?.tab || newTab),
            );
          }
          const finalNavigationUrl = getTabNavigationUrl(settleResult?.tab || newTab);
          const finalTabId = settleResult?.tab.id || newTab.id || null;
          const actionId = createNavigationActionId('navigate_new_tab', finalTabId);
          recordNavigationPendingAction(finalTabId, actionId);
          const postActionDelta = buildNavigationPostActionDelta({
            actionId,
            actionKind: 'navigate_new_tab',
            tabId: finalTabId,
            finalUrl: finalNavigationUrl,
            newTabOpened: true,
            settled: settleResult?.settled ?? false,
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message: 'Opened URL in new tab in existing window',
                  tabId: finalTabId,
                  windowId: targetWindow.id,
                  targetWindowReason,
                  requestedUrl: url,
                  finalUrl: finalNavigationUrl,
                  status: settleResult?.tab.status || newTab.status,
                  settled: settleResult?.settled ?? false,
                  settleReason: settleResult?.reason || null,
                  waitedMs: settleResult?.waitedMs || 0,
                  readyState: settleResult?.readyState || null,
                  postActionDelta,
                  ...buildNavigationReadinessFields({
                    settled: settleResult?.settled ?? false,
                    readyState: settleResult?.readyState || null,
                    finalUrl: finalNavigationUrl,
                    status: settleResult?.tab.status || newTab.status,
                  }),
                }),
              },
            ],
            isError: false,
          };
        } else {
          // In rare cases, if there's no recently active window (e.g., browser just started with no windows)
          // Fall back to opening in a new window
          console.warn('No last focused window found, falling back to creating a new window.');

          const fallbackWindow = await chrome.windows.create({
            url: url,
            width: DEFAULT_WINDOW_WIDTH,
            height: DEFAULT_WINDOW_HEIGHT,
            focused: true,
          });

          if (fallbackWindow && fallbackWindow.id !== undefined) {
            console.log(`URL opened in fallback new Window ID: ${fallbackWindow.id}`);

            // Trigger auto-capture if fallback window has a tab
            const firstTab = fallbackWindow.tabs?.[0];
            if (firstTab?.id) {
              markBrowserWorldTabAiCreated(firstTab.id);
              const settleResult = await this.waitForTabSettled(firstTab.id, settleOptions);
              markBrowserWorldTabAiOperated(settleResult.tab.id, 'navigate_fallback_window_tab');
              await this.triggerAutoCapture(firstTab.id, settleResult.tab.url);
              const actionId = createNavigationActionId(
                'navigate_fallback_window_tab',
                settleResult.tab.id,
              );
              recordNavigationPendingAction(settleResult.tab.id, actionId);
              const postActionDelta = buildNavigationPostActionDelta({
                actionId,
                actionKind: 'navigate_fallback_window_tab',
                tabId: settleResult.tab.id,
                finalUrl: settleResult.tab.url,
                newTabOpened: true,
                settled: settleResult.settled,
              });

              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      success: true,
                      message: 'Opened URL in new window',
                      windowId: fallbackWindow.id,
                      tabId: settleResult.tab.id,
                      requestedUrl: url,
                      finalUrl: settleResult.tab.url,
                      status: settleResult.tab.status,
                      settled: settleResult.settled,
                      settleReason: settleResult.reason,
                      waitedMs: settleResult.waitedMs,
                      readyState: settleResult.readyState,
                      postActionDelta,
                      tabs: fallbackWindow.tabs
                        ? fallbackWindow.tabs.map((tab) => ({
                            tabId: tab.id,
                            url: tab.url,
                          }))
                        : [],
                    }),
                  },
                ],
                isError: false,
              };
            }
          }
        }
      }

      // If all attempts fail, return a generic error
      return createErrorResponse('Failed to open URL: Unknown error occurred');
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('Error in navigate:', error);
        return createErrorResponse(
          `Error navigating to URL: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
export const navigateTool = new NavigateTool();

interface CloseTabsToolParams {
  tabIds?: number[];
  url?: string;
  /** Scope URL-based close operations to this window when provided. */
  windowId?: number;
}

function buildCloseTabsLogSummary(args: CloseTabsToolParams): Record<string, unknown> {
  return {
    hasUrl: typeof args.url === 'string' && args.url.length > 0,
    tabIdCount: Array.isArray(args.tabIds) ? args.tabIds.length : 0,
    windowId: typeof args.windowId === 'number' ? args.windowId : null,
  };
}

interface CloseTabsBrowserSnapshot {
  tabCount: number;
  windowCount: number;
  focusedWindowId: number | null;
  activeTabId: number | null;
}

interface CloseTabsBrowserHygieneEvidence {
  kind: 'close_tabs_hygiene_v1';
  before: CloseTabsBrowserSnapshot;
  after: CloseTabsBrowserSnapshot;
  closedTabIds: number[];
  invalidTabIds: number[];
  tabWindowBaselineUnchanged: boolean | null;
  activeTabRestored: boolean | null;
  activeTabRestoreReason: string;
}

interface CloseTabsPreflightBlockedResponseInput {
  tabIds: number[];
  preflight: CloseTabsPreflightEvidence;
  invalidTabIds?: number[];
}

/**
 * Tool for closing browser tabs
 */
class CloseTabsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLOSE_TABS;

  async execute(args: CloseTabsToolParams): Promise<ToolResult> {
    const { tabIds, url, windowId } = args;
    let urlPattern = url;
    console.log(`Attempting to close tabs with options:`, buildCloseTabsLogSummary(args));

    try {
      // If URL is provided, close all tabs matching that URL
      if (urlPattern) {
        console.log('Searching for tabs with provided URL pattern');
        try {
          // Build a proper Chrome match pattern from a concrete URL.
          // If caller already provided a match pattern with '*', use as-is.
          if (!urlPattern.includes('*')) {
            // Ignore search/hash; match by origin + pathname prefix.
            // Use URL to normalize; fallback to simple suffixing when parsing fails.
            try {
              const u = new URL(urlPattern);
              const basePath = u.pathname || '/';
              const pathWithWildcard = basePath.endsWith('/') ? `${basePath}*` : `${basePath}/*`;
              urlPattern = `${u.protocol}//${u.host}${pathWithWildcard}`;
            } catch {
              // Not a fully-qualified URL; ensure it ends with wildcard
              urlPattern = urlPattern.endsWith('/') ? `${urlPattern}*` : `${urlPattern}/*`;
            }
          }
        } catch {
          // Best-effort: ensure we have some wildcard
          urlPattern = urlPattern.endsWith('*')
            ? urlPattern
            : urlPattern.endsWith('/')
              ? `${urlPattern}*`
              : `${urlPattern}/*`;
        }

        const tabs = await chrome.tabs.query({
          url: urlPattern,
          ...(typeof windowId === 'number' ? { windowId } : {}),
        });

        if (!tabs || tabs.length === 0) {
          console.log('No tabs found with provided URL pattern');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'No tabs found with provided URL pattern',
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        console.log(`Found ${tabs.length} tabs with provided URL pattern`);
        const tabIdsToClose = tabs
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (tabIdsToClose.length === 0) {
          return createErrorResponse('Found tabs but could not get their IDs');
        }

        const preflight = await preflightCloseTabs(tabIdsToClose);
        if (preflight.verdict !== 'allowed') {
          return buildCloseTabsPreflightBlockedResponse({
            tabIds: tabIdsToClose,
            preflight,
          });
        }

        const hygieneBefore = await captureCloseTabsBrowserSnapshot();
        for (const tabId of tabIdsToClose) {
          markBrowserWorldTabAiOperated(tabId, 'close_tabs_requested');
        }
        await chrome.tabs.remove(tabIdsToClose);
        const hygieneAfter = await captureCloseTabsBrowserSnapshot();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Closed ${tabIdsToClose.length} tabs matching provided URL pattern`,
                closedCount: tabIdsToClose.length,
                closedTabIds: tabIdsToClose,
                closePreflightEvidence: preflight,
                browserHygieneEvidence: buildCloseTabsBrowserHygieneEvidence({
                  before: hygieneBefore,
                  after: hygieneAfter,
                  closedTabIds: tabIdsToClose,
                  invalidTabIds: [],
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      // If tabIds are provided, close those tabs
      if (tabIds && tabIds.length > 0) {
        console.log(`Closing tabs with IDs: ${tabIds.join(', ')}`);

        // Verify that all tabIds exist
        const existingTabs = await Promise.all(
          tabIds.map(async (tabId) => {
            try {
              return await chrome.tabs.get(tabId);
            } catch (error) {
              console.warn(`Tab with ID ${tabId} not found`);
              return null;
            }
          }),
        );

        const validTabIds = existingTabs
          .filter((tab): tab is chrome.tabs.Tab => tab !== null)
          .map((tab) => tab.id)
          .filter((id): id is number => id !== undefined);

        if (validTabIds.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  message: 'None of the provided tab IDs exist',
                  closedCount: 0,
                }),
              },
            ],
            isError: false,
          };
        }

        const preflight = await preflightCloseTabs(validTabIds);
        const invalidTabIds = tabIds.filter((id) => !validTabIds.includes(id));
        if (preflight.verdict !== 'allowed') {
          return buildCloseTabsPreflightBlockedResponse({
            tabIds: validTabIds,
            preflight,
            invalidTabIds,
          });
        }

        const hygieneBefore = await captureCloseTabsBrowserSnapshot();
        for (const tabId of validTabIds) {
          markBrowserWorldTabAiOperated(tabId, 'close_tabs_requested');
        }
        await chrome.tabs.remove(validTabIds);
        const hygieneAfter = await captureCloseTabsBrowserSnapshot();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message: `Closed ${validTabIds.length} tabs`,
                closedCount: validTabIds.length,
                closedTabIds: validTabIds,
                invalidTabIds,
                closePreflightEvidence: preflight,
                browserHygieneEvidence: buildCloseTabsBrowserHygieneEvidence({
                  before: hygieneBefore,
                  after: hygieneAfter,
                  closedTabIds: validTabIds,
                  invalidTabIds,
                }),
              }),
            },
          ],
          isError: false,
        };
      }

      return createErrorResponse(
        'Refusing to close the active tab without explicit tabIds or url. Provide run-owned tabIds to close.',
      );
    } catch (error) {
      console.error('Error in CloseTabsTool.execute:', error);
      return createErrorResponse(
        `Error closing tabs: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function buildCloseTabsPreflightBlockedResponse(
  input: CloseTabsPreflightBlockedResponseInput,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          blockedByPolicy: true,
          message:
            'Refusing to close tabs before BrowserWorld proves they are AI-owned and cleanup-eligible.',
          closedCount: 0,
          closedTabIds: [],
          requestedTabIds: input.tabIds,
          invalidTabIds: input.invalidTabIds ?? [],
          closePreflightEvidence: input.preflight,
        }),
      },
    ],
    isError: true,
  };
}

async function captureCloseTabsBrowserSnapshot(): Promise<CloseTabsBrowserSnapshot> {
  const [tabs, windows] = await Promise.all([
    chrome.tabs.query({}),
    chrome.windows.getAll({ populate: false }),
  ]);
  const focusedWindow = windows.find((window) => window.focused === true);
  const focusedWindowId = typeof focusedWindow?.id === 'number' ? focusedWindow.id : null;
  const activeTab =
    focusedWindowId === null
      ? tabs.find((tab) => tab.active === true)
      : tabs.find((tab) => tab.active === true && tab.windowId === focusedWindowId);

  return {
    tabCount: tabs.length,
    windowCount: windows.length,
    focusedWindowId,
    activeTabId: typeof activeTab?.id === 'number' ? activeTab.id : null,
  };
}

function buildCloseTabsBrowserHygieneEvidence(input: {
  before: CloseTabsBrowserSnapshot;
  after: CloseTabsBrowserSnapshot;
  closedTabIds: number[];
  invalidTabIds: number[];
}): CloseTabsBrowserHygieneEvidence {
  const closed = new Set(input.closedTabIds);
  const expectedTabCountAfter = input.before.tabCount - input.closedTabIds.length;
  const windowCountDelta = input.before.windowCount - input.after.windowCount;
  const windowCountCompatible =
    input.after.windowCount === input.before.windowCount ||
    (windowCountDelta > 0 && windowCountDelta <= input.closedTabIds.length);
  const tabWindowBaselineUnchanged =
    expectedTabCountAfter >= 0
      ? input.after.tabCount === expectedTabCountAfter && windowCountCompatible
      : null;
  const beforeActiveTabClosed =
    input.before.activeTabId !== null && closed.has(input.before.activeTabId);
  const activeTabRestored =
    input.before.activeTabId === null || input.after.activeTabId === null
      ? null
      : beforeActiveTabClosed
        ? !closed.has(input.after.activeTabId)
        : input.after.activeTabId === input.before.activeTabId;

  return {
    kind: 'close_tabs_hygiene_v1',
    before: input.before,
    after: input.after,
    closedTabIds: [...input.closedTabIds],
    invalidTabIds: [...input.invalidTabIds],
    tabWindowBaselineUnchanged,
    activeTabRestored,
    activeTabRestoreReason:
      activeTabRestored === true
        ? beforeActiveTabClosed
          ? 'active_tab_restored_to_surviving_tab'
          : 'active_tab_preserved'
        : activeTabRestored === false
          ? 'active_tab_not_restored'
          : 'active_tab_restore_not_observed',
  };
}

export const closeTabsTool = new CloseTabsTool();

interface SwitchTabToolParams {
  tabId: number;
  windowId?: number;
}

/**
 * Tool for switching the active tab
 */
class SwitchTabTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.SWITCH_TAB;

  async execute(args: SwitchTabToolParams): Promise<ToolResult> {
    const { tabId, windowId } = args;

    console.log(`Attempting to switch to tab ID: ${tabId} in window ID: ${windowId}`);

    try {
      const targetTab = await chrome.tabs.get(tabId);
      if (windowId !== undefined && targetTab.windowId !== windowId) {
        return createErrorResponse(`Tab ${tabId} does not belong to window ${windowId}`);
      }

      await this.ensureFocus(targetTab, {
        activate: true,
        focusWindow: true,
      });

      const activationResult = await this.waitForTabActivated(tabId, {
        expectedWindowId: targetTab.windowId,
        requireFocusedWindow: true,
      });

      const settleResult =
        activationResult.tab.status === 'complete'
          ? null
          : await this.waitForTabSettled(tabId, { timeoutMs: 5000 });
      const updatedTab = settleResult?.tab || activationResult.tab;
      const foregroundProof = await this.waitForTabForegroundProof(tabId, {
        chromeWindowFocused: activationResult.windowFocused,
        chromeTabActive: activationResult.activated,
      });
      markBrowserWorldTabAiOperated(updatedTab.id, 'switch_tab', {
        confidence: foregroundProof.verdict === 'proven_foreground' ? 0.95 : 0.45,
        evidenceLabel:
          foregroundProof.verdict === 'proven_foreground' ? undefined : foregroundProof.verdict,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: `Successfully switched to tab ID: ${tabId}`,
              tabId: updatedTab.id,
              windowId: updatedTab.windowId,
              url: updatedTab.url,
              status: updatedTab.status,
              activated: activationResult.activated,
              activationTimedOut: activationResult.timedOut,
              activationWaitedMs: activationResult.waitedMs,
              windowFocused: activationResult.windowFocused,
              foregroundActivation: foregroundProof,
              foregroundActivationVerdict: foregroundProof.verdict,
              documentVisibilityState: foregroundProof.documentVisibilityState,
              documentHasFocus: foregroundProof.documentHasFocus,
              settled: settleResult ? settleResult.settled : updatedTab.status === 'complete',
              settleReason: settleResult?.reason || 'already_complete',
              settleWaitedMs: settleResult?.waitedMs || 0,
              readyState: settleResult?.readyState || null,
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      if (chrome.runtime.lastError) {
        console.error(`Chrome API Error: ${chrome.runtime.lastError.message}`, error);
        return createErrorResponse(`Chrome API Error: ${chrome.runtime.lastError.message}`);
      } else {
        console.error('Error in SwitchTabTool.execute:', error);
        return createErrorResponse(
          `Error switching tab: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

export const switchTabTool = new SwitchTabTool();
