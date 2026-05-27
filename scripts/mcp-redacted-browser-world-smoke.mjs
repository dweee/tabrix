#!/usr/bin/env node

/* global process, URL */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PUBLIC_URL = 'https://example.com/?tabrix_browser_world_smoke=1';

export function parseArgs(argv) {
  const args = {
    url: DEFAULT_PUBLIC_URL,
    urls: [],
    keepOpen: false,
    skipOpen: false,
    scenario: 'single',
    timeoutMs: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--url') {
      args.url = argv[index + 1] || '';
      if (args.url) args.urls.push(args.url);
      index += 1;
    } else if (part === '--urls') {
      args.urls.push(
        ...(argv[index + 1] || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean),
      );
      index += 1;
    } else if (part === '--keep-open') {
      args.keepOpen = true;
    } else if (part === '--skip-open') {
      args.skipOpen = true;
    } else if (part === '--scenario') {
      args.scenario = argv[index + 1] || 'single';
      index += 1;
    } else if (part === '--timeout-ms') {
      const parsed = Number(argv[index + 1]);
      if (Number.isFinite(parsed) && parsed > 0) args.timeoutMs = parsed;
      index += 1;
    } else if (part === '--help' || part === '-h') {
      args.help = true;
    }
  }
  return args;
}

export function resolveSmokeUrls(args) {
  const urls = args.urls?.length ? args.urls : [args.url || DEFAULT_PUBLIC_URL];
  return urls.map((url) => assertPublicHttpUrl(url));
}

export function assertPublicHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Smoke URL must be an absolute public http(s) URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Smoke URL must use http(s).');
  }
  const hostname = parsed.hostname.toLowerCase();
  const ipv4Parts = hostname.split('.').map((part) => Number(part));
  const isIpv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => Number.isInteger(part));
  const isPrivateIpv4 =
    isIpv4 &&
    (ipv4Parts[0] === 10 ||
      (ipv4Parts[0] === 172 && ipv4Parts[1] >= 16 && ipv4Parts[1] <= 31) ||
      (ipv4Parts[0] === 192 && ipv4Parts[1] === 168) ||
      (ipv4Parts[0] === 169 && ipv4Parts[1] === 254) ||
      ipv4Parts[0] === 0);
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    isPrivateIpv4 ||
    (!isIpv4 && !hostname.includes('.')) ||
    hostname.endsWith('.local')
  ) {
    throw new Error('Smoke URL must not target localhost or private local hosts.');
  }
  return parsed.toString();
}

export function extractJsonObject(text) {
  const source = String(text || '');
  const resultIndex = source.indexOf('Result');
  const start = source.indexOf('{', resultIndex >= 0 ? resultIndex : 0);
  if (start < 0) throw new Error('No JSON object found in CLI output.');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return JSON.parse(source.slice(start, index + 1));
  }

  throw new Error('Unterminated JSON object in CLI output.');
}

function findFirstNumberByKey(value, keys) {
  if (!value || typeof value !== 'object') return null;
  for (const key of keys) {
    if (Number.isInteger(value[key])) return value[key];
  }
  for (const item of Object.values(value)) {
    if (Array.isArray(item)) {
      for (const nested of item) {
        const found = findFirstNumberByKey(nested, keys);
        if (Number.isInteger(found)) return found;
      }
    } else if (item && typeof item === 'object') {
      const found = findFirstNumberByKey(item, keys);
      if (Number.isInteger(found)) return found;
    }
  }
  return null;
}

export function extractNavigateTabId(payload) {
  return findFirstNumberByKey(payload, ['tabId']);
}

export function buildPublicSmokeUrl(baseUrl, caseName, runId = 'manual') {
  const parsed = new URL(assertPublicHttpUrl(baseUrl));
  parsed.searchParams.set('tabrix_smoke_case', caseName);
  parsed.searchParams.set('tabrix_smoke_run', runId);
  return parsed.toString();
}

export function buildRedactedBrowserWorldSummary(payload, targetTabId = null) {
  const compactWindows = Array.isArray(payload?.compactSummary?.windows)
    ? payload.compactSummary.windows
    : [];
  const compactTabs = compactWindows.flatMap((window) =>
    Array.isArray(window?.tabs) ? window.tabs : [],
  );
  const activeTabId = payload?.compactSummary?.activeObject?.tabId ?? null;
  const allTabs = Array.isArray(payload?.browserWorld?.tabs) ? payload.browserWorld.tabs : [];
  const allWindows = Array.isArray(payload?.browserWorld?.windows)
    ? payload.browserWorld.windows
    : Array.isArray(payload?.windows)
      ? payload.windows
      : [];
  const targetTab = Number.isInteger(targetTabId)
    ? allTabs.find((tab) => tab?.tabId === targetTabId)
    : null;
  const compactTabLimit =
    compactWindows.find((window) => window?.compactTabLimit !== undefined)?.compactTabLimit ?? null;
  const compactSummaryBounded =
    compactWindows.length > 0 && Number.isInteger(compactTabLimit)
      ? compactWindows.every(
          (window) => Array.isArray(window?.tabs) && window.tabs.length <= Number(compactTabLimit),
        )
      : null;
  const omittedTabCount = compactWindows.reduce(
    (sum, window) => sum + (Number.isInteger(window?.omittedTabCount) ? window.omittedTabCount : 0),
    0,
  );
  const retentionPolicy = payload?.compactSummary?.retentionPolicy ?? payload?.retentionPolicy;
  const retentionWithinLimit =
    Number.isInteger(retentionPolicy?.recentEventLimit) &&
    Number.isInteger(retentionPolicy?.recentEventsRetained)
      ? retentionPolicy.recentEventsRetained <= retentionPolicy.recentEventLimit
      : null;
  const windowStateMatrix =
    payload?.compactSummary?.windowStateMatrix ?? payload?.summary?.windowStateMatrix ?? null;
  const windowOperationState =
    payload?.compactSummary?.windowOperationState ?? payload?.summary?.windowOperationState ?? null;
  const tabStateMatrix =
    payload?.compactSummary?.tabStateMatrix ?? payload?.summary?.tabStateMatrix ?? null;
  const tabLifecycleState =
    payload?.compactSummary?.tabLifecycleState ?? payload?.summary?.tabLifecycleState ?? null;
  const aiOperationState =
    payload?.compactSummary?.aiOperationState ?? payload?.summary?.aiOperationState ?? null;

  return {
    callSucceeded: true,
    source: payload?.source ?? 'unknown',
    windowCount: Number.isInteger(payload?.windowCount) ? payload.windowCount : null,
    tabCount: Number.isInteger(payload?.tabCount) ? payload.tabCount : null,
    hasCompactSummary: Boolean(payload?.compactSummary),
    compactTabLimit,
    compactSummaryBounded,
    omittedTabCount,
    compactTabsShown: compactTabs.length,
    retentionWithinLimit,
    retentionPolicy: retentionPolicy
      ? {
          recentEventLimit: Number.isInteger(retentionPolicy.recentEventLimit)
            ? retentionPolicy.recentEventLimit
            : null,
          recentEventsRetained: Number.isInteger(retentionPolicy.recentEventsRetained)
            ? retentionPolicy.recentEventsRetained
            : null,
          windowObjectsRetained: Number.isInteger(retentionPolicy.windowObjectsRetained)
            ? retentionPolicy.windowObjectsRetained
            : null,
          tabObjectsRetained: Number.isInteger(retentionPolicy.tabObjectsRetained)
            ? retentionPolicy.tabObjectsRetained
            : null,
          refreshMode: retentionPolicy.refreshMode ?? null,
          eventPrivacyBoundaryPresent: typeof retentionPolicy.eventPrivacyBoundary === 'string',
          detailBoundaryPresent: typeof retentionPolicy.detailBoundary === 'string',
        }
      : null,
    windowStateMatrix: windowStateMatrix
      ? {
          total: Number.isInteger(windowStateMatrix.total) ? windowStateMatrix.total : null,
          visible: Number.isInteger(windowStateMatrix.visible) ? windowStateMatrix.visible : null,
          minimized: Number.isInteger(windowStateMatrix.minimized)
            ? windowStateMatrix.minimized
            : null,
          unknownVisibility: Number.isInteger(windowStateMatrix.unknownVisibility)
            ? windowStateMatrix.unknownVisibility
            : null,
          focused: Number.isInteger(windowStateMatrix.focused) ? windowStateMatrix.focused : null,
          unfocused: Number.isInteger(windowStateMatrix.unfocused)
            ? windowStateMatrix.unfocused
            : null,
          focusUnknown: Number.isInteger(windowStateMatrix.focusUnknown)
            ? windowStateMatrix.focusUnknown
            : null,
          operable: Number.isInteger(windowStateMatrix.operable)
            ? windowStateMatrix.operable
            : null,
          inoperable: Number.isInteger(windowStateMatrix.inoperable)
            ? windowStateMatrix.inoperable
            : null,
          operabilityUnknown: Number.isInteger(windowStateMatrix.operabilityUnknown)
            ? windowStateMatrix.operabilityUnknown
            : null,
        }
      : null,
    windowStateConclusionPresent:
      typeof payload?.compactSummary?.windowStateConclusion === 'string' ||
      typeof payload?.summary?.windowStateConclusion === 'string',
    windowOperationState: windowOperationState
      ? {
          focusedWindowIdPresent: Number.isInteger(windowOperationState.focusedWindowId),
          focusedWindowState:
            typeof windowOperationState.focusedWindowState === 'string'
              ? windowOperationState.focusedWindowState
              : null,
          focusedWindowVisibilityState:
            typeof windowOperationState.focusedWindowVisibilityState === 'string'
              ? windowOperationState.focusedWindowVisibilityState
              : null,
          focusedWindowCanOperate:
            typeof windowOperationState.focusedWindowCanOperate === 'boolean'
              ? windowOperationState.focusedWindowCanOperate
              : null,
          focusedWindowActiveTabIdPresent: Number.isInteger(
            windowOperationState.focusedWindowActiveTabId,
          ),
          focusedWindowActiveTabCanOperate:
            typeof windowOperationState.focusedWindowActiveTabCanOperate === 'boolean'
              ? windowOperationState.focusedWindowActiveTabCanOperate
              : null,
          relationToCurrentOperableWindow:
            typeof windowOperationState.relationToCurrentOperableWindow === 'string'
              ? windowOperationState.relationToCurrentOperableWindow
              : null,
          canOperateFocusedWindow:
            typeof windowOperationState.canOperateFocusedWindow === 'boolean'
              ? windowOperationState.canOperateFocusedWindow
              : null,
          visibleWindowCount: Number.isInteger(windowOperationState.visibleWindowCount)
            ? windowOperationState.visibleWindowCount
            : null,
          minimizedWindowCount: Number.isInteger(windowOperationState.minimizedWindowCount)
            ? windowOperationState.minimizedWindowCount
            : null,
          operableWindowCount: Number.isInteger(windowOperationState.operableWindowCount)
            ? windowOperationState.operableWindowCount
            : null,
          inoperableWindowCount: Number.isInteger(windowOperationState.inoperableWindowCount)
            ? windowOperationState.inoperableWindowCount
            : null,
        }
      : null,
    currentWindowConclusionPresent:
      typeof payload?.compactSummary?.currentWindowConclusion === 'string' ||
      typeof payload?.summary?.currentWindowConclusion === 'string',
    tabStateMatrix: tabStateMatrix
      ? {
          total: Number.isInteger(tabStateMatrix.total) ? tabStateMatrix.total : null,
          active: Number.isInteger(tabStateMatrix.active) ? tabStateMatrix.active : null,
          background: Number.isInteger(tabStateMatrix.background)
            ? tabStateMatrix.background
            : null,
          activityUnknown: Number.isInteger(tabStateMatrix.activityUnknown)
            ? tabStateMatrix.activityUnknown
            : null,
          loading: Number.isInteger(tabStateMatrix.loading) ? tabStateMatrix.loading : null,
          complete: Number.isInteger(tabStateMatrix.complete) ? tabStateMatrix.complete : null,
          discarded: Number.isInteger(tabStateMatrix.discarded) ? tabStateMatrix.discarded : null,
          muted: Number.isInteger(tabStateMatrix.muted) ? tabStateMatrix.muted : null,
          pinned: Number.isInteger(tabStateMatrix.pinned) ? tabStateMatrix.pinned : null,
          aiOpened: Number.isInteger(tabStateMatrix.aiOpened) ? tabStateMatrix.aiOpened : null,
          userOrPageOpened: Number.isInteger(tabStateMatrix.userOrPageOpened)
            ? tabStateMatrix.userOrPageOpened
            : null,
          recentlyOperatedByAi: Number.isInteger(tabStateMatrix.recentlyOperatedByAi)
            ? tabStateMatrix.recentlyOperatedByAi
            : null,
          operable: Number.isInteger(tabStateMatrix.operable) ? tabStateMatrix.operable : null,
          inoperable: Number.isInteger(tabStateMatrix.inoperable)
            ? tabStateMatrix.inoperable
            : null,
          operabilityUnknown: Number.isInteger(tabStateMatrix.operabilityUnknown)
            ? tabStateMatrix.operabilityUnknown
            : null,
        }
      : null,
    tabStateConclusionPresent:
      typeof payload?.compactSummary?.tabStateConclusion === 'string' ||
      typeof payload?.summary?.tabStateConclusion === 'string',
    tabLifecycleState: tabLifecycleState
      ? {
          latestEventKind:
            typeof tabLifecycleState.latestEventKind === 'string'
              ? tabLifecycleState.latestEventKind
              : null,
          latestEventTabIdPresent: Number.isInteger(tabLifecycleState.latestEventTabId),
          latestEventWindowIdPresent: Number.isInteger(tabLifecycleState.latestEventWindowId),
          latestEventStatus:
            typeof tabLifecycleState.latestEventStatus === 'string'
              ? tabLifecycleState.latestEventStatus
              : null,
          latestReplacedTabIdPresent: Number.isInteger(tabLifecycleState.latestReplacedTabId),
          recentCreatedCount: Number.isInteger(tabLifecycleState.recentCreatedCount)
            ? tabLifecycleState.recentCreatedCount
            : null,
          recentUpdatedCount: Number.isInteger(tabLifecycleState.recentUpdatedCount)
            ? tabLifecycleState.recentUpdatedCount
            : null,
          recentActivatedCount: Number.isInteger(tabLifecycleState.recentActivatedCount)
            ? tabLifecycleState.recentActivatedCount
            : null,
          recentReplacedCount: Number.isInteger(tabLifecycleState.recentReplacedCount)
            ? tabLifecycleState.recentReplacedCount
            : null,
          recentRemovedCount: Number.isInteger(tabLifecycleState.recentRemovedCount)
            ? tabLifecycleState.recentRemovedCount
            : null,
          retainedTabCount: Number.isInteger(tabLifecycleState.retainedTabCount)
            ? tabLifecycleState.retainedTabCount
            : null,
          activeTabIdPresent: Number.isInteger(tabLifecycleState.activeTabId),
          aiOpenedRetainedCount: Number.isInteger(tabLifecycleState.aiOpenedRetainedCount)
            ? tabLifecycleState.aiOpenedRetainedCount
            : null,
          userOrPageOpenedRetainedCount: Number.isInteger(
            tabLifecycleState.userOrPageOpenedRetainedCount,
          )
            ? tabLifecycleState.userOrPageOpenedRetainedCount
            : null,
        }
      : null,
    tabLifecycleConclusionPresent:
      typeof payload?.compactSummary?.tabLifecycleConclusion === 'string' ||
      typeof payload?.summary?.tabLifecycleConclusion === 'string',
    aiOperationState: aiOperationState
      ? {
          browserActiveTabIdPresent: Number.isInteger(aiOperationState.browserActiveTabId),
          latestAiOperatedTabIdPresent: Number.isInteger(aiOperationState.latestAiOperatedTabId),
          latestAiOperation:
            typeof aiOperationState.latestAiOperation === 'string'
              ? aiOperationState.latestAiOperation
              : null,
          latestAiOperationAtMsPresent: Number.isInteger(aiOperationState.latestAiOperationAtMs),
          latestAiOperatedTabActive:
            typeof aiOperationState.latestAiOperatedTabActive === 'boolean'
              ? aiOperationState.latestAiOperatedTabActive
              : null,
          latestAiOperatedTabOpenedBy:
            typeof aiOperationState.latestAiOperatedTabOpenedBy === 'string'
              ? aiOperationState.latestAiOperatedTabOpenedBy
              : null,
          latestAiOperatedTabCanOperate:
            typeof aiOperationState.latestAiOperatedTabCanOperate === 'boolean'
              ? aiOperationState.latestAiOperatedTabCanOperate
              : null,
          relationToBrowserActiveTab:
            typeof aiOperationState.relationToBrowserActiveTab === 'string'
              ? aiOperationState.relationToBrowserActiveTab
              : null,
          canContinueOnLatestAiOperatedTab:
            typeof aiOperationState.canContinueOnLatestAiOperatedTab === 'boolean'
              ? aiOperationState.canContinueOnLatestAiOperatedTab
              : null,
          aiOpenedTabCount: Number.isInteger(aiOperationState.aiOpenedTabCount)
            ? aiOperationState.aiOpenedTabCount
            : null,
          recentlyOperatedTabCount: Number.isInteger(aiOperationState.recentlyOperatedTabCount)
            ? aiOperationState.recentlyOperatedTabCount
            : null,
          closedRetainedTabCount: Number.isInteger(aiOperationState.closedRetainedTabCount)
            ? aiOperationState.closedRetainedTabCount
            : null,
        }
      : null,
    currentOperationConclusionPresent:
      typeof payload?.compactSummary?.currentOperationConclusion === 'string' ||
      typeof payload?.summary?.currentOperationConclusion === 'string',
    browserObjectEdgeSummaryPresent:
      typeof payload?.compactSummary?.browserObjectEdgeSummary === 'string' ||
      typeof payload?.summary?.browserObjectEdgeSummary === 'string',
    dynamicObjectUpdateSummaryPresent:
      typeof payload?.compactSummary?.dynamicObjectUpdateSummary === 'string' ||
      typeof payload?.summary?.dynamicObjectUpdateSummary === 'string',
    activeTabIncludedInCompactTabs:
      Number.isInteger(activeTabId) && compactTabs.length
        ? compactTabs.some((tab) => tab?.tabId === activeTabId)
        : null,
    hasBrowserWorldDetail: Boolean(payload?.browserWorld),
    counts: {
      aiOpenedTabs: payload?.summary?.counts?.aiOpenedTabs ?? null,
      userOrPageOpenedTabs: payload?.summary?.counts?.userOrPageOpenedTabs ?? null,
      operableTabs: payload?.summary?.counts?.operableTabs ?? null,
    },
    windows: {
      total: allWindows.length,
      visible: allWindows.filter((window) => window?.visibilityState === 'visible').length,
      minimized: allWindows.filter((window) => window?.visibilityState === 'minimized').length,
      unknown: allWindows.filter(
        (window) => !['visible', 'minimized'].includes(String(window?.visibilityState || '')),
      ).length,
      focused: allWindows.filter((window) => window?.focused === true || window?.isFocused === true)
        .length,
      operable: allWindows.filter((window) => window?.canTabrixOperate === true).length,
    },
    targetTab: Number.isInteger(targetTabId)
      ? {
          wasFound: Boolean(targetTab),
          active: targetTab?.active ?? null,
          openedBy: targetTab?.openedBy ?? null,
          canTabrixOperate: targetTab?.canTabrixOperate ?? null,
          status: targetTab?.status ?? null,
        }
      : null,
    claimBoundary: payload?.compactSummary?.claimBoundary ?? null,
  };
}

export function buildRedactedReadPageAlignmentSummary(payload, targetTabId = null) {
  const ownershipRuntime = payload?.ownershipRuntime;
  const compact = payload?.browserPageObjectCompact;
  const fullObject = payload?.browserPageObject;
  const compactFacts = compact?.facts && typeof compact.facts === 'object' ? compact.facts : {};
  const compactWindowFacts =
    compactFacts.window && typeof compactFacts.window === 'object' ? compactFacts.window : {};
  const compactTabFacts =
    compactFacts.tab && typeof compactFacts.tab === 'object' ? compactFacts.tab : {};
  const pageRegions = Array.isArray(payload?.pageRegions) ? payload.pageRegions : [];
  const operationMap = payload?.pageOperationMap;
  const operationZones = Array.isArray(operationMap?.zones) ? operationMap.zones : [];
  const regionTypes = [
    ...new Set(
      pageRegions
        .map((region) => region?.regionType)
        .filter((regionType) => typeof regionType === 'string'),
    ),
  ].sort();
  const operationPurposes = [
    ...new Set(
      operationZones.map((zone) => zone?.purpose).filter((purpose) => typeof purpose === 'string'),
    ),
  ].sort();
  const targetableRegionCount = pageRegions.filter(
    (region) => region?.targetability === 'target_ref' || region?.targetability === 'locator_chain',
  ).length;
  const regionObjectCount = pageRegions.reduce(
    (count, region) => count + (Array.isArray(region?.objects) ? region.objects.length : 0),
    0,
  );
  const candidateActionRegionCount = pageRegions.filter(
    (region) => Array.isArray(region?.candidateActionIds) && region.candidateActionIds.length > 0,
  ).length;

  return {
    callSucceeded: true,
    hasOwnershipRuntime: Boolean(ownershipRuntime),
    hasBrowserPageObjectCompact: Boolean(compact),
    hasBrowserPageObject: Boolean(fullObject),
    runtime: {
      currentTabIdPresent: Number.isInteger(ownershipRuntime?.currentTabId),
      currentTabIdMatchesTarget:
        Number.isInteger(targetTabId) && Number.isInteger(ownershipRuntime?.currentTabId)
          ? ownershipRuntime.currentTabId === targetTabId
          : null,
      currentWindowIdPresent: Number.isInteger(ownershipRuntime?.currentWindowId),
      currentWindowState: ownershipRuntime?.currentWindowState ?? null,
      isCurrentTabActive: ownershipRuntime?.isCurrentTabActive ?? null,
      isCurrentWindowFocused: ownershipRuntime?.isCurrentWindowFocused ?? null,
      browserActiveTabIdKnown: ownershipRuntime?.browserActiveTabIdKnown ?? null,
      isReadTargetBrowserActiveTab: ownershipRuntime?.isReadTargetBrowserActiveTab ?? null,
      currentTabOpenedBy: ownershipRuntime?.currentTabOpenedBy ?? null,
      currentTabOpenedByConfidence: ownershipRuntime?.currentTabOpenedByConfidence ?? null,
      currentTabAiOperationState: ownershipRuntime?.currentTabAiOperationState ?? null,
      currentTabCanTabrixOperate: ownershipRuntime?.currentTabCanTabrixOperate ?? null,
      currentTabStatus: ownershipRuntime?.currentTabStatus ?? null,
      currentTabRuntimeStateSource: ownershipRuntime?.currentTabRuntimeStateSource ?? null,
      currentOwnerType: ownershipRuntime?.currentOwnerType ?? null,
    },
    compact: {
      source: compact?.source ?? null,
      status: compact?.status ?? null,
      watchStatus: compact?.watchStatus ?? null,
      changedGroupCount: Array.isArray(compact?.changedGroups)
        ? compact.changedGroups.length
        : null,
      transitionCount: Number.isInteger(compact?.transitionCount) ? compact.transitionCount : null,
      hasWindowFacts: Boolean(compactFacts.window),
      hasTabFacts: Boolean(compactFacts.tab),
      hasPageFacts: Boolean(compactFacts.page),
      hasTabPageObjectSummary: String(compact?.primaryConclusion || '').includes(
        'One Tab page object',
      ),
      safeWindowFacts: {
        currentWindowId: compactWindowFacts.currentWindowId ?? null,
        currentWindowState: compactWindowFacts.currentWindowState ?? null,
        isCurrentWindowFocused: compactWindowFacts.isCurrentWindowFocused ?? null,
      },
      safeTabFacts: {
        readTargetTabId: compactTabFacts.readTargetTabId ?? compactTabFacts.currentTabId ?? null,
        currentActiveTabId: compactTabFacts.currentActiveTabId ?? null,
        browserActiveTabId: compactTabFacts.browserActiveTabId ?? null,
        openedBy: compactTabFacts.openedBy ?? null,
        isRunOwnedByTask: compactTabFacts.isRunOwnedByTask ?? null,
        runtimeStateSource: compactTabFacts.runtimeStateSource ?? null,
      },
    },
    pageRegionRuntime: {
      pageRegionsPresent: pageRegions.length > 0,
      pageRegionCount: pageRegions.length,
      regionTypes,
      targetableRegionCount,
      regionObjectCount,
      candidateActionRegionCount,
      pageOperationMapPresent: Boolean(operationMap),
      operationZoneCount: operationZones.length,
      operationPurposes,
      operationClaimBoundaryPresent: typeof operationMap?.claimBoundary === 'string',
    },
    alignment: {
      ownershipRuntimePresent: Boolean(ownershipRuntime),
      browserPageObjectCompactPresent: Boolean(compact),
      browserPageObjectCompactSource:
        compact?.source === 'read_page_browser_page_object_compact'
          ? 'expected'
          : 'missing_or_other',
      browserWorldRuntimeSource:
        ownershipRuntime?.currentTabRuntimeStateSource === 'browser_world_inventory',
      tabPageObjectSummaryPresent: String(compact?.primaryConclusion || '').includes(
        'One Tab page object',
      ),
      currentTabIdPresent: Number.isInteger(ownershipRuntime?.currentTabId),
      currentWindowIdPresent: Number.isInteger(ownershipRuntime?.currentWindowId),
      currentWindowStateKnown: typeof ownershipRuntime?.currentWindowState === 'string',
      currentTabStatusKnown: typeof ownershipRuntime?.currentTabStatus === 'string',
      currentTabOperabilityKnown: typeof ownershipRuntime?.currentTabCanTabrixOperate === 'boolean',
      targetTabMatchesReadPage:
        Number.isInteger(targetTabId) && Number.isInteger(ownershipRuntime?.currentTabId)
          ? ownershipRuntime.currentTabId === targetTabId
          : null,
      readTargetIsBrowserActive: ownershipRuntime?.isReadTargetBrowserActiveTab ?? null,
      tabOwnerIsAi: ownershipRuntime?.currentTabOpenedBy === 'ai',
      tabOperable: ownershipRuntime?.currentTabCanTabrixOperate ?? null,
      pageRegionsPresent: pageRegions.length > 0,
      pageRegionClaimBoundariesPresent:
        pageRegions.length > 0 &&
        pageRegions.every((region) => typeof region?.claimBoundary === 'string'),
      pageOperationMapPresent: Boolean(operationMap),
      pageOperationZonesPresent: operationZones.length > 0,
      pageOperationClaimBoundaryPresent: typeof operationMap?.claimBoundary === 'string',
    },
    claimBoundary:
      'Redacted read_page alignment summary only. It proves candidate BrowserPageObject/runtime alignment for this public read snapshot, not page understanding correctness, login/logout completion, API/CDP reuse, release readiness, or product delivery grade.',
  };
}

function callCliJson(cliPath, args, timeoutMs) {
  const output = execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return extractJsonObject(output);
}

function callMcpTool(cliPath, toolName, toolArgs, timeoutMs) {
  const args = ['mcp', 'call', toolName];
  if (toolArgs && Object.keys(toolArgs).length) {
    args.push('--args', JSON.stringify(toolArgs));
  }
  return callCliJson(cliPath, args, timeoutMs);
}

function uniqueNumbers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))];
}

function buildStepSummary(step, payload, targetTabId) {
  const redacted = buildRedactedBrowserWorldSummary(payload, targetTabId);
  const expectedTargetActive = expectedTargetActiveForLifecycleStep(step);
  return {
    step,
    windowCount: redacted.windowCount,
    tabCount: redacted.tabCount,
    compactTabLimit: redacted.compactTabLimit,
    activeTabIncludedInCompactTabs: redacted.activeTabIncludedInCompactTabs,
    targetTab: redacted.targetTab,
    counts: redacted.counts,
    tabLifecycleState: redacted.tabLifecycleState,
    tabLifecycleConclusionPresent: redacted.tabLifecycleConclusionPresent,
    targetActiveMatchesLifecycleStep:
      expectedTargetActive === null ? null : redacted.targetTab?.active === expectedTargetActive,
    browserObjectEdgeSummaryPresent: redacted.browserObjectEdgeSummaryPresent,
    dynamicObjectUpdateSummaryPresent: redacted.dynamicObjectUpdateSummaryPresent,
    retentionWithinLimit: redacted.retentionWithinLimit,
    compactSummaryBounded: redacted.compactSummaryBounded,
  };
}

function expectedTargetActiveForLifecycleStep(step) {
  if (step === 'background_open') return false;
  if (
    step === 'foreground_open' ||
    step === 'switch_to_background_tab' ||
    step === 'new_window_open'
  ) {
    return true;
  }
  return null;
}

function closeRunTabs(cliPath, tabIds, timeoutMs) {
  const uniqueTabIds = uniqueNumbers(tabIds);
  if (!uniqueTabIds.length) {
    return { attempted: false, succeeded: null, requestedCount: 0, closedCount: 0 };
  }
  const closePayload = callMcpTool(
    cliPath,
    'chrome_close_tabs',
    { tabIds: uniqueTabIds },
    timeoutMs,
  );
  const closedCount = Number.isInteger(closePayload?.closedCount) ? closePayload.closedCount : 0;
  return {
    attempted: true,
    succeeded: closePayload?.success === true || closedCount === uniqueTabIds.length,
    requestedCount: uniqueTabIds.length,
    closedCount,
  };
}

function runSingleSmoke(cliPath, smokeUrl, args) {
  let openedTabId = null;
  if (!args.skipOpen) {
    const navigatePayload = callMcpTool(
      cliPath,
      'chrome_navigate',
      { url: smokeUrl },
      args.timeoutMs,
    );
    openedTabId = extractNavigateTabId(navigatePayload);
  }

  const browserWorldPayload = callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs);
  const redacted = buildRedactedBrowserWorldSummary(browserWorldPayload, openedTabId);
  const closeResult =
    Number.isInteger(openedTabId) && !args.keepOpen
      ? closeRunTabs(cliPath, [openedTabId], args.timeoutMs)
      : { attempted: false, succeeded: null, requestedCount: 0, closedCount: 0 };

  return {
    scenario: 'single',
    openedPublicTestTab: Number.isInteger(openedTabId),
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    redacted,
  };
}

function runLifecycleSmoke(cliPath, smokeUrl, args) {
  if (args.skipOpen) {
    throw new Error('--scenario lifecycle cannot be combined with --skip-open.');
  }

  const runId = String(Date.now());
  const openedTabIds = [];
  const lifecycleMatrix = [];

  const foregroundPayload = callMcpTool(
    cliPath,
    'chrome_navigate',
    { url: buildPublicSmokeUrl(smokeUrl, 'foreground', runId) },
    args.timeoutMs,
  );
  const foregroundTabId = extractNavigateTabId(foregroundPayload);
  openedTabIds.push(foregroundTabId);
  lifecycleMatrix.push(
    buildStepSummary(
      'foreground_open',
      callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
      foregroundTabId,
    ),
  );

  const backgroundPayload = callMcpTool(
    cliPath,
    'chrome_navigate',
    { url: buildPublicSmokeUrl(smokeUrl, 'background', runId), background: true },
    args.timeoutMs,
  );
  const backgroundTabId = extractNavigateTabId(backgroundPayload);
  openedTabIds.push(backgroundTabId);
  lifecycleMatrix.push(
    buildStepSummary(
      'background_open',
      callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
      backgroundTabId,
    ),
  );

  if (Number.isInteger(backgroundTabId)) {
    callMcpTool(cliPath, 'chrome_switch_tab', { tabId: backgroundTabId }, args.timeoutMs);
  }
  lifecycleMatrix.push(
    buildStepSummary(
      'switch_to_background_tab',
      callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
      backgroundTabId,
    ),
  );

  const newWindowPayload = callMcpTool(
    cliPath,
    'chrome_navigate',
    { url: buildPublicSmokeUrl(smokeUrl, 'new_window', runId), newWindow: true },
    args.timeoutMs,
  );
  const newWindowTabId = extractNavigateTabId(newWindowPayload);
  openedTabIds.push(newWindowTabId);
  lifecycleMatrix.push(
    buildStepSummary(
      'new_window_open',
      callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
      newWindowTabId,
    ),
  );

  const closeResult = args.keepOpen
    ? { attempted: false, succeeded: null, requestedCount: 0, closedCount: 0 }
    : closeRunTabs(cliPath, openedTabIds, args.timeoutMs);
  const postCleanup =
    closeResult.attempted === true
      ? buildStepSummary(
          'post_cleanup',
          callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
          null,
        )
      : null;

  return {
    scenario: 'lifecycle',
    openedPublicTestTabs: uniqueNumbers(openedTabIds).length,
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    cleanup: {
      requestedCount: closeResult.requestedCount,
      closedCount: closeResult.closedCount,
    },
    postCleanup,
    lifecycleMatrix,
  };
}

function runMatrixSmoke(cliPath, smokeUrls, args) {
  if (args.skipOpen) {
    throw new Error('--scenario matrix cannot be combined with --skip-open.');
  }
  const windowState = runWindowStateSmoke(cliPath, { ...args, skipOpen: true });
  const targets = smokeUrls.map((smokeUrl, index) => {
    const result = runLifecycleSmoke(cliPath, smokeUrl, args);
    return {
      targetIndex: index + 1,
      openedPublicTestTabs: result.openedPublicTestTabs,
      closeSucceeded: result.closeSucceeded,
      cleanup: result.cleanup,
      postCleanup: result.postCleanup,
      lifecycleMatrix: result.lifecycleMatrix,
      passed:
        result.openedPublicTestTabs === 3 &&
        result.closeSucceeded === true &&
        result.postCleanup?.retentionWithinLimit === true &&
        result.postCleanup?.compactSummaryBounded === true &&
        result.postCleanup?.browserObjectEdgeSummaryPresent === true &&
        (result.postCleanup?.tabLifecycleState?.recentRemovedCount ?? 0) >= 3 &&
        result.lifecycleMatrix.every(
          (step) =>
            step.targetTab?.wasFound === true &&
            step.targetTab?.openedBy === 'ai' &&
            step.targetTab?.canTabrixOperate === true &&
            step.targetActiveMatchesLifecycleStep === true &&
            step.browserObjectEdgeSummaryPresent === true &&
            step.dynamicObjectUpdateSummaryPresent === true &&
            step.retentionWithinLimit === true &&
            step.compactSummaryBounded === true &&
            step.activeTabIncludedInCompactTabs === true,
        ),
    };
  });
  const readPage = runReadPageSmoke(cliPath, smokeUrls[0], args);
  return {
    scenario: 'matrix',
    targetCount: targets.length,
    windowState,
    readPage,
    allTargetsPassed:
      windowState.verdict === 'WINDOW_STATE_OBSERVED' &&
      windowState.redacted.retentionWithinLimit === true &&
      windowState.redacted.compactSummaryBounded === true &&
      windowState.redacted.browserObjectEdgeSummaryPresent === true &&
      readPage.alignmentPassed === true &&
      readPage.redactedBrowserWorldAfterRead.retentionWithinLimit === true &&
      readPage.redactedBrowserWorldAfterRead.compactSummaryBounded === true &&
      readPage.redactedBrowserWorldAfterRead.browserObjectEdgeSummaryPresent === true &&
      targets.every((target) => target.passed),
    targets,
  };
}

function runWindowStateSmoke(cliPath, args) {
  if (!args.skipOpen) {
    // This scenario is observer-only by design; it must not create or mutate windows.
  }
  const browserWorldPayload = callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs);
  const redacted = buildRedactedBrowserWorldSummary(browserWorldPayload, null);
  return {
    scenario: 'window-state',
    observerOnly: true,
    redacted,
    verdict:
      redacted.windows.total > 0 &&
      redacted.hasBrowserWorldDetail &&
      redacted.browserObjectEdgeSummaryPresent === true
        ? 'WINDOW_STATE_OBSERVED'
        : 'WINDOW_STATE_NOT_PROVEN',
  };
}

function runReadPageMatrixSmoke(cliPath, smokeUrls, args) {
  if (args.skipOpen) {
    throw new Error('--scenario read-page-matrix cannot be combined with --skip-open.');
  }
  const targets = smokeUrls.map((smokeUrl, index) => {
    const result = runReadPageSmoke(cliPath, smokeUrl, args);
    return {
      targetIndex: index + 1,
      openedPublicTestTab: result.openedPublicTestTab,
      closeSucceeded: result.closeSucceeded,
      alignmentPassed: result.alignmentPassed,
      pageRegionRuntime: result.redactedReadPage.pageRegionRuntime,
      runtime: result.redactedReadPage.runtime,
      browserWorldAfterRead: {
        targetTabFound: result.redactedBrowserWorldAfterRead.targetTab?.wasFound ?? false,
        latestAiOperation:
          result.redactedBrowserWorldAfterRead.aiOperationState?.latestAiOperation ?? null,
        relationToBrowserActiveTab:
          result.redactedBrowserWorldAfterRead.aiOperationState?.relationToBrowserActiveTab ?? null,
        compactSummaryBounded: result.redactedBrowserWorldAfterRead.compactSummaryBounded,
        retentionWithinLimit: result.redactedBrowserWorldAfterRead.retentionWithinLimit,
      },
      passed:
        result.openedPublicTestTab === true &&
        result.closeSucceeded === true &&
        result.alignmentPassed === true &&
        result.redactedBrowserWorldAfterRead.targetTab?.wasFound === true &&
        result.redactedBrowserWorldAfterRead.compactSummaryBounded === true &&
        result.redactedBrowserWorldAfterRead.retentionWithinLimit === true,
    };
  });
  return {
    scenario: 'read-page-matrix',
    targetCount: targets.length,
    allTargetsPassed: targets.length > 0 && targets.every((target) => target.passed),
    targets,
    claimBoundary:
      'Redacted public no-login read_page matrix only. It proves runtime presence of Browser World alignment and page region operation-map evidence for these public pages, not page understanding correctness, private login/logout, API/CDP reuse, release readiness, or product delivery grade.',
  };
}

function runReadPageSmoke(cliPath, smokeUrl, args) {
  if (args.skipOpen) {
    throw new Error('--scenario read-page cannot be combined with --skip-open.');
  }

  const navigatePayload = callMcpTool(
    cliPath,
    'chrome_navigate',
    { url: buildPublicSmokeUrl(smokeUrl, 'read_page', String(Date.now())) },
    args.timeoutMs,
  );
  const openedTabId = extractNavigateTabId(navigatePayload);
  const readPagePayload = callMcpTool(
    cliPath,
    'chrome_read_page',
    Number.isInteger(openedTabId) ? { tabId: openedTabId, depth: 1 } : { depth: 1 },
    args.timeoutMs,
  );
  const redactedReadPage = buildRedactedReadPageAlignmentSummary(readPagePayload, openedTabId);
  const redactedBrowserWorldAfterRead = buildRedactedBrowserWorldSummary(
    callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
    openedTabId,
  );
  const closeResult =
    Number.isInteger(openedTabId) && !args.keepOpen
      ? closeRunTabs(cliPath, [openedTabId], args.timeoutMs)
      : { attempted: false, succeeded: null, requestedCount: 0, closedCount: 0 };

  return {
    scenario: 'read-page',
    openedPublicTestTab: Number.isInteger(openedTabId),
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    redactedReadPage,
    redactedBrowserWorldAfterRead,
    alignmentPassed:
      redactedReadPage.alignment.ownershipRuntimePresent === true &&
      redactedReadPage.alignment.browserPageObjectCompactPresent === true &&
      redactedReadPage.alignment.browserPageObjectCompactSource === 'expected' &&
      redactedReadPage.alignment.browserWorldRuntimeSource === true &&
      redactedReadPage.alignment.tabPageObjectSummaryPresent === true &&
      redactedReadPage.alignment.currentTabIdPresent === true &&
      redactedReadPage.alignment.currentWindowIdPresent === true &&
      redactedReadPage.alignment.currentWindowStateKnown === true &&
      redactedReadPage.alignment.currentTabStatusKnown === true &&
      redactedReadPage.alignment.currentTabOperabilityKnown === true &&
      redactedReadPage.alignment.targetTabMatchesReadPage === true &&
      redactedReadPage.alignment.readTargetIsBrowserActive === true &&
      redactedReadPage.alignment.tabOwnerIsAi === true &&
      redactedReadPage.alignment.tabOperable === true &&
      redactedReadPage.alignment.pageRegionsPresent === true &&
      redactedReadPage.alignment.pageRegionClaimBoundariesPresent === true &&
      redactedReadPage.alignment.pageOperationMapPresent === true &&
      redactedReadPage.alignment.pageOperationZonesPresent === true &&
      redactedReadPage.alignment.pageOperationClaimBoundaryPresent === true &&
      redactedBrowserWorldAfterRead.targetTab?.wasFound === true &&
      redactedBrowserWorldAfterRead.browserObjectEdgeSummaryPresent === true &&
      redactedBrowserWorldAfterRead.aiOperationState?.latestAiOperatedTabIdPresent === true &&
      redactedBrowserWorldAfterRead.aiOperationState?.latestAiOperation === 'read_page' &&
      redactedBrowserWorldAfterRead.aiOperationState?.relationToBrowserActiveTab ===
        'same_as_browser_active',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      `Usage: node scripts/mcp-redacted-browser-world-smoke.mjs [--url https://example.com/] [--urls https://example.com/,https://example.org/] [--scenario single|lifecycle|matrix|window-state|read-page|read-page-matrix] [--skip-open] [--keep-open]\n`,
    );
    return;
  }

  const smokeUrls = resolveSmokeUrls(args);
  const smokeUrl = smokeUrls[0];
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cliPath = path.join(rootDir, 'app', 'native-server', 'dist', 'cli.js');

  try {
    const smokeResult =
      args.scenario === 'matrix'
        ? runMatrixSmoke(cliPath, smokeUrls, args)
        : args.scenario === 'window-state'
          ? runWindowStateSmoke(cliPath, args)
          : args.scenario === 'read-page'
            ? runReadPageSmoke(cliPath, smokeUrl, args)
            : args.scenario === 'read-page-matrix'
              ? runReadPageMatrixSmoke(cliPath, smokeUrls, args)
              : args.scenario === 'lifecycle'
                ? runLifecycleSmoke(cliPath, smokeUrl, args)
                : runSingleSmoke(cliPath, smokeUrl, args);

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          smokeKind: 'redacted_browser_world_mcp_smoke',
          ...smokeResult,
          privacyBoundary:
            'No tab URLs, titles, account state, screenshots, cookies, network bodies, or page text are printed by this script.',
        },
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          smokeKind: 'redacted_browser_world_mcp_smoke',
          error: error instanceof Error ? error.message : String(error),
          privacyBoundary:
            'Failure output is redacted; raw MCP stdout/stderr is intentionally not printed.',
        },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
