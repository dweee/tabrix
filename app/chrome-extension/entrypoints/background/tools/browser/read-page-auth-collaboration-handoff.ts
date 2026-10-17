import type {
  ReadPageAssistantGuidance,
  ReadPageAssistantHandoff,
  ReadPageAuthArtifactStatus,
  ReadPageAuthChallengeType,
  ReadPageAuthCollaboration,
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageObservedAuthSurface,
  ReadPageObservedAuthSurfaceCandidate,
  ReadPageRegion,
} from '@tabrix/shared';
import { AUTH_HANDOFF_CLAIM_BOUNDARY } from './read-page-auth-guidance-copy';
import {
  bestElement,
  findRequestOtpControl,
  PHONE_CONTROL_PATTERN,
  OTP_INPUT_PATTERN,
  SUBMIT_PATTERN,
  toControl,
  type AuthFormControlCandidate,
} from './read-page-auth-otp-form';
import { hasExpiredAuthQrSignal, selectAuthQrArtifactCandidates } from './read-page-auth-qr-probe';

export function uniqueChallengeTypes(
  values: Array<ReadPageAuthChallengeType | undefined>,
): ReadPageAuthChallengeType[] {
  const seen = new Set<ReadPageAuthChallengeType>();
  const result: ReadPageAuthChallengeType[] = [];
  for (const value of values) {
    if (!value || value === 'unknown' || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function controlToObservedCandidate(
  kind: ReadPageObservedAuthSurfaceCandidate['kind'],
  control: AuthFormControlCandidate | undefined,
  fallbackReason: string,
): ReadPageObservedAuthSurfaceCandidate | null {
  if (!control?.targetRef && !control?.candidateActionId) return null;
  return {
    kind,
    targetRef: control.targetRef,
    candidateActionId: control.candidateActionId,
    confidence: control.confidence,
    actionability: control.actionability,
    reason: control.reason || fallbackReason,
  };
}

function buildAuthSurfaceCandidates(params: {
  pageRegions?: ReadPageRegion[];
  authArtifactStatus: ReadPageAuthArtifactStatus;
  semanticEventTypes: string[];
  interactiveElements?: ReadPageInteractiveElement[];
  candidateActions?: ReadPageCandidateAction[];
}): ReadPageObservedAuthSurfaceCandidate[] {
  const result: ReadPageObservedAuthSurfaceCandidate[] = [];
  const regions = Array.isArray(params.pageRegions) ? params.pageRegions : [];
  const interactiveElements = Array.isArray(params.interactiveElements)
    ? params.interactiveElements
    : [];
  const candidateActions = Array.isArray(params.candidateActions) ? params.candidateActions : [];

  const surfaceRegion = regions.find((region) => {
    if (region.regionType === 'modal' || region.regionType === 'form') return true;
    if (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)) {
      return true;
    }
    return false;
  });
  if (surfaceRegion) {
    result.push({
      kind: 'auth_surface',
      targetRef: surfaceRegion.objects.find((object) => object.targetRef)?.targetRef,
      confidence: surfaceRegion.confidence ?? 0.6,
      reason: 'auth surface region observed in read_page snapshot',
    });
  }

  for (const candidate of selectAuthQrArtifactCandidates(params.pageRegions, 3)) {
    result.push({
      kind: 'qr_image',
      targetRef: candidate.targetRef,
      selector: candidate.selector,
      confidence: 0.82,
      actionability: 'inspectable',
      reason: 'auth-scoped QR visual candidate from pageRegions',
    });
  }
  if (params.authArtifactStatus.status === 'ready') {
    result.push({
      kind: 'qr_image',
      confidence: 0.92,
      actionability: 'artifact_ready',
      reason: 'auth QR image artifact is ready for user collaboration',
    });
  }

  const phone = bestElement(interactiveElements, PHONE_CONTROL_PATTERN, 'fill');
  const phoneCandidate = controlToObservedCandidate(
    'phone_input',
    phone
      ? toControl(
          'phoneInput',
          phone,
          candidateActions,
          'phone input observed as alternate auth control',
          0.74,
          phone.valueState || 'unknown',
          'fill',
        )
      : undefined,
    'phone input observed as alternate auth control',
  );
  if (phoneCandidate) result.push(phoneCandidate);

  const otp = bestElement(
    interactiveElements.filter((element) => element.ref !== phone?.ref),
    OTP_INPUT_PATTERN,
    'fill',
  );
  const otpCandidate = controlToObservedCandidate(
    'otp_input',
    otp
      ? toControl(
          'otpInput',
          otp,
          candidateActions,
          'otp input observed as alternate auth control',
          0.76,
          otp.valueState || 'unknown',
          'fill',
        )
      : undefined,
    'otp input observed as alternate auth control',
  );
  if (otpCandidate) result.push(otpCandidate);

  const requestOtp = controlToObservedCandidate(
    'request_otp',
    findRequestOtpControl(interactiveElements, candidateActions),
    'otp request control observed as alternate auth action',
  );
  if (requestOtp) result.push(requestOtp);

  const submit = bestElement(interactiveElements, SUBMIT_PATTERN, 'click');
  const submitCandidate = controlToObservedCandidate(
    'submit',
    submit
      ? toControl(
          'submit',
          submit,
          candidateActions,
          'submit control observed as auth action',
          0.68,
          'unknown',
          'click',
        )
      : undefined,
    'submit control observed as auth action',
  );
  if (submitCandidate) result.push(submitCandidate);

  if (
    params.semanticEventTypes.includes('qr_expired_candidate') ||
    hasExpiredAuthQrSignal(params.pageRegions)
  ) {
    const refresh = bestElement(
      interactiveElements,
      /refresh|reload|retry|重新|刷新|换一张/i,
      'click',
    );
    const refreshCandidate = controlToObservedCandidate(
      'refresh_qr',
      refresh
        ? toControl(
            'requestOtp',
            refresh,
            candidateActions,
            'QR refresh-like control observed after expired QR candidate',
            0.62,
            'unknown',
            'click',
          )
        : undefined,
      'QR refresh-like control observed after expired QR candidate',
    );
    if (refreshCandidate) {
      result.push({
        ...refreshCandidate,
        kind: 'refresh_qr',
      });
    }
  }

  return result.slice(0, 12);
}

export function buildObservedAuthSurface(params: {
  authRequired: boolean;
  challengeType: ReadPageAuthChallengeType;
  preferredChallengeType: ReadPageAuthChallengeType;
  alternativeChallengeTypes: ReadPageAuthChallengeType[];
  assistantGuidance?: ReadPageAssistantGuidance;
  authArtifactStatus: ReadPageAuthArtifactStatus;
  semanticEventTypes: string[];
  pageRegions?: ReadPageRegion[];
  interactiveElements?: ReadPageInteractiveElement[];
  candidateActions?: ReadPageCandidateAction[];
}): ReadPageObservedAuthSurface {
  const candidates = buildAuthSurfaceCandidates({
    pageRegions: params.pageRegions,
    authArtifactStatus: params.authArtifactStatus,
    semanticEventTypes: params.semanticEventTypes,
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
  });
  const surfaceRegion = (Array.isArray(params.pageRegions) ? params.pageRegions : []).find(
    (region) =>
      region.regionType === 'modal' ||
      region.regionType === 'form' ||
      (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)),
  );
  const guidanceApplied = Boolean(
    params.assistantGuidance?.authPreference ||
    (params.assistantGuidance?.requestedObjects || []).length > 0 ||
    params.assistantGuidance?.assistantProvidedTarget,
  );
  const qrRequested =
    params.assistantGuidance?.authPreference === 'qr' ||
    (params.assistantGuidance?.requestedObjects || []).includes('qr_image');
  const hasQrCandidate =
    params.authArtifactStatus.status === 'ready' ||
    candidates.some((candidate) => candidate.kind === 'qr_image');
  const status =
    params.authRequired || candidates.length > 0
      ? qrRequested && !hasQrCandidate
        ? 'ambiguous'
        : 'detected'
      : 'not_detected';
  return {
    status,
    surfaceRef: surfaceRegion?.regionId,
    surfaceRole: surfaceRegion?.regionType || (params.authRequired ? 'auth_surface' : 'unknown'),
    preferredChallengeType: params.preferredChallengeType,
    alternativeChallengeTypes: params.alternativeChallengeTypes,
    candidateObjectRefs: candidates,
    guidanceApplied,
    claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY,
  };
}

export function buildAuthCollaborationHandoff(params: {
  authRequired: boolean;
  status: ReadPageAuthCollaboration['status'];
  actionOperability: NonNullable<ReadPageAuthCollaboration['evidence']['actionOperability']>;
  authArtifactStatus: ReadPageAuthArtifactStatus;
  assistantGuidance?: ReadPageAssistantGuidance;
  observedAuthSurface: ReadPageObservedAuthSurface;
}): ReadPageAssistantHandoff {
  const qrRequested =
    params.assistantGuidance?.authPreference === 'qr' ||
    (params.assistantGuidance?.requestedObjects || []).includes('qr_image');
  if (!qrRequested) {
    return { status: 'not_needed', claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY };
  }
  if (params.actionOperability !== 'operable') {
    return {
      status: 'needed',
      reason: 'protected_tab',
      requestedAssistantAction: 'manual_user_action',
      surfaceRef: params.observedAuthSurface.surfaceRef,
      claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY,
    };
  }
  if (params.authArtifactStatus.status === 'ready' || params.status === 'waiting_for_user') {
    return { status: 'not_needed', claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY };
  }
  if (!params.authRequired && params.observedAuthSurface.status === 'not_detected') {
    return { status: 'not_needed', claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY };
  }

  const candidateRefs = params.observedAuthSurface.candidateObjectRefs
    .map((candidate) => candidate.targetRef || candidate.selector || candidate.candidateActionId)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .slice(0, 8);
  const qrCandidates = params.observedAuthSurface.candidateObjectRefs.filter(
    (candidate) => candidate.kind === 'qr_image',
  );
  return {
    status: 'needed',
    reason: qrCandidates.length > 1 ? 'qr_target_ambiguous' : 'target_not_found',
    requestedAssistantAction:
      qrCandidates.length > 0 ? 'choose_auth_qr_target' : 'provide_selector_or_target_ref',
    candidateRefs,
    surfaceRef: params.observedAuthSurface.surfaceRef,
    claimBoundary: AUTH_HANDOFF_CLAIM_BOUNDARY,
  };
}
