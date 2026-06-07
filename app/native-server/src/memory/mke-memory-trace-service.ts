import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { MemoryTraceRepository, type BusinessSuccessVerdict, type MemoryTrace } from './db';

const REDACTED = '[redacted]';
const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 5;

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
  'rawinput',
  'rawvalue',
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

export interface RecordMkeToolCallTraceInput {
  taskId: string;
  taskIntent?: string | null;
  aiClient?: string | null;
  toolName: string;
  stepId: string;
  sequenceIndex?: number | null;
  requestParams: unknown;
  requestAtMs: number;
  responseAtMs?: number;
  result: CallToolResult;
  resultSummary?: string | null;
  errorCode?: string | null;
  browserContextKey?: string | null;
}

interface ParsedResultDigest {
  response: unknown;
  businessSuccess: BusinessSuccessVerdict;
  tabId: number | null;
  windowId: number | null;
  siteFamily: string | null;
  pageUrlPattern: string | null;
  pageRole: string | null;
  pageState: string | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  freshness: string | null;
  fallbackUsed: string | null;
}

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

function sanitizeValue(value: unknown, toolName: string, depth = 0, keyHint = ''): unknown {
  if (shouldRedactKey(keyHint, toolName)) return REDACTED;
  if (depth > MAX_DEPTH) return '[max_depth]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return truncateString(value);
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

function parseFirstTextPayload(result: CallToolResult): unknown {
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

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNestedObject(
  object: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return object ? readObject(object[key]) : null;
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  }
  return null;
}

function readBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function normalizeUrlPattern(url: string | null): {
  siteFamily: string | null;
  pattern: string | null;
} {
  if (!url) return { siteFamily: null, pattern: null };
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname
      .split('/')
      .map((segment) =>
        /^[0-9a-f-]{8,}$/i.test(segment) || /^\d+$/.test(segment) ? ':id' : segment,
      )
      .join('/');
    return {
      siteFamily: parsed.hostname,
      pattern: `${parsed.origin}${pathname}`,
    };
  } catch {
    return { siteFamily: null, pattern: truncateString(url) };
  }
}

function readBusinessSuccess(
  result: CallToolResult,
  payload: Record<string, unknown> | null,
): BusinessSuccessVerdict {
  const explicit = readBoolean(
    payload?.businessSuccess,
    payload?.success,
    payload?.ok,
    readNestedObject(payload, 'actionEvidenceResult')?.businessSuccess,
  );
  if (explicit !== null) return explicit ? 'true' : 'false';
  if (result.isError === true) return 'false';
  return 'unknown';
}

function digestResult(result: CallToolResult, toolName: string): ParsedResultDigest {
  const payload = parseFirstTextPayload(result);
  const object = readObject(payload);
  const page = readNestedObject(object, 'page');
  const summary = readNestedObject(object, 'summary');
  const pageContext = readNestedObject(object, 'pageContext');
  const dataSourceDecision = readNestedObject(object, 'dataSourceDecision');
  const url = readString(page?.url, object?.url, object?.pageUrl);
  const urlFields = normalizeUrlPattern(url);

  return {
    response: {
      isError: result.isError === true,
      contentTypes: result.content?.map((item) => item.type) ?? [],
      payloadDigest: sanitizeValue(payload, toolName),
    },
    businessSuccess: readBusinessSuccess(result, object),
    tabId: readNumber(object?.tabId, readNestedObject(object, 'pageProjection')?.tabId),
    windowId: readNumber(object?.windowId),
    siteFamily: urlFields.siteFamily,
    pageUrlPattern: urlFields.pattern,
    pageRole: readString(summary?.pageRole, object?.pageRole),
    pageState: readString(summary?.quality, object?.pageState),
    sourceRoute: readString(object?.sourceRoute, pageContext?.sourceRoute),
    selectedDataSource: readString(
      object?.selectedDataSource,
      object?.dataSource,
      dataSourceDecision?.selectedDataSource,
    ),
    freshness: readString(object?.freshness, pageContext?.freshness),
    fallbackUsed: readString(object?.fallbackUsed, pageContext?.fallbackUsed),
  };
}

function readRequestNumber(request: Record<string, unknown> | null, key: string): number | null {
  return readNumber(request?.[key]);
}

export class MkeMemoryTraceService {
  constructor(private readonly repo: MemoryTraceRepository) {}

  public recordToolCall(input: RecordMkeToolCallTraceInput): MemoryTrace {
    const requestObject = readObject(input.requestParams);
    const responseAtMs = input.responseAtMs ?? Date.now();
    const digest = digestResult(input.result, input.toolName);
    const tabId = digest.tabId ?? readRequestNumber(requestObject, 'tabId');
    const windowId = digest.windowId ?? readRequestNumber(requestObject, 'windowId');

    return this.repo.append({
      taskId: input.taskId,
      taskIntent: input.taskIntent ?? null,
      aiClient: input.aiClient ?? null,
      toolName: input.toolName,
      toolCallId: input.stepId,
      sequenceIndex: input.sequenceIndex ?? null,
      requestParams: sanitizeValue(input.requestParams, input.toolName),
      requestAt: new Date(input.requestAtMs).toISOString(),
      response: digest.response,
      responseAt: new Date(responseAtMs).toISOString(),
      durationMs: Math.max(0, responseAtMs - input.requestAtMs),
      toolSuccess: input.result.isError !== true,
      businessSuccess: digest.businessSuccess,
      resultSummary: input.resultSummary ?? null,
      errorCode: input.errorCode ?? null,
      tabId,
      windowId,
      browserContextKey: input.browserContextKey ?? null,
      siteFamily: digest.siteFamily,
      pageUrlPattern: digest.pageUrlPattern,
      pageRole: digest.pageRole,
      pageState: digest.pageState,
      sourceRoute: digest.sourceRoute,
      selectedDataSource: digest.selectedDataSource,
      freshness: digest.freshness,
      fallbackUsed: digest.fallbackUsed,
      redactionState: 'redacted',
      createdAt: new Date(responseAtMs).toISOString(),
    });
  }

  public listByTask(taskId: string): MemoryTrace[] {
    return this.repo.listByTask(taskId);
  }

  public count(): number {
    return this.repo.count();
  }

  public clear(): void {
    this.repo.clear();
  }
}
