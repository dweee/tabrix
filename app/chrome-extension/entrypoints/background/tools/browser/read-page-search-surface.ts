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
const MOST_COLLECTED_PATTERN =
  /最多收藏|收藏最多|按收藏|收藏数|most\s*(collected|saved|favorited)|top\s*saves/i;
const SEARCH_SUBMIT_PATTERN = /\b(search|find|query)\b|搜索|查找/i;
const COLLECTION_METRIC_PATTERN =
  /(?:收藏|saves?|saved|favorites?|favourites?|collected)\s*[:：]?\s*([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;
const COMPACT_COUNT_PATTERN = /([0-9][0-9,.]*\s*(?:万|千|k|m)?)/i;

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

function findControlAction(
  candidateActions: readonly ReadPageCandidateAction[],
  intent: string,
): ReadPageCandidateAction | undefined {
  return candidateActions.find((action) => action.intent === intent);
}

function controlForElement(params: {
  kind: ReadPageSearchSurface['controls'][number]['kind'];
  element: ReadPageInteractiveElement;
  candidateActions: readonly ReadPageCandidateAction[];
  reason: string;
  confidence: number;
}): ReadPageSearchSurface['controls'][number] {
  const action = actionForRef(params.candidateActions, params.element.ref);
  return {
    kind: params.kind,
    targetRef: params.element.ref,
    candidateActionId: action?.id,
    label: safeLabel(params.element.name),
    confidence: params.confidence,
    actionability: params.element.actionability,
    reason: params.reason,
  };
}

export function buildSearchSurface(params: {
  assistantGuidance?: ReadPageAssistantGuidance;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  visibleRegionRows?: VisibleRegionRowsResult;
}): ReadPageSearchSurface | undefined {
  const requested = guidanceRequestsSearch(params.assistantGuidance);
  if (!requested) return undefined;
  const controls: ReadPageSearchSurface['controls'] = [];
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

  const filterElement = params.interactiveElements.find((element) =>
    FILTER_LABEL_PATTERN.test(normalizeText(element.name)),
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

  const submitAction = findControlAction(params.candidateActions, 'search.submit');
  if (submitAction) {
    controls.push({
      kind: 'submit_search',
      targetRef: submitAction.targetRef,
      candidateActionId: submitAction.id,
      confidence: submitAction.confidence,
      reason: 'search submit action surfaced from candidate actions',
    });
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

  if (!requested && controls.length === 0 && resultCards.length === 0) return undefined;

  return {
    status: controls.length > 0 || resultCards.length > 0 ? 'detected' : 'not_detected',
    queryState: searchInput?.valueState ?? 'unknown',
    controls,
    resultCards,
    sortEvidence: {
      requestedSort: sortElement || sortAction ? 'most_collected' : 'unknown',
      appliedCandidate: false,
      reason:
        sortElement || sortAction
          ? 'most-collected sort control is observable; applied state still requires fresh readback after click'
          : 'no most-collected sort control observed in this snapshot',
    },
    claimBoundary:
      'searchSurface is an observation map only. It does not prove search completion, sort application, or Top-N correctness without fresh same-tab readback and AI-side ranking.',
  };
}
