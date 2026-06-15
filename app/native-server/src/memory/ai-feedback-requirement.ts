import { TOOL_NAMES } from '@tabrix/shared';

import type { MemoryTrace } from './db';

const AI_FEEDBACK_NEVER_TOOLS = new Set<string>([
  TOOL_NAMES.CONTEXT.CHOOSE,
  TOOL_NAMES.CONTEXT.RECORD_OUTCOME,
  TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
  TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE,
  TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE,
]);

const DEFAULT_INTENT_FEEDBACK_TOOLS = new Set<string>([
  TOOL_NAMES.BROWSER.READ_PAGE,
  TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
  TOOL_NAMES.BROWSER.KEYBOARD,
  TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS,
  TOOL_NAMES.BROWSER.WEB_FETCHER,
  TOOL_NAMES.BROWSER.HANDLE_DIALOG,
  TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
]);

export function shouldRequestAiFeedbackForTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  return !AI_FEEDBACK_NEVER_TOOLS.has(toolName);
}

function isDefaultToolRun(toolName: string, taskIntent: string | null | undefined): boolean {
  const trimmed = taskIntent?.trim();
  return !trimmed || trimmed === `Run MCP tool ${toolName}`;
}

export function shouldRequestAiFeedbackForTrace(
  trace: Pick<MemoryTrace, 'toolName' | 'taskIntent'> | null | undefined,
): boolean {
  if (!trace) return false;
  if (!shouldRequestAiFeedbackForTool(trace.toolName)) return false;
  if (!isDefaultToolRun(trace.toolName, trace.taskIntent)) return true;
  return DEFAULT_INTENT_FEEDBACK_TOOLS.has(trace.toolName);
}
