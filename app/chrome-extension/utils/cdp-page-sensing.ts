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

export interface CDPAccessibilityObjectCandidate {
  role: string;
  label?: string;
  actionTypes: string[];
  state: CDPAccessibilityObjectStateSignals;
}

export interface CDPAccessibilityRoleFrequency {
  role: string;
  count: number;
}

export interface CDPAccessibilitySummary {
  totalNodes: number;
  actionableNodeCount: number;
  actionableRoleTop: CDPAccessibilityRoleFrequency[];
  actionableSampleLabels: string[];
  stateSignals: CDPAccessibilityStateSignals;
  objectCandidates: CDPAccessibilityObjectCandidate[];
}

export interface CDPPageSensingSnapshot {
  tabId: number;
  capturedAt: number;
  source: 'cdp';
  available: boolean;
  readiness: CDPPageReadiness;
  likelyLoading: boolean;
  url?: CDPPageUrlSummary;
  title?: string;
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
  error?: string;
}

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
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
const MAX_ACCESSIBILITY_SAMPLE_LABELS = 6;
const MAX_ACCESSIBILITY_ACTIONABLE_ROLE_KEYS = 6;
const MAX_ACCESSIBILITY_OBJECT_CANDIDATES = 24;
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
          cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => undefined),
          cdpSessionManager.sendCommand(tabId, 'Page.enable').catch(() => undefined),
          cdpSessionManager.sendCommand(tabId, 'Network.enable').catch(() => undefined),
          cdpSessionManager.sendCommand(tabId, 'Log.enable').catch(() => undefined),
          cdpSessionManager.sendCommand(tabId, 'Accessibility.enable').catch(() => undefined),
        ]);

        const [runtimeResult, frameTreeResult, accessibilityTreeResult] = await Promise.all([
          cdpSessionManager.sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.evaluate', {
            expression: PAGE_STATE_PROBE,
            returnByValue: true,
            silent: true,
          }),
          cdpSessionManager
            .sendCommand<CDPFrameTreeResponse>(tabId, 'Page.getFrameTree')
            .catch(() => undefined),
          cdpSessionManager
            .sendCommand(tabId, 'Accessibility.getFullAXTree', {
              depth: 6,
              fetchRelatives: false,
            })
            .catch(() => undefined),
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
        const accessibility = summarizeAccessibilityTree(accessibilityTreeResult);

        return {
          tabId,
          capturedAt,
          source: 'cdp',
          available: true,
          readiness,
          likelyLoading: isLikelyLoading(readiness, navigation),
          url: sanitizeUrlSummary(pageState?.url),
          title: truncateText(pageState?.title),
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
  navigation?: CDPNavigationTimingSummary,
): boolean {
  if (readiness === 'loading') return true;
  if (readiness !== 'interactive') return false;
  return navigation?.loadEventMs === null || navigation?.loadEventMs === undefined;
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

interface RawAXNode {
  role?: unknown;
  name?: unknown;
  properties?: unknown;
  actions?: unknown;
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
      objectCandidates: [],
    };
  }

  const roleCounts = new Map<string, number>();
  const sampleLabels = new Set<string>();
  const objectCandidateSet = new Set<string>();
  const objectCandidates: CDPAccessibilityObjectCandidate[] = [];
  const stateSignals: CDPAccessibilityStateSignals = {
    checkedCount: 0,
    selectedCount: 0,
    expandedCount: 0,
    disabledCount: 0,
  };
  let actionableNodeCount = 0;

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
      const candidateKey = `${normalizedRole}||${label || ''}`;
      if (
        objectCandidates.length < MAX_ACCESSIBILITY_OBJECT_CANDIDATES &&
        !objectCandidateSet.has(candidateKey)
      ) {
        objectCandidateSet.add(candidateKey);
        objectCandidates.push({
          role: normalizedRole,
          ...(label ? { label } : {}),
          actionTypes,
          state,
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
    objectCandidates,
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
