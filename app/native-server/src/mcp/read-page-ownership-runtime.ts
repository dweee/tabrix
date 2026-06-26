import type {
  BrowserPageOwnerType,
  BrowserPageThingProjection,
  ReadPageOwnershipRuntimeSummary,
  ReadPageSelectedDataSource,
} from '@tabrix/shared';
import type { TaskPageRuntimeFields, TaskSessionContext } from '../execution/task-session-context';
import type { BridgeRuntimeSnapshot } from '../server/bridge-state';
import {
  readBoolean,
  readInteger,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  readWindowRuntimeState,
} from './register-tool-value-readers';

export interface PostconditionLoadReadinessGate {
  canUseSnapshotForBusinessAction: boolean | null;
  status: string | null;
  pageStability: string | null;
  nextStepHint: string | null;
}

export function readTaskPageRuntimeFields(payload: Record<string, unknown>): TaskPageRuntimeFields {
  const ownershipRuntime = readObject(payload.ownershipRuntime);
  const pageLoadReadiness = readPageLoadReadiness(payload.pageContext);
  const compactTabFacts = readObject(
    readObject(readObject(payload.browserPageObjectCompact)?.facts)?.tab,
  );
  const readCompactString = (key: string): string | null => readString(compactTabFacts?.[key]);
  const readCompactInteger = (key: string): number | null => readInteger(compactTabFacts, key);
  const readCompactBoolean = (key: string): boolean | null => readBoolean(compactTabFacts, key);
  const readCompactNumber = (key: string): number | null => {
    const raw = compactTabFacts?.[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  };
  const readNestedString = (key: string): string | null =>
    readString(ownershipRuntime?.[key]) ?? readString(payload[key]);
  const readNestedInteger = (key: string): number | null =>
    readInteger(ownershipRuntime, key) ?? readInteger(payload, key);
  const readNestedPositiveInteger = (key: string): number | null =>
    readPositiveInteger(ownershipRuntime, key) ?? readPositiveInteger(payload, key);
  const readNestedBoolean = (key: string): boolean | null =>
    readBoolean(ownershipRuntime, key) ?? readBoolean(payload, key);
  const readNestedNumber = (key: string): number | null => {
    const nestedRaw = ownershipRuntime?.[key];
    if (typeof nestedRaw === 'number' && Number.isFinite(nestedRaw)) return nestedRaw;
    const payloadRaw = payload[key];
    return typeof payloadRaw === 'number' && Number.isFinite(payloadRaw) ? payloadRaw : null;
  };
  const openedBy = readNestedString('currentTabOpenedBy');
  const openedBySource = readNestedString('currentTabOpenedBySource');
  const aiOperationState = readNestedString('currentTabAiOperationState');
  const runtimeStateSource = readNestedString('currentTabRuntimeStateSource');

  return {
    currentWindowId: readPositiveInteger(payload, 'currentWindowId'),
    currentWindowState: readWindowRuntimeState(payload, 'currentWindowState'),
    currentWindowWidth: readPositiveInteger(payload, 'currentWindowWidth'),
    currentWindowHeight: readPositiveInteger(payload, 'currentWindowHeight'),
    currentWindowLeft: readInteger(payload, 'currentWindowLeft'),
    currentWindowTop: readInteger(payload, 'currentWindowTop'),
    isCurrentTabActive: readBoolean(payload, 'isCurrentTabActive'),
    isCurrentWindowFocused: readBoolean(payload, 'isCurrentWindowFocused'),
    browserActiveTabId: readPositiveInteger(payload, 'browserActiveTabId'),
    browserActiveTabIdKnown: readBoolean(payload, 'browserActiveTabIdKnown') === true,
    isReadTargetBrowserActiveTab: readBoolean(payload, 'isReadTargetBrowserActiveTab'),
    currentTabUrl: readNestedString('currentTabUrl') ?? readCompactString('currentTabUrl'),
    currentTabPendingUrl:
      readNestedString('currentTabPendingUrl') ?? readCompactString('currentTabPendingUrl'),
    currentTabTitle: readNestedString('currentTabTitle') ?? readCompactString('currentTabTitle'),
    currentTabStatus: readNestedString('currentTabStatus') ?? readCompactString('currentTabStatus'),
    currentTabDiscarded:
      readNestedBoolean('currentTabDiscarded') ?? readCompactBoolean('currentTabDiscarded'),
    currentTabAudible:
      readNestedBoolean('currentTabAudible') ?? readCompactBoolean('currentTabAudible'),
    currentTabMuted: readNestedBoolean('currentTabMuted') ?? readCompactBoolean('currentTabMuted'),
    currentTabPinned:
      readNestedBoolean('currentTabPinned') ?? readCompactBoolean('currentTabPinned'),
    currentTabOpenerTabId:
      readNestedPositiveInteger('currentTabOpenerTabId') ??
      readCompactInteger('currentTabOpenerTabId'),
    currentTabOpenedBy:
      (openedBy === 'ai' || openedBy === 'user_or_page' || openedBy === 'unknown'
        ? openedBy
        : null) ??
      (() => {
        const compactOpenedBy = readCompactString('openedBy');
        return compactOpenedBy === 'ai' ||
          compactOpenedBy === 'user_or_page' ||
          compactOpenedBy === 'unknown'
          ? compactOpenedBy
          : null;
      })(),
    currentTabOpenedBySource:
      (openedBySource === 'ai_tool' ||
      openedBySource === 'page_opener' ||
      openedBySource === 'user_or_unknown' ||
      openedBySource === 'unknown'
        ? openedBySource
        : null) ??
      (() => {
        const compactOpenedBySource = readCompactString('openedBySource');
        return compactOpenedBySource === 'ai_tool' ||
          compactOpenedBySource === 'page_opener' ||
          compactOpenedBySource === 'user_or_unknown' ||
          compactOpenedBySource === 'unknown'
          ? compactOpenedBySource
          : null;
      })(),
    currentTabOpenedByConfidence:
      readNestedNumber('currentTabOpenedByConfidence') ?? readCompactNumber('openedByConfidence'),
    currentTabOpenedByReason:
      readNestedString('currentTabOpenedByReason') ?? readCompactString('openedByReason'),
    currentTabAiOperationState:
      (aiOperationState === 'idle' ||
      aiOperationState === 'recently_operated' ||
      aiOperationState === 'closed'
        ? aiOperationState
        : null) ??
      (() => {
        const compactAiOperationState = readCompactString('aiOperationState');
        return compactAiOperationState === 'idle' ||
          compactAiOperationState === 'recently_operated' ||
          compactAiOperationState === 'closed'
          ? compactAiOperationState
          : null;
      })(),
    currentTabLastAiOperation:
      readNestedString('currentTabLastAiOperation') ?? readCompactString('lastAiOperation'),
    currentTabLastAiOperationAtMs:
      readNestedInteger('currentTabLastAiOperationAtMs') ??
      readCompactInteger('lastAiOperationAtMs'),
    currentTabLastAiOperationConfidence:
      readNestedNumber('currentTabLastAiOperationConfidence') ??
      readCompactNumber('lastAiOperationConfidence'),
    currentTabLastAiOperationReason:
      readNestedString('currentTabLastAiOperationReason') ??
      readCompactString('lastAiOperationReason'),
    currentTabCanTabrixOperate:
      readNestedBoolean('currentTabCanTabrixOperate') ?? readCompactBoolean('canTabrixOperate'),
    currentTabOperabilityReason:
      readNestedString('currentTabOperabilityReason') ?? readCompactString('operabilityReason'),
    currentTabRuntimeStateSource:
      (runtimeStateSource === 'browser_world_inventory' ||
      runtimeStateSource === 'chrome_tab_snapshot' ||
      runtimeStateSource === 'unknown'
        ? runtimeStateSource
        : null) ??
      (() => {
        const compactRuntimeStateSource = readCompactString('runtimeStateSource');
        return compactRuntimeStateSource === 'browser_world_inventory' ||
          compactRuntimeStateSource === 'chrome_tab_snapshot' ||
          compactRuntimeStateSource === 'unknown'
          ? compactRuntimeStateSource
          : 'unknown';
      })(),
    browserWorldObjectChangeSummary:
      readNestedString('browserWorldObjectChangeSummary') ??
      readCompactString('browserWorldObjectChangeSummary'),
    browserWorldActionableObjectChangeSummary:
      readNestedString('browserWorldActionableObjectChangeSummary') ??
      readCompactString('browserWorldActionableObjectChangeSummary'),
    browserWorldCurrentOperationConclusion:
      readNestedString('browserWorldCurrentOperationConclusion') ??
      readCompactString('browserWorldCurrentOperationConclusion'),
    browserWorldRoutingDecisionSummary:
      readNestedString('browserWorldRoutingDecisionSummary') ??
      readCompactString('browserWorldRoutingDecisionSummary'),
    currentPageLoadReadinessStatus: pageLoadReadiness?.status ?? null,
    currentPageStability: pageLoadReadiness?.pageStability ?? null,
    currentPageSnapshotUsableForBusinessAction:
      pageLoadReadiness?.canUseSnapshotForBusinessAction ?? null,
    currentPageLoadReadinessNextStepHint: pageLoadReadiness?.nextStepHint ?? null,
  };
}

export function normalizeAiFacingProjectionOwnerType(
  taskContext: TaskSessionContext,
  projection: BrowserPageThingProjection,
  selectedDataSource: ReadPageSelectedDataSource,
  payload: Record<string, unknown>,
): BrowserPageThingProjection {
  const sourceTabId = resolveOwnerTypeSourceTabId(selectedDataSource, projection, payload);

  if (sourceTabId === null) {
    return {
      ...projection,
      ownerType: 'unknown',
    };
  }

  const ownerType: BrowserPageOwnerType = taskContext.isRunOwnedTab(sourceTabId)
    ? 'run_owned'
    : projection.ownerType === 'baseline'
      ? 'baseline'
      : 'user_owned';
  return {
    ...projection,
    ownerType,
  };
}

export function buildAiFacingOwnershipRuntimeSummary(args: {
  taskContext: TaskSessionContext;
  projection: BrowserPageThingProjection;
  runtimeFields: TaskPageRuntimeFields;
  bridgeSnapshot: BridgeRuntimeSnapshot;
}): ReadPageOwnershipRuntimeSummary {
  const { taskContext, projection, runtimeFields, bridgeSnapshot } = args;
  const runOwnedTabIds = [...taskContext.getRunOwnedTabIds()];
  const currentTabId = readProjectionTabId(projection);
  const {
    currentWindowId,
    currentWindowState,
    currentWindowWidth,
    currentWindowHeight,
    currentWindowLeft,
    currentWindowTop,
    isCurrentTabActive,
    isCurrentWindowFocused,
    browserActiveTabId,
    browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab,
  } = runtimeFields;
  const isCurrentTabRunOwnedByTask =
    currentTabId !== null && taskContext.isRunOwnedTab(currentTabId);
  const currentOwnerType: BrowserPageOwnerType = projection.ownerType;
  const currentTabRunOwnershipVerdict =
    currentTabId === null
      ? 'unknown'
      : isCurrentTabRunOwnedByTask
        ? 'run_owned_by_task'
        : 'not_run_owned_by_task';
  const currentTabPrimaryRelationVerdict =
    currentTabId === null
      ? 'current_tab_unknown'
      : bridgeSnapshot.primaryTabId === null
        ? 'primary_tab_unknown'
        : currentTabId === bridgeSnapshot.primaryTabId
          ? 'current_tab_is_primary'
          : 'current_tab_differs_from_primary';
  const protectedScopeVerdict =
    currentTabId === null
      ? 'unknown'
      : !isCurrentTabRunOwnedByTask || currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
        ? 'protected'
        : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
          ? 'unknown'
          : 'not_protected';
  const cleanupEligibility =
    currentTabId === null
      ? 'unknown'
      : !isCurrentTabRunOwnedByTask || currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
        ? 'not_eligible'
        : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
          ? 'unknown'
          : 'eligible';
  const protectReason =
    currentTabId === null
      ? 'current_tab_unknown'
      : !isCurrentTabRunOwnedByTask
        ? 'not_run_owned_by_task'
        : currentTabPrimaryRelationVerdict === 'current_tab_is_primary'
          ? 'current_tab_is_primary'
          : currentTabPrimaryRelationVerdict === 'primary_tab_unknown'
            ? 'primary_tab_unknown'
            : null;

  return {
    currentTabId,
    currentWindowId,
    currentWindowState,
    currentWindowWidth,
    currentWindowHeight,
    currentWindowLeft,
    currentWindowTop,
    isCurrentTabActive,
    isCurrentWindowFocused,
    browserActiveTabId,
    browserActiveTabIdKnown,
    isReadTargetBrowserActiveTab,
    currentTabUrl: runtimeFields.currentTabUrl ?? null,
    currentTabPendingUrl: runtimeFields.currentTabPendingUrl ?? null,
    currentTabTitle: runtimeFields.currentTabTitle ?? null,
    currentTabStatus: runtimeFields.currentTabStatus ?? null,
    currentTabDiscarded: runtimeFields.currentTabDiscarded ?? null,
    currentTabAudible: runtimeFields.currentTabAudible ?? null,
    currentTabMuted: runtimeFields.currentTabMuted ?? null,
    currentTabPinned: runtimeFields.currentTabPinned ?? null,
    currentTabOpenerTabId: runtimeFields.currentTabOpenerTabId ?? null,
    currentTabOpenedBy: runtimeFields.currentTabOpenedBy ?? null,
    currentTabOpenedBySource: runtimeFields.currentTabOpenedBySource ?? null,
    currentTabOpenedByConfidence: runtimeFields.currentTabOpenedByConfidence ?? null,
    currentTabOpenedByReason: runtimeFields.currentTabOpenedByReason ?? null,
    currentTabAiOperationState: runtimeFields.currentTabAiOperationState ?? null,
    currentTabLastAiOperation: runtimeFields.currentTabLastAiOperation ?? null,
    currentTabLastAiOperationAtMs: runtimeFields.currentTabLastAiOperationAtMs ?? null,
    currentTabLastAiOperationConfidence: runtimeFields.currentTabLastAiOperationConfidence ?? null,
    currentTabLastAiOperationReason: runtimeFields.currentTabLastAiOperationReason ?? null,
    currentTabCanTabrixOperate: runtimeFields.currentTabCanTabrixOperate ?? null,
    currentTabOperabilityReason: runtimeFields.currentTabOperabilityReason ?? null,
    currentTabRuntimeStateSource: runtimeFields.currentTabRuntimeStateSource ?? 'unknown',
    browserWorldObjectChangeSummary: runtimeFields.browserWorldObjectChangeSummary ?? null,
    browserWorldActionableObjectChangeSummary:
      runtimeFields.browserWorldActionableObjectChangeSummary ?? null,
    browserWorldCurrentOperationConclusion:
      runtimeFields.browserWorldCurrentOperationConclusion ?? null,
    browserWorldRoutingDecisionSummary: runtimeFields.browserWorldRoutingDecisionSummary ?? null,
    currentOwnerType,
    currentTabRunOwnershipVerdict,
    currentTabPrimaryRelationVerdict,
    protectedScopeVerdict,
    cleanupEligibility,
    protectReason,
    isCurrentTabRunOwnedByTask,
    runOwnedTabIds,
    runOwnedTabCount: runOwnedTabIds.length,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: bridgeSnapshot.bridgeState ?? null,
    primaryTabId: bridgeSnapshot.primaryTabId,
    primaryTabReuseRate: bridgeSnapshot.primaryTabReuseRate,
    benchmarkOwnedTabCount: bridgeSnapshot.benchmarkOwnedTabCount,
    heartbeatTabCount: bridgeSnapshot.heartbeat.tabCount,
    heartbeatWindowCount: bridgeSnapshot.heartbeat.windowCount,
  };
}

export function readPageLoadReadiness(value: unknown): PostconditionLoadReadinessGate | null {
  const pageContext = readObject(value);
  const loadReadiness = readObject(pageContext?.loadReadiness);
  if (!loadReadiness) return null;
  return {
    canUseSnapshotForBusinessAction:
      typeof loadReadiness.canUseSnapshotForBusinessAction === 'boolean'
        ? loadReadiness.canUseSnapshotForBusinessAction
        : null,
    status: readString(loadReadiness.status),
    pageStability: readString(loadReadiness.pageStability),
    nextStepHint: readString(loadReadiness.nextStepHint),
  };
}

function resolveOwnerTypeSourceTabId(
  selectedDataSource: ReadPageSelectedDataSource,
  projection: BrowserPageThingProjection,
  payload: Record<string, unknown>,
): number | null {
  if (selectedDataSource === 'dom_region_rows') {
    const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
    return (
      readPositiveInteger(payload, 'sourceTabId') ??
      readPositiveInteger(rowsPayload, 'sourceTabId') ??
      readProjectionTabId(projection)
    );
  }
  return readProjectionTabId(projection);
}

function readProjectionTabId(projection: BrowserPageThingProjection): number | null {
  return Number.isInteger(projection.tabId) && projection.tabId > 0 ? projection.tabId : null;
}
