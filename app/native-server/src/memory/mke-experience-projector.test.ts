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

describe('MkeExperienceProjector', () => {
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
      businessSuccess: 'true',
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
      businessSuccess: 'true',
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

  it('does not mine a recipe when actions only have tool success without business proof', () => {
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
});
