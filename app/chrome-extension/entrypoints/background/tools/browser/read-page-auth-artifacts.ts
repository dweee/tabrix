import type {
  BrowserPageOwnerType,
  ReadPageArtifactRef,
  ReadPageAuthArtifactStatus,
  ReadPageAuthChallengeType,
  ReadPageAuthCollaboration,
  ReadPageAuthForm,
  ReadPageAuthFormControl,
  ReadPageCandidateAction,
  ReadPageBrowserPageObjectView,
  ReadPageInteractiveElement,
  ReadPageRegion,
  ReadPageRegionObject,
} from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';
import { canvasToDataURL, cropAndResizeImage } from '../../../../utils/image-utils';
import { prepareFileViaNative } from './native-file';

const AUTH_QR_ARTIFACT_KIND = 'auth_qr_image';
const AUTH_QR_ARTIFACT_TTL_MS = 120_000;
const AUTH_QR_CLAIM_BOUNDARY =
  'temporary auth-scoped QR image artifact only; not QR payload proof, not login success proof, and not long-term memory';
const AUTH_COLLABORATION_CLAIM_BOUNDARY =
  'login collaboration planning state only; not credential storage, not auth bypass, and not proof of login success without fresh postcondition evidence';
const AUTH_FORM_CLAIM_BOUNDARY =
  'privacy-safe OTP auth form map for user collaboration only; raw phone/OTP/password/cookie values are never included';

type AuthQrExtractionMethod =
  | 'img_data_url'
  | 'img_canvas'
  | 'canvas_to_data_url'
  | 'css_background_data_url'
  | 'element_screenshot';

export interface AuthQrArtifactCandidate {
  regionId: string;
  objectId: string;
  selector: string;
  width: number | null;
  height: number | null;
}

interface ExtractedAuthQrImage {
  dataUrl?: string;
  method?: AuthQrExtractionMethod;
  width?: number;
  height?: number;
  selector?: string;
  rect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio?: number;
  failureReason?: string;
}

export function buildNotRequestedAuthArtifactStatus(): ReadPageAuthArtifactStatus {
  return {
    requested: false,
    status: 'not_requested',
    reason: 'includeAuthArtifacts_false',
    claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
  };
}

export function ownerTypeFromBrowserWorldTab(
  tab: Pick<BrowserWorldTabObject, 'openedBy'> | null,
): BrowserPageOwnerType | 'unknown' {
  if (tab?.openedBy === 'ai') return 'run_owned';
  if (tab?.openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

export function canExtractAuthArtifactForTab(tab: BrowserWorldTabObject | null): {
  allowed: boolean;
  ownerType: BrowserPageOwnerType | 'unknown';
  reason: string;
} {
  const ownerType = ownerTypeFromBrowserWorldTab(tab);
  if (!tab) {
    return {
      allowed: false,
      ownerType,
      reason: 'browser_world_tab_unknown',
    };
  }
  if (tab.openedBy !== 'ai') {
    return {
      allowed: false,
      ownerType,
      reason: 'current_tab_not_ai_owned_for_auth_artifact',
    };
  }
  if (tab.canTabrixOperate === false) {
    return {
      allowed: false,
      ownerType,
      reason: tab.operabilityReason || 'current_tab_not_operable_for_auth_artifact',
    };
  }
  return {
    allowed: true,
    ownerType,
    reason: 'ai_owned_tab_auth_artifact_allowed',
  };
}

function authScopedRegionText(pageRegions: ReadPageRegion[] | undefined): string {
  return (Array.isArray(pageRegions) ? pageRegions : [])
    .filter((region) => region.regionType !== 'content')
    .flatMap((region) => [
      region.regionId,
      region.regionType,
      region.state,
      region.label || '',
      ...(region.objects || []).flatMap((object) => [
        object.objectId,
        object.objectType,
        object.label,
        object.reason,
        object.role || '',
      ]),
    ])
    .join(' ');
}

function hasAuthScopedQrRegion(pageRegions: ReadPageRegion[] | undefined): boolean {
  return selectAuthQrArtifactCandidate(pageRegions) !== null;
}

function detectAuthChallengeType(params: {
  pageRegions: ReadPageRegion[] | undefined;
  authArtifactStatus: ReadPageAuthArtifactStatus;
  browserPageObject: ReadPageBrowserPageObjectView | null | undefined;
}): ReadPageAuthChallengeType {
  const eventTypes = (params.browserPageObject?.semanticEvents || []).map(
    (event) => event.eventType,
  );
  if (
    params.authArtifactStatus.status === 'ready' ||
    eventTypes.some((eventType) => eventType.startsWith('qr_')) ||
    hasAuthScopedQrRegion(params.pageRegions)
  ) {
    return 'qr';
  }

  const text = authScopedRegionText(params.pageRegions);
  if (/\b(captcha|human|slider|challenge)\b|人机|滑块|安全验证/i.test(text)) return 'captcha';
  if (/\b(otp|sms|verification code|one-time code)\b|短信|验证码|动态码/i.test(text)) {
    return 'otp';
  }
  if (/\b(password|passcode|credential)\b|密码|账号/i.test(text)) return 'password_form';
  if (/\b(sso|oauth|identity provider|third[-\s]?party)\b|单点登录|第三方|授权登录/i.test(text)) {
    return 'sso_external';
  }
  return 'unknown';
}

function hasAuthRequiredEvidence(params: {
  pageRole?: string | null;
  pageRegions: ReadPageRegion[] | undefined;
  browserPageObject: ReadPageBrowserPageObjectView | null | undefined;
}): boolean {
  if (params.pageRole === 'login_required') return true;
  const eventTypes = (params.browserPageObject?.semanticEvents || []).map(
    (event) => event.eventType,
  );
  if (
    eventTypes.some((eventType) =>
      ['auth_required_candidate', 'qr_waiting', 'qr_expired_candidate', 'qr_refreshed'].includes(
        eventType,
      ),
    )
  ) {
    return true;
  }
  const regions = Array.isArray(params.pageRegions) ? params.pageRegions : [];
  return regions.some((region) => {
    if (region.regionType === 'qr_code' && hasAuthScopedQrRegion(regions)) return true;
    if (region.regionType === 'modal' && /\bauth|login\b|登录|授权/i.test(region.state)) {
      return true;
    }
    if (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)) {
      return true;
    }
    return false;
  });
}

function authArtifactExpiresAt(
  artifactRefs: ReadPageArtifactRef[],
  artifactRef: string | undefined,
): number | undefined {
  if (!artifactRef) return undefined;
  return artifactRefs.find((item) => item.ref === artifactRef)?.expiresAtMs;
}

type AuthControlKey = keyof ReadPageAuthForm['controls'];

interface AuthFormControlCandidate {
  key: AuthControlKey;
  role: string;
  label: string;
  targetRef?: string;
  candidateActionId?: string;
  locatorChain?: ReadPageAuthFormControl['locatorChain'];
  confidence: number;
  reason: string;
  state: ReadPageAuthFormControl['state'];
  valueState?: ReadPageAuthFormControl['valueState'];
  checked?: ReadPageInteractiveElement['checked'];
  matchSource?: string;
  actionability: ReadPageAuthFormControl['actionability'];
}

const PHONE_CONTROL_PATTERN = /\b(phone|mobile|tel|telephone)\b|手机号|手机号码|电话号码|\+86/i;
const OTP_INPUT_PATTERN =
  /\b(otp|sms|verification\s*code|one[-\s]?time\s*code|code)\b|短信验证码|验证码|动态码/i;
const REQUEST_OTP_PATTERN =
  /\b(get|send|request|resend)\s+(sms\s+)?(otp|code|verification)\b|\b(send|get)\s+code\b|获取验证码|发送验证码|重新发送|重发验证码/i;
const AGREEMENT_PATTERN =
  /\b(agree|terms|privacy|policy|agreement)\b|我已阅读|阅读并同意|同意.*(协议|条款|隐私)|用户协议|隐私政策/i;
const AGREEMENT_CONFIRM_PATTERN =
  /\b(agree|accept)\s+and\s+continue\b|同意并继续|确认同意|同意并登录|我同意/i;
const SUBMIT_PATTERN = /\b(log\s*in|sign\s*in|submit|continue)\b|登录|提交|继续/i;
const OTP_SENT_PATTERN = /\b(sent|resend|seconds?|countdown)\b|\d+\s*秒|已发送|重新发送/i;

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function controlText(
  item:
    | ReadPageInteractiveElement
    | ReadPageCandidateAction
    | ReadPageRegionObject
    | AuthFormControlCandidate
    | null
    | undefined,
): string {
  if (!item) return '';
  const anyItem = item as any;
  return [
    anyItem.name,
    anyItem.label,
    anyItem.role,
    anyItem.matchReason,
    anyItem.reason,
    anyItem.objectType,
    anyItem.state,
    anyItem.matchSource,
  ]
    .map(textOf)
    .filter(Boolean)
    .join(' ');
}

function roleOf(
  item: ReadPageInteractiveElement | ReadPageRegionObject | null | undefined,
): string {
  return textOf((item as any)?.role).toLowerCase();
}

function isTextboxRole(role: string): boolean {
  return ['textbox', 'searchbox', 'combobox', 'input', 'textarea'].includes(role);
}

function isClickableRole(role: string): boolean {
  return ['button', 'link', 'menuitem', 'tab', 'option', 'checkbox', 'switch'].includes(role);
}

function actionabilityForInteractive(
  element: ReadPageInteractiveElement,
): ReadPageAuthFormControl['actionability'] {
  if (element.actionability) return element.actionability;
  const role = roleOf(element);
  if (isClickableRole(role) || isTextboxRole(role)) return 'actionable';
  return 'unknown';
}

function actionabilityForCandidate(
  candidate: ReadPageCandidateAction | undefined,
): ReadPageAuthFormControl['actionability'] {
  if (!candidate) return 'unknown';
  return candidate.actionType === 'click' || candidate.actionType === 'fill'
    ? 'actionable'
    : 'unknown';
}

function findCandidateAction(
  actions: ReadPageCandidateAction[],
  targetRef: string | undefined,
  actionType?: 'click' | 'fill',
): ReadPageCandidateAction | undefined {
  if (!targetRef) return undefined;
  return actions.find(
    (action) =>
      action.targetRef === targetRef && (!actionType || String(action.actionType) === actionType),
  );
}

function toControl(
  key: AuthControlKey,
  element: ReadPageInteractiveElement,
  candidateActions: ReadPageCandidateAction[],
  reason: string,
  confidence: number,
  state: ReadPageAuthFormControl['state'],
  preferredActionType?: 'click' | 'fill',
): AuthFormControlCandidate {
  const candidate = findCandidateAction(candidateActions, element.ref, preferredActionType);
  const role = roleOf(element) || 'unknown';
  const candidateActionability = candidate ? actionabilityForCandidate(candidate) : '';
  return {
    key,
    role,
    label: textOf(element.name),
    targetRef: element.ref,
    candidateActionId: candidate?.id,
    locatorChain: candidate?.locatorChain,
    confidence,
    reason,
    state,
    valueState: element.valueState,
    checked: element.checked,
    matchSource: element.matchSource,
    actionability:
      element.actionability || candidateActionability || actionabilityForInteractive(element),
  };
}

function scoreElement(
  element: ReadPageInteractiveElement,
  pattern: RegExp,
  expected: 'fill' | 'click',
): number {
  const text = controlText(element);
  if (!pattern.test(text)) return Number.NEGATIVE_INFINITY;
  const role = roleOf(element);
  let score = 50;
  if (expected === 'fill' && isTextboxRole(role)) score += 35;
  if (expected === 'click' && isClickableRole(role)) score += 35;
  if (element.matchSource === 'placeholder' && expected === 'click') score -= 70;
  if (element.actionability === 'not_actionable') score -= 80;
  if (element.valueState === 'non_empty') score += 6;
  if (role === 'checkbox') score += 10;
  if (role === 'button') score += 14;
  return score;
}

function bestElement(
  elements: ReadPageInteractiveElement[],
  pattern: RegExp,
  expected: 'fill' | 'click',
): ReadPageInteractiveElement | undefined {
  return [...elements]
    .map((element, index) => ({ element, score: scoreElement(element, pattern, expected), index }))
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.element;
}

function findRequestOtpControl(
  elements: ReadPageInteractiveElement[],
  candidateActions: ReadPageCandidateAction[],
): AuthFormControlCandidate | undefined {
  const matching = elements
    .map((element, index) => ({
      element,
      index,
      score: scoreElement(element, REQUEST_OTP_PATTERN, 'click'),
    }))
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = matching[0]?.element;
  if (!best) return undefined;
  const role = roleOf(best);
  const placeholderOnly =
    isTextboxRole(role) && (best.matchSource === 'placeholder' || !isClickableRole(role));
  const state = OTP_SENT_PATTERN.test(controlText(best))
    ? 'countdown'
    : placeholderOnly
      ? 'not_actionable'
      : 'unknown';
  return toControl(
    'requestOtp',
    best,
    candidateActions,
    placeholderOnly
      ? 'otp request text matched a form field placeholder, not a proven clickable control'
      : 'otp request control inferred from action text',
    placeholderOnly ? 0.42 : 0.86,
    state,
    'click',
  );
}

function checkedState(
  element: ReadPageInteractiveElement | undefined,
): ReadPageAuthFormControl['state'] {
  if (!element) return 'unknown';
  if (element.checked === true) return 'checked';
  if (element.checked === false) return 'unchecked';
  const text = controlText(element);
  if (/\bchecked\b|已勾选|已同意/i.test(text)) return 'checked';
  if (/\bunchecked\b|未勾选|未同意/i.test(text)) return 'unchecked';
  return 'unknown';
}

function buildOtpAuthForm(params: {
  challengeType: ReadPageAuthChallengeType;
  status: ReadPageAuthCollaboration['status'];
  operationBinding: ReadPageAuthCollaboration['evidence']['operationBinding'];
  semanticEventTypes: string[];
  interactiveElements?: ReadPageInteractiveElement[];
  candidateActions?: ReadPageCandidateAction[];
  pageRegions?: ReadPageRegion[];
}): ReadPageAuthForm | undefined {
  const interactiveElements = Array.isArray(params.interactiveElements)
    ? params.interactiveElements
    : [];
  const candidateActions = Array.isArray(params.candidateActions) ? params.candidateActions : [];
  const scopedText = authScopedRegionText(params.pageRegions);
  const hasOtpSignal =
    params.challengeType === 'otp' ||
    interactiveElements.some((element) => OTP_INPUT_PATTERN.test(controlText(element))) ||
    OTP_INPUT_PATTERN.test(scopedText);
  if (!hasOtpSignal) return undefined;

  const controls: ReadPageAuthForm['controls'] = {};
  const phoneInput = bestElement(interactiveElements, PHONE_CONTROL_PATTERN, 'fill');
  if (phoneInput) {
    controls.phoneInput = toControl(
      'phoneInput',
      phoneInput,
      candidateActions,
      'phone input inferred from neutral login form labels',
      0.84,
      phoneInput.valueState || 'unknown',
      'fill',
    );
  }
  const otpInput = bestElement(
    interactiveElements.filter((element) => element.ref !== phoneInput?.ref),
    OTP_INPUT_PATTERN,
    'fill',
  );
  if (otpInput) {
    controls.otpInput = toControl(
      'otpInput',
      otpInput,
      candidateActions,
      'otp input inferred from neutral verification code labels',
      0.86,
      otpInput.valueState || 'unknown',
      'fill',
    );
  }
  const requestOtp = findRequestOtpControl(interactiveElements, candidateActions);
  if (requestOtp) controls.requestOtp = requestOtp;

  const agreementCheckbox = bestElement(interactiveElements, AGREEMENT_PATTERN, 'click');
  if (agreementCheckbox) {
    controls.agreementCheckbox = toControl(
      'agreementCheckbox',
      agreementCheckbox,
      candidateActions,
      'agreement control inferred from terms/privacy wording',
      0.78,
      checkedState(agreementCheckbox),
      'click',
    );
  }
  const agreementConfirm = bestElement(interactiveElements, AGREEMENT_CONFIRM_PATTERN, 'click');
  if (agreementConfirm) {
    controls.agreementConfirm = toControl(
      'agreementConfirm',
      agreementConfirm,
      candidateActions,
      'agreement confirmation dialog action inferred from wording',
      0.82,
      'visible',
      'click',
    );
  }
  const submit = bestElement(interactiveElements, SUBMIT_PATTERN, 'click');
  if (submit) {
    controls.submit = toControl(
      'submit',
      submit,
      candidateActions,
      'login submit control inferred from action wording',
      0.76,
      'unknown',
      'click',
    );
  }

  const blockers: ReadPageAuthForm['blockers'] = [];
  let readiness: ReadPageAuthForm['readiness'] = 'not_proven';
  let nextAction: ReadPageAuthForm['nextAction'] = 'not_proven';

  if (params.status === 'succeeded_candidate') {
    readiness = 'login_succeeded_candidate';
    nextAction = 'verify_login';
  } else if (params.operationBinding !== 'ai_operable_tab') {
    blockers.push({
      kind: 'protected_tab',
      message: '当前标签不是 AI 可操作标签，不能继续自动登录协作。',
    });
    nextAction = 'manual_user_action';
  } else if (controls.agreementConfirm) {
    readiness = 'blocked_by_agreement';
    nextAction = 'confirm_agreement';
    blockers.push({
      kind: 'agreement_modal',
      message: '页面出现协议确认弹窗，需要先确认后才能继续获取验证码。',
      control: 'agreementConfirm',
    });
  } else if (controls.agreementCheckbox?.state === 'unchecked') {
    readiness = 'blocked_by_agreement';
    nextAction = 'accept_terms';
    blockers.push({
      kind: 'agreement_required',
      message: '协议勾选框尚未勾选，需要先勾选用户协议/隐私条款。',
      control: 'agreementCheckbox',
    });
  } else if (controls.phoneInput && controls.phoneInput.valueState !== 'non_empty') {
    nextAction = 'fill_phone';
    blockers.push({
      kind: 'missing_phone',
      message: '手机号输入框还没有填入内容；输出时只允许显示 non_empty/empty，不输出手机号。',
      control: 'phoneInput',
    });
  } else if (controls.requestOtp?.state === 'countdown') {
    readiness = 'waiting_for_user_otp';
    nextAction = 'wait_for_user_otp';
  } else if (controls.requestOtp?.actionability === 'not_actionable') {
    blockers.push({
      kind: 'target_not_actionable',
      message: '“获取验证码”只匹配到了不可点击文本或输入框占位符，不能硬点坐标。',
      control: 'requestOtp',
    });
  } else if (controls.requestOtp?.targetRef) {
    readiness = 'ready_to_request_otp';
    nextAction = 'request_otp';
  } else {
    nextAction = 'manual_user_action';
  }

  if (params.semanticEventTypes.includes('otp_requested_candidate')) {
    readiness = 'otp_requested';
    nextAction = 'wait_for_user_otp';
  }

  return {
    formType: 'otp',
    readiness,
    nextAction,
    controls,
    blockers,
    claimBoundary: AUTH_FORM_CLAIM_BOUNDARY,
  };
}

export function buildAuthCollaborationState(params: {
  pageRole?: string | null;
  tabId: number;
  pageRegions: ReadPageRegion[] | undefined;
  browserPageObject: ReadPageBrowserPageObjectView | null | undefined;
  browserWorldTab: BrowserWorldTabObject | null;
  authArtifactStatus: ReadPageAuthArtifactStatus;
  artifactRefs: ReadPageArtifactRef[];
  interactiveElements?: ReadPageInteractiveElement[];
  candidateActions?: ReadPageCandidateAction[];
}): ReadPageAuthCollaboration {
  const browserPageObject = params.browserPageObject ?? null;
  const semanticEventTypes = (browserPageObject?.semanticEvents || []).map(
    (event) => event.eventType,
  );
  const ownerGate = canExtractAuthArtifactForTab(params.browserWorldTab);
  const operationBinding = ownerGate.allowed ? 'ai_operable_tab' : 'protected_or_unknown_tab';
  const challengeType = detectAuthChallengeType({
    pageRegions: params.pageRegions,
    authArtifactStatus: params.authArtifactStatus,
    browserPageObject,
  });
  const authRequired = hasAuthRequiredEvidence({
    pageRole: params.pageRole,
    pageRegions: params.pageRegions,
    browserPageObject,
  });
  const succeededCandidate = semanticEventTypes.includes('auth_succeeded_candidate');
  const succeededCandidateHasFreshComparison = browserPageObject?.status === 'compared_snapshot';
  const expiredCandidate = semanticEventTypes.includes('qr_expired_candidate');

  let status: ReadPageAuthCollaboration['status'] = 'not_required';
  if (succeededCandidate && succeededCandidateHasFreshComparison) {
    status = 'succeeded_candidate';
  } else if (succeededCandidate) {
    status = 'not_proven';
  } else if (!authRequired) {
    status = 'not_required';
  } else if (
    expiredCandidate ||
    params.authArtifactStatus.status === 'failed' ||
    params.authArtifactStatus.status === 'blocked' ||
    operationBinding !== 'ai_operable_tab'
  ) {
    status = 'not_proven';
  } else if (params.authArtifactStatus.status === 'ready') {
    status = 'waiting_for_user';
  } else {
    status = 'required';
  }

  const expiresAtMs = authArtifactExpiresAt(
    params.artifactRefs,
    params.authArtifactStatus.artifactRef,
  );
  const instruction = (() => {
    if (status === 'not_required') return '当前页面没有明确的登录协作需求。';
    if (status === 'succeeded_candidate') {
      return '已看到登录后状态候选；继续原任务前仍应以 fresh read_page/postcondition 作为证明。';
    }
    if (succeededCandidate && !succeededCandidateHasFreshComparison) {
      return '看到了登录后状态候选，但页面证据不是 fresh/resync 对比结果；请强制重新读取页面后再判断是否登录成功。';
    }
    if (operationBinding !== 'ai_operable_tab') {
      return '当前标签不是 AI 可操作标签；需要用户明确授权该标签，或让 AI 新开受控标签后再继续登录协作。';
    }
    if (expiredCandidate) return '登录二维码可能已过期；请刷新二维码或重新触发登录协作。';
    if (challengeType === 'qr' && params.authArtifactStatus.status === 'ready') {
      return '请用手机扫描二维码完成登录；扫码后告知 AI，AI 会重新读取页面并验证登录后状态。';
    }
    if (challengeType === 'otp') {
      return '当前页面需要手机号验证码协作：AI 只能识别和操作表单步骤，验证码由用户本人在浏览器输入，Tabrix 不接触也不保存验证码。';
    }
    if (challengeType === 'password_form') return '请你在当前页面自行输入账号/密码并完成登录。';
    if (challengeType === 'captcha') return '请你在当前页面完成人机验证或安全验证。';
    if (challengeType === 'sso_external') return '请你在当前页面或跳转的授权页完成登录授权。';
    return '请你在当前页面完成登录要求；完成后 AI 会重新读取页面确认是否可继续。';
  })();

  const authForm = buildOtpAuthForm({
    challengeType,
    status,
    operationBinding,
    semanticEventTypes,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
    pageRegions: params.pageRegions,
  });

  return {
    status,
    challengeType,
    userAction: {
      required: status === 'required' || status === 'waiting_for_user' || status === 'not_proven',
      instruction,
      artifactRef:
        status === 'waiting_for_user' && params.authArtifactStatus.artifactRef
          ? params.authArtifactStatus.artifactRef
          : undefined,
      expiresAtMs,
      retryRecommendation:
        status === 'not_proven'
          ? 'Refresh or repeat read_page with fresh page evidence before claiming login success.'
          : status === 'required'
            ? 'Request user collaboration, then verify with a fresh read_page after the user finishes.'
            : undefined,
    },
    evidence: {
      pageFreshness: browserPageObject?.status ?? 'unknown',
      tabId: params.tabId,
      ownerType: ownerGate.ownerType,
      canTabrixOperate: params.browserWorldTab?.canTabrixOperate ?? null,
      operationBinding,
      artifactStatus: params.authArtifactStatus.status,
      semanticEventTypes,
      postconditionStatus:
        status === 'succeeded_candidate'
          ? 'candidate_only'
          : status === 'not_proven'
            ? 'not_proven'
            : 'not_evaluated',
      claimBoundary: AUTH_COLLABORATION_CLAIM_BOUNDARY,
    },
    authForm,
    claimBoundary: AUTH_COLLABORATION_CLAIM_BOUNDARY,
  };
}

function selectCssLocator(object: ReadPageRegionObject): string | null {
  const locators = Array.isArray(object.locatorChain) ? object.locatorChain : [];
  const cssLocator = locators.find(
    (locator) => locator?.type === 'css' && typeof locator.value === 'string',
  );
  return cssLocator?.value?.trim() || null;
}

export function selectAuthQrArtifactCandidate(
  pageRegions: ReadPageRegion[] | undefined,
): AuthQrArtifactCandidate | null {
  const regions = Array.isArray(pageRegions) ? pageRegions : [];
  const hasAuthSurface = regions.some((region) => {
    if (region.regionType === 'modal') return true;
    if (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)) {
      return true;
    }
    return /\bauth|login\b|登录|授权/i.test(
      `${region.regionId} ${region.state} ${region.label || ''}`,
    );
  });
  if (!hasAuthSurface) return null;

  for (const region of regions) {
    if (region.regionType !== 'qr_code') continue;
    for (const object of region.objects || []) {
      const selector = selectCssLocator(object);
      const typeSignal = `${object.objectType || ''} ${object.label || ''} ${object.reason || ''}`;
      if (!selector || !/\bqr|qrcode|scan\b|二维码|扫码/i.test(typeSignal)) continue;
      return {
        regionId: region.regionId,
        objectId: object.objectId,
        selector,
        width: null,
        height: null,
      };
    }
  }
  return null;
}

function normalizeDataUrl(input: unknown): string | null {
  const value = typeof input === 'string' ? input.trim() : '';
  if (/^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(value)) return value;
  return null;
}

async function extractAuthQrImageFromDom(
  tabId: number,
  selectors: string[],
): Promise<ExtractedAuthQrImage> {
  const [injectionResult] = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (candidateSelectors: string[]) => {
      function visibleRect(element: Element) {
        const rect = element.getBoundingClientRect();
        if (!rect || rect.width < 30 || rect.height < 30) return null;
        const style = window.getComputedStyle(element);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number(style.opacity || '1') <= 0.01
        ) {
          return null;
        }
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      }

      function dataUrlFromBackground(styleValue: string): string | null {
        const match = /url\((['"]?)(data:image\/[^'")]+)\1\)/i.exec(styleValue || '');
        return match?.[2] || null;
      }

      async function dataUrlFromImage(image: HTMLImageElement): Promise<string | null> {
        const direct = image.currentSrc || image.src || '';
        if (/^data:image\//i.test(direct)) return direct;
        try {
          if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
            await image.decode();
          }
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth || image.width;
          canvas.height = image.naturalHeight || image.height;
          const context = canvas.getContext('2d');
          if (!context || canvas.width <= 0 || canvas.height <= 0) return null;
          context.drawImage(image, 0, 0);
          return canvas.toDataURL('image/png');
        } catch {
          return null;
        }
      }

      async function inspectElement(selector: string) {
        let element: Element | null = null;
        try {
          element = document.querySelector(selector);
        } catch {
          return { failureReason: 'invalid_qr_selector' };
        }
        if (!element) return { failureReason: 'qr_element_not_found' };

        const rect = visibleRect(element);
        if (!rect) return { failureReason: 'qr_element_not_visible' };

        if (element instanceof HTMLImageElement) {
          const dataUrl = await dataUrlFromImage(element);
          if (dataUrl) {
            return {
              dataUrl,
              method: /^data:image\//i.test(element.currentSrc || element.src || '')
                ? 'img_data_url'
                : 'img_canvas',
              width: Math.round(element.naturalWidth || rect.width),
              height: Math.round(element.naturalHeight || rect.height),
              selector,
              rect,
              devicePixelRatio: window.devicePixelRatio || 1,
            };
          }
        }

        if (element instanceof HTMLCanvasElement) {
          try {
            return {
              dataUrl: element.toDataURL('image/png'),
              method: 'canvas_to_data_url',
              width: Math.round(element.width || rect.width),
              height: Math.round(element.height || rect.height),
              selector,
              rect,
              devicePixelRatio: window.devicePixelRatio || 1,
            };
          } catch {
            /* screenshot fallback below */
          }
        }

        const backgroundDataUrl = dataUrlFromBackground(
          window.getComputedStyle(element).backgroundImage,
        );
        if (backgroundDataUrl) {
          return {
            dataUrl: backgroundDataUrl,
            method: 'css_background_data_url',
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            selector,
            rect,
            devicePixelRatio: window.devicePixelRatio || 1,
          };
        }

        return {
          method: 'element_screenshot',
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          selector,
          rect,
          devicePixelRatio: window.devicePixelRatio || 1,
        };
      }

      return (async () => {
        for (const selector of candidateSelectors) {
          const result = await inspectElement(selector);
          if (result.dataUrl || result.method === 'element_screenshot') return result;
        }
        return { failureReason: 'auth_qr_image_unavailable' };
      })();
    },
    args: [selectors],
  } as any);

  return (injectionResult?.result || {
    failureReason: 'auth_qr_dom_extraction_unavailable',
  }) as ExtractedAuthQrImage;
}

async function captureElementScreenshot(
  windowId: number | null,
  extraction: ExtractedAuthQrImage,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!extraction.rect) throw new Error('missing QR element rect for screenshot fallback');
  const dpr =
    typeof extraction.devicePixelRatio === 'number' && extraction.devicePixelRatio > 0
      ? extraction.devicePixelRatio
      : 1;
  const visibleCaptureDataUrl =
    typeof windowId === 'number'
      ? await chrome.tabs.captureVisibleTab(windowId, { format: 'png' })
      : await chrome.tabs.captureVisibleTab({ format: 'png' } as any);
  if (!visibleCaptureDataUrl) throw new Error('captureVisibleTab returned empty QR screenshot');

  const cropped = await cropAndResizeImage(
    visibleCaptureDataUrl,
    {
      x: extraction.rect.x * dpr,
      y: extraction.rect.y * dpr,
      width: extraction.rect.width * dpr,
      height: extraction.rect.height * dpr,
    },
    dpr,
  );
  return {
    dataUrl: await canvasToDataURL(cropped),
    width: Math.round(extraction.rect.width),
    height: Math.round(extraction.rect.height),
  };
}

export async function buildAuthQrArtifactRefs(params: {
  includeAuthArtifacts: boolean;
  tabId: number;
  windowId: number | null;
  pageRegions: ReadPageRegion[] | undefined;
  browserWorldTab: BrowserWorldTabObject | null;
  artifactRefs: ReadPageArtifactRef[];
  nowMs?: number;
  prepareFile?: typeof prepareFileViaNative;
}): Promise<ReadPageAuthArtifactStatus> {
  if (!params.includeAuthArtifacts) return buildNotRequestedAuthArtifactStatus();

  const gate = canExtractAuthArtifactForTab(params.browserWorldTab);
  if (!gate.allowed) {
    return {
      requested: true,
      status: 'blocked',
      reason: gate.reason,
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }

  const candidate = selectAuthQrArtifactCandidate(params.pageRegions);
  if (!candidate) {
    return {
      requested: true,
      status: 'not_applicable',
      reason: 'auth_scoped_qr_visual_not_found',
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }

  try {
    const extracted = await extractAuthQrImageFromDom(params.tabId, [candidate.selector]);
    let dataUrl = normalizeDataUrl(extracted.dataUrl);
    let method = extracted.method;
    let width = extracted.width || candidate.width || null;
    let height = extracted.height || candidate.height || null;

    if (!dataUrl && extracted.method === 'element_screenshot') {
      const screenshot = await captureElementScreenshot(params.windowId, extracted);
      dataUrl = screenshot.dataUrl;
      method = 'element_screenshot';
      width = screenshot.width;
      height = screenshot.height;
    }

    if (!dataUrl || !method) {
      throw new Error(extracted.failureReason || 'auth_qr_image_unavailable');
    }

    const producedAtMs = Number.isFinite(params.nowMs) ? Number(params.nowMs) : Date.now();
    const safeObjectId = candidate.objectId.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 48);
    const fileName = `tabrix_auth_qr_tab-${params.tabId}_${safeObjectId}_${producedAtMs}.png`;
    const prepareFile = params.prepareFile ?? prepareFileViaNative;
    const saved = await prepareFile({
      base64Data: dataUrl,
      fileName,
      requestPrefix: 'auth-qr-artifact',
    });
    const ref = `artifact://read_page/tab-${params.tabId}/auth-qr/${safeObjectId}`;
    params.artifactRefs.push({
      kind: AUTH_QR_ARTIFACT_KIND,
      ref,
      localPath: saved.fullPath,
      mimeType: 'image/png',
      width: typeof width === 'number' ? Math.round(width) : undefined,
      height: typeof height === 'number' ? Math.round(height) : undefined,
      producedAtMs,
      expiresAtMs: producedAtMs + AUTH_QR_ARTIFACT_TTL_MS,
      method,
      sourceRegionId: candidate.regionId,
      sourceObjectId: candidate.objectId,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    });
    return {
      requested: true,
      status: 'ready',
      reason: 'auth_qr_image_artifact_ready',
      artifactRef: ref,
      ownerType: gate.ownerType,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : String(error);
    return {
      requested: true,
      status: 'failed',
      reason: 'auth_qr_image_artifact_failed',
      ownerType: gate.ownerType,
      failureReason,
      claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
    };
  }
}
