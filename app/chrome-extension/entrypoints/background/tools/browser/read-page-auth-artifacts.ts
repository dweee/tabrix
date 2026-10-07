import type {
  ReadPageArtifactRef,
  ReadPageAssistantGuidance,
  ReadPageAuthArtifactStatus,
  ReadPageAuthChallengeType,
  ReadPageAuthCollaboration,
  ReadPageBrowserPageObjectView,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageRegion,
} from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';
import {
  buildAuthCollaborationHandoff,
  buildObservedAuthSurface,
  uniqueChallengeTypes,
} from './read-page-auth-collaboration-handoff';
export { buildAuthQrArtifactRefs } from './read-page-auth-artifact-extractor';
export {
  buildNotRequestedAuthArtifactStatus,
  canExtractAuthArtifactForTab,
  ownerTypeFromBrowserWorldTab,
} from './read-page-auth-artifact-policy';
import { canExtractAuthArtifactForTab } from './read-page-auth-artifact-policy';
import {
  AUTH_COLLABORATION_CLAIM_BOUNDARY,
  AUTH_RESUME_VERIFICATION_CLAIM_BOUNDARY,
} from './read-page-auth-guidance-copy';
import { buildOtpAuthForm, hasVisibleOtpFormEvidence } from './read-page-auth-otp-form';
import {
  hasAuthScopedQrRegion,
  hasExpiredAuthQrSignal,
  selectAuthQrArtifactCandidate,
} from './read-page-auth-qr-probe';
export { selectAuthQrArtifactCandidate } from './read-page-auth-qr-probe';

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
  const regions = Array.isArray(params.pageRegions) ? params.pageRegions : [];
  const eventTypes = (params.browserPageObject?.semanticEvents || []).map(
    (event) => event.eventType,
  );
  // A logged-out account entry is not itself a login wall. Lifecycle events
  // retain that observation, but readable content must remain operable unless
  // a concrete auth surface/challenge is also present.
  const optionalAccountEntry = regions.some(
    (region) => region.regionType === 'account' && /logged_out/i.test(region.state),
  );
  const readableContent = regions.some(
    (region) =>
      ['content', 'detail_area', 'result_list'].includes(region.regionType) &&
      region.objects.length > 0,
  );
  const explicitAuthSurface = regions.some(
    (region) =>
      ['modal', 'qr_code', 'credential_input', 'auth_submit_control'].includes(region.regionType) ||
      (region.regionType === 'form' &&
        region.objects.some((object) =>
          /password|passcode|credential|\botp\b|密码|验证码/i.test(
            `${object.label} ${object.objectType ?? ''} ${object.reason}`,
          ),
        )),
  );
  const qrChallenge = eventTypes.some((eventType) =>
    ['qr_waiting', 'qr_expired_candidate', 'qr_refreshed'].includes(eventType),
  );
  if (optionalAccountEntry && readableContent && !explicitAuthSurface && !qrChallenge) {
    return false;
  }
  if (
    eventTypes.some((eventType) =>
      ['auth_required_candidate', 'qr_waiting', 'qr_expired_candidate', 'qr_refreshed'].includes(
        eventType,
      ),
    )
  ) {
    return true;
  }
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

function buildAuthResumeVerification(params: {
  status: ReadPageAuthCollaboration['status'];
  tabId: number;
  succeededCandidate: boolean;
  succeededCandidateHasFreshComparison: boolean;
}) {
  const common = {
    nextTool: 'chrome_read_page' as const,
    sameTabRequired: true,
    targetTabId: params.tabId,
    postconditionRequired: true,
    requiredSignals: [
      'same_tab_binding_preserved',
      'auth_surface_disappeared',
      'logged_in_or_account_state_candidate_visible',
      'browser_hygiene_not_regressed',
    ],
    claimBoundary: AUTH_RESUME_VERIFICATION_CLAIM_BOUNDARY,
  };

  if (params.status === 'not_required') {
    return {
      ...common,
      status: 'not_required' as const,
      forceRefreshRequired: false,
      postconditionRequired: false,
      requiredSignals: [],
    };
  }

  if (params.succeededCandidate && !params.succeededCandidateHasFreshComparison) {
    return {
      ...common,
      status: 'fresh_read_required' as const,
      forceRefreshRequired: true,
    };
  }

  if (params.status === 'succeeded_candidate') {
    return {
      ...common,
      status: 'postcondition_required' as const,
      forceRefreshRequired: false,
    };
  }

  if (params.status === 'required' || params.status === 'waiting_for_user') {
    return {
      ...common,
      status: 'required_after_user_action' as const,
      forceRefreshRequired: true,
    };
  }

  return {
    ...common,
    status: 'not_proven' as const,
    forceRefreshRequired: true,
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
  assistantGuidance?: ReadPageAssistantGuidance;
}): ReadPageAuthCollaboration {
  const browserPageObject = params.browserPageObject ?? null;
  const semanticEventTypes = (browserPageObject?.semanticEvents || []).map(
    (event) => event.eventType,
  );
  const ownerGate = canExtractAuthArtifactForTab(params.browserWorldTab);
  const operationBinding = ownerGate.allowed ? 'ai_operable_tab' : 'protected_or_unknown_tab';
  const actionOperability: NonNullable<ReadPageAuthCollaboration['evidence']['actionOperability']> =
    params.browserWorldTab?.openedBy === 'ai' && params.browserWorldTab?.canTabrixOperate === true
      ? 'operable'
      : params.browserWorldTab
        ? 'protected_or_unknown'
        : 'unknown';
  let challengeType = detectAuthChallengeType({
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
  const expiredCandidate =
    semanticEventTypes.includes('qr_expired_candidate') ||
    hasExpiredAuthQrSignal(params.pageRegions) ||
    params.authArtifactStatus.failureReason === 'auth_qr_expired_refresh_required';
  const visibleOtpFormEvidence = hasVisibleOtpFormEvidence(params.interactiveElements);
  const hasReadyQrArtifact = params.authArtifactStatus.status === 'ready';
  const guidanceAuthPreference = params.assistantGuidance?.authPreference;
  if (
    guidanceAuthPreference === 'qr' &&
    (authRequired ||
      hasReadyQrArtifact ||
      expiredCandidate ||
      hasAuthScopedQrRegion(params.pageRegions) ||
      params.authArtifactStatus.requested)
  ) {
    challengeType = 'qr';
  } else if (guidanceAuthPreference === 'otp' && visibleOtpFormEvidence) {
    challengeType = 'otp';
  } else if (
    challengeType === 'qr' &&
    visibleOtpFormEvidence &&
    !hasReadyQrArtifact &&
    !expiredCandidate
  ) {
    challengeType = 'otp';
  }
  const preferredChallengeType = challengeType;
  const alternativeChallengeTypes = uniqueChallengeTypes([
    preferredChallengeType !== 'qr' &&
    (hasReadyQrArtifact || expiredCandidate || hasAuthScopedQrRegion(params.pageRegions))
      ? 'qr'
      : undefined,
    preferredChallengeType !== 'otp' && visibleOtpFormEvidence ? 'otp' : undefined,
  ]);

  let status: ReadPageAuthCollaboration['status'] = 'not_required';
  if (succeededCandidate && visibleOtpFormEvidence) {
    status = 'not_proven';
  } else if (succeededCandidate && succeededCandidateHasFreshComparison) {
    status = 'succeeded_candidate';
  } else if (succeededCandidate) {
    status = 'not_proven';
  } else if (!authRequired && !visibleOtpFormEvidence) {
    status = 'not_required';
  } else if (
    expiredCandidate ||
    params.authArtifactStatus.status === 'failed' ||
    params.authArtifactStatus.status === 'blocked' ||
    actionOperability !== 'operable'
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
      return '看到了登录后状态候选，但页面结果还不是 fresh/resync 对比结果；请强制重新读取页面后再判断是否登录成功。';
    }
    if (actionOperability !== 'operable') {
      return '当前标签不是 AI 可操作标签；需要用户明确授权该标签，或让 AI 新开受控标签后再继续登录协作。';
    }
    if (expiredCandidate) return '登录二维码可能已过期；请刷新二维码或重新触发登录协作。';
    if (challengeType === 'qr' && params.authArtifactStatus.status === 'ready') {
      return '请用手机扫描二维码完成登录；扫码后告知 AI，AI 会重新读取页面并验证登录后状态。';
    }
    if (
      challengeType === 'qr' &&
      guidanceAuthPreference === 'qr' &&
      params.authArtifactStatus.status !== 'ready'
    ) {
      return 'AI 要求扫码登录；Tabrix 已按二维码优先观察，但还没有拿到可发送的二维码图片。请 AI 根据 observedAuthSurface/assistantHandoff 选择二维码目标、刷新二维码，或改用其它登录方式。';
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
    actionOperability,
    semanticEventTypes,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
    scopedText: authScopedRegionText(params.pageRegions),
  });
  const observedAuthSurface = buildObservedAuthSurface({
    authRequired,
    challengeType,
    preferredChallengeType,
    alternativeChallengeTypes,
    assistantGuidance: params.assistantGuidance,
    authArtifactStatus: params.authArtifactStatus,
    semanticEventTypes,
    pageRegions: params.pageRegions,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
  });
  const assistantHandoff = buildAuthCollaborationHandoff({
    authRequired,
    status,
    actionOperability,
    authArtifactStatus: params.authArtifactStatus,
    assistantGuidance: params.assistantGuidance,
    observedAuthSurface,
  });

  return {
    status,
    challengeType,
    preferredChallengeType,
    alternativeChallengeTypes,
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
      artifactExtractionEligibility: ownerGate.allowed ? 'eligible' : 'blocked',
      actionOperability,
      artifactStatus: params.authArtifactStatus.status,
      semanticEventTypes,
      postconditionStatus:
        status === 'succeeded_candidate'
          ? 'candidate_only'
          : status === 'not_proven'
            ? 'not_proven'
            : 'not_evaluated',
      resumeVerification: buildAuthResumeVerification({
        status,
        tabId: params.tabId,
        succeededCandidate,
        succeededCandidateHasFreshComparison,
      }),
      claimBoundary: AUTH_COLLABORATION_CLAIM_BOUNDARY,
    },
    authForm,
    observedAuthSurface,
    assistantHandoff,
    claimBoundary: AUTH_COLLABORATION_CLAIM_BOUNDARY,
  };
}
