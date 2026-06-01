import {
  STABLE_TARGET_REF_PREFIX,
  type ReadPageCandidateAction,
  type ReadPageCandidateActionLocator,
} from '@tabrix/shared';

export type CandidateActionSelectorType = 'css' | 'xpath';

export type CandidateActionInput = Partial<
  Pick<ReadPageCandidateAction, 'targetRef' | 'locatorChain' | 'intent' | 'frameId'>
>;

export interface ResolvedStableTargetRefEntry {
  ref: string;
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
  type: 'ref' | 'css',
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

export function resolveCandidateActionTarget(
  params: ResolveCandidateActionTargetParams,
): ResolvedCandidateActionTarget {
  const candidateFrameId = asFiniteFrameId(params.candidateAction?.frameId);
  const explicitRef = asNonEmptyString(params.explicitRef);
  if (explicitRef) {
    // AI callers often copy the AI-facing `targetRef` into `ref`. Stable
    // `tgt_*` values are not page-local refs, so route them through the same
    // live snapshot registry instead of forwarding a guaranteed-miss handle.
    if (isStableTargetRef(explicitRef)) {
      return resolveStableTargetRef(params, explicitRef);
    }
    return {
      ref: explicitRef,
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'explicit_ref',
    };
  }

  const locatorRef = firstLocatorValue(params.candidateAction?.locatorChain, 'ref');
  const locatorCss = firstLocatorValue(params.candidateAction?.locatorChain, 'css');
  const candidateTargetRef = asNonEmptyString(params.candidateAction?.targetRef);
  if (candidateTargetRef) {
    if (
      (isSyntheticTextMenuRef(candidateTargetRef) || isFallbackRef(candidateTargetRef)) &&
      locatorCss
    ) {
      return {
        selector: locatorCss,
        selectorType: 'css',
        ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
        source: 'candidate_locator_css',
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

  if (locatorRef && isSyntheticTextMenuRef(locatorRef) && locatorCss) {
    return {
      selector: locatorCss,
      selectorType: 'css',
      ...(candidateFrameId !== undefined ? { frameId: candidateFrameId } : {}),
      source: 'candidate_locator_css',
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
