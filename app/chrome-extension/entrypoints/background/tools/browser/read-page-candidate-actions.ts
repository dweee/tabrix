import type {
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
  ReadPageInteractiveElement,
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
  if (actionType !== 'click') return undefined;
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  const source = String(element.matchSource || '').toLowerCase();

  if (!name || source === 'placeholder') return undefined;
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
  return undefined;
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
  return seeds;
}
