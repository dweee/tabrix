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
import { recordBrowserWorldObjects } from './mke-memory-browser-world-object-projection';
import {
  normalizeUrlPattern,
  parseFirstTextPayload,
  sanitizeResultSummaryForMemory,
  sanitizeValue,
} from './mke-memory-sanitizer';
import { summarizeCollectedResultCardForTrace } from './mke-memory-result-card-projection';
import { recordCollectedResultCardBrowserObjects } from './mke-memory-result-card-object-projection';
import {
  normalizeOwnerType,
  normalizePageRoleForMemory,
  objectFingerprint,
  pageObjectIdentityRoute,
  sourceTraceIds,
} from './mke-memory-object-identity';
import { buildReadPageDataSourceObjectInput } from './mke-memory-read-page-data-source-projection';
import { recordReadPageRegionAndActionObjects } from './mke-memory-read-page-child-projection';
import {
  buildPageObjectEvidenceRefs,
  buildPageObjectRecentEvents,
  mergeReadPageFactsWithExistingCollectionFacts,
  summarizeReadPageSnapshot,
  summarizeReadPageUnifiedDelta,
} from './mke-memory-read-page-object-projection';
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
        recordBrowserWorldObjects({
          trace: projectionTrace,
          payload,
          observedAt,
          browserContextKey: projectionTrace.browserContextKey ?? null,
          redactionState: this.browserObjectRedactionState(),
          upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
        });
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
          recordBrowserWorldObjects({
            trace: input.trace,
            payload,
            observedAt: input.observedAt,
            browserContextKey: input.browserContextKey,
            redactionState: this.browserObjectRedactionState(),
            upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
          });
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
          recordCollectedResultCardBrowserObjects({
            trace: input.trace,
            payload,
            observedAt: input.observedAt,
            browserContextKey: input.browserContextKey,
            redactionState: this.browserObjectRedactionState(),
            upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
          });
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
    const objectInput = buildReadPageDataSourceObjectInput({
      ...input,
      redactionState: this.browserObjectRedactionState(),
    });
    if (objectInput) this.upsertBrowserObject(objectInput);
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
    recordReadPageRegionAndActionObjects({
      ...input,
      redactionState: this.browserObjectRedactionState(),
      upsertBrowserObject: (objectInput) => this.upsertBrowserObject(objectInput),
    });
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
