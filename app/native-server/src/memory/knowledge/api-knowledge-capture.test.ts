/**
 * API Knowledge capture regression tests.
 *
 * These tests intentionally use neutral hosts. Tabrix must learn API
 * knowledge from real browser observations, not from bundled site adapters.
 */

import {
  analyzeKnowledgeCaptureBundle,
  classifyCapturedRequestNoise,
  deriveKnowledgeFromBundle,
  deriveKnowledgeFromRequest,
  KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT,
  type CapturedNetworkRequest,
} from './api-knowledge-capture';

const CTX = {
  sessionId: 'session-aa',
  stepId: 'step-bb',
  observedAt: '2026-04-22T08:30:00.000Z',
};

const COMMON_REQ = { 'User-Agent': 'tabrix-test/1.0', Accept: 'application/json' };
const COMMON_RES = { 'Content-Type': 'application/json; charset=utf-8' };

function classified(req: CapturedNetworkRequest) {
  return deriveKnowledgeFromRequest(req, COMMON_REQ, COMMON_RES, CTX);
}

describe('generic observed API knowledge capture', () => {
  it('derives a stable observed endpoint from any usable JSON GET', () => {
    const result = classified({
      url: 'https://api.content.example/v1/search/items?keyword=desk&page=1',
      method: 'GET',
      type: 'xmlhttprequest',
      statusCode: 200,
      mimeType: 'application/json',
      responseBody: JSON.stringify({ items: [{ title: 'desk result', score: 7 }] }),
    });

    expect(result).toMatchObject({
      site: 'api.content.example',
      family: 'observed',
      method: 'GET',
      urlPattern: 'api.content.example/v1/search/items',
      endpointSignature: 'GET api.content.example/v1/search/items',
      semanticTag: null,
      statusClass: '2xx',
      semanticType: 'search',
      queryParamsShape: 'keyword,page',
      usableForTask: true,
      noiseReason: null,
      endpointSource: 'observed',
      correlationConfidence: null,
      correlatedRegionId: null,
      sourceLineage: {
        semanticSource: 'capture',
        observationCount: 1,
        correlationReason: 'metadata_only',
      },
    });
    expect(JSON.stringify(result)).not.toContain('desk');
  });

  it('normalizes identity-like path segments without platform adapters', () => {
    const a = classified({
      url: 'https://api.content.example/users/alice/items',
      method: 'GET',
      type: 'fetch',
      statusCode: 200,
      mimeType: 'application/json',
    });
    const b = classified({
      url: 'https://api.content.example/users/bob/items',
      method: 'GET',
      type: 'fetch',
      statusCode: 200,
      mimeType: 'application/json',
    });
    const c = classified({
      url: 'https://api.content.example/repos/team-a/project-a/issues/42',
      method: 'GET',
      type: 'fetch',
      statusCode: 200,
      mimeType: 'application/json',
    });

    expect(a!.urlPattern).toBe('api.content.example/users/:user/items');
    expect(b!.endpointSignature).toBe(a!.endpointSignature);
    expect(c!.urlPattern).toBe('api.content.example/repos/:owner/:repo/issues/:id');
  });

  it('persists shape-evidenced read-shaped POST endpoints as observed search rows', () => {
    const out = deriveKnowledgeFromBundle(
      {
        requests: [
          {
            url: 'https://search-provider.example/1/indexes/Item_dev/query',
            method: 'POST',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
            responseBody: JSON.stringify({
              hits: [{ title: 'browser automation tools', points: 42, comments: 7 }],
            }),
          },
        ],
      },
      CTX,
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      family: 'observed',
      site: 'search-provider.example',
      method: 'POST',
      semanticType: 'search',
      usableForTask: true,
      noiseReason: null,
      endpointSource: 'observed',
      responseShapeSummary: 'object:keys=1',
    });
    expect(out[0].urlPattern).toBe('search-provider.example/:id/indexes/Item_dev/query');
    expect(JSON.stringify(out)).not.toContain('browser automation');
  });

  it('keeps bundle ordering and caps per-batch writes', () => {
    const requests: CapturedNetworkRequest[] = [];
    for (let i = 0; i < KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT + 25; i += 1) {
      requests.push({
        url: `https://api.content.example/v1/items/${i}`,
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
        statusCode: 200,
      });
    }

    const out = deriveKnowledgeFromBundle({ requests }, CTX);
    expect(out).toHaveLength(KNOWLEDGE_CAPTURE_PER_BATCH_LIMIT);
    expect(out[0].urlPattern).toBe('api.content.example/v1/items/:id');
  });

  it('drops invalid, extension, private, asset, telemetry, and auth noise', () => {
    const out = deriveKnowledgeFromBundle(
      {
        requests: [
          {
            url: 'https://invalid/api/search/items?q=private',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
          {
            url: 'chrome-extension://extension-id/internal.json',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
          {
            url: 'https://api.content.example/_private/browser/stats?token=',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
          {
            url: 'https://static.content.example/logo.png',
            method: 'GET',
            type: 'image',
            mimeType: 'image/png',
            statusCode: 200,
          },
          {
            url: 'https://api.content.example/oauth/token',
            method: 'POST',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
          {
            url: 'https://api.content.example/v1/search/items?q=tabrix',
            method: 'GET',
            type: 'xmlhttprequest',
            mimeType: 'application/json',
            statusCode: 200,
          },
        ],
      },
      CTX,
    );

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      site: 'api.content.example',
      family: 'observed',
      endpointSource: 'observed',
      semanticType: 'search',
      usableForTask: true,
    });
    expect(JSON.stringify(out)).not.toContain('invalid');
    expect(JSON.stringify(out)).not.toContain('extension-id');
  });
});

describe('API knowledge privacy redaction', () => {
  it('never stores sensitive header values or header names', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.content.example/v1/items',
        method: 'GET',
        type: 'fetch',
        statusCode: 200,
        mimeType: 'application/json',
        specificRequestHeaders: {
          Authorization: 'Bearer super-secret-token',
          Cookie: 'session=abc123',
          'X-Api-Key': 'sk-secret',
          Accept: 'application/json',
        },
        specificResponseHeaders: {
          'Set-Cookie': 'session=newvalue; HttpOnly',
        },
      },
      COMMON_REQ,
      COMMON_RES,
      CTX,
    );

    expect(result).not.toBeNull();
    expect(result!.requestSummary.hasAuth).toBe(true);
    expect(result!.requestSummary.hasCookie).toBe(true);
    expect(result!.requestSummary.headerKeys).toEqual(['accept', 'user-agent']);
    expect(JSON.stringify(result)).not.toMatch(
      /Bearer|super-secret-token|abc123|sk-secret|newvalue|authorization|x-api-key/i,
    );
  });

  it('stores only safe query and body shape keys', () => {
    const result = deriveKnowledgeFromRequest(
      {
        url: 'https://api.content.example/v1/search/items?q=automation&page=1&access_token=secret',
        method: 'POST',
        type: 'fetch',
        statusCode: 200,
        mimeType: 'application/json',
        requestBody: JSON.stringify({
          keyword: 'private keyword',
          page: 1,
          sort: 'popular',
          xsec_token: 'secret-token',
        }),
        responseBody: JSON.stringify({
          items: [{ title: 'secret result', id: 1 }],
          cursor: 'next-secret',
        }),
      },
      {},
      COMMON_RES,
      CTX,
    );

    expect(result).not.toBeNull();
    expect(result!.requestSummary.queryKeys).toEqual(['page', 'q']);
    expect(result!.requestSummary.bodyKeys).toEqual(['keyword', 'page', 'sort']);
    expect(result!.queryParamsShape).toBe('page,q');
    expect(result!.responseSummary.shape).toEqual({
      kind: 'object',
      topLevelKeys: ['cursor', 'items'],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /private keyword|secret result|next-secret|access_token|xsec_token|secret-token/i,
    );
  });

  it('reduces arrays, objects, scalar and non-json bodies to shape only', () => {
    const arrayResult = deriveKnowledgeFromRequest(
      {
        url: 'https://api.content.example/v1/items',
        method: 'GET',
        type: 'fetch',
        statusCode: 200,
        mimeType: 'application/json',
        responseBody: JSON.stringify([
          { id: 1, title: 'first', author: 'alice' },
          { id: 2, title: 'second' },
        ]),
      },
      {},
      COMMON_RES,
      CTX,
    );
    const binaryResult = deriveKnowledgeFromRequest(
      {
        url: 'https://api.content.example/v1/items/export',
        method: 'GET',
        type: 'fetch',
        statusCode: 200,
        mimeType: 'application/octet-stream',
        responseBody: 'AAAABBBB==',
        base64Encoded: true,
      },
      {},
      {},
      CTX,
    );

    expect(arrayResult!.responseSummary.shape).toEqual({
      kind: 'array',
      itemCount: 2,
      sampleItemKeys: ['author', 'id', 'title'],
    });
    expect(binaryResult!.responseSummary.shape).toEqual({ kind: 'unknown' });
    expect(JSON.stringify(arrayResult!.responseSummary)).not.toMatch(/first|alice/);
  });
});

describe('API knowledge diagnostics', () => {
  it('returns compact diagnostics without raw query values', () => {
    const analysis = analyzeKnowledgeCaptureBundle(
      {
        requests: [
          {
            url: 'https://api.content.example/v1/search/items?q=&sort=&order=',
            method: 'GET',
            type: 'xmlhttprequest',
            statusCode: 200,
            mimeType: 'application/json',
          },
          {
            url: 'https://api.content.example/_private/browser/stats?token=',
            method: 'GET',
            statusCode: 200,
            mimeType: 'application/json',
          },
          {
            url: 'https://static.content.example/logo.png',
            method: 'GET',
            type: 'image',
            statusCode: 200,
            mimeType: 'image/png',
          },
        ],
      },
      CTX,
    );

    expect(analysis.upserts).toHaveLength(1);
    expect(analysis.upserts[0]).toMatchObject({
      site: 'api.content.example',
      family: 'observed',
      semanticTag: null,
      endpointSource: 'observed',
    });
    expect(analysis.diagnostics).toMatchObject({
      totalRequests: 3,
      usableCandidateCount: 1,
      upsertCandidateCount: 1,
      reason: 'usable_endpoint_found',
    });
    expect(analysis.diagnostics.filteredCounts).toMatchObject({
      usable: 1,
      private: 1,
      asset: 1,
    });
    expect(JSON.stringify(analysis)).not.toMatch(/secret|token=/);
  });

  it('classifies request noise generically', () => {
    expect(
      classifyCapturedRequestNoise({
        url: 'https://api.content.example/v1/search/items?q=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('usable');
    expect(
      classifyCapturedRequestNoise({
        url: 'https://api.content.example/private/browser/stats?token=',
        method: 'GET',
        type: 'xmlhttprequest',
        mimeType: 'application/json',
      }),
    ).toBe('private');
  });
});
