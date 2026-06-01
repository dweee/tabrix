export type PopupBrowserWorldTone = 'active' | 'ai' | 'protected' | 'neutral';

export interface PopupBrowserWorldSourceTab {
  tabId?: number | null;
  windowId?: number | null;
  url?: string | null;
  pendingUrl?: string | null;
  title?: string | null;
  active?: boolean | null;
  status?: string | null;
  openedBy?: string | null;
  openedBySource?: string | null;
  aiOperationState?: string | null;
  lastAiOperationAtMs?: number | null;
  canTabrixOperate?: boolean | null;
  cleanupEligibility?: string | null;
}

export interface PopupBrowserWorldSourceActivity {
  kind?: string | null;
  tabId?: number | null;
  windowId?: number | null;
  url?: string | null;
  title?: string | null;
  pageDescription?: string | null;
  occurredAtMs?: number | null;
  evidence?: string | null;
  confidence?: string | null;
  claimBoundary?: string | null;
}

export interface PopupBrowserWorldSourceSnapshot {
  windowCount?: number | null;
  tabCount?: number | null;
  browserActiveTabId?: number | null;
  focusedWindowId?: number | null;
  observedAtMs?: number | null;
  snapshotAgeMs?: number | null;
  baselineReadiness?: {
    ready?: boolean | null;
    status?: string | null;
    continuity?: string | null;
    reason?: string | null;
    claimBoundary?: string | null;
  } | null;
  summary?: {
    activeWindow?: {
      windowId?: number | null;
      visibilityState?: string | null;
      canTabrixOperate?: boolean | null;
    } | null;
    activeTab?: {
      tabId?: number | null;
      title?: string | null;
      url?: string | null;
      canTabrixOperate?: boolean | null;
    } | null;
    lastAiOperatedTabObject?: PopupBrowserWorldSourceTab | null;
    recentActivityLedger?: {
      latestPageOpened?: PopupBrowserWorldSourceActivity | null;
      latestPageClosed?: PopupBrowserWorldSourceActivity | null;
      latestPageActivated?: PopupBrowserWorldSourceActivity | null;
      latestPageUpdated?: PopupBrowserWorldSourceActivity | null;
      latestPageActivity?: PopupBrowserWorldSourceActivity | null;
      claimBoundary?: string | null;
    } | null;
  } | null;
  tabs?: PopupBrowserWorldSourceTab[] | null;
}

export interface PopupBrowserWorldTab {
  tabId: number;
  windowId: number | null;
  title: string;
  displayUrl: string;
  active: boolean;
  status: string;
  ownerLabel: string;
  safetyLabel: string;
  canTabrixOperate: boolean | null;
  cleanupEligibility: string;
  tone: PopupBrowserWorldTone;
}

export interface PopupBrowserWorldActivity {
  kind: 'opened' | 'closed' | 'activated' | 'updated' | 'unknown';
  label: string;
  title: string;
  displayUrl: string;
  occurredAtMs: number | null;
  evidence: string;
  confidence: string;
}

export interface PopupBrowserWorldOverview {
  windowCount: number;
  tabCount: number;
  activeWindowId: number | null;
  activeTabId: number | null;
  activeTabTitle: string;
  activeTabDisplayUrl: string;
  baselineStatus: string;
  baselineContinuity: string;
  baselineReady: boolean | null;
  snapshotAgeMs: number | null;
  latestAiOperatedTabId: number | null;
  latestAiOperatedTitle: string;
  visibleTabs: PopupBrowserWorldTab[];
  omittedTabCount: number;
  recentActivities: PopupBrowserWorldActivity[];
  summaryText: string;
  claimBoundary: string;
}

const DEFAULT_TAB_LIMIT = 12;
const MAX_TEXT_LENGTH = 72;

export function buildPopupBrowserWorldOverview(
  snapshot: PopupBrowserWorldSourceSnapshot | null | undefined,
  options: { tabLimit?: number } = {},
): PopupBrowserWorldOverview {
  const tabLimit = Math.max(1, options.tabLimit ?? DEFAULT_TAB_LIMIT);
  const tabs = Array.isArray(snapshot?.tabs) ? snapshot.tabs : [];
  const activeTabId = toNullableNumber(snapshot?.browserActiveTabId);
  const activeTab =
    tabs.find((tab) => toNullableNumber(tab.tabId) === activeTabId) ??
    (snapshot?.summary?.activeTab
      ? {
          tabId: snapshot.summary.activeTab.tabId,
          title: snapshot.summary.activeTab.title,
          url: snapshot.summary.activeTab.url,
          active: true,
          canTabrixOperate: snapshot.summary.activeTab.canTabrixOperate,
        }
      : null);
  const latestAiOperatedTab = snapshot?.summary?.lastAiOperatedTabObject ?? null;
  const normalizedTabs = tabs
    .map(normalizeTab)
    .filter((tab): tab is PopupBrowserWorldTab => Boolean(tab))
    .sort(sortTabsForPopup);
  const visibleTabs = normalizedTabs.slice(0, tabLimit);
  const recentLedger = snapshot?.summary?.recentActivityLedger ?? null;
  const recentActivities = [
    normalizeActivity(recentLedger?.latestPageOpened, 'opened'),
    normalizeActivity(recentLedger?.latestPageClosed, 'closed'),
    normalizeActivity(recentLedger?.latestPageActivated, 'activated'),
    normalizeActivity(recentLedger?.latestPageUpdated, 'updated'),
  ].filter((activity): activity is PopupBrowserWorldActivity => Boolean(activity));
  const activeTabTitle = normalizeTitle(activeTab?.title, activeTab?.url);
  const activeTabDisplayUrl = formatDisplayUrl(activeTab?.url ?? '');
  const windowCount = toCount(snapshot?.windowCount);
  const tabCount = toCount(snapshot?.tabCount, normalizedTabs.length);
  const baselineStatus = snapshot?.baselineReadiness?.status || 'unknown';
  const baselineContinuity = snapshot?.baselineReadiness?.continuity || 'unknown';
  const latestAiOperatedTabId = toNullableNumber(latestAiOperatedTab?.tabId);
  const latestAiOperatedTitle = latestAiOperatedTab
    ? normalizeTitle(latestAiOperatedTab.title, latestAiOperatedTab.url)
    : '暂无 AI 操作页';

  return {
    windowCount,
    tabCount,
    activeWindowId:
      toNullableNumber(snapshot?.summary?.activeWindow?.windowId) ??
      toNullableNumber(snapshot?.focusedWindowId),
    activeTabId,
    activeTabTitle,
    activeTabDisplayUrl,
    baselineStatus,
    baselineContinuity,
    baselineReady:
      typeof snapshot?.baselineReadiness?.ready === 'boolean'
        ? snapshot.baselineReadiness.ready
        : null,
    snapshotAgeMs: toNullableNumber(snapshot?.snapshotAgeMs),
    latestAiOperatedTabId,
    latestAiOperatedTitle,
    visibleTabs,
    omittedTabCount: Math.max(0, normalizedTabs.length - visibleTabs.length),
    recentActivities,
    summaryText: buildSummaryText({ windowCount, tabCount, activeTabTitle, baselineStatus }),
    claimBoundary:
      snapshot?.baselineReadiness?.claimBoundary ||
      recentLedger?.claimBoundary ||
      'This popup shows browser-window and tab inventory only. It does not prove page understanding, login state, or task success.',
  };
}

function normalizeTab(tab: PopupBrowserWorldSourceTab): PopupBrowserWorldTab | null {
  const tabId = toNullableNumber(tab.tabId);
  if (tabId === null) return null;
  const title = normalizeTitle(tab.title, tab.url || tab.pendingUrl);
  const canOperate = typeof tab.canTabrixOperate === 'boolean' ? tab.canTabrixOperate : null;
  const openedBy = tab.openedBy || 'unknown';
  const isAi =
    openedBy === 'ai' ||
    tab.aiOperationState === 'recently_operated' ||
    typeof tab.lastAiOperationAtMs === 'number';
  const active = tab.active === true;
  const tone: PopupBrowserWorldTone = active
    ? 'active'
    : isAi
      ? 'ai'
      : canOperate === false
        ? 'protected'
        : 'neutral';

  return {
    tabId,
    windowId: toNullableNumber(tab.windowId),
    title,
    displayUrl: formatDisplayUrl(tab.url || tab.pendingUrl || ''),
    active,
    status: tab.status || 'unknown',
    ownerLabel: getOwnerLabel(openedBy, tab.openedBySource),
    safetyLabel: getSafetyLabel(canOperate, tab.cleanupEligibility),
    canTabrixOperate: canOperate,
    cleanupEligibility: tab.cleanupEligibility || 'unknown',
    tone,
  };
}

function normalizeActivity(
  activity: PopupBrowserWorldSourceActivity | null | undefined,
  fallbackKind: PopupBrowserWorldActivity['kind'],
): PopupBrowserWorldActivity | null {
  if (!activity) return null;
  const label = getActivityLabel(activity.kind || fallbackKind);
  return {
    kind: getActivityKind(activity.kind || fallbackKind),
    label,
    title: activity.pageDescription || normalizeTitle(activity.title, activity.url),
    displayUrl: formatDisplayUrl(activity.url || ''),
    occurredAtMs: toNullableNumber(activity.occurredAtMs),
    evidence: activity.evidence || 'unknown',
    confidence: activity.confidence || 'unknown',
  };
}

function sortTabsForPopup(a: PopupBrowserWorldTab, b: PopupBrowserWorldTab): number {
  const score = (tab: PopupBrowserWorldTab) => {
    if (tab.active) return 0;
    if (tab.tone === 'ai') return 1;
    if (tab.canTabrixOperate === true) return 2;
    if (tab.canTabrixOperate === false) return 3;
    return 4;
  };
  const scoreDiff = score(a) - score(b);
  if (scoreDiff !== 0) return scoreDiff;
  return a.tabId - b.tabId;
}

function getOwnerLabel(openedBy: string, openedBySource?: string | null): string {
  if (openedBy === 'ai') return 'AI';
  if (openedBySource === 'page_opener') return '网页打开';
  if (openedBy === 'user_or_page') return '用户/网页';
  return '未知';
}

function getSafetyLabel(canOperate: boolean | null, cleanupEligibility?: string | null): string {
  if (canOperate === false) return '受保护';
  if (cleanupEligibility === 'eligible') return '可清理';
  if (canOperate === true) return '可操作';
  return '待确认';
}

function getActivityKind(kind: string): PopupBrowserWorldActivity['kind'] {
  if (kind === 'page_opened' || kind === 'opened') return 'opened';
  if (kind === 'page_closed' || kind === 'closed') return 'closed';
  if (kind === 'page_activated' || kind === 'activated') return 'activated';
  if (kind === 'page_updated' || kind === 'updated') return 'updated';
  return 'unknown';
}

function getActivityLabel(kind: string): string {
  switch (getActivityKind(kind)) {
    case 'opened':
      return '刚打开';
    case 'closed':
      return '刚关闭';
    case 'activated':
      return '刚切换';
    case 'updated':
      return '刚更新';
    default:
      return '最近变化';
  }
}

function buildSummaryText(input: {
  windowCount: number;
  tabCount: number;
  activeTabTitle: string;
  baselineStatus: string;
}): string {
  return `${input.windowCount} 个窗口 / ${input.tabCount} 个标签，当前页：${input.activeTabTitle}，状态：${input.baselineStatus}`;
}

function normalizeTitle(title?: string | null, url?: string | null): string {
  const trimmed = (title || '').trim();
  if (trimmed) return truncate(trimmed, MAX_TEXT_LENGTH);
  const displayUrl = formatDisplayUrl(url || '');
  return displayUrl || '未命名页面';
}

function formatDisplayUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return truncate(`${parsed.hostname}${path}`, MAX_TEXT_LENGTH);
  } catch {
    return truncate(trimmed.split('?')[0].split('#')[0], MAX_TEXT_LENGTH);
  }
}

function toCount(value: unknown, fallback = 0): number {
  const numberValue = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.trunc(numberValue));
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}
