import {
  ExperienceRecipeRepository,
  KnowledgeModelRepository,
  MemoryTraceRepository,
  openMemoryDb,
} from './db';
import { MkeExperienceProjector } from './mke-experience-projector';
import { buildMkePageModelKey } from './mke-knowledge-projector';

function addKnowledge(input: {
  knowledge: KnowledgeModelRepository;
  siteFamily: string;
  pageModelKey: string;
  pageRole: string;
  pageUrlPattern: string;
}) {
  return input.knowledge.upsert({
    siteFamily: input.siteFamily,
    pageModelKey: input.pageModelKey,
    pageRole: input.pageRole,
    pageUrlPattern: input.pageUrlPattern,
    modelVersion: 1,
    pageStateModel: { schema: 'test', states: { ready: 1 } },
    objectGraph: { schema: 'test' },
    actionSurface: { schema: 'test' },
    sourceTraceIds: ['trace-read'],
    confidenceScore: 0.8,
    driftScore: 0,
    createdAt: '2026-06-06T03:00:00.000Z',
    updatedAt: '2026-06-06T03:00:00.000Z',
  });
}

function verifiedExperienceFeedback(input: {
  confidence: number;
  reasonCode: string;
  summary: string;
}) {
  return {
    sourceKind: 'ai_feedback',
    evaluationScope: 'step',
    businessStatus: 'achieved',
    confidence: input.confidence,
    reasonCode: input.reasonCode,
    summary: input.summary,
  };
}

function saveTestExperience(
  experience: ExperienceRecipeRepository,
  input: { recipeFingerprint: string; archivedAt?: string | null },
) {
  return experience.save({
    recipeName: `Test recipe ${input.recipeFingerprint}`,
    scenarioKey: 'search-results::collect-top10',
    taskSignature: 'collect filtered results',
    recipeFingerprint: input.recipeFingerprint,
    siteFamily: 'example.test',
    pageModelKey: 'example.test::search_results::v1',
    pageRole: 'search_results',
    preconditions: { states: ['search_results_ready'] },
    variableSchema: { fields: ['query'] },
    steps: [{ toolName: 'chrome_collect_result_cards', argsTemplate: { minResults: 10 } }],
    successCheck: { requiresAiFeedback: true, minimumConfidence: 0.9 },
    sourceTraceIds: [`trace-${input.recipeFingerprint}`],
    linkedKnowledgeIds: [`knowledge-${input.recipeFingerprint}`],
    successCount: 2,
    failureCount: 0,
    reliabilityScore: 1,
    driftState: 'verified_once',
    archivedAt: input.archivedAt ?? null,
    lastVerifiedAt: '2026-06-06T03:00:00.000Z',
    createdAt: '2026-06-06T03:00:00.000Z',
    updatedAt: '2026-06-06T03:00:00.000Z',
  });
}

describe('MkeExperienceProjector', () => {
  it('does not list or count archived recipes as reusable product experience', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const experience = new ExperienceRecipeRepository(opened.db);
    try {
      saveTestExperience(experience, { recipeFingerprint: 'active' });
      saveTestExperience(experience, {
        recipeFingerprint: 'archived',
        archivedAt: '2026-06-06T04:00:00.000Z',
      });

      expect(experience.listRecent({ limit: 10 })).toHaveLength(1);
      expect(experience.listRecent({ limit: 10 })[0].recipeFingerprint).toBe('active');
      expect(experience.count()).toBe(1);
    } finally {
      opened.db.close();
    }
  });

  it('mines a template-only recipe from a successful memory and knowledge chain', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read',
      taskId: 'task-1',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T03:00:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T03:00:02.000Z',
      durationMs: 1000,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_page_read',
        summary: 'AI verified the page read found the editor objects needed for this task.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T03:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    const model = addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-fill',
      taskId: 'task-1',
      toolName: 'chrome_fill_or_select',
      requestParams: { tabId: 9, ref: 'title-input', value: '[redacted]' },
      requestAt: '2026-06-06T03:00:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T03:00:04.000Z',
      durationMs: 1000,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.94,
        reasonCode: 'ai_verified_fill',
        summary: 'AI verified the fill step completed the intended task.',
        evidenceRef: 'trace-fill',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T03:00:04.000Z',
    });
    traces.append({
      traceId: 'trace-click',
      taskId: 'task-1',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T03:00:05.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T03:00:06.000Z',
      durationMs: 1000,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.95,
        reasonCode: 'ai_verified_submit',
        summary: 'AI verified the submit step completed the intended task.',
        evidenceRef: 'trace-click',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T03:00:06.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:00:07.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 3,
      skippedTraceCount: 0,
      rejectedSensitiveSequenceCount: 0,
      savedExperienceCount: 1,
      nextCursorCreatedAt: '2026-06-06T03:00:06.000Z',
    });
    const recipe = experience.get(result.experienceIds[0])!;
    expect(recipe).toMatchObject({
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      redactionState: 'template_only',
      successCount: 1,
      failureCount: 0,
      importState: 'native',
      exportState: 'not_exportable',
    });
    expect(recipe.linkedKnowledgeIds).toEqual([model.knowledgeId]);
    expect(recipe.sourceTraceIds).toEqual(['trace-read', 'trace-fill', 'trace-click']);
    expect(JSON.stringify(recipe.steps)).toContain('{{inputText}}');
    expect(JSON.stringify(recipe.steps)).not.toContain('hunter2');
    expect(JSON.stringify(recipe.steps)).not.toContain('[redacted]');
    expect(JSON.stringify(experience.exportRecipe(recipe.experienceId))).not.toContain(
      'trace-fill',
    );
  });

  it('mines a reusable card-collection recipe after high-confidence AI feedback', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const collectTrace = traces.append({
      traceId: 'trace-collect-cards',
      taskId: 'task-card-collection',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, maxScrolls: 4, startFromTop: true },
      requestAt: '2026-06-06T03:10:01.000Z',
      response: {
        payloadDigest: {
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedLabels: ['图文', '最多收藏', '一周内'],
          },
          collection: { startFromTop: true },
        },
      },
      responseAt: '2026-06-06T03:10:02.000Z',
      durationMs: 1200,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards',
        summary: 'AI verified that the result-card collection returned the requested top 10 cards.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:10:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(collectTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:10:03.000Z' });

    expect(result.savedExperienceCount).toBe(1);
    const recipes = experience.findByScenario(`mke:example.test:${pageModelKey}`);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]?.steps).toEqual([
      {
        order: 1,
        toolName: 'chrome_collect_result_cards',
        argsTemplate: {
          tab: '{{targetTabId}}',
          minResults: '{{minResults}}',
          maxScrolls: '{{maxScrolls}}',
          startFromTop: '{{startFromTop}}',
        },
        reuseProfile: {
          minResults: 10,
          maxScrolls: 4,
          startFromTop: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedLabels: ['图文', '最多收藏', '一周内'],
          },
        },
      },
    ]);
    expect(recipes[0]?.variableSchema).toMatchObject({
      minResults: { type: 'number', required: false, default: 10 },
      maxScrolls: { type: 'number', required: false },
      startFromTop: { type: 'boolean', required: false, default: true },
    });
    expect(recipes[0]?.successCheck).toMatchObject({
      collectResultCards: [
        {
          toolName: 'chrome_collect_result_cards',
          observedResultCountAtLeast: 10,
          selectedDataSource: 'visible_dom_result_cards',
          requiredStatus: 'complete_enough',
        },
      ],
    });
  });

  it('rejects successful paths with task-critical steps that are not yet templated', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    try {
      const readTrace = traces.append({
        traceId: 'trace-keyboard-read',
        taskId: 'task-keyboard-submit',
        toolName: 'chrome_read_page',
        requestParams: { tabId: 9 },
        requestAt: '2026-06-06T03:30:01.000Z',
        response: { payloadDigest: { summary: { quality: 'usable' } } },
        responseAt: '2026-06-06T03:30:02.000Z',
        durationMs: 1000,
        toolSuccess: true,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.93,
          reasonCode: 'ai_verified_search_box',
          summary: 'AI verified that the page read found the search box needed for this task.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'ready',
        createdAt: '2026-06-06T03:30:02.000Z',
      });
      addKnowledge({
        knowledge,
        siteFamily: 'example.test',
        pageModelKey: buildMkePageModelKey(readTrace)!,
        pageRole: 'search_results',
        pageUrlPattern: 'https://example.test/search',
      });
      traces.append({
        traceId: 'trace-keyboard-fill',
        taskId: 'task-keyboard-submit',
        toolName: 'chrome_fill_or_select',
        requestParams: { tabId: 9, ref: 'search-input', value: '[redacted]' },
        requestAt: '2026-06-06T03:30:03.000Z',
        response: { payloadDigest: { success: true } },
        responseAt: '2026-06-06T03:30:04.000Z',
        durationMs: 1000,
        toolSuccess: true,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.94,
          reasonCode: 'ai_verified_query_fill',
          summary: 'AI verified the query text was entered into the intended search field.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'ready',
        createdAt: '2026-06-06T03:30:04.000Z',
      });
      traces.append({
        traceId: 'trace-keyboard-enter',
        taskId: 'task-keyboard-submit',
        toolName: 'chrome_keyboard',
        requestParams: { tabId: 9, key: 'Enter' },
        requestAt: '2026-06-06T03:30:05.000Z',
        response: { payloadDigest: { success: true } },
        responseAt: '2026-06-06T03:30:06.000Z',
        durationMs: 1000,
        toolSuccess: true,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.95,
          reasonCode: 'ai_verified_keyboard_submit',
          summary: 'AI verified that pressing Enter submitted the search query.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'ready',
        createdAt: '2026-06-06T03:30:06.000Z',
      });
      traces.append({
        traceId: 'trace-keyboard-collect',
        taskId: 'task-keyboard-submit',
        toolName: 'chrome_collect_result_cards',
        requestParams: { tabId: 9, minResults: 10 },
        requestAt: '2026-06-06T03:30:07.000Z',
        response: {
          payloadDigest: {
            success: true,
            observedResultCount: 10,
            selectedDataSource: 'visible_dom_result_cards',
          },
        },
        responseAt: '2026-06-06T03:30:08.000Z',
        durationMs: 1000,
        toolSuccess: true,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.94,
          reasonCode: 'ai_verified_result_cards',
          summary: 'AI verified that result-card collection returned the requested card set.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'complete',
        createdAt: '2026-06-06T03:30:08.000Z',
      });

      const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:30:09.000Z' });

      expect(result).toMatchObject({
        processedTraceCount: 4,
        rejectedUnreplayableQualityTraceCount: 1,
        savedExperienceCount: 0,
      });
      expect(experience.count()).toBe(0);
    } finally {
      opened.db.close();
    }
  });

  it('rejects a path when a task-meaningful browser sensing step is not AI-reviewed', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    traces.append({
      traceId: 'trace-task-screenshot-unreviewed',
      taskId: 'task-card-collection-with-unreviewed-sensing',
      toolName: 'chrome_screenshot',
      taskIntent: '用户任务中确认筛选后的结果区是否已经出现',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T03:12:01.000Z',
      response: { payloadDigest: { captured: true } },
      responseAt: '2026-06-06T03:12:02.000Z',
      durationMs: 500,
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:12:02.000Z',
    });
    const collectTrace = traces.append({
      traceId: 'trace-reviewed-collect-cards',
      taskId: 'task-card-collection-with-unreviewed-sensing',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, maxScrolls: 4, startFromTop: true },
      requestAt: '2026-06-06T03:12:03.000Z',
      response: {
        payloadDigest: {
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          collection: { startFromTop: true },
        },
      },
      responseAt: '2026-06-06T03:12:04.000Z',
      durationMs: 1200,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards',
        summary: 'AI verified that the result-card collection returned the requested top 10 cards.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:12:04.000Z',
    });
    const pageModelKey = buildMkePageModelKey(collectTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:12:05.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 2,
      missingAiFeedbackTraceCount: 1,
      savedExperienceCount: 0,
      experienceIds: [],
    });
    expect(experience.count()).toBe(0);
  });

  it('rejects high-confidence AI feedback when the trace is a verification-blocked page', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const blockedTrace = traces.append({
      traceId: 'trace-captcha-collect',
      taskId: 'task-captcha-collect',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, maxScrolls: 4, startFromTop: true },
      requestAt: '2026-06-06T03:15:01.000Z',
      response: {
        payloadDigest: {
          success: true,
          status: 'login_required',
          observedResultCount: 10,
          page: {
            url: 'https://content.example/website-login/captcha',
            title: '安全验证',
          },
        },
      },
      responseAt: '2026-06-06T03:15:02.000Z',
      durationMs: 1200,
      toolSuccess: true,
      businessSuccess: 'unknown',
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.95,
        reasonCode: 'ai_mistaken_success_on_blocked_page',
        summary: 'AI incorrectly claimed the blocked verification page produced valid results.',
      }),
      tabId: 9,
      siteFamily: 'content.example',
      pageUrlPattern: 'https://content.example/website-login/captcha',
      pageRole: 'search_results',
      pageState: 'restricted',
      createdAt: '2026-06-06T03:15:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(blockedTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'content.example',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://content.example/website-login/captcha',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:15:03.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 1,
      savedExperienceCount: 0,
      experienceIds: [],
    });
    expect(experience.count()).toBe(0);
  });

  it('reports a unique saved experience when multiple traces upsert the same card recipe', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const firstTrace = traces.append({
      traceId: 'trace-collect-cards-a',
      taskId: 'task-card-collection-a',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, maxScrolls: 4, startFromTop: true },
      requestAt: '2026-06-06T03:20:01.000Z',
      response: {
        payloadDigest: {
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedLabels: ['图文', '最多收藏', '一周内'],
          },
          collection: { startFromTop: true },
        },
      },
      responseAt: '2026-06-06T03:20:02.000Z',
      durationMs: 1200,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards',
        summary: 'AI verified that the result-card collection returned the requested top 10 cards.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:20:02.000Z',
    });
    const secondTrace = traces.append({
      traceId: 'trace-collect-cards-b',
      taskId: 'task-card-collection-b',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, maxScrolls: 4, startFromTop: true },
      requestAt: '2026-06-06T03:20:03.000Z',
      response: {
        payloadDigest: {
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedLabels: ['图文', '最多收藏', '一周内'],
          },
          collection: { startFromTop: true },
        },
      },
      responseAt: '2026-06-06T03:20:04.000Z',
      durationMs: 1100,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.94,
        reasonCode: 'ai_verified_top10_cards_repeat',
        summary: 'AI verified a repeated top 10 card collection on the same page model.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:20:04.000Z',
    });
    const pageModelKey = buildMkePageModelKey(firstTrace)!;
    expect(buildMkePageModelKey(secondTrace)).toBe(pageModelKey);
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:20:05.000Z' });

    expect(result.savedExperienceCount).toBe(1);
    expect(result.experienceIds).toHaveLength(1);
    const recipes = experience.findByScenario(`mke:example.test:${pageModelKey}`);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]?.sourceTraceIds).toEqual(['trace-collect-cards-a', 'trace-collect-cards-b']);
    expect(recipes[0]?.successCount).toBe(2);
    expect(recipes[0]?.reliabilityScore).toBe(1);
    expect(recipes[0]?.driftState).toBe('verified_once');
    expect(recipes[0]?.lastVerifiedAt).toBe('2026-06-06T03:20:05.000Z');
    expect(recipes[0]?.successCheck).toMatchObject({
      collectResultCards: [
        {
          observedResultCountAtLeast: 10,
          selectedDataSource: 'visible_dom_result_cards',
          requiredStatus: 'complete_enough',
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
          },
        },
      ],
    });

    const replayResult = projector.projectIdleBatch({ nowIso: '2026-06-06T03:20:06.000Z' });
    expect(replayResult.savedExperienceCount).toBe(1);
    const replayedRecipes = experience.findByScenario(`mke:example.test:${pageModelKey}`);
    expect(replayedRecipes[0]?.successCount).toBe(2);
    expect(replayedRecipes[0]?.reliabilityScore).toBe(1);
    expect(replayedRecipes[0]?.driftState).toBe('verified_once');
    expect(replayedRecipes[0]?.lastVerifiedAt).toBe('2026-06-06T03:20:05.000Z');
  });

  it('keeps a single AI-reviewed card collection as an unverified template', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const trace = traces.append({
      traceId: 'trace-collect-cards-once',
      taskId: 'task-card-collection-once',
      toolName: 'chrome_collect_result_cards',
      requestParams: { tabId: 9, minResults: 10, startFromTop: true },
      requestAt: '2026-06-06T03:22:01.000Z',
      response: {
        payloadDigest: {
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedLabels: ['图文', '最多收藏', '一周内'],
          },
          collection: { startFromTop: true },
        },
      },
      responseAt: '2026-06-06T03:22:02.000Z',
      durationMs: 900,
      toolSuccess: true,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards_once',
        summary: 'AI verified that one top 10 card collection completed the requested task.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'complete',
      createdAt: '2026-06-06T03:22:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(trace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T03:22:03.000Z' });
    const recipe = experience.get(result.experienceIds[0])!;

    expect(recipe.successCount).toBe(1);
    expect(recipe.reliabilityScore).toBe(1);
    expect(recipe.driftState).toBe('unverified_template');
    expect(recipe.lastVerifiedAt).toBeNull();
    expect(recipe.successCheck).toMatchObject({
      collectResultCards: [
        {
          filterState: {
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
          },
        },
      ],
    });
  });

  it('rejects raw-sensitive chains and does not persist an Experience recipe', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const unsafeTrace = traces.append({
      traceId: 'trace-cookie',
      taskId: 'task-raw',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 3, cookie: 'session=secret' },
      requestAt: '2026-06-06T04:00:01.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T04:00:02.000Z',
      toolSuccess: true,
      tabId: 3,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/settings',
      pageRole: 'settings',
      pageState: 'ready',
      redactionState: 'contains_raw_values',
      createdAt: '2026-06-06T04:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(unsafeTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'settings',
      pageUrlPattern: 'https://example.test/settings',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T04:00:03.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 1,
      skippedTraceCount: 1,
      rejectedSensitiveSequenceCount: 1,
      savedExperienceCount: 0,
      experienceIds: [],
    });
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it('does not mine a recipe when actions only have tool success without AI approval', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-unproven',
      taskId: 'task-unproven',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T06:00:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T06:00:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T06:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-click-unproven',
      taskId: 'task-unproven',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T06:00:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T06:00:04.000Z',
      toolSuccess: true,
      businessSuccess: 'unknown',
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T06:00:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T06:00:05.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 2,
      skippedTraceCount: 2,
      savedExperienceCount: 0,
      experienceIds: [],
    });
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it('does not mine a recipe when only the final action has AI feedback', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-ai-feedback',
      taskId: 'task-ai-feedback',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T07:00:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T07:00:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T07:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-click-ai-feedback',
      taskId: 'task-ai-feedback',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T07:00:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T07:00:04.000Z',
      toolSuccess: true,
      businessSuccess: 'unknown',
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified that the expected result appeared.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T07:00:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T07:00:05.000Z' });

    expect(result).toMatchObject({
      processedTraceCount: 2,
      savedExperienceCount: 0,
      experienceIds: [],
    });
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it.each([
    {
      label: 'slow action',
      actionTraceId: 'trace-click-slow',
      requestParams: { tabId: 9, ref: 'submit-button' },
      durationMs: 45_000,
    },
    {
      label: 'coordinate-dependent action',
      actionTraceId: 'trace-click-coordinate',
      requestParams: { tabId: 9, x: 120, y: 240 },
      durationMs: 1000,
    },
    {
      label: 'fallback action',
      actionTraceId: 'trace-click-fallback',
      requestParams: { tabId: 9, ref: 'submit-button' },
      durationMs: 1000,
      fallbackUsed: 'coordinate_fallback',
    },
    {
      label: 'action without stable target',
      actionTraceId: 'trace-click-no-target',
      requestParams: { tabId: 9 },
      durationMs: 1000,
    },
  ])('does not mine a recipe from AI-approved but unreplayable quality path: $label', (variant) => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    try {
      const readTrace = traces.append({
        traceId: `trace-read-${variant.actionTraceId}`,
        taskId: `task-${variant.actionTraceId}`,
        toolName: 'chrome_read_page',
        requestParams: { tabId: 9 },
        requestAt: '2026-06-06T07:30:01.000Z',
        response: { payloadDigest: { summary: { quality: 'usable' } } },
        responseAt: '2026-06-06T07:30:02.000Z',
        durationMs: 1000,
        toolSuccess: true,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.94,
          reasonCode: 'ai_verified_page_read',
          summary: 'AI verified the page read supplied the objects needed for this task.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/editor',
        pageRole: 'content_editor',
        pageState: 'ready',
        createdAt: '2026-06-06T07:30:02.000Z',
      });
      const pageModelKey = buildMkePageModelKey(readTrace)!;
      addKnowledge({
        knowledge,
        siteFamily: 'example.test',
        pageModelKey,
        pageRole: 'content_editor',
        pageUrlPattern: 'https://example.test/editor',
      });
      traces.append({
        traceId: variant.actionTraceId,
        taskId: `task-${variant.actionTraceId}`,
        toolName: 'chrome_click_element',
        requestParams: variant.requestParams,
        requestAt: '2026-06-06T07:30:03.000Z',
        response: { payloadDigest: { success: true } },
        responseAt: '2026-06-06T07:30:04.000Z',
        durationMs: variant.durationMs,
        toolSuccess: true,
        fallbackUsed: variant.fallbackUsed,
        aiFeedback: verifiedExperienceFeedback({
          confidence: 0.95,
          reasonCode: 'ai_verified_result',
          summary: 'AI verified the action completed the visible task outcome successfully.',
        }),
        tabId: 9,
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/editor',
        pageRole: 'content_editor',
        pageState: 'ready',
        createdAt: '2026-06-06T07:30:04.000Z',
      });

      const result = projector.projectIdleBatch({ nowIso: '2026-06-06T07:30:05.000Z' });

      expect(result).toMatchObject({
        processedTraceCount: 2,
        savedExperienceCount: 0,
        experienceIds: [],
      });
      expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
    } finally {
      opened.db.close();
    }
  });

  it('anchors AI-approved actions to the nearest same-tab page context across task ids', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-cross-task',
      taskId: 'task-read-context',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T07:10:01.000Z',
      response: { payloadDigest: { summary: { pageRole: 'search_results' } } },
      responseAt: '2026-06-06T07:10:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T07:10:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });
    traces.append({
      traceId: 'trace-click-cross-task',
      taskId: 'task-click-action',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'result-card-title' },
      requestAt: '2026-06-06T07:10:03.000Z',
      response: {
        payloadDigest: {
          success: true,
          observedOutcome: 'spa_route_change',
          _tabrix: {
            feedbackTarget: {
              traceId: 'trace-click-cross-task',
              feedbackToken: 'internal-binding-token',
            },
            actionEvidenceResult: {
              taskSessionId: 'internal-task-context',
            },
            taskContextEnvelope: {
              taskTotals: {
                tokensSavedEstimateTotal: 1200,
              },
            },
          },
        },
      },
      responseAt: '2026-06-06T07:10:04.000Z',
      toolSuccess: true,
      businessSuccess: 'unknown',
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.93,
        reasonCode: 'ai_verified_detail_opened',
        summary: 'AI verified that clicking the result opened the detail page.',
      }),
      tabId: 9,
      createdAt: '2026-06-06T07:10:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T07:10:05.000Z' });

    expect(result.savedExperienceCount).toBe(1);
    const recipes = experience.findByScenario(`mke:example.test:${pageModelKey}`);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]?.sourceTraceIds).toEqual(['trace-click-cross-task']);
  });

  it('does not mine a recipe from automatic evidence feedback alone', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-auto-feedback',
      taskId: 'task-auto-feedback',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T08:00:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T08:00:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T08:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-click-auto-feedback',
      taskId: 'task-auto-feedback',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T08:00:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T08:00:04.000Z',
      toolSuccess: true,
      businessSuccess: 'unknown',
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T08:00:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T08:00:05.000Z' });

    expect(result.savedExperienceCount).toBe(0);
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it('does not mine a recipe from Tabrix success evidence without real AI feedback', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-system-only-success',
      taskId: 'task-system-only-success',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T08:30:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T08:30:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T08:30:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-click-system-only-success',
      taskId: 'task-system-only-success',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T08:30:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T08:30:04.000Z',
      toolSuccess: true,
      businessSuccess: 'achieved',
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T08:30:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T08:30:05.000Z' });

    expect(result.savedExperienceCount).toBe(0);
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it('does not let AI approval override a hard negative business status', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-failed-business',
      taskId: 'task-failed-business',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 9 },
      requestAt: '2026-06-06T09:00:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T09:00:02.000Z',
      toolSuccess: true,
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T09:00:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'content_editor',
      pageUrlPattern: 'https://example.test/editor',
    });
    traces.append({
      traceId: 'trace-click-failed-business',
      taskId: 'task-failed-business',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 9, ref: 'submit-button' },
      requestAt: '2026-06-06T09:00:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T09:00:04.000Z',
      toolSuccess: true,
      businessSuccess: 'not_achieved',
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.98,
        reasonCode: 'ai_verified_result',
        summary: 'AI incorrectly verified the result despite a hard negative status.',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T09:00:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T09:00:05.000Z' });

    expect(result.savedExperienceCount).toBe(0);
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });

  it('does not mine recipes from orphan AI score without feedback confidence', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    const traces = new MemoryTraceRepository(opened.db);
    const knowledge = new KnowledgeModelRepository(opened.db);
    const experience = new ExperienceRecipeRepository(opened.db);
    const projector = new MkeExperienceProjector(traces, knowledge, experience);

    const readTrace = traces.append({
      traceId: 'trace-read-orphan-score',
      taskId: 'task-orphan-score',
      toolName: 'chrome_read_page',
      requestParams: { tabId: 10 },
      requestAt: '2026-06-06T09:10:01.000Z',
      response: { payloadDigest: { summary: { quality: 'usable' } } },
      responseAt: '2026-06-06T09:10:02.000Z',
      toolSuccess: true,
      tabId: 10,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T09:10:02.000Z',
    });
    const pageModelKey = buildMkePageModelKey(readTrace)!;
    addKnowledge({
      knowledge,
      siteFamily: 'example.test',
      pageModelKey,
      pageRole: 'search_results',
      pageUrlPattern: 'https://example.test/search',
    });
    traces.append({
      traceId: 'trace-click-orphan-score',
      taskId: 'task-orphan-score',
      toolName: 'chrome_click_element',
      requestParams: { tabId: 10, ref: 'result-card' },
      requestAt: '2026-06-06T09:10:03.000Z',
      response: { payloadDigest: { success: true } },
      responseAt: '2026-06-06T09:10:04.000Z',
      toolSuccess: true,
      businessSuccess: 'achieved',
      aiFeedbackScore: 0.99,
      aiFeedback: {
        sourceKind: 'ai_feedback',
        businessStatus: 'achieved',
        reasonCode: 'missing_confidence',
        summary: 'AI evaluation is incomplete.',
      },
      tabId: 10,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/search',
      pageRole: 'search_results',
      pageState: 'ready',
      createdAt: '2026-06-06T09:10:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T09:10:05.000Z' });

    expect(result.savedExperienceCount).toBe(0);
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toEqual([]);
  });
});
