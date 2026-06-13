import { TOOL_NAMES } from '@tabrix/shared';

import type { MemoryTrace } from './db';

const AI_FEEDBACK_REQUIRED_TOOLS = new Set<string>([
  TOOL_NAMES.BROWSER.READ_PAGE,
  TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
]);

export function shouldRequestAiFeedbackForTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  return AI_FEEDBACK_REQUIRED_TOOLS.has(toolName);
}

export function shouldRequestAiFeedbackForTrace(
  trace: Pick<MemoryTrace, 'toolName' | 'toolSuccess' | 'taskIntent'> | null | undefined,
): boolean {
  if (!trace || trace.toolSuccess !== true) return false;
  if (!shouldRequestAiFeedbackForTool(trace.toolName)) return false;
  if (trace.toolName === TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS) return true;
  const taskIntent = trace.taskIntent?.trim();
  if (!taskIntent || taskIntent === `Run MCP tool ${trace.toolName}`) return false;
  return true;
}
