import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildComparisonFromInputs,
  buildMarkdownReport,
  evaluateComparison,
  parseArgs,
  redactSensitiveUrl,
  summarizeCompetitorEvidence,
  summarizeTabrixEvidence,
} from './browser-object-scenario-compare.mjs';

describe('browser-object-scenario-compare', () => {
  it('parses scenario expectations without hard-coding a platform', () => {
    const args = parseArgs([
      '--scenario-id',
      'search-filter-top10',
      '--required-filter',
      '最多收藏',
      '--required-filter',
      '图文',
      '--min-cards',
      '10',
      '--competitor-label',
      'codex-chrome-proxy',
      '--allow-needs-work',
    ]);

    assert.equal(args.scenarioId, 'search-filter-top10');
    assert.deepEqual(args.requiredFilters, ['最多收藏', '图文']);
    assert.equal(args.minCards, 10);
    assert.equal(args.competitorLabel, 'codex-chrome-proxy');
    assert.equal(args.allowNeedsWork, true);
  });

  it('redacts sensitive URL parameters before evidence is summarized', () => {
    const url =
      'https://example.test/item/1?xsec_token=ABCDabcd1234ABCDabcd1234ABCD&keep=ok&session=secret-value';

    assert.equal(redactSensitiveUrl(url), 'https://example.test/item/1?keep=ok');
  });

  it('marks Tabrix evidence incomplete when required filter active state is missing', () => {
    const summary = summarizeTabrixEvidence(
      {
        parsed: {
          observedResultCount: 10,
          targetRefCoverageRate: 0.9,
          filterState: { appliedLabels: ['综合'], status: 'observed' },
          targetabilitySummary: {
            stableClickTargetCount: 9,
            urlFallbackCount: 1,
          },
          cards: Array.from({ length: 10 }, (_, index) => ({
            rank: index + 1,
            title: `Card ${index + 1}`,
            url: `https://example.test/detail/${index + 1}?xsec_token=verylongverylongverylongverylong`,
            targetabilityStatus: index === 9 ? 'url_fallback' : 'stable_click_target',
          })),
        },
      },
      {
        minCards: 10,
        requiredFilters: ['最多收藏', '图文', '一周内'],
      },
    );

    assert.equal(summary.ok, false);
    assert.deepEqual(summary.filterState.missingRequiredLabels, ['最多收藏', '图文', '一周内']);
    assert.equal(summary.resultCards.stableClickTargetCount, 9);
    assert.equal(summary.topCards[0].url, 'https://example.test/detail/1');
  });

  it('detects competitor login blocking and maps it into next actions', () => {
    const competitor = summarizeCompetitorEvidence(
      {
        url: 'https://example.test',
        title: 'Example',
        controlCount: 2,
        linkCount: 0,
        searchLike: [{ name: '登录探索更多内容', rect: { x: 1, y: 2, width: 3, height: 4 } }],
        candidateCards: [],
      },
      { minCards: 10, requiredFilters: ['最多收藏'] },
    );

    assert.equal(competitor.ok, false);
    assert.equal(competitor.visibleControls.loginBlocked, true);

    const comparison = evaluateComparison({
      tabrix: null,
      competitor,
      windows: null,
      scenario: { id: 'search-filter-top10', minCards: 10, requiredFilters: ['最多收藏'] },
    });

    assert.equal(comparison.status, 'NEEDS_WORK');
    assert.ok(comparison.mustFix.includes('competitor-login-free'));
    assert.ok(comparison.nextActions.some((action) => action.includes('session ownership')));
  });

  it('treats explicit competitor login-blocked probe fields as a failed comparison gate', () => {
    const competitor = summarizeCompetitorEvidence(
      {
        url: 'https://www.xiaohongshu.com/explore',
        title: '小红书 - 你的生活兴趣社区',
        loginBlocked: true,
        searchBox: {
          observed: true,
          placeholder: '登录探索更多内容',
          usableForSearch: false,
        },
        candidateCards: [],
      },
      { minCards: 10, requiredFilters: ['最多收藏'] },
    );

    assert.equal(competitor.ok, false);
    assert.equal(competitor.visibleControls.loginBlocked, true);

    const comparison = evaluateComparison({
      tabrix: null,
      competitor,
      windows: null,
      scenario: { id: 'search-filter-top10', minCards: 10, requiredFilters: ['最多收藏'] },
    });

    assert.ok(comparison.mustFix.includes('competitor-login-free'));
  });

  it('builds a comparison report with concrete must-fix checks', () => {
    const tabrixCollect = {
      parsed: {
        observedResultCount: 10,
        targetRefCoverageRate: 0.9,
        filterState: { appliedLabels: ['综合'], status: 'observed' },
        targetabilitySummary: {
          stableClickTargetCount: 9,
          urlFallbackCount: 1,
        },
        cards: [{ rank: 1, title: 'First card', targetabilityStatus: 'stable_click_target' }],
      },
    };
    const tabrixWindows = {
      parsed: {
        currentPage: {
          title: 'Search page',
          pageStateLabel: '前台页',
          canTabrixOperate: true,
        },
        windowCount: 1,
        tabCount: 1,
      },
    };
    const competitorInput = {
      url: 'https://example.test',
      title: 'Example',
      searchLike: [{ name: '登录' }],
      candidateCards: [],
    };
    const result = buildComparisonFromInputs({
      tabrixCollect,
      tabrixWindows,
      competitorInput,
      args: {
        competitorLabel: 'proxy',
        minCards: 10,
        requiredFilters: ['最多收藏', '图文'],
        scenarioId: 'search-filter-top10',
      },
    });

    assert.equal(result.comparison.status, 'NEEDS_WORK');
    assert.deepEqual(result.tabrix.filterState.missingRequiredLabels, ['最多收藏', '图文']);
    assert.ok(result.comparison.mustFix.includes('tabrix-required-filter-state'));
    assert.ok(result.comparison.mustFix.includes('competitor-login-free'));

    const markdown = buildMarkdownReport({ ...result, artifactFiles: ['one.json'] });
    assert.match(markdown, /Browser Object Scenario Comparison/);
    assert.match(markdown, /FAIL tabrix-required-filter-state/);
    assert.match(markdown, /Session/);
  });
});
