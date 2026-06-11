/**
 * Task Session Context + Read Budget.
 *
 * Per-task in-process state for the `chrome_read_page` hot path. The
 * goal is to stop redundant DOM reads from accumulating cost while
 * keeping the first read of a page on the legacy bridge path.
 *
 * Hard rules implemented here:
 *
 * 1. Default initial layer for any allowed read is `L0+L1` — fallback paths
 *    are NOT allowed to enter the DOM at L2; they earn the L2 budget only
 *    after L0+L1 produced a verifier or
 *    target-evidence signal that demands it.
 * 2. Read budget is configurable via `TABRIX_READ_BUDGET_PER_TASK`
 *    (positive integer; falls back to 6).
 * 3. URL OR pageRole change invalidates `lastReadLayer`,
 *    `lastReadRequestKey`, and `targetRefsSeen` so a fresh page on the same
 *    task starts clean.
 * 4. Layer demotion (e.g. `L0+L1+L2 → L0`) is allowed but flagged via
 *    `reason='layer_demotion'` so callers can surface the warning.
 *
 * Pure module: no IO, no SQLite, no React/Vue. State lives only in
 * the parent `SessionManager` instance and is reset on
 * `finishSession`. Process restart resets cleanly because nothing is
 * persisted; task session context is a runtime cap, not a persisted
 * budget.
 */

import {
  type ActionKind,
  type BrowserSourceTruthChain,
  buildBrowserPageProjectionDelta,
  compareReadPageObjectLifecycleSummaries,
  type BrowserDataSourceDecisionEvidence,
  type BrowserPageChangeCause,
  type BrowserPageProjectionDeltaEvidenceBoundary,
  type BrowserPageProjectionDelta,
  type BrowserPageThingProjection,
  type ReadPageCandidateActionIntent,
  type ReadPageAuthResumeVerification,
  type ReadPageObjectLifecycleSummary,
  type ReadPageRegion,
  type ReadPageRequestedLayer,
  type PostconditionVerdict,
} from '@tabrix/shared';
import type {
  LiveObservedApiData,
  LiveObservedApiEvidence,
} from '../api-knowledge/live-observed-data';
import type { RouterDomRegionRowsEvidence } from './data-source-router';
import type { ChooseContextDecisionSnapshot, SkipReadSourceKind } from './skip-read-orchestrator';

/**
 * Default read budget per task. Sized to "a small handful of fresh
 * reads is fine, more than that is almost certainly a runaway loop"
 * baseline. Override via `TABRIX_READ_BUDGET_PER_TASK`.
 */
export const DEFAULT_READ_BUDGET_PER_TASK = 6;

/**
 * Hard upper bound for the env override. Anything larger almost
 * certainly indicates a typo (e.g. `60` instead of `6`) so we cap at
 * 100 — large enough that any legitimate workflow we've measured
 * fits under it, small enough that a runaway client cannot starve
 * the bridge by accident.
 */
const READ_BUDGET_HARD_CAP = 100;
const MAX_LIVE_OBSERVED_CONTEXT_ENTRIES = 10;
const MAX_LIFECYCLE_TIMELINE_EVENTS = 50;
const MAX_REGION_STATE_POSTCONDITIONS_FOR_CLOSEOUT = 8;
const DEFAULT_TOP_N_ACCUMULATION_TARGET = 10;

function inferProjectionEvidenceBoundary(
  projection: BrowserPageThingProjection,
): BrowserPageProjectionDeltaEvidenceBoundary {
  if (
    Number.isInteger(projection.tabId) &&
    projection.tabId > 0 &&
    projection.pageId === `tab:${projection.tabId}`
  ) {
    return { evidenceLevel: 'real_browser', realBrowserClaim: true };
  }
  return { evidenceLevel: 'integration', realBrowserClaim: false };
}

/**
 * Closed enum for `chosenSource` on a `chrome_read_page` outcome we
 * have actually observed. Mirrors `BenchmarkLayerSourceRoute` in
 * spirit — we keep them decoupled because the runtime needs to
 * survive an unknown source string from a malformed extension reply
 * without crashing. Open-ended at the API boundary, narrowed to a
 * union here for type-safety on the gate's own bookkeeping.
 */
export type TaskReadSource =
  | 'dom_json'
  | 'dom_region_rows'
  | 'markdown_projection'
  | 'knowledge_api'
  | 'unknown';

export interface TaskVisibleRegionRow {
  rowId?: string;
  title: string;
  primaryText: string | null;
  secondaryText: string | null;
  summary?: string | null;
  metaText: string | null;
  interactionText: string | null;
  visibleTextFields?: string[];
  targetRef: string | null;
  targetRefCoverageRate?: number | null;
  boundingBox?: {
    x: number | null;
    y: number | null;
    width: number | null;
    height: number | null;
  } | null;
  regionId?: string;
  sourceRegion: string;
  confidence: number;
  qualityReasons?: string[];
}

export interface TaskVisibleRegionRowsData extends RouterDomRegionRowsEvidence {
  sourceDataSource: 'dom_region_rows';
  sourceTabId?: number | null;
  rows: TaskVisibleRegionRow[];
  visibleRegionRowsUsed: boolean;
  visibleRegionRowsRejectedReason: string | null;
  sourceRegion: string;
  rowExtractionConfidence: number;
  cardExtractorUsed: boolean;
  cardPatternConfidence: number;
  cardRowsCount: number;
  rowOrder: 'visual_order';
  regionQualityScore?: number | null;
  visibleDomRowsCandidateCount?: number;
  visibleDomRowsSelectedCount?: number;
  lowValueRegionRejectedCount?: number;
  footerLikeRejectedCount?: number;
  navigationLikeRejectedCount?: number;
  targetRefCoverageRejectedCount?: number;
  rejectedRegionReasonDistribution?: Record<string, number>;
}

export type TaskTopNAccumulationStatus = 'ready_for_default_top_n' | 'partial_accumulated_rows';
export type TaskTopNFieldCoverageStatus =
  | 'structured_summary_fields_ready'
  | 'title_only_fields'
  | 'insufficient_title_fields';
export type TaskTopNCollectionGuidanceStatus =
  | 'ready'
  | 'needs_more_rows'
  | 'needs_structured_fields'
  | 'needs_unique_target_refs'
  | 'needs_stable_single_snapshot';
export type TaskTopNCollectionRequiredNextAction =
  | 'summarize_current_top_n'
  | 'fresh_read_after_scroll_or_page_advance'
  | 'collect_structured_fields_or_open_detail'
  | 'collect_more_unique_target_refs'
  | 'collect_stable_single_snapshot';

export interface TaskTopNCollectionGuidance {
  status: TaskTopNCollectionGuidanceStatus;
  requiredNextAction: TaskTopNCollectionRequiredNextAction;
  recommendedTool: 'chrome_read_page';
  sameTabRequired: boolean;
  forceRefreshRequired: boolean;
  requiresNewObservedRows: boolean;
  scrollToolSuccessIsNotBusinessSuccess: boolean;
  instruction: string;
  claimBoundary: string;
}

export interface TaskDomRegionRowsReadbackAccumulationEvidence {
  status: TaskTopNAccumulationStatus;
  defaultTopN: number;
  accumulationScope: 'task_tab_source_region';
  sourceTabId: number | null;
  sourceRegion: string;
  observedReadCount: number;
  currentReadReliableRowCount: number;
  currentReadTargetableRowCount: number;
  currentReadSummarizableRowCount: number;
  currentReadTitleRowCount: number;
  currentReadSupportingTextRowCount: number;
  currentReadMetadataRowCount: number;
  currentReadDeliverableRowCount: number;
  currentReadUniqueTargetRefCount: number;
  currentReadCanSupportDefaultTopNDelivery: boolean;
  currentReadNewUniqueRowCount: number;
  duplicateReliableRowCount: number;
  uniqueReliableRowCount: number;
  uniqueTargetableRowCount: number;
  uniqueSummarizableRowCount: number;
  uniqueTitleRowCount: number;
  uniqueSupportingTextRowCount: number;
  uniqueMetadataRowCount: number;
  uniqueDeliverableRowCount: number;
  uniqueTargetRefCount: number;
  rowOrder: 'visual_order';
  canSatisfyDefaultTopN: boolean;
  missingRowCountForDefaultTopN: number;
  canSupportDefaultTopNSummary: boolean;
  missingSummarizableRowCountForDefaultTopN: number;
  fieldCoverageStatus: TaskTopNFieldCoverageStatus;
  canSupportDefaultTopNFieldSummary: boolean;
  missingTitleRowCountForDefaultTopN: number;
  missingDeliverableRowCountForDefaultTopN: number;
  canSupportDefaultTopNDelivery: boolean;
  missingUniqueTargetRefCountForDefaultTopN: number;
  hasSingleReadDefaultTopNDeliveryEvidence: boolean;
  deliveryNextRequiredCheck:
    | 'top_n_delivery_ready'
    | 'collect_more_rows_before_top_n_delivery'
    | 'collect_structured_fields_before_top_n_delivery'
    | 'collect_more_unique_target_refs_before_top_n_delivery'
    | 'collect_stable_single_snapshot_before_top_n_delivery';
  summaryQualityNextRequiredCheck:
    | 'structured_top_n_summary_ready'
    | 'collect_supporting_text_or_detail_before_rich_summary'
    | 'collect_more_titled_rows_before_top_n_summary';
  nextRequiredCheck:
    | 'accumulated_rows_ready_for_top_n_summary'
    | 'scroll_or_request_more_rows_before_claiming_top_n_complete';
  summaryNextRequiredCheck:
    | 'top_n_summary_ready'
    | 'more_rows_or_text_fields_required_before_top_n_summary';
  collectionGuidance: TaskTopNCollectionGuidance;
  claimBoundary: string;
}

interface TaskDomRegionRowsReadbackAccumulator {
  scopeKey: string;
  sourceTabId: number | null;
  sourceRegion: string;
  observedReadCount: number;
  uniqueRowKeys: Set<string>;
  uniqueTargetableRowKeys: Set<string>;
  uniqueSummarizableRowKeys: Set<string>;
  uniqueTitleRowKeys: Set<string>;
  uniqueSupportingTextRowKeys: Set<string>;
  uniqueMetadataRowKeys: Set<string>;
  uniqueDeliverableRowKeys: Set<string>;
  uniqueTargetRefs: Set<string>;
  hasSingleReadDefaultTopNDeliveryEvidence: boolean;
  lastEvidence: TaskDomRegionRowsReadbackAccumulationEvidence | null;
}

/**
 * `shouldAllowReadPage` answer. Always returns a `suggestedLayer` so
 * callers do not need to re-derive the first-read default (`L0+L1`).
 */
export interface ShouldAllowReadPageResult {
  /**
   * `false` only when the task is over budget. Layer demotions and
   * "no fresh evidence" reads are allowed but flagged via `reason`.
   */
  allowed: boolean;
  /**
   * Human-readable justification. Empty string when `allowed=true`
   * and there is nothing to flag.
   */
  reason: '' | 'read_budget_exceeded' | 'read_redundant' | 'layer_demotion';
  /**
   * The layer the gate thinks the caller SHOULD use, regardless of
   * what they requested. Always `'L0+L1'` for a first read on this
   * page; matches the requested layer otherwise.
   */
  suggestedLayer: ReadPageRequestedLayer;
  /**
   * Snapshot of the task's read budget after this decision so the
   * caller can put it in a structured warning payload without
   * re-reading the context.
   */
  readPageCount: number;
  readBudget: number;
}

export interface TaskPageRuntimeFields {
  currentWindowId: number | null;
  currentWindowState: import('@tabrix/shared').ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  currentTabUrl?: string | null;
  currentTabPendingUrl?: string | null;
  currentTabTitle?: string | null;
  currentTabStatus?: string | null;
  currentTabDiscarded?: boolean | null;
  currentTabAudible?: boolean | null;
  currentTabMuted?: boolean | null;
  currentTabPinned?: boolean | null;
  currentTabOpenerTabId?: number | null;
  currentTabOpenedBy?: 'ai' | 'user_or_page' | 'unknown' | null;
  currentTabOpenedBySource?: 'ai_tool' | 'page_opener' | 'user_or_unknown' | 'unknown' | null;
  currentTabOpenedByConfidence?: number | null;
  currentTabOpenedByReason?: string | null;
  currentTabAiOperationState?: 'idle' | 'recently_operated' | 'closed' | null;
  currentTabLastAiOperation?: string | null;
  currentTabLastAiOperationAtMs?: number | null;
  currentTabLastAiOperationConfidence?: number | null;
  currentTabLastAiOperationReason?: string | null;
  currentTabCanTabrixOperate?: boolean | null;
  currentTabOperabilityReason?: string | null;
  currentTabRuntimeStateSource?: 'browser_world_inventory' | 'chrome_tab_snapshot' | 'unknown';
  browserWorldObjectChangeSummary?: string | null;
  browserWorldActionableObjectChangeSummary?: string | null;
  browserWorldCurrentOperationConclusion?: string | null;
  browserWorldRoutingDecisionSummary?: string | null;
  currentPageLoadReadinessStatus?: string | null;
  currentPageStability?: string | null;
  currentPageSnapshotUsableForBusinessAction?: boolean | null;
  currentPageLoadReadinessNextStepHint?: string | null;
}

export interface NoteReadPageInput {
  layer: ReadPageRequestedLayer;
  source: TaskReadSource;
  requestKey?: string | null;
  /**
   * Stable target refs the read surfaced. Folded into `targetRefsSeen` so a
   * follow-up read for the same targets is bucketed as redundant.
   */
  targetRefs?: ReadonlyArray<string> | null;
  /**
   * API endpoint families the read absorbed (e.g. `'github_issues'`).
   * Same idea as `targetRefs` but for the Knowledge layer.
   */
  apiFamilies?: ReadonlyArray<string> | null;
}

export interface NotePageInteractionInput {
  action: string;
  tabId?: number | null;
  changeCause?: BrowserPageChangeCause | null;
  targetRefs?: ReadonlyArray<string> | null;
  candidateActionId?: string | null;
  candidateActionIntent?: ReadPageCandidateActionIntent | string | null;
  actionKind?: ActionKind | null;
}

export interface TaskPageInteractionSnapshot {
  action: string;
  tabId: number | null;
  changeCause: BrowserPageChangeCause;
  targetRefs: string[];
  candidateActionId: string | null;
  candidateActionIntent: ReadPageCandidateActionIntent | string | null;
  actionKind: ActionKind | null;
  producedAtMs: number;
  beforePageRegions: ReadPageRegion[];
}

export type TaskRegionStatePostconditionKind =
  | 'menu_opened'
  | 'menu_closed'
  | 'search_results_updated'
  | 'detail_opened'
  | 'login_completed'
  | 'logout_completed'
  | 'otp_requested'
  | 'qr_waiting';

export const DEFAULT_AUTH_USER_COLLABORATION_STALE_AFTER_MS = 10 * 60 * 1000;

export interface TaskRegionStatePostconditionResultSnapshot {
  actionId: string;
  kind: TaskRegionStatePostconditionKind;
  verdict: PostconditionVerdict;
  reason: string;
  beforeSummary: string[];
  afterSummary: string[];
  producedAtMs: number;
  claimBoundary: string;
  detailFieldReadbackEvidence?: TaskDetailFieldReadbackEvidence | null;
}

export type TaskDetailFieldReadbackStatus =
  | 'structured_fields_present'
  | 'partial_fields_only'
  | 'not_available';

export type TaskDetailSemanticMatchStatus =
  | 'matched'
  | 'not_matched'
  | 'before_text_missing'
  | 'after_text_missing'
  | 'not_applicable';

export interface TaskDetailFieldReadbackEvidence {
  kind: 'detail_field_readback';
  status: TaskDetailFieldReadbackStatus;
  targetBindingProven: boolean;
  semanticMatch: TaskDetailSemanticMatchStatus;
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

export interface TaskRegionStatePostconditionSnapshot {
  tabId: number | null;
  actionKind: ActionKind;
  result: TaskRegionStatePostconditionResultSnapshot;
}

export interface TaskRegionStatePostconditionForCloseout {
  tabId: number | null;
  actionKind: ActionKind;
  result: TaskRegionStatePostconditionResultSnapshot;
}

type TaskBusinessVerificationExpectedEvidence =
  | 'agreement_state_changed_or_dialog_present'
  | 'agreement_dialog_closed_or_terms_accepted'
  | 'otp_countdown_or_sent_feedback'
  | 'auth_surface_removed_and_account_state_present'
  | 'form_value_state_changed'
  | 'search_results_or_url_query_changed'
  | 'detail_region_or_content_transition'
  | 'page_or_object_state_changed';

interface TaskPageRegionSnapshot {
  tabId: number | null;
  pageRegions: ReadPageRegion[];
}

interface TaskVerifiedBusinessInteractionBinding {
  tabId: number | null;
  actionId: string;
  actionKind: ActionKind;
  candidateActionIntent: string | null;
  targetRefs: string[];
  postconditionKind: TaskRegionStatePostconditionKind;
  producedAtMs: number;
}

export interface TaskAuthResumeGate {
  status: ReadPageAuthResumeVerification['status'];
  nextTool: ReadPageAuthResumeVerification['nextTool'];
  forceRefreshRequired: boolean;
  sameTabRequired: boolean;
  targetTabId?: number;
  postconditionRequired: boolean;
  requiredSignals: string[];
  blocksTaskResume: boolean;
  nextStepHint:
    | 'fresh_read_same_tab_then_postcondition'
    | 'fresh_read_same_tab'
    | 'verify_postcondition_before_resume'
    | 'resume_allowed'
    | 'not_proven_stop_or_collaborate';
  reason: string;
  claimBoundary: string;
}

export type TaskResumeReadinessStatus =
  | 'resume_allowed'
  | 'blocked_by_auth_verification'
  | 'postcondition_passed_ready'
  | 'postcondition_failed_stop'
  | 'postcondition_unknown_not_proven'
  | 'not_proven';

export type TaskResumeReadinessNextStep =
  | 'continue_original_task'
  | 'force_fresh_read_same_tab'
  | 'verify_postcondition'
  | 'wait_for_user_collaboration'
  | 'stop_not_proven';

export interface TaskResumeReadinessSnapshot {
  status: TaskResumeReadinessStatus;
  canResumeOriginalTask: boolean;
  nextStep: TaskResumeReadinessNextStep;
  tabId: number | null;
  evidenceKinds: string[];
  reason: string;
  claimBoundary: string;
  handoffSummary: TaskResumeHandoffSummary;
}

export type TaskResumeHandoffStatus =
  | 'ready_to_continue'
  | 'needs_fresh_read'
  | 'needs_postcondition_verification'
  | 'waiting_for_user'
  | 'stop_not_proven';

export type TaskResumeHandoffNextAction =
  | 'continue_original_task'
  | 'run_chrome_read_page_force_refresh'
  | 'verify_business_postcondition'
  | 'wait_for_user_collaboration'
  | 'stop_and_report_not_proven';

export interface TaskResumeHandoffSummary {
  summaryKind: 'task_resume_handoff_v1';
  status: TaskResumeHandoffStatus;
  canContinue: boolean;
  nextAction: TaskResumeHandoffNextAction;
  message: string;
  evidenceSummary: {
    readinessStatus: TaskResumeReadinessStatus;
    tabId: number | null;
    evidenceKinds: string[];
  };
  claimBoundary: string;
}

/**
 * Record a successful skip-read execution. Increments
 * `taskTotals.readPageAvoidedCount` and folds `tokensSavedEstimate` into
 * `taskTotals.tokensSavedEstimateTotal`.
 *
 * NOTE the budget bookkeeping invariant: a skipped read does NOT
 * consume the per-task `readBudget`. The point is to not spend the budget on
 * a read we proved we could avoid.
 */
export interface NoteSkipReadInput {
  source: SkipReadSourceKind;
  /**
   * Layer the SKIPPED read would have demanded. Recorded here so a
   * subsequent verifier-failure escalation can detect a layer
   * downgrade (`L0+L1+L2 → L0+L1` is the hard cap).
   */
  layer: ReadPageRequestedLayer;
  /** Token cost the skip avoided. Clamped to `>= 0`. */
  tokensSavedEstimate: number;
  /**
   * Optional API endpoint family. Folded into `apiEndpointFamiliesSeen`
   * so a follow-up read on the same family is treated as redundant.
   */
  apiFamily?: string | null;
}

/**
 * Per-task aggregate counters consumed by benchmark/report emitters.
 * Read-only at the public surface; the writer is `noteSkipRead`.
 */
export interface TaskTotalsSnapshot {
  /** Number of `chrome_read_page` calls the orchestrator avoided. */
  readPageAvoidedCount: number;
  /** Sum of `tokensSavedEstimate` across all skip events on this task. */
  tokensSavedEstimateTotal: number;
}

export type TaskLifecycleEventKind =
  | 'navigation'
  | 'readiness_observed'
  | 'projection_created'
  | 'region_changed'
  | 'refs_refreshed'
  | 'refs_invalidated'
  | 'delta_created'
  | 'cleanup';

export interface TaskLifecycleEvent {
  eventId: string;
  index: number;
  at: string;
  kind: TaskLifecycleEventKind;
  url: string | null;
  pageRole: string | null;
  projectionId?: string;
  deltaId?: string;
  tabId?: number;
  changedRegions?: string[];
  reusedRegions?: string[];
  invalidatedRefs?: string[];
  refreshedRefs?: string[];
  cleanupAction?: string;
  cleanupTargetIds?: number[];
}

export interface TaskSourceRouteHonestySnapshot {
  verdict: string;
  selectedDataSource: string | null;
  reason: string;
  fallbackUsed: boolean;
  hasFactEvidence: boolean;
}

export interface ShouldAllowReadPageInput {
  /**
   * The layer the caller WANTS. The gate may suggest a different
   * layer (always `'L0+L1'` on a first read).
   */
  requestedLayer: ReadPageRequestedLayer;
  /**
   * Optional normalized read shape. Same layer + same request key may reuse
   * the cached projection; changing mode/depth/filter/ref/render requires a
   * fresh read even when the public layer string is unchanged.
   */
  requestKey?: string | null;
  /**
   * Explicitly request a real read instead of reusing cached evidence. Login
   * collaboration uses this after user-side work such as scanning a QR code
   * because that change is not caused by a Tabrix MCP action.
   */
  forceRefresh?: boolean;
}

/**
 * Resolve `TABRIX_READ_BUDGET_PER_TASK` from a process.env-shaped
 * map. Pure — accepts the env so tests do not have to mutate the
 * real `process.env`. Invalid values fall back to the default
 * silently (no warning spam — env mistypes are common and the gate
 * must keep the legacy happy path running).
 */
export function resolveReadBudgetFromEnv(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): number {
  const raw = env['TABRIX_READ_BUDGET_PER_TASK'];
  if (raw === undefined || raw === null) return DEFAULT_READ_BUDGET_PER_TASK;
  const trimmed = String(raw).trim();
  if (trimmed === '') return DEFAULT_READ_BUDGET_PER_TASK;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_READ_BUDGET_PER_TASK;
  }
  return Math.min(parsed, READ_BUDGET_HARD_CAP);
}

export interface TaskSessionContextOptions {
  /**
   * Override the read budget directly (test seam). When omitted, the
   * context resolves it from `process.env.TABRIX_READ_BUDGET_PER_TASK`
   * via `resolveReadBudgetFromEnv`.
   */
  readBudget?: number;
  /**
   * Inject the env reader (test seam — defaults to `process.env`).
   * Only consulted when `readBudget` is omitted.
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * In-memory per-task gate. Lives inside `SessionManager` keyed by
 * `taskId`. Constructed once per `startSession`, dropped on
 * `finishSession`.
 *
 * Single-threaded by design: Node's event loop guarantees that
 * `noteReadPage` and `shouldAllowReadPage` cannot interleave for the
 * same task instance, so we do not need explicit locking.
 */
export class TaskSessionContext {
  /**
   * Most recent URL we have observed via `noteUrlChange`. `null`
   * before the first navigation/read on this task.
   */
  public currentUrl: string | null = null;

  /**
   * Most recent pageRole, sourced from the page-context provider when
   * available.
   */
  public pageRole: string | null = null;

  /**
   * Layer of the most recent SUCCESSFUL read. `null` before the
   * first read OR after a URL/pageRole change invalidated it.
   */
  public lastReadLayer: ReadPageRequestedLayer | null = null;
  public lastReadRequestKey: string | null = null;

  /**
   * Source route of the most recent successful read.
   */
  public lastReadSource: TaskReadSource | null = null;

  /**
   * Stable refs we have already surfaced. A read that requests the
   * same set of refs at the same layer is bucketed as redundant.
   */
  public readonly targetRefsSeen = new Set<string>();

  /**
   * API endpoint families the Knowledge layer has already returned
   * for this task. Same redundancy idea as `targetRefsSeen`.
   */
  public readonly apiEndpointFamiliesSeen = new Set<string>();

  /**
   * Number of reads this task has actually executed (includes
   * redundant reads — they cost the bridge a round-trip even when
   * they reuse the projection). Compared against `readBudget` in
   * `shouldAllowReadPage`.
   */
  public readPageCount = 0;

  /**
   * Resolved read budget. Frozen at construction time so a mid-task
   * env mutation cannot retroactively shrink the cap underneath an
   * agent that is already half-way through a workflow.
   */
  public readonly readBudget: number;

  /**
   * Aggregate counters for the skip-read orchestrator. Mutated only by
   * `noteSkipRead`; surfaced read-only via {@link getTaskTotals}.
   */
  private _readPageAvoidedCount = 0;
  private _tokensSavedEstimateTotal = 0;
  private lastPageProjection: BrowserPageThingProjection | null = null;
  private lastSourceTruthChain: BrowserSourceTruthChain | null = null;
  private lastSourceRouteHonesty: TaskSourceRouteHonestySnapshot | null = null;
  private lastObjectLifecycle: ReadPageObjectLifecycleSummary | null = null;
  private lastPageRuntimeFields: TaskPageRuntimeFields | null = null;
  private lastPageRegionSnapshot: TaskPageRegionSnapshot | null = null;
  private lastAuthResumeGate: TaskAuthResumeGate | null = null;
  private pendingPageInteraction: TaskPageInteractionSnapshot | null = null;
  private lastConsumedPageInteractionForPostcondition: TaskPageInteractionSnapshot | null = null;
  private lastVerifiedBusinessInteractionBinding: TaskVerifiedBusinessInteractionBinding | null =
    null;
  private readonly regionStatePostconditionsForCloseout: TaskRegionStatePostconditionSnapshot[] =
    [];
  private pageProjectionDeltaCount = 0;
  private lifecycleEventCount = 0;
  private readonly lifecycleTimeline: TaskLifecycleEvent[] = [];
  private readonly runOwnedTabIds = new Set<number>();

  /**
   * Most recent `choose_context` decision recorded for this task. The
   * orchestrator MUST NOT infer a sourceRoute on its own; the chooser writes
   * the decision via {@link noteChooseContextDecision} and the
   * `chrome_read_page` shim consumes it via
   * {@link peekChooseContextDecision}.
   *
   * `null` before the chooser runs OR after a URL/pageRole change
   * invalidates the prior decision (a different page is a different
   * decision).
   */
  private _chooseContextDecision: ChooseContextDecisionSnapshot | null = null;
  private readonly liveObservedApiData: LiveObservedApiData[] = [];
  private readonly liveObservedApiEvidence: LiveObservedApiEvidence[] = [];
  private visibleRegionRows: TaskVisibleRegionRowsData | null = null;
  private domRegionRowsReadbackAccumulator: TaskDomRegionRowsReadbackAccumulator | null = null;

  constructor(options?: TaskSessionContextOptions) {
    if (options?.readBudget !== undefined) {
      const cap = options.readBudget;
      if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap <= 0) {
        throw new Error(
          `TaskSessionContext readBudget must be a positive integer, received ${String(cap)}`,
        );
      }
      this.readBudget = Math.min(cap, READ_BUDGET_HARD_CAP);
    } else {
      this.readBudget = resolveReadBudgetFromEnv(options?.env ?? process.env);
    }
  }

  /**
   * Record a navigation or first observation of a URL. When the URL
   * OR the pageRole changes, we invalidate `lastReadLayer`,
   * `lastReadSource`, and `targetRefsSeen` so a follow-up read on
   * the new page is treated as a fresh first read (still subject to
   * the budget, but not bucketed as redundant). `apiEndpointFamiliesSeen`
   * is intentionally preserved across navigations — Knowledge hits
   * are URL-agnostic on purpose.
   *
   * Idempotent: passing the same `(url, pageRole)` is a no-op.
   */
  public noteUrlChange(url: string | null, pageRole?: string | null): void {
    const nextUrl = typeof url === 'string' && url.length > 0 ? url : null;
    const nextRole = typeof pageRole === 'string' && pageRole.length > 0 ? pageRole : null;
    const urlChanged = nextUrl !== this.currentUrl;
    const roleChanged = nextRole !== null && nextRole !== this.pageRole;
    this.currentUrl = nextUrl;
    if (nextRole !== null) this.pageRole = nextRole;
    if (urlChanged || roleChanged) {
      this.lastReadLayer = null;
      this.lastReadRequestKey = null;
      this.lastReadSource = null;
      this.targetRefsSeen.clear();
      this.lastObjectLifecycle = null;
      this.lastAuthResumeGate = null;
      this.recordLifecycleEvent({
        kind: 'navigation',
        url: nextUrl,
        pageRole: nextRole,
      });
      // A stale decision against the prior page is unsafe. Drop it so the
      // orchestrator never skips a read on the new page based on a decision
      // that targeted the old one.
      this._chooseContextDecision = null;
      this.liveObservedApiData.length = 0;
      this.liveObservedApiEvidence.length = 0;
      this.visibleRegionRows = null;
      this.domRegionRowsReadbackAccumulator = null;
    }
  }

  /**
   * Record a `choose_context` decision so the `chrome_read_page` shim can ask
   * the orchestrator whether to skip the next read. The orchestrator NEVER
   * infers a route on its own; the chooser is the only authority.
   *
   * Idempotent: passing the same decision twice replaces it cheaply
   * (objects are stored by reference, not deep-cloned). Callers MUST
   * NOT mutate the snapshot after recording it.
   *
   * Pass `null` to clear the decision (e.g. after the orchestrator
   * has consumed it and the chooser knows there is no follow-up).
   */
  public noteChooseContextDecision(decision: ChooseContextDecisionSnapshot | null): void {
    this._chooseContextDecision = decision;
  }

  /**
   * Read accessor for the most recent {@link ChooseContextDecisionSnapshot}.
   * Returns `null` when no decision has been recorded for the current page
   * (either the chooser has not run, or `noteUrlChange` invalidated the prior
   * decision).
   *
   * Does NOT clear the decision — multiple reads against the same
   * page may legitimately consult the same decision (e.g. retries
   * inside the same hot path). The chooser is responsible for
   * issuing a fresh decision when it wants the gate to re-evaluate.
   */
  public peekChooseContextDecision(): ChooseContextDecisionSnapshot | null {
    return this._chooseContextDecision;
  }

  public noteLiveObservedApiData(
    data: ReadonlyArray<LiveObservedApiData>,
    evidence: ReadonlyArray<LiveObservedApiEvidence> = [],
  ): void {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      this.liveObservedApiData.unshift(cloneLiveObservedApiData(data[index]));
    }
    for (const item of evidence) {
      this.liveObservedApiEvidence.unshift({ ...item });
    }
    if (this.liveObservedApiData.length > MAX_LIVE_OBSERVED_CONTEXT_ENTRIES) {
      this.liveObservedApiData.length = MAX_LIVE_OBSERVED_CONTEXT_ENTRIES;
    }
    if (this.liveObservedApiEvidence.length > MAX_LIVE_OBSERVED_CONTEXT_ENTRIES) {
      this.liveObservedApiEvidence.length = MAX_LIVE_OBSERVED_CONTEXT_ENTRIES;
    }
  }

  public peekLiveObservedApiData(): LiveObservedApiData | null {
    const [first] = this.liveObservedApiData;
    return first ? cloneLiveObservedApiData(first) : null;
  }

  public peekLiveObservedApiEvidence(): readonly LiveObservedApiEvidence[] {
    return this.liveObservedApiEvidence.map((item) => ({ ...item }));
  }

  public noteVisibleRegionRows(data: TaskVisibleRegionRowsData | null): void {
    this.visibleRegionRows = data ? cloneVisibleRegionRowsData(data) : null;
  }

  public peekVisibleRegionRows(): TaskVisibleRegionRowsData | null {
    return this.visibleRegionRows ? cloneVisibleRegionRowsData(this.visibleRegionRows) : null;
  }

  public peekVisibleRegionRowsEvidence(): RouterDomRegionRowsEvidence | null {
    if (!this.visibleRegionRows) return null;
    return {
      available: this.visibleRegionRows.available,
      rowCount: this.visibleRegionRows.rowCount,
      confidence: this.visibleRegionRows.confidence,
      targetRefCoverageRate: this.visibleRegionRows.targetRefCoverageRate ?? null,
      regionQualityScore: this.visibleRegionRows.regionQualityScore ?? null,
      rejectedReason: this.visibleRegionRows.rejectedReason ?? null,
    };
  }

  public noteDomRegionRowsReadback(
    visibleRows: TaskVisibleRegionRowsData,
  ): TaskDomRegionRowsReadbackAccumulationEvidence {
    const sourceTabId = normalizePositiveTabId(visibleRows.sourceTabId);
    const sourceRegion =
      typeof visibleRows.sourceRegion === 'string' && visibleRows.sourceRegion.length > 0
        ? visibleRows.sourceRegion
        : 'unknown';
    const scopeKey = `${sourceTabId ?? 'unknown'}:${sourceRegion}`;
    if (
      !this.domRegionRowsReadbackAccumulator ||
      this.domRegionRowsReadbackAccumulator.scopeKey !== scopeKey
    ) {
      this.domRegionRowsReadbackAccumulator = {
        scopeKey,
        sourceTabId,
        sourceRegion,
        observedReadCount: 0,
        uniqueRowKeys: new Set<string>(),
        uniqueTargetableRowKeys: new Set<string>(),
        uniqueSummarizableRowKeys: new Set<string>(),
        uniqueTitleRowKeys: new Set<string>(),
        uniqueSupportingTextRowKeys: new Set<string>(),
        uniqueMetadataRowKeys: new Set<string>(),
        uniqueDeliverableRowKeys: new Set<string>(),
        uniqueTargetRefs: new Set<string>(),
        hasSingleReadDefaultTopNDeliveryEvidence: false,
        lastEvidence: null,
      };
    }

    const accumulator = this.domRegionRowsReadbackAccumulator;
    accumulator.observedReadCount += 1;

    const availableReliableRowCount =
      visibleRows.visibleRegionRowsUsed && visibleRows.rowCount > 0
        ? Math.min(visibleRows.rows.length, Math.floor(visibleRows.rowCount))
        : 0;
    const currentReadRowKeys = new Set<string>();
    let currentReadTargetableRowCount = 0;
    let currentReadSummarizableRowCount = 0;
    let currentReadTitleRowCount = 0;
    let currentReadSupportingTextRowCount = 0;
    let currentReadMetadataRowCount = 0;
    let currentReadDeliverableRowCount = 0;
    const currentReadTargetRefs = new Set<string>();
    const currentReadDeliverableTargetRefs = new Set<string>();

    for (const row of visibleRows.rows.slice(0, availableReliableRowCount)) {
      const key = buildDomRegionRowStableKey(row);
      if (!key) continue;
      currentReadRowKeys.add(key);
      const targetRef =
        typeof row.targetRef === 'string' && row.targetRef.length > 0 ? row.targetRef : null;
      if (targetRef) {
        currentReadTargetableRowCount += 1;
        currentReadTargetRefs.add(targetRef);
        accumulator.uniqueTargetableRowKeys.add(key);
        accumulator.uniqueTargetRefs.add(targetRef);
      }
      if (isDomRegionRowSummarizable(row)) {
        currentReadSummarizableRowCount += 1;
        accumulator.uniqueSummarizableRowKeys.add(key);
      }
      const fieldCoverage = getDomRegionRowFieldCoverage(row);
      if (fieldCoverage.hasTitle) {
        currentReadTitleRowCount += 1;
        accumulator.uniqueTitleRowKeys.add(key);
      }
      if (fieldCoverage.hasSupportingText) {
        currentReadSupportingTextRowCount += 1;
        accumulator.uniqueSupportingTextRowKeys.add(key);
      }
      if (fieldCoverage.hasMetadata) {
        currentReadMetadataRowCount += 1;
        accumulator.uniqueMetadataRowKeys.add(key);
      }
      if (
        targetRef &&
        fieldCoverage.hasTitle &&
        (fieldCoverage.hasSupportingText || fieldCoverage.hasMetadata)
      ) {
        currentReadDeliverableRowCount += 1;
        currentReadDeliverableTargetRefs.add(targetRef);
        accumulator.uniqueDeliverableRowKeys.add(key);
      }
    }

    let currentReadNewUniqueRowCount = 0;
    for (const key of currentReadRowKeys) {
      if (!accumulator.uniqueRowKeys.has(key)) currentReadNewUniqueRowCount += 1;
      accumulator.uniqueRowKeys.add(key);
    }

    const duplicateReliableRowCount = Math.max(
      0,
      currentReadRowKeys.size - currentReadNewUniqueRowCount,
    );
    const uniqueTargetableRowCount = accumulator.uniqueTargetableRowKeys.size;
    const uniqueSummarizableRowCount = accumulator.uniqueSummarizableRowKeys.size;
    const uniqueTitleRowCount = accumulator.uniqueTitleRowKeys.size;
    const uniqueSupportingTextRowCount = accumulator.uniqueSupportingTextRowKeys.size;
    const uniqueMetadataRowCount = accumulator.uniqueMetadataRowKeys.size;
    const uniqueDeliverableRowCount = accumulator.uniqueDeliverableRowKeys.size;
    const uniqueTargetRefCount = accumulator.uniqueTargetRefs.size;
    const currentReadUniqueTargetRefCount = currentReadTargetRefs.size;
    const currentReadUniqueDeliverableTargetRefCount = currentReadDeliverableTargetRefs.size;
    const currentReadCanSupportDefaultTopNDelivery =
      currentReadDeliverableRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET &&
      currentReadUniqueDeliverableTargetRefCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET;
    accumulator.hasSingleReadDefaultTopNDeliveryEvidence =
      accumulator.hasSingleReadDefaultTopNDeliveryEvidence ||
      currentReadCanSupportDefaultTopNDelivery;
    const canSatisfyDefaultTopN = uniqueTargetableRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET;
    const canSupportDefaultTopNSummary =
      uniqueSummarizableRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET;
    const canSupportDefaultTopNFieldSummary =
      uniqueDeliverableRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET;
    const canSupportDefaultTopNDelivery =
      canSatisfyDefaultTopN &&
      canSupportDefaultTopNFieldSummary &&
      uniqueTargetRefCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET &&
      accumulator.hasSingleReadDefaultTopNDeliveryEvidence;
    const missingRowCountForDefaultTopN = Math.max(
      0,
      DEFAULT_TOP_N_ACCUMULATION_TARGET - uniqueTargetableRowCount,
    );
    const missingSummarizableRowCountForDefaultTopN = Math.max(
      0,
      DEFAULT_TOP_N_ACCUMULATION_TARGET - uniqueSummarizableRowCount,
    );
    const missingTitleRowCountForDefaultTopN = Math.max(
      0,
      DEFAULT_TOP_N_ACCUMULATION_TARGET - uniqueTitleRowCount,
    );
    const missingDeliverableRowCountForDefaultTopN = Math.max(
      0,
      DEFAULT_TOP_N_ACCUMULATION_TARGET - uniqueDeliverableRowCount,
    );
    const missingUniqueTargetRefCountForDefaultTopN = Math.max(
      0,
      DEFAULT_TOP_N_ACCUMULATION_TARGET - uniqueTargetRefCount,
    );
    const fieldCoverageStatus: TaskTopNFieldCoverageStatus = canSupportDefaultTopNFieldSummary
      ? 'structured_summary_fields_ready'
      : uniqueTitleRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET
        ? 'title_only_fields'
        : 'insufficient_title_fields';
    const collectionGuidance = buildTopNAccumulationCollectionGuidance({
      canSatisfyDefaultTopN,
      canSupportDefaultTopNFieldSummary,
      canSupportDefaultTopNDelivery,
      missingRowCountForDefaultTopN,
      missingDeliverableRowCountForDefaultTopN,
      missingUniqueTargetRefCountForDefaultTopN,
      hasSingleReadDefaultTopNDeliveryEvidence:
        accumulator.hasSingleReadDefaultTopNDeliveryEvidence,
    });

    const evidence: TaskDomRegionRowsReadbackAccumulationEvidence = {
      status: canSatisfyDefaultTopN ? 'ready_for_default_top_n' : 'partial_accumulated_rows',
      defaultTopN: DEFAULT_TOP_N_ACCUMULATION_TARGET,
      accumulationScope: 'task_tab_source_region',
      sourceTabId,
      sourceRegion,
      observedReadCount: accumulator.observedReadCount,
      currentReadReliableRowCount: currentReadRowKeys.size,
      currentReadTargetableRowCount,
      currentReadSummarizableRowCount,
      currentReadTitleRowCount,
      currentReadSupportingTextRowCount,
      currentReadMetadataRowCount,
      currentReadDeliverableRowCount,
      currentReadUniqueTargetRefCount,
      currentReadCanSupportDefaultTopNDelivery,
      currentReadNewUniqueRowCount,
      duplicateReliableRowCount,
      uniqueReliableRowCount: accumulator.uniqueRowKeys.size,
      uniqueTargetableRowCount,
      uniqueSummarizableRowCount,
      uniqueTitleRowCount,
      uniqueSupportingTextRowCount,
      uniqueMetadataRowCount,
      uniqueDeliverableRowCount,
      uniqueTargetRefCount,
      rowOrder: visibleRows.rowOrder,
      canSatisfyDefaultTopN,
      missingRowCountForDefaultTopN,
      canSupportDefaultTopNSummary,
      missingSummarizableRowCountForDefaultTopN,
      fieldCoverageStatus,
      canSupportDefaultTopNFieldSummary,
      missingTitleRowCountForDefaultTopN,
      missingDeliverableRowCountForDefaultTopN,
      canSupportDefaultTopNDelivery,
      missingUniqueTargetRefCountForDefaultTopN,
      hasSingleReadDefaultTopNDeliveryEvidence:
        accumulator.hasSingleReadDefaultTopNDeliveryEvidence,
      deliveryNextRequiredCheck: canSupportDefaultTopNDelivery
        ? 'top_n_delivery_ready'
        : !canSatisfyDefaultTopN
          ? 'collect_more_rows_before_top_n_delivery'
          : !canSupportDefaultTopNFieldSummary
            ? 'collect_structured_fields_before_top_n_delivery'
            : uniqueTargetRefCount < DEFAULT_TOP_N_ACCUMULATION_TARGET
              ? 'collect_more_unique_target_refs_before_top_n_delivery'
              : 'collect_stable_single_snapshot_before_top_n_delivery',
      summaryQualityNextRequiredCheck: canSupportDefaultTopNFieldSummary
        ? 'structured_top_n_summary_ready'
        : uniqueTitleRowCount >= DEFAULT_TOP_N_ACCUMULATION_TARGET
          ? 'collect_supporting_text_or_detail_before_rich_summary'
          : 'collect_more_titled_rows_before_top_n_summary',
      nextRequiredCheck: canSatisfyDefaultTopN
        ? 'accumulated_rows_ready_for_top_n_summary'
        : 'scroll_or_request_more_rows_before_claiming_top_n_complete',
      summaryNextRequiredCheck: canSupportDefaultTopNSummary
        ? 'top_n_summary_ready'
        : 'more_rows_or_text_fields_required_before_top_n_summary',
      collectionGuidance,
      claimBoundary:
        'This proves only unique targetable and summarizable DOM rows observed during this in-memory task/session for the same tab and source region. Default Top-N delivery also requires at least one stable single-read snapshot with enough structured fields and unique targetRefs. It does not prove full result-set completeness, exact platform ranking, or rows that were never observed.',
    };
    accumulator.lastEvidence = evidence;
    return cloneTaskDomRegionRowsReadbackAccumulationEvidence(evidence);
  }

  public peekDomRegionRowsReadbackAccumulationEvidence(input?: {
    tabId?: number | null;
    sourceRegion?: string | null;
  }): TaskDomRegionRowsReadbackAccumulationEvidence | null {
    const accumulator = this.domRegionRowsReadbackAccumulator;
    if (!accumulator?.lastEvidence) return null;

    const tabId = normalizePositiveTabId(input?.tabId);
    if (tabId !== null && (accumulator.sourceTabId === null || accumulator.sourceTabId !== tabId)) {
      return null;
    }

    const sourceRegion =
      typeof input?.sourceRegion === 'string' && input.sourceRegion.length > 0
        ? input.sourceRegion
        : null;
    if (sourceRegion !== null && accumulator.sourceRegion !== sourceRegion) return null;

    return cloneTaskDomRegionRowsReadbackAccumulationEvidence(accumulator.lastEvidence);
  }

  /**
   * Record a successful skip-read execution. Does NOT increment
   * `readPageCount` (a skipped read did not happen). Folds the `apiFamily`
   * (when supplied) into `apiEndpointFamiliesSeen` so a follow-up read on the
   * same family is bucketed as redundant by the existing gate.
   */
  public noteSkipRead(input: NoteSkipReadInput): void {
    this._readPageAvoidedCount += 1;
    const tokens =
      Number.isFinite(input.tokensSavedEstimate) && input.tokensSavedEstimate > 0
        ? Math.floor(input.tokensSavedEstimate)
        : 0;
    this._tokensSavedEstimateTotal += tokens;
    if (typeof input.apiFamily === 'string' && input.apiFamily.length > 0) {
      this.apiEndpointFamiliesSeen.add(input.apiFamily);
    }
  }

  /**
   * Read-only accessor for the per-task aggregate counters consumed by
   * emitters and benchmark transformers. Returns a fresh object each call so
   * callers cannot accidentally mutate the running totals.
   */
  public getTaskTotals(): TaskTotalsSnapshot {
    return {
      readPageAvoidedCount: this._readPageAvoidedCount,
      tokensSavedEstimateTotal: this._tokensSavedEstimateTotal,
    };
  }

  /**
   * Record the newest AI-facing page projection and return the compact
   * projection delta the caller can attach to a read result. The previous
   * projection intentionally survives URL changes inside the same task: a
   * navigation/search/filter is exactly the moment the AI needs a
   * post-action delta instead of a fresh full context dump.
   */
  public notePageProjectionAndBuildDelta(
    projection: BrowserPageThingProjection,
    runtimeFields: TaskPageRuntimeFields | null = null,
  ): BrowserPageProjectionDelta {
    const previousProjection = this.lastPageProjection;
    const deltaKind =
      previousProjection === null
        ? 'initial_overview'
        : projection.changedByActionId
          ? 'post_action_delta'
          : 'read_refresh_delta';
    this.pageProjectionDeltaCount += 1;
    const delta = buildBrowserPageProjectionDelta({
      previousProjection,
      currentProjection: projection,
      deltaId: `delta:${this.pageProjectionDeltaCount}:${projection.projectionId}`,
      deltaKind,
      evidenceBoundary: inferProjectionEvidenceBoundary(projection),
    });
    this.lastPageProjection = cloneBrowserPageThingProjection(projection);
    this.lastSourceTruthChain = cloneBrowserSourceTruthChain(projection.sourceTruthChain);
    this.lastPageRuntimeFields = runtimeFields ? cloneTaskPageRuntimeFields(runtimeFields) : null;
    this.recordProjectionLifecycleEvents(projection, delta);
    return delta;
  }

  public peekLastPageProjection(): BrowserPageThingProjection | null {
    return this.lastPageProjection
      ? cloneBrowserPageThingProjection(this.lastPageProjection)
      : null;
  }

  public peekLastPageRuntimeFields(): TaskPageRuntimeFields | null {
    return this.lastPageRuntimeFields
      ? cloneTaskPageRuntimeFields(this.lastPageRuntimeFields)
      : null;
  }

  public noteAuthResumeVerification(
    verification: ReadPageAuthResumeVerification | null,
  ): TaskAuthResumeGate | null {
    this.lastAuthResumeGate = verification ? buildTaskAuthResumeGate(verification) : null;
    return this.peekLastAuthResumeGate();
  }

  public peekLastAuthResumeGate(): TaskAuthResumeGate | null {
    return this.lastAuthResumeGate ? cloneTaskAuthResumeGate(this.lastAuthResumeGate) : null;
  }

  public peekLastSourceTruthChain(): BrowserSourceTruthChain | null {
    return this.lastSourceTruthChain
      ? cloneBrowserSourceTruthChain(this.lastSourceTruthChain)
      : null;
  }

  public noteSourceRouteHonesty(input: TaskSourceRouteHonestySnapshot | null): void {
    this.lastSourceRouteHonesty = input ? { ...input } : null;
  }

  public peekLastSourceRouteHonesty(): TaskSourceRouteHonestySnapshot | null {
    return this.lastSourceRouteHonesty ? { ...this.lastSourceRouteHonesty } : null;
  }

  public noteObjectLifecycleAndBuildDelta(
    current: ReadPageObjectLifecycleSummary,
  ): ReadPageObjectLifecycleSummary {
    const compared = compareReadPageObjectLifecycleSummaries(this.lastObjectLifecycle, current);
    this.lastObjectLifecycle = cloneObjectLifecycleSummary(current);
    return compared;
  }

  public peekLastObjectLifecycle(): ReadPageObjectLifecycleSummary | null {
    return this.lastObjectLifecycle ? cloneObjectLifecycleSummary(this.lastObjectLifecycle) : null;
  }

  public notePageRegionsForPostcondition(input: {
    tabId?: number | null;
    pageRegions?: ReadonlyArray<ReadPageRegion> | null;
  }): void {
    const tabId =
      typeof input.tabId === 'number' && Number.isInteger(input.tabId) && input.tabId > 0
        ? input.tabId
        : null;
    this.lastPageRegionSnapshot = {
      tabId,
      pageRegions: cloneReadPageRegions(input.pageRegions ?? []),
    };
  }

  public noteRegionStatePostconditionsForCloseout(input: {
    tabId?: number | null;
    regionStatePostconditions?: ReadonlyArray<{
      actionKind: ActionKind | null;
      result: TaskRegionStatePostconditionResultSnapshot;
    }> | null;
  }): void {
    const normalizedTabId = normalizePositiveTabId(input.tabId);
    const consumedInteraction = this.lastConsumedPageInteractionForPostcondition;
    for (const item of input.regionStatePostconditions ?? []) {
      const actionKind = normalizeActionKind(item.actionKind) ?? 'unknown';
      const result = cloneTaskRegionStatePostconditionResult(item.result);
      if (!result) continue;
      this.regionStatePostconditionsForCloseout.push({
        tabId: normalizedTabId,
        actionKind,
        result,
      });
      const verifiedBinding = buildVerifiedBusinessInteractionBinding({
        consumedInteraction,
        tabId: normalizedTabId,
        actionKind,
        result,
      });
      if (verifiedBinding) {
        this.lastVerifiedBusinessInteractionBinding = verifiedBinding;
      }
    }
    this.lastConsumedPageInteractionForPostcondition = null;
    if (
      this.regionStatePostconditionsForCloseout.length >
      MAX_REGION_STATE_POSTCONDITIONS_FOR_CLOSEOUT
    ) {
      this.regionStatePostconditionsForCloseout.splice(
        0,
        this.regionStatePostconditionsForCloseout.length -
          MAX_REGION_STATE_POSTCONDITIONS_FOR_CLOSEOUT,
      );
    }
  }

  public peekRegionStatePostconditionsForCloseout(
    tabIds?: ReadonlyArray<number | null | undefined> | null,
  ): TaskRegionStatePostconditionForCloseout[] {
    const allowedTabIds = new Set(
      (tabIds ?? []).map((tabId) => normalizePositiveTabId(tabId)).filter(isPositiveTabId),
    );
    return this.regionStatePostconditionsForCloseout
      .filter((snapshot) => {
        if (allowedTabIds.size === 0) return true;
        return snapshot.tabId !== null && allowedTabIds.has(snapshot.tabId);
      })
      .map((snapshot) => ({
        tabId: snapshot.tabId,
        actionKind: snapshot.actionKind,
        result: cloneTaskRegionStatePostconditionResult(snapshot.result)!,
      }));
  }

  public buildTaskResumeReadiness(input?: {
    tabId?: number | null;
    nowMs?: number | null;
    authUserCollaborationStaleAfterMs?: number | null;
  }): TaskResumeReadinessSnapshot {
    const tabId = normalizePositiveTabId(input?.tabId);
    const gate = this.lastAuthResumeGate ? cloneTaskAuthResumeGate(this.lastAuthResumeGate) : null;

    if (gate) {
      const gateTargetTabId = normalizePositiveTabId(gate.targetTabId);
      if (
        gate.sameTabRequired &&
        gateTargetTabId !== null &&
        tabId !== null &&
        gateTargetTabId !== tabId
      ) {
        return withTaskResumeHandoffSummary({
          status: 'blocked_by_auth_verification',
          canResumeOriginalTask: false,
          nextStep: 'force_fresh_read_same_tab',
          tabId,
          evidenceKinds: ['auth_resume_gate', 'tab_binding_mismatch'],
          reason: 'auth_resume_gate_target_tab_mismatch',
          claimBoundary:
            'Resume is blocked because the latest auth verification gate targets a different tab.',
        });
      }
      if (gate.blocksTaskResume) {
        return withTaskResumeHandoffSummary({
          status: 'blocked_by_auth_verification',
          canResumeOriginalTask: false,
          nextStep: inferResumeReadinessNextStepFromAuthGate(gate),
          tabId: tabId ?? gateTargetTabId,
          evidenceKinds: ['auth_resume_gate'],
          reason: gate.reason,
          claimBoundary: gate.claimBoundary,
        });
      }
    }

    const pendingBusinessVerification = buildPendingBusinessVerificationForResume(
      this.pendingPageInteraction,
      tabId,
    );
    if (pendingBusinessVerification) {
      return withTaskResumeHandoffSummary({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        tabId: pendingBusinessVerification.tabId,
        evidenceKinds: ['pending_page_interaction', 'business_verification_plan'],
        reason: `pending_business_verification_requires_fresh_read:${pendingBusinessVerification.expectedEvidence}:${pendingBusinessVerification.intent}`,
        claimBoundary:
          'The latest browser action only proves dispatch plus a business-verification plan. A fresh same-tab read and matching postcondition evidence are required before resuming the original task.',
      });
    }

    const pageStabilityBlock = buildPageStabilityResumeBlockReason({
      runtimeFields: this.lastPageRuntimeFields,
      projection: this.lastPageProjection,
      tabId,
    });
    if (pageStabilityBlock) {
      return withTaskResumeHandoffSummary({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'force_fresh_read_same_tab',
        tabId: pageStabilityBlock.tabId,
        evidenceKinds: ['page_load_readiness', 'page_stability'],
        reason: pageStabilityBlock.reason,
        claimBoundary: pageStabilityBlock.claimBoundary,
      });
    }

    const postconditions = this.peekRegionStatePostconditionsForCloseout(
      tabId !== null ? [tabId] : null,
    );
    const latestPostcondition = selectLatestRegionStatePostconditionForResume(postconditions);
    if (latestPostcondition?.result.verdict === 'failed') {
      return withTaskResumeHandoffSummary({
        status: 'postcondition_failed_stop',
        canResumeOriginalTask: false,
        nextStep: 'stop_not_proven',
        tabId,
        evidenceKinds: ['region_state_postcondition'],
        reason: `region_state_${latestPostcondition.result.kind}_failed:${latestPostcondition.result.reason}`,
        claimBoundary: latestPostcondition.result.claimBoundary,
      });
    }

    if (latestPostcondition?.result.verdict === 'unknown') {
      return withTaskResumeHandoffSummary({
        status: 'postcondition_unknown_not_proven',
        canResumeOriginalTask: false,
        nextStep: 'verify_postcondition',
        tabId,
        evidenceKinds: ['region_state_postcondition'],
        reason: `region_state_${latestPostcondition.result.kind}_not_proven:${latestPostcondition.result.reason}`,
        claimBoundary: latestPostcondition.result.claimBoundary,
      });
    }

    if (latestPostcondition?.result.verdict === 'passed') {
      const detailResumeBlockReason = detailPostconditionResumeBlockReason(
        latestPostcondition.result,
        latestPostcondition.tabId,
        tabId,
        this.lastVerifiedBusinessInteractionBinding,
      );
      if (detailResumeBlockReason) {
        return withTaskResumeHandoffSummary({
          status: 'postcondition_unknown_not_proven',
          canResumeOriginalTask: false,
          nextStep: 'verify_postcondition',
          tabId,
          evidenceKinds:
            detailResumeBlockReason === 'detail_opened_action_binding_not_proven'
              ? ['region_state_postcondition', 'detail_field_readback', 'detail_action_binding']
              : ['region_state_postcondition', 'detail_field_readback'],
          reason: `region_state_${latestPostcondition.result.kind}_not_proven:${detailResumeBlockReason}`,
          claimBoundary: latestPostcondition.result.claimBoundary,
        });
      }
      const searchResumeBlockReason = searchPostconditionResumeBlockReason(
        latestPostcondition.result,
        this.domRegionRowsReadbackAccumulator,
        tabId,
      );
      if (searchResumeBlockReason) {
        return withTaskResumeHandoffSummary({
          status: 'postcondition_unknown_not_proven',
          canResumeOriginalTask: false,
          nextStep: 'verify_postcondition',
          tabId,
          evidenceKinds: ['region_state_postcondition', 'dom_region_rows_readback'],
          reason: `region_state_${latestPostcondition.result.kind}_not_proven:${searchResumeBlockReason}`,
          claimBoundary: latestPostcondition.result.claimBoundary,
        });
      }
      if (latestPostcondition.result.kind === 'otp_requested') {
        const staleReason = staleUserCollaborationPostconditionReason(
          latestPostcondition.result,
          input?.nowMs,
          input?.authUserCollaborationStaleAfterMs,
        );
        if (staleReason) {
          return withTaskResumeHandoffSummary({
            status: 'postcondition_unknown_not_proven',
            canResumeOriginalTask: false,
            nextStep: 'force_fresh_read_same_tab',
            tabId,
            evidenceKinds: [
              'region_state_postcondition',
              'user_collaboration_required',
              'stale_user_collaboration',
            ],
            reason: `region_state_otp_requested_not_proven:${staleReason}`,
            claimBoundary:
              'The OTP/user-collaboration wait evidence is stale. A fresh same-tab read is required before submitting login or resuming the original task.',
          });
        }
        return withTaskResumeHandoffSummary({
          status: 'blocked_by_auth_verification',
          canResumeOriginalTask: false,
          nextStep: 'wait_for_user_collaboration',
          tabId,
          evidenceKinds: ['region_state_postcondition', 'user_collaboration_required'],
          reason: `region_state_otp_requested_waiting_for_user:${latestPostcondition.result.reason}`,
          claimBoundary: latestPostcondition.result.claimBoundary,
        });
      }
      return withTaskResumeHandoffSummary({
        status: 'postcondition_passed_ready',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        tabId,
        evidenceKinds: passedPostconditionEvidenceKindsForResume(
          latestPostcondition.result.kind,
          hasPriorPassedOtpRequestForTab(postconditions, latestPostcondition),
        ),
        reason: `region_state_${latestPostcondition.result.kind}_passed:${latestPostcondition.result.reason}`,
        claimBoundary: latestPostcondition.result.claimBoundary,
      });
    }

    if (gate && !gate.blocksTaskResume) {
      return withTaskResumeHandoffSummary({
        status: 'resume_allowed',
        canResumeOriginalTask: true,
        nextStep: 'continue_original_task',
        tabId: tabId ?? normalizePositiveTabId(gate.targetTabId),
        evidenceKinds: ['auth_resume_gate'],
        reason: gate.reason,
        claimBoundary: gate.claimBoundary,
      });
    }

    return withTaskResumeHandoffSummary({
      status: 'not_proven',
      canResumeOriginalTask: false,
      nextStep: 'verify_postcondition',
      tabId,
      evidenceKinds: [],
      reason: 'no_resume_or_business_postcondition_evidence',
      claimBoundary:
        'No auth resume gate or business postcondition has proven that the original task can continue.',
    });
  }

  public buildCachedPageProjectionDelta(): BrowserPageProjectionDelta | null {
    if (!this.lastPageProjection) return null;
    const reusedRegions = this.lastPageProjection.activeRegion
      ? [this.lastPageProjection.activeRegion]
      : [...this.lastPageProjection.changedRegions];
    const previousContextChars = Math.max(0, this.lastPageProjection.contextChars);
    return {
      deltaId: `delta:cached:${this.lastPageProjection.projectionId}`,
      deltaKind: 'read_refresh_delta',
      fromProjectionId: this.lastPageProjection.projectionId,
      toProjectionId: this.lastPageProjection.projectionId,
      changedRegions: [],
      reusedRegions,
      invalidatedRefs: [],
      refreshedRefs: [],
      contextChars: 0,
      previousContextChars,
      contextSavedChars: previousContextChars,
      contextSavedRatio: previousContextChars > 0 ? 1 : 0,
      evidenceBoundary: inferProjectionEvidenceBoundary(this.lastPageProjection),
    };
  }

  public buildCachedDataSourceDecision(): BrowserDataSourceDecisionEvidence | null {
    if (!this.lastPageProjection) return null;
    return {
      availableSources: [this.lastPageProjection.chosenDataSource],
      selectedSource: this.lastPageProjection.chosenDataSource,
      selectedReason: 'cached_projection_reused_for_redundant_read',
      rejectedSources: [],
      regionCorrelation: this.lastPageProjection.regionEvidenceRefs.length > 0 ? 1 : null,
      taskRelevance: null,
      privacySafety: 'redacted',
      metadataCompleteness: this.lastPageProjection.regionEvidenceRefs.length > 0 ? 1 : null,
      sourceFreshness: this.lastPageProjection.sourceFreshness,
      sourceConfidence: this.lastPageProjection.sourceConfidence,
      fallbackReason: null,
    };
  }

  /**
   * Record a successful `chrome_read_page` outcome. Increments
   * `readPageCount` exactly once per call. The caller is responsible
   * for invoking this AFTER the bridge returns success — failed
   * reads do not consume the budget.
   */
  public noteReadPage(input: NoteReadPageInput): void {
    this.readPageCount += 1;
    this.lastReadLayer = input.layer;
    this.lastReadRequestKey = normalizeReadRequestKey(input.requestKey);
    this.lastReadSource = input.source;
    if (input.targetRefs) {
      for (const ref of input.targetRefs) {
        if (typeof ref === 'string' && ref.length > 0) this.targetRefsSeen.add(ref);
      }
    }
    if (input.apiFamilies) {
      for (const family of input.apiFamilies) {
        if (typeof family === 'string' && family.length > 0)
          this.apiEndpointFamiliesSeen.add(family);
      }
    }
  }

  public notePageInteraction(input: NotePageInteractionInput): void {
    this.lastReadLayer = null;
    this.lastReadRequestKey = null;
    this.lastReadSource = null;
    this.targetRefsSeen.clear();
    this._chooseContextDecision = null;
    this.liveObservedApiData.length = 0;
    this.liveObservedApiEvidence.length = 0;
    this.visibleRegionRows = null;
    this.domRegionRowsReadbackAccumulator = null;
    this.lastVerifiedBusinessInteractionBinding = null;
    const tabId =
      typeof input.tabId === 'number' && Number.isInteger(input.tabId) && input.tabId > 0
        ? input.tabId
        : null;
    this.pendingPageInteraction = {
      action: input.action,
      tabId,
      changeCause: input.changeCause ?? 'unknown',
      targetRefs: normalizeTargetRefs(input.targetRefs),
      candidateActionId: normalizeIdentifier(input.candidateActionId),
      candidateActionIntent: normalizeIdentifier(input.candidateActionIntent),
      actionKind: normalizeActionKind(input.actionKind),
      producedAtMs: Date.now(),
      beforePageRegions: this.buildBeforePageRegionsForInteraction(tabId),
    };
    this.recordLifecycleEvent({
      kind: 'refs_invalidated',
      url: this.currentUrl,
      pageRole: this.pageRole,
      tabId: tabId ?? undefined,
      invalidatedRefs: ['interaction_may_change_page', ...normalizeTargetRefs(input.targetRefs)],
      projectionId: input.action,
    });
  }

  public consumePendingPageInteraction(
    tabId: number | null | undefined,
  ): TaskPageInteractionSnapshot | null {
    const pending = this.pendingPageInteraction;
    if (!pending) return null;
    const normalizedTabId =
      typeof tabId === 'number' && Number.isInteger(tabId) && tabId > 0 ? tabId : null;
    if (pending.tabId !== null && normalizedTabId !== null && pending.tabId !== normalizedTabId) {
      return null;
    }
    this.pendingPageInteraction = null;
    const snapshot = {
      ...pending,
      targetRefs: [...pending.targetRefs],
      beforePageRegions: cloneReadPageRegions(pending.beforePageRegions),
    };
    this.lastConsumedPageInteractionForPostcondition = snapshot;
    return {
      ...snapshot,
      targetRefs: [...snapshot.targetRefs],
      beforePageRegions: cloneReadPageRegions(snapshot.beforePageRegions),
    };
  }

  public keepPendingPageInteractionForPostconditionRetry(
    snapshot: TaskPageInteractionSnapshot,
  ): void {
    this.pendingPageInteraction = {
      ...snapshot,
      targetRefs: [...snapshot.targetRefs],
      beforePageRegions: cloneReadPageRegions(snapshot.beforePageRegions),
    };
  }

  public noteCleanup(input: { action: string; targetIds?: ReadonlyArray<number> | null }): void {
    if (input.targetIds) {
      for (const tabId of input.targetIds) {
        this.runOwnedTabIds.delete(tabId);
      }
    }
    this.recordLifecycleEvent({
      kind: 'cleanup',
      url: this.currentUrl,
      pageRole: this.pageRole,
      cleanupAction: input.action,
      cleanupTargetIds: input.targetIds ? [...input.targetIds] : undefined,
    });
  }

  public getLifecycleTimeline(): readonly TaskLifecycleEvent[] {
    return this.lifecycleTimeline.map((event) => ({
      ...event,
      changedRegions: event.changedRegions ? [...event.changedRegions] : undefined,
      reusedRegions: event.reusedRegions ? [...event.reusedRegions] : undefined,
      invalidatedRefs: event.invalidatedRefs ? [...event.invalidatedRefs] : undefined,
      refreshedRefs: event.refreshedRefs ? [...event.refreshedRefs] : undefined,
      cleanupTargetIds: event.cleanupTargetIds ? [...event.cleanupTargetIds] : undefined,
    }));
  }

  public noteRunOwnedTab(tabId: number): void {
    if (Number.isInteger(tabId) && tabId > 0) {
      this.runOwnedTabIds.add(tabId);
    }
  }

  public releaseRunOwnedTab(tabId: number): void {
    if (Number.isInteger(tabId) && tabId > 0) {
      this.runOwnedTabIds.delete(tabId);
    }
  }

  public isRunOwnedTab(tabId: number): boolean {
    return this.runOwnedTabIds.has(tabId);
  }

  public getRunOwnedTabIds(): readonly number[] {
    return Array.from(this.runOwnedTabIds).sort((left, right) => left - right);
  }

  private buildBeforePageRegionsForInteraction(tabId: number | null): ReadPageRegion[] {
    if (!this.lastPageRegionSnapshot) return [];
    if (
      this.lastPageRegionSnapshot.tabId !== null &&
      tabId !== null &&
      this.lastPageRegionSnapshot.tabId !== tabId
    ) {
      return [];
    }
    return cloneReadPageRegions(this.lastPageRegionSnapshot.pageRegions);
  }

  private recordProjectionLifecycleEvents(
    projection: BrowserPageThingProjection,
    delta: BrowserPageProjectionDelta,
  ): void {
    this.recordLifecycleEvent({
      kind: 'readiness_observed',
      url: this.currentUrl,
      pageRole: this.pageRole,
      projectionId: projection.projectionId,
      tabId: projection.tabId,
    });
    this.recordLifecycleEvent({
      kind: 'projection_created',
      url: this.currentUrl,
      pageRole: this.pageRole,
      projectionId: projection.projectionId,
      tabId: projection.tabId,
    });
    if (projection.changedRegions.length > 0) {
      this.recordLifecycleEvent({
        kind: 'region_changed',
        url: this.currentUrl,
        pageRole: this.pageRole,
        projectionId: projection.projectionId,
        tabId: projection.tabId,
        changedRegions: projection.changedRegions,
        reusedRegions: projection.reusedRegions,
      });
    }
    if (projection.refreshedRefs.length > 0) {
      this.recordLifecycleEvent({
        kind: 'refs_refreshed',
        url: this.currentUrl,
        pageRole: this.pageRole,
        projectionId: projection.projectionId,
        tabId: projection.tabId,
        refreshedRefs: projection.refreshedRefs,
      });
    }
    if (projection.invalidatedRefs.length > 0) {
      this.recordLifecycleEvent({
        kind: 'refs_invalidated',
        url: this.currentUrl,
        pageRole: this.pageRole,
        projectionId: projection.projectionId,
        tabId: projection.tabId,
        invalidatedRefs: projection.invalidatedRefs,
      });
    }
    this.recordLifecycleEvent({
      kind: 'delta_created',
      url: this.currentUrl,
      pageRole: this.pageRole,
      projectionId: projection.projectionId,
      deltaId: delta.deltaId,
      tabId: projection.tabId,
      changedRegions: delta.changedRegions,
      reusedRegions: delta.reusedRegions,
      invalidatedRefs: delta.invalidatedRefs,
      refreshedRefs: delta.refreshedRefs,
    });
  }

  private recordLifecycleEvent(input: Omit<TaskLifecycleEvent, 'eventId' | 'index' | 'at'>): void {
    this.lifecycleEventCount += 1;
    this.lifecycleTimeline.push({
      ...input,
      eventId: `lifecycle:${this.lifecycleEventCount}`,
      index: this.lifecycleEventCount,
      at: new Date().toISOString(),
      changedRegions: input.changedRegions ? [...input.changedRegions] : undefined,
      reusedRegions: input.reusedRegions ? [...input.reusedRegions] : undefined,
      invalidatedRefs: input.invalidatedRefs ? [...input.invalidatedRefs] : undefined,
      refreshedRefs: input.refreshedRefs ? [...input.refreshedRefs] : undefined,
      cleanupTargetIds: input.cleanupTargetIds ? [...input.cleanupTargetIds] : undefined,
    });
    if (this.lifecycleTimeline.length > MAX_LIFECYCLE_TIMELINE_EVENTS) {
      this.lifecycleTimeline.splice(
        0,
        this.lifecycleTimeline.length - MAX_LIFECYCLE_TIMELINE_EVENTS,
      );
    }
  }

  /**
   * Gate. Returns the structured decision the `register-tools`
   * `chrome_read_page` shim turns into either a forwarded bridge
   * call or a structured warning `CallToolResult`.
   *
   * Decision tree:
   *   1. Budget exceeded without `forceRefresh` → `allowed=false`,
   *      `reason='read_budget_exceeded'`.
   *   2. Same URL, same requested layer and same request shape as last read
   *      → allowed but flagged `reason='read_redundant'` (caller may choose
   *      to short-circuit and reuse the cached projection).
   *   3. Layer demotion (requested < lastReadLayer) → allowed but
   *      flagged `reason='layer_demotion'` so the operator can spot
   *      pathological L2→L0 churn.
   *   4. Otherwise → allowed cleanly.
   *
   * Suggested layer is always `'L0+L1'` for the very first read on
   * the current page; otherwise echoes back
   * the requested layer.
   */
  public shouldAllowReadPage(input: ShouldAllowReadPageInput): ShouldAllowReadPageResult {
    const requested = input.requestedLayer;
    const requestKey = normalizeReadRequestKey(input.requestKey);
    const isFirstReadOnPage = this.lastReadLayer === null;
    const suggestedLayer: ReadPageRequestedLayer = isFirstReadOnPage ? 'L0+L1' : requested;

    if (this.readPageCount >= this.readBudget && input.forceRefresh !== true) {
      return {
        allowed: false,
        reason: 'read_budget_exceeded',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    if (
      input.forceRefresh !== true &&
      !isFirstReadOnPage &&
      this.lastReadLayer === requested &&
      this.lastReadRequestKey === requestKey
    ) {
      return {
        allowed: true,
        reason: 'read_redundant',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    if (!isFirstReadOnPage && layerRank(requested) < layerRank(this.lastReadLayer!)) {
      return {
        allowed: true,
        reason: 'layer_demotion',
        suggestedLayer,
        readPageCount: this.readPageCount,
        readBudget: this.readBudget,
      };
    }

    return {
      allowed: true,
      reason: '',
      suggestedLayer,
      readPageCount: this.readPageCount,
      readBudget: this.readBudget,
    };
  }
}

/**
 * Total order on the read-page layers — used for demotion detection.
 * Kept private to this module; the public surface only ever consumes
 * the `'L0' | 'L0+L1' | 'L0+L1+L2'` strings.
 */
function layerRank(layer: ReadPageRequestedLayer): number {
  switch (layer) {
    case 'L0':
      return 0;
    case 'L0+L1':
      return 1;
    case 'L0+L1+L2':
      return 2;
    default:
      return 0;
  }
}

function normalizeReadRequestKey(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

function normalizePositiveTabId(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function buildDomRegionRowStableKey(row: TaskVisibleRegionRow): string | null {
  const textKeyParts = [row.title, row.primaryText, row.secondaryText, row.summary, row.metaText]
    .map(normalizeDomRegionRowKeyPart)
    .filter((part) => part.length > 0);
  if (textKeyParts.length > 0) return `text:${textKeyParts.join('|')}`;

  const rowId = normalizeDomRegionRowKeyPart(row.rowId);
  if (rowId) return `row:${rowId}`;

  const targetRef = normalizeDomRegionRowKeyPart(row.targetRef);
  if (targetRef) return `target:${targetRef}`;

  const interactionText = normalizeDomRegionRowKeyPart(row.interactionText);
  return interactionText ? `interaction:${interactionText}` : null;
}

function normalizeDomRegionRowKeyPart(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 240);
}

function isDomRegionRowSummarizable(row: TaskVisibleRegionRow): boolean {
  const targetRef =
    typeof row.targetRef === 'string' && row.targetRef.trim().length > 0 ? row.targetRef : null;
  if (!targetRef) return false;
  return [row.title, row.primaryText, row.summary, row.secondaryText, row.metaText].some(
    (value) => normalizeDomRegionRowKeyPart(value).length > 0,
  );
}

function getDomRegionRowFieldCoverage(row: TaskVisibleRegionRow): {
  hasTitle: boolean;
  hasSupportingText: boolean;
  hasMetadata: boolean;
} {
  return {
    hasTitle: normalizeDomRegionRowKeyPart(row.title).length > 0,
    hasSupportingText: [row.primaryText, row.summary, row.secondaryText].some(
      (value) => normalizeDomRegionRowKeyPart(value).length > 0,
    ),
    hasMetadata: normalizeDomRegionRowKeyPart(row.metaText).length > 0,
  };
}

function cloneTaskDomRegionRowsReadbackAccumulationEvidence(
  evidence: TaskDomRegionRowsReadbackAccumulationEvidence,
): TaskDomRegionRowsReadbackAccumulationEvidence {
  return { ...evidence, collectionGuidance: { ...evidence.collectionGuidance } };
}

function buildTopNAccumulationCollectionGuidance(input: {
  canSatisfyDefaultTopN: boolean;
  canSupportDefaultTopNFieldSummary: boolean;
  canSupportDefaultTopNDelivery: boolean;
  missingRowCountForDefaultTopN: number;
  missingDeliverableRowCountForDefaultTopN: number;
  missingUniqueTargetRefCountForDefaultTopN: number;
  hasSingleReadDefaultTopNDeliveryEvidence: boolean;
}): TaskTopNCollectionGuidance {
  const base = {
    recommendedTool: 'chrome_read_page' as const,
    sameTabRequired: true,
    scrollToolSuccessIsNotBusinessSuccess: true,
  };

  if (!input.canSatisfyDefaultTopN) {
    return {
      ...base,
      status: 'needs_more_rows',
      requiredNextAction: 'fresh_read_after_scroll_or_page_advance',
      forceRefreshRequired: true,
      requiresNewObservedRows: true,
      instruction: `Need ${input.missingRowCountForDefaultTopN} more unique targetable rows before claiming default Top-N coverage. After a scroll or page advance, run a forced fresh same-tab chrome_read_page and require newly observed rows.`,
      claimBoundary:
        'Scroll/page-advance success alone is not business success; Top-N progress is proven only by fresh same-tab readback that observes additional unique rows.',
    };
  }

  if (!input.canSupportDefaultTopNFieldSummary) {
    return {
      ...base,
      status: 'needs_structured_fields',
      requiredNextAction: 'collect_structured_fields_or_open_detail',
      forceRefreshRequired: true,
      requiresNewObservedRows: false,
      instruction: `Rows are enough for count, but ${input.missingDeliverableRowCountForDefaultTopN} more rows need structured title plus supporting or metadata fields before default Top-N delivery.`,
      claimBoundary:
        'A targetable row count does not prove summary quality; structured field evidence or detail readback is still required.',
    };
  }

  if (input.missingUniqueTargetRefCountForDefaultTopN > 0) {
    return {
      ...base,
      status: 'needs_unique_target_refs',
      requiredNextAction: 'collect_more_unique_target_refs',
      forceRefreshRequired: true,
      requiresNewObservedRows: false,
      instruction: `Rows have enough structured fields, but ${input.missingUniqueTargetRefCountForDefaultTopN} more unique targetRefs are needed before default Top-N delivery.`,
      claimBoundary:
        'Readable rows do not prove executable delivery; each Top-N item needs a stable unique targetRef or equivalent detail target.',
    };
  }

  if (!input.canSupportDefaultTopNDelivery || !input.hasSingleReadDefaultTopNDeliveryEvidence) {
    return {
      ...base,
      status: 'needs_stable_single_snapshot',
      requiredNextAction: 'collect_stable_single_snapshot',
      forceRefreshRequired: true,
      requiresNewObservedRows: false,
      instruction:
        'Accumulated rows are enough, but default Top-N delivery still needs one stable same-tab snapshot containing enough structured rows and unique targetRefs.',
      claimBoundary:
        'Accumulated multi-read coverage can support planning, but final Top-N delivery needs a stable single-read proof to avoid stitching unstable page states.',
    };
  }

  return {
    ...base,
    status: 'ready',
    requiredNextAction: 'summarize_current_top_n',
    forceRefreshRequired: false,
    requiresNewObservedRows: false,
    instruction:
      'Default Top-N delivery is supported by the current same-tab row evidence and stable single-read proof.',
    claimBoundary:
      'This supports default Top-N delivery for observed rows only; it still does not prove full platform ranking or unseen results.',
  };
}

function isPositiveTabId(value: number | null): value is number {
  return value !== null;
}

function normalizeTargetRefs(values: ReadonlyArray<string> | null | undefined): string[] {
  if (!values) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!/^[A-Za-z0-9:_-]{1,96}$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
    if (result.length >= 3) break;
  }
  return result;
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:._-]{1,160}$/.test(trimmed) ? trimmed : null;
}

function normalizeActionKind(value: unknown): ActionKind | null {
  return value === 'click' ||
    value === 'fill' ||
    value === 'submit' ||
    value === 'navigate' ||
    value === 'read' ||
    value === 'close' ||
    value === 'keyboard' ||
    value === 'unknown'
    ? value
    : null;
}

function normalizeRegionStatePostconditionKind(
  value: unknown,
): TaskRegionStatePostconditionKind | null {
  return value === 'menu_opened' ||
    value === 'menu_closed' ||
    value === 'search_results_updated' ||
    value === 'detail_opened' ||
    value === 'login_completed' ||
    value === 'logout_completed' ||
    value === 'otp_requested' ||
    value === 'qr_waiting'
    ? value
    : null;
}

function normalizePostconditionVerdict(value: unknown): PostconditionVerdict | null {
  return value === 'passed' || value === 'failed' || value === 'unknown' ? value : null;
}

function cloneTaskRegionStatePostconditionResult(
  input: TaskRegionStatePostconditionResultSnapshot,
): TaskRegionStatePostconditionResultSnapshot | null {
  const kind = normalizeRegionStatePostconditionKind(input.kind);
  const verdict = normalizePostconditionVerdict(input.verdict);
  if (!kind || !verdict) return null;
  return {
    actionId: normalizeIdentifier(input.actionId) ?? 'unknown',
    kind,
    verdict,
    reason: normalizeBoundedString(input.reason, 240) ?? 'unknown',
    beforeSummary: normalizeSummaryStrings(input.beforeSummary),
    afterSummary: normalizeSummaryStrings(input.afterSummary),
    producedAtMs:
      Number.isFinite(input.producedAtMs) && input.producedAtMs >= 0
        ? Math.floor(input.producedAtMs)
        : Date.now(),
    claimBoundary:
      normalizeBoundedString(input.claimBoundary, 300) ??
      'region_state_postcondition_claim_boundary_unknown',
    ...(input.detailFieldReadbackEvidence
      ? {
          detailFieldReadbackEvidence: cloneTaskDetailFieldReadbackEvidence(
            input.detailFieldReadbackEvidence,
          ),
        }
      : {}),
  };
}

function cloneTaskDetailFieldReadbackEvidence(
  input: TaskDetailFieldReadbackEvidence,
): TaskDetailFieldReadbackEvidence | null {
  if (input.kind !== 'detail_field_readback') return null;
  const status = normalizeDetailFieldReadbackStatus(input.status);
  const semanticMatch = normalizeDetailSemanticMatchStatus(input.semanticMatch);
  if (!status || !semanticMatch) return null;
  return {
    kind: 'detail_field_readback',
    status,
    targetBindingProven: Boolean(input.targetBindingProven),
    semanticMatch,
    canSupportDetailSummary: Boolean(input.canSupportDetailSummary),
    fieldCounts: {
      totalStructuredObjects: normalizeNonNegativeInteger(
        input.fieldCounts?.totalStructuredObjects,
      ),
      titleLikeObjects: normalizeNonNegativeInteger(input.fieldCounts?.titleLikeObjects),
      bodyLikeObjects: normalizeNonNegativeInteger(input.fieldCounts?.bodyLikeObjects),
      metadataLikeObjects: normalizeNonNegativeInteger(input.fieldCounts?.metadataLikeObjects),
      actionableObjects: normalizeNonNegativeInteger(input.fieldCounts?.actionableObjects),
    },
    nextRequiredCheck:
      normalizeDetailFieldNextRequiredCheck(input.nextRequiredCheck) ??
      'fresh_detail_read_or_more_structured_fields_required',
    claimBoundary:
      normalizeBoundedString(input.claimBoundary, 300) ??
      'detail_field_readback_claim_boundary_unknown',
  };
}

function normalizeDetailFieldReadbackStatus(value: unknown): TaskDetailFieldReadbackStatus | null {
  return value === 'structured_fields_present' ||
    value === 'partial_fields_only' ||
    value === 'not_available'
    ? value
    : null;
}

function normalizeDetailSemanticMatchStatus(value: unknown): TaskDetailSemanticMatchStatus | null {
  return value === 'matched' ||
    value === 'not_matched' ||
    value === 'before_text_missing' ||
    value === 'after_text_missing' ||
    value === 'not_applicable'
    ? value
    : null;
}

function normalizeDetailFieldNextRequiredCheck(
  value: unknown,
): TaskDetailFieldReadbackEvidence['nextRequiredCheck'] | null {
  return value === 'detail_fields_ready_for_summary' ||
    value === 'fresh_detail_read_or_more_structured_fields_required' ||
    value === 'target_binding_required_before_detail_summary'
    ? value
    : null;
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function selectLatestRegionStatePostconditionForResume(
  postconditions: TaskRegionStatePostconditionForCloseout[],
): TaskRegionStatePostconditionForCloseout | null {
  let latest: TaskRegionStatePostconditionForCloseout | null = null;
  let latestProducedAtMs = Number.NEGATIVE_INFINITY;

  for (const postcondition of postconditions) {
    const producedAtMs = Number.isFinite(postcondition.result.producedAtMs)
      ? postcondition.result.producedAtMs
      : Number.NEGATIVE_INFINITY;
    if (!latest || producedAtMs >= latestProducedAtMs) {
      latest = postcondition;
      latestProducedAtMs = producedAtMs;
    }
  }

  return latest;
}

function detailPostconditionResumeBlockReason(
  result: TaskRegionStatePostconditionResultSnapshot,
  postconditionTabId: number | null,
  requestedTabId: number | null,
  verifiedBinding: TaskVerifiedBusinessInteractionBinding | null,
): string | null {
  if (result.kind !== 'detail_opened') return null;
  const evidence = result.detailFieldReadbackEvidence;
  if (!evidence) return 'detail_field_readback_required_for_resume';
  if (
    evidence.status !== 'structured_fields_present' ||
    !evidence.targetBindingProven ||
    evidence.semanticMatch !== 'matched' ||
    !evidence.canSupportDetailSummary ||
    evidence.nextRequiredCheck !== 'detail_fields_ready_for_summary'
  ) {
    return 'detail_field_readback_not_ready_for_summary';
  }
  if (
    !isDetailPostconditionBoundToVerifiedInteraction(
      result,
      postconditionTabId,
      requestedTabId,
      verifiedBinding,
    )
  ) {
    return 'detail_opened_action_binding_not_proven';
  }
  return null;
}

function buildVerifiedBusinessInteractionBinding(input: {
  consumedInteraction: TaskPageInteractionSnapshot | null;
  tabId: number | null;
  actionKind: ActionKind;
  result: TaskRegionStatePostconditionResultSnapshot;
}): TaskVerifiedBusinessInteractionBinding | null {
  if (input.result.verdict !== 'passed') return null;
  const consumed = input.consumedInteraction;
  if (!consumed) return null;
  const consumedActionId = normalizeIdentifier(consumed.candidateActionId) ?? consumed.action;
  if (consumedActionId !== input.result.actionId) return null;
  if (consumed.tabId !== null && input.tabId !== null && consumed.tabId !== input.tabId) {
    return null;
  }
  return {
    tabId: input.tabId ?? consumed.tabId,
    actionId: input.result.actionId,
    actionKind: input.actionKind,
    candidateActionIntent: normalizeIdentifier(consumed.candidateActionIntent),
    targetRefs: [...consumed.targetRefs],
    postconditionKind: input.result.kind,
    producedAtMs: input.result.producedAtMs,
  };
}

function isDetailPostconditionBoundToVerifiedInteraction(
  result: TaskRegionStatePostconditionResultSnapshot,
  postconditionTabId: number | null,
  requestedTabId: number | null,
  verifiedBinding: TaskVerifiedBusinessInteractionBinding | null,
): boolean {
  if (!verifiedBinding) return false;
  if (verifiedBinding.postconditionKind !== 'detail_opened') return false;
  if (verifiedBinding.actionId !== result.actionId) return false;
  if (verifiedBinding.candidateActionIntent !== 'content.open_detail') return false;
  if (verifiedBinding.targetRefs.length === 0) return false;
  if (
    requestedTabId !== null &&
    verifiedBinding.tabId !== null &&
    requestedTabId !== verifiedBinding.tabId
  ) {
    return false;
  }
  if (
    postconditionTabId !== null &&
    verifiedBinding.tabId !== null &&
    postconditionTabId !== verifiedBinding.tabId
  ) {
    return false;
  }
  return true;
}

function searchPostconditionResumeBlockReason(
  result: TaskRegionStatePostconditionResultSnapshot,
  rows: TaskDomRegionRowsReadbackAccumulator | null,
  requestedTabId: number | null,
): string | null {
  if (result.kind !== 'search_results_updated') return null;
  if (!rows) return 'dom_region_rows_readback_required_for_resume';
  if (requestedTabId !== null && rows.sourceTabId !== null && rows.sourceTabId !== requestedTabId) {
    return 'dom_region_rows_readback_tab_mismatch';
  }
  if (requestedTabId !== null && rows.sourceTabId === null) {
    return 'dom_region_rows_readback_tab_binding_not_proven';
  }
  if (rows.uniqueTargetableRowKeys.size < DEFAULT_TOP_N_ACCUMULATION_TARGET) {
    return 'dom_region_rows_readback_not_ready_for_default_top_n';
  }
  if (rows.uniqueTitleRowKeys.size < DEFAULT_TOP_N_ACCUMULATION_TARGET) {
    return 'dom_region_rows_readback_not_enough_titled_rows_for_default_top_n_summary';
  }
  if (rows.uniqueDeliverableRowKeys.size < DEFAULT_TOP_N_ACCUMULATION_TARGET) {
    return 'dom_region_rows_readback_per_row_fields_not_ready_for_structured_top_n_delivery';
  }
  if (rows.uniqueTargetRefs.size < DEFAULT_TOP_N_ACCUMULATION_TARGET) {
    return 'dom_region_rows_readback_not_enough_unique_target_refs_for_default_top_n_delivery';
  }
  if (!rows.hasSingleReadDefaultTopNDeliveryEvidence) {
    return 'dom_region_rows_readback_no_single_snapshot_default_top_n_delivery_proof';
  }
  return null;
}

function buildPageStabilityResumeBlockReason(input: {
  runtimeFields: TaskPageRuntimeFields | null;
  projection: BrowserPageThingProjection | null;
  tabId: number | null;
}): { tabId: number | null; reason: string; claimBoundary: string } | null {
  const runtimeFields = input.runtimeFields;
  if (!runtimeFields) return null;
  const projectionTabId = normalizePositiveTabId(input.projection?.tabId);
  if (input.tabId !== null && projectionTabId !== null && input.tabId !== projectionTabId) {
    return null;
  }
  const status = normalizeIdentifier(runtimeFields.currentPageLoadReadinessStatus);
  const pageStability = normalizeIdentifier(runtimeFields.currentPageStability);
  const explicitlyNotUsable = runtimeFields.currentPageSnapshotUsableForBusinessAction === false;
  const notReadyStatus = status === 'loading_after_wait' || status === 'stale';
  const unstablePage =
    pageStability === 'loading' || pageStability === 'changing' || pageStability === 'stale';
  if (!explicitlyNotUsable && !notReadyStatus && !unstablePage) return null;

  const blockTabId = input.tabId ?? projectionTabId;
  const nextStepHint =
    normalizeIdentifier(runtimeFields.currentPageLoadReadinessNextStepHint) ??
    'run_chrome_read_page_force_refresh';
  return {
    tabId: blockTabId,
    reason: [
      'page_load_readiness_not_ready',
      `status:${status ?? 'unknown'}`,
      `pageStability:${pageStability ?? 'unknown'}`,
      `nextStepHint:${nextStepHint}`,
    ].join(':'),
    claimBoundary:
      'The latest same-tab read_page snapshot was not proven stable enough for business action. Run a fresh same-tab read after the page settles before clicking, typing, or resuming task work.',
  };
}

function passedPostconditionEvidenceKindsForResume(
  kind: TaskRegionStatePostconditionKind,
  userCollaborationResolved = false,
): string[] {
  const evidenceKinds = ['region_state_postcondition'];
  if (userCollaborationResolved) {
    evidenceKinds.push('user_collaboration_resolved');
  }
  if (kind === 'search_results_updated') {
    return [
      ...evidenceKinds,
      'dom_region_rows_readback',
      'top_n_field_coverage',
      'top_n_delivery_readiness',
      'top_n_single_snapshot_delivery',
    ];
  }
  if (kind === 'detail_opened') {
    return [...evidenceKinds, 'detail_field_readback', 'detail_action_binding'];
  }
  return evidenceKinds;
}

function hasPriorPassedOtpRequestForTab(
  postconditions: TaskRegionStatePostconditionForCloseout[],
  latestPostcondition: TaskRegionStatePostconditionForCloseout,
): boolean {
  if (latestPostcondition.result.kind !== 'login_completed') return false;
  const latestProducedAtMs = Number.isFinite(latestPostcondition.result.producedAtMs)
    ? latestPostcondition.result.producedAtMs
    : Number.POSITIVE_INFINITY;

  return postconditions.some((postcondition) => {
    if (postcondition === latestPostcondition) return false;
    if (postcondition.result.kind !== 'otp_requested') return false;
    if (postcondition.result.verdict !== 'passed') return false;
    if (
      latestPostcondition.tabId !== null &&
      postcondition.tabId !== null &&
      postcondition.tabId !== latestPostcondition.tabId
    ) {
      return false;
    }
    const producedAtMs = Number.isFinite(postcondition.result.producedAtMs)
      ? postcondition.result.producedAtMs
      : Number.NEGATIVE_INFINITY;
    return producedAtMs <= latestProducedAtMs;
  });
}

function staleUserCollaborationPostconditionReason(
  result: TaskRegionStatePostconditionResultSnapshot,
  nowMs: number | null | undefined,
  staleAfterMs: number | null | undefined,
): string | null {
  if (result.kind !== 'otp_requested') return null;
  if (!Number.isFinite(nowMs)) return null;
  const normalizedNowMs = Math.floor(nowMs as number);
  const normalizedProducedAtMs = Number.isFinite(result.producedAtMs)
    ? Math.floor(result.producedAtMs)
    : normalizedNowMs;
  const normalizedStaleAfterMs =
    Number.isFinite(staleAfterMs) && (staleAfterMs as number) > 0
      ? Math.floor(staleAfterMs as number)
      : DEFAULT_AUTH_USER_COLLABORATION_STALE_AFTER_MS;
  const ageMs = normalizedNowMs - normalizedProducedAtMs;
  if (ageMs <= normalizedStaleAfterMs) return null;
  return `otp_user_collaboration_wait_stale:${ageMs}ms>${normalizedStaleAfterMs}ms`;
}

function buildPendingBusinessVerificationForResume(
  pending: TaskPageInteractionSnapshot | null,
  requestedTabId: number | null,
): {
  tabId: number | null;
  intent: string;
  expectedEvidence: TaskBusinessVerificationExpectedEvidence;
} | null {
  if (!pending) return null;
  if (pending.tabId !== null && requestedTabId !== null && pending.tabId !== requestedTabId) {
    return null;
  }

  const intent =
    normalizeIdentifier(pending.candidateActionIntent) ??
    normalizeIdentifier(pending.action) ??
    'unknown';
  return {
    tabId: requestedTabId ?? pending.tabId,
    intent,
    expectedEvidence: inferBusinessVerificationExpectedEvidence(intent),
  };
}

function inferBusinessVerificationExpectedEvidence(
  intent: string,
): TaskBusinessVerificationExpectedEvidence {
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
      return 'search_results_or_url_query_changed';
    case 'content.open_detail':
      return 'detail_region_or_content_transition';
    default:
      return 'page_or_object_state_changed';
  }
}

function normalizeSummaryStrings(values: ReadonlyArray<string> | null | undefined): string[] {
  const result: string[] = [];
  for (const value of values ?? []) {
    const normalized = normalizeBoundedString(value, 160);
    if (!normalized) continue;
    result.push(normalized);
    if (result.length >= 6) break;
  }
  return result;
}

function normalizeBoundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLength);
}

function cloneLiveObservedApiData(input: LiveObservedApiData): LiveObservedApiData {
  return {
    ...input,
    rows: input.rows.map((row) => ({ ...row })),
    contentSections: input.contentSections.map((section) => ({ ...section })),
  };
}

function cloneVisibleRegionRowsData(input: TaskVisibleRegionRowsData): TaskVisibleRegionRowsData {
  return {
    ...input,
    rows: input.rows.map((row) => ({
      ...row,
      visibleTextFields: row.visibleTextFields ? [...row.visibleTextFields] : undefined,
      qualityReasons: row.qualityReasons ? [...row.qualityReasons] : undefined,
      boundingBox: row.boundingBox ? { ...row.boundingBox } : row.boundingBox,
    })),
    rejectedRegionReasonDistribution: input.rejectedRegionReasonDistribution
      ? { ...input.rejectedRegionReasonDistribution }
      : undefined,
  };
}

function cloneReadPageRegions(input: ReadonlyArray<ReadPageRegion>): ReadPageRegion[] {
  return input.map((region) => ({
    ...region,
    candidateActionIds: [...region.candidateActionIds],
    objects: region.objects.map((object) => ({
      ...object,
      actionTypes: [...object.actionTypes],
      locatorChain: object.locatorChain?.map((locator) => ({ ...locator })),
      primaryAction: object.primaryAction
        ? {
            ...object.primaryAction,
            locatorChain: object.primaryAction.locatorChain.map((locator) => ({ ...locator })),
            toolArgs: {
              ...object.primaryAction.toolArgs,
              candidateAction: {
                ...object.primaryAction.toolArgs.candidateAction,
                locatorChain: object.primaryAction.toolArgs.candidateAction.locatorChain.map(
                  (locator) => ({ ...locator }),
                ),
              },
            },
          }
        : undefined,
    })),
  }));
}

function cloneTaskPageRuntimeFields(input: TaskPageRuntimeFields): TaskPageRuntimeFields {
  return {
    currentWindowId: input.currentWindowId,
    currentWindowState: input.currentWindowState,
    currentWindowWidth: input.currentWindowWidth,
    currentWindowHeight: input.currentWindowHeight,
    currentWindowLeft: input.currentWindowLeft,
    currentWindowTop: input.currentWindowTop,
    isCurrentTabActive: input.isCurrentTabActive,
    isCurrentWindowFocused: input.isCurrentWindowFocused,
    browserActiveTabId: input.browserActiveTabId,
    browserActiveTabIdKnown: input.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: input.isReadTargetBrowserActiveTab,
    currentTabUrl: input.currentTabUrl,
    currentTabPendingUrl: input.currentTabPendingUrl,
    currentTabTitle: input.currentTabTitle,
    currentTabStatus: input.currentTabStatus,
    currentTabDiscarded: input.currentTabDiscarded,
    currentTabAudible: input.currentTabAudible,
    currentTabMuted: input.currentTabMuted,
    currentTabPinned: input.currentTabPinned,
    currentTabOpenerTabId: input.currentTabOpenerTabId,
    currentTabOpenedBy: input.currentTabOpenedBy,
    currentTabOpenedBySource: input.currentTabOpenedBySource,
    currentTabOpenedByConfidence: input.currentTabOpenedByConfidence,
    currentTabOpenedByReason: input.currentTabOpenedByReason,
    currentTabAiOperationState: input.currentTabAiOperationState,
    currentTabLastAiOperation: input.currentTabLastAiOperation,
    currentTabLastAiOperationAtMs: input.currentTabLastAiOperationAtMs,
    currentTabLastAiOperationConfidence: input.currentTabLastAiOperationConfidence,
    currentTabLastAiOperationReason: input.currentTabLastAiOperationReason,
    currentTabCanTabrixOperate: input.currentTabCanTabrixOperate,
    currentTabOperabilityReason: input.currentTabOperabilityReason,
    currentTabRuntimeStateSource: input.currentTabRuntimeStateSource,
    browserWorldObjectChangeSummary: input.browserWorldObjectChangeSummary,
    browserWorldActionableObjectChangeSummary: input.browserWorldActionableObjectChangeSummary,
    browserWorldCurrentOperationConclusion: input.browserWorldCurrentOperationConclusion,
    browserWorldRoutingDecisionSummary: input.browserWorldRoutingDecisionSummary,
    currentPageLoadReadinessStatus: input.currentPageLoadReadinessStatus,
    currentPageStability: input.currentPageStability,
    currentPageSnapshotUsableForBusinessAction: input.currentPageSnapshotUsableForBusinessAction,
    currentPageLoadReadinessNextStepHint: input.currentPageLoadReadinessNextStepHint,
  };
}

function buildTaskAuthResumeGate(input: ReadPageAuthResumeVerification): TaskAuthResumeGate {
  const blocksTaskResume =
    input.status !== 'not_required' || input.forceRefreshRequired || input.postconditionRequired;
  return {
    status: input.status,
    nextTool: input.nextTool,
    forceRefreshRequired: input.forceRefreshRequired,
    sameTabRequired: input.sameTabRequired,
    targetTabId: input.targetTabId,
    postconditionRequired: input.postconditionRequired,
    requiredSignals: [...input.requiredSignals],
    blocksTaskResume,
    nextStepHint: inferAuthResumeNextStepHint(input),
    reason: inferAuthResumeGateReason(input),
    claimBoundary: input.claimBoundary,
  };
}

function inferAuthResumeNextStepHint(
  input: ReadPageAuthResumeVerification,
): TaskAuthResumeGate['nextStepHint'] {
  if (input.status === 'not_required' && !input.postconditionRequired) return 'resume_allowed';
  if (input.status === 'not_proven') return 'not_proven_stop_or_collaborate';
  if (input.forceRefreshRequired && input.postconditionRequired) {
    return 'fresh_read_same_tab_then_postcondition';
  }
  if (input.forceRefreshRequired) return 'fresh_read_same_tab';
  if (input.postconditionRequired) return 'verify_postcondition_before_resume';
  return 'not_proven_stop_or_collaborate';
}

function inferAuthResumeGateReason(input: ReadPageAuthResumeVerification): string {
  switch (input.status) {
    case 'not_required':
      return 'auth_resume_not_required';
    case 'required_after_user_action':
      return 'user_auth_action_requires_fresh_same_tab_read_before_resume';
    case 'fresh_read_required':
      return 'cached_or_candidate_auth_state_cannot_resume_task_without_fresh_read';
    case 'postcondition_required':
      return 'auth_candidate_requires_postcondition_before_resume';
    case 'not_proven':
      return 'auth_resume_state_not_proven';
  }
}

function inferResumeReadinessNextStepFromAuthGate(
  input: TaskAuthResumeGate,
): TaskResumeReadinessNextStep {
  if (input.forceRefreshRequired) return 'force_fresh_read_same_tab';
  if (input.postconditionRequired) return 'verify_postcondition';
  if (input.status === 'required_after_user_action') return 'wait_for_user_collaboration';
  return 'stop_not_proven';
}

function withTaskResumeHandoffSummary(
  input: Omit<TaskResumeReadinessSnapshot, 'handoffSummary'>,
): TaskResumeReadinessSnapshot {
  return {
    ...input,
    handoffSummary: buildTaskResumeHandoffSummary(input),
  };
}

function buildTaskResumeHandoffSummary(
  input: Omit<TaskResumeReadinessSnapshot, 'handoffSummary'>,
): TaskResumeHandoffSummary {
  const targetTabHint = Number.isInteger(input.tabId) ? ` on tabId ${input.tabId}` : '';
  const evidenceSummary = {
    readinessStatus: input.status,
    tabId: input.tabId,
    evidenceKinds: [...input.evidenceKinds],
  };

  if (input.canResumeOriginalTask && input.nextStep === 'continue_original_task') {
    return {
      summaryKind: 'task_resume_handoff_v1',
      status: 'ready_to_continue',
      canContinue: true,
      nextAction: 'continue_original_task',
      message: `The latest same-task evidence says the original task may continue${targetTabHint}. Continue only from the bound tab and preserve Browser Hygiene.`,
      evidenceSummary,
      claimBoundary: input.claimBoundary,
    };
  }

  if (input.nextStep === 'force_fresh_read_same_tab') {
    return {
      summaryKind: 'task_resume_handoff_v1',
      status: 'needs_fresh_read',
      canContinue: false,
      nextAction: 'run_chrome_read_page_force_refresh',
      message: `Do not continue yet. Run chrome_read_page with forceRefresh=true${targetTabHint}, then re-check the postcondition before resuming the original task.`,
      evidenceSummary,
      claimBoundary: input.claimBoundary,
    };
  }

  if (input.nextStep === 'wait_for_user_collaboration') {
    return {
      summaryKind: 'task_resume_handoff_v1',
      status: 'waiting_for_user',
      canContinue: false,
      nextAction: 'wait_for_user_collaboration',
      message: `The task is waiting for user collaboration${targetTabHint}. After the user finishes, take a fresh same-tab read and verify the required business state before continuing.`,
      evidenceSummary,
      claimBoundary: input.claimBoundary,
    };
  }

  if (input.nextStep === 'stop_not_proven') {
    return {
      summaryKind: 'task_resume_handoff_v1',
      status: 'stop_not_proven',
      canContinue: false,
      nextAction: 'stop_and_report_not_proven',
      message: `Stop the original task${targetTabHint}. The latest evidence says the business postcondition failed or is not safe to treat as successful.`,
      evidenceSummary,
      claimBoundary: input.claimBoundary,
    };
  }

  return {
    summaryKind: 'task_resume_handoff_v1',
    status: 'needs_postcondition_verification',
    canContinue: false,
    nextAction: 'verify_business_postcondition',
    message: `Do not continue the original task yet${targetTabHint}. Verify the business postcondition with fresh page evidence first.`,
    evidenceSummary,
    claimBoundary: input.claimBoundary,
  };
}

function cloneTaskAuthResumeGate(input: TaskAuthResumeGate): TaskAuthResumeGate {
  return {
    ...input,
    requiredSignals: [...input.requiredSignals],
  };
}

function cloneObjectLifecycleSummary(
  input: ReadPageObjectLifecycleSummary,
): ReadPageObjectLifecycleSummary {
  return {
    ...input,
    items: input.items.map((item) => ({
      ...item,
      actionTypes: [...item.actionTypes],
      candidateActionIds: [...item.candidateActionIds],
      evidenceRefs: [...item.evidenceRefs],
    })),
    changes: input.changes.map((change) => ({ ...change })),
  };
}

function cloneBrowserPageThingProjection(
  input: BrowserPageThingProjection,
): BrowserPageThingProjection {
  const sourceTruthChain = cloneBrowserSourceTruthChain(input.sourceTruthChain);
  return {
    ...input,
    changedRegions: [...input.changedRegions],
    reusedRegions: [...input.reusedRegions],
    invalidatedRefs: [...input.invalidatedRefs],
    refreshedRefs: [...input.refreshedRefs],
    regionEvidenceRefs: [...input.regionEvidenceRefs],
    ...(sourceTruthChain ? { sourceTruthChain } : {}),
  };
}

function cloneBrowserSourceTruthChain(
  input: BrowserSourceTruthChain | null | undefined,
): BrowserSourceTruthChain | null {
  if (!input) return null;
  return {
    primaryOrigin: input.primaryOrigin,
    provenanceCreatedAt: input.provenanceCreatedAt,
    fieldProvenances: input.fieldProvenances.map((entry) => ({ ...entry })),
  };
}
