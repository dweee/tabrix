#!/usr/bin/env node

/* global process, URL */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PUBLIC_URL = 'https://example.com/?tabrix_browser_world_smoke=1';
const REDACTED_OUTPUT_BYTE_LIMIT = 64 * 1024;

export function parseArgs(argv) {
  const args = {
    url: DEFAULT_PUBLIC_URL,
    urls: [],
    keepOpen: false,
    skipOpen: false,
    sampleCount: 3,
    sampleIntervalMs: 250,
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
    } else if (part === '--sample-count') {
      const parsed = Number(argv[index + 1]);
      if (Number.isInteger(parsed) && parsed > 0) {
        args.sampleCount = Math.min(parsed, 10);
      }
      index += 1;
    } else if (part === '--sample-interval-ms') {
      const parsed = Number(argv[index + 1]);
      if (Number.isInteger(parsed) && parsed >= 0) {
        args.sampleIntervalMs = Math.min(parsed, 5_000);
      }
      index += 1;
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

function sleepMs(ms) {
  if (!Number.isInteger(ms) || ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

const FORBIDDEN_REDACTED_OUTPUT_KEYS = new Set([
  'url',
  'rawUrl',
  'privateUrl',
  'pendingUrl',
  'title',
  'rawTitle',
  'account',
  'accountId',
  'accountName',
  'accountState',
  'profileName',
  'qrCode',
  'qrImage',
  'qrPayload',
  'cookie',
  'cookies',
  'authorization',
  'authToken',
  'token',
  'secret',
  'screenshot',
  'screenshots',
  'rawScreenshot',
  'rawImage',
  'networkRequest',
  'networkResponse',
  'networkBody',
  'rawNetworkBody',
  'requestBody',
  'responseBody',
  'pageText',
  'markdown',
]);

const FORBIDDEN_REDACTED_OUTPUT_STRING_PATTERNS = [
  {
    pattern: /https?:\/\//i,
    reason: 'raw URL',
  },
  {
    pattern: /data:image\//i,
    reason: 'raw image payload',
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/i,
    reason: 'authorization bearer token',
  },
  {
    pattern: /\b(?:Cookie|Set-Cookie):\s*[^;\s=]+=/i,
    reason: 'cookie header',
  },
  {
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
    reason: 'private key material',
  },
];

export function assertRedactedSmokeOutputSafe(value, pathParts = []) {
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string') {
      for (const { pattern, reason } of FORBIDDEN_REDACTED_OUTPUT_STRING_PATTERNS) {
        if (pattern.test(value)) {
          throw new Error(
            `Redacted smoke output contains ${reason} at ${pathParts.join('.') || '<root>'}.`,
          );
        }
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertRedactedSmokeOutputSafe(item, [...pathParts, String(index)]),
    );
    return;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_REDACTED_OUTPUT_KEYS.has(key)) {
      throw new Error(`Redacted smoke output contains forbidden raw field "${key}".`);
    }
    assertRedactedSmokeOutputSafe(nested, [...pathParts, key]);
  }
}

export function stringifyRedactedSmokeOutput(output, byteLimit = REDACTED_OUTPUT_BYTE_LIMIT) {
  assertRedactedSmokeOutputSafe(output);
  const serialized = JSON.stringify(output, null, 2);
  const byteLength = Buffer.byteLength(serialized, 'utf8');
  if (byteLength > byteLimit) {
    throw new Error(
      `Redacted smoke output is too large: ${byteLength} byte(s), limit ${byteLimit} byte(s).`,
    );
  }
  return `${serialized}\n`;
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

function redactTabAttributeGroups(groups) {
  if (!groups || typeof groups !== 'object') return null;
  return {
    identity: groups.identity
      ? {
          objectKind:
            typeof groups.identity.objectKind === 'string' ? groups.identity.objectKind : null,
          tabIdPresent: Number.isInteger(groups.identity.tabId),
          windowIdPresent: Number.isInteger(groups.identity.windowId),
          urlPresent: typeof groups.identity.url === 'string' && groups.identity.url.length > 0,
          titlePresent:
            typeof groups.identity.title === 'string' && groups.identity.title.length > 0,
        }
      : null,
    runtime: groups.runtime
      ? {
          active: typeof groups.runtime.active === 'boolean' ? groups.runtime.active : null,
          status: typeof groups.runtime.status === 'string' ? groups.runtime.status : null,
          pendingUrlPresent:
            typeof groups.runtime.pendingUrl === 'string' && groups.runtime.pendingUrl.length > 0,
          discarded:
            typeof groups.runtime.discarded === 'boolean' ? groups.runtime.discarded : null,
          audible: typeof groups.runtime.audible === 'boolean' ? groups.runtime.audible : null,
          muted: typeof groups.runtime.muted === 'boolean' ? groups.runtime.muted : null,
          pinned: typeof groups.runtime.pinned === 'boolean' ? groups.runtime.pinned : null,
          openerTabIdPresent: Number.isInteger(groups.runtime.openerTabId),
        }
      : null,
    ownership: groups.ownership
      ? {
          openedBy:
            typeof groups.ownership.openedBy === 'string' ? groups.ownership.openedBy : null,
          confidence:
            typeof groups.ownership.confidence === 'number' ? groups.ownership.confidence : null,
          reasonPresent: typeof groups.ownership.reason === 'string',
          aiOperationState:
            typeof groups.ownership.aiOperationState === 'string'
              ? groups.ownership.aiOperationState
              : null,
          lastAiOperation:
            typeof groups.ownership.lastAiOperation === 'string'
              ? groups.ownership.lastAiOperation
              : null,
          lastAiOperationAtMsPresent: Number.isInteger(groups.ownership.lastAiOperationAtMs),
          lastAiOperationConfidence:
            typeof groups.ownership.lastAiOperationConfidence === 'number'
              ? groups.ownership.lastAiOperationConfidence
              : null,
          lastAiOperationReasonPresent: typeof groups.ownership.lastAiOperationReason === 'string',
        }
      : null,
    operability: groups.operability
      ? {
          canTabrixOperate:
            typeof groups.operability.canTabrixOperate === 'boolean'
              ? groups.operability.canTabrixOperate
              : null,
          reason: typeof groups.operability.reason === 'string' ? groups.operability.reason : null,
        }
      : null,
  };
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
  const refreshHealth =
    payload?.compactSummary?.refreshHealth ??
    payload?.browserWorld?.refreshHealth ??
    payload?.refreshHealth;
  const retentionWithinLimit =
    Number.isInteger(retentionPolicy?.recentEventLimit) &&
    Number.isInteger(retentionPolicy?.recentEventsRetained)
      ? retentionPolicy.recentEventsRetained <= retentionPolicy.recentEventLimit
      : null;
  const windowStateMatrix =
    payload?.compactSummary?.windowStateMatrix ?? payload?.summary?.windowStateMatrix ?? null;
  const windowOperationState =
    payload?.compactSummary?.windowOperationState ?? payload?.summary?.windowOperationState ?? null;
  const windowLifecycleState =
    payload?.compactSummary?.windowLifecycleState ?? payload?.summary?.windowLifecycleState ?? null;
  const tabStateMatrix =
    payload?.compactSummary?.tabStateMatrix ?? payload?.summary?.tabStateMatrix ?? null;
  const tabLifecycleState =
    payload?.compactSummary?.tabLifecycleState ?? payload?.summary?.tabLifecycleState ?? null;
  const aiOperationState =
    payload?.compactSummary?.aiOperationState ?? payload?.summary?.aiOperationState ?? null;
  const objectInventory =
    payload?.compactSummary?.objectInventory ?? payload?.summary?.objectInventory ?? null;
  const activeObject = payload?.compactSummary?.activeObject ?? null;
  const browserActiveObject = payload?.compactSummary?.browserActiveObject ?? null;
  const latestAiOperatedObject = payload?.compactSummary?.latestAiOperatedObject ?? null;
  const currentTabAttributeGroups =
    payload?.compactSummary?.currentTabAttributeGroups ??
    payload?.summary?.currentTabAttributeGroups ??
    null;
  const lastAiOperatedTabAttributeGroups =
    payload?.compactSummary?.lastAiOperatedTabAttributeGroups ??
    payload?.summary?.lastAiOperatedTabAttributeGroups ??
    null;
  const operationRouting = payload?.compactSummary?.operationRouting ?? null;
  const aiRoutingBrief = payload?.compactSummary?.aiRoutingBrief ?? null;
  const operationTargetBrief = payload?.compactSummary?.operationTargetBrief ?? null;
  const aiActionReadiness = payload?.compactSummary?.aiActionReadiness ?? null;
  const redactCompactOperationObject = (object) =>
    object
      ? {
          objectPresent: true,
          role: typeof object.role === 'string' ? object.role : null,
          tabIdPresent: Number.isInteger(object.tabId),
          windowIdPresent: Number.isInteger(object.windowId),
          active: typeof object.active === 'boolean' ? object.active : null,
          status: typeof object.status === 'string' ? object.status : null,
          openedBy: typeof object.openedBy === 'string' ? object.openedBy : null,
          openedByConfidence:
            typeof object.openedByConfidence === 'number' ? object.openedByConfidence : null,
          aiOperationState:
            typeof object.aiOperationState === 'string' ? object.aiOperationState : null,
          lastAiOperation:
            typeof object.lastAiOperation === 'string' ? object.lastAiOperation : null,
          lastAiOperationConfidence:
            typeof object.lastAiOperationConfidence === 'number'
              ? object.lastAiOperationConfidence
              : null,
          lastAiOperationReasonPresent: typeof object.lastAiOperationReason === 'string',
          canTabrixOperate:
            typeof object.canTabrixOperate === 'boolean' ? object.canTabrixOperate : null,
          operabilityReason:
            typeof object.operabilityReason === 'string' ? object.operabilityReason : null,
        }
      : { objectPresent: false };

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
          minFullChromeResyncIntervalMs: Number.isInteger(
            retentionPolicy.minFullChromeResyncIntervalMs,
          )
            ? retentionPolicy.minFullChromeResyncIntervalMs
            : null,
          eventPrivacyBoundaryPresent: typeof retentionPolicy.eventPrivacyBoundary === 'string',
          detailBoundaryPresent: typeof retentionPolicy.detailBoundary === 'string',
        }
      : null,
    refreshHealth: refreshHealth
      ? {
          fullChromeResyncCount: Number.isInteger(refreshHealth.fullChromeResyncCount)
            ? refreshHealth.fullChromeResyncCount
            : null,
          skippedChromeResyncCount: Number.isInteger(refreshHealth.skippedChromeResyncCount)
            ? refreshHealth.skippedChromeResyncCount
            : null,
          minFullChromeResyncIntervalMs: Number.isInteger(
            refreshHealth.minFullChromeResyncIntervalMs,
          )
            ? refreshHealth.minFullChromeResyncIntervalMs
            : null,
          lastFullChromeResyncDurationMs: Number.isInteger(
            refreshHealth.lastFullChromeResyncDurationMs,
          )
            ? refreshHealth.lastFullChromeResyncDurationMs
            : null,
          lastFullChromeResyncStatus:
            typeof refreshHealth.lastFullChromeResyncStatus === 'string'
              ? refreshHealth.lastFullChromeResyncStatus
              : null,
          lastFullChromeResyncReason:
            typeof refreshHealth.lastFullChromeResyncReason === 'string'
              ? refreshHealth.lastFullChromeResyncReason
              : null,
          lastRefreshDecision:
            typeof refreshHealth.lastRefreshDecision === 'string'
              ? refreshHealth.lastRefreshDecision
              : null,
          lastRefreshDecisionReasonPresent:
            typeof refreshHealth.lastRefreshDecisionReason === 'string',
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
    windowLifecycleState: windowLifecycleState
      ? {
          latestEventKind:
            typeof windowLifecycleState.latestEventKind === 'string'
              ? windowLifecycleState.latestEventKind
              : null,
          latestEventWindowIdPresent: Number.isInteger(windowLifecycleState.latestEventWindowId),
          latestEventState:
            typeof windowLifecycleState.latestEventState === 'string'
              ? windowLifecycleState.latestEventState
              : null,
          latestEventVisibilityState:
            typeof windowLifecycleState.latestEventVisibilityState === 'string'
              ? windowLifecycleState.latestEventVisibilityState
              : null,
          latestEventCanTabrixOperate:
            typeof windowLifecycleState.latestEventCanTabrixOperate === 'boolean'
              ? windowLifecycleState.latestEventCanTabrixOperate
              : null,
          recentCreatedCount: Number.isInteger(windowLifecycleState.recentCreatedCount)
            ? windowLifecycleState.recentCreatedCount
            : null,
          recentRemovedCount: Number.isInteger(windowLifecycleState.recentRemovedCount)
            ? windowLifecycleState.recentRemovedCount
            : null,
          recentFocusChangedCount: Number.isInteger(windowLifecycleState.recentFocusChangedCount)
            ? windowLifecycleState.recentFocusChangedCount
            : null,
          recentBoundsChangedCount: Number.isInteger(windowLifecycleState.recentBoundsChangedCount)
            ? windowLifecycleState.recentBoundsChangedCount
            : null,
          retainedWindowCount: Number.isInteger(windowLifecycleState.retainedWindowCount)
            ? windowLifecycleState.retainedWindowCount
            : null,
          focusedWindowIdPresent: Number.isInteger(windowLifecycleState.focusedWindowId),
          visibleWindowCount: Number.isInteger(windowLifecycleState.visibleWindowCount)
            ? windowLifecycleState.visibleWindowCount
            : null,
          minimizedWindowCount: Number.isInteger(windowLifecycleState.minimizedWindowCount)
            ? windowLifecycleState.minimizedWindowCount
            : null,
          operableWindowCount: Number.isInteger(windowLifecycleState.operableWindowCount)
            ? windowLifecycleState.operableWindowCount
            : null,
          inoperableWindowCount: Number.isInteger(windowLifecycleState.inoperableWindowCount)
            ? windowLifecycleState.inoperableWindowCount
            : null,
        }
      : null,
    windowLifecycleConclusionPresent:
      typeof payload?.compactSummary?.windowLifecycleConclusion === 'string' ||
      typeof payload?.summary?.windowLifecycleConclusion === 'string',
    objectInventory: objectInventory
      ? {
          objectModelPresent: typeof objectInventory.objectModel === 'string',
          compactIdLimit: Number.isInteger(objectInventory.compactIdLimit)
            ? objectInventory.compactIdLimit
            : null,
          windowObjectCount: Number.isInteger(objectInventory.windowObjectCount)
            ? objectInventory.windowObjectCount
            : null,
          tabPageObjectCount: Number.isInteger(objectInventory.tabPageObjectCount)
            ? objectInventory.tabPageObjectCount
            : null,
          activeWindowIdPresent: Number.isInteger(objectInventory.activeWindowId),
          browserActiveTabIdPresent: Number.isInteger(objectInventory.browserActiveTabId),
          latestAiOperatedTabIdPresent: Number.isInteger(objectInventory.latestAiOperatedTabId),
          latestAiOperationConfidence:
            typeof objectInventory.latestAiOperationConfidence === 'number'
              ? objectInventory.latestAiOperationConfidence
              : null,
          latestAiOperationReasonPresent:
            typeof objectInventory.latestAiOperationReason === 'string',
          currentOperationRelation:
            typeof objectInventory.currentOperationRelation === 'string'
              ? objectInventory.currentOperationRelation
              : null,
          canContinueOnLatestAiOperatedTab:
            typeof objectInventory.canContinueOnLatestAiOperatedTab === 'boolean'
              ? objectInventory.canContinueOnLatestAiOperatedTab
              : null,
          aiOpenedShown: Array.isArray(objectInventory.aiOpened?.ids)
            ? objectInventory.aiOpened.ids.length
            : null,
          userOrPageOpenedShown: Array.isArray(objectInventory.userOrPageOpened?.ids)
            ? objectInventory.userOrPageOpened.ids.length
            : null,
          unknownOpenedShown: Array.isArray(objectInventory.unknownOpened?.ids)
            ? objectInventory.unknownOpened.ids.length
            : null,
          operableShown: Array.isArray(objectInventory.operable?.ids)
            ? objectInventory.operable.ids.length
            : null,
          inoperableShown: Array.isArray(objectInventory.inoperable?.ids)
            ? objectInventory.inoperable.ids.length
            : null,
          recentlyOperatedByAiShown: Array.isArray(objectInventory.recentlyOperatedByAi?.ids)
            ? objectInventory.recentlyOperatedByAi.ids.length
            : null,
          summaryPresent: typeof objectInventory.summary === 'string',
          claimBoundaryPresent: typeof objectInventory.claimBoundary === 'string',
        }
      : null,
    activeObject: activeObject
      ? {
          tabIdPresent: Number.isInteger(activeObject.tabId),
          windowIdPresent: Number.isInteger(activeObject.windowId),
          tabStatus: typeof activeObject.tabStatus === 'string' ? activeObject.tabStatus : null,
          openedBy: typeof activeObject.openedBy === 'string' ? activeObject.openedBy : null,
          canTabrixOperate:
            typeof activeObject.canTabrixOperate === 'boolean'
              ? activeObject.canTabrixOperate
              : null,
          tabOperabilityReason:
            typeof activeObject.tabOperabilityReason === 'string'
              ? activeObject.tabOperabilityReason
              : null,
          windowOperabilityReason:
            typeof activeObject.windowOperabilityReason === 'string'
              ? activeObject.windowOperabilityReason
              : null,
        }
      : null,
    browserActiveObject: redactCompactOperationObject(browserActiveObject),
    latestAiOperatedObject: redactCompactOperationObject(latestAiOperatedObject),
    currentTabAttributeGroups: redactTabAttributeGroups(currentTabAttributeGroups),
    lastAiOperatedTabAttributeGroups: redactTabAttributeGroups(lastAiOperatedTabAttributeGroups),
    tabAttributeGroupClaimBoundaryPresent:
      typeof payload?.compactSummary?.tabAttributeGroupClaimBoundary === 'string',
    operationRouting: operationRouting
      ? {
          browserActiveTabIdPresent: Number.isInteger(operationRouting.browserActiveTabId),
          latestAiOperatedTabIdPresent: Number.isInteger(operationRouting.latestAiOperatedTabId),
          relationToBrowserActiveTab:
            typeof operationRouting.relationToBrowserActiveTab === 'string'
              ? operationRouting.relationToBrowserActiveTab
              : null,
          canContinueOnLatestAiOperatedTab:
            typeof operationRouting.canContinueOnLatestAiOperatedTab === 'boolean'
              ? operationRouting.canContinueOnLatestAiOperatedTab
              : null,
          latestAiOperation:
            typeof operationRouting.latestAiOperation === 'string'
              ? operationRouting.latestAiOperation
              : null,
          latestAiOperationConfidence:
            typeof operationRouting.latestAiOperationConfidence === 'number'
              ? operationRouting.latestAiOperationConfidence
              : null,
          latestAiOperationReasonPresent:
            typeof operationRouting.latestAiOperationReason === 'string',
          summaryPresent: typeof operationRouting.summary === 'string',
          claimBoundaryPresent: typeof operationRouting.claimBoundary === 'string',
        }
      : null,
    aiRoutingBrief: aiRoutingBrief
      ? {
          summaryPresent: typeof aiRoutingBrief.summary === 'string',
          recommendedNextCheckPresent: typeof aiRoutingBrief.recommendedNextCheck === 'string',
          canContinueOnLatestAiOperatedTab:
            typeof aiRoutingBrief.canContinueOnLatestAiOperatedTab === 'boolean'
              ? aiRoutingBrief.canContinueOnLatestAiOperatedTab
              : null,
          claimBoundaryPresent: typeof aiRoutingBrief.claimBoundary === 'string',
        }
      : null,
    operationTargetBrief: operationTargetBrief
      ? {
          targetTabIdPresent: Number.isInteger(operationTargetBrief.targetTabId),
          targetWindowIdPresent: Number.isInteger(operationTargetBrief.targetWindowId),
          targetRole:
            typeof operationTargetBrief.targetRole === 'string'
              ? operationTargetBrief.targetRole
              : null,
          targetBasis:
            typeof operationTargetBrief.targetBasis === 'string'
              ? operationTargetBrief.targetBasis
              : null,
          targetCanTabrixOperate:
            typeof operationTargetBrief.targetCanTabrixOperate === 'boolean'
              ? operationTargetBrief.targetCanTabrixOperate
              : null,
          targetOperabilityReason:
            typeof operationTargetBrief.targetOperabilityReason === 'string'
              ? operationTargetBrief.targetOperabilityReason
              : null,
          browserActiveTabIdPresent: Number.isInteger(operationTargetBrief.browserActiveTabId),
          latestAiOperatedTabIdPresent: Number.isInteger(
            operationTargetBrief.latestAiOperatedTabId,
          ),
          relationToBrowserActiveTab:
            typeof operationTargetBrief.relationToBrowserActiveTab === 'string'
              ? operationTargetBrief.relationToBrowserActiveTab
              : null,
          shouldReselectBeforeAction:
            typeof operationTargetBrief.shouldReselectBeforeAction === 'boolean'
              ? operationTargetBrief.shouldReselectBeforeAction
              : null,
          nextRequiredCheck:
            typeof operationTargetBrief.nextRequiredCheck === 'string'
              ? operationTargetBrief.nextRequiredCheck
              : null,
          summaryPresent: typeof operationTargetBrief.summary === 'string',
          claimBoundaryPresent: typeof operationTargetBrief.claimBoundary === 'string',
        }
      : null,
    aiActionReadiness: aiActionReadiness
      ? {
          readiness:
            typeof aiActionReadiness.readiness === 'string' ? aiActionReadiness.readiness : null,
          targetRole:
            typeof aiActionReadiness.targetRole === 'string' ? aiActionReadiness.targetRole : null,
          targetTabIdPresent: Number.isInteger(aiActionReadiness.targetTabId),
          browserActiveTabIdPresent: Number.isInteger(aiActionReadiness.browserActiveTabId),
          latestAiOperatedTabIdPresent: Number.isInteger(aiActionReadiness.latestAiOperatedTabId),
          canProceedToPageLevelCheck:
            typeof aiActionReadiness.canProceedToPageLevelCheck === 'boolean'
              ? aiActionReadiness.canProceedToPageLevelCheck
              : null,
          requiredBeforeAction:
            typeof aiActionReadiness.requiredBeforeAction === 'string'
              ? aiActionReadiness.requiredBeforeAction
              : null,
          summaryPresent: typeof aiActionReadiness.summary === 'string',
          claimBoundaryPresent: typeof aiActionReadiness.claimBoundary === 'string',
        }
      : null,
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
          latestChangedAttributes: [
            tabLifecycleState.latestUrlChanged === true ? 'url' : null,
            tabLifecycleState.latestTitleChanged === true ? 'title' : null,
            tabLifecycleState.latestStatusChanged === true ? 'status' : null,
            tabLifecycleState.latestAudibleChanged === true ? 'audible' : null,
            tabLifecycleState.latestMutedChanged === true ? 'muted' : null,
            tabLifecycleState.latestPinnedChanged === true ? 'pinned' : null,
            tabLifecycleState.latestDiscardedChanged === true ? 'discarded' : null,
          ].filter(Boolean),
          latestReplacedTabIdPresent: Number.isInteger(tabLifecycleState.latestReplacedTabId),
          recentCreatedCount: Number.isInteger(tabLifecycleState.recentCreatedCount)
            ? tabLifecycleState.recentCreatedCount
            : null,
          recentUpdatedCount: Number.isInteger(tabLifecycleState.recentUpdatedCount)
            ? tabLifecycleState.recentUpdatedCount
            : null,
          recentUrlChangedCount: Number.isInteger(tabLifecycleState.recentUrlChangedCount)
            ? tabLifecycleState.recentUrlChangedCount
            : null,
          recentTitleChangedCount: Number.isInteger(tabLifecycleState.recentTitleChangedCount)
            ? tabLifecycleState.recentTitleChangedCount
            : null,
          recentStatusChangedCount: Number.isInteger(tabLifecycleState.recentStatusChangedCount)
            ? tabLifecycleState.recentStatusChangedCount
            : null,
          recentRuntimeFlagChangedCount: [
            tabLifecycleState.recentAudibleChangedCount,
            tabLifecycleState.recentMutedChangedCount,
            tabLifecycleState.recentPinnedChangedCount,
            tabLifecycleState.recentDiscardedChangedCount,
          ].reduce((total, value) => total + (Number.isInteger(value) ? value : 0), 0),
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
    primaryConclusionPresent:
      typeof payload?.compactSummary?.primaryConclusion === 'string' ||
      typeof payload?.summary?.primaryConclusion === 'string',
    browserObjectSnapshotConclusionPresent: String(
      payload?.compactSummary?.primaryConclusion || payload?.summary?.primaryConclusion || '',
    ).startsWith('Browser object snapshot:'),
    objectInventoryPresent: Boolean(objectInventory),
    browserObjectEdgeSummaryPresent:
      typeof payload?.compactSummary?.browserObjectEdgeSummary === 'string' ||
      typeof payload?.summary?.browserObjectEdgeSummary === 'string',
    objectChangeSummaryPresent:
      typeof payload?.compactSummary?.objectChangeSummary === 'string' ||
      typeof payload?.summary?.objectChangeSummary === 'string',
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
  const ownershipRuntimeAiOperationEvidencePresent =
    typeof ownershipRuntime?.currentTabLastAiOperation === 'string' &&
    typeof ownershipRuntime?.currentTabLastAiOperationConfidence === 'number' &&
    typeof ownershipRuntime?.currentTabLastAiOperationReason === 'string';
  const compactAiOperationEvidencePresent =
    typeof compactTabFacts?.lastAiOperation === 'string' &&
    typeof compactTabFacts?.lastAiOperationConfidence === 'number' &&
    typeof compactTabFacts?.lastAiOperationReason === 'string';
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
      currentTabLastAiOperation: ownershipRuntime?.currentTabLastAiOperation ?? null,
      currentTabLastAiOperationConfidence:
        typeof ownershipRuntime?.currentTabLastAiOperationConfidence === 'number'
          ? ownershipRuntime.currentTabLastAiOperationConfidence
          : null,
      currentTabLastAiOperationReasonPresent:
        typeof ownershipRuntime?.currentTabLastAiOperationReason === 'string',
      currentTabCanTabrixOperate: ownershipRuntime?.currentTabCanTabrixOperate ?? null,
      currentTabStatus: ownershipRuntime?.currentTabStatus ?? null,
      currentTabRuntimeStateSource: ownershipRuntime?.currentTabRuntimeStateSource ?? null,
      currentOwnerType: ownershipRuntime?.currentOwnerType ?? null,
      browserWorldObjectChangeSummaryPresent:
        typeof ownershipRuntime?.browserWorldObjectChangeSummary === 'string',
      browserWorldCurrentOperationConclusionPresent:
        typeof ownershipRuntime?.browserWorldCurrentOperationConclusion === 'string',
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
        lastAiOperation: compactTabFacts.lastAiOperation ?? null,
        lastAiOperationConfidence: compactTabFacts.lastAiOperationConfidence ?? null,
        lastAiOperationReasonPresent: typeof compactTabFacts.lastAiOperationReason === 'string',
        browserWorldObjectChangeSummaryPresent:
          typeof compactTabFacts.browserWorldObjectChangeSummary === 'string',
        browserWorldCurrentOperationConclusionPresent:
          typeof compactTabFacts.browserWorldCurrentOperationConclusion === 'string',
        isRunOwnedByTask: compactTabFacts.isRunOwnedByTask ?? null,
        runtimeStateSource: compactTabFacts.runtimeStateSource ?? null,
        operationTargetRole:
          typeof compactTabFacts.operationTargetRole === 'string'
            ? compactTabFacts.operationTargetRole
            : null,
        operationTargetBasis:
          typeof compactTabFacts.operationTargetBasis === 'string'
            ? compactTabFacts.operationTargetBasis
            : null,
        operationTargetCanTabrixOperate:
          typeof compactTabFacts.operationTargetCanTabrixOperate === 'boolean'
            ? compactTabFacts.operationTargetCanTabrixOperate
            : null,
        operationTargetOperabilityReason:
          typeof compactTabFacts.operationTargetOperabilityReason === 'string'
            ? compactTabFacts.operationTargetOperabilityReason
            : null,
        shouldReselectBeforeAction:
          typeof compactTabFacts.shouldReselectBeforeAction === 'boolean'
            ? compactTabFacts.shouldReselectBeforeAction
            : null,
        nextRequiredCheck:
          typeof compactTabFacts.nextRequiredCheck === 'string'
            ? compactTabFacts.nextRequiredCheck
            : null,
        operationTargetSummaryPresent: typeof compactTabFacts.operationTargetSummary === 'string',
        operationTargetClaimBoundaryPresent:
          typeof compactTabFacts.operationTargetClaimBoundary === 'string',
        actionReadiness:
          typeof compactTabFacts.actionReadiness === 'string'
            ? compactTabFacts.actionReadiness
            : null,
        canProceedToPageLevelCheck:
          typeof compactTabFacts.canProceedToPageLevelCheck === 'boolean'
            ? compactTabFacts.canProceedToPageLevelCheck
            : null,
        requiredBeforeAction:
          typeof compactTabFacts.requiredBeforeAction === 'string'
            ? compactTabFacts.requiredBeforeAction
            : null,
        actionReadinessSummaryPresent: typeof compactTabFacts.actionReadinessSummary === 'string',
        actionReadinessClaimBoundaryPresent:
          typeof compactTabFacts.actionReadinessClaimBoundary === 'string',
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
      ownershipRuntimeAiOperationEvidencePresent,
      compactAiOperationEvidencePresent,
      currentTabAiOperationEvidencePresent:
        ownershipRuntimeAiOperationEvidencePresent || compactAiOperationEvidencePresent,
      browserWorldObjectChangeSummaryPresent:
        typeof ownershipRuntime?.browserWorldObjectChangeSummary === 'string' &&
        typeof compactTabFacts.browserWorldObjectChangeSummary === 'string',
      browserWorldCurrentOperationConclusionPresent:
        typeof ownershipRuntime?.browserWorldCurrentOperationConclusion === 'string' &&
        typeof compactTabFacts.browserWorldCurrentOperationConclusion === 'string',
      operationTargetBriefPresent:
        typeof compactTabFacts.operationTargetRole === 'string' &&
        typeof compactTabFacts.operationTargetBasis === 'string' &&
        typeof compactTabFacts.operationTargetCanTabrixOperate === 'boolean' &&
        typeof compactTabFacts.operationTargetOperabilityReason === 'string' &&
        typeof compactTabFacts.shouldReselectBeforeAction === 'boolean' &&
        typeof compactTabFacts.nextRequiredCheck === 'string' &&
        typeof compactTabFacts.operationTargetSummary === 'string' &&
        typeof compactTabFacts.operationTargetClaimBoundary === 'string',
      actionReadinessBriefPresent:
        typeof compactTabFacts.actionReadiness === 'string' &&
        typeof compactTabFacts.canProceedToPageLevelCheck === 'boolean' &&
        typeof compactTabFacts.requiredBeforeAction === 'string' &&
        typeof compactTabFacts.actionReadinessSummary === 'string' &&
        typeof compactTabFacts.actionReadinessClaimBoundary === 'string',
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

export function buildStepSummary(step, payload, targetTabId) {
  const redacted = buildRedactedBrowserWorldSummary(payload, targetTabId);
  const expectedTargetActive = expectedTargetActiveForLifecycleStep(step);
  const expectedRelationToBrowserActiveTab = expectedRelationToBrowserActiveForLifecycleStep(step);
  const expectedOperationTargetRole = expectedOperationTargetRoleForLifecycleStep(step);
  const expectedLatestAiOperation = expectedLatestAiOperationForLifecycleStep(step);
  return {
    step,
    windowCount: redacted.windowCount,
    tabCount: redacted.tabCount,
    compactTabLimit: redacted.compactTabLimit,
    activeTabIncludedInCompactTabs: redacted.activeTabIncludedInCompactTabs,
    activeObject: redacted.activeObject,
    browserActiveObject: redacted.browserActiveObject,
    latestAiOperatedObject: redacted.latestAiOperatedObject,
    currentTabAttributeGroups: redacted.currentTabAttributeGroups,
    lastAiOperatedTabAttributeGroups: redacted.lastAiOperatedTabAttributeGroups,
    tabAttributeGroupClaimBoundaryPresent: redacted.tabAttributeGroupClaimBoundaryPresent,
    operationRouting: redacted.operationRouting,
    aiRoutingBrief: redacted.aiRoutingBrief,
    operationTargetBrief: redacted.operationTargetBrief,
    aiActionReadiness: redacted.aiActionReadiness,
    targetTab: redacted.targetTab,
    counts: redacted.counts,
    tabLifecycleState: redacted.tabLifecycleState,
    tabLifecycleConclusionPresent: redacted.tabLifecycleConclusionPresent,
    targetActiveMatchesLifecycleStep:
      expectedTargetActive === null ? null : redacted.targetTab?.active === expectedTargetActive,
    expectedRelationToBrowserActiveTab,
    relationToBrowserActiveMatchesLifecycleStep:
      expectedRelationToBrowserActiveTab === null
        ? null
        : redacted.operationRouting?.relationToBrowserActiveTab ===
          expectedRelationToBrowserActiveTab,
    expectedOperationTargetRole,
    operationTargetRoleMatchesLifecycleStep:
      expectedOperationTargetRole === null
        ? null
        : redacted.operationTargetBrief?.targetRole === expectedOperationTargetRole,
    expectedLatestAiOperation,
    latestAiOperationMatchesLifecycleStep:
      expectedLatestAiOperation === null
        ? null
        : redacted.operationRouting?.latestAiOperation === expectedLatestAiOperation &&
          redacted.browserActiveObject?.lastAiOperation === expectedLatestAiOperation,
    browserObjectEdgeSummaryPresent: redacted.browserObjectEdgeSummaryPresent,
    objectChangeSummaryPresent: redacted.objectChangeSummaryPresent,
    dynamicObjectUpdateSummaryPresent: redacted.dynamicObjectUpdateSummaryPresent,
    retentionWithinLimit: redacted.retentionWithinLimit,
    compactSummaryBounded: redacted.compactSummaryBounded,
  };
}

export function buildPostCloseTargetCleanupSummary(payload, targetTabIds) {
  return uniqueNumbers(targetTabIds).map((tabId, index) => {
    const redacted = buildRedactedBrowserWorldSummary(payload, tabId);
    const targetNoLongerRetained = redacted.targetTab?.wasFound === false;
    return {
      targetIndex: index + 1,
      targetTabFound: redacted.targetTab?.wasFound ?? false,
      targetNoLongerRetained,
      closedTargetNotOperable: targetNoLongerRetained
        ? true
        : redacted.targetTab?.canTabrixOperate === false,
      compactSummaryBounded: redacted.compactSummaryBounded,
      retentionWithinLimit: redacted.retentionWithinLimit,
      claimBoundary:
        'Post-close cleanup summary uses redacted Browser World object retention only; it does not expose URL, title, page content, account state, or task success.',
    };
  });
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

function expectedRelationToBrowserActiveForLifecycleStep(step) {
  if (step === 'background_open') return 'latest_ai_operated_background_tab';
  if (
    step === 'foreground_open' ||
    step === 'switch_to_background_tab' ||
    step === 'new_window_open'
  ) {
    return 'same_as_browser_active';
  }
  return null;
}

function expectedOperationTargetRoleForLifecycleStep(step) {
  if (step === 'background_open') return 'latest_ai_operated_background_tab';
  if (
    step === 'foreground_open' ||
    step === 'switch_to_background_tab' ||
    step === 'new_window_open'
  ) {
    return 'latest_ai_operated_active_tab';
  }
  return null;
}

function expectedLatestAiOperationForLifecycleStep(step) {
  if (step === 'foreground_open' || step === 'background_open') return 'navigate_new_tab';
  if (step === 'switch_to_background_tab') return 'switch_tab';
  if (step === 'new_window_open') return 'navigate_new_window_tab';
  return null;
}

export function isLifecycleStepPassing(step) {
  return (
    step?.targetTab?.wasFound === true &&
    step.targetTab.openedBy === 'ai' &&
    step.targetTab.canTabrixOperate === true &&
    step.targetActiveMatchesLifecycleStep === true &&
    step.relationToBrowserActiveMatchesLifecycleStep === true &&
    step.operationTargetRoleMatchesLifecycleStep === true &&
    step.latestAiOperationMatchesLifecycleStep === true &&
    step.browserObjectEdgeSummaryPresent === true &&
    step.objectChangeSummaryPresent === true &&
    step.dynamicObjectUpdateSummaryPresent === true &&
    step.retentionWithinLimit === true &&
    step.compactSummaryBounded === true &&
    step.activeObject?.tabIdPresent === true &&
    typeof step.activeObject?.tabStatus === 'string' &&
    typeof step.activeObject?.tabOperabilityReason === 'string' &&
    typeof step.activeObject?.windowOperabilityReason === 'string' &&
    step.browserActiveObject?.objectPresent === true &&
    step.browserActiveObject?.tabIdPresent === true &&
    typeof step.browserActiveObject?.operabilityReason === 'string' &&
    step.latestAiOperatedObject?.objectPresent === true &&
    step.latestAiOperatedObject?.tabIdPresent === true &&
    typeof step.latestAiOperatedObject?.operabilityReason === 'string' &&
    step.currentTabAttributeGroups?.identity?.tabIdPresent === true &&
    typeof step.currentTabAttributeGroups?.runtime?.status === 'string' &&
    typeof step.currentTabAttributeGroups?.ownership?.openedBy === 'string' &&
    typeof step.currentTabAttributeGroups?.operability?.reason === 'string' &&
    step.lastAiOperatedTabAttributeGroups?.identity?.tabIdPresent === true &&
    typeof step.lastAiOperatedTabAttributeGroups?.runtime?.status === 'string' &&
    typeof step.lastAiOperatedTabAttributeGroups?.ownership?.openedBy === 'string' &&
    typeof step.lastAiOperatedTabAttributeGroups?.operability?.reason === 'string' &&
    step.tabAttributeGroupClaimBoundaryPresent === true &&
    step.operationRouting?.browserActiveTabIdPresent === true &&
    step.operationRouting?.latestAiOperatedTabIdPresent === true &&
    typeof step.operationRouting?.relationToBrowserActiveTab === 'string' &&
    step.operationRouting?.summaryPresent === true &&
    step.operationRouting?.claimBoundaryPresent === true &&
    step.aiRoutingBrief?.summaryPresent === true &&
    step.aiRoutingBrief?.recommendedNextCheckPresent === true &&
    step.aiRoutingBrief?.claimBoundaryPresent === true &&
    step.operationTargetBrief?.targetTabIdPresent === true &&
    typeof step.operationTargetBrief?.targetRole === 'string' &&
    typeof step.operationTargetBrief?.nextRequiredCheck === 'string' &&
    step.operationTargetBrief?.summaryPresent === true &&
    step.operationTargetBrief?.claimBoundaryPresent === true &&
    hasAiActionReadiness(step) &&
    step.activeTabIncludedInCompactTabs === true
  );
}

export function buildPublicNoLoginLifecycleCoverageSummary(result) {
  const openedPublicTestTabs = Number.isInteger(result?.openedPublicTestTabs)
    ? result.openedPublicTestTabs
    : 0;
  const steps = new Set(
    Array.isArray(result?.lifecycleMatrix)
      ? result.lifecycleMatrix.map((step) => step?.step).filter((step) => typeof step === 'string')
      : [],
  );
  const lifecycle = result?.postCleanup?.tabLifecycleState ?? {};
  const recentCreatedCount = Number.isInteger(lifecycle.recentCreatedCount)
    ? lifecycle.recentCreatedCount
    : null;
  const recentUpdatedCount = Number.isInteger(lifecycle.recentUpdatedCount)
    ? lifecycle.recentUpdatedCount
    : null;
  const recentActivatedCount = Number.isInteger(lifecycle.recentActivatedCount)
    ? lifecycle.recentActivatedCount
    : null;
  const recentRemovedCount = Number.isInteger(lifecycle.recentRemovedCount)
    ? lifecycle.recentRemovedCount
    : null;
  const postCloseTargets = Array.isArray(result?.postCloseTargets) ? result.postCloseTargets : [];
  const tabCreatedObserved =
    openedPublicTestTabs > 0 &&
    recentCreatedCount !== null &&
    recentCreatedCount >= openedPublicTestTabs;
  const tabActivatedObserved =
    (recentActivatedCount !== null && recentActivatedCount > 0) ||
    steps.has('switch_to_background_tab');
  const tabRemovedObserved =
    openedPublicTestTabs > 0 &&
    recentRemovedCount !== null &&
    recentRemovedCount >= openedPublicTestTabs;
  const postCloseTargetCleanupObserved =
    result?.cleanupTargetsPassed === true &&
    postCloseTargets.length === openedPublicTestTabs &&
    postCloseTargets.every(
      (target) =>
        target?.targetNoLongerRetained === true && target?.closedTargetNotOperable === true,
    );
  const newWindowTabObserved = steps.has('new_window_open');

  return {
    publicNoLoginOnly: true,
    coveredInThisRun: {
      tabCreated: tabCreatedObserved,
      tabUpdated: recentUpdatedCount !== null && recentUpdatedCount > 0,
      tabActivated: tabActivatedObserved,
      tabRemoved: tabRemovedObserved,
      foregroundTabOpen: steps.has('foreground_open'),
      backgroundTabOpen: steps.has('background_open'),
      switchToBackgroundTab: steps.has('switch_to_background_tab'),
      newWindowTabOpen: newWindowTabObserved,
      postCloseTargetCleanup: postCloseTargetCleanupObserved,
    },
    notProvenInThisRun: [
      'tab_replaced',
      'tab_attached',
      'tab_detached',
      'window_minimize_restore',
      'private_or_login_page_lifecycle',
    ],
    minimumPublicLifecycleCoveragePassed:
      tabCreatedObserved === true &&
      tabActivatedObserved === true &&
      tabRemovedObserved === true &&
      newWindowTabObserved === true &&
      postCloseTargetCleanupObserved === true,
    claimBoundary:
      'Public no-login lifecycle coverage proves only the listed browser object transitions observed in this run. It does not prove tab replace/attach/detach, window minimize/restore mutation, private/login flows, page understanding correctness, API/CDP reuse, release readiness, or product delivery grade.',
  };
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
  const postCleanupPayload =
    closeResult.attempted === true
      ? callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs)
      : null;
  const postCleanup =
    postCleanupPayload !== null ? buildStepSummary('post_cleanup', postCleanupPayload, null) : null;
  const postCloseTargets =
    postCleanupPayload !== null
      ? buildPostCloseTargetCleanupSummary(postCleanupPayload, openedTabIds)
      : [];
  const cleanupTargetsPassed =
    closeResult.attempted === true
      ? postCloseTargets.length === uniqueNumbers(openedTabIds).length &&
        postCloseTargets.every(
          (target) =>
            target.targetTabFound === false &&
            target.targetNoLongerRetained === true &&
            target.closedTargetNotOperable === true &&
            target.compactSummaryBounded === true &&
            target.retentionWithinLimit === true,
        )
      : null;
  const allLifecycleStepsPassed = lifecycleMatrix.every((step) => isLifecycleStepPassing(step));

  const result = {
    scenario: 'lifecycle',
    openedPublicTestTabs: uniqueNumbers(openedTabIds).length,
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    cleanupTargetsPassed,
    allLifecycleStepsPassed,
    cleanup: {
      requestedCount: closeResult.requestedCount,
      closedCount: closeResult.closedCount,
    },
    postCleanup,
    postCloseTargets,
    lifecycleMatrix,
  };
  return {
    ...result,
    publicLifecycleCoverage: buildPublicNoLoginLifecycleCoverageSummary(result),
  };
}

function runMatrixSmoke(cliPath, smokeUrls, args) {
  if (args.skipOpen) {
    throw new Error('--scenario matrix cannot be combined with --skip-open.');
  }
  const windowState = runWindowStateSmoke(cliPath, { ...args, skipOpen: true });
  const targets = smokeUrls.map((smokeUrl, index) => {
    const result = runLifecycleSmoke(cliPath, smokeUrl, args);
    const lifecycleMatrix = result.lifecycleMatrix.map((step) => ({
      step: step.step,
      targetFound: step.targetTab?.wasFound ?? null,
      targetOpenedBy: step.targetTab?.openedBy ?? null,
      targetCanTabrixOperate: step.targetTab?.canTabrixOperate ?? null,
      targetActiveMatchesLifecycleStep: step.targetActiveMatchesLifecycleStep,
      relationToBrowserActiveMatchesLifecycleStep: step.relationToBrowserActiveMatchesLifecycleStep,
      operationTargetRoleMatchesLifecycleStep: step.operationTargetRoleMatchesLifecycleStep,
      latestAiOperationMatchesLifecycleStep: step.latestAiOperationMatchesLifecycleStep,
      currentTabAttributeGroupsPresent:
        step.currentTabAttributeGroups?.identity?.tabIdPresent === true,
      lastAiOperatedTabAttributeGroupsPresent:
        step.lastAiOperatedTabAttributeGroups?.identity?.tabIdPresent === true,
      retentionWithinLimit: step.retentionWithinLimit,
      compactSummaryBounded: step.compactSummaryBounded,
    }));
    return {
      targetIndex: index + 1,
      openedPublicTestTabs: result.openedPublicTestTabs,
      closeSucceeded: result.closeSucceeded,
      cleanup: result.cleanup,
      postCleanup: result.postCleanup,
      postCloseTargets: result.postCloseTargets,
      publicLifecycleCoverage: result.publicLifecycleCoverage,
      lifecycleMatrix,
      passed:
        result.openedPublicTestTabs === 3 &&
        result.closeSucceeded === true &&
        result.cleanupTargetsPassed === true &&
        result.allLifecycleStepsPassed === true &&
        result.publicLifecycleCoverage?.minimumPublicLifecycleCoveragePassed === true &&
        result.postCleanup?.retentionWithinLimit === true &&
        result.postCleanup?.compactSummaryBounded === true &&
        result.postCleanup?.browserObjectEdgeSummaryPresent === true &&
        result.postCleanup?.currentTabAttributeGroups?.identity?.tabIdPresent === true &&
        (result.postCleanup?.tabLifecycleState?.recentRemovedCount ?? 0) >= 3,
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
      readPage.redactedBrowserWorldAfterRead.objectChangeSummaryPresent === true &&
      targets.every((target) => target.passed),
    targets,
  };
}

export function buildWindowStateMutationProof(redactedWindowState) {
  return {
    requestedCapability: 'window_minimize_restore',
    observationOnly: true,
    windowStateObserved:
      redactedWindowState?.windows?.total > 0 &&
      Boolean(redactedWindowState?.windowStateMatrix) &&
      Boolean(redactedWindowState?.windowOperationState),
    mutationToolAvailable: false,
    mutationAttempted: false,
    verdict: 'NOT_PROVEN_NO_SAFE_MCP_WINDOW_MUTATION_TOOL',
    claimBoundary:
      'This public smoke can observe BrowserWindowObject state, but it does not prove minimize/restore transitions because the current public MCP tool list has no safe window-state mutation tool.',
  };
}

function hasCurrentTabAttributeGroups(redacted) {
  return (
    redacted?.currentTabAttributeGroups?.identity?.tabIdPresent === true &&
    typeof redacted.currentTabAttributeGroups?.runtime?.status === 'string' &&
    typeof redacted.currentTabAttributeGroups?.ownership?.openedBy === 'string' &&
    typeof redacted.currentTabAttributeGroups?.operability?.reason === 'string' &&
    redacted?.tabAttributeGroupClaimBoundaryPresent === true
  );
}

function hasAiActionReadiness(redacted) {
  return (
    typeof redacted?.aiActionReadiness?.readiness === 'string' &&
    typeof redacted.aiActionReadiness?.targetRole === 'string' &&
    typeof redacted.aiActionReadiness?.canProceedToPageLevelCheck === 'boolean' &&
    typeof redacted.aiActionReadiness?.requiredBeforeAction === 'string' &&
    redacted.aiActionReadiness?.summaryPresent === true &&
    redacted.aiActionReadiness?.claimBoundaryPresent === true
  );
}

export function buildWindowStateDriftSummary(samples, options = {}) {
  const observedSamples = samples.filter((sample) => sample?.verdict === 'WINDOW_STATE_OBSERVED');
  const compactBoundedSamples = samples.filter(
    (sample) => sample?.redacted?.compactSummaryBounded === true,
  );
  const retentionBoundedSamples = samples.filter(
    (sample) => sample?.redacted?.retentionWithinLimit === true,
  );
  const refreshHealthSamples = samples.filter(
    (sample) => typeof sample?.redacted?.refreshHealth?.lastRefreshDecision === 'string',
  );
  const windowLifecycleSamples = samples.filter(
    (sample) =>
      sample?.redacted?.windowLifecycleState &&
      sample?.redacted?.windowLifecycleConclusionPresent === true,
  );
  const currentTabAttributeGroupSamples = samples.filter((sample) =>
    hasCurrentTabAttributeGroups(sample?.redacted),
  );
  const aiActionReadinessSamples = samples.filter((sample) =>
    hasAiActionReadiness(sample?.redacted),
  );
  const refreshHealthValues = samples
    .map((sample) => sample?.redacted?.refreshHealth)
    .filter((refreshHealth) => refreshHealth && typeof refreshHealth === 'object');
  const refreshDecisions = refreshHealthValues.map(
    (refreshHealth) => refreshHealth.lastRefreshDecision,
  );
  const minFullChromeResyncIntervals = refreshHealthValues
    .map((refreshHealth) => refreshHealth.minFullChromeResyncIntervalMs)
    .filter(Number.isInteger);
  const minimumObservedFullResyncIntervalMs =
    minFullChromeResyncIntervals.length > 0 ? Math.min(...minFullChromeResyncIntervals) : null;
  const requestedSampleIntervalMs = Number.isInteger(options?.sampleIntervalMs)
    ? options.sampleIntervalMs
    : null;
  const observedSampleIntervalsMs = Array.isArray(options?.observedSampleIntervalsMs)
    ? options.observedSampleIntervalsMs.filter(Number.isInteger)
    : [];
  const minimumObservedSampleIntervalMs =
    observedSampleIntervalsMs.length > 0 ? Math.min(...observedSampleIntervalsMs) : null;
  const sampledInsideThrottleWindow =
    samples.length > 1 &&
    minimumObservedSampleIntervalMs !== null &&
    minimumObservedFullResyncIntervalMs !== null &&
    minimumObservedSampleIntervalMs < minimumObservedFullResyncIntervalMs;
  const skippedRecentResyncObserved = refreshHealthValues.some(
    (refreshHealth) =>
      refreshHealth.lastRefreshDecision === 'skipped_recent_resync' ||
      (Number.isInteger(refreshHealth.skippedChromeResyncCount) &&
        refreshHealth.skippedChromeResyncCount > 0),
  );
  const windowCounts = samples.map((sample) => sample?.redacted?.windows?.total);
  const tabCounts = samples.map((sample) => sample?.redacted?.tabCount);
  const focusedWindowCounts = samples.map((sample) => sample?.redacted?.windows?.focused);
  const focusedWindowStates = samples.map(
    (sample) => sample?.redacted?.windowOperationState?.focusedWindowState,
  );
  const uniqueKnownValues = (values) => new Set(values.filter((value) => value !== null)).size;
  const allPresent = (values) => values.every((value) => value !== null && value !== undefined);
  const windowCountStable = allPresent(windowCounts) && uniqueKnownValues(windowCounts) <= 1;
  const tabCountStable = allPresent(tabCounts) && uniqueKnownValues(tabCounts) <= 1;
  const focusedWindowCountStable =
    allPresent(focusedWindowCounts) && uniqueKnownValues(focusedWindowCounts) <= 1;
  const focusedWindowStateStable =
    allPresent(focusedWindowStates) && uniqueKnownValues(focusedWindowStates) <= 1;

  return {
    sampleCount: samples.length,
    allSamplesObserved: samples.length > 0 && observedSamples.length === samples.length,
    allSamplesCompactBounded: samples.length > 0 && compactBoundedSamples.length === samples.length,
    allSamplesRetentionBounded:
      samples.length > 0 && retentionBoundedSamples.length === samples.length,
    allSamplesRefreshHealthPresent:
      samples.length > 0 && refreshHealthSamples.length === samples.length,
    allSamplesWindowLifecyclePresent:
      samples.length > 0 && windowLifecycleSamples.length === samples.length,
    refreshThrottleProof: {
      requestedSampleIntervalMs,
      minimumObservedSampleIntervalMs,
      minimumObservedFullResyncIntervalMs,
      sampledInsideThrottleWindow,
      fullChromeResyncSamples: refreshDecisions.filter(
        (decision) => decision === 'full_chrome_resync',
      ).length,
      skippedRecentResyncSamples: refreshDecisions.filter(
        (decision) => decision === 'skipped_recent_resync',
      ).length,
      failedRefreshSamples: refreshDecisions.filter((decision) => decision === 'failed').length,
      unavailableRefreshSamples: refreshDecisions.filter(
        (decision) => decision === 'chrome_inventory_unavailable',
      ).length,
      skippedRecentResyncObserved,
      proofSatisfied: sampledInsideThrottleWindow ? skippedRecentResyncObserved : true,
      claimBoundary:
        'Throttle proof uses redacted refresh decisions only. It proves repeated observer sampling did not require every sample to perform a full Chrome resync; it does not prove page content or task success.',
    },
    allSamplesCurrentTabAttributeGroupsPresent:
      samples.length > 0 && currentTabAttributeGroupSamples.length === samples.length,
    allSamplesAiActionReadinessPresent:
      samples.length > 0 && aiActionReadinessSamples.length === samples.length,
    windowCountStable,
    tabCountStable,
    focusedWindowCountStable,
    focusedWindowStateStable,
    driftObserved:
      !windowCountStable ||
      !tabCountStable ||
      !focusedWindowCountStable ||
      !focusedWindowStateStable,
    claimBoundary:
      'Observer-only repeated Browser World sampling. Drift can be caused by real browser, user, or page activity and is not by itself a product failure.',
  };
}

function runWindowStateSmoke(cliPath, args) {
  if (!args.skipOpen) {
    // This scenario is observer-only by design; it must not create or mutate windows.
  }
  const browserWorldPayload = callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs);
  const redacted = buildRedactedBrowserWorldSummary(browserWorldPayload, null);
  const windowStateMutation = buildWindowStateMutationProof(redacted);
  return {
    scenario: 'window-state',
    observerOnly: true,
    redacted,
    windowStateMutation,
    verdict:
      redacted.windows.total > 0 &&
      redacted.hasBrowserWorldDetail &&
      redacted.objectInventoryPresent === true &&
      redacted.browserObjectSnapshotConclusionPresent === true &&
      redacted.browserObjectEdgeSummaryPresent === true &&
      Boolean(redacted.windowLifecycleState) &&
      redacted.windowLifecycleConclusionPresent === true &&
      hasCurrentTabAttributeGroups(redacted) &&
      hasAiActionReadiness(redacted)
        ? 'WINDOW_STATE_OBSERVED'
        : 'WINDOW_STATE_NOT_PROVEN',
  };
}

function runWindowStateDriftSmoke(cliPath, args) {
  const samples = [];
  const sampleStartTimes = [];
  for (let index = 0; index < args.sampleCount; index += 1) {
    sampleStartTimes.push(Date.now());
    samples.push(runWindowStateSmoke(cliPath, { ...args, skipOpen: true }));
    if (index < args.sampleCount - 1) sleepMs(args.sampleIntervalMs);
  }
  const observedSampleIntervalsMs = sampleStartTimes
    .slice(1)
    .map((startedAtMs, index) => Math.max(0, startedAtMs - sampleStartTimes[index]));
  const driftSummary = buildWindowStateDriftSummary(samples, {
    sampleIntervalMs: args.sampleIntervalMs,
    observedSampleIntervalsMs,
  });
  return {
    scenario: 'window-state-drift',
    observerOnly: true,
    sampleCount: samples.length,
    sampleIntervalMs: args.sampleIntervalMs,
    driftSummary,
    samples: samples.map((sample, index) => ({
      sampleIndex: index + 1,
      verdict: sample.verdict,
      windowCount: sample.redacted.windowCount,
      tabCount: sample.redacted.tabCount,
      compactSummaryBounded: sample.redacted.compactSummaryBounded,
      retentionWithinLimit: sample.redacted.retentionWithinLimit,
      refreshHealth: sample.redacted.refreshHealth,
      currentTabAttributeGroups: sample.redacted.currentTabAttributeGroups,
      tabAttributeGroupClaimBoundaryPresent: sample.redacted.tabAttributeGroupClaimBoundaryPresent,
      objectInventory: sample.redacted.objectInventory,
      windowStateMatrix: sample.redacted.windowStateMatrix,
      windowOperationState: sample.redacted.windowOperationState,
      windowLifecycleState: sample.redacted.windowLifecycleState,
      windowLifecycleConclusionPresent: sample.redacted.windowLifecycleConclusionPresent,
      windowStateMutation: sample.windowStateMutation,
    })),
    verdict:
      driftSummary.allSamplesObserved === true &&
      driftSummary.allSamplesCompactBounded === true &&
      driftSummary.allSamplesRetentionBounded === true &&
      driftSummary.allSamplesRefreshHealthPresent === true &&
      driftSummary.allSamplesWindowLifecyclePresent === true &&
      driftSummary.refreshThrottleProof.proofSatisfied === true &&
      driftSummary.allSamplesCurrentTabAttributeGroupsPresent === true &&
      driftSummary.allSamplesAiActionReadinessPresent === true
        ? 'WINDOW_STATE_REPEATED_OBSERVER_PASS'
        : 'WINDOW_STATE_REPEATED_OBSERVER_NOT_PROVEN',
  };
}

function runReadPageMatrixSmoke(cliPath, smokeUrls, args) {
  if (args.skipOpen) {
    throw new Error('--scenario read-page-matrix cannot be combined with --skip-open.');
  }
  const targets = smokeUrls.map((smokeUrl, index) => {
    const result = runReadPageSmoke(cliPath, smokeUrl, args);
    return buildReadPageMatrixTargetResult(result, index + 1);
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

export function buildReadPageMatrixTargetResult(result, targetIndex) {
  const readPageOperationTarget = result.redactedReadPage?.compact?.safeTabFacts ?? {};
  const browserWorldRelation =
    result.redactedBrowserWorldAfterRead?.aiOperationState?.relationToBrowserActiveTab ?? null;
  const readPageOperationTargetBriefPresent =
    result.redactedReadPage?.alignment?.operationTargetBriefPresent === true &&
    typeof readPageOperationTarget.operationTargetRole === 'string' &&
    typeof readPageOperationTarget.operationTargetBasis === 'string' &&
    typeof readPageOperationTarget.operationTargetCanTabrixOperate === 'boolean' &&
    typeof readPageOperationTarget.operationTargetOperabilityReason === 'string' &&
    typeof readPageOperationTarget.shouldReselectBeforeAction === 'boolean' &&
    typeof readPageOperationTarget.nextRequiredCheck === 'string' &&
    readPageOperationTarget.operationTargetSummaryPresent === true &&
    readPageOperationTarget.operationTargetClaimBoundaryPresent === true;
  const readPageActionReadinessBriefPresent =
    result.redactedReadPage?.alignment?.actionReadinessBriefPresent === true &&
    typeof readPageOperationTarget.actionReadiness === 'string' &&
    typeof readPageOperationTarget.canProceedToPageLevelCheck === 'boolean' &&
    typeof readPageOperationTarget.requiredBeforeAction === 'string' &&
    readPageOperationTarget.actionReadinessSummaryPresent === true &&
    readPageOperationTarget.actionReadinessClaimBoundaryPresent === true;
  const operationTargetRelationConsistent =
    readPageOperationTarget.operationTargetRole === 'read_target_browser_active_tab'
      ? browserWorldRelation === 'same_as_browser_active'
      : readPageOperationTarget.operationTargetRole === 'read_target_background_tab'
        ? browserWorldRelation === 'latest_ai_operated_background_tab'
        : false;
  return {
    targetIndex,
    openedPublicTestTab: result.openedPublicTestTab,
    closeSucceeded: result.closeSucceeded,
    alignmentPassed: result.alignmentPassed,
    matrixAlignmentPassed: result.matrixAlignmentPassed,
    pageRegionRuntime: result.redactedReadPage.pageRegionRuntime,
    runtime: result.redactedReadPage.runtime,
    readPageOperationTarget: {
      role: readPageOperationTarget.operationTargetRole ?? null,
      basis: readPageOperationTarget.operationTargetBasis ?? null,
      canTabrixOperate: readPageOperationTarget.operationTargetCanTabrixOperate ?? null,
      operabilityReason: readPageOperationTarget.operationTargetOperabilityReason ?? null,
      shouldReselectBeforeAction: readPageOperationTarget.shouldReselectBeforeAction ?? null,
      nextRequiredCheck: readPageOperationTarget.nextRequiredCheck ?? null,
      summaryPresent: readPageOperationTarget.operationTargetSummaryPresent === true,
      claimBoundaryPresent: readPageOperationTarget.operationTargetClaimBoundaryPresent === true,
      relationConsistentWithBrowserWorld: operationTargetRelationConsistent,
      actionReadiness: readPageOperationTarget.actionReadiness ?? null,
      canProceedToPageLevelCheck: readPageOperationTarget.canProceedToPageLevelCheck ?? null,
      requiredBeforeAction: readPageOperationTarget.requiredBeforeAction ?? null,
      actionReadinessSummaryPresent: readPageOperationTarget.actionReadinessSummaryPresent === true,
      actionReadinessClaimBoundaryPresent:
        readPageOperationTarget.actionReadinessClaimBoundaryPresent === true,
      actionReadinessBriefPresent: readPageActionReadinessBriefPresent,
    },
    browserWorldAfterRead: {
      targetTabFound: result.redactedBrowserWorldAfterRead.targetTab?.wasFound ?? false,
      latestAiOperation:
        result.redactedBrowserWorldAfterRead.aiOperationState?.latestAiOperation ?? null,
      relationToBrowserActiveTab:
        result.redactedBrowserWorldAfterRead.aiOperationState?.relationToBrowserActiveTab ?? null,
      compactSummaryBounded: result.redactedBrowserWorldAfterRead.compactSummaryBounded,
      retentionWithinLimit: result.redactedBrowserWorldAfterRead.retentionWithinLimit,
    },
    browserWorldAfterClose: result.redactedBrowserWorldAfterClose
      ? {
          targetTabFound: result.redactedBrowserWorldAfterClose.targetTab?.wasFound ?? false,
          compactSummaryBounded: result.redactedBrowserWorldAfterClose.compactSummaryBounded,
          retentionWithinLimit: result.redactedBrowserWorldAfterClose.retentionWithinLimit,
        }
      : null,
    cleanupPassed: result.cleanupPassed,
    passed:
      result.openedPublicTestTab === true &&
      result.closeSucceeded === true &&
      result.cleanupPassed === true &&
      result.matrixAlignmentPassed === true &&
      readPageOperationTargetBriefPresent === true &&
      readPageActionReadinessBriefPresent === true &&
      operationTargetRelationConsistent === true &&
      result.redactedBrowserWorldAfterRead.targetTab?.wasFound === true &&
      result.redactedBrowserWorldAfterRead.compactSummaryBounded === true &&
      result.redactedBrowserWorldAfterRead.retentionWithinLimit === true,
  };
}

export function isSmokeResultPassing(result) {
  if (!result || typeof result !== 'object') return false;
  if (typeof result.allTargetsPassed === 'boolean') return result.allTargetsPassed;
  if (typeof result.alignmentPassed === 'boolean') return result.alignmentPassed;
  if (typeof result.cleanupTargetsPassed === 'boolean') {
    return (
      result.openedPublicTestTabs === 3 &&
      result.closeSucceeded === true &&
      result.cleanupTargetsPassed === true &&
      result.allLifecycleStepsPassed === true &&
      result.publicLifecycleCoverage?.minimumPublicLifecycleCoveragePassed === true &&
      result.postCleanup?.retentionWithinLimit === true &&
      result.postCleanup?.compactSummaryBounded === true &&
      result.postCleanup?.browserObjectEdgeSummaryPresent === true &&
      result.postCleanup?.currentTabAttributeGroups?.identity?.tabIdPresent === true &&
      (result.postCleanup?.tabLifecycleState?.recentRemovedCount ?? 0) >=
        result.openedPublicTestTabs
    );
  }
  if (result.scenario === 'window-state') {
    return (
      result.verdict === 'WINDOW_STATE_OBSERVED' &&
      result.redacted?.browserObjectSnapshotConclusionPresent === true &&
      hasCurrentTabAttributeGroups(result.redacted) &&
      Boolean(result.redacted?.windowLifecycleState) &&
      result.redacted?.windowLifecycleConclusionPresent === true
    );
  }
  if (result.scenario === 'window-state-drift') {
    return (
      result.verdict === 'WINDOW_STATE_REPEATED_OBSERVER_PASS' &&
      result.driftSummary?.allSamplesWindowLifecyclePresent === true &&
      result.driftSummary?.allSamplesCurrentTabAttributeGroupsPresent === true
    );
  }
  if (result.scenario === 'single') {
    return (
      result.redacted?.callSucceeded === true &&
      result.redacted?.compactSummaryBounded === true &&
      result.redacted?.retentionWithinLimit === true &&
      (result.closeAttempted !== true || result.closeSucceeded === true)
    );
  }
  return false;
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
  const redactedBrowserWorldAfterClose =
    closeResult.attempted === true
      ? buildRedactedBrowserWorldSummary(
          callMcpTool(cliPath, 'get_windows_and_tabs', {}, args.timeoutMs),
          openedTabId,
        )
      : null;
  const cleanupPassed =
    closeResult.attempted === true
      ? closeResult.succeeded === true &&
        redactedBrowserWorldAfterClose?.targetTab?.wasFound === false &&
        redactedBrowserWorldAfterClose?.compactSummaryBounded === true &&
        redactedBrowserWorldAfterClose?.retentionWithinLimit === true
      : null;

  return {
    scenario: 'read-page',
    openedPublicTestTab: Number.isInteger(openedTabId),
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    cleanupPassed,
    redactedReadPage,
    redactedBrowserWorldAfterRead,
    redactedBrowserWorldAfterClose,
    matrixAlignmentPassed:
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
      redactedReadPage.alignment.currentTabAiOperationEvidencePresent === true &&
      redactedReadPage.alignment.browserWorldObjectChangeSummaryPresent === true &&
      redactedReadPage.alignment.browserWorldCurrentOperationConclusionPresent === true &&
      redactedReadPage.alignment.operationTargetBriefPresent === true &&
      redactedReadPage.alignment.actionReadinessBriefPresent === true &&
      redactedReadPage.alignment.targetTabMatchesReadPage === true &&
      redactedReadPage.alignment.tabOwnerIsAi === true &&
      redactedReadPage.alignment.tabOperable === true &&
      redactedReadPage.alignment.pageRegionsPresent === true &&
      redactedReadPage.alignment.pageRegionClaimBoundariesPresent === true &&
      redactedReadPage.alignment.pageOperationMapPresent === true &&
      redactedReadPage.alignment.pageOperationZonesPresent === true &&
      redactedReadPage.alignment.pageOperationClaimBoundaryPresent === true &&
      redactedBrowserWorldAfterRead.targetTab?.wasFound === true &&
      cleanupPassed === true &&
      redactedBrowserWorldAfterRead.browserObjectEdgeSummaryPresent === true,
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
      redactedReadPage.alignment.currentTabAiOperationEvidencePresent === true &&
      redactedReadPage.alignment.browserWorldObjectChangeSummaryPresent === true &&
      redactedReadPage.alignment.browserWorldCurrentOperationConclusionPresent === true &&
      redactedReadPage.alignment.operationTargetBriefPresent === true &&
      redactedReadPage.alignment.actionReadinessBriefPresent === true &&
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
      cleanupPassed === true &&
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
      `Usage: node scripts/mcp-redacted-browser-world-smoke.mjs [--url https://example.com/] [--urls https://example.com/,https://example.org/] [--scenario single|lifecycle|matrix|window-state|window-state-drift|read-page|read-page-matrix] [--sample-count 3] [--sample-interval-ms 250] [--skip-open] [--keep-open]\n`,
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
          : args.scenario === 'window-state-drift'
            ? runWindowStateDriftSmoke(cliPath, args)
            : args.scenario === 'read-page'
              ? runReadPageSmoke(cliPath, smokeUrl, args)
              : args.scenario === 'read-page-matrix'
                ? runReadPageMatrixSmoke(cliPath, smokeUrls, args)
                : args.scenario === 'lifecycle'
                  ? runLifecycleSmoke(cliPath, smokeUrl, args)
                  : runSingleSmoke(cliPath, smokeUrl, args);

    const smokePassed = isSmokeResultPassing(smokeResult);
    const output = {
      ok: smokePassed,
      smokeKind: 'redacted_browser_world_mcp_smoke',
      smokePassed,
      ...smokeResult,
      privacyBoundary:
        'No tab URLs, titles, account state, screenshots, cookies, network bodies, or page text are printed by this script.',
    };
    process.stdout.write(stringifyRedactedSmokeOutput(output));
    if (!smokePassed) process.exitCode = 1;
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
