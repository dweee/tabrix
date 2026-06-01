import { ToolExecutor } from '@/common/tool-handler';
import type { ToolResult } from '@/common/tool-handler';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';

const PING_TIMEOUT_MS = 300;
const DOCUMENT_READY_STATE_TIMEOUT_MS = 500;
const TAB_SETTLE_TIMEOUT_MS = 8000;
const TAB_ACTIVATION_TIMEOUT_MS = 1500;
const TAB_POLL_INTERVAL_MS = 100;
const TRANSIENT_FRAME_REMOVED_RETRY_DELAY_MS = 150;
const TRANSIENT_FRAME_REMOVED_RETRY_LIMIT = 1;

interface WaitForTabSettledOptions {
  timeoutMs?: number;
  previousUrl?: string;
  requireUrlChange?: boolean;
}

interface WaitForTabSettledResult {
  tab: chrome.tabs.Tab;
  settled: boolean;
  timedOut: boolean;
  reason:
    | 'already_complete'
    | 'complete'
    | 'complete_after_url_change'
    | 'interactive'
    | 'timeout'
    | 'tab_missing';
  waitedMs: number;
  readyState: string | null;
}

interface WaitForTabActivatedOptions {
  timeoutMs?: number;
  expectedWindowId?: number;
  requireFocusedWindow?: boolean;
}

interface WaitForTabActivatedResult {
  tab: chrome.tabs.Tab;
  activated: boolean;
  timedOut: boolean;
  waitedMs: number;
  windowFocused: boolean | null;
}

interface ContentScriptInjectionTiming {
  pingMs: number;
  pingStatus: 'pong' | 'failed_or_timeout' | 'unexpected_response';
  executeScriptMs: number | null;
  injected: boolean;
  totalMs: number;
}

function isTransientFrameRemovedError(message: string): boolean {
  return /Frame with ID \d+ was removed/i.test(message);
}

/**
 * Base class for browser tool executors
 */
export abstract class BaseBrowserToolExecutor implements ToolExecutor {
  abstract name: string;
  abstract execute(args: any): Promise<ToolResult>;

  protected classifyContentScriptError(error: unknown): {
    reason: 'page_unreadable';
    recommendedAction: 'retry_navigation_or_use_browser_status';
    message: string;
  } | null {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /showing error page/i.test(message) ||
      /Cannot access contents of url "chrome-error:\/\//i.test(message)
    ) {
      return {
        reason: 'page_unreadable',
        recommendedAction: 'retry_navigation_or_use_browser_status',
        message,
      };
    }
    return null;
  }

  /**
   * Inject content script into tab
   */
  protected async injectContentScript(
    tabId: number,
    files: string[],
    injectImmediately = false,
    world: 'MAIN' | 'ISOLATED' = 'ISOLATED',
    allFrames: boolean = false,
    frameIds?: number[],
    onTiming?: (timing: ContentScriptInjectionTiming) => void,
  ): Promise<void> {
    const startedAt = Date.now();
    let pingMs = 0;
    try {
      const pingFrameId = frameIds?.[0];
      const pingStartedAt = Date.now();
      const response = await Promise.race([
        typeof pingFrameId === 'number'
          ? chrome.tabs.sendMessage(
              tabId,
              { action: `${this.name}_ping` },
              { frameId: pingFrameId },
            )
          : chrome.tabs.sendMessage(tabId, { action: `${this.name}_ping` }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`${this.name} Ping action to tab ${tabId} timed out`)),
            PING_TIMEOUT_MS,
          ),
        ),
      ]);
      pingMs = Date.now() - pingStartedAt;

      if (response && response.status === 'pong') {
        onTiming?.({
          pingMs,
          pingStatus: 'pong',
          executeScriptMs: null,
          injected: false,
          totalMs: Date.now() - startedAt,
        });
        return;
      }
      onTiming?.({
        pingMs,
        pingStatus: 'unexpected_response',
        executeScriptMs: null,
        injected: false,
        totalMs: Date.now() - startedAt,
      });
    } catch {
      pingMs = Date.now() - startedAt;
      // Ping failure is expected when the script hasn't been injected yet.
    }

    for (let attempt = 0; attempt <= TRANSIENT_FRAME_REMOVED_RETRY_LIMIT; attempt += 1) {
      try {
        const executeScriptStartedAt = Date.now();
        const target: { tabId: number; allFrames?: boolean; frameIds?: number[] } = { tabId };
        if (frameIds && frameIds.length > 0) {
          target.frameIds = frameIds;
        } else if (allFrames) {
          target.allFrames = true;
        }
        await chrome.scripting.executeScript({
          target,
          files,
          injectImmediately,
          world,
        } as any);
        onTiming?.({
          pingMs,
          pingStatus: 'failed_or_timeout',
          executeScriptMs: Date.now() - executeScriptStartedAt,
          injected: true,
          totalMs: Date.now() - startedAt,
        });
        return;
      } catch (injectionError) {
        const errorMessage =
          injectionError instanceof Error ? injectionError.message : String(injectionError);
        const canRetry =
          attempt < TRANSIENT_FRAME_REMOVED_RETRY_LIMIT &&
          isTransientFrameRemovedError(errorMessage);
        if (canRetry) {
          await this.sleep(TRANSIENT_FRAME_REMOVED_RETRY_DELAY_MS);
          continue;
        }
        throw new Error(
          `${ERROR_MESSAGES.TOOL_EXECUTION_FAILED}: Failed to inject content script in tab ${tabId}: ${errorMessage}`,
        );
      }
    }
  }

  /**
   * Send message to tab
   */
  protected async sendMessageToTab(tabId: number, message: any, frameId?: number): Promise<any> {
    const response =
      typeof frameId === 'number'
        ? await chrome.tabs.sendMessage(tabId, message, { frameId })
        : await chrome.tabs.sendMessage(tabId, message);

    if (response && response.error) {
      throw new Error(String(response.error));
    }

    return response;
  }

  /**
   * Try to get an existing tab by id. Returns null when not found.
   */
  protected async tryGetTab(tabId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof tabId !== 'number') return null;
    try {
      return await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
  }

  /**
   * Active tab in the **current** Chrome window. Same as `getActiveTabOrThrowInWindow()` with no `windowId`.
   */
  protected async getActiveTabOrThrow(): Promise<chrome.tabs.Tab> {
    return this.getActiveTabOrThrowInWindow();
  }

  /**
   * Optionally focus window and/or activate tab. Defaults preserve current behavior
   * when caller sets activate/focus flags explicitly.
   */
  protected async ensureFocus(
    tab: chrome.tabs.Tab,
    options: { activate?: boolean; focusWindow?: boolean } = {},
  ): Promise<void> {
    const activate = options.activate === true;
    const focusWindow = options.focusWindow === true;
    if (focusWindow && typeof tab.windowId === 'number') {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    if (activate && typeof tab.id === 'number') {
      await chrome.tabs.update(tab.id, { active: true });
    }
  }

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private normalizeComparableUrl(url?: string): string {
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

  private async getTabDocumentReadyState(tabId: number): Promise<string | null> {
    try {
      const [{ result }] = await Promise.race([
        chrome.scripting.executeScript({
          target: { tabId },
          func: () => document.readyState,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `document.readyState probe timed out after ${DOCUMENT_READY_STATE_TIMEOUT_MS}ms`,
                ),
              ),
            DOCUMENT_READY_STATE_TIMEOUT_MS,
          ),
        ),
      ]);
      return typeof result === 'string' ? result : null;
    } catch {
      return null;
    }
  }

  protected async waitForTabSettled(
    tabId: number,
    options: WaitForTabSettledOptions = {},
  ): Promise<WaitForTabSettledResult> {
    const timeoutMs = options.timeoutMs ?? TAB_SETTLE_TIMEOUT_MS;
    const previousUrl = this.normalizeComparableUrl(options.previousUrl);
    const requireUrlChange = options.requireUrlChange === true;
    const startedAt = Date.now();

    const buildState = async (
      tab: chrome.tabs.Tab,
      reason: WaitForTabSettledResult['reason'],
      timedOut: boolean,
    ): Promise<WaitForTabSettledResult> => ({
      tab,
      settled: !timedOut && reason !== 'tab_missing',
      timedOut,
      reason,
      waitedMs: Date.now() - startedAt,
      readyState: await this.getTabDocumentReadyState(tabId),
    });

    const isSettledTab = async (
      tab: chrome.tabs.Tab,
    ): Promise<WaitForTabSettledResult['reason'] | null> => {
      const currentUrl = this.normalizeComparableUrl(tab.url || tab.pendingUrl);
      const urlChanged = !requireUrlChange || !previousUrl || currentUrl !== previousUrl;
      if (tab.status === 'complete' && urlChanged) {
        return previousUrl && requireUrlChange ? 'complete_after_url_change' : 'complete';
      }
      if (urlChanged && currentUrl && currentUrl !== 'about:blank') {
        const readyState = await this.getTabDocumentReadyState(tabId);
        if (readyState === 'interactive' || readyState === 'complete') {
          return 'interactive';
        }
      }
      return null;
    };

    let currentTab: chrome.tabs.Tab;
    try {
      currentTab = await chrome.tabs.get(tabId);
    } catch {
      return {
        tab: { id: tabId } as chrome.tabs.Tab,
        settled: false,
        timedOut: true,
        reason: 'tab_missing',
        waitedMs: Date.now() - startedAt,
        readyState: null,
      };
    }

    const initialReason = await isSettledTab(currentTab);
    if (initialReason) {
      const reason =
        initialReason === 'complete' && !(previousUrl && requireUrlChange)
          ? 'already_complete'
          : initialReason;
      return buildState(currentTab, reason, false);
    }

    return await new Promise<WaitForTabSettledResult>((resolve) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let finished = false;

      const cleanup = () => {
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const finish = async (
        reason: WaitForTabSettledResult['reason'],
        timedOut: boolean,
        updatedTab?: chrome.tabs.Tab,
      ) => {
        if (finished) return;
        finished = true;
        cleanup();
        let finalTab = updatedTab;
        if (!finalTab) {
          try {
            finalTab = await chrome.tabs.get(tabId);
          } catch {
            resolve({
              tab: { id: tabId } as chrome.tabs.Tab,
              settled: false,
              timedOut: true,
              reason: 'tab_missing',
              waitedMs: Date.now() - startedAt,
              readyState: null,
            });
            return;
          }
        }
        resolve(await buildState(finalTab, reason, timedOut));
      };

      const handleUpdated = (
        updatedTabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        updatedTab: chrome.tabs.Tab,
      ) => {
        if (updatedTabId !== tabId) return;
        void (async () => {
          const reason = await isSettledTab(updatedTab);
          if (reason || changeInfo.status === 'complete') {
            await finish(reason || 'complete', false, updatedTab);
          }
        })();
      };

      chrome.tabs.onUpdated.addListener(handleUpdated);
      timeoutHandle = setTimeout(() => {
        void finish('timeout', true);
      }, timeoutMs);
    });
  }

  protected async waitForTabActivated(
    tabId: number,
    options: WaitForTabActivatedOptions = {},
  ): Promise<WaitForTabActivatedResult> {
    const timeoutMs = options.timeoutMs ?? TAB_ACTIVATION_TIMEOUT_MS;
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        let windowFocused: boolean | null = null;
        if (typeof tab.windowId === 'number') {
          try {
            const windowState = await chrome.windows.get(tab.windowId);
            windowFocused = typeof windowState.focused === 'boolean' ? windowState.focused : null;
          } catch {
            windowFocused = null;
          }
        }
        const windowMatches =
          typeof options.expectedWindowId !== 'number' || tab.windowId === options.expectedWindowId;
        const focusOk = options.requireFocusedWindow === true ? windowFocused === true : true;

        if (tab.active === true && windowMatches && focusOk) {
          return {
            tab,
            activated: true,
            timedOut: false,
            waitedMs: Date.now() - startedAt,
            windowFocused,
          };
        }
      } catch {
        break;
      }

      await this.sleep(TAB_POLL_INTERVAL_MS);
    }

    const tab = await chrome.tabs.get(tabId);
    let windowFocused: boolean | null = null;
    if (typeof tab.windowId === 'number') {
      try {
        const windowState = await chrome.windows.get(tab.windowId);
        windowFocused = typeof windowState.focused === 'boolean' ? windowState.focused : null;
      } catch {
        windowFocused = null;
      }
    }

    return {
      tab,
      activated: tab.active === true,
      timedOut: true,
      waitedMs: Date.now() - startedAt,
      windowFocused,
    };
  }

  /**
   * Get the active tab. When windowId provided, search within that window; otherwise currentWindow.
   */
  protected async getActiveTabInWindow(windowId?: number): Promise<chrome.tabs.Tab | null> {
    if (typeof windowId === 'number') {
      const tabs = await chrome.tabs.query({ active: true, windowId });
      return tabs && tabs[0] ? tabs[0] : null;
    }
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  /**
   * Same as getActiveTabInWindow, but throws if not found.
   */
  protected async getActiveTabOrThrowInWindow(windowId?: number): Promise<chrome.tabs.Tab> {
    const tab = await this.getActiveTabInWindow(windowId);
    if (!tab || !tab.id) throw new Error('Active tab not found');
    return tab;
  }

  /**
   * Chrome blocks script injection on browser-internal and web-store style pages.
   */
  protected isRestrictedUrl(url?: string): boolean {
    if (!url) return true;

    return (
      url.startsWith('chrome://') ||
      url.startsWith('chrome-error://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('devtools://') ||
      url.startsWith('view-source:') ||
      url.startsWith('file://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('https://chrome.google.com/webstore') ||
      url.startsWith('https://microsoftedge.microsoft.com/')
    );
  }
}
