import {
  refreshBrowserWorldSnapshot,
  type BrowserWorldBaselineReadinessStatus,
  type BrowserWorldSnapshot,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';

export type CloseTabsPreflightVerdict = 'allowed' | 'blocked';

export interface CloseTabsPreflightBlockedTab {
  tabId: number;
  reason: string;
  openedBy: BrowserWorldTabObject['openedBy'] | 'unknown';
  openedBySource: BrowserWorldTabObject['openedBySource'] | 'unknown';
  canTabrixOperate: boolean | null;
  cleanupEligibility: BrowserWorldTabObject['cleanupEligibility'] | 'unknown';
  cleanupEligibilityReason: string;
}

export interface CloseTabsPreflightEvidence {
  kind: 'close_tabs_preflight_v1';
  verdict: CloseTabsPreflightVerdict;
  baselineStatus: BrowserWorldBaselineReadinessStatus;
  baselineReady: boolean;
  baselineContinuity: BrowserWorldSnapshot['baselineReadiness']['continuity'];
  baselineReason: string;
  requestedTabIds: number[];
  allowedTabIds: number[];
  blockedTabs: CloseTabsPreflightBlockedTab[];
  policy: 'ai_owned_cleanup_only';
  reason: string;
}

export async function preflightCloseTabs(
  requestedTabIds: readonly number[],
): Promise<CloseTabsPreflightEvidence> {
  const uniqueTabIds = [...new Set(requestedTabIds.filter((tabId) => Number.isInteger(tabId)))];
  const snapshot = await refreshBrowserWorldSnapshot({ ensureBaselineReady: true });
  const baseline = snapshot.baselineReadiness;
  const tabsById = new Map(snapshot.tabs.map((tab) => [tab.tabId, tab]));
  const baselineUsable =
    baseline.ready === true && (baseline.status === 'fresh' || baseline.status === 'resynced');

  if (!baselineUsable) {
    return {
      kind: 'close_tabs_preflight_v1',
      verdict: 'blocked',
      baselineStatus: baseline.status,
      baselineReady: baseline.ready,
      baselineContinuity: baseline.continuity,
      baselineReason: baseline.reason,
      requestedTabIds: uniqueTabIds,
      allowedTabIds: [],
      blockedTabs: uniqueTabIds.map((tabId) =>
        buildBlockedTab(tabId, tabsById.get(tabId) ?? null, 'browser_world_baseline_not_ready'),
      ),
      policy: 'ai_owned_cleanup_only',
      reason:
        'BrowserWorld baseline is not fresh enough to prove tab ownership and cleanup eligibility before close.',
    };
  }

  const allowedTabIds: number[] = [];
  const blockedTabs: CloseTabsPreflightBlockedTab[] = [];
  for (const tabId of uniqueTabIds) {
    const tab = tabsById.get(tabId) ?? null;
    const failureReason = getCloseTabBlockReason(tab);
    if (failureReason) {
      blockedTabs.push(buildBlockedTab(tabId, tab, failureReason));
    } else {
      allowedTabIds.push(tabId);
    }
  }

  const verdict: CloseTabsPreflightVerdict = blockedTabs.length === 0 ? 'allowed' : 'blocked';
  return {
    kind: 'close_tabs_preflight_v1',
    verdict,
    baselineStatus: baseline.status,
    baselineReady: baseline.ready,
    baselineContinuity: baseline.continuity,
    baselineReason: baseline.reason,
    requestedTabIds: uniqueTabIds,
    allowedTabIds: verdict === 'allowed' ? allowedTabIds : [],
    blockedTabs,
    policy: 'ai_owned_cleanup_only',
    reason:
      verdict === 'allowed'
        ? 'All requested tabs are AI-opened, operable, and cleanup-eligible according to fresh BrowserWorld state.'
        : 'At least one requested tab is not proven safe to close; no tabs were closed.',
  };
}

function getCloseTabBlockReason(tab: BrowserWorldTabObject | null): string | null {
  if (!tab) return 'tab_not_observed_in_browser_world';
  if (tab.openedBy !== 'ai') return 'tab_not_ai_owned';
  if (tab.canTabrixOperate !== true) return 'tab_not_operable_or_unknown';
  if (tab.cleanupEligibility !== 'eligible') return 'cleanup_eligibility_not_proven';
  return null;
}

function buildBlockedTab(
  tabId: number,
  tab: BrowserWorldTabObject | null,
  reason: string,
): CloseTabsPreflightBlockedTab {
  return {
    tabId,
    reason,
    openedBy: tab?.openedBy ?? 'unknown',
    openedBySource: tab?.openedBySource ?? 'unknown',
    canTabrixOperate: tab?.canTabrixOperate ?? null,
    cleanupEligibility: tab?.cleanupEligibility ?? 'unknown',
    cleanupEligibilityReason: tab?.cleanupEligibilityReason ?? 'tab_not_observed',
  };
}
