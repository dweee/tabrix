import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  type BrowserPageStability,
  type BrowserUserActivityLevel,
  type ReadPageCompactSnapshot,
  type ReadPageFrameContext,
  type ReadPageFullSnapshot,
  type ReadPageMode,
  type ReadPageNormalSnapshot,
  type ReadPagePageContext,
  type ReadPageLoadReadiness,
  type ReadPagePageType,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRenderMode,
  type ReadPageRequestedLayer,
  type ReadPageSearchSurface,
  type ReadPageSensingDiagnostic,
  type ReadPageWindowRuntimeState,
  type ReadPageBrowserPageObjectView,
  type BrowserPageThingProjection,
  type BrowserPageOwnerType,
  type ReadPageAssistantGuidance,
  type ReadPageFileInputBinding,
  type ReadPagePublishFormReadiness,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  buildReadPageBrowserPageObjectView,
  buildBrowserPageThingProjectionFromReadPage,
} from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';
import { inferPageUnderstanding, type PageRole } from './read-page-understanding';
import {
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
  type CandidateActionTargetLocatorEntry,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';
import { inferSchemeGuard } from './read-page-scheme-guard';
import { summarizePageContent } from './read-page-content-summary';
import { buildInteractiveElements } from './read-page-interactive-elements';
import { buildCandidateActions, type CandidateActionSeed } from './read-page-candidate-actions';
import {
  buildBoundedWatchLoopSnapshot,
  buildReadPagePageDeltaReport,
  recordPendingActionBinding,
  resetObjectLifecycleCacheForTests,
} from './read-page-object-delta';
import { buildAndRememberReadPageObjectSensingOutput } from './read-page-object-sensing-output';
import {
  appendObjectSensingDiagnostic,
  normalizeAccessibilityTreeDiagnostics,
} from './read-page-sensing-diagnostics';
import {
  appendSyntheticRefBindingDiagnostic,
  bindSyntheticRefsToSelectors,
} from './read-page-target-ref-binding';
import {
  normalizeAssistantGuidance,
  normalizeWindowRuntimeState,
  readWindowInteger,
} from './read-page-input-normalizers';
import { buildLoadReadiness, inferPageStability, normalizeFrameContext } from './read-page-state';
import { scanVisibleResultCardsInPage } from './collect-result-cards';
import {
  buildSearchSurface,
  extractFilterPanelLabelsFromVisibleText,
  extractSearchToolbarLabelsFromVisibleText,
} from './read-page-search-surface';
import { buildArtifactRefs } from './read-page-artifact-refs';
import { buildFallbackRefMap, formatElementsAsPageContent } from './read-page-fallback-format';
import { collectReadPageFileInputBindings } from './read-page-file-input-bindings';
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
  buildReadPageCDPSensingSummary,
  captureReadPageCDPSensingSummary,
} from './read-page-cdp-sensing';
import {
  buildEvidenceSources,
  buildObservationCoverage,
  buildObservationProfile,
  deriveRegionAlignedPageUnderstanding,
  type RegionAlignedPageUnderstanding,
} from './read-page-observation';
import {
  completeVisibleRegionRows,
  reconcilePageUnderstandingWithVisibleRows,
  suppressVisibleRowsForContentDetail,
} from './read-page-visible-region-postprocess';
import {
  buildAuthCollaborationState,
  buildAuthQrArtifactRefs,
  buildNotRequestedAuthArtifactStatus,
} from './read-page-auth-artifacts';
import { supplementAuthFormInteractiveControls as supplementAuthFormInteractiveControlsPayload } from './read-page-auth-form-controls';
import {
  browserWorldTabOpenedByToOwnerType,
  buildReadPageOwnershipRuntimeSummary,
} from './read-page-ownership-runtime';
import { extractVisibleRegionRows, type VisibleRegionRowsResult } from './visible-region-rows';
import {
  extractGlobalMenuLabelsForTargetRecovery,
  type ReadPageVisualElementHint,
} from './read-page-task-protocol';
import {
  hasQrVisibleContext,
  QR_VISUAL_ELEMENT_SELECTOR,
  selectQrVisualElementHints,
} from './read-page-visual-elements';
import {
  attachFallbackRefs,
  DEFAULT_FILTER_PANEL_TARGET_RECOVERY_LABELS,
  extractVisibleMenuActionLabelsForTargetRecovery,
  extractVisibleTextControlLabelsForTargetRecovery,
  hasExecutableRecoveredTarget,
  isCompactFilterPanelFallbackElement,
  isCompactSearchToolbarFallbackElement,
  isCompactVisibleTextControlFallbackElement,
  isSearchToolbarFilterOpenLabel,
  isSearchToolbarRecoveredRef,
  itemUrlMatchesReadPage,
  mergeHighValueObjectActionsIntoCandidateActions,
  mergeVisibleSearchSurfaceActions,
  normalizeVisibleSearchSurfaceAction,
  prependRecoveredElementsToPageContent,
  promoteFilterPanelSelector,
  promoteSearchToolbarSelector,
  promoteTextMenuTriggerSelector,
  searchToolbarElementKey,
  SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS,
  shouldRecoverFilterPanelTargets,
  shouldRecoverSearchToolbarTargets,
  shouldRepairVisibleRowsTargetRefs,
} from './read-page-target-recovery';
import {
  getBrowserWorldSnapshot,
  markBrowserWorldTabAiOperated,
} from '../../browser-world-inventory';

export {
  buildReadPagePageDeltaReport,
  consumePendingActionBinding,
  recordPendingActionBinding,
} from './read-page-object-delta';
export { mergeHighValueObjectActionsIntoCandidateActions } from './read-page-target-recovery';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}
type PageType = ReadPagePageType;
type PrimaryRegionConfidence = ReadPagePrimaryRegionConfidence;
interface VisibleSearchSurfaceActionsResult {
  actions: CandidateActionSeed[];
  sensingDiagnostic?: ReadPageSensingDiagnostic;
}

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  mode?: ReadPageMode; // output verbosity mode, default compact
  render?: ReadPageRenderMode; // render mode, default 'json'
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // Layer envelope. When omitted, default to L0+L1; callers must explicitly
  // request L0+L1+L2 for the full controlled expansion.
  // The stable HVO targetRef registry is ALWAYS written (even at 'L0') so
  // chrome_click_element resolution stays deterministic.
  requestedLayer?: ReadPageRequestedLayer;
  includeAuthArtifacts?: boolean;
  assistantGuidance?: ReadPageAssistantGuidance;
  forceRefresh?: boolean;
  frameId?: number;
}

const READ_PAGE_SPARSE_RETRY_DELAY_MS = 450;
const READ_PAGE_PENDING_DOCUMENT_WAIT_MS = 5000;
const READ_PAGE_CONTENT_MESSAGE_RETRY_DELAY_MS = 450;
const INTERACTIVE_ELEMENTS_HELPER_FILE = 'inject-scripts/interactive-elements-helper.js';
const INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS = 300;
const VISIBLE_TEXT_FALLBACK_MAX_CHARS = 12_000;
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTabNavigationUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return String(tab.url || tab.pendingUrl || '');
}

async function inferUserActivityLevel(input: {
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
}): Promise<BrowserUserActivityLevel> {
  // Fast path: user is directly viewing the tab
  if (input.isCurrentTabActive === true && input.isCurrentWindowFocused === true) {
    return 'active';
  }
  // Cannot determine — missing API data
  if (input.isCurrentTabActive === null || input.isCurrentWindowFocused === null) {
    return 'unknown';
  }
  // User is NOT viewing the tab — check system idle state
  try {
    if (typeof chrome?.idle?.queryState === 'function') {
      const state = await chrome.idle.queryState(15);
      if (state === 'active') return 'recent_input';
    }
  } catch (error) {
    void error;
    /* fall through to 'none' */
  }
  return 'none';
}

function shouldSampleVisibleText(input: {
  treeOk: boolean;
  userControlled: boolean;
  mode: ReadPageMode;
  requestedDepth: number | undefined;
  focusRefId: string | undefined;
  rows: VisibleRegionRowsResult;
  pageRole?: string;
  assistantGuidance?: ReadPageAssistantGuidance;
}): boolean {
  if (!input.treeOk) return false;
  if (input.focusRefId) return false;
  if (input.mode === 'full') return true;
  if (input.pageRole === 'publish_form') return true;
  if (shouldRecoverSearchToolbarTargets(input.assistantGuidance, input.pageRole)) return true;
  if (!input.userControlled) return true;
  if (input.rows.visibleRegionRowsUsed) return false;
  if (input.pageRole === 'search_results') return true;
  return input.requestedDepth !== undefined && input.requestedDepth <= 3;
}

async function buildModeOutput(params: {
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

  // Feed the per-tab stable-targetRef registry so the click bridge can
  // translate `tgt_*` from prior turns back into the live per-snapshot
  // `ref_*` for this exact tab. We do this exactly once per snapshot, after
  // the extension layer is built but before serializing the response, so
  // every successful read replaces the previous mapping atomically.
  if (Array.isArray(extensionLayer.highValueObjects)) {
    const entries: StableTargetRefEntry[] = [];
    const snapshotFrameId = params.frameContext?.frameId;
    for (const highValueObject of extensionLayer.highValueObjects) {
      if (highValueObject.targetRef && highValueObject.ref) {
        entries.push({
          targetRef: highValueObject.targetRef,
          ref: highValueObject.ref,
          ...(typeof snapshotFrameId === 'number' ? { frameId: snapshotFrameId } : {}),
        });
      }
    }
    recordStableTargetRefSnapshot(params.tabId, entries);
  }
  if (Array.isArray(candidateActions)) {
    const entries: CandidateActionTargetLocatorEntry[] = [];
    const snapshotFrameId = params.frameContext?.frameId;
    for (const candidateAction of candidateActions) {
      const targetRef =
        typeof candidateAction?.targetRef === 'string' ? candidateAction.targetRef.trim() : '';
      if (!targetRef) continue;
      const cssLocator = Array.isArray(candidateAction.locatorChain)
        ? candidateAction.locatorChain.find((locator) => locator?.type === 'css')
        : undefined;
      const selector = typeof cssLocator?.value === 'string' ? cssLocator.value.trim() : '';
      if (!selector) continue;
      entries.push({
        targetRef,
        selector,
        selectorType: 'css',
        ...(typeof candidateAction.frameId === 'number'
          ? { frameId: candidateAction.frameId }
          : typeof snapshotFrameId === 'number'
            ? { frameId: snapshotFrameId }
            : {}),
      });
    }
    recordCandidateActionTargetLocatorsSnapshot(params.tabId, entries);
  }

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
    const watchLoopSnapshot = buildBoundedWatchLoopSnapshot({
      tabId: params.tabId,
      url: params.currentUrl,
      pageRegions: sharedPayload.pageRegions,
      lifecycle: sharedPayload.objectLifecycle,
      pageProjection: sharedPayload.pageProjection,
      ownershipRuntime: sharedPayload.ownershipRuntime,
    });
    sharedPayload.objectLifecycle = watchLoopSnapshot.objectLifecycle;
    const browserPageObject = buildReadPageBrowserPageObjectView({
      pageRegions: sharedPayload.pageRegions,
      pageOperationMap: sharedPayload.pageOperationMap,
      objectLifecycle: sharedPayload.objectLifecycle,
      previousPageProjection: watchLoopSnapshot.previousPageProjection,
      pageProjection: sharedPayload.pageProjection,
      previousOwnershipRuntime: watchLoopSnapshot.previousOwnershipRuntime,
      ownershipRuntime: sharedPayload.ownershipRuntime,
      selectedDataSource: sharedPayload.selectedDataSource,
      publishFormReadiness: sharedPayload.publishFormReadiness,
      sourceRouteHonestyVerdict: null,
    });
    browserPageObjectForAuth = browserPageObject;
    sharedPayload.browserPageObjectCompact = browserPageObject.compact;
    if (params.mode === 'compact') {
      delete sharedPayload.browserPageObject;
    } else {
      sharedPayload.browserPageObject = browserPageObject;
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

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  __resetObjectLifecycleCacheForTests(): void {
    resetObjectLifecycleCacheForTests();
  }

  private async ensureInteractiveElementsHelper(tabId: number, frameId?: number): Promise<void> {
    try {
      const pingMessage = {
        action: `${TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS}_ping`,
      };
      const response = await Promise.race([
        typeof frameId === 'number'
          ? chrome.tabs.sendMessage(tabId, pingMessage, { frameId })
          : chrome.tabs.sendMessage(tabId, pingMessage),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('interactive elements helper ping timed out')),
            INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS,
          ),
        ),
      ]);

      if (response && (response as any).status === 'pong') {
        return;
      }
    } catch (error) {
      void error;
      // Expected when the fallback helper has not been injected on this page yet.
    }

    await chrome.scripting.executeScript({
      target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
      files: [INTERACTIVE_ELEMENTS_HELPER_FILE],
      world: 'ISOLATED',
    } as any);
  }

  private async sampleVisibleTextContent(tabId: number, frameId?: number): Promise<string | null> {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
        func: (maxChars: number) => {
          try {
            const text = document.body?.innerText || '';
            return typeof text === 'string' ? text.slice(0, maxChars) : '';
          } catch {
            return '';
          }
        },
        args: [VISIBLE_TEXT_FALLBACK_MAX_CHARS],
      } as any);
      const text = result?.[0]?.result;
      return typeof text === 'string' && text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  private async collectInteractiveElementsFallback(
    tabId: number,
    options: {
      textQuery?: string;
      selector?: string;
      includeCoordinates?: boolean;
      frameId?: number;
    } = {},
  ): Promise<any | null> {
    let fallback: any = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
      await this.ensureInteractiveElementsHelper(tabId, options.frameId);
      fallback = await this.sendMessageToTab(
        tabId,
        {
          action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
          includeCoordinates: options.includeCoordinates !== false,
          ...(options.selector ? { selector: options.selector } : {}),
          ...(options.textQuery ? { textQuery: options.textQuery } : {}),
        },
        options.frameId,
      );
      if (fallback && fallback.success && Array.isArray(fallback.elements)) break;
    }
    return fallback && fallback.success && Array.isArray(fallback.elements) ? fallback : null;
  }

  private async collectVisibleSearchSurfaceActions(params: {
    tabId: number;
    currentUrl: string;
    assistantGuidance?: ReadPageAssistantGuidance;
    pageRole?: string;
  }): Promise<VisibleSearchSurfaceActionsResult> {
    if (!shouldRecoverSearchToolbarTargets(params.assistantGuidance, params.pageRole)) {
      return { actions: [] };
    }
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: params.tabId, allFrames: true },
        func: scanVisibleResultCardsInPage,
        world: 'MAIN',
      } as any);
      const scans = (Array.isArray(results) ? results : [])
        .map((entry: any) => entry?.result)
        .filter((scan: any) => scan && Array.isArray(scan.candidateActions));
      const scan = scans
        .filter((item: any) => !/^(about|chrome|edge|devtools):/i.test(item?.pageInfo?.url || ''))
        .sort((left: any, right: any) => {
          const urlMatchRight = itemUrlMatchesReadPage(right, params.currentUrl) ? 1 : 0;
          const urlMatchLeft = itemUrlMatchesReadPage(left, params.currentUrl) ? 1 : 0;
          if (urlMatchRight !== urlMatchLeft) return urlMatchRight - urlMatchLeft;
          const actionDelta =
            (right.candidateActions?.length ?? 0) - (left.candidateActions?.length ?? 0);
          if (actionDelta !== 0) return actionDelta;
          return (right.cards?.length ?? 0) - (left.cards?.length ?? 0);
        })[0];
      if (!scan) return { actions: [] };
      const actions = (scan.candidateActions ?? [])
        .map((action: any) => normalizeVisibleSearchSurfaceAction(action))
        .filter(
          (action: CandidateActionSeed | null): action is CandidateActionSeed => action !== null,
        );
      return { actions };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        actions: [],
        sensingDiagnostic: {
          source: 'visible_search_surface.scan',
          message: `visible result card action scan failed: ${message.replace(/\s+/g, ' ').slice(0, 120)}`,
        },
      };
    }
  }

  private async supplementAuthFormInteractiveControls(
    tabId: number,
    basePayload: Record<string, any>,
    frameId?: number,
  ): Promise<void> {
    await supplementAuthFormInteractiveControlsPayload({
      tabId,
      basePayload,
      frameId,
      collectInteractiveElementsFallback: this.collectInteractiveElementsFallback.bind(this),
    });
  }

  private async collectQrVisualElements(params: {
    tabId: number;
    pageContent: string;
    visibleTextContent?: string | null;
    frameId?: number;
  }): Promise<ReadPageVisualElementHint[]> {
    if (!hasQrVisibleContext(params.pageContent, params.visibleTextContent)) return [];
    const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
      selector: QR_VISUAL_ELEMENT_SELECTOR,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    const elements = Array.isArray(fallback?.elements) ? fallback.elements : [];
    return selectQrVisualElementHints(elements);
  }

  private async recoverGlobalMenuTextTargets(params: {
    tabId: number;
    basePayload: any;
    frameId?: number;
  }): Promise<boolean> {
    const labels = Array.from(
      new Set([
        ...extractGlobalMenuLabelsForTargetRecovery(params.basePayload.visibleTextContent),
        ...extractVisibleMenuActionLabelsForTargetRecovery(params.basePayload.visibleTextContent),
      ]),
    )
      .filter((label) => label.length <= 18)
      .slice(0, 16);
    if (labels.length === 0) return false;

    const existingTargetableLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => hasExecutableRecoveredTarget(element))
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    const recovered: any[] = [];
    for (const label of labels) {
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalizedLabel || existingTargetableLabels.has(normalizedLabel)) continue;
      const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
        frameId: params.frameId,
      });
      const first = Array.isArray(fallback?.elements) ? fallback.elements[0] : null;
      if (!first?.selector) continue;
      recovered.push({
        ...first,
        selector: promoteTextMenuTriggerSelector(first.selector) || first.selector,
        text: label,
        name: label,
        role: first.role || 'button',
        type: first.type === 'text' ? 'interactive' : first.type || 'interactive',
      });
      existingTargetableLabels.add(normalizedLabel);
    }
    if (recovered.length === 0) return false;

    const existingElements = Array.isArray(params.basePayload.elements)
      ? params.basePayload.elements
      : [];
    const existingRefMap = Array.isArray(params.basePayload.refMap)
      ? params.basePayload.refMap
      : [];
    const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
    const recoveredRefMap = buildFallbackRefMap(recovered).map((entry, index) =>
      entry ? { ...entry, ref: `ref_text_menu_${offset + index + 1}` } : null,
    );
    const recoveredWithRefs = attachFallbackRefs(recovered, recoveredRefMap);

    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+text_menu_target_recovery`
      : 'text_menu_target_recovery';
    return true;
  }

  private async recoverVisibleTextControlTargets(params: {
    tabId: number;
    basePayload: any;
    frameId?: number;
  }): Promise<boolean> {
    const labels = extractVisibleTextControlLabelsForTargetRecovery(
      params.basePayload.visibleTextContent,
    );
    if (labels.length === 0) return false;

    const existingTargetKeys = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => {
          const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
          const href = typeof element?.href === 'string' ? element.href.trim() : '';
          return Boolean(selector || href);
        })
        .map((element: any) => searchToolbarElementKey(element))
        .filter(Boolean),
    );
    const existingLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => hasExecutableRecoveredTarget(element))
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );

    const recovered: any[] = [];
    for (const label of labels) {
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalizedLabel || existingLabels.has(normalizedLabel)) continue;
      const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
        frameId: params.frameId,
      });
      const first = Array.isArray(fallback?.elements)
        ? fallback.elements.find((element: any) =>
            isCompactVisibleTextControlFallbackElement(element),
          )
        : null;
      if (!first?.selector) continue;
      const recoveredElement = {
        ...first,
        selector: first.selector,
        text: label,
        name: label,
        role: first.role === 'generic' ? 'button' : first.role || 'button',
        type: first.type === 'text' ? 'button' : first.type || 'button',
      };
      const key = searchToolbarElementKey(recoveredElement);
      if (!key || existingTargetKeys.has(key)) continue;
      recovered.push(recoveredElement);
      existingTargetKeys.add(key);
      existingLabels.add(normalizedLabel);
    }
    if (recovered.length === 0) return false;

    const existingElements = Array.isArray(params.basePayload.elements)
      ? params.basePayload.elements
      : [];
    const existingRefMap = Array.isArray(params.basePayload.refMap)
      ? params.basePayload.refMap
      : [];
    const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
    const recoveredRefMap = buildFallbackRefMap(recovered).map((entry, index) =>
      entry ? { ...entry, ref: `ref_text_control_${offset + index + 1}` } : null,
    );
    const binding = await bindSyntheticRefsToSelectors(
      params.tabId,
      recoveredRefMap,
      params.frameId,
    );
    appendSyntheticRefBindingDiagnostic(params.basePayload, binding);
    const recoveredWithRefs = attachFallbackRefs(recovered, recoveredRefMap);

    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    prependRecoveredElementsToPageContent({
      basePayload: params.basePayload,
      recoveredElements: recoveredWithRefs,
      recoveredRefMap,
    });
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+visible_text_control_recovery`
      : 'visible_text_control_recovery';
    return true;
  }

  private async recoverSearchToolbarTextTargets(params: {
    tabId: number;
    basePayload: any;
    assistantGuidance?: ReadPageAssistantGuidance;
    frameId?: number;
  }): Promise<boolean> {
    if (!shouldRecoverSearchToolbarTargets(params.assistantGuidance, params.basePayload.pageRole)) {
      return false;
    }
    const labels = Array.from(
      new Set([
        ...SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS,
        ...extractSearchToolbarLabelsFromVisibleText(params.basePayload.visibleTextContent),
      ]),
    )
      .filter((label) => label.length <= 18)
      .slice(0, 14);
    if (labels.length === 0) return false;

    const existingTargetKeys = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => hasExecutableRecoveredTarget(element))
        .map((element: any) => searchToolbarElementKey(element))
        .filter(Boolean),
    );
    const existingLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => hasExecutableRecoveredTarget(element))
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    const existingRecoveredToolbarLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => isSearchToolbarRecoveredRef(element?.ref))
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );

    const recovered: any[] = [];
    for (const label of labels) {
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      const forceToolbarRecovery =
        isSearchToolbarFilterOpenLabel(label) &&
        !existingRecoveredToolbarLabels.has(normalizedLabel);
      if (!normalizedLabel || (existingLabels.has(normalizedLabel) && !forceToolbarRecovery))
        continue;
      let fallback = await this.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
        frameId: params.frameId,
      });
      let first = Array.isArray(fallback?.elements)
        ? fallback.elements.find(
            (element: any) => element?.selector && isCompactSearchToolbarFallbackElement(element),
          )
        : null;
      if (!first?.selector && typeof params.frameId === 'number') {
        fallback = await this.collectInteractiveElementsFallback(params.tabId, {
          textQuery: label,
          includeCoordinates: true,
        });
        first = Array.isArray(fallback?.elements)
          ? fallback.elements.find(
              (element: any) => element?.selector && isCompactSearchToolbarFallbackElement(element),
            )
          : null;
      }
      if (!first?.selector) continue;
      const recoveredElement = {
        ...first,
        selector: promoteSearchToolbarSelector(first.selector) || first.selector,
        text: label,
        name: label,
        role: first.role || 'button',
        type: first.type === 'text' ? 'button' : first.type || 'button',
      };
      const key = searchToolbarElementKey(recoveredElement);
      if (!key || (existingTargetKeys.has(key) && !forceToolbarRecovery)) continue;
      recovered.push(recoveredElement);
      existingTargetKeys.add(key);
      existingLabels.add(normalizedLabel);
      existingRecoveredToolbarLabels.add(normalizedLabel);
    }
    if (recovered.length === 0) return false;

    const existingElements = Array.isArray(params.basePayload.elements)
      ? params.basePayload.elements
      : [];
    const existingRefMap = Array.isArray(params.basePayload.refMap)
      ? params.basePayload.refMap
      : [];
    const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
    const recoveredRefMap = buildFallbackRefMap(recovered).map((entry, index) =>
      entry ? { ...entry, ref: `ref_text_search_toolbar_${offset + index + 1}` } : null,
    );
    const binding = await bindSyntheticRefsToSelectors(
      params.tabId,
      recoveredRefMap,
      params.frameId,
    );
    appendSyntheticRefBindingDiagnostic(params.basePayload, binding);
    const recoveredWithRefs = attachFallbackRefs(recovered, recoveredRefMap);

    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    prependRecoveredElementsToPageContent({
      basePayload: params.basePayload,
      recoveredElements: recoveredWithRefs,
      recoveredRefMap,
    });
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+search_toolbar_target_recovery`
      : 'search_toolbar_target_recovery';
    return true;
  }

  private async recoverFilterPanelTextTargets(params: {
    tabId: number;
    basePayload: any;
    assistantGuidance?: ReadPageAssistantGuidance;
    frameId?: number;
  }): Promise<boolean> {
    if (
      !shouldRecoverFilterPanelTargets(
        params.assistantGuidance,
        params.basePayload.visibleTextContent,
        params.basePayload.pageRole,
      )
    ) {
      return false;
    }
    const labelSource = shouldRecoverSearchToolbarTargets(
      params.assistantGuidance,
      params.basePayload.pageRole,
    )
      ? [
          ...extractFilterPanelLabelsFromVisibleText(params.basePayload.visibleTextContent),
          ...DEFAULT_FILTER_PANEL_TARGET_RECOVERY_LABELS,
        ]
      : extractFilterPanelLabelsFromVisibleText(params.basePayload.visibleTextContent);
    const seenLabels = new Set<string>();
    const labels = labelSource
      .filter((label) => label.length <= 18)
      .filter((label) => {
        const key = label.replace(/\s+/g, ' ').trim().toLowerCase();
        if (!key || seenLabels.has(key)) return false;
        seenLabels.add(key);
        return true;
      })
      .slice(0, 16);
    if (labels.length === 0) return false;

    const existingTargetKeys = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => hasExecutableRecoveredTarget(element))
        .map((element: any) => searchToolbarElementKey(element))
        .filter(Boolean),
    );
    const existingRecoveredLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => String(element?.ref || '').startsWith('ref_text_filter_panel_'))
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );

    const recovered: any[] = [];
    for (const label of labels) {
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalizedLabel || existingRecoveredLabels.has(normalizedLabel)) continue;
      const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
        frameId: params.frameId,
      });
      const first = Array.isArray(fallback?.elements)
        ? fallback.elements.find(
            (element: any) => element?.selector && isCompactFilterPanelFallbackElement(element),
          )
        : null;
      if (!first?.selector) continue;
      const recoveredElement = {
        ...first,
        selector: promoteFilterPanelSelector(first.selector) || first.selector,
        text: label,
        name: label,
        role: first.role === 'generic' ? 'button' : first.role || 'button',
        type: first.type === 'text' ? 'button' : first.type || 'button',
      };
      const key = searchToolbarElementKey(recoveredElement);
      if (!key || existingTargetKeys.has(key)) continue;
      recovered.push(recoveredElement);
      existingTargetKeys.add(key);
      existingRecoveredLabels.add(normalizedLabel);
    }
    if (recovered.length === 0) return false;

    const existingElements = Array.isArray(params.basePayload.elements)
      ? params.basePayload.elements
      : [];
    const existingRefMap = Array.isArray(params.basePayload.refMap)
      ? params.basePayload.refMap
      : [];
    const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
    const recoveredRefMap = buildFallbackRefMap(recovered).map((entry, index) =>
      entry ? { ...entry, ref: `ref_text_filter_panel_${offset + index + 1}` } : null,
    );
    const binding = await bindSyntheticRefsToSelectors(
      params.tabId,
      recoveredRefMap,
      params.frameId,
    );
    appendSyntheticRefBindingDiagnostic(params.basePayload, binding);
    const recoveredWithRefs = attachFallbackRefs(recovered, recoveredRefMap);

    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    prependRecoveredElementsToPageContent({
      basePayload: params.basePayload,
      recoveredElements: recoveredWithRefs,
      recoveredRefMap,
    });
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+filter_panel_target_recovery`
      : 'filter_panel_target_recovery';
    return true;
  }

  private async generateAccessibilityTreeWithRetry(
    tabId: number,
    message: unknown,
    frameId?: number,
  ): Promise<any> {
    try {
      return await this.sendMessageToTab(tabId, message, frameId);
    } catch (error) {
      await delay(READ_PAGE_CONTENT_MESSAGE_RETRY_DELAY_MS);
      await this.injectContentScript(
        tabId,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        typeof frameId === 'number' ? false : true,
        typeof frameId === 'number' ? [frameId] : undefined,
      );
      return await this.sendMessageToTab(tabId, message, frameId);
    }
  }

  private async repairVisibleRowsTargetRefs(params: {
    tabId: number;
    basePayload: Record<string, any>;
    pageUnderstanding: ReturnType<typeof inferPageUnderstanding>;
    currentUrl: string;
    currentTitle: string;
    frameId?: number;
  }): Promise<boolean> {
    if (!shouldRepairVisibleRowsTargetRefs(params.basePayload.visibleRegionRows)) return false;

    const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
      frameId: params.frameId,
    });
    if (!fallback) return false;
    const merged = fallback.elements.slice(0, 150);
    const fallbackRefMap = buildFallbackRefMap(merged);
    const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
    const visibleTextContent =
      typeof params.basePayload.visibleTextContent === 'string' &&
      params.basePayload.visibleTextContent.trim()
        ? params.basePayload.visibleTextContent
        : await this.sampleVisibleTextContent(params.tabId, params.frameId);
    if (!visibleTextContent) return false;

    const repairedRows = extractVisibleRegionRows({
      pageContent: String(params.basePayload.pageContent || ''),
      visibleTextContent,
      sourceRegion: params.pageUnderstanding.primaryRegion,
      fallbackInteractiveElements: mergedWithRefs,
      url: params.currentUrl,
      title: params.currentTitle,
      viewport: params.basePayload.viewport,
      scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
      pixelsBelow: typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
    });
    if (
      !repairedRows.visibleRegionRowsUsed ||
      repairedRows.targetRefCoverageRate <=
        params.basePayload.visibleRegionRows.targetRefCoverageRate
    ) {
      return false;
    }

    params.basePayload.visibleTextContent = visibleTextContent;
    params.basePayload.visibleRegionRows = repairedRows;
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = 'get_interactive_elements_target_ref_repair';
    params.basePayload.elements = mergedWithRefs;
    params.basePayload.count = fallback.elements.length;
    params.basePayload.refMap = fallbackRefMap;
    params.basePayload.refMapCount = fallbackRefMap.filter((entry) => entry != null).length;
    reconcilePageUnderstandingWithVisibleRows(params.basePayload);
    return true;
  }

  // Execute read page
  async execute(args: ReadPageParams): Promise<ToolResult> {
    const { filter, depth, refId, mode, render, requestedLayer } = args || {};
    const includeAuthArtifacts = args?.includeAuthArtifacts === true;
    const assistantGuidance = normalizeAssistantGuidance(args?.assistantGuidance);
    const requestedFrameId =
      typeof args?.frameId === 'number' && Number.isFinite(args.frameId) ? args.frameId : undefined;

    // Validate refId parameter
    const focusRefId = typeof refId === 'string' ? refId.trim() : '';
    if (refId !== undefined && !focusRefId) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: refId must be a non-empty string`,
      );
    }

    // Validate depth parameter
    const requestedDepth = depth === undefined ? undefined : Number(depth);
    if (requestedDepth !== undefined && (!Number.isInteger(requestedDepth) || requestedDepth < 0)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: depth must be a non-negative integer`,
      );
    }

    const selectedModeRaw = mode || 'compact';
    if (!['compact', 'normal', 'full'].includes(selectedModeRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: mode must be one of compact | normal | full`,
      );
    }
    const selectedMode = selectedModeRaw as ReadPageMode;

    // Validate render mode. Default 'json' so legacy callers see no behavior
    // change. We deliberately fail closed on unknown values rather than
    // silently coerce: an unknown render mode usually means the upstream
    // client speaks a newer contract than this extension can satisfy, and
    // silent coercion would hide that drift.
    const selectedRenderRaw = render || 'json';
    if (!['json', 'markdown'].includes(selectedRenderRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: render must be one of json | markdown`,
      );
    }
    const selectedRender = selectedRenderRaw as ReadPageRenderMode;

    // Validate requestedLayer. Default to `L0+L1`; callers must explicitly
    // request `L0+L1+L2` for full detail expansion. Unknown values fail closed
    // for the same reason `render` does: the upstream client almost certainly
    // speaks a newer contract than this extension can satisfy.
    let selectedLayer: ReadPageRequestedLayer = 'L0+L1';
    if (requestedLayer !== undefined) {
      if (
        typeof requestedLayer !== 'string' ||
        !(READ_PAGE_REQUESTED_LAYER_VALUES as readonly string[]).includes(requestedLayer)
      ) {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: requestedLayer must be one of ${READ_PAGE_REQUESTED_LAYER_VALUES.join(' | ')}`,
        );
      }
      selectedLayer = requestedLayer;
    }

    // Track if user explicitly controlled the output (skip sparse heuristics)
    const userControlled = requestedDepth !== undefined || !!focusRefId;

    try {
      // Tip text returned to callers to guide next action
      const standardTips =
        'Stay on the safe path first: prefer candidate actions and stable refs from chrome_read_page or chrome_get_interactive_elements. If the specific element you need is still missing, use chrome_screenshot for visual confirmation and coordinates. Reserve chrome_computer or chrome_javascript for explicit fallback/debug cases only.';

      const hasExplicitTabId =
        args !== null &&
        typeof args === 'object' &&
        Object.prototype.hasOwnProperty.call(args, 'tabId') &&
        (args as ReadPageParams).tabId !== undefined &&
        (args as ReadPageParams).tabId !== null;
      const requestedTabId =
        hasExplicitTabId && Number.isInteger((args as ReadPageParams).tabId)
          ? ((args as ReadPageParams).tabId as number)
          : null;
      if (hasExplicitTabId && (requestedTabId === null || requestedTabId <= 0)) {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: tabId must be a positive integer when provided`,
        );
      }
      const explicit = await this.tryGetTab(requestedTabId ?? undefined);
      if (requestedTabId !== null && explicit === null) {
        return createErrorResponse(
          `${ERROR_MESSAGES.TAB_NOT_FOUND}: requested tabId ${requestedTabId} was not found; read_page will not fall back to the active tab`,
        );
      }
      let tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id)
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      const tabId = tab.id;
      markBrowserWorldTabAiOperated(tabId, 'read_page');

      const initialNavigationUrl = getTabNavigationUrl(tab);
      const initialTabStatus = typeof tab.status === 'string' ? tab.status : null;
      let pendingDocumentSettleResult: {
        settled: boolean;
        timedOut: boolean;
        reason: string;
        waitedMs: number;
        readyState: string | null;
      } | null = null;
      let waitedForPendingDocument = false;
      if (
        explicit &&
        /^https?:\/\//i.test(initialNavigationUrl) &&
        (!tab.url || tab.status === 'loading')
      ) {
        waitedForPendingDocument = true;
        const settleResult = await this.waitForTabSettled(tabId, {
          timeoutMs: READ_PAGE_PENDING_DOCUMENT_WAIT_MS,
        });
        pendingDocumentSettleResult = {
          settled: settleResult.settled,
          timedOut: settleResult.timedOut,
          reason: settleResult.reason,
          waitedMs: settleResult.waitedMs,
          readyState: settleResult.readyState,
        };
        tab = settleResult.tab;
      }

      const currentUrl = getTabNavigationUrl(tab);
      const currentTitle = String(tab.title || '');
      const currentWindowId = Number.isInteger(tab.windowId) ? tab.windowId : null;
      const isCurrentTabActive = typeof tab.active === 'boolean' ? tab.active : null;
      let isCurrentWindowFocused: boolean | null = null;
      let currentWindowState: ReadPageWindowRuntimeState | null = null;
      let currentWindowWidth: number | null = null;
      let currentWindowHeight: number | null = null;
      let currentWindowLeft: number | null = null;
      let currentWindowTop: number | null = null;
      let browserActiveTabId: number | null = null;
      let browserActiveTabIdKnown = false;
      let isReadTargetBrowserActiveTab: boolean | null = null;
      if (currentWindowId !== null && typeof chrome.windows?.get === 'function') {
        try {
          const currentWindow = await chrome.windows.get(currentWindowId, { populate: true });
          isCurrentWindowFocused =
            currentWindow && typeof currentWindow.focused === 'boolean'
              ? currentWindow.focused
              : null;
          currentWindowState = normalizeWindowRuntimeState(currentWindow?.state);
          currentWindowWidth = readWindowInteger(currentWindow?.width);
          currentWindowHeight = readWindowInteger(currentWindow?.height);
          currentWindowLeft = readWindowInteger(currentWindow?.left);
          currentWindowTop = readWindowInteger(currentWindow?.top);
          const activeWindowTab = Array.isArray(currentWindow?.tabs)
            ? currentWindow.tabs.find((windowTab) => windowTab.active === true)
            : null;
          browserActiveTabId =
            activeWindowTab && Number.isInteger(activeWindowTab.id) ? activeWindowTab.id! : null;
          browserActiveTabIdKnown = browserActiveTabId !== null;
          isReadTargetBrowserActiveTab =
            browserActiveTabIdKnown && Number.isInteger(tabId)
              ? browserActiveTabId === tabId
              : null;
        } catch {
          isCurrentWindowFocused = null;
          currentWindowState = null;
          currentWindowWidth = null;
          currentWindowHeight = null;
          currentWindowLeft = null;
          currentWindowTop = null;
          browserActiveTabId = null;
          browserActiveTabIdKnown = false;
          isReadTargetBrowserActiveTab = null;
        }
      }
      const pageStability = inferPageStability(tab);
      const schemeGuard = inferSchemeGuard(currentUrl);
      const cdpSensingSnapshot = await captureReadPageCDPSensingSummary({
        tabId,
        currentUrl,
        supportedForContentScript: schemeGuard.supportedForContentScript,
      });
      const cdpSensing = cdpSensingSnapshot
        ? buildReadPageCDPSensingSummary(cdpSensingSnapshot)
        : undefined;
      const loadReadiness = buildLoadReadiness({
        pageStability,
        initialTabStatus,
        finalTabStatus: typeof tab.status === 'string' ? tab.status : null,
        waitedForPendingDocument,
        settleResult: pendingDocumentSettleResult,
        cdpSensing,
        cdpStabilityHint: cdpSensingSnapshot?.stabilityHint,
      });

      if (!schemeGuard.supportedForContentScript) {
        const operabilityReason = schemeGuard.unsupportedPageType || schemeGuard.pageType;
        const nextStepHint =
          'restricted_page; switch to a regular http or https tab before attempting structured reads or browser actions';
        const guardPageContent = [
          '- generic "Current tab is not a regular web page"',
          currentTitle ? `- generic "title: ${currentTitle.replace(/\s+/g, ' ').trim()}"` : '',
          currentUrl ? `- generic "url: ${currentUrl}"` : '',
          `- generic "pageType: ${schemeGuard.pageType}"`,
          `- generic "unsupportedPageType: ${schemeGuard.unsupportedPageType || 'none'}"`,
          '- generic "canTabrixOperate: false"',
          `- generic "operabilityReason: ${operabilityReason}"`,
          `- generic "recommendedAction: ${schemeGuard.recommendedAction || 'none'}"`,
        ]
          .filter(Boolean)
          .join('\n');

        const unsupportedModeOutput = await buildModeOutput({
          mode: selectedMode,
          renderMode: selectedRender,
          tabId,
          currentWindowId,
          currentWindowState,
          currentWindowWidth,
          currentWindowHeight,
          currentWindowLeft,
          currentWindowTop,
          isCurrentTabActive,
          isCurrentWindowFocused,
          browserActiveTabId,
          browserActiveTabIdKnown,
          isReadTargetBrowserActiveTab,
          pageStability,
          loadReadiness,
          currentUrl,
          currentTitle,
          pageType: schemeGuard.pageType,
          scheme: schemeGuard.scheme,
          pageRole: 'unknown',
          primaryRegion: null,
          primaryRegionConfidence: null,
          footerOnly: false,
          anchorTexts: [],
          pageContent: guardPageContent,
          visibleTextContent: null,
          contentSummary: summarizePageContent(guardPageContent),
          frameContext: {
            ...(typeof requestedFrameId === 'number' ? { frameId: requestedFrameId } : {}),
            frameScope: 'unknown',
            isTopFrame: null,
            source: 'unsupported_page',
            coverage: 'not_available',
            claimBoundary:
              'content scripts cannot inspect frame context on this unsupported browser page',
          },
          stats: { processed: 0, included: 0, durationMs: 0 },
          viewport: { width: null, height: null, dpr: null },
          filter: filter || 'all',
          depth: requestedDepth ?? null,
          focus: focusRefId ? { refId: focusRefId, found: false } : null,
          sparse: true,
          fallbackUsed: false,
          fallbackSource: null,
          refMapCount: 0,
          markedElements: [],
          elements: [],
          count: 0,
          reason: 'unsupported_page_type',
          tips: standardTips,
          refMap: [],
          candidateActions: [],
          fileInputBindings: [],
          visualElements: [],
          visibleRegionRows: extractVisibleRegionRows({
            pageContent: '',
            sourceRegion: 'unsupported_page',
          }),
          includeAuthArtifacts,
          assistantGuidance,
          requestedLayer: selectedLayer,
        });
        const unsupportedPageContext = {
          ...((unsupportedModeOutput as any).pageContext || {}),
          canTabrixOperate: false,
          operabilityReason,
          unsupportedPageType: schemeGuard.unsupportedPageType,
          nextStepHint,
        };
        const unsupportedOwnershipRuntime = (unsupportedModeOutput as any).ownershipRuntime
          ? {
              ...(unsupportedModeOutput as any).ownershipRuntime,
              currentTabCanTabrixOperate: false,
              currentTabOperabilityReason: operabilityReason,
            }
          : undefined;

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                ...unsupportedModeOutput,
                canTabrixOperate: false,
                operabilityReason,
                reason: 'unsupported_page_type',
                pageType: schemeGuard.pageType,
                scheme: schemeGuard.scheme,
                unsupportedPageType: schemeGuard.unsupportedPageType,
                recommendedAction: schemeGuard.recommendedAction,
                pageContext: unsupportedPageContext,
                ...(unsupportedOwnershipRuntime
                  ? { ownershipRuntime: unsupportedOwnershipRuntime }
                  : {}),
                nextStepHint,
              }),
            },
          ],
          isError: false,
        };
      }

      // Inject helper in ISOLATED world to enable chrome.runtime messaging
      // Inject into all frames to support same-origin iframe operations
      await this.injectContentScript(
        tabId,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        typeof requestedFrameId === 'number' ? false : true,
        typeof requestedFrameId === 'number' ? [requestedFrameId] : undefined,
      );

      // Ask content script to generate accessibility tree
      let resp = await this.generateAccessibilityTreeWithRetry(
        tabId,
        {
          action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
          filter: filter || null,
          depth: requestedDepth,
          refId: focusRefId || undefined,
        },
        requestedFrameId,
      );

      // Evaluate tree result and decide whether to fallback
      const treeOk = resp && resp.success === true;
      let pageContent: string =
        resp && typeof resp.pageContent === 'string' ? resp.pageContent : '';
      let lines = pageContent
        ? pageContent.split('\n').filter((l: string) => l.trim().length > 0).length
        : 0;
      let refCount = Array.isArray(resp?.refMap) ? resp.refMap.length : 0;
      let isSparse = !userControlled && lines < 10 && refCount < 3;

      if (treeOk && isSparse) {
        await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
        const retryResp = await this.generateAccessibilityTreeWithRetry(
          tabId,
          {
            action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
            filter: filter || null,
            depth: requestedDepth,
            refId: focusRefId || undefined,
          },
          requestedFrameId,
        );
        const retryContent =
          retryResp && typeof retryResp.pageContent === 'string' ? retryResp.pageContent : '';
        const retryLines = retryContent
          ? retryContent.split('\n').filter((l: string) => l.trim().length > 0).length
          : 0;
        const retryRefCount = Array.isArray(retryResp?.refMap) ? retryResp.refMap.length : 0;
        if (retryResp?.success === true && retryLines + retryRefCount > lines + refCount) {
          resp = retryResp;
          pageContent = retryContent;
          lines = retryLines;
          refCount = retryRefCount;
          isSparse = !userControlled && lines < 10 && refCount < 3;
        }
      }

      const pageUnderstanding = inferPageUnderstanding(currentUrl, currentTitle, pageContent);
      const treeInteractiveElements = buildInteractiveElements(
        pageContent,
        [],
        selectedMode === 'compact' ? 24 : 80,
        selectedMode,
        currentUrl,
      );
      const rowLinkingInteractiveElements =
        selectedMode === 'compact'
          ? buildInteractiveElements(pageContent, [], 80, 'compact', currentUrl)
          : treeInteractiveElements;

      // Extract stats from response
      const stats: ReadPageStats | null =
        treeOk && resp?.stats
          ? {
              processed: resp.stats.processed ?? 0,
              included: resp.stats.included ?? 0,
              durationMs: resp.stats.durationMs ?? 0,
            }
          : null;

      const contentSummary = summarizePageContent(pageContent);
      const sensingDiagnostics = treeOk
        ? normalizeAccessibilityTreeDiagnostics(resp?.diagnostics, resp?.stats)
        : undefined;

      // User markers have been removed with the Element Marker surface
      // (MKEP pruning §P7). Keep the field on the payload as an empty
      // array to preserve the outbound contract that downstream consumers
      // (telemetry, prompt builder) still reference.
      const markedElements: any[] = [];

      // Unified base payload structure - consistent keys for stable contract
      const basePayload: Record<string, any> = {
        success: true,
        mode: selectedMode,
        filter: filter || 'all',
        pageContent,
        visibleTextContent: null,
        contentSummary,
        tips: standardTips,
        viewport: treeOk ? resp.viewport : { width: null, height: null, dpr: null },
        stats: stats || { processed: 0, included: 0, durationMs: 0 },
        refMapCount: refCount,
        sparse: treeOk ? isSparse : false,
        pageType: schemeGuard.pageType,
        scheme: schemeGuard.scheme,
        pageRole: pageUnderstanding.pageRole,
        primaryRegion: pageUnderstanding.primaryRegion,
        primaryRegionConfidence: pageUnderstanding.primaryRegionConfidence,
        footerOnly: pageUnderstanding.footerOnly,
        anchorTexts: pageUnderstanding.anchorTexts,
        depth: requestedDepth ?? null,
        focus: focusRefId ? { refId: focusRefId, found: treeOk } : null,
        markedElements,
        elements: [],
        count: 0,
        fallbackUsed: false,
        fallbackSource: null,
        reason: null,
        refMap: Array.isArray(resp?.refMap) ? resp.refMap : [],
        candidateActions: [],
        visualElements: [],
        visibleRegionRows: extractVisibleRegionRows({
          pageContent,
          sourceRegion: pageUnderstanding.primaryRegion,
          fallbackInteractiveElements: rowLinkingInteractiveElements,
          url: currentUrl,
          title: currentTitle,
          viewport: treeOk ? resp.viewport : null,
          scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
          pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
        }),
        frameContext: treeOk ? normalizeFrameContext(resp?.frameContext, requestedFrameId) : null,
        sensingDiagnostics,
      };
      reconcilePageUnderstandingWithVisibleRows(basePayload);

      if (
        shouldSampleVisibleText({
          treeOk,
          userControlled,
          mode: selectedMode,
          requestedDepth,
          focusRefId,
          rows: basePayload.visibleRegionRows,
          pageRole: pageUnderstanding.pageRole,
          assistantGuidance,
        }) &&
        !basePayload.visibleTextContent
      ) {
        const visibleTextContent = await this.sampleVisibleTextContent(tabId, requestedFrameId);
        if (visibleTextContent) {
          basePayload.visibleTextContent = visibleTextContent;
          if (!basePayload.visibleRegionRows.visibleRegionRowsUsed) {
            const visibleTextRows = extractVisibleRegionRows({
              pageContent: String(basePayload.pageContent || ''),
              visibleTextContent,
              sourceRegion: pageUnderstanding.primaryRegion,
              fallbackInteractiveElements: rowLinkingInteractiveElements,
              url: currentUrl,
              title: currentTitle,
              viewport: basePayload.viewport,
              scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
              pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
            });
            if (visibleTextRows.visibleRegionRowsUsed) {
              basePayload.visibleRegionRows = visibleTextRows;
              basePayload.fallbackSource = 'visible_text';
              reconcilePageUnderstandingWithVisibleRows(basePayload);
            }
          }
        }
      }
      await this.repairVisibleRowsTargetRefs({
        tabId,
        basePayload,
        pageUnderstanding,
        currentUrl,
        currentTitle,
        frameId: requestedFrameId,
      });

      if (
        treeOk &&
        !focusRefId &&
        !isSparse &&
        treeInteractiveElements.length < 3 &&
        !basePayload.fallbackUsed
      ) {
        const fallback = await this.collectInteractiveElementsFallback(tabId, {
          frameId: requestedFrameId,
        });
        if (fallback && fallback.elements.length > treeInteractiveElements.length) {
          const merged = fallback.elements.slice(0, 150);
          const fallbackRefMap = buildFallbackRefMap(merged);
          const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'interactive_shell_supplement';
          basePayload.elements = mergedWithRefs;
          basePayload.count = fallback.elements.length;
          basePayload.refMap =
            Array.isArray(basePayload.refMap) && basePayload.refMap.length > 0
              ? [...basePayload.refMap, ...fallbackRefMap]
              : fallbackRefMap;
          basePayload.refMapCount = basePayload.refMap.filter(
            (entry: unknown) => entry != null,
          ).length;
        }
      }

      await this.recoverGlobalMenuTextTargets({ tabId, basePayload, frameId: requestedFrameId });
      await this.recoverVisibleTextControlTargets({
        tabId,
        basePayload,
        frameId: requestedFrameId,
      });
      await this.recoverSearchToolbarTextTargets({
        tabId,
        basePayload,
        assistantGuidance,
        frameId: requestedFrameId,
      });
      await this.recoverFilterPanelTextTargets({
        tabId,
        basePayload,
        assistantGuidance,
        frameId: requestedFrameId,
      });
      const visibleSearchSurfaceActions = await this.collectVisibleSearchSurfaceActions({
        tabId,
        currentUrl,
        assistantGuidance,
        pageRole: basePayload.pageRole,
      });
      if (visibleSearchSurfaceActions.sensingDiagnostic) {
        basePayload.sensingDiagnostics = appendObjectSensingDiagnostic(
          basePayload.sensingDiagnostics,
          visibleSearchSurfaceActions.sensingDiagnostic,
        );
      }
      if (visibleSearchSurfaceActions.actions.length > 0) {
        basePayload.candidateActions = mergeVisibleSearchSurfaceActions(
          basePayload.candidateActions,
          visibleSearchSurfaceActions.actions,
        );
        basePayload.fallbackSource = basePayload.fallbackSource
          ? `${basePayload.fallbackSource}+visible_search_surface_actions`
          : 'visible_search_surface_actions';
      }
      await this.supplementAuthFormInteractiveControls(tabId, basePayload, requestedFrameId);
      basePayload.visualElements = await this.collectQrVisualElements({
        tabId,
        pageContent: String(basePayload.pageContent || ''),
        visibleTextContent: basePayload.visibleTextContent,
        frameId: requestedFrameId,
      });
      basePayload.fileInputBindings = await collectReadPageFileInputBindings(
        tabId,
        requestedFrameId,
      );

      // Normal path: return tree when the tree is sufficiently rich or the
      // visible-text fallback has already recovered business rows.
      if (treeOk && (!isSparse || basePayload.visibleRegionRows.visibleRegionRowsUsed)) {
        const modePayload = await buildModeOutput({
          mode: selectedMode,
          renderMode: selectedRender,
          tabId,
          currentWindowId,
          currentWindowState,
          currentWindowWidth,
          currentWindowHeight,
          currentWindowLeft,
          currentWindowTop,
          isCurrentTabActive,
          isCurrentWindowFocused,
          browserActiveTabId,
          browserActiveTabIdKnown,
          isReadTargetBrowserActiveTab,
          pageStability,
          loadReadiness,
          currentUrl,
          currentTitle,
          pageType: schemeGuard.pageType,
          scheme: schemeGuard.scheme,
          pageRole: basePayload.pageRole,
          primaryRegion: basePayload.primaryRegion,
          primaryRegionConfidence: basePayload.primaryRegionConfidence,
          footerOnly: basePayload.footerOnly,
          anchorTexts: basePayload.anchorTexts,
          pageContent: basePayload.pageContent,
          visibleTextContent: basePayload.visibleTextContent,
          contentSummary: basePayload.contentSummary,
          frameContext: basePayload.frameContext,
          stats: basePayload.stats,
          viewport: basePayload.viewport,
          filter: basePayload.filter,
          depth: basePayload.depth,
          focus: basePayload.focus,
          sparse: basePayload.sparse,
          fallbackUsed: basePayload.fallbackUsed,
          fallbackSource: basePayload.fallbackSource,
          refMapCount: basePayload.refMapCount,
          markedElements: basePayload.markedElements,
          elements: basePayload.elements,
          count: basePayload.count,
          reason: basePayload.reason,
          tips: basePayload.tips,
          refMap: basePayload.refMap,
          candidateActions: basePayload.candidateActions,
          fileInputBindings: basePayload.fileInputBindings,
          visualElements: basePayload.visualElements,
          visibleRegionRows: basePayload.visibleRegionRows,
          sensingDiagnostics: basePayload.sensingDiagnostics,
          includeAuthArtifacts,
          assistantGuidance,
          requestedLayer: selectedLayer,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(modePayload) }],
          isError: false,
        };
      }

      // When refId is explicitly provided, do not fallback (refs are frame-local and may expire)
      if (focusRefId) {
        return createErrorResponse(resp?.error || `refId "${focusRefId}" not found or expired`);
      }

      // When user explicitly controls depth, do not override with fallback heuristics
      if (requestedDepth !== undefined) {
        return createErrorResponse(resp?.error || 'Failed to generate accessibility tree');
      }

      // Fallback path: try get_interactive_elements with one short retry.
      // Newly opened MV3 pages can report document complete before the
      // injected helper is ready to answer its first runtime message.
      try {
        const fallback = await this.collectInteractiveElementsFallback(tabId, {
          frameId: requestedFrameId,
        });

        if (fallback) {
          const merged = fallback.elements.slice(0, 150);
          const fallbackRefMap = buildFallbackRefMap(merged);
          const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
          const fallbackRefEntryCount = fallbackRefMap.filter((entry) => entry != null).length;

          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'get_interactive_elements';
          basePayload.reason = treeOk ? 'sparse_tree' : resp?.error || 'tree_failed';
          basePayload.elements = mergedWithRefs;
          basePayload.count = fallback.elements.length;
          basePayload.refMap = fallbackRefMap;
          basePayload.refMapCount = fallbackRefEntryCount;
          if (mergedWithRefs.length > 0 || !basePayload.pageContent) {
            basePayload.pageContent = formatElementsAsPageContent(mergedWithRefs, fallbackRefMap);
          }
          const fallbackUnderstanding = inferPageUnderstanding(
            currentUrl,
            currentTitle,
            String(basePayload.pageContent || ''),
          );
          basePayload.pageRole = fallbackUnderstanding.pageRole;
          basePayload.primaryRegion = fallbackUnderstanding.primaryRegion;
          basePayload.primaryRegionConfidence = fallbackUnderstanding.primaryRegionConfidence;
          basePayload.footerOnly = fallbackUnderstanding.footerOnly;
          basePayload.anchorTexts = fallbackUnderstanding.anchorTexts;
          basePayload.visibleRegionRows = extractVisibleRegionRows({
            pageContent: String(basePayload.pageContent || ''),
            sourceRegion: fallbackUnderstanding.primaryRegion,
            fallbackInteractiveElements: mergedWithRefs,
            url: currentUrl,
            title: currentTitle,
            viewport: basePayload.viewport,
            scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
            pixelsBelow: typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
          });
          if (!basePayload.visibleRegionRows.visibleRegionRowsUsed) {
            const visibleTextContent = await this.sampleVisibleTextContent(tabId, requestedFrameId);
            if (visibleTextContent) {
              basePayload.visibleTextContent = visibleTextContent;
              basePayload.visibleRegionRows = extractVisibleRegionRows({
                pageContent: String(basePayload.pageContent || ''),
                visibleTextContent,
                sourceRegion: fallbackUnderstanding.primaryRegion,
                fallbackInteractiveElements: mergedWithRefs,
                url: currentUrl,
                title: currentTitle,
                viewport: basePayload.viewport,
                scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
                pixelsBelow:
                  typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
              });
            }
          }
          reconcilePageUnderstandingWithVisibleRows(basePayload);
          await this.recoverGlobalMenuTextTargets({
            tabId,
            basePayload,
            frameId: requestedFrameId,
          });
          await this.recoverVisibleTextControlTargets({
            tabId,
            basePayload,
            frameId: requestedFrameId,
          });
          await this.recoverSearchToolbarTextTargets({
            tabId,
            basePayload,
            assistantGuidance,
            frameId: requestedFrameId,
          });
          await this.recoverFilterPanelTextTargets({
            tabId,
            basePayload,
            assistantGuidance,
            frameId: requestedFrameId,
          });
          const visibleSearchSurfaceActions = await this.collectVisibleSearchSurfaceActions({
            tabId,
            currentUrl,
            assistantGuidance,
            pageRole: basePayload.pageRole,
          });
          if (visibleSearchSurfaceActions.sensingDiagnostic) {
            basePayload.sensingDiagnostics = appendObjectSensingDiagnostic(
              basePayload.sensingDiagnostics,
              visibleSearchSurfaceActions.sensingDiagnostic,
            );
          }
          if (visibleSearchSurfaceActions.actions.length > 0) {
            basePayload.candidateActions = mergeVisibleSearchSurfaceActions(
              basePayload.candidateActions,
              visibleSearchSurfaceActions.actions,
            );
            basePayload.fallbackSource = basePayload.fallbackSource
              ? `${basePayload.fallbackSource}+visible_search_surface_actions`
              : 'visible_search_surface_actions';
          }
          basePayload.visualElements = await this.collectQrVisualElements({
            tabId,
            pageContent: String(basePayload.pageContent || ''),
            visibleTextContent: basePayload.visibleTextContent,
            frameId: requestedFrameId,
          });
          basePayload.fileInputBindings = await collectReadPageFileInputBindings(
            tabId,
            requestedFrameId,
          );

          const modePayload = await buildModeOutput({
            mode: selectedMode,
            renderMode: selectedRender,
            tabId,
            currentWindowId,
            currentWindowState,
            currentWindowWidth,
            currentWindowHeight,
            currentWindowLeft,
            currentWindowTop,
            isCurrentTabActive,
            isCurrentWindowFocused,
            browserActiveTabId,
            browserActiveTabIdKnown,
            isReadTargetBrowserActiveTab,
            pageStability,
            loadReadiness,
            currentUrl,
            currentTitle,
            pageType: schemeGuard.pageType,
            scheme: schemeGuard.scheme,
            pageRole: basePayload.pageRole,
            primaryRegion: basePayload.primaryRegion,
            primaryRegionConfidence: basePayload.primaryRegionConfidence,
            footerOnly: basePayload.footerOnly,
            anchorTexts: basePayload.anchorTexts,
            pageContent: basePayload.pageContent,
            visibleTextContent: basePayload.visibleTextContent,
            contentSummary: summarizePageContent(String(basePayload.pageContent || '')),
            frameContext: basePayload.frameContext,
            stats: basePayload.stats,
            viewport: basePayload.viewport,
            filter: basePayload.filter,
            depth: basePayload.depth,
            focus: basePayload.focus,
            sparse: basePayload.sparse,
            fallbackUsed: basePayload.fallbackUsed,
            fallbackSource: basePayload.fallbackSource,
            refMapCount: basePayload.refMapCount,
            markedElements: basePayload.markedElements,
            elements: basePayload.elements,
            count: basePayload.count,
            reason: basePayload.reason,
            tips: basePayload.tips,
            refMap: basePayload.refMap,
            candidateActions: basePayload.candidateActions,
            fileInputBindings: basePayload.fileInputBindings,
            visualElements: basePayload.visualElements,
            visibleRegionRows: basePayload.visibleRegionRows,
            sensingDiagnostics: basePayload.sensingDiagnostics,
            includeAuthArtifacts,
            assistantGuidance,
            requestedLayer: selectedLayer,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(modePayload) }],
            isError: false,
          };
        }
      } catch (fallbackErr) {
        console.warn('read_page fallback failed:', fallbackErr);
      }

      // If we reach here, both tree (usable) and fallback failed
      return createErrorResponse(
        treeOk
          ? 'Accessibility tree is too sparse and fallback failed'
          : resp?.error || 'Failed to generate accessibility tree and fallback failed',
      );
    } catch (error) {
      console.error('Error in read page tool:', error);
      const classified = this.classifyContentScriptError(error);
      if (classified) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                reason: classified.reason,
                pageType: 'browser_error_page',
                recommendedAction: classified.recommendedAction,
                error: classified.message,
                nextStepHint:
                  'page_unreadable; return BLOCKED or retry navigation before attempting structured reads',
              }),
            },
          ],
          isError: false,
        };
      }
      return createErrorResponse(
        `Error generating accessibility tree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const readPageTool = new ReadPageTool();
