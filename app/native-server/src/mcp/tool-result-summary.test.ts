import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { readFirstTextContent, summarizeNativeToolErrorResult } from './tool-result-summary';

describe('tool result summary helpers', () => {
  it('reads the first text content from a tool result', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'hello' }],
    };

    expect(readFirstTextContent(result)).toBe('hello');
  });

  it('extracts JSON message summaries from native tool errors', () => {
    const result: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ message: 'native failure detail' }) }],
    };

    expect(summarizeNativeToolErrorResult(result, 'fallback')).toBe('native failure detail');
  });

  it('falls back for non-JSON or empty native tool errors', () => {
    const nonJson: CallToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'plain failure' }],
    };
    const empty: CallToolResult = {
      isError: true,
      content: [],
    };

    expect(summarizeNativeToolErrorResult(nonJson, 'fallback')).toBe('fallback');
    expect(summarizeNativeToolErrorResult(empty, 'fallback')).toBe('fallback');
  });
});
