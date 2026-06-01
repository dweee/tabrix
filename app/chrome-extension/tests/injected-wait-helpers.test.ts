// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type RuntimeListener = (
  request: Record<string, unknown>,
  sender: unknown,
  sendResponse: (payload: unknown) => void,
) => boolean | void;

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

function installInjectedHelper(sourcePath: string, initializedKey: string): RuntimeListener {
  let listener: RuntimeListener | null = null;
  delete (window as Window & Record<string, unknown>)[initializedKey];

  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((entry: RuntimeListener) => {
    listener = entry;
  }) as typeof runtime.onMessage.addListener;

  window.eval(readFileSync(resolve(process.cwd(), sourcePath), 'utf8'));
  if (!listener) throw new Error(`${sourcePath} listener did not register`);
  return listener;
}

async function sendRequest(listener: RuntimeListener, request: Record<string, unknown>) {
  return await new Promise<any>((resolve) => {
    listener(request, {}, resolve);
  });
}

describe('injected state-driven waits', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Element.prototype.scrollIntoView = vi.fn();
    document.elementFromPoint = vi.fn(() => null);
    (window as Window & { CSS: { escape: (value: string) => string } }).CSS = {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    };
  });

  it('fill scroll readiness returns before the 150ms cap when the element is already stable', async () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    const input = document.getElementById('name') as HTMLInputElement;
    setRect(input, { left: 20, top: 30, width: 180, height: 28 });
    document.elementFromPoint = vi.fn(() => input);

    const listener = installInjectedHelper(
      'inject-scripts/fill-helper.js',
      '__FILL_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'fillElement',
      selector: '#name',
      value: 'Tabrix',
    });

    expect(response.success).toBe(true);
    expect(response.elementInfo.waitDiagnostics.scroll.reason).toBe('ready');
    expect(response.elementInfo.waitDiagnostics.scroll.waitedMs).toBeLessThan(150);
    expect(response.elementInfo.valueState).toBe('non_empty');
    expect(response.elementInfo).not.toHaveProperty('value');
    expect(JSON.stringify(response)).not.toContain('Tabrix');
  });

  it('keyboard focus readiness returns immediately once focus is observable', async () => {
    document.body.innerHTML = '<input id="name" type="text" />';
    const input = document.getElementById('name') as HTMLInputElement;
    setRect(input, { left: 20, top: 30, width: 180, height: 28 });

    const listener = installInjectedHelper(
      'inject-scripts/keyboard-helper.js',
      '__KEYBOARD_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'simulateKeyboard',
      selector: '#name',
      keys: '',
      delay: 0,
    });

    expect(response.success).toBe(true);
    expect(response.targetElement.waitDiagnostics.focus.ready).toBe(true);
    expect(response.targetElement.waitDiagnostics.focus.waitedMs).toBeLessThan(100);
  });

  it('interactive element search returns the visible OTP sender span before label-derived input matches', async () => {
    document.body.innerHTML = `
      <form>
        <label class="auth-code">
          <input id="otp" type="number" placeholder="输入验证码" />
          <span id="send" class="code-button active">获取验证码</span>
        </label>
      </form>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    const label = document.querySelector('label') as HTMLLabelElement;
    const input = document.getElementById('otp') as HTMLInputElement;
    const send = document.getElementById('send') as HTMLSpanElement;
    setRect(form, { left: 20, top: 20, width: 260, height: 48 });
    setRect(label, { left: 20, top: 20, width: 260, height: 40 });
    setRect(input, { left: 20, top: 20, width: 170, height: 40 });
    setRect(send, { left: 190, top: 20, width: 90, height: 40 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '获取验证码',
      includeCoordinates: true,
    });

    expect(response.success).toBe(true);
    expect(response.elements[0]).toMatchObject({
      tagName: 'span',
      selector: '#send',
      text: '获取验证码',
      actionability: 'actionable',
    });
    expect(
      response.elements.some(
        (element: any) =>
          element.tagName === 'input' &&
          element.text === '获取验证码' &&
          element.actionability === 'actionable',
      ),
    ).toBe(false);
  });

  it('interactive element search keeps a phone input reachable when its label only adds country code chrome', async () => {
    document.body.innerHTML = `
      <form>
        <label class="phone">
          <span class="country-code">+86</span>
          <input id="phone" type="text" name="phone" placeholder="输入手机号" />
          <span data-placeholder="svg-icon">[SVG Icon]</span>
        </label>
      </form>
    `;
    const form = document.querySelector('form') as HTMLFormElement;
    const label = document.querySelector('label') as HTMLLabelElement;
    const input = document.getElementById('phone') as HTMLInputElement;
    setRect(form, { left: 20, top: 20, width: 260, height: 48 });
    setRect(label, { left: 20, top: 20, width: 260, height: 40 });
    setRect(input, { left: 62, top: 20, width: 170, height: 40 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '输入手机号',
      includeCoordinates: true,
    });

    expect(response.success).toBe(true);
    expect(response.elements[0]).toMatchObject({
      tagName: 'input',
      selector: '#phone',
      text: '输入手机号',
      matchSource: 'placeholder',
      actionability: 'actionable',
      valueState: 'empty',
    });
  });
});
