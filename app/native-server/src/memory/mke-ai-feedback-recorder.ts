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
  evaluationVersion?: string | null;
  rubricVersion?: string | null;
  evaluatorModel?: string | null;
  userGoalSnapshot?: string | null;
  experienceCandidate?: boolean | null;
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
const UNTRUSTED_AI_FEEDBACK_EVALUATOR_NAMES = new Set([
  '',
  'unknown',
  'default',
  'system',
  'tabrix',
]);

function normalizeConfidence(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

function normalizeAiFeedbackScope(value: string | null | undefined): 'step' | 'task' {
  return value === 'task' ? 'task' : 'step';
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function isTrustedAiFeedbackEvaluator(value: string | null | undefined): boolean {
  const normalized = normalizeOptionalText(value)?.toLowerCase() ?? '';
  return normalized.length > 0 && !UNTRUSTED_AI_FEEDBACK_EVALUATOR_NAMES.has(normalized);
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
  const evaluationVersion =
    normalizeOptionalText(input.feedback.evaluationVersion) ??
    DEFAULT_AI_FEEDBACK_EVALUATION_VERSION;
  const rubricVersion =
    normalizeOptionalText(input.feedback.rubricVersion) ?? DEFAULT_AI_FEEDBACK_RUBRIC_VERSION;
  const evaluatorModel = normalizeOptionalText(input.feedback.evaluatorModel);
  const userGoalSnapshot = normalizeOptionalText(input.feedback.userGoalSnapshot);
  const experienceReady =
    input.feedback.businessStatus === 'achieved' &&
    isTrustedAiFeedbackEvaluator(evaluatorModel) &&
    typeof confidence === 'number' &&
    confidence >= 0.9 &&
    typeof input.feedback.summary === 'string' &&
    input.feedback.summary.trim().length >= 8 &&
    input.feedback.experienceCandidate !== false;
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
      evaluationVersion,
      rubricVersion,
      ...(evaluatorModel ? { evaluatorModel } : {}),
      ...(userGoalSnapshot ? { userGoalSnapshot } : {}),
      experienceCandidate: experienceReady,
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
      event.evaluationVersion === evaluationVersion &&
      event.rubricVersion === rubricVersion &&
      event.evaluatorModel === evaluatorModel &&
      event.businessStatus === input.feedback.businessStatus &&
      event.confidence === confidence &&
      event.reasonCode === (input.feedback.reasonCode ?? null) &&
      event.summary === (input.feedback.summary ?? null) &&
      event.userGoalSnapshot === userGoalSnapshot &&
      event.experienceCandidate === experienceReady
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
      evaluationVersion,
      rubricVersion,
      evaluatorModel,
      businessStatus: input.feedback.businessStatus,
      confidence,
      reasonCode: input.feedback.reasonCode ?? null,
      summary: input.feedback.summary ?? null,
      userGoalSnapshot,
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
