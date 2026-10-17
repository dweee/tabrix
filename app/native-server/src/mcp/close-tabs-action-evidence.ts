import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildActionEvidenceResult } from '@tabrix/shared';
import { readCloseTabsBrowserHygieneEvidenceFromPayload } from './close-tabs-hygiene-evidence';
import { buildTaskContextEnvelope, type TaskContextAttachment } from './task-context-envelope';
import { readNumericArray, readObject } from './register-tool-value-readers';

export function attachLifecycleTimelineContext(
  result: CallToolResult,
  attachment: TaskContextAttachment,
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  payload.lifecycleTimeline = attachment.taskContext?.getLifecycleTimeline() ?? [];
  payload.actionEvidenceResult = buildCloseTabsActionEvidenceResult(payload, attachment);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}

function buildCloseTabsActionEvidenceResult(
  payload: Record<string, unknown>,
  attachment: TaskContextAttachment,
) {
  const closedTabIds = readNumericArray(payload, 'closedTabIds') ?? [];
  const invalidTabIds = readNumericArray(payload, 'invalidTabIds') ?? [];
  const closePreflightEvidence = readObject(payload.closePreflightEvidence);
  const browserHygieneEvidence = readCloseTabsBrowserHygieneEvidenceFromPayload(payload);
  const targetTabIds = readNumericArray(closePreflightEvidence, 'requestedTabIds') ?? [
    ...closedTabIds,
    ...invalidTabIds,
  ];
  const primaryTabId = closedTabIds[0] ?? invalidTabIds[0] ?? targetTabIds[0] ?? null;
  const hygieneStatus =
    browserHygieneEvidence?.tabWindowBaselineUnchanged === false ||
    browserHygieneEvidence?.activeTabRestored === false
      ? 'fail'
      : browserHygieneEvidence
        ? 'pass'
        : 'not_checked';
  const toolSuccess = payload.success === true && closedTabIds.length > 0;
  const negativeEvidence = [
    ...(toolSuccess ? [] : ['close_tabs_not_confirmed']),
    ...(hygieneStatus === 'fail' ? ['browser_hygiene_failed'] : []),
    ...(browserHygieneEvidence ? [] : ['browser_hygiene_evidence_missing']),
  ];

  return buildActionEvidenceResult({
    actionId: `close_tabs-${primaryTabId ?? 'none'}-${Date.now()}`,
    actionKind: 'close_tabs',
    taskSessionId: attachment.taskContextKey,
    tabId: primaryTabId,
    toolSuccess,
    targetBinding: {
      requestedTargetRef: null,
      resolvedTargetRef: null,
      locatorChainSummary: targetTabIds.map((tabId) => `tabId:${tabId}`),
      dispatchTarget: targetTabIds.length > 0 ? 'tab_ids' : 'none',
      frameScope: null,
      targetBindingProven: targetTabIds.length > 0,
      claimBoundary:
        'Close-tabs target binding proves only which tab IDs were requested/closed; it does not prove user task completion.',
    },
    dispatch: {
      dispatched: toolSuccess,
      acceptedByBrowser: toolSuccess,
      errorCode: toolSuccess ? null : 'close_tabs_not_confirmed',
    },
    source: {
      selectedDataSource: 'unknown',
      sourceRouteHonestyVerdict: 'not_checked',
      fallbackUsed: null,
    },
    postAction: {
      postActionReadbackStatus: browserHygieneEvidence ? 'browser_hygiene_observed' : 'not_proven',
      postconditionVerdict: toolSuccess && hygieneStatus !== 'fail' ? 'passed' : 'not_proven',
      freshReadRequired: false,
      readbackSource: browserHygieneEvidence ? 'browser_hygiene_evidence' : 'none',
    },
    business: {
      businessSuccessVerdict: toolSuccess && hygieneStatus !== 'fail' ? 'proven' : 'not_proven',
      businessSuccessProven: toolSuccess && hygieneStatus !== 'fail',
      negativeEvidence,
      nextRequiredCheck:
        toolSuccess && hygieneStatus !== 'fail' ? 'none' : 'inspect_close_tabs_hygiene',
    },
    browserHygiene: {
      required: true,
      status: hygieneStatus,
      leakedTabsOrWindows:
        browserHygieneEvidence && browserHygieneEvidence.after.tabCount > 0
          ? Math.max(
              0,
              browserHygieneEvidence.after.tabCount - browserHygieneEvidence.before.tabCount,
            )
          : null,
    },
    claimBoundary: [
      'Close-tabs tool success proves cleanup of requested tab IDs only.',
      'Browser hygiene evidence does not prove the original business task succeeded.',
      'No API/CDP reuse, release readiness, or competitor parity is proven by this close result.',
    ],
  });
}
