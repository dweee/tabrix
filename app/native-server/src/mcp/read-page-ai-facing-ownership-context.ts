import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  isBrowserPageThingProjectionLike,
  readSelectedDataSource,
} from './read-page-payload-readers';
import {
  attachTaskContextEnvelopeToJsonResult,
  buildTaskContextEnvelope,
  type TaskContextAttachment,
} from './task-context-envelope';
import {
  ensureProjectionSourceTruthChain,
  normalizeAiFacingProjectionDataSource,
} from './read-page-source-decision';
import {
  buildAiFacingOwnershipRuntimeSummary,
  normalizeAiFacingProjectionOwnerType,
  readTaskPageRuntimeFields,
} from './read-page-ownership-runtime';
import {
  buildCachedReadPageObjectSummary,
  stripReadPageDiagnosticNoiseForOutput,
} from './read-page-ai-output';
import { getBridgeSnapshot } from './bridge-recovery';
import { readObject } from './register-tool-value-readers';

export function attachAiFacingOwnershipRuntime(
  result: CallToolResult,
  attachment: TaskContextAttachment,
  options?: { includeAiContextEnvelope?: boolean },
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  const projection = payload.pageProjection;
  if (!isBrowserPageThingProjectionLike(projection)) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }

  const selectedDataSource = readSelectedDataSource(payload, projection);
  const aiFacingProjection = normalizeAiFacingProjectionDataSource(
    projection,
    selectedDataSource,
    payload,
  );
  const normalizedAiFacingProjection = normalizeAiFacingProjectionOwnerType(
    attachment.taskContext,
    aiFacingProjection,
    selectedDataSource,
    payload,
  );
  const projectionWithSourceTruth = ensureProjectionSourceTruthChain(
    normalizedAiFacingProjection,
    selectedDataSource,
  );
  const runtimeFields = readTaskPageRuntimeFields(payload);

  const ownershipRuntime = buildAiFacingOwnershipRuntimeSummary({
    taskContext: attachment.taskContext,
    projection: projectionWithSourceTruth,
    runtimeFields,
    bridgeSnapshot: getBridgeSnapshot(),
  });
  payload.pageProjection = projectionWithSourceTruth;
  payload.tabId = projectionWithSourceTruth.tabId;
  payload.ownershipRuntime = ownershipRuntime;
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  const aiContextEnvelope = readObject(payload.aiContextEnvelope);
  if (aiContextEnvelope && options?.includeAiContextEnvelope === true) {
    payload.aiContextEnvelope = {
      ...aiContextEnvelope,
      taskContext: buildTaskContextEnvelope(attachment),
      pageObjectSummary: buildCachedReadPageObjectSummary({
        warning: typeof payload.warning === 'string' ? payload.warning : 'cached_read_warning',
        projection: projectionWithSourceTruth,
        ownershipRuntime,
        selectedDataSource,
      }),
    };
  } else {
    delete payload.aiContextEnvelope;
  }
  const responsePayload =
    options?.includeAiContextEnvelope === true
      ? payload
      : stripReadPageDiagnosticNoiseForOutput(payload);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}
