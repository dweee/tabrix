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
  TOOL_NAMES.BROWSER.CLOSE_TABS,
  TOOL_NAMES.BROWSER.SWITCH_TAB,
  TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS,
  TOOL_NAMES.BROWSER.WEB_FETCHER,
  TOOL_NAMES.BROWSER.HANDLE_DIALOG,
  TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
  TOOL_NAMES.BROWSER.NETWORK_REQUEST,
  TOOL_NAMES.BROWSER.BOOKMARK_ADD,
  TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.COMPUTER,
]);

const BROWSER_TOOLS = new Set<string>(Object.values(TOOL_NAMES.BROWSER));

const MAINTENANCE_INTENT_PATTERN =
  /内部维护|系统维护|后台维护|后台诊断|后台投影|纯诊断|性能采样|\bmaintenance\b|\bdiagnostic only\b|\bbackground projection\b|\bprojection refresh\b|^\s*(?:health check|telemetry)\s*:/i;

export function shouldRequestAiFeedbackForTool(toolName: string | null | undefined): boolean {
  if (!toolName) return false;
  if (AI_FEEDBACK_NEVER_TOOLS.has(toolName)) return false;
  return DEFAULT_INTENT_FEEDBACK_TOOLS.has(toolName);
}

function isMaintenanceIntent(taskIntent: string | null | undefined): boolean {
  const text = String(taskIntent || '').trim();
  return MAINTENANCE_INTENT_PATTERN.test(text);
}

export function shouldRequestAiFeedbackForTrace(
  trace: Pick<MemoryTrace, 'toolName' | 'taskIntent'> | null | undefined,
): boolean {
  if (!trace) return false;
  const toolName = trace.toolName;
  if (!toolName) return false;
  if (AI_FEEDBACK_NEVER_TOOLS.has(toolName)) return false;
  if (DEFAULT_INTENT_FEEDBACK_TOOLS.has(toolName)) return true;
  if (isMaintenanceIntent(trace.taskIntent)) return false;
  return BROWSER_TOOLS.has(toolName);
}
