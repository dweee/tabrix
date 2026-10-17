import { describe, expect, it } from 'vitest';
import {
  buildReadPageObjectDeltaSignals,
  buildReadPageObjectSensingInput,
} from '../entrypoints/background/tools/browser/read-page-object-sensing-input';
import type { ReadPageLoadReadiness } from '@tabrix/shared';

const loadReadiness: ReadPageLoadReadiness = {
  status: 'ready',
  ready: true,
  reason: 'test_ready',
  waitMs: 0,
  observedSignals: [],
  cdpSensing: {
    source: 'cdp',
    available: true,
    readiness: 'complete',
    likelyLoading: false,
    stabilityHint: 'stable',
    networkActivity: {
      requestStartedCount: 7,
      inFlightCount: 1,
      failedRequestCount: 2,
    },
    console: {
      errorCount: 3,
      warningCount: 4,
    },
    route: {
      href: 'https://example.test/search?q=redacted',
      pathname: '/search',
      hasQuery: true,
      hasHash: false,
      fingerprint: 'route:search',
      historyLength: 5,
    },
  },
};

describe('read page object sensing input', () => {
  it('normalizes object sensing inputs without changing the public read_page contract', () => {
    const input = buildReadPageObjectSensingInput({
      tabId: 12,
      currentUrl: 'https://example.test/search',
      currentTitle: 'Search',
      cdpSensing: loadReadiness.cdpSensing,
      pageRegions: undefined as never,
      candidateActions: undefined as never,
      pageType: 'search_page',
      pageRole: '',
      pageStability: 'stable',
      loadReadiness,
      visibleTextContent: 'Search results',
    });

    expect(input.pageRegions).toEqual([]);
    expect(input.candidateActions).toEqual([]);
    expect(input.pageRole).toBe('unknown');
  });

  it('projects CDP route, network, and console signals once for delta and cache users', () => {
    const input = buildReadPageObjectSensingInput({
      tabId: 12,
      currentUrl: 'https://example.test/search',
      currentTitle: 'Search',
      cdpSensing: loadReadiness.cdpSensing,
      pageRegions: [],
      candidateActions: [],
      pageType: 'search_page',
      pageRole: 'search_results',
      pageStability: 'stable',
      loadReadiness,
      visibleTextContent: 'Search results',
    });

    expect(buildReadPageObjectDeltaSignals(input)).toEqual({
      networkStartedCount: 7,
      networkInFlightCount: 1,
      failedRequestCount: 2,
      errorCount: 3,
      warningCount: 4,
      routeFingerprint:
        'https://example.test/search?q=redacted|/search|query|no_hash|route:search|history:5',
    });
  });
});
