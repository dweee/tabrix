import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  BrowserDataSourceDecisionEvidence,
  BrowserPageProjectionDelta,
  BrowserPageThingProjection,
  ReadPageRequestedLayer,
} from '@tabrix/shared';
import { buildBrowserTaskStateVerdict } from '@tabrix/shared';
import type { ShouldAllowReadPageResult } from '../execution/task-session-context';
import type { ReadPageOperationLogHint } from './read-page-dom-region-rows-result';

export function buildReadPageWarningResult(args: {
  decision: ShouldAllowReadPageResult;
  requestedLayer: ReadPageRequestedLayer;
  operationLogHint: ReadPageOperationLogHint | null;
  cachedProjection?: BrowserPageThingProjection | null;
  cachedDeltaContext?: BrowserPageProjectionDelta | null;
  cachedDataSourceDecision?: BrowserDataSourceDecisionEvidence | null;
  lifecycleTimeline?: readonly unknown[] | null;
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
    warningPayload.pageProjection = args.cachedProjection;
    warningPayload.deltaContext = args.cachedDeltaContext;
    warningPayload.aiContextEnvelope = {
      envelopeKind: 'delta_context',
      contextSource: 'cached_page_projection_delta',
      taskState: buildBrowserTaskStateVerdict({
        projection: args.cachedProjection,
        readinessReason: warning,
      }),
      selectedDataSource: args.cachedProjection.chosenDataSource,
      dataSourceDecision: args.cachedDataSourceDecision ?? null,
      deltaContext: args.cachedDeltaContext,
      lifecycleTimeline: args.lifecycleTimeline ? [...args.lifecycleTimeline] : [],
    };
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
