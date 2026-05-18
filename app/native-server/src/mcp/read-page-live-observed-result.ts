import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  LiveObservedApiData,
  LiveObservedApiEvidence,
} from '../api-knowledge/live-observed-data';
import { mapDataSourceToLayerContract } from '../execution/layer-contract';
import type { ReadPageOperationLogHint } from './read-page-dom-region-rows-result';

export function buildLiveObservedApiRowsSuccessResult(args: {
  liveObserved: LiveObservedApiData;
  taskTotals: unknown;
}): { result: CallToolResult; operationLog: Record<string, unknown> } {
  const { liveObserved } = args;
  const isContent = liveObserved.selectedDataSource === 'api_content';
  const sourceKind = isContent
    ? 'api_content'
    : liveObserved.selectedDataSource === 'api_detail'
      ? 'api_detail'
      : 'api_list';
  const layerContract = mapDataSourceToLayerContract({
    dataSource: liveObserved.selectedDataSource,
    requestedLayer: isContent ? 'L0+L1+L2' : 'L0+L1',
    fallbackEntryLayer: 'L0+L1',
    taskRequiresDetail: isContent,
  });
  const liveObservedEvidence = {
    liveObservedDataUsed: true,
    endpointSource: liveObserved.endpointSource,
    selectedDataSource: liveObserved.selectedDataSource,
    liveObservedEndpointId: liveObserved.liveObservedEndpointId,
    rowCount: liveObserved.rowCount,
    contentChars: liveObserved.contentChars,
    contentSectionCount: liveObserved.contentSectionCount,
    emptyResult: liveObserved.emptyResult,
    fieldShapeSummaryAvailable: liveObserved.fieldShapeSummaryAvailable,
    pageRegion: liveObserved.pageRegion,
    correlationScore: liveObserved.correlationScore,
    privacyCheck: liveObserved.privacyCheck,
    fallbackCause: null,
    fallbackUsed: false,
    operationLogSuccess: true,
    knowledgeUpserted: liveObserved.knowledgeUpserted,
    semanticType: liveObserved.semanticType,
    sameTaskLiveObservedUseCount: 1,
    nonSeedObservedEndpointUsedCount: liveObserved.endpointSource === 'observed' ? 1 : 0,
    responseSummarySource: liveObserved.responseSummarySource,
    rawBodyPersisted: liveObserved.rawBodyPersisted,
    capturedAfterArm: liveObserved.capturedAfterArm,
    bridgePath: liveObserved.bridgePath,
    responseSummaryRejectedReason: liveObserved.responseSummaryRejectedReason,
    observationMode: liveObserved.observationMode,
    cdpUsed: liveObserved.cdpUsed,
    cdpReason: liveObserved.cdpReason,
    cdpAttachDurationMs: liveObserved.cdpAttachDurationMs,
    cdpDetachSuccess: liveObserved.cdpDetachSuccess,
    debuggerConflict: liveObserved.debuggerConflict,
    responseBodySource: liveObserved.responseBodySource,
    bodyCompacted: liveObserved.bodyCompacted,
  };
  const dataSourceDecision = {
    availableSources: [liveObserved.selectedDataSource],
    selectedSource: liveObserved.selectedDataSource,
    selectedReason: 'live_observed_current_task_api_data',
    rejectedSources: [],
    fallbackReason: null,
    regionCorrelation: liveObserved.correlationScore,
    taskRelevance: liveObserved.correlationScore,
    privacySafety: liveObserved.privacyCheck === 'passed' ? 'redacted' : 'unknown',
    metadataCompleteness:
      liveObserved.rowCount > 0 && liveObserved.fieldShapeSummaryAvailable ? 1 : 0,
    sourceFreshness: 'fresh',
    sourceConfidence: liveObserved.correlationScore,
  };
  const apiPayload = {
    kind: liveObserved.selectedDataSource,
    readPageAvoided: true,
    sourceKind,
    sourceRoute: 'knowledge_supported_read',
    chosenSource: sourceKind,
    dataSource: sourceKind,
    selectedDataSource: liveObserved.selectedDataSource,
    decisionReason: 'live_observed_current_task_api_data',
    dataSourceDecision,
    aiContextEnvelope: {
      envelopeKind: 'live_observed_api_context',
      contextSource: 'live_observed_current_task_api_data',
      selectedDataSource: liveObserved.selectedDataSource,
      dataSourceDecision,
    },
    dispatcherInputSource: 'chrome_network_capture',
    fallbackPlan: {
      dataSource: 'dom_json',
      entryLayer: 'L0+L1',
      reason: 'live_observed_current_task_api_data',
    },
    layerContract,
    chosenLayer: layerContract.layer,
    tokenEstimateChosen: 0,
    tokenEstimateFullRead: 0,
    tokensSavedEstimate: 0,
    tokensSavedEstimateSource: isContent
      ? 'unavailable_live_observed_api_content'
      : 'unavailable_live_observed_api_rows',
    fallbackUsed: 'none',
    fallbackCause: null,
    fallbackEntryLayer: 'L0+L1',
    requiresApiCall: false,
    requiresExperienceReplay: false,
    apiFamily: liveObserved.endpointFamily,
    dataPurpose: liveObserved.dataPurpose,
    rows: liveObserved.rows,
    rowCount: liveObserved.rowCount,
    contentText: liveObserved.contentText,
    contentChars: liveObserved.contentChars,
    contentSections: liveObserved.contentSections,
    contentSectionCount: liveObserved.contentSectionCount,
    compact: liveObserved.compact,
    rawBodyStored: liveObserved.rawBodyStored,
    emptyResult: liveObserved.emptyResult,
    emptyReason: liveObserved.emptyReason,
    emptyMessage: liveObserved.emptyMessage,
    endpointSource: liveObserved.endpointSource,
    apiTelemetry: {
      endpointFamily: liveObserved.endpointFamily,
      method: 'GET',
      reason: isContent ? 'live_observed_api_content' : 'live_observed_api_rows',
      status: null,
      waitedMs: 0,
      readAllowed: true,
      fallbackEntryLayer: 'none',
    },
    liveObservedDataUsed: true,
    sameTaskLiveObservedUseCount: 1,
    nonSeedObservedEndpointUsedCount: 1,
    liveObservedEndpointId: liveObserved.liveObservedEndpointId,
    fieldShapeSummaryAvailable: liveObserved.fieldShapeSummaryAvailable,
    pageRegion: liveObserved.pageRegion,
    correlationScore: liveObserved.correlationScore,
    privacyCheck: liveObserved.privacyCheck,
    operationLogSuccess: true,
    knowledgeUpserted: liveObserved.knowledgeUpserted,
    responseSummarySource: liveObserved.responseSummarySource,
    rawBodyPersisted: liveObserved.rawBodyPersisted,
    capturedAfterArm: liveObserved.capturedAfterArm,
    bridgePath: liveObserved.bridgePath,
    observationMode: liveObserved.observationMode,
    cdpUsed: liveObserved.cdpUsed,
    cdpReason: liveObserved.cdpReason,
    cdpAttachDurationMs: liveObserved.cdpAttachDurationMs,
    cdpDetachSuccess: liveObserved.cdpDetachSuccess,
    debuggerConflict: liveObserved.debuggerConflict,
    responseBodySource: liveObserved.responseBodySource,
    bodyCompacted: liveObserved.bodyCompacted,
    diagnostic: isContent
      ? 'skip: current task already observed safe API content'
      : 'skip: current task already observed safe compact API rows',
    taskTotals: args.taskTotals,
  };

  return {
    result: {
      content: [{ type: 'text', text: JSON.stringify(apiPayload) }],
    },
    operationLog: {
      requestedLayer: layerContract.layer,
      selectedDataSource: liveObserved.selectedDataSource,
      sourceRoute: 'knowledge_supported_read',
      decisionReason: 'live_observed_current_task_api_data',
      resultKind: liveObserved.selectedDataSource,
      fallbackUsed: 'none',
      readCount: (args.taskTotals as { readPageAvoidedCount?: unknown }).readPageAvoidedCount,
      tokensSaved: 0,
      success: true,
      tabHygiene: liveObservedEvidence,
      metadata: {
        emptyResult: liveObserved.emptyResult ? 'true' : 'false',
        apiTelemetry: isContent ? 'live_observed_api_content' : 'live_observed_api_rows',
        contentChars: String(liveObserved.contentChars),
        contentSectionCount: String(liveObserved.contentSectionCount),
        confidence: liveObserved.correlationScore.toFixed(2),
        responseSummarySource: liveObserved.responseSummarySource,
        capturedAfterArm:
          liveObserved.capturedAfterArm === null
            ? 'unknown'
            : liveObserved.capturedAfterArm
              ? 'true'
              : 'false',
        bridgePath: liveObserved.bridgePath,
        executionMode: 'direct_api',
        readerMode: 'knowledge_driven',
        endpointSource: liveObserved.endpointSource,
        semanticValidation: 'pass',
        layerContractReason: layerContract.reason,
        fallbackEntryLayer: 'none',
        apiFinalReason: 'none',
        privacyCheck: liveObserved.privacyCheck,
        relevanceCheck: 'passed',
        observationMode: liveObserved.observationMode,
        cdpUsed: liveObserved.cdpUsed ? 'true' : 'false',
        cdpReason: liveObserved.cdpReason ?? 'not_applicable',
        cdpAttachDurationMs:
          liveObserved.cdpAttachDurationMs === null
            ? 'not_applicable'
            : String(liveObserved.cdpAttachDurationMs),
        cdpDetachSuccess: liveObserved.cdpDetachSuccess ? 'true' : 'false',
        debuggerConflict: liveObserved.debuggerConflict ? 'true' : 'false',
        responseBodySource: liveObserved.responseBodySource,
        bodyCompacted: liveObserved.bodyCompacted ? 'true' : 'false',
      },
    },
  };
}

export function buildLiveObservedRejectedLogHint(
  evidence: readonly LiveObservedApiEvidence[],
): ReadPageOperationLogHint {
  const first = evidence[0];

  return {
    requestedLayer: 'L0+L1',
    selectedDataSource: 'dom_json',
    sourceRoute: 'knowledge_supported_read',
    decisionReason: first?.fallbackCause ?? 'live_observed_api_unusable',
    resultKind: 'read_page_fallback',
    fallbackUsed: 'dom_compact',
    tabHygiene: {
      liveObservedDataUsed: false,
      candidateEvidence: evidence,
    },
    metadata: {
      apiTelemetry: 'live_observed_api_rows',
      endpointSource: first?.endpointSource ?? 'not_applicable',
      fallbackPlan: first?.fallbackCause ?? 'live_observed_api_unusable',
      fallbackEntryLayer: 'L0+L1',
      privacyCheck: first?.privacyCheck ?? 'not_applicable',
      relevanceCheck: first?.privacyCheck === 'failed' ? 'not_applicable' : 'failed',
      responseSummarySource: first?.responseSummarySource ?? 'not_applicable',
      observationMode: first?.observationMode ?? 'not_applicable',
      cdpUsed: first?.cdpUsed === true ? 'true' : 'false',
      cdpReason: first?.cdpReason ?? 'not_applicable',
      cdpAttachDurationMs:
        typeof first?.cdpAttachDurationMs === 'number'
          ? String(first?.cdpAttachDurationMs)
          : 'not_applicable',
      cdpDetachSuccess: first?.cdpDetachSuccess === true ? 'true' : 'false',
      debuggerConflict: first?.debuggerConflict === true ? 'true' : 'false',
      responseBodySource: first?.responseBodySource ?? 'not_applicable',
      bodyCompacted: first?.bodyCompacted === true ? 'true' : 'false',
    },
  };
}
