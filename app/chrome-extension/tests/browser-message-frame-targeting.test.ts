import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '@/entrypoints/background/tools/base-browser';
import { createChromeSelectorLocatorTransport } from '@/shared/selector/locator';

class TestBrowserTool extends BaseBrowserToolExecutor {
  name = 'test_browser';

  async execute(): Promise<ToolResult> {
    return { content: [] };
  }

  send(tabId: number, message: Record<string, unknown>, frameId?: number): Promise<unknown> {
    return this.sendMessageToTab(tabId, message, frameId);
  }

  inject(tabId: number, frameIds?: number[]): Promise<void> {
    return this.injectContentScript(
      tabId,
      ['inject-scripts/test-helper.js'],
      false,
      'ISOLATED',
      false,
      frameIds,
    );
  }
}

describe('browser message frame targeting', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('targets the top frame when a browser tool message omits frameId', async () => {
    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ success: true });
    const tool = new TestBrowserTool();

    await tool.send(42, { action: 'resolveTarget' });

    expect(sendMessage).toHaveBeenCalledWith(42, { action: 'resolveTarget' }, { frameId: 0 });
  });

  it('preserves an explicit child frame for browser tool messages', async () => {
    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ success: true });
    const tool = new TestBrowserTool();

    await tool.send(42, { action: 'resolveTarget' }, 7);

    expect(sendMessage).toHaveBeenCalledWith(42, { action: 'resolveTarget' }, { frameId: 7 });
  });

  it('targets the top frame for injection pings before injecting the top frame', async () => {
    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ status: 'pong' });
    const executeScript = vi.spyOn(chrome.scripting, 'executeScript');
    const tool = new TestBrowserTool();

    await tool.inject(42);

    expect(sendMessage).toHaveBeenCalledWith(42, { action: 'test_browser_ping' }, { frameId: 0 });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('targets the top frame for selector locator messages unless a child frame is explicit', async () => {
    const sendMessage = vi.spyOn(chrome.tabs, 'sendMessage').mockResolvedValue({ success: true });
    const transport = createChromeSelectorLocatorTransport();
    const message = { action: 'ensureRefForSelector' as const, selector: '.filter-trigger' };

    await transport.sendMessage(42, message);
    await transport.sendMessage(42, message, { frameId: 9 });

    expect(sendMessage).toHaveBeenNthCalledWith(1, 42, message, { frameId: 0 });
    expect(sendMessage).toHaveBeenNthCalledWith(2, 42, message, { frameId: 9 });
  });
});
