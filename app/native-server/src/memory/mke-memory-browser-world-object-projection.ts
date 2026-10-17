import type { BrowserObject, BrowserObjectInput } from './db';
import {
  browserPageObjectKey,
  chooseRepresentativeBrowserWorldTab,
  type BrowserWorldTabProjection,
} from './mke-browser-world-projection';
import { normalizeUrlPattern, sanitizeValue } from './mke-memory-sanitizer';
import {
  normalizeOwnerType,
  objectFingerprint,
  sourceTraceIds,
} from './mke-memory-object-identity';
import {
  readArray,
  readBoolean,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

interface BrowserObjectProjectionTrace {
  traceId?: string | null;
  browserContextKey?: string | null;
  sourceRoute?: string | null;
  freshness?: string | null;
  windowId?: number | null;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
}

export function recordBrowserWorldObjects(input: {
  trace: BrowserObjectProjectionTrace;
  payload: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string | null;
  redactionState: string;
  upsertBrowserObject: (objectInput: BrowserObjectInput) => BrowserObject | undefined;
}): void {
  const browserWorld = readNestedObject(input.payload, 'browserWorld') ?? input.payload;
  const contextKey = input.browserContextKey ?? input.trace.browserContextKey ?? 'default';
  for (const rawWindow of readArray(browserWorld.windows)) {
    const win = readObject(rawWindow);
    if (!win) continue;
    const id = readNumber(win.windowId, win.id);
    if (id === null) continue;
    input.upsertBrowserObject({
      siteFamily: 'browser',
      pageModelKey: 'browser-window',
      objectFingerprint: objectFingerprint('window', id),
      objectType: 'window',
      browserContextKey: contextKey,
      windowId: id,
      sourceRoute: readString(
        input.payload.source,
        input.trace.sourceRoute,
        'chrome_windows_get_all_with_browser_world_inventory',
      ),
      sourceFreshness: readString(
        browserWorld.status,
        browserWorld.freshness,
        input.trace.freshness,
      ),
      lifecycleState: readString(win.lifecycleState, 'updated'),
      isActive: readBoolean(win.focused, win.isFocused, win.active),
      canTabrixOperate: readBoolean(win.canTabrixOperate),
      operabilityReason: readString(win.operabilityReason),
      facts: {
        tabCount: readNumber(win.tabCount),
        activeTabId: readNumber(win.activeTabId),
        state: readString(win.state, win.visibilityState),
      },
      firstTraceId: input.trace.traceId,
      lastTraceId: input.trace.traceId,
      sourceTraceIds: sourceTraceIds(input.trace),
      currentState: sanitizeValue(
        {
          focused: readBoolean(win.focused, win.isFocused),
          state: readString(win.state, win.visibilityState),
          tabCount: readNumber(win.tabCount),
        },
        'browser_object',
      ),
      redactionState: input.redactionState,
      updatedAt: input.observedAt,
    });
  }

  const tabsByBaseRoute = new Map<
    string,
    { representative: BrowserWorldTabProjection; tabs: BrowserWorldTabProjection[] }
  >();
  for (const rawTab of readArray(browserWorld.tabs)) {
    const tab = readObject(rawTab);
    if (!tab) continue;
    const tabId = readNumber(tab.tabId, tab.id);
    if (tabId === null) continue;
    const urlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const tabWindowId = readNumber(tab.windowId) ?? input.trace.windowId ?? null;
    const projectedTab: BrowserWorldTabProjection = {
      tab,
      tabId,
      windowId: tabWindowId,
      urlFields,
    };
    const baseRouteKey = browserPageObjectKey(projectedTab);
    const group = tabsByBaseRoute.get(baseRouteKey);
    if (group) {
      group.tabs.push(projectedTab);
      group.representative = chooseRepresentativeBrowserWorldTab(
        group.representative,
        projectedTab,
      );
    } else {
      tabsByBaseRoute.set(baseRouteKey, { representative: projectedTab, tabs: [projectedTab] });
    }
  }

  for (const [baseRouteKey, group] of tabsByBaseRoute.entries()) {
    const representative = group.representative;
    const { tab, tabId, windowId: tabWindowId, urlFields } = representative;
    const openTabIds = group.tabs.map((item) => item.tabId);
    const hasLoading = group.tabs.some((item) => readString(item.tab.status) === 'loading');
    const hasRestricted = group.tabs.some(
      (item) => readBoolean(item.tab.canTabrixOperate) === false,
    );
    input.upsertBrowserObject({
      siteFamily: urlFields.siteFamily ?? input.trace.siteFamily ?? 'browser',
      pageUrlPattern: urlFields.pattern ?? input.trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole: 'browser_tab',
      pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
      objectFingerprint: objectFingerprint('browser_page', baseRouteKey),
      objectType: 'tab',
      browserContextKey: contextKey,
      tabId,
      windowId: tabWindowId,
      ownerType: normalizeOwnerType(readString(tab.ownerType, tab.openedBy, tab.owner)),
      sourceRoute: readString(
        input.payload.source,
        input.trace.sourceRoute,
        'chrome_windows_get_all_with_browser_world_inventory',
      ),
      sourceFreshness: readString(
        browserWorld.status,
        browserWorld.freshness,
        input.trace.freshness,
      ),
      tabStatus: readString(tab.status),
      lifecycleState: readString(tab.lifecycleState, tab.closedAtMs ? 'closed' : 'updated'),
      isActive: readBoolean(tab.active),
      canTabrixOperate: readBoolean(tab.canTabrixOperate),
      operabilityReason: readString(tab.operabilityReason),
      facts: sanitizeValue(
        {
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          openerTabId: readNumber(tab.openerTabId),
          aiRunId: readString(tab.aiRunId),
          aiClaimId: readString(tab.aiClaimId),
          aiClaimState: readString(tab.aiClaimState),
          aiClaimedAtMs: readNumber(tab.aiClaimedAtMs),
          aiFinalizedAtMs: readNumber(tab.aiFinalizedAtMs),
          aiClaimReason: readString(tab.aiClaimReason),
        },
        'browser_object',
      ),
      firstTraceId: input.trace.traceId,
      lastTraceId: input.trace.traceId,
      sourceTraceIds: sourceTraceIds(input.trace),
      currentState: sanitizeValue(
        {
          active: readBoolean(tab.active),
          status: readString(tab.status),
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
          aiRunId: readString(tab.aiRunId),
          aiClaimId: readString(tab.aiClaimId),
          aiClaimState: readString(tab.aiClaimState),
          aiClaimedAtMs: readNumber(tab.aiClaimedAtMs),
          aiFinalizedAtMs: readNumber(tab.aiFinalizedAtMs),
          aiClaimReason: readString(tab.aiClaimReason),
        },
        'browser_object',
      ),
      redactionState: input.redactionState,
      updatedAt: input.observedAt,
      closedAt: readNumber(tab.closedAtMs) ? input.observedAt : null,
      archivedAt: null,
    });
  }

  recordClosedBrowserWorldPage({
    trace: input.trace,
    browserWorld,
    observedAt: input.observedAt,
    browserContextKey: contextKey,
    payload: input.payload,
    redactionState: input.redactionState,
    upsertBrowserObject: input.upsertBrowserObject,
  });
}

function recordClosedBrowserWorldPage(input: {
  trace: BrowserObjectProjectionTrace;
  browserWorld: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string;
  payload: Record<string, unknown>;
  redactionState: string;
  upsertBrowserObject: (objectInput: BrowserObjectInput) => BrowserObject | undefined;
}): void {
  const summary = readNestedObject(input.browserWorld, 'summary');
  const recentActivityLedger =
    readObject(input.browserWorld.recentActivityLedger) ??
    readNestedObject(summary, 'recentActivityLedger');
  const latestPageClosed = readNestedObject(recentActivityLedger, 'latestPageClosed');
  if (!latestPageClosed) return;
  const tabId = readNumber(latestPageClosed.tabId);
  if (tabId === null) return;
  const closedAtMs = readNumber(latestPageClosed.occurredAtMs);
  const closedAt =
    closedAtMs !== null && Number.isFinite(closedAtMs)
      ? new Date(closedAtMs).toISOString()
      : input.observedAt;
  const urlFields = normalizeUrlPattern(readString(latestPageClosed.url), {
    allowPersonalBrowserStateStorage: false,
  });
  const closedBaseRouteKey =
    urlFields.rootRoute ?? urlFields.currentRoute ?? urlFields.pattern ?? String(tabId);
  const sameBaseRouteStillOpen = readArray(input.browserWorld.tabs).some((rawTab) => {
    const tab = readObject(rawTab);
    if (!tab || readNumber(tab.closedAtMs) !== null) return false;
    const openUrlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const openBaseRouteKey =
      openUrlFields.rootRoute ??
      openUrlFields.currentRoute ??
      openUrlFields.pattern ??
      String(readNumber(tab.tabId, tab.id));
    return openBaseRouteKey === closedBaseRouteKey;
  });
  if (sameBaseRouteStillOpen) return;
  const tabWindowId = readNumber(latestPageClosed.windowId) ?? input.trace.windowId;
  input.upsertBrowserObject({
    siteFamily: urlFields.siteFamily ?? input.trace.siteFamily ?? 'browser',
    pageUrlPattern: urlFields.pattern ?? input.trace.pageUrlPattern,
    rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
    currentRoute: urlFields.currentRoute,
    pageRole: 'browser_tab',
    pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
    objectFingerprint: objectFingerprint('browser_page', closedBaseRouteKey),
    objectType: 'tab',
    browserContextKey: input.browserContextKey,
    tabId,
    windowId: tabWindowId,
    ownerType: normalizeOwnerType(readString(latestPageClosed.openedBy)),
    sourceRoute: readString(
      input.payload.source,
      input.trace.sourceRoute,
      'chrome_windows_get_all_with_browser_world_inventory',
    ),
    sourceFreshness: readString(
      input.browserWorld.status,
      input.browserWorld.freshness,
      input.trace.freshness,
    ),
    lifecycleState: 'closed',
    isActive: false,
    canTabrixOperate: false,
    operabilityReason: 'tab_closed',
    facts: sanitizeValue(
      {
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
        evidence: readString(latestPageClosed.evidence),
        aiRunId: readString(latestPageClosed.aiRunId),
        aiClaimId: readString(latestPageClosed.aiClaimId),
        aiClaimState: readString(latestPageClosed.aiClaimState),
        aiClaimedAtMs: readNumber(latestPageClosed.aiClaimedAtMs),
        aiFinalizedAtMs: readNumber(latestPageClosed.aiFinalizedAtMs),
        aiClaimReason: readString(latestPageClosed.aiClaimReason),
      },
      'browser_object',
    ),
    firstTraceId: input.trace.traceId,
    lastTraceId: input.trace.traceId,
    sourceTraceIds: sourceTraceIds(input.trace),
    currentState: sanitizeValue(
      {
        status: 'closed',
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
        aiRunId: readString(latestPageClosed.aiRunId),
        aiClaimId: readString(latestPageClosed.aiClaimId),
        aiClaimState: readString(latestPageClosed.aiClaimState),
        aiFinalizedAtMs: readNumber(latestPageClosed.aiFinalizedAtMs),
        aiClaimReason: readString(latestPageClosed.aiClaimReason),
      },
      'browser_object',
    ),
    redactionState: input.redactionState,
    updatedAt: input.observedAt,
    closedAt,
    archivedAt: null,
  });
}
