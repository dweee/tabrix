import { TOOL_NAMES, getToolRiskTier, isExplicitOptInTool } from '@tabrix/shared';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { resolveOptInAllowlist } from '../policy/phase0-opt-in';

/**
 * Tools with elevated risk: arbitrary JS execution, data deletion, file system
 * interaction. When MCP_DISABLE_SENSITIVE_TOOLS=true, these are hidden from
 * the tool list unless explicitly allowed via ENABLE_MCP_TOOLS.
 */
export const SENSITIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.BROWSER.JAVASCRIPT,
  TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
  TOOL_NAMES.BROWSER.FILE_UPLOAD,
]);

const CORE_LEARNING_TOOL_NAMES: ReadonlySet<string> = new Set([
  TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
]);

function parseToolList(value?: string): Set<string> {
  return new Set(
    (value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function filterToolsByEnvironment(tools: Tool[]): Tool[] {
  const enabledTools = parseToolList(process.env.ENABLE_MCP_TOOLS);
  const disabledTools = parseToolList(process.env.DISABLE_MCP_TOOLS);

  if (enabledTools.size > 0) {
    return tools.filter(
      (tool) => enabledTools.has(tool.name) || CORE_LEARNING_TOOL_NAMES.has(tool.name),
    );
  }

  if (disabledTools.size > 0) {
    return tools.filter(
      (tool) => !disabledTools.has(tool.name) || CORE_LEARNING_TOOL_NAMES.has(tool.name),
    );
  }

  if (process.env.MCP_DISABLE_SENSITIVE_TOOLS === 'true') {
    return tools.filter((tool) => !SENSITIVE_TOOL_NAMES.has(tool.name));
  }

  return tools;
}

export function isToolAllowed(toolName: string, tools: Tool[]): boolean {
  return tools.some((tool) => tool.name === toolName);
}

/**
 * Phase 0 Policy view of the tools list. Removes P3 opt-in tools that have not been opted-in
 * and injects the Tabrix-private `riskTier` annotation so clients that choose to render it can.
 *
 * Never mutates the input tool objects.
 */
export function filterToolsByPolicy(tools: Tool[]): Tool[] {
  const optInAllow = resolveOptInAllowlist(process.env);
  const result: Tool[] = [];
  for (const tool of tools) {
    if (isExplicitOptInTool(tool.name) && !optInAllow.has(tool.name)) {
      continue;
    }
    const riskTier = getToolRiskTier(tool.name);
    const requiresOptIn = isExplicitOptInTool(tool.name);
    if (!riskTier && !requiresOptIn) {
      result.push(tool);
      continue;
    }
    const annotations = {
      ...(tool.annotations ?? {}),
      ...(riskTier ? { riskTier } : {}),
      ...(requiresOptIn ? { requiresExplicitOptIn: true } : {}),
    } as Tool['annotations'];
    result.push({ ...tool, annotations });
  }
  return result;
}
