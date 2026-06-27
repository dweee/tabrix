import {
  buildReadPageObjectLifecycle,
  type BrowserPageStability,
  type BrowserPageThingProjection,
  type ReadPageActionableTargetSummary,
  type ReadPageBrowserPageObjectWatchStatus,
  type ReadPageCDPSensingSummary,
  type ReadPageCompactSnapshot,
  type ReadPageLoadReadiness,
  type ReadPageObjectLifecycleSummary,
  type ReadPageObjectSnapshot,
  type ReadPageOwnershipRuntimeSummary,
  type ReadPagePageDeltaReport,
  type ReadPagePageObjectSummary,
  type ReadPagePageType,
  type ReadPageReadinessVerdict,
} from '@tabrix/shared';
import type { CandidateActionSeed } from './read-page-candidate-actions';

const OBJECT_LIFECYCLE_CACHE_MAX_TABS = 64;

const objectLifecycleByTab = new Map<
  number,
  {
    url: string;
    lifecycle: ReadPageObjectLifecycleSummary;
    pageProjection: BrowserPageThingProjection | null;
    ownershipRuntime: ReadPageOwnershipRuntimeSummary | null;
  }
>();

const pageObjectSnapshotByTab = new Map<
  number,
  {
    pageObjectSnapshot: ReadPageObjectSnapshot;
    pageObjectDeltaSignals?: ReadPageObjectDeltaSignals;
  }
>();

export interface ReadPageObjectDeltaSignals {
  networkStartedCount?: number;
  networkInFlightCount?: number;
  failedRequestCount?: number;
  errorCount?: number;
  warningCount?: number;
  routeFingerprint?: string;
}

export interface PendingActionBinding {
  actionId: string;
  targetObjectId: string | null;
  targetRef: string | null;
  recordedAtMs: number;
}

const lastActionByTab = new Map<number, PendingActionBinding>();
const LAST_ACTION_MAX_AGE_MS = 30_000;
const LAST_ACTION_MAX_TABS = 64;

export function recordPendingActionBinding(
  tabId: number,
  binding: { actionId: string; targetObjectId?: string | null; targetRef?: string | null },
): void {
  if (!Number.isFinite(tabId)) return;
  const actionId = typeof binding.actionId === 'string' ? binding.actionId.trim() : '';
  if (!actionId) return;
  lastActionByTab.delete(tabId);
  lastActionByTab.set(tabId, {
    actionId,
    targetObjectId: binding.targetObjectId ?? null,
    targetRef: binding.targetRef ?? null,
    recordedAtMs: Date.now(),
  });
  while (lastActionByTab.size > LAST_ACTION_MAX_TABS) {
    const firstKey = lastActionByTab.keys().next().value;
    if (firstKey === undefined) break;
    lastActionByTab.delete(firstKey);
  }
}

export function consumePendingActionBinding(tabId: number): PendingActionBinding | null {
  if (!Number.isFinite(tabId)) return null;
  const binding = lastActionByTab.get(tabId);
  if (!binding) return null;
  lastActionByTab.delete(tabId);
  if (Date.now() - binding.recordedAtMs > LAST_ACTION_MAX_AGE_MS) {
    return null;
  }
  return { ...binding };
}

export function buildCDPRouteFingerprint(
  cdpSensing?: ReadPageCDPSensingSummary,
): string | undefined {
  const route = cdpSensing?.route;
  if (!route) return undefined;
  const historyLength =
    typeof route.historyLength === 'number' && Number.isFinite(route.historyLength)
      ? route.historyLength
      : 'unknown';
  return [
    route.href,
    route.pathname,
    route.hasQuery ? 'query' : 'no_query',
    route.hasHash ? 'hash' : 'no_hash',
    route.fingerprint ?? 'route_fingerprint_unknown',
    `history:${historyLength}`,
  ].join('|');
}

function mapReadinessVerdict(input: {
  canUseSnapshotForBusinessAction: boolean;
  status: ReadPageLoadReadiness['status'];
}): ReadPageReadinessVerdict {
  if (input.canUseSnapshotForBusinessAction) return 'ready';
  if (input.status === 'stale') return 'blocked';
  return 'unknown';
}

function mapPageStabilityToWatchStatus(
  pageStability: BrowserPageStability,
): ReadPageBrowserPageObjectWatchStatus | null {
  if (pageStability === 'stable') return 'stable_or_unknown';
  if (pageStability === 'loading') return 'runtime_degraded';
  if (pageStability === 'changing') return 'runtime_transition_candidate';
  if (pageStability === 'stale') return 'changed_without_target_transition';
  return 'stable_or_unknown';
}

function collectSourceProvenance(params: {
  includeCDP: boolean;
  includeVisibleText: boolean;
  includeAX: boolean;
}): ReadPageObjectSnapshot['sourceProvenance'] {
  const sources = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>(['dom']);
  if (params.includeCDP) sources.add('cdp');
  if (params.includeVisibleText) sources.add('visible_text');
  if (params.includeAX) sources.add('ax');
  return [...sources];
}

function collectActionSourceProvenance(
  action: CandidateActionSeed,
): ReadPageObjectSnapshot['sourceProvenance'] {
  const sources = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>();
  const locatorTypes = new Set(
    (action.locatorChain ?? [])
      .map((locator) => String(locator.type || '').toLowerCase())
      .filter(Boolean),
  );
  if (locatorTypes.has('css') || locatorTypes.has('xpath') || locatorTypes.has('ref')) {
    sources.add('dom');
  }
  if (
    locatorTypes.has('aria') ||
    String(action.matchReason || '')
      .toLowerCase()
      .includes('ax')
  ) {
    sources.add('ax');
  }
  const visibilitySource = String(action.visibility?.source || '').toLowerCase();
  if (visibilitySource === 'cdp' || visibilitySource === 'mixed') sources.add('cdp');
  if (visibilitySource === 'dom' || visibilitySource === 'mixed') sources.add('dom');
  if (
    String(action.matchReason || '')
      .toLowerCase()
      .includes('visible')
  ) {
    sources.add('visible_text');
  }
  if (sources.size === 0) sources.add('unknown');
  return [...sources];
}

export function buildReadPageSnapshotSourceStats(params: {
  tabId: number;
  currentUrl: string;
  currentTitle: string;
  cdpSensing?: ReadPageCDPSensingSummary;
  pageRegions: ReadPageCompactSnapshot['pageRegions'];
  candidateActions: CandidateActionSeed[];
  pageType: ReadPagePageType;
  pageRole: string;
  pageStability: BrowserPageStability;
  loadReadiness: ReadPageLoadReadiness;
  visibleTextContent?: string | null;
}): ReadPageObjectSnapshot {
  const regionList = Array.isArray(params.pageRegions) ? params.pageRegions : [];
  const actionList = Array.isArray(params.candidateActions) ? params.candidateActions : [];
  const regionSources = collectSourceProvenance({
    includeCDP: Boolean(
      params.cdpSensing?.accessibility ||
      params.cdpSensing?.networkActivity ||
      params.cdpSensing?.console,
    ),
    includeVisibleText: Boolean(
      params.visibleTextContent && String(params.visibleTextContent).trim().length > 0,
    ),
    includeAX: Boolean(params.cdpSensing?.accessibility),
  });
  const objects: ReadPagePageObjectSummary[] = [];
  const seenObjectIds = new Set<string>();
  for (const [index, region] of regionList.entries()) {
    const regionObjectId =
      region.regionId ||
      `${params.pageType}-${params.pageRole}-${region.regionType || 'region'}-${index}`;
    const objectSourceProvenance = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>(
      regionSources,
    );
    if (typeof region.label === 'string' && region.label.length > 0) {
      objectSourceProvenance.add('visible_text');
    }
    objects.push({
      objectId: regionObjectId,
      kind: region.regionType || 'region',
      label: region.label || region.regionId || `${region.regionType || 'region'}-${index}`,
      objectType: 'container',
      containerKind: region.regionType || 'region',
      regionType: region.regionType ?? null,
      sourceProvenance: [...objectSourceProvenance],
      freshness: 'fresh',
    });
    seenObjectIds.add(regionObjectId);

    for (const [childIndex, child] of Array.isArray(region.objects)
      ? region.objects.entries()
      : []) {
      const childObjectId = String(child.objectId || '').trim();
      if (!childObjectId || seenObjectIds.has(childObjectId)) continue;
      const childSources = new Set<ReadPageObjectSnapshot['sourceProvenance'][number]>(
        Array.isArray(child.sourceProvenance) && child.sourceProvenance.length > 0
          ? child.sourceProvenance
          : objectSourceProvenance,
      );
      if (typeof child.label === 'string' && child.label.length > 0) {
        childSources.add('visible_text');
      }
      objects.push({
        objectId: childObjectId,
        kind: child.objectType || child.role || 'region_object',
        label: child.label || `${region.regionType || 'region'} object ${childIndex + 1}`,
        objectType: child.objectType,
        parentObjectId: child.parentObjectId || regionObjectId,
        containerKind: child.containerKind,
        regionType: region.regionType ?? null,
        sourceProvenance: [...childSources],
        targetRef: child.targetRef ?? null,
        ref: child.targetRef ?? null,
        locatorChain: child.locatorChain,
        detailTarget: child.detailTarget,
        actionCount: Array.isArray(child.actionTypes) ? child.actionTypes.length : 0,
        valueState: child.valueState,
        freshness: child.freshness || 'fresh',
      });
      seenObjectIds.add(childObjectId);
    }
  }
  const objectIdByRef = new Map<string, string>();
  for (const object of objects) {
    const refs = [object.targetRef, object.ref, object.objectId]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
    for (const ref of refs) {
      if (!objectIdByRef.has(ref)) objectIdByRef.set(ref, object.objectId);
    }
  }
  const actionableTargets: ReadPageActionableTargetSummary[] = actionList.map((action) => {
    const targetRef = typeof action.targetRef === 'string' ? action.targetRef.trim() : '';
    const sourceProvenanceDetail = collectActionSourceProvenance(action);
    return {
      targetId:
        action.id ??
        `${params.pageType}-${params.pageRole}-target-${targetRef || 'unknown'}-${action.actionType || 'unknown'}`,
      label: action.label || targetRef || action.id || 'candidate_action',
      kind: (action.actionType || 'click') as ReadPageActionableTargetSummary['kind'],
      targetRef: action.targetRef,
      ref: action.targetRef,
      sourceProvenance: sourceProvenanceDetail[0] ?? 'unknown',
      sourceProvenanceDetail,
      locatorChain: action.locatorChain,
      intent: action.intent,
      intentBoundary: action.intentBoundary,
      matchReason: action.matchReason,
      actionability: action.actionability,
      actionabilityReason: action.actionabilityReason,
      visibility: action.visibility,
      nextRequiredTool: action.nextRequiredTool,
      nextRequiredSelector: action.nextRequiredSelector,
      nextRequiredSelectorSource: action.nextRequiredSelectorSource,
      nextRequiredCheck: action.nextRequiredCheck,
      freshness: 'fresh',
      objectId: objectIdByRef.get(targetRef) ?? null,
    };
  });

  return {
    source: 'read_page_object_snapshot',
    snapshotId: `rpos_${params.tabId}_${Date.now()}`,
    observedAt: new Date().toISOString(),
    pageUrl: params.currentUrl,
    pageTitle: params.currentTitle,
    pageType: params.pageType,
    pageRole: params.pageRole,
    pageState: {
      pageStability: mapPageStabilityToWatchStatus(params.pageStability),
      readiness: mapReadinessVerdict(params.loadReadiness),
      baseUrl: (() => {
        try {
          return new URL(params.currentUrl).hostname || params.currentUrl;
        } catch {
          return params.currentUrl;
        }
      })(),
      frameCount:
        typeof params.cdpSensing?.frameCount === 'number' ? params.cdpSensing.frameCount : null,
    },
    sourceProvenance: [...regionSources],
    freshness: 'fresh',
    objects,
    actionableTargets,
    objectCount: objects.length,
    actionableObjectCount: actionableTargets.length,
    claimBoundary:
      'read_page_object_snapshot is object-awareness summary only; not business success proof',
  };
}

function isFormStateObject(object: ReadPagePageObjectSummary): boolean {
  const kind = String(object.objectType || object.kind || '').toLowerCase();
  const label = String(object.label || '').toLowerCase();
  return (
    object.regionType === 'form' ||
    object.regionType === 'search_area' ||
    kind === 'control' ||
    kind === 'textbox' ||
    kind === 'textarea' ||
    kind === 'combobox' ||
    kind === 'checkbox' ||
    /input|search|query|filter|form|field|输入|搜索|筛选|表单/.test(label)
  );
}

export function resolveTargetObjectId(
  binding: PendingActionBinding | null,
  snapshot: ReadPageObjectSnapshot,
): string | null {
  if (!binding?.targetRef) return binding?.targetObjectId ?? null;
  const target = snapshot.actionableTargets.find(
    (entry) => entry.ref === binding.targetRef || entry.targetRef === binding.targetRef,
  );
  return target?.objectId ?? binding.targetObjectId ?? null;
}

export function buildReadPagePageDeltaReport(params: {
  tabId: number;
  currentSnapshot: ReadPageObjectSnapshot;
  previousSnapshot: ReadPageObjectSnapshot | null;
  cdpSignals?: ReadPageObjectDeltaSignals;
  previousCdpSignals?: ReadPageObjectDeltaSignals;
  pendingActionBinding?: PendingActionBinding | null;
}): ReadPagePageDeltaReport | undefined {
  if (!params.previousSnapshot) return undefined;

  const previous = params.previousSnapshot;
  const beforeObjectIds = new Set(previous.objects.map((object) => object.objectId));
  const afterObjectIds = new Set(params.currentSnapshot.objects.map((object) => object.objectId));
  const appearedObjectIds = [...afterObjectIds].filter((id) => !beforeObjectIds.has(id));
  const disappearedObjectIds = [...beforeObjectIds].filter((id) => !afterObjectIds.has(id));
  const objectDelta = [...appearedObjectIds, ...disappearedObjectIds];
  const currentObjectById = new Map(
    params.currentSnapshot.objects.map((object) => [object.objectId, object]),
  );
  const previousObjectById = new Map(previous.objects.map((object) => [object.objectId, object]));
  const appearedObjects = appearedObjectIds
    .map((id) => currentObjectById.get(id))
    .filter((object): object is ReadPagePageObjectSummary => Boolean(object));
  const disappearedObjects = disappearedObjectIds
    .map((id) => previousObjectById.get(id))
    .filter((object): object is ReadPagePageObjectSummary => Boolean(object));
  const changedRegionSet = new Set<NonNullable<ReadPagePageObjectSummary['regionType']>>();
  for (const object of [...appearedObjects, ...disappearedObjects]) {
    if (typeof object.regionType === 'string' && object.regionType.length > 0) {
      changedRegionSet.add(object.regionType);
    }
  }
  const changedRegions = [...changedRegionSet];
  const changedObjectSummary = objectDelta.length;
  const countObjectsInRegions = (
    objects: readonly ReadPagePageObjectSummary[],
    regions: readonly string[],
  ): number =>
    objects.filter((object) => object.regionType && regions.includes(object.regionType)).length;
  const currentDialogObjectCount = countObjectsInRegions(params.currentSnapshot.objects, [
    'modal',
    'qr_code',
  ]);
  const previousDialogObjectCount = countObjectsInRegions(previous.objects, ['modal', 'qr_code']);
  const currentQrObjectCount = countObjectsInRegions(params.currentSnapshot.objects, ['qr_code']);
  const previousQrObjectCount = countObjectsInRegions(previous.objects, ['qr_code']);
  const dialogObjectAppeared = appearedObjects.some((object) => {
    const kind = String(object.objectType || object.kind || '').toLowerCase();
    return (
      object.regionType === 'modal' ||
      object.regionType === 'qr_code' ||
      kind.includes('modal') ||
      kind.includes('dialog')
    );
  });
  const dialogAppeared =
    dialogObjectAppeared || currentDialogObjectCount > previousDialogObjectCount;
  const qrCodeAppeared =
    appearedObjects.some((object) => object.regionType === 'qr_code') ||
    currentQrObjectCount > previousQrObjectCount;
  const resultListChanged = [...appearedObjects, ...disappearedObjects].some((object) => {
    const kind = String(object.objectType || object.kind || '').toLowerCase();
    return (
      object.regionType === 'result_list' ||
      object.containerKind === 'result_list' ||
      kind === 'result_card' ||
      kind === 'list_item'
    );
  });
  const sameObjectFormStateChanged = params.currentSnapshot.objects.some((currentObject) => {
    const previousObject = previousObjectById.get(currentObject.objectId);
    if (!previousObject) return false;
    if (!isFormStateObject(currentObject) && !isFormStateObject(previousObject)) return false;
    return (
      currentObject.valueState !== undefined &&
      previousObject.valueState !== undefined &&
      currentObject.valueState !== previousObject.valueState
    );
  });
  const formObjectPresenceChanged = [...appearedObjects, ...disappearedObjects].some((object) =>
    isFormStateObject(object),
  );
  const formStateChanged = sameObjectFormStateChanged || formObjectPresenceChanged;
  const requestStartedDelta =
    typeof params.previousCdpSignals?.networkStartedCount === 'number' &&
    typeof params.cdpSignals?.networkStartedCount === 'number'
      ? params.cdpSignals.networkStartedCount - params.previousCdpSignals.networkStartedCount
      : null;
  const failedRequestDelta =
    typeof params.previousCdpSignals?.failedRequestCount === 'number' &&
    typeof params.cdpSignals?.failedRequestCount === 'number'
      ? (params.cdpSignals.failedRequestCount ?? 0) -
        (params.previousCdpSignals.failedRequestCount ?? 0)
      : null;
  const errorCountDelta =
    typeof params.previousCdpSignals?.errorCount === 'number' &&
    typeof params.cdpSignals?.errorCount === 'number'
      ? params.cdpSignals.errorCount - params.previousCdpSignals.errorCount
      : null;
  const warningCountDelta =
    typeof params.previousCdpSignals?.warningCount === 'number' &&
    typeof params.cdpSignals?.warningCount === 'number'
      ? (params.cdpSignals.warningCount ?? 0) - (params.previousCdpSignals.warningCount ?? 0)
      : null;
  const routeChanged =
    typeof params.previousCdpSignals?.routeFingerprint === 'string' &&
    typeof params.cdpSignals?.routeFingerprint === 'string' &&
    params.previousCdpSignals.routeFingerprint !== params.cdpSignals.routeFingerprint;
  const networkCompleted =
    typeof requestStartedDelta === 'number' &&
    requestStartedDelta > 0 &&
    params.cdpSignals?.networkInFlightCount === 0;
  const consoleError = typeof errorCountDelta === 'number' && errorCountDelta > 0;
  let deltaKind: ReadPagePageDeltaReport['deltaKind'] = 'no_useful_change';
  let recommendation: ReadPagePageDeltaReport['recommendation'] = 'wait';

  if (params.currentSnapshot.pageUrl !== previous.pageUrl) {
    deltaKind = 'url_changed';
    recommendation = 'proceed';
  } else if (routeChanged) {
    deltaKind = 'spa_route_change';
    recommendation = 'proceed';
  } else if (consoleError) {
    deltaKind = 'console_error';
    recommendation = 'stop';
  } else if (dialogAppeared) {
    deltaKind = 'dialog_appeared';
    recommendation = qrCodeAppeared ? 'needs_user' : 'proceed';
  } else if (resultListChanged) {
    deltaKind = 'list_refreshed';
    recommendation = 'proceed';
  } else if (formStateChanged) {
    deltaKind = 'form_state_changed';
    recommendation = 'proceed';
  } else if (changedObjectSummary > 0) {
    deltaKind = 'object_appeared';
    recommendation = 'proceed';
  } else if (networkCompleted) {
    deltaKind = 'network_completed';
    recommendation = 'proceed';
  }

  return {
    source: 'read_page_delta_report',
    actionId: params.pendingActionBinding?.actionId ?? null,
    targetObjectId: params.pendingActionBinding?.targetObjectId ?? null,
    beforeSnapshotId: previous.snapshotId,
    afterSnapshotId: params.currentSnapshot.snapshotId,
    beforeObservedAt: previous.observedAt,
    afterObservedAt: params.currentSnapshot.observedAt,
    deltaKind,
    changedRegions: changedRegions.length > 0 ? changedRegions : ['read_page_object_snapshot'],
    changedObjects: objectDelta,
    ...(typeof requestStartedDelta === 'number'
      ? {
          networkSignals: {
            requestStartedDelta,
            failedRequestDelta,
          },
        }
      : {}),
    ...(typeof errorCountDelta === 'number'
      ? {
          consoleSignals: {
            errorCountDelta,
            warningCountDelta,
          },
        }
      : {}),
    recommendation,
    claimBoundary:
      'delta is read-only object-presence change evidence; AI must still verify postcondition.',
  };
}

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

export function rememberPageObjectSnapshot(
  tabId: number,
  snapshot: ReadPageObjectSnapshot,
  telemetry?: ReadPageObjectDeltaSignals,
): void {
  if (!Number.isFinite(tabId)) return;
  pageObjectSnapshotByTab.delete(tabId);
  pageObjectSnapshotByTab.set(tabId, {
    pageObjectSnapshot: snapshot,
    pageObjectDeltaSignals: telemetry,
  });
  while (pageObjectSnapshotByTab.size > OBJECT_LIFECYCLE_CACHE_MAX_TABS) {
    const firstKey = pageObjectSnapshotByTab.keys().next().value;
    if (firstKey === undefined) break;
    pageObjectSnapshotByTab.delete(firstKey);
  }
}

export function getPreviousPageObjectSnapshot(tabId: number): {
  snapshot: ReadPageObjectSnapshot;
  telemetry?: ReadPageObjectDeltaSignals;
} | null {
  const previous = pageObjectSnapshotByTab.get(tabId);
  return previous
    ? {
        snapshot: { ...previous.pageObjectSnapshot },
        telemetry: previous.pageObjectDeltaSignals
          ? { ...previous.pageObjectDeltaSignals }
          : undefined,
      }
    : null;
}

export function buildBoundedWatchLoopSnapshot(params: {
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

export function resetObjectLifecycleCacheForTests(): void {
  objectLifecycleByTab.clear();
  pageObjectSnapshotByTab.clear();
  lastActionByTab.clear();
}
