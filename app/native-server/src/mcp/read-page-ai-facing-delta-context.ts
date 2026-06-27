import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildPostActionDeltaEvidence,
  buildReadPageBrowserPageObjectView,
  type BrowserPageThingProjection,
  type ReadPageCompactSnapshot,
} from '@tabrix/shared';
import {
  bindPostActionDeltaEvidenceToPendingInteraction,
  buildPostActionDeltaSignalsFromEvidence,
  buildPostActionReadbackEvidence,
  buildRegionStatePostconditionForPendingInteraction,
} from './browser-action-readback';
import {
  isBrowserPageThingProjectionLike,
  isReadPageObjectLifecycleSummary,
  readPageOperationMap,
  readPagePostconditionRegions,
  readPageRegions,
  readPayloadSelectedDataSource,
  readSelectedDataSource,
} from './read-page-payload-readers';
import {
  attachTaskContextEnvelopeToJsonResult,
  buildAiFacingTaskState,
  buildTaskContextEnvelope,
  readAuthResumeVerification,
  type TaskContextAttachment,
} from './task-context-envelope';
import {
  buildAiFacingApiCdpProofBoundary,
  buildAiFacingDataSourceDecision,
  buildAiFacingSourceRouteHonesty,
  ensureProjectionSourceTruthChain,
  normalizeAiFacingProjectionDataSource,
  toTaskSourceRouteHonestySnapshot,
} from './read-page-source-decision';
import {
  buildAiFacingOwnershipRuntimeSummary,
  normalizeAiFacingProjectionOwnerType,
  readPageLoadReadiness,
  readTaskPageRuntimeFields,
} from './read-page-ownership-runtime';
import { readReadPageMode } from './read-page-request-shape';
import { stripReadPageDiagnosticNoiseForOutput } from './read-page-ai-output';
import { readString } from './register-tool-value-readers';
import { getBridgeSnapshot } from './bridge-recovery';
import { classifySourceRouteHonesty } from '../runtime/source-route-honesty';
import {
  evaluateStructuredReadGate,
  type StructuredReadGateResult,
} from '../runtime/structured-read-gate';

export function attachAiFacingDeltaContext(
  result: CallToolResult,
  attachment: TaskContextAttachment,
  options?: { readStartedAtMs?: number; includeAiContextEnvelope?: boolean },
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

  const projection = payload.pageProjection;
  if (!isBrowserPageThingProjectionLike(projection)) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }
  if (!attachment.taskContext) {
    return attachTaskContextEnvelopeToJsonResult(result, attachment, {
      stripReadPageDiagnostics: options?.includeAiContextEnvelope !== true,
    });
  }

  const payloadSelectedDataSource = readPayloadSelectedDataSource(payload);
  const selectedDataSource = readSelectedDataSource(payload, projection);
  const aiFacingProjection = normalizeAiFacingProjectionDataSource(
    projection,
    selectedDataSource,
    payload,
  );
  const normalizedAiFacingProjection = normalizeAiFacingProjectionOwnerType(
    attachment.taskContext,
    aiFacingProjection,
    selectedDataSource,
    payload,
  );
  let projectionWithSourceTruth = ensureProjectionSourceTruthChain(
    normalizedAiFacingProjection,
    selectedDataSource,
  );
  const pendingInteraction = attachment.taskContext.consumePendingPageInteraction(
    projectionWithSourceTruth.tabId,
  );
  const pageRegions = readPageRegions(payload.pageRegions);
  const postconditionPageRegions = readPagePostconditionRegions(payload, pageRegions);
  const pageLoadReadiness = readPageLoadReadiness(payload.pageContext);
  const postActionReadback = buildPostActionReadbackEvidence({
    projection: projectionWithSourceTruth,
    readStartedAtMs: options?.readStartedAtMs,
  });
  const regionStatePostcondition = pendingInteraction
    ? buildRegionStatePostconditionForPendingInteraction(
        pendingInteraction,
        postconditionPageRegions,
        pageLoadReadiness,
        postActionReadback,
      )
    : null;
  if (pendingInteraction && regionStatePostcondition?.verdict === 'unknown') {
    attachment.taskContext.keepPendingPageInteractionForPostconditionRetry(pendingInteraction);
  }
  const regionStatePostconditions = regionStatePostcondition
    ? [
        {
          actionKind: pendingInteraction?.actionKind ?? 'unknown',
          result: regionStatePostcondition,
        },
      ]
    : null;
  if (pendingInteraction) {
    const pendingActionId = pendingInteraction.candidateActionId ?? pendingInteraction.action;
    projectionWithSourceTruth = {
      ...projectionWithSourceTruth,
      changedByActionId: pendingActionId,
      changeCause: pendingInteraction.changeCause,
      invalidatedRefs: [
        ...pendingInteraction.targetRefs,
        ...projectionWithSourceTruth.invalidatedRefs,
      ].filter((ref, index, refs) => refs.indexOf(ref) === index),
    };
  }
  const runtimeFields = readTaskPageRuntimeFields(payload);
  const previousPageProjection = attachment.taskContext.peekLastPageProjection();
  const previousRuntimeFields = attachment.taskContext.peekLastPageRuntimeFields();
  const deltaContext = attachment.taskContext.notePageProjectionAndBuildDelta(
    projectionWithSourceTruth,
    runtimeFields,
  );
  const actionBoundPostActionDeltaEvidence = bindPostActionDeltaEvidenceToPendingInteraction(
    payload.postActionDeltaEvidence,
    payload.pageObjectSnapshot,
    pendingInteraction,
  );
  const postActionDeltaEvidence =
    deltaContext.deltaKind === 'post_action_delta'
      ? buildPostActionDeltaEvidence({
          delta: deltaContext,
          tabId: projectionWithSourceTruth.tabId,
          actionId:
            actionBoundPostActionDeltaEvidence?.actionId ??
            projectionWithSourceTruth.changedByActionId ??
            null,
          sourceTruthChain: projectionWithSourceTruth.sourceTruthChain,
          ...buildPostActionDeltaSignalsFromEvidence(actionBoundPostActionDeltaEvidence),
          recommendedNextAction: regionStatePostconditions
            ? 'inspect_region_state_postconditions'
            : 'continue_with_post_action_delta_context',
        })
      : null;
  const selectedReason =
    selectedDataSource === readString(payload.aiPreferredDataSource)
      ? (readString(payload.aiPreferredDataSourceReason) ?? 'ai_context_prefers_visible_rows')
      : selectedDataSource !== payloadSelectedDataSource &&
          selectedDataSource === aiFacingProjection.chosenDataSource
        ? 'projection_chosen_data_source'
        : (readString(payload.decisionReason) ?? readString(payload.selectedReason));
  const fallbackReason =
    readString(payload.fallbackReason) ??
    readString(payload.fallbackCause) ??
    readString(payload.apiRowsUnavailableReason);
  const dataSourceDecision = buildAiFacingDataSourceDecision({
    payload,
    projection: aiFacingProjection,
    selectedDataSource,
    selectedReason,
    fallbackReason,
  });
  const authResumeGate = attachment.taskContext.noteAuthResumeVerification(
    readAuthResumeVerification(payload),
  );
  const sourceRouteHonesty = classifySourceRouteHonesty({
    selectedDataSource,
    sourceTruthChain: projectionWithSourceTruth.sourceTruthChain,
    fallbackReason,
  });
  const aiFacingSourceRouteHonesty = buildAiFacingSourceRouteHonesty(sourceRouteHonesty);
  const apiCdpProofBoundary = buildAiFacingApiCdpProofBoundary(sourceRouteHonesty);
  attachment.taskContext.noteSourceRouteHonesty(
    toTaskSourceRouteHonestySnapshot(sourceRouteHonesty),
  );
  const taskState = buildAiFacingTaskState({
    payload,
    projection: aiFacingProjection,
    fallbackReason,
    authResumeGate,
  });
  const structuredReadGate = buildStructuredReadGate(payload, projectionWithSourceTruth);
  const bridgeSnapshot = getBridgeSnapshot();
  const previousOwnershipRuntime = previousRuntimeFields
    ? buildAiFacingOwnershipRuntimeSummary({
        taskContext: attachment.taskContext,
        projection: projectionWithSourceTruth,
        runtimeFields: previousRuntimeFields,
        bridgeSnapshot,
      })
    : null;
  const ownershipRuntime = buildAiFacingOwnershipRuntimeSummary({
    taskContext: attachment.taskContext,
    projection: projectionWithSourceTruth,
    runtimeFields,
    bridgeSnapshot,
  });
  const objectLifecycle = isReadPageObjectLifecycleSummary(payload.objectLifecycle)
    ? attachment.taskContext.noteObjectLifecycleAndBuildDelta(payload.objectLifecycle)
    : null;
  const browserPageObject = objectLifecycle
    ? buildReadPageBrowserPageObjectView({
        pageRegions,
        pageOperationMap: readPageOperationMap(payload.pageOperationMap),
        objectLifecycle,
        previousPageProjection,
        pageProjection: projectionWithSourceTruth,
        previousOwnershipRuntime,
        ownershipRuntime,
        selectedDataSource,
        sourceRouteHonestyVerdict: sourceRouteHonesty.verdict,
      })
    : null;
  const readMode = readReadPageMode(payload.mode);
  const includeFullBrowserPageObjectInAiEnvelope = readMode === 'full';
  const pageObjectDetailPolicy = browserPageObject
    ? {
        readMode,
        summaryField: 'pageObjectSummary',
        fullObjectField: 'browserPageObject',
        fullObjectInAiEnvelope: includeFullBrowserPageObjectInAiEnvelope,
        reason: includeFullBrowserPageObjectInAiEnvelope
          ? 'full_read_mode_requested'
          : 'compact_or_normal_read_mode_prefers_summary_first',
      }
    : null;

  payload.pageProjection = projectionWithSourceTruth;
  payload.tabId = projectionWithSourceTruth.tabId;
  if (objectLifecycle) {
    payload.objectLifecycle = objectLifecycle;
  }
  payload.ownershipRuntime = ownershipRuntime;
  payload.structuredReadGate = structuredReadGate;
  payload.sourceRouteHonesty = aiFacingSourceRouteHonesty;
  payload.apiCdpProofBoundary = apiCdpProofBoundary;
  if (regionStatePostconditions) {
    payload.regionStatePostconditions = regionStatePostconditions;
    attachment.taskContext.noteRegionStatePostconditionsForCloseout({
      tabId: projectionWithSourceTruth.tabId,
      regionStatePostconditions,
    });
  }
  if (authResumeGate) {
    payload.authResumeGate = authResumeGate;
  }
  const taskResumeReadiness = attachment.taskContext.buildTaskResumeReadiness({
    tabId: projectionWithSourceTruth.tabId,
  });
  payload.taskResumeReadiness = taskResumeReadiness;
  payload.deltaContext = deltaContext;
  // Gap 3 closeout: keep the legacy pageDeltaReport only as an internal
  // compatibility input. The public MCP read_page surface should expose the
  // unified delta contract via deltaContext + postActionDeltaEvidence.
  delete payload.pageDeltaReport;
  if (postActionDeltaEvidence) {
    payload.postActionDeltaEvidence = postActionDeltaEvidence;
  }
  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  const aiContextEnvelope = {
    envelopeKind: 'delta_context',
    contextSource: 'page_projection_delta',
    taskContext: buildTaskContextEnvelope(attachment),
    taskState,
    selectedDataSource,
    dataSourceDecision,
    sourceRouteHonesty: aiFacingSourceRouteHonesty,
    apiCdpProofBoundary,
    ...(regionStatePostconditions ? { regionStatePostconditions } : {}),
    ...(authResumeGate ? { authResumeGate } : {}),
    taskResumeReadiness,
    structuredReadGate,
    ...(postActionDeltaEvidence ? { postActionDeltaEvidence } : {}),
    ...(objectLifecycle ? { objectLifecycle } : {}),
    ...(pageObjectDetailPolicy ? { pageObjectDetailPolicy } : {}),
    ...(browserPageObject && includeFullBrowserPageObjectInAiEnvelope ? { browserPageObject } : {}),
    ...(browserPageObject?.compact
      ? {
          pageObjectSummary: browserPageObject.compact,
          primaryConclusion: browserPageObject.compact.primaryConclusion,
          watchStatus: browserPageObject.compact.watchStatus,
          changedGroups: browserPageObject.compact.changedGroups,
        }
      : {}),
    deltaContext,
    lifecycleTimeline: attachment.taskContext.getLifecycleTimeline(),
  };
  if (options?.includeAiContextEnvelope === true) {
    payload.aiContextEnvelope = aiContextEnvelope;
  } else {
    delete payload.aiContextEnvelope;
  }
  attachment.taskContext.notePageRegionsForPostcondition({
    tabId: projectionWithSourceTruth.tabId,
    pageRegions: postconditionPageRegions,
  });
  const responsePayload =
    options?.includeAiContextEnvelope === true
      ? payload
      : stripReadPageDiagnosticNoiseForOutput(payload);

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

function buildStructuredReadGate(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): StructuredReadGateResult {
  return evaluateStructuredReadGate({
    snapshot: payload as unknown as ReadPageCompactSnapshot,
    readMode: readReadPageMode(payload.mode),
    nowMs: Date.now(),
    gateId: `structured-read-gate:${projection.projectionId}`,
  });
}
