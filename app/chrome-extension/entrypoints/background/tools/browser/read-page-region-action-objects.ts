import type {
  ReadPageCandidateAction,
  ReadPageExecutableAction,
  ReadPageInteractiveElement,
  ReadPageRegionObject,
  ReadPageRegionType,
} from '@tabrix/shared';
import {
  classifyAccountMenuTargetIntent,
  classifySensitiveOperationText,
  safeAiOperationLabel,
} from './read-page-perception-neutral';
import { classifyRegionText } from './read-page-region-semantics';

export function buildCandidateActionSignalRegionObjects(params: {
  candidateActions: readonly ReadPageCandidateAction[];
  interactiveByRef: Map<string, ReadPageInteractiveElement>;
  representedObjectIds: Set<string>;
}): Array<{ regionType: ReadPageRegionType; object: ReadPageRegionObject }> {
  const objects: Array<{ regionType: ReadPageRegionType; object: ReadPageRegionObject }> = [];
  for (const action of params.candidateActions) {
    const targetRef = String(action.targetRef || '').trim();
    if (!targetRef || params.representedObjectIds.has(targetRef)) continue;
    const element = params.interactiveByRef.get(targetRef);
    const text = actionSignalText(action, element);
    const regionType = classifyRegionText(text);
    if (regionType === 'unknown') continue;
    const sensitiveKind = classifySensitiveOperationText(text) ?? 'account';
    const accountIntent = classifyAccountMenuTargetIntent(text);
    objects.push({
      regionType,
      object: {
        objectId: targetRef,
        label: element?.name || safeAiOperationLabel(sensitiveKind),
        role: element?.role,
        valueState: element?.valueState,
        actionTypes: [action.actionType],
        targetability: action.locatorChain.length > 0 ? 'locator_chain' : 'target_ref',
        confidence: clampConfidence(action.confidence || 0.56),
        reason:
          regionType === 'account'
            ? `candidate_action_${accountIntent}_signal`
            : 'candidate_action_region_signal',
        primaryAction: toExecutableAction(action),
      },
    });
  }
  return objects;
}

export function buildExploratoryActionRegionObjects(params: {
  candidateActions: readonly ReadPageCandidateAction[];
  interactiveByRef: Map<string, ReadPageInteractiveElement>;
  representedObjectIds: Set<string>;
}): ReadPageRegionObject[] {
  const exploratoryRoles = new Set(['button', 'link', 'menuitem', 'tab']);
  const objects: ReadPageRegionObject[] = [];
  const exploratoryActions = params.candidateActions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => {
      const targetRef = String(action.targetRef || '').trim();
      if (!targetRef || params.representedObjectIds.has(targetRef)) return false;
      if (action.actionType !== 'click') return false;
      const element = params.interactiveByRef.get(targetRef);
      if (classifySensitiveOperationText(actionSignalText(action, element))) return false;
      const role = String(element?.role || '').toLowerCase();
      return exploratoryRoles.has(role);
    })
    .sort((left, right) => {
      const leftScore = scoreExploratoryAction(left.action, params.interactiveByRef);
      const rightScore = scoreExploratoryAction(right.action, params.interactiveByRef);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return left.index - right.index;
    });

  for (const { action } of exploratoryActions) {
    const targetRef = String(action.targetRef || '').trim();
    const element = params.interactiveByRef.get(targetRef);
    const role = String(element?.role || '').toLowerCase();

    objects.push({
      objectId: targetRef,
      label: 'unlabeled clickable control',
      role: role || undefined,
      valueState: element?.valueState,
      actionTypes: ['click'],
      targetability: action.locatorChain.length > 0 ? 'locator_chain' : 'target_ref',
      confidence: clampConfidence(Math.min(action.confidence || 0.56, 0.6)),
      reason: 'targetable_unclassified_action_control',
      primaryAction: toExecutableAction(action),
    });
    if (objects.length >= 3) break;
  }
  return objects;
}

export function scoreCandidateActionForRegion(
  regionType: ReadPageRegionType,
  action: ReadPageCandidateAction,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): number {
  if (regionType === 'unknown') return scoreExploratoryAction(action, interactiveByRef);
  const element = interactiveByRef.get(action.targetRef);
  const text = `${regionType} ${actionSignalText(action, element)}`;

  let score = Number(action.confidence || 0);
  if (regionType === 'account') {
    const intent = classifyAccountMenuTargetIntent(text);
    if (intent === 'menu_trigger' || intent === 'logout_action') score += 2.2;
    else if (intent === 'auth_trigger') score += 1.8;
    else if (intent === 'account_state') score += 0.8;
    else if (intent === 'profile_route') score -= 0.5;
  }
  if (
    regionType === 'menu' &&
    /\b(menu|more|settings?|expand|dropdown)\b|菜单|更多|设置|展开/i.test(text)
  ) {
    score += 1;
  }
  if (
    regionType === 'modal' &&
    /\b(dialog|modal|popup|login|auth|authorize)\b|弹窗|对话框|登录|授权|验证/i.test(text)
  ) {
    score += 1;
  }
  if (
    regionType === 'qr_code' &&
    /\b(qr|qrcode|scan|scan code|refresh)\b|二维码|扫码|扫一扫|刷新/i.test(text)
  ) {
    score += 1;
  }
  if (action.locatorChain.length > 0) score += 0.15;
  return score;
}

export function actionSignalText(
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

function toExecutableAction(action: ReadPageCandidateAction): ReadPageExecutableAction | undefined {
  if (action.actionType !== 'click' && action.actionType !== 'fill') return undefined;
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
        locatorChain: action.locatorChain,
        ...(action.intent ? { intent: action.intent } : {}),
      },
    },
    claimBoundary:
      'primaryAction is an execution hint only; success still requires Tabrix tool result and post-action verification',
  };
}

function scoreExploratoryAction(
  action: ReadPageCandidateAction,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): number {
  const element = interactiveByRef.get(action.targetRef);
  const text = actionSignalText(action, element);

  let score = Number(action.confidence || 0);
  if (
    /\b(menu|more|settings?|expand|dropdown|profile|account|avatar|user|login|log in|sign in|signin)\b/i.test(
      text,
    )
  ) {
    score += 1.5;
  }
  if (/菜单|更多|设置|展开|账号|账户|用户|头像|个人|登录|登陆/i.test(text)) {
    score += 1.5;
  }
  if (/\b(log[ -]?out|sign[ -]?out)\b|退出|注销/i.test(text)) {
    score += 1;
  }
  if (/\b(qr|qrcode|scan|scan code|auth|authorize)\b|二维码|扫码|扫一扫|授权|验证/i.test(text)) {
    score += 0.75;
  }
  if (action.locatorChain.length > 0) score += 0.25;
  return score;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}
