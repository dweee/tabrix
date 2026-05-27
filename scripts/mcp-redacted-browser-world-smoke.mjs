#!/usr/bin/env node

/* global process, URL */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_PUBLIC_URL = 'https://example.com/?tabrix_browser_world_smoke=1';

export function parseArgs(argv) {
  const args = {
    url: DEFAULT_PUBLIC_URL,
    keepOpen: false,
    skipOpen: false,
    timeoutMs: 60_000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (part === '--url') {
      args.url = argv[index + 1] || '';
      index += 1;
    } else if (part === '--keep-open') {
      args.keepOpen = true;
    } else if (part === '--skip-open') {
      args.skipOpen = true;
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

export function buildRedactedBrowserWorldSummary(payload, targetTabId = null) {
  const compactWindow = payload?.compactSummary?.windows?.[0] ?? null;
  const compactTabs = Array.isArray(compactWindow?.tabs) ? compactWindow.tabs : [];
  const activeTabId = payload?.compactSummary?.activeObject?.tabId ?? null;
  const allTabs = Array.isArray(payload?.browserWorld?.tabs) ? payload.browserWorld.tabs : [];
  const targetTab = Number.isInteger(targetTabId)
    ? allTabs.find((tab) => tab?.tabId === targetTabId)
    : null;

  return {
    callSucceeded: true,
    source: payload?.source ?? 'unknown',
    windowCount: Number.isInteger(payload?.windowCount) ? payload.windowCount : null,
    tabCount: Number.isInteger(payload?.tabCount) ? payload.tabCount : null,
    hasCompactSummary: Boolean(payload?.compactSummary),
    compactTabLimit: compactWindow?.compactTabLimit ?? null,
    omittedTabCount: compactWindow?.omittedTabCount ?? null,
    compactTabsShown: compactTabs.length,
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

function callCliJson(cliPath, args, timeoutMs) {
  const output = execFileSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    timeout: timeoutMs,
    windowsHide: true,
  });
  return extractJsonObject(output);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(
      `Usage: node scripts/mcp-redacted-browser-world-smoke.mjs [--url https://example.com/] [--skip-open] [--keep-open]\n`,
    );
    return;
  }

  const smokeUrl = assertPublicHttpUrl(args.url);
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const cliPath = path.join(rootDir, 'app', 'native-server', 'dist', 'cli.js');

  let openedTabId = null;
  let closeAttempted = false;
  let closeSucceeded = null;

  try {
    if (!args.skipOpen) {
      const navigatePayload = callCliJson(
        cliPath,
        ['mcp', 'call', 'chrome_navigate', '--args', JSON.stringify({ url: smokeUrl })],
        args.timeoutMs,
      );
      openedTabId = extractNavigateTabId(navigatePayload);
    }

    const browserWorldPayload = callCliJson(
      cliPath,
      ['mcp', 'call', 'get_windows_and_tabs'],
      args.timeoutMs,
    );
    const redacted = buildRedactedBrowserWorldSummary(browserWorldPayload, openedTabId);

    if (Number.isInteger(openedTabId) && !args.keepOpen) {
      closeAttempted = true;
      const closePayload = callCliJson(
        cliPath,
        ['mcp', 'call', 'chrome_close_tabs', '--args', JSON.stringify({ tabIds: [openedTabId] })],
        args.timeoutMs,
      );
      closeSucceeded = closePayload?.success === true || closePayload?.closedCount === 1;
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          smokeKind: 'redacted_browser_world_mcp_smoke',
          openedPublicTestTab: Number.isInteger(openedTabId),
          closeAttempted,
          closeSucceeded,
          redacted,
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
