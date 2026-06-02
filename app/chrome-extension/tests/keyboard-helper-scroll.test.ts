import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadKeyboardHelper() {
  vi.resetModules();
  await import('../inject-scripts/keyboard-helper.js');
}

function dispatchKeyboard(request: Record<string, unknown>) {
  const addListener = chrome.runtime.onMessage.addListener as unknown as ReturnType<typeof vi.fn>;
  const listener = addListener.mock.calls.at(-1)?.[0] as
    | ((request: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean)
    | undefined;
  if (!listener) {
    throw new Error('keyboard helper listener was not registered');
  }
  return new Promise<Record<string, unknown>>((resolve) => {
    listener(request, {}, (response) => resolve(response as Record<string, unknown>));
  });
}

describe('keyboard helper scroll diagnostics', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    delete (window as typeof window & { __KEYBOARD_HELPER_INITIALIZED__?: boolean })
      .__KEYBOARD_HELPER_INITIALIZED__;
    document.body.innerHTML = '<main style="height: 4000px">Scrollable page</main>';
    Object.defineProperty(document.documentElement, 'clientHeight', {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 4000,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 800,
    });
    window.scrollTo = vi.fn((_x: number, y: number) => {
      document.documentElement.scrollTop = y;
    });
    window.scrollBy = vi.fn((_x: number, y: number) => {
      document.documentElement.scrollTop += y;
    });
    await loadKeyboardHelper();
  });

  it('falls back to page scroll when synthetic PageDown does not move the viewport', async () => {
    const response = await dispatchKeyboard({
      action: 'simulateKeyboard',
      keys: 'PageDown',
    });
    expect(response.success).toBe(true);
    const results = response.results as Array<{
      scrollDiagnostics: {
        changed: boolean;
        fallback: { applied: boolean; reason: string; deltaY: number } | null;
      };
    }>;
    expect(results[0].scrollDiagnostics).toMatchObject({
      changed: true,
      fallback: {
        applied: true,
        reason: 'synthetic_keyboard_did_not_scroll_page',
        deltaY: 680,
      },
    });
    expect(document.documentElement.scrollTop).toBeGreaterThan(0);
  });

  it('falls back to the focused scroll container when the document cannot scroll', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 800,
    });
    document.body.innerHTML = `
      <textarea id="conversation" class="conversation-scroll-area"></textarea>
    `;
    const textarea = document.querySelector('#conversation') as HTMLTextAreaElement;
    Object.defineProperty(textarea, 'clientHeight', {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      value: 1200,
    });
    textarea.focus();

    const response = await dispatchKeyboard({
      action: 'simulateKeyboard',
      keys: 'PageDown',
    });

    expect(response.success).toBe(true);
    const results = response.results as Array<{
      scrollDiagnostics: {
        changed: boolean;
        fallback: {
          applied: boolean;
          reason: string;
          targetKind: string;
          targetTagName: string;
          targetId: string;
        } | null;
      };
    }>;
    expect(results[0].scrollDiagnostics).toMatchObject({
      changed: true,
      fallback: {
        applied: true,
        reason: 'synthetic_keyboard_did_not_scroll_container',
        targetKind: 'element',
        targetTagName: 'TEXTAREA',
        targetId: 'conversation',
      },
    });
    expect(textarea.scrollTop).toBeGreaterThan(0);
  });

  it('focuses a selector target before dispatching keyboard events', async () => {
    document.body.innerHTML = `
      <input id="search" value="tabrix" />
    `;
    const input = document.querySelector('#search') as HTMLInputElement;
    input.scrollIntoView = vi.fn();

    const response = await dispatchKeyboard({
      action: 'simulateKeyboard',
      selector: '#search',
      keys: 'Enter',
    });

    expect(response.success).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(input.scrollIntoView).toHaveBeenCalled();
    const targetElement = response.targetElement as {
      waitDiagnostics?: { focus?: { ready?: boolean } };
    };
    expect(targetElement.waitDiagnostics?.focus?.ready).toBe(true);
  });
});
