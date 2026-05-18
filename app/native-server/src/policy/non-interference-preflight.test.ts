import { TOOL_NAMES } from '@tabrix/shared';
import { TaskSessionContext } from '../execution/task-session-context';
import { evaluateNonInterferencePreflight } from './non-interference-preflight';

describe('evaluateNonInterferencePreflight', () => {
  it('blocks current active-tab impact actions without explicit target', () => {
    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { ref: 'ref_1' },
      taskContext: new TaskSessionContext({ readBudget: 6 }),
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.audit).toMatchObject({
      policy: 'non_interference',
      verdict: 'block',
      reason: 'active_user_tab_unprotected',
      targetTabId: null,
    });
  });

  it('allows impact actions on tabs owned by the current task', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#q', value: 'acp' },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('run_owned_tab');
    expect(verdict.audit.runOwnedTabIds).toEqual([42]);
  });

  it('allows new-tab navigation so the caller can create a run-owned tab', () => {
    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.NAVIGATE,
      args: { url: 'https://example.com' },
      taskContext: new TaskSessionContext({ readBudget: 6 }),
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('new_run_owned_tab');
  });

  it('strict mode blocks explicit non-owned tab impact', () => {
    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.KEYBOARD,
      args: { tabId: 7, keys: 'Enter', nonInterferencePolicy: 'strict' },
      taskContext: new TaskSessionContext({ readBudget: 6 }),
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.audit.reason).toBe('non_run_owned_tab');
  });

  it('blocks close without explicit tab ids', () => {
    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLOSE_TABS,
      args: {},
      taskContext: new TaskSessionContext({ readBudget: 6 }),
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.audit.reason).toBe('active_user_tab_unprotected');
  });

  it('returns collaboration_required when current-tab impact explicitly asks for collaboration', () => {
    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        ref: 'ref_login',
        runtimePolicy: { desiredExecutionMode: 'collaboration' },
      },
      taskContext: new TaskSessionContext({ readBudget: 6 }),
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'collaboration_requested',
    });
    expect(verdict.audit.browserPolicyAudit[0]).toMatchObject({
      field: 'desiredExecutionMode',
      verdict: 'applied',
      source: 'policy',
    });
  });
});
