import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildBrowserPageThingProjectionFromReadPage,
  type BrowserPageOwnerType,
  type ReadPageCompactSnapshot,
  type ReadPageRequestedLayer,
} from '@tabrix/shared';
import type { DataSourceDecision, TaskIntentClass } from '../execution/data-source-router';
import type { LayerContractEnvelope } from '../execution/layer-contract';
import type { TaskVisibleRegionRowsData } from '../execution/task-session-context';
import type { ChooseContextDecisionSnapshot } from '../execution/skip-read-orchestrator';

const MIN_RELIABLE_DOM_REGION_ROW_COUNT = 2;
const MIN_RELIABLE_DOM_REGION_ROW_CONFIDENCE = 0.7;
const MIN_RELIABLE_DOM_REGION_TARGET_REF_COVERAGE = 0.95;
const MIN_RELIABLE_DOM_REGION_QUALITY = 0.7;
const DEFAULT_TOP_N_READBACK_TARGET = 10;

type TopNReadbackStatus = 'ready_for_default_top_n' | 'partial_rows_only';

interface TopNReadbackEvidence {
  status: TopNReadbackStatus;
  requestedN: number | null;
  defaultTopN: number;
  availableReliableRowCount: number;
  visibleRowCount: number;
  targetRefRowCount: number;
  rowOrder: 'visual_order';
  canSatisfyDefaultTopN: boolean;
  missingRowCountForDefaultTopN: number;
  nextRequiredCheck:
    | 'rows_ready_for_top_n_summary'
    | 'scroll_or_request_more_rows_before_claiming_top_n_complete';
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
  const usableTopNRowCount = Math.min(availableReliableRowCount, targetRefRowCount);
  const canSatisfyDefaultTopN =
    visibleRows.visibleRegionRowsUsed && usableTopNRowCount >= DEFAULT_TOP_N_READBACK_TARGET;
  const missingRowCountForDefaultTopN = Math.max(
    0,
    DEFAULT_TOP_N_READBACK_TARGET - usableTopNRowCount,
  );

  return {
    status: canSatisfyDefaultTopN ? 'ready_for_default_top_n' : 'partial_rows_only',
    requestedN: null,
    defaultTopN: DEFAULT_TOP_N_READBACK_TARGET,
    availableReliableRowCount,
    visibleRowCount,
    targetRefRowCount,
    rowOrder: visibleRows.rowOrder,
    canSatisfyDefaultTopN,
    missingRowCountForDefaultTopN,
    nextRequiredCheck: canSatisfyDefaultTopN
      ? 'rows_ready_for_top_n_summary'
      : 'scroll_or_request_more_rows_before_claiming_top_n_complete',
    claimBoundary:
      'No explicit requestedN was provided; this proves only the current reliable visible rows, their visual order, and targetRef coverage, not full result-set completeness or ranking correctness.',
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
        topNCanSatisfyDefault: String(topNReadbackEvidence.canSatisfyDefaultTopN),
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
