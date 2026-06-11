import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { MemoryTrace } from '../memory/db';
import { buildMemoryTraceBindingHash } from '../memory/feedback-binding';

const TABRIX_TOOL_METADATA_KEY = '_tabrix';
const AI_BUSINESS_STATUS_VALUES = new Set(['achieved', 'partial', 'not_achieved', 'unknown']);

interface TabrixPreviousFeedback {
  traceId: string;
  taskId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  sequenceIndex: number | null;
  feedbackToken: string | null;
  evaluationScope: 'step' | 'task' | null;
  businessStatus: 'achieved' | 'partial' | 'not_achieved' | 'unknown';
  confidence: number | null;
  reasonCode: string | null;
  summary: string | null;
}

export interface TabrixToolMetadata {
  intentTitle: string | null;
  intentSummary: string | null;
  nextIntent: string | null;
  previousFeedback: TabrixPreviousFeedback[];
}

const TABRIX_TOOL_METADATA_SCHEMA = {
  type: 'object',
  description:
    'Optional Tabrix runtime metadata for intent titles and previous Memory trace AI feedback.',
  properties: {
    intentTitle: {
      type: 'string',
      description: 'Short user-facing task title for this tool call.',
    },
    intentSummary: {
      type: 'string',
      description: 'Brief task purpose summary.',
    },
    nextIntent: {
      type: 'string',
      description: 'Optional next planned task intent.',
    },
    previousFeedback: {
      type: 'array',
      description: 'Optional AI feedback for earlier Tabrix Memory traces.',
      items: {
        type: 'object',
        properties: {
          traceId: { type: 'string' },
          taskId: { type: 'string' },
          toolName: { type: 'string' },
          toolCallId: { type: 'string' },
          sequenceIndex: { type: 'integer', minimum: 0 },
          feedbackToken: { type: 'string' },
          evaluationScope: { type: 'string', enum: ['step', 'task'] },
          businessStatus: {
            type: 'string',
            enum: ['achieved', 'partial', 'not_achieved', 'unknown'],
          },
          confidence: {
            type: 'number',
            minimum: 0,
            maximum: 1,
          },
          reasonCode: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['traceId', 'businessStatus'],
      },
    },
  },
  additionalProperties: true,
};

export function withTabrixMetadataSchema(tool: any): any {
  const inputSchema = tool?.inputSchema;
  if (!inputSchema || typeof inputSchema !== 'object' || Array.isArray(inputSchema)) return tool;
  const properties =
    inputSchema.properties && typeof inputSchema.properties === 'object'
      ? inputSchema.properties
      : {};
  return {
    ...tool,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...properties,
        [TABRIX_TOOL_METADATA_KEY]: TABRIX_TOOL_METADATA_SCHEMA,
      },
    },
  };
}

export function readTabrixToolMetadata(args: unknown): TabrixToolMetadata {
  const object = readObject(args);
  const metadata = readObject(object?.[TABRIX_TOOL_METADATA_KEY]);
  return {
    intentTitle: readOptionalString(metadata?.intentTitle),
    intentSummary: readOptionalString(metadata?.intentSummary),
    nextIntent: readOptionalString(metadata?.nextIntent),
    previousFeedback: readPreviousFeedback(metadata?.previousFeedback),
  };
}

export function stripTabrixToolMetadata(args: unknown): unknown {
  const object = readObject(args);
  if (!object || !(TABRIX_TOOL_METADATA_KEY in object)) return args;
  const { [TABRIX_TOOL_METADATA_KEY]: _tabrix, ...stripped } = object;
  void _tabrix;
  return stripped;
}

export function attachTabrixMemoryTraceEnvelope(
  result: CallToolResult,
  trace: MemoryTrace | null,
  metadata: TabrixToolMetadata,
  toolName: string,
): CallToolResult {
  if (!trace) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  const existingTabrix = readObject(payload[TABRIX_TOOL_METADATA_KEY]) ?? {};
  const traceBindingHash = buildMemoryTraceBindingHash(trace);
  const feedbackTarget = {
    traceId: trace.traceId,
    feedbackToken: traceBindingHash,
  };
  const nextPayload = {
    ...payload,
    [TABRIX_TOOL_METADATA_KEY]: {
      ...existingTabrix,
      traceId: trace.traceId,
      intentTitle: metadata.intentTitle ?? trace.taskIntent ?? null,
      intentSummary: metadata.intentSummary,
      nextIntent: metadata.nextIntent,
      toolName,
      feedbackTarget,
      toolSuccess: trace.toolSuccess,
      businessFeedbackRequired: true,
    },
  };

  return {
    ...result,
    content: [{ ...first, text: JSON.stringify(nextPayload) }, ...(result.content?.slice(1) ?? [])],
  };
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readOptionalConfidence(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function readOptionalInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function readPreviousFeedback(value: unknown): TabrixPreviousFeedback[] {
  if (!Array.isArray(value)) return [];
  const feedback: TabrixPreviousFeedback[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const object = item as Record<string, unknown>;
    const traceId = readOptionalString(object.traceId);
    const status = readOptionalString(object.businessStatus);
    if (!traceId || !status || !AI_BUSINESS_STATUS_VALUES.has(status)) continue;
    feedback.push({
      traceId,
      taskId: readOptionalString(object.taskId),
      toolName: readOptionalString(object.toolName),
      toolCallId: readOptionalString(object.toolCallId),
      sequenceIndex: readOptionalInteger(object.sequenceIndex),
      feedbackToken:
        readOptionalString(object.feedbackToken) ?? readOptionalString(object.traceBindingHash),
      evaluationScope:
        object.evaluationScope === 'step' || object.evaluationScope === 'task'
          ? object.evaluationScope
          : null,
      businessStatus: status as TabrixPreviousFeedback['businessStatus'],
      confidence: readOptionalConfidence(object.confidence),
      reasonCode: readOptionalString(object.reasonCode),
      summary: readOptionalString(object.summary),
    });
  }
  return feedback;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
