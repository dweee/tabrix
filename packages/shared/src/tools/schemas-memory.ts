import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from './names';

export const MEMORY_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
    description:
      'Write back the AI business evaluation for a prior Tabrix Memory trace. Use this after inspecting a tool result with `_tabrix.traceId` and deciding whether the user intent was achieved. This records AI feedback only; Tabrix execution evidence remains separate.',
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
        businessStatus: {
          type: 'string',
          description:
            'AI judgment of whether that trace advanced the user goal: achieved, partial, not_achieved, or unknown.',
          enum: ['achieved', 'partial', 'not_achieved', 'unknown'],
        },
        confidence: {
          type: 'number',
          description:
            'AI confidence from 0 to 1. Use >=0.90 only when clear page/result evidence proves the intent was achieved.',
          minimum: 0,
          maximum: 1,
        },
        reasonCode: {
          type: 'string',
          description:
            'Short machine-readable reason, e.g. ai_verified_result or insufficient_evidence.',
          maxLength: 128,
        },
        summary: {
          type: 'string',
          description:
            'One concise human-readable sentence explaining the AI judgment. Do not include secrets or raw page data.',
          maxLength: 512,
        },
      },
      required: ['traceId', 'businessStatus'],
      additionalProperties: false,
    },
  },
];
