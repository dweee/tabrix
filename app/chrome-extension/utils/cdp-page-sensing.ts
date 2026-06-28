import { cdpSessionManager } from './cdp-session-manager';

export type CDPPageReadiness = 'loading' | 'interactive' | 'complete' | 'unknown';

export interface CDPPageUrlSummary {
  href: string;
  origin: string;
  host: string;
  pathname: string;
  scheme: string;
  hasQuery: boolean;
  hasHash: boolean;
}

export interface CDPActiveElementSummary {
  tagName: string;
  type?: string;
  role?: string;
  idPresent: boolean;
  namePresent: boolean;
}

export interface CDPNavigationTimingSummary {
  type?: string;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
}

export interface CDPRouteSummary {
  href: string;
  pathname: string;
  hasQuery: boolean;
  hasHash: boolean;
  fingerprint?: string;
  historyLength: number | null;
}

export interface CDPNetworkEventSummary {
  requestStartedCount: number;
  inFlightCount: number;
  failedRequestCount: number;
}

export interface CDPNetworkResourceSummary {
  resourceEntryCount: number;
  resourceInFlightCount: number;
  failedResourceStatusCount: number;
}

export interface CDPConsoleSummary {
  errorCount: number;
  warningCount: number;
}

export interface CDPAccessibilityStateSignals {
  checkedCount: number;
  selectedCount: number;
  expandedCount: number;
  disabledCount: number;
}

export interface CDPAccessibilityObjectStateSignals {
  checked?: boolean;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
}

export interface CDPAccessibilityObjectLocator {
  source: 'cdp_ax';
  axNodeId?: string;
  backendDOMNodeId?: number;
  cssSelector?: string;
  nodeName?: string;
  visualBounds?: CDPElementRect;
}

export interface CDPElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeVisibilityProbe {
  domVisible: boolean;
  inViewport: boolean;
  centerHitTarget: boolean | null;
  occluded: boolean;
  occludedBy?: string;
  reason: string;
}

export interface CDPAccessibilityObjectCandidate {
  role: string;
  label?: string;
  locator?: CDPAccessibilityObjectLocator;
  actionTypes: string[];
  state: CDPAccessibilityObjectStateSignals;
  visibilityProbe?: NodeVisibilityProbe;
}

export interface CDPAccessibilityRoleFrequency {
  role: string;
  count: number;
}

export interface CDPAccessibilityLocatorCoverage {
  locatorCandidateCount: number;
  axNodeIdCount: number;
  backendDOMNodeIdCount: number;
  locatorCoverageRate: number;
}

export interface CDPAccessibilitySummary {
  totalNodes: number;
  actionableNodeCount: number;
  actionableRoleTop: CDPAccessibilityRoleFrequency[];
  actionableSampleLabels: string[];
  stateSignals: CDPAccessibilityStateSignals;
  locatorCoverage: CDPAccessibilityLocatorCoverage;
  objectCandidates: CDPAccessibilityObjectCandidate[];
}

export type CDPPageStabilityHint = 'stable' | 'spa_navigating' | 'loading' | 'restricted';

export interface CDPPageSensingSnapshot {
  tabId: number;
  capturedAt: number;
  source: 'cdp';
  available: boolean;
  readiness: CDPPageReadiness;
  likelyLoading: boolean;
  stabilityHint: CDPPageStabilityHint;
  url?: CDPPageUrlSummary;
  title?: string;
  route?: CDPRouteSummary;
  visibilityState?: string;
  focused?: boolean;
  activeElement?: CDPActiveElementSummary;
  frameCount?: number;
  topFrameUrl?: CDPPageUrlSummary;
  navigation?: CDPNavigationTimingSummary;
  networkActivity?: CDPNetworkEventSummary;
  networkResources?: CDPNetworkResourceSummary;
  console?: CDPConsoleSummary;
  accessibility?: CDPAccessibilitySummary;
  partialErrors?: string[];
  error?: string;
}

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
    objectId?: string;
  };
}

interface CDPFrameTreeResponse {
  frameTree?: CDPFrameTree;
}

interface CDPFrameTree {
  frame?: {
    url?: string;
  };
  childFrames?: CDPFrameTree[];
}

const CDP_PAGE_SENSING_OWNER = 'page-sensing';
const MAX_TEXT_LENGTH = 160;
const CDP_PAGE_SENSING_EVENT_WINDOW_MS = 90;
const SPA_NETWORK_BURST_REQUEST_THRESHOLD = 3;
const SPA_NETWORK_BURST_INFLIGHT_THRESHOLD = 2;
const MAX_ACCESSIBILITY_SAMPLE_LABELS = 6;
const MAX_ACCESSIBILITY_ACTIONABLE_ROLE_KEYS = 6;
const MAX_ACCESSIBILITY_OBJECT_CANDIDATES = 24;
const ACCESSIBILITY_OBJECT_CANDIDATE_POOL_LIMIT = 160;
const ACCESSIBILITY_ACTIONABLE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'radio',
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'listbox',
  'menuitem',
  'tab',
  'menuitemcheckbox',
  'option',
  'switch',
]);

const PAGE_STATE_PROBE = String.raw`(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const active = document.activeElement;
  const resourceEntries = performance.getEntriesByType('resource');
  const resourceSummary = resourceEntries.reduce(
    (acc, entry) => {
      const perfEntry = entry as PerformanceResourceTiming;
      acc.resourceEntryCount += 1;
      const responseEnd = typeof perfEntry.responseEnd === 'number' ? perfEntry.responseEnd : null;
      const responseStatus = (perfEntry as { responseStatus?: unknown }).responseStatus;
      if (responseEnd === 0) acc.resourceInFlightCount += 1;
      if (typeof responseStatus === 'number' && responseStatus >= 400 && responseStatus < 600) {
        acc.failedResourceStatusCount += 1;
      }
      return acc;
    },
    { resourceEntryCount: 0, resourceInFlightCount: 0, failedResourceStatusCount: 0 },
  );
 return {
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    networkResources: resourceSummary,
    url: location.href,
    title: document.title,
    route: {
      url: location.href,
      historyLength: Number.isFinite(history.length) ? history.length : null,
    },
    activeElement: active
      ? {
          tagName: active.tagName,
          type: active.getAttribute('type') || undefined,
          role: active.getAttribute('role') || undefined,
          idPresent: Boolean(active.id),
          namePresent: Boolean(active.getAttribute('name')),
        }
      : null,
    navigation: nav
      ? {
          type: nav.type,
          responseEndMs: nav.responseEnd || null,
          domContentLoadedMs: nav.domContentLoadedEventEnd || null,
          loadEventMs: nav.loadEventEnd || null,
        }
      : null,
  };
})()`;

const NODE_VISIBILITY_PROBE = String.raw`function() {
  const element = this;
  if (!(element instanceof Element)) {
    return {
      domVisible: true,
      inViewport: false,
      centerHitTarget: null,
      occluded: false,
      reason: 'backend_node_unresolved',
    };
  }
  const viewportWidth =
    typeof window.innerWidth === 'number'
      ? window.innerWidth
      : typeof document.documentElement?.clientWidth === 'number'
        ? document.documentElement.clientWidth
        : 0;
  const viewportHeight =
    typeof window.innerHeight === 'number'
      ? window.innerHeight
      : typeof document.documentElement?.clientHeight === 'number'
        ? document.documentElement.clientHeight
        : 0;
  const computed = window.getComputedStyle(element);
  const rect = typeof element.getBoundingClientRect === 'function' ? element.getBoundingClientRect() : null;
  const offsetParentMissing = element instanceof HTMLElement && element.offsetParent === null;
  const position = computed.position || '';
  const displayNone = computed.display === 'none';
  const hiddenVisibility = computed.visibility === 'hidden' || computed.visibility === 'collapse';
  const opacityZero = Number.parseFloat(computed.opacity || '1') === 0;
  const zeroSize =
    !rect ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    element.clientWidth <= 0 ||
    element.clientHeight <= 0;
  const detachedByOffsetParent = offsetParentMissing && position !== 'fixed';
  const domVisible = !(displayNone || hiddenVisibility || opacityZero || zeroSize || detachedByOffsetParent);
  const inViewport = Boolean(
    rect && rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight,
  );
  let centerHitTarget = null;
  let occluded = false;
  let occludedBy;
  if (rect && rect.width > 0 && rect.height > 0) {
    const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), Math.max(viewportWidth - 1, 0));
    const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), Math.max(viewportHeight - 1, 0));
    const hit = document.elementFromPoint(cx, cy);
    if (hit) {
      centerHitTarget = element === hit || element.contains(hit);
      occluded = !centerHitTarget;
      if (occluded) {
        const tagName = typeof hit.tagName === 'string' ? hit.tagName.toLowerCase() : undefined;
        if (tagName) occludedBy = tagName;
      }
    } else {
      centerHitTarget = false;
      occluded = true;
    }
  }
  const reasons = [];
  if (displayNone) reasons.push('display_none');
  if (hiddenVisibility) reasons.push('visibility_hidden');
  if (opacityZero) reasons.push('opacity_zero');
  if (detachedByOffsetParent) reasons.push('offset_parent_null');
  if (zeroSize) reasons.push('zero_size');
  if (!inViewport) reasons.push('outside_viewport');
  if (occluded) reasons.push('center_occluded');
  if (reasons.length === 0) reasons.push('visible_unobstructed');
  return {
    domVisible,
    inViewport,
    centerHitTarget,
    occluded,
    ...(occludedBy ? { occludedBy } : {}),
    reason: reasons.join('+'),
  };
}`;

export async function captureCDPPageSensingSnapshot(
  tabId: number,
): Promise<CDPPageSensingSnapshot> {
  const capturedAt = Date.now();
  const networkActivity: CDPNetworkEventSummary = {
    requestStartedCount: 0,
    inFlightCount: 0,
    failedRequestCount: 0,
  };
  const consoleSummary: CDPConsoleSummary = { errorCount: 0, warningCount: 0 };
  const startedRequests = new Set<string>();
  const inFlightRequests = new Set<string>();
  const failedRequests = new Set<string>();
  let topFrameNavigatedAfterReady = false;
  let navigatedFrameUrl: string | undefined;
  const partialErrors: string[] = [];
  const recordPartialError = (code: string): void => {
    if (!partialErrors.includes(code)) partialErrors.push(code);
  };

  try {
    return await cdpSessionManager.withSession(tabId, CDP_PAGE_SENSING_OWNER, async () => {
      const eventListener = (
        source: { tabId?: number },
        method: string,
        params?: unknown,
      ): void => {
        if (source?.tabId !== tabId) return;
        if (method === 'Network.requestWillBeSent') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          if (!startedRequests.has(requestId)) {
            startedRequests.add(requestId);
            networkActivity.requestStartedCount += 1;
          }
          inFlightRequests.add(requestId);
          return;
        }
        if (method === 'Network.loadingFinished') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          inFlightRequests.delete(requestId);
          return;
        }
        if (method === 'Network.loadingFailed') {
          const requestId = asString((params as Record<string, unknown> | undefined)?.requestId);
          if (!requestId) return;
          inFlightRequests.delete(requestId);
          if (!failedRequests.has(requestId)) {
            failedRequests.add(requestId);
            networkActivity.failedRequestCount += 1;
          }
          return;
        }
        if (method === 'Page.frameNavigated') {
          const frame = asRecord((params as Record<string, unknown> | undefined)?.frame);
          const parentId = asString(frame?.parentId);
          if (parentId) return;
          topFrameNavigatedAfterReady = true;
          navigatedFrameUrl = asString(frame?.url);
          return;
        }
        if (method === 'Log.entryAdded') {
          const entry = asRecord((params as Record<string, unknown> | undefined)?.entry);
          const level = asString(entry?.level);
          if (!level) return;
          if (level === 'error' || level === 'fatal') consoleSummary.errorCount += 1;
          if (level === 'warning') consoleSummary.warningCount += 1;
        }
      };

      cdpSessionManager.addEventListener(eventListener);
      try {
        await Promise.all([
          cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => {
            recordPartialError('runtime_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Page.enable').catch(() => {
            recordPartialError('page_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Network.enable').catch(() => {
            recordPartialError('network_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Log.enable').catch(() => {
            recordPartialError('log_enable_failed');
            return undefined;
          }),
          cdpSessionManager.sendCommand(tabId, 'Accessibility.enable').catch(() => {
            recordPartialError('accessibility_enable_failed');
            return undefined;
          }),
        ]);

        const [runtimeResult, frameTreeResult, accessibilityTreeResult] = await Promise.all([
          cdpSessionManager.sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.evaluate', {
            expression: PAGE_STATE_PROBE,
            returnByValue: true,
            silent: true,
          }),
          cdpSessionManager
            .sendCommand<CDPFrameTreeResponse>(tabId, 'Page.getFrameTree')
            .catch(() => {
              recordPartialError('frame_tree_unavailable');
              return undefined;
            }),
          cdpSessionManager
            .sendCommand(tabId, 'Accessibility.getFullAXTree', {
              depth: 6,
              fetchRelatives: false,
            })
            .catch(() => {
              recordPartialError('accessibility_tree_unavailable');
              return undefined;
            }),
        ]);

        await new Promise((resolve) => setTimeout(resolve, CDP_PAGE_SENSING_EVENT_WINDOW_MS));

        const networkResources = normalizeNetworkResources(asRecord(runtimeResult.result?.value));
        const pageState = asRecord(runtimeResult.result?.value);
        const navigation = parseNavigationTiming(pageState?.navigation);
        const readiness = normalizeReadiness(pageState?.readyState);
        const consoleSummaryBounded = applyZeroIfNegative(consoleSummary);
        const networkActivityResolved = {
          requestStartedCount: networkActivity.requestStartedCount,
          inFlightCount: inFlightRequests.size,
          failedRequestCount: networkActivity.failedRequestCount,
        };
        const route = parseRouteSummary(pageState?.route);
        const stabilityHint = inferStabilityHint({
          readiness,
          topFrameNavigatedAfterReady,
          networkActivity: networkActivityResolved,
          currentUrl: asString(pageState?.url),
          route,
          navigatedFrameUrl,
        });
        const accessibility = await enrichAccessibilityTreeLocators(
          tabId,
          summarizeAccessibilityTree(accessibilityTreeResult),
          partialErrors,
        );

        return {
          tabId,
          capturedAt,
          source: 'cdp',
          available: true,
          readiness,
          likelyLoading: isLikelyLoading(readiness, navigation, stabilityHint),
          stabilityHint,
          url: sanitizeUrlSummary(pageState?.url),
          title: truncateText(pageState?.title),
          route,
          visibilityState: truncateText(pageState?.visibilityState),
          focused: typeof pageState?.focused === 'boolean' ? pageState.focused : undefined,
          activeElement: parseActiveElement(pageState?.activeElement),
          frameCount: countFrames(frameTreeResult?.frameTree),
          topFrameUrl: sanitizeUrlSummary(frameTreeResult?.frameTree?.frame?.url),
          navigation,
          networkResources: networkResources ?? undefined,
          networkActivity: networkActivityResolved,
          console: consoleSummaryBounded,
          accessibility: accessibility ?? undefined,
          ...(partialErrors.length > 0 ? { partialErrors } : {}),
        };
      } finally {
        cdpSessionManager.removeEventListener(eventListener);
      }
    });
  } catch (error) {
    return {
      tabId,
      capturedAt,
      source: 'cdp',
      available: false,
      readiness: 'unknown',
      likelyLoading: false,
      stabilityHint: 'stable',
      error: sanitizeError(error),
    };
  }
}

function normalizeReadiness(value: unknown): CDPPageReadiness {
  if (value === 'loading' || value === 'interactive' || value === 'complete') {
    return value;
  }
  return 'unknown';
}

function isLikelyLoading(
  readiness: CDPPageReadiness,
  navigation: CDPNavigationTimingSummary | undefined,
  stabilityHint: CDPPageStabilityHint,
): boolean {
  if (readiness === 'loading') return true;
  if (stabilityHint === 'loading' || stabilityHint === 'spa_navigating') return true;
  if (readiness !== 'interactive') return false;
  return navigation?.loadEventMs === null || navigation?.loadEventMs === undefined;
}

function inferStabilityHint(input: {
  readiness: CDPPageReadiness;
  topFrameNavigatedAfterReady: boolean;
  networkActivity: CDPNetworkEventSummary;
  currentUrl?: string;
  route?: CDPRouteSummary;
  navigatedFrameUrl?: string;
}): CDPPageStabilityHint {
  if (input.readiness === 'loading') return 'loading';
  const afterInitialReady = input.readiness === 'interactive' || input.readiness === 'complete';
  if (!afterInitialReady) return 'stable';

  const normalizedCurrentUrl = normalizeUrlIgnoringHash(input.currentUrl);
  const normalizedNavigatedUrl = normalizeUrlIgnoringHash(input.navigatedFrameUrl);
  const urlChangedAfterReady = Boolean(
    normalizedCurrentUrl &&
    normalizedNavigatedUrl &&
    normalizedCurrentUrl !== normalizedNavigatedUrl,
  );
  const frameNavigationSuggestsSpa = input.topFrameNavigatedAfterReady
    ? normalizedNavigatedUrl
      ? !normalizedCurrentUrl || normalizedCurrentUrl !== normalizedNavigatedUrl
      : true
    : false;
  if (frameNavigationSuggestsSpa || urlChangedAfterReady) {
    return 'spa_navigating';
  }

  const networkBurstDetected =
    input.networkActivity.requestStartedCount >= SPA_NETWORK_BURST_REQUEST_THRESHOLD ||
    input.networkActivity.inFlightCount >= SPA_NETWORK_BURST_INFLIGHT_THRESHOLD;
  if (networkBurstDetected && input.route) {
    return 'spa_navigating';
  }

  return 'stable';
}

function parseActiveElement(value: unknown): CDPActiveElementSummary | undefined {
  const activeElement = asRecord(value);
  if (!activeElement) return undefined;

  const tagName = truncateText(activeElement.tagName);
  if (!tagName) return undefined;

  return {
    tagName,
    type: truncateText(activeElement.type),
    role: truncateText(activeElement.role),
    idPresent: activeElement.idPresent === true,
    namePresent: activeElement.namePresent === true,
  };
}

function parseNavigationTiming(value: unknown): CDPNavigationTimingSummary | undefined {
  const navigation = asRecord(value);
  if (!navigation) return undefined;

  return {
    type: truncateText(navigation.type),
    responseEndMs: normalizeTiming(navigation.responseEndMs),
    domContentLoadedMs: normalizeTiming(navigation.domContentLoadedMs),
    loadEventMs: normalizeTiming(navigation.loadEventMs),
  };
}

function parseRouteSummary(value: unknown): CDPRouteSummary | undefined {
  const route = asRecord(value);
  const rawUrl = asString(route?.url);
  const url = sanitizeUrlSummary(rawUrl);
  if (!url || !rawUrl) return undefined;
  const fingerprint = buildRouteFingerprint(rawUrl);

  return {
    href: url.href,
    pathname: url.pathname,
    hasQuery: url.hasQuery,
    hasHash: url.hasHash,
    ...(fingerprint ? { fingerprint } : {}),
    historyLength:
      typeof route?.historyLength === 'number' && Number.isFinite(route.historyLength)
        ? Math.max(0, Math.trunc(route.historyLength))
        : null,
  };
}

function buildRouteFingerprint(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const routeMaterial = `${url.origin}${url.pathname}?${url.searchParams.toString()}#${url.hash.replace(/^#/, '')}`;
    return `route_${hashString32(routeMaterial)}`;
  } catch {
    return undefined;
  }
}

function hashString32(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface RawAXNode {
  nodeId?: unknown;
  backendDOMNodeId?: unknown;
  role?: unknown;
  name?: unknown;
  properties?: unknown;
  actions?: unknown;
}

interface RankedAccessibilityObjectCandidate {
  candidate: CDPAccessibilityObjectCandidate;
  index: number;
  score: number;
}

function summarizeAccessibilityTree(treeResult: unknown): CDPAccessibilitySummary | undefined {
  const result = asRecord(treeResult);
  if (!result) return undefined;
  const rawNodes = (result as { nodes?: unknown[] }).nodes;
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    return {
      totalNodes: 0,
      actionableNodeCount: 0,
      actionableRoleTop: [],
      actionableSampleLabels: [],
      stateSignals: { checkedCount: 0, selectedCount: 0, expandedCount: 0, disabledCount: 0 },
      locatorCoverage: {
        locatorCandidateCount: 0,
        axNodeIdCount: 0,
        backendDOMNodeIdCount: 0,
        locatorCoverageRate: 0,
      },
      objectCandidates: [],
    };
  }

  const roleCounts = new Map<string, number>();
  const sampleLabels = new Set<string>();
  const objectCandidateSet = new Set<string>();
  const objectCandidatePool: RankedAccessibilityObjectCandidate[] = [];
  const stateSignals: CDPAccessibilityStateSignals = {
    checkedCount: 0,
    selectedCount: 0,
    expandedCount: 0,
    disabledCount: 0,
  };
  let actionableNodeCount = 0;
  let locatorCandidateCount = 0;
  let axNodeIdCount = 0;
  let backendDOMNodeIdCount = 0;

  for (const rawNode of rawNodes) {
    const node = asRecord(rawNode);
    if (!node) continue;
    const typedNode = node as RawAXNode;
    const actionable = isAccessibilityNodeActionable(typedNode);
    const role = inferAccessibilityRole(typedNode);
    const label = inferAccessibilityLabel(typedNode);
    if (actionable) {
      actionableNodeCount += 1;
      const normalizedRole = role || 'unknown';
      roleCounts.set(normalizedRole, (roleCounts.get(normalizedRole) ?? 0) + 1);
      if (label && sampleLabels.size < MAX_ACCESSIBILITY_SAMPLE_LABELS * 4) {
        sampleLabels.add(label);
      }

      const state = inferAccessibilityNodeState(typedNode);
      const actionTypes = inferAccessibilityActions(typedNode);
      const locator = parseAccessibilityObjectLocator(typedNode);
      if (locator) {
        locatorCandidateCount += 1;
        if (locator.axNodeId) axNodeIdCount += 1;
        if (typeof locator.backendDOMNodeId === 'number') backendDOMNodeIdCount += 1;
      }
      const candidateKey =
        typeof locator?.backendDOMNodeId === 'number'
          ? `backendDOMNodeId:${locator.backendDOMNodeId}`
          : locator?.axNodeId
            ? `axNodeId:${locator.axNodeId}`
            : `${normalizedRole}||${label || ''}`;
      if (
        objectCandidatePool.length < ACCESSIBILITY_OBJECT_CANDIDATE_POOL_LIMIT &&
        !objectCandidateSet.has(candidateKey)
      ) {
        objectCandidateSet.add(candidateKey);
        const candidate: CDPAccessibilityObjectCandidate = {
          role: normalizedRole,
          ...(label ? { label } : {}),
          ...(locator ? { locator } : {}),
          actionTypes,
          state,
        };
        objectCandidatePool.push({
          candidate,
          index: objectCandidatePool.length,
          score: scoreAccessibilityObjectCandidate(candidate),
        });
      }
    }
    updateAccessibilityStateSignals(typedNode, stateSignals);
  }

  const actionableRoleTop = Array.from(roleCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ACCESSIBILITY_ACTIONABLE_ROLE_KEYS)
    .map(([role, count]) => ({ role, count }));

  return {
    totalNodes: rawNodes.length,
    actionableNodeCount,
    actionableRoleTop,
    actionableSampleLabels: Array.from(sampleLabels).slice(0, MAX_ACCESSIBILITY_SAMPLE_LABELS),
    stateSignals,
    locatorCoverage: {
      locatorCandidateCount,
      axNodeIdCount,
      backendDOMNodeIdCount,
      locatorCoverageRate:
        actionableNodeCount > 0
          ? Number((locatorCandidateCount / actionableNodeCount).toFixed(4))
          : 0,
    },
    objectCandidates: selectAccessibilityObjectCandidates(objectCandidatePool),
  };
}

function selectAccessibilityObjectCandidates(
  pool: RankedAccessibilityObjectCandidate[],
): CDPAccessibilityObjectCandidate[] {
  if (pool.length <= MAX_ACCESSIBILITY_OBJECT_CANDIDATES) {
    return pool.map((item) => item.candidate);
  }

  return [...pool]
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, MAX_ACCESSIBILITY_OBJECT_CANDIDATES)
    .map((item) => item.candidate);
}

function scoreAccessibilityObjectCandidate(candidate: CDPAccessibilityObjectCandidate): number {
  let score = 0;
  const role = candidate.role.toLowerCase();
  const label = candidate.label ?? '';

  if (candidate.locator?.backendDOMNodeId !== undefined) score += 24;
  if (candidate.locator?.axNodeId) score += 8;
  if (candidate.actionTypes.includes('click')) score += 16;
  if (candidate.actionTypes.includes('focus')) score += 12;
  if (candidate.actionTypes.includes('setvalue')) score += 18;

  if (role === 'searchbox' || role === 'textbox') score += 64;
  else if (role === 'link') score += 44;
  else if (role === 'button') score += 36;
  else if (role === 'checkbox' || role === 'radio' || role === 'switch') score += 34;
  else if (role === 'combobox' || role === 'listbox' || role === 'option') score += 30;
  else if (role === 'tab' || role === 'menuitem' || role === 'menuitemcheckbox') score += 22;

  if (looksLikeStableObjectLabel(label)) score += 56;
  if (looksLikeMeaningfulContentLabel(label)) score += 24;
  if (looksLikeUtilityAccessibilityLabel(label)) score -= 72;
  if (label.length <= 2 && !/[\p{Script=Han}]/u.test(label)) score -= 24;
  if (candidate.state.disabled === true) score -= 48;
  if (candidate.state.selected === true || candidate.state.checked === true) score += 6;

  return score;
}

function looksLikeStableObjectLabel(label: string): boolean {
  const normalized = label.trim();
  if (!normalized) return false;
  if (/^[\w.-]+\/[\w.-]+$/.test(normalized)) return true;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(normalized)) return true;
  if (/^https?:\/\//i.test(normalized)) return true;
  if (/#[0-9]{1,8}\b/.test(normalized)) return true;
  return false;
}

function looksLikeMeaningfulContentLabel(label: string): boolean {
  const normalized = label.trim();
  if (normalized.length < 6) return false;
  if (/[\p{Script=Han}]/u.test(normalized)) return normalized.length >= 6;
  return normalized.split(/\s+/).filter(Boolean).length >= 3;
}

function looksLikeUtilityAccessibilityLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return true;
  if (
    /^(menu|more|close|cancel|back|next|previous|share|copy|refresh|reload|settings|help|search|sign in|sign up|login|logout|skip|open|collapse|expand)$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(star|fork|watch|notifications?|profile|avatar|theme|language|filter)$/i.test(normalized)) {
    return true;
  }
  return false;
}

export async function probeNodeVisibility(
  tabId: number,
  backendNodeIds: readonly number[],
): Promise<Map<number, NodeVisibilityProbe>> {
  const normalizedBackendNodeIds = [
    ...new Set(backendNodeIds.filter((id) => Number.isInteger(id) && id >= 0)),
  ];
  if (normalizedBackendNodeIds.length === 0) return new Map();

  try {
    await Promise.all([
      cdpSessionManager.sendCommand(tabId, 'DOM.enable').catch(() => undefined),
      cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => undefined),
    ]);

    const output = new Map<number, NodeVisibilityProbe>();
    for (const backendNodeId of normalizedBackendNodeIds) {
      const resolvedNode = await cdpSessionManager
        .sendCommand<RuntimeEvaluateResponse>(tabId, 'DOM.resolveNode', { backendNodeId })
        .catch(() => undefined);
      const objectId = asString(resolvedNode?.result?.objectId);
      if (!objectId) continue;
      const probeResult = await cdpSessionManager
        .sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.callFunctionOn', {
          objectId,
          functionDeclaration: NODE_VISIBILITY_PROBE,
          returnByValue: true,
          silent: true,
        })
        .catch(() => undefined);
      const parsed = parseNodeVisibilityProbe(probeResult?.result?.value);
      if (parsed) output.set(backendNodeId, parsed);
    }
    return output;
  } catch {
    return new Map();
  }
}

async function enrichAccessibilityTreeLocators(
  tabId: number,
  summary: CDPAccessibilitySummary | undefined,
  partialErrors?: string[],
): Promise<CDPAccessibilitySummary | undefined> {
  if (!summary?.objectCandidates?.length) return summary;
  const candidatesWithBackendNode = summary.objectCandidates.filter(
    (candidate) => typeof candidate.locator?.backendDOMNodeId === 'number',
  );
  if (candidatesWithBackendNode.length === 0) return summary;

  try {
    await cdpSessionManager.sendCommand(tabId, 'DOM.enable').catch(() => undefined);
    const visibilityByBackendNodeId = await probeNodeVisibility(
      tabId,
      candidatesWithBackendNode
        .map((candidate) => candidate.locator?.backendDOMNodeId)
        .filter((value): value is number => typeof value === 'number'),
    );
    const enrichedCandidates: CDPAccessibilityObjectCandidate[] = [];
    for (const candidate of summary.objectCandidates) {
      const locator = candidate.locator;
      if (!locator || typeof locator.backendDOMNodeId !== 'number') {
        enrichedCandidates.push(candidate);
        continue;
      }
      const backendNodeId = locator.backendDOMNodeId;
      const nodeDescription = await cdpSessionManager
        .sendCommand(tabId, 'DOM.describeNode', { backendNodeId })
        .catch(() => undefined);
      const boxModel = await cdpSessionManager
        .sendCommand(tabId, 'DOM.getBoxModel', { backendNodeId })
        .catch(() => undefined);
      const locatorExtension = {
        ...buildLocatorExtensionFromDomNode(nodeDescription),
        ...buildLocatorExtensionFromBoxModel(boxModel),
      };
      const visibilityProbe = visibilityByBackendNodeId.get(backendNodeId);
      const enrichedCandidate =
        Object.keys(locatorExtension).length > 0
          ? { ...candidate, locator: { ...locator, ...locatorExtension } }
          : candidate;
      enrichedCandidates.push(
        visibilityProbe ? { ...enrichedCandidate, visibilityProbe } : enrichedCandidate,
      );
    }
    return { ...summary, objectCandidates: enrichedCandidates };
  } catch {
    if (partialErrors && !partialErrors.includes('accessibility_locator_enrichment_failed')) {
      partialErrors.push('accessibility_locator_enrichment_failed');
    }
    return summary;
  }
}

function parseNodeVisibilityProbe(value: unknown): NodeVisibilityProbe | undefined {
  const record = asRecord(value);
  if (!record || typeof record.domVisible !== 'boolean' || typeof record.inViewport !== 'boolean') {
    return undefined;
  }
  return {
    domVisible: record.domVisible,
    inViewport: record.inViewport,
    centerHitTarget: typeof record.centerHitTarget === 'boolean' ? record.centerHitTarget : null,
    occluded: record.occluded === true,
    ...(typeof record.occludedBy === 'string' && record.occludedBy.trim()
      ? { occludedBy: record.occludedBy.trim().toLowerCase() }
      : {}),
    reason: asString(record.reason) ?? 'visibility_probe_unknown',
  };
}

function buildLocatorExtensionFromDomNode(
  value: unknown,
): Pick<CDPAccessibilityObjectLocator, 'cssSelector' | 'nodeName'> {
  const node = asRecord(asRecord(value)?.node);
  if (!node) return {};
  const rawNodeName = asString(node.localName) || asString(node.nodeName);
  const nodeName = rawNodeName?.toLowerCase();
  const attributes = readDomNodeAttributes(node.attributes);
  const cssSelector = buildSafeCssSelector(nodeName, attributes);
  return {
    ...(nodeName ? { nodeName } : {}),
    ...(cssSelector ? { cssSelector } : {}),
  };
}

function buildLocatorExtensionFromBoxModel(
  value: unknown,
): Pick<CDPAccessibilityObjectLocator, 'visualBounds'> {
  const model = asRecord(asRecord(value)?.model);
  const content = Array.isArray(model?.content) ? model.content : undefined;
  const visualBounds = rectFromQuad(content);
  return visualBounds ? { visualBounds } : {};
}

function rectFromQuad(value: unknown[] | undefined): CDPElementRect | undefined {
  if (!value || value.length < 8) return undefined;
  const points = value
    .slice(0, 8)
    .map((item) => (typeof item === 'number' && Number.isFinite(item) ? item : null));
  if (points.some((point) => point === null)) return undefined;
  const xs = [points[0], points[2], points[4], points[6]] as number[];
  const ys = [points[1], points[3], points[5], points[7]] as number[];
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  if (width === 0 || height === 0) return undefined;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function readDomNodeAttributes(value: unknown): Map<string, string> {
  const output = new Map<string, string>();
  if (!Array.isArray(value)) return output;
  for (let index = 0; index < value.length - 1; index += 2) {
    const name = asString(value[index])?.toLowerCase();
    const attrValue = asString(value[index + 1]);
    if (!name || !attrValue) continue;
    output.set(name, attrValue);
  }
  return output;
}

function buildSafeCssSelector(
  nodeName: string | undefined,
  attributes: Map<string, string>,
): string | undefined {
  const tagName = safeCssIdentifier(nodeName || '') || undefined;
  const id = safeAttributeValue(attributes.get('id'));
  if (id) return `#${cssIdentifier(id)}`;

  const stableAttributeNames = [
    'data-testid',
    'data-test',
    'data-cy',
    'aria-label',
    'name',
    'type',
    'role',
  ];
  for (const attributeName of stableAttributeNames) {
    const value = safeAttributeValue(attributes.get(attributeName));
    if (!value) continue;
    return `${tagName || '*'}[${attributeName}="${cssString(value)}"]`;
  }
  return tagName;
}

function safeAttributeValue(value: string | undefined): string | undefined {
  const text = truncateText(value);
  if (!text) return undefined;
  if (/token|secret|password|passwd|authorization|bearer|cookie|session|email|phone/i.test(text)) {
    return undefined;
  }
  if (text.length > 80) return undefined;
  return text;
}

function safeCssIdentifier(value: string): string | undefined {
  const text = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]*$/.test(text)) return undefined;
  return text;
}

function cssIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function cssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseAccessibilityObjectLocator(
  node: RawAXNode,
): CDPAccessibilityObjectLocator | undefined {
  const axNodeId = asString(node.nodeId);
  const backendDOMNodeId = asNonNegativeInteger(node.backendDOMNodeId);
  if (!axNodeId && typeof backendDOMNodeId !== 'number') return undefined;
  return {
    source: 'cdp_ax',
    ...(axNodeId ? { axNodeId } : {}),
    ...(typeof backendDOMNodeId === 'number' ? { backendDOMNodeId } : {}),
  };
}

function inferAccessibilityRole(node: RawAXNode): string | undefined {
  const role =
    asString(asRecord(node.role)?.name) ||
    asString(node.role) ||
    asString(asRecord(node.role)?.value);
  if (!role) return undefined;
  const normalized = role.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function inferAccessibilityLabel(node: RawAXNode): string | undefined {
  const namePayload = asRecord(node.name);
  const rawLabel = asString(namePayload?.value) || asString(namePayload?.name);
  if (!rawLabel) return undefined;
  return truncateText(rawLabel);
}

function isAccessibilityNodeActionable(node: RawAXNode): boolean {
  const role = inferAccessibilityRole(node);
  if (role && ACCESSIBILITY_ACTIONABLE_ROLES.has(role)) return true;
  const actions = asArray(node.actions);
  return actions.some((action) => {
    const actionRecord = asRecord(action);
    const actionName = asString(actionRecord?.name);
    return Boolean(
      actionName &&
      /^(click|focus|tap|press|expand|collapse|check|setvalue|open)$/i.test(actionName),
    );
  });
}

function parseAccessibilityStateValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const record = asRecord(value);
  if (record?.value !== undefined) return parseAccessibilityStateValue(record.value);
  if (typeof record?.value === 'boolean') return record.value;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function parseAccessibilityStateBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const record = asRecord(value);
  if (record?.value !== undefined) return parseAccessibilityStateBoolean(record.value);
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function updateAccessibilityStateSignals(
  node: RawAXNode,
  stateSignals: CDPAccessibilityStateSignals,
): void {
  const properties = asArray(node.properties);
  for (const property of properties) {
    const propertyRecord = asRecord(property);
    const stateName = asString(propertyRecord?.name);
    if (!stateName) continue;
    const stateValue = parseAccessibilityStateValue(asRecord(propertyRecord)?.value);
    if (!stateValue) continue;
    const normalizedName = stateName.trim().toLowerCase();
    if (normalizedName === 'checked') stateSignals.checkedCount += 1;
    if (normalizedName === 'selected') stateSignals.selectedCount += 1;
    if (normalizedName === 'expanded') stateSignals.expandedCount += 1;
    if (normalizedName === 'disabled') stateSignals.disabledCount += 1;
  }
}

function inferAccessibilityActions(node: RawAXNode): string[] {
  const actions = asArray(node.actions);
  const collected = new Set<string>();
  for (const action of actions) {
    const name = asString(asRecord(action)?.name);
    if (!name) continue;
    const normalized = name.trim().toLowerCase();
    if (!normalized) continue;
    collected.add(normalized);
  }
  return [...collected];
}

function inferAccessibilityNodeState(node: RawAXNode): CDPAccessibilityObjectStateSignals {
  const properties = asArray(node.properties);
  const state: CDPAccessibilityObjectStateSignals = {};

  for (const property of properties) {
    const propertyRecord = asRecord(property);
    const stateName = asString(propertyRecord?.name);
    if (!stateName) continue;
    const normalizedName = stateName.trim().toLowerCase();
    const normalizedValue = parseAccessibilityStateBoolean(propertyRecord?.value);
    if (typeof normalizedValue !== 'boolean') continue;

    if (normalizedName === 'checked') state.checked = normalizedValue;
    if (normalizedName === 'selected') state.selected = normalizedValue;
    if (normalizedName === 'expanded') state.expanded = normalizedValue;
    if (normalizedName === 'disabled') state.disabled = normalizedValue;
  }

  return state;
}

function parseNetworkResourceSummary(value: unknown): CDPNetworkResourceSummary | undefined {
  const resources = asRecord(value);
  if (!resources) return undefined;

  const resourceEntryCount = asNonNegativeCount(resources.resourceEntryCount);
  if (resourceEntryCount === 0) {
    return {
      resourceEntryCount: 0,
      resourceInFlightCount: 0,
      failedResourceStatusCount: 0,
    };
  }

  return {
    resourceEntryCount,
    resourceInFlightCount: asNonNegativeCount(resources.resourceInFlightCount),
    failedResourceStatusCount: asNonNegativeCount(resources.failedResourceStatusCount),
  };
}

function normalizeNetworkResources(value: unknown): CDPNetworkResourceSummary | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const pageState = value as Record<string, unknown>;
  return parseNetworkResourceSummary(pageState.networkResources);
}

function applyZeroIfNegative(input: CDPConsoleSummary): CDPConsoleSummary {
  return {
    errorCount: Math.max(0, Math.round(input.errorCount)),
    warningCount: Math.max(0, Math.round(input.warningCount)),
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNonNegativeCount(value: unknown): number {
  const normalized = typeof value === 'number' ? value : Number(value);

  return Math.max(0, Math.round(Number.isFinite(normalized) ? normalized : 0));
}

function asNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.trunc(value);
  return normalized >= 0 ? normalized : undefined;
}

function normalizeUrlIgnoringHash(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

function sanitizeUrlSummary(value: unknown): CDPPageUrlSummary | undefined {
  const raw = typeof value === 'string' ? value : undefined;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, '');
    const pathname = url.pathname || '';
    const safePathname = sanitizeUrlPathname(url, pathname);
    const href = sanitizeUrlHref(url, scheme, safePathname);

    return {
      href,
      origin: url.origin === 'null' ? url.protocol : url.origin,
      host: url.host,
      pathname: safePathname,
      scheme,
      hasQuery: url.search.length > 0,
      hasHash: url.hash.length > 0,
    };
  } catch {
    return undefined;
  }
}

function sanitizeUrlPathname(url: URL, pathname: string): string {
  if (url.protocol === 'file:') return '';
  if (url.protocol === 'data:' || url.protocol === 'blob:') return '';
  return pathname;
}

function sanitizeUrlHref(url: URL, scheme: string, pathname: string): string {
  if (
    url.protocol === 'http:' ||
    url.protocol === 'https:' ||
    url.protocol === 'chrome:' ||
    url.protocol === 'chrome-extension:'
  ) {
    return `${url.protocol}//${url.host}${pathname}`;
  }
  if (url.protocol === 'about:') {
    return `about:${pathname}`;
  }
  if (url.protocol === 'file:') {
    return 'file://local-file';
  }
  return `${scheme}:redacted`;
}

function countFrames(frameTree: CDPFrameTree | undefined): number | undefined {
  if (!frameTree) return undefined;
  return countFrameTree(frameTree);
}

function countFrameTree(frameTree: CDPFrameTree): number {
  return 1 + (frameTree.childFrames ?? []).reduce((sum, child) => sum + countFrameTree(child), 0);
}

function normalizeTiming(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function truncateText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}...` : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateText(message) ?? 'CDP page sensing failed';
}
