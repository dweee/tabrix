import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildMemoryTraceBindingHash } from '../memory/feedback-binding';
import {
  ExperienceRecipeRepository,
  KnowledgeModelRepository,
} from '../memory/db/mke-core-repository';
import { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import { SessionManager } from './session-manager';

describe('SessionManager', () => {
  it('creates tasks and tracks a basic execution lifecycle', () => {
    const manager = new SessionManager();
    try {
      const task = manager.createTask({
        taskType: 'browser-action',
        title: 'Smoke browser action',
        intent: 'Verify execution primitives',
        origin: 'test',
        labels: ['smoke'],
      });

      expect(task.status).toBe('pending');
      expect(manager.listTasks()).toHaveLength(1);

      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'streamable-http',
        clientName: 'jest',
      });

      expect(session.status).toBe('running');
      expect(manager.getTask(task.taskId).status).toBe('running');

      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
        inputSummary: 'Read active page',
      });

      expect(step.index).toBe(1);
      expect(manager.getSession(session.sessionId).steps).toHaveLength(1);

      manager.completeStep(session.sessionId, step.stepId, {
        resultSummary: 'Page read succeeded',
        artifactRefs: ['artifact://page-text'],
      });

      const completedSession = manager.finishSession(session.sessionId, {
        status: 'completed',
        summary: 'Smoke execution completed successfully',
      });

      expect(completedSession.status).toBe('completed');
      expect(completedSession.steps[0].status).toBe('completed');
      expect(completedSession.steps[0].artifactRefs).toEqual(['artifact://page-text']);
      expect(manager.getTask(task.taskId).status).toBe('completed');
    } finally {
      manager.close();
    }
  });

  it('does not persist runtime task/session/step wrappers across manager instances', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-'));
    const dbPath = join(dir, 'memory.db');
    try {
      const writer = new SessionManager({ dbPath });
      const task = writer.createTask({
        taskType: 'browser-action',
        title: 't1',
        intent: 'persist test',
        origin: 'jest',
      });
      const session = writer.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = writer.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_click_element',
        inputSummary: 'click nav',
      });
      writer.completeStep(session.sessionId, step.stepId, {
        resultSummary: 'clicked',
        artifactRefs: ['artifact://screenshot-1'],
      });
      writer.finishSession(session.sessionId, { status: 'completed', summary: 'ok' });
      writer.close();

      const reader = new SessionManager({ dbPath });
      try {
        expect(reader.getPersistenceStatus().mode).toBe('disk');
        expect(reader.listTasks()).toEqual([]);
        expect(reader.listSessions()).toEqual([]);
        expect(() => reader.getTask(task.taskId)).toThrow(`Unknown task: ${task.taskId}`);
      } finally {
        reader.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reset() clears persisted state as well as in-memory caches', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-reset-'));
    const dbPath = join(dir, 'memory.db');
    try {
      const mgr = new SessionManager({ dbPath });
      const task = mgr.createTask({
        taskType: 't',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      mgr.startSession({ taskId: task.taskId, transport: 'stdio', clientName: 'jest' });
      mgr.knowledgeApi?.upsert({
        site: 'api.example.test',
        family: 'observed',
        method: 'GET',
        urlPattern: 'api.example.test/search',
        endpointSignature: 'GET api.example.test/search',
        requestSummary: {
          headerKeys: [],
          queryKeys: ['q'],
          bodyKeys: [],
          hasAuth: false,
          hasCookie: false,
        },
        responseSummary: {
          contentType: 'application/json',
          sizeBytes: 128,
          shape: { kind: 'object', topLevelKeys: ['items'] },
        },
        observedAt: '2026-06-12T00:00:00.000Z',
        semanticType: 'search',
        usableForTask: true,
        endpointSource: 'observed',
      });
      expect(mgr.knowledgeApi?.countAll()).toBe(1);
      mgr.reset();
      expect(mgr.knowledgeApi?.countAll()).toBe(0);
      mgr.close();

      const restored = new SessionManager({ dbPath });
      try {
        expect(restored.listTasks()).toEqual([]);
        expect(restored.listSessions()).toEqual([]);
        expect(restored.knowledgeApi?.countAll()).toBe(0);
      } finally {
        restored.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('persistenceEnabled=false keeps sessions in memory only', () => {
    const mgr = new SessionManager({ persistenceEnabled: false });
    try {
      expect(mgr.getPersistenceStatus()).toEqual({ mode: 'off', enabled: false });
      const task = mgr.createTask({ taskType: 't', title: 't', intent: 'i', origin: 'jest' });
      expect(mgr.getTask(task.taskId)).toBeDefined();
    } finally {
      mgr.close();
    }
  });

  it('default in-memory DB under test env yields persistenceMode=memory', () => {
    const mgr = new SessionManager();
    try {
      expect(mgr.getPersistenceStatus().mode).toBe('memory');
      expect(mgr.getPersistenceStatus().enabled).toBe(true);
    } finally {
      mgr.close();
    }
  });

  it('flushes Object writes before projecting Knowledge after a tool trace', async () => {
    const mgr = new SessionManager();
    try {
      const trace = mgr.memoryTraces?.recordToolCall({
        taskId: 'task-result-card-projection',
        taskIntent: 'collect top search result cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'step-result-card-projection',
        sequenceIndex: 1,
        requestParams: { tabId: 19, minResults: 2 },
        requestAtMs: Date.parse('2026-06-10T10:00:00.000Z'),
        responseAtMs: Date.parse('2026-06-10T10:00:01.000Z'),
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
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
                cards: [
                  {
                    rank: 1,
                    title: 'First result',
                    url: 'https://example.test/note/1',
                    imageCount: 1,
                    confidence: 0.86,
                    reasons: ['link_present'],
                  },
                  {
                    rank: 2,
                    title: 'Second result',
                    url: 'https://example.test/note/2',
                    imageCount: 1,
                    confidence: 0.8,
                    reasons: ['link_present'],
                  },
                ],
              }),
            },
          ],
          isError: false,
        },
      });

      expect(trace?.pageModelKey).toBe('page:example.test:search_results');
      expect(mgr.countMkeObjectLibraryGraph()).toBe(0);
      expect(mgr.countMkeKnowledgeModels()).toBe(0);

      const projection = await mgr.flushAndProjectMkeIdle();

      expect(projection.knowledge?.upsertedKnowledgeCount).toBe(1);
      expect(mgr.countMkeObjectLibraryGraph()).toBe(3);
      expect(mgr.countMkeKnowledgeModels()).toBe(1);
    } finally {
      mgr.close();
    }
  });

  it('drains MKE projection batches so recent result-card objects are not starved by old data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-'));
    const dbPath = join(dir, 'memory.db');
    const baseMs = Date.parse('2026-06-06T07:00:00.000Z');
    try {
      const mgr = new SessionManager({ dbPath });
      try {
        for (let index = 0; index < 126; index += 1) {
          mgr.memoryTraces!.recordToolCall({
            taskId: `old-task-${index}`,
            toolName: 'chrome_collect_result_cards',
            stepId: `old-step-${index}`,
            requestParams: { tabId: index },
            requestAtMs: baseMs + index * 2,
            responseAtMs: baseMs + index * 2 + 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    page: {
                      title: `Old search ${index}`,
                      url: `https://old.example.test/search/${index}`,
                    },
                    siteFamily: 'old.example.test',
                    pageUrlPattern: `https://old.example.test/search/${index}`,
                    pageRole: 'search_results',
                    pageModelKey: `page:old.example.test:search_results:${index}`,
                    pageState: 'complete',
                    sourceRoute: 'visible_dom_cards_bounded_scroll',
                    selectedDataSource: 'visible_dom_result_cards',
                    freshness: 'fresh',
                    tabId: index,
                    requestedMinResults: 1,
                    observedResultCount: 1,
                    complete: true,
                    cards: [
                      {
                        rank: 1,
                        title: `Old result ${index}`,
                        url: `https://old.example.test/note/${index}`,
                        confidence: 0.8,
                      },
                    ],
                  }),
                },
              ],
              isError: false,
            },
          });
        }

        const currentTrace = mgr.memoryTraces!.recordToolCall({
          taskId: 'current-task',
          toolName: 'chrome_collect_result_cards',
          stepId: 'current-step',
          requestParams: { tabId: 999 },
          requestAtMs: baseMs + 1000,
          responseAtMs: baseMs + 1001,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  page: {
                    title: 'CONTENT current search',
                    url: 'https://content.example/search_result/?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
                  },
                  siteFamily: 'content.example',
                  pageUrlPattern: 'https://content.example/search_result/',
                  pageRole: 'search_results',
                  pageModelKey: 'page:content.example:search_results',
                  pageState: 'complete',
                  sourceRoute: 'visible_dom_cards_bounded_scroll',
                  selectedDataSource: 'visible_dom_result_cards',
                  freshness: 'fresh',
                  tabId: 999,
                  requestedMinResults: 10,
                  observedResultCount: 10,
                  complete: true,
                  cards: [
                    {
                      rank: 1,
                      title: 'Current reusable card',
                      url: 'https://content.example/explore/current-card',
                      imageCount: 1,
                      confidence: 0.9,
                      actionTarget: {
                        url: 'https://content.example/explore/current-card',
                      },
                    },
                  ],
                }),
              },
            ],
            isError: false,
          },
        });

        const projection = await mgr.flushAndProjectMkeIdle();
        const currentKnowledge = mgr
          .listRecentMkeKnowledgeModels(200, 0)
          .find((model) => model.siteFamily === 'content.example');

        expect(projection.knowledge?.processedTraceCount).toBeGreaterThan(100);
        expect(currentKnowledge).toBeDefined();
        expect(currentKnowledge?.sourceTraceIds).toContain(currentTrace.traceId);
        expect(currentKnowledge?.objectGraph).toMatchObject({
          resultCardSummary: {
            count: 1,
            rankRange: { min: 1, max: 1 },
          },
        });
      } finally {
        mgr.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reprojects Experience after AI feedback is recorded for a trace the idle cursor already passed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-'));
    const dbPath = join(dir, 'memory.db');
    try {
      const mgr = new SessionManager({ dbPath });
      try {
        const trace = mgr.memoryTraces!.recordToolCall({
          taskId: 'task-feedback-after-cursor',
          taskIntent: 'collect reusable search result cards',
          aiClient: 'jest',
          toolName: 'chrome_collect_result_cards',
          stepId: 'step-feedback-after-cursor',
          sequenceIndex: 1,
          requestParams: { tabId: 77, minResults: 1 },
          requestAtMs: Date.parse('2026-06-10T11:00:00.000Z'),
          responseAtMs: Date.parse('2026-06-10T11:00:01.000Z'),
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: true,
                  kind: 'result_card_collection',
                  page: {
                    title: 'Search results',
                    url: 'https://example.test/search?q=ai',
                  },
                  siteFamily: 'example.test',
                  pageUrlPattern: 'https://example.test/search',
                  pageRole: 'search_results',
                  pageModelKey: 'page:example.test:search_results',
                  pageState: 'complete',
                  sourceRoute: 'visible_dom_cards_bounded_scroll',
                  selectedDataSource: 'visible_dom_result_cards',
                  freshness: 'fresh',
                  tabId: 77,
                  requestedMinResults: 1,
                  observedResultCount: 1,
                  complete: true,
                  cards: [
                    {
                      rank: 1,
                      title: 'Reusable result',
                      url: 'https://example.test/note/reusable',
                      imageCount: 1,
                      confidence: 0.93,
                      actionTarget: {
                        url: 'https://example.test/note/reusable',
                      },
                    },
                  ],
                }),
              },
            ],
            isError: false,
          },
        });

        const firstProjection = await mgr.flushAndProjectMkeIdle();
        expect(firstProjection.knowledge?.upsertedKnowledgeCount).toBe(1);
        expect(firstProjection.experience?.upsertedRecipeCount ?? 0).toBe(0);
        expect(mgr.countMkeExperienceRecipes()).toBe(0);

        mgr.memoryTraces!.recordAiBusinessFeedback({
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          toolCallId: trace.toolCallId,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash: buildMemoryTraceBindingHash(trace),
          businessStatus: 'achieved',
          confidence: 0.94,
          reasonCode: 'result_cards_collected',
          summary: 'Collected reusable result cards for the search task.',
          evaluatorModel: 'codex-test-evaluator',
        });

        const feedbackProjection = await mgr.flushAndProjectMkeAfterAiFeedback();
        const recipes = mgr.listRecentMkeExperienceRecipes(10, 0);

        expect(feedbackProjection.experience?.savedExperienceCount).toBe(1);
        expect(recipes).toHaveLength(1);
        expect(recipes[0].sourceTraceIds).toContain(trace.traceId);
      } finally {
        mgr.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('can release an externally keyed task context after browser cleanup', () => {
    const mgr = new SessionManager();
    try {
      const first = mgr.getOrCreateExternalTaskContext('mcp:auto:tab:10');
      first.noteReadPage({ layer: 'L0+L1', source: 'unknown' });

      expect(mgr.peekExternalTaskContext('mcp:auto:tab:10')).toBe(first);
      expect(mgr.releaseExternalTaskContext('mcp:auto:tab:10')).toBe(true);
      expect(mgr.peekExternalTaskContext('mcp:auto:tab:10')).toBeNull();
      expect(mgr.releaseExternalTaskContext('mcp:auto:tab:10')).toBe(false);

      const second = mgr.getOrCreateExternalTaskContext('mcp:auto:tab:10');
      expect(second).not.toBe(first);
      expect(second.readPageCount).toBe(0);
    } finally {
      mgr.close();
    }
  });

  it('records selected Knowledge and Experience outcomes once per unique artifact', () => {
    const mgr = new SessionManager({ dbPath: ':memory:' });
    try {
      const repos = (
        mgr as unknown as {
          repos: {
            knowledgeModel: KnowledgeModelRepository;
            experienceRecipe: ExperienceRecipeRepository;
            knowledgeApi: KnowledgeApiRepository;
          };
        }
      ).repos;
      const knowledge = repos.knowledgeModel.upsert({
        knowledgeId: 'knowledge-selected',
        siteFamily: 'neutral.example',
        pageRole: 'search_results',
        pageModelKey: 'neutral-search',
        pageStateModel: {},
        objectGraph: {},
        actionSurface: {},
        successfulUseCount: 1,
        failedUseCount: 1,
        confidenceScore: 0.5,
        lastValidatedAt: '2026-07-27T01:00:00.000Z',
        createdAt: '2026-07-27T01:00:00.000Z',
        updatedAt: '2026-07-27T01:00:00.000Z',
      });
      const experience = repos.experienceRecipe.save({
        experienceId: 'experience-selected',
        recipeName: 'generic filter recipe',
        scenarioKey: 'mke:neutral.example:neutral-search',
        taskSignature: 'tools:chrome_hover_element>chrome_click_element',
        recipeFingerprint: 'generic-filter-recipe-v1',
        siteFamily: 'neutral.example',
        pageRole: 'search_results',
        pageModelKey: 'neutral-search',
        preconditions: {},
        variableSchema: {},
        steps: [{ toolName: 'chrome_hover_element' }, { toolName: 'chrome_click_element' }],
        successCheck: {},
        sourceTraceIds: ['trace-a', 'trace-b'],
        successCount: 2,
        failureCount: 0,
        reliabilityScore: 1,
        driftState: 'verified_once',
        createdAt: '2026-07-27T01:00:00.000Z',
        updatedAt: '2026-07-27T01:00:00.000Z',
      });
      const knowledgeApi = repos.knowledgeApi.upsert({
        site: 'api.neutral.example',
        family: 'observed',
        method: 'GET',
        urlPattern: 'api.neutral.example/items/:id',
        endpointSignature: 'GET api.neutral.example/items/:id',
        semanticTag: 'item_list',
        statusClass: '2xx',
        requestSummary: {
          headerKeys: ['accept'],
          queryKeys: ['page'],
          bodyKeys: [],
          hasAuth: false,
          hasCookie: false,
        },
        responseSummary: {
          contentType: 'application/json',
          sizeBytes: 256,
          shape: { kind: 'array', itemCount: 2, sampleItemKeys: ['id'] },
        },
        observedAt: '2026-07-27T01:00:00.000Z',
      });
      const artifacts = [
        { kind: 'knowledge_page_model', ref: knowledge.knowledgeId },
        { kind: 'knowledge_page_model', ref: knowledge.knowledgeId },
        { kind: 'experience_recipe', ref: experience.experienceId },
        { kind: 'experience_recipe', ref: experience.experienceId },
        { kind: 'knowledge_api', ref: knowledgeApi.endpointId },
        { kind: 'knowledge_api', ref: knowledgeApi.endpointId },
        { kind: 'knowledge_api', ref: knowledgeApi.site },
        { kind: 'unknown_kind', ref: 'ignored' },
        { kind: 'knowledge_page_model', ref: 'missing' },
      ];

      expect(
        mgr.recordMkeSelectedArtifactOutcome({
          successful: true,
          adopted: true,
          selectedArtifacts: artifacts,
          recordedAt: '2026-07-27T02:00:00.000Z',
        }),
      ).toEqual({ updatedExperienceCount: 1, updatedKnowledgeCount: 2 });
      expect(repos.knowledgeModel.get(knowledge.knowledgeId)).toMatchObject({
        successfulUseCount: 2,
        failedUseCount: 1,
        confidenceScore: 0.6667,
        lastValidatedAt: '2026-07-27T02:00:00.000Z',
      });
      expect(repos.experienceRecipe.get(experience.experienceId)).toMatchObject({
        successCount: 3,
        failureCount: 0,
        adoptionCount: 1,
        reliabilityScore: 1,
      });
      expect(
        repos.knowledgeApi.findBySignature(knowledgeApi.site, knowledgeApi.endpointSignature),
      ).toMatchObject({
        successfulUseCount: 1,
        failedUseCount: 0,
        lastValidatedAt: '2026-07-27T02:00:00.000Z',
      });

      mgr.recordMkeSelectedArtifactOutcome({
        successful: false,
        adopted: false,
        selectedArtifacts: artifacts,
        recordedAt: '2026-07-27T03:00:00.000Z',
      });
      expect(repos.knowledgeModel.get(knowledge.knowledgeId)).toMatchObject({
        successfulUseCount: 2,
        failedUseCount: 2,
        confidenceScore: 0.5,
        lastValidatedAt: '2026-07-27T03:00:00.000Z',
      });
      expect(repos.experienceRecipe.get(experience.experienceId)).toMatchObject({
        successCount: 3,
        failureCount: 1,
        reliabilityScore: 0.75,
        driftState: 'needs_revalidation',
      });
      expect(
        repos.knowledgeApi.findBySignature(knowledgeApi.site, knowledgeApi.endpointSignature),
      ).toMatchObject({
        successfulUseCount: 1,
        failedUseCount: 1,
        lastValidatedAt: '2026-07-27T03:00:00.000Z',
      });
    } finally {
      mgr.close();
    }
  });
});
