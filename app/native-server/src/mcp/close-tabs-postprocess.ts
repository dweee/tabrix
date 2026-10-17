import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TaskSessionContext } from '../execution/task-session-context';
import type { SessionManager } from '../execution/session-manager';
import type { PrimaryTabController } from '../runtime/primary-tab-controller';
import {
  extractClosedTabIdsFromCallToolResult,
  extractInvalidTabIdsFromCallToolResult,
} from './task-context-key';
import { buildAutoTabTaskContextKey } from './read-page-visible-region-rows';
import { readNumericArray } from './register-tool-value-readers';
import { recordPrimaryTabCleanupOutcome } from './primary-tab-outgoing-args';
import { maybeRecordCloseTabsSuccessLifecycleArtifact } from './mcp-tool-lifecycle-artifacts';

export function recordCloseTabsSuccessPostprocess(input: {
  args: unknown;
  result: CallToolResult;
  taskContext: TaskSessionContext;
  sessionManager: Pick<SessionManager, 'releaseExternalTaskContext'>;
  primaryTabController: PrimaryTabController;
  startedAtMs: number;
  endedAtMs: number;
}): void {
  const closedTabIds = extractClosedTabIdsFromCallToolResult(input.result);
  const invalidTabIds = extractInvalidTabIdsFromCallToolResult(input.result);
  recordPrimaryTabCleanupOutcome({
    closedTabIds,
    primaryTabController: input.primaryTabController,
  });
  input.taskContext.noteCleanup({
    action: 'chrome_close_tabs',
    targetIds: readNumericArray(input.args, 'tabIds'),
  });
  for (const tabId of [...closedTabIds, ...invalidTabIds]) {
    input.taskContext.releaseRunOwnedTab(tabId);
    input.sessionManager.releaseExternalTaskContext(buildAutoTabTaskContextKey(tabId));
  }
  maybeRecordCloseTabsSuccessLifecycleArtifact({
    args: input.args,
    result: input.result,
    closedTabIds,
    invalidTabIds,
    taskContext: input.taskContext,
    startedAtMs: input.startedAtMs,
    endedAtMs: input.endedAtMs,
  });
}
