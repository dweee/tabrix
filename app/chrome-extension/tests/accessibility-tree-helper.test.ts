// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const helperSource = readFileSync(
  resolve(process.cwd(), 'inject-scripts/accessibility-tree-helper.js'),
  'utf8',
);

type RuntimeListener = (
  request: Record<string, unknown>,
  sender: unknown,
  sendResponse: (payload: unknown) => void,
) => boolean | void;

let messageListener: RuntimeListener | null = null;

function installAccessibilityHelper() {
  messageListener = null;
  delete (window as Window & { __ACCESSIBILITY_TREE_HELPER_INITIALIZED__?: boolean })
    .__ACCESSIBILITY_TREE_HELPER_INITIALIZED__;
  (
    window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> }
  ).__claudeElementMap = {};
  (window as Window & { __claudeRefCounter?: number }).__claudeRefCounter = 0;
  (window as Window & { CSS: { escape: (value: string) => string } }).CSS = {
    escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
  };

  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((listener: RuntimeListener) => {
    messageListener = listener;
  }) as typeof runtime.onMessage.addListener;

  window.eval(helperSource);
}

function makeVisible(element: Element, rect = { left: 0, top: 0, width: 120, height: 32 }) {
  Object.defineProperty(element, 'offsetWidth', { configurable: true, value: rect.width });
  Object.defineProperty(element, 'offsetHeight', { configurable: true, value: rect.height });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: rect.left,
      y: rect.top,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      toJSON: () => ({}),
    }),
  });
}

async function sendRequest(request: Record<string, unknown>) {
  if (!messageListener) throw new Error('accessibility helper listener did not register');
  return await new Promise<any>((resolve) => {
    messageListener!(request, {}, resolve);
  });
}

describe('accessibility-tree auth control map', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    installAccessibilityHelper();
  });

  it('promotes custom OTP and agreement DOM controls without using screenshots or coordinates', () => {
    document.body.innerHTML = `
      <main id="login" class="login-panel">
        <input id="phone" placeholder="手机号" />
        <input id="code" placeholder="验证码" />
        <span id="send-code" class="send-code">获取验证码</span>
        <label id="terms">
          <i id="terms-icon" class="check-icon"></i>
          <span>我已阅读并同意用户协议和隐私政策</span>
        </label>
        <button id="submit">登录</button>
        <input id="placeholder-trap" placeholder="获取验证码" />
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 180, height: 28 });
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).toMatch(
      /- button "获取验证码" \[ref=ref_\d+\].*matchSource="visible_text".*actionability="actionable"/,
    );
    expect(result.pageContent).toMatch(
      /- checkbox "我已阅读并同意用户协议和隐私政策" \[ref=ref_\d+\].*checked="unknown".*matchSource="visible_text".*actionability="actionable"/,
    );
    expect(result.pageContent).toMatch(
      /- textbox "获取验证码" \[ref=ref_\d+\].*placeholder="获取验证码".*matchSource="placeholder".*actionability="not_actionable"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: '#send-code', actionability: 'actionable' }),
        expect.objectContaining({ selector: '#terms-icon', actionability: 'actionable' }),
      ]),
    );
  });

  it('promotes an OTP sender span inside a label instead of the sibling OTP input placeholder', () => {
    document.body.innerHTML = `
      <form>
        <label class="auth-code">
          <input id="otp" type="number" placeholder="输入验证码" />
          <span id="send" class="code-button active">获取验证码</span>
        </label>
      </form>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 180, height: 28 });
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).toMatch(
      /- button "获取验证码" \[ref=ref_\d+\].*matchSource="visible_text".*actionability="actionable"/,
    );
    expect(result.pageContent).toMatch(
      /- textbox "输入验证码" \[ref=ref_\d+\].*placeholder="输入验证码"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#send',
          matchSource: 'visible_text',
          actionability: 'actionable',
        }),
      ]),
    );
  });

  it('promotes a nested agreement confirmation control from compact dialog text', () => {
    document.body.innerHTML = `
      <div class="agreement-modal">
        <div>阅读并同意《用户协议》《隐私政策》</div>
        <div id="confirm" class="modal-action">
          <span>同意并继续</span>
        </div>
        <div class="modal-action">取消</div>
      </div>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 36, width: 160, height: 28 });
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).toMatch(
      /- button "同意并继续" \[ref=ref_\d+\].*matchSource="visible_text".*actionability="actionable"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#confirm',
          actionability: 'actionable',
        }),
      ]),
    );
  });

  it('resolves an XPath selector to the only visible match when hidden duplicates exist', async () => {
    document.body.innerHTML = `
      <div style="display: none">
        <span id="hidden-sort">最多收藏</span>
      </div>
      <div>
        <span id="visible-sort">最多收藏</span>
      </div>
    `;
    const hidden = document.getElementById('hidden-sort') as HTMLSpanElement;
    const visible = document.getElementById('visible-sort') as HTMLSpanElement;
    makeVisible(hidden, { left: 10, top: 10, width: 72, height: 24 });
    makeVisible(visible, { left: 20, top: 80, width: 72, height: 24 });

    const response = await sendRequest({
      action: 'ensureRefForSelector',
      selector: "//span[contains(normalize-space(.), '最多收藏')]",
      isXPath: true,
      allowMultiple: false,
    });

    expect(response).toMatchObject({
      success: true,
    });
    const ref = String(response.ref);
    const refMap = (window as Window & { __claudeElementMap: Record<string, WeakRef<Element>> })
      .__claudeElementMap;
    expect(refMap[ref]?.deref()).toBe(visible);
  });

  it('reports frame context for the content-script frame that produced the snapshot', () => {
    document.body.innerHTML = `<main><button id="save">Save</button></main>`;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 120, height: 28 });
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { frameContext: Record<string, unknown> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.frameContext).toMatchObject({
      frameUrl: expect.any(String),
      frameName: expect.any(String),
      frameScope: 'top',
      isTopFrame: true,
      source: 'content_script_runtime',
      coverage: 'responding_frame_only',
      claimBoundary: expect.stringContaining('does not prove every iframe was fully covered'),
    });
  });
});
