import { openMemoryDb, KnowledgeModelRepository, MemoryTraceRepository } from './db';
import { MkeKnowledgeProjector } from './mke-knowledge-projector';

describe('MkeKnowledgeProjector', () => {
  it('projects page knowledge from memory traces without copying raw payload', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(traces, knowledge);

    traces.append({
      traceId: 'trace-read',
      taskId: 'task-1',
      toolName: 'chrome_read_page',
      sequenceIndex: 1,
      requestParams: { tabId: 7 },
      requestAt: '2026-06-06T01:00:00.000Z',
      response: { payloadDigest: { pageContent: 'PRIVATE_RAW_BODY_SHOULD_NOT_COPY' } },
      responseAt: '2026-06-06T01:00:01.000Z',
      durationMs: 1000,
      toolSuccess: true,
      businessSuccess: 'unknown',
      tabId: 7,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      selectedDataSource: 'dom_json',
      sourceRoute: 'read_page_required',
      freshness: 'fresh',
      createdAt: '2026-06-06T01:00:01.000Z',
    });
    traces.append({
      traceId: 'trace-click',
      taskId: 'task-1',
      toolName: 'chrome_click_element',
      sequenceIndex: 2,
      requestParams: { tabId: 7, ref: 'result-1' },
      requestAt: '2026-06-06T01:00:02.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T01:00:03.000Z',
      durationMs: 1000,
      toolSuccess: true,
      businessSuccess: 'true',
      tabId: 7,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T01:00:03.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T01:00:04.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 2,
      skippedTraceCount: 0,
      upsertedKnowledgeCount: 1,
      nextCursorCreatedAt: '2026-06-06T01:00:03.000Z',
    });
    const model = knowledge.get(result.knowledgeIds[0])!;
    expect(model).toMatchObject({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      observationCount: 2,
      successfulUseCount: 1,
      failedUseCount: 0,
      driftScore: 0,
    });
    expect(model.sourceTraceIds).toEqual(['trace-read', 'trace-click']);
    expect(model.objectGraph).toMatchObject({ rawPayloadCopied: false });
    expect(model.actionSurface).toMatchObject({ reusableActionKinds: ['chrome_click_element'] });
    expect(JSON.stringify(model)).not.toContain('PRIVATE_RAW_BODY_SHOULD_NOT_COPY');
  });

  it('updates drift score from mixed page states and supports an incremental cursor', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(traces, knowledge);

    traces.append({
      traceId: 'trace-before-cursor',
      taskId: 'task-1',
      toolName: 'chrome_read_page',
      requestParams: {},
      requestAt: '2026-06-06T02:00:00.000Z',
      response: {},
      responseAt: '2026-06-06T02:00:01.000Z',
      toolSuccess: true,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/detail',
      pageRole: 'detail',
      pageState: 'ready',
      createdAt: '2026-06-06T02:00:01.000Z',
    });
    traces.append({
      traceId: 'trace-ready',
      taskId: 'task-2',
      toolName: 'chrome_read_page',
      requestParams: {},
      requestAt: '2026-06-06T02:00:02.000Z',
      response: {},
      responseAt: '2026-06-06T02:00:03.000Z',
      toolSuccess: true,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/detail',
      pageRole: 'detail',
      pageState: 'ready',
      createdAt: '2026-06-06T02:00:03.000Z',
    });
    traces.append({
      traceId: 'trace-loading',
      taskId: 'task-2',
      toolName: 'chrome_read_page',
      requestParams: {},
      requestAt: '2026-06-06T02:00:04.000Z',
      response: {},
      responseAt: '2026-06-06T02:00:05.000Z',
      toolSuccess: false,
      errorCode: 'page_not_ready',
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/detail',
      pageRole: 'detail',
      pageState: 'loading',
      createdAt: '2026-06-06T02:00:05.000Z',
    });

    const result = projector.projectIdleBatch({
      cursorCreatedAt: '2026-06-06T02:00:01.000Z',
      nowIso: '2026-06-06T02:00:06.000Z',
    });
    const model = knowledge.get(result.knowledgeIds[0])!;

    expect(result.processedTraceCount).toBe(2);
    expect(model.sourceTraceIds).toEqual(['trace-ready', 'trace-loading']);
    expect(model.driftScore).toBeGreaterThan(0);
    expect(model.failureSignal).toMatchObject({
      failedTraceCount: 1,
      errorCounts: { page_not_ready: 1 },
    });
  });

  it('does not count tool success as successful knowledge use without business proof', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(traces, knowledge);

    traces.append({
      traceId: 'trace-unknown-business',
      taskId: 'task-unknown-business',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 7, ref: 'filter' },
      requestAt: '2026-06-06T05:00:00.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T05:00:01.000Z',
      toolSuccess: true,
      businessSuccess: 'unknown',
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T05:00:01.000Z',
    });
    traces.append({
      traceId: 'trace-business-failed',
      taskId: 'task-business-failed',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 7, ref: 'filter' },
      requestAt: '2026-06-06T05:00:02.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T05:00:03.000Z',
      toolSuccess: true,
      businessSuccess: 'not_achieved',
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T05:00:03.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T05:00:04.000Z' });
    const model = knowledge.get(result.knowledgeIds[0])!;

    expect(model).toMatchObject({
      observationCount: 2,
      successfulUseCount: 0,
      failedUseCount: 1,
    });
  });
});
