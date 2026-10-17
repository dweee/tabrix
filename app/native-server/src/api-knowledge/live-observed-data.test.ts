import {
  deriveLiveObservedApiDataFromBundle,
  type DeriveLiveObservedApiDataInput,
} from './live-observed-data';

function run(
  input: Partial<DeriveLiveObservedApiDataInput> & {
    bundle: DeriveLiveObservedApiDataInput['bundle'];
  },
) {
  return deriveLiveObservedApiDataFromBundle({
    ctx: {
      sessionId: 's_test',
      stepId: 'step_test',
      observedAt: '2026-04-28T10:00:00.000Z',
    },
    upsertedBySignature: new Map(),
    ...input,
  });
}

function observedSearchRequest(url: string) {
  return {
    url,
    method: 'GET',
    type: 'xmlhttprequest',
    statusCode: 200,
    mimeType: 'application/json',
    specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
    responseBody: JSON.stringify({
      items: [
        { title: 'row1', score: 1 },
        { title: 'row2', score: 2 },
      ],
    }),
  };
}

function signatureFor(rawUrl: string): string {
  const url = new URL(rawUrl);
  return `GET ${url.hostname.toLowerCase()}${url.pathname}`;
}

function upsertState(
  rawUrl: string,
  correlationConfidence: 'unknown_candidate' | 'low_confidence' | 'high_confidence' | null,
  correlatedRegionId: string | null,
) {
  return new Map([
    [
      signatureFor(rawUrl),
      {
        endpointId: 'endpoint_1',
        knowledgeUpserted: true,
        correlationConfidence,
        correlatedRegionId,
      },
    ],
  ]);
}

describe('live-observed-data selector', () => {
  it('metadata-only capture does not produce live observed rows', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'response_summary_unavailable',
    });
  });

  it('browser-context safe response summary produces current-task rows without responseBody', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=&page=';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                { title: 'compact result one', likeCount: 3 },
                { title: 'compact result two', likeCount: 5 },
              ],
              rowCount: 2,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['likeCount', 'title'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    const blob = JSON.stringify(out);

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      rowCount: 2,
      liveObservedEndpointId: null,
      responseSummarySource: 'browser_context_summary',
      rawBodyPersisted: false,
      capturedAfterArm: true,
      bridgePath: 'main_world_to_content_to_native',
      pageRegion: 'task_query_network',
    });
    expect(blob).not.toMatch(/"responseBody"/);
    expect(blob).not.toContain('desk');
  });

  it('rejects browser-context summary rows that still contain sensitive fields', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items?keyword=';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'compact result one',
                  token: '0123456789abcdef0123456789abcdef',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['title', 'token'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'sensitive_row_content',
      privacyCheck: 'failed',
      responseSummarySource: 'browser_context_summary',
    });
    expect(blob).not.toContain('0123456789abcdef0123456789abcdef');
  });

  it('safe response summary before arm is rejected', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=',
            method: 'GET',
            type: 'xmlhttprequest',
            requestTime: 1_779_138_000_900,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [{ title: 'late' }],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['title'],
              taskQueryValueMatched: true,
              samplerArmedAt: 1_779_138_001_000,
              capturedAt: 1_779_138_001_100,
            },
          },
        ],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      fallbackCause: 'response_before_sampler_arm',
      responseSummarySource: 'browser_context_summary',
      fallbackUsed: true,
    });
  });

  it('uncorrelated response-body candidate is rejected with relevance evidence', () => {
    const out = run({
      bundle: {
        requests: [
          {
            url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            responseBody: JSON.stringify({
              items: [{ title: 'feed1' }, { title: 'feed2' }],
            }),
          },
        ],
      },
    });
    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'dom_region_correlation_missing',
      pageRegion: 'current_page_network',
    });
  });

  it('correlated CDP enhanced response body can produce compact rows with controlled evidence', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: 25,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        fallbackCause: null,
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      observationMode: 'cdp_enhanced',
      selectedDataSource: 'cdp_enhanced_api_rows',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 25,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      fallbackCause: null,
      fallbackUsed: false,
      rowCount: 2,
    });
    expect(JSON.stringify(out.selected[0])).not.toMatch(/"responseBody"/);
  });

  it('rejects CDP enhanced rows when detach did not succeed', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: 25,
        cdpDetachSuccess: false,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        fallbackCause: 'cdp_detach_failed',
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpDetachSuccess: false,
      fallbackCause: 'cdp_detach_failed',
      fallbackUsed: true,
    });
  });

  it('correlated safe response body can produce compact rows', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        requests: [observedSearchRequest(requestUrl)],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      rowCount: 2,
      emptyResult: false,
      pageRegion: 'task_query_network',
      rawBodyStored: false,
      privacyCheck: 'passed',
      fallbackCause: null,
      fallbackUsed: false,
    });
    expect(out.selected[0].pageRegion).not.toBe('current_page_network');
    expect(JSON.stringify(out.selected[0])).not.toMatch(/"responseBody"/);
  });

  it('rejects debugger response-body rows with sensitive value shapes before output', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: {
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
            responseBody: JSON.stringify({
              items: [
                {
                  title: 'feed1',
                  ownerEmail: 'person@example.test',
                },
              ],
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword', 'page'],
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'sensitive_row_content',
      privacyCheck: 'failed',
    });
    expect(blob).not.toContain('person@example.test');
  });

  it('low confidence DOM correlation is rejected', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      upsertedBySignature: upsertState(requestUrl, 'low_confidence', 'search_results'),
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'low_correlation_confidence',
      pageRegion: 'search_results',
    });
  });

  it('high confidence DOM correlation can pass without query value', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      upsertedBySignature: upsertState(requestUrl, 'high_confidence', 'search_results'),
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      pageRegion: 'search_results',
      rowCount: 2,
    });
    expect(out.selected[0].pageRegion).not.toBe('current_page_network');
  });

  it('same query keys but different query values are rejected without leaking values', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=chair&page=1';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword'],
      },
    });
    const blob = JSON.stringify(out);

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'task_query_value_unproven',
      pageRegion: 'current_page_network',
    });
    expect(blob).not.toContain('desk');
    expect(blob).not.toContain('chair');
  });

  it('matching query value can pass task-query relevance', () => {
    const requestUrl =
      'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
        expectedTaskQueryKeys: ['keyword'],
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_rows',
      pageRegion: 'task_query_network',
      rowCount: 2,
    });
  });

  it('correlated content endpoint produces api_content without claiming api rows', () => {
    const requestUrl = 'https://neutral-social.example.test/api/share/content?share_id=abc123';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpReason: 'need_response_body',
        cdpAttachDurationMs: 18,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              ok: true,
              data: {
                title: 'Shared conversation about browser task thing model',
                content:
                  '物模型把静态属性、时序属性、可控调节属性和服务动作分开。' +
                  '在浏览器自动化场景中，Tabrix 应该把页面和任务都看成可观察、可控制、可审计的对象。' +
                  '这样 AI 助手可以读取完整正文，同时保留数据源证据和低干扰策略。',
              },
            }),
          },
        ],
      },
      upsertedBySignature: upsertState(requestUrl, 'high_confidence', 'article_body'),
    });
    const blob = JSON.stringify(out);

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      endpointSource: 'observed',
      selectedDataSource: 'api_content',
      semanticType: 'unknown_candidate',
      rowCount: 0,
      contentSectionCount: 1,
      pageRegion: 'article_body',
      rawBodyStored: false,
      rawBodyPersisted: false,
      privacyCheck: 'passed',
      fallbackCause: null,
      fallbackUsed: false,
    });
    expect(out.selected[0].contentText).toContain('物模型');
    expect(out.selected[0].contentText).toContain('浏览器自动化场景');
    expect(blob).not.toMatch(/"responseBody"/);
    expect(blob).not.toContain('share_id=abc123');
  });

  it('keeps long single-field api_content within the response text cap', () => {
    const requestUrl = 'https://neutral-social.example.test/api/share/content?share_id=abc123';
    const longBody =
      '物模型把静态属性、时序属性、可控调节属性和服务动作分开。' +
      '浏览器自动化场景需要完整正文作为证据。'.repeat(500);
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        rawBodyPersisted: false,
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              ok: true,
              data: { content: longBody },
            }),
          },
        ],
      },
      upsertedBySignature: upsertState(requestUrl, 'high_confidence', 'article_body'),
    });

    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'api_content',
      contentSectionCount: 1,
    });
    expect(out.selected[0].contentText).toHaveLength(longBody.length);
    expect(out.selected[0].contentSections[0]?.chars).toBe(longBody.length);
  });

  it('does not require knowledge upsert state for same-origin api_content', () => {
    const requestUrl = 'https://neutral-social.example.test/api/share/content?share_id=abc123';
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        rawBodyPersisted: false,
        requests: [
          {
            url: requestUrl,
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              ok: true,
              data: {
                content:
                  '物模型把静态属性、时序属性、可控调节属性和服务动作分开。' +
                  '浏览器自动化场景可以从同源内容接口读取完整正文，但不能持久化原始响应体。' +
                  '这个能力用于真实页面长内容读取，必须保留数据源证据、同源相关性、隐私过滤和低干扰浏览器清理证据。',
              },
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/share/abc123',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'api_content',
      endpointFamily: 'neutral-social.example.test/api/share/content',
      knowledgeUpserted: false,
      liveObservedEndpointId: null,
      pageRegion: 'content_source_network',
      rawBodyStored: false,
    });
  });

  it('rejects non-content task-query JSON as api_content', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        rawBodyPersisted: false,
        requests: [
          {
            url: 'https://docs.example.test/_static/search-index.json',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              entries: [
                {
                  term: 'asyncio',
                  definition:
                    'A Python library entry loaded from shared documentation chrome, not from the current search results.',
                },
              ],
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://docs.example.test/search.html?q=asyncio',
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      fallbackUsed: true,
      pageRegion: 'task_query_network',
    });
    expect(out.rejected[0].selectedDataSource).not.toBe('api_content');
  });

  it('allows cross-origin search provider api_rows only when body matches the task query', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              hits: [
                {
                  title: 'browser automation tools',
                  description:
                    'A search result about browser automation with points and comments metadata.',
                },
              ],
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      knowledgeUpserted: false,
      pageRegion: 'task_query_network',
      rowCount: 1,
      rawBodyStored: false,
    });
    expect(out.selected[0].rows[0]?.title).toBe('browser automation tools');
  });

  it('allows cross-origin search provider api_rows from safe summary rows without raw responseBody', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'XHR',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'browser automation tools',
                  description: 'points and comments metadata for browser automation results',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['description', 'title'],
              taskQueryValueMatched: null,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      responseSummarySource: 'browser_context_summary',
      pageRegion: 'task_query_network',
      rowCount: 1,
      rawBodyStored: false,
    });
    expect(JSON.stringify(out.selected[0])).not.toMatch(/"responseBody"/);
  });

  it('allows multi-query search provider safe summary rows when they match the task query', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/*/queries?x-provider-agent=redacted',
            method: 'POST',
            type: 'XHR',
            requestTime: 2000,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'AI Search',
                  description:
                    'Algolia AI Search helps teams build search and discovery experiences.',
                },
              ],
              rowCount: 10,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['description', 'title'],
              taskQueryValueMatched: null,
              samplerArmedAt: 1000,
              capturedAt: 2100,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://www.example.test/search?query=AI%20Search',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      responseSummarySource: 'browser_context_summary',
      pageRegion: 'task_query_network',
      rowCount: 1,
      rawBodyStored: false,
    });
    expect(out.selected[0].rows[0]?.title).toBe('AI Search');
  });

  it('allows safe summary rows when CDP request time uses a monotonic clock', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'XHR',
            requestTime: 73381905.408,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'browser automation tools',
                  description: 'points and comments metadata for browser automation results',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['description', 'title'],
              taskQueryValueMatched: null,
              samplerArmedAt: 1_779_138_273_917,
              capturedAt: 1_779_138_274_200,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      responseSummarySource: 'browser_context_summary',
      rowCount: 1,
    });
  });

  it('sanitizes public result urls and opaque ids from browser-context api_rows', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query?x-api-key=redacted',
            method: 'POST',
            type: 'XHR',
            requestTime: 73381905.408,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'Show HN: Browser automation for AI',
                  url: 'https://code.example/example/browser-automation?utm_source=feed#readme',
                  author: 'hugs',
                  points: 443,
                  num_comments: 124,
                  objectID: '0123456789abcdef0123456789abcdef',
                  story_text: 'browser automation result with points and comments metadata',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: [
                'author',
                'num_comments',
                'objectID',
                'points',
                'story_text',
                'title',
                'url',
              ],
              taskQueryValueMatched: null,
              samplerArmedAt: 1_779_138_273_917,
              capturedAt: 1_779_138_274_200,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.rejected).toHaveLength(0);
    expect(out.selected[0]).toMatchObject({
      selectedDataSource: 'cdp_enhanced_api_rows',
      responseSummarySource: 'browser_context_summary',
      rowCount: 1,
    });
    expect(out.selected[0].rows[0]).toMatchObject({
      title: 'Show HN: Browser automation for AI',
      publicUrl: 'https://code.example/example/browser-automation',
      points: 443,
      num_comments: 124,
    });
    const blob = JSON.stringify(out.selected[0]);
    expect(blob).not.toContain('utm_source');
    expect(blob).not.toContain('0123456789abcdef0123456789abcdef');
    expect(blob).not.toMatch(/"url"/);
  });

  it('prefers safe API rows over same-response content summary when both are task-relevant', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        responseBodySource: 'debugger_api',
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'XHR',
            requestTime: 73381905.408,
            statusCode: 200,
            mimeType: 'application/json',
            safeResponseSummary: {
              responseSummarySource: 'browser_context_summary',
              bridgePath: 'main_world_to_content_to_native',
              capturedAfterArm: true,
              rawBodyPersisted: false,
              privacyCheck: 'passed',
              rejectedReason: null,
              rows: [
                {
                  title: 'browser automation tools',
                  description: 'points and comments metadata for browser automation results',
                },
              ],
              rowCount: 1,
              emptyResult: false,
              fieldShapeSummaryAvailable: true,
              fieldNames: ['description', 'title'],
              taskQueryValueMatched: null,
              samplerArmedAt: 1_779_138_273_917,
              capturedAt: 1_779_138_274_200,
            },
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.selected).toHaveLength(1);
    expect(out.selected[0]).toMatchObject({
      rowCount: 1,
      selectedDataSource: 'cdp_enhanced_api_rows',
    });
  });

  it('rejects cross-origin search provider api_rows when response body does not match the task query', () => {
    const out = run({
      bundle: {
        observationMode: 'cdp_enhanced',
        cdpUsed: true,
        cdpDetachSuccess: true,
        debuggerConflict: false,
        rawBodyPersisted: false,
        bodyCompacted: true,
        requests: [
          {
            url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
            responseBody: JSON.stringify({
              hits: [
                {
                  title: 'unrelated result',
                  description:
                    'A long enough content field about another topic with points and comments metadata.',
                },
              ],
            }),
          },
        ],
      },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search?q=browser%20automation',
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      fallbackCause: 'relevance_unproven',
      pageRegion: 'current_page_network',
    });
  });

  it('path-only search/list similarity is not enough', () => {
    const requestUrl = 'https://api.neutral-social.example.test/v1/search/items';
    const out = run({
      bundle: { requests: [observedSearchRequest(requestUrl)] },
      selectorContext: {
        currentPageUrl: 'https://neutral-social.example.test/search',
        expectedTaskQueryKeys: ['keyword'],
      },
    });

    expect(out.selected).toHaveLength(0);
    expect(out.rejected[0]).toMatchObject({
      endpointSource: 'observed',
      fallbackUsed: true,
      fallbackCause: 'task_query_value_unproven',
      pageRegion: 'current_page_network',
    });
  });
});
