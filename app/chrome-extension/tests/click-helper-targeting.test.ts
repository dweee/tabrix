// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const clickHelperSource = readFileSync(
  resolve(process.cwd(), 'inject-scripts/click-helper.js'),
  'utf8',
);

type RuntimeListener = (
  request: Record<string, unknown>,
  sender: unknown,
  sendResponse: (payload: unknown) => void,
) => boolean | void;

let messageListener: RuntimeListener | null = null;
const OriginalMouseEvent = globalThis.MouseEvent;
const OriginalPointerEvent = (
  globalThis as typeof globalThis & { PointerEvent?: typeof MouseEvent }
).PointerEvent;

function installClickHelper() {
  messageListener = null;
  delete (window as Window & { __CLICK_HELPER_INITIALIZED__?: boolean })
    .__CLICK_HELPER_INITIALIZED__;
  delete (window as Window & { __TABRIX_CLICK_HELPER_VERSION__?: string })
    .__TABRIX_CLICK_HELPER_VERSION__;
  delete (window as Window & { __TABRIX_CLICK_HELPER_MESSAGE_HANDLER__?: RuntimeListener })
    .__TABRIX_CLICK_HELPER_MESSAGE_HANDLER__;
  (
    window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> }
  ).__claudeElementMap = {};

  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((listener: RuntimeListener) => {
    messageListener = listener;
  }) as typeof runtime.onMessage.addListener;

  window.eval(clickHelperSource);

  if (!messageListener) {
    throw new Error('click-helper listener did not register');
  }
}

function setRect(element: Element, rect: Partial<DOMRect> = {}) {
  const resolved = {
    x: rect.x ?? rect.left ?? 0,
    y: rect.y ?? rect.top ?? 0,
    width: rect.width ?? 100,
    height: rect.height ?? 32,
    top: rect.top ?? 0,
    left: rect.left ?? 0,
    right: rect.right ?? (rect.left ?? 0) + (rect.width ?? 100),
    bottom: rect.bottom ?? (rect.top ?? 0) + (rect.height ?? 32),
    toJSON: () => ({}),
  } satisfies DOMRect;
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => resolved,
  });
}

async function sendClickRequest(request: Record<string, unknown>) {
  if (!messageListener) {
    throw new Error('click-helper listener is unavailable');
  }
  return await new Promise<any>((resolve) => {
    messageListener?.(request, {}, resolve);
  });
}

describe('click-helper targeting', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.elementFromPoint = vi.fn(() => null);
    Element.prototype.scrollIntoView = vi.fn();
    class TestMouseEvent extends Event {
      clientX: number;
      clientY: number;
      button: number;
      buttons: number;
      constructor(type: string, init: Record<string, unknown> = {}) {
        super(type, {
          bubbles: init.bubbles !== false,
          cancelable: init.cancelable !== false,
        });
        this.clientX = Number(init.clientX || 0);
        this.clientY = Number(init.clientY || 0);
        this.button = Number(init.button || 0);
        this.buttons = Number(init.buttons || 0);
      }
    }
    (globalThis as typeof globalThis & { MouseEvent: typeof OriginalMouseEvent }).MouseEvent =
      TestMouseEvent as unknown as typeof OriginalMouseEvent;
    (globalThis as typeof globalThis & { PointerEvent: typeof TestMouseEvent }).PointerEvent =
      TestMouseEvent;
    installClickHelper();
  });

  afterEach(() => {
    (globalThis as typeof globalThis & { MouseEvent: typeof OriginalMouseEvent }).MouseEvent =
      OriginalMouseEvent;
    (globalThis as typeof globalThis & { PointerEvent?: typeof MouseEvent }).PointerEvent =
      OriginalPointerEvent;
  });

  it('fires one click event for native clickable elements', async () => {
    document.body.innerHTML = '<button id="btn"><span id="label">Open</span></button>';
    const button = document.getElementById('btn') as HTMLButtonElement;
    const label = document.getElementById('label') as HTMLSpanElement;
    setRect(button, { left: 20, top: 30, width: 120, height: 32 });
    setRect(label, { left: 24, top: 34, width: 70, height: 18 });
    document.elementFromPoint = vi.fn(() => button);

    let clickCount = 0;
    button.addEventListener('click', () => {
      clickCount += 1;
    });

    const result = await sendClickRequest({
      action: 'clickElement',
      selector: '#btn',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(result.success).toBe(true);
    expect(clickCount).toBe(1);
  });

  it('dispatches plain div clicks without calling the element native click method', async () => {
    document.body.innerHTML = '<div id="filter">Most saved</div>';
    const filter = document.getElementById('filter') as HTMLDivElement;
    setRect(filter, { left: 20, top: 30, width: 120, height: 32 });
    document.elementFromPoint = vi.fn(() => filter);

    let clickCount = 0;
    const nativeClick = vi.fn();
    Object.defineProperty(filter, 'click', {
      configurable: true,
      value: nativeClick,
    });
    filter.addEventListener('click', () => {
      clickCount += 1;
    });

    const result = await sendClickRequest({
      action: 'clickElement',
      selector: '#filter',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(result.success).toBe(true);
    expect(nativeClick).not.toHaveBeenCalled();
    expect(clickCount).toBe(1);
  });

  it('returns promptly after dispatch when the page document is hidden', async () => {
    document.body.innerHTML = '<div id="filter">Unread</div>';
    const filter = document.getElementById('filter') as HTMLDivElement;
    setRect(filter, { left: 20, top: 30, width: 120, height: 32 });
    document.elementFromPoint = vi.fn(() => filter);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });

    let clickCount = 0;
    filter.addEventListener('click', () => {
      clickCount += 1;
    });

    const result = await sendClickRequest({
      action: 'clickElement',
      selector: '#filter',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(result.success).toBe(true);
    expect(clickCount).toBe(1);
    expect(result.signals.waitDiagnostics.verification.reason).toBe('hidden_document_fast_path');
  });

  it('keeps actionable option refs instead of promoting them to combobox shells', async () => {
    document.body.innerHTML = `
      <div class="arco-select-view" id="combo">
        <div class="arco-select-popup">
          <div role="option" id="opt">Option A</div>
        </div>
      </div>
    `;
    const combo = document.getElementById('combo') as HTMLDivElement;
    const option = document.getElementById('opt') as HTMLDivElement;
    setRect(combo, { left: 10, top: 10, width: 220, height: 140 });
    setRect(option, { left: 18, top: 48, width: 180, height: 28 });
    document.elementFromPoint = vi.fn(() => option);

    (
      window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> }
    ).__claudeElementMap = {
      optionRef: new WeakRef(option),
    };

    let directComboClicks = 0;
    let directOptionClicks = 0;
    combo.addEventListener('click', (event) => {
      if (event.target === combo) {
        directComboClicks += 1;
      }
    });
    option.addEventListener('click', (event) => {
      if (event.target === option) {
        directOptionClicks += 1;
      }
    });

    const result = await sendClickRequest({
      action: 'clickElement',
      ref: 'optionRef',
      waitForNavigation: false,
      timeout: 1000,
    });

    expect(result.success).toBe(true);
    expect(directOptionClicks).toBe(1);
    expect(directComboClicks).toBe(0);
  });

  it('reinstalls the message listener when a stale initialized flag survived reload', async () => {
    messageListener = null;
    (window as Window & { __CLICK_HELPER_INITIALIZED__?: boolean }).__CLICK_HELPER_INITIALIZED__ =
      true;
    delete (window as Window & { __TABRIX_CLICK_HELPER_VERSION__?: string })
      .__TABRIX_CLICK_HELPER_VERSION__;

    const runtime = (globalThis.chrome as typeof chrome).runtime;
    const addListener = vi.fn((listener: RuntimeListener) => {
      messageListener = listener;
    }) as typeof runtime.onMessage.addListener;
    runtime.onMessage.addListener = addListener;

    window.eval(clickHelperSource);

    expect(addListener).toHaveBeenCalledTimes(1);
    expect(messageListener).toBeTypeOf('function');

    const result = await sendClickRequest({
      action: 'chrome_click_element_ping',
    });
    expect(result).toEqual({ status: 'pong' });
  });
});
