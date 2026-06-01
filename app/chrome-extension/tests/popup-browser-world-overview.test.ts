import { describe, expect, it } from 'vitest';
import { buildPopupBrowserWorldOverview } from '@/common/popup-browser-world-overview';

describe('popup BrowserWorld overview', () => {
  it('summarizes current windows, tabs, active page, and baseline readiness', () => {
    const overview = buildPopupBrowserWorldOverview({
      windowCount: 1,
      tabCount: 3,
      browserActiveTabId: 20,
      focusedWindowId: 1,
      snapshotAgeMs: 12,
      baselineReadiness: {
        ready: true,
        status: 'fresh',
        continuity: 'continuous',
      },
      tabs: [
        {
          tabId: 10,
          windowId: 1,
          title: 'Background page',
          url: 'https://background.example/path',
          active: false,
          openedBy: 'user_or_page',
          openedBySource: 'user_or_unknown',
          canTabrixOperate: false,
          cleanupEligibility: 'not_eligible',
        },
        {
          tabId: 20,
          windowId: 1,
          title: 'Active page',
          url: 'https://active.example/dashboard?token=secret#private',
          active: true,
          openedBy: 'user_or_page',
          openedBySource: 'user_or_unknown',
          canTabrixOperate: true,
          cleanupEligibility: 'unknown',
        },
        {
          tabId: 30,
          windowId: 1,
          title: 'AI page',
          url: 'https://ai.example/work',
          active: false,
          openedBy: 'ai',
          openedBySource: 'ai_tool',
          canTabrixOperate: true,
          cleanupEligibility: 'eligible',
        },
      ],
    });

    expect(overview.windowCount).toBe(1);
    expect(overview.tabCount).toBe(3);
    expect(overview.activeTabId).toBe(20);
    expect(overview.activeTabTitle).toBe('Active page');
    expect(overview.activeTabDisplayUrl).toBe('active.example/dashboard');
    expect(overview.activeTabDisplayUrl).not.toContain('secret');
    expect(overview.baselineStatus).toBe('fresh');
    expect(overview.visibleTabs.map((tab) => tab.tabId)).toEqual([20, 30, 10]);
    expect(overview.visibleTabs[0]).toMatchObject({
      tabId: 20,
      tone: 'active',
      safetyLabel: '可操作',
    });
    expect(overview.visibleTabs[1]).toMatchObject({
      tabId: 30,
      tone: 'ai',
      ownerLabel: 'AI',
      safetyLabel: '可清理',
    });
    expect(overview.visibleTabs[2]).toMatchObject({
      tabId: 10,
      tone: 'protected',
      safetyLabel: '受保护',
    });
  });

  it('keeps recent opened and closed page evidence readable for the popup', () => {
    const overview = buildPopupBrowserWorldOverview({
      summary: {
        recentActivityLedger: {
          latestPageOpened: {
            kind: 'page_opened',
            title: 'Opened page',
            url: 'https://opened.example/new?session=secret',
            pageDescription: 'Opened page on opened.example',
            occurredAtMs: 100,
            evidence: 'browser_world_event_with_live_tab',
            confidence: 'high',
          },
          latestPageClosed: {
            kind: 'page_closed',
            title: 'Closed page',
            url: 'https://closed.example/old?session=secret',
            pageDescription: 'Closed page on closed.example',
            occurredAtMs: 90,
            evidence: 'browser_world_closed_tab_snapshot',
            confidence: 'high',
          },
        },
      },
    });

    expect(overview.recentActivities).toEqual([
      expect.objectContaining({
        kind: 'opened',
        label: '刚打开',
        title: 'Opened page on opened.example',
        displayUrl: 'opened.example/new',
        evidence: 'browser_world_event_with_live_tab',
      }),
      expect.objectContaining({
        kind: 'closed',
        label: '刚关闭',
        title: 'Closed page on closed.example',
        displayUrl: 'closed.example/old',
        evidence: 'browser_world_closed_tab_snapshot',
      }),
    ]);
    expect(JSON.stringify(overview.recentActivities)).not.toContain('secret');
  });

  it('handles unknown baseline and missing tabs without pretending the state is proven', () => {
    const overview = buildPopupBrowserWorldOverview(null);

    expect(overview.windowCount).toBe(0);
    expect(overview.tabCount).toBe(0);
    expect(overview.activeTabId).toBeNull();
    expect(overview.activeTabTitle).toBe('未命名页面');
    expect(overview.baselineStatus).toBe('unknown');
    expect(overview.baselineContinuity).toBe('unknown');
    expect(overview.visibleTabs).toEqual([]);
    expect(overview.claimBoundary).toContain('does not prove page understanding');
  });
});
