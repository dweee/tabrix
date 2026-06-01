import type {
  ActionKind,
  ActionOutcome,
  ActionOutcomeEventEnvelope,
  ActionOutcomeSnapshot,
} from '@tabrix/shared';
import {
  getActionPostconditionCoverageMatrix,
  inferRegionStatePostconditionKindForIntent,
  verifyActionPostcondition,
  verifyRegionStatePostcondition,
} from './action-postcondition-verifier';
import type { ReadPageRegion, ReadPageRegionType } from '@tabrix/shared';

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

function region(
  regionType: ReadPageRegionType,
  state: string,
  overrides: Partial<ReadPageRegion> = {},
): ReadPageRegion {
  return {
    regionId: overrides.regionId ?? `${regionType}-1`,
    regionType,
    state,
    confidence: overrides.confidence ?? 0.8,
    label: overrides.label,
    objects: overrides.objects ?? [],
    candidateActionIds: overrides.candidateActionIds ?? [],
    targetability: overrides.targetability ?? 'unknown',
    claimBoundary: overrides.claimBoundary ?? 'deterministic test fixture only',
  };
}

function resultRow(
  suffix: string,
  objectType: 'record' | 'entry' = 'record',
  label = `Alpha ${suffix} insight`,
) {
  return {
    objectId: `row-${suffix}`,
    label,
    objectType,
    targetRef: `tgt_row_${suffix}`,
    actionTypes: ['open_detail'],
    targetability: 'target_ref' as const,
    confidence: 0.8,
    reason: 'deterministic row fixture',
  };
}

function resultCollection(...rows: ReturnType<typeof resultRow>[]): ReadPageRegion[] {
  return [region('content', 'result_collection_candidate', { objects: rows })];
}

function weakResultCollection(suffix: string): ReadPageRegion[] {
  return [
    region('content', `results_${suffix}`, {
      objects: [
        {
          objectId: `weak-row-${suffix}`,
          label: 'redacted weak row',
          objectType: 'doc_block',
          actionTypes: [],
          targetability: 'not_clickable',
          confidence: 0.7,
          reason: 'deterministic weak result fixture',
        },
      ],
      candidateActionIds: [`ca_${suffix}_1`, `ca_${suffix}_2`],
      targetability: 'locator_chain',
    }),
  ];
}

function detailRegion(label = 'Alpha 1 insight detail body'): ReadPageRegion[] {
  return [
    region('content', 'detail_open_candidate', {
      objects: [
        {
          objectId: 'detail-body',
          label,
          objectType: 'doc_block',
          actionTypes: [],
          targetability: 'not_clickable',
          confidence: 0.8,
          reason: 'deterministic detail fixture',
        },
      ],
    }),
  ];
}

function weakDetailRegion(): ReadPageRegion[] {
  return [
    region('content', 'detail_open_candidate', {
      objects: [],
    }),
  ];
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

  const failRows: Array<[ActionKind, ActionOutcome, string]> = [
    ['click', 'no_observed_change', 'no_relevant_effect_observed'],
    ['fill', 'no_observed_change', 'form_input_state_change_not_proven'],
    ['submit', 'no_observed_change', 'form_submit_or_search_results_not_proven'],
    ['navigate', 'no_observed_change', 'no_relevant_effect_observed'],
    ['close', 'no_observed_change', 'no_relevant_effect_observed'],
  ];

  it.each(failRows)('returns failed for %s + %s', (actionKind, outcome, reason) => {
    const result = verify(actionKind, outcome);
    expect(result.verdict).toBe('failed');
    expect(result.reason).toBe(reason);
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

describe('action-postcondition-verifier — R4A region-state postconditions', () => {
  it('maps search and detail candidate intents to region-state postconditions', () => {
    expect(
      inferRegionStatePostconditionKindForIntent({
        intent: 'search.submit',
        actionKind: 'click',
      }),
    ).toBe('search_results_updated');
    expect(
      inferRegionStatePostconditionKindForIntent({
        intent: 'content.open_detail',
        actionKind: 'click',
      }),
    ).toBe('detail_opened');
  });

  it('does not treat query fill or auth-only intents as business success postconditions', () => {
    expect(
      inferRegionStatePostconditionKindForIntent({
        intent: 'search.enter_query',
        actionKind: 'fill',
      }),
    ).toBeNull();
    expect(
      inferRegionStatePostconditionKindForIntent({
        intent: 'auth.request_otp',
        actionKind: 'click',
      }),
    ).toBeNull();
    expect(inferRegionStatePostconditionKindForIntent({ intent: undefined })).toBeNull();
  });

  it('passes menu_opened only when menu actions appear after the action', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'menu_opened',
      actionId: 'act-menu',
      beforeRegions: [region('menu', 'collapsed_or_expandable_candidate')],
      afterRegions: [
        region('menu', 'action_available_candidate', { candidateActionIds: ['ca_logout'] }),
      ],
      now: () => PRODUCED_AT,
    });

    expect(result).toMatchObject({
      actionId: 'act-menu',
      kind: 'menu_opened',
      verdict: 'passed',
      reason: 'menu_region_expanded_or_actions_appeared',
      producedAtMs: PRODUCED_AT,
    });
    expect(result.claimBoundary).toContain('click success, timeout, or QR presence alone');
  });

  it('keeps menu_opened unknown when the menu state does not change', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'menu_opened',
      actionId: 'act-menu',
      beforeRegions: [region('menu', 'collapsed_or_expandable_candidate')],
      afterRegions: [region('menu', 'collapsed_or_expandable_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('menu_state_change_not_proven');
  });

  it('passes search_results_updated when a targetable content collection appears', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search',
      beforeRegions: [region('form', 'search_ready_candidate')],
      afterRegions: resultCollection(resultRow('1'), resultRow('2', 'entry')),
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('result_collection_appeared_after_action');
  });

  it('passes search_results_updated when the existing collection changes target refs', () => {
    const before = resultCollection(resultRow('before_a'), resultRow('before_b'));
    const after = resultCollection(resultRow('after_c'), resultRow('after_d'));

    const result = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search',
      beforeRegions: before,
      afterRegions: after,
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('result_collection_changed_after_action');
  });

  it('keeps search_results_updated unknown when changed collection lacks structured result rows', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search',
      beforeRegions: weakResultCollection('before'),
      afterRegions: weakResultCollection('after'),
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('structured_result_evidence_missing_after_action');
  });

  it('fails search_results_updated when the collection is unchanged', () => {
    const unchanged = resultCollection(resultRow('a'), resultRow('b'));

    const result = verifyRegionStatePostcondition({
      kind: 'search_results_updated',
      actionId: 'act-search',
      beforeRegions: unchanged,
      afterRegions: unchanged,
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('failed');
    expect(result.reason).toBe('result_collection_unchanged_after_action');
  });

  it('passes detail_opened only when a semantically matching detail content region replaces a result collection', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(
        resultRow('1', 'record', 'Alpha launch checklist'),
        resultRow('2', 'entry', 'Beta research note'),
      ),
      afterRegions: detailRegion('Alpha launch checklist expanded details'),
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('content_detail_region_semantic_match_after_action');
    expect(result.detailFieldReadbackEvidence).toMatchObject({
      kind: 'detail_field_readback',
      status: 'structured_fields_present',
      targetBindingProven: true,
      semanticMatch: 'matched',
      canSupportDetailSummary: true,
      fieldCounts: {
        totalStructuredObjects: 1,
        bodyLikeObjects: 1,
      },
      nextRequiredCheck: 'detail_fields_ready_for_summary',
    });
    expect(JSON.stringify(result.detailFieldReadbackEvidence)).not.toContain(
      'Alpha launch checklist',
    );
  });

  it('keeps detail_opened unknown when the detail content does not match the clicked row text', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(
        resultRow('1', 'record', 'Alpha launch checklist'),
        resultRow('2', 'entry', 'Beta research note'),
      ),
      afterRegions: detailRegion('Gamma release memo expanded details'),
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('detail_semantic_match_not_proven_after_action');
    expect(result.detailFieldReadbackEvidence).toMatchObject({
      status: 'partial_fields_only',
      targetBindingProven: true,
      semanticMatch: 'not_matched',
      canSupportDetailSummary: false,
      nextRequiredCheck: 'fresh_detail_read_or_more_structured_fields_required',
    });
  });

  it('keeps detail_opened unknown when the clicked row lacks usable semantic text', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(resultRow('1', 'record', 'redacted row')),
      afterRegions: detailRegion('Alpha launch checklist expanded details'),
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('before_target_row_semantic_text_missing');
  });

  it('keeps detail_opened unknown when the clicked target is not bound to a before row', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(resultRow('1'), resultRow('2', 'entry')),
      afterRegions: detailRegion(),
      targetRefs: ['tgt_missing_row'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('before_target_row_identity_not_proven');
  });

  it('keeps detail_opened unknown when the action did not carry a target ref', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(resultRow('1'), resultRow('2', 'entry')),
      afterRegions: detailRegion(),
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('before_target_row_identity_not_proven');
    expect(result.detailFieldReadbackEvidence).toMatchObject({
      status: 'not_available',
      targetBindingProven: false,
      semanticMatch: 'not_applicable',
      canSupportDetailSummary: false,
      nextRequiredCheck: 'target_binding_required_before_detail_summary',
    });
  });

  it('keeps detail_opened unknown when the detail region lacks structured content evidence', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: resultCollection(resultRow('1'), resultRow('2', 'entry')),
      afterRegions: weakDetailRegion(),
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('structured_detail_evidence_missing_after_action');
  });

  it('keeps detail_opened unknown when the before collection has no targetable result row', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: weakResultCollection('before'),
      afterRegions: detailRegion(),
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('before_structured_result_evidence_missing');
  });

  it('fails detail_opened when the same result collection is still visible', () => {
    const before = resultCollection(resultRow('1'), resultRow('2'));

    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: before,
      afterRegions: before,
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('failed');
    expect(result.reason).toBe('detail_collection_unchanged_after_action');
  });

  it('keeps detail_opened unknown when the collection changed but no detail region is visible', () => {
    const before = resultCollection(resultRow('1'), resultRow('2'));
    const after = resultCollection(resultRow('3'), resultRow('4'));

    const result = verifyRegionStatePostcondition({
      kind: 'detail_opened',
      actionId: 'act-open-detail',
      beforeRegions: before,
      afterRegions: after,
      targetRefs: ['tgt_row_1'],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('detail_open_not_proven_collection_changed_without_detail');
  });

  it('passes login_completed only when auth prompt disappears and account appears', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'login_completed',
      actionId: 'act-login',
      beforeRegions: [
        region('modal', 'open_candidate'),
        region('qr_code', 'waiting_scan_candidate'),
      ],
      afterRegions: [region('account', 'logged_in_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('account_region_appeared_after_auth_prompt');
  });

  it('does not treat a visible QR code as login success', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'login_completed',
      actionId: 'act-login',
      beforeRegions: [region('qr_code', 'waiting_scan_candidate')],
      afterRegions: [region('qr_code', 'waiting_scan_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('auth_prompt_still_present');
  });

  it('does not treat an account candidate as login success while QR is still visible', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'login_completed',
      actionId: 'act-login',
      beforeRegions: [
        region('modal', 'open_candidate'),
        region('qr_code', 'waiting_scan_candidate'),
      ],
      afterRegions: [
        region('account', 'logged_in_candidate'),
        region('qr_code', 'waiting_scan_candidate'),
      ],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('unknown');
    expect(result.reason).toBe('auth_prompt_still_present');
  });

  it('passes logout_completed only when logged-in account changes to logged-out evidence', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'logout_completed',
      actionId: 'act-logout',
      beforeRegions: [region('account', 'logged_in_candidate')],
      afterRegions: [region('account', 'logged_out_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('logged_out_or_auth_prompt_visible_after');
  });

  it('fails logout_completed when logged-in account is still present after the action', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'logout_completed',
      actionId: 'act-logout',
      beforeRegions: [region('account', 'logged_in_candidate')],
      afterRegions: [region('account', 'logged_in_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('failed');
    expect(result.reason).toBe('account_region_still_logged_in');
  });

  it('treats QR waiting as scan-wait evidence only, not login success', () => {
    const result = verifyRegionStatePostcondition({
      kind: 'qr_waiting',
      actionId: 'act-qr',
      beforeRegions: [],
      afterRegions: [region('qr_code', 'waiting_scan_candidate')],
      now: () => PRODUCED_AT,
    });

    expect(result.verdict).toBe('passed');
    expect(result.reason).toBe('qr_region_waiting_for_scan');
    expect(result.claimBoundary).toContain('QR presence alone is not business success');
  });
});
