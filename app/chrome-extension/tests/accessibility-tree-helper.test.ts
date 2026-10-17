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

  it('normalizes search inputs and contenteditable searchboxes for object perception', () => {
    document.body.innerHTML = `
      <main>
        <input id="native-search" type="search" placeholder="Search projects" />
        <div id="custom-search" class="top-search-input" contenteditable="true" aria-label="搜索或输入任何问题"></div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 42, width: 360, height: 36 });
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
      /- searchbox "Search projects" \[ref=ref_\d+\].*id="native-search".*type="search"/,
    );
    expect(result.pageContent).toMatch(
      /- searchbox "搜索或输入任何问题" \[ref=ref_\d+\].*id="custom-search"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ selector: '#native-search' }),
        expect.objectContaining({ selector: '#custom-search' }),
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

  it('records diagnostics when helper probes fail without blocking tree generation', () => {
    document.body.innerHTML = `
      <main>
        <button id="save">Save</button>
        <label>
          <i id="terms-icon" class="check-icon"></i>
          <span>我已阅读并同意用户协议和隐私政策</span>
        </label>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 120, height: 28 });
    });
    const agreementIcon = document.getElementById('terms-icon') as HTMLElement;
    const originalGetAttribute = agreementIcon.getAttribute.bind(agreementIcon);
    agreementIcon.getAttribute = vi.fn((name: string) => {
      if (name === 'class') throw new Error('class probe failed');
      return originalGetAttribute(name);
    }) as HTMLElement['getAttribute'];
    Object.defineProperty(agreementIcon, 'className', {
      configurable: true,
      get: () => {
        throw new Error('class name fallback failed');
      },
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    const diagnostics = (
      window as Window & {
        __TABRIX_INJECT_SCRIPT_DIAGNOSTICS__?: Array<Record<string, unknown>>;
      }
    ).__TABRIX_INJECT_SCRIPT_DIAGNOSTICS__;
    expect(result.pageContent).toContain('Save');
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'accessibility_tree.class_name',
          message: 'class probe failed',
        }),
      ]),
    );
  });

  it('marks object sensing as partial when shadow traversal fails', () => {
    document.body.innerHTML = `
      <main>
        <button id="save">Save</button>
        <div id="shadow-host"></div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 120, height: 28 });
    });
    const host = document.getElementById('shadow-host') as HTMLDivElement;
    Object.defineProperty(host, 'shadowRoot', {
      configurable: true,
      get: () => {
        throw new Error('shadow probe failed');
      },
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => {
          pageContent: string;
          stats: Record<string, unknown>;
          diagnostics: Array<Record<string, unknown>>;
        };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).toContain('Save');
    expect(result.stats).toMatchObject({
      coverageStatus: 'partial',
      shadowTraversalErrorCount: expect.any(Number),
    });
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'accessibility_tree.shadow_traversal',
          message: 'shadow probe failed',
        }),
      ]),
    );
  });

  it('marks object sensing as partial when max depth truncates children', () => {
    document.body.innerHTML = `
      <main id="root">
        <section id="level-1">
          <section id="level-2">
            <button id="deep-action">Deep action</button>
          </section>
        </section>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 10, top: 10 + index * 36, width: 160, height: 28 });
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; stats: Record<string, unknown> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 1 });

    expect(result.pageContent).not.toContain('Deep action');
    expect(result.stats).toMatchObject({
      coverageStatus: 'partial',
      depthLimitReached: true,
    });
  });

  it('recovers generic dynamic surface text targets as actionable refs', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
        <button id="export">Export</button>
        <button id="refresh">Refresh</button>
        <div id="panel" style="position: fixed; z-index: 1200;">
          <div class="surface-row"><span id="surface-alpha" role="option">Most saved</span></div>
          <div class="surface-row"><span id="surface-beta" role="option">Past week</span></div>
        </div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 140, height: 26 });
    });
    makeVisible(document.getElementById('panel') as HTMLDivElement, {
      left: 40,
      top: 90,
      width: 260,
      height: 180,
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
      /- button "Most saved" \[ref=ref_dynamic_surface_\d+\].*matchSource="dynamic_surface_visible_text".*actionability="actionable"/,
    );
    expect(result.pageContent).toMatch(
      /- button "Past week" \[ref=ref_dynamic_surface_\d+\].*matchSource="dynamic_surface_visible_text".*actionability="actionable"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#surface-alpha',
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        }),
        expect.objectContaining({
          selector: '#surface-beta',
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        }),
      ]),
    );
  });

  it('recovers floating panel option rows when labels are nested and z-index is auto', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
        <div id="panel" style="position: fixed;">
          <div id="option-alpha" class="surface-row" style="cursor: pointer;">
            <span><span>Most saved</span></span>
          </div>
          <div id="option-beta" class="surface-row" style="cursor: pointer;">
            <span><span>Past week</span></span>
          </div>
        </div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 140, height: 26 });
    });
    makeVisible(document.getElementById('panel') as HTMLDivElement, {
      left: 40,
      top: 90,
      width: 260,
      height: 180,
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
      /- button "Most saved" \[ref=ref_dynamic_surface_\d+\].*matchSource="dynamic_surface_visible_text".*actionability="actionable"/,
    );
    expect(result.pageContent).toMatch(
      /- button "Past week" \[ref=ref_dynamic_surface_\d+\].*matchSource="dynamic_surface_visible_text".*actionability="actionable"/,
    );
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#option-alpha',
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        }),
        expect.objectContaining({
          selector: '#option-beta',
          matchSource: 'dynamic_surface_visible_text',
          actionability: 'actionable',
        }),
      ]),
    );
  });

  it('records diagnostics when dynamic surface selector probes fail', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
        <div id="panel" style="position: fixed; z-index: 1200;">
          <span id="surface-alpha" role="option">Most saved</span>
        </div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 140, height: 26 });
    });
    const panel = document.getElementById('panel') as HTMLDivElement;
    makeVisible(panel, {
      left: 40,
      top: 90,
      width: 260,
      height: 180,
    });
    const originalMatches = Element.prototype.matches;
    vi.spyOn(Element.prototype, 'matches').mockImplementation(function (
      this: Element,
      selector: string,
    ) {
      if (this === panel && selector.includes(':popover-open')) {
        throw new Error('selector probe failed');
      }
      return originalMatches.call(this, selector);
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    const diagnostics = (
      window as Window & {
        __TABRIX_INJECT_SCRIPT_DIAGNOSTICS__?: Array<Record<string, unknown>>;
      }
    ).__TABRIX_INJECT_SCRIPT_DIAGNOSTICS__;
    expect(result.pageContent).toContain('Most saved');
    expect(result.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#surface-alpha',
          matchSource: 'dynamic_surface_visible_text',
        }),
      ]),
    );
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'accessibility_tree.dynamic_surface_root.selector',
          message: 'selector probe failed',
        }),
      ]),
    );
  });

  it('does not promote static footer links as dynamic surface targets', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
      </main>
      <footer id="legal-footer" role="contentinfo" style="position: fixed; z-index: 1200;">
        <a id="license">Business license</a>
        <a id="terms">Terms</a>
      </footer>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 160, height: 26 });
    });
    makeVisible(document.getElementById('legal-footer') as HTMLElement, {
      left: 20,
      top: 240,
      width: 300,
      height: 90,
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).not.toContain('dynamic_surface_visible_text');
    expect(result.refMap).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#license',
          matchSource: 'dynamic_surface_visible_text',
        }),
        expect.objectContaining({
          selector: '#terms',
          matchSource: 'dynamic_surface_visible_text',
        }),
      ]),
    );
  });

  it('does not duplicate native links or link text through dynamic surface recovery', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
        <div id="side-nav" style="position: fixed; z-index: 1200;">
          <a id="home-link" href="/home"><span id="home-label">Home</span></a>
          <a id="license-link" href="/license">Business license</a>
        </div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 180, height: 26 });
    });
    makeVisible(document.getElementById('side-nav') as HTMLElement, {
      left: 20,
      top: 80,
      width: 260,
      height: 140,
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).not.toContain('dynamic_surface_visible_text');
    expect(result.refMap).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#home-label',
          matchSource: 'dynamic_surface_visible_text',
        }),
        expect.objectContaining({
          selector: '#license-link',
          matchSource: 'dynamic_surface_visible_text',
        }),
      ]),
    );
  });

  it('does not promote tooltip or non-interactive fixed text as dynamic surface targets', () => {
    document.body.innerHTML = `
      <main>
        <button id="open-filter">Filter</button>
        <div id="tooltip" role="tooltip" style="position: fixed; z-index: 1200;">
          <span id="hint">Selection updates after refresh</span>
        </div>
        <div id="notice" style="position: fixed; z-index: 1200;">
          <span id="notice-copy">Data may take a moment</span>
        </div>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 180, height: 26 });
    });
    makeVisible(document.getElementById('tooltip') as HTMLElement, {
      left: 40,
      top: 90,
      width: 260,
      height: 80,
    });
    makeVisible(document.getElementById('notice') as HTMLElement, {
      left: 40,
      top: 190,
      width: 260,
      height: 80,
    });

    const result = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });

    expect(result.pageContent).not.toContain('dynamic_surface_visible_text');
    expect(result.refMap).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#hint',
          matchSource: 'dynamic_surface_visible_text',
        }),
        expect.objectContaining({
          selector: '#notice-copy',
          matchSource: 'dynamic_surface_visible_text',
        }),
      ]),
    );
  });

  it('dispatches pointer hover events so pointer-driven floating panels become visible objects', async () => {
    class TestPointerEvent extends window.MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;

      constructor(type: string, init: MouseEventInit & Partial<PointerEventInit> = {}) {
        const { view: _view, ...mouseInit } = init;
        super(type, mouseInit);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    (window as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent =
      TestPointerEvent as typeof PointerEvent;

    document.body.innerHTML = `
      <main>
        <button id="trigger">Filter</button>
        <div id="floating-panel" role="menu" style="display: none; position: fixed; z-index: 1200;">
          <button id="pointer-option" role="menuitem">Pointer only option</button>
        </div>
      </main>
    `;
    const trigger = document.getElementById('trigger') as HTMLElement;
    const panel = document.getElementById('floating-panel') as HTMLElement;
    trigger.addEventListener('pointerenter', () => {
      panel.style.display = 'block';
    });
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 180, height: 28 });
    });
    makeVisible(panel, { left: 20, top: 80, width: 220, height: 80 });

    const resolvedRef = await sendRequest({
      action: 'ensureRefForSelector',
      selector: '#trigger',
      allowMultiple: true,
    });
    expect(resolvedRef).toMatchObject({ success: true, ref: expect.stringMatching(/^ref_\d+$/) });

    const hoverResult = await sendRequest({ action: 'dispatchHoverForRef', ref: resolvedRef.ref });

    expect(hoverResult).toMatchObject({ success: true });
    expect(panel.style.display).toBe('block');
    const after = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });
    expect(after.pageContent).toContain('Pointer only option');
    expect(after.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#pointer-option',
        }),
      ]),
    );
  });

  it('dispatches hover enter events through ancestors when the ref points at leaf text', async () => {
    class TestPointerEvent extends window.MouseEvent {
      pointerId: number;
      pointerType: string;
      isPrimary: boolean;

      constructor(type: string, init: MouseEventInit & Partial<PointerEventInit> = {}) {
        const { view: _view, ...mouseInit } = init;
        super(type, mouseInit);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    (window as Window & { PointerEvent?: typeof PointerEvent }).PointerEvent =
      TestPointerEvent as typeof PointerEvent;

    document.body.innerHTML = `
      <main>
        <div id="trigger"><span id="trigger-label">Filter</span></div>
        <div id="floating-panel" role="menu" style="display: none; position: fixed; z-index: 1200;">
          <button id="panel-option" role="menuitem">Ancestor hover option</button>
        </div>
      </main>
    `;
    const trigger = document.getElementById('trigger') as HTMLElement;
    const panel = document.getElementById('floating-panel') as HTMLElement;
    trigger.addEventListener('pointerenter', () => {
      panel.style.display = 'block';
    });
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 20, top: 20 + index * 34, width: 180, height: 28 });
    });
    makeVisible(panel, { left: 20, top: 110, width: 220, height: 80 });

    const resolvedRef = await sendRequest({
      action: 'ensureRefForSelector',
      selector: '#trigger-label',
      allowMultiple: true,
    });
    expect(resolvedRef).toMatchObject({ success: true, ref: expect.stringMatching(/^ref_\d+$/) });

    const hoverResult = await sendRequest({ action: 'dispatchHoverForRef', ref: resolvedRef.ref });

    expect(hoverResult).toMatchObject({ success: true });
    expect(panel.style.display).toBe('block');
    const after = (
      window as Window & {
        __generateAccessibilityTree: (
          filter: string,
          options: { maxDepth: number },
        ) => { pageContent: string; refMap: Array<Record<string, unknown>> };
      }
    ).__generateAccessibilityTree('interactive', { maxDepth: 8 });
    expect(after.pageContent).toContain('Ancestor hover option');
    expect(after.refMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          selector: '#panel-option',
        }),
      ]),
    );
  });

  it('waits for the child frame that owns a hover ref and translates its center', async () => {
    document.body.innerHTML = `
      <iframe id="empty-frame"></iframe>
      <iframe id="target-frame"></iframe>
    `;
    const emptyFrame = document.getElementById('empty-frame') as HTMLIFrameElement;
    const targetFrame = document.getElementById('target-frame') as HTMLIFrameElement;
    makeVisible(emptyFrame, { left: 40, top: 50, width: 200, height: 120 });
    makeVisible(targetFrame, { left: 400, top: 100, width: 300, height: 150 });

    Object.defineProperty(emptyFrame.contentWindow, 'postMessage', {
      configurable: true,
      value: vi.fn((message: { reqId: string }) => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: {
              type: 'tabrix-bridge-hover-ref-result',
              reqId: message.reqId,
              result: { success: false, error: 'ref not found' },
            },
            source: emptyFrame.contentWindow,
          }),
        );
      }),
    });
    Object.defineProperty(targetFrame.contentWindow, 'postMessage', {
      configurable: true,
      value: vi.fn((message: { reqId: string }) => {
        setTimeout(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: {
                type: 'tabrix-bridge-hover-ref-result',
                reqId: message.reqId,
                result: {
                  success: true,
                  center: { x: 24, y: 16 },
                  viewport: { width: 300, height: 150 },
                  target: { tagName: 'BUTTON' },
                },
              },
              source: targetFrame.contentWindow,
            }),
          );
        }, 0);
      }),
    });

    const hoverResult = await sendRequest({
      action: 'dispatchHoverForRef',
      ref: 'ref_owned_by_target_frame',
    });

    expect(hoverResult).toMatchObject({
      success: true,
      center: { x: 424, y: 116 },
      coordinateSpace: 'top_viewport',
      frameDepth: 1,
      target: { tagName: 'BUTTON' },
    });
  });

  it('ensures refs for visible text from accessible names without a selector', async () => {
    document.body.innerHTML = `
      <main>
        <button id="filter-trigger" aria-label="筛选"></button>
      </main>
    `;
    Array.from(document.querySelectorAll('*')).forEach((element, index) => {
      makeVisible(element, { left: 30, top: 30 + index * 34, width: 120, height: 28 });
    });

    const resolvedRef = await sendRequest({
      action: 'ensureRefForSelector',
      useText: true,
      text: '筛选',
      allowMultiple: true,
    });

    expect(resolvedRef).toMatchObject({ success: true, ref: expect.stringMatching(/^ref_\d+$/) });
    const refMap = (window as Window & { __claudeElementMap?: Record<string, WeakRef<Element>> })
      .__claudeElementMap;
    expect(refMap?.[resolvedRef.ref]?.deref()).toBe(document.getElementById('filter-trigger'));
  });
});
