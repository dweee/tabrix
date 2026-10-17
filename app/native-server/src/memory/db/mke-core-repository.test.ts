import { openMemoryDb } from './client';
import {
  ExperienceRecipeRepository,
  KnowledgeModelRepository,
  MemoryTraceRepository,
} from './mke-core-repository';
import { BrowserObjectRepository } from './browser-object-repository';

const NOW = '2026-06-06T10:00:00.000Z';

function bootstrap(): {
  traceRepo: MemoryTraceRepository;
  browserObjectRepo: BrowserObjectRepository;
  knowledgeRepo: KnowledgeModelRepository;
  experienceRepo: ExperienceRecipeRepository;
  close: () => void;
} {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  return {
    traceRepo: new MemoryTraceRepository(db),
    browserObjectRepo: new BrowserObjectRepository(db),
    knowledgeRepo: new KnowledgeModelRepository(db),
    experienceRepo: new ExperienceRecipeRepository(db),
    close: () => db.close(),
  };
}

function templateRecipe(overrides = {}) {
  return {
    recipeName: 'publish note template',
    scenarioKey: 'content_publish',
    taskSignature: 'publish-image-note',
    recipeFingerprint: 'recipe-content-publish-v1',
    siteFamily: 'generic-content-platform',
    pageModelKey: 'creator-publish',
    pageRole: 'creator_publish',
    preconditions: { login: 'required', assets: ['image'] },
    variableSchema: { title: 'string', body: 'string' },
    steps: [
      { toolName: 'chrome_read_page', expected: 'fresh page object' },
      { toolName: 'chrome_click_element', target: 'upload affordance' },
    ],
    successCheck: { type: 'postcondition', value: 'draft or publish confirmation visible' },
    recovery: { retry: 'fresh read then same-tab target resolution' },
    sourceTraceIds: ['trace-1'],
    linkedKnowledgeIds: ['knowledge-1'],
    exportState: 'exportable',
    redactionState: 'template_only',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('MKE core repositories', () => {
  it('initializes the additive Memory, Knowledge, and Experience tables', () => {
    const { traceRepo, browserObjectRepo, close } = bootstrap();
    try {
      expect(traceRepo.count()).toBe(0);
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      close();
    }
  });

  it('upserts Browser Object facts without exposing raw object payloads as identity', () => {
    const { browserObjectRepo, close } = bootstrap();
    try {
      const first = browserObjectRepo.upsert({
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?tab=results#/week',
        pageRole: 'search_results',
        pageModelKey: 'search-results',
        objectFingerprint: 'page:example.test:search-results:7',
        objectType: 'page',
        tabId: 7,
        windowId: 1,
        ownerType: 'ai',
        sourceRoute: 'dom_snapshot',
        sourceFreshness: 'fresh',
        canTabrixOperate: true,
        facts: { regionCount: 3 },
        firstTraceId: 'trace-object-1',
        lastTraceId: 'trace-object-1',
        sourceTraceIds: ['trace-object-1'],
        redactionState: 'redacted',
        updatedAt: NOW,
      });
      const second = browserObjectRepo.upsert({
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?tab=results#/week',
        pageRole: 'search_results',
        pageModelKey: 'search-results',
        objectFingerprint: 'page:example.test:search-results:7',
        objectType: 'page',
        tabId: 7,
        windowId: 1,
        ownerType: 'ai',
        sourceRoute: 'dom_snapshot',
        sourceFreshness: 'fresh',
        canTabrixOperate: true,
        facts: { regionCount: 4 },
        firstTraceId: 'trace-object-1',
        lastTraceId: 'trace-object-2',
        sourceTraceIds: ['trace-object-1', 'trace-object-2'],
        redactionState: 'redacted',
        updatedAt: '2026-06-06T10:00:01.000Z',
      });

      expect(first.browserObjectId).toBe(second.browserObjectId);
      expect(second.observationCount).toBe(2);
      expect(second.rootRoute).toBe('https://example.test/search');
      expect(second.currentRoute).toBe('https://example.test/search?tab=results#/week');
      expect(second.facts).toEqual({ regionCount: 4 });
      expect(browserObjectRepo.count()).toBe(1);

      browserObjectRepo.archive({
        browserObjectId: second.browserObjectId,
        archivedAt: '2026-06-06T10:00:02.000Z',
      });
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      close();
    }
  });

  it('lists only redacted reusable Browser Objects for the same page model', () => {
    const { browserObjectRepo, close } = bootstrap();
    try {
      const base = {
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?q=ai',
        pageRole: 'search_results',
        pageModelKey: 'page:example.test:search_results',
        tabId: 7,
        windowId: 1,
        ownerType: 'ai',
        sourceRoute: 'chrome_read_page',
        sourceFreshness: 'fresh',
        redactionState: 'redacted',
        updatedAt: NOW,
      };

      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'action:example.test:search:submit',
        objectType: 'action_target',
        confidenceScore: 0.95,
        lastValidatedAt: '2026-06-06T11:00:00.000Z',
      });
      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'card:example.test:search:top-card',
        objectType: 'result_card',
        confidenceScore: 0.86,
      });
      browserObjectRepo.upsert({
        ...base,
        pageUrlPattern: 'https://example.test/settings',
        rootRoute: 'https://example.test/settings',
        currentRoute: 'https://example.test/settings?tab=profile',
        objectFingerprint: 'action:example.test:settings:save',
        objectType: 'action_target',
        confidenceScore: 0.99,
        lastValidatedAt: '2026-06-07T11:00:00.000Z',
      });
      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'page:example.test:search',
        objectType: 'page',
        confidenceScore: 0.99,
      });
      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'action:example.test:search:private',
        objectType: 'action_target',
        redactionState: 'raw',
      });
      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'action:example.test:search:closed',
        objectType: 'action_target',
        closedAt: NOW,
      });
      browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'action:other.test:search:submit',
        siteFamily: 'other.test',
        objectType: 'action_target',
      });
      const archived = browserObjectRepo.upsert({
        ...base,
        objectFingerprint: 'region:example.test:search:archived',
        objectType: 'region',
      });
      browserObjectRepo.archive({ browserObjectId: archived.browserObjectId, archivedAt: NOW });

      const reusable = browserObjectRepo.listReusableForPage({
        siteFamily: 'example.test',
        pageModelKey: 'page:example.test:search_results',
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?q=ai',
        pageUrlPattern: 'https://example.test/search',
      });

      expect(reusable.map((object) => object.objectFingerprint)).toEqual([
        'action:example.test:search:submit',
        'card:example.test:search:top-card',
        'action:example.test:settings:save',
      ]);
      expect(reusable.every((object) => object.redactionState === 'redacted')).toBe(true);
      expect(reusable.every((object) => object.closedAt === null)).toBe(true);
    } finally {
      close();
    }
  });

  it('preserves Browser Object source trace lineage across upserts', () => {
    const { browserObjectRepo, close } = bootstrap();
    try {
      browserObjectRepo.upsert({
        siteFamily: 'example.test',
        pageModelKey: 'search-results',
        objectFingerprint: 'page:example.test:search-results:7',
        objectType: 'page',
        facts: { filterState: { sort: 'most_liked' } },
        firstTraceId: 'trace-collect',
        lastTraceId: 'trace-collect',
        sourceTraceIds: ['trace-collect'],
        updatedAt: NOW,
      });

      const second = browserObjectRepo.upsert({
        siteFamily: 'example.test',
        pageModelKey: 'search-results',
        objectFingerprint: 'page:example.test:search-results:7',
        objectType: 'page',
        facts: { readiness: 'ready' },
        firstTraceId: 'trace-read',
        lastTraceId: 'trace-read',
        sourceTraceIds: ['trace-read'],
        updatedAt: '2026-06-06T10:00:01.000Z',
      });

      expect(second.sourceTraceIds).toEqual(['trace-collect', 'trace-read']);
      expect(second.firstTraceId).toBe('trace-collect');
      expect(second.lastTraceId).toBe('trace-read');
    } finally {
      close();
    }
  });

  it('lists Object Library surface as current and recently closed tabs', () => {
    const { browserObjectRepo, close } = bootstrap();
    try {
      const common = {
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/',
        rootRoute: 'https://example.test/',
        currentRoute: 'https://example.test/',
        ownerType: 'user',
        sourceRoute: 'chrome_windows_get_all_with_browser_world_inventory',
        sourceFreshness: 'fresh',
        canTabrixOperate: true,
        updatedAt: NOW,
      };
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'window:1',
        objectFingerprint: 'window:1',
        objectType: 'window',
        windowId: 1,
        facts: { tabCount: 1 },
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'tab:example.test',
        objectFingerprint: 'tab:1:2',
        objectType: 'tab',
        tabId: 2,
        windowId: 1,
        facts: { titleSummary: 'Example' },
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'tab:old.example.test',
        objectFingerprint: 'tab:old:1',
        objectType: 'tab',
        tabId: 1,
        windowId: 1,
        updatedAt: '2026-06-06T09:59:59.000Z',
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'tab:closed.example.test',
        objectFingerprint: 'tab:1:3',
        objectType: 'tab',
        tabId: 3,
        windowId: 1,
        lifecycleState: 'closed',
        closedAt: NOW,
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'page:example.test',
        objectFingerprint: 'page:example.test',
        objectType: 'page',
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'region:example.test',
        objectFingerprint: 'region:example.test:content',
        objectType: 'region',
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'target:example.test',
        objectFingerprint: 'target:example.test:button',
        objectType: 'action_target',
      });
      browserObjectRepo.upsert({
        ...common,
        pageModelKey: 'data-source:example.test',
        objectFingerprint: 'data-source:example.test:api',
        objectType: 'data_source',
        selectedDataSource: 'api_rows',
      });

      expect(browserObjectRepo.count()).toBe(8);
      expect(browserObjectRepo.countCurrentBrowserSurface()).toBe(2);
      expect(browserObjectRepo.countObjectLibraryGraphSurface()).toBe(7);
      expect(
        browserObjectRepo.listCurrentBrowserSurface({ limit: 10, offset: 0 }).map((object) => ({
          objectType: object.objectType,
          lifecycleState: object.lifecycleState,
        })),
      ).toEqual([
        { objectType: 'tab', lifecycleState: null },
        { objectType: 'tab', lifecycleState: 'closed' },
      ]);
      expect(
        browserObjectRepo.listObjectLibraryGraphSurface({ limit: 10, offset: 0 }).map((object) => ({
          objectType: object.objectType,
          lifecycleState: object.lifecycleState,
        })),
      ).toEqual([
        { objectType: 'window', lifecycleState: null },
        { objectType: 'tab', lifecycleState: null },
        { objectType: 'tab', lifecycleState: 'closed' },
        { objectType: 'page', lifecycleState: null },
        { objectType: 'region', lifecycleState: null },
        { objectType: 'action_target', lifecycleState: null },
        { objectType: 'data_source', lifecycleState: null },
      ]);
    } finally {
      close();
    }
  });

  it('stores append-only Memory traces with separated tool and business success', () => {
    const { traceRepo, close } = bootstrap();
    try {
      const trace = traceRepo.append({
        traceId: 'trace-1',
        taskId: 'task-1',
        taskTheme: 'creator workflow',
        taskIntent: 'publish note',
        taskSignature: 'publish-image-note',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        toolCallId: 'call-1',
        sequenceIndex: 1,
        requestParams: { tabId: 7, ref: 'button-1' },
        requestAt: NOW,
        response: { ok: true, message: 'clicked' },
        responseAt: '2026-06-06T10:00:01.000Z',
        durationMs: 1000,
        toolSuccess: true,
        businessSuccess: 'unknown',
        tabId: 7,
        windowId: 1,
        browserContextKey: 'profile-a',
        tabLifecycle: { opener: 'ai', state: 'active' },
        siteFamily: 'generic-content-platform',
        pageUrlPattern: '/creator/publish',
        pageRole: 'creator_publish',
        pageState: 'draft',
        pageModelKey: 'creator-publish',
        perceptionObjects: [{ id: 'button-1', role: 'button' }],
        actionTarget: { stableTargetRef: 'button-1' },
        preObservation: { title: 'editor' },
        postObservation: { title: 'editor' },
        postActionDelta: { kind: 'same_tab_fresh_read', changed: true },
        sourceRoute: 'extension-dom',
        selectedDataSource: 'dom',
        freshness: 'fresh',
        fallbackUsed: 'none',
        tokenPrompt: 120,
        tokenCompletion: 40,
        tokenTotal: 160,
        aiFeedbackScore: 0.75,
        aiFeedback: { useful: true },
        redactionState: 'redacted',
        createdAt: NOW,
      });

      expect(trace.toolSuccess).toBe(true);
      expect(trace.businessSuccess).toBe('unknown');
      expect(traceRepo.get('trace-1')?.requestParams).toEqual({ tabId: 7, ref: 'button-1' });
      expect(traceRepo.listByTask('task-1')).toHaveLength(1);
      expect(
        traceRepo.listByPage({
          siteFamily: 'generic-content-platform',
          pageModelKey: 'creator-publish',
        }),
      ).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('updates Memory trace AI business feedback by traceId', () => {
    const { traceRepo, close } = bootstrap();
    try {
      traceRepo.append({
        traceId: 'trace-feedback-1',
        taskId: 'task-feedback-1',
        taskIntent: 'open creator page',
        aiClient: 'jest',
        toolName: 'chrome_navigate',
        toolCallId: 'call-feedback-1',
        sequenceIndex: 1,
        requestParams: { url: 'https://example.test/creator' },
        requestAt: NOW,
        response: { success: true },
        responseAt: '2026-06-06T10:00:01.000Z',
        toolSuccess: true,
        businessSuccess: 'unknown',
        createdAt: NOW,
      });

      const updated = traceRepo.updateAiFeedback({
        traceId: 'trace-feedback-1',
        aiFeedbackScore: 0.85,
        aiFeedback: {
          reasonCode: 'target_page_opened',
          summary: '目标页面已打开',
        },
      });

      expect(updated).toMatchObject({
        traceId: 'trace-feedback-1',
        businessSuccess: 'unknown',
        aiFeedbackScore: 0.85,
        aiFeedback: {
          reasonCode: 'target_page_opened',
          summary: '目标页面已打开',
        },
      });
      expect(traceRepo.get('missing-trace')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('records AI feedback as an auditable event and updates the trace in one operation', () => {
    const { traceRepo, close } = bootstrap();
    try {
      traceRepo.append({
        traceId: 'trace-feedback-event-1',
        taskId: 'task-feedback-event-1',
        taskIntent: 'collect search results',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        toolCallId: 'call-feedback-event-1',
        sequenceIndex: 3,
        requestParams: { tabId: 7, goal: 'collect top result cards' },
        requestAt: NOW,
        response: { success: true, rows: 10 },
        responseAt: '2026-06-06T10:00:01.000Z',
        toolSuccess: true,
        businessSuccess: 'unknown',
        createdAt: NOW,
      });

      const result = traceRepo.recordAiFeedback({
        traceId: 'trace-feedback-event-1',
        aiFeedbackScore: 0.92,
        aiFeedback: {
          businessStatus: 'achieved',
          summary: '已拿到前 10 条结果卡片，适合沉淀为可复用读取步骤。',
        },
        businessSuccess: 'true',
        feedbackEvent: {
          feedbackEventId: 'feedback-event-1',
          traceId: 'trace-feedback-event-1',
          taskId: 'task-feedback-event-1',
          toolName: 'chrome_read_page',
          toolCallId: 'call-feedback-event-1',
          sequenceIndex: 3,
          traceBindingHash: 'binding-hash-1',
          evaluationScope: 'step',
          evaluationVersion: 'ai_feedback_v1',
          rubricVersion: 'tabrix_step_rubric_v1',
          evaluatorModel: 'test-evaluator',
          businessStatus: 'achieved',
          confidence: 0.92,
          reasonCode: 'result_cards_collected',
          summary: '已拿到前 10 条结果卡片，适合沉淀为可复用读取步骤。',
          userGoalSnapshot: '搜索并整理前 10 条图文内容',
          experienceCandidate: true,
          sourceToolName: 'memory_record_ai_feedback',
          sourceToolCallId: 'feedback-call-1',
          accepted: true,
          payload: {
            aiReview: 'step useful',
            reusable: true,
          },
          createdAt: '2026-06-06T10:00:02.000Z',
        },
      });

      expect(result.trace).toMatchObject({
        traceId: 'trace-feedback-event-1',
        businessSuccess: 'true',
        aiFeedbackScore: 0.92,
        aiFeedback: {
          businessStatus: 'achieved',
          summary: '已拿到前 10 条结果卡片，适合沉淀为可复用读取步骤。',
        },
      });
      expect(result.event).toMatchObject({
        feedbackEventId: 'feedback-event-1',
        traceId: 'trace-feedback-event-1',
        taskId: 'task-feedback-event-1',
        toolName: 'chrome_read_page',
        toolCallId: 'call-feedback-event-1',
        sequenceIndex: 3,
        businessStatus: 'achieved',
        experienceCandidate: true,
        accepted: true,
        payload: {
          aiReview: 'step useful',
          reusable: true,
        },
      });
      expect(traceRepo.listFeedbackEventsByTrace('trace-feedback-event-1')).toEqual([result.event]);
    } finally {
      close();
    }
  });

  it('keeps legacy Memory traces unscored until AI feedback is recorded', () => {
    const { traceRepo, close } = bootstrap();
    try {
      traceRepo.append({
        traceId: 'trace-legacy-unscored',
        taskId: 'task-legacy-unscored',
        taskIntent: 'read page before action',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        toolCallId: 'call-legacy-unscored',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAt: NOW,
        response: { success: true },
        responseAt: '2026-06-06T10:00:01.000Z',
        toolSuccess: true,
        businessSuccess: 'unknown',
        resultSummary: 'page read completed',
        createdAt: NOW,
      });

      const trace = traceRepo.get('trace-legacy-unscored');

      expect(trace).toMatchObject({
        traceId: 'trace-legacy-unscored',
        aiFeedbackScore: null,
        aiFeedback: null,
      });
    } finally {
      close();
    }
  });

  it('upserts Knowledge page models and records validation outcomes', () => {
    const { knowledgeRepo, close } = bootstrap();
    try {
      const model = knowledgeRepo.upsert({
        knowledgeId: 'knowledge-1',
        siteFamily: 'generic-content-platform',
        pageUrlPattern: '/creator/publish',
        pageRole: 'creator_publish',
        pageModelKey: 'creator-publish',
        pageStateModel: { states: ['draft', 'submitted'] },
        objectGraph: { regions: ['editor', 'toolbar'] },
        actionSurface: { actions: ['upload', 'submit'] },
        dataSourceModel: { dom: true, api: false },
        sourceTraceIds: ['trace-1'],
        observationCount: 1,
        confidenceScore: 0.5,
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(model.objectGraph).toEqual({ regions: ['editor', 'toolbar'] });
      expect(
        knowledgeRepo.findLatestByPage({
          siteFamily: 'generic-content-platform',
          pageModelKey: 'creator-publish',
        })?.knowledgeId,
      ).toBe('knowledge-1');

      knowledgeRepo.markValidated({
        knowledgeId: 'knowledge-1',
        successful: true,
        confidenceScore: 0.7,
        nowIso: '2026-06-06T10:05:00.000Z',
      });

      const validated = knowledgeRepo.get('knowledge-1');
      expect(validated?.successfulUseCount).toBe(1);
      expect(validated?.confidenceScore).toBe(0.7);

      knowledgeRepo.markValidated({
        knowledgeId: 'knowledge-1',
        successful: false,
        confidenceScore: 0.5,
        nowIso: '2026-06-06T10:05:30.000Z',
      });

      const reprojected = knowledgeRepo.upsert({
        knowledgeId: 'replacement-id-must-not-win',
        siteFamily: 'generic-content-platform',
        pageUrlPattern: '/creator/publish?fresh=1',
        pageRole: 'creator_publish',
        pageModelKey: 'creator-publish',
        pageStateModel: { states: ['submitted'] },
        objectGraph: { regions: ['editor', 'toolbar', 'result'] },
        actionSurface: { actions: ['submit'] },
        sourceTraceIds: ['trace-2'],
        observationCount: 2,
        successfulUseCount: 0,
        failedUseCount: 0,
        confidenceScore: 0.1,
        createdAt: '2026-06-06T10:06:00.000Z',
        updatedAt: '2026-06-06T10:06:00.000Z',
      });
      expect(reprojected.knowledgeId).toBe('knowledge-1');
      expect(reprojected.successfulUseCount).toBe(1);
      expect(reprojected.failedUseCount).toBe(1);
      expect(reprojected.confidenceScore).toBe(0.5);
      expect(reprojected.lastValidatedAt).toBe('2026-06-06T10:05:30.000Z');
      expect(reprojected.objectGraph).toEqual({ regions: ['editor', 'toolbar', 'result'] });

      knowledgeRepo.archive({
        knowledgeId: 'knowledge-1',
        archivedAt: '2026-06-06T10:06:00.000Z',
      });
      expect(
        knowledgeRepo.findLatestByPage({
          siteFamily: 'generic-content-platform',
          pageModelKey: 'creator-publish',
        }),
      ).toBeUndefined();
    } finally {
      close();
    }
  });

  it('saves Experience recipes, records outcomes, and exports only redacted templates', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const recipe = experienceRepo.save(templateRecipe());
      expect(recipe.sourceTraceIds).toEqual(['trace-1']);
      expect(experienceRepo.findByScenario('content_publish')).toHaveLength(1);

      experienceRepo.recordUseOutcome({
        experienceId: recipe.experienceId,
        successful: true,
        adopted: true,
        nowIso: '2026-06-06T10:10:00.000Z',
      });

      const used = experienceRepo.get(recipe.experienceId);
      expect(used?.successCount).toBe(1);
      expect(used?.adoptionCount).toBe(1);
      expect(used?.lastUsedAt).toBe('2026-06-06T10:10:00.000Z');

      experienceRepo.recordUseOutcome({
        experienceId: recipe.experienceId,
        successful: false,
        adopted: false,
        nowIso: '2026-06-06T10:11:00.000Z',
      });
      const failedReuse = experienceRepo.get(recipe.experienceId);
      expect(failedReuse?.successCount).toBe(1);
      expect(failedReuse?.failureCount).toBe(1);
      expect(failedReuse?.reliabilityScore).toBe(0.5);
      expect(failedReuse?.driftState).toBe('needs_revalidation');
      expect(failedReuse?.lastVerifiedAt).toBeNull();

      const exported = experienceRepo.exportRecipe(recipe.experienceId);
      expect(exported).toBeDefined();
      expect(JSON.stringify(exported)).not.toContain('trace-1');

      expect(() =>
        experienceRepo.save(
          templateRecipe({
            experienceId: 'experience-raw',
            recipeFingerprint: 'recipe-raw',
            redactionState: 'contains_raw_values',
          }),
        ),
      ).toThrow('TABRIX_EXPERIENCE_TEMPLATE_ONLY');
    } finally {
      close();
    }
  });

  it('merges Experience recipe sources when the same recipe is re-mined', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const first = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-1'],
          successCount: 1,
          linkedKnowledgeIds: ['knowledge-1'],
        }),
      );
      const second = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-2'],
          successCount: 1,
          linkedKnowledgeIds: ['knowledge-2'],
          updatedAt: '2026-06-06T10:01:00.000Z',
        }),
      );

      expect(second.experienceId).toBe(first.experienceId);
      expect(second.sourceTraceIds).toEqual(['trace-1', 'trace-2']);
      expect(second.linkedKnowledgeIds).toEqual(['knowledge-1', 'knowledge-2']);
      expect(second.successCount).toBe(2);
      expect(experienceRepo.findByScenario('content_publish')).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('does not count later steps from the same evidence sequence as another success', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const first = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-run-1-read', 'trace-run-1-click'],
          successCount: 1,
        }),
      );
      const expandedSameRun = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-run-1-read', 'trace-run-1-click', 'trace-run-1-verify'],
          successCount: 1,
          updatedAt: '2026-06-06T10:01:00.000Z',
        }),
      );
      const independentRun = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-run-2-read', 'trace-run-2-click', 'trace-run-2-verify'],
          successCount: 1,
          updatedAt: '2026-06-06T10:02:00.000Z',
        }),
      );

      expect(expandedSameRun.experienceId).toBe(first.experienceId);
      expect(expandedSameRun.successCount).toBe(1);
      expect(expandedSameRun.sourceTraceIds).toEqual([
        'trace-run-1-read',
        'trace-run-1-click',
        'trace-run-1-verify',
      ]);
      expect(independentRun.successCount).toBe(2);
      expect(independentRun.driftState).toBe('verified_once');
    } finally {
      close();
    }
  });

  it('counts and removes Experience evidence once per Memory task', () => {
    const { traceRepo, experienceRepo, close } = bootstrap();
    try {
      const appendTrace = (traceId: string, taskId: string, sequenceIndex: number) =>
        traceRepo.append({
          traceId,
          taskId,
          toolName: 'chrome_read_page',
          toolCallId: `${traceId}-call`,
          sequenceIndex,
          requestParams: {},
          requestAt: NOW,
          response: { ok: true },
          responseAt: NOW,
          durationMs: 0,
          toolSuccess: true,
          businessSuccess: 'achieved',
          redactionState: 'redacted',
          createdAt: NOW,
        });
      appendTrace('trace-task-a-read', 'task-a', 1);
      appendTrace('trace-task-a-click', 'task-a', 2);
      appendTrace('trace-task-b-read', 'task-b', 1);

      const recipe = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-task-a-read'],
          successCount: 1,
        }),
      );
      const sameTask = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-task-a-click'],
          successCount: 1,
          updatedAt: '2026-06-06T10:01:00.000Z',
        }),
      );
      const secondTask = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-task-b-read'],
          successCount: 1,
          updatedAt: '2026-06-06T10:02:00.000Z',
        }),
      );

      expect(sameTask.successCount).toBe(1);
      expect(secondTask.successCount).toBe(2);

      experienceRepo.removeSourceTrace({
        traceId: 'trace-task-a-read',
        nowIso: '2026-06-06T10:03:00.000Z',
      });
      expect(experienceRepo.get(recipe.experienceId)?.successCount).toBe(2);

      experienceRepo.removeSourceTrace({
        traceId: 'trace-task-a-click',
        nowIso: '2026-06-06T10:04:00.000Z',
      });
      expect(experienceRepo.get(recipe.experienceId)?.successCount).toBe(1);
    } finally {
      close();
    }
  });

  it('removes AI-vetoed source traces from mined Experience recipes', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const first = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-1'],
          successCount: 1,
          driftState: 'unverified_template',
          linkedKnowledgeIds: ['knowledge-1'],
        }),
      );
      experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-2'],
          successCount: 1,
          driftState: 'unverified_template',
          linkedKnowledgeIds: ['knowledge-2'],
          updatedAt: '2026-06-06T10:01:00.000Z',
        }),
      );

      const result = experienceRepo.removeSourceTrace({
        traceId: 'trace-2',
        nowIso: '2026-06-06T10:02:00.000Z',
      });
      const updated = experienceRepo.get(first.experienceId);

      expect(result).toEqual({
        updatedCount: 1,
        archivedCount: 0,
        affectedExperienceIds: [first.experienceId],
      });
      expect(updated?.sourceTraceIds).toEqual(['trace-1']);
      expect(updated?.successCount).toBe(1);
      expect(updated?.driftState).toBe('unverified_template');
      expect(updated?.archivedAt).toBeNull();
    } finally {
      close();
    }
  });

  it('archives Experience recipes when AI veto removes the last source trace', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const recipe = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-only'],
          successCount: 1,
          linkedKnowledgeIds: ['knowledge-1'],
        }),
      );

      const result = experienceRepo.removeSourceTrace({
        traceId: 'trace-only',
        nowIso: '2026-06-06T10:03:00.000Z',
      });
      const archived = experienceRepo.get(recipe.experienceId);

      expect(result).toEqual({
        updatedCount: 1,
        archivedCount: 1,
        affectedExperienceIds: [recipe.experienceId],
      });
      expect(archived?.sourceTraceIds).toEqual([]);
      expect(archived?.successCount).toBe(0);
      expect(archived?.driftState).toBe('ai_rejected');
      expect(archived?.archivedAt).toBe('2026-06-06T10:03:00.000Z');
      expect(experienceRepo.listRecent({ limit: 10 })).toHaveLength(0);
      expect(experienceRepo.count()).toBe(0);
    } finally {
      close();
    }
  });

  it('requires current-page revalidation for same-scenario verified Experience after later AI partial feedback', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const recipe = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-success-1', 'trace-success-2'],
          successCount: 2,
          failureCount: 0,
          reliabilityScore: 1,
          driftState: 'verified_once',
          lastVerifiedAt: '2026-06-06T10:01:00.000Z',
        }),
      );

      expect(
        experienceRepo.findReusableByContext({
          siteFamily: 'generic-content-platform',
          pageRole: 'creator_publish',
          limit: 5,
        }),
      ).toHaveLength(1);

      const result = experienceRepo.requireScenarioRevalidation({
        scenarioKey: 'content_publish',
        nowIso: '2026-06-06T10:04:00.000Z',
      });
      const updated = experienceRepo.get(recipe.experienceId);

      expect(result).toEqual({
        updatedCount: 1,
        archivedCount: 0,
        affectedExperienceIds: [recipe.experienceId],
      });
      expect(updated).toMatchObject({
        failureCount: 1,
        reliabilityScore: 0.6667,
        driftState: 'needs_revalidation',
        archivedAt: null,
        lastVerifiedAt: null,
        updatedAt: '2026-06-06T10:04:00.000Z',
      });
      expect(
        experienceRepo.findReusableByContext({
          siteFamily: 'generic-content-platform',
          pageRole: 'creator_publish',
          limit: 5,
        }),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('requires revalidation after a failed source is removed from an unverified recipe', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const recipe = experienceRepo.save(
        templateRecipe({
          sourceTraceIds: ['trace-success', 'trace-failed'],
          successCount: 1,
          failureCount: 0,
          reliabilityScore: 1,
          driftState: 'unverified_template',
        }),
      );

      experienceRepo.removeSourceTrace({
        traceId: 'trace-failed',
        nowIso: '2026-06-06T10:05:00.000Z',
      });
      const result = experienceRepo.requireScenarioRevalidation({
        scenarioKey: 'content_publish',
        nowIso: '2026-06-06T10:05:01.000Z',
      });
      const updated = experienceRepo.get(recipe.experienceId);

      expect(result.affectedExperienceIds).toEqual([recipe.experienceId]);
      expect(updated?.driftState).toBe('needs_revalidation');
      expect(updated?.failureCount).toBe(1);
      expect(
        experienceRepo.findReusableByContext({
          siteFamily: 'generic-content-platform',
          pageRole: 'creator_publish',
        }),
      ).toHaveLength(0);
    } finally {
      close();
    }
  });

  it('does not punish a direct-source Experience twice during explicit scenario revalidation', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const directSource = experienceRepo.save(
        templateRecipe({
          recipeFingerprint: 'direct-source-recipe',
          sourceTraceIds: ['trace-direct', 'trace-direct-backup'],
          successCount: 2,
          failureCount: 0,
          reliabilityScore: 1,
          driftState: 'verified_once',
        }),
      );
      const sameScenarioSibling = experienceRepo.save(
        templateRecipe({
          recipeFingerprint: 'same-scenario-sibling-recipe',
          sourceTraceIds: ['trace-sibling-1', 'trace-sibling-2'],
          successCount: 2,
          failureCount: 0,
          reliabilityScore: 1,
          driftState: 'verified_once',
        }),
      );

      const sourceResult = experienceRepo.removeSourceTrace({
        traceId: 'trace-direct',
        nowIso: '2026-06-06T10:06:00.000Z',
      });
      const scenarioResult = experienceRepo.requireScenarioRevalidation({
        scenarioKey: 'content_publish',
        nowIso: '2026-06-06T10:06:01.000Z',
        excludeExperienceIds: sourceResult.affectedExperienceIds,
      });

      expect(sourceResult.affectedExperienceIds).toEqual([directSource.experienceId]);
      expect(scenarioResult.affectedExperienceIds).toEqual([sameScenarioSibling.experienceId]);
      expect(experienceRepo.get(directSource.experienceId)).toMatchObject({
        successCount: 1,
        failureCount: 0,
      });
      expect(experienceRepo.get(sameScenarioSibling.experienceId)).toMatchObject({
        successCount: 2,
        failureCount: 1,
        driftState: 'needs_revalidation',
      });
    } finally {
      close();
    }
  });

  it('rejects Experience templates that contain raw-sensitive fields', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      expect(() =>
        experienceRepo.save(
          templateRecipe({
            experienceId: 'experience-cookie',
            recipeFingerprint: 'recipe-cookie',
            steps: [
              {
                toolName: 'chrome_fill_form',
                capturedValues: {
                  cookie: 'session=raw-value',
                },
              },
            ],
          }),
        ),
      ).toThrow('TABRIX_EXPERIENCE_TEMPLATE_ONLY');

      expect(() =>
        experienceRepo.save(
          templateRecipe({
            experienceId: 'experience-account',
            recipeFingerprint: 'recipe-account',
            variableSchema: {
              title: 'string',
              账号: 'string',
            },
          }),
        ),
      ).toThrow('TABRIX_EXPERIENCE_TEMPLATE_ONLY');
    } finally {
      close();
    }
  });

  it('does not persist rejected Experience recipes', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      expect(() =>
        experienceRepo.save(
          templateRecipe({
            experienceId: 'experience-raw',
            recipeFingerprint: 'recipe-raw',
            redactionState: 'contains_raw_values',
          }),
        ),
      ).toThrow('TABRIX_EXPERIENCE_TEMPLATE_ONLY');

      expect(experienceRepo.findByFingerprint('recipe-raw')).toBeUndefined();
      expect(() =>
        experienceRepo.save(
          templateRecipe({
            experienceId: 'experience-captcha',
            recipeFingerprint: 'recipe-captcha',
            preconditions: { captcha: '123456' },
          }),
        ),
      ).toThrow('TABRIX_EXPERIENCE_TEMPLATE_ONLY');
      expect(experienceRepo.findByFingerprint('recipe-captcha')).toBeUndefined();
    } finally {
      close();
    }
  });

  it('imports Experience templates as unverified imported recipes without source traces', () => {
    const { experienceRepo, close } = bootstrap();
    try {
      const source = experienceRepo.save(templateRecipe());
      const exported = experienceRepo.exportRecipe(source.experienceId);
      expect(exported).toBeDefined();

      const imported = experienceRepo.importRecipe({
        ...exported!,
        recipeFingerprint: 'recipe-imported',
        originPackageId: 'pkg-1',
        importedAt: '2026-06-06T11:00:00.000Z',
      });

      expect(imported.originKind).toBe('imported');
      expect(imported.importState).toBe('imported_unverified');
      expect(imported.exportState).toBe('not_exportable');
      expect(imported.sourceTraceIds).toEqual([]);
      expect(imported.originPackageId).toBe('pkg-1');
    } finally {
      close();
    }
  });
});
