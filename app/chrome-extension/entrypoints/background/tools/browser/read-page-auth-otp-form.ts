import type {
  ReadPageAuthChallengeType,
  ReadPageAuthCollaboration,
  ReadPageAuthForm,
  ReadPageAuthFormControl,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageRegionObject,
} from '@tabrix/shared';
import { AUTH_FORM_CLAIM_BOUNDARY } from './read-page-auth-guidance-copy';

type AuthControlKey = keyof ReadPageAuthForm['controls'];

export interface AuthFormControlCandidate {
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

export const PHONE_CONTROL_PATTERN =
  /\b(phone|mobile|tel|telephone)\b|手机号|手机号码|电话号码|\+86/i;
export const OTP_INPUT_PATTERN =
  /\b(otp|sms|verification\s*code|one[-\s]?time\s*code|code)\b|短信验证码|验证码|动态码/i;
export const REQUEST_OTP_PATTERN =
  /\b(get|send|request|resend)\s+(sms\s+)?(otp|code|verification)\b|\b(send|get)\s+code\b|获取验证码|发送验证码|重新发送|重发验证码/i;
export const SUBMIT_PATTERN = /\b(log\s*in|sign\s*in|submit|continue)\b|登录|提交|继续/i;

const AGREEMENT_PATTERN =
  /\b(agree|terms|privacy|policy|agreement)\b|我已阅读|阅读并同意|同意.*(协议|条款|隐私)|用户协议|隐私政策/i;
const AGREEMENT_CONFIRM_PATTERN =
  /\b(agree|accept)\s+and\s+continue\b|同意并继续|确认同意|同意并登录|我同意/i;
const OTP_SENT_PATTERN = /\b(sent|resend|seconds?|countdown)\b|\d+\s*秒|已发送|重新发送/i;

function textOf(value: unknown): string {
  return String(value ?? '').trim();
}

function safeAuthControlLabel(key: AuthControlKey): string {
  return {
    phoneInput: 'phone_input',
    otpInput: 'otp_input',
    requestOtp: 'request_otp',
    agreementCheckbox: 'agreement_checkbox',
    agreementConfirm: 'agreement_confirm',
    submit: 'submit_login',
  }[key];
}

function safeAuthLocatorChain(
  locatorChain: ReadPageAuthFormControl['locatorChain'] | undefined,
): ReadPageAuthFormControl['locatorChain'] | undefined {
  const safe = (Array.isArray(locatorChain) ? locatorChain : []).filter((locator) => {
    const type = String(locator?.type || '').toLowerCase();
    return type === 'ref' || type === 'css';
  });
  return safe.length > 0 ? safe : undefined;
}

export function controlText(
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

export function toControl(
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
    label: safeAuthControlLabel(key),
    targetRef: element.ref,
    candidateActionId: candidate?.id,
    locatorChain: safeAuthLocatorChain(candidate?.locatorChain),
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
  if (expected === 'fill' && !isTextboxRole(role)) return Number.NEGATIVE_INFINITY;
  let score = 50;
  if (expected === 'fill' && isTextboxRole(role)) score += 35;
  if (expected === 'click' && isClickableRole(role)) score += 35;
  if (element.matchSource === 'placeholder' && expected === 'click') score -= 70;
  if (element.actionability === 'not_actionable') score -= 80;
  if (expected === 'click' && element.matchSource === 'visible_text') score += 22;
  if (expected === 'click' && role === 'link') score -= 18;
  if (expected === 'click' && String(element.ref || '').startsWith('ref_fallback_')) score += 12;
  if (expected === 'click' && String(element.ref || '').startsWith('ref_text_menu_')) score -= 8;
  if (element.valueState === 'non_empty') score += 6;
  if (role === 'checkbox') score += 10;
  if (role === 'button') score += 14;
  return score;
}

export function bestElement(
  elements: ReadPageInteractiveElement[],
  pattern: RegExp,
  expected: 'fill' | 'click',
): ReadPageInteractiveElement | undefined {
  return [...elements]
    .map((element, index) => ({ element, score: scoreElement(element, pattern, expected), index }))
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.index - right.index)[0]?.element;
}

export function findRequestOtpControl(
  elements: ReadPageInteractiveElement[],
  candidateActions: ReadPageCandidateAction[],
): AuthFormControlCandidate | undefined {
  const matching = elements
    .map((element, index) => ({
      element,
      index,
      score:
        scoreElement(element, REQUEST_OTP_PATTERN, 'click') +
        (findCandidateAction(candidateActions, element.ref, 'click')?.intent === 'auth.request_otp'
          ? 30
          : 0),
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

function findAgreementCheckboxControl(
  elements: ReadPageInteractiveElement[],
  candidateActions: ReadPageCandidateAction[],
): AuthFormControlCandidate | undefined {
  const matching = elements
    .map((element, index) => {
      const role = roleOf(element);
      const text = controlText(element);
      if (!AGREEMENT_PATTERN.test(text)) {
        return { element, index, score: Number.NEGATIVE_INFINITY };
      }
      let score = scoreElement(element, AGREEMENT_PATTERN, 'click');
      if (role === 'link') score -= 90;
      if (role === 'checkbox' || role === 'switch') score += 60;
      if (element.checked === true || element.checked === false) score += 35;
      if (element.matchSource === 'nearby_text') score += 18;
      if (
        findCandidateAction(candidateActions, element.ref, 'click')?.intent === 'auth.accept_terms'
      ) {
        score += 28;
      }
      return { element, index, score };
    })
    .filter((item) => item.score > Number.NEGATIVE_INFINITY)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const best = matching[0]?.element;
  if (!best) return undefined;
  const role = roleOf(best);
  if (role === 'link' && best.checked !== true && best.checked !== false) {
    return undefined;
  }
  return toControl(
    'agreementCheckbox',
    best,
    candidateActions,
    'agreement control inferred from checkbox role/state or nearby agreement wording',
    0.82,
    checkedState(best),
    'click',
  );
}

export function hasVisibleOtpFormEvidence(
  elements: ReadPageInteractiveElement[] | undefined,
): boolean {
  const interactiveElements = Array.isArray(elements) ? elements : [];
  const hasOtpInput = interactiveElements.some((element) =>
    OTP_INPUT_PATTERN.test(controlText(element)),
  );
  const hasPhoneInput = interactiveElements.some((element) =>
    PHONE_CONTROL_PATTERN.test(controlText(element)),
  );
  const hasRequestOrSubmit = interactiveElements.some(
    (element) =>
      REQUEST_OTP_PATTERN.test(controlText(element)) || SUBMIT_PATTERN.test(controlText(element)),
  );
  return hasOtpInput && (hasPhoneInput || hasRequestOrSubmit);
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

export function buildOtpAuthForm(params: {
  challengeType: ReadPageAuthChallengeType;
  status: ReadPageAuthCollaboration['status'];
  actionOperability: NonNullable<ReadPageAuthCollaboration['evidence']['actionOperability']>;
  semanticEventTypes: string[];
  interactiveElements?: ReadPageInteractiveElement[];
  candidateActions?: ReadPageCandidateAction[];
  scopedText?: string;
}): ReadPageAuthForm | undefined {
  const interactiveElements = Array.isArray(params.interactiveElements)
    ? params.interactiveElements
    : [];
  const candidateActions = Array.isArray(params.candidateActions) ? params.candidateActions : [];
  const scopedText = params.scopedText || '';
  if (params.challengeType === 'qr') return undefined;
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

  const agreementCheckbox = findAgreementCheckboxControl(interactiveElements, candidateActions);
  if (agreementCheckbox) {
    controls.agreementCheckbox = agreementCheckbox;
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
  } else if (params.actionOperability !== 'operable') {
    blockers.push({
      kind: 'protected_tab',
      message: '当前标签的登录操作权限未证明，不能继续自动登录协作。',
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

  if (
    params.semanticEventTypes.includes('otp_requested_candidate') &&
    readiness !== 'waiting_for_user_otp'
  ) {
    readiness = 'not_proven';
    nextAction = 'not_proven';
    blockers.push({
      kind: 'otp_request_candidate_only',
      message: '只看到获取验证码候选事件，尚未看到倒计时、禁用按钮或发送提示，不能证明短信已发送。',
      control: controls.requestOtp ? 'requestOtp' : undefined,
    });
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
