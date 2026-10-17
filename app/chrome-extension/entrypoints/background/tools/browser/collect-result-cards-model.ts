import { mergeCrossScrollObjects } from './cross-scroll-object-merge';

export interface CollectedResultCard {
  title: string;
  url?: string;
  actionTarget?: {
    actionType: 'click';
    targetKind: 'result_card_link';
    url?: string;
    selector?: string;
    text?: string;
    executionScope?: 'same_tab_fresh_snapshot' | 'session_url';
    openAction?: {
      toolName: 'chrome_navigate';
      toolArgs: { url: string };
      executionScope: 'session_url';
      reason: 'result_card_href';
      confidence: number;
    };
    toolName?: 'chrome_click_element';
    toolArgs?: {
      candidateAction: {
        id: string;
        actionType: 'click';
        targetRef: string;
        label?: string;
        confidence: number;
        matchReason: string;
        intent: 'content.open_detail';
        locatorChain: Array<{ type: 'ref' | 'aria' | 'css' | string; value: string }>;
      };
    };
    rect?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    center?: {
      x: number;
      y: number;
    };
    coordinateFrame?: 'viewport';
    sourceScrollY?: number;
    confidence: number;
    reasons: string[];
  };
  primaryText?: string;
  secondaryText?: string;
  metaText?: string;
  interactionText?: string;
  author?: string;
  time?: string;
  interaction?: string;
  likes?: string;
  imageCount: number;
  sourceScrollY: number;
  firstSeenGlobalTop: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  reasons: string[];
  sourceStrategy?: 'list_container' | 'candidate_scan';
}

export interface CollectedResultCardStableTarget {
  targetRef: string;
  candidateActionId: string;
}

export interface CollectedResultCardTargetabilitySummary {
  stableClickTargetCount: number;
  urlFallbackCount: number;
  untargetableCount: number;
  targetRefCoverageRate: number;
  status: 'stable_target_set' | 'partial_stable_targets' | 'url_or_text_only';
}

export interface CollectedResultCardAiSummary {
  rank: number;
  title: string;
  url?: string;
  author?: string;
  time?: string;
  interaction?: string;
  likes?: string;
  targetRef?: string;
  candidateActionId?: string;
  targetabilityStatus: 'stable_click_target' | 'url_fallback' | 'not_targetable';
  confidence: number;
}

export function stableResultCardTarget(
  card: CollectedResultCard | undefined,
): CollectedResultCardStableTarget | null {
  const candidate = card?.actionTarget?.toolArgs?.candidateAction;
  const targetRef = candidate?.targetRef;
  const candidateActionId = candidate?.id;
  if (
    card?.actionTarget?.toolName !== 'chrome_click_element' ||
    card.actionTarget.executionScope !== 'same_tab_fresh_snapshot' ||
    card.actionTarget.reasons.includes('visible_detail_link_unverified_hit') ||
    typeof targetRef !== 'string' ||
    targetRef.length === 0 ||
    typeof candidateActionId !== 'string' ||
    candidateActionId.length === 0
  ) {
    return null;
  }
  return { targetRef, candidateActionId };
}

export function summarizeCollectedResultCardTargetability(
  cards: readonly CollectedResultCard[],
): CollectedResultCardTargetabilitySummary {
  let stableClickTargetCount = 0;
  let urlFallbackCount = 0;
  let untargetableCount = 0;
  for (const card of cards) {
    if (stableResultCardTarget(card)) {
      stableClickTargetCount += 1;
    } else if (normalizeText(card.url).length > 0) {
      urlFallbackCount += 1;
    } else {
      untargetableCount += 1;
    }
  }
  const targetRefCoverageRate =
    cards.length > 0 ? Number((stableClickTargetCount / cards.length).toFixed(4)) : 0;
  return {
    stableClickTargetCount,
    urlFallbackCount,
    untargetableCount,
    targetRefCoverageRate,
    status:
      cards.length > 0 && stableClickTargetCount === cards.length
        ? 'stable_target_set'
        : stableClickTargetCount > 0
          ? 'partial_stable_targets'
          : 'url_or_text_only',
  };
}

export function summarizeCollectedResultCardsForAi(
  cards: readonly CollectedResultCard[],
): CollectedResultCardAiSummary[] {
  return cards.map((card, index) => {
    const stableTarget = stableResultCardTarget(card);
    const semanticCard = withCollectedResultCardSemanticAliases(card);
    return {
      rank: index + 1,
      title: semanticCard.title,
      ...(semanticCard.url ? { url: semanticCard.url } : {}),
      ...(semanticCard.author ? { author: semanticCard.author } : {}),
      ...(semanticCard.time ? { time: semanticCard.time } : {}),
      ...(semanticCard.interaction ? { interaction: semanticCard.interaction } : {}),
      ...(semanticCard.likes ? { likes: semanticCard.likes } : {}),
      ...(stableTarget
        ? {
            targetRef: stableTarget.targetRef,
            candidateActionId: stableTarget.candidateActionId,
            targetabilityStatus: 'stable_click_target' as const,
          }
        : card.url
          ? { targetabilityStatus: 'url_fallback' as const }
          : { targetabilityStatus: 'not_targetable' as const }),
      confidence: card.confidence,
    };
  });
}

export function withCollectedResultCardSemanticAliases(
  card: CollectedResultCard,
): CollectedResultCard {
  const author = card.author || card.primaryText;
  const time = card.time || card.metaText;
  const interaction = card.interaction || card.interactionText;
  const likes = card.likes || interaction;
  return {
    ...card,
    ...(author ? { author } : {}),
    ...(time ? { time } : {}),
    ...(interaction ? { interaction } : {}),
    ...(likes ? { likes } : {}),
  };
}

function hasExecutableClickTarget(card: CollectedResultCard | undefined): boolean {
  return stableResultCardTarget(card) !== null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GENERIC_CONTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{5,}$/i;

const NON_CONTENT_ROUTE_SEGMENTS = new Set([
  'account',
  'api',
  'auth',
  'assets',
  'category',
  'channel',
  'login',
  'notification',
  'notifications',
  'profile',
  'search',
  'settings',
  'static',
  'tag',
  'tags',
  'user',
  'users',
]);

function normalizeResultCardUrlKey(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://example.invalid');
    const lowerHost = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    const leaf = segments[segments.length - 1] ?? '';
    const parentSegment = (segments[segments.length - 2] ?? '').toLowerCase();
    if (
      segments.length >= 2 &&
      GENERIC_CONTENT_ID_PATTERN.test(leaf) &&
      !NON_CONTENT_ROUTE_SEGMENTS.has(parentSegment)
    ) {
      return `${url.protocol}//${lowerHost}/content/${leaf.toLowerCase()}`;
    }
    return `${url.protocol}//${lowerHost}${url.pathname}`.toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, '').toLowerCase();
  }
}

export function resultCardKey(card: Pick<CollectedResultCard, 'title' | 'url'>): string {
  const title = normalizeText(card.title).toLowerCase();
  const url = normalizeResultCardUrlKey(card.url);
  return url ? `${title}|${url}` : title;
}

export function mergeCollectedResultCards(
  current: readonly CollectedResultCard[],
  incoming: readonly CollectedResultCard[],
  limit: number,
): CollectedResultCard[] {
  return mergeCrossScrollObjects<CollectedResultCard>({
    current,
    incoming,
    limit,
    keyOf: resultCardKey,
    mergeDuplicate: (existing, card) => ({
      ...existing,
      url: existing.url || card.url,
      actionTarget: hasExecutableClickTarget(card)
        ? card.actionTarget
        : hasExecutableClickTarget(existing)
          ? existing.actionTarget
          : existing.actionTarget || card.actionTarget,
      primaryText: existing.primaryText || card.primaryText,
      secondaryText: existing.secondaryText || card.secondaryText,
      metaText: existing.metaText || card.metaText,
      interactionText: existing.interactionText || card.interactionText,
      imageCount: Math.max(existing.imageCount, card.imageCount),
      confidence: Math.max(existing.confidence, card.confidence),
      reasons: [...new Set([...existing.reasons, ...card.reasons])],
      sourceStrategy: existing.sourceStrategy ?? card.sourceStrategy,
    }),
    compare: (left, right) => left.firstSeenGlobalTop - right.firstSeenGlobalTop,
  });
}
