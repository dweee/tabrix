import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthQrArtifactRefs,
  buildNotRequestedAuthArtifactStatus,
  canExtractAuthArtifactForTab,
  selectAuthQrArtifactCandidate,
} from '@/entrypoints/background/tools/browser/read-page-auth-artifacts';
import type { ReadPageRegion } from '@tabrix/shared';

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
});
