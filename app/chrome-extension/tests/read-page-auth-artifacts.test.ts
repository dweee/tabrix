import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthCollaborationState,
  buildAuthQrArtifactRefs,
  buildNotRequestedAuthArtifactStatus,
  canExtractAuthArtifactForTab,
  selectAuthQrArtifactCandidate,
} from '@/entrypoints/background/tools/browser/read-page-auth-artifacts';
import type {
  ReadPageCandidateAction,
  ReadPageInteractiveElement,
  ReadPageRegion,
} from '@tabrix/shared';

function authQrRegions(): ReadPageRegion[] {
  return [
    {
      regionId: 'region_account',
      regionType: 'account',
      state: 'logged_out_candidate',
      label: 'Account login state candidate',
      objects: [],
      candidateActionIds: [],
      targetability: 'unknown',
      claimBoundary: 'candidate only',
    },
    {
      regionId: 'region_qr_code',
      regionType: 'qr_code',
      state: 'waiting_scan_candidate',
      label: 'QR scan area candidate',
      objects: [
        {
          objectId: 'visual_qr',
          objectType: 'qr_visual:visual_22222222',
          label: 'QR visual element candidate',
          role: 'img',
          actionTypes: ['capture_element'],
          targetability: 'locator_chain',
          locatorChain: [{ type: 'css', value: '[data-testid="login-qr"] img' }],
          confidence: 0.82,
          reason: 'qr_visual_element_signal',
        },
      ],
      candidateActionIds: [],
      targetability: 'locator_chain',
      claimBoundary: 'qr region candidate only',
    },
  ];
}

function otpAuthRegions(): ReadPageRegion[] {
  return [
    {
      regionId: 'region_modal',
      regionType: 'modal',
      state: 'auth otp login required candidate',
      label: 'Phone verification code login dialog',
      objects: [],
      candidateActionIds: [],
      targetability: 'unknown',
      confidence: 0.8,
      claimBoundary: 'auth form candidate only',
    },
  ];
}

function otpCandidateActions(): ReadPageCandidateAction[] {
  return [
    {
      id: 'ca_fill_ref_phone',
      actionType: 'fill',
      targetRef: 'ref_phone',
      confidence: 0.68,
      matchReason: 'form input candidate from structured snapshot',
      locatorChain: [{ type: 'ref', value: 'ref_phone' }],
    },
    {
      id: 'ca_fill_ref_otp',
      actionType: 'fill',
      targetRef: 'ref_otp',
      confidence: 0.68,
      matchReason: 'form input candidate from structured snapshot',
      locatorChain: [{ type: 'ref', value: 'ref_otp' }],
    },
    {
      id: 'ca_click_ref_request_otp',
      actionType: 'click',
      targetRef: 'ref_request_otp',
      confidence: 0.93,
      matchReason: 'primary action inferred from interactive label',
      locatorChain: [{ type: 'ref', value: 'ref_request_otp' }],
    },
    {
      id: 'ca_click_ref_agreement',
      actionType: 'click',
      targetRef: 'ref_agreement',
      confidence: 0.93,
      matchReason: 'primary action inferred from interactive label',
      locatorChain: [{ type: 'ref', value: 'ref_agreement' }],
    },
    {
      id: 'ca_click_ref_confirm',
      actionType: 'click',
      targetRef: 'ref_confirm',
      confidence: 0.93,
      matchReason: 'primary action inferred from interactive label',
      locatorChain: [{ type: 'ref', value: 'ref_confirm' }],
    },
  ];
}

function otpInteractive(
  overrides: Partial<Record<string, Partial<ReadPageInteractiveElement>>> = {},
) {
  const elements: ReadPageInteractiveElement[] = [
    {
      ref: 'ref_phone',
      role: 'textbox',
      name: '手机号',
      valueState: 'empty',
    },
    {
      ref: 'ref_otp',
      role: 'textbox',
      name: '验证码',
      valueState: 'empty',
    },
    {
      ref: 'ref_request_otp',
      role: 'button',
      name: '获取验证码',
    },
    {
      ref: 'ref_agreement',
      role: 'checkbox',
      name: '我已阅读并同意用户协议和隐私政策',
      checked: false,
    },
  ];
  return elements.map((element) => ({ ...element, ...(overrides[element.ref] || {}) }));
}

function aiOwnedTab() {
  return {
    openedBy: 'ai',
    canTabrixOperate: true,
  } as any;
}

function browserPageObject(eventTypes: string[], status = 'single_snapshot') {
  return {
    status,
    semanticEvents: eventTypes.map((eventType) => ({ eventType })),
  } as any;
}

describe('read_page auth artifacts', () => {
  beforeEach(() => {
    vi.mocked(chrome.scripting.executeScript).mockReset();
  });

  it('keeps includeAuthArtifacts=false as status-only and artifact-free', () => {
    expect(buildNotRequestedAuthArtifactStatus()).toMatchObject({
      requested: false,
      status: 'not_requested',
      reason: 'includeAuthArtifacts_false',
    });
  });

  it('selects only an auth-scoped QR visual candidate', () => {
    expect(selectAuthQrArtifactCandidate(authQrRegions())).toMatchObject({
      regionId: 'region_qr_code',
      objectId: 'visual_qr',
      selector: '[data-testid="login-qr"] img',
    });
  });

  it('does not treat ordinary content QR as login collaboration QR', () => {
    const contentQrOnly: ReadPageRegion[] = [
      {
        regionId: 'region_qr_code',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        label: 'QR scan area candidate',
        objects: [
          {
            objectId: 'article_qr',
            objectType: 'qr_visual:visual_33333333',
            label: 'QR visual element candidate',
            role: 'img',
            actionTypes: ['capture_element'],
            targetability: 'locator_chain',
            locatorChain: [{ type: 'css', value: 'article img.qr' }],
            confidence: 0.82,
            reason: 'qr_visual_element_signal',
          },
        ],
        candidateActionIds: [],
        targetability: 'locator_chain',
        claimBoundary: 'qr region candidate only',
      },
    ];

    expect(selectAuthQrArtifactCandidate(contentQrOnly)).toBeNull();
  });

  it('blocks QR extraction on user-owned protected tabs', () => {
    expect(
      canExtractAuthArtifactForTab({
        tabId: 5,
        windowId: 1,
        index: 0,
        active: true,
        highlighted: true,
        selected: true,
        pinned: false,
        incognito: false,
        discarded: false,
        autoDiscardable: true,
        audible: false,
        muted: false,
        groupId: -1,
        openerTabId: null,
        status: 'complete',
        title: 'User page',
        url: 'https://example.com',
        pendingUrl: null,
        favIconUrl: null,
        width: 1000,
        height: 800,
        openedBy: 'user_or_page',
        openedBySource: 'user_or_unknown',
        openedByConfidence: 0.9,
        openedByReason: 'seed_existing_tab',
        canTabrixOperate: false,
        operabilityReason: 'protect_user_owned_tab',
        cleanupEligibility: 'protected',
        cleanupReason: 'protect_user_owned_tab',
        aiOperationState: 'idle',
        lastAiOperation: null,
        lastAiOperationAtMs: null,
        lastAiOperationConfidence: null,
        lastAiOperationReason: null,
        observedAtMs: 1,
      } as any),
    ).toMatchObject({
      allowed: false,
      ownerType: 'user_owned',
      reason: 'current_tab_not_ai_owned_for_auth_artifact',
    });
  });

  it('returns an auth_qr_image artifact only when explicitly requested and allowed', async () => {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          dataUrl: 'data:image/png;base64,AAAA',
          method: 'img_data_url',
          width: 180,
          height: 180,
        },
      },
    ] as any);
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn().mockResolvedValue({
      filename: 'tabrix_auth_qr.png',
      fullPath: 'C:\\Users\\gsy\\AppData\\Local\\Temp\\tabrix_auth_qr.png',
      size: 512,
    });

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: authQrRegions(),
      browserWorldTab: {
        openedBy: 'ai',
        canTabrixOperate: true,
      } as any,
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'ready',
      artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
    });
    expect(artifactRefs).toEqual([
      expect.objectContaining({
        kind: 'auth_qr_image',
        ref: 'artifact://read_page/tab-9/auth-qr/visual_qr',
        localPath: 'C:\\Users\\gsy\\AppData\\Local\\Temp\\tabrix_auth_qr.png',
        width: 180,
        height: 180,
        producedAtMs: 1000,
        expiresAtMs: 121000,
        method: 'img_data_url',
        sourceRegionId: 'region_qr_code',
        sourceObjectId: 'visual_qr',
      }),
    ]);
  });

  it('builds waiting_for_user collaboration state for a ready QR artifact', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: authQrRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate', 'qr_waiting']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: {
        requested: true,
        status: 'ready',
        reason: 'auth_qr_image_artifact_ready',
        artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
        ownerType: 'run_owned',
        claimBoundary: 'artifact boundary',
      },
      artifactRefs: [
        {
          kind: 'auth_qr_image',
          ref: 'artifact://read_page/tab-9/auth-qr/visual_qr',
          expiresAtMs: 121000,
        },
      ],
    });

    expect(collaboration).toMatchObject({
      status: 'waiting_for_user',
      challengeType: 'qr',
      userAction: {
        required: true,
        artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
        expiresAtMs: 121000,
      },
      evidence: {
        operationBinding: 'ai_operable_tab',
        artifactStatus: 'ready',
        postconditionStatus: 'not_evaluated',
      },
    });
    expect(collaboration.userAction.instruction).toContain('扫码');
  });

  it('keeps content QR pages out of login collaboration', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'web_page',
      tabId: 9,
      pageRegions: [
        {
          regionId: 'region_content',
          regionType: 'content',
          state: 'content_available_candidate',
          label: 'Article with QR image',
          objects: [
            {
              objectId: 'article_qr',
              objectType: 'qr_visual:visual_33333333',
              label: 'QR visual element candidate',
              role: 'img',
              actionTypes: ['capture_element'],
              targetability: 'not_clickable',
              confidence: 0.82,
              reason: 'content image candidate',
            },
          ],
          candidateActionIds: [],
          targetability: 'not_clickable',
          claimBoundary: 'content candidate only',
        },
      ],
      browserPageObject: browserPageObject([]),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'not_required',
      challengeType: 'unknown',
      userAction: { required: false },
    });
  });

  it('marks expired QR collaboration as not_proven instead of waiting', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: authQrRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate', 'qr_expired_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: 'run_owned',
        claimBoundary: 'artifact boundary',
      },
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      challengeType: 'qr',
      userAction: { required: true },
      evidence: { postconditionStatus: 'not_proven' },
    });
    expect(collaboration.userAction.instruction).toContain('过期');
  });

  it('blocks login collaboration on protected user-owned tabs', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 5,
      pageRegions: authQrRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate', 'qr_waiting']),
      browserWorldTab: {
        openedBy: 'user_or_page',
        canTabrixOperate: false,
      } as any,
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      evidence: {
        operationBinding: 'protected_or_unknown_tab',
        ownerType: 'user_owned',
      },
    });
    expect(collaboration.userAction.instruction).toContain('明确授权');
  });

  it('classifies non-QR verification as user action required', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: [
        {
          regionId: 'region_modal',
          regionType: 'modal',
          state: 'security challenge required candidate',
          label: 'Human verification challenge',
          objects: [],
          candidateActionIds: [],
          targetability: 'unknown',
          claimBoundary: 'auth challenge candidate only',
        },
      ],
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'required',
      challengeType: 'captcha',
      userAction: { required: true },
    });
    expect(collaboration.userAction.instruction).toContain('验证');
  });

  it('reports auth success only as a candidate postcondition', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'web_page',
      tabId: 9,
      pageRegions: [
        {
          regionId: 'region_account',
          regionType: 'account',
          state: 'logged_in_candidate',
          label: 'Account state candidate',
          objects: [],
          candidateActionIds: [],
          targetability: 'unknown',
          claimBoundary: 'account candidate only',
        },
      ],
      browserPageObject: browserPageObject(['auth_succeeded_candidate'], 'compared_snapshot'),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'succeeded_candidate',
      challengeType: 'unknown',
      userAction: { required: false },
      evidence: {
        pageFreshness: 'compared_snapshot',
        postconditionStatus: 'candidate_only',
      },
    });
    expect(collaboration.claimBoundary).toContain('not proof of login success');
  });

  it('does not treat stale auth success candidates as login proof', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'web_page',
      tabId: 9,
      pageRegions: [
        {
          regionId: 'region_account',
          regionType: 'account',
          state: 'logged_in_candidate',
          label: 'Account state candidate',
          objects: [],
          candidateActionIds: [],
          targetability: 'unknown',
          claimBoundary: 'account candidate only',
        },
      ],
      browserPageObject: browserPageObject(['auth_succeeded_candidate'], 'single_snapshot'),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      evidence: {
        pageFreshness: 'single_snapshot',
        postconditionStatus: 'not_proven',
      },
    });
    expect(collaboration.userAction.instruction).toContain('强制重新读取');
  });

  it('maps an OTP login form and blocks on an unchecked agreement checkbox', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive(),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration).toMatchObject({
      status: 'required',
      challengeType: 'otp',
      authForm: {
        formType: 'otp',
        readiness: 'blocked_by_agreement',
        nextAction: 'accept_terms',
        controls: {
          phoneInput: {
            targetRef: 'ref_phone',
            valueState: 'empty',
            candidateActionId: 'ca_fill_ref_phone',
          },
          otpInput: {
            targetRef: 'ref_otp',
            candidateActionId: 'ca_fill_ref_otp',
          },
          requestOtp: {
            targetRef: 'ref_request_otp',
            actionability: 'actionable',
            candidateActionId: 'ca_click_ref_request_otp',
          },
          agreementCheckbox: {
            targetRef: 'ref_agreement',
            state: 'unchecked',
          },
        },
      },
    });
    expect(collaboration.authForm?.blockers[0]).toMatchObject({
      kind: 'agreement_required',
      control: 'agreementCheckbox',
    });
  });

  it('prioritizes the agreement confirmation dialog before requesting OTP', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: [
        ...otpInteractive({
          ref_phone: { valueState: 'non_empty' },
          ref_agreement: { checked: true },
        }),
        {
          ref: 'ref_confirm',
          role: 'button',
          name: '同意并继续',
        },
      ],
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'blocked_by_agreement',
      nextAction: 'confirm_agreement',
      controls: {
        agreementConfirm: {
          targetRef: 'ref_confirm',
          candidateActionId: 'ca_click_ref_confirm',
        },
      },
    });
  });

  it('marks an OTP form ready only after phone is filled and agreement is accepted', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { valueState: 'non_empty' },
        ref_agreement: { checked: true },
      }),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'ready_to_request_otp',
      nextAction: 'request_otp',
      controls: {
        phoneInput: { valueState: 'non_empty' },
        requestOtp: { targetRef: 'ref_request_otp' },
      },
      blockers: [],
    });
  });

  it('maps a custom DOM OTP sender to an actionable request control with locator evidence', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: [
        ...otpInteractive({
          ref_phone: { valueState: 'non_empty' },
          ref_agreement: { checked: true },
        }).filter((element) => element.ref !== 'ref_request_otp'),
        {
          ref: 'ref_custom_request_otp',
          role: 'button',
          name: '获取验证码',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      ],
      candidateActions: [
        ...otpCandidateActions().filter((action) => action.targetRef !== 'ref_request_otp'),
        {
          id: 'ca_click_ref_custom_request_otp',
          actionType: 'click',
          targetRef: 'ref_custom_request_otp',
          confidence: 0.93,
          matchReason: 'primary action inferred from interactive label',
          locatorChain: [{ type: 'css', value: '.custom-otp-send' }],
          intent: 'auth.request_otp',
        },
      ],
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'ready_to_request_otp',
      nextAction: 'request_otp',
      controls: {
        requestOtp: {
          targetRef: 'ref_custom_request_otp',
          candidateActionId: 'ca_click_ref_custom_request_otp',
          locatorChain: [{ type: 'css', value: '.custom-otp-send' }],
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      },
    });
  });

  it('does not treat a placeholder-only OTP action match as a clickable request button', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: [
        ...otpInteractive({
          ref_phone: { valueState: 'non_empty' },
          ref_agreement: { checked: true },
        }).filter((element) => element.ref !== 'ref_request_otp'),
        {
          ref: 'ref_placeholder_request',
          role: 'textbox',
          name: '获取验证码',
          valueState: 'empty',
          matchSource: 'placeholder',
          actionability: 'not_actionable',
        },
      ],
      candidateActions: otpCandidateActions().filter(
        (action) => action.targetRef !== 'ref_request_otp',
      ),
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'not_proven',
      nextAction: 'not_proven',
      controls: {
        requestOtp: {
          targetRef: 'ref_placeholder_request',
          state: 'not_actionable',
          actionability: 'not_actionable',
        },
      },
    });
    expect(collaboration.authForm?.blockers[0]).toMatchObject({
      kind: 'target_not_actionable',
      control: 'requestOtp',
    });
  });

  it('recognizes an OTP countdown as waiting for the user to enter the code', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { valueState: 'non_empty' },
        ref_request_otp: { name: '59秒后重新发送' },
        ref_agreement: { checked: true },
      }),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'waiting_for_user_otp',
      nextAction: 'wait_for_user_otp',
      controls: {
        requestOtp: {
          state: 'countdown',
        },
      },
    });
  });

  it('does not allow OTP collaboration actions on protected user-owned tabs', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: {
        openedBy: 'user_or_page',
        canTabrixOperate: false,
      } as any,
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { valueState: 'non_empty' },
        ref_agreement: { checked: true },
      }),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      authForm: {
        readiness: 'not_proven',
        nextAction: 'manual_user_action',
      },
    });
    expect(collaboration.authForm?.blockers[0]).toMatchObject({ kind: 'protected_tab' });
  });
});
