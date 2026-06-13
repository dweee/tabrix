import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screenshotTool } from '@/entrypoints/background/tools/browser/screenshot';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';

describe('screenshot tool target binding', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('activates and proves the requested tab before captureVisibleTab', async () => {
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue({
      id: 77,
      windowId: 5,
      active: true,
      status: 'complete',
      url: 'https://example.com/create',
    } as chrome.tabs.Tab);
    vi.spyOn(chrome.windows, 'get').mockResolvedValue({
      id: 5,
      focused: true,
      state: 'normal',
      type: 'normal',
    } as chrome.windows.Window);
    const windowUpdate = vi.spyOn(chrome.windows, 'update').mockResolvedValue({
      id: 5,
      focused: true,
    } as chrome.windows.Window);
    const tabUpdate = vi.spyOn(chrome.tabs, 'update').mockResolvedValue({
      id: 77,
      windowId: 5,
      active: true,
    } as chrome.tabs.Tab);
    const documentProbe = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([
      {
        result: {
          visibilityState: 'visible',
          hasFocus: true,
          hidden: false,
        },
      },
    ] as any);
    vi.spyOn(screenshotTool as any, 'injectContentScript').mockResolvedValue(undefined);
    vi.spyOn(screenshotTool as any, 'sendMessageToTab').mockImplementation(
      async (_tabId: number, message: { action?: string }) => {
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_PREPARE_PAGE_FOR_CAPTURE) {
          return { success: true };
        }
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_GET_PAGE_DETAILS) {
          return {
            totalWidth: 1200,
            totalHeight: 900,
            viewportWidth: 1200,
            viewportHeight: 900,
            devicePixelRatio: 1,
            currentScrollX: 0,
            currentScrollY: 0,
          };
        }
        if (message.action === TOOL_MESSAGE_TYPES.SCREENSHOT_RESET_PAGE_AFTER_CAPTURE) {
          return { success: true };
        }
        return { success: true };
      },
    );
    const captureVisibleTab = vi
      .spyOn(chrome.tabs, 'captureVisibleTab')
      .mockResolvedValue('data:image/png;base64,ok');

    const result = await screenshotTool.execute({
      name: 'target-tab-proof',
      tabId: 77,
      savePng: false,
    });

    expect(result.isError).toBe(false);
    expect(windowUpdate).toHaveBeenCalledWith(5, { focused: true });
    expect(tabUpdate).toHaveBeenCalledWith(77, { active: true });
    expect(documentProbe).not.toHaveBeenCalled();
    expect(captureVisibleTab).toHaveBeenCalledWith(5, { format: 'png' });
    expect(tabUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      captureVisibleTab.mock.invocationCallOrder[0],
    );

    const payload = JSON.parse(result.content[0].text);
    expect(payload.visibleCaptureTargetProof).toMatchObject({
      kind: 'screenshot_visible_capture_target_v1',
      tabId: 77,
      windowId: 5,
      activated: true,
      windowFocused: true,
      captureTargetProven: true,
      foregroundActivationVerdict: 'proven_foreground',
      documentVisibilityState: null,
      documentHasFocus: null,
    });
  });

  it('captures its own extension page without injecting a content script', async () => {
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue({
      id: 88,
      windowId: 6,
      active: true,
      status: 'complete',
      url: 'chrome-extension://test-extension-id/sidepanel.html',
      width: 620,
      height: 900,
    } as chrome.tabs.Tab);
    vi.spyOn(chrome.windows, 'get').mockResolvedValue({
      id: 6,
      focused: true,
      state: 'normal',
      type: 'normal',
    } as chrome.windows.Window);
    vi.spyOn(chrome.windows, 'update').mockResolvedValue({
      id: 6,
      focused: true,
    } as chrome.windows.Window);
    vi.spyOn(chrome.tabs, 'update').mockResolvedValue({
      id: 88,
      windowId: 6,
      active: true,
    } as chrome.tabs.Tab);
    const documentProbe = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([
      {
        result: {
          visibilityState: 'visible',
          hasFocus: true,
          hidden: false,
        },
      },
    ] as any);
    const injectContentScript = vi
      .spyOn(screenshotTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendMessageToTab = vi
      .spyOn(screenshotTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });
    const captureVisibleTab = vi
      .spyOn(chrome.tabs, 'captureVisibleTab')
      .mockResolvedValue('data:image/png;base64,ok');

    const result = await screenshotTool.execute({
      name: 'tabrix-sidepanel',
      tabId: 88,
      savePng: false,
    });

    expect(result.isError).toBe(false);
    expect(documentProbe).not.toHaveBeenCalled();
    expect(injectContentScript).not.toHaveBeenCalled();
    expect(sendMessageToTab).not.toHaveBeenCalled();
    expect(captureVisibleTab).toHaveBeenCalledWith(6, { format: 'png' });

    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 88,
      url: 'chrome-extension://test-extension-id/sidepanel.html',
    });
    expect(payload.visibleCaptureTargetProof).toMatchObject({
      kind: 'screenshot_visible_capture_target_v1',
      tabId: 88,
      windowId: 6,
      captureTargetProven: true,
    });
  });

  it('captures a regular page visible viewport without injecting the screenshot helper', async () => {
    vi.spyOn(chrome.tabs, 'get').mockResolvedValue({
      id: 89,
      windowId: 7,
      active: true,
      status: 'complete',
      url: 'https://example.com/article',
      width: 1280,
      height: 720,
    } as chrome.tabs.Tab);
    vi.spyOn(chrome.windows, 'get').mockResolvedValue({
      id: 7,
      focused: true,
      state: 'normal',
      type: 'normal',
    } as chrome.windows.Window);
    vi.spyOn(chrome.windows, 'update').mockResolvedValue({
      id: 7,
      focused: true,
    } as chrome.windows.Window);
    vi.spyOn(chrome.tabs, 'update').mockResolvedValue({
      id: 89,
      windowId: 7,
      active: true,
    } as chrome.tabs.Tab);
    const documentProbe = vi.spyOn(chrome.scripting, 'executeScript').mockResolvedValue([
      {
        result: {
          visibilityState: 'visible',
          hasFocus: true,
          hidden: false,
        },
      },
    ] as any);
    const injectContentScript = vi
      .spyOn(screenshotTool as any, 'injectContentScript')
      .mockResolvedValue(undefined);
    const sendMessageToTab = vi
      .spyOn(screenshotTool as any, 'sendMessageToTab')
      .mockResolvedValue({ success: true });
    const captureVisibleTab = vi
      .spyOn(chrome.tabs, 'captureVisibleTab')
      .mockResolvedValue('data:image/png;base64,ok');

    const result = await screenshotTool.execute({
      name: 'regular-visible-page',
      tabId: 89,
      savePng: false,
    });

    expect(result.isError).toBe(false);
    expect(documentProbe).not.toHaveBeenCalled();
    expect(injectContentScript).not.toHaveBeenCalled();
    expect(sendMessageToTab).not.toHaveBeenCalled();
    expect(captureVisibleTab).toHaveBeenCalledWith(7, { format: 'png' });

    const payload = JSON.parse(result.content[0].text);
    expect(payload).toMatchObject({
      success: true,
      tabId: 89,
      url: 'https://example.com/article',
    });
  });
});
