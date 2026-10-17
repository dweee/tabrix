/**
 * V26-FIX-04 — `buildSafeRequest` unit tests.
 *
 * Pins the builder safety boundary:
 *   - generic: produces an `https://<host><path>?<primary>=<value>`
 *     URL only when (a) the row has an observed primary query key
 *     and (b) the caller supplied a value for it.
 *   - GET-only; refuses identity placeholders; refuses to invent
 *     query keys.
 */

import { buildSafeRequest } from './safe-request-builder';
import type { EndpointMatch, DataNeed } from './types';
import type {
  KnowledgeApiEndpoint,
  EndpointSemanticType,
} from '../memory/knowledge/knowledge-api-repository';

type ScoredFixtureRow = KnowledgeApiEndpoint & {
  semanticType: EndpointSemanticType;
  confidence: number;
  usableForTask: boolean;
  fallbackReason: string | null;
};

function row(overrides: Partial<ScoredFixtureRow>): ScoredFixtureRow {
  return {
    endpointId: 'e-1',
    site: 'api.example.com',
    family: 'observed',
    method: 'GET',
    urlPattern: 'api.example.com/items',
    endpointSignature: 'GET api.example.com/items',
    semanticTag: null,
    statusClass: '2xx',
    requestSummary: {
      headerKeys: [],
      queryKeys: [],
      bodyKeys: [],
      hasAuth: false,
      hasCookie: false,
    },
    responseSummary: {
      contentType: 'application/json',
      sizeBytes: 1024,
      shape: { kind: 'array', itemCount: 5, sampleItemKeys: ['id', 'name'] },
    },
    sourceSessionId: null,
    sourceStepId: null,
    sourceHistoryRef: null,
    sampleCount: 1,
    firstSeenAt: '2026-01-01T00:00:00Z',
    lastSeenAt: '2026-01-01T00:00:00Z',
    semanticTypePersisted: 'list',
    queryParamsShape: null,
    responseShapeSummary: null,
    usableForTaskPersisted: true,
    noiseReason: null,
    endpointSource: 'observed',
    correlationConfidence: null,
    correlatedRegionId: null,
    confidenceReason: null,
    retirementCandidate: false,
    sourceLineage: null,
    schemaVersion: 2,
    semanticType: 'list',
    confidence: 0.8,
    usableForTask: true,
    fallbackReason: null,
    ...overrides,
  };
}

function match(overrides: Partial<ScoredFixtureRow>): EndpointMatch {
  const endpoint = row(overrides);
  return {
    endpoint,
    semanticValidation: 'pass',
    score: 0.8,
    endpointSource: endpoint.endpointSource,
    correlationConfidence: endpoint.correlationConfidence,
    retiredPeer: null,
    chosenReason: 'best_available',
  };
}

const baseDataNeed: DataNeed = {
  intent: 'find tabrix repos',
  intentClass: 'read_only',
  semanticTypeWanted: 'search',
  urlHint: 'https://content.example/search?q=tabrix',
  pageRole: null,
};

describe('V26-FIX-04 buildSafeRequest — generic branch', () => {
  it('builds a generic URL using the observed primary query key', () => {
    const m = match({
      site: 'hn.algolia.com',
      urlPattern: 'hn.algolia.com/api/v1/search',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['hitsPerPage', 'page', 'query'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search hn',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://news.ycombinator.com/',
      pageRole: null,
      params: { query: 'tabrix' },
    });
    expect(plan).not.toBeNull();
    expect(plan!.builderHint).toBe('generic');
    expect(plan!.dataPurpose).toBe('observed_search');
    expect(plan!.url).toBe('https://hn.algolia.com/api/v1/search?query=tabrix&hitsPerPage=10');
    expect(plan!.requestShapeUsed).toEqual(['hitsPerPage', 'query']);
  });

  it('emits a limit key when the row observed one', () => {
    const m = match({
      site: 'hn.algolia.com',
      urlPattern: 'hn.algolia.com/api/v1/search',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['hitsPerPage', 'q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search hn',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://hn.algolia.com/',
      pageRole: null,
      params: { query: 'tabrix', limit: 7 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toContain('q=tabrix');
    expect(plan!.url).toContain('hitsPerPage=7');
    expect(plan!.requestShapeUsed).toEqual(['hitsPerPage', 'q']);
  });

  it('handles wikipedia REST search as a non-platform fixture', () => {
    const m = match({
      site: 'en.wikipedia.org',
      urlPattern: 'en.wikipedia.org/w/rest.php/v1/search/page',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['limit', 'q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'search wikipedia',
      intentClass: 'read_only',
      semanticTypeWanted: 'search',
      urlHint: 'https://en.wikipedia.org/',
      pageRole: null,
      params: { query: 'einstein', limit: 3 },
    });
    expect(plan).not.toBeNull();
    expect(plan!.url).toBe('https://en.wikipedia.org/w/rest.php/v1/search/page?q=einstein&limit=3');
  });

  it('refuses to ship a URL with literal :placeholder segments', () => {
    const m = match({
      urlPattern: 'api.unknown.com/users/:user/items',
      family: 'observed',
      semanticType: 'list',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: { query: 'foo' } });
    expect(plan).toBeNull();
  });

  it('refuses when caller asks for search but supplies no value', () => {
    const m = match({
      urlPattern: 'api.example.com/items',
      family: 'observed',
      semanticType: 'search',
      requestSummary: {
        headerKeys: [],
        queryKeys: ['q'],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: {} });
    expect(plan).toBeNull();
  });

  it('refuses POST/non-GET methods', () => {
    const m = match({
      site: 'api.example.com',
      urlPattern: 'api.example.com/search',
      method: 'POST',
      family: 'observed',
      semanticType: 'search',
    });
    const plan = buildSafeRequest(m, { ...baseDataNeed, params: { query: 'tabrix' } });
    expect(plan).toBeNull();
  });

  it('refuses generic build when no observed query keys exist and a value is supplied', () => {
    const m = match({
      urlPattern: 'api.example.com/items',
      family: 'observed',
      semanticType: 'list',
      requestSummary: {
        headerKeys: [],
        queryKeys: [],
        bodyKeys: [],
        hasAuth: false,
        hasCookie: false,
      },
    });
    const plan = buildSafeRequest(m, {
      intent: 'list items',
      intentClass: 'read_only',
      semanticTypeWanted: null,
      urlHint: 'https://api.example.com/',
      pageRole: null,
      params: { query: 'foo' },
    });
    expect(plan).toBeNull();
  });
});
