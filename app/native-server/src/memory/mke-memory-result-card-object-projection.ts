import type { BrowserObject, BrowserObjectInput, MemoryTrace } from './db';
import { normalizeUrlPattern, sanitizeValue } from './mke-memory-sanitizer';
import {
  normalizeResultCardActionToolArgs,
  normalizeResultCardOpenAction,
  readResultCardStableTarget,
  summarizeResultCardCollectionWindow,
  summarizeResultCardSourceWindow,
} from './mke-memory-result-card-projection';
import {
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
  readArray,
  readBoolean,
  readFiniteNumber,
  readNestedObject,
  readNumber,
  readObject,
  readString,
} from './mke-memory-value-readers';
import { recordReadPageRegionAndActionObjects } from './mke-memory-read-page-child-projection';

export function recordCollectedResultCardBrowserObjects(input: {
  trace: MemoryTrace;
  payload: Record<string, unknown>;
  observedAt: string;
  browserContextKey: string | null;
  redactionState: string;
  upsertBrowserObject: (objectInput: BrowserObjectInput) => BrowserObject | undefined;
}): void {
  const page = readNestedObject(input.payload, 'page');
  const urlFields = normalizeUrlPattern(
    readString(page?.url, input.payload.url, input.payload.pageUrl),
    {
      allowPersonalBrowserStateStorage: false,
    },
  );
  const siteFamily = urlFields.siteFamily ?? input.trace.siteFamily ?? 'unknown';
  const pageRole =
    normalizePageRoleForMemory(readString(input.payload.pageRole, input.trace.pageRole)) ??
    'search_results';
  const pageModelKey = input.trace.pageModelKey ?? `page:${siteFamily}:${pageRole}`;
  const tabId = readNumber(input.payload.tabId, input.trace.tabId);
  const sourceRoute = readString(
    input.payload.sourceRoute,
    input.trace.sourceRoute,
    'result_card_collection',
  );
  const selectedDataSource = readString(
    input.payload.selectedDataSource,
    input.trace.selectedDataSource,
    input.payload.kind,
  );
  const cards = readArray(input.payload.cards);
  const observedResultCount = readNumber(input.payload.observedResultCount) ?? cards.length;
  const complete = readBoolean(input.payload.complete);
  const filterState = readObject(input.payload.filterState);
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
  const payloadTargetabilitySummary = readObject(input.payload.targetabilitySummary);
  const targetabilitySummary = payloadTargetabilitySummary ?? computedTargetabilitySummary;
  const targetRefCoverageRate =
    readFiniteNumber(
      input.payload.targetRefCoverageRate,
      targetabilitySummary.targetRefCoverageRate,
    ) ?? computedTargetabilitySummary.targetRefCoverageRate;
  const collectionWindow = summarizeResultCardCollectionWindow(cards);
  const blockedSurface =
    stringHasBlockedPageSignal(urlFields.rootRoute) ||
    stringHasBlockedPageSignal(urlFields.currentRoute) ||
    stringHasBlockedPageSignal(urlFields.pattern) ||
    stringHasBlockedPageSignal(
      readString(input.payload.status, input.payload.pageState, input.trace.pageState),
    ) ||
    valueHasBlockedPageSignal(input.payload);
  const canTabrixOperate = blockedSurface ? false : true;
  const pageIdentityRoute = pageObjectIdentityRoute(
    urlFields.rootRoute,
    input.trace.pageUrlPattern,
    urlFields.pattern,
  );

  const pageObject = input.upsertBrowserObject({
    siteFamily,
    pageUrlPattern: urlFields.pattern ?? input.trace.pageUrlPattern,
    rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
    currentRoute: urlFields.currentRoute,
    pageRole,
    pageModelKey,
    objectFingerprint: objectFingerprint('page', siteFamily, pageModelKey, pageIdentityRoute),
    objectType: 'page',
    browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
    tabId,
    windowId: readNumber(input.payload.windowId, input.trace.windowId),
    sourceRoute,
    selectedDataSource,
    sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
    lifecycleState: blockedSurface
      ? 'restricted'
      : readString(input.payload.pageState, input.trace.pageState, 'observed'),
    canTabrixOperate,
    operabilityReason: blockedSurface ? 'user_verification_required' : null,
    facts: sanitizeValue(
      {
        observedResultCount,
        requestedMinResults: readNumber(input.payload.requestedMinResults),
        complete,
        status: readString(input.payload.status),
        targetRefCoverageRate,
        targetabilitySummary,
        ...(collectionWindow ? { collectionWindow } : {}),
        filterState,
        source: 'result_card_collection',
        pageTitle: readString(page?.title),
        host: siteFamily,
        rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lastObservedTabId: tabId,
        windowId: readNumber(input.payload.windowId, input.trace.windowId),
      },
      'browser_object',
    ),
    currentState: sanitizeValue(
      {
        tabId,
        windowId: readNumber(input.payload.windowId, input.trace.windowId),
        titleSummary: readString(page?.title),
        rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
        currentRoute: urlFields.currentRoute,
        lifecycleState: blockedSurface
          ? 'restricted'
          : readString(input.payload.pageState, input.trace.pageState, 'observed'),
        canTabrixOperate,
        ...(collectionWindow ? { collectionWindow } : {}),
      },
      'browser_object',
    ),
    primaryConclusion:
      observedResultCount > 0 ? `识别到 ${observedResultCount} 个结果卡片` : '未识别到结果卡片',
    claimBoundary: readString(input.payload.claimBoundary),
    confidenceScore: observedResultCount > 0 ? 0.8 : 0.3,
    firstTraceId: input.trace.traceId,
    lastTraceId: input.trace.traceId,
    sourceTraceIds: sourceTraceIds(input.trace),
    redactionState: input.redactionState,
    updatedAt: input.observedAt,
  });

  recordReadPageRegionAndActionObjects({
    trace: input.trace,
    payload: input.payload,
    observedAt: input.observedAt,
    browserContextKey: input.browserContextKey,
    siteFamily,
    rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
    currentRoute: urlFields.currentRoute,
    pageModelKey,
    pageRole,
    tabId,
    redactionState: input.redactionState,
    upsertBrowserObject: input.upsertBrowserObject,
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
    input.upsertBrowserObject({
      siteFamily,
      pageUrlPattern: urlFields.pattern ?? input.trace.pageUrlPattern,
      rootRoute: urlFields.rootRoute ?? input.trace.pageUrlPattern,
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
      browserContextKey: input.browserContextKey ?? input.trace.browserContextKey ?? null,
      tabId,
      windowId: readNumber(input.payload.windowId, input.trace.windowId),
      sourceRoute,
      selectedDataSource,
      sourceFreshness: readString(input.payload.freshness, input.trace.freshness),
      lifecycleState: 'observed',
      canTabrixOperate: actionTypes.length > 0,
      actionTypes,
      targetability: sanitizeValue(
        {
          rank,
          url: cardUrlFields.rootRoute ?? cardUrlFields.pattern,
          targetabilityStatus,
          stableTarget,
          actionTarget,
          sessionOnlyTarget,
          ...(sourceWindow ? { sourceWindow } : {}),
        },
        'browser_object',
      ),
      facts: sanitizeValue(
        {
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
        },
        'browser_object',
      ),
      primaryConclusion: title,
      claimBoundary: readString(input.payload.claimBoundary),
      confidenceScore: readFiniteNumber(card.confidence),
      firstTraceId: input.trace.traceId,
      lastTraceId: input.trace.traceId,
      sourceTraceIds: sourceTraceIds(input.trace),
      redactionState: input.redactionState,
      updatedAt: input.observedAt,
    });
  }
}
