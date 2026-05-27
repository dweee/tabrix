import type {
  ReadPageBrowserPageObjectAttributeGroup,
  ReadPageBrowserPageObjectCompactView,
  ReadPageBrowserPageObjectGroupState,
  ReadPageBrowserPageObjectWatchSummary,
  ReadPageBrowserPageObjectView,
  ReadPageBrowserPageSemanticEvent,
  ReadPageBrowserPageSemanticEventType,
  ReadPageObjectLifecycleChange,
  ReadPageObjectLifecycleFamily,
  ReadPageObjectLifecycleItem,
  ReadPageObjectLifecycleSummary,
  ReadPageOperationMap,
  ReadPageOwnershipRuntimeSummary,
  ReadPageRegion,
  ReadPageRegionType,
  ReadPageSelectedDataSource,
  ReadPageWindowRuntimeState,
} from './read-page-contract';
import type { BrowserPageThingProjection } from './browser-task-thing-contract';

const BROWSER_PAGE_OBJECT_BOUNDARY =
  'BrowserPageObjectView is a derived AI-facing projection over read_page facts. It groups visible page state and semantic lifecycle candidates; it is not an execution authority, not proof of login/logout/business completion, and not API/CDP proof.';

const CANDIDATE_BOUNDARY =
  'Semantic event is a candidate derived from visible page/object lifecycle evidence. It requires task postcondition verification before any completion claim.';

const DYNAMIC_ATTRIBUTE_BOUNDARY =
  'Dynamic attribute summary is a condensed watch-loop projection over read_page snapshots. It is candidate evidence only and still requires action postcondition verification before any completion claim.';

export interface BuildReadPageBrowserPageObjectViewInput {
  pageRegions?: readonly ReadPageRegion[] | null;
  pageOperationMap?: ReadPageOperationMap | null;
  objectLifecycle: ReadPageObjectLifecycleSummary;
  previousPageProjection?: BrowserPageThingProjection | null;
  pageProjection?: BrowserPageThingProjection | null;
  previousOwnershipRuntime?: ReadPageOwnershipRuntimeSummary | null;
  ownershipRuntime?: ReadPageOwnershipRuntimeSummary | null;
  selectedDataSource?: ReadPageSelectedDataSource | null;
  sourceRouteHonestyVerdict?: string | null;
}

export function buildReadPageBrowserPageObjectView(
  input: BuildReadPageBrowserPageObjectViewInput,
): ReadPageBrowserPageObjectView {
  const pageRegions = input.pageRegions ?? [];
  const lifecycle = input.objectLifecycle;
  const semanticEvents = buildSemanticEvents(lifecycle, pageRegions);
  const attributeGroups: Record<
    ReadPageBrowserPageObjectAttributeGroup,
    ReadPageBrowserPageObjectGroupState
  > = {
    identity: buildIdentityGroup(input.pageProjection),
    window_state: buildWindowStateGroup(input.ownershipRuntime),
    tab_state: buildTabStateGroup(input.pageProjection, input.ownershipRuntime),
    page_state: buildPageStateGroup(input.pageProjection),
    visual_reliability: buildVisualReliabilityGroup(input.ownershipRuntime),
    runtime_state: buildRuntimeStateGroup(input),
    layout_regions: buildLayoutRegionsGroup(pageRegions),
    menu_state: buildMenuStateGroup(lifecycle, pageRegions),
    auth_state: buildFamilyGroup('auth_state', lifecycle, ['auth_surface', 'account_identity']),
    qr_state: buildQrStateGroup(lifecycle),
    content_state: buildContentStateGroup(lifecycle),
    action_state: buildActionStateGroup(input.pageOperationMap, input.pageProjection, pageRegions),
    evidence_state: buildEvidenceStateGroup(input),
    task_relation: buildTaskRelationGroup(lifecycle, semanticEvents),
  };

  const view: ReadPageBrowserPageObjectView = {
    source: 'read_page_browser_page_object',
    rootObjectId: buildRootObjectId(input.pageProjection),
    status: lifecycle.status,
    attributeGroups,
    semanticEvents,
    dynamicAttributeSummary: buildDynamicAttributeSummary(
      lifecycle,
      semanticEvents,
      attributeGroups,
      input.previousPageProjection,
      input.pageProjection,
      input.previousOwnershipRuntime,
      input.ownershipRuntime,
    ),
    rawLifecycleStats: {
      status: lifecycle.status,
      objectCount: lifecycle.objectCount,
      changedObjectCount: lifecycle.changedObjectCount,
    },
    claimBoundary: BROWSER_PAGE_OBJECT_BOUNDARY,
  };
  return {
    ...view,
    compact: buildReadPageBrowserPageObjectCompactView(view),
  };
}

export function buildReadPageBrowserPageObjectCompactView(
  view: ReadPageBrowserPageObjectView,
): ReadPageBrowserPageObjectCompactView {
  const watch = view.dynamicAttributeSummary;
  return {
    source: 'read_page_browser_page_object_compact',
    rootObjectId: view.rootObjectId,
    status: view.status,
    watchStatus: watch?.status ?? 'stable_or_unknown',
    primaryConclusion:
      watch?.primaryConclusion ??
      view.attributeGroups.task_relation?.summary ??
      'No BrowserPageObject conclusion is available.',
    changedGroups: watch?.changedGroups ?? [],
    transitionCount: watch?.transitionCount ?? 0,
    facts: {
      window: pickCompactFacts(view.attributeGroups.window_state?.facts, [
        'objectKind',
        'exists',
        'currentWindowId',
        'readTargetTabId',
        'currentActiveTabId',
        'browserActiveTabId',
        'browserActiveTabIdKnown',
        'isReadTargetBrowserActiveTab',
        'currentWindowState',
        'isFocused',
        'isMinimized',
        'isVisible',
        'width',
        'height',
        'left',
        'top',
        'heartbeatTabCount',
        'heartbeatWindowCount',
      ]),
      tab: pickCompactFacts(view.attributeGroups.tab_state?.facts, [
        'objectKind',
        'readTargetTabId',
        'currentTabId',
        'currentTabUrl',
        'currentTabPendingUrl',
        'currentTabTitle',
        'currentTabStatus',
        'currentTabDiscarded',
        'currentTabAudible',
        'currentTabMuted',
        'currentTabPinned',
        'currentTabOpenerTabId',
        'primaryRunTabId',
        'primaryTabId',
        'browserActiveTabId',
        'isReadTargetTabActive',
        'isReadTargetBrowserActiveTab',
        'isActive',
        'ownerType',
        'openedBy',
        'openedByConfidence',
        'openedByReason',
        'cleanupEligibility',
        'canTabrixOperate',
        'operabilityReason',
        'aiOperationState',
        'lastAiOperation',
        'lastAiOperationAtMs',
        'lastAiOperationConfidence',
        'lastAiOperationReason',
        'runtimeStateSource',
        'protectedScopeVerdict',
        'currentTabRunOwnershipVerdict',
        'readTargetPrimaryRelationVerdict',
        'currentTabPrimaryRelationVerdict',
        'isRunOwnedByTask',
        'runOwnedTabCount',
      ]),
      page: pickCompactFacts(view.attributeGroups.page_state?.facts, [
        'objectKind',
        'pageId',
        'tabId',
        'readiness',
        'stability',
        'sourceFreshness',
        'activeRegion',
        'selectedDataSource',
        'sourceConfidence',
      ]),
      visualReliability: pickCompactFacts(view.attributeGroups.visual_reliability?.facts, [
        'objectKind',
        'isCurrentWindowFocused',
        'isReadTargetTabActive',
        'isCurrentTabActive',
        'isWindowMinimized',
        'visualReliabilityCandidate',
        'degraded',
        'degradationReasons',
      ]),
    },
    operationSummary: view.attributeGroups.action_state?.summary,
    evidenceSummary: view.attributeGroups.evidence_state?.summary,
    claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
  };
}

function pickCompactFacts(
  facts: Record<string, string | number | boolean | null | string[] | number[]> | undefined,
  keys: readonly string[],
): Record<string, string | number | boolean | null | string[] | number[]> | undefined {
  if (!facts) return undefined;
  const result: Record<string, string | number | boolean | null | string[] | number[]> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(facts, key)) {
      result[key] = facts[key] ?? null;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildSemanticEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
  pageRegions: readonly ReadPageRegion[],
): ReadPageBrowserPageSemanticEvent[] {
  const events: ReadPageBrowserPageSemanticEvent[] = [];
  events.push(...buildMenuEvents(lifecycle, pageRegions));
  events.push(...buildQrEvents(lifecycle));
  events.push(...buildAuthEvents(lifecycle));
  events.push(...buildFormEvents(lifecycle));
  events.push(...buildContentEvents(lifecycle));

  if (
    lifecycle.status === 'compared_snapshot' &&
    lifecycle.changedObjectCount > 0 &&
    events.length === 0
  ) {
    const noTargetSummary = buildNoTargetTransitionSummary(lifecycle.changes);
    events.push(
      semanticEvent({
        eventType: 'unknown_or_noise',
        targetGroup: 'task_relation',
        summary: noTargetSummary,
        confidence: 0.35,
        evidenceRefs: changedEvidenceRefs(lifecycle.changes),
      }),
    );
  }

  return events;
}

function buildMenuEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
  pageRegions: readonly ReadPageRegion[],
): ReadPageBrowserPageSemanticEvent[] {
  if (lifecycle.status !== 'compared_snapshot') return [];
  const menuChanges = changesForFamilies(lifecycle, ['menu_surface', 'menu_item']);
  const appearedMenuActions = menuChanges.filter(
    (change) => change.changeKind === 'appeared' && change.objectFamily === 'menu_item',
  );
  const expandedState = menuChanges.find((change) => looksExpanded(change.afterState));
  if (appearedMenuActions.length === 0 && !expandedState) return [];
  const menuFacts = collectSafeMenuFacts(pageRegions);
  const currentEntries =
    menuFacts.labels.length > 0
      ? ` Current visible entries: ${menuFacts.labels.join(', ')}${menuFacts.truncatedCount > 0 ? ` (+${menuFacts.truncatedCount} more)` : ''}.`
      : '';

  return [
    semanticEvent({
      eventType: 'menu_expanded',
      targetGroup: 'menu_state',
      targetObjectFamily: 'menu_surface',
      beforeState: expandedState?.beforeState,
      afterState: expandedState?.afterState ?? 'action_items_visible_candidate',
      summary:
        appearedMenuActions.length > 0
          ? `Menu expanded candidate: ${appearedMenuActions.length} menu action(s) appeared.${currentEntries}`
          : `Menu expanded candidate: menu state changed to an expanded/action-available state.${currentEntries}`,
      confidence: appearedMenuActions.length > 0 ? 0.78 : 0.65,
      evidenceRefs: changedEvidenceRefs(menuChanges),
    }),
  ];
}

function buildFormEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageSemanticEvent[] {
  if (lifecycle.status !== 'compared_snapshot') return [];
  const formChanges = changesForFamilies(lifecycle, ['form_control']).filter(
    (change) => change.changeKind !== 'unchanged',
  );
  if (formChanges.length === 0) return [];
  const resultLikeChanges = lifecycle.changes.filter(
    (change) =>
      change.changeKind !== 'unchanged' &&
      (change.objectFamily === 'content_collection' || change.objectFamily === 'feedback_surface'),
  );
  if (resultLikeChanges.length === 0) {
    return [
      semanticEvent({
        eventType: 'content_changed',
        targetGroup: 'action_state',
        targetObjectFamily: 'form_control',
        summary:
          `${formChanges.length} form/search control change(s) were observed, but no result, content, or feedback transition was visible; ` +
          'form/search outcome is not proven.',
        confidence: 0.55,
        evidenceRefs: changedEvidenceRefs(formChanges),
        postconditionStatus: 'unknown',
      }),
    ];
  }
  return [
    semanticEvent({
      eventType: 'content_changed',
      targetGroup: 'action_state',
      targetObjectFamily: 'form_control',
      summary:
        `${formChanges.length} form/search control change(s) were observed after the action; ` +
        `${resultLikeChanges.length} result/content/feedback change(s) were also visible; ` +
        'treat this as candidate submission-state evidence, not task completion proof.',
      confidence: 0.7,
      evidenceRefs: changedEvidenceRefs([...formChanges, ...resultLikeChanges]),
    }),
  ];
}

function buildQrEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageSemanticEvent[] {
  const events: ReadPageBrowserPageSemanticEvent[] = [];
  if (!hasActiveAuthContext(lifecycle)) return events;

  const qrItems = lifecycle.items.filter(isAuthScopedQrItem);
  const expired = qrItems.find((item) => isQrExpiredState(item.state));
  if (expired) {
    events.push(
      semanticEvent({
        eventType: 'qr_expired_candidate',
        targetGroup: 'qr_state',
        targetObjectFamily: 'qr_code',
        afterState: expired.state,
        summary:
          'QR/auth object appears expired or refreshable; login cannot continue without QR refresh or user action. In unattended runs mark BLOCKED_USER_INTERACTION_REQUIRED if no safe refresh action is available.',
        confidence: expired.confidence,
        evidenceRefs: expired.evidenceRefs,
      }),
    );
  }
  const waiting = qrItems.find((item) => /wait|scan|qr|refresh/i.test(item.state));
  if (waiting && !expired) {
    events.push(
      semanticEvent({
        eventType: 'qr_waiting',
        targetGroup: 'qr_state',
        targetObjectFamily: 'qr_code',
        afterState: waiting.state,
        summary:
          'QR/auth object is visible and waiting for user action candidate; unattended runs must report BLOCKED_USER_INTERACTION_REQUIRED instead of waiting indefinitely.',
        confidence: waiting.confidence,
        evidenceRefs: waiting.evidenceRefs,
      }),
    );
  }

  if (lifecycle.status === 'compared_snapshot') {
    const refreshed = lifecycle.changes
      .filter(isAuthScopedQrChange)
      .find((change) => change.changeKind === 'changed');
    if (refreshed) {
      events.push(
        semanticEvent({
          eventType: 'qr_refreshed',
          targetGroup: 'qr_state',
          targetObjectFamily: 'qr_code',
          beforeState: refreshed.beforeState,
          afterState: refreshed.afterState,
          summary:
            'QR object changed candidate; treat as refresh/change evidence, not login success.',
          confidence: 0.72,
          evidenceRefs: [refreshed.objectKey],
        }),
      );
    }
  }

  return events;
}

function buildAuthEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageSemanticEvent[] {
  if (lifecycle.status !== 'compared_snapshot') return [];
  const changes = changesForFamilies(lifecycle, ['auth_surface', 'account_identity', 'qr_code']);
  const authDisappeared = changes.some(
    (change) =>
      (change.objectFamily === 'auth_surface' || change.objectFamily === 'qr_code') &&
      change.changeKind === 'disappeared',
  );
  const accountAppearedOrLoggedIn = changes.some(
    (change) =>
      change.objectFamily === 'account_identity' &&
      (change.changeKind === 'appeared' || looksLoggedIn(change.afterState)),
  );
  const loggedInAccountDisappeared = changes.some(
    (change) =>
      change.objectFamily === 'account_identity' &&
      change.changeKind === 'disappeared' &&
      looksLoggedIn(change.beforeState),
  );

  const events: ReadPageBrowserPageSemanticEvent[] = [];
  if (authDisappeared && accountAppearedOrLoggedIn) {
    events.push(
      semanticEvent({
        eventType: 'auth_succeeded_candidate',
        targetGroup: 'auth_state',
        targetObjectFamily: 'account_identity',
        summary:
          'Authentication success candidate: auth/QR prompt disappeared and account state appeared or changed.',
        confidence: 0.74,
        evidenceRefs: changedEvidenceRefs(changes),
      }),
    );
  }
  if (loggedInAccountDisappeared) {
    events.push(
      semanticEvent({
        eventType: 'logout_succeeded_candidate',
        targetGroup: 'auth_state',
        targetObjectFamily: 'account_identity',
        summary:
          'Logout success candidate: logged-in account state disappeared or auth prompt appeared.',
        confidence: 0.62,
        evidenceRefs: changedEvidenceRefs(changes),
      }),
    );
  }
  return events;
}

function buildContentEvents(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageSemanticEvent[] {
  if (lifecycle.status !== 'compared_snapshot') return [];
  const contentChanges = changesForFamilies(lifecycle, ['content_collection']).filter(
    (change) => change.changeKind !== 'unchanged',
  );
  if (contentChanges.length === 0) return [];
  return [
    semanticEvent({
      eventType: 'content_changed',
      targetGroup: 'content_state',
      targetObjectFamily: 'content_collection',
      summary: summarizeContentCollectionChange(contentChanges),
      confidence: 0.68,
      evidenceRefs: changedEvidenceRefs(contentChanges),
    }),
  ];
}

function summarizeContentCollectionChange(
  changes: readonly ReadPageObjectLifecycleChange[],
): string {
  const appeared = changes.filter((change) => change.changeKind === 'appeared').length;
  const disappeared = changes.filter((change) => change.changeKind === 'disappeared').length;
  const changed = changes.filter((change) => change.changeKind === 'changed').length;

  if (appeared > 0 && disappeared === 0 && changed === 0) {
    return 'Content/panel reveal candidate: a visible content area appeared after the action; postcondition verification is still required.';
  }
  if (disappeared > 0 && appeared === 0 && changed === 0) {
    return 'Content/panel hide candidate: a visible content area disappeared after the action; postcondition verification is still required.';
  }
  if (appeared > 0 || disappeared > 0) {
    const parts = [
      appeared > 0 ? 'appeared' : null,
      disappeared > 0 ? 'disappeared' : null,
      changed > 0 ? 'changed' : null,
    ].filter((part): part is string => Boolean(part));
    return `Content/panel visibility changed candidate: visible content areas ${parts.join('/')} after the action; postcondition verification is still required.`;
  }
  if (changed > 0) {
    return 'Content area changed candidate: visible content area state changed after the action; postcondition verification is still required.';
  }
  return 'Content area changed candidate: content lifecycle changed after the action; postcondition verification is still required.';
}

function buildIdentityGroup(
  projection: BrowserPageThingProjection | null | undefined,
): ReadPageBrowserPageObjectGroupState {
  const known = Boolean(projection);
  return groupState({
    status: known ? 'known' : 'unknown',
    summary: known
      ? `pageId=${projection?.pageId ?? 'unknown'} owner=${projection?.ownerType ?? 'unknown'}`
      : 'Page identity projection is unavailable.',
    confidence: known ? 0.8 : 0.2,
    evidenceRefs: projection?.projectionId ? [`projection:${projection.projectionId}`] : [],
  });
}

function buildRuntimeStateGroup(
  input: BuildReadPageBrowserPageObjectViewInput,
): ReadPageBrowserPageObjectGroupState {
  const projection = input.pageProjection;
  const status = projection?.readiness ?? 'unknown';
  const stability = projection?.stability ?? 'unknown';
  return groupState({
    status,
    summary: `readiness=${status}; stability=${stability}; selectedDataSource=${input.selectedDataSource ?? 'unknown'}`,
    confidence: projection ? projection.sourceConfidence : 0.3,
    evidenceRefs: projection?.projectionId ? [`projection:${projection.projectionId}`] : [],
  });
}

function buildWindowStateGroup(
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null | undefined,
): ReadPageBrowserPageObjectGroupState {
  if (!ownershipRuntime) {
    return groupState({
      status: 'unknown',
      summary: 'Window state unknown: runtime ownership summary is unavailable.',
      confidence: 0.25,
      evidenceRefs: [],
    });
  }
  const focused = ownershipRuntime.isCurrentWindowFocused;
  const windowKnown = Number.isInteger(ownershipRuntime.currentWindowId);
  const tabCount = ownershipRuntime.heartbeatTabCount;
  const windowCount = ownershipRuntime.heartbeatWindowCount;
  const windowState = ownershipRuntime.currentWindowState ?? 'unknown';
  const browserActiveTabId = ownershipRuntime.browserActiveTabId;
  const browserActiveKnown = ownershipRuntime.browserActiveTabIdKnown === true;
  const readTargetIsBrowserActive = ownershipRuntime.isReadTargetBrowserActiveTab;
  const geometry =
    ownershipRuntime.currentWindowWidth !== null && ownershipRuntime.currentWindowHeight !== null
      ? `${ownershipRuntime.currentWindowWidth}x${ownershipRuntime.currentWindowHeight}`
      : 'unknown size';
  const position =
    ownershipRuntime.currentWindowLeft !== null && ownershipRuntime.currentWindowTop !== null
      ? `${ownershipRuntime.currentWindowLeft},${ownershipRuntime.currentWindowTop}`
      : 'unknown position';
  return groupState({
    status:
      windowState === 'minimized'
        ? 'minimized'
        : focused === true
          ? 'focused'
          : focused === false
            ? 'unfocused'
            : 'unknown',
    summary: `Window state: ${windowKnown ? `window ${ownershipRuntime.currentWindowId}` : 'window unknown'}; state=${windowState}; focus=${formatTriState(focused)}; readTargetTab=${formatNullableNumber(ownershipRuntime.currentTabId)}; browserActiveTab=${browserActiveKnown ? formatNullableNumber(browserActiveTabId) : 'unknown'}; readTargetIsBrowserActive=${formatTriState(readTargetIsBrowserActive)}; size=${geometry}; position=${position}; heartbeat tabs=${formatNullableNumber(tabCount)} windows=${formatNullableNumber(windowCount)}.`,
    facts: {
      objectKind: 'BrowserWindowObject',
      exists: windowKnown,
      currentWindowId: ownershipRuntime.currentWindowId,
      readTargetTabId: ownershipRuntime.currentTabId,
      // Back-compat alias. Prefer readTargetTabId; this is not a browser-active-tab proof.
      currentActiveTabId: ownershipRuntime.currentTabId,
      browserActiveTabId,
      browserActiveTabIdKnown: browserActiveKnown,
      isReadTargetBrowserActiveTab: readTargetIsBrowserActive,
      currentWindowState: ownershipRuntime.currentWindowState ?? null,
      isFocused: focused,
      isMinimized: windowState === 'minimized',
      isVisible: windowKnown ? windowState !== 'minimized' : null,
      width: ownershipRuntime.currentWindowWidth,
      height: ownershipRuntime.currentWindowHeight,
      left: ownershipRuntime.currentWindowLeft,
      top: ownershipRuntime.currentWindowTop,
      heartbeatTabCount: tabCount,
      heartbeatWindowCount: windowCount,
    },
    confidence: windowState !== 'unknown' || focused !== null ? 0.74 : 0.38,
    evidenceRefs: ['ownershipRuntime'],
  });
}

function buildTabStateGroup(
  projection: BrowserPageThingProjection | null | undefined,
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null | undefined,
): ReadPageBrowserPageObjectGroupState {
  const owner = projection?.ownerType ?? ownershipRuntime?.currentOwnerType ?? 'unknown';
  const active = ownershipRuntime?.isCurrentTabActive ?? null;
  const cleanup = ownershipRuntime?.cleanupEligibility ?? 'unknown';
  const protection = ownershipRuntime?.protectedScopeVerdict ?? 'unknown';
  const tabId = ownershipRuntime?.currentTabId ?? projection?.tabId ?? null;
  const primaryTabId = ownershipRuntime?.primaryTabId ?? null;
  const browserActiveTabId = ownershipRuntime?.browserActiveTabId ?? null;
  const readTargetIsBrowserActive = ownershipRuntime?.isReadTargetBrowserActiveTab ?? null;
  const status = ownershipRuntime?.currentTabStatus ?? projection?.stability ?? 'unknown';
  const operability = ownershipRuntime?.currentTabCanTabrixOperate ?? null;
  const aiOperation = ownershipRuntime?.currentTabLastAiOperation ?? null;
  const aiOperationConfidence = ownershipRuntime?.currentTabLastAiOperationConfidence ?? null;
  const aiOperationReason = ownershipRuntime?.currentTabLastAiOperationReason ?? null;
  return groupState({
    status: active === true ? 'active' : active === false ? 'background' : 'unknown',
    summary: `Tab state: readTargetTab=${Number.isInteger(tabId) ? tabId : 'unknown'} is ${active === true ? 'active in its window' : active === false ? 'background/not active in its window' : 'activity unknown'}; status=${status}; browserActiveTab=${ownershipRuntime?.browserActiveTabIdKnown ? formatNullableNumber(browserActiveTabId) : 'unknown'}; readTargetIsBrowserActive=${formatTriState(readTargetIsBrowserActive)}; primaryRunTab=${formatNullableNumber(primaryTabId)}; owner=${owner}; operable=${formatTriState(operability)}; aiOperation=${aiOperation ?? 'none'}; aiOperationConfidence=${aiOperationConfidence ?? 'unknown'}; aiOperationReason=${aiOperationReason ?? 'unknown'}; cleanup=${cleanup}; protection=${protection}.`,
    facts: {
      objectKind: 'BrowserTabObject',
      readTargetTabId: tabId,
      currentTabId: tabId,
      currentTabUrl: ownershipRuntime?.currentTabUrl ?? null,
      currentTabPendingUrl: ownershipRuntime?.currentTabPendingUrl ?? null,
      currentTabTitle: ownershipRuntime?.currentTabTitle ?? null,
      currentTabStatus: ownershipRuntime?.currentTabStatus ?? null,
      currentTabDiscarded: ownershipRuntime?.currentTabDiscarded ?? null,
      currentTabAudible: ownershipRuntime?.currentTabAudible ?? null,
      currentTabMuted: ownershipRuntime?.currentTabMuted ?? null,
      currentTabPinned: ownershipRuntime?.currentTabPinned ?? null,
      currentTabOpenerTabId: ownershipRuntime?.currentTabOpenerTabId ?? null,
      primaryRunTabId: primaryTabId,
      primaryTabId,
      browserActiveTabId,
      isReadTargetTabActive: active,
      isReadTargetBrowserActiveTab: readTargetIsBrowserActive,
      isActive: active,
      ownerType: owner,
      openedBy: ownershipRuntime?.currentTabOpenedBy ?? null,
      openedByConfidence: ownershipRuntime?.currentTabOpenedByConfidence ?? null,
      openedByReason: ownershipRuntime?.currentTabOpenedByReason ?? null,
      cleanupEligibility: cleanup,
      canTabrixOperate: operability,
      operabilityReason: ownershipRuntime?.currentTabOperabilityReason ?? null,
      aiOperationState: ownershipRuntime?.currentTabAiOperationState ?? null,
      lastAiOperation: aiOperation,
      lastAiOperationAtMs: ownershipRuntime?.currentTabLastAiOperationAtMs ?? null,
      lastAiOperationConfidence: aiOperationConfidence,
      lastAiOperationReason: aiOperationReason,
      runtimeStateSource: ownershipRuntime?.currentTabRuntimeStateSource ?? 'unknown',
      protectedScopeVerdict: protection,
      currentTabRunOwnershipVerdict: ownershipRuntime?.currentTabRunOwnershipVerdict ?? null,
      readTargetPrimaryRelationVerdict: ownershipRuntime?.currentTabPrimaryRelationVerdict ?? null,
      currentTabPrimaryRelationVerdict: ownershipRuntime?.currentTabPrimaryRelationVerdict ?? null,
      isRunOwnedByTask: ownershipRuntime?.isCurrentTabRunOwnedByTask ?? null,
      runOwnedTabCount: ownershipRuntime?.runOwnedTabCount ?? null,
      runOwnedTabIds: ownershipRuntime?.runOwnedTabIds ?? [],
    },
    confidence: ownershipRuntime ? 0.74 : 0.38,
    evidenceRefs: [
      ...(projection?.projectionId ? [`projection:${projection.projectionId}`] : []),
      ...(ownershipRuntime ? ['ownershipRuntime'] : []),
    ],
  });
}

function buildPageStateGroup(
  projection: BrowserPageThingProjection | null | undefined,
): ReadPageBrowserPageObjectGroupState {
  const readiness = projection?.readiness ?? 'unknown';
  const stability = projection?.stability ?? 'unknown';
  const freshness = projection?.sourceFreshness ?? 'unknown';
  return groupState({
    status: readiness,
    summary: `Page state: readiness=${readiness}; stability=${stability}; sourceFreshness=${freshness}; contextVersion=${projection?.contextVersion ?? 'unknown'}.`,
    facts: {
      objectKind: 'BrowserPageObject',
      pageId: projection?.pageId ?? null,
      tabId: projection?.tabId ?? null,
      readiness,
      stability,
      sourceFreshness: freshness,
      activeRegion: projection?.activeRegion ?? null,
      contextVersion: projection?.contextVersion ?? null,
      contextChars: projection?.contextChars ?? null,
      contextSavedChars: projection?.contextSavedChars ?? null,
      selectedDataSource: projection?.chosenDataSource ?? null,
      sourceConfidence: projection?.sourceConfidence ?? null,
      userActivityLevel: projection?.userActivityLevel ?? null,
      interferenceRisk: projection?.interferenceRisk ?? null,
    },
    confidence: projection ? projection.sourceConfidence : 0.3,
    evidenceRefs: projection?.projectionId ? [`projection:${projection.projectionId}`] : [],
  });
}

function buildVisualReliabilityGroup(
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null | undefined,
): ReadPageBrowserPageObjectGroupState {
  if (!ownershipRuntime) {
    return groupState({
      status: 'unknown',
      summary:
        'Visual reliability unknown: window focus and tab activity are unavailable; do not claim screenshot proof.',
      confidence: 0.25,
      evidenceRefs: [],
    });
  }
  const focused = ownershipRuntime.isCurrentWindowFocused;
  const active = ownershipRuntime.isCurrentTabActive;
  const minimized = ownershipRuntime.currentWindowState === 'minimized';
  const reliable = focused === true && active === true && !minimized;
  const degraded = focused === false || active === false || minimized;
  const degradationReasons = collectVisualReliabilityReasons({
    focused,
    active,
    windowState: ownershipRuntime.currentWindowState ?? null,
    minimized,
    degraded,
  });
  return groupState({
    status: reliable ? 'candidate_reliable' : degraded ? 'degraded' : 'unknown',
    summary: reliable
      ? 'Visual reliability candidate: current window is focused and read target tab is active in its window; screenshot evidence still requires fresh capture.'
      : degraded
        ? `Visual reliability degraded: reasons=${formatListSummary(degradationReasons)}; windowState=${ownershipRuntime.currentWindowState ?? 'unknown'} focus=${formatTriState(focused)} readTargetTabActive=${formatTriState(active)}; do not claim reliable visual proof.`
        : `Visual reliability unknown: reasons=${formatListSummary(degradationReasons)}; focus or tab activity is unavailable; do not claim reliable visual proof.`,
    facts: {
      objectKind: 'BrowserVisualReliability',
      isCurrentWindowFocused: focused,
      isReadTargetTabActive: active,
      isCurrentTabActive: active,
      currentWindowState: ownershipRuntime.currentWindowState ?? null,
      isWindowMinimized: minimized,
      visualReliabilityCandidate: reliable,
      degraded,
      degradationReasons,
      claimScreenshotProofAllowed: false,
    },
    confidence: reliable ? 0.72 : degraded ? 0.68 : 0.35,
    evidenceRefs: ['ownershipRuntime'],
  });
}

function collectVisualReliabilityReasons(input: {
  focused: boolean | null;
  active: boolean | null;
  windowState: ReadPageWindowRuntimeState | null;
  minimized: boolean;
  degraded: boolean;
}): string[] {
  const reasons: string[] = [];
  if (input.minimized) reasons.push('window_minimized');
  if (input.focused === false) reasons.push('window_unfocused');
  if (input.active === false) reasons.push('read_target_tab_inactive');
  if (input.focused === null) reasons.push('window_focus_unknown');
  if (input.active === null) reasons.push('read_target_tab_activity_unknown');
  if (!input.windowState || input.windowState === 'unknown') reasons.push('window_state_unknown');
  if (reasons.length === 0 && input.degraded) reasons.push('visual_runtime_degraded_unknown');
  return reasons;
}

function buildLayoutRegionsGroup(
  pageRegions: readonly ReadPageRegion[],
): ReadPageBrowserPageObjectGroupState {
  const regionTypes = [...new Set(pageRegions.map((region) => region.regionType))].sort();
  return groupState({
    status: regionTypes.length > 0 ? 'regions_visible_candidate' : 'unknown',
    summary:
      regionTypes.length > 0
        ? `${pageRegions.length} region candidate(s): ${regionTypes.join(', ')}`
        : 'No page region candidates are available.',
    confidence: averageConfidence(pageRegions),
    evidenceRefs: pageRegions.map((region) => region.regionId),
  });
}

function buildFamilyGroup(
  group: ReadPageBrowserPageObjectAttributeGroup,
  lifecycle: ReadPageObjectLifecycleSummary,
  families: readonly ReadPageObjectLifecycleFamily[],
): ReadPageBrowserPageObjectGroupState {
  const items = lifecycle.items.filter((item) => families.includes(item.objectFamily));
  const changes = lifecycle.changes.filter((change) => families.includes(change.objectFamily));
  const changedCount = changes.filter((change) => change.changeKind !== 'unchanged').length;
  const status =
    items.length === 0 ? 'unknown' : changedCount > 0 ? 'changed_candidate' : 'visible_candidate';
  return groupState({
    status,
    summary: `${group}: ${items.length} object candidate(s), ${changedCount} changed candidate(s).`,
    confidence: averageConfidence(items),
    evidenceRefs: [...items.flatMap((item) => item.evidenceRefs), ...changedEvidenceRefs(changes)],
  });
}

function buildMenuStateGroup(
  lifecycle: ReadPageObjectLifecycleSummary,
  pageRegions: readonly ReadPageRegion[],
): ReadPageBrowserPageObjectGroupState {
  const families: ReadPageObjectLifecycleFamily[] = ['menu_surface', 'menu_item'];
  const items = lifecycle.items.filter((item) => families.includes(item.objectFamily));
  const changes = lifecycle.changes.filter((change) => families.includes(change.objectFamily));
  const changedCount = changes.filter((change) => change.changeKind !== 'unchanged').length;
  const actionableCount = items.filter(
    (item) => isTargetable(item.targetability) || item.actionTypes.length > 0,
  ).length;
  const menuSurfaceCount = items.filter((item) => item.objectFamily === 'menu_surface').length;
  const menuFacts = collectSafeMenuFacts(pageRegions);
  const labelsSummary =
    menuFacts.labels.length > 0
      ? ` Visible entries: ${menuFacts.labels.join(', ')}${menuFacts.truncatedCount > 0 ? ` (+${menuFacts.truncatedCount} more)` : ''}.`
      : '';
  const layoutSummary =
    menuFacts.layoutHints.length > 0 ? ` Layout: ${menuFacts.layoutHints.join(', ')}.` : '';
  const status =
    items.length === 0 ? 'unknown' : changedCount > 0 ? 'changed_candidate' : 'visible_candidate';
  const summary =
    items.length === 0
      ? 'No menu or navigation surface is visible from this snapshot.'
      : changedCount > 0
        ? `Menu/navigation changed candidate: ${changedCount} visible menu/navigation change(s); ${actionableCount} targetable action candidate(s) remain.${labelsSummary}${layoutSummary}`
        : `Menu/navigation visible: ${actionableCount} targetable action candidate(s); ${menuSurfaceCount > 0 ? 'menu surface is present' : 'navigation entries are present'}.${labelsSummary}${layoutSummary}`;
  return groupState({
    status,
    summary,
    confidence: averageConfidence(items),
    evidenceRefs: [...items.flatMap((item) => item.evidenceRefs), ...changedEvidenceRefs(changes)],
  });
}

function collectSafeMenuFacts(pageRegions: readonly ReadPageRegion[]): {
  labels: string[];
  layoutHints: string[];
  truncatedCount: number;
} {
  const labels: string[] = [];
  const layoutHints = new Set<string>();
  let candidateCount = 0;

  for (const region of pageRegions) {
    if (!isMenuLikeRegion(region)) continue;
    if (region.layoutHint) layoutHints.add(region.layoutHint);
    for (const object of region.objects) {
      if (!isSafeVisibleMenuObject(object)) continue;
      candidateCount += 1;
      const label = sanitizeVisibleMenuLabel(object.label);
      if (!label || labels.includes(label)) continue;
      if (labels.length < 8) labels.push(label);
    }
  }

  return {
    labels,
    layoutHints: [...layoutHints].slice(0, 4),
    truncatedCount: Math.max(0, candidateCount - labels.length),
  };
}

function isMenuLikeRegion(region: ReadPageRegion): boolean {
  return region.regionType === 'navigation' || region.regionType === 'menu';
}

function isSafeVisibleMenuObject(object: ReadPageRegion['objects'][number]): boolean {
  if (object.menuItemRole === 'account_entry' || object.menuItemRole === 'auth_entry') return false;
  if (object.objectType === 'identity_badge') return false;
  if (object.objectType === 'qr_visual') return false;
  if (!isTargetable(object.targetability) && object.actionTypes.length === 0) return false;
  return Boolean(sanitizeVisibleMenuLabel(object.label));
}

function sanitizeVisibleMenuLabel(label: string): string | null {
  const normalized = String(label || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  if (normalized.length > 28) return null;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(normalized)) return null;
  if (/https?:\/\//i.test(normalized)) return null;
  if (/\b\d{3,}[-\s]?\d{3,}[-\s]?\d{3,}\b/.test(normalized)) return null;
  if (/^@[A-Za-z0-9_.-]{2,30}$/.test(normalized)) return null;
  if (/^[\d\s,._+-]+$/.test(normalized)) return null;
  if (/^[A-Za-z0-9_-]{18,}$/.test(normalized)) return null;
  return normalized;
}

function buildContentStateGroup(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageObjectGroupState {
  const items = lifecycle.items.filter((item) => item.objectFamily === 'content_collection');
  const changes = lifecycle.changes.filter(
    (change) => change.objectFamily === 'content_collection',
  );
  const changedCount = changes.filter((change) => change.changeKind !== 'unchanged').length;
  const status =
    items.length === 0 ? 'unknown' : changedCount > 0 ? 'changed_candidate' : 'visible_candidate';
  const summary =
    items.length === 0
      ? 'No main content candidate is visible from this snapshot.'
      : changedCount > 0
        ? `Content changed candidate: ${changedCount} visible content change(s) were observed; re-read before claiming task completion.`
        : 'Content visible: readable content candidates are present in the current snapshot.';
  return groupState({
    status,
    summary,
    confidence: averageConfidence(items),
    evidenceRefs: [...items.flatMap((item) => item.evidenceRefs), ...changedEvidenceRefs(changes)],
  });
}

function buildQrStateGroup(
  lifecycle: ReadPageObjectLifecycleSummary,
): ReadPageBrowserPageObjectGroupState {
  const authScopedQrItems = lifecycle.items.filter(isAuthScopedQrItem);
  const authScopedQrChanges = lifecycle.changes.filter(isAuthScopedQrChange);
  const changedCount = authScopedQrChanges.filter(
    (change) => change.changeKind !== 'unchanged',
  ).length;
  const expired = authScopedQrItems.find((item) => isQrExpiredState(item.state));
  const waiting = authScopedQrItems.find((item) => /wait|scan|qr|refresh/i.test(item.state));
  const staleInvalidated =
    lifecycle.status === 'compared_snapshot' &&
    authScopedQrChanges.some((change) => change.changeKind === 'disappeared') &&
    lifecycle.items.some(
      (item) => item.objectFamily === 'account_identity' && looksLoggedIn(item.state),
    );

  if (staleInvalidated) {
    return groupState({
      status: 'stale_invalidated',
      summary:
        'qr_state: prior auth QR disappeared and account state is visible; do not treat content QR images as login QR.',
      confidence: 0.72,
      evidenceRefs: changedEvidenceRefs(authScopedQrChanges),
    });
  }

  if (authScopedQrItems.length === 0) {
    const contentOnlyQr = lifecycle.items.some(
      (item) =>
        item.regionType === 'content' &&
        (item.objectType ? /qr/i.test(item.objectType) : /qr/i.test(item.state)),
    );
    return groupState({
      status: contentOnlyQr ? 'not_applicable_content_qr_only' : 'not_applicable',
      summary: contentOnlyQr
        ? 'qr_state: QR-like content exists outside an active auth surface; it belongs to content_state, not auth QR.'
        : 'qr_state: no active auth QR candidate is visible.',
      confidence: contentOnlyQr ? 0.68 : 0.55,
      evidenceRefs: contentOnlyQr ? ['objectLifecycle'] : [],
    });
  }

  if (expired) {
    return groupState({
      status: 'expired_or_refresh_needed',
      summary:
        'qr_state: auth-scoped QR appears expired or refreshable; unattended execution must not wait forever and should report BLOCKED_USER_INTERACTION_REQUIRED unless a safe refresh action is available.',
      confidence: expired.confidence,
      evidenceRefs: [...expired.evidenceRefs, ...changedEvidenceRefs(authScopedQrChanges)],
    });
  }

  if (waiting) {
    return groupState({
      status: changedCount > 0 ? 'waiting_user_action_changed' : 'waiting_user_action',
      summary:
        'qr_state: auth-scoped QR is waiting for user action; unattended execution should monitor for change and report BLOCKED_USER_INTERACTION_REQUIRED if no safe automatic path exists.',
      confidence: averageConfidence(authScopedQrItems),
      evidenceRefs: [
        ...authScopedQrItems.flatMap((item) => item.evidenceRefs),
        ...changedEvidenceRefs(authScopedQrChanges),
      ],
    });
  }

  return groupState({
    status: changedCount > 0 ? 'changed_candidate' : 'visible_candidate',
    summary: `qr_state: ${authScopedQrItems.length} auth-scoped QR candidate(s), ${changedCount} changed candidate(s).`,
    confidence: averageConfidence(authScopedQrItems),
    evidenceRefs: [
      ...authScopedQrItems.flatMap((item) => item.evidenceRefs),
      ...changedEvidenceRefs(authScopedQrChanges),
    ],
  });
}

function buildActionStateGroup(
  operationMap: ReadPageOperationMap | null | undefined,
  pageProjection: BrowserPageThingProjection | null | undefined,
  pageRegions: readonly ReadPageRegion[] = [],
): ReadPageBrowserPageObjectGroupState {
  const zones = operationMap?.zones ?? [];
  const readyZones = zones.filter((zone) => zone.readiness === 'ready');
  const blockedZones = zones.filter(
    (zone) => zone.readiness === 'blocked' || zone.readiness === 'not_targetable',
  );
  const needsExpandZones = zones.filter((zone) => zone.readiness === 'needs_expand');
  const readyPurposes = dedupeStrings(readyZones.map((zone) => zone.purpose)).slice(0, 6);
  const linkedActionId = normalizeActionId(pageProjection?.changedByActionId);
  const linkedChangeCause =
    pageProjection?.changeCause && pageProjection.changeCause !== 'unknown'
      ? pageProjection.changeCause
      : null;
  const linkedTargetRefs = collectLinkedTargetRefs(pageProjection?.invalidatedRefs);
  const linkedTargetDescriptions = describeLinkedTargetRefs(linkedTargetRefs, pageRegions);
  const linkedTargetSummary = formatLinkedTargetSummary(linkedTargetRefs, linkedTargetDescriptions);
  const operationSummary =
    zones.length === 0
      ? 'No operation map zones are available.'
      : readyZones.length > 0
        ? `Ready operation purposes: ${readyPurposes.join(', ')}. ${needsExpandZones.length} need expansion; ${blockedZones.length} blocked or not targetable.`
        : `Operation zones observed, but no ready action zone is proven. ${needsExpandZones.length} need expansion; ${blockedZones.length} blocked or not targetable.`;
  const actionLinkSummary =
    linkedActionId || linkedChangeCause
      ? formatActionLinkSummary(linkedActionId, linkedChangeCause, linkedTargetSummary)
      : '';
  const summary = `${operationSummary}${actionLinkSummary}`;
  return groupState({
    status:
      linkedActionId || linkedChangeCause
        ? 'action_linkage_candidate'
        : zones.length > 0
          ? 'operation_zones_available'
          : 'unknown',
    summary,
    facts: {
      lastActionId: linkedActionId,
      lastChangeCause: linkedChangeCause,
      lastTargetRefs: linkedTargetRefs,
      lastTargetRoles: linkedTargetDescriptions.map((target) => target.description),
      readyZoneCount: readyZones.length,
      needsExpandZoneCount: needsExpandZones.length,
      blockedZoneCount: blockedZones.length,
    },
    confidence: zones.length > 0 ? 0.7 : 0.25,
    evidenceRefs: [
      ...zones.map((zone) => zone.zoneId),
      ...(linkedActionId || linkedChangeCause ? ['pageProjection.changedByActionId'] : []),
      ...linkedTargetRefs,
    ],
  });
}

function normalizeActionId(value: string | null | undefined): string | null {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function collectLinkedTargetRefs(values: readonly string[] | null | undefined): string[] {
  if (!values) return [];
  return values
    .filter((value) => /^[A-Za-z0-9:_-]{1,96}$/.test(value))
    .filter((value) => value !== 'interaction_may_change_page')
    .slice(0, 3);
}

function formatActionLinkSummary(
  linkedActionId: string | null,
  linkedChangeCause: string | null,
  linkedTargetSummary: string,
): string {
  if (linkedChangeCause) {
    return ` Last action linkage candidate: ${linkedActionId ?? 'unknown action'} caused ${linkedChangeCause}${linkedTargetSummary}; verify postcondition before claiming success.`;
  }
  return ` Last action linkage candidate: ${linkedActionId ?? 'unknown action'} attempted${linkedTargetSummary}; no verified page-change cause was proven; verify postcondition before claiming success.`;
}

function describeLinkedTargetRefs(
  targetRefs: readonly string[],
  pageRegions: readonly ReadPageRegion[],
): Array<{ ref: string; description: string }> {
  if (targetRefs.length === 0 || pageRegions.length === 0) return [];
  const descriptions: Array<{ ref: string; description: string }> = [];
  for (const targetRef of targetRefs) {
    const match = findRegionObjectByRef(targetRef, pageRegions);
    const description = match ? describeRegionObjectRole(match.region, match.object) : null;
    if (!description) continue;
    descriptions.push({ ref: targetRef, description });
  }
  return descriptions;
}

function findRegionObjectByRef(
  targetRef: string,
  pageRegions: readonly ReadPageRegion[],
): { region: ReadPageRegion; object: ReadPageRegion['objects'][number] } | null {
  for (const region of pageRegions) {
    for (const object of region.objects) {
      if (object.objectId === targetRef || object.targetRef === targetRef) {
        return { region, object };
      }
    }
  }
  return null;
}

function describeRegionObjectRole(
  region: ReadPageRegion,
  object: ReadPageRegion['objects'][number],
): string | null {
  switch (object.menuItemRole) {
    case 'primary_navigation':
      return 'primary navigation candidate';
    case 'overflow_menu_trigger':
      return 'menu trigger candidate';
    case 'secondary_menu_action':
      return 'secondary menu action candidate';
    case 'account_entry':
      return 'account entry candidate';
    case 'auth_entry':
      return 'auth entry candidate';
    case 'content_action':
      return 'content action candidate';
    default:
      break;
  }

  switch (object.objectType) {
    case 'identity_badge':
      return 'account identity candidate';
    case 'qr_visual':
      return 'auth QR visual candidate';
    case 'nav_entry':
      return 'navigation target candidate';
    case 'control':
      return describeRegionTypeTarget(region.regionType);
    default:
      return describeRegionTypeTarget(region.regionType);
  }
}

function describeRegionTypeTarget(regionType: ReadPageRegionType): string {
  switch (regionType) {
    case 'navigation':
      return 'navigation target candidate';
    case 'menu':
      return 'menu target candidate';
    case 'account':
      return 'account area candidate';
    case 'modal':
      return 'modal target candidate';
    case 'qr_code':
      return 'auth QR area candidate';
    case 'form':
      return 'form target candidate';
    case 'feedback':
      return 'feedback target candidate';
    case 'content':
      return 'content target candidate';
    default:
      return 'page target candidate';
  }
}

function formatLinkedTargetSummary(
  targetRefs: readonly string[],
  targetDescriptions: readonly { ref: string; description: string }[],
): string {
  if (targetRefs.length === 0) return '';
  const descriptionsByRef = new Map(
    targetDescriptions.map((target) => [target.ref, target.description] as const),
  );
  const formattedTargets = targetRefs.map((targetRef) => {
    const description = descriptionsByRef.get(targetRef);
    return description ? `${targetRef} (${description})` : targetRef;
  });
  return ` on target ${formattedTargets.join(', ')}`;
}

function buildEvidenceStateGroup(
  input: BuildReadPageBrowserPageObjectViewInput,
): ReadPageBrowserPageObjectGroupState {
  const verdict = input.sourceRouteHonestyVerdict ?? 'unknown';
  return groupState({
    status: verdict,
    summary: `sourceRouteHonesty=${verdict}; lifecycle=${input.objectLifecycle.status}; dom_fallback_or_unknown_must_not_be_treated_as_api_cdp_proof.`,
    confidence: verdict === 'unknown' ? 0.35 : 0.65,
    evidenceRefs: ['objectLifecycle', 'sourceRouteHonesty'],
  });
}

function buildTaskRelationGroup(
  lifecycle: ReadPageObjectLifecycleSummary,
  semanticEvents: readonly ReadPageBrowserPageSemanticEvent[],
): ReadPageBrowserPageObjectGroupState {
  const status =
    semanticEvents.length > 0
      ? 'semantic_events_available'
      : lifecycle.status === 'compared_snapshot'
        ? 'compared_without_target_event'
        : 'single_snapshot_only';
  return groupState({
    status,
    summary: buildTaskRelationSummary(lifecycle, semanticEvents),
    confidence: semanticEvents.length > 0 ? 0.72 : 0.4,
    evidenceRefs: semanticEvents.flatMap((event) => event.evidenceRefs),
  });
}

function buildTaskRelationSummary(
  lifecycle: ReadPageObjectLifecycleSummary,
  semanticEvents: readonly ReadPageBrowserPageSemanticEvent[],
): string {
  if (semanticEvents.length > 0) {
    const primary = selectPrimarySemanticEvent(semanticEvents);
    return `${primary.summary} (${semanticEvents.length} semantic event(s); ${formatChangedAreaSentence(lifecycle.changes)} candidate-only.)`;
  }
  if (lifecycle.status === 'compared_snapshot') {
    return `No AI-usable target-state transition was proven. ${formatChangedAreaSentence(lifecycle.changes)}`;
  }
  return 'Single snapshot only; fresh before/after reads are required for transition claims.';
}

function buildDynamicAttributeSummary(
  lifecycle: ReadPageObjectLifecycleSummary,
  semanticEvents: readonly ReadPageBrowserPageSemanticEvent[],
  attributeGroups: Record<
    ReadPageBrowserPageObjectAttributeGroup,
    ReadPageBrowserPageObjectGroupState
  >,
  previousPageProjection: BrowserPageThingProjection | null | undefined,
  pageProjection: BrowserPageThingProjection | null | undefined,
  previousOwnershipRuntime: ReadPageOwnershipRuntimeSummary | null | undefined,
  ownershipRuntime: ReadPageOwnershipRuntimeSummary | null | undefined,
): ReadPageBrowserPageObjectWatchSummary {
  const degradedGroups = collectRuntimeDegradedGroups(attributeGroups);
  const pageTransitions = buildPageProjectionTransitions(previousPageProjection, pageProjection);
  const pageTransitionGroups = dedupeAttributeGroups(
    pageTransitions.flatMap((transition) => transition.groups),
  );
  const runtimeTransitions = buildRuntimeTransitions(previousOwnershipRuntime, ownershipRuntime);
  const runtimeTransitionGroups = dedupeAttributeGroups(
    runtimeTransitions.flatMap((transition) => transition.groups),
  );
  const primaryEvent =
    semanticEvents.length > 0 ? selectPrimarySemanticEvent(semanticEvents) : null;

  if (primaryEvent && primaryEvent.eventType !== 'unknown_or_noise') {
    const changedGroups = dedupeAttributeGroups([
      primaryEvent.targetGroup,
      ...semanticEvents.map((event) => event.targetGroup),
      ...pageTransitionGroups,
      ...runtimeTransitionGroups,
      ...degradedGroups,
    ]);
    const pageSummary =
      pageTransitions.length > 0
        ? `Page changed: ${pageTransitions.map((transition) => transition.summary).join('; ')}. `
        : '';
    const runtimeSummary =
      runtimeTransitions.length > 0
        ? `Runtime changed: ${runtimeTransitions.map((transition) => transition.summary).join('; ')}. `
        : '';
    const actionLinkedConclusion = buildActionLinkedSemanticConclusion(
      primaryEvent,
      attributeGroups.action_state,
    );
    const primaryConclusion =
      actionLinkedConclusion ?? buildSemanticPrimaryConclusion(primaryEvent);
    return {
      status: 'semantic_transition_candidate',
      primaryConclusion,
      summary:
        `${actionLinkedConclusion ? `${actionLinkedConclusion} ` : ''}` +
        `${primaryEvent.summary} ` +
        `Changed groups: ${changedGroups.join(', ')}. ` +
        pageSummary +
        runtimeSummary +
        `${degradedGroups.length > 0 ? 'Runtime visibility is degraded; keep this as candidate evidence only. ' : ''}` +
        'Postcondition verification is still required.',
      changedGroups,
      transitionCount: semanticEvents.length + pageTransitions.length + runtimeTransitions.length,
      confidence: primaryEvent.confidence,
      evidenceRefs: dedupePublicRefs([
        ...semanticEvents.flatMap((event) => event.evidenceRefs),
        ...(pageTransitions.length > 0 ? ['pageProjection'] : []),
        ...(runtimeTransitions.length > 0 ? ['ownershipRuntime'] : []),
      ]),
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  if (pageTransitions.length > 0) {
    const changedGroups = dedupeAttributeGroups([
      ...pageTransitionGroups,
      ...runtimeTransitionGroups,
      ...degradedGroups,
    ]);
    const runtimeSummary =
      runtimeTransitions.length > 0
        ? ` Runtime changed: ${runtimeTransitions.map((transition) => transition.summary).join('; ')}.`
        : '';
    return {
      status: 'page_transition_candidate',
      primaryConclusion: buildPageTransitionPrimaryConclusion(pageTransitions),
      summary:
        `Page state changed: ${pageTransitions.map((transition) => transition.summary).join('; ')}.` +
        runtimeSummary +
        ` Changed groups: ${changedGroups.join(', ')}. ` +
        `${degradedGroups.length > 0 ? 'Runtime visibility is degraded; keep this as candidate evidence only.' : 'Use postcondition verification before treating this as task success.'}`,
      changedGroups,
      transitionCount: pageTransitions.length + runtimeTransitions.length,
      confidence: degradedGroups.length > 0 ? 0.62 : 0.7,
      evidenceRefs: dedupePublicRefs([
        'pageProjection',
        ...(runtimeTransitions.length > 0 ? ['ownershipRuntime'] : []),
      ]),
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  if (runtimeTransitions.length > 0) {
    const changedGroups = dedupeAttributeGroups([...runtimeTransitionGroups, ...degradedGroups]);
    return {
      status: 'runtime_transition_candidate',
      primaryConclusion: `Runtime state changed: ${runtimeTransitions[0]?.summary ?? 'state changed'}.`,
      summary:
        `Runtime state changed: ${runtimeTransitions.map((transition) => transition.summary).join('; ')}. ` +
        `Changed groups: ${changedGroups.join(', ')}. ` +
        `${degradedGroups.length > 0 ? 'Runtime visibility is degraded; keep this as candidate evidence only.' : 'Use a fresh read before relying on visual/page-state proof.'}`,
      changedGroups,
      transitionCount: runtimeTransitions.length,
      confidence: degradedGroups.length > 0 ? 0.62 : 0.68,
      evidenceRefs: ['ownershipRuntime'],
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  if (degradedGroups.length > 0) {
    return {
      status: 'runtime_degraded',
      primaryConclusion: `Runtime visibility degraded in ${degradedGroups.join(', ')}.`,
      summary:
        `Runtime visibility degraded in ${degradedGroups.join(', ')}; ` +
        'do not treat visual or page-state observations as reliable proof until a fresh observable read passes.',
      changedGroups: degradedGroups,
      transitionCount: 0,
      confidence: 0.62,
      evidenceRefs: dedupePublicRefs(
        degradedGroups.flatMap((group) => attributeGroups[group].evidenceRefs),
      ),
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  if (lifecycle.status === 'single_snapshot') {
    const currentSnapshotConclusion = buildSingleSnapshotCurrentPageConclusion(attributeGroups);
    return {
      status: 'single_snapshot_only',
      primaryConclusion: currentSnapshotConclusion,
      summary: `Single snapshot only: ${currentSnapshotConclusion}`,
      changedGroups: [],
      transitionCount: 0,
      confidence: 0.45,
      evidenceRefs: ['objectLifecycle'],
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  if (lifecycle.changedObjectCount > 0) {
    const noTargetSummary = buildNoTargetTransitionSummary(lifecycle.changes);
    const changedGroups = dedupeAttributeGroups([
      'task_relation',
      ...changedAreaAttributeGroups(lifecycle.changes),
    ]);
    return {
      status: 'changed_without_target_transition',
      primaryConclusion: noTargetSummary,
      summary:
        `${noTargetSummary} ` +
        'The change did not condense into a target-state transition such as menu opened, auth changed, QR refreshed, or content changed.',
      changedGroups,
      transitionCount: lifecycle.changedObjectCount,
      confidence: 0.38,
      evidenceRefs: changedEvidenceRefs(lifecycle.changes),
      claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
    };
  }

  return {
    status: 'stable_or_unknown',
    primaryConclusion: 'No relevant BrowserPageObject dynamic attribute transition is visible.',
    summary:
      'No relevant BrowserPageObject dynamic attribute transition is visible from the compared snapshots.',
    changedGroups: [],
    transitionCount: 0,
    confidence: 0.42,
    evidenceRefs: ['objectLifecycle'],
    claimBoundary: DYNAMIC_ATTRIBUTE_BOUNDARY,
  };
}

function buildSingleSnapshotCurrentPageConclusion(
  attributeGroups: Record<
    ReadPageBrowserPageObjectAttributeGroup,
    ReadPageBrowserPageObjectGroupState
  >,
): string {
  const highlights = [
    singleSnapshotTabPageObjectSummary(
      attributeGroups.window_state,
      attributeGroups.tab_state,
      attributeGroups.page_state,
    ),
    singleSnapshotGroupSummary(attributeGroups.menu_state),
    singleSnapshotGroupSummary(attributeGroups.auth_state),
    singleSnapshotGroupSummary(attributeGroups.qr_state),
    singleSnapshotGroupSummary(attributeGroups.content_state),
    singleSnapshotActionSummary(attributeGroups.action_state),
    singleSnapshotRuntimeWarning(attributeGroups.visual_reliability),
  ].filter((summary): summary is string => Boolean(summary));

  if (highlights.length === 0) {
    return 'Current BrowserPageObject snapshot is visible, but no AI-usable page area or action summary is available yet. No before/after dynamic transition is proven.';
  }

  return `Current BrowserPageObject snapshot: ${highlights.slice(0, 6).join(' ')} No before/after dynamic transition is proven.`;
}

function singleSnapshotTabPageObjectSummary(
  windowGroup: ReadPageBrowserPageObjectGroupState | undefined,
  tabGroup: ReadPageBrowserPageObjectGroupState | undefined,
  pageGroup: ReadPageBrowserPageObjectGroupState | undefined,
): string | null {
  const windowFacts = windowGroup?.facts;
  const tabFacts = tabGroup?.facts;
  const pageFacts = pageGroup?.facts;
  if (!windowFacts && !tabFacts && !pageFacts) return null;

  const tabId =
    readNumberFact(tabFacts, 'readTargetTabId') ?? readNumberFact(tabFacts, 'currentTabId');
  const active =
    readBooleanFact(tabFacts, 'isReadTargetTabActive') ?? readBooleanFact(tabFacts, 'isActive');
  const browserActive = readBooleanFact(tabFacts, 'isReadTargetBrowserActiveTab');
  const owner = readStringFact(tabFacts, 'ownerType') ?? 'unknown';
  const openedBy = readStringFact(tabFacts, 'openedBy') ?? 'unknown';
  const operable = readBooleanFact(tabFacts, 'canTabrixOperate');
  const windowState = readStringFact(windowFacts, 'currentWindowState') ?? 'unknown';
  const focused = readBooleanFact(windowFacts, 'isFocused');
  const readiness = readStringFact(pageFacts, 'readiness') ?? 'unknown';
  const stability = readStringFact(pageFacts, 'stability') ?? 'unknown';
  const runtimeSource = readStringFact(tabFacts, 'runtimeStateSource') ?? 'unknown';
  const selectedDataSource = readStringFact(pageFacts, 'selectedDataSource') ?? 'unknown';

  return (
    `One Tab page object: tab=${formatNullableNumber(tabId)}; ` +
    `active=${formatTriState(active)}; browserActive=${formatTriState(browserActive)}; ` +
    `owner=${owner}; openedBy=${openedBy}; operable=${formatTriState(operable)}; ` +
    `window=${windowState}; focused=${formatTriState(focused)}; ` +
    `page=${readiness}/${stability}; runtime=${runtimeSource}; source=${selectedDataSource}.`
  );
}

function singleSnapshotGroupSummary(
  group: ReadPageBrowserPageObjectGroupState | undefined,
): string | null {
  if (!group) return null;
  if (group.status === 'unknown' || group.status === 'not_applicable') return null;
  if (group.status === 'not_applicable_content_qr_only') return group.summary;
  if (!group.summary || /^No /i.test(group.summary)) return null;
  return group.summary;
}

function singleSnapshotActionSummary(
  group: ReadPageBrowserPageObjectGroupState | undefined,
): string | null {
  if (!group || group.status !== 'operation_zones_available') return null;
  if (!group.summary || group.summary === 'No operation map zones are available.') return null;
  return group.summary;
}

function singleSnapshotRuntimeWarning(
  group: ReadPageBrowserPageObjectGroupState | undefined,
): string | null {
  if (!group || group.status !== 'degraded') return null;
  return group.summary;
}

function buildPageTransitionPrimaryConclusion(
  transitions: readonly { summary: string; groups: ReadPageBrowserPageObjectAttributeGroup[] }[],
): string {
  if (transitions.length > 0 && transitions.every(isWeakViewportOrRefTransition)) {
    return 'Only viewport or target-reference state changed; no result/content transition is proven.';
  }
  if (isSameDocumentUiContentTransition(transitions)) {
    return 'Same-document content area changed candidate: visible page content or DOM state changed after the action; postcondition verification is still required.';
  }
  return `Page state changed: ${transitions[0]?.summary ?? 'state changed'}.`;
}

function isSameDocumentUiContentTransition(
  transitions: readonly { summary: string; groups: ReadPageBrowserPageObjectAttributeGroup[] }[],
): boolean {
  const summaries = transitions.map((transition) => transition.summary.toLowerCase());
  const hasContentSignal = summaries.some(
    (summary) =>
      summary.startsWith('context chars ') ||
      (summary.startsWith('changed regions ') && summary !== 'changed regions viewport'),
  );
  if (!hasContentSignal) return false;

  const hasMajorRouteOrReadinessSignal = summaries.some(
    (summary) =>
      summary.startsWith('readiness ') ||
      summary.startsWith('source freshness ') ||
      summary.startsWith('active region ') ||
      summary.startsWith('user activity ') ||
      summary.startsWith('interference risk '),
  );
  if (hasMajorRouteOrReadinessSignal) return false;

  return transitions.some((transition) => transition.groups.includes('content_state'));
}

function isWeakViewportOrRefTransition(input: {
  summary: string;
  groups: ReadPageBrowserPageObjectAttributeGroup[];
}): boolean {
  const summary = input.summary.toLowerCase();
  return (
    summary === 'changed regions viewport' ||
    summary.startsWith('target refs invalidated=') ||
    summary.startsWith('source confidence ')
  );
}

function buildSemanticPrimaryConclusion(event: ReadPageBrowserPageSemanticEvent): string {
  switch (event.eventType) {
    case 'menu_expanded':
      return trimConclusion(event.summary, 'Menu state changed: menu expanded candidate.');
    case 'auth_succeeded_candidate':
      return 'Authentication success candidate: auth prompt disappeared and account state changed; postcondition verification is still required.';
    case 'logout_succeeded_candidate':
      return 'Logout success candidate: logged-in account state changed; postcondition verification is still required.';
    case 'qr_expired_candidate':
      return 'QR/auth object appears expired or refreshable; login is blocked until QR refresh or user action. Mark BLOCKED_USER_INTERACTION_REQUIRED in unattended runs when no safe refresh action exists.';
    case 'qr_refreshed':
      return 'QR object changed candidate; treat it as refresh/change evidence, not login success.';
    case 'qr_waiting':
      return 'QR/auth object is visible and waiting for user action candidate.';
    case 'content_changed':
      return trimConclusion(event.summary, 'Content changed candidate.');
    case 'unknown_or_noise':
      return 'No AI-usable target transition was proven from low-level object changes.';
  }
}

function buildActionLinkedSemanticConclusion(
  event: ReadPageBrowserPageSemanticEvent,
  actionState: ReadPageBrowserPageObjectGroupState | undefined,
): string | null {
  if (!actionState || actionState.status !== 'action_linkage_candidate') return null;
  const facts = actionState.facts;
  const actionId = readStringFact(facts, 'lastActionId');
  if (!actionId) return null;
  const targetSummary = formatActionLinkedTargetConclusion(
    readStringArrayFact(facts, 'lastTargetRefs'),
    readStringArrayFact(facts, 'lastTargetRoles'),
  );
  const semanticLabel = semanticEventConclusionLabel(event);
  return `Action-linked semantic change candidate: ${actionId}${targetSummary} was followed by ${semanticLabel}; postcondition verification is still required.`;
}

function formatActionLinkedTargetConclusion(
  refs: readonly string[],
  roles: readonly string[],
): string {
  if (refs.length === 0) return '';
  const formattedTargets = refs.slice(0, 3).map((ref, index) => {
    const role = roles[index];
    return role ? `${ref} (${role})` : ref;
  });
  return ` on target ${formattedTargets.join(', ')}`;
}

function semanticEventConclusionLabel(event: ReadPageBrowserPageSemanticEvent): string {
  switch (event.eventType) {
    case 'menu_expanded':
      return formatMenuExpandedConclusionLabel(event.summary);
    case 'auth_succeeded_candidate':
      return 'an authentication state-change candidate';
    case 'logout_succeeded_candidate':
      return 'a logout state-change candidate';
    case 'qr_expired_candidate':
      return 'a QR expired candidate';
    case 'qr_refreshed':
      return 'a QR refreshed candidate';
    case 'qr_waiting':
      return 'a QR waiting-for-user candidate';
    case 'content_changed':
      return 'a content change candidate';
    case 'unknown_or_noise':
      return 'an unknown page change candidate';
    default:
      return 'a page semantic change candidate';
  }
}

function formatMenuExpandedConclusionLabel(summary: string): string {
  const normalized = trimConclusion(summary, 'Menu expanded candidate.');
  const detail = normalized
    .replace(/^Menu expanded candidate:\s*/i, '')
    .replace(/\s+Current visible entries:\s+/i, ' visible entries: ');
  return `a menu expanded candidate: ${detail}`;
}

function readStringFact(
  facts: Record<string, string | number | boolean | null | string[] | number[]> | undefined,
  key: string,
): string | null {
  const value = facts?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringArrayFact(
  facts: Record<string, string | number | boolean | null | string[] | number[]> | undefined,
  key: string,
): string[] {
  const value = facts?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

function readNumberFact(
  facts: Record<string, string | number | boolean | null | string[] | number[]> | undefined,
  key: string,
): number | null {
  const value = facts?.[key];
  return Number.isFinite(value) ? Number(value) : null;
}

function readBooleanFact(
  facts: Record<string, string | number | boolean | null | string[] | number[]> | undefined,
  key: string,
): boolean | null {
  const value = facts?.[key];
  return typeof value === 'boolean' ? value : null;
}

function formatChangedAreaSentence(changes: readonly ReadPageObjectLifecycleChange[]): string {
  const areaSummary = formatChangedAreaSummary(changes);
  return areaSummary
    ? `State changes: ${areaSummary}.`
    : 'State changes are not specific enough to summarize.';
}

function buildNoTargetTransitionSummary(changes: readonly ReadPageObjectLifecycleChange[]): string {
  const areaSummary = formatChangedAreaSummary(changes);
  const groupedChanges = areaSummary || 'not specific enough to summarize';
  return (
    `Object-change summary: ${groupedChanges}. ` +
    'No AI-usable transition was proven: menu opened, auth changed, QR refreshed/expired, content changed, and form result changed all remain not_proven.'
  );
}

function changedAreaAttributeGroups(
  changes: readonly ReadPageObjectLifecycleChange[],
): ReadPageBrowserPageObjectAttributeGroup[] {
  return dedupeAttributeGroups(
    changes
      .filter((change) => change.changeKind !== 'unchanged')
      .map((change) => changedAreaAttributeGroup(change.objectFamily))
      .filter((group): group is ReadPageBrowserPageObjectAttributeGroup => group !== null),
  );
}

function changedAreaAttributeGroup(
  family: ReadPageObjectLifecycleFamily,
): ReadPageBrowserPageObjectAttributeGroup | null {
  switch (family) {
    case 'auth_surface':
    case 'account_identity':
      return 'auth_state';
    case 'qr_code':
      return 'qr_state';
    case 'menu_surface':
    case 'menu_item':
      return 'menu_state';
    case 'form_control':
      return 'action_state';
    case 'feedback_surface':
      return 'task_relation';
    case 'content_collection':
      return 'content_state';
    case 'unknown':
    default:
      return null;
  }
}

function formatChangedAreaSummary(changes: readonly ReadPageObjectLifecycleChange[]): string {
  const summaries = new Map<
    string,
    {
      appeared: boolean;
      disappeared: boolean;
      changed: boolean;
      unknown: boolean;
    }
  >();
  for (const change of changes) {
    if (change.changeKind === 'unchanged') continue;
    const label = changedAreaLabel(change.objectFamily);
    const summary = summaries.get(label) ?? {
      appeared: false,
      disappeared: false,
      changed: false,
      unknown: false,
    };
    if (change.changeKind === 'appeared') summary.appeared = true;
    else if (change.changeKind === 'disappeared') summary.disappeared = true;
    else if (change.changeKind === 'changed') summary.changed = true;
    else summary.unknown = true;
    summaries.set(label, summary);
  }
  const parts = Array.from(summaries.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 5)
    .map(([label, summary]) => `${label} ${formatAreaChangeKinds(summary)}`);
  const remaining = Math.max(0, summaries.size - parts.length);
  return `${parts.join(', ')}${remaining > 0 ? ` (+${remaining} more area types)` : ''}`;
}

function formatAreaChangeKinds(summary: {
  appeared: boolean;
  disappeared: boolean;
  changed: boolean;
  unknown: boolean;
}): string {
  const kinds: string[] = [];
  if (summary.appeared) kinds.push('appeared');
  if (summary.disappeared) kinds.push('disappeared');
  if (summary.changed) kinds.push('changed');
  if (summary.unknown) kinds.push('changed with unknown direction');
  return kinds.length > 0 ? kinds.join(' and ') : 'changed';
}

function isQrExpiredState(state: string | undefined): boolean {
  return /expired|invalid|timed[ -]?out|refresh_available|refreshable|过期|失效/i.test(state ?? '');
}

function changedAreaLabel(family: ReadPageObjectLifecycleFamily): string {
  switch (family) {
    case 'auth_surface':
    case 'account_identity':
      return 'auth_state';
    case 'qr_code':
      return 'qr_state';
    case 'menu_surface':
    case 'menu_item':
      return 'menu_state';
    case 'form_control':
      return 'form_state';
    case 'feedback_surface':
      return 'feedback_state';
    case 'content_collection':
      return 'content_state';
    case 'unknown':
    default:
      return 'unknown_state';
  }
}

function trimConclusion(summary: string, fallback: string): string {
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (!normalized) return fallback;
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function buildPageProjectionTransitions(
  previous: BrowserPageThingProjection | null | undefined,
  current: BrowserPageThingProjection | null | undefined,
): Array<{ summary: string; groups: ReadPageBrowserPageObjectAttributeGroup[] }> {
  if (!previous || !current) return [];

  const transitions: Array<{
    summary: string;
    groups: ReadPageBrowserPageObjectAttributeGroup[];
  }> = [];

  addRuntimeTransition(transitions, {
    label: 'readiness',
    before: previous.readiness,
    after: current.readiness,
    groups: ['page_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'stability',
    before: previous.stability,
    after: current.stability,
    groups: ['page_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'source freshness',
    before: previous.sourceFreshness,
    after: current.sourceFreshness,
    groups: ['page_state', 'evidence_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'active region',
    before: previous.activeRegion,
    after: current.activeRegion,
    groups: ['layout_regions', 'content_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'context chars',
    before: previous.contextChars,
    after: current.contextChars,
    groups: ['page_state', 'content_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'user activity',
    before: previous.userActivityLevel,
    after: current.userActivityLevel,
    groups: ['page_state', 'task_relation'],
  });
  addRuntimeTransition(transitions, {
    label: 'interference risk',
    before: previous.interferenceRisk,
    after: current.interferenceRisk,
    groups: ['page_state', 'task_relation'],
  });
  const linkedActionId = normalizeActionId(current.changedByActionId);
  const linkedTargetRefs = collectLinkedTargetRefs(current.invalidatedRefs);
  if (linkedActionId || current.changeCause !== 'unknown') {
    transitions.push({
      summary: `last action linkage candidate ${linkedActionId ?? 'unknown action'}${current.changeCause !== 'unknown' ? ` caused ${current.changeCause}` : ''}${linkedTargetRefs.length > 0 ? ` on target ${linkedTargetRefs.join(', ')}` : ''}`,
      groups: ['action_state', 'task_relation'],
    });
  }

  if (Math.abs(current.sourceConfidence - previous.sourceConfidence) >= 0.05) {
    transitions.push({
      summary: `source confidence ${formatConfidence(previous.sourceConfidence)} -> ${formatConfidence(current.sourceConfidence)}`,
      groups: ['evidence_state'],
    });
  }
  if (current.changedRegions.length > 0) {
    transitions.push({
      summary: `changed regions ${formatListSummary(current.changedRegions)}`,
      groups: ['layout_regions', 'content_state'],
    });
  }
  if (current.invalidatedRefs.length > 0 || current.refreshedRefs.length > 0) {
    transitions.push({
      summary: `target refs invalidated=${current.invalidatedRefs.length} refreshed=${current.refreshedRefs.length}`,
      groups: ['evidence_state', 'action_state'],
    });
  }

  return transitions.slice(0, 8);
}

function collectRuntimeDegradedGroups(
  attributeGroups: Record<
    ReadPageBrowserPageObjectAttributeGroup,
    ReadPageBrowserPageObjectGroupState
  >,
): ReadPageBrowserPageObjectAttributeGroup[] {
  const result: ReadPageBrowserPageObjectAttributeGroup[] = [];
  const visual = attributeGroups.visual_reliability;
  const windowState = attributeGroups.window_state;
  const tabState = attributeGroups.tab_state;

  if (visual.status === 'degraded') {
    result.push('visual_reliability');
  }
  if (windowState.status === 'minimized' || windowState.status === 'unfocused') {
    result.push('window_state');
  }
  if (tabState.status === 'background') {
    result.push('tab_state');
  }
  return dedupeAttributeGroups(result);
}

function buildRuntimeTransitions(
  previous: ReadPageOwnershipRuntimeSummary | null | undefined,
  current: ReadPageOwnershipRuntimeSummary | null | undefined,
): Array<{ summary: string; groups: ReadPageBrowserPageObjectAttributeGroup[] }> {
  if (!previous || !current) return [];

  const transitions: Array<{
    summary: string;
    groups: ReadPageBrowserPageObjectAttributeGroup[];
  }> = [];

  addRuntimeTransition(transitions, {
    label: 'window state',
    before: previous.currentWindowState,
    after: current.currentWindowState,
    groups: ['window_state', 'visual_reliability'],
  });
  addRuntimeTransition(transitions, {
    label: 'window focus',
    before: previous.isCurrentWindowFocused,
    after: current.isCurrentWindowFocused,
    groups: ['window_state', 'visual_reliability'],
  });
  addRuntimeTransition(transitions, {
    label: 'active tab',
    before: previous.isCurrentTabActive,
    after: current.isCurrentTabActive,
    groups: ['tab_state', 'visual_reliability'],
  });
  addRuntimeTransition(transitions, {
    label: 'run-owned tab count',
    before: previous.runOwnedTabCount,
    after: current.runOwnedTabCount,
    groups: ['tab_state', 'task_relation'],
  });
  addRuntimeTransition(transitions, {
    label: 'current tab run ownership',
    before: previous.currentTabRunOwnershipVerdict,
    after: current.currentTabRunOwnershipVerdict,
    groups: ['tab_state', 'task_relation'],
  });
  addRuntimeTransition(transitions, {
    label: 'cleanup eligibility',
    before: previous.cleanupEligibility,
    after: current.cleanupEligibility,
    groups: ['tab_state', 'task_relation'],
  });
  addRuntimeTransition(transitions, {
    label: 'window id',
    before: previous.currentWindowId,
    after: current.currentWindowId,
    groups: ['window_state'],
  });
  addRuntimeTransition(transitions, {
    label: 'tab id',
    before: previous.currentTabId,
    after: current.currentTabId,
    groups: ['tab_state'],
  });

  const previousSize = formatWindowSize(previous);
  const currentSize = formatWindowSize(current);
  addRuntimeTransition(transitions, {
    label: 'window size',
    before: previousSize,
    after: currentSize,
    groups: ['window_state', 'visual_reliability'],
  });

  const previousPosition = formatWindowPosition(previous);
  const currentPosition = formatWindowPosition(current);
  addRuntimeTransition(transitions, {
    label: 'window position',
    before: previousPosition,
    after: currentPosition,
    groups: ['window_state'],
  });

  return transitions.slice(0, 6);
}

function addRuntimeTransition(
  output: Array<{ summary: string; groups: ReadPageBrowserPageObjectAttributeGroup[] }>,
  input: {
    label: string;
    before: string | number | boolean | null | undefined;
    after: string | number | boolean | null | undefined;
    groups: ReadPageBrowserPageObjectAttributeGroup[];
  },
): void {
  const before = formatComparableRuntimeValue(input.before);
  const after = formatComparableRuntimeValue(input.after);
  if (before === 'unknown' || after === 'unknown' || before === after) return;
  output.push({
    summary: `${input.label} ${before} -> ${after}`,
    groups: input.groups,
  });
}

function formatComparableRuntimeValue(value: string | number | boolean | null | undefined): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return 'unknown';
}

function formatWindowSize(runtime: ReadPageOwnershipRuntimeSummary): string {
  const width = runtime.currentWindowWidth;
  const height = runtime.currentWindowHeight;
  return Number.isFinite(width) && Number.isFinite(height) ? `${width}x${height}` : 'unknown';
}

function formatWindowPosition(runtime: ReadPageOwnershipRuntimeSummary): string {
  const left = runtime.currentWindowLeft;
  const top = runtime.currentWindowTop;
  return Number.isFinite(left) && Number.isFinite(top) ? `${left},${top}` : 'unknown';
}

function formatConfidence(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : 'unknown';
}

function formatListSummary(values: readonly string[]): string {
  const compact = values.filter((value) => typeof value === 'string' && value.trim()).slice(0, 3);
  if (compact.length === 0) return 'none';
  const suffix = values.length > compact.length ? ` (+${values.length - compact.length} more)` : '';
  return `${compact.join(', ')}${suffix}`;
}

function dedupeAttributeGroups(
  values: readonly ReadPageBrowserPageObjectAttributeGroup[],
): ReadPageBrowserPageObjectAttributeGroup[] {
  const seen = new Set<ReadPageBrowserPageObjectAttributeGroup>();
  const result: ReadPageBrowserPageObjectAttributeGroup[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function selectPrimarySemanticEvent(
  semanticEvents: readonly ReadPageBrowserPageSemanticEvent[],
): ReadPageBrowserPageSemanticEvent {
  return [...semanticEvents].sort(
    (a, b) => semanticEventPriority(a) - semanticEventPriority(b),
  )[0]!;
}

function semanticEventPriority(event: ReadPageBrowserPageSemanticEvent): number {
  if (event.eventType === 'content_changed' && event.targetObjectFamily === 'form_control') {
    return 3.5;
  }
  switch (event.eventType) {
    case 'auth_succeeded_candidate':
    case 'logout_succeeded_candidate':
      return 1;
    case 'qr_expired_candidate':
      return 2;
    case 'qr_refreshed':
      return 3;
    case 'menu_expanded':
      return 4;
    case 'qr_waiting':
      return 5;
    case 'content_changed':
      return 6;
    case 'unknown_or_noise':
      return 7;
    default:
      return 99;
  }
}

function semanticEvent(input: {
  eventType: ReadPageBrowserPageSemanticEventType;
  summary: string;
  targetGroup: ReadPageBrowserPageObjectAttributeGroup;
  targetObjectFamily?: ReadPageObjectLifecycleFamily;
  beforeState?: string;
  afterState?: string;
  confidence: number;
  evidenceRefs: readonly string[];
  postconditionStatus?: ReadPageBrowserPageSemanticEvent['postconditionStatus'];
}): ReadPageBrowserPageSemanticEvent {
  return {
    eventType: input.eventType,
    summary: input.summary,
    targetGroup: input.targetGroup,
    ...(input.targetObjectFamily ? { targetObjectFamily: input.targetObjectFamily } : {}),
    ...(input.beforeState ? { beforeState: input.beforeState } : {}),
    ...(input.afterState ? { afterState: input.afterState } : {}),
    confidence: clampConfidence(input.confidence),
    evidenceRefs: dedupePublicRefs(input.evidenceRefs),
    postconditionStatus: input.postconditionStatus ?? 'candidate_only',
    claimBoundary: CANDIDATE_BOUNDARY,
  };
}

function groupState(input: {
  status: string;
  summary: string;
  facts?: Record<string, string | number | boolean | null | string[] | number[]>;
  confidence: number;
  evidenceRefs: readonly string[];
}): ReadPageBrowserPageObjectGroupState {
  return {
    status: input.status,
    summary: input.summary,
    ...(input.facts ? { facts: input.facts } : {}),
    confidence: clampConfidence(input.confidence),
    evidenceRefs: dedupePublicRefs(input.evidenceRefs),
    claimBoundary: BROWSER_PAGE_OBJECT_BOUNDARY,
  };
}

function changesForFamilies(
  lifecycle: ReadPageObjectLifecycleSummary,
  families: readonly ReadPageObjectLifecycleFamily[],
): ReadPageObjectLifecycleChange[] {
  return lifecycle.changes.filter((change) => families.includes(change.objectFamily));
}

function hasActiveAuthContext(lifecycle: ReadPageObjectLifecycleSummary): boolean {
  const authSurfaceVisible = lifecycle.items.some((item) => item.objectFamily === 'auth_surface');
  const loggedInAccountVisible = lifecycle.items.some(
    (item) => item.objectFamily === 'account_identity' && looksLoggedIn(item.state),
  );
  return authSurfaceVisible && !loggedInAccountVisible;
}

function isAuthScopedQrItem(item: ReadPageObjectLifecycleItem): boolean {
  return item.objectFamily === 'qr_code' && item.regionType !== 'content';
}

function isAuthScopedQrChange(change: ReadPageObjectLifecycleChange): boolean {
  return change.objectFamily === 'qr_code' && change.regionType !== 'content';
}

function changedEvidenceRefs(changes: readonly ReadPageObjectLifecycleChange[]): string[] {
  return changes
    .filter((change) => change.changeKind !== 'unchanged')
    .map((change) => change.objectKey);
}

function averageConfidence(items: readonly { confidence: number }[]): number {
  if (items.length === 0) return 0.25;
  return clampConfidence(items.reduce((sum, item) => sum + item.confidence, 0) / items.length);
}

function isTargetable(targetability: string | undefined): boolean {
  return targetability === 'target_ref' || targetability === 'locator_chain';
}

function dedupeStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatTriState(value: boolean | null | undefined): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'unknown';
}

function formatNullableNumber(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : 'unknown';
}

function looksExpanded(state: string | undefined): boolean {
  return /expanded|open|action_available|visible/i.test(state ?? '');
}

function looksLoggedIn(state: string | undefined): boolean {
  return /logged[_ -]?in|authenticated|account/i.test(state ?? '');
}

function buildRootObjectId(projection: BrowserPageThingProjection | null | undefined): string {
  if (projection?.pageId) return `browser_page:${safePart(projection.pageId)}`;
  if (Number.isInteger(projection?.tabId) && projection && projection.tabId > 0) {
    return `browser_page:tab_${projection.tabId}`;
  }
  return 'browser_page:unknown';
}

function dedupePublicRefs(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const ref = safePublicRef(value);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    result.push(ref);
  }
  return result.slice(0, 24);
}

function safePublicRef(value: string | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^(ref_|tgt_|ca_|region_|object:|region:|projection:|zone_)[a-zA-Z0-9:_-]+$/.test(raw)) {
    return raw.slice(0, 160);
  }
  if (raw === 'objectLifecycle' || raw === 'sourceRouteHonesty') return raw;
  return null;
}

function safePart(value: string): string {
  return (
    String(value)
      .replace(/[^a-zA-Z0-9:_-]/g, '_')
      .slice(0, 80) || 'unknown'
  );
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}
