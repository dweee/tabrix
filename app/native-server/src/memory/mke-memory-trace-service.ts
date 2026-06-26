import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  type BusinessSuccessVerdict,
  type MemoryTrace,
} from './db';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';
import { BoundedAsyncBrowserObjectWriteQueue } from './mke-browser-object-write-queue';
import {
  recordBrowserObjectsFromToolResult,
  recordBrowserWorldSnapshotObjects,
} from './mke-browser-object-trace-projector';
import {
  parseFirstTextPayload,
  sanitizeResultSummaryForMemory,
  sanitizeValue,
} from './mke-memory-sanitizer';
import { digestResult, type ParsedResultDigest } from './mke-memory-tool-result-digest';
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
        recordBrowserObjectsFromToolResult({
          browserObjects: this.browserObjects,
          trace,
          payload,
          toolName: input.toolName,
          observedAt: new Date(responseAtMs).toISOString(),
          browserContextKey: input.browserContextKey ?? null,
          logger: mkeMemoryTraceLogger,
        }),
    });
    return trace;
  }

  public recordBrowserWorldSnapshot(input: RecordBrowserWorldSnapshotInput): void {
    recordBrowserWorldSnapshotObjects({
      browserObjects: this.browserObjects,
      browserWorld: input.browserWorld,
      observedAtMs: input.observedAtMs,
      browserContextKey: input.browserContextKey,
      logger: mkeMemoryTraceLogger,
    });
  }

  public flushAsyncWrites(): Promise<void> {
    return this.asyncBrowserObjectWrites.flush();
  }

  public discardPendingAsyncWrites(): void {
    this.asyncBrowserObjectWrites.discardPending();
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
