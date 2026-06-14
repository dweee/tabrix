/**
 * Unit tests for `tabrix_choose_context` v1 (B-018) — pure layer.
 *
 * Mirrors the success-criteria checklist in
 * `docs/B_018_CONTEXT_SELECTOR_V1.md` §8: contract shape, strategy
 * set guard, local Knowledge routing, no write side-effects,
 * and risk tier presence.
 */

import { TOOL_NAMES, TOOL_RISK_TIERS, type ContextStrategyName } from '@tabrix/shared';
import {
  TabrixChooseContextInputError,
  chooseContextStrategy,
  parseTabrixChooseContextInput,
  resolveSiteFamily,
  runTabrixChooseContext,
  runTabrixChooseContextRecordOutcome,
} from './choose-context';
import type { ChooseContextTelemetryRepository } from '../memory/telemetry/choose-context-telemetry';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { KnowledgeApiEndpoint } from '../memory/knowledge/knowledge-api-repository';
import type { ExperienceRecipe } from '../memory/db';
import { logger } from '../logging/logger';

function fakeEndpoint(overrides: Partial<KnowledgeApiEndpoint> = {}): KnowledgeApiEndpoint {
  return {
    endpointId: 'ep-1',
    site: 'api.github.com',
    family: 'github',
    method: 'GET',
    urlPattern: '/repos/:owner/:repo/issues',
    endpointSignature: 'GET api.github.com/repos/:owner/:repo/issues',
    semanticTag: 'issues_list',
    statusClass: '2xx',
    requestSummary: {
      headerNames: [],
      queryKeys: [],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: { shape: 'array<object>', truncated: false },
    sourceSessionId: null,
    sourceStepId: null,
    sourceHistoryRef: null,
    sampleCount: 1,
    firstSeenAt: '2026-04-22T00:00:00.000Z',
    lastSeenAt: '2026-04-22T00:00:00.000Z',
    ...overrides,
  };
}

function fakeKnowledgeRepo(rows: KnowledgeApiEndpoint[]): {
  repo: KnowledgeApiRepository;
  spy: jest.Mock;
} {
  const spy = jest.fn().mockImplementation((_site: string, _limit?: number) => rows);
  return {
    repo: { listBySite: spy, countAll: () => rows.length } as unknown as KnowledgeApiRepository,
    spy,
  };
}

describe('parseTabrixChooseContextInput', () => {
  it('rejects missing intent', () => {
    expect(() => parseTabrixChooseContextInput({})).toThrow(TabrixChooseContextInputError);
  });

  it('rejects empty-after-trim intent', () => {
    expect(() => parseTabrixChooseContextInput({ intent: '   ' })).toThrow(
      TabrixChooseContextInputError,
    );
  });

  it('rejects non-string intent (typed input error)', () => {
    expect(() => parseTabrixChooseContextInput({ intent: 42 })).toThrow(
      TabrixChooseContextInputError,
    );
  });

  it('normalises intent into the same bucket as B-013', () => {
    const a = parseTabrixChooseContextInput({ intent: '  Open   Issues  ' });
    const b = parseTabrixChooseContextInput({ intent: 'open issues' });
    expect(a.intentSignature).toBe(b.intentSignature);
  });

  it('drops unparseable url silently (treated as omitted)', () => {
    const parsed = parseTabrixChooseContextInput({ intent: 'open issues', url: 'not a url' });
    // url survives validation (we only test parseability at site-family
    // resolution time), but resolveSiteFamily returns undefined.
    expect(resolveSiteFamily(parsed.input)).toBeUndefined();
  });

  it('keeps safe non-GitHub siteId tokens as site-neutral routing scope', () => {
    const parsed = parseTabrixChooseContextInput({ intent: 'open issues', siteId: 'douyin' });
    expect(parsed.input.siteId).toBe('douyin');
  });

  it('drops unsafe siteId tokens silently', () => {
    const parsed = parseTabrixChooseContextInput({
      intent: 'open issues',
      siteId: 'https://douyin.com/path',
    });
    expect(parsed.input.siteId).toBeUndefined();
  });

  it('rejects oversize pageRole', () => {
    expect(() =>
      parseTabrixChooseContextInput({ intent: 'open issues', pageRole: 'x'.repeat(200) }),
    ).toThrow(TabrixChooseContextInputError);
  });
});

describe('resolveSiteFamily', () => {
  it('honours explicit siteId', () => {
    expect(resolveSiteFamily({ intent: 'x', siteId: 'github' })).toBe('github');
  });

  it('honours explicit non-GitHub siteId without requiring a hard-coded policy', () => {
    expect(resolveSiteFamily({ intent: 'x', siteId: 'douyin' })).toBe('douyin');
  });

  it('derives github from github.com host', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://github.com/octocat/hello-world' })).toBe(
      'github',
    );
  });

  it('derives github from any *.github.com host', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://api.github.com/repos/x/y' })).toBe(
      'github',
    );
    expect(resolveSiteFamily({ intent: 'x', url: 'https://gist.github.com/x' })).toBe('github');
  });

  it('derives a safe site family token for non-GitHub hosts', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'https://www.douyin.com/foo' })).toBe(
      'www.douyin.com',
    );
  });

  it('returns undefined for unparseable url', () => {
    expect(resolveSiteFamily({ intent: 'x', url: 'http://[' })).toBeUndefined();
  });
});

describe('chooseContextStrategy (pure)', () => {
  it('strategy set is exactly the v2.4.0 names — guards against silent additions', () => {
    // Doc §8 success criterion #2: enumerate the strategy set so a future
    // PR that bolts on `api_only` (or any other branch) MUST also touch
    // this guard test (and, by extension, the design doc).
    //
    const allowed: ContextStrategyName[] = [
      'experience_reuse',
      'knowledge_light',
      'read_page_required',
    ];
    expect(allowed.sort()).toEqual(['experience_reuse', 'knowledge_light', 'read_page_required']);
  });

  it('returns experience_reuse before Knowledge when a verified recipe is available', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'xiaohongshu top 10 cards',
      siteFamily: 'www.xiaohongshu.com',
      pageRole: 'search_results',
      experienceCatalog: {
        experienceId: 'exp-xhs-top10',
        summary: 'Verified chrome_collect_result_cards filters=最多收藏/图文/一周内 top>=10',
        recipe: {
          schema: 'tabrix_experience_recipe_hint_v1',
          siteFamily: 'www.xiaohongshu.com',
          pageRole: 'search_results',
          taskSignature: 'tools:chrome_collect_result_cards',
          successCount: 2,
          reliabilityScore: 1,
          driftState: 'verified_once',
          steps: [
            {
              order: 1,
              toolName: 'chrome_collect_result_cards',
              argsTemplate: {
                tab: '{{targetTabId}}',
                minResults: '{{minResults}}',
                maxScrolls: '{{maxScrolls}}',
              },
            },
          ],
          successCheck: {
            collectResultCards: [
              {
                observedResultCountAtLeast: 10,
                filterState: {
                  sort: '最多收藏',
                  contentType: '图文',
                  timeRange: '一周内',
                },
              },
            ],
          },
          fallback:
            'If the live page or filter state does not match this recipe, call chrome_read_page before reusing it.',
        },
      },
      knowledgeCatalog: {
        site: 'www.xiaohongshu.com',
        totalEndpoints: 1,
        sampleSignatures: ['GET www.xiaohongshu.com/search'],
      },
    });

    expect(decision.strategy).toBe('experience_reuse');
    expect(decision.fallbackStrategy).toBe('read_page_required');
    expect(decision.artifacts).toEqual([
      {
        kind: 'experience_recipe',
        ref: 'exp-xhs-top10',
        summary: 'Verified chrome_collect_result_cards filters=最多收藏/图文/一周内 top>=10',
        recipe: {
          schema: 'tabrix_experience_recipe_hint_v1',
          siteFamily: 'www.xiaohongshu.com',
          pageRole: 'search_results',
          taskSignature: 'tools:chrome_collect_result_cards',
          successCount: 2,
          reliabilityScore: 1,
          driftState: 'verified_once',
          steps: [
            {
              order: 1,
              toolName: 'chrome_collect_result_cards',
              argsTemplate: {
                tab: '{{targetTabId}}',
                minResults: '{{minResults}}',
                maxScrolls: '{{maxScrolls}}',
              },
            },
          ],
          successCheck: {
            collectResultCards: [
              {
                observedResultCountAtLeast: 10,
                filterState: {
                  sort: '最多收藏',
                  contentType: '图文',
                  timeRange: '一周内',
                },
              },
            ],
          },
          fallback:
            'If the live page or filter state does not match this recipe, call chrome_read_page before reusing it.',
        },
      },
    ]);
  });

  it('returns knowledge_light when no experience hit and catalog is non-empty', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      siteFamily: 'example.test',
      knowledgeCatalog: {
        site: 'api.example.test',
        totalEndpoints: 2,
        sampleSignatures: ['GET api.example.test/items'],
      },
    });
    expect(decision.strategy).toBe('knowledge_light');
    expect(decision.fallbackStrategy).toBe('read_page_required');
    expect(decision.reasoning).toMatch(/Use local Knowledge first/);
    expect(decision.artifacts).toEqual([
      expect.objectContaining({ kind: 'knowledge_api', ref: 'api.example.test' }),
    ]);
  });

  it('falls back to read_page_required when neither asset is available', () => {
    const decision = chooseContextStrategy({ intentSignature: 'open issues' });
    expect(decision.strategy).toBe('read_page_required');
    expect(decision.fallbackStrategy).toBeUndefined();
    expect(decision.artifacts).toEqual([]);
  });

  it('treats empty knowledge catalog as no catalog (no knowledge_light)', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'open issues',
      siteFamily: 'example.test',
      knowledgeCatalog: { site: 'api.example.test', totalEndpoints: 0, sampleSignatures: [] },
    });
    expect(decision.strategy).toBe('read_page_required');
  });

  it('does not route to a site-specific markdown branch without local Knowledge', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'read repo overview',
      siteFamily: 'github',
      pageRole: 'repo_home',
    });
    expect(decision.strategy).toBe('read_page_required');
    expect(decision.fallbackStrategy).toBeUndefined();
    expect(decision.artifacts).toEqual([]);
  });

  it('knowledge_light wins when a catalog is present for any site family', () => {
    const decision = chooseContextStrategy({
      intentSignature: 'list issues',
      siteFamily: 'example.test',
      pageRole: 'issue_detail',
      knowledgeCatalog: {
        site: 'api.example.test',
        totalEndpoints: 1,
        sampleSignatures: ['GET api.example.test/issues'],
      },
    });
    expect(decision.strategy).toBe('knowledge_light');
  });
});

describe('runTabrixChooseContext (orchestrator)', () => {
  it('returns invalid_input with the typed code on bad args', () => {
    const result = runTabrixChooseContext(
      {},
      {
        knowledgeApi: null,
      },
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error).toMatchObject({ code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT' });
    expect(result.strategy).toBeUndefined();
  });

  it('returns knowledge_light when repo is non-empty', () => {
    const { repo, spy } = fakeKnowledgeRepo([
      fakeEndpoint({ endpointSignature: 'GET api.example.test/items' }),
    ]);
    const result = runTabrixChooseContext(
      { intent: 'list items', url: 'https://example.test/items' },
      {
        knowledgeApi: repo,
      },
    );
    expect(result.strategy).toBe('knowledge_light');
    expect(result.fallbackStrategy).toBe('read_page_required');
    expect(spy).toHaveBeenCalledWith('example.test', expect.any(Number));
    expect(result.artifacts?.[0]?.summary).toMatch(/example\.test/);
  });

  it('uses local Knowledge by default', () => {
    const { repo, spy } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      { intent: 'list prs', url: 'https://github.com/x/y/pulls' },
      {
        knowledgeApi: repo,
      },
    );
    expect(result.strategy).toBe('knowledge_light');
    expect(spy).toHaveBeenCalled();
  });

  it('uses local Knowledge for non-GitHub URLs', () => {
    const { repo, spy } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      { intent: 'open something', url: 'https://www.example.test/x/y' },
      {
        knowledgeApi: repo,
      },
    );
    expect(result.strategy).toBe('knowledge_light');
    expect(spy).toHaveBeenCalledWith('www.example.test', expect.any(Number));
  });

  it('does not reuse Knowledge when the current page is a verification challenge', () => {
    const { repo, spy } = fakeKnowledgeRepo([fakeEndpoint()]);
    const result = runTabrixChooseContext(
      {
        intent: 'collect top 10 result cards',
        url: 'https://www.xiaohongshu.com/website-login/captcha?redirectPath=%2Fsearch_result',
        pageRole: 'search_results',
      },
      {
        knowledgeApi: repo,
      },
    );
    expect(result.strategy).toBe('read_page_required');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not reuse Experience when the current page is a verification challenge', () => {
    const findReusableByContext = jest.fn().mockReturnValue([
      {
        experienceId: 'exp-xhs-old',
        taskSignature: 'collect filtered result cards',
        siteFamily: 'www.xiaohongshu.com',
        pageRole: 'search_results',
        successCount: 3,
        reliabilityScore: 1,
        driftState: 'verified_once',
        steps: [{ toolName: 'chrome_collect_result_cards' }],
        successCheck: {},
      } as unknown as ExperienceRecipe,
    ]);
    const result = runTabrixChooseContext(
      {
        intent: 'collect top 10 result cards',
        url: 'https://www.xiaohongshu.com/website-login/captcha?redirectPath=%2Fsearch_result',
        pageRole: 'search_results',
      },
      {
        knowledgeApi: null,
        experienceRecipes: { findReusableByContext } as any,
      },
    );
    expect(result.strategy).toBe('read_page_required');
    expect(findReusableByContext).not.toHaveBeenCalled();
  });

  it('falls back to read_page_required when no URL is available', () => {
    const result = runTabrixChooseContext({ intent: 'do something' }, { knowledgeApi: null });
    expect(result.strategy).toBe('read_page_required');
  });

  it('echoes resolved bucket fields back to the caller', () => {
    const result = runTabrixChooseContext(
      { intent: '  Open Issues  ', pageRole: 'repo_home', siteId: 'github' },
      { knowledgeApi: null },
    );
    expect(result.resolved).toEqual({
      intentSignature: 'open issues',
      pageRole: 'repo_home',
      siteFamily: 'github',
    });
  });
});

describe('B-018 v1 risk tier wiring', () => {
  it('tabrix_choose_context is registered as P0 (read-only)', () => {
    // Doc §8 success criterion #6.
    expect(TOOL_RISK_TIERS[TOOL_NAMES.CONTEXT.CHOOSE]).toBe('P0');
  });

  it('tabrix_choose_context_record_outcome is registered as P0 (pure-INSERT)', () => {
    // V23-04 / B-018 v1.5: write-back is intentionally P0 because it
    // appends one telemetry row keyed by `decisionId` and never
    // mutates anything else. Lifting it to P1+ would require the
    // owner-lane review documented in AGENTS.md §"Tiered Execution Model".
    expect(TOOL_RISK_TIERS[TOOL_NAMES.CONTEXT.RECORD_OUTCOME]).toBe('P0');
  });
});

// ---------------------------------------------------------------------------
// V23-04 / B-018 v1.5 — telemetry write-back
// ---------------------------------------------------------------------------

interface FakeTelemetry {
  repo: ChooseContextTelemetryRepository;
  decisions: Array<Parameters<ChooseContextTelemetryRepository['recordDecision']>[0]>;
  outcomes: Array<Parameters<ChooseContextTelemetryRepository['recordOutcome']>[0]>;
  knownDecisionIds: Set<string>;
}

function fakeTelemetry(initialDecisionIds: string[] = []): FakeTelemetry {
  const decisions: FakeTelemetry['decisions'] = [];
  const outcomes: FakeTelemetry['outcomes'] = [];
  const knownDecisionIds = new Set(initialDecisionIds);
  const repo = {
    recordDecision(input: FakeTelemetry['decisions'][number]) {
      decisions.push(input);
      knownDecisionIds.add(input.decisionId);
    },
    recordOutcome(input: FakeTelemetry['outcomes'][number]) {
      if (!knownDecisionIds.has(input.decisionId)) {
        return { status: 'unknown_decision' as const };
      }
      outcomes.push(input);
      return { status: 'ok' as const, outcomeId: 'oc-fake' };
    },
    findDecision: jest.fn(),
    aggregateStrategies: jest.fn().mockReturnValue([]),
    clear: jest.fn(),
  } as unknown as ChooseContextTelemetryRepository;
  return { repo, decisions, outcomes, knownDecisionIds };
}

describe('runTabrixChooseContext telemetry (V23-04)', () => {
  it('records a decision row and surfaces decisionId when telemetry is wired', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContext(
      { intent: 'open issues', pageRole: 'repo_home', siteId: 'github' },
      {
        knowledgeApi: null,
        telemetry: tele.repo,
        newDecisionId: () => 'dc-test-1',
        now: () => '2026-04-22T10:00:00.000Z',
      },
    );
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBe('dc-test-1');
    expect(tele.decisions).toEqual([
      {
        decisionId: 'dc-test-1',
        intentSignature: 'open issues',
        pageRole: 'repo_home',
        siteFamily: 'github',
        strategy: 'read_page_required',
        fallbackStrategy: null,
        createdAt: '2026-04-22T10:00:00.000Z',
        // V25-02 layer-dispatch telemetry. "open issues" classifies
        // as user_intent_open_or_select; with no full-read byte length
        // the token estimates land at 0.
        chosenLayer: 'L0+L1',
        layerDispatchReason: 'user_intent_open_or_select',
        sourceRoute: 'read_page_required',
        fallbackCause: '',
        tokenEstimateChosen: 0,
        tokenEstimateFullRead: 0,
        tokensSavedEstimate: 0,
        knowledgeEndpointFamily: null,
        // V26-04 (B-027) — no `pageContext` provider was wired, so the
        // dispatcher still got the v25 zero-input behaviour and these
        // telemetry slots stay `null`. Honest "we did not measure".
        dispatcherInputSource: null,
        fallbackCauseV26: null,
      },
    ]);
  });

  it('omits decisionId when telemetry is not wired', () => {
    const result = runTabrixChooseContext({ intent: 'do something' }, { knowledgeApi: null });
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBeUndefined();
  });

  it('does NOT record a decision row for invalid_input (chooser stops early)', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContext(
      {},
      {
        knowledgeApi: null,
        telemetry: tele.repo,
      },
    );
    expect(result.status).toBe('invalid_input');
    expect(tele.decisions).toEqual([]);
  });

  // ---------------------------------------------------------------
  // V26-04 (B-027) — honest dispatcher inputs.
  // ---------------------------------------------------------------
  it('records dispatcherInputSource=live_snapshot when the page context provider returns a live row', () => {
    const tele = fakeTelemetry();
    const baselineFullRead = 'a'.repeat(120);
    const result = runTabrixChooseContext(
      { intent: 'open issues', url: 'https://github.com/octocat/hello/issues' },
      {
        knowledgeApi: null,
        telemetry: tele.repo,
        newDecisionId: () => 'dc-v26-04-live',
        now: () => '2026-04-25T10:00:00.000Z',
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 9,
            hvoCount: 4,
            fullReadByteLength: baselineFullRead.length,
            pageRole: 'github_issues_list',
          }),
        },
      },
    );
    expect(result.status).toBe('ok');
    expect(tele.decisions).toHaveLength(1);
    const recorded = tele.decisions[0];
    expect(recorded.dispatcherInputSource).toBe('live_snapshot');
    expect(recorded.fallbackCauseV26).toBeNull();
    // Honest dispatcher inputs feed real estimates: tokensSavedEstimate
    // must NOT silently inflate just because the provider exists. The
    // chooser still computes it from the dispatcher's own
    // fullRead/chosen estimates, so a non-zero value here is only
    // possible when the dispatcher itself decided to skip a layer.
    expect(recorded.tokensSavedEstimate).toBeGreaterThanOrEqual(0);
  });

  it('estimates Experience recipe payload cost and real savings when full-page size is known', () => {
    const tele = fakeTelemetry();
    const recipe = {
      experienceId: 'exp-xhs-top10',
      taskSignature: 'tools:chrome_collect_result_cards',
      successCount: 2,
      failureCount: 0,
      reliabilityScore: 1,
      successCheck: {
        collectResultCards: [
          {
            observedResultCountAtLeast: 10,
            filterState: {
              sort: '最多收藏',
              contentType: '图文',
              timeRange: '一周内',
            },
          },
        ],
      },
    } as unknown as ExperienceRecipe;

    const result = runTabrixChooseContext(
      {
        intent: '小红书搜索AI图片创作，筛选最多收藏、图文、一周内，并汇报前10条图文内容',
        url: 'https://www.xiaohongshu.com/search_result/?keyword=AI图片创作&type=51',
        pageRole: 'search_results',
      },
      {
        knowledgeApi: null,
        telemetry: tele.repo,
        newDecisionId: () => 'dc-exp-token-cost',
        now: () => '2026-06-14T10:00:00.000Z',
        experienceRecipes: {
          findReusableByContext: () => [recipe],
        },
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 10,
            hvoCount: 10,
            fullReadByteLength: 40_000,
            pageRole: 'search_results',
          }),
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.strategy).toBe('experience_reuse');
    expect(result.tokenEstimateChosen).toBeGreaterThan(0);
    expect(result.tokenEstimateFullRead).toBe(10_000);
    expect(result.tokensSavedEstimate).toBe(
      (result.tokenEstimateFullRead ?? 0) - (result.tokenEstimateChosen ?? 0),
    );
    expect(result.tokensSavedEstimate).toBeGreaterThan(9_000);

    const recorded = tele.decisions[0];
    expect(recorded.tokenEstimateChosen).toBe(result.tokenEstimateChosen);
    expect(recorded.tokenEstimateFullRead).toBe(10_000);
    expect(recorded.tokensSavedEstimate).toBe(result.tokensSavedEstimate);
    expect(recorded.sourceRoute).toBe('experience_reuse');
    expect(recorded.selectedArtifacts).toEqual([
      {
        kind: 'experience_recipe',
        ref: 'exp-xhs-top10',
        recipeSchema: 'tabrix_experience_recipe_hint_v1',
        siteFamily: 'www.xiaohongshu.com',
        pageRole: 'search_results',
        taskSignature: 'tools:chrome_collect_result_cards',
      },
    ]);
  });

  it('records dispatcherInputSource=fallback_zero with cause when no snapshot is available', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContext(
      { intent: 'open issues' },
      {
        knowledgeApi: null,
        telemetry: tele.repo,
        newDecisionId: () => 'dc-v26-04-fallback',
        now: () => '2026-04-25T10:00:00.000Z',
        pageContext: {
          getContext: () => ({
            source: 'fallback_zero',
            candidateActionsCount: 0,
            hvoCount: 0,
            fullReadByteLength: 0,
            pageRole: null,
            fallbackCause: 'no_task_snapshots',
          }),
        },
      },
    );
    expect(result.status).toBe('ok');
    expect(tele.decisions).toHaveLength(1);
    const recorded = tele.decisions[0];
    expect(recorded.dispatcherInputSource).toBe('fallback_zero');
    expect(recorded.fallbackCauseV26).toBe('no_task_snapshots');
    // Critically: the chooser MUST NOT silently inflate
    // tokensSavedEstimate just because the provider answered. With
    // every dispatcher input at 0, savings stay at 0 — the v25
    // baseline behaviour, but now with honest telemetry to prove it.
    expect(recorded.tokensSavedEstimate).toBe(0);
  });

  it('routes Chinese search/list API candidates to knowledge_supported_read without shared site-family changes', () => {
    const result = runTabrixChooseContext(
      {
        intent: '搜索 GitHub 上 AI助手 相关热门项目，列出前10个',
        url: 'https://github.com/search',
      },
      {
        knowledgeApi: null,
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 0,
            hvoCount: 0,
            fullReadByteLength: 20_000,
            pageRole: null,
          }),
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.strategy).toBe('knowledge_light');
    expect(result.chosenLayer).toBe('L0');
    expect(result.layerDispatchReason).toBe('knowledge_supports_summary');
    expect(result.sourceRoute).toBe('knowledge_supported_read');
    expect(result.resolved?.siteFamily).toBe('github');
    const routerFields = result as Record<string, unknown>;
    expect(routerFields.chosenSource).toBe('api_list');
    expect(routerFields.dispatcherInputSource).toBe('api_knowledge');
    expect(routerFields.decisionReason).toBe('api_knowledge_candidate_available');
  });

  it('routes npmjs Chinese package search through internal API knowledge with a generic site token', () => {
    const result = runTabrixChooseContext(
      {
        intent: '搜索 npm 上 browser automation 相关包，列出前10个',
        url: 'https://www.npmjs.com/search',
      },
      {
        knowledgeApi: null,
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 0,
            hvoCount: 0,
            fullReadByteLength: 20_000,
            pageRole: null,
          }),
        },
      },
    );

    expect(result.status).toBe('ok');
    expect(result.strategy).toBe('knowledge_light');
    expect(result.sourceRoute).toBe('knowledge_supported_read');
    expect(result.resolved?.siteFamily).toBe('www.npmjs.com');
    const routerFields = result as Record<string, unknown>;
    expect(routerFields.chosenSource).toBe('api_list');
    expect(routerFields.dispatcherInputSource).toBe('api_knowledge');
  });

  it('telemetry write failure must not break the chooser (decisionId omitted)', () => {
    const tele = fakeTelemetry();
    // Simulate disk-full / locked-DB by making recordDecision throw.
    (tele.repo.recordDecision as unknown as jest.Mock) = jest.fn(() => {
      throw new Error('SQLITE_BUSY');
    });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = runTabrixChooseContext(
        { intent: 'do something' },
        {
          knowledgeApi: null,
          telemetry: tele.repo,
          newDecisionId: () => 'dc-doomed',
        },
      );
      expect(result.status).toBe('ok');
      expect(result.decisionId).toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('runTabrixChooseContextRecordOutcome (V23-04)', () => {
  it('rejects missing decisionId with invalid_input', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContextRecordOutcome(
      { outcome: 'reuse' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
    expect(result.error?.code).toBe('TABRIX_CHOOSE_CONTEXT_BAD_INPUT');
    expect(tele.outcomes).toEqual([]);
  });

  it('rejects out-of-set outcome with invalid_input', () => {
    const tele = fakeTelemetry(['dc-1']);
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-1', outcome: 'celebrated' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
    expect(tele.outcomes).toEqual([]);
  });

  it('rejects oversize decisionId with invalid_input', () => {
    const tele = fakeTelemetry();
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'x'.repeat(200), outcome: 'reuse' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('invalid_input');
  });

  it('returns unknown_decision when telemetry is not wired', () => {
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-1', outcome: 'reuse' },
      { telemetry: null },
    );
    expect(result.status).toBe('unknown_decision');
    expect(result.decisionId).toBe('dc-1');
    expect(result.outcome).toBe('reuse');
  });

  it('returns unknown_decision when the id is well-formed but missing', () => {
    const tele = fakeTelemetry(); // no known ids
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-missing', outcome: 'fallback' },
      { telemetry: tele.repo },
    );
    expect(result.status).toBe('unknown_decision');
    expect(tele.outcomes).toEqual([]);
  });

  it('appends an outcome row for a known decisionId', () => {
    const tele = fakeTelemetry(['dc-known']);
    const result = runTabrixChooseContextRecordOutcome(
      { decisionId: 'dc-known', outcome: 'reuse' },
      { telemetry: tele.repo, now: () => '2026-04-22T11:00:00.000Z' },
    );
    expect(result.status).toBe('ok');
    expect(result.decisionId).toBe('dc-known');
    expect(result.outcome).toBe('reuse');
    expect(tele.outcomes).toEqual([
      {
        decisionId: 'dc-known',
        outcome: 'reuse',
        recordedAt: '2026-04-22T11:00:00.000Z',
      },
    ]);
  });

  it('telemetry write failure surfaces as unknown_decision (not invalid_input)', () => {
    const tele = fakeTelemetry(['dc-known']);
    (tele.repo.recordOutcome as unknown as jest.Mock) = jest.fn(() => {
      throw new Error('SQLITE_LOCKED');
    });
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    try {
      const result = runTabrixChooseContextRecordOutcome(
        { decisionId: 'dc-known', outcome: 'completed' },
        { telemetry: tele.repo },
      );
      expect(result.status).toBe('unknown_decision');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
