import { jest } from '@jest/globals';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  openMemoryDb,
  type BrowserObjectInput,
} from './db';
import { MkeMemoryTraceService } from './mke-memory-trace-service';

const NOW_MS = Date.parse('2026-06-10T10:00:00.000Z');

function textResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

describe('MkeMemoryTraceService', () => {
  it('rolls back read_page Browser Object writes when a child object write fails', () => {
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
      expect(upsertCalls).toBe(2);
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      upsertSpy.mockRestore();
      db.close();
    }
  });
});
