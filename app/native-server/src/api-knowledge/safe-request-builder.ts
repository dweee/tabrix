/**
 * Generic safe-request builder for the knowledge-driven on-demand reader.
 *
 * Pure function module. Given an `EndpointMatch` (output of
 * `endpoint-lookup.ts`) and the caller's `DataNeed`, produces a
 * `SafeRequestPlan` that the executor can hand to the underlying
 * fetcher. Only observed/generic endpoint rows are supported:
 *
 *   - `generic` — for `family='observed'` rows and any future family the
 *      chooser learns. We assemble
 *      `https://${site}${pathPattern}?<param>=<value>` from the
 *      persisted `urlPattern` + `requestSummary.queryKeys`, mapping
 *      the caller's `dataNeed.params` onto whichever query key is the
 *      most likely "primary search/text/q" key. We never invent new
 *      query keys — only ones the repository row already observed.
 *
 * Hard rules:
 *   - GET only. Mutation/POST/etc. returns `null`; the executor
 *     collapses that to `fallback_required` so the legacy
 *     `chrome_read_page` chain handles it.
 *   - We never emit cookie / auth / `Authorization` query
 *     parameters. The only values that flow through are
 *     `dataNeed.params` keys explicitly supplied by the caller.
 *   - The output `url` is always an absolute `https://` URL — the
 *     executor must not consume a relative URL.
 *   - `requestShapeUsed` records the *sorted, deduped* list of query
 *     keys actually emitted. The executor surfaces this in the
 *     evidence contract; nothing else owns its shape.
 */

import type { EndpointMatch, DataNeed, SafeRequestPlan } from './types';

/** Capacity hint mirrored from the seed builder. */
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 10;
const MAX_PARAM_VALUE_LENGTH = 160;

/**
 * Build a safe GET request for the looked-up endpoint, given the
 * caller's `DataNeed`. Returns `null` when:
 *   - the row is not GET
 *   - the generic branch cannot pick a primary query key for the
 *     supplied params
 */
export function buildSafeRequest(match: EndpointMatch, dataNeed: DataNeed): SafeRequestPlan | null {
  const endpoint = match.endpoint;
  if (endpoint.method !== 'GET') return null;

  return buildGenericRequest(endpoint, dataNeed);
}

/**
 * Generic builder for `family='observed'` rows. The repository row
 * already carries:
 *   - `urlPattern = '<host><path>'` (host+path, no scheme, no query)
 *   - `requestSummary.queryKeys = sorted distinct keys we observed`
 *
 * We rebuild a URL by:
 *   1. Splitting the urlPattern back into host + path.
 *   2. Choosing a *primary query key* among the observed keys —
 *      preferring `q`/`query`/`text`/`search` style names — and
 *      mapping `dataNeed.params.query` onto it.
 *   3. Optionally adding a `limit/per_page/size` style key when the
 *      observed shape contains one.
 *
 * Anything we cannot resolve (no primary key for a query intent, no
 * params at all) returns `null` so the executor falls back to DOM.
 */
function buildGenericRequest(
  endpoint: EndpointMatch['endpoint'],
  dataNeed: DataNeed,
): SafeRequestPlan | null {
  const urlPattern = endpoint.urlPattern;
  const split = splitHostPath(urlPattern);
  if (!split) return null;
  const { host, path } = split;
  // Identity placeholders (`:owner`, `:user`, etc.) cannot be filled
  // generically — we only persist them as shape; the safe builder
  // refuses to ship a URL with literal `:foo` segments.
  if (path.includes('/:')) return null;

  const observedKeys = endpoint.requestSummary.queryKeys ?? [];
  const params = dataNeed.params ?? {};
  const url = new URL(`https://${host}${path}`);
  const emitted: string[] = [];

  const primaryQueryKey = pickPrimaryQueryKey(observedKeys);
  const queryValue =
    stringParam(params.query) ||
    stringParam(params.q) ||
    stringParam(params.text) ||
    stringParam(params.search);
  if (primaryQueryKey && queryValue) {
    url.searchParams.set(primaryQueryKey, queryValue);
    emitted.push(primaryQueryKey);
  } else if (queryValue && observedKeys.length === 0) {
    // No observed query keys at all — we cannot guess a key name
    // safely. Refuse rather than invent one.
    return null;
  } else if (
    !queryValue &&
    (dataNeed.semanticTypeWanted === 'search' || dataNeed.semanticTypeWanted === 'filter')
  ) {
    // The caller asked for a search/filter but did not supply a
    // value. Without a value we cannot produce a meaningful URL.
    return null;
  }

  const limitKey = pickLimitKey(observedKeys);
  if (limitKey) {
    url.searchParams.set(limitKey, String(clampLimit(numericParam(params.limit))));
    emitted.push(limitKey);
  }

  const semantic = endpoint.semanticType ?? 'unknown';
  return {
    url: url.toString(),
    method: 'GET',
    dataPurpose: `observed_${semantic}`,
    requestShapeUsed: sortedDistinctKeys(emitted),
    builderHint: 'generic',
  };
}

const PRIMARY_QUERY_KEY_PRIORITY: ReadonlyArray<RegExp> = [
  /^q$/i,
  /^query$/i,
  /^text$/i,
  /^search$/i,
  /^term$/i,
  /^keyword$/i,
];

function pickPrimaryQueryKey(observedKeys: ReadonlyArray<string>): string | null {
  for (const re of PRIMARY_QUERY_KEY_PRIORITY) {
    const hit = observedKeys.find((k) => re.test(k));
    if (hit) return hit;
  }
  return null;
}

const LIMIT_KEY_PRIORITY: ReadonlyArray<RegExp> = [
  /^per_page$/i,
  /^perPage$/i,
  /^pageSize$/i,
  /^page_size$/i,
  /^hitsPerPage$/i,
  /^hits_per_page$/i,
  /^size$/i,
  /^limit$/i,
];

function pickLimitKey(observedKeys: ReadonlyArray<string>): string | null {
  for (const re of LIMIT_KEY_PRIORITY) {
    const hit = observedKeys.find((k) => re.test(k));
    if (hit) return hit;
  }
  return null;
}

function splitHostPath(urlPattern: string): { host: string; path: string } | null {
  const slashIdx = urlPattern.indexOf('/');
  if (slashIdx <= 0) {
    // No path or empty host — refuse rather than invent one.
    return urlPattern.length > 0 && slashIdx === -1 ? { host: urlPattern, path: '/' } : null;
  }
  return {
    host: urlPattern.slice(0, slashIdx),
    path: urlPattern.slice(slashIdx) || '/',
  };
}

function stringParam(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, MAX_PARAM_VALUE_LENGTH);
}

function numericParam(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clampLimit(value: number | null, defaultLimit = DEFAULT_LIMIT): number {
  if (value === null) return defaultLimit;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function sortedDistinctKeys(keys: ReadonlyArray<string>): ReadonlyArray<string> {
  return Array.from(new Set(keys)).sort();
}
