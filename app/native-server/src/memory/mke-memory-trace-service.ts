import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { BrowserObjectRepository, MemoryTraceRepository, type MemoryTrace } from './db';
import { BoundedAsyncBrowserObjectWriteQueue } from './mke-browser-object-write-queue';
import {
  recordBrowserObjectsFromToolResult,
  recordBrowserWorldSnapshotObjects,
} from './mke-browser-object-trace-projector';
import {
  recordAiBusinessFeedback as recordAiBusinessFeedbackWithRepo,
  type RecordMkeAiBusinessFeedbackInput,
} from './mke-ai-feedback-recorder';
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

export {
  MkeAiFeedbackValidationError,
  type RecordMkeAiBusinessFeedbackInput,
} from './mke-ai-feedback-recorder';

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
    return recordAiBusinessFeedbackWithRepo({ repo: this.repo, feedback: input });
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
