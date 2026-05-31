import { createErrorResponse, ToolResult } from '@/common/tool-handler';
import { BaseBrowserToolExecutor } from '../base-browser';
import {
  TOOL_NAMES,
  type BrowserPageStability,
  type BrowserUserActivityLevel,
  type ReadPageCompactSnapshot,
  type ReadPageFullSnapshot,
  type ReadPageMode,
  type ReadPageNormalSnapshot,
  type ReadPagePageContext,
  type ReadPagePageType,
  type ReadPagePrimaryRegionConfidence,
  type ReadPageRenderMode,
  type ReadPageRequestedLayer,
  type ReadPageOwnershipRuntimeSummary,
  type ReadPageWindowRuntimeState,
  type ReadPageObjectLifecycleSummary,
  type BrowserPageThingProjection,
  type BrowserPageOwnerType,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  buildReadPageBrowserPageObjectView,
  buildBrowserPageThingProjectionFromReadPage,
  buildReadPageObjectLifecycle,
} from '@tabrix/shared';
import { TOOL_MESSAGE_TYPES } from '@/common/message-types';
import { ERROR_MESSAGES } from '@/common/constants';
import { inferPageUnderstanding, type PageRole } from './read-page-understanding';
import {
  recordStableTargetRefSnapshot,
  type StableTargetRefEntry,
} from './stable-target-ref-registry';
import { inferSchemeGuard } from './read-page-scheme-guard';
import { summarizePageContent } from './read-page-content-summary';
import { buildInteractiveElements } from './read-page-interactive-elements';
import { buildCandidateActions, type CandidateActionSeed } from './read-page-candidate-actions';
import { buildArtifactRefs } from './read-page-artifact-refs';
import { buildFallbackRefMap, formatElementsAsPageContent } from './read-page-fallback-format';
import { buildExtensionLayer, buildStableSnapshotLayer } from './read-page-snapshot-builders';
import { buildReadPageModeResult } from './read-page-mode-result';
import { extractVisibleRegionRows, type VisibleRegionRowsResult } from './visible-region-rows';
import {
  extractGlobalMenuLabelsForTargetRecovery,
  type ReadPageVisualElementHint,
} from './read-page-task-protocol';
import {
  getBrowserWorldSnapshot,
  markBrowserWorldTabAiOperated,
  type BrowserWorldTabObject,
} from '../../browser-world-inventory';

interface ReadPageStats {
  processed: number;
  included: number;
  durationMs: number;
}
type PageType = ReadPagePageType;
type PrimaryRegionConfidence = ReadPagePrimaryRegionConfidence;

interface ReadPageParams {
  filter?: 'interactive'; // when omitted, return all visible elements
  mode?: ReadPageMode; // output verbosity mode, default compact
  render?: ReadPageRenderMode; // render mode, default 'json'
  depth?: number; // maximum DOM depth to traverse (0 = root only)
  refId?: string; // focus on subtree rooted at this refId
  tabId?: number; // target existing tab id
  windowId?: number; // when no tabId, pick active tab from this window
  // Layer envelope. When omitted preserves the legacy full L0+L1+L2 payload.
  // The stable HVO targetRef registry is ALWAYS written (even at 'L0') so
  // chrome_click_element resolution stays deterministic.
  requestedLayer?: ReadPageRequestedLayer;
}

const READ_PAGE_SPARSE_RETRY_DELAY_MS = 450;
const READ_PAGE_PENDING_DOCUMENT_WAIT_MS = 5000;
const READ_PAGE_CONTENT_MESSAGE_RETRY_DELAY_MS = 450;
const INTERACTIVE_ELEMENTS_HELPER_FILE = 'inject-scripts/interactive-elements-helper.js';
const INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS = 300;
const VISIBLE_TEXT_FALLBACK_MAX_CHARS = 12_000;
const VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD = 0.95;
const OBJECT_LIFECYCLE_CACHE_MAX_TABS = 64;
const QR_VISUAL_ELEMENT_SELECTOR = [
  '[class*="qr"]',
  '[class*="QR"]',
  '[class*="qrcode"]',
  '[class*="QRCode"]',
  '[aria-label*="qr"]',
  '[aria-label*="QR"]',
  '[aria-label*="二维码"]',
  '[alt*="qr"]',
  '[alt*="QR"]',
  '[alt*="二维码"]',
  '[title*="qr"]',
  '[title*="QR"]',
  '[title*="二维码"]',
  'canvas',
  'img',
].join(', ');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const objectLifecycleByTab = new Map<
  number,
  {
    url: string;
    lifecycle: ReadPageObjectLifecycleSummary;
    pageProjection: BrowserPageThingProjection | null;
    ownershipRuntime: ReadPageOwnershipRuntimeSummary | null;
  }
>();

function rememberObjectLifecycleSnapshot(
  tabId: number,
  url: string,
  lifecycle: ReadPageObjectLifecycleSummary,
  pageProjection: BrowserPageThingProjection | null,
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null,
): void {
  if (!Number.isFinite(tabId)) return;
  objectLifecycleByTab.delete(tabId);
  objectLifecycleByTab.set(tabId, { url, lifecycle, pageProjection, ownershipRuntime });
  while (objectLifecycleByTab.size > OBJECT_LIFECYCLE_CACHE_MAX_TABS) {
    const firstKey = objectLifecycleByTab.keys().next().value;
    if (firstKey === undefined) break;
    objectLifecycleByTab.delete(firstKey);
  }
}

function buildBoundedWatchLoopSnapshot(params: {
  tabId: number;
  url: string;
  pageRegions: ReadPageCompactSnapshot['pageRegions'];
  lifecycle: ReadPageObjectLifecycleSummary;
  pageProjection: BrowserPageThingProjection | null;
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null;
}): {
  objectLifecycle: ReadPageObjectLifecycleSummary;
  previousPageProjection: BrowserPageThingProjection | null;
  previousOwnershipRuntime: ReadPageOwnershipRuntimeSummary | null;
} {
  const currentSingleSnapshot = params.lifecycle;
  const previous = objectLifecycleByTab.get(params.tabId);
  rememberObjectLifecycleSnapshot(
    params.tabId,
    params.url,
    currentSingleSnapshot,
    params.pageProjection,
    params.ownershipRuntime,
  );
  if (!previous || previous.url !== params.url || !Array.isArray(params.pageRegions)) {
    return {
      objectLifecycle: currentSingleSnapshot,
      previousPageProjection: null,
      previousOwnershipRuntime: null,
    };
  }
  return {
    objectLifecycle: buildReadPageObjectLifecycle(params.pageRegions, {
      previous: previous.lifecycle,
    }),
    previousPageProjection: previous.pageProjection,
    previousOwnershipRuntime: previous.ownershipRuntime,
  };
}

function resetObjectLifecycleCacheForTests(): void {
  objectLifecycleByTab.clear();
}

function getTabNavigationUrl(tab: Pick<chrome.tabs.Tab, 'url' | 'pendingUrl'>): string {
  return String(tab.url || tab.pendingUrl || '');
}

/**
 * Infer page stability from tab properties.
 * Returns 'loading' when the document is still loading,
 * 'stale' when the tab has been discarded or unloaded,
 * 'stable' when the page is fully loaded and interactive.
 */
function inferPageStability(tab: { status?: string; discarded?: boolean }): BrowserPageStability {
  if (tab.discarded === true) return 'stale';
  if (tab.status === 'loading') return 'loading';
  if (tab.status === 'unloaded') return 'stale';
  return 'stable';
}

async function inferUserActivityLevel(input: {
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
}): Promise<BrowserUserActivityLevel> {
  // Fast path: user is directly viewing the tab
  if (input.isCurrentTabActive === true && input.isCurrentWindowFocused === true) {
    return 'active';
  }
  // Cannot determine — missing API data
  if (input.isCurrentTabActive === null || input.isCurrentWindowFocused === null) {
    return 'unknown';
  }
  // User is NOT viewing the tab — check system idle state
  try {
    if (typeof chrome?.idle?.queryState === 'function') {
      const state = await chrome.idle.queryState(15);
      if (state === 'active') return 'recent_input';
    }
  } catch {
    /* fall through to 'none' */
  }
  return 'none';
}

function reconcilePageUnderstandingWithVisibleRows(payload: Record<string, any>): void {
  const rows = payload.visibleRegionRows as VisibleRegionRowsResult | undefined;
  if (payload.pageRole !== 'login_required' || !rows?.visibleRegionRowsUsed) {
    return;
  }

  payload.pageRole = 'unknown';
  payload.primaryRegion = 'visible_results';
  payload.primaryRegionConfidence = 'medium';
  payload.footerOnly = false;
  payload.visibleRegionRows = {
    ...rows,
    sourceRegion: 'visible_results',
    rows: rows.rows.map((row) => ({
      ...row,
      sourceRegion: 'visible_results',
    })),
  };
}

function completeVisibleRegionRows(params: {
  rows: VisibleRegionRowsResult;
  pageContent: string;
  visibleTextContent?: string | null;
  primaryRegion: string | null;
  interactiveElements: Array<{ ref: string; role: string; name: string; href?: string }>;
  currentUrl: string;
  currentTitle: string;
  viewport: { width: number | null; height: number | null; dpr: number | null };
}): VisibleRegionRowsResult {
  if (params.rows.visibleRegionRowsUsed) {
    return params.rows;
  }
  return extractVisibleRegionRows({
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    sourceRegion: params.primaryRegion,
    fallbackInteractiveElements: params.interactiveElements,
    url: params.currentUrl,
    title: params.currentTitle,
    viewport: params.viewport,
  });
}

function shouldSampleVisibleText(input: {
  treeOk: boolean;
  userControlled: boolean;
  mode: ReadPageMode;
  requestedDepth: number | undefined;
  focusRefId: string | undefined;
  rows: VisibleRegionRowsResult;
}): boolean {
  if (!input.treeOk) return false;
  if (input.focusRefId) return false;
  if (input.mode === 'full') return true;
  if (!input.userControlled) return true;
  if (input.rows.visibleRegionRowsUsed) return false;
  return input.requestedDepth !== undefined && input.requestedDepth <= 3;
}

function shouldRepairVisibleRowsTargetRefs(rows: VisibleRegionRowsResult | undefined): boolean {
  return (
    rows?.visibleRegionRowsUsed === true &&
    rows.rowCount >= 2 &&
    rows.targetRefCoverageRate < VISIBLE_ROWS_TARGET_REF_REPAIR_THRESHOLD
  );
}

function attachFallbackRefs(
  elements: any[],
  refMap: ReturnType<typeof buildFallbackRefMap>,
): any[] {
  return elements.map((element, index) => {
    const ref = refMap[index]?.ref;
    return typeof ref === 'string' ? { ...element, ref } : element;
  });
}

function promoteTextMenuTriggerSelector(selector: unknown): string | undefined {
  const raw = typeof selector === 'string' ? selector.trim() : '';
  if (!raw) return undefined;
  const parts = raw
    .split(/\s*>\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) return raw;
  const last = parts[parts.length - 1]?.toLowerCase() || '';
  if (/^(span|svg|path|img|i|em|strong)(?::|\[|\.|#|$)/.test(last)) {
    return parts.slice(0, -1).join(' > ');
  }
  return raw;
}

function extractVisibleMenuActionLabelsForTargetRecovery(visibleTextContent: unknown): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  const lines = String(visibleTextContent || '')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length > 18) continue;
    if (
      !/\b(log[ -]?out|sign[ -]?out|settings?|help|support|feedback)\b|退出|注销|设置|帮助|客服|反馈/i.test(
        line,
      )
    ) {
      continue;
    }
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(line);
    if (labels.length >= 8) break;
  }
  return labels;
}

function attachInteractiveRects<T extends { ref?: string; rect?: unknown }>(
  elements: T[],
  refMap: any[],
): T[] {
  const rectByRef = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
    const rect = entry?.rect;
    if (
      !ref ||
      !rect ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      continue;
    }
    rectByRef.set(ref, {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    });
  }
  if (rectByRef.size === 0) return elements;
  return elements.map((element) => {
    const rect = element.ref ? rectByRef.get(element.ref) : undefined;
    return rect ? { ...element, rect } : element;
  });
}

function attachInteractiveValueState<
  T extends { ref?: string; valueState?: 'empty' | 'non_empty' | 'unknown' },
>(elements: T[], refMap: any[]): T[] {
  const valueStateByRef = new Map<string, 'empty' | 'non_empty' | 'unknown'>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const ref = typeof entry?.ref === 'string' ? entry.ref.trim() : '';
    if (!ref) continue;
    if (
      entry?.valueState === 'empty' ||
      entry?.valueState === 'non_empty' ||
      entry?.valueState === 'unknown'
    ) {
      valueStateByRef.set(ref, entry.valueState);
      continue;
    }
    const rawValue =
      Object.prototype.hasOwnProperty.call(entry, 'value') ||
      Object.prototype.hasOwnProperty.call(entry, 'currentValue')
        ? (entry.value ?? entry.currentValue)
        : undefined;
    if (rawValue === undefined || rawValue === null) continue;
    valueStateByRef.set(ref, String(rawValue).length > 0 ? 'non_empty' : 'empty');
  }
  if (valueStateByRef.size === 0) return elements;
  return elements.map((element) => {
    if (!element.ref || element.valueState) return element;
    const valueState = valueStateByRef.get(element.ref);
    return valueState ? { ...element, valueState } : element;
  });
}

function hasQrVisibleContext(pageContent: string, visibleTextContent?: string | null): boolean {
  const text = `${pageContent || ''}\n${visibleTextContent || ''}`;
  if (!text.trim()) return false;
  const hasQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(text);
  const authHidden = /"?(?:showLogin|loginModalVisible|authModalVisible)"?\s*:\s*false/i.test(text);
  return hasQrSignal && !authHidden;
}

function normalizeWindowRuntimeState(value: unknown): ReadPageWindowRuntimeState | null {
  if (
    value === 'normal' ||
    value === 'minimized' ||
    value === 'maximized' ||
    value === 'fullscreen' ||
    value === 'docked'
  ) {
    return value;
  }
  return typeof value === 'string' ? 'unknown' : null;
}

function readWindowInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function finiteRect(rect: any): { x: number; y: number; width: number; height: number } | null {
  if (
    rect &&
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  ) {
    return {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    };
  }
  return null;
}

function scoreQrVisualElementHint(
  element: any,
  index: number,
): (ReadPageVisualElementHint & { score: number }) | null {
  const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
  if (!selector) return null;
  const rect = finiteRect(element?.coordinates?.rect);
  if (!rect || rect.width < 40 || rect.height < 40) return null;
  const area = rect.width * rect.height;
  if (area < 2_000 || area > 160_000) return null;
  const aspectRatio = rect.width / Math.max(1, rect.height);
  if (aspectRatio < 0.65 || aspectRatio > 1.55) return null;

  const role = String(element?.tagName || element?.type || element?.role || 'img').toLowerCase();
  const attributeSignal = [
    element?.text,
    element?.alt,
    element?.title,
    element?.className,
    element?.role,
    role,
  ]
    .filter(Boolean)
    .join(' ');
  const scoringSignal = [attributeSignal, selector].filter(Boolean).join(' ');

  const hasExplicitQrSignal = /\b(qr|qrcode|scan code)\b|二维码|扫码|扫一扫/i.test(attributeSignal);
  if (!hasExplicitQrSignal) return null;

  let score = 0;
  score += 120;
  if (/\b(canvas|img|svg|selected)\b/i.test(role)) score += 24;
  if (rect.width >= 100 && rect.width <= 360 && rect.height >= 100 && rect.height <= 360)
    score += 36;
  if (String(element?.text || '').trim().length === 0) score += 18;
  if (/\b(logo|brand|wordmark|avatar|icon|profile)\b/i.test(scoringSignal)) score -= 80;
  score -= Math.min(20, index * 2);

  if (score < 40) return null;
  return {
    id: `qr_visual_${index + 1}`,
    label: 'QR visual element candidate',
    selector,
    role,
    rect,
    visualSignature:
      typeof element?.visualSignature === 'string' &&
      /^visual_[a-f0-9]{8}$/i.test(element.visualSignature)
        ? element.visualSignature.toLowerCase()
        : undefined,
    qrSignal: true,
    reason: 'qr_visual_element_signal',
    confidence: Math.min(0.92, Math.max(0.54, score / 180)),
    score,
  };
}

async function buildModeOutput(params: {
  mode: ReadPageMode;
  renderMode: ReadPageRenderMode;
  tabId: number;
  currentWindowId: number | null;
  currentWindowState: ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  pageStability: BrowserPageStability;
  currentUrl: string;
  currentTitle: string;
  pageType: PageType;
  scheme: string;
  pageRole: PageRole;
  primaryRegion: string | null;
  primaryRegionConfidence: PrimaryRegionConfidence;
  footerOnly: boolean;
  anchorTexts: string[];
  pageContent: string;
  visibleTextContent?: string | null;
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: string;
  };
  stats: ReadPageStats | { processed: number; included: number; durationMs: number };
  viewport: { width: number | null; height: number | null; dpr: number | null };
  filter: string;
  depth: number | null;
  focus: { refId: string; found: boolean } | null;
  sparse: boolean;
  fallbackUsed: boolean;
  fallbackSource: string | null;
  refMapCount: number;
  markedElements: any[];
  elements: any[];
  count: number;
  reason: string | null;
  tips: string;
  refMap: any[];
  candidateActions: CandidateActionSeed[];
  visualElements: ReadPageVisualElementHint[];
  visibleRegionRows: VisibleRegionRowsResult;
  /** Layer envelope; defaults to 'L0+L1+L2' for legacy callers. */
  requestedLayer: ReadPageRequestedLayer;
}): Promise<ReadPageCompactSnapshot | ReadPageNormalSnapshot | ReadPageFullSnapshot> {
  const interactiveLimit = params.mode === 'compact' ? 24 : 80;
  const interactiveElements = attachInteractiveValueState(
    attachInteractiveRects(
      buildInteractiveElements(
        params.pageContent,
        params.elements,
        interactiveLimit,
        params.mode,
        params.currentUrl,
      ),
      params.refMap,
    ),
    params.refMap,
  );
  const visibleRegionRows = completeVisibleRegionRows({
    rows: params.visibleRegionRows,
    pageContent: params.pageContent,
    visibleTextContent: params.visibleTextContent,
    primaryRegion: params.primaryRegion,
    interactiveElements,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    viewport: params.viewport,
  });
  const candidateActions =
    params.candidateActions.length > 0
      ? params.candidateActions
      : buildCandidateActions(interactiveElements, params.refMap);
  const artifactRefs = buildArtifactRefs(params.tabId, params.renderMode === 'markdown');
  const pageContext: ReadPagePageContext = {
    filter: params.filter,
    depth: params.depth,
    focus: params.focus,
    scheme: params.scheme,
    viewport: params.viewport,
    sparse: params.sparse,
    fallbackUsed: params.fallbackUsed,
    fallbackSource: params.fallbackSource,
    refMapCount: params.refMapCount,
    markedElementsCount: params.markedElements.length,
  };

  const stableLayer = buildStableSnapshotLayer({
    mode: params.mode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    quality: params.contentSummary.quality,
    interactiveElements,
    artifactRefs,
  });

  const extensionLayer = buildExtensionLayer({
    mode: params.mode,
    renderMode: params.renderMode,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    tabId: params.tabId,
    pageStability: params.pageStability,
    pageType: params.pageType,
    pageRole: params.pageRole,
    primaryRegion: params.primaryRegion,
    contentSummary: params.contentSummary,
    artifactRefs,
    candidateActions,
    interactiveElements,
    pageContext,
    visibleRegionRows,
    visibleTextContent: params.visibleTextContent,
    visualElements: params.visualElements,
    requestedLayer: params.requestedLayer,
  });

  // Feed the per-tab stable-targetRef registry so the click bridge can
  // translate `tgt_*` from prior turns back into the live per-snapshot
  // `ref_*` for this exact tab. We do this exactly once per snapshot, after
  // the extension layer is built but before serializing the response, so
  // every successful read replaces the previous mapping atomically.
  if (Array.isArray(extensionLayer.highValueObjects)) {
    const entries: StableTargetRefEntry[] = [];
    for (const highValueObject of extensionLayer.highValueObjects) {
      if (highValueObject.targetRef && highValueObject.ref) {
        entries.push({ targetRef: highValueObject.targetRef, ref: highValueObject.ref });
      }
    }
    recordStableTargetRefSnapshot(params.tabId, entries);
  }

  const sharedPayload: ReadPageCompactSnapshot = {
    ...stableLayer,
    ...extensionLayer,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
  };
  const observedAt = new Date().toISOString();
  const userActivityLevel = await inferUserActivityLevel({
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
  });
  const browserWorld = await getBrowserWorldSnapshot();
  const browserWorldTab = browserWorld.tabs.find((tab) => tab.tabId === params.tabId) ?? null;
  const ownerType = browserWorldTabOpenedByToOwnerType(browserWorldTab?.openedBy);
  sharedPayload.pageProjection = buildBrowserPageThingProjectionFromReadPage({
    snapshot: sharedPayload,
    projectionId: `read_page:${params.tabId}:${sharedPayload.historyRef ?? 'snapshot'}`,
    observedAt,
    pageId: `tab:${params.tabId}`,
    tabId: params.tabId,
    ownerType,
    contextVersion: sharedPayload.historyRef ?? `read_page:${params.tabId}`,
    previousContextVersion: null,
    changedByActionId: null,
    changeCause: 'unknown',
    userActivityLevel,
    interferenceRisk: 'medium',
    stability: params.pageStability,
  });
  sharedPayload.ownershipRuntime = buildReadPageOwnershipRuntimeSummary({
    tabId: params.tabId,
    currentOwnerType: ownerType,
    currentUrl: params.currentUrl,
    currentTitle: params.currentTitle,
    browserWorldTab,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
    browserWorldObjectChangeSummary: browserWorld.summary.objectChangeSummary,
    browserWorldActionableObjectChangeSummary:
      browserWorld.summary.actionableObjectChangeSummary ??
      browserWorld.summary.objectChangeSummary,
    browserWorldCurrentOperationConclusion: browserWorld.summary.currentOperationConclusion,
    browserWorldRoutingDecisionSummary: browserWorld.summary.routingDecisionSummary,
  });
  if (sharedPayload.objectLifecycle) {
    const watchLoopSnapshot = buildBoundedWatchLoopSnapshot({
      tabId: params.tabId,
      url: params.currentUrl,
      pageRegions: sharedPayload.pageRegions,
      lifecycle: sharedPayload.objectLifecycle,
      pageProjection: sharedPayload.pageProjection,
      ownershipRuntime: sharedPayload.ownershipRuntime,
    });
    sharedPayload.objectLifecycle = watchLoopSnapshot.objectLifecycle;
    const browserPageObject = buildReadPageBrowserPageObjectView({
      pageRegions: sharedPayload.pageRegions,
      pageOperationMap: sharedPayload.pageOperationMap,
      objectLifecycle: sharedPayload.objectLifecycle,
      previousPageProjection: watchLoopSnapshot.previousPageProjection,
      pageProjection: sharedPayload.pageProjection,
      previousOwnershipRuntime: watchLoopSnapshot.previousOwnershipRuntime,
      ownershipRuntime: sharedPayload.ownershipRuntime,
      selectedDataSource: sharedPayload.selectedDataSource,
      sourceRouteHonestyVerdict: null,
    });
    sharedPayload.browserPageObjectCompact = browserPageObject.compact;
    if (params.mode === 'compact') {
      delete sharedPayload.browserPageObject;
    } else {
      sharedPayload.browserPageObject = browserPageObject;
    }
  }

  return buildReadPageModeResult({
    sharedPayload,
    mode: params.mode,
    primaryRegionConfidence: params.primaryRegionConfidence,
    footerOnly: params.footerOnly,
    anchorTexts: params.anchorTexts,
    pageContent: params.pageContent,
    contentSummary: params.contentSummary,
    stats: params.stats,
    elements: params.elements,
    count: params.count,
    markedElements: params.markedElements,
    refMap: params.refMap,
    reason: params.reason,
    tips: params.tips,
  });
}

function browserWorldTabOpenedByToOwnerType(
  openedBy: 'ai' | 'user_or_page' | 'unknown' | undefined,
): BrowserPageOwnerType {
  if (openedBy === 'ai') return 'run_owned';
  if (openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

function deriveBrowserWorldTabOpenedBySource(
  tab: BrowserWorldTabObject | null,
): ReadPageOwnershipRuntimeSummary['currentTabOpenedBySource'] {
  if (!tab) return null;
  if (tab.openedBySource) return tab.openedBySource;
  if (tab.openedBy === 'ai') return 'ai_tool';
  if (tab.openedBy === 'user_or_page' && Number.isInteger(tab.openerTabId)) return 'page_opener';
  if (tab.openedBy === 'user_or_page') return 'user_or_unknown';
  return 'unknown';
}

function buildReadPageOwnershipRuntimeSummary(params: {
  tabId: number;
  currentOwnerType: BrowserPageOwnerType;
  currentUrl: string;
  currentTitle: string;
  browserWorldTab: BrowserWorldTabObject | null;
  currentWindowId: number | null;
  currentWindowState: ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  browserWorldObjectChangeSummary: string | null;
  browserWorldActionableObjectChangeSummary: string | null;
  browserWorldCurrentOperationConclusion: string | null;
  browserWorldRoutingDecisionSummary: string | null;
}): ReadPageOwnershipRuntimeSummary {
  const lastAiOperation = params.browserWorldTab?.lastAiOperation ?? null;
  const lastAiOperationConfidence =
    typeof params.browserWorldTab?.lastAiOperationConfidence === 'number'
      ? params.browserWorldTab.lastAiOperationConfidence
      : lastAiOperation
        ? 0.7
        : null;
  const lastAiOperationReason =
    params.browserWorldTab?.lastAiOperationReason ??
    (lastAiOperation
      ? `browser_world_inventory_operation_marker_without_reason:${lastAiOperation}`
      : null);

  return {
    currentTabId: params.tabId,
    currentWindowId: params.currentWindowId,
    currentWindowState: params.currentWindowState,
    currentWindowWidth: params.currentWindowWidth,
    currentWindowHeight: params.currentWindowHeight,
    currentWindowLeft: params.currentWindowLeft,
    currentWindowTop: params.currentWindowTop,
    isCurrentTabActive: params.isCurrentTabActive,
    isCurrentWindowFocused: params.isCurrentWindowFocused,
    browserActiveTabId: params.browserActiveTabId,
    browserActiveTabIdKnown: params.browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab: params.isReadTargetBrowserActiveTab,
    currentTabUrl: params.browserWorldTab?.url || params.currentUrl || null,
    currentTabPendingUrl: params.browserWorldTab?.pendingUrl ?? null,
    currentTabTitle: params.browserWorldTab?.title || params.currentTitle || null,
    currentTabStatus: params.browserWorldTab?.status ?? null,
    currentTabDiscarded: params.browserWorldTab?.discarded ?? null,
    currentTabAudible: params.browserWorldTab?.audible ?? null,
    currentTabMuted: params.browserWorldTab?.muted ?? null,
    currentTabPinned: params.browserWorldTab?.pinned ?? null,
    currentTabOpenerTabId: params.browserWorldTab?.openerTabId ?? null,
    currentTabOpenedBy: params.browserWorldTab?.openedBy ?? null,
    currentTabOpenedBySource: deriveBrowserWorldTabOpenedBySource(params.browserWorldTab),
    currentTabOpenedByConfidence: params.browserWorldTab?.openedByConfidence ?? null,
    currentTabOpenedByReason: params.browserWorldTab?.openedByReason ?? null,
    currentTabAiOperationState: params.browserWorldTab?.aiOperationState ?? null,
    currentTabLastAiOperation: lastAiOperation,
    currentTabLastAiOperationAtMs: params.browserWorldTab?.lastAiOperationAtMs ?? null,
    currentTabLastAiOperationConfidence: lastAiOperationConfidence,
    currentTabLastAiOperationReason: lastAiOperationReason,
    currentTabCanTabrixOperate: params.browserWorldTab?.canTabrixOperate ?? null,
    currentTabOperabilityReason: params.browserWorldTab?.operabilityReason ?? null,
    currentTabRuntimeStateSource: params.browserWorldTab
      ? 'browser_world_inventory'
      : 'chrome_tab_snapshot',
    browserWorldObjectChangeSummary: params.browserWorldObjectChangeSummary,
    browserWorldActionableObjectChangeSummary: params.browserWorldActionableObjectChangeSummary,
    browserWorldCurrentOperationConclusion: params.browserWorldCurrentOperationConclusion,
    browserWorldRoutingDecisionSummary: params.browserWorldRoutingDecisionSummary,
    currentOwnerType: params.currentOwnerType,
    currentTabRunOwnershipVerdict: 'unknown',
    currentTabPrimaryRelationVerdict: 'current_tab_unknown',
    protectedScopeVerdict: 'unknown',
    cleanupEligibility: 'unknown',
    protectReason: null,
    isCurrentTabRunOwnedByTask: false,
    runOwnedTabIds: [],
    runOwnedTabCount: 0,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: null,
    primaryTabId: null,
    primaryTabReuseRate: null,
    benchmarkOwnedTabCount: null,
    heartbeatTabCount: null,
    heartbeatWindowCount: null,
  };
}

class ReadPageTool extends BaseBrowserToolExecutor {
  name = TOOL_NAMES.BROWSER.READ_PAGE;

  __resetObjectLifecycleCacheForTests(): void {
    resetObjectLifecycleCacheForTests();
  }

  private async ensureInteractiveElementsHelper(tabId: number): Promise<void> {
    try {
      const response = await Promise.race([
        chrome.tabs.sendMessage(tabId, {
          action: `${TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS}_ping`,
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('interactive elements helper ping timed out')),
            INTERACTIVE_ELEMENTS_HELPER_PING_TIMEOUT_MS,
          ),
        ),
      ]);

      if (response && (response as any).status === 'pong') {
        return;
      }
    } catch {
      // Expected when the fallback helper has not been injected on this page yet.
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: [INTERACTIVE_ELEMENTS_HELPER_FILE],
      world: 'ISOLATED',
    } as any);
  }

  private async sampleVisibleTextContent(tabId: number): Promise<string | null> {
    try {
      const result = await chrome.scripting.executeScript({
        target: { tabId },
        func: (maxChars: number) => {
          try {
            const text = document.body?.innerText || '';
            return typeof text === 'string' ? text.slice(0, maxChars) : '';
          } catch {
            return '';
          }
        },
        args: [VISIBLE_TEXT_FALLBACK_MAX_CHARS],
      } as any);
      const text = result?.[0]?.result;
      return typeof text === 'string' && text.trim() ? text : null;
    } catch {
      return null;
    }
  }

  private async collectInteractiveElementsFallback(
    tabId: number,
    options: { textQuery?: string; selector?: string; includeCoordinates?: boolean } = {},
  ): Promise<any | null> {
    let fallback: any = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (attempt > 0) await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
      await this.ensureInteractiveElementsHelper(tabId);
      fallback = await this.sendMessageToTab(tabId, {
        action: TOOL_MESSAGE_TYPES.GET_INTERACTIVE_ELEMENTS,
        includeCoordinates: options.includeCoordinates !== false,
        ...(options.selector ? { selector: options.selector } : {}),
        ...(options.textQuery ? { textQuery: options.textQuery } : {}),
      });
      if (fallback && fallback.success && Array.isArray(fallback.elements)) break;
    }
    return fallback && fallback.success && Array.isArray(fallback.elements) ? fallback : null;
  }

  private async collectQrVisualElements(params: {
    tabId: number;
    pageContent: string;
    visibleTextContent?: string | null;
  }): Promise<ReadPageVisualElementHint[]> {
    if (!hasQrVisibleContext(params.pageContent, params.visibleTextContent)) return [];
    const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
      selector: QR_VISUAL_ELEMENT_SELECTOR,
      includeCoordinates: true,
    });
    const elements = Array.isArray(fallback?.elements) ? fallback.elements : [];
    return elements
      .map((element: unknown, index: number) => scoreQrVisualElementHint(element, index))
      .filter(
        (
          item: (ReadPageVisualElementHint & { score: number }) | null,
        ): item is ReadPageVisualElementHint & {
          score: number;
        } => Boolean(item),
      )
      .sort(
        (
          left: ReadPageVisualElementHint & { score: number },
          right: ReadPageVisualElementHint & { score: number },
        ) => right.score - left.score,
      )
      .slice(0, 3)
      .map(({ score: _score, ...item }: ReadPageVisualElementHint & { score: number }) => item);
  }

  private async recoverGlobalMenuTextTargets(params: {
    tabId: number;
    basePayload: any;
  }): Promise<boolean> {
    const labels = Array.from(
      new Set([
        ...extractGlobalMenuLabelsForTargetRecovery(params.basePayload.visibleTextContent),
        ...extractVisibleMenuActionLabelsForTargetRecovery(params.basePayload.visibleTextContent),
      ]),
    )
      .filter((label) => label.length <= 18)
      .slice(0, 16);
    if (labels.length === 0) return false;

    const existingTargetableLabels = new Set(
      (Array.isArray(params.basePayload.elements) ? params.basePayload.elements : [])
        .filter((element: any) => {
          const selector = typeof element?.selector === 'string' ? element.selector.trim() : '';
          const href = typeof element?.href === 'string' ? element.href.trim() : '';
          return Boolean(selector || href);
        })
        .map((element: any) =>
          String(element?.name || element?.text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    );
    const recovered: any[] = [];
    for (const label of labels) {
      const normalizedLabel = label.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!normalizedLabel || existingTargetableLabels.has(normalizedLabel)) continue;
      const fallback = await this.collectInteractiveElementsFallback(params.tabId, {
        textQuery: label,
        includeCoordinates: true,
      });
      const first = Array.isArray(fallback?.elements) ? fallback.elements[0] : null;
      if (!first?.selector) continue;
      recovered.push({
        ...first,
        selector: promoteTextMenuTriggerSelector(first.selector) || first.selector,
        text: label,
        name: label,
        role: first.role || 'button',
        type: first.type === 'text' ? 'interactive' : first.type || 'interactive',
      });
      existingTargetableLabels.add(normalizedLabel);
    }
    if (recovered.length === 0) return false;

    const existingElements = Array.isArray(params.basePayload.elements)
      ? params.basePayload.elements
      : [];
    const existingRefMap = Array.isArray(params.basePayload.refMap)
      ? params.basePayload.refMap
      : [];
    const offset = existingRefMap.filter((entry: unknown) => entry != null).length;
    const recoveredRefMap = buildFallbackRefMap(recovered).map((entry, index) =>
      entry ? { ...entry, ref: `ref_text_menu_${offset + index + 1}` } : null,
    );
    const recoveredWithRefs = attachFallbackRefs(recovered, recoveredRefMap);

    params.basePayload.elements = [...recoveredWithRefs, ...existingElements].slice(0, 150);
    params.basePayload.refMap = [...recoveredRefMap, ...existingRefMap].slice(0, 150);
    params.basePayload.refMapCount = params.basePayload.refMap.filter(
      (entry: unknown) => entry != null,
    ).length;
    params.basePayload.count = Math.max(
      Number(params.basePayload.count || 0),
      params.basePayload.elements.length,
    );
    params.basePayload.fallbackUsed = true;
    params.basePayload.fallbackSource = params.basePayload.fallbackSource
      ? `${params.basePayload.fallbackSource}+text_menu_target_recovery`
      : 'text_menu_target_recovery';
    return true;
  }

  private async generateAccessibilityTreeWithRetry(tabId: number, message: unknown): Promise<any> {
    try {
      return await this.sendMessageToTab(tabId, message);
    } catch (error) {
      await delay(READ_PAGE_CONTENT_MESSAGE_RETRY_DELAY_MS);
      await this.injectContentScript(
        tabId,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        true,
      );
      return await this.sendMessageToTab(tabId, message);
    }
  }

  private async repairVisibleRowsTargetRefs(params: {
    tabId: number;
    basePayload: Record<string, any>;
    pageUnderstanding: ReturnType<typeof inferPageUnderstanding>;
    currentUrl: string;
    currentTitle: string;
  }): Promise<boolean> {
    if (!shouldRepairVisibleRowsTargetRefs(params.basePayload.visibleRegionRows)) return false;

    const fallback = await this.collectInteractiveElementsFallback(params.tabId);
    if (!fallback) return false;
    const merged = fallback.elements.slice(0, 150);
    const fallbackRefMap = buildFallbackRefMap(merged);
    const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
    const visibleTextContent =
      typeof params.basePayload.visibleTextContent === 'string' &&
      params.basePayload.visibleTextContent.trim()
        ? params.basePayload.visibleTextContent
        : await this.sampleVisibleTextContent(params.tabId);
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
      repairedRows.targetRefCoverageRate <=
        params.basePayload.visibleRegionRows.targetRefCoverageRate
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

  // Execute read page
  async execute(args: ReadPageParams): Promise<ToolResult> {
    const { filter, depth, refId, mode, render, requestedLayer } = args || {};

    // Validate refId parameter
    const focusRefId = typeof refId === 'string' ? refId.trim() : '';
    if (refId !== undefined && !focusRefId) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: refId must be a non-empty string`,
      );
    }

    // Validate depth parameter
    const requestedDepth = depth === undefined ? undefined : Number(depth);
    if (requestedDepth !== undefined && (!Number.isInteger(requestedDepth) || requestedDepth < 0)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: depth must be a non-negative integer`,
      );
    }

    const selectedModeRaw = mode || 'compact';
    if (!['compact', 'normal', 'full'].includes(selectedModeRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: mode must be one of compact | normal | full`,
      );
    }
    const selectedMode = selectedModeRaw as ReadPageMode;

    // Validate render mode. Default 'json' so legacy callers see no behavior
    // change. We deliberately fail closed on unknown values rather than
    // silently coerce: an unknown render mode usually means the upstream
    // client speaks a newer contract than this extension can satisfy, and
    // silent coercion would hide that drift.
    const selectedRenderRaw = render || 'json';
    if (!['json', 'markdown'].includes(selectedRenderRaw)) {
      return createErrorResponse(
        `${ERROR_MESSAGES.INVALID_PARAMETERS}: render must be one of json | markdown`,
      );
    }
    const selectedRender = selectedRenderRaw as ReadPageRenderMode;

    // Validate requestedLayer. Default to the legacy `'L0+L1+L2'` envelope
    // so older callers see byte-identical payloads. Unknown values fail
    // closed for the same reason `render` does: the upstream client almost
    // certainly speaks a newer contract than this extension can satisfy.
    let selectedLayer: ReadPageRequestedLayer = 'L0+L1+L2';
    if (requestedLayer !== undefined) {
      if (
        typeof requestedLayer !== 'string' ||
        !(READ_PAGE_REQUESTED_LAYER_VALUES as readonly string[]).includes(requestedLayer)
      ) {
        return createErrorResponse(
          `${ERROR_MESSAGES.INVALID_PARAMETERS}: requestedLayer must be one of ${READ_PAGE_REQUESTED_LAYER_VALUES.join(' | ')}`,
        );
      }
      selectedLayer = requestedLayer;
    }

    // Track if user explicitly controlled the output (skip sparse heuristics)
    const userControlled = requestedDepth !== undefined || !!focusRefId;

    try {
      // Tip text returned to callers to guide next action
      const standardTips =
        "Stay on the safe path first: prefer ref-based actions from chrome_read_page or chrome_get_interactive_elements. If the specific element you need is still missing, use chrome_screenshot for visual confirmation and coordinates. Reserve chrome_computer or chrome_javascript for explicit fallback/debug cases only. Also note: 'markedElements' are user-marked elements and have the highest priority when choosing targets.";

      const explicit = await this.tryGetTab(args?.tabId);
      let tab = explicit || (await this.getActiveTabOrThrowInWindow(args?.windowId));
      if (!tab.id)
        return createErrorResponse(ERROR_MESSAGES.TAB_NOT_FOUND + ': Active tab has no ID');
      const tabId = tab.id;
      markBrowserWorldTabAiOperated(tabId, 'read_page');

      const initialNavigationUrl = getTabNavigationUrl(tab);
      if (
        explicit &&
        /^https?:\/\//i.test(initialNavigationUrl) &&
        (!tab.url || tab.status === 'loading')
      ) {
        const settleResult = await this.waitForTabSettled(tabId, {
          timeoutMs: READ_PAGE_PENDING_DOCUMENT_WAIT_MS,
        });
        tab = settleResult.tab;
      }

      const currentUrl = getTabNavigationUrl(tab);
      const currentTitle = String(tab.title || '');
      const currentWindowId = Number.isInteger(tab.windowId) ? tab.windowId : null;
      const isCurrentTabActive = typeof tab.active === 'boolean' ? tab.active : null;
      let isCurrentWindowFocused: boolean | null = null;
      let currentWindowState: ReadPageWindowRuntimeState | null = null;
      let currentWindowWidth: number | null = null;
      let currentWindowHeight: number | null = null;
      let currentWindowLeft: number | null = null;
      let currentWindowTop: number | null = null;
      let browserActiveTabId: number | null = null;
      let browserActiveTabIdKnown = false;
      let isReadTargetBrowserActiveTab: boolean | null = null;
      if (currentWindowId !== null && typeof chrome.windows?.get === 'function') {
        try {
          const currentWindow = await chrome.windows.get(currentWindowId, { populate: true });
          isCurrentWindowFocused =
            currentWindow && typeof currentWindow.focused === 'boolean'
              ? currentWindow.focused
              : null;
          currentWindowState = normalizeWindowRuntimeState(currentWindow?.state);
          currentWindowWidth = readWindowInteger(currentWindow?.width);
          currentWindowHeight = readWindowInteger(currentWindow?.height);
          currentWindowLeft = readWindowInteger(currentWindow?.left);
          currentWindowTop = readWindowInteger(currentWindow?.top);
          const activeWindowTab = Array.isArray(currentWindow?.tabs)
            ? currentWindow.tabs.find((windowTab) => windowTab.active === true)
            : null;
          browserActiveTabId =
            activeWindowTab && Number.isInteger(activeWindowTab.id) ? activeWindowTab.id! : null;
          browserActiveTabIdKnown = browserActiveTabId !== null;
          isReadTargetBrowserActiveTab =
            browserActiveTabIdKnown && Number.isInteger(tabId)
              ? browserActiveTabId === tabId
              : null;
        } catch {
          isCurrentWindowFocused = null;
          currentWindowState = null;
          currentWindowWidth = null;
          currentWindowHeight = null;
          currentWindowLeft = null;
          currentWindowTop = null;
          browserActiveTabId = null;
          browserActiveTabIdKnown = false;
          isReadTargetBrowserActiveTab = null;
        }
      }
      const pageStability = inferPageStability(tab);
      const schemeGuard = inferSchemeGuard(currentUrl);

      if (!schemeGuard.supportedForContentScript) {
        const guardPageContent = [
          '- generic "Current tab is not a regular web page"',
          currentTitle ? `- generic "title: ${currentTitle.replace(/\s+/g, ' ').trim()}"` : '',
          currentUrl ? `- generic "url: ${currentUrl}"` : '',
          `- generic "pageType: ${schemeGuard.pageType}"`,
          `- generic "unsupportedPageType: ${schemeGuard.unsupportedPageType || 'none'}"`,
          `- generic "recommendedAction: ${schemeGuard.recommendedAction || 'none'}"`,
        ]
          .filter(Boolean)
          .join('\n');

        const unsupportedModeOutput = await buildModeOutput({
          mode: selectedMode,
          renderMode: selectedRender,
          tabId,
          currentWindowId,
          currentWindowState,
          currentWindowWidth,
          currentWindowHeight,
          currentWindowLeft,
          currentWindowTop,
          isCurrentTabActive,
          isCurrentWindowFocused,
          browserActiveTabId,
          browserActiveTabIdKnown,
          isReadTargetBrowserActiveTab,
          pageStability,
          currentUrl,
          currentTitle,
          pageType: schemeGuard.pageType,
          scheme: schemeGuard.scheme,
          pageRole: 'unknown',
          primaryRegion: null,
          primaryRegionConfidence: null,
          footerOnly: false,
          anchorTexts: [],
          pageContent: guardPageContent,
          visibleTextContent: null,
          contentSummary: summarizePageContent(guardPageContent),
          stats: { processed: 0, included: 0, durationMs: 0 },
          viewport: { width: null, height: null, dpr: null },
          filter: filter || 'all',
          depth: requestedDepth ?? null,
          focus: focusRefId ? { refId: focusRefId, found: false } : null,
          sparse: true,
          fallbackUsed: false,
          fallbackSource: null,
          refMapCount: 0,
          markedElements: [],
          elements: [],
          count: 0,
          reason: 'unsupported_page_type',
          tips: standardTips,
          refMap: [],
          candidateActions: [],
          visualElements: [],
          visibleRegionRows: extractVisibleRegionRows({
            pageContent: '',
            sourceRegion: 'unsupported_page',
          }),
          requestedLayer: selectedLayer,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                ...unsupportedModeOutput,
                reason: 'unsupported_page_type',
                pageType: schemeGuard.pageType,
                scheme: schemeGuard.scheme,
                unsupportedPageType: schemeGuard.unsupportedPageType,
                recommendedAction: schemeGuard.recommendedAction,
              }),
            },
          ],
          isError: false,
        };
      }

      // Inject helper in ISOLATED world to enable chrome.runtime messaging
      // Inject into all frames to support same-origin iframe operations
      await this.injectContentScript(
        tabId,
        ['inject-scripts/accessibility-tree-helper.js'],
        false,
        'ISOLATED',
        true,
      );

      // Ask content script to generate accessibility tree
      let resp = await this.generateAccessibilityTreeWithRetry(tabId, {
        action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
        filter: filter || null,
        depth: requestedDepth,
        refId: focusRefId || undefined,
      });

      // Evaluate tree result and decide whether to fallback
      const treeOk = resp && resp.success === true;
      let pageContent: string =
        resp && typeof resp.pageContent === 'string' ? resp.pageContent : '';
      let lines = pageContent
        ? pageContent.split('\n').filter((l: string) => l.trim().length > 0).length
        : 0;
      let refCount = Array.isArray(resp?.refMap) ? resp.refMap.length : 0;
      let isSparse = !userControlled && lines < 10 && refCount < 3;

      if (treeOk && isSparse) {
        await delay(READ_PAGE_SPARSE_RETRY_DELAY_MS);
        const retryResp = await this.generateAccessibilityTreeWithRetry(tabId, {
          action: TOOL_MESSAGE_TYPES.GENERATE_ACCESSIBILITY_TREE,
          filter: filter || null,
          depth: requestedDepth,
          refId: focusRefId || undefined,
        });
        const retryContent =
          retryResp && typeof retryResp.pageContent === 'string' ? retryResp.pageContent : '';
        const retryLines = retryContent
          ? retryContent.split('\n').filter((l: string) => l.trim().length > 0).length
          : 0;
        const retryRefCount = Array.isArray(retryResp?.refMap) ? retryResp.refMap.length : 0;
        if (retryResp?.success === true && retryLines + retryRefCount > lines + refCount) {
          resp = retryResp;
          pageContent = retryContent;
          lines = retryLines;
          refCount = retryRefCount;
          isSparse = !userControlled && lines < 10 && refCount < 3;
        }
      }

      const pageUnderstanding = inferPageUnderstanding(currentUrl, currentTitle, pageContent);
      const treeInteractiveElements = buildInteractiveElements(
        pageContent,
        [],
        selectedMode === 'compact' ? 24 : 80,
        selectedMode,
        currentUrl,
      );
      const rowLinkingInteractiveElements =
        selectedMode === 'compact'
          ? buildInteractiveElements(pageContent, [], 80, 'compact', currentUrl)
          : treeInteractiveElements;

      // Extract stats from response
      const stats: ReadPageStats | null =
        treeOk && resp?.stats
          ? {
              processed: resp.stats.processed ?? 0,
              included: resp.stats.included ?? 0,
              durationMs: resp.stats.durationMs ?? 0,
            }
          : null;

      const contentSummary = summarizePageContent(pageContent);

      // User markers have been removed with the Element Marker surface
      // (MKEP pruning §P7). Keep the field on the payload as an empty
      // array to preserve the outbound contract that downstream consumers
      // (telemetry, prompt builder) still reference.
      const markedElements: any[] = [];

      // Unified base payload structure - consistent keys for stable contract
      const basePayload: Record<string, any> = {
        success: true,
        mode: selectedMode,
        filter: filter || 'all',
        pageContent,
        visibleTextContent: null,
        contentSummary,
        tips: standardTips,
        viewport: treeOk ? resp.viewport : { width: null, height: null, dpr: null },
        stats: stats || { processed: 0, included: 0, durationMs: 0 },
        refMapCount: refCount,
        sparse: treeOk ? isSparse : false,
        pageType: schemeGuard.pageType,
        scheme: schemeGuard.scheme,
        pageRole: pageUnderstanding.pageRole,
        primaryRegion: pageUnderstanding.primaryRegion,
        primaryRegionConfidence: pageUnderstanding.primaryRegionConfidence,
        footerOnly: pageUnderstanding.footerOnly,
        anchorTexts: pageUnderstanding.anchorTexts,
        depth: requestedDepth ?? null,
        focus: focusRefId ? { refId: focusRefId, found: treeOk } : null,
        markedElements,
        elements: [],
        count: 0,
        fallbackUsed: false,
        fallbackSource: null,
        reason: null,
        refMap: Array.isArray(resp?.refMap) ? resp.refMap : [],
        candidateActions: [],
        visualElements: [],
        visibleRegionRows: extractVisibleRegionRows({
          pageContent,
          sourceRegion: pageUnderstanding.primaryRegion,
          fallbackInteractiveElements: rowLinkingInteractiveElements,
          url: currentUrl,
          title: currentTitle,
          viewport: treeOk ? resp.viewport : null,
          scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
          pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
        }),
      };
      reconcilePageUnderstandingWithVisibleRows(basePayload);

      if (
        shouldSampleVisibleText({
          treeOk,
          userControlled,
          mode: selectedMode,
          requestedDepth,
          focusRefId,
          rows: basePayload.visibleRegionRows,
        }) &&
        !basePayload.visibleTextContent
      ) {
        const visibleTextContent = await this.sampleVisibleTextContent(tabId);
        if (visibleTextContent) {
          basePayload.visibleTextContent = visibleTextContent;
          if (!basePayload.visibleRegionRows.visibleRegionRowsUsed) {
            const visibleTextRows = extractVisibleRegionRows({
              pageContent: String(basePayload.pageContent || ''),
              visibleTextContent,
              sourceRegion: pageUnderstanding.primaryRegion,
              fallbackInteractiveElements: rowLinkingInteractiveElements,
              url: currentUrl,
              title: currentTitle,
              viewport: basePayload.viewport,
              scrollY: typeof resp?.scrollY === 'number' ? resp.scrollY : null,
              pixelsBelow: typeof resp?.pixelsBelow === 'number' ? resp.pixelsBelow : null,
            });
            if (visibleTextRows.visibleRegionRowsUsed) {
              basePayload.visibleRegionRows = visibleTextRows;
              basePayload.fallbackSource = 'visible_text';
              reconcilePageUnderstandingWithVisibleRows(basePayload);
            }
          }
        }
      }
      await this.repairVisibleRowsTargetRefs({
        tabId,
        basePayload,
        pageUnderstanding,
        currentUrl,
        currentTitle,
      });

      if (
        treeOk &&
        !focusRefId &&
        !isSparse &&
        treeInteractiveElements.length < 3 &&
        !basePayload.fallbackUsed
      ) {
        const fallback = await this.collectInteractiveElementsFallback(tabId);
        if (fallback && fallback.elements.length > treeInteractiveElements.length) {
          const merged = fallback.elements.slice(0, 150);
          const fallbackRefMap = buildFallbackRefMap(merged);
          const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'interactive_shell_supplement';
          basePayload.elements = mergedWithRefs;
          basePayload.count = fallback.elements.length;
          basePayload.refMap =
            Array.isArray(basePayload.refMap) && basePayload.refMap.length > 0
              ? [...basePayload.refMap, ...fallbackRefMap]
              : fallbackRefMap;
          basePayload.refMapCount = basePayload.refMap.filter(
            (entry: unknown) => entry != null,
          ).length;
        }
      }

      await this.recoverGlobalMenuTextTargets({ tabId, basePayload });
      basePayload.visualElements = await this.collectQrVisualElements({
        tabId,
        pageContent: String(basePayload.pageContent || ''),
        visibleTextContent: basePayload.visibleTextContent,
      });

      // Normal path: return tree when the tree is sufficiently rich or the
      // visible-text fallback has already recovered business rows.
      if (treeOk && (!isSparse || basePayload.visibleRegionRows.visibleRegionRowsUsed)) {
        const modePayload = await buildModeOutput({
          mode: selectedMode,
          renderMode: selectedRender,
          tabId,
          currentWindowId,
          currentWindowState,
          currentWindowWidth,
          currentWindowHeight,
          currentWindowLeft,
          currentWindowTop,
          isCurrentTabActive,
          isCurrentWindowFocused,
          browserActiveTabId,
          browserActiveTabIdKnown,
          isReadTargetBrowserActiveTab,
          pageStability,
          currentUrl,
          currentTitle,
          pageType: schemeGuard.pageType,
          scheme: schemeGuard.scheme,
          pageRole: basePayload.pageRole,
          primaryRegion: basePayload.primaryRegion,
          primaryRegionConfidence: basePayload.primaryRegionConfidence,
          footerOnly: basePayload.footerOnly,
          anchorTexts: basePayload.anchorTexts,
          pageContent: basePayload.pageContent,
          visibleTextContent: basePayload.visibleTextContent,
          contentSummary: basePayload.contentSummary,
          stats: basePayload.stats,
          viewport: basePayload.viewport,
          filter: basePayload.filter,
          depth: basePayload.depth,
          focus: basePayload.focus,
          sparse: basePayload.sparse,
          fallbackUsed: basePayload.fallbackUsed,
          fallbackSource: basePayload.fallbackSource,
          refMapCount: basePayload.refMapCount,
          markedElements: basePayload.markedElements,
          elements: basePayload.elements,
          count: basePayload.count,
          reason: basePayload.reason,
          tips: basePayload.tips,
          refMap: basePayload.refMap,
          candidateActions: basePayload.candidateActions,
          visualElements: basePayload.visualElements,
          visibleRegionRows: basePayload.visibleRegionRows,
          requestedLayer: selectedLayer,
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(modePayload) }],
          isError: false,
        };
      }

      // When refId is explicitly provided, do not fallback (refs are frame-local and may expire)
      if (focusRefId) {
        return createErrorResponse(resp?.error || `refId "${focusRefId}" not found or expired`);
      }

      // When user explicitly controls depth, do not override with fallback heuristics
      if (requestedDepth !== undefined) {
        return createErrorResponse(resp?.error || 'Failed to generate accessibility tree');
      }

      // Fallback path: try get_interactive_elements with one short retry.
      // Newly opened MV3 pages can report document complete before the
      // injected helper is ready to answer its first runtime message.
      try {
        const fallback = await this.collectInteractiveElementsFallback(tabId);

        if (fallback) {
          const merged = fallback.elements.slice(0, 150);
          const fallbackRefMap = buildFallbackRefMap(merged);
          const mergedWithRefs = attachFallbackRefs(merged, fallbackRefMap);
          const fallbackRefEntryCount = fallbackRefMap.filter((entry) => entry != null).length;

          basePayload.fallbackUsed = true;
          basePayload.fallbackSource = 'get_interactive_elements';
          basePayload.reason = treeOk ? 'sparse_tree' : resp?.error || 'tree_failed';
          basePayload.elements = mergedWithRefs;
          basePayload.count = fallback.elements.length;
          basePayload.refMap = fallbackRefMap;
          basePayload.refMapCount = fallbackRefEntryCount;
          if (mergedWithRefs.length > 0 || !basePayload.pageContent) {
            basePayload.pageContent = formatElementsAsPageContent(mergedWithRefs, fallbackRefMap);
          }
          const fallbackUnderstanding = inferPageUnderstanding(
            currentUrl,
            currentTitle,
            String(basePayload.pageContent || ''),
          );
          basePayload.pageRole = fallbackUnderstanding.pageRole;
          basePayload.primaryRegion = fallbackUnderstanding.primaryRegion;
          basePayload.primaryRegionConfidence = fallbackUnderstanding.primaryRegionConfidence;
          basePayload.footerOnly = fallbackUnderstanding.footerOnly;
          basePayload.anchorTexts = fallbackUnderstanding.anchorTexts;
          basePayload.visibleRegionRows = extractVisibleRegionRows({
            pageContent: String(basePayload.pageContent || ''),
            sourceRegion: fallbackUnderstanding.primaryRegion,
            fallbackInteractiveElements: mergedWithRefs,
            url: currentUrl,
            title: currentTitle,
            viewport: basePayload.viewport,
            scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
            pixelsBelow: typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
          });
          if (!basePayload.visibleRegionRows.visibleRegionRowsUsed) {
            const visibleTextContent = await this.sampleVisibleTextContent(tabId);
            if (visibleTextContent) {
              basePayload.visibleTextContent = visibleTextContent;
              basePayload.visibleRegionRows = extractVisibleRegionRows({
                pageContent: String(basePayload.pageContent || ''),
                visibleTextContent,
                sourceRegion: fallbackUnderstanding.primaryRegion,
                fallbackInteractiveElements: mergedWithRefs,
                url: currentUrl,
                title: currentTitle,
                viewport: basePayload.viewport,
                scrollY: typeof fallback?.scrollY === 'number' ? fallback.scrollY : null,
                pixelsBelow:
                  typeof fallback?.pixelsBelow === 'number' ? fallback.pixelsBelow : null,
              });
            }
          }
          reconcilePageUnderstandingWithVisibleRows(basePayload);
          basePayload.visualElements = await this.collectQrVisualElements({
            tabId,
            pageContent: String(basePayload.pageContent || ''),
            visibleTextContent: basePayload.visibleTextContent,
          });

          const modePayload = await buildModeOutput({
            mode: selectedMode,
            renderMode: selectedRender,
            tabId,
            currentWindowId,
            currentWindowState,
            currentWindowWidth,
            currentWindowHeight,
            currentWindowLeft,
            currentWindowTop,
            isCurrentTabActive,
            isCurrentWindowFocused,
            browserActiveTabId,
            browserActiveTabIdKnown,
            isReadTargetBrowserActiveTab,
            pageStability,
            currentUrl,
            currentTitle,
            pageType: schemeGuard.pageType,
            scheme: schemeGuard.scheme,
            pageRole: basePayload.pageRole,
            primaryRegion: basePayload.primaryRegion,
            primaryRegionConfidence: basePayload.primaryRegionConfidence,
            footerOnly: basePayload.footerOnly,
            anchorTexts: basePayload.anchorTexts,
            pageContent: basePayload.pageContent,
            visibleTextContent: basePayload.visibleTextContent,
            contentSummary: summarizePageContent(String(basePayload.pageContent || '')),
            stats: basePayload.stats,
            viewport: basePayload.viewport,
            filter: basePayload.filter,
            depth: basePayload.depth,
            focus: basePayload.focus,
            sparse: basePayload.sparse,
            fallbackUsed: basePayload.fallbackUsed,
            fallbackSource: basePayload.fallbackSource,
            refMapCount: basePayload.refMapCount,
            markedElements: basePayload.markedElements,
            elements: basePayload.elements,
            count: basePayload.count,
            reason: basePayload.reason,
            tips: basePayload.tips,
            refMap: basePayload.refMap,
            candidateActions: basePayload.candidateActions,
            visualElements: basePayload.visualElements,
            visibleRegionRows: basePayload.visibleRegionRows,
            requestedLayer: selectedLayer,
          });

          return {
            content: [{ type: 'text', text: JSON.stringify(modePayload) }],
            isError: false,
          };
        }
      } catch (fallbackErr) {
        console.warn('read_page fallback failed:', fallbackErr);
      }

      // If we reach here, both tree (usable) and fallback failed
      return createErrorResponse(
        treeOk
          ? 'Accessibility tree is too sparse and fallback failed'
          : resp?.error || 'Failed to generate accessibility tree and fallback failed',
      );
    } catch (error) {
      console.error('Error in read page tool:', error);
      const classified = this.classifyContentScriptError(error);
      if (classified) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                reason: classified.reason,
                pageType: 'browser_error_page',
                recommendedAction: classified.recommendedAction,
                error: classified.message,
                nextStepHint:
                  'page_unreadable; return BLOCKED or retry navigation before attempting structured reads',
              }),
            },
          ],
          isError: false,
        };
      }
      return createErrorResponse(
        `Error generating accessibility tree: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export const readPageTool = new ReadPageTool();
