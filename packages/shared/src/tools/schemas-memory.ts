import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './names';

export const MEMORY_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
    description:
      'Write the AI evaluation and score for a prior Tabrix Memory trace. Use this after the AI decides whether a Tabrix browser step helped complete the user goal. These AI ratings are the input for future Experience mining.',
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        traceId: {
          type: 'string',
          description: 'Memory trace id returned by a prior tool result `_tabrix.traceId`.',
          minLength: 1,
          maxLength: 128,
        },
        taskId: {
          type: 'string',
          description: 'Task id returned in `_tabrix.feedbackTarget.taskId`.',
          minLength: 1,
          maxLength: 128,
        },
        toolName: {
          type: 'string',
          description: 'Tool name returned in `_tabrix.feedbackTarget.toolName`.',
          minLength: 1,
          maxLength: 128,
        },
        toolCallId: {
          type: 'string',
          description:
            'Tool call id returned in `_tabrix.feedbackTarget.toolCallId`, when present.',
          minLength: 1,
          maxLength: 128,
        },
        sequenceIndex: {
          type: 'integer',
          description: 'Sequence index returned in `_tabrix.feedbackTarget.sequenceIndex`.',
          minimum: 0,
        },
        traceBindingHash: {
          type: 'string',
          description: 'Stable binding hash returned in `_tabrix.feedbackTarget.traceBindingHash`.',
          minLength: 32,
          maxLength: 128,
        },
        evaluationScope: {
          type: 'string',
          description: 'Whether this evaluates one tool step or the whole task.',
          enum: ['step', 'task'],
        },
        evaluationVersion: {
          type: 'string',
          description: 'AI feedback schema/evaluator version.',
          maxLength: 64,
        },
        rubricVersion: {
          type: 'string',
          description: 'Scoring rubric version used by the AI evaluator.',
          maxLength: 64,
        },
        evaluatorModel: {
          type: 'string',
          description: 'Model or evaluator identity that produced the business judgment.',
          maxLength: 128,
        },
        businessStatus: {
          type: 'string',
          description:
            'AI judgment of whether that trace advanced the user goal: achieved, partial, not_achieved, or unknown.',
          enum: ['achieved', 'partial', 'not_achieved', 'unknown'],
        },
        confidence: {
          type: 'number',
          description:
            'AI confidence from 0 to 1. Use >=0.90 only when the page/result clearly shows the user goal advanced.',
          minimum: 0,
          maximum: 1,
        },
        reasonCode: {
          type: 'string',
          description: 'Short machine-readable reason, e.g. ai_verified_result or needs_retry.',
          maxLength: 128,
        },
        summary: {
          type: 'string',
          description:
            'One concise human-readable sentence explaining the AI judgment. Do not include secrets or raw page data.',
          maxLength: 512,
        },
        evidenceRefs: {
          type: 'array',
          description:
            'Optional result references for traceability, such as trace ids, tool call ids, observation ids, or result paths. Do not include raw page text, secrets, or screenshots.',
          items: { type: 'string', minLength: 1, maxLength: 160 },
          maxItems: 12,
        },
        userGoalSnapshot: {
          type: 'string',
          description: 'Short redacted snapshot of the user goal this feedback is judging.',
          maxLength: 512,
        },
        experienceCandidate: {
          type: 'boolean',
          description:
            'True only when this AI-rated step is worth considering for future Experience mining.',
        },
      },
      required: [
        'traceId',
        'taskId',
        'toolName',
        'sequenceIndex',
        'traceBindingHash',
        'businessStatus',
      ],
      additionalProperties: false,
    },
  },
];
