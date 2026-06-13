import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import { markBrowserWorldTabAiOperated } from '../../browser-world-inventory';
import { type CollectedResultCard, mergeCollectedResultCards } from './collect-result-cards-model';

interface CollectResultCardsParams {
  tabId?: number;
  windowId?: number;
  minResults?: number;
  maxScrolls?: number;
  scrollStepPx?: number;
  settleMs?: number;
  startFromTop?: boolean;
}

interface VisibleCardScanResult {
  cards: CollectedResultCard[];
  pageInfo: {
    url: string;
    title: string;
    viewport: { width: number; height: number; dpr: number };
    scrollY: number;
    scrollHeight: number;
    pixelsBelow: number;
  };
}

interface ScrollStepResult {
  beforeY: number;
  afterY: number;
  scrollHeight: number;
  viewportHeight: number;
  pixelsBelow: number;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.round(numeric)));
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function scanVisibleResultCardsInPage(): VisibleCardScanResult {
  const normalize = (value: unknown): string =>
    String(value ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  const shellPattern =
    /^(搜索|筛选|排序|登录|注册|首页|消息|通知|发现|我|更多|展开|收起|关注|推荐|大家都在搜|猜你想搜|相关搜索|热门搜索|全部|图文|视频|用户|search|filter|sort|login|home|more|all|images?|videos?|users?|related searches?|popular searches?)$/i;
  const metaPattern =
    /(\d+\s*(秒|分钟|小时|天|周|月|年)前|昨天|今天|刚刚|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}|ago|today|yesterday)/i;
  const interactionPattern =
    /(收藏|点赞|评论|赞|喜欢|saves?|likes?|comments?|[0-9][0-9,.]*\s*(万|千|k|m)?)/i;
  const listContainerSelector = [
    '[role="feed"]',
    '[role="list"]',
    '[class*="feed"]',
    '[class*="Feed"]',
    '[class*="list"]',
    '[class*="List"]',
    '[class*="grid"]',
    '[class*="Grid"]',
    '[class*="waterfall"]',
    '[class*="Waterfall"]',
    '[class*="masonry"]',
    '[class*="Masonry"]',
  ].join(',');
  const cardCandidateSelector = [
    'article',
    'section',
    '[role="article"]',
    '[role="listitem"]',
    'li',
    '[class*="card"]',
    '[class*="Card"]',
    '[class*="item"]',
    '[class*="Item"]',
    '[class*="note"]',
    '[class*="Note"]',
  ].join(',');

  const textLines = (element: Element): string[] => {
    const raw = normalize((element as HTMLElement).innerText || element.textContent || '');
    return raw
      .split(/\n| {2,}/)
      .map((line) => normalize(line))
      .filter((line) => line.length > 0 && line.length <= 160)
      .filter((line) => !shellPattern.test(line))
      .slice(0, 10);
  };

  const visibleRect = (element: Element): DOMRect | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 48 || rect.height < 36) return null;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
    if (rect.right < 0 || rect.left > window.innerWidth) return null;
    return rect;
  };

  const visibleLinkRect = (element: Element): DOMRect | null => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 12) return null;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return null;
    if (rect.right < 0 || rect.left > window.innerWidth) return null;
    return rect;
  };

  const cssEscape = (value: string): string => {
    const css = (window as { CSS?: { escape?: (input: string) => string } }).CSS;
    if (css?.escape) return css.escape(value);
    return value.replace(/["\\#.:,[\]\s>+~]/g, '\\$&');
  };

  const selectorForElement = (element: Element): string | undefined => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement
    ) {
      const tag = current.tagName.toLowerCase();
      const id = current.getAttribute('id');
      if (id) {
        parts.unshift(`${tag}#${cssEscape(id)}`);
        break;
      }

      const stableAttr = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'title']
        .map((name) => {
          const raw = current?.getAttribute(name);
          const value = normalize(raw);
          return value && value.length <= 80 ? { name, value } : null;
        })
        .find((item): item is { name: string; value: string } => Boolean(item));
      let part = tag;
      if (stableAttr) {
        part += `[${stableAttr.name}="${cssEscape(stableAttr.value)}"]`;
      } else if (current.parentElement) {
        const siblings = Array.from(current.parentElement.children).filter(
          (child) => child.tagName === current?.tagName,
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      parts.unshift(part);
      if (tag === 'body') break;
      current = current.parentElement;
    }

    if (parts.length === 0) return undefined;
    return parts.join(' > ');
  };

  const linkText = (link: HTMLAnchorElement): string =>
    normalize(link.innerText || link.textContent || link.getAttribute('aria-label') || '');

  const isXiaohongshuDetailLink = (link: HTMLAnchorElement): boolean => {
    try {
      const url = new URL(link.href);
      return (
        url.hostname.toLowerCase().endsWith('xiaohongshu.com') &&
        /^\/(?:search_result|explore)\/[^/?#]+/i.test(url.pathname)
      );
    } catch {
      return false;
    }
  };

  const isLikelyProfileLink = (link: HTMLAnchorElement): boolean => {
    try {
      return /^\/user\/profile\//i.test(new URL(link.href).pathname);
    } catch {
      return false;
    }
  };

  const linkOwnsCenterPoint = (link: HTMLAnchorElement, rect: DOMRect): boolean => {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    const hitLink = hit.closest('a[href]');
    return hit === link || link.contains(hit) || hitLink === link;
  };

  const primaryLinkForCard = (
    links: readonly HTMLAnchorElement[],
    title: string,
  ): { link: HTMLAnchorElement; rect: DOMRect; reasons: string[] } | null => {
    const normalizedTitle = normalize(title).toLowerCase();
    const visibleLinkCandidates = links
      .map((link) => ({ link, rect: visibleLinkRect(link), text: linkText(link) }))
      .filter((item): item is { link: HTMLAnchorElement; rect: DOMRect; text: string } => {
        return Boolean(item.rect && normalize(item.link.href));
      });
    const visibleLinks = visibleLinkCandidates.filter((item) =>
      linkOwnsCenterPoint(item.link, item.rect),
    );
    const fallbackVisibleDetailLink = (): {
      link: HTMLAnchorElement;
      rect: DOMRect;
      reasons: string[];
    } | null => {
      const fallbackDetailLink = [...visibleLinkCandidates]
        .filter((item) => isXiaohongshuDetailLink(item.link))
        .sort(
          (left, right) =>
            right.rect.width * right.rect.height - left.rect.width * left.rect.height,
        )[0];
      return fallbackDetailLink
        ? {
            link: fallbackDetailLink.link,
            rect: fallbackDetailLink.rect,
            reasons: ['visible_detail_link_unverified_hit'],
          }
        : null;
    };
    if (visibleLinks.length === 0) return fallbackVisibleDetailLink();

    const titleMatch = visibleLinks.find((item) => {
      const text = item.text.toLowerCase();
      return text.length > 0 && (text.includes(normalizedTitle) || normalizedTitle.includes(text));
    });
    if (titleMatch)
      return { link: titleMatch.link, rect: titleMatch.rect, reasons: ['title_link_match'] };

    const detailLinks = visibleLinks.filter((item) => isXiaohongshuDetailLink(item.link));
    const detailTextLink = detailLinks.find(
      (item) => item.text.length >= 4 && !shellPattern.test(item.text),
    );
    if (detailTextLink) {
      return {
        link: detailTextLink.link,
        rect: detailTextLink.rect,
        reasons: ['detail_text_link'],
      };
    }

    const largestDetailLink = [...detailLinks].sort(
      (left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height,
    )[0];
    if (largestDetailLink) {
      return {
        link: largestDetailLink.link,
        rect: largestDetailLink.rect,
        reasons: ['largest_detail_link'],
      };
    }

    const textLink = visibleLinks.find(
      (item) =>
        item.text.length >= 4 && !shellPattern.test(item.text) && !isLikelyProfileLink(item.link),
    );
    if (textLink)
      return { link: textLink.link, rect: textLink.rect, reasons: ['visible_text_link'] };

    const largestLink = [...visibleLinks]
      .filter((item) => !isLikelyProfileLink(item.link))
      .sort(
        (left, right) => right.rect.width * right.rect.height - left.rect.width * left.rect.height,
      )[0];
    if (largestLink) {
      return { link: largestLink.link, rect: largestLink.rect, reasons: ['largest_visible_link'] };
    }

    return fallbackVisibleDetailLink();
  };

  const looksLikeResultCard = (element: Element): boolean => {
    const rect = visibleRect(element);
    if (!rect) return false;
    if (rect.height > window.innerHeight * 0.95 || rect.width > window.innerWidth * 0.98) {
      return false;
    }
    const lines = textLines(element);
    const links = Array.from(element.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const mediaCount = element.querySelectorAll('img, picture, video').length;
    const title = bestTitle(lines, links);
    if (!title || shellPattern.test(title)) return false;
    return Boolean(links.length > 0 || mediaCount > 0 || lines.length >= 2);
  };

  const collectScopedCardCandidates = (container: Element): Element[] => {
    const direct = Array.from(container.children).filter(looksLikeResultCard);
    if (direct.length >= 3) return direct;
    return Array.from(container.querySelectorAll(cardCandidateSelector)).filter(
      looksLikeResultCard,
    );
  };

  const bestResultListContainer = (): Element | null => {
    let best: { element: Element; score: number } | null = null;
    for (const element of Array.from(document.querySelectorAll(listContainerSelector))) {
      const rect = visibleRect(element);
      if (!rect) continue;
      if (rect.width < 220 || rect.height < 160) continue;
      const candidates = collectScopedCardCandidates(element);
      const uniqueTitles = new Set(
        candidates
          .map((candidate) =>
            bestTitle(
              textLines(candidate),
              Array.from(candidate.querySelectorAll('a[href]')) as HTMLAnchorElement[],
            ),
          )
          .filter(Boolean),
      );
      const score = uniqueTitles.size * 4 + Math.min(candidates.length, 12);
      if (score < 12) continue;
      if (!best || score > best.score) best = { element, score };
    }
    return best?.element ?? null;
  };

  const cleanMetaFromText = (value: string): string =>
    normalize(
      value
        .replace(metaPattern, '')
        .replace(/\b\d{1,2}:\d{2}\b/g, '')
        .replace(/\s+[0-9][0-9,.]*\s*(万|千|k|m)?$/i, ''),
    );

  const bestTitle = (lines: readonly string[], links: readonly HTMLAnchorElement[]): string => {
    const profileLabels = links
      .filter(isLikelyProfileLink)
      .map((link) => cleanMetaFromText(linkText(link)))
      .filter((line) => line.length >= 2 && line.length <= 60);
    const linkTexts = links
      .filter((link) => !isLikelyProfileLink(link))
      .map((link) =>
        normalize(link.innerText || link.textContent || link.getAttribute('aria-label')),
      )
      .filter((line) => line.length >= 4 && line.length <= 140 && !shellPattern.test(line));
    const bestLinkText = linkTexts
      .filter((line) => !metaPattern.test(line))
      .sort((left, right) => right.length - left.length)[0];
    if (bestLinkText) return bestLinkText;

    for (const line of lines) {
      const metaMatch = metaPattern.exec(line);
      if (!metaMatch || typeof metaMatch.index !== 'number') continue;
      let prefix = normalize(line.slice(0, metaMatch.index));
      const authorLikeLabels = linkTexts
        .map(cleanMetaFromText)
        .concat(profileLabels)
        .filter((label) => label.length >= 2 && label.length <= 40)
        .sort((left, right) => right.length - left.length);
      for (const label of authorLikeLabels) {
        if (prefix.endsWith(label) && prefix.length > label.length + 3) {
          prefix = normalize(prefix.slice(0, -label.length));
          break;
        }
      }
      if (authorLikeLabels.some((label) => prefix === label)) continue;
      if (prefix.length >= 4 && prefix.length <= 120 && !shellPattern.test(prefix)) return prefix;
    }

    const lineTitle = lines.find(
      (line) =>
        line.length >= 4 &&
        line.length <= 120 &&
        !metaPattern.test(line) &&
        !profileLabels.some((label) => line === label || line.startsWith(`${label} `)),
    );
    if (lineTitle) return lineTitle;
    return '';
  };

  const firstMetaText = (lines: readonly string[]): string | undefined => {
    for (const line of lines) {
      const match = metaPattern.exec(line);
      if (match?.[0]) return match[0];
    }
    return undefined;
  };

  const firstInteractionText = (lines: readonly string[]): string | undefined => {
    for (const line of [...lines].reverse()) {
      const explicit =
        /(收藏|点赞|评论|赞|喜欢|saves?|likes?|comments?)\s*[:：]?\s*([0-9][0-9,.]*\s*(万|千|k|m)?)/i.exec(
          line,
        );
      if (explicit?.[0]) return explicit[0];
      const trailing = /\s([0-9][0-9,.]*\s*(万|千|k|m)?)$/i.exec(line);
      if (trailing?.[1]) return trailing[1];
    }
    return undefined;
  };

  const authorTextForCard = (
    lines: readonly string[],
    title: string,
    metaText: string | undefined,
  ): string | undefined => {
    if (!metaText) return undefined;
    for (const line of lines) {
      const titleIndex = line.indexOf(title);
      const metaIndex = line.indexOf(metaText);
      if (titleIndex < 0 || metaIndex <= titleIndex + title.length) continue;
      const candidate = normalize(line.slice(titleIndex + title.length, metaIndex));
      if (candidate.length >= 2 && candidate.length <= 60 && !shellPattern.test(candidate)) {
        return candidate;
      }
    }
    return undefined;
  };

  const resultListContainer = bestResultListContainer();
  const candidates = resultListContainer
    ? collectScopedCardCandidates(resultListContainer)
    : Array.from(document.querySelectorAll(cardCandidateSelector));

  const cards: CollectedResultCard[] = [];
  const seenKeys = new Set<string>();

  for (const element of candidates) {
    const tag = element.tagName.toLowerCase();
    if (['html', 'body', 'header', 'footer', 'nav', 'aside', 'script', 'style'].includes(tag)) {
      continue;
    }
    const rect = visibleRect(element);
    if (!rect) continue;
    if (rect.height > window.innerHeight * 0.95 || rect.width > window.innerWidth * 0.98) {
      continue;
    }

    const lines = textLines(element);
    const links = Array.from(element.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const images = Array.from(element.querySelectorAll('img, picture, video'));
    let title = bestTitle(lines, links);
    if (!title) continue;
    const cardProfileLabels = links
      .filter(isLikelyProfileLink)
      .map((link) => cleanMetaFromText(linkText(link)))
      .filter((line) => line.length >= 2 && line.length <= 60);
    if (cardProfileLabels.some((label) => title === label)) continue;
    if (shellPattern.test(title)) continue;
    if (rect.width < 180 && images.length === 0) continue;
    if (lines.length < 2 && links.length === 0 && images.length === 0) continue;

    const primaryLink = primaryLinkForCard(links, title);
    const href = primaryLink?.link.href ?? links.find((link) => normalize(link.href))?.href;
    if (!href) continue;
    const key = `${title.toLowerCase()}|${href || ''}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const remainingLines = lines.filter((line) => line !== title);
    const metaText = firstMetaText(lines);
    const interactionText = firstInteractionText(lines);
    let primaryText =
      authorTextForCard(lines, title, metaText) ||
      remainingLines.find(
        (line) =>
          line !== metaText &&
          line !== interactionText &&
          !line.includes(title) &&
          line.length <= 80,
      );
    const secondaryText = remainingLines.find(
      (line) =>
        line !== primaryText &&
        line !== metaText &&
        line !== interactionText &&
        !line.includes(title) &&
        line.length <= 120,
    );

    if (metaPattern.test(title) && primaryText && primaryText.length >= 6) {
      title = primaryText;
      primaryText = secondaryText;
    }

    const reasons = [
      links.length > 0 ? 'link_present' : null,
      images.length > 0 ? 'media_present' : null,
      lines.length >= 2 ? 'multi_line_card_text' : null,
      metaText ? 'meta_text_present' : null,
      interactionText ? 'interaction_text_present' : null,
    ].filter((item): item is string => Boolean(item));
    const confidence = Math.min(0.92, 0.52 + reasons.length * 0.08);
    const primaryLinkSelector = primaryLink ? selectorForElement(primaryLink.link) : undefined;
    const primaryLinkText = primaryLink ? linkText(primaryLink.link) : '';
    const actionTarget = primaryLink
      ? {
          actionType: 'click' as const,
          targetKind: 'result_card_link' as const,
          url: primaryLink.link.href,
          ...(primaryLinkSelector ? { selector: primaryLinkSelector } : {}),
          ...(primaryLinkText ? { text: primaryLinkText } : {}),
          rect: {
            x: Math.round(primaryLink.rect.x),
            y: Math.round(primaryLink.rect.y),
            width: Math.round(primaryLink.rect.width),
            height: Math.round(primaryLink.rect.height),
          },
          center: {
            x: Math.round(primaryLink.rect.left + primaryLink.rect.width / 2),
            y: Math.round(primaryLink.rect.top + primaryLink.rect.height / 2),
          },
          coordinateFrame: 'viewport' as const,
          sourceScrollY: window.scrollY,
          confidence: Math.min(0.94, confidence + 0.04),
          reasons: primaryLink.reasons,
        }
      : undefined;

    cards.push({
      title,
      ...(href ? { url: href } : {}),
      ...(actionTarget ? { actionTarget } : {}),
      ...(primaryText ? { primaryText } : {}),
      ...(secondaryText ? { secondaryText } : {}),
      ...(metaText ? { metaText } : {}),
      ...(interactionText ? { interactionText } : {}),
      imageCount: images.length,
      sourceScrollY: window.scrollY,
      firstSeenGlobalTop: window.scrollY + rect.top,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      confidence,
      reasons,
      sourceStrategy: resultListContainer ? 'list_container' : 'candidate_scan',
    });
  }

  cards.sort((left, right) => left.firstSeenGlobalTop - right.firstSeenGlobalTop);
  return {
    cards,
    pageInfo: {
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      scrollY: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight || document.body.scrollHeight,
      pixelsBelow: Math.max(
        0,
        (document.documentElement.scrollHeight || document.body.scrollHeight) -
          window.scrollY -
          window.innerHeight,
      ),
    },
  };
}

function scrollPageBy(stepPx: number): ScrollStepResult {
  const beforeY = window.scrollY;
  window.scrollBy(0, stepPx);
  const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
  return {
    beforeY,
    afterY: window.scrollY,
    scrollHeight,
    viewportHeight: window.innerHeight,
    pixelsBelow: Math.max(0, scrollHeight - window.scrollY - window.innerHeight),
  };
}

function scrollPageToTop(): ScrollStepResult {
  const beforeY = window.scrollY;
  window.scrollTo(0, 0);
  const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
  return {
    beforeY,
    afterY: window.scrollY,
    scrollHeight,
    viewportHeight: window.innerHeight,
    pixelsBelow: Math.max(0, scrollHeight - window.scrollY - window.innerHeight),
  };
}

class CollectResultCardsTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS;

  async execute(args: CollectResultCardsParams): Promise<ToolResult> {
    const minResults = clampInteger(args.minResults, 10, 1, 50);
    const maxScrolls = clampInteger(args.maxScrolls, 4, 0, 10);
    const settleMs = clampInteger(args.settleMs, 700, 100, 5000);
    const maxMergedCards = Math.max(minResults, 50);
    const startedAt = Date.now();

    try {
      const explicit = await this.tryGetTab(args.tabId);
      const tab = explicit || (await this.getActiveTabOrThrowInWindow(args.windowId));
      if (!tab.id) {
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      }
      if (/^(chrome|edge|about|devtools):/i.test(tab.url || '')) {
        return createErrorResponse('Cannot collect result cards from browser-internal pages.');
      }

      let merged: CollectedResultCard[] = [];
      const steps: Array<{
        step: number;
        scrollY: number;
        observedCards: number;
        mergedCards: number;
        pixelsBelow: number;
      }> = [];
      const scrolls: ScrollStepResult[] = [];
      let latestPageInfo: VisibleCardScanResult['pageInfo'] | null = null;
      const startFromTop = args.startFromTop !== false;

      if (startFromTop) {
        const [topInjection] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrollPageToTop,
        });
        const topScroll = topInjection?.result as ScrollStepResult | undefined;
        if (topScroll && Math.abs(topScroll.afterY - topScroll.beforeY) >= 4) {
          await this.sleep(Math.min(settleMs, 500));
        }
      }

      for (let step = 0; step <= maxScrolls; step += 1) {
        const [scanInjection] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scanVisibleResultCardsInPage,
        });
        const scan = scanInjection?.result as VisibleCardScanResult | undefined;
        if (!scan) {
          return createErrorResponse('Result-card scan returned no page data.');
        }
        latestPageInfo = scan.pageInfo;
        merged = mergeCollectedResultCards(merged, scan.cards, maxMergedCards);
        steps.push({
          step,
          scrollY: scan.pageInfo.scrollY,
          observedCards: scan.cards.length,
          mergedCards: merged.length,
          pixelsBelow: scan.pageInfo.pixelsBelow,
        });
        if (merged.length >= minResults || step >= maxScrolls || scan.pageInfo.pixelsBelow <= 8) {
          break;
        }

        const scrollStepPx = clampNumber(
          args.scrollStepPx,
          Math.max(360, Math.round(scan.pageInfo.viewport.height * 0.85)),
          120,
          5000,
        );
        const [scrollInjection] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrollPageBy,
          args: [scrollStepPx],
        });
        const scroll = scrollInjection?.result as ScrollStepResult | undefined;
        if (!scroll || Math.abs(scroll.afterY - scroll.beforeY) < 4) {
          break;
        }
        scrolls.push(scroll);
        await this.sleep(settleMs);
      }

      markBrowserWorldTabAiOperated(tab.id, 'collect_result_cards');
      const cards = merged.slice(0, minResults).map((card, index) => ({
        rank: index + 1,
        title: card.title,
        ...(card.url ? { url: card.url } : {}),
        ...(card.primaryText ? { primaryText: card.primaryText } : {}),
        ...(card.secondaryText ? { secondaryText: card.secondaryText } : {}),
        ...(card.metaText ? { metaText: card.metaText } : {}),
        ...(card.interactionText ? { interactionText: card.interactionText } : {}),
        ...(card.actionTarget ? { actionTarget: card.actionTarget } : {}),
        imageCount: card.imageCount,
        sourceScrollY: card.sourceScrollY,
        rect: card.rect,
        confidence: card.confidence,
        reasons: card.reasons,
      }));
      const complete = cards.length >= minResults;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: true,
              kind: 'result_card_collection',
              page: latestPageInfo
                ? {
                    title: latestPageInfo.title,
                    url: latestPageInfo.url,
                    finalScrollY: latestPageInfo.scrollY,
                    pixelsBelow: latestPageInfo.pixelsBelow,
                  }
                : null,
              pageRole: 'search_results',
              pageState: complete ? 'complete' : 'partial',
              sourceRoute: 'visible_dom_cards_bounded_scroll',
              selectedDataSource: 'visible_dom_result_cards',
              freshness: 'fresh',
              tabId: tab.id,
              ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
              requestedMinResults: minResults,
              observedResultCount: cards.length,
              complete,
              status: complete ? 'complete_enough' : 'partial',
              cards,
              collection: {
                steps,
                scrollsPerformed: scrolls.length,
                startFromTop,
                durationMs: Date.now() - startedAt,
              },
              recommendedNextAction: complete
                ? 'Use these card objects as the stable top-N result set for ranking, opening, or summarizing.'
                : 'If top-N completeness matters, increase maxScrolls or use screenshot/manual verification for this page.',
              claimBoundary:
                'This tool proves visible DOM card collection across bounded scroll steps; it does not prove hidden, personalized, or not-yet-loaded results outside the scanned range.',
            }),
          },
        ],
        isError: false,
      };
    } catch (error) {
      return createErrorResponse(
        `Error collecting result cards: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const collectResultCardsTool = new CollectResultCardsTool();
