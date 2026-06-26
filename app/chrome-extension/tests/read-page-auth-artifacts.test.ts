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
          targetRef: 'tgt_login_qr',
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
    active: true,
  } as any;
}

function browserPageObject(eventTypes: string[], status = 'single_snapshot') {
  return {
    status,
    semanticEvents: eventTypes.map((eventType) => ({ eventType })),
  } as any;
}

function setElementRect(
  element: Element,
  rect: { x: number; y: number; width: number; height: number },
) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      top: rect.y,
      left: rect.x,
      right: rect.x + rect.width,
      bottom: rect.y + rect.height,
      toJSON: () => rect,
    }),
  });
}

describe('read_page auth artifacts', () => {
  beforeEach(() => {
    vi.mocked(chrome.scripting.executeScript).mockReset();
    document.body.innerHTML = '';
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
        active: true,
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

  it('does not return a QR artifact when the auth QR is already expired', async () => {
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn();
    const expiredRegions = authQrRegions().map((region) =>
      region.regionType === 'qr_code'
        ? {
            ...region,
            state: 'waiting_scan_candidate 二维码已过期 点击刷新',
          }
        : region,
    );

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: expiredRegions,
      browserWorldTab: {
        openedBy: 'ai',
        canTabrixOperate: true,
        active: true,
      } as any,
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'failed',
      failureReason: 'auth_qr_expired_refresh_required',
    });
    expect(artifactRefs).toEqual([]);
    expect(prepareFile).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('blocks QR artifact extraction until the target tab is active for scan login continuation', async () => {
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn();

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: authQrRegions(),
      browserWorldTab: {
        openedBy: 'ai',
        canTabrixOperate: true,
        active: false,
      } as any,
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'blocked',
      reason: 'target_tab_not_active_for_auth_qr',
      failureReason: 'switch_target_tab_active_before_qr_login',
    });
    expect(artifactRefs).toEqual([]);
    expect(prepareFile).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not run DOM QR probing when no auth surface is observed', async () => {
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn();

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: [],
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['qr_image'],
      },
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'not_applicable',
      reason: 'auth_scoped_qr_visual_not_found',
      failureReason: 'auth_qr_auth_surface_not_observed',
    });
    expect(artifactRefs).toEqual([]);
    expect(prepareFile).not.toHaveBeenCalled();
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('extracts QR artifact from a targetable auth QR container descendant', async () => {
    document.body.innerHTML = `
      <main>
        <section aria-label="login dialog">
          <div data-testid="login-qr">
            <div class="qr-bitmap" style="background-image: url('data:image/png;base64,BBBB'); width: 180px; height: 180px;"></div>
          </div>
        </section>
      </main>
    `;
    const wrapper = document.querySelector('[data-testid="login-qr"]');
    const bitmap = document.querySelector('.qr-bitmap');
    expect(wrapper).not.toBeNull();
    expect(bitmap).not.toBeNull();
    setElementRect(wrapper as Element, { x: 10, y: 20, width: 190, height: 190 });
    setElementRect(bitmap as Element, { x: 15, y: 25, width: 180, height: 180 });

    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async (options: any) => [
      { result: await options.func(...options.args) },
    ]);
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn().mockResolvedValue({
      filename: 'tabrix_auth_qr.png',
      fullPath: 'C:\\Users\\gsy\\AppData\\Local\\Temp\\tabrix_auth_qr.png',
      size: 512,
    });

    const regions = authQrRegions();
    regions[1].objects[0].locatorChain = [{ type: 'css', value: '[data-testid="login-qr"]' }];
    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: regions,
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'ready',
      artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
    });
    expect(prepareFile).toHaveBeenCalledWith(
      expect.objectContaining({
        base64Data: 'data:image/png;base64,BBBB',
        requestPrefix: 'auth-qr-artifact',
      }),
    );
    expect(artifactRefs[0]).toMatchObject({
      kind: 'auth_qr_image',
      method: 'css_background_data_url',
      width: 180,
      height: 180,
    });
  });

  it('extracts QR artifact from an auth DOM surface when pageRegions lack a QR object', async () => {
    document.body.innerHTML = `
      <section role="dialog" aria-label="Login dialog">
        <h1>Sign in</h1>
        <p>Scan QR code to continue</p>
        <img data-testid="auth-qr-img" alt="QR code" src="data:image/png;base64,CCCC" />
      </section>
    `;
    const dialog = document.querySelector('[role="dialog"]');
    const image = document.querySelector('[data-testid="auth-qr-img"]');
    expect(dialog).not.toBeNull();
    expect(image).not.toBeNull();
    setElementRect(dialog as Element, { x: 30, y: 40, width: 340, height: 420 });
    setElementRect(image as Element, { x: 80, y: 120, width: 180, height: 180 });

    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async (options: any) => [
      { result: await options.func(...options.args) },
    ]);
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
      pageRegions: otpAuthRegions(),
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'ready',
      artifactRef: 'artifact://read_page/tab-9/auth-qr/dom_qr_visual',
    });
    expect(artifactRefs[0]).toMatchObject({
      kind: 'auth_qr_image',
      method: 'img_data_url',
      sourceRegionId: 'auth_surface_dom_probe',
      sourceObjectId: 'dom_qr_visual',
      width: 180,
      height: 180,
    });
  });

  it('uses an assistant-provided QR selector as a scoped extraction target', async () => {
    document.body.innerHTML = `
      <section role="dialog" aria-label="Login dialog">
        <h1>Sign in</h1>
        <img data-testid="assistant-picked-qr" alt="QR code" src="data:image/png;base64,EEEE" />
      </section>
    `;
    const image = document.querySelector('[data-testid="assistant-picked-qr"]');
    expect(image).not.toBeNull();
    setElementRect(image as Element, { x: 80, y: 120, width: 180, height: 180 });

    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async (options: any) => [
      { result: await options.func(...options.args) },
    ]);
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
      pageRegions: [],
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['qr_image'],
        assistantProvidedTarget: {
          purpose: 'auth_qr_image',
          selector: '[data-testid="assistant-picked-qr"]',
        },
      },
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'ready',
      artifactRef: 'artifact://read_page/tab-9/auth-qr/assistant_provided_qr_target',
    });
    expect(artifactRefs[0]).toMatchObject({
      sourceRegionId: 'assistant_guided_auth_surface',
      sourceObjectId: 'assistant_provided_qr_target',
      method: 'img_data_url',
    });
  });

  it('resolves an assistant-provided QR targetRef to the auth-scoped QR selector', async () => {
    document.body.innerHTML = `
      <section role="dialog" aria-label="Login dialog">
        <h1>Sign in</h1>
        <div data-testid="login-qr">
          <img alt="QR code" src="data:image/png;base64,FFFF" />
        </div>
      </section>
    `;
    const image = document.querySelector('[data-testid="login-qr"] img');
    expect(image).not.toBeNull();
    setElementRect(image as Element, { x: 80, y: 120, width: 180, height: 180 });

    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async (options: any) => [
      { result: await options.func(...options.args) },
    ]);
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
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['qr_image'],
        assistantProvidedTarget: {
          purpose: 'auth_qr_image',
          targetRef: 'tgt_login_qr',
        },
      },
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'ready',
      artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
    });
    expect(artifactRefs[0]).toMatchObject({
      sourceRegionId: 'region_qr_code',
      sourceObjectId: 'visual_qr',
      method: 'img_data_url',
    });
  });

  it('fails closed when an assistant-provided QR targetRef is not in auth-scoped candidates', async () => {
    document.body.innerHTML = `
      <section role="dialog" aria-label="Login dialog">
        <h1>Sign in</h1>
        <div data-testid="login-qr">
          <img alt="QR code" src="data:image/png;base64,GGGG" />
        </div>
      </section>
    `;
    const artifactRefs: any[] = [];
    const prepareFile = vi.fn();

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: authQrRegions(),
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['qr_image'],
        assistantProvidedTarget: {
          purpose: 'auth_qr_image',
          targetRef: 'tgt_missing_qr',
        },
      },
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'not_applicable',
      reason: 'auth_scoped_qr_visual_not_found',
      failureReason: 'assistant_target_ref_not_resolved',
    });
    expect(chrome.scripting.executeScript).not.toHaveBeenCalled();
    expect(prepareFile).not.toHaveBeenCalled();
    expect(artifactRefs).toEqual([]);
  });

  it('does not extract ordinary content QR images as auth QR artifacts', async () => {
    document.body.innerHTML = `
      <article>
        <h1>Article with a QR image</h1>
        <img data-testid="content-qr" alt="QR code" src="data:image/png;base64,DDDD" />
      </article>
    `;
    const article = document.querySelector('article');
    const image = document.querySelector('[data-testid="content-qr"]');
    expect(article).not.toBeNull();
    expect(image).not.toBeNull();
    setElementRect(article as Element, { x: 10, y: 10, width: 500, height: 600 });
    setElementRect(image as Element, { x: 60, y: 120, width: 180, height: 180 });

    vi.mocked(chrome.scripting.executeScript).mockImplementationOnce(async (options: any) => [
      { result: await options.func(...options.args) },
    ]);
    const prepareFile = vi.fn();
    const artifactRefs: any[] = [];

    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: [],
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      nowMs: 1000,
      prepareFile,
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'not_applicable',
      reason: 'auth_scoped_qr_visual_not_found',
    });
    expect(prepareFile).not.toHaveBeenCalled();
    expect(artifactRefs).toEqual([]);
  });

  it('fails QR screenshot fallback when the target tab is not the active visible tab', async () => {
    vi.mocked(chrome.scripting.executeScript).mockResolvedValueOnce([
      {
        result: {
          method: 'element_screenshot',
          width: 180,
          height: 180,
          rect: { x: 10, y: 20, width: 180, height: 180 },
          devicePixelRatio: 1,
        },
      },
    ] as any);
    vi.mocked(chrome.tabs.query).mockResolvedValueOnce([{ id: 10 }] as any);

    const artifactRefs: any[] = [];
    const status = await buildAuthQrArtifactRefs({
      includeAuthArtifacts: true,
      tabId: 9,
      windowId: 1,
      pageRegions: authQrRegions(),
      browserWorldTab: aiOwnedTab(),
      artifactRefs,
      nowMs: 1000,
      prepareFile: vi.fn(),
    });

    expect(status).toMatchObject({
      requested: true,
      status: 'failed',
      failureReason: 'auth_qr_screenshot_fallback_target_tab_not_active',
    });
    expect(artifactRefs).toEqual([]);
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
        artifactExtractionEligibility: 'eligible',
        actionOperability: 'operable',
        artifactStatus: 'ready',
        postconditionStatus: 'not_evaluated',
        resumeVerification: {
          status: 'required_after_user_action',
          nextTool: 'chrome_read_page',
          forceRefreshRequired: true,
          sameTabRequired: true,
          targetTabId: 9,
          postconditionRequired: true,
        },
      },
    });
    expect(collaboration.evidence.resumeVerification?.requiredSignals).toEqual(
      expect.arrayContaining([
        'same_tab_binding_preserved',
        'auth_surface_disappeared',
        'logged_in_or_account_state_candidate_visible',
      ]),
    );
    expect(collaboration.userAction.instruction).toContain('扫码');
  });

  it('keeps QR collaboration when a ready QR artifact appears beside OTP controls', () => {
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
      interactiveElements: [
        {
          ref: 'ref_phone',
          type: 'input',
          text: '手机号',
          label: '手机号',
          placeholder: '手机号',
          valueState: 'empty',
          actionability: 'actionable',
        } as any,
        {
          ref: 'ref_otp',
          type: 'input',
          text: '验证码',
          label: '验证码',
          placeholder: '验证码',
          valueState: 'empty',
          actionability: 'actionable',
        } as any,
        {
          ref: 'ref_request_otp',
          type: 'button',
          text: '获取验证码',
          label: '获取验证码',
          actionability: 'actionable',
        } as any,
      ],
    });

    expect(collaboration).toMatchObject({
      status: 'waiting_for_user',
      challengeType: 'qr',
      userAction: {
        artifactRef: 'artifact://read_page/tab-9/auth-qr/visual_qr',
      },
    });
    expect(collaboration.userAction.instruction).toContain('扫描二维码');
    expect(collaboration.authForm).toBeUndefined();
  });

  it('honors assistant QR guidance and keeps OTP controls as alternatives only', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: authQrRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { valueState: 'non_empty' },
        ref_agreement: { checked: true },
      }),
      candidateActions: otpCandidateActions(),
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['auth_surface', 'qr_image'],
      },
    });

    expect(collaboration).toMatchObject({
      status: 'required',
      challengeType: 'qr',
      preferredChallengeType: 'qr',
      alternativeChallengeTypes: ['otp'],
      observedAuthSurface: {
        status: 'detected',
        preferredChallengeType: 'qr',
        guidanceApplied: true,
      },
      assistantHandoff: {
        status: 'needed',
        requestedAssistantAction: 'choose_auth_qr_target',
      },
    });
    expect(collaboration.authForm).toBeUndefined();
    expect(collaboration.observedAuthSurface?.candidateObjectRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'qr_image' }),
        expect.objectContaining({ kind: 'phone_input', targetRef: 'ref_phone' }),
        expect.objectContaining({ kind: 'otp_input', targetRef: 'ref_otp' }),
      ]),
    );
    expect(collaboration.userAction.instruction).toContain('AI 要求扫码登录');
  });

  it('returns an auth collaboration handoff when QR guidance cannot find a QR target', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: 'run_owned',
        claimBoundary: 'artifact boundary',
      },
      artifactRefs: [],
      interactiveElements: otpInteractive(),
      candidateActions: otpCandidateActions(),
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['auth_surface', 'qr_image'],
      },
    });

    expect(collaboration).toMatchObject({
      challengeType: 'qr',
      preferredChallengeType: 'qr',
      alternativeChallengeTypes: ['otp'],
      observedAuthSurface: {
        status: 'ambiguous',
        guidanceApplied: true,
      },
      assistantHandoff: {
        status: 'needed',
        reason: 'target_not_found',
        requestedAssistantAction: 'provide_selector_or_target_ref',
      },
    });
    expect(collaboration.authForm).toBeUndefined();
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
      interactiveElements: otpInteractive(),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      challengeType: 'qr',
      userAction: { required: true },
      evidence: { postconditionStatus: 'not_proven' },
    });
    expect(collaboration.authForm).toBeUndefined();
    expect(collaboration.userAction.instruction).toContain('过期');
  });

  it('surfaces refresh QR candidate when expired text is only present in page regions', () => {
    const expiredRegions = authQrRegions().map((region) =>
      region.regionType === 'qr_code'
        ? {
            ...region,
            state: 'waiting_scan_candidate 二维码已过期 点击刷新',
          }
        : region,
    );
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: expiredRegions,
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: {
        requested: true,
        status: 'not_applicable',
        reason: 'auth_scoped_qr_visual_not_found',
        ownerType: 'run_owned',
        claimBoundary: 'artifact boundary',
      },
      artifactRefs: [],
      interactiveElements: [
        ...otpInteractive(),
        {
          ref: 'ref_refresh_qr',
          role: 'button',
          name: '点击刷新',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      ],
      candidateActions: [
        ...otpCandidateActions(),
        {
          id: 'ca_refresh_qr',
          actionType: 'click',
          targetRef: 'ref_refresh_qr',
          confidence: 0.91,
          matchReason: 'refresh QR action',
          locatorChain: [{ type: 'ref', value: 'ref_refresh_qr' }],
        },
      ],
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['auth_surface', 'qr_image'],
      },
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      challengeType: 'qr',
      userAction: { required: true },
    });
    expect(collaboration.observedAuthSurface?.candidateObjectRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'refresh_qr', targetRef: 'ref_refresh_qr' }),
      ]),
    );
    expect(collaboration.authForm).toBeUndefined();
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
      assistantGuidance: {
        taskKind: 'auth',
        authPreference: 'qr',
        requestedObjects: ['auth_surface', 'qr_image'],
      },
    });

    expect(collaboration).toMatchObject({
      status: 'not_proven',
      evidence: {
        operationBinding: 'protected_or_unknown_tab',
        artifactExtractionEligibility: 'blocked',
        actionOperability: 'protected_or_unknown',
        ownerType: 'user_owned',
      },
      assistantHandoff: {
        status: 'needed',
        reason: 'protected_tab',
        requestedAssistantAction: 'manual_user_action',
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
        resumeVerification: {
          status: 'postcondition_required',
          forceRefreshRequired: false,
          sameTabRequired: true,
          targetTabId: 9,
          postconditionRequired: true,
        },
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
        resumeVerification: {
          status: 'fresh_read_required',
          nextTool: 'chrome_read_page',
          forceRefreshRequired: true,
          sameTabRequired: true,
          targetTabId: 9,
          postconditionRequired: true,
        },
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

  it('keeps auth form controls privacy-safe and strips raw aria labels from locator chains', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { name: '手机号 15705171303', valueState: 'non_empty' },
        ref_otp: { name: '验证码 134336' },
        ref_agreement: { checked: true },
      }),
      candidateActions: [
        {
          id: 'ca_fill_ref_phone',
          actionType: 'fill',
          targetRef: 'ref_phone',
          confidence: 0.68,
          matchReason: 'form input candidate from structured snapshot',
          locatorChain: [
            { type: 'aria', value: '手机号 15705171303' },
            { type: 'ref', value: 'ref_phone' },
          ],
        },
        {
          id: 'ca_fill_ref_otp',
          actionType: 'fill',
          targetRef: 'ref_otp',
          confidence: 0.68,
          matchReason: 'form input candidate from structured snapshot',
          locatorChain: [
            { type: 'aria', value: '验证码 134336' },
            { type: 'ref', value: 'ref_otp' },
          ],
        },
      ],
    });

    const payload = JSON.stringify(collaboration.authForm);
    expect(payload).not.toContain('15705171303');
    expect(payload).not.toContain('134336');
    expect(collaboration.authForm?.controls.phoneInput).toMatchObject({
      label: 'phone_input',
      locatorChain: [{ type: 'ref', value: 'ref_phone' }],
    });
    expect(collaboration.authForm?.controls.otpInput).toMatchObject({
      label: 'otp_input',
      locatorChain: [{ type: 'ref', value: 'ref_otp' }],
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

  it('chooses a visible OTP sender button over a placeholder-only OTP textbox', () => {
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
        }).filter((element) => element.ref !== 'ref_request_otp' && element.ref !== 'ref_otp'),
        {
          ref: 'ref_otp',
          role: 'textbox',
          name: '获取验证码',
          valueState: 'empty',
          matchSource: 'placeholder',
          actionability: 'not_actionable',
        },
        {
          ref: 'ref_code_button',
          role: 'button',
          name: '获取验证码',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      ],
      candidateActions: [
        ...otpCandidateActions().filter((action) => action.targetRef !== 'ref_request_otp'),
        {
          id: 'ca_click_ref_code_button',
          actionType: 'click',
          targetRef: 'ref_code_button',
          confidence: 0.93,
          matchReason: 'primary action inferred from interactive label',
          locatorChain: [{ type: 'css', value: '.code-button.active' }],
          intent: 'auth.request_otp',
        },
      ],
    });

    expect(collaboration.authForm).toMatchObject({
      readiness: 'ready_to_request_otp',
      nextAction: 'request_otp',
      controls: {
        requestOtp: {
          targetRef: 'ref_code_button',
          candidateActionId: 'ca_click_ref_code_button',
          locatorChain: [{ type: 'css', value: '.code-button.active' }],
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      },
    });
  });

  it('does not map login or OTP request buttons as fillable OTP inputs', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: [
        {
          ref: 'ref_phone_tab',
          role: 'button',
          name: '手机号登录',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
        {
          ref: 'ref_request_otp',
          role: 'button',
          name: '获取验证码',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      ],
      candidateActions: [
        {
          id: 'ca_click_ref_request_otp',
          actionType: 'click',
          targetRef: 'ref_request_otp',
          confidence: 0.93,
          matchReason: 'primary action inferred from interactive label',
          locatorChain: [{ type: 'css', value: '.code-button' }],
          intent: 'auth.request_otp',
        },
      ],
    });

    expect(collaboration.authForm?.controls.phoneInput).toBeUndefined();
    expect(collaboration.authForm?.controls.otpInput).toBeUndefined();
    expect(collaboration.authForm?.controls.requestOtp).toMatchObject({
      targetRef: 'ref_request_otp',
      candidateActionId: 'ca_click_ref_request_otp',
      actionability: 'actionable',
    });
  });

  it('classifies a visible OTP form as OTP even when QR copy is also present', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: authQrRegions(),
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

    expect(collaboration.challengeType).toBe('otp');
    expect(collaboration.authForm).toMatchObject({
      formType: 'otp',
      controls: {
        phoneInput: { targetRef: 'ref_phone' },
        otpInput: { targetRef: 'ref_otp' },
        requestOtp: { targetRef: 'ref_request_otp' },
      },
    });
  });

  it('does not map legal agreement links as the agreement checkbox control', () => {
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
        }).filter((element) => element.ref !== 'ref_agreement'),
        {
          ref: 'ref_terms_link',
          role: 'link',
          name: '《用户协议》',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
        {
          ref: 'ref_privacy_link',
          role: 'link',
          name: '《隐私政策》',
          matchSource: 'visible_text',
          actionability: 'actionable',
        },
      ],
      candidateActions: otpCandidateActions().filter(
        (action) => action.targetRef !== 'ref_agreement',
      ),
    });

    expect(collaboration.authForm?.controls.agreementCheckbox).toBeUndefined();
    expect(collaboration.authForm).toMatchObject({
      readiness: 'ready_to_request_otp',
      nextAction: 'request_otp',
    });
  });

  it('does not report login success while an OTP login form is still visible', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: null,
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_succeeded_candidate'], 'compared_snapshot'),
      browserWorldTab: aiOwnedTab(),
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
      evidence: {
        postconditionStatus: 'not_proven',
      },
    });
    expect(collaboration.authForm?.readiness).not.toBe('login_succeeded_candidate');
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

  it('does not turn otp_requested_candidate into proof that an OTP was sent', () => {
    const collaboration = buildAuthCollaborationState({
      pageRole: 'login_required',
      tabId: 9,
      pageRegions: otpAuthRegions(),
      browserPageObject: browserPageObject(['auth_required_candidate', 'otp_requested_candidate']),
      browserWorldTab: aiOwnedTab(),
      authArtifactStatus: buildNotRequestedAuthArtifactStatus(),
      artifactRefs: [],
      interactiveElements: otpInteractive({
        ref_phone: { valueState: 'non_empty' },
        ref_agreement: { checked: true },
      }),
      candidateActions: otpCandidateActions(),
    });

    expect(collaboration.authForm?.readiness).toBe('not_proven');
    expect(collaboration.authForm?.nextAction).toBe('not_proven');
    expect(collaboration.authForm?.readiness).not.toBe('otp_requested');
    expect(collaboration.authForm?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'otp_request_candidate_only',
          control: 'requestOtp',
        }),
      ]),
    );
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
