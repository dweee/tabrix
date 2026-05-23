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
  'competitor_same_scenario_v1',
] as const;
export type BrowserTaskScenarioClass = (typeof BROWSER_TASK_SCENARIO_CLASS_VALUES)[number];

export const BROWSER_TASK_SCENARIO_PRIORITY_ORDER = [
  'search_result_delta_v1',
  'article_long_content_read_v1',
  'background_no_focus_v1',
  'active_user_tab_protection_v1',
  'auth_collaboration_resume_v1',
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
  'competitor',
] as const;
export type BrowserTaskEvidenceLevel = (typeof BROWSER_TASK_EVIDENCE_LEVEL_VALUES)[number];

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
  const visibleRegionRows = snapshot.visibleRegionRows;
  const activeRegion = inferProjectionActiveRegion(snapshot);
  const contextChars = estimateSnapshotContextChars(snapshot);
  const previousContextChars = input.previousContextChars ?? null;

  return {
    projectionId: input.projectionId,
    projectionKind: 'read_snapshot_projection',
    projectionCreatedAt: input.observedAt,
    sourceObservedAt: input.observedAt,
    sourceLineage: inferSourceLineage(chooseProjectionDataSource(snapshot)),
    regionEvidenceRefs: buildRegionEvidenceRefs(snapshot),
    pageId: input.pageId,
    tabId: input.tabId,
    ownerType: input.ownerType,
    readiness: snapshot.readinessVerdict ?? 'unknown',
    stability: input.stability ?? 'stable',
    contextVersion: input.contextVersion,
    previousContextVersion: input.previousContextVersion ?? null,
    changedByActionId: input.changedByActionId ?? null,
    changeCause: input.changeCause ?? 'unknown',
    activeRegion,
    changedRegions: input.changedRegions ?? (activeRegion ? [activeRegion] : []),
    reusedRegions: input.reusedRegions ?? [],
    invalidatedRefs: input.invalidatedRefs ?? [],
    refreshedRefs: input.refreshedRefs ?? collectVisibleRowTargetRefs(snapshot),
    chosenDataSource: chooseProjectionDataSource(snapshot),
    sourceConfidence: visibleRegionRows?.rowExtractionConfidence ?? 0,
    sourceFreshness: 'fresh',
    contextChars,
    contextSavedChars: Math.max(0, (previousContextChars ?? contextChars) - contextChars),
    userActivityLevel: input.userActivityLevel ?? 'unknown',
    interferenceRisk: input.interferenceRisk ?? 'medium',
    sourceTruthChain: buildSourceTruthChain(
      chooseProjectionDataSource(snapshot),
      snapshot,
      input.observedAt,
    ),
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
  const rows = snapshot.visibleRegionRows;
  const hasRows = (rows?.rows?.length ?? 0) > 0;

  const fieldProvenances: FieldProvenance[] = [
    { field: 'pageProjection.pageId', origin: 'dom', isFact: true },
    { field: 'pageProjection.tabId', origin: 'dom', isFact: true },
    { field: 'pageProjection.readiness', origin: contentOrigin, isFact: true },
    { field: 'pageProjection.stability', origin: 'dom', isFact: true },
    {
      field: 'pageProjection.visibleRegionRows',
      origin: hasRows ? contentOrigin : 'unknown',
      isFact: hasRows,
    },
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

function inferProjectionActiveRegion(snapshot: ReadPageCompactSnapshot): string | null {
  const sourceRegion = snapshot.visibleRegionRows?.sourceRegion ?? snapshot.summary.primaryRegion;
  if (sourceRegion !== 'viewport') return sourceRegion;
  if (!snapshot.visibleRegionRows?.visibleRegionRowsUsed) return sourceRegion;
  if (snapshot.visibleRegionRows.rowCount <= 0) return sourceRegion;
  if (snapshot.visibleRegionRows.rowExtractionConfidence < 0.7) return sourceRegion;
  const role = snapshot.summary.pageRole.toLowerCase();
  if (role.includes('search') || role.includes('list') || role.includes('results')) {
    return 'result_list';
  }
  if (hasStrongVisibleResultRows(snapshot)) return 'result_list';
  return sourceRegion;
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

function chooseProjectionDataSource(snapshot: ReadPageCompactSnapshot): ReadPageSelectedDataSource {
  if (snapshot.selectedDataSource === 'dom_region_rows' && hasReliableVisibleRows(snapshot)) {
    return 'dom_region_rows';
  }
  if (shouldPreferCompleteTextRegion(snapshot)) return 'markdown';
  if (snapshot.selectedDataSource) return snapshot.selectedDataSource;
  if (snapshot.kind) return snapshot.kind;
  if (snapshot.visibleRegionRows?.visibleRegionRowsUsed) return 'dom_region_rows';
  if (snapshot.renderMode === 'markdown' && snapshot.markdown) return 'markdown';
  return 'dom_json';
}

function hasReliableVisibleRows(snapshot: ReadPageCompactSnapshot): boolean {
  const rows = snapshot.visibleRegionRows;
  return Boolean(rows?.visibleRegionRowsUsed && rows.rowCount > 0);
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
