import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHttpUrl,
  buildPublicSmokeUrl,
  buildRedactedBrowserWorldSummary,
  buildRedactedReadPageAlignmentSummary,
  extractJsonObject,
  extractNavigateTabId,
  parseArgs,
  resolveSmokeUrls,
} from './mcp-redacted-browser-world-smoke.mjs';

test('extractJsonObject parses the bounded CLI Result payload', () => {
  const parsed = extractJsonObject('tabrix mcp call get_windows_and_tabs\n\nResult\n{"ok":true}\n');
  assert.deepEqual(parsed, { ok: true });
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
          url: 'https://private.example.test/dashboard',
          title: 'Private Dashboard',
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
          eventPrivacyBoundary:
            'Recent browser lifecycle events retain ids only and do not retain https://private.example.test/dashboard.',
          detailBoundary: 'Detailed objects may include Private Dashboard titles.',
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
    eventPrivacyBoundaryPresent: true,
    detailBoundaryPresent: true,
  });
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
        currentTabCanTabrixOperate: true,
        currentTabRuntimeStateSource: 'browser_world_inventory',
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
            isRunOwnedByTask: false,
            runtimeStateSource: 'browser_world_inventory',
          },
          page: {
            pageText: 'confidential visible page text',
          },
        },
        operationSummary: 'Click the private billing button',
        evidenceSummary: 'Private Dashboard title observed',
        claimBoundary: 'raw claim',
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
    targetTabMatchesReadPage: true,
    readTargetIsBrowserActive: true,
    tabOwnerIsAi: true,
    tabOperable: true,
  });
  assert.equal(summary.compact.hasTabPageObjectSummary, true);
  assert.deepEqual(summary.compact.safeTabFacts, {
    readTargetTabId: 42,
    currentActiveTabId: 42,
    browserActiveTabId: 42,
    openedBy: 'ai',
    isRunOwnedByTask: false,
    runtimeStateSource: 'browser_world_inventory',
  });
});

test('parseArgs supports observer-only window-state scenario', () => {
  assert.equal(parseArgs(['--scenario', 'window-state']).scenario, 'window-state');
});

test('parseArgs supports read-page scenario', () => {
  assert.equal(parseArgs(['--scenario', 'read-page']).scenario, 'read-page');
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
