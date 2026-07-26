import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  buildActionEvidenceResult,
  type ActionEvidenceResult,
  type ClickActionRecoveryGuidance,
  type ClickObservedOutcome,
  type ClickVerification,
  isClickSuccessOutcome,
} from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { TIMEOUTS, ERROR_MESSAGES } from '@/common/constants';
import { handleDownloadTool, markNextDownloadAsInteractive } from './download';
import { prearmDialogHandling } from './dialog-prearm';
import {
  type CandidateActionSelectorType,
  type CandidateActionInput,
  type ResolvedCandidateActionTarget,
  resolveCandidateActionTarget,
} from './candidate-action';
import {
  hydrateStableTargetRefRegistryFromStorage,
  lookupCandidateActionTargetLocatorEntry,
  lookupStableTargetRefEntry,
} from './stable-target-ref-registry';
import { armActionOutcome } from '../../observers/action-outcome-singleton';
import { markBrowserWorldTabAiOperated } from '../../browser-world-inventory';
import {
  CLICK_VERIFIER_READBACK_MAX_MS,
  type ClickVerifierContext,
  type ClickVerifierResult,
  isVerifierContextRequested,
  runClickVerifier,
} from './click-verifier';
import {
  buildActionBusinessVerificationPlan,
  buildPostActionReadbackEvidence,
  type PostActionReadbackEvidence,
} from './post-action-readback';
import { recordPendingActionBinding } from './read-page';
import { createChromeSelectorLocator } from '@/shared/selector';

/**
 * Explicit lane label on every click response. The Tabrix extension-first
 * execution lane is `tabrix_owned`. If a future code path ever introduces
 * a CDP / debugger / external-controller fallback, that path MUST set a
 * different lane value on its response so silent lane drift is visible to
 * release-evidence consumers. This is observability, not enforcement.
 */
const TABRIX_OWNED_LANE = 'tabrix_owned';

const NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS = 75;
const NEW_TAB_OBSERVE_VERIFIER_CAP_BUFFER_MS = 50;
export const NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS =
  CLICK_VERIFIER_READBACK_MAX_MS + NEW_TAB_OBSERVE_VERIFIER_CAP_BUFFER_MS;
const FILL_PENDING_DOCUMENT_WAIT_MS = 5000;
const FILL_CONTENT_MESSAGE_RETRY_DELAY_MS = 450;
// Lightweight actions still need enough room for real SPA components to
// run their event handlers and DOM verification window. Keep this far below
// the legacy 15s bridge hang, but avoid false timeouts for toolbar menus.
const LIGHTWEIGHT_POST_ACTION_TIMEOUT_MS = 2000;
const DYNAMIC_FILTER_POST_ACTION_TIMEOUT_MS = 13000;
const CLICK_HELPER_RESPONSE_TIMEOUT_BUFFER_MS = 1500;
const CLICK_HELPER_FAST_RESPONSE_TIMEOUT_CAP_MS = 15000;
const CLICK_HELPER_NAVIGATION_RESPONSE_TIMEOUT_CAP_MS = 14000;
const LIGHTWEIGHT_POST_ACTION_INTENTS = new Set([
  'filter.open',
  'filter.option_select',
  'filter.time_range_select',
  'search.category_select',
  'search.open_filters',
  'search.apply_filter.sort',
  'search.apply_filter.content_type',
  'search.apply_filter.time_range',
  'search.apply_filter.unknown',
  'auth.refresh_qr',
]);

class ClickHelperResponseTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`click helper response timed out after ${timeoutMs}ms`);
    this.name = 'ClickHelperResponseTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function buildClickHelperDispatchTimingPolicy(params: {
  waitForNavigation: boolean;
  timeout: number;
  intent?: string | null;
}): {
  waitForNavigation: boolean;
  timeout: number;
  reason: 'caller_requested' | 'lightweight_post_action_intent';
} {
  if (params.intent && LIGHTWEIGHT_POST_ACTION_INTENTS.has(params.intent)) {
    const timeoutCap =
      params.intent.startsWith('filter.') ||
      params.intent === 'search.open_filters' ||
      params.intent.startsWith('search.apply_filter.')
        ? DYNAMIC_FILTER_POST_ACTION_TIMEOUT_MS
        : LIGHTWEIGHT_POST_ACTION_TIMEOUT_MS;
    return {
      waitForNavigation: false,
      timeout: Math.min(params.timeout, timeoutCap),
      reason: 'lightweight_post_action_intent',
    };
  }
  return {
    waitForNavigation: params.waitForNavigation,
    timeout: params.timeout,
    reason: 'caller_requested',
  };
}

function buildClickHelperResponseTimeoutMs(policy: {
  waitForNavigation: boolean;
  timeout: number;
}): number {
  const requested = Math.max(0, Number(policy.timeout) || 0);
  if (!policy.waitForNavigation) {
    return Math.max(
      CLICK_HELPER_RESPONSE_TIMEOUT_BUFFER_MS,
      Math.min(
        requested + CLICK_HELPER_RESPONSE_TIMEOUT_BUFFER_MS,
        CLICK_HELPER_FAST_RESPONSE_TIMEOUT_CAP_MS,
      ),
    );
  }
  return Math.max(
    CLICK_HELPER_RESPONSE_TIMEOUT_BUFFER_MS,
    Math.min(
      requested + CLICK_HELPER_RESPONSE_TIMEOUT_BUFFER_MS,
      CLICK_HELPER_NAVIGATION_RESPONSE_TIMEOUT_CAP_MS,
    ),
  );
}

function withClickHelperResponseTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new ClickHelperResponseTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId != null) clearTimeout(timeoutId);
  }) as Promise<T>;
}

function firstCandidateCssLocator(
  candidateAction: CandidateActionInput | undefined,
): string | undefined {
  const locatorChain = candidateAction?.locatorChain;
  if (!Array.isArray(locatorChain)) return undefined;
  for (const locator of locatorChain) {
    if (locator?.type !== 'css') continue;
    const value = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (value) return value;
  }
  return undefined;
}

function inferSearchFilterCandidateActionFromTargetRef(
  targetRef: string | undefined,
): CandidateActionInput | undefined {
  const ref = typeof targetRef === 'string' ? targetRef.trim() : '';
  if (!ref) return undefined;
  if (/^ref_filter_sort_/i.test(ref)) {
    return { targetRef: ref, intent: 'search.apply_filter.sort' };
  }
  if (/^ref_filter_content_type_/i.test(ref)) {
    return { targetRef: ref, intent: 'search.apply_filter.content_type' };
  }
  if (/^ref_filter_time_range_/i.test(ref)) {
    return { targetRef: ref, intent: 'search.apply_filter.time_range' };
  }
  return undefined;
}

function buildEffectiveCandidateAction(params: {
  candidateAction?: CandidateActionInput;
  explicitRef?: string;
  finalRef?: string;
}): CandidateActionInput | undefined {
  const inferred = inferSearchFilterCandidateActionFromTargetRef(
    params.candidateAction?.targetRef ?? params.explicitRef ?? params.finalRef,
  );
  if (!params.candidateAction) return inferred;
  if (!inferred || typeof params.candidateAction.intent === 'string') {
    return params.candidateAction;
  }
  return {
    ...inferred,
    ...params.candidateAction,
    targetRef: params.candidateAction.targetRef ?? inferred.targetRef,
    intent: inferred.intent,
  };
}

function candidateSelectorLocators(
  candidateAction: CandidateActionInput | undefined,
): Array<{ selector: string; selectorType: CandidateActionSelectorType }> {
  const locatorChain = candidateAction?.locatorChain;
  if (!Array.isArray(locatorChain)) return [];
  const locators: Array<{ selector: string; selectorType: CandidateActionSelectorType }> = [];
  const seen = new Set<string>();
  for (const locator of locatorChain) {
    if (locator?.type !== 'css' && locator?.type !== 'xpath') continue;
    const selector = typeof locator.value === 'string' ? locator.value.trim() : '';
    if (!selector) continue;
    const key = `${locator.type}:${selector}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locators.push({ selector, selectorType: locator.type });
  }
  return locators;
}

function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`;
}

function candidateVisibleTextLocators(
  candidateAction: CandidateActionInput | undefined,
): Array<{ selector: string; selectorType: CandidateActionSelectorType }> {
  const label = String(candidateAction?.label || '').trim();
  if (!label) return [];
  const literal = xpathStringLiteral(label);
  return [
    {
      selector: `//*[not(*) and normalize-space(.)=${literal}]`,
      selectorType: 'xpath',
    },
  ];
}

function shouldRetryFillWithCandidateCss(params: {
  explicitRef?: string;
  finalRef?: string;
  finalSelector?: string;
  candidateCss?: string;
  error?: unknown;
}): boolean {
  if (params.explicitRef) return false;
  if (!params.finalRef || params.finalSelector || !params.candidateCss) return false;
  const message =
    params.error instanceof Error
      ? params.error.message
      : typeof params.error === 'string'
        ? params.error
        : '';
  return /ref .*not found|not visible|selector "undefined"|element for ref not found/i.test(
    message,
  );
}

interface Coordinates {
  x: number;
  y: number;
}

interface SnapshotRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function snapshotRectCenter(rect: unknown): Coordinates | null {
  if (!rect || typeof rect !== 'object') return null;
  const value = rect as Partial<SnapshotRect>;
  const x = Number(value.x);
  const y = Number(value.y);
  const width = Number(value.width);
  const height = Number(value.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return {
    x: Math.round(x + width / 2),
    y: Math.round(y + height / 2),
  };
}

function candidateAllowsSnapshotPointRebind(
  candidateAction: CandidateActionInput | undefined,
): boolean {
  const visibility = candidateAction?.visibility;
  const label = String(candidateAction?.label || '').trim();
  const targetRef = String(candidateAction?.targetRef || '').trim();
  const locatorChain = Array.isArray(candidateAction?.locatorChain)
    ? candidateAction.locatorChain.filter((locator) => {
        const type = String(locator?.type || '').trim();
        const value = String(locator?.value || '').trim();
        return Boolean(type && value);
      })
    : [];
  if (!visibility || !label || !targetRef || locatorChain.length === 0) return false;
  return (
    visibility.domVisible === true &&
    visibility.inViewport === true &&
    visibility.centerHitTarget === true &&
    visibility.occluded === false
  );
}

interface ActionTargetBindingEvidence {
  resolutionSource: ResolvedCandidateActionTarget['source'];
  requestedFrameId: number | null;
  candidateFrameId: number | null;
  resolvedFrameId: number | null;
  frameScope: 'explicit_frame' | 'candidate_or_registry_frame' | 'default_frame';
  dispatchTarget: 'ref' | 'selector' | 'coordinates' | 'none';
  stableTargetRefResolved: boolean | null;
  claimBoundary: string;
}

function asFiniteInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.trunc(value);
}

function buildActionTargetBindingEvidence(input: {
  explicitFrameId?: number;
  candidateAction?: CandidateActionInput;
  resolvedTarget: ResolvedCandidateActionTarget;
  finalRef?: string;
  finalSelector?: string;
  coordinates?: Coordinates | null;
}): ActionTargetBindingEvidence {
  const requestedFrameId = asFiniteInteger(input.explicitFrameId);
  const candidateFrameId = asFiniteInteger(input.candidateAction?.frameId);
  const resolvedFrameId =
    requestedFrameId ?? asFiniteInteger(input.resolvedTarget.frameId) ?? candidateFrameId;
  const stableTargetRefResolved =
    input.resolvedTarget.source === 'candidate_stable_target_ref'
      ? true
      : input.resolvedTarget.source === 'unresolved_stable_target_ref'
        ? false
        : null;
  const dispatchTarget = input.finalRef
    ? 'ref'
    : input.finalSelector
      ? 'selector'
      : input.coordinates
        ? 'coordinates'
        : 'none';

  return {
    resolutionSource: input.resolvedTarget.source,
    requestedFrameId,
    candidateFrameId,
    resolvedFrameId,
    frameScope:
      requestedFrameId !== null
        ? 'explicit_frame'
        : resolvedFrameId !== null
          ? 'candidate_or_registry_frame'
          : 'default_frame',
    dispatchTarget,
    stableTargetRefResolved,
    claimBoundary:
      'Target binding proves only where Tabrix dispatched the action; it does not prove business success, full frame inventory, or postcondition completion.',
  };
}

function summarizeLocatorChain(candidateAction: CandidateActionInput | undefined): string[] {
  if (!Array.isArray(candidateAction?.locatorChain)) return [];
  return candidateAction.locatorChain
    .map((locator) => {
      const type = typeof locator?.type === 'string' ? locator.type : 'unknown';
      const value = typeof locator?.value === 'string' ? locator.value.trim() : '';
      return value ? `${type}:${value.slice(0, 120)}` : type;
    })
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
}

export function buildClickActionEvidenceResult(input: {
  actionId: string;
  actionKind: 'click' | 'hover';
  tabId: number | null;
  targetBinding: ActionTargetBindingEvidence;
  candidateAction?: CandidateActionInput;
  finalRef?: string;
  finalSelector?: string;
  coordinates?: Coordinates | null;
  dispatchSucceeded: boolean;
  postActionReadback: PostActionReadbackEvidence;
  errorCode?: string | null;
}): ActionEvidenceResult {
  const requestedTargetRef =
    typeof input.candidateAction?.targetRef === 'string' ? input.candidateAction.targetRef : null;
  const resolvedTargetRef = input.finalRef ?? requestedTargetRef;
  const targetBindingProven =
    input.targetBinding.dispatchTarget === 'none'
      ? false
      : input.targetBinding.stableTargetRefResolved === false
        ? false
        : input.dispatchSucceeded;
  const negativeEvidence = [
    ...(input.dispatchSucceeded ? [] : ['dispatch_not_accepted_by_browser']),
    ...(input.postActionReadback.businessSuccessProven
      ? []
      : [`post_action_readback_${input.postActionReadback.status}`]),
  ];

  return buildActionEvidenceResult({
    actionId: input.actionId,
    actionKind: input.actionKind,
    tabId: input.tabId,
    toolSuccess: input.dispatchSucceeded,
    targetBinding: {
      requestedTargetRef,
      resolvedTargetRef,
      locatorChainSummary: summarizeLocatorChain(input.candidateAction),
      dispatchTarget: input.targetBinding.dispatchTarget,
      frameScope: input.targetBinding.frameScope,
      targetBindingProven,
      claimBoundary: input.targetBinding.claimBoundary,
    },
    dispatch: {
      dispatched: input.dispatchSucceeded,
      acceptedByBrowser: input.dispatchSucceeded,
      errorCode: input.errorCode ?? null,
    },
    source: {
      selectedDataSource: 'unknown',
      sourceRouteHonestyVerdict: 'not_checked',
      fallbackUsed: null,
    },
    postAction: {
      postActionReadbackStatus: input.postActionReadback.status,
      postconditionVerdict: input.postActionReadback.businessSuccessProven
        ? 'proven_by_readback'
        : 'not_proven',
      freshReadRequired: input.postActionReadback.freshReadRequired,
      readbackSource: input.postActionReadback.readbackSource,
    },
    business: {
      businessSuccessVerdict: input.postActionReadback.businessSuccessProven
        ? 'proven'
        : 'not_proven',
      businessSuccessProven: input.postActionReadback.businessSuccessProven,
      negativeEvidence,
      nextRequiredCheck: input.postActionReadback.requiredNextAction,
    },
    browserHygiene: {
      required: false,
      status: 'not_checked',
      leakedTabsOrWindows: null,
    },
  });
}

interface ClickToolParams {
  selector?: string; // CSS selector or XPath for the element to click
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  interaction?: 'click' | 'hover'; // Default click. Hover is safe discovery for known refs/selectors.
  ref?: string; // Element ref from accessibility tree (window.__claudeElementMap)
  candidateAction?: CandidateActionInput; // Optional action seed from read_page
  coordinates?: Coordinates; // Coordinates to click at (x, y relative to viewport)
  waitForNavigation?: boolean; // Whether to wait for navigation to complete after click
  timeout?: number; // Timeout in milliseconds for waiting for the element or navigation
  frameId?: number; // Target frame for ref/selector resolution
  double?: boolean; // Perform double click when true
  button?: 'left' | 'right' | 'middle';
  bubbles?: boolean;
  cancelable?: boolean;
  modifiers?: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };
  allowDownloadClick?: boolean;
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // Internal-only opt-in for family-aware post-click verification. Not
  // exposed on the public MCP input schema; intended to be wired from
  // internal helpers / tests until a public contract is settled.
  verifierContext?: ClickVerifierContext;
}

function buildClickLogSummary(args: ClickToolParams): Record<string, unknown> {
  return {
    interaction: args.interaction ?? 'click',
    hasSelector: typeof args.selector === 'string' && args.selector.length > 0,
    selectorType: args.selectorType ?? 'css',
    hasRef: typeof args.ref === 'string' && args.ref.length > 0,
    hasCandidateAction: args.candidateAction != null,
    candidateActionIntent:
      typeof args.candidateAction?.intent === 'string' ? args.candidateAction.intent : null,
    usesCoordinates: args.coordinates != null,
    waitForNavigation: args.waitForNavigation === true,
    hasVerifierContext: args.verifierContext != null,
    tabId: typeof args.tabId === 'number' ? args.tabId : null,
    windowId: typeof args.windowId === 'number' ? args.windowId : null,
    frameId: typeof args.frameId === 'number' ? args.frameId : null,
  };
}

interface InteractionSchemeGuard {
  allowed: boolean;
  scheme: string;
  pageType:
    | 'web_page'
    | 'extension_page'
    | 'browser_internal_page'
    | 'devtools_page'
    | 'unsupported_page';
  unsupportedPageType: string | null;
  recommendedAction: string | null;
}

function inferInteractionSchemeGuard(url: string): InteractionSchemeGuard {
  const raw = String(url || '');
  const lower = raw.toLowerCase();

  if (lower.startsWith('http://') || lower.startsWith('https://')) {
    return {
      allowed: true,
      scheme: lower.startsWith('https://') ? 'https' : 'http',
      pageType: 'web_page',
      unsupportedPageType: null,
      recommendedAction: null,
    };
  }

  if (lower.startsWith('chrome-extension://')) {
    return {
      allowed: false,
      scheme: 'chrome-extension',
      pageType: 'extension_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome://') || lower.startsWith('edge://') || lower.startsWith('about:')) {
    return {
      allowed: false,
      scheme: lower.startsWith('edge://')
        ? 'edge'
        : lower.startsWith('about:')
          ? 'about'
          : 'chrome',
      pageType: 'browser_internal_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('chrome-error://')) {
    return {
      allowed: false,
      scheme: 'chrome-error',
      pageType: 'browser_internal_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('devtools://')) {
    return {
      allowed: false,
      scheme: 'devtools',
      pageType: 'devtools_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  if (lower.startsWith('view-source:') || lower.startsWith('file://')) {
    return {
      allowed: false,
      scheme: lower.startsWith('view-source:') ? 'view-source' : 'file',
      pageType: 'unsupported_page',
      unsupportedPageType: 'non_web_tab',
      recommendedAction: 'switch_to_http_tab',
    };
  }

  const scheme = raw.includes(':') ? raw.slice(0, raw.indexOf(':')).toLowerCase() : 'unknown';
  return {
    allowed: false,
    scheme,
    pageType: 'unsupported_page',
    unsupportedPageType: 'non_web_tab',
    recommendedAction: 'switch_to_http_tab',
  };
}

function getTabNavigationUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return String(tab.url || tab.pendingUrl || '');
}

function createUnsupportedTabResponse(
  action: string,
  tab: chrome.tabs.Tab,
  guard: InteractionSchemeGuard,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          action,
          reason: 'unsupported_page_type',
          pageType: guard.pageType,
          scheme: guard.scheme,
          unsupportedPageType: guard.unsupportedPageType,
          recommendedAction: guard.recommendedAction,
          message: `Current tab is not a regular web page for ${action}`,
          tabId: tab.id ?? null,
          title: String(tab.title || ''),
          url: String(tab.url || ''),
        }),
      },
    ],
    isError: false,
  };
}

/**
 * Raw page-local signals collected by `inject-scripts/click-helper.js`.
 * These are facts, not verdicts. The verdict is computed in
 * `mergeClickSignals()` by combining these with browser-level signals
 * observed in the background layer (e.g. a new tab being created).
 */
export interface ClickPageSignals {
  beforeUnloadFired: boolean;
  urlBefore: string;
  urlAfter: string;
  hashBefore: string;
  hashAfter: string;
  domChanged: boolean;
  domAddedDialog: boolean;
  domAddedMenu: boolean;
  focusChanged: boolean;
  targetStateDelta: Record<string, unknown> | null;
  waitDiagnostics?: {
    verification?: { waitedMs: number; reason: string };
  };
}

/**
 * Browser-level signals gathered in the background layer for the origin tab
 * during the verification window.
 */
export interface ClickBrowserSignals {
  newTabOpened: boolean;
  waitDiagnostics?: {
    newTabObservation: {
      waitedMs: number;
      reason:
        | 'new_tab_created'
        | 'tab_query_delta'
        | 'page_strong_outcome_observed'
        | 'page_outcome_observed'
        | 'ambiguous_cap_elapsed'
        | 'listener_unavailable';
      maxMs: number;
    };
  };
}

type ClickDiffUrlDelta = 'none' | 'hash_only' | 'same_origin' | 'cross_origin' | 'unavailable';

type ClickDiffSummary =
  | { kind: 'no_change' }
  | {
      kind: 'change';
      urlDelta: ClickDiffUrlDelta;
      hashChanged: boolean;
      newTabOpened: boolean;
      beforeUnloadFired: boolean;
      domChanged: boolean;
      dialogAdded: boolean;
      menuAdded: boolean;
      focusChanged: boolean;
      stateChanged: boolean;
    };

type BrowserActionPostActionDelta = {
  deltaKind: 'post_action_tool_delta';
  actionId: string | null;
  actionKind: string;
  tabId: number | null;
  targetRef: string | null;
  observedOutcome: string | null;
  changed: boolean;
  changedSignals: string[];
  urlDelta: ClickDiffUrlDelta | null;
  hashChanged: boolean | null;
  beforeUnloadFired: boolean | null;
  readbackStatus: string | null;
  recommendation: string | null;
  businessSuccessProven: boolean | null;
  claimBoundary: string[];
};

function classifyClickUrlDelta(page: ClickPageSignals): ClickDiffUrlDelta {
  if (page.urlBefore === page.urlAfter) {
    return page.hashBefore !== page.hashAfter ? 'hash_only' : 'none';
  }
  try {
    const before = new URL(page.urlBefore);
    const after = new URL(page.urlAfter);
    return before.origin === after.origin ? 'same_origin' : 'cross_origin';
  } catch {
    return 'unavailable';
  }
}

function buildClickDiffSummary(
  page: ClickPageSignals | null,
  browser: ClickBrowserSignals,
): ClickDiffSummary {
  const stateChanged = page?.targetStateDelta != null;
  const urlDelta = page ? classifyClickUrlDelta(page) : 'unavailable';
  const hashChanged = page ? page.hashBefore !== page.hashAfter : false;
  const beforeUnloadFired = page?.beforeUnloadFired === true;
  const domChanged = page?.domChanged === true;
  const dialogAdded = page?.domAddedDialog === true;
  const menuAdded = page?.domAddedMenu === true;
  const focusChanged = page?.focusChanged === true;

  const hasTaskAdvancingChange =
    browser.newTabOpened ||
    beforeUnloadFired ||
    (urlDelta !== 'none' && urlDelta !== 'unavailable') ||
    domChanged ||
    dialogAdded ||
    menuAdded ||
    stateChanged;

  if (!hasTaskAdvancingChange) {
    return { kind: 'no_change' };
  }

  return {
    kind: 'change',
    urlDelta,
    hashChanged,
    newTabOpened: browser.newTabOpened,
    beforeUnloadFired,
    domChanged,
    dialogAdded,
    menuAdded,
    focusChanged,
    stateChanged,
  };
}

function buildBrowserActionPostActionDelta(input: {
  actionId?: string | null;
  actionKind: string;
  tabId?: number | null;
  targetRef?: string | null;
  observedOutcome?: string | null;
  clickDiff?: ClickDiffSummary | null;
  verification?: ClickVerification | null;
  postActionReadback?: PostActionReadbackEvidence | null;
  extraChangedSignals?: string[];
}): BrowserActionPostActionDelta {
  const clickDiff = input.clickDiff ?? null;
  const verification = input.verification ?? null;
  const clickChangedSignals =
    clickDiff?.kind === 'change'
      ? [
          clickDiff.newTabOpened || verification?.newTabOpened ? 'new_tab_opened' : null,
          clickDiff.beforeUnloadFired || verification?.navigationOccurred
            ? 'before_unload_fired'
            : null,
          clickDiff.urlDelta !== 'none' && clickDiff.urlDelta !== 'unavailable'
            ? 'url_changed'
            : null,
          clickDiff.hashChanged ? 'hash_changed' : null,
          clickDiff.domChanged || verification?.domChanged ? 'dom_changed' : null,
          clickDiff.dialogAdded ? 'dialog_opened' : null,
          clickDiff.menuAdded ? 'menu_opened' : null,
          clickDiff.stateChanged || verification?.stateChanged ? 'state_changed' : null,
        ].filter((entry): entry is string => Boolean(entry))
      : [];
  const changedSignals = [
    ...new Set([...clickChangedSignals, ...(input.extraChangedSignals ?? [])]),
  ];

  return {
    deltaKind: 'post_action_tool_delta',
    actionId: input.actionId ?? null,
    actionKind: input.actionKind,
    tabId: input.tabId ?? null,
    targetRef: input.targetRef ?? null,
    observedOutcome: input.observedOutcome ?? null,
    changed: clickDiff?.kind === 'change' || changedSignals.length > 0,
    changedSignals,
    urlDelta: clickDiff?.kind === 'change' ? clickDiff.urlDelta : null,
    hashChanged: clickDiff?.kind === 'change' ? clickDiff.hashChanged : null,
    beforeUnloadFired: clickDiff?.kind === 'change' ? clickDiff.beforeUnloadFired : null,
    readbackStatus: input.postActionReadback?.status ?? null,
    recommendation: input.postActionReadback?.requiredNextAction ?? null,
    businessSuccessProven: input.postActionReadback?.businessSuccessProven ?? null,
    claimBoundary: [
      'This is browser-observed post-action change evidence, not AI business evaluation.',
      'No site-specific interpretation is included.',
      'A fresh read may still be required before reusing page objects or targets.',
    ],
  };
}

export function buildStructuredClickHelperErrorResult(input: {
  message: string;
  clickMethod: string;
  elementInfo?: unknown;
  browserSignals: ClickBrowserSignals;
  actionId?: string | null;
  tabId?: number | null;
  targetBinding?: ActionTargetBindingEvidence;
  reason?: string;
  targetConsistency?: unknown;
  actionRecovery?: ClickActionRecoveryGuidance;
  actionEvidenceResult?: ActionEvidenceResult;
  postActionDelta?: BrowserActionPostActionDelta;
}) {
  const verification: ClickVerification = {
    navigationOccurred: false,
    urlChanged: false,
    newTabOpened: input.browserSignals.newTabOpened,
    domChanged: false,
    stateChanged: false,
    focusChanged: false,
  };

  return {
    success: false,
    dispatchSucceeded: false,
    observedOutcome: 'no_observed_change' as ClickObservedOutcome,
    verification,
    clickDiff: buildClickDiffSummary(null, input.browserSignals),
    postActionDelta:
      input.postActionDelta ??
      buildBrowserActionPostActionDelta({
        actionId: input.actionId,
        actionKind: 'click',
        tabId: input.tabId,
        targetRef: null,
        observedOutcome: 'no_observed_change',
        clickDiff: buildClickDiffSummary(null, input.browserSignals),
        verification,
        postActionReadback: null,
      }),
    navigationOccurred: false,
    lane: TABRIX_OWNED_LANE,
    error: input.reason ?? 'click_dispatch_not_proven',
    reason: input.reason ?? 'click_dispatch_not_proven',
    message: `Click helper returned an error; click dispatch and post-action state are not proven (${input.message})`,
    elementInfo: input.elementInfo,
    clickMethod: input.clickMethod,
    ...(input.targetConsistency ? { targetConsistency: input.targetConsistency } : {}),
    ...(input.actionRecovery ? { actionRecovery: input.actionRecovery } : {}),
    ...(input.targetBinding ? { targetBinding: input.targetBinding } : {}),
    ...(input.actionEvidenceResult ? { actionEvidenceResult: input.actionEvidenceResult } : {}),
    resultShape: 'structured_click_error',
  };
}

function createStructuredClickHelperErrorResponse(input: {
  message: string;
  clickMethod: string;
  elementInfo?: unknown;
  browserSignals?: ClickBrowserSignals;
  actionId?: string | null;
  tabId?: number | null;
  targetBinding?: ActionTargetBindingEvidence;
  reason?: string;
  targetConsistency?: unknown;
  actionRecovery?: ClickActionRecoveryGuidance;
  businessVerification?: unknown;
  postActionReadback?: unknown;
  actionEvidenceResult?: ActionEvidenceResult;
  postActionDelta?: BrowserActionPostActionDelta;
}): ToolResult {
  const payload = buildStructuredClickHelperErrorResult({
    message: input.message,
    clickMethod: input.clickMethod,
    elementInfo: input.elementInfo,
    browserSignals: input.browserSignals ?? { newTabOpened: false },
    actionId: input.actionId,
    tabId: input.tabId,
    targetBinding: input.targetBinding,
    reason: input.reason,
    targetConsistency: input.targetConsistency,
    actionRecovery: input.actionRecovery,
    actionEvidenceResult: input.actionEvidenceResult,
    postActionDelta: input.postActionDelta,
  });
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ...payload,
          ...(input.businessVerification
            ? {
                businessVerification: input.businessVerification,
                postconditionStatus: input.businessVerification,
              }
            : {}),
          ...(input.postActionReadback ? { postActionReadback: input.postActionReadback } : {}),
          ...(input.actionEvidenceResult
            ? { actionEvidenceResult: input.actionEvidenceResult }
            : {}),
        }),
      },
    ],
    isError: true,
  };
}

/**
 * Pure function: given the raw signals from page-local + browser-level
 * sources, produce the public click contract fields.
 *
 * Ordering of the outcome checks matters: it encodes Tabrix's preference
 * for the most specific explanation of what the user saw.
 *
 * Exported for direct unit-testing from `tests/click-contract.test.ts`.
 */
export function mergeClickSignals(
  dispatchSucceeded: boolean,
  page: ClickPageSignals | null,
  browser: ClickBrowserSignals,
): {
  success: boolean;
  dispatchSucceeded: boolean;
  observedOutcome: ClickObservedOutcome;
  verification: ClickVerification;
} {
  if (!dispatchSucceeded || page == null) {
    const verification: ClickVerification = {
      navigationOccurred: false,
      urlChanged: false,
      newTabOpened: browser.newTabOpened,
      domChanged: false,
      stateChanged: false,
      focusChanged: false,
    };
    return {
      success: false,
      dispatchSucceeded,
      observedOutcome: dispatchSucceeded ? 'verification_unavailable' : 'no_observed_change',
      verification,
    };
  }

  const urlChanged = page.urlBefore !== page.urlAfter;
  const hashOnlyChanged =
    urlChanged &&
    stripHash(page.urlBefore) === stripHash(page.urlAfter) &&
    page.hashBefore !== page.hashAfter;
  const sameHost =
    urlChanged &&
    !hashOnlyChanged &&
    (() => {
      try {
        const a = new URL(page.urlBefore);
        const b = new URL(page.urlAfter);
        return a.host === b.host;
      } catch {
        return false;
      }
    })();
  const stateChanged = page.targetStateDelta != null;

  const verification: ClickVerification = {
    navigationOccurred: page.beforeUnloadFired,
    urlChanged,
    newTabOpened: browser.newTabOpened,
    domChanged: page.domChanged,
    stateChanged,
    focusChanged: page.focusChanged,
  };

  // Outcome priority: the most specific and most "this is what the user
  // saw" categories come first. `dom_changed` and `focus_changed` are
  // catch-alls at the bottom.
  let observedOutcome: ClickObservedOutcome;
  if (browser.newTabOpened) {
    observedOutcome = 'new_tab_opened';
  } else if (page.beforeUnloadFired) {
    observedOutcome = 'cross_document_navigation';
  } else if (hashOnlyChanged) {
    observedOutcome = 'hash_change';
  } else if (urlChanged && sameHost) {
    observedOutcome = 'spa_route_change';
  } else if (urlChanged) {
    // Cross-host client-side URL change without unload. Rare but real.
    observedOutcome = 'spa_route_change';
  } else if (page.domAddedDialog) {
    observedOutcome = 'dialog_opened';
  } else if (page.domAddedMenu) {
    observedOutcome = 'menu_opened';
  } else if (stateChanged) {
    observedOutcome = 'state_toggled';
  } else if (page.domChanged) {
    observedOutcome = 'dom_changed';
  } else if (page.focusChanged) {
    observedOutcome = 'focus_changed';
  } else {
    observedOutcome = 'no_observed_change';
  }

  return {
    success: isClickSuccessOutcome(observedOutcome),
    dispatchSucceeded,
    observedOutcome,
    verification,
  };
}

function stripHash(url: string): string {
  const i = url.indexOf('#');
  return i >= 0 ? url.slice(0, i) : url;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Observe new-tab creation for the lifetime of a single click interaction,
 * then keep the listener alive for a tiny drain window so we do not miss a
 * late-delivered `chrome.tabs.onCreated` event right after the page helper
 * returns.
 *
 * We deliberately avoid a long-lived `chrome.webNavigation` subscriber here —
 * one-shot listener + explicit removal keeps the blast radius tiny.
 *
 * Exported for direct unit-testing from `tests/click-contract.test.ts`.
 */
export function observeNewTabUntil(
  originWindowId: number | undefined,
  interactionPromise: Promise<unknown>,
  options:
    | number
    | { maxMs?: number; verifierRequested?: boolean } = NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS,
): Promise<ClickBrowserSignals> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const maxMs =
      typeof options === 'number'
        ? Math.max(0, options)
        : Math.max(0, options.maxMs ?? NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS);
    const verifierRequested =
      typeof options === 'object' && options != null && options.verifierRequested === true;
    let newTabOpened = false;
    let interactionSettled = false;
    let resolved = false;
    let baselineTabIds: Set<number> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const listener = (tab: chrome.tabs.Tab) => {
      if (originWindowId == null || tab.windowId === originWindowId) {
        newTabOpened = true;
        if (interactionSettled) {
          finalize('new_tab_created');
        }
      }
    };
    const finalize = (
      reason: NonNullable<ClickBrowserSignals['waitDiagnostics']>['newTabObservation']['reason'],
    ) => {
      if (resolved) return;
      resolved = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      try {
        chrome.tabs.onCreated.removeListener(listener);
      } catch (error) {
        void error;
        // Best-effort cleanup. The one-shot observation has already resolved.
      }
      resolve({
        newTabOpened,
        waitDiagnostics: {
          newTabObservation: {
            waitedMs: Math.max(0, Date.now() - startedAt),
            reason,
            maxMs,
          },
        },
      });
    };
    try {
      chrome.tabs.onCreated.addListener(listener);
    } catch {
      resolve({
        newTabOpened: false,
        waitDiagnostics: {
          newTabObservation: {
            waitedMs: Math.max(0, Date.now() - startedAt),
            reason: 'listener_unavailable',
            maxMs,
          },
        },
      });
      return;
    }
    const captureBaseline = async () => {
      try {
        const tabs = await chrome.tabs.query(
          originWindowId == null ? {} : { windowId: originWindowId },
        );
        baselineTabIds = new Set(
          tabs.map((tab) => tab.id).filter((id): id is number => typeof id === 'number'),
        );
      } catch {
        baselineTabIds = null;
      }
    };
    void captureBaseline();
    const readPageSignals = (value: unknown): ClickPageSignals | null =>
      value && typeof value === 'object' && 'signals' in value
        ? ((value as { signals?: ClickPageSignals | null }).signals ?? null)
        : null;
    const pageSignalsHaveStrongOutcome = (value: unknown): boolean => {
      const page = readPageSignals(value);
      if (!page) return false;
      return (
        page.beforeUnloadFired ||
        page.urlBefore !== page.urlAfter ||
        page.hashBefore !== page.hashAfter ||
        page.domAddedDialog ||
        page.domAddedMenu ||
        page.targetStateDelta != null
      );
    };
    const pageSignalsHaveWeakOutcome = (value: unknown): boolean => {
      const page = readPageSignals(value);
      if (!page) return false;
      return (
        page.beforeUnloadFired ||
        page.urlBefore !== page.urlAfter ||
        page.hashBefore !== page.hashAfter ||
        page.domAddedDialog ||
        page.domAddedMenu ||
        page.targetStateDelta != null
      );
    };
    const checkTabDelta = async (): Promise<boolean> => {
      if (!baselineTabIds) return false;
      try {
        const tabs = await chrome.tabs.query(
          originWindowId == null ? {} : { windowId: originWindowId },
        );
        return tabs.some((tab) => typeof tab.id === 'number' && !baselineTabIds!.has(tab.id));
      } catch {
        return false;
      }
    };
    const afterInteraction = async (value: unknown) => {
      interactionSettled = true;
      if (newTabOpened) {
        finalize('new_tab_created');
        return;
      }
      if (pageSignalsHaveStrongOutcome(value)) {
        finalize('page_strong_outcome_observed');
        return;
      }
      if (!verifierRequested && pageSignalsHaveWeakOutcome(value)) {
        finalize('page_outcome_observed');
        return;
      }
      if (await checkTabDelta()) {
        newTabOpened = true;
        finalize('tab_query_delta');
        return;
      }
      timeoutId = setTimeout(() => finalize('ambiguous_cap_elapsed'), maxMs);
    };
    void interactionPromise.then(afterInteraction, () => afterInteraction(null));
  });
}

/**
 * Tool for clicking elements on web pages
 */
class ClickTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.CLICK;

  private async preflightDownloadIntercept(
    tabId: number,
    args: { selector?: string; ref?: string; frameId?: number },
  ): Promise<{
    interceptedDownload: boolean;
    downloadUrl?: string;
    downloadFilename?: string | null;
  }> {
    if (!args.selector && !args.ref) {
      return { interceptedDownload: false };
    }
    try {
      const target: chrome.scripting.InjectionTarget = {
        tabId,
        ...(typeof args.frameId === 'number' ? { frameIds: [args.frameId] } : {}),
      };
      const [injection] = await chrome.scripting.executeScript({
        target,
        func: (params: { selector?: string; ref?: string }) => {
          let element: Element | null = null;
          if (params.ref && typeof params.ref === 'string') {
            try {
              const map = (window as any).__claudeElementMap;
              const weak = map && map[params.ref];
              const deref = weak && typeof weak.deref === 'function' ? weak.deref() : null;
              if (deref instanceof Element) {
                element = deref;
              }
            } catch (error) {
              void error;
              // The ref map is advisory; unresolved refs fall through to the normal no-target path.
            }
          } else if (params.selector && typeof params.selector === 'string') {
            element = document.querySelector(params.selector);
          }
          if (!element) return { interceptedDownload: false };

          const anchor =
            element instanceof HTMLAnchorElement ? element : element.closest?.('a[href]') || null;
          if (!anchor || !(anchor instanceof HTMLAnchorElement)) {
            return { interceptedDownload: false };
          }

          const href = anchor.href || '';
          const downloadAttr = anchor.getAttribute('download');
          const anchorText = (anchor.textContent || '').trim();
          const parsed = (() => {
            try {
              return new URL(href, window.location.href);
            } catch {
              return null;
            }
          })();
          const path = parsed?.pathname || '';
          const lowerPath = path.toLowerCase();
          const lowerHref = href.toLowerCase();
          const isHashOrJs =
            href.startsWith('#') || lowerHref.startsWith('javascript:') || lowerHref.length === 0;
          const hasFileExt =
            /\.(zip|rar|7z|pdf|csv|xlsx?|docx?|pptx?|txt|json|xml|html?|md|png|jpe?g|gif|webp|mp4|mp3|wav|apk|dmg|exe)$/i.test(
              path,
            );
          const queryLooksDownload =
            /(?:[?&](download|dl|export|attachment|response-content-disposition)=)/i.test(href);
          const hrefKeyword = /\b(download|export|attachment|file)\b/i.test(href);
          const textKeyword = /\b(download|export|下载|导出)\b/i.test(anchorText);
          const likelyApiCall = /\/api(\/|$)/i.test(lowerPath) && !hasFileExt;

          let score = 0;
          if (downloadAttr !== null) score += 3;
          if (hasFileExt) score += 2;
          if (queryLooksDownload) score += 2;
          if (hrefKeyword) score += 1;
          if (textKeyword) score += 1;
          if (likelyApiCall) score -= 2;

          if (!isHashOrJs && score >= 2) {
            return {
              interceptedDownload: true,
              downloadUrl: href,
              downloadFilename: (downloadAttr || '').trim() || null,
            };
          }
          return { interceptedDownload: false };
        },
        args: [{ selector: args.selector, ref: args.ref }],
      });
      const result = injection?.result as
        | { interceptedDownload?: boolean; downloadUrl?: string; downloadFilename?: string | null }
        | undefined;
      return {
        interceptedDownload: result?.interceptedDownload === true,
        downloadUrl: result?.downloadUrl,
        downloadFilename: result?.downloadFilename ?? null,
      };
    } catch {
      return { interceptedDownload: false };
    }
  }

  /**
   * Execute click operation
   */
  async execute(args: ClickToolParams): Promise<ToolResult> {
    const {
      selector,
      selectorType = 'css',
      interaction = 'click',
      coordinates,
      waitForNavigation = false,
      timeout = TIMEOUTS.DEFAULT_WAIT * 5,
      frameId,
      button,
      bubbles,
      cancelable,
      modifiers,
    } = args;

    console.log(`Starting ${interaction} operation with options:`, buildClickLogSummary(args));

    if (interaction !== 'click' && interaction !== 'hover') {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': interaction must be "click" or "hover"',
      );
    }

    if (!selector && !coordinates && !args.ref && !args.candidateAction) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS +
          ': Provide ref or selector or coordinates (or candidateAction)',
      );
    }

    const requestedClickMethod = coordinates
      ? 'coordinates'
      : args.ref
        ? 'ref'
        : selector
          ? 'selector'
          : args.candidateAction
            ? 'candidateAction'
            : 'unknown';

    try {
      // Resolve tab
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }
      const resolvedTabId = tab.id;
      const schemeGuard = inferInteractionSchemeGuard(String(tab.url || ''));
      if (!schemeGuard.allowed) {
        return createUnsupportedTabResponse(interaction, tab, schemeGuard);
      }

      // Snapshot the pre-click URL so the verifier can report
      // `postClickState.beforeUrl` without chasing tab.url after navigation.
      const beforeUrl = typeof tab.url === 'string' ? tab.url : null;

      await hydrateStableTargetRefRegistryFromStorage(tab.id);

      let resolvedTarget = resolveCandidateActionTarget({
        explicitRef: args.ref,
        explicitSelector: selector,
        explicitSelectorType: selectorType,
        candidateAction: args.candidateAction,
        tabId: tab.id,
        lookupStableTargetRef: lookupStableTargetRefEntry,
        lookupCandidateActionTargetLocator: lookupCandidateActionTargetLocatorEntry,
      });

      // When a stable targetRef was supplied but the per-tab snapshot
      // registry has no live mapping, fail closed with a clear
      // remediation message. Falling back to the raw `tgt_*` would
      // always miss in the content script and waste a click.
      if (resolvedTarget.source === 'unresolved_stable_target_ref') {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: candidateAction.targetRef "${
            resolvedTarget.unresolvedStableTargetRef
          }" is a stable id, but no current snapshot of this tab has it. Call chrome_read_page on this tab first, then re-issue the click with the latest targetRef.`,
        );
      }

      let finalRef = resolvedTarget.ref;
      let finalSelector = resolvedTarget.selector;
      let finalSelectorType = resolvedTarget.selectorType || selectorType;
      const finalFrameId = typeof frameId === 'number' ? frameId : resolvedTarget.frameId;
      const effectiveCandidateAction = buildEffectiveCandidateAction({
        candidateAction: args.candidateAction,
        explicitRef: args.ref,
        finalRef,
      });
      const buildTargetBinding = () =>
        buildActionTargetBindingEvidence({
          explicitFrameId: frameId,
          candidateAction: effectiveCandidateAction,
          resolvedTarget,
          finalRef,
          finalSelector,
          coordinates,
        });
      const buildBusinessVerification = (
        dispatchSucceeded: boolean,
        observedOutcome?: ClickObservedOutcome | 'verification_required' | null,
      ) =>
        buildActionBusinessVerificationPlan({
          candidateAction: effectiveCandidateAction,
          dispatchSucceeded,
          actionKind: interaction === 'hover' ? 'hover' : 'click',
          observedOutcome,
        });
      const candidateSnapshotPoint = snapshotRectCenter(args.candidateAction?.snapshotRect);
      const canUseSnapshotPointForHover =
        interaction === 'hover' &&
        candidateSnapshotPoint != null &&
        candidateAllowsSnapshotPointRebind(args.candidateAction);
      const hoverRecoveredTargetRef = String(
        args.candidateAction?.targetRef || args.ref || '',
      ).trim();
      const shouldDeferRecoveredHoverSelectorResolution =
        interaction === 'hover' &&
        /^ref_text_(menu|search_toolbar|filter_panel|control)_/.test(hoverRecoveredTargetRef);

      if (interaction === 'hover' && coordinates && !finalRef && !finalSelector) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': Safe hover requires ref, selector, or candidateAction. Coordinate-only hover remains a high-risk chrome_computer fallback.',
        );
      }

      if (!coordinates && !finalRef && !finalSelector && !canUseSnapshotPointForHover) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': Provide ref or selector or coordinates (candidateAction did not resolve target)',
        );
      }

      // If selector is XPath, convert to ref first
      if (
        finalSelector &&
        finalSelectorType === 'xpath' &&
        !shouldDeferRecoveredHoverSelectorResolution
      ) {
        await this.injectContentScript(
          tab.id,
          ['inject-scripts/accessibility-tree-helper.js'],
          false,
          'ISOLATED',
          false,
          typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
        );
        try {
          const resolved = await this.sendMessageToTab(
            tab.id,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector: finalSelector,
              isXPath: true,
              allowMultiple: interaction === 'hover',
            },
            finalFrameId,
          );
          if (resolved && resolved.success && resolved.ref) {
            finalRef = resolved.ref;
            finalSelector = undefined; // Use ref instead of selector
          } else {
            const candidateCssFallback = firstCandidateCssLocator(args.candidateAction);
            if (candidateCssFallback && candidateCssFallback !== finalSelector) {
              finalSelector = candidateCssFallback;
              finalSelectorType = 'css';
              resolvedTarget = {
                selector: candidateCssFallback,
                selectorType: 'css',
                ...(typeof finalFrameId === 'number' ? { frameId: finalFrameId } : {}),
                source: 'candidate_locator_css',
              };
            } else {
              return createErrorResponse(
                `Failed to resolve XPath selector: ${resolved?.error || 'unknown error'}`,
              );
            }
          }
        } catch (error) {
          const candidateCssFallback = firstCandidateCssLocator(args.candidateAction);
          if (candidateCssFallback && candidateCssFallback !== finalSelector) {
            finalSelector = candidateCssFallback;
            finalSelectorType = 'css';
            resolvedTarget = {
              selector: candidateCssFallback,
              selectorType: 'css',
              ...(typeof finalFrameId === 'number' ? { frameId: finalFrameId } : {}),
              source: 'candidate_locator_css',
            };
          } else {
            return createErrorResponse(
              `Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }

      if (interaction === 'hover') {
        const candidateHoverRef = hoverRecoveredTargetRef;
        const shouldTryCandidateHoverRef =
          !finalRef &&
          Boolean(finalSelector) &&
          /^ref_text_(search_toolbar|filter_panel|control)_/.test(candidateHoverRef);
        const resolveHoverTargetByVisibleText = async (): Promise<boolean> => {
          const hoverText = String(args.candidateAction?.label || '').trim();
          if (!hoverText) return false;
          const locator = createChromeSelectorLocator();
          const textResolved = await locator.locate(
            resolvedTabId,
            {
              candidates: [
                {
                  type: 'text',
                  value: hoverText,
                  match: 'exact',
                  source: 'generated',
                  strategy: 'hover_visible_text_rebind',
                  weight: 100,
                  stability: { score: 0.78, signals: { usesText: true } },
                },
              ],
            },
            { frameId: finalFrameId, allowMultiple: true },
          );
          if (textResolved?.ref) {
            finalRef = textResolved.ref;
            finalSelector = undefined;
            resolvedTarget = {
              ref: textResolved.ref,
              ...(typeof textResolved.frameId === 'number'
                ? { frameId: textResolved.frameId }
                : {}),
              source: 'candidate_locator_ref',
            };
            return true;
          }
          return false;
        };
        const resolveHoverTargetBySnapshotPoint = async (): Promise<boolean> => {
          if (!candidateSnapshotPoint || !canUseSnapshotPointForHover) return false;
          const resolved = await this.sendMessageToTab(
            resolvedTabId,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_POINT,
              x: candidateSnapshotPoint.x,
              y: candidateSnapshotPoint.y,
              rect: args.candidateAction?.snapshotRect,
              identity: {
                label: String(args.candidateAction?.label || '').trim(),
                targetRef: String(args.candidateAction?.targetRef || '').trim(),
                locatorChain: Array.isArray(args.candidateAction?.locatorChain)
                  ? args.candidateAction.locatorChain
                      .map((locator) => ({
                        type: String(locator?.type || '').trim(),
                        value: String(locator?.value || '').trim(),
                      }))
                      .filter((locator) => locator.type && locator.value)
                  : [],
              },
            },
            finalFrameId,
          );
          if (resolved && resolved.success && resolved.ref) {
            finalRef = resolved.ref;
            finalSelector = undefined;
            resolvedTarget = {
              ref: resolved.ref,
              ...(typeof finalFrameId === 'number' ? { frameId: finalFrameId } : {}),
              source: 'candidate_snapshot_rect',
            };
            return true;
          }
          return false;
        };

        if (shouldTryCandidateHoverRef) {
          await this.injectContentScript(
            tab.id,
            ['inject-scripts/accessibility-tree-helper.js'],
            false,
            'ISOLATED',
            false,
            typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
          );
          try {
            const liveRef = await this.sendMessageToTab(
              tab.id,
              {
                action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
                ref: candidateHoverRef,
              },
              finalFrameId,
            );
            if (liveRef && liveRef.success) {
              finalRef = candidateHoverRef;
              finalSelector = undefined;
            }
          } catch {
            // The live ref probe is opportunistic; selector/text recovery below remains authoritative.
          }
        }

        if (!finalRef && candidateHoverRef.startsWith('ref_text_')) {
          try {
            await resolveHoverTargetByVisibleText();
          } catch {
            // Selector recovery below will produce the structured diagnostic if text rebind fails.
          }
        }

        if (finalSelector && !finalRef) {
          await this.injectContentScript(
            tab.id,
            ['inject-scripts/accessibility-tree-helper.js'],
            false,
            'ISOLATED',
            false,
            typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
          );
          const selectorAttempts = [
            { selector: finalSelector, selectorType: finalSelectorType },
            ...candidateVisibleTextLocators(args.candidateAction),
            ...candidateSelectorLocators(args.candidateAction),
          ].filter((entry, index, entries) => {
            if (!entry.selector) return false;
            return (
              entries.findIndex(
                (candidate) =>
                  candidate.selector === entry.selector &&
                  candidate.selectorType === entry.selectorType,
              ) === index
            );
          });
          const selectorErrors: string[] = [];
          const resolveHoverTargetBySelector = async (entry: {
            selector: string;
            selectorType: CandidateActionSelectorType;
          }): Promise<boolean> => {
            const resolved = await this.sendMessageToTab(
              resolvedTabId,
              {
                action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
                selector: entry.selector,
                isXPath: entry.selectorType === 'xpath',
                allowMultiple: true,
              },
              finalFrameId,
            );
            if (resolved && resolved.success && resolved.ref) {
              finalRef = resolved.ref;
              finalSelector = undefined;
              resolvedTarget = {
                selector: entry.selector,
                selectorType: entry.selectorType,
                ...(typeof finalFrameId === 'number' ? { frameId: finalFrameId } : {}),
                source:
                  entry.selectorType === 'xpath'
                    ? 'candidate_locator_xpath'
                    : 'candidate_locator_css',
              };
              return true;
            }
            selectorErrors.push(
              `${entry.selectorType}:${resolved?.error || 'unknown error'}`.slice(0, 240),
            );
            return false;
          };

          for (const attempt of selectorAttempts) {
            try {
              if (await resolveHoverTargetBySelector(attempt)) break;
            } catch (error) {
              selectorErrors.push(
                `${attempt.selectorType}:${
                  error instanceof Error ? error.message : String(error)
                }`.slice(0, 240),
              );
            }
          }

          if (!finalRef) {
            try {
              await resolveHoverTargetByVisibleText();
            } catch (fallbackError) {
              selectorErrors.push(
                `text:${
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                }`.slice(0, 240),
              );
            }
          }

          if (!finalRef) {
            try {
              if (!(await resolveHoverTargetBySnapshotPoint())) {
                selectorErrors.push('point:snapshot rect did not resolve a visible target');
              }
            } catch (pointError) {
              selectorErrors.push(
                `point:${pointError instanceof Error ? pointError.message : String(pointError)}`.slice(
                  0,
                  240,
                ),
              );
            }
          }

          if (!finalRef) {
            return createStructuredClickHelperErrorResponse({
              message: `Failed to resolve hover selector chain: ${
                selectorErrors.join('; ') || 'unknown error'
              }`,
              clickMethod: requestedClickMethod,
              targetBinding: buildTargetBinding(),
            });
          }
        }

        if (!finalRef && !finalSelector) {
          await resolveHoverTargetBySnapshotPoint();
        }

        if (!finalRef) {
          return createStructuredClickHelperErrorResponse({
            message:
              ERROR_MESSAGES.INVALID_PARAMETERS +
              ': Safe hover requires a resolvable element ref from chrome_read_page',
            clickMethod: requestedClickMethod,
            targetBinding: buildTargetBinding(),
          });
        }

        await this.injectContentScript(
          tab.id,
          ['inject-scripts/accessibility-tree-helper.js'],
          false,
          'ISOLATED',
          false,
          typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
        );
        const hoverResult = await this.sendMessageToTab(
          tab.id,
          {
            action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
            ref: finalRef,
          },
          finalFrameId,
        );
        if (!hoverResult?.success) {
          return createStructuredClickHelperErrorResponse({
            message: hoverResult?.error || 'Hover dispatch failed',
            clickMethod: requestedClickMethod,
            elementInfo: hoverResult?.target,
            targetBinding: buildTargetBinding(),
          });
        }

        const hoverActionId = `hover-${tab.id}-${Date.now()}`;
        const hoverPostActionReadback = buildPostActionReadbackEvidence({
          candidateAction: effectiveCandidateAction,
          dispatchSucceeded: true,
          actionKind: 'hover',
          observedOutcome: 'verification_required',
        });
        const hoverPostActionDelta = buildBrowserActionPostActionDelta({
          actionId: hoverActionId,
          actionKind: 'hover',
          tabId: tab.id,
          targetRef: finalRef,
          observedOutcome: 'verification_required',
          clickDiff: null,
          verification: null,
          postActionReadback: hoverPostActionReadback,
          extraChangedSignals: ['hover_dispatched', 'floating_panel_readback_required'],
        });
        recordPendingActionBinding(tab.id, {
          actionId: hoverActionId,
          targetRef: finalRef,
          actionIntent: effectiveCandidateAction?.intent ?? 'hover',
        });
        markBrowserWorldTabAiOperated(tab.id, 'click_element_hover');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                actionId: hoverActionId,
                dispatchSucceeded: true,
                interaction: 'hover',
                observedOutcome: 'verification_required',
                verification: {
                  requiresFreshReadPage: true,
                  menuExpansionProven: false,
                  businessSuccessProven: false,
                },
                lane: TABRIX_OWNED_LANE,
                targetBinding: buildTargetBinding(),
                businessVerification: buildBusinessVerification(true, 'verification_required'),
                postActionReadback: hoverPostActionReadback,
                postActionDelta: hoverPostActionDelta,
                floatingPanelReadback: {
                  status: 'fresh_read_required',
                  expectedSurface: 'floating_panel_or_menu',
                  requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
                  expectedObjects: [
                    'searchSurface.filterPanel',
                    'searchSurface.filterPanel.targetableOptions',
                    'searchSurface.filterState',
                    'candidateActions',
                  ],
                  reason:
                    'Hover dispatch can reveal transient panels that are only safe to trust after a fresh same-tab page read.',
                  claimBoundary:
                    'This proves only that hover was dispatched to a known target. Floating-panel content, active state, and result changes must be verified from the next read_page snapshot.',
                },
                message:
                  'Hover dispatched to a known element; run chrome_read_page again to verify floating-panel/menu objects, targetable options, active state, and result deltas.',
                elementInfo: hoverResult.target,
                hoverMethod: 'ref',
              }),
            },
          ],
          isError: false,
        };
      }

      if (args.allowDownloadClick !== true) {
        const preflight = await this.preflightDownloadIntercept(tab.id, {
          selector: finalSelector,
          ref: finalRef,
          frameId: finalFrameId,
        });
        if (preflight.interceptedDownload && preflight.downloadUrl) {
          const downloadResult = await handleDownloadTool.execute({
            url: String(preflight.downloadUrl),
            filename: preflight.downloadFilename ? String(preflight.downloadFilename) : undefined,
            saveAs: false,
            waitForComplete: true,
            timeoutMs: 60000,
          });

          if (downloadResult.isError) {
            return createErrorResponse(
              `Download link preflight intercept failed: ${
                (downloadResult.content?.[0] as any)?.text || 'unknown error'
              }`,
            );
          }

          markBrowserWorldTabAiOperated(tab.id, 'click_download_intercepted');
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  message:
                    'Download link was preflight-intercepted and handled via chrome_handle_download (silent mode).',
                  clickMethod: 'intercepted-download',
                  downloadUrl: preflight.downloadUrl,
                  downloadFilename: preflight.downloadFilename || null,
                  download: (() => {
                    try {
                      return JSON.parse((downloadResult.content?.[0] as any)?.text || '{}')
                        ?.download;
                    } catch {
                      return null;
                    }
                  })(),
                }),
              },
            ],
            isError: false,
          };
        }
      }

      await this.injectContentScript(
        tab.id,
        ['inject-scripts/click-helper.js'],
        false,
        'ISOLATED',
        false,
        typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
      );
      await prearmDialogHandling(tab.id);
      if (args.allowDownloadClick === true) {
        markNextDownloadAsInteractive(tab.id);
      }

      // Arm the action-outcome observer right before dispatch. Best-effort;
      // the helper returns a no-op handle when the bridge socket is not yet
      // up, so the click main path is untouched on failure. The dispatched
      // envelope's `urlPattern` is the brand-neutral host+path form (no
      // query/fragment) that the lifecycle/network observers already use.
      const actionUrlPattern = (() => {
        if (typeof beforeUrl !== 'string') return null;
        try {
          const u = new URL(beforeUrl);
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
          return `${u.hostname.toLowerCase()}${u.pathname || '/'}`;
        } catch {
          return null;
        }
      })();
      const clickActionId = `click-${tab.id}-${Date.now()}`;
      const actionOutcomeHandle = armActionOutcome({
        actionId: clickActionId,
        actionKind: 'click',
        tabId: tab.id,
        urlPattern: actionUrlPattern,
      });

      // Arm browser-level observation before dispatch, but keep it alive until
      // the page-local helper has finished its own verification window. This
      // prevents a slow `_blank` click from being downgraded to
      // `no_observed_change` just because the background observer stopped first.
      const candidateIntent =
        typeof effectiveCandidateAction?.intent === 'string'
          ? effectiveCandidateAction.intent
          : undefined;
      const dispatchTiming = buildClickHelperDispatchTimingPolicy({
        waitForNavigation,
        timeout,
        intent: candidateIntent,
      });
      const rawResultPromise = this.sendMessageToTab(
        tab.id,
        {
          action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
          selector: finalSelector,
          coordinates,
          ref: finalRef,
          waitForNavigation: dispatchTiming.waitForNavigation,
          timeout: dispatchTiming.timeout,
          double: args.double === true,
          button,
          bubbles,
          cancelable,
          modifiers,
          allowDownloadClick: args.allowDownloadClick === true,
          intent: candidateIntent,
        },
        finalFrameId,
      );
      const resultPromise = withClickHelperResponseTimeout(
        rawResultPromise,
        buildClickHelperResponseTimeoutMs(dispatchTiming),
      );
      const verifierRequested = isVerifierContextRequested(args.verifierContext);
      const newTabObservationMaxMs = verifierRequested
        ? NEW_TAB_OBSERVE_DRAIN_VERIFIER_MS
        : NEW_TAB_OBSERVE_AMBIGUOUS_CAP_MS;
      const browserSignalsPromise = observeNewTabUntil(tab.windowId, resultPromise, {
        maxMs: newTabObservationMaxMs,
        verifierRequested,
      });

      // Send click message to content script
      let result: any;
      let actionOutcomeSignalError: string | null = null;
      try {
        result = await resultPromise;
      } catch (error) {
        const browserSignals = await browserSignalsPromise;
        const isResponseTimeout = error instanceof ClickHelperResponseTimeoutError;
        const reason = isResponseTimeout ? 'click_helper_response_timeout' : 'click_dispatch_error';
        const businessVerification = buildBusinessVerification(false, 'no_observed_change');
        const postActionReadback = buildPostActionReadbackEvidence({
          candidateAction: effectiveCandidateAction,
          dispatchSucceeded: false,
          actionKind: 'click',
          observedOutcome: 'no_observed_change',
        });
        const targetBinding = buildTargetBinding();
        const actionEvidenceResult = buildClickActionEvidenceResult({
          actionId: clickActionId,
          actionKind: 'click',
          tabId: tab.id,
          targetBinding,
          candidateAction: effectiveCandidateAction,
          finalRef,
          finalSelector,
          coordinates,
          dispatchSucceeded: false,
          postActionReadback,
          errorCode: reason,
        });
        return createStructuredClickHelperErrorResponse({
          message: isResponseTimeout
            ? `Click helper did not return before the background response deadline (${error.timeoutMs}ms)`
            : `Click helper dispatch failed: ${
                error instanceof Error ? error.message : String(error)
              }`,
          clickMethod: requestedClickMethod,
          browserSignals,
          actionId: clickActionId,
          tabId: tab.id,
          targetBinding,
          reason,
          businessVerification,
          postActionReadback,
          actionEvidenceResult,
        });
      }

      // Surface page-local DOM-region changes to the action-outcome observer
      // (best-effort). The observer also folds in background-derived signals
      // (lifecycle/tab/network) on its own.
      try {
        const pageSig = result && typeof result === 'object' ? (result as any).signals : null;
        // Real click-helper field names are `domChanged` / `domAddedDialog`
        // (see app/chrome-extension/inject-scripts/click-helper.js). The
        // `domRegionChanged` / `dialogOpened` aliases below exist only as a
        // forward-compat hook in case the helper is ever renamed; tests must
        // exercise the real names so we never silently regress.
        if (pageSig && (pageSig.domChanged === true || pageSig.domRegionChanged === true)) {
          actionOutcomeHandle.pushSignal({ kind: 'dom_region_changed' });
        }
        if (pageSig && (pageSig.domAddedDialog === true || pageSig.dialogOpened === true)) {
          actionOutcomeHandle.pushSignal({ kind: 'dialog_opened' });
        }
      } catch (error) {
        actionOutcomeSignalError = toErrorMessage(error);
      }

      if (result?.interceptedDownload && result?.downloadUrl) {
        const downloadResult = await handleDownloadTool.execute({
          url: String(result.downloadUrl),
          filename: result.downloadFilename ? String(result.downloadFilename) : undefined,
          saveAs: false,
          waitForComplete: true,
          timeoutMs: 60000,
        });

        if (downloadResult.isError) {
          return createErrorResponse(
            `Download link click was blocked and auto-download failed: ${
              (downloadResult.content?.[0] as any)?.text || 'unknown error'
            }`,
          );
        }

        markBrowserWorldTabAiOperated(tab.id, 'click_download_intercepted');
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                message:
                  'Download link was intercepted and handled via chrome_handle_download (silent mode).',
                clickMethod: 'intercepted-download',
                downloadUrl: result.downloadUrl,
                downloadFilename: result.downloadFilename || null,
                download: (() => {
                  try {
                    return JSON.parse((downloadResult.content?.[0] as any)?.text || '{}')?.download;
                  } catch {
                    return null;
                  }
                })(),
              }),
            },
          ],
          isError: false,
        };
      }

      // Determine actual click method used
      let clickMethod: string;
      if (coordinates) {
        clickMethod = 'coordinates';
      } else if (finalRef) {
        clickMethod = 'ref';
      } else if (finalSelector) {
        clickMethod = 'selector';
      } else {
        clickMethod = 'unknown';
      }

      // If the helper returned an explicit error, keep the response structured.
      // A plain text error is normalized later by native-server as a legacy
      // shape, which strips useful action diagnostics from AI-facing output.
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        const browserSignals = await browserSignalsPromise;
        const structuredError = result as {
          elementInfo?: unknown;
          reason?: unknown;
          targetConsistency?: unknown;
          actionRecovery?: ClickActionRecoveryGuidance;
        };
        const reason =
          typeof structuredError.reason === 'string' && structuredError.reason.trim()
            ? structuredError.reason.trim()
            : String(result.error);
        const postActionReadback = buildPostActionReadbackEvidence({
          candidateAction: effectiveCandidateAction,
          dispatchSucceeded: false,
          actionKind: 'click',
          observedOutcome: 'no_observed_change',
        });
        const targetBinding = buildTargetBinding();
        const actionEvidenceResult = buildClickActionEvidenceResult({
          actionId: clickActionId,
          actionKind: 'click',
          tabId: tab.id,
          targetBinding,
          candidateAction: effectiveCandidateAction,
          finalRef,
          finalSelector,
          coordinates,
          dispatchSucceeded: false,
          postActionReadback,
          errorCode: reason,
        });
        return createStructuredClickHelperErrorResponse({
          message: String(result.error),
          clickMethod,
          elementInfo: structuredError.elementInfo,
          browserSignals,
          actionId: clickActionId,
          tabId: tab.id,
          targetBinding,
          reason,
          targetConsistency: structuredError.targetConsistency,
          actionRecovery: structuredError.actionRecovery,
          businessVerification: buildBusinessVerification(false, 'no_observed_change'),
          postActionReadback,
          actionEvidenceResult,
        });
      }

      const browserSignals = await browserSignalsPromise;
      const pageSignals: ClickPageSignals | null =
        result && typeof result === 'object' && 'signals' in result && result.signals
          ? (result.signals as ClickPageSignals)
          : null;
      const dispatchSucceeded =
        result && typeof result === 'object' && 'dispatchSucceeded' in result
          ? Boolean(result.dispatchSucceeded)
          : Boolean(result?.success);

      const merged = mergeClickSignals(dispatchSucceeded, pageSignals, browserSignals);
      // Optional family-aware verifier. Runs at most one compact readback.
      // `success` collapses to false if the verifier was requested and did
      // not pass; otherwise the generic click contract is preserved as-is.
      let postClickState: {
        beforeUrl: string | null;
        afterUrl: string | null;
        pageRoleAfter: string | null;
        verifierPassed: boolean;
        verifierReason: string;
      } | null = null;
      let finalSuccess = merged.success;
      if (isVerifierContextRequested(args.verifierContext)) {
        let verifierResult: ClickVerifierResult | null = null;
        if (merged.dispatchSucceeded) {
          verifierResult = await runClickVerifier(tab.id, args.verifierContext!, beforeUrl);
        }
        if (verifierResult) {
          postClickState = {
            beforeUrl: verifierResult.beforeUrl,
            afterUrl: verifierResult.afterUrl,
            pageRoleAfter: verifierResult.pageRoleAfter,
            verifierPassed: verifierResult.passed,
            verifierReason: verifierResult.reason,
          };
          if (!verifierResult.passed) {
            finalSuccess = false;
          }
        } else {
          postClickState = {
            beforeUrl,
            afterUrl: null,
            pageRoleAfter: null,
            verifierPassed: false,
            verifierReason: merged.dispatchSucceeded
              ? 'verifier_unavailable'
              : 'verifier_skipped_dispatch_failed',
          };
          finalSuccess = false;
        }
      }

      if (merged.dispatchSucceeded) {
        markBrowserWorldTabAiOperated(tab.id, 'click_element');
      }
      if (merged.dispatchSucceeded) {
        recordPendingActionBinding(tab.id, {
          actionId: clickActionId,
          targetRef: finalRef ?? effectiveCandidateAction?.targetRef ?? null,
          actionIntent: effectiveCandidateAction?.intent ?? 'click',
        });
      }
      const businessVerification = buildBusinessVerification(
        merged.dispatchSucceeded,
        merged.observedOutcome,
      );
      const postActionReadback = buildPostActionReadbackEvidence({
        candidateAction: effectiveCandidateAction,
        dispatchSucceeded: merged.dispatchSucceeded,
        actionKind: 'click',
        observedOutcome: merged.observedOutcome,
        verifierPassed: postClickState?.verifierPassed ?? null,
        verifierReason: postClickState?.verifierReason ?? null,
      });
      const targetBinding = buildTargetBinding();
      const actionEvidenceResult = buildClickActionEvidenceResult({
        actionId: clickActionId,
        actionKind: 'click',
        tabId: tab.id,
        targetBinding,
        candidateAction: effectiveCandidateAction,
        finalRef,
        finalSelector,
        coordinates,
        dispatchSucceeded: merged.dispatchSucceeded,
        postActionReadback,
        errorCode: merged.dispatchSucceeded ? null : merged.observedOutcome,
      });
      const clickDiff = buildClickDiffSummary(pageSignals, browserSignals);
      const postActionDelta = buildBrowserActionPostActionDelta({
        actionId: clickActionId,
        actionKind: 'click',
        tabId: tab.id,
        targetRef: finalRef ?? effectiveCandidateAction?.targetRef ?? null,
        observedOutcome: merged.observedOutcome,
        clickDiff,
        verification: merged.verification,
        postActionReadback,
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: finalSuccess,
              dispatchSucceeded: merged.dispatchSucceeded,
              observedOutcome: merged.observedOutcome,
              verification: merged.verification,
              clickDiff,
              postActionDelta,
              ...(actionOutcomeSignalError
                ? {
                    actionOutcomeDiagnostics: {
                      signalForwardingError: actionOutcomeSignalError,
                    },
                  }
                : {}),
              // One-release compat field; equals verification.navigationOccurred.
              navigationOccurred: merged.verification.navigationOccurred,
              // Explicit lane label. Always `tabrix_owned` for the
              // extension-first execution path. If a future fallback route is
              // added, that route MUST emit a different lane value so silent
              // lane drift is visible to lane-integrity metrics.
              lane: TABRIX_OWNED_LANE,
              targetBinding,
              businessVerification,
              postconditionStatus: businessVerification,
              postActionReadback,
              actionEvidenceResult,
              message: finalSuccess
                ? `Click observed outcome: ${merged.observedOutcome}`
                : merged.observedOutcome === 'no_observed_change'
                  ? 'Click was dispatched but no observable outcome was detected within the verification window'
                  : postClickState && !postClickState.verifierPassed
                    ? `Click dispatched but verifier rejected the outcome (${postClickState.verifierReason})`
                    : `Click dispatched; outcome unverified (${merged.observedOutcome})`,
              elementInfo: result?.elementInfo,
              clickMethod,
              ...(postClickState ? { postClickState } : {}),
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in click operation:', error);
      return createStructuredClickHelperErrorResponse({
        message: `Error performing click: ${error instanceof Error ? error.message : String(error)}`,
        clickMethod: requestedClickMethod,
      });
    }
  }
}

export const clickTool = new ClickTool();

interface FillToolParams {
  selector?: string;
  selectorType?: 'css' | 'xpath'; // Type of selector (default: 'css')
  ref?: string; // Element ref from accessibility tree
  candidateAction?: CandidateActionInput; // Optional action seed from read_page
  // Accept string | number | boolean for broader form input coverage
  value: string | number | boolean;
  frameId?: number;
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
}

interface FillHelperResult {
  success?: boolean;
  error?: string;
  message?: string;
  elementInfo?: {
    tagName?: string;
    type?: string;
    valueState?: 'empty' | 'non_empty' | 'unknown';
    checked?: boolean;
    selectedOptionCount?: number;
    textContent?: string;
  };
}

function buildFillLogSummary(args: FillToolParams): Record<string, unknown> {
  return {
    hasSelector: typeof args.selector === 'string' && args.selector.length > 0,
    selectorType: args.selectorType ?? 'css',
    hasRef: typeof args.ref === 'string' && args.ref.length > 0,
    hasCandidateAction: args.candidateAction != null,
    candidateActionIntent:
      typeof args.candidateAction?.intent === 'string' ? args.candidateAction.intent : null,
    valueState: args.value === undefined || args.value === null ? 'missing' : 'provided',
    valueType: typeof args.value,
    tabId: typeof args.tabId === 'number' ? args.tabId : null,
    windowId: typeof args.windowId === 'number' ? args.windowId : null,
    frameId: typeof args.frameId === 'number' ? args.frameId : null,
  };
}

/**
 * Tool for filling form elements on web pages
 */
class FillTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.FILL;

  private async sendFillMessageWithRetry(
    tabId: number,
    message: Record<string, unknown>,
    frameId?: number,
  ): Promise<FillHelperResult> {
    try {
      return await this.sendMessageToTab(tabId, message, frameId);
    } catch (error) {
      await this.sleep(FILL_CONTENT_MESSAGE_RETRY_DELAY_MS);
      await this.injectContentScript(
        tabId,
        ['inject-scripts/fill-helper.js'],
        false,
        'ISOLATED',
        false,
        typeof frameId === 'number' ? [frameId] : undefined,
      );
      return await this.sendMessageToTab(tabId, message, frameId);
    }
  }

  /**
   * Execute fill operation
   */
  async execute(args: FillToolParams): Promise<ToolResult> {
    const { selector, selectorType = 'css', ref, value, frameId } = args;

    console.log(`Starting fill operation with options:`, buildFillLogSummary(args));

    if (!selector && !ref && !args.candidateAction) {
      return createErrorResponse(
        ERROR_MESSAGES.INVALID_PARAMETERS + ': Provide ref or selector (or candidateAction)',
      );
    }

    if (value === undefined || value === null) {
      return createErrorResponse(ERROR_MESSAGES.INVALID_PARAMETERS + ': Value must be provided');
    }

    try {
      const explicit = await this.tryGetTab(args.tabId);
      let tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }
      const tabId = tab.id;
      const initialNavigationUrl = getTabNavigationUrl(tab);
      if (
        explicit &&
        (tab.status === 'loading' || !tab.url) &&
        /^https?:\/\//i.test(initialNavigationUrl)
      ) {
        const settleResult = await this.waitForTabSettled(tabId, {
          timeoutMs: FILL_PENDING_DOCUMENT_WAIT_MS,
        });
        tab = settleResult.tab;
      }

      const schemeGuard = inferInteractionSchemeGuard(getTabNavigationUrl(tab));
      if (!schemeGuard.allowed) {
        return createUnsupportedTabResponse('fill', tab, schemeGuard);
      }

      await hydrateStableTargetRefRegistryFromStorage(tabId);

      const resolvedTarget = resolveCandidateActionTarget({
        explicitRef: ref,
        explicitSelector: selector,
        explicitSelectorType: selectorType,
        candidateAction: args.candidateAction,
        tabId,
        lookupStableTargetRef: lookupStableTargetRefEntry,
        lookupCandidateActionTargetLocator: lookupCandidateActionTargetLocatorEntry,
      });

      // Same fail-closed rule as clickTool: if the caller passed a stable
      // targetRef and the registry has nothing for this tab, tell them
      // exactly how to recover instead of probing the DOM.
      if (resolvedTarget.source === 'unresolved_stable_target_ref') {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: candidateAction.targetRef "${
            resolvedTarget.unresolvedStableTargetRef
          }" is a stable id, but no current snapshot of this tab has it. Call chrome_read_page on this tab first, then re-issue the fill with the latest targetRef.`,
        );
      }

      let finalRef = resolvedTarget.ref;
      let finalSelector = resolvedTarget.selector;
      const finalSelectorType = resolvedTarget.selectorType || selectorType;
      const finalFrameId = typeof frameId === 'number' ? frameId : resolvedTarget.frameId;
      const candidateCssFallback = firstCandidateCssLocator(args.candidateAction);
      let dispatchedFillTarget: { ref?: string; selector?: string } | null = null;
      const buildTargetBinding = () =>
        buildActionTargetBindingEvidence({
          explicitFrameId: frameId,
          candidateAction: args.candidateAction,
          resolvedTarget,
          finalRef: dispatchedFillTarget?.ref,
          finalSelector: dispatchedFillTarget?.selector,
          coordinates: null,
        });
      const buildBusinessVerification = () =>
        buildActionBusinessVerificationPlan({
          candidateAction: args.candidateAction,
          dispatchSucceeded: true,
          actionKind: 'fill',
          observedOutcome: null,
        });

      if (!finalRef && !finalSelector) {
        return createErrorResponse(
          ERROR_MESSAGES.INVALID_PARAMETERS +
            ': Provide ref or selector (candidateAction did not resolve target)',
        );
      }

      // If selector is XPath, convert to ref first
      if (finalSelector && finalSelectorType === 'xpath') {
        await this.injectContentScript(
          tabId,
          ['inject-scripts/accessibility-tree-helper.js'],
          false,
          'ISOLATED',
          false,
          typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
        );
        try {
          const resolved = await this.sendMessageToTab(
            tabId,
            {
              action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
              selector: finalSelector,
              isXPath: true,
            },
            finalFrameId,
          );
          if (resolved && resolved.success && resolved.ref) {
            finalRef = resolved.ref;
            finalSelector = undefined; // Use ref instead of selector
          } else {
            return createErrorResponse(
              `Failed to resolve XPath selector: ${resolved?.error || 'unknown error'}`,
            );
          }
        } catch (error) {
          return createErrorResponse(
            `Error resolving XPath: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      await this.injectContentScript(
        tabId,
        ['inject-scripts/fill-helper.js'],
        false,
        'ISOLATED',
        false,
        typeof finalFrameId === 'number' ? [finalFrameId] : undefined,
      );

      // Send fill message to content script
      const sendFill = (message: Record<string, unknown>) =>
        this.sendFillMessageWithRetry(tabId, message, finalFrameId);
      const primaryFillMessage = {
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: finalSelector,
        ref: finalRef,
        value,
      };
      const cssFallbackFillMessage = {
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: candidateCssFallback,
        value,
      };
      let result: FillHelperResult;
      try {
        result = await sendFill(primaryFillMessage);
        dispatchedFillTarget = { ref: finalRef, selector: finalSelector };
      } catch (error) {
        if (
          shouldRetryFillWithCandidateCss({
            explicitRef: ref,
            finalRef,
            finalSelector,
            candidateCss: candidateCssFallback,
            error,
          })
        ) {
          result = await sendFill(cssFallbackFillMessage);
          dispatchedFillTarget = { selector: candidateCssFallback };
        } else {
          throw error;
        }
      }

      if (
        result?.error &&
        shouldRetryFillWithCandidateCss({
          explicitRef: ref,
          finalRef,
          finalSelector,
          candidateCss: candidateCssFallback,
          error: result.error,
        })
      ) {
        result = await sendFill(cssFallbackFillMessage);
        dispatchedFillTarget = { selector: candidateCssFallback };
      }

      if (result && result.error) {
        return createErrorResponse(result.error);
      }
      if (!dispatchedFillTarget) {
        dispatchedFillTarget = { ref: finalRef, selector: finalSelector };
      }

      const actionId = `fill-${tabId}-${Date.now()}`;
      const actionTargetRef = dispatchedFillTarget.ref ?? args.candidateAction?.targetRef ?? null;
      recordPendingActionBinding(tabId, {
        actionId,
        targetRef: actionTargetRef,
        actionIntent: args.candidateAction?.intent ?? 'fill',
      });
      markBrowserWorldTabAiOperated(tabId, 'fill_or_select');
      const postActionReadback = buildPostActionReadbackEvidence({
        candidateAction: args.candidateAction,
        dispatchSucceeded: true,
        actionKind: 'fill',
        observedOutcome: 'input_value_written',
      });
      const inputWriteProofStatus =
        result.elementInfo?.valueState === 'non_empty' ||
        result.elementInfo?.valueState === 'empty' ||
        typeof result.elementInfo?.checked === 'boolean'
          ? 'input_state_observed'
          : 'not_proven';
      const postActionDelta = buildBrowserActionPostActionDelta({
        actionId,
        actionKind: 'fill',
        tabId,
        targetRef: actionTargetRef,
        observedOutcome: 'input_value_written',
        postActionReadback,
        extraChangedSignals:
          inputWriteProofStatus === 'input_state_observed' ? ['input_state_observed'] : [],
      });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: result.message || 'Fill operation successful',
              elementInfo: result.elementInfo,
              targetBinding: buildTargetBinding(),
              businessVerification: buildBusinessVerification(),
              postActionReadback,
              postActionDelta,
              inputWriteEvidence: {
                valueState: result.elementInfo?.valueState ?? 'unknown',
                checked:
                  typeof result.elementInfo?.checked === 'boolean'
                    ? result.elementInfo.checked
                    : null,
                proofStatus: inputWriteProofStatus,
                claimBoundary:
                  'This evidence never returns the raw input value; it only reports whether the target state is empty/non-empty or checked.',
              },
              observedOutcome: null,
              postconditionVerdict: 'unknown',
              postconditionReason: 'form_input_state_change_not_proven_by_tool_closeout',
              recommendedNextAction:
                'Call chrome_read_page after this action to compare page/form state before claiming task success.',
              claimBoundary:
                'fill success only proves the input dispatch completed; it does not prove form/search result state changed',
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      console.error('Error in fill operation:', error);
      return createErrorResponse(
        `Error filling element: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const fillTool = new FillTool();
