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
    isCategoryLabel(name)
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
      : TEXT_FILTER_PANEL_REF_PATTERN.test(action.targetRef);
    if (!isPanelCandidate) return false;
    if (normalizedKey(element?.name) === key) return true;
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

function stateForRecoveredLabel(
  label: string,
  interactiveElements: readonly ReadPageInteractiveElement[],
): SearchSurfaceControl['state'] | undefined {
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
  reason: string;
  confidence: number;
  filterGroup?: SearchSurfaceControl['filterGroup'];
}): SearchSurfaceControl {
  const state = stateForRecoveredLabel(params.label, params.interactiveElements);
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

function filterPanelFromVisibleText(
  visibleTextContent: string | null | undefined,
  candidateActions: readonly ReadPageCandidateAction[],
  interactiveElements: readonly ReadPageInteractiveElement[],
): SearchSurfaceFilterPanel {
  const outOfBandFilterOptions = outOfBandFilterPanelOptionElements(interactiveElements);
  const optionLabels = uniqueLabels([
    ...extractShortLabels(visibleTextContent, FILTER_PANEL_OPTION_PATTERN, 16),
    ...extractShortLabels(visibleTextContent, CONTENT_TYPE_FILTER_OPTION_PATTERN, 8),
    ...extractShortLabels(visibleTextContent, TIME_RANGE_FILTER_OPTION_PATTERN, 8),
    ...outOfBandFilterOptions.map((element) => normalizeText(element.name)),
  ]);
  const actionLabels = extractShortLabels(visibleTextContent, FILTER_PANEL_ACTION_PATTERN, 8);
  const targetableOptions: SearchSurfaceControl[] = [];
  for (const label of [...optionLabels, ...actionLabels]) {
    const action = actionForFilterPanelLabel(candidateActions, label, interactiveElements);
    const outOfBandElement = outOfBandFilterOptions.find(
      (element) => normalizedKey(element.name) === normalizedKey(label),
    );
    if (!action?.locatorChain?.length && !outOfBandElement) continue;
    if (outOfBandElement) {
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
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
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

  const filterElement = params.interactiveElements.find((element) => isFilterLabel(element.name));
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

  const sortMenuElement = params.interactiveElements.find((element) =>
    isSortMenuLabel(element.name),
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
  );
  const filterState = buildGroupedFilterState({ categoryTabs, controls, filterPanel });
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
    resultCoverage,
    observationCoverage,
    claimBoundary:
      'searchSurface is an observation map only. It does not prove search completion, filter application, sort application, iframe/shadow coverage, or Top-N correctness without fresh same-tab readback and AI-side ranking.',
  };
}
