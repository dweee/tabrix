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

  it('blocks impact actions while auth resume still requires fresh verification', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteAuthResumeVerification({
      status: 'fresh_read_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent', 'account_region_present'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_after_login', userConfirmed: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('forceRefresh=true');
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'auth_resume_verification_required',
      targetTabId: 42,
      authResumeGate: {
        status: 'fresh_read_required',
        targetTabId: 42,
        blocksTaskResume: true,
      },
    });
  });

  it('does not block chrome_read_page when auth resume verification is required', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteAuthResumeVerification({
      status: 'fresh_read_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.READ_PAGE,
      args: { tabId: 42, forceRefresh: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('not_impact_tool');
  });

  it('does not let a stale auth resume gate block opening a new run-owned tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteAuthResumeVerification({
      status: 'fresh_read_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.NAVIGATE,
      args: { url: 'https://example.test/new-task' },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('new_run_owned_tab');
  });

  it('allows impact actions after the auth resume gate is cleared', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteAuthResumeVerification({
      status: 'fresh_read_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent'],
      claimBoundary: 'deterministic auth resume fixture only',
    });
    ctx.noteAuthResumeVerification(null);

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#search', value: 'poster' },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('run_owned_tab');
  });

  it('blocks continuation actions when the matching-tab business postcondition failed', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'failed',
            reason: 'result_collection_unchanged_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:before'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_next_result', userConfirmed: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('previous business postcondition failed');
    expect(verdict.audit).toMatchObject({
      verdict: 'block',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_failed_stop',
        canResumeOriginalTask: false,
        nextStep: 'stop_not_proven',
      },
    });
  });

  it('requires fresh verification when the matching-tab business postcondition is unknown', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'result_collection_not_comparable',
            beforeSummary: [],
            afterSummary: [],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#q', value: 'poster', userConfirmed: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('forceRefresh=true');
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'verify_postcondition',
      },
    });
  });

  it('does not block cleanup or unrelated tabs with empty resume evidence', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRunOwnedTab(99);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_unknown',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'result_collection_not_comparable',
            beforeSummary: [],
            afterSummary: [],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    const cleanup = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLOSE_TABS,
      args: { tabIds: [42] },
      taskContext: ctx,
    });
    const unrelated = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 99, ref: 'ref_unrelated' },
      taskContext: ctx,
    });

    expect(cleanup.allowed).toBe(true);
    expect(cleanup.audit.reason).toBe('run_owned_tab');
    expect(unrelated.allowed).toBe(true);
    expect(unrelated.audit.reason).toBe('run_owned_tab');
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
