import type {
  ReadPageCompactSnapshot,
  ReadPageComplexityLevel,
  ReadPageMode,
  ReadPageTaskMode,
} from '@tabrix/shared';

export const STRUCTURED_READ_GATE_VERDICTS = [
  'complete',
  'summary_only',
  'structure_sparse',
  'coverage_insufficient',
  'mode_insufficient',
  'not_applicable',
  'unknown',
] as const;

export type StructuredReadGateVerdict = (typeof STRUCTURED_READ_GATE_VERDICTS)[number];

export type StructuredReadEvidenceBasis =
  | 'summary'
  | 'taskMode'
  | 'complexityLevel'
  | 'completeTextRegion'
  | 'visibleRegionRows'
  | 'diagnosticsContentSummary'
  | 'fullSnapshotContentSummary';

export interface StructuredReadGateOptions {
  minCompleteBodyCharCount: number;
  minCompleteLineCount: number;
  minCompleteCoverageRatio: number;
  minCompleteSectionCount: number;
  summaryOnlyBodyCharCount: number;
  lowBodyCharCount: number;
  minSubstantialBodyCharCount: number;
  compactShallowBodyCharCount: number;
}

export interface StructuredReadGateMetrics {
  sectionCount: number;
  bodyCharCount: number;
  lineCount: number;
  coverageRatio: number;
  readMode: ReadPageMode;
  taskMode: ReadPageTaskMode | null;
  complexityLevel: ReadPageComplexityLevel | null;
  pageRole: string | null;
  primaryRegion: string | null;
  completeTextAvailable: boolean | null;
  structureSparse: boolean | null;
  contentSparse: boolean | null;
}

export interface StructuredReadGateResult {
  gateId: string;
  verdict: StructuredReadGateVerdict;
  gapDescription: string | null;
  recommendedAction: string | null;
  metrics: StructuredReadGateMetrics;
  evidenceBasis: StructuredReadEvidenceBasis[];
  boundary: {
    metadataOnly: true;
    rawContentInspected: false;
    browserIoPerformed: false;
    llmUsed: false;
    publicContractChanged: false;
    realBrowserProven: false;
    commercialGradeProven: false;
  };
  producedAtMs: number;
}

export interface EvaluateStructuredReadGateInput {
  snapshot: ReadPageCompactSnapshot;
  readMode: ReadPageMode;
  nowMs: number;
  gateId?: string;
  options?: Partial<StructuredReadGateOptions>;
}

const DEFAULT_OPTIONS: StructuredReadGateOptions = {
  minCompleteBodyCharCount: 2400,
  minCompleteLineCount: 18,
  minCompleteCoverageRatio: 0.65,
  minCompleteSectionCount: 6,
  summaryOnlyBodyCharCount: 900,
  lowBodyCharCount: 900,
  minSubstantialBodyCharCount: 1800,
  compactShallowBodyCharCount: 1600,
};

const LONG_CONTENT_ROLE_TERMS = [
  'article',
  'documentation',
  'doc',
  'docs',
  'blog',
  'post',
  'content',
  'transcript',
  'conversation',
] as const;

const NON_BODY_REGION_TERMS = ['navigation', 'nav', 'footer', 'sidebar', 'menu', 'header'] as const;

export function getDefaultStructuredReadGateOptions(): StructuredReadGateOptions {
  return { ...DEFAULT_OPTIONS };
}

export function evaluateStructuredReadGate(
  input: EvaluateStructuredReadGateInput,
): StructuredReadGateResult {
  const options = { ...DEFAULT_OPTIONS, ...input.options };
  const metrics = collectMetrics(input.snapshot, input.readMode);
  const evidenceBasis = collectEvidenceBasis(input.snapshot);
  const longContentCandidate = isLongContentCandidate(metrics, options);

  if (!hasUsableSummary(input.snapshot)) {
    return buildResult(input, metrics, evidenceBasis, 'unknown');
  }

  if (!longContentCandidate) {
    return buildResult(input, metrics, evidenceBasis, 'not_applicable');
  }

  if (isCompactAndShallow(metrics, options)) {
    return buildResult(input, metrics, evidenceBasis, 'mode_insufficient');
  }

  if (isSummaryOnly(metrics, options)) {
    return buildResult(input, metrics, evidenceBasis, 'summary_only');
  }

  if (isCoverageInsufficient(metrics, options)) {
    return buildResult(input, metrics, evidenceBasis, 'coverage_insufficient');
  }

  if (
    metrics.structureSparse === true &&
    metrics.bodyCharCount >= options.minSubstantialBodyCharCount
  ) {
    return buildResult(input, metrics, evidenceBasis, 'structure_sparse');
  }

  if (hasInsufficientStructureForCompletion(metrics, options)) {
    return buildResult(input, metrics, evidenceBasis, 'structure_sparse');
  }

  if (isComplete(metrics, options)) {
    return buildResult(input, metrics, evidenceBasis, 'complete');
  }

  return buildResult(input, metrics, evidenceBasis, 'unknown');
}

function collectMetrics(
  snapshot: ReadPageCompactSnapshot,
  readMode: ReadPageMode,
): StructuredReadGateMetrics {
  const completeTextRegion = snapshot.completeTextRegion ?? null;
  const contentSummary = getContentSummary(snapshot);
  const bodyCharCount = firstFiniteNumber(
    completeTextRegion?.charCount,
    contentSummary?.charCount,
    0,
  );
  const lineCount = firstFiniteNumber(completeTextRegion?.lineCount, contentSummary?.lineCount, 0);
  const rowCount = snapshot.visibleRegionRows?.rowCount ?? 0;
  const sectionCount = estimateSectionCount({
    lineCount,
    rowCount,
    completeTextAvailable: completeTextRegion?.completeTextAvailable ?? null,
  });

  return {
    sectionCount,
    bodyCharCount,
    lineCount,
    coverageRatio: estimateCoverageRatio(snapshot),
    readMode,
    taskMode: snapshot.taskMode ?? null,
    complexityLevel: snapshot.complexityLevel ?? null,
    pageRole: snapshot.summary?.pageRole ?? null,
    primaryRegion: snapshot.summary?.primaryRegion ?? null,
    completeTextAvailable: completeTextRegion?.completeTextAvailable ?? null,
    structureSparse: completeTextRegion?.structureSparse ?? null,
    contentSparse: completeTextRegion?.contentSparse ?? null,
  };
}

function getContentSummary(
  snapshot: ReadPageCompactSnapshot,
): { charCount: number; normalizedLength: number; lineCount: number } | null {
  const normalSnapshot = snapshot as ReadPageCompactSnapshot & {
    diagnostics?: {
      contentSummary?: { charCount: number; normalizedLength: number; lineCount: number };
    };
    fullSnapshot?: {
      contentSummary?: { charCount: number; normalizedLength: number; lineCount: number };
    };
  };

  return (
    normalSnapshot.diagnostics?.contentSummary ??
    normalSnapshot.fullSnapshot?.contentSummary ??
    null
  );
}

function collectEvidenceBasis(snapshot: ReadPageCompactSnapshot): StructuredReadEvidenceBasis[] {
  const basis: StructuredReadEvidenceBasis[] = [];
  if (snapshot.summary) basis.push('summary');
  if (snapshot.taskMode) basis.push('taskMode');
  if (snapshot.complexityLevel) basis.push('complexityLevel');
  if (snapshot.completeTextRegion) basis.push('completeTextRegion');
  if (snapshot.visibleRegionRows) basis.push('visibleRegionRows');

  const hasDiagnosticsContentSummary = Boolean(
    (snapshot as ReadPageCompactSnapshot & { diagnostics?: unknown }).diagnostics,
  );
  const hasFullSnapshotContentSummary = Boolean(
    (snapshot as ReadPageCompactSnapshot & { fullSnapshot?: unknown }).fullSnapshot,
  );
  if (hasDiagnosticsContentSummary) basis.push('diagnosticsContentSummary');
  if (hasFullSnapshotContentSummary) basis.push('fullSnapshotContentSummary');
  return basis;
}

function hasUsableSummary(snapshot: ReadPageCompactSnapshot): boolean {
  return Boolean(snapshot.summary?.pageRole && snapshot.summary.quality);
}

function isLongContentCandidate(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  if (metrics.taskMode === 'read') return true;
  if (matchesGenericRole(metrics.pageRole, LONG_CONTENT_ROLE_TERMS)) return true;
  return (
    metrics.complexityLevel === 'complex' &&
    metrics.bodyCharCount >= options.minSubstantialBodyCharCount
  );
}

function isCompactAndShallow(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  return (
    metrics.readMode === 'compact' && metrics.bodyCharCount < options.compactShallowBodyCharCount
  );
}

function isSummaryOnly(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  return metrics.contentSparse === true || metrics.bodyCharCount < options.summaryOnlyBodyCharCount;
}

function isCoverageInsufficient(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  return (
    metrics.bodyCharCount < options.lowBodyCharCount ||
    metrics.coverageRatio < options.minCompleteCoverageRatio ||
    matchesGenericRole(metrics.primaryRegion, NON_BODY_REGION_TERMS)
  );
}

function isComplete(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  return (
    metrics.readMode !== 'compact' &&
    metrics.completeTextAvailable === true &&
    metrics.contentSparse !== true &&
    metrics.structureSparse !== true &&
    metrics.bodyCharCount >= options.minCompleteBodyCharCount &&
    metrics.lineCount >= options.minCompleteLineCount &&
    metrics.sectionCount >= options.minCompleteSectionCount &&
    metrics.coverageRatio >= options.minCompleteCoverageRatio
  );
}

function hasInsufficientStructureForCompletion(
  metrics: StructuredReadGateMetrics,
  options: StructuredReadGateOptions,
): boolean {
  return (
    metrics.completeTextAvailable === true &&
    metrics.contentSparse !== true &&
    metrics.structureSparse !== true &&
    metrics.bodyCharCount >= options.minCompleteBodyCharCount &&
    metrics.lineCount >= options.minCompleteLineCount &&
    metrics.coverageRatio >= options.minCompleteCoverageRatio &&
    metrics.sectionCount < options.minCompleteSectionCount
  );
}

function estimateCoverageRatio(snapshot: ReadPageCompactSnapshot): number {
  const candidates = [
    snapshot.visibleRegionRows?.targetRefCoverageRate,
    snapshot.targetRefCoverageRate,
    snapshot.visibleRegionRows?.regionQualityScore,
    snapshot.regionQualityScore,
    snapshot.completeTextRegion?.completeTextAvailable === true ? 1 : undefined,
  ].filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (candidates.length === 0) return 0;
  return clamp(Math.max(...candidates), 0, 1);
}

function estimateSectionCount(input: {
  lineCount: number;
  rowCount: number;
  completeTextAvailable: boolean | null;
}): number {
  const lineSections = Math.floor(input.lineCount / 6);
  const rowSections = input.rowCount;
  const completeTextBonus = input.completeTextAvailable === true ? 1 : 0;
  return Math.max(lineSections, rowSections, completeTextBonus);
}

function matchesGenericRole(value: string | null, terms: readonly string[]): boolean {
  if (!value) return false;
  const tokens = value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
  return terms.some((term) => tokens.includes(term));
}

function firstFiniteNumber(...values: Array<number | undefined | null>): number {
  return (
    values.find((value): value is number => typeof value === 'number' && Number.isFinite(value)) ??
    0
  );
}

function buildResult(
  input: EvaluateStructuredReadGateInput,
  metrics: StructuredReadGateMetrics,
  evidenceBasis: StructuredReadEvidenceBasis[],
  verdict: StructuredReadGateVerdict,
): StructuredReadGateResult {
  return {
    gateId: input.gateId ?? `structured-read-gate-${input.nowMs}`,
    verdict,
    gapDescription: gapDescriptionFor(verdict),
    recommendedAction: recommendedActionFor(verdict),
    metrics,
    evidenceBasis,
    boundary: {
      metadataOnly: true,
      rawContentInspected: false,
      browserIoPerformed: false,
      llmUsed: false,
      publicContractChanged: false,
      realBrowserProven: false,
      commercialGradeProven: false,
    },
    producedAtMs: input.nowMs,
  };
}

function gapDescriptionFor(verdict: StructuredReadGateVerdict): string | null {
  switch (verdict) {
    case 'complete':
    case 'not_applicable':
      return null;
    case 'summary_only':
      return 'body content appears absent or sparse for a long-content read';
    case 'structure_sparse':
      return 'content exists but lacks enough structure for complete-read proof';
    case 'coverage_insufficient':
      return 'captured metadata does not prove enough content-region coverage';
    case 'mode_insufficient':
      return 'current read mode is too shallow for a long-content candidate';
    case 'unknown':
      return 'insufficient metadata to prove structured read completeness';
  }
}

function recommendedActionFor(verdict: StructuredReadGateVerdict): string | null {
  switch (verdict) {
    case 'complete':
    case 'not_applicable':
      return null;
    case 'summary_only':
      return 'request full or normal mode and verify body coverage before summarizing';
    case 'structure_sparse':
      return 'request a more structured read or scroll-and-reread before summarizing';
    case 'coverage_insufficient':
      return 'expand content-region coverage before treating the read as complete';
    case 'mode_insufficient':
      return 'request normal or full mode for long-content reading';
    case 'unknown':
      return 'collect stronger read_page metadata before making a completion claim';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
