import {
  COLD_START_TRANSIENT_REASONS,
  DIRECT_API_COLD_START_BUDGET_MS_DEFAULT,
  classifyDirectApiIntent,
  tryDirectApiExecute,
  type DirectApiExecutorInput,
} from './direct-api-executor';
import type { ApiKnowledgeFetch } from '../api/api-knowledge';
import type { DataNeed, EndpointKnowledgeReader } from '../api-knowledge/types';
import type {
  EndpointSemanticType,
  KnowledgeApiEndpoint,
} from '../memory/knowledge/knowledge-api-repository';

function jsonFetch(status: number, body: unknown): ApiKnowledgeFetch {
  return jest.fn().mockResolvedValue({
    status,
    headers: { get: jest.fn().mockReturnValue('application/json') },
    json: jest.fn().mockResolvedValue(body),
  });
}

type ScoredFixtureRow = KnowledgeApiEndpoint & {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
};

function knowledgeRow(overrides: Partial<ScoredFixtureRow>): ScoredFixtureRow {
  return {
    endpointId: 'observed-search-endpoint',
    site: 'api.content.example',
    family: 'observed',
    method: 'GET',
    urlPattern: 'api.content.example/search',
    endpointSignature: 'GET api.content.example/search',
    semanticTag: null,
    statusClass: '2xx',
    requestSummary: {
      headerKeys: [],
      queryKeys: ['limit', 'q'],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: {
      contentType: 'application/json',
      sizeBytes: 1024,
      shape: { kind: 'array', itemCount: 5, sampleItemKeys: ['id', 'title'] },
    },
    sourceSessionId: null,
    sourceStepId: null,
    sourceHistoryRef: null,
    sampleCount: 3,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    semanticTypePersisted: 'search',
    queryParamsShape: 'limit,q',
    responseShapeSummary: 'array:n=5,keys=2',
    usableForTaskPersisted: true,
    noiseReason: null,
    endpointSource: 'observed',
    correlationConfidence: null,
    correlatedRegionId: null,
    confidenceReason: null,
    retirementCandidate: false,
    sourceLineage: null,
    schemaVersion: 2,
    lastFailureReason: null,
    seedAdapterRetirementState: 'not_applicable',
    semanticType: 'search',
    confidence: 0.88,
    usableForTask: true,
    fallbackReason: null,
    ...overrides,
  };
}

function makeRepo(rows: ScoredFixtureRow[]): EndpointKnowledgeReader {
  return {
    listScoredBySite(site: string) {
      return rows.filter((row) => row.site === site);
    },
  };
}

const observedDataNeed: DataNeed = {
  intent: 'search observed content',
  intentClass: 'read_only',
  semanticTypeWanted: 'search',
  urlHint: 'https://api.content.example/search?q=tabrix',
  pageRole: null,
  params: { query: 'tabrix', limit: 2 },
};

function inputWith(overrides: Partial<DirectApiExecutorInput>): DirectApiExecutorInput {
  return {
    sourceRoute: 'knowledge_supported_read',
    candidate: null,
    intentClass: 'read_only',
    ...overrides,
  };
}

describe('classifyDirectApiIntent', () => {
  it('maps reading_only to read_only and action to action', () => {
    expect(classifyDirectApiIntent('reading_only')).toBe('read_only');
    expect(classifyDirectApiIntent('action')).toBe('action');
  });

  it('falls back to unknown for any other hint', () => {
    expect(classifyDirectApiIntent(undefined)).toBe('unknown');
    expect(classifyDirectApiIntent('something_else')).toBe('unknown');
  });
});

describe('tryDirectApiExecute observed Knowledge gate', () => {
  it('does not execute a legacy candidate when there is no observed Knowledge match', async () => {
    const fetchFn = jest.fn();
    const result = await tryDirectApiExecute(
      inputWith({
        candidate: {
          endpointFamily: 'legacy_platform_search',
          dataPurpose: 'search_list',
          confidence: 0.99,
          method: 'GET',
          params: { query: 'tabrix' },
        },
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );

    expect(result.executionMode).toBe('skipped_no_candidate');
    expect(result.decisionReason).toBe('endpoint_not_resolved');
    expect(result.browserNavigationSkipped).toBe(false);
    expect(result.rows).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('high-confidence observed endpoint executes direct_api with api_rows contract', async () => {
    const fetchFn = jsonFetch(200, [
      { id: 'a1', title: 'First result' },
      { id: 'a2', title: 'Second result' },
    ]);
    const repo = makeRepo([knowledgeRow({ confidence: 0.91 })]);

    const result = await tryDirectApiExecute(
      inputWith({ dataNeed: observedDataNeed, knowledgeRepo: repo, fetchFn }),
    );

    expect(result.executionMode).toBe('direct_api');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.knowledgeEndpointId).toBe('observed-search-endpoint');
    expect(result.endpointFamily).toBe('observed');
    expect(result.endpointSource).toBe('observed');
    expect(result.browserNavigationSkipped).toBe(true);
    expect(result.readPageAvoided).toBe(true);
    expect(result.rows).toMatchObject({
      rowCount: 2,
      compact: true,
      rawBodyStored: false,
      dataPurpose: 'observed_search',
    });
    expect(result.layerContract.dataSource).toBe('api_rows');
    expect(result.layerContract.disallowedUses).toEqual(
      expect.arrayContaining(['execution', 'locator']),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('low-confidence observed endpoint falls back to normal page reading', async () => {
    const fetchFn = jest.fn();
    const repo = makeRepo([knowledgeRow({ confidence: 0.5 })]);

    const result = await tryDirectApiExecute(
      inputWith({
        dataNeed: observedDataNeed,
        knowledgeRepo: repo,
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );

    expect(result.executionMode).toBe('skipped_no_candidate');
    expect(result.decisionReason).toBe('endpoint_not_resolved');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('deprecated seed rows are ignored and cannot masquerade as observed Knowledge', async () => {
    const fetchFn = jest.fn();
    const repo = makeRepo([
      knowledgeRow({
        endpointId: 'deprecated-seed',
        endpointSource: 'deprecated_seed',
        confidence: 0.95,
      }),
    ]);

    const result = await tryDirectApiExecute(
      inputWith({
        dataNeed: observedDataNeed,
        knowledgeRepo: repo,
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );

    expect(result.executionMode).toBe('skipped_no_candidate');
    expect(result.endpointSource).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('action intent never triggers direct API execution', async () => {
    const fetchFn = jest.fn();
    const repo = makeRepo([knowledgeRow({ confidence: 0.91 })]);

    const result = await tryDirectApiExecute(
      inputWith({
        dataNeed: observedDataNeed,
        knowledgeRepo: repo,
        intentClass: 'action',
        fetchFn: fetchFn as unknown as DirectApiExecutorInput['fetchFn'],
      }),
    );

    expect(result.executionMode).toBe('skipped_not_read_only');
    expect(result.decisionReason).toBe('intent_not_read_only');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('observed API failure returns fallback_required with Knowledge evidence', async () => {
    const fetchFn = jsonFetch(429, { message: 'too many' });
    const repo = makeRepo([knowledgeRow({ confidence: 0.91 })]);

    const result = await tryDirectApiExecute(
      inputWith({ dataNeed: observedDataNeed, knowledgeRepo: repo, fetchFn }),
    );

    expect(result.executionMode).toBe('fallback_required');
    expect(result.readerMode).toBe('knowledge_driven');
    expect(result.fallbackCause).toBe('rate_limited');
    expect(result.fallbackEntryLayer).toBe('L0+L1');
    expect(result.endpointSource).toBe('observed');
    expect(result.rows).toBeNull();
  });

  it('does not leak raw cookie or auth fields from observed API rows', async () => {
    const fetchFn = jsonFetch(200, [
      {
        id: 'a1',
        title: 'First result',
        set_cookie: 'session=secret-session-cookie',
        authorization: 'Bearer secret-token',
      },
    ]);
    const repo = makeRepo([knowledgeRow({ confidence: 0.91 })]);

    const result = await tryDirectApiExecute(
      inputWith({ dataNeed: observedDataNeed, knowledgeRepo: repo, fetchFn }),
    );

    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain('secret-session-cookie');
    expect(serialised).not.toContain('secret-token');
  });
});

describe('cold-start guard', () => {
  it('exposes the intended transient retry reasons and default budget', () => {
    expect(COLD_START_TRANSIENT_REASONS.size).toBe(2);
    expect(COLD_START_TRANSIENT_REASONS.has('network_timeout')).toBe(true);
    expect(COLD_START_TRANSIENT_REASONS.has('network_error')).toBe(true);
    expect(COLD_START_TRANSIENT_REASONS.has('rate_limited')).toBe(false);
    expect(DIRECT_API_COLD_START_BUDGET_MS_DEFAULT).toBe(5_000);
  });
});
