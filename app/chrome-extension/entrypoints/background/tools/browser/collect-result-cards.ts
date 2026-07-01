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
  summarizeCollectedResultCardsForAi,
  summarizeCollectedResultCardTargetability,
  withCollectedResultCardSemanticAliases,
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
  outputMode?: 'full' | 'compact';
}

interface VisibleCardScanResult {
  cards: CollectedResultCard[];
  filterState: SearchFilterState;
  pageRegions: PageRegionObject[];
  candidateActions: PageCandidateAction[];
  pageInfo: {
    url: string;
    title: string;
    viewport: { width: number; height: number; dpr: number };
    scrollY: number;
    scrollHeight: number;
    pixelsBelow: number;
    scrollTarget: 'window' | 'element';
  };
}

interface AppliedSearchFilter {
  label: string;
  kind: 'content_type' | 'sort' | 'time_range' | 'unknown';
  source: 'dom_active_state' | 'visual_style_state' | 'url_parameter_adapter';
  confidence: number;
}

interface SearchFilterState {
  status: 'observed' | 'not_observed';
  appliedLabels: string[];
  contentType?: string;
  sort?: string;
  timeRange?: string;
  filterGroups: SearchGenericFilterGroupState[];
  groups: {
    contentType: SearchFilterGroupState;
    sort: SearchFilterGroupState;
    timeRange: SearchFilterGroupState;
  };
  appliedFilters: AppliedSearchFilter[];
  claimBoundary: string;
}

interface PageRegionObject {
  regionId: string;
  regionType: 'search' | 'filters' | 'results' | 'content';
  layoutHint: string;
  state: 'observed';
  readiness: 'ready' | 'unknown';
  targetability: boolean;
  candidateActionIds: string[];
}

interface PageCandidateAction {
  id: string;
  actionType: 'click' | 'fill' | 'open';
  targetRef: string;
  label: string;
  intent: string;
  matchReason: string;
  actionability: boolean;
  actionabilityReason?: string;
  locatorChain: Array<{ type: 'ref' | 'aria' | 'css' | string; value: string }>;
}

interface SearchFilterGroupState {
  selected: string | null;
  candidates: string[];
  source:
    | 'dom_active_state'
    | 'visual_style_state'
    | 'url_parameter_adapter'
    | 'mixed'
    | 'not_observed';
  confidence: number;
  ambiguous: boolean;
  reason: string;
}

interface SearchGenericFilterGroupState extends SearchFilterGroupState {
  groupId: string;
  groupLabel?: string;
}

interface ScrollStepResult {
  beforeY: number;
  afterY: number;
  scrollHeight: number;
  viewportHeight: number;
  pixelsBelow: number;
  scrollTarget: 'window' | 'element';
  interactionDispatched?: boolean;
  scrollIntoViewDispatched?: boolean;
}

function candidateActionDedupeKey(action: PageCandidateAction): string {
  return `${action.intent}|${action.targetRef}|${action.label}`;
}

function candidateActionScore(action: PageCandidateAction): number {
  const hasCssLocator = action.locatorChain.some(
    (locator) => locator.type === 'css' && locator.value,
  );
  return (
    (action.actionability ? 1000 : 0) +
    (hasCssLocator ? 200 : 0) +
    (action.matchReason.startsWith('visible_') ? 100 : 0) +
    (action.intent === 'content.open_detail' ? 50 : 0)
  );
}

function dedupePageCandidateActions(
  actions: readonly PageCandidateAction[],
): PageCandidateAction[] {
  const byKey = new Map<string, { action: PageCandidateAction; score: number }>();
  for (const action of actions) {
    const key = candidateActionDedupeKey(action);
    const score = candidateActionScore(action);
    const previous = byKey.get(key);
    if (!previous || score > previous.score) {
      byKey.set(key, { action, score });
    }
  }
  return Array.from(byKey.values()).map(({ action }) => action);
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

export function scanVisibleResultCardsInPage(): VisibleCardScanResult {
  const maxVisibleFilterActions = 48;
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
  const timeRangeFilterPattern = /^(不限|一天内|一周内|半年内|24\s*h|7\s*d|week|month|any)$/i;
  const filterTriggerPattern = /^(筛选|已筛选|过滤|排序|filter|filters|filtered|sort|sort by)$/i;
  const filterContainerPattern =
    /(filter|filters|filtered|sort|dropdown|popover|popup|menu|dialog|modal|panel|drawer|筛选|排序)/i;
  const explicitFilterContainerPattern = /(filter|filters|filtered|sort|筛选|排序)/i;
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
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  const elementIsRendered = (element: Element): boolean => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    let current: Element | null = element;
    while (current && current !== document.documentElement) {
      const style = window.getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      current = current.parentElement;
    }
    return true;
  };

  const centerHitScore = (element: Element): number => {
    try {
      const rect = element.getBoundingClientRect();
      const x = Math.max(0, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
      const hit = document.elementFromPoint(x, y);
      if (!hit) return 0;
      if (element === hit || element.contains(hit)) return 240;
      if (hit.contains(element)) return 80;
      return -1000;
    } catch {
      return 0;
    }
  };

  const classifyFilterLabel = (label: string): AppliedSearchFilter['kind'] => {
    if (contentTypeFilterPattern.test(label)) return 'content_type';
    if (sortFilterPattern.test(label)) return 'sort';
    if (timeRangeFilterPattern.test(label)) return 'time_range';
    return 'unknown';
  };
  const canonicalFilterLabel = (label: string): string => label;

  const isDefaultFilterLabel = (label: string, kind: AppliedSearchFilter['kind']): boolean => {
    if (kind === 'content_type') return /^(全部|all)$/i.test(label);
    if (kind === 'sort') return /^(综合|all)$/i.test(label);
    if (kind === 'time_range') return /^(不限|any)$/i.test(label);
    return false;
  };

  const selectedFilterForKind = (
    filters: readonly AppliedSearchFilter[],
    kind: AppliedSearchFilter['kind'],
  ): AppliedSearchFilter | undefined => {
    const candidates = filters.filter((filter) => filter.kind === kind);
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    const nonDefaultCandidates = candidates.filter(
      (filter) => !isDefaultFilterLabel(filter.label, kind),
    );
    if (nonDefaultCandidates.length === 1) return nonDefaultCandidates[0];
    if (nonDefaultCandidates.length === 0) return candidates[0];
    return undefined;
  };

  const groupStateForKind = (
    filters: readonly AppliedSearchFilter[],
    kind: AppliedSearchFilter['kind'],
  ): SearchFilterGroupState => {
    const candidates = filters.filter((filter) => filter.kind === kind);
    const candidateLabels = [...new Set(candidates.map((filter) => filter.label))];
    const selected = selectedFilterForKind(filters, kind);
    const sources = new Set(candidates.map((filter) => filter.source));
    const selectedLabel = selected?.label ?? null;
    const nonDefaultLabels = candidateLabels.filter((label) => {
      return !isDefaultFilterLabel(label, kind);
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
            : candidates[0]?.source === 'visual_style_state'
              ? 'visual_style_state'
              : candidates[0]?.source === 'url_parameter_adapter'
                ? 'url_parameter_adapter'
                : 'not_observed',
      confidence: selected?.confidence ?? 0,
      ambiguous,
      reason: selected
        ? ambiguous
          ? 'multiple active candidates were observed for this filter group; selected is the only non-default active value'
          : 'selected filter inferred from active DOM state, visual style, or bounded URL adapter'
        : ambiguous
          ? 'multiple non-default active candidates were observed; selected value is intentionally withheld'
          : 'no selected filter observed for this group',
    };
  };

  const genericFilterGroupId = (kind: AppliedSearchFilter['kind']): string => {
    if (kind === 'content_type') return 'content_type';
    if (kind === 'sort') return 'sort';
    if (kind === 'time_range') return 'time_range';
    return 'other';
  };

  const genericFilterGroupsForFilters = (
    filters: readonly AppliedSearchFilter[],
  ): SearchGenericFilterGroupState[] => {
    const groups = new Map<string, AppliedSearchFilter[]>();
    for (const filter of filters) {
      const groupId = genericFilterGroupId(filter.kind);
      groups.set(groupId, [...(groups.get(groupId) ?? []), filter]);
    }
    return [...groups.entries()]
      .map(([groupId, groupFilters]) => ({
        groupId,
        groupLabel: groupId,
        ...groupStateForKind(groupFilters, groupFilters[0]?.kind ?? 'unknown'),
      }))
      .sort((left, right) => left.groupId.localeCompare(right.groupId));
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
      '[class*="active" i]',
      '[class*="selected" i]',
      '[class*="current" i]',
      '[class*="applied" i]',
      '[class*="checked" i]',
    ].join(',');
    const filters: AppliedSearchFilter[] = [];
    const seen = new Set<string>();

    const addFilter = (
      label: string,
      kind: AppliedSearchFilter['kind'],
      source: AppliedSearchFilter['source'],
      confidence: number,
    ): void => {
      const key = `${kind}:${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      filters.push({
        label: canonicalFilterLabel(label),
        kind,
        source,
        confidence,
      });
    };

    const labelForFilterStateCandidate = (element: Element): string =>
      normalize(
        ownVisibleText(element) ||
          element.getAttribute('aria-label') ||
          element.getAttribute('title') ||
          element.textContent ||
          '',
      );

    const elementSemanticText = (element: Element): string => {
      const values = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        (element as HTMLElement).id,
        (element as HTMLElement).className,
      ];
      for (const attr of Array.from(element.attributes)) values.push(attr.value);
      return normalize(values.join(' '));
    };

    const hasGroupedFilterChoices = (context: Element): boolean => {
      const byKind = new Map<AppliedSearchFilter['kind'], Set<string>>();
      const candidates = Array.from(
        context.querySelectorAll(
          [
            'button',
            'a',
            '[role="button"]',
            '[role="menuitem"]',
            '[role="option"]',
            '[role="tab"]',
            '[aria-label]',
            '[title]',
            '[tabindex]',
            'span',
            'li',
          ].join(','),
        ),
      ).slice(0, 120);
      for (const candidate of candidates) {
        if (!(candidate instanceof Element)) continue;
        if (!elementIsRendered(candidate)) continue;
        const label = labelForFilterStateCandidate(candidate);
        if (!label || label.length > 24) continue;
        const kind = classifyFilterLabel(label);
        if (kind === 'unknown') continue;
        const labels = byKind.get(kind) ?? new Set<string>();
        labels.add(canonicalFilterLabel(label));
        byKind.set(kind, labels);
      }
      const groupedChoiceCount = Array.from(byKind.values()).filter(
        (labels) => labels.size >= 2,
      ).length;
      return (
        groupedChoiceCount >= 1 &&
        Array.from(byKind.values()).flatMap((set) => [...set]).length >= 3
      );
    };

    const filterContextForElement = (element: Element): Element | null => {
      let current: Element | null = element;
      let depth = 0;
      while (current && current !== document.body && depth <= 6) {
        const role = normalize(current.getAttribute('role')).toLowerCase();
        const semanticText = elementSemanticText(current);
        if (explicitFilterContainerPattern.test(semanticText)) return current;
        if (
          ['listbox', 'tablist', 'radiogroup'].includes(role) &&
          hasGroupedFilterChoices(current)
        ) {
          return current;
        }
        if (
          ['dialog', 'menu', 'menubar'].includes(role) &&
          filterTriggerPattern.test(semanticText) &&
          hasGroupedFilterChoices(current)
        ) {
          return current;
        }
        current = current.parentElement;
        depth += 1;
      }
      return null;
    };

    const colorParts = (value: string): number[] => {
      const match = value.match(/rgba?\(([^)]+)\)/i);
      if (!match) return [];
      return match[1]
        .split(',')
        .slice(0, 4)
        .map((part) => Number.parseFloat(part.trim()));
    };

    const hasVisibleColor = (value: string): boolean => {
      const parts = colorParts(value);
      if (parts.length < 3) return false;
      const alpha = parts.length >= 4 ? parts[3] : 1;
      if (alpha <= 0.05) return false;
      const [red, green, blue] = parts;
      return Math.max(red, green, blue) - Math.min(red, green, blue) > 18;
    };

    const hasTintedBackground = (value: string): boolean => {
      const parts = colorParts(value);
      if (parts.length < 3) return false;
      const alpha = parts.length >= 4 ? parts[3] : 1;
      if (alpha <= 0.05) return false;
      const [red, green, blue] = parts;
      const nearWhite = red >= 248 && green >= 248 && blue >= 248;
      const nearTransparentGray = Math.max(red, green, blue) - Math.min(red, green, blue) <= 6;
      return !nearWhite && !nearTransparentGray;
    };

    const visualSelectedScore = (element: Element): number => {
      const style = window.getComputedStyle(element);
      const fontWeight = Number.parseInt(style.fontWeight || '400', 10);
      return (
        (fontWeight >= 600 ? 1 : 0) +
        (hasTintedBackground(style.backgroundColor) ? 1 : 0) +
        (hasVisibleColor(style.color) ? 1 : 0) +
        (hasVisibleColor(style.borderColor) ? 1 : 0)
      );
    };

    const renderedFilterCandidates = (selector: string): Element[] =>
      Array.from(document.querySelectorAll(selector)).filter((element): element is Element => {
        if (!(element instanceof Element)) return false;
        if (!elementIsRendered(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        if (rect.width > Math.max(480, window.innerWidth * 0.45)) return false;
        return true;
      });

    for (const element of renderedFilterCandidates(activeSelectors)) {
      if (!(element instanceof Element)) continue;
      const label = labelForFilterStateCandidate(element);
      if (!label || label.length > 24) continue;
      const kind = classifyFilterLabel(label);
      if (kind === 'unknown') continue;
      addFilter(label, kind, 'dom_active_state', 0.9);
    }

    const styleStateSelectors = [
      'button',
      'a',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[role="tab"]',
      '[aria-label]',
      '[title]',
      '[tabindex]',
      'span',
      'div',
      'li',
    ].join(',');
    for (const element of renderedFilterCandidates(styleStateSelectors).slice(0, 600)) {
      const label = labelForFilterStateCandidate(element);
      if (!label || label.length > 24) continue;
      const kind = classifyFilterLabel(label);
      if (kind === 'unknown') continue;
      if (!filterContextForElement(element)) continue;
      if (visualSelectedScore(element) < 2) continue;
      addFilter(label, kind, 'visual_style_state', 0.78);
    }
    const groups = {
      contentType: groupStateForKind(filters, 'content_type'),
      sort: groupStateForKind(filters, 'sort'),
      timeRange: groupStateForKind(filters, 'time_range'),
    };
    const filterGroups = genericFilterGroupsForFilters(filters);
    const appliedFilters = [
      selectedFilterForKind(filters, 'content_type'),
      selectedFilterForKind(filters, 'sort'),
      selectedFilterForKind(filters, 'time_range'),
    ].filter((filter): filter is AppliedSearchFilter => Boolean(filter));
    const appliedLabels = appliedFilters.map((filter) => filter.label);
    return {
      status: appliedLabels.length > 0 ? 'observed' : 'not_observed',
      appliedLabels,
      ...(groups.contentType.selected ? { contentType: groups.contentType.selected } : {}),
      ...(groups.sort.selected ? { sort: groups.sort.selected } : {}),
      ...(groups.timeRange.selected ? { timeRange: groups.timeRange.selected } : {}),
      filterGroups,
      groups,
      appliedFilters,
      claimBoundary:
        'Filter state is inferred from rendered active/selected DOM controls and bounded URL adapters. It proves current rendered page state, not global server ranking correctness.',
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

  const xpathLiteral = (value: string): string => {
    if (!value.includes("'")) return `'${value}'`;
    if (!value.includes('"')) return `"${value}"`;
    return `concat(${value
      .split("'")
      .map((part) => `'${part}'`)
      .join(`, "'", `)})`;
  };

  const xpathForVisibleTextControl = (label: string): string => {
    const literal = xpathLiteral(label);
    return `//*[self::button or self::a or self::span or self::div or @role='button' or @role='menuitem' or @role='option'][normalize-space(.)=${literal} and not(.//*[normalize-space(.)=${literal}])]`;
  };

  const xpathForElement = (element: Element): string | undefined => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const tag = current.tagName.toLowerCase();
      if (!tag) return undefined;
      const id = current.getAttribute('id');
      if (id) {
        parts.unshift(`*[@id=${xpathLiteral(id)}]`);
        return `//${parts.join('/')}`;
      }
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName.toLowerCase() === tag) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}[${index}]`);
      if (tag === 'html') break;
      current = current.parentElement;
    }
    return parts.length > 0 ? `/${parts.join('/')}` : undefined;
  };

  const stableIdentityHash = (value: string): string => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  };

  const normalizedHrefForTargetIdentity = (href: string): string => {
    try {
      const url = new URL(href, location.href);
      return `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname}`.toLowerCase();
    } catch {
      return normalize(href)
        .replace(/[?#].*$/, '')
        .toLowerCase();
    }
  };

  const stableResultCardTargetRef = (title: string, href: string): string => {
    const identity = `${normalize(title).toLowerCase()}|${normalizedHrefForTargetIdentity(href)}`;
    return `ref_result_card_${stableIdentityHash(identity)}`;
  };

  const sensitiveUrlParamPattern =
    /(?:^|[_-])(authorization|auth|cookie|csrf|xsrf|session|sid|secret|signature|sig|token|xsec|access[_-]?token|refresh[_-]?token|api[_-]?key|credential|oauth)(?:$|[_-])/i;
  const opaqueUrlValuePattern = /^[A-Za-z0-9._~+/=-]{24,}$/;

  const sanitizeResultCardUrlForAi = (href: string): string => {
    try {
      const url = new URL(href, location.href);
      for (const [key, value] of Array.from(url.searchParams.entries())) {
        if (sensitiveUrlParamPattern.test(key) || opaqueUrlValuePattern.test(value)) {
          url.searchParams.delete(key);
        }
      }
      url.hash = '';
      return url.href;
    } catch {
      return normalize(href).replace(/[?#].*$/, '');
    }
  };

  const stablePageTargetRef = (kind: string, label: string): string =>
    `ref_${kind}_${stableIdentityHash(`${location.hostname.toLowerCase()}|${kind}|${normalize(label).toLowerCase()}`)}`;

  const resultCardSelector = [
    'article',
    '[role="article"]',
    '[role="listitem"]',
    'li',
    '[class*="card" i]',
    '[class*="item" i]',
  ].join(',');

  const isElementScrollable = (element: Element): boolean => {
    const htmlElement = element as HTMLElement;
    if (htmlElement.scrollHeight <= htmlElement.clientHeight + 8) return false;
    try {
      const style = window.getComputedStyle(element);
      const overflowY = `${style.overflowY} ${style.overflow}`;
      if (
        !/(auto|scroll|overlay)/i.test(overflowY) &&
        element.querySelectorAll(`${resultCardSelector}, a[href]`).length === 0
      ) {
        return false;
      }
    } catch {
      if (element.querySelectorAll(`${resultCardSelector}, a[href]`).length === 0) {
        return false;
      }
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 80 && rect.height > 120 && rect.bottom > 0 && rect.top < window.innerHeight;
  };

  const scrollStateForElement = (
    element: Element | null,
    fallbackElement?: Element | null,
  ): {
    scrollY: number;
    scrollHeight: number;
    viewportHeight: number;
    pixelsBelow: number;
    scrollTarget: 'window' | 'element';
  } => {
    const scrollElement =
      element && isElementScrollable(element)
        ? element
        : fallbackElement && isElementScrollable(fallbackElement)
          ? fallbackElement
          : null;
    if (scrollElement) {
      const htmlElement = scrollElement as HTMLElement;
      return {
        scrollY: htmlElement.scrollTop,
        scrollHeight: htmlElement.scrollHeight,
        viewportHeight: htmlElement.clientHeight,
        pixelsBelow: Math.max(
          0,
          htmlElement.scrollHeight - htmlElement.scrollTop - htmlElement.clientHeight,
        ),
        scrollTarget: 'element',
      };
    }
    const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
    return {
      scrollY: window.scrollY,
      scrollHeight,
      viewportHeight: window.innerHeight,
      pixelsBelow: Math.max(0, scrollHeight - window.scrollY - window.innerHeight),
      scrollTarget: 'window',
    };
  };

  const nearestScrollableAncestor = (element: Element | null): Element | null => {
    let current = element?.parentElement ?? null;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isElementScrollable(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const labelForControl = (element: Element): string => {
    const htmlElement = element as HTMLElement;
    return normalize(
      ownVisibleText(element) ||
        element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        htmlElement.innerText ||
        element.textContent ||
        '',
    );
  };

  const isLikelyClickableControl = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    if (['button', 'a', 'input', 'select', 'textarea', 'label', 'summary'].includes(tag)) {
      return true;
    }
    const role = normalize(element.getAttribute('role')).toLowerCase();
    if (
      ['button', 'menuitem', 'option', 'tab', 'checkbox', 'radio', 'switch', 'combobox'].includes(
        role,
      )
    ) {
      return true;
    }
    if (element.hasAttribute('tabindex') || element.hasAttribute('aria-haspopup')) return true;
    const className = normalize((element as HTMLElement).className || '');
    if (filterContainerPattern.test(className)) return true;
    try {
      return window.getComputedStyle(element).cursor === 'pointer';
    } catch {
      return false;
    }
  };

  const closestClickableControl = (element: Element): Element | null => {
    let current: Element | null = element;
    let depth = 0;
    while (current && current !== document.body && depth <= 5) {
      if (elementIsVisible(current) && isLikelyClickableControl(current)) return current;
      current = current.parentElement;
      depth += 1;
    }
    return null;
  };

  const filterActionKindForLabel = (label: string): 'filter_trigger' | `filter_${string}` => {
    if (filterTriggerPattern.test(label)) return 'filter_trigger';
    const kind = classifyFilterLabel(label);
    return `filter_${kind}`;
  };

  const visibleFilterCandidateActions = (): PageCandidateAction[] => {
    const actionByKey = new Map<string, { action: PageCandidateAction; score: number }>();
    const candidateElements = Array.from(
      document.querySelectorAll(
        [
          'button',
          'a',
          '[role="button"]',
          '[role="menuitem"]',
          '[role="option"]',
          '[role="tab"]',
          '[aria-haspopup]',
          '[aria-label]',
          '[title]',
          '[tabindex]',
          '[class*="filter" i]',
          '[class*="sort" i]',
          '[class*="dropdown" i]',
          '[class*="popover" i]',
          '[class*="menu" i]',
          '[class*="panel" i]',
        ].join(','),
      ),
    );

    const textElements = Array.from(document.querySelectorAll('span,div,p,li')).filter(
      (element) => {
        const label = labelForControl(element);
        if (!label || label.length > 24) return false;
        return filterTriggerPattern.test(label) || classifyFilterLabel(label) !== 'unknown';
      },
    );
    const filterOptionRects = [...candidateElements, ...textElements]
      .filter((element): element is Element => element instanceof Element)
      .map((element) => {
        const label = labelForControl(element);
        if (
          !label ||
          filterTriggerPattern.test(label) ||
          classifyFilterLabel(label) === 'unknown'
        ) {
          return null;
        }
        const control = closestClickableControl(element);
        if (!control) return null;
        const rect = control.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return rect;
      })
      .filter((rect): rect is DOMRect => Boolean(rect));

    const isPlausibleFilterTrigger = (control: Element): boolean => {
      if (filterOptionRects.length === 0) return true;
      const rect = control.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const centerY = rect.top + rect.height / 2;
      const maxHorizontalGap = Math.max(360, window.innerWidth * 0.22);
      return filterOptionRects.some((optionRect) => {
        const optionCenterY = optionRect.top + optionRect.height / 2;
        const verticalGap = Math.abs(optionCenterY - centerY);
        const horizontalGap =
          optionRect.right < rect.left
            ? rect.left - optionRect.right
            : rect.right < optionRect.left
              ? optionRect.left - rect.right
              : 0;
        return verticalGap <= 128 && horizontalGap <= maxHorizontalGap;
      });
    };

    for (const element of [...candidateElements, ...textElements].slice(0, 500)) {
      if (!(element instanceof Element)) continue;
      if (!elementIsVisible(element)) continue;
      const label = labelForControl(element);
      if (!label || label.length > 24) continue;
      const filterKind = classifyFilterLabel(label);
      const isTrigger = filterTriggerPattern.test(label);
      if (!isTrigger && filterKind === 'unknown') continue;
      const control = closestClickableControl(element);
      if (!control) continue;
      if (isTrigger && !isPlausibleFilterTrigger(control)) continue;
      const hitScore = centerHitScore(control);
      if (hitScore < 0) continue;
      const selector = selectorForElement(control);
      const concreteXpath = xpathForElement(control);
      const canonicalLabel = isTrigger ? label : canonicalFilterLabel(label);
      const kind = filterActionKindForLabel(canonicalLabel);
      const targetRef = stablePageTargetRef(kind, canonicalLabel);

      const intent =
        kind === 'filter_trigger' ? 'search.open_filters' : `search.apply_filter.${filterKind}`;
      const action: PageCandidateAction = {
        id: `ca_${kind}_${stableIdentityHash(`${canonicalLabel}|${selector || ''}`)}`,
        actionType: 'click',
        targetRef,
        label: canonicalLabel,
        intent,
        matchReason: isTrigger ? 'visible_filter_trigger' : 'visible_filter_option',
        actionability: Boolean(selector),
        ...(selector ? {} : { actionabilityReason: 'missing_stable_selector' }),
        locatorChain: [
          { type: 'ref', value: targetRef },
          { type: 'aria', value: canonicalLabel },
          ...(concreteXpath ? [{ type: 'xpath', value: concreteXpath }] : []),
          { type: 'xpath', value: xpathForVisibleTextControl(canonicalLabel) },
          ...(selector ? [{ type: 'css', value: selector }] : []),
        ],
      };
      const rect = control.getBoundingClientRect();
      const tag = control.tagName.toLowerCase();
      const role = normalize(control.getAttribute('role')).toLowerCase();
      const directText = ownVisibleText(control);
      const accessibleText = normalize(
        control.getAttribute('aria-label') || control.getAttribute('title') || '',
      );
      const score =
        (selector ? 1000 : 0) +
        (directText === canonicalLabel ? 700 : 0) +
        (accessibleText === canonicalLabel ? 300 : 0) +
        (['button', 'a', 'input', 'select', 'summary'].includes(tag) ? 120 : 0) +
        (['button', 'menuitem', 'option', 'tab'].includes(role) ? 80 : 0) +
        hitScore +
        Math.min(120, (rect.width * rect.height) / 100);
      const dedupeKey = `${intent}|${targetRef}|${canonicalLabel}`;
      const previous = actionByKey.get(dedupeKey);
      if (!previous || score > previous.score) {
        actionByKey.set(dedupeKey, { action, score });
      }
    }

    return Array.from(actionByKey.values())
      .sort((left, right) => right.score - left.score)
      .map(({ action }) => action)
      .slice(0, maxVisibleFilterActions);
  };

  const searchTextEntryIdentityPattern = /\b(search|query|find|ask)\b|搜索|查找|提问|问/i;
  const nonSearchTextEntryIdentityPattern =
    /\b(password|passcode|otp|captcha|verify|verification|login|sign[ -]?in|auth|authorize|credential|phone|email|mail)\b|密码|验证码|校验|验证|登录|登陆|授权|手机号|邮箱/i;
  const textEntryIdentityText = (element: Element): string => {
    const values: string[] = [];
    let current: Element | null = element;
    let depth = 0;
    while (current && current !== document.body && depth <= 3) {
      values.push(
        current.getAttribute('id') || '',
        current.getAttribute('name') || '',
        current.getAttribute('class') || '',
        current.getAttribute('role') || '',
        current.getAttribute('aria-label') || '',
        current.getAttribute('placeholder') || '',
        current.getAttribute('title') || '',
        current.getAttribute('type') || '',
      );
      current = current.parentElement;
      depth += 1;
    }
    return values
      .map((value) => normalize(value))
      .filter(Boolean)
      .join(' ');
  };
  const isSearchTextEntryElement = (element: Element): boolean => {
    const tag = element.tagName.toLowerCase();
    const role = normalize(element.getAttribute('role')).toLowerCase();
    const type = normalize(element.getAttribute('type')).toLowerCase();
    const isTextEntry =
      tag === 'textarea' ||
      tag === 'input' ||
      element.getAttribute('contenteditable') === 'true' ||
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox';
    if (!isTextEntry) return false;
    if (
      tag === 'input' &&
      /^(hidden|password|checkbox|radio|submit|button|file|image|range|color)$/i.test(type)
    ) {
      return false;
    }
    if (role === 'searchbox' || type === 'search') return true;
    const identityText = textEntryIdentityText(element);
    if (nonSearchTextEntryIdentityPattern.test(identityText)) return false;
    return searchTextEntryIdentityPattern.test(identityText);
  };

  const searchInputCandidate = (): PageCandidateAction | null => {
    const input = Array.from(
      document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(
        'input, textarea, [contenteditable="true"], [role="textbox"], [role="searchbox"], [role="combobox"]',
      ),
    ).find(
      (element) =>
        element instanceof Element &&
        isSearchTextEntryElement(element) &&
        elementIsVisible(element) &&
        visibleRect(element),
    );
    if (!input) return null;
    const label = normalize(
      input.getAttribute('aria-label') ||
        input.getAttribute('placeholder') ||
        input.textContent ||
        '搜索输入框',
    );
    const selector = selectorForElement(input);
    const targetRef = stablePageTargetRef('search_input', label || 'search');
    return {
      id: `ca_fill_${targetRef}`,
      actionType: 'fill',
      targetRef,
      label: label || '搜索输入框',
      intent: 'search.enter_query',
      matchReason: 'visible_search_input',
      actionability: Boolean(selector),
      ...(selector ? {} : { actionabilityReason: 'missing_stable_selector' }),
      locatorChain: [
        { type: 'ref', value: targetRef },
        ...(label ? [{ type: 'aria', value: label }] : []),
        ...(selector ? [{ type: 'css', value: selector }] : []),
      ],
    };
  };

  const filterCandidateActions = (filterState: SearchFilterState): PageCandidateAction[] =>
    filterState.appliedFilters.map((filter) => {
      const targetRef = stablePageTargetRef(`filter_${filter.kind}`, filter.label);
      return {
        id: `ca_filter_${stableIdentityHash(`${filter.kind}|${filter.label}`)}`,
        actionType: 'click',
        targetRef,
        label: filter.label,
        intent: `search.apply_filter.${filter.kind}`,
        matchReason: filter.source,
        actionability: false,
        actionabilityReason: 'observed_selected_filter_without_stable_selector',
        locatorChain: [{ type: 'ref', value: targetRef }],
      };
    });

  const isLikelyDetailLink = (link: HTMLAnchorElement): boolean => {
    try {
      const url = new URL(link.href);
      const segments = url.pathname.split('/').filter(Boolean);
      const leaf = segments[segments.length - 1] ?? '';
      const collection = segments.length >= 2 ? segments[segments.length - 2] : '';
      if (!/^[a-z0-9][a-z0-9_-]{5,}$/i.test(leaf)) return false;
      return /^(article|articles|content|detail|explore|item|items|note|notes|post|posts|story|stories|search[_-]?result|result)$/i.test(
        collection,
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

  const sameNormalizedHref = (left: string, right: string): boolean => {
    if (!left || !right) return false;
    try {
      const leftUrl = new URL(left, location.href);
      const rightUrl = new URL(right, location.href);
      return `${leftUrl.origin}${leftUrl.pathname}` === `${rightUrl.origin}${rightUrl.pathname}`;
    } catch {
      return left.replace(/[?#].*$/, '') === right.replace(/[?#].*$/, '');
    }
  };

  const centerHitLinkFor = (link: HTMLAnchorElement, rect: DOMRect): HTMLAnchorElement | null => {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit) return null;
    const hitLink = hit.closest('a[href]');
    if (hit === link || link.contains(hit) || hitLink === link) return link;
    if (hitLink instanceof HTMLAnchorElement && sameNormalizedHref(hitLink.href, link.href)) {
      return hitLink;
    }
    return null;
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
    const visibleLinks = visibleLinkCandidates
      .map((item) => {
        const hitLink = centerHitLinkFor(item.link, item.rect);
        if (!hitLink) return null;
        const hitRect = visibleLinkRect(hitLink) ?? item.rect;
        return { link: hitLink, rect: hitRect, text: linkText(hitLink) };
      })
      .filter((item): item is { link: HTMLAnchorElement; rect: DOMRect; text: string } =>
        Boolean(item),
      );
    const fallbackVisibleDetailLink = (): {
      link: HTMLAnchorElement;
      rect: DOMRect;
      reasons: string[];
    } | null => {
      const fallbackDetailLink = [...visibleLinkCandidates]
        .filter((item) => isLikelyDetailLink(item.link))
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

    const detailLinks = visibleLinks.filter((item) => isLikelyDetailLink(item.link));
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
    const bestLinkText = linkTexts.find((line) => !metaPattern.test(line));
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
    const safeHref = sanitizeResultCardUrlForAi(href);
    const key = `${title.toLowerCase()}|${normalizedHrefForTargetIdentity(href)}`;
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
    const resultCardTargetRef = stableResultCardTargetRef(title, href);
    const primaryLinkHitVerified =
      Boolean(primaryLink) && !primaryLink?.reasons.includes('visible_detail_link_unverified_hit');
    const primaryLinkCanBindClickTarget = Boolean(
      primaryLink && primaryLinkSelector && primaryLinkHitVerified,
    );
    const primaryLinkMatchReason = primaryLinkHitVerified
      ? 'result_card_primary_link'
      : 'result_card_visible_detail_link';
    const resultCardCandidateAction =
      primaryLinkCanBindClickTarget && primaryLink && primaryLinkSelector
        ? {
            id: `ca_click_${resultCardTargetRef}`,
            actionType: 'click' as const,
            targetRef: resultCardTargetRef,
            ...(title ? { label: title } : {}),
            confidence: Math.min(primaryLinkHitVerified ? 0.94 : 0.88, confidence + 0.04),
            matchReason: primaryLinkMatchReason,
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
          url: safeHref,
          ...(primaryLinkSelector ? { selector: primaryLinkSelector } : {}),
          ...(primaryLinkText ? { text: primaryLinkText } : {}),
          executionScope: resultCardCandidateAction
            ? ('same_tab_fresh_snapshot' as const)
            : ('session_url' as const),
          openAction: {
            toolName: 'chrome_navigate' as const,
            toolArgs: { url: safeHref },
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
      ...(safeHref ? { url: safeHref } : {}),
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
  const filterState = collectFilterState();
  const searchAction = searchInputCandidate();
  const observedFilterActions = filterCandidateActions(filterState);
  const visibleFilterActions = visibleFilterCandidateActions();
  const visibleCardActions: PageCandidateAction[] = cards
    .map((card) => card.actionTarget?.toolArgs?.candidateAction)
    .filter((action): action is NonNullable<typeof action> => Boolean(action))
    .map((action) => ({
      id: action.id,
      actionType: 'click',
      targetRef: action.targetRef,
      label: action.label ?? '打开结果卡片',
      intent: action.intent,
      matchReason: action.matchReason,
      actionability: true,
      locatorChain: action.locatorChain,
    }));
  const candidateActions = [
    ...(searchAction ? [searchAction] : []),
    ...observedFilterActions,
    ...visibleFilterActions,
    ...visibleCardActions,
  ];
  const filterActionIds = [...observedFilterActions, ...visibleFilterActions].map(
    (action) => action.id,
  );
  const resultScrollSeed =
    resultListContainer ??
    candidates.find(
      (candidate) => nearestScrollableAncestor(candidate) || isElementScrollable(candidate),
    ) ??
    null;
  const scrollState = scrollStateForElement(
    nearestScrollableAncestor(resultScrollSeed),
    resultScrollSeed,
  );

  return {
    cards,
    filterState,
    pageRegions: [
      ...(searchAction
        ? [
            {
              regionId: 'search_input',
              regionType: 'search' as const,
              layoutHint: 'visible_search_control',
              state: 'observed' as const,
              readiness: 'ready' as const,
              targetability: searchAction.actionability,
              candidateActionIds: [searchAction.id],
            },
          ]
        : []),
      ...(filterState.status === 'observed' || filterActionIds.length > 0
        ? [
            {
              regionId: 'search_filters',
              regionType: 'filters' as const,
              layoutHint:
                visibleFilterActions.length > 0
                  ? 'visible_filter_controls_or_panel'
                  : 'visible_or_inferred_filter_state',
              state: 'observed' as const,
              readiness: 'ready' as const,
              targetability: [...observedFilterActions, ...visibleFilterActions].some(
                (action) => action.actionability,
              ),
              candidateActionIds: filterActionIds,
            },
          ]
        : []),
      ...(cards.length > 0
        ? [
            {
              regionId: 'result_list',
              regionType: 'results' as const,
              layoutHint: resultListContainer
                ? 'visible_result_card_grid_or_list'
                : 'inferred_from_visible_result_cards',
              state: 'observed' as const,
              readiness: cards.length > 0 ? ('ready' as const) : ('unknown' as const),
              targetability: cards.some((card) => Boolean(card.actionTarget)),
              candidateActionIds: cards
                .map((card) => card.actionTarget?.toolArgs?.candidateAction.id)
                .filter((id): id is string => Boolean(id)),
            },
          ]
        : []),
    ],
    candidateActions,
    pageInfo: {
      url: location.href,
      title: document.title,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      },
      scrollY: scrollState.scrollY,
      scrollHeight: scrollState.scrollHeight,
      pixelsBelow: scrollState.pixelsBelow,
      scrollTarget: scrollState.scrollTarget,
    },
  };
}

export function scrollPageBy(stepPx: number): ScrollStepResult {
  const resultCardSelector = [
    'article',
    '[role="article"]',
    '[role="listitem"]',
    'li',
    '[class*="card" i]',
    '[class*="item" i]',
  ].join(',');

  const visibleResultLikeElements = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(resultCardSelector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 80 || rect.height <= 60) return false;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
      const text = `${element.innerText || element.textContent || ''}`.replace(/\s+/g, ' ').trim();
      const hasMediaOrLink = element.querySelector('a[href], img, picture, video') !== null;
      return hasMediaOrLink || text.length >= 8;
    });

  const lowestVisibleResultLikeElement = (): HTMLElement | null => {
    const candidates = visibleResultLikeElements();
    return (
      candidates.sort(
        (left, right) => right.getBoundingClientRect().bottom - left.getBoundingClientRect().bottom,
      )[0] ?? null
    );
  };

  const isScrollableElement = (element: HTMLElement): boolean => {
    if (element === document.body || element === document.documentElement) return false;
    if (element.scrollHeight <= element.clientHeight + 8) return false;
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 80 ||
      rect.height <= 120 ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight
    ) {
      return false;
    }
    try {
      const style = window.getComputedStyle(element);
      const cardSignals = element.querySelectorAll(`${resultCardSelector}, a[href]`).length;
      return (
        /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`) || cardSignals > 0
      );
    } catch {
      return element.querySelectorAll(`${resultCardSelector}, a[href]`).length > 0;
    }
  };

  const nearestScrollableAncestor = (element: HTMLElement | null): HTMLElement | null => {
    let current = element?.parentElement ?? null;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const findScrollableElement = (): HTMLElement | null => {
    for (const card of visibleResultLikeElements()) {
      const ancestor = nearestScrollableAncestor(card);
      if (ancestor) return ancestor;
    }
    const elements = Array.from(document.querySelectorAll<HTMLElement>('*'));
    let best: { element: HTMLElement; score: number } | null = null;
    for (const element of elements) {
      if (!isScrollableElement(element)) continue;
      const rect = element.getBoundingClientRect();
      const cardSignals = element.querySelectorAll(`${resultCardSelector}, a[href]`).length;
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      const score = cardSignals * 10_000 + visibleHeight * Math.max(1, rect.width);
      if (!best || score > best.score) best = { element, score };
    }
    return best?.element ?? null;
  };

  const scrollElement = findScrollableElement();
  const beforeY = scrollElement ? scrollElement.scrollTop : window.scrollY;
  if (scrollElement) {
    if (typeof scrollElement.scrollBy === 'function') {
      scrollElement.scrollBy(0, stepPx);
    } else {
      scrollElement.scrollTop += stepPx;
    }
  } else {
    try {
      window.scrollBy(0, stepPx);
    } catch {
      /* jsdom and some locked pages do not expose native window scrolling. */
    }
  }
  let afterY = scrollElement ? scrollElement.scrollTop : window.scrollY;
  let interactionDispatched = false;
  let scrollIntoViewDispatched = false;
  if (Math.abs(afterY - beforeY) < 4) {
    const target =
      document.elementFromPoint(
        Math.round(window.innerWidth * 0.5),
        Math.round(window.innerHeight * 0.72),
      ) ||
      document.elementFromPoint(
        Math.round(window.innerWidth * 0.5),
        Math.round(window.innerHeight * 0.5),
      ) ||
      document.body;
    if (target) {
      const wheelInit = {
        bubbles: true,
        cancelable: true,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        deltaY: stepPx,
      };
      try {
        target.dispatchEvent(new WheelEvent('wheel', { ...wheelInit, view: window }));
      } catch {
        target.dispatchEvent(new WheelEvent('wheel', wheelInit));
      }
      interactionDispatched = true;
      afterY = scrollElement ? scrollElement.scrollTop : window.scrollY;
    }
  }
  if (Math.abs(afterY - beforeY) < 4) {
    const lowestCard = lowestVisibleResultLikeElement();
    if (lowestCard && typeof lowestCard.scrollIntoView === 'function') {
      try {
        lowestCard.scrollIntoView({ block: 'end', inline: 'nearest' });
        scrollIntoViewDispatched = true;
        afterY = scrollElement ? scrollElement.scrollTop : window.scrollY;
      } catch {
        // Some pages patch scrollIntoView or reject synthetic scrolling. The
        // caller will observe no movement and keep the claim bounded.
      }
    }
  }
  const scrollHeight = scrollElement
    ? scrollElement.scrollHeight
    : document.documentElement.scrollHeight || document.body.scrollHeight;
  const viewportHeight = scrollElement ? scrollElement.clientHeight : window.innerHeight;
  return {
    beforeY,
    afterY,
    scrollHeight,
    viewportHeight,
    pixelsBelow: Math.max(0, scrollHeight - afterY - viewportHeight),
    scrollTarget: scrollElement ? 'element' : 'window',
    ...(interactionDispatched ? { interactionDispatched } : {}),
    ...(scrollIntoViewDispatched ? { scrollIntoViewDispatched } : {}),
  };
}

export function scrollPageToTop(): ScrollStepResult {
  const resultCardSelector = [
    'article',
    '[role="article"]',
    '[role="listitem"]',
    'li',
    '[class*="card" i]',
    '[class*="item" i]',
  ].join(',');

  const visibleResultLikeElements = (): HTMLElement[] =>
    Array.from(document.querySelectorAll<HTMLElement>(resultCardSelector)).filter((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 80 || rect.height <= 60) return false;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight) return false;
      const text = `${element.innerText || element.textContent || ''}`.replace(/\s+/g, ' ').trim();
      const hasMediaOrLink = element.querySelector('a[href], img, picture, video') !== null;
      return hasMediaOrLink || text.length >= 8;
    });

  const isScrollableElement = (element: HTMLElement): boolean => {
    if (element === document.body || element === document.documentElement) return false;
    if (element.scrollHeight <= element.clientHeight + 8) return false;
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 80 ||
      rect.height <= 120 ||
      rect.bottom <= 0 ||
      rect.top >= window.innerHeight
    ) {
      return false;
    }
    try {
      const style = window.getComputedStyle(element);
      const cardSignals = element.querySelectorAll(`${resultCardSelector}, a[href]`).length;
      return (
        /(auto|scroll|overlay)/i.test(`${style.overflowY} ${style.overflow}`) || cardSignals > 0
      );
    } catch {
      return element.querySelectorAll(`${resultCardSelector}, a[href]`).length > 0;
    }
  };

  const nearestScrollableAncestor = (element: HTMLElement | null): HTMLElement | null => {
    let current = element?.parentElement ?? null;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isScrollableElement(current)) return current;
      current = current.parentElement;
    }
    return null;
  };

  const findScrollableElement = (): HTMLElement | null => {
    for (const card of visibleResultLikeElements()) {
      const ancestor = nearestScrollableAncestor(card);
      if (ancestor) return ancestor;
    }
    const elements = Array.from(document.querySelectorAll<HTMLElement>('*'));
    let best: { element: HTMLElement; score: number } | null = null;
    for (const element of elements) {
      if (!isScrollableElement(element)) continue;
      const rect = element.getBoundingClientRect();
      const cardSignals = element.querySelectorAll(`${resultCardSelector}, a[href]`).length;
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      const score = cardSignals * 10_000 + visibleHeight * Math.max(1, rect.width);
      if (!best || score > best.score) best = { element, score };
    }
    return best?.element ?? null;
  };

  const scrollElement = findScrollableElement();
  const beforeY = scrollElement ? scrollElement.scrollTop : window.scrollY;
  if (scrollElement) {
    if (typeof scrollElement.scrollTo === 'function') {
      scrollElement.scrollTo(0, 0);
    } else {
      scrollElement.scrollTop = 0;
    }
  } else {
    try {
      window.scrollTo(0, 0);
    } catch {
      /* jsdom and some locked pages do not expose native window scrolling. */
    }
  }
  const afterY = scrollElement ? scrollElement.scrollTop : window.scrollY;
  const scrollHeight = scrollElement
    ? scrollElement.scrollHeight
    : document.documentElement.scrollHeight || document.body.scrollHeight;
  const viewportHeight = scrollElement ? scrollElement.clientHeight : window.innerHeight;
  return {
    beforeY,
    afterY,
    scrollHeight,
    viewportHeight,
    pixelsBelow: Math.max(0, scrollHeight - afterY - viewportHeight),
    scrollTarget: scrollElement ? 'element' : 'window',
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
        scrollTarget: 'window' | 'element';
        observedCards: number;
        mergedCards: number;
        pixelsBelow: number;
      }> = [];
      const scrolls: ScrollStepResult[] = [];
      let latestPageInfo: VisibleCardScanResult['pageInfo'] | null = null;
      let latestFilterState: SearchFilterState | null = null;
      let latestPageRegions: PageRegionObject[] = [];
      let latestCandidateActions: PageCandidateAction[] = [];
      const startFromTop = args.startFromTop !== false;
      let bottomProbeAttempts = 0;

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
        latestPageRegions = scan.pageRegions;
        latestCandidateActions = scan.candidateActions;
        merged = mergeCollectedResultCards(merged, scan.cards, maxMergedCards);
        steps.push({
          step,
          scrollY: scan.pageInfo.scrollY,
          scrollTarget: scan.pageInfo.scrollTarget,
          observedCards: scan.cards.length,
          mergedCards: merged.length,
          pixelsBelow: scan.pageInfo.pixelsBelow,
        });
        const atVisualBottom = scan.pageInfo.pixelsBelow <= 8;
        if (
          merged.length >= minResults ||
          step >= maxScrolls ||
          (atVisualBottom && bottomProbeAttempts >= 2)
        ) {
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
        if (
          !scroll ||
          (Math.abs(scroll.afterY - scroll.beforeY) < 4 && !scroll.interactionDispatched)
        ) {
          break;
        }
        bottomProbeAttempts = atVisualBottom ? bottomProbeAttempts + 1 : 0;
        scrolls.push(scroll);
        await this.sleep(settleMs);
      }

      markBrowserWorldTabAiOperated(tab.id, 'collect_result_cards');
      const selectedCards = merged.slice(0, minResults);
      const targetabilitySummary = summarizeCollectedResultCardTargetability(selectedCards);
      const cardCandidateActions: PageCandidateAction[] = selectedCards
        .map((card) => card.actionTarget?.toolArgs?.candidateAction)
        .filter((action): action is NonNullable<typeof action> => Boolean(action))
        .map((action) => ({
          id: action.id,
          actionType: 'click',
          targetRef: action.targetRef,
          label: action.label ?? '打开结果卡片',
          intent: action.intent,
          matchReason: action.matchReason,
          actionability: true,
          locatorChain: action.locatorChain,
        }));
      const dedupedCandidateActions = dedupePageCandidateActions([
        ...latestCandidateActions,
        ...cardCandidateActions,
      ]);
      const candidateActionsById = new Map<string, PageCandidateAction>();
      for (const action of dedupedCandidateActions) {
        candidateActionsById.set(action.id, action);
      }
      const candidateActions = [...candidateActionsById.values()];
      const candidateActionIds = new Set(candidateActions.map((action) => action.id));
      const resultCardActionIds = cardCandidateActions.map((action) => action.id);
      const pageRegions =
        latestPageRegions.length > 0
          ? latestPageRegions.map((region) =>
              region.regionId === 'result_list'
                ? {
                    ...region,
                    targetability: resultCardActionIds.length > 0,
                    candidateActionIds: resultCardActionIds,
                  }
                : {
                    ...region,
                    targetability: region.candidateActionIds.some((id) =>
                      candidateActionIds.has(id),
                    ),
                    candidateActionIds: region.candidateActionIds.filter((id) =>
                      candidateActionIds.has(id),
                    ),
                  },
            )
          : [
              {
                regionId: 'result_list',
                regionType: 'results' as const,
                layoutHint: 'visible_result_card_grid_or_list',
                state: 'observed' as const,
                readiness: selectedCards.length > 0 ? ('ready' as const) : ('unknown' as const),
                targetability: resultCardActionIds.length > 0,
                candidateActionIds: resultCardActionIds,
              },
            ];
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
      const page = latestPageInfo
        ? {
            title: latestPageInfo.title,
            url: latestPageInfo.url,
            finalScrollY: latestPageInfo.scrollY,
            scrollTarget: latestPageInfo.scrollTarget,
            pixelsBelow: latestPageInfo.pixelsBelow,
          }
        : null;
      const collection = {
        steps,
        scrollsPerformed: scrolls.length,
        startFromTop,
        durationMs: Date.now() - startedAt,
      };
      const recommendedNextAction = complete
        ? 'Use these card objects as the stable top-N result set for ranking, opening, or summarizing.'
        : 'If top-N completeness matters, increase maxScrolls or use screenshot/manual verification for this page.';
      const claimBoundary =
        'This tool proves visible DOM card collection across bounded scroll steps; it does not prove hidden, personalized, or not-yet-loaded results outside the scanned range.';
      const outputMode = args.outputMode === 'compact' ? 'compact' : 'full';
      const compactPayload = {
        success: true,
        kind: 'result_card_collection',
        outputMode: 'compact' as const,
        page,
        pageRole: 'search_results',
        pageState: complete ? 'complete' : 'partial',
        sourceRoute: 'visible_dom_cards_bounded_scroll',
        selectedDataSource: 'visible_dom_result_cards',
        freshness: 'fresh',
        filterState: latestFilterState
          ? {
              status: latestFilterState.status,
              appliedLabels: latestFilterState.appliedLabels,
              contentType: latestFilterState.contentType,
              sort: latestFilterState.sort,
              timeRange: latestFilterState.timeRange,
              groups: latestFilterState.groups,
            }
          : null,
        tabId: tab.id,
        ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
        requestedMinResults: minResults,
        observedResultCount: cards.length,
        targetRefCoverageRate: targetabilitySummary.targetRefCoverageRate,
        targetabilitySummary,
        complete,
        status: complete ? 'complete_enough' : 'partial',
        cards: summarizeCollectedResultCardsForAi(selectedCards),
        collection,
        recommendedNextAction,
        claimBoundary,
      };
      const fullPayload = {
        success: true,
        kind: 'result_card_collection',
        outputMode: 'full' as const,
        page,
        pageRole: 'search_results',
        pageState: complete ? 'complete' : 'partial',
        sourceRoute: 'visible_dom_cards_bounded_scroll',
        selectedDataSource: 'visible_dom_result_cards',
        freshness: 'fresh',
        filterState: latestFilterState,
        pageRegions,
        candidateActions,
        tabId: tab.id,
        ...(tab.windowId !== undefined ? { windowId: tab.windowId } : {}),
        requestedMinResults: minResults,
        observedResultCount: cards.length,
        targetRefCoverageRate: targetabilitySummary.targetRefCoverageRate,
        targetabilitySummary,
        complete,
        status: complete ? 'complete_enough' : 'partial',
        cards: cards.map((card) => withCollectedResultCardSemanticAliases(card)),
        collection,
        recommendedNextAction,
        claimBoundary,
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(outputMode === 'compact' ? compactPayload : fullPayload),
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
