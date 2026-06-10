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
    const nativeValueDescriptor = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    );
    const ownValueSetter = vi.fn((nextValue: string) => {
      nativeValueDescriptor?.set?.call(input, nextValue);
    });
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => nativeValueDescriptor?.get?.call(input),
      set: ownValueSetter,
    });
    const inputTypes: Array<string | undefined> = [];
    input.addEventListener('input', (event) => {
      inputTypes.push((event as InputEvent).inputType);
    });

    const listener = installInjectedHelper(
      'inject-scripts/fill-helper.js',
      '__FILL_HELPER_INITIALIZED__',
    );
    try {
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
      expect(ownValueSetter).not.toHaveBeenCalled();
      expect(inputTypes).toEqual(['deleteContentBackward', 'insertText']);
    } finally {
      delete (input as HTMLInputElement & { value?: string }).value;
    }
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

  it('interactive element search returns a nested agreement confirmation action', async () => {
    document.body.innerHTML = `
      <div id="modal" class="agreement-modal" onclick="void 0">
        <div class="body">阅读并同意《用户协议》《隐私政策》</div>
        <div id="confirm" class="modal-action">
          <span>同意并继续</span>
        </div>
        <div class="modal-action">取消</div>
      </div>
    `;
    const modal = document.querySelector('.agreement-modal') as HTMLDivElement;
    const confirm = document.getElementById('confirm') as HTMLDivElement;
    const span = confirm.querySelector('span') as HTMLSpanElement;
    setRect(modal, { left: 320, top: 180, width: 360, height: 240 });
    setRect(confirm, { left: 500, top: 350, width: 128, height: 40 });
    setRect(span, { left: 520, top: 360, width: 88, height: 20 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '同意并继续',
      includeCoordinates: true,
    });

    expect(response.success).toBe(true);
    expect(response.elements[0]).toMatchObject({
      text: '同意并继续',
      actionability: 'actionable',
    });
    expect(response.elements[0].selector).toMatch(/#confirm|span/);
    expect(response.elements.map((element: any) => element.selector)).not.toContain('#modal');
  });

  it('interactive element selector search still honors the text query', async () => {
    document.body.innerHTML = `
      <div>
        <span id="phone">输入手机号</span>
        <span id="confirm">同意并继续</span>
        <span id="cancel">取消</span>
      </div>
    `;
    Array.from(document.querySelectorAll('span')).forEach((element, index) => {
      setRect(element, { left: 20, top: 20 + index * 40, width: 120, height: 28 });
    });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      selector: 'span',
      textQuery: '同意并继续',
      includeCoordinates: false,
    });

    expect(response.success).toBe(true);
    expect(response.elements).toHaveLength(1);
    expect(response.elements[0]).toMatchObject({
      selector: '#confirm',
      text: '同意并继续',
    });
  });

  it('interactive element search promotes compact visible filter chips as actionable targets', async () => {
    document.body.innerHTML = `
      <div id="toolbar">
        <span id="filter-chip">筛选</span>
      </div>
      <div id="menu">
        <span id="most-saved">最多收藏</span>
      </div>
    `;
    const toolbar = document.getElementById('toolbar') as HTMLDivElement;
    const filterChip = document.getElementById('filter-chip') as HTMLSpanElement;
    const menu = document.getElementById('menu') as HTMLDivElement;
    const mostSaved = document.getElementById('most-saved') as HTMLSpanElement;
    setRect(toolbar, { left: 20, top: 20, width: 140, height: 36 });
    setRect(filterChip, { left: 36, top: 26, width: 44, height: 22 });
    setRect(menu, { left: 20, top: 64, width: 220, height: 180 });
    setRect(mostSaved, { left: 40, top: 150, width: 72, height: 24 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const filterResponse = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '筛选',
      includeCoordinates: true,
    });
    const sortResponse = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '最多收藏',
      includeCoordinates: true,
    });

    expect(filterResponse.success).toBe(true);
    expect(filterResponse.elements[0]).toMatchObject({
      selector: '#filter-chip',
      text: '筛选',
      type: 'text_action',
      actionability: 'actionable',
    });
    expect(sortResponse.success).toBe(true);
    expect(sortResponse.elements[0]).toMatchObject({
      selector: '#most-saved',
      text: '最多收藏',
      type: 'text_action',
      actionability: 'actionable',
    });
  });

  it('interactive element search does not promote an oversized option container', async () => {
    document.body.innerHTML = `
      <div id="panel">
        <span id="latest">最新</span>
        <span id="most-saved">最多收藏</span>
        <span id="comments">最多评论</span>
      </div>
    `;
    const panel = document.getElementById('panel') as HTMLDivElement;
    const latest = document.getElementById('latest') as HTMLSpanElement;
    const mostSaved = document.getElementById('most-saved') as HTMLSpanElement;
    const comments = document.getElementById('comments') as HTMLSpanElement;
    setRect(panel, { left: 0, top: 0, width: 900, height: 500 });
    setRect(latest, { left: 20, top: 20, width: 40, height: 24 });
    setRect(mostSaved, { left: 20, top: 64, width: 72, height: 24 });
    setRect(comments, { left: 20, top: 108, width: 72, height: 24 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: '最多收藏',
      includeCoordinates: true,
    });

    expect(response.success).toBe(true);
    expect(response.elements[0]).toMatchObject({
      selector: '#most-saved',
      actionability: 'actionable',
    });
    expect(response.elements.map((element: any) => element.selector)).not.toContain('#panel');
  });

  it('interactive element search escapes quoted text before XPath fallback', async () => {
    document.body.innerHTML = `
      <main>
        <p id="method-text">form uses method='post' for this example</p>
      </main>
    `;
    const paragraph = document.getElementById('method-text') as HTMLParagraphElement;
    setRect(paragraph, { left: 20, top: 20, width: 360, height: 28 });

    const listener = installInjectedHelper(
      'inject-scripts/interactive-elements-helper.js',
      '__INTERACTIVE_ELEMENTS_HELPER_INITIALIZED__',
    );
    const response = await sendRequest(listener, {
      action: 'getInteractiveElements',
      textQuery: "method='post'",
      includeCoordinates: true,
    });

    expect(response.success).toBe(true);
    expect(response.error).toBeUndefined();
    expect(response.elements[0]).toMatchObject({
      selector: '#method-text',
      text: "form uses method='post' for this example",
      actionability: 'blocked',
    });
  });
});
