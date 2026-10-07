import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES, type ReadPageCandidateAction } from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { markBrowserWorldTabAiOperated } from '../../browser-world-inventory';
import {
  hydrateStableTargetRefRegistryFromStorage,
  lookupCandidateActionTargetLocatorEntry,
} from './stable-target-ref-registry';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

const TABRIX_OWNED_LANE = 'tabrix_owned';
const TABRIX_CDP_SNAPSHOT_LOCATOR_LANE = 'tabrix_cdp_snapshot_locator';

interface KeyboardToolParams {
  keys?: string; // Required: string representing keys or key combinations to simulate (e.g., "Enter", "Ctrl+C")
  key?: string; // Backwards-compatible alias for a single key.
  ref?: string; // Element ref from the latest read_page snapshot.
  candidateAction?: ReadPageCandidateAction; // Candidate action returned by read_page.
  selector?: string; // Optional: CSS selector or XPath for target element to send keyboard events to
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  delay?: number; // Optional: delay between keystrokes in milliseconds
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  frameId?: number; // target frame id for iframe support
}

function firstCandidateCssLocator(
  candidateAction: ReadPageCandidateAction | undefined,
): string | undefined {
  const css = candidateAction?.locatorChain?.find(
    (locator) =>
      String(locator?.type || '').toLowerCase() === 'css' &&
      typeof locator.value === 'string' &&
      locator.value.trim(),
  )?.value;
  return typeof css === 'string' ? css.trim() : undefined;
}

function isSubmitKeySequence(keys: string): boolean {
  return keys
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.split('+').some((token) => token.trim() === 'enter'));
}

function isCurrentSnapshotEnterTarget(params: {
  tabId: number;
  keys: string;
  candidateAction: ReadPageCandidateAction | undefined;
  candidateCssSelector: string | undefined;
  explicitSelector: string | undefined;
  selectorType: 'css' | 'xpath';
  frameId: number | undefined;
}): boolean {
  if (params.keys.trim().toLowerCase() !== 'enter') return false;
  if (params.explicitSelector || params.selectorType !== 'css') return false;
  if (params.frameId !== undefined && params.frameId !== 0) return false;
  const targetRef = params.candidateAction?.targetRef?.trim();
  if (!targetRef || !params.candidateCssSelector) return false;
  const currentLocator = lookupCandidateActionTargetLocatorEntry(params.tabId, targetRef);
  if (!currentLocator || currentLocator.selector !== params.candidateCssSelector) return false;
  if ((currentLocator.selectorType ?? 'css') !== 'css') return false;
  return currentLocator.frameId === undefined || currentLocator.frameId === 0;
}

interface CdpKeyboardDispatchResult {
  success: true;
  message: string;
  targetElement: {
    tagName?: string;
    type?: string;
    focused: true;
  };
}

async function dispatchEnterToCurrentSnapshotLocatorWithCdp(
  tabId: number,
  selector: string,
): Promise<CdpKeyboardDispatchResult> {
  return await cdpSessionManager.withSession(
    tabId,
    'keyboard-current-snapshot-locator',
    async () => {
      const documentResult = await cdpSessionManager.sendCommand<{
        root?: { nodeId?: number };
      }>(tabId, 'DOM.getDocument', { depth: -1, pierce: true });
      const rootNodeId = documentResult?.root?.nodeId;
      if (typeof rootNodeId !== 'number') {
        throw new Error('CDP snapshot keyboard target could not resolve the current document');
      }

      const queryResult = await cdpSessionManager.sendCommand<{ nodeIds?: number[] }>(
        tabId,
        'DOM.querySelectorAll',
        {
          nodeId: rootNodeId,
          selector,
        },
      );
      const nodeIds = Array.isArray(queryResult?.nodeIds)
        ? queryResult.nodeIds.filter((nodeId) => Number.isFinite(nodeId))
        : [];
      if (nodeIds.length !== 1) {
        throw new Error(
          nodeIds.length === 0
            ? 'CDP snapshot keyboard target is no longer present'
            : 'CDP snapshot keyboard selector is ambiguous in the current document',
        );
      }

      const resolvedNode = await cdpSessionManager.sendCommand<{
        object?: { objectId?: string };
      }>(tabId, 'DOM.resolveNode', { nodeId: nodeIds[0] });
      const objectId = resolvedNode?.object?.objectId;
      if (!objectId) {
        throw new Error('CDP snapshot keyboard target could not bind the current DOM object');
      }

      const focusResult = await cdpSessionManager.sendCommand<{
        result?: {
          value?: {
            success?: boolean;
            error?: string;
            tagName?: string;
            type?: string;
            focused?: boolean;
          };
        };
        exceptionDetails?: unknown;
      }>(tabId, 'Runtime.callFunctionOn', {
        objectId,
        functionDeclaration: `function() {
          const element = this;
          if (!element || !element.isConnected || typeof element.focus !== 'function') {
            return { success: false, error: 'target_not_focusable' };
          }
          if (element.disabled === true) {
            return { success: false, error: 'target_disabled' };
          }
          const rect = element.getBoundingClientRect();
          const style = globalThis.getComputedStyle(element);
          const visible = rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden' &&
            Number(style.opacity || 1) > 0;
          if (!visible) return { success: false, error: 'target_not_visible' };
          element.focus({ preventScroll: true });
          const active = element.ownerDocument && element.ownerDocument.activeElement;
          const focused = active === element || Boolean(element.contains && element.contains(active));
          return {
            success: focused,
            error: focused ? undefined : 'target_focus_not_confirmed',
            tagName: String(element.tagName || '').toUpperCase(),
            type: String(element.type || '').toLowerCase(),
            focused
          };
        }`,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      });
      if (focusResult?.exceptionDetails) {
        throw new Error('CDP snapshot keyboard focus raised a page execution exception');
      }
      const focusedTarget = focusResult?.result?.value;
      if (!focusedTarget?.success || !focusedTarget.focused) {
        throw new Error(
          focusedTarget?.error || 'CDP snapshot keyboard target focus was not confirmed',
        );
      }

      await cdpSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });
      await cdpSessionManager.sendCommand(tabId, 'Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
      });

      return {
        success: true,
        message: 'Keyboard operation dispatched through current CDP snapshot locator',
        targetElement: {
          tagName: focusedTarget.tagName,
          type: focusedTarget.type,
          focused: true,
        },
      };
    },
  );
}

/**
 * Tool for simulating keyboard input on web pages
 */
class KeyboardTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.KEYBOARD;

  /**
   * Execute keyboard operation
   */
  async execute(args: KeyboardToolParams): Promise<ToolResult> {
    const {
      keys: rawKeys,
      key,
      ref,
      candidateAction,
      selector,
      selectorType = 'css',
      delay = TIMEOUTS.KEYBOARD_DELAY,
    } = args;
    const keys = rawKeys || key;

    console.log(`Starting keyboard operation with options:`, args);

    if (!keys) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': Keys parameter must be provided',
      );
    }

    const targetRef =
      typeof ref === 'string' && ref.trim()
        ? ref.trim()
        : typeof candidateAction?.targetRef === 'string' && candidateAction.targetRef.trim()
          ? candidateAction.targetRef.trim()
          : undefined;
    const candidateCssSelector = firstCandidateCssLocator(candidateAction);
    const submitLikeKey = isSubmitKeySequence(keys);

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }

      await hydrateStableTargetRefRegistryFromStorage(tab.id);
      let finalSelector = selector || candidateCssSelector;
      let refForFocus: string | undefined = finalSelector ? undefined : targetRef;
      let executionLane = TABRIX_OWNED_LANE;
      let result: any;

      if (submitLikeKey && !finalSelector && !refForFocus) {
        return createErrorResponse(
          'Refusing to send Enter without a target. Pass the latest read_page search input candidateAction, target ref, or selector so Tabrix does not submit against BODY/HTML focus.',
        );
      }

      const useCurrentSnapshotCdpTarget = isCurrentSnapshotEnterTarget({
        tabId: tab.id,
        keys,
        candidateAction,
        candidateCssSelector,
        explicitSelector: selector,
        selectorType,
        frameId: args.frameId,
      });

      if (useCurrentSnapshotCdpTarget && candidateCssSelector) {
        result = await dispatchEnterToCurrentSnapshotLocatorWithCdp(tab.id, candidateCssSelector);
        executionLane = TABRIX_CDP_SNAPSHOT_LOCATOR_LANE;
      } else {
        // Ensure helper is loaded for XPath or potential focus operations
        await this.injectContentScript(tab.id, ['inject-scripts/accessibility-tree-helper.js']);

        // If selector is XPath, convert to ref then try to get CSS selector
        if (selector && selectorType === 'xpath') {
          try {
            // First convert XPath to ref
            const ensured = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector,
              isXPath: true,
            });
            if (!ensured || !ensured.success || !ensured.ref) {
              return createErrorResponse(
                `Failed to resolve XPath selector: ${ensured?.error || 'unknown error'}`,
              );
            }
            refForFocus = ensured.ref;
            // Try to resolve ref to CSS selector
            const resolved = await this.sendMessageToTab(tab.id, {
              action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
              ref: ensured.ref,
            });
            if (resolved && resolved.success && resolved.selector) {
              finalSelector = resolved.selector;
              refForFocus = undefined; // Prefer CSS selector if available
            }
            // If no CSS selector available, we'll use ref to focus below
          } catch (error) {
            return createErrorResponse(
              `Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }

        // If we have a ref but no CSS selector, focus the element via helper
        if (refForFocus) {
          const focusResult = await this.sendMessageToTab(tab.id, {
            action: 'focusByRef',
            ref: refForFocus,
          });
          if (focusResult && !focusResult.success) {
            return createErrorResponse(
              `Failed to focus element by ref: ${focusResult.error || 'unknown error'}`,
            );
          }
          // Clear selector so keyboard events go to the focused element
          finalSelector = undefined;
        }

        const frameIds = typeof args.frameId === 'number' ? [args.frameId] : undefined;
        await this.injectContentScript(
          tab.id,
          ['inject-scripts/keyboard-helper.js'],
          false,
          'ISOLATED',
          false,
          frameIds,
        );

        // Send keyboard simulation message to content script
        result = await this.sendMessageToTab(
          tab.id,
          {
            action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
            keys,
            selector: finalSelector,
            ref: finalSelector ? undefined : targetRef,
            delay,
          },
          args.frameId,
        );
      }

      if (result.error) {
        return createErrorResponse(result.error);
      }
      markBrowserWorldTabAiOperated(tab.id, 'keyboard');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: result.message || 'Keyboard operation successful',
              executionLane,
              ...(executionLane === TABRIX_CDP_SNAPSHOT_LOCATOR_LANE
                ? {
                    targetBinding: {
                      targetRef: targetRef ?? null,
                      selector: candidateCssSelector,
                      resolutionSource: 'candidate_snapshot_locator_css',
                    },
                  }
                : {}),
              targetElement: result.targetElement,
              results: result.results,
              scrollDiagnostics: result.targetElement?.scrollDiagnostics,
              observedOutcome: null,
              postconditionVerdict: 'unknown',
              postconditionReason: submitLikeKey
                ? 'form_submit_or_search_results_not_proven_by_tool_closeout'
                : 'keyboard_postcondition_not_observed_by_tool_closeout',
              recommendedNextAction: submitLikeKey
                ? 'Call chrome_read_page after Enter to verify navigation, result-region, or form-state changes.'
                : 'Call chrome_read_page after this keyboard action when page state matters.',
              claimBoundary:
                'keyboard success only proves key dispatch completed; it does not prove page, form, menu, or search state changed',
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in keyboard operation:', error);
      return createErrorResponse(
        `Error simulating keyboard events: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const keyboardTool = new KeyboardTool();
