import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  BrowserDataSourceDecisionEvidence,
  BrowserPageProjectionDelta,
  BrowserPageThingProjection,
  ReadPageRequestedLayer,
} from '@tabrix/shared';
import { buildBrowserTaskStateVerdict } from '@tabrix/shared';
import type {
  ShouldAllowReadPageResult,
  TaskAuthResumeGate,
  TaskPageRuntimeFields as ReadPageWarningRuntimeFields,
} from '../execution/task-session-context';
import type { ReadPageOperationLogHint } from './read-page-dom-region-rows-result';

export function buildReadPageWarningResult(args: {
  decision: ShouldAllowReadPageResult;
  requestedLayer: ReadPageRequestedLayer;
  operationLogHint: ReadPageOperationLogHint | null;
  cachedProjection?: BrowserPageThingProjection | null;
  cachedDeltaContext?: BrowserPageProjectionDelta | null;
  cachedDataSourceDecision?: BrowserDataSourceDecisionEvidence | null;
  lifecycleTimeline?: readonly unknown[] | null;
  runtimeFields?: ReadPageWarningRuntimeFields | null;
  cachedAuthResumeGate?: TaskAuthResumeGate | null;
}): {
  result: CallToolResult;
  warning: string;
  operationLog: Record<string, unknown>;
} {
  const warning = args.decision.reason || 'read_budget_exceeded';
  const warningPayload: Record<string, unknown> = {
    warning,
    readPageCount: args.decision.readPageCount,
    readBudget: args.decision.readBudget,
    suggestedLayer: args.decision.suggestedLayer,
  };
  if (args.cachedProjection && args.cachedDeltaContext) {
    warningPayload.cachedPageStateSummary = {
      summaryKind: 'cached_page_state',
      freshness: 'cached_not_fresh',
      warning,
      readiness: args.cachedProjection.readiness,
      stability: args.cachedProjection.stability,
      activeRegion: args.cachedProjection.activeRegion,
      changedRegions: args.cachedProjection.changedRegions,
      reusedRegions: args.cachedDeltaContext.reusedRegions,
      contextSavedRatio: args.cachedDeltaContext.contextSavedRatio,
      currentWindowId: args.runtimeFields?.currentWindowId ?? null,
      currentWindowState: args.runtimeFields?.currentWindowState ?? null,
      currentWindowWidth: args.runtimeFields?.currentWindowWidth ?? null,
      currentWindowHeight: args.runtimeFields?.currentWindowHeight ?? null,
      currentWindowLeft: args.runtimeFields?.currentWindowLeft ?? null,
      currentWindowTop: args.runtimeFields?.currentWindowTop ?? null,
      isCurrentTabActive: args.runtimeFields?.isCurrentTabActive ?? null,
      isCurrentWindowFocused: args.runtimeFields?.isCurrentWindowFocused ?? null,
      browserActiveTabId: args.runtimeFields?.browserActiveTabId ?? null,
      browserActiveTabIdKnown: args.runtimeFields?.browserActiveTabIdKnown ?? false,
      isReadTargetBrowserActiveTab: args.runtimeFields?.isReadTargetBrowserActiveTab ?? null,
      nextStepHint:
        warning === 'read_budget_exceeded'
          ? 'cached_state_only_start_new_task_or_navigate_for_fresh_read'
          : 'cached_state_reused_for_redundant_read',
    };
    warningPayload.pageProjection = args.cachedProjection;
    warningPayload.deltaContext = args.cachedDeltaContext;
    warningPayload.currentWindowId = args.runtimeFields?.currentWindowId ?? null;
    warningPayload.currentWindowState = args.runtimeFields?.currentWindowState ?? null;
    warningPayload.currentWindowWidth = args.runtimeFields?.currentWindowWidth ?? null;
    warningPayload.currentWindowHeight = args.runtimeFields?.currentWindowHeight ?? null;
    warningPayload.currentWindowLeft = args.runtimeFields?.currentWindowLeft ?? null;
    warningPayload.currentWindowTop = args.runtimeFields?.currentWindowTop ?? null;
    warningPayload.isCurrentTabActive = args.runtimeFields?.isCurrentTabActive ?? null;
    warningPayload.isCurrentWindowFocused = args.runtimeFields?.isCurrentWindowFocused ?? null;
    warningPayload.browserActiveTabId = args.runtimeFields?.browserActiveTabId ?? null;
    warningPayload.browserActiveTabIdKnown = args.runtimeFields?.browserActiveTabIdKnown ?? false;
    warningPayload.isReadTargetBrowserActiveTab =
      args.runtimeFields?.isReadTargetBrowserActiveTab ?? null;
    warningPayload.aiContextEnvelope = {
      envelopeKind: 'delta_context',
      contextSource: 'cached_page_projection_delta',
      taskState: buildBrowserTaskStateVerdict({
        projection: args.cachedProjection,
        readinessReason: args.cachedAuthResumeGate?.blocksTaskResume
          ? `auth_or_login_required:${args.cachedAuthResumeGate.reason}`
          : warning,
      }),
      selectedDataSource: args.cachedProjection.chosenDataSource,
      dataSourceDecision: args.cachedDataSourceDecision ?? null,
      deltaContext: args.cachedDeltaContext,
      lifecycleTimeline: args.lifecycleTimeline ? [...args.lifecycleTimeline] : [],
      ...(args.cachedAuthResumeGate ? { authResumeGate: args.cachedAuthResumeGate } : {}),
    };
    if (args.cachedAuthResumeGate) {
      warningPayload.authResumeGate = args.cachedAuthResumeGate;
    }
  }

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(warningPayload) }],
    },
    warning,
    operationLog: {
      ...(args.operationLogHint ?? {}),
      requestedLayer: args.requestedLayer,
      resultKind: 'read_page_warning',
      decisionReason: warning,
    },
  };
}
