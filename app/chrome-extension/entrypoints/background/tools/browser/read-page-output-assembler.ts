import {
  buildBrowserPageThingProjectionFromReadPage,
  type BrowserPageStability,
  type ReadPageAssistantGuidance,
  type ReadPageBrowserPageObjectView,
  type ReadPageCompactSnapshot,
  type ReadPageFileInputBinding,
  type ReadPageFrameContext,
  type ReadPageFullSnapshot,
  type ReadPageLoadReadiness,
  type ReadPageMode,
  type ReadPageNormalSnapshot,
  type ReadPagePageContext,
  type ReadPagePageType,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRenderMode,
  type ReadPageRequestedLayer,
  type ReadPageWindowRuntimeState,
} from '@tabrix/shared';

import { buildInteractiveElements } from './read-page-interactive-elements';
import { buildCandidateActions, type CandidateActionSeed } from './read-page-candidate-actions';
import { buildAndRememberReadPageObjectSensingOutput } from './read-page-object-sensing-output';
import { buildBrowserPageObjectPublication } from './read-page-browser-page-object-publication';
import { recordReadPageTargetPublication } from './read-page-object-publication';
import { buildSearchSurface } from './read-page-search-surface';
import { buildArtifactRefs } from './read-page-artifact-refs';
import { buildPageOperationMap } from './read-page-operation-map';
import { buildExtensionLayer, buildStableSnapshotLayer } from './read-page-snapshot-builders';
import {
  attachInteractiveRects,
  attachInteractiveValueState,
} from './read-page-interactive-enrichment';
import { buildReadPageModeResult } from './read-page-mode-result';
import {
  applyPublishFormReadinessToPageRegions,
  buildPublishFormReadiness,
} from './read-page-publish-form-readiness';
import {
  buildEvidenceSources,
  buildObservationCoverage,
  buildObservationProfile,
  deriveRegionAlignedPageUnderstanding,
} from './read-page-observation';
import {
  completeVisibleRegionRows,
  suppressVisibleRowsForContentDetail,
} from './read-page-visible-region-postprocess';
import { inferUserActivityLevel } from './read-page-user-activity';
import {
  buildAuthCollaborationState,
  buildAuthQrArtifactRefs,
  buildNotRequestedAuthArtifactStatus,
} from './read-page-auth-artifacts';
import {
  browserWorldTabOpenedByToOwnerType,
  buildReadPageOwnershipRuntimeSummary,
} from './read-page-ownership-runtime';
import type { VisibleRegionRowsResult } from './visible-region-rows';
import type { ReadPageVisualElementHint } from './read-page-task-protocol';
import { mergeHighValueObjectActionsIntoCandidateActions } from './read-page-target-recovery';
import { getBrowserWorldSnapshot } from '../../browser-world-inventory';
import type { PageRole } from './read-page-understanding';

type ReadPageStats = {
  processed: number;
  included: number;
  durationMs: number;
};
type PageType = ReadPagePageType;
type PrimaryRegionConfidence = ReadPagePrimaryRegionConfidence;
export async function buildModeOutput(params: {
  mode: ReadPageMode;
  renderMode: ReadPageRenderMode;
  tabId: number;
  currentWindowId: number | null;
  currentWindowState: ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  pageStability: BrowserPageStability;
  loadReadiness: ReadPageLoadReadiness;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  scheme: string;
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: PrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
  pageContent: string;
  visibleTextContent?: string | null;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  frameContext: ReadPageFrameContext | null;
  stats: ReadPageStats | { processed: number; included: number; durationMs: number };
  viewport: { width: number | null; height: number | null; dpr: number | null };
  filter: string;
  depth: number | null;
  focus: { refId: string; found: boolean } | null;
  sparse: boolean;
  fallbackUsed: boolean;
  fallbackSource: string | null;
  refMapCount: number;
  markedElements: any[];
  elements: any[];
  count: number;
  reason: string | null;
  tips: string;
  refMap: any[];
  candidateActions: CandidateActionSeed[];
  fileInputBindings: ReadPageFileInputBinding[];
  visualElements: ReadPageVisualElementHint[];
  visibleRegionRows: VisibleRegionRowsResult;
  sensingDiagnostics?: ReadPagePageContext['sensingDiagnostics'];
  includeAuthArtifacts: boolean;
  assistantGuidance?: ReadPageAssistantGuidance;
  /** Layer envelope; defaults to 'L0+L1'. */
  requestedLayer: ReadPageRequestedLayer;
}): Promise<ReadPageCompactSnapshot | ReadPageNormalSnapshot | ReadPageFullSnapshot> {
  const interactiveLimit = params.mode === 'compact' ? 24 : 80;
  const interactiveElements = attachInteractiveValueState(
    attachInteractiveRects(
      buildInteractiveElements(
        params.pageContent,
        params.elements,
        interactiveLimit,
        params.mode,
        params.currentUrl,
      ),
      params.refMap,
    ),
    params.refMap,
  );
  const visibleRegionRows = suppressVisibleRowsForContentDetail(
    completeVisibleRegionRows({
      rows: params.visibleRegionRows,
      pageContent: params.pageContent,
      visibleTextContent: params.visibleTextContent,
      primaryRegion: params.primaryRegion,
      interactiveElements,
      currentUrl: params.currentUrl,
      currentTitle: params.currentTitle,
      viewport: params.viewport,
    }),
    params.pageRole,
  );
  let candidateActions =
    params.candidateActions.length > 0
      ? params.candidateActions
      : buildCandidateActions(interactiveElements, params.refMap, {
          visibleRegionRows,
          frameId: params.frameContext?.frameId,
          fileInputBindings: params.fileInputBindings,
          cdpAccessibilityCandidates:
            params.loadReadiness.cdpSensing?.accessibility?.objectCandidates ?? null,
          viewport: params.viewport,
        });
  const artifactRefs = buildArtifactRefs(params.tabId, params.renderMode === 'markdown');
  const pageContext: ReadPagePageContext = {
    filter: params.filter,
    depth: params.depth,
    focus: params.focus,
    scheme: params.scheme,
    viewport: params.viewport,
    sparse: params.sparse,
    fallbackUsed: params.fallbackUsed,
    fallbackSource: params.fallbackSource,
    refMapCount: params.refMapCount,
    markedElementsCount: params.markedElements.length,
    loadReadiness: params.loadReadiness,
  };
  if (params.sensingDiagnostics) {
    pageContext.sensingDiagnostics = params.sensingDiagnostics;
  }

  const extensionLayer = buildExtensionLayer({
    mode: params.mode,
    renderMode: params.renderMode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    tabId: params.tabId,
    pageStability: params.pageStability,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    contentSummary: params.contentSummary,
    artifactRefs,
    candidateActions,
    interactiveElements,
    pageContext,
    frameContext: params.frameContext,
    visibleRegionRows,
    visibleTextContent: params.visibleTextContent,
    visualElements: params.visualElements,
    requestedLayer: params.requestedLayer,
  });
  candidateActions = mergeHighValueObjectActionsIntoCandidateActions(
    candidateActions,
    extensionLayer.highValueObjects,
    params.frameContext?.frameId,
  );
  extensionLayer.candidateActions = params.requestedLayer === 'L0' ? [] : candidateActions;

  const regionAlignedUnderstanding = deriveRegionAlignedPageUnderstanding({
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    primaryRegionConfidence: params.primaryRegionConfidence,
    pageRegions: extensionLayer.pageRegions,
    visibleRegionRows,
  });

  const stableLayer = buildStableSnapshotLayer({
    mode: params.mode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: regionAlignedUnderstanding.pageRole,
    primaryRegion: regionAlignedUnderstanding.primaryRegion,
    quality: params.contentSummary.quality,
    interactiveElements,
    artifactRefs,
  });

  recordReadPageTargetPublication({
    tabId: params.tabId,
    highValueObjects: extensionLayer.highValueObjects,
    candidateActions,
    interactiveElements,
    frameId: params.frameContext?.frameId,
  });

  const publishFormReadiness = buildPublishFormReadiness({
    pageRole: regionAlignedUnderstanding.pageRole,
    primaryRegion: regionAlignedUnderstanding.primaryRegion,
    candidateActions,
    fileInputBindings: params.fileInputBindings,
    interactiveElements,
  });
  const pageRegionsWithReadiness = applyPublishFormReadinessToPageRegions(
    extensionLayer.pageRegions,
    publishFormReadiness,
  );
  const pageOperationMapWithReadiness = buildPageOperationMap(pageRegionsWithReadiness ?? [], {
    candidateActions,
    interactiveElements,
  });

  const sharedPayload: ReadPageCompactSnapshot = {
    ...stableLayer,
    ...extensionLayer,
    pageRegions: pageRegionsWithReadiness,
    pageOperationMap: pageOperationMapWithReadiness,
    fileInputBindings: params.fileInputBindings,
    publishFormReadiness,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
  };
  const observedAt = new Date().toISOString();
  const userActivityLevel = await inferUserActivityLevel({
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
  });
  const browserWorld = await getBrowserWorldSnapshot();
  const browserWorldTab = browserWorld.tabs.find((tab) => tab.tabId === params.tabId) ?? null;
  const ownerType = browserWorldTabOpenedByToOwnerType(browserWorldTab?.openedBy);
  sharedPayload.pageProjection = buildBrowserPageThingProjectionFromReadPage({
    snapshot: sharedPayload,
    projectionId: `read_page:${params.tabId}:${sharedPayload.historyRef ?? 'snapshot'}`,
    observedAt,
    pageId: `tab:${params.tabId}`,
    tabId: params.tabId,
    ownerType,
    contextVersion: sharedPayload.historyRef ?? `read_page:${params.tabId}`,
    previousContextVersion: null,
    changedByActionId: null,
    changeCause: 'unknown',
    userActivityLevel,
    interferenceRisk: 'medium',
    stability: params.pageStability,
  });
  sharedPayload.ownershipRuntime = buildReadPageOwnershipRuntimeSummary({
    tabId: params.tabId,
    currentOwnerType: ownerType,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    browserWorldTab,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
    browserWorldObjectChangeSummary: browserWorld.summary.objectChangeSummary,
    browserWorldActionableObjectChangeSummary:
      browserWorld.summary.actionableObjectChangeSummary ??
      browserWorld.summary.objectChangeSummary,
    browserWorldCurrentOperationConclusion: browserWorld.summary.currentOperationConclusion,
    browserWorldRoutingDecisionSummary: browserWorld.summary.routingDecisionSummary,
  });
  sharedPayload.authArtifactStatus = params.includeAuthArtifacts
    ? await buildAuthQrArtifactRefs({
        includeAuthArtifacts: true,
        tabId: params.tabId,
        windowId: params.currentWindowId,
        pageRegions: sharedPayload.pageRegions,
        browserWorldTab,
        artifactRefs,
        assistantGuidance: params.assistantGuidance,
      })
    : buildNotRequestedAuthArtifactStatus();
  sharedPayload.artifactRefs = artifactRefs;
  if (params.assistantGuidance) {
    sharedPayload.assistantGuidanceEcho = params.assistantGuidance;
  }
  let browserPageObjectForAuth: ReadPageBrowserPageObjectView | null = null;
  if (sharedPayload.objectLifecycle) {
    const browserPageObjectPublication = buildBrowserPageObjectPublication({
      tabId: params.tabId,
      currentUrl: params.currentUrl,
      mode: params.mode,
      pageRegions: sharedPayload.pageRegions,
      pageOperationMap: sharedPayload.pageOperationMap,
      objectLifecycle: sharedPayload.objectLifecycle,
      pageProjection: sharedPayload.pageProjection,
      ownershipRuntime: sharedPayload.ownershipRuntime,
      selectedDataSource: sharedPayload.selectedDataSource,
      publishFormReadiness: sharedPayload.publishFormReadiness,
    });
    browserPageObjectForAuth = browserPageObjectPublication.browserPageObjectForAuth;
    sharedPayload.objectLifecycle = browserPageObjectPublication.objectLifecycle;
    sharedPayload.browserPageObjectCompact = browserPageObjectPublication.browserPageObjectCompact;
    if (browserPageObjectPublication.browserPageObject) {
      sharedPayload.browserPageObject = browserPageObjectPublication.browserPageObject;
    }
  }
  sharedPayload.authCollaboration = buildAuthCollaborationState({
    pageRole: sharedPayload.summary?.pageRole,
    tabId: params.tabId,
    pageRegions: sharedPayload.pageRegions,
    browserPageObject: browserPageObjectForAuth,
    browserWorldTab,
    authArtifactStatus: sharedPayload.authArtifactStatus,
    artifactRefs,
    interactiveElements,
    candidateActions,
    assistantGuidance: params.assistantGuidance,
  });
  sharedPayload.searchSurface = buildSearchSurface({
    assistantGuidance: params.assistantGuidance,
    pageRole: sharedPayload.summary?.pageRole,
    interactiveElements,
    candidateActions,
    visibleRegionRows,
    visibleTextContent: params.visibleTextContent,
    frameContext: params.frameContext,
  });
  sharedPayload.observationProfile = buildObservationProfile({
    mode: params.mode,
    requestedLayer: params.requestedLayer,
  });
  sharedPayload.coverage = buildObservationCoverage({
    pageType: params.pageType,
    frameContext: params.frameContext,
    visibleRegionRows,
    searchSurface: sharedPayload.searchSurface,
  });
  sharedPayload.evidenceSource = buildEvidenceSources({
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    refMapCount: params.refMapCount,
    elementsCount: params.elements.length,
    visibleRegionRows,
    selectedDataSource: sharedPayload.selectedDataSource,
    objectLifecycle: sharedPayload.objectLifecycle,
    cdpSensing: params.loadReadiness.cdpSensing,
  });
  const { pageObjectSnapshot, postActionDeltaEvidence } =
    buildAndRememberReadPageObjectSensingOutput({
      tabId: params.tabId,
      currentUrl: params.currentUrl,
      currentTitle: params.currentTitle,
      cdpSensing: params.loadReadiness.cdpSensing,
      pageRegions: sharedPayload.pageRegions,
      candidateActions,
      pageType: params.pageType,
      pageRole: sharedPayload.summary?.pageRole || String(params.pageRole || 'unknown'),
      pageStability: params.pageStability,
      loadReadiness: params.loadReadiness,
      visibleTextContent: params.visibleTextContent,
    });
  if (postActionDeltaEvidence) {
    sharedPayload.postActionDeltaEvidence = postActionDeltaEvidence;
  }
  sharedPayload.pageObjectSnapshot = pageObjectSnapshot;

  return buildReadPageModeResult({
    sharedPayload,
    mode: params.mode,
    requestedLayer: params.requestedLayer,
    primaryRegionConfidence: params.primaryRegionConfidence,
    footerOnly: params.footerOnly,
    anchorTexts: params.anchorTexts,
    pageContent: params.pageContent,
    contentSummary: params.contentSummary,
    stats: params.stats,
    elements: params.elements,
    count: params.count,
    markedElements: params.markedElements,
    refMap: params.refMap,
    reason: params.reason,
    tips: params.tips,
  });
}
