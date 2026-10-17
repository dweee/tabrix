import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { BusinessSuccessVerdict } from './db';
import { normalizePageRoleForMemory } from './mke-memory-object-identity';
import {
  stringHasBlockedPageSignal,
  valueHasBlockedPageSignal,
} from './mke-memory-page-state-signals';
import {
  summarizeReadPageSensingDiagnostics,
  summarizeReadPageSnapshot,
  summarizeReadPageUnifiedDelta,
} from './mke-memory-read-page-object-projection';
import { summarizeCollectedResultCardForTrace } from './mke-memory-result-card-projection';
import { normalizeUrlPattern, parseFirstTextPayload, sanitizeValue } from './mke-memory-sanitizer';
import {
  readArray,
  readBoolean,
  readFiniteNumber,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';

export interface ParsedResultDigest {
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

export function digestResult(
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
    const sensingDiagnosticsSummary = summarizeReadPageSensingDiagnostics(
      readNestedObject(readNestedObject(payload, 'pageContext'), 'sensingDiagnostics'),
    );
    const deltaSummary = summarizeReadPageUnifiedDelta(payload);
    return {
      perceptionObjects: snapshotSummary,
      actionTarget: summarizeCandidateActions(readArray(payload.candidateActions)),
      preObservation: null,
      postObservation:
        snapshotSummary || sensingDiagnosticsSummary
          ? sanitizeValue(
              {
                ...(snapshotSummary ?? {}),
                ...(sensingDiagnosticsSummary ? { sensingDiagnosticsSummary } : {}),
              },
              'memory_trace',
            )
          : null,
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
