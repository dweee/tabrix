#!/usr/bin/env node
/**
 * Release-side North Star evidence gate.
 *
 * Reads redacted chooser telemetry and checks that Tabrix is actually
 * improving the core product promises: smaller reads, fewer safe
 * fallbacks, and closed-loop outcome feedback. This is intentionally
 * NOT part of public CI because a fresh checkout has no real browser
 * evidence DB. Release/owner lanes should run it against a captured
 * Memory DB before claiming "faster / more accurate / more token
 * efficient".
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadBetterSqlite3 } from './lib/load-better-sqlite3.mjs';

const ROOT = process.cwd();

const DEFAULT_THRESHOLDS = Object.freeze({
  minDecisions: 20,
  minEstimateCoverage: 0.8,
  minTokenSavingRatio: 0.35,
  maxFallbackSafeRate: 0.25,
  minOutcomeCoverage: 0.2,
});

export function parseArgs(argv) {
  const options = {
    dbPath: null,
    since: null,
    json: false,
    thresholds: { ...DEFAULT_THRESHOLDS },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db' && argv[i + 1]) {
      options.dbPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--since' && argv[i + 1]) {
      options.since = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg.startsWith('--min-decisions=')) {
      options.thresholds.minDecisions = readNumberArg(arg, '--min-decisions=');
      continue;
    }
    if (arg.startsWith('--min-estimate-coverage=')) {
      options.thresholds.minEstimateCoverage = readNumberArg(arg, '--min-estimate-coverage=');
      continue;
    }
    if (arg.startsWith('--min-token-saving-ratio=')) {
      options.thresholds.minTokenSavingRatio = readNumberArg(arg, '--min-token-saving-ratio=');
      continue;
    }
    if (arg.startsWith('--max-fallback-safe-rate=')) {
      options.thresholds.maxFallbackSafeRate = readNumberArg(arg, '--max-fallback-safe-rate=');
      continue;
    }
    if (arg.startsWith('--min-outcome-coverage=')) {
      options.thresholds.minOutcomeCoverage = readNumberArg(arg, '--min-outcome-coverage=');
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

function readNumberArg(arg, prefix) {
  const raw = arg.slice(prefix.length);
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric argument: ${arg}`);
  }
  return value;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: check-north-star-metrics [--db <file>] [--since <ISO>] [--json]',
      '',
      'Thresholds:',
      `  --min-decisions=N               default ${DEFAULT_THRESHOLDS.minDecisions}`,
      `  --min-estimate-coverage=R       default ${DEFAULT_THRESHOLDS.minEstimateCoverage}`,
      `  --min-token-saving-ratio=R      default ${DEFAULT_THRESHOLDS.minTokenSavingRatio}`,
      `  --max-fallback-safe-rate=R      default ${DEFAULT_THRESHOLDS.maxFallbackSafeRate}`,
      `  --min-outcome-coverage=R        default ${DEFAULT_THRESHOLDS.minOutcomeCoverage}`,
      '',
    ].join('\n'),
  );
}

function defaultDbPath() {
  if (process.env.TABRIX_MEMORY_DB_FILE && process.env.TABRIX_MEMORY_DB_FILE.trim()) {
    return path.resolve(process.env.TABRIX_MEMORY_DB_FILE.trim());
  }
  return path.join(os.homedir(), '.chrome-mcp-agent', 'memory.db');
}

export function evaluateNorthStarMetrics(input, thresholds = DEFAULT_THRESHOLDS) {
  const decisions = Array.isArray(input.decisions) ? input.decisions : [];
  const outcomeDecisionIds = new Set(
    Array.isArray(input.outcomeDecisionIds) ? input.outcomeDecisionIds : [],
  );
  const layerCounts = { L0: 0, 'L0+L1': 0, 'L0+L1+L2': 0, unknown: 0 };
  let fallbackSafeCount = 0;
  let estimatedDecisionCount = 0;
  let tokensSavedEstimateSum = 0;
  let tokenEstimateFullReadSum = 0;

  for (const decision of decisions) {
    const layer = typeof decision.chosen_layer === 'string' ? decision.chosen_layer : 'unknown';
    if (Object.prototype.hasOwnProperty.call(layerCounts, layer)) {
      layerCounts[layer] += 1;
    } else {
      layerCounts.unknown += 1;
    }
    if (decision.source_route === 'dispatcher_fallback_safe') fallbackSafeCount += 1;

    const full = finiteNonNegative(decision.token_estimate_full_read);
    const saved = finiteNonNegative(decision.tokens_saved_estimate);
    if (full !== null && full > 0 && saved !== null) {
      estimatedDecisionCount += 1;
      tokenEstimateFullReadSum += full;
      tokensSavedEstimateSum += Math.min(saved, full);
    }
  }

  const decisionCount = decisions.length;
  const estimateCoverage = ratio(estimatedDecisionCount, decisionCount);
  const tokenSavingRatio = ratio(tokensSavedEstimateSum, tokenEstimateFullReadSum);
  const fallbackSafeRate = ratio(fallbackSafeCount, decisionCount);
  const outcomeCoverage = ratio(outcomeDecisionIds.size, decisionCount);

  const metrics = {
    decisionCount,
    estimatedDecisionCount,
    estimateCoverage,
    tokenSavingRatio,
    tokensSavedEstimateSum,
    tokenEstimateFullReadSum,
    fallbackSafeCount,
    fallbackSafeRate,
    outcomeDecisionCount: outcomeDecisionIds.size,
    outcomeCoverage,
    layerCounts,
  };

  const findings = [];
  addFinding(findings, metrics.decisionCount >= thresholds.minDecisions, 'min_decisions', {
    actual: metrics.decisionCount,
    threshold: thresholds.minDecisions,
  });
  addFinding(
    findings,
    metrics.estimateCoverage >= thresholds.minEstimateCoverage,
    'estimate_coverage',
    { actual: metrics.estimateCoverage, threshold: thresholds.minEstimateCoverage },
  );
  addFinding(
    findings,
    metrics.tokenSavingRatio >= thresholds.minTokenSavingRatio,
    'token_saving_ratio',
    { actual: metrics.tokenSavingRatio, threshold: thresholds.minTokenSavingRatio },
  );
  addFinding(
    findings,
    metrics.fallbackSafeRate <= thresholds.maxFallbackSafeRate,
    'fallback_safe_rate',
    { actual: metrics.fallbackSafeRate, threshold: thresholds.maxFallbackSafeRate },
  );
  addFinding(
    findings,
    metrics.outcomeCoverage >= thresholds.minOutcomeCoverage,
    'outcome_coverage',
    { actual: metrics.outcomeCoverage, threshold: thresholds.minOutcomeCoverage },
  );

  return {
    status: findings.every((finding) => finding.status === 'pass') ? 'pass' : 'fail',
    metrics,
    thresholds: { ...thresholds },
    findings,
  };
}

function finiteNonNegative(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return round4(numerator / denominator);
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function addFinding(findings, passed, code, detail) {
  findings.push({ status: passed ? 'pass' : 'fail', code, ...detail });
}

function readTelemetry(db, since) {
  assertTables(db);
  const where = since ? 'WHERE created_at >= ?' : '';
  const decisions = db
    .prepare(
      `SELECT decision_id, strategy, chosen_layer, source_route,
              token_estimate_full_read, tokens_saved_estimate
         FROM tabrix_choose_context_decisions
         ${where}`,
    )
    .all(...(since ? [since] : []));
  const outcomeDecisionIds = db
    .prepare(
      `SELECT DISTINCT o.decision_id
         FROM tabrix_choose_context_outcomes o
         JOIN tabrix_choose_context_decisions d ON d.decision_id = o.decision_id
         ${since ? 'WHERE d.created_at >= ?' : ''}`,
    )
    .all(...(since ? [since] : []))
    .map((row) => row.decision_id);
  return { decisions, outcomeDecisionIds };
}

function assertTables(db) {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('tabrix_choose_context_decisions', 'tabrix_choose_context_outcomes')`,
    )
    .all()
    .map((row) => row.name);
  if (
    !tables.includes('tabrix_choose_context_decisions') ||
    !tables.includes('tabrix_choose_context_outcomes')
  ) {
    throw new Error('Memory DB is missing chooser telemetry tables');
  }
}

function printTextReport(payload) {
  process.stdout.write('Tabrix North Star metrics\n');
  process.stdout.write(`  status=${payload.status}\n`);
  process.stdout.write(`  decisions=${payload.metrics.decisionCount}\n`);
  process.stdout.write(`  estimateCoverage=${payload.metrics.estimateCoverage}\n`);
  process.stdout.write(`  tokenSavingRatio=${payload.metrics.tokenSavingRatio}\n`);
  process.stdout.write(`  fallbackSafeRate=${payload.metrics.fallbackSafeRate}\n`);
  process.stdout.write(`  outcomeCoverage=${payload.metrics.outcomeCoverage}\n`);
  process.stdout.write(`  tokensSavedEstimateSum=${payload.metrics.tokensSavedEstimateSum}\n`);
  process.stdout.write(`  tokenEstimateFullReadSum=${payload.metrics.tokenEstimateFullReadSum}\n`);
  process.stdout.write('  layerCounts=' + JSON.stringify(payload.metrics.layerCounts) + '\n\n');
  for (const finding of payload.findings) {
    process.stdout.write(
      `  [${finding.status}] ${finding.code}: actual=${finding.actual} threshold=${finding.threshold}\n`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = args.dbPath ?? defaultDbPath();
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB not found: ${dbPath}`);
  }

  const DatabaseCtor = await loadBetterSqlite3(ROOT);
  const db = new DatabaseCtor(dbPath, { readonly: true, fileMustExist: true });
  try {
    const input = readTelemetry(db, args.since);
    const payload = {
      dbPath,
      since: args.since ?? null,
      generatedAt: new Date().toISOString(),
      ...evaluateNorthStarMetrics(input, args.thresholds),
    };
    if (args.json) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    } else {
      printTextReport(payload);
    }
    if (payload.status !== 'pass') process.exit(1);
  } finally {
    db.close();
  }
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`[north-star-metrics] failed: ${error?.message ?? error}\n`);
    process.exit(1);
  });
}
