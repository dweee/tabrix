import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertPublicHttpUrl,
  buildRedactedBrowserWorldSummary,
  extractJsonObject,
  extractNavigateTabId,
  parseArgs,
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

test('parseArgs supports safe smoke switches', () => {
  assert.deepEqual(parseArgs(['--url', 'https://example.org/', '--keep-open', '--skip-open']), {
    url: 'https://example.org/',
    keepOpen: true,
    skipOpen: true,
    timeoutMs: 60_000,
  });
});
