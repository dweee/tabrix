import type { BrowserObjectInput, MemoryTrace } from './db';
import { sanitizeValue } from './mke-memory-sanitizer';
import {
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import { readNestedObject, readString } from './mke-memory-value-readers';

export function buildReadPageDataSourceObjectInput(input: {
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
  redactionState: string;
}): BrowserObjectInput | null {
  const projection = readNestedObject(input.payload, 'pageProjection');
  const selectedDataSource = readString(
    projection?.chosenDataSource,
    projection?.selectedDataSource,
    input.payload.selectedDataSource,
    input.payload.kind,
  );
  const sourceRoute = readString(input.payload.sourceRoute, input.trace.sourceRoute);
  const endpointFamily = readString(
    input.payload.endpointFamily,
    input.payload.endpointPattern,
    readNestedObject(input.payload, 'source')?.endpointFamily,
  );
  if (!isApiLikeDataSource(selectedDataSource, sourceRoute, endpointFamily)) return null;

  const sourceKey = selectedDataSource ?? endpointFamily ?? sourceRoute ?? 'api';
  const pageIdentityRoute = pageObjectIdentityRoute(input.rootRoute, input.trace.pageUrlPattern);
  return {
    siteFamily: input.siteFamily,
    pageUrlPattern: input.rootRoute,
    rootRoute: input.rootRoute,
    currentRoute: input.currentRoute,
    pageRole: input.pageRole,
    pageModelKey: input.pageModelKey,
    objectFingerprint: objectFingerprint(
      'data_source',
      input.pageModelKey,
      pageIdentityRoute,
      sourceKey,
    ),
    objectType: 'data_source',
    browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
    tabId: input.tabId,
    sourceRoute,
    selectedDataSource,
    sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
    lifecycleState: 'observed',
    canTabrixOperate: true,
    facts: sanitizeValue(
      {
        selectedDataSource,
        sourceRoute,
        endpointFamily,
        payloadKind: readString(input.payload.kind),
        sourcePrimaryOrigin: readString(
          readNestedObject(projection, 'sourceTruthChain')?.primaryOrigin,
        ),
      },
      'browser_object',
    ),
    claimBoundary: null,
    confidenceScore: null,
    firstTraceId: input.trace.traceId,
    lastTraceId: input.trace.traceId,
    sourceTraceIds: sourceTraceIds(input.trace),
    redactionState: input.redactionState,
    updatedAt: input.observedAt,
  };
}

function isApiLikeDataSource(...values: Array<string | null | undefined>): boolean {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return (
    text.includes('api') ||
    text.includes('cdp') ||
    text.includes('endpoint') ||
    text.includes('knowledge')
  );
}
