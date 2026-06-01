/**
 * V26-05 (B-028) — TaskSessionContext unit tests.
 *
 * Covers the read-budget gate, layer suggestion, URL/pageRole
 * invalidation, env override, and defensive parsing — see
 * `docs/PRODUCT_BACKLOG.md` B-028 acceptance criteria.
 */

import {
  DEFAULT_READ_BUDGET_PER_TASK,
  TaskSessionContext,
  resolveReadBudgetFromEnv,
} from './task-session-context';
import type { TaskVisibleRegionRowsData } from './task-session-context';
import type { ChooseContextDecisionSnapshot } from './skip-read-orchestrator';
import type {
  BrowserPageThingProjection,
  ReadPageObjectLifecycleSummary,
  ReadPageRegion,
} from '@tabrix/shared';

function makeVisibleRegionRows(
  start: number,
  count: number,
  options: { sourceTabId?: number | null; sourceRegion?: string; includeText?: boolean } = {},
): TaskVisibleRegionRowsData {
  const includeText = options.includeText ?? true;
  const rows = Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return {
      rowId: `row_${n}`,
      title: includeText ? `Result ${n}` : '',
      primaryText: includeText ? `Result ${n} summary` : null,
      secondaryText: null,
      metaText: null,
      interactionText: 'Open',
      targetRef: `ref_${n}`,
      sourceRegion: options.sourceRegion ?? 'result_list',
      confidence: 0.9,
    };
  });
  return {
    available: true,
    rowCount: rows.length,
    confidence: 0.92,
    targetRefCoverageRate: 1,
    regionQualityScore: 0.9,
    sourceDataSource: 'dom_region_rows',
    sourceTabId: options.sourceTabId ?? 7,
    rows,
    visibleRegionRowsUsed: true,
    visibleRegionRowsRejectedReason: null,
    sourceRegion: options.sourceRegion ?? 'result_list',
    rowExtractionConfidence: 0.92,
    cardExtractorUsed: true,
    cardPatternConfidence: 0.88,
    cardRowsCount: rows.length,
    rowOrder: 'visual_order',
  };
}

describe('resolveReadBudgetFromEnv', () => {
  it('returns the default when the env key is unset', () => {
    expect(resolveReadBudgetFromEnv({})).toBe(DEFAULT_READ_BUDGET_PER_TASK);
  });

  it('respects positive integer overrides', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '10' })).toBe(10);
  });

  it('caps absurd values at the hard cap (100)', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '5000' })).toBe(100);
  });

  it('falls back to the default for non-positive / non-integer / NaN inputs', () => {
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '0' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '-3' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '3.5' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: 'banana' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
    expect(resolveReadBudgetFromEnv({ TABRIX_READ_BUDGET_PER_TASK: '   ' })).toBe(
      DEFAULT_READ_BUDGET_PER_TASK,
    );
  });
});

describe('TaskSessionContext — first read on a virgin task', () => {
  it('allows the first read and suggests L0+L1 regardless of requestedLayer', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    // V4.1 §0.1 hard rule — first read must START at L0+L1, never
    // straight at L0+L1+L2 even if the caller asked for it.
    expect(decision.suggestedLayer).toBe('L0+L1');
    expect(decision.readPageCount).toBe(0);
    expect(decision.readBudget).toBe(6);
  });

  it('keeps suggestedLayer=L0+L1 even when caller requests bare L0', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0' });
    expect(decision.allowed).toBe(true);
    expect(decision.suggestedLayer).toBe('L0+L1');
  });
});

describe('TaskSessionContext — budget enforcement', () => {
  it('denies the read once readPageCount reaches readBudget', () => {
    const ctx = new TaskSessionContext({ readBudget: 2 });
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('read_budget_exceeded');
    expect(decision.readPageCount).toBe(2);
    expect(decision.readBudget).toBe(2);
  });

  it('failed reads (those that never call noteReadPage) do not consume budget', () => {
    const ctx = new TaskSessionContext({ readBudget: 2 });
    // Caller asked but the bridge said "no" — never invoked
    // noteReadPage. Budget must stay at 0.
    ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(true);
    expect(decision.readPageCount).toBe(0);
  });

  it('respects an explicit readBudget option override', () => {
    const ctx = new TaskSessionContext({ readBudget: 1 });
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    expect(ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' }).allowed).toBe(false);
  });

  it('throws on a non-positive explicit budget (programmer error)', () => {
    expect(() => new TaskSessionContext({ readBudget: 0 })).toThrow(/positive integer/);
    expect(() => new TaskSessionContext({ readBudget: -1 })).toThrow(/positive integer/);
    expect(() => new TaskSessionContext({ readBudget: 1.5 })).toThrow(/positive integer/);
  });

  it('caps explicit budget overrides at the hard cap (100)', () => {
    const ctx = new TaskSessionContext({ readBudget: 9999 });
    expect(ctx.readBudget).toBe(100);
  });

  it('reads the env override when no explicit budget is supplied', () => {
    const ctx = new TaskSessionContext({ env: { TABRIX_READ_BUDGET_PER_TASK: '4' } });
    expect(ctx.readBudget).toBe(4);
  });
});

describe('TaskSessionContext — redundancy + layer demotion', () => {
  it('flags a same-layer same-page repeat as read_redundant (still allowed)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello/issues', 'github_issues_list');
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('read_redundant');
    expect(decision.suggestedLayer).toBe('L0+L1');
  });

  it('allows a same-layer read when the request shape changes', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/app', 'web_page');
    ctx.noteReadPage({
      layer: 'L0+L1+L2',
      source: 'dom_json',
      requestKey: 'mode=compact|depth=4',
    });
    const decision = ctx.shouldAllowReadPage({
      requestedLayer: 'L0+L1+L2',
      requestKey: 'mode=normal|depth=8',
    });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    expect(decision.suggestedLayer).toBe('L0+L1+L2');
  });

  it('allows a same-shape read when forceRefresh is requested', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/login', 'login_required');
    ctx.noteReadPage({
      layer: 'L0+L1+L2',
      source: 'dom_json',
      requestKey: 'auth-flow-read',
    });

    const cachedDecision = ctx.shouldAllowReadPage({
      requestedLayer: 'L0+L1+L2',
      requestKey: 'auth-flow-read',
    });
    expect(cachedDecision.reason).toBe('read_redundant');

    const freshDecision = ctx.shouldAllowReadPage({
      requestedLayer: 'L0+L1+L2',
      requestKey: 'auth-flow-read',
      forceRefresh: true,
    });
    expect(freshDecision.allowed).toBe(true);
    expect(freshDecision.reason).toBe('');
    expect(freshDecision.suggestedLayer).toBe('L0+L1+L2');
  });

  it('flags L0+L1+L2 → L0+L1 as layer_demotion (still allowed)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello/issues', 'github_issues_list');
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('layer_demotion');
  });

  it('escalation L0+L1 → L0+L1+L2 is allowed without flag', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/octocat/hello', null);
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
  });

  it('allows a fresh read after a successful page interaction', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://github.com/search?q=ACP&type=repositories', 'search_results');
    ctx.noteReadPage({
      layer: 'L0+L1',
      source: 'dom_region_rows',
      targetRefs: ['ref_1'],
    });
    expect(ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' }).reason).toBe('read_redundant');

    ctx.notePageInteraction({ action: 'chrome_keyboard', tabId: 9 });

    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    expect(decision.suggestedLayer).toBe('L0+L1');
    expect(ctx.targetRefsSeen.size).toBe(0);
    expect(ctx.peekChooseContextDecision()).toBeNull();
    expect(ctx.peekVisibleRegionRows()).toBeNull();
  });
});

describe('TaskSessionContext — auth resume gate', () => {
  it('records a blocking gate when auth resume requires a fresh same-tab read', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const gate = ctx.noteAuthResumeVerification({
      status: 'fresh_read_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent', 'account_region_present'],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    expect(gate).toMatchObject({
      status: 'fresh_read_required',
      forceRefreshRequired: true,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: true,
      blocksTaskResume: true,
      nextStepHint: 'fresh_read_same_tab_then_postcondition',
      reason: 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read',
    });
    expect(ctx.peekLastAuthResumeGate()).toEqual(gate);
  });

  it('clears the auth resume gate on navigation so stale login gates do not leak pages', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/login', 'auth');
    ctx.noteAuthResumeVerification({
      status: 'postcondition_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: false,
      sameTabRequired: true,
      targetTabId: 7,
      postconditionRequired: true,
      requiredSignals: ['auth_prompt_absent'],
      claimBoundary: 'deterministic auth resume fixture only',
    });
    expect(ctx.peekLastAuthResumeGate()).not.toBeNull();

    ctx.noteUrlChange('https://example.test/search', 'search_results');
    expect(ctx.peekLastAuthResumeGate()).toBeNull();
  });

  it('does not block task resume when auth resume verification is explicitly not required', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const gate = ctx.noteAuthResumeVerification({
      status: 'not_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: false,
      sameTabRequired: true,
      targetTabId: 42,
      postconditionRequired: false,
      requiredSignals: [],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    expect(gate).toMatchObject({
      status: 'not_required',
      sameTabRequired: true,
      blocksTaskResume: false,
      nextStepHint: 'resume_allowed',
      reason: 'auth_resume_not_required',
    });
  });

  it('turns a blocking auth gate into a resume-readiness stop signal', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
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

    expect(ctx.buildTaskResumeReadiness({ tabId: 42 })).toMatchObject({
      status: 'blocked_by_auth_verification',
      canResumeOriginalTask: false,
      nextStep: 'force_fresh_read_same_tab',
      tabId: 42,
      evidenceKinds: ['auth_resume_gate'],
      reason: 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read',
    });
  });

  it('blocks resume when an auth gate targets a different tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteAuthResumeVerification({
      status: 'not_required',
      nextTool: 'chrome_read_page',
      forceRefreshRequired: false,
      sameTabRequired: true,
      targetTabId: 7,
      postconditionRequired: false,
      requiredSignals: [],
      claimBoundary: 'deterministic auth resume fixture only',
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'blocked_by_auth_verification',
      canResumeOriginalTask: false,
      nextStep: 'force_fresh_read_same_tab',
      evidenceKinds: ['auth_resume_gate', 'tab_binding_mismatch'],
      reason: 'auth_resume_gate_target_tab_mismatch',
    });
  });
});

describe('TaskSessionContext — URL / pageRole invalidation', () => {
  it('URL change resets lastReadLayer + targetRefsSeen so a follow-up read is "first" again', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a.example/x', 'role_a');
    ctx.noteReadPage({
      layer: 'L0+L1+L2',
      source: 'dom_json',
      targetRefs: ['tgt_aaaa1111aa'],
    });
    expect(ctx.targetRefsSeen.has('tgt_aaaa1111aa')).toBe(true);
    ctx.noteUrlChange('https://b.example/y', 'role_a');
    expect(ctx.lastReadLayer).toBeNull();
    expect(ctx.targetRefsSeen.size).toBe(0);
    const decision = ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1+L2' });
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('');
    expect(decision.suggestedLayer).toBe('L0+L1');
  });

  it('pageRole change on the same URL also invalidates lastReadLayer', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example/dashboard', 'role_one');
    ctx.noteReadPage({ layer: 'L0+L1+L2', source: 'dom_json' });
    ctx.noteUrlChange('https://example/dashboard', 'role_two');
    expect(ctx.lastReadLayer).toBeNull();
  });

  it('idempotent same-URL same-pageRole call is a no-op', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example/x', 'role_a');
    ctx.noteReadPage({ layer: 'L0+L1', source: 'dom_json' });
    ctx.noteUrlChange('https://example/x', 'role_a');
    expect(ctx.lastReadLayer).toBe('L0+L1');
  });

  it('apiEndpointFamiliesSeen survives URL changes (Knowledge is URL-agnostic)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a/x', 'role_a');
    ctx.noteReadPage({
      layer: 'L0+L1',
      source: 'knowledge_api',
      apiFamilies: ['github_issues'],
    });
    ctx.noteUrlChange('https://b/y', 'role_b');
    expect(ctx.apiEndpointFamiliesSeen.has('github_issues')).toBe(true);
  });

  it('coerces empty / whitespace URLs and pageRoles to null', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('', '');
    expect(ctx.currentUrl).toBeNull();
    expect(ctx.pageRole).toBeNull();
  });
});

describe('TaskSessionContext — noteReadPage hygiene', () => {
  it('accumulates targetRefs and rejects empty/non-string entries defensively', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteReadPage({
      layer: 'L0+L1',
      source: 'dom_json',
      targetRefs: ['tgt_one', '', 'tgt_two', null as unknown as string, 'tgt_one'],
    });
    expect(Array.from(ctx.targetRefsSeen).sort()).toEqual(['tgt_one', 'tgt_two']);
  });

  it('handles null/undefined ref + family arrays without throwing', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    expect(() =>
      ctx.noteReadPage({ layer: 'L0', source: 'dom_json', targetRefs: null, apiFamilies: null }),
    ).not.toThrow();
    expect(ctx.readPageCount).toBe(1);
  });
});

describe('TaskSessionContext — DOM region rows top-N accumulation', () => {
  it('dedupes overlapping reads and only marks default top-N ready after ten targetable unique rows', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });

    const first = ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 6));
    expect(first).toMatchObject({
      status: 'partial_accumulated_rows',
      observedReadCount: 1,
      currentReadReliableRowCount: 6,
      currentReadTargetableRowCount: 6,
      currentReadNewUniqueRowCount: 6,
      duplicateReliableRowCount: 0,
      uniqueReliableRowCount: 6,
      uniqueTargetableRowCount: 6,
      uniqueSummarizableRowCount: 6,
      canSatisfyDefaultTopN: false,
      canSupportDefaultTopNSummary: false,
      missingRowCountForDefaultTopN: 4,
      missingSummarizableRowCountForDefaultTopN: 4,
    });

    const second = ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(5, 6));
    expect(second).toMatchObject({
      status: 'ready_for_default_top_n',
      observedReadCount: 2,
      currentReadReliableRowCount: 6,
      currentReadTargetableRowCount: 6,
      currentReadNewUniqueRowCount: 4,
      duplicateReliableRowCount: 2,
      uniqueReliableRowCount: 10,
      uniqueTargetableRowCount: 10,
      uniqueSummarizableRowCount: 10,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: true,
      missingRowCountForDefaultTopN: 0,
      missingSummarizableRowCountForDefaultTopN: 0,
      nextRequiredCheck: 'accumulated_rows_ready_for_top_n_summary',
      summaryNextRequiredCheck: 'top_n_summary_ready',
    });
  });

  it('does not mark default top-N summary ready when targetable rows lack readable text', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });

    const evidence = ctx.noteDomRegionRowsReadback(
      makeVisibleRegionRows(1, 10, { includeText: false }),
    );

    expect(evidence).toMatchObject({
      status: 'ready_for_default_top_n',
      uniqueTargetableRowCount: 10,
      uniqueSummarizableRowCount: 0,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: false,
      missingRowCountForDefaultTopN: 0,
      missingSummarizableRowCountForDefaultTopN: 10,
      summaryNextRequiredCheck: 'more_rows_or_text_fields_required_before_top_n_summary',
    });
  });

  it('resets accumulated DOM rows on navigation and page interactions', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/search?q=one', 'search_results');
    expect(ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 6))).toMatchObject({
      uniqueTargetableRowCount: 6,
      observedReadCount: 1,
    });

    ctx.noteUrlChange('https://example.test/search?q=two', 'search_results');
    expect(ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 2))).toMatchObject({
      uniqueTargetableRowCount: 2,
      observedReadCount: 1,
    });

    ctx.notePageInteraction({ action: 'chrome_keyboard', tabId: 7 });
    expect(ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(8, 2))).toMatchObject({
      uniqueTargetableRowCount: 2,
      observedReadCount: 1,
    });
  });

  it('exposes a cloned same-tab top-N readback snapshot for closeout evidence', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });

    expect(ctx.peekDomRegionRowsReadbackAccumulationEvidence()).toBeNull();
    ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 6, { sourceTabId: 7 }));
    ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(7, 4, { sourceTabId: 7 }));

    const snapshot = ctx.peekDomRegionRowsReadbackAccumulationEvidence({ tabId: 7 });
    expect(snapshot).toMatchObject({
      status: 'ready_for_default_top_n',
      sourceTabId: 7,
      sourceRegion: 'result_list',
      observedReadCount: 2,
      uniqueTargetableRowCount: 10,
      uniqueSummarizableRowCount: 10,
      canSatisfyDefaultTopN: true,
      canSupportDefaultTopNSummary: true,
      missingRowCountForDefaultTopN: 0,
      missingSummarizableRowCountForDefaultTopN: 0,
    });
    expect(ctx.peekDomRegionRowsReadbackAccumulationEvidence({ tabId: 8 })).toBeNull();

    snapshot!.uniqueTargetableRowCount = 0;
    expect(ctx.peekDomRegionRowsReadbackAccumulationEvidence({ tabId: 7 })).toMatchObject({
      uniqueTargetableRowCount: 10,
    });
  });

  it('filters top-N readback snapshots by source region and clears them after navigation', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteDomRegionRowsReadback(
      makeVisibleRegionRows(1, 3, { sourceTabId: 7, sourceRegion: 'result_list' }),
    );

    expect(
      ctx.peekDomRegionRowsReadbackAccumulationEvidence({
        tabId: 7,
        sourceRegion: 'result_list',
      }),
    ).toMatchObject({ uniqueTargetableRowCount: 3 });
    expect(
      ctx.peekDomRegionRowsReadbackAccumulationEvidence({
        tabId: 7,
        sourceRegion: 'sidebar',
      }),
    ).toBeNull();

    ctx.noteUrlChange('https://example.test/search?q=changed', 'search_results');
    expect(ctx.peekDomRegionRowsReadbackAccumulationEvidence({ tabId: 7 })).toBeNull();
  });
});

const REPLAY_DECISION_FOR_CTX: ChooseContextDecisionSnapshot = Object.freeze({
  sourceRoute: 'experience_replay_skip_read',
  chosenLayer: 'L0',
  fullReadTokenEstimate: 4096,
  replayCandidate: { actionPathId: 'ap_session_001', portableArgsOk: true, policyOk: true },
});

describe('TaskSessionContext — V26-03 noteSkipRead + taskTotals', () => {
  it('starts with zeroed taskTotals (honest counters)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 0,
      tokensSavedEstimateTotal: 0,
    });
  });

  it('noteSkipRead increments readPageAvoidedCount and folds tokensSavedEstimate', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteSkipRead({
      source: 'experience_replay',
      layer: 'L0',
      tokensSavedEstimate: 4096,
      actionPathId: 'ap_a',
    });
    ctx.noteSkipRead({
      source: 'api_list',
      layer: 'L0+L1',
      tokensSavedEstimate: 2048,
      apiFamily: 'github_search_repositories',
    });
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 2,
      tokensSavedEstimateTotal: 6144,
    });
    // The shim's V26-08 redundancy detector relies on this fold-in.
    expect(ctx.apiEndpointFamiliesSeen.has('github_search_repositories')).toBe(true);
  });

  it('noteSkipRead does NOT consume the per-task read budget (that is the point)', () => {
    const ctx = new TaskSessionContext({ readBudget: 2 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: 100 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: 100 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: 100 });
    expect(ctx.readPageCount).toBe(0);
    expect(ctx.shouldAllowReadPage({ requestedLayer: 'L0+L1' }).allowed).toBe(true);
  });

  it('clamps negative / NaN / Infinity tokensSavedEstimate to 0 (honest budget)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: -1 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: Number.NaN });
    ctx.noteSkipRead({
      source: 'experience_replay',
      layer: 'L0',
      tokensSavedEstimate: Number.POSITIVE_INFINITY,
    });
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 3,
      tokensSavedEstimateTotal: 0,
    });
  });

  it('getTaskTotals returns a fresh object so callers cannot mutate the running totals', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteSkipRead({ source: 'experience_replay', layer: 'L0', tokensSavedEstimate: 100 });
    const snap = ctx.getTaskTotals();
    snap.readPageAvoidedCount = 99;
    snap.tokensSavedEstimateTotal = 99;
    expect(ctx.getTaskTotals()).toEqual({
      readPageAvoidedCount: 1,
      tokensSavedEstimateTotal: 100,
    });
  });
});

describe('TaskSessionContext — V26-03 noteChooseContextDecision (correction #3 data flow)', () => {
  it('peekChooseContextDecision returns null before the chooser writes one', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    expect(ctx.peekChooseContextDecision()).toBeNull();
  });

  it('records and surfaces the most recent chooser decision', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteChooseContextDecision(REPLAY_DECISION_FOR_CTX);
    expect(ctx.peekChooseContextDecision()).toBe(REPLAY_DECISION_FOR_CTX);
  });

  it('does NOT clear the decision on peek (multiple reads of the same page consult the same decision)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteChooseContextDecision(REPLAY_DECISION_FOR_CTX);
    ctx.peekChooseContextDecision();
    expect(ctx.peekChooseContextDecision()).toBe(REPLAY_DECISION_FOR_CTX);
  });

  it('noteChooseContextDecision(null) clears the recorded decision', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteChooseContextDecision(REPLAY_DECISION_FOR_CTX);
    ctx.noteChooseContextDecision(null);
    expect(ctx.peekChooseContextDecision()).toBeNull();
  });

  it('noteUrlChange invalidates the prior decision (a different page is a different decision)', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a.example/x', 'role_a');
    ctx.noteChooseContextDecision(REPLAY_DECISION_FOR_CTX);
    expect(ctx.peekChooseContextDecision()).not.toBeNull();
    ctx.noteUrlChange('https://b.example/y', 'role_a');
    expect(ctx.peekChooseContextDecision()).toBeNull();
  });

  it('idempotent same-URL noteUrlChange does NOT clobber a recorded decision', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://a.example/x', 'role_a');
    ctx.noteChooseContextDecision(REPLAY_DECISION_FOR_CTX);
    ctx.noteUrlChange('https://a.example/x', 'role_a');
    expect(ctx.peekChooseContextDecision()).toBe(REPLAY_DECISION_FOR_CTX);
  });
});

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
    tabId: 9,
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

describe('TaskSessionContext — V28 lifecycle timeline', () => {
  it('records ordered navigation, projection, delta, ref, and cleanup events', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/search', 'search_page');
    ctx.notePageProjectionAndBuildDelta(makeProjection());
    ctx.noteCleanup({ action: 'chrome_close_tabs', targetIds: [9] });

    const timeline = ctx.getLifecycleTimeline();
    expect(timeline.map((event) => event.kind)).toEqual([
      'navigation',
      'readiness_observed',
      'projection_created',
      'region_changed',
      'refs_refreshed',
      'delta_created',
      'cleanup',
    ]);
    expect(timeline.map((event) => event.index)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(timeline[0]).toMatchObject({
      url: 'https://example.test/search',
      pageRole: 'search_page',
    });
    expect(timeline[5]).toMatchObject({
      projectionId: 'projection_initial',
      changedRegions: ['viewport'],
      refreshedRefs: ['ref_1'],
    });
    expect(timeline[6]).toMatchObject({
      cleanupAction: 'chrome_close_tabs',
      cleanupTargetIds: [9],
    });
  });

  it('keeps lifecycle timeline snapshots immutable to callers', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/a', 'page');
    const [event] = ctx.getLifecycleTimeline();
    event.changedRegions = ['mutated'];
    event.cleanupTargetIds = [123];

    expect(ctx.getLifecycleTimeline()[0]).toMatchObject({
      kind: 'navigation',
      changedRegions: undefined,
      cleanupTargetIds: undefined,
    });
  });

  it('records interaction invalidation without discarding delta baseline', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteUrlChange('https://example.test/search', 'search_page');
    ctx.notePageProjectionAndBuildDelta(makeProjection());
    ctx.notePageInteraction({ action: 'chrome_keyboard', tabId: 9 });

    const delta = ctx.notePageProjectionAndBuildDelta(
      makeProjection({
        projectionId: 'projection_after_scroll',
        contextVersion: 'projection_after_scroll',
        previousContextVersion: 'projection_initial',
        changedByActionId: 'chrome_keyboard',
        changeCause: 'pagination',
        contextChars: 900,
        contextSavedChars: 100,
      }),
    );

    expect(delta.deltaKind).toBe('post_action_delta');
    expect(delta.fromProjectionId).toBe('projection_initial');
    expect(delta.toProjectionId).toBe('projection_after_scroll');
    expect(ctx.getLifecycleTimeline().map((event) => event.kind)).toContain('refs_invalidated');
  });

  it('carries pending interaction metadata once for the matching tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const beforeRegion = makeRegion('region_results_before', 'content_list', 'loaded');
    ctx.notePageRegionsForPostcondition({
      tabId: 9,
      pageRegions: [beforeRegion],
    });
    ctx.notePageInteraction({
      action: 'chrome_click_element',
      tabId: 9,
      changeCause: 'click',
      targetRefs: ['ref_menu', 'button.primary', 'ref_menu', 'bad ref with spaces'],
      candidateActionId: 'ca_search_submit',
      candidateActionIntent: 'search.submit',
      actionKind: 'click',
    });
    beforeRegion.state = 'mutated_by_caller';

    expect(ctx.consumePendingPageInteraction(8)).toBeNull();
    expect(ctx.consumePendingPageInteraction(9)).toEqual({
      action: 'chrome_click_element',
      tabId: 9,
      changeCause: 'click',
      targetRefs: ['ref_menu'],
      candidateActionId: 'ca_search_submit',
      candidateActionIntent: 'search.submit',
      actionKind: 'click',
      beforePageRegions: [makeRegion('region_results_before', 'content_list', 'loaded')],
    });
    expect(ctx.consumePendingPageInteraction(9)).toBeNull();
  });

  it('does not attach before-page regions from a different tab to a pending interaction', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.notePageRegionsForPostcondition({
      tabId: 7,
      pageRegions: [makeRegion('region_other_tab', 'content_list', 'loaded')],
    });
    ctx.notePageInteraction({
      action: 'chrome_click_element',
      tabId: 9,
      candidateActionId: 'ca_open_detail',
      candidateActionIntent: 'content.open_detail',
      actionKind: 'click',
    });

    expect(ctx.consumePendingPageInteraction(9)).toMatchObject({
      candidateActionId: 'ca_open_detail',
      candidateActionIntent: 'content.open_detail',
      actionKind: 'click',
      beforePageRegions: [],
    });
  });

  it('stores post-action region-state evidence for closeout on the matching tab only', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 7,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_other_tab',
            kind: 'detail_opened',
            verdict: 'passed',
            reason: 'detail_region_appeared',
            beforeSummary: ['content_list:loaded'],
            afterSummary: ['detail:loaded'],
            producedAtMs: 1000,
            claimBoundary: 'region-state evidence only',
            detailFieldReadbackEvidence: {
              kind: 'detail_field_readback',
              status: 'structured_fields_present',
              targetBindingProven: true,
              semanticMatch: 'matched',
              canSupportDetailSummary: true,
              fieldCounts: {
                totalStructuredObjects: 2,
                titleLikeObjects: 1,
                bodyLikeObjects: 1,
                metadataLikeObjects: 0,
                actionableObjects: 0,
              },
              nextRequiredCheck: 'detail_fields_ready_for_summary',
              claimBoundary: 'detail field readback fixture only',
            },
          },
        },
      ],
    });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 2000,
            claimBoundary: 'region-state evidence only',
          },
        },
      ],
    });

    const closeout = ctx.peekRegionStatePostconditionsForCloseout([9]);
    expect(closeout).toEqual([
      {
        tabId: 9,
        actionKind: 'click',
        result: expect.objectContaining({
          actionId: 'ca_search_submit',
          kind: 'search_results_updated',
          verdict: 'passed',
        }),
      },
    ]);

    closeout[0].result.afterSummary.push('mutated_by_caller');
    expect(ctx.peekRegionStatePostconditionsForCloseout([9])[0].result.afterSummary).toEqual([
      'content_list:loaded:after',
    ]);
    const detailCloseout = ctx.peekRegionStatePostconditionsForCloseout([7]);
    detailCloseout[0].result.detailFieldReadbackEvidence!.fieldCounts.totalStructuredObjects = 99;
    expect(
      ctx.peekRegionStatePostconditionsForCloseout([7])[0].result.detailFieldReadbackEvidence,
    ).toMatchObject({
      status: 'structured_fields_present',
      fieldCounts: {
        totalStructuredObjects: 2,
        titleLikeObjects: 1,
        bodyLikeObjects: 1,
      },
    });
  });

  it('allows original-task resume only when matching-tab region postcondition passed', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 10, { sourceTabId: 9 }));

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_passed_ready',
      canResumeOriginalTask: true,
      nextStep: 'continue_original_task',
      tabId: 9,
      evidenceKinds: ['region_state_postcondition', 'dom_region_rows_readback'],
      reason: 'region_state_search_results_updated_passed:result_collection_changed_after_action',
      handoffSummary: {
        summaryKind: 'task_resume_handoff_v1',
        status: 'ready_to_continue',
        canContinue: true,
        nextAction: 'continue_original_task',
        evidenceSummary: {
          readinessStatus: 'postcondition_passed_ready',
          tabId: 9,
          evidenceKinds: ['region_state_postcondition', 'dom_region_rows_readback'],
        },
      },
    });
    expect(ctx.buildTaskResumeReadiness({ tabId: 7 })).toMatchObject({
      status: 'not_proven',
      canResumeOriginalTask: false,
      reason: 'no_resume_or_business_postcondition_evidence',
    });
  });

  it('blocks search-task resume until DOM region rows readback can support default top-N', () => {
    const missingRows = new TaskSessionContext({ readBudget: 6 });
    missingRows.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_missing_rows',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(missingRows.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      evidenceKinds: ['region_state_postcondition', 'dom_region_rows_readback'],
      reason:
        'region_state_search_results_updated_not_proven:dom_region_rows_readback_required_for_resume',
    });

    const partialRows = new TaskSessionContext({ readBudget: 6 });
    partialRows.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_partial_rows',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    partialRows.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 6, { sourceTabId: 9 }));

    expect(partialRows.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      evidenceKinds: ['region_state_postcondition', 'dom_region_rows_readback'],
      reason:
        'region_state_search_results_updated_not_proven:dom_region_rows_readback_not_ready_for_default_top_n',
    });
  });

  it('blocks search-task resume when top-N row readback belongs to another tab', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_wrong_tab_rows',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 10, { sourceTabId: 7 }));

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      reason:
        'region_state_search_results_updated_not_proven:dom_region_rows_readback_tab_mismatch',
    });
  });

  it('allows detail-task resume only when detail readback is summary-ready', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_open_detail',
            kind: 'detail_opened',
            verdict: 'passed',
            reason: 'content_detail_region_semantic_match_after_action',
            beforeSummary: ['content:result_collection_candidate:before'],
            afterSummary: ['content:detail_open_candidate:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic detail resume fixture only',
            detailFieldReadbackEvidence: {
              kind: 'detail_field_readback',
              status: 'structured_fields_present',
              targetBindingProven: true,
              semanticMatch: 'matched',
              canSupportDetailSummary: true,
              fieldCounts: {
                totalStructuredObjects: 2,
                titleLikeObjects: 1,
                bodyLikeObjects: 1,
                metadataLikeObjects: 0,
                actionableObjects: 0,
              },
              nextRequiredCheck: 'detail_fields_ready_for_summary',
              claimBoundary: 'detail field readback fixture only',
            },
          },
        },
      ],
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_passed_ready',
      canResumeOriginalTask: true,
      nextStep: 'continue_original_task',
      evidenceKinds: ['region_state_postcondition'],
      reason: 'region_state_detail_opened_passed:content_detail_region_semantic_match_after_action',
    });
  });

  it('blocks detail-task resume when passed detail_opened lacks summary-ready readback evidence', () => {
    const missingEvidence = new TaskSessionContext({ readBudget: 6 });
    missingEvidence.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_open_detail_missing_readback',
            kind: 'detail_opened',
            verdict: 'passed',
            reason: 'content_detail_region_semantic_match_after_action',
            beforeSummary: ['content:result_collection_candidate:before'],
            afterSummary: ['content:detail_open_candidate:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic detail resume fixture only',
          },
        },
      ],
    });

    expect(missingEvidence.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      evidenceKinds: ['region_state_postcondition', 'detail_field_readback'],
      reason: 'region_state_detail_opened_not_proven:detail_field_readback_required_for_resume',
      handoffSummary: {
        status: 'needs_postcondition_verification',
        canContinue: false,
        nextAction: 'verify_business_postcondition',
      },
    });

    const metadataOnly = new TaskSessionContext({ readBudget: 6 });
    metadataOnly.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_open_detail_metadata_only',
            kind: 'detail_opened',
            verdict: 'passed',
            reason: 'content_detail_region_semantic_match_after_action',
            beforeSummary: ['content:result_collection_candidate:before'],
            afterSummary: ['content:detail_open_candidate:after'],
            producedAtMs: 1234,
            claimBoundary: 'deterministic detail resume fixture only',
            detailFieldReadbackEvidence: {
              kind: 'detail_field_readback',
              status: 'partial_fields_only',
              targetBindingProven: true,
              semanticMatch: 'matched',
              canSupportDetailSummary: false,
              fieldCounts: {
                totalStructuredObjects: 1,
                titleLikeObjects: 0,
                bodyLikeObjects: 0,
                metadataLikeObjects: 1,
                actionableObjects: 0,
              },
              nextRequiredCheck: 'fresh_detail_read_or_more_structured_fields_required',
              claimBoundary: 'detail field readback fixture only',
            },
          },
        },
      ],
    });

    expect(metadataOnly.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      evidenceKinds: ['region_state_postcondition', 'detail_field_readback'],
      reason: 'region_state_detail_opened_not_proven:detail_field_readback_not_ready_for_summary',
    });
  });

  it('requires a fresh same-tab read when a newer pending action has not been business-verified', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_passed',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    ctx.notePageInteraction({
      action: 'chrome_click_element',
      tabId: 9,
      candidateActionId: 'ca_open_detail',
      candidateActionIntent: 'content.open_detail',
      actionKind: 'click',
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'force_fresh_read_same_tab',
      tabId: 9,
      evidenceKinds: ['pending_page_interaction', 'business_verification_plan'],
      reason:
        'pending_business_verification_requires_fresh_read:detail_region_or_content_transition:content.open_detail',
      handoffSummary: {
        status: 'needs_fresh_read',
        canContinue: false,
        nextAction: 'run_chrome_read_page_force_refresh',
        evidenceSummary: {
          readinessStatus: 'postcondition_unknown_not_proven',
          tabId: 9,
          evidenceKinds: ['pending_page_interaction', 'business_verification_plan'],
        },
      },
    });
  });

  it('does not let a pending action on another tab block the current tab readiness', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.notePageInteraction({
      action: 'chrome_click_element',
      tabId: 9,
      candidateActionId: 'ca_open_detail',
      candidateActionIntent: 'content.open_detail',
      actionKind: 'click',
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 7 })).toMatchObject({
      status: 'not_proven',
      canResumeOriginalTask: false,
      reason: 'no_resume_or_business_postcondition_evidence',
      evidenceKinds: [],
    });
  });

  it('keeps original-task resume blocked when region postcondition is unknown or failed', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
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

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      reason: 'region_state_search_results_updated_not_proven:result_collection_not_comparable',
      handoffSummary: {
        status: 'needs_postcondition_verification',
        canContinue: false,
        nextAction: 'verify_business_postcondition',
      },
    });

    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_failed',
            kind: 'search_results_updated',
            verdict: 'failed',
            reason: 'result_collection_unchanged_after_action',
            beforeSummary: [],
            afterSummary: [],
            producedAtMs: 1235,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_failed_stop',
      canResumeOriginalTask: false,
      nextStep: 'stop_not_proven',
      reason: 'region_state_search_results_updated_failed:result_collection_unchanged_after_action',
      handoffSummary: {
        status: 'stop_not_proven',
        canContinue: false,
        nextAction: 'stop_and_report_not_proven',
      },
    });
  });

  it('uses the latest matching-tab region postcondition for resume while preserving closeout history', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_unknown_before_refresh',
            kind: 'search_results_updated',
            verdict: 'unknown',
            reason: 'result_collection_not_comparable',
            beforeSummary: [],
            afterSummary: [],
            producedAtMs: 1000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_unknown_not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
    });

    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_after_refresh',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 2000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    ctx.noteDomRegionRowsReadback(makeVisibleRegionRows(1, 10, { sourceTabId: 9 }));

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_passed_ready',
      canResumeOriginalTask: true,
      nextStep: 'continue_original_task',
      reason: 'region_state_search_results_updated_passed:result_collection_changed_after_action',
    });
    expect(ctx.peekRegionStatePostconditionsForCloseout([9])).toHaveLength(2);
  });

  it('lets a later failed postcondition block resume again after a prior pass', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_passed',
            kind: 'search_results_updated',
            verdict: 'passed',
            reason: 'result_collection_changed_after_action',
            beforeSummary: ['content_list:loaded:before'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 1000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });
    ctx.noteRegionStatePostconditionsForCloseout({
      tabId: 9,
      regionStatePostconditions: [
        {
          actionKind: 'click',
          result: {
            actionId: 'ca_search_submit_failed_after_retry',
            kind: 'search_results_updated',
            verdict: 'failed',
            reason: 'result_collection_unchanged_after_action',
            beforeSummary: ['content_list:loaded:after'],
            afterSummary: ['content_list:loaded:after'],
            producedAtMs: 2000,
            claimBoundary: 'deterministic region-state fixture only',
          },
        },
      ],
    });

    expect(ctx.buildTaskResumeReadiness({ tabId: 9 })).toMatchObject({
      status: 'postcondition_failed_stop',
      canResumeOriginalTask: false,
      nextStep: 'stop_not_proven',
      reason: 'region_state_search_results_updated_failed:result_collection_unchanged_after_action',
    });
  });

  it('compares read_page object lifecycle snapshots and keeps the stored copy immutable', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const before = makeObjectLifecycle('collapsed_or_expandable_candidate', []);
    const first = ctx.noteObjectLifecycleAndBuildDelta(before);
    const after = makeObjectLifecycle('action_available_candidate', ['ca_logout']);
    const second = ctx.noteObjectLifecycleAndBuildDelta(after);

    expect(first.status).toBe('single_snapshot');
    expect(second.status).toBe('compared_snapshot');
    expect(second.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: 'region:menu:region_menu',
          changeKind: 'changed',
          beforeState: 'collapsed_or_expandable_candidate',
          afterState: 'action_available_candidate',
        }),
      ]),
    );

    after.items[0].state = 'mutated_by_caller';
    expect(ctx.peekLastObjectLifecycle()?.items[0].state).toBe('action_available_candidate');
  });
});

function makeObjectLifecycle(
  menuState: string,
  candidateActionIds: string[],
): ReadPageObjectLifecycleSummary {
  return {
    source: 'read_page_regions',
    status: 'single_snapshot',
    objectCount: 1,
    changedObjectCount: 0,
    items: [
      {
        objectKey: 'region:menu:region_menu',
        regionId: 'region_menu',
        regionType: 'menu',
        objectFamily: 'menu_surface',
        state: menuState,
        targetability: 'target_ref',
        actionTypes: [],
        candidateActionIds,
        evidenceRefs: candidateActionIds,
        confidence: 0.8,
        claimBoundary: 'region candidate only',
      },
    ],
    changes: [],
    claimBoundary: 'single snapshot only',
  };
}

function makeRegion(
  regionId: string,
  regionType: ReadPageRegion['regionType'],
  state: string,
): ReadPageRegion {
  return {
    regionId,
    regionType,
    state,
    confidence: 0.85,
    objects: [],
    candidateActionIds: [],
    targetability: 'not_clickable',
    claimBoundary: 'test region',
  };
}

describe('TaskSessionContext — V28 run-owned tab ownership', () => {
  it('tracks run-owned tab ids and removes them after cleanup', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });

    ctx.noteRunOwnedTab(42);
    ctx.noteRunOwnedTab(7);
    ctx.noteRunOwnedTab(-1);

    expect(ctx.getRunOwnedTabIds()).toEqual([7, 42]);
    expect(ctx.isRunOwnedTab(42)).toBe(true);

    ctx.noteCleanup({ action: 'chrome_close_tabs', targetIds: [42] });

    expect(ctx.getRunOwnedTabIds()).toEqual([7]);
    expect(ctx.isRunOwnedTab(42)).toBe(false);

    ctx.releaseRunOwnedTab(7);

    expect(ctx.getRunOwnedTabIds()).toEqual([]);
    expect(ctx.isRunOwnedTab(7)).toBe(false);
  });
});

describe('TaskSessionContext — live observed API data ordering', () => {
  it('preserves selector priority when multiple candidates are recorded together', () => {
    const ctx = new TaskSessionContext({ readBudget: 6 });
    const base = {
      endpointSource: 'observed' as const,
      liveObservedEndpointId: null,
      endpointSignature: 'POST search-provider.example.test/1/indexes/Item_dev/query',
      semanticType: 'search' as const,
      pageRegion: 'task_query_network',
      correlationScore: 0.72,
      fieldShapeSummaryAvailable: true,
      privacyCheck: 'passed' as const,
      fallbackCause: null,
      fallbackUsed: false,
      knowledgeUpserted: false,
      observationMode: 'cdp_enhanced' as const,
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 1,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api' as const,
      rawBodyPersisted: false as const,
      bodyCompacted: true,
      responseSummarySource: 'browser_context_summary' as const,
      capturedAfterArm: true,
      bridgePath: 'main_world_to_content_to_native' as const,
      responseSummaryRejectedReason: null,
      endpointFamily: 'search-provider.example.test/1/indexes/Item_dev/query',
      compact: true as const,
      rawBodyStored: false as const,
    };

    ctx.noteLiveObservedApiData([
      {
        ...base,
        selectedDataSource: 'cdp_enhanced_api_rows',
        dataPurpose: 'observed_search',
        rows: [{ title: 'browser automation tools' }],
        rowCount: 1,
        contentText: null,
        contentChars: 0,
        contentSections: [],
        contentSectionCount: 0,
        emptyResult: false,
        emptyReason: null,
        emptyMessage: null,
      },
      {
        ...base,
        selectedDataSource: 'api_content',
        dataPurpose: 'observed_search_content',
        rows: [],
        rowCount: 0,
        contentText: 'browser automation summary',
        contentChars: 26,
        contentSections: [
          { path: '$.hits[0].title', text: 'browser automation summary', chars: 26 },
        ],
        contentSectionCount: 1,
        emptyResult: false,
        emptyReason: null,
        emptyMessage: null,
      },
    ]);

    expect(ctx.peekLiveObservedApiData()).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      rowCount: 1,
    });
  });
});
