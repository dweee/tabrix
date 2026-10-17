import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function readFirstTextContent(result: CallToolResult): string {
  const firstContent = result.content?.[0];
  if (!firstContent || firstContent.type !== 'text') return '';
  return String(firstContent.text ?? '');
}

export function summarizeNativeToolErrorResult(
  result: CallToolResult,
  fallbackSummary: string,
): string {
  const text = readFirstTextContent(result);
  if (!text) return fallbackSummary;

  try {
    const parsed = JSON.parse(text) as { message?: string };
    if (parsed && typeof parsed.message === 'string' && parsed.message) {
      return parsed.message;
    }
  } catch (error) {
    void error;
    // Non-JSON error payloads keep the generic native-tool summary.
  }

  return fallbackSummary;
}
