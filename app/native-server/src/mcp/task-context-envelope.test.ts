import { describe, expect, it } from '@jest/globals';
import { TaskSessionContext } from '../execution/task-session-context';
import { buildTaskContextEnvelope } from './task-context-envelope';

describe('buildTaskContextEnvelope', () => {
  it('inherits cleanup policy from run-owned tab claims when the current request omits policy args', () => {
    const context = new TaskSessionContext({ readBudget: 5 });
    context.noteRunOwnedTab(123, {
      aiClaimId: 'claim-123',
      aiClaimState: 'claimed',
      desiredExecutionMode: 'run_owned',
      focusPolicy: 'no_steal',
      cleanupPolicy: 'close_run_owned',
    });

    const envelope = buildTaskContextEnvelope({
      toolName: 'chrome_read_page',
      taskContext: context,
      taskContextKey: 'mcp:auto:tab:123',
      taskContextKeySource: 'external_task_key',
      requestArgs: { tabId: 123 },
    });

    expect(envelope.taskOwnedSession).toMatchObject({
      desiredExecutionMode: 'run_owned',
      focusPolicy: 'no_steal',
      cleanupPolicy: 'close_run_owned',
      finalizeStatus: 'cleanup_required',
      nextAction: 'call_chrome_close_tabs_for_run_owned_tabs',
    });
  });
});
