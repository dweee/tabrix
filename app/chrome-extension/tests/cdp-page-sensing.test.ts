import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendCommandMock, withSessionMock } = vi.hoisted(() => ({
  sendCommandMock: vi.fn(),
  withSessionMock: vi.fn(),
}));
const { addEventListenerMock, removeEventListenerMock } = vi.hoisted(() => ({
  addEventListenerMock: vi.fn(),
  removeEventListenerMock: vi.fn(),
}));

vi.mock('@/utils/cdp-session-manager', () => ({
  cdpSessionManager: {
    sendCommand: sendCommandMock,
    withSession: withSessionMock,
    addEventListener: addEventListenerMock,
    removeEventListener: removeEventListenerMock,
  },
}));

import { captureCDPPageSensingSnapshot } from '@/utils/cdp-page-sensing';

describe('CDP page sensing snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(new Date('2026-06-13T10:00:00.000Z'));
    withSessionMock.mockImplementation(
      async (_tabId: number, _owner: string, fn: () => unknown) => {
        return await fn();
      },
    );
  });

  it('captures privacy-safe page state through the central CDP session manager', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              visibilityState: 'visible',
              focused: true,
              url: 'https://user:pass@app.example.test/search/results?q=private-token#secret',
              title: 'Search Results',
              activeElement: {
                tagName: 'INPUT',
                type: 'search',
                role: 'searchbox',
                idPresent: true,
                namePresent: true,
              },
              navigation: {
                type: 'navigate',
                responseEndMs: 42.4,
                domContentLoadedMs: 83.6,
                loadEventMs: 120.2,
              },
              networkResources: {
                resourceEntryCount: 19,
                resourceInFlightCount: 4,
                failedResourceStatusCount: 2,
              },
            },
          },
        };
      }
      if (method === 'Page.getFrameTree') {
        return {
          frameTree: {
            frame: {
              url: 'https://app.example.test/search/results?q=private-token#secret',
            },
            childFrames: [{ frame: { url: 'https://cdn.example.test/embed' } }],
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              role: { value: 'button' },
              name: { value: 'Search submit' },
              properties: [{ name: 'checked', value: { value: false } }],
              actions: [{ name: 'click' }],
            },
            {
              role: { value: 'checkbox' },
              name: { value: 'Only free options' },
              properties: [{ name: 'checked', value: { value: true } }],
              actions: [{ name: 'click' }],
            },
            {
              role: { value: 'img' },
              name: { value: 'Decorative icon' },
            },
            {
              role: { value: 'link' },
              name: { value: 'Result card' },
              properties: [{ name: 'selected', value: { value: true } }],
              actions: [{ name: 'click' }],
            },
            {
              role: { value: 'textbox' },
              name: { value: 'Search box' },
              properties: [{ name: 'disabled', value: { value: true } }],
            },
          ],
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(77);
    const blob = JSON.stringify(snapshot);

    expect(withSessionMock).toHaveBeenCalledWith(77, 'page-sensing', expect.any(Function));
    expect(sendCommandMock.mock.calls.map((call) => call[1])).toEqual([
      'Runtime.enable',
      'Page.enable',
      'Network.enable',
      'Log.enable',
      'Accessibility.enable',
      'Runtime.evaluate',
      'Page.getFrameTree',
      'Accessibility.getFullAXTree',
    ]);
    expect(addEventListenerMock).toHaveBeenCalledTimes(1);
    expect(removeEventListenerMock).toHaveBeenCalledTimes(1);
    expect(snapshot).toMatchObject({
      tabId: 77,
      capturedAt: Date.parse('2026-06-13T10:00:00.000Z'),
      source: 'cdp',
      available: true,
      readiness: 'complete',
      likelyLoading: false,
      title: 'Search Results',
      visibilityState: 'visible',
      focused: true,
      frameCount: 2,
      url: {
        href: 'https://app.example.test/search/results',
        host: 'app.example.test',
        pathname: '/search/results',
        hasQuery: true,
        hasHash: true,
      },
      activeElement: {
        tagName: 'INPUT',
        type: 'search',
        role: 'searchbox',
        idPresent: true,
        namePresent: true,
      },
      navigation: {
        type: 'navigate',
        responseEndMs: 42,
        domContentLoadedMs: 84,
        loadEventMs: 120,
      },
      networkResources: {
        resourceEntryCount: 19,
        resourceInFlightCount: 4,
        failedResourceStatusCount: 2,
      },
      networkActivity: {
        requestStartedCount: 0,
        inFlightCount: 0,
        failedRequestCount: 0,
      },
      accessibility: {
        totalNodes: 5,
        actionableNodeCount: 4,
        actionableRoleTop: [
          { role: 'button', count: 1 },
          { role: 'checkbox', count: 1 },
          { role: 'link', count: 1 },
          { role: 'textbox', count: 1 },
        ],
        actionableSampleLabels: ['Search submit', 'Only free options', 'Result card', 'Search box'],
        stateSignals: {
          checkedCount: 1,
          selectedCount: 1,
          expandedCount: 0,
          disabledCount: 1,
        },
        objectCandidates: [
          {
            role: 'button',
            label: 'Search submit',
            actionTypes: ['click'],
            state: {
              checked: false,
            },
          },
          {
            role: 'checkbox',
            label: 'Only free options',
            actionTypes: ['click'],
            state: {
              checked: true,
            },
          },
          {
            role: 'link',
            label: 'Result card',
            actionTypes: ['click'],
            state: {
              selected: true,
            },
          },
          {
            role: 'textbox',
            label: 'Search box',
            actionTypes: [],
            state: {
              disabled: true,
            },
          },
        ],
      },
      console: {
        errorCount: 0,
        warningCount: 0,
      },
    });
    expect(blob).not.toContain('private-token');
    expect(blob).not.toContain('user:pass');
    expect(blob).not.toContain('secret');
  });

  it('marks interactive pages with no load event as still likely loading', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'interactive',
              visibilityState: 'visible',
              focused: false,
              url: 'https://docs.example.test/guide',
              title: 'Guide',
              navigation: {
                type: 'navigate',
                responseEndMs: 18,
                domContentLoadedMs: 38,
                loadEventMs: null,
              },
            },
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(12);

    expect(snapshot).toMatchObject({
      available: true,
      readiness: 'interactive',
      likelyLoading: true,
      focused: false,
      url: {
        href: 'https://docs.example.test/guide',
        hasQuery: false,
        hasHash: false,
      },
    });
  });

  it('returns an unavailable snapshot instead of throwing when CDP cannot attach', async () => {
    withSessionMock.mockRejectedValue(new Error('Debugger is already attached by DevTools'));

    const snapshot = await captureCDPPageSensingSnapshot(45);

    expect(snapshot).toMatchObject({
      tabId: 45,
      available: false,
      readiness: 'unknown',
      likelyLoading: false,
      error: 'Debugger is already attached by DevTools',
    });
  });

  it('does not expose local file paths from browser-internal page sensing', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'file:///C:/Users/name/private-report.html?token=abc#section',
              title: 'Private local report',
            },
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(91);
    const blob = JSON.stringify(snapshot);

    expect(snapshot.url).toMatchObject({
      href: 'file://local-file',
      scheme: 'file',
      hasQuery: true,
      hasHash: true,
    });
    expect(blob).not.toContain('Users');
    expect(blob).not.toContain('private-report');
    expect(blob).not.toContain('token=abc');
  });
});
