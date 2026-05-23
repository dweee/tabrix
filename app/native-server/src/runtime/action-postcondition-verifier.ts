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

export interface VerifyActionPostconditionOptions {
  now?: () => number;
  confidenceThreshold?: number;
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
      return verdictFromOutcome(outcome, [
        'navigated_same_tab',
        'navigated_new_tab',
        'spa_partial_update',
        'modal_opened',
      ]);
    case 'fill':
      return verdictFromOutcome(outcome, ['spa_partial_update']);
    case 'submit':
      return verdictFromOutcome(outcome, [
        'navigated_same_tab',
        'navigated_new_tab',
        'spa_partial_update',
        'modal_opened',
      ]);
    case 'navigate':
      return verdictFromOutcome(outcome, ['navigated_same_tab', 'navigated_new_tab']);
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
