import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TaskSessionContext } from '../execution/task-session-context';
import { recordSuccessfulReadPageCall } from './read-page-success-recorder';

function jsonResult(payload: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError,
  };
}

describe('recordSuccessfulReadPageCall', () => {
  it('records successful chrome_read_page calls with source and target refs', () => {
    const taskContext = new TaskSessionContext({ readBudget: 6 });

    const recorded = recordSuccessfulReadPageCall({
      alreadyRecorded: false,
      toolName: 'chrome_read_page',
      taskContext,
      rawResult: jsonResult({
        title: 'Search results',
        url: 'https://example.test/search?q=ai',
        pageObjectSummary: { objectCount: 3 },
      }),
      args: { requestedLayer: 'L0+L1+L2', tabId: 7 },
      source: 'dom_region_rows',
      targetRefs: ['target:1', 'target:2'],
    });

    expect(recorded).toBe(true);
    expect(taskContext.readPageCount).toBe(1);
    expect(taskContext.targetRefsSeen.has('target:1')).toBe(true);
    expect(taskContext.targetRefsSeen.has('target:2')).toBe(true);
    expect(taskContext.peekReadPageContextMeasurement()).toMatchObject({
      url: 'https://example.test/search?q=ai',
      fullReadByteLength: expect.any(Number),
      candidateActionsCount: 0,
      highValueObjectCount: 0,
    });
  });

  it('records page identity from the structured page object at compact layers', () => {
    const taskContext = new TaskSessionContext({ readBudget: 6 });

    const recorded = recordSuccessfulReadPageCall({
      alreadyRecorded: false,
      toolName: 'chrome_read_page',
      taskContext,
      rawResult: jsonResult({
        page: {
          url: 'https://example.test/search?q=ai',
          title: 'Search results',
        },
        pageObjectSnapshot: {
          pageRole: 'search_results',
        },
        candidateActions: [{ action: 'click', targetRef: 'target:filter' }],
      }),
      args: { requestedLayer: 'L0+L1', tabId: 7 },
      source: 'dom_region_rows',
      targetRefs: ['target:filter'],
    });

    expect(recorded).toBe(true);
    expect(taskContext.currentUrl).toBe('https://example.test/search?q=ai');
    expect(taskContext.pageRole).toBe('search_results');
    expect(taskContext.peekReadPageContextMeasurement()).toMatchObject({
      url: 'https://example.test/search?q=ai',
      pageRole: 'search_results',
      fullReadByteLength: 0,
      candidateActionsCount: 1,
    });
    expect(taskContext.readPageCount).toBe(1);
  });

  it('enriches an explicitly navigated page with its role without duplicating navigation', () => {
    const taskContext = new TaskSessionContext({ readBudget: 6 });
    taskContext.noteUrlChange('https://example.test/search?q=ai');

    recordSuccessfulReadPageCall({
      alreadyRecorded: false,
      toolName: 'chrome_read_page',
      taskContext,
      rawResult: jsonResult({
        page: { url: 'https://example.test/search?q=ai' },
        pageObjectSnapshot: { pageRole: 'search_results' },
      }),
      args: { requestedLayer: 'L0+L1' },
      source: 'dom_region_rows',
    });

    expect(taskContext.pageRole).toBe('search_results');
    expect(taskContext.getLifecycleTimeline().map((event) => event.kind)).toEqual(['navigation']);
  });

  it('does not record failed, duplicate, or non-read-page calls', () => {
    const taskContext = new TaskSessionContext({ readBudget: 6 });
    const failed = recordSuccessfulReadPageCall({
      alreadyRecorded: false,
      toolName: 'chrome_read_page',
      taskContext,
      rawResult: jsonResult({ ok: false }, true),
      args: { requestedLayer: 'L0+L1' },
      source: 'unknown',
    });
    const nonRead = recordSuccessfulReadPageCall({
      alreadyRecorded: false,
      toolName: 'chrome_navigate',
      taskContext,
      rawResult: jsonResult({ ok: true }),
      args: {},
      source: 'unknown',
    });
    const duplicate = recordSuccessfulReadPageCall({
      alreadyRecorded: true,
      toolName: 'chrome_read_page',
      taskContext,
      rawResult: jsonResult({ ok: true }),
      args: {},
      source: 'unknown',
    });

    expect(failed).toBe(false);
    expect(nonRead).toBe(false);
    expect(duplicate).toBe(true);
    expect(taskContext.readPageCount).toBe(0);
  });
});
