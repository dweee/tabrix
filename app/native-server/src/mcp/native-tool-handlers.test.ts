import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { getNativeToolHandler } from './native-tool-handlers';
import type { NativeToolHandler, NativeToolHandlerDeps } from './native-tool-handlers';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import { MkeAiFeedbackValidationError } from '../memory/mke-memory-trace-service';
import type { TaskSessionContext } from '../execution/task-session-context';

function callTextPayload(result: CallToolResult): any {
  const text = String(result.content?.[0]?.text ?? '');
  return JSON.parse(text);
}

function makeDeps(
  overrides: Partial<{
    mode: 'disk' | 'memory' | 'off';
    enabled: boolean;
    knowledgeApi: KnowledgeApiRepository | null;
    memoryTraces: {
      recordAiBusinessFeedback: jest.Mock;
    } | null;
    flushAndProjectMkeAfterAiFeedback: jest.Mock;
    revokeMkeExperienceForTrace: jest.Mock;
    findReusableMkeExperienceRecipes: jest.Mock;
    findLatestMkeKnowledgeModel: jest.Mock;
  }> = {},
): NativeToolHandlerDeps {
  const flushAndProjectMkeAfterAiFeedback =
    overrides.flushAndProjectMkeAfterAiFeedback ??
    jest.fn().mockResolvedValue({
      knowledge: {
        processedTraceCount: 0,
        skippedTraceCount: 0,
        upsertedKnowledgeCount: 0,
        nextCursorCreatedAt: null,
        knowledgeIds: [],
      },
      experience: {
        processedTraceCount: 0,
        skippedTraceCount: 0,
        rejectedSensitiveSequenceCount: 0,
        savedExperienceCount: 0,
        nextCursorCreatedAt: null,
        experienceIds: [],
      },
    });
  return {
    sessionManager: {
      get knowledgeApi() {
        return overrides.knowledgeApi ?? null;
      },
      get memoryTraces() {
        return overrides.memoryTraces ?? null;
      },
      getPersistenceStatus() {
        return {
          mode: overrides.mode ?? 'disk',
          enabled: overrides.enabled ?? true,
        };
      },
      flushAndProjectMkeAfterAiFeedback,
      revokeMkeExperienceForTrace:
        overrides.revokeMkeExperienceForTrace ??
        jest.fn().mockReturnValue({
          updatedCount: 0,
          archivedCount: 0,
          affectedExperienceIds: [],
        }),
      findReusableMkeExperienceRecipes: overrides.findReusableMkeExperienceRecipes,
      findLatestMkeKnowledgeModel: overrides.findLatestMkeKnowledgeModel,
    } as unknown as NativeToolHandlerDeps['sessionManager'],
  };
}

describe('native-tool-handlers · memory_record_ai_feedback', () => {
  function getMemoryFeedbackHandler(): NativeToolHandler {
    const handler = getNativeToolHandler(TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK);
    if (!handler) throw new Error('memory_record_ai_feedback handler missing');
    return handler;
  }

  it('records AI business feedback against an existing trace', async () => {
    const handler = getMemoryFeedbackHandler();
    const recordAiBusinessFeedback = jest.fn().mockReturnValue({
      traceId: 'trace-1',
      aiFeedbackScore: 0.94,
    });
    const flushAndProjectMkeAfterAiFeedback = jest.fn().mockResolvedValue({
      knowledge: {
        processedTraceCount: 2,
        skippedTraceCount: 0,
        upsertedKnowledgeCount: 1,
        nextCursorCreatedAt: '2026-06-06T07:00:02.000Z',
        knowledgeIds: ['knowledge-1'],
      },
      experience: {
        processedTraceCount: 2,
        skippedTraceCount: 0,
        rejectedSensitiveSequenceCount: 0,
        savedExperienceCount: 1,
        nextCursorCreatedAt: '2026-06-06T07:00:04.000Z',
        experienceIds: ['experience-1'],
      },
    });

    const result = await handler(
      {
        traceId: 'trace-1',
        feedbackToken: 'binding-hash-1',
        businessStatus: 'achieved',
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified the expected page result.',
      },
      makeDeps({ memoryTraces: { recordAiBusinessFeedback }, flushAndProjectMkeAfterAiFeedback }),
    );

    expect(result.isError).toBe(false);
    expect(recordAiBusinessFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        traceBindingHash: 'binding-hash-1',
        businessStatus: 'achieved',
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified the expected page result.',
        sourceToolName: TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK,
      }),
    );
    expect(callTextPayload(result)).toMatchObject({
      status: 'recorded',
      traceId: 'trace-1',
      businessStatus: 'achieved',
      confidence: 0.94,
      persistenceMode: 'disk',
      projection: {
        status: 'projected',
        knowledgeUpserted: 1,
        experienceSaved: 1,
        experienceIds: ['experience-1'],
      },
    });
    expect(flushAndProjectMkeAfterAiFeedback).toHaveBeenCalledTimes(1);
  });

  it('passes AI evaluation metadata and lets AI block Experience mining for brittle success', async () => {
    const handler = getMemoryFeedbackHandler();
    const recordAiBusinessFeedback = jest.fn().mockReturnValue({
      traceId: 'trace-1',
      aiFeedbackScore: 0.96,
    });
    const flushAndProjectMkeAfterAiFeedback = jest.fn();
    const revokeMkeExperienceForTrace = jest.fn().mockReturnValue({
      updatedCount: 1,
      archivedCount: 0,
      affectedExperienceIds: ['experience-1'],
    });

    const result = await handler(
      {
        traceId: 'trace-1',
        feedbackToken: 'binding-hash-1',
        taskId: 'task-1',
        toolName: TOOL_NAMES.BROWSER.CLICK,
        toolCallId: 'step-3',
        sequenceIndex: 3,
        evaluationScope: 'step',
        businessStatus: 'achieved',
        confidence: 0.96,
        reasonCode: 'ai_verified_but_brittle_path',
        summary: 'AI verified the page advanced, but the path depended on a brittle fallback.',
        evaluationVersion: 'ai_feedback_v2',
        rubricVersion: 'tabrix_step_quality_v2',
        evaluatorModel: 'codex-test-evaluator',
        userGoalSnapshot: 'Search, filter, and collect the first ten result cards.',
        experienceCandidate: false,
      },
      makeDeps({
        memoryTraces: { recordAiBusinessFeedback },
        flushAndProjectMkeAfterAiFeedback,
        revokeMkeExperienceForTrace,
      }),
    );

    expect(result.isError).toBe(false);
    expect(recordAiBusinessFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        traceBindingHash: 'binding-hash-1',
        taskId: 'task-1',
        toolName: TOOL_NAMES.BROWSER.CLICK,
        toolCallId: 'step-3',
        sequenceIndex: 3,
        evaluationScope: 'step',
        businessStatus: 'achieved',
        confidence: 0.96,
        reasonCode: 'ai_verified_but_brittle_path',
        summary: 'AI verified the page advanced, but the path depended on a brittle fallback.',
        evaluationVersion: 'ai_feedback_v2',
        rubricVersion: 'tabrix_step_quality_v2',
        evaluatorModel: 'codex-test-evaluator',
        userGoalSnapshot: 'Search, filter, and collect the first ten result cards.',
        experienceCandidate: false,
      }),
    );
    expect(callTextPayload(result)).toMatchObject({
      status: 'recorded',
      traceId: 'trace-1',
      businessStatus: 'achieved',
      confidence: 0.96,
      projection: {
        status: 'skipped_experience_not_eligible',
        knowledgeUpserted: null,
        experienceSaved: null,
        experienceIds: [],
        experienceRevocation: {
          updatedCount: 1,
          archivedCount: 0,
          affectedExperienceIds: ['experience-1'],
        },
      },
    });
    expect(flushAndProjectMkeAfterAiFeedback).not.toHaveBeenCalled();
    expect(revokeMkeExperienceForTrace).toHaveBeenCalledWith(
      expect.objectContaining({ traceId: 'trace-1' }),
    );
  });

  it('records partial AI feedback without triggering Experience projection', async () => {
    const handler = getMemoryFeedbackHandler();
    const recordAiBusinessFeedback = jest.fn().mockReturnValue({
      traceId: 'trace-1',
      aiFeedbackScore: 0.82,
    });
    const flushAndProjectMkeAfterAiFeedback = jest.fn();

    const result = await handler(
      {
        traceId: 'trace-1',
        feedbackToken: 'binding-hash-1',
        businessStatus: 'partial',
        confidence: 0.82,
        reasonCode: 'ai_identified_next_target',
        summary: 'AI found useful next-step targets, but the user goal is not complete yet.',
      },
      makeDeps({ memoryTraces: { recordAiBusinessFeedback }, flushAndProjectMkeAfterAiFeedback }),
    );

    expect(result.isError).toBe(false);
    expect(recordAiBusinessFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trace-1',
        traceBindingHash: 'binding-hash-1',
        businessStatus: 'partial',
        confidence: 0.82,
        reasonCode: 'ai_identified_next_target',
      }),
    );
    expect(callTextPayload(result)).toMatchObject({
      status: 'recorded',
      traceId: 'trace-1',
      businessStatus: 'partial',
      confidence: 0.82,
      projection: {
        status: 'skipped_experience_not_eligible',
        knowledgeUpserted: null,
        experienceSaved: null,
        experienceIds: [],
      },
    });
    expect(flushAndProjectMkeAfterAiFeedback).not.toHaveBeenCalled();
  });

  it('rejects missing traceId or invalid businessStatus', async () => {
    const handler = getMemoryFeedbackHandler();
    const result = await handler(
      { businessStatus: 'done' },
      makeDeps({ memoryTraces: { recordAiBusinessFeedback: jest.fn() } }),
    );

    expect(result.isError).toBe(true);
    expect(callTextPayload(result)).toMatchObject({
      status: 'invalid_input',
    });
  });

  it('returns unknown_trace when the trace id is not in Memory', async () => {
    const handler = getMemoryFeedbackHandler();
    const result = await handler(
      {
        traceId: 'missing',
        feedbackToken: 'binding-hash-1',
        businessStatus: 'unknown',
      },
      makeDeps({
        memoryTraces: { recordAiBusinessFeedback: jest.fn().mockReturnValue(undefined) },
      }),
    );

    expect(result.isError).toBe(false);
    expect(callTextPayload(result)).toMatchObject({
      status: 'unknown_trace',
      traceId: 'missing',
    });
  });

  it('returns validation errors from Memory trace binding checks', async () => {
    const handler = getMemoryFeedbackHandler();
    const result = await handler(
      {
        traceId: 'trace-1',
        feedbackToken: 'wrong-binding',
        businessStatus: 'achieved',
        confidence: 0.94,
      },
      makeDeps({
        memoryTraces: {
          recordAiBusinessFeedback: jest.fn(() => {
            throw new MkeAiFeedbackValidationError(
              'trace_binding_mismatch',
              'AI feedback binding does not match.',
            );
          }),
        },
      }),
    );

    expect(result.isError).toBe(true);
    expect(callTextPayload(result)).toMatchObject({
      status: 'trace_binding_mismatch',
      traceId: 'trace-1',
    });
  });
});

describe('native-tool-handlers · tabrix_choose_context (B-018 v1)', () => {
  function getChooseHandler(): NativeToolHandler {
    const handler = getNativeToolHandler(TOOL_NAMES.CONTEXT.CHOOSE);
    if (!handler) throw new Error('tabrix_choose_context handler missing');
    return handler;
  }

  it('registers under TOOL_NAMES.CONTEXT.CHOOSE', () => {
    expect(getNativeToolHandler(TOOL_NAMES.CONTEXT.CHOOSE)).toBeDefined();
  });

  it('returns invalid_input with isError=true when intent is missing', async () => {
    const handler = getChooseHandler();
    const result = await handler({}, makeDeps());
    expect(result.isError).toBe(true);
    expect(callTextPayload(result)).toMatchObject({
      status: 'invalid_input',
      error: { code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT' },
    });
  });

  it('falls back to read_page_required when nothing is wired', async () => {
    const handler = getChooseHandler();
    const result = await handler({ intent: 'open issues' }, makeDeps());
    expect(result.isError).toBe(false);
    expect(callTextPayload(result)).toMatchObject({
      status: 'ok',
      strategy: 'read_page_required',
      artifacts: [],
    });
  });

  it('routes to knowledge_light when local Knowledge catalog is non-empty', async () => {
    const handler = getChooseHandler();
    const listBySite = jest.fn().mockReturnValue([
      {
        endpointId: 'ep-1',
        site: 'api.code.example',
        family: 'workspace',
        method: 'GET',
        urlPattern: '/repos/:owner/:repo/issues',
        endpointSignature: 'GET api.code.example/repos/:owner/:repo/issues',
        semanticTag: null,
        statusClass: '2xx',
        requestSummary: {
          headerNames: [],
          queryKeys: [],
          bodyKeys: [],
          hasAuth: false,
          hasCookie: false,
        },
        responseSummary: { shape: 'array<object>', truncated: false },
        sourceSessionId: null,
        sourceStepId: null,
        sourceHistoryRef: null,
        sampleCount: 1,
        firstSeenAt: '2026-04-22T00:00:00.000Z',
        lastSeenAt: '2026-04-22T00:00:00.000Z',
      },
    ]);
    const knowledgeApi = { listBySite } as unknown as KnowledgeApiRepository;

    const result = await handler(
      { intent: 'inspect captured endpoint catalog', url: 'https://code.example/octocat/hello' },
      makeDeps({
        knowledgeApi,
      }),
    );
    const body = callTextPayload(result);
    expect(body.strategy).toBe('knowledge_light');
    expect(listBySite).toHaveBeenCalledTimes(1);
  });

  it('routes to experience_reuse when a verified local Experience exists', async () => {
    const handler = getChooseHandler();
    const findReusableMkeExperienceRecipes = jest.fn().mockReturnValue([
      {
        experienceId: 'exp-content-top10',
        taskSignature: 'tools:chrome_collect_result_cards',
        successCount: 2,
        failureCount: 0,
        reliabilityScore: 1,
        successCheck: {
          collectResultCards: [
            {
              observedResultCountAtLeast: 10,
              filterState: {
                sort: '最多收藏',
                contentType: '图文',
                timeRange: '一周内',
              },
            },
          ],
        },
      },
    ]);

    const result = await handler(
      {
        intent: '内容站搜索AI图片创作，筛选最多收藏、图文、一周内，并汇报前10条图文内容',
        url: 'https://content.example/search_result/?keyword=AI图片创作&type=51',
        pageRole: 'search_results',
      },
      makeDeps({
        findReusableMkeExperienceRecipes,
      }),
    );

    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.strategy).toBe('experience_reuse');
    expect(body.sourceRoute).toBe('experience_reuse');
    expect(body.artifacts).toEqual([
      expect.objectContaining({
        kind: 'experience_recipe',
        ref: 'exp-content-top10',
      }),
    ]);
    expect(body.artifacts[0].summary).toContain('最多收藏/图文/一周内');
    expect(findReusableMkeExperienceRecipes).toHaveBeenCalledWith({
      siteFamily: 'content.example',
      pageRole: 'search_results',
      limit: 1,
    });
  });

  it('surfaces page-model Knowledge from the native SessionManager as context guidance', async () => {
    const handler = getChooseHandler();
    const findLatestMkeKnowledgeModel = jest.fn().mockReturnValue({
      knowledgeId: 'km-content-search',
      siteFamily: 'content.example',
      pageUrlPattern: 'https://content.example/search*',
      pageRole: 'search_results',
      pageModelKey: 'page:content.example:search_results',
      modelVersion: 1,
      pageStateModel: {},
      objectGraph: {
        sourceObjectCount: 8,
        objectTypeCounts: {
          result_card: 6,
          search_input: 1,
        },
      },
      actionSurface: {
        reusableActionKinds: ['click_result_card', 'submit_search'],
      },
      dataSourceModel: {
        selectedDataSourceCounts: {
          dom_json: 1,
        },
      },
      navigationModel: null,
      failureSignal: null,
      sourceTraceIds: [],
      sourceExperienceIds: [],
      observationCount: 2,
      successfulUseCount: 0,
      failedUseCount: 0,
      confidenceScore: 0.8,
      driftScore: null,
      archivedAt: null,
      lastObservedAt: '2026-06-20T00:00:00.000Z',
      lastValidatedAt: null,
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    });

    const result = await handler(
      {
        intent: '内容站搜索并整理前10条结果',
        url: 'https://content.example/search?q=ai',
        pageRole: 'search_results',
      },
      makeDeps({
        findLatestMkeKnowledgeModel,
      }),
    );

    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.strategy).toBe('read_page_required');
    expect(body.artifacts).toEqual([
      expect.objectContaining({
        kind: 'knowledge_page_model',
        ref: 'km-content-search',
      }),
    ]);
    expect(findLatestMkeKnowledgeModel).toHaveBeenCalledWith({
      siteFamily: 'content.example',
      pageModelKey: 'page:content.example:search_results',
    });
  });

  it('uses task read_page baseline to record positive savings for Experience reuse', async () => {
    const handler = getChooseHandler();
    const findReusableMkeExperienceRecipes = jest.fn().mockReturnValue([
      {
        experienceId: 'exp-content-top10',
        taskSignature: 'tools:chrome_collect_result_cards',
        successCount: 2,
        failureCount: 0,
        reliabilityScore: 1,
        successCheck: {
          collectResultCards: [
            {
              observedResultCountAtLeast: 10,
              filterState: {
                sort: '最多收藏',
                contentType: '图文',
                timeRange: '一周内',
              },
            },
          ],
        },
      },
    ]);

    const result = await handler(
      {
        intent: '内容站搜索AI图片创作，筛选最多收藏、图文、一周内，并汇报前10条图文内容',
        url: 'https://content.example/search_result/?keyword=AI图片创作&type=51',
        pageRole: 'search_results',
      },
      {
        ...makeDeps({
          findReusableMkeExperienceRecipes,
        }),
        taskContext: {
          peekReadPageContextMeasurement: () => ({
            url: 'https://content.example/search_result/?keyword=AI图片创作&type=51',
            pageRole: 'search_results',
            fullReadByteLength: 40_000,
            candidateActionsCount: 10,
            highValueObjectCount: 10,
          }),
          peekVisibleRegionRowsEvidence: () => null,
          noteUrlChange: jest.fn(),
          noteChooseContextDecision: jest.fn(),
        } as unknown as TaskSessionContext,
      },
    );

    expect(result.isError).toBe(false);
    const body = callTextPayload(result);
    expect(body.strategy).toBe('experience_reuse');
    expect(body.tokenEstimateChosen).toBeGreaterThan(0);
    expect(body.tokenEstimateFullRead).toBe(10_000);
    expect(body.tokensSavedEstimate).toBeGreaterThan(9_000);
    expect(body.dispatcherInputSource).toBe('live_snapshot');
  });

  it('does not enter direct API without observed Knowledge even when fault injection is present', async () => {
    const handler = getChooseHandler();
    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('direct API must not run on acceptance fault chooser calls'));

    try {
      const result = await handler(
        {
          intent: '搜索 Workspace 上 AI助手 相关热门项目，列出前10个',
          url: 'https://code.example/search?q=AI%20assistant&type=repositories',
          pageRole: 'search_results',
          __tabrixAcceptanceApiFault: 'network_timeout',
        },
        makeDeps({
          knowledgeApi: null,
        }),
      );

      expect(result.isError).toBe(false);
      const body = callTextPayload(result);
      expect(body.sourceRoute).toBe('read_page_required');
      expect(body.directApiExecution).toBeUndefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
