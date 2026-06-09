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
    recipeFingerprint: 'recipe-xhs-publish-v1',
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
    reliabilityScore: 0.8,
    usefulnessScore: 0.7,
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

  it('lists Object Library surface as current browser windows and tabs only', () => {
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

      expect(browserObjectRepo.count()).toBe(7);
      expect(browserObjectRepo.countCurrentBrowserSurface()).toBe(2);
      expect(
        browserObjectRepo.listCurrentBrowserSurface({ limit: 10, offset: 0 }).map((object) => ({
          objectType: object.objectType,
          lifecycleState: object.lifecycleState,
        })),
      ).toEqual([
        { objectType: 'window', lifecycleState: null },
        { objectType: 'tab', lifecycleState: null },
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
        reliabilityScore: 0.9,
        nowIso: '2026-06-06T10:10:00.000Z',
      });

      const used = experienceRepo.get(recipe.experienceId);
      expect(used?.successCount).toBe(1);
      expect(used?.adoptionCount).toBe(1);
      expect(used?.lastUsedAt).toBe('2026-06-06T10:10:00.000Z');

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
