import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExecutionStep, Task } from '../execution/types';
import type { SessionManager } from '../execution/session-manager';
import type { MemoryTrace } from '../memory/db';
import { logger } from '../logging/logger';
import {
  attachTabrixMemoryTraceEnvelope,
  type TabrixToolMetadata,
  type TabrixPreviousFeedbackResult,
} from './tabrix-metadata-envelope';

const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

export interface RecordMkeMemoryTraceInput {
  requestParams?: unknown;
  resultSummary?: string | null;
  errorCode?: string | null;
  browserContextKey?: string | null;
}

interface ApplyPreviousBusinessFeedbackInput {
  metadata: TabrixToolMetadata;
  sessionManager: SessionManager;
  sourceToolName: string;
  sourceToolCallId: string;
  receivedAtMs: number;
}

export type PreviousBusinessFeedbackResult = TabrixPreviousFeedbackResult;

export function applyPreviousBusinessFeedback(
  input: ApplyPreviousBusinessFeedbackInput,
): PreviousBusinessFeedbackResult[] {
  const { metadata, sessionManager, sourceToolName, sourceToolCallId, receivedAtMs } = input;
  if (metadata.previousFeedback.length === 0) return [];
  const traceWriter = sessionManager.memoryTraces;
  if (!traceWriter) return [];

  let feedbackRecorded = false;
  const results: PreviousBusinessFeedbackResult[] = [];
  for (const feedback of metadata.previousFeedback) {
    try {
      traceWriter.recordAiBusinessFeedback({
        traceId: feedback.traceId,
        taskId: feedback.taskId,
        toolName: feedback.toolName,
        toolCallId: feedback.toolCallId,
        sequenceIndex: feedback.sequenceIndex,
        traceBindingHash: feedback.feedbackToken,
        evaluationScope: feedback.evaluationScope,
        businessStatus: feedback.businessStatus,
        confidence: feedback.confidence,
        reasonCode: feedback.reasonCode,
        summary: feedback.summary,
        evaluationVersion: feedback.evaluationVersion,
        rubricVersion: feedback.rubricVersion,
        evaluatorModel: feedback.evaluatorModel,
        userGoalSnapshot: feedback.userGoalSnapshot,
        experienceCandidate: feedback.experienceCandidate,
        receivedAt: new Date(receivedAtMs).toISOString(),
        sourceToolName,
        sourceToolCallId,
      });
      feedbackRecorded = true;
      results.push({ traceId: feedback.traceId, accepted: true });
    } catch (feedbackError) {
      const message =
        feedbackError instanceof Error ? feedbackError.message : String(feedbackError);
      const rejectionCode =
        typeof (feedbackError as { code?: unknown }).code === 'string'
          ? (feedbackError as { code: string }).code
          : 'feedback_update_failed';
      traceWriter.recordRejectedAiBusinessFeedback({
        traceId: feedback.traceId,
        taskId: feedback.taskId,
        toolName: feedback.toolName,
        toolCallId: feedback.toolCallId,
        sequenceIndex: feedback.sequenceIndex,
        traceBindingHash: feedback.feedbackToken,
        evaluationScope: feedback.evaluationScope,
        businessStatus: feedback.businessStatus,
        confidence: feedback.confidence,
        reasonCode: feedback.reasonCode,
        summary: feedback.summary,
        evaluationVersion: feedback.evaluationVersion,
        rubricVersion: feedback.rubricVersion,
        evaluatorModel: feedback.evaluatorModel,
        userGoalSnapshot: feedback.userGoalSnapshot,
        experienceCandidate: feedback.experienceCandidate,
        receivedAt: new Date(receivedAtMs).toISOString(),
        sourceToolName,
        sourceToolCallId,
        rejectionCode,
        rejectionMessage: message,
      });
      results.push({
        traceId: feedback.traceId,
        accepted: false,
        rejectionCode,
        rejectionMessage: message,
      });
      mkeMemoryTraceLogger.warn('ai feedback update failed', { errorMessage: message });
    }
  }
  if (feedbackRecorded) sessionManager.scheduleMkeProjectionAfterAiFeedback();
  return results;
}

interface CreateMkeMemoryTraceRecorderInput {
  sessionManager: SessionManager;
  task: Task;
  taskIntent: string;
  aiClient: string;
  toolName: string;
  step: ExecutionStep;
  requestStartedAtMs: number;
  defaultRequestParams: unknown;
  metadata: TabrixToolMetadata;
  getPreviousFeedbackResults?: () => PreviousBusinessFeedbackResult[];
}

export function createMkeMemoryTraceRecorder(input: CreateMkeMemoryTraceRecorderInput): {
  record(result: CallToolResult, traceInput?: RecordMkeMemoryTraceInput): MemoryTrace | null;
  recordAndAttach(result: CallToolResult, traceInput?: RecordMkeMemoryTraceInput): CallToolResult;
} {
  const {
    sessionManager,
    task,
    taskIntent,
    aiClient,
    toolName,
    step,
    requestStartedAtMs,
    defaultRequestParams,
    metadata,
    getPreviousFeedbackResults,
  } = input;

  const record = (
    result: CallToolResult,
    traceInput?: RecordMkeMemoryTraceInput,
  ): MemoryTrace | null => {
    const traceWriter = sessionManager.memoryTraces;
    if (!traceWriter) return null;
    try {
      return traceWriter.recordToolCall({
        taskId: task.taskId,
        taskIntent,
        aiClient,
        toolName,
        stepId: step.stepId,
        sequenceIndex: step.index,
        requestParams: traceInput?.requestParams ?? defaultRequestParams,
        requestAtMs: requestStartedAtMs,
        responseAtMs: Date.now(),
        result,
        resultSummary: traceInput?.resultSummary ?? null,
        errorCode: traceInput?.errorCode ?? null,
        browserContextKey: traceInput?.browserContextKey ?? null,
      });
    } catch (traceError) {
      const message = traceError instanceof Error ? traceError.message : String(traceError);
      mkeMemoryTraceLogger.warn('write failed', { errorMessage: message });
    }
    return null;
  };

  const recordAndAttach = (
    result: CallToolResult,
    traceInput?: RecordMkeMemoryTraceInput,
  ): CallToolResult => {
    const trace = record(result, traceInput);
    if (trace) sessionManager.scheduleMkeProjectionAfterTrace();
    return attachTabrixMemoryTraceEnvelope(
      result,
      trace,
      metadata,
      toolName,
      getPreviousFeedbackResults?.() ?? [],
    );
  };

  return { record, recordAndAttach };
}
