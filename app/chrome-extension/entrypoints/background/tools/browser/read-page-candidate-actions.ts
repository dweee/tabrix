import type { NodeVisibilityProbe } from '@/utils/cdp-page-sensing';
import type {
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
  ReadPageCDPSensingSummary,
  ReadPageFileInputBinding,
  ReadPageInteractiveElement,
  ReadPageVisibleRegionRows,
} from '@tabrix/shared';

export type CandidateActionSeed = ReadPageCandidateAction;

const MAX_CANDIDATE_ACTIONS = 20;
const FILTER_OPEN_LABEL_PATTERN = /^(筛选|已筛选|过滤|filter|filters|filtered|排序|sort)$/i;
const SEARCH_CATEGORY_LABEL_PATTERN = /^(全部|图文|视频|用户|all|images?|photos?|videos?|users?)$/i;
const FILTER_PANEL_LABEL_PATTERN =
  /^(综合|最新|最热|最多点赞|最多评论|最多收藏|不限|一天内|一周内|半年内|已看过|未看过|已关注|同城|附近|重置|收起|清除|确认|应用|all|latest|popular|any|most\s*(liked|commented|saved|collected)|reset|clear|confirm|apply)$/i;
const FILTER_PANEL_CONTENT_TYPE_LABEL_PATTERN =
  /^(图文|图片|视频|文章|image\s*text|images?|photos?|videos?|articles?)$/i;
const FILTER_TIME_RANGE_LABEL_PATTERN =
  /^(不限|一天内|一周内|半年内|any|within\s*(one|1)\s*day|within\s*(one|1)\s*week|within\s*(six|6)\s*months?)$/i;
const SEARCH_TOOLBAR_VERTICAL_BAND_PX = 180;
const SEARCH_INPUT_IDENTITY_PATTERN = /\b(search|query)\b|搜索|查找/i;
const LOW_VALUE_NAV_LINK_PATTERN =
  /^(关于我们|关于|营业执照|备案|沪ICP备|京ICP备|粤ICP备|隐私政策|隐私|用户协议|服务协议|使用条款|社区规范|帮助中心|联系我们|加入我们|广告合作|举报|投诉|copyright|privacy|terms|agreement|license|licenses?|legal|about|help|contact|careers?)$/i;
type CdpAxCandidate = NonNullable<
  NonNullable<ReadPageCDPSensingSummary['accessibility']>['objectCandidates']
>[number] & {
  /** Visibility probe attached by CDP sensing layer; not in shared contract. */
  visibilityProbe?: NodeVisibilityProbe;
};

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

function simpleSelectorLooksStableForCdpAx(selector: string): boolean {
  const trimmed = selector.trim();
  if (!trimmed) return false;
  if (/^(button|input|a|select|textarea|div|span)$/i.test(trimmed)) return false;
  return (
    /^#[A-Za-z0-9_-]+$/.test(trimmed) ||
    /\[(data-testid|data-test|data-cy|aria-label|name|role|type)=/i.test(trimmed) ||
    /^(input|textarea|select|button|div|span|a|svg)\.[A-Za-z_][A-Za-z0-9_-]*(?:\.[A-Za-z_][A-Za-z0-9_-]*)?$/i.test(
      trimmed,
    )
  );
}

function selectorLooksStableForCdpAx(selector: string): boolean {
  const trimmed = selector.trim();
  if (simpleSelectorLooksStableForCdpAx(trimmed)) return true;
  const relationalMatch = trimmed.match(/^(.+):has\(([^()]+)\)\s+(.+)$/);
  if (!relationalMatch) return false;
  return relationalMatch.slice(1).every((part) => simpleSelectorLooksStableForCdpAx(part));
}

function buildCdpAxInteractiveElements(input: {
  candidates?: readonly CdpAxCandidate[];
  viewport?: { width: number | null; height: number | null } | null;
}): { elements: ReadPageInteractiveElement[]; refMap: Array<{ ref: string; selector: string }> } {
  const elements: ReadPageInteractiveElement[] = [];
  const refMap: Array<{ ref: string; selector: string }> = [];
  const seenRefs = new Set<string>();

  for (const [index, candidate] of (input.candidates ?? []).slice(0, 30).entries()) {
    const role = String(candidate.role || '')
      .trim()
      .toLowerCase();
    const label = String(candidate.label || role || '').trim();
    const selector = String(candidate.locator?.cssSelector || '').trim();
    if (!role || !label || !selectorLooksStableForCdpAx(selector)) continue;
    const disabled = candidate.state?.disabled === true;
    const canClick =
      role === 'button' ||
      role === 'link' ||
      role === 'menuitem' ||
      role === 'tab' ||
      role === 'option' ||
      role === 'checkbox' ||
      role === 'switch' ||
      candidate.actionTypes?.some((action) => /^(click|tap|press|open)$/i.test(action));
    const canFill =
      role === 'textbox' ||
      role === 'searchbox' ||
      role === 'combobox' ||
      candidate.actionTypes?.some((action) => /^(focus|setvalue)$/i.test(action));
    const canObserveDisabledControl =
      disabled &&
      (role === 'button' ||
        role === 'link' ||
        role === 'menuitem' ||
        role === 'tab' ||
        role === 'option');
    if (!canClick && !canFill && !canObserveDisabledControl) continue;

    const stableId =
      candidate.locator?.backendDOMNodeId !== undefined
        ? `backend_${candidate.locator.backendDOMNodeId}`
        : typeof candidate.locator?.axNodeId === 'string'
          ? candidate.locator.axNodeId
          : `${role}_${index}`;
    const safeId = stableId.replace(/[^a-zA-Z0-9_]/g, '_');
    const source = candidate.locator?.source === 'cdp_dom' ? 'cdp_dom' : 'cdp_ax';
    const ref = `ref_fallback_${source}_${safeId}`;
    if (seenRefs.has(ref)) continue;
    seenRefs.add(ref);

    const bounds = candidate.locator?.visualBounds;
    const viewportWidth = input.viewport?.width;
    const viewportHeight = input.viewport?.height;
    const hasBounds =
      bounds &&
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0;
    const inViewport =
      hasBounds && typeof viewportWidth === 'number' && typeof viewportHeight === 'number'
        ? bounds.x + bounds.width > 0 &&
          bounds.y + bounds.height > 0 &&
          bounds.x < viewportWidth &&
          bounds.y < viewportHeight
        : true;

    const visibilityProbe = candidate.visibilityProbe;
    elements.push({
      ref,
      role,
      name: label,
      selector,
      matchSource: source,
      actionability:
        disabled || visibilityProbe?.domVisible === false || visibilityProbe?.inViewport === false
          ? 'not_actionable'
          : inViewport
            ? 'actionable'
            : 'not_actionable',
      visibility: {
        source: 'cdp',
        domVisible: visibilityProbe?.domVisible ?? true,
        inViewport: visibilityProbe?.inViewport ?? inViewport,
        centerHitTarget:
          typeof visibilityProbe?.centerHitTarget === 'boolean'
            ? visibilityProbe.centerHitTarget
            : null,
        occluded: typeof visibilityProbe?.occluded === 'boolean' ? visibilityProbe.occluded : null,
        reason:
          visibilityProbe?.reason ?? (hasBounds ? `${source}_box_model` : `${source}_locator_only`),
      },
      ...(visibilityProbe?.valueState ? { valueState: visibilityProbe.valueState } : {}),
      ...(hasBounds ? { rect: bounds } : {}),
    });
    refMap.push({ ref, selector });
  }

  return { elements, refMap };
}

function scoreCandidateElementPriority(
  element: ReadPageInteractiveElement,
  index: number,
  contentTargetRefs: ReadonlySet<string> = new Set(),
): number {
  const ref = String(element.ref || '');
  const name = String(element.name || '').trim();
  let score = 0;
  if (contentTargetRefs.has(ref)) score += 220;
  if (isPublishActionText(name)) score += 136;
  if (isPublishMediaTypeText(name)) score += 132;
  if (ref.startsWith('ref_text_menu_')) score += 120;
  if (ref.startsWith('ref_text_filter_panel_')) score += 260;
  if (ref.startsWith('ref_text_search_toolbar_')) score += 112;
  if (ref.startsWith('ref_text_control_')) score += 110;
  if (FILTER_PANEL_LABEL_PATTERN.test(name) || FILTER_PANEL_CONTENT_TYPE_LABEL_PATTERN.test(name)) {
    score += 64;
  }
  const visibility = element.visibility;
  if (visibility?.domVisible === true) score += 18;
  if (visibility?.inViewport === true) score += 18;
  if (visibility?.centerHitTarget === true) score += 24;
  if (visibility?.occluded === true) score -= 180;
  if (visibility?.domVisible === false || visibility?.inViewport === false) score -= 140;
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

function isLowValueNavigationLink(element: ReadPageInteractiveElement): boolean {
  const role = String(element.role || '').toLowerCase();
  if (role !== 'link') return false;
  const ref = String(element.ref || '');
  if (ref && ref.startsWith('ref_text_')) return false;
  const name = String(element.name || '')
    .replace(/\s+/g, ' ')
    .trim();
  const href = String((element as { href?: unknown }).href || '').toLowerCase();
  const selector = String((element as { selector?: unknown }).selector || '').toLowerCase();
  const className = String((element as { className?: unknown }).className || '').toLowerCase();
  const locationHint = `${href} ${selector} ${className}`;

  if (LOW_VALUE_NAV_LINK_PATTERN.test(name)) return true;
  if (
    /(privacy|terms|agreement|legal|license|copyright|beian|icp|about|contact|help|footer)/i.test(
      locationHint,
    )
  ) {
    return true;
  }
  if (/备案|ICP备|营业执照|隐私|协议|条款|版权|关于我们|联系我们|帮助中心/.test(name)) return true;
  return false;
}

function inferCandidateActionIntent(
  element: ReadPageInteractiveElement,
  actionType: 'click' | 'fill',
  context: { interactiveElements: readonly ReadPageInteractiveElement[] },
): ReadPageCandidateAction['intent'] | undefined {
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  const source = String(element.matchSource || '').toLowerCase();

  if (!name && !isSearchInputElement(element)) return undefined;
  if (actionType === 'fill') {
    if (isSearchInputElement(element)) return 'search.enter_query';
    return undefined;
  }
  if (isLowValueNavigationLink(element)) return undefined;
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
  if (
    /二维码.*(刷新|重新)|刷新.*二维码|点击刷新|refresh\s*(qr|code)?|reload\s*(qr|code)?/i.test(name)
  ) {
    return 'auth.refresh_qr';
  }
  if (FILTER_OPEN_LABEL_PATTERN.test(name)) return 'filter.open';
  if (SEARCH_CATEGORY_LABEL_PATTERN.test(name)) {
    if (isSearchToolbarCategoryElement(element, context.interactiveElements)) {
      return 'search.category_select';
    }
    return isFilterPanelOptionElement(element, context.interactiveElements)
      ? 'filter.option_select'
      : undefined;
  }
  if (FILTER_TIME_RANGE_LABEL_PATTERN.test(name)) return 'filter.time_range_select';
  if (isFilterPanelOptionElement(element, context.interactiveElements)) {
    return FILTER_TIME_RANGE_LABEL_PATTERN.test(name)
      ? 'filter.time_range_select'
      : 'filter.option_select';
  }
  if (isSearchActionText(name)) return 'search.submit';
  if (isPublishEntryActionText(name)) return 'publish.open_entry';
  if (isPublishUploadDropzoneText(name)) return 'publish.upload_media';
  if (isPublishMediaTypeText(name)) return 'publish.select_media_type';
  if (isPublishUploadActionText(name)) return 'publish.upload_media';
  if (isPublishSubmitActionText(name)) return 'publish.submit';
  if (isOpenDetailActionText(name)) return 'content.open_detail';
  return undefined;
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
    .map((value) =>
      String(value ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(' ');
}

function isSearchInputElement(element: ReadPageInteractiveElement): boolean {
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  if (role === 'searchbox' || isSearchActionText(name)) return true;
  if (role !== 'textbox' && role !== 'combobox') return false;
  return SEARCH_INPUT_IDENTITY_PATTERN.test(searchInputIdentityText(element));
}

function rectTop(element: ReadPageInteractiveElement): number | undefined {
  const y = element.rect?.y;
  return typeof y === 'number' && Number.isFinite(y) ? y : undefined;
}

function isSearchToolbarAnchor(element: ReadPageInteractiveElement): boolean {
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  return (
    (role === 'searchbox' && isSearchActionText(name || role)) ||
    FILTER_OPEN_LABEL_PATTERN.test(name) ||
    SEARCH_CATEGORY_LABEL_PATTERN.test(name)
  );
}

function isSearchToolbarCategoryElement(
  element: ReadPageInteractiveElement,
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

function isFilterPanelOptionElement(
  element: ReadPageInteractiveElement,
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  const name = String(element.name || '').trim();
  if (!name) return false;
  if (
    !FILTER_PANEL_LABEL_PATTERN.test(name) &&
    !FILTER_PANEL_CONTENT_TYPE_LABEL_PATTERN.test(name)
  ) {
    return false;
  }
  const ref = String(element.ref || '');
  if (ref.startsWith('ref_text_filter_panel_')) return true;
  const role = String(element.role || '').toLowerCase();
  if (role === 'link' || role === 'textbox' || role === 'searchbox' || role === 'combobox') {
    return false;
  }
  if (
    SEARCH_CATEGORY_LABEL_PATTERN.test(name) &&
    isSearchToolbarCategoryElement(element, interactiveElements)
  ) {
    return false;
  }
  return interactiveElements.some((item) =>
    FILTER_OPEN_LABEL_PATTERN.test(String(item.name || '').trim()),
  );
}

function isRecoveredTextActionElement(element: ReadPageInteractiveElement): boolean {
  const role = String(element.role || '').toLowerCase();
  if (role !== 'text_action' && role !== 'button') return false;
  const ref = String(element.ref || '');
  return (
    ref.startsWith('ref_text_search_toolbar_') ||
    ref.startsWith('ref_text_filter_panel_') ||
    ref.startsWith('ref_text_control_')
  );
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

function isPublishActionText(value: string): boolean {
  return (
    isPublishEntryActionText(value) ||
    isPublishMediaTypeText(value) ||
    isPublishUploadActionText(value) ||
    isPublishSubmitActionText(value)
  );
}

function isPublishMediaTypeText(value: string): boolean {
  if (!value) return false;
  return /\b(image\s*text|video|videos?)\b|上传图文|图文|上传视频|视频/i.test(value);
}

function isPublishUploadActionText(value: string): boolean {
  if (!value) return false;
  return /\b(upload|choose\s*file|select\s*file|drag)\b|点击上传|拖拽.*上传|选择文件|上传素材|上传图片|上传视频/i.test(
    value,
  );
}

function isPublishUploadDropzoneText(value: string): boolean {
  if (!value) return false;
  return /\b(choose\s*file|select\s*file|drag)\b|点击上传|拖拽.*上传|选择文件|上传素材/i.test(
    value,
  );
}

function isPublishSubmitActionText(value: string): boolean {
  if (!value) return false;
  return /\b(publish|post|submit)\b|立即发布|发布作品/i.test(value);
}

function isPublishEntryActionText(value: string): boolean {
  if (!value) return false;
  return /\b(create\s*(post|note)|new\s*(post|note))\b|发布笔记|写笔记|创建笔记|^发布$/i.test(
    value,
  );
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
  const compact = String(value || '').replace(/\s+/g, '');
  const hasMixedAccountLikeToken =
    /[A-Za-z]/.test(compact) && /\d/.test(compact) && /[A-Za-z0-9]{6,}/.test(compact);
  return (
    hasMixedAccountLikeToken ||
    /\b(password|passcode|credential|cookie|token|authorization|secret|otp|sms|verification\s*code|one[-\s]?time\s*code)\b/i.test(
      value,
    ) ||
    /密码|验证码|动态码|短信|授权码|手机号|手机号码|电话号码|账号|账户|身份证|令牌/i.test(value) ||
    /(?:\+?\d[\s-]?){6,}/.test(value)
  );
}

function xpathStringLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  return `concat(${value
    .split("'")
    .map((part) => `'${part}'`)
    .join(`, "'", `)})`;
}

function buildAccessibleNameXPath(name: string): string {
  const literal = xpathStringLiteral(name);
  return `//*[self::button or self::a or self::span or self::div or self::label or @role='button' or @role='menuitem' or @role='option' or @role='tab'][@aria-label=${literal} or @title=${literal} or @alt=${literal} or (normalize-space(.)=${literal} and not(.//*[normalize-space(.)=${literal}])) or (contains(normalize-space(.), ${literal}) and not(.//*[contains(normalize-space(.), ${literal})]))]`;
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
    if (params.actionType === 'click' && isRecoveredTextActionElement(params.element)) {
      locatorChain.push({ type: 'xpath', value: buildAccessibleNameXPath(name) });
    }
  }
  if (params.selector) {
    locatorChain.push({ type: 'css', value: params.selector });
  }
  return locatorChain;
}

function getElementSelector(
  element: ReadPageInteractiveElement | undefined,
  selectorMap: Map<string, string>,
): string | undefined {
  if (!element?.ref) return undefined;
  const mapped = selectorMap.get(element.ref);
  if (mapped) return mapped;
  const selector = typeof element.selector === 'string' ? element.selector.trim() : '';
  return selector || undefined;
}

function normalizeCrossSourceSelector(selector: unknown): string {
  return String(selector || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCrossSourceName(name: unknown): string {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function buildCrossSourceMatchKeys(element: ReadPageInteractiveElement): string[] {
  const role = String(element.role || '')
    .trim()
    .toLowerCase();
  const name = normalizeCrossSourceName(element.name);
  if (!role || !name) return [];
  const fallbackKey = `fallback:${role}::${name}`;
  const selector = normalizeCrossSourceSelector(element.selector);
  return selector ? [`primary:${selector}::${role}::${name}`, fallbackKey] : [fallbackKey];
}

function mergeCrossSourceVisibility(
  domElement: ReadPageInteractiveElement,
  cdpAxElement: ReadPageInteractiveElement,
): ReadPageInteractiveElement['visibility'] {
  const domVisibility = domElement.visibility;
  const cdpVisibility = cdpAxElement.visibility;
  if (!cdpVisibility) return domVisibility;
  return {
    source: cdpVisibility.source ?? domVisibility?.source ?? 'dom',
    domVisible: cdpVisibility.domVisible ?? domVisibility?.domVisible ?? true,
    inViewport: cdpVisibility.inViewport ?? domVisibility?.inViewport ?? true,
    centerHitTarget: cdpVisibility.centerHitTarget ?? domVisibility?.centerHitTarget ?? null,
    occluded: cdpVisibility.occluded ?? domVisibility?.occluded ?? null,
    reason: cdpVisibility.reason ?? domVisibility?.reason,
  };
}

function mergeCrossSourceActionability(
  domElement: ReadPageInteractiveElement,
  cdpAxElement: ReadPageInteractiveElement,
): ReadPageInteractiveElement['actionability'] {
  const rank = new Map([
    ['blocked', 0],
    ['not_actionable', 1],
    ['actionable', 2],
  ]);
  const domActionability = normalizeActionability(domElement.actionability);
  const cdpActionability = normalizeActionability(cdpAxElement.actionability);
  const domRank = rank.get(domActionability) ?? Number.MAX_SAFE_INTEGER;
  const cdpRank = rank.get(cdpActionability) ?? Number.MAX_SAFE_INTEGER;
  return domRank <= cdpRank ? domElement.actionability : cdpAxElement.actionability;
}

function deduplicateCrossSourceElements(input: {
  domElements: ReadPageInteractiveElement[];
  cdpAxElements: ReadPageInteractiveElement[];
}): {
  merged: ReadPageInteractiveElement[];
  mergedRefs: Set<string>;
} {
  const cdpAxByKey = new Map<string, ReadPageInteractiveElement[]>();
  for (const element of input.cdpAxElements) {
    for (const key of buildCrossSourceMatchKeys(element)) {
      const existing = cdpAxByKey.get(key) ?? [];
      cdpAxByKey.set(key, [...existing, element]);
    }
  }

  const matchedCdpRefs = new Set<string>();
  const mergedRefs = new Set<string>();
  const merged = input.domElements.map((domElement) => {
    const matchedCdpElement = buildCrossSourceMatchKeys(domElement)
      .flatMap((key) => cdpAxByKey.get(key) ?? [])
      .find((candidate) => !matchedCdpRefs.has(candidate.ref));
    if (!matchedCdpElement) return domElement;

    matchedCdpRefs.add(matchedCdpElement.ref);
    mergedRefs.add(domElement.ref);
    return {
      ...domElement,
      visibility: mergeCrossSourceVisibility(domElement, matchedCdpElement),
      actionability: mergeCrossSourceActionability(domElement, matchedCdpElement),
    };
  });

  const unmatchedCdpAx = input.cdpAxElements.filter((element) => !matchedCdpRefs.has(element.ref));
  return {
    merged: [...merged, ...unmatchedCdpAx],
    mergedRefs,
  };
}

function normalizeActionability(value: unknown): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (!normalized) return 'unknown';
  if (normalized === 'actionable') return 'actionable';
  if (normalized === 'not_actionable') return 'not_actionable';
  if (normalized === 'blocked') return 'blocked';
  return normalized;
}

function buildActionabilityReason(params: {
  element: ReadPageInteractiveElement;
  actionability: string;
  intent: ReadPageCandidateAction['intent'] | undefined;
}): string {
  const source =
    String(params.element.matchSource || 'structured_snapshot').trim() || 'structured_snapshot';
  const parts = [
    `source_element_actionability=${params.actionability}`,
    `source=${source}`,
    ...buildVisibilityReasonParts(params.element),
    'target_freshness=current_read_page_snapshot_only',
    `expected_delta=${buildExpectedPostActionDelta(params.intent)}`,
  ];
  if (params.intent === 'publish.submit') {
    parts.push('business_success_requires_required_fields_and_post_action_readback');
  } else if (params.intent === 'publish.open_entry') {
    parts.push('publish_entry_not_final_submit');
  } else if (params.intent === 'publish.upload_media') {
    parts.push('media_upload_requires_file_selection_or_upload_tool_evidence');
  } else {
    parts.push('business_success_not_proven_by_candidate_action');
  }
  return parts.join('; ');
}

function buildExpectedPostActionDelta(
  intent: ReadPageCandidateAction['intent'] | undefined,
): string {
  if (
    intent === 'search.submit' ||
    intent === 'search.category_select' ||
    intent === 'filter.open'
  ) {
    return 'search_refresh_or_scope_change';
  }
  if (intent === 'filter.option_select' || intent === 'filter.time_range_select') {
    return 'results_or_view_scope_update';
  }
  if (intent === 'content.open_detail') {
    return 'detail_navigation_or_content_state_change';
  }
  if (intent === 'publish.open_entry') {
    return 'publish_workflow_entry_progress';
  }
  if (intent === 'publish.select_media_type' || intent === 'publish.upload_media') {
    return 'media_upload_or_media_selector_progress';
  }
  if (intent === 'publish.submit') {
    return 'publish_submission_feedback_or_post_publish_state_change';
  }
  if (intent && intent.startsWith('auth.')) {
    return 'auth_surface_state_transition';
  }
  return 'page_or_object_state_change';
}

function buildActionTargetMatchReason(params: {
  baseReason: string;
  element: ReadPageInteractiveElement;
  selector: string | undefined;
  contentTargetRefs: ReadonlySet<string>;
}): string {
  const source =
    String(params.element.matchSource || 'structured_snapshot').trim() || 'structured_snapshot';
  const targetRef = String(params.element.ref || '').trim();
  const provenance = params.contentTargetRefs.has(targetRef)
    ? 'visible_region_row_target_ref'
    : source;
  const locatorSources = [
    'ref',
    ...(source && source !== 'structured_snapshot' ? [source] : []),
    ...(params.selector ? ['css'] : []),
  ];
  return [
    params.baseReason,
    `target_provenance=${provenance}`,
    `locator_sources=${Array.from(new Set(locatorSources)).join('+')}`,
    ...buildVisibilityReasonParts(params.element),
    'target_freshness=current_read_page_snapshot_only',
  ].join('; ');
}

function buildVisibilityReasonParts(element: ReadPageInteractiveElement): string[] {
  const visibility = element.visibility;
  if (!visibility) return [];
  const parts = [
    `visibility_source=${visibility.source || 'dom'}`,
    `dom_visible=${visibility.domVisible ? 'true' : 'false'}`,
    `in_viewport=${visibility.inViewport ? 'true' : 'false'}`,
  ];
  if (typeof visibility.centerHitTarget === 'boolean') {
    parts.push(`center_hit_target=${visibility.centerHitTarget ? 'true' : 'false'}`);
  }
  if (typeof visibility.occluded === 'boolean') {
    parts.push(`occluded=${visibility.occluded ? 'true' : 'false'}`);
  }
  if (visibility.reason) parts.push(`visibility_reason=${visibility.reason}`);
  return parts;
}

function buildIntentBoundary(
  intent: ReadPageCandidateAction['intent'] | undefined,
): string | undefined {
  if (intent === 'publish.open_entry') {
    return 'This is a publish-entry or publish-section candidate, not final publish submission.';
  }
  if (intent === 'publish.upload_media') {
    return 'This is an upload-entry candidate only; media upload success requires file-selection/upload evidence and a fresh post-action readback.';
  }
  if (intent === 'publish.submit') {
    return 'This is only a browser-action candidate; publish success requires required-field evidence and a fresh post-action readback.';
  }
  return undefined;
}

function buildNextRequiredTool(
  intent: ReadPageCandidateAction['intent'] | undefined,
): string | undefined {
  if (intent === 'publish.upload_media') return 'chrome_upload_file';
  return undefined;
}

function buildNextRequiredCheck(
  intent: ReadPageCandidateAction['intent'] | undefined,
): string | undefined {
  if (intent === 'publish.upload_media') {
    return 'prove_file_input_or_file_picker_binding_then_run_fresh_same_tab_read';
  }
  if (intent) return 'run_action_then_fresh_same_tab_read_to_verify_page_or_object_state';
  return undefined;
}

function selectNextFileInputBinding(
  bindings: readonly ReadPageFileInputBinding[] | null | undefined,
): ReadPageFileInputBinding | null {
  if (!bindings || bindings.length === 0) return null;
  const usable = bindings.find(
    (binding) => Boolean(String(binding.selector || '').trim()) && binding.disabled !== true,
  );
  if (usable) return usable;
  return bindings.find((binding) => Boolean(String(binding.selector || '').trim())) ?? null;
}

function isBroadBlockingOverlayElement(element: ReadPageInteractiveElement): boolean {
  if (String(element.actionability || '').toLowerCase() !== 'blocked') return false;
  const role = String(element.role || '').toLowerCase();
  const name = String(element.name || '').trim();
  const hasBlockingSurfaceSignal =
    role === 'dialog' ||
    role === 'alertdialog' ||
    /\b(dialog|modal|overlay|captcha|verification|verify|login|sign in|auth|required)\b|登录|登陆|验证|验证码|弹窗|遮罩|授权|请先登录|需要登录/i.test(
      name,
    );
  if (!hasBlockingSurfaceSignal) return false;
  const rect = element.rect;
  if (!rect) return false;
  const width = typeof rect.width === 'number' && Number.isFinite(rect.width) ? rect.width : 0;
  const height = typeof rect.height === 'number' && Number.isFinite(rect.height) ? rect.height : 0;
  const y = typeof rect.y === 'number' && Number.isFinite(rect.y) ? rect.y : 0;
  const area = width * height;
  return width >= 300 && height >= 300 && area >= 250_000 && y <= 180;
}

function hasBroadBlockingOverlay(
  interactiveElements: readonly ReadPageInteractiveElement[],
): boolean {
  return interactiveElements.some(isBroadBlockingOverlayElement);
}

function visibleRegionRowTargetRefs(
  visibleRegionRows: ReadPageVisibleRegionRows | null | undefined,
): Set<string> {
  const refs = new Set<string>();
  if (!visibleRegionRows?.visibleRegionRowsUsed) return refs;
  for (const row of visibleRegionRows.rows) {
    const targetRef = String(row.targetRef || '').trim();
    if (targetRef) refs.add(targetRef);
  }
  return refs;
}

export function buildCandidateActions(
  interactiveElements: ReadPageInteractiveElement[],
  refMap: any[],
  options: {
    visibleRegionRows?: ReadPageVisibleRegionRows | null;
    frameId?: number;
    fileInputBindings?: readonly ReadPageFileInputBinding[] | null;
    cdpAccessibilityCandidates?: readonly CdpAxCandidate[] | null;
    viewport?: { width: number | null; height: number | null; dpr?: number | null } | null;
  } = {},
): CandidateActionSeed[] {
  const cdpAxFallback = buildCdpAxInteractiveElements({
    candidates: options.cdpAccessibilityCandidates ?? undefined,
    viewport: options.viewport ?? null,
  });
  const selectorMap = buildRefSelectorMap([...refMap, ...cdpAxFallback.refMap]);
  const deduplicated = deduplicateCrossSourceElements({
    domElements: interactiveElements.map((element) => ({
      ...element,
      selector: getElementSelector(element, selectorMap),
    })),
    cdpAxElements: cdpAxFallback.elements.map((element) => ({
      ...element,
      selector: getElementSelector(element, selectorMap),
    })),
  });
  const mergedRefs = deduplicated.mergedRefs;
  const contentTargetRefs = visibleRegionRowTargetRefs(options.visibleRegionRows);
  const clickRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'switch']);
  const fillRoles = new Set(['textbox', 'searchbox', 'combobox']);
  const primaryKeywords =
    /(submit|save|continue|next|confirm|login|sign in|search|checkout|send code|get code|request code|filter|filters|filtered|sort|refresh|reload|all|images?|videos?|users?|latest|popular|reset|clear|apply|提交|保存|继续|下一步|确认|登录|搜索|筛选|已筛选|过滤|排序|全部|图文|视频|用户|综合|最新|最多点赞|最多评论|最多收藏|收藏最多|不限|一天内|一周内|半年内|已看过|未看过|已关注|同城|附近|重置|收起|刷新|获取验证码|发送验证码|重新发送|同意)/i;

  const seeds: CandidateActionSeed[] = [];
  const prioritizedElements = deduplicated.merged
    .map((element, index) => ({
      element,
      index,
      score: scoreCandidateElementPriority(element, index, contentTargetRefs),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ element }) => element);

  for (const element of prioritizedElements) {
    if (!element.ref) continue;
    if (!isExecutableCandidateElement(element)) continue;
    if (isLowValueNavigationLink(element)) continue;
    const role = String(element.role || '').toLowerCase();
    const name = String(element.name || '').trim();
    let actionType: 'click' | 'fill' | null = null;

    if (
      clickRoles.has(role) ||
      isRecoveredTextActionElement(element) ||
      isFilterPanelOptionElement(element, prioritizedElements)
    ) {
      actionType = 'click';
    } else if (fillRoles.has(role)) actionType = 'fill';
    if (!actionType) continue;

    const selector = getElementSelector(element, selectorMap);

    const isPrimary = primaryKeywords.test(name);
    const confidence = isPrimary ? 0.93 : actionType === 'fill' ? 0.68 : 0.72;
    const originalReason = isPrimary
      ? 'primary action inferred from interactive label'
      : actionType === 'fill'
        ? 'form input candidate from structured snapshot'
        : 'interactive clickable candidate from structured snapshot';
    const isMergedSource = mergedRefs.has(element.ref);
    const baseMatchReason = isMergedSource
      ? `${originalReason} (cross-source merged: dom+cdp_ax)`
      : originalReason;
    const intent = inferCandidateActionIntent(element, actionType, {
      interactiveElements: prioritizedElements,
    });
    const locatorChain = buildLocatorChain({ element, selector, actionType, intent });
    const matchReason = buildActionTargetMatchReason({
      baseReason: baseMatchReason,
      element,
      selector,
      contentTargetRefs,
    });
    const label = shouldExposeCandidateActionLabel({ actionType, intent, name, element })
      ? name
      : '';
    const actionability = normalizeActionability(element.actionability);
    const actionabilityReason = buildActionabilityReason({ element, actionability, intent });
    const intentBoundary = buildIntentBoundary(intent);
    const nextRequiredTool = buildNextRequiredTool(intent);
    const nextRequiredCheck = buildNextRequiredCheck(intent);
    const nextFileInputBinding =
      intent === 'publish.upload_media'
        ? selectNextFileInputBinding(options.fileInputBindings)
        : null;
    const nextRequiredSelector = nextFileInputBinding?.selector?.trim() || undefined;
    const nextRequiredSelectorSource = nextFileInputBinding?.bindingSource || undefined;

    const safeRef = element.ref.replace(/[^a-zA-Z0-9_]/g, '_');
    seeds.push({
      id: `ca_${actionType}_${safeRef}`,
      actionType,
      targetRef: element.ref,
      ...(label ? { label } : {}),
      ...(typeof options.frameId === 'number' ? { frameId: options.frameId } : {}),
      confidence: Number(confidence.toFixed(2)),
      matchReason,
      actionability,
      actionabilityReason,
      ...(element.visibility ? { visibility: element.visibility } : {}),
      ...(intentBoundary ? { intentBoundary } : {}),
      ...(nextRequiredTool ? { nextRequiredTool } : {}),
      ...(nextRequiredSelector ? { nextRequiredSelector } : {}),
      ...(nextRequiredSelectorSource ? { nextRequiredSelectorSource } : {}),
      ...(nextRequiredCheck ? { nextRequiredCheck } : {}),
      ...(element.rect ? { snapshotRect: element.rect } : {}),
      locatorChain,
      ...(intent ? { intent } : {}),
    });
  }
  return bindVisibleRegionRowsToDetailActions(
    seeds,
    interactiveElements,
    selectorMap,
    options.visibleRegionRows,
    options.frameId,
  );
}

function bindVisibleRegionRowsToDetailActions(
  seeds: CandidateActionSeed[],
  interactiveElements: ReadPageInteractiveElement[],
  selectorMap: Map<string, string>,
  visibleRegionRows: ReadPageVisibleRegionRows | null | undefined,
  frameId: number | undefined,
): CandidateActionSeed[] {
  if (!visibleRegionRows?.visibleRegionRowsUsed || visibleRegionRows.rows.length === 0) {
    return rankBoundCandidateActions(seeds);
  }

  if (hasBroadBlockingOverlay(interactiveElements)) {
    const blockedContentTargets = visibleRegionRowTargetRefs(visibleRegionRows);
    if (blockedContentTargets.size > 0) {
      return rankBoundCandidateActions(
        seeds.filter(
          (seed) => !blockedContentTargets.has(seed.targetRef) || isProtectedIntent(seed.intent),
        ),
      );
    }
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
    const trustedRowTarget = isTrustedVisibleRowTargetRef(row);
    if (element) {
      if (!isClickableContentTarget(element, row) && !trustedRowTarget) continue;
    } else if (!trustedRowTarget) {
      continue;
    }

    const existing = seedByTargetRef.get(targetRef);
    const rowLabel = String(row.title || row.primaryText || '').trim();
    if (existing) {
      if (!isProtectedIntent(existing.intent)) {
        existing.intent = 'content.open_detail';
        if (rowLabel && !mayContainSensitiveAuthText(rowLabel)) existing.label = rowLabel;
        existing.confidence = Number(
          Math.max(existing.confidence || 0, row.confidence || 0, 0.82).toFixed(2),
        );
        const elementForMatchReason: ReadPageInteractiveElement = element ?? {
          ref: targetRef,
          matchSource: 'structured_snapshot',
          role: 'link',
          name: rowLabel,
        };
        existing.matchReason = buildActionTargetMatchReason({
          baseReason: 'content row target inferred from visible region rows',
          element: elementForMatchReason,
          selector: getElementSelector(elementForMatchReason, selectorMap),
          contentTargetRefs: visibleRegionRowTargetRefs(visibleRegionRows),
        });
        existing.nextRequiredCheck =
          existing.nextRequiredCheck ??
          'run_action_then_fresh_same_tab_read_to_verify_page_or_object_state';
      }
      continue;
    }

    if (output.length >= MAX_CANDIDATE_ACTIONS) {
      const replaceIndex = [...output]
        .map((action, index) => ({ action, index }))
        .reverse()
        .find(
          ({ action }) =>
            action.intent !== 'content.open_detail' && !isProtectedIntent(action.intent),
        )?.index;
      if (replaceIndex === undefined) continue;
      output.splice(replaceIndex, 1);
    }
    const safeRef = targetRef.replace(/[^a-zA-Z0-9_]/g, '_');
    const selector = getElementSelector(element, selectorMap) || selectorMap.get(targetRef);
    const locatorChain: ReadPageCandidateActionLocator[] = [{ type: 'ref', value: targetRef }];
    if (selector) locatorChain.push({ type: 'css', value: selector });
    const sourceActionability = element ? normalizeActionability(element.actionability) : 'unknown';
    const actionability =
      trustedRowTarget && sourceActionability !== 'blocked' ? 'actionable' : sourceActionability;
    const intent: ReadPageCandidateAction['intent'] = 'content.open_detail';
    const actionLabel =
      rowLabel && !mayContainSensitiveAuthText(rowLabel)
        ? rowLabel
        : element?.name && !mayContainSensitiveAuthText(element.name)
          ? element.name
          : '';
    const action: CandidateActionSeed = {
      id: `ca_click_${safeRef}`,
      actionType: 'click',
      targetRef,
      ...(actionLabel ? { label: actionLabel } : {}),
      ...(typeof frameId === 'number' ? { frameId } : {}),
      confidence: Number(Math.max(row.confidence || 0, 0.78).toFixed(2)),
      matchReason: [
        'content row target inferred from visible region rows',
        'target_provenance=visible_region_row_target_ref',
        selector ? 'locator_sources=visible_region_row+css' : 'locator_sources=visible_region_row',
        'target_freshness=current_read_page_snapshot_only',
        'expected_delta=detail_navigation_or_content_state_change',
      ].join('; '),
      actionability,
      actionabilityReason: element
        ? buildActionabilityReason({ element, actionability, intent })
        : 'source_element_actionability=unknown; source=visible_region_rows; target_freshness=current_read_page_snapshot_only; business_success_not_proven_by_candidate_action',
      ...(element?.visibility ? { visibility: element.visibility } : {}),
      nextRequiredCheck: 'run_action_then_fresh_same_tab_read_to_verify_page_or_object_state',
      ...(element?.rect ? { snapshotRect: element.rect } : {}),
      locatorChain,
      intent,
    };
    output.push(action);
    seedByTargetRef.set(targetRef, action);
  }
  return rankBoundCandidateActions(output);
}

function rankBoundCandidateActions(actions: CandidateActionSeed[]): CandidateActionSeed[] {
  return actions
    .map((action, index) => ({ action, index, priority: boundCandidateActionPriority(action) }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(({ action }) => action)
    .slice(0, MAX_CANDIDATE_ACTIONS);
}

function boundCandidateActionPriority(action: CandidateActionSeed): number {
  const intent = String(action.intent || '');
  if (intent === 'search.enter_query') return 390;
  if (intent.startsWith('search.apply_filter.') || intent.startsWith('filter.')) return 380;
  if (intent === 'search.open_filters') return 370;
  if (intent === 'content.open_detail') return 350;
  if (intent === 'search.submit') return 340;
  if (intent === 'search.category_select') return 330;
  if (intent.startsWith('auth.')) return 325;
  if (intent === 'publish.select_media_type') return 320;
  if (intent === 'publish.upload_media') return 310;
  if (intent === 'publish.submit') return 300;
  if (intent === 'publish.open_entry') return 290;
  if (intent.startsWith('publish.')) return 280;
  const label = String(action.label || '');
  if (
    /menu action candidate|account action candidate|关于我们|营业执照|首页|直播|消息/i.test(label)
  ) {
    return 20;
  }
  return 100;
}

function isTrustedVisibleRowTargetRef(row: ReadPageVisibleRegionRows['rows'][number]): boolean {
  const targetRef = String(row.targetRef || '').trim();
  if (!targetRef.startsWith('ref_fallback_')) return false;
  if (Number(row.targetRefCoverageRate || 0) < 0.95) return false;
  return Boolean(row.qualityReasons?.includes('target_ref_available'));
}

function isClickableContentTarget(
  element: ReadPageInteractiveElement | undefined,
  row: ReadPageVisibleRegionRows['rows'][number],
): boolean {
  if (!element?.ref) return false;
  if (!isExecutableCandidateElement(element)) return false;
  const role = String(element.role || '').toLowerCase();
  const textLikeFallbackTarget =
    String(element.ref || '').startsWith('ref_fallback_') &&
    new Set(['generic', 'text', '']).has(role) &&
    row.qualityReasons?.includes('target_ref_available') &&
    Number(row.targetRefCoverageRate || 0) >= 0.95;
  if (!new Set(['link', 'button', 'menuitem']).has(role) && !textLikeFallbackTarget) return false;
  const source = String(element.matchSource || '').toLowerCase();
  if (source === 'placeholder') return false;
  return true;
}

function shouldExposeCandidateActionLabel(params: {
  actionType: 'click' | 'fill';
  intent: ReadPageCandidateAction['intent'] | undefined;
  name: string;
  element: ReadPageInteractiveElement;
}): boolean {
  if (!params.name) return false;
  if (params.actionType === 'fill') return false;
  const source = String(params.element.matchSource || '').toLowerCase();
  if (source === 'placeholder') return false;
  if (typeof params.intent === 'string' && params.intent.startsWith('auth.')) return false;
  return !mayContainSensitiveAuthText(params.name);
}

function isExecutableCandidateElement(element: ReadPageInteractiveElement): boolean {
  const actionability = String(element.actionability || '').toLowerCase();
  if (actionability === 'blocked' || actionability === 'not_actionable') return false;
  const visibility = element.visibility;
  if (visibility) {
    if (visibility.domVisible === false || visibility.inViewport === false) return false;
    if (visibility.occluded === true || visibility.centerHitTarget === false) return false;
  }
  const disabled = Boolean((element as { disabled?: boolean }).disabled);
  const ariaDisabled = String(
    (element as { ariaDisabled?: string }).ariaDisabled || '',
  ).toLowerCase();
  if (disabled || ariaDisabled === 'true') return false;
  return true;
}

function isProtectedIntent(intent: ReadPageCandidateAction['intent'] | undefined): boolean {
  return Boolean(
    intent && (/^auth\./.test(intent) || /^search\./.test(intent) || /^filter\./.test(intent)),
  );
}
