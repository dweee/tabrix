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
  evidenceRef: string;
}) {
  return {
    sourceKind: 'ai_feedback',
    businessStatus: 'achieved',
    confidence: input.confidence,
    reasonCode: input.reasonCode,
    summary: input.summary,
    evidenceRefs: [input.evidenceRef],
    experienceCandidate: true,
  };
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
      aiFeedbackScore: 0.94,
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
      businessSuccess: 'true',
      aiFeedbackScore: 0.95,
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

  it('mines a recipe when high-confidence AI feedback proves an otherwise unknown action', () => {
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
      businessSuccess: 'achieved',
      aiFeedbackScore: 0.94,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified that the expected result appeared.',
        evidenceRef: 'trace-click-ai-feedback',
      }),
      tabId: 9,
      siteFamily: 'example.test',
      pageUrlPattern: 'https://example.test/editor',
      pageRole: 'content_editor',
      pageState: 'ready',
      createdAt: '2026-06-06T07:00:04.000Z',
    });

    const result = projector.projectIdleBatch({ nowIso: '2026-06-06T07:00:05.000Z' });

    expect(result.savedExperienceCount).toBe(1);
    expect(experience.findByScenario(`mke:example.test:${pageModelKey}`)).toHaveLength(1);
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

  it('does not let AI feedback override explicit Tabrix business failure evidence', () => {
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
      aiFeedbackScore: 0.98,
      aiFeedback: verifiedExperienceFeedback({
        confidence: 0.98,
        reasonCode: 'ai_overstated_result',
        summary: 'AI overstated the result.',
        evidenceRef: 'trace-click-failed-business',
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
});
