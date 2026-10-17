/**
 * Legacy API-knowledge compatibility surface.
 *
 * Tabrix no longer ships platform-specific API seed adapters. API knowledge
 * must come from observed browser/network evidence and Knowledge/Object
 * projections, not from hardcoded site families.
 */
export type ApiEndpointFamily = string;

export type ApiDataPurpose = string;

export type ApiKnowledgeFallbackReason =
  | 'unsupported_family'
  | 'unsupported_site_family'
  | 'method_denied'
  | 'invalid_request'
  | 'http_forbidden'
  | 'rate_limited'
  | 'http_error'
  | 'decode_error'
  | 'semantic_mismatch'
  | 'network_timeout'
  | 'network_error';

export interface ApiKnowledgeMetadataInput {
  url: string;
  method?: string | null;
  status?: number | null;
  timingMs?: number | null;
  sizeBytes?: number | null;
  contentType?: string | null;
}

export interface ApiKnowledgeMetadata {
  host: string;
  pathPattern: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OTHER';
  statusClass: string | null;
  timingMs: number | null;
  sizeClass: 'empty' | 'small' | 'medium' | 'large' | 'unknown';
  contentType: string | null;
  endpointFamily: ApiEndpointFamily;
  confidence: number;
  dataPurpose: ApiDataPurpose;
  readAllowed: boolean;
}

export interface ApiKnowledgeCandidate {
  endpointFamily: ApiEndpointFamily;
  dataPurpose: ApiDataPurpose;
  confidence: number;
  method: 'GET';
  params: Record<string, string>;
}

export type ApiKnowledgeCompactRow = Record<string, string | number | boolean | null>;

/**
 * Closed-enum reason for an API read that succeeded but returned
 * zero rows. Today the only producer is "the upstream API
 * answered 200 with an empty list", which we name explicitly so a
 * downstream consumer (operation log / Gate B / AI assistant prompt)
 * can render a deterministic "verified empty" message rather than
 * silently treat `rowCount === 0` as "the API failed". Adding new
 * values requires extending the evidence contract in lockstep, so
 * the union is intentionally narrow.
 */
export type ApiKnowledgeEmptyReason = 'no_matching_records';

export interface ApiKnowledgeReadOk {
  status: 'ok';
  kind: 'api_rows';
  endpointFamily: ApiEndpointFamily;
  dataPurpose: ApiDataPurpose;
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  compact: true;
  rawBodyStored: false;
  /**
   * `true` iff the upstream API answered ok AND returned zero rows.
   * Always present (false on the non-empty happy path) so
   * downstream consumers can grep one stable boolean rather than
   * re-deriving it from `rowCount === 0`.
   */
  emptyResult: boolean;
  /**
   * Closed-enum reason for the empty result; `null` on the non-empty
   * happy path. Today only one producer exists
   * (`no_matching_records`); the field is left open for future
   * empty-but-not-failure cases (e.g. "filtered out by row cap").
   */
  emptyReason: ApiKnowledgeEmptyReason | null;
  /**
   * Human-readable message for the empty result, or `null` on the
   * non-empty happy path. Surfaces verbatim into the
   * `chrome_read_page` `kind:'api_rows'` envelope so an AI assistant
   * can quote it back to the user without re-rendering boilerplate.
   */
  emptyMessage: string | null;
  telemetry: ApiKnowledgeTelemetry;
}

export interface ApiKnowledgeReadFallback {
  status: 'fallback_required';
  endpointFamily?: ApiEndpointFamily;
  reason: ApiKnowledgeFallbackReason;
  fallbackEntryLayer: 'L0+L1';
  telemetry: ApiKnowledgeTelemetry;
}

export type ApiKnowledgeReadResult = ApiKnowledgeReadOk | ApiKnowledgeReadFallback;

export interface ApiKnowledgeTelemetry {
  endpointFamily?: ApiEndpointFamily;
  method: string;
  reason: string;
  status: number | null;
  waitedMs: number;
  readAllowed: boolean;
  fallbackEntryLayer: 'L0+L1' | 'none';
  /**
   * True only when a read-only public GET is served from the
   * short-lived in-process compact-result cache. This is not persisted
   * Knowledge/Experience data; it only avoids repeating identical
   * public API calls within a short runtime window.
   */
  cacheHit?: boolean;
  cacheTtlMs?: number;
}

interface FetchHeadersLike {
  get(name: string): string | null;
}

interface FetchResponseLike {
  status: number;
  headers: FetchHeadersLike;
  json(): Promise<unknown>;
}

export type ApiKnowledgeFetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>;

export interface ApiKnowledgeReadInput {
  endpointFamily: ApiEndpointFamily | string;
  method?: string | null;
  params?: Record<string, string | number | null | undefined>;
  fetchFn?: ApiKnowledgeFetch;
  nowMs?: () => number;
  limit?: number;
}

export interface ApiKnowledgeEndpointReadPlan extends ApiKnowledgeReadInput {
  dataPurpose?: ApiDataPurpose | string | null;
}

export interface ApiKnowledgeIntentReadInput {
  intent: string;
  url?: string;
  pageRole?: string;
  method?: string | null;
  fetchFn?: ApiKnowledgeFetch;
  nowMs?: () => number;
  limit?: number;
}

const API_KNOWLEDGE_READ_TIMEOUT_MS = 2500;
const API_KNOWLEDGE_COMPACT_RESULT_CACHE_TTL_MS = 120_000;
const API_KNOWLEDGE_COMPACT_RESULT_CACHE_MAX = 64;

interface ApiKnowledgeCompactResultCacheEntry {
  expiresAtMs: number;
  result: ApiKnowledgeReadOk;
}

const apiKnowledgeCompactResultCache = new Map<string, ApiKnowledgeCompactResultCacheEntry>();

export function clearApiKnowledgeCompactResultCacheForTests(): void {
  apiKnowledgeCompactResultCache.clear();
}

export function classifyApiKnowledgeMetadata(
  _input: ApiKnowledgeMetadataInput,
): ApiKnowledgeMetadata | null {
  return null;
}

export function resolveApiKnowledgeCandidate(input: {
  intent: string;
  url?: string;
  pageRole?: string;
}): ApiKnowledgeCandidate | null {
  void input;
  return null;
}

export async function readApiKnowledgeRows(
  input: ApiKnowledgeReadInput,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const method = normalizeMethod(input.method);
  const endpointFamily = normalizeEndpointFamily(input.endpointFamily);
  if (!endpointFamily) {
    return fallback({
      reason: 'unsupported_family',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  if (method !== 'GET') {
    return fallback({
      reason: 'method_denied',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }

  const request = buildPublicRequest(endpointFamily, input.params ?? {}, input.limit);
  if (!request) {
    return fallback({
      reason: 'invalid_request',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
  const cacheKey = input.fetchFn ? null : apiKnowledgeReadCacheKey(method, request.url);
  if (cacheKey) {
    const cached = readApiKnowledgeCompactResultCache(cacheKey, input.nowMs?.() ?? Date.now());
    if (cached) {
      return {
        ...cached,
        rows: cloneCompactRows(cached.rows),
        telemetry: {
          ...cached.telemetry,
          waitedMs: elapsed(),
          cacheHit: true,
          cacheTtlMs: API_KNOWLEDGE_COMPACT_RESULT_CACHE_TTL_MS,
        },
      };
    }
  }
  try {
    const fetchFn = input.fetchFn ?? resolveFetch();
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => {
        resolve('timeout');
        controller?.abort();
      }, API_KNOWLEDGE_READ_TIMEOUT_MS);
    });
    const fetched = fetchFn(request.url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'tabrix-api-knowledge/1.0',
      },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const responseOrTimeout = await Promise.race([fetched, timeout]).finally(() => {
      if (timeoutId) clearTimeout(timeoutId);
    });
    if (responseOrTimeout === 'timeout') {
      return fallback({
        reason: 'network_timeout',
        method,
        status: null,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    const response = responseOrTimeout;
    if (response.status === 429) {
      return fallback({
        reason: 'rate_limited',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    if (response.status === 403) {
      return fallback({
        reason: 'http_forbidden',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    if (response.status >= 400) {
      return fallback({
        reason: 'http_error',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return fallback({
        reason: 'decode_error',
        method,
        status: response.status,
        waitedMs: elapsed(),
        endpointFamily,
      });
    }
    const rows = compactRows(endpointFamily, body, request.limit);
    const emptyResult = rows.length === 0;
    const result: ApiKnowledgeReadOk = {
      status: 'ok',
      kind: 'api_rows',
      endpointFamily,
      dataPurpose: request.dataPurpose,
      rows: cloneCompactRows(rows),
      rowCount: rows.length,
      compact: true,
      rawBodyStored: false,
      // When the upstream API answered ok but returned zero rows,
      // mark the result explicitly as "verified empty"
      // rather than silently surface a 0-row list. This is NOT a
      // fallback condition — the API call succeeded — so we keep
      // `status: 'ok'` and let the caller decide how to render it.
      emptyResult,
      emptyReason: emptyResult ? 'no_matching_records' : null,
      emptyMessage: emptyResult
        ? `API call succeeded but returned no records for the requested ${request.dataPurpose} query.`
        : null,
      telemetry: {
        endpointFamily,
        method,
        reason: 'api_rows',
        status: response.status,
        waitedMs: elapsed(),
        readAllowed: true,
        fallbackEntryLayer: 'none',
        cacheHit: false,
      },
    };
    if (cacheKey) {
      writeApiKnowledgeCompactResultCache(cacheKey, result, input.nowMs?.() ?? Date.now());
    }
    return result;
  } catch {
    return fallback({
      reason: 'network_error',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
}

export async function readApiKnowledgeEndpointPlan(
  input: ApiKnowledgeEndpointReadPlan,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const method = normalizeMethod(input.method);
  const endpointFamily = normalizeEndpointFamily(input.endpointFamily);
  if (!endpointFamily) {
    return fallback({
      reason: 'unsupported_family',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  const expectedPurpose = normalizeDataPurpose(input.dataPurpose);
  const actualPurpose = dataPurposeForFamily(endpointFamily);
  if (expectedPurpose && expectedPurpose !== actualPurpose) {
    return fallback({
      reason: 'semantic_mismatch',
      method,
      status: null,
      waitedMs: elapsed(),
      endpointFamily,
    });
  }
  return readApiKnowledgeRows(input);
}

export async function readApiKnowledgeRowsForIntent(
  input: ApiKnowledgeIntentReadInput,
): Promise<ApiKnowledgeReadResult> {
  const startedAt = input.nowMs?.() ?? Date.now();
  const elapsed = () => Math.max(0, (input.nowMs?.() ?? Date.now()) - startedAt);
  const candidate = resolveApiKnowledgeCandidate({
    intent: input.intent,
    url: input.url,
    pageRole: input.pageRole,
  });
  if (!candidate) {
    return fallback({
      reason: 'unsupported_site_family',
      method: normalizeMethod(input.method),
      status: null,
      waitedMs: elapsed(),
      endpointFamily: undefined,
    });
  }
  return readApiKnowledgeRows({
    endpointFamily: candidate.endpointFamily,
    method: input.method ?? candidate.method,
    params: candidate.params,
    fetchFn: input.fetchFn,
    nowMs: input.nowMs,
    limit: input.limit,
  });
}

function apiKnowledgeReadCacheKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

function readApiKnowledgeCompactResultCache(key: string, nowMs: number): ApiKnowledgeReadOk | null {
  const entry = apiKnowledgeCompactResultCache.get(key);
  if (!entry) return null;
  if (entry.expiresAtMs <= nowMs) {
    apiKnowledgeCompactResultCache.delete(key);
    return null;
  }
  // Refresh insertion order so the Map behaves like a small LRU.
  apiKnowledgeCompactResultCache.delete(key);
  apiKnowledgeCompactResultCache.set(key, entry);
  return cloneApiKnowledgeReadOk(entry.result);
}

function writeApiKnowledgeCompactResultCache(
  key: string,
  result: ApiKnowledgeReadOk,
  nowMs: number,
): void {
  apiKnowledgeCompactResultCache.set(key, {
    expiresAtMs: nowMs + API_KNOWLEDGE_COMPACT_RESULT_CACHE_TTL_MS,
    result: cloneApiKnowledgeReadOk(result),
  });
  while (apiKnowledgeCompactResultCache.size > API_KNOWLEDGE_COMPACT_RESULT_CACHE_MAX) {
    const oldestKey = apiKnowledgeCompactResultCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    apiKnowledgeCompactResultCache.delete(oldestKey);
  }
}

function cloneApiKnowledgeReadOk(result: ApiKnowledgeReadOk): ApiKnowledgeReadOk {
  return {
    ...result,
    rows: cloneCompactRows(result.rows),
    telemetry: { ...result.telemetry },
  };
}

function cloneCompactRows(rows: ApiKnowledgeCompactRow[]): ApiKnowledgeCompactRow[] {
  return rows.map((row) => ({ ...row }));
}

function normalizeEndpointFamily(value: string): ApiEndpointFamily | null {
  const normalized = String(value || '').trim();
  return normalized ? normalized.slice(0, 160) : null;
}

function normalizeDataPurpose(value: unknown): ApiDataPurpose | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, 80) : null;
}

function dataPurposeForFamily(endpointFamily: ApiEndpointFamily): ApiDataPurpose {
  return endpointFamily;
}

function buildPublicRequest(
  _endpointFamily: ApiEndpointFamily,
  _params: Record<string, string | number | null | undefined>,
  _limit?: number,
): { url: string; limit: number; dataPurpose: ApiDataPurpose } | null {
  return null;
}

function compactRows(
  _endpointFamily: ApiEndpointFamily,
  _body: unknown,
  _limit: number,
): ApiKnowledgeCompactRow[] {
  return [];
}

function fallback(args: {
  reason: ApiKnowledgeFallbackReason;
  method: string;
  status: number | null;
  waitedMs: number;
  endpointFamily?: ApiEndpointFamily;
}): ApiKnowledgeReadFallback {
  return {
    status: 'fallback_required',
    endpointFamily: args.endpointFamily,
    reason: args.reason,
    fallbackEntryLayer: 'L0+L1',
    telemetry: {
      endpointFamily: args.endpointFamily,
      method: args.method,
      reason: args.reason,
      status: args.status,
      waitedMs: args.waitedMs,
      readAllowed: false,
      fallbackEntryLayer: 'L0+L1',
    },
  };
}

function resolveFetch(): ApiKnowledgeFetch {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis) as unknown as ApiKnowledgeFetch;
  }

  const mod = require('node-fetch');
  return (mod.default ?? mod) as ApiKnowledgeFetch;
}

function normalizeMethod(value: unknown): ApiKnowledgeMetadata['method'] {
  const method = typeof value === 'string' ? value.trim().toUpperCase() : 'GET';
  if (
    method === 'GET' ||
    method === 'HEAD' ||
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE'
  ) {
    return method;
  }
  return 'OTHER';
}
