import { describe, expect, it } from 'vitest';
import {
  browserWorldTabOpenedByToOwnerType,
  buildReadPageOwnershipRuntimeSummary,
} from '../entrypoints/background/tools/browser/read-page-ownership-runtime';
import type { BrowserWorldTabObject } from '../entrypoints/background/browser-world-inventory';

describe('read-page ownership runtime', () => {
  it('maps browser-world opener ownership into read-page owner types', () => {
    expect(browserWorldTabOpenedByToOwnerType('ai')).toBe('run_owned');
    expect(browserWorldTabOpenedByToOwnerType('user_or_page')).toBe('user_owned');
    expect(browserWorldTabOpenedByToOwnerType('unknown')).toBe('unknown');
    expect(browserWorldTabOpenedByToOwnerType(undefined)).toBe('unknown');
  });

  it('builds ownership runtime from browser-world tab facts without claiming task ownership', () => {
    const browserWorldTab: BrowserWorldTabObject = {
      tabId: 42,
      windowId: 7,
      url: 'https://neutral.example.test/search',
      title: 'Neutral Search',
      status: 'complete',
      active: true,
      highlighted: true,
      index: 0,
      pinned: false,
      audible: false,
      muted: false,
      discarded: false,
      autoDiscardable: true,
      openerTabId: 12,
      pendingUrl: null,
      lifecycleState: 'foreground',
      openedBy: 'user_or_page',
      openedBySource: null,
      openedByConfidence: 0.8,
      openedByReason: 'opener tab was observed',
      aiOperationState: 'recently_operated',
      lastAiOperation: 'chrome_click_element',
      lastAiOperationAtMs: 1234,
      lastAiOperationConfidence: undefined,
      lastAiOperationReason: undefined,
      aiRunId: 'run_background_check',
      aiClaimId: 'claim_42',
      aiClaimState: 'claimed',
      aiClaimedAtMs: 1222,
      aiFinalizedAtMs: null,
      aiClaimReason: 'background_session_claim',
      canTabrixOperate: true,
      operabilityReason: 'web_page',
      runtimeStateSource: 'browser_world_inventory',
      lastSeenAtMs: 5678,
      firstSeenAtMs: 1000,
      closedAtMs: null,
    };

    expect(
      buildReadPageOwnershipRuntimeSummary({
        tabId: 42,
        currentOwnerType: 'user_owned',
        currentUrl: 'https://fallback.example.test',
        currentTitle: 'Fallback',
        browserWorldTab,
        currentWindowId: 7,
        currentWindowState: 'normal',
        currentWindowWidth: 1280,
        currentWindowHeight: 720,
        currentWindowLeft: 0,
        currentWindowTop: 0,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        browserActiveTabId: 42,
        browserActiveTabIdKnown: true,
        isReadTargetBrowserActiveTab: true,
        browserWorldObjectChangeSummary: 'one tab changed',
        browserWorldActionableObjectChangeSummary: 'one action target changed',
        browserWorldCurrentOperationConclusion: 'foreground page usable',
        browserWorldRoutingDecisionSummary: 'continue',
      }),
    ).toMatchObject({
      currentTabId: 42,
      currentWindowId: 7,
      currentTabUrl: 'https://neutral.example.test/search',
      currentTabTitle: 'Neutral Search',
      currentTabOpenedBy: 'user_or_page',
      currentTabOpenedBySource: 'page_opener',
      currentTabLastAiOperation: 'chrome_click_element',
      currentTabLastAiOperationConfidence: 0.7,
      currentTabAiRunId: 'run_background_check',
      currentTabAiClaimId: 'claim_42',
      currentTabAiClaimState: 'claimed',
      currentTabAiClaimedAtMs: 1222,
      currentTabAiFinalizedAtMs: null,
      currentTabAiClaimReason: 'background_session_claim',
      currentTabRuntimeStateSource: 'browser_world_inventory',
      currentOwnerType: 'user_owned',
      isCurrentTabRunOwnedByTask: false,
      runOwnedTabCount: 0,
    });
  });
});
