/**
 * V26-FIX-01 — `runTabrixChooseContextWithDirectApi` integration tests.
 *
 * Pin the async wrapper's contract:
 *   - Non-`knowledge_supported_read` routes return the synchronous
 *     chooser result bit-identical (no `directApiExecution` field).
 *   - `directApiEnabled === false` is also bit-identical.
 *   - High-confidence observed Knowledge + read-only intent → executor
 *     returns `executionMode='direct_api'` with compact rows so the
 *     upstream caller may skip `chrome_navigate` + `chrome_read_page`.
 *   - Reader failure collapses to `executionMode='fallback_required'`
 *     with `fallbackEntryLayer='L0+L1'` so the fallback chain stays at
 *     the legacy layer the chooser already declared.
 *   - Action / unknown intents short-circuit to
 *     `executionMode='skipped_not_read_only'` WITHOUT touching the
 *     injected fetch (auditable gate, not a rate-limit accident).
 *
 * No SQLite, no MCP server: this is the pure async glue layer that
 * sits between the chooser and the executor.
 */

import { runTabrixChooseContext, runTabrixChooseContextWithDirectApi } from './choose-context';
import type { ApiKnowledgeFetch } from '../api/api-knowledge';

function jsonFetch(status: number, body: unknown): ApiKnowledgeFetch {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

function rejectingFetch(reason: string): ApiKnowledgeFetch {
  return jest.fn().mockRejectedValue(Object.assign(new Error(reason), { name: 'AbortError' }));
}

const WORKSPACE_SEARCH_BODY = {
  total_count: 1,
  items: [
    {
      id: 1,
      full_name: 'tabrix/tabrix',
      description: 'Tabrix MCP browser tools',
      stargazers_count: 42,
      html_url: 'https://code.example/tabrix/tabrix',
    },
  ],
};

const WORKSPACE_SEARCH_INTENT = '搜索 Workspace 上 AI助手 相关热门项目，列出前10个';
const WORKSPACE_EMPTY_ITEMS_BODY = {
  total_count: 0,
  items: [],
};

function observedKnowledgeApi(rows: any[]) {
  return {
    listBySite: jest.fn().mockReturnValue(rows),
    listScoredBySite: jest.fn().mockReturnValue(rows),
    countAll: jest.fn().mockReturnValue(rows.length),
  } as any;
}

function observedSearchEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    endpointId: 'observed-ep-1',
    site: 'code.example',
    family: 'observed',
    method: 'GET',
    urlPattern: 'code.example/search/items',
    endpointSignature: 'GET code.example/search/items',
    semanticTag: null,
    statusClass: '2xx',
    requestSummary: {
      headerKeys: ['accept'],
      queryKeys: ['q', 'limit'],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: {
      contentType: 'application/json',
      sizeBytes: 128,
      shape: { kind: 'object', topLevelKeys: ['items'] },
    },
    sourceSessionId: 'session-observed',
    sourceStepId: 'step-observed',
    sourceHistoryRef: null,
    sampleCount: 3,
    firstSeenAt: '2026-04-22T00:00:00.000Z',
    lastSeenAt: '2026-04-22T00:01:00.000Z',
    endpointSource: 'observed',
    semanticType: 'search',
    confidence: 0.92,
    usableForTask: true,
    fallbackReason: null,
    correlationConfidence: 'low_confidence',
    ...overrides,
  };
}

describe('runTabrixChooseContextWithDirectApi', () => {
  it('non-knowledge_supported_read route is bit-identical to the synchronous chooser', async () => {
    const sync = runTabrixChooseContext({ intent: 'do something' }, { knowledgeApi: null });

    const fetchSpy = jsonFetch(200, WORKSPACE_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: 'do something' },
      {
        knowledgeApi: null,
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped).toEqual(sync);
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('directApiEnabled=false short-circuits even on observed knowledge_supported_read', async () => {
    const fetchSpy = jsonFetch(200, WORKSPACE_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: WORKSPACE_SEARCH_INTENT, url: 'https://code.example/search' },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        directApiFetchFn: fetchSpy,
        directApiEnabled: false,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('high-confidence observed read-only endpoint → direct_api with compact rows', async () => {
    const fetchSpy = jsonFetch(200, WORKSPACE_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: WORKSPACE_SEARCH_INTENT, url: 'https://code.example/search' },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect(wrapped.directApiExecution).toBeDefined();
    expect(wrapped.directApiExecution?.executionMode).toBe('direct_api');
    expect(wrapped.directApiExecution?.decisionReason).toBe('endpoint_knowledge_high_confidence');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(true);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(true);
    expect(wrapped.directApiExecution?.endpointFamily).toBe('observed');
    expect(wrapped.directApiExecution?.rowCount).toBe(1);
    expect(wrapped.directApiExecution?.rows?.length).toBe(1);
    expect(wrapped.directApiExecution?.fallbackCause).toBeNull();
    expect(wrapped.directApiExecution?.fallbackEntryLayer).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('derives API row limit from task wording for observed endpoints', async () => {
    const fetchSpy = jsonFetch(200, { items: [{ name: 'CI' }, { name: 'Nightly' }] });
    const wrapped = await runTabrixChooseContextWithDirectApi(
      {
        intent: '读取 CI 最近一次工作流运行的名称、状态、分支、触发时间和失败原因摘要',
        url: 'https://code.example/guodaxia103/tabrix/actions',
        pageRole: 'actions_detail',
      },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.directApiExecution?.executionMode).toBe('direct_api');
    expect(wrapped.directApiExecution?.endpointFamily).toBe('observed');
    expect(wrapped.directApiExecution?.rowCount).toBe(1);
    const url = new URL((fetchSpy as jest.Mock).mock.calls[0][0]);
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('observed empty list returns direct_api emptyResult instead of DOM fallback', async () => {
    const fetchSpy = jsonFetch(200, WORKSPACE_EMPTY_ITEMS_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      {
        intent: '读取示例工作区条目中匹配 __tabrix_pgb_02_no_match__ 的列表，预期返回空',
        url: 'https://code.example/search?q=repo%3Aguodaxia103%2Ftabrix+__tabrix_pgb_02_no_match__&type=issues',
        pageRole: 'item_list',
      },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.status).toBe('ok');
    expect(wrapped.sourceRoute).toBe('knowledge_supported_read');
    expect(wrapped.chosenLayer).toBe('L0');
    expect(wrapped.directApiExecution?.executionMode).toBe('direct_api');
    expect(wrapped.directApiExecution?.endpointFamily).toBe('observed');
    expect(wrapped.directApiExecution?.rowCount).toBe(0);
    expect(wrapped.directApiExecution?.emptyResult).toBe(true);
    expect(wrapped.directApiExecution?.emptyReason).toBe('no_matching_records');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(true);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('reader failure collapses to fallback_required with L0+L1 entry layer', async () => {
    const fetchSpy = rejectingFetch('aborted');
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: WORKSPACE_SEARCH_INTENT, url: 'https://code.example/search' },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.directApiExecution?.executionMode).toBe('fallback_required');
    expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(false);
    expect(wrapped.directApiExecution?.readPageAvoided).toBe(false);
    expect(wrapped.directApiExecution?.fallbackEntryLayer).toBe('L0+L1');
    expect(wrapped.directApiExecution?.rows).toBeNull();
    expect(wrapped.directApiExecution?.decisionReason).toMatch(/^api_call_failed_/);
  });

  it('non-knowledge URL bypasses the executor (no candidate, no field)', async () => {
    // A plain host with no observed Knowledge routes to `read_page_required`
    // and the wrapper never enters the executor.
    const fetchSpy = jsonFetch(200, WORKSPACE_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      { intent: '查看页面摘要', url: 'https://www.example.com/some-article' },
      {
        knowledgeApi: null,
        directApiFetchFn: fetchSpy,
      },
    );

    expect(wrapped.sourceRoute).not.toBe('knowledge_supported_read');
    expect((wrapped as { directApiExecution?: unknown }).directApiExecution).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('knowledge_supported_read with chosenLayer=L0+L1 (action route) skips direct execution', async () => {
    // Synthesise the priority-5 `knowledge_with_action` rule by
    // forcing `chosenLayer='L0+L1'`. This is the only place where
    // `sourceRoute='knowledge_supported_read'` and the user intent
    // is genuinely action-class. The wrapper must downgrade
    // `intentClass` to `'action'` so the executor short-circuits.
    //
    // We exercise that gate by injecting a high-density page context
    // that pushes the dispatcher off priority-2 and onto a
    // higher-layer knowledge route.
    const fetchSpy = jsonFetch(200, WORKSPACE_SEARCH_BODY);
    const wrapped = await runTabrixChooseContextWithDirectApi(
      // Open-style intent with observed Knowledge must still be treated as
      // browser action, not as a direct API read.
      {
        intent: '打开条目列表',
        url: 'https://code.example/octocat/hello-world',
        pageRole: 'item_list',
      },
      {
        knowledgeApi: observedKnowledgeApi([observedSearchEndpoint()]),
        pageContext: {
          getContext: () => ({
            source: 'live_snapshot',
            candidateActionsCount: 50,
            hvoCount: 30,
            fullReadByteLength: 50_000,
            pageRole: 'item_list',
          }),
        },
        directApiFetchFn: fetchSpy,
      },
    );

    // The chooser still produces a knowledge_supported_read route
    // (rule 5 fires for any `knowledgeAvailable` knowledge hit), but
    // `chosenLayer='L0+L1'` flags it as the action-side route. The
    // wrapper's gate downgrades `intentClass` to `'action'` so the
    // executor returns `skipped_not_read_only`.
    if (wrapped.sourceRoute === 'knowledge_supported_read' && wrapped.chosenLayer === 'L0+L1') {
      expect(wrapped.directApiExecution?.executionMode).toBe('skipped_not_read_only');
      expect(wrapped.directApiExecution?.browserNavigationSkipped).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });
});
