import type {
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
  ReadPageInteractiveElement,
  ReadPageVisibleRegionRows,
} from '@tabrix/shared';

export type CandidateActionSeed = ReadPageCandidateAction;

function buildRefSelectorMap(refMap: any[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof item?.ref === 'string' ? item.ref.trim() : '';
    const selector = typeof item?.selector === 'string' ? item.selector.trim() : '';
    if (!ref || !selector) continue;
    map.set(ref, selector);
  }
  return map;
}

function scoreCandidateElementPriority(element: ReadPageInteractiveElement, index: number): number {
  const ref = String(element.ref || '');
  const name = String(element.name || '').trim();
  let score = 0;
  if (ref.startsWith('ref_text_menu_')) score += 120;
  if (/\b(menu|more|settings?|logout|sign out|log out)\b|菜单|更多|设置|退出|注销/i.test(name)) {
    score += 80;
  }
  if (
    /^(home|dashboard|messages?|notifications?|publish|create|live|profile|account|me|my|about|首页|消息|通知|发布|直播|我的?|个人中心|关于我们)$/i.test(
      name,
    )
  ) {
    score += 32;
  }
  return score - Math.min(index, 100) / 1000;
}

function inferCandidateActionIntent(
  element: ReadPageInteractiveElement,
  actionType: 'click' | 'fill',
): ReadPageCandidateAction['intent'] | undefined {
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  const source = String(element.matchSource || '').toLowerCase();

  if (!name && role !== 'searchbox') return undefined;
  if (actionType === 'fill') {
    if (role === 'searchbox' || isSearchActionText(name)) return 'search.enter_query';
    return undefined;
  }
  if (source === 'placeholder') return undefined;
  if (/同意并继续|确认同意|我同意|agree and continue|accept and continue/i.test(name)) {
    return 'auth.confirm_agreement';
  }
  if (
    /获取验证码|发送验证码|重新发送|重发验证码|get code|send code|request code|resend code/i.test(
      name,
    )
  ) {
    return 'auth.request_otp';
  }
  if (
    role === 'checkbox' ||
    /我已阅读|阅读并同意|用户协议|隐私政策|服务协议|terms|privacy|policy|agreement/i.test(name)
  ) {
    return 'auth.accept_terms';
  }
  if (/登录|log\s*in|sign\s*in/i.test(name)) return 'auth.submit_login';
  if (isSearchActionText(name)) return 'search.submit';
  if (isOpenDetailActionText(name)) return 'content.open_detail';
  return undefined;
}

function isSearchActionText(value: string): boolean {
  if (!value) return false;
  if (
    /\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|password|credential)\b|登录|登陆|授权|验证|密码|账号/i.test(
      value,
    )
  ) {
    return false;
  }
  return /\b(search|find|query)\b|搜索|查找/i.test(value);
}

function isOpenDetailActionText(value: string): boolean {
  if (!value) return false;
  if (isSearchActionText(value)) return false;
  if (
    /\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|password|credential)\b|登录|登陆|授权|验证|密码|账号/i.test(
      value,
    )
  ) {
    return false;
  }
  return /\b(details?|view details?|read more|learn more)\b|查看详情|详情|阅读全文|阅读更多/i.test(
    value,
  );
}

function mayContainSensitiveAuthText(value: string): boolean {
  return (
    /\b(password|passcode|credential|cookie|token|authorization|secret|otp|sms|verification\s*code|one[-\s]?time\s*code)\b/i.test(
      value,
    ) ||
    /密码|验证码|动态码|短信|授权码|手机号|手机号码|电话号码|账号|账户|身份证|令牌/i.test(value) ||
    /(?:\+?\d[\s-]?){6,}/.test(value)
  );
}

function buildLocatorChain(params: {
  element: ReadPageInteractiveElement;
  selector: string | undefined;
  actionType: 'click' | 'fill';
  intent: ReadPageCandidateAction['intent'] | undefined;
}): ReadPageCandidateActionLocator[] {
  const locatorChain: ReadPageCandidateActionLocator[] = [
    { type: 'ref', value: params.element.ref },
  ];
  const name = String(params.element.name || '').trim();
  const source = String(params.element.matchSource || '').toLowerCase();
  const isAuthIntent = typeof params.intent === 'string' && params.intent.startsWith('auth.');
  const shouldRedactName =
    params.actionType === 'fill' ||
    isAuthIntent ||
    source === 'placeholder' ||
    mayContainSensitiveAuthText(name);

  if (name && !shouldRedactName) {
    locatorChain.push({ type: 'aria', value: name });
  }
  if (params.selector) {
    locatorChain.push({ type: 'css', value: params.selector });
  }
  return locatorChain;
}

export function buildCandidateActions(
  interactiveElements: ReadPageInteractiveElement[],
  refMap: any[],
  options: { visibleRegionRows?: ReadPageVisibleRegionRows | null } = {},
): CandidateActionSeed[] {
  const selectorMap = buildRefSelectorMap(refMap);
  const clickRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'switch']);
  const fillRoles = new Set(['textbox', 'searchbox', 'combobox']);
  const primaryKeywords =
    /(submit|save|continue|next|confirm|login|sign in|search|checkout|send code|get code|request code|提交|保存|继续|下一步|确认|登录|搜索|获取验证码|发送验证码|重新发送|同意|协议)/i;

  const seeds: CandidateActionSeed[] = [];
  const prioritizedElements = [...interactiveElements]
    .map((element, index) => ({
      element,
      index,
      score: scoreCandidateElementPriority(element, index),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ element }) => element);

  for (const element of prioritizedElements) {
    if (!element.ref) continue;
    if (!isExecutableCandidateElement(element)) continue;
    const role = String(element.role || '').toLowerCase();
    const name = String(element.name || '').trim();
    let actionType: 'click' | 'fill' | null = null;

    if (clickRoles.has(role)) actionType = 'click';
    else if (fillRoles.has(role)) actionType = 'fill';
    if (!actionType) continue;

    const selector = selectorMap.get(element.ref);

    const isPrimary = primaryKeywords.test(name);
    const confidence = isPrimary ? 0.93 : actionType === 'fill' ? 0.68 : 0.72;
    const matchReason = isPrimary
      ? 'primary action inferred from interactive label'
      : actionType === 'fill'
        ? 'form input candidate from structured snapshot'
        : 'interactive clickable candidate from structured snapshot';
    const intent = inferCandidateActionIntent(element, actionType);
    const locatorChain = buildLocatorChain({ element, selector, actionType, intent });

    const safeRef = element.ref.replace(/[^a-zA-Z0-9_]/g, '_');
    seeds.push({
      id: `ca_${actionType}_${safeRef}`,
      actionType,
      targetRef: element.ref,
      confidence: Number(confidence.toFixed(2)),
      matchReason,
      locatorChain,
      ...(intent ? { intent } : {}),
    });
    if (seeds.length >= 20) break;
  }
  return bindVisibleRegionRowsToDetailActions(
    seeds,
    interactiveElements,
    selectorMap,
    options.visibleRegionRows,
  );
}

function bindVisibleRegionRowsToDetailActions(
  seeds: CandidateActionSeed[],
  interactiveElements: ReadPageInteractiveElement[],
  selectorMap: Map<string, string>,
  visibleRegionRows: ReadPageVisibleRegionRows | null | undefined,
): CandidateActionSeed[] {
  if (!visibleRegionRows?.visibleRegionRowsUsed || visibleRegionRows.rows.length === 0) {
    return seeds;
  }

  const elementByRef = new Map<string, ReadPageInteractiveElement>();
  for (const element of interactiveElements) {
    if (element.ref) elementByRef.set(element.ref, element);
  }
  const seedByTargetRef = new Map<string, CandidateActionSeed>();
  for (const seed of seeds) {
    if (seed.actionType === 'click' && seed.targetRef) {
      seedByTargetRef.set(seed.targetRef, seed);
    }
  }

  const output = [...seeds];
  for (const row of visibleRegionRows.rows.slice(0, 8)) {
    const targetRef = String(row.targetRef || '').trim();
    if (!targetRef) continue;
    const element = elementByRef.get(targetRef);
    if (!isClickableContentTarget(element)) continue;

    const existing = seedByTargetRef.get(targetRef);
    if (existing) {
      if (!isProtectedIntent(existing.intent)) {
        existing.intent = 'content.open_detail';
        existing.confidence = Number(
          Math.max(existing.confidence || 0, row.confidence || 0, 0.82).toFixed(2),
        );
        existing.matchReason = 'content row target inferred from visible region rows';
      }
      continue;
    }

    if (output.length >= 20) continue;
    const safeRef = targetRef.replace(/[^a-zA-Z0-9_]/g, '_');
    const selector = selectorMap.get(targetRef);
    const locatorChain: ReadPageCandidateActionLocator[] = [{ type: 'ref', value: targetRef }];
    if (selector) locatorChain.push({ type: 'css', value: selector });
    const action: CandidateActionSeed = {
      id: `ca_click_${safeRef}`,
      actionType: 'click',
      targetRef,
      confidence: Number(Math.max(row.confidence || 0, 0.78).toFixed(2)),
      matchReason: 'content row target inferred from visible region rows',
      locatorChain,
      intent: 'content.open_detail',
    };
    output.push(action);
    seedByTargetRef.set(targetRef, action);
  }
  return output;
}

function isClickableContentTarget(element: ReadPageInteractiveElement | undefined): boolean {
  if (!element?.ref) return false;
  if (!isExecutableCandidateElement(element)) return false;
  const role = String(element.role || '').toLowerCase();
  if (!new Set(['link', 'button', 'menuitem']).has(role)) return false;
  const source = String(element.matchSource || '').toLowerCase();
  if (source === 'placeholder') return false;
  return true;
}

function isExecutableCandidateElement(element: ReadPageInteractiveElement): boolean {
  const actionability = String(element.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const disabled = Boolean((element as { disabled?: boolean }).disabled);
  const ariaDisabled = String(
    (element as { ariaDisabled?: string }).ariaDisabled || '',
  ).toLowerCase();
  if (disabled || ariaDisabled === 'true') return false;
  return true;
}

function isProtectedIntent(intent: ReadPageCandidateAction['intent'] | undefined): boolean {
  return Boolean(intent && (/^auth\./.test(intent) || /^search\./.test(intent)));
}
