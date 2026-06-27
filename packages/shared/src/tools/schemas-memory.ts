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
        feedbackToken: {
          type: 'string',
          description: 'Feedback token returned in `_tabrix.feedbackTarget.feedbackToken`.',
          minLength: 32,
          maxLength: 128,
        },
        taskId: {
          type: 'string',
          description:
            'Optional task id from the trace envelope. When provided, Tabrix verifies it matches the target trace.',
          minLength: 1,
          maxLength: 128,
        },
        toolName: {
          type: 'string',
          description:
            'Optional tool name from the trace envelope. When provided, Tabrix verifies it matches the target trace.',
          minLength: 1,
          maxLength: 128,
        },
        toolCallId: {
          type: 'string',
          description:
            'Optional tool call id from the trace envelope. When provided, Tabrix verifies it matches the target trace.',
          minLength: 1,
          maxLength: 128,
        },
        sequenceIndex: {
          type: 'integer',
          description:
            'Optional sequence index from the trace envelope. When provided, Tabrix verifies it matches the target trace.',
          minimum: 0,
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
        evaluationVersion: {
          type: 'string',
          description: 'Optional AI evaluation format version used by the caller.',
          maxLength: 64,
        },
        rubricVersion: {
          type: 'string',
          description: 'Optional rubric version used to score this browser step.',
          maxLength: 128,
        },
        evaluatorModel: {
          type: 'string',
          description: 'Optional model or agent name that produced the AI evaluation.',
          maxLength: 128,
        },
        userGoalSnapshot: {
          type: 'string',
          description:
            'Optional short, privacy-safe summary of the user goal this step was judged against.',
          maxLength: 512,
        },
        experienceCandidate: {
          type: 'boolean',
          description:
            'Set false when the step succeeded but should not be mined into Experience because it was brittle, slow, risky, private, or not reusable.',
        },
      },
      required: ['traceId', 'feedbackToken', 'businessStatus'],
      additionalProperties: false,
    },
  },
];
