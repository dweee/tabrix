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
  const omittedTabCount = compactWindows.reduce(
    (sum, window) => sum + (Number.isInteger(window?.omittedTabCount) ? window.omittedTabCount : 0),
    0,
  );
  const retentionPolicy = payload?.compactSummary?.retentionPolicy ?? payload?.retentionPolicy;

  return {
    callSucceeded: true,
    source: payload?.source ?? 'unknown',
    windowCount: Number.isInteger(payload?.windowCount) ? payload.windowCount : null,
    tabCount: Number.isInteger(payload?.tabCount) ? payload.tabCount : null,
    hasCompactSummary: Boolean(payload?.compactSummary),
    compactTabLimit,
    omittedTabCount,
    compactTabsShown: compactTabs.length,
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
      targetTabMatchesReadPage:
        Number.isInteger(targetTabId) && Number.isInteger(ownershipRuntime?.currentTabId)
          ? ownershipRuntime.currentTabId === targetTabId
          : null,
      readTargetIsBrowserActive: ownershipRuntime?.isReadTargetBrowserActiveTab ?? null,
      tabOwnerIsAi: ownershipRuntime?.currentTabOpenedBy === 'ai',
      tabOperable: ownershipRuntime?.currentTabCanTabrixOperate ?? null,
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
  return {
    step,
    windowCount: redacted.windowCount,
    tabCount: redacted.tabCount,
    compactTabLimit: redacted.compactTabLimit,
    activeTabIncludedInCompactTabs: redacted.activeTabIncludedInCompactTabs,
    targetTab: redacted.targetTab,
    counts: redacted.counts,
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

  return {
    scenario: 'lifecycle',
    openedPublicTestTabs: uniqueNumbers(openedTabIds).length,
    closeAttempted: closeResult.attempted,
    closeSucceeded: closeResult.succeeded,
    cleanup: {
      requestedCount: closeResult.requestedCount,
      closedCount: closeResult.closedCount,
    },
    lifecycleMatrix,
  };
}

function runMatrixSmoke(cliPath, smokeUrls, args) {
  if (args.skipOpen) {
    throw new Error('--scenario matrix cannot be combined with --skip-open.');
  }
  const targets = smokeUrls.map((smokeUrl, index) => {
    const result = runLifecycleSmoke(cliPath, smokeUrl, args);
    return {
      targetIndex: index + 1,
      openedPublicTestTabs: result.openedPublicTestTabs,
      closeSucceeded: result.closeSucceeded,
      cleanup: result.cleanup,
      lifecycleMatrix: result.lifecycleMatrix,
      passed:
        result.openedPublicTestTabs === 3 &&
        result.closeSucceeded === true &&
        result.lifecycleMatrix.every(
          (step) =>
            step.targetTab?.wasFound === true &&
            step.targetTab?.openedBy === 'ai' &&
            step.targetTab?.canTabrixOperate === true &&
            step.activeTabIncludedInCompactTabs === true,
        ),
    };
  });
  return {
    scenario: 'matrix',
    targetCount: targets.length,
    allTargetsPassed: targets.every((target) => target.passed),
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
      redacted.windows.total > 0 && redacted.hasBrowserWorldDetail
        ? 'WINDOW_STATE_OBSERVED'
        : 'WINDOW_STATE_NOT_PROVEN',
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
    alignmentPassed:
      redactedReadPage.alignment.ownershipRuntimePresent === true &&
      redactedReadPage.alignment.browserPageObjectCompactPresent === true &&
      redactedReadPage.alignment.browserPageObjectCompactSource === 'expected' &&
      redactedReadPage.alignment.browserWorldRuntimeSource === true &&
      redactedReadPage.alignment.tabPageObjectSummaryPresent === true &&
      redactedReadPage.alignment.targetTabMatchesReadPage === true &&
      redactedReadPage.alignment.readTargetIsBrowserActive === true &&
      redactedReadPage.alignment.tabOwnerIsAi === true &&
      redactedReadPage.alignment.tabOperable === true,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      `Usage: node scripts/mcp-redacted-browser-world-smoke.mjs [--url https://example.com/] [--urls https://example.com/,https://example.org/] [--scenario single|lifecycle|matrix|window-state|read-page] [--skip-open] [--keep-open]\n`,
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
