/**
 * Thin HTTP client for the native-server's MKEP Memory read routes
 * (see `app/native-server/src/server/memory-routes.ts`).
 *
 * Design notes
 * ------------
 * - Pure functions only. No Vue imports, no reactive state. This lets
 *   the module be tested under `vitest` with a trivial `fetch` mock
 *   and reused by the Sidepanel composable **and** any future
 *   background/popup consumer.
 * - Base URL is derived from `chrome.storage.local.nativeServerPort`
 *   with the 12306 fallback used elsewhere in the extension (see
 *   `popup/App.vue → getServerBaseUrl`). Protected routes may require a
 *   bearer token when the native server is exposed beyond loopback, so
 *   this client retries 401 responses with the current local `/auth/token`.
 * - Errors always surface as `MemoryApiError` so callers can branch on
 *   `.kind` ∈ `{network, http, shape}` instead of pattern-matching
 *   message strings.
 */

import type {
  MemoryReadSuccess,
  MkeBrowserObjectsClearResponseData,
  MkeBrowserObjectsResponseData,
  MkeExperienceRecipesResponseData,
  MkeKnowledgeModelsResponseData,
  MkeMemoryTracesResponseData,
  MkeObjectStoragePreferencesResponseData,
} from '@tabrix/shared';
import { STORAGE_KEYS } from './constants';

/** Fallback port matches the native-server default. */
export const DEFAULT_NATIVE_SERVER_PORT = 12306;

export const DEFAULT_MKE_PAGE_SIZE = 20;

/**
 * Strongly-typed failure modes produced by this client. Callers use
 * `err.kind` to drive UI copy (offline vs. server-side error vs. bug).
 */
export type MemoryApiErrorKind = 'network' | 'http' | 'shape';

export class MemoryApiError extends Error {
  public readonly kind: MemoryApiErrorKind;
  public readonly httpStatus?: number;
  public readonly body?: unknown;

  constructor(
    kind: MemoryApiErrorKind,
    message: string,
    options: { httpStatus?: number; body?: unknown; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'MemoryApiError';
    this.kind = kind;
    this.httpStatus = options.httpStatus;
    this.body = options.body;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Resolve the local native-server base URL, respecting the user's
 * configured port. Falls back to 12306 whenever the storage API is
 * unavailable (tests, restricted contexts) or the stored value is
 * invalid.
 */
export async function resolveMemoryApiBaseUrl(): Promise<string> {
  const port = await readConfiguredPort();
  return `http://127.0.0.1:${port}`;
}

async function readConfiguredPort(): Promise<number> {
  const storage = globalThis.chrome?.storage?.local;
  if (!storage || typeof storage.get !== 'function') {
    return DEFAULT_NATIVE_SERVER_PORT;
  }
  const raw = await new Promise<unknown>((resolve) => {
    try {
      const maybePromise = storage.get([STORAGE_KEYS.NATIVE_SERVER_PORT], (items) => {
        resolve(items?.[STORAGE_KEYS.NATIVE_SERVER_PORT]);
      }) as unknown;
      // Some polyfills make `.get` return a Promise instead of using
      // the callback. Resolve via whichever arrives first.
      if (isThenable(maybePromise)) {
        void maybePromise
          .then((items) => resolve(items?.[STORAGE_KEYS.NATIVE_SERVER_PORT]))
          .catch(() => resolve(undefined));
      }
    } catch {
      resolve(undefined);
    }
  });
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n < 65536 ? Math.floor(n) : DEFAULT_NATIVE_SERVER_PORT;
}

export interface FetchMkeListOptions {
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
  baseUrl?: string;
}

export type MkeBrowserObjectsScope = 'browser-surface' | 'object-graph';

export interface FetchMkeBrowserObjectsOptions extends FetchMkeListOptions {
  scope?: MkeBrowserObjectsScope;
}

/** `GET /memory/mke/traces?limit=&offset=` */
export async function fetchMkeMemoryTraces(
  options: FetchMkeListOptions = {},
): Promise<MkeMemoryTracesResponseData> {
  const { base, limit, offset } = await buildMkeListRequest(options);
  const url = `${base}/memory/mke/traces?limit=${limit}&offset=${offset}`;
  return readEnvelope<MkeMemoryTracesResponseData>(url, options.signal);
}

/** `GET /memory/mke/browser-objects?limit=&offset=` */
export async function fetchMkeBrowserObjects(
  options: FetchMkeBrowserObjectsOptions = {},
): Promise<MkeBrowserObjectsResponseData> {
  const { base, limit, offset } = await buildMkeListRequest(options);
  const scope = options.scope ? `&scope=${encodeURIComponent(options.scope)}` : '';
  const url = `${base}/memory/mke/browser-objects?limit=${limit}&offset=${offset}${scope}`;
  return readEnvelope<MkeBrowserObjectsResponseData>(url, options.signal);
}

/** `DELETE /memory/mke/browser-objects` */
export async function clearMkeBrowserObjects(
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<MkeBrowserObjectsClearResponseData> {
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readEnvelope<MkeBrowserObjectsClearResponseData>(
    `${base}/memory/mke/browser-objects`,
    options.signal,
    { method: 'DELETE' },
  );
}

export interface UpdateMkeObjectStoragePreferencesOptions {
  personalBrowserStateStorageEnabled: boolean;
  signal?: AbortSignal;
  baseUrl?: string;
}

/** `GET /memory/mke/object-storage-preferences` */
export async function fetchMkeObjectStoragePreferences(
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Promise<MkeObjectStoragePreferencesResponseData> {
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readEnvelope<MkeObjectStoragePreferencesResponseData>(
    `${base}/memory/mke/object-storage-preferences`,
    options.signal,
  );
}

/** `PATCH /memory/mke/object-storage-preferences` */
export async function updateMkeObjectStoragePreferences(
  options: UpdateMkeObjectStoragePreferencesOptions,
): Promise<MkeObjectStoragePreferencesResponseData> {
  const base = options.baseUrl ?? (await resolveMemoryApiBaseUrl());
  return readEnvelope<MkeObjectStoragePreferencesResponseData>(
    `${base}/memory/mke/object-storage-preferences`,
    options.signal,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalBrowserStateStorageEnabled: options.personalBrowserStateStorageEnabled,
      }),
    },
  );
}

/** `GET /memory/mke/knowledge?limit=&offset=` */
export async function fetchMkeKnowledgeModels(
  options: FetchMkeListOptions = {},
): Promise<MkeKnowledgeModelsResponseData> {
  const { base, limit, offset } = await buildMkeListRequest(options);
  const url = `${base}/memory/mke/knowledge?limit=${limit}&offset=${offset}`;
  return readEnvelope<MkeKnowledgeModelsResponseData>(url, options.signal);
}

/** `GET /memory/mke/experience?limit=&offset=` */
export async function fetchMkeExperienceRecipes(
  options: FetchMkeListOptions = {},
): Promise<MkeExperienceRecipesResponseData> {
  const { base, limit, offset } = await buildMkeListRequest(options);
  const url = `${base}/memory/mke/experience?limit=${limit}&offset=${offset}`;
  return readEnvelope<MkeExperienceRecipesResponseData>(url, options.signal);
}

async function buildMkeListRequest(options: FetchMkeListOptions): Promise<{
  base: string;
  limit: number;
  offset: number;
}> {
  return {
    base: options.baseUrl ?? (await resolveMemoryApiBaseUrl()),
    limit: clampInt(options.limit ?? DEFAULT_MKE_PAGE_SIZE, 1, 500),
    offset: clampInt(options.offset ?? 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

async function readEnvelope<TData>(
  url: string,
  signal?: AbortSignal,
  init: RequestInit = {},
): Promise<TData> {
  const response = await fetchWithNativeServerAuthRetry(url, init, signal);

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch (cause) {
    throw new MemoryApiError('shape', 'Response body was not valid JSON', {
      httpStatus: response.status,
      cause,
    });
  }

  if (!response.ok) {
    throw new MemoryApiError('http', extractErrorMessage(parsed, response.status), {
      httpStatus: response.status,
      body: parsed,
    });
  }

  if (!isMemorySuccessEnvelope<TData>(parsed)) {
    throw new MemoryApiError('shape', 'Unexpected response envelope shape', {
      httpStatus: response.status,
      body: parsed,
    });
  }

  return parsed.data;
}

export async function fetchWithNativeServerAuthRetry(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetchNativeServer(url, init, signal);
  if (response.status !== 401 || hasAuthorizationHeader(init.headers)) {
    return response;
  }

  const token = await readNativeServerBearerToken(url, signal);
  if (!token) {
    return response;
  }

  return fetchNativeServer(
    url,
    {
      ...init,
      headers: withBearerHeader(init.headers, token),
    },
    signal,
  );
}

async function fetchNativeServer(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal });
  } catch (cause) {
    throw new MemoryApiError('network', `Network error contacting ${url}`, { cause });
  }
}

async function readNativeServerBearerToken(
  protectedUrl: string,
  signal?: AbortSignal,
): Promise<string | null> {
  let tokenUrl: string;
  try {
    tokenUrl = new URL('/auth/token', protectedUrl).toString();
  } catch {
    return null;
  }

  try {
    const response = await fetch(tokenUrl, { signal });
    if (!response.ok) return null;
    const parsed: unknown = await response.json();
    if (!isMemorySuccessEnvelope<unknown>(parsed)) return null;
    const token = (parsed.data as { token?: unknown } | null)?.token;
    return typeof token === 'string' && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

function hasAuthorizationHeader(headers: HeadersInit | undefined): boolean {
  try {
    return new Headers(headers).has('authorization');
  } catch {
    return false;
  }
}

function withBearerHeader(headers: HeadersInit | undefined, token: string): Headers {
  const next = new Headers(headers);
  next.set('authorization', `Bearer ${token}`);
  return next;
}

function isMemorySuccessEnvelope<TData>(value: unknown): value is MemoryReadSuccess<TData> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'ok' &&
    'data' in (value as Record<string, unknown>)
  );
}

function extractErrorMessage(body: unknown, httpStatus: number): string {
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { message?: unknown }).message === 'string'
  ) {
    return (body as { message: string }).message;
  }
  return `HTTP ${httpStatus}`;
}

function isThenable(value: unknown): value is Promise<Record<string, unknown>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Best-effort copy to the system clipboard.
 *
 * We prefer `navigator.clipboard.writeText` because it works inside
 * the extension sidepanel origin without requiring a user gesture
 * on Chromium. Falls back to a hidden textarea + `document.execCommand`
 * when the async clipboard API is unavailable (older Chromium builds
 * or restricted iframes). Returns `true` on success, `false` on any
 * failure — callers surface that as UI feedback.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  const i = Math.floor(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}
