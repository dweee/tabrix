import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { sessionManager } from '../execution/session-manager';
import { __hostConfigInternals, setPersonalBrowserStateStorageEnabled } from '../host-config';
import { buildMemoryTraceBindingHash } from '../memory/feedback-binding';

function textResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

async function seedMkeRows(): Promise<void> {
  const traceService = sessionManager.memoryTraces;
  if (!traceService) throw new Error('MKE trace service is not available in tests');
  const requestAt = Date.parse('2026-06-06T10:00:00.000Z');
  const taskId = 'mke-route-task-1';

  const readTrace = traceService.recordToolCall({
    taskId,
    taskIntent: 'inspect page and click action',
    aiClient: 'jest',
    toolName: 'chrome_read_page',
    stepId: 'mke-step-read',
    sequenceIndex: 1,
    requestParams: { tabId: 7, includeHidden: false },
    requestAtMs: requestAt,
    responseAtMs: requestAt + 20,
    result: textResult({
      page: { url: 'https://example.test/workspaces/123' },
      summary: { pageRole: 'workspace', quality: 'fresh' },
      sourceRoute: 'dom_snapshot',
      selectedDataSource: 'dom',
      freshness: 'fresh',
      tabId: 7,
    }),
    resultSummary: 'fresh page read',
  });

  traceService.recordAiBusinessFeedback({
    traceId: readTrace.traceId,
    taskId: readTrace.taskId,
    toolName: readTrace.toolName,
    toolCallId: readTrace.toolCallId,
    sequenceIndex: readTrace.sequenceIndex,
    traceBindingHash: buildMemoryTraceBindingHash(readTrace),
    businessStatus: 'achieved',
    confidence: 0.82,
    reasonCode: 'page_inventory_read',
    summary: 'AI judged the page inventory read as useful for the next action',
    sourceToolName: 'chrome_click_element',
    sourceToolCallId: 'feedback-call-1',
    receivedAt: '2026-06-06T10:00:00.080Z',
  });

  const clickTrace = traceService.recordToolCall({
    taskId,
    taskIntent: 'inspect page and click action',
    aiClient: 'jest',
    toolName: 'chrome_click_element',
    stepId: 'mke-step-click',
    sequenceIndex: 2,
    requestParams: { tabId: 7, ref: 'ref_button_1', selectorType: 'ref' },
    requestAtMs: requestAt + 30,
    responseAtMs: requestAt + 50,
    result: textResult({
      ok: true,
      tabId: 7,
      pageUrl: 'https://example.test/workspaces/123',
      summary: { pageRole: 'workspace', quality: 'fresh' },
      actionEvidenceResult: {
        business: {
          businessSuccessVerdict: 'proven',
          businessSuccessProven: true,
        },
      },
    }),
    resultSummary: 'clicked button',
  });
  traceService.recordAiBusinessFeedback({
    traceId: clickTrace.traceId,
    taskId: clickTrace.taskId,
    toolName: clickTrace.toolName,
    toolCallId: clickTrace.toolCallId,
    sequenceIndex: clickTrace.sequenceIndex,
    traceBindingHash: buildMemoryTraceBindingHash(clickTrace),
    businessStatus: 'achieved',
    confidence: 0.93,
    reasonCode: 'clicked_expected_control',
    summary: 'AI verified the click completed the intended page action',
    evidenceRefs: [clickTrace.traceId],
    experienceCandidate: true,
    sourceToolName: 'chrome_click_element',
    sourceToolCallId: 'feedback-call-2',
    receivedAt: '2026-06-06T10:00:00.090Z',
  });

  sessionManager.projectMkeKnowledgeIdle({
    nowIso: '2026-06-06T10:00:01.000Z',
  });
  sessionManager.projectMkeExperienceIdle({
    nowIso: '2026-06-06T10:00:02.000Z',
  });
}

describe('memory read routes (B-001 · Stage 3e)', () => {
  const configFile = path.join(os.tmpdir(), 'tabrix-memory-routes-test-config.json');

  beforeAll(async () => {
    __hostConfigInternals.setConfigFileForTesting(configFile);
    await Server.getInstance().ready();
  });

  beforeEach(() => {
    sessionManager.reset();
    fs.rmSync(configFile, { force: true });
  });

  afterEach(() => {
    sessionManager.reset();
    fs.rmSync(configFile, { force: true });
  });

  afterAll(() => {
    __hostConfigInternals.setConfigFileForTesting(null);
    fs.rmSync(configFile, { force: true });
  });

  test('retired session/task routes are not registered', async () => {
    await supertest(Server.getInstance().server).get('/memory/sessions').expect(404);
    await supertest(Server.getInstance().server).get('/memory/sessions/anything/steps').expect(404);
    await supertest(Server.getInstance().server).get('/memory/tasks/any').expect(404);
    await supertest(Server.getInstance().server).post('/memory/sessions').expect(404);
    await supertest(Server.getInstance().server)
      .delete('/memory/sessions/anything/steps')
      .expect(404);
    await supertest(Server.getInstance().server).put('/memory/tasks/any').expect(404);
  });

  test('GET/PATCH /memory/mke/object-storage-preferences manages Object Library storage preference', async () => {
    const initial = await supertest(Server.getInstance().server)
      .get('/memory/mke/object-storage-preferences')
      .expect(200);

    expect(initial.body.data).toMatchObject({
      personalBrowserStateStorageEnabled: false,
    });

    const updated = await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: true })
      .expect(200);

    expect(updated.body.data).toMatchObject({
      personalBrowserStateStorageEnabled: true,
    });

    await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: 'yes' })
      .expect(400);
  });

  test('GET /memory/mke/traces returns sanitized trace summaries', async () => {
    await seedMkeRows();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/traces?limit=10&offset=0')
      .expect(200);

    expect(res.body.data.total).toBe(2);
    expect(res.body.data.traces).toHaveLength(2);
    expect(res.body.data.traces[0]).toMatchObject({
      toolName: 'chrome_click_element',
      toolSuccess: true,
      tabId: 7,
      redactionState: 'redacted',
      display: {
        title: 'inspect page and click action',
        methodLabel: '点击元素',
      },
      statusView: {
        executionStatus: 'succeeded',
        feedbackRequired: false,
      },
      aiFeedback: {
        sourceKind: 'ai_feedback',
        businessStatus: 'achieved',
        confidence: 0.93,
        reasonCode: 'clicked_expected_control',
        summary: 'AI verified the click completed the intended page action',
      },
    });
    const removedSyntheticScoreKey = ['system', 'Evidence', 'Score'].join('');
    const removedSyntheticPayloadKey = ['system', 'Evidence'].join('');
    expect(res.body.data.traces[0]).not.toHaveProperty(removedSyntheticScoreKey);
    expect(res.body.data.traces[0]).not.toHaveProperty(removedSyntheticPayloadKey);
    expect(res.body.data.traces[0]).not.toHaveProperty('businessSuccess');
    expect(res.body.data.traces[0]).not.toHaveProperty('aiFeedbackScore');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('businessStatus');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('businessStatusSource');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('aiScore');
    expect(res.body.data.traces[0].pageIdentity.label).toBe('example.test');
    expect(res.body.data.traces[0]).not.toHaveProperty('requestParams');
    expect(res.body.data.traces[0]).not.toHaveProperty('response');
    expect(res.body.data.traces[0]).not.toHaveProperty('postObservation');
    expect(res.body.data.traces[1]).toMatchObject({
      toolName: 'chrome_read_page',
      statusView: {
        executionStatus: 'succeeded',
        feedbackRequired: false,
      },
      aiFeedback: {
        sourceKind: 'ai_feedback',
        businessStatus: 'achieved',
        confidence: 0.82,
        reasonCode: 'page_inventory_read',
        summary: 'AI judged the page inventory read as useful for the next action',
        sourceToolName: 'chrome_click_element',
        sourceToolCallId: 'feedback-call-1',
      },
    });
    expect(res.body.data.traces[1]).not.toHaveProperty(removedSyntheticScoreKey);
    expect(res.body.data.traces[1]).not.toHaveProperty(removedSyntheticPayloadKey);
    expect(res.body.data.traces[1]).not.toHaveProperty('businessSuccess');
    expect(res.body.data.traces[1]).not.toHaveProperty('aiFeedbackScore');
    expect(res.body.data.traces[1].statusView).not.toHaveProperty('businessStatus');
    expect(res.body.data.traces[1].statusView).not.toHaveProperty('businessStatusSource');
    expect(res.body.data.traces[1].statusView).not.toHaveProperty('aiScore');
    expect(res.body.data.traces[1].aiFeedback).not.toHaveProperty('rawInput');
    expect(res.body.data.traces[1].aiFeedback).not.toHaveProperty('response');
  });

  test('GET /memory/mke/traces does not expose orphan legacy score as AI score', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const trace = traceService.recordToolCall({
      taskId: 'mke-route-task-orphan-score',
      taskIntent: 'read a page before AI evaluation',
      aiClient: 'jest',
      toolName: 'chrome_read_page',
      stepId: 'mke-step-orphan-score',
      sequenceIndex: 1,
      requestParams: { tabId: 11 },
      requestAtMs: Date.parse('2026-06-06T12:00:00.000Z'),
      responseAtMs: Date.parse('2026-06-06T12:00:00.050Z'),
      result: textResult({
        page: { url: 'https://example.test/search' },
        summary: { pageRole: 'search_results', quality: 'usable' },
      }),
      resultSummary: 'read page without AI evaluation',
    });
    (traceService as any).repo.updateAiFeedback({
      traceId: trace.traceId,
      aiFeedbackScore: 0.99,
      aiFeedback: null,
    });

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/traces?limit=10&offset=0')
      .expect(200);

    expect(res.body.data.traces[0]).toMatchObject({
      traceId: trace.traceId,
      aiFeedback: null,
      statusView: {
        feedbackRequired: true,
      },
    });
    expect(res.body.data.traces[0]).not.toHaveProperty('aiFeedbackScore');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('aiScore');
  });

  test('GET /memory/mke/traces exposes AI feedback without legacy business status', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T11:00:00.000Z');

    const trace = traceService.recordToolCall({
      taskId: 'mke-route-task-conflict',
      taskIntent: 'apply a filter and verify the results',
      aiClient: 'jest',
      toolName: 'chrome_click_element',
      stepId: 'mke-step-conflict',
      sequenceIndex: 1,
      requestParams: { tabId: 9, selector: '[data-filter]' },
      requestAtMs: requestAt,
      responseAtMs: requestAt + 40,
      result: textResult({
        success: true,
        pageUrl: 'https://example.test/search',
        businessSuccess: 'not_achieved',
      }),
      resultSummary: 'click dispatched but filter state was not verified',
    });

    traceService.recordAiBusinessFeedback({
      traceId: trace.traceId,
      taskId: trace.taskId,
      toolName: trace.toolName,
      toolCallId: trace.toolCallId,
      sequenceIndex: trace.sequenceIndex,
      traceBindingHash: buildMemoryTraceBindingHash(trace),
      businessStatus: 'achieved',
      confidence: 0.91,
      reasonCode: 'ai_overstated_completion',
      summary: 'AI thought the filter was applied',
      evidenceRefs: [trace.traceId],
      receivedAt: '2026-06-06T11:00:00.090Z',
    });

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/traces?limit=10&offset=0')
      .expect(200);

    expect(res.body.data.traces[0]).toMatchObject({
      traceId: trace.traceId,
      statusView: {
        executionStatus: 'succeeded',
        feedbackRequired: false,
      },
      aiFeedback: {
        sourceKind: 'ai_feedback',
        businessStatus: 'achieved',
        confidence: 0.91,
        reasonCode: 'ai_overstated_completion',
        summary: 'AI thought the filter was applied',
      },
    });
    expect(res.body.data.traces[0]).not.toHaveProperty('businessSuccess');
    expect(res.body.data.traces[0]).not.toHaveProperty('aiFeedbackScore');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('businessStatus');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('businessStatusSource');
    expect(res.body.data.traces[0].statusView).not.toHaveProperty('aiScore');
  });

  test('GET /memory/mke/knowledge returns sanitized knowledge summaries', async () => {
    await seedMkeRows();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/knowledge')
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.knowledgeModels[0]).toMatchObject({
      siteFamily: 'example.test',
      pageRole: 'workspace',
      observationCount: 2,
      sourceTraceCount: 2,
    });
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('pageStateModel');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('objectGraph');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('sourceTraceIds');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('confidenceScore');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('driftScore');
  });

  test('GET /memory/mke/browser-objects does not expose read_page internals as browser tabs', async () => {
    await seedMkeRows();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects')
      .expect(200);

    expect(res.body.data.total).toBe(0);
    expect(res.body.data.browserObjects).toEqual([]);
  });

  test('GET /memory/mke/browser-objects lists BrowserWorld window and tab objects', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:00:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-route-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-step',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [
            { windowId: 10, focused: true, state: 'maximized', tabCount: 1, activeTabId: 21 },
          ],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'ai',
              canTabrixOperate: true,
              url: 'https://example.test/search?spm=tracking&q=private-token&tab=demohouse&access_token=real-secret#/experience/llm',
              title: 'Search results - Example',
            },
            {
              tabId: 22,
              windowId: 10,
              active: false,
              status: 'complete',
              ownerType: 'user_or_page',
              canTabrixOperate: false,
              operabilityReason: 'browser_internal_page',
              url: 'chrome://newtab/',
              title: 'New Tab',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });
    await traceService.flushAsyncWrites();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);

    expect(res.body.data.total).toBe(3);
    const objects = res.body.data.browserObjects as Array<Record<string, unknown>>;
    expect(objects.map((object) => object.objectType).sort()).toEqual(['tab', 'tab', 'window']);
    const windowObject = objects.find((object) => object.objectType === 'window');
    expect(windowObject).toMatchObject({
      display: {
        title: '当前浏览器窗口 · 1 个标签 · 可见',
        locationLabel: '浏览器',
      },
    });
    const tab = objects.find((object) => object.pageUrlPattern === 'https://example.test/search');
    expect(tab).toMatchObject({
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      rootRoute: 'https://example.test/search',
      currentRoute: 'https://example.test/search',
      ownerType: 'ai',
      canTabrixOperate: true,
      facts: {
        titleSummary: 'Search results - Example',
        host: 'example.test',
        currentRoute: 'https://example.test/search',
      },
      pageIdentity: {
        label: 'example.test',
        host: 'example.test',
        url: 'https://example.test/search',
        source: 'current_route',
      },
      display: {
        title: 'Search results - Example',
      },
    });
    expect(JSON.stringify(tab)).not.toContain('private-token');
    expect(JSON.stringify(tab)).not.toContain('spm');
    expect(JSON.stringify(tab)).not.toContain('tab=demohouse');
    expect(JSON.stringify(tab)).not.toContain('access_token');
    expect(JSON.stringify(tab)).not.toContain('real-secret');
    expect(JSON.stringify(tab)).not.toContain('#/experience/llm');
    expect(tab).not.toHaveProperty('currentState');
    expect(tab).not.toHaveProperty('recentEvents');
    expect(tab).not.toHaveProperty('sourceTraceIds');
    expect(tab).not.toHaveProperty('evidenceRefs');
    expect(tab).not.toHaveProperty('claimBoundary');
    expect(tab).not.toHaveProperty('confidenceScore');
    expect(tab).not.toHaveProperty('driftScore');
    const browserTab = objects.find((object) => object.pageUrlPattern === 'chrome://newtab/');
    expect(browserTab).toMatchObject({
      siteFamily: 'browser',
      rootRoute: 'chrome://newtab/',
      currentRoute: 'chrome://newtab/',
      pageIdentity: {
        kind: 'browser_internal',
        label: 'chrome://newtab/',
        url: 'chrome://newtab/',
      },
      display: {
        title: 'New Tab',
        locationLabel: 'chrome://newtab/',
      },
    });
  });

  test('Object Library upserts the same BrowserWorld window and tab across context refreshes', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:10:00.000Z');
    const browserWorldPayload = {
      source: 'chrome_windows_get_all_with_browser_world_inventory',
      browserWorld: {
        status: 'fresh',
        windows: [{ windowId: 10, focused: true, state: 'normal', tabCount: 1, activeTabId: 21 }],
        tabs: [
          {
            tabId: 21,
            windowId: 10,
            active: true,
            status: 'complete',
            ownerType: 'user_or_page',
            canTabrixOperate: true,
            url: 'https://example.test/search',
            title: 'Search results - Example',
          },
        ],
      },
    };

    traceService.recordToolCall({
      taskId: 'browser-object-stable-key-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-stable-key-step-1',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      browserContextKey: 'ctx-before-reload',
      result: textResult(browserWorldPayload),
      resultSummary: 'browser inventory read',
    });

    traceService.recordToolCall({
      taskId: 'browser-object-stable-key-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-stable-key-step-2',
      sequenceIndex: 2,
      requestParams: {},
      requestAtMs: requestAt + 100,
      responseAtMs: requestAt + 118,
      browserContextKey: 'ctx-after-reload',
      result: textResult(browserWorldPayload),
      resultSummary: 'browser inventory read again',
    });
    await traceService.flushAsyncWrites();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);

    expect(res.body.data.total).toBe(2);
    const objects = res.body.data.browserObjects as Array<Record<string, unknown>>;
    const tab = objects.find((object) => object.objectType === 'tab');
    const windowObject = objects.find((object) => object.objectType === 'window');
    expect(tab).toMatchObject({
      objectType: 'tab',
      browserContextKey: 'ctx-after-reload',
      observationCount: 2,
    });
    expect(windowObject).toMatchObject({
      objectType: 'window',
      browserContextKey: 'ctx-after-reload',
      observationCount: 2,
    });
  });

  test('Object Library list defaults to current browser windows and tabs, not read_page internals', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:15:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-surface-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-surface-step-1',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      browserContextKey: 'ctx-surface',
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [{ windowId: 10, focused: true, state: 'normal', tabCount: 1, activeTabId: 21 }],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'user',
              canTabrixOperate: true,
              url: 'https://example.test/search',
              title: 'Search results - Example',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });

    traceService.recordToolCall({
      taskId: 'browser-object-surface-task',
      taskIntent: 'read current page',
      aiClient: 'jest',
      toolName: 'chrome_read_page',
      stepId: 'browser-object-surface-step-2',
      sequenceIndex: 2,
      requestParams: { tabId: 21 },
      requestAtMs: requestAt + 100,
      responseAtMs: requestAt + 118,
      browserContextKey: 'ctx-surface',
      result: textResult({
        page: { url: 'https://example.test/search', title: 'Search results - Example' },
        summary: { pageRole: 'multi_region_page' },
        pageProjection: {
          tabId: 21,
          pageRole: 'multi_region_page',
          pageModelKey: 'read://example.test/search',
          chosenDataSource: 'api_rows',
          sourceFreshness: 'fresh',
          sourceConfidence: 0.72,
        },
        sourceRoute: 'knowledge_api_endpoints',
        selectedDataSource: 'api_rows',
        endpointFamily: 'example_search',
        pageRegions: [{ regionId: 'content', regionType: 'content', confidence: 0.8 }],
        candidateActions: [{ targetRef: 'open-result', actionType: 'click', confidence: 0.8 }],
      }),
      resultSummary: 'read page',
    });
    await traceService.flushAsyncWrites();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=20&offset=0')
      .expect(200);

    expect(res.body.data.total).toBe(2);
    expect(
      (res.body.data.browserObjects as Array<Record<string, unknown>>).map(
        (object) => object.objectType,
      ),
    ).toEqual(expect.arrayContaining(['window', 'tab']));
    expect(
      (res.body.data.browserObjects as Array<Record<string, unknown>>).some((object) =>
        ['page', 'region', 'action_target'].includes(String(object.objectType)),
      ),
    ).toBe(false);

    const graph = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=20&offset=0&scope=object-graph')
      .expect(200);

    expect(graph.body.data.total).toBe(6);
    const graphObjects = graph.body.data.browserObjects as Array<Record<string, unknown>>;
    expect(graphObjects.map((object) => object.objectType)).toEqual(
      expect.arrayContaining(['window', 'tab', 'page', 'region', 'action_target', 'data_source']),
    );
    expect(graphObjects.find((object) => object.objectType === 'data_source')).toMatchObject({
      selectedDataSource: 'api_rows',
      sourceRoute: 'knowledge_api_endpoints',
    });
    expect(graphObjects.find((object) => object.objectType === 'action_target')).toMatchObject({
      actionTypes: ['click'],
      redactionState: 'redacted',
    });
    expect(JSON.stringify(graphObjects)).not.toContain('currentState');
    expect(JSON.stringify(graphObjects)).not.toContain('sourceTraceIds');
    expect(JSON.stringify(graphObjects)).not.toContain('evidenceRefs');
    expect(JSON.stringify(graphObjects)).not.toContain('claimBoundary');
    expect(JSON.stringify(graphObjects)).not.toContain('confidenceScore');
    expect(JSON.stringify(graphObjects)).not.toContain('driftScore');
  });

  test('DELETE /memory/mke/browser-objects clears Object Library without deleting Memory traces', async () => {
    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:20:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-clear-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-clear-step',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [{ windowId: 10, focused: true, state: 'normal', tabCount: 1, activeTabId: 21 }],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'ai',
              canTabrixOperate: true,
              url: 'https://example.test/search',
              title: 'Search results - Example',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });
    await traceService.flushAsyncWrites();

    const before = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);
    expect(before.body.data.total).toBeGreaterThan(0);

    const deleted = await supertest(Server.getInstance().server)
      .delete('/memory/mke/browser-objects')
      .expect(200);
    expect(deleted.body.data).toMatchObject({
      cleared: true,
      total: 0,
      persistenceMode: 'memory',
    });

    const afterObjects = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);
    expect(afterObjects.body.data.total).toBe(0);

    const afterTraces = await supertest(Server.getInstance().server)
      .get('/memory/mke/traces?limit=10&offset=0')
      .expect(200);
    expect(afterTraces.body.data.total).toBe(1);
  });

  test('Object Library stores full current routes when personal browser state storage is enabled', async () => {
    await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: true })
      .expect(200);

    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:30:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-full-route-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-full-route-step',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [
            { windowId: 10, focused: true, state: 'maximized', tabCount: 1, activeTabId: 21 },
          ],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'ai',
              canTabrixOperate: true,
              url: 'https://example.test/search?access_token=real-secret&tab=demohouse#/experience/llm',
              title: 'Search results - Example',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });
    await traceService.flushAsyncWrites();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);

    const tab = (res.body.data.browserObjects as Array<Record<string, unknown>>).find(
      (object) => object.objectType === 'tab',
    );
    expect(tab).toMatchObject({
      redactionState: 'user_authorized',
      currentRoute:
        'https://example.test/search?access_token=real-secret&tab=demohouse#/experience/llm',
      pageIdentity: {
        url: 'https://example.test/search?access_token=real-secret&tab=demohouse#/experience/llm',
      },
    });
  });

  test('Object Library does not return old full routes after current preference is disabled', async () => {
    await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: true })
      .expect(200);

    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:35:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-old-authorized-route-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-old-authorized-route-step',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [
            { windowId: 10, focused: true, state: 'maximized', tabCount: 1, activeTabId: 21 },
          ],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'ai',
              canTabrixOperate: true,
              url: 'https://example.test/search?access_token=real-secret&tab=demohouse#/experience/llm',
              title: 'Search results - Example',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });
    await traceService.flushAsyncWrites();

    const before = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);
    const beforeSerialized = JSON.stringify(before.body.data.browserObjects);
    expect(beforeSerialized).toContain('real-secret');
    expect(beforeSerialized).toContain('tab=demohouse');

    setPersonalBrowserStateStorageEnabled(false);

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);

    const serialized = JSON.stringify(res.body.data.browserObjects);
    expect(serialized).not.toContain('real-secret');
    expect(serialized).not.toContain('tab=demohouse');
    const tab = (res.body.data.browserObjects as Array<Record<string, unknown>>).find(
      (object) => object.objectType === 'tab',
    );
    expect(tab).toMatchObject({
      redactionState: 'redacted',
      currentRoute: 'https://example.test/search',
      pageIdentity: {
        url: 'https://example.test/search',
      },
    });
  });

  test('disabling personal browser state storage keeps Object Library rows and redacts authorized routes', async () => {
    await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: true })
      .expect(200);

    const traceService = sessionManager.memoryTraces;
    if (!traceService) throw new Error('MKE trace service is not available in tests');
    const requestAt = Date.parse('2026-06-06T12:40:00.000Z');

    traceService.recordToolCall({
      taskId: 'browser-object-disable-full-route-task',
      taskIntent: 'inspect browser context',
      aiClient: 'jest',
      toolName: 'get_windows_and_tabs',
      stepId: 'browser-object-disable-full-route-step',
      sequenceIndex: 1,
      requestParams: {},
      requestAtMs: requestAt,
      responseAtMs: requestAt + 18,
      result: textResult({
        source: 'chrome_windows_get_all_with_browser_world_inventory',
        browserWorld: {
          status: 'fresh',
          windows: [
            { windowId: 10, focused: true, state: 'maximized', tabCount: 1, activeTabId: 21 },
          ],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              ownerType: 'ai',
              canTabrixOperate: true,
              url: 'https://example.test/search?access_token=real-secret&tab=demohouse#/experience/llm',
              title: 'Search results - Example',
            },
          ],
        },
      }),
      resultSummary: 'browser inventory read',
    });
    await traceService.flushAsyncWrites();

    const before = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);
    expect(JSON.stringify(before.body.data.browserObjects)).toContain('real-secret');

    await supertest(Server.getInstance().server)
      .patch('/memory/mke/object-storage-preferences')
      .send({ personalBrowserStateStorageEnabled: false })
      .expect(200);

    const after = await supertest(Server.getInstance().server)
      .get('/memory/mke/browser-objects?limit=10&offset=0')
      .expect(200);
    expect(after.body.data.total).toBeGreaterThan(0);
    expect(JSON.stringify(after.body.data.browserObjects)).not.toContain('real-secret');
    expect(JSON.stringify(after.body.data.browserObjects)).not.toContain('tab=demohouse');
    const tab = (after.body.data.browserObjects as Array<Record<string, unknown>>).find(
      (object) => object.objectType === 'tab',
    );
    expect(tab).toMatchObject({
      redactionState: 'redacted',
      currentRoute: 'https://example.test/search',
      pageIdentity: {
        url: 'https://example.test/search',
      },
    });
  });

  test('GET /memory/mke/experience returns sanitized template summaries', async () => {
    await seedMkeRows();

    const res = await supertest(Server.getInstance().server)
      .get('/memory/mke/experience')
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.experienceRecipes[0]).toMatchObject({
      redactionState: 'template_only',
      successCount: 1,
      sourceTraceCount: 2,
      linkedKnowledgeCount: 1,
    });
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('steps');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('preconditions');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('sourceTraceIds');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('reliabilityScore');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('speedScore');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('tokenSavingScore');
    expect(res.body.data.experienceRecipes[0]).not.toHaveProperty('usefulnessScore');
  });
});
