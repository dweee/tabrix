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

export const BROWSER_TASK_SCENARIO_CLASS_VALUES = [
  'search_result_delta_v1',
  'background_no_focus_v1',
  'active_user_tab_protection_v1',
  'auth_collaboration_resume_v1',
  'article_long_content_read_v1',
  'competitor_same_scenario_v1',
] as const;
export type BrowserTaskScenarioClass = (typeof BROWSER_TASK_SCENARIO_CLASS_VALUES)[number];

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

export interface BrowserPageThingProjection {
  projectionId: string;
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
}

export interface BrowserTaskThingSummary {
  taskId: string;
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
  attribute: keyof BrowserRuntimePolicy;
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
  browserHygiene: BrowserHygieneEvidence;
  dataSourceDecision: BrowserDataSourceDecisionEvidence;
  policyAudit: BrowserPolicyAuditEvent[];
  privacyRedaction: BrowserPrivacyRedactionEvidence;
  claimCoverage: BrowserClaimCoverageEvidence;
}

export interface BuildBrowserPageThingProjectionInput {
  snapshot: ReadPageCompactSnapshot;
  projectionId: string;
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
}

export function buildBrowserPageThingProjectionFromReadPage(
  input: BuildBrowserPageThingProjectionInput,
): BrowserPageThingProjection {
  const { snapshot } = input;
  const visibleRegionRows = snapshot.visibleRegionRows;
  const activeRegion = visibleRegionRows?.sourceRegion ?? snapshot.summary.primaryRegion;
  const contextChars = estimateSnapshotContextChars(snapshot);
  const previousContextChars = input.previousContextChars ?? null;

  return {
    projectionId: input.projectionId,
    pageId: input.pageId,
    tabId: input.tabId,
    ownerType: input.ownerType,
    readiness: snapshot.readinessVerdict ?? 'unknown',
    stability: 'stable',
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
  };
}

function chooseProjectionDataSource(snapshot: ReadPageCompactSnapshot): ReadPageSelectedDataSource {
  if (snapshot.selectedDataSource) return snapshot.selectedDataSource;
  if (snapshot.kind) return snapshot.kind;
  if (snapshot.visibleRegionRows?.visibleRegionRowsUsed) return 'dom_region_rows';
  if (snapshot.renderMode === 'markdown' && snapshot.markdown) return 'markdown';
  return 'dom_json';
}

function estimateSnapshotContextChars(snapshot: ReadPageCompactSnapshot): number {
  if (snapshot.markdown) return snapshot.markdown.length;
  if (snapshot.visibleRegionRows) {
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
  return snapshot.summary.pageRole.length + (snapshot.summary.primaryRegion?.length ?? 0);
}

function collectVisibleRowTargetRefs(snapshot: ReadPageCompactSnapshot): string[] {
  return (snapshot.visibleRegionRows?.rows ?? [])
    .map((row) => row.targetRef)
    .filter((targetRef): targetRef is string => Boolean(targetRef));
}
