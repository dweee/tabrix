import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { readBoolean, readNumber, readObject, readString } from './mke-memory-value-readers';

const REDACTED = '[redacted]';
const MAX_STRING_LENGTH = 512;
const MAX_ROUTE_LENGTH = 2048;
const MAX_RESULT_SUMMARY_LENGTH = 512;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 6;

const SENSITIVE_KEY_FRAGMENTS = [
  'account',
  'authorization',
  'captcha',
  'cookie',
  'credential',
  'email',
  'formvalue',
  'otp',
  'password',
  'phone',
  'rawbody',
  'rawnetworkbody',
  'requestbody',
  'responsebody',
  'rawinput',
  'rawvalue',
  'commonrequestheaders',
  'commonresponseheaders',
  'specificrequestheaders',
  'specificresponseheaders',
  'requestheaders',
  'responseheaders',
  'secret',
  'sessionid',
  'smscode',
  'submittedvalue',
  'token',
  'username',
  'verificationcode',
  '验证码',
  '账号',
  '手机号',
  '密码',
];

const RAW_CONTENT_KEYS = new Set([
  'body',
  'content',
  'innerhtml',
  'outerhtml',
  'pagecontent',
  'raw',
  'rawbody',
  'rawhtml',
  'text',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function shouldRedactKey(key: string, toolName: string): boolean {
  const normalized = normalizeKey(key);
  if (toolName === 'chrome_fill_or_select' && normalized === 'value') return true;
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function shouldDropRawContentKey(key: string): boolean {
  return RAW_CONTENT_KEYS.has(normalizeKey(key));
}

function truncateString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_STRING_LENGTH)}...[truncated:${value.length}]`;
}

function truncateRouteString(value: string): string {
  if (value.length <= MAX_ROUTE_LENGTH) return value;
  return `${value.slice(0, MAX_ROUTE_LENGTH)}...[truncated:${value.length}]`;
}

function sanitizeSearchParams(
  searchParams: URLSearchParams,
  allowPersonalBrowserStateStorage: boolean,
): string {
  if (allowPersonalBrowserStateStorage) {
    const serialized = searchParams.toString();
    return serialized ? `?${serialized}` : '';
  }
  return '';
}

function sanitizeCurrentRoute(parsed: URL, allowPersonalBrowserStateStorage: boolean): string {
  const search = sanitizeSearchParams(parsed.searchParams, allowPersonalBrowserStateStorage);
  return truncateRouteString(`${parsed.origin}${parsed.pathname}${search}${parsed.hash}`);
}

export function normalizeUrlPattern(
  url: string | null,
  options: { allowPersonalBrowserStateStorage?: boolean } = {},
): {
  siteFamily: string | null;
  pattern: string | null;
  rootRoute: string | null;
  currentRoute: string | null;
} {
  if (!url) return { siteFamily: null, pattern: null, rootRoute: null, currentRoute: null };
  try {
    const parsed = new URL(url);
    if (['chrome:', 'edge:', 'about:'].includes(parsed.protocol)) {
      return {
        siteFamily: 'browser',
        pattern: parsed.href,
        rootRoute: parsed.href,
        currentRoute: parsed.href,
      };
    }
    const pathname = parsed.pathname
      .split('/')
      .map((segment) =>
        /^[0-9a-f-]{8,}$/i.test(segment) || /^\d+$/.test(segment) ? ':id' : segment,
      )
      .join('/');
    const rootRoute = `${parsed.origin}${pathname}`;
    return {
      siteFamily: parsed.hostname,
      pattern: rootRoute,
      rootRoute,
      currentRoute: sanitizeCurrentRoute(parsed, options.allowPersonalBrowserStateStorage === true),
    };
  } catch {
    const fallback = truncateRouteString(url);
    return { siteFamily: null, pattern: fallback, rootRoute: fallback, currentRoute: fallback };
  }
}

function sanitizeStringValue(value: string): string {
  const trimmed = value.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const urlFields = normalizeUrlPattern(trimmed, {
      allowPersonalBrowserStateStorage: false,
    });
    return truncateString(
      urlFields.currentRoute ?? urlFields.rootRoute ?? urlFields.pattern ?? value,
    );
  }
  if (/[?&][^=\s"'&]*token[^=\s"'&]*=/i.test(value)) {
    return truncateString(
      value.replace(/([?&][^=\s"'&]*token[^=\s"'&]*=)[^&\s"']+/gi, `$1${REDACTED}`),
    );
  }
  return truncateString(value);
}

export function sanitizeResultSummaryForMemory(
  summary: string | null | undefined,
  toolName: string,
  payload: unknown,
): string | null {
  const trimmed = typeof summary === 'string' ? summary.trim() : '';
  const parsedPayload = readObject(payload);

  if (toolName === 'chrome_network_capture') {
    const requestCount = readNumber(
      parsedPayload?.requestCount,
      parsedPayload?.totalRequestsReceived,
    );
    const observationMode = readString(parsedPayload?.observationMode);
    const cdpUsed = readBoolean(parsedPayload?.cdpUsed);
    const rawBodyPersisted = readBoolean(parsedPayload?.rawBodyPersisted);
    const bodyCompacted = readBoolean(parsedPayload?.bodyCompacted);
    return [
      'chrome_network_capture summary',
      requestCount !== null ? `requests=${requestCount}` : null,
      observationMode ? `mode=${observationMode}` : null,
      cdpUsed !== null ? `cdpUsed=${cdpUsed}` : null,
      rawBodyPersisted !== null ? `rawBodyPersisted=${rawBodyPersisted}` : null,
      bodyCompacted !== null ? `bodyCompacted=${bodyCompacted}` : null,
    ]
      .filter((part): part is string => Boolean(part))
      .join('; ');
  }

  if (!trimmed) return null;
  if (
    trimmed.length > MAX_RESULT_SUMMARY_LENGTH ||
    /\b(requestBody|responseBody|rawBody|rawHtml|specificRequestHeaders|specificResponseHeaders|Authorization|Cookie|Set-Cookie)\b/i.test(
      trimmed,
    )
  ) {
    return `${toolName} result summary redacted; structured redacted digest retained.`;
  }
  return truncateString(trimmed);
}

export function sanitizeValue(value: unknown, toolName: string, depth = 0, keyHint = ''): unknown {
  if (shouldRedactKey(keyHint, toolName)) return REDACTED;
  if (depth > MAX_DEPTH) return '[max_depth]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return sanitizeStringValue(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, toolName, depth + 1));
  }
  if (typeof value !== 'object') return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (shouldRedactKey(key, toolName)) {
      output[key] = REDACTED;
      continue;
    }
    if (shouldDropRawContentKey(key)) {
      output[key] = '[omitted_raw_content]';
      continue;
    }
    output[key] = sanitizeValue(entry, toolName, depth + 1, key);
  }
  return output;
}

export function parseFirstTextPayload(result: CallToolResult): unknown {
  const firstText = result.content?.find(
    (item): item is { type: 'text'; text: string } =>
      item.type === 'text' && typeof (item as { text?: unknown }).text === 'string',
  );
  if (!firstText) return null;
  try {
    return JSON.parse(firstText.text);
  } catch {
    return { textLength: firstText.text.length };
  }
}
