import type { BrowserObject, BrowserObjectInput, MemoryTrace } from './db';
import { sanitizeValue } from './mke-memory-sanitizer';
import {
  actionTargetIdentityKey,
  normalizeStableLocatorChain,
  regionChildObjectIdentityKey,
} from './mke-memory-result-card-projection';
import {
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import {
  readActionabilityBoolean,
  readArray,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

const REUSABLE_OBJECT_SOURCE_PROVENANCE = new Set(['dom', 'ax', 'cdp', 'visible_text', 'api']);

function normalizeReusableObjectSourceProvenance(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return REUSABLE_OBJECT_SOURCE_PROVENANCE.has(normalized) ? normalized : null;
}

function reusableObjectSourceProvenance(values: unknown[]): string[] {
  return [
    ...new Set(
      values
        .map(normalizeReusableObjectSourceProvenance)
        .filter((entry): entry is string => Boolean(entry)),
    ),
  ].slice(0, 8);
}

function buildSnapshotActionByTargetRef(
  snapshotValue: unknown,
): Map<string, Record<string, unknown>> {
  const snapshot = readObject(snapshotValue);
  const targets = readArray(snapshot?.actionableTargets);
  const byRef = new Map<string, Record<string, unknown>>();
  for (const rawTarget of targets) {
    const target = readObject(rawTarget);
    if (!target) continue;
    const refs = [
      readString(target.targetRef),
      readString(target.ref),
      readString(target.targetId),
      readString(target.id),
    ].filter((ref): ref is string => Boolean(ref));
    for (const ref of refs) {
      if (!byRef.has(ref)) byRef.set(ref, target);
    }
  }
  return byRef;
}

function actionSourceProvenance(
  action: Record<string, unknown>,
  snapshotAction: Record<string, unknown> | undefined,
): string[] {
  const directDetails = readArray(action.sourceProvenanceDetail);
  const snapshotDetails = readArray(snapshotAction?.sourceProvenanceDetail);
  return reusableObjectSourceProvenance([
    ...(directDetails.length > 0 ? directDetails : [readString(action.sourceProvenance)]),
    ...snapshotDetails,
    readString(snapshotAction?.sourceProvenance),
  ]);
}

function readReadPageSourceRoute(
  payload: Record<string, unknown>,
  trace: MemoryTrace,
): string | null {
  return readString(
    payload.sourceRoute,
    readNestedObject(payload, 'sourceRouteHonesty')?.verdict,
    payload.selectedDataSource,
    trace.sourceRoute,
  );
}

function readReadPageSelectedDataSource(
  payload: Record<string, unknown>,
  trace: MemoryTrace,
): string | null {
  return readString(payload.selectedDataSource, trace.selectedDataSource);
}

function readReadPageSourceFreshness(
  payload: Record<string, unknown>,
  trace: MemoryTrace,
): string | null {
  return readString(payload.freshness, trace.freshness);
}

export function recordReadPageRegionAndActionObjects(input: {
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
  redactionState: string;
  upsertBrowserObject: (objectInput: BrowserObjectInput) => BrowserObject | undefined;
}): void {
  const pageIdentityRoute = pageObjectIdentityRoute(input.rootRoute, input.trace.pageUrlPattern);
  const snapshot = readNestedObject(input.payload, 'pageObjectSnapshot');
  const regionInputs = readArray(input.payload.pageRegions);
  const regions =
    regionInputs.length > 0 ? regionInputs : buildReadPageRegionFallbacksFromSnapshot(snapshot);
  const actionInputs = readArray(input.payload.candidateActions);
  const actions =
    actionInputs.length > 0 ? actionInputs : buildReadPageActionFallbacksFromSnapshot(snapshot);
  const snapshotActionByTargetRef = buildSnapshotActionByTargetRef(snapshot);
  const sourceRoute = readReadPageSourceRoute(input.payload, input.trace);
  const selectedDataSource = readReadPageSelectedDataSource(input.payload, input.trace);
  const sourceFreshness = readReadPageSourceFreshness(input.payload, input.trace);

  for (const [index, rawRegion] of regions.slice(0, 40).entries()) {
    const region = readObject(rawRegion);
    if (!region) continue;
    const regionId = readString(region.regionId, region.id) ?? `region-${index}`;
    input.upsertBrowserObject({
      siteFamily: input.siteFamily,
      pageUrlPattern: input.rootRoute,
      rootRoute: input.rootRoute,
      currentRoute: input.currentRoute,
      pageRole: input.pageRole,
      pageModelKey: input.pageModelKey,
      objectFingerprint: objectFingerprint(
        'region',
        input.pageModelKey,
        pageIdentityRoute,
        regionId,
      ),
      objectType: 'region',
      parentObjectId: input.parentObjectId ?? null,
      browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
      tabId: input.tabId,
      sourceRoute,
      selectedDataSource,
      sourceFreshness,
      lifecycleState: readString(region.state, 'observed'),
      canTabrixOperate: readActionabilityBoolean(region.targetability),
      targetability: sanitizeValue(
        {
          state: readString(region.state),
          readiness: readString(region.readiness),
          nextRequiredTool: readString(region.nextRequiredTool),
          nextRequiredCheck: readString(region.nextRequiredCheck),
        },
        'browser_object',
      ),
      facts: sanitizeValue(
        {
          regionType: readString(region.regionType),
          layoutHint: readString(region.layoutHint),
          candidateActionCount: readArray(region.candidateActionIds).length,
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
    });

    const childObjects = readArray(region.objects);
    const childBrowserObjectIdsByObjectId = new Map<string, string>();
    for (const [childIndex, rawChild] of childObjects.slice(0, 40).entries()) {
      const child = readObject(rawChild);
      if (!child) continue;
      const childType = readString(child.objectType, child.kind, child.role) ?? 'page_object';
      const childObjectId = regionChildObjectIdentityKey({
        child,
        regionId,
        childType,
        fallbackIndex: childIndex,
      });
      const targetRef = readString(child.targetRef, child.ref);
      const logicalParentObjectId = readString(child.parentObjectId);
      const parentObjectId = logicalParentObjectId
        ? (childBrowserObjectIdsByObjectId.get(logicalParentObjectId) ??
          input.parentObjectId ??
          logicalParentObjectId)
        : (input.parentObjectId ?? null);
      const childBrowserObject = input.upsertBrowserObject({
        siteFamily: input.siteFamily,
        pageUrlPattern: input.rootRoute,
        rootRoute: input.rootRoute,
        currentRoute: input.currentRoute,
        pageRole: input.pageRole,
        pageModelKey: input.pageModelKey,
        objectFingerprint: objectFingerprint(
          'region_object',
          input.pageModelKey,
          pageIdentityRoute,
          regionId,
          childObjectId,
        ),
        objectType: childType,
        parentObjectId,
        browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
        tabId: input.tabId,
        sourceRoute,
        selectedDataSource,
        sourceFreshness: readString(child.freshness, sourceFreshness),
        lifecycleState: 'observed',
        canTabrixOperate: readActionabilityBoolean(child.targetability),
        targetability: sanitizeValue(
          {
            targetRef,
            detailTarget: readObject(child.detailTarget),
            primaryAction: readObject(child.primaryAction),
          },
          'browser_object',
        ),
        actionTypes: sanitizeValue(readArray(child.actionTypes), 'browser_object'),
        facts: sanitizeValue(
          {
            regionId,
            regionType: readString(region.regionType),
            parentObjectId,
            containerKind: readString(child.containerKind),
            role: readString(child.role),
            label: readString(child.label),
            sourceProvenance: reusableObjectSourceProvenance(readArray(child.sourceProvenance)),
            reason: readString(child.reason),
          },
          'browser_object',
        ),
        claimBoundary: readString(child.claimBoundary),
        confidenceScore: readNumber(child.confidence),
        firstTraceId: input.trace.traceId,
        lastTraceId: input.trace.traceId,
        sourceTraceIds: sourceTraceIds(input.trace),
        redactionState: input.redactionState,
        updatedAt: input.observedAt,
      });
      if (childBrowserObject) {
        childBrowserObjectIdsByObjectId.set(childObjectId, childBrowserObject.browserObjectId);
      }
    }
  }

  for (const [index, rawAction] of actions.slice(0, 80).entries()) {
    const action = readObject(rawAction);
    if (!action) continue;
    const targetRef = readString(action.targetRef, action.id) ?? `target-${index}`;
    const snapshotAction = snapshotActionByTargetRef.get(targetRef);
    const targetIdentityKey = actionTargetIdentityKey({
      action,
      targetRef,
      fallbackIndex: index,
    });
    input.upsertBrowserObject({
      siteFamily: input.siteFamily,
      pageUrlPattern: input.rootRoute,
      rootRoute: input.rootRoute,
      currentRoute: input.currentRoute,
      pageRole: input.pageRole,
      pageModelKey: input.pageModelKey,
      objectFingerprint: objectFingerprint(
        'action_target',
        input.pageModelKey,
        pageIdentityRoute,
        targetIdentityKey,
      ),
      objectType: 'action_target',
      browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
      tabId: input.tabId,
      sourceRoute,
      selectedDataSource,
      sourceFreshness,
      lifecycleState: 'observed',
      canTabrixOperate: readActionabilityBoolean(action.actionability),
      operabilityReason: readString(action.actionabilityReason),
      targetability: sanitizeValue(
        {
          targetRef,
          frameId: readString(action.frameId),
          identityKey: targetIdentityKey,
          actionTarget: {
            targetRef,
            frameId: readString(action.frameId),
            locatorChain: readArray(action.locatorChain),
            nextRequiredTool: readString(action.nextRequiredTool),
            nextRequiredSelector: readString(action.nextRequiredSelector),
            nextRequiredSelectorSource: readString(action.nextRequiredSelectorSource),
            nextRequiredCheck: readString(action.nextRequiredCheck),
          },
          execution: {
            actionability: readString(action.actionability),
            actionabilityReason: readString(action.actionabilityReason),
            visibility: readObject(action.visibility),
          },
          nextRequiredTool: readString(action.nextRequiredTool),
          nextRequiredSelector: readString(action.nextRequiredSelector),
          nextRequiredSelectorSource: readString(action.nextRequiredSelectorSource),
          nextRequiredCheck: readString(action.nextRequiredCheck),
        },
        'browser_object',
      ),
      actionTypes: sanitizeValue(
        [readString(action.actionType)].filter((item): item is string => Boolean(item)),
        'browser_object',
      ),
      facts: sanitizeValue(
        {
          intentBoundary: readString(action.intentBoundary),
          intent: readString(action.intent),
          label: readString(action.label, action.text, action.accessibleName, action.name),
          stableLocatorChain: normalizeStableLocatorChain(action.locatorChain),
          sourceProvenance: actionSourceProvenance(action, snapshotAction),
          expectedResult: readString(action.nextRequiredCheck),
          matchReason: readString(action.matchReason),
          actionability: readString(action.actionability),
          actionabilityReason: readString(action.actionabilityReason),
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
    });
  }
}

function buildReadPageRegionFallbacksFromSnapshot(
  snapshotValue: unknown,
): Record<string, unknown>[] {
  const snapshot = readObject(snapshotValue);
  if (!snapshot) return [];
  const objects = readArray(snapshot.objects);
  if (objects.length === 0) return [];
  return [
    {
      regionId: 'page-object-snapshot',
      regionType: 'page_objects',
      layoutHint: 'snapshot',
      state: 'observed',
      readiness: readString(readNestedObject(snapshot, 'pageState')?.readiness, 'unknown'),
      targetability: readNumber(snapshot.actionableObjectCount) !== 0,
      candidateActionIds: readArray(snapshot.actionableTargets)
        .map((target) => readString(readObject(target)?.targetId, readObject(target)?.id))
        .filter((targetId): targetId is string => Boolean(targetId))
        .slice(0, 80),
      objects,
    },
  ];
}

function buildReadPageActionFallbacksFromSnapshot(
  snapshotValue: unknown,
): Record<string, unknown>[] {
  const snapshot = readObject(snapshotValue);
  if (!snapshot) return [];
  return readArray(snapshot.actionableTargets)
    .map((rawTarget): Record<string, unknown> | null => {
      const target = readObject(rawTarget);
      if (!target) return null;
      const targetRef = readString(target.targetRef, target.ref, target.targetId, target.id);
      if (!targetRef) return null;
      return {
        id: readString(target.targetId, target.id, targetRef),
        targetRef,
        actionType: readString(target.actionType, target.primaryAction, target.action, 'click'),
        actionability: readActionabilityBoolean(target.actionability, target.targetability, true),
        actionabilityReason: readString(target.actionabilityReason, target.reason),
        frameId: readString(target.frameId),
        locatorChain: readArray(target.locatorChain),
        sourceProvenance: readString(target.sourceProvenance),
        sourceProvenanceDetail: readArray(target.sourceProvenanceDetail),
        visibility: readObject(target.visibility),
        nextRequiredTool: readString(target.nextRequiredTool),
        nextRequiredSelector: readString(target.nextRequiredSelector),
        nextRequiredSelectorSource: readString(target.nextRequiredSelectorSource),
        nextRequiredCheck: readString(target.nextRequiredCheck),
        intentBoundary: readString(target.intentBoundary, target.intent),
        intent: readString(target.intent),
        matchReason: readString(target.matchReason, target.reason),
      };
    })
    .filter((target): target is Record<string, unknown> => target !== null)
    .slice(0, 80);
}
