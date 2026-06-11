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

function buildReadPageControlPayload(
  sharedPayload: ReadPageCompactSnapshot,
): ReadPageCompactSnapshot {
  const controlPayload = {
    ...(sharedPayload as unknown as Record<string, unknown>),
  };
  delete controlPayload.aiContextEnvelope;
  return controlPayload as unknown as ReadPageCompactSnapshot;
}
