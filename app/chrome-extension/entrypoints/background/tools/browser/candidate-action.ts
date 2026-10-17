import {
  STABLE_TARGET_REF_PREFIX,
  type ReadPageCandidateAction,
  type ReadPageCandidateActionLocator,
} from '@tabrix/shared';

export type CandidateActionSelectorType = 'css' | 'xpath';

export type CandidateActionInput = Partial<
  Pick<
    ReadPageCandidateAction,
    | 'targetRef'
    | 'locatorChain'
    | 'intent'
    | 'frameId'
    | 'label'
    | 'snapshotRect'
    | 'visibility'
    | 'executionTargetKind'
  >
>;

export interface ResolvedStableTargetRefEntry {
  ref: string;
  frameId?: number;
}

export interface ResolvedCandidateActionTargetLocatorEntry {
  selector: string;
  selectorType?: CandidateActionSelectorType;
  frameId?: number;
}

/**
 * Optional stable-targetRef hooks. Kept as a thin functional interface
 * so the click bridge can pass in a real registry while unit tests pass
 * a stub.
 *
 * The contract is intentionally narrow:
 *   - `tabId` is the tab the resolved click will target. Without it the
 *     resolver cannot scope the registry lookup.
 *   - `lookupStableTargetRef(tabId, targetRef)` returns the live per-snapshot
 *     `ref` for `targetRef`, or `undefined` if there is no current mapping
 *     (e.g. service worker evicted, page navigated, registry never written).
 */
export interface ResolveCandidateActionTargetParams {
  explicitRef?: string;
  explicitSelector?: string;
  explicitSelectorType?: CandidateActionSelectorType;
  candidateAction?: CandidateActionInput;
  /** Tab the click will execute against. Required for stable-targetRef lookup. */
  tabId?: number;
  /** Lookup function injected by the caller. */
  lookupStableTargetRef?: (
    tabId: number,
    targetRef: string,
  ) => string | ResolvedStableTargetRefEntry | undefined;
  /**
   * Optional lookup for AI-facing fallback/synthetic refs that came from the
   * most recent read_page candidateAction list. This lets a caller pass only
   * `candidateAction.targetRef` while still dispatching through the recorded
   * CSS locator for the same tab snapshot.
   */
  lookupCandidateActionTargetLocator?: (
    tabId: number,
    targetRef: string,
  ) => ResolvedCandidateActionTargetLocatorEntry | undefined;
}

export interface ResolvedCandidateActionTarget {
  ref?: string;
  selector?: string;
  selectorType?: CandidateActionSelectorType;
  source:
    | 'explicit_ref'
    | 'candidate_stable_target_ref'
    | 'candidate_target_ref'
    | 'explicit_selector'
    | 'candidate_locator_ref'
    | 'candidate_locator_css'
    | 'candidate_locator_xpath'
    | 'candidate_snapshot_rect'
    | 'candidate_snapshot_locator_css'
    | 'candidate_snapshot_locator_xpath'
    | 'none'
    | 'unresolved_stable_target_ref';
  /**
   * When `source === 'unresolved_stable_target_ref'` this carries the
   * literal `tgt_*` value the caller supplied so the click bridge can
   * surface it in the error message and tell the upstream LLM exactly
   * what to re-read.
   */
  unresolvedStableTargetRef?: string;
  frameId?: number;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asFiniteFrameId(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.trunc(value);
}

function firstLocatorValue(
  locatorChain: ReadPageCandidateActionLocator[] | undefined,
  type: 'ref' | 'css' | 'xpath',
): string | undefined {
  if (!Array.isArray(locatorChain)) return undefined;
  for (const locator of locatorChain) {
    if (locator?.type !== type) continue;
    const value = asNonEmptyString(locator.value);
    if (value) return value;
  }
  return undefined;
}

function isStableTargetRef(value: string): boolean {
  return value.startsWith(STABLE_TARGET_REF_PREFIX);
}

function isSyntheticTextMenuRef(value: string): boolean {
  return value.startsWith('ref_text_menu_');
}

function isSyntheticSearchToolbarRef(value: string): boolean {
  return value.startsWith('ref_text_search_toolbar_');
}

function isSyntheticSearchInputRef(value: string): boolean {
  return value.startsWith('ref_search_input_');
}

function isSyntheticFilterPanelRef(value: string): boolean {
  return value.startsWith('ref_text_filter_panel_');
}

function isSyntheticFilterControlRef(value: string): boolean {
  return value.startsWith('ref_filter_');
}

function isSyntheticFloatingOptionRef(value: string): boolean {
  return value.startsWith('ref_floating_option_');
}

function isSyntheticDynamicSurfaceRef(value: string): boolean {
  return value.startsWith('ref_dynamic_surface_');
}

function isSyntheticResultCardRef(value: string): boolean {
  return value.startsWith('ref_result_card_');
}

function isLocatorBackedSyntheticRef(value: string): boolean {
  return (
    isSyntheticTextMenuRef(value) ||
    isSyntheticSearchToolbarRef(value) ||
    isSyntheticSearchInputRef(value) ||
    isSyntheticFilterPanelRef(value) ||
    isSyntheticFilterControlRef(value) ||
    isSyntheticFloatingOptionRef(value) ||
    isSyntheticDynamicSurfaceRef(value) ||
    isSyntheticResultCardRef(value)
  );
}

function candidateActionRequiresSnapshotLocator(
  params: ResolveCandidateActionTargetParams,
  value: string,
): boolean {
  const candidateTargetRef = asNonEmptyString(params.candidateAction?.targetRef);
  const locatorRef = firstLocatorValue(params.candidateAction?.locatorChain, 'ref');
  return (
    params.candidateAction?.executionTargetKind === 'snapshot_locator' &&
    (candidateTargetRef === value || locatorRef === value)
  );
}

function isFallbackRef(value: string): boolean {
  return value.startsWith('ref_fallback_');
}

function resolveStableTargetRef(params: ResolveCandidateActionTargetParams, targetRef: string) {
  const lookup = params.lookupStableTargetRef;
  const tabId = params.tabId;
  const candidateFrameId = asFiniteFrameId(params.candidateAction?.frameId);
  if (lookup && typeof tabId === 'number') {
    const resolved = lookup(tabId, targetRef);
    if (resolved) {
      if (typeof resolved === 'object') {
        const frameId = typeof resolved.frameId === 'number' ? resolved.frameId : candidateFrameId;
        return {
          ref: resolved.ref,
          ...(typeof frameId === 'number' ? { frameId } : {}),
          source: 'candidate_stable_target_ref' as const,
        };
      }
      return {
        ref: resolved,
        ...(typeof candidateFrameId === 'number' ? { frameId: candidateFrameId } : {}),
        source: 'candidate_stable_target_ref' as const,
      };
    }
  }
  return {
    source: 'unresolved_stable_target_ref' as const,
    unresolvedStableTargetRef: targetRef,
  };
}

function resolveCandidateActionTargetLocator(
  params: ResolveCandidateActionTargetParams,
  targetRef: string,
) {
  const lookup = params.lookupCandidateActionTargetLocator;
  const tabId = params.tabId;
  const candidateFrameId = asFiniteFrameId(params.candidateAction?.frameId);
  if (!lookup || typeof tabId !== 'number') return undefined;
  const resolved = lookup(tabId, targetRef);
  const selector = asNonEmptyString(resolved?.selector);
  if (!selector) return undefined;
  const frameId = typeof resolved?.frameId === 'number' ? resolved.frameId : candidateFrameId;
  return {
    selector,
    selectorType: resolved?.selectorType || ('css' as const),
    ...(typeof frameId === 'number' ? { frameId } : {}),
    source:
      resolved?.selectorType === 'xpath'
        ? ('candidate_snapshot_locator_xpath' as const)
        : ('candidate_snapshot_locator_css' as const),
  };
}

function resolveFreshCandidateLocator(params: {
  locatorXpath: string | undefined;
  locatorCss: string | undefined;
  candidateFrameId: number | undefined;
}): ResolvedCandidateActionTarget | undefined {
  if (params.locatorXpath) {
    return {
      selector: params.locatorXpath,
      selectorType: 'xpath',
      ...(params.candidateFrameId !== undefined ? { frameId: params.candidateFrameId } : {}),
      source: 'candidate_locator_xpath',
    };
  }
  if (params.locatorCss) {
    return {
      selector: params.locatorCss,
      selectorType: 'css',
      ...(params.candidateFrameId !== undefined ? { frameId: params.candidateFrameId } : {}),
      source: 'candidate_locator_css',
    };
  }
  return undefined;
}

function resolveFreshCandidateXpath(params: {
  locatorXpath: string | undefined;
  candidateFrameId: number | undefined;
}): ResolvedCandidateActionTarget | undefined {
  if (!params.locatorXpath) return undefined;
  return {
    selector: params.locatorXpath,
    selectorType: 'xpath',
    ...(params.candidateFrameId !== undefined ? { frameId: params.candidateFrameId } : {}),
    source: 'candidate_locator_xpath',
  };
}

function resolveFreshCandidateCss(params: {
  locatorCss: string | undefined;
  candidateFrameId: number | undefined;
}): ResolvedCandidateActionTarget | undefined {
  if (!params.locatorCss) return undefined;
  return {
    selector: params.locatorCss,
    selectorType: 'css',
    ...(params.candidateFrameId !== undefined ? { frameId: params.candidateFrameId } : {}),
    source: 'candidate_locator_css',
  };
}

function resolveCurrentSnapshotLocator(
  params: ResolveCandidateActionTargetParams & {
    targetRef: string;
    locatorXpath: string | undefined;
    locatorCss: string | undefined;
    candidateFrameId: number | undefined;
  },
): ResolvedCandidateActionTarget | undefined {
  const registeredLocator = resolveCandidateActionTargetLocator(params, params.targetRef);
  if (registeredLocator?.selectorType !== 'xpath' && registeredLocator) {
    return registeredLocator;
  }
  const freshCss = resolveFreshCandidateCss(params);
  if (freshCss) return freshCss;
  if (registeredLocator) return registeredLocator;
  return resolveFreshCandidateXpath(params);
}

export function resolveCandidateActionTarget(
  params: ResolveCandidateActionTargetParams,
): ResolvedCandidateActionTarget {
  const candidateFrameId = asFiniteFrameId(params.candidateAction?.frameId);
  const locatorRef = firstLocatorValue(params.candidateAction?.locatorChain, 'ref');
  const locatorXpath = firstLocatorValue(params.candidateAction?.locatorChain, 'xpath');
  const locatorCss = firstLocatorValue(params.candidateAction?.locatorChain, 'css');
  const candidateTargetRef = asNonEmptyString(params.candidateAction?.targetRef);
  const explicitRef = asNonEmptyString(params.explicitRef);
  if (explicitRef) {
    // AI callers often copy the AI-facing `targetRef` into `ref`. Stable
    // `tgt_*` values are not page-local refs, so route them through the same
    // live snapshot registry instead of forwarding a guaranteed-miss handle.
    // Synthetic text refs are also AI-facing handles; prefer the latest
    // read_page snapshot registry before falling back to the caller's
    // locatorChain, because the registry is scoped to the current tab view.
    if (isStableTargetRef(explicitRef)) {
      return resolveStableTargetRef(params, explicitRef);
    }
    if (
      isLocatorBackedSyntheticRef(explicitRef) ||
      candidateActionRequiresSnapshotLocator(params, explicitRef)
    ) {
      if (candidateActionRequiresSnapshotLocator(params, explicitRef)) {
        const snapshotLocator = resolveCurrentSnapshotLocator({
          ...params,
          targetRef: explicitRef,
          locatorXpath,
          locatorCss,
          candidateFrameId,
        });
        if (snapshotLocator) return snapshotLocator;
        return {
          ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
          source: 'none',
        };
      }
      const freshXpath = resolveFreshCandidateXpath({ locatorXpath, candidateFrameId });
      if (freshXpath) return freshXpath;
      const resolvedLocator = resolveCandidateActionTargetLocator(params, explicitRef);
      if (resolvedLocator) return resolvedLocator;
      const freshCss = resolveFreshCandidateCss({
        locatorCss,
        candidateFrameId,
      });
      if (freshCss) return freshCss;
      return {
        ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
        source: 'none',
      };
    }
    if (isFallbackRef(explicitRef)) {
      const resolvedLocator = resolveCandidateActionTargetLocator(params, explicitRef);
      if (resolvedLocator) return resolvedLocator;
      return {
        ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
        source: 'none',
      };
    }
    return {
      ref: explicitRef,
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'explicit_ref',
    };
  }

  if (candidateTargetRef) {
    if (
      isLocatorBackedSyntheticRef(candidateTargetRef) ||
      candidateActionRequiresSnapshotLocator(params, candidateTargetRef)
    ) {
      if (candidateActionRequiresSnapshotLocator(params, candidateTargetRef)) {
        const snapshotLocator = resolveCurrentSnapshotLocator({
          ...params,
          targetRef: candidateTargetRef,
          locatorXpath,
          locatorCss,
          candidateFrameId,
        });
        if (snapshotLocator) return snapshotLocator;
      } else {
        const freshXpath = resolveFreshCandidateXpath({ locatorXpath, candidateFrameId });
        if (freshXpath) return freshXpath;
        const resolvedLocator = resolveCandidateActionTargetLocator(params, candidateTargetRef);
        if (resolvedLocator) return resolvedLocator;
        const freshCss = resolveFreshCandidateCss({
          locatorCss,
          candidateFrameId,
        });
        if (freshCss) return freshCss;
      }
    }

    if (isFallbackRef(candidateTargetRef)) {
      const resolvedLocator = resolveCandidateActionTargetLocator(params, candidateTargetRef);
      if (resolvedLocator) return resolvedLocator;
      const freshLocator = resolveFreshCandidateLocator({
        locatorXpath,
        locatorCss,
        candidateFrameId,
      });
      if (freshLocator) return freshLocator;
    }

    if (
      isLocatorBackedSyntheticRef(candidateTargetRef) ||
      candidateActionRequiresSnapshotLocator(params, candidateTargetRef) ||
      isFallbackRef(candidateTargetRef)
    ) {
      if (isFallbackRef(candidateTargetRef)) {
        return {
          ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
          source: 'none',
        };
      }
    }

    if (
      isSyntheticSearchToolbarRef(candidateTargetRef) ||
      isSyntheticSearchInputRef(candidateTargetRef) ||
      isSyntheticFilterPanelRef(candidateTargetRef) ||
      isSyntheticFilterControlRef(candidateTargetRef) ||
      isSyntheticDynamicSurfaceRef(candidateTargetRef)
    ) {
      return {
        ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
        source: 'none',
      };
    }

    // Stable targetRefs (`tgt_*`) MUST route through the per-tab snapshot
    // registry. They are not valid accessibility-tree handles, so
    // forwarding one straight to the content script would always miss.
    // Failing closed here also prevents the click bridge from silently
    // aiming at a stale per-snapshot ref that happens to share a prefix.
    if (isStableTargetRef(candidateTargetRef)) {
      return resolveStableTargetRef(params, candidateTargetRef);
    }
    return {
      ref: candidateTargetRef,
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'candidate_target_ref',
    };
  }

  const explicitSelector = asNonEmptyString(params.explicitSelector);
  if (explicitSelector) {
    return {
      selector: explicitSelector,
      selectorType: params.explicitSelectorType || 'css',
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'explicit_selector',
    };
  }

  if (
    locatorRef &&
    (isLocatorBackedSyntheticRef(locatorRef) ||
      candidateActionRequiresSnapshotLocator(params, locatorRef)) &&
    locatorCss
  ) {
    return {
      selector: locatorCss,
      selectorType: 'css',
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'candidate_locator_css',
    };
  }

  if (
    locatorRef &&
    (isSyntheticSearchToolbarRef(locatorRef) ||
      isSyntheticSearchInputRef(locatorRef) ||
      isSyntheticFilterPanelRef(locatorRef) ||
      isSyntheticFilterControlRef(locatorRef) ||
      isSyntheticDynamicSurfaceRef(locatorRef))
  ) {
    return {
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'none',
    };
  }

  if (locatorRef) {
    return {
      ref: locatorRef,
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'candidate_locator_ref',
    };
  }

  if (locatorCss) {
    return {
      selector: locatorCss,
      selectorType: 'css',
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'candidate_locator_css',
    };
  }

  return { source: 'none' };
}
