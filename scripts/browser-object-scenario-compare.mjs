#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const DEFAULT_ARTIFACT_DIR = '.private-artifacts';
const DEFAULT_MIN_CARDS = 10;
const SECRET_KEY_PATTERN = /(token|xsec|signature|sig|auth|session|cookie|csrf|xsrf|key|secret)/i;
const SECRET_VALUE_PATTERN = /^[A-Za-z0-9._~+/=-]{24,}$/;

function nowStamp() {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function redactSensitiveUrl(value) {
  if (!value || typeof value !== 'string') return value;
  try {
    const parsed = new URL(value, 'https://tabrix.local');
    for (const [key, paramValue] of Array.from(parsed.searchParams.entries())) {
      if (SECRET_KEY_PATTERN.test(key) || SECRET_VALUE_PATTERN.test(paramValue)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = '';
    if (!/^https?:\/\//i.test(value)) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.href;
  } catch {
    return value.replace(
      /([?&][^=]*(?:token|xsec|signature|auth|session|cookie|csrf|xsrf|key|secret)[^=]*=)[^&#]+/gi,
      '$1[redacted]',
    );
  }
}

function redactDeep(value) {
  if (Array.isArray(value)) return value.map((item) => redactDeep(item));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && /^https?:\/\//i.test(value)
      ? redactSensitiveUrl(value)
      : value;
  }
  const next = {};
  for (const [key, raw] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      next[key] = '[redacted]';
    } else if ((key === 'url' || key === 'href') && typeof raw === 'string') {
      next[key] = redactSensitiveUrl(raw);
    } else {
      next[key] = redactDeep(raw);
    }
  }
  return next;
}

export function parseArgs(argv) {
  const args = {
    allowNeedsWork: false,
    artifactDir: DEFAULT_ARTIFACT_DIR,
    competitorInput: null,
    competitorLabel: 'competitor',
    minCards: DEFAULT_MIN_CARDS,
    output: null,
    printMarkdown: false,
    requiredFilters: [],
    runTabrix: false,
    scenarioId: 'browser-object-scenario',
    tabrixCollectInput: null,
    tabrixWindowsInput: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--allow-needs-work') {
      args.allowNeedsWork = true;
    } else if (arg === '--artifact-dir') {
      args.artifactDir = argv[index + 1] ?? DEFAULT_ARTIFACT_DIR;
      index += 1;
    } else if (arg === '--competitor-input') {
      args.competitorInput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--competitor-label') {
      args.competitorLabel = argv[index + 1] ?? 'competitor';
      index += 1;
    } else if (arg === '--min-cards') {
      args.minCards = Math.max(
        1,
        Number.parseInt(argv[index + 1] ?? String(DEFAULT_MIN_CARDS), 10),
      );
      index += 1;
    } else if (arg === '--output') {
      args.output = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--print-markdown') {
      args.printMarkdown = true;
    } else if (arg === '--required-filter') {
      const label = argv[index + 1] ?? '';
      if (label) args.requiredFilters.push(label);
      index += 1;
    } else if (arg === '--run-tabrix') {
      args.runTabrix = true;
    } else if (arg === '--scenario-id') {
      args.scenarioId = argv[index + 1] ?? args.scenarioId;
      index += 1;
    } else if (arg === '--tabrix-collect-input') {
      args.tabrixCollectInput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--tabrix-windows-input') {
      args.tabrixWindowsInput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/browser-object-scenario-compare.mjs --run-tabrix --required-filter <label> [--competitor-input <json>]
  node scripts/browser-object-scenario-compare.mjs --tabrix-collect-input <json> [--tabrix-windows-input <json>] [--competitor-input <json>]

Notes:
  - Artifacts are written under .private-artifacts by default.
  - This script compares scenario evidence; it does not automate a site-specific flow.
  - Required filters are scenario expectations, not hard-coded product logic.
  - Use --allow-needs-work for unattended evidence collection that should continue after a failed gate.
`);
}

function runJsonCommand(command, commandArgs, cwd) {
  const output = execFileSync(command, commandArgs, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(output);
}

function runTabrixMcp(toolName, args, cwd) {
  const cliArgs = ['pnpm', 'tabrix', 'mcp', 'call', toolName, '--json'];
  let argsFile = null;
  if (args && Object.keys(args).length > 0) {
    argsFile = path.join(os.tmpdir(), `tabrix-${toolName}-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(argsFile, JSON.stringify(args), 'utf8');
    cliArgs.push('--args-file', argsFile);
  }
  try {
    return runJsonCommand('corepack', cliArgs, cwd);
  } finally {
    if (argsFile && fs.existsSync(argsFile)) fs.rmSync(argsFile, { force: true });
  }
}

function unwrapMcpResult(value) {
  if (!value || typeof value !== 'object') return {};
  if (value.parsed && typeof value.parsed === 'object') return value.parsed;
  const text = value.raw?.content?.find?.((entry) => entry?.type === 'text')?.text;
  if (typeof text === 'string' && text.trim().startsWith('{')) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  return value;
}

function hasLabel(labels, required) {
  return labels.some((label) => String(label).trim() === required);
}

export function summarizeTabrixEvidence(input, options = {}) {
  const parsed = unwrapMcpResult(input);
  const cards = Array.isArray(parsed.cards) ? parsed.cards : [];
  const appliedLabels = Array.isArray(parsed.filterState?.appliedLabels)
    ? parsed.filterState.appliedLabels.map(String)
    : [];
  const requiredFilters = options.requiredFilters ?? [];
  const missingFilters = requiredFilters.filter((label) => !hasLabel(appliedLabels, label));
  const targetabilitySummary = parsed.targetabilitySummary ?? {};
  const stableClickTargetCount = Number(targetabilitySummary.stableClickTargetCount ?? 0);
  const urlFallbackCount = Number(targetabilitySummary.urlFallbackCount ?? 0);
  const observedResultCount = Number(parsed.observedResultCount ?? cards.length);
  const minCards = Number(options.minCards ?? DEFAULT_MIN_CARDS);

  return {
    evidenceKind: 'tabrix_real_chrome_mcp',
    ok: observedResultCount >= minCards && missingFilters.length === 0,
    page: redactDeep(parsed.page ?? {}),
    pageRole: parsed.pageRole ?? null,
    pageState: parsed.pageState ?? null,
    selectedDataSource: parsed.selectedDataSource ?? null,
    filterState: {
      appliedLabels,
      missingRequiredLabels: missingFilters,
      status: parsed.filterState?.status ?? 'not_observed',
    },
    resultCards: {
      observedResultCount,
      requiredMinCards: minCards,
      stableClickTargetCount,
      urlFallbackCount,
      targetRefCoverageRate: Number(parsed.targetRefCoverageRate ?? 0),
      complete: Boolean(parsed.complete),
    },
    timings: {
      durationMs: parsed.collection?.durationMs ?? null,
    },
    topCards: cards.slice(0, minCards).map((card) =>
      redactDeep({
        rank: card.rank,
        title: card.title,
        url: card.url,
        primaryText: card.primaryText,
        metaText: card.metaText,
        interactionText: card.interactionText,
        targetabilityStatus: card.targetabilityStatus,
        targetRef: card.targetRef ?? null,
      }),
    ),
    trace: parsed._tabrix
      ? {
          traceId: parsed._tabrix.traceId,
          toolName: parsed._tabrix.toolName,
          aiFeedbackRequired: parsed._tabrix.aiFeedbackRequired,
          businessFeedbackRequired: parsed._tabrix.businessFeedbackRequired,
        }
      : null,
  };
}

export function summarizeWindowsEvidence(input) {
  const parsed = unwrapMcpResult(input);
  return {
    evidenceKind: 'tabrix_windows_and_tabs',
    currentPage: redactDeep(parsed.currentPage ?? null),
    stateCounts: parsed.compactSummary?.stateCounts ?? null,
    windowCount: parsed.windowCount ?? null,
    tabCount: parsed.tabCount ?? null,
  };
}

export function summarizeCompetitorEvidence(input, options = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const searchLike = Array.isArray(value.searchLike) ? value.searchLike : [];
  const candidateCards = Array.isArray(value.candidateCards) ? value.candidateCards : [];
  const firstControls = Array.isArray(value.firstControls) ? value.firstControls : [];
  const loginBlocked = [...searchLike, ...firstControls].some((entry) =>
    /登录|login/i.test(String(entry.name ?? '')),
  );
  const requiredFilters = options.requiredFilters ?? [];
  const visibleNames = [...searchLike, ...firstControls].map((entry) => String(entry.name ?? ''));
  const missingFilters = requiredFilters.filter(
    (label) => !visibleNames.some((name) => name === label),
  );

  return {
    evidenceKind: 'competitor_browser_probe',
    label: options.competitorLabel ?? 'competitor',
    ok:
      !loginBlocked &&
      candidateCards.length >= Number(options.minCards ?? DEFAULT_MIN_CARDS) &&
      missingFilters.length === 0,
    page: redactDeep({
      url: value.url,
      title: value.title,
    }),
    visibleControls: {
      controlCount: Number(value.controlCount ?? firstControls.length),
      linkCount: Number(value.linkCount ?? 0),
      loginBlocked,
      searchLike: redactDeep(searchLike.slice(0, 10)),
      missingRequiredLabels: missingFilters,
    },
    candidateCards: redactDeep(
      candidateCards.slice(0, Number(options.minCards ?? DEFAULT_MIN_CARDS)),
    ),
    claimBoundary:
      'Competitor evidence is a callable browser probe result. It is not treated as Codex Chrome extension proof unless the input was produced by that extension.',
  };
}

export function evaluateComparison({ tabrix, competitor, windows, scenario }) {
  const checks = [];
  if (windows) {
    checks.push({
      id: 'tabrix-real-chrome-session',
      ok: Boolean(windows.currentPage?.canTabrixOperate),
      detail: windows.currentPage?.pageStateLabel ?? windows.currentPage?.pageState ?? 'unknown',
    });
  }
  if (tabrix) {
    checks.push({
      id: 'tabrix-card-count',
      ok: tabrix.resultCards.observedResultCount >= scenario.minCards,
      detail: `${tabrix.resultCards.observedResultCount}/${scenario.minCards}`,
    });
    checks.push({
      id: 'tabrix-stable-target-coverage',
      ok: tabrix.resultCards.stableClickTargetCount >= Math.max(1, scenario.minCards - 1),
      detail: `${tabrix.resultCards.stableClickTargetCount} stable, ${tabrix.resultCards.urlFallbackCount} fallback`,
    });
    checks.push({
      id: 'tabrix-required-filter-state',
      ok: tabrix.filterState.missingRequiredLabels.length === 0,
      detail:
        tabrix.filterState.missingRequiredLabels.length === 0
          ? 'all required filters observed'
          : `missing: ${tabrix.filterState.missingRequiredLabels.join(', ')}`,
    });
  }
  if (competitor) {
    checks.push({
      id: 'competitor-login-free',
      ok: !competitor.visibleControls.loginBlocked,
      detail: competitor.visibleControls.loginBlocked
        ? 'login surface observed'
        : 'no login surface observed',
    });
    checks.push({
      id: 'competitor-card-count',
      ok: competitor.candidateCards.length >= scenario.minCards,
      detail: `${competitor.candidateCards.length}/${scenario.minCards}`,
    });
  }

  const mustFix = checks.filter((check) => !check.ok).map((check) => check.id);
  return {
    scenario,
    status: mustFix.length === 0 ? 'PASS' : 'NEEDS_WORK',
    checks,
    mustFix,
    nextActions: buildNextActions(mustFix),
  };
}

function buildNextActions(mustFix) {
  const actions = [];
  if (mustFix.includes('tabrix-required-filter-state')) {
    actions.push(
      'Implement generic filter panel perception: trigger, panel, groups, options, active state, and result-list delta.',
    );
  }
  if (mustFix.includes('competitor-login-free')) {
    actions.push(
      'Add session ownership comparison: user real Chrome, background tab in user Chrome, and isolated competitor/session probe.',
    );
  }
  if (mustFix.includes('competitor-card-count')) {
    actions.push(
      'Extend competitor probe extraction to produce normalized card objects before comparing product capability.',
    );
  }
  if (mustFix.includes('tabrix-stable-target-coverage')) {
    actions.push(
      'Improve stable target refs before allowing card targets to seed Knowledge or Experience.',
    );
  }
  return actions;
}

export function buildMarkdownReport({ comparison, tabrix, competitor, windows, artifactFiles }) {
  const lines = [];
  lines.push('# Browser Object Scenario Comparison');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Scenario: ${comparison.scenario.id}`);
  lines.push(`Status: ${comparison.status}`);
  lines.push('');
  lines.push('## Evidence Files');
  for (const file of artifactFiles) lines.push(`- ${file}`);
  lines.push('');
  lines.push('## Checks');
  for (const check of comparison.checks) {
    lines.push(`- ${check.ok ? 'PASS' : 'FAIL'} ${check.id}: ${check.detail}`);
  }
  lines.push('');
  if (windows) {
    lines.push('## Tabrix Session');
    lines.push(`- Current page: ${windows.currentPage?.title ?? 'unknown'}`);
    lines.push(
      `- State: ${windows.currentPage?.pageStateLabel ?? windows.currentPage?.pageState ?? 'unknown'}`,
    );
    lines.push(`- Can operate: ${Boolean(windows.currentPage?.canTabrixOperate)}`);
    lines.push('');
  }
  if (tabrix) {
    lines.push('## Tabrix Result Cards');
    lines.push(`- Cards: ${tabrix.resultCards.observedResultCount}`);
    lines.push(`- Stable targets: ${tabrix.resultCards.stableClickTargetCount}`);
    lines.push(`- URL fallback: ${tabrix.resultCards.urlFallbackCount}`);
    lines.push(`- Applied filters: ${tabrix.filterState.appliedLabels.join(', ') || 'none'}`);
    lines.push(
      `- Missing filters: ${tabrix.filterState.missingRequiredLabels.join(', ') || 'none'}`,
    );
    for (const card of tabrix.topCards) {
      lines.push(
        `  ${card.rank}. ${card.title} | ${card.primaryText ?? ''} | ${card.metaText ?? ''} | ${card.targetabilityStatus}`,
      );
    }
    lines.push('');
  }
  if (competitor) {
    lines.push('## Competitor Probe');
    lines.push(`- Label: ${competitor.label}`);
    lines.push(`- URL: ${competitor.page.url ?? 'unknown'}`);
    lines.push(`- Login surface observed: ${competitor.visibleControls.loginBlocked}`);
    lines.push(`- Visible controls: ${competitor.visibleControls.controlCount}`);
    lines.push(`- Candidate cards: ${competitor.candidateCards.length}`);
    lines.push('');
  }
  lines.push('## Next Actions');
  if (comparison.nextActions.length === 0) {
    lines.push(
      '- Keep running the same-scenario gate across repeated real-browser runs before product-grade claims.',
    );
  } else {
    for (const action of comparison.nextActions) lines.push(`- ${action}`);
  }
  lines.push('');
  lines.push('## Claim Boundary');
  lines.push(
    '- This report compares current evidence artifacts. It does not prove product-grade or competitor superiority by itself.',
  );
  lines.push(
    '- Codex Chrome extension superiority claims require evidence from that extension or an explicitly accepted proxy probe.',
  );
  return `${lines.join('\n')}\n`;
}

function makeScenario(args) {
  return {
    id: args.scenarioId,
    minCards: args.minCards,
    requiredFilters: args.requiredFilters,
  };
}

export function buildComparisonFromInputs({ tabrixCollect, tabrixWindows, competitorInput, args }) {
  const scenario = makeScenario(args);
  const tabrix = tabrixCollect
    ? summarizeTabrixEvidence(tabrixCollect, {
        minCards: scenario.minCards,
        requiredFilters: scenario.requiredFilters,
      })
    : null;
  const windows = tabrixWindows ? summarizeWindowsEvidence(tabrixWindows) : null;
  const competitor = competitorInput
    ? summarizeCompetitorEvidence(competitorInput, {
        competitorLabel: args.competitorLabel,
        minCards: scenario.minCards,
        requiredFilters: scenario.requiredFilters,
      })
    : null;
  const comparison = evaluateComparison({ tabrix, competitor, windows, scenario });
  return { comparison, tabrix, competitor, windows };
}

export function runCli(argv = process.argv.slice(2), env = { cwd: process.cwd() }) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  const artifactDir = path.resolve(env.cwd, args.artifactDir);
  fs.mkdirSync(artifactDir, { recursive: true });
  const stamp = nowStamp();
  const artifactFiles = [];

  let tabrixWindows = args.tabrixWindowsInput
    ? readJsonFile(path.resolve(args.tabrixWindowsInput))
    : null;
  let tabrixCollect = args.tabrixCollectInput
    ? readJsonFile(path.resolve(args.tabrixCollectInput))
    : null;

  if (args.runTabrix) {
    tabrixWindows = runTabrixMcp('get_windows_and_tabs', {}, env.cwd);
    const windowsPath = path.join(
      artifactDir,
      `browser-object-compare-tabrix-windows-${stamp}.json`,
    );
    writeJsonFile(windowsPath, redactDeep(tabrixWindows));
    artifactFiles.push(path.relative(env.cwd, windowsPath));

    tabrixCollect = runTabrixMcp(
      'chrome_collect_result_cards',
      {
        includeRects: true,
        includeUrlFallback: true,
        limit: args.minCards,
        scrollPasses: 0,
      },
      env.cwd,
    );
    const collectPath = path.join(artifactDir, `browser-object-compare-tabrix-cards-${stamp}.json`);
    writeJsonFile(collectPath, redactDeep(tabrixCollect));
    artifactFiles.push(path.relative(env.cwd, collectPath));
  } else {
    if (args.tabrixWindowsInput)
      artifactFiles.push(path.relative(env.cwd, path.resolve(args.tabrixWindowsInput)));
    if (args.tabrixCollectInput)
      artifactFiles.push(path.relative(env.cwd, path.resolve(args.tabrixCollectInput)));
  }

  const competitorInput = args.competitorInput
    ? readJsonFile(path.resolve(args.competitorInput))
    : null;
  if (args.competitorInput)
    artifactFiles.push(path.relative(env.cwd, path.resolve(args.competitorInput)));

  const result = buildComparisonFromInputs({ tabrixCollect, tabrixWindows, competitorInput, args });
  const output = {
    ...result,
    artifactFiles,
    claimBoundary:
      'Private scenario evidence only. Do not commit raw artifacts or use this as a product-grade claim without repeated real-browser proof.',
  };
  const outputPath = path.resolve(
    args.output ?? path.join(artifactDir, `browser-object-scenario-compare-${stamp}.json`),
  );
  writeJsonFile(outputPath, output);
  artifactFiles.push(path.relative(env.cwd, outputPath));

  const markdown = buildMarkdownReport({ ...result, artifactFiles });
  const markdownPath = outputPath.replace(/\.json$/i, '.md');
  fs.writeFileSync(markdownPath, markdown, 'utf8');

  if (args.printMarkdown) {
    process.stdout.write(markdown);
  } else {
    process.stdout.write(
      `${JSON.stringify({ outputPath, markdownPath, status: result.comparison.status }, null, 2)}\n`,
    );
  }
  return result.comparison.status === 'PASS' || args.allowNeedsWork ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
