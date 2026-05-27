import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHttpUrl,
  buildPublicSmokeUrl,
  buildRedactedBrowserWorldSummary,
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
