import { createHash } from 'node:crypto';
import type { MemoryTrace } from './db';

type FeedbackBindingTrace = Pick<
  MemoryTrace,
  | 'traceId'
  | 'taskId'
  | 'toolName'
  | 'toolCallId'
  | 'sequenceIndex'
  | 'requestAt'
  | 'responseAt'
  | 'toolSuccess'
  | 'resultSummary'
  | 'errorCode'
>;

type LegacyFeedbackBindingTrace = FeedbackBindingTrace & Pick<MemoryTrace, 'businessSuccess'>;

export function buildMemoryTraceBindingHash(trace: FeedbackBindingTrace): string {
  const payload = JSON.stringify({
    traceId: trace.traceId,
    taskId: trace.taskId,
    toolName: trace.toolName,
    toolCallId: trace.toolCallId ?? null,
    sequenceIndex: trace.sequenceIndex ?? null,
    requestAt: trace.requestAt,
    responseAt: trace.responseAt,
    toolSuccess: trace.toolSuccess ?? null,
    resultSummary: trace.resultSummary ?? null,
    errorCode: trace.errorCode ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function buildLegacyMemoryTraceBindingHash(trace: LegacyFeedbackBindingTrace): string {
  const payload = JSON.stringify({
    traceId: trace.traceId,
    taskId: trace.taskId,
    toolName: trace.toolName,
    toolCallId: trace.toolCallId ?? null,
    sequenceIndex: trace.sequenceIndex ?? null,
    requestAt: trace.requestAt,
    responseAt: trace.responseAt,
    toolSuccess: trace.toolSuccess ?? null,
    businessSuccess: trace.businessSuccess ?? null,
    resultSummary: trace.resultSummary ?? null,
    errorCode: trace.errorCode ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}
