import type {
  BrowserPageOwnerType,
  ReadPageOwnershipRuntimeSummary,
  ReadPageWindowRuntimeState,
} from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';

export function browserWorldTabOpenedByToOwnerType(
  openedBy: 'ai' | 'user_or_page' | 'unknown' | undefined,
): BrowserPageOwnerType {
  if (openedBy === 'ai') return 'run_owned';
  if (openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

function deriveBrowserWorldTabOpenedBySource(
  tab: BrowserWorldTabObject | null,
): ReadPageOwnershipRuntimeSummary['currentTabOpenedBySource'] {
  if (!tab) return null;
  if (tab.openedBySource) return tab.openedBySource;
  if (tab.openedBy === 'ai') return 'ai_tool';
  if (tab.openedBy === 'user_or_page' && Number.isInteger(tab.openerTabId)) return 'page_opener';
  if (tab.openedBy === 'user_or_page') return 'user_or_unknown';
  return 'unknown';
}

export function buildReadPageOwnershipRuntimeSummary(params: {
  tabId: number;
  currentOwnerType: BrowserPageOwnerType;
  currentUrl: string;
  currentTitle: string;
  browserWorldTab: BrowserWorldTabObject | null;
  currentWindowId: number | null;
  currentWindowState: ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  browserWorldObjectChangeSummary: string | null;
  browserWorldActionableObjectChangeSummary: string | null;
  browserWorldCurrentOperationConclusion: string | null;
  browserWorldRoutingDecisionSummary: string | null;
}): ReadPageOwnershipRuntimeSummary {
  const lastAiOperation = params.browserWorldTab?.lastAiOperation ?? null;
  const lastAiOperationConfidence =
    typeof params.browserWorldTab?.lastAiOperationConfidence === 'number'
      ? params.browserWorldTab.lastAiOperationConfidence
      : lastAiOperation
        ? 0.7
        : null;
  const lastAiOperationReason =
    params.browserWorldTab?.lastAiOperationReason ??
    (lastAiOperation
      ? `browser_world_inventory_operation_marker_without_reason:${lastAiOperation}`
      : null);

  return {
    currentTabId: params.tabId,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
    currentTabUrl: params.browserWorldTab?.url || params.currentUrl || null,
    currentTabPendingUrl: params.browserWorldTab?.pendingUrl ?? null,
    currentTabTitle: params.browserWorldTab?.title || params.currentTitle || null,
    currentTabStatus: params.browserWorldTab?.status ?? null,
    currentTabDiscarded: params.browserWorldTab?.discarded ?? null,
    currentTabAudible: params.browserWorldTab?.audible ?? null,
    currentTabMuted: params.browserWorldTab?.muted ?? null,
    currentTabPinned: params.browserWorldTab?.pinned ?? null,
    currentTabOpenerTabId: params.browserWorldTab?.openerTabId ?? null,
    currentTabOpenedBy: params.browserWorldTab?.openedBy ?? null,
    currentTabOpenedBySource: deriveBrowserWorldTabOpenedBySource(params.browserWorldTab),
    currentTabOpenedByConfidence: params.browserWorldTab?.openedByConfidence ?? null,
    currentTabOpenedByReason: params.browserWorldTab?.openedByReason ?? null,
    currentTabAiOperationState: params.browserWorldTab?.aiOperationState ?? null,
    currentTabLastAiOperation: lastAiOperation,
    currentTabLastAiOperationAtMs: params.browserWorldTab?.lastAiOperationAtMs ?? null,
    currentTabLastAiOperationConfidence: lastAiOperationConfidence,
    currentTabLastAiOperationReason: lastAiOperationReason,
    currentTabCanTabrixOperate: params.browserWorldTab?.canTabrixOperate ?? null,
    currentTabOperabilityReason: params.browserWorldTab?.operabilityReason ?? null,
    currentTabRuntimeStateSource: params.browserWorldTab
      ? 'browser_world_inventory'
      : 'chrome_tab_snapshot',
    browserWorldObjectChangeSummary: params.browserWorldObjectChangeSummary,
    browserWorldActionableObjectChangeSummary: params.browserWorldActionableObjectChangeSummary,
    browserWorldCurrentOperationConclusion: params.browserWorldCurrentOperationConclusion,
    browserWorldRoutingDecisionSummary: params.browserWorldRoutingDecisionSummary,
    currentOwnerType: params.currentOwnerType,
    currentTabRunOwnershipVerdict: 'unknown',
    currentTabPrimaryRelationVerdict: 'current_tab_unknown',
    protectedScopeVerdict: 'unknown',
    cleanupEligibility: 'unknown',
    protectReason: null,
    isCurrentTabRunOwnedByTask: false,
    runOwnedTabIds: [],
    runOwnedTabCount: 0,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: null,
    primaryTabId: null,
    primaryTabReuseRate: null,
    benchmarkOwnedTabCount: null,
    heartbeatTabCount: null,
    heartbeatWindowCount: null,
  };
}
