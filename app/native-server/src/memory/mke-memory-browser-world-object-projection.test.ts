import { describe, expect, it } from '@jest/globals';
import type { BrowserObjectInput } from './db';
import { recordBrowserWorldObjects } from './mke-memory-browser-world-object-projection';

function collectBrowserWorldObjects(payload: Record<string, unknown>): BrowserObjectInput[] {
  const objects: BrowserObjectInput[] = [];
  recordBrowserWorldObjects({
    trace: { traceId: 'trace-1', sourceRoute: 'chrome_windows_get_all' },
    payload,
    observedAt: '2026-06-28T00:00:00.000Z',
    browserContextKey: 'ctx-1',
    redactionState: 'redacted',
    upsertBrowserObject: (objectInput) => {
      objects.push(objectInput);
      return undefined;
    },
  });
  return objects;
}

describe('recordBrowserWorldObjects', () => {
  it('projects AI run claim metadata for open background tabs', () => {
    const objects = collectBrowserWorldObjects({
      browserWorld: {
        status: 'fresh',
        windows: [],
        tabs: [
          {
            tabId: 101,
            windowId: 10,
            url: 'https://example.com/search?q=private',
            title: 'Example Search',
            active: false,
            status: 'complete',
            canTabrixOperate: true,
            ownerType: 'run_owned',
            aiRunId: 'run-101',
            aiClaimId: 'claim-101',
            aiClaimState: 'claimed',
            aiClaimedAtMs: 1000,
            aiClaimReason: 'background_navigation_claim',
          },
        ],
      },
    });

    const tabObject = objects.find((object) => object.objectType === 'tab');

    expect(tabObject?.ownerType).toBe('ai');
    expect(tabObject?.facts).toMatchObject({
      aiRunId: 'run-101',
      aiClaimId: 'claim-101',
      aiClaimState: 'claimed',
      aiClaimedAtMs: 1000,
      aiClaimReason: 'background_navigation_claim',
    });
    expect(tabObject?.currentState).toMatchObject({
      aiRunId: 'run-101',
      aiClaimId: 'claim-101',
      aiClaimState: 'claimed',
    });
    expect(JSON.stringify(tabObject)).not.toContain('q=private');
  });

  it('projects finalized AI run claim metadata for recently closed tabs', () => {
    const objects = collectBrowserWorldObjects({
      browserWorld: {
        status: 'fresh',
        windows: [],
        tabs: [],
        recentActivityLedger: {
          latestPageClosed: {
            tabId: 102,
            windowId: 10,
            url: 'https://example.com/details?token=private',
            title: 'Example Details',
            occurredAtMs: 10000,
            openedBy: 'run_owned',
            evidence: 'closed',
            aiRunId: 'run-102',
            aiClaimId: 'claim-102',
            aiClaimState: 'finalized',
            aiClaimedAtMs: 9000,
            aiFinalizedAtMs: 10000,
            aiClaimReason: 'chrome_close_tabs_cleanup',
          },
        },
      },
    });

    const tabObject = objects.find((object) => object.objectType === 'tab');

    expect(tabObject?.ownerType).toBe('ai');
    expect(tabObject?.lifecycleState).toBe('closed');
    expect(tabObject?.facts).toMatchObject({
      aiRunId: 'run-102',
      aiClaimId: 'claim-102',
      aiClaimState: 'finalized',
      aiFinalizedAtMs: 10000,
      aiClaimReason: 'chrome_close_tabs_cleanup',
    });
    expect(tabObject?.currentState).toMatchObject({
      aiRunId: 'run-102',
      aiClaimId: 'claim-102',
      aiClaimState: 'finalized',
    });
    expect(JSON.stringify(tabObject)).not.toContain('token=private');
  });
});
