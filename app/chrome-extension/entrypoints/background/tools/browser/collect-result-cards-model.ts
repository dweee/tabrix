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
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    center: {
      x: number;
      y: number;
    };
    coordinateFrame: 'viewport';
    sourceScrollY: number;
    confidence: number;
    reasons: string[];
  };
  primaryText?: string;
  secondaryText?: string;
  metaText?: string;
  interactionText?: string;
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

function hasExecutableClickTarget(card: CollectedResultCard | undefined): boolean {
  return (
    card?.actionTarget?.toolName === 'chrome_click_element' &&
    Boolean(card.actionTarget.toolArgs?.candidateAction)
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResultCardUrlKey(value: unknown): string {
  const raw = normalizeText(value);
  if (!raw) return '';
  try {
    const url = new URL(raw, 'https://example.invalid');
    const lowerHost = url.hostname.toLowerCase();
    const noteIdMatch = /^\/(?:search_result|explore)\/([^/?#]+)/i.exec(url.pathname);
    if (lowerHost.endsWith('xiaohongshu.com') && noteIdMatch?.[1]) {
      return `${url.protocol}//${lowerHost}/note/${noteIdMatch[1].toLowerCase()}`;
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
  const byKey = new Map<string, CollectedResultCard>();
  for (const card of [...current, ...incoming]) {
    const key = resultCardKey(card);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, card);
      continue;
    }
    byKey.set(key, {
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
    });
  }
  return [...byKey.values()]
    .sort((left, right) => left.firstSeenGlobalTop - right.firstSeenGlobalTop)
    .slice(0, limit);
}
