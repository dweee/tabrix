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
  ReadPageCandidateActionIntent,
  ReadPageRegion,
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
      sharedActionKind: 'read',
      status: 'not_product_complete',
      expectedOutcomes: [],
      failOutcomes: [],
      unknownHandling: 'read_success_requires_structured_read_gate_evidence',
      reason: 'read_shared_action_kind_exists_but_success_matrix_deferred_to_r2',
    },
    {
      action: 'close',
      requiredByV3: true,
      sharedActionKind: 'close',
      status: 'supported',
      expectedOutcomes: [],
      failOutcomes: ['no_observed_change'],
      unknownHandling: 'tool_closeout_requires_browser_hygiene_evidence',
      reason: 'close_shared_action_kind_supported_by_tool_closeout',
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

export type RegionStatePostconditionKind =
  | 'menu_opened'
  | 'menu_closed'
  | 'search_results_updated'
  | 'detail_opened'
  | 'login_completed'
  | 'logout_completed'
  | 'qr_waiting';

export interface RegionStatePostconditionInput {
  kind: RegionStatePostconditionKind;
  actionId: string;
  beforeRegions: readonly ReadPageRegion[];
  afterRegions: readonly ReadPageRegion[];
  targetRefs?: readonly string[] | null;
  now?: () => number;
}

export interface RegionStatePostconditionResult {
  actionId: string;
  kind: RegionStatePostconditionKind;
  verdict: PostconditionVerdict;
  reason: string;
  beforeSummary: string[];
  afterSummary: string[];
  producedAtMs: number;
  claimBoundary: string;
  detailFieldReadbackEvidence?: RegionStateDetailFieldReadbackEvidence | null;
}

export type RegionStateDetailFieldReadbackStatus =
  | 'structured_fields_present'
  | 'partial_fields_only'
  | 'not_available';

export type RegionStateDetailSemanticMatchStatus =
  | 'matched'
  | 'not_matched'
  | 'before_text_missing'
  | 'after_text_missing'
  | 'not_applicable';

export interface RegionStateDetailFieldReadbackEvidence {
  kind: 'detail_field_readback';
  status: RegionStateDetailFieldReadbackStatus;
  targetBindingProven: boolean;
  semanticMatch: RegionStateDetailSemanticMatchStatus;
  canSupportDetailSummary: boolean;
  fieldCounts: {
    totalStructuredObjects: number;
    titleLikeObjects: number;
    bodyLikeObjects: number;
    metadataLikeObjects: number;
    actionableObjects: number;
  };
  nextRequiredCheck:
    | 'detail_fields_ready_for_summary'
    | 'fresh_detail_read_or_more_structured_fields_required'
    | 'target_binding_required_before_detail_summary';
  claimBoundary: string;
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

export function verifyRegionStatePostcondition(
  input: RegionStatePostconditionInput,
): RegionStatePostconditionResult {
  const producedAtMs = input.now ? input.now() : Date.now();
  const beforeSummary = summarizeRegions(input.beforeRegions);
  const afterSummary = summarizeRegions(input.afterRegions);
  const result = verdictForRegionState(
    input.kind,
    input.beforeRegions,
    input.afterRegions,
    input.targetRefs,
  );

  return {
    actionId: input.actionId,
    kind: input.kind,
    verdict: result.verdict,
    reason: result.reason,
    beforeSummary,
    afterSummary,
    producedAtMs,
    claimBoundary:
      'region-state postconditions require before/after page-region evidence; click success, timeout, or QR presence alone is not business success',
    ...(result.detailFieldReadbackEvidence
      ? { detailFieldReadbackEvidence: result.detailFieldReadbackEvidence }
      : {}),
  };
}

export function inferRegionStatePostconditionKindForIntent(input: {
  intent?: ReadPageCandidateActionIntent | string | null;
  actionKind?: ActionKind | null;
}): RegionStatePostconditionKind | null {
  const intent = String(input.intent ?? '').trim();
  if (input.actionKind === 'fill' && intent === 'search.enter_query') return null;
  if (intent === 'search.submit') return 'search_results_updated';
  if (intent === 'content.open_detail') return 'detail_opened';
  return null;
}

function verdictForRegionState(
  kind: RegionStatePostconditionKind,
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
  targetRefs?: readonly string[] | null,
): {
  verdict: PostconditionVerdict;
  reason: string;
  detailFieldReadbackEvidence?: RegionStateDetailFieldReadbackEvidence | null;
} {
  if (afterRegions.length === 0) {
    return { verdict: 'unknown', reason: 'after_region_evidence_missing' };
  }

  switch (kind) {
    case 'menu_opened':
      return verdictForMenuOpened(beforeRegions, afterRegions);
    case 'menu_closed':
      return verdictForMenuClosed(beforeRegions, afterRegions);
    case 'search_results_updated':
      return verdictForSearchResultsUpdated(beforeRegions, afterRegions);
    case 'detail_opened':
      return verdictForDetailOpened(beforeRegions, afterRegions, targetRefs);
    case 'login_completed':
      return verdictForLoginCompleted(beforeRegions, afterRegions);
    case 'logout_completed':
      return verdictForLogoutCompleted(beforeRegions, afterRegions);
    case 'qr_waiting':
      return verdictForQrWaiting(afterRegions);
  }
}

function verdictForMenuOpened(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
): { verdict: PostconditionVerdict; reason: string } {
  const beforeMenu = regionsByType(beforeRegions, 'menu');
  const afterMenu = regionsByType(afterRegions, 'menu');
  if (afterMenu.length === 0) return { verdict: 'failed', reason: 'menu_region_not_visible_after' };

  const beforeActionIds = new Set(beforeMenu.flatMap((region) => region.candidateActionIds));
  const afterActionIds = new Set(afterMenu.flatMap((region) => region.candidateActionIds));
  const gainedAction = [...afterActionIds].some((id) => !beforeActionIds.has(id));
  const afterExpanded = afterMenu.some((region) =>
    ['expanded', 'expanded_candidate', 'action_available_candidate', 'open_candidate'].includes(
      region.state,
    ),
  );
  if (afterExpanded && (gainedAction || beforeMenu.length === 0)) {
    return { verdict: 'passed', reason: 'menu_region_expanded_or_actions_appeared' };
  }
  return { verdict: 'unknown', reason: 'menu_state_change_not_proven' };
}

function verdictForMenuClosed(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
): { verdict: PostconditionVerdict; reason: string } {
  const beforeMenu = regionsByType(beforeRegions, 'menu');
  const afterMenu = regionsByType(afterRegions, 'menu');
  if (beforeMenu.length === 0)
    return { verdict: 'unknown', reason: 'before_menu_evidence_missing' };
  if (afterMenu.length === 0) return { verdict: 'passed', reason: 'menu_region_disappeared' };
  const beforeHadActions = beforeMenu.some((region) => region.candidateActionIds.length > 0);
  const afterHadActions = afterMenu.some((region) => region.candidateActionIds.length > 0);
  if (beforeHadActions && !afterHadActions) {
    return { verdict: 'passed', reason: 'menu_actions_disappeared' };
  }
  return { verdict: 'unknown', reason: 'menu_close_state_change_not_proven' };
}

function verdictForSearchResultsUpdated(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
): { verdict: PostconditionVerdict; reason: string } {
  const beforeCollections = contentCollectionRegions(beforeRegions);
  const afterCollections = contentCollectionRegions(afterRegions);
  if (afterCollections.length === 0) {
    return { verdict: 'failed', reason: 'result_collection_not_visible_after' };
  }

  const beforeStructuredCollections = beforeCollections.filter(hasStructuredSearchResultEvidence);
  const afterStructuredCollections = afterCollections.filter(hasStructuredSearchResultEvidence);
  if (afterStructuredCollections.length === 0) {
    return { verdict: 'unknown', reason: 'structured_result_evidence_missing_after_action' };
  }

  if (beforeStructuredCollections.length === 0) {
    return { verdict: 'passed', reason: 'result_collection_appeared_after_action' };
  }

  const beforeSignature = collectionSignature(beforeStructuredCollections);
  const afterSignature = collectionSignature(afterStructuredCollections);
  if (beforeSignature !== afterSignature) {
    return { verdict: 'passed', reason: 'result_collection_changed_after_action' };
  }

  return { verdict: 'failed', reason: 'result_collection_unchanged_after_action' };
}

function verdictForDetailOpened(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
  targetRefs?: readonly string[] | null,
): {
  verdict: PostconditionVerdict;
  reason: string;
  detailFieldReadbackEvidence?: RegionStateDetailFieldReadbackEvidence | null;
} {
  const beforeCollections = contentCollectionRegions(beforeRegions);
  if (beforeCollections.length === 0) {
    return {
      verdict: 'unknown',
      reason: 'before_result_collection_evidence_missing',
      detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
        targetBindingProven: false,
        semanticMatch: 'not_applicable',
        afterDetailRegions: [],
      }),
    };
  }

  const beforeTargetableCollections = beforeCollections.filter(
    (region) => targetableResultObjects(region).length >= 1,
  );
  if (beforeTargetableCollections.length === 0) {
    return {
      verdict: 'unknown',
      reason: 'before_structured_result_evidence_missing',
      detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
        targetBindingProven: false,
        semanticMatch: 'not_applicable',
        afterDetailRegions: [],
      }),
    };
  }

  const actionTargetRefs = normalizeTargetRefs(targetRefs);
  if (actionTargetRefs.length === 0) {
    return {
      verdict: 'unknown',
      reason: 'before_target_row_identity_not_proven',
      detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
        targetBindingProven: false,
        semanticMatch: 'not_applicable',
        afterDetailRegions: [],
      }),
    };
  }
  const matchedTargetObject = findMatchingTargetableResultObject(
    beforeTargetableCollections,
    actionTargetRefs,
  );
  if (!matchedTargetObject) {
    return {
      verdict: 'unknown',
      reason: 'before_target_row_identity_not_proven',
      detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
        targetBindingProven: false,
        semanticMatch: 'not_applicable',
        afterDetailRegions: [],
      }),
    };
  }

  const afterDetail = contentDetailRegions(afterRegions);
  if (afterDetail.length > 0) {
    const afterStructuredDetail = afterDetail.filter(hasStructuredContentDetailEvidence);
    const targetBindingProven = true;
    if (afterStructuredDetail.length === 0) {
      return {
        verdict: 'unknown',
        reason: 'structured_detail_evidence_missing_after_action',
        detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
          targetBindingProven,
          semanticMatch: 'after_text_missing',
          afterDetailRegions: afterStructuredDetail,
        }),
      };
    }
    const semanticMatch = detailSemanticMatchStatus(matchedTargetObject, afterStructuredDetail);
    const detailFieldReadbackEvidence = buildDetailFieldReadbackEvidence({
      targetBindingProven,
      semanticMatch,
      afterDetailRegions: afterStructuredDetail,
    });
    if (semanticMatch === 'before_text_missing') {
      return {
        verdict: 'unknown',
        reason: 'before_target_row_semantic_text_missing',
        detailFieldReadbackEvidence,
      };
    }
    if (semanticMatch === 'after_text_missing') {
      return {
        verdict: 'unknown',
        reason: 'detail_semantic_text_missing_after_action',
        detailFieldReadbackEvidence,
      };
    }
    if (semanticMatch === 'not_matched') {
      return {
        verdict: 'unknown',
        reason: 'detail_semantic_match_not_proven_after_action',
        detailFieldReadbackEvidence,
      };
    }
    if (!detailFieldReadbackEvidence.canSupportDetailSummary) {
      return {
        verdict: 'unknown',
        reason: 'detail_field_readback_not_ready_for_summary',
        detailFieldReadbackEvidence,
      };
    }
    return {
      verdict: 'passed',
      reason: 'content_detail_region_semantic_match_after_action',
      detailFieldReadbackEvidence,
    };
  }

  const afterCollections = contentCollectionRegions(afterRegions);
  if (afterCollections.length > 0) {
    const beforeSignature = collectionSignature(beforeTargetableCollections);
    const afterSignature = collectionSignature(afterCollections);
    if (beforeSignature === afterSignature) {
      return {
        verdict: 'failed',
        reason: 'detail_collection_unchanged_after_action',
        detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
          targetBindingProven: true,
          semanticMatch: 'not_applicable',
          afterDetailRegions: [],
        }),
      };
    }
    return {
      verdict: 'unknown',
      reason: 'detail_open_not_proven_collection_changed_without_detail',
      detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
        targetBindingProven: true,
        semanticMatch: 'not_applicable',
        afterDetailRegions: [],
      }),
    };
  }

  return {
    verdict: 'unknown',
    reason: 'detail_region_evidence_missing_after_action',
    detailFieldReadbackEvidence: buildDetailFieldReadbackEvidence({
      targetBindingProven: true,
      semanticMatch: 'not_applicable',
      afterDetailRegions: [],
    }),
  };
}

function buildDetailFieldReadbackEvidence(input: {
  targetBindingProven: boolean;
  semanticMatch: RegionStateDetailSemanticMatchStatus;
  afterDetailRegions: readonly ReadPageRegion[];
}): RegionStateDetailFieldReadbackEvidence {
  const counts = countStructuredDetailFields(input.afterDetailRegions);
  const canSupportDetailSummary =
    input.targetBindingProven &&
    input.semanticMatch === 'matched' &&
    (counts.bodyLikeObjects > 0 || counts.titleLikeObjects > 0) &&
    counts.totalStructuredObjects > 0;
  const status: RegionStateDetailFieldReadbackStatus =
    counts.totalStructuredObjects === 0
      ? 'not_available'
      : canSupportDetailSummary
        ? 'structured_fields_present'
        : 'partial_fields_only';
  const nextRequiredCheck = input.targetBindingProven
    ? canSupportDetailSummary
      ? 'detail_fields_ready_for_summary'
      : 'fresh_detail_read_or_more_structured_fields_required'
    : 'target_binding_required_before_detail_summary';

  return {
    kind: 'detail_field_readback',
    status,
    targetBindingProven: input.targetBindingProven,
    semanticMatch: input.semanticMatch,
    canSupportDetailSummary,
    fieldCounts: counts,
    nextRequiredCheck,
    claimBoundary:
      'detail field readback proves only structured visible detail objects and target semantic match; it does not prove full article completeness, ranking accuracy, or private live-site acceptance',
  };
}

function countStructuredDetailFields(
  regions: readonly ReadPageRegion[],
): RegionStateDetailFieldReadbackEvidence['fieldCounts'] {
  const counts = {
    totalStructuredObjects: 0,
    titleLikeObjects: 0,
    bodyLikeObjects: 0,
    metadataLikeObjects: 0,
    actionableObjects: 0,
  };
  for (const region of regions) {
    for (const object of region.objects) {
      if (!isStructuredContentDetailObject(object)) continue;
      counts.totalStructuredObjects += 1;
      const objectType = String(object.objectType || '').toLowerCase();
      if (/^(title|heading|header)$/.test(objectType)) counts.titleLikeObjects += 1;
      if (
        /^(doc_block|record|entry|content_body|article|paragraph|body|description|summary)$/.test(
          objectType,
        )
      ) {
        counts.bodyLikeObjects += 1;
      }
      if (/^(meta|metadata|author|time|date|tag|stat|metric)$/.test(objectType)) {
        counts.metadataLikeObjects += 1;
      }
      const actionTypes = Array.isArray(object.actionTypes) ? object.actionTypes : [];
      if (object.targetRef || actionTypes.length > 0) counts.actionableObjects += 1;
    }
  }
  return counts;
}

function normalizeTargetRefs(targetRefs?: readonly string[] | null): string[] {
  const refs = new Set<string>();
  for (const ref of targetRefs ?? []) {
    if (typeof ref !== 'string') continue;
    const trimmed = ref.trim();
    if (trimmed) refs.add(trimmed);
  }
  return [...refs];
}

function findMatchingTargetableResultObject(
  regions: readonly ReadPageRegion[],
  targetRefs: readonly string[],
): ReadPageRegion['objects'][number] | null {
  const expected = new Set(targetRefs);
  for (const region of regions) {
    for (const object of targetableResultObjects(region)) {
      const targetRef = typeof object.targetRef === 'string' ? object.targetRef : '';
      const objectId = typeof object.objectId === 'string' ? object.objectId : '';
      if (expected.has(targetRef) || expected.has(objectId)) return object;
    }
  }
  return null;
}

function verdictForLoginCompleted(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
): { verdict: PostconditionVerdict; reason: string } {
  const beforeAuth = hasAuthPrompt(beforeRegions) || hasLoggedOutAccount(beforeRegions);
  const afterAccount = regionsByType(afterRegions, 'account').some(
    (region) => region.state === 'logged_in_candidate',
  );
  const afterAuthPrompt = hasAuthPrompt(afterRegions);
  if (beforeAuth && afterAccount && !afterAuthPrompt) {
    return { verdict: 'passed', reason: 'account_region_appeared_after_auth_prompt' };
  }
  if (afterAuthPrompt) return { verdict: 'unknown', reason: 'auth_prompt_still_present' };
  return { verdict: 'unknown', reason: 'login_state_change_not_proven' };
}

function verdictForLogoutCompleted(
  beforeRegions: readonly ReadPageRegion[],
  afterRegions: readonly ReadPageRegion[],
): { verdict: PostconditionVerdict; reason: string } {
  const beforeLoggedIn = regionsByType(beforeRegions, 'account').some(
    (region) => region.state === 'logged_in_candidate',
  );
  if (!beforeLoggedIn) return { verdict: 'unknown', reason: 'before_logged_in_evidence_missing' };
  if (hasLoggedOutAccount(afterRegions) || hasAuthPrompt(afterRegions)) {
    return { verdict: 'passed', reason: 'logged_out_or_auth_prompt_visible_after' };
  }
  const afterLoggedIn = regionsByType(afterRegions, 'account').some(
    (region) => region.state === 'logged_in_candidate',
  );
  if (afterLoggedIn) return { verdict: 'failed', reason: 'account_region_still_logged_in' };
  return { verdict: 'unknown', reason: 'logout_state_change_not_proven' };
}

function verdictForQrWaiting(afterRegions: readonly ReadPageRegion[]): {
  verdict: PostconditionVerdict;
  reason: string;
} {
  const qrRegion = regionsByType(afterRegions, 'qr_code').find((region) =>
    ['waiting_scan_candidate', 'waiting_scan', 'refreshed'].includes(region.state),
  );
  if (qrRegion) return { verdict: 'passed', reason: 'qr_region_waiting_for_scan' };
  return { verdict: 'unknown', reason: 'qr_waiting_state_not_proven' };
}

function contentCollectionRegions(regions: readonly ReadPageRegion[]): ReadPageRegion[] {
  return regions.filter(isContentCollectionRegion);
}

function isContentCollectionRegion(region: ReadPageRegion): boolean {
  if (region.regionType !== 'content') return false;
  const targetableRecords = targetableResultObjects(region);
  if (targetableRecords.length >= 2) return true;

  const state = region.state.toLowerCase();
  return (
    /(?:result|list|collection|results)_/.test(`${state}_`) &&
    (region.candidateActionIds.length >= 2 || targetableRecords.length >= 1)
  );
}

function hasStructuredSearchResultEvidence(region: ReadPageRegion): boolean {
  return targetableResultObjects(region).length >= 2;
}

function targetableResultObjects(region: ReadPageRegion): ReadPageRegion['objects'] {
  return region.objects.filter((object) => {
    const objectType = String(object.objectType || '').toLowerCase();
    const looksLikeResultObject =
      objectType === 'record' || objectType === 'entry' || objectType === 'content_collection';
    if (!looksLikeResultObject) return false;
    return object.targetability === 'target_ref' || Boolean(object.targetRef);
  });
}

function hasStructuredContentDetailEvidence(region: ReadPageRegion): boolean {
  return region.objects.some(isStructuredContentDetailObject);
}

function isStructuredContentDetailObject(regionObject: ReadPageRegion['objects'][number]): boolean {
  const objectType = String(regionObject.objectType || '').toLowerCase();
  const looksLikeDetailContent =
    objectType === 'doc_block' ||
    objectType === 'record' ||
    objectType === 'entry' ||
    objectType === 'content_body' ||
    objectType === 'article' ||
    objectType === 'paragraph' ||
    objectType === 'title' ||
    objectType === 'heading' ||
    objectType === 'header' ||
    objectType === 'body' ||
    objectType === 'description' ||
    objectType === 'summary' ||
    objectType === 'meta' ||
    objectType === 'metadata' ||
    objectType === 'author' ||
    objectType === 'time' ||
    objectType === 'date' ||
    objectType === 'tag' ||
    objectType === 'stat' ||
    objectType === 'metric';
  const confidence = typeof regionObject.confidence === 'number' ? regionObject.confidence : 0;
  return (
    looksLikeDetailContent &&
    Boolean(regionObject.objectId || regionObject.label) &&
    confidence >= 0.5
  );
}

function detailSemanticMatchStatus(
  beforeTargetObject: ReadPageRegion['objects'][number],
  afterDetailRegions: readonly ReadPageRegion[],
): 'matched' | 'not_matched' | 'before_text_missing' | 'after_text_missing' {
  const beforeTerms = semanticTermsForText(beforeTargetObject.label);
  if (beforeTerms.length === 0) return 'before_text_missing';

  const afterText = afterDetailRegions
    .flatMap((region) => [region.label || '', ...region.objects.map((object) => object.label)])
    .join(' ');
  const afterTerms = new Set(semanticTermsForText(afterText));
  if (afterTerms.size === 0) return 'after_text_missing';

  const afterNormalized = normalizeSemanticText(afterText);
  const matchCount = beforeTerms.filter(
    (term) => afterTerms.has(term) || afterNormalized.includes(term),
  ).length;
  const requiredMatchCount = beforeTerms.length <= 2 ? 1 : 2;
  return matchCount >= requiredMatchCount ? 'matched' : 'not_matched';
}

const GENERIC_DETAIL_SEMANTIC_TERMS = new Set([
  'body',
  'candidate',
  'content',
  'detail',
  'entry',
  'item',
  'record',
  'redacted',
  'result',
  'results',
  'row',
  'rows',
  'visible',
  'view',
]);

function semanticTermsForText(text: string | undefined): string[] {
  const normalized = normalizeSemanticText(text || '');
  if (!normalized) return [];
  const terms = [
    ...(normalized.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []),
    ...(normalized.match(/[\u3400-\u9fff]{2,}/g) ?? []),
  ];
  return Array.from(
    new Set(terms.filter((term) => !GENERIC_DETAIL_SEMANTIC_TERMS.has(term) && term.length >= 2)),
  ).slice(0, 8);
}

function normalizeSemanticText(text: string): string {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u3400-\u9fff]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentDetailRegions(regions: readonly ReadPageRegion[]): ReadPageRegion[] {
  return regions.filter((region) => {
    if (region.regionType !== 'content') return false;
    const state = region.state.toLowerCase();
    const id = region.regionId.toLowerCase();
    const label = String(region.label || '').toLowerCase();
    const hasDetailState = [state, id, label].some((value) =>
      /(?:^|[_\W])(?:detail|article|record_view|item_view|content_body)(?:$|[_\W])/.test(value),
    );
    if (!hasDetailState) return false;

    const stillLooksLikeCollection = isContentCollectionRegion(region);
    return !stillLooksLikeCollection;
  });
}

function collectionSignature(regions: readonly ReadPageRegion[]): string {
  return regions
    .map((region) => {
      const objectRefs = region.objects
        .map((object) => object.targetRef || object.objectId)
        .filter(Boolean)
        .sort()
        .join(',');
      const actions = region.candidateActionIds.slice().sort().join(',');
      return `${region.regionId}:${region.state}:${objectRefs}:${actions}`;
    })
    .sort()
    .join('|');
}

function regionsByType(
  regions: readonly ReadPageRegion[],
  regionType: ReadPageRegion['regionType'],
): ReadPageRegion[] {
  return regions.filter((region) => region.regionType === regionType);
}

function hasAuthPrompt(regions: readonly ReadPageRegion[]): boolean {
  return regions.some(
    (region) =>
      (region.regionType === 'modal' && region.state === 'open_candidate') ||
      (region.regionType === 'qr_code' &&
        ['waiting_scan_candidate', 'waiting_scan', 'refreshed'].includes(region.state)),
  );
}

function hasLoggedOutAccount(regions: readonly ReadPageRegion[]): boolean {
  return regionsByType(regions, 'account').some(
    (region) => region.state === 'logged_out_candidate',
  );
}

function summarizeRegions(regions: readonly ReadPageRegion[]): string[] {
  return regions.map((region) =>
    [
      region.regionType,
      region.state,
      region.targetability,
      `actions:${region.candidateActionIds.length}`,
    ].join(':'),
  );
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
    case 'close':
      return verdictFromOutcome(outcome, []);
    case 'read':
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
  if (actionKind === 'read') return 'read_success_requires_structured_read_gate_evidence';
  if (actionKind === 'keyboard') return 'keyboard_not_supported';
  if (actionKind === 'unknown') return 'unknown_action_kind';
  if (verdict === 'passed') return `outcome_supports_${actionKind}`;
  if (verdict === 'failed' && actionKind === 'fill') {
    return 'form_input_state_change_not_proven';
  }
  if (verdict === 'failed' && actionKind === 'submit') {
    return 'form_submit_or_search_results_not_proven';
  }
  if (verdict === 'failed') return 'no_relevant_effect_observed';
  return `outcome_inconclusive_${outcome}`;
}
