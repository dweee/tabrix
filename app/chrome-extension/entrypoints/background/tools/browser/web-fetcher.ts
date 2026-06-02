import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { markBrowserWorldTabAiCreated } from '../../browser-world-inventory';

interface WebFetcherToolParams {
  htmlContent?: boolean; // get the visible HTML content of the current page. default: false
  textContent?: boolean; // get the visible text content of the current page. default: true
  textMode?: 'body' | 'full-visible'; // body uses article extraction; full-visible uses page-level visible text
  url?: string; // optional URL to fetch content from (if not provided, uses active tab)
  selector?: string; // optional CSS selector to get content from a specific element
  tabId?: number; // target existing tab id
  background?: boolean; // do not activate/focus
  windowId?: number; // target window id to pick active tab or create tab
  settleTimeoutMs?: number; // optional new-tab settle timeout before extraction
}

const WEB_FETCHER_CONTENT_MESSAGE_TIMEOUT_MS = 15_000;
const WEB_FETCHER_CONTENT_MESSAGE_RETRY_DELAY_MS = 1_000;
const WEB_FETCHER_CREATE_TAB_TIMEOUT_MS = 5_000;
const WEB_FETCHER_CREATE_TAB_RECOVERY_DELAY_MS = 250;
const WEB_FETCHER_DEFAULT_SETTLE_TIMEOUT_MS = 5_000;
const WEB_FETCHER_URL_CONTENT_SETTLE_TIMEOUT_MS = 30_000;
const WEB_FETCHER_EMPTY_TEXT_RETRY_DELAY_MS = 1_000;
const WEB_FETCHER_EMPTY_TEXT_MAX_RETRIES = 5;

function normalizeSettleTimeoutMs(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    return WEB_FETCHER_DEFAULT_SETTLE_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(value), 1_000), 60_000);
}

function normalizeUrlContentSettleTimeoutMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return normalizeSettleTimeoutMs(value);
  }
  return WEB_FETCHER_URL_CONTENT_SETTLE_TIMEOUT_MS;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function summarizeVisibleText(text: string) {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  const lineCount = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
  const charCount = (text || '').length;
  const normalizedLength = normalized.length;
  const contentSparse = normalizedLength < 80;
  const structureSparse = lineCount < 3;
  const completeTextAvailable = normalizedLength >= 500;
  const sparse = contentSparse || (structureSparse && !completeTextAvailable);
  const quality = sparse ? 'sparse' : structureSparse ? 'complete_text_sparse_structure' : 'usable';

  return {
    charCount,
    normalizedLength,
    lineCount,
    structureSparse,
    contentSparse,
    completeTextAvailable,
    sparse,
    quality,
    warning: contentSparse
      ? 'Visible text is sparse. Prefer chrome_read_page for structured UI extraction before escalating to higher-risk tools.'
      : structureSparse && completeTextAvailable
        ? 'Visible text appears complete but structurally sparse. Prefer chrome_read_page when you need UI regions or target refs.'
        : structureSparse
          ? 'Visible text has limited structure and may be incomplete. Prefer chrome_read_page or htmlContent when completeness matters.'
          : null,
  };
}

function buildLongContentCoverageGate(text: string, textMode: 'body' | 'full-visible') {
  const lines = (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  const headingLikeLines = lines.filter(isLongContentHeadingLine);
  const sectionMarkers = Array.from(
    new Set(normalized.match(/\b(?:section|chapter|part|step|heading)\s+\d+[\s:.-]/gi) ?? []),
  );
  const markerTokens = extractLongContentMarkerTokens(normalized);
  const tailWindow = normalized.slice(Math.max(0, normalized.length - 800));
  const tailMarkerTokens = markerTokens.filter((token) => tailWindow.includes(token));
  const hasTailCoverage =
    tailMarkerTokens.length > 0 ||
    /\b(final|closing|conclusion|summary|end)\b/i.test(tailWindow) ||
    /尾段|结尾|结束|总结/.test(tailWindow);
  const structureEvidenceCount = Math.max(headingLikeLines.length, sectionMarkers.length);
  const structureCovered = structureEvidenceCount >= 6;
  const markerCovered = markerTokens.length >= 3;
  const coverageEvidencePresent =
    normalized.length >= 2400 || lines.length >= 12 || structureCovered || markerTokens.length >= 6;
  const verdict =
    textMode !== 'full-visible'
      ? 'mode_insufficient'
      : !coverageEvidencePresent
        ? 'not_applicable'
        : structureCovered && markerCovered && hasTailCoverage
          ? 'complete'
          : structureCovered || markerCovered
            ? 'coverage_insufficient'
            : 'structure_sparse';

  return {
    gateId: 'long-content-coverage-gate:web_content_text',
    verdict,
    metrics: {
      textMode,
      charCount: (text || '').length,
      normalizedLength: normalized.length,
      lineCount: lines.length,
      headingLikeLineCount: headingLikeLines.length,
      sectionMarkerCount: sectionMarkers.length,
      structureEvidenceCount,
      markerTokenCount: markerTokens.length,
      tailMarkerTokenCount: tailMarkerTokens.length,
      tailCoveragePresent: hasTailCoverage,
      coverageEvidencePresent,
    },
    evidence: {
      headingLikeLines: headingLikeLines.slice(0, 12),
      sectionMarkers: sectionMarkers.slice(0, 12),
      markerTokens: markerTokens.slice(0, 24),
      tailMarkerTokens: tailMarkerTokens.slice(0, 12),
    },
    recommendedAction:
      verdict === 'complete'
        ? null
        : textMode !== 'full-visible'
          ? 'retry chrome_get_web_content with textMode=full-visible'
          : 'collect stronger full-text structure, marker, or tail coverage before claiming complete',
    boundary: {
      metadataOnly: true,
      rawContentPersisted: false,
      llmUsed: false,
      genericHeuristic: true,
      siteSpecificRules: false,
    },
  };
}

function isLongContentHeadingLine(line: string): boolean {
  return (
    /^(section|chapter|part|step|heading)\s+\d+[\s:.-]/i.test(line) ||
    /^\d+(?:\.\d+)*[\s.:-]+[A-Z][\w\s-]{8,}$/.test(line) ||
    /^#{1,6}\s+\S+/.test(line)
  );
}

function extractLongContentMarkerTokens(text: string): string[] {
  const markerLikeTokens = new Set<string>();
  for (const match of text.match(/[A-Z][A-Z0-9]+(?:-[A-Z0-9]+){1,}/g) ?? []) {
    markerLikeTokens.add(match);
  }
  for (const match of text.match(/\b(?:sentinel|marker)[-\s]+[a-z0-9-]+/gi) ?? []) {
    const normalized = match.trim().replace(/\s+/g, '-').toUpperCase();
    const markerSuffix = normalized.replace(/^(?:SENTINEL|MARKER)-/, '');
    if (
      /[A-Z0-9]+-[A-Z0-9-]+/.test(normalized) &&
      !/^(?:SENTINEL|MARKER|SECTION|COVERAGE|FINAL)-/.test(markerSuffix)
    ) {
      markerLikeTokens.add(normalized);
    }
  }
  for (const match of text.match(/\bfinal[-\s]+coverage[-\s]+check\b/gi) ?? []) {
    markerLikeTokens.add(match.trim().replace(/\s+/g, '-').toUpperCase());
  }
  return Array.from(markerLikeTokens);
}

function getTabUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return tab.url || tab.pendingUrl || '';
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

async function findCreatedTabAfterTimeout(input: {
  url: string;
  windowId?: number;
  existingTabIds: ReadonlySet<number>;
}): Promise<chrome.tabs.Tab | null> {
  await delay(WEB_FETCHER_CREATE_TAB_RECOVERY_DELAY_MS);
  const targetUrl = normalizeComparableUrl(input.url);
  const tabs =
    typeof input.windowId === 'number'
      ? await chrome.tabs.query({ windowId: input.windowId })
      : await chrome.tabs.query({});
  return (
    tabs.find((tab) => {
      if (typeof tab.id !== 'number' || input.existingTabIds.has(tab.id)) return false;
      const tabUrl = normalizeComparableUrl(getTabUrl(tab));
      return tabUrl === targetUrl;
    }) || null
  );
}

class WebFetcherTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.WEB_FETCHER;

  private shouldRetryEmptyTextResponse(response: any): boolean {
    return (
      response?.success === true &&
      typeof response.textContent === 'string' &&
      response.textContent.trim().length === 0
    );
  }

  private async sendContentRequestWithRetry(
    tabId: number,
    message: unknown,
  ): Promise<{
    response: any;
    attempts: number;
    timedOut: boolean;
  }> {
    let firstError: unknown = null;
    try {
      return {
        response: await withTimeout(
          this.sendMessageToTab(tabId, message),
          WEB_FETCHER_CONTENT_MESSAGE_TIMEOUT_MS,
          `Web fetcher content request timed out after ${WEB_FETCHER_CONTENT_MESSAGE_TIMEOUT_MS}ms`,
        ),
        attempts: 1,
        timedOut: false,
      };
    } catch (error) {
      firstError = error;
    }

    await delay(WEB_FETCHER_CONTENT_MESSAGE_RETRY_DELAY_MS);
    await this.injectContentScript(tabId, ['inject-scripts/web-fetcher-helper.js']);

    try {
      return {
        response: await withTimeout(
          this.sendMessageToTab(tabId, message),
          WEB_FETCHER_CONTENT_MESSAGE_TIMEOUT_MS,
          `Web fetcher content request retry timed out after ${WEB_FETCHER_CONTENT_MESSAGE_TIMEOUT_MS}ms`,
        ),
        attempts: 2,
        timedOut: firstError instanceof Error && /timed out/i.test(firstError.message),
      };
    } catch (secondError) {
      throw new Error(
        `Web fetcher content request failed after retry: ${
          secondError instanceof Error ? secondError.message : String(secondError)
        }`,
      );
    }
  }

  private async sendTextRequestWithDynamicContentRetry(
    tabId: number,
    message: unknown,
    options: { retryEmptyContent: boolean },
  ): Promise<{
    response: any;
    attempts: number;
    timedOut: boolean;
    emptyContentRetries: number;
  }> {
    let request = await this.sendContentRequestWithRetry(tabId, message);
    let emptyContentRetries = 0;

    while (
      options.retryEmptyContent &&
      emptyContentRetries < WEB_FETCHER_EMPTY_TEXT_MAX_RETRIES &&
      this.shouldRetryEmptyTextResponse(request.response)
    ) {
      emptyContentRetries += 1;
      await delay(WEB_FETCHER_EMPTY_TEXT_RETRY_DELAY_MS);
      const nextRequest = await this.sendContentRequestWithRetry(tabId, message);
      request = {
        response: nextRequest.response,
        attempts: request.attempts + nextRequest.attempts,
        timedOut: request.timedOut || nextRequest.timedOut,
      };
    }

    return {
      ...request,
      emptyContentRetries,
    };
  }

  /**
   * Execute web fetcher operation
   */
  async execute(args: WebFetcherToolParams): Promise<ToolResult> {
    const operationStartedAt = Date.now();
    const phaseTimings: Record<string, number> = {};
    const recordPhaseTiming = (key: string, startedAt: number) => {
      phaseTimings[key] = Date.now() - startedAt;
    };

    // Handle mutually exclusive parameters: if htmlContent is true, textContent is forced to false
    const htmlContent = args.htmlContent === true;
    const textContent = htmlContent ? false : args.textContent !== false; // Default is true, unless htmlContent is true or textContent is explicitly set to false
    const textMode = args.textMode === 'full-visible' ? 'full-visible' : 'body';
    const url = args.url;
    const selector = args.selector;
    const explicitTabId = args.tabId;
    const background = args.background === true;
    const windowId = args.windowId;
    const settleTimeoutMs = url
      ? normalizeUrlContentSettleTimeoutMs(args.settleTimeoutMs)
      : normalizeSettleTimeoutMs(args.settleTimeoutMs);

    console.log(`Starting web fetcher with options:`, {
      htmlContent,
      textContent,
      textMode,
      url,
      selector,
    });

    try {
      // Get tab to fetch content from
      let tab;
      let createdTabForUrl = false;
      let createTimedOutRecovered = false;
      let settleMetadata: {
        settled: boolean;
        timedOut: boolean;
        reason: string;
        waitedMs: number;
        readyState: string | null;
      } | null = null;

      const resolveTabStartedAt = Date.now();
      if (typeof explicitTabId === 'number') {
        tab = await chrome.tabs.get(explicitTabId);
      } else if (url) {
        // If URL is provided, check if it's already open
        console.log(`Checking if URL is already open: ${url}`);
        const allTabs = await chrome.tabs.query({});

        // Find tab with matching URL
        const matchingTabs = allTabs.filter((t) => {
          // Normalize URLs for comparison (remove trailing slashes)
          const tabUrl = t.url?.endsWith('/') ? t.url.slice(0, -1) : t.url;
          const targetUrl = url.endsWith('/') ? url.slice(0, -1) : url;
          return tabUrl === targetUrl;
        });

        if (matchingTabs.length > 0) {
          // Use existing tab
          tab = matchingTabs[0];
          console.log(`Found existing tab with URL: ${url}, tab ID: ${tab.id}`);
        } else {
          // Create new tab with the URL
          console.log(`No existing tab found with URL: ${url}, creating new tab`);
          const existingTabIds = new Set(
            allTabs
              .map((existingTab) => existingTab.id)
              .filter((id): id is number => typeof id === 'number'),
          );
          try {
            tab = await withTimeout(
              chrome.tabs.create({
                url,
                active: background ? false : true,
                ...(typeof windowId === 'number' ? { windowId } : {}),
              }),
              WEB_FETCHER_CREATE_TAB_TIMEOUT_MS,
              `Web fetcher tab creation timed out after ${WEB_FETCHER_CREATE_TAB_TIMEOUT_MS}ms`,
            );
            markBrowserWorldTabAiCreated(tab.id);
          } catch (createError) {
            const recoveredTab = await findCreatedTabAfterTimeout({
              url,
              windowId,
              existingTabIds,
            });
            if (!recoveredTab) {
              throw createError;
            }
            tab = recoveredTab;
            markBrowserWorldTabAiCreated(tab.id);
            createTimedOutRecovered = true;
          }
          createdTabForUrl = true;

          if (tab.id) {
            console.log('Waiting for newly opened tab to settle...');
            const settleResult = await this.waitForTabSettled(tab.id, {
              timeoutMs: settleTimeoutMs,
            });
            tab = settleResult.tab;
            settleMetadata = {
              settled: settleResult.settled,
              timedOut: settleResult.timedOut,
              reason: settleResult.reason,
              waitedMs: settleResult.waitedMs,
              readyState: settleResult.readyState,
            };
          }
        }
      } else {
        // Use active tab (prefer specified window)
        const tabs =
          typeof windowId === 'number'
            ? await chrome.tabs.query({ active: true, windowId })
            : await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tabs[0]) {
          return createErrorResponse('No active tab found');
        }
        tab = tabs[0];
      }
      recordPhaseTiming('resolveTabMs', resolveTabStartedAt);

      if (!tab.id) {
        return createErrorResponse('Tab has no ID');
      }

      // Optionally bring tab/window to foreground
      if (!background) {
        const focusStartedAt = Date.now();
        await this.ensureFocus(tab, {
          activate: true,
          focusWindow: true,
        });
        recordPhaseTiming('focusMs', focusStartedAt);
      }

      // Prepare result object
      const result: any = {
        success: true,
        tabId: tab.id,
        windowId: tab.windowId,
        url: tab.url,
        title: tab.title,
        createdTabForUrl,
        createTimedOutRecovered,
      };
      if (settleMetadata) {
        result.settle = settleMetadata;
      }

      let injectTiming: unknown = null;
      const injectStartedAt = Date.now();
      await this.injectContentScript(
        tab.id,
        ['inject-scripts/web-fetcher-helper.js'],
        false,
        'ISOLATED',
        false,
        undefined,
        (timing) => {
          injectTiming = timing;
        },
      );
      recordPhaseTiming('injectContentScriptMs', injectStartedAt);
      if (injectTiming) {
        result.contentScriptInjection = injectTiming;
      }

      // Get HTML content if requested
      if (htmlContent) {
        const htmlRequestStartedAt = Date.now();
        const htmlRequest = await this.sendContentRequestWithRetry(tab.id, {
          action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_HTML_CONTENT,
          selector: selector,
        });
        recordPhaseTiming('htmlContentRequestMs', htmlRequestStartedAt);
        const htmlResponse = htmlRequest.response;
        result.htmlContentRequest = {
          attempts: htmlRequest.attempts,
          timedOutBeforeRetry: htmlRequest.timedOut,
        };

        if (htmlResponse.success) {
          result.htmlContent = htmlResponse.htmlContent;
          if (typeof htmlResponse.htmlTextContent === 'string') {
            result.htmlTextContent = htmlResponse.htmlTextContent;
            result.htmlTextSummary = summarizeVisibleText(htmlResponse.htmlTextContent);
            result.htmlTextContentSource =
              htmlResponse.htmlTextContentSource || 'cleaned_html_textContent';
          }
        } else {
          console.error('Failed to get HTML content:', htmlResponse.error);
          result.htmlContentError = htmlResponse.error;
        }
      }

      // Get text content if requested (and htmlContent is not true)
      if (textContent) {
        const textRequestStartedAt = Date.now();
        const textRequest = await this.sendTextRequestWithDynamicContentRetry(
          tab.id,
          {
            action: TOOL_MESSAGE_TYPES.WEB_FETCHER_GET_TEXT_CONTENT,
            selector: selector,
            textMode,
          },
          {
            retryEmptyContent: createdTabForUrl && !selector,
          },
        );
        recordPhaseTiming('textContentRequestMs', textRequestStartedAt);
        const textResponse = textRequest.response;
        result.textContentRequest = {
          attempts: textRequest.attempts,
          timedOutBeforeRetry: textRequest.timedOut,
          emptyContentRetries: textRequest.emptyContentRetries,
        };

        if (textResponse.success) {
          result.textContent = textResponse.textContent;
          result.textMode = textResponse.textMode || textMode;
          result.textContentSource = textResponse.textContentSource || 'readability_body_text';
          result.textSummary = summarizeVisibleText(textResponse.textContent || '');
          result.longContentCoverageGate = buildLongContentCoverageGate(
            textResponse.textContent || '',
            result.textMode,
          );
          if (textResponse.contentDiagnostics) {
            result.contentDiagnostics = textResponse.contentDiagnostics;
          }

          // Include article metadata if available
          if (textResponse.article) {
            result.article = {
              title: textResponse.article.title,
              byline: textResponse.article.byline,
              siteName: textResponse.article.siteName,
              excerpt: textResponse.article.excerpt,
              lang: textResponse.article.lang,
            };
          }

          // Include page metadata if available
          if (textResponse.metadata) {
            result.metadata = textResponse.metadata;
          }

          if (result.textSummary.contentSparse) {
            result.extractionHint =
              'Visible text is sparse for this route. Prefer chrome_read_page to inspect structured UI before using javascript or coordinate-based fallbacks.';
          } else if (
            result.textSummary.structureSparse &&
            result.textSummary.completeTextAvailable
          ) {
            result.extractionHint =
              'Visible text appears complete but structurally sparse for this route. Use chrome_read_page only when structured UI regions or target refs are needed.';
          } else if (result.textSummary.structureSparse) {
            result.extractionHint =
              'Visible text has limited structure and may be incomplete for this route. Use chrome_read_page or htmlContent when completeness matters.';
          }
        } else {
          console.error('Failed to get text content:', textResponse.error);
          result.textContentError = textResponse.error;
        }
      }

      try {
        const refreshMetadataStartedAt = Date.now();
        const latestTab = await chrome.tabs.get(tab.id);
        result.url = latestTab.url || result.url;
        result.title = latestTab.title || result.title;
        recordPhaseTiming('refreshTabMetadataMs', refreshMetadataStartedAt);
      } catch {
        // The user may close the tab after extraction; keep the metadata already captured.
      }

      result.timing = {
        ...phaseTimings,
        totalMs: Date.now() - operationStartedAt,
      };

      // Interactive elements feature has been removed

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in web fetcher:', error);
      const classified = this.classifyContentScriptError(error);
      if (classified) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                reason: classified.reason,
                pageType: 'browser_error_page',
                recommendedAction: classified.recommendedAction,
                error: classified.message,
                nextStepHint:
                  'page_unreadable; return BLOCKED or retry navigation before attempting content extraction',
              }),
            },
          ],
          isError: false,
        };
      }
      return createErrorResponse(
        `Error fetching web content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const webFetcherTool = new WebFetcherTool();

interface GetInteractiveElementsToolParams {
  textQuery?: string; // Text to search for within interactive elements (fuzzy search)
  query?: string; // Backward-compatible alias for textQuery
  selector?: string; // CSS selector to filter interactive elements
  includeCoordinates?: boolean; // Include element coordinates in the response (default: true)
  types?: string[]; // Types of interactive elements to include (default: all types)
  tabId?: number;
  windowId?: number;
}

class GetInteractiveElementsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS;

  /**
   * Execute get interactive elements operation
   */
  async execute(args: GetInteractiveElementsToolParams): Promise<ToolResult> {
    const { selector, includeCoordinates = true, types, tabId, windowId } = args;
    const textQuery = args.textQuery ?? args.query;

    console.log(`Starting get interactive elements with options:`, args);

    try {
      const explicit = await this.tryGetTab(tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(windowId));
      if (!tab.id) {
        return createErrorResponse('Target tab has no ID');
      }

      // Ensure content script is injected
      await this.injectContentScript(tab.id, ['inject-scripts/interactive-elements-helper.js']);

      // Send message to content script
      const result = await this.sendMessageToTab(tab.id, {
        action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
        textQuery,
        selector,
        includeCoordinates,
        types,
      });

      if (!result.success) {
        return createErrorResponse(result.error || 'Failed to get interactive elements');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              elements: result.elements,
              count: result.elements.length,
              query: {
                textQuery,
                selector,
                types: types || 'all',
              },
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in get interactive elements operation:', error);
      return createErrorResponse(
        `Error getting interactive elements: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const getInteractiveElementsTool = new GetInteractiveElementsTool();
