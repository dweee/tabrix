import {
  buildAiOperationState,
  buildTabAttributeGroups,
  buildTabLifecycleState,
  buildTabStateMatrix,
  buildWindowLifecycleState,
  buildWindowOperationState,
  buildWindowStateMatrix,
  summarizeCurrentOperation,
  summarizeCurrentWindow,
  summarizeBrowserObjectEdgeState,
  summarizeDynamicObjectUpdate,
  summarizeObjectChangeConclusion,
  summarizeObjectChangeSummary,
  summarizeRecentEvents,
  summarizeTabLifecycle,
  summarizeTabState,
  summarizeTabStateMatrix,
  summarizeWindowLifecycle,
  summarizeWindowStateMatrix,
} from './browser-world-summary';

export type BrowserWorldTabOpenedBy = 'ai' | 'user_or_page' | 'unknown';

export interface BrowserWorldTabObject {
  objectKind: 'BrowserTabObject';
  tabId: number;
  windowId: number | null;
  url: string;
  pendingUrl: string;
  title: string;
  active: boolean | null;
  status: string | null;
  discarded: boolean | null;
  audible: boolean | null;
  muted: boolean | null;
  pinned: boolean | null;
  openerTabId: number | null;
  openedBy: BrowserWorldTabOpenedBy;
  openedByConfidence: number;
  openedByReason: string;
  aiOperationState: 'idle' | 'recently_operated' | 'closed';
  lastAiOperation: string | null;
  lastAiOperationAtMs: number | null;
  lastAiOperationConfidence: number | null;
  lastAiOperationReason: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  closedAtMs: number | null;
  canTabrixOperate: boolean | null;
  operabilityReason: string;
}

export interface BrowserWorldWindowObject {
  objectKind: 'BrowserWindowObject';
  windowId: number;
  focused: boolean | null;
  state: string;
  visibilityState: 'visible' | 'minimized' | 'unknown';
  isFocused: boolean | null;
  isMinimized: boolean | null;
  type: string;
  incognito: boolean | null;
  width: number | null;
  height: number | null;
  left: number | null;
  top: number | null;
  activeTabId: number | null;
  activeTabCanOperate: boolean | null;
  canTabrixOperate: boolean | null;
  operabilityReason: string;
  tabCount: number;
  updatedAtMs: number;
}

export interface BrowserWorldSnapshot {
  source: 'extension_browser_world_inventory';
  version: 1;
  initialized: boolean;
  observedAtMs: number;
  snapshotAgeMs: number | null;
  refreshHealth: BrowserWorldRefreshHealth;
  windowCount: number;
  tabCount: number;
  focusedWindowId: number | null;
  browserActiveTabId: number | null;
  aiOpenedTabIds: number[];
  userOrPageOpenedTabIds: number[];
  operableTabIds: number[];
  summary: BrowserWorldSummary;
  retentionPolicy: BrowserWorldRetentionPolicy;
  recentEvents: BrowserWorldEvent[];
  windows: BrowserWorldWindowObject[];
  tabs: BrowserWorldTabObject[];
}

export interface BrowserWorldRetentionPolicy {
  recentEventLimit: number;
  recentEventsRetained: number;
  windowObjectsRetained: number;
  tabObjectsRetained: number;
  refreshMode: 'event_driven_with_on_demand_chrome_resync';
  minFullChromeResyncIntervalMs: number;
  eventPrivacyBoundary: string;
  detailBoundary: string;
}

export interface BrowserWorldRefreshHealth {
  fullChromeResyncCount: number;
  skippedChromeResyncCount: number;
  minFullChromeResyncIntervalMs: number;
  lastFullChromeResyncAtMs: number | null;
  lastFullChromeResyncDurationMs: number | null;
  lastFullChromeResyncStatus: 'never' | 'success' | 'failed';
  lastFullChromeResyncReason: 'initial_seed' | 'on_demand_refresh' | null;
  lastRefreshDecision:
    | 'full_chrome_resync'
    | 'skipped_recent_resync'
    | 'chrome_inventory_unavailable'
    | 'failed';
  lastRefreshDecisionReason: string;
}

export interface BrowserWorldSummary {
  primaryConclusion: string;
  activeWindow: {
    windowId: number | null;
    state: string | null;
    visibilityState: BrowserWorldWindowObject['visibilityState'] | null;
    focused: boolean | null;
    canTabrixOperate: boolean | null;
  };
  activeTab: {
    tabId: number | null;
    windowId: number | null;
    url: string | null;
    title: string | null;
    openedBy: BrowserWorldTabOpenedBy | null;
    canTabrixOperate: boolean | null;
  };
  currentTabObject: BrowserWorldTabStateSummary | null;
  lastAiOperatedTabObject: BrowserWorldTabStateSummary | null;
  currentTabAttributeGroups: BrowserWorldTabAttributeGroups | null;
  lastAiOperatedTabAttributeGroups: BrowserWorldTabAttributeGroups | null;
  counts: {
    windows: number;
    tabs: number;
    aiOpenedTabs: number;
    userOrPageOpenedTabs: number;
    operableTabs: number;
  };
  windowStateMatrix: BrowserWorldWindowStateMatrix;
  windowStateConclusion: string;
  windowOperationState: BrowserWorldWindowOperationState;
  currentWindowConclusion: string;
  windowLifecycleState: BrowserWorldWindowLifecycleState;
  windowLifecycleConclusion: string;
  tabStateMatrix: BrowserWorldTabStateMatrix;
  tabStateConclusion: string;
  tabLifecycleState: BrowserWorldTabLifecycleState;
  tabLifecycleConclusion: string;
  aiOperationState: BrowserWorldAiOperationState;
  currentOperationConclusion: string;
  browserObjectEdgeSummary: string;
  recentChangeSummary: string;
  objectChangeSummary: string;
  dynamicObjectUpdateSummary: string;
  objectChangeConclusion: string;
}

export interface BrowserWorldWindowStateMatrix {
  total: number;
  visible: number;
  minimized: number;
  unknownVisibility: number;
  focused: number;
  unfocused: number;
  focusUnknown: number;
  operable: number;
  inoperable: number;
  operabilityUnknown: number;
  stateCounts: Record<string, number>;
  typeCounts: Record<string, number>;
}

export type BrowserWorldWindowOperationRelation =
  | 'focused_window_visible_operable'
  | 'focused_window_minimized'
  | 'focused_window_not_operable'
  | 'focused_window_operability_unknown'
  | 'no_focused_window'
  | 'no_window_observed';

export interface BrowserWorldWindowOperationState {
  focusedWindowId: number | null;
  focusedWindowState: string | null;
  focusedWindowVisibilityState: BrowserWorldWindowObject['visibilityState'] | null;
  focusedWindowCanOperate: boolean | null;
  focusedWindowActiveTabId: number | null;
  focusedWindowActiveTabCanOperate: boolean | null;
  relationToCurrentOperableWindow: BrowserWorldWindowOperationRelation;
  canOperateFocusedWindow: boolean | null;
  visibleWindowCount: number;
  minimizedWindowCount: number;
  operableWindowCount: number;
  inoperableWindowCount: number;
}

export type BrowserWorldWindowLifecycleEventKind =
  | 'window_created'
  | 'window_removed'
  | 'window_focus_changed'
  | 'window_bounds_changed';

export interface BrowserWorldWindowLifecycleState {
  latestEventKind: BrowserWorldWindowLifecycleEventKind | null;
  latestEventWindowId: number | null;
  latestEventState: string | null;
  latestEventVisibilityState: BrowserWorldWindowObject['visibilityState'] | null;
  latestEventCanTabrixOperate: boolean | null;
  latestRemovedTabCount: number | null;
  latestRemovedAiOpenedTabCount: number | null;
  recentCreatedCount: number;
  recentRemovedCount: number;
  recentFocusChangedCount: number;
  recentBoundsChangedCount: number;
  retainedWindowCount: number;
  focusedWindowId: number | null;
  visibleWindowCount: number;
  minimizedWindowCount: number;
  operableWindowCount: number;
  inoperableWindowCount: number;
}

export interface BrowserWorldTabStateMatrix {
  total: number;
  active: number;
  background: number;
  activityUnknown: number;
  loading: number;
  complete: number;
  statusUnknown: number;
  discarded: number;
  audible: number;
  muted: number;
  pinned: number;
  withOpener: number;
  aiOpened: number;
  userOrPageOpened: number;
  unknownOpened: number;
  recentlyOperatedByAi: number;
  idleForAi: number;
  closedRetained: number;
  operable: number;
  inoperable: number;
  operabilityUnknown: number;
  statusCounts: Record<string, number>;
  ownerCounts: Record<BrowserWorldTabOpenedBy, number>;
}

export type BrowserWorldTabLifecycleEventKind =
  | 'tab_created'
  | 'tab_updated'
  | 'tab_removed'
  | 'tab_activated'
  | 'tab_replaced'
  | 'tab_attached'
  | 'tab_detached';

export interface BrowserWorldTabLifecycleState {
  latestEventKind: BrowserWorldTabLifecycleEventKind | null;
  latestEventTabId: number | null;
  latestEventWindowId: number | null;
  latestEventStatus: string | null;
  latestReplacedTabId: number | null;
  recentCreatedCount: number;
  recentUpdatedCount: number;
  recentActivatedCount: number;
  recentReplacedCount: number;
  recentAttachedCount: number;
  recentDetachedCount: number;
  recentRemovedCount: number;
  retainedTabCount: number;
  activeTabId: number | null;
  aiOpenedRetainedCount: number;
  userOrPageOpenedRetainedCount: number;
}

export type BrowserWorldAiOperationRelation =
  | 'same_as_browser_active'
  | 'latest_ai_operated_background_tab'
  | 'browser_active_not_latest_ai_operated'
  | 'no_ai_operation_observed'
  | 'unknown';

export interface BrowserWorldAiOperationState {
  browserActiveTabId: number | null;
  latestAiOperatedTabId: number | null;
  latestAiOperation: string | null;
  latestAiOperationAtMs: number | null;
  latestAiOperationConfidence: number | null;
  latestAiOperationReason: string | null;
  latestAiOperatedTabActive: boolean | null;
  latestAiOperatedTabWindowId: number | null;
  latestAiOperatedTabOpenedBy: BrowserWorldTabOpenedBy | null;
  latestAiOperatedTabCanOperate: boolean | null;
  relationToBrowserActiveTab: BrowserWorldAiOperationRelation;
  canContinueOnLatestAiOperatedTab: boolean | null;
  aiOpenedTabCount: number;
  recentlyOperatedTabCount: number;
  closedRetainedTabCount: number;
}

export interface BrowserWorldTabAttributeGroups {
  identity: {
    objectKind: 'BrowserTabObject';
    tabId: number;
    windowId: number | null;
    url: string;
    title: string;
  };
  runtime: {
    active: boolean | null;
    status: string | null;
    pendingUrl: string;
    discarded: boolean | null;
    audible: boolean | null;
    muted: boolean | null;
    pinned: boolean | null;
    openerTabId: number | null;
  };
  ownership: {
    openedBy: BrowserWorldTabOpenedBy;
    confidence: number;
    reason: string;
    aiOperationState: BrowserWorldTabObject['aiOperationState'];
    lastAiOperation: string | null;
    lastAiOperationAtMs: number | null;
    lastAiOperationConfidence: number | null;
    lastAiOperationReason: string | null;
  };
  operability: {
    canTabrixOperate: boolean | null;
    reason: string;
  };
}

export interface BrowserWorldTabStateSummary {
  objectKind: 'BrowserTabObject';
  tabId: number;
  windowId: number | null;
  url: string;
  pendingUrl: string;
  title: string;
  active: boolean | null;
  status: string | null;
  discarded: boolean | null;
  audible: boolean | null;
  muted: boolean | null;
  pinned: boolean | null;
  openerTabId: number | null;
  openedBy: BrowserWorldTabOpenedBy;
  openedByConfidence: number;
  openedByReason: string;
  aiOperationState: BrowserWorldTabObject['aiOperationState'];
  lastAiOperation: string | null;
  lastAiOperationAtMs: number | null;
  lastAiOperationConfidence: number | null;
  lastAiOperationReason: string | null;
  canTabrixOperate: boolean | null;
  operabilityReason: string;
}

export interface BrowserWorldEvent {
  eventKind:
    | 'inventory_seeded'
    | 'tab_created'
    | 'tab_updated'
    | 'tab_removed'
    | 'tab_activated'
    | 'tab_replaced'
    | 'tab_attached'
    | 'tab_detached'
    | 'window_created'
    | 'window_removed'
    | 'window_focus_changed'
    | 'window_bounds_changed'
    | 'ai_tab_marked';
  observedAtMs: number;
  tabId: number | null;
  replacedTabId?: number | null;
  windowId: number | null;
  oldWindowId?: number | null;
  newWindowId?: number | null;
  openedBy?: BrowserWorldTabOpenedBy;
  status?: string | null;
  aiOperation?: string | null;
  aiOperationReason?: string | null;
  windowState?: string | null;
  windowVisibilityState?: BrowserWorldWindowObject['visibilityState'];
  canTabrixOperate?: boolean | null;
  removedTabCount?: number | null;
  removedAiOpenedTabCount?: number | null;
}

type EventHook = {
  addListener?: (listener: any) => void;
  removeListener?: (listener: any) => void;
};

const MAX_RECENT_BROWSER_WORLD_EVENTS = 50;
const MIN_FULL_CHROME_RESYNC_INTERVAL_MS = 250;

const tabsById = new Map<number, BrowserWorldTabObject>();
const windowsById = new Map<number, BrowserWorldWindowObject>();
const pendingAiCreatedTabIds = new Set<number>();
const pendingAiOperatedTabs = new Map<
  number,
  { operation: string; operatedAtMs: number; reason: string }
>();
const recentEvents: BrowserWorldEvent[] = [];
let initialized = false;
let lastObservedAtMs: number | null = null;
let attached = false;
let detachCallbacks: Array<() => void> = [];
let initialInventorySeedEventRecorded = false;
let fullChromeResyncCount = 0;
let skippedChromeResyncCount = 0;
let lastFullChromeResyncAtMs: number | null = null;
let lastFullChromeResyncDurationMs: number | null = null;
let lastFullChromeResyncStatus: BrowserWorldRefreshHealth['lastFullChromeResyncStatus'] = 'never';
let lastFullChromeResyncReason: BrowserWorldRefreshHealth['lastFullChromeResyncReason'] = null;
let lastRefreshDecision: BrowserWorldRefreshHealth['lastRefreshDecision'] =
  'chrome_inventory_unavailable';
let lastRefreshDecisionReason = 'Chrome window inventory has not been requested yet.';

function nowMs(): number {
  return Date.now();
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function safeAiOperationLabel(operation: string): string {
  const trimmed = String(operation || '').trim();
  if (!trimmed || trimmed.length > 80) return 'unknown_ai_operation';
  if (!/^[a-z][a-z0-9_-]*$/i.test(trimmed)) return 'unknown_ai_operation';
  return trimmed;
}

function tabUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return String(tab.url || tab.pendingUrl || '');
}

function isOperableUrl(url: string): { canOperate: boolean | null; reason: string } {
  if (!url) return { canOperate: null, reason: 'url_unknown' };
  if (/^https?:\/\//i.test(url)) return { canOperate: true, reason: 'regular_web_page' };
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
    return { canOperate: false, reason: 'browser_internal_page' };
  }
  return { canOperate: null, reason: 'unknown_scheme' };
}

function isOperableWindow(
  window: { state?: unknown; type?: unknown },
  activeTabCanOperate: boolean | null,
): { canOperate: boolean | null; reason: string } {
  const windowType = String(window.type || 'unknown');
  const windowState = String(window.state || 'unknown');
  if (windowType !== 'normal' && windowType !== 'popup') {
    return { canOperate: false, reason: 'unsupported_window_type' };
  }
  if (windowState === 'minimized') return { canOperate: false, reason: 'window_minimized' };
  if (windowState === 'unknown') return { canOperate: null, reason: 'window_state_unknown' };
  if (activeTabCanOperate === false)
    return { canOperate: false, reason: 'active_tab_not_operable' };
  if (activeTabCanOperate === null)
    return { canOperate: null, reason: 'active_tab_operability_unknown' };
  return { canOperate: true, reason: 'active_tab_operable_in_visible_window' };
}

function visibilityStateFromChromeWindow(window: {
  state?: unknown;
}): BrowserWorldWindowObject['visibilityState'] {
  const state = String(window.state || 'unknown');
  if (state === 'minimized') return 'minimized';
  if (state === 'normal' || state === 'maximized' || state === 'fullscreen') return 'visible';
  return 'unknown';
}

function normalizeTab(
  tab: chrome.tabs.Tab,
  previous?: BrowserWorldTabObject,
  fallbackWindowId?: number | null,
): BrowserWorldTabObject | null {
  if (typeof tab.id !== 'number' || tab.id < 0) return null;
  const observedAt = nowMs();
  const url = tabUrl(tab);
  const operability = isOperableUrl(url);
  const wasAiPending = pendingAiCreatedTabIds.delete(tab.id);
  const pendingAiOperation = pendingAiOperatedTabs.get(tab.id) ?? null;
  if (pendingAiOperation) pendingAiOperatedTabs.delete(tab.id);
  const openedBy = wasAiPending ? 'ai' : (previous?.openedBy ?? 'user_or_page');
  const openedByReason = wasAiPending
    ? 'marked_by_tabrix_navigation_before_tabs_onCreated'
    : (previous?.openedByReason ??
      (typeof tab.openerTabId === 'number'
        ? 'chrome_tabs_openerTabId_present'
        : 'observed_by_chrome_inventory_without_ai_marker'));
  return {
    objectKind: 'BrowserTabObject',
    tabId: tab.id,
    windowId:
      typeof tab.windowId === 'number'
        ? tab.windowId
        : (previous?.windowId ?? fallbackWindowId ?? null),
    url,
    pendingUrl: String(tab.pendingUrl || ''),
    title: String(tab.title || ''),
    active: typeof tab.active === 'boolean' ? tab.active : (previous?.active ?? null),
    status: typeof tab.status === 'string' ? tab.status : (previous?.status ?? null),
    discarded: typeof tab.discarded === 'boolean' ? tab.discarded : (previous?.discarded ?? null),
    audible: typeof tab.audible === 'boolean' ? tab.audible : (previous?.audible ?? null),
    muted:
      typeof tab.mutedInfo?.muted === 'boolean' ? tab.mutedInfo.muted : (previous?.muted ?? null),
    pinned: typeof tab.pinned === 'boolean' ? tab.pinned : (previous?.pinned ?? null),
    openerTabId:
      typeof tab.openerTabId === 'number' ? tab.openerTabId : (previous?.openerTabId ?? null),
    openedBy,
    openedByConfidence: openedBy === 'ai' ? 0.95 : 0.7,
    openedByReason,
    aiOperationState:
      pendingAiOperation || previous?.aiOperationState === 'recently_operated'
        ? 'recently_operated'
        : openedBy === 'ai'
          ? 'recently_operated'
          : 'idle',
    lastAiOperation:
      pendingAiOperation?.operation ??
      previous?.lastAiOperation ??
      (openedBy === 'ai' ? 'tab_created' : null),
    lastAiOperationAtMs:
      pendingAiOperation?.operatedAtMs ??
      previous?.lastAiOperationAtMs ??
      (openedBy === 'ai' ? observedAt : null),
    lastAiOperationConfidence:
      pendingAiOperation !== null
        ? 0.95
        : typeof previous?.lastAiOperationConfidence === 'number'
          ? previous.lastAiOperationConfidence
          : openedBy === 'ai'
            ? 0.95
            : null,
    lastAiOperationReason:
      pendingAiOperation?.reason ??
      previous?.lastAiOperationReason ??
      (openedBy === 'ai' ? 'marked_by_tabrix_navigation_before_tabs_onCreated' : null),
    createdAtMs: previous?.createdAtMs ?? observedAt,
    updatedAtMs: observedAt,
    closedAtMs: null,
    canTabrixOperate: operability.canOperate,
    operabilityReason: operability.reason,
  };
}

function normalizeWindow(
  window: chrome.windows.Window,
  previous?: BrowserWorldWindowObject,
): BrowserWorldWindowObject | null {
  if (typeof window.id !== 'number') return null;
  const hasTabPayload = Array.isArray(window.tabs);
  const payloadTabs = hasTabPayload ? (window.tabs ?? []) : [];
  const knownTabs = hasTabPayload
    ? []
    : Array.from(tabsById.values()).filter((tab) => tab.windowId === window.id);
  const activePayloadTab = payloadTabs.find((tab) => tab.active === true);
  const activeKnownTab =
    knownTabs.find((tab) => tab.active === true) ??
    (typeof previous?.activeTabId === 'number' ? tabsById.get(previous.activeTabId) : undefined);
  const activeTabId =
    typeof activePayloadTab?.id === 'number'
      ? activePayloadTab.id
      : (activeKnownTab?.tabId ?? previous?.activeTabId ?? null);
  const activeTabCanOperate = activePayloadTab
    ? isOperableUrl(tabUrl(activePayloadTab)).canOperate
    : (activeKnownTab?.canTabrixOperate ?? previous?.activeTabCanOperate ?? null);
  const windowOperability = isOperableWindow(window, activeTabCanOperate);
  const state = String(window.state || 'unknown');
  return {
    objectKind: 'BrowserWindowObject',
    windowId: window.id,
    focused: typeof window.focused === 'boolean' ? window.focused : null,
    state,
    visibilityState: visibilityStateFromChromeWindow(window),
    isFocused: typeof window.focused === 'boolean' ? window.focused : null,
    isMinimized: state === 'minimized' ? true : state === 'unknown' ? null : false,
    type: String(window.type || 'unknown'),
    incognito: typeof window.incognito === 'boolean' ? window.incognito : null,
    width: readInteger(window.width),
    height: readInteger(window.height),
    left: readInteger(window.left),
    top: readInteger(window.top),
    activeTabId,
    activeTabCanOperate,
    canTabrixOperate: windowOperability.canOperate,
    operabilityReason: windowOperability.reason,
    tabCount: hasTabPayload ? payloadTabs.length : knownTabs.length || previous?.tabCount || 0,
    updatedAtMs: nowMs(),
  };
}

function upsertTabsFromWindow(window: chrome.windows.Window): void {
  const fallbackWindowId = typeof window.id === 'number' ? window.id : null;
  for (const tab of window.tabs ?? []) {
    const previous = typeof tab.id === 'number' ? tabsById.get(tab.id) : undefined;
    const normalized = normalizeTab(tab, previous, fallbackWindowId);
    if (normalized) tabsById.set(normalized.tabId, normalized);
  }
}

function refreshWindowActiveTabState(windowId: number, activeTabId: number | null): void {
  const window = windowsById.get(windowId);
  if (!window) return;
  const activeTab = typeof activeTabId === 'number' ? tabsById.get(activeTabId) : undefined;
  const activeTabCanOperate = activeTab?.canTabrixOperate ?? null;
  const windowOperability = isOperableWindow(window, activeTabCanOperate);
  windowsById.set(windowId, {
    ...window,
    activeTabId,
    activeTabCanOperate,
    canTabrixOperate: windowOperability.canOperate,
    operabilityReason: windowOperability.reason,
    updatedAtMs: nowMs(),
  });
}

function markActiveTabWithinWindow(windowId: number, activeTabId: number): void {
  for (const [id, tab] of tabsById) {
    if (tab.windowId === windowId)
      tabsById.set(id, { ...tab, active: id === activeTabId, updatedAtMs: nowMs() });
  }
}

function markFocusedWindow(focusedWindowId: number | null): void {
  for (const [id, window] of windowsById) {
    const focused = id === focusedWindowId;
    windowsById.set(id, { ...window, focused, isFocused: focused, updatedAtMs: nowMs() });
  }
}

function refreshWindowDerivedTabState(windowId: number): void {
  const window = windowsById.get(windowId);
  if (!window) return;
  const tabs = Array.from(tabsById.values()).filter((tab) => tab.windowId === windowId);
  const activeTab = tabs.find((tab) => tab.active === true) ?? null;
  const activeTabCanOperate = activeTab?.canTabrixOperate ?? null;
  const windowOperability = isOperableWindow(window, activeTabCanOperate);
  windowsById.set(windowId, {
    ...window,
    activeTabId: activeTab?.tabId ?? null,
    activeTabCanOperate,
    canTabrixOperate: windowOperability.canOperate,
    operabilityReason: windowOperability.reason,
    tabCount: tabs.length,
    updatedAtMs: nowMs(),
  });
}

function recordObserved(): void {
  lastObservedAtMs = nowMs();
}

function pushEvent(event: Omit<BrowserWorldEvent, 'observedAtMs'>): void {
  recentEvents.push({ ...event, observedAtMs: nowMs() });
  while (recentEvents.length > MAX_RECENT_BROWSER_WORLD_EVENTS) recentEvents.shift();
  recordObserved();
}

async function seedFromChrome(
  reason: BrowserWorldRefreshHealth['lastFullChromeResyncReason'] = 'initial_seed',
  options: { allowThrottle?: boolean } = {},
): Promise<void> {
  const startedAt = nowMs();
  if (
    options.allowThrottle === true &&
    lastFullChromeResyncAtMs !== null &&
    startedAt - lastFullChromeResyncAtMs < MIN_FULL_CHROME_RESYNC_INTERVAL_MS
  ) {
    skippedChromeResyncCount += 1;
    lastRefreshDecision = 'skipped_recent_resync';
    lastRefreshDecisionReason =
      'Skipped full chrome.windows.getAll resync because the local Browser World snapshot was refreshed recently.';
    return;
  }
  if (typeof chrome?.windows?.getAll !== 'function') {
    lastRefreshDecision = 'chrome_inventory_unavailable';
    lastRefreshDecisionReason =
      'chrome.windows.getAll is unavailable; keeping any existing local Browser World state.';
    return;
  }
  let windows: chrome.windows.Window[];
  try {
    windows = await chrome.windows.getAll({ populate: true });
  } catch (error) {
    lastFullChromeResyncStatus = 'failed';
    lastFullChromeResyncReason = reason;
    lastFullChromeResyncDurationMs = Math.max(0, nowMs() - startedAt);
    lastRefreshDecision = 'failed';
    lastRefreshDecisionReason =
      error instanceof Error
        ? `Full Chrome resync failed: ${error.name || 'Error'}`
        : 'Full Chrome resync failed with a non-Error value.';
    throw error;
  }
  const previousTabs = new Map(tabsById);
  windowsById.clear();
  tabsById.clear();
  for (const window of windows) {
    const normalizedWindow = normalizeWindow(window);
    if (normalizedWindow) windowsById.set(normalizedWindow.windowId, normalizedWindow);
    for (const tab of window.tabs ?? []) {
      const previous = typeof tab.id === 'number' ? previousTabs.get(tab.id) : undefined;
      const normalizedTab = normalizeTab(tab, previous, normalizedWindow?.windowId ?? null);
      if (normalizedTab) tabsById.set(normalizedTab.tabId, normalizedTab);
    }
  }
  fullChromeResyncCount += 1;
  lastFullChromeResyncAtMs = nowMs();
  lastFullChromeResyncDurationMs = Math.max(0, lastFullChromeResyncAtMs - startedAt);
  lastFullChromeResyncStatus = 'success';
  lastFullChromeResyncReason = reason;
  lastRefreshDecision = 'full_chrome_resync';
  lastRefreshDecisionReason =
    'Completed chrome.windows.getAll resync and rebuilt Browser World window/tab objects.';
  initialized = true;
  if (!initialInventorySeedEventRecorded) {
    initialInventorySeedEventRecorded = true;
    pushEvent({ eventKind: 'inventory_seeded', tabId: null, windowId: null });
    return;
  }
  recordObserved();
}

function bind(hook: EventHook | undefined, listener: any): void {
  if (!hook || typeof hook.addListener !== 'function') return;
  hook.addListener(listener);
  detachCallbacks.push(() => {
    try {
      hook.removeListener?.(listener);
    } catch {
      // Best-effort detach for tests and service-worker restart.
    }
  });
}

export function initBrowserWorldInventory(): void {
  if (attached) return;
  attached = true;
  void seedFromChrome('initial_seed').catch(() => {
    initialized = false;
  });

  bind(chrome.tabs?.onCreated, (tab: chrome.tabs.Tab) => {
    const normalized = normalizeTab(tab, undefined);
    if (normalized) {
      tabsById.set(normalized.tabId, normalized);
      if (typeof normalized.windowId === 'number') {
        if (normalized.active === true)
          markActiveTabWithinWindow(normalized.windowId, normalized.tabId);
        refreshWindowDerivedTabState(normalized.windowId);
      }
    }
    pushEvent({
      eventKind: 'tab_created',
      tabId: normalized?.tabId ?? null,
      windowId: normalized?.windowId ?? null,
      openedBy: normalized?.openedBy,
      status: normalized?.status ?? null,
    });
  });
  bind(
    chrome.tabs?.onUpdated,
    (tabId: number, _changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      const previous = tabsById.get(tabId);
      const normalized = normalizeTab(
        { ...previous, ...tab, id: tabId } as chrome.tabs.Tab,
        previous,
      );
      if (normalized) tabsById.set(tabId, normalized);
      if (typeof normalized?.windowId === 'number') {
        if (normalized.active === true) markActiveTabWithinWindow(normalized.windowId, tabId);
        refreshWindowDerivedTabState(normalized.windowId);
      }
      pushEvent({
        eventKind: 'tab_updated',
        tabId,
        windowId: normalized?.windowId ?? null,
        openedBy: normalized?.openedBy,
        status: normalized?.status ?? null,
      });
    },
  );
  bind(chrome.tabs?.onRemoved, (tabId: number, info: chrome.tabs.TabRemoveInfo) => {
    const previous = tabsById.get(tabId);
    const windowId =
      typeof info?.windowId === 'number' ? info.windowId : (previous?.windowId ?? null);
    if (previous) {
      tabsById.set(tabId, {
        ...previous,
        windowId,
        active: false,
        aiOperationState: 'closed',
        updatedAtMs: nowMs(),
        closedAtMs: nowMs(),
      });
      tabsById.delete(tabId);
    }
    if (windowId !== null) refreshWindowDerivedTabState(windowId);
    pendingAiCreatedTabIds.delete(tabId);
    pushEvent({
      eventKind: 'tab_removed',
      tabId,
      windowId,
      openedBy: previous?.openedBy,
      aiOperation: previous?.lastAiOperation,
      aiOperationReason: previous?.lastAiOperationReason,
    });
  });
  bind((chrome.tabs as any)?.onActivated, (activeInfo: chrome.tabs.TabActiveInfo) => {
    const tabId = activeInfo.tabId;
    const windowId = activeInfo.windowId;
    markActiveTabWithinWindow(windowId, tabId);
    const window = windowsById.get(windowId);
    if (window) refreshWindowActiveTabState(windowId, tabId);
    pushEvent({ eventKind: 'tab_activated', tabId, windowId });
  });
  bind((chrome.tabs as any)?.onReplaced, (addedTabId: number, removedTabId: number) => {
    const previous = tabsById.get(removedTabId);
    tabsById.delete(removedTabId);
    if (previous) {
      tabsById.set(addedTabId, {
        ...previous,
        tabId: addedTabId,
        updatedAtMs: nowMs(),
      });
      if (previous.windowId !== null) refreshWindowDerivedTabState(previous.windowId);
    }
    pushEvent({
      eventKind: 'tab_replaced',
      tabId: addedTabId,
      replacedTabId: removedTabId,
      windowId: previous?.windowId ?? null,
      openedBy: previous?.openedBy,
      status: previous?.status ?? null,
    });
  });
  bind((chrome.tabs as any)?.onDetached, (tabId: number, detachInfo: any) => {
    const oldWindowId = readInteger(detachInfo?.oldWindowId);
    const previous = tabsById.get(tabId);
    if (previous) {
      tabsById.set(tabId, {
        ...previous,
        windowId: null,
        active: false,
        updatedAtMs: nowMs(),
      });
    }
    if (oldWindowId !== null) refreshWindowDerivedTabState(oldWindowId);
    pushEvent({
      eventKind: 'tab_detached',
      tabId,
      windowId: oldWindowId,
      oldWindowId,
      openedBy: previous?.openedBy,
      status: previous?.status ?? null,
    });
  });
  bind((chrome.tabs as any)?.onAttached, (tabId: number, attachInfo: any) => {
    const newWindowId = readInteger(attachInfo?.newWindowId);
    const previous = tabsById.get(tabId);
    if (previous) {
      tabsById.set(tabId, {
        ...previous,
        windowId: newWindowId,
        updatedAtMs: nowMs(),
      });
    }
    if (newWindowId !== null) refreshWindowDerivedTabState(newWindowId);
    pushEvent({
      eventKind: 'tab_attached',
      tabId,
      windowId: newWindowId,
      newWindowId,
      openedBy: previous?.openedBy,
      status: previous?.status ?? null,
    });
  });
  bind(chrome.windows?.onCreated, (window: chrome.windows.Window) => {
    const normalized = normalizeWindow(window);
    if (normalized) windowsById.set(normalized.windowId, normalized);
    upsertTabsFromWindow(window);
    if (normalized?.focused === true) markFocusedWindow(normalized.windowId);
    pushEvent({
      eventKind: 'window_created',
      tabId: normalized?.activeTabId ?? null,
      windowId: normalized?.windowId ?? null,
      windowState: normalized?.state ?? null,
      windowVisibilityState: normalized?.visibilityState,
      canTabrixOperate: normalized?.canTabrixOperate ?? null,
    });
  });
  bind(chrome.windows?.onRemoved, (windowId: number) => {
    let removedTabCount = 0;
    let removedAiOpenedTabCount = 0;
    windowsById.delete(windowId);
    for (const [tabId, tab] of tabsById) {
      if (tab.windowId === windowId) {
        removedTabCount += 1;
        if (tab.openedBy === 'ai') removedAiOpenedTabCount += 1;
        tabsById.delete(tabId);
      }
    }
    pushEvent({
      eventKind: 'window_removed',
      tabId: null,
      windowId,
      removedTabCount,
      removedAiOpenedTabCount,
    });
  });
  bind(chrome.windows?.onFocusChanged, (windowId: number) => {
    markFocusedWindow(windowId >= 0 ? windowId : null);
    const focusedWindow = windowsById.get(windowId);
    pushEvent({
      eventKind: 'window_focus_changed',
      tabId: null,
      windowId,
      windowState: focusedWindow?.state ?? null,
      windowVisibilityState: focusedWindow?.visibilityState,
      canTabrixOperate: focusedWindow?.canTabrixOperate ?? null,
    });
  });
  bind((chrome.windows as any)?.onBoundsChanged, (window: chrome.windows.Window) => {
    const previous = typeof window.id === 'number' ? windowsById.get(window.id) : undefined;
    const normalized = normalizeWindow(window, previous);
    if (normalized) windowsById.set(normalized.windowId, normalized);
    upsertTabsFromWindow(window);
    if (normalized?.focused === true) markFocusedWindow(normalized.windowId);
    pushEvent({
      eventKind: 'window_bounds_changed',
      tabId: normalized?.activeTabId ?? null,
      windowId: normalized?.windowId ?? null,
      windowState: normalized?.state ?? null,
      windowVisibilityState: normalized?.visibilityState,
      canTabrixOperate: normalized?.canTabrixOperate ?? null,
    });
  });
}

export function markBrowserWorldTabAiCreated(tabId: number | null | undefined): void {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const previous = tabsById.get(tabId);
  if (!previous) {
    pendingAiCreatedTabIds.add(tabId);
  }
  if (previous) {
    tabsById.set(tabId, {
      ...previous,
      openedBy: 'ai',
      openedByConfidence: 0.95,
      openedByReason: 'marked_by_tabrix_navigation_result',
      aiOperationState: 'recently_operated',
      lastAiOperation: 'tab_created',
      lastAiOperationAtMs: nowMs(),
      lastAiOperationConfidence: 0.95,
      lastAiOperationReason: 'marked_by_tabrix_navigation_result',
      updatedAtMs: nowMs(),
    });
  }
  pushEvent({
    eventKind: 'ai_tab_marked',
    tabId,
    windowId: previous?.windowId ?? null,
    openedBy: 'ai',
    aiOperation: 'tab_created',
    aiOperationReason: 'marked_by_tabrix_navigation_result',
  });
}

export function markBrowserWorldTabAiOperated(
  tabId: number | null | undefined,
  operation: string,
): void {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const safeOperation = safeAiOperationLabel(operation);
  const safeReason = `marked_by_tabrix_tool_execution:${safeOperation}`;
  const previous = tabsById.get(tabId);
  if (previous) {
    tabsById.set(tabId, {
      ...previous,
      aiOperationState: 'recently_operated',
      lastAiOperation: safeOperation,
      lastAiOperationAtMs: nowMs(),
      lastAiOperationConfidence: 0.95,
      lastAiOperationReason: safeReason,
      updatedAtMs: nowMs(),
    });
  } else {
    pendingAiOperatedTabs.set(tabId, {
      operation: safeOperation,
      operatedAtMs: nowMs(),
      reason: safeReason,
    });
  }
  pushEvent({
    eventKind: 'ai_tab_marked',
    tabId,
    windowId: previous?.windowId ?? null,
    openedBy: previous?.openedBy,
    aiOperation: safeOperation,
    aiOperationReason: safeReason,
  });
}

export async function getBrowserWorldSnapshot(): Promise<BrowserWorldSnapshot> {
  if (!initialized) {
    await seedFromChrome('initial_seed').catch(() => undefined);
  }
  return buildSnapshot();
}

export async function refreshBrowserWorldSnapshot(): Promise<BrowserWorldSnapshot> {
  await seedFromChrome('on_demand_refresh', { allowThrottle: initialized }).catch(() => undefined);
  return buildSnapshot();
}

function buildSnapshot(): BrowserWorldSnapshot {
  const observedAtMs = nowMs();
  const tabs = Array.from(tabsById.values()).sort((a, b) => a.tabId - b.tabId);
  const windows = Array.from(windowsById.values()).sort((a, b) => a.windowId - b.windowId);
  const focusedWindow = windows.find((window) => window.focused === true);
  const browserActiveTab =
    focusedWindow?.activeTabId ??
    tabs.find((tab) => tab.active === true && tab.windowId === focusedWindow?.windowId)?.tabId ??
    null;
  const activeTab = tabs.find((tab) => tab.tabId === browserActiveTab) ?? null;
  const aiOpenedTabIds = tabs.filter((tab) => tab.openedBy === 'ai').map((tab) => tab.tabId);
  const userOrPageOpenedTabIds = tabs
    .filter((tab) => tab.openedBy === 'user_or_page')
    .map((tab) => tab.tabId);
  const operableTabIds = tabs
    .filter((tab) => tab.canTabrixOperate === true)
    .map((tab) => tab.tabId);
  const windowStateMatrix = buildWindowStateMatrix(windows);
  const windowOperationState = buildWindowOperationState(windowStateMatrix, focusedWindow ?? null);
  const windowLifecycleState = buildWindowLifecycleState(
    recentEvents,
    windows,
    focusedWindow ?? null,
    windowStateMatrix,
  );
  const tabStateMatrix = buildTabStateMatrix(tabs);
  const tabLifecycleState = buildTabLifecycleState(recentEvents, tabs, activeTab);
  const lastAiOperatedTab =
    tabs
      .filter((tab) => tab.lastAiOperationAtMs !== null)
      .sort((a, b) => (b.lastAiOperationAtMs ?? 0) - (a.lastAiOperationAtMs ?? 0))[0] ?? null;
  const aiOperationState = buildAiOperationState(tabs, activeTab, lastAiOperatedTab);
  const recentChangeSummary = summarizeRecentEvents(recentEvents);
  return {
    source: 'extension_browser_world_inventory',
    version: 1,
    initialized,
    observedAtMs,
    snapshotAgeMs: lastObservedAtMs === null ? null : Math.max(0, observedAtMs - lastObservedAtMs),
    refreshHealth: {
      fullChromeResyncCount,
      skippedChromeResyncCount,
      minFullChromeResyncIntervalMs: MIN_FULL_CHROME_RESYNC_INTERVAL_MS,
      lastFullChromeResyncAtMs,
      lastFullChromeResyncDurationMs,
      lastFullChromeResyncStatus,
      lastFullChromeResyncReason,
      lastRefreshDecision,
      lastRefreshDecisionReason,
    },
    windowCount: windows.length,
    tabCount: tabs.length,
    focusedWindowId: focusedWindow?.windowId ?? null,
    browserActiveTabId: browserActiveTab,
    aiOpenedTabIds,
    userOrPageOpenedTabIds,
    operableTabIds,
    summary: {
      primaryConclusion: `Browser world snapshot: ${windows.length} window(s), ${tabs.length} tab(s), activeTab=${browserActiveTab ?? 'unknown'}, aiOpenedTabs=${aiOpenedTabIds.length}, operableTabs=${operableTabIds.length}.`,
      activeWindow: {
        windowId: focusedWindow?.windowId ?? null,
        state: focusedWindow?.state ?? null,
        visibilityState: focusedWindow?.visibilityState ?? null,
        focused: focusedWindow?.focused ?? null,
        canTabrixOperate: focusedWindow?.canTabrixOperate ?? null,
      },
      activeTab: {
        tabId: activeTab?.tabId ?? null,
        windowId: activeTab?.windowId ?? null,
        url: activeTab?.url ?? null,
        title: activeTab?.title ?? null,
        openedBy: activeTab?.openedBy ?? null,
        canTabrixOperate: activeTab?.canTabrixOperate ?? null,
      },
      currentTabObject: activeTab ? summarizeTabState(activeTab) : null,
      lastAiOperatedTabObject: lastAiOperatedTab ? summarizeTabState(lastAiOperatedTab) : null,
      currentTabAttributeGroups: activeTab ? buildTabAttributeGroups(activeTab) : null,
      lastAiOperatedTabAttributeGroups: lastAiOperatedTab
        ? buildTabAttributeGroups(lastAiOperatedTab)
        : null,
      counts: {
        windows: windows.length,
        tabs: tabs.length,
        aiOpenedTabs: aiOpenedTabIds.length,
        userOrPageOpenedTabs: userOrPageOpenedTabIds.length,
        operableTabs: operableTabIds.length,
      },
      windowStateMatrix,
      windowStateConclusion: summarizeWindowStateMatrix(windowStateMatrix, focusedWindow ?? null),
      windowOperationState,
      currentWindowConclusion: summarizeCurrentWindow(windowOperationState),
      windowLifecycleState,
      windowLifecycleConclusion: summarizeWindowLifecycle(windowLifecycleState),
      tabStateMatrix,
      tabStateConclusion: summarizeTabStateMatrix(tabStateMatrix, activeTab, lastAiOperatedTab),
      tabLifecycleState,
      tabLifecycleConclusion: summarizeTabLifecycle(tabLifecycleState),
      aiOperationState,
      currentOperationConclusion: summarizeCurrentOperation(aiOperationState),
      browserObjectEdgeSummary: summarizeBrowserObjectEdgeState(
        windowStateMatrix,
        tabStateMatrix,
        windowOperationState,
        aiOperationState,
      ),
      recentChangeSummary,
      objectChangeSummary: summarizeObjectChangeSummary(
        recentEvents,
        activeTab,
        lastAiOperatedTab,
        focusedWindow ?? null,
        tabLifecycleState,
        aiOperationState,
        windowOperationState,
      ),
      dynamicObjectUpdateSummary: summarizeDynamicObjectUpdate(
        recentEvents,
        activeTab,
        lastAiOperatedTab,
        focusedWindow ?? null,
        tabLifecycleState,
        aiOperationState,
        windowOperationState,
      ),
      objectChangeConclusion: summarizeObjectChangeConclusion(
        recentEvents,
        activeTab,
        lastAiOperatedTab,
        focusedWindow ?? null,
      ),
    },
    retentionPolicy: {
      recentEventLimit: MAX_RECENT_BROWSER_WORLD_EVENTS,
      recentEventsRetained: recentEvents.length,
      windowObjectsRetained: windows.length,
      tabObjectsRetained: tabs.length,
      refreshMode: 'event_driven_with_on_demand_chrome_resync',
      minFullChromeResyncIntervalMs: MIN_FULL_CHROME_RESYNC_INTERVAL_MS,
      eventPrivacyBoundary:
        'Recent browser lifecycle events retain ids, status, ownership, and timestamps only; they do not retain tab URLs, titles, page text, screenshots, cookies, account state, QR payloads, or network bodies.',
      detailBoundary:
        'Current BrowserWindowObject and BrowserTabObject details may include live tab URLs and titles for AI operation routing; do not copy raw details into public evidence.',
    },
    recentEvents: [...recentEvents],
    windows,
    tabs,
  };
}

export function resetBrowserWorldInventoryForTests(): void {
  for (const detach of detachCallbacks) detach();
  detachCallbacks = [];
  tabsById.clear();
  windowsById.clear();
  pendingAiCreatedTabIds.clear();
  pendingAiOperatedTabs.clear();
  recentEvents.length = 0;
  initialized = false;
  lastObservedAtMs = null;
  attached = false;
  initialInventorySeedEventRecorded = false;
  fullChromeResyncCount = 0;
  skippedChromeResyncCount = 0;
  lastFullChromeResyncAtMs = null;
  lastFullChromeResyncDurationMs = null;
  lastFullChromeResyncStatus = 'never';
  lastFullChromeResyncReason = null;
  lastRefreshDecision = 'chrome_inventory_unavailable';
  lastRefreshDecisionReason = 'Chrome window inventory has not been requested yet.';
}
