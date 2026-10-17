/**
 * Optional click verifier for routes where "something changed" is not enough.
 *
 * The generic click pipeline in `interaction.ts` already merges page-local
 * and browser-level signals into `observedOutcome` + `success`. That answers
 * "what changed". It does NOT answer "did the user reach the intended
 * destination".
 *
 * This module intentionally has no built-in site verifier table. Product-level
 * click verification must come from generic URL/DOM/AX/network post-action
 * deltas rather than platform-specific keys.
 */

/**
 * Hint the caller passes to opt into a verifier run.
 *
 * Kept intentionally tiny for backward-compatible callers. Built-in keys are
 * not shipped.
 */
export interface ClickVerifierContext {
  family?: string;
  verifierKey?: string;
}

/**
 * Pure-data snapshot of the page state the verifier observed AFTER the
 * click settled. Fed into `evaluateClickVerifier`.
 *
 * `url` / `title` / `bodyText` come from the real browser in
 * `runClickVerifier`. `bodyText` is a small sample (capped in the IO
 * wrapper) — NOT the full DOM. The verifier must survive with a truncated
 * sample.
 */
export interface ClickPostClickReadback {
  url: string | null;
  title: string | null;
  bodyText: string | null;
}

/**
 * Verdict produced by the verifier.
 *
 * This is the pure-function output. `interaction.ts` projects a subset of
 * it into the public `postClickState` field. Keeping `pageRoleBefore`
 * here makes the unit tests readable even though we do not currently
 * expose it in the public contract.
 */
export interface ClickVerifierResult {
  passed: boolean;
  reason: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  pageRoleAfter: string | null;
  waitDiagnostics?: {
    postClickReadback: PostClickReadbackReady;
  };
}

export interface PostClickReadbackReady {
  waitedMs: number;
  reason: 'url_changed' | 'tab_complete' | 'tab_unavailable' | 'timeout';
  tab: chrome.tabs.Tab | null;
}

/**
 * Pure, side-effect-free verifier evaluation.
 *
 * All tests target this function directly (see
 * `tests/click-verifier.test.ts`). The IO wrapper
 * `runClickVerifier` only feeds it `beforeUrl` + `readback` and forwards
 * the verdict.
 */
export function evaluateClickVerifier(
  ctx: ClickVerifierContext,
  beforeUrl: string | null,
  readback: ClickPostClickReadback,
): ClickVerifierResult {
  const afterUrl = readback.url ?? null;

  const key = ctx.verifierKey ?? '';
  return {
    passed: false,
    reason: `verifier_key_unknown:${key || '(none)'}`,
    beforeUrl,
    afterUrl,
    pageRoleAfter: null,
  };
}

export function isVerifierContextActive(ctx: ClickVerifierContext | undefined | null): boolean {
  if (!isVerifierContextRequested(ctx)) return false;
  return false;
}

/**
 * Returns true when the caller explicitly asked for post-click verification,
 * regardless of whether the key is known. Unknown keys should fail closed
 * with a structured diagnostic, not silently disable the verifier path.
 */
export function isVerifierContextRequested(ctx: ClickVerifierContext | undefined | null): boolean {
  if (!ctx) return false;
  const key = ctx.verifierKey;
  return typeof key === 'string' && key.length > 0;
}

/**
 * Body text sample cap. Intentionally tight — the goal is just to give
 * `inferPageUnderstanding` enough anchor strings, not to reconstruct the
 * full page. 20 KiB is comparable to the compact mode of `read_page`.
 */
const BODY_SAMPLE_MAX_CHARS = 20_000;

/**
 * Maximum milliseconds to wait for an observable post-click readback
 * condition. This is a cap, not a fixed settle delay: URL changes and
 * complete tab status return immediately.
 */
export const CLICK_VERIFIER_READBACK_MAX_MS = 1_500;
export const CLICK_VERIFIER_SETTLE_DELAY_MS = CLICK_VERIFIER_READBACK_MAX_MS;

function nowMs(): number {
  return Date.now();
}

export async function waitForPostClickReadbackReady(
  tabId: number,
  beforeUrl: string | null,
  { maxMs = CLICK_VERIFIER_READBACK_MAX_MS }: { maxMs?: number } = {},
): Promise<PostClickReadbackReady> {
  const startedAt = nowMs();
  const elapsed = () => Math.max(0, nowMs() - startedAt);
  let latestTab: chrome.tabs.Tab | null = null;

  const classifyInitialTab = (
    tab: chrome.tabs.Tab | null,
  ): PostClickReadbackReady['reason'] | null => {
    if (!tab) return 'tab_unavailable';
    const url = typeof tab.url === 'string' ? tab.url : null;
    if (url && beforeUrl && url !== beforeUrl) return 'url_changed';
    if (url && !beforeUrl) return 'url_changed';
    return null;
  };

  try {
    const initialTab = await chrome.tabs.get(tabId);
    latestTab = initialTab ?? null;
    const initialReason = classifyInitialTab(initialTab);
    if (initialReason) {
      return { waitedMs: elapsed(), reason: initialReason, tab: initialTab ?? null };
    }
  } catch {
    return { waitedMs: elapsed(), reason: 'tab_unavailable', tab: null };
  }

  return await new Promise<PostClickReadbackReady>((resolve) => {
    let done = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const finish = (reason: PostClickReadbackReady['reason'], tab: chrome.tabs.Tab | null) => {
      if (done) return;
      done = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      try {
        chrome.tabs.onUpdated.removeListener(listener);
      } catch {
        // ignore
      }
      resolve({ waitedMs: elapsed(), reason, tab });
    };

    const listener = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab,
    ) => {
      if (updatedTabId !== tabId) return;
      latestTab = tab;
      if (typeof changeInfo.url === 'string' && (!beforeUrl || changeInfo.url !== beforeUrl)) {
        finish('url_changed', { ...tab, url: changeInfo.url });
        return;
      }
      if (changeInfo.status === 'complete') {
        finish('tab_complete', tab);
      }
    };

    try {
      chrome.tabs.onUpdated.addListener(listener);
    } catch {
      finish('timeout', null);
      return;
    }

    timeoutId = setTimeout(
      () => {
        void (async () => {
          try {
            latestTab = await chrome.tabs.get(tabId);
          } catch {
            // Keep the best previously observed tab, if any.
          }
          finish('timeout', latestTab);
        })();
      },
      Math.max(0, maxMs),
    );
  });
}

async function readPostClickSnapshot(
  tabId: number,
  observedTab: chrome.tabs.Tab | null = null,
): Promise<ClickPostClickReadback> {
  let tab: chrome.tabs.Tab | null = observedTab;
  if (!tab) {
    try {
      tab = await chrome.tabs.get(tabId);
    } catch {
      return { url: null, title: null, bodyText: null };
    }
  }

  const url = typeof tab?.url === 'string' ? tab.url : null;
  const title = typeof tab?.title === 'string' ? tab.title : null;

  let bodyText: string | null = null;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (maxChars: number) => {
        try {
          const raw = (document.body && document.body.innerText) || '';
          return typeof raw === 'string' ? raw.slice(0, maxChars) : '';
        } catch {
          return '';
        }
      },
      args: [BODY_SAMPLE_MAX_CHARS],
    });
    const result = injection?.result;
    bodyText = typeof result === 'string' ? result : null;
  } catch {
    bodyText = null;
  }

  return { url, title, bodyText };
}

/**
 * IO wrapper. Does at most one settle delay + one readback, then delegates
 * to the pure evaluator. Returns `null` only for defensive infra failures
 * (caller treats that as "verifier requested but could not run").
 */
export async function runClickVerifier(
  tabId: number,
  ctx: ClickVerifierContext,
  beforeUrl: string | null,
): Promise<ClickVerifierResult | null> {
  if (!isVerifierContextRequested(ctx)) {
    return null;
  }
  try {
    const readiness = await waitForPostClickReadbackReady(tabId, beforeUrl);
    const readback = await readPostClickSnapshot(tabId, readiness.tab);
    const result = evaluateClickVerifier(ctx, beforeUrl, readback);
    return {
      ...result,
      waitDiagnostics: {
        postClickReadback: readiness,
      },
    };
  } catch {
    return null;
  }
}
