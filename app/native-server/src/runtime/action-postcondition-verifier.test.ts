import type {
  ActionKind,
  ActionOutcome,
  ActionOutcomeEventEnvelope,
  ActionOutcomeSnapshot,
} from '@tabrix/shared';
import {
  getActionPostconditionCoverageMatrix,
  verifyActionPostcondition,
} from './action-postcondition-verifier';

const T0 = 1_700_000_000_000;
const PRODUCED_AT = T0 + 9_999;
const V3_REQUIRED_ACTIONS = [
  'navigate',
  'click',
  'type',
  'fill',
  'submit',
  'scroll',
  'read',
  'close',
] as const;

function makeEnvelope(
  overrides: Partial<ActionOutcomeEventEnvelope> = {},
): ActionOutcomeEventEnvelope {
  return {
    actionId: overrides.actionId ?? 'act-1',
    actionKind: overrides.actionKind ?? 'click',
    tabId: overrides.tabId ?? 100,
    urlPattern: overrides.urlPattern ?? 'example.test/list',
    observedAtMs: overrides.observedAtMs ?? T0,
    signals: overrides.signals ?? [],
  };
}

function makeSnapshot(overrides: Partial<ActionOutcomeSnapshot> = {}): ActionOutcomeSnapshot {
  return {
    actionId: overrides.actionId ?? 'act-1',
    outcome: overrides.outcome ?? 'spa_partial_update',
    outcomeConfidence: overrides.outcomeConfidence ?? 0.85,
    observedSignalKinds: overrides.observedSignalKinds ?? [],
    producedAtMs: overrides.producedAtMs ?? T0 + 500,
  };
}

function verify(actionKind: ActionKind, outcome: ActionOutcome, confidence = 0.85) {
  return verifyActionPostcondition(
    makeEnvelope({ actionKind }),
    makeSnapshot({ outcome, outcomeConfidence: confidence }),
    { now: () => PRODUCED_AT },
  );
}

describe('action-postcondition-verifier — coverage matrix', () => {
  it('lists every V3 required action exactly once', () => {
    const requiredRows = getActionPostconditionCoverageMatrix().filter((row) => row.requiredByV3);
    expect(requiredRows.map((row) => row.action)).toEqual(V3_REQUIRED_ACTIONS);
  });

  it('marks current shared ActionKind rows supported only where verifier has a matrix', () => {
    const rows = getActionPostconditionCoverageMatrix();
    const supportedRows = rows.filter((row) => row.status === 'supported');

    expect(supportedRows.map((row) => row.action)).toEqual([
      'navigate',
      'click',
      'fill',
      'submit',
      'close',
    ]);
    expect(supportedRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'click',
          sharedActionKind: 'click',
          expectedOutcomes: [
            'navigated_same_tab',
            'navigated_new_tab',
            'spa_partial_update',
            'modal_opened',
          ],
          failOutcomes: ['no_observed_change'],
        }),
        expect.objectContaining({
          action: 'navigate',
          sharedActionKind: 'navigate',
          expectedOutcomes: ['navigated_same_tab', 'navigated_new_tab'],
          failOutcomes: ['no_observed_change'],
        }),
        expect.objectContaining({
          action: 'fill',
          sharedActionKind: 'fill',
          expectedOutcomes: ['spa_partial_update'],
          failOutcomes: ['no_observed_change'],
        }),
        expect.objectContaining({
          action: 'close',
          sharedActionKind: 'close',
          expectedOutcomes: [],
          failOutcomes: ['no_observed_change'],
          unknownHandling: 'tool_closeout_requires_browser_hygiene_evidence',
        }),
      ]),
    );
  });

  it('marks V3 actions absent from shared ActionKind as blocked by contract', () => {
    const blockedRows = getActionPostconditionCoverageMatrix().filter(
      (row) => row.status === 'blocked_by_shared_action_kind_contract',
    );

    expect(blockedRows.map((row) => row.action)).toEqual(['type', 'scroll']);
    for (const row of blockedRows) {
      expect(row.sharedActionKind).toBeNull();
      expect(row.expectedOutcomes).toEqual([]);
      expect(row.unknownHandling).toBe(
        'must_not_be_claimed_supported_until_shared_action_kind_exists',
      );
    }
  });

  it('keeps read explicit but not product-complete until R2 adds success evidence', () => {
    expect(getActionPostconditionCoverageMatrix()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'read',
          requiredByV3: true,
          sharedActionKind: 'read',
          status: 'not_product_complete',
          unknownHandling: 'read_success_requires_structured_read_gate_evidence',
        }),
      ]),
    );
  });

  it('keeps keyboard and unknown explicit but not product-complete', () => {
    const rows = getActionPostconditionCoverageMatrix();
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'keyboard',
          requiredByV3: false,
          sharedActionKind: 'keyboard',
          status: 'not_product_complete',
          unknownHandling: 'verifier_always_returns_unknown',
        }),
        expect.objectContaining({
          action: 'unknown',
          requiredByV3: false,
          sharedActionKind: 'unknown',
          status: 'not_product_complete',
          unknownHandling: 'verifier_always_returns_unknown',
        }),
      ]),
    );
  });
});

describe('action-postcondition-verifier — verdict matrix', () => {
  const passRows: Array<[ActionKind, ActionOutcome]> = [
    ['click', 'navigated_same_tab'],
    ['click', 'navigated_new_tab'],
    ['click', 'spa_partial_update'],
    ['click', 'modal_opened'],
    ['fill', 'spa_partial_update'],
    ['submit', 'navigated_same_tab'],
    ['submit', 'navigated_new_tab'],
    ['submit', 'spa_partial_update'],
    ['submit', 'modal_opened'],
    ['navigate', 'navigated_same_tab'],
    ['navigate', 'navigated_new_tab'],
  ];

  it.each(passRows)('returns passed for %s + %s', (actionKind, outcome) => {
    expect(verify(actionKind, outcome).verdict).toBe('passed');
  });

  const failRows: Array<[ActionKind, ActionOutcome]> = [
    ['click', 'no_observed_change'],
    ['fill', 'no_observed_change'],
    ['submit', 'no_observed_change'],
    ['navigate', 'no_observed_change'],
    ['close', 'no_observed_change'],
  ];

  it.each(failRows)('returns failed for %s + %s', (actionKind, outcome) => {
    const result = verify(actionKind, outcome);
    expect(result.verdict).toBe('failed');
    expect(result.reason).toBe('no_relevant_effect_observed');
  });

  const inconclusiveOutcomes: ActionOutcome[] = ['multiple_signals', 'ambiguous', 'unknown'];

  it.each(inconclusiveOutcomes)('returns unknown for click + %s', (outcome) => {
    expect(verify('click', outcome).verdict).toBe('unknown');
  });

  it('returns unknown for fill outcomes outside the approved fill pass/fail rows', () => {
    const outcomes: ActionOutcome[] = [
      'navigated_same_tab',
      'navigated_new_tab',
      'modal_opened',
      'multiple_signals',
      'ambiguous',
      'unknown',
    ];
    for (const outcome of outcomes) {
      expect(verify('fill', outcome).verdict).toBe('unknown');
    }
  });

  it('returns unknown for navigate outcomes outside the approved navigate pass/fail rows', () => {
    const outcomes: ActionOutcome[] = [
      'spa_partial_update',
      'modal_opened',
      'multiple_signals',
      'ambiguous',
      'unknown',
    ];
    for (const outcome of outcomes) {
      expect(verify('navigate', outcome).verdict).toBe('unknown');
    }
  });

  it('returns unknown for read outcomes until structured read success evidence is wired', () => {
    for (const outcome of ['spa_partial_update', 'no_observed_change'] as ActionOutcome[]) {
      const result = verify('read', outcome);
      expect(result.verdict).toBe('unknown');
      expect(result.reason).toBe('read_success_requires_structured_read_gate_evidence');
    }
  });

  it('returns unknown for keyboard regardless of observed outcome', () => {
    const outcomes: ActionOutcome[] = [
      'navigated_same_tab',
      'navigated_new_tab',
      'spa_partial_update',
      'modal_opened',
      'no_observed_change',
      'multiple_signals',
      'ambiguous',
      'unknown',
    ];
    for (const outcome of outcomes) {
      const result = verify('keyboard', outcome);
      expect(result.verdict).toBe('unknown');
      expect(result.reason).toBe('keyboard_not_supported');
    }
  });

  it('returns unknown for unknown action kind regardless of observed outcome', () => {
    for (const outcome of ['spa_partial_update', 'no_observed_change'] as ActionOutcome[]) {
      const result = verify('unknown', outcome);
      expect(result.verdict).toBe('unknown');
      expect(result.reason).toBe('unknown_action_kind');
    }
  });

  it('returns unknown when classifier confidence is below the threshold', () => {
    const result = verify('click', 'spa_partial_update', 0.59);
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('low_confidence');
  });

  it('allows callers to raise the confidence threshold', () => {
    const result = verifyActionPostcondition(
      makeEnvelope({ actionKind: 'click' }),
      makeSnapshot({ outcome: 'spa_partial_update', outcomeConfidence: 0.85 }),
      { now: () => PRODUCED_AT, confidenceThreshold: 0.9 },
    );
    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('low_confidence');
  });
});

describe('action-postcondition-verifier — output contract', () => {
  it('returns unknown for action id mismatch without changing observed outcome fields', () => {
    const result = verifyActionPostcondition(
      makeEnvelope({ actionId: 'act-1', actionKind: 'click' }),
      makeSnapshot({ actionId: 'act-2', outcome: 'spa_partial_update', outcomeConfidence: 0.85 }),
      { now: () => PRODUCED_AT },
    );

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('action_id_mismatch');
    expect(result.actionId).toBe('act-1');
    expect(result.observedOutcome).toBe('spa_partial_update');
    expect(result.observedOutcomeConfidence).toBe(0.85);
  });

  it('preserves action metadata and deterministic producedAtMs', () => {
    const result = verifyActionPostcondition(
      makeEnvelope({
        actionId: 'act-42',
        actionKind: 'submit',
        tabId: 321,
        urlPattern: 'example.test/form',
      }),
      makeSnapshot({
        actionId: 'act-42',
        outcome: 'navigated_same_tab',
        outcomeConfidence: 0.95,
      }),
      { now: () => PRODUCED_AT },
    );

    expect(result).toMatchObject({
      actionId: 'act-42',
      actionKind: 'submit',
      tabId: 321,
      urlPattern: 'example.test/form',
      verdict: 'passed',
      reason: 'outcome_supports_submit',
      observedOutcome: 'navigated_same_tab',
      observedOutcomeConfidence: 0.95,
      producedAtMs: PRODUCED_AT,
    });
  });

  it('stamps coarse deterministic evidence refs without inventing event ids', () => {
    const result = verifyActionPostcondition(
      makeEnvelope({ actionId: 'act-9' }),
      makeSnapshot({ actionId: 'act-9' }),
      { now: () => PRODUCED_AT },
    );

    expect(result.sourceEventRefs).toEqual([
      {
        kind: 'action_outcome',
        id: 'action_outcome:act-9',
        origin: 'action_outcome_classifier',
      },
    ]);
    expect(result.sourceOrigins).toEqual(['runtime', 'action_outcome_classifier', 'inference']);
    expect(JSON.stringify(result)).not.toContain('cookie');
    expect(JSON.stringify(result)).not.toContain('Authorization');
  });

  it('is deterministic for the same inputs and pinned clock', () => {
    const envelope = makeEnvelope({ actionKind: 'click' });
    const snapshot = makeSnapshot({ outcome: 'modal_opened' });
    const a = verifyActionPostcondition(envelope, snapshot, { now: () => PRODUCED_AT });
    const b = verifyActionPostcondition(envelope, snapshot, { now: () => PRODUCED_AT });
    expect(a).toEqual(b);
  });
});
