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

import { captureCDPPageSensingSnapshot, probeNodeVisibility } from '@/utils/cdp-page-sensing';

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
              route: {
                url: 'https://app.example.test/search/results?q=private-token#secret',
                historyLength: 7,
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
      stabilityHint: 'stable',
      title: 'Search Results',
      route: {
        href: 'https://app.example.test/search/results',
        pathname: '/search/results',
        hasQuery: true,
        hasHash: true,
        fingerprint: expect.stringMatching(/^route_[0-9a-f]{8}$/),
        historyLength: 7,
      },
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

  it('sends a browser-executable JavaScript page-state probe', async () => {
    let expression = '';
    sendCommandMock.mockImplementation(async (_tabId: number, method: string, params?: any) => {
      if (method === 'Runtime.evaluate') {
        expression = String(params?.expression || '');
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/',
              title: 'Example',
            },
          },
        };
      }
      return {};
    });

    await captureCDPPageSensingSnapshot(82);

    expect(expression).not.toBe('');
    expect(() => new Function(expression)).not.toThrow();
  });

  it('keeps privacy-safe AX locators and does not merge distinct same-label nodes', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/search',
              title: 'Search',
            },
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              nodeId: 'ax-search-hidden',
              backendDOMNodeId: 101,
              role: { value: 'textbox' },
              name: { value: 'Search' },
              value: { value: 'private query' },
              description: { value: 'private description' },
              actions: [{ name: 'focus' }],
            },
            {
              nodeId: 'ax-search-visible',
              backendDOMNodeId: 102,
              role: { value: 'textbox' },
              name: { value: 'Search' },
              value: { value: 'private query' },
              description: { value: 'private description' },
              actions: [{ name: 'focus' }],
            },
            {
              nodeId: 'ax-negative',
              backendDOMNodeId: -1,
              role: { value: 'button' },
              name: { value: 'Run' },
              actions: [{ name: 'click' }],
            },
          ],
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(78);
    const blob = JSON.stringify(snapshot);

    expect(snapshot.accessibility?.objectCandidates).toEqual([
      {
        role: 'textbox',
        label: 'Search',
        locator: {
          source: 'cdp_ax',
          axNodeId: 'ax-search-hidden',
          backendDOMNodeId: 101,
        },
        actionTypes: ['focus'],
        state: {},
      },
      {
        role: 'textbox',
        label: 'Search',
        locator: {
          source: 'cdp_ax',
          axNodeId: 'ax-search-visible',
          backendDOMNodeId: 102,
        },
        actionTypes: ['focus'],
        state: {},
      },
      {
        role: 'button',
        label: 'Run',
        locator: {
          source: 'cdp_ax',
          axNodeId: 'ax-negative',
        },
        actionTypes: ['click'],
        state: {},
      },
    ]);
    expect(snapshot.accessibility?.locatorCoverage).toEqual({
      locatorCandidateCount: 3,
      axNodeIdCount: 3,
      backendDOMNodeIdCount: 2,
      locatorCoverageRate: 1,
    });
    expect(blob).not.toContain('private query');
    expect(blob).not.toContain('private description');
  });

  it('objectizes a visible unique DOM search control when AX omits it', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/explore',
              title: 'Explore',
              visibleFormControls: [
                {
                  role: 'searchbox',
                  label: 'Search',
                  cssSelector: '#global-search',
                  nodeName: 'input',
                  actionTypes: ['focus', 'setvalue'],
                  disabled: false,
                  valueState: 'empty',
                  visualBounds: { x: 240, y: 12, width: 420, height: 40 },
                  visibilityProbe: {
                    domVisible: true,
                    inViewport: true,
                    centerHitTarget: true,
                    occluded: false,
                    valueState: 'empty',
                    reason: 'visible_unobstructed',
                  },
                },
                {
                  role: 'button',
                  label: 'search submit',
                  cssSelector: 'div.search-submit',
                  nodeName: 'div',
                  actionTypes: ['click'],
                  disabled: false,
                  valueState: 'unknown',
                  visualBounds: { x: 620, y: 12, width: 40, height: 40 },
                  visibilityProbe: {
                    domVisible: true,
                    inViewport: true,
                    centerHitTarget: true,
                    occluded: false,
                    valueState: 'unknown',
                    reason: 'visible_unobstructed',
                  },
                },
              ],
            },
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: Array.from({ length: 32 }, (_, index) => ({
            nodeId: `ax-result-${index}`,
            backendDOMNodeId: 801 + index,
            role: { value: 'link' },
            name: { value: `Detailed result candidate ${index}` },
            actions: [{ name: 'click' }],
          })),
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(81);

    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'searchbox',
          label: 'Search',
          locator: {
            source: 'cdp_dom',
            cssSelector: '#global-search',
            nodeName: 'input',
            visualBounds: { x: 240, y: 12, width: 420, height: 40 },
          },
          actionTypes: ['focus', 'setvalue'],
          state: { disabled: false },
          visibilityProbe: expect.objectContaining({
            domVisible: true,
            inViewport: true,
            centerHitTarget: true,
            occluded: false,
            valueState: 'empty',
          }),
        }),
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
          locator: {
            source: 'cdp_dom',
            cssSelector: 'div.search-submit',
            nodeName: 'div',
            visualBounds: { x: 620, y: 12, width: 40, height: 40 },
          },
          actionTypes: ['click'],
          state: { disabled: false },
        }),
      ]),
    );
  });

  it('keeps a DOM-disabled control non-actionable when AX reports it as clickable', async () => {
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: {
                readyState: 'complete',
                url: 'https://app.example.test/search',
                title: 'Search',
                visibleFormControls: [
                  {
                    role: 'button',
                    label: 'Search',
                    cssSelector: 'button[aria-label="Search"]',
                    nodeName: 'button',
                    actionTypes: [],
                    disabled: true,
                    valueState: 'unknown',
                    visualBounds: { x: 620, y: 12, width: 40, height: 40 },
                    visibilityProbe: {
                      domVisible: true,
                      inViewport: true,
                      centerHitTarget: true,
                      occluded: false,
                      valueState: 'unknown',
                      reason: 'visible_unobstructed',
                    },
                  },
                ],
              },
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') {
          return {
            nodes: [
              {
                nodeId: 'ax-search-submit',
                backendDOMNodeId: 901,
                role: { value: 'button' },
                name: { value: 'Search' },
                properties: [{ name: 'disabled', value: { value: false } }],
                actions: [{ name: 'click' }],
              },
            ],
          };
        }
        if (method === 'DOM.describeNode' && params?.backendNodeId === 901) {
          return {
            node: {
              nodeName: 'BUTTON',
              localName: 'button',
              attributes: ['aria-label', 'Search'],
            },
          };
        }
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(81);

    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'Search',
          actionTypes: [],
          state: expect.objectContaining({ disabled: true }),
          locator: expect.objectContaining({
            source: 'cdp_ax',
            cssSelector: 'button[aria-label="Search"]',
          }),
        }),
      ]),
    );
  });

  it('anchors a duplicated icon-only submit control to its unique visible search input', async () => {
    document.body.innerHTML = `
      <div class="page-shell">
        <div class="textarea-container">
          <div class="submit-button-wrapper" style="display:none">
            <svg><use href="#search"></use></svg>
          </div>
        </div>
        <div class="textarea-container">
          <textarea id="global-search" name="query"></textarea>
          <div class="bottom-box-right" style="cursor:pointer">
            <div class="utility-control"></div>
            <div class="submit-button-wrapper">
              <svg class="action-icon"><use href="#search"></use></svg>
            </div>
          </div>
        </div>
      </div>
    `;
    const input = document.querySelector('#global-search') as HTMLElement;
    const submit = document.querySelector(
      '#global-search + .bottom-box-right .submit-button-wrapper',
    ) as HTMLElement;
    const icon = submit.querySelector('svg') as SVGElement;
    const use = submit.querySelector('use') as SVGUseElement;
    const outerClickShell = submit.parentElement as HTMLElement;
    const visibleRect = {
      x: 240,
      y: 12,
      left: 240,
      top: 12,
      right: 660,
      bottom: 52,
      width: 420,
      height: 40,
      toJSON: () => ({}),
    };
    const submitRect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    const outerClickShellRect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(visibleRect);
    vi.spyOn(submit, 'getBoundingClientRect').mockReturnValue(submitRect);
    vi.spyOn(outerClickShell, 'getBoundingClientRect').mockReturnValue(outerClickShellRect);
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(submitRect);
    vi.spyOn(use, 'getBoundingClientRect').mockReturnValue(submitRect);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => icon,
    });
    let runtimeProbe: any;
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression || '');
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${expression}`,
          );
          runtimeProbe = evaluate(
            window,
            document,
            { getEntriesByType: () => [] },
            history,
            location,
            { escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&') },
          );
          return {
            result: {
              value: runtimeProbe,
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(82);
    submit.classList.add('disabled');
    const disabledSnapshot = await captureCDPPageSensingSnapshot(82);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(runtimeProbe.visibleFormControls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'search submit',
        }),
      ]),
    );
    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
          locator: expect.objectContaining({
            source: 'cdp_dom',
            cssSelector: expect.stringMatching(
              /div\.textarea-container:has\(#global-search\) div\.submit-button-wrapper$/,
            ),
            visualBounds: expect.objectContaining({
              x: 620,
              width: 32,
            }),
          }),
          actionTypes: ['click'],
          state: { disabled: false },
        }),
      ]),
    );
    expect(disabledSnapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
          actionTypes: [],
          state: { disabled: true },
        }),
      ]),
    );
  });

  it('finds an icon-only submit control in a bounded ancestor search surface', async () => {
    document.body.innerHTML = `
      <main>
        <div class="search-surface">
          <div class="input-branch">
            <div class="input-shell">
              <div class="input-inner">
                <input id="deep-search" type="search" />
              </div>
            </div>
          </div>
          <div class="action-branch">
            <div class="search-action">
              <svg><use href="#search"></use></svg>
            </div>
          </div>
        </div>
      </main>
    `;
    const input = document.querySelector('#deep-search') as HTMLElement;
    const submit = document.querySelector('.search-action') as HTMLElement;
    const icon = submit.querySelector('svg') as SVGElement;
    const use = submit.querySelector('use') as SVGUseElement;
    const inputRect = {
      x: 240,
      y: 12,
      left: 240,
      top: 12,
      right: 660,
      bottom: 52,
      width: 420,
      height: 40,
      toJSON: () => ({}),
    };
    const submitRect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(inputRect);
    vi.spyOn(submit, 'getBoundingClientRect').mockReturnValue(submitRect);
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(submitRect);
    vi.spyOn(use, 'getBoundingClientRect').mockReturnValue(submitRect);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => icon,
    });
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression || '');
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${expression}`,
          );
          return {
            result: {
              value: evaluate(window, document, { getEntriesByType: () => [] }, history, location, {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
              }),
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(82);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
          locator: expect.objectContaining({
            source: 'cdp_dom',
            cssSelector: 'div.search-action',
          }),
          actionTypes: ['click'],
          state: { disabled: false },
        }),
      ]),
    );
  });

  it('does not infer a search submit from a search-clear icon', async () => {
    document.body.innerHTML = `
      <form class="search-surface">
        <input id="clearable-search" type="search" />
        <div class="search-clear" style="cursor:pointer">
          <svg><use href="#search-clear"></use></svg>
        </div>
      </form>
    `;
    const input = document.querySelector('#clearable-search') as HTMLElement;
    const clear = document.querySelector('.search-clear') as HTMLElement;
    const icon = clear.querySelector('svg') as SVGElement;
    const use = clear.querySelector('use') as SVGUseElement;
    const inputRect = {
      x: 240,
      y: 12,
      left: 240,
      top: 12,
      right: 660,
      bottom: 52,
      width: 420,
      height: 40,
      toJSON: () => ({}),
    };
    const clearRect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(inputRect);
    vi.spyOn(clear, 'getBoundingClientRect').mockReturnValue(clearRect);
    vi.spyOn(icon, 'getBoundingClientRect').mockReturnValue(clearRect);
    vi.spyOn(use, 'getBoundingClientRect').mockReturnValue(clearRect);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => (x >= clearRect.left ? icon : input),
    });
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression || '');
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${expression}`,
          );
          return {
            result: {
              value: evaluate(window, document, { getEntriesByType: () => [] }, history, location, {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
              }),
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(83);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'searchbox',
          locator: expect.objectContaining({ cssSelector: '#clearable-search' }),
        }),
      ]),
    );
    expect(snapshot.accessibility?.objectCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
        }),
      ]),
    );
  });

  it('fails closed when two equally ranked visible submit owners share one search surface', async () => {
    document.body.innerHTML = `
      <form class="search-surface">
        <input id="ambiguous-search" type="search" />
        <button id="submit-a" type="submit"><svg><use href="#search"></use></svg></button>
        <button id="submit-b" type="submit"><svg><use href="#search"></use></svg></button>
      </form>
    `;
    const input = document.querySelector('#ambiguous-search') as HTMLElement;
    const submitA = document.querySelector('#submit-a') as HTMLElement;
    const submitB = document.querySelector('#submit-b') as HTMLElement;
    const inputRect = {
      x: 240,
      y: 12,
      left: 240,
      top: 12,
      right: 660,
      bottom: 52,
      width: 420,
      height: 40,
      toJSON: () => ({}),
    };
    const submitARect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    const submitBRect = {
      ...submitARect,
      x: 660,
      left: 660,
      right: 692,
    };
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(inputRect);
    for (const element of [submitA, ...Array.from(submitA.querySelectorAll('svg,use'))]) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(submitARect);
    }
    for (const element of [submitB, ...Array.from(submitB.querySelectorAll('svg,use'))]) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(submitBRect);
    }
    const submitAIcon = submitA.querySelector('svg') as SVGElement;
    const submitBIcon = submitB.querySelector('svg') as SVGElement;
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => {
        if (x >= submitBRect.left) return submitBIcon;
        if (x >= submitARect.left) return submitAIcon;
        return input;
      },
    });
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const expression = String(params?.expression || '');
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${expression}`,
          );
          return {
            result: {
              value: evaluate(window, document, { getEntriesByType: () => [] }, history, location, {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
              }),
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(84);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(snapshot.accessibility?.objectCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
        }),
      ]),
    );
  });

  it('ignores a search submit inferred only from a hidden search input', async () => {
    document.body.innerHTML = `
      <form class="search-surface">
        <input id="hidden-search" type="search" style="display:none" />
        <div class="search-action" style="cursor:pointer">
          <svg><use href="#search"></use></svg>
        </div>
      </form>
    `;
    const submit = document.querySelector('.search-action') as HTMLElement;
    const icon = submit.querySelector('svg') as SVGElement;
    const use = submit.querySelector('use') as SVGUseElement;
    const submitRect = {
      x: 12,
      y: 12,
      left: 12,
      top: 12,
      right: 44,
      bottom: 44,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    for (const element of [submit, icon, use]) {
      vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(submitRect);
    }
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => icon,
    });
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${String(params?.expression || '')}`,
          );
          return {
            result: {
              value: evaluate(window, document, { getEntriesByType: () => [] }, history, location, {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
              }),
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(85);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(snapshot.accessibility?.objectCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
        }),
      ]),
    );
  });

  it('does not use geometry alone to bind an unrelated submit to a search input', async () => {
    document.body.innerHTML = `
      <main>
        <div class="composer">
          <input id="nearby-search" type="search" />
          <button id="publish" type="submit">Publish</button>
        </div>
      </main>
    `;
    const input = document.querySelector('#nearby-search') as HTMLElement;
    const publish = document.querySelector('#publish') as HTMLElement;
    const inputRect = {
      x: 240,
      y: 12,
      left: 240,
      top: 12,
      right: 660,
      bottom: 52,
      width: 420,
      height: 40,
      toJSON: () => ({}),
    };
    const publishRect = {
      x: 620,
      y: 16,
      left: 620,
      top: 16,
      right: 652,
      bottom: 48,
      width: 32,
      height: 32,
      toJSON: () => ({}),
    };
    vi.spyOn(input, 'getBoundingClientRect').mockReturnValue(inputRect);
    vi.spyOn(publish, 'getBoundingClientRect').mockReturnValue(publishRect);
    const originalElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: (x: number) => (x >= publishRect.left ? publish : input),
    });
    sendCommandMock.mockImplementation(
      async (_tabId: number, method: string, params?: Record<string, unknown>) => {
        if (method === 'Runtime.evaluate') {
          const evaluate = new Function(
            'window',
            'document',
            'performance',
            'history',
            'location',
            'CSS',
            `return ${String(params?.expression || '')}`,
          );
          return {
            result: {
              value: evaluate(window, document, { getEntriesByType: () => [] }, history, location, {
                escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
              }),
            },
          };
        }
        if (method === 'Accessibility.getFullAXTree') return { nodes: [] };
        return {};
      },
    );

    const snapshot = await captureCDPPageSensingSnapshot(86);

    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    });
    expect(snapshot.accessibility?.objectCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'searchbox',
          locator: expect.objectContaining({ cssSelector: '#nearby-search' }),
        }),
      ]),
    );
    expect(snapshot.accessibility?.objectCandidates).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'button',
          label: 'search submit',
        }),
      ]),
    );
  });

  it('keeps high-value result objects when utility controls appear first in the AX tree', async () => {
    const utilityNodes = Array.from({ length: 32 }, (_, index) => ({
      nodeId: `ax-utility-${index}`,
      backendDOMNodeId: 300 + index,
      role: { value: index % 2 === 0 ? 'button' : 'link' },
      name: { value: index % 2 === 0 ? 'Menu' : 'Settings' },
      actions: [{ name: 'click' }],
    }));
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://code.example/search?q=browser',
              title: 'Code Search',
            },
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            ...utilityNodes,
            {
              nodeId: 'ax-result-title',
              backendDOMNodeId: 501,
              role: { value: 'link' },
              name: { value: 'owner/repository' },
              actions: [{ name: 'click' }],
            },
            {
              nodeId: 'ax-result-description',
              backendDOMNodeId: 502,
              role: { value: 'link' },
              name: {
                value: 'A browser automation runtime with object perception and memory reuse',
              },
              actions: [{ name: 'click' }],
            },
          ],
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(80);
    const labels = snapshot.accessibility?.objectCandidates.map((candidate) => candidate.label);

    expect(snapshot.accessibility?.actionableNodeCount).toBe(34);
    expect(snapshot.accessibility?.objectCandidates).toHaveLength(24);
    expect(labels?.slice(0, 2)).toEqual([
      'owner/repository',
      'A browser automation runtime with object perception and memory reuse',
    ]);
    expect(labels).toContain('owner/repository');
  });

  it('enriches AX locators with safe DOM selectors from backend node ids', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string, params?: any) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/search',
              title: 'Search',
            },
          },
        };
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              nodeId: 'ax-search',
              backendDOMNodeId: 201,
              role: { value: 'textbox' },
              name: { value: 'Search input' },
              actions: [{ name: 'focus' }],
            },
            {
              nodeId: 'ax-secret',
              backendDOMNodeId: 202,
              role: { value: 'button' },
              name: { value: 'Secret action' },
              actions: [{ name: 'click' }],
            },
          ],
        };
      }
      if (method === 'DOM.describeNode' && params?.backendNodeId === 201) {
        return {
          node: {
            nodeName: 'INPUT',
            localName: 'input',
            attributes: ['type', 'search', 'aria-label', 'Search input'],
          },
        };
      }
      if (method === 'DOM.getBoxModel' && params?.backendNodeId === 201) {
        return {
          model: {
            content: [10, 20, 210, 20, 210, 60, 10, 60],
          },
        };
      }
      if (method === 'DOM.describeNode' && params?.backendNodeId === 202) {
        return {
          node: {
            nodeName: 'BUTTON',
            localName: 'button',
            attributes: ['id', 'secret-token-123', 'aria-label', 'Authorization token'],
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(79);
    const blob = JSON.stringify(snapshot);

    expect(snapshot.accessibility?.objectCandidates).toEqual([
      expect.objectContaining({
        role: 'textbox',
        label: 'Search input',
        locator: expect.objectContaining({
          source: 'cdp_ax',
          axNodeId: 'ax-search',
          backendDOMNodeId: 201,
          nodeName: 'input',
          cssSelector: 'input[aria-label="Search input"]',
          visualBounds: { x: 10, y: 20, width: 200, height: 40 },
        }),
      }),
      expect.objectContaining({
        role: 'button',
        label: 'Secret action',
        locator: expect.objectContaining({
          source: 'cdp_ax',
          axNodeId: 'ax-secret',
          backendDOMNodeId: 202,
          nodeName: 'button',
        }),
      }),
    ]);
    expect(blob).not.toContain('secret-token-123');
    expect(blob).not.toContain('Authorization token');
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
      stabilityHint: 'stable',
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
      stabilityHint: 'stable',
      error: 'Debugger is already attached by DevTools',
    });
  });

  it('records privacy-safe partial errors when optional CDP probes fail', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              visibilityState: 'visible',
              focused: true,
              url: 'https://docs.example.test/guide?private=1',
              title: 'Docs',
            },
          },
        };
      }
      if (method === 'Page.getFrameTree') {
        throw new Error('frame tree unavailable for current target');
      }
      if (method === 'Accessibility.getFullAXTree') {
        throw new Error('ax tree unavailable for current target');
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(46);

    expect(snapshot).toMatchObject({
      available: true,
      readiness: 'complete',
      partialErrors: ['frame_tree_unavailable', 'accessibility_tree_unavailable'],
    });
    expect(JSON.stringify(snapshot)).not.toContain('current target');
    expect(JSON.stringify(snapshot)).not.toContain('private=1');
  });

  it('probes DOM visibility and occlusion from backend node ids', async () => {
    sendCommandMock.mockImplementation(async (_tabId: number, method: string, params?: any) => {
      if (method === 'DOM.resolveNode' && params?.backendNodeId === 501) {
        return { result: { objectId: 'obj-visible' } };
      }
      if (method === 'DOM.resolveNode' && params?.backendNodeId === 502) {
        return { result: { objectId: 'obj-hidden' } };
      }
      if (method === 'DOM.resolveNode' && params?.backendNodeId === 503) {
        return { result: { objectId: 'obj-occluded' } };
      }
      if (method === 'DOM.resolveNode' && params?.backendNodeId === 504) {
        return { result: { objectId: 'obj-offscreen' } };
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'obj-visible') {
        return {
          result: {
            value: {
              domVisible: true,
              inViewport: true,
              centerHitTarget: true,
              occluded: false,
              valueState: 'non_empty',
              reason: 'visible_unobstructed',
            },
          },
        };
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'obj-hidden') {
        return {
          result: {
            value: {
              domVisible: false,
              inViewport: true,
              centerHitTarget: true,
              occluded: false,
              reason: 'display_none+zero_size',
            },
          },
        };
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'obj-occluded') {
        return {
          result: {
            value: {
              domVisible: true,
              inViewport: true,
              centerHitTarget: false,
              occluded: true,
              occludedBy: 'div',
              reason: 'center_occluded',
            },
          },
        };
      }
      if (method === 'Runtime.callFunctionOn' && params?.objectId === 'obj-offscreen') {
        return {
          result: {
            value: {
              domVisible: true,
              inViewport: false,
              centerHitTarget: false,
              occluded: true,
              reason: 'outside_viewport+center_occluded',
            },
          },
        };
      }
      return {};
    });

    const result = await probeNodeVisibility(88, [501, 502, 503, 504]);

    expect(sendCommandMock.mock.calls.map((call) => call[1])).toEqual([
      'DOM.enable',
      'Runtime.enable',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
    ]);
    expect(result.get(501)).toEqual({
      domVisible: true,
      inViewport: true,
      centerHitTarget: true,
      occluded: false,
      valueState: 'non_empty',
      reason: 'visible_unobstructed',
    });
    expect(result.get(502)).toEqual({
      domVisible: false,
      inViewport: true,
      centerHitTarget: true,
      occluded: false,
      reason: 'display_none+zero_size',
    });
    expect(result.get(503)).toEqual({
      domVisible: true,
      inViewport: true,
      centerHitTarget: false,
      occluded: true,
      occludedBy: 'div',
      reason: 'center_occluded',
    });
    expect(result.get(504)).toEqual({
      domVisible: true,
      inViewport: false,
      centerHitTarget: false,
      occluded: true,
      reason: 'outside_viewport+center_occluded',
    });
  });

  it('marks post-ready frame navigation as spa navigating', async () => {
    addEventListenerMock.mockImplementation((listener: any) => {
      listener({ tabId: 55 }, 'Page.frameNavigated', {
        frame: { id: 'frame-1', url: 'https://app.example.test/dashboard', loaderId: 'loader-2' },
      });
    });
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/search',
              title: 'Search',
              route: { url: 'https://app.example.test/search', historyLength: 5 },
              navigation: {
                type: 'navigate',
                responseEndMs: 25,
                domContentLoadedMs: 40,
                loadEventMs: 60,
              },
            },
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(55);

    expect(snapshot).toMatchObject({
      available: true,
      readiness: 'complete',
      stabilityHint: 'spa_navigating',
      likelyLoading: true,
    });
  });

  it('marks post-ready network burst as spa navigating', async () => {
    addEventListenerMock.mockImplementation((listener: any) => {
      listener({ tabId: 56 }, 'Network.requestWillBeSent', { requestId: 'r1' });
      listener({ tabId: 56 }, 'Network.requestWillBeSent', { requestId: 'r2' });
      listener({ tabId: 56 }, 'Network.requestWillBeSent', { requestId: 'r3' });
    });
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'interactive',
              url: 'https://app.example.test/results',
              title: 'Results',
              route: { url: 'https://app.example.test/results', historyLength: 6 },
              navigation: {
                type: 'navigate',
                responseEndMs: 20,
                domContentLoadedMs: 30,
                loadEventMs: 45,
              },
            },
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(56);

    expect(snapshot).toMatchObject({
      available: true,
      readiness: 'interactive',
      stabilityHint: 'spa_navigating',
      likelyLoading: true,
      networkActivity: {
        requestStartedCount: 3,
        inFlightCount: 3,
        failedRequestCount: 0,
      },
    });
  });

  it('does not treat hash-only changes as spa navigating', async () => {
    addEventListenerMock.mockImplementation((listener: any) => {
      listener({ tabId: 57 }, 'Page.frameNavigated', {
        frame: { id: 'frame-1', url: 'https://app.example.test/search#results' },
      });
    });
    sendCommandMock.mockImplementation(async (_tabId: number, method: string) => {
      if (method === 'Runtime.evaluate') {
        return {
          result: {
            value: {
              readyState: 'complete',
              url: 'https://app.example.test/search#overview',
              title: 'Search',
              route: { url: 'https://app.example.test/search#overview', historyLength: 5 },
              navigation: {
                type: 'navigate',
                responseEndMs: 25,
                domContentLoadedMs: 40,
                loadEventMs: 60,
              },
            },
          },
        };
      }
      return {};
    });

    const snapshot = await captureCDPPageSensingSnapshot(57);

    expect(snapshot).toMatchObject({
      available: true,
      readiness: 'complete',
      stabilityHint: 'stable',
      likelyLoading: false,
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
