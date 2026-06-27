import type { ReadPageHighValueObject } from '@tabrix/shared';

import type { CandidateActionSeed } from './read-page-candidate-actions';
import {
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
  type CandidateActionTargetLocatorEntry,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';

function firstUsableLocator(
  locatorChain: unknown,
): Pick<CandidateActionTargetLocatorEntry, 'selector' | 'selectorType'> | undefined {
  if (!Array.isArray(locatorChain)) return undefined;
  const xpathLocator = locatorChain.find(
    (locator: { type?: string; value?: string } | null | undefined) =>
      locator?.type === 'xpath' && typeof locator.value === 'string' && locator.value.trim(),
  );
  const xpathSelector = typeof xpathLocator?.value === 'string' ? xpathLocator.value.trim() : '';
  if (xpathSelector) {
    return { selector: xpathSelector, selectorType: 'xpath' };
  }

  const cssLocator = locatorChain.find(
    (locator: { type?: string; value?: string } | null | undefined) =>
      locator?.type === 'css' && typeof locator.value === 'string' && locator.value.trim(),
  );
  const cssSelector = typeof cssLocator?.value === 'string' ? cssLocator.value.trim() : '';
  return cssSelector ? { selector: cssSelector, selectorType: 'css' } : undefined;
}

export function recordReadPageTargetPublication(params: {
  tabId: number;
  highValueObjects?: readonly ReadPageHighValueObject[] | null;
  candidateActions?: readonly CandidateActionSeed[] | null;
  frameId?: number;
}): void {
  if (Array.isArray(params.highValueObjects)) {
    const entries: StableTargetRefEntry[] = [];
    for (const highValueObject of params.highValueObjects) {
      if (highValueObject.targetRef && highValueObject.ref) {
        entries.push({
          targetRef: highValueObject.targetRef,
          ref: highValueObject.ref,
          ...(typeof params.frameId === 'number' ? { frameId: params.frameId } : {}),
        });
      }
    }
    recordStableTargetRefSnapshot(params.tabId, entries);
  }

  if (Array.isArray(params.candidateActions)) {
    const entries: CandidateActionTargetLocatorEntry[] = [];
    for (const candidateAction of params.candidateActions) {
      const targetRef =
        typeof candidateAction?.targetRef === 'string' ? candidateAction.targetRef.trim() : '';
      if (!targetRef) continue;
      const locator = firstUsableLocator(candidateAction.locatorChain);
      if (!locator) continue;
      entries.push({
        targetRef,
        ...locator,
        ...(typeof candidateAction.frameId === 'number'
          ? { frameId: candidateAction.frameId }
          : typeof params.frameId === 'number'
            ? { frameId: params.frameId }
            : {}),
      });
    }
    recordCandidateActionTargetLocatorsSnapshot(params.tabId, entries);
  }
}
