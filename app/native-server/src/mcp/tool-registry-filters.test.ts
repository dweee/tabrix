import { afterEach, describe, expect, it } from '@jest/globals';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { filterToolsByEnvironment } from './tool-registry-filters';

function tool(name: string): Tool {
  return {
    name,
    description: name,
    inputSchema: { type: 'object' },
  };
}

describe('tool-registry-filters', () => {
  afterEach(() => {
    delete process.env.ENABLE_MCP_TOOLS;
    delete process.env.DISABLE_MCP_TOOLS;
    delete process.env.MCP_DISABLE_SENSITIVE_TOOLS;
  });

  it('keeps AI feedback write-back available in allow-list mode', () => {
    process.env.ENABLE_MCP_TOOLS = TOOL_NAMES.BROWSER.READ_PAGE;

    const names = filterToolsByEnvironment([
      tool(TOOL_NAMES.BROWSER.READ_PAGE),
      tool(TOOL_NAMES.BROWSER.CLICK),
      tool(TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK),
    ]).map((item) => item.name);

    expect(names).toEqual([TOOL_NAMES.BROWSER.READ_PAGE, TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK]);
  });

  it('does not let deny-list mode hide AI feedback write-back', () => {
    process.env.DISABLE_MCP_TOOLS = TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK;

    const names = filterToolsByEnvironment([
      tool(TOOL_NAMES.BROWSER.READ_PAGE),
      tool(TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK),
    ]).map((item) => item.name);

    expect(names).toEqual([TOOL_NAMES.BROWSER.READ_PAGE, TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK]);
  });
});
