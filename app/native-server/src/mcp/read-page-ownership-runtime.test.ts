import { describe, expect, it } from '@jest/globals';
import type { BrowserPageThingProjection } from '@tabrix/shared';
import { TaskSessionContext } from '../execution/task-session-context';
import type { BridgeRuntimeSnapshot } from '../server/bridge-state';
import {
  buildAiFacingOwnershipRuntimeSummary,
  readTaskPageRuntimeFields,
} from './read-page-ownership-runtime';

function bridgeSnapshot(): BridgeRuntimeSnapshot {
  return {
    bridgeState: 'READY',
    browserProcessRunning: true,
    browserProcessDetectedAt: 1,
    extensionHeartbeatAt: 2,
    heartbeat: {
      extensionId: 'extension-id',
      connectionId: 'connection-id',
      browserVersion: '120.0.0.0',
      tabCount: 2,
      windowCount: 1,
      autoConnectEnabled: true,
    },
    nativeHostAttached: true,
    commandChannelConnected: true,
    commandChannelType: 'native',
    activeConnectionId: 'connection-id',
    lastCommandChannelAt: 3,
    lastBridgeReadyAt: 4,
    lastBridgeErrorCode: null,
    lastBridgeErrorMessage: null,
    lastRecoveryAction: null,
    lastRecoveryAt: null,
    recoveryAttempts: 0,
    recoveryInFlight: false,
    primaryTabId: 41,
    primaryTabReuseRate: 1,
    benchmarkOwnedTabCount: 1,
  };
}

describe('read-page ownership runtime', () => {
  it('preserves browser-world AI run claim fields through native AI-facing output', () => {
    const runtimeFields = readTaskPageRuntimeFields({
      ownershipRuntime: {
        currentTabId: 42,
        currentWindowId: 7,
        currentTabAiRunId: 'run_background_check',
        currentTabAiClaimId: 'claim_42',
        currentTabAiClaimState: 'claimed',
        currentTabAiClaimedAtMs: 1222,
        currentTabAiFinalizedAtMs: null,
        currentTabAiClaimReason: 'background_session_claim',
      },
      browserPageObjectCompact: {
        facts: {
          tab: {
            aiRunId: 'compact_run_should_not_win',
            aiClaimState: 'finalized',
          },
        },
      },
    });

    const taskContext = new TaskSessionContext({ readBudget: 10 });
    taskContext.noteRunOwnedTab(42);
    const projection = {
      tabId: 42,
      ownerType: 'run_owned',
    } as BrowserPageThingProjection;

    expect(
      buildAiFacingOwnershipRuntimeSummary({
        taskContext,
        projection,
        runtimeFields,
        bridgeSnapshot: bridgeSnapshot(),
      }),
    ).toMatchObject({
      currentTabId: 42,
      currentTabAiRunId: 'run_background_check',
      currentTabAiClaimId: 'claim_42',
      currentTabAiClaimState: 'claimed',
      currentTabAiClaimedAtMs: 1222,
      currentTabAiFinalizedAtMs: null,
      currentTabAiClaimReason: 'background_session_claim',
      currentTabRunOwnershipVerdict: 'run_owned_by_task',
      isCurrentTabRunOwnedByTask: true,
    });
  });

  it('falls back to native run-owned tab claim when extension runtime lacks claim fields', () => {
    const runtimeFields = readTaskPageRuntimeFields({
      ownershipRuntime: {
        currentTabId: 43,
        currentWindowId: 7,
      },
    });

    const taskContext = new TaskSessionContext({ readBudget: 10 });
    taskContext.noteRunOwnedTab(43, {
      aiRunId: 'navigate-new-tab-43-1000',
      aiClaimId: 'navigate_43',
      aiClaimState: 'claimed',
      aiClaimedAtMs: 1000,
      aiClaimReason: 'native_background_navigation_claim',
    });
    const projection = {
      tabId: 43,
      ownerType: 'run_owned',
    } as BrowserPageThingProjection;

    expect(
      buildAiFacingOwnershipRuntimeSummary({
        taskContext,
        projection,
        runtimeFields,
        bridgeSnapshot: bridgeSnapshot(),
      }),
    ).toMatchObject({
      currentTabId: 43,
      currentTabAiRunId: 'navigate-new-tab-43-1000',
      currentTabAiClaimId: 'navigate_43',
      currentTabAiClaimState: 'claimed',
      currentTabAiClaimedAtMs: 1000,
      currentTabAiClaimReason: 'native_background_navigation_claim',
      currentTabRunOwnershipVerdict: 'run_owned_by_task',
      isCurrentTabRunOwnedByTask: true,
    });
  });
});
