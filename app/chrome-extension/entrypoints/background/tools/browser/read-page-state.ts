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
      canUseSnapshotForBusinessAction: true,
      nextStepAction: cdpHardFailure ? 'block' : 'proceed',
      nextStepHint: 'safe_to_use_structured_refs_with_postcondition_verification',
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
      status: input.waitedForPendingDocument ? 'loading_after_wait' : 'unknown',
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
      nextStepHint: cdpSignalsSpaNavigation
        ? 'spa_navigation_detected; wait_then_force_fresh_read_page_before_business_actions'
        : 'wait_then_force_fresh_read_page_before_business_actions',
      claimBoundary: cdpHardFailure
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
