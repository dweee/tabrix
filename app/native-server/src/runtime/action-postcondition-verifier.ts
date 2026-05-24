/**
 * BNS-04 action postcondition verifier.
 *
 * Pure deterministic layer over the existing action-outcome classifier output.
 * It does not observe the browser, read the DOM, call MCP tools, or infer task
 * success beyond the frozen action-kind/outcome matrix.
 */
import type {
  ActionKind,
  ActionOutcome,
  ActionOutcomeEventEnvelope,
  ActionOutcomeSnapshot,
  PostconditionResult,
  PostconditionVerdict,
} from '@tabrix/shared';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export type V3RequiredPostconditionAction =
  | 'navigate'
  | 'click'
  | 'type'
  | 'fill'
  | 'submit'
  | 'scroll'
  | 'read'
  | 'close';

export type ActionPostconditionCoverageStatus =
  | 'supported'
  | 'blocked_by_shared_action_kind_contract'
  | 'not_product_complete';

export interface ActionPostconditionCoverageRow {
  action: V3RequiredPostconditionAction | ActionKind;
  requiredByV3: boolean;
  sharedActionKind: ActionKind | null;
  status: ActionPostconditionCoverageStatus;
  expectedOutcomes: ActionOutcome[];
  failOutcomes: ActionOutcome[];
  unknownHandling: string;
  reason: string;
}

const SUPPORTED_CLICK_SUBMIT_OUTCOMES: ActionOutcome[] = [
  'navigated_same_tab',
  'navigated_new_tab',
  'spa_partial_update',
  'modal_opened',
];

const SUPPORTED_NAVIGATE_OUTCOMES: ActionOutcome[] = ['navigated_same_tab', 'navigated_new_tab'];

const ACTION_POSTCONDITION_COVERAGE_MATRIX: readonly ActionPostconditionCoverageRow[] =
  Object.freeze([
    {
      action: 'navigate',
      requiredByV3: true,
      sharedActionKind: 'navigate',
      status: 'supported',
      expectedOutcomes: SUPPORTED_NAVIGATE_OUTCOMES,
      failOutcomes: ['no_observed_change'],
      unknownHandling: 'low_confidence_or_non_navigation_outcome_returns_unknown',
      reason: 'shared_action_kind_supported_by_verifier',
    },
    {
      action: 'click',
      requiredByV3: true,
      sharedActionKind: 'click',
      status: 'supported',
      expectedOutcomes: SUPPORTED_CLICK_SUBMIT_OUTCOMES,
      failOutcomes: ['no_observed_change'],
      unknownHandling: 'low_confidence_or_ambiguous_outcome_returns_unknown',
      reason: 'shared_action_kind_supported_by_verifier',
    },
    {
      action: 'type',
      requiredByV3: true,
      sharedActionKind: null,
      status: 'blocked_by_shared_action_kind_contract',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'must_not_be_claimed_supported_until_shared_action_kind_exists',
      reason: 'type_is_not_a_shared_action_kind',
    },
    {
      action: 'fill',
      requiredByV3: true,
      sharedActionKind: 'fill',
      status: 'supported',
      expectedOutcomes: ['spa_partial_update'],
      failOutcomes: ['no_observed_change'],
      unknownHandling: 'low_confidence_or_non_fill_outcome_returns_unknown',
      reason: 'shared_action_kind_supported_by_verifier',
    },
    {
      action: 'submit',
      requiredByV3: true,
      sharedActionKind: 'submit',
      status: 'supported',
      expectedOutcomes: SUPPORTED_CLICK_SUBMIT_OUTCOMES,
      failOutcomes: ['no_observed_change'],
      unknownHandling: 'low_confidence_or_ambiguous_outcome_returns_unknown',
      reason: 'shared_action_kind_supported_by_verifier',
    },
    {
      action: 'scroll',
      requiredByV3: true,
      sharedActionKind: null,
      status: 'blocked_by_shared_action_kind_contract',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'must_not_be_claimed_supported_until_shared_action_kind_exists',
      reason: 'scroll_is_not_a_shared_action_kind',
    },
    {
      action: 'read',
      requiredByV3: true,
      sharedActionKind: null,
      status: 'blocked_by_shared_action_kind_contract',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'must_not_be_claimed_supported_until_shared_action_kind_exists',
      reason: 'read_is_not_a_shared_action_kind',
    },
    {
      action: 'close',
      requiredByV3: true,
      sharedActionKind: null,
      status: 'blocked_by_shared_action_kind_contract',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'must_not_be_claimed_supported_until_shared_action_kind_exists',
      reason: 'close_is_not_a_shared_action_kind',
    },
    {
      action: 'keyboard',
      requiredByV3: false,
      sharedActionKind: 'keyboard',
      status: 'not_product_complete',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'verifier_always_returns_unknown',
      reason: 'keyboard_shared_action_kind_has_no_product_postcondition_matrix',
    },
    {
      action: 'unknown',
      requiredByV3: false,
      sharedActionKind: 'unknown',
      status: 'not_product_complete',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'verifier_always_returns_unknown',
      reason: 'unknown_action_kind_must_not_be_treated_as_success',
    },
  ]);

export interface VerifyActionPostconditionOptions {
  now?: () => number;
  confidenceThreshold?: number;
}

export function getActionPostconditionCoverageMatrix(): readonly ActionPostconditionCoverageRow[] {
  return ACTION_POSTCONDITION_COVERAGE_MATRIX;
}

export function verifyActionPostcondition(
  envelope: ActionOutcomeEventEnvelope,
  snapshot: ActionOutcomeSnapshot,
  options: VerifyActionPostconditionOptions = {},
): PostconditionResult {
  const producedAtMs = options.now ? options.now() : Date.now();
  const threshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const actionIdMatches = snapshot.actionId === envelope.actionId;
  const verdict = actionIdMatches
    ? verdictFor(envelope.actionKind, snapshot.outcome, snapshot.outcomeConfidence, threshold)
    : 'unknown';

  return {
    actionId: envelope.actionId,
    actionKind: envelope.actionKind,
    tabId: envelope.tabId ?? null,
    urlPattern: envelope.urlPattern ?? null,
    verdict,
    reason: reasonFor(verdict, envelope.actionKind, snapshot.outcome, {
      actionIdMatches,
      confidenceBelowThreshold: snapshot.outcomeConfidence < threshold,
    }),
    observedOutcome: snapshot.outcome,
    observedOutcomeConfidence: snapshot.outcomeConfidence,
    sourceEventRefs: [
      {
        kind: 'action_outcome',
        id: `action_outcome:${envelope.actionId}`,
        origin: 'action_outcome_classifier',
      },
    ],
    sourceOrigins: ['runtime', 'action_outcome_classifier', 'inference'],
    producedAtMs,
  };
}

function verdictFor(
  actionKind: ActionKind,
  outcome: ActionOutcome,
  confidence: number,
  threshold: number,
): PostconditionVerdict {
  if (confidence < threshold) return 'unknown';

  switch (actionKind) {
    case 'click':
      return verdictFromOutcome(outcome, SUPPORTED_CLICK_SUBMIT_OUTCOMES);
    case 'fill':
      return verdictFromOutcome(outcome, ['spa_partial_update']);
    case 'submit':
      return verdictFromOutcome(outcome, SUPPORTED_CLICK_SUBMIT_OUTCOMES);
    case 'navigate':
      return verdictFromOutcome(outcome, SUPPORTED_NAVIGATE_OUTCOMES);
    case 'keyboard':
    case 'unknown':
      return 'unknown';
  }
}

function verdictFromOutcome(
  outcome: ActionOutcome,
  passingOutcomes: readonly ActionOutcome[],
): PostconditionVerdict {
  if (passingOutcomes.includes(outcome)) return 'passed';
  if (outcome === 'no_observed_change') return 'failed';
  return 'unknown';
}

function reasonFor(
  verdict: PostconditionVerdict,
  actionKind: ActionKind,
  outcome: ActionOutcome,
  flags: { actionIdMatches: boolean; confidenceBelowThreshold: boolean },
): string {
  if (!flags.actionIdMatches) return 'action_id_mismatch';
  if (flags.confidenceBelowThreshold) return 'low_confidence';
  if (actionKind === 'keyboard') return 'keyboard_not_supported';
  if (actionKind === 'unknown') return 'unknown_action_kind';
  if (verdict === 'passed') return `outcome_supports_${actionKind}`;
  if (verdict === 'failed') return 'no_relevant_effect_observed';
  return `outcome_inconclusive_${outcome}`;
}
