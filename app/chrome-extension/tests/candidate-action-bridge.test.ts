import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { clickTool, fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';
import { keyboardTool } from '@/entrypoints/background/tools/browser/keyboard';
import {
  getBrowserWorldSnapshot,
  resetBrowserWorldInventoryForTests,
} from '@/entrypoints/background/browser-world-inventory';
import {
  __resetStableTargetRefRegistryForTests,
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';
import { consumePendingActionBinding } from '@/entrypoints/background/tools/browser/read-page-object-delta';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

describe('candidateAction bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStableTargetRefRegistryForTests();
    resetBrowserWorldInventoryForTests();
  });

  function mockBrowserWorldTab(tabId: number, url = 'https://example.com/app') {
    (chrome as any).windows = {
      ...((chrome as any).windows ?? {}),
      getAll: vi.fn().mockResolvedValue([
        {
          id: 1,
          focused: true,
          state: 'normal',
          type: 'normal',
          tabs: [
            {
              id: tabId,
              windowId: 1,
              url,
              title: 'App',
              active: true,
              status: 'complete',
              discarded: false,
              audible: false,
              mutedInfo: { muted: false },
              pinned: false,
            },
          ],
        },
      ]),
    };
  }

  it('resolves click target from candidateAction.targetRef', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4101,
      title: 'Repo',
      url: 'https://code.example/example/project',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_summary',
        intent: 'content.open_detail',
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.businessVerification).toMatchObject({
      status: 'fresh_read_required',
      candidateActionIntent: 'content.open_detail',
      expectedEvidence: 'detail_region_or_content_transition',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      sameTabVerificationRequired: true,
      businessSuccessProven: false,
    });
    expect(payload.businessVerification.claimBoundary).toContain('not business success');
    expect(injectSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalledWith(
      4101,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_summary',
      }),
      undefined,
    );
  });

  it('resolves safe hover target from candidateAction.targetRef without using chrome_computer', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4106,
      title: 'App',
      url: 'https://example.com/app',
    });
    const injectSpy = vi
      .spyOn(clickTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      target: { tagName: 'BUTTON', text: 'More' },
    });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_more',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(injectSpy).toHaveBeenCalledWith(
      4106,
      ['inject-scripts/accessibility-tree-helper.js'],
      false,
      'ISOLATED',
      false,
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4106,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_more',
      }),
      undefined,
    );
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      interaction: 'hover',
      observedOutcome: 'verification_required',
      lane: 'tabrix_owned',
    });
    expect(payload.actionId).toMatch(/^hover-4106-\d+$/);
    expect(payload.verification.requiresFreshReadPage).toBe(true);
    expect(payload.postActionDelta).toMatchObject({
      deltaKind: 'post_action_tool_delta',
      actionKind: 'hover',
      tabId: 4106,
      targetRef: 'ref_more',
      observedOutcome: 'verification_required',
      changed: true,
      changedSignals: ['hover_dispatched', 'floating_panel_readback_required'],
      readbackStatus: 'fresh_read_required',
      recommendation: 'chrome_read_page_force_refresh_same_tab',
      businessSuccessProven: false,
    });
    expect(payload.floatingPanelReadback).toMatchObject({
      status: 'fresh_read_required',
      expectedSurface: 'floating_panel_or_menu',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      expectedObjects: [
        'searchSurface.filterPanel',
        'searchSurface.filterPanel.targetableOptions',
        'searchSurface.filterState',
        'candidateActions',
      ],
    });
    expect(consumePendingActionBinding(4106)).toMatchObject({
      actionId: payload.actionId,
      targetRef: 'ref_more',
    });
  });

  it('moves the real pointer with CDP from the live top-frame DOM ref center', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4107,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      center: { x: 122.4, y: 168.6 },
      target: { tagName: 'BUTTON', text: 'Sort' },
    });
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) =>
        method === 'Runtime.evaluate'
          ? {
              result: {
                value: { visibilityState: 'visible', hasFocus: true, hidden: false },
              },
            }
          : {},
      );
    const withSession = vi
      .spyOn(cdpSessionManager, 'withSession')
      .mockImplementation(async (_tabId, _owner, fn) => await fn());

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_sort',
        intent: 'search.open_filters',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(withSession).toHaveBeenCalledWith(
      4107,
      'click-element-safe-hover',
      expect.any(Function),
    );
    expect(sendCommand).toHaveBeenCalledWith(4107, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 122,
      y: 169,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.foregroundActivation).toMatchObject({
      verdict: 'already_foreground',
      before: {
        visibilityState: 'visible',
        hasFocus: true,
        hidden: false,
      },
      methodsAttempted: [],
    });
    expect(payload.pointerDispatch).toEqual({
      transport: 'cdp_mouse_moved',
      coordinateSource: 'live_dom_ref_center',
      coordinatePersisted: false,
      cdpAttempted: true,
      cdpSucceeded: true,
      fallbackReason: null,
    });
  });

  it('recovers a hidden page before moving the real pointer for safe hover', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 41071,
      windowId: 9,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      center: { x: 200, y: 120 },
      target: { tagName: 'BUTTON', text: 'Filters' },
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 41071,
      windowId: 9,
      active: false,
      url: 'https://example.com/app',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.windows.update).mockResolvedValue({
      id: 9,
      focused: true,
    } as chrome.windows.Window);
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 41071,
      windowId: 9,
      active: true,
      url: 'https://example.com/app',
    } as chrome.tabs.Tab);
    let foregroundProbeCount = 0;
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'Runtime.evaluate') {
          foregroundProbeCount += 1;
          return {
            result: {
              value:
                foregroundProbeCount === 1
                  ? { visibilityState: 'hidden', hasFocus: false, hidden: true }
                  : { visibilityState: 'visible', hasFocus: true, hidden: false },
            },
          };
        }
        return {};
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, callback) => await callback(),
    );

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_filters',
        intent: 'search.open_filters',
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(chrome.windows.update).toHaveBeenCalledWith(9, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(41071, { active: true });
    expect(sendCommand).toHaveBeenCalledWith(41071, 'Page.bringToFront', undefined);
    expect(sendCommand).toHaveBeenCalledWith(41071, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 200,
      y: 120,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.foregroundActivation).toMatchObject({
      verdict: 'recovered_foreground',
      before: {
        visibilityState: 'hidden',
        hasFocus: false,
        hidden: true,
      },
      after: {
        visibilityState: 'visible',
        hasFocus: true,
        hidden: false,
      },
      methodsSucceeded: [
        'chrome.windows.update.focus',
        'chrome.tabs.update.active',
        'Page.bringToFront',
        'Emulation.setFocusEmulationEnabled',
        'Page.setWebLifecycleState',
      ],
      errors: [],
    });
    expect(payload.pointerDispatch).toMatchObject({
      transport: 'cdp_mouse_moved',
      coordinateSource: 'live_dom_ref_center',
      coordinatePersisted: false,
      cdpSucceeded: true,
    });
  });

  it('resolves safe hover from candidateAction locator css with duplicate-safe selector lookup', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4108,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: true, ref: 'ref_resolved_more' };
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'DIV', text: 'More' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_menu_1',
        locatorChain: [{ type: 'css', value: '.sidebar .menu-trigger' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4108,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        selector: '.sidebar .menu-trigger',
        isXPath: false,
        allowMultiple: true,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4108,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_resolved_more',
      }),
      undefined,
    );
  });

  it('rebounds recovered text hover targets before trying stale css locators', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4109,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const transportSpy = vi
      .spyOn(chrome.tabs, 'sendMessage')
      .mockImplementation(async (_tabId, message) => {
        if (
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.useText === true
        ) {
          return { success: true, ref: 'ref_rebound_filter', center: { x: 10, y: 20 } };
        }
        return { success: false, error: 'unexpected selector locator message' };
      });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          throw new Error('stale selector should not be tried after text rebind succeeds');
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'SPAN', text: 'Filters' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_1',
        label: 'Filters',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(transportSpy).toHaveBeenCalledWith(
      4109,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        useText: true,
        text: 'Filters',
        tagName: '',
        allowMultiple: true,
      }),
      { frameId: 0 },
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4109,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_rebound_filter',
      }),
      undefined,
    );
    expect(
      sendSpy.mock.calls.some(
        ([, message]) =>
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.selector === '.stale-filter',
      ),
    ).toBe(false);
  });

  it('uses selector chain when recovered text hover rebind fails', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4110,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const transportSpy = vi
      .spyOn(chrome.tabs, 'sendMessage')
      .mockImplementation(async (_tabId, message) => {
        if (
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.useText === true
        ) {
          return { success: false, error: 'text not found: Filters' };
        }
        return { success: false, error: 'unexpected selector locator message' };
      });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: true, ref: 'ref_rebound_filter_by_css' };
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'SPAN', text: 'Filters' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_2',
        label: 'Filters',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(transportSpy).toHaveBeenCalledWith(
      4110,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        useText: true,
        text: 'Filters',
        tagName: '',
        allowMultiple: true,
      }),
      { frameId: 0 },
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4110,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        selector: '.stale-filter',
        isXPath: false,
        allowMultiple: true,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4110,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_rebound_filter_by_css',
      }),
      undefined,
    );
  });

  it('falls back to generated leaf text xpath when safe hover css locator is stale', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4113,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.selector === '.stale-filter'
        ) {
          return { success: false, error: 'selector not found: .stale-filter' };
        }
        if (
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.isXPath === true
        ) {
          expect(message.selector).toBe("//*[not(*) and normalize-space(.)='Filters']");
          return { success: true, ref: 'ref_rebound_filter_by_xpath' };
        }
        if (
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
          message.useText === true
        ) {
          throw new Error('text fallback should not be needed after xpath succeeds');
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'SPAN', text: 'Filters' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      selector: '.stale-filter',
      candidateAction: {
        label: 'Filters',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4113,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        selector: '.stale-filter',
        isXPath: false,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4113,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        selector: "//*[not(*) and normalize-space(.)='Filters']",
        isXPath: true,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4113,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_rebound_filter_by_xpath',
      }),
      undefined,
    );
    expect(
      sendSpy.mock.calls.some(
        ([, message]) =>
          message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR && message.useText === true,
      ),
    ).toBe(false);
  });

  it('rebounds recovered text hover targets from current snapshot rect after stale selectors fail', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4114,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(chrome.tabs, 'sendMessage').mockImplementation(async (_tabId, message) => {
      if (
        message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR &&
        message.useText === true
      ) {
        return { success: false, error: 'text not found: Filters' };
      }
      return { success: false, error: 'unexpected transport message' };
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.RESOLVE_REF) {
          return { success: false, error: 'ref expired' };
        }
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: false, error: `selector not found: ${message.selector}` };
        }
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_POINT) {
          expect(message).toMatchObject({
            x: 120,
            y: 50,
            identity: {
              label: 'Filters',
              targetRef: 'ref_text_search_toolbar_3',
              locatorChain: [{ type: 'css', value: '.stale-filter' }],
            },
          });
          return {
            success: true,
            ref: 'ref_rebound_filter_by_point',
            identityEvidence: {
              exactLabelMatched: true,
              uniqueLabelMatch: true,
            },
          };
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'SPAN', text: 'Filters' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_3',
        label: 'Filters',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
        visibility: {
          source: 'dom',
          domVisible: true,
          inViewport: true,
          centerHitTarget: true,
          occluded: false,
          reason: 'visible_unobstructed',
        },
        snapshotRect: { x: 100, y: 40, width: 40, height: 20 },
      },
    } as any);

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_snapshot_rect',
      dispatchTarget: 'ref',
    });
    expect(payload.floatingPanelReadback).toMatchObject({
      status: 'fresh_read_required',
      expectedSurface: 'floating_panel_or_menu',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      4114,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_POINT,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4114,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_rebound_filter_by_point',
      }),
      undefined,
    );
  });

  it('fails closed instead of attempting point rebind without strong candidate identity', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4115,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({
      success: false,
      error: 'visible text identity unavailable',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: false, error: 'selector is stale' };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_4',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
        visibility: {
          source: 'dom',
          domVisible: true,
          inViewport: true,
          centerHitTarget: true,
          occluded: false,
        },
        snapshotRect: { x: 100, y: 40, width: 40, height: 20 },
      },
    } as any);

    expect(result.isError).toBe(true);
    expect(
      sendSpy.mock.calls.some(
        ([, message]) => message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_POINT,
      ),
    ).toBe(false);
    expect(
      sendSpy.mock.calls.some(
        ([, message]) => message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
      ),
    ).toBe(false);
  });

  it('uses a live recovered text ref for safe hover before stale css lookup', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4111,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if (message.action === TOOL_MESSAGE_TYPES.RESOLVE_REF) {
          return { success: true, center: { x: 24, y: 36 } };
        }
        if (message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          throw new Error('selector lookup should not be used when recovered ref is live');
        }
        if (message.action === TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF) {
          return { success: true, target: { tagName: 'BUTTON', text: 'Filters' } };
        }
        return { success: false, error: 'unexpected message' };
      });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_9',
        label: 'Filters',
        locatorChain: [{ type: 'css', value: '.stale-filter' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4111,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.RESOLVE_REF,
        ref: 'ref_text_search_toolbar_9',
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4111,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.DISPATCH_HOVER_FOR_REF,
        ref: 'ref_text_search_toolbar_9',
      }),
      undefined,
    );
    expect(
      sendSpy.mock.calls.some(
        ([, message]) => message.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
      ),
    ).toBe(false);
  });

  it('routes recovered search toolbar targetRef through candidateAction locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4112,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_2',
        intent: 'search.category_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_search_toolbar_2' },
          { type: 'aria', value: '图文' },
          { type: 'css', value: '.search-toolbar [data-category="images"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    expect(payload.businessVerification).toMatchObject({
      status: 'fresh_read_required',
      candidateActionIntent: 'search.category_select',
      expectedEvidence: 'search_results_or_url_query_changed',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      businessSuccessProven: false,
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.search-toolbar [data-category="images"]',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('routes copied recovered search toolbar ref through candidateAction locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4116,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      ref: 'ref_text_search_toolbar_2',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_2',
        intent: 'search.category_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_search_toolbar_2' },
          { type: 'aria', value: '图文' },
          { type: 'css', value: '.search-toolbar [data-category="images"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.search-toolbar [data-category="images"]',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('returns structured failure when recovered search toolbar click helper does not respond', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4114,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
      windowId: 1,
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockReturnValue(new Promise(() => {}));

    const result = await clickTool.execute({
      timeout: 1,
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_4',
        intent: 'search.category_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_search_toolbar_4' },
          { type: 'css', value: '.search-toolbar [data-category="video"]' },
        ],
      },
    });

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: false,
      dispatchSucceeded: false,
      observedOutcome: 'no_observed_change',
      reason: 'click_helper_response_timeout',
      resultShape: 'structured_click_error',
      targetBinding: {
        resolutionSource: 'candidate_locator_css',
        dispatchTarget: 'selector',
      },
      businessVerification: {
        status: 'not_proven',
        candidateActionIntent: 'search.category_select',
        businessSuccessProven: false,
      },
    });
    expect(payload.postActionReadback).toMatchObject({
      dispatchSucceeded: false,
      requiredNextAction: 'stop_or_retry_after_fresh_read',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.search-toolbar [data-category="video"]',
      waitForNavigation: false,
      timeout: 1,
    });
    expect(clickMessage.ref).toBeUndefined();
    expect(consumePendingActionBinding(4114)).toMatchObject({
      targetRef: 'ref_text_search_toolbar_4',
      actionIntent: 'search.category_select',
    });
  });

  it('routes recovered filter panel targetRef through candidateAction locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4115,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_filter_panel_7',
        intent: 'filter.option_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_filter_panel_7' },
          { type: 'aria', value: '最多收藏' },
          { type: 'css', value: '.filter-panel .tags[data-filter="most-saved"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.filter-panel .tags[data-filter="most-saved"]',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('prefers latest read_page snapshot locator for recovered filter panel refs', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4124, [
      {
        targetRef: 'ref_text_filter_panel_7',
        selector: '.live-filter-panel [data-filter="most-saved"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4124,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_filter_panel_7',
        intent: 'filter.option_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_filter_panel_7' },
          { type: 'aria', value: '最多收藏' },
          { type: 'css', value: '.stale-filter-panel .tags[data-filter="most-saved"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_snapshot_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.live-filter-panel [data-filter="most-saved"]',
    });
    expect(clickMessage.selector).not.toBe('.stale-filter-panel .tags[data-filter="most-saved"]');
    expect(clickMessage.ref).toBeUndefined();
  });

  it('uses a trusted CDP pointer click for a visible current-snapshot DOM object', async () => {
    recordCandidateActionTargetLocatorsSnapshot(41241, [
      {
        targetRef: 'ref_fallback_cdp_dom_button_1',
        selector: 'main:has(#query) button[type="submit"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 41241,
      windowId: 7,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: {
                visibilityState: 'visible',
                hasFocus: true,
                hidden: false,
              },
            },
          };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelectorAll') return { nodeIds: [27] };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'object-27' } };
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                success: true,
                center: { x: 1340.4, y: 143.2 },
                elementInfo: { tagName: 'BUTTON' },
                targetConsistency: {
                  verdict: 'matched',
                  clickMethod: 'cdp_snapshot_locator',
                },
              },
            },
          };
        }
        return {};
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, callback) => await callback(),
    );

    const result = await clickTool.execute({
      tabId: 41241,
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_button_1',
        executionTargetKind: 'snapshot_locator',
        intent: 'search.submit',
        visibility: {
          source: 'cdp',
          domVisible: true,
          inViewport: true,
          centerHitTarget: true,
          occluded: false,
          reason: 'visible_unobstructed',
        },
        snapshotRect: { x: 1324, y: 127, width: 32, height: 32 },
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_button_1' },
          { type: 'css', value: 'main:has(#query) button[type="submit"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      dispatchSucceeded: true,
      clickMethod: 'cdp_trusted_pointer',
      pointerDispatch: {
        transport: 'cdp_mouse_click',
        coordinateSource: 'live_cdp_dom_object_center',
        coordinatePersisted: false,
        cdpSucceeded: true,
      },
      foregroundActivation: {
        verdict: 'already_foreground',
        before: {
          visibilityState: 'visible',
          hasFocus: true,
          hidden: false,
        },
        methodsAttempted: [],
      },
      targetBinding: {
        resolutionSource: 'candidate_snapshot_locator_css',
        dispatchTarget: 'selector',
      },
    });
    expect(sendCommand).toHaveBeenCalledWith(41241, 'Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 1340,
      y: 143,
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
    });
    expect(sendCommand).toHaveBeenCalledWith(41241, 'Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: 1340,
      y: 143,
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
    });
    expect(sendCommand).toHaveBeenCalledWith(41241, 'Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 1340,
      y: 143,
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'mouse',
    });
    expect(
      sendSpy.mock.calls.some(
        ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
      ),
    ).toBe(false);
  });

  it('recovers a hidden current-snapshot page before dispatching a trusted pointer click', async () => {
    recordCandidateActionTargetLocatorsSnapshot(41242, [
      {
        targetRef: 'ref_fallback_cdp_dom_button_2',
        selector: 'main:has(#query) button[type="submit"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 41242,
      windowId: 7,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
    });
    vi.mocked(chrome.tabs.get).mockResolvedValue({
      id: 41242,
      windowId: 7,
      active: false,
      url: 'https://example.com/search',
    } as chrome.tabs.Tab);
    vi.mocked(chrome.windows.update).mockResolvedValue({
      id: 7,
      focused: true,
    } as chrome.windows.Window);
    vi.mocked(chrome.tabs.update).mockResolvedValue({
      id: 41242,
      windowId: 7,
      active: true,
      url: 'https://example.com/search',
    } as chrome.tabs.Tab);
    let foregroundProbeCount = 0;
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'Runtime.evaluate') {
          foregroundProbeCount += 1;
          return {
            result: {
              value:
                foregroundProbeCount === 1
                  ? { visibilityState: 'hidden', hasFocus: false, hidden: true }
                  : { visibilityState: 'visible', hasFocus: true, hidden: false },
            },
          };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelectorAll') return { nodeIds: [28] };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'object-28' } };
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                success: true,
                center: { x: 320, y: 140 },
                elementInfo: { tagName: 'BUTTON' },
                targetConsistency: { verdict: 'matched' },
              },
            },
          };
        }
        return {};
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, callback) => await callback(),
    );

    const result = await clickTool.execute({
      tabId: 41242,
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_button_2',
        executionTargetKind: 'snapshot_locator',
        intent: 'search.submit',
        visibility: {
          source: 'cdp',
          domVisible: true,
          inViewport: true,
          centerHitTarget: true,
          occluded: false,
          reason: 'visible_unobstructed',
        },
        snapshotRect: { x: 1324, y: 127, width: 32, height: 32 },
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_button_2' },
          { type: 'css', value: 'main:has(#query) button[type="submit"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    expect(sendCommand).toHaveBeenCalledWith(41242, 'Page.bringToFront', undefined);
    expect(sendCommand).toHaveBeenCalledWith(41242, 'Emulation.setFocusEmulationEnabled', {
      enabled: true,
    });
    expect(sendCommand).toHaveBeenCalledWith(41242, 'Page.setWebLifecycleState', {
      state: 'active',
    });
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.foregroundActivation).toMatchObject({
      verdict: 'recovered_foreground',
      before: {
        visibilityState: 'hidden',
        hasFocus: false,
        hidden: true,
      },
      after: {
        visibilityState: 'visible',
        hasFocus: true,
        hidden: false,
      },
      methodsSucceeded: [
        'chrome.windows.update.focus',
        'chrome.tabs.update.active',
        'Page.bringToFront',
        'Emulation.setFocusEmulationEnabled',
        'Page.setWebLifecycleState',
      ],
      errors: [],
    });
    expect(chrome.windows.update).toHaveBeenCalledWith(7, { focused: true });
    expect(chrome.tabs.update).toHaveBeenCalledWith(41242, { active: true });
    expect(sendCommand).toHaveBeenCalledWith(
      41242,
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', buttons: 1 }),
    );
  });

  it('routes visible filter control targetRef through candidateAction locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4118,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domAddedMenu: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_filter_trigger_2c3acd4f',
        intent: 'search.open_filters',
        locatorChain: [
          { type: 'ref', value: 'ref_filter_trigger_2c3acd4f' },
          { type: 'aria', value: '筛选' },
          { type: 'css', value: '.search-page .filter-trigger' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.search-page .filter-trigger',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('routes a newly objectized floating option through its snapshot-local locator', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 41181,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_floating_option_2c3acd4f',
        executionTargetKind: 'snapshot_locator',
        intent: 'filter.option_select',
        locatorChain: [
          { type: 'ref', value: 'ref_floating_option_2c3acd4f' },
          { type: 'css', value: '[role="listbox"] [role="option"]:nth-of-type(2)' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '[role="listbox"] [role="option"]:nth-of-type(2)',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('clicks a visible current-snapshot floating option with a trusted CDP pointer', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 41182,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
    });
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'Runtime.evaluate') {
          return {
            result: {
              value: { visibilityState: 'visible', hasFocus: true, hidden: false },
            },
          };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelectorAll') return { nodeIds: [82] };
        if (method === 'DOM.resolveNode') return { object: { objectId: 'floating-option-82' } };
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                success: true,
                center: { x: 480, y: 220 },
                elementInfo: { tagName: 'DIV', text: 'Most comments' },
                targetConsistency: { verdict: 'matched' },
              },
            },
          };
        }
        return {};
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, callback) => await callback(),
    );

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_floating_option_82',
        executionTargetKind: 'snapshot_locator',
        intent: 'search.apply_filter.sort',
        snapshotRect: { x: 440, y: 200, width: 80, height: 40 },
        visibility: {
          source: 'dom',
          domVisible: true,
          inViewport: true,
          centerHitTarget: true,
          occluded: false,
          reason: 'visible_unobstructed',
        },
        locatorChain: [
          { type: 'ref', value: 'ref_floating_option_82' },
          { type: 'xpath', value: "//*[@role='option'][2]" },
          { type: 'css', value: '[role="listbox"] [role="option"]:nth-of-type(2)' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      clickMethod: 'cdp_trusted_pointer',
      targetBinding: {
        resolutionSource: 'candidate_locator_css',
        dispatchTarget: 'selector',
      },
      pointerDispatch: {
        transport: 'cdp_mouse_click',
        coordinateSource: 'live_cdp_dom_object_center',
        coordinatePersisted: false,
        cdpSucceeded: true,
      },
    });
    expect(sendCommand).toHaveBeenCalledWith(
      41182,
      'Input.dispatchMouseEvent',
      expect.objectContaining({ type: 'mousePressed', x: 480, y: 220, buttons: 1 }),
    );
    expect(
      sendSpy.mock.calls.some(
        ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
      ),
    ).toBe(false);
  });

  it('routes visible filter option targetRef through candidateAction locator xpath before css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4119,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if ((message as any)?.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: true, ref: 'ref_live_most_saved' };
        }
        return {
          success: true,
          dispatchSucceeded: true,
          signals: { domChanged: true },
        };
      });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_filter_sort_c4ba7440',
        intent: 'search.apply_filter.sort',
        locatorChain: [
          { type: 'ref', value: 'ref_filter_sort_c4ba7440' },
          { type: 'aria', value: '最多收藏' },
          {
            type: 'xpath',
            value:
              "//*[self::button or self::span or @role='option'][normalize-space(.)='最多收藏']",
          },
          { type: 'css', value: '.filter-panel .option:nth-child(5) > span' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_xpath',
      dispatchTarget: 'ref',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      4119,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        selector:
          "//*[self::button or self::span or @role='option'][normalize-space(.)='最多收藏']",
        isXPath: true,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4119,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_live_most_saved',
      }),
      undefined,
    );
  });

  it('falls back to candidateAction locator css when xpath cannot resolve', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4120,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockImplementation(async (_tabId, message) => {
        if ((message as any)?.action === TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR) {
          return { success: false, error: 'not found' };
        }
        return {
          success: true,
          dispatchSucceeded: true,
          signals: { domChanged: true },
        };
      });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_filter_trigger_2c3acd4f',
        intent: 'search.open_filters',
        locatorChain: [
          { type: 'ref', value: 'ref_filter_trigger_2c3acd4f' },
          { type: 'aria', value: '筛选' },
          {
            type: 'xpath',
            value: "//*[self::button or self::span or @role='option'][normalize-space(.)='筛选']",
          },
          { type: 'css', value: 'div.search-filter-trigger > span' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      4120,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.ENSURE_REF_FOR_SELECTOR,
        isXPath: true,
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4120,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        selector: 'div.search-filter-trigger > span',
      }),
      undefined,
    );
  });

  it('routes result-card actionTarget candidateAction through locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4117,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        id: 'ca_click_ref_result_card_1',
        actionType: 'click',
        targetRef: 'ref_result_card_1',
        intent: 'content.open_detail',
        locatorChain: [
          { type: 'ref', value: 'ref_result_card_1' },
          { type: 'aria', value: 'AI image workflow' },
          { type: 'css', value: '.result-card:nth-of-type(1) a.title' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.result-card:nth-of-type(1) a.title',
    });
    expect(clickMessage.ref).toBeUndefined();
    expect(clickMessage.coordinates).toBeUndefined();
  });

  it('requires fresh readback instead of retry when a dispatched filter click has no local signal', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4116,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: {
        beforeUnloadFired: false,
        urlBefore: 'https://example.com/search?q=neutral',
        urlAfter: 'https://example.com/search?q=neutral',
        hashBefore: '',
        hashAfter: '',
        domChanged: false,
        domAddedDialog: false,
        domAddedMenu: false,
        focusChanged: false,
        targetStateDelta: null,
      },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_filter_panel_8',
        intent: 'filter.option_select',
        locatorChain: [
          { type: 'ref', value: 'ref_text_filter_panel_8' },
          { type: 'aria', value: '最多收藏' },
          { type: 'css', value: '.filter-panel .tags[data-filter="most-saved"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: false,
      dispatchSucceeded: true,
      observedOutcome: 'no_observed_change',
      postActionReadback: {
        status: 'fresh_read_required',
        requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
        businessSuccessProven: false,
      },
      actionEvidenceResult: {
        business: {
          nextRequiredCheck: 'chrome_read_page_force_refresh_same_tab',
          businessSuccessProven: false,
        },
      },
    });
  });

  it('routes recovered dynamic surface targetRef through candidateAction locator css', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4121,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_dynamic_surface_3',
        intent: 'click',
        locatorChain: [
          { type: 'ref', value: 'ref_dynamic_surface_3' },
          { type: 'css', value: '[data-surface-option="week"]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '[data-surface-option="week"]',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('does not dispatch recovered search toolbar targetRef without a css locator', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4113,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_3',
        intent: 'filter.open',
        locatorChain: [
          { type: 'ref', value: 'ref_text_search_toolbar_3' },
          { type: 'aria', value: '筛选' },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'candidateAction did not resolve target',
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('does not dispatch copied recovered search toolbar ref without a css locator', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4117,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      ref: 'ref_text_search_toolbar_3',
      candidateAction: {
        targetRef: 'ref_text_search_toolbar_3',
        intent: 'filter.open',
        locatorChain: [
          { type: 'ref', value: 'ref_text_search_toolbar_3' },
          { type: 'aria', value: '筛选' },
        ],
      },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'candidateAction did not resolve target',
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('returns structured diagnostics when safe hover selector cannot be resolved', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4109,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: false,
      error: 'selector not found: .menu-trigger',
    });

    const result = await clickTool.execute({
      interaction: 'hover',
      candidateAction: {
        targetRef: 'ref_text_menu_2',
        locatorChain: [{ type: 'css', value: '.menu-trigger' }],
      },
    } as any);

    expect(result.isError).toBe(true);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: false,
      dispatchSucceeded: false,
      clickMethod: 'candidateAction',
      resultShape: 'structured_click_error',
    });
    expect(payload.message).toContain('Failed to resolve hover selector');
    expect(payload.message).toContain('selector not found');
  });

  it('rejects coordinate-only safe hover so menu discovery stays ref based', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4107,
      title: 'App',
      url: 'https://example.com/app',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      interaction: 'hover',
      coordinates: { x: 20, y: 20 },
    } as any);

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain('Coordinate-only hover');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('resolves fill target from candidateAction.locatorChain(css)', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4102,
      title: 'Login',
      url: 'https://example.com/login',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
      elementInfo: { valueState: 'non_empty' },
    });

    const result = await fillTool.execute({
      value: 'alice@example.com',
      candidateAction: {
        locatorChain: [
          { type: 'aria', value: 'Email' },
          { type: 'css', value: 'input[name=email]' },
        ],
        intent: 'search.enter_query',
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      observedOutcome: null,
      postconditionVerdict: 'unknown',
      postconditionReason: 'form_input_state_change_not_proven_by_tool_closeout',
      businessVerification: {
        status: 'fresh_read_required',
        candidateActionIntent: 'search.enter_query',
        expectedEvidence: 'form_value_state_changed',
        requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
        sameTabVerificationRequired: true,
        businessSuccessProven: false,
      },
      postActionDelta: {
        deltaKind: 'post_action_tool_delta',
        actionKind: 'fill',
        tabId: 4102,
        observedOutcome: 'input_value_written',
        changed: true,
        changedSignals: ['input_state_observed'],
        readbackStatus: 'fresh_read_required',
        recommendation: 'chrome_read_page_force_refresh_same_tab',
        businessSuccessProven: false,
      },
      inputWriteEvidence: {
        valueState: 'non_empty',
        proofStatus: 'input_state_observed',
      },
    });
    expect(payload.claimBoundary).toContain('does not prove form/search result state changed');
    expect(sendSpy).toHaveBeenCalledWith(
      4102,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: 'input[name=email]',
      }),
      undefined,
    );
  });

  it('fills a current snapshot locator through CDP when the page content script is unavailable', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4103, [
      {
        targetRef: 'ref_fallback_cdp_ax_backend_27',
        selector: '#search-input',
      },
    ]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4103,
      title: 'Search',
      url: 'https://example.com/search',
      status: 'loading',
    });
    const settleSpy = vi.spyOn(fillTool as any, 'waitForTabSettled');
    const injectSpy = vi.spyOn(fillTool as any, 'injectContentScript');
    const messageSpy = vi.spyOn(fillTool as any, 'sendMessageToTab');
    let runtimeCallCount = 0;
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelectorAll') return { nodeIds: [27] } as any;
        if (method === 'DOM.resolveNode') return { object: { objectId: 'search-input-27' } } as any;
        if (method === 'Runtime.callFunctionOn') {
          runtimeCallCount += 1;
          return {
            result: {
              value:
                runtimeCallCount === 1
                  ? {
                      success: true,
                      tagName: 'INPUT',
                      type: 'search',
                      requiresTrustedTextEntry: true,
                    }
                  : runtimeCallCount === 2
                    ? {
                        success: true,
                        focusConfirmed: true,
                        selectionPreparedBeforeDispatch: true,
                      }
                    : {
                        success: true,
                        tagName: 'INPUT',
                        type: 'search',
                        valueState: 'non_empty',
                        valueMatchesRequested: true,
                        elementInfo: {
                          tagName: 'INPUT',
                          type: 'search',
                          valueState: 'non_empty',
                          focusConfirmed: true,
                          selectionPreparedBeforeDispatch: true,
                          trustedInputObserved: true,
                          exactValueMatch: true,
                        },
                      },
            },
          } as any;
        }
        return {} as any;
      });
    const withSession = vi
      .spyOn(cdpSessionManager, 'withSession')
      .mockImplementation(async (_tabId, _owner, fn) => await fn());

    const result = await fillTool.execute({
      tabId: 4103,
      value: 'generic query',
      candidateAction: {
        targetRef: 'ref_fallback_cdp_ax_backend_27',
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_ax_backend_27' },
          { type: 'css', value: '#search-input' },
        ],
        intent: 'search.enter_query',
      },
    });

    expect(result.isError).toBe(false);
    expect(settleSpy).not.toHaveBeenCalled();
    expect(injectSpy).not.toHaveBeenCalled();
    expect(messageSpy).not.toHaveBeenCalled();
    expect(withSession).toHaveBeenCalledWith(
      4103,
      'fill-current-snapshot-locator',
      expect.any(Function),
    );
    expect(sendCommand).toHaveBeenCalledWith(4103, 'Input.insertText', {
      text: 'generic query',
    });
    const setupCall = sendCommand.mock.calls.find(
      ([, method]) => method === 'Runtime.callFunctionOn',
    );
    const setupFunction = String((setupCall?.[2] as any)?.functionDeclaration || '');
    expect(setupFunction).toContain("document?.addEventListener('beforeinput'");
    expect(setupFunction).toContain('wrongTargetBlocked');
    expect(setupFunction).toContain('event.preventDefault()');
    expect(setupFunction).not.toContain('once: true');
    const setupTrustedProbe = new Function(`return (${setupFunction});`)() as (
      this: HTMLInputElement,
      nextValue: string,
      probeKey: string,
    ) => { success: boolean };
    const guardedInput = document.createElement('input');
    const competingInput = document.createElement('input');
    guardedInput.value = 'old';
    vi.spyOn(guardedInput, 'getBoundingClientRect').mockReturnValue({
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 210,
      bottom: 42,
      width: 200,
      height: 32,
      toJSON: () => ({}),
    });
    document.body.append(guardedInput, competingInput);
    let wrongTargetGuard: EventListener | undefined;
    let trustedInputListener: EventListener | undefined;
    const documentAddEventListener = vi
      .spyOn(document, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'beforeinput') wrongTargetGuard = listener as EventListener;
      });
    const elementAddEventListener = vi
      .spyOn(guardedInput, 'addEventListener')
      .mockImplementation((type, listener) => {
        if (type === 'input') trustedInputListener = listener as EventListener;
      });
    guardedInput.focus();
    expect(setupTrustedProbe.call(guardedInput, 'next', '__probe')).toMatchObject({
      success: true,
    });
    competingInput.focus();
    const preventDefault = vi.fn();
    wrongTargetGuard?.({
      isTrusted: true,
      cancelable: true,
      preventDefault,
    } as unknown as Event);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect((guardedInput as any).__probe.wrongTargetBlocked).toBe(true);
    trustedInputListener?.({ isTrusted: false } as Event);
    expect((guardedInput as any).__probe.input).toBe(false);
    trustedInputListener?.({ isTrusted: true } as Event);
    expect((guardedInput as any).__probe.input).toBe(true);
    (guardedInput as any).__probe.cleanup();
    documentAddEventListener.mockRestore();
    elementAddEventListener.mockRestore();
    guardedInput.remove();
    competingInput.remove();
    const readbackCall = sendCommand.mock.calls
      .filter(([, method]) => method === 'Runtime.callFunctionOn')
      .at(-1);
    expect(readbackCall?.[2]).toMatchObject({
      awaitPromise: true,
      functionDeclaration: expect.stringContaining('await new Promise'),
    });
    const readbackFunction = String((readbackCall?.[2] as any)?.functionDeclaration || '');
    expect(readbackFunction).toContain('trustedInputObserved');
    expect(readbackFunction).not.toContain('dispatchEvent(');
    expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain(
      'Input.dispatchKeyEvent',
    );
    expect(sendCommand.mock.calls.at(-1)?.[1]).toBe('Runtime.callFunctionOn');
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      executionLane: 'tabrix_cdp_snapshot_locator',
      targetBinding: {
        resolutionSource: 'candidate_snapshot_locator_css',
        dispatchTarget: 'selector',
      },
      inputWriteEvidence: {
        valueState: 'non_empty',
        proofStatus: 'input_state_observed',
        focusConfirmed: true,
        selectionPreparedBeforeDispatch: true,
        trustedInputObserved: true,
        exactValueMatch: true,
      },
      businessVerification: {
        status: 'fresh_read_required',
        businessSuccessProven: false,
      },
    });
  });

  it('rejects a current snapshot CDP fill when the target cannot confirm focus', async () => {
    recordCandidateActionTargetLocatorsSnapshot(41031, [
      {
        targetRef: 'ref_fallback_cdp_dom_searchbox_focus',
        selector: '#search-input',
      },
    ]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 41031,
      title: 'Search',
      url: 'https://example.com/search',
      status: 'complete',
    });
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelectorAll') return { nodeIds: [31] } as any;
        if (method === 'DOM.resolveNode') return { object: { objectId: 'search-input-31' } } as any;
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                success: false,
                error: 'target_focus_not_confirmed',
              },
            },
          } as any;
        }
        return {} as any;
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, fn) => await fn(),
    );

    const result = await fillTool.execute({
      tabId: 41031,
      value: 'generic query',
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_searchbox_focus',
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_searchbox_focus' },
          { type: 'css', value: '#search-input' },
        ],
        intent: 'search.enter_query',
      },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'target_focus_not_confirmed',
    );
    expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain(
      'Input.dispatchKeyEvent',
    );
  });

  it('rejects trusted text entry when focus moves after the snapshot target is prepared', async () => {
    recordCandidateActionTargetLocatorsSnapshot(41033, [
      {
        targetRef: 'ref_fallback_cdp_dom_searchbox_focus_lost',
        selector: '#search-input',
      },
    ]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 41033,
      title: 'Search',
      url: 'https://example.com/search',
      status: 'complete',
    });
    let runtimeCallCount = 0;
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelectorAll') return { nodeIds: [33] } as any;
        if (method === 'DOM.resolveNode') {
          return { object: { objectId: 'search-input-33' } } as any;
        }
        if (method === 'Runtime.callFunctionOn') {
          runtimeCallCount += 1;
          return {
            result: {
              value:
                runtimeCallCount === 1
                  ? {
                      success: true,
                      tagName: 'INPUT',
                      type: 'search',
                      requiresTrustedTextEntry: true,
                    }
                  : {
                      success: false,
                      error: 'target_focus_lost_before_trusted_input',
                      focusConfirmed: false,
                      selectionPreparedBeforeDispatch: false,
                    },
            },
          } as any;
        }
        return {} as any;
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, fn) => await fn(),
    );

    const result = await fillTool.execute({
      tabId: 41033,
      value: 'generic query',
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_searchbox_focus_lost',
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_searchbox_focus_lost' },
          { type: 'css', value: '#search-input' },
        ],
        intent: 'search.enter_query',
      },
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'target_focus_lost_before_trusted_input',
    );
    expect(sendCommand.mock.calls.map(([, method]) => method)).not.toContain('Input.insertText');
  });

  it('rejects a current snapshot CDP fill when non-empty text reads back empty', async () => {
    recordCandidateActionTargetLocatorsSnapshot(41032, [
      {
        targetRef: 'ref_fallback_cdp_dom_searchbox_empty',
        selector: '#search-input',
      },
    ]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 41032,
      title: 'Search',
      url: 'https://example.com/search',
      status: 'complete',
    });
    let runtimeCallCount = 0;
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelectorAll') return { nodeIds: [32] } as any;
        if (method === 'DOM.resolveNode') return { object: { objectId: 'search-input-32' } } as any;
        if (method === 'Runtime.callFunctionOn') {
          runtimeCallCount += 1;
          return {
            result: {
              value:
                runtimeCallCount === 1
                  ? {
                      success: true,
                      tagName: 'TEXTAREA',
                      type: '',
                      requiresTrustedTextEntry: true,
                    }
                  : runtimeCallCount === 2
                    ? {
                        success: true,
                        focusConfirmed: true,
                        selectionPreparedBeforeDispatch: true,
                      }
                    : {
                        success: true,
                        tagName: 'TEXTAREA',
                        type: '',
                        valueState: 'empty',
                        valueMatchesRequested: false,
                        elementInfo: {
                          tagName: 'TEXTAREA',
                          type: '',
                          valueState: 'empty',
                          focusConfirmed: true,
                          selectionPreparedBeforeDispatch: true,
                          trustedInputObserved: true,
                          exactValueMatch: false,
                        },
                      },
            },
          } as any;
        }
        return {} as any;
      });
    vi.spyOn(cdpSessionManager, 'withSession').mockImplementation(
      async (_tabId, _owner, fn) => await fn(),
    );

    const result = await fillTool.execute({
      tabId: 41032,
      value: 'generic query',
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_searchbox_empty',
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_searchbox_empty' },
          { type: 'css', value: '#search-input' },
        ],
        intent: 'search.enter_query',
      },
    });

    expect(result.isError).toBe(false);
    expect(JSON.parse(String((result.content?.[0] as any)?.text || '{}'))).toMatchObject({
      success: false,
      reason: 'trusted_input_readback_unconfirmed',
      error: 'trusted_input_dispatch_or_readback_unconfirmed',
      dispatchMaybeApplied: true,
      freshReadRequired: true,
      doNotRetryBeforeRead: true,
      targetBinding: {
        resolutionSource: 'candidate_snapshot_locator_css',
        dispatchTarget: 'selector',
      },
      postActionReadback: {
        status: 'fresh_read_required',
        businessSuccessProven: false,
      },
    });
    const partialPayload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(partialPayload.actionId).toMatch(/^fill-41032-\d+$/);
    expect(partialPayload.postActionDelta).toMatchObject({
      actionId: partialPayload.actionId,
      actionKind: 'fill',
      tabId: 41032,
      readbackStatus: 'fresh_read_required',
      businessSuccessProven: false,
    });
    expect(consumePendingActionBinding(41032)).toMatchObject({
      actionId: partialPayload.actionId,
      targetRef: 'ref_fallback_cdp_dom_searchbox_empty',
      actionIntent: 'search.enter_query',
    });
    expect(JSON.stringify(partialPayload)).not.toContain('generic query');
    expect(sendCommand).toHaveBeenCalledWith(41032, 'Input.insertText', {
      text: 'generic query',
    });
  });

  it('dispatches Enter through a current CDP snapshot locator when the content bridge is unavailable', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4104, [
      {
        targetRef: 'ref_fallback_cdp_dom_searchbox_0',
        selector: '#search-input',
      },
    ]);
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4104,
      title: 'Search',
      url: 'https://example.com/search',
      status: 'loading',
    });
    const injectSpy = vi.spyOn(keyboardTool as any, 'injectContentScript');
    const messageSpy = vi.spyOn(keyboardTool as any, 'sendMessageToTab');
    const sendCommand = vi
      .spyOn(cdpSessionManager, 'sendCommand')
      .mockImplementation(async (_tabId, method) => {
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } } as any;
        if (method === 'DOM.querySelectorAll') return { nodeIds: [27] } as any;
        if (method === 'DOM.resolveNode') return { object: { objectId: 'search-input-27' } } as any;
        if (method === 'Runtime.callFunctionOn') {
          return {
            result: {
              value: {
                success: true,
                tagName: 'TEXTAREA',
                type: '',
                focused: true,
              },
            },
          } as any;
        }
        return {} as any;
      });
    const withSession = vi
      .spyOn(cdpSessionManager, 'withSession')
      .mockImplementation(async (_tabId, _owner, fn) => await fn());

    const result = await keyboardTool.execute({
      tabId: 4104,
      key: 'Enter',
      candidateAction: {
        targetRef: 'ref_fallback_cdp_dom_searchbox_0',
        locatorChain: [
          { type: 'ref', value: 'ref_fallback_cdp_dom_searchbox_0' },
          { type: 'css', value: '#search-input' },
        ],
        intent: 'search.submit',
      },
    });

    expect(result.isError).toBe(false);
    expect(injectSpy).not.toHaveBeenCalled();
    expect(messageSpy).not.toHaveBeenCalled();
    expect(withSession).toHaveBeenCalledWith(
      4104,
      'keyboard-current-snapshot-locator',
      expect.any(Function),
    );
    expect(sendCommand.mock.calls.map(([, method]) => method)).toEqual([
      'DOM.getDocument',
      'DOM.querySelectorAll',
      'DOM.resolveNode',
      'Runtime.callFunctionOn',
      'Input.dispatchKeyEvent',
      'Input.dispatchKeyEvent',
    ]);
    expect(sendCommand).toHaveBeenNthCalledWith(
      5,
      4104,
      'Input.dispatchKeyEvent',
      expect.objectContaining({
        type: 'keyDown',
        key: 'Enter',
        code: 'Enter',
        text: '\r',
        unmodifiedText: '\r',
        windowsVirtualKeyCode: 13,
      }),
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      6,
      4104,
      'Input.dispatchKeyEvent',
      expect.objectContaining({
        type: 'keyUp',
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
      }),
    );
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      executionLane: 'tabrix_cdp_snapshot_locator',
      targetBinding: {
        targetRef: 'ref_fallback_cdp_dom_searchbox_0',
        selector: '#search-input',
        resolutionSource: 'candidate_snapshot_locator_css',
      },
      postconditionVerdict: 'unknown',
      postconditionReason: 'form_submit_or_search_results_not_proven_by_tool_closeout',
    });
  });

  it('marks Enter keyboard dispatch as postcondition-unproven until a fresh read observes state', async () => {
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4110,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(keyboardTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Keyboard operation successful',
    });

    const result = await keyboardTool.execute({
      keys: 'Enter',
      selector: 'input[type=search]',
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      observedOutcome: null,
      postconditionVerdict: 'unknown',
      postconditionReason: 'form_submit_or_search_results_not_proven_by_tool_closeout',
    });
    expect(payload.recommendedNextAction).toContain('chrome_read_page');
    expect(payload.claimBoundary).toContain(
      'does not prove page, form, menu, or search state changed',
    );
  });

  it('refuses Enter without a selector/ref/candidateAction target', async () => {
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4114,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(keyboardTool as any, 'sendMessageToTab');

    const result = await keyboardTool.execute({
      keys: 'Enter',
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'Refusing to send Enter without a target',
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('accepts key as a single-key alias for chrome_keyboard', async () => {
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4111,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(keyboardTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Keyboard operation successful',
    });

    const result = await keyboardTool.execute({
      key: 'Enter',
      selector: 'input[type=search]',
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4111,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
        keys: 'Enter',
        selector: 'input[type=search]',
      }),
      undefined,
    );
  });

  it('targets chrome_keyboard Enter by candidateAction targetRef instead of ambient focus', async () => {
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4112,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(keyboardTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Keyboard operation successful',
    });

    const result = await keyboardTool.execute({
      key: 'Enter',
      candidateAction: {
        id: 'ca_fill_ref_search',
        actionType: 'fill',
        targetRef: 'ref_searchbox',
        intent: 'search.enter_query',
        confidence: 0.9,
        matchReason: 'searchbox candidate',
        locatorChain: [{ type: 'ref', value: 'ref_searchbox' }],
      },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4112,
      expect.objectContaining({
        action: 'focusByRef',
        ref: 'ref_searchbox',
      }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4112,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
        keys: 'Enter',
        ref: 'ref_searchbox',
        selector: undefined,
      }),
      undefined,
    );
  });

  it('uses candidateAction css locator for chrome_keyboard before falling back to ref', async () => {
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4113,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(keyboardTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Keyboard operation successful',
    });

    const result = await keyboardTool.execute({
      key: 'Enter',
      candidateAction: {
        id: 'ca_fill_ref_search',
        actionType: 'fill',
        targetRef: 'ref_searchbox',
        intent: 'search.enter_query',
        confidence: 0.9,
        matchReason: 'searchbox candidate',
        locatorChain: [
          { type: 'ref', value: 'ref_searchbox' },
          { type: 'css', value: '#search-input' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).not.toHaveBeenCalledWith(
      4113,
      expect.objectContaining({
        action: 'focusByRef',
      }),
    );
    expect(sendSpy).toHaveBeenCalledWith(
      4113,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.SIMULATE_KEYBOARD,
        keys: 'Enter',
        selector: '#search-input',
        ref: undefined,
      }),
      undefined,
    );
  });

  it('updates Browser World latest AI operation after click, fill, and keyboard dispatches', async () => {
    mockBrowserWorldTab(4120);
    await getBrowserWorldSnapshot();

    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4120,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(clickTool as any, 'preflightDownloadIntercept').mockResolvedValue({
      interceptedDownload: false,
    });
    vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    await clickTool.execute({ selector: '#open', tabId: 4120 });
    let snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.summary.aiOperationState).toMatchObject({
      latestAiOperatedTabId: 4120,
      latestAiOperation: 'click_element',
      latestAiOperationConfidence: 0.95,
      latestAiOperationReason: 'marked_by_tabrix_tool_execution:click_element',
      relationToBrowserActiveTab: 'same_as_browser_active',
    });

    vi.restoreAllMocks();
    mockBrowserWorldTab(4120);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4120,
      title: 'App',
      url: 'https://example.com/app',
      status: 'complete',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
    });

    await fillTool.execute({ selector: 'input[name=q]', value: 'tabrix', tabId: 4120 });
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.summary.aiOperationState).toMatchObject({
      latestAiOperatedTabId: 4120,
      latestAiOperation: 'fill_or_select',
      latestAiOperationReason: 'marked_by_tabrix_tool_execution:fill_or_select',
    });

    vi.restoreAllMocks();
    mockBrowserWorldTab(4120);
    vi.spyOn(keyboardTool as any, 'tryGetTab').mockResolvedValue({
      id: 4120,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(keyboardTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(keyboardTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Keyboard operation successful',
    });

    await keyboardTool.execute({ keys: 'Enter', selector: 'input[name=q]', tabId: 4120 });
    snapshot = await getBrowserWorldSnapshot();
    expect(snapshot.summary.aiOperationState).toMatchObject({
      latestAiOperatedTabId: 4120,
      latestAiOperation: 'keyboard',
      latestAiOperationReason: 'marked_by_tabrix_tool_execution:keyboard',
    });
  });

  it('retries fill with candidateAction css when a page-local ref is stale or hidden', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4108,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(fillTool as any, 'sendMessageToTab')
      .mockResolvedValueOnce({
        error: 'Element with selector "undefined" is not visible',
      })
      .mockResolvedValueOnce({
        success: true,
        message: 'Fill operation successful',
      });

    const result = await fillTool.execute({
      value: 'tabrix',
      candidateAction: {
        targetRef: 'ref_hidden_search',
        locatorChain: [{ type: 'css', value: 'dialog[open] input[type=search]' }],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_target_ref',
      dispatchTarget: 'selector',
      resolvedFrameId: null,
      frameScope: 'default_frame',
    });
    expect(sendSpy).toHaveBeenNthCalledWith(
      1,
      4108,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        ref: 'ref_hidden_search',
      }),
      undefined,
    );
    expect(sendSpy).toHaveBeenNthCalledWith(
      2,
      4108,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: 'dialog[open] input[type=search]',
      }),
      undefined,
    );
  });

  it('retries fill with candidateAction css when ref dispatch throws before returning a result', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4109,
      title: 'Search',
      url: 'https://example.com/search',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi
      .spyOn(fillTool as any, 'sendMessageToTab')
      .mockRejectedValueOnce(new Error('Element with selector "undefined" is not visible'))
      .mockRejectedValueOnce(new Error('Element with selector "undefined" is not visible'))
      .mockResolvedValueOnce({
        success: true,
        message: 'Fill operation successful',
      });

    const result = await fillTool.execute({
      value: 'tabrix',
      candidateAction: {
        targetRef: 'ref_hidden_search',
        locatorChain: [{ type: 'css', value: 'dialog[open] input[type=search]' }],
      },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenNthCalledWith(
      3,
      4109,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        selector: 'dialog[open] input[type=search]',
      }),
      undefined,
    );
  });

  it('lets computer left_click consume candidateAction.targetRef', async () => {
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4103,
      title: 'Actions',
      url: 'https://code.example/example/project/actions',
    });
    const clickSpy = vi.spyOn(clickTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'left_click',
      candidateAction: {
        targetRef: 'ref_run_detail',
      },
    });

    expect(result.isError).toBe(false);
    expect(clickSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ref: 'ref_run_detail',
      }),
    );
  });

  it('lets computer fill consume candidateAction.locatorChain(css)', async () => {
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4104,
      title: 'Search',
      url: 'https://code.example/example/project/issues',
    });
    const fillSpy = vi.spyOn(fillTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'fill',
      value: 'bug',
      candidateAction: {
        locatorChain: [{ type: 'css', value: 'input[name=q]' }],
      },
    } as any);

    expect(result.isError).toBe(false);
    expect(fillSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: 'input[name=q]',
        value: 'bug',
      }),
    );
  });

  // ----- B-011: stable targetRef bridge coverage --------------------------
  // These tests pin the new contract: a `tgt_*` targetRef must route through
  // the per-tab snapshot registry and never silently fall through to the
  // legacy ref forwarding path.

  it('B-011: resolves click target from stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4201, [{ targetRef: 'tgt_abcdef0123', ref: 'ref_issues_live' }]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4201,
      title: 'Repo',
      url: 'https://code.example/example/project',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'tgt_abcdef0123' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4201,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_issues_live',
      }),
      undefined,
    );
  });

  it('S142: resolves bare fallback targetRef from the latest read_page candidate locator snapshot', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4203, [
      {
        targetRef: 'ref_fallback_6',
        selector: 'nav a[href="/livelist"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4203,
      title: 'Explore',
      url: 'https://example.com/explore',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { urlBefore: 'https://example.com/explore', urlAfter: 'https://example.com/live' },
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_fallback_6',
        label: 'Live',
        intent: 'content.open_detail',
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_snapshot_locator_css',
      dispatchTarget: 'selector',
    });
    expect(sendSpy).toHaveBeenCalledWith(
      4203,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        selector: 'nav a[href="/livelist"]',
      }),
      undefined,
    );
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage.ref).toBeUndefined();
  });

  it('S142: bare fallback targetRef without a read_page locator snapshot still fails closed', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4206,
      title: 'Explore',
      url: 'https://example.com/explore',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_fallback_6',
        label: 'Live',
        intent: 'content.open_detail',
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(true);
    expect(String((result.content?.[0] as any)?.text || '')).toContain(
      'candidateAction did not resolve target',
    );
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('B-012: preserves registry frameId when resolving stable targetRef for click', async () => {
    recordStableTargetRefSnapshot(4212, [
      { targetRef: 'tgt_iframe_btn', ref: 'ref_iframe_button', frameId: 17 },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4212,
      title: 'Framed App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'tgt_iframe_btn' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_stable_target_ref',
      requestedFrameId: null,
      candidateFrameId: null,
      resolvedFrameId: 17,
      frameScope: 'candidate_or_registry_frame',
      dispatchTarget: 'ref',
      stableTargetRefResolved: true,
    });
    expect(payload.targetBinding.claimBoundary).toContain('does not prove business success');
    expect(sendSpy).toHaveBeenCalledWith(
      4212,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_iframe_button',
      }),
      17,
    );
  });

  it('B-011: click fails closed when stable targetRef has no registry mapping', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4202,
      title: 'Repo',
      url: 'https://code.example/example/project',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'tgt_unknown999' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(true);
    const text = String((result.content?.[0] as any)?.text || '');
    expect(text).toContain('tgt_unknown999');
    expect(text).toContain('chrome_read_page');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('B-011: resolves click target when AI passes stable targetRef as ref', async () => {
    recordStableTargetRefSnapshot(4209, [{ targetRef: 'tgt_menu_more', ref: 'ref_more_live' }]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4209,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      ref: 'tgt_menu_more',
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4209,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        ref: 'ref_more_live',
      }),
      undefined,
    );
  });

  it('B-011: ref with unresolved stable targetRef fails before dispatch', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4210,
      title: 'App',
      url: 'https://example.com/app',
    });
    const sendSpy = vi
      .spyOn(clickTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });

    const result = await clickTool.execute({
      ref: 'tgt_missing_menu',
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(true);
    const text = String((result.content?.[0] as any)?.text || '');
    expect(text).toContain('tgt_missing_menu');
    expect(text).toContain('chrome_read_page');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('B-011: legacy ref_* targetRef path is unchanged (regression guard)', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4203,
      title: 'Repo',
      url: 'https://code.example/example/project',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: { targetRef: 'ref_legacy_value' },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4203,
      expect.objectContaining({ ref: 'ref_legacy_value' }),
      undefined,
    );
  });

  it('infers search filter business verification from a bare filter targetRef', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4214, [
      {
        targetRef: 'ref_filter_sort_a1b2c3d4',
        selector: '.filters [data-sort="collections"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4214,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      ref: 'ref_filter_sort_a1b2c3d4',
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.businessVerification).toMatchObject({
      status: 'fresh_read_required',
      candidateActionIntent: 'search.apply_filter.sort',
      expectedEvidence: 'search_results_or_url_query_changed',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      businessSuccessProven: false,
    });
    expect(payload.postActionReadback).toMatchObject({
      candidateActionIntent: 'search.apply_filter.sort',
      expectedEvidence: 'search_results_or_url_query_changed',
      freshReadRequired: true,
    });
    expect(payload.actionEvidenceResult.targetBinding).toMatchObject({
      requestedTargetRef: 'ref_filter_sort_a1b2c3d4',
      resolvedTargetRef: 'ref_filter_sort_a1b2c3d4',
    });
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_snapshot_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.filters [data-sort="collections"]',
      intent: 'search.apply_filter.sort',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('retains filter intent when a floating option is invoked by copied targetRef', async () => {
    recordCandidateActionTargetLocatorsSnapshot(4215, [
      {
        targetRef: 'ref_floating_option_a1b2c3d4',
        selector: '.floating-panel [data-option="latest"]',
      },
    ]);
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4215,
      title: 'Search',
      url: 'https://example.com/search?q=neutral',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      dispatchSucceeded: true,
      signals: { domChanged: true },
    });

    const result = await clickTool.execute({
      ref: 'ref_floating_option_a1b2c3d4',
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.businessVerification).toMatchObject({
      status: 'fresh_read_required',
      candidateActionIntent: 'filter.option_select',
      expectedEvidence: 'search_results_or_url_query_changed',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      businessSuccessProven: false,
    });
    expect(payload.postActionReadback).toMatchObject({
      candidateActionIntent: 'filter.option_select',
      expectedEvidence: 'search_results_or_url_query_changed',
      freshReadRequired: true,
    });
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_snapshot_locator_css',
      dispatchTarget: 'selector',
    });
    const clickMessage = sendSpy.mock.calls.find(
      ([, message]) => (message as any)?.action === TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
    )?.[1] as any;
    expect(clickMessage).toMatchObject({
      selector: '.floating-panel [data-option="latest"]',
      intent: 'filter.option_select',
    });
    expect(clickMessage.ref).toBeUndefined();
  });

  it('uses a safe css locator for synthetic text-menu refs when available', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4208,
      title: 'App',
      url: 'https://example.com/app',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Click operation successful',
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_text_menu_42',
        locatorChain: [
          { type: 'ref', value: 'ref_text_menu_42' },
          { type: 'css', value: 'nav > button:nth-child(2)' },
        ],
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4208,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.CLICK_ELEMENT,
        selector: 'nav > button:nth-child(2)',
      }),
      undefined,
    );
  });

  it('uses a safe css locator for fallback refs when available', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4211,
      title: 'Example',
      url: 'https://example.com/',
    });
    vi.spyOn(clickTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(clickTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
    });

    const result = await clickTool.execute({
      candidateAction: {
        targetRef: 'ref_fallback_1',
        locatorChain: [{ type: 'css', value: 'body > div > p:nth-of-type(2) > a' }],
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4211,
      expect.objectContaining({
        selector: 'body > div > p:nth-of-type(2) > a',
      }),
      undefined,
    );
  });

  it('B-011: fill resolves stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4204, [{ targetRef: 'tgt_email00001', ref: 'ref_email_live' }]);
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4204,
      title: 'Login',
      url: 'https://example.com/login',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
    });

    const result = await fillTool.execute({
      value: 'alice@example.com',
      candidateAction: { targetRef: 'tgt_email00001' },
    });

    expect(result.isError).toBe(false);
    expect(sendSpy).toHaveBeenCalledWith(
      4204,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        ref: 'ref_email_live',
      }),
      undefined,
    );
  });

  it('B-012: preserves candidateAction frameId when filling a frame-local ref', async () => {
    vi.spyOn(fillTool as any, 'tryGetTab').mockResolvedValue({
      id: 4213,
      title: 'Framed Form',
      url: 'https://example.com/form',
    });
    vi.spyOn(fillTool as any, 'injectContentScript').mockResolvedValue(undefined);
    const sendSpy = vi.spyOn(fillTool as any, 'sendMessageToTab').mockResolvedValue({
      success: true,
      message: 'Fill operation successful',
    });

    const result = await fillTool.execute({
      value: 'tabrix',
      candidateAction: { targetRef: 'ref_inside_frame', frameId: 22 },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload.targetBinding).toMatchObject({
      resolutionSource: 'candidate_target_ref',
      requestedFrameId: null,
      candidateFrameId: 22,
      resolvedFrameId: 22,
      frameScope: 'candidate_or_registry_frame',
      dispatchTarget: 'ref',
      stableTargetRefResolved: null,
    });
    expect(sendSpy).toHaveBeenCalledWith(
      4213,
      expect.objectContaining({
        action: TOOL_MESSAGE_TYPES.FILL_ELEMENT,
        ref: 'ref_inside_frame',
      }),
      22,
    );
  });

  it('B-011: computer left_click resolves stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4205, [
      { targetRef: 'tgt_runabcd000', ref: 'ref_run_live', frameId: 23 },
    ]);
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4205,
      title: 'Actions',
      url: 'https://code.example/example/project/actions',
    });
    const clickSpy = vi.spyOn(clickTool, 'execute').mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ success: true }) }],
      isError: false,
    });

    const result = await computerTool.execute({
      action: 'left_click',
      candidateAction: { targetRef: 'tgt_runabcd000' },
    });

    expect(result.isError).toBe(false);
    expect(clickSpy).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'ref_run_live', frameId: 23 }),
    );
  });
});
