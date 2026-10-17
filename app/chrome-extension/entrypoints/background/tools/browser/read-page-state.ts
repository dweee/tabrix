import type {
  BrowserPageStability,
  ReadPageCDPSensingSummary,
  ReadPageFrameContext,
  ReadPageLoadReadiness,
} from '@tabrix/shared';
import type { CDPPageStabilityHint } from '@/utils/cdp-page-sensing';

export function normalizeFrameContext(
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

/**
 * Infer page stability from tab properties.
 * Returns 'loading' when the document is still loading,
 * 'stale' when the tab has been discarded or unloaded,
 * 'stable' when the page is fully loaded and interactive.
 */
export function inferPageStability(tab: {
  status?: string;
  discarded?: boolean;
}): BrowserPageStability {
  if (tab.discarded === true) return 'stale';
  if (tab.status === 'loading') return 'loading';
  if (tab.status === 'unloaded') return 'stale';
  return 'stable';
}

export function buildLoadReadiness(input: {
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
  cdpStabilityHint?: CDPPageStabilityHint;
}): ReadPageLoadReadiness {
  const cdpNetworkFailureCount = Math.max(
    input.cdpSensing?.networkActivity?.failedRequestCount ?? 0,
    input.cdpSensing?.networkResources?.failedResourceStatusCount ?? 0,
  );
  const cdpConsoleErrorCount = input.cdpSensing?.console?.errorCount ?? 0;
  const cdpHardFailure = cdpNetworkFailureCount >= 3 || cdpConsoleErrorCount >= 3;
  const cdpSignalsSpaNavigation = input.cdpStabilityHint === 'spa_navigating';
  const cdpActionableNodeCount = input.cdpSensing?.accessibility?.actionableNodeCount ?? 0;
  const cdpDisabledNodeCount = input.cdpSensing?.accessibility?.stateSignals.disabledCount ?? 0;
  const cdpLocatorCandidateCount =
    input.cdpSensing?.accessibility?.locatorCoverage?.locatorCandidateCount ?? 0;
  const cdpTargetBoundActionableCandidate = input.cdpSensing?.accessibility?.objectCandidates?.find(
    (candidate) => {
      const locator = candidate.locator;
      const visibility = candidate.visibilityProbe;
      const role = candidate.role.toLowerCase();
      const roleSupportsAction = new Set([
        'button',
        'checkbox',
        'combobox',
        'link',
        'menuitem',
        'option',
        'searchbox',
        'switch',
        'tab',
        'textbox',
      ]).has(role);
      const hasLocator = Boolean(
        locator?.cssSelector || locator?.axNodeId || typeof locator?.backendDOMNodeId === 'number',
      );
      const hasVisualBounds =
        Number(locator?.visualBounds?.x ?? -1) >= 0 &&
        Number(locator?.visualBounds?.y ?? -1) >= 0 &&
        Number(locator?.visualBounds?.width ?? 0) > 0 &&
        Number(locator?.visualBounds?.height ?? 0) > 0;
      const targetVisibilityProven = visibility
        ? visibility.domVisible === true &&
          visibility.inViewport === true &&
          visibility.occluded === false &&
          visibility.centerHitTarget !== false
        : hasVisualBounds;
      return (
        (candidate.actionTypes.length > 0 || roleSupportsAction) &&
        candidate.state.disabled !== true &&
        hasLocator &&
        hasVisualBounds &&
        targetVisibilityProven
      );
    },
  );
  const cdpAxActionable =
    cdpTargetBoundActionableCandidate?.locator?.source === 'cdp_ax' &&
    cdpActionableNodeCount > cdpDisabledNodeCount &&
    cdpLocatorCandidateCount > 0 &&
    Boolean(cdpTargetBoundActionableCandidate);
  const cdpDomActionable = cdpTargetBoundActionableCandidate?.locator?.source === 'cdp_dom';
  const cdpLocatorActionable = cdpAxActionable || cdpDomActionable;
  const cdpNetworkQuiet =
    input.cdpSensing?.available === true &&
    (input.cdpSensing.likelyLoading === false ||
      input.cdpSensing.readiness === 'interactive' ||
      input.cdpSensing.readiness === 'complete') &&
    input.cdpSensing.networkActivity?.inFlightCount === 0 &&
    (input.cdpSensing.networkResources?.resourceInFlightCount ?? 0) === 0;
  const effectivePageStability: BrowserPageStability = cdpSignalsSpaNavigation
    ? 'changing'
    : input.pageStability;
  const stableAfterWait =
    input.waitedForPendingDocument &&
    input.settleResult?.settled === true &&
    effectivePageStability === 'stable';
  const stableWithoutWait = !input.waitedForPendingDocument && effectivePageStability === 'stable';
  const stale = effectivePageStability === 'stale';
  const loading =
    effectivePageStability === 'loading' ||
    effectivePageStability === 'changing' ||
    input.settleResult?.timedOut === true;
  const cdpProvisionalActionable =
    loading &&
    !cdpHardFailure &&
    !cdpSignalsSpaNavigation &&
    cdpNetworkQuiet &&
    cdpLocatorActionable;
  const provisionalCandidateSource = cdpDomActionable ? 'cdp_dom' : 'cdp_ax';

  if (stableAfterWait || stableWithoutWait) {
    return {
      status: stableAfterWait ? 'settled_after_wait' : 'stable',
      pageStability: effectivePageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: !cdpHardFailure,
      nextStepAction: cdpHardFailure ? 'block' : 'proceed',
      nextStepHint: cdpHardFailure
        ? 'inspect_errors_then_reread_after_recovery_before_structured_actions'
        : 'safe_to_use_structured_refs_with_postcondition_verification',
      claimBoundary: cdpHardFailure
        ? 'browser_tab_reports_stable_but_cdp_errors_are_high; inspect failures before business action'
        : 'browser_tab_reports_stable; still verify the business postcondition after any action',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  if (stale) {
    return {
      status: 'stale',
      pageStability: effectivePageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: false,
      nextStepAction: 'refresh',
      nextStepHint: 'reload_or_switch_to_a_live_tab_before_structured_actions',
      claimBoundary:
        'browser_tab_is_stale_or_discarded; current page objects are not reliable action proof',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  if (loading) {
    return {
      status: cdpProvisionalActionable
        ? provisionalCandidateSource === 'cdp_dom'
          ? 'cdp_dom_actionable_after_wait'
          : 'cdp_ax_actionable_after_wait'
        : input.waitedForPendingDocument
          ? 'loading_after_wait'
          : 'unknown',
      pageStability: effectivePageStability,
      initialTabStatus: input.initialTabStatus,
      finalTabStatus: input.finalTabStatus,
      waitedForPendingDocument: input.waitedForPendingDocument,
      settled: input.settleResult?.settled ?? null,
      timedOut: input.settleResult?.timedOut ?? null,
      settleReason: input.settleResult?.reason ?? null,
      waitedMs: input.settleResult?.waitedMs ?? null,
      readyState: input.settleResult?.readyState ?? null,
      canUseSnapshotForBusinessAction: cdpProvisionalActionable,
      nextStepAction: cdpProvisionalActionable ? 'proceed' : cdpHardFailure ? 'block' : 'wait',
      nextStepHint: cdpProvisionalActionable
        ? provisionalCandidateSource === 'cdp_dom'
          ? 'use_current_cdp_dom_candidate_then_immediately_force_fresh_same_tab_read'
          : 'use_current_cdp_ax_candidate_then_immediately_force_fresh_same_tab_read'
        : cdpSignalsSpaNavigation
          ? 'spa_navigation_detected; wait_then_force_fresh_read_page_before_business_actions'
          : 'wait_then_force_fresh_read_page_before_business_actions',
      claimBoundary: cdpProvisionalActionable
        ? provisionalCandidateSource === 'cdp_dom'
          ? 'chrome_tab_still_reports_loading; only the current locator-backed CDP DOM candidate is provisionally actionable, and action success plus business success require an immediate fresh same-tab read'
          : 'chrome_tab_still_reports_loading; only the current locator-backed CDP+AX candidate is provisionally actionable, and action success plus business success require an immediate fresh same-tab read'
        : cdpHardFailure
          ? 'document_is_not_stable_and_cdp_errors_are_high; do not continue business actions without recovery'
          : cdpSignalsSpaNavigation
            ? 'cdp_detected_post_ready_spa_navigation; treat candidate objects as provisional until a fresh stable read'
            : 'document_may_still_be_changing; treat candidate objects as provisional until a fresh stable read',
      ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
    };
  }

  return {
    status: 'unknown',
    pageStability: effectivePageStability,
    initialTabStatus: input.initialTabStatus,
    finalTabStatus: input.finalTabStatus,
    waitedForPendingDocument: input.waitedForPendingDocument,
    settled: input.settleResult?.settled ?? null,
    timedOut: input.settleResult?.timedOut ?? null,
    settleReason: input.settleResult?.reason ?? null,
    waitedMs: input.settleResult?.waitedMs ?? null,
    readyState: input.settleResult?.readyState ?? null,
    canUseSnapshotForBusinessAction: false,
    nextStepAction: cdpHardFailure ? 'block' : 'wait',
    nextStepHint: 'verify_page_stability_before_business_actions',
    claimBoundary: cdpHardFailure
      ? 'browser_runtime_did_not_prove_page_stability_and_cdp_errors_are_high; inspect failures before business action'
      : 'browser_runtime_did_not_prove_page_stability; avoid claiming task success from this snapshot alone',
    ...(input.cdpSensing ? { cdpSensing: input.cdpSensing } : {}),
  };
}
