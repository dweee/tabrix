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
  type ReadPageEvidenceSource,
  type ReadPageObservationCoverage,
  type ReadPageObservationProfile,
  type ReadPagePageContext,
  type ReadPageLoadReadiness,
  type ReadPageCDPSensingSummary,
  type ReadPagePageType,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRenderMode,
  type ReadPageRequestedLayer,
  type ReadPageSearchSurface,
  type ReadPageOwnershipRuntimeSummary,
  type ReadPageWindowRuntimeState,
  type ReadPageObjectLifecycleSummary,
  type ReadPageBrowserPageObjectView,
  type ReadPageRegion,
  type BrowserPageThingProjection,
  type BrowserPageOwnerType,
  type ReadPageAssistantGuidance,
  type ReadPageFileInputBinding,
  type ReadPagePublishFormReadiness,
  type ReadPagePublishFormRequiredFieldEvidence,
  type ReadPageHighValueObject,
  type ReadPageHighValueObjectAction,
  type ReadPageObjectSnapshot,
  type ReadPagePageDeltaReport,
  type ReadPageObjectSummary,
  type ReadPageActionableTargetSummary,
  type ReadPageBrowserPageObjectWatchStatus,
  type ReadPageReadinessVerdict,
  READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  buildReadPageBrowserPageObjectView,
  buildBrowserPageThingProjectionFromReadPage,
  buildReadPageObjectLifecycle,
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
  buildSearchSurface,
  extractFilterPanelLabelsFromVisibleText,
  extractSearchToolbarLabelsFromVisibleText,
} from './read-page-search-surface';
import { buildArtifactRefs } from './read-page-artifact-refs';
import { buildFallbackRefMap, formatElementsAsPageContent } from './read-page-fallback-format';
import { buildPageOperationMap } from './read-page-operation-map';
import { buildExtensionLayer, buildStableSnapshotLayer } from './read-page-snapshot-builders';
import { buildReadPageModeResult } from './read-page-mode-result';
import {
  buildAuthCollaborationState,
  buildAuthQrArtifactRefs,
  buildNotRequestedAuthArtifactStatus,
} from './read-page-auth-artifacts';
import { extractVisibleRegionRows, type VisibleRegionRowsResult } from './visible-region-rows';
import {
  extractGlobalMenuLabelsForTargetRecovery,
  type ReadPageVisualElementHint,
} from './read-page-task-protocol';
import {
  captureCDPPageSensingSnapshot,
  type CDPPageSensingSnapshot,
} from '@/utils/cdp-page-sensing';
import {
  getBrowserWorldSnapshot,
  markBrowserWorldTabAiOperated,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}
type PageType = ReadPagePageType;
type PrimaryRegionConfidence = ReadPagePrimaryRegionConfidence;

interface RegionAlignedPageUnderstanding {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: PrimaryRegionConfidence;
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
const VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD = 0.95;
const OBJECT_LIFECYCLE_CACHE_MAX_TABS = 64;
const QR_VISUAL_ELEMENT_SELECTOR = [
  '[class*="qr"]',
  '[class*="QR"]',
  '[class*="qrcode"]',
  '[class*="QRCode"]',
  '[aria-label*="qr"]',
  '[aria-label*="QR"]',
  '[aria-label*="二维码"]',
  '[alt*="qr"]',
  '[alt*="QR"]',
  '[alt*="二维码"]',
  '[title*="qr"]',
  '[title*="QR"]',
  '[title*="二维码"]',
  'canvas',
  'img',
].join(', ');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const objectLifecycleByTab = new Map<
  number,
  {
    url: string;
    lifecycle: ReadPageObjectLifecycleSummary;
    pageProjection: BrowserPageThingProjection | null;
    ownershipRuntime: ReadPageOwnershipRuntimeSummary | null;
  }
>();

const pageObjectSnapshotByTab = new Map<
  number,
  {
    pageObjectSnapshot: ReadPageObjectSnapshot;
    pageObjectDeltaSignals?: {
      networkStartedCount?: number;
      failedRequestCount?: number;
      errorCount?: number;
      warningCount?: number;
    };
  }
>();

function mapReadinessVerdict(input: {
  canUseSnapshotForBusinessAction: boolean;
  status: ReadPageLoadReadiness['status'];
}): ReadPageReadinessVerdict {
  if (input.canUseSnapshotForBusinessAction) return 'ready';
  if (input.status === 'stale') return 'blocked';
  return 'unknown';
}

function mapPageStabilityToWatchStatus(
  pageStability: BrowserPageStability,
): ReadPageBrowserPageObjectWatchStatus | null {
  if (pageStability === 'stable') return 'stable_or_unknown';
  if (pageStability === 'loading') return 'runtime_degraded';
  if (pageStability === 'changing') return 'runtime_transition_candidate';
  if (pageStability === 'stale') return 'changed_without_target_transition';
  return 'stable_or_unknown';
}

function collectSourceProvenance(params: {
  includeCDP: boolean;
  includeVisibleText: boolean;
  includeAX: boolean;
}): ReadPageObjectSnapshot['sourceProvenance'] {
  const sources = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>(['dom']);
  if (params.includeCDP) sources.add('cdp');
  if (params.includeVisibleText) sources.add('visible_text');
  if (params.includeAX) sources.add('ax');
  return [...sources];
}

function buildReadPageSnapshotSourceStats(params: {
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
}): ReadPageObjectSnapshot {
  const regionList = Array.isArray(params.pageRegions) ? params.pageRegions : [];
  const actionList = Array.isArray(params.candidateActions) ? params.candidateActions : [];
  const regionSources = collectSourceProvenance({
    includeCDP: Boolean(
      params.cdpSensing?.accessibility ||
      params.cdpSensing?.networkActivity ||
      params.cdpSensing?.console,
    ),
    includeVisibleText: Boolean(
      params.visibleTextContent && String(params.visibleTextContent).trim().length > 0,
    ),
    includeAX: Boolean(params.cdpSensing?.accessibility),
  });
  const objects: ReadPageObjectSummary[] = regionList.map((region, index) => {
    const objectSourceProvenance = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>(
      regionSources,
    );
    if (typeof region.label === 'string' && region.label.length > 0) {
      objectSourceProvenance.add('visible_text');
    }
    if (typeof region.reason === 'string' && region.reason.length > 0) {
      objectSourceProvenance.add('visible_text');
    }
    return {
      objectId:
        region.regionId ||
        `${params.pageType}-${params.pageRole}-${region.regionType || 'region'}-${index}`,
      kind: region.regionType || 'region',
      label: region.label || region.regionId || `${region.regionType || 'region'}-${index}`,
      regionType: region.regionType ?? null,
      sourceProvenance: [...objectSourceProvenance],
      freshness: 'fresh',
    };
  });
  const actionableTargets: ReadPageActionableTargetSummary[] = actionList.map((action) => ({
    targetId:
      action.id ??
      `${params.pageType}-${params.pageRole}-target-${action.targetRef ?? 'unknown'}-${action.actionType || 'unknown'}`,
    label: action.label || action.targetRef || action.id || 'candidate_action',
    kind: (action.actionType || 'click') as ReadPageActionableTargetSummary['kind'],
    targetRef: action.targetRef,
    ref: action.targetRef,
    sourceProvenance: action.locatorChain?.length ? 'dom' : 'unknown',
    freshness: 'fresh',
    ...(action.actionType === 'fill' ? { objectId: action.targetRef } : {}),
  }));

  return {
    source: 'read_page_object_snapshot',
    snapshotId: `rpos_${params.tabId}_${Date.now()}`,
    observedAt: new Date().toISOString(),
    pageUrl: params.currentUrl,
    pageTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    pageState: {
      pageStability: mapPageStabilityToWatchStatus(params.pageStability),
      readiness: mapReadinessVerdict(params.loadReadiness),
      baseUrl: (() => {
        try {
          return new URL(params.currentUrl).hostname || params.currentUrl;
        } catch {
          return params.currentUrl;
        }
      })(),
      frameCount:
        typeof params.cdpSensing?.frameCount === 'number' ? params.cdpSensing.frameCount : null,
    },
    sourceProvenance: [...regionSources],
    freshness: 'fresh',
    objects,
    actionableTargets,
    objectCount: objects.length,
    actionableObjectCount: actionableTargets.length,
    claimBoundary:
      'read_page_object_snapshot is object-awareness summary only; not business success proof',
  };
}

function buildReadPagePageDeltaReport(params: {
  tabId: number;
  currentSnapshot: ReadPageObjectSnapshot;
  previousSnapshot: ReadPageObjectSnapshot | null;
  cdpSignals?: {
    networkStartedCount?: number;
    failedRequestCount?: number;
    errorCount?: number;
    warningCount?: number;
  };
  previousCdpSignals?: {
    networkStartedCount?: number;
    failedRequestCount?: number;
    errorCount?: number;
    warningCount?: number;
  };
}): ReadPagePageDeltaReport | undefined {
  if (!params.previousSnapshot) return undefined;

  const previous = params.previousSnapshot;
  const beforeObjectIds = new Set(previous.objects.map((object) => object.objectId));
  const afterObjectIds = new Set(params.currentSnapshot.objects.map((object) => object.objectId));
  const appearedObjectIds = [...afterObjectIds].filter((id) => !beforeObjectIds.has(id));
  const disappearedObjectIds = [...beforeObjectIds].filter((id) => !afterObjectIds.has(id));
  const objectDelta = [...appearedObjectIds, ...disappearedObjectIds];
  const changedRegions = Array.isArray(params.currentSnapshot.objects)
    ? params.currentSnapshot.objects
        .map((object) => object.regionType)
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  const changedObjectSummary = objectDelta.length;
  let deltaKind: ReadPagePageDeltaReport['deltaKind'] = 'no_useful_change';
  let recommendation: ReadPagePageDeltaReport['recommendation'] = 'wait';

  if (params.currentSnapshot.pageUrl !== previous.pageUrl) {
    deltaKind = 'url_changed';
    recommendation = 'proceed';
  } else if (changedObjectSummary > 0) {
    deltaKind = 'object_appeared';
    recommendation = 'proceed';
  }

  return {
    source: 'read_page_delta_report',
    actionId: null,
    targetObjectId: null,
    beforeSnapshotId: previous.snapshotId,
    afterSnapshotId: params.currentSnapshot.snapshotId,
    beforeObservedAt: previous.observedAt,
    afterObservedAt: params.currentSnapshot.observedAt,
    deltaKind,
    changedRegions: changedRegions.length > 0 ? changedRegions : ['read_page_object_snapshot'],
    changedObjects: objectDelta,
    ...(typeof params.previousCdpSignals?.networkStartedCount === 'number' &&
    typeof params.cdpSignals?.networkStartedCount === 'number'
      ? {
          networkSignals: {
            requestStartedDelta:
              params.cdpSignals.networkStartedCount - params.previousCdpSignals.networkStartedCount,
            failedRequestDelta:
              (params.cdpSignals.failedRequestCount ?? 0) -
              (params.previousCdpSignals.failedRequestCount ?? 0),
          },
        }
      : {}),
    ...(typeof params.previousCdpSignals?.errorCount === 'number' &&
    typeof params.cdpSignals?.errorCount === 'number'
      ? {
          consoleSignals: {
            errorCountDelta: params.cdpSignals.errorCount - params.previousCdpSignals.errorCount,
            warningCountDelta:
              (params.cdpSignals.warningCount ?? 0) - (params.previousCdpSignals.warningCount ?? 0),
          },
        }
      : {}),
    recommendation,
    claimBoundary:
      'delta is read-only object-presence change evidence; AI must still verify postcondition.',
  };
}

function rememberObjectLifecycleSnapshot(
  tabId: number,
  url: string,
  lifecycle: ReadPageObjectLifecycleSummary,
  pageProjection: BrowserPageThingProjection | null,
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null,
): void {
  if (!Number.isFinite(tabId)) return;
  objectLifecycleByTab.delete(tabId);
  objectLifecycleByTab.set(tabId, { url, lifecycle, pageProjection, ownershipRuntime });
  while (objectLifecycleByTab.size > OBJECT_LIFECYCLE_CACHE_MAX_TABS) {
    const firstKey = objectLifecycleByTab.keys().next().value;
    if (firstKey === undefined) break;
    objectLifecycleByTab.delete(firstKey);
  }
}

function rememberPageObjectSnapshot(
  tabId: number,
  snapshot: ReadPageObjectSnapshot,
  telemetry?: {
    networkStartedCount?: number;
    failedRequestCount?: number;
    errorCount?: number;
    warningCount?: number;
  },
): void {
  if (!Number.isFinite(tabId)) return;
  pageObjectSnapshotByTab.delete(tabId);
  pageObjectSnapshotByTab.set(tabId, {
    pageObjectSnapshot: snapshot,
    pageObjectDeltaSignals: telemetry,
  });
  while (pageObjectSnapshotByTab.size > OBJECT_LIFECYCLE_CACHE_MAX_TABS) {
    const firstKey = pageObjectSnapshotByTab.keys().next().value;
    if (firstKey === undefined) break;
    pageObjectSnapshotByTab.delete(firstKey);
  }
}

function getPreviousPageObjectSnapshot(tabId: number): {
  snapshot: ReadPageObjectSnapshot;
  telemetry?: {
    networkStartedCount?: number;
    failedRequestCount?: number;
    errorCount?: number;
    warningCount?: number;
  };
} | null {
  const previous = pageObjectSnapshotByTab.get(tabId);
  return previous
    ? {
        snapshot: { ...previous.pageObjectSnapshot },
        telemetry: previous.pageObjectDeltaSignals
          ? { ...previous.pageObjectDeltaSignals }
          : undefined,
      }
    : null;
}

function buildBoundedWatchLoopSnapshot(params: {
  tabId: number;
  url: string;
  pageRegions: ReadPageCompactSnapshot['pageRegions'];
  lifecycle: ReadPageObjectLifecycleSummary;
  pageProjection: BrowserPageThingProjection | null;
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null;
}): {
  objectLifecycle: ReadPageObjectLifecycleSummary;
  previousPageProjection: BrowserPageThingProjection | null;
  previousOwnershipRuntime: ReadPageOwnershipRuntimeSummary | null;
} {
  const currentSingleSnapshot = params.lifecycle;
  const previous = objectLifecycleByTab.get(params.tabId);
  rememberObjectLifecycleSnapshot(
    params.tabId,
    params.url,
    currentSingleSnapshot,
    params.pageProjection,
    params.ownershipRuntime,
  );
  if (!previous || previous.url !== params.url || !Array.isArray(params.pageRegions)) {
    return {
      objectLifecycle: currentSingleSnapshot,
      previousPageProjection: null,
      previousOwnershipRuntime: null,
    };
  }
  return {
    objectLifecycle: buildReadPageObjectLifecycle(params.pageRegions, {
      previous: previous.lifecycle,
    }),
    previousPageProjection: previous.pageProjection,
    previousOwnershipRuntime: previous.ownershipRuntime,
  };
}

function resetObjectLifecycleCacheForTests(): void {
  objectLifecycleByTab.clear();
  pageObjectSnapshotByTab.clear();
}

function getTabNavigationUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return String(tab.url || tab.pendingUrl || '');
}

function normalizeFrameContext(
  raw: unknown,
  requestedFrameId?: number,
): ReadPageFrameContext | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;
  const frameScope =
    input.frameScope === 'top' || input.frameScope === 'subframe' ? input.frameScope : 'unknown';
  const frameId =
    typeof input.frameId === 'number'
      ? input.frameId
      : typeof requestedFrameId === 'number'
        ? requestedFrameId
        : undefined;
  return {
    ...(typeof frameId === 'number' ? { frameId } : {}),
    frameUrl: typeof input.frameUrl === 'string' ? input.frameUrl : '',
    frameName: typeof input.frameName === 'string' ? input.frameName : '',
    frameScope,
    isTopFrame: typeof input.isTopFrame === 'boolean' ? input.isTopFrame : null,
    source: input.source === 'content_script_runtime' ? 'content_script_runtime' : 'not_available',
    coverage:
      input.coverage === 'responding_frame_only' ? 'responding_frame_only' : 'not_available',
    claimBoundary:
      typeof input.claimBoundary === 'string'
        ? input.claimBoundary
        : 'read_page frame context was unavailable; do not assume iframe coverage',
  };
}

function normalizeAssistantGuidance(raw: unknown): ReadPageAssistantGuidance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const guidance: ReadPageAssistantGuidance = {
    claimBoundary:
      'assistant guidance is a closed-enum observation hint only; Tabrix remains eyes/hands and does not plan or prove task success',
  };
  if (
    typeof input.taskKind === 'string' &&
    (READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES as readonly string[]).includes(input.taskKind)
  ) {
    guidance.taskKind = input.taskKind as ReadPageAssistantGuidance['taskKind'];
  }
  if (
    typeof input.authPreference === 'string' &&
    (READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES as readonly string[]).includes(
      input.authPreference,
    )
  ) {
    guidance.authPreference = input.authPreference as ReadPageAssistantGuidance['authPreference'];
  }
  if (Array.isArray(input.requestedObjects)) {
    const requestedObjects = input.requestedObjects
      .filter(
        (value): value is NonNullable<ReadPageAssistantGuidance['requestedObjects']>[number] =>
          typeof value === 'string' &&
          (READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES as readonly string[]).includes(
            value,
          ),
      )
      .slice(0, 8);
    if (requestedObjects.length > 0) guidance.requestedObjects = [...new Set(requestedObjects)];
  }
  const target =
    input.assistantProvidedTarget &&
    typeof input.assistantProvidedTarget === 'object' &&
    !Array.isArray(input.assistantProvidedTarget)
      ? (input.assistantProvidedTarget as Record<string, unknown>)
      : null;
  if (target) {
    const purpose =
      typeof target.purpose === 'string' &&
      ['auth_qr_image', 'click', 'fill', 'observe'].includes(target.purpose)
        ? target.purpose
        : undefined;
    const targetRef =
      typeof target.targetRef === 'string' &&
      /^(?:ref|tgt)_[A-Za-z0-9:_-]{1,80}$/.test(target.targetRef)
        ? target.targetRef
        : undefined;
    const selector =
      typeof target.selector === 'string' && target.selector.trim().length > 0
        ? target.selector.trim().slice(0, 500)
        : undefined;
    const frameId =
      typeof target.frameId === 'number' && Number.isInteger(target.frameId) && target.frameId >= 0
        ? target.frameId
        : undefined;
    if (purpose || targetRef || selector || typeof frameId === 'number') {
      guidance.assistantProvidedTarget = {
        ...(purpose ? { purpose } : {}),
        ...(targetRef ? { targetRef } : {}),
        ...(selector ? { selector } : {}),
        ...(typeof frameId === 'number' ? { frameId } : {}),
      };
    }
  }
  return Object.keys(guidance).length > 1 ? guidance : undefined;
}

/**
 * Infer page stability from tab properties.
 * Returns 'loading' when the document is still loading,
 * 'stale' when the tab has been discarded or unloaded,
 * 'stable' when the page is fully loaded and interactive.
 */
function inferPageStability(tab: { status?: string; discarded?: boolean }): BrowserPageStability {
  if (tab.discarded === true) return 'stale';
  if (tab.status === 'loading') return 'loading';
  if (tab.status === 'unloaded') return 'stale';
  return 'stable';
}

function buildLoadReadiness(input: {
  pageStability: BrowserPageStability;
  initialTabStatus: string | null;
  finalTabStatus: string | null;
  waitedForPendingDocument: boolean;
  settleResult: {
    settled: boolean;
    timedOut: boolean;
    reason: string;
    waitedMs: number;
    readyState: string | null;
  } | null;
  cdpSensing?: ReadPageCDPSensingSummary;
}): ReadPageLoadReadiness {
  const stableAfterWait =
    input.waitedForPendingDocument &&
    input.settleResult?.settled === true &&
    input.pageStability === 'stable';
  const stableWithoutWait = !input.waitedForPendingDocument && input.pageStability === 'stable';
  const stale = input.pageStability === 'stale';
  const loading =
    input.pageStability === 'loading' ||
    input.pageStability === 'changing' ||
    input.settleResult?.timedOut === true;

  if (stableAfterWait || stableWithoutWait) {
    return {
      status: stableAfterWait ? 'settled_after_wait' : 'stable',
      pageStability: input.pageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: true,
      nextStepHint: 'safe_to_use_structured_refs_with_postcondition_verification',
      claimBoundary:
        'browser_tab_reports_stable; still verify the business postcondition after any action',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  if (stale) {
    return {
      status: 'stale',
      pageStability: input.pageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: false,
      nextStepHint: 'reload_or_switch_to_a_live_tab_before_structured_actions',
      claimBoundary:
        'browser_tab_is_stale_or_discarded; current page objects are not reliable action proof',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  if (loading) {
    return {
      status: input.waitedForPendingDocument ? 'loading_after_wait' : 'unknown',
      pageStability: input.pageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: false,
      nextStepHint: 'wait_then_force_fresh_read_page_before_business_actions',
      claimBoundary:
        'document_may_still_be_changing; treat candidate objects as provisional until a fresh stable read',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  return {
    status: 'unknown',
    pageStability: input.pageStability,
    initialTabStatus: input.initialTabStatus,
    finalTabStatus: input.finalTabStatus,
    waitedForPendingDocument: input.waitedForPendingDocument,
    settled: input.settleResult?.settled ?? null,
    timedOut: input.settleResult?.timedOut ?? null,
    settleReason: input.settleResult?.reason ?? null,
    waitedMs: input.settleResult?.waitedMs ?? null,
    readyState: input.settleResult?.readyState ?? null,
    canUseSnapshotForBusinessAction: false,
    nextStepHint: 'verify_page_stability_before_business_actions',
    claimBoundary:
      'browser_runtime_did_not_prove_page_stability; avoid claiming task success from this snapshot alone',
    ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
  };
}

async function captureReadPageCDPSensingSummary(input: {
  tabId: number;
  currentUrl: string;
  supportedForContentScript: boolean;
}): Promise<ReadPageCDPSensingSummary | undefined> {
  if (!input.supportedForContentScript || !/^https?:\/\//i.test(input.currentUrl)) {
    return undefined;
  }

  const snapshot = await captureCDPPageSensingSnapshot(input.tabId);
  return buildReadPageCDPSensingSummary(snapshot);
}

function buildReadPageCDPSensingSummary(
  snapshot: CDPPageSensingSnapshot,
): ReadPageCDPSensingSummary | undefined {
  if (!snapshot.available) return undefined;

  return {
    source: 'cdp_page_sensing',
    available: true,
    readiness: snapshot.readiness,
    likelyLoading: snapshot.likelyLoading,
    ...(snapshot.visibilityState ? { visibilityState: snapshot.visibilityState } : {}),
    ...(typeof snapshot.focused === 'boolean' ? { focused: snapshot.focused } : {}),
    ...(snapshot.activeElement ? { activeElement: snapshot.activeElement } : {}),
    ...(typeof snapshot.frameCount === 'number' ? { frameCount: snapshot.frameCount } : {}),
    ...(snapshot.navigation
      ? {
          navigation: {
            responseEndMs: snapshot.navigation.responseEndMs,
            domContentLoadedMs: snapshot.navigation.domContentLoadedMs,
            loadEventMs: snapshot.navigation.loadEventMs,
          },
        }
      : {}),
    ...(snapshot.networkActivity ? { networkActivity: snapshot.networkActivity } : {}),
    ...(snapshot.networkResources ? { networkResources: snapshot.networkResources } : {}),
    ...(snapshot.console ? { console: snapshot.console } : {}),
    ...(snapshot.accessibility ? { accessibility: snapshot.accessibility } : {}),
    claimBoundary:
      'cdp_page_sensing is read-only browser state evidence; it is not page-object completeness, action success, login success, or business success proof',
  };
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
  } catch {
    /* fall through to 'none' */
  }
  return 'none';
}

function reconcilePageUnderstandingWithVisibleRows(payload: Record<string, any>): void {
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

function completeVisibleRegionRows(params: {
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

function suppressVisibleRowsForContentDetail(
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

function isPublishIntent(intent: unknown): boolean {
  return typeof intent === 'string' && intent.startsWith('publish.');
}

function normalizePublishReadinessText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesPublishTitleField(name: unknown): boolean {
  return /(^|[\s:：_-])(title|headline|caption|标题|题目)([\s:：_-]|$)/i.test(
    normalizePublishReadinessText(name),
  );
}

function matchesPublishBodyField(name: unknown): boolean {
  return /(body|description|desc|content|正文|文案|描述|内容)/i.test(
    normalizePublishReadinessText(name),
  );
}

function isFillableInteractiveElement(element: { role?: unknown }): boolean {
  const role = normalizePublishReadinessText(element.role);
  return role === 'textbox' || role === 'textarea' || role === 'input' || role === 'combobox';
}

function buildPublishTextFieldEvidence(
  field: 'title' | 'body_or_description',
  interactiveElements: Array<{ ref: string; role: string; name: string; valueState?: string }>,
): ReadPagePublishFormRequiredFieldEvidence {
  const matcher = field === 'title' ? matchesPublishTitleField : matchesPublishBodyField;
  const element = interactiveElements.find(
    (candidate) => isFillableInteractiveElement(candidate) && matcher(candidate.name),
  );
  if (!element) {
    return {
      field,
      status: 'not_observed',
      evidenceSource: 'dom',
      evidence: `${field}_field_not_observed_in_current_snapshot`,
      nextRequiredCheck: 'run_fresh_same_tab_read_after_media_or_form_state_changes',
    };
  }
  const status = element.valueState === 'non_empty' ? 'present_candidate' : 'not_proven';
  return {
    field,
    status,
    evidenceSource: 'dom',
    evidence:
      status === 'present_candidate'
        ? `${field}_field_present_with_non_empty_value_state`
        : `${field}_field_observed_but_non_empty_value_not_proven`,
    targetRef: element.ref,
    nextRequiredCheck: 'fill_required_text_field_then_run_fresh_same_tab_read',
  };
}

function buildPublishFormReadiness(params: {
  pageRole: PageRole;
  primaryRegion: string | null;
  candidateActions: CandidateActionSeed[];
  fileInputBindings: ReadPageFileInputBinding[];
  interactiveElements: Array<{ ref: string; role: string; name: string; valueState?: string }>;
}): ReadPagePublishFormReadiness | undefined {
  const hasPublishSignal =
    params.pageRole === 'publish_form' ||
    (params.primaryRegion === 'form' &&
      params.candidateActions.some((action) => isPublishIntent(action.intent)));
  if (!hasPublishSignal) return undefined;

  const uploadCandidate = params.candidateActions.find(
    (action) => action.intent === 'publish.upload_media',
  );
  const firstFileInput = params.fileInputBindings.find((binding) => !binding.disabled);
  const mediaField: ReadPagePublishFormRequiredFieldEvidence =
    uploadCandidate || firstFileInput
      ? {
          field: 'media',
          status: 'not_proven',
          evidenceSource: firstFileInput ? 'file_input_binding' : 'candidate_action',
          evidence:
            'media_upload_control_observed_but_uploaded_media_state_not_proven_by_read_only_snapshot',
          ...(uploadCandidate?.targetRef ? { targetRef: uploadCandidate.targetRef } : {}),
          ...(firstFileInput?.selector ? { selector: firstFileInput.selector } : {}),
          nextRequiredTool: 'chrome_upload_file',
          ...(firstFileInput?.selector ? { nextRequiredSelector: firstFileInput.selector } : {}),
          nextRequiredCheck:
            'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
        }
      : {
          field: 'media',
          status: 'not_observed',
          evidenceSource: 'dom',
          evidence: 'media_upload_control_not_observed_in_current_snapshot',
          nextRequiredCheck: 'run_fresh_same_tab_read_after_mode_or_route_change',
        };
  const requiredFields = [
    mediaField,
    buildPublishTextFieldEvidence('title', params.interactiveElements),
    buildPublishTextFieldEvidence('body_or_description', params.interactiveElements),
  ];
  const blockingReasons = requiredFields
    .filter((field) => field.status !== 'present_candidate')
    .map((field) => `${field.field}:${field.status}`);
  const nextUploadField = requiredFields.find((field) => field.nextRequiredTool);

  return {
    status: blockingReasons.length === 0 ? 'ready_candidate' : 'not_ready_candidate',
    businessSuccessProven: false,
    requiredFields,
    blockingReasons,
    ...(nextUploadField?.nextRequiredTool
      ? { nextRequiredTool: nextUploadField.nextRequiredTool }
      : {}),
    ...(nextUploadField?.nextRequiredSelector
      ? { nextRequiredSelector: nextUploadField.nextRequiredSelector }
      : {}),
    nextRequiredCheck:
      blockingReasons.length === 0
        ? 'run_fresh_same_tab_read_and_postcondition_check_before_publish_submit'
        : 'complete_required_fields_then_run_fresh_same_tab_read_before_publish_submit',
    claimBoundary:
      'Read-only DOM/candidate-action evidence can explain publish-form readiness gaps; it does not prove upload execution, website acceptance, platform-rule compliance, final publish success, or business success.',
  };
}

export function mergeHighValueObjectActionsIntoCandidateActions(
  candidateActions: CandidateActionSeed[],
  highValueObjects: readonly ReadPageHighValueObject[] | undefined,
  frameId: number | undefined,
): CandidateActionSeed[] {
  if (!Array.isArray(highValueObjects) || highValueObjects.length === 0) {
    return candidateActions;
  }

  const actionByTargetRef = new Map<string, CandidateActionSeed>();
  for (const action of candidateActions) {
    if (action.targetRef) actionByTargetRef.set(action.targetRef, action);
  }

  let output = candidateActions;
  for (const object of highValueObjects) {
    if (object.kind !== 'visible_region_row') continue;
    const targetRef = String(object.ref || '').trim();
    if (!targetRef) continue;
    const hasOpenDetailAction = Array.isArray(object.actions)
      ? object.actions.some(
          (action: ReadPageHighValueObjectAction) =>
            action?.type === 'open_detail' &&
            action?.actionType === 'click' &&
            action?.ref === targetRef,
        )
      : false;
    if (!hasOpenDetailAction) continue;

    const existing = actionByTargetRef.get(targetRef);
    const label = String(object.label || '').trim();
    if (
      /^(menu action candidate|account action candidate|red|home|首页|直播|消息|发布|更多|关于我们|营业执照)$/i.test(
        label,
      )
    ) {
      continue;
    }
    if (existing) {
      if (!existing.intent) existing.intent = 'content.open_detail';
      if (!existing.label && label) existing.label = label;
      existing.confidence = Number(
        Math.max(existing.confidence || 0, object.confidence || 0, 0.78).toFixed(2),
      );
      if (!existing.matchReason) {
        existing.matchReason = 'content row target inferred from high value objects';
      }
      continue;
    }

    if (output.length >= 20) {
      const replaceIndex = [...output]
        .map((action, index) => ({ action, index }))
        .reverse()
        .find(
          ({ action }) =>
            action.intent !== 'search.enter_query' &&
            action.intent !== 'content.open_detail' &&
            !String(action.intent || '').startsWith('auth.'),
        )?.index;
      if (replaceIndex === undefined) continue;
      output = [...output];
      output.splice(replaceIndex, 1);
    } else if (output === candidateActions) {
      output = [...candidateActions];
    }

    const safeRef = targetRef.replace(/[^a-zA-Z0-9_]/g, '_');
    const action: CandidateActionSeed = {
      id: `ca_click_${safeRef}`,
      actionType: 'click',
      targetRef,
      ...(label ? { label } : {}),
      ...(typeof frameId === 'number' ? { frameId } : {}),
      confidence: Number(Math.max(object.confidence || 0, 0.78).toFixed(2)),
      matchReason: 'content row target inferred from high value objects',
      actionability: 'actionable',
      actionabilityReason:
        'source=high_value_objects; visible_region_row_has_open_detail_action; business_success_requires_fresh_post_click_read',
      locatorChain: [{ type: 'ref', value: targetRef }],
      intent: 'content.open_detail',
    };
    output.push(action);
    actionByTargetRef.set(targetRef, action);
  }

  return output
    .map((action, index) => ({
      action,
      index,
      priority:
        action.intent === 'search.enter_query'
          ? 360
          : action.intent === 'content.open_detail'
            ? 350
            : String(action.intent || '').startsWith('auth.')
              ? 325
              : String(action.intent || '').startsWith('publish.')
                ? 90
                : 100,
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ action }) => action);
}

function applyPublishFormReadinessToPageRegions(
  pageRegions: ReadPageRegion[] | undefined,
  readiness: ReadPagePublishFormReadiness | undefined,
): ReadPageRegion[] | undefined {
  if (!pageRegions || !readiness) return pageRegions;
  const formState =
    readiness.status === 'not_ready_candidate'
      ? 'publish_not_ready_candidate'
      : readiness.status === 'ready_candidate'
        ? 'publish_ready_candidate'
        : null;
  return pageRegions.map((region) => {
    if (region.regionType !== 'form') return region;
    return {
      ...region,
      ...(formState ? { state: formState } : {}),
      readiness: readiness.status,
      readinessBlockingReasons: readiness.blockingReasons,
      ...(readiness.nextRequiredTool ? { nextRequiredTool: readiness.nextRequiredTool } : {}),
      ...(readiness.nextRequiredSelector
        ? { nextRequiredSelector: readiness.nextRequiredSelector }
        : {}),
      nextRequiredCheck: readiness.nextRequiredCheck,
    };
  });
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

function shouldRepairVisibleRowsTargetRefs(rows: VisibleRegionRowsResult | undefined): boolean {
  return (
    rows?.visibleRegionRowsUsed === true &&
    rows.rowCount >= 2 &&
    rows.targetRefCoverageRate < VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD
  );
}

function attachFallbackRefs(
  elements: any[],
  refMap: ReturnType<typeof buildFallbackRefMap>,
): any[] {
  return elements.map((element, index) => {
    const ref = refMap[index]?.ref;
    return typeof ref === 'string' ? { ...element, ref } : element;
  });
}

function promoteTextMenuTriggerSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

function promoteSearchToolbarSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (!/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) return raw;
  const parent = parts[parts.length - 2]?.toLowerCase() || '';
  if (/^(button|a|li)(?::|\[role=|\[aria-|\.|#)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  if (/^div(?::|\[role=|\[aria-)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

function promoteFilterPanelSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (!/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) return raw;
  const parent = parts[parts.length - 2]?.toLowerCase() || '';
  if (/^(button|a|li|div)(?::|\[role=|\[aria-|\.|#)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

function isCompactSearchToolbarFallbackElement(element: any): boolean {
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 30) return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 260 && height <= 120;
}

function isCompactFilterPanelFallbackElement(element: any): boolean {
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 24) return false;
  const actionability = String(element?.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 320 && height <= 120;
}

function shouldRecoverFilterPanelTargets(
  assistantGuidance: ReadPageAssistantGuidance | undefined,
  visibleTextContent: unknown,
  pageRole?: string,
): boolean {
  const text = String(visibleTextContent || '').replace(/\s+/g, ' ');
  const filterPanelLabels = extractFilterPanelLabelsFromVisibleText(text);
  if (filterPanelLabels.length < 2) return false;
  if (shouldRecoverSearchToolbarTargets(assistantGuidance, pageRole)) return true;
  const toolbarLabels = extractSearchToolbarLabelsFromVisibleText(text);
  return toolbarLabels.some((label) =>
    /^(筛选|已筛选|过滤|filter|filters|filtered|排序|sort)$/i.test(label),
  );
}

function extractVisibleMenuActionLabelsForTargetRecovery(visibleTextContent: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length > 18) continue;
    if (
      !/\b(log[ -]?out|sign[ -]?out|settings?|help|support|feedback)\b|退出|注销|设置|帮助|客服|反馈/i.test(
        line,
      )
    ) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(line);
    if (labels.length >= 8) break;
  }
  return labels;
}

function shouldRecoverSearchToolbarTargets(
  assistantGuidance: ReadPageAssistantGuidance | undefined,
  pageRole?: string,
): boolean {
  if (pageRole === 'search_results') return true;
  if (assistantGuidance?.taskKind === 'search') return true;
  return (assistantGuidance?.requestedObjects ?? []).some((item) =>
    ['search_input', 'result_cards', 'detail_metrics'].includes(item),
  );
}

const SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS = ['筛选', '已筛选', 'Filter', 'Filters'];

function searchToolbarElementKey(element: any): string {
  return [
    typeof element?.selector === 'string' ? element.selector.trim() : '',
    typeof element?.href === 'string' ? element.href.trim() : '',
    typeof element?.text === 'string' ? element.text.trim() : '',
    typeof element?.name === 'string' ? element.name.trim() : '',
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

function hasExecutableRecoveredTarget(element: any): boolean {
  const href = typeof element?.href === 'string' ? element.href.trim() : '';
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  return Boolean(selector || href);
}

function prependRecoveredElementsToPageContent(params: {
  basePayload: any;
  recoveredElements: any[];
  recoveredRefMap: any[];
}): void {
  const recoveredContent = formatElementsAsPageContent(
    params.recoveredElements,
    params.recoveredRefMap,
  );
  if (!recoveredContent) return;
  const existingContent =
    typeof params.basePayload.pageContent === 'string' ? params.basePayload.pageContent : '';
  params.basePayload.pageContent = existingContent
    ? `${recoveredContent}\n${existingContent}`
    : recoveredContent;
}

function extractVisibleTextControlLabelsForTargetRecovery(visibleTextContent: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const text = String(visibleTextContent || '').replace(/\r/g, '\n');
  const candidates = text
    .split(/\n+|[|｜•·]/)
    .flatMap((line) => line.split(/\s{2,}/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.length > 18) continue;
    if (isDescriptiveVisibleTextControlLabel(candidate)) continue;
    if (
      !/\b(upload|publish|post|create|add|new|edit|save|next|continue|confirm|submit)\b|上传|发布|创建|新建|新增|添加|编辑|保存|下一步|继续|确定|提交/i.test(
        candidate,
      )
    ) {
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(candidate);
    if (labels.length >= 10) break;
  }

  return labels;
}

function isDescriptiveVisibleTextControlLabel(label: string): boolean {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (/^(支持|最大|推荐|建议|超过|不超过|仅支持|可上传|允许上传)/.test(normalized)) return true;
  if (/(大小|尺寸|格式|分辨率|时长|以内|文件|画质|要求|限制)/.test(normalized)) return true;
  if (/^(supports?|maximum|max|recommended|recommend|allowed|only supports?)\b/i.test(normalized)) {
    return true;
  }
  if (/\b(size|format|resolution|duration|limit|limits?|requirements?|file)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

function isCompactVisibleTextControlFallbackElement(element: any): boolean {
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  if (!selector) return false;
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 30) return false;
  const actionability = String(element?.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const role = String(element?.role || element?.type || '').toLowerCase();
  if (element?.isInteractive === false && /^(text|generic|statictext)$/.test(role)) return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 360 && height <= 160;
}

function attachInteractiveRects<T extends { ref?: string; rect?: unknown }>(
  elements: T[],
  refMap: any[],
): T[] {
  const rectByRef = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
    const rect = entry?.rect;
    if (
      !ref ||
      !rect ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      continue;
    }
    rectByRef.set(ref, {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    });
  }
  if (rectByRef.size === 0) return elements;
  return elements.map((element) => {
    const rect = element.ref ? rectByRef.get(element.ref) : undefined;
    return rect ? { ...element, rect } : element;
  });
}

function attachInteractiveValueState<
  T extends { ref?: string; valueState?: 'empty' | 'non_empty' | 'unknown' },
>(elements: T[], refMap: any[]): T[] {
  const valueStateByRef = new Map<string, 'empty' | 'non_empty' | 'unknown'>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
    if (!ref) continue;
    if (
      entry?.valueState === 'empty' ||
      entry?.valueState === 'non_empty' ||
      entry?.valueState === 'unknown'
    ) {
      valueStateByRef.set(ref, entry.valueState);
      continue;
    }
    const rawValue =
      Object.prototype.hasOwnProperty.call(entry, 'value') ||
      Object.prototype.hasOwnProperty.call(entry, 'currentValue')
        ? (entry.value ?? entry.currentValue)
        : undefined;
    if (rawValue === undefined || rawValue === null) continue;
    valueStateByRef.set(ref, String(rawValue).length > 0 ? 'non_empty' : 'empty');
  }
  if (valueStateByRef.size === 0) return elements;
  return elements.map((element) => {
    if (!element.ref || element.valueState) return element;
    const valueState = valueStateByRef.get(element.ref);
    return valueState ? { ...element, valueState } : element;
  });
}

function hasQrVisibleContext(pageContent: string, visibleTextContent?: string | null): boolean {
  const text = `${pageContent || ''}\n${visibleTextContent || ''}`;
  if (!text.trim()) return false;
  const hasQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(text);
  const authHidden = /"?(?:showLogin|loginModalVisible|authModalVisible)"?\s*:\s*false/i.test(text);
  return hasQrSignal && !authHidden;
}

const AUTH_FORM_TARGETED_CONTROL_QUERIES = [
  '输入手机号',
  '手机号',
  '输入验证码',
  '验证码',
  '获取验证码',
  '发送验证码',
  '重新发送',
  '阅读并同意',
  '同意并继续',
  '登录',
] as const;

function hasAuthFormInteractiveContext(
  pageContent: string,
  visibleTextContent?: string | null,
): boolean {
  const text = `${pageContent || ''}\n${visibleTextContent || ''}`;
  if (!text.trim()) return false;
  return /手机号|手机号码|电话号码|短信验证码|输入验证码|获取验证码|发送验证码|重新发送|同意.*协议|隐私条款/i.test(
    text,
  );
}

function normalizeWindowRuntimeState(value: unknown): ReadPageWindowRuntimeState | null {
  if (
    value === 'normal' ||
    value === 'minimized' ||
    value === 'maximized' ||
    value === 'fullscreen' ||
    value === 'docked'
  ) {
    return value;
  }
  return typeof value === 'string' ? 'unknown' : null;
}

function readWindowInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function finiteRect(rect: any): { x: number; y: number; width: number; height: number } | null {
  if (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  ) {
    return {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    };
  }
  return null;
}

function scoreQrVisualElementHint(
  element: any,
  index: number,
): (ReadPageVisualElementHint & { score: number }) | null {
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  if (!selector) return null;
  const rect = finiteRect(element?.coordinates?.rect);
  if (!rect || rect.width < 40 || rect.height < 40) return null;
  const area = rect.width * rect.height;
  if (area < 2_000 || area > 160_000) return null;
  const aspectRatio = rect.width / Math.max(1, rect.height);
  if (aspectRatio < 0.65 || aspectRatio > 1.55) return null;

  const role = String(element?.tagName || element?.type || element?.role || 'img').toLowerCase();
  const attributeSignal = [
    element?.text,
    element?.alt,
    element?.title,
    element?.className,
    element?.role,
    role,
  ]
    .filter(Boolean)
    .join(' ');
  const scoringSignal = [attributeSignal, selector].filter(Boolean).join(' ');

  const hasExplicitQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(attributeSignal);
  if (!hasExplicitQrSignal) return null;

  let score = 0;
  score += 120;
  if (/\b(canvas|img|svg|selected)\b/i.test(role)) score += 24;
  if (rect.width >= 100 && rect.width <= 360 && rect.height >= 100 && rect.height <= 360)
    score += 36;
  if (String(element?.text || '').trim().length === 0) score += 18;
  if (/\b(logo|brand|wordmark|avatar|icon|profile)\b/i.test(scoringSignal)) score -= 80;
  score -= Math.min(20, index * 2);

  if (score < 40) return null;
  return {
    id: `qr_visual_${index + 1}`,
    label: 'QR visual element candidate',
    selector,
    role,
    rect,
    visualSignature:
      typeof element?.visualSignature === 'string' &&
      /^visual_[a-f0-9]{8}$/i.test(element.visualSignature)
        ? element.visualSignature.toLowerCase()
        : undefined,
    qrSignal: true,
    reason: 'qr_visual_element_signal',
    confidence: Math.min(0.92, Math.max(0.54, score / 180)),
    score,
  };
}

function buildObservationProfile(params: {
  mode: ReadPageMode;
  requestedLayer: ReadPageRequestedLayer;
}): ReadPageObservationProfile {
  if (params.mode === 'full') return 'full';
  if (params.mode === 'normal') return 'debug';
  if (params.requestedLayer !== 'L0+L1+L2') return 'task';
  return 'compact';
}

function deriveRegionAlignedPageUnderstanding(params: {
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: PrimaryRegionConfidence;
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

function buildObservationCoverage(params: {
  pageType: PageType;
  frameContext: ReadPageFrameContext | null;
  visibleRegionRows: VisibleRegionRowsResult;
  searchSurface?: ReadPageSearchSurface;
}): ReadPageObservationCoverage {
  const capabilityGaps: string[] = [];
  const unsupported = params.pageType === 'unsupported_page';
  const unresolvedVisibleTextCount = params.searchSurface?.visibleButUnresolved?.length ?? 0;
  for (const gap of params.searchSurface?.observationCoverage?.capabilityGaps ?? []) {
    pushCapabilityGap(capabilityGaps, gap);
  }

  const iframe = unsupported
    ? 'unsupported'
    : params.frameContext?.frameScope === 'subframe'
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

function buildEvidenceSources(params: {
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
  const pageObjectSnapshot = buildReadPageSnapshotSourceStats({
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
  const previousSnapshot = getPreviousPageObjectSnapshot(params.tabId);
  const pageDeltaReport = buildReadPagePageDeltaReport({
    tabId: params.tabId,
    currentSnapshot: pageObjectSnapshot,
    previousSnapshot: previousSnapshot?.snapshot ?? null,
    cdpSignals: {
      networkStartedCount:
        typeof params.loadReadiness.cdpSensing?.networkActivity?.requestStartedCount === 'number'
          ? params.loadReadiness.cdpSensing.networkActivity.requestStartedCount
          : undefined,
      failedRequestCount:
        typeof params.loadReadiness.cdpSensing?.networkActivity?.failedRequestCount === 'number'
          ? params.loadReadiness.cdpSensing.networkActivity.failedRequestCount
          : undefined,
      errorCount:
        typeof params.loadReadiness.cdpSensing?.console?.errorCount === 'number'
          ? params.loadReadiness.cdpSensing.console.errorCount
          : undefined,
      warningCount:
        typeof params.loadReadiness.cdpSensing?.console?.warningCount === 'number'
          ? params.loadReadiness.cdpSensing.console.warningCount
          : undefined,
    },
    previousCdpSignals: previousSnapshot?.telemetry,
  });
  if (pageDeltaReport) {
    sharedPayload.pageDeltaReport = pageDeltaReport;
  }
  sharedPayload.pageObjectSnapshot = pageObjectSnapshot;
  rememberPageObjectSnapshot(params.tabId, pageObjectSnapshot, {
    networkStartedCount:
      typeof params.loadReadiness.cdpSensing?.networkActivity?.requestStartedCount === 'number'
        ? params.loadReadiness.cdpSensing.networkActivity.requestStartedCount
        : undefined,
    failedRequestCount:
      typeof params.loadReadiness.cdpSensing?.networkActivity?.failedRequestCount === 'number'
        ? params.loadReadiness.cdpSensing.networkActivity.failedRequestCount
        : undefined,
    errorCount:
      typeof params.loadReadiness.cdpSensing?.console?.errorCount === 'number'
        ? params.loadReadiness.cdpSensing.console.errorCount
        : undefined,
    warningCount:
      typeof params.loadReadiness.cdpSensing?.console?.warningCount === 'number'
        ? params.loadReadiness.cdpSensing.console.warningCount
        : undefined,
  });

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

function browserWorldTabOpenedByToOwnerType(
  openedBy: 'ai' | 'user_or_page' | 'unknown' | undefined,
): BrowserPageOwnerType {
  if (openedBy === 'ai') return 'run_owned';
  if (openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

function deriveBrowserWorldTabOpenedBySource(
  tab: BrowserWorldTabObject | null,
): ReadPageOwnershipRuntimeSummary['currentTabOpenedBySource'] {
  if (!tab) return null;
  if (tab.openedBySource) return tab.openedBySource;
  if (tab.openedBy === 'ai') return 'ai_tool';
  if (tab.openedBy === 'user_or_page' && Number.isInteger(tab.openerTabId)) return 'page_opener';
  if (tab.openedBy === 'user_or_page') return 'user_or_unknown';
  return 'unknown';
}

function buildReadPageOwnershipRuntimeSummary(params: {
  tabId: number;
  currentOwnerType: BrowserPageOwnerType;
  currentUrl: string;
  currentTitle: string;
  browserWorldTab: BrowserWorldTabObject | null;
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
  browserWorldObjectChangeSummary: string | null;
  browserWorldActionableObjectChangeSummary: string | null;
  browserWorldCurrentOperationConclusion: string | null;
  browserWorldRoutingDecisionSummary: string | null;
}): ReadPageOwnershipRuntimeSummary {
  const lastAiOperation = params.browserWorldTab?.lastAiOperation ?? null;
  const lastAiOperationConfidence =
    typeof params.browserWorldTab?.lastAiOperationConfidence === 'number'
      ? params.browserWorldTab.lastAiOperationConfidence
      : lastAiOperation
        ? 0.7
        : null;
  const lastAiOperationReason =
    params.browserWorldTab?.lastAiOperationReason ??
    (lastAiOperation
      ? `browser_world_inventory_operation_marker_without_reason:${lastAiOperation}`
      : null);

  return {
    currentTabId: params.tabId,
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
    currentTabUrl: params.browserWorldTab?.url || params.currentUrl || null,
    currentTabPendingUrl: params.browserWorldTab?.pendingUrl ?? null,
    currentTabTitle: params.browserWorldTab?.title || params.currentTitle || null,
    currentTabStatus: params.browserWorldTab?.status ?? null,
    currentTabDiscarded: params.browserWorldTab?.discarded ?? null,
    currentTabAudible: params.browserWorldTab?.audible ?? null,
    currentTabMuted: params.browserWorldTab?.muted ?? null,
    currentTabPinned: params.browserWorldTab?.pinned ?? null,
    currentTabOpenerTabId: params.browserWorldTab?.openerTabId ?? null,
    currentTabOpenedBy: params.browserWorldTab?.openedBy ?? null,
    currentTabOpenedBySource: deriveBrowserWorldTabOpenedBySource(params.browserWorldTab),
    currentTabOpenedByConfidence: params.browserWorldTab?.openedByConfidence ?? null,
    currentTabOpenedByReason: params.browserWorldTab?.openedByReason ?? null,
    currentTabAiOperationState: params.browserWorldTab?.aiOperationState ?? null,
    currentTabLastAiOperation: lastAiOperation,
    currentTabLastAiOperationAtMs: params.browserWorldTab?.lastAiOperationAtMs ?? null,
    currentTabLastAiOperationConfidence: lastAiOperationConfidence,
    currentTabLastAiOperationReason: lastAiOperationReason,
    currentTabCanTabrixOperate: params.browserWorldTab?.canTabrixOperate ?? null,
    currentTabOperabilityReason: params.browserWorldTab?.operabilityReason ?? null,
    currentTabRuntimeStateSource: params.browserWorldTab
      ? 'browser_world_inventory'
      : 'chrome_tab_snapshot',
    browserWorldObjectChangeSummary: params.browserWorldObjectChangeSummary,
    browserWorldActionableObjectChangeSummary: params.browserWorldActionableObjectChangeSummary,
    browserWorldCurrentOperationConclusion: params.browserWorldCurrentOperationConclusion,
    browserWorldRoutingDecisionSummary: params.browserWorldRoutingDecisionSummary,
    currentOwnerType: params.currentOwnerType,
    currentTabRunOwnershipVerdict: 'unknown',
    currentTabPrimaryRelationVerdict: 'current_tab_unknown',
    protectedScopeVerdict: 'unknown',
    cleanupEligibility: 'unknown',
    protectReason: null,
    isCurrentTabRunOwnedByTask: false,
    runOwnedTabIds: [],
    runOwnedTabCount: 0,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: null,
    primaryTabId: null,
    primaryTabReuseRate: null,
    benchmarkOwnedTabCount: null,
    heartbeatTabCount: null,
    heartbeatWindowCount: null,
  };
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
    } catch {
      // Expected when the fallback helper has not been injected on this page yet.
    }

    await chrome.scripting.executeScript({
      target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
      files: [INTERACTIVE_ELEMENTS_HELPER_FILE],
      world: 'ISOLATED',
    } as any);
  }

  private async bindSyntheticRefsToSelectors(
    tabId: number,
    refMap: Array<{ ref?: unknown; selector?: unknown } | null>,
    frameId?: number,
  ): Promise<number> {
    const entries = refMap
      .map((entry) => ({
        ref: typeof entry?.ref === 'string' ? entry.ref.trim() : '',
        selector: typeof entry?.selector === 'string' ? entry.selector.trim() : '',
      }))
      .filter(
        (entry) =>
          (entry.ref.startsWith('ref_text_search_toolbar_') ||
            entry.ref.startsWith('ref_text_filter_panel_') ||
            entry.ref.startsWith('ref_text_control_')) &&
          entry.selector,
      );
    if (entries.length === 0) return 0;

    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
        world: 'ISOLATED',
        func: (bindings: Array<{ ref: string; selector: string }>) => {
          try {
            const pageWindow = window as any;
            if (!pageWindow.__claudeElementMap) pageWindow.__claudeElementMap = {};
            let bound = 0;
            for (const binding of bindings) {
              if (!binding?.ref || !binding?.selector) continue;
              const element = document.querySelector(binding.selector);
              if (!(element instanceof Element)) continue;
              pageWindow.__claudeElementMap[binding.ref] = new WeakRef(element);
              bound += 1;
            }
            return { bound };
          } catch {
            return { bound: 0 };
          }
        },
        args: [entries],
      } as any);
      const resultValue = result?.[0]?.result as { bound?: unknown } | undefined;
      const bound = resultValue?.bound;
      return typeof bound === 'number' && Number.isFinite(bound) ? bound : 0;
    } catch {
      return 0;
    }
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

  private async collectFileInputBindings(
    tabId: number,
    frameId?: number,
  ): Promise<ReadPageFileInputBinding[]> {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId, ...(typeof frameId === 'number' ? { frameIds: [frameId] } : {}) },
        world: 'ISOLATED',
        func: () => {
          function cssEscape(value: string): string {
            const escapeFn = (window as any).CSS?.escape;
            return typeof escapeFn === 'function'
              ? escapeFn(value)
              : value.replace(/["\\]/g, '\\$&');
          }

          function selectorForInput(input: HTMLInputElement): string {
            const id = input.getAttribute('id');
            if (id) return `#${cssEscape(id)}`;
            const name = input.getAttribute('name');
            if (name) return `input[type="file"][name="${cssEscape(name)}"]`;
            const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
            const index = inputs.indexOf(input);
            if (index >= 0) return `input[type="file"]:nth-of-type(${index + 1})`;
            return 'input[type="file"]';
          }

          return Array.from(document.querySelectorAll('input[type="file"]'))
            .filter((input): input is HTMLInputElement => input instanceof HTMLInputElement)
            .slice(0, 5)
            .map((input) => {
              const rect = input.getBoundingClientRect();
              const style = window.getComputedStyle(input);
              const visible =
                rect.width > 0 &&
                rect.height > 0 &&
                style.visibility !== 'hidden' &&
                style.display !== 'none';
              return {
                selector: selectorForInput(input),
                accept: input.getAttribute('accept') || undefined,
                multiple: input.multiple,
                disabled: input.disabled,
                visible,
                bindingSource: 'dom_input_type_file',
                nextRequiredTool: 'chrome_upload_file',
                nextRequiredCheck:
                  'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
                claimBoundary:
                  'Read-only DOM evidence proves only that a file input binding candidate exists in this snapshot; it does not prove upload authorization, upload execution, website acceptance, final publish readiness, or business success.',
              };
            });
        },
      } as any);
      const bindings = result?.[0]?.result;
      if (!Array.isArray(bindings)) return [];
      return bindings
        .map((binding: any): ReadPageFileInputBinding | null => {
          const selector = typeof binding?.selector === 'string' ? binding.selector.trim() : '';
          if (!selector) return null;
          return {
            selector,
            ...(typeof binding.accept === 'string' && binding.accept.trim()
              ? { accept: binding.accept.trim() }
              : {}),
            ...(typeof binding.multiple === 'boolean' ? { multiple: binding.multiple } : {}),
            ...(typeof binding.disabled === 'boolean' ? { disabled: binding.disabled } : {}),
            ...(typeof binding.visible === 'boolean' ? { visible: binding.visible } : {}),
            bindingSource: 'dom_input_type_file',
            nextRequiredTool: 'chrome_upload_file',
            nextRequiredCheck:
              'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
            claimBoundary:
              'Read-only DOM evidence proves only that a file input binding candidate exists in this snapshot; it does not prove upload authorization, upload execution, website acceptance, final publish readiness, or business success.',
          };
        })
        .filter((binding): binding is ReadPageFileInputBinding => binding !== null);
    } catch {
      return [];
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

  private async supplementAuthFormInteractiveControls(
    tabId: number,
    basePayload: Record<string, any>,
    frameId?: number,
  ): Promise<void> {
    if (
      !hasAuthFormInteractiveContext(
        String(basePayload.pageContent || ''),
        basePayload.visibleTextContent,
      )
    ) {
      return;
    }

    const targetedElements: any[] = [];
    const seenTargetKeys = new Set<string>();
    for (const query of AUTH_FORM_TARGETED_CONTROL_QUERIES) {
      const targeted = await this.collectInteractiveElementsFallback(tabId, {
        textQuery: query,
        includeCoordinates: true,
        frameId,
      });
      const first = Array.isArray(targeted?.elements) ? targeted.elements[0] : null;
      if (!first) continue;
      const key = [
        String(first.selector || '').trim(),
        String(first.text || first.name || '').trim(),
        String(first.tagName || first.role || '').trim(),
      ].join('|');
      if (!key.trim() || seenTargetKeys.has(key)) continue;
      seenTargetKeys.add(key);
      targetedElements.push(first);
    }

    const fallback = await this.collectInteractiveElementsFallback(tabId, { frameId });
    const broadElements = Array.isArray(fallback?.elements) ? fallback.elements : [];
    const fallbackElements = [...targetedElements, ...broadElements];
    if (fallbackElements.length === 0) return;

    const merged = fallbackElements.slice(0, 150);
    const fallbackRefMap = buildFallbackRefMap(merged);
    const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
    const existingElements = Array.isArray(basePayload.elements) ? basePayload.elements : [];
    const existingRefMap = Array.isArray(basePayload.refMap) ? basePayload.refMap : [];

    basePayload.elements = [...existingElements, ...mergedWithRefs];
    basePayload.count = Math.max(Number(basePayload.count || 0), fallbackElements.length);
    basePayload.refMap = [...existingRefMap, ...fallbackRefMap];
    basePayload.refMapCount = basePayload.refMap.filter((entry: unknown) => entry != null).length;
    basePayload.fallbackUsed = true;
    basePayload.fallbackSource = basePayload.fallbackSource
      ? `${basePayload.fallbackSource}+auth_form_interactive_supplement`
      : 'auth_form_interactive_supplement';
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
    return elements
      .map((element: unknown, index: number) => scoreQrVisualElementHint(element, index))
      .filter(
        (
          item: (ReadPageVisualElementHint & { score: number }) | null,
        ): item is ReadPageVisualElementHint & {
          score: number;
        } => Boolean(item),
      )
      .sort(
        (
          left: ReadPageVisualElementHint & { score: number },
          right: ReadPageVisualElementHint & { score: number },
        ) => right.score - left.score,
      )
      .slice(0, 3)
      .map(({ score: _score, ...item }: ReadPageVisualElementHint & { score: number }) => item);
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
    await this.bindSyntheticRefsToSelectors(params.tabId, recoveredRefMap, params.frameId);
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
        ...extractSearchToolbarLabelsFromVisibleText(params.basePayload.visibleTextContent),
        ...SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS,
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
        ? fallback.elements.find(
            (element: any) => element?.selector && isCompactSearchToolbarFallbackElement(element),
          )
        : null;
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
      entry ? { ...entry, ref: `ref_text_search_toolbar_${offset + index + 1}` } : null,
    );
    await this.bindSyntheticRefsToSelectors(params.tabId, recoveredRefMap, params.frameId);
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
    const labels = extractFilterPanelLabelsFromVisibleText(params.basePayload.visibleTextContent)
      .filter((label) => label.length <= 18)
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
    await this.bindSyntheticRefsToSelectors(params.tabId, recoveredRefMap, params.frameId);
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
        "Stay on the safe path first: prefer ref-based actions from chrome_read_page or chrome_get_interactive_elements. If the specific element you need is still missing, use chrome_screenshot for visual confirmation and coordinates. Reserve chrome_computer or chrome_javascript for explicit fallback/debug cases only. Also note: 'markedElements' are user-marked elements and have the highest priority when choosing targets.";

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
      const cdpSensing = await captureReadPageCDPSensingSummary({
        tabId,
        currentUrl,
        supportedForContentScript: schemeGuard.supportedForContentScript,
      });
      const loadReadiness = buildLoadReadiness({
        pageStability,
        initialTabStatus,
        finalTabStatus: typeof tab.status === 'string' ? tab.status : null,
        waitedForPendingDocument,
        settleResult: pendingDocumentSettleResult,
        cdpSensing,
      });

      if (!schemeGuard.supportedForContentScript) {
        const guardPageContent = [
          '- generic "Current tab is not a regular web page"',
          currentTitle ? `- generic "title: ${currentTitle.replace(/\s+/g, ' ').trim()}"` : '',
          currentUrl ? `- generic "url: ${currentUrl}"` : '',
          `- generic "pageType: ${schemeGuard.pageType}"`,
          `- generic "unsupportedPageType: ${schemeGuard.unsupportedPageType || 'none'}"`,
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

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                ...unsupportedModeOutput,
                reason: 'unsupported_page_type',
                pageType: schemeGuard.pageType,
                scheme: schemeGuard.scheme,
                unsupportedPageType: schemeGuard.unsupportedPageType,
                recommendedAction: schemeGuard.recommendedAction,
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
      await this.supplementAuthFormInteractiveControls(tabId, basePayload, requestedFrameId);
      basePayload.visualElements = await this.collectQrVisualElements({
        tabId,
        pageContent: String(basePayload.pageContent || ''),
        visibleTextContent: basePayload.visibleTextContent,
        frameId: requestedFrameId,
      });
      basePayload.fileInputBindings = await this.collectFileInputBindings(tabId, requestedFrameId);

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
          basePayload.visualElements = await this.collectQrVisualElements({
            tabId,
            pageContent: String(basePayload.pageContent || ''),
            visibleTextContent: basePayload.visibleTextContent,
            frameId: requestedFrameId,
          });
          basePayload.fileInputBindings = await this.collectFileInputBindings(
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
