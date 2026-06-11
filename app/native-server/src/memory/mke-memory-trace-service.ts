import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  type BrowserObjectInput,
  type BusinessSuccessVerdict,
  type MemoryTrace,
} from './db';
import { logger } from '../logging/logger';

const REDACTED = '[redacted]';
const MAX_STRING_LENGTH = 512;
const MAX_ROUTE_LENGTH = 2048;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 5;
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

export interface RecordMkeAiBusinessFeedbackInput {
  traceId: string;
  businessStatus: BusinessSuccessVerdict;
  confidence?: number | null;
  reasonCode?: string | null;
  summary?: string | null;
  receivedAt?: string;
  sourceToolName?: string | null;
  sourceToolCallId?: string | null;
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
  pageState: string | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  freshness: string | null;
  fallbackUsed: string | null;
}

export interface MkeMemoryTraceServiceOptions {
  allowPersonalBrowserStateStorage?: () => boolean;
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

function preservePersonalObjectValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max_depth]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return truncateString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => preservePersonalObjectValue(item, depth + 1));
  }
  if (typeof value !== 'object') return String(value);

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (shouldDropRawContentKey(key)) {
      output[key] = '[omitted_raw_content]';
      continue;
    }
    output[key] = preservePersonalObjectValue(entry, depth + 1);
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
    sanitized.append(key, shouldRedactQueryParam(key) ? REDACTED : value);
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

function objectFingerprint(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined || part === '' ? 'unknown' : String(part)))
    .join(':');
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

function buildAutomaticEvidenceFeedback(input: {
  toolName: string;
  toolSuccess: boolean;
  businessSuccess: BusinessSuccessVerdict;
  resultSummary?: string | null;
  errorCode?: string | null;
}): { score: number; feedback: Record<string, unknown> } {
  let score = 0.45;
  let businessStatus: 'achieved' | 'partial' | 'not_achieved' | 'unknown' = 'unknown';
  let reasonCode = 'tool_completed_business_unknown';
  let summary = '工具调用已记录，但当前结果没有足够业务成功证据，需后续读取或AI评价确认。';

  if (!input.toolSuccess) {
    score = 0;
    businessStatus = 'not_achieved';
    reasonCode = input.errorCode ? 'tool_error' : 'tool_failed';
    summary = '工具调用失败，不能沉淀为成功经验。';
  } else if (
    input.businessSuccess === 'achieved' ||
    input.businessSuccess === 'proven' ||
    input.businessSuccess === 'true'
  ) {
    score = 0.9;
    businessStatus = 'achieved';
    reasonCode = 'tabrix_business_success_evidence';
    summary = 'Tabrix结果中已有业务成功证据，可作为经验候选。';
  } else if (input.businessSuccess === 'partial') {
    score = 0.6;
    businessStatus = 'partial';
    reasonCode = 'tabrix_partial_business_evidence';
    summary = 'Tabrix结果只证明部分进展，需要后续确认后才可沉淀为经验。';
  } else if (input.businessSuccess === 'not_achieved' || input.businessSuccess === 'false') {
    score = 0.15;
    businessStatus = 'not_achieved';
    reasonCode = 'tabrix_business_not_achieved';
    summary = 'Tabrix结果显示业务目标未达成，不能沉淀为成功经验。';
  }

  return {
    score,
    feedback: sanitizeValue(
      {
        sourceKind: 'tabrix_auto_evidence',
        businessStatus,
        confidence: score,
        reasonCode,
        summary,
        resultSummary: input.resultSummary ?? null,
        receivedAt: new Date().toISOString(),
        sourceToolName: input.toolName,
        sourceToolCallId: null,
      },
      'tabrix_auto_evidence_feedback',
    ) as Record<string, unknown>,
  };
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

  private allowsPersonalBrowserStateStorage(): boolean {
    try {
      return this.options.allowPersonalBrowserStateStorage?.() === true;
    } catch {
      return false;
    }
  }

  private sanitizeBrowserObjectValue(value: unknown): unknown {
    return this.allowsPersonalBrowserStateStorage()
      ? preservePersonalObjectValue(value)
      : sanitizeValue(value, 'browser_object');
  }

  private browserObjectRedactionState(): string {
    return this.allowsPersonalBrowserStateStorage() ? 'user_authorized' : 'redacted';
  }

  public recordToolCall(input: RecordMkeToolCallTraceInput): MemoryTrace {
    const requestObject = readObject(input.requestParams);
    const responseAtMs = input.responseAtMs ?? Date.now();
    const payload = parseFirstTextPayload(input.result);
    const digest = digestResult(input.result, input.toolName, payload);
    const tabId = digest.tabId ?? readRequestNumber(requestObject, 'tabId');
    const windowId = digest.windowId ?? readRequestNumber(requestObject, 'windowId');
    const toolSuccess = input.result.isError !== true;
    const automaticFeedback = buildAutomaticEvidenceFeedback({
      toolName: input.toolName,
      toolSuccess,
      businessSuccess: digest.businessSuccess,
      resultSummary: input.resultSummary ?? null,
      errorCode: input.errorCode ?? null,
    });

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
      systemEvidenceScore: automaticFeedback.score,
      systemEvidence: automaticFeedback.feedback,
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

  private upsertBrowserObject(input: BrowserObjectInput): void {
    this.browserObjects?.upsert(input);
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
    for (const rawTab of readArray(browserWorld.tabs)) {
      const tab = readObject(rawTab);
      if (!tab) continue;
      const tabId = readNumber(tab.tabId, tab.id);
      if (tabId === null) continue;
      const urlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
        allowPersonalBrowserStateStorage: this.allowsPersonalBrowserStateStorage(),
      });
      const tabWindowId = readNumber(tab.windowId) ?? trace.windowId;
      this.upsertBrowserObject({
        siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
        pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        pageRole: 'browser_tab',
        pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
        objectFingerprint: objectFingerprint('tab', tabWindowId, tabId),
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
      allowPersonalBrowserStateStorage: this.allowsPersonalBrowserStateStorage(),
    });
    const tabWindowId = readNumber(latestPageClosed.windowId) ?? trace.windowId;
    this.upsertBrowserObject({
      siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole: 'browser_tab',
      pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
      objectFingerprint: objectFingerprint('tab', tabWindowId, tabId),
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
    const page = readNestedObject(payload, 'page');
    const summary = readNestedObject(payload, 'summary');
    const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
      allowPersonalBrowserStateStorage: this.allowsPersonalBrowserStateStorage(),
    });
    const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
    const pageRole = readString(projection?.pageRole, summary?.pageRole, trace.pageRole) ?? 'page';
    const pageModelKey =
      readString(projection?.pageModelKey, trace.pageModelKey) ?? `page:${siteFamily}:${pageRole}`;
    const tabId = readNumber(projection?.tabId, payload.tabId, trace.tabId);

    this.upsertBrowserObject({
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
      lifecycleState: readString(compact?.status, 'updated'),
      canTabrixOperate: true,
      facts: sanitizeValue(
        {
          readiness: projection?.readiness,
          stability: projection?.stability,
          watchStatus: compact?.watchStatus,
          operationSummary: readNestedObject(compact, 'operationSummary'),
          evidenceSummary: readNestedObject(compact, 'evidenceSummary'),
        },
        'browser_object',
      ),
      changedGroups: sanitizeValue(compact?.changedGroups, 'browser_object'),
      primaryConclusion: readString(compact?.primaryConclusion),
      claimBoundary: readString(compact?.claimBoundary, payload.apiCdpProofBoundary),
      confidenceScore: readFiniteNumber(projection?.sourceConfidence),
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
      claimBoundary: readString(input.payload.apiCdpProofBoundary),
      confidenceScore: readFiniteNumber(projection?.sourceConfidence),
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
        claimBoundary: readString(region.claimBoundary),
        confidenceScore: readFiniteNumber(region.confidence),
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
        claimBoundary: readString(action.intentBoundary, action.claimBoundary),
        confidenceScore: readFiniteNumber(action.confidence),
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
    const feedback = sanitizeValue(
      {
        sourceKind: 'ai_feedback',
        businessStatus: input.businessStatus,
        confidence: normalizeConfidence(input.confidence),
        reasonCode: input.reasonCode ?? null,
        summary: input.summary ?? null,
        receivedAt: input.receivedAt ?? new Date().toISOString(),
        sourceToolName: input.sourceToolName ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
      },
      'tabrix_ai_business_feedback',
    );

    return this.repo.updateAiFeedback({
      traceId: input.traceId,
      aiFeedbackScore: normalizeConfidence(input.confidence),
      aiFeedback: feedback,
    });
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
