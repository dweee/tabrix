import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  type BrowserObject,
  type BrowserObjectInput,
  type BusinessSuccessVerdict,
  type MemoryTrace,
} from './db';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';
import { logger } from '../logging/logger';

const REDACTED = '[redacted]';
const MAX_STRING_LENGTH = 512;
const MAX_ROUTE_LENGTH = 2048;
const MAX_RESULT_SUMMARY_LENGTH = 512;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 6;
const DEFAULT_ASYNC_BROWSER_OBJECT_WRITE_QUEUE_LIMIT = 128;
const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

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

const BLOCKED_PAGE_SIGNAL_PATTERN =
  /\b(captcha|recaptcha|challenge|verification|security[-_]?check|human[-_]?check|verify(uuid|type|biz)?|user[_-]?verification[_-]?required|login[_-]?required|auth[_-]?required|access[_-]?denied|restricted|blocked)\b|安全验证|人机验证|滑块验证|验证码|登录验证/i;

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

export interface RecordMkeAiBusinessFeedbackInput {
  traceId: string;
  taskId?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  sequenceIndex?: number | null;
  traceBindingHash?: string | null;
  evaluationScope?: 'step' | 'task' | null;
  businessStatus: BusinessSuccessVerdict;
  confidence?: number | null;
  reasonCode?: string | null;
  summary?: string | null;
  receivedAt?: string;
  sourceToolName?: string | null;
  sourceToolCallId?: string | null;
}

export class MkeAiFeedbackValidationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MkeAiFeedbackValidationError';
    this.code = code;
  }
}

export interface RecordBrowserWorldSnapshotInput {
  browserWorld: unknown;
  observedAtMs?: number;
  browserContextKey?: string | null;
}

interface ParsedResultDigest {
  response: unknown;
  businessSuccess: BusinessSuccessVerdict;
  tabId: number | null;
  windowId: number | null;
  siteFamily: string | null;
  pageUrlPattern: string | null;
  rootRoute: string | null;
  currentRoute: string | null;
  pageRole: string | null;
  pageModelKey: string | null;
  pageState: string | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  freshness: string | null;
  fallbackUsed: string | null;
}

export interface MkeMemoryTraceServiceOptions {
  asyncBrowserObjectWriteQueueLimit?: number;
}

interface AsyncBrowserObjectWriteJob {
  traceId: string;
  toolName: string;
  run(): void;
}

interface BrowserObjectProjectionTrace {
  traceId?: string | null;
  browserContextKey?: string | null;
  sourceRoute?: string | null;
  freshness?: string | null;
  windowId?: number | null;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
}

interface BrowserWorldTabProjection {
  tab: Record<string, unknown>;
  tabId: number;
  windowId: number | null;
  urlFields: ReturnType<typeof normalizeUrlPattern>;
}

class BoundedAsyncBrowserObjectWriteQueue {
  private queue: AsyncBrowserObjectWriteJob[] = [];
  private scheduled = false;
  private running = false;
  private flushResolvers: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  public enqueue(job: AsyncBrowserObjectWriteJob): void {
    if (this.limit <= 0) {
      mkeMemoryTraceLogger.warn('async browser object write dropped because queue is disabled', {
        traceId: job.traceId,
        toolName: job.toolName,
      });
      return;
    }
    if (this.queue.length >= this.limit) {
      const dropped = this.queue.shift();
      mkeMemoryTraceLogger.warn('async browser object write queue full; dropping oldest job', {
        droppedTraceId: dropped?.traceId ?? null,
        droppedToolName: dropped?.toolName ?? null,
        traceId: job.traceId,
        toolName: job.toolName,
        queueLimit: this.limit,
      });
    }
    this.queue.push(job);
    this.schedule();
  }

  public flush(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => {
      this.flushResolvers.push(resolve);
    });
  }

  public discardPending(): void {
    this.queue = [];
    this.resolveFlushersIfIdle();
  }

  private schedule(): void {
    if (this.scheduled || this.running) return;
    this.scheduled = true;
    setImmediate(() => this.runQueuedJobs());
  }

  private runQueuedJobs(): void {
    this.scheduled = false;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (!job) continue;
        try {
          job.run();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          mkeMemoryTraceLogger.warn('async browser object write failed', {
            traceId: job.traceId,
            toolName: job.toolName,
            errorMessage: message,
          });
        }
      }
    } finally {
      this.running = false;
      this.resolveFlushersIfIdle();
      if (this.queue.length > 0) this.schedule();
    }
  }

  private isIdle(): boolean {
    return this.queue.length === 0 && !this.scheduled && !this.running;
  }

  private resolveFlushersIfIdle(): void {
    if (!this.isIdle()) return;
    const resolvers = this.flushResolvers.splice(0);
    for (const resolve of resolvers) resolve();
  }
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

function truncateRouteString(value: string): string {
  if (value.length <= MAX_ROUTE_LENGTH) return value;
  return `${value.slice(0, MAX_ROUTE_LENGTH)}...[truncated:${value.length}]`;
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

function stringHasBlockedPageSignal(value: string | null | undefined): boolean {
  return typeof value === 'string' && BLOCKED_PAGE_SIGNAL_PATTERN.test(value);
}

function valueHasBlockedPageSignal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return stringHasBlockedPageSignal(value);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some(valueHasBlockedPageSignal);
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => stringHasBlockedPageSignal(key) || valueHasBlockedPageSignal(entry),
  );
}

function sanitizeResultSummaryForMemory(
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

function sanitizeValue(value: unknown, toolName: string, depth = 0, keyHint = ''): unknown {
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

function readFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function readBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeResultCardActionToolArgs(rawActionTarget: Record<string, unknown> | null):
  | {
      toolName: 'chrome_click_element';
      toolArgs: {
        candidateAction: {
          id: string | null;
          actionType: 'click';
          targetRef: string;
          confidence: number | null;
          matchReason: string | null;
          intent: 'content.open_detail';
          locatorChain: Array<{ type: string; value: string }>;
        };
      };
    }
  | Record<string, never> {
  if (readString(rawActionTarget?.toolName) !== 'chrome_click_element') return {};
  const toolArgs = readObject(rawActionTarget?.toolArgs);
  const candidateAction = readObject(toolArgs?.candidateAction);
  const targetRef = readString(candidateAction?.targetRef);
  if (!targetRef || !targetRef.startsWith('ref_result_card_')) return {};
  const actionType = readString(candidateAction?.actionType);
  const intent = readString(candidateAction?.intent);
  if (actionType !== 'click' || intent !== 'content.open_detail') return {};
  const locatorChain = readArray(candidateAction?.locatorChain)
    .map((entry) => {
      const locator = readObject(entry);
      const type = readString(locator?.type);
      const value = readString(locator?.value);
      if (!type || !value) return null;
      if (type !== 'ref' && type !== 'css') return null;
      if (type === 'ref' && value !== targetRef) return null;
      if (type === 'css' && value.length > 500) return null;
      return { type, value };
    })
    .filter((entry): entry is { type: string; value: string } => Boolean(entry));
  if (!locatorChain.some((locator) => locator.type === 'css')) return {};
  return {
    toolName: 'chrome_click_element',
    toolArgs: {
      candidateAction: {
        id: readString(candidateAction?.id),
        actionType: 'click',
        targetRef,
        confidence: readFiniteNumber(candidateAction?.confidence),
        matchReason: readString(candidateAction?.matchReason),
        intent: 'content.open_detail',
        locatorChain,
      },
    },
  };
}

function normalizeResultCardOpenAction(rawActionTarget: Record<string, unknown> | null):
  | {
      openAction: {
        toolName: 'chrome_navigate';
        toolArgs: { url: string | null };
        executionScope: 'session_url';
        reason: 'result_card_href';
        confidence: number | null;
      };
    }
  | Record<string, never> {
  const openAction = readObject(rawActionTarget?.openAction);
  if (readString(openAction?.toolName) !== 'chrome_navigate') return {};
  const toolArgs = readObject(openAction?.toolArgs);
  const urlFields = normalizeUrlPattern(readString(toolArgs?.url), {
    allowPersonalBrowserStateStorage: false,
  });
  const normalizedUrl = urlFields.rootRoute ?? urlFields.currentRoute ?? urlFields.pattern;
  if (!normalizedUrl) return {};
  return {
    openAction: {
      toolName: 'chrome_navigate',
      toolArgs: { url: normalizedUrl },
      executionScope: 'session_url',
      reason: 'result_card_href',
      confidence: readFiniteNumber(openAction?.confidence),
    },
  };
}

function mergeReadPageFactsWithExistingCollectionFacts(
  readPageFacts: Record<string, unknown>,
  existingFactsValue: unknown,
): Record<string, unknown> {
  const existingFacts = readObject(existingFactsValue);
  if (!existingFacts) return readPageFacts;
  const merged: Record<string, unknown> = { ...readPageFacts };
  const preservedKeys = [
    'filterState',
    'observedResultCount',
    'requestedMinResults',
    'complete',
    'status',
  ];
  for (const key of preservedKeys) {
    if (merged[key] === undefined && existingFacts[key] !== undefined) {
      merged[key] = existingFacts[key];
    }
  }
  const source = readString(existingFacts.source);
  if (source) merged.lastCollectionSource = source;
  return merged;
}

function readBusinessVerdictString(...values: unknown[]): BusinessSuccessVerdict | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (value === 'proven') return 'achieved';
    if (value === 'not_proven') return 'unknown';
    if (
      value === 'achieved' ||
      value === 'partial' ||
      value === 'not_achieved' ||
      value === 'true' ||
      value === 'false' ||
      value === 'unknown'
    ) {
      return value;
    }
  }
  return null;
}

function normalizePageRoleForMemory(value: string | null): string | null {
  if (value === 'search_list') return 'search_results';
  return value;
}

function normalizeUrlPattern(
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

const SENSITIVE_QUERY_KEYS = new Set([
  'code',
  'ticket',
  'api_key',
  'apikey',
  'access_key',
  'secret_key',
  'client_secret',
]);

function shouldRedactQueryParam(key: string): boolean {
  const normalized = key.toLowerCase();
  return SENSITIVE_QUERY_KEYS.has(normalized) || shouldRedactKey(key, 'browser_object_route');
}

function sanitizeSearchParams(
  searchParams: URLSearchParams,
  allowPersonalBrowserStateStorage: boolean,
): string {
  if (allowPersonalBrowserStateStorage) {
    const serialized = searchParams.toString();
    return serialized ? `?${serialized}` : '';
  }
  const sanitized = new URLSearchParams();
  for (const [key, value] of searchParams.entries()) {
    if (shouldRedactQueryParam(key)) continue;
    sanitized.append(key, value);
  }
  const serialized = sanitized.toString();
  return serialized ? `?${serialized}` : '';
}

function sanitizeCurrentRoute(parsed: URL, allowPersonalBrowserStateStorage: boolean): string {
  const search = sanitizeSearchParams(parsed.searchParams, allowPersonalBrowserStateStorage);
  return truncateRouteString(`${parsed.origin}${parsed.pathname}${search}${parsed.hash}`);
}

function readBusinessSuccess(
  result: CallToolResult,
  payload: Record<string, unknown> | null,
): BusinessSuccessVerdict {
  const actionEvidenceResult = readNestedObject(payload, 'actionEvidenceResult');
  const actionBusiness = readNestedObject(actionEvidenceResult, 'business');
  const tabrixMetadata = readNestedObject(payload, '_tabrix');
  const explicitVerdict = readBusinessVerdictString(
    payload?.businessSuccess,
    tabrixMetadata?.businessStatus,
    actionBusiness?.businessSuccessVerdict,
  );
  if (explicitVerdict) return explicitVerdict;

  const explicit = readBoolean(payload?.businessSuccess);
  if (explicit !== null) return explicit ? 'true' : 'false';
  if (readBoolean(actionBusiness?.businessSuccessProven) === true) return 'true';
  if (result.isError === true) return 'false';
  return 'unknown';
}

function normalizePageStateForMemory(input: {
  payload: Record<string, unknown> | null;
  page: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  url: string | null;
}): string | null {
  const authArtifactStatus = readNestedObject(input.payload, 'authArtifactStatus');
  const observedAuthSurface = readNestedObject(input.payload, 'observedAuthSurface');
  if (
    stringHasBlockedPageSignal(input.url) ||
    valueHasBlockedPageSignal(authArtifactStatus) ||
    valueHasBlockedPageSignal(observedAuthSurface) ||
    valueHasBlockedPageSignal(input.summary) ||
    valueHasBlockedPageSignal(input.page)
  ) {
    return 'restricted';
  }
  return readString(input.summary?.quality, input.payload?.pageState);
}

function digestResult(
  result: CallToolResult,
  toolName: string,
  payload = parseFirstTextPayload(result),
): ParsedResultDigest {
  const object = readObject(payload);
  const page = readNestedObject(object, 'page');
  const summary = readNestedObject(object, 'summary');
  const pageContext = readNestedObject(object, 'pageContext');
  const dataSourceDecision = readNestedObject(object, 'dataSourceDecision');
  const url = readString(page?.url, object?.url, object?.pageUrl);
  const urlFields = normalizeUrlPattern(url);
  const pageRole = normalizePageRoleForMemory(readString(summary?.pageRole, object?.pageRole));
  const pageModelKey = readString(
    readNestedObject(object, 'pageProjection')?.pageModelKey,
    object?.pageModelKey,
    pageRole && urlFields.siteFamily ? `page:${urlFields.siteFamily}:${pageRole}` : null,
  );

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
    rootRoute: urlFields.rootRoute,
    currentRoute: urlFields.currentRoute,
    pageRole,
    pageModelKey,
    pageState: normalizePageStateForMemory({ payload: object, page, summary, url }),
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

function objectFingerprint(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined || part === '' ? 'unknown' : String(part)))
    .join(':');
}

function browserPageObjectKey(tab: BrowserWorldTabProjection): string {
  return (
    tab.urlFields.rootRoute ??
    tab.urlFields.currentRoute ??
    tab.urlFields.pattern ??
    String(tab.tabId)
  );
}

function browserWorldTabRank(tab: BrowserWorldTabProjection): number {
  if (readBoolean(tab.tab.active) === true) return 0;
  if (readString(tab.tab.status) === 'loading') return 2;
  if (readBoolean(tab.tab.canTabrixOperate) === false) return 3;
  return 1;
}

function chooseRepresentativeBrowserWorldTab(
  current: BrowserWorldTabProjection,
  candidate: BrowserWorldTabProjection,
): BrowserWorldTabProjection {
  const currentRank = browserWorldTabRank(current);
  const candidateRank = browserWorldTabRank(candidate);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  return candidate.tabId > current.tabId ? candidate : current;
}

function isApiLikeDataSource(...values: Array<string | null | undefined>): boolean {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return (
    text.includes('api') ||
    text.includes('cdp') ||
    text.includes('endpoint') ||
    text.includes('knowledge')
  );
}

function normalizeOwnerType(value: string | null): string | null {
  if (!value) return null;
  if (value === 'ai' || value === 'run_owned') return 'ai';
  if (value === 'user_or_page' || value === 'user_owned' || value === 'page_opener') {
    return 'user_or_page';
  }
  return 'unknown';
}

function sourceTraceIds(trace: BrowserObjectProjectionTrace): string[] {
  return trace.traceId ? [trace.traceId] : [];
}

function normalizeConfidence(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

const DEFAULT_AI_FEEDBACK_EVALUATION_VERSION = 'ai_feedback_v1';
const DEFAULT_AI_FEEDBACK_RUBRIC_VERSION = 'tabrix_ai_business_feedback_v1';

function normalizeAiFeedbackScope(value: string | null | undefined): 'step' | 'task' {
  return value === 'task' ? 'task' : 'step';
}

function ensureFeedbackBinding(
  input: RecordMkeAiBusinessFeedbackInput,
  trace: MemoryTrace,
): string {
  const expectedHash = buildMemoryTraceBindingHash(trace);
  const acceptedHashes = new Set([
    expectedHash,
    buildLegacyMemoryTraceBindingHash(trace),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: 'unknown' }),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: null }),
  ]);
  if (!input.traceBindingHash || !acceptedHashes.has(input.traceBindingHash)) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback binding does not match the target Memory trace.',
    );
  }
  if (input.taskId !== undefined && input.taskId !== null && input.taskId !== trace.taskId) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback taskId does not match the target Memory trace.',
    );
  }
  if (
    input.toolName !== undefined &&
    input.toolName !== null &&
    input.toolName !== trace.toolName
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback toolName does not match the target Memory trace.',
    );
  }
  if (
    input.toolCallId !== undefined &&
    input.toolCallId !== null &&
    input.toolCallId !== trace.toolCallId
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback toolCallId does not match the target Memory trace.',
    );
  }
  if (
    input.sequenceIndex !== undefined &&
    input.sequenceIndex !== null &&
    input.sequenceIndex !== trace.sequenceIndex
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback sequenceIndex does not match the target Memory trace.',
    );
  }
  return expectedHash;
}

function validateAiFeedbackQuality(input: {
  businessStatus: BusinessSuccessVerdict;
  confidence: number | null;
  summary: string | null | undefined;
}): void {
  const highConfidenceSuccess =
    input.businessStatus === 'achieved' &&
    typeof input.confidence === 'number' &&
    input.confidence >= 0.9;
  if (highConfidenceSuccess && (!input.summary || input.summary.trim().length < 8)) {
    throw new MkeAiFeedbackValidationError(
      'summary_required',
      'High-confidence achieved feedback must include a concise AI evaluation summary.',
    );
  }
}

export class MkeMemoryTraceService {
  private readonly asyncBrowserObjectWrites: BoundedAsyncBrowserObjectWriteQueue;

  constructor(
    private readonly repo: MemoryTraceRepository,
    private readonly browserObjects?: BrowserObjectRepository,
    private readonly options: MkeMemoryTraceServiceOptions = {},
  ) {
    this.asyncBrowserObjectWrites = new BoundedAsyncBrowserObjectWriteQueue(
      options.asyncBrowserObjectWriteQueueLimit ?? DEFAULT_ASYNC_BROWSER_OBJECT_WRITE_QUEUE_LIMIT,
    );
  }

  private sanitizeBrowserObjectValue(value: unknown): unknown {
    return sanitizeValue(value, 'browser_object');
  }

  private browserObjectRedactionState(): string {
    return 'redacted';
  }

  public recordToolCall(input: RecordMkeToolCallTraceInput): MemoryTrace {
    const requestObject = readObject(input.requestParams);
    const responseAtMs = input.responseAtMs ?? Date.now();
    const payload = parseFirstTextPayload(input.result);
    const digest = digestResult(input.result, input.toolName, payload);
    const tabId = digest.tabId ?? readRequestNumber(requestObject, 'tabId');
    const windowId = digest.windowId ?? readRequestNumber(requestObject, 'windowId');
    const toolSuccess = input.result.isError !== true;

    const trace = this.repo.append({
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
      toolSuccess,
      businessSuccess: digest.businessSuccess,
      resultSummary: sanitizeResultSummaryForMemory(input.resultSummary, input.toolName, payload),
      errorCode: input.errorCode ?? null,
      tabId,
      windowId,
      browserContextKey: input.browserContextKey ?? null,
      siteFamily: digest.siteFamily,
      pageUrlPattern: digest.pageUrlPattern,
      pageRole: digest.pageRole,
      pageState: digest.pageState,
      pageModelKey: digest.pageModelKey,
      sourceRoute: digest.sourceRoute,
      selectedDataSource: digest.selectedDataSource,
      freshness: digest.freshness,
      fallbackUsed: digest.fallbackUsed,
      redactionState: 'redacted',
      createdAt: new Date(responseAtMs).toISOString(),
    });
    this.asyncBrowserObjectWrites.enqueue({
      traceId: trace.traceId,
      toolName: input.toolName,
      run: () =>
        this.recordBrowserObjectsFromToolResult({
          trace,
          payload,
          toolName: input.toolName,
          observedAt: new Date(responseAtMs).toISOString(),
          browserContextKey: input.browserContextKey ?? null,
        }),
    });
    return trace;
  }

  public recordBrowserWorldSnapshot(input: RecordBrowserWorldSnapshotInput): void {
    if (!this.browserObjects) return;
    const browserWorld = readObject(input.browserWorld);
    if (!browserWorld) return;
    const observedAtMs =
      typeof input.observedAtMs === 'number' && Number.isFinite(input.observedAtMs)
        ? input.observedAtMs
        : Date.now();
    const observedAt = new Date(observedAtMs).toISOString();
    const payload = {
      source: 'chrome_windows_get_all_with_browser_world_inventory',
      browserWorld,
    };
    const projectionTrace: BrowserObjectProjectionTrace = {
      traceId: null,
      browserContextKey: input.browserContextKey ?? 'extension_browser_world_inventory',
      sourceRoute: 'chrome_windows_get_all_with_browser_world_inventory',
      freshness: readString(browserWorld.status, browserWorld.freshness),
      windowId: null,
      siteFamily: null,
      pageUrlPattern: null,
    };

    try {
      this.browserObjects.transaction(() => {
        this.recordBrowserWorldObjects(
          projectionTrace,
          payload,
          observedAt,
          projectionTrace.browserContextKey ?? null,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mkeMemoryTraceLogger.warn('browser world snapshot projection failed', {
        errorMessage: message,
      });
    }
  }

  public flushAsyncWrites(): Promise<void> {
    return this.asyncBrowserObjectWrites.flush();
  }

  public discardPendingAsyncWrites(): void {
    this.asyncBrowserObjectWrites.discardPending();
  }

  private recordBrowserObjectsFromToolResult(input: {
    trace: MemoryTrace;
    payload: unknown;
    toolName: string;
    observedAt: string;
    browserContextKey: string | null;
  }): void {
    if (!this.browserObjects) return;
    const payload = readObject(input.payload);
    if (!payload) return;
    try {
      this.browserObjects.transaction(() => {
        if (input.toolName === 'get_windows_and_tabs') {
          this.recordBrowserWorldObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
          return;
        }
        if (input.toolName === 'chrome_read_page') {
          this.recordReadPageObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
          return;
        }
        if (input.toolName === 'chrome_collect_result_cards') {
          this.recordCollectedResultCardObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mkeMemoryTraceLogger.warn('browser object projection failed', {
        traceId: input.trace.traceId,
        toolName: input.toolName,
        errorMessage: message,
      });
    }
  }

  private upsertBrowserObject(input: BrowserObjectInput): BrowserObject | undefined {
    return this.browserObjects?.upsert(input);
  }

  private recordBrowserWorldObjects(
    trace: BrowserObjectProjectionTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const browserWorld = readNestedObject(payload, 'browserWorld') ?? payload;
    const contextKey = browserContextKey ?? trace.browserContextKey ?? 'default';
    for (const rawWindow of readArray(browserWorld.windows)) {
      const win = readObject(rawWindow);
      if (!win) continue;
      const id = readNumber(win.windowId, win.id);
      if (id === null) continue;
      this.upsertBrowserObject({
        siteFamily: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: objectFingerprint('window', id),
        objectType: 'window',
        browserContextKey: contextKey,
        windowId: id,
        sourceRoute: readString(payload.source, trace.sourceRoute, 'browser_world_inventory'),
        sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
        lifecycleState: readString(win.lifecycleState, 'updated'),
        isActive: readBoolean(win.focused, win.isFocused, win.active),
        canTabrixOperate: readBoolean(win.canTabrixOperate),
        operabilityReason: readString(win.operabilityReason),
        facts: {
          tabCount: readNumber(win.tabCount),
          activeTabId: readNumber(win.activeTabId),
          state: readString(win.state, win.visibilityState),
        },
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        currentState: sanitizeValue(
          {
            focused: readBoolean(win.focused, win.isFocused),
            state: readString(win.state, win.visibilityState),
            tabCount: readNumber(win.tabCount),
          },
          'browser_object',
        ),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
      });
    }
    const tabsByBaseRoute = new Map<
      string,
      { representative: BrowserWorldTabProjection; tabs: BrowserWorldTabProjection[] }
    >();
    for (const rawTab of readArray(browserWorld.tabs)) {
      const tab = readObject(rawTab);
      if (!tab) continue;
      const tabId = readNumber(tab.tabId, tab.id);
      if (tabId === null) continue;
      const urlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
        allowPersonalBrowserStateStorage: false,
      });
      const tabWindowId = readNumber(tab.windowId) ?? trace.windowId ?? null;
      const projectedTab: BrowserWorldTabProjection = {
        tab,
        tabId,
        windowId: tabWindowId,
        urlFields,
      };
      const baseRouteKey = browserPageObjectKey(projectedTab);
      const group = tabsByBaseRoute.get(baseRouteKey);
      if (group) {
        group.tabs.push(projectedTab);
        group.representative = chooseRepresentativeBrowserWorldTab(
          group.representative,
          projectedTab,
        );
      } else {
        tabsByBaseRoute.set(baseRouteKey, { representative: projectedTab, tabs: [projectedTab] });
      }
    }
    for (const [baseRouteKey, group] of tabsByBaseRoute.entries()) {
      const representative = group.representative;
      const { tab, tabId, windowId: tabWindowId, urlFields } = representative;
      const openTabIds = group.tabs.map((item) => item.tabId);
      const hasLoading = group.tabs.some((item) => readString(item.tab.status) === 'loading');
      const hasRestricted = group.tabs.some(
        (item) => readBoolean(item.tab.canTabrixOperate) === false,
      );
      this.upsertBrowserObject({
        siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
        pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        pageRole: 'browser_tab',
        pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
        objectFingerprint: objectFingerprint('browser_page', baseRouteKey),
        objectType: 'tab',
        browserContextKey: contextKey,
        tabId,
        windowId: tabWindowId,
        ownerType: normalizeOwnerType(readString(tab.ownerType, tab.openedBy, tab.owner)),
        sourceRoute: readString(payload.source, trace.sourceRoute, 'browser_world_inventory'),
        sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
        tabStatus: readString(tab.status),
        lifecycleState: readString(tab.lifecycleState, tab.closedAtMs ? 'closed' : 'updated'),
        isActive: readBoolean(tab.active),
        canTabrixOperate: readBoolean(tab.canTabrixOperate),
        operabilityReason: readString(tab.operabilityReason),
        facts: this.sanitizeBrowserObjectValue({
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          openerTabId: readNumber(tab.openerTabId),
        }),
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        currentState: this.sanitizeBrowserObjectValue({
          active: readBoolean(tab.active),
          status: readString(tab.status),
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
        }),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
        closedAt: readNumber(tab.closedAtMs) ? observedAt : null,
        archivedAt: null,
      });
    }
    this.recordClosedBrowserWorldPage(trace, browserWorld, observedAt, contextKey, payload);
  }

  private recordClosedBrowserWorldPage(
    trace: BrowserObjectProjectionTrace,
    browserWorld: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string,
    payload: Record<string, unknown>,
  ): void {
    const summary = readNestedObject(browserWorld, 'summary');
    const recentActivityLedger =
      readObject(browserWorld.recentActivityLedger) ??
      readNestedObject(summary, 'recentActivityLedger');
    const latestPageClosed = readNestedObject(recentActivityLedger, 'latestPageClosed');
    if (!latestPageClosed) return;
    const tabId = readNumber(latestPageClosed.tabId);
    if (tabId === null) return;
    const closedAtMs = readNumber(latestPageClosed.occurredAtMs);
    const closedAt =
      closedAtMs !== null && Number.isFinite(closedAtMs)
        ? new Date(closedAtMs).toISOString()
        : observedAt;
    const urlFields = normalizeUrlPattern(readString(latestPageClosed.url), {
      allowPersonalBrowserStateStorage: false,
    });
    const closedBaseRouteKey =
      urlFields.rootRoute ?? urlFields.currentRoute ?? urlFields.pattern ?? String(tabId);
    const sameBaseRouteStillOpen = readArray(browserWorld.tabs).some((rawTab) => {
      const tab = readObject(rawTab);
      if (!tab || readNumber(tab.closedAtMs) !== null) return false;
      const openUrlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
        allowPersonalBrowserStateStorage: false,
      });
      const openBaseRouteKey =
        openUrlFields.rootRoute ??
        openUrlFields.currentRoute ??
        openUrlFields.pattern ??
        String(readNumber(tab.tabId, tab.id));
      return openBaseRouteKey === closedBaseRouteKey;
    });
    if (sameBaseRouteStillOpen) return;
    const tabWindowId = readNumber(latestPageClosed.windowId) ?? trace.windowId;
    this.upsertBrowserObject({
      siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole: 'browser_tab',
      pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
      objectFingerprint: objectFingerprint('browser_page', closedBaseRouteKey),
      objectType: 'tab',
      browserContextKey,
      tabId,
      windowId: tabWindowId,
      ownerType: normalizeOwnerType(readString(latestPageClosed.openedBy)),
      sourceRoute: readString(payload.source, trace.sourceRoute, 'browser_world_inventory'),
      sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
      lifecycleState: 'closed',
      isActive: false,
      canTabrixOperate: false,
      operabilityReason: 'tab_closed',
      facts: this.sanitizeBrowserObjectValue({
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
        evidence: readString(latestPageClosed.evidence),
      }),
      firstTraceId: trace.traceId,
      lastTraceId: trace.traceId,
      sourceTraceIds: sourceTraceIds(trace),
      currentState: this.sanitizeBrowserObjectValue({
        status: 'closed',
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
      }),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
      closedAt,
      archivedAt: null,
    });
  }

  private recordReadPageObjects(
    trace: MemoryTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const projection = readNestedObject(payload, 'pageProjection');
    const compact = readNestedObject(payload, 'browserPageObjectCompact');
    const compactFacts = readNestedObject(compact, 'facts');
    const compactTabFacts = readNestedObject(compactFacts, 'tab');
    const page = readNestedObject(payload, 'page');
    const summary = readNestedObject(payload, 'summary');
    const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
    const pageRole = readString(projection?.pageRole, summary?.pageRole, trace.pageRole) ?? 'page';
    const pageModelKey =
      readString(projection?.pageModelKey, trace.pageModelKey) ?? `page:${siteFamily}:${pageRole}`;
    const tabId = readNumber(projection?.tabId, payload.tabId, trace.tabId);
    const pageFingerprint = objectFingerprint('page', siteFamily, pageModelKey, tabId);
    const existingPageObject = this.browserObjects?.getByIdentity({
      siteFamily,
      pageModelKey,
      objectFingerprint: pageFingerprint,
    });
    const pageFacts = mergeReadPageFactsWithExistingCollectionFacts(
      {
        readiness: projection?.readiness,
        stability: projection?.stability,
        watchStatus: compact?.watchStatus,
        operationSummary: readNestedObject(compact, 'operationSummary'),
      },
      existingPageObject?.facts,
    );
    const blockedSurface =
      stringHasBlockedPageSignal(urlFields.rootRoute) ||
      stringHasBlockedPageSignal(urlFields.currentRoute) ||
      stringHasBlockedPageSignal(urlFields.pattern) ||
      stringHasBlockedPageSignal(readString(summary?.quality, trace.pageState)) ||
      stringHasBlockedPageSignal(readString(compact?.status)) ||
      valueHasBlockedPageSignal(compactTabFacts);
    const canTabrixOperate =
      blockedSurface === true
        ? false
        : (readBoolean(compactTabFacts?.canTabrixOperate, projection?.canTabrixOperate) ?? true);
    const operabilityReason =
      blockedSurface === true
        ? 'user_verification_required'
        : readString(compactTabFacts?.operabilityReason, projection?.operabilityReason);

    this.upsertBrowserObject({
      siteFamily,
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole,
      pageModelKey,
      objectFingerprint: pageFingerprint,
      objectType: 'page',
      browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
      tabId,
      windowId: readNumber(payload.windowId, trace.windowId),
      ownerType: normalizeOwnerType(readString(projection?.ownerType)),
      sourceRoute: readString(payload.sourceRoute, trace.sourceRoute),
      selectedDataSource: readString(projection?.chosenDataSource, payload.selectedDataSource),
      sourceLineage: sanitizeValue(
        {
          sourceTruthChain: projection?.sourceTruthChain,
          sourceRouteHonesty: payload.sourceRouteHonesty,
        },
        'browser_object',
      ),
      sourceFreshness: readString(projection?.sourceFreshness, payload.freshness, trace.freshness),
      lifecycleState: blockedSurface ? 'restricted' : readString(compact?.status, 'updated'),
      canTabrixOperate,
      operabilityReason,
      facts: sanitizeValue(pageFacts, 'browser_object'),
      changedGroups: sanitizeValue(compact?.changedGroups, 'browser_object'),
      primaryConclusion: readString(compact?.primaryConclusion),
      claimBoundary: null,
      confidenceScore: null,
      firstTraceId: trace.traceId,
      lastTraceId: trace.traceId,
      sourceTraceIds: sourceTraceIds(trace),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
    });

    this.recordReadPageChildObjects({
      trace,
      payload,
      observedAt,
      browserContextKey,
      siteFamily,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageModelKey,
      pageRole,
      tabId,
    });
  }

  private recordCollectedResultCardObjects(
    trace: MemoryTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const page = readNestedObject(payload, 'page');
    const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
    const pageRole =
      normalizePageRoleForMemory(readString(payload.pageRole, trace.pageRole)) ?? 'search_results';
    const pageModelKey = trace.pageModelKey ?? `page:${siteFamily}:${pageRole}`;
    const tabId = readNumber(payload.tabId, trace.tabId);
    const sourceRoute = readString(
      payload.sourceRoute,
      trace.sourceRoute,
      'result_card_collection',
    );
    const selectedDataSource = readString(
      payload.selectedDataSource,
      trace.selectedDataSource,
      payload.kind,
    );
    const cards = readArray(payload.cards);
    const observedResultCount = readNumber(payload.observedResultCount) ?? cards.length;
    const complete = readBoolean(payload.complete);
    const filterState = readObject(payload.filterState);
    const blockedSurface =
      stringHasBlockedPageSignal(urlFields.rootRoute) ||
      stringHasBlockedPageSignal(urlFields.currentRoute) ||
      stringHasBlockedPageSignal(urlFields.pattern) ||
      stringHasBlockedPageSignal(readString(payload.status, payload.pageState, trace.pageState)) ||
      valueHasBlockedPageSignal(payload);
    const canTabrixOperate = blockedSurface ? false : true;

    const pageObject = this.upsertBrowserObject({
      siteFamily,
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole,
      pageModelKey,
      objectFingerprint: objectFingerprint('page', siteFamily, pageModelKey, tabId),
      objectType: 'page',
      browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
      tabId,
      windowId: readNumber(payload.windowId, trace.windowId),
      sourceRoute,
      selectedDataSource,
      sourceFreshness: readString(payload.freshness, trace.freshness),
      lifecycleState: blockedSurface
        ? 'restricted'
        : readString(payload.pageState, trace.pageState, 'observed'),
      canTabrixOperate,
      operabilityReason: blockedSurface ? 'user_verification_required' : null,
      facts: this.sanitizeBrowserObjectValue({
        pageTitle: readString(page?.title),
        observedResultCount,
        requestedMinResults: readNumber(payload.requestedMinResults),
        complete,
        status: readString(payload.status),
        filterState,
        source: 'result_card_collection',
      }),
      primaryConclusion:
        observedResultCount > 0 ? `识别到 ${observedResultCount} 个结果卡片` : '未识别到结果卡片',
      claimBoundary: readString(payload.claimBoundary),
      confidenceScore: observedResultCount > 0 ? 0.8 : 0.3,
      firstTraceId: trace.traceId,
      lastTraceId: trace.traceId,
      sourceTraceIds: sourceTraceIds(trace),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
    });

    for (const [index, rawCard] of cards.slice(0, 80).entries()) {
      const card = readObject(rawCard);
      if (!card) continue;
      const rank = readNumber(card.rank) ?? index + 1;
      const title = readString(card.title);
      if (!title) continue;
      const cardUrlFields = normalizeUrlPattern(readString(card.url), {
        allowPersonalBrowserStateStorage: false,
      });
      const rawActionTarget = readObject(card.actionTarget);
      const hasExecutableResultCardClick =
        readString(rawActionTarget?.toolName) === 'chrome_click_element' &&
        Boolean(readObject(readObject(rawActionTarget?.toolArgs)?.candidateAction));
      const actionTargetUrlFields = normalizeUrlPattern(readString(rawActionTarget?.url), {
        allowPersonalBrowserStateStorage: false,
      });
      const actionTarget = rawActionTarget
        ? {
            actionType: readString(rawActionTarget.actionType),
            targetKind: readString(rawActionTarget.targetKind),
            executionScope: readString(rawActionTarget.executionScope),
            url:
              actionTargetUrlFields.rootRoute ??
              actionTargetUrlFields.currentRoute ??
              actionTargetUrlFields.pattern,
            ...normalizeResultCardOpenAction(rawActionTarget),
            confidence: readFiniteNumber(rawActionTarget.confidence),
            reasons: readArray(rawActionTarget.reasons).filter(
              (item): item is string => typeof item === 'string',
            ),
          }
        : null;
      const sessionOnlyTarget = rawActionTarget
        ? {
            schema: 'tabrix_session_only_result_card_target_v1',
            selector: readString(rawActionTarget.selector),
            text: readString(rawActionTarget.text),
            ...normalizeResultCardActionToolArgs(rawActionTarget),
            rect: readObject(rawActionTarget.rect),
            center: readObject(rawActionTarget.center),
            cardRect: readObject(card.rect),
            coordinateFrame: readString(rawActionTarget.coordinateFrame),
            sourceScrollY: readNumber(rawActionTarget.sourceScrollY, card.sourceScrollY),
          }
        : readObject(card.rect)
          ? {
              schema: 'tabrix_session_only_result_card_target_v1',
              cardRect: readObject(card.rect),
              sourceScrollY: readNumber(card.sourceScrollY),
            }
          : null;
      const actionTypes = [
        hasExecutableResultCardClick ? 'click_result_card' : null,
        readString(card.url) ? 'open_via_url' : null,
      ].filter((item): item is string => Boolean(item));
      const cardKey =
        cardUrlFields.rootRoute ?? cardUrlFields.currentRoute ?? cardUrlFields.pattern ?? title;
      this.upsertBrowserObject({
        siteFamily,
        pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        pageRole,
        pageModelKey,
        objectFingerprint: objectFingerprint('result_card', pageModelKey, cardKey, rank),
        objectType: 'result_card',
        parentObjectId: pageObject?.browserObjectId ?? null,
        browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
        tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
        sourceRoute,
        selectedDataSource,
        sourceFreshness: readString(payload.freshness, trace.freshness),
        lifecycleState: 'observed',
        canTabrixOperate: actionTypes.length > 0,
        actionTypes,
        targetability: this.sanitizeBrowserObjectValue({
          rank,
          url: cardUrlFields.rootRoute ?? cardUrlFields.pattern,
          actionTarget,
          sessionOnlyTarget,
        }),
        facts: this.sanitizeBrowserObjectValue({
          rank,
          title,
          url: cardUrlFields.rootRoute ?? cardUrlFields.pattern,
          primaryText: readString(card.primaryText),
          secondaryText: readString(card.secondaryText),
          metaText: readString(card.metaText),
          interactionText: readString(card.interactionText),
          imageCount: readNumber(card.imageCount),
          actionTarget,
          sessionOnlyTarget,
          reasons: readArray(card.reasons).filter(
            (item): item is string => typeof item === 'string',
          ),
          sourceStrategy: readString(card.sourceStrategy),
        }),
        primaryConclusion: title,
        claimBoundary: readString(payload.claimBoundary),
        confidenceScore: readFiniteNumber(card.confidence),
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
      });
    }
  }

  private recordReadPageDataSourceObject(input: {
    trace: MemoryTrace;
    payload: Record<string, unknown>;
    observedAt: string;
    browserContextKey: string | null;
    siteFamily: string;
    rootRoute: string | null;
    currentRoute: string | null;
    pageModelKey: string;
    pageRole: string;
    tabId: number | null;
  }): void {
    const projection = readNestedObject(input.payload, 'pageProjection');
    const selectedDataSource = readString(
      projection?.chosenDataSource,
      projection?.selectedDataSource,
      input.payload.selectedDataSource,
      input.payload.kind,
    );
    const sourceRoute = readString(input.payload.sourceRoute, input.trace.sourceRoute);
    const endpointFamily = readString(
      input.payload.endpointFamily,
      input.payload.endpointPattern,
      readNestedObject(input.payload, 'source')?.endpointFamily,
    );
    if (!isApiLikeDataSource(selectedDataSource, sourceRoute, endpointFamily)) return;

    const sourceKey = selectedDataSource ?? endpointFamily ?? sourceRoute ?? 'api';
    this.upsertBrowserObject({
      siteFamily: input.siteFamily,
      pageUrlPattern: input.rootRoute,
      rootRoute: input.rootRoute,
      currentRoute: input.currentRoute,
      pageRole: input.pageRole,
      pageModelKey: input.pageModelKey,
      objectFingerprint: objectFingerprint(
        'data_source',
        input.pageModelKey,
        sourceKey,
        input.tabId,
      ),
      objectType: 'data_source',
      browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
      tabId: input.tabId,
      sourceRoute,
      selectedDataSource,
      sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
      lifecycleState: 'observed',
      canTabrixOperate: true,
      facts: this.sanitizeBrowserObjectValue({
        selectedDataSource,
        sourceRoute,
        endpointFamily,
        payloadKind: readString(input.payload.kind),
        sourcePrimaryOrigin: readString(
          readNestedObject(projection, 'sourceTruthChain')?.primaryOrigin,
        ),
      }),
      claimBoundary: null,
      confidenceScore: null,
      firstTraceId: input.trace.traceId,
      lastTraceId: input.trace.traceId,
      sourceTraceIds: sourceTraceIds(input.trace),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: input.observedAt,
    });
  }

  private recordReadPageChildObjects(input: {
    trace: MemoryTrace;
    payload: Record<string, unknown>;
    observedAt: string;
    browserContextKey: string | null;
    siteFamily: string;
    rootRoute: string | null;
    currentRoute: string | null;
    pageModelKey: string;
    pageRole: string;
    tabId: number | null;
  }): void {
    this.recordReadPageDataSourceObject(input);

    for (const [index, rawRegion] of readArray(input.payload.pageRegions).slice(0, 40).entries()) {
      const region = readObject(rawRegion);
      if (!region) continue;
      const regionId = readString(region.regionId, region.id) ?? `region-${index}`;
      this.upsertBrowserObject({
        siteFamily: input.siteFamily,
        pageUrlPattern: input.rootRoute,
        rootRoute: input.rootRoute,
        currentRoute: input.currentRoute,
        pageRole: input.pageRole,
        pageModelKey: input.pageModelKey,
        objectFingerprint: objectFingerprint('region', input.pageModelKey, regionId),
        objectType: 'region',
        browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
        tabId: input.tabId,
        sourceRoute: readString(input.payload.sourceRoute, input.trace.sourceRoute),
        sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
        lifecycleState: readString(region.state, 'observed'),
        canTabrixOperate: readBoolean(region.targetability),
        targetability: sanitizeValue(
          {
            state: readString(region.state),
            readiness: readString(region.readiness),
            nextRequiredTool: readString(region.nextRequiredTool),
            nextRequiredCheck: readString(region.nextRequiredCheck),
          },
          'browser_object',
        ),
        facts: sanitizeValue(
          {
            regionType: readString(region.regionType),
            layoutHint: readString(region.layoutHint),
            candidateActionCount: readArray(region.candidateActionIds).length,
          },
          'browser_object',
        ),
        claimBoundary: null,
        confidenceScore: null,
        firstTraceId: input.trace.traceId,
        lastTraceId: input.trace.traceId,
        sourceTraceIds: sourceTraceIds(input.trace),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: input.observedAt,
      });
    }
    for (const [index, rawAction] of readArray(input.payload.candidateActions)
      .slice(0, 80)
      .entries()) {
      const action = readObject(rawAction);
      if (!action) continue;
      const targetRef = readString(action.targetRef, action.id) ?? `target-${index}`;
      this.upsertBrowserObject({
        siteFamily: input.siteFamily,
        pageUrlPattern: input.rootRoute,
        rootRoute: input.rootRoute,
        currentRoute: input.currentRoute,
        pageRole: input.pageRole,
        pageModelKey: input.pageModelKey,
        objectFingerprint: objectFingerprint('action_target', input.pageModelKey, targetRef),
        objectType: 'action_target',
        browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
        tabId: input.tabId,
        sourceRoute: readString(input.payload.sourceRoute, input.trace.sourceRoute),
        sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
        lifecycleState: 'observed',
        canTabrixOperate: readBoolean(action.actionability),
        operabilityReason: readString(action.actionabilityReason),
        targetability: sanitizeValue(
          {
            targetRef,
            frameId: readString(action.frameId),
            nextRequiredTool: readString(action.nextRequiredTool),
            nextRequiredCheck: readString(action.nextRequiredCheck),
          },
          'browser_object',
        ),
        actionTypes: sanitizeValue(
          [readString(action.actionType)].filter((item): item is string => Boolean(item)),
          'browser_object',
        ),
        facts: sanitizeValue(
          {
            intentBoundary: readString(action.intentBoundary),
            matchReason: readString(action.matchReason),
          },
          'browser_object',
        ),
        claimBoundary: null,
        confidenceScore: null,
        firstTraceId: input.trace.traceId,
        lastTraceId: input.trace.traceId,
        sourceTraceIds: sourceTraceIds(input.trace),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: input.observedAt,
      });
    }
  }

  public recordAiBusinessFeedback(
    input: RecordMkeAiBusinessFeedbackInput,
  ): MemoryTrace | undefined {
    const trace = this.repo.get(input.traceId);
    if (!trace) return undefined;
    const traceBindingHash = ensureFeedbackBinding(input, trace);
    const confidence = normalizeConfidence(input.confidence);
    const evaluationScope = normalizeAiFeedbackScope(input.evaluationScope);
    const experienceReady =
      input.businessStatus === 'achieved' &&
      typeof confidence === 'number' &&
      confidence >= 0.9 &&
      typeof input.summary === 'string' &&
      input.summary.trim().length >= 8;
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    validateAiFeedbackQuality({
      businessStatus: input.businessStatus,
      confidence,
      summary: input.summary,
    });

    const feedback = sanitizeValue(
      {
        sourceKind: 'ai_feedback',
        evaluationScope,
        businessStatus: input.businessStatus,
        confidence,
        reasonCode: input.reasonCode ?? null,
        summary: input.summary ?? null,
        binding: {
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          toolCallId: trace.toolCallId,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash,
        },
        receivedAt,
        sourceToolName: input.sourceToolName ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
      },
      'tabrix_ai_business_feedback',
    ) as Record<string, unknown>;

    const acceptedFeedbackTokens = new Set([
      traceBindingHash,
      input.traceBindingHash,
      buildLegacyMemoryTraceBindingHash(trace),
      buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: 'unknown' }),
      buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: null }),
    ]);
    const duplicateFeedback = this.repo.listFeedbackEventsByTrace(trace.traceId).find((event) => {
      return (
        event.accepted === true &&
        acceptedFeedbackTokens.has(event.traceBindingHash) &&
        event.evaluationScope === evaluationScope &&
        event.businessStatus === input.businessStatus &&
        event.confidence === confidence &&
        event.reasonCode === (input.reasonCode ?? null) &&
        event.summary === (input.summary ?? null)
      );
    });
    if (duplicateFeedback) {
      return this.repo.updateAiFeedback({
        traceId: input.traceId,
        aiFeedbackScore: confidence,
        aiFeedback: feedback,
        businessSuccess: input.businessStatus,
      });
    }

    const result = this.repo.recordAiFeedback({
      traceId: input.traceId,
      aiFeedbackScore: confidence,
      aiFeedback: feedback,
      businessSuccess: input.businessStatus,
      feedbackEvent: {
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash,
        evaluationScope,
        evaluationVersion: DEFAULT_AI_FEEDBACK_EVALUATION_VERSION,
        rubricVersion: DEFAULT_AI_FEEDBACK_RUBRIC_VERSION,
        evaluatorModel: null,
        businessStatus: input.businessStatus,
        confidence,
        reasonCode: input.reasonCode ?? null,
        summary: input.summary ?? null,
        userGoalSnapshot: null,
        experienceCandidate: experienceReady,
        sourceToolName: input.sourceToolName ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
        accepted: true,
        payload: feedback,
        createdAt: receivedAt,
      },
    });
    return result.trace;
  }

  public get(traceId: string): MemoryTrace | undefined {
    return this.repo.get(traceId);
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
