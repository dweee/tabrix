import type {
  ReadPageCompactSnapshot,
  ReadPageExtensionFields,
  ReadPageMode,
  ReadPagePageContext,
  ReadPagePageType,
  ReadPageRenderMode,
  ReadPageRequestedLayer,
  ReadPageCompleteTextRegion,
} from '@tabrix/shared';
import {
  buildTaskProtocol,
  redactSensitiveCandidateActionsForAi,
  redactSensitiveInteractiveElementsForAi,
  type ReadPageVisualElementHint,
} from './read-page-task-protocol';
import type { PageRole } from './read-page-understanding';
import { buildHistoryRef } from './stable-target-ref';
import { buildMarkdownProjection, MARKDOWN_ARTIFACT_KIND } from './read-page-markdown';
import { hasMeaningfulReadPageText } from './read-page-content-summary';
import type { SnapshotInteractiveElement } from './read-page-interactive-elements';
import type { CandidateActionSeed } from './read-page-candidate-actions';
import type { SnapshotArtifactRef } from './read-page-artifact-refs';
import type { VisibleRegionRowsResult } from './visible-region-rows';

export function buildStableSnapshotLayer(params: {
  mode: ReadPageMode;
  currentUrl: string;
  currentTitle: string;
  pageType: ReadPagePageType;
  pageRole: PageRole;
  primaryRegion: string | null;
  quality: string;
  interactiveElements: SnapshotInteractiveElement[];
  artifactRefs: SnapshotArtifactRef[];
}): Omit<ReadPageCompactSnapshot, keyof ReadPageExtensionFields> {
  const aiFacingInteractiveElements = redactSensitiveInteractiveElementsForAi(
    params.interactiveElements,
  );
  return {
    mode: params.mode,
    page: {
      url: params.currentUrl,
      title: params.currentTitle,
      pageType: params.pageType,
    },
    summary: {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      quality: params.quality,
    },
    interactiveElements: aiFacingInteractiveElements,
    artifactRefs: params.artifactRefs,
  };
}

export function buildExtensionLayer(params: {
  mode: ReadPageMode;
  renderMode: ReadPageRenderMode;
  currentUrl: string;
  currentTitle: string;
  tabId: number | null;
  pageStability: 'stable' | 'loading' | 'changing' | 'stale' | 'unknown';
  pageType: ReadPagePageType;
  pageRole: PageRole;
  primaryRegion: string | null;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  artifactRefs: SnapshotArtifactRef[];
  candidateActions: CandidateActionSeed[];
  interactiveElements: SnapshotInteractiveElement[];
  pageContext: ReadPagePageContext;
  visibleRegionRows: VisibleRegionRowsResult;
  visibleTextContent?: string | null;
  visualElements?: ReadPageVisualElementHint[];
  /** When 'L0' or 'L0+L1', strip detail layers below the requested envelope. */
  requestedLayer: ReadPageRequestedLayer;
}): ReadPageExtensionFields {
  const markdownArtifact = params.artifactRefs.find((item) => item.kind === MARKDOWN_ARTIFACT_KIND);
  const aiFacingInteractiveElements = redactSensitiveInteractiveElementsForAi(
    params.interactiveElements,
    params.candidateActions,
  );
  const aiFacingCandidateActions = redactSensitiveCandidateActionsForAi(
    params.candidateActions,
    params.interactiveElements,
  );
  const taskProtocol = buildTaskProtocol({
    mode: params.mode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    tabId: params.tabId ?? null,
    pageStability: params.pageStability ?? 'unknown',
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
    artifactRefs: params.artifactRefs,
    pageContext: params.pageContext,
    contentSummary: params.contentSummary,
    visibleTextContent: params.visibleTextContent,
    visualElements: params.visualElements,
    markdownArtifactRef: markdownArtifact?.ref ?? null,
    visibleRegionRows: params.visibleRegionRows,
  });

  // Populate `historyRef` with a compact snapshot identifier so upstream
  // callers can correlate stable HVO `targetRef`s back to the snapshot they
  // were first seen in. The seed mixes URL host + path, pageRole and a tiny
  // content fingerprint so two reads of the same page yield the same
  // historyRef when content is unchanged but distinct refs after a real
  // navigation. Pure helper, no I/O.
  const historyRef = buildHistoryRef({
    url: params.currentUrl,
    pageRole: params.pageRole,
    contentSeed: `${params.contentSummary.normalizedLength}|${taskProtocol.highValueObjects.length}`,
  });

  // When the caller explicitly requested render='markdown', generate a
  // Markdown projection from the *final* ranked HVO + interactive lists (so
  // it stays consistent with the JSON payload the same response carries).
  // The projection is intentionally ref-free (see read-page-markdown.ts) so
  // it cannot be misused as a click locator. Empty result -> emit `null` to
  // signal "Markdown unavailable" rather than "page is empty".
  let markdown: string | null = null;
  if (params.renderMode === 'markdown') {
    const projected = buildMarkdownProjection({
      url: params.currentUrl,
      title: params.currentTitle,
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      highValueObjects: taskProtocol.highValueObjects,
      interactiveElements: aiFacingInteractiveElements,
    });
    markdown = projected || null;
  }

  // Layer envelope: strip detail layers per `requestedLayer`.
  // Stable HVO `targetRef` registry stays untouched (registered in
  // buildModeOutput) so `chrome_click_element` keeps resolving via the
  // same `tgt_*` even at `'L0'`. Markdown stays available because it
  // is a separate render contract and is intentionally ref-free.
  const includeL1 = params.requestedLayer !== 'L0';
  const includeL2 = params.requestedLayer === 'L0+L1+L2';
  const hasVisibleRows = params.visibleRegionRows.visibleRegionRowsUsed;
  const hasTextSignal = hasMeaningfulReadPageText(params.contentSummary);
  const shellRejectedCount =
    params.visibleRegionRows.footerLikeRejectedCount +
    params.visibleRegionRows.navigationLikeRejectedCount +
    params.visibleRegionRows.lowValueRegionRejectedCount;
  const shellOnlyRows =
    !hasVisibleRows &&
    params.visibleRegionRows.visibleDomRowsCandidateCount === 0 &&
    shellRejectedCount > 0;
  const blockedReadinessReason = hasVisibleRows
    ? null
    : inferBlockedReadinessReason({
        currentUrl: params.currentUrl,
        currentTitle: params.currentTitle,
        visibleTextContent: params.visibleTextContent,
      });
  const loadReadiness = params.pageContext.loadReadiness;
  const unstableReadinessReason =
    !hasVisibleRows && loadReadiness && !loadReadiness.canUseSnapshotForBusinessAction
      ? loadReadiness.pageStability === 'stale'
        ? 'page_stale_not_actionable'
        : 'page_load_not_stable'
      : null;
  const selectedDataSource = hasVisibleRows
    ? 'dom_region_rows'
    : params.renderMode === 'markdown'
      ? 'markdown'
      : 'dom_json';
  const readinessVerdict =
    params.pageType === 'unsupported_page'
      ? 'error'
      : hasVisibleRows
        ? 'ready'
        : unstableReadinessReason
          ? 'blocked'
          : blockedReadinessReason
            ? 'blocked'
            : !hasTextSignal
              ? 'empty'
              : shellOnlyRows
                ? 'blocked'
                : 'ready';
  let readinessReason: string | null = null;
  if (unstableReadinessReason) {
    readinessReason = unstableReadinessReason;
  } else if (blockedReadinessReason) {
    readinessReason = blockedReadinessReason;
  } else if (shellOnlyRows) {
    readinessReason =
      params.visibleRegionRows.footerLikeRejectedCount +
        params.visibleRegionRows.navigationLikeRejectedCount >
      0
        ? 'footer_or_navigation_only'
        : 'business_rows_unavailable';
  }
  const extensionLayer = {
    kind: selectedDataSource,
    selectedDataSource,
    readinessVerdict,
    readinessReason,
    rowCount: hasVisibleRows ? params.visibleRegionRows.rowCount : 0,
    visibleRegionRowsUsed: hasVisibleRows,
    visibleRegionRowsRejectedReason: params.visibleRegionRows.visibleRegionRowsRejectedReason,
    visibleDomRowsCandidateCount: params.visibleRegionRows.visibleDomRowsCandidateCount,
    visibleDomRowsSelectedCount: params.visibleRegionRows.visibleDomRowsSelectedCount,
    lowValueRegionRejectedCount: params.visibleRegionRows.lowValueRegionRejectedCount,
    footerLikeRejectedCount: params.visibleRegionRows.footerLikeRejectedCount,
    navigationLikeRejectedCount: params.visibleRegionRows.navigationLikeRejectedCount,
    targetRefCoverageRejectedCount: params.visibleRegionRows.targetRefCoverageRejectedCount,
    rejectedRegionReasonDistribution: params.visibleRegionRows.rejectedRegionReasonDistribution,
    candidateActions: includeL1 ? aiFacingCandidateActions : [],
    pageContext: params.pageContext,
    // T3.2: reserved extension fields (not locked as long-term schema yet).
    frameContext: null,
    historyRef,
    memoryHints: [],
    taskMode: taskProtocol.taskMode,
    complexityLevel: taskProtocol.complexityLevel,
    sourceKind: taskProtocol.sourceKind,
    watchScope: taskProtocol.watchScope,
    highValueObjects: taskProtocol.highValueObjects,
    pageRegions: taskProtocol.pageRegions,
    pageOperationMap: taskProtocol.pageOperationMap,
    objectLifecycle: taskProtocol.objectLifecycle,
    L0: taskProtocol.L0,
    L1: includeL1 ? taskProtocol.L1 : undefined,
    L2: includeL2 ? taskProtocol.L2 : undefined,
    visibleRegionRows: params.visibleRegionRows,
    completeTextRegion: buildCompleteTextRegion(params.visibleTextContent),
    renderMode: params.renderMode,
    markdown,
  };
  if (hasVisibleRows) {
    Object.assign(extensionLayer, {
      kind: 'dom_region_rows',
      selectedDataSource: 'dom_region_rows',
      rowCount: params.visibleRegionRows.rowCount,
      visibleRegionRowsUsed: true,
      targetRefCoverageRate: params.visibleRegionRows.targetRefCoverageRate,
      regionQualityScore: params.visibleRegionRows.regionQualityScore,
      visibleDomRowsCandidateCount: params.visibleRegionRows.visibleDomRowsCandidateCount,
      visibleDomRowsSelectedCount: params.visibleRegionRows.visibleDomRowsSelectedCount,
      lowValueRegionRejectedCount: params.visibleRegionRows.lowValueRegionRejectedCount,
      footerLikeRejectedCount: params.visibleRegionRows.footerLikeRejectedCount,
      navigationLikeRejectedCount: params.visibleRegionRows.navigationLikeRejectedCount,
      targetRefCoverageRejectedCount: params.visibleRegionRows.targetRefCoverageRejectedCount,
      rejectedRegionReasonDistribution: params.visibleRegionRows.rejectedRegionReasonDistribution,
    });
  }
  return extensionLayer as ReadPageExtensionFields;
}

function inferBlockedReadinessReason(params: {
  currentUrl: string;
  currentTitle: string;
  visibleTextContent?: string | null;
}): 'auth_or_login_required' | 'challenge_or_verification' | null {
  const signal = [params.currentUrl, params.currentTitle, params.visibleTextContent || '']
    .join(' ')
    .toLowerCase();
  if (!signal.trim()) return null;

  if (
    /\b(log[ -]?in|sign[ -]?in|auth|authenticate|unauthorized)\b/.test(signal) ||
    /请先登录|登录后|未登录|账号登录|手机号登录|扫码登录/.test(signal)
  ) {
    return 'auth_or_login_required';
  }

  if (
    /\b(captcha|recaptcha|verification|verify|security check|challenge|robot|unusual traffic|access denied)\b/.test(
      signal,
    ) ||
    /人机验证|验证码|安全验证|访问验证|身份验证|拖动滑块|滑块验证|风控/.test(signal)
  ) {
    return 'challenge_or_verification';
  }

  return null;
}

function buildCompleteTextRegion(
  text: string | null | undefined,
): ReadPageCompleteTextRegion | null {
  if (!text) return null;
  const normalized = text.replace(/\s+/g, ' ').trim();
  const lineCount = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean).length;
  const normalizedLength = normalized.length;
  const contentSparse = normalizedLength < 80;
  const structureSparse = lineCount < 3;
  const completeTextAvailable = normalizedLength >= 500;
  if (!completeTextAvailable) return null;
  return {
    sourceDataSource: 'web_content_text',
    sourceRoute: 'visible_text_sample',
    charCount: text.length,
    normalizedLength,
    lineCount,
    completeTextAvailable,
    structureSparse,
    contentSparse,
    quality: structureSparse ? 'complete_text_sparse_structure' : 'usable',
    recommendation: 'use_chrome_get_web_content_for_full_body',
    reason: structureSparse
      ? 'complete_visible_text_available_but_structurally_sparse'
      : 'complete_visible_text_available',
  };
}
