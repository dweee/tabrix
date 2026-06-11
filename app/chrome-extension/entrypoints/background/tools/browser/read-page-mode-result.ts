import type {
  ReadPageCompactSnapshot,
  ReadPageFullSnapshot,
  ReadPageNormalSnapshot,
  ReadPagePrimaryRegionConfidence,
} from '@tabrix/shared';

export function buildReadPageModeResult(params: {
  sharedPayload: ReadPageCompactSnapshot;
  mode: 'compact' | 'normal' | 'full';
  requestedLayer: string;
  primaryRegionConfidence: ReadPagePrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
  pageContent: string;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  stats: { processed: number; included: number; durationMs: number };
  elements: any[];
  count: number;
  markedElements: any[];
  refMap: any[];
  reason: string | null;
  tips: string;
}): ReadPageCompactSnapshot | ReadPageNormalSnapshot | ReadPageFullSnapshot {
  if (params.mode === 'compact') {
    if (params.requestedLayer !== 'L0+L1+L2') {
      return buildReadPageControlPayload(params.sharedPayload);
    }
    return params.sharedPayload;
  }

  if (params.mode === 'normal') {
    return {
      ...params.sharedPayload,
      summary: {
        ...params.sharedPayload.summary,
        primaryRegionConfidence: params.primaryRegionConfidence,
        footerOnly: params.footerOnly,
        anchorTexts: params.anchorTexts,
      },
      diagnostics: {
        stats: params.stats,
        contentSummary: params.contentSummary,
        tips: params.tips,
        reason: params.reason,
      },
    };
  }

  return {
    ...params.sharedPayload,
    summary: {
      ...params.sharedPayload.summary,
      primaryRegionConfidence: params.primaryRegionConfidence,
      footerOnly: params.footerOnly,
      anchorTexts: params.anchorTexts,
    },
    fullSnapshot: {
      pageContent: params.pageContent,
      refMap: params.refMap,
      fallbackElements: params.elements,
      fallbackCount: params.count,
      markedElements: params.markedElements,
      stats: params.stats,
      contentSummary: params.contentSummary,
      tips: params.tips,
      reason: params.reason,
    },
  };
}

function compactAction(action: any): Record<string, unknown> {
  return {
    id: action?.id ?? action?.actionId ?? null,
    actionType: action?.actionType ?? action?.type ?? null,
    label: action?.label ?? action?.text ?? action?.accessibleName ?? action?.intent ?? null,
    targetRef: action?.targetRef ?? null,
    frameId: action?.frameId ?? null,
    confidence: action?.confidence ?? null,
    actionability: action?.actionability ?? null,
    actionabilityReason: action?.actionabilityReason ?? null,
    nextRequiredTool: action?.nextRequiredTool ?? null,
    nextRequiredCheck: action?.nextRequiredCheck ?? null,
  };
}

function compactRegion(region: any): Record<string, unknown> {
  return {
    regionId: region?.regionId ?? region?.id ?? null,
    regionType: region?.regionType ?? null,
    title: region?.title ?? region?.heading ?? region?.label ?? null,
    state: region?.state ?? null,
    targetability: region?.targetability ?? null,
    candidateActionIds: Array.isArray(region?.candidateActionIds)
      ? region.candidateActionIds.slice(0, 12)
      : [],
    confidence: region?.confidence ?? null,
  };
}

function compactHighValueObject(object: any): Record<string, unknown> {
  return {
    objectId: object?.objectId ?? object?.id ?? null,
    objectType: object?.objectType ?? object?.type ?? object?.regionType ?? null,
    label: object?.label ?? object?.title ?? object?.text ?? object?.accessibleName ?? null,
    actionType: object?.actionType ?? null,
    targetRef: object?.targetRef ?? null,
    confidence: object?.confidence ?? null,
  };
}

function buildReadPageControlPayload(
  sharedPayload: ReadPageCompactSnapshot,
): ReadPageCompactSnapshot {
  const payload = sharedPayload as any;
  return {
    mode: payload.mode,
    page: payload.page,
    summary: payload.summary,
    artifactRefs: payload.artifactRefs,
    tabId: payload.tabId,
    kind: payload.kind,
    selectedDataSource: payload.selectedDataSource,
    sourceKind: payload.sourceKind,
    freshness: payload.freshness,
    readinessVerdict: payload.readinessVerdict,
    readinessReason: payload.readinessReason,
    rowCount: payload.rowCount,
    pageContext: payload.pageContext,
    frameContext: payload.frameContext,
    candidateActions: Array.isArray(payload.candidateActions)
      ? payload.candidateActions.slice(0, 24).map(compactAction)
      : [],
    pageRegions: Array.isArray(payload.pageRegions)
      ? payload.pageRegions.slice(0, 12).map(compactRegion)
      : [],
    highValueObjects: Array.isArray(payload.highValueObjects)
      ? payload.highValueObjects.slice(0, 16).map(compactHighValueObject)
      : [],
    browserPageObjectCompact: payload.browserPageObjectCompact
      ? {
          primaryConclusion: payload.browserPageObjectCompact.primaryConclusion ?? null,
          operationSummary: payload.browserPageObjectCompact.operationSummary ?? null,
          changedGroups: payload.browserPageObjectCompact.changedGroups ?? [],
        }
      : undefined,
    searchSurface: payload.searchSurface
      ? {
          query: payload.searchSurface.query ?? null,
          resultCount: payload.searchSurface.resultCount ?? null,
          primaryActionTargetRef: payload.searchSurface.primaryActionTargetRef ?? null,
        }
      : undefined,
    pageProjection: payload.pageProjection
      ? {
          pageId: payload.pageProjection.pageId ?? null,
          tabId: payload.pageProjection.tabId ?? null,
          pageRole: payload.pageProjection.pageRole ?? null,
          pageModelKey: payload.pageProjection.pageModelKey ?? null,
          sourceFreshness: payload.pageProjection.sourceFreshness ?? null,
          chosenDataSource: payload.pageProjection.chosenDataSource ?? null,
        }
      : undefined,
    ownershipRuntime: payload.ownershipRuntime
      ? {
          tabId: payload.ownershipRuntime.tabId ?? null,
          currentOwnerType: payload.ownershipRuntime.currentOwnerType ?? null,
          isCurrentTabActive: payload.ownershipRuntime.isCurrentTabActive ?? null,
          isCurrentWindowFocused: payload.ownershipRuntime.isCurrentWindowFocused ?? null,
          isReadTargetBrowserActiveTab:
            payload.ownershipRuntime.isReadTargetBrowserActiveTab ?? null,
        }
      : undefined,
  } as ReadPageCompactSnapshot;
}
