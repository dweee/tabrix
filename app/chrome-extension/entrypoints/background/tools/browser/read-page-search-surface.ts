import type {
  ReadPageAssistantGuidance,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageSearchResultCard,
  ReadPageSearchSurface,
} from '@tabrix/shared';
import type { VisibleRegionRowsResult } from './visible-region-rows';

const SEARCH_INPUT_ROLE_PATTERN = /^(searchbox|textbox|combobox)$/i;
const FILTER_LABEL_PATTERN = /^(筛选|过滤|filter|filters)$/i;
const SORT_MENU_LABEL_PATTERN = /^(排序|sort)$/i;
const CATEGORY_LABEL_PATTERN = /^(全部|图文|视频|用户|all|images?|photos?|videos?|users?)$/i;
const SEARCH_TOOLBAR_LABEL_PATTERN =
  /^(筛选|过滤|filter|filters|排序|sort|全部|图文|视频|用户|all|images?|photos?|videos?|users?)$/i;
const TEXT_SEARCH_TOOLBAR_REF_PATTERN = /^ref_text_search_toolbar_/;
const MOST_COLLECTED_PATTERN =
  /最多收藏|收藏最多|按收藏|收藏数|most\s*(collected|saved|favorited)|top\s*saves/i;
const SEARCH_SUBMIT_PATTERN = /\b(search|find|query)\b|搜索|查找/i;
const COLLECTION_METRIC_PATTERN =
  /(?:收藏|saves?|saved|favorites?|favourites?|collected)\s*[:：]?\s*([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;
const COMPACT_COUNT_PATTERN = /([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;
const SEARCH_TOOLBAR_TEXT_SCAN_LINE_LIMIT = 80;

type SearchSurfaceControl = ReadPageSearchSurface['controls'][number];

function guidanceRequestsSearch(guidance: ReadPageAssistantGuidance | undefined): boolean {
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

function isFilterLabel(value: unknown): boolean {
  return FILTER_LABEL_PATTERN.test(normalizeText(value));
}

function isSortMenuLabel(value: unknown): boolean {
  return SORT_MENU_LABEL_PATTERN.test(normalizeText(value));
}

function isCategoryLabel(value: unknown): boolean {
  return CATEGORY_LABEL_PATTERN.test(normalizeText(value));
}

function controlKindForToolbarLabel(label: string): SearchSurfaceControl['kind'] {
  if (isCategoryLabel(label)) return 'category_tab';
  if (isFilterLabel(label)) return 'filter_trigger';
  if (isSortMenuLabel(label)) return 'filter_trigger';
  return 'unknown';
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
    if (line.length > 80) continue;
    const candidates = [line, ...line.split(/[\s|｜/、,，]+/)]
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

function actionForToolbarLabel(
  candidateActions: readonly ReadPageCandidateAction[],
  label: string,
): ReadPageCandidateAction | undefined {
  const key = normalizedKey(label);
  return candidateActions.find((action) => {
    const locatorLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    if (normalizedKey(locatorLabel) === key) return true;
    if (TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(action.targetRef)) {
      return action.locatorChain.some((item) => normalizedKey(item.value) === key);
    }
    return false;
  });
}

function findControlAction(
  candidateActions: readonly ReadPageCandidateAction[],
  intent: string,
): ReadPageCandidateAction | undefined {
  return candidateActions.find((action) => action.intent === intent);
}

function isSortAppliedCandidate(element: ReadPageInteractiveElement | undefined): boolean {
  if (!element) return false;
  if (element.checked === true) return true;
  const text = normalizeText(
    [element.name, element.role, element.matchSource, element.actionability].join(' '),
  );
  return /\b(selected|active|checked|current)\b|已选|选中|当前排序|已应用/i.test(text);
}

function controlForElement(params: {
  kind: SearchSurfaceControl['kind'];
  element: ReadPageInteractiveElement;
  candidateActions: readonly ReadPageCandidateAction[];
  reason: string;
  confidence: number;
}): SearchSurfaceControl {
  const action = actionForRef(params.candidateActions, params.element.ref);
  return {
    kind: params.kind,
    targetRef: params.element.ref,
    candidateActionId: action?.id,
    label: safeLabel(params.element.name),
    confidence: params.confidence,
    actionability: params.element.actionability,
    source: TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(params.element.ref)
      ? 'text_recovery'
      : 'interactive_elements',
    rect: params.element.rect,
    reason: params.reason,
  };
}

function controlForRecoveredAction(params: {
  kind: SearchSurfaceControl['kind'];
  label: string;
  action: ReadPageCandidateAction;
  reason: string;
  confidence: number;
}): SearchSurfaceControl {
  return {
    kind: params.kind,
    targetRef: params.action.targetRef,
    candidateActionId: params.action.id,
    label: safeLabel(params.label),
    confidence: params.confidence,
    source: 'text_recovery',
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

export function buildSearchSurface(params: {
  assistantGuidance?: ReadPageAssistantGuidance;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  visibleRegionRows?: VisibleRegionRowsResult;
  visibleTextContent?: string | null;
}): ReadPageSearchSurface | undefined {
  const requested = guidanceRequestsSearch(params.assistantGuidance);
  if (!requested) return undefined;
  const controls: SearchSurfaceControl[] = [];
  const categoryTabs: SearchSurfaceControl[] = [];
  const visibleButUnresolved: SearchSurfaceControl[] = [];
  const searchInput = params.interactiveElements.find((element) => {
    const role = normalizeText(element.role).toLowerCase();
    const name = normalizeText(element.name);
    return SEARCH_INPUT_ROLE_PATTERN.test(role) && SEARCH_SUBMIT_PATTERN.test(name || role);
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

  const categoryElements = params.interactiveElements.filter((element) =>
    isCategoryLabel(element.name),
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

  const sortAction = findControlAction(params.candidateActions, 'filter.sort_most_collected');
  const sortElement = params.interactiveElements.find(
    (element) =>
      element.ref === sortAction?.targetRef ||
      MOST_COLLECTED_PATTERN.test(normalizeText(element.name)),
  );
  if (sortElement) {
    controls.push(
      controlForElement({
        kind: 'sort_most_collected',
        element: sortElement,
        candidateActions: params.candidateActions,
        reason: 'most-collected sort control surfaced from structured interactive elements',
        confidence: 0.88,
      }),
    );
  }
  const sortAppliedCandidate = isSortAppliedCandidate(sortElement);

  const submitAction = findControlAction(params.candidateActions, 'search.submit');
  if (submitAction) {
    controls.push({
      kind: 'submit_search',
      targetRef: submitAction.targetRef,
      candidateActionId: submitAction.id,
      confidence: submitAction.confidence,
      source: TEXT_SEARCH_TOOLBAR_REF_PATTERN.test(submitAction.targetRef)
        ? 'text_recovery'
        : 'interactive_elements',
      reason: 'search submit action surfaced from candidate actions',
    });
  }

  const toolbarLabels = extractSearchToolbarLabelsFromVisibleText(params.visibleTextContent);
  for (const label of toolbarLabels) {
    const kind = controlKindForToolbarLabel(label);
    const targetList = kind === 'category_tab' ? categoryTabs : controls;
    if (hasControlWithLabel(targetList, label)) continue;
    const recoveredAction = actionForToolbarLabel(params.candidateActions, label);
    if (recoveredAction?.locatorChain?.length) {
      pushUniqueControl(
        targetList,
        controlForRecoveredAction({
          kind,
          label,
          action: recoveredAction,
          reason:
            'toolbar label was recovered from visible text and resolved to a locator-backed candidate action',
          confidence: kind === 'category_tab' ? 0.76 : 0.78,
        }),
      );
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
    visibleButUnresolved,
    resultCards,
    sortEvidence: {
      requestedSort: sortElement || sortAction ? 'most_collected' : 'unknown',
      appliedCandidate: sortAppliedCandidate,
      reason: sortAppliedCandidate
        ? 'most-collected sort control appears selected in this fresh snapshot; business ranking still needs result evidence'
        : sortElement || sortAction
          ? 'most-collected sort control is observable; applied state still requires fresh readback after click'
          : 'no most-collected sort control observed in this snapshot',
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
    claimBoundary:
      'searchSurface is an observation map only. It does not prove search completion, sort application, or Top-N correctness without fresh same-tab readback and AI-side ranking.',
  };
}
