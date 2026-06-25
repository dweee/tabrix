import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function readJsonObjectFromCallToolResult(
  result: CallToolResult,
): Record<string, unknown> | null {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return null;

  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function attachReadPagePayloadMetadata(
  result: CallToolResult,
  metadata: Record<string, unknown>,
  options: { omitFullPageContent?: boolean } = {},
): CallToolResult {
  const payload = readJsonObjectFromCallToolResult(result);
  if (!payload) return result;

  const mergedPayload = { ...payload, ...metadata };
  if (options.omitFullPageContent) {
    delete mergedPayload.pageContent;
  }

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(mergedPayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

export function mergeReadPagePayloadMetadata(
  baseResult: CallToolResult,
  metadataResult: CallToolResult,
  options: { omitFullPageContent?: boolean } = {},
): CallToolResult {
  const metadata = readJsonObjectFromCallToolResult(metadataResult);
  if (!metadata) return baseResult;

  return attachReadPagePayloadMetadata(baseResult, metadata, options);
}
