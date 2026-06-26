import { sanitizeValue } from './mke-memory-sanitizer';
import {
  readArray,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

export function mergeReadPageFactsWithExistingCollectionFacts(
  readPageFacts: Record<string, unknown>,
  existingFactsValue: unknown,
): Record<string, unknown> {
  const existingFacts = readObject(existingFactsValue);
  if (!existingFacts) {
    if (readObject(readPageFacts.pageObjectSnapshotSummary)) {
      return { ...readPageFacts, snapshotSequence: 1 };
    }
    return readPageFacts;
  }
  const merged: Record<string, unknown> = { ...readPageFacts };
  const incomingSnapshotSummary = readObject(readPageFacts.pageObjectSnapshotSummary);
  const incomingDeltaSummary = readObject(readPageFacts.pageDeltaSummary);
  const previousSnapshotSummary = readObject(existingFacts.pageObjectSnapshotSummary);
  const previousDeltaSummary = readObject(existingFacts.pageDeltaSummary);
  const previousSnapshotSequence = readNumber(existingFacts.snapshotSequence);
  if (incomingSnapshotSummary) {
    merged.snapshotSequence =
      typeof previousSnapshotSequence === 'number' ? previousSnapshotSequence + 1 : 1;
    if (previousSnapshotSummary) {
      merged.lastPageObjectSnapshotSummary = previousSnapshotSummary;
    }
  }
  if (incomingDeltaSummary && previousDeltaSummary) {
    merged.lastPageDeltaSummary = previousDeltaSummary;
  }
  const preservedKeys = [
    'filterState',
    'observedResultCount',
    'requestedMinResults',
    'complete',
    'status',
    'targetRefCoverageRate',
    'targetabilitySummary',
    'snapshotSequence',
    'lastPageObjectSnapshotSummary',
    'lastPageDeltaSummary',
  ];
  for (const key of preservedKeys) {
    if (merged[key] === undefined && existingFacts[key] !== undefined) {
      merged[key] = existingFacts[key];
    }
  }
  const source = readString(existingFacts.source);
  if (source) merged.lastCollectionSource = source;
  return merged;
}

export function summarizeReadPageSnapshot(payload: unknown): Record<string, unknown> | null {
  const snapshot = readObject(payload);
  if (!snapshot) return null;
  const pageState = readNestedObject(snapshot, 'pageState');
  const sourceProvenance = readArray(snapshot.sourceProvenance)
    .map((entry): string | null => (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);
  const summary = {
    snapshotId: readString(snapshot.snapshotId),
    observedAt: readString(snapshot.observedAt),
    pageType: readString(snapshot.pageType),
    pageRole: readString(snapshot.pageRole),
    pageUrl: readString(snapshot.pageUrl),
    pageState: readObject({
      pageStability: readString(pageState?.pageStability),
      readiness: readString(pageState?.readiness),
      baseUrl: readString(pageState?.baseUrl),
      frameCount: readNumber(pageState?.frameCount),
    }),
    freshness: readString(snapshot.freshness),
    objectCount: readNumber(snapshot.objectCount),
    actionableObjectCount: readNumber(snapshot.actionableObjectCount),
    sourceProvenance,
    claimBoundary: readString(snapshot.claimBoundary),
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? (sanitizeValue(summary, 'browser_object') as Record<string, unknown>)
    : null;
}

export function summarizeReadPageSensingDiagnostics(
  payload: unknown,
): Record<string, unknown> | null {
  const diagnostics = readObject(payload);
  if (!diagnostics) return null;
  const partialErrors = readArray(diagnostics.partialErrors);
  const partialErrorSources = partialErrors
    .map((entry): string | null => readString(readObject(entry)?.source))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 8);
  const summary = {
    source: readString(diagnostics.source),
    coverageStatus: readString(diagnostics.coverageStatus),
    partialErrorCount: partialErrors.length,
    partialErrorSources,
    claimBoundary: readString(diagnostics.claimBoundary),
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? (sanitizeValue(summary, 'browser_object') as Record<string, unknown>)
    : null;
}

export function summarizeReadPageUnifiedDelta(
  payload: Record<string, unknown>,
): Record<string, unknown> | null {
  const evidence = readNestedObject(payload, 'postActionDeltaEvidence');
  const deltaContext = readNestedObject(payload, 'deltaContext');
  const report = evidence ?? deltaContext;
  if (!report) return null;
  const observedSignalDeltas = readObject(report.observedSignalDeltas);
  const networkSignals = readObject(report.networkSignals);
  const consoleSignals = readObject(report.consoleSignals);
  const networkSignalsCount =
    (typeof readNumber(
      observedSignalDeltas?.requestStartedDelta,
      networkSignals?.requestStartedDelta,
    ) === 'number'
      ? 1
      : 0) +
    (typeof readNumber(
      observedSignalDeltas?.failedRequestDelta,
      networkSignals?.failedRequestDelta,
    ) === 'number'
      ? 1
      : 0);
  const consoleSignalsCount =
    (typeof readNumber(observedSignalDeltas?.errorCountDelta, consoleSignals?.errorCountDelta) ===
    'number'
      ? 1
      : 0) +
    (typeof readNumber(
      observedSignalDeltas?.warningCountDelta,
      consoleSignals?.warningCountDelta,
    ) === 'number'
      ? 1
      : 0);
  const objectDelta = readObject(report.objectDelta);
  const changedObjectIds = readArray(objectDelta?.changedObjectIds);
  const legacyChangedObjects = readArray(report.changedObjects);
  const summary = {
    deltaKind: readString(report.observedChangeKind, report.deltaKind),
    recommendation: readString(report.recommendedNextAction, report.recommendation),
    actionId: readString(report.actionId),
    targetObjectId: readString(report.targetObjectId),
    beforeProjectionId: readString(report.beforeProjectionId, report.beforeSnapshotId),
    afterProjectionId: readString(report.afterProjectionId, report.afterSnapshotId),
    changedRegionsCount: readArray(report.changedRegions).length,
    changedObjectCount:
      changedObjectIds.length > 0 ? changedObjectIds.length : legacyChangedObjects.length,
    networkSignalsCount,
    consoleSignalsCount,
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? (sanitizeValue(summary, 'browser_object') as Record<string, unknown>)
    : null;
}

export function buildPageObjectEvidenceRefs(input: {
  snapshotSummary: Record<string, unknown> | null;
  deltaSummary: Record<string, unknown> | null;
}): string[] {
  const snapshotId = readString(input.snapshotSummary?.snapshotId);
  const deltaAfterProjectionId = readString(input.deltaSummary?.afterProjectionId);
  const evidenceRefs: string[] = [];
  if (snapshotId) evidenceRefs.push(`read_page_object_snapshot:${snapshotId}`);
  if (deltaAfterProjectionId)
    evidenceRefs.push(`post_action_delta_evidence:${deltaAfterProjectionId}`);
  return evidenceRefs;
}

export function buildPageObjectRecentEvents(input: {
  snapshotSummary: Record<string, unknown> | null;
  deltaSummary: Record<string, unknown> | null;
  observedAt: string;
}): unknown[] {
  const events: Array<Record<string, unknown>> = [];
  if (input.snapshotSummary) {
    events.push({
      eventType: 'page_object_snapshot',
      snapshotId: input.snapshotSummary.snapshotId,
      observedAt: input.snapshotSummary.observedAt ?? input.observedAt,
    });
  }
  if (input.deltaSummary) {
    events.push({
      eventType: 'post_action_delta_evidence',
      deltaKind: input.deltaSummary.deltaKind,
      actionId: input.deltaSummary.actionId,
      targetObjectId: input.deltaSummary.targetObjectId,
      beforeProjectionId: input.deltaSummary.beforeProjectionId,
      afterProjectionId: input.deltaSummary.afterProjectionId,
      observedAt: input.observedAt,
    });
  }
  return events;
}
