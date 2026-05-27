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
  type: string;
  incognito: boolean | null;
  width: number | null;
  height: number | null;
  left: number | null;
  top: number | null;
  activeTabId: number | null;
  tabCount: number;
  updatedAtMs: number;
}

export interface BrowserWorldSnapshot {
  source: 'extension_browser_world_inventory';
  version: 1;
  initialized: boolean;
  observedAtMs: number;
  snapshotAgeMs: number | null;
  windowCount: number;
  tabCount: number;
  focusedWindowId: number | null;
  browserActiveTabId: number | null;
  aiOpenedTabIds: number[];
  userOrPageOpenedTabIds: number[];
  operableTabIds: number[];
  summary: BrowserWorldSummary;
  recentEvents: BrowserWorldEvent[];
  windows: BrowserWorldWindowObject[];
  tabs: BrowserWorldTabObject[];
}

export interface BrowserWorldSummary {
  primaryConclusion: string;
  activeTab: {
    tabId: number | null;
    windowId: number | null;
    url: string | null;
    title: string | null;
    openedBy: BrowserWorldTabOpenedBy | null;
    canTabrixOperate: boolean | null;
  };
  counts: {
    windows: number;
    tabs: number;
    aiOpenedTabs: number;
    userOrPageOpenedTabs: number;
    operableTabs: number;
  };
  recentChangeSummary: string;
}

export interface BrowserWorldEvent {
  eventKind:
    | 'inventory_seeded'
    | 'tab_created'
    | 'tab_updated'
    | 'tab_removed'
    | 'tab_activated'
    | 'tab_replaced'
    | 'window_created'
    | 'window_removed'
    | 'window_focus_changed'
    | 'ai_tab_marked';
  observedAtMs: number;
  tabId: number | null;
  windowId: number | null;
  openedBy?: BrowserWorldTabOpenedBy;
  url?: string;
}

type EventHook = {
  addListener?: (listener: any) => void;
  removeListener?: (listener: any) => void;
};

const tabsById = new Map<number, BrowserWorldTabObject>();
const windowsById = new Map<number, BrowserWorldWindowObject>();
const pendingAiCreatedTabIds = new Set<number>();
const recentEvents: BrowserWorldEvent[] = [];
let initialized = false;
let lastObservedAtMs: number | null = null;
let attached = false;
let detachCallbacks: Array<() => void> = [];

function nowMs(): number {
  return Date.now();
}

function readInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
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
      previous?.aiOperationState ?? (openedBy === 'ai' ? 'recently_operated' : 'idle'),
    lastAiOperation: previous?.lastAiOperation ?? (openedBy === 'ai' ? 'tab_created' : null),
    lastAiOperationAtMs: previous?.lastAiOperationAtMs ?? (openedBy === 'ai' ? observedAt : null),
    createdAtMs: previous?.createdAtMs ?? observedAt,
    updatedAtMs: observedAt,
    closedAtMs: null,
    canTabrixOperate: operability.canOperate,
    operabilityReason: operability.reason,
  };
}

function normalizeWindow(window: chrome.windows.Window): BrowserWorldWindowObject | null {
  if (typeof window.id !== 'number') return null;
  const tabs = Array.isArray(window.tabs) ? window.tabs : [];
  const activeTab = tabs.find((tab) => tab.active === true);
  return {
    objectKind: 'BrowserWindowObject',
    windowId: window.id,
    focused: typeof window.focused === 'boolean' ? window.focused : null,
    state: String(window.state || 'unknown'),
    type: String(window.type || 'unknown'),
    incognito: typeof window.incognito === 'boolean' ? window.incognito : null,
    width: readInteger(window.width),
    height: readInteger(window.height),
    left: readInteger(window.left),
    top: readInteger(window.top),
    activeTabId: typeof activeTab?.id === 'number' ? activeTab.id : null,
    tabCount: tabs.length,
    updatedAtMs: nowMs(),
  };
}

function recordObserved(): void {
  lastObservedAtMs = nowMs();
}

function pushEvent(event: Omit<BrowserWorldEvent, 'observedAtMs'>): void {
  recentEvents.push({ ...event, observedAtMs: nowMs() });
  while (recentEvents.length > 50) recentEvents.shift();
  recordObserved();
}

async function seedFromChrome(): Promise<void> {
  if (typeof chrome?.windows?.getAll !== 'function') return;
  const windows = await chrome.windows.getAll({ populate: true });
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
  initialized = true;
  pushEvent({ eventKind: 'inventory_seeded', tabId: null, windowId: null });
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
  void seedFromChrome().catch(() => {
    initialized = false;
  });

  bind(chrome.tabs?.onCreated, (tab: chrome.tabs.Tab) => {
    const normalized = normalizeTab(tab, undefined);
    if (normalized) tabsById.set(normalized.tabId, normalized);
    pushEvent({
      eventKind: 'tab_created',
      tabId: normalized?.tabId ?? null,
      windowId: normalized?.windowId ?? null,
      openedBy: normalized?.openedBy,
      url: normalized?.url,
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
      pushEvent({
        eventKind: 'tab_updated',
        tabId,
        windowId: normalized?.windowId ?? null,
        openedBy: normalized?.openedBy,
        url: normalized?.url,
      });
    },
  );
  bind(chrome.tabs?.onRemoved, (tabId: number, info: chrome.tabs.TabRemoveInfo) => {
    const previous = tabsById.get(tabId);
    if (previous) {
      tabsById.set(tabId, {
        ...previous,
        windowId: typeof info?.windowId === 'number' ? info.windowId : previous.windowId,
        active: false,
        aiOperationState: 'closed',
        updatedAtMs: nowMs(),
        closedAtMs: nowMs(),
      });
      tabsById.delete(tabId);
    }
    pendingAiCreatedTabIds.delete(tabId);
    pushEvent({
      eventKind: 'tab_removed',
      tabId,
      windowId: typeof info?.windowId === 'number' ? info.windowId : (previous?.windowId ?? null),
      openedBy: previous?.openedBy,
      url: previous?.url,
    });
  });
  bind((chrome.tabs as any)?.onActivated, (activeInfo: chrome.tabs.TabActiveInfo) => {
    const tabId = activeInfo.tabId;
    const windowId = activeInfo.windowId;
    for (const [id, tab] of tabsById) {
      if (tab.windowId === windowId)
        tabsById.set(id, { ...tab, active: id === tabId, updatedAtMs: nowMs() });
    }
    const window = windowsById.get(windowId);
    if (window) {
      windowsById.set(windowId, { ...window, activeTabId: tabId, updatedAtMs: nowMs() });
    }
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
    }
    pushEvent({
      eventKind: 'tab_replaced',
      tabId: addedTabId,
      windowId: previous?.windowId ?? null,
      openedBy: previous?.openedBy,
      url: previous?.url,
    });
  });
  bind(chrome.windows?.onCreated, (window: chrome.windows.Window) => {
    const normalized = normalizeWindow(window);
    if (normalized) windowsById.set(normalized.windowId, normalized);
    pushEvent({
      eventKind: 'window_created',
      tabId: normalized?.activeTabId ?? null,
      windowId: normalized?.windowId ?? null,
    });
  });
  bind(chrome.windows?.onRemoved, (windowId: number) => {
    windowsById.delete(windowId);
    for (const [tabId, tab] of tabsById) {
      if (tab.windowId === windowId) tabsById.delete(tabId);
    }
    pushEvent({ eventKind: 'window_removed', tabId: null, windowId });
  });
  bind(chrome.windows?.onFocusChanged, (windowId: number) => {
    for (const [id, window] of windowsById) {
      windowsById.set(id, { ...window, focused: id === windowId, updatedAtMs: nowMs() });
    }
    pushEvent({ eventKind: 'window_focus_changed', tabId: null, windowId });
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
      updatedAtMs: nowMs(),
    });
  }
  pushEvent({
    eventKind: 'ai_tab_marked',
    tabId,
    windowId: previous?.windowId ?? null,
    openedBy: 'ai',
    url: previous?.url,
  });
}

export function markBrowserWorldTabAiOperated(
  tabId: number | null | undefined,
  operation: string,
): void {
  if (typeof tabId !== 'number' || tabId < 0) return;
  const previous = tabsById.get(tabId);
  if (previous) {
    tabsById.set(tabId, {
      ...previous,
      aiOperationState: 'recently_operated',
      lastAiOperation: operation,
      lastAiOperationAtMs: nowMs(),
      updatedAtMs: nowMs(),
    });
  }
  pushEvent({
    eventKind: 'ai_tab_marked',
    tabId,
    windowId: previous?.windowId ?? null,
    openedBy: previous?.openedBy,
    url: previous?.url,
  });
}

export async function getBrowserWorldSnapshot(): Promise<BrowserWorldSnapshot> {
  if (!initialized) {
    await seedFromChrome().catch(() => undefined);
  }
  return buildSnapshot();
}

export async function refreshBrowserWorldSnapshot(): Promise<BrowserWorldSnapshot> {
  await seedFromChrome().catch(() => undefined);
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
  const recentChangeSummary = summarizeRecentEvents(recentEvents);
  return {
    source: 'extension_browser_world_inventory',
    version: 1,
    initialized,
    observedAtMs,
    snapshotAgeMs: lastObservedAtMs === null ? null : Math.max(0, observedAtMs - lastObservedAtMs),
    windowCount: windows.length,
    tabCount: tabs.length,
    focusedWindowId: focusedWindow?.windowId ?? null,
    browserActiveTabId: browserActiveTab,
    aiOpenedTabIds,
    userOrPageOpenedTabIds,
    operableTabIds,
    summary: {
      primaryConclusion: `Browser world snapshot: ${windows.length} window(s), ${tabs.length} tab(s), activeTab=${browserActiveTab ?? 'unknown'}, aiOpenedTabs=${aiOpenedTabIds.length}, operableTabs=${operableTabIds.length}.`,
      activeTab: {
        tabId: activeTab?.tabId ?? null,
        windowId: activeTab?.windowId ?? null,
        url: activeTab?.url ?? null,
        title: activeTab?.title ?? null,
        openedBy: activeTab?.openedBy ?? null,
        canTabrixOperate: activeTab?.canTabrixOperate ?? null,
      },
      counts: {
        windows: windows.length,
        tabs: tabs.length,
        aiOpenedTabs: aiOpenedTabIds.length,
        userOrPageOpenedTabs: userOrPageOpenedTabIds.length,
        operableTabs: operableTabIds.length,
      },
      recentChangeSummary,
    },
    recentEvents: [...recentEvents],
    windows,
    tabs,
  };
}

function summarizeRecentEvents(events: readonly BrowserWorldEvent[]): string {
  const last = events.at(-1);
  if (!last) return 'No browser lifecycle event observed yet.';
  switch (last.eventKind) {
    case 'tab_created':
      return `Last change: tab ${last.tabId ?? 'unknown'} was created in window ${last.windowId ?? 'unknown'}; openedBy=${last.openedBy ?? 'unknown'}.`;
    case 'tab_updated':
      return `Last change: tab ${last.tabId ?? 'unknown'} was updated.`;
    case 'tab_removed':
      return `Last change: tab ${last.tabId ?? 'unknown'} was removed; previousOpenedBy=${last.openedBy ?? 'unknown'}.`;
    case 'tab_activated':
      return `Last change: tab ${last.tabId ?? 'unknown'} became active in window ${last.windowId ?? 'unknown'}.`;
    case 'window_focus_changed':
      return `Last change: focused window is ${last.windowId ?? 'unknown'}.`;
    case 'window_created':
      return `Last change: window ${last.windowId ?? 'unknown'} was created.`;
    case 'window_removed':
      return `Last change: window ${last.windowId ?? 'unknown'} was removed.`;
    case 'tab_replaced':
      return `Last change: tab was replaced by tab ${last.tabId ?? 'unknown'}.`;
    case 'ai_tab_marked':
      return `Last change: tab ${last.tabId ?? 'unknown'} was marked as operated by Tabrix.`;
    case 'inventory_seeded':
      return 'Last change: browser world inventory was refreshed from Chrome.';
    default:
      return 'Last change: browser lifecycle event observed.';
  }
}

export function resetBrowserWorldInventoryForTests(): void {
  for (const detach of detachCallbacks) detach();
  detachCallbacks = [];
  tabsById.clear();
  windowsById.clear();
  pendingAiCreatedTabIds.clear();
  recentEvents.length = 0;
  initialized = false;
  lastObservedAtMs = null;
  attached = false;
}
