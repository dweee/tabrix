import { type Tool } from '@modelcontextprotocol/sdk/types.js';
import { MAX_TABRIX_SITE_ID_CHARS, TABRIX_SITE_ID_PATTERN } from '../site';
import { TOOL_NAMES } from './names';

export const CONTEXT_SCHEMAS: Tool[] = [
  {
    name: TOOL_NAMES.CONTEXT.CHOOSE,
    description:
      'Choose the cheapest useful context for an AI browser task. Given an intent and optional page identity, Tabrix returns reusable Experience (`experience_reuse`), reusable local Knowledge (`knowledge_light`), or tells the caller to read the page (`read_page_required`). Unsupported or uncertain inputs resolve to `read_page_required`.',
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: {
        intent: {
          type: 'string',
          description:
            'Caller intent in natural language. Trimmed and normalized so repeated task wording stays stable. Empty string is rejected.',
          minLength: 1,
          maxLength: 1024,
        },
        url: {
          type: 'string',
          description:
            'Optional URL of the page being reasoned about. Used only to derive a site family. Unparseable values are silently ignored (not an error) so a templating bug upstream cannot break selection.',
        },
        pageRole: {
          type: 'string',
          description:
            'Optional `pageRole` filter (e.g. `repo_home`, `issues_list`). Used to narrow the local context selection.',
          maxLength: 128,
        },
        siteId: {
          type: 'string',
          description:
            'Optional explicit site-family token. Must match the shared safe-token contract (lowercase letters/digits plus dot, underscore, or hyphen). `"github"` remains the GA-compatible seed value; unsupported sites resolve through safe fallback paths.',
          maxLength: MAX_TABRIX_SITE_ID_CHARS,
          pattern: TABRIX_SITE_ID_PATTERN.source,
        },
      },
      required: ['intent'],
    },
  },
  {
    name: TOOL_NAMES.CONTEXT.RECORD_OUTCOME,
    description:
      "Record whether the previous `tabrix_choose_context` suggestion helped the AI avoid an unnecessary page read. `outcome` is one of `'reuse'`, `'fallback'`, `'completed'`, or `'retried'`. Unknown decision ids return `{ status: 'unknown_decision' }`.",
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
    },
    inputSchema: {
      type: 'object',
      properties: {
        decisionId: {
          type: 'string',
          description:
            'Opaque decision id returned by a prior `tabrix_choose_context` call (`result.decisionId`). UUIDv4-shaped string; rejected when missing / empty / over 128 chars.',
          minLength: 1,
          maxLength: 128,
        },
        outcome: {
          type: 'string',
          description:
            'Closed outcome label: `reuse` | `fallback` | `completed` | `retried`. Anything else is rejected so aggregation in `release:choose-context-stats` stays deterministic.',
          enum: ['reuse', 'fallback', 'completed', 'retried'],
        },
      },
      required: ['decisionId', 'outcome'],
    },
  },
];
