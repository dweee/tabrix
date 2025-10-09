import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from 'chrome-mcp-shared';

interface HandleDialogParams {
  action: 'accept' | 'dismiss';
  promptText?: string;
}

/**
 * Handle JavaScript dialogs (alert/confirm/prompt) via CDP Page.handleJavaScriptDialog
 */
class HandleDialogTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.HANDLE_DIALOG;

  async execute(args: HandleDialogParams): Promise<ToolResult> {
    const { action, promptText } = args || ({} as HandleDialogParams);
    if (!action || (action !== 'accept' && action !== 'dismiss')) {
      return createErrorResponse('action must be "accept" or "dismiss"');
    }

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) return createErrorResponse('No active tab found');

      // Attach debugger and try handling the dialog
      try {
        await chrome.debugger.attach({ tabId: activeTab.id }, '1.3');
      } catch (e: any) {
        if (String(e?.message || '').includes('attached')) {
          // If already attached by us, proceed; otherwise fail with clear message
          const targets = await chrome.debugger.getTargets();
          const existing = targets.find((t) => t.tabId === activeTab.id && t.attached);
          if (!existing || existing.extensionId !== chrome.runtime.id) {
            return createErrorResponse(
              `Debugger already attached to tab ${activeTab.id} by another client (e.g., DevTools). Close it and retry.`,
            );
          }
        } else {
          throw e;
        }
      }

      try {
        // Enable Page domain to be safe
        await chrome.debugger.sendCommand({ tabId: activeTab.id }, 'Page.enable');
        await chrome.debugger.sendCommand({ tabId: activeTab.id }, 'Page.handleJavaScriptDialog', {
          accept: action === 'accept',
          promptText: action === 'accept' ? promptText : undefined,
        });
      } finally {
        // Best-effort detach if we were the owners
        try {
          await chrome.debugger.detach({ tabId: activeTab.id });
        } catch {
          // ignore
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: true, action, promptText: promptText || null }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Failed to handle dialog: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const handleDialogTool = new HandleDialogTool();
