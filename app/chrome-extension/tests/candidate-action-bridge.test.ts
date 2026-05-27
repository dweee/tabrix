import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { clickTool, fillTool } from '@/entrypoints/background/tools/browser/interaction';
import { computerTool } from '@/entrypoints/background/tools/browser/computer';
import { keyboardTool } from '@/entrypoints/background/tools/browser/keyboard';
import {
  __resetStableTargetRefRegistryForTests,
  recordStableTargetRefSnapshot,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';

describe('candidateAction bridge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetStableTargetRefRegistryForTests();
  });

  it('resolves click target from candidateAction.targetRef', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4101,
      title: 'Repo',
      url: 'https://github.com/example/project',
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
      },
      allowDownloadClick: true,
    });

    expect(result.isError).toBe(false);
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
    expect(injectSpy).toHaveBeenCalledWith(4106, ['inject-scripts/accessibility-tree-helper.js']);
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
    expect(payload.verification.requiresFreshReadPage).toBe(true);
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
    });

    const result = await fillTool.execute({
      value: 'alice@example.com',
      candidateAction: {
        locatorChain: [
          { type: 'aria', value: 'Email' },
          { type: 'css', value: 'input[name=email]' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = JSON.parse(String((result.content?.[0] as any)?.text || '{}'));
    expect(payload).toMatchObject({
      success: true,
      observedOutcome: null,
      postconditionVerdict: 'unknown',
      postconditionReason: 'form_input_state_change_not_proven_by_tool_closeout',
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
      url: 'https://github.com/example/project/actions',
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
      url: 'https://github.com/example/project/issues',
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
      url: 'https://github.com/example/project',
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

  it('B-011: click fails closed when stable targetRef has no registry mapping', async () => {
    vi.spyOn(clickTool as any, 'tryGetTab').mockResolvedValue({
      id: 4202,
      title: 'Repo',
      url: 'https://github.com/example/project',
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
      url: 'https://github.com/example/project',
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

  it('B-011: computer left_click resolves stable targetRef via registry', async () => {
    recordStableTargetRefSnapshot(4205, [{ targetRef: 'tgt_runabcd000', ref: 'ref_run_live' }]);
    vi.spyOn(computerTool as any, 'tryGetTab').mockResolvedValue({
      id: 4205,
      title: 'Actions',
      url: 'https://github.com/example/project/actions',
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
    expect(clickSpy).toHaveBeenCalledWith(expect.objectContaining({ ref: 'ref_run_live' }));
  });
});
