import test from 'node:test';
import assert from 'node:assert/strict';

import { evaluateNorthStarMetrics, parseArgs } from './check-north-star-metrics.mjs';

function decision(overrides = {}) {
  return {
    decision_id: overrides.decision_id ?? `d-${Math.random()}`,
    chosen_layer: overrides.chosen_layer ?? 'L0+L1',
    source_route: overrides.source_route ?? 'knowledge_supported_read',
    token_estimate_full_read: overrides.token_estimate_full_read ?? 1000,
    tokens_saved_estimate: overrides.tokens_saved_estimate ?? 500,
    ...overrides,
  };
}

test('evaluateNorthStarMetrics passes when token saving and feedback coverage meet thresholds', () => {
  const decisions = Array.from({ length: 20 }, (_, i) =>
    decision({ decision_id: `d-${i}`, tokens_saved_estimate: 500 }),
  );
  const result = evaluateNorthStarMetrics(
    {
      decisions,
      outcomeDecisionIds: decisions.slice(0, 5).map((row) => row.decision_id),
    },
    {
      minDecisions: 20,
      minEstimateCoverage: 0.8,
      minTokenSavingRatio: 0.35,
      maxFallbackSafeRate: 0.25,
      minOutcomeCoverage: 0.2,
    },
  );

  assert.equal(result.status, 'pass');
  assert.equal(result.metrics.tokenSavingRatio, 0.5);
  assert.equal(result.metrics.outcomeCoverage, 0.25);
  assert.equal(result.metrics.layerCounts['L0+L1'], 20);
});

test('evaluateNorthStarMetrics fails on too little evidence and high fallback rate', () => {
  const decisions = [
    decision({
      decision_id: 'd-1',
      source_route: 'dispatcher_fallback_safe',
      token_estimate_full_read: null,
      tokens_saved_estimate: null,
    }),
  ];
  const result = evaluateNorthStarMetrics(
    { decisions, outcomeDecisionIds: [] },
    {
      minDecisions: 20,
      minEstimateCoverage: 0.8,
      minTokenSavingRatio: 0.35,
      maxFallbackSafeRate: 0.25,
      minOutcomeCoverage: 0.2,
    },
  );

  assert.equal(result.status, 'fail');
  assert.deepEqual(
    result.findings.filter((finding) => finding.status === 'fail').map((finding) => finding.code),
    [
      'min_decisions',
      'estimate_coverage',
      'token_saving_ratio',
      'fallback_safe_rate',
      'outcome_coverage',
    ],
  );
});

test('evaluateNorthStarMetrics clamps impossible saved tokens to the full read estimate', () => {
  const result = evaluateNorthStarMetrics(
    {
      decisions: [
        decision({ decision_id: 'd-1', token_estimate_full_read: 100, tokens_saved_estimate: 500 }),
      ],
      outcomeDecisionIds: ['d-1'],
    },
    {
      minDecisions: 1,
      minEstimateCoverage: 1,
      minTokenSavingRatio: 1,
      maxFallbackSafeRate: 1,
      minOutcomeCoverage: 1,
    },
  );

  assert.equal(result.metrics.tokensSavedEstimateSum, 100);
  assert.equal(result.metrics.tokenSavingRatio, 1);
});

test('parseArgs supports threshold overrides', () => {
  const parsed = parseArgs([
    '--db',
    'fixture.db',
    '--since',
    '2026-06-10T00:00:00Z',
    '--json',
    '--min-decisions=3',
    '--min-token-saving-ratio=0.6',
  ]);

  assert.equal(parsed.dbPath, 'fixture.db');
  assert.equal(parsed.since, '2026-06-10T00:00:00Z');
  assert.equal(parsed.json, true);
  assert.equal(parsed.thresholds.minDecisions, 3);
  assert.equal(parsed.thresholds.minTokenSavingRatio, 0.6);
});
