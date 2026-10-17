import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ExecutionResult } from './types';

export interface ToolCallNormalization {
  executionResult: ExecutionResult;
  stepSummary: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface AiFacingToolContext {
  contextKind: 'delta_context';
  contextSource: string | null;
  taskState: string | null;
  recommendedNextAction: string | null;
  deltaKind: string | null;
  selectedDataSource: string | null;
  selectedReason: string | null;
  rejectedSourceReasons: string[];
  fallbackReason: string | null;
  changedRegions: string[];
  reusedRegions: string[];
  contextChars: number | null;
  contextSavedChars: number | null;
  metadataCompleteness: number | null;
  sourceConfidence: number | null;
}

function extractTextContent(result: CallToolResult): string[] {
  return (result.content || [])
    .filter((item): item is Extract<(typeof result.content)[number], { type: 'text' }> => {
      return item.type === 'text' && typeof item.text === 'string';
    })
    .map((item) => item.text.trim())
    .filter(Boolean);
}

function parseFirstJsonObject(textParts: string[]): Record<string, unknown> | null {
  const first = textParts[0];
  if (!first) return null;
  try {
    const parsed = JSON.parse(first) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function readRejectedSourceReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = readRecord(item);
      if (!record) return null;
      const source = readString(record.source);
      const reason = readString(record.reason);
      if (!source && !reason) return null;
      return `${source ?? 'unknown'}:${reason ?? 'not_reported'}`;
    })
    .filter((item): item is string => item !== null);
}

export function selectAiFacingToolContext(result: CallToolResult): AiFacingToolContext | null {
  const textParts = extractTextContent(result);
  const payload = parseFirstJsonObject(textParts);
  if (!payload) return null;
  const envelope = readRecord(payload.aiContextEnvelope);
  if (!envelope || envelope.envelopeKind !== 'delta_context') return null;
  const delta = readRecord(envelope.deltaContext);
  if (!delta) return null;
  const dataSourceDecision = readRecord(envelope.dataSourceDecision);
  const taskState = readRecord(envelope.taskState);

  return {
    contextKind: 'delta_context',
    contextSource: readString(envelope.contextSource),
    taskState: readString(taskState?.state),
    recommendedNextAction: readString(taskState?.recommendedNextAction),
    deltaKind: readString(delta.deltaKind),
    selectedDataSource: readString(envelope.selectedDataSource),
    selectedReason: readString(dataSourceDecision?.selectedReason),
    rejectedSourceReasons: readRejectedSourceReasons(dataSourceDecision?.rejectedSources),
    fallbackReason: readString(dataSourceDecision?.fallbackReason),
    changedRegions: readStringArray(delta.changedRegions),
    reusedRegions: readStringArray(delta.reusedRegions),
    contextChars: readNumber(delta.contextChars),
    contextSavedChars: readNumber(delta.contextSavedChars),
    metadataCompleteness: readNumber(dataSourceDecision?.metadataCompleteness),
    sourceConfidence: readNumber(dataSourceDecision?.sourceConfidence),
  };
}

function summarizeAiFacingContext(context: AiFacingToolContext): string {
  const changed = context.changedRegions.length > 0 ? context.changedRegions.join(',') : 'none';
  const reused = context.reusedRegions.length > 0 ? context.reusedRegions.join(',') : 'none';
  const saved =
    context.contextSavedChars === null ? 'unknown' : String(Math.max(0, context.contextSavedChars));
  const rejected =
    context.rejectedSourceReasons.length > 0 ? context.rejectedSourceReasons.join(',') : 'none';
  return [
    `AI context: ${context.deltaKind ?? 'unknown_delta'}`,
    `state=${context.taskState ?? 'unknown'}`,
    `next=${context.recommendedNextAction ?? 'unknown'}`,
    `source=${context.contextSource ?? 'unknown'}`,
    `data=${context.selectedDataSource ?? 'unknown'}`,
    `reason=${context.selectedReason ?? 'unknown'}`,
    `fallback=${context.fallbackReason ?? 'none'}`,
    `rejected=${rejected}`,
    `metadata=${context.metadataCompleteness ?? 'unknown'}`,
    `confidence=${context.sourceConfidence ?? 'unknown'}`,
    `changed=${changed}`,
    `reused=${reused}`,
    `savedChars=${saved}`,
  ].join('; ');
}

export function normalizeToolCallResult(
  toolName: string,
  result: CallToolResult,
): ToolCallNormalization {
  const textParts = extractTextContent(result);
  const aiFacingContext = result.isError ? null : selectAiFacingToolContext(result);
  const summary =
    (aiFacingContext ? summarizeAiFacingContext(aiFacingContext) : null) ||
    textParts[0] ||
    (result.isError ? `Tool ${toolName} failed` : `Tool ${toolName} succeeded`);

  if (result.isError) {
    return {
      executionResult: {
        status: 'failure',
        summary,
        warnings: [],
        errors: [
          {
            code: 'tool_call_error',
            summary,
          },
        ],
        artifacts: [],
        nextActions: [],
      },
      stepSummary: summary,
      errorCode: 'tool_call_error',
      errorSummary: summary,
    };
  }

  return {
    executionResult: {
      status: 'success',
      summary,
      data: aiFacingContext ? { rawResult: result, aiFacingContext } : result,
      warnings: [],
      errors: [],
      artifacts: [],
      nextActions: [],
    },
    stepSummary: summary,
  };
}
