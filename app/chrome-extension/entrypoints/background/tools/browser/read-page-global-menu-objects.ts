import type {
  ReadPageCandidateAction,
  ReadPageExecutableAction,
  ReadPageInteractiveElement,
  ReadPagePageContext,
  ReadPageRegionLayoutHint,
  ReadPageRegionMenuItemRole,
  ReadPageRegionObject,
} from '@tabrix/shared';
import {
  classifySensitiveOperationText,
  GENERIC_ACCOUNT_MENU_LABEL_PATTERN,
  GLOBAL_MENU_LABEL_PATTERN,
  isLogoutOperationText,
  LOW_BUSINESS_SIGNAL_PATTERN,
  OVERFLOW_MENU_LABEL_PATTERN,
  safeAiOperationLabel,
} from './read-page-perception-neutral';
import { dominantLayoutHint } from './read-page-region-semantics';

const GLOBAL_MENU_MIN_ITEMS = 4;
const MAX_NAVIGATION_REGION_OBJECTS = 12;
const TEXT_GLOBAL_MENU_SCAN_LINES = 200;

export function buildGlobalMenuRegionObjects(params: {
  interactiveElements: readonly ReadPageInteractiveElement[];
  candidateByTargetRef: Map<string, ReadPageCandidateAction[]>;
  aiFacingCandidateByTargetRef?: Map<string, ReadPageCandidateAction[]>;
  viewport: ReadPagePageContext['viewport'];
  authSurfacePresent?: boolean;
}): ReadPageRegionObject[] {
  const menuItems = params.interactiveElements
    .map((element, index) => {
      const actions = element.ref ? (params.candidateByTargetRef.get(element.ref) ?? []) : [];
      const layoutHint = inferElementLayoutHint(element, params.viewport);
      const menuItemRole = inferMenuItemRole(element, actions);
      const visibleText = [
        element.role,
        element.name,
        layoutHint,
        menuItemRole,
        ...actions.map(
          (action) =>
            `${action.matchReason} ${action.locatorChain.map((item) => item.value).join(' ')}`,
        ),
      ]
        .filter(Boolean)
        .join(' ');
      const compactMenuLabel = isCompactGlobalMenuLabel(element.name);
      if (isNonGenericUserIdentityRoute(element.href, element.name)) return null;
      const looksLikeMenuItem =
        menuItemRole !== 'unknown' ||
        (!params.authSurfacePresent &&
          isCommonGlobalMenuLayoutHint(layoutHint) &&
          compactMenuLabel) ||
        GLOBAL_MENU_LABEL_PATTERN.test(visibleText);

      if (!element.ref || !looksLikeMenuItem) return null;
      const role = String(element.role || '').toLowerCase();
      if (!['button', 'link', 'menuitem', 'tab', 'treeitem'].includes(role)) return null;
      const label = safeGlobalMenuItemLabel(element.name, menuItemRole);
      if (!label) return null;
      return {
        element,
        actions,
        index,
        layoutHint,
        menuItemRole,
        label,
        score: scoreGlobalMenuItem(element, actions, layoutHint, menuItemRole, index),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  if (menuItems.length < GLOBAL_MENU_MIN_ITEMS) return [];

  const dominantLayout = dominantLayoutHint(menuItems.map((item) => item.layoutHint));
  const orderedItems = [...menuItems]
    .filter(
      (item) =>
        dominantLayout === 'unknown' ||
        item.layoutHint === dominantLayout ||
        item.menuItemRole === 'overflow_menu_trigger' ||
        item.menuItemRole === 'account_entry',
    )
    .sort((left, right) => left.index - right.index)
    .slice(0, MAX_NAVIGATION_REGION_OBJECTS);

  return orderedItems.map((item) => {
    const aiFacingActions = item.element.ref
      ? (params.aiFacingCandidateByTargetRef?.get(item.element.ref) ?? [])
      : [];
    return {
      objectId: `global_menu_${item.element.ref}`,
      label: item.label,
      role: item.element.role,
      targetRef: item.element.ref,
      actionTypes: Array.from(
        new Set(item.actions.map((action) => action.actionType).filter(Boolean)),
      ),
      targetability: item.actions.some((action) => action.locatorChain.length > 0)
        ? 'locator_chain'
        : item.actions.length > 0
          ? 'target_ref'
          : 'not_clickable',
      confidence: clampConfidence(item.score),
      reason: 'global_menu_item_signal',
      primaryAction: toExecutableAction(aiFacingActions),
      layoutHint: dominantLayout === 'unknown' ? item.layoutHint : dominantLayout,
      menuItemRole: item.menuItemRole,
    };
  });
}

export function buildGlobalMenuTextRegionObjects(
  visibleTextContent: string | null | undefined,
  options: { authSurfacePresent?: boolean } = {},
): ReadPageRegionObject[] {
  const labels = extractGlobalMenuLabelsFromVisibleText(visibleTextContent, {
    includeCompactUnknown: options.authSurfacePresent !== true,
  });
  if (labels.length < GLOBAL_MENU_MIN_ITEMS) return [];

  return labels.slice(0, MAX_NAVIGATION_REGION_OBJECTS).map((label, index) => {
    const menuItemRole = inferTextMenuItemRole(label);
    const safeLabel = safeGlobalMenuItemLabel(label, menuItemRole);
    return {
      objectId: `global_menu_text_${index}_${slugGlobalMenuLabel(label)}`,
      label: safeLabel || label,
      role: 'text',
      objectType: 'navigation_item',
      actionTypes: [],
      targetability: 'not_clickable',
      confidence: clampConfidence(0.5 + (menuItemRole !== 'unknown' ? 0.1 : 0) - index * 0.01),
      reason: 'visible_text_global_menu_item_signal',
      layoutHint: 'unknown',
      menuItemRole,
    };
  });
}

export function extractGlobalMenuLabelsForTargetRecovery(
  visibleTextContent: string | null | undefined,
): string[] {
  return extractGlobalMenuLabelsFromVisibleText(visibleTextContent);
}

export function normalizeGlobalMenuLabel(label: string | undefined): string {
  return String(label || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function extractGlobalMenuLabelsFromVisibleText(
  visibleTextContent: string | null | undefined,
  options: { includeCompactUnknown?: boolean } = {},
): string[] {
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, TEXT_GLOBAL_MENU_SCAN_LINES);
  if (lines.length === 0) return [];

  const normalizedLines: string[] = [];
  for (const line of lines) {
    if (/^ai$/i.test(line) && normalizedLines.length > 0) {
      const previous = normalizedLines[normalizedLines.length - 1];
      if (previous && previous.length <= 8 && !/\bai\b/i.test(previous)) {
        normalizedLines[normalizedLines.length - 1] = `${previous} ai`;
      }
      continue;
    }
    normalizedLines.push(line);
  }

  const legalIndex = normalizedLines.findIndex(
    (line) => LOW_BUSINESS_SIGNAL_PATTERN.test(line) || line.length > 80,
  );
  const primaryWindow =
    legalIndex >= 0 ? normalizedLines.slice(0, legalIndex) : normalizedLines.slice(0, 24);
  const labels = collectMenuTextLabels(primaryWindow, {
    includeCompactUnknown: options.includeCompactUnknown !== false,
  });
  const knownCount = labels.filter((label) => inferTextMenuItemRole(label) !== 'unknown').length;
  if (labels.length < GLOBAL_MENU_MIN_ITEMS || knownCount < 3) return [];

  const overflowWindow =
    legalIndex >= 0
      ? normalizedLines.slice(legalIndex + 1)
      : normalizedLines.slice(primaryWindow.length);
  for (const label of collectMenuTextLabels(overflowWindow, { includeCompactUnknown: false })) {
    const role = inferTextMenuItemRole(label);
    if (role !== 'overflow_menu_trigger' && !/^(?:about|about us|关于我们)$/i.test(label)) continue;
    if (
      !labels.some((item) => normalizeGlobalMenuLabel(item) === normalizeGlobalMenuLabel(label))
    ) {
      labels.push(label);
    }
  }

  return labels.slice(0, MAX_NAVIGATION_REGION_OBJECTS);
}

function collectMenuTextLabels(
  lines: readonly string[],
  options: { includeCompactUnknown: boolean },
): string[] {
  const labels: string[] = [];
  for (const line of lines) {
    const label = safeGlobalMenuTextLabel(line, options.includeCompactUnknown);
    if (!label) continue;
    if (labels.some((item) => normalizeGlobalMenuLabel(item) === normalizeGlobalMenuLabel(label))) {
      continue;
    }
    labels.push(label);
  }
  return labels;
}

function safeGlobalMenuTextLabel(label: string, includeCompactUnknown: boolean): string {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (LOW_BUSINESS_SIGNAL_PATTERN.test(normalized)) return '';
  if (/经营者信息|许可证|备案|ICP备?|公网安备|营业执照|电信业务|网络文化/i.test(normalized)) {
    return '';
  }
  if (normalized.length > 18) return '';
  if (/^[\d\s\-_:./\\]+$/.test(normalized)) return '';
  if (inferTextMenuItemRole(normalized) !== 'unknown') return normalized;
  return includeCompactUnknown &&
    /^[\u4e00-\u9fffA-Za-z][\u4e00-\u9fffA-Za-z0-9 ]{1,10}$/.test(normalized)
    ? normalized
    : '';
}

function inferTextMenuItemRole(label: string): ReadPageRegionMenuItemRole {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return 'unknown';
  if (isLogoutOperationText(normalized)) {
    return 'secondary_menu_action';
  }
  if (/\b(log[ -]?in|sign[ -]?in|signin|auth|authorize)\b|登录|登陆|授权/i.test(normalized)) {
    return 'auth_entry';
  }
  if (OVERFLOW_MENU_LABEL_PATTERN.test(normalized)) return 'overflow_menu_trigger';
  if (GENERIC_ACCOUNT_MENU_LABEL_PATTERN.test(normalized)) return 'account_entry';
  if (GLOBAL_MENU_LABEL_PATTERN.test(normalized)) return 'primary_navigation';
  return 'unknown';
}

function slugGlobalMenuLabel(label: string): string {
  const normalized = normalizeGlobalMenuLabel(label);
  const ascii = normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (ascii) return ascii.slice(0, 32);
  let hex = '';
  for (const char of normalized.slice(0, 8)) {
    hex += char.charCodeAt(0).toString(16);
  }
  return hex || 'item';
}

function inferElementLayoutHint(
  element: ReadPageInteractiveElement,
  viewport: ReadPagePageContext['viewport'],
): ReadPageRegionLayoutHint {
  const rect = element.rect;
  const viewportWidth = Number(viewport?.width || 0);
  const viewportHeight = Number(viewport?.height || 0);
  if (!rect) return 'unknown';
  if (viewportWidth <= 0 || viewportHeight <= 0) {
    if (rect.x <= 260 && rect.width <= 280 && rect.height >= 24) return 'left_sidebar';
    if (rect.y <= 120 && rect.height >= 20) return 'top_navigation';
    return 'unknown';
  }
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  if (centerX <= viewportWidth * 0.28 && rect.height >= 24) return 'left_sidebar';
  if (centerX >= viewportWidth * 0.72 && centerY <= viewportHeight * 0.35) return 'top_right';
  if (centerX >= viewportWidth * 0.72) return 'right_sidebar';
  if (centerY <= viewportHeight * 0.22) return 'top_navigation';
  if (
    centerY >= viewportHeight * 0.78 &&
    rect.width <= Math.min(180, viewportWidth * 0.18) &&
    rect.height <= 80
  ) {
    return 'bottom_navigation';
  }
  return 'inline';
}

function isCommonGlobalMenuLayoutHint(layoutHint: ReadPageRegionLayoutHint): boolean {
  return (
    layoutHint === 'left_sidebar' ||
    layoutHint === 'right_sidebar' ||
    layoutHint === 'top_navigation' ||
    layoutHint === 'top_right' ||
    layoutHint === 'bottom_navigation'
  );
}

function isNonGenericUserIdentityRoute(
  href: string | undefined,
  label: string | undefined,
): boolean {
  const normalizedHref = String(href || '').trim();
  if (!/(?:^|\/)(?:user|users|profile|account|member)(?:[/?#]|$)/i.test(normalizedHref)) {
    return false;
  }
  const normalizedLabel = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedLabel) return true;
  return (
    !GENERIC_ACCOUNT_MENU_LABEL_PATTERN.test(normalizedLabel) &&
    !GLOBAL_MENU_LABEL_PATTERN.test(normalizedLabel)
  );
}

function isCompactGlobalMenuLabel(label: string): boolean {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  if (/^(?:image|img)(?:\b|:)|图片|图像/i.test(normalized)) return false;
  if (LOW_BUSINESS_SIGNAL_PATTERN.test(normalized)) return false;
  if (/经营者信息|许可证|备案|ICP备?|公网安备|营业执照|电信业务|网络文化/i.test(normalized)) {
    return false;
  }
  if (normalized.length > 18) return false;
  if (/^[\d\s\-_:./\\]+$/.test(normalized)) return false;
  return true;
}

function inferMenuItemRole(
  element: ReadPageInteractiveElement,
  actions: readonly ReadPageCandidateAction[],
): ReadPageRegionMenuItemRole {
  const labelText = [
    element.role,
    element.name,
    ...actions.map((action) => actionSignalText(action, element)),
  ]
    .filter(Boolean)
    .join(' ');
  const executionText = [labelText, element.href].filter(Boolean).join(' ');
  if (isLogoutOperationText(executionText)) {
    return 'secondary_menu_action';
  }
  if (/\b(log[ -]?in|sign[ -]?in|signin|auth|authorize)\b|登录|登陆|授权/i.test(executionText)) {
    return 'auth_entry';
  }
  if (OVERFLOW_MENU_LABEL_PATTERN.test(labelText)) return 'overflow_menu_trigger';
  if (GENERIC_ACCOUNT_MENU_LABEL_PATTERN.test(String(element.name || '').trim())) {
    return 'account_entry';
  }
  if (GLOBAL_MENU_LABEL_PATTERN.test(labelText)) return 'primary_navigation';
  if (String(element.role || '').toLowerCase() === 'menuitem') return 'secondary_menu_action';
  return 'unknown';
}

function safeGlobalMenuItemLabel(label: string, menuItemRole: ReadPageRegionMenuItemRole): string {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return '';
  if (/^(?:image|img)(?:\b|:)|图片|图像/i.test(normalized)) return '';
  if (
    (menuItemRole === 'account_entry' ||
      classifySensitiveOperationText(normalized) === 'account') &&
    !GENERIC_ACCOUNT_MENU_LABEL_PATTERN.test(normalized)
  ) {
    return 'account menu item';
  }
  if (menuItemRole === 'secondary_menu_action' && classifySensitiveOperationText(normalized)) {
    return isLogoutOperationText(normalized)
      ? 'logout action candidate'
      : safeAiOperationLabel('menu');
  }
  return normalized.slice(0, 80);
}

function scoreGlobalMenuItem(
  element: ReadPageInteractiveElement,
  actions: readonly ReadPageCandidateAction[],
  layoutHint: ReadPageRegionLayoutHint,
  menuItemRole: ReadPageRegionMenuItemRole,
  index: number,
): number {
  let score = 0.48;
  if (
    layoutHint === 'left_sidebar' ||
    layoutHint === 'right_sidebar' ||
    layoutHint === 'top_navigation' ||
    layoutHint === 'bottom_navigation'
  ) {
    score += 0.24;
  } else if (layoutHint === 'top_right') {
    score += 0.12;
  }
  if (menuItemRole === 'primary_navigation') score += 0.18;
  if (menuItemRole === 'overflow_menu_trigger' || menuItemRole === 'account_entry') score += 0.14;
  if (actions.length > 0) score += 0.08;
  if (String(element.name || '').trim().length > 24) score -= 0.18;
  score -= Math.min(0.12, index * 0.005);
  return clampConfidence(score);
}

function actionSignalText(
  action: ReadPageCandidateAction,
  element: ReadPageInteractiveElement | undefined,
): string {
  return [
    element?.role,
    element?.name,
    element?.href,
    action.matchReason,
    ...action.locatorChain.map((item) => item.value),
  ]
    .filter(Boolean)
    .join(' ');
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}

function toExecutableAction(
  actions: readonly ReadPageCandidateAction[],
): ReadPageExecutableAction | undefined {
  const action = actions
    .filter((item) => item && (item.actionType === 'click' || item.actionType === 'fill'))
    .sort((left, right) => {
      const leftCss = left.locatorChain.some((locator) => locator.type === 'css') ? 1 : 0;
      const rightCss = right.locatorChain.some((locator) => locator.type === 'css') ? 1 : 0;
      if (leftCss !== rightCss) return rightCss - leftCss;
      return (right.confidence ?? 0) - (left.confidence ?? 0);
    })[0];
  if (!action) return undefined;
  return {
    candidateActionId: action.id,
    actionType: action.actionType,
    targetRef: action.targetRef,
    locatorChain: action.locatorChain,
    toolName: action.actionType === 'fill' ? 'chrome_fill_or_select' : 'chrome_click_element',
    toolArgs: {
      candidateAction: {
        id: action.id,
        actionType: action.actionType,
        targetRef: action.targetRef,
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
