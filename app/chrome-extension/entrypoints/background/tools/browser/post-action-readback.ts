import type { ClickObservedOutcome } from '@tabrix/shared';
import type { CandidateActionInput } from './candidate-action';

export interface ActionBusinessVerificationPlan {
  status: 'fresh_read_required' | 'not_proven';
  candidateActionIntent: string | null;
  expectedEvidence:
    | 'agreement_state_changed_or_dialog_present'
    | 'agreement_dialog_closed_or_terms_accepted'
    | 'otp_countdown_or_sent_feedback'
    | 'auth_surface_removed_and_account_state_present'
    | 'form_value_state_changed'
    | 'search_results_or_url_query_changed'
    | 'detail_region_or_content_transition'
    | 'page_or_object_state_changed';
  requiredNextAction: 'chrome_read_page_force_refresh_same_tab' | 'stop_or_retry_after_fresh_read';
  sameTabVerificationRequired: boolean;
  businessSuccessProven: false;
  reason: string;
  claimBoundary: string;
}

export interface PostActionReadbackEvidence {
  kind: 'post_action_readback_v1';
  actionKind: 'click' | 'hover' | 'fill';
  status: 'fresh_read_required' | 'proven_by_fresh_readback' | 'not_proven';
  candidateActionIntent: string | null;
  expectedEvidence: ActionBusinessVerificationPlan['expectedEvidence'];
  observedOutcome: ClickObservedOutcome | 'verification_required' | 'input_value_written' | null;
  dispatchSucceeded: boolean;
  freshReadRequired: boolean;
  sameTabVerificationRequired: boolean;
  businessSuccessProven: boolean;
  readbackSource: 'click_verifier' | 'tool_dispatch_only' | 'none';
  requiredNextAction:
    | 'none'
    | 'chrome_read_page_force_refresh_same_tab'
    | 'stop_or_retry_after_fresh_read';
  reason: string;
  claimBoundary: string;
}

function normalizeIntent(candidateAction: CandidateActionInput | undefined): string | null {
  return typeof candidateAction?.intent === 'string' && candidateAction.intent.trim()
    ? candidateAction.intent.trim()
    : null;
}

function expectedBusinessEvidenceForIntent(
  intent: CandidateActionInput['intent'] | undefined,
): ActionBusinessVerificationPlan['expectedEvidence'] {
  switch (intent) {
    case 'auth.accept_terms':
      return 'agreement_state_changed_or_dialog_present';
    case 'auth.confirm_agreement':
      return 'agreement_dialog_closed_or_terms_accepted';
    case 'auth.request_otp':
      return 'otp_countdown_or_sent_feedback';
    case 'auth.submit_login':
      return 'auth_surface_removed_and_account_state_present';
    case 'search.enter_query':
      return 'form_value_state_changed';
    case 'search.submit':
    case 'search.category_select':
      return 'search_results_or_url_query_changed';
    case 'filter.open':
      return 'page_or_object_state_changed';
    case 'filter.option_select':
    case 'filter.sort_most_collected':
    case 'filter.time_range_select':
      return 'search_results_or_url_query_changed';
    case 'content.open_detail':
      return 'detail_region_or_content_transition';
    default:
      return 'page_or_object_state_changed';
  }
}

function shouldReadBackBeforeRetry(input: {
  intent: string | null;
  dispatchSucceeded: boolean;
  observedOutcome: ClickObservedOutcome | 'verification_required' | 'input_value_written' | null;
}): boolean {
  if (!input.dispatchSucceeded) return false;
  if (input.observedOutcome !== 'no_observed_change') return false;
  return (
    input.intent === 'filter.open' ||
    input.intent === 'filter.option_select' ||
    input.intent === 'filter.sort_most_collected' ||
    input.intent === 'filter.time_range_select' ||
    input.intent === 'search.category_select'
  );
}

export function buildActionBusinessVerificationPlan(input: {
  candidateAction?: CandidateActionInput;
  dispatchSucceeded: boolean;
  actionKind: 'click' | 'hover' | 'fill';
  observedOutcome?: ClickObservedOutcome | 'verification_required' | null;
}): ActionBusinessVerificationPlan {
  const intent = normalizeIntent(input.candidateAction);
  const expectedEvidence = expectedBusinessEvidenceForIntent(input.candidateAction?.intent);
  const status = input.dispatchSucceeded ? 'fresh_read_required' : 'not_proven';
  return {
    status,
    candidateActionIntent: intent,
    expectedEvidence,
    requiredNextAction: input.dispatchSucceeded
      ? 'chrome_read_page_force_refresh_same_tab'
      : 'stop_or_retry_after_fresh_read',
    sameTabVerificationRequired: true,
    businessSuccessProven: false,
    reason: input.dispatchSucceeded
      ? `${input.actionKind}_dispatch_observed_${input.observedOutcome ?? 'without_business_state'}`
      : `${input.actionKind}_dispatch_not_proven`,
    claimBoundary:
      'Tool dispatch and page-local signals are not business success; verify the expected page/object state with a fresh same-tab chrome_read_page before continuing the user task.',
  };
}

export function buildPostActionReadbackEvidence(input: {
  candidateAction?: CandidateActionInput;
  dispatchSucceeded: boolean;
  actionKind: 'click' | 'hover' | 'fill';
  observedOutcome?: ClickObservedOutcome | 'verification_required' | 'input_value_written' | null;
  verifierPassed?: boolean | null;
  verifierReason?: string | null;
}): PostActionReadbackEvidence {
  const intent = normalizeIntent(input.candidateAction);
  const expectedEvidence = expectedBusinessEvidenceForIntent(input.candidateAction?.intent);
  const observedOutcome = input.observedOutcome ?? null;
  const readBackBeforeRetry = shouldReadBackBeforeRetry({
    intent,
    dispatchSucceeded: input.dispatchSucceeded,
    observedOutcome,
  });

  if (input.verifierPassed === true) {
    return {
      kind: 'post_action_readback_v1',
      actionKind: input.actionKind,
      status: 'proven_by_fresh_readback',
      candidateActionIntent: intent,
      expectedEvidence,
      observedOutcome,
      dispatchSucceeded: input.dispatchSucceeded,
      freshReadRequired: false,
      sameTabVerificationRequired: true,
      businessSuccessProven: true,
      readbackSource: 'click_verifier',
      requiredNextAction: 'none',
      reason: input.verifierReason || 'post_action_verifier_passed',
      claimBoundary:
        'Business success is proven only for the verifier scope that ran; unrelated user task outcomes still need their own postcondition evidence.',
    };
  }

  if (readBackBeforeRetry) {
    return {
      kind: 'post_action_readback_v1',
      actionKind: input.actionKind,
      status: 'fresh_read_required',
      candidateActionIntent: intent,
      expectedEvidence,
      observedOutcome,
      dispatchSucceeded: input.dispatchSucceeded,
      freshReadRequired: true,
      sameTabVerificationRequired: true,
      businessSuccessProven: false,
      readbackSource: 'tool_dispatch_only',
      requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
      reason: `${input.actionKind}_dispatch_without_local_observable_change_requires_fresh_read`,
      claimBoundary:
        'The action was dispatched, but lightweight search/filter UI changes can be missed by the local observation window. Do not retry first; run a fresh same-tab chrome_read_page and verify the expected page/object state.',
    };
  }

  if (!input.dispatchSucceeded || isNonProvingObservedOutcome(observedOutcome)) {
    return {
      kind: 'post_action_readback_v1',
      actionKind: input.actionKind,
      status: 'not_proven',
      candidateActionIntent: intent,
      expectedEvidence,
      observedOutcome,
      dispatchSucceeded: input.dispatchSucceeded,
      freshReadRequired: true,
      sameTabVerificationRequired: true,
      businessSuccessProven: false,
      readbackSource: 'none',
      requiredNextAction: 'stop_or_retry_after_fresh_read',
      reason: !input.dispatchSucceeded
        ? `${input.actionKind}_dispatch_not_proven`
        : `${input.actionKind}_${observedOutcome}`,
      claimBoundary:
        'No task-advancing post-action change was proven; focus-only, empty, or unavailable signals must not be treated as success without fresh same-tab readback or retry evidence.',
    };
  }

  return {
    kind: 'post_action_readback_v1',
    actionKind: input.actionKind,
    status: 'fresh_read_required',
    candidateActionIntent: intent,
    expectedEvidence,
    observedOutcome,
    dispatchSucceeded: input.dispatchSucceeded,
    freshReadRequired: true,
    sameTabVerificationRequired: true,
    businessSuccessProven: false,
    readbackSource: 'tool_dispatch_only',
    requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
    reason: `${input.actionKind}_dispatch_observed_${observedOutcome ?? 'without_business_state'}`,
    claimBoundary:
      'The action produced local evidence, but task success still requires a fresh same-tab chrome_read_page or a scoped verifier result.',
  };
}

function isNonProvingObservedOutcome(
  outcome: ClickObservedOutcome | 'verification_required' | 'input_value_written' | null,
): boolean {
  return (
    outcome === 'no_observed_change' ||
    outcome === 'focus_changed' ||
    outcome === 'verification_unavailable'
  );
}
