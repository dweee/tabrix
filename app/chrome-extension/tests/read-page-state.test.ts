import { describe, expect, it } from 'vitest';
import type { ReadPageCDPSensingSummary } from '@tabrix/shared';
import { buildLoadReadiness } from '@/entrypoints/background/tools/browser/read-page-state';

function cdpSensing(overrides: Partial<ReadPageCDPSensingSummary> = {}): ReadPageCDPSensingSummary {
  return {
    source: 'cdp_page_sensing',
    available: true,
    readiness: 'unknown',
    likelyLoading: false,
    networkActivity: {
      requestStartedCount: 0,
      inFlightCount: 0,
      failedRequestCount: 0,
    },
    networkResources: {
      resourceEntryCount: 0,
      resourceInFlightCount: 0,
      failedResourceStatusCount: 0,
    },
    console: {
      errorCount: 0,
      warningCount: 0,
    },
    accessibility: {
      totalNodes: 2,
      actionableNodeCount: 1,
      actionableRoleTop: [{ role: 'textbox', count: 1 }],
      actionableSampleLabels: ['Search'],
      stateSignals: {
        checkedCount: 0,
        selectedCount: 0,
        expandedCount: 0,
        disabledCount: 0,
      },
      locatorCoverage: {
        locatorCandidateCount: 1,
        axNodeIdCount: 1,
        backendDOMNodeIdCount: 1,
        locatorCoverageRate: 1,
      },
      objectCandidates: [
        {
          role: 'textbox',
          label: 'Search',
          locator: {
            source: 'cdp_ax',
            backendDOMNodeId: 42,
            cssSelector: '#search',
            visualBounds: { x: 20, y: 20, width: 320, height: 40 },
          },
          actionTypes: ['fill'],
          state: {},
          visibilityProbe: {
            domVisible: true,
            inViewport: true,
            centerHitTarget: null,
            occluded: false,
            reason: 'cdp_ax_box_model',
          },
        },
      ],
    },
    claimBoundary: 'test fixture',
    ...overrides,
  };
}

function loadingReadiness(overrides: Partial<Parameters<typeof buildLoadReadiness>[0]> = {}) {
  return buildLoadReadiness({
    pageStability: 'loading',
    initialTabStatus: 'loading',
    finalTabStatus: 'loading',
    waitedForPendingDocument: true,
    settleResult: {
      settled: false,
      timedOut: true,
      reason: 'timeout',
      waitedMs: 5_000,
      readyState: null,
    },
    cdpSensing: cdpSensing(),
    ...overrides,
  });
}

function stableReadiness(overrides: Partial<Parameters<typeof buildLoadReadiness>[0]> = {}) {
  return buildLoadReadiness({
    pageStability: 'stable',
    initialTabStatus: 'complete',
    finalTabStatus: 'complete',
    waitedForPendingDocument: false,
    settleResult: null,
    cdpSensing: cdpSensing(),
    ...overrides,
  });
}

describe('read-page CDP and AX load readiness', () => {
  it('allows one provisional locator-backed action when Chrome loading is stale but CDP is quiet', () => {
    const readiness = loadingReadiness();

    expect(readiness).toMatchObject({
      status: 'cdp_ax_actionable_after_wait',
      canUseSnapshotForBusinessAction: true,
      nextStepAction: 'proceed',
      nextStepHint: 'use_current_cdp_ax_candidate_then_immediately_force_fresh_same_tab_read',
    });
    expect(readiness.claimBoundary).toContain('provisionally actionable');
    expect(readiness.claimBoundary).toContain('immediate fresh same-tab read');
  });

  it('allows a provisional CDP DOM action when AX metrics omit the visible input', () => {
    const base = cdpSensing();
    const readiness = loadingReadiness({
      cdpSensing: cdpSensing({
        readiness: 'interactive',
        likelyLoading: true,
        accessibility: {
          ...base.accessibility!,
          actionableNodeCount: 0,
          actionableRoleTop: [],
          actionableSampleLabels: [],
          locatorCoverage: {
            locatorCandidateCount: 0,
            axNodeIdCount: 0,
            backendDOMNodeIdCount: 0,
            locatorCoverageRate: 0,
          },
          objectCandidates: [
            {
              role: 'searchbox',
              label: 'Search',
              locator: {
                source: 'cdp_dom',
                cssSelector: '#global-search',
                visualBounds: { x: 20, y: 20, width: 320, height: 40 },
              },
              actionTypes: ['focus', 'setvalue'],
              state: {},
              visibilityProbe: {
                domVisible: true,
                inViewport: true,
                centerHitTarget: true,
                occluded: false,
                valueState: 'empty',
                reason: 'visible_unobstructed',
              },
            },
          ],
        },
      }),
    });

    expect(readiness).toMatchObject({
      status: 'cdp_dom_actionable_after_wait',
      canUseSnapshotForBusinessAction: true,
      nextStepAction: 'proceed',
      nextStepHint: 'use_current_cdp_dom_candidate_then_immediately_force_fresh_same_tab_read',
    });
    expect(readiness.claimBoundary).toContain('CDP DOM');
  });

  it('accepts a rendered actionable AX role when target visibility probing is unavailable', () => {
    const cdp = cdpSensing({
      accessibility: {
        ...cdpSensing().accessibility!,
        objectCandidates: cdpSensing().accessibility!.objectCandidates!.map((candidate) => ({
          ...candidate,
          actionTypes: [],
          visibilityProbe: undefined,
        })),
      },
    });

    const readiness = loadingReadiness({ cdpSensing: cdp });

    expect(readiness.status).toBe('cdp_ax_actionable_after_wait');
    expect(readiness.canUseSnapshotForBusinessAction).toBe(true);
  });

  it.each([
    [
      'has no locator-backed AX target',
      cdpSensing({
        accessibility: {
          ...cdpSensing().accessibility!,
          locatorCoverage: {
            locatorCandidateCount: 0,
            axNodeIdCount: 0,
            backendDOMNodeIdCount: 0,
            locatorCoverageRate: 0,
          },
          objectCandidates: [],
        },
      }),
    ],
    [
      'still has network activity',
      cdpSensing({
        networkActivity: {
          requestStartedCount: 2,
          inFlightCount: 1,
          failedRequestCount: 0,
        },
      }),
    ],
    [
      'only exposes disabled AX targets',
      cdpSensing({
        accessibility: {
          ...cdpSensing().accessibility!,
          stateSignals: {
            ...cdpSensing().accessibility!.stateSignals,
            disabledCount: 1,
          },
          objectCandidates: cdpSensing().accessibility!.objectCandidates!.map((candidate) => ({
            ...candidate,
            state: { disabled: true },
          })),
        },
      }),
    ],
    [
      'has neither a visibility probe nor rendered target bounds',
      cdpSensing({
        accessibility: {
          ...cdpSensing().accessibility!,
          objectCandidates: cdpSensing().accessibility!.objectCandidates!.map((candidate) => ({
            ...candidate,
            locator: {
              ...candidate.locator!,
              visualBounds: undefined,
            },
            visibilityProbe: undefined,
          })),
        },
      }),
    ],
  ])('keeps waiting when the page %s', (_label, cdp) => {
    const readiness = loadingReadiness({ cdpSensing: cdp });

    expect(readiness.canUseSnapshotForBusinessAction).toBe(false);
    expect(readiness.nextStepAction).toBe('wait');
  });

  it('blocks provisional action during SPA navigation or when CDP reports repeated failures', () => {
    const navigating = loadingReadiness({ cdpStabilityHint: 'spa_navigating' });
    const failed = loadingReadiness({
      cdpSensing: cdpSensing({
        console: {
          errorCount: 3,
          warningCount: 0,
        },
      }),
    });

    expect(navigating.canUseSnapshotForBusinessAction).toBe(false);
    expect(navigating.nextStepAction).toBe('wait');
    expect(failed.canUseSnapshotForBusinessAction).toBe(false);
    expect(failed.nextStepAction).toBe('block');
  });

  it.each([
    [
      'repeated console errors',
      cdpSensing({
        console: {
          errorCount: 3,
          warningCount: 0,
        },
      }),
    ],
    [
      'repeated failed requests',
      cdpSensing({
        networkActivity: {
          requestStartedCount: 9,
          inFlightCount: 0,
          failedRequestCount: 3,
        },
      }),
    ],
  ])('never reports a stable page as ready to act when it has %s', (_label, cdp) => {
    const readiness = stableReadiness({ cdpSensing: cdp });

    expect(readiness.status).toBe('stable');
    expect(readiness.canUseSnapshotForBusinessAction).toBe(false);
    expect(readiness.nextStepAction).toBe('block');
    expect(readiness.claimBoundary).toContain('cdp_errors_are_high');
    expect(readiness.nextStepHint).not.toContain(
      'safe_to_use_structured_refs_with_postcondition_verification',
    );
    expect(readiness.nextStepHint).toBe(
      'inspect_errors_then_reread_after_recovery_before_structured_actions',
    );
  });

  it('keeps a stable page actionable when CDP reports no hard failure', () => {
    const readiness = stableReadiness();

    expect(readiness).toMatchObject({
      status: 'stable',
      canUseSnapshotForBusinessAction: true,
      nextStepAction: 'proceed',
      nextStepHint: 'safe_to_use_structured_refs_with_postcondition_verification',
    });
  });
});
