import { describe, expect, it } from 'vitest';
import {
  buildNavigateUrlPatterns,
  buildNavigationPostActionDelta,
} from '../entrypoints/background/tools/browser/common';

describe('buildNavigateUrlPatterns', () => {
  it('does not add www variants for localhost', () => {
    const patterns = buildNavigateUrlPatterns('http://localhost:12306/demo');

    expect(patterns).toContain('http://localhost:12306/*');
    expect(patterns).not.toContain('http://www.localhost:12306/*');
  });

  it('does not add www variants for IPv4 hosts', () => {
    const patterns = buildNavigateUrlPatterns('http://127.0.0.1:8080/demo');

    expect(patterns).toContain('http://127.0.0.1:8080/*');
    expect(patterns).not.toContain('http://www.127.0.0.1:8080/*');
  });

  it('does not add www variants for private IPv4 with high port (issue #270)', () => {
    const patterns = buildNavigateUrlPatterns('https://192.168.0.1:4430/');

    expect(patterns).toContain('https://192.168.0.1:4430/*');
    expect(patterns).not.toContain('https://www.192.168.0.1:4430/*');
  });

  it('does not add www variants for IPv6 hosts', () => {
    const patterns = buildNavigateUrlPatterns('http://[::1]:8080/demo');

    expect(patterns).toContain('http://[::1]:8080/*');
    expect(patterns).not.toContain('http://www.[::1]:8080/*');
  });

  it('still adds www variants for normal hostnames', () => {
    const patterns = buildNavigateUrlPatterns('https://example.com/docs');

    expect(patterns).toContain('https://example.com/*');
    expect(patterns).toContain('https://www.example.com/*');
    expect(patterns).toContain('http://example.com/*');
    expect(patterns).toContain('http://www.example.com/*');
  });
});

describe('buildNavigationPostActionDelta', () => {
  it('describes same-tab navigation without proving business success', () => {
    const delta = buildNavigationPostActionDelta({
      actionId: 'navigate-existing-1',
      actionKind: 'navigate_existing_tab',
      tabId: 42,
      previousUrl: 'https://example.com/search?q=old',
      finalUrl: 'https://example.com/search?q=new',
      settled: true,
    });

    expect(delta).toMatchObject({
      deltaKind: 'post_action_tool_delta',
      actionId: 'navigate-existing-1',
      actionKind: 'navigate_existing_tab',
      tabId: 42,
      observedOutcome: 'url_changed',
      changed: true,
      changedSignals: ['url_changed'],
      urlDelta: 'same_origin',
      readbackStatus: 'fresh_read_required',
      recommendation: 'run_chrome_read_page_force_refresh_same_tab',
      businessSuccessProven: false,
    });
    expect(delta.claimBoundary.join(' ')).toContain('not AI business evaluation');
  });

  it('marks new tab navigation as fresh-read evidence and never as a reusable coordinate', () => {
    const delta = buildNavigationPostActionDelta({
      actionId: 'navigate-new-tab-1',
      actionKind: 'navigate_new_tab',
      tabId: 77,
      finalUrl: 'https://example.com/results',
      newTabOpened: true,
      settled: false,
    });

    expect(delta).toMatchObject({
      observedOutcome: 'new_tab_opened',
      changed: true,
      changedSignals: ['new_tab_opened', 'navigation_unsettled'],
      urlDelta: 'unavailable',
      readbackStatus: 'navigation_unsettled',
      businessSuccessProven: false,
    });
    expect(delta.targetRef).toBeNull();
    expect(delta).not.toHaveProperty('x');
    expect(delta).not.toHaveProperty('y');
  });
});
