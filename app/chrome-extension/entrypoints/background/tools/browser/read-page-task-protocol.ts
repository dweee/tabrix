import type {
  ReadPageArtifactRef,
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
  ReadPageComplexityLevel,
  ReadPageExecutableAction,
  ReadPageHighValueObject,
  ReadPageInteractiveElement,
  ReadPageObjectLifecycleSummary,
  ReadPageOperationMap,
  ReadPagePageContext,
  ReadPageRegion,
  ReadPageRegionObject,
  ReadPageRegionTargetability,
  ReadPageRegionType,
  ReadPageSourceKind,
  ReadPageTaskLevel0,
  ReadPageTaskLevel1,
  ReadPageTaskLevel2,
  ReadPageTaskMode,
  DynamicWatchScope,
} from '@tabrix/shared';
import { buildReadPageObjectLifecycle, deriveDynamicWatchScope } from '@tabrix/shared';
import type {
  ObjectLayerContext,
  PageObjectFamilyAdapter,
  PageObjectPriors,
} from './read-page-high-value-objects-core';
import { resolvePageObjectPriors } from './read-page-high-value-objects-core';
import type { PageRole } from './read-page-understanding-core';
import type { VisibleRegionRowsResult } from './visible-region-rows';
import {
  buildGlobalMenuRegionObjects,
  buildGlobalMenuTextRegionObjects,
  normalizeGlobalMenuLabel,
} from './read-page-global-menu-objects';
export { extractGlobalMenuLabelsForTargetRecovery } from './read-page-global-menu-objects';
import { buildHighValueObjects, normalizeHighValueLabel } from './read-page-high-value-pipeline';
import { buildPageOperationMap } from './read-page-operation-map';
import {
  actionSignalText,
  buildCandidateActionSignalRegionObjects,
  buildExploratoryActionRegionObjects,
  scoreCandidateActionForRegion,
} from './read-page-region-action-objects';
import {
  buildTextSignalRegionObjects,
  buildVisualElementRegionObjects,
  type ReadPageVisualElementHint,
} from './read-page-region-signal-objects';
export type { ReadPageVisualElementHint } from './read-page-region-signal-objects';
import {
  classifyAccountMenuTargetIntent,
  classifySensitiveOperationText,
  isLogoutOperationText,
  safeAiOperationLabel,
  TEXT_AUTH_MODAL_HIDDEN_PATTERN,
  TEXT_AUTH_MODAL_PATTERN,
  TEXT_LOGGED_OUT_PATTERN,
  TEXT_QR_PATTERN,
} from './read-page-perception-neutral';
import {
  aggregateLayoutHint,
  aggregateTargetability,
  buildRegionLabel,
  claimBoundaryForRegion,
  classifyRegionObject,
  classifyRegionText,
  inferRegionState,
  redactSensitiveRegionObjects,
  REGION_PRIORITY,
} from './read-page-region-semantics';

interface TaskProtocolParams {
  mode: 'compact' | 'normal' | 'full';
  currentUrl: string;
  currentTitle: string;
  pageType: string;
  pageRole: string;
  primaryRegion: string | null;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  artifactRefs: ReadPageArtifactRef[];
  pageContext: ReadPagePageContext;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  visibleTextContent?: string | null;
  visualElements?: ReadPageVisualElementHint[];
  tabId?: number | null;
  pageStability?: 'stable' | 'loading' | 'changing' | 'stale' | 'unknown';
  /**
   * Optional artifact-ref pointing at the Markdown projection of this
   * snapshot. When present, `L2.markdownRef` will surface it so upstream
   * planners can route reading traffic to Markdown without disturbing the
   * JSON execution path.
   *
   * Optional and defaults to `null`. The protocol layer never *creates*
   * the Markdown artifact; that is `read-page.ts`'s responsibility.
   */
  markdownArtifactRef?: string | null;
  visibleRegionRows?: VisibleRegionRowsResult;
}

interface TaskProtocolResult {
  taskMode: ReadPageTaskMode;
  complexityLevel: ReadPageComplexityLevel;
  sourceKind: ReadPageSourceKind;
  highValueObjects: ReadPageHighValueObject[];
  pageRegions: ReadPageRegion[];
  pageOperationMap: ReadPageOperationMap;
  objectLifecycle: ReadPageObjectLifecycleSummary;
  watchScope: DynamicWatchScope;
  L0: ReadPageTaskLevel0;
  L1: ReadPageTaskLevel1;
  L2: ReadPageTaskLevel2;
}

const PAGE_OBJECT_FAMILY_ADAPTERS: readonly PageObjectFamilyAdapter[] = [
  // No platform-specific adapters. Tabrix uses generic high-value object detection.
  // Platform-specific priors come from the Knowledge layer (MKEP), not hardcoded adapters.
];
const MAX_REGION_OBJECTS = 5;
const MAX_NAVIGATION_REGION_OBJECTS = 12;
const FORM_WORKFLOW_CONTROL_PATTERN =
  /\b(upload|submit|publish|save|create|generate|attach|choose file|select file)\b|上传|提交|发布|保存|生成|选择文件|添加(?:图片|文件)|配图/i;
const WEAK_GLOBAL_WORKFLOW_CONTROL_PATTERN = /^(publish|发布)$/i;
const SEARCH_CONTROL_PATTERN = /\b(search|filter|query)\b|搜索|筛选|查询/i;

function buildInteractiveMap(elements: readonly ReadPageInteractiveElement[]) {
  const map = new Map<string, ReadPageInteractiveElement>();
  for (const element of elements) {
    if (!element?.ref) continue;
    map.set(element.ref, element);
  }
  return map;
}

function getCandidateActionLabel(
  action: ReadPageCandidateAction,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): string {
  const target = interactiveByRef.get(action.targetRef);
  const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
  return String(target?.name || ariaLabel || action.targetRef || action.id).trim();
}

function inferComplexityLevel(params: TaskProtocolParams): ReadPageComplexityLevel {
  let score = 0;
  const interactiveCount = params.interactiveElements.length;
  const candidateActionCount = params.candidateActions.length;
  const lineCount = Number(params.contentSummary?.lineCount || 0);

  if (interactiveCount > 12) score += 1;
  if (interactiveCount > 24) score += 1;
  if (candidateActionCount > 4) score += 1;
  if (lineCount > 40) score += 1;
  if (lineCount > 120) score += 1;
  if (params.pageContext.fallbackUsed) score += 1;
  // Deferred to post-T5.4.0: complexity scoring still has one GitHub-specific
  // bump. Kept stable here so T5.4.0 remains a pure object-layer boundary move.
  if (params.pageRole === 'workflow_run_detail') score += 1;

  if (score >= 4) return 'complex';
  if (score >= 2) return 'medium';
  return 'simple';
}

function inferSourceKind(params: TaskProtocolParams): ReadPageSourceKind {
  if (params.pageType !== 'web_page') {
    return 'artifact';
  }
  return 'dom_semantic';
}

function buildLevel0(
  taskMode: ReadPageTaskMode,
  pageRole: string,
  primaryRegion: string | null,
  highValueObjects: ReadPageHighValueObject[],
  priors: PageObjectPriors,
): ReadPageTaskLevel0 {
  const focusObjectIds = highValueObjects.slice(0, 3).map((item) => item.id);
  const focusLabels = highValueObjects
    .slice(0, 3)
    .map((item) => item.label)
    .filter(Boolean);
  const focusText = focusLabels.join(', ');
  const l0Prefix = priors.l0Prefix;

  return {
    taskMode,
    pageRole,
    primaryRegion,
    focusObjectIds,
    summary: focusText
      ? l0Prefix
        ? `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}. ${l0Prefix} ${focusText}.`
        : `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}; focus on ${focusText}.`
      : `${taskMode} view for ${pageRole}${primaryRegion ? ` in ${primaryRegion}` : ''}.`,
  };
}

function buildLevel1(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageTaskLevel1 {
  const candidateActionIds = params.candidateActions.slice(0, 6).map((item) => item.id);
  const highValueLabels = highValueObjects
    .slice(0, 4)
    .map((item) => item.label)
    .filter(Boolean)
    .join(', ');

  return {
    highValueObjectIds: highValueObjects.map((item) => item.id),
    candidateActionIds,
    overview: highValueLabels
      ? `Top objects: ${highValueLabels}. Candidate actions: ${candidateActionIds.length}.`
      : `Candidate actions: ${candidateActionIds.length}.`,
  };
}

export function redactSensitiveInteractiveElementsForAi(
  interactiveElements: readonly ReadPageInteractiveElement[],
  candidateActions: readonly ReadPageCandidateAction[] = [],
): ReadPageInteractiveElement[] {
  const actionTextByRef = new Map<string, string>();
  for (const action of candidateActions) {
    const text = [action.matchReason, ...action.locatorChain.map((item) => item.value)]
      .filter(Boolean)
      .join(' ');
    actionTextByRef.set(action.targetRef, `${actionTextByRef.get(action.targetRef) ?? ''} ${text}`);
  }

  return interactiveElements.map((element) => {
    const sensitiveText = `${element.role} ${element.name} ${element.href ?? ''} ${actionTextByRef.get(element.ref) ?? ''}`;
    const sensitiveKind = classifySensitiveOperationText(sensitiveText);
    if (!sensitiveKind) return element;
    const redacted: ReadPageInteractiveElement = {
      ref: element.ref,
      role: element.role,
      name: isLogoutOperationText(sensitiveText)
        ? 'logout action candidate'
        : safeAiOperationLabel(sensitiveKind),
    };
    return redacted;
  });
}

export function redactSensitiveCandidateActionsForAi(
  candidateActions: readonly ReadPageCandidateAction[],
  interactiveElements: readonly ReadPageInteractiveElement[] = [],
): ReadPageCandidateAction[] {
  const interactiveByRef = buildInteractiveMap(interactiveElements);
  return candidateActions.map((action) => {
    const element = interactiveByRef.get(action.targetRef);
    const sensitiveText = [
      element?.role,
      element?.name,
      element?.href,
      action.label,
      action.matchReason,
      ...action.locatorChain.map((item) => item.value),
    ]
      .filter(Boolean)
      .join(' ');
    const sensitiveKind = classifySensitiveOperationText(sensitiveText);
    if (!sensitiveKind) return action;
    const safeLocatorChain = action.locatorChain.filter(
      (item) => item.type === 'ref' || item.type === 'css',
    );
    const safeLabel = isLogoutOperationText(sensitiveText)
      ? 'logout action candidate'
      : safeAiOperationLabel(sensitiveKind);
    const redactedAction: ReadPageCandidateAction = {
      ...action,
      label: safeLabel,
      matchReason: isLogoutOperationText(sensitiveText)
        ? 'redacted_logout_action_signal'
        : `redacted_${sensitiveKind}_action_signal`,
      locatorChain:
        safeLocatorChain.length > 0 ? safeLocatorChain : [{ type: 'ref', value: action.targetRef }],
    };
    if (redactedAction.intent === 'search.category_select') {
      delete redactedAction.intent;
    }
    return redactedAction;
  });
}

function redactSensitiveHighValueObjectsForAi(
  highValueObjects: readonly ReadPageHighValueObject[],
): ReadPageHighValueObject[] {
  return highValueObjects.map((object) => {
    const sensitiveKind = classifySensitiveOperationText(
      [
        object.kind,
        object.label,
        object.reason,
        object.role,
        object.href,
        object.region,
        ...(object.reasons ?? []),
      ]
        .filter(Boolean)
        .join(' '),
    );
    if (!sensitiveKind) return object;
    return {
      ...object,
      label: safeAiOperationLabel(sensitiveKind),
      reason: `redacted_${sensitiveKind}_object_signal`,
      href: undefined,
      reasons: object.reasons?.map((reason) =>
        classifySensitiveOperationText(reason) ? `redacted_${sensitiveKind}_object_signal` : reason,
      ),
    };
  });
}

function normalizeCdpAxRole(role: unknown): string | null {
  if (typeof role !== 'string') return null;
  const trimmed = role.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function actionTypesFromCdpAxCandidate(candidate: { actionTypes?: unknown }): string[] {
  const actions = Array.isArray(candidate.actionTypes) ? candidate.actionTypes : [];
  return actions
    .map((action): string | null => (typeof action === 'string' ? action.trim() : null))
    .filter((action): action is string => Boolean(action))
    .slice(0, 6);
}

function locatorChainFromCdpAxCandidate(candidate: {
  locator?: {
    source?: unknown;
    axNodeId?: unknown;
    backendDOMNodeId?: unknown;
    cssSelector?: unknown;
    visualBounds?: unknown;
  };
}): ReadPageCandidateActionLocator[] {
  const locator = candidate.locator;
  if (!locator || locator.source !== 'cdp_ax') return [];
  const chain: ReadPageCandidateActionLocator[] = [];
  if (typeof locator.axNodeId === 'string' && locator.axNodeId.trim()) {
    chain.push({ type: 'cdp_ax_node', value: locator.axNodeId.trim() });
  }
  if (
    typeof locator.backendDOMNodeId === 'number' &&
    Number.isInteger(locator.backendDOMNodeId) &&
    locator.backendDOMNodeId > 0
  ) {
    chain.push({ type: 'backend_dom_node', value: String(locator.backendDOMNodeId) });
  }
  if (typeof locator.cssSelector === 'string' && locator.cssSelector.trim()) {
    chain.push({ type: 'css', value: locator.cssSelector.trim() });
  }
  return chain.slice(0, 4);
}

function visualBoundsFromCdpAxCandidate(candidate: {
  locator?: { visualBounds?: unknown };
}): ReadPageRegionObject['visualBounds'] {
  const bounds = candidate.locator?.visualBounds;
  if (!bounds || typeof bounds !== 'object' || Array.isArray(bounds)) return undefined;
  const record = bounds as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const width = Number(record.width);
  const height = Number(record.height);
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function objectTypeFromCdpAxRole(role: string): string {
  if (role === 'link') return 'link';
  if (role === 'menuitem') return 'nav_entry';
  return 'control';
}

function valueStateFromCdpAxCandidate(candidate: {
  state?: { checked?: unknown; selected?: unknown; expanded?: unknown; disabled?: unknown };
}): ReadPageRegionObject['valueState'] {
  if (candidate.state?.selected === true || candidate.state?.expanded === true) return 'non_empty';
  if (candidate.state?.selected === false || candidate.state?.expanded === false) return 'empty';
  return 'unknown';
}

function buildCdpAxRegionObjects(params: TaskProtocolParams): ReadPageRegionObject[] {
  const candidates = params.pageContext.loadReadiness?.cdpSensing?.accessibility?.objectCandidates;
  if (!Array.isArray(candidates)) return [];
  const objects: ReadPageRegionObject[] = [];
  for (const [index, rawCandidate] of candidates.slice(0, 30).entries()) {
    if (!rawCandidate || typeof rawCandidate !== 'object') continue;
    const candidate = rawCandidate as {
      role?: unknown;
      label?: unknown;
      locator?: {
        source?: unknown;
        axNodeId?: unknown;
        backendDOMNodeId?: unknown;
        cssSelector?: unknown;
        visualBounds?: unknown;
      };
      actionTypes?: unknown;
      state?: { checked?: unknown; selected?: unknown; expanded?: unknown; disabled?: unknown };
    };
    const role = normalizeCdpAxRole(candidate.role);
    if (!role) continue;
    const label =
      typeof candidate.label === 'string' && candidate.label.trim().length > 0
        ? candidate.label.trim()
        : role;
    const locatorChain = locatorChainFromCdpAxCandidate(candidate);
    const idPart =
      locatorChain.find((locator) => locator.type === 'backend_dom_node')?.value ??
      locatorChain.find((locator) => locator.type === 'cdp_ax_node')?.value ??
      `${role}_${index}`;
    const actionTypes = actionTypesFromCdpAxCandidate(candidate);
    const disabled = candidate.state?.disabled === true;
    objects.push({
      objectId: `cdp_ax_${idPart}`,
      label,
      objectType: objectTypeFromCdpAxRole(role),
      role,
      valueState: valueStateFromCdpAxCandidate(candidate),
      locatorChain,
      actionTypes,
      targetability: disabled
        ? 'not_clickable'
        : locatorChain.length > 0
          ? 'locator_chain'
          : 'not_clickable',
      confidence: locatorChain.length > 0 ? 0.74 : 0.58,
      reason: 'cdp_ax_accessibility_candidate',
      sourceProvenance: ['cdp', 'ax'],
      freshness: 'fresh',
      visualBounds: visualBoundsFromCdpAxCandidate(candidate),
    });
  }
  return objects;
}

function buildPageRegions(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageRegion[] {
  const interactiveByRef = buildInteractiveMap(params.interactiveElements);
  const candidateByTargetRef = new Map<string, ReadPageCandidateAction[]>();
  for (const action of params.candidateActions) {
    const key = String(action.targetRef || '').trim();
    if (!key) continue;
    const current = candidateByTargetRef.get(key) ?? [];
    current.push(action);
    candidateByTargetRef.set(key, current);
  }
  const aiFacingCandidateByTargetRef = new Map<string, ReadPageCandidateAction[]>();
  const aiFacingCandidateActions = redactSensitiveCandidateActionsForAi(
    params.candidateActions,
    params.interactiveElements,
  );
  for (const action of aiFacingCandidateActions) {
    const key = String(action.targetRef || '').trim();
    if (!key) continue;
    const current = aiFacingCandidateByTargetRef.get(key) ?? [];
    current.push(action);
    aiFacingCandidateByTargetRef.set(key, current);
  }

  const byType = new Map<ReadPageRegionType, ReadPageRegionObject[]>();
  for (const object of buildRegionObjects(
    params,
    highValueObjects,
    candidateByTargetRef,
    aiFacingCandidateByTargetRef,
  )) {
    const regionType = classifyRegionObject(object);
    const current = byType.get(regionType) ?? [];
    if (current.length < maxObjectsForRegion(regionType)) current.push(object);
    byType.set(regionType, current);
  }
  const authSurfacePresent =
    (byType.get('modal')?.length ?? 0) > 0 ||
    (byType.get('qr_code')?.length ?? 0) > 0 ||
    /\b(auth modal|login dialog|sign[ -]?in dialog|captcha|verification code)\b|登录弹窗|授权弹窗/i.test(
      params.visibleTextContent || '',
    ) ||
    String(params.pageRole || '') === 'login_required';

  for (const object of buildGlobalMenuRegionObjects({
    interactiveElements: params.interactiveElements,
    candidateByTargetRef,
    aiFacingCandidateByTargetRef,
    viewport: params.pageContext.viewport,
    authSurfacePresent,
  })) {
    const targetRegionType = targetRegionTypeForGlobalMenuObject(object, authSurfacePresent);
    const current = byType.get(targetRegionType) ?? [];
    const alreadyRepresented = current.some(
      (item) =>
        item.objectId === object.objectId ||
        (item.targetRef && object.targetRef && item.targetRef === object.targetRef) ||
        normalizeGlobalMenuLabel(item.label) === normalizeGlobalMenuLabel(object.label),
    );
    if (!alreadyRepresented && current.length < maxObjectsForRegion(targetRegionType)) {
      current.push(object);
    }
    byType.set(targetRegionType, current);
  }

  for (const object of buildGlobalMenuTextRegionObjects(params.visibleTextContent, {
    authSurfacePresent,
  })) {
    const targetRegionType = targetRegionTypeForGlobalMenuObject(object, authSurfacePresent);
    const current = byType.get(targetRegionType) ?? [];
    const alreadyRepresented = current.some(
      (item) =>
        item.objectId === object.objectId ||
        normalizeGlobalMenuLabel(item.label) === normalizeGlobalMenuLabel(object.label),
    );
    if (!alreadyRepresented && current.length < maxObjectsForRegion(targetRegionType)) {
      current.push(object);
    }
    byType.set(targetRegionType, current);
  }

  const representedObjectIds = new Set<string>(
    Array.from(byType.values()).flatMap((objects) =>
      objects.flatMap((object) =>
        [object.objectId, object.targetRef].filter((value): value is string => Boolean(value)),
      ),
    ),
  );

  for (const { regionType, objects } of buildGenericContainerRegionObjects({
    candidateActions: aiFacingCandidateActions,
    interactiveByRef,
    candidateByTargetRef,
    aiFacingCandidateByTargetRef,
    visibleRegionRows: params.visibleRegionRows,
    cdpAxRegionObjects: buildCdpAxRegionObjects(params),
    representedObjectIds,
  })) {
    const current = byType.get(regionType) ?? [];
    for (const object of objects) {
      if (current.length >= maxObjectsForRegion(regionType)) break;
      const existingIndex = current.findIndex(
        (item) =>
          item.objectId === object.objectId ||
          (item.targetRef && object.targetRef && item.targetRef === object.targetRef),
      );
      if (existingIndex >= 0) {
        current[existingIndex] = { ...current[existingIndex], ...object };
        representedObjectIds.add(object.objectId);
        if (object.targetRef) representedObjectIds.add(object.targetRef);
        continue;
      }
      current.push(object);
      representedObjectIds.add(object.objectId);
      if (object.targetRef) representedObjectIds.add(object.targetRef);
    }
    byType.set(regionType, current);
  }

  for (const { regionType, object } of buildCandidateActionSignalRegionObjects({
    candidateActions: aiFacingCandidateActions,
    interactiveByRef,
    representedObjectIds,
  })) {
    const current = byType.get(regionType) ?? [];
    if (current.length < maxObjectsForRegion(regionType)) {
      current.push(object);
      representedObjectIds.add(object.objectId);
      if (object.targetRef) representedObjectIds.add(object.targetRef);
    }
    byType.set(regionType, current);
  }

  if (authSurfacePresent) {
    for (const { regionType, object } of buildVisualElementRegionObjects(params.visualElements)) {
      const current = byType.get(regionType) ?? [];
      const alreadyRepresented = current.some(
        (item) =>
          item.objectId === object.objectId ||
          normalizeLocatorChain(item.locatorChain) === normalizeLocatorChain(object.locatorChain),
      );
      if (!alreadyRepresented && current.length < maxObjectsForRegion(regionType)) {
        current.unshift(object);
        representedObjectIds.add(object.objectId);
      }
      byType.set(regionType, current.slice(0, maxObjectsForRegion(regionType)));
    }
  }

  for (const object of buildExploratoryActionRegionObjects({
    candidateActions: aiFacingCandidateActions,
    interactiveByRef,
    representedObjectIds,
  })) {
    const current = byType.get('unknown') ?? [];
    if (current.length < maxObjectsForRegion('unknown')) current.push(object);
    byType.set('unknown', current);
  }

  for (const { regionType, object } of buildTextSignalRegionObjects(params.visibleTextContent, {
    currentTitle: params.currentTitle,
    pageRole: params.pageRole,
  })) {
    const current = byType.get(regionType) ?? [];
    if (
      current.length < maxObjectsForRegion(regionType) &&
      !current.some((item) => item.objectId === object.objectId)
    ) {
      current.push(object);
    }
    byType.set(regionType, current);
  }

  if (params.visibleRegionRows?.visibleRegionRowsUsed) {
    const current = byType.get('content') ?? [];
    for (const row of params.visibleRegionRows.rows.slice(0, 3)) {
      const targetRef = String(row.targetRef || '').trim();
      const label = String(row.title || row.primaryText || '').trim();
      if (!targetRef || !label) continue;
      const actions = candidateByTargetRef.get(targetRef) ?? [];
      const aiFacingActions = aiFacingCandidateByTargetRef.get(targetRef) ?? [];
      if (actions.length === 0) continue;
      const rowObject: ReadPageRegionObject = {
        objectId: targetRef,
        label,
        objectType: 'record',
        role: 'row',
        targetRef,
        actionTypes: Array.from(new Set(actions.map((item) => item.actionType).filter(Boolean))),
        targetability: actions.some((item) => item.locatorChain.length > 0)
          ? 'locator_chain'
          : 'target_ref',
        confidence: clampConfidence(
          row.confidence || params.visibleRegionRows.rowExtractionConfidence || 0.72,
        ),
        reason: 'dom_region_row_target',
        primaryAction: pickPrimaryExecutableAction(aiFacingActions),
      };
      const existingIndex = current.findIndex(
        (object) => object.objectId === targetRef || object.targetRef === targetRef,
      );
      if (existingIndex >= 0) current[existingIndex] = { ...current[existingIndex], ...rowObject };
      else if (current.length < maxObjectsForRegion('content')) current.push(rowObject);
    }
    if (current.length < maxObjectsForRegion('content')) {
      current.push({
        objectId: 'visible_region_rows',
        label: 'visible content rows',
        objectType: 'record',
        actionTypes: [],
        targetability: 'not_clickable',
        confidence: clampConfidence(params.visibleRegionRows.rowExtractionConfidence || 0.6),
        reason: 'dom_region_rows_selected',
      });
    }
    byType.set('content', current);
  }

  const regions: ReadPageRegion[] = [];
  for (const regionType of REGION_PRIORITY) {
    let objects = byType.get(regionType) ?? [];
    if (regionType === 'navigation' && objects.some((object) => isGlobalMenuMapObject(object))) {
      objects = objects.filter(
        (object) => isGlobalMenuMapObject(object) || !isNoisyGlobalMenuMapObject(object),
      );
    }
    if (objects.length === 0) continue;
    const candidateActionIds = Array.from(
      new Set(
        params.candidateActions
          .map((action, index) => ({ action, index }))
          .filter(({ action }) =>
            objects.some((object) => actionMatchesRegionObject(action, object, interactiveByRef)),
          )
          .sort((left, right) => {
            const leftScore = scoreCandidateActionForRegion(
              regionType,
              left.action,
              interactiveByRef,
            );
            const rightScore = scoreCandidateActionForRegion(
              regionType,
              right.action,
              interactiveByRef,
            );
            if (rightScore !== leftScore) return rightScore - leftScore;
            return left.index - right.index;
          })
          .map(({ action }) => action.id),
      ),
    );
    const confidence = clampConfidence(
      objects.reduce((sum, object) => sum + object.confidence, 0) / objects.length,
    );
    const outputObjects = redactSensitiveRegionObjects(regionType, objects);
    const state = adjustRegionStateForVisibleAuthPrompt(
      regionType,
      inferRegionState(regionType, objects),
      params.visibleTextContent,
      byType,
    );
    regions.push({
      regionId: `region_${regionType}`,
      regionType,
      state,
      confidence,
      label: buildRegionLabel(regionType, outputObjects),
      objects: outputObjects,
      candidateActionIds,
      targetability: aggregateTargetability(objects),
      layoutHint: aggregateLayoutHint(objects),
      claimBoundary: claimBoundaryForRegion(regionType),
    });
  }
  return regions;
}

function buildGenericContainerRegionObjects(params: {
  candidateActions: readonly ReadPageCandidateAction[];
  interactiveByRef: Map<string, ReadPageInteractiveElement>;
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  visibleRegionRows?: VisibleRegionRowsResult;
  cdpAxRegionObjects: readonly ReadPageRegionObject[];
  representedObjectIds: Set<string>;
}): Array<{ regionType: ReadPageRegionType; objects: ReadPageRegionObject[] }> {
  const output: Array<{ regionType: ReadPageRegionType; objects: ReadPageRegionObject[] }> = [];
  const searchObjects = buildSearchAreaObjects(params);
  if (searchObjects.length > 0) output.push({ regionType: 'search_area', objects: searchObjects });

  const filterObjects = buildFilterPanelObjects(params);
  if (filterObjects.length > 0) output.push({ regionType: 'filter_panel', objects: filterObjects });

  const resultObjects = buildResultListObjects(params);
  if (resultObjects.length > 0) output.push({ regionType: 'result_list', objects: resultObjects });

  return output;
}

function buildSearchAreaObjects(params: {
  candidateActions: readonly ReadPageCandidateAction[];
  interactiveByRef: Map<string, ReadPageInteractiveElement>;
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  cdpAxRegionObjects: readonly ReadPageRegionObject[];
  representedObjectIds: Set<string>;
}): ReadPageRegionObject[] {
  const searchActions = params.candidateActions.filter((action) =>
    String(action.intent || '').startsWith('search.'),
  );
  const searchElements = Array.from(params.interactiveByRef.values()).filter((element) => {
    const role = String(element.role || '').toLowerCase();
    return (
      role === 'searchbox' || role === 'textbox' || /搜索|search|query/i.test(element.name || '')
    );
  });
  const cdpSearchObjects = params.cdpAxRegionObjects.filter((object) =>
    SEARCH_CONTROL_PATTERN.test(
      `${object.role || ''} ${object.label || ''} ${object.reason || ''}`,
    ),
  );
  if (searchActions.length === 0 && searchElements.length === 0 && cdpSearchObjects.length === 0) {
    return [];
  }

  const containerId = 'container_search_area';
  const childObjects: ReadPageRegionObject[] = [];
  for (const action of searchActions) {
    const targetRef = String(action.targetRef || '').trim();
    if (!targetRef) continue;
    const element = params.interactiveByRef.get(targetRef);
    childObjects.push({
      objectId: targetRef,
      parentObjectId: containerId,
      label: element?.name || action.label || targetRef,
      objectType: 'control',
      role: element?.role,
      valueState: element?.valueState,
      targetRef,
      actionTypes: [String(action.intent || action.actionType)],
      targetability: action.locatorChain.length > 0 ? 'locator_chain' : 'target_ref',
      confidence: clampConfidence(action.confidence || 0.72),
      reason: 'search_area_candidate_action',
      primaryAction: pickPrimaryExecutableAction(
        params.aiFacingCandidateByTargetRef.get(targetRef) ?? [],
      ),
      sourceProvenance: ['dom'],
      freshness: 'fresh',
    });
    if (childObjects.length >= 4) break;
  }

  for (const element of searchElements) {
    if (!element.ref) continue;
    if (childObjects.some((object) => object.objectId === element.ref)) continue;
    childObjects.push({
      objectId: element.ref,
      parentObjectId: containerId,
      label: element.name || 'search input',
      objectType: 'control',
      role: element.role,
      valueState: element.valueState,
      targetRef: element.ref,
      actionTypes: [],
      targetability: 'target_ref',
      confidence: 0.62,
      reason: 'search_area_interactive_element',
      sourceProvenance: ['dom'],
      freshness: 'fresh',
    });
    if (childObjects.length >= 4) break;
  }

  for (const object of cdpSearchObjects) {
    if (childObjects.some((item) => item.objectId === object.objectId)) continue;
    childObjects.push({
      ...object,
      parentObjectId: containerId,
    });
    if (childObjects.length >= 4) break;
  }

  return [
    {
      objectId: containerId,
      label: 'search area',
      objectType: 'container',
      containerKind: 'search_area',
      actionTypes: Array.from(
        new Set(searchActions.map((action) => String(action.intent || action.actionType))),
      ),
      targetability: childObjects.some((object) => object.targetability !== 'not_clickable')
        ? 'target_ref'
        : 'not_clickable',
      confidence: 0.72,
      reason: 'search_area_container',
      sourceProvenance: ['dom'],
      freshness: 'fresh',
    },
    ...childObjects,
  ];
}

function buildFilterPanelObjects(params: {
  candidateActions: readonly ReadPageCandidateAction[];
  interactiveByRef: Map<string, ReadPageInteractiveElement>;
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  representedObjectIds: Set<string>;
}): ReadPageRegionObject[] {
  const filterActions = params.candidateActions.filter((action) => {
    const intent = String(action.intent || '');
    const targetRef = String(action.targetRef || '');
    return intent.startsWith('filter.') || targetRef.startsWith('ref_text_filter_panel_');
  });
  if (filterActions.length === 0) return [];

  const containerId = 'container_filter_panel';
  const childObjects = filterActions.slice(0, 6).flatMap((action): ReadPageRegionObject[] => {
    const targetRef = String(action.targetRef || '').trim();
    if (!targetRef) return [];
    const element = params.interactiveByRef.get(targetRef);
    return [
      {
        objectId: targetRef,
        parentObjectId: containerId,
        label: element?.name || action.label || targetRef,
        objectType: 'control',
        role: element?.role,
        valueState: element?.valueState,
        targetRef,
        actionTypes: [String(action.intent || action.actionType)],
        targetability: action.locatorChain.length > 0 ? 'locator_chain' : 'target_ref',
        confidence: clampConfidence(action.confidence || 0.7),
        reason: 'filter_panel_option_candidate',
        primaryAction: pickPrimaryExecutableAction(
          params.aiFacingCandidateByTargetRef.get(targetRef) ?? [],
        ),
        sourceProvenance: ['dom'],
        freshness: 'fresh',
      },
    ];
  });

  return [
    {
      objectId: containerId,
      label: 'filter panel',
      objectType: 'container',
      containerKind: 'filter_panel',
      actionTypes: Array.from(
        new Set(filterActions.map((action) => String(action.intent || action.actionType))),
      ),
      targetability: childObjects.length > 0 ? 'target_ref' : 'not_clickable',
      confidence: 0.74,
      reason: 'filter_panel_container',
      sourceProvenance: ['dom'],
      freshness: 'fresh',
    },
    ...childObjects,
  ];
}

function buildResultListObjects(params: {
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  visibleRegionRows?: VisibleRegionRowsResult;
  representedObjectIds: Set<string>;
}): ReadPageRegionObject[] {
  const rows =
    params.visibleRegionRows?.visibleRegionRowsUsed === true ? params.visibleRegionRows.rows : [];
  if (!rows || rows.length === 0) return [];

  const containerId = 'container_result_list';
  const cardObjects: ReadPageRegionObject[] = [];
  for (const row of rows.slice(0, 10)) {
    const targetRef = String(row.targetRef || '').trim();
    const label = String(row.title || row.primaryText || '').trim();
    if (!targetRef || !label) continue;
    const actions = params.candidateByTargetRef.get(targetRef) ?? [];
    const aiFacingActions = params.aiFacingCandidateByTargetRef.get(targetRef) ?? [];
    const primaryAction = pickPrimaryExecutableAction(aiFacingActions);
    cardObjects.push({
      objectId: targetRef,
      parentObjectId: containerId,
      label,
      objectType: 'result_card',
      role: 'card',
      targetRef,
      actionTypes: primaryAction ? ['open_detail'] : [],
      targetability: actions.some((action) => action.locatorChain.length > 0)
        ? 'locator_chain'
        : actions.length > 0
          ? 'target_ref'
          : 'not_clickable',
      confidence: clampConfidence(
        row.confidence || params.visibleRegionRows?.rowExtractionConfidence || 0.72,
      ),
      reason: 'result_list_card_candidate',
      primaryAction,
      detailTarget: primaryAction
        ? {
            targetRef: primaryAction.targetRef,
            candidateActionId: primaryAction.candidateActionId,
            actionType: primaryAction.actionType,
            intent: primaryAction.toolArgs.candidateAction.intent,
            locatorChain: primaryAction.locatorChain,
            toolName: primaryAction.toolName,
            claimBoundary:
              'detailTarget is a current-snapshot execution hint; detail open success requires post-action verification',
          }
        : undefined,
      sourceProvenance: ['dom', 'visible_text'],
      freshness: 'fresh',
    });
  }

  return [
    {
      objectId: containerId,
      label: 'visible result list',
      objectType: 'container',
      containerKind: 'result_list',
      actionTypes: cardObjects.some((object) => object.detailTarget) ? ['open_detail'] : [],
      targetability: cardObjects.some((object) => object.targetability !== 'not_clickable')
        ? 'target_ref'
        : 'not_clickable',
      confidence: clampConfidence(params.visibleRegionRows?.regionQualityScore || 0.66),
      reason: 'result_list_container',
      sourceProvenance: ['dom', 'visible_text'],
      freshness: 'fresh',
    },
    ...cardObjects,
  ];
}

function adjustRegionStateForVisibleAuthPrompt(
  regionType: ReadPageRegionType,
  state: string,
  visibleTextContent: string | null | undefined,
  byType: Map<ReadPageRegionType, ReadPageRegionObject[]>,
): string {
  if (regionType !== 'account') return state;
  if (state === 'account_menu_trigger_candidate') return state;
  const hasVisibleAuthRegion =
    (byType.get('modal')?.length ?? 0) > 0 || (byType.get('qr_code')?.length ?? 0) > 0;
  const visibleText = String(visibleTextContent || '')
    .replace(/\s+/g, ' ')
    .trim();
  const authPromptVisible =
    hasVisibleAuthRegion ||
    (TEXT_AUTH_MODAL_PATTERN.test(visibleText) &&
      !TEXT_AUTH_MODAL_HIDDEN_PATTERN.test(visibleText)) ||
    (TEXT_QR_PATTERN.test(visibleText) && TEXT_LOGGED_OUT_PATTERN.test(visibleText));
  return authPromptVisible ? 'logged_out_candidate' : state;
}

function normalizeLocatorChain(
  locatorChain: readonly ReadPageCandidateActionLocator[] | undefined,
): string {
  return (locatorChain ?? []).map((item) => `${item.type}:${item.value}`).join('|');
}

function isGlobalMenuMapObject(object: ReadPageRegionObject): boolean {
  return (
    object.reason === 'global_menu_item_signal' ||
    object.reason === 'visible_text_global_menu_item_signal'
  );
}

function isNoisyGlobalMenuMapObject(object: ReadPageRegionObject): boolean {
  const label = String(object.label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^(?:image|img)(?:\b|:)|图片|图像/i.test(label)) return true;
  if (/^navigation text signal$/i.test(label)) return true;
  if (/^account action candidate$/i.test(label)) return true;
  return false;
}

function maxObjectsForRegion(regionType: ReadPageRegionType): number {
  if (regionType === 'result_list') return 12;
  if (regionType === 'filter_panel') return 8;
  if (regionType === 'search_area') return 6;
  return regionType === 'navigation' ? MAX_NAVIGATION_REGION_OBJECTS : MAX_REGION_OBJECTS;
}

function targetRegionTypeForGlobalMenuObject(
  object: ReadPageRegionObject,
  authSurfacePresent: boolean,
): ReadPageRegionType {
  if (authSurfacePresent && object.menuItemRole === 'auth_entry') return 'modal';
  if (
    object.menuItemRole === 'secondary_menu_action' ||
    (authSurfacePresent && object.menuItemRole === 'overflow_menu_trigger')
  ) {
    return 'menu';
  }
  return 'navigation';
}

function buildRegionObjects(
  params: TaskProtocolParams,
  highValueObjects: ReadPageHighValueObject[],
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>,
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>,
): ReadPageRegionObject[] {
  const objects: ReadPageRegionObject[] = [];
  const seen = new Set<string>();
  for (const item of highValueObjects) {
    const object = regionObjectFromHighValueObject(
      item,
      candidateByTargetRef,
      aiFacingCandidateByTargetRef,
    );
    if (!object || seen.has(object.objectId)) continue;
    seen.add(object.objectId);
    objects.push(object);
  }
  for (const element of params.interactiveElements) {
    if (!element.ref || seen.has(element.ref)) continue;
    const actions = candidateByTargetRef.get(element.ref) ?? [];
    const text = [
      element.role,
      element.name,
      element.href,
      ...actions.map((item) => actionSignalText(item, element)),
    ]
      .filter(Boolean)
      .join(' ');
    const regionType = classifyRegionText(text);
    if (regionType === 'unknown') continue;
    const accountIntent = classifyAccountMenuTargetIntent(text);
    const aiFacingActions = aiFacingCandidateByTargetRef.get(element.ref) ?? [];
    seen.add(element.ref);
    objects.push({
      objectId: element.ref,
      label: element.name || element.role || element.ref,
      role: element.role,
      valueState: element.valueState,
      actionTypes: Array.from(new Set(actions.map((item) => item.actionType).filter(Boolean))),
      targetability: actions.some((item) => item.locatorChain.length > 0)
        ? 'locator_chain'
        : actions.length > 0
          ? 'target_ref'
          : 'not_clickable',
      confidence: actions.length > 0 ? 0.72 : 0.58,
      reason:
        actions.length > 0 && regionType === 'account'
          ? `candidate_action_${accountIntent}_signal`
          : actions.length > 0
            ? 'interactive_candidate_action_region_signal'
            : 'interactive_region_signal',
      primaryAction: pickPrimaryExecutableAction(aiFacingActions),
    });
  }
  for (const object of buildCdpAxRegionObjects(params)) {
    if (seen.has(object.objectId)) continue;
    const regionType = classifyRegionText([object.role, object.label, object.reason].join(' '));
    if (regionType === 'unknown') continue;
    seen.add(object.objectId);
    objects.push(object);
  }
  return objects;
}

function regionObjectFromHighValueObject(
  item: ReadPageHighValueObject,
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>,
  aiFacingCandidateByTargetRef: Map<string, ReadPageCandidateAction[]>,
): ReadPageRegionObject | null {
  const objectId = item.targetRef || item.ref || item.id;
  if (!objectId || !item.label) return null;
  const actions = [
    ...(item.actions?.map((action) => action.actionType || action.type).filter(Boolean) ?? []),
    ...((item.ref ? candidateByTargetRef.get(item.ref) : []) ?? []).map(
      (action) => action.actionType,
    ),
    ...((item.targetRef ? candidateByTargetRef.get(item.targetRef) : []) ?? []).map(
      (action) => action.actionType,
    ),
  ];
  const targetability = targetabilityForObject(item, candidateByTargetRef);
  const aiFacingActions = [
    ...((item.ref ? aiFacingCandidateByTargetRef.get(item.ref) : []) ?? []),
    ...((item.targetRef ? aiFacingCandidateByTargetRef.get(item.targetRef) : []) ?? []),
  ];
  return {
    objectId,
    label: item.label,
    objectType: item.objectType,
    role: item.role,
    targetRef: item.targetRef,
    actionTypes: Array.from(new Set(actions)),
    targetability,
    confidence: clampConfidence(item.confidence ?? 0.62),
    reason: item.reason,
    primaryAction: pickPrimaryExecutableAction(aiFacingActions),
  };
}

function pickPrimaryExecutableAction(
  actions: readonly ReadPageCandidateAction[],
): ReadPageExecutableAction | undefined {
  const action = actions
    .filter((item) => item && (item.actionType === 'click' || item.actionType === 'fill'))
    .sort((left, right) => {
      const leftLocatorScore = left.locatorChain.some((locator) => locator.type === 'css') ? 1 : 0;
      const rightLocatorScore = right.locatorChain.some((locator) => locator.type === 'css')
        ? 1
        : 0;
      if (rightLocatorScore !== leftLocatorScore) return rightLocatorScore - leftLocatorScore;
      return Number(right.confidence || 0) - Number(left.confidence || 0);
    })[0];
  if (!action) return undefined;
  return {
    candidateActionId: action.id,
    actionType: action.actionType,
    targetRef: action.targetRef,
    locatorChain: action.locatorChain,
    toolName: action.actionType === 'fill' ? 'chrome_fill_or_select' : 'chrome_click_element',
    toolArgs: {
      ...(typeof action.frameId === 'number' ? { frameId: action.frameId } : {}),
      candidateAction: {
        id: action.id,
        actionType: action.actionType,
        targetRef: action.targetRef,
        ...(typeof action.frameId === 'number' ? { frameId: action.frameId } : {}),
        confidence: action.confidence,
        matchReason: action.matchReason,
        ...(action.actionability ? { actionability: action.actionability } : {}),
        ...(action.actionabilityReason ? { actionabilityReason: action.actionabilityReason } : {}),
        ...(action.intentBoundary ? { intentBoundary: action.intentBoundary } : {}),
        ...(action.nextRequiredTool ? { nextRequiredTool: action.nextRequiredTool } : {}),
        ...(action.nextRequiredCheck ? { nextRequiredCheck: action.nextRequiredCheck } : {}),
        locatorChain: action.locatorChain,
        ...(action.intent ? { intent: action.intent } : {}),
      },
    },
    claimBoundary:
      'primaryAction is an execution hint only; success still requires Tabrix tool result and post-action verification',
  };
}

function targetabilityForObject(
  item: ReadPageHighValueObject,
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>,
): ReadPageRegionTargetability {
  if (item.targetRef) return 'target_ref';
  const actions = [
    ...((item.ref ? candidateByTargetRef.get(item.ref) : []) ?? []),
    ...((item.targetRef ? candidateByTargetRef.get(item.targetRef) : []) ?? []),
  ];
  if (actions.some((action) => action.locatorChain.length > 0)) return 'locator_chain';
  if (actions.length > 0) return 'target_ref';
  if (item.actions && item.actions.length > 0) return 'unknown';
  return 'not_clickable';
}

function actionMatchesRegionObject(
  action: ReadPageCandidateAction,
  object: ReadPageRegionObject,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): boolean {
  const label = getCandidateActionLabel(action, interactiveByRef).toLowerCase();
  if (classifyRegionObject(object) === 'unknown' && classifySensitiveOperationText(label)) {
    return false;
  }
  if (action.targetRef === object.objectId || action.targetRef === object.targetRef) return true;
  return Boolean(label && normalizeHighValueLabel(object.label) === label);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}

function buildLevel2(params: TaskProtocolParams): ReadPageTaskLevel2 {
  const inlineFullSnapshot = params.mode === 'full';
  // Source routing: pick the first DOM snapshot artifact as the canonical
  // execution-truth pointer. We deliberately ignore the 'normal' / 'full'
  // suffix here because both belong to the same DOM semantic source family;
  // downstream planners do not need to choose between them. `markdownRef`
  // is only populated when read-page.ts actually generated the Markdown
  // projection (renderMode='markdown'). `knowledgeRef` stays `null` until a
  // runtime knowledge-artifact surface exists.
  const domJsonArtifact = params.artifactRefs.find((item) => item.kind === 'dom_snapshot');
  const domJsonRef = domJsonArtifact?.ref ?? null;
  const markdownRef =
    typeof params.markdownArtifactRef === 'string' && params.markdownArtifactRef
      ? params.markdownArtifactRef
      : null;

  // Mirror markdownRef into the legacy `expansions` list so callers that
  // only know the v1 shape can still discover the new source. The
  // strongly-typed `markdownRef` field is the canonical surface.
  const expansions = ['interactive_elements', 'candidate_actions', 'dom_snapshot'];
  if (markdownRef) expansions.push('readable_markdown');

  return {
    available: true,
    defaultAccess: inlineFullSnapshot ? 'inline_full_snapshot' : 'artifact_ref',
    detailRefs: params.artifactRefs.map((item) => item.ref),
    expansions,
    boundary:
      'T5.0 only defines the detail expansion entrypoint. Family-specific deep readers and non-DOM sources remain deferred.',
    domJsonRef,
    markdownRef,
    knowledgeRef: null,
  };
}

function buildWatchScope(
  params: TaskProtocolParams,
  taskMode: ReadPageTaskMode,
): DynamicWatchScope {
  const hasFormWorkflowControl = hasFormLikeWorkflowControl(params);
  const hasSearchControl = hasSearchLikeControl(params);
  const watchIntent =
    hasFormWorkflowControl && !hasSearchControl
      ? [params.pageRole, params.primaryRegion, 'form'].filter(Boolean).join(' ')
      : taskMode === 'read'
        ? [params.primaryRegion, params.pageRole].filter(Boolean).join(' ')
        : taskMode;
  const nowMs = Date.now();

  return deriveDynamicWatchScope({
    tabId: params.tabId ?? null,
    intent: watchIntent || null,
    pageRole: params.pageRole,
    pageStability: params.pageStability ?? 'unknown',
    evidenceWindow: {
      startedAtMs: nowMs,
      endedAtMs: nowMs,
      eventsByKind: {
        interactive_element: params.interactiveElements.length,
        candidate_action: params.candidateActions.length,
        high_value_object: params.visibleRegionRows?.visibleRegionRowsUsed
          ? params.visibleRegionRows.rowCount
          : 0,
      },
    },
    nowMs,
  });
}

function hasFormLikeWorkflowControl(params: TaskProtocolParams): boolean {
  return collectWatchControlLabels(params).some(
    (label) =>
      FORM_WORKFLOW_CONTROL_PATTERN.test(label) &&
      !WEAK_GLOBAL_WORKFLOW_CONTROL_PATTERN.test(label.trim()),
  );
}

function hasSearchLikeControl(params: TaskProtocolParams): boolean {
  return collectWatchControlLabels(params).some((label) => SEARCH_CONTROL_PATTERN.test(label));
}

function collectWatchControlLabels(params: TaskProtocolParams): string[] {
  const interactiveByRef = buildInteractiveMap(params.interactiveElements);
  const labels: string[] = [];
  for (const element of params.interactiveElements) {
    if (element?.name) labels.push(String(element.name));
  }
  for (const action of params.candidateActions) {
    const target = interactiveByRef.get(action.targetRef);
    const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
    const label = target?.name || ariaLabel || action.matchReason || action.id;
    if (label) labels.push(String(label));
  }
  return labels;
}

export function buildTaskProtocol(params: TaskProtocolParams): TaskProtocolResult {
  const priors = resolvePageObjectPriors(PAGE_OBJECT_FAMILY_ADAPTERS, params.pageRole);
  const complexityLevel = inferComplexityLevel(params);
  const sourceKind = inferSourceKind(params);

  const objectLayerContext: ObjectLayerContext = {
    pageRole: params.pageRole as PageRole,
    primaryRegion: params.primaryRegion,
    taskMode: null,
    currentUrl: params.currentUrl,
    priors,
  };

  const { highValueObjects, taskMode } = buildHighValueObjects(params, objectLayerContext);
  const pageRegions = buildPageRegions(params, highValueObjects);
  const pageOperationMap = buildPageOperationMap(pageRegions, {
    candidateActions: redactSensitiveCandidateActionsForAi(
      params.candidateActions,
      params.interactiveElements,
    ),
    interactiveElements: params.interactiveElements,
  });
  const objectLifecycle = buildReadPageObjectLifecycle(pageRegions);
  const aiFacingHighValueObjects = redactSensitiveHighValueObjectsForAi(highValueObjects);
  const L0 = buildLevel0(
    taskMode,
    params.pageRole,
    params.primaryRegion,
    aiFacingHighValueObjects,
    priors,
  );
  const L1 = buildLevel1(params, aiFacingHighValueObjects);
  const L2 = buildLevel2(params);
  const watchScope = buildWatchScope(params, taskMode);

  return {
    taskMode,
    complexityLevel,
    sourceKind,
    highValueObjects: aiFacingHighValueObjects,
    pageRegions,
    pageOperationMap,
    objectLifecycle,
    watchScope,
    L0,
    L1,
    L2,
  };
}
