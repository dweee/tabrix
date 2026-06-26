import type { BusinessSuccessVerdict, MemoryTrace, MemoryTraceRepository } from './db';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';
import { sanitizeValue } from './mke-memory-sanitizer';

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

const DEFAULT_AI_FEEDBACK_EVALUATION_VERSION = 'ai_feedback_v1';
const DEFAULT_AI_FEEDBACK_RUBRIC_VERSION = 'tabrix_ai_business_feedback_v1';

function normalizeConfidence(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

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

export function recordAiBusinessFeedback(input: {
  repo: MemoryTraceRepository;
  feedback: RecordMkeAiBusinessFeedbackInput;
}): MemoryTrace | undefined {
  const trace = input.repo.get(input.feedback.traceId);
  if (!trace) return undefined;
  const traceBindingHash = ensureFeedbackBinding(input.feedback, trace);
  const confidence = normalizeConfidence(input.feedback.confidence);
  const evaluationScope = normalizeAiFeedbackScope(input.feedback.evaluationScope);
  const experienceReady =
    input.feedback.businessStatus === 'achieved' &&
    typeof confidence === 'number' &&
    confidence >= 0.9 &&
    typeof input.feedback.summary === 'string' &&
    input.feedback.summary.trim().length >= 8;
  const receivedAt = input.feedback.receivedAt ?? new Date().toISOString();
  validateAiFeedbackQuality({
    businessStatus: input.feedback.businessStatus,
    confidence,
    summary: input.feedback.summary,
  });

  const feedback = sanitizeValue(
    {
      sourceKind: 'ai_feedback',
      evaluationScope,
      businessStatus: input.feedback.businessStatus,
      confidence,
      reasonCode: input.feedback.reasonCode ?? null,
      summary: input.feedback.summary ?? null,
      binding: {
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash,
      },
      receivedAt,
      sourceToolName: input.feedback.sourceToolName ?? null,
      sourceToolCallId: input.feedback.sourceToolCallId ?? null,
    },
    'tabrix_ai_business_feedback',
  ) as Record<string, unknown>;

  const acceptedFeedbackTokens = new Set([
    traceBindingHash,
    input.feedback.traceBindingHash,
    buildLegacyMemoryTraceBindingHash(trace),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: 'unknown' }),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: null }),
  ]);
  const duplicateFeedback = input.repo.listFeedbackEventsByTrace(trace.traceId).find((event) => {
    return (
      event.accepted === true &&
      acceptedFeedbackTokens.has(event.traceBindingHash) &&
      event.evaluationScope === evaluationScope &&
      event.businessStatus === input.feedback.businessStatus &&
      event.confidence === confidence &&
      event.reasonCode === (input.feedback.reasonCode ?? null) &&
      event.summary === (input.feedback.summary ?? null)
    );
  });
  if (duplicateFeedback) {
    return input.repo.updateAiFeedback({
      traceId: input.feedback.traceId,
      aiFeedbackScore: confidence,
      aiFeedback: feedback,
      businessSuccess: input.feedback.businessStatus,
    });
  }

  const result = input.repo.recordAiFeedback({
    traceId: input.feedback.traceId,
    aiFeedbackScore: confidence,
    aiFeedback: feedback,
    businessSuccess: input.feedback.businessStatus,
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
      businessStatus: input.feedback.businessStatus,
      confidence,
      reasonCode: input.feedback.reasonCode ?? null,
      summary: input.feedback.summary ?? null,
      userGoalSnapshot: null,
      experienceCandidate: experienceReady,
      sourceToolName: input.feedback.sourceToolName ?? null,
      sourceToolCallId: input.feedback.sourceToolCallId ?? null,
      accepted: true,
      payload: feedback,
      createdAt: receivedAt,
    },
  });
  return result.trace;
}
