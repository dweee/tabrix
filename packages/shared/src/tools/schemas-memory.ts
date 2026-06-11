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
      },
      required: ['traceId', 'feedbackToken', 'businessStatus'],
      additionalProperties: false,
    },
  },
];
