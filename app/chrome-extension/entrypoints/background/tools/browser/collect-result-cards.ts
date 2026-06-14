import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { ERROR_MESSAGES } from '@/common/constants';
import { BaseBrowserToolExecutor } from '../base-browser';
import { TOOL_NAMES } from '@tabrix/shared';
import {
  getBrowserWorldSnapshot,
  markBrowserWorldTabAiOperated,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';
import {
  type CollectedResultCard,
  mergeCollectedResultCards,
  stableResultCardTarget,
  summarizeCollectedResultCardTargetability,
} from './collect-result-cards-model';
import { cdpSessionManager } from '@/utils/cdp-session-manager';

const CDP_SESSION_KEY = 'collect-result-cards';
const RESTRICTED_PAGE_SIGNAL_PATTERN =
  /\b(captcha|recaptcha|challenge|verification|security[-_]?check|human[-_]?check|verify(uuid|type|biz)?|user[_-]?verification[_-]?required|login[_-]?required|auth[_-]?required|access[_-]?denied|restricted|blocked)\b|安全验证|人机验证|滑块验证|验证码|登录验证/i;

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
  filterState: SearchFilterState;
  pageInfo: {
    url: string;
    title: string;
    viewport: { width: number; height: number; dpr: number };
    scrollY: number;
    scrollHeight: number;
    pixelsBelow: number;
  };
}

interface AppliedSearchFilter {
  label: string;
  kind: 'content_type' | 'sort' | 'time_range' | 'unknown';
  source: 'dom_active_state' | 'url_parameter_adapter';
  confidence: number;
}

interface SearchFilterState {
  status: 'observed' | 'not_observed';
  appliedLabels: string[];
  contentType?: string;
  sort?: string;
  timeRange?: string;
  groups: {
    contentType: SearchFilterGroupState;
    sort: SearchFilterGroupState;
    timeRange: SearchFilterGroupState;
  };
  appliedFilters: AppliedSearchFilter[];
  claimBoundary: string;
}

interface SearchFilterGroupState {
  selected: string | null;
  candidates: string[];
  source: 'dom_active_state' | 'url_parameter_adapter' | 'mixed' | 'not_observed';
  confidence: number;
  ambiguous: boolean;
  reason: string;
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

function hasRestrictedPageSignal(value: unknown, depth = 0): boolean {
  if (value == null || depth > 3) return false;
  if (typeof value === 'string') return RESTRICTED_PAGE_SIGNAL_PATTERN.test(value);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) {
    return value.slice(0, 20).some((item) => hasRestrictedPageSignal(item, depth + 1));
  }
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>)
    .slice(0, 60)
    .some(
      ([key, item]) =>
        hasRestrictedPageSignal(key, depth + 1) || hasRestrictedPageSignal(item, depth + 1),
    );
}

export function isRestrictedResultCardCollectionPage(input: {
  tab?: Pick<chrome.tabs.Tab, 'url' | 'title'> | null;
  browserWorldTab?: Pick<
    BrowserWorldTabObject,
    'url' | 'pendingUrl' | 'title' | 'canTabrixOperate' | 'operabilityReason' | 'status'
  > | null;
}): boolean {
  const tab = input.tab ?? null;
  const browserWorldTab = input.browserWorldTab ?? null;
  if (browserWorldTab?.canTabrixOperate === false) return true;
  return hasRestrictedPageSignal({
    tabUrl: tab?.url,
    tabTitle: tab?.title,
    worldUrl: browserWorldTab?.url,
    pendingUrl: browserWorldTab?.pendingUrl,
    worldTitle: browserWorldTab?.title,
    worldStatus: browserWorldTab?.status,
    operabilityReason: browserWorldTab?.operabilityReason,
  });
}

function createRestrictedPageCollectionResponse(
  tab: chrome.tabs.Tab,
  browserWorldTab?: BrowserWorldTabObject | null,
): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          success: false,
          kind: 'result_card_collection',
          status: 'blocked',
          businessSuccess: false,
          pageRole: 'restricted',
          pageState: 'restricted',
          sourceRoute: 'browser_world_operability_gate',
          selectedDataSource: null,
          freshness: 'blocked',
          reasonCode: 'user_verification_required',
          page: {
            title: tab.title ?? browserWorldTab?.title ?? null,
            url: tab.url ?? browserWorldTab?.url ?? browserWorldTab?.pendingUrl ?? null,
          },
          tabId: tab.id ?? browserWorldTab?.tabId ?? null,
          windowId: tab.windowId ?? browserWorldTab?.windowId ?? null,
          observedResultCount: 0,
          complete: false,
          cards: [],
          recommendedNextAction:
            'Ask the user to complete the browser verification or login, then retry result-card collection.',
          claimBoundary:
            'Tabrix did not scan or store result cards because the current page is restricted or requires user verification.',
        }),
      },
    ],
    isError: false,
  };
}

async function findBrowserWorldTab(tabId: number): Promise<BrowserWorldTabObject | null> {
  try {
    const snapshot = await getBrowserWorldSnapshot();
    return snapshot.tabs.find((tab) => tab.tabId === tabId) ?? null;
  } catch {
    return null;
  }
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
  const contentTypeFilterPattern =
    /^(图文|图片|视频|文章|image\s*text|images?|photos?|videos?|articles?)$/i;
  const sortFilterPattern =
    /^(综合|最新|最热|最多点赞|最多评论|最多收藏|latest|popular|most\s*(liked|commented|saved|collected))$/i;
  const timeRangeFilterPattern = /^(一天内|一周内|半年内|24\s*h|7\s*d|week|month)$/i;
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

  const ownVisibleText = (element: Element): string => {
    const ownParts: string[] = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = normalize(child.textContent || '');
        if (text) ownParts.push(text);
      }
    }
    return normalize(ownParts.join(' '));
  };

  const elementIsVisible = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
    if (rect.right < 0 || rect.left > window.innerWidth) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  };

  const classifyFilterLabel = (label: string): AppliedSearchFilter['kind'] => {
    if (contentTypeFilterPattern.test(label)) return 'content_type';
    if (sortFilterPattern.test(label)) return 'sort';
    if (timeRangeFilterPattern.test(label)) return 'time_range';
    return 'unknown';
  };
  const canonicalFilterLabel = (label: string, kind: AppliedSearchFilter['kind']): string => {
    if (kind === 'content_type' && /^(图文|图片|image\s*text|images?|photos?)$/i.test(label)) {
      return '图文';
    }
    if (kind === 'content_type' && /^(视频|videos?)$/i.test(label)) return '视频';
    if (kind === 'sort' && /最多收藏|most\s*(saved|collected)/i.test(label)) {
      return '最多收藏';
    }
    if (kind === 'time_range' && /一周内|7\s*d|week/i.test(label)) return '一周内';
    return label;
  };

  const preferredFilterForKind = (
    filters: readonly AppliedSearchFilter[],
    kind: AppliedSearchFilter['kind'],
  ): AppliedSearchFilter | undefined => {
    const candidates = filters.filter((filter) => filter.kind === kind);
    if (candidates.length === 0) return undefined;
    if (kind === 'content_type') {
      return (
        candidates.find((filter) => /^(图文|image\s*text|images?|photos?)$/i.test(filter.label)) ??
        candidates[0]
      );
    }
    if (kind === 'sort') {
      return (
        candidates.find((filter) => /最多收藏|most\s*(saved|collected)/i.test(filter.label)) ??
        candidates[0]
      );
    }
    if (kind === 'time_range') {
      return candidates.find((filter) => /一周内|7\s*d|week/i.test(filter.label)) ?? candidates[0];
    }
    return candidates[0];
  };

  const groupStateForKind = (
    filters: readonly AppliedSearchFilter[],
    kind: AppliedSearchFilter['kind'],
  ): SearchFilterGroupState => {
    const candidates = filters.filter((filter) => filter.kind === kind);
    const candidateLabels = [...new Set(candidates.map((filter) => filter.label))];
    const selected = preferredFilterForKind(filters, kind);
    const sources = new Set(candidates.map((filter) => filter.source));
    const selectedLabel = selected?.label ?? null;
    const nonDefaultLabels = candidateLabels.filter((label) => {
      if (kind === 'content_type') return !/^(全部|all)$/i.test(label);
      if (kind === 'sort') return !/^(综合|all)$/i.test(label);
      if (kind === 'time_range') return !/^(不限|any)$/i.test(label);
      return true;
    });
    const ambiguityLabels =
      selectedLabel && nonDefaultLabels.includes(selectedLabel)
        ? nonDefaultLabels.filter((label) => label !== selectedLabel)
        : nonDefaultLabels;
    const ambiguous = ambiguityLabels.length > 0;
    return {
      selected: selectedLabel,
      candidates: candidateLabels,
      source:
        sources.size > 1
          ? 'mixed'
          : candidates[0]?.source === 'dom_active_state'
            ? 'dom_active_state'
            : candidates[0]?.source === 'url_parameter_adapter'
              ? 'url_parameter_adapter'
              : 'not_observed',
      confidence: selected?.confidence ?? 0,
      ambiguous,
      reason: selected
        ? ambiguous
          ? 'multiple active candidates were observed for this filter group; selected is the task-preferred label'
          : 'selected filter inferred from active DOM state or bounded URL adapter'
        : 'no selected filter observed for this group',
    };
  };

  const inferFilterStateFromUrl = (): AppliedSearchFilter[] => {
    const filters: AppliedSearchFilter[] = [];
    try {
      const url = new URL(location.href);
      if (
        url.hostname.toLowerCase().endsWith('xiaohongshu.com') &&
        url.searchParams.get('type') === '51'
      ) {
        filters.push({
          label: '图文',
          kind: 'content_type',
          source: 'url_parameter_adapter',
          confidence: 0.78,
        });
      }
    } catch (_) {
      /* ignore */
    }
    return filters;
  };

  const collectFilterState = (): SearchFilterState => {
    const activeSelectors = [
      '[aria-selected="true"]',
      '[aria-pressed="true"]',
      '[aria-current]:not([aria-current="false"])',
      '.active',
      '.selected',
      '.current',
      '.applied',
      '.checked',
    ].join(',');
    const filters: AppliedSearchFilter[] = [];
    const seen = new Set<string>();
    for (const element of Array.from(document.querySelectorAll(activeSelectors))) {
      if (!(element instanceof Element)) continue;
      if (!elementIsVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.width > Math.max(480, window.innerWidth * 0.45)) continue;
      const label = normalize(
        ownVisibleText(element) ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent ||
          '',
      );
      if (!label || label.length > 24) continue;
      const kind = classifyFilterLabel(label);
      if (kind === 'unknown') continue;
      const key = `${kind}:${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filters.push({
        label: canonicalFilterLabel(label, kind),
        kind,
        source: 'dom_active_state',
        confidence: 0.9,
      });
    }
    for (const filter of inferFilterStateFromUrl()) {
      const key = `${filter.kind}:${filter.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      filters.push(filter);
    }

    const appliedLabels = filters.map((filter) => filter.label);
    const groups = {
      contentType: groupStateForKind(filters, 'content_type'),
      sort: groupStateForKind(filters, 'sort'),
      timeRange: groupStateForKind(filters, 'time_range'),
    };
    return {
      status: appliedLabels.length > 0 ? 'observed' : 'not_observed',
      appliedLabels,
      ...(groups.contentType.selected ? { contentType: groups.contentType.selected } : {}),
      ...(groups.sort.selected ? { sort: groups.sort.selected } : {}),
      ...(groups.timeRange.selected ? { timeRange: groups.timeRange.selected } : {}),
      groups,
      appliedFilters: filters,
      claimBoundary:
        'Filter state is inferred from active/selected DOM controls and bounded URL adapters. It proves visible page state, not global server ranking correctness.',
    };
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
    const resultCardTargetRef = `ref_result_card_${cards.length + 1}`;
    const primaryLinkHitVerified =
      Boolean(primaryLink) && !primaryLink.reasons.includes('visible_detail_link_unverified_hit');
    const resultCardCandidateAction =
      primaryLinkHitVerified && primaryLink && primaryLinkSelector
        ? {
            id: `ca_click_${resultCardTargetRef}`,
            actionType: 'click' as const,
            targetRef: resultCardTargetRef,
            ...(title ? { label: title } : {}),
            confidence: Math.min(0.94, confidence + 0.04),
            matchReason: 'result_card_primary_link',
            intent: 'content.open_detail' as const,
            locatorChain: [
              { type: 'ref', value: resultCardTargetRef },
              ...(primaryLinkText ? [{ type: 'aria', value: primaryLinkText }] : []),
              { type: 'css', value: primaryLinkSelector },
            ],
          }
        : undefined;
    const actionTarget = primaryLink
      ? {
          actionType: 'click' as const,
          targetKind: 'result_card_link' as const,
          url: primaryLink.link.href,
          ...(primaryLinkSelector ? { selector: primaryLinkSelector } : {}),
          ...(primaryLinkText ? { text: primaryLinkText } : {}),
          executionScope: resultCardCandidateAction
            ? ('same_tab_fresh_snapshot' as const)
            : ('session_url' as const),
          openAction: {
            toolName: 'chrome_navigate' as const,
            toolArgs: { url: primaryLink.link.href },
            executionScope: 'session_url' as const,
            reason: 'result_card_href' as const,
            confidence: Math.min(0.9, confidence + 0.02),
          },
          ...(resultCardCandidateAction
            ? {
                toolName: 'chrome_click_element' as const,
                toolArgs: {
                  candidateAction: resultCardCandidateAction,
                },
              }
            : {}),
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
    filterState: collectFilterState(),
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

  private async scanVisibleResultCards(tab: chrome.tabs.Tab): Promise<VisibleCardScanResult> {
    const tabId = tab.id;
    if (typeof tabId !== 'number') {
      throw new Error('Result-card scan requires a numeric tabId.');
    }

    let scriptingFrameCount = 0;
    try {
      const scanInjections = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: scanVisibleResultCardsInPage,
        world: 'MAIN' as chrome.scripting.ExecutionWorld,
      });
      const scans = scanInjections
        .map((injection) => injection.result as VisibleCardScanResult | undefined)
        .filter((result): result is VisibleCardScanResult => Boolean(result?.pageInfo));
      scriptingFrameCount = scans.length;
      const nonInternalScans = scans.filter(
        (result) => !/^(about|chrome|edge|devtools):/i.test(result.pageInfo.url || ''),
      );
      const candidateScans = nonInternalScans.length > 0 ? nonInternalScans : scans;
      const scan = candidateScans.sort((left, right) => {
        const cardDelta = right.cards.length - left.cards.length;
        if (cardDelta !== 0) return cardDelta;
        const leftExact = left.pageInfo.url === tab.url ? 1 : 0;
        const rightExact = right.pageInfo.url === tab.url ? 1 : 0;
        if (leftExact !== rightExact) return rightExact - leftExact;
        return right.pageInfo.scrollHeight - left.pageInfo.scrollHeight;
      })[0];
      if (scan && !/^(about|chrome|edge|devtools):/i.test(scan.pageInfo.url || '')) {
        return scan;
      }
    } catch {
      // CDP fallback below provides the same read-only scan from the page context.
    }

    const expression = `(() => {
      const scanVisibleResultCardsInPage = ${scanVisibleResultCardsInPage.toString()};
      return scanVisibleResultCardsInPage();
    })()`;
    const cdpResult = await cdpSessionManager.withSession(tabId, CDP_SESSION_KEY, async () => {
      return (await cdpSessionManager.sendCommand(tabId, 'Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        timeout: 10_000,
      })) as {
        result?: { value?: unknown };
        exceptionDetails?: {
          text?: string;
          exception?: { description?: string; value?: string; className?: string };
        };
      };
    });
    if (cdpResult.exceptionDetails) {
      const details = cdpResult.exceptionDetails;
      const message =
        details.exception?.description ||
        details.exception?.value ||
        details.exception?.className ||
        details.text ||
        'unknown error';
      throw new Error(`Result-card CDP scan failed: ${message}`);
    }
    const scan = cdpResult.result?.value as VisibleCardScanResult | undefined;
    if (scan?.pageInfo && !/^(about|chrome|edge|devtools):/i.test(scan.pageInfo.url || '')) {
      return scan;
    }
    throw new Error(
      `Result-card scan only reached browser-internal frames; target page was not accessible. frameCount=${scriptingFrameCount}`,
    );
  }

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
      const browserWorldTab = await findBrowserWorldTab(tab.id);
      if (isRestrictedResultCardCollectionPage({ tab, browserWorldTab })) {
        return createRestrictedPageCollectionResponse(tab, browserWorldTab);
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
      let latestFilterState: SearchFilterState | null = null;
      const startFromTop = args.startFromTop !== false;

      if (startFromTop) {
        const [topInjection] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrollPageToTop,
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
        });
        const topScroll = topInjection?.result as ScrollStepResult | undefined;
        if (topScroll && Math.abs(topScroll.afterY - topScroll.beforeY) >= 4) {
          await this.sleep(Math.min(settleMs, 500));
        }
      }

      for (let step = 0; step <= maxScrolls; step += 1) {
        const scan = await this.scanVisibleResultCards(tab);
        latestPageInfo = scan.pageInfo;
        latestFilterState = scan.filterState;
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
          world: 'MAIN' as chrome.scripting.ExecutionWorld,
        });
        const scroll = scrollInjection?.result as ScrollStepResult | undefined;
        if (!scroll || Math.abs(scroll.afterY - scroll.beforeY) < 4) {
          break;
        }
        scrolls.push(scroll);
        await this.sleep(settleMs);
      }

      markBrowserWorldTabAiOperated(tab.id, 'collect_result_cards');
      const selectedCards = merged.slice(0, minResults);
      const targetabilitySummary = summarizeCollectedResultCardTargetability(selectedCards);
      const cards = selectedCards.map((card, index) => {
        const stableTarget = stableResultCardTarget(card);
        return {
          rank: index + 1,
          title: card.title,
          ...(card.url ? { url: card.url } : {}),
          ...(stableTarget
            ? {
                targetRef: stableTarget.targetRef,
                candidateActionId: stableTarget.candidateActionId,
                targetabilityStatus: 'stable_click_target',
              }
            : card.url
              ? { targetabilityStatus: 'url_fallback' }
              : { targetabilityStatus: 'not_targetable' }),
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
        };
      });
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
              filterState: latestFilterState,
              tabId: tab.id,
              ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
              requestedMinResults: minResults,
              observedResultCount: cards.length,
              targetRefCoverageRate: targetabilitySummary.targetRefCoverageRate,
              targetabilitySummary,
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
