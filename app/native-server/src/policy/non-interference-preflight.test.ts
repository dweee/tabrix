import { TOOL_NAMES } from '@tabrix/shared';
import type { BrowserPageThingProjection } from '@tabrix/shared';
import {
  DEFAULT_AUTH_USER_COLLABORATION_STALE_AFTER_MS,
  TaskSessionContext,
} from '../execution/task-session-context';
import type { TaskPageRuntimeFields } from '../execution/task-session-context';
import { evaluateNonInterferencePreflight } from './non-interference-preflight';

function makeProjection(
  overrides: Partial<BrowserPageThingProjection> = {},
): BrowserPageThingProjection {
  return {
    projectionId: 'projection_initial',
    projectionKind: 'read_snapshot_projection',
    projectionCreatedAt: '2026-05-18T00:00:00.000Z',
    sourceObservedAt: '2026-05-18T00:00:00.000Z',
    sourceLineage: 'dom',
    regionEvidenceRefs: ['region:viewport'],
    pageId: 'page_test',
    tabId: 42,
    ownerType: 'run_owned',
    readiness: 'ready',
    stability: 'stable',
    contextVersion: 'projection_initial',
    previousContextVersion: null,
    changedByActionId: null,
    changeCause: 'unknown',
    activeRegion: 'viewport',
    changedRegions: ['viewport'],
    reusedRegions: [],
    invalidatedRefs: [],
    refreshedRefs: ['ref_1'],
    chosenDataSource: 'dom_json',
    sourceConfidence: 0.9,
    sourceFreshness: 'fresh',
    contextChars: 1000,
    contextSavedChars: 0,
    userActivityLevel: 'idle',
    interferenceRisk: 'low',
    ...overrides,
  };
}

function makeRuntimeFields(overrides: Partial<TaskPageRuntimeFields> = {}): TaskPageRuntimeFields {
  return {
    currentWindowId: null,
    currentWindowState: null,
    currentWindowWidth: null,
    currentWindowHeight: null,
    currentWindowLeft: null,
    currentWindowTop: null,
    isCurrentTabActive: null,
    isCurrentWindowFocused: null,
    browserActiveTabId: null,
    browserActiveTabIdKnown: false,
    isReadTargetBrowserActiveTab: null,
    currentTabUrl: null,
    currentTabPendingUrl: null,
    currentTabTitle: null,
    currentTabStatus: null,
    currentTabDiscarded: null,
    currentTabAudible: null,
    currentTabMuted: null,
    currentTabPinned: null,
    currentTabOpenerTabId: null,
    currentTabOpenedBy: null,
    currentTabOpenedBySource: null,
    currentTabOpenedByConfidence: null,
    currentTabOpenedByReason: null,
    currentTabAiOperationState: null,
    currentTabLastAiOperation: null,
    currentTabLastAiOperationAtMs: null,
    currentTabLastAiOperationConfidence: null,
    currentTabLastAiOperationReason: null,
    currentTabCanTabrixOperate: null,
    currentTabOperabilityReason: null,
    currentTabRuntimeStateSource: 'unknown',
    browserWorldObjectChangeSummary: null,
    browserWorldActionableObjectChangeSummary: null,
    browserWorldCurrentOperationConclusion: null,
    browserWorldRoutingDecisionSummary: null,
    currentPageLoadReadinessStatus: null,
    currentPageStability: null,
    currentPageSnapshotUsableForBusinessAction: null,
    currentPageLoadReadinessNextStepHint: null,
    ...overrides,
  };
}

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

  it('gates click/fill/keyboard when the latest same-tab page snapshot is not stable', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.notePageProjectionAndBuildDelta(
      makeProjection({ tabId: 42 }),
      makeRuntimeFields({
        currentPageLoadReadinessStatus: 'loading_after_wait',
        currentPageStability: 'loading',
        currentPageSnapshotUsableForBusinessAction: false,
      }),
    );

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_search_submit' },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('Run chrome_read_page with forceRefresh=true on tabId 42');
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_unknown_not_proven',
        nextStep: 'force_fresh_read_same_tab',
        evidenceKinds: ['page_load_readiness', 'page_stability'],
      },
    });
  });

  it('allows hover pointer recovery on a run-owned tab while impact actions remain gated', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.notePageProjectionAndBuildDelta(
      makeProjection({ tabId: 42 }),
      makeRuntimeFields({
        currentPageLoadReadinessStatus: 'loading_after_wait',
        currentPageStability: 'loading',
        currentPageSnapshotUsableForBusinessAction: false,
      }),
    );

    const hoverVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_outside_panel', interaction: 'hover' },
      taskContext: ctx,
    });
    const clickVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_outside_panel', interaction: 'click' },
      taskContext: ctx,
    });

    expect(hoverVerdict.allowed).toBe(true);
    expect(hoverVerdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'pointer_move_only',
      targetTabId: 42,
    });
    expect(clickVerdict.allowed).toBe(false);
    expect(clickVerdict.audit.reason).toBe('task_resume_readiness_not_proven');
  });

  it('allows explicit-tab hover recovery in default mode but not on a non-owned strict tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.notePageProjectionAndBuildDelta(
      makeProjection({ tabId: 42 }),
      makeRuntimeFields({
        currentPageLoadReadinessStatus: 'loading_after_wait',
        currentPageStability: 'loading',
        currentPageSnapshotUsableForBusinessAction: false,
      }),
    );

    const defaultVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_outside_panel', interaction: 'hover' },
      taskContext: ctx,
    });
    const strictVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_outside_panel',
        interaction: 'hover',
        nonInterferencePolicy: 'strict',
      },
      taskContext: ctx,
    });

    expect(defaultVerdict.allowed).toBe(true);
    expect(defaultVerdict.audit.reason).toBe('pointer_move_only');
    expect(strictVerdict.allowed).toBe(false);
    expect(strictVerdict.audit.reason).toBe('task_resume_readiness_not_proven');
  });

  it('does not use page-stability readiness to block new-tab navigation', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.notePageProjectionAndBuildDelta(
      makeProjection({ tabId: 42 }),
      makeRuntimeFields({
        currentPageLoadReadinessStatus: 'stale',
        currentPageStability: 'stale',
        currentPageSnapshotUsableForBusinessAction: false,
      }),
    );

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.NAVIGATE,
      args: { url: 'https://example.com' },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit.reason).toBe('new_run_owned_tab');
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
    expect(verdict.message).toContain('Run chrome_read_page with forceRefresh=true on tabId 42');
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'auth_resume_verification_required',
      targetTabId: 42,
      authResumeGate: {
        status: 'fresh_read_required',
        targetTabId: 42,
        blocksTaskResume: true,
      },
      taskResumeReadiness: {
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        handoffSummary: {
          status: 'needs_fresh_read',
          nextAction: 'run_chrome_read_page_force_refresh',
        },
      },
    });
    expect(verdict.message).toBe(verdict.audit.taskResumeReadiness?.handoffSummary.message);
  });

  it('allows an explicit QR refresh collaboration action while auth resume is blocked', () => {
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
      args: {
        tabId: 42,
        ref: 'ref_refresh_qr',
        candidateAction: {
          actionType: 'click',
          targetRef: 'ref_refresh_qr',
          intent: 'auth.refresh_qr',
        },
      },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'auth_collaboration_continuation_action',
      targetTabId: 42,
    });
  });

  it('allows explicit cleanup of run-owned tabs while auth resume still requires fresh verification', () => {
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
      toolName: TOOL_NAMES.BROWSER.CLOSE_TABS,
      args: { tabIds: [42] },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'run_owned_tab',
      targetTabIds: [42],
      runOwnedTabIds: [42],
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
    expect(verdict.message).toContain('Stop the original task on tabId 42');
    expect(verdict.audit).toMatchObject({
      verdict: 'block',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_failed_stop',
        canResumeOriginalTask: false,
        nextStep: 'stop_not_proven',
        handoffSummary: {
          status: 'stop_not_proven',
          nextAction: 'stop_and_report_not_proven',
        },
      },
    });
    expect(verdict.message).toBe(verdict.audit.taskResumeReadiness?.handoffSummary.message);
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
    expect(verdict.message).toContain(
      'Verify the business postcondition with fresh page evidence first',
    );
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'verify_postcondition',
        handoffSummary: {
          status: 'needs_postcondition_verification',
          nextAction: 'verify_business_postcondition',
        },
      },
    });
    expect(verdict.message).toBe(verdict.audit.taskResumeReadiness?.handoffSummary.message);
  });

  it('allows run-owned search filter refinement when fresh readback still needs delta verification', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_filter_sort_latest',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'result_collection_not_comparable',
            beforeSummary: ['search_filters:open:sort=most_saved'],
            afterSummary: ['search_filters:open:sort=latest'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 42 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_filter_sort_latest',
        candidateAction: {
          id: 'ca_filter_sort_latest',
          actionType: 'click',
          targetRef: 'ref_filter_sort_latest',
          intent: 'search.apply_filter.sort',
        },
      },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'search_filter_refinement_action',
      targetTabId: 42,
      runOwnedTabIds: [42],
    });
  });

  it('allows default-mode explicit-tab search filter refinement after fresh readback still needs delta verification', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_filter_sort_latest',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'dom_region_rows_readback_required_for_resume',
            beforeSummary: ['filter_panel:active_filter_state_observed:before'],
            afterSummary: ['filter_panel:active_filter_state_observed:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_filter_sort_latest',
        candidateAction: {
          id: 'ca_filter_sort_latest',
          actionType: 'click',
          targetRef: 'ref_filter_sort_latest',
          intent: 'search.apply_filter.sort',
        },
      },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'search_filter_refinement_action',
      targetTabId: 42,
      runOwnedTabIds: [],
    });
  });

  it('allows same-tab form continuation after entering a query without claiming business success', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.notePageInteraction({
      action: 'chrome_fill_or_select',
      tabId: 42,
      candidateActionId: 'ca_fill_search',
      candidateActionIntent: 'search.enter_query',
      actionKind: 'fill',
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 42 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'force_fresh_read_same_tab',
      reason:
        'pending_business_verification_requires_fresh_read:form_value_state_changed:search.enter_query',
      handoffSummary: {
        status: 'needs_fresh_read',
        canContinue: false,
      },
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_search_submit',
        candidateAction: {
          id: 'ca_search_submit',
          intent: 'search.submit',
          targetRef: 'ref_search_submit',
        },
      },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'form_input_continuation_action',
      targetTabId: 42,
      runOwnedTabIds: [42],
    });
  });

  it('does not let form continuation bypass a failed business postcondition', () => {
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
      args: {
        tabId: 42,
        ref: 'ref_next_result',
        candidateAction: {
          id: 'ca_open_detail',
          intent: 'content.open_detail',
          targetRef: 'ref_next_result',
        },
      },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.audit).toMatchObject({
      verdict: 'block',
      reason: 'task_resume_readiness_not_proven',
      targetTabId: 42,
      taskResumeReadiness: {
        status: 'postcondition_failed_stop',
        nextStep: 'stop_not_proven',
      },
    });
  });

  it('allows corrective search actions after a failed search postcondition on the same explicit tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'failed',
            reason: 'result_collection_not_visible_after',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:absent'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    const focusVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        selector: '#q',
        candidateAction: { intent: 'search.focus_input' },
      },
      taskContext: ctx,
    });
    const submitVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.KEYBOARD,
      args: {
        tabId: 42,
        key: 'Enter',
        candidateAction: { intent: 'search.submit' },
      },
      taskContext: ctx,
    });

    expect(focusVerdict.allowed).toBe(true);
    expect(focusVerdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'corrective_search_continuation_action',
      targetTabId: 42,
    });
    expect(submitVerdict.allowed).toBe(true);
    expect(submitVerdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'corrective_search_continuation_action',
      targetTabId: 42,
    });
  });

  it('uses the handoff summary when auth resume is waiting for user collaboration', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteAuthResumeVerification({
      status: 'required_after_user_action',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: false,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: false,
      requiredSignals: ['user_action_completed'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#q', value: 'poster', userConfirmed: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('waiting for user collaboration on tabId 42');
    expect(verdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'auth_resume_verification_required',
      targetTabId: 42,
      authResumeGate: {
        status: 'required_after_user_action',
        targetTabId: 42,
        blocksTaskResume: true,
      },
      taskResumeReadiness: {
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'wait_for_user_collaboration',
        handoffSummary: {
          status: 'waiting_for_user',
          nextAction: 'wait_for_user_collaboration',
        },
      },
    });
    expect(verdict.message).toBe(verdict.audit.taskResumeReadiness?.handoffSummary.message);
  });

  it('blocks impact actions when auth resume handoff says stop_not_proven', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteAuthResumeVerification({
      status: 'not_proven',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: false,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: false,
      requiredSignals: ['auth_prompt_absent'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    const verdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: { tabId: 42, ref: 'ref_continue', userConfirmed: true },
      taskContext: ctx,
    });

    expect(verdict.allowed).toBe(false);
    expect(verdict.message).toContain('Stop the original task on tabId 42');
    expect(verdict.audit).toMatchObject({
      verdict: 'block',
      reason: 'auth_resume_verification_required',
      targetTabId: 42,
      authResumeGate: {
        status: 'not_proven',
        targetTabId: 42,
        blocksTaskResume: true,
      },
      taskResumeReadiness: {
        status: 'blocked_by_auth_verification',
        canResumeOriginalTask: false,
        nextStep: 'stop_not_proven',
        handoffSummary: {
          status: 'stop_not_proven',
          nextAction: 'stop_and_report_not_proven',
        },
      },
    });
    expect(verdict.message).toBe(verdict.audit.taskResumeReadiness?.handoffSummary.message);
  });

  it('allows continuation after a fresh matching-tab postcondition proves the original task can resume', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_unknown_before_refresh',
            kind: 'login_completed',
            verdict: 'unknown',
            reason: 'auth_state_not_comparable',
            beforeSummary: [],
            afterSummary: [],
            producedAtMs: 1000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(
      evaluateNonInterferencePreflight({
        toolName: TOOL_NAMES.BROWSER.FILL,
        args: { tabId: 42, selector: '#q', value: 'poster', userConfirmed: true },
        taskContext: ctx,
      }).allowed,
    ).toBe(false);

    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_auth_submit_after_refresh',
            kind: 'login_completed',
            verdict: 'passed',
            reason: 'account_region_appeared_after_auth_prompt',
            beforeSummary: ['auth_surface:visible'],
            afterSummary: ['account:visible', 'auth_surface:absent'],
            producedAtMs: 2000,
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

    expect(verdict.allowed).toBe(true);
    expect(verdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'user_confirmed',
    });
    expect(ctx.buildTaskResumeReadiness({ tabId: 42 })).toMatchObject({
      status: 'postcondition_passed_ready',
      canResumeOriginalTask: true,
      nextStep: 'continue_original_task',
    });
  });

  it('blocks impact actions during OTP wait and allows them after fresh login completion proof', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    const producedAtMs = Date.now();
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_request_otp',
            kind: 'otp_requested',
            verdict: 'passed',
            reason: 'otp_request_waiting_for_user_evidence_after_action',
            beforeSummary: ['form:ready_to_request_otp'],
            afterSummary: ['form:waiting_for_user_otp'],
            producedAtMs,
            claimBoundary: 'deterministic OTP request fixture only',
          },
        },
      ],
    });

    const waitingVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#q', value: 'poster', userConfirmed: true },
      taskContext: ctx,
    });

    expect(waitingVerdict.allowed).toBe(false);
    expect(waitingVerdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      taskResumeReadiness: {
        status: 'blocked_by_auth_verification',
        nextStep: 'wait_for_user_collaboration',
      },
    });

    const submitVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_auth_submit',
        candidateAction: {
          id: 'ca_auth_submit',
          actionType: 'click',
          targetRef: 'ref_auth_submit',
          intent: 'auth.submit_login',
        },
      },
      taskContext: ctx,
    });

    expect(submitVerdict.allowed).toBe(true);
    expect(submitVerdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'auth_resume_completion_action',
    });

    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_auth_submit',
            kind: 'login_completed',
            verdict: 'passed',
            reason: 'account_region_appeared_after_auth_prompt',
            beforeSummary: ['auth_surface:visible', 'form:waiting_for_user_otp'],
            afterSummary: ['account:visible', 'auth_surface:absent'],
            producedAtMs: producedAtMs + 1000,
            claimBoundary: 'deterministic login completion fixture only',
          },
        },
      ],
    });

    const resumedVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.FILL,
      args: { tabId: 42, selector: '#q', value: 'poster', userConfirmed: true },
      taskContext: ctx,
    });

    expect(resumedVerdict.allowed).toBe(true);
    expect(resumedVerdict.audit).toMatchObject({
      verdict: 'allow',
      reason: 'user_confirmed',
    });
    expect(ctx.buildTaskResumeReadiness({ tabId: 42 })).toMatchObject({
      status: 'postcondition_passed_ready',
      evidenceKinds: ['region_state_postcondition', 'user_collaboration_resolved'],
    });
  });

  it('blocks auth submit when OTP user-collaboration wait evidence is stale', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRunOwnedTab(42);
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 42,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_request_otp',
            kind: 'otp_requested',
            verdict: 'passed',
            reason: 'otp_request_waiting_for_user_evidence_after_action',
            beforeSummary: ['form:ready_to_request_otp'],
            afterSummary: ['form:waiting_for_user_otp'],
            producedAtMs: Date.now() - DEFAULT_AUTH_USER_COLLABORATION_STALE_AFTER_MS - 1,
            claimBoundary: 'deterministic OTP request fixture only',
          },
        },
      ],
    });

    const submitVerdict = evaluateNonInterferencePreflight({
      toolName: TOOL_NAMES.BROWSER.CLICK,
      args: {
        tabId: 42,
        ref: 'ref_auth_submit',
        candidateAction: {
          id: 'ca_auth_submit',
          actionType: 'click',
          targetRef: 'ref_auth_submit',
          intent: 'auth.submit_login',
        },
      },
      taskContext: ctx,
    });

    expect(submitVerdict.allowed).toBe(false);
    expect(submitVerdict.message).toContain('Run chrome_read_page with forceRefresh=true');
    expect(submitVerdict.audit).toMatchObject({
      verdict: 'collaboration_required',
      reason: 'task_resume_readiness_not_proven',
      taskResumeReadiness: {
        status: 'postcondition_unknown_not_proven',
        nextStep: 'force_fresh_read_same_tab',
        evidenceKinds: [
          'region_state_postcondition',
          'user_collaboration_required',
          'stale_user_collaboration',
        ],
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
