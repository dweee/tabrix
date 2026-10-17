import {
  classifyApiKnowledgeMetadata,
  clearApiKnowledgeCompactResultCacheForTests,
  readApiKnowledgeEndpointPlan,
  readApiKnowledgeRows,
  readApiKnowledgeRowsForIntent,
  resolveApiKnowledgeCandidate,
} from './api-knowledge';

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  clearApiKnowledgeCompactResultCacheForTests();
});

describe('API Knowledge legacy compatibility surface', () => {
  it('does not classify platform seed metadata', () => {
    expect(
      classifyApiKnowledgeMetadata({
        url: 'https://api.content.example/search?q=secret-token-value&limit=10',
        method: 'GET',
        status: 200,
        timingMs: 42,
        sizeBytes: 512,
        contentType: 'application/json; charset=utf-8',
      }),
    ).toBeNull();
  });

  it('does not resolve hardcoded candidates from intent or URL text', () => {
    expect(
      resolveApiKnowledgeCandidate({
        intent: 'search popular content',
        url: 'https://content.example/search?q=tabrix',
        pageRole: 'search',
      }),
    ).toBeNull();
  });

  it('intent reader falls back when no observed candidate is available', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeRowsForIntent({
      intent: 'search products',
      url: 'https://content.example/search?q=widget',
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'unsupported_site_family',
      fallbackEntryLayer: 'L0+L1',
      telemetry: {
        reason: 'unsupported_site_family',
        readAllowed: false,
        fallbackEntryLayer: 'L0+L1',
      },
    });
  });

  it('row reader denies non-read methods before constructing any request', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeRows({
      endpointFamily: 'observed_search_results',
      method: 'POST',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'method_denied',
      fallbackEntryLayer: 'L0+L1',
      telemetry: { readAllowed: false },
    });
  });

  it('row reader refuses GET families that are not backed by an observed safe request plan', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeRows({
      endpointFamily: 'legacy_platform_search',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'invalid_request',
      fallbackEntryLayer: 'L0+L1',
      telemetry: { readAllowed: false },
    });
  });

  it('endpoint read plan also refuses legacy families instead of inventing requests', async () => {
    const fetchFn = jest.fn();
    const result = await readApiKnowledgeEndpointPlan({
      endpointFamily: 'legacy_platform_search',
      dataPurpose: 'observed_search',
      method: 'GET',
      params: { query: 'tabrix' },
      fetchFn,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 'fallback_required',
      reason: 'semantic_mismatch',
      fallbackEntryLayer: 'L0+L1',
      telemetry: {
        reason: 'semantic_mismatch',
        readAllowed: false,
        fallbackEntryLayer: 'L0+L1',
      },
    });
  });
});
