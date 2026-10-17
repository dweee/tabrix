import {
  type ReadPageCDPSensingSummary,
  type ReadPageEvidenceSource,
  type ReadPageObjectLifecycleSummary,
  type ReadPageObservationCoverage,
  type ReadPageObservationProfile,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRegion,
  type ReadPageRequestedLayer,
  type ReadPageSearchSurface,
} from '@tabrix/shared';
import type { PageRole } from './read-page-understanding';
import type { VisibleRegionRowsResult } from './visible-region-rows';

export interface RegionAlignedPageUnderstanding {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
}

export function buildObservationProfile(params: {
  mode: 'compact' | 'normal' | 'full';
  requestedLayer: ReadPageRequestedLayer;
}): ReadPageObservationProfile {
  if (params.mode === 'full') return 'full';
  if (params.mode === 'normal') return 'debug';
  if (params.requestedLayer !== 'L0+L1+L2') return 'task';
  return 'compact';
}

export function deriveRegionAlignedPageUnderstanding(params: {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  pageRegions: readonly ReadPageRegion[] | null | undefined;
  visibleRegionRows: VisibleRegionRowsResult;
}): RegionAlignedPageUnderstanding {
  if (params.pageRole !== 'unknown' || params.primaryRegion) {
    return {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      primaryRegionConfidence: params.primaryRegionConfidence,
    };
  }

  const regions = (params.pageRegions ?? []).filter(
    (region) => region.regionType && region.regionType !== 'unknown',
  );
  if (regions.length < 2) {
    return {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      primaryRegionConfidence: params.primaryRegionConfidence,
    };
  }

  const hasActionableRegion = regions.some(
    (region) =>
      (Array.isArray(region.candidateActionIds) && region.candidateActionIds.length > 0) ||
      (region.targetability && region.targetability !== 'not_clickable'),
  );
  if (!hasActionableRegion) {
    return {
      pageRole: params.pageRole,
      primaryRegion: params.primaryRegion,
      primaryRegionConfidence: params.primaryRegionConfidence,
    };
  }

  const regionTypes = new Set(regions.map((region) => region.regionType));
  const primaryRegion = params.visibleRegionRows.visibleRegionRowsUsed
    ? 'content'
    : regionTypes.has('form')
      ? 'form'
      : regionTypes.has('content')
        ? 'content'
        : regionTypes.has('navigation')
          ? 'navigation'
          : (regions[0]?.regionType ?? null);

  return {
    pageRole: 'multi_region_page',
    primaryRegion,
    primaryRegionConfidence: 'low',
  };
}

function mergeCoverageStatus(
  statuses: ReadonlyArray<ReadPageObservationCoverage['overall']>,
): ReadPageObservationCoverage['overall'] {
  if (statuses.includes('unsupported')) return 'unsupported';
  if (statuses.includes('visible_unresolved')) return 'visible_unresolved';
  if (statuses.includes('degraded')) return 'degraded';
  return 'covered';
}

function pushCapabilityGap(target: string[], gap: string) {
  if (!target.includes(gap)) target.push(gap);
}

export function buildObservationCoverage(params: {
  pageType: string;
  frameContext: unknown;
  visibleRegionRows: VisibleRegionRowsResult;
  searchSurface?: ReadPageSearchSurface;
}): ReadPageObservationCoverage {
  const capabilityGaps: string[] = [];
  const unsupported = params.pageType === 'unsupported_page';
  const unresolvedVisibleTextCount = params.searchSurface?.visibleButUnresolved?.length ?? 0;
  for (const gap of params.searchSurface?.observationCoverage?.capabilityGaps ?? []) {
    pushCapabilityGap(capabilityGaps, gap);
  }

  const frameContext =
    params.frameContext && typeof params.frameContext === 'object'
      ? (params.frameContext as { frameScope?: unknown })
      : null;
  const iframe = unsupported
    ? 'unsupported'
    : frameContext?.frameScope === 'subframe'
      ? 'covered'
      : 'degraded';
  if (iframe === 'degraded') pushCapabilityGap(capabilityGaps, 'iframe_full_coverage_not_proven');

  const shadowDom = unsupported ? 'unsupported' : 'degraded';
  if (shadowDom === 'degraded') {
    pushCapabilityGap(capabilityGaps, 'shadow_dom_coverage_not_inspected');
  }

  const resultCoverage = params.searchSurface?.resultCoverage;
  const virtualList = unsupported
    ? 'unsupported'
    : resultCoverage?.virtualizedListCandidate || resultCoverage?.loadMoreCandidateObserved
      ? 'visible_unresolved'
      : params.visibleRegionRows.visibleRegionRowsUsed
        ? 'covered'
        : 'degraded';
  if (virtualList === 'visible_unresolved') {
    pushCapabilityGap(capabilityGaps, 'virtual_list_or_load_more_boundary_not_exhausted');
  } else if (virtualList === 'degraded') {
    pushCapabilityGap(capabilityGaps, 'virtual_list_coverage_not_proven');
  }

  const filterPanelStatus = params.searchSurface?.filterPanel?.status;
  const dynamicPanel = unsupported
    ? 'unsupported'
    : unresolvedVisibleTextCount > 0
      ? 'visible_unresolved'
      : filterPanelStatus === 'open_candidate'
        ? 'covered'
        : 'degraded';
  if (dynamicPanel === 'visible_unresolved') {
    pushCapabilityGap(capabilityGaps, 'dynamic_panel_visible_text_without_locator');
  } else if (dynamicPanel === 'degraded') {
    pushCapabilityGap(capabilityGaps, 'dynamic_panel_state_not_observed');
  }

  return {
    overall: mergeCoverageStatus([iframe, shadowDom, virtualList, dynamicPanel]),
    iframe,
    shadowDom,
    virtualList,
    dynamicPanel,
    unresolvedVisibleTextCount,
    capabilityGaps,
    claimBoundary:
      'coverage describes what this read_page snapshot proves; action success still requires targetRef/candidateAction/locatorChain and business success requires postcondition verification',
  };
}

export function buildEvidenceSources(params: {
  pageContent: string;
  visibleTextContent?: string | null;
  refMapCount: number;
  elementsCount: number;
  visibleRegionRows: VisibleRegionRowsResult;
  selectedDataSource?: string;
  objectLifecycle?: ReadPageObjectLifecycleSummary;
  cdpSensing?: ReadPageCDPSensingSummary;
}): ReadPageEvidenceSource[] {
  const sources = new Set<ReadPageEvidenceSource>();
  const hasPageText = params.pageContent.trim().length > 0;
  if (hasPageText || params.refMapCount > 0 || params.elementsCount > 0) sources.add('ax');
  if (params.refMapCount > 0 || params.visibleRegionRows.visibleRegionRowsUsed) sources.add('dom');
  if ((params.visibleTextContent ?? '').trim().length > 0) sources.add('visible_text');
  if (
    params.selectedDataSource === 'api_rows' ||
    params.selectedDataSource === 'cdp_enhanced_api_rows'
  ) {
    sources.add('api');
  }
  if (params.cdpSensing?.available === true) sources.add('cdp');
  if (
    params.objectLifecycle?.status === 'compared_snapshot' &&
    params.objectLifecycle.changedObjectCount > 0
  ) {
    sources.add('watch_delta');
  }
  if (sources.size === 0) sources.add('ax');
  return [...sources];
}
