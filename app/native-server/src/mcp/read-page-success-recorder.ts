import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReadPageRequestedLayer } from '@tabrix/shared';
import type { TaskReadSource, TaskSessionContext } from '../execution/task-session-context';
import {
  buildReadPageContextMeasurement,
  extractReadPageIdentity,
} from './read-page-target-binding';
import { buildReadPageRequestKey } from './read-page-request-shape';
import { readJsonObjectFromCallToolResult } from './register-tool-result-json';
import { extractRequestedLayer, READ_PAGE_DEFAULT_LAYER } from './task-context-key';

export function recordSuccessfulReadPageCall(input: {
  alreadyRecorded: boolean;
  toolName: string;
  taskContext: TaskSessionContext | null;
  rawResult: CallToolResult;
  args: unknown;
  forcedReadPageLayer?: ReadPageRequestedLayer | null;
  source: TaskReadSource;
  targetRefs?: ReadonlyArray<string> | null;
}): boolean {
  if (input.alreadyRecorded) return true;
  if (input.toolName !== 'chrome_read_page') return false;
  if (!input.taskContext) return false;
  if (input.rawResult.isError === true) return false;

  const requestedLayer =
    input.forcedReadPageLayer ?? extractRequestedLayer(input.args) ?? READ_PAGE_DEFAULT_LAYER;
  const payload = readJsonObjectFromCallToolResult(input.rawResult);
  const identity = extractReadPageIdentity(payload);
  input.taskContext.noteReadPageIdentity(identity.url, identity.pageRole);
  input.taskContext.noteReadPage({
    layer: requestedLayer,
    source: input.source,
    requestKey: buildReadPageRequestKey(input.args, requestedLayer),
    targetRefs: input.targetRefs,
    contextMeasurement: buildReadPageContextMeasurement(payload, requestedLayer),
  });
  return true;
}
