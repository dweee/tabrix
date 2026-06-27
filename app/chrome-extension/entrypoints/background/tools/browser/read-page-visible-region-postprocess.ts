import { extractVisibleRegionRows, type VisibleRegionRowsResult } from './visible-region-rows';

export function reconcilePageUnderstandingWithVisibleRows(payload: Record<string, any>): void {
  const rows = payload.visibleRegionRows as VisibleRegionRowsResult | undefined;
  if (payload.pageRole !== 'login_required' || !rows?.visibleRegionRowsUsed) {
    return;
  }

  payload.pageRole = 'unknown';
  payload.primaryRegion = 'visible_results';
  payload.primaryRegionConfidence = 'medium';
  payload.footerOnly = false;
  payload.visibleRegionRows = {
    ...rows,
    sourceRegion: 'visible_results',
    rows: rows.rows.map((row) => ({
      ...row,
      sourceRegion: 'visible_results',
    })),
  };
}

export function completeVisibleRegionRows(params: {
  rows: VisibleRegionRowsResult;
  pageContent: string;
  visibleTextContent?: string | null;
  primaryRegion: string | null;
  interactiveElements: Array<{ ref: string; role: string; name: string; href?: string }>;
  currentUrl: string;
  currentTitle: string;
  viewport: { width: number | null; height: number | null; dpr: number | null };
}): VisibleRegionRowsResult {
  if (params.rows.visibleRegionRowsUsed) {
    return params.rows;
  }
  return extractVisibleRegionRows({
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    sourceRegion: params.primaryRegion,
    fallbackInteractiveElements: params.interactiveElements,
    url: params.currentUrl,
    title: params.currentTitle,
    viewport: params.viewport,
  });
}

function isContentDetailPageRole(pageRole: unknown): boolean {
  return String(pageRole || '') === 'content_detail';
}

export function suppressVisibleRowsForContentDetail(
  rows: VisibleRegionRowsResult,
  pageRole: unknown,
): VisibleRegionRowsResult {
  if (!isContentDetailPageRole(pageRole) || !rows.visibleRegionRowsUsed) {
    return rows;
  }
  const rejectedRegionReasonDistribution = { ...rows.rejectedRegionReasonDistribution };
  rejectedRegionReasonDistribution.broad_page_shell =
    (rejectedRegionReasonDistribution.broad_page_shell ?? 0) + rows.rows.length;

  return {
    ...rows,
    rows: [],
    rowCount: 0,
    visibleRegionRowsUsed: false,
    visibleRegionRowsRejectedReason: 'broad_page_shell',
    sourceRegion: 'content_detail',
    rowExtractionConfidence: 0,
    cardExtractorUsed: false,
    cardPatternConfidence: 0,
    cardRowsCount: 0,
    targetRefCoverageRate: 0,
    regionQualityScore: 0,
    visibleDomRowsSelectedCount: 0,
    lowValueRegionRejectedCount: rows.lowValueRegionRejectedCount + rows.rows.length,
    rejectedRegionReasonDistribution,
  };
}
