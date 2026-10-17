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
    escape: (value: string) => value,
  };
  const runtime = (globalThis.chrome as typeof chrome).runtime;
  runtime.onMessage.addListener = vi.fn((listener: RuntimeListener) => {
    messageListener = listener;
  }) as typeof runtime.onMessage.addListener;
  window.eval(helperSource);
}

function makeVisible(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
) {
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

async function sendPointRequest(overrides: Record<string, unknown> = {}) {
  if (!messageListener) throw new Error('accessibility helper listener did not register');
  return await new Promise<any>((resolve) => {
    messageListener!(
      {
        action: 'ensureRefForPoint',
        x: 120,
        y: 50,
        rect: { x: 100, y: 40, width: 40, height: 20 },
        identity: {
          label: 'Filters',
          targetRef: 'ref_text_search_toolbar_1',
          locatorChain: [{ type: 'css', value: '.snapshot-filter-trigger' }],
        },
        ...overrides,
      },
      {},
      resolve,
    );
  });
}

describe('accessibility-tree point rebind safety', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
    installAccessibilityHelper();
  });

  it('rebinds a unique visible interactive target only when a live locator corroborates it', async () => {
    document.body.innerHTML =
      '<button id="filter" class="snapshot-filter-trigger">Filters</button>';
    const filter = document.getElementById('filter') as HTMLButtonElement;
    makeVisible(filter, { left: 100, top: 40, width: 40, height: 20 });
    document.elementFromPoint = vi.fn(() => filter);

    const result = await sendPointRequest();

    expect(result).toMatchObject({
      success: true,
      ref: expect.stringMatching(/^ref_\d+$/),
      identityEvidence: {
        exactLabelMatched: true,
        roleMatched: true,
        refCorroborated: false,
        locatorCorroborated: true,
        uniqueLabelMatch: true,
      },
    });
  });

  it('rejects a unique exact-label hit when neither live ref nor locator corroborates it', async () => {
    document.body.innerHTML = '<button id="filter">Filters</button>';
    const filter = document.getElementById('filter') as HTMLButtonElement;
    makeVisible(filter, { left: 100, top: 40, width: 40, height: 20 });
    document.elementFromPoint = vi.fn(() => filter);

    const result = await sendPointRequest();

    expect(result.success).toBe(false);
    expect(result.error).toContain('exact label is not identity');
  });

  it('rejects a stale point after layout changes move the intended target elsewhere', async () => {
    document.body.innerHTML =
      '<button id="other">Account</button><button id="filter">Filters</button>';
    const other = document.getElementById('other') as HTMLButtonElement;
    const filter = document.getElementById('filter') as HTMLButtonElement;
    makeVisible(other, { left: 100, top: 40, width: 40, height: 20 });
    makeVisible(filter, { left: 300, top: 40, width: 80, height: 20 });
    document.elementFromPoint = vi.fn(() => other);

    const result = await sendPointRequest();

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not match the exact candidate label');
  });

  it('rejects a stale viewport point after scrolling changes the hit target', async () => {
    document.body.innerHTML =
      '<button id="scrolled-in">Newest</button><button id="filter">Filters</button>';
    const scrolledIn = document.getElementById('scrolled-in') as HTMLButtonElement;
    const filter = document.getElementById('filter') as HTMLButtonElement;
    makeVisible(scrolledIn, { left: 100, top: 40, width: 40, height: 20 });
    makeVisible(filter, { left: 100, top: -260, width: 80, height: 20 });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 });
    document.elementFromPoint = vi.fn(() => scrolledIn);

    const result = await sendPointRequest();

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not match the exact candidate label');
  });

  it('rejects an exact-label hit when the current role conflicts with locator identity', async () => {
    document.body.innerHTML = '<a id="filter" href="/filters">Filters</a>';
    const filter = document.getElementById('filter') as HTMLAnchorElement;
    makeVisible(filter, { left: 100, top: 40, width: 40, height: 20 });
    document.elementFromPoint = vi.fn(() => filter);

    const result = await sendPointRequest({
      identity: {
        label: 'Filters',
        targetRef: 'ref_text_search_toolbar_1',
        locatorChain: [{ type: 'role', value: 'button' }],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not interactive or role-compatible');
  });

  it('rejects duplicate exact-label targets without live ref or locator corroboration', async () => {
    document.body.innerHTML =
      '<button id="first">Filters</button><button id="second">Filters</button>';
    const first = document.getElementById('first') as HTMLButtonElement;
    const second = document.getElementById('second') as HTMLButtonElement;
    makeVisible(first, { left: 100, top: 40, width: 40, height: 20 });
    makeVisible(second, { left: 200, top: 40, width: 40, height: 20 });
    document.elementFromPoint = vi.fn(() => first);

    const result = await sendPointRequest();

    expect(result.success).toBe(false);
    expect(result.error).toContain('exact label is not identity');
  });

  it('rejects point fallback when exact identity evidence is missing', async () => {
    document.body.innerHTML = '<button id="filter">Filters</button>';
    const filter = document.getElementById('filter') as HTMLButtonElement;
    makeVisible(filter, { left: 100, top: 40, width: 40, height: 20 });
    document.elementFromPoint = vi.fn(() => filter);

    const result = await sendPointRequest({
      identity: {
        targetRef: 'ref_text_search_toolbar_1',
        locatorChain: [],
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      'exact label, targetRef, and locatorChain identity are required',
    );
  });
});
