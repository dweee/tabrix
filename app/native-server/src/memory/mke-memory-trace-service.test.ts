import { jest } from '@jest/globals';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  openMemoryDb,
  type BrowserObjectInput,
} from './db';
import { MkeAiFeedbackValidationError, MkeMemoryTraceService } from './mke-memory-trace-service';
import { buildMemoryTraceBindingHash } from './feedback-binding';

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
        userGoalSnapshot: 'click and verify page result',
        experienceCandidate: true,
        evaluationVersion: 'ai_feedback_v1',
        rubricVersion: 'tabrix_ai_business_feedback_v1',
        evaluatorModel: 'jest-evaluator',
        receivedAt: '2026-06-10T10:00:01.000Z',
      });

      expect(updated).toMatchObject({
        traceId: trace.traceId,
        aiFeedbackScore: 0.94,
        aiFeedback: expect.objectContaining({
          sourceKind: 'ai_feedback',
          businessStatus: 'achieved',
          confidence: 0.94,
          experienceCandidate: true,
          evaluatorModel: 'jest-evaluator',
          binding: expect.objectContaining({
            traceId: trace.traceId,
            traceBindingHash: buildMemoryTraceBindingHash(trace),
          }),
        }),
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        traceId: trace.traceId,
        businessStatus: 'achieved',
        evidenceRefs: [],
        experienceCandidate: true,
        accepted: true,
      });
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
        userGoalSnapshot: 'click and verify page result',
        experienceCandidate: true,
        evaluationVersion: 'ai_feedback_v1',
        rubricVersion: 'tabrix_ai_business_feedback_v1',
        evaluatorModel: 'jest-evaluator',
      });
      expect(updated?.aiFeedback).toMatchObject({
        businessStatus: 'achieved',
        confidence: 0.95,
        experienceCandidate: true,
      });
      expect(updated?.aiFeedback).not.toHaveProperty('evidenceRefs');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        businessStatus: 'achieved',
        evidenceRefs: [],
        experienceCandidate: true,
        accepted: true,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('rejects experience candidates without complete AI evaluator metadata', () => {
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

      expect(() =>
        traceService.recordAiBusinessFeedback({
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash: buildMemoryTraceBindingHash(trace),
          businessStatus: 'achieved',
          confidence: 0.95,
          summary: 'AI verified the result.',
          experienceCandidate: true,
        }),
      ).toThrow(MkeAiFeedbackValidationError);
      expect(traceRepo.get(trace.traceId)?.aiFeedback).toBeNull();
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toEqual([]);
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
      expect(browserObjectRepo.countCurrentBrowserSurface()).toBe(3);
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
