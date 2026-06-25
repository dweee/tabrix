import { normalizeUrlPattern, sanitizeValue } from './mke-memory-sanitizer';
import { objectFingerprint } from './mke-memory-object-identity';
import {
  readArray,
  readFiniteNumber,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

export function readResultCardStableTarget(input: {
  card: Record<string, unknown>;
  rawActionTarget: Record<string, unknown> | null;
}): {
  targetRef: string;
  candidateActionId: string | null;
} | null {
  const directTargetRef = readString(input.rawActionTarget?.targetRef);
  if (directTargetRef?.startsWith('ref_result_card_')) {
    return {
      targetRef: directTargetRef,
      candidateActionId: readString(input.rawActionTarget?.candidateActionId),
    };
  }
  const toolArgs = readObject(input.rawActionTarget?.toolArgs);
  const candidateAction = readObject(toolArgs?.candidateAction);
  const targetRef = readString(candidateAction?.targetRef);
  if (!targetRef?.startsWith('ref_result_card_')) return null;
  return {
    targetRef,
    candidateActionId: readString(candidateAction?.id),
  };
}

export function summarizeResultCardCollectionWindow(
  cards: readonly unknown[],
): Record<string, unknown> | null {
  let cardCount = 0;
  let minScrollY: number | null = null;
  let maxScrollY: number | null = null;
  let minGlobalTop: number | null = null;
  let maxGlobalTop: number | null = null;
  let minViewportTop: number | null = null;
  let maxViewportBottom: number | null = null;
  const sourceStrategies = new Set<string>();

  for (const rawCard of cards) {
    const card = readObject(rawCard);
    if (!card) continue;
    const actionTarget = readObject(card.actionTarget);
    const sourceScrollY = readNumber(card.sourceScrollY, actionTarget?.sourceScrollY);
    const firstSeenGlobalTop = readNumber(card.firstSeenGlobalTop);
    const rect = readObject(card.rect);
    const rectY = readNumber(rect?.y);
    const rectHeight = readNumber(rect?.height);
    const sourceStrategy = readString(card.sourceStrategy);
    cardCount += 1;

    if (sourceScrollY !== null) {
      minScrollY = minScrollY === null ? sourceScrollY : Math.min(minScrollY, sourceScrollY);
      maxScrollY = maxScrollY === null ? sourceScrollY : Math.max(maxScrollY, sourceScrollY);
    }
    if (firstSeenGlobalTop !== null) {
      minGlobalTop =
        minGlobalTop === null ? firstSeenGlobalTop : Math.min(minGlobalTop, firstSeenGlobalTop);
      maxGlobalTop =
        maxGlobalTop === null ? firstSeenGlobalTop : Math.max(maxGlobalTop, firstSeenGlobalTop);
    }
    if (rectY !== null) {
      minViewportTop = minViewportTop === null ? rectY : Math.min(minViewportTop, rectY);
      if (rectHeight !== null) {
        const viewportBottom = rectY + Math.max(0, rectHeight);
        maxViewportBottom =
          maxViewportBottom === null ? viewportBottom : Math.max(maxViewportBottom, viewportBottom);
      }
    }
    if (sourceStrategy) sourceStrategies.add(sourceStrategy);
  }

  if (cardCount === 0) return null;
  const summary: Record<string, unknown> = {
    cardCount,
  };
  if (minScrollY !== null && maxScrollY !== null) {
    summary.scrollYRange = { min: minScrollY, max: maxScrollY };
  }
  if (minGlobalTop !== null && maxGlobalTop !== null) {
    summary.globalTopRange = { min: minGlobalTop, max: maxGlobalTop };
  }
  if (minViewportTop !== null && maxViewportBottom !== null) {
    summary.viewportYRange = { min: minViewportTop, max: maxViewportBottom };
  }
  if (sourceStrategies.size > 0) {
    summary.sourceStrategies = Array.from(sourceStrategies).sort();
  }
  return summary;
}

export function summarizeResultCardSourceWindow(
  card: Record<string, unknown>,
  actionTarget: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const sourceWindow: Record<string, unknown> = {};
  const sourceScrollY = readNumber(card.sourceScrollY, actionTarget?.sourceScrollY);
  const firstSeenGlobalTop = readNumber(card.firstSeenGlobalTop);
  const sourceStrategy = readString(card.sourceStrategy);
  if (sourceScrollY !== null) sourceWindow.sourceScrollY = sourceScrollY;
  if (firstSeenGlobalTop !== null) sourceWindow.firstSeenGlobalTop = firstSeenGlobalTop;
  if (sourceStrategy) sourceWindow.sourceStrategy = sourceStrategy;
  return Object.keys(sourceWindow).length > 0 ? sourceWindow : null;
}

export function normalizeStableLocatorChain(value: unknown): string[] {
  return readArray(value)
    .map((entry): string | null => {
      const locator = readObject(entry);
      const type = readString(locator?.type);
      const rawValue = readString(locator?.value);
      if (!type || !rawValue) return null;
      if (type === 'ref' || type === 'coordinate' || type === 'rect') return null;
      if (!['css', 'xpath', 'aria', 'text', 'label'].includes(type)) return null;
      const normalizedValue = rawValue.trim().replace(/\s+/g, ' ').slice(0, 240);
      if (!normalizedValue) return null;
      return `${type}=${normalizedValue}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 4);
}

export function actionTargetIdentityKey(input: {
  action: Record<string, unknown>;
  targetRef: string;
  fallbackIndex: number;
}): string {
  const actionType = readString(input.action.actionType) ?? 'action';
  const intent = readString(input.action.intent, input.action.intentBoundary) ?? 'unknown_intent';
  const label = readString(
    input.action.label,
    input.action.text,
    input.action.accessibleName,
    input.action.name,
  )
    ?.trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const matchReason = readString(input.action.matchReason)
    ?.trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  const stableLocators = normalizeStableLocatorChain(input.action.locatorChain);
  const stableParts = [actionType, intent, label, matchReason, ...stableLocators].filter(
    (part): part is string => Boolean(part),
  );
  if (stableParts.length >= 3 || stableLocators.length > 0) {
    return objectFingerprint(...stableParts);
  }
  return input.targetRef || `target-${input.fallbackIndex}`;
}

export function regionChildObjectIdentityKey(input: {
  child: Record<string, unknown>;
  regionId: string;
  childType: string;
  fallbackIndex: number;
}): string {
  const explicitId = readString(input.child.objectId, input.child.id);
  if (explicitId) return explicitId;
  const role = readString(input.child.role, input.child.kind);
  const label = readString(input.child.label, input.child.text, input.child.name)
    ?.trim()
    .replace(/\s+/g, ' ')
    .slice(0, 120);
  const containerKind = readString(input.child.containerKind);
  const targetRef = readString(input.child.targetRef, input.child.ref);
  const detailTarget = readObject(input.child.detailTarget);
  const primaryAction = readObject(input.child.primaryAction);
  const stableLocators = [
    ...normalizeStableLocatorChain(detailTarget?.locatorChain),
    ...normalizeStableLocatorChain(primaryAction?.locatorChain),
  ].slice(0, 4);
  const stableParts = [
    input.regionId,
    input.childType,
    role,
    label,
    containerKind,
    ...stableLocators,
  ].filter((part): part is string => Boolean(part));
  if (stableParts.length >= 3 || stableLocators.length > 0) {
    return objectFingerprint(...stableParts);
  }
  return objectFingerprint(
    input.regionId,
    input.childType,
    targetRef ?? `object-${input.fallbackIndex}`,
  );
}

export function normalizeResultCardActionToolArgs(rawActionTarget: Record<string, unknown> | null):
  | {
      toolName: 'chrome_click_element';
      toolArgs: {
        candidateAction: {
          id: string | null;
          actionType: 'click';
          targetRef: string;
          confidence: number | null;
          matchReason: string | null;
          intent: 'content.open_detail';
          locatorChain: Array<{ type: string; value: string }>;
        };
      };
    }
  | Record<string, never> {
  if (readString(rawActionTarget?.toolName) !== 'chrome_click_element') return {};
  const toolArgs = readObject(rawActionTarget?.toolArgs);
  const candidateAction = readObject(toolArgs?.candidateAction);
  const targetRef = readString(candidateAction?.targetRef);
  if (!targetRef || !targetRef.startsWith('ref_result_card_')) return {};
  const actionType = readString(candidateAction?.actionType);
  const intent = readString(candidateAction?.intent);
  if (actionType !== 'click' || intent !== 'content.open_detail') return {};
  const locatorChain = readArray(candidateAction?.locatorChain)
    .map((entry) => {
      const locator = readObject(entry);
      const type = readString(locator?.type);
      const value = readString(locator?.value);
      if (!type || !value) return null;
      if (type !== 'ref' && type !== 'css') return null;
      if (type === 'ref' && value !== targetRef) return null;
      if (type === 'css' && value.length > 500) return null;
      return { type, value };
    })
    .filter((entry): entry is { type: string; value: string } => Boolean(entry));
  if (!locatorChain.some((locator) => locator.type === 'css')) return {};
  return {
    toolName: 'chrome_click_element',
    toolArgs: {
      candidateAction: {
        id: readString(candidateAction?.id),
        actionType: 'click',
        targetRef,
        confidence: readFiniteNumber(candidateAction?.confidence),
        matchReason: readString(candidateAction?.matchReason),
        intent: 'content.open_detail',
        locatorChain,
      },
    },
  };
}

export function normalizeResultCardOpenAction(rawActionTarget: Record<string, unknown> | null):
  | {
      openAction: {
        toolName: 'chrome_navigate';
        toolArgs: { url: string | null };
        executionScope: 'session_url';
        reason: 'result_card_href';
        confidence: number | null;
      };
    }
  | Record<string, never> {
  const openAction = readObject(rawActionTarget?.openAction);
  if (readString(openAction?.toolName) !== 'chrome_navigate') return {};
  const toolArgs = readObject(openAction?.toolArgs);
  const urlFields = normalizeUrlPattern(readString(toolArgs?.url), {
    allowPersonalBrowserStateStorage: false,
  });
  const normalizedUrl = urlFields.rootRoute ?? urlFields.currentRoute ?? urlFields.pattern;
  if (!normalizedUrl) return {};
  return {
    openAction: {
      toolName: 'chrome_navigate',
      toolArgs: { url: normalizedUrl },
      executionScope: 'session_url',
      reason: 'result_card_href',
      confidence: readFiniteNumber(openAction?.confidence),
    },
  };
}

export function summarizeCollectedResultCardForTrace(
  card: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!card) return null;
  const rawActionTarget = readObject(card.actionTarget);
  const stableTarget = readResultCardStableTarget({ card, rawActionTarget });
  return sanitizeValue(
    {
      rank: readNumber(card.rank),
      title: readString(card.title),
      url: normalizeUrlPattern(readString(card.url), {
        allowPersonalBrowserStateStorage: false,
      }).rootRoute,
      stableTarget,
      targetabilityStatus: readString(card.targetabilityStatus),
      imageCount: readNumber(card.imageCount),
      interactionText: readString(card.interactionText),
    },
    'memory_trace',
  ) as Record<string, unknown>;
}
