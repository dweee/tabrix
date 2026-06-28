import type {
  BrowserDataSourceDecisionEvidence,
  BrowserPageThingProjection,
  BrowserSourceLineage,
  BrowserSourceTruthChain,
  ReadPageSelectedDataSource,
  SourceTruthOrigin,
} from '@tabrix/shared';
import type { SourceRouteHonestyResult } from '../runtime/source-route-honesty';
import {
  clampUnitInterval,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
} from './register-tool-value-readers';

export function normalizeAiFacingProjectionDataSource(
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
  payload: Record<string, unknown>,
): BrowserPageThingProjection {
  if (
    selectedDataSource !== 'dom_region_rows' ||
    projection.chosenDataSource === 'dom_region_rows' ||
    !hasVisibleRowsEvidence(payload)
  ) {
    return projection;
  }

  return {
    ...projection,
    chosenDataSource: 'dom_region_rows',
    sourceLineage: 'dom',
    sourceConfidence: readNumber(payload.rowExtractionConfidence) ?? projection.sourceConfidence,
  };
}

export function ensureProjectionSourceTruthChain(
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
): BrowserPageThingProjection {
  if (isBrowserSourceTruthChainLike(projection.sourceTruthChain)) return projection;
  const primaryOrigin = inferSourceTruthOrigin(projection.sourceLineage, selectedDataSource);
  const provenanceCreatedAt =
    typeof projection.sourceObservedAt === 'string' && projection.sourceObservedAt.length > 0
      ? projection.sourceObservedAt
      : new Date().toISOString();
  return {
    ...projection,
    sourceTruthChain: {
      primaryOrigin,
      provenanceCreatedAt,
      fieldProvenances: [
        { field: 'pageProjection.projectionId', origin: 'browser_runtime', isFact: true },
        { field: 'pageProjection.chosenDataSource', origin: primaryOrigin, isFact: true },
        { field: 'pageProjection.sourceLineage', origin: primaryOrigin, isFact: true },
        { field: 'sourceRouteHonestyBoundary', origin: 'inference', isFact: false },
      ],
    },
  };
}

export function buildAiFacingDataSourceDecision(args: {
  payload: Record<string, unknown>;
  projection: BrowserPageThingProjection;
  selectedDataSource: ReadPageSelectedDataSource;
  selectedReason: string | null;
  fallbackReason: string | null;
}): BrowserDataSourceDecisionEvidence {
  const availableSources = inferAvailableDataSources(args.payload, args.selectedDataSource);
  const rejectedSources = inferRejectedDataSources(args.payload, args.selectedDataSource);
  const metadataCompleteness = inferMetadataCompleteness(args.payload, args.projection);
  const regionCorrelation =
    args.projection.regionEvidenceRefs.length > 0 || args.projection.changedRegions.length > 0
      ? 1
      : null;

  return {
    availableSources,
    selectedSource: args.selectedDataSource,
    selectedReason: args.selectedReason ?? 'not_reported',
    rejectedSources,
    regionCorrelation,
    taskRelevance: null,
    privacySafety: 'redacted',
    metadataCompleteness,
    sourceFreshness: args.projection.sourceFreshness,
    sourceConfidence: args.projection.sourceConfidence,
    fallbackReason: args.fallbackReason,
  };
}

export function buildAiFacingSourceRouteHonesty(
  result: SourceRouteHonestyResult,
): Record<string, unknown> {
  const proofGateRequired = isApiCdpProofVerdict(result.verdict);
  return {
    verdict: proofGateRequired ? 'unknown' : result.verdict,
    selectedDataSource: result.selectedDataSource,
    reason: proofGateRequired ? 'api_cdp_reuse_requires_r5_gate' : result.reason,
    fallbackUsed: result.fallbackUsed,
    sourceOrigins: result.sourceOrigins,
    factOrigins: result.factOrigins,
    hasFactEvidence: result.hasFactEvidence,
    proofGate: proofGateRequired ? 'r5_required' : null,
    sourceRouteCandidate: proofGateRequired
      ? result.verdict === 'api_proven'
        ? 'api_source_with_fact_evidence'
        : 'cdp_source_with_fact_evidence'
      : null,
    apiCdpReuseProven: false,
  };
}

export function buildAiFacingApiCdpProofBoundary(
  result: SourceRouteHonestyResult,
): Record<string, unknown> {
  if (result.verdict === 'api_proven' || result.verdict === 'cdp_proven') {
    return {
      proofStatus: 'requires_r5_gate',
      apiCdpReuseProven: false,
      selectedDataSource: result.selectedDataSource,
      sourceRouteCandidate:
        result.verdict === 'api_proven'
          ? 'api_source_with_fact_evidence'
          : 'cdp_source_with_fact_evidence',
      reason: 'api_cdp_reuse_requires_r5_gate',
      safeClaim:
        'API/CDP-like source evidence is present, but API/CDP reuse is not proven until the R5 proof gate passes.',
      notSafeClaim:
        'Do not claim API proven, CDP proven, API reuse, CDP reuse, or product delivery grade.',
    };
  }

  if (result.verdict === 'dom_fallback') {
    return {
      proofStatus: 'not_proven_dom_fallback',
      apiCdpReuseProven: false,
      selectedDataSource: result.selectedDataSource,
      sourceRouteCandidate: null,
      reason: result.reason,
      safeClaim: 'This read used a DOM/text fallback route only.',
      notSafeClaim: 'DOM fallback success must not be claimed as API/CDP reuse proof.',
    };
  }

  return {
    proofStatus: result.verdict === 'blocked' ? 'blocked' : 'not_proven',
    apiCdpReuseProven: false,
    selectedDataSource: result.selectedDataSource,
    sourceRouteCandidate: null,
    reason: result.reason,
    safeClaim: 'API/CDP reuse proof is not available from this read.',
    notSafeClaim:
      'Do not claim API proven, CDP proven, API reuse, CDP reuse, or product delivery grade.',
  };
}

export function toTaskSourceRouteHonestySnapshot(result: SourceRouteHonestyResult): {
  verdict: string;
  selectedDataSource: string | null;
  reason: string;
  fallbackUsed: boolean;
  hasFactEvidence: boolean;
} {
  const proofGateRequired = isApiCdpProofVerdict(result.verdict);
  return {
    verdict: proofGateRequired ? 'unknown' : result.verdict,
    selectedDataSource: result.selectedDataSource,
    reason: proofGateRequired ? 'api_cdp_reuse_requires_r5_gate' : result.reason,
    fallbackUsed: result.fallbackUsed,
    hasFactEvidence: result.hasFactEvidence,
  };
}

function isApiCdpProofVerdict(verdict: SourceRouteHonestyResult['verdict']): boolean {
  return verdict === 'api_proven' || verdict === 'cdp_proven';
}

function inferAvailableDataSources(
  payload: Record<string, unknown>,
  selectedDataSource: ReadPageSelectedDataSource,
): ReadPageSelectedDataSource[] {
  const sources = new Set<ReadPageSelectedDataSource>([selectedDataSource]);
  if (readPositiveInteger(payload, 'rowCount') !== null) sources.add(selectedDataSource);
  if (payload.visibleRegionRowsUsed === true || payload.visibleRegionRowCount !== undefined) {
    sources.add('dom_region_rows');
  }
  if (payload.markdown !== undefined) sources.add('markdown');
  return [...sources];
}

function inferRejectedDataSources(
  payload: Record<string, unknown>,
  selectedDataSource: ReadPageSelectedDataSource,
): BrowserDataSourceDecisionEvidence['rejectedSources'] {
  const rejectedSources: BrowserDataSourceDecisionEvidence['rejectedSources'] = [];
  const apiRowsUnavailableReason = readString(payload.apiRowsUnavailableReason);
  if (
    apiRowsUnavailableReason &&
    selectedDataSource !== 'api_rows' &&
    selectedDataSource !== 'cdp_enhanced_api_rows'
  ) {
    rejectedSources.push({ source: 'api_rows', reason: apiRowsUnavailableReason });
  }

  const visibleRowsRejectedReason = readString(payload.visibleRegionRowsRejectedReason);
  if (visibleRowsRejectedReason && selectedDataSource !== 'dom_region_rows') {
    rejectedSources.push({ source: 'dom_region_rows', reason: visibleRowsRejectedReason });
  }

  return rejectedSources;
}

function inferMetadataCompleteness(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): number | null {
  const explicitCompleteness = readNumber(payload.metadataCompleteness);
  if (explicitCompleteness !== null) return clampUnitInterval(explicitCompleteness);
  const targetRefCoverageRate = readNumber(payload.targetRefCoverageRate);
  if (targetRefCoverageRate !== null) return clampUnitInterval(targetRefCoverageRate);
  if (projection.refreshedRefs.length > 0 && projection.changedRegions.length > 0) return 1;
  return null;
}

function isBrowserSourceTruthChainLike(input: unknown): input is BrowserSourceTruthChain {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const chain = input as Partial<BrowserSourceTruthChain>;
  return (
    typeof chain.primaryOrigin === 'string' &&
    Array.isArray(chain.fieldProvenances) &&
    typeof chain.provenanceCreatedAt === 'string'
  );
}

function inferSourceTruthOrigin(
  sourceLineage: BrowserSourceLineage,
  selectedDataSource: ReadPageSelectedDataSource,
): SourceTruthOrigin {
  if (selectedDataSource === 'api_rows') return 'api';
  if (selectedDataSource === 'cdp_enhanced_api_rows') return 'cdp';
  if (selectedDataSource === 'markdown') return 'text';
  if (selectedDataSource === 'dom_json' || selectedDataSource === 'dom_region_rows') return 'dom';
  switch (sourceLineage) {
    case 'dom':
      return 'dom';
    case 'accessibility':
      return 'accessibility';
    case 'api':
      return 'api';
    case 'cdp':
      return 'cdp';
    case 'text':
      return 'text';
    case 'mixed':
      return 'inference';
    default:
      return 'unknown';
  }
}

function hasVisibleRowsEvidence(payload: Record<string, unknown>): boolean {
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(payload, 'visibleDomRowsSelectedCount') ??
    readPositiveInteger(rowsPayload, 'rowCount');
  return (
    (payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true) &&
    rowCount !== null &&
    rowCount > 0
  );
}
