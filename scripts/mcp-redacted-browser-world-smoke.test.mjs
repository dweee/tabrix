import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHttpUrl,
  assertRedactedSmokeOutputSafe,
  buildPublicSmokeUrl,
  buildPostCloseTargetCleanupSummary,
  buildPublicNoLoginLifecycleCoverageSummary,
  buildRedactedBrowserWorldSummary,
  buildRedactedReadPageAlignmentSummary,
  buildActiveTabSwitchProof,
  buildBackgroundReadTargetFocusProof,
  buildStepSummary,
  buildOwnershipMixProof,
  buildPageOpenerOwnershipProof,
  buildPageOpenerReadAlignmentProof,
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

function redactedCurrentTabAttributeGroups() {
  return {
    identity: { tabIdPresent: true },
    runtime: { status: 'complete' },
    ownership: { openedBy: 'user_or_page' },
    operability: { reason: 'regular_web_page' },
  };
}

function redactedAiActionReadiness() {
  return {
    readiness: 'ready_for_page_level_check',
    targetRole: 'latest_ai_operated_active_tab',
    targetTabIdPresent: true,
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    canProceedToPageLevelCheck: true,
    requiredBeforeAction: 'page_level_read_or_postcondition_check',
    summaryPresent: true,
    claimBoundaryPresent: true,
  };
}

function redactedRetentionPolicy() {
  return {
    eventPrivacyBoundaryPresent: true,
    detailBoundaryPresent: true,
  };
}

function redactedWindowLifecycleState() {
  return {
    latestEventKind: null,
    retainedWindowCount: 1,
    focusedWindowIdPresent: true,
    visibleWindowCount: 1,
    minimizedWindowCount: 0,
    operableWindowCount: 1,
    inoperableWindowCount: 0,
  };
}

test('extractJsonObject parses the bounded CLI Result payload', () => {
  const parsed = extractJsonObject('tabrix mcp call get_windows_and_tabs\n\nResult\n{"ok":true}\n');
  assert.deepEqual(parsed, { ok: true });
});

test('extractJsonObject ignores JSON-RPC prelude objects before the CLI Result payload', () => {
  const parsed = extractJsonObject(
    [
      'debug JsonRpcMessage {"jsonrpc":"2.0","method":"notifications/progress"}',
      'tabrix mcp call get_windows_and_tabs',
      '',
      'Result',
      '{"ok":true,"windowCount":1}',
    ].join('\n'),
  );
  assert.deepEqual(parsed, { ok: true, windowCount: 1 });
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
  assert.throws(() => assertRedactedSmokeOutputSafe({ auth: { accountState: 'logged_in' } }));
  assert.throws(() => assertRedactedSmokeOutputSafe({ auth: { qrPayload: 'opaque-qr-data' } }));
  assert.throws(() => assertRedactedSmokeOutputSafe({ auth: { rawScreenshot: '<png>' } }));
  assert.throws(() => assertRedactedSmokeOutputSafe({ network: { requestBody: 'private=1' } }));
  assert.throws(() =>
    assertRedactedSmokeOutputSafe({ auth: { qrImagePreview: 'data:image/png;base64,abc' } }),
  );
  assert.throws(() =>
    assertRedactedSmokeOutputSafe({ network: { header: 'Authorization: Bearer abc.def' } }),
  );
  assert.throws(() =>
    assertRedactedSmokeOutputSafe({ network: { header: 'Cookie: session_id=abc' } }),
  );
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
        primaryConclusion:
          'Browser object snapshot: focusedWindow=1, visibility=visible, operable=yes; activeTab=20, status=complete, owner=ai, operable=yes; latestAiTab=20, relation=same_as_browser_active, canContinue=yes; inventory=windows:1, tabs:20, ai:1, userOrPage:19, operable:20; recent=Last change redacted.; next=page_level_read_or_postcondition_check',
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
        aiActionReadiness: {
          readiness: 'ready_for_page_level_check',
          targetRole: 'latest_ai_operated_active_tab',
          targetTabId: 20,
          browserActiveTabId: 20,
          latestAiOperatedTabId: 20,
          canProceedToPageLevelCheck: true,
          requiredBeforeAction: 'page_level_read_or_postcondition_check',
          summary:
            'AI action readiness includes https://private.example.test/dashboard and Private Dashboard.',
          claimBoundary: 'AI action readiness boundary.',
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
          latestUrlChanged: true,
          latestTitleChanged: true,
          latestStatusChanged: true,
          latestAudibleChanged: false,
          latestMutedChanged: true,
          latestPinnedChanged: false,
          latestDiscardedChanged: false,
          latestReplacedTabId: null,
          recentCreatedCount: 1,
          recentUpdatedCount: 2,
          recentUrlChangedCount: 1,
          recentTitleChangedCount: 1,
          recentStatusChangedCount: 2,
          recentAudibleChangedCount: 0,
          recentMutedChangedCount: 1,
          recentPinnedChangedCount: 0,
          recentDiscardedChangedCount: 0,
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
  assert.deepEqual(summary.aiActionReadiness, {
    readiness: 'ready_for_page_level_check',
    targetRole: 'latest_ai_operated_active_tab',
    targetTabIdPresent: true,
    browserActiveTabIdPresent: true,
    latestAiOperatedTabIdPresent: true,
    canProceedToPageLevelCheck: true,
    requiredBeforeAction: 'page_level_read_or_postcondition_check',
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
    latestChangedAttributes: ['url', 'title', 'status', 'muted'],
    latestReplacedTabIdPresent: false,
    recentCreatedCount: 1,
    recentUpdatedCount: 2,
    recentUrlChangedCount: 1,
    recentTitleChangedCount: 1,
    recentStatusChangedCount: 2,
    recentRuntimeFlagChangedCount: 1,
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
  assert.equal(summary.primaryConclusionPresent, true);
  assert.equal(summary.browserObjectSnapshotConclusionPresent, true);
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
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'skipped_recent_resync',
        },
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    },
  ];

  assert.deepEqual(buildWindowStateDriftSummary(samples), {
    sampleCount: 2,
    allSamplesObserved: true,
    allSamplesCompactBounded: true,
    allSamplesRetentionBounded: true,
    allSamplesPrivacyBoundariesPresent: true,
    allSamplesRefreshHealthPresent: true,
    allSamplesWindowLifecyclePresent: true,
    sampleDurationStats: {
      sampleCountWithDuration: 0,
      totalObservedSampleDurationMs: 0,
      maxObservedSampleDurationMs: null,
      averageObservedSampleDurationMs: null,
      claimBoundary:
        'Observer sample duration is measured around redacted get_windows_and_tabs smoke calls only. It is a local smoke signal, not a full performance benchmark.',
    },
    refreshThrottleProof: {
      requestedSampleIntervalMs: null,
      minimumObservedSampleIntervalMs: null,
      minimumObservedFullResyncIntervalMs: null,
      sampledInsideThrottleWindow: false,
      fullChromeResyncSamples: 1,
      skippedRecentResyncSamples: 1,
      failedRefreshSamples: 0,
      unavailableRefreshSamples: 0,
      skippedRecentResyncObserved: true,
      proofSatisfied: true,
      claimBoundary:
        'Throttle proof uses redacted refresh decisions only. It proves repeated observer sampling did not require every sample to perform a full Chrome resync; it does not prove page content or task success.',
    },
    allSamplesCurrentTabAttributeGroupsPresent: true,
    allSamplesCurrentTabStateAccountedFor: true,
    allSamplesAiActionReadinessPresent: true,
    observerStabilityProof: {
      proofSatisfied: true,
      sampleCount: 2,
      allSamplesObserved: true,
      allSamplesCompactBounded: true,
      allSamplesRetentionBounded: true,
      allSamplesPrivacyBoundariesPresent: true,
      allSamplesRefreshHealthPresent: true,
      allSamplesWindowLifecyclePresent: true,
      allSamplesCurrentTabStateAccountedFor: true,
      allSamplesAiActionReadinessPresent: true,
      refreshThrottleProofSatisfied: true,
      claimBoundary:
        'Long-running observer stability proof covers repeated public no-login Browser World observation contract only. It does not prove login/account flows, page understanding, API/CDP reuse, or product delivery grade.',
    },
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
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 5,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'skipped_recent_resync',
        },
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    },
  ]);

  assert.equal(summary.allSamplesObserved, true);
  assert.equal(summary.allSamplesCompactBounded, true);
  assert.equal(summary.allSamplesRetentionBounded, true);
  assert.equal(summary.allSamplesPrivacyBoundariesPresent, true);
  assert.equal(summary.allSamplesRefreshHealthPresent, true);
  assert.equal(summary.allSamplesCurrentTabAttributeGroupsPresent, true);
  assert.equal(summary.allSamplesCurrentTabStateAccountedFor, true);
  assert.equal(summary.allSamplesAiActionReadinessPresent, true);
  assert.equal(summary.observerStabilityProof.proofSatisfied, true);
  assert.equal(summary.windowCountStable, true);
  assert.equal(summary.tabCountStable, false);
  assert.equal(summary.driftObserved, true);
});

test('buildWindowStateDriftSummary accounts for explicit no-focused-window state', () => {
  const summary = buildWindowStateDriftSummary([
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 1,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        currentTabAttributeGroups: null,
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 0 },
        objectInventory: { browserActiveTabIdPresent: false },
        windowOperationState: {
          relationToCurrentOperableWindow: 'no_focused_window',
          focusedWindowIdPresent: false,
          focusedWindowState: null,
        },
        windowLifecycleState: {
          ...redactedWindowLifecycleState(),
          focusedWindowIdPresent: false,
        },
        windowLifecycleConclusionPresent: true,
      },
    },
  ]);

  assert.equal(summary.allSamplesObserved, true);
  assert.equal(summary.allSamplesCurrentTabAttributeGroupsPresent, false);
  assert.equal(summary.allSamplesCurrentTabStateAccountedFor, true);
});

test('buildWindowStateDriftSummary requires skipped resync proof for sub-throttle sampling', () => {
  const baseRedacted = {
    tabCount: 4,
    compactSummaryBounded: true,
    retentionWithinLimit: true,
    retentionPolicy: redactedRetentionPolicy(),
    currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
    tabAttributeGroupClaimBoundaryPresent: true,
    aiActionReadiness: redactedAiActionReadiness(),
    windows: { total: 1, focused: 1 },
    windowOperationState: { focusedWindowState: 'normal' },
    windowLifecycleState: redactedWindowLifecycleState(),
    windowLifecycleConclusionPresent: true,
  };

  const summary = buildWindowStateDriftSummary(
    [
      {
        verdict: 'WINDOW_STATE_OBSERVED',
        redacted: {
          ...baseRedacted,
          refreshHealth: {
            fullChromeResyncCount: 3,
            skippedChromeResyncCount: 0,
            minFullChromeResyncIntervalMs: 250,
            lastRefreshDecision: 'full_chrome_resync',
          },
        },
      },
      {
        verdict: 'WINDOW_STATE_OBSERVED',
        redacted: {
          ...baseRedacted,
          refreshHealth: {
            fullChromeResyncCount: 4,
            skippedChromeResyncCount: 0,
            minFullChromeResyncIntervalMs: 250,
            lastRefreshDecision: 'full_chrome_resync',
          },
        },
      },
    ],
    { sampleIntervalMs: 50, observedSampleIntervalsMs: [50] },
  );

  assert.equal(summary.refreshThrottleProof.sampledInsideThrottleWindow, true);
  assert.equal(summary.refreshThrottleProof.skippedRecentResyncObserved, false);
  assert.equal(summary.refreshThrottleProof.proofSatisfied, false);
});

test('buildWindowStateDriftSummary requires refresh health for every sample', () => {
  const summary = buildWindowStateDriftSummary([
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        retentionPolicy: redactedRetentionPolicy(),
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    },
    {
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        tabCount: 4,
        compactSummaryBounded: true,
        retentionWithinLimit: true,
        retentionPolicy: redactedRetentionPolicy(),
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windows: { total: 1, focused: 1 },
        windowOperationState: { focusedWindowState: 'normal' },
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
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
      targetNoLongerRetained: false,
      closedTargetNotOperable: false,
      compactSummaryBounded: true,
      retentionWithinLimit: true,
      claimBoundary:
        'Post-close cleanup summary uses redacted Browser World object retention only; it does not expose URL, title, page content, account state, or task success.',
    },
    {
      targetIndex: 2,
      targetTabFound: false,
      targetNoLongerRetained: true,
      closedTargetNotOperable: true,
      compactSummaryBounded: true,
      retentionWithinLimit: true,
      claimBoundary:
        'Post-close cleanup summary uses redacted Browser World object retention only; it does not expose URL, title, page content, account state, or task success.',
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
    aiActionReadiness: redactedAiActionReadiness(),
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

test('buildPublicNoLoginLifecycleCoverageSummary separates proven and not-proven lifecycle edges', () => {
  const coverage = buildPublicNoLoginLifecycleCoverageSummary({
    openedPublicTestTabs: 3,
    cleanupTargetsPassed: true,
    lifecycleMatrix: [
      { step: 'foreground_open' },
      { step: 'background_open' },
      { step: 'switch_to_background_tab' },
      { step: 'new_window_open' },
    ],
    postCleanup: {
      tabLifecycleState: {
        recentCreatedCount: 3,
        recentUpdatedCount: 2,
        recentActivatedCount: 1,
        recentRemovedCount: 3,
      },
    },
    postCloseTargets: [
      { targetNoLongerRetained: true, closedTargetNotOperable: true },
      { targetNoLongerRetained: true, closedTargetNotOperable: true },
      { targetNoLongerRetained: true, closedTargetNotOperable: true },
    ],
  });

  assert.doesNotThrow(() => assertRedactedSmokeOutputSafe(coverage));
  assert.deepEqual(coverage.coveredInThisRun, {
    tabCreated: true,
    tabUpdated: true,
    tabActivated: true,
    tabRemoved: true,
    foregroundTabOpen: true,
    backgroundTabOpen: true,
    switchToBackgroundTab: true,
    newWindowTabOpen: true,
    postCloseTargetCleanup: true,
  });
  assert.equal(coverage.minimumPublicLifecycleCoveragePassed, true);
  assert.deepEqual(coverage.notProvenInThisRun, [
    'tab_replaced',
    'tab_attached',
    'tab_detached',
    'window_minimize_restore',
    'private_or_login_page_lifecycle',
  ]);
  assert.match(coverage.claimBoundary, /does not prove tab replace\/attach\/detach/);
});

test('buildPublicNoLoginLifecycleCoverageSummary fails minimum coverage when close proof is weak', () => {
  const coverage = buildPublicNoLoginLifecycleCoverageSummary({
    openedPublicTestTabs: 3,
    cleanupTargetsPassed: true,
    lifecycleMatrix: [
      { step: 'foreground_open' },
      { step: 'background_open' },
      { step: 'switch_to_background_tab' },
      { step: 'new_window_open' },
    ],
    postCleanup: {
      tabLifecycleState: {
        recentCreatedCount: 3,
        recentActivatedCount: 1,
        recentRemovedCount: 2,
      },
    },
    postCloseTargets: [
      { targetNoLongerRetained: true, closedTargetNotOperable: true },
      { targetNoLongerRetained: true, closedTargetNotOperable: true },
    ],
  });

  assert.equal(coverage.coveredInThisRun.tabRemoved, false);
  assert.equal(coverage.coveredInThisRun.postCloseTargetCleanup, false);
  assert.equal(coverage.minimumPublicLifecycleCoveragePassed, false);
});

test('buildOwnershipMixProof proves AI and non-AI tab ownership without raw ids', () => {
  const proof = buildOwnershipMixProof({
    openedPublicTestTabs: 3,
    lifecycleMatrix: [
      {
        step: 'foreground_open',
        targetTab: { wasFound: true, openedBy: 'ai' },
        counts: { aiOpenedTabs: 1, userOrPageOpenedTabs: 1 },
      },
      {
        step: 'background_open',
        targetTab: { wasFound: true, openedBy: 'ai' },
        counts: { aiOpenedTabs: 2, userOrPageOpenedTabs: 1 },
      },
      {
        step: 'new_window_open',
        targetTab: { wasFound: true, openedBy: 'ai' },
        counts: { aiOpenedTabs: 3, userOrPageOpenedTabs: 1 },
      },
    ],
  });

  assert.deepEqual(proof, {
    publicNoLoginOnly: true,
    openedPublicTestTabs: 3,
    maxAiOpenedTabs: 3,
    maxUserOrPageOpenedTabs: 1,
    aiOpenedTabsObserved: true,
    userOrPageOpenedTabsObserved: true,
    mixedOwnershipObserved: true,
    aiTargetsMarked: true,
    proofSatisfied: true,
    claimBoundary:
      'Ownership mix proof is redacted count and boolean evidence only; it does not expose tab ids, URLs, titles, page content, account state, or task success.',
  });
  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('https://'), false);
  assert.equal(serialized.includes('Private'), false);
});

test('buildOwnershipMixProof fails when non-AI tab ownership is absent', () => {
  const proof = buildOwnershipMixProof({
    openedPublicTestTabs: 2,
    lifecycleMatrix: [
      {
        step: 'foreground_open',
        targetTab: { wasFound: true, openedBy: 'ai' },
        counts: { aiOpenedTabs: 2, userOrPageOpenedTabs: 0 },
      },
    ],
  });

  assert.equal(proof.aiOpenedTabsObserved, true);
  assert.equal(proof.userOrPageOpenedTabsObserved, false);
  assert.equal(proof.mixedOwnershipObserved, false);
  assert.equal(proof.proofSatisfied, false);
});

test('buildPageOpenerOwnershipProof proves target blank child ownership without raw page data', () => {
  const proof = buildPageOpenerOwnershipProof({
    parentTabId: 100,
    childTabId: 101,
    clickPayload: { verification: { newTabOpened: true } },
    browserWorldPayload: {
      summary: { counts: { pageOpenedTabs: 1 } },
      browserWorld: {
        tabs: [
          {
            tabId: 100,
            url: 'https://private.example.test/parent',
            title: 'Private Parent',
            openedBy: 'ai',
            openedBySource: 'ai_tool',
          },
          {
            tabId: 101,
            openerTabId: 100,
            url: 'https://private.example.test/child',
            title: 'Private Child',
            openedBy: 'user_or_page',
            openedBySource: 'page_opener',
          },
        ],
      },
    },
  });

  assert.equal(proof.parentTabOpened, true);
  assert.equal(proof.parentObserved, true);
  assert.equal(proof.childObserved, true);
  assert.equal(proof.clickNewTabObserved, true);
  assert.equal(proof.childOpenedByUserOrPage, true);
  assert.equal(proof.childOpenedBySourcePageOpener, true);
  assert.equal(proof.openerMatchesParent, true);
  assert.equal(proof.childIsNotAiOpened, true);
  assert.equal(proof.proofSatisfied, true);
  assert.doesNotThrow(() => assertRedactedSmokeOutputSafe(proof));
  assert.equal(JSON.stringify(proof).includes('private.example.test'), false);
});

test('buildPageOpenerOwnershipProof fails when child is not page opener sourced', () => {
  const proof = buildPageOpenerOwnershipProof({
    parentTabId: 100,
    childTabId: 101,
    clickPayload: { clickDiff: { newTabOpened: true } },
    browserWorldPayload: {
      summary: { counts: { pageOpenedTabs: 0 } },
      browserWorld: {
        tabs: [
          { tabId: 100, openedBy: 'ai', openedBySource: 'ai_tool' },
          {
            tabId: 101,
            openerTabId: null,
            openedBy: 'ai',
            openedBySource: 'ai_tool',
          },
        ],
      },
    },
  });

  assert.equal(proof.childObserved, true);
  assert.equal(proof.childOpenedBySourcePageOpener, false);
  assert.equal(proof.openerMatchesParent, null);
  assert.equal(proof.childIsNotAiOpened, false);
  assert.equal(proof.proofSatisfied, false);
});

test('buildPageOpenerReadAlignmentProof proves read_page keeps child page opener source', () => {
  const proof = buildPageOpenerReadAlignmentProof({
    childTabId: 101,
    browserWorldPayload: {
      browserWorld: {
        tabs: [
          {
            tabId: 101,
            openerTabId: 100,
            url: 'https://private.example.test/child',
            title: 'Private Child',
            openedBy: 'user_or_page',
            openedBySource: 'page_opener',
            canTabrixOperate: true,
          },
        ],
      },
    },
    readPagePayload: {
      ownershipRuntime: {
        currentTabId: 101,
        currentTabOpenedBy: 'user_or_page',
        currentTabOpenedBySource: 'page_opener',
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
        currentTabUrl: 'https://private.example.test/child',
        currentTabTitle: 'Private Child',
      },
      browserPageObjectCompact: {
        facts: {
          tab: {
            openedBy: 'user_or_page',
            openedBySource: 'page_opener',
          },
        },
      },
      browserPageObject: {
        privatePageTitle: 'Private Child',
      },
    },
  });

  assert.equal(proof.readTargetMatchesChild, true);
  assert.equal(proof.browserWorldChildIsPageOpener, true);
  assert.equal(proof.readRuntimeIsPageOpener, true);
  assert.equal(proof.compactTabIsPageOpener, true);
  assert.equal(proof.readRuntimeSourceIsBrowserWorld, true);
  assert.equal(proof.childOperable, true);
  assert.equal(proof.proofSatisfied, true);
  assert.doesNotThrow(() => assertRedactedSmokeOutputSafe(proof));
  assert.equal(JSON.stringify(proof).includes('private.example.test'), false);
});

test('buildPageOpenerReadAlignmentProof fails when read_page loses page opener source', () => {
  const proof = buildPageOpenerReadAlignmentProof({
    childTabId: 101,
    browserWorldPayload: {
      browserWorld: {
        tabs: [
          {
            tabId: 101,
            openerTabId: 100,
            openedBy: 'user_or_page',
            openedBySource: 'page_opener',
            canTabrixOperate: true,
          },
        ],
      },
    },
    readPagePayload: {
      ownershipRuntime: {
        currentTabId: 101,
        currentTabOpenedBy: 'ai',
        currentTabOpenedBySource: 'ai_tool',
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
      },
      browserPageObjectCompact: {
        facts: {
          tab: {
            openedBy: 'ai',
            openedBySource: 'ai_tool',
          },
        },
      },
    },
  });

  assert.equal(proof.browserWorldChildIsPageOpener, true);
  assert.equal(proof.readRuntimeIsPageOpener, false);
  assert.equal(proof.compactTabIsPageOpener, false);
  assert.equal(proof.proofSatisfied, false);
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
        currentTabOpenedBySource: 'ai_tool',
        currentTabOpenedByConfidence: 0.9,
        currentTabAiOperationState: 'recently_operated',
        currentTabLastAiOperation: 'read_page',
        currentTabLastAiOperationConfidence: 0.95,
        currentTabLastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
        browserWorldObjectChangeSummary:
          'Object change summary includes https://private.example.test/dashboard and Private Dashboard.',
        browserWorldActionableObjectChangeSummary:
          'Actionable object change includes https://private.example.test/dashboard and Private Dashboard.',
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
            openedBySource: 'ai_tool',
            lastAiOperation: 'read_page',
            lastAiOperationConfidence: 0.95,
            lastAiOperationReason: 'marked_by_tabrix_tool_execution:read_page',
            browserWorldObjectChangeSummary:
              'Object change summary includes https://private.example.test/dashboard and Private Dashboard.',
            browserWorldActionableObjectChangeSummary:
              'Actionable object change includes https://private.example.test/dashboard and Private Dashboard.',
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
            actionReadiness: 'ready_for_page_level_check',
            canProceedToPageLevelCheck: true,
            requiredBeforeAction: 'page_level_content_or_postcondition_check',
            actionReadinessSummary:
              'Read-page action readiness includes https://private.example.test/dashboard and Private Dashboard.',
            actionReadinessClaimBoundary: 'Read-page action readiness boundary.',
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
    actionReadinessBriefPresent: true,
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
    browserWorldActionableObjectChangeSummaryPresent: true,
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
    openedBySource: 'ai_tool',
    lastAiOperation: 'read_page',
    lastAiOperationConfidence: 0.95,
    lastAiOperationReasonPresent: true,
    browserWorldObjectChangeSummaryPresent: true,
    browserWorldActionableObjectChangeSummaryPresent: true,
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
    actionReadiness: 'ready_for_page_level_check',
    canProceedToPageLevelCheck: true,
    requiredBeforeAction: 'page_level_content_or_postcondition_check',
    actionReadinessSummaryPresent: true,
    actionReadinessClaimBoundaryPresent: true,
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
        alignment: {
          operationTargetBriefPresent: true,
          actionReadinessBriefPresent: true,
        },
        compact: {
          safeTabFacts: {
            operationTargetRole: 'read_target_background_tab',
            operationTargetBasis: 'read_target_differs_from_browser_active_tab',
            operationTargetCanTabrixOperate: true,
            operationTargetOperabilityReason: 'regular_web_page',
            shouldReselectBeforeAction: true,
            nextRequiredCheck: 'reselect_or_reread_read_target_before_action',
            operationTargetSummaryPresent: true,
            operationTargetClaimBoundaryPresent: true,
            actionReadiness: 'reselect_or_reread_required',
            canProceedToPageLevelCheck: false,
            requiredBeforeAction: 'reselect_or_reread_read_target_before_action',
            actionReadinessSummaryPresent: true,
            actionReadinessClaimBoundaryPresent: true,
          },
        },
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
  assert.deepEqual(target.readPageOperationTarget, {
    role: 'read_target_background_tab',
    basis: 'read_target_differs_from_browser_active_tab',
    canTabrixOperate: true,
    operabilityReason: 'regular_web_page',
    shouldReselectBeforeAction: true,
    nextRequiredCheck: 'reselect_or_reread_read_target_before_action',
    summaryPresent: true,
    claimBoundaryPresent: true,
    relationConsistentWithBrowserWorld: true,
    actionReadiness: 'reselect_or_reread_required',
    canProceedToPageLevelCheck: false,
    requiredBeforeAction: 'reselect_or_reread_read_target_before_action',
    actionReadinessSummaryPresent: true,
    actionReadinessClaimBoundaryPresent: true,
    actionReadinessBriefPresent: true,
  });
  assert.equal(target.passed, true);
});

test('buildBackgroundReadTargetFocusProof proves foreground remains active without exposing ids', () => {
  const proof = buildBackgroundReadTargetFocusProof(
    {
      browserWorld: {
        browserActiveTabId: 10,
        summary: {
          aiOperationState: {
            latestAiOperatedTabId: 20,
          },
        },
      },
      windows: [
        {
          tabs: [
            { id: 10, url: 'https://private.example.test/foreground', title: 'Private Foreground' },
            { id: 20, url: 'https://private.example.test/background', title: 'Private Background' },
          ],
        },
      ],
    },
    10,
    20,
  );

  assert.deepEqual(proof, {
    foregroundTabOpened: true,
    backgroundTabOpened: true,
    browserActiveTabKnown: true,
    latestAiOperatedTabKnown: true,
    browserActiveTabStayedOnForeground: true,
    latestAiOperatedTabIsBackground: true,
    backgroundTargetIsNotBrowserActive: true,
    claimBoundary:
      'Focus proof is redacted boolean evidence only; it does not expose tab ids, URLs, titles, page content, account state, or task success.',
  });
  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('private.example.test'), false);
  assert.equal(serialized.includes('Private Foreground'), false);
  assert.equal(serialized.includes('10'), false);
  assert.equal(serialized.includes('20'), false);
});

test('buildActiveTabSwitchProof proves active tab changed without exposing ids', () => {
  const beforePayload = {
    browserWorld: {
      browserActiveTabId: 10,
      summary: {
        aiOperationState: {
          latestAiOperatedTabId: 20,
          latestAiOperation: 'navigate_new_tab',
        },
      },
    },
    windows: [
      {
        tabs: [
          { id: 10, url: 'https://private.example.test/foreground', title: 'Private Foreground' },
          { id: 20, url: 'https://private.example.test/background', title: 'Private Background' },
        ],
      },
    ],
  };
  const afterPayload = {
    browserWorld: {
      browserActiveTabId: 20,
      summary: {
        aiOperationState: {
          latestAiOperatedTabId: 20,
          latestAiOperation: 'switch_tab',
        },
      },
    },
    windows: beforePayload.windows,
  };

  const proof = buildActiveTabSwitchProof(beforePayload, afterPayload, 10, 20);

  assert.deepEqual(proof, {
    fromTabOpened: true,
    toTabOpened: true,
    beforeBrowserActiveKnown: true,
    afterBrowserActiveKnown: true,
    beforeBrowserActiveWasFrom: true,
    afterBrowserActiveIsTo: true,
    browserActiveChangedToTarget: true,
    afterLatestAiOperatedIsTo: true,
    afterLatestAiOperationIsSwitchTab: true,
    claimBoundary:
      'Active switch proof is redacted boolean evidence only; it does not expose tab ids, URLs, titles, page content, account state, or task success.',
  });
  const serialized = JSON.stringify(proof);
  assert.equal(serialized.includes('private.example.test'), false);
  assert.equal(serialized.includes('Private Foreground'), false);
  assert.equal(serialized.includes('10'), false);
  assert.equal(serialized.includes('20'), false);
});

test('buildReadPageMatrixTargetResult fails when read_page operation target evidence is incomplete', () => {
  const target = buildReadPageMatrixTargetResult(
    {
      openedPublicTestTab: true,
      closeSucceeded: true,
      cleanupPassed: true,
      alignmentPassed: false,
      matrixAlignmentPassed: true,
      redactedReadPage: {
        alignment: {
          operationTargetBriefPresent: true,
          actionReadinessBriefPresent: true,
        },
        compact: {
          safeTabFacts: {
            operationTargetRole: 'read_target_background_tab',
            operationTargetBasis: 'read_target_differs_from_browser_active_tab',
            operationTargetCanTabrixOperate: true,
            operationTargetOperabilityReason: 'regular_web_page',
            nextRequiredCheck: 'reselect_or_reread_read_target_before_action',
            operationTargetSummaryPresent: true,
            operationTargetClaimBoundaryPresent: true,
            actionReadiness: 'reselect_or_reread_required',
            canProceedToPageLevelCheck: false,
            requiredBeforeAction: 'reselect_or_reread_read_target_before_action',
            actionReadinessSummaryPresent: true,
            actionReadinessClaimBoundaryPresent: true,
          },
        },
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

  assert.equal(target.readPageOperationTarget.shouldReselectBeforeAction, null);
  assert.equal(target.readPageOperationTarget.actionReadinessBriefPresent, true);
  assert.equal(target.readPageOperationTarget.relationConsistentWithBrowserWorld, true);
  assert.equal(target.passed, false);
});

test('buildReadPageMatrixTargetResult fails when read_page action readiness evidence is missing', () => {
  const target = buildReadPageMatrixTargetResult(
    {
      openedPublicTestTab: true,
      closeSucceeded: true,
      cleanupPassed: true,
      alignmentPassed: false,
      matrixAlignmentPassed: true,
      redactedReadPage: {
        alignment: {
          operationTargetBriefPresent: true,
          actionReadinessBriefPresent: false,
        },
        compact: {
          safeTabFacts: {
            operationTargetRole: 'read_target_background_tab',
            operationTargetBasis: 'read_target_differs_from_browser_active_tab',
            operationTargetCanTabrixOperate: true,
            operationTargetOperabilityReason: 'regular_web_page',
            shouldReselectBeforeAction: true,
            nextRequiredCheck: 'reselect_or_reread_read_target_before_action',
            operationTargetSummaryPresent: true,
            operationTargetClaimBoundaryPresent: true,
          },
        },
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

  assert.equal(target.readPageOperationTarget.actionReadinessBriefPresent, false);
  assert.equal(target.readPageOperationTarget.relationConsistentWithBrowserWorld, true);
  assert.equal(target.passed, false);
});

test('buildReadPageMatrixTargetResult fails when read_page and browserWorld disagree on target relation', () => {
  const target = buildReadPageMatrixTargetResult(
    {
      openedPublicTestTab: true,
      closeSucceeded: true,
      cleanupPassed: true,
      alignmentPassed: true,
      matrixAlignmentPassed: true,
      redactedReadPage: {
        alignment: {
          operationTargetBriefPresent: true,
          actionReadinessBriefPresent: true,
        },
        compact: {
          safeTabFacts: {
            operationTargetRole: 'read_target_browser_active_tab',
            operationTargetBasis: 'read_target_matches_browser_active_tab',
            operationTargetCanTabrixOperate: true,
            operationTargetOperabilityReason: 'regular_web_page',
            shouldReselectBeforeAction: false,
            nextRequiredCheck: 'page_level_content_or_postcondition_check',
            operationTargetSummaryPresent: true,
            operationTargetClaimBoundaryPresent: true,
            actionReadiness: 'ready_for_page_level_check',
            canProceedToPageLevelCheck: true,
            requiredBeforeAction: 'page_level_content_or_postcondition_check',
            actionReadinessSummaryPresent: true,
            actionReadinessClaimBoundaryPresent: true,
          },
        },
        pageRegionRuntime: {
          pageRegionsPresent: true,
          pageOperationMapPresent: true,
        },
        runtime: {
          currentTabIdPresent: true,
          currentTabIdMatchesTarget: true,
          isCurrentTabActive: true,
          isReadTargetBrowserActiveTab: true,
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

  assert.equal(target.readPageOperationTarget.relationConsistentWithBrowserWorld, false);
  assert.equal(target.passed, false);
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
  const lifecycleResult = {
    openedPublicTestTabs: 3,
    closeSucceeded: true,
    cleanupTargetsPassed: true,
    allLifecycleStepsPassed: true,
    activeSwitchProof: {
      browserActiveChangedToTarget: true,
      afterLatestAiOperatedIsTo: true,
      afterLatestAiOperationIsSwitchTab: true,
    },
    publicLifecycleCoverage: {
      minimumPublicLifecycleCoveragePassed: true,
    },
    postCleanup: {
      retentionWithinLimit: true,
      compactSummaryBounded: true,
      browserObjectEdgeSummaryPresent: true,
      currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
      tabLifecycleState: { recentRemovedCount: 3 },
    },
  };
  assert.equal(isSmokeResultPassing(lifecycleResult), true);
  assert.equal(
    isSmokeResultPassing({
      ...lifecycleResult,
      activeSwitchProof: {
        ...lifecycleResult.activeSwitchProof,
        browserActiveChangedToTarget: false,
      },
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      ...lifecycleResult,
      postCleanup: {
        ...lifecycleResult.postCleanup,
        currentTabAttributeGroups: null,
      },
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      ...lifecycleResult,
      postCleanup: {
        ...lifecycleResult.postCleanup,
        tabLifecycleState: { recentRemovedCount: 2 },
      },
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state',
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        retentionWithinLimit: true,
        compactSummaryBounded: true,
        retentionPolicy: {
          eventPrivacyBoundaryPresent: true,
          detailBoundaryPresent: true,
        },
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        objectInventoryPresent: true,
        browserObjectSnapshotConclusionPresent: true,
        browserObjectEdgeSummaryPresent: true,
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    }),
    true,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state',
      verdict: 'WINDOW_STATE_OBSERVED',
      redacted: {
        retentionWithinLimit: false,
        compactSummaryBounded: true,
        retentionPolicy: {
          eventPrivacyBoundaryPresent: true,
          detailBoundaryPresent: true,
        },
        refreshHealth: {
          lastRefreshDecision: 'full_chrome_resync',
        },
        objectInventoryPresent: true,
        browserObjectSnapshotConclusionPresent: true,
        browserObjectEdgeSummaryPresent: true,
        currentTabAttributeGroups: redactedCurrentTabAttributeGroups(),
        tabAttributeGroupClaimBoundaryPresent: true,
        aiActionReadiness: redactedAiActionReadiness(),
        windowLifecycleState: redactedWindowLifecycleState(),
        windowLifecycleConclusionPresent: true,
      },
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state',
      verdict: 'WINDOW_STATE_OBSERVED',
    }),
    false,
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
      driftSummary: {
        allSamplesCompactBounded: true,
        allSamplesRetentionBounded: true,
        allSamplesPrivacyBoundariesPresent: true,
        allSamplesRefreshHealthPresent: true,
        allSamplesCurrentTabStateAccountedFor: true,
        allSamplesAiActionReadinessPresent: true,
        allSamplesWindowLifecyclePresent: true,
        refreshThrottleProof: { proofSatisfied: true },
        observerStabilityProof: { proofSatisfied: true },
      },
      verdict: 'WINDOW_STATE_REPEATED_OBSERVER_PASS',
    }),
    true,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state-drift',
      driftSummary: {
        allSamplesCompactBounded: true,
        allSamplesRetentionBounded: true,
        allSamplesPrivacyBoundariesPresent: true,
        allSamplesRefreshHealthPresent: true,
        allSamplesCurrentTabStateAccountedFor: true,
        allSamplesAiActionReadinessPresent: true,
        allSamplesWindowLifecyclePresent: true,
        refreshThrottleProof: { proofSatisfied: false },
        observerStabilityProof: { proofSatisfied: false },
      },
      verdict: 'WINDOW_STATE_REPEATED_OBSERVER_PASS',
    }),
    false,
  );
  assert.equal(
    isSmokeResultPassing({
      scenario: 'window-state-drift',
      driftSummary: {
        allSamplesCompactBounded: true,
        allSamplesRetentionBounded: true,
        allSamplesRefreshHealthPresent: true,
        allSamplesCurrentTabStateAccountedFor: false,
        allSamplesWindowLifecyclePresent: true,
        refreshThrottleProof: { proofSatisfied: true },
      },
      verdict: 'WINDOW_STATE_REPEATED_OBSERVER_PASS',
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

test('parseArgs supports read-page background target scenario', () => {
  assert.equal(
    parseArgs(['--scenario', 'read-page-background-target']).scenario,
    'read-page-background-target',
  );
});

test('parseArgs supports lifecycle ownership mix scenario', () => {
  assert.equal(
    parseArgs(['--scenario', 'lifecycle-ownership-mix']).scenario,
    'lifecycle-ownership-mix',
  );
});

test('parseArgs supports page opener ownership scenario', () => {
  assert.equal(
    parseArgs(['--scenario', 'page-opener-ownership']).scenario,
    'page-opener-ownership',
  );
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
