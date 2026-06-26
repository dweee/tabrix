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
import { BoundedAsyncBrowserObjectWriteQueue } from './mke-browser-object-write-queue';
import { recordBrowserWorldObjects } from './mke-memory-browser-world-object-projection';
import {
  normalizeUrlPattern,
  parseFirstTextPayload,
  sanitizeResultSummaryForMemory,
  sanitizeValue,
} from './mke-memory-sanitizer';
import { recordCollectedResultCardBrowserObjects } from './mke-memory-result-card-object-projection';
import { digestResult, type ParsedResultDigest } from './mke-memory-tool-result-digest';
import {
  normalizeOwnerType,
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import { buildReadPageDataSourceObjectInput } from './mke-memory-read-page-data-source-projection';
import { recordReadPageRegionAndActionObjects } from './mke-memory-read-page-child-projection';
import {
  buildPageObjectEvidenceRefs,
  buildPageObjectRecentEvents,
  mergeReadPageFactsWithExistingCollectionFacts,
  summarizeReadPageSnapshot,
  summarizeReadPageUnifiedDelta,
} from './mke-memory-read-page-object-projection';
import {
  stringHasBlockedPageSignal,
  valueHasBlockedPageSignal,
} from './mke-memory-page-state-signals';
import {
  readActionabilityBoolean,
  readArray,
  readBoolean,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';
import { logger } from '../logging/logger';

const DEFAULT_ASYNC_BROWSER_OBJECT_WRITE_QUEUE_LIMIT = 128;
const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

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

export interface MkeMemoryTraceServiceOptions {
  asyncBrowserObjectWriteQueueLimit?: number;
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

function readRequestNumber(request: Record<string, unknown> | null, key: string): number | null {
  return readNumber(request?.[key]);
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
      perceptionObjects: digest.perceptionObjects,
      actionTarget: digest.actionTarget,
      preObservation: digest.preObservation,
      postObservation: digest.postObservation,
      postActionDelta: digest.postActionDelta,
      sourceRoute: digest.sourceRoute,
      selectedDataSource: digest.selectedDataSource,
      freshness: digest.freshness,
      fallbackUsed: digest.fallbackUsed,
      nextRequiredCheck: digest.nextRequiredCheck,
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
        recordBrowserWorldObjects({
          trace: projectionTrace,
          payload,
          observedAt,
          browserContextKey: projectionTrace.browserContextKey ?? null,
          redactionState: this.browserObjectRedactionState(),
          upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
        });
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
          recordBrowserWorldObjects({
            trace: input.trace,
            payload,
            observedAt: input.observedAt,
            browserContextKey: input.browserContextKey,
            redactionState: this.browserObjectRedactionState(),
            upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
          });
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
          recordCollectedResultCardBrowserObjects({
            trace: input.trace,
            payload,
            observedAt: input.observedAt,
            browserContextKey: input.browserContextKey,
            redactionState: this.browserObjectRedactionState(),
            upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
          });
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
    const pageObjectSnapshot = summarizeReadPageSnapshot(
      readNestedObject(payload, 'pageObjectSnapshot'),
    );
    const pageDeltaReport = summarizeReadPageUnifiedDelta(payload);
    const evidenceRefs = buildPageObjectEvidenceRefs({
      snapshotSummary: pageObjectSnapshot,
      deltaSummary: pageDeltaReport,
    });
    const recentEvents = buildPageObjectRecentEvents({
      snapshotSummary: pageObjectSnapshot,
      deltaSummary: pageDeltaReport,
      observedAt,
    });
    const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
    const pageRole = readString(projection?.pageRole, summary?.pageRole, trace.pageRole) ?? 'page';
    const pageModelKey =
      readString(projection?.pageModelKey, trace.pageModelKey) ?? `page:${siteFamily}:${pageRole}`;
    const tabId = readNumber(projection?.tabId, payload.tabId, trace.tabId);
    const pageIdentityRoute = pageObjectIdentityRoute(
      urlFields.rootRoute,
      trace.pageUrlPattern,
      urlFields.pattern,
    );
    const pageFingerprint = objectFingerprint('page', siteFamily, pageModelKey, pageIdentityRoute);
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
        pageObjectSnapshotSummary: pageObjectSnapshot,
        pageDeltaSummary: pageDeltaReport,
        pageTitle: readString(page?.title),
        host: siteFamily,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lastObservedTabId: tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
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

    const pageObject = this.upsertBrowserObject({
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
      evidenceRefs: sanitizeValue(evidenceRefs, 'browser_object'),
      recentEvents: sanitizeValue(recentEvents, 'browser_object'),
      facts: sanitizeValue(pageFacts, 'browser_object'),
      changedGroups: sanitizeValue(compact?.changedGroups, 'browser_object'),
      currentState: this.sanitizeBrowserObjectValue({
        tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
        titleSummary: readString(page?.title),
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lifecycleState: blockedSurface ? 'restricted' : readString(compact?.status, 'updated'),
        canTabrixOperate,
      }),
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
      parentObjectId: pageObject?.browserObjectId ?? null,
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
    const objectInput = buildReadPageDataSourceObjectInput({
      ...input,
      redactionState: this.browserObjectRedactionState(),
    });
    if (objectInput) this.upsertBrowserObject(objectInput);
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
    parentObjectId?: string | null;
  }): void {
    this.recordReadPageDataSourceObject(input);
    recordReadPageRegionAndActionObjects({
      ...input,
      redactionState: this.browserObjectRedactionState(),
      upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
    });
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
