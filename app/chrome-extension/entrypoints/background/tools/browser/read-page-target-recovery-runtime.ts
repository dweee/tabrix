import type { ReadPageAssistantGuidance } from '@tabrix/shared';

import { buildFallbackRefMap } from './read-page-fallback-format';
import {
  extractFilterPanelLabelsFromVisibleText,
  extractSearchToolbarLabelsFromVisibleText,
} from './read-page-search-surface';
import { extractGlobalMenuLabelsForTargetRecovery } from './read-page-task-protocol';
import {
  appendSyntheticRefBindingDiagnostic,
  bindSyntheticRefsToSelectors,
} from './read-page-target-ref-binding';
import {
  attachFallbackRefs,
  DEFAULT_FILTER_PANEL_TARGET_RECOVERY_LABELS,
  extractVisibleMenuActionLabelsForTargetRecovery,
  extractVisibleTextControlLabelsForTargetRecovery,
  hasExecutableRecoveredTarget,
  isCompactFilterPanelFallbackElement,
  isCompactSearchToolbarFallbackElement,
  isCompactVisibleTextControlFallbackElement,
  isSearchToolbarFilterOpenLabel,
  isSearchToolbarRecoveredRef,
  prependRecoveredElementsToPageContent,
  promoteFilterPanelSelector,
  promoteSearchToolbarSelector,
  promoteTextMenuTriggerSelector,
  searchToolbarElementKey,
  SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS,
  shouldRecoverFilterPanelTargets,
  shouldRecoverSearchToolbarTargets,
} from './read-page-target-recovery';

type CollectInteractiveElementsFallback = (
  tabId: number,
  options?: {
    textQuery?: string;
    selector?: string;
    includeCoordinates?: boolean;
    frameId?: number;
  },
) => Promise<any | null>;

interface TargetRecoveryParams {
  tabId: number;
  basePayload: any;
  assistantGuidance?: ReadPageAssistantGuidance;
  frameId?: number;
  collectInteractiveElementsFallback: CollectInteractiveElementsFallback;
}

function normalizedTextKey(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function existingExecutableLabels(basePayload: any): Set<string> {
  return new Set(
    (Array.isArray(basePayload.elements) ? basePayload.elements : [])
      .filter((element: any) => hasExecutableRecoveredTarget(element))
      .map((element: any) => normalizedTextKey(element?.name || element?.text))
      .filter(Boolean),
  );
}

function existingExecutableTargetKeys(basePayload: any): Set<string> {
  return new Set(
    (Array.isArray(basePayload.elements) ? basePayload.elements : [])
      .filter((element: any) => hasExecutableRecoveredTarget(element))
      .map((element: any) => searchToolbarElementKey(element))
      .filter(Boolean),
  );
}

function prependRecoveredPayload(params: {
  basePayload: any;
  recovered: any[];
  refPrefix: string;
  fallbackSource: string;
  updatePageContent?: boolean;
  bindRefs?: {
    tabId: number;
    frameId?: number;
  };
}): Promise<boolean> | boolean {
  if (params.recovered.length === 0) return false;

  const existingElements = Array.isArray(params.basePayload.elements)
    ? params.basePayload.elements
    : [];
  const existingRefMap = Array.isArray(params.basePayload.refMap) ? params.basePayload.refMap : [];
  const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
  const recoveredRefMap = buildFallbackRefMap(params.recovered).map((entry, index) =>
    entry ? { ...entry, ref: `${params.refPrefix}${offset + index + 1}` } : null,
  );

  const applyRecovered = async (): Promise<boolean> => {
    if (params.bindRefs) {
      const binding = await bindSyntheticRefsToSelectors(
        params.bindRefs.tabId,
        recoveredRefMap,
        params.bindRefs.frameId,
      );
      appendSyntheticRefBindingDiagnostic(params.basePayload, binding);
    }

    const recoveredWithRefs = attachFallbackRefs(params.recovered, recoveredRefMap);
    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    if (params.updatePageContent) {
      prependRecoveredElementsToPageContent({
        basePayload: params.basePayload,
        recoveredElements: recoveredWithRefs,
        recoveredRefMap,
      });
    }
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+${params.fallbackSource}`
      : params.fallbackSource;
    return true;
  };

  return applyRecovered();
}

export async function recoverGlobalMenuTextTargets(params: TargetRecoveryParams): Promise<boolean> {
  const labels = Array.from(
    new Set([
      ...extractGlobalMenuLabelsForTargetRecovery(params.basePayload.visibleTextContent),
      ...extractVisibleMenuActionLabelsForTargetRecovery(params.basePayload.visibleTextContent),
    ]),
  )
    .filter((label) => label.length <= 18)
    .slice(0, 16);
  if (labels.length === 0) return false;

  const existingTargetableLabels = existingExecutableLabels(params.basePayload);
  const recovered: any[] = [];
  for (const label of labels) {
    const normalizedLabel = normalizedTextKey(label);
    if (!normalizedLabel || existingTargetableLabels.has(normalizedLabel)) continue;
    const fallback = await params.collectInteractiveElementsFallback(params.tabId, {
      textQuery: label,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    const first = Array.isArray(fallback?.elements) ? fallback.elements[0] : null;
    if (!first?.selector) continue;
    recovered.push({
      ...first,
      selector: promoteTextMenuTriggerSelector(first.selector) || first.selector,
      text: label,
      name: label,
      role: first.role || 'button',
      type: first.type === 'text' ? 'interactive' : first.type || 'interactive',
    });
    existingTargetableLabels.add(normalizedLabel);
  }

  return prependRecoveredPayload({
    basePayload: params.basePayload,
    recovered,
    refPrefix: 'ref_text_menu_',
    fallbackSource: 'text_menu_target_recovery',
  });
}

export async function recoverVisibleTextControlTargets(
  params: TargetRecoveryParams,
): Promise<boolean> {
  const labels = extractVisibleTextControlLabelsForTargetRecovery(
    params.basePayload.visibleTextContent,
  );
  if (labels.length === 0) return false;

  const existingTargetKeys = new Set(
    (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
      .filter((element: any) => {
        const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
        const href = typeof element?.href === 'string' ? element.href.trim() : '';
        return Boolean(selector || href);
      })
      .map((element: any) => searchToolbarElementKey(element))
      .filter(Boolean),
  );
  const existingLabels = existingExecutableLabels(params.basePayload);

  const recovered: any[] = [];
  for (const label of labels) {
    const normalizedLabel = normalizedTextKey(label);
    if (!normalizedLabel || existingLabels.has(normalizedLabel)) continue;
    const fallback = await params.collectInteractiveElementsFallback(params.tabId, {
      textQuery: label,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    const first = Array.isArray(fallback?.elements)
      ? fallback.elements.find((element: any) =>
          isCompactVisibleTextControlFallbackElement(element),
        )
      : null;
    if (!first?.selector) continue;
    const recoveredElement = {
      ...first,
      selector: first.selector,
      text: label,
      name: label,
      role: first.role === 'generic' ? 'button' : first.role || 'button',
      type: first.type === 'text' ? 'button' : first.type || 'button',
    };
    const key = searchToolbarElementKey(recoveredElement);
    if (!key || existingTargetKeys.has(key)) continue;
    recovered.push(recoveredElement);
    existingTargetKeys.add(key);
    existingLabels.add(normalizedLabel);
  }

  return prependRecoveredPayload({
    basePayload: params.basePayload,
    recovered,
    refPrefix: 'ref_text_control_',
    fallbackSource: 'visible_text_control_recovery',
    updatePageContent: true,
    bindRefs: { tabId: params.tabId, frameId: params.frameId },
  });
}

export async function recoverSearchToolbarTextTargets(
  params: TargetRecoveryParams,
): Promise<boolean> {
  if (!shouldRecoverSearchToolbarTargets(params.assistantGuidance, params.basePayload.pageRole)) {
    return false;
  }
  const labels = Array.from(
    new Set([
      ...SEARCH_TOOLBAR_TARGET_RECOVERY_FALLBACK_LABELS,
      ...extractSearchToolbarLabelsFromVisibleText(params.basePayload.visibleTextContent),
    ]),
  )
    .filter((label) => label.length <= 18)
    .slice(0, 14);
  if (labels.length === 0) return false;

  const existingTargetKeys = existingExecutableTargetKeys(params.basePayload);
  const existingLabels = existingExecutableLabels(params.basePayload);
  const existingRecoveredToolbarLabels = new Set(
    (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
      .filter((element: any) => isSearchToolbarRecoveredRef(element?.ref))
      .map((element: any) => normalizedTextKey(element?.name || element?.text))
      .filter(Boolean),
  );

  const recovered: any[] = [];
  for (const label of labels) {
    const normalizedLabel = normalizedTextKey(label);
    const forceToolbarRecovery =
      isSearchToolbarFilterOpenLabel(label) && !existingRecoveredToolbarLabels.has(normalizedLabel);
    if (!normalizedLabel || (existingLabels.has(normalizedLabel) && !forceToolbarRecovery))
      continue;
    let fallback = await params.collectInteractiveElementsFallback(params.tabId, {
      textQuery: label,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    let first = Array.isArray(fallback?.elements)
      ? fallback.elements.find(
          (element: any) => element?.selector && isCompactSearchToolbarFallbackElement(element),
        )
      : null;
    if (!first?.selector && typeof params.frameId === 'number') {
      fallback = await params.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
      });
      first = Array.isArray(fallback?.elements)
        ? fallback.elements.find(
            (element: any) => element?.selector && isCompactSearchToolbarFallbackElement(element),
          )
        : null;
    }
    if (!first?.selector) continue;
    const recoveredElement = {
      ...first,
      selector: promoteSearchToolbarSelector(first.selector) || first.selector,
      text: label,
      name: label,
      role: first.role || 'button',
      type: first.type === 'text' ? 'button' : first.type || 'button',
    };
    const key = searchToolbarElementKey(recoveredElement);
    if (!key || (existingTargetKeys.has(key) && !forceToolbarRecovery)) continue;
    recovered.push(recoveredElement);
    existingTargetKeys.add(key);
    existingLabels.add(normalizedLabel);
    existingRecoveredToolbarLabels.add(normalizedLabel);
  }

  return prependRecoveredPayload({
    basePayload: params.basePayload,
    recovered,
    refPrefix: 'ref_text_search_toolbar_',
    fallbackSource: 'search_toolbar_target_recovery',
    updatePageContent: true,
    bindRefs: { tabId: params.tabId, frameId: params.frameId },
  });
}

export async function recoverFilterPanelTextTargets(
  params: TargetRecoveryParams,
): Promise<boolean> {
  if (
    !shouldRecoverFilterPanelTargets(
      params.assistantGuidance,
      params.basePayload.visibleTextContent,
      params.basePayload.pageRole,
    )
  ) {
    return false;
  }
  const labelSource = shouldRecoverSearchToolbarTargets(
    params.assistantGuidance,
    params.basePayload.pageRole,
  )
    ? [
        ...extractFilterPanelLabelsFromVisibleText(params.basePayload.visibleTextContent),
        ...DEFAULT_FILTER_PANEL_TARGET_RECOVERY_LABELS,
      ]
    : extractFilterPanelLabelsFromVisibleText(params.basePayload.visibleTextContent);
  const seenLabels = new Set<string>();
  const labels = labelSource
    .filter((label) => label.length <= 18)
    .filter((label) => {
      const key = normalizedTextKey(label);
      if (!key || seenLabels.has(key)) return false;
      seenLabels.add(key);
      return true;
    })
    .slice(0, 16);
  if (labels.length === 0) return false;

  const existingTargetKeys = existingExecutableTargetKeys(params.basePayload);
  const existingRecoveredLabels = new Set(
    (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
      .filter((element: any) => String(element?.ref || '').startsWith('ref_text_filter_panel_'))
      .map((element: any) => normalizedTextKey(element?.name || element?.text))
      .filter(Boolean),
  );

  const recovered: any[] = [];
  for (const label of labels) {
    const normalizedLabel = normalizedTextKey(label);
    if (!normalizedLabel || existingRecoveredLabels.has(normalizedLabel)) continue;
    const fallback = await params.collectInteractiveElementsFallback(params.tabId, {
      textQuery: label,
      includeCoordinates: true,
      frameId: params.frameId,
    });
    const first = Array.isArray(fallback?.elements)
      ? fallback.elements.find(
          (element: any) => element?.selector && isCompactFilterPanelFallbackElement(element),
        )
      : null;
    if (!first?.selector) continue;
    const recoveredElement = {
      ...first,
      selector: promoteFilterPanelSelector(first.selector) || first.selector,
      text: label,
      name: label,
      role: first.role === 'generic' ? 'button' : first.role || 'button',
      type: first.type === 'text' ? 'button' : first.type || 'button',
    };
    const key = searchToolbarElementKey(recoveredElement);
    if (!key || existingTargetKeys.has(key)) continue;
    recovered.push(recoveredElement);
    existingTargetKeys.add(key);
    existingRecoveredLabels.add(normalizedLabel);
  }

  return prependRecoveredPayload({
    basePayload: params.basePayload,
    recovered,
    refPrefix: 'ref_text_filter_panel_',
    fallbackSource: 'filter_panel_target_recovery',
    updatePageContent: true,
    bindRefs: { tabId: params.tabId, frameId: params.frameId },
  });
}
