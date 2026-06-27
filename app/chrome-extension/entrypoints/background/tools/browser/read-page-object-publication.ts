import type { ReadPageHighValueObject } from '@tabrix/shared';

import type { CandidateActionSeed } from './read-page-candidate-actions';
import {
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
  type CandidateActionTargetLocatorEntry,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';

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
      const cssLocator = Array.isArray(candidateAction.locatorChain)
        ? candidateAction.locatorChain.find(
            (locator: { type?: string; value?: string } | null | undefined) =>
              locator?.type === 'css',
          )
        : undefined;
      const selector = typeof cssLocator?.value === 'string' ? cssLocator.value.trim() : '';
      if (!selector) continue;
      entries.push({
        targetRef,
        selector,
        selectorType: 'css',
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
