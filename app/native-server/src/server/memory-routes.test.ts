import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';
import { sessionManager } from '../execution/session-manager';

async function seedOneSession(): Promise<{
  taskId: string;
  sessionId: string;
  stepIds: string[];
}> {
  const task = sessionManager.createTask({
    taskType: 'browser-action',
    title: 'route-test task',
    intent: 'inspect a github workflow run',
    origin: 'jest',
    labels: ['stage-3e', 'memory-routes'],
  });
  const session = sessionManager.startSession({
    taskId: task.taskId,
    transport: 'http',
    clientName: 'jest-supertest',
  });
  const step1 = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: 'chrome_read_page',
    inputSummary: 'read the workflow run page',
  });
  sessionManager.completeStep(session.sessionId, step1.stepId, {
    status: 'completed',
    resultSummary: 'ok',
  });
  const step2 = sessionManager.startStep({
    sessionId: session.sessionId,
    toolName: 'chrome_fill_or_select',
    inputSummary: 'fill the rerun reason',
  });
  sessionManager.completeStep(session.sessionId, step2.stepId, {
    status: 'failed',
    errorCode: 'element_not_found',
    errorSummary: 'the rerun button is not in the DOM',
  });
  sessionManager.finishSession(session.sessionId, { status: 'completed' });
  return {
    taskId: task.taskId,
    sessionId: session.sessionId,
    stepIds: [step1.stepId, step2.stepId],
  };
}

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
    businessStatus: 'achieved',
    confidence: 0.82,
    reasonCode: 'page_inventory_read',
    summary: 'AI judged the page inventory read as useful for the next action',
    sourceToolName: 'chrome_click_element',
    sourceToolCallId: 'feedback-call-1',
    receivedAt: '2026-06-06T10:00:00.080Z',
  });

  traceService.recordToolCall({
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
    }),
    resultSummary: 'clicked button',
  });

  sessionManager.projectMkeKnowledgeIdle({
    nowIso: '2026-06-06T10:00:01.000Z',
  });
  sessionManager.projectMkeExperienceIdle({
    nowIso: '2026-06-06T10:00:02.000Z',
  });
}

describe('memory read routes (B-001 · Stage 3e)', () => {
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  beforeEach(() => {
    sessionManager.reset();
  });

  afterEach(() => {
    sessionManager.reset();
  });

  test('GET /memory/sessions returns an empty list on a virgin DB', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/sessions')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: {
        sessions: [],
        total: 0,
        limit: 20,
        offset: 0,
      },
    });
    // Persistence mode is test-mode in-memory; the route echoes it so
    // the UI can show a neutral message when disk persistence is off.
    expect(['disk', 'memory', 'off']).toContain(res.body.data.persistenceMode);
  });

  test('GET /memory/sessions lists recent sessions with task title + step count', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server).get('/memory/sessions').expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.sessions).toHaveLength(1);
    expect(res.body.data.sessions[0]).toMatchObject({
      sessionId: seeded.sessionId,
      taskId: seeded.taskId,
      taskTitle: 'route-test task',
      taskIntent: 'inspect a github workflow run',
      transport: 'http',
      clientName: 'jest-supertest',
      status: 'completed',
      stepCount: 2,
    });
  });

  test('GET /memory/sessions honors limit and offset', async () => {
    for (let i = 0; i < 3; i += 1) {
      // Each seed increments the wall clock by 1ms so listRecent order
      // is deterministic for this assertion.
      await new Promise((resolve) => setTimeout(resolve, 2));
      await seedOneSession();
    }
    const first = await supertest(Server.getInstance().server)
      .get('/memory/sessions?limit=2&offset=0')
      .expect(200);
    const second = await supertest(Server.getInstance().server)
      .get('/memory/sessions?limit=2&offset=2')
      .expect(200);

    expect(first.body.data.total).toBe(3);
    expect(first.body.data.sessions).toHaveLength(2);
    expect(first.body.data.limit).toBe(2);
    expect(second.body.data.sessions).toHaveLength(1);
    expect(second.body.data.offset).toBe(2);
  });

  test('GET /memory/sessions/:sessionId/steps returns steps in chronological order', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server)
      .get(`/memory/sessions/${seeded.sessionId}/steps`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: { sessionId: seeded.sessionId },
    });
    expect(res.body.data.steps).toHaveLength(2);
    expect(res.body.data.steps[0]).toMatchObject({
      stepId: seeded.stepIds[0],
      toolName: 'chrome_read_page',
      status: 'completed',
    });
    expect(res.body.data.steps[1]).toMatchObject({
      stepId: seeded.stepIds[1],
      toolName: 'chrome_fill_or_select',
      status: 'failed',
      errorCode: 'element_not_found',
    });
  });

  test('GET /memory/sessions/:sessionId/steps returns [] for an unknown session', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/sessions/does-not-exist/steps')
      .expect(200);
    expect(res.body.data.steps).toEqual([]);
  });

  test('GET /memory/tasks/:taskId returns the task when it exists', async () => {
    const seeded = await seedOneSession();
    const res = await supertest(Server.getInstance().server)
      .get(`/memory/tasks/${seeded.taskId}`)
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      data: {
        task: {
          taskId: seeded.taskId,
          title: 'route-test task',
          intent: 'inspect a github workflow run',
        },
      },
    });
  });

  test('GET /memory/tasks/:taskId returns 404 for an unknown task', async () => {
    const res = await supertest(Server.getInstance().server)
      .get('/memory/tasks/does-not-exist')
      .expect(404);
    expect(res.body.status).toBe('error');
    expect(res.body.message).toBe('Task not found');
  });

  test('write verbs are not registered (read-only invariant)', async () => {
    // POST / PUT / PATCH / DELETE against the memory namespace must 404.
    await supertest(Server.getInstance().server).post('/memory/sessions').expect(404);
    await supertest(Server.getInstance().server)
      .delete('/memory/sessions/anything/steps')
      .expect(404);
    await supertest(Server.getInstance().server).put('/memory/tasks/any').expect(404);
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
      businessSuccess: 'true',
      tabId: 7,
      redactionState: 'redacted',
    });
    expect(res.body.data.traces[0]).not.toHaveProperty('requestParams');
    expect(res.body.data.traces[0]).not.toHaveProperty('response');
    expect(res.body.data.traces[0]).not.toHaveProperty('postObservation');
    expect(res.body.data.traces[1]).toMatchObject({
      toolName: 'chrome_read_page',
      businessSuccess: 'achieved',
      aiFeedbackScore: 0.82,
      aiFeedback: {
        businessStatus: 'achieved',
        confidence: 0.82,
        reasonCode: 'page_inventory_read',
        summary: 'AI judged the page inventory read as useful for the next action',
        sourceToolName: 'chrome_click_element',
        sourceToolCallId: 'feedback-call-1',
      },
    });
    expect(res.body.data.traces[1].aiFeedback).not.toHaveProperty('rawInput');
    expect(res.body.data.traces[1].aiFeedback).not.toHaveProperty('response');
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
      observationCount: 1,
      sourceTraceCount: 1,
    });
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('pageStateModel');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('objectGraph');
    expect(res.body.data.knowledgeModels[0]).not.toHaveProperty('sourceTraceIds');
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
  });
});
