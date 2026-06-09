import type {
  ReadPageCompactSnapshot,
  ReadPageReadinessVerdict,
  ReadPageSelectedDataSource,
} from './read-page-contract';

export const BROWSER_TASK_THING_CONTRACT_VERSION = 'v1' as const;

export const BROWSER_TASK_STATUS_VALUES = [
  'running',
  'pass',
  'pass_with_gaps',
  'partial',
  'blocked',
  'fail',
] as const;
export type BrowserTaskStatus = (typeof BROWSER_TASK_STATUS_VALUES)[number];

export const BROWSER_TASK_STATE_VALUES = [
  'ready',
  'loading',
  'empty',
  'blocked',
  'login_required',
  'challenge_required',
  'policy_denied',
  'external_blocked',
  'error',
  'unknown',
] as const;
export type BrowserTaskState = (typeof BROWSER_TASK_STATE_VALUES)[number];

export const BROWSER_TASK_NEXT_ACTION_VALUES = [
  'continue_read',
  'wait_and_retry',
  'user_collaboration',
  'respect_policy_gate',
  'inspect_fallback',
  'stop_or_debug',
  'unknown',
] as const;
export type BrowserTaskNextAction = (typeof BROWSER_TASK_NEXT_ACTION_VALUES)[number];

export const BROWSER_TASK_SCENARIO_CLASS_VALUES = [
  'search_result_delta_v1',
  'background_no_focus_v1',
  'active_user_tab_protection_v1',
  'auth_collaboration_resume_v1',
  'article_long_content_read_v1',
  'user_takeover_collaboration_v1',
  'error_recovery_v1',
  'multi_tab_hygiene_v1',
  'postcondition_failure_v1',
  'long_content_structured_read_gate_v1',
  'browser_hygiene_closeout_v1',
  'competitor_same_scenario_v1',
] as const;
export type BrowserTaskScenarioClass = (typeof BROWSER_TASK_SCENARIO_CLASS_VALUES)[number];

export const BROWSER_TASK_SCENARIO_PRIORITY_ORDER = [
  'search_result_delta_v1',
  'article_long_content_read_v1',
  'background_no_focus_v1',
  'active_user_tab_protection_v1',
  'auth_collaboration_resume_v1',
  'user_takeover_collaboration_v1',
  'error_recovery_v1',
  'multi_tab_hygiene_v1',
  'postcondition_failure_v1',
  'long_content_structured_read_gate_v1',
  'browser_hygiene_closeout_v1',
  'competitor_same_scenario_v1',
] as const satisfies readonly BrowserTaskScenarioClass[];

export const BROWSER_ASSISTANT_CLIENT_VALUES = [
  'claude_code',
  'codex',
  'qwenpaw',
  'cursor',
  'unknown',
] as const;
export type BrowserAssistantClient = (typeof BROWSER_ASSISTANT_CLIENT_VALUES)[number] | string;

export const BROWSER_PROFILE_MODE_VALUES = ['same_profile', 'isolated', 'unknown'] as const;
export type BrowserProfileMode = (typeof BROWSER_PROFILE_MODE_VALUES)[number];

export const BROWSER_COMPARISON_MODE_VALUES = [
  'same_profile',
  'not_comparable',
  'reference_only',
] as const;
export type BrowserComparisonMode = (typeof BROWSER_COMPARISON_MODE_VALUES)[number];

export const BROWSER_USER_BOUNDARY_MODE_VALUES = [
  'protected_user_workspace',
  'run_owned_workspace',
  'unknown',
] as const;
export type BrowserUserBoundaryMode = (typeof BROWSER_USER_BOUNDARY_MODE_VALUES)[number];

export const BROWSER_EXECUTION_MODE_VALUES = [
  'run_owned',
  'background',
  'current_tab_readonly',
  'collaboration',
] as const;
export type BrowserExecutionMode = (typeof BROWSER_EXECUTION_MODE_VALUES)[number];

export const BROWSER_FOCUS_POLICY_VALUES = [
  'no_steal',
  'allow_foreground_when_required',
  'user_confirmed',
] as const;
export type BrowserFocusPolicy = (typeof BROWSER_FOCUS_POLICY_VALUES)[number];

export const BROWSER_CLEANUP_POLICY_VALUES = [
  'close_run_owned',
  'keep_handoff',
  'keep_deliverable',
] as const;
export type BrowserCleanupPolicy = (typeof BROWSER_CLEANUP_POLICY_VALUES)[number];

export const BROWSER_RISK_POLICY_VALUES = [
  'read_only',
  'assisted_write',
  'allow_mutation_after_gate',
] as const;
export type BrowserRiskPolicy = (typeof BROWSER_RISK_POLICY_VALUES)[number];

export const BROWSER_DATA_PREFERENCE_VALUES = [
  'prefer_api_rows',
  'prefer_structured_rows',
  'prefer_visible_text',
] as const;
export type BrowserDataPreference = (typeof BROWSER_DATA_PREFERENCE_VALUES)[number];

export interface BrowserContextBudget {
  maxChars: number;
  preferDelta: boolean;
}

export interface BrowserRuntimePolicy {
  desiredExecutionMode: BrowserExecutionMode;
  focusPolicy: BrowserFocusPolicy;
  cleanupPolicy: BrowserCleanupPolicy;
  riskPolicy: BrowserRiskPolicy;
  dataPreference: BrowserDataPreference;
  contextBudget: BrowserContextBudget;
}

export interface BrowserHygieneSummary {
  runOwnedTabsLeft: number;
  userTabsClosed: number;
  focusSteal: boolean;
  protectedTabImpact: boolean;
}

export interface BrowserHygieneEvidence {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  delta: BrowserHygieneSummary;
}

export const BROWSER_PAGE_OWNER_TYPE_VALUES = [
  'run_owned',
  'user_owned',
  'baseline',
  'unknown',
] as const;
export type BrowserPageOwnerType = (typeof BROWSER_PAGE_OWNER_TYPE_VALUES)[number];

export const BROWSER_PAGE_STABILITY_VALUES = [
  'stable',
  'loading',
  'changing',
  'stale',
  'unknown',
] as const;
export type BrowserPageStability = (typeof BROWSER_PAGE_STABILITY_VALUES)[number];

export const BROWSER_PAGE_CHANGE_CAUSE_VALUES = [
  'navigation',
  'search',
  'filter',
  'pagination',
  'click',
  'background_refresh',
  'auth_redirect',
  'unknown',
] as const;
export type BrowserPageChangeCause = (typeof BROWSER_PAGE_CHANGE_CAUSE_VALUES)[number];

export const BROWSER_SOURCE_FRESHNESS_VALUES = ['fresh', 'stale', 'unknown'] as const;
export type BrowserSourceFreshness = (typeof BROWSER_SOURCE_FRESHNESS_VALUES)[number];

export const BROWSER_USER_ACTIVITY_LEVEL_VALUES = [
  'none',
  'active',
  'recent_input',
  'unknown',
] as const;
export type BrowserUserActivityLevel = (typeof BROWSER_USER_ACTIVITY_LEVEL_VALUES)[number];

export const BROWSER_INTERFERENCE_RISK_VALUES = ['none', 'low', 'medium', 'high'] as const;
export type BrowserInterferenceRisk = (typeof BROWSER_INTERFERENCE_RISK_VALUES)[number];

export const BROWSER_PROJECTION_KIND_VALUES = ['read_snapshot_projection'] as const;
export type BrowserProjectionKind = (typeof BROWSER_PROJECTION_KIND_VALUES)[number];

export const BROWSER_PAGE_PROJECTION_DELTA_KIND_VALUES = [
  'initial_overview',
  'read_refresh_delta',
  'post_action_delta',
] as const;
export type BrowserPageProjectionDeltaKind =
  (typeof BROWSER_PAGE_PROJECTION_DELTA_KIND_VALUES)[number];

export const BROWSER_SOURCE_LINEAGE_VALUES = [
  'dom',
  'accessibility',
  'api',
  'cdp',
  'text',
  'mixed',
  'unknown',
] as const;
export type BrowserSourceLineage = (typeof BROWSER_SOURCE_LINEAGE_VALUES)[number];

// P6 Source Truth Chain - field-level provenance tracking
export const SOURCE_TRUTH_ORIGIN_VALUES = [
  'dom',
  'accessibility',
  'api',
  'cdp',
  'text',
  'browser_runtime',
  'inference',
  'unknown',
] as const;
export type SourceTruthOrigin = (typeof SOURCE_TRUTH_ORIGIN_VALUES)[number];

export interface FieldProvenance {
  field: string;
  origin: SourceTruthOrigin;
  isFact: boolean;
}

export interface BrowserSourceTruthChain {
  primaryOrigin: SourceTruthOrigin;
  fieldProvenances: FieldProvenance[];
  provenanceCreatedAt: string;
}

export interface BrowserPageThingProjection {
  projectionId: string;
  projectionKind: BrowserProjectionKind;
  projectionCreatedAt: string;
  sourceObservedAt: string;
  sourceLineage: BrowserSourceLineage;
  regionEvidenceRefs: string[];
  pageId: string;
  tabId: number;
  ownerType: BrowserPageOwnerType;
  readiness: ReadPageReadinessVerdict;
  stability: BrowserPageStability;
  pageRole: string | null;
  contextVersion: string;
  previousContextVersion: string | null;
  changedByActionId: string | null;
  changeCause: BrowserPageChangeCause;
  activeRegion: string | null;
  changedRegions: string[];
  reusedRegions: string[];
  invalidatedRefs: string[];
  refreshedRefs: string[];
  chosenDataSource: ReadPageSelectedDataSource;
  sourceConfidence: number;
  sourceFreshness: BrowserSourceFreshness;
  contextChars: number;
  contextSavedChars: number;
  userActivityLevel: BrowserUserActivityLevel;
  interferenceRisk: BrowserInterferenceRisk;
  sourceTruthChain: BrowserSourceTruthChain;
}

export interface BrowserTaskStateVerdict {
  state: BrowserTaskState;
  reason: string;
  readiness: ReadPageReadinessVerdict;
  stability: BrowserPageStability;
  sourceConfidence: number | null;
  sourceFreshness: BrowserSourceFreshness;
  userActivityLevel: BrowserUserActivityLevel;
  interferenceRisk: BrowserInterferenceRisk;
  recommendedNextAction: BrowserTaskNextAction;
}

export interface BrowserPageProjectionDelta {
  deltaId: string;
  deltaKind: BrowserPageProjectionDeltaKind;
  fromProjectionId: string | null;
  toProjectionId: string;
  changedRegions: string[];
  reusedRegions: string[];
  invalidatedRefs: string[];
  refreshedRefs: string[];
  contextChars: number;
  previousContextChars: number | null;
  contextSavedChars: number;
  contextSavedRatio: number;
  evidenceBoundary: BrowserPageProjectionDeltaEvidenceBoundary;
}

export const ACTION_EVIDENCE_RESULT_ACTION_KIND_VALUES = [
  'click',
  'hover',
  'fill',
  'navigate',
  'close_tabs',
  'unknown',
] as const;
export type ActionEvidenceResultActionKind =
  (typeof ACTION_EVIDENCE_RESULT_ACTION_KIND_VALUES)[number];

export const ACTION_EVIDENCE_BUSINESS_SUCCESS_VERDICT_VALUES = [
  'proven',
  'not_proven',
  'blocked',
  'unknown',
] as const;
export type ActionEvidenceBusinessSuccessVerdict =
  (typeof ACTION_EVIDENCE_BUSINESS_SUCCESS_VERDICT_VALUES)[number];

export const ACTION_EVIDENCE_BROWSER_HYGIENE_STATUS_VALUES = [
  'not_required',
  'not_checked',
  'pass',
  'fail',
  'unknown',
] as const;
export type ActionEvidenceBrowserHygieneStatus =
  (typeof ACTION_EVIDENCE_BROWSER_HYGIENE_STATUS_VALUES)[number];

export type ActionEvidenceSourceRouteHonestyVerdict =
  | 'api_proven'
  | 'cdp_proven'
  | 'dom_fallback'
  | 'mixed'
  | 'unknown'
  | 'blocked'
  | 'not_checked';

export interface ActionEvidenceTargetBinding {
  requestedTargetRef: string | null;
  resolvedTargetRef: string | null;
  locatorChainSummary: string[];
  dispatchTarget: 'ref' | 'selector' | 'coordinates' | 'none' | 'unknown' | string;
  frameScope: string | null;
  targetBindingProven: boolean | null;
  claimBoundary: string;
}

export interface ActionEvidenceDispatch {
  dispatched: boolean;
  acceptedByBrowser: boolean;
  errorCode: string | null;
}

export interface ActionEvidenceSource {
  selectedDataSource: ReadPageSelectedDataSource | 'unknown' | null;
  sourceRouteHonestyVerdict: ActionEvidenceSourceRouteHonestyVerdict;
  fallbackUsed: boolean | null;
}

export interface ActionEvidencePostAction {
  postActionReadbackStatus: string;
  postconditionVerdict: string;
  freshReadRequired: boolean | null;
  readbackSource: string | null;
}

export interface ActionEvidenceBusiness {
  businessSuccessVerdict: ActionEvidenceBusinessSuccessVerdict;
  businessSuccessProven: boolean;
  negativeEvidence: string[];
  nextRequiredCheck: string | null;
}

export interface ActionEvidenceBrowserHygiene {
  required: boolean;
  status: ActionEvidenceBrowserHygieneStatus;
  leakedTabsOrWindows: number | null;
}

export interface ActionEvidenceResult {
  actionId: string;
  actionKind: ActionEvidenceResultActionKind;
  taskSessionId: string | null;
  tabId: number | null;
  toolSuccess: boolean;
  targetBinding: ActionEvidenceTargetBinding;
  dispatch: ActionEvidenceDispatch;
  source: ActionEvidenceSource;
  postAction: ActionEvidencePostAction;
  business: ActionEvidenceBusiness;
  browserHygiene: ActionEvidenceBrowserHygiene;
  producedAt: string;
  claimBoundary: string[];
}

export interface BuildActionEvidenceResultInput {
  actionId: string;
  actionKind: ActionEvidenceResultActionKind;
  taskSessionId?: string | null;
  tabId?: number | null;
  toolSuccess?: boolean;
  targetBinding?: Partial<ActionEvidenceTargetBinding> | null;
  dispatch: ActionEvidenceDispatch;
  source?: Partial<ActionEvidenceSource> | null;
  postAction?: Partial<ActionEvidencePostAction> | null;
  business?: Partial<ActionEvidenceBusiness> | null;
  browserHygiene?: Partial<ActionEvidenceBrowserHygiene> | null;
  producedAt?: string;
  claimBoundary?: string[];
}

export const POST_ACTION_DELTA_SIGNAL_STATUS_VALUES = [
  'observed',
  'not_observed',
  'not_checked',
  'unknown',
] as const;
export type PostActionDeltaSignalStatus = (typeof POST_ACTION_DELTA_SIGNAL_STATUS_VALUES)[number];

export interface PostActionDeltaNavigationSignal {
  status: PostActionDeltaSignalStatus;
  beforeUrl: string | null;
  afterUrl: string | null;
}

export interface PostActionDeltaFocusSignal {
  status: PostActionDeltaSignalStatus;
  beforeTabId: number | null;
  afterTabId: number | null;
}

export interface PostActionDeltaObjectSignal {
  status: PostActionDeltaSignalStatus;
  changedObjectIds: string[];
}

export interface PostActionDeltaNetworkSignalSummary {
  status: PostActionDeltaSignalStatus;
  observedRequestCount: number | null;
  observedResponseCount: number | null;
}

export interface PostActionDeltaEvidence {
  watchId: string;
  taskSessionId: string | null;
  tabId: number | null;
  actionId: string | null;
  actionEvidenceId: string | null;
  deltaKind: BrowserPageProjectionDeltaKind;
  beforeProjectionId: string | null;
  afterProjectionId: string;
  changedRegions: string[];
  invalidatedRefs: string[];
  refreshedRefs: string[];
  navigationDelta: PostActionDeltaNavigationSignal;
  focusDelta: PostActionDeltaFocusSignal;
  objectDelta: PostActionDeltaObjectSignal;
  networkSignalSummary: PostActionDeltaNetworkSignalSummary;
  sourceTruthChain: BrowserSourceTruthChain | null;
  evidenceBoundary: BrowserPageProjectionDeltaEvidenceBoundary;
  recommendedNextAction: string;
  producedAt: string;
  claimBoundary: string[];
}

export interface BuildPostActionDeltaEvidenceInput {
  delta: BrowserPageProjectionDelta;
  actionEvidenceResult?: ActionEvidenceResult | null;
  taskSessionId?: string | null;
  tabId?: number | null;
  actionId?: string | null;
  actionEvidenceId?: string | null;
  sourceTruthChain?: BrowserSourceTruthChain | null;
  navigationDelta?: Partial<PostActionDeltaNavigationSignal> | null;
  focusDelta?: Partial<PostActionDeltaFocusSignal> | null;
  objectDelta?: Partial<PostActionDeltaObjectSignal> | null;
  networkSignalSummary?: Partial<PostActionDeltaNetworkSignalSummary> | null;
  recommendedNextAction?: string;
  producedAt?: string;
  claimBoundary?: string[];
}

export interface BrowserTaskThingSummary {
  taskId: string;
  runId: string;
  assistantClient: BrowserAssistantClient;
  profileMode: BrowserProfileMode;
  comparisonMode: BrowserComparisonMode;
  userBoundaryMode: BrowserUserBoundaryMode;
  startedAt: string;
  endedAt: string | null;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass;
  status: BrowserTaskStatus;
  requestedToolPath: string;
  actualToolPath: string;
  runtimePolicy: BrowserRuntimePolicy;
  currentPageId: string | null;
  currentPageProjectionId: string | null;
  evidenceIds: string[];
  browserHygieneSummary: BrowserHygieneSummary;
  gaps: string[];
}

export const BROWSER_TASK_EVIDENCE_LEVEL_VALUES = [
  'source',
  'unit',
  'integration',
  'local_runner',
  'real_browser',
  'private_scenario',
  'competitor',
  'same_scenario_competitor',
  'release_gate',
] as const;
export type BrowserTaskEvidenceLevel = (typeof BROWSER_TASK_EVIDENCE_LEVEL_VALUES)[number];

export const BROWSER_TASK_LOCAL_EVIDENCE_LEVEL_VALUES = [
  'source',
  'unit',
  'integration',
  'local_runner',
] as const satisfies readonly BrowserTaskEvidenceLevel[];
export type BrowserTaskLocalEvidenceLevel =
  (typeof BROWSER_TASK_LOCAL_EVIDENCE_LEVEL_VALUES)[number];

export const BROWSER_TASK_REAL_ACCEPTANCE_EVIDENCE_LEVEL_VALUES = [
  'real_browser',
  'private_scenario',
  'competitor',
  'same_scenario_competitor',
  'release_gate',
] as const satisfies readonly BrowserTaskEvidenceLevel[];
export type BrowserTaskRealAcceptanceEvidenceLevel =
  (typeof BROWSER_TASK_REAL_ACCEPTANCE_EVIDENCE_LEVEL_VALUES)[number];

export const BROWSER_EVIDENCE_FRESHNESS_VALUES = ['fresh', 'stale', 'expired'] as const;
export type BrowserEvidenceFreshness = (typeof BROWSER_EVIDENCE_FRESHNESS_VALUES)[number];

export const BROWSER_COMPETITOR_LANE_VALUES = [
  'same_profile_extension',
  'same_profile_mcp',
  'isolated_browser',
  'headless_agent',
  'benchmark_only',
  'not_comparable',
  'not_applicable',
] as const;
export type BrowserCompetitorLane = (typeof BROWSER_COMPETITOR_LANE_VALUES)[number];

export interface BrowserRejectedDataSource {
  source: ReadPageSelectedDataSource;
  reason: string;
}

export interface BrowserDataSourceDecisionEvidence {
  availableSources: ReadPageSelectedDataSource[];
  selectedSource: ReadPageSelectedDataSource;
  selectedReason: string;
  rejectedSources: BrowserRejectedDataSource[];
  regionCorrelation: number | null;
  taskRelevance: number | null;
  privacySafety: 'safe' | 'redacted' | 'blocked' | 'unknown';
  metadataCompleteness: number | null;
  sourceFreshness: BrowserSourceFreshness;
  sourceConfidence: number;
  fallbackReason: string | null;
}

export interface BrowserPolicyAuditEvent {
  field: keyof BrowserRuntimePolicy;
  requestedValue: unknown;
  previousValue: unknown;
  effectiveValue: unknown;
  verdict: 'applied' | 'rejected' | 'ignored';
  reason: string | null;
  at: string;
  source: 'assistant' | 'runtime' | 'user' | 'policy';
}

export interface BrowserPrivacyRedactionEvidence {
  userTypedContentPersisted: false;
  formValuesPersisted: false;
  fullApiBodiesPersisted: false;
  credentialsOrTokensPersisted: false;
  redactionNotes: string[];
}

export interface BrowserClaimCoverageEvidence {
  claims: string[];
  supportedClaims: string[];
  unsupportedClaims: string[];
}

export interface BrowserTaskEvidence {
  evidenceId: string;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass;
  artifactPath: string;
  evidenceLevel: BrowserTaskEvidenceLevel;
  freshness: BrowserEvidenceFreshness;
  competitorLane: BrowserCompetitorLane;
  browserHygiene: BrowserHygieneEvidence;
  dataSourceDecision: BrowserDataSourceDecisionEvidence;
  runtimePolicyAudit: BrowserPolicyAuditEvent[];
  privacyRedaction: BrowserPrivacyRedactionEvidence;
  claimCoverage: BrowserClaimCoverageEvidence;
}

export const BROWSER_TASK_FIXTURE_ARTIFACT_KIND = 'deterministic_fixture' as const;

export const BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES = [
  'source',
  'unit',
  'integration',
  'local_runner',
] as const satisfies readonly BrowserTaskEvidenceLevel[];
export type BrowserTaskFixtureEvidenceLevel =
  (typeof BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES)[number];

export interface BrowserTaskFixtureEvidenceBoundary {
  evidenceLevel: BrowserTaskFixtureEvidenceLevel;
  realBrowserClaim: false;
}

export type BrowserPageProjectionDeltaEvidenceBoundary =
  | BrowserTaskFixtureEvidenceBoundary
  | {
      evidenceLevel: 'real_browser';
      realBrowserClaim: true;
    };

export interface BrowserTaskDeterministicFixtureArtifact {
  artifactKind: typeof BROWSER_TASK_FIXTURE_ARTIFACT_KIND;
  contractVersion: typeof BROWSER_TASK_THING_CONTRACT_VERSION;
  generatedAt: string;
  summary: BrowserTaskThingSummary;
  pageProjection: BrowserPageThingProjection;
  evidence: BrowserTaskEvidence;
  evidenceBoundary: BrowserTaskFixtureEvidenceBoundary;
}

export interface BrowserPageProjectionDeltaArtifact {
  artifactKind: typeof BROWSER_TASK_FIXTURE_ARTIFACT_KIND;
  contractVersion: typeof BROWSER_TASK_THING_CONTRACT_VERSION;
  generatedAt: string;
  deltaProjection: BrowserPageProjectionDelta;
  evidenceBoundary: BrowserTaskFixtureEvidenceBoundary;
}

export function isBrowserTaskPrivacyRedactionSafe(
  privacyRedaction: BrowserPrivacyRedactionEvidence,
): boolean {
  return (
    privacyRedaction.userTypedContentPersisted === false &&
    privacyRedaction.formValuesPersisted === false &&
    privacyRedaction.fullApiBodiesPersisted === false &&
    privacyRedaction.credentialsOrTokensPersisted === false
  );
}

export function isBrowserTaskDeterministicFixtureArtifact(
  artifact: BrowserTaskDeterministicFixtureArtifact,
): boolean {
  return (
    artifact.artifactKind === BROWSER_TASK_FIXTURE_ARTIFACT_KIND &&
    artifact.contractVersion === BROWSER_TASK_THING_CONTRACT_VERSION &&
    artifact.evidenceBoundary.realBrowserClaim === false &&
    BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES.includes(artifact.evidenceBoundary.evidenceLevel) &&
    artifact.evidence.evidenceLevel === artifact.evidenceBoundary.evidenceLevel &&
    artifact.evidence.freshness === 'fresh' &&
    artifact.evidence.competitorLane === 'not_applicable' &&
    isBrowserTaskPrivacyRedactionSafe(artifact.evidence.privacyRedaction)
  );
}

export function isBrowserPageProjectionDeltaArtifact(
  artifact: BrowserPageProjectionDeltaArtifact,
): boolean {
  return (
    artifact.artifactKind === BROWSER_TASK_FIXTURE_ARTIFACT_KIND &&
    artifact.contractVersion === BROWSER_TASK_THING_CONTRACT_VERSION &&
    artifact.evidenceBoundary.realBrowserClaim === false &&
    BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES.includes(artifact.evidenceBoundary.evidenceLevel) &&
    artifact.deltaProjection.evidenceBoundary.realBrowserClaim === false &&
    artifact.deltaProjection.evidenceBoundary.evidenceLevel ===
      artifact.evidenceBoundary.evidenceLevel
  );
}

export interface BuildBrowserPageProjectionDeltaInput {
  previousProjection: BrowserPageThingProjection | null;
  currentProjection: BrowserPageThingProjection;
  deltaId: string;
  deltaKind: BrowserPageProjectionDeltaKind;
  evidenceBoundary?: BrowserPageProjectionDeltaEvidenceBoundary;
}

export function buildBrowserPageProjectionDelta(
  input: BuildBrowserPageProjectionDeltaInput,
): BrowserPageProjectionDelta {
  if (input.deltaKind === 'post_action_delta' && input.previousProjection === null) {
    throw new Error('post_action_delta requires previousProjection');
  }

  const previousContextChars = input.previousProjection?.contextChars ?? null;
  const contextSavedChars = Math.max(
    0,
    previousContextChars === null ? 0 : previousContextChars - input.currentProjection.contextChars,
  );
  const contextSavedRatio =
    previousContextChars === null || previousContextChars <= 0
      ? 0
      : Math.min(1, contextSavedChars / previousContextChars);

  return {
    deltaId: input.deltaId,
    deltaKind: input.deltaKind,
    fromProjectionId: input.previousProjection?.projectionId ?? null,
    toProjectionId: input.currentProjection.projectionId,
    changedRegions: input.currentProjection.changedRegions,
    reusedRegions: input.currentProjection.reusedRegions,
    invalidatedRefs: input.currentProjection.invalidatedRefs,
    refreshedRefs: input.currentProjection.refreshedRefs,
    contextChars: input.currentProjection.contextChars,
    previousContextChars,
    contextSavedChars,
    contextSavedRatio,
    evidenceBoundary: input.evidenceBoundary ?? { evidenceLevel: 'unit', realBrowserClaim: false },
  };
}

export function buildActionEvidenceResult(
  input: BuildActionEvidenceResultInput,
): ActionEvidenceResult {
  const targetBinding: ActionEvidenceTargetBinding = {
    requestedTargetRef: input.targetBinding?.requestedTargetRef ?? null,
    resolvedTargetRef: input.targetBinding?.resolvedTargetRef ?? null,
    locatorChainSummary: input.targetBinding?.locatorChainSummary ?? [],
    dispatchTarget: input.targetBinding?.dispatchTarget ?? 'unknown',
    frameScope: input.targetBinding?.frameScope ?? null,
    targetBindingProven: input.targetBinding?.targetBindingProven ?? null,
    claimBoundary:
      input.targetBinding?.claimBoundary ??
      'Target binding proves only where Tabrix dispatched the action; it does not prove business success.',
  };
  const postAction: ActionEvidencePostAction = {
    postActionReadbackStatus: input.postAction?.postActionReadbackStatus ?? 'unknown',
    postconditionVerdict: input.postAction?.postconditionVerdict ?? 'unknown',
    freshReadRequired: input.postAction?.freshReadRequired ?? null,
    readbackSource: input.postAction?.readbackSource ?? null,
  };
  const inferredBusinessProven = input.business?.businessSuccessProven ?? false;
  const businessSuccessVerdict =
    input.business?.businessSuccessVerdict ?? (inferredBusinessProven ? 'proven' : 'not_proven');

  return {
    actionId: input.actionId,
    actionKind: input.actionKind,
    taskSessionId: input.taskSessionId ?? null,
    tabId: input.tabId ?? null,
    toolSuccess:
      input.toolSuccess ?? (input.dispatch.dispatched === true && input.dispatch.acceptedByBrowser),
    targetBinding,
    dispatch: input.dispatch,
    source: {
      selectedDataSource: input.source?.selectedDataSource ?? 'unknown',
      sourceRouteHonestyVerdict: input.source?.sourceRouteHonestyVerdict ?? 'not_checked',
      fallbackUsed: input.source?.fallbackUsed ?? null,
    },
    postAction,
    business: {
      businessSuccessVerdict,
      businessSuccessProven: inferredBusinessProven,
      negativeEvidence: input.business?.negativeEvidence ?? [],
      nextRequiredCheck:
        input.business?.nextRequiredCheck ??
        (businessSuccessVerdict === 'proven' ? 'none' : 'fresh_read_page_or_postcondition_check'),
    },
    browserHygiene: {
      required: input.browserHygiene?.required ?? false,
      status: input.browserHygiene?.status ?? 'not_checked',
      leakedTabsOrWindows: input.browserHygiene?.leakedTabsOrWindows ?? null,
    },
    producedAt: input.producedAt ?? new Date().toISOString(),
    claimBoundary: input.claimBoundary ?? [
      'Tool success proves dispatch/acceptance only; it does not by itself prove business success.',
      'Source-route, postcondition, readback, and browser-hygiene fields must be read separately.',
      'Local deterministic evidence does not prove real-browser acceptance, release readiness, or competitor parity.',
    ],
  };
}

export function buildPostActionDeltaEvidence(
  input: BuildPostActionDeltaEvidenceInput,
): PostActionDeltaEvidence {
  const actionId = input.actionId ?? input.actionEvidenceResult?.actionId ?? null;
  const tabId = input.tabId ?? input.actionEvidenceResult?.tabId ?? null;

  return {
    watchId: `watch:${input.delta.deltaId}`,
    taskSessionId: input.taskSessionId ?? input.actionEvidenceResult?.taskSessionId ?? null,
    tabId,
    actionId,
    actionEvidenceId: input.actionEvidenceId ?? input.actionEvidenceResult?.actionId ?? null,
    deltaKind: input.delta.deltaKind,
    beforeProjectionId: input.delta.fromProjectionId,
    afterProjectionId: input.delta.toProjectionId,
    changedRegions: input.delta.changedRegions,
    invalidatedRefs: input.delta.invalidatedRefs,
    refreshedRefs: input.delta.refreshedRefs,
    navigationDelta: {
      status: input.navigationDelta?.status ?? 'unknown',
      beforeUrl: input.navigationDelta?.beforeUrl ?? null,
      afterUrl: input.navigationDelta?.afterUrl ?? null,
    },
    focusDelta: {
      status: input.focusDelta?.status ?? 'unknown',
      beforeTabId: input.focusDelta?.beforeTabId ?? null,
      afterTabId: input.focusDelta?.afterTabId ?? tabId,
    },
    objectDelta: {
      status: input.objectDelta?.status ?? 'not_checked',
      changedObjectIds: input.objectDelta?.changedObjectIds ?? [],
    },
    networkSignalSummary: {
      status: input.networkSignalSummary?.status ?? 'not_checked',
      observedRequestCount: input.networkSignalSummary?.observedRequestCount ?? null,
      observedResponseCount: input.networkSignalSummary?.observedResponseCount ?? null,
    },
    sourceTruthChain: input.sourceTruthChain ?? null,
    evidenceBoundary: input.delta.evidenceBoundary,
    recommendedNextAction:
      input.recommendedNextAction ??
      (input.delta.deltaKind === 'post_action_delta'
        ? 'continue_with_post_action_delta_context'
        : 'run_action_then_fresh_read_for_post_action_delta'),
    producedAt: input.producedAt ?? new Date().toISOString(),
    claimBoundary: input.claimBoundary ?? [
      'Post-action delta evidence describes projection changes after a fresh read; it does not prove the whole business task succeeded.',
      'DOM/region/ref deltas do not prove API/CDP reuse, complete navigation monitoring, focus safety, object lifecycle coverage, or network causality.',
      'Local deterministic evidence does not prove real-browser acceptance, release readiness, or competitor parity.',
    ],
  };
}

export interface BuildBrowserPageThingProjectionInput {
  snapshot: ReadPageCompactSnapshot;
  projectionId: string;
  observedAt: string;
  pageId: string;
  tabId: number;
  ownerType: BrowserPageOwnerType;
  contextVersion: string;
  previousContextVersion?: string | null;
  changedByActionId?: string | null;
  changeCause?: BrowserPageChangeCause;
  changedRegions?: string[];
  reusedRegions?: string[];
  invalidatedRefs?: string[];
  refreshedRefs?: string[];
  previousContextChars?: number | null;
  userActivityLevel?: BrowserUserActivityLevel;
  interferenceRisk?: BrowserInterferenceRisk;
  stability?: BrowserPageStability;
}

export function buildBrowserPageThingProjectionFromReadPage(
  input: BuildBrowserPageThingProjectionInput,
): BrowserPageThingProjection {
  const { snapshot } = input;
  const activeRegion = inferProjectionActiveRegion(snapshot);
  const contextChars = estimateSnapshotContextChars(snapshot);
  const previousContextChars = input.previousContextChars ?? null;
  const chosenDataSource = chooseProjectionDataSource(snapshot);

  return {
    projectionId: input.projectionId,
    projectionKind: 'read_snapshot_projection',
    projectionCreatedAt: input.observedAt,
    sourceObservedAt: input.observedAt,
    sourceLineage: inferSourceLineage(chosenDataSource),
    regionEvidenceRefs: buildRegionEvidenceRefs(snapshot),
    pageId: input.pageId,
    tabId: input.tabId,
    ownerType: input.ownerType,
    readiness: snapshot.readinessVerdict ?? 'unknown',
    stability: input.stability ?? 'stable',
    pageRole: inferProjectionPageRole(snapshot),
    contextVersion: input.contextVersion,
    previousContextVersion: input.previousContextVersion ?? null,
    changedByActionId: input.changedByActionId ?? null,
    changeCause: input.changeCause ?? 'unknown',
    activeRegion,
    changedRegions: input.changedRegions ?? (activeRegion ? [activeRegion] : []),
    reusedRegions: input.reusedRegions ?? [],
    invalidatedRefs: input.invalidatedRefs ?? [],
    refreshedRefs: input.refreshedRefs ?? collectVisibleRowTargetRefs(snapshot),
    chosenDataSource,
    sourceConfidence: estimateProjectionSourceConfidence(chosenDataSource, snapshot),
    sourceFreshness: 'fresh',
    contextChars,
    contextSavedChars: Math.max(0, (previousContextChars ?? contextChars) - contextChars),
    userActivityLevel: input.userActivityLevel ?? 'unknown',
    interferenceRisk: input.interferenceRisk ?? 'medium',
    sourceTruthChain: buildSourceTruthChain(chosenDataSource, snapshot, input.observedAt),
  };
}

export interface BuildBrowserTaskStateVerdictInput {
  projection: BrowserPageThingProjection;
  readinessReason?: string | null;
  policyDeniedReason?: string | null;
  externalBlockedReason?: string | null;
}

export function buildBrowserTaskStateVerdict(
  input: BuildBrowserTaskStateVerdictInput,
): BrowserTaskStateVerdict {
  const reasonText = [
    input.policyDeniedReason,
    input.externalBlockedReason,
    input.readinessReason,
    input.projection.readiness,
    input.projection.stability,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();

  const state = inferBrowserTaskState(input, reasonText);
  return {
    state,
    reason: inferBrowserTaskStateReason(input, state),
    readiness: input.projection.readiness,
    stability: input.projection.stability,
    sourceConfidence: Number.isFinite(input.projection.sourceConfidence)
      ? input.projection.sourceConfidence
      : null,
    sourceFreshness: input.projection.sourceFreshness,
    userActivityLevel: input.projection.userActivityLevel,
    interferenceRisk: input.projection.interferenceRisk,
    recommendedNextAction: recommendNextActionForTaskState(state),
  };
}

function inferBrowserTaskState(
  input: BuildBrowserTaskStateVerdictInput,
  reasonText: string,
): BrowserTaskState {
  if (input.policyDeniedReason) return 'policy_denied';
  if (input.externalBlockedReason) return 'external_blocked';
  if (matchesAny(reasonText, ['captcha', 'recaptcha', 'verification', 'verify', 'challenge'])) {
    return 'challenge_required';
  }
  if (matchesAny(reasonText, ['login', 'signin', 'sign in', 'auth_or_login_required'])) {
    return 'login_required';
  }
  if (input.projection.stability === 'loading' || input.projection.stability === 'changing') {
    return 'loading';
  }
  if (input.projection.readiness === 'empty') return 'empty';
  if (input.projection.readiness === 'error') return 'error';
  if (input.projection.readiness === 'blocked') return 'blocked';
  if (input.projection.readiness === 'ready' && input.projection.stability === 'stable') {
    return 'ready';
  }
  if (input.projection.sourceFreshness === 'stale' || input.projection.stability === 'stale') {
    return 'blocked';
  }
  return 'unknown';
}

function inferBrowserTaskStateReason(
  input: BuildBrowserTaskStateVerdictInput,
  state: BrowserTaskState,
): string {
  if (input.policyDeniedReason) return input.policyDeniedReason;
  if (input.externalBlockedReason) return input.externalBlockedReason;
  if (input.readinessReason) return input.readinessReason;
  switch (state) {
    case 'ready':
      return 'page_projection_ready_and_stable';
    case 'loading':
      return 'page_projection_loading_or_changing';
    case 'empty':
      return 'readiness_empty';
    case 'blocked':
      return 'readiness_blocked_or_stale';
    case 'login_required':
      return 'auth_or_login_required';
    case 'challenge_required':
      return 'challenge_or_verification_required';
    case 'policy_denied':
      return 'policy_denied';
    case 'external_blocked':
      return 'external_blocked';
    case 'error':
      return 'readiness_error';
    case 'unknown':
      return 'insufficient_task_state_evidence';
    default:
      return 'insufficient_task_state_evidence';
  }
}

function recommendNextActionForTaskState(state: BrowserTaskState): BrowserTaskNextAction {
  switch (state) {
    case 'ready':
    case 'empty':
      return 'continue_read';
    case 'loading':
      return 'wait_and_retry';
    case 'login_required':
    case 'challenge_required':
      return 'user_collaboration';
    case 'policy_denied':
      return 'respect_policy_gate';
    case 'blocked':
    case 'external_blocked':
      return 'inspect_fallback';
    case 'error':
      return 'stop_or_debug';
    case 'unknown':
      return 'unknown';
    default:
      return 'unknown';
  }
}

function matchesAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}

function inferSourceLineage(source: ReadPageSelectedDataSource): BrowserSourceLineage {
  if (source === 'api_rows') return 'api';
  if (source === 'cdp_enhanced_api_rows') return 'cdp';
  if (source === 'markdown') return 'text';
  if (source === 'dom_region_rows' || source === 'dom_json') return 'dom';
  return 'unknown';
}

function sourceLineageToOrigin(lineage: BrowserSourceLineage): SourceTruthOrigin {
  if (lineage === 'mixed' || lineage === 'unknown') return 'unknown';
  return lineage;
}

function buildSourceTruthChain(
  source: ReadPageSelectedDataSource,
  snapshot: ReadPageCompactSnapshot,
  observedAt: string,
): BrowserSourceTruthChain {
  const lineage = inferSourceLineage(source);
  const primaryOrigin = sourceLineageToOrigin(lineage);
  const contentOrigin: SourceTruthOrigin = primaryOrigin === 'unknown' ? 'unknown' : primaryOrigin;
  const fieldProvenances: FieldProvenance[] = [
    { field: 'pageProjection.pageId', origin: 'browser_runtime', isFact: true },
    { field: 'pageProjection.tabId', origin: 'browser_runtime', isFact: true },
    { field: 'pageProjection.readiness', origin: contentOrigin, isFact: true },
    { field: 'pageProjection.stability', origin: 'browser_runtime', isFact: true },
    { field: 'pageProjection.pageRole', origin: 'inference', isFact: false },
    { field: 'pageProjection.activeRegion', origin: 'inference', isFact: false },
  ];

  return { primaryOrigin, fieldProvenances, provenanceCreatedAt: observedAt };
}

function buildRegionEvidenceRefs(snapshot: ReadPageCompactSnapshot): string[] {
  const refs = new Set<string>();
  const activeRegion = inferProjectionActiveRegion(snapshot);
  if (activeRegion) {
    refs.add(`region:${activeRegion}`);
  }
  for (const row of snapshot.visibleRegionRows?.rows ?? []) {
    refs.add(`row:${row.rowId}`);
  }
  return [...refs];
}

function inferProjectionPageRole(snapshot: ReadPageCompactSnapshot): string | null {
  const pageRole = snapshot.summary.pageRole;
  if (typeof pageRole !== 'string') return null;
  const normalized = pageRole.trim();
  return normalized.length > 0 ? normalized : null;
}

function inferProjectionActiveRegion(snapshot: ReadPageCompactSnapshot): string | null {
  const sourceRegion = snapshot.visibleRegionRows?.sourceRegion ?? snapshot.summary.primaryRegion;
  const summaryRegion = snapshot.summary.primaryRegion;
  const role = snapshot.summary.pageRole.toLowerCase();
  if (
    isLowLevelVisibleRowsRegion(sourceRegion) &&
    summaryRegion &&
    !isLowLevelVisibleRowsRegion(summaryRegion) &&
    !role.includes('search') &&
    !role.includes('list') &&
    !role.includes('results')
  ) {
    return summaryRegion;
  }
  if (sourceRegion !== 'viewport') return sourceRegion;
  if (!snapshot.visibleRegionRows?.visibleRegionRowsUsed) return sourceRegion;
  if (snapshot.visibleRegionRows.rowCount <= 0) return sourceRegion;
  if (snapshot.visibleRegionRows.rowExtractionConfidence < 0.7) return sourceRegion;
  if (role.includes('search') || role.includes('list') || role.includes('results')) {
    return 'result_list';
  }
  if (hasStrongVisibleResultRows(snapshot)) return 'result_list';
  if (summaryRegion && summaryRegion !== 'viewport') return summaryRegion;
  return sourceRegion;
}

function isLowLevelVisibleRowsRegion(region: string | null | undefined): boolean {
  return region === 'viewport' || region === 'visible_text' || region === 'visible_results';
}

function hasStrongVisibleResultRows(snapshot: ReadPageCompactSnapshot): boolean {
  const rows = snapshot.visibleRegionRows;
  if (!rows) return false;
  return (
    rows.rowCount >= 3 &&
    rows.targetRefCoverageRate >= 0.95 &&
    rows.regionQualityScore >= 0.7 &&
    rows.cardExtractorUsed === true
  );
}

const MIN_RELIABLE_VISIBLE_ROW_COUNT = 2;
const MIN_RELIABLE_VISIBLE_ROW_CONFIDENCE = 0.7;
const MIN_RELIABLE_VISIBLE_ROW_TARGET_REF_COVERAGE = 0.95;
const MIN_RELIABLE_VISIBLE_ROW_REGION_QUALITY = 0.7;

function chooseProjectionDataSource(snapshot: ReadPageCompactSnapshot): ReadPageSelectedDataSource {
  if (snapshot.selectedDataSource === 'dom_region_rows') {
    return hasReliableVisibleRows(snapshot)
      ? 'dom_region_rows'
      : chooseNonDomProjectionFallback(snapshot);
  }
  if (shouldPreferCompleteTextRegion(snapshot)) return 'markdown';
  if (snapshot.selectedDataSource) return snapshot.selectedDataSource;
  if (snapshot.kind === 'dom_region_rows') {
    return hasReliableVisibleRows(snapshot)
      ? 'dom_region_rows'
      : chooseNonDomProjectionFallback(snapshot);
  }
  if (snapshot.kind) return snapshot.kind;
  if (hasReliableVisibleRows(snapshot)) return 'dom_region_rows';
  if (snapshot.renderMode === 'markdown' && snapshot.markdown) return 'markdown';
  return 'dom_json';
}

function hasReliableVisibleRows(snapshot: ReadPageCompactSnapshot): boolean {
  const rows = snapshot.visibleRegionRows;
  if (!rows?.visibleRegionRowsUsed) return false;
  const actualRows = rows.rows.length;
  return (
    rows.rowCount >= MIN_RELIABLE_VISIBLE_ROW_COUNT &&
    actualRows >= MIN_RELIABLE_VISIBLE_ROW_COUNT &&
    rows.rowExtractionConfidence >= MIN_RELIABLE_VISIBLE_ROW_CONFIDENCE &&
    rows.targetRefCoverageRate >= MIN_RELIABLE_VISIBLE_ROW_TARGET_REF_COVERAGE &&
    rows.regionQualityScore >= MIN_RELIABLE_VISIBLE_ROW_REGION_QUALITY
  );
}

function chooseNonDomProjectionFallback(
  snapshot: ReadPageCompactSnapshot,
): ReadPageSelectedDataSource {
  if (shouldPreferCompleteTextRegion(snapshot)) return 'markdown';
  if (snapshot.renderMode === 'markdown' && snapshot.markdown) return 'markdown';
  if (snapshot.selectedDataSource && snapshot.selectedDataSource !== 'dom_region_rows') {
    return snapshot.selectedDataSource;
  }
  if (snapshot.kind && snapshot.kind !== 'dom_region_rows') return snapshot.kind;
  return 'dom_json';
}

function estimateProjectionSourceConfidence(
  source: ReadPageSelectedDataSource,
  snapshot: ReadPageCompactSnapshot,
): number {
  if (source === 'dom_region_rows') return snapshot.visibleRegionRows?.rowExtractionConfidence ?? 0;
  if (source === 'markdown') {
    if (shouldPreferCompleteTextRegion(snapshot)) return 0.8;
    return snapshot.markdown ? 0.6 : 0;
  }
  if (source === 'dom_json') {
    return snapshot.readinessVerdict === 'ready' ? 0.5 : 0;
  }
  return 0;
}

function estimateSnapshotContextChars(snapshot: ReadPageCompactSnapshot): number {
  if (shouldPreferCompleteTextRegion(snapshot)) {
    return (
      snapshot.completeTextRegion?.normalizedLength ?? snapshot.completeTextRegion?.charCount ?? 0
    );
  }
  if (snapshot.markdown) return snapshot.markdown.length;
  if (
    snapshot.visibleRegionRows?.visibleRegionRowsUsed &&
    snapshot.visibleRegionRows.rows.length > 0
  ) {
    return snapshot.visibleRegionRows.rows.reduce((total, row) => {
      return (
        total +
        row.title.length +
        (row.primaryText?.length ?? 0) +
        (row.secondaryText?.length ?? 0) +
        (row.summary?.length ?? 0) +
        (row.metaText?.length ?? 0) +
        (row.interactionText?.length ?? 0)
      );
    }, 0);
  }

  const structuralPayload = {
    summary: snapshot.summary,
    interactiveElements: snapshot.interactiveElements,
    highValueObjects: snapshot.highValueObjects,
    candidateActions: snapshot.candidateActions,
    pageContext: snapshot.pageContext,
    artifactRefs: snapshot.artifactRefs,
  };
  const structuralChars = JSON.stringify(structuralPayload).length;
  if (structuralChars > 2) return structuralChars;

  return snapshot.summary.pageRole.length + (snapshot.summary.primaryRegion?.length ?? 0);
}

function shouldPreferCompleteTextRegion(snapshot: ReadPageCompactSnapshot): boolean {
  const completeText = snapshot.completeTextRegion;
  if (!completeText?.completeTextAvailable) return false;

  const completeTextLength = completeText.normalizedLength || completeText.charCount || 0;
  if (completeTextLength < 500) return false;

  const inlineMarkdownLength = snapshot.markdown?.length ?? 0;
  if (inlineMarkdownLength > 0 && completeTextLength >= inlineMarkdownLength * 2) {
    return true;
  }

  const rowChars =
    snapshot.visibleRegionRows?.rows.reduce((total, row) => {
      return (
        total +
        row.title.length +
        (row.primaryText?.length ?? 0) +
        (row.secondaryText?.length ?? 0) +
        (row.summary?.length ?? 0) +
        (row.metaText?.length ?? 0) +
        (row.interactionText?.length ?? 0)
      );
    }, 0) ?? 0;

  return rowChars > 0 && completeTextLength >= rowChars * 2;
}

function collectVisibleRowTargetRefs(snapshot: ReadPageCompactSnapshot): string[] {
  return (snapshot.visibleRegionRows?.rows ?? [])
    .map((row) => row.targetRef)
    .filter((targetRef): targetRef is string => Boolean(targetRef));
}
