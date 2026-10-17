import { inferPageUnderstanding } from './read-page-understanding';
import { buildFallbackRefMap, formatElementsAsPageContent } from './read-page-fallback-format';
import { reconcilePageUnderstandingWithVisibleRows } from './read-page-visible-region-postprocess';
import { attachFallbackRefs, shouldRepairVisibleRowsTargetRefs } from './read-page-target-recovery';
import { extractVisibleRegionRows } from './visible-region-rows';

type CollectInteractiveElementsFallback = (
  tabId: number,
  options?: {
    textQuery?: string;
    selector?: string;
    includeCoordinates?: boolean;
    frameId?: number;
  },
) => Promise<any | null>;

type SampleVisibleTextContent = (tabId: number, frameId?: number) => Promise<string | null>;

interface VisibleRegionRuntimeContext {
  tabId: number;
  basePayload: Record<string, any>;
  currentUrl: string;
  currentTitle: string;
  frameId?: number;
  collectInteractiveElementsFallback: CollectInteractiveElementsFallback;
  sampleVisibleTextContent: SampleVisibleTextContent;
}

export async function repairVisibleRowsTargetRefs(
  params: {
    pageUnderstanding: ReturnType<typeof inferPageUnderstanding>;
  } & VisibleRegionRuntimeContext,
): Promise<boolean> {
  if (!shouldRepairVisibleRowsTargetRefs(params.basePayload.visibleRegionRows)) return false;

  const fallback = await params.collectInteractiveElementsFallback(params.tabId, {
    frameId: params.frameId,
  });
  if (!fallback) return false;
  const merged = fallback.elements.slice(0, 150);
  const fallbackRefMap = buildFallbackRefMap(merged);
  const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
  const visibleTextContent =
    typeof params.basePayload.visibleTextContent === 'string' &&
    params.basePayload.visibleTextContent.trim()
      ? params.basePayload.visibleTextContent
      : await params.sampleVisibleTextContent(params.tabId, params.frameId);
  if (!visibleTextContent) return false;

  const repairedRows = extractVisibleRegionRows({
    pageContent: String(params.basePayload.pageContent || ''),
    visibleTextContent,
    sourceRegion: params.pageUnderstanding.primaryRegion,
    fallbackInteractiveElements: mergedWithRefs,
    url: params.currentUrl,
    title: params.currentTitle,
    viewport: params.basePayload.viewport,
    scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
    pixelsBelow: typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
  });
  if (
    !repairedRows.visibleRegionRowsUsed ||
    repairedRows.targetRefCoverageRate <= params.basePayload.visibleRegionRows.targetRefCoverageRate
  ) {
    return false;
  }

  params.basePayload.visibleTextContent = visibleTextContent;
  params.basePayload.visibleRegionRows = repairedRows;
  params.basePayload.fallbackUsed = true;
  params.basePayload.fallbackSource = 'get_interactive_elements_target_ref_repair';
  params.basePayload.elements = mergedWithRefs;
  params.basePayload.count = fallback.elements.length;
  params.basePayload.refMap = fallbackRefMap;
  params.basePayload.refMapCount = fallbackRefMap.filter((entry) => entry != null).length;
  reconcilePageUnderstandingWithVisibleRows(params.basePayload);
  return true;
}

export async function applyInteractiveFallbackPayload(
  params: {
    fallback: any;
    treeOk: boolean;
    treeError?: string | null;
  } & VisibleRegionRuntimeContext,
): Promise<boolean> {
  if (!params.fallback) return false;

  const merged = params.fallback.elements.slice(0, 150);
  const fallbackRefMap = buildFallbackRefMap(merged);
  const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
  const fallbackRefEntryCount = fallbackRefMap.filter((entry) => entry != null).length;

  params.basePayload.fallbackUsed = true;
  params.basePayload.fallbackSource = 'get_interactive_elements';
  params.basePayload.reason = params.treeOk ? 'sparse_tree' : params.treeError || 'tree_failed';
  params.basePayload.elements = mergedWithRefs;
  params.basePayload.count = params.fallback.elements.length;
  params.basePayload.refMap = fallbackRefMap;
  params.basePayload.refMapCount = fallbackRefEntryCount;
  if (mergedWithRefs.length > 0 || !params.basePayload.pageContent) {
    params.basePayload.pageContent = formatElementsAsPageContent(mergedWithRefs, fallbackRefMap);
  }

  const fallbackUnderstanding = inferPageUnderstanding(
    params.currentUrl,
    params.currentTitle,
    String(params.basePayload.pageContent || ''),
  );
  params.basePayload.pageRole = fallbackUnderstanding.pageRole;
  params.basePayload.primaryRegion = fallbackUnderstanding.primaryRegion;
  params.basePayload.primaryRegionConfidence = fallbackUnderstanding.primaryRegionConfidence;
  params.basePayload.footerOnly = fallbackUnderstanding.footerOnly;
  params.basePayload.anchorTexts = fallbackUnderstanding.anchorTexts;
  params.basePayload.visibleRegionRows = extractVisibleRegionRows({
    pageContent: String(params.basePayload.pageContent || ''),
    sourceRegion: fallbackUnderstanding.primaryRegion,
    fallbackInteractiveElements: mergedWithRefs,
    url: params.currentUrl,
    title: params.currentTitle,
    viewport: params.basePayload.viewport,
    scrollY: typeof params.fallback?.scrollY === 'number' ? params.fallback.scrollY : null,
    pixelsBelow:
      typeof params.fallback?.pixelsBelow === 'number' ? params.fallback.pixelsBelow : null,
  });

  if (!params.basePayload.visibleRegionRows.visibleRegionRowsUsed) {
    const visibleTextContent = await params.sampleVisibleTextContent(params.tabId, params.frameId);
    if (visibleTextContent) {
      params.basePayload.visibleTextContent = visibleTextContent;
      params.basePayload.visibleRegionRows = extractVisibleRegionRows({
        pageContent: String(params.basePayload.pageContent || ''),
        visibleTextContent,
        sourceRegion: fallbackUnderstanding.primaryRegion,
        fallbackInteractiveElements: mergedWithRefs,
        url: params.currentUrl,
        title: params.currentTitle,
        viewport: params.basePayload.viewport,
        scrollY: typeof params.fallback?.scrollY === 'number' ? params.fallback.scrollY : null,
        pixelsBelow:
          typeof params.fallback?.pixelsBelow === 'number' ? params.fallback.pixelsBelow : null,
      });
    }
  }

  reconcilePageUnderstandingWithVisibleRows(params.basePayload);
  return true;
}
