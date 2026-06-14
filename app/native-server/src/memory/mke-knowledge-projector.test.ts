import {
  BrowserObjectRepository,
  KnowledgeModelRepository,
  MemoryTraceRepository,
  openMemoryDb,
} from './db';
import { MkeKnowledgeProjector } from './mke-knowledge-projector';

function upsertPageObjects(objects: BrowserObjectRepository): void {
  objects.upsert({
    siteFamily: 'example.test',
    pageUrlPattern: 'https://example.test/search',
    pageRole: 'search_results',
    pageModelKey: 'page:example.test:search_results',
    objectFingerprint: 'page:search',
    objectType: 'page',
    lifecycleState: 'running',
    selectedDataSource: 'dom_json',
    sourceRoute: 'read_page_required',
    sourceFreshness: 'fresh',
    sourceTraceIds: ['trace-read'],
    facts: { rawPayloadCopied: false },
    updatedAt: '2026-06-06T01:00:01.000Z',
  });
  objects.upsert({
    siteFamily: 'example.test',
    pageUrlPattern: 'https://example.test/search',
    pageRole: 'search_results',
    pageModelKey: 'page:example.test:search_results',
    objectFingerprint: 'region:results',
    objectType: 'region',
    lifecycleState: 'observed',
    canTabrixOperate: true,
    sourceTraceIds: ['trace-read'],
    facts: { regionType: 'results' },
    updatedAt: '2026-06-06T01:00:02.000Z',
  });
  objects.upsert({
    siteFamily: 'example.test',
    pageUrlPattern: 'https://example.test/search',
    pageRole: 'search_results',
    pageModelKey: 'page:example.test:search_results',
    objectFingerprint: 'action:result-1',
    objectType: 'action_target',
    lifecycleState: 'observed',
    canTabrixOperate: true,
    actionTypes: ['click'],
    sourceTraceIds: ['trace-click'],
    updatedAt: '2026-06-06T01:00:03.000Z',
  });
  objects.upsert({
    siteFamily: 'example.test',
    pageUrlPattern: 'https://example.test/search',
    pageRole: 'search_results',
    pageModelKey: 'page:example.test:search_results',
    objectFingerprint: 'data-source:search-api',
    objectType: 'data_source',
    lifecycleState: 'observed',
    selectedDataSource: 'api_rows',
    sourceRoute: 'knowledge_api_endpoints',
    sourceFreshness: 'fresh',
    sourceTraceIds: ['trace-api'],
    updatedAt: '2026-06-06T01:00:04.000Z',
  });
}

describe('MkeKnowledgeProjector', () => {
  it('projects page knowledge from Object Library objects without copying raw payload', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const objects = new BrowserObjectRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(objects, knowledge);

    upsertPageObjects(objects);

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T01:00:05.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 4,
      skippedTraceCount: 0,
      upsertedKnowledgeCount: 1,
      nextCursorCreatedAt: '2026-06-06T01:00:04.000Z',
    });
    const model = knowledge.get(result.knowledgeIds[0])!;
    expect(model).toMatchObject({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      observationCount: 4,
      successfulUseCount: 0,
      failedUseCount: 0,
      confidenceScore: 0,
      driftScore: null,
    });
    expect(model.sourceTraceIds).toEqual(['trace-api', 'trace-click', 'trace-read']);
    expect(model.objectGraph).toMatchObject({
      rawPayloadCopied: false,
      sourceObjectCount: 4,
      objectTypeCounts: {
        action_target: 1,
        data_source: 1,
        page: 1,
        region: 1,
      },
    });
    expect(model.actionSurface).toMatchObject({
      actionKindCounts: { click: 1 },
      reusableActionKinds: ['click'],
    });
    expect(model.dataSourceModel).toMatchObject({
      selectedDataSourceCounts: {
        api_rows: 1,
        dom_json: 1,
      },
      sourceRouteCounts: {
        knowledge_api_endpoints: 1,
        read_page_required: 1,
      },
    });
    expect(JSON.stringify(model)).not.toContain('PRIVATE_RAW_BODY_SHOULD_NOT_COPY');
  });

  it('uses Object Library updated_at cursor for incremental projection', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const objects = new BrowserObjectRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(objects, knowledge);

    upsertPageObjects(objects);

    const result = projector.projectIdleBatch({
      cursorCreatedAt: '2026-06-06T01:00:02.000Z',
      nowIso: '2026-06-06T01:00:05.000Z',
    });
    const model = knowledge.get(result.knowledgeIds[0])!;

    expect(result.processedTraceCount).toBe(2);
    expect(model.objectGraph).toMatchObject({
      sourceObjectCount: 2,
      objectTypeCounts: {
        action_target: 1,
        data_source: 1,
      },
    });
    expect(model.actionSurface).toMatchObject({ reusableActionKinds: ['click'] });
  });

  it('does not project knowledge from Memory traces when Object Library has no objects', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const objects = new BrowserObjectRepository(opened.db);
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(objects, knowledge);

    traces.append({
      traceId: 'trace-only',
      taskId: 'task-trace-only',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 7 },
      requestAt: '2026-06-06T05:00:00.000Z',
      response: { payloadDigest: { pageContent: 'trace should not feed knowledge directly' } },
      responseAt: '2026-06-06T05:00:01.000Z',
      toolSuccess: true,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T05:00:01.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T05:00:02.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 0,
      skippedTraceCount: 0,
      upsertedKnowledgeCount: 0,
      knowledgeIds: [],
    });
    expect(knowledge.count()).toBe(0);
  });

  it('projects result_card objects into page knowledge summaries', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const objects = new BrowserObjectRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const projector = new MkeKnowledgeProjector(objects, knowledge);

    objects.upsert({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageModelKey: 'page:example.test:search_results',
      objectFingerprint: 'page:search',
      objectType: 'page',
      lifecycleState: 'complete',
      selectedDataSource: 'visible_dom_result_cards',
      sourceRoute: 'visible_dom_cards_bounded_scroll',
      sourceFreshness: 'fresh',
      sourceTraceIds: ['trace-cards'],
      facts: { rawPayloadCopied: false, observedResultCount: 2 },
      updatedAt: '2026-06-06T06:00:01.000Z',
    });
    objects.upsert({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageModelKey: 'page:example.test:search_results',
      objectFingerprint: 'result-card:1',
      objectType: 'result_card',
      lifecycleState: 'observed',
      canTabrixOperate: true,
      actionTypes: ['click_result_card', 'open_via_url'],
      selectedDataSource: 'visible_dom_result_cards',
      sourceRoute: 'visible_dom_cards_bounded_scroll',
      sourceFreshness: 'fresh',
      sourceTraceIds: ['trace-cards'],
      facts: {
        rank: 1,
        title: 'First result',
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
        },
        sessionOnlyTarget: {
          selector: 'main > section:nth-of-type(1) > a:nth-of-type(2)',
          center: { x: 100, y: 56 },
        },
      },
      confidenceScore: 0.86,
      updatedAt: '2026-06-06T06:00:02.000Z',
    });
    objects.upsert({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageModelKey: 'page:example.test:search_results',
      objectFingerprint: 'result-card:2',
      objectType: 'result_card',
      lifecycleState: 'observed',
      canTabrixOperate: true,
      actionTypes: ['click_result_card', 'open_via_url'],
      selectedDataSource: 'visible_dom_result_cards',
      sourceRoute: 'visible_dom_cards_bounded_scroll',
      sourceFreshness: 'fresh',
      sourceTraceIds: ['trace-cards'],
      facts: {
        rank: 2,
        title: 'Second result',
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
        },
        sessionOnlyTarget: {
          selector: 'main > section:nth-of-type(2) > a:nth-of-type(2)',
          center: { x: 100, y: 56 },
        },
      },
      confidenceScore: 0.82,
      updatedAt: '2026-06-06T06:00:03.000Z',
    });
    objects.upsert({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageModelKey: 'page:example.test:search_results',
      objectFingerprint: 'action-target:session-ref',
      objectType: 'action_target',
      lifecycleState: 'observed',
      canTabrixOperate: true,
      actionTypes: ['click'],
      selectedDataSource: 'markdown',
      sourceRoute: 'read_page_candidate_actions',
      sourceFreshness: 'fresh',
      sourceTraceIds: ['trace-full-read'],
      facts: {
        matchReason: 'primary action inferred from visible text',
      },
      targetability: {
        targetRef: 'ref_text_filter_panel_151',
      },
      updatedAt: '2026-06-06T06:00:03.500Z',
    });
    objects.upsert({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageModelKey: 'page:example.test:search_results',
      objectFingerprint: 'action-target:search-input',
      objectType: 'action_target',
      lifecycleState: 'observed',
      canTabrixOperate: true,
      actionTypes: ['fill'],
      selectedDataSource: 'dom_json',
      sourceRoute: 'read_page_candidate_actions',
      sourceFreshness: 'fresh',
      sourceTraceIds: ['trace-full-read'],
      facts: {
        matchReason: 'search input candidate action',
      },
      targetability: {
        targetRef: 'ref_3',
      },
      updatedAt: '2026-06-06T06:00:03.750Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T06:00:04.000Z' });
    const model = knowledge.get(result.knowledgeIds[0])!;

    expect(result).toMatchObject({
      processedTraceCount: 5,
      skippedTraceCount: 0,
      upsertedKnowledgeCount: 1,
    });
    expect(model.objectGraph).toMatchObject({
      sourceObjectCount: 5,
      resultCardCount: 2,
      resultCardSummary: {
        count: 2,
        clickableCount: 2,
        rankRange: { min: 1, max: 2 },
        rawCardTextCopied: false,
      },
      objectTypeCounts: {
        action_target: 2,
        page: 1,
        result_card: 2,
      },
    });
    expect(model.actionSurface).toMatchObject({
      actionKindCounts: { click: 1, click_result_card: 2, fill: 1, open_via_url: 2 },
      reusableActionKinds: ['open_via_url'],
      sessionScopedActionKinds: { click: 1, click_result_card: 2, fill: 1 },
      resultCardActionKinds: { click_result_card: 2, open_via_url: 2 },
      resultCardReusePolicy: {
        freshResultCardUrlRequired: true,
        freshResultCardUrlRequiredCount: 2,
        nonReusableTargetKinds: ['selector', 'rect', 'center', 'snapshot_ref'],
      },
    });
    expect(model.dataSourceModel).toMatchObject({
      selectedDataSourceCounts: {
        dom_json: 1,
        markdown: 1,
        visible_dom_result_cards: 3,
      },
    });
    expect(model.confidenceScore).toBe(0.84);
    expect(JSON.stringify(model)).not.toContain('First result');
  });
});
