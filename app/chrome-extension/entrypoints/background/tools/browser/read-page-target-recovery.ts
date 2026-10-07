import type {
  ReadPageAssistantGuidance,
  ReadPageHighValueObject,
  ReadPageHighValueObjectAction,
} from '@tabrix/shared';

import type { CandidateActionSeed } from './read-page-candidate-actions';
import { formatElementsAsPageContent } from './read-page-fallback-format';
import {
  extractFilterPanelLabelsFromVisibleText,
  extractSearchToolbarLabelsFromVisibleText,
} from './read-page-search-surface';
import type { VisibleRegionRowsResult } from './visible-region-rows';

const VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD = 0.95;

export function mergeHighValueObjectActionsIntoCandidateActions(
  candidateActions: CandidateActionSeed[],
  highValueObjects: readonly ReadPageHighValueObject[] | undefined,
  frameId: number | undefined,
): CandidateActionSeed[] {
  if (!Array.isArray(highValueObjects) || highValueObjects.length === 0) {
    return candidateActions;
  }

  const actionByTargetRef = new Map<string, CandidateActionSeed>();
  for (const action of candidateActions) {
    if (action.targetRef) actionByTargetRef.set(action.targetRef, action);
  }

  let output = candidateActions;
  for (const object of highValueObjects) {
    if (object.kind !== 'visible_region_row') continue;
    const targetRef = String(object.ref || '').trim();
    if (!targetRef) continue;
    const hasOpenDetailAction = Array.isArray(object.actions)
      ? object.actions.some(
          (action: ReadPageHighValueObjectAction) =>
            action?.type === 'open_detail' &&
            action?.actionType === 'click' &&
            action?.ref === targetRef,
        )
      : false;
    if (!hasOpenDetailAction) continue;

    const existing = actionByTargetRef.get(targetRef);
    const label = String(object.label || '').trim();
    if (
      /^(menu action candidate|account action candidate|red|home|首页|直播|消息|发布|更多|关于我们|营业执照)$/i.test(
        label,
      )
    ) {
      continue;
    }
    if (existing) {
      if (!existing.intent) existing.intent = 'content.open_detail';
      if (!existing.label && label) existing.label = label;
      existing.confidence = Number(
        Math.max(existing.confidence || 0, object.confidence || 0, 0.78).toFixed(2),
      );
      if (!existing.matchReason) {
        existing.matchReason = 'content row target inferred from high value objects';
      }
      continue;
    }

    if (output.length >= 20) {
      const replaceIndex = [...output]
        .map((action, index) => ({ action, index }))
        .reverse()
        .find(
          ({ action }) =>
            action.intent !== 'search.enter_query' &&
            action.intent !== 'content.open_detail' &&
            !String(action.intent || '').startsWith('auth.'),
        )?.index;
      if (replaceIndex === undefined) continue;
      output = [...output];
      output.splice(replaceIndex, 1);
    } else if (output === candidateActions) {
      output = [...candidateActions];
    }

    const safeRef = targetRef.replace(/[^a-zA-Z0-9_]/g, '_');
    const action: CandidateActionSeed = {
      id: `ca_click_${safeRef}`,
      actionType: 'click',
      targetRef,
      ...(label ? { label } : {}),
      ...(typeof frameId === 'number' ? { frameId } : {}),
      confidence: Number(Math.max(object.confidence || 0, 0.78).toFixed(2)),
      matchReason: 'content row target inferred from high value objects',
      actionability: 'actionable',
      actionabilityReason:
        'source=high_value_objects; visible_region_row_has_open_detail_action; business_success_requires_fresh_post_click_read',
      locatorChain: [{ type: 'ref', value: targetRef }],
      intent: 'content.open_detail',
    };
    output.push(action);
    actionByTargetRef.set(targetRef, action);
  }

  return output
    .map((action, index) => ({
      action,
      index,
      priority:
        action.intent === 'search.enter_query'
          ? 360
          : action.intent === 'content.open_detail'
            ? 350
            : String(action.intent || '').startsWith('auth.')
              ? 325
              : String(action.intent || '').startsWith('publish.')
                ? 90
                : 100,
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ action }) => action);
}

export function shouldRepairVisibleRowsTargetRefs(
  rows: VisibleRegionRowsResult | undefined,
): boolean {
  return (
    rows?.visibleRegionRowsUsed === true &&
    rows.rowCount >= 2 &&
    rows.targetRefCoverageRate < VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD
  );
}

export function attachFallbackRefs(
  elements: any[],
  refMap: Array<{ ref?: string | null } | null>,
): any[] {
  return elements.map((element, index) => {
    const ref = refMap[index]?.ref;
    return typeof ref === 'string' ? { ...element, ref } : element;
  });
}

export function promoteTextMenuTriggerSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

export function promoteSearchToolbarSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (!/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) return raw;
  const parent = parts[parts.length - 2]?.toLowerCase() || '';
  if (/^(button|a|li)(?::|\[role=|\[aria-|\.|#)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  if (/^div(?::|\[role=|\[aria-)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  if (
    /^div[.#]/.test(parent) &&
    /(?:[.#_-]|^)(filter|filters|filtered|sort|dropdown|select|selector|picker|button|btn|trigger|action)(?:[.#_-]|$)/i.test(
      parent,
    )
  ) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

export function promoteFilterPanelSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (!/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) return raw;
  const parent = parts[parts.length - 2]?.toLowerCase() || '';
  if (/^(button|a|li|div)(?::|\[role=|\[aria-|\.|#)/.test(parent)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

export function isCompactSearchToolbarFallbackElement(element: any): boolean {
  if (!hasRecoverableVisibility(element)) return false;
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length > 30) return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 260 && height <= 120;
}

export function normalizeVisibleSearchSurfaceAction(action: any): CandidateActionSeed | null {
  const id = typeof action?.id === 'string' ? action.id.trim() : '';
  const targetRef = typeof action?.targetRef === 'string' ? action.targetRef.trim() : '';
  const locatorChain: CandidateActionSeed['locatorChain'] = Array.isArray(action?.locatorChain)
    ? action.locatorChain
        .map((locator: any) => ({
          type: typeof locator?.type === 'string' ? locator.type.trim() : '',
          value: typeof locator?.value === 'string' ? locator.value.trim() : '',
        }))
        .filter((locator: { type: string; value: string }) => locator.type && locator.value)
    : [];
  if (!id || !targetRef || locatorChain.length === 0) return null;

  const intent = typeof action?.intent === 'string' ? action.intent.trim() : undefined;
  const label = typeof action?.label === 'string' ? action.label.trim() : undefined;
  const hasCssLocator = locatorChain.some((locator) => locator.type === 'css');
  if (!hasCssLocator && !intent?.startsWith('search.')) return null;
  const executionTargetKind =
    typeof action?.executionTargetKind === 'string' && action.executionTargetKind.trim()
      ? action.executionTargetKind.trim()
      : undefined;
  const provenanceSource =
    action?.provenance && typeof action.provenance === 'object' ? action.provenance : null;
  const surfaceType =
    typeof provenanceSource?.surfaceType === 'string' ? provenanceSource.surfaceType.trim() : '';
  const provenance = surfaceType
    ? {
        surfaceType,
        ...(typeof provenanceSource?.panelRef === 'string' && provenanceSource.panelRef.trim()
          ? { panelRef: provenanceSource.panelRef.trim() }
          : {}),
        ...(typeof provenanceSource?.groupId === 'string' && provenanceSource.groupId.trim()
          ? { groupId: provenanceSource.groupId.trim() }
          : {}),
        ...(typeof provenanceSource?.optionRef === 'string' && provenanceSource.optionRef.trim()
          ? { optionRef: provenanceSource.optionRef.trim() }
          : {}),
        ...(Array.isArray(provenanceSource?.classificationEvidence)
          ? {
              classificationEvidence: provenanceSource.classificationEvidence
                .filter((item: unknown): item is string => typeof item === 'string')
                .map((item: string) => item.trim())
                .filter(Boolean)
                .slice(0, 12),
            }
          : {}),
      }
    : undefined;
  const rectSource = action?.snapshotRect;
  const snapshotRect =
    rectSource &&
    [rectSource.x, rectSource.y, rectSource.width, rectSource.height].every(
      (value) => typeof value === 'number' && Number.isFinite(value),
    ) &&
    rectSource.width > 0 &&
    rectSource.height > 0
      ? {
          x: rectSource.x,
          y: rectSource.y,
          width: rectSource.width,
          height: rectSource.height,
        }
      : undefined;
  const visibilitySource = action?.visibility;
  const visibility =
    visibilitySource &&
    typeof visibilitySource.source === 'string' &&
    typeof visibilitySource.domVisible === 'boolean' &&
    typeof visibilitySource.inViewport === 'boolean' &&
    (typeof visibilitySource.centerHitTarget === 'boolean' ||
      visibilitySource.centerHitTarget === null) &&
    (typeof visibilitySource.occluded === 'boolean' || visibilitySource.occluded === null)
      ? {
          source: visibilitySource.source,
          domVisible: visibilitySource.domVisible,
          inViewport: visibilitySource.inViewport,
          centerHitTarget: visibilitySource.centerHitTarget,
          occluded: visibilitySource.occluded,
          ...(typeof visibilitySource.reason === 'string' && visibilitySource.reason.trim()
            ? { reason: visibilitySource.reason.trim() }
            : {}),
        }
      : undefined;

  return {
    id,
    actionType: typeof action?.actionType === 'string' ? action.actionType : 'click',
    targetRef,
    ...(executionTargetKind ? { executionTargetKind } : {}),
    ...(label ? { label } : {}),
    confidence:
      typeof action?.confidence === 'number' && Number.isFinite(action.confidence)
        ? action.confidence
        : intent === 'search.open_filters'
          ? 0.94
          : 0.88,
    matchReason:
      typeof action?.matchReason === 'string' && action.matchReason.trim()
        ? action.matchReason.trim()
        : 'visible_search_surface_scan',
    actionability: action?.actionability === false ? 'unknown' : 'actionable',
    ...(action?.actionability === false && typeof action?.actionabilityReason === 'string'
      ? { actionabilityReason: action.actionabilityReason }
      : {}),
    locatorChain,
    ...(snapshotRect ? { snapshotRect } : {}),
    ...(visibility ? { visibility } : {}),
    ...(provenance ? { provenance } : {}),
    ...(intent ? { intent } : {}),
  };
}

export function mergeVisibleSearchSurfaceActions(
  existingActions: CandidateActionSeed[],
  visibleSurfaceActions: CandidateActionSeed[],
): CandidateActionSeed[] {
  if (visibleSurfaceActions.length === 0) return existingActions;
  const merged: CandidateActionSeed[] = [];
  const seen = new Set<string>();
  for (const action of [...visibleSurfaceActions, ...existingActions]) {
    const key = [
      action.intent || '',
      action.targetRef || '',
      action.label || '',
      Array.isArray(action.locatorChain)
        ? action.locatorChain.find((locator) => locator?.type === 'css')?.value || ''
        : '',
    ]
      .join('|')
      .toLowerCase();
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    merged.push(action);
  }
  return merged;
}

export function itemUrlMatchesReadPage(item: any, currentUrl: string): boolean {
  const itemUrl = typeof item?.pageInfo?.url === 'string' ? item.pageInfo.url : '';
  if (!itemUrl || !currentUrl) return false;
  try {
    const left = new URL(itemUrl);
    const right = new URL(currentUrl);
    return left.origin === right.origin && left.pathname === right.pathname;
  } catch {
    return itemUrl.replace(/[?#].*$/, '') === currentUrl.replace(/[?#].*$/, '');
  }
}

export function isCompactFilterPanelFallbackElement(element: any): boolean {
  if (!hasRecoverableVisibility(element)) return false;
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 24) return false;
  const actionability = String(element?.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 320 && height <= 120;
}

export const DEFAULT_FILTER_PANEL_TARGET_RECOVERY_LABELS = [
  '筛选',
  '已筛选',
  '过滤',
  '排序',
  '重置',
  '收起',
  '清除',
  '确认',
  '应用',
  'filter',
  'filters',
  'filtered',
  'sort',
  'reset',
  'clear',
  'confirm',
  'apply',
];

export function shouldRecoverFilterPanelTargets(
  assistantGuidance: ReadPageAssistantGuidance | undefined,
  visibleTextContent: unknown,
  pageRole?: string,
): boolean {
  const text = String(visibleTextContent || '').replace(/\s+/g, ' ');
  const filterPanelLabels = extractFilterPanelLabelsFromVisibleText(text);
  if (filterPanelLabels.length < 2) return false;
  if (shouldRecoverSearchToolbarTargets(assistantGuidance, pageRole)) return true;
  const toolbarLabels = extractSearchToolbarLabelsFromVisibleText(text);
  return toolbarLabels.some((label) =>
    /^(筛选|已筛选|过滤|filter|filters|filtered|排序|sort)$/i.test(label),
  );
}

export function extractVisibleMenuActionLabelsForTargetRecovery(
  visibleTextContent: unknown,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length > 18) continue;
    if (
      !/\b(log[ -]?out|sign[ -]?out|settings?|help|support|feedback)\b|退出|注销|设置|帮助|客服|反馈/i.test(
        line,
      )
    ) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(line);
    if (labels.length >= 8) break;
  }
  return labels;
}

export function shouldRecoverSearchToolbarTargets(
  assistantGuidance: ReadPageAssistantGuidance | undefined,
  pageRole?: string,
): boolean {
  if (pageRole === 'search_results') return true;
  if (pageRole === 'multi_region_page') return true;
  if (assistantGuidance?.taskKind === 'search') return true;
  return (assistantGuidance?.requestedObjects ?? []).some((item) =>
    ['search_input', 'result_cards', 'detail_metrics'].includes(item),
  );
}

export const SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS = [
  '筛选',
  '已筛选',
  'Filter',
  'Filters',
];

export function searchToolbarElementKey(element: any): string {
  return [
    typeof element?.selector === 'string' ? element.selector.trim() : '',
    typeof element?.href === 'string' ? element.href.trim() : '',
    typeof element?.text === 'string' ? element.text.trim() : '',
    typeof element?.name === 'string' ? element.name.trim() : '',
  ]
    .filter(Boolean)
    .join('|')
    .toLowerCase();
}

export function hasExecutableRecoveredTarget(element: any): boolean {
  if (!hasRecoverableVisibility(element)) return false;
  const href = typeof element?.href === 'string' ? element.href.trim() : '';
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  return Boolean(selector || href);
}

function hasRecoverableVisibility(element: any): boolean {
  const visibility = element?.visibility;
  if (!visibility || typeof visibility !== 'object') return true;
  if (visibility.domVisible === false) return false;
  if (visibility.inViewport === false) return false;
  if (visibility.centerHitTarget === false) return false;
  if (visibility.occluded === true) return false;
  const reason = String(visibility.reason || '').toLowerCase();
  if (/(center_covered|occluded|covered)/.test(reason)) return false;
  return true;
}

export function isSearchToolbarRecoveredRef(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('ref_text_search_toolbar_');
}

export function isSearchToolbarFilterOpenLabel(value: unknown): boolean {
  return /^(筛选|已筛选|过滤|filter|filters|filtered|排序|sort)$/i.test(
    String(value || '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

export function prependRecoveredElementsToPageContent(params: {
  basePayload: any;
  recoveredElements: any[];
  recoveredRefMap: any[];
}): void {
  const recoveredContent = formatElementsAsPageContent(
    params.recoveredElements,
    params.recoveredRefMap,
  );
  if (!recoveredContent) return;
  const existingContent =
    typeof params.basePayload.pageContent === 'string' ? params.basePayload.pageContent : '';
  params.basePayload.pageContent = existingContent
    ? `${recoveredContent}\n${existingContent}`
    : recoveredContent;
}

export function extractVisibleTextControlLabelsForTargetRecovery(
  visibleTextContent: unknown,
): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const text = String(visibleTextContent || '').replace(/\r/g, '\n');
  const candidates = text
    .split(/\n+|[|｜•·]/)
    .flatMap((line) => line.split(/\s{2,}/))
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    if (candidate.length > 18) continue;
    if (isDescriptiveVisibleTextControlLabel(candidate)) continue;
    if (
      !/\b(upload|publish|post|create|add|new|edit|save|next|continue|confirm|submit)\b|上传|发布|创建|新建|新增|添加|编辑|保存|下一步|继续|确定|提交/i.test(
        candidate,
      )
    ) {
      continue;
    }
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(candidate);
    if (labels.length >= 10) break;
  }

  return labels;
}

function isDescriptiveVisibleTextControlLabel(label: string): boolean {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return true;
  if (/^(支持|最大|推荐|建议|超过|不超过|仅支持|可上传|允许上传)/.test(normalized)) return true;
  if (/(大小|尺寸|格式|分辨率|时长|以内|文件|画质|要求|限制)/.test(normalized)) return true;
  if (/^(supports?|maximum|max|recommended|recommend|allowed|only supports?)\b/i.test(normalized)) {
    return true;
  }
  if (/\b(size|format|resolution|duration|limit|limits?|requirements?|file)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

export function isCompactVisibleTextControlFallbackElement(element: any): boolean {
  if (!hasRecoverableVisibility(element)) return false;
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  if (!selector) return false;
  const text = String(element?.text || element?.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 30) return false;
  const actionability = String(element?.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const role = String(element?.role || element?.type || '').toLowerCase();
  if (element?.isInteractive === false && /^(text|generic|statictext)$/.test(role)) return false;
  const rect = element?.coordinates?.rect;
  if (!rect) return true;
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return true;
  return width > 0 && height > 0 && width <= 360 && height <= 160;
}
