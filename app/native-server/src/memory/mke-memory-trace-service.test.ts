import { jest } from '@jest/globals';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  openMemoryDb,
  type BrowserObjectInput,
} from './db';
import { MkeAiFeedbackValidationError, MkeMemoryTraceService } from './mke-memory-trace-service';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';

const NOW_MS = Date.parse('2026-06-10T10:00:00.000Z');

function textResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

describe('MkeMemoryTraceService', () => {
  it('returns the trace before queued Browser Object writes run, then flushes them', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const originalUpsert = browserObjectRepo.upsert.bind(browserObjectRepo);
    let recordReturned = false;
    let upsertRanBeforeRecordReturned = false;
    const upsertSpy = jest
      .spyOn(browserObjectRepo, 'upsert')
      .mockImplementation((input: BrowserObjectInput) => {
        if (!recordReturned) upsertRanBeforeRecordReturned = true;
        return originalUpsert(input);
      });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-async-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-async-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/workspaces/123?tab=overview' },
          summary: { pageRole: 'workspace', quality: 'fresh' },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 7,
          pageRegions: [{ regionId: 'main', regionType: 'content', confidence: 0.9 }],
        }),
        resultSummary: 'fresh page read',
      });
      recordReturned = true;

      expect(trace.traceId).toBeDefined();
      expect(trace.aiFeedbackScore).toBeNull();
      expect(trace.aiFeedback).toBeNull();
      expect(traceRepo.count()).toBe(1);
      expect(browserObjectRepo.count()).toBe(0);
      expect(upsertSpy).not.toHaveBeenCalled();

      await traceService.flushAsyncWrites();

      expect(upsertRanBeforeRecordReturned).toBe(false);
      expect(upsertSpy).toHaveBeenCalled();
      expect(browserObjectRepo.count()).toBe(2);
    } finally {
      upsertSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('does not synthesize AI feedback from tool execution facts', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-auto-feedback-task',
        taskIntent: 'click and verify page result',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-auto-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, ref: 'ref_button' },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          actionEvidenceResult: {
            business: {
              businessSuccessVerdict: 'proven',
              businessSuccessProven: true,
            },
          },
        }),
        resultSummary: 'verified result appeared',
      });

      expect(trace.businessSuccess).toBe('achieved');
      expect(trace.aiFeedbackScore).toBeNull();
      expect(trace.aiFeedback).toBeNull();
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records bound AI feedback and appends an audit event', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        taskIntent: 'click and verify page result',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, ref: 'ref_button' },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          actionEvidenceResult: {
            business: {
              businessSuccessVerdict: 'proven',
              businessSuccessProven: true,
            },
          },
        }),
        resultSummary: 'verified result appeared',
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified the expected page result appeared.',
        receivedAt: '2026-06-10T10:00:01.000Z',
      });

      expect(updated).toMatchObject({
        traceId: trace.traceId,
        businessSuccess: 'achieved',
        aiFeedbackScore: 0.94,
        aiFeedback: expect.objectContaining({
          sourceKind: 'ai_feedback',
          businessStatus: 'achieved',
          confidence: 0.94,
          binding: expect.objectContaining({
            traceId: trace.traceId,
            traceBindingHash: buildMemoryTraceBindingHash(trace),
          }),
        }),
      });
      expect(traceRepo.get(trace.traceId)?.businessSuccess).toBe('achieved');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        traceId: trace.traceId,
        businessStatus: 'achieved',
        experienceCandidate: true,
        accepted: true,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).not.toHaveProperty(
        'evidenceRefs',
      );
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('treats repeated identical AI feedback as idempotent', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-retry-task',
        taskIntent: 'retry ai feedback safely',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-ai-feedback-retry-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, minResults: 10 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
        }),
      });
      const feedbackInput = {
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards',
        summary: 'AI verified the requested top 10 result cards.',
        receivedAt: '2026-06-10T10:00:01.000Z',
      } as const;

      const first = traceService.recordAiBusinessFeedback(feedbackInput);
      const second = traceService.recordAiBusinessFeedback(feedbackInput);

      expect(first?.businessSuccess).toBe('achieved');
      expect(second?.businessSuccess).toBe('achieved');
      expect(second?.aiFeedbackScore).toBe(0.93);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps the new feedback token stable after business status changes and accepts legacy tokens', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-token-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-token-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });
      const stableHashBefore = buildMemoryTraceBindingHash(trace);
      const legacyHashBefore = buildLegacyMemoryTraceBindingHash(trace);

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: legacyHashBefore,
        businessStatus: 'achieved',
        confidence: 0.91,
        summary: 'AI verified the result using a legacy feedback token.',
      });

      expect(updated?.businessSuccess).toBe('achieved');
      expect(buildMemoryTraceBindingHash(updated!)).toBe(stableHashBefore);
      expect(buildLegacyMemoryTraceBindingHash(updated!)).not.toBe(legacyHashBefore);

      const repeated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: legacyHashBefore,
        businessStatus: 'achieved',
        confidence: 0.91,
        summary: 'AI verified the result using a legacy feedback token.',
      });
      expect(repeated?.businessSuccess).toBe('achieved');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('rejects AI feedback when the binding hash does not match the trace', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-binding-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-binding-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      expect(() =>
        traceService.recordAiBusinessFeedback({
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash: 'wrong-binding-hash',
          businessStatus: 'partial',
          confidence: 0.5,
        }),
      ).toThrow(MkeAiFeedbackValidationError);
      expect(traceRepo.get(trace.traceId)?.aiFeedback).toBeNull();
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toEqual([]);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records high-confidence achieved AI feedback without product evidence refs', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.95,
        summary: 'AI verified the result.',
      });
      expect(updated?.aiFeedback).toMatchObject({
        businessStatus: 'achieved',
        confidence: 0.95,
      });
      expect(updated?.aiFeedback).not.toHaveProperty('evidenceRefs');
      expect(updated?.aiFeedback).not.toHaveProperty('evaluatorModel');
      expect(updated?.aiFeedback).not.toHaveProperty('userGoalSnapshot');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        businessStatus: 'achieved',
        experienceCandidate: true,
        accepted: true,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).not.toHaveProperty(
        'evidenceRefs',
      );
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('accepts experience-ready AI feedback without evaluator metadata', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.95,
        summary: 'AI verified the result.',
      });
      expect(updated?.aiFeedback).toMatchObject({
        businessStatus: 'achieved',
        confidence: 0.95,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        businessStatus: 'achieved',
        experienceCandidate: true,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects API-backed read_page results as data_source Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'trace-api-source-task',
        taskIntent: 'read list through observed API',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-api-source-step',
        sequenceIndex: 1,
        requestParams: { tabId: 9 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          kind: 'api_rows',
          page: { url: 'https://example.test/items?q=alpha' },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          sourceRoute: 'knowledge_api_endpoints',
          selectedDataSource: 'api_rows',
          endpointFamily: 'example_items_search',
          freshness: 'fresh',
          apiCdpProofBoundary: 'diagnostic boundary should not be persisted',
          tabId: 9,
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:example.test:search_results',
            chosenDataSource: 'api_rows',
            sourceConfidence: 0.92,
            sourceTruthChain: {
              primaryOrigin: 'api',
            },
          },
        }),
        resultSummary: 'fresh API-backed page read',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.objectType).sort()).toEqual(['data_source', 'page']);
      for (const object of objects) {
        expect(object.claimBoundary).toBeNull();
        expect(object.confidenceScore).toBeNull();
        expect(JSON.stringify(object.facts)).not.toContain('evidenceSummary');
      }
      expect(objects.find((object) => object.objectType === 'data_source')).toMatchObject({
        selectedDataSource: 'api_rows',
        sourceRoute: 'knowledge_api_endpoints',
        lifecycleState: 'observed',
        canTabrixOperate: true,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects collected result cards as page and result_card Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-result-cards-task',
        taskIntent: 'collect top search result cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-result-cards-step',
        sequenceIndex: 1,
        requestParams: { tabId: 19, minResults: 2 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 120,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'Search results',
            url: 'https://example.test/search?q=ai',
          },
          pageRole: 'search_results',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 19,
          requestedMinResults: 2,
          observedResultCount: 2,
          complete: true,
          status: 'complete_enough',
          filterState: {
            status: 'observed',
            appliedLabels: ['图文', '最多收藏', '一周内'],
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedFilters: [
              { label: '图文', kind: 'content_type', source: 'url_parameter_adapter' },
              { label: '最多收藏', kind: 'sort', source: 'dom_active_state' },
              { label: '一周内', kind: 'time_range', source: 'dom_active_state' },
            ],
          },
          cards: [
            {
              rank: 1,
              title: 'First result',
              url: 'https://example.test/note/1?x=private',
              actionTarget: {
                actionType: 'click',
                targetKind: 'result_card_link',
                url: 'https://example.test/note/1?x=private',
                selector: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)',
                text: 'First result',
                openAction: {
                  toolName: 'chrome_navigate',
                  toolArgs: { url: 'https://example.test/note/1?x=private' },
                  executionScope: 'session_url',
                  reason: 'result_card_href',
                  confidence: 0.88,
                },
                toolName: 'chrome_click_element',
                toolArgs: {
                  candidateAction: {
                    id: 'ca_click_ref_result_card_1',
                    actionType: 'click',
                    targetRef: 'ref_result_card_1',
                    label: 'First result',
                    confidence: 0.9,
                    matchReason: 'result_card_primary_link',
                    intent: 'content.open_detail',
                    locatorChain: [
                      { type: 'ref', value: 'ref_result_card_1' },
                      { type: 'aria', value: 'First result' },
                      {
                        type: 'css',
                        value: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)',
                      },
                    ],
                  },
                },
                rect: { x: 20, y: 40, width: 160, height: 32 },
                center: { x: 100, y: 56 },
                coordinateFrame: 'viewport',
                sourceScrollY: 0,
                confidence: 0.9,
                reasons: ['title_link_match'],
              },
              primaryText: 'Author A',
              metaText: '1 day ago',
              interactionText: '123',
              imageCount: 1,
              sourceScrollY: 0,
              rect: { x: 10, y: 20, width: 200, height: 160 },
              confidence: 0.86,
              reasons: ['link_present', 'media_present'],
              sourceStrategy: 'list_container',
            },
            {
              rank: 2,
              title: 'Second result',
              url: 'https://example.test/note/2',
              actionTarget: {
                actionType: 'click',
                targetKind: 'result_card_link',
                url: 'https://example.test/note/2?x=private',
                executionScope: 'session_url',
                openAction: {
                  toolName: 'chrome_navigate',
                  toolArgs: { url: 'https://example.test/note/2?x=private' },
                  executionScope: 'session_url',
                  reason: 'result_card_href',
                  confidence: 0.74,
                },
                rect: { x: 20, y: -40, width: 160, height: 32 },
                center: { x: 100, y: 14 },
                coordinateFrame: 'viewport',
                sourceScrollY: 0,
                confidence: 0.74,
                reasons: ['visible_detail_link_unverified_hit'],
              },
              imageCount: 0,
              sourceScrollY: 480,
              rect: { x: 10, y: 220, width: 200, height: 140 },
              confidence: 0.72,
              reasons: ['link_present'],
              sourceStrategy: 'list_container',
            },
          ],
          claimBoundary: 'bounded visible DOM collection',
        }),
        resultSummary: 'collected result cards',
      });

      expect(trace).toMatchObject({
        toolName: 'chrome_collect_result_cards',
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'complete',
        pageModelKey: 'page:example.test:search_results',
        selectedDataSource: 'visible_dom_result_cards',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.objectType).sort()).toEqual([
        'page',
        'result_card',
        'result_card',
      ]);
      const page = objects.find((object) => object.objectType === 'page');
      expect(page).toMatchObject({
        pageRole: 'search_results',
        pageModelKey: 'page:example.test:search_results',
        selectedDataSource: 'visible_dom_result_cards',
        sourceRoute: 'visible_dom_cards_bounded_scroll',
        lifecycleState: 'complete',
        canTabrixOperate: true,
      });
      expect(page?.facts).toMatchObject({
        filterState: {
          status: 'observed',
          appliedLabels: ['图文', '最多收藏', '一周内'],
          contentType: '图文',
          sort: '最多收藏',
          timeRange: '一周内',
        },
      });
      const cards = objects
        .filter((object) => object.objectType === 'result_card')
        .sort((left, right) => {
          const leftRank = (left.facts as { rank?: number } | null)?.rank ?? 0;
          const rightRank = (right.facts as { rank?: number } | null)?.rank ?? 0;
          return leftRank - rightRank;
        });
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({
        parentObjectId: page?.browserObjectId,
        primaryConclusion: 'First result',
        confidenceScore: 0.86,
        canTabrixOperate: true,
        actionTypes: ['click_result_card', 'open_via_url'],
      });
      expect(cards[0].facts).toMatchObject({
        rank: 1,
        title: 'First result',
        url: 'https://example.test/note/:id',
        primaryText: 'Author A',
        actionTarget: {
          actionType: 'click',
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
          openAction: {
            toolName: 'chrome_navigate',
            toolArgs: { url: 'https://example.test/note/:id' },
            executionScope: 'session_url',
            reason: 'result_card_href',
          },
          toolName: 'chrome_click_element',
          toolArgs: {
            candidateAction: {
              targetRef: 'ref_result_card_1',
              intent: 'content.open_detail',
              locatorChain: [
                { type: 'ref', value: 'ref_result_card_1' },
                { type: 'css', value: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)' },
              ],
            },
          },
          center: { x: 100, y: 56 },
          coordinateFrame: 'viewport',
          sourceScrollY: 0,
          confidence: 0.9,
        },
        sourceStrategy: 'list_container',
      });
      expect(cards[0].targetability).toMatchObject({
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
          toolName: 'chrome_click_element',
          toolArgs: {
            candidateAction: {
              targetRef: 'ref_result_card_1',
              intent: 'content.open_detail',
            },
          },
          center: { x: 100, y: 56 },
          coordinateFrame: 'viewport',
          sourceScrollY: 0,
        },
      });
      expect(cards[1]).toMatchObject({
        primaryConclusion: 'Second result',
        actionTypes: ['open_via_url'],
      });
      expect(cards[1].facts).toMatchObject({
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
          executionScope: 'session_url',
          openAction: {
            toolName: 'chrome_navigate',
            toolArgs: { url: 'https://example.test/note/:id' },
            executionScope: 'session_url',
            reason: 'result_card_href',
          },
        },
      });
      expect(JSON.stringify(objects)).not.toContain('x=private');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps collected filter state when a later full page read refreshes the same page object', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'trace-filter-preserve-task',
        taskIntent: 'collect filtered xhs cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-filter-preserve-step-1',
        sequenceIndex: 1,
        requestParams: { tabId: 29, minResults: 10 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 120,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'AI图片创作 - 小红书',
            url: 'https://www.xiaohongshu.com/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          pageRole: 'search_results',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 29,
          requestedMinResults: 10,
          observedResultCount: 10,
          complete: true,
          status: 'complete_enough',
          filterState: {
            status: 'observed',
            appliedLabels: ['图文', '最多收藏', '一周内'],
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
          },
          cards: [
            {
              rank: 1,
              title: '小红书图文结果',
              url: 'https://www.xiaohongshu.com/explore/abc',
              imageCount: 1,
              confidence: 0.8,
            },
          ],
        }),
        resultSummary: 'collected xhs result cards',
      });

      await traceService.flushAsyncWrites();

      traceService.recordToolCall({
        taskId: 'trace-filter-preserve-task',
        taskIntent: 'measure full page baseline',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-filter-preserve-step-2',
        sequenceIndex: 2,
        requestParams: { tabId: 29, requestedLayer: 'L0+L1+L2' },
        requestAtMs: NOW_MS + 200,
        responseAtMs: NOW_MS + 420,
        result: textResult({
          page: {
            title: 'AI图片创作 - 小红书',
            url: 'https://www.xiaohongshu.com/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:www.xiaohongshu.com:search_results',
            chosenDataSource: 'markdown',
            tabId: 29,
          },
          browserPageObjectCompact: {
            status: 'complete',
            watchStatus: 'stable',
            operationSummary: { visibleText: true },
          },
          sourceRoute: 'markdown_snapshot',
          selectedDataSource: 'markdown',
          freshness: 'fresh',
          tabId: 29,
        }),
        resultSummary: 'full page read baseline',
      });

      await traceService.flushAsyncWrites();

      const page = browserObjectRepo
        .listRecent({ limit: 10, offset: 0 })
        .find((object) => object.objectType === 'page');

      expect(page?.facts).toMatchObject({
        filterState: {
          contentType: '图文',
          sort: '最多收藏',
          timeRange: '一周内',
        },
        observedResultCount: 10,
        requestedMinResults: 10,
        complete: true,
        lastCollectionSource: 'result_card_collection',
      });
      expect(page).toMatchObject({
        selectedDataSource: 'markdown',
        sourceRoute: 'markdown_snapshot',
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('rolls back read_page Browser Object writes when a child object write fails', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const originalUpsert = browserObjectRepo.upsert.bind(browserObjectRepo);
    let upsertCalls = 0;
    const upsertSpy = jest
      .spyOn(browserObjectRepo, 'upsert')
      .mockImplementation((input: BrowserObjectInput) => {
        upsertCalls += 1;
        if (upsertCalls === 2) {
          throw new Error('forced child object write failure');
        }
        return originalUpsert(input);
      });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-transaction-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-transaction-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/workspaces/123?tab=overview' },
          summary: { pageRole: 'workspace', quality: 'fresh' },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 7,
          pageRegions: [{ regionId: 'main', regionType: 'content', confidence: 0.9 }],
        }),
        resultSummary: 'fresh page read',
      });

      expect(trace.traceId).toBeDefined();
      expect(traceRepo.count()).toBe(1);
      expect(upsertCalls).toBe(0);
      expect(browserObjectRepo.count()).toBe(0);

      await traceService.flushAsyncWrites();

      expect(upsertCalls).toBe(2);
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      upsertSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('flushes async Browser Object write failures without throwing to callers', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const transactionSpy = jest.spyOn(browserObjectRepo, 'transaction').mockImplementation(() => {
      throw new Error('forced async projection failure');
    });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-failure-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-failure-step',
        sequenceIndex: 1,
        requestParams: { tabId: 8 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/failure' },
          summary: { pageRole: 'workspace' },
        }),
        resultSummary: 'fresh page read',
      });

      await expect(traceService.flushAsyncWrites()).resolves.toBeUndefined();
      expect(traceRepo.get(trace.traceId)).toMatchObject({ traceId: trace.traceId });
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      transactionSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('bounds queued Browser Object writes and keeps the newest job', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo, {
      asyncBrowserObjectWriteQueueLimit: 1,
    });

    try {
      traceService.recordToolCall({
        taskId: 'bounded-queue-task',
        taskIntent: 'inspect browser context',
        aiClient: 'jest',
        toolName: 'get_windows_and_tabs',
        stepId: 'bounded-queue-step-1',
        sequenceIndex: 1,
        requestParams: {},
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 10,
        result: textResult({
          browserWorld: {
            status: 'fresh',
            windows: [{ windowId: 1, focused: true }],
            tabs: [{ tabId: 11, windowId: 1, active: true, url: 'https://first.example.test' }],
          },
        }),
        resultSummary: 'first browser inventory read',
      });
      traceService.recordToolCall({
        taskId: 'bounded-queue-task',
        taskIntent: 'inspect browser context',
        aiClient: 'jest',
        toolName: 'get_windows_and_tabs',
        stepId: 'bounded-queue-step-2',
        sequenceIndex: 2,
        requestParams: {},
        requestAtMs: NOW_MS + 20,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          browserWorld: {
            status: 'fresh',
            windows: [{ windowId: 2, focused: true }],
            tabs: [{ tabId: 22, windowId: 2, active: true, url: 'https://second.example.test' }],
          },
        }),
        resultSummary: 'second browser inventory read',
      });

      expect(traceRepo.count()).toBe(2);
      await traceService.flushAsyncWrites();

      expect(browserObjectRepo.count()).toBe(2);
      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.windowId)).toEqual(expect.arrayContaining([2]));
      expect(objects.map((object) => object.windowId)).not.toContain(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records BrowserWorld snapshots into Object Library without appending Memory traces', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordBrowserWorldSnapshot({
        observedAtMs: NOW_MS,
        browserContextKey: 'heartbeat-conn',
        browserWorld: {
          status: 'fresh',
          recentActivityLedger: {
            latestPageClosed: {
              kind: 'page_closed',
              tabId: 22,
              windowId: 10,
              url: 'https://example.test/closed?token=secret',
              title: 'Closed Dashboard',
              openedBy: 'user_or_page',
              occurredAtMs: NOW_MS - 1000,
              evidence: 'browser_world_closed_tab_snapshot',
            },
          },
          windows: [{ windowId: 10, focused: true, state: 'normal', tabCount: 1 }],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              openedBy: 'user_or_page',
              canTabrixOperate: true,
              url: 'https://example.test/dashboard?token=secret',
              title: 'Dashboard',
            },
          ],
        },
      });

      expect(traceRepo.count()).toBe(0);
      expect(browserObjectRepo.countCurrentBrowserSurface()).toBe(2);
      const objects = browserObjectRepo.listCurrentBrowserSurface({ limit: 10, offset: 0 });
      const tab = objects.find((object) => object.objectType === 'tab' && object.tabId === 21);
      const closedTab = objects.find(
        (object) => object.objectType === 'tab' && object.tabId === 22,
      );
      expect(tab).toMatchObject({
        browserContextKey: 'heartbeat-conn',
        objectType: 'tab',
        tabId: 21,
        lifecycleState: 'updated',
        sourceRoute: 'chrome_windows_get_all_with_browser_world_inventory',
      });
      expect(closedTab).toMatchObject({
        objectType: 'tab',
        tabId: 22,
        lifecycleState: 'closed',
        closedAt: new Date(NOW_MS - 1000).toISOString(),
        archivedAt: null,
      });
      expect(JSON.stringify(tab)).not.toContain('secret');
      expect(JSON.stringify(closedTab)).not.toContain('secret');
    } finally {
      db.close();
    }
  });
});
