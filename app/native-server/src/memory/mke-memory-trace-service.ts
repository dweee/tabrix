import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  type BrowserObject,
  type BrowserObjectInput,
  type BusinessSuccessVerdict,
  type MemoryTrace,
} from './db';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';
import { BoundedAsyncBrowserObjectWriteQueue } from './mke-browser-object-write-queue';
import {
  normalizeUrlPattern,
  parseFirstTextPayload,
  sanitizeResultSummaryForMemory,
  sanitizeValue,
} from './mke-memory-sanitizer';
import {
  actionTargetIdentityKey,
  normalizeResultCardActionToolArgs,
  normalizeResultCardOpenAction,
  normalizeStableLocatorChain,
  readResultCardStableTarget,
  regionChildObjectIdentityKey,
  summarizeCollectedResultCardForTrace,
  summarizeResultCardCollectionWindow,
  summarizeResultCardSourceWindow,
} from './mke-memory-result-card-projection';
import {
  normalizeOwnerType,
  normalizePageRoleForMemory,
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import {
  stringHasBlockedPageSignal,
  valueHasBlockedPageSignal,
} from './mke-memory-page-state-signals';
import {
  readActionabilityBoolean,
  readArray,
  readBoolean,
  readFiniteNumber,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';
import { logger } from '../logging/logger';

const DEFAULT_ASYNC_BROWSER_OBJECT_WRITE_QUEUE_LIMIT = 128;
const mkeMemoryTraceLogger = logger.child('mke-memory-trace');

export interface RecordMkeToolCallTraceInput {
  taskId: string;
  taskIntent?: string | null;
  aiClient?: string | null;
  toolName: string;
  stepId: string;
  sequenceIndex?: number | null;
  requestParams: unknown;
  requestAtMs: number;
  responseAtMs?: number;
  result: CallToolResult;
  resultSummary?: string | null;
  errorCode?: string | null;
  browserContextKey?: string | null;
}

export interface RecordMkeAiBusinessFeedbackInput {
  traceId: string;
  taskId?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  sequenceIndex?: number | null;
  traceBindingHash?: string | null;
  evaluationScope?: 'step' | 'task' | null;
  businessStatus: BusinessSuccessVerdict;
  confidence?: number | null;
  reasonCode?: string | null;
  summary?: string | null;
  receivedAt?: string;
  sourceToolName?: string | null;
  sourceToolCallId?: string | null;
}

export class MkeAiFeedbackValidationError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MkeAiFeedbackValidationError';
    this.code = code;
  }
}

export interface RecordBrowserWorldSnapshotInput {
  browserWorld: unknown;
  observedAtMs?: number;
  browserContextKey?: string | null;
}

interface ParsedResultDigest {
  response: unknown;
  businessSuccess: BusinessSuccessVerdict;
  tabId: number | null;
  windowId: number | null;
  siteFamily: string | null;
  pageUrlPattern: string | null;
  rootRoute: string | null;
  currentRoute: string | null;
  pageRole: string | null;
  pageModelKey: string | null;
  pageState: string | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  freshness: string | null;
  fallbackUsed: string | null;
  perceptionObjects: unknown | null;
  actionTarget: unknown | null;
  preObservation: unknown | null;
  postObservation: unknown | null;
  postActionDelta: unknown | null;
  nextRequiredCheck: string | null;
}

export interface MkeMemoryTraceServiceOptions {
  asyncBrowserObjectWriteQueueLimit?: number;
}

interface BrowserObjectProjectionTrace {
  traceId?: string | null;
  browserContextKey?: string | null;
  sourceRoute?: string | null;
  freshness?: string | null;
  windowId?: number | null;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
}

interface BrowserWorldTabProjection {
  tab: Record<string, unknown>;
  tabId: number;
  windowId: number | null;
  urlFields: ReturnType<typeof normalizeUrlPattern>;
}

function mergeReadPageFactsWithExistingCollectionFacts(
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

function summarizeReadPageSnapshot(payload: unknown): Record<string, unknown> | null {
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

function summarizeReadPageUnifiedDelta(
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

function isBrowserActionTool(toolName: string): boolean {
  return (
    toolName === 'chrome_click_element' ||
    toolName === 'chrome_fill_or_select' ||
    toolName === 'chrome_keyboard' ||
    toolName === 'chrome_navigate'
  );
}

function summarizeBrowserActionTarget(payload: Record<string, unknown>): unknown | null {
  const actionEvidence = readObject(payload.actionEvidenceResult);
  const targetBinding =
    readObject(actionEvidence?.targetBinding) ?? readObject(payload.targetBinding);
  const dispatch = readObject(actionEvidence?.dispatch);
  const summary = {
    actionId: readString(actionEvidence?.actionId),
    actionKind: readString(actionEvidence?.actionKind),
    tabId: readNumber(actionEvidence?.tabId, payload.tabId),
    requestedTargetRef: readString(targetBinding?.requestedTargetRef),
    resolvedTargetRef: readString(targetBinding?.resolvedTargetRef),
    locatorChainSummary: readArray(targetBinding?.locatorChainSummary)
      .map((entry): string | null => (typeof entry === 'string' ? entry : null))
      .filter((entry): entry is string => Boolean(entry))
      .slice(0, 8),
    dispatchTarget: readString(targetBinding?.dispatchTarget),
    frameScope: readString(targetBinding?.frameScope),
    targetBindingProven: readBoolean(targetBinding?.targetBindingProven),
    dispatched: readBoolean(dispatch?.dispatched),
    acceptedByBrowser: readBoolean(dispatch?.acceptedByBrowser),
    errorCode: readString(dispatch?.errorCode, payload.error, payload.reason),
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? sanitizeValue(summary, 'memory_trace')
    : null;
}

function summarizeBrowserActionPostObservation(payload: Record<string, unknown>): unknown | null {
  const postActionReadback = readObject(payload.postActionReadback);
  const clickDiff = readObject(payload.clickDiff);
  const verification = readObject(payload.verification);
  const inputWriteEvidence = readObject(payload.inputWriteEvidence);
  const summary = {
    success: readBoolean(payload.success),
    dispatchSucceeded: readBoolean(payload.dispatchSucceeded),
    observedOutcome: readString(payload.observedOutcome),
    readbackStatus: readString(postActionReadback?.status),
    readbackSource: readString(postActionReadback?.readbackSource),
    freshReadRequired: readBoolean(postActionReadback?.freshReadRequired),
    expectedEvidence: readString(postActionReadback?.expectedEvidence),
    clickChangeKind: readString(clickDiff?.kind),
    urlDelta: readString(clickDiff?.urlDelta),
    newTabOpened: readBoolean(clickDiff?.newTabOpened, verification?.newTabOpened),
    domChanged: readBoolean(clickDiff?.domChanged, verification?.domChanged),
    dialogAdded: readBoolean(clickDiff?.dialogAdded),
    menuAdded: readBoolean(clickDiff?.menuAdded),
    focusChanged: readBoolean(clickDiff?.focusChanged, verification?.focusChanged),
    stateChanged: readBoolean(clickDiff?.stateChanged, verification?.stateChanged),
    navigationOccurred: readBoolean(verification?.navigationOccurred, payload.navigationOccurred),
    inputProofStatus: readString(inputWriteEvidence?.proofStatus),
    valueState: readString(inputWriteEvidence?.valueState),
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? sanitizeValue(summary, 'memory_trace')
    : null;
}

function summarizeBrowserActionDelta(payload: Record<string, unknown>): unknown | null {
  const explicitDelta = readObject(payload.postActionDelta);
  const actionEvidence = readObject(payload.actionEvidenceResult);
  const targetBinding =
    readObject(actionEvidence?.targetBinding) ?? readObject(payload.targetBinding);
  const postActionReadback = readObject(payload.postActionReadback);
  const clickDiff = readObject(payload.clickDiff);
  const verification = readObject(payload.verification);
  const inputWriteEvidence = readObject(payload.inputWriteEvidence);
  const changedSignals = [
    ...readArray(explicitDelta?.changedSignals)
      .map((entry): string | null => (typeof entry === 'string' ? entry : null))
      .filter((entry): entry is string => Boolean(entry)),
    readBoolean(clickDiff?.newTabOpened, verification?.newTabOpened) ? 'new_tab_opened' : null,
    readBoolean(clickDiff?.beforeUnloadFired, verification?.navigationOccurred)
      ? 'before_unload_fired'
      : null,
    readBoolean(clickDiff?.hashChanged) ? 'hash_changed' : null,
    readBoolean(clickDiff?.domChanged, verification?.domChanged) ? 'dom_changed' : null,
    readBoolean(clickDiff?.dialogAdded) ? 'dialog_opened' : null,
    readBoolean(clickDiff?.menuAdded) ? 'menu_opened' : null,
    readBoolean(clickDiff?.stateChanged, verification?.stateChanged) ? 'state_changed' : null,
    readBoolean(clickDiff?.focusChanged, verification?.focusChanged) ? 'focus_changed' : null,
    readString(inputWriteEvidence?.proofStatus) === 'input_state_observed'
      ? 'input_state_observed'
      : null,
  ]
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry, index, array) => array.indexOf(entry) === index);
  const observedOutcome = readString(
    explicitDelta?.observedOutcome,
    payload.observedOutcome,
    postActionReadback?.observedOutcome,
  );
  const summary = {
    deltaKind: readString(explicitDelta?.deltaKind) ?? 'post_action_tool_delta',
    actionId: readString(explicitDelta?.actionId, actionEvidence?.actionId),
    actionKind: readString(
      explicitDelta?.actionKind,
      actionEvidence?.actionKind,
      postActionReadback?.actionKind,
    ),
    tabId: readNumber(explicitDelta?.tabId, actionEvidence?.tabId, payload.tabId),
    targetRef: readString(
      explicitDelta?.targetRef,
      targetBinding?.resolvedTargetRef,
      targetBinding?.requestedTargetRef,
    ),
    observedOutcome,
    changed:
      readBoolean(explicitDelta?.changed) ??
      (changedSignals.length > 0 || readString(clickDiff?.kind) === 'change'),
    changedSignals,
    urlDelta: readString(explicitDelta?.urlDelta, clickDiff?.urlDelta),
    hashChanged: readBoolean(explicitDelta?.hashChanged, clickDiff?.hashChanged),
    beforeUnloadFired: readBoolean(
      explicitDelta?.beforeUnloadFired,
      clickDiff?.beforeUnloadFired,
      verification?.navigationOccurred,
    ),
    readbackStatus: readString(explicitDelta?.readbackStatus, postActionReadback?.status),
    recommendation: readString(
      explicitDelta?.recommendation,
      postActionReadback?.requiredNextAction,
      payload.recommendedNextAction,
    ),
    businessSuccessProven: readBoolean(
      explicitDelta?.businessSuccessProven,
      postActionReadback?.businessSuccessProven,
    ),
  };
  return Object.values(summary).some((value) => value !== null && value !== undefined)
    ? sanitizeValue(summary, 'memory_trace')
    : null;
}

function readBrowserActionNextRequiredCheck(payload: Record<string, unknown>): string | null {
  const postActionReadback = readObject(payload.postActionReadback);
  const actionEvidence = readObject(payload.actionEvidenceResult);
  const business = readObject(actionEvidence?.business);
  return readString(
    postActionReadback?.requiredNextAction,
    business?.nextRequiredCheck,
    payload.recommendedNextAction,
  );
}

function buildPageObjectEvidenceRefs(input: {
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

function buildPageObjectRecentEvents(input: {
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
        nextRequiredTool: readString(target.nextRequiredTool),
        nextRequiredCheck: readString(target.nextRequiredCheck),
        intentBoundary: readString(target.intentBoundary, target.intent),
        matchReason: readString(target.matchReason, target.reason),
      };
    })
    .filter((target): target is Record<string, unknown> => target !== null)
    .slice(0, 80);
}

function readBusinessVerdictString(...values: unknown[]): BusinessSuccessVerdict | null {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    if (value === 'proven') return 'achieved';
    if (value === 'not_proven') return 'unknown';
    if (
      value === 'achieved' ||
      value === 'partial' ||
      value === 'not_achieved' ||
      value === 'true' ||
      value === 'false' ||
      value === 'unknown'
    ) {
      return value;
    }
  }
  return null;
}

function readBusinessSuccess(
  result: CallToolResult,
  payload: Record<string, unknown> | null,
): BusinessSuccessVerdict {
  const actionEvidenceResult = readNestedObject(payload, 'actionEvidenceResult');
  const actionBusiness = readNestedObject(actionEvidenceResult, 'business');
  const tabrixMetadata = readNestedObject(payload, '_tabrix');
  const explicitVerdict = readBusinessVerdictString(
    payload?.businessSuccess,
    tabrixMetadata?.businessStatus,
    actionBusiness?.businessSuccessVerdict,
  );
  if (explicitVerdict) return explicitVerdict;

  const explicit = readBoolean(payload?.businessSuccess);
  if (explicit !== null) return explicit ? 'true' : 'false';
  if (readBoolean(actionBusiness?.businessSuccessProven) === true) return 'true';
  if (result.isError === true) return 'false';
  return 'unknown';
}

function normalizePageStateForMemory(input: {
  payload: Record<string, unknown> | null;
  page: Record<string, unknown> | null;
  summary: Record<string, unknown> | null;
  url: string | null;
}): string | null {
  const authArtifactStatus = readNestedObject(input.payload, 'authArtifactStatus');
  const observedAuthSurface = readNestedObject(input.payload, 'observedAuthSurface');
  if (
    stringHasBlockedPageSignal(input.url) ||
    valueHasBlockedPageSignal(authArtifactStatus) ||
    valueHasBlockedPageSignal(observedAuthSurface) ||
    valueHasBlockedPageSignal(input.summary) ||
    valueHasBlockedPageSignal(input.page)
  ) {
    return 'restricted';
  }
  return readString(input.summary?.quality, input.payload?.pageState);
}

function digestResult(
  result: CallToolResult,
  toolName: string,
  payload = parseFirstTextPayload(result),
): ParsedResultDigest {
  const object = readObject(payload);
  const page = readNestedObject(object, 'page');
  const summary = readNestedObject(object, 'summary');
  const pageContext = readNestedObject(object, 'pageContext');
  const dataSourceDecision = readNestedObject(object, 'dataSourceDecision');
  const url = readString(page?.url, object?.url, object?.pageUrl);
  const urlFields = normalizeUrlPattern(url);
  const pageRole = normalizePageRoleForMemory(readString(summary?.pageRole, object?.pageRole));
  const structuredTraceContext = buildStructuredTraceContext(object, toolName);
  const pageModelKey = readString(
    readNestedObject(object, 'pageProjection')?.pageModelKey,
    object?.pageModelKey,
    pageRole && urlFields.siteFamily ? `page:${urlFields.siteFamily}:${pageRole}` : null,
  );

  return {
    response: {
      isError: result.isError === true,
      contentTypes: result.content?.map((item) => item.type) ?? [],
      payloadDigest: sanitizeValue(payload, toolName),
    },
    businessSuccess: readBusinessSuccess(result, object),
    tabId: readNumber(object?.tabId, readNestedObject(object, 'pageProjection')?.tabId),
    windowId: readNumber(object?.windowId),
    siteFamily: urlFields.siteFamily,
    pageUrlPattern: urlFields.pattern,
    rootRoute: urlFields.rootRoute,
    currentRoute: urlFields.currentRoute,
    pageRole,
    pageModelKey,
    pageState: normalizePageStateForMemory({ payload: object, page, summary, url }),
    sourceRoute: readString(object?.sourceRoute, pageContext?.sourceRoute),
    selectedDataSource: readString(
      object?.selectedDataSource,
      object?.dataSource,
      dataSourceDecision?.selectedDataSource,
    ),
    freshness: readString(object?.freshness, pageContext?.freshness),
    fallbackUsed: readString(object?.fallbackUsed, pageContext?.fallbackUsed),
    ...structuredTraceContext,
  };
}

function buildStructuredTraceContext(
  payload: Record<string, unknown> | null,
  toolName: string,
): Pick<
  ParsedResultDigest,
  | 'perceptionObjects'
  | 'actionTarget'
  | 'preObservation'
  | 'postObservation'
  | 'postActionDelta'
  | 'nextRequiredCheck'
> {
  if (!payload) {
    return {
      perceptionObjects: null,
      actionTarget: null,
      preObservation: null,
      postObservation: null,
      postActionDelta: null,
      nextRequiredCheck: null,
    };
  }

  if (toolName === 'chrome_read_page') {
    const snapshotSummary = summarizeReadPageSnapshot(
      readNestedObject(payload, 'pageObjectSnapshot'),
    );
    const deltaSummary = summarizeReadPageUnifiedDelta(payload);
    return {
      perceptionObjects: snapshotSummary,
      actionTarget: summarizeCandidateActions(readArray(payload.candidateActions)),
      preObservation: null,
      postObservation: snapshotSummary,
      postActionDelta: deltaSummary,
      nextRequiredCheck: readString(readNestedObject(payload, 'taskProtocol')?.nextRequiredCheck),
    };
  }

  if (toolName === 'chrome_collect_result_cards') {
    const cards = readArray(payload.cards)
      .map((rawCard) => summarizeCollectedResultCardForTrace(readObject(rawCard)))
      .filter((card): card is Record<string, unknown> => card !== null)
      .slice(0, 20);
    const targetabilitySummary = readObject(payload.targetabilitySummary);
    return {
      perceptionObjects: sanitizeValue(
        {
          kind: 'result_card_collection',
          observedResultCount: readNumber(payload.observedResultCount) ?? cards.length,
          targetRefCoverageRate: readFiniteNumber(payload.targetRefCoverageRate),
          targetabilityStatus: readString(targetabilitySummary?.status),
          cards,
        },
        'memory_trace',
      ),
      actionTarget: sanitizeValue(
        {
          stableTargetCount: cards.filter((card) => readObject(card.stableTarget)).length,
          urlFallbackCount: readNumber(targetabilitySummary?.urlFallbackCount),
          untargetableCount: readNumber(targetabilitySummary?.untargetableCount),
          primaryTargets: cards
            .map((card) => readObject(card.stableTarget))
            .filter((target): target is Record<string, unknown> => target !== null)
            .slice(0, 10),
        },
        'memory_trace',
      ),
      preObservation: null,
      postObservation: sanitizeValue(
        {
          pageRole: readString(payload.pageRole),
          pageState: readString(payload.pageState, payload.status),
          filterState: readObject(payload.filterState),
          complete: readBoolean(payload.complete),
        },
        'memory_trace',
      ),
      postActionDelta: null,
      nextRequiredCheck: null,
    };
  }

  if (isBrowserActionTool(toolName)) {
    return {
      perceptionObjects: null,
      actionTarget: summarizeBrowserActionTarget(payload),
      preObservation: null,
      postObservation: summarizeBrowserActionPostObservation(payload),
      postActionDelta: summarizeBrowserActionDelta(payload),
      nextRequiredCheck: readBrowserActionNextRequiredCheck(payload),
    };
  }

  return {
    perceptionObjects: null,
    actionTarget: null,
    preObservation: null,
    postObservation: null,
    postActionDelta: null,
    nextRequiredCheck: null,
  };
}

function summarizeCandidateActions(actions: unknown[]): unknown | null {
  const summaries = actions
    .map((rawAction): Record<string, unknown> | null => {
      const action = readObject(rawAction);
      if (!action) return null;
      const targetRef = readString(action.targetRef, action.id);
      if (!targetRef) return null;
      return {
        id: readString(action.id),
        actionType: readString(action.actionType),
        intent: readString(action.intent),
        targetRef,
        label: readString(action.label),
        nextRequiredCheck: readString(action.nextRequiredCheck),
      };
    })
    .filter((action): action is Record<string, unknown> => action !== null)
    .slice(0, 40);
  if (summaries.length === 0) return null;
  return sanitizeValue({ actions: summaries, count: summaries.length }, 'memory_trace');
}

function readRequestNumber(request: Record<string, unknown> | null, key: string): number | null {
  return readNumber(request?.[key]);
}

function browserPageObjectKey(tab: BrowserWorldTabProjection): string {
  return (
    tab.urlFields.rootRoute ??
    tab.urlFields.currentRoute ??
    tab.urlFields.pattern ??
    String(tab.tabId)
  );
}

function browserWorldTabRank(tab: BrowserWorldTabProjection): number {
  if (readBoolean(tab.tab.active) === true) return 0;
  if (readString(tab.tab.status) === 'loading') return 2;
  if (readBoolean(tab.tab.canTabrixOperate) === false) return 3;
  return 1;
}

function chooseRepresentativeBrowserWorldTab(
  current: BrowserWorldTabProjection,
  candidate: BrowserWorldTabProjection,
): BrowserWorldTabProjection {
  const currentRank = browserWorldTabRank(current);
  const candidateRank = browserWorldTabRank(candidate);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  return candidate.tabId > current.tabId ? candidate : current;
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

function normalizeConfidence(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value as number));
}

const DEFAULT_AI_FEEDBACK_EVALUATION_VERSION = 'ai_feedback_v1';
const DEFAULT_AI_FEEDBACK_RUBRIC_VERSION = 'tabrix_ai_business_feedback_v1';

function normalizeAiFeedbackScope(value: string | null | undefined): 'step' | 'task' {
  return value === 'task' ? 'task' : 'step';
}

function ensureFeedbackBinding(
  input: RecordMkeAiBusinessFeedbackInput,
  trace: MemoryTrace,
): string {
  const expectedHash = buildMemoryTraceBindingHash(trace);
  const acceptedHashes = new Set([
    expectedHash,
    buildLegacyMemoryTraceBindingHash(trace),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: 'unknown' }),
    buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: null }),
  ]);
  if (!input.traceBindingHash || !acceptedHashes.has(input.traceBindingHash)) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback binding does not match the target Memory trace.',
    );
  }
  if (input.taskId !== undefined && input.taskId !== null && input.taskId !== trace.taskId) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback taskId does not match the target Memory trace.',
    );
  }
  if (
    input.toolName !== undefined &&
    input.toolName !== null &&
    input.toolName !== trace.toolName
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback toolName does not match the target Memory trace.',
    );
  }
  if (
    input.toolCallId !== undefined &&
    input.toolCallId !== null &&
    input.toolCallId !== trace.toolCallId
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback toolCallId does not match the target Memory trace.',
    );
  }
  if (
    input.sequenceIndex !== undefined &&
    input.sequenceIndex !== null &&
    input.sequenceIndex !== trace.sequenceIndex
  ) {
    throw new MkeAiFeedbackValidationError(
      'trace_binding_mismatch',
      'AI feedback sequenceIndex does not match the target Memory trace.',
    );
  }
  return expectedHash;
}

function validateAiFeedbackQuality(input: {
  businessStatus: BusinessSuccessVerdict;
  confidence: number | null;
  summary: string | null | undefined;
}): void {
  const highConfidenceSuccess =
    input.businessStatus === 'achieved' &&
    typeof input.confidence === 'number' &&
    input.confidence >= 0.9;
  if (highConfidenceSuccess && (!input.summary || input.summary.trim().length < 8)) {
    throw new MkeAiFeedbackValidationError(
      'summary_required',
      'High-confidence achieved feedback must include a concise AI evaluation summary.',
    );
  }
}

export class MkeMemoryTraceService {
  private readonly asyncBrowserObjectWrites: BoundedAsyncBrowserObjectWriteQueue;

  constructor(
    private readonly repo: MemoryTraceRepository,
    private readonly browserObjects?: BrowserObjectRepository,
    private readonly options: MkeMemoryTraceServiceOptions = {},
  ) {
    this.asyncBrowserObjectWrites = new BoundedAsyncBrowserObjectWriteQueue(
      options.asyncBrowserObjectWriteQueueLimit ?? DEFAULT_ASYNC_BROWSER_OBJECT_WRITE_QUEUE_LIMIT,
    );
  }

  private sanitizeBrowserObjectValue(value: unknown): unknown {
    return sanitizeValue(value, 'browser_object');
  }

  private browserObjectRedactionState(): string {
    return 'redacted';
  }

  public recordToolCall(input: RecordMkeToolCallTraceInput): MemoryTrace {
    const requestObject = readObject(input.requestParams);
    const responseAtMs = input.responseAtMs ?? Date.now();
    const payload = parseFirstTextPayload(input.result);
    const digest = digestResult(input.result, input.toolName, payload);
    const tabId = digest.tabId ?? readRequestNumber(requestObject, 'tabId');
    const windowId = digest.windowId ?? readRequestNumber(requestObject, 'windowId');
    const toolSuccess = input.result.isError !== true;

    const trace = this.repo.append({
      taskId: input.taskId,
      taskIntent: input.taskIntent ?? null,
      aiClient: input.aiClient ?? null,
      toolName: input.toolName,
      toolCallId: input.stepId,
      sequenceIndex: input.sequenceIndex ?? null,
      requestParams: sanitizeValue(input.requestParams, input.toolName),
      requestAt: new Date(input.requestAtMs).toISOString(),
      response: digest.response,
      responseAt: new Date(responseAtMs).toISOString(),
      durationMs: Math.max(0, responseAtMs - input.requestAtMs),
      toolSuccess,
      businessSuccess: digest.businessSuccess,
      resultSummary: sanitizeResultSummaryForMemory(input.resultSummary, input.toolName, payload),
      errorCode: input.errorCode ?? null,
      tabId,
      windowId,
      browserContextKey: input.browserContextKey ?? null,
      siteFamily: digest.siteFamily,
      pageUrlPattern: digest.pageUrlPattern,
      pageRole: digest.pageRole,
      pageState: digest.pageState,
      pageModelKey: digest.pageModelKey,
      perceptionObjects: digest.perceptionObjects,
      actionTarget: digest.actionTarget,
      preObservation: digest.preObservation,
      postObservation: digest.postObservation,
      postActionDelta: digest.postActionDelta,
      sourceRoute: digest.sourceRoute,
      selectedDataSource: digest.selectedDataSource,
      freshness: digest.freshness,
      fallbackUsed: digest.fallbackUsed,
      nextRequiredCheck: digest.nextRequiredCheck,
      redactionState: 'redacted',
      createdAt: new Date(responseAtMs).toISOString(),
    });
    this.asyncBrowserObjectWrites.enqueue({
      traceId: trace.traceId,
      toolName: input.toolName,
      run: () =>
        this.recordBrowserObjectsFromToolResult({
          trace,
          payload,
          toolName: input.toolName,
          observedAt: new Date(responseAtMs).toISOString(),
          browserContextKey: input.browserContextKey ?? null,
        }),
    });
    return trace;
  }

  public recordBrowserWorldSnapshot(input: RecordBrowserWorldSnapshotInput): void {
    if (!this.browserObjects) return;
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
      this.browserObjects.transaction(() => {
        this.recordBrowserWorldObjects(
          projectionTrace,
          payload,
          observedAt,
          projectionTrace.browserContextKey ?? null,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mkeMemoryTraceLogger.warn('browser world snapshot projection failed', {
        errorMessage: message,
      });
    }
  }

  public flushAsyncWrites(): Promise<void> {
    return this.asyncBrowserObjectWrites.flush();
  }

  public discardPendingAsyncWrites(): void {
    this.asyncBrowserObjectWrites.discardPending();
  }

  private recordBrowserObjectsFromToolResult(input: {
    trace: MemoryTrace;
    payload: unknown;
    toolName: string;
    observedAt: string;
    browserContextKey: string | null;
  }): void {
    if (!this.browserObjects) return;
    const payload = readObject(input.payload);
    if (!payload) return;
    try {
      this.browserObjects.transaction(() => {
        if (input.toolName === 'get_windows_and_tabs') {
          this.recordBrowserWorldObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
          return;
        }
        if (input.toolName === 'chrome_read_page') {
          this.recordReadPageObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
          return;
        }
        if (input.toolName === 'chrome_collect_result_cards') {
          this.recordCollectedResultCardObjects(
            input.trace,
            payload,
            input.observedAt,
            input.browserContextKey,
          );
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      mkeMemoryTraceLogger.warn('browser object projection failed', {
        traceId: input.trace.traceId,
        toolName: input.toolName,
        errorMessage: message,
      });
    }
  }

  private upsertBrowserObject(input: BrowserObjectInput): BrowserObject | undefined {
    return this.browserObjects?.upsert(input);
  }

  private recordBrowserWorldObjects(
    trace: BrowserObjectProjectionTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const browserWorld = readNestedObject(payload, 'browserWorld') ?? payload;
    const contextKey = browserContextKey ?? trace.browserContextKey ?? 'default';
    for (const rawWindow of readArray(browserWorld.windows)) {
      const win = readObject(rawWindow);
      if (!win) continue;
      const id = readNumber(win.windowId, win.id);
      if (id === null) continue;
      this.upsertBrowserObject({
        siteFamily: 'browser',
        pageModelKey: 'browser-window',
        objectFingerprint: objectFingerprint('window', id),
        objectType: 'window',
        browserContextKey: contextKey,
        windowId: id,
        sourceRoute: readString(
          payload.source,
          trace.sourceRoute,
          'chrome_windows_get_all_with_browser_world_inventory',
        ),
        sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
        lifecycleState: readString(win.lifecycleState, 'updated'),
        isActive: readBoolean(win.focused, win.isFocused, win.active),
        canTabrixOperate: readBoolean(win.canTabrixOperate),
        operabilityReason: readString(win.operabilityReason),
        facts: {
          tabCount: readNumber(win.tabCount),
          activeTabId: readNumber(win.activeTabId),
          state: readString(win.state, win.visibilityState),
        },
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        currentState: sanitizeValue(
          {
            focused: readBoolean(win.focused, win.isFocused),
            state: readString(win.state, win.visibilityState),
            tabCount: readNumber(win.tabCount),
          },
          'browser_object',
        ),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
      });
    }
    const tabsByBaseRoute = new Map<
      string,
      { representative: BrowserWorldTabProjection; tabs: BrowserWorldTabProjection[] }
    >();
    for (const rawTab of readArray(browserWorld.tabs)) {
      const tab = readObject(rawTab);
      if (!tab) continue;
      const tabId = readNumber(tab.tabId, tab.id);
      if (tabId === null) continue;
      const urlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
        allowPersonalBrowserStateStorage: false,
      });
      const tabWindowId = readNumber(tab.windowId) ?? trace.windowId ?? null;
      const projectedTab: BrowserWorldTabProjection = {
        tab,
        tabId,
        windowId: tabWindowId,
        urlFields,
      };
      const baseRouteKey = browserPageObjectKey(projectedTab);
      const group = tabsByBaseRoute.get(baseRouteKey);
      if (group) {
        group.tabs.push(projectedTab);
        group.representative = chooseRepresentativeBrowserWorldTab(
          group.representative,
          projectedTab,
        );
      } else {
        tabsByBaseRoute.set(baseRouteKey, { representative: projectedTab, tabs: [projectedTab] });
      }
    }
    for (const [baseRouteKey, group] of tabsByBaseRoute.entries()) {
      const representative = group.representative;
      const { tab, tabId, windowId: tabWindowId, urlFields } = representative;
      const openTabIds = group.tabs.map((item) => item.tabId);
      const hasLoading = group.tabs.some((item) => readString(item.tab.status) === 'loading');
      const hasRestricted = group.tabs.some(
        (item) => readBoolean(item.tab.canTabrixOperate) === false,
      );
      this.upsertBrowserObject({
        siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
        pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        pageRole: 'browser_tab',
        pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
        objectFingerprint: objectFingerprint('browser_page', baseRouteKey),
        objectType: 'tab',
        browserContextKey: contextKey,
        tabId,
        windowId: tabWindowId,
        ownerType: normalizeOwnerType(readString(tab.ownerType, tab.openedBy, tab.owner)),
        sourceRoute: readString(
          payload.source,
          trace.sourceRoute,
          'chrome_windows_get_all_with_browser_world_inventory',
        ),
        sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
        tabStatus: readString(tab.status),
        lifecycleState: readString(tab.lifecycleState, tab.closedAtMs ? 'closed' : 'updated'),
        isActive: readBoolean(tab.active),
        canTabrixOperate: readBoolean(tab.canTabrixOperate),
        operabilityReason: readString(tab.operabilityReason),
        facts: this.sanitizeBrowserObjectValue({
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          openerTabId: readNumber(tab.openerTabId),
        }),
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        currentState: this.sanitizeBrowserObjectValue({
          active: readBoolean(tab.active),
          status: readString(tab.status),
          pinned: readBoolean(tab.pinned),
          discarded: readBoolean(tab.discarded),
          titleSummary: readString(tab.title),
          host: urlFields.siteFamily,
          rootRoute: urlFields.rootRoute,
          currentRoute: urlFields.currentRoute,
          tabId,
          tabIds: openTabIds,
          openTabCount: openTabIds.length,
          representativeTabId: tabId,
          hasLoading,
          hasRestricted,
        }),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
        closedAt: readNumber(tab.closedAtMs) ? observedAt : null,
        archivedAt: null,
      });
    }
    this.recordClosedBrowserWorldPage(trace, browserWorld, observedAt, contextKey, payload);
  }

  private recordClosedBrowserWorldPage(
    trace: BrowserObjectProjectionTrace,
    browserWorld: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string,
    payload: Record<string, unknown>,
  ): void {
    const summary = readNestedObject(browserWorld, 'summary');
    const recentActivityLedger =
      readObject(browserWorld.recentActivityLedger) ??
      readNestedObject(summary, 'recentActivityLedger');
    const latestPageClosed = readNestedObject(recentActivityLedger, 'latestPageClosed');
    if (!latestPageClosed) return;
    const tabId = readNumber(latestPageClosed.tabId);
    if (tabId === null) return;
    const closedAtMs = readNumber(latestPageClosed.occurredAtMs);
    const closedAt =
      closedAtMs !== null && Number.isFinite(closedAtMs)
        ? new Date(closedAtMs).toISOString()
        : observedAt;
    const urlFields = normalizeUrlPattern(readString(latestPageClosed.url), {
      allowPersonalBrowserStateStorage: false,
    });
    const closedBaseRouteKey =
      urlFields.rootRoute ?? urlFields.currentRoute ?? urlFields.pattern ?? String(tabId);
    const sameBaseRouteStillOpen = readArray(browserWorld.tabs).some((rawTab) => {
      const tab = readObject(rawTab);
      if (!tab || readNumber(tab.closedAtMs) !== null) return false;
      const openUrlFields = normalizeUrlPattern(readString(tab.url, tab.pendingUrl), {
        allowPersonalBrowserStateStorage: false,
      });
      const openBaseRouteKey =
        openUrlFields.rootRoute ??
        openUrlFields.currentRoute ??
        openUrlFields.pattern ??
        String(readNumber(tab.tabId, tab.id));
      return openBaseRouteKey === closedBaseRouteKey;
    });
    if (sameBaseRouteStillOpen) return;
    const tabWindowId = readNumber(latestPageClosed.windowId) ?? trace.windowId;
    this.upsertBrowserObject({
      siteFamily: urlFields.siteFamily ?? trace.siteFamily ?? 'browser',
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole: 'browser_tab',
      pageModelKey: urlFields.siteFamily ? `tab:${urlFields.siteFamily}` : 'browser-tab',
      objectFingerprint: objectFingerprint('browser_page', closedBaseRouteKey),
      objectType: 'tab',
      browserContextKey,
      tabId,
      windowId: tabWindowId,
      ownerType: normalizeOwnerType(readString(latestPageClosed.openedBy)),
      sourceRoute: readString(
        payload.source,
        trace.sourceRoute,
        'chrome_windows_get_all_with_browser_world_inventory',
      ),
      sourceFreshness: readString(browserWorld.status, browserWorld.freshness, trace.freshness),
      lifecycleState: 'closed',
      isActive: false,
      canTabrixOperate: false,
      operabilityReason: 'tab_closed',
      facts: this.sanitizeBrowserObjectValue({
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
        evidence: readString(latestPageClosed.evidence),
      }),
      firstTraceId: trace.traceId,
      lastTraceId: trace.traceId,
      sourceTraceIds: sourceTraceIds(trace),
      currentState: this.sanitizeBrowserObjectValue({
        status: 'closed',
        titleSummary: readString(latestPageClosed.title),
        host: urlFields.siteFamily,
        rootRoute: urlFields.rootRoute,
        currentRoute: urlFields.currentRoute,
      }),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
      closedAt,
      archivedAt: null,
    });
  }

  private recordReadPageObjects(
    trace: MemoryTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const projection = readNestedObject(payload, 'pageProjection');
    const compact = readNestedObject(payload, 'browserPageObjectCompact');
    const compactFacts = readNestedObject(compact, 'facts');
    const compactTabFacts = readNestedObject(compactFacts, 'tab');
    const page = readNestedObject(payload, 'page');
    const summary = readNestedObject(payload, 'summary');
    const pageObjectSnapshot = summarizeReadPageSnapshot(
      readNestedObject(payload, 'pageObjectSnapshot'),
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
    const existingPageObject = this.browserObjects?.getByIdentity({
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

    const pageObject = this.upsertBrowserObject({
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
      currentState: this.sanitizeBrowserObjectValue({
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
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
    });

    this.recordReadPageChildObjects({
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

  private recordCollectedResultCardObjects(
    trace: MemoryTrace,
    payload: Record<string, unknown>,
    observedAt: string,
    browserContextKey: string | null,
  ): void {
    const page = readNestedObject(payload, 'page');
    const urlFields = normalizeUrlPattern(readString(page?.url, payload.url, payload.pageUrl), {
      allowPersonalBrowserStateStorage: false,
    });
    const siteFamily = urlFields.siteFamily ?? trace.siteFamily ?? 'unknown';
    const pageRole =
      normalizePageRoleForMemory(readString(payload.pageRole, trace.pageRole)) ?? 'search_results';
    const pageModelKey = trace.pageModelKey ?? `page:${siteFamily}:${pageRole}`;
    const tabId = readNumber(payload.tabId, trace.tabId);
    const sourceRoute = readString(
      payload.sourceRoute,
      trace.sourceRoute,
      'result_card_collection',
    );
    const selectedDataSource = readString(
      payload.selectedDataSource,
      trace.selectedDataSource,
      payload.kind,
    );
    const cards = readArray(payload.cards);
    const observedResultCount = readNumber(payload.observedResultCount) ?? cards.length;
    const complete = readBoolean(payload.complete);
    const filterState = readObject(payload.filterState);
    const computedTargetabilitySummary = (() => {
      let stableClickTargetCount = 0;
      let urlFallbackCount = 0;
      let untargetableCount = 0;
      for (const rawCard of cards) {
        const card = readObject(rawCard);
        if (!card) continue;
        const rawActionTarget = readObject(card.actionTarget);
        if (readResultCardStableTarget({ card, rawActionTarget })) {
          stableClickTargetCount += 1;
        } else if (readString(card.url)) {
          urlFallbackCount += 1;
        } else {
          untargetableCount += 1;
        }
      }
      const cardCount = stableClickTargetCount + urlFallbackCount + untargetableCount;
      const targetRefCoverageRate =
        cardCount > 0 ? Number((stableClickTargetCount / cardCount).toFixed(4)) : 0;
      return {
        stableClickTargetCount,
        urlFallbackCount,
        untargetableCount,
        targetRefCoverageRate,
        status:
          cardCount > 0 && stableClickTargetCount === cardCount
            ? 'stable_target_set'
            : stableClickTargetCount > 0
              ? 'partial_stable_targets'
              : 'url_or_text_only',
      };
    })();
    const payloadTargetabilitySummary = readObject(payload.targetabilitySummary);
    const targetabilitySummary = payloadTargetabilitySummary ?? computedTargetabilitySummary;
    const targetRefCoverageRate =
      readFiniteNumber(payload.targetRefCoverageRate, targetabilitySummary.targetRefCoverageRate) ??
      computedTargetabilitySummary.targetRefCoverageRate;
    const collectionWindow = summarizeResultCardCollectionWindow(cards);
    const blockedSurface =
      stringHasBlockedPageSignal(urlFields.rootRoute) ||
      stringHasBlockedPageSignal(urlFields.currentRoute) ||
      stringHasBlockedPageSignal(urlFields.pattern) ||
      stringHasBlockedPageSignal(readString(payload.status, payload.pageState, trace.pageState)) ||
      valueHasBlockedPageSignal(payload);
    const canTabrixOperate = blockedSurface ? false : true;
    const pageIdentityRoute = pageObjectIdentityRoute(
      urlFields.rootRoute,
      trace.pageUrlPattern,
      urlFields.pattern,
    );

    const pageObject = this.upsertBrowserObject({
      siteFamily,
      pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageRole,
      pageModelKey,
      objectFingerprint: objectFingerprint('page', siteFamily, pageModelKey, pageIdentityRoute),
      objectType: 'page',
      browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
      tabId,
      windowId: readNumber(payload.windowId, trace.windowId),
      sourceRoute,
      selectedDataSource,
      sourceFreshness: readString(payload.freshness, trace.freshness),
      lifecycleState: blockedSurface
        ? 'restricted'
        : readString(payload.pageState, trace.pageState, 'observed'),
      canTabrixOperate,
      operabilityReason: blockedSurface ? 'user_verification_required' : null,
      facts: this.sanitizeBrowserObjectValue({
        observedResultCount,
        requestedMinResults: readNumber(payload.requestedMinResults),
        complete,
        status: readString(payload.status),
        targetRefCoverageRate,
        targetabilitySummary,
        ...(collectionWindow ? { collectionWindow } : {}),
        filterState,
        source: 'result_card_collection',
        pageTitle: readString(page?.title),
        host: siteFamily,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lastObservedTabId: tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
      }),
      currentState: this.sanitizeBrowserObjectValue({
        tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
        titleSummary: readString(page?.title),
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lifecycleState: blockedSurface
          ? 'restricted'
          : readString(payload.pageState, trace.pageState, 'observed'),
        canTabrixOperate,
        ...(collectionWindow ? { collectionWindow } : {}),
      }),
      primaryConclusion:
        observedResultCount > 0 ? `识别到 ${observedResultCount} 个结果卡片` : '未识别到结果卡片',
      claimBoundary: readString(payload.claimBoundary),
      confidenceScore: observedResultCount > 0 ? 0.8 : 0.3,
      firstTraceId: trace.traceId,
      lastTraceId: trace.traceId,
      sourceTraceIds: sourceTraceIds(trace),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: observedAt,
    });

    this.recordReadPageChildObjects({
      trace,
      payload,
      observedAt,
      browserContextKey,
      siteFamily,
      rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
      currentRoute: urlFields.currentRoute,
      pageModelKey,
      pageRole,
      tabId,
    });

    for (const [index, rawCard] of cards.slice(0, 80).entries()) {
      const card = readObject(rawCard);
      if (!card) continue;
      const rank = readNumber(card.rank) ?? index + 1;
      const title = readString(card.title);
      if (!title) continue;
      const cardUrlFields = normalizeUrlPattern(readString(card.url), {
        allowPersonalBrowserStateStorage: false,
      });
      const rawActionTarget = readObject(card.actionTarget);
      const stableTarget = readResultCardStableTarget({ card, rawActionTarget });
      const hasExecutableResultCardClick =
        stableTarget !== null &&
        readString(rawActionTarget?.toolName) === 'chrome_click_element' &&
        Boolean(readObject(readObject(rawActionTarget?.toolArgs)?.candidateAction));
      const actionTargetUrlFields = normalizeUrlPattern(readString(rawActionTarget?.url), {
        allowPersonalBrowserStateStorage: false,
      });
      const actionTarget = rawActionTarget
        ? {
            actionType: readString(rawActionTarget.actionType),
            targetKind: readString(rawActionTarget.targetKind),
            executionScope: readString(rawActionTarget.executionScope),
            url:
              actionTargetUrlFields.rootRoute ??
              actionTargetUrlFields.currentRoute ??
              actionTargetUrlFields.pattern,
            ...normalizeResultCardOpenAction(rawActionTarget),
            confidence: readFiniteNumber(rawActionTarget.confidence),
            reasons: readArray(rawActionTarget.reasons).filter(
              (item): item is string => typeof item === 'string',
            ),
          }
        : null;
      const sessionOnlyTarget = rawActionTarget
        ? {
            schema: 'tabrix_session_only_result_card_target_v1',
            selector: readString(rawActionTarget.selector),
            text: readString(rawActionTarget.text),
            ...normalizeResultCardActionToolArgs(rawActionTarget),
            rect: readObject(rawActionTarget.rect),
            center: readObject(rawActionTarget.center),
            cardRect: readObject(card.rect),
            coordinateFrame: readString(rawActionTarget.coordinateFrame),
            sourceScrollY: readNumber(rawActionTarget.sourceScrollY, card.sourceScrollY),
          }
        : readObject(card.rect)
          ? {
              schema: 'tabrix_session_only_result_card_target_v1',
              cardRect: readObject(card.rect),
              sourceScrollY: readNumber(card.sourceScrollY),
            }
          : null;
      const sourceWindow = summarizeResultCardSourceWindow(card, rawActionTarget);
      const actionTypes = [
        hasExecutableResultCardClick ? 'click_result_card' : null,
        readString(card.url) ? 'open_via_url' : null,
      ].filter((item): item is string => Boolean(item));
      const targetabilityStatus = stableTarget
        ? 'stable_click_target'
        : readString(card.url)
          ? 'url_fallback'
          : 'not_targetable';
      const cardRouteKey =
        cardUrlFields.pattern ?? cardUrlFields.rootRoute ?? cardUrlFields.currentRoute;
      const cardTitleKey = title.trim().replace(/\s+/g, ' ').slice(0, 160);
      const cardIdentityKey = cardRouteKey
        ? objectFingerprint(cardRouteKey, cardTitleKey || `rank:${rank}`)
        : objectFingerprint(
            cardTitleKey || 'untitled_result_card',
            stableTarget?.targetRef ?? `rank:${rank}`,
          );
      this.upsertBrowserObject({
        siteFamily,
        pageUrlPattern: urlFields.pattern ?? trace.pageUrlPattern,
        rootRoute: urlFields.rootRoute ?? trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        pageRole,
        pageModelKey,
        objectFingerprint: objectFingerprint(
          'result_card',
          pageModelKey,
          pageIdentityRoute,
          cardIdentityKey,
        ),
        objectType: 'result_card',
        parentObjectId: pageObject?.browserObjectId ?? null,
        browserContextKey: browserContextKey ?? trace.browserContextKey ?? null,
        tabId,
        windowId: readNumber(payload.windowId, trace.windowId),
        sourceRoute,
        selectedDataSource,
        sourceFreshness: readString(payload.freshness, trace.freshness),
        lifecycleState: 'observed',
        canTabrixOperate: actionTypes.length > 0,
        actionTypes,
        targetability: this.sanitizeBrowserObjectValue({
          rank,
          url: cardUrlFields.rootRoute ?? cardUrlFields.pattern,
          targetabilityStatus,
          stableTarget,
          actionTarget,
          sessionOnlyTarget,
          ...(sourceWindow ? { sourceWindow } : {}),
        }),
        facts: this.sanitizeBrowserObjectValue({
          rank,
          title,
          url: cardUrlFields.rootRoute ?? cardUrlFields.pattern,
          targetabilityStatus,
          stableTarget,
          primaryText: readString(card.primaryText),
          secondaryText: readString(card.secondaryText),
          metaText: readString(card.metaText),
          interactionText: readString(card.interactionText),
          imageCount: readNumber(card.imageCount),
          actionTarget,
          sessionOnlyTarget,
          ...(sourceWindow ? { sourceWindow } : {}),
          reasons: readArray(card.reasons).filter(
            (item): item is string => typeof item === 'string',
          ),
          sourceStrategy: readString(card.sourceStrategy),
        }),
        primaryConclusion: title,
        claimBoundary: readString(payload.claimBoundary),
        confidenceScore: readFiniteNumber(card.confidence),
        firstTraceId: trace.traceId,
        lastTraceId: trace.traceId,
        sourceTraceIds: sourceTraceIds(trace),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: observedAt,
      });
    }
  }

  private recordReadPageDataSourceObject(input: {
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
    if (!isApiLikeDataSource(selectedDataSource, sourceRoute, endpointFamily)) return;

    const sourceKey = selectedDataSource ?? endpointFamily ?? sourceRoute ?? 'api';
    const pageIdentityRoute = pageObjectIdentityRoute(input.rootRoute, input.trace.pageUrlPattern);
    this.upsertBrowserObject({
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
      facts: this.sanitizeBrowserObjectValue({
        selectedDataSource,
        sourceRoute,
        endpointFamily,
        payloadKind: readString(input.payload.kind),
        sourcePrimaryOrigin: readString(
          readNestedObject(projection, 'sourceTruthChain')?.primaryOrigin,
        ),
      }),
      claimBoundary: null,
      confidenceScore: null,
      firstTraceId: input.trace.traceId,
      lastTraceId: input.trace.traceId,
      sourceTraceIds: sourceTraceIds(input.trace),
      redactionState: this.browserObjectRedactionState(),
      updatedAt: input.observedAt,
    });
  }

  private recordReadPageChildObjects(input: {
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
    this.recordReadPageDataSourceObject(input);
    const pageIdentityRoute = pageObjectIdentityRoute(input.rootRoute, input.trace.pageUrlPattern);
    const snapshot = readNestedObject(input.payload, 'pageObjectSnapshot');
    const regionInputs = readArray(input.payload.pageRegions);
    const regions =
      regionInputs.length > 0 ? regionInputs : buildReadPageRegionFallbacksFromSnapshot(snapshot);
    const actionInputs = readArray(input.payload.candidateActions);
    const actions =
      actionInputs.length > 0 ? actionInputs : buildReadPageActionFallbacksFromSnapshot(snapshot);

    for (const [index, rawRegion] of regions.slice(0, 40).entries()) {
      const region = readObject(rawRegion);
      if (!region) continue;
      const regionId = readString(region.regionId, region.id) ?? `region-${index}`;
      this.upsertBrowserObject({
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
        sourceRoute: readString(input.payload.sourceRoute, input.trace.sourceRoute),
        sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
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
        redactionState: this.browserObjectRedactionState(),
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
        const childBrowserObject = this.upsertBrowserObject({
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
          sourceRoute: readString(input.payload.sourceRoute, input.trace.sourceRoute),
          sourceFreshness: readString(
            child.freshness,
            input.payload.freshness,
            input.trace.freshness,
          ),
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
              sourceProvenance: readArray(child.sourceProvenance),
              reason: readString(child.reason),
            },
            'browser_object',
          ),
          claimBoundary: readString(child.claimBoundary),
          confidenceScore: readNumber(child.confidence),
          firstTraceId: input.trace.traceId,
          lastTraceId: input.trace.traceId,
          sourceTraceIds: sourceTraceIds(input.trace),
          redactionState: this.browserObjectRedactionState(),
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
      const targetIdentityKey = actionTargetIdentityKey({
        action,
        targetRef,
        fallbackIndex: index,
      });
      this.upsertBrowserObject({
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
        sourceRoute: readString(input.payload.sourceRoute, input.trace.sourceRoute),
        sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
        lifecycleState: 'observed',
        canTabrixOperate: readActionabilityBoolean(action.actionability),
        operabilityReason: readString(action.actionabilityReason),
        targetability: sanitizeValue(
          {
            targetRef,
            frameId: readString(action.frameId),
            identityKey: targetIdentityKey,
            nextRequiredTool: readString(action.nextRequiredTool),
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
            matchReason: readString(action.matchReason),
          },
          'browser_object',
        ),
        claimBoundary: null,
        confidenceScore: null,
        firstTraceId: input.trace.traceId,
        lastTraceId: input.trace.traceId,
        sourceTraceIds: sourceTraceIds(input.trace),
        redactionState: this.browserObjectRedactionState(),
        updatedAt: input.observedAt,
      });
    }
  }

  public recordAiBusinessFeedback(
    input: RecordMkeAiBusinessFeedbackInput,
  ): MemoryTrace | undefined {
    const trace = this.repo.get(input.traceId);
    if (!trace) return undefined;
    const traceBindingHash = ensureFeedbackBinding(input, trace);
    const confidence = normalizeConfidence(input.confidence);
    const evaluationScope = normalizeAiFeedbackScope(input.evaluationScope);
    const experienceReady =
      input.businessStatus === 'achieved' &&
      typeof confidence === 'number' &&
      confidence >= 0.9 &&
      typeof input.summary === 'string' &&
      input.summary.trim().length >= 8;
    const receivedAt = input.receivedAt ?? new Date().toISOString();
    validateAiFeedbackQuality({
      businessStatus: input.businessStatus,
      confidence,
      summary: input.summary,
    });

    const feedback = sanitizeValue(
      {
        sourceKind: 'ai_feedback',
        evaluationScope,
        businessStatus: input.businessStatus,
        confidence,
        reasonCode: input.reasonCode ?? null,
        summary: input.summary ?? null,
        binding: {
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          toolCallId: trace.toolCallId,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash,
        },
        receivedAt,
        sourceToolName: input.sourceToolName ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
      },
      'tabrix_ai_business_feedback',
    ) as Record<string, unknown>;

    const acceptedFeedbackTokens = new Set([
      traceBindingHash,
      input.traceBindingHash,
      buildLegacyMemoryTraceBindingHash(trace),
      buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: 'unknown' }),
      buildLegacyMemoryTraceBindingHash({ ...trace, businessSuccess: null }),
    ]);
    const duplicateFeedback = this.repo.listFeedbackEventsByTrace(trace.traceId).find((event) => {
      return (
        event.accepted === true &&
        acceptedFeedbackTokens.has(event.traceBindingHash) &&
        event.evaluationScope === evaluationScope &&
        event.businessStatus === input.businessStatus &&
        event.confidence === confidence &&
        event.reasonCode === (input.reasonCode ?? null) &&
        event.summary === (input.summary ?? null)
      );
    });
    if (duplicateFeedback) {
      return this.repo.updateAiFeedback({
        traceId: input.traceId,
        aiFeedbackScore: confidence,
        aiFeedback: feedback,
        businessSuccess: input.businessStatus,
      });
    }

    const result = this.repo.recordAiFeedback({
      traceId: input.traceId,
      aiFeedbackScore: confidence,
      aiFeedback: feedback,
      businessSuccess: input.businessStatus,
      feedbackEvent: {
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash,
        evaluationScope,
        evaluationVersion: DEFAULT_AI_FEEDBACK_EVALUATION_VERSION,
        rubricVersion: DEFAULT_AI_FEEDBACK_RUBRIC_VERSION,
        evaluatorModel: null,
        businessStatus: input.businessStatus,
        confidence,
        reasonCode: input.reasonCode ?? null,
        summary: input.summary ?? null,
        userGoalSnapshot: null,
        experienceCandidate: experienceReady,
        sourceToolName: input.sourceToolName ?? null,
        sourceToolCallId: input.sourceToolCallId ?? null,
        accepted: true,
        payload: feedback,
        createdAt: receivedAt,
      },
    });
    return result.trace;
  }

  public get(traceId: string): MemoryTrace | undefined {
    return this.repo.get(traceId);
  }

  public listByTask(taskId: string): MemoryTrace[] {
    return this.repo.listByTask(taskId);
  }

  public count(): number {
    return this.repo.count();
  }

  public clear(): void {
    this.repo.clear();
  }
}
