import type {
  ReadPageAssistantGuidance,
  ReadPageCandidateAction,
  ReadPageFrameContext,
  ReadPageInteractiveElement,
  ReadPageSearchResultCard,
  ReadPageSearchSurface,
} from '@tabrix/shared';
import type { VisibleRegionRowsResult } from './visible-region-rows';

const SEARCH_INPUT_ROLE_PATTERN = /^(searchbox|textbox|combobox)$/i;
const FILTER_LABEL_PATTERN = /^(筛选|已筛选|过滤|filter|filters|filtered)$/i;
const SORT_MENU_LABEL_PATTERN = /^(排序|sort)$/i;
const CATEGORY_LABEL_PATTERN = /^(全部|图文|视频|用户|all|images?|photos?|videos?|users?)$/i;
const SEARCH_TOOLBAR_LABEL_PATTERN =
  /^(筛选|已筛选|过滤|filter|filters|filtered|排序|sort|全部|图文|视频|用户|all|images?|photos?|videos?|users?)$/i;
const FILTER_PANEL_OPTION_PATTERN =
  /^(综合|最新|最热|最多点赞|最多评论|最多收藏|不限|一天内|一周内|半年内|已看过|未看过|已关注|同城|附近|all|latest|popular|most\s*(liked|commented|saved|collected)|any)$/i;
const CONTENT_TYPE_FILTER_OPTION_PATTERN =
  /^(图文|图片|视频|文章|image\s*text|images?|photos?|videos?|articles?)$/i;
const TIME_RANGE_FILTER_OPTION_PATTERN =
  /^(不限|一天内|一周内|半年内|24\s*h|7\s*d|week|month|any)$/i;
const SORT_FILTER_OPTION_PATTERN =
  /^(综合|最新|最热|最多点赞|最多评论|最多收藏|latest|popular|most\s*(liked|commented|saved|collected))$/i;
const FILTER_PANEL_ACTION_PATTERN =
  /^(清除|重置|确认|应用|收起|clear|reset|confirm|apply|collapse)$/i;
const SELECTED_STATE_PATTERN =
  /\b(selected|active|checked|current|applied)\b|已选|选中|当前|已应用/i;
const EXPANDED_STATE_PATTERN = /\bexpanded\b|展开/i;
const LOAD_MORE_PATTERN = /^(加载更多|更多|load\s*more|show\s*more)$/i;
const TEXT_SEARCH_TOOLBAR_REF_PATTERN = /^ref_text_search_toolbar_/;
const TEXT_FILTER_PANEL_REF_PATTERN = /^ref_text_filter_panel_/;
const SEARCH_INPUT_IDENTITY_PATTERN = /\b(search|query)\b|搜索|查找/i;
const SEARCH_TOOLBAR_VERTICAL_BAND_PX = 180;
const SEARCH_TOOLBAR_ROW_ALIGNMENT_PX = 80;
const SEARCH_TOOLBAR_HORIZONTAL_GAP_PX = 128;
const SEARCH_SUBMIT_PATTERN = /\b(search|find|query)\b|搜索|查找/i;
const COLLECTION_METRIC_PATTERN =
  /(?:收藏|saves?|saved|favorites?|favourites?|collected)\s*[:：]?\s*([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;
const COMPACT_COUNT_PATTERN = /([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;
const SEARCH_TOOLBAR_TEXT_SCAN_LINE_LIMIT = 80;
const KNOWN_CLUSTERED_SHORT_LABELS = [
  '全部',
  '图文',
  '视频',
  '用户',
  'All',
  'Image',
  'Images',
  'Photos',
  'Video',
  'Videos',
  'Users',
  '筛选',
  '排序',
  'Filter',
  'Filters',
  'Sort',
  '综合',
  '最新',
  '最热',
  '最多点赞',
  '最多评论',
  '最多收藏',
  '不限',
  '一天内',
  '一周内',
  '半年内',
  '已看过',
  '未看过',
  '已关注',
  '同城',
  '附近',
  '清除',
  '重置',
  '确认',
  '应用',
  '收起',
];

type SearchSurfaceControl = ReadPageSearchSurface['controls'][number];
type SearchSurfaceFilterPanel = NonNullable<ReadPageSearchSurface['filterPanel']>;
type SearchSurfaceFilterState = NonNullable<ReadPageSearchSurface['filterState']>;
type SearchSurfaceFilterGroupState = SearchSurfaceFilterState['contentType'];
type SearchSurfaceGenericFilterGroupState = SearchSurfaceFilterState['filterGroups'][number];
type SearchSurfaceFilterCandidate = SearchSurfaceFilterGroupState['candidates'][number];
type SearchResultDelta = NonNullable<ReadPageSearchSurface['resultDelta']>;

interface SearchResultDeltaSnapshot {
  contextKey: string;
  tabId: number;
  documentEpoch: string;
  observationSequence: number;
  resultCards: ReadPageSearchResultCard[];
  observedAtMs: number;
}

interface SearchResultObservationState {
  documentKey: string;
  documentEpoch: number;
  lastObservationSequence: number;
  lastObservedAtMs: number;
}

interface SearchResultObservationContext {
  accepted: boolean;
  contextKey: string;
  documentEpoch: string;
  observationSequence: number;
  observedAtMs: number;
  rejectionReason?: string;
}

const searchResultDeltaSnapshotsByContext = new Map<string, SearchResultDeltaSnapshot>();
const searchResultObservationStateByTab = new Map<number, SearchResultObservationState>();
const SEARCH_RESULT_DELTA_MAX_CONTEXTS = 64;
const SEARCH_RESULT_DELTA_MAX_TABS = 64;
const SEARCH_RESULT_DELTA_SNAPSHOT_TTL_MS = 90_000;

function guidanceRequestsSearch(params: {
  guidance: ReadPageAssistantGuidance | undefined;
  pageRole?: string | null;
}): boolean {
  if (params.pageRole === 'search_results') return true;
  const guidance = params.guidance;
  if (guidance?.taskKind === 'search') return true;
  return (guidance?.requestedObjects ?? []).some((item) =>
    ['search_input', 'result_cards', 'detail_metrics'].includes(item),
  );
}

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeLabel(value: unknown): string | undefined {
  const text = normalizeText(value);
  if (!text) return undefined;
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function normalizedKey(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function normalizeSearchResultKeyPart(value: unknown): string {
  return normalizedKey(value).replace(/\s+/g, ' ').slice(0, 120);
}

function stableSearchResultCardKey(card: ReadPageSearchResultCard): string {
  const stableTargetIdentity = normalizeSearchResultKeyPart(
    card.candidateActionId || card.targetRef || card.id,
  );
  if (/^(https?:\/\/|\/)/i.test(stableTargetIdentity)) {
    return `target:${stableTargetIdentity}`;
  }
  const title = normalizeSearchResultKeyPart(card.title);
  const secondary = normalizeSearchResultKeyPart(card.secondaryText);
  const primary = normalizeSearchResultKeyPart(card.primaryText);
  const semanticKey = [title, secondary || primary].filter(Boolean).join('|');
  if (semanticKey) return semanticKey;
  return stableTargetIdentity;
}

function dedupeResultCardsByStableKey(
  cards: readonly ReadPageSearchResultCard[],
): ReadPageSearchResultCard[] {
  const seen = new Set<string>();
  const deduped: ReadPageSearchResultCard[] = [];
  for (const card of cards) {
    const key = stableSearchResultCardKey(card);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(card);
  }
  return deduped;
}

function sampleResultKeys(cards: readonly ReadPageSearchResultCard[], limit = 5): string[] {
  return cards
    .map((card) => stableSearchResultCardKey(card))
    .filter(Boolean)
    .slice(0, limit);
}

export function buildSearchResultDelta(params: {
  previousResultCards?: readonly ReadPageSearchResultCard[] | null;
  currentResultCards: readonly ReadPageSearchResultCard[];
}): SearchResultDelta {
  const current = dedupeResultCardsByStableKey(params.currentResultCards);
  const previous = dedupeResultCardsByStableKey(params.previousResultCards ?? []);

  if (current.length === 0) {
    return {
      status: 'not_available',
      attribution: 'observation_only',
      actionId: null,
      beforeResultCount: previous.length,
      afterResultCount: 0,
      retainedCount: 0,
      addedCount: 0,
      removedCount: previous.length,
      reorderedCount: 0,
      overlapRate: null,
      changedEnough: false,
      sampleAddedResultKeys: [],
      sampleRemovedResultKeys: sampleResultKeys(previous),
      reason: 'no reliable structured result cards are available in the current read_page snapshot',
      claimBoundary:
        'Result delta is DOM/AX result-card evidence only; AI must still judge whether the page answers the task.',
    };
  }

  if (previous.length === 0) {
    return {
      status: 'baseline',
      attribution: 'observation_only',
      actionId: null,
      beforeResultCount: 0,
      afterResultCount: current.length,
      retainedCount: 0,
      addedCount: current.length,
      removedCount: 0,
      reorderedCount: 0,
      overlapRate: null,
      changedEnough: false,
      sampleAddedResultKeys: sampleResultKeys(current),
      sampleRemovedResultKeys: [],
      reason: 'first reliable structured result-card snapshot for this same-tab search context',
      claimBoundary:
        'Result delta is DOM/AX result-card evidence only; AI must still judge whether the page answers the task.',
    };
  }

  const previousByKey = new Map<string, ReadPageSearchResultCard>();
  previous.forEach((card) => {
    const key = stableSearchResultCardKey(card);
    previousByKey.set(key, card);
  });

  const previousKeys = previous.map((card) => stableSearchResultCardKey(card));
  const previousKeySet = new Set(previousKeys);
  const currentKeys = current.map((card) => stableSearchResultCardKey(card));
  const currentKeySet = new Set(currentKeys);
  const retained = current.filter((card) => previousByKey.has(stableSearchResultCardKey(card)));
  const added = current.filter((card) => !previousByKey.has(stableSearchResultCardKey(card)));
  const removed = previous.filter((card) => !currentKeySet.has(stableSearchResultCardKey(card)));
  const previousRetainedKeys = previousKeys.filter((key) => currentKeySet.has(key));
  const currentRetainedKeys = currentKeys.filter((key) => previousKeySet.has(key));
  const reorderedCount = currentRetainedKeys.reduce(
    (count, key, index) => count + (previousRetainedKeys[index] === key ? 0 : 1),
    0,
  );
  const overlapRate = Number(
    (retained.length / Math.max(previous.length, current.length)).toFixed(2),
  );
  const changedEnough = added.length > 0 || removed.length > 0 || reorderedCount > 0;

  return {
    status: changedEnough ? 'changed' : 'unchanged',
    attribution: 'observation_only',
    actionId: null,
    beforeResultCount: previous.length,
    afterResultCount: current.length,
    retainedCount: retained.length,
    addedCount: added.length,
    removedCount: removed.length,
    reorderedCount,
    overlapRate,
    changedEnough,
    sampleAddedResultKeys: sampleResultKeys(added),
    sampleRemovedResultKeys: sampleResultKeys(removed),
    reason: changedEnough
      ? 'structured result-card set changed between same-tab search snapshots'
      : 'structured result-card set is unchanged between same-tab search snapshots',
    claimBoundary:
      'Result delta is DOM/AX result-card evidence only; AI must still judge whether the page answers the task.',
  };
}

function normalizeSearchDeltaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const query =
      parsed.searchParams.get('q') ??
      parsed.searchParams.get('query') ??
      parsed.searchParams.get('keyword') ??
      parsed.searchParams.get('search') ??
      parsed.searchParams.get('text') ??
      '';
    return `${parsed.origin}${parsed.pathname}?query=${normalizeSearchResultKeyPart(query)}`;
  } catch {
    return normalizeSearchResultKeyPart(url);
  }
}

function searchResultDeltaContextKey(params: {
  tabId?: number | null;
  currentUrl?: string | null;
}): string | null {
  if (typeof params.tabId !== 'number' || !Number.isFinite(params.tabId)) return null;
  const url = normalizeText(params.currentUrl);
  if (!url) return null;
  return `tab:${params.tabId}:search:${normalizeSearchDeltaUrl(url)}`;
}

function pruneExpiredSearchResultDeltaSnapshots(nowMs: number): void {
  for (const [contextKey, snapshot] of searchResultDeltaSnapshotsByContext) {
    if (nowMs - snapshot.observedAtMs > SEARCH_RESULT_DELTA_SNAPSHOT_TTL_MS) {
      searchResultDeltaSnapshotsByContext.delete(contextKey);
    }
  }
}

function beginSearchResultObservation(params: {
  tabId?: number | null;
  currentUrl?: string | null;
  observedAtMs: number;
}): SearchResultObservationContext | null {
  const contextKey = searchResultDeltaContextKey(params);
  if (!contextKey || typeof params.tabId !== 'number') return null;
  const documentKey = normalizeSearchDeltaUrl(normalizeText(params.currentUrl));
  const previousState = searchResultObservationStateByTab.get(params.tabId);
  if (previousState && params.observedAtMs < previousState.lastObservedAtMs) {
    return {
      accepted: false,
      contextKey,
      documentEpoch: `epoch:${previousState.documentEpoch}`,
      observationSequence: previousState.lastObservationSequence,
      observedAtMs: params.observedAtMs,
      rejectionReason:
        'observation started before the latest accepted same-tab read and was discarded as out of order',
    };
  }

  const documentChanged = Boolean(previousState && previousState.documentKey !== documentKey);
  const documentEpoch = documentChanged
    ? previousState!.documentEpoch + 1
    : (previousState?.documentEpoch ?? 1);
  const observationSequence = (previousState?.lastObservationSequence ?? 0) + 1;
  if (documentChanged) {
    for (const [key, snapshot] of searchResultDeltaSnapshotsByContext) {
      if (snapshot.tabId === params.tabId) searchResultDeltaSnapshotsByContext.delete(key);
    }
  }
  searchResultObservationStateByTab.delete(params.tabId);
  searchResultObservationStateByTab.set(params.tabId, {
    documentKey,
    documentEpoch,
    lastObservationSequence: observationSequence,
    lastObservedAtMs: params.observedAtMs,
  });
  while (searchResultObservationStateByTab.size > SEARCH_RESULT_DELTA_MAX_TABS) {
    const firstTabId = searchResultObservationStateByTab.keys().next().value;
    if (firstTabId === undefined) break;
    searchResultObservationStateByTab.delete(firstTabId);
  }
  return {
    accepted: true,
    contextKey,
    documentEpoch: `epoch:${documentEpoch}`,
    observationSequence,
    observedAtMs: params.observedAtMs,
  };
}

function rememberSearchResultDeltaSnapshot(snapshot: SearchResultDeltaSnapshot): boolean {
  const existing = searchResultDeltaSnapshotsByContext.get(snapshot.contextKey);
  if (
    existing &&
    existing.documentEpoch === snapshot.documentEpoch &&
    (snapshot.observationSequence <= existing.observationSequence ||
      snapshot.observedAtMs < existing.observedAtMs)
  ) {
    return false;
  }
  searchResultDeltaSnapshotsByContext.delete(snapshot.contextKey);
  searchResultDeltaSnapshotsByContext.set(snapshot.contextKey, snapshot);
  while (searchResultDeltaSnapshotsByContext.size > SEARCH_RESULT_DELTA_MAX_CONTEXTS) {
    const firstKey = searchResultDeltaSnapshotsByContext.keys().next().value;
    if (firstKey === undefined) break;
    searchResultDeltaSnapshotsByContext.delete(firstKey);
  }
  return true;
}

export function resetSearchResultDeltaMemoryForTests(): void {
  searchResultDeltaSnapshotsByContext.clear();
  searchResultObservationStateByTab.clear();
}

function filterSemanticLabel(value: unknown): string {
  return normalizeText(value)
    .replace(/\b(selected|active|checked|current|applied)\b/gi, '')
    .replace(/已选|选中|当前|已应用/g, '')
    .trim();
}

function searchInputIdentityText(element: ReadPageInteractiveElement): string {
  const selector = String((element as { selector?: unknown }).selector ?? '');
  return [
    element.name,
    element.role,
    element.matchSource,
    element.ref,
    selector,
    (element as { href?: unknown }).href,
  ]
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .join(' ');
}

function isSearchInputElement(element: ReadPageInteractiveElement): boolean {
  const role = normalizeText(element.role).toLowerCase();
  if (!SEARCH_INPUT_ROLE_PATTERN.test(role)) return false;
  if (role === 'searchbox') return true;
  return SEARCH_INPUT_IDENTITY_PATTERN.test(searchInputIdentityText(element));
}

function canonicalFilterLabel(label: string, _group?: SearchSurfaceControl['filterGroup']): string {
  return normalizeText(label);
}

function canonicalControlLabel(params: {
  label: unknown;
  kind?: SearchSurfaceControl['kind'];
  filterGroup?: SearchSurfaceControl['filterGroup'];
}): string | undefined {
  const label = safeLabel(params.label);
  if (!label) return undefined;
  if (params.kind === 'category_tab') return canonicalFilterLabel(label, 'content_type');
  return canonicalFilterLabel(label, params.filterGroup);
}

function isFilterLabel(value: unknown): boolean {
  return FILTER_LABEL_PATTERN.test(normalizeText(value));
}

function isSortMenuLabel(value: unknown): boolean {
  return SORT_MENU_LABEL_PATTERN.test(normalizeText(value));
}

function isCategoryLabel(value: unknown): boolean {
  return CATEGORY_LABEL_PATTERN.test(normalizeText(value));
}

function isSearchToolbarOptionAnchorLabel(value: unknown): boolean {
  const label = filterSemanticLabel(value);
  return (
    FILTER_PANEL_OPTION_PATTERN.test(label) ||
    CONTENT_TYPE_FILTER_OPTION_PATTERN.test(label) ||
    TIME_RANGE_FILTER_OPTION_PATTERN.test(label)
  );
}

function rectTop(element: ReadPageInteractiveElement | undefined): number | undefined {
  const y = element?.rect?.y;
  return typeof y === 'number' && Number.isFinite(y) ? y : undefined;
}

function isSearchToolbarAnchor(element: ReadPageInteractiveElement): boolean {
  const role = normalizeText(element.role).toLowerCase();
  const name = normalizeText(element.name);
  return (
    (SEARCH_INPUT_ROLE_PATTERN.test(role) && SEARCH_SUBMIT_PATTERN.test(name || role)) ||
    isFilterLabel(name) ||
    isSortMenuLabel(name) ||
    isCategoryLabel(name) ||
    isSearchToolbarOptionAnchorLabel(name)
  );
}

function isSearchToolbarBandElement(
  element: ReadPageInteractiveElement | undefined,
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  const currentTop = rectTop(element);
  if (currentTop === undefined) return true;

  const anchorTops = interactiveElements
    .filter(isSearchToolbarAnchor)
    .map(rectTop)
    .filter((top): top is number => top !== undefined)
    .sort((left, right) => left - right);
  const topAnchor = anchorTops[0];
  if (topAnchor === undefined) return true;

  return currentTop - topAnchor <= SEARCH_TOOLBAR_VERTICAL_BAND_PX;
}

function rectCenterY(element: ReadPageInteractiveElement): number | undefined {
  const rect = element.rect;
  if (!rect) return undefined;
  const y = rect.y;
  const height = rect.height;
  if (
    typeof y !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(y) ||
    !Number.isFinite(height)
  ) {
    return undefined;
  }
  return y + height / 2;
}

function rectLeft(element: ReadPageInteractiveElement): number | undefined {
  const x = element.rect?.x;
  return typeof x === 'number' && Number.isFinite(x) ? x : undefined;
}

function rectRight(element: ReadPageInteractiveElement): number | undefined {
  const rect = element.rect;
  if (!rect) return undefined;
  const x = rect.x;
  const width = rect.width;
  if (
    typeof x !== 'number' ||
    typeof width !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(width)
  ) {
    return undefined;
  }
  return x + width;
}

function isSearchToolbarRowElement(
  element: ReadPageInteractiveElement,
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  if (!isSearchToolbarBandElement(element, interactiveElements)) return false;
  const centerY = rectCenterY(element);
  const left = rectLeft(element);
  const right = rectRight(element);
  if (centerY === undefined || left === undefined || right === undefined) return true;

  const rowAnchors = interactiveElements.filter((anchor) => {
    if (anchor.ref === element.ref) return false;
    if (!isSearchToolbarAnchor(anchor)) return false;
    const anchorCenterY = rectCenterY(anchor);
    return (
      anchorCenterY !== undefined &&
      Math.abs(anchorCenterY - centerY) <= SEARCH_TOOLBAR_ROW_ALIGNMENT_PX
    );
  });

  if (rowAnchors.length === 0) return true;

  const rowLeft = Math.min(
    ...rowAnchors.map(rectLeft).filter((value): value is number => value !== undefined),
  );
  const rowRight = Math.max(
    ...rowAnchors.map(rectRight).filter((value): value is number => value !== undefined),
  );
  if (!Number.isFinite(rowLeft) || !Number.isFinite(rowRight)) return true;

  if (
    left <= rowRight + SEARCH_TOOLBAR_HORIZONTAL_GAP_PX &&
    right >= rowLeft - SEARCH_TOOLBAR_HORIZONTAL_GAP_PX
  ) {
    return true;
  }

  return interactiveElements.some((anchor) => {
    if (anchor.ref === element.ref) return false;
    if (!isSearchToolbarOptionAnchorLabel(anchor.name)) return false;
    const anchorCenterY = rectCenterY(anchor);
    const anchorLeft = rectLeft(anchor);
    const anchorRight = rectRight(anchor);
    if (anchorCenterY === undefined || anchorLeft === undefined || anchorRight === undefined) {
      return false;
    }
    const verticalBelowGap = anchorCenterY - centerY;
    const horizontalGap =
      anchorRight < left ? left - anchorRight : right < anchorLeft ? anchorLeft - right : 0;
    return (
      verticalBelowGap > 0 &&
      verticalBelowGap <= SEARCH_TOOLBAR_VERTICAL_BAND_PX * 2 &&
      horizontalGap <= SEARCH_TOOLBAR_HORIZONTAL_GAP_PX
    );
  });
}

function isFilterPanelOptionLabel(value: unknown): boolean {
  const label = filterSemanticLabel(value);
  return (
    FILTER_PANEL_OPTION_PATTERN.test(label) ||
    CONTENT_TYPE_FILTER_OPTION_PATTERN.test(label) ||
    TIME_RANGE_FILTER_OPTION_PATTERN.test(label)
  );
}

function isStatefulFilterOptionElement(element: ReadPageInteractiveElement): boolean {
  const label = normalizeText(element.name);
  if (!label || label.length > 80) return false;
  const role = normalizeText(element.role).toLowerCase();
  if (role === 'link' || role === 'textbox' || role === 'searchbox' || role === 'combobox') {
    return false;
  }
  return element.checked === true;
}

function isFilterPanelOptionElement(
  element: ReadPageInteractiveElement,
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  const label = normalizeText(element.name);
  if (!isFilterPanelOptionLabel(label) && !isStatefulFilterOptionElement(element)) return false;
  const role = normalizeText(element.role).toLowerCase();
  if (role === 'link' || role === 'textbox' || role === 'searchbox' || role === 'combobox') {
    return false;
  }
  if (
    CONTENT_TYPE_FILTER_OPTION_PATTERN.test(label) &&
    isSearchToolbarBandElement(element, interactiveElements) &&
    !TEXT_FILTER_PANEL_REF_PATTERN.test(element.ref)
  ) {
    return false;
  }
  if (TEXT_FILTER_PANEL_REF_PATTERN.test(element.ref)) return true;
  return true;
}

function controlKindForToolbarLabel(label: string): SearchSurfaceControl['kind'] {
  if (isCategoryLabel(label)) return 'category_tab';
  if (isSortMenuLabel(label)) return 'sort_menu';
  if (isFilterLabel(label)) return 'filter_trigger';
  return 'unknown';
}

function isTextRecoveredRef(value: string): boolean {
  return TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(value) || TEXT_FILTER_PANEL_REF_PATTERN.test(value);
}

function controlKindForFilterPanelLabel(label: string): SearchSurfaceControl['kind'] {
  if (FILTER_PANEL_ACTION_PATTERN.test(label)) return 'filter_panel_action';
  return 'filter_panel_option';
}

function filterGroupForFilterPanelLabel(
  label: string,
): SearchSurfaceControl['filterGroup'] | undefined {
  const semanticLabel = filterSemanticLabel(label);
  if (CONTENT_TYPE_FILTER_OPTION_PATTERN.test(semanticLabel)) return 'content_type';
  if (SORT_FILTER_OPTION_PATTERN.test(semanticLabel)) return 'sort';
  if (TIME_RANGE_FILTER_OPTION_PATTERN.test(semanticLabel)) return 'time_range';
  if (FILTER_PANEL_ACTION_PATTERN.test(semanticLabel)) return 'panel_action';
  return 'other';
}

function inferFilterGroupFromVisibleText(
  label: string,
  visibleTextContent: string | null | undefined,
): SearchSurfaceControl['filterGroup'] | undefined {
  const fallback = filterGroupForFilterPanelLabel(label);
  if (fallback && fallback !== 'other') return fallback;
  const labelKey = normalizedKey(filterSemanticLabel(label));
  if (!labelKey) return fallback;
  for (const rawLine of String(visibleTextContent ?? '').split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (!line) continue;
    const semanticLine = filterSemanticLabel(line);
    const labelIndex = normalizedKey(semanticLine).indexOf(labelKey);
    if (labelIndex <= 0) continue;
    const prefix = semanticLine.slice(0, labelIndex).trim();
    const prefixParts = prefix
      .split(/[\s|｜/、,，:：]+/)
      .map(normalizeText)
      .filter(Boolean);
    if (prefixParts.length === 0 || prefixParts.length > 3) continue;
    const groupLabel = safeLabel(prefixParts.join(' '));
    if (groupLabel && !FILTER_PANEL_ACTION_PATTERN.test(groupLabel)) return groupLabel;
  }
  return fallback;
}

function isContentTypeFilterGroup(value: unknown): boolean {
  return value === 'content_type';
}

function isSortFilterGroup(value: unknown): boolean {
  return value === 'sort';
}

function isTimeRangeFilterGroup(value: unknown): boolean {
  return value === 'time_range';
}

export function extractSearchToolbarLabelsFromVisibleText(
  visibleTextContent: string | null | undefined,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, SEARCH_TOOLBAR_TEXT_SCAN_LINE_LIMIT);

  for (const line of lines) {
    const clusteredMatches = KNOWN_CLUSTERED_SHORT_LABELS.filter(
      (label) => line.includes(label) && SEARCH_TOOLBAR_LABEL_PATTERN.test(label),
    );
    if (clusteredMatches.length >= 2) {
      for (const label of clusteredMatches) {
        const key = normalizedKey(label);
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
        if (labels.length >= 12) return labels;
      }
    }
    const candidates = [...(line.length <= 80 ? [line] : []), ...line.split(/[\s|｜/、,，]+/)]
      .map((item) => normalizeText(item))
      .filter(Boolean);
    for (const candidate of candidates) {
      if (!SEARCH_TOOLBAR_LABEL_PATTERN.test(candidate)) continue;
      const key = normalizedKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(candidate);
      if (labels.length >= 12) return labels;
    }
  }
  return labels;
}

function metricTextForRow(row: VisibleRegionRowsResult['rows'][number]): string {
  return [
    row.interactionText,
    row.metaText,
    row.summary,
    row.secondaryText,
    ...row.visibleTextFields,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' ');
}

export function parseCollectionCountCandidate(text: string): number | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  if (!/(收藏|saves?|saved|favorites?|favourites?|collected)/i.test(normalized)) {
    return undefined;
  }
  const metricMatch = COLLECTION_METRIC_PATTERN.exec(normalized);
  const countMatch = metricMatch?.[1] ?? COMPACT_COUNT_PATTERN.exec(normalized)?.[1];
  if (!countMatch) return undefined;
  const compact = countMatch.replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  const numeric = Number.parseFloat(compact.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric)) return undefined;
  if (/[万]/.test(compact)) return Math.round(numeric * 10000);
  if (/[千]/.test(compact)) return Math.round(numeric * 1000);
  if (/k$/.test(compact)) return Math.round(numeric * 1000);
  if (/m$/.test(compact)) return Math.round(numeric * 1000000);
  return Math.round(numeric);
}

function actionForRef(
  candidateActions: readonly ReadPageCandidateAction[],
  targetRef: string | undefined,
): ReadPageCandidateAction | undefined {
  if (!targetRef) return undefined;
  return candidateActions.find((action) => action.targetRef === targetRef);
}

function isFilterPanelAction(action: ReadPageCandidateAction | undefined, label?: string): boolean {
  if (!action) return false;
  if (!action.intent) return true;
  if (/^search\.apply_filter\./.test(action.intent)) return true;
  if (
    action.intent === 'search.category_select' &&
    label !== undefined &&
    CONTENT_TYPE_FILTER_OPTION_PATTERN.test(normalizeText(label)) &&
    TEXT_FILTER_PANEL_REF_PATTERN.test(action.targetRef)
  ) {
    return true;
  }
  return /^filter\./.test(action.intent);
}

function candidateActionLabel(action: ReadPageCandidateAction): string | undefined {
  const directLabel = safeLabel((action as { label?: unknown }).label);
  if (directLabel) return directLabel;
  const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
  return safeLabel(ariaLabel);
}

function isVisibleFilterPanelCandidateAction(
  action: ReadPageCandidateAction,
  label?: string,
): boolean {
  if (!Array.isArray(action.locatorChain) || action.locatorChain.length === 0) return false;
  if (!isFilterPanelAction(action, label)) return false;
  const reason = normalizeText(action.matchReason).toLowerCase();
  return (
    reason.includes('visible_filter_option') ||
    reason.includes('dom_active_state') ||
    TEXT_FILTER_PANEL_REF_PATTERN.test(action.targetRef) ||
    /^ref_filter_/.test(action.targetRef)
  );
}

function actionForFilterPanelRef(
  candidateActions: readonly ReadPageCandidateAction[],
  targetRef: string | undefined,
  label?: string,
): ReadPageCandidateAction | undefined {
  if (!targetRef) return undefined;
  return candidateActions.find(
    (action) => action.targetRef === targetRef && isFilterPanelAction(action, label),
  );
}

function actionForToolbarLabel(
  candidateActions: readonly ReadPageCandidateAction[],
  label: string,
  interactiveElements: readonly ReadPageInteractiveElement[],
): ReadPageCandidateAction | undefined {
  const key = normalizedKey(label);
  return candidateActions.find((action) => {
    if (isCategoryLabel(label)) {
      const element = interactiveElements.find((item) => item.ref === action.targetRef);
      if (!isSearchToolbarBandElement(element, interactiveElements)) return false;
    }
    const locatorLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    if (normalizedKey(locatorLabel) === key) return true;
    if (TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(action.targetRef)) {
      return action.locatorChain.some((item) => normalizedKey(item.value) === key);
    }
    return false;
  });
}

function actionForFilterPanelLabel(
  candidateActions: readonly ReadPageCandidateAction[],
  label: string,
  interactiveElements: readonly ReadPageInteractiveElement[],
): ReadPageCandidateAction | undefined {
  const key = normalizedKey(label);
  return candidateActions.find((action) => {
    if (!isFilterPanelAction(action, label)) return false;
    const element = interactiveElements.find((item) => item.ref === action.targetRef);
    const isPanelCandidate = element
      ? isFilterPanelOptionElement(element, interactiveElements)
      : isVisibleFilterPanelCandidateAction(action, label);
    if (!isPanelCandidate) return false;
    if (normalizedKey(element?.name) === key) return true;
    if (normalizedKey(candidateActionLabel(action)) === key) return true;
    const locatorLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    if (normalizedKey(locatorLabel) === key) return true;
    return action.locatorChain.some((item) => normalizedKey(item.value) === key);
  });
}

function findControlAction(
  candidateActions: readonly ReadPageCandidateAction[],
  intent: string,
): ReadPageCandidateAction | undefined {
  return candidateActions.find((action) => action.intent === intent);
}

function findToolbarControlAction(
  candidateActions: readonly ReadPageCandidateAction[],
  intent: string,
): ReadPageCandidateAction | undefined {
  return candidateActions.find(
    (action) =>
      action.intent === intent &&
      !TEXT_FILTER_PANEL_REF_PATTERN.test(action.targetRef) &&
      TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(action.targetRef),
  );
}

function isSortAppliedCandidate(element: ReadPageInteractiveElement | undefined): boolean {
  if (!element) return false;
  if (element.checked === true) return true;
  const text = normalizeText(
    [element.name, element.role, element.matchSource, element.actionability].join(' '),
  );
  return /\b(selected|active|checked|current)\b|已选|选中|当前排序|已应用/i.test(text);
}

function controlStateForElement(
  element: ReadPageInteractiveElement,
): SearchSurfaceControl['state'] | undefined {
  const text = normalizeText(
    [element.name, element.role, element.matchSource, element.actionability].join(' '),
  );
  const selected = element.checked === true || SELECTED_STATE_PATTERN.test(text);
  const expanded = EXPANDED_STATE_PATTERN.test(text);
  if (!selected && !expanded) return undefined;
  return {
    ...(selected ? { selected: true, current: true } : {}),
    ...(expanded ? { expanded: true } : {}),
    reason: 'state inferred from structured interactive element text or checked flag',
  };
}

function stateForRecoveredAction(
  action: ReadPageCandidateAction,
  label: string,
  interactiveElements: readonly ReadPageInteractiveElement[],
  visibleSearchFilterState?: unknown,
): SearchSurfaceControl['state'] | undefined {
  const directRefs = new Set(
    [action.targetRef, action.provenance?.optionRef].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    ),
  );
  const directElement = interactiveElements.find((item) => directRefs.has(item.ref));
  if (directElement) return controlStateForElement(directElement);

  const scopedGroupId = action.provenance?.groupId;
  if (scopedGroupId) {
    const scopedPanelRef = action.provenance?.panelRef;
    const rawState = readObject(visibleSearchFilterState);
    const filterGroups = Array.isArray(rawState?.filterGroups) ? rawState.filterGroups : [];
    const matchingGroups = filterGroups
      .map(readObject)
      .filter(
        (item) =>
          normalizedKey(item?.groupId) === normalizedKey(scopedGroupId) ||
          normalizedKey(item?.groupLabel) === normalizedKey(scopedGroupId),
      );
    const groupForPanel = scopedPanelRef
      ? matchingGroups.find(
          (item) =>
            normalizedKey(readString(readObject(item?.provenance)?.panelRef)) ===
            normalizedKey(scopedPanelRef),
        )
      : undefined;
    const group =
      groupForPanel ??
      (matchingGroups.every((item) => !readString(readObject(item?.provenance)?.panelRef))
        ? matchingGroups[0]
        : undefined);
    const selected = readString(group?.selected);
    if (selected && normalizedKey(selected) === normalizedKey(label)) {
      return {
        selected: true,
        current: true,
        reason: 'state matched by floating-surface panel and group provenance',
      };
    }
    return undefined;
  }

  const key = normalizedKey(label);
  const element = interactiveElements.find((item) => normalizedKey(item.name) === key);
  return element ? controlStateForElement(element) : undefined;
}

function controlForElement(params: {
  kind: SearchSurfaceControl['kind'];
  element: ReadPageInteractiveElement;
  candidateActions: readonly ReadPageCandidateAction[];
  reason: string;
  confidence: number;
  filterGroup?: SearchSurfaceControl['filterGroup'];
}): SearchSurfaceControl {
  const directAction =
    params.kind === 'filter_panel_action' || params.kind === 'filter_panel_option'
      ? actionForFilterPanelRef(params.candidateActions, params.element.ref, params.element.name)
      : actionForRef(params.candidateActions, params.element.ref);
  const action =
    directAction ??
    actionForElementLabel({
      kind: params.kind,
      element: params.element,
      candidateActions: params.candidateActions,
    });
  const state = controlStateForElement(params.element);
  return {
    kind: params.kind,
    targetRef: params.element.ref,
    candidateActionId: action?.id,
    label: canonicalControlLabel({
      label: params.element.name,
      kind: params.kind,
      filterGroup: params.filterGroup,
    }),
    confidence: params.confidence,
    actionability: params.element.actionability,
    source: isTextRecoveredRef(params.element.ref) ? 'text_recovery' : 'interactive_elements',
    rect: params.element.rect,
    ...(state ? { state } : {}),
    ...(params.filterGroup ? { filterGroup: params.filterGroup } : {}),
    reason: params.reason,
  };
}

function actionForElementLabel(params: {
  kind: SearchSurfaceControl['kind'];
  element: ReadPageInteractiveElement;
  candidateActions: readonly ReadPageCandidateAction[];
}): ReadPageCandidateAction | undefined {
  const label = safeLabel(params.element.name);
  if (!label) return undefined;
  if (
    params.kind === 'filter_trigger' ||
    params.kind === 'sort_menu' ||
    params.kind === 'category_tab'
  ) {
    return actionForToolbarLabel(params.candidateActions, label, [params.element]);
  }
  if (params.kind === 'filter_panel_action' || params.kind === 'filter_panel_option') {
    return actionForFilterPanelLabel(params.candidateActions, label, [params.element]);
  }
  return undefined;
}

function controlForRecoveredAction(params: {
  kind: SearchSurfaceControl['kind'];
  label: string;
  action: ReadPageCandidateAction;
  interactiveElements: readonly ReadPageInteractiveElement[];
  visibleSearchFilterState?: unknown;
  reason: string;
  confidence: number;
  filterGroup?: SearchSurfaceControl['filterGroup'];
}): SearchSurfaceControl {
  const state = stateForRecoveredAction(
    params.action,
    params.label,
    params.interactiveElements,
    params.visibleSearchFilterState,
  );
  return {
    kind: params.kind,
    targetRef: params.action.targetRef,
    candidateActionId: params.action.id,
    label: canonicalControlLabel({
      label: params.label,
      kind: params.kind,
      filterGroup: params.filterGroup,
    }),
    confidence: params.confidence,
    source: 'text_recovery',
    ...(state ? { state } : {}),
    ...(params.filterGroup ? { filterGroup: params.filterGroup } : {}),
    reason: params.reason,
  };
}

function unresolvedControlForLabel(label: string): SearchSurfaceControl {
  return {
    kind: controlKindForToolbarLabel(label),
    label: safeLabel(label),
    confidence: 0.52,
    source: 'visible_text_unresolved',
    reason:
      'toolbar label is visible in page text, but no reliable targetRef or locatorChain was recovered in this snapshot',
  };
}

function hasControlWithLabel(controls: readonly SearchSurfaceControl[], label: string): boolean {
  const key = normalizedKey(label);
  return controls.some((control) => normalizedKey(control.label) === key);
}

function hasOnlyOutOfBandCategoryElements(
  label: string,
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  if (!isCategoryLabel(label)) return false;
  const key = normalizedKey(label);
  const matchingElements = interactiveElements.filter(
    (element) => isCategoryLabel(element.name) && normalizedKey(element.name) === key,
  );
  if (matchingElements.length === 0) return false;
  return matchingElements.every(
    (element) => !isSearchToolbarBandElement(element, interactiveElements),
  );
}

function pushUniqueControl(target: SearchSurfaceControl[], control: SearchSurfaceControl): void {
  const key = `${control.kind}:${normalizedKey(control.label)}:${control.targetRef || ''}`;
  if (
    target.some(
      (item) => `${item.kind}:${normalizedKey(item.label)}:${item.targetRef || ''}` === key,
    )
  ) {
    return;
  }
  target.push(control);
}

function extractShortLabels(
  visibleTextContent: string | null | undefined,
  pattern: RegExp,
  limit = 16,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => normalizeText(line))
    .filter(Boolean)
    .slice(0, SEARCH_TOOLBAR_TEXT_SCAN_LINE_LIMIT);
  for (const line of lines) {
    const clusteredMatches = KNOWN_CLUSTERED_SHORT_LABELS.filter(
      (label) => line.includes(label) && pattern.test(label),
    );
    if (clusteredMatches.length >= 2) {
      for (const label of clusteredMatches) {
        const key = normalizedKey(label);
        if (seen.has(key)) continue;
        seen.add(key);
        labels.push(label);
        if (labels.length >= limit) return labels;
      }
    }
    const candidates = [...(line.length <= 80 ? [line] : []), ...line.split(/[\s|｜/、,，]+/)]
      .map((item) => normalizeText(item))
      .filter(Boolean);
    for (const candidate of candidates) {
      if (!pattern.test(candidate)) continue;
      const key = normalizedKey(candidate);
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(candidate);
      if (labels.length >= limit) return labels;
    }
  }
  return labels;
}

export function extractFilterPanelLabelsFromVisibleText(
  visibleTextContent: string | null | undefined,
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const label of [
    ...extractShortLabels(visibleTextContent, FILTER_PANEL_OPTION_PATTERN, 16),
    ...extractShortLabels(visibleTextContent, CONTENT_TYPE_FILTER_OPTION_PATTERN, 8),
    ...extractShortLabels(visibleTextContent, TIME_RANGE_FILTER_OPTION_PATTERN, 8),
    ...extractShortLabels(visibleTextContent, FILTER_PANEL_ACTION_PATTERN, 8),
  ]) {
    const key = normalizedKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

function uniqueLabels(labels: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const label of labels) {
    const normalized = safeLabel(label);
    const key = normalizedKey(normalized);
    if (!normalized || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function outOfBandFilterPanelOptionElements(
  interactiveElements: readonly ReadPageInteractiveElement[],
): ReadPageInteractiveElement[] {
  return interactiveElements.filter((element) => {
    if (TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(element.ref)) return false;
    return isFilterPanelOptionElement(element, interactiveElements);
  });
}

function filterPanelLabelsFromCandidateActions(
  candidateActions: readonly ReadPageCandidateAction[],
): string[] {
  return candidateActions
    .filter((action) => isVisibleFilterPanelCandidateAction(action, candidateActionLabel(action)))
    .map((action) => candidateActionLabel(action))
    .filter((label): label is string => Boolean(label))
    .filter((label) => label.length <= 80);
}

function filterPanelFromVisibleText(
  visibleTextContent: string | null | undefined,
  candidateActions: readonly ReadPageCandidateAction[],
  interactiveElements: readonly ReadPageInteractiveElement[],
  visibleSearchFilterState?: unknown,
): SearchSurfaceFilterPanel {
  const outOfBandFilterOptions = outOfBandFilterPanelOptionElements(interactiveElements);
  const optionLabels = uniqueLabels([
    ...extractShortLabels(visibleTextContent, FILTER_PANEL_OPTION_PATTERN, 16),
    ...extractShortLabels(visibleTextContent, CONTENT_TYPE_FILTER_OPTION_PATTERN, 8),
    ...extractShortLabels(visibleTextContent, TIME_RANGE_FILTER_OPTION_PATTERN, 8),
    ...filterPanelLabelsFromCandidateActions(candidateActions),
    ...outOfBandFilterOptions.map((element) => normalizeText(element.name)),
  ]);
  const actionLabels = extractShortLabels(visibleTextContent, FILTER_PANEL_ACTION_PATTERN, 8);
  const targetableOptions: SearchSurfaceControl[] = [];
  const allVisibleCandidateActions = candidateActions.filter((action) =>
    isVisibleFilterPanelCandidateAction(action, candidateActionLabel(action)),
  );
  const scopedLabels = new Set(
    allVisibleCandidateActions
      .filter(
        (action) =>
          action.provenance?.surfaceType === 'floating_surface' &&
          Boolean(action.provenance.panelRef) &&
          Boolean(action.provenance.groupId),
      )
      .map((action) => normalizedKey(candidateActionLabel(action)))
      .filter(Boolean),
  );
  const visibleCandidateActions = allVisibleCandidateActions.filter((action) => {
    const labelKey = normalizedKey(candidateActionLabel(action));
    if (!scopedLabels.has(labelKey)) return true;
    return (
      action.provenance?.surfaceType === 'floating_surface' &&
      Boolean(action.provenance.panelRef) &&
      Boolean(action.provenance.groupId)
    );
  });
  for (const action of visibleCandidateActions) {
    const label = candidateActionLabel(action);
    if (!label || !action.locatorChain.length) continue;
    const scopedGroup =
      typeof action.provenance?.groupId === 'string' && action.provenance.groupId.trim()
        ? action.provenance.groupId.trim()
        : inferFilterGroupFromVisibleText(label, visibleTextContent);
    pushUniqueControl(
      targetableOptions,
      controlForRecoveredAction({
        kind: controlKindForFilterPanelLabel(label),
        label,
        action,
        interactiveElements,
        visibleSearchFilterState,
        reason:
          'filter panel option was recovered from a scoped locator-backed floating-surface action',
        confidence: action.provenance?.panelRef ? 0.9 : 0.78,
        ...(scopedGroup ? { filterGroup: scopedGroup } : {}),
      }),
    );
  }
  for (const label of [...optionLabels, ...actionLabels]) {
    const action = actionForFilterPanelLabel(candidateActions, label, interactiveElements);
    const scopedActionsForLabel = visibleCandidateActions.filter(
      (candidate) => normalizedKey(candidateActionLabel(candidate)) === normalizedKey(label),
    );
    if (scopedActionsForLabel.some((candidate) => candidate.provenance?.groupId)) continue;
    const outOfBandElement = outOfBandFilterOptions.find(
      (element) => normalizedKey(element.name) === normalizedKey(label),
    );
    if (!action?.locatorChain?.length && !outOfBandElement) continue;
    if (outOfBandElement && scopedActionsForLabel.length === 0) {
      pushUniqueControl(
        targetableOptions,
        controlForElement({
          kind: controlKindForFilterPanelLabel(label),
          element: outOfBandElement,
          candidateActions,
          reason:
            'filter option is visible outside the top search toolbar and treated as a filter-panel option',
          confidence: 0.8,
          filterGroup: inferFilterGroupFromVisibleText(label, visibleTextContent),
        }),
      );
      continue;
    }
    if (!action || !action.locatorChain.length) continue;
    pushUniqueControl(
      targetableOptions,
      controlForRecoveredAction({
        kind: controlKindForFilterPanelLabel(label),
        label,
        action,
        interactiveElements,
        reason:
          'filter panel label was recovered from visible text and resolved to a locator-backed candidate action',
        confidence: 0.76,
        filterGroup: inferFilterGroupFromVisibleText(label, visibleTextContent),
      }),
    );
  }
  const appliedFilterLabels = [
    ...optionLabels.filter((label) => SELECTED_STATE_PATTERN.test(label)),
    ...targetableOptions
      .filter((control) => control.state?.selected)
      .map((control) => control.label)
      .filter((label): label is string => Boolean(label)),
  ];
  const clearActionObserved = actionLabels.some((label) => /清除|重置|clear|reset/i.test(label));
  const confirmActionObserved = actionLabels.some((label) =>
    /确认|应用|confirm|apply/i.test(label),
  );
  const openCandidate = optionLabels.length > 0 || clearActionObserved || confirmActionObserved;
  return {
    status: openCandidate ? 'open_candidate' : 'closed_or_not_observed',
    optionLabels,
    ...(targetableOptions.length > 0 ? { targetableOptions } : {}),
    appliedFilterLabels,
    clearActionObserved,
    confirmActionObserved,
    reason: openCandidate
      ? 'filter-like short option labels or panel actions are visible in the fresh snapshot'
      : 'no filter panel options or apply/reset actions were visible in this snapshot',
  };
}

function categoryStateForControls(
  categoryTabs: readonly SearchSurfaceControl[],
): ReadPageSearchSurface['categoryState'] {
  const selectedLabels = categoryTabs
    .filter((control) => control.state?.selected)
    .map((control) => control.label)
    .filter((label): label is string => Boolean(label));
  const ambiguousLabels = categoryTabs
    .filter((control) => control.state?.ambiguous)
    .map((control) => control.label)
    .filter((label): label is string => Boolean(label));
  const unresolvedLabels = categoryTabs
    .filter((control) => control.source === 'visible_text_unresolved')
    .map((control) => control.label)
    .filter((label): label is string => Boolean(label));
  return {
    selectedLabels,
    ambiguousLabels,
    unresolvedLabels,
    reason:
      selectedLabels.length > 0
        ? 'selected category inferred from structured state in the fresh snapshot'
        : unresolvedLabels.length > 0
          ? 'some category labels are visible but not locator-backed; treat them as capability gaps'
          : 'no selected category state was observable in this snapshot',
  };
}

function filterCandidateFromControl(
  control: SearchSurfaceControl,
): SearchSurfaceFilterCandidate | undefined {
  const rawLabel = safeLabel(control.label);
  const label = rawLabel
    ? safeLabel(canonicalFilterLabel(rawLabel, control.filterGroup))
    : undefined;
  if (!label) return undefined;
  return {
    label,
    selected: Boolean(control.state?.selected),
    ...(control.targetRef ? { targetRef: control.targetRef } : {}),
    ...(control.candidateActionId ? { candidateActionId: control.candidateActionId } : {}),
    kind: control.kind,
    source: control.source,
    confidence: control.confidence,
    reason: control.reason,
  };
}

function groupStateFromCandidates(
  candidates: readonly SearchSurfaceFilterCandidate[],
): SearchSurfaceFilterGroupState {
  const byKey = new Map<string, SearchSurfaceFilterCandidate>();
  for (const candidate of candidates) {
    const key = `${normalizedKey(candidate.label)}:${candidate.targetRef ?? ''}:${candidate.candidateActionId ?? ''}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  const uniqueCandidates = [...byKey.values()];
  const selectedCandidates = uniqueCandidates.filter((candidate) => candidate.selected);
  const selected = selectedCandidates[0];
  const nonDefaultSelectedCandidates = selectedCandidates.filter(
    (candidate) => !/^(全部|综合|不限|all|any)$/i.test(candidate.label),
  );
  const ambiguityCandidates =
    selected && nonDefaultSelectedCandidates.some((candidate) => candidate.label === selected.label)
      ? nonDefaultSelectedCandidates.filter((candidate) => candidate.label !== selected.label)
      : nonDefaultSelectedCandidates;
  const ambiguous = ambiguityCandidates.length > 0;
  const source = uniqueStrings(uniqueCandidates.map((candidate) => candidate.source ?? 'unknown'));
  return {
    ...(selected?.label ? { selected: selected.label } : {}),
    ...(selected?.candidateActionId ? { selectedCandidateId: selected.candidateActionId } : {}),
    candidates: uniqueCandidates,
    ambiguous,
    source,
    reason: selected
      ? ambiguous
        ? 'multiple selected candidates were observed for this filter group'
        : 'selected filter inferred from structured search controls'
      : uniqueCandidates.length > 0
        ? 'filter candidates are visible, but selected state is not proven in this snapshot'
        : 'no candidates observed for this filter group',
  };
}

function readObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  const text = normalizeText(value);
  return text ? text : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(readString).filter((item): item is string => Boolean(item));
}

function visibleFilterGroupCandidate(params: {
  label: string;
  selectedLabel?: string;
  source?: string;
  confidence?: number;
  reason?: string;
}): SearchSurfaceFilterCandidate {
  return {
    label: params.label,
    selected:
      Boolean(params.selectedLabel) &&
      normalizedKey(params.label) === normalizedKey(params.selectedLabel),
    source: params.source ?? 'visible_search_surface_filter_state',
    confidence: params.confidence ?? 0.74,
    reason:
      params.reason ?? 'filter candidate inferred from visible search-surface DOM/style state scan',
  };
}

function mergeVisibleFilterGroupState(params: {
  base: SearchSurfaceFilterGroupState;
  visibleGroup: unknown;
  fallbackSelected?: unknown;
}): SearchSurfaceFilterGroupState {
  const group = readObject(params.visibleGroup);
  const selectedLabel = readString(group?.selected) ?? readString(params.fallbackSelected);
  const visibleLabels = uniqueStrings([
    ...readStringArray(group?.candidates),
    ...(selectedLabel ? [selectedLabel] : []),
  ]);
  if (!selectedLabel && visibleLabels.length === 0) return params.base;

  const selectedKey = normalizedKey(selectedLabel);
  const baseCandidates = params.base.candidates.map((candidate) => ({
    ...candidate,
    selected: selectedKey ? normalizedKey(candidate.label) === selectedKey : candidate.selected,
  }));
  const existingLabels = new Set(baseCandidates.map((candidate) => normalizedKey(candidate.label)));
  const confidence =
    typeof group?.confidence === 'number' && Number.isFinite(group.confidence)
      ? group.confidence
      : undefined;
  const source = readString(group?.source) ?? 'visible_search_surface_filter_state';
  const reason = readString(group?.reason);
  const visibleCandidates = visibleLabels
    .filter((label) => !existingLabels.has(normalizedKey(label)))
    .map((label) =>
      visibleFilterGroupCandidate({
        label,
        selectedLabel,
        source,
        confidence,
        reason,
      }),
    );
  const merged = groupStateFromCandidates([...baseCandidates, ...visibleCandidates]);
  return {
    ...merged,
    reason: selectedLabel
      ? 'selected filter merged from visible search-surface DOM/style state scan'
      : merged.reason,
  };
}

function mergeVisibleSearchFilterState(
  base: SearchSurfaceFilterState,
  visibleFilterState: unknown,
): SearchSurfaceFilterState {
  const state = readObject(visibleFilterState);
  if (!state) return base;
  const groups = readObject(state.groups);
  const contentType = mergeVisibleFilterGroupState({
    base: base.contentType,
    visibleGroup: groups?.contentType,
    fallbackSelected: state.contentType,
  });
  const sort = mergeVisibleFilterGroupState({
    base: base.sort,
    visibleGroup: groups?.sort,
    fallbackSelected: state.sort,
  });
  const timeRange = mergeVisibleFilterGroupState({
    base: base.timeRange,
    visibleGroup: groups?.timeRange,
    fallbackSelected: state.timeRange,
  });
  const filterGroupsById = new Map<string, SearchSurfaceGenericFilterGroupState>();
  const applyGroup = (groupId: string, group: SearchSurfaceFilterGroupState): void => {
    filterGroupsById.set(groupId, {
      groupId,
      groupLabel: groupId,
      ...group,
    });
  };
  for (const group of base.filterGroups) {
    filterGroupsById.set(group.groupId, group);
  }
  applyGroup('content_type', contentType);
  applyGroup('sort', sort);
  applyGroup('time_range', timeRange);

  for (const rawGroup of Array.isArray(state.filterGroups) ? state.filterGroups : []) {
    const group = readObject(rawGroup);
    const groupId = genericFilterGroupId(readString(group?.groupId) ?? 'other');
    const current = filterGroupsById.get(groupId) ?? {
      groupId,
      ...(readString(group?.groupLabel) ? { groupLabel: readString(group?.groupLabel) } : {}),
      ...groupStateFromCandidates([]),
    };
    const merged = mergeVisibleFilterGroupState({
      base: current,
      visibleGroup: group,
    });
    filterGroupsById.set(groupId, {
      groupId,
      ...(readString(group?.groupLabel) ? { groupLabel: readString(group?.groupLabel) } : {}),
      ...merged,
    });
  }

  const missingGroups = [
    contentType.selected ? null : 'contentType',
    sort.selected ? null : 'sort',
    timeRange.selected ? null : 'timeRange',
  ].filter((item): item is 'contentType' | 'sort' | 'timeRange' => Boolean(item));
  const appliedLabels = uniqueStrings(
    [
      ...readStringArray(state.appliedLabels),
      contentType.selected,
      sort.selected,
      timeRange.selected,
    ].filter((label): label is string => typeof label === 'string' && label.length > 0),
  );
  const ambiguous = contentType.ambiguous || sort.ambiguous || timeRange.ambiguous;
  return {
    status: ambiguous
      ? 'ambiguous'
      : missingGroups.length === 0
        ? 'observed'
        : appliedLabels.length > 0
          ? 'partial'
          : base.status,
    filterGroups: [...filterGroupsById.values()].sort((left, right) =>
      left.groupId.localeCompare(right.groupId),
    ),
    contentType,
    sort,
    timeRange,
    selected: {
      ...(contentType.selected ? { contentType: contentType.selected } : {}),
      ...(sort.selected ? { sort: sort.selected } : {}),
      ...(timeRange.selected ? { timeRange: timeRange.selected } : {}),
    },
    appliedLabels,
    ambiguous,
    missingGroups,
    claimBoundary:
      'filterState merges structured controls with visible DOM/style state from the current read_page snapshot. It does not prove server-side ranking correctness.',
  };
}

function genericFilterGroupId(value: unknown): string {
  const key = normalizedKey(value);
  if (key) return key.replace(/[^a-z0-9_\-\u4e00-\u9fff]+/gi, '_').replace(/^_+|_+$/g, '');
  return 'other';
}

function genericGroupStateFromCandidates(params: {
  groupId: string;
  groupLabel?: string;
  candidates: readonly SearchSurfaceFilterCandidate[];
}): SearchSurfaceGenericFilterGroupState {
  const state = groupStateFromCandidates(params.candidates);
  return {
    groupId: params.groupId,
    ...(params.groupLabel ? { groupLabel: params.groupLabel } : {}),
    ...state,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function buildGroupedFilterState(params: {
  categoryTabs: readonly SearchSurfaceControl[];
  controls: readonly SearchSurfaceControl[];
  filterPanel: SearchSurfaceFilterPanel;
}): SearchSurfaceFilterState {
  const contentTypeCandidates: SearchSurfaceFilterCandidate[] = [];
  const sortCandidates: SearchSurfaceFilterCandidate[] = [];
  const timeRangeCandidates: SearchSurfaceFilterCandidate[] = [];
  const genericGroups = new Map<
    string,
    { groupLabel?: string; candidates: SearchSurfaceFilterCandidate[] }
  >();

  const addGenericCandidate = (
    rawGroup: SearchSurfaceControl['filterGroup'] | undefined,
    candidate: SearchSurfaceFilterCandidate,
  ): void => {
    const groupId = genericFilterGroupId(rawGroup ?? 'other');
    const groupLabel = typeof rawGroup === 'string' && rawGroup ? rawGroup : undefined;
    const existing = genericGroups.get(groupId);
    if (existing) {
      existing.candidates.push(candidate);
      return;
    }
    genericGroups.set(groupId, {
      ...(groupLabel ? { groupLabel } : {}),
      candidates: [candidate],
    });
  };

  for (const control of params.categoryTabs) {
    const candidate = filterCandidateFromControl(control);
    if (!candidate) continue;
    contentTypeCandidates.push(candidate);
    addGenericCandidate(control.filterGroup ?? 'content_type', candidate);
  }
  for (const control of params.controls) {
    const candidate = filterCandidateFromControl(control);
    if (!candidate) continue;
    addGenericCandidate(control.filterGroup ?? 'other', candidate);
    if (isSortFilterGroup(control.filterGroup)) {
      sortCandidates.push(candidate);
    }
  }
  for (const control of params.filterPanel.targetableOptions ?? []) {
    const candidate = filterCandidateFromControl(control);
    if (!candidate) continue;
    addGenericCandidate(control.filterGroup ?? 'other', candidate);
    if (isContentTypeFilterGroup(control.filterGroup)) {
      contentTypeCandidates.push(candidate);
    } else if (isSortFilterGroup(control.filterGroup)) {
      sortCandidates.push(candidate);
    } else if (isTimeRangeFilterGroup(control.filterGroup)) {
      timeRangeCandidates.push(candidate);
    }
  }

  const contentType = groupStateFromCandidates(contentTypeCandidates);
  const sort = groupStateFromCandidates(sortCandidates);
  const timeRange = groupStateFromCandidates(timeRangeCandidates);
  const filterGroups = [...genericGroups.entries()]
    .map(([groupId, group]) =>
      genericGroupStateFromCandidates({
        groupId,
        ...(group.groupLabel ? { groupLabel: group.groupLabel } : {}),
        candidates: group.candidates,
      }),
    )
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
  const missingGroups = [
    contentType.selected ? null : 'contentType',
    sort.selected ? null : 'sort',
    timeRange.selected ? null : 'timeRange',
  ].filter((item): item is 'contentType' | 'sort' | 'timeRange' => Boolean(item));
  const appliedLabels = [contentType.selected, sort.selected, timeRange.selected].filter(
    (item): item is string => Boolean(item),
  );
  const ambiguous = contentType.ambiguous || sort.ambiguous || timeRange.ambiguous;
  const observedCandidateCount =
    contentType.candidates.length + sort.candidates.length + timeRange.candidates.length;
  return {
    status: ambiguous
      ? 'ambiguous'
      : missingGroups.length === 0
        ? 'observed'
        : observedCandidateCount > 0
          ? 'partial'
          : 'not_observed',
    filterGroups,
    contentType,
    sort,
    timeRange,
    selected: {
      ...(contentType.selected ? { contentType: contentType.selected } : {}),
      ...(sort.selected ? { sort: sort.selected } : {}),
      ...(timeRange.selected ? { timeRange: timeRange.selected } : {}),
    },
    appliedLabels,
    ambiguous,
    missingGroups,
    claimBoundary:
      'filterState reports what this fresh read_page snapshot proves from structured controls. It does not prove server-side ranking correctness.',
  };
}

function resultCoverageForRows(params: {
  rows: VisibleRegionRowsResult | undefined;
  observedResultCount: number;
  visibleTextContent?: string | null;
}): ReadPageSearchSurface['resultCoverage'] {
  const rows = params.rows;
  const pixelsBelow = rows?.pageInfo?.pixelsBelow ?? null;
  const loadMoreCandidateObserved =
    extractShortLabels(params.visibleTextContent, LOAD_MORE_PATTERN, 4).length > 0;
  const virtualizedListCandidate =
    Boolean(rows?.visibleRegionRowsUsed) &&
    typeof pixelsBelow === 'number' &&
    pixelsBelow > 0 &&
    params.observedResultCount > 0 &&
    params.observedResultCount < Math.max(rows?.rowCount || 0, 10);
  const completeEnough = params.observedResultCount >= 10;
  return {
    observedResultCount: params.observedResultCount,
    visibleRowsUsed: Boolean(rows?.visibleRegionRowsUsed),
    pixelsBelow,
    loadMoreCandidateObserved,
    virtualizedListCandidate,
    status: completeEnough
      ? 'complete_enough'
      : params.observedResultCount > 0
        ? 'scroll_or_load_more_required'
        : 'not_proven',
    reason: completeEnough
      ? 'at least 10 structured result cards are visible in this snapshot'
      : params.observedResultCount > 0
        ? 'visible result cards are present, but more scrolling or load-more evidence is required before claiming result completeness'
        : 'no structured result cards are visible in this snapshot',
  };
}

function observationCoverageForSearch(params: {
  frameContext?: ReadPageFrameContext | null;
  visibleButUnresolved: readonly SearchSurfaceControl[];
  resultCards: readonly ReadPageSearchResultCard[];
  filterPanel: SearchSurfaceFilterPanel;
}): ReadPageSearchSurface['observationCoverage'] {
  const frameCoverage = params.frameContext?.coverage ?? 'not_available';
  const iframeCoverage =
    params.frameContext?.frameScope === 'subframe' ? 'explicit_frame_read' : 'not_proven';
  const capabilityGaps: string[] = [];
  if (params.visibleButUnresolved.length > 0) {
    capabilityGaps.push('visible_text_without_locator');
  }
  if (params.filterPanel.status !== 'open_candidate') {
    capabilityGaps.push('filter_panel_state_not_observed');
  }
  if (params.resultCards.length < 10) {
    capabilityGaps.push('top_n_result_completeness_not_proven');
  }
  if (iframeCoverage === 'not_proven') {
    capabilityGaps.push('iframe_full_coverage_not_proven');
  }
  capabilityGaps.push('shadow_dom_coverage_not_inspected');
  return {
    frameCoverage,
    iframeCoverage,
    shadowDomCoverage: 'not_inspected',
    capabilityGaps,
    reason:
      'coverage reports what this read_page snapshot proves; missing iframe/shadow evidence is reported as a capability gap instead of treating controls as absent',
  };
}

export function buildSearchSurface(params: {
  assistantGuidance?: ReadPageAssistantGuidance;
  pageRole?: string | null;
  tabId?: number | null;
  currentUrl?: string | null;
  observationStartedAtMs?: number | null;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  visibleSearchFilterState?: unknown;
  visibleRegionRows?: VisibleRegionRowsResult;
  visibleTextContent?: string | null;
  frameContext?: ReadPageFrameContext | null;
}): ReadPageSearchSurface | undefined {
  const requested = guidanceRequestsSearch({
    guidance: params.assistantGuidance,
    pageRole: params.pageRole,
  });
  if (!requested) return undefined;
  const controls: SearchSurfaceControl[] = [];
  const categoryTabs: SearchSurfaceControl[] = [];
  const visibleButUnresolved: SearchSurfaceControl[] = [];
  const searchInput = params.interactiveElements.find((element) => {
    return isSearchInputElement(element);
  });
  if (searchInput) {
    controls.push(
      controlForElement({
        kind: 'search_input',
        element: searchInput,
        candidateActions: params.candidateActions,
        reason: 'search-like input surfaced from structured interactive elements',
        confidence: 0.86,
      }),
    );
  }

  const filterElement = params.interactiveElements.find(
    (element) =>
      isFilterLabel(element.name) && isSearchToolbarRowElement(element, params.interactiveElements),
  );
  if (filterElement) {
    controls.push(
      controlForElement({
        kind: 'filter_trigger',
        element: filterElement,
        candidateActions: params.candidateActions,
        reason: 'filter trigger surfaced from structured interactive elements',
        confidence: 0.84,
      }),
    );
  }

  const sortMenuElement = params.interactiveElements.find(
    (element) =>
      isSortMenuLabel(element.name) &&
      isSearchToolbarRowElement(element, params.interactiveElements),
  );
  if (sortMenuElement) {
    controls.push(
      controlForElement({
        kind: 'sort_menu',
        element: sortMenuElement,
        candidateActions: params.candidateActions,
        reason: 'sort menu trigger surfaced from structured interactive elements',
        confidence: 0.8,
      }),
    );
  }

  const filterPanelOptionElements = params.interactiveElements.filter((element) =>
    isFilterPanelOptionElement(element, params.interactiveElements),
  );
  for (const element of filterPanelOptionElements) {
    pushUniqueControl(
      controls,
      controlForElement({
        kind: controlKindForFilterPanelLabel(normalizeText(element.name)),
        element,
        candidateActions: params.candidateActions,
        reason:
          'filter panel option surfaced from structured interactive elements without task-specific label preference',
        confidence: 0.8,
        filterGroup: inferFilterGroupFromVisibleText(
          normalizeText(element.name),
          params.visibleTextContent,
        ),
      }),
    );
  }

  const categoryElements = params.interactiveElements.filter(
    (element) =>
      isCategoryLabel(element.name) &&
      isSearchToolbarBandElement(element, params.interactiveElements),
  );
  for (const element of categoryElements) {
    pushUniqueControl(
      categoryTabs,
      controlForElement({
        kind: 'category_tab',
        element,
        candidateActions: params.candidateActions,
        reason: 'category tab surfaced from structured interactive elements',
        confidence: 0.8,
      }),
    );
  }

  const submitAction = findControlAction(params.candidateActions, 'search.submit');
  if (submitAction) {
    controls.push({
      kind: 'submit_search',
      targetRef: submitAction.targetRef,
      candidateActionId: submitAction.id,
      confidence: submitAction.confidence,
      source: isTextRecoveredRef(submitAction.targetRef) ? 'text_recovery' : 'interactive_elements',
      reason: 'search submit action surfaced from candidate actions',
    });
  }

  const toolbarLabels = extractSearchToolbarLabelsFromVisibleText(params.visibleTextContent);
  for (const label of toolbarLabels) {
    const kind = controlKindForToolbarLabel(label);
    const targetList = kind === 'category_tab' ? categoryTabs : controls;
    if (hasControlWithLabel(targetList, label)) continue;
    const recoveredAction = actionForToolbarLabel(
      params.candidateActions,
      label,
      params.interactiveElements,
    );
    if (recoveredAction?.locatorChain?.length) {
      pushUniqueControl(
        targetList,
        controlForRecoveredAction({
          kind,
          label,
          action: recoveredAction,
          interactiveElements: params.interactiveElements,
          reason:
            'toolbar label was recovered from visible text and resolved to a locator-backed candidate action',
          confidence: kind === 'category_tab' ? 0.76 : 0.78,
        }),
      );
      continue;
    }
    if (
      kind === 'category_tab' &&
      hasOnlyOutOfBandCategoryElements(label, params.interactiveElements)
    ) {
      continue;
    }
    const unresolved = unresolvedControlForLabel(label);
    pushUniqueControl(visibleButUnresolved, unresolved);
    if (kind === 'category_tab') pushUniqueControl(categoryTabs, unresolved);
  }

  const resultCards: ReadPageSearchResultCard[] = [];
  const rows = params.visibleRegionRows?.visibleRegionRowsUsed ? params.visibleRegionRows.rows : [];
  for (const row of rows.slice(0, 12)) {
    const title = safeLabel(row.title || row.primaryText);
    if (!title) continue;
    const metricText = metricTextForRow(row);
    const collectionCountCandidate = parseCollectionCountCandidate(metricText);
    const action = actionForRef(params.candidateActions, row.targetRef ?? undefined);
    resultCards.push({
      id: row.rowId,
      title,
      targetRef: row.targetRef ?? undefined,
      candidateActionId: action?.id,
      primaryText: safeLabel(
        normalizedKey(row.primaryText) && normalizedKey(row.primaryText) !== normalizedKey(title)
          ? row.primaryText
          : row.secondaryText,
      ),
      secondaryText: safeLabel(row.secondaryText),
      metaText: safeLabel(row.metaText),
      interactionText: safeLabel(row.interactionText),
      metricText: safeLabel(metricText),
      collectionCountCandidate,
      confidence: Number(
        Math.max(row.confidence || 0, collectionCountCandidate ? 0.78 : 0.66).toFixed(2),
      ),
      reason: collectionCountCandidate
        ? 'visible result row with collection-like metric candidate'
        : 'visible result row surfaced for AI-side ranking',
    });
  }
  const filterPanel = filterPanelFromVisibleText(
    params.visibleTextContent,
    params.candidateActions,
    params.interactiveElements,
    params.visibleSearchFilterState,
  );
  const filterState = mergeVisibleSearchFilterState(
    buildGroupedFilterState({ categoryTabs, controls, filterPanel }),
    params.visibleSearchFilterState,
  );
  const categoryState = categoryStateForControls(categoryTabs);
  const sortMenuAction = findToolbarControlAction(params.candidateActions, 'filter.open');
  const sortMenuObserved =
    controls.some((control) => control.kind === 'sort_menu') ||
    params.interactiveElements.some((element) => isSortMenuLabel(element.name));
  const sortOptionLabels = extractShortLabels(
    params.visibleTextContent,
    /^(综合|最新|最热|最多收藏|most\s*(saved|collected)|latest|popular)$/i,
    8,
  );
  const resultCoverage = resultCoverageForRows({
    rows: params.visibleRegionRows,
    observedResultCount: resultCards.length,
    visibleTextContent: params.visibleTextContent,
  });
  const observationStartedAtMs =
    typeof params.observationStartedAtMs === 'number' &&
    Number.isFinite(params.observationStartedAtMs)
      ? params.observationStartedAtMs
      : Date.now();
  pruneExpiredSearchResultDeltaSnapshots(Date.now());
  const resultObservation = beginSearchResultObservation({
    tabId: params.tabId,
    currentUrl: params.currentUrl ?? params.visibleRegionRows?.pageInfo?.url,
    observedAtMs: observationStartedAtMs,
  });
  const previousResultSnapshot = resultObservation?.accepted
    ? searchResultDeltaSnapshotsByContext.get(resultObservation.contextKey)
    : undefined;
  const resultDelta = resultObservation
    ? resultObservation.accepted
      ? {
          ...buildSearchResultDelta({
            previousResultCards:
              previousResultSnapshot?.documentEpoch === resultObservation.documentEpoch
                ? previousResultSnapshot.resultCards
                : undefined,
            currentResultCards: resultCards,
          }),
          observation: {
            documentEpoch: resultObservation.documentEpoch,
            sequence: resultObservation.observationSequence,
            previousSequence: previousResultSnapshot?.observationSequence ?? null,
            observedAt: new Date(resultObservation.observedAtMs).toISOString(),
            previousObservedAt:
              typeof previousResultSnapshot?.observedAtMs === 'number'
                ? new Date(previousResultSnapshot.observedAtMs).toISOString()
                : null,
            snapshotTtlMs: SEARCH_RESULT_DELTA_SNAPSHOT_TTL_MS,
          },
        }
      : {
          ...buildSearchResultDelta({
            currentResultCards: resultCards,
          }),
          status: 'ambiguous',
          reason: resultObservation.rejectionReason ?? 'out-of-order observation was discarded',
          observation: {
            documentEpoch: resultObservation.documentEpoch,
            sequence: resultObservation.observationSequence,
            previousSequence: resultObservation.observationSequence,
            observedAt: new Date(resultObservation.observedAtMs).toISOString(),
            previousObservedAt: null,
            snapshotTtlMs: SEARCH_RESULT_DELTA_SNAPSHOT_TTL_MS,
          },
        }
    : undefined;
  if (resultObservation?.accepted && resultCards.length > 0) {
    rememberSearchResultDeltaSnapshot({
      contextKey: resultObservation.contextKey,
      tabId: params.tabId!,
      documentEpoch: resultObservation.documentEpoch,
      observationSequence: resultObservation.observationSequence,
      resultCards,
      observedAtMs: resultObservation.observedAtMs,
    });
  }
  const observationCoverage = observationCoverageForSearch({
    frameContext: params.frameContext,
    visibleButUnresolved,
    resultCards,
    filterPanel,
  });
  const currentSortLabel = filterState.sort?.selected ?? undefined;
  const sortSelected = Boolean(filterState.sort?.selected);
  const sortObserved = Boolean(filterState.sort?.candidates.length);

  if (
    !requested &&
    controls.length === 0 &&
    categoryTabs.length === 0 &&
    visibleButUnresolved.length === 0 &&
    resultCards.length === 0
  ) {
    return undefined;
  }

  return {
    status:
      controls.length > 0 ||
      categoryTabs.length > 0 ||
      visibleButUnresolved.length > 0 ||
      resultCards.length > 0
        ? 'detected'
        : 'not_detected',
    queryState: searchInput?.valueState ?? 'unknown',
    controls,
    categoryTabs,
    categoryState,
    visibleButUnresolved,
    resultCards,
    filterPanel,
    filterState,
    sortEvidence: {
      requestedSort: sortSelected
        ? 'sort_observed'
        : sortMenuObserved
          ? 'sort_menu'
          : sortObserved
            ? 'sort_observed'
            : 'unknown',
      ...(currentSortLabel ? { currentSortLabel } : {}),
      menuOpenCandidate: sortOptionLabels.length > 0 || Boolean(sortMenuAction && sortMenuObserved),
      ...(sortOptionLabels.length > 0 ? { optionLabels: sortOptionLabels } : {}),
      appliedCandidate: sortSelected,
      reason: sortSelected
        ? 'sort control appears selected in this fresh snapshot; business ranking still needs result evidence'
        : sortMenuObserved || sortObserved
          ? 'sort controls are observable; applied state still requires fresh readback after click'
          : 'no sort control observed in this snapshot',
    },
    topNCompleteness: {
      requestedMinResults: 10,
      observedResultCount: resultCards.length,
      status:
        resultCards.length >= 10
          ? 'sufficient'
          : resultCards.length > 0
            ? 'insufficient'
            : 'not_proven',
      reason:
        resultCards.length >= 10
          ? 'at least 10 structured result cards are visible for AI-side Top-N ranking'
          : resultCards.length > 0
            ? 'fewer than 10 structured result cards are visible; scroll or detail readback is required before claiming Top 10 completeness'
            : 'no structured result cards observed; search/list completion is not proven',
    },
    ...(resultDelta ? { resultDelta } : {}),
    resultCoverage,
    observationCoverage,
    claimBoundary:
      'searchSurface is an observation map only. It does not prove search completion, filter application, sort application, iframe/shadow coverage, or Top-N correctness without fresh same-tab readback and AI-side ranking.',
  };
}
