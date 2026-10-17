import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildBrowserPageThingProjectionFromReadPage,
  type BrowserPageOwnerType,
  type ReadPageCompactSnapshot,
  type ReadPageRequestedLayer,
} from '@tabrix/shared';
import type { DataSourceDecision, TaskIntentClass } from '../execution/data-source-router';
import type { LayerContractEnvelope } from '../execution/layer-contract';
import type {
  TaskDomRegionRowsReadbackAccumulationEvidence,
  TaskTopNCollectionGuidance,
  TaskVisibleRegionRowsData,
} from '../execution/task-session-context';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';

const MIN_RELIABLE_DOM_REGION_ROW_COUNT = 2;
const MIN_RELIABLE_DOM_REGION_ROW_CONFIDENCE = 0.7;
const MIN_RELIABLE_DOM_REGION_TARGET_REF_COVERAGE = 0.95;
const MIN_RELIABLE_DOM_REGION_QUALITY = 0.7;
const DEFAULT_TOP_N_READBACK_TARGET = 10;

type TopNReadbackStatus = 'ready_for_default_top_n' | 'partial_rows_only';
type TopNFieldCoverageStatus =
  | 'structured_summary_fields_ready'
  | 'title_only_fields'
  | 'insufficient_title_fields';

interface TopNReadbackEvidence {
  status: TopNReadbackStatus;
  requestedN: number | null;
  defaultTopN: number;
  availableReliableRowCount: number;
  visibleRowCount: number;
  targetRefRowCount: number;
  summarizableRowCount: number;
  titleRowCount: number;
  supportingTextRowCount: number;
  metadataRowCount: number;
  rowOrder: 'visual_order';
  canSatisfyDefaultTopN: boolean;
  missingRowCountForDefaultTopN: number;
  canSupportDefaultTopNSummary: boolean;
  missingSummarizableRowCountForDefaultTopN: number;
  fieldCoverageStatus: TopNFieldCoverageStatus;
  canSupportDefaultTopNFieldSummary: boolean;
  missingTitleRowCountForDefaultTopN: number;
  summaryQualityNextRequiredCheck:
    | 'structured_top_n_summary_ready'
    | 'collect_supporting_text_or_detail_before_rich_summary'
    | 'collect_more_titled_rows_before_top_n_summary';
  nextRequiredCheck:
    | 'rows_ready_for_top_n_summary'
    | 'scroll_or_request_more_rows_before_claiming_top_n_complete';
  summaryNextRequiredCheck:
    | 'top_n_summary_ready'
    | 'more_rows_or_text_fields_required_before_top_n_summary';
  collectionGuidance: TaskTopNCollectionGuidance;
  claimBoundary: string;
}

export interface ReadPageOperationLogHint {
  requestedLayer?: string | null;
  selectedDataSource?: string | null;
  sourceRoute?: string | null;
  decisionReason?: string | null;
  resultKind?: string | null;
  fallbackUsed?: string | null;
  readCount?: number | null;
  tokensSaved?: number | null;
  success?: boolean;
  tabHygiene?: unknown;
  metadata?: Record<string, string>;
}

export function inferDomRegionRowsTaskIntent(
  decision: ChooseContextDecisionSnapshot | null,
  visibleRows: TaskVisibleRegionRowsData,
): TaskIntentClass | undefined {
  if (decision?.dataSource === 'dom_region_rows' || decision?.chosenSource === 'dom_region_rows') {
    return 'search_list';
  }
  if (decision?.sourceRoute === 'knowledge_supported_read') return 'search_list';
  if (visibleRowsAreReliableListEvidence(visibleRows)) return 'search_list';
  return undefined;
}

export function buildVisibleRowsRejectionReason(visibleRows: TaskVisibleRegionRowsData): string {
  if (visibleRows.rejectedReason) return visibleRows.rejectedReason;
  if (!visibleRows.available || visibleRows.rowCount <= 0) return 'dom_region_rows_unavailable';
  if (visibleRows.rowCount < MIN_RELIABLE_DOM_REGION_ROW_COUNT) {
    return 'dom_region_rows_insufficient_row_count';
  }
  if (visibleRows.confidence < MIN_RELIABLE_DOM_REGION_ROW_CONFIDENCE) {
    return 'dom_region_rows_low_confidence';
  }
  if (
    visibleRows.regionQualityScore !== undefined &&
    visibleRows.regionQualityScore !== null &&
    visibleRows.regionQualityScore < MIN_RELIABLE_DOM_REGION_QUALITY
  ) {
    return 'dom_region_rows_low_region_quality';
  }
  if (
    visibleRows.targetRefCoverageRate !== undefined &&
    visibleRows.targetRefCoverageRate !== null &&
    visibleRows.targetRefCoverageRate < MIN_RELIABLE_DOM_REGION_TARGET_REF_COVERAGE
  ) {
    return 'dom_region_rows_target_ref_coverage_insufficient';
  }
  return 'dom_region_rows_not_selected';
}

function visibleRowsAreReliableListEvidence(visibleRows: TaskVisibleRegionRowsData): boolean {
  if (!visibleRows.visibleRegionRowsUsed) return false;
  if (visibleRows.rowCount < MIN_RELIABLE_DOM_REGION_ROW_COUNT) return false;
  if (visibleRows.confidence < MIN_RELIABLE_DOM_REGION_ROW_CONFIDENCE) return false;
  if (
    visibleRows.regionQualityScore !== undefined &&
    visibleRows.regionQualityScore !== null &&
    visibleRows.regionQualityScore < MIN_RELIABLE_DOM_REGION_QUALITY
  ) {
    return false;
  }
  if (
    visibleRows.targetRefCoverageRate !== undefined &&
    visibleRows.targetRefCoverageRate !== null &&
    visibleRows.targetRefCoverageRate < MIN_RELIABLE_DOM_REGION_TARGET_REF_COVERAGE
  ) {
    return false;
  }
  return true;
}

function inferDomRegionRowsSemanticRegion(
  decision: ChooseContextDecisionSnapshot | DataSourceDecision | null,
  visibleRows: TaskVisibleRegionRowsData,
): string {
  const sourceRegion = visibleRows.sourceRegion || 'viewport';
  if (sourceRegion !== 'viewport') return sourceRegion;

  const taskIntent = inferDomRegionRowsTaskIntent(
    decision as ChooseContextDecisionSnapshot | null,
    visibleRows,
  );
  if (taskIntent === 'search_list') return 'result_list';

  return sourceRegion;
}

function buildTopNReadbackEvidence(visibleRows: TaskVisibleRegionRowsData): TopNReadbackEvidence {
  const visibleRowCount = Math.max(0, Math.floor(visibleRows.rowCount));
  const availableReliableRowCount = Math.min(visibleRows.rows.length, visibleRowCount);
  const targetRefRowCount = visibleRows.rows.filter((row) => Boolean(row.targetRef)).length;
  const reliableRows = visibleRows.rows.slice(0, availableReliableRowCount);
  const summarizableRowCount = reliableRows.filter(isVisibleRegionRowSummarizable).length;
  const titleRowCount = reliableRows.filter(
    (row) => getVisibleRegionRowFieldCoverage(row).hasTitle,
  ).length;
  const supportingTextRowCount = reliableRows.filter(
    (row) => getVisibleRegionRowFieldCoverage(row).hasSupportingText,
  ).length;
  const metadataRowCount = reliableRows.filter(
    (row) => getVisibleRegionRowFieldCoverage(row).hasMetadata,
  ).length;
  const usableTopNRowCount = Math.min(availableReliableRowCount, targetRefRowCount);
  const canSatisfyDefaultTopN =
    visibleRows.visibleRegionRowsUsed && usableTopNRowCount >= DEFAULT_TOP_N_READBACK_TARGET;
  const canSupportDefaultTopNSummary =
    visibleRows.visibleRegionRowsUsed && summarizableRowCount >= DEFAULT_TOP_N_READBACK_TARGET;
  const canSupportDefaultTopNFieldSummary =
    visibleRows.visibleRegionRowsUsed &&
    titleRowCount >= DEFAULT_TOP_N_READBACK_TARGET &&
    supportingTextRowCount + metadataRowCount >= DEFAULT_TOP_N_READBACK_TARGET;
  const missingRowCountForDefaultTopN = Math.max(
    0,
    DEFAULT_TOP_N_READBACK_TARGET - usableTopNRowCount,
  );
  const missingSummarizableRowCountForDefaultTopN = Math.max(
    0,
    DEFAULT_TOP_N_READBACK_TARGET - summarizableRowCount,
  );
  const missingTitleRowCountForDefaultTopN = Math.max(
    0,
    DEFAULT_TOP_N_READBACK_TARGET - titleRowCount,
  );
  const fieldCoverageStatus: TopNFieldCoverageStatus = canSupportDefaultTopNFieldSummary
    ? 'structured_summary_fields_ready'
    : titleRowCount >= DEFAULT_TOP_N_READBACK_TARGET
      ? 'title_only_fields'
      : 'insufficient_title_fields';
  const collectionGuidance = buildTopNReadbackCollectionGuidance({
    canSatisfyDefaultTopN,
    canSupportDefaultTopNFieldSummary,
    missingRowCountForDefaultTopN,
  });

  return {
    status: canSatisfyDefaultTopN ? 'ready_for_default_top_n' : 'partial_rows_only',
    requestedN: null,
    defaultTopN: DEFAULT_TOP_N_READBACK_TARGET,
    availableReliableRowCount,
    visibleRowCount,
    targetRefRowCount,
    summarizableRowCount,
    titleRowCount,
    supportingTextRowCount,
    metadataRowCount,
    rowOrder: visibleRows.rowOrder,
    canSatisfyDefaultTopN,
    missingRowCountForDefaultTopN,
    canSupportDefaultTopNSummary,
    missingSummarizableRowCountForDefaultTopN,
    fieldCoverageStatus,
    canSupportDefaultTopNFieldSummary,
    missingTitleRowCountForDefaultTopN,
    summaryQualityNextRequiredCheck: canSupportDefaultTopNFieldSummary
      ? 'structured_top_n_summary_ready'
      : titleRowCount >= DEFAULT_TOP_N_READBACK_TARGET
        ? 'collect_supporting_text_or_detail_before_rich_summary'
        : 'collect_more_titled_rows_before_top_n_summary',
    nextRequiredCheck: canSatisfyDefaultTopN
      ? 'rows_ready_for_top_n_summary'
      : 'scroll_or_request_more_rows_before_claiming_top_n_complete',
    summaryNextRequiredCheck: canSupportDefaultTopNSummary
      ? 'top_n_summary_ready'
      : 'more_rows_or_text_fields_required_before_top_n_summary',
    collectionGuidance,
    claimBoundary:
      'No explicit requestedN was provided; this proves only the current reliable visible rows, their visual order, targetRef coverage, and privacy-safe title/supporting-field coverage, not full result-set completeness, final summary correctness, or ranking correctness.',
  };
}

function buildTopNReadbackCollectionGuidance(input: {
  canSatisfyDefaultTopN: boolean;
  canSupportDefaultTopNFieldSummary: boolean;
  missingRowCountForDefaultTopN: number;
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
      instruction: `Need ${input.missingRowCountForDefaultTopN} more targetable visible rows before claiming default Top-N coverage. After a scroll or page advance, run a forced fresh same-tab chrome_read_page and require more observed rows.`,
      claimBoundary:
        'Scroll/page-advance success alone is not business success; Top-N progress is proven only by fresh same-tab readback that observes more rows.',
    };
  }

  if (!input.canSupportDefaultTopNFieldSummary) {
    return {
      ...base,
      status: 'needs_structured_fields',
      requiredNextAction: 'collect_structured_fields_or_open_detail',
      forceRefreshRequired: true,
      requiresNewObservedRows: false,
      instruction:
        'Rows are enough for count, but structured field evidence or detail readback is still required before a structured Top-N summary.',
      claimBoundary:
        'A targetable row count does not prove summary quality; structured field evidence or detail readback is still required.',
    };
  }

  return {
    ...base,
    status: 'ready',
    requiredNextAction: 'summarize_current_top_n',
    forceRefreshRequired: false,
    requiresNewObservedRows: false,
    instruction:
      'Default Top-N summary is supported by the current same-tab visible row readback evidence.',
    claimBoundary:
      'This supports default Top-N summary for observed visible rows only; it still does not prove full platform ranking or unseen results.',
  };
}

function isVisibleRegionRowSummarizable(row: TaskVisibleRegionRowsData['rows'][number]): boolean {
  if (typeof row.targetRef !== 'string' || row.targetRef.trim().length === 0) return false;
  return [row.title, row.primaryText, row.summary, row.secondaryText, row.metaText].some(
    (value) => typeof value === 'string' && value.trim().length > 0,
  );
}

function getVisibleRegionRowFieldCoverage(row: TaskVisibleRegionRowsData['rows'][number]): {
  hasTitle: boolean;
  hasSupportingText: boolean;
  hasMetadata: boolean;
} {
  return {
    hasTitle: typeof row.title === 'string' && row.title.trim().length > 0,
    hasSupportingText: [row.primaryText, row.summary, row.secondaryText].some(
      (value) => typeof value === 'string' && value.trim().length > 0,
    ),
    hasMetadata: typeof row.metaText === 'string' && row.metaText.trim().length > 0,
  };
}

export function buildDomRegionRowsSuccessResult(args: {
  requestedLayer: ReadPageRequestedLayer;
  routerDecision: DataSourceDecision;
  layerContract: LayerContractEnvelope;
  visibleRows: TaskVisibleRegionRowsData;
  ownerType: BrowserPageOwnerType;
  apiRowsUnavailableReason: string;
  readCount: number;
  topNAccumulationEvidence?: TaskDomRegionRowsReadbackAccumulationEvidence | null;
}): { result: CallToolResult; operationLog: ReadPageOperationLogHint } {
  const topNReadbackEvidence = buildTopNReadbackEvidence(args.visibleRows);
  const payload: Record<string, unknown> = {
    kind: 'dom_region_rows',
    readPageAvoided: false,
    sourceDataSource: 'dom_region_rows',
    sourceKind: 'dom_region_rows',
    sourceRoute: args.routerDecision.sourceRoute,
    chosenSource: 'dom_region_rows',
    dataSource: 'dom_region_rows',
    selectedDataSource: 'dom_region_rows',
    decisionReason: args.routerDecision.decisionReason,
    dispatcherInputSource: args.routerDecision.dispatcherInputSource,
    layerContract: args.layerContract,
    chosenLayer: args.routerDecision.selectedLayer,
    rows: args.visibleRows.rows,
    rowCount: args.visibleRows.rowCount,
    visibleRegionRowsUsed: true,
    visibleRegionRowCount: args.visibleRows.rowCount,
    targetRefCoverageRate: args.visibleRows.targetRefCoverageRate ?? null,
    sourceRegion: args.visibleRows.sourceRegion,
    rowExtractionConfidence: args.visibleRows.rowExtractionConfidence,
    cardExtractorUsed: args.visibleRows.cardExtractorUsed,
    cardPatternConfidence: args.visibleRows.cardPatternConfidence,
    cardRowsCount: args.visibleRows.cardRowsCount,
    rowOrder: args.visibleRows.rowOrder,
    regionQualityScore: args.visibleRows.regionQualityScore ?? null,
    visibleDomRowsCandidateCount: args.visibleRows.visibleDomRowsCandidateCount ?? null,
    visibleDomRowsSelectedCount: args.visibleRows.visibleDomRowsSelectedCount ?? null,
    lowValueRegionRejectedCount: args.visibleRows.lowValueRegionRejectedCount ?? null,
    footerLikeRejectedCount: args.visibleRows.footerLikeRejectedCount ?? null,
    navigationLikeRejectedCount: args.visibleRows.navigationLikeRejectedCount ?? null,
    targetRefCoverageRejectedCount: args.visibleRows.targetRefCoverageRejectedCount ?? null,
    rejectedRegionReasonDistribution: args.visibleRows.rejectedRegionReasonDistribution ?? null,
    apiRowsUnavailableReason: args.apiRowsUnavailableReason,
    fallbackCause: null,
    fallbackUsed: 'none',
    topNReadbackEvidence,
    topNAccumulationEvidence: args.topNAccumulationEvidence ?? null,
  };
  payload.pageProjection = buildDomRegionRowsPageProjection(payload, args);

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
    },
    operationLog: {
      requestedLayer: args.requestedLayer,
      selectedDataSource: 'dom_region_rows',
      sourceRoute: args.routerDecision.sourceRoute,
      decisionReason: args.routerDecision.decisionReason,
      resultKind: 'dom_region_rows',
      fallbackUsed: 'none',
      readCount: args.readCount,
      tokensSaved: 0,
      success: true,
      metadata: {
        visibleRegionRowsUsed: 'true',
        visibleRegionRowCount: String(args.visibleRows.rowCount),
        visibleRegionRowsRejectedReason: 'not_applicable',
        apiRowsUnavailableReason: args.apiRowsUnavailableReason,
        dataSourceDecisionReason: args.routerDecision.decisionReason,
        targetRefCoverageRate: String(args.visibleRows.targetRefCoverageRate ?? 'unknown'),
        regionQualityScore: String(args.visibleRows.regionQualityScore ?? 'unknown'),
        topNReadbackStatus: topNReadbackEvidence.status,
        topNDefaultN: String(topNReadbackEvidence.defaultTopN),
        topNAvailableReliableRowCount: String(topNReadbackEvidence.availableReliableRowCount),
        topNTargetRefRowCount: String(topNReadbackEvidence.targetRefRowCount),
        topNSummarizableRowCount: String(topNReadbackEvidence.summarizableRowCount),
        topNTitleRowCount: String(topNReadbackEvidence.titleRowCount),
        topNSupportingTextRowCount: String(topNReadbackEvidence.supportingTextRowCount),
        topNMetadataRowCount: String(topNReadbackEvidence.metadataRowCount),
        topNCanSatisfyDefault: String(topNReadbackEvidence.canSatisfyDefaultTopN),
        topNSummaryReady: String(topNReadbackEvidence.canSupportDefaultTopNSummary),
        topNFieldCoverageStatus: topNReadbackEvidence.fieldCoverageStatus,
        topNFieldSummaryReady: String(topNReadbackEvidence.canSupportDefaultTopNFieldSummary),
        topNMissingTitleRowsForDefault: String(
          topNReadbackEvidence.missingTitleRowCountForDefaultTopN,
        ),
        topNSummaryQualityNextRequiredCheck: topNReadbackEvidence.summaryQualityNextRequiredCheck,
        topNCollectionGuidanceStatus: topNReadbackEvidence.collectionGuidance.status,
        topNCollectionRequiredNextAction:
          topNReadbackEvidence.collectionGuidance.requiredNextAction,
        topNMissingSummarizableRowsForDefault: String(
          topNReadbackEvidence.missingSummarizableRowCountForDefaultTopN,
        ),
        topNAccumulationStatus: args.topNAccumulationEvidence?.status ?? 'not_available',
        topNAccumulatedUniqueTargetableRowCount: String(
          args.topNAccumulationEvidence?.uniqueTargetableRowCount ?? 'unknown',
        ),
        topNAccumulatedUniqueSummarizableRowCount: String(
          args.topNAccumulationEvidence?.uniqueSummarizableRowCount ?? 'unknown',
        ),
        topNAccumulatedObservedReadCount: String(
          args.topNAccumulationEvidence?.observedReadCount ?? 'unknown',
        ),
        topNAccumulationCanSatisfyDefault: String(
          args.topNAccumulationEvidence?.canSatisfyDefaultTopN ?? false,
        ),
        topNAccumulationSummaryReady: String(
          args.topNAccumulationEvidence?.canSupportDefaultTopNSummary ?? false,
        ),
        topNAccumulationFieldCoverageStatus:
          args.topNAccumulationEvidence?.fieldCoverageStatus ?? 'not_available',
        topNAccumulationFieldSummaryReady: String(
          args.topNAccumulationEvidence?.canSupportDefaultTopNFieldSummary ?? false,
        ),
        topNAccumulationGuidanceStatus:
          args.topNAccumulationEvidence?.collectionGuidance.status ?? 'not_available',
        topNAccumulationRequiredNextAction:
          args.topNAccumulationEvidence?.collectionGuidance.requiredNextAction ?? 'not_available',
        rejectedRegionReasonDistribution: JSON.stringify(
          args.visibleRows.rejectedRegionReasonDistribution ?? {},
        ),
      },
    },
  };
}

function buildDomRegionRowsPageProjection(
  payload: Record<string, unknown>,
  args: {
    requestedLayer: ReadPageRequestedLayer;
    routerDecision: DataSourceDecision;
    visibleRows: TaskVisibleRegionRowsData;
    ownerType: BrowserPageOwnerType;
  },
) {
  const observedAt = new Date().toISOString();
  const taskIntent = inferDomRegionRowsTaskIntent(
    args.routerDecision as unknown as ChooseContextDecisionSnapshot,
    args.visibleRows,
  );
  const semanticRegion = inferDomRegionRowsSemanticRegion(args.routerDecision, args.visibleRows);
  const snapshot = {
    ...payload,
    kind: 'dom_region_rows',
    selectedDataSource: 'dom_region_rows',
    readinessVerdict: 'ready',
    summary: {
      pageRole: taskIntent ?? 'search_list',
      primaryRegion: semanticRegion,
      primaryRegionConfidence: args.visibleRows.rowExtractionConfidence,
      footerOnly: false,
      anchorTexts: [],
    },
    visibleRegionRows: {
      sourceDataSource: 'dom_region_rows',
      rows: args.visibleRows.rows,
      rowCount: args.visibleRows.rowCount,
      visibleRegionRowsUsed: true,
      sourceRegion: semanticRegion,
      rowExtractionConfidence: args.visibleRows.rowExtractionConfidence,
      cardExtractorUsed: args.visibleRows.cardExtractorUsed,
      cardPatternConfidence: args.visibleRows.cardPatternConfidence,
      cardRowsCount: args.visibleRows.cardRowsCount,
      rowOrder: args.visibleRows.rowOrder,
      targetRefCoverageRate: args.visibleRows.targetRefCoverageRate ?? null,
      regionQualityScore: args.visibleRows.regionQualityScore ?? null,
    },
  } as unknown as ReadPageCompactSnapshot;

  return buildBrowserPageThingProjectionFromReadPage({
    snapshot,
    projectionId: `dom_region_rows:${observedAt}`,
    observedAt,
    pageId:
      typeof args.visibleRows.sourceTabId === 'number' && args.visibleRows.sourceTabId > 0
        ? `tab:${args.visibleRows.sourceTabId}`
        : 'unknown',
    tabId:
      typeof args.visibleRows.sourceTabId === 'number' && args.visibleRows.sourceTabId > 0
        ? args.visibleRows.sourceTabId
        : -1,
    ownerType: args.ownerType,
    contextVersion: `dom_region_rows:${observedAt}`,
    previousContextVersion: null,
    changedByActionId: null,
    changeCause: 'unknown',
    changedRegions: [semanticRegion],
    reusedRegions: [],
    invalidatedRefs: [],
    refreshedRefs: args.visibleRows.rows
      .map((row) => row.targetRef)
      .filter((targetRef): targetRef is string => Boolean(targetRef)),
    userActivityLevel: 'unknown',
    interferenceRisk: 'medium',
  });
}

export function buildDomRegionRowsRejectedLogHint(args: {
  existing: ReadPageOperationLogHint | null;
  visibleRows: TaskVisibleRegionRowsData;
  rejectedReason: string;
  apiRowsUnavailableReason: string;
  routerDecision: DataSourceDecision;
}): ReadPageOperationLogHint {
  return {
    ...(args.existing ?? {}),
    decisionReason: args.existing?.decisionReason ?? args.rejectedReason,
    metadata: {
      ...(args.existing?.metadata ?? {}),
      visibleRegionRowsUsed: 'false',
      visibleRegionRowCount: String(args.visibleRows.rowCount),
      visibleRegionRowsRejectedReason: args.rejectedReason,
      apiRowsUnavailableReason: args.apiRowsUnavailableReason,
      dataSourceDecisionReason: args.routerDecision.decisionReason,
      targetRefCoverageRate: String(args.visibleRows.targetRefCoverageRate ?? 'unknown'),
      regionQualityScore: String(args.visibleRows.regionQualityScore ?? 'unknown'),
      rejectedRegionReasonDistribution: JSON.stringify(
        args.visibleRows.rejectedRegionReasonDistribution ?? {},
      ),
    },
  };
}
