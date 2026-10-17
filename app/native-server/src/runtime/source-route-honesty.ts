import type {
  BrowserSourceTruthChain,
  ReadPageSelectedDataSource,
  SourceTruthOrigin,
} from '@tabrix/shared';

export type SourceRouteHonestyVerdict =
  | 'api_proven'
  | 'cdp_proven'
  | 'dom_fallback'
  | 'mixed'
  | 'unknown'
  | 'blocked';

export interface SourceRouteHonestyResult {
  verdict: SourceRouteHonestyVerdict;
  selectedDataSource: ReadPageSelectedDataSource | null;
  sourceOrigins: SourceTruthOrigin[];
  factOrigins: SourceTruthOrigin[];
  hasFactEvidence: boolean;
  fallbackUsed: boolean;
  reason: string;
}

export interface ClassifySourceRouteHonestyInput {
  selectedDataSource: ReadPageSelectedDataSource | null;
  sourceTruthChain?: BrowserSourceTruthChain | null;
  fallbackReason?: string | null;
  blockedReason?: string | null;
}

const API_DATA_SOURCES = new Set<ReadPageSelectedDataSource>(['api_rows']);
const CDP_DATA_SOURCES = new Set<ReadPageSelectedDataSource>(['cdp_enhanced_api_rows']);
const DOM_FALLBACK_DATA_SOURCES = new Set<ReadPageSelectedDataSource>([
  'dom_json',
  'dom_region_rows',
  'markdown',
]);

export function classifySourceRouteHonesty(
  input: ClassifySourceRouteHonestyInput,
): SourceRouteHonestyResult {
  const selectedDataSource = input.selectedDataSource ?? null;
  const sourceOrigins = uniqueOrigins([
    ...(input.sourceTruthChain ? [input.sourceTruthChain.primaryOrigin] : []),
    ...(input.sourceTruthChain?.fieldProvenances.map((entry) => entry.origin) ?? []),
  ]);
  const factOrigins = uniqueOrigins(
    input.sourceTruthChain?.fieldProvenances
      .filter((entry) => entry.isFact)
      .map((entry) => entry.origin) ?? [],
  );
  const fallbackUsed = Boolean(input.fallbackReason);

  if (input.blockedReason) {
    return buildResult({
      verdict: 'blocked',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: input.blockedReason,
    });
  }

  if (!selectedDataSource) {
    return buildResult({
      verdict: 'unknown',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: 'selected_data_source_missing',
    });
  }

  if (isMixed(sourceOrigins)) {
    return buildResult({
      verdict: 'mixed',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: 'multiple_source_origins_observed',
    });
  }

  if (API_DATA_SOURCES.has(selectedDataSource)) {
    return buildResult({
      verdict: factOrigins.includes('api') ? 'api_proven' : 'unknown',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: factOrigins.includes('api')
        ? 'api_fact_evidence_present'
        : 'api_fact_evidence_missing',
    });
  }

  if (CDP_DATA_SOURCES.has(selectedDataSource)) {
    return buildResult({
      verdict: factOrigins.includes('cdp') ? 'cdp_proven' : 'unknown',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: factOrigins.includes('cdp')
        ? 'cdp_fact_evidence_present'
        : 'cdp_fact_evidence_missing',
    });
  }

  if (DOM_FALLBACK_DATA_SOURCES.has(selectedDataSource)) {
    return buildResult({
      verdict: 'dom_fallback',
      selectedDataSource,
      sourceOrigins,
      factOrigins,
      fallbackUsed,
      reason: fallbackUsed ? 'preferred_route_fell_back_to_dom' : 'dom_or_text_route_selected',
    });
  }

  return buildResult({
    verdict: 'unknown',
    selectedDataSource,
    sourceOrigins,
    factOrigins,
    fallbackUsed,
    reason: 'unsupported_selected_data_source',
  });
}

function buildResult(input: {
  verdict: SourceRouteHonestyVerdict;
  selectedDataSource: ReadPageSelectedDataSource | null;
  sourceOrigins: SourceTruthOrigin[];
  factOrigins: SourceTruthOrigin[];
  fallbackUsed: boolean;
  reason: string;
}): SourceRouteHonestyResult {
  return {
    ...input,
    hasFactEvidence: input.factOrigins.length > 0,
  };
}

function uniqueOrigins(values: SourceTruthOrigin[]): SourceTruthOrigin[] {
  return [...new Set(values.filter((value) => value !== 'unknown'))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function isMixed(origins: SourceTruthOrigin[]): boolean {
  const nonInference = origins.filter(
    (origin) => origin !== 'inference' && origin !== 'browser_runtime',
  );
  return new Set(nonInference).size > 1;
}
