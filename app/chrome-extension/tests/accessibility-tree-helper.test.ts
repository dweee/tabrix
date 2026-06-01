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
});
