import type {
  ReadPageCandidateAction,
  ReadPageCandidateActionLocator,
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
const SEARCH_TOOLBAR_VERTICAL_BAND_PX = 180;

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
  if (ref.startsWith('ref_text_filter_panel_')) score += 116;
  if (ref.startsWith('ref_text_search_toolbar_')) score += 112;
  if (ref.startsWith('ref_text_control_')) score += 110;
  if (FILTER_PANEL_LABEL_PATTERN.test(name)) score += 64;
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
  context: { interactiveElements: readonly ReadPageInteractiveElement[] },
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
  if (
    /二维码.*(刷新|重新)|刷新.*二维码|点击刷新|refresh\s*(qr|code)?|reload\s*(qr|code)?/i.test(name)
  ) {
    return 'auth.refresh_qr';
  }
  if (FILTER_OPEN_LABEL_PATTERN.test(name)) return 'filter.open';
  if (SEARCH_CATEGORY_LABEL_PATTERN.test(name)) {
    return isSearchToolbarCategoryElement(element, context.interactiveElements)
      ? 'search.category_select'
      : undefined;
  }
  if (
    /最多收藏|收藏最多|按收藏|收藏数|most\s*(collected|saved|favorited)|top\s*saves/i.test(name)
  ) {
    return 'filter.sort_most_collected';
  }
  if (
    String(element.ref || '').startsWith('ref_text_filter_panel_') &&
    FILTER_PANEL_LABEL_PATTERN.test(name)
  ) {
    return 'filter.open';
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
  const parts = [`source_element_actionability=${params.actionability}`, `source=${source}`];
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
  } = {},
): CandidateActionSeed[] {
  const selectorMap = buildRefSelectorMap(refMap);
  const contentTargetRefs = visibleRegionRowTargetRefs(options.visibleRegionRows);
  const clickRoles = new Set(['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'switch']);
  const fillRoles = new Set(['textbox', 'searchbox', 'combobox']);
  const primaryKeywords =
    /(submit|save|continue|next|confirm|login|sign in|search|checkout|send code|get code|request code|filter|filters|filtered|sort|refresh|reload|all|images?|videos?|users?|latest|popular|reset|clear|apply|提交|保存|继续|下一步|确认|登录|搜索|筛选|已筛选|过滤|排序|全部|图文|视频|用户|综合|最新|最多点赞|最多评论|最多收藏|收藏最多|不限|一天内|一周内|半年内|已看过|未看过|已关注|同城|附近|重置|收起|刷新|获取验证码|发送验证码|重新发送|同意|协议)/i;

  const seeds: CandidateActionSeed[] = [];
  const prioritizedElements = [...interactiveElements]
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
    const role = String(element.role || '').toLowerCase();
    const name = String(element.name || '').trim();
    let actionType: 'click' | 'fill' | null = null;

    if (clickRoles.has(role)) actionType = 'click';
    else if (fillRoles.has(role)) actionType = 'fill';
    if (!actionType) continue;

    const selector = getElementSelector(element, selectorMap);

    const isPrimary = primaryKeywords.test(name);
    const confidence = isPrimary ? 0.93 : actionType === 'fill' ? 0.68 : 0.72;
    const matchReason = isPrimary
      ? 'primary action inferred from interactive label'
      : actionType === 'fill'
        ? 'form input candidate from structured snapshot'
        : 'interactive clickable candidate from structured snapshot';
    const intent = inferCandidateActionIntent(element, actionType, {
      interactiveElements: prioritizedElements,
    });
    const locatorChain = buildLocatorChain({ element, selector, actionType, intent });
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
      ...(intentBoundary ? { intentBoundary } : {}),
      ...(nextRequiredTool ? { nextRequiredTool } : {}),
      ...(nextRequiredSelector ? { nextRequiredSelector } : {}),
      ...(nextRequiredSelectorSource ? { nextRequiredSelectorSource } : {}),
      ...(nextRequiredCheck ? { nextRequiredCheck } : {}),
      locatorChain,
      ...(intent ? { intent } : {}),
    });
    if (seeds.length >= MAX_CANDIDATE_ACTIONS) break;
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
    return seeds;
  }

  if (hasBroadBlockingOverlay(interactiveElements)) {
    const blockedContentTargets = visibleRegionRowTargetRefs(visibleRegionRows);
    if (blockedContentTargets.size > 0) {
      return seeds.filter(
        (seed) => !blockedContentTargets.has(seed.targetRef) || isProtectedIntent(seed.intent),
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
        existing.matchReason = 'content row target inferred from visible region rows';
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
      matchReason: 'content row target inferred from visible region rows',
      actionability,
      actionabilityReason: element
        ? buildActionabilityReason({ element, actionability, intent })
        : 'source_element_actionability=unknown; source=visible_region_rows; business_success_not_proven_by_candidate_action',
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
    .map(({ action }) => action);
}

function boundCandidateActionPriority(action: CandidateActionSeed): number {
  const intent = String(action.intent || '');
  if (intent === 'search.enter_query') return 360;
  if (intent === 'content.open_detail') return 350;
  if (intent === 'search.submit') return 340;
  if (intent === 'search.category_select') return 330;
  if (intent.startsWith('auth.')) return 325;
  if (intent.startsWith('filter.')) return 315;
  if (intent.startsWith('publish.')) return 90;
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
