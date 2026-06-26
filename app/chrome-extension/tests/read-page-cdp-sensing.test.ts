import { describe, expect, it } from 'vitest';

import { buildReadPageCDPSensingSummary } from '../entrypoints/background/tools/browser/read-page-cdp-sensing';
import type { CDPPageSensingSnapshot } from '../utils/cdp-page-sensing';

function snapshot(overrides: Partial<CDPPageSensingSnapshot> = {}): CDPPageSensingSnapshot {
  return {
    tabId: 101,
    capturedAt: 1_700_000_000_000,
    source: 'cdp',
    available: true,
    readiness: 'complete',
    likelyLoading: false,
    stabilityHint: 'stable',
    ...overrides,
  };
}

describe('read_page CDP sensing summary', () => {
  it('omits unavailable snapshots instead of inventing sensing facts', () => {
    expect(buildReadPageCDPSensingSummary(snapshot({ available: false }))).toBeUndefined();
  });

  it('keeps a compact read-only claim boundary and selected safe signals', () => {
    const summary = buildReadPageCDPSensingSummary(
      snapshot({
        route: {
          href: 'https://example.test/search',
          pathname: '/search',
          hasQuery: true,
          hasHash: false,
          fingerprint: 'route_search',
          historyLength: 3,
        },
        visibilityState: 'visible',
        focused: true,
        frameCount: 2,
        networkActivity: {
          requestStartedCount: 4,
          inFlightCount: 0,
          failedRequestCount: 1,
        },
        networkResources: {
          resourceEntryCount: 12,
          resourceInFlightCount: 0,
          failedResourceStatusCount: 1,
        },
        console: {
          errorCount: 1,
          warningCount: 2,
        },
        partialErrors: ['frame_tree_unavailable'],
      }),
    );

    expect(summary).toMatchObject({
      source: 'cdp_page_sensing',
      available: true,
      readiness: 'complete',
      likelyLoading: false,
      visibilityState: 'visible',
      focused: true,
      frameCount: 2,
      networkActivity: {
        requestStartedCount: 4,
        inFlightCount: 0,
        failedRequestCount: 1,
      },
      console: {
        errorCount: 1,
        warningCount: 2,
      },
      partialErrors: ['frame_tree_unavailable'],
    });
    expect(summary?.claimBoundary).toContain('read-only browser state evidence');
  });

  it('does not expose raw page href/title fields from the CDP snapshot', () => {
    const summary = buildReadPageCDPSensingSummary(
      snapshot({
        url: {
          href: 'https://example.test/account?token=secret#private',
          origin: 'https://example.test',
          host: 'example.test',
          pathname: '/account',
          scheme: 'https',
          hasQuery: true,
          hasHash: true,
        },
        title: 'Private account title',
      }),
    );

    expect(summary).not.toHaveProperty('url');
    expect(summary).not.toHaveProperty('title');
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(JSON.stringify(summary)).not.toContain('Private account title');
  });
});
