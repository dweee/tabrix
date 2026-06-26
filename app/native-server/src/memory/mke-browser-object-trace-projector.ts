import type { BrowserObject, BrowserObjectInput, BrowserObjectRepository, MemoryTrace } from './db';
import { recordBrowserWorldObjects } from './mke-memory-browser-world-object-projection';
import {
  normalizeOwnerType,
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import {
  stringHasBlockedPageSignal,
  valueHasBlockedPageSignal,
} from './mke-memory-page-state-signals';
import { recordReadPageRegionAndActionObjects } from './mke-memory-read-page-child-projection';
import { buildReadPageDataSourceObjectInput } from './mke-memory-read-page-data-source-projection';
import {
  buildPageObjectEvidenceRefs,
  buildPageObjectRecentEvents,
  mergeReadPageFactsWithExistingCollectionFacts,
  summarizeReadPageSensingDiagnostics,
  summarizeReadPageSnapshot,
  summarizeReadPageUnifiedDelta,
} from './mke-memory-read-page-object-projection';
import { recordCollectedResultCardBrowserObjects } from './mke-memory-result-card-object-projection';
import { normalizeUrlPattern, sanitizeValue } from './mke-memory-sanitizer';
import {
  readBoolean,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

interface BrowserObjectProjectionTrace {
  traceId?: string | null;
  browserContextKey?: string | null;
  sourceRoute?: string | null;
  freshness?: string | null;
  windowId?: number | null;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
}

interface BrowserObjectTraceProjectorLogger {
  warn(message: string, data?: Record<string, unknown>): void;
}

export interface RecordBrowserWorldSnapshotObjectsInput {
  browserObjects?: BrowserObjectRepository;
  browserWorld: unknown;
  observedAtMs?: number;
  browserContextKey?: string | null;
  logger: BrowserObjectTraceProjectorLogger;
}

export interface RecordBrowserObjectsFromToolResultInput {
  browserObjects?: BrowserObjectRepository;
  trace: MemoryTrace;
  payload: unknown;
  toolName: string;
  observedAt: string;
  browserContextKey: string | null;
  logger: BrowserObjectTraceProjectorLogger;
}

function sanitizeBrowserObjectValue(value: unknown): unknown {
  return sanitizeValue(value, 'browser_object');
}

function browserObjectRedactionState(): string {
  return 'redacted';
}

function upsertBrowserObject(
  browserObjects: BrowserObjectRepository | undefined,
  input: BrowserObjectInput,
): BrowserObject | undefined {
  return browserObjects?.upsert(input);
}

export function recordBrowserWorldSnapshotObjects(
  input: RecordBrowserWorldSnapshotObjectsInput,
): void {
  const { browserObjects } = input;
  if (!browserObjects) return;
  const browserWorld = readObject(input.browserWorld);
  if (!browserWorld) return;
  const observedAtMs =
    typeof input.observedAtMs === 'number' && Number.isFinite(input.observedAtMs)
      ? input.observedAtMs
      : Date.now();
  const observedAt = new Date(observedAtMs).toISOString();
  const payload = {
    source: 'chrome_windows_get_all_with_browser_world_inventory',
    browserWorld,
  };
  const projectionTrace: BrowserObjectProjectionTrace = {
    traceId: null,
    browserContextKey: input.browserContextKey ?? 'extension_browser_world_inventory',
    sourceRoute: 'chrome_windows_get_all_with_browser_world_inventory',
    freshness: readString(browserWorld.status, browserWorld.freshness),
    windowId: null,
    siteFamily: null,
    pageUrlPattern: null,
  };

  try {
    browserObjects.transaction(() => {
      recordBrowserWorldObjects({
        trace: projectionTrace,
        payload,
        observedAt,
        browserContextKey: projectionTrace.browserContextKey ?? null,
        redactionState: browserObjectRedactionState(),
        upsertBrowserObject: (objectInput) => upsertBrowserObject(browserObjects, objectInput),
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn('browser world snapshot projection failed', {
      errorMessage: message,
    });
  }
}

export function recordBrowserObjectsFromToolResult(
  input: RecordBrowserObjectsFromToolResultInput,
): void {
  const { browserObjects } = input;
  if (!browserObjects) return;
  const payload = readObject(input.payload);
  if (!payload) return;
  try {
    browserObjects.transaction(() => {
      if (input.toolName === 'get_windows_and_tabs') {
        recordBrowserWorldObjects({
          trace: input.trace,
          payload,
          observedAt: input.observedAt,
          browserContextKey: input.browserContextKey,
          redactionState: browserObjectRedactionState(),
          upsertBrowserObject: (objectInput) => upsertBrowserObject(browserObjects, objectInput),
        });
        return;
      }
      if (input.toolName === 'chrome_read_page') {
        recordReadPageObjects({
          browserObjects,
          trace: input.trace,
          payload,
          observedAt: input.observedAt,
          browserContextKey: input.browserContextKey,
        });
        return;
      }
      if (input.toolName === 'chrome_collect_result_cards') {
        recordCollectedResultCardBrowserObjects({
          trace: input.trace,
          payload,
          observedAt: input.observedAt,
          browserContextKey: input.browserContextKey,
          redactionState: browserObjectRedactionState(),
          upsertBrowserObject: (objectInput) => upsertBrowserObject(browserObjects, objectInput),
        });
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    input.logger.warn('browser object projection failed', {
      traceId: input.trace.traceId,
      toolName: input.toolName,
      errorMessage: message,
    });
  }
}

function recordReadPageObjects(input: {
  browserObjects: BrowserObjectRepository;
  trace: MemoryTrace;
  payload: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string | null;
}): void {
  const { browserObjects, trace, payload, observedAt, browserContextKey } = input;
  const projection = readNestedObject(payload, 'pageProjection');
  const compact = readNestedObject(payload, 'browserPageObjectCompact');
  const compactFacts = readNestedObject(compact, 'facts');
  const compactTabFacts = readNestedObject(compactFacts, 'tab');
  const page = readNestedObject(payload, 'page');
  const summary = readNestedObject(payload, 'summary');
  const pageContext = readNestedObject(payload, 'pageContext');
  const pageObjectSnapshot = summarizeReadPageSnapshot(
    readNestedObject(payload, 'pageObjectSnapshot'),
  );
  const sensingDiagnosticsSummary = summarizeReadPageSensingDiagnostics(
    readNestedObject(pageContext, 'sensingDiagnostics'),
  );
  const pageDeltaReport = summarizeReadPageUnifiedDelta(payload);
  const evidenceRefs = buildPageObjectEvidenceRefs({
    snapshotSummary: pageObjectSnapshot,
    deltaSummary: pageDeltaReport,
  });
  const recentEvents = buildPageObjectRecentEvents({
    snapshotSummary: pageObjectSnapshot,
    deltaSummary: pageDeltaReport,
    observedAt,
  });
  const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
    allowPersonalBrowserStateStorage: false,
  });
  const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
  const pageRole = readString(projection?.pageRole, summary?.pageRole, trace.pageRole) ?? 'page';
  const pageModelKey =
    readString(projection?.pageModelKey, trace.pageModelKey) ?? `page:${siteFamily}:${pageRole}`;
  const tabId = readNumber(projection?.tabId, payload.tabId, trace.tabId);
  const pageIdentityRoute = pageObjectIdentityRoute(
    urlFields.rootRoute,
    trace.pageUrlPattern,
    urlFields.pattern,
  );
  const pageFingerprint = objectFingerprint('page', siteFamily, pageModelKey, pageIdentityRoute);
  const existingPageObject = browserObjects.getByIdentity({
    siteFamily,
    pageModelKey,
    objectFingerprint: pageFingerprint,
  });
  const pageFacts = mergeReadPageFactsWithExistingCollectionFacts(
    {
      readiness: projection?.readiness,
      stability: projection?.stability,
      watchStatus: compact?.watchStatus,
      operationSummary: readNestedObject(compact, 'operationSummary'),
      pageObjectSnapshotSummary: pageObjectSnapshot,
      sensingDiagnosticsSummary,
      pageDeltaSummary: pageDeltaReport,
      pageTitle: readString(page?.title),
      host: siteFamily,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      lastObservedTabId: tabId,
      windowId: readNumber(payload.windowId, trace.windowId),
    },
    existingPageObject?.facts,
  );
  const blockedSurface =
    stringHasBlockedPageSignal(urlFields.rootRoute) ||
    stringHasBlockedPageSignal(urlFields.currentRoute) ||
    stringHasBlockedPageSignal(urlFields.pattern) ||
    stringHasBlockedPageSignal(readString(summary?.quality, trace.pageState)) ||
    stringHasBlockedPageSignal(readString(compact?.status)) ||
    valueHasBlockedPageSignal(compactTabFacts);
  const canTabrixOperate =
    blockedSurface === true
      ? false
      : (readBoolean(compactTabFacts?.canTabrixOperate, projection?.canTabrixOperate) ?? true);
  const operabilityReason =
    blockedSurface === true
      ? 'user_verification_required'
      : readString(compactTabFacts?.operabilityReason, projection?.operabilityReason);

  const pageObject = upsertBrowserObject(browserObjects, {
    siteFamily,
    pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
    rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
    currentRoute: urlFields.currentRoute,
    pageRole,
    pageModelKey,
    objectFingerprint: pageFingerprint,
    objectType: 'page',
    browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
    tabId,
    windowId: readNumber(payload.windowId, trace.windowId),
    ownerType: normalizeOwnerType(readString(projection?.ownerType)),
    sourceRoute: readString(payload.sourceRoute, trace.sourceRoute),
    selectedDataSource: readString(projection?.chosenDataSource, payload.selectedDataSource),
    sourceLineage: sanitizeValue(
      {
        sourceTruthChain: projection?.sourceTruthChain,
        sourceRouteHonesty: payload.sourceRouteHonesty,
      },
      'browser_object',
    ),
    sourceFreshness: readString(projection?.sourceFreshness, payload.freshness, trace.freshness),
    lifecycleState: blockedSurface ? 'restricted' : readString(compact?.status, 'updated'),
    canTabrixOperate,
    operabilityReason,
    evidenceRefs: sanitizeValue(evidenceRefs, 'browser_object'),
    recentEvents: sanitizeValue(recentEvents, 'browser_object'),
    facts: sanitizeValue(pageFacts, 'browser_object'),
    changedGroups: sanitizeValue(compact?.changedGroups, 'browser_object'),
    currentState: sanitizeBrowserObjectValue({
      tabId,
      windowId: readNumber(payload.windowId, trace.windowId),
      titleSummary: readString(page?.title),
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      lifecycleState: blockedSurface ? 'restricted' : readString(compact?.status, 'updated'),
      canTabrixOperate,
    }),
    primaryConclusion: readString(compact?.primaryConclusion),
    claimBoundary: null,
    confidenceScore: null,
    firstTraceId: trace.traceId,
    lastTraceId: trace.traceId,
    sourceTraceIds: sourceTraceIds(trace),
    redactionState: browserObjectRedactionState(),
    updatedAt: observedAt,
  });

  recordReadPageChildObjects({
    browserObjects,
    trace,
    payload,
    observedAt,
    browserContextKey,
    siteFamily,
    rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
    currentRoute: urlFields.currentRoute,
    parentObjectId: pageObject?.browserObjectId ?? null,
    pageModelKey,
    pageRole,
    tabId,
  });
}

function recordReadPageDataSourceObject(input: {
  browserObjects: BrowserObjectRepository;
  trace: MemoryTrace;
  payload: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string | null;
  siteFamily: string;
  rootRoute: string | null;
  currentRoute: string | null;
  pageModelKey: string;
  pageRole: string;
  tabId: number | null;
}): void {
  const objectInput = buildReadPageDataSourceObjectInput({
    ...input,
    redactionState: browserObjectRedactionState(),
  });
  if (objectInput) upsertBrowserObject(input.browserObjects, objectInput);
}

function recordReadPageChildObjects(input: {
  browserObjects: BrowserObjectRepository;
  trace: MemoryTrace;
  payload: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string | null;
  siteFamily: string;
  rootRoute: string | null;
  currentRoute: string | null;
  pageModelKey: string;
  pageRole: string;
  tabId: number | null;
  parentObjectId?: string | null;
}): void {
  recordReadPageDataSourceObject(input);
  recordReadPageRegionAndActionObjects({
    ...input,
    redactionState: browserObjectRedactionState(),
    upsertBrowserObject: (objectInput) => upsertBrowserObject(input.browserObjects, objectInput),
  });
}
