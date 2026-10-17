import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { MkeAiFeedbackValidationError } from '../memory/mke-memory-trace-service';
import { isTrustedAiFeedbackEvaluator } from '../memory/mke-ai-feedback-recorder';
import type { NativeToolHandler } from './native-tool-handlers';

const MEMORY_FEEDBACK_STATUSES = new Set(['achieved', 'partial', 'not_achieved', 'unknown']);

function jsonResult(payload: unknown, isError: boolean): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload),
      },
    ],
    isError,
  };
}

function readObjectArg(args: unknown): Record<string, unknown> {
  return args && typeof args === 'object' && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

function readStringArg(args: Record<string, unknown>, field: string): string | null {
  const value = args[field];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readConfidenceArg(args: Record<string, unknown>): number | null {
  const value = args.confidence;
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null;
}

function readIntegerArg(args: Record<string, unknown>, field: string): number | null {
  const value = args[field];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : null;
}

function readBooleanArg(args: Record<string, unknown>, field: string): boolean | null {
  const value = args[field];
  return typeof value === 'boolean' ? value : null;
}

function shouldProjectExperienceAfterAiFeedback(input: {
  businessStatus: string;
  confidence: number | null;
  summary?: string | null;
  evaluatorModel?: string | null;
  experienceCandidate?: boolean | null;
}): boolean {
  return (
    input.businessStatus === 'achieved' &&
    isTrustedAiFeedbackEvaluator(input.evaluatorModel) &&
    typeof input.confidence === 'number' &&
    input.confidence >= 0.9 &&
    typeof input.summary === 'string' &&
    input.summary.trim().length >= 8 &&
    input.experienceCandidate !== false
  );
}

function shouldInvalidateExperienceAfterAiFeedback(input: {
  businessStatus: string;
  experienceCandidate?: boolean | null;
}): boolean {
  return (
    input.experienceCandidate === false ||
    input.businessStatus === 'partial' ||
    input.businessStatus === 'not_achieved'
  );
}

export const handleMemoryRecordAiFeedback: NativeToolHandler = async (args, deps) => {
  const persistenceMode = deps.sessionManager.getPersistenceStatus().mode;
  if (persistenceMode === 'off' || !deps.sessionManager.memoryTraces) {
    return jsonResult(
      {
        status: 'memory_unavailable',
        persistenceMode,
      },
      false,
    );
  }

  const object = readObjectArg(args);
  const traceId = readStringArg(object, 'traceId');
  const feedbackToken =
    readStringArg(object, 'feedbackToken') ?? readStringArg(object, 'traceBindingHash');
  const businessStatus = readStringArg(object, 'businessStatus');
  if (
    !traceId ||
    !feedbackToken ||
    !businessStatus ||
    !MEMORY_FEEDBACK_STATUSES.has(businessStatus)
  ) {
    return jsonResult(
      {
        status: 'invalid_input',
        message: 'traceId, feedbackToken, and a valid businessStatus are required.',
      },
      true,
    );
  }

  let updated;
  try {
    updated = deps.sessionManager.memoryTraces.recordAiBusinessFeedback({
      traceId,
      taskId: readStringArg(object, 'taskId'),
      toolName: readStringArg(object, 'toolName'),
      toolCallId: readStringArg(object, 'toolCallId'),
      sequenceIndex: readIntegerArg(object, 'sequenceIndex'),
      traceBindingHash: feedbackToken,
      evaluationScope:
        object.evaluationScope === 'task' || object.evaluationScope === 'step'
          ? object.evaluationScope
          : undefined,
      businessStatus,
      confidence: readConfidenceArg(object),
      reasonCode: readStringArg(object, 'reasonCode'),
      summary: readStringArg(object, 'summary'),
      evaluationVersion: readStringArg(object, 'evaluationVersion'),
      rubricVersion: readStringArg(object, 'rubricVersion'),
      evaluatorModel: readStringArg(object, 'evaluatorModel'),
      userGoalSnapshot: readStringArg(object, 'userGoalSnapshot'),
      experienceCandidate: readBooleanArg(object, 'experienceCandidate'),
      receivedAt: new Date().toISOString(),
      sourceToolName: TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
      sourceToolCallId: null,
    });
  } catch (error) {
    if (error instanceof MkeAiFeedbackValidationError) {
      return jsonResult(
        {
          status: error.code,
          message: error.message,
          traceId,
          persistenceMode,
        },
        true,
      );
    }
    throw error;
  }

  if (!updated) {
    return jsonResult(
      {
        status: 'unknown_trace',
        traceId,
        persistenceMode,
      },
      false,
    );
  }

  const eligibleForExperienceProjection = shouldProjectExperienceAfterAiFeedback({
    businessStatus,
    confidence: updated.aiFeedbackScore,
    summary: readStringArg(object, 'summary'),
    evaluatorModel: readStringArg(object, 'evaluatorModel'),
    experienceCandidate: readBooleanArg(object, 'experienceCandidate'),
  });
  const shouldInvalidateExperience = shouldInvalidateExperienceAfterAiFeedback({
    businessStatus,
    experienceCandidate: readBooleanArg(object, 'experienceCandidate'),
  });
  const experienceRevocation = shouldInvalidateExperience
    ? deps.sessionManager.revokeMkeExperienceForTrace({
        traceId,
        nowIso: new Date().toISOString(),
        revalidateScenario: false,
      })
    : null;
  const projection = eligibleForExperienceProjection
    ? await deps.sessionManager
        .flushAndProjectMkeAfterAiFeedback(traceId)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          return { error: message };
        })
    : null;

  return jsonResult(
    {
      status: 'recorded',
      traceId,
      businessStatus,
      confidence: updated.aiFeedbackScore,
      persistenceMode,
      projection:
        projection && 'error' in projection
          ? {
              status: 'failed',
              message: projection.error,
            }
          : {
              status: eligibleForExperienceProjection
                ? 'projected'
                : 'skipped_experience_not_eligible',
              knowledgeUpserted: projection?.knowledge?.upsertedKnowledgeCount ?? null,
              experienceSaved: projection?.experience?.savedExperienceCount ?? null,
              experienceIds: projection?.experience?.experienceIds ?? [],
              experienceRevocation,
            },
    },
    false,
  );
};
