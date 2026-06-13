import { cdpSessionManager } from './cdp-session-manager';

export type CDPPageReadiness = 'loading' | 'interactive' | 'complete' | 'unknown';

export interface CDPPageUrlSummary {
  href: string;
  origin: string;
  host: string;
  pathname: string;
  scheme: string;
  hasQuery: boolean;
  hasHash: boolean;
}

export interface CDPActiveElementSummary {
  tagName: string;
  type?: string;
  role?: string;
  idPresent: boolean;
  namePresent: boolean;
}

export interface CDPNavigationTimingSummary {
  type?: string;
  responseEndMs: number | null;
  domContentLoadedMs: number | null;
  loadEventMs: number | null;
}

export interface CDPPageSensingSnapshot {
  tabId: number;
  capturedAt: number;
  source: 'cdp';
  available: boolean;
  readiness: CDPPageReadiness;
  likelyLoading: boolean;
  url?: CDPPageUrlSummary;
  title?: string;
  visibilityState?: string;
  focused?: boolean;
  activeElement?: CDPActiveElementSummary;
  frameCount?: number;
  topFrameUrl?: CDPPageUrlSummary;
  navigation?: CDPNavigationTimingSummary;
  error?: string;
}

interface RuntimeEvaluateResponse {
  result?: {
    value?: unknown;
  };
}

interface CDPFrameTreeResponse {
  frameTree?: CDPFrameTree;
}

interface CDPFrameTree {
  frame?: {
    url?: string;
  };
  childFrames?: CDPFrameTree[];
}

const CDP_PAGE_SENSING_OWNER = 'page-sensing';
const MAX_TEXT_LENGTH = 160;

const PAGE_STATE_PROBE = String.raw`(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const active = document.activeElement;
  return {
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    focused: document.hasFocus(),
    url: location.href,
    title: document.title,
    activeElement: active
      ? {
          tagName: active.tagName,
          type: active.getAttribute('type') || undefined,
          role: active.getAttribute('role') || undefined,
          idPresent: Boolean(active.id),
          namePresent: Boolean(active.getAttribute('name')),
        }
      : null,
    navigation: nav
      ? {
          type: nav.type,
          responseEndMs: nav.responseEnd || null,
          domContentLoadedMs: nav.domContentLoadedEventEnd || null,
          loadEventMs: nav.loadEventEnd || null,
        }
      : null,
  };
})()`;

export async function captureCDPPageSensingSnapshot(
  tabId: number,
): Promise<CDPPageSensingSnapshot> {
  const capturedAt = Date.now();

  try {
    return await cdpSessionManager.withSession(tabId, CDP_PAGE_SENSING_OWNER, async () => {
      await Promise.all([
        cdpSessionManager.sendCommand(tabId, 'Runtime.enable').catch(() => undefined),
        cdpSessionManager.sendCommand(tabId, 'Page.enable').catch(() => undefined),
      ]);

      const [runtimeResult, frameTreeResult] = await Promise.all([
        cdpSessionManager.sendCommand<RuntimeEvaluateResponse>(tabId, 'Runtime.evaluate', {
          expression: PAGE_STATE_PROBE,
          returnByValue: true,
          silent: true,
        }),
        cdpSessionManager
          .sendCommand<CDPFrameTreeResponse>(tabId, 'Page.getFrameTree')
          .catch(() => undefined),
      ]);

      const pageState = asRecord(runtimeResult.result?.value);
      const navigation = parseNavigationTiming(pageState?.navigation);
      const readiness = normalizeReadiness(pageState?.readyState);

      return {
        tabId,
        capturedAt,
        source: 'cdp',
        available: true,
        readiness,
        likelyLoading: isLikelyLoading(readiness, navigation),
        url: sanitizeUrlSummary(pageState?.url),
        title: truncateText(pageState?.title),
        visibilityState: truncateText(pageState?.visibilityState),
        focused: typeof pageState?.focused === 'boolean' ? pageState.focused : undefined,
        activeElement: parseActiveElement(pageState?.activeElement),
        frameCount: countFrames(frameTreeResult?.frameTree),
        topFrameUrl: sanitizeUrlSummary(frameTreeResult?.frameTree?.frame?.url),
        navigation,
      };
    });
  } catch (error) {
    return {
      tabId,
      capturedAt,
      source: 'cdp',
      available: false,
      readiness: 'unknown',
      likelyLoading: false,
      error: sanitizeError(error),
    };
  }
}

function normalizeReadiness(value: unknown): CDPPageReadiness {
  if (value === 'loading' || value === 'interactive' || value === 'complete') {
    return value;
  }
  return 'unknown';
}

function isLikelyLoading(
  readiness: CDPPageReadiness,
  navigation?: CDPNavigationTimingSummary,
): boolean {
  if (readiness === 'loading') return true;
  if (readiness !== 'interactive') return false;
  return navigation?.loadEventMs === null || navigation?.loadEventMs === undefined;
}

function parseActiveElement(value: unknown): CDPActiveElementSummary | undefined {
  const activeElement = asRecord(value);
  if (!activeElement) return undefined;

  const tagName = truncateText(activeElement.tagName);
  if (!tagName) return undefined;

  return {
    tagName,
    type: truncateText(activeElement.type),
    role: truncateText(activeElement.role),
    idPresent: activeElement.idPresent === true,
    namePresent: activeElement.namePresent === true,
  };
}

function parseNavigationTiming(value: unknown): CDPNavigationTimingSummary | undefined {
  const navigation = asRecord(value);
  if (!navigation) return undefined;

  return {
    type: truncateText(navigation.type),
    responseEndMs: normalizeTiming(navigation.responseEndMs),
    domContentLoadedMs: normalizeTiming(navigation.domContentLoadedMs),
    loadEventMs: normalizeTiming(navigation.loadEventMs),
  };
}

function sanitizeUrlSummary(value: unknown): CDPPageUrlSummary | undefined {
  const raw = typeof value === 'string' ? value : undefined;
  if (!raw) return undefined;

  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, '');
    const pathname = url.pathname || '';
    const safePathname = sanitizeUrlPathname(url, pathname);
    const href = sanitizeUrlHref(url, scheme, safePathname);

    return {
      href,
      origin: url.origin === 'null' ? url.protocol : url.origin,
      host: url.host,
      pathname: safePathname,
      scheme,
      hasQuery: url.search.length > 0,
      hasHash: url.hash.length > 0,
    };
  } catch {
    return undefined;
  }
}

function sanitizeUrlPathname(url: URL, pathname: string): string {
  if (url.protocol === 'file:') return '';
  if (url.protocol === 'data:' || url.protocol === 'blob:') return '';
  return pathname;
}

function sanitizeUrlHref(url: URL, scheme: string, pathname: string): string {
  if (
    url.protocol === 'http:' ||
    url.protocol === 'https:' ||
    url.protocol === 'chrome:' ||
    url.protocol === 'chrome-extension:'
  ) {
    return `${url.protocol}//${url.host}${pathname}`;
  }
  if (url.protocol === 'about:') {
    return `about:${pathname}`;
  }
  if (url.protocol === 'file:') {
    return 'file://local-file';
  }
  return `${scheme}:redacted`;
}

function countFrames(frameTree: CDPFrameTree | undefined): number | undefined {
  if (!frameTree) return undefined;
  return countFrameTree(frameTree);
}

function countFrameTree(frameTree: CDPFrameTree): number {
  return 1 + (frameTree.childFrames ?? []).reduce((sum, child) => sum + countFrameTree(child), 0);
}

function normalizeTiming(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function truncateText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}...` : trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return truncateText(message) ?? 'CDP page sensing failed';
}
