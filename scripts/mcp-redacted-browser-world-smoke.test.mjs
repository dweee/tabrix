import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHttpUrl,
  assertRedactedSmokeOutputSafe,
  buildPublicSmokeUrl,
  buildPostCloseTargetCleanupSummary,
  buildRedactedBrowserWorldSummary,
  buildRedactedReadPageAlignmentSummary,
  buildStepSummary,
  buildReadPageMatrixTargetResult,
  buildWindowStateDriftSummary,
  buildWindowStateMutationProof,
  extractJsonObject,
  extractNavigateTabId,
  isLifecycleStepPassing,
  isSmokeResultPassing,
  parseArgs,
  resolveSmokeUrls,
  stringifyRedactedSmokeOutput,
} from './mcp-redacted-browser-world-smoke.mjs';

test('extractJsonObject parses the bounded CLI Result payload', () => {
  const parsed = extractJsonObject('tabrix mcp call get_windows_and_tabs\n\nResult\n{"ok":true}\n');
  assert.deepEqual(parsed, { ok: true });
});

test('assertRedactedSmokeOutputSafe rejects raw URL strings and raw fields', () => {
  assert.doesNotThrow(() =>
    assertRedactedSmokeOutputSafe({
      ok: true,
      target: { targetIndex: 1, regionTypes: ['navigation'], operationPurposes: ['navigate'] },
      privacyBoundary: 'No raw browser data is printed.',
    }),
  );
  assert.throws(() => assertRedactedSmokeOutputSafe({ target: { url: 'redacted' } }));
  assert.throws(() =>
    assertRedactedSmokeOutputSafe({ target: { label: 'https://private.example.test/dashboard' } }),
  );
  assert.throws(() => assertRedactedSmokeOutputSafe({ target: { pageText: 'private text' } }));
});

test('stringifyRedactedSmokeOutput enforces a byte limit after privacy checks', () => {
  assert.equal(
    stringifyRedactedSmokeOutput({ ok: true, targets: [{ targetIndex: 1 }] }, 200).includes(
      '"ok": true',
    ),
    true,
  );
  assert.throws(() => stringifyRedactedSmokeOutput({ ok: true, summary: 'x'.repeat(100) }, 40));
  assert.throws(() =>
    stringifyRedactedSmokeOutput({ ok: true, summary: 'https://private.example.test' }, 500),
  );
});

test('assertPublicHttpUrl rejects local targets', () => {
  assert.throws(() => assertPublicHttpUrl('chrome://extensions'));
  assert.throws(() => assertPublicHttpUrl('http://127.0.0.1:3000/'));
  assert.throws(() => assertPublicHttpUrl('http://192.168.1.50:12306/'));
  assert.throws(() => assertPublicHttpUrl('http://intranet/'));
  assert.equal(assertPublicHttpUrl('https://example.com/path'), 'https://example.com/path');
});

test('extractNavigateTabId finds nested tab id without exposing URL fields', () => {
  assert.equal(extractNavigateTabId({ data: { tabId: 123, url: 'https://example.com' } }), 123);
  assert.equal(extractNavigateTabId({ data: { nested: [{ tabId: 456 }] } }), 456);
});

test('buildRedactedBrowserWorldSummary omits URL and title fields', () => {
  const summary = buildRedactedBrowserWorldSummary(
    {
      source: 'chrome_windows_get_all_with_browser_world_inventory',
      windowCount: 1,
      tabCount: 20,
      compactSummary: {
        activeObject: {
          tabId: 20,
          windowId: 1,
          url: 'https://private.example.test/dashboard',
          title: 'Private Dashboard',
          tabStatus: 'complete',
          openedBy: 'ai',
          canTabrixOperate: true,
          tabOperabilityReason: 'regular_web_page',
          windowOperabilityReason: 'active_tab_operable_in_visible_window',
        },
        windows: [
          {
            compactTabLimit: 12,
            omittedTabCount: 8,
            tabs: [{ tabId: 20, url: 'https://private.example.test/dashboard' }],
          },
        ],
        retentionPolicy: {
          recentEventLimit: 50,
          recentEventsRetained: 12,
          windowObjectsRetained: 1,
          tabObjectsRetained: 20,
          refreshMode: 'event_driven_with_on_demand_chrome_resync',
          minFullChromeResyncIntervalMs: 250,
          eventPrivacyBoundary:
            'Recent browser lifecycle events retain ids only and do not retain https://private.example.test/dashboard.',
          detailBoundary: 'Detailed objects may include Private Dashboard titles.',
        },
        refreshHealth: {
          fullChromeResyncCount: 3,
          skippedChromeResyncCount: 1,
          minFullChromeResyncIntervalMs: 250,
          lastFullChromeResyncAtMs: 123456789,
          lastFullChromeResyncDurationMs: 7,
          lastFullChromeResyncStatus: 'success',
          lastFullChromeResyncReason: 'on_demand_refresh',
          lastRefreshDecision: 'full_chrome_resync',
          lastRefreshDecisionReason: 'Completed private refresh for fixture.',
        },
        windowStateMatrix: {
          total: 1,
          visible: 1,
          minimized: 0,
          unknownVisibility: 0,
          focused: 1,
          unfocused: 0,
          focusUnknown: 0,
          operable: 1,
          inoperable: 0,
          operabilityUnknown: 0,
          stateCounts: { normal: 1 },
        },
        windowStateConclusion: 'Window object matrix includes private current window title.',
        windowOperationState: {
          focusedWindowId: 1,
          focusedWindowState: 'normal',
          focusedWindowVisibilityState: 'visible',
          focusedWindowCanOperate: true,
          focusedWindowActiveTabId: 20,
          focusedWindowActiveTabCanOperate: true,
          relationToCurrentOperableWindow: 'focused_window_visible_operable',
          canOperateFocusedWindow: true,
          visibleWindowCount: 1,
          minimizedWindowCount: 0,
          operableWindowCount: 1,
          inoperableWindowCount: 0,
        },
        currentWindowConclusion:
          'Current window object includes https://private.example.test/dashboard and Private Dashboard.',
        objectInventory: {
          objectModel: 'BrowserWorldObject -> BrowserWindowObject[] -> BrowserTabObject[]',
          compactIdLimit: 12,
          windowObjectCount: 1,
          tabPageObjectCount: 20,
          activeWindowId: 1,
          browserActiveTabId: 20,
          latestAiOperatedTabId: 20,
          latestAiOperationConfidence: 0.95,
          latestAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          currentOperationRelation: 'same_as_browser_active',
          canContinueOnLatestAiOperatedTab: true,
          aiOpened: { ids: [20], omittedCount: 0 },
          userOrPageOpened: { ids: [1, 2, 3], omittedCount: 16 },
          unknownOpened: { ids: [], omittedCount: 0 },
          operable: { ids: [20], omittedCount: 19 },
          inoperable: { ids: [], omittedCount: 0 },
          recentlyOperatedByAi: { ids: [20], omittedCount: 0 },
          summary:
            'Browser object inventory includes https://private.example.test/dashboard and Private Dashboard.',
          claimBoundary: 'Object inventory summary only.',
        },
        browserActiveObject: {
          role: 'browser_active_tab',
          tabId: 20,
          windowId: 1,
          url: 'https://private.example.test/dashboard',
          title: 'Private Dashboard',
          active: true,
          status: 'complete',
          openedBy: 'ai',
          openedByConfidence: 0.95,
          aiOperationState: 'recently_operated',
          lastAiOperation: 'read_page',
          lastAiOperationConfidence: 0.95,
          lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          canTabrixOperate: true,
          operabilityReason: 'regular_web_page',
        },
        latestAiOperatedObject: {
          role: 'latest_ai_operated_tab',
          tabId: 20,
          windowId: 1,
          url: 'https://private.example.test/dashboard',
          title: 'Private Dashboard',
          active: true,
          status: 'complete',
          openedBy: 'ai',
          openedByConfidence: 0.95,
          aiOperationState: 'recently_operated',
          lastAiOperation: 'read_page',
          lastAiOperationConfidence: 0.95,
          lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          canTabrixOperate: true,
          operabilityReason: 'regular_web_page',
        },
        currentTabAttributeGroups: {
          identity: {
            objectKind: 'BrowserTabObject',
            tabId: 20,
            windowId: 1,
            url: 'https://private.example.test/dashboard',
            title: 'Private Dashboard',
          },
          runtime: {
            active: true,
            status: 'complete',
            pendingUrl: 'https://private.example.test/pending',
            discarded: false,
            audible: false,
            muted: false,
            pinned: false,
            openerTabId: null,
          },
          ownership: {
            openedBy: 'ai',
            confidence: 0.95,
            reason: 'marked_by_tabrix_tool_execution:read_page',
            aiOperationState: 'recently_operated',
            lastAiOperation: 'read_page',
            lastAiOperationAtMs: 123456789,
            lastAiOperationConfidence: 0.95,
            lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          },
          operability: {
            canTabrixOperate: true,
            reason: 'regular_web_page',
          },
        },
        lastAiOperatedTabAttributeGroups: {
          identity: {
            objectKind: 'BrowserTabObject',
            tabId: 20,
            windowId: 1,
            url: 'https://private.example.test/dashboard',
            title: 'Private Dashboard',
          },
          runtime: {
            active: true,
            status: 'complete',
            pendingUrl: '',
            discarded: false,
            audible: false,
            muted: false,
            pinned: false,
            openerTabId: null,
          },
          ownership: {
            openedBy: 'ai',
            confidence: 0.95,
            reason: 'marked_by_tabrix_tool_execution:read_page',
            aiOperationState: 'recently_operated',
            lastAiOperation: 'read_page',
            lastAiOperationAtMs: 123456789,
            lastAiOperationConfidence: 0.95,
            lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          },
          operability: {
            canTabrixOperate: true,
            reason: 'regular_web_page',
          },
        },
        tabAttributeGroupClaimBoundary: 'Attribute group boundary with Private Dashboard.',
        operationRouting: {
          browserActiveTabId: 20,
          latestAiOperatedTabId: 20,
          relationToBrowserActiveTab: 'same_as_browser_active',
          canContinueOnLatestAiOperatedTab: true,
          latestAiOperation: 'read_page',
          latestAiOperationConfidence: 0.95,
          latestAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
          summary:
            'Current operation object includes https://private.example.test/dashboard and Private Dashboard.',
          claimBoundary: 'Operation routing summary only.',
        },
        aiRoutingBrief: {
          summary:
            'AI routing brief includes https://private.example.test/dashboard and Private Dashboard.',
          recommendedNextCheck:
            'Continue only after the next page-level read/postcondition check still passes.',
          canContinueOnLatestAiOperatedTab: true,
          claimBoundary: 'Browser routing brief summary only.',
        },
        operationTargetBrief: {
          targetTabId: 20,
          targetWindowId: 1,
          targetRole: 'latest_ai_operated_active_tab',
          targetBasis: 'latest_ai_operated_tab_matches_browser_active_tab',
          targetCanTabrixOperate: true,
          targetOperabilityReason: 'regular_web_page',
          browserActiveTabId: 20,
          latestAiOperatedTabId: 20,
          relationToBrowserActiveTab: 'same_as_browser_active',
          shouldReselectBeforeAction: false,
          nextRequiredCheck: 'page_level_read_or_postcondition_check',
          summary:
            'Operation target brief includes https://private.example.test/dashboard and Private Dashboard.',
          claimBoundary: 'Operation target brief boundary.',
        },
        tabStateMatrix: {
          total: 20,
          active: 1,
          background: 19,
          activityUnknown: 0,
          loading: 2,
          complete: 18,
          discarded: 1,
          muted: 1,
          pinned: 3,
          aiOpened: 1,
          userOrPageOpened: 19,
          recentlyOperatedByAi: 1,
          operable: 20,
          inoperable: 0,
          operabilityUnknown: 0,
          statusCounts: { complete: 18, loading: 2 },
          ownerCounts: { ai: 1, user_or_page: 19, unknown: 0 },
        },
        tabStateConclusion: 'Tab page object matrix includes Private Dashboard title.',
        tabLifecycleState: {
          latestEventKind: 'tab_updated',
          latestEventTabId: 20,
          latestEventWindowId: 1,
          latestEventStatus: 'complete',
          latestReplacedTabId: null,
          recentCreatedCount: 1,
          recentUpdatedCount: 2,
          recentActivatedCount: 1,
          recentReplacedCount: 0,
          recentRemovedCount: 0,
          retainedTabCount: 20,
          activeTabId: 20,
          aiOpenedRetainedCount: 1,
          userOrPageOpenedRetainedCount: 19,
        },
        tabLifecycleConclusion:
          'Tab lifecycle includes https://private.example.test/dashboard and Private Dashboard.',
        aiOperationState: {
          browserActiveTabId: 20,
          latestAiOperatedTabId: 20,
          latestAiOperation: 'read_page',
          latestAiOperationAtMs: 123456789,
          latestAiOperatedTabActive: true,
          latestAiOperatedTabWindowId: 1,
          latestAiOperatedTabOpenedBy: 'ai',
          latestAiOperatedTabCanOperate: true,
          relationToBrowserActiveTab: 'same_as_browser_active',
          canContinueOnLatestAiOperatedTab: true,
          aiOpenedTabCount: 1,
          recentlyOperatedTabCount: 1,
          closedRetainedTabCount: 0,
        },
        currentOperationConclusion:
          'Current operation object includes https://private.example.test/dashboard and Private Dashboard.',
        browserObjectEdgeSummary:
          'Browser object edge state: windows total=1, visible=1, minimized=0, focused=1, operable=1; tabs total=20, active=1, background=19, loading=2, operable=20, aiOpened=1, userOrPageOpened=19; currentWindow=focused_window_visible_operable; currentOperation=same_as_browser_active',
        objectChangeSummary:
          'Object change summary includes https://private.example.test/dashboard and Private Dashboard.',
        dynamicObjectUpdateSummary:
          'Dynamic object update includes https://private.example.test/dashboard and Private Dashboard.',
        claimBoundary: 'Browser lifecycle summary only.',
      },
      summary: {
        counts: {
          aiOpenedTabs: 1,
          userOrPageOpenedTabs: 19,
          operableTabs: 20,
        },
      },
      browserWorld: {
        windows: [
          {
            visibilityState: 'visible',
            focused: true,
            canTabrixOperate: true,
          },
        ],
        tabs: [
          {
            tabId: 20,
            url: 'https://private.example.test/dashboard',
            title: 'Private Dashboard',
            active: true,
            openedBy: 'ai',
            canTabrixOperate: true,
            status: 'complete',
          },
        ],
      },
    },
    20,
  );

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('private.example.test'), false);
  assert.equal(serialized.includes('Private Dashboard'), false);
  assert.deepEqual(summary.targetTab, {
    wasFound: true,
    active: true,
    openedBy: 'ai',
    canTabrixOperate: true,
    status: 'complete',
  });
  assert.deepEqual(summary.retentionPolicy, {
    recentEventLimit: 50,
    recentEventsRetained: 12,
    windowObjectsRetained: 1,
    tabObjectsRetained: 20,
    refreshMode: 'event_driven_with_on_demand_chrome_resync',
    minFullChromeResyncIntervalMs: 250,
    eventPrivacyBoundaryPresent: true,
    detailBoundaryPresent: true,
  });
  assert.deepEqual(summary.refreshHealth, {
    fullChromeResyncCount: 3,
    skippedChromeResyncCount: 1,
    minFullChromeResyncIntervalMs: 250,
    lastFullChromeResyncDurationMs: 7,
    lastFullChromeResyncStatus: 'success',
    lastFullChromeResyncReason: 'on_demand_refresh',
    lastRefreshDecision: 'full_chrome_resync',
    lastRefreshDecisionReasonPresent: true,
  });
  assert.equal(summary.retentionWithinLimit, true);
  assert.equal(summary.compactSummaryBounded, true);
  assert.deepEqual(summary.windowStateMatrix, {
    total: 1,
    visible: 1,
    minimized: 0,
    unknownVisibility: 0,
    focused: 1,
    unfocused: 0,
    focusUnknown: 0,
    operable: 1,
    inoperable: 0,
    operabilityUnknown: 0,
  });
  assert.equal(summary.windowStateConclusionPresent, true);
  assert.deepEqual(summary.windowOperationState, {
    focusedWindowIdPresent: true,
    focusedWindowState: 'normal',
    focusedWindowVisibilityState: 'visible',
    focusedWindowCanOperate: true,
    focusedWindowActiveTabIdPresent: true,
    focusedWindowActiveTabCanOperate: true,
    relationToCurrentOperableWindow: 'focused_window_visible_operable',
    canOperateFocusedWindow: true,
    visibleWindowCount: 1,
    minimizedWindowCount: 0,
    operableWindowCount: 1,
    inoperableWindowCount: 0,
  });
  assert.equal(summary.currentWindowConclusionPresent, true);
  assert.deepEqual(summary.objectInventory, {
    objectModelPresent: true,
    compactIdLimit: 12,
    windowObjectCount: 1,
    tabPageObjectCount: 20,
    activeWindowIdPresent: true,
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    latestAiOperationConfidence: 0.95,
    latestAiOperationReasonPresent: true,
    currentOperationRelation: 'same_as_browser_active',
    canContinueOnLatestAiOperatedTab: true,
    aiOpenedShown: 1,
    userOrPageOpenedShown: 3,
    unknownOpenedShown: 0,
    operableShown: 1,
    inoperableShown: 0,
    recentlyOperatedByAiShown: 1,
    summaryPresent: true,
    claimBoundaryPresent: true,
  });
  assert.deepEqual(summary.browserActiveObject, {
    objectPresent: true,
    role: 'browser_active_tab',
    tabIdPresent: true,
    windowIdPresent: true,
    active: true,
    status: 'complete',
    openedBy: 'ai',
    openedByConfidence: 0.95,
    aiOperationState: 'recently_operated',
    lastAiOperation: 'read_page',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    canTabrixOperate: true,
    operabilityReason: 'regular_web_page',
  });
  assert.deepEqual(summary.activeObject, {
    tabIdPresent: true,
    windowIdPresent: true,
    tabStatus: 'complete',
    openedBy: 'ai',
    canTabrixOperate: true,
    tabOperabilityReason: 'regular_web_page',
    windowOperabilityReason: 'active_tab_operable_in_visible_window',
  });
  assert.deepEqual(summary.latestAiOperatedObject, {
    objectPresent: true,
    role: 'latest_ai_operated_tab',
    tabIdPresent: true,
    windowIdPresent: true,
    active: true,
    status: 'complete',
    openedBy: 'ai',
    openedByConfidence: 0.95,
    aiOperationState: 'recently_operated',
    lastAiOperation: 'read_page',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    canTabrixOperate: true,
    operabilityReason: 'regular_web_page',
  });
  assert.deepEqual(summary.currentTabAttributeGroups, {
    identity: {
      objectKind: 'BrowserTabObject',
      tabIdPresent: true,
      windowIdPresent: true,
      urlPresent: true,
      titlePresent: true,
    },
    runtime: {
      active: true,
      status: 'complete',
      pendingUrlPresent: true,
      discarded: false,
      audible: false,
      muted: false,
      pinned: false,
      openerTabIdPresent: false,
    },
    ownership: {
      openedBy: 'ai',
      confidence: 0.95,
      reasonPresent: true,
      aiOperationState: 'recently_operated',
      lastAiOperation: 'read_page',
      lastAiOperationAtMsPresent: true,
      lastAiOperationConfidence: 0.95,
      lastAiOperationReasonPresent: true,
    },
    operability: {
      canTabrixOperate: true,
      reason: 'regular_web_page',
    },
  });
  assert.deepEqual(summary.lastAiOperatedTabAttributeGroups, {
    identity: {
      objectKind: 'BrowserTabObject',
      tabIdPresent: true,
      windowIdPresent: true,
      urlPresent: true,
      titlePresent: true,
    },
    runtime: {
      active: true,
      status: 'complete',
      pendingUrlPresent: false,
      discarded: false,
      audible: false,
      muted: false,
      pinned: false,
      openerTabIdPresent: false,
    },
    ownership: {
      openedBy: 'ai',
      confidence: 0.95,
      reasonPresent: true,
      aiOperationState: 'recently_operated',
      lastAiOperation: 'read_page',
      lastAiOperationAtMsPresent: true,
      lastAiOperationConfidence: 0.95,
      lastAiOperationReasonPresent: true,
    },
    operability: {
      canTabrixOperate: true,
      reason: 'regular_web_page',
    },
  });
  assert.equal(summary.tabAttributeGroupClaimBoundaryPresent, true);
  assert.deepEqual(summary.operationRouting, {
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    relationToBrowserActiveTab: 'same_as_browser_active',
    canContinueOnLatestAiOperatedTab: true,
    latestAiOperation: 'read_page',
    latestAiOperationConfidence: 0.95,
    latestAiOperationReasonPresent: true,
    summaryPresent: true,
    claimBoundaryPresent: true,
  });
  assert.deepEqual(summary.aiRoutingBrief, {
    summaryPresent: true,
    recommendedNextCheckPresent: true,
    canContinueOnLatestAiOperatedTab: true,
    claimBoundaryPresent: true,
  });
  assert.deepEqual(summary.operationTargetBrief, {
    targetTabIdPresent: true,
    targetWindowIdPresent: true,
    targetRole: 'latest_ai_operated_active_tab',
    targetBasis: 'latest_ai_operated_tab_matches_browser_active_tab',
    targetCanTabrixOperate: true,
    targetOperabilityReason: 'regular_web_page',
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    relationToBrowserActiveTab: 'same_as_browser_active',
    shouldReselectBeforeAction: false,
    nextRequiredCheck: 'page_level_read_or_postcondition_check',
    summaryPresent: true,
    claimBoundaryPresent: true,
  });
  assert.deepEqual(summary.tabStateMatrix, {
    total: 20,
    active: 1,
    background: 19,
    activityUnknown: 0,
    loading: 2,
    complete: 18,
    discarded: 1,
    muted: 1,
    pinned: 3,
    aiOpened: 1,
    userOrPageOpened: 19,
    recentlyOperatedByAi: 1,
    operable: 20,
    inoperable: 0,
    operabilityUnknown: 0,
  });
  assert.equal(summary.tabStateConclusionPresent, true);
  assert.deepEqual(summary.tabLifecycleState, {
    latestEventKind: 'tab_updated',
    latestEventTabIdPresent: true,
    latestEventWindowIdPresent: true,
    latestEventStatus: 'complete',
    latestReplacedTabIdPresent: false,
    recentCreatedCount: 1,
    recentUpdatedCount: 2,
    recentActivatedCount: 1,
    recentReplacedCount: 0,
    recentRemovedCount: 0,
    retainedTabCount: 20,
    activeTabIdPresent: true,
    aiOpenedRetainedCount: 1,
    userOrPageOpenedRetainedCount: 19,
  });
  assert.equal(summary.tabLifecycleConclusionPresent, true);
  assert.deepEqual(summary.aiOperationState, {
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    latestAiOperation: 'read_page',
    latestAiOperationAtMsPresent: true,
    latestAiOperatedTabActive: true,
    latestAiOperatedTabOpenedBy: 'ai',
    latestAiOperatedTabCanOperate: true,
    relationToBrowserActiveTab: 'same_as_browser_active',
    canContinueOnLatestAiOperatedTab: true,
    aiOpenedTabCount: 1,
    recentlyOperatedTabCount: 1,
    closedRetainedTabCount: 0,
  });
  assert.equal(summary.currentOperationConclusionPresent, true);
  assert.equal(summary.objectInventoryPresent, true);
  assert.equal(summary.browserObjectEdgeSummaryPresent, true);
  assert.equal(summary.objectChangeSummaryPresent, true);
  assert.equal(summary.dynamicObjectUpdateSummaryPresent, true);
  assert.deepEqual(summary.windows, {
    total: 1,
    visible: 1,
    minimized: 0,
    unknown: 0,
    focused: 1,
    operable: 1,
  });
});

test('buildRedactedBrowserWorldSummary checks active tab across all compact windows', () => {
  const summary = buildRedactedBrowserWorldSummary({
    windowCount: 2,
    tabCount: 3,
    compactSummary: {
      activeObject: { tabId: 3, url: 'https://private.example.test/active' },
      windows: [
        {
          compactTabLimit: 12,
          omittedTabCount: 4,
          tabs: [{ tabId: 1 }],
        },
        {
          compactTabLimit: 12,
          omittedTabCount: 0,
          tabs: [{ tabId: 3, url: 'https://private.example.test/active' }],
        },
      ],
    },
    browserWorld: { tabs: [] },
  });

  assert.equal(summary.activeTabIncludedInCompactTabs, true);
  assert.equal(summary.omittedTabCount, 4);
  assert.equal(summary.compactSummaryBounded, true);
  assert.equal(summary.retentionWithinLimit, null);
  assert.equal(JSON.stringify(summary).includes('private.example.test'), false);
});

test('buildRedactedBrowserWorldSummary counts window visibility states without URL fields', () => {
  const summary = buildRedactedBrowserWorldSummary({
    browserWorld: {
      windows: [
        { visibilityState: 'visible', focused: true, canTabrixOperate: true },
        { visibilityState: 'minimized', focused: false, canTabrixOperate: false },
        { visibilityState: 'unknown', focused: false, canTabrixOperate: null },
      ],
      tabs: [],
    },
  });

  assert.deepEqual(summary.windows, {
    total: 3,
    visible: 1,
    minimized: 1,
    unknown: 1,
    focused: 1,
    operable: 1,
  });
});

test('buildWindowStateMutationProof marks minimize restore as not proven without mutation tool', () => {
  assert.deepEqual(
    buildWindowStateMutationProof({
      windows: { total: 1 },
      windowStateMatrix: { total: 1 },
      windowOperationState: { focusedWindowState: 'normal' },
    }),
    {
      requestedCapability: 'window_minimize_restore',
      observationOnly: true,
      windowStateObserved: true,
      mutationToolAvailable: false,
      mutationAttempted: false,
      verdict: 'NOT_PROVEN_NO_SAFE_MCP_WINDOW_MUTATION_TOOL',
      claimBoundary:
        'This public smoke can observe BrowserWindowObject state, but it does not prove minimize/restore transitions because the current public MCP tool list has no safe window-state mutation tool.',
    },
  );
});

test('buildWindowStateDriftSummary reports stable repeated observer samples', () => {
  const samples = [
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        refreshHealth: {
          lastRefreshDecision: 'skipped_recent_resync',
        },
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
  ];

  assert.deepEqual(buildWindowStateDriftSummary(samples), {
    sampleCount: 2,
    allSamplesObserved: true,
    allSamplesCompactBounded: true,
    allSamplesRetentionBounded: true,
    allSamplesRefreshHealthPresent: true,
    windowCountStable: true,
    tabCountStable: true,
    focusedWindowCountStable: true,
    focusedWindowStateStable: true,
    driftObserved: false,
    claimBoundary:
      'Observer-only repeated Browser World sampling. Drift can be caused by real browser, user, or page activity and is not by itself a product failure.',
  });
});

test('buildWindowStateDriftSummary reports drift without failing observation', () => {
  const summary = buildWindowStateDriftSummary([
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 5,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        refreshHealth: {
          lastRefreshDecision: 'skipped_recent_resync',
        },
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
  ]);

  assert.equal(summary.allSamplesObserved, true);
  assert.equal(summary.allSamplesCompactBounded, true);
  assert.equal(summary.allSamplesRetentionBounded, true);
  assert.equal(summary.allSamplesRefreshHealthPresent, true);
  assert.equal(summary.windowCountStable, true);
  assert.equal(summary.tabCountStable, false);
  assert.equal(summary.driftObserved, true);
});

test('buildWindowStateDriftSummary requires refresh health for every sample', () => {
  const summary = buildWindowStateDriftSummary([
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
      },
    },
  ]);

  assert.equal(summary.allSamplesObserved, true);
  assert.equal(summary.allSamplesRefreshHealthPresent, false);
});

test('buildPostCloseTargetCleanupSummary reports closed targets without raw tab data', () => {
  const summary = buildPostCloseTargetCleanupSummary(
    {
      compactSummary: {
        windows: [{ compactTabLimit: 12, tabs: [{ tabId: 7 }] }],
        retentionPolicy: { recentEventLimit: 50, recentEventsRetained: 4 },
      },
      browserWorld: {
        tabs: [{ tabId: 7, url: 'https://private.example.test/open', title: 'Private Still Open' }],
      },
    },
    [7, 8],
  );

  assert.deepEqual(summary, [
    {
      targetIndex: 1,
      targetTabFound: true,
      compactSummaryBounded: true,
      retentionWithinLimit: true,
    },
    {
      targetIndex: 2,
      targetTabFound: false,
      compactSummaryBounded: true,
      retentionWithinLimit: true,
    },
  ]);
  assert.equal(JSON.stringify(summary).includes('private.example.test'), false);
  assert.equal(JSON.stringify(summary).includes('Private Still Open'), false);
});

test('buildStepSummary includes active object operability reasons without raw URL fields', () => {
  const summary = buildStepSummary(
    'foreground_open',
    {
      windowCount: 1,
      tabCount: 1,
      compactSummary: {
        activeObject: {
          tabId: 7,
          windowId: 1,
          url: 'https://private.example.test/active',
          title: 'Private Active',
          tabStatus: 'complete',
          openedBy: 'ai',
          canTabrixOperate: true,
          tabOperabilityReason: 'regular_web_page',
          windowOperabilityReason: 'active_tab_operable_in_visible_window',
        },
        browserActiveObject: {
          role: 'browser_active_tab',
          tabId: 7,
          windowId: 1,
          url: 'https://private.example.test/active',
          title: 'Private Active',
          active: true,
          status: 'complete',
          openedBy: 'ai',
          openedByConfidence: 0.95,
          aiOperationState: 'recently_operated',
          lastAiOperation: 'navigate_new_tab',
          lastAiOperationConfidence: 0.95,
          lastAiOperationReason: 'Private operation reason',
          canTabrixOperate: true,
          operabilityReason: 'regular_web_page',
        },
        latestAiOperatedObject: {
          role: 'latest_ai_operated_tab',
          tabId: 7,
          windowId: 1,
          url: 'https://private.example.test/active',
          title: 'Private Active',
          active: true,
          status: 'complete',
          openedBy: 'ai',
          openedByConfidence: 0.95,
          aiOperationState: 'recently_operated',
          lastAiOperation: 'navigate_new_tab',
          lastAiOperationConfidence: 0.95,
          lastAiOperationReason: 'Private operation reason',
          canTabrixOperate: true,
          operabilityReason: 'regular_web_page',
        },
        operationRouting: {
          browserActiveTabId: 7,
          latestAiOperatedTabId: 7,
          relationToBrowserActiveTab: 'same_as_browser_active',
          canContinueOnLatestAiOperatedTab: true,
          latestAiOperation: 'navigate_new_tab',
          latestAiOperationConfidence: 0.95,
          latestAiOperationReason: 'Private operation reason',
          summary: 'Private operation summary',
          claimBoundary: 'Private operation boundary',
        },
        operationTargetBrief: {
          targetTabId: 7,
          targetWindowId: 1,
          targetRole: 'latest_ai_operated_active_tab',
          targetBasis: 'latest_ai_operated_tab_matches_browser_active_tab',
          targetCanTabrixOperate: true,
          targetOperabilityReason: 'regular_web_page',
          browserActiveTabId: 7,
          latestAiOperatedTabId: 7,
          relationToBrowserActiveTab: 'same_as_browser_active',
          shouldReselectBeforeAction: false,
          nextRequiredCheck: 'page_level_read_or_postcondition_check',
          summary: 'Private operation target summary',
          claimBoundary: 'Private operation target boundary',
        },
        browserObjectEdgeSummary: 'Private browser object edge summary',
        objectChangeSummary: 'Private object change summary',
        dynamicObjectUpdateSummary: 'Private dynamic object update summary',
        windows: [{ compactTabLimit: 12, tabs: [{ tabId: 7 }] }],
        retentionPolicy: { recentEventLimit: 50, recentEventsRetained: 4 },
      },
      browserWorld: {
        tabs: [
          {
            tabId: 7,
            active: true,
            openedBy: 'ai',
            canTabrixOperate: true,
            status: 'complete',
          },
        ],
      },
    },
    7,
  );

  assert.deepEqual(summary.activeObject, {
    tabIdPresent: true,
    windowIdPresent: true,
    tabStatus: 'complete',
    openedBy: 'ai',
    canTabrixOperate: true,
    tabOperabilityReason: 'regular_web_page',
    windowOperabilityReason: 'active_tab_operable_in_visible_window',
  });
  assert.deepEqual(summary.browserActiveObject, {
    objectPresent: true,
    role: 'browser_active_tab',
    tabIdPresent: true,
    windowIdPresent: true,
    active: true,
    status: 'complete',
    openedBy: 'ai',
    openedByConfidence: 0.95,
    aiOperationState: 'recently_operated',
    lastAiOperation: 'navigate_new_tab',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    canTabrixOperate: true,
    operabilityReason: 'regular_web_page',
  });
  assert.deepEqual(summary.latestAiOperatedObject, {
    objectPresent: true,
    role: 'latest_ai_operated_tab',
    tabIdPresent: true,
    windowIdPresent: true,
    active: true,
    status: 'complete',
    openedBy: 'ai',
    openedByConfidence: 0.95,
    aiOperationState: 'recently_operated',
    lastAiOperation: 'navigate_new_tab',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    canTabrixOperate: true,
    operabilityReason: 'regular_web_page',
  });
  assert.deepEqual(summary.operationRouting, {
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    relationToBrowserActiveTab: 'same_as_browser_active',
    canContinueOnLatestAiOperatedTab: true,
    latestAiOperation: 'navigate_new_tab',
    latestAiOperationConfidence: 0.95,
    latestAiOperationReasonPresent: true,
    summaryPresent: true,
    claimBoundaryPresent: true,
  });
  assert.deepEqual(summary.operationTargetBrief, {
    targetTabIdPresent: true,
    targetWindowIdPresent: true,
    targetRole: 'latest_ai_operated_active_tab',
    targetBasis: 'latest_ai_operated_tab_matches_browser_active_tab',
    targetCanTabrixOperate: true,
    targetOperabilityReason: 'regular_web_page',
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    relationToBrowserActiveTab: 'same_as_browser_active',
    shouldReselectBeforeAction: false,
    nextRequiredCheck: 'page_level_read_or_postcondition_check',
    summaryPresent: true,
    claimBoundaryPresent: true,
  });
  assert.equal(summary.targetActiveMatchesLifecycleStep, true);
  assert.equal(summary.expectedRelationToBrowserActiveTab, 'same_as_browser_active');
  assert.equal(summary.relationToBrowserActiveMatchesLifecycleStep, true);
  assert.equal(summary.expectedOperationTargetRole, 'latest_ai_operated_active_tab');
  assert.equal(summary.operationTargetRoleMatchesLifecycleStep, true);
  assert.equal(summary.expectedLatestAiOperation, 'navigate_new_tab');
  assert.equal(summary.latestAiOperationMatchesLifecycleStep, true);
  assert.equal(summary.objectChangeSummaryPresent, true);
  assert.equal(JSON.stringify(summary).includes('private.example.test'), false);
  assert.equal(JSON.stringify(summary).includes('Private Active'), false);
  assert.equal(JSON.stringify(summary).includes('Private operation'), false);
});

test('isLifecycleStepPassing rejects stale operation target routing', () => {
  const passingStep = {
    targetTab: {
      wasFound: true,
      openedBy: 'ai',
      canTabrixOperate: true,
    },
    targetActiveMatchesLifecycleStep: true,
    relationToBrowserActiveMatchesLifecycleStep: true,
    operationTargetRoleMatchesLifecycleStep: true,
    latestAiOperationMatchesLifecycleStep: true,
    browserObjectEdgeSummaryPresent: true,
    objectChangeSummaryPresent: true,
    dynamicObjectUpdateSummaryPresent: true,
    retentionWithinLimit: true,
    compactSummaryBounded: true,
    activeObject: {
      tabIdPresent: true,
      tabStatus: 'complete',
      tabOperabilityReason: 'regular_web_page',
      windowOperabilityReason: 'active_tab_operable_in_visible_window',
    },
    browserActiveObject: {
      objectPresent: true,
      tabIdPresent: true,
      operabilityReason: 'regular_web_page',
    },
    latestAiOperatedObject: {
      objectPresent: true,
      tabIdPresent: true,
      operabilityReason: 'regular_web_page',
    },
    currentTabAttributeGroups: {
      identity: { tabIdPresent: true },
      runtime: { status: 'complete' },
      ownership: { openedBy: 'ai' },
      operability: { reason: 'regular_web_page' },
    },
    lastAiOperatedTabAttributeGroups: {
      identity: { tabIdPresent: true },
      runtime: { status: 'complete' },
      ownership: { openedBy: 'ai' },
      operability: { reason: 'regular_web_page' },
    },
    tabAttributeGroupClaimBoundaryPresent: true,
    operationRouting: {
      browserActiveTabIdPresent: true,
      latestAiOperatedTabIdPresent: true,
      relationToBrowserActiveTab: 'same_as_browser_active',
      summaryPresent: true,
      claimBoundaryPresent: true,
    },
    aiRoutingBrief: {
      summaryPresent: true,
      recommendedNextCheckPresent: true,
      claimBoundaryPresent: true,
    },
    operationTargetBrief: {
      targetTabIdPresent: true,
      targetRole: 'latest_ai_operated_active_tab',
      nextRequiredCheck: 'page_level_read_or_postcondition_check',
      summaryPresent: true,
      claimBoundaryPresent: true,
    },
    activeTabIncludedInCompactTabs: true,
  };

  assert.equal(isLifecycleStepPassing(passingStep), true);
  assert.equal(
    isLifecycleStepPassing({
      ...passingStep,
      relationToBrowserActiveMatchesLifecycleStep: false,
    }),
    false,
  );
  assert.equal(
    isLifecycleStepPassing({
      ...passingStep,
      operationTargetRoleMatchesLifecycleStep: false,
    }),
    false,
  );
});

test('buildRedactedReadPageAlignmentSummary omits URL, title, and page text fields', () => {
  const summary = buildRedactedReadPageAlignmentSummary(
    {
      ownershipRuntime: {
        currentTabId: 42,
        currentWindowId: 7,
        currentWindowState: 'normal',
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        browserActiveTabId: 42,
        browserActiveTabIdKnown: true,
        isReadTargetBrowserActiveTab: true,
        currentTabUrl: 'https://private.example.test/dashboard',
        currentTabTitle: 'Private Dashboard',
        currentTabStatus: 'complete',
        currentTabOpenedBy: 'ai',
        currentTabOpenedByConfidence: 0.9,
        currentTabAiOperationState: 'recently_operated',
        currentTabLastAiOperation: 'read_page',
        currentTabLastAiOperationConfidence: 0.95,
        currentTabLastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
        browserWorldObjectChangeSummary:
          'Object change summary includes https://private.example.test/dashboard and Private Dashboard.',
        browserWorldCurrentOperationConclusion:
          'Current operation object includes https://private.example.test/dashboard and Private Dashboard.',
        currentOwnerType: 'run_owned',
      },
      browserPageObjectCompact: {
        source: 'read_page_browser_page_object_compact',
        status: 'single_snapshot',
        watchStatus: 'snapshot_only',
        primaryConclusion:
          'Current BrowserPageObject snapshot: One Tab page object: tab=42; active=true; browserActive=true; owner=run_owned; openedBy=ai; operable=true; window=normal; focused=true; page=ready/stable; runtime=browser_world_inventory; source=dom_region_rows.',
        changedGroups: ['tab_state'],
        transitionCount: 0,
        facts: {
          window: {
            currentWindowId: 7,
            currentWindowState: 'normal',
            isCurrentWindowFocused: true,
          },
          tab: {
            readTargetTabId: 42,
            currentActiveTabId: 42,
            browserActiveTabId: 42,
            currentTabUrl: 'https://private.example.test/dashboard',
            currentTabTitle: 'Private Dashboard',
            openedBy: 'ai',
            lastAiOperation: 'read_page',
            lastAiOperationConfidence: 0.95,
            lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
            browserWorldObjectChangeSummary:
              'Object change summary includes https://private.example.test/dashboard and Private Dashboard.',
            browserWorldCurrentOperationConclusion:
              'Current operation object includes https://private.example.test/dashboard and Private Dashboard.',
            isRunOwnedByTask: false,
            runtimeStateSource: 'browser_world_inventory',
            operationTargetRole: 'read_target_browser_active_tab',
            operationTargetBasis: 'read_target_matches_browser_active_tab',
            operationTargetCanTabrixOperate: true,
            operationTargetOperabilityReason: 'regular_web_page',
            shouldReselectBeforeAction: false,
            nextRequiredCheck: 'page_level_content_or_postcondition_check',
            operationTargetSummary:
              'Read-page operation target includes https://private.example.test/dashboard and Private Dashboard.',
            operationTargetClaimBoundary: 'Read-page operation target boundary.',
          },
          page: {
            pageText: 'confidential visible page text',
          },
        },
        operationSummary: 'Click the private billing button',
        evidenceSummary: 'Private Dashboard title observed',
        claimBoundary: 'raw claim',
      },
      pageRegions: [
        {
          regionId: 'private-region-content',
          regionType: 'content',
          state: 'content_available_candidate',
          confidence: 0.72,
          label: 'Private Dashboard content area',
          objects: [
            {
              objectId: 'private-object-billing',
              label: 'private billing button',
              actionTypes: ['read'],
              targetability: 'unknown',
              confidence: 0.51,
              reason: 'fixture includes confidential visible page text',
            },
          ],
          candidateActionIds: ['private-action-billing'],
          targetability: 'unknown',
          claimBoundary: 'candidate page region only',
        },
      ],
      pageOperationMap: {
        summary: 'Private Dashboard operation map',
        zones: [
          {
            zoneId: 'private-zone-read',
            regionId: 'private-region-content',
            regionType: 'content',
            purpose: 'read_content',
            label: 'private billing action',
            state: 'content_available_candidate',
            readiness: 'ready',
            targetability: 'unknown',
            candidateActionIds: ['private-action-billing'],
            evidenceLevel: 'deterministic_fixture',
            claimBoundary: 'planning guidance only',
          },
        ],
        claimBoundary: 'page operation map candidate only',
      },
      pageContent: 'confidential visible page text',
      markdown: 'Private Dashboard markdown',
    },
    42,
  );

  const serialized = JSON.stringify(summary);
  assert.equal(serialized.includes('private.example.test'), false);
  assert.equal(serialized.includes('Private Dashboard'), false);
  assert.equal(serialized.includes('confidential visible page text'), false);
  assert.equal(serialized.includes('private billing'), false);
  assert.deepEqual(summary.alignment, {
    ownershipRuntimePresent: true,
    browserPageObjectCompactPresent: true,
    browserPageObjectCompactSource: 'expected',
    browserWorldRuntimeSource: true,
    tabPageObjectSummaryPresent: true,
    currentTabIdPresent: true,
    currentWindowIdPresent: true,
    currentWindowStateKnown: true,
    currentTabStatusKnown: true,
    currentTabOperabilityKnown: true,
    ownershipRuntimeAiOperationEvidencePresent: true,
    compactAiOperationEvidencePresent: true,
    currentTabAiOperationEvidencePresent: true,
    operationTargetBriefPresent: true,
    targetTabMatchesReadPage: true,
    readTargetIsBrowserActive: true,
    tabOwnerIsAi: true,
    tabOperable: true,
    pageRegionsPresent: true,
    pageRegionClaimBoundariesPresent: true,
    pageOperationMapPresent: true,
    pageOperationZonesPresent: true,
    pageOperationClaimBoundaryPresent: true,
    browserWorldObjectChangeSummaryPresent: true,
    browserWorldCurrentOperationConclusionPresent: true,
  });
  assert.deepEqual(summary.pageRegionRuntime, {
    pageRegionsPresent: true,
    pageRegionCount: 1,
    regionTypes: ['content'],
    targetableRegionCount: 0,
    regionObjectCount: 1,
    candidateActionRegionCount: 1,
    pageOperationMapPresent: true,
    operationZoneCount: 1,
    operationPurposes: ['read_content'],
    operationClaimBoundaryPresent: true,
  });
  assert.equal(summary.compact.hasTabPageObjectSummary, true);
  assert.deepEqual(summary.compact.safeTabFacts, {
    readTargetTabId: 42,
    currentActiveTabId: 42,
    browserActiveTabId: 42,
    openedBy: 'ai',
    lastAiOperation: 'read_page',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    browserWorldObjectChangeSummaryPresent: true,
    browserWorldCurrentOperationConclusionPresent: true,
    isRunOwnedByTask: false,
    runtimeStateSource: 'browser_world_inventory',
    operationTargetRole: 'read_target_browser_active_tab',
    operationTargetBasis: 'read_target_matches_browser_active_tab',
    operationTargetCanTabrixOperate: true,
    operationTargetOperabilityReason: 'regular_web_page',
    shouldReselectBeforeAction: false,
    nextRequiredCheck: 'page_level_content_or_postcondition_check',
    operationTargetSummaryPresent: true,
    operationTargetClaimBoundaryPresent: true,
  });
});

test('buildReadPageMatrixTargetResult accepts background read targets when object evidence is complete', () => {
  const target = buildReadPageMatrixTargetResult(
    {
      openedPublicTestTab: true,
      closeSucceeded: true,
      cleanupPassed: true,
      alignmentPassed: false,
      matrixAlignmentPassed: true,
      redactedReadPage: {
        pageRegionRuntime: {
          pageRegionsPresent: true,
          pageOperationMapPresent: true,
        },
        runtime: {
          currentTabIdPresent: true,
          currentTabIdMatchesTarget: true,
          isCurrentTabActive: false,
          isReadTargetBrowserActiveTab: false,
          currentTabCanTabrixOperate: true,
          currentTabLastAiOperation: 'read_page',
        },
      },
      redactedBrowserWorldAfterRead: {
        targetTab: { wasFound: true },
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        aiOperationState: {
          latestAiOperation: 'read_page',
          relationToBrowserActiveTab: 'latest_ai_operated_background_tab',
        },
      },
      redactedBrowserWorldAfterClose: {
        targetTab: { wasFound: false },
        compactSummaryBounded: true,
        retentionWithinLimit: true,
      },
    },
    1,
  );

  assert.equal(target.alignmentPassed, false);
  assert.equal(target.matrixAlignmentPassed, true);
  assert.equal(target.runtime.isReadTargetBrowserActiveTab, false);
  assert.equal(
    target.browserWorldAfterRead.relationToBrowserActiveTab,
    'latest_ai_operated_background_tab',
  );
  assert.equal(target.passed, true);
});

test('isSmokeResultPassing fails redacted matrix results that are not proven', () => {
  assert.equal(
    isSmokeResultPassing({
      scenario: 'read-page-matrix',
      targetCount: 2,
      allTargetsPassed: false,
      targets: [{ passed: true }, { passed: false }],
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'read-page-matrix',
      targetCount: 2,
      allTargetsPassed: true,
      targets: [{ passed: true }, { passed: true }],
    }),
    true,
  );
});

test('isSmokeResultPassing keeps observer verdicts strict and explicit', () => {
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state',
      verdict: 'WINDOW_STATE_OBSERVED',
    }),
    true,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state',
      verdict: 'WINDOW_STATE_NOT_PROVEN',
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state-drift',
      verdict: 'WINDOW_STATE_REPEATED_OBSERVER_NOT_PROVEN',
    }),
    false,
  );
});

test('parseArgs supports observer-only window-state scenario', () => {
  assert.equal(parseArgs(['--scenario', 'window-state']).scenario, 'window-state');
});

test('parseArgs supports observer-only window-state drift sampling', () => {
  assert.deepEqual(
    parseArgs([
      '--scenario',
      'window-state-drift',
      '--sample-count',
      '4',
      '--sample-interval-ms',
      '10',
    ]),
    {
      url: 'https://example.com/?tabrix_browser_world_smoke=1',
      urls: [],
      keepOpen: false,
      skipOpen: false,
      sampleCount: 4,
      sampleIntervalMs: 10,
      scenario: 'window-state-drift',
      timeoutMs: 60_000,
    },
  );
});

test('parseArgs supports read-page scenario', () => {
  assert.equal(parseArgs(['--scenario', 'read-page']).scenario, 'read-page');
});

test('parseArgs supports read-page matrix scenario', () => {
  assert.equal(parseArgs(['--scenario', 'read-page-matrix']).scenario, 'read-page-matrix');
});

test('parseArgs supports safe smoke switches', () => {
  assert.deepEqual(
    parseArgs([
      '--url',
      'https://example.org/',
      '--keep-open',
      '--skip-open',
      '--scenario',
      'lifecycle',
    ]),
    {
      url: 'https://example.org/',
      urls: ['https://example.org/'],
      keepOpen: true,
      skipOpen: true,
      sampleCount: 3,
      sampleIntervalMs: 250,
      scenario: 'lifecycle',
      timeoutMs: 60_000,
    },
  );
});

test('resolveSmokeUrls supports repeated and comma-separated public urls', () => {
  const args = parseArgs([
    '--url',
    'https://example.com/a',
    '--urls',
    'https://example.org/b,https://example.net/c',
  ]);

  assert.deepEqual(resolveSmokeUrls(args), [
    'https://example.com/a',
    'https://example.org/b',
    'https://example.net/c',
  ]);
});

test('buildPublicSmokeUrl keeps the target public and adds case metadata', () => {
  assert.equal(
    buildPublicSmokeUrl('https://example.com/start?x=1', 'foreground', 'run-1'),
    'https://example.com/start?x=1&tabrix_smoke_case=foreground&tabrix_smoke_run=run-1',
  );
  assert.throws(() => buildPublicSmokeUrl('http://localhost:3000/', 'foreground', 'run-1'));
});
