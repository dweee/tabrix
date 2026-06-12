import { TOOL_NAMES } from '@tabrix/shared';

const AI_FEEDBACK_OPTIONAL_TOOLS = new Set<string>([
  TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
  TOOL_NAMES.CONTEXT.CHOOSE,
  TOOL_NAMES.CONTEXT.RECORD_OUTCOME,
  TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
]);

export function shouldRequestAiFeedbackForTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  return !AI_FEEDBACK_OPTIONAL_TOOLS.has(toolName);
}
