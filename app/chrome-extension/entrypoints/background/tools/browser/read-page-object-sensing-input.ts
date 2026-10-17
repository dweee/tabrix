import type {
  BrowserPageStability,
  ReadPageCDPSensingSummary,
  ReadPageCompactSnapshot,
  ReadPageLoadReadiness,
  ReadPagePageType,
} from '@tabrix/shared';
import type { CandidateActionSeed } from './read-page-candidate-actions';
import {
  buildCDPRouteFingerprint,
  type ReadPageObjectDeltaSignals,
} from './read-page-object-delta';

export interface ReadPageObjectSensingInput {
  tabId: number;
  currentUrl: string;
  currentTitle: string;
  cdpSensing?: ReadPageCDPSensingSummary;
  pageRegions: ReadPageCompactSnapshot['pageRegions'];
  candidateActions: CandidateActionSeed[];
  pageType: ReadPagePageType;
  pageRole: string;
  pageStability: BrowserPageStability;
  loadReadiness: ReadPageLoadReadiness;
  visibleTextContent?: string | null;
}

export function buildReadPageObjectSensingInput(
  input: ReadPageObjectSensingInput,
): ReadPageObjectSensingInput {
  return {
    ...input,
    pageRegions: Array.isArray(input.pageRegions) ? input.pageRegions : [],
    candidateActions: Array.isArray(input.candidateActions) ? input.candidateActions : [],
    pageRole: input.pageRole || 'unknown',
  };
}

export function buildReadPageObjectDeltaSignals(
  input: Pick<ReadPageObjectSensingInput, 'cdpSensing'>,
): ReadPageObjectDeltaSignals {
  const cdpSensing = input.cdpSensing;
  return {
    networkStartedCount:
      typeof cdpSensing?.networkActivity?.requestStartedCount === 'number'
        ? cdpSensing.networkActivity.requestStartedCount
        : undefined,
    networkInFlightCount:
      typeof cdpSensing?.networkActivity?.inFlightCount === 'number'
        ? cdpSensing.networkActivity.inFlightCount
        : undefined,
    failedRequestCount:
      typeof cdpSensing?.networkActivity?.failedRequestCount === 'number'
        ? cdpSensing.networkActivity.failedRequestCount
        : undefined,
    errorCount:
      typeof cdpSensing?.console?.errorCount === 'number'
        ? cdpSensing.console.errorCount
        : undefined,
    warningCount:
      typeof cdpSensing?.console?.warningCount === 'number'
        ? cdpSensing.console.warningCount
        : undefined,
    routeFingerprint: buildCDPRouteFingerprint(cdpSensing),
  };
}
