import { jest } from '@jest/globals';

import {
  BrowserObjectRepository,
  MemoryTraceRepository,
  openMemoryDb,
  type BrowserObjectInput,
} from './db';
import { MkeAiFeedbackValidationError, MkeMemoryTraceService } from './mke-memory-trace-service';
import { buildLegacyMemoryTraceBindingHash, buildMemoryTraceBindingHash } from './feedback-binding';

const NOW_MS = Date.parse('2026-06-10T10:00:00.000Z');

function textResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

describe('MkeMemoryTraceService', () => {
  it('returns the trace before queued Browser Object writes run, then flushes them', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const originalUpsert = browserObjectRepo.upsert.bind(browserObjectRepo);
    let recordReturned = false;
    let upsertRanBeforeRecordReturned = false;
    const upsertSpy = jest
      .spyOn(browserObjectRepo, 'upsert')
      .mockImplementation((input: BrowserObjectInput) => {
        if (!recordReturned) upsertRanBeforeRecordReturned = true;
        return originalUpsert(input);
      });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-async-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-async-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/workspaces/123?tab=overview' },
          summary: { pageRole: 'workspace', quality: 'fresh' },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 7,
          pageRegions: [{ regionId: 'main', regionType: 'content', confidence: 0.9 }],
        }),
        resultSummary: 'fresh page read',
      });
      recordReturned = true;

      expect(trace.traceId).toBeDefined();
      expect(trace.aiFeedbackScore).toBeNull();
      expect(trace.aiFeedback).toBeNull();
      expect(traceRepo.count()).toBe(1);
      expect(browserObjectRepo.count()).toBe(0);
      expect(upsertSpy).not.toHaveBeenCalled();

      await traceService.flushAsyncWrites();

      expect(upsertRanBeforeRecordReturned).toBe(false);
      expect(upsertSpy).toHaveBeenCalled();
      expect(browserObjectRepo.count()).toBe(2);
    } finally {
      upsertSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('does not synthesize AI feedback from tool execution facts', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-auto-feedback-task',
        taskIntent: 'click and verify page result',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-auto-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, ref: 'ref_button' },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          actionEvidenceResult: {
            business: {
              businessSuccessVerdict: 'proven',
              businessSuccessProven: true,
            },
          },
        }),
        resultSummary: 'verified result appeared',
      });

      expect(trace.businessSuccess).toBe('achieved');
      expect(trace.aiFeedbackScore).toBeNull();
      expect(trace.aiFeedback).toBeNull();
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records browser action target and post-action delta without inventing AI feedback', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-action-delta-task',
        taskIntent: 'open first search result',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-action-delta-step',
        sequenceIndex: 1,
        requestParams: {
          tabId: 7,
          candidateAction: {
            id: 'ca_click_ref_result_card_1',
            targetRef: 'ref_result_card_1',
            intent: 'content.open_detail',
          },
        },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 75,
        result: textResult({
          success: true,
          dispatchSucceeded: true,
          observedOutcome: 'dom_changed',
          verification: {
            navigationOccurred: false,
            urlChanged: false,
            newTabOpened: false,
            domChanged: true,
            stateChanged: false,
            focusChanged: false,
          },
          clickDiff: {
            kind: 'change',
            urlDelta: 'none',
            hashChanged: false,
            beforeUnloadFired: false,
            newTabOpened: false,
            domChanged: true,
            dialogAdded: false,
            menuAdded: false,
            focusChanged: false,
            stateChanged: false,
          },
          postActionDelta: {
            deltaKind: 'post_action_tool_delta',
            actionId: 'action-click-1',
            actionKind: 'click',
            tabId: 7,
            targetRef: 'ref_result_card_1',
            observedOutcome: 'dom_changed',
            changed: true,
            changedSignals: ['dom_changed'],
            urlDelta: 'none',
            hashChanged: false,
            beforeUnloadFired: false,
            readbackStatus: 'fresh_read_required',
            recommendation: 'chrome_read_page_force_refresh_same_tab',
            businessSuccessProven: false,
          },
          targetBinding: {
            resolutionSource: 'candidate_stable_target_ref',
            dispatchTarget: 'ref',
            frameScope: 'default_frame',
            stableTargetRefResolved: true,
          },
          postActionReadback: {
            kind: 'post_action_readback_v1',
            actionKind: 'click',
            status: 'fresh_read_required',
            candidateActionIntent: 'content.open_detail',
            expectedEvidence: 'detail_region_or_content_transition',
            observedOutcome: 'dom_changed',
            dispatchSucceeded: true,
            freshReadRequired: true,
            sameTabVerificationRequired: true,
            businessSuccessProven: false,
            readbackSource: 'tool_dispatch_only',
            requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
            reason: 'click_dispatch_observed_dom_changed',
          },
          actionEvidenceResult: {
            actionId: 'action-click-1',
            actionKind: 'click',
            tabId: 7,
            targetBinding: {
              requestedTargetRef: 'ref_result_card_1',
              resolvedTargetRef: 'ref_result_card_1',
              locatorChainSummary: ['ref:ref_result_card_1', 'css:a[href*="/explore/"]'],
              dispatchTarget: 'ref',
              frameScope: 'default_frame',
              targetBindingProven: true,
            },
            dispatch: {
              dispatched: true,
              acceptedByBrowser: true,
              errorCode: null,
            },
            business: {
              businessSuccessVerdict: 'not_proven',
              businessSuccessProven: false,
              nextRequiredCheck: 'chrome_read_page_force_refresh_same_tab',
            },
          },
        }),
        resultSummary: 'click changed the result card area',
      });

      expect(trace.aiFeedbackScore).toBeNull();
      expect(trace.aiFeedback).toBeNull();
      expect(trace.actionTarget).toMatchObject({
        actionId: 'action-click-1',
        actionKind: 'click',
        tabId: 7,
        requestedTargetRef: 'ref_result_card_1',
        resolvedTargetRef: 'ref_result_card_1',
        dispatchTarget: 'ref',
        targetBindingProven: true,
        acceptedByBrowser: true,
      });
      expect(trace.postObservation).toMatchObject({
        success: true,
        dispatchSucceeded: true,
        observedOutcome: 'dom_changed',
        readbackStatus: 'fresh_read_required',
        expectedEvidence: 'detail_region_or_content_transition',
        domChanged: true,
      });
      expect(trace.postActionDelta).toMatchObject({
        deltaKind: 'post_action_tool_delta',
        actionId: 'action-click-1',
        actionKind: 'click',
        tabId: 7,
        targetRef: 'ref_result_card_1',
        observedOutcome: 'dom_changed',
        changed: true,
        changedSignals: ['dom_changed'],
        hashChanged: false,
        beforeUnloadFired: false,
        recommendation: 'chrome_read_page_force_refresh_same_tab',
        businessSuccessProven: false,
      });
      expect(trace.nextRequiredCheck).toBe('chrome_read_page_force_refresh_same_tab');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records fill action readback without persisting the raw input value in action summaries', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-fill-delta-task',
        taskIntent: 'enter search query',
        aiClient: 'jest',
        toolName: 'chrome_fill_or_select',
        stepId: 'trace-fill-delta-step',
        sequenceIndex: 1,
        requestParams: {
          tabId: 7,
          value: 'PRIVATE_SEARCH_QUERY',
          candidateAction: {
            id: 'ca_fill_search',
            targetRef: 'ref_search_input',
            intent: 'search.enter_query',
          },
        },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 55,
        result: textResult({
          success: true,
          targetBinding: {
            resolutionSource: 'candidate_stable_target_ref',
            dispatchTarget: 'ref',
            frameScope: 'default_frame',
            stableTargetRefResolved: true,
          },
          postActionReadback: {
            kind: 'post_action_readback_v1',
            actionKind: 'fill',
            status: 'fresh_read_required',
            candidateActionIntent: 'search.enter_query',
            expectedEvidence: 'form_value_state_changed',
            observedOutcome: 'input_value_written',
            dispatchSucceeded: true,
            freshReadRequired: true,
            sameTabVerificationRequired: true,
            businessSuccessProven: false,
            readbackSource: 'tool_dispatch_only',
            requiredNextAction: 'chrome_read_page_force_refresh_same_tab',
            reason: 'fill_dispatch_observed_input_value_written',
          },
          inputWriteEvidence: {
            valueState: 'non_empty',
            proofStatus: 'input_state_observed',
            claimBoundary: 'raw value is not returned',
          },
        }),
        resultSummary: 'fill search input',
      });

      expect(trace.postObservation).toMatchObject({
        success: true,
        readbackStatus: 'fresh_read_required',
        expectedEvidence: 'form_value_state_changed',
        inputProofStatus: 'input_state_observed',
        valueState: 'non_empty',
      });
      expect(trace.postActionDelta).toMatchObject({
        deltaKind: 'post_action_tool_delta',
        actionKind: 'fill',
        observedOutcome: 'input_value_written',
        changed: true,
        changedSignals: ['input_state_observed'],
      });
      expect(JSON.stringify(trace.actionTarget)).not.toContain('PRIVATE_SEARCH_QUERY');
      expect(JSON.stringify(trace.postObservation)).not.toContain('PRIVATE_SEARCH_QUERY');
      expect(JSON.stringify(trace.postActionDelta)).not.toContain('PRIVATE_SEARCH_QUERY');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('compacts network capture memory summaries without retaining raw bodies or headers', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-network-privacy-task',
        taskIntent: 'observe network safely',
        aiClient: 'jest',
        toolName: 'chrome_network_capture',
        stepId: 'trace-network-privacy-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 50,
        result: textResult({
          success: true,
          requestCount: 2,
          totalRequestsReceived: 2,
          observationMode: 'cdp_enhanced',
          cdpUsed: true,
          rawBodyPersisted: false,
          bodyCompacted: true,
          requests: [
            {
              method: 'POST',
              url: 'https://example.test/api/search',
              requestBody: '{"secret":"PRIVATE_REQUEST_BODY"}',
              responseBody: '{"title":"PRIVATE_RESPONSE_BODY"}',
              specificRequestHeaders: {
                Authorization: 'Bearer PRIVATE_TOKEN',
                'X-S': 'PRIVATE_SIGNATURE',
              },
              specificResponseHeaders: {
                'Set-Cookie': 'sid=PRIVATE_COOKIE',
              },
            },
          ],
        }),
        resultSummary: JSON.stringify({
          requestBody: 'PRIVATE_REQUEST_BODY',
          responseBody: 'PRIVATE_RESPONSE_BODY',
          specificRequestHeaders: { Authorization: 'Bearer PRIVATE_TOKEN' },
        }),
      });

      expect(trace.resultSummary).toBe(
        'chrome_network_capture summary; requests=2; mode=cdp_enhanced; cdpUsed=true; rawBodyPersisted=false; bodyCompacted=true',
      );
      const serialized = JSON.stringify(trace.response);
      expect(serialized).not.toContain('PRIVATE_REQUEST_BODY');
      expect(serialized).not.toContain('PRIVATE_RESPONSE_BODY');
      expect(serialized).not.toContain('PRIVATE_TOKEN');
      expect(serialized).not.toContain('PRIVATE_COOKIE');
      expect(serialized).toContain('[redacted]');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records verification-blocked read_page traces as restricted instead of sparse', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-content-verification-task',
        taskIntent: 'read blocked ContentSite search page',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-content-verification-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 40,
        result: textResult({
          page: {
            url: 'https://content.example/website-login/captcha?redirectPath=https%3A%2F%2Fcontent.example%2Fsearch_result%2F%3Fkeyword%3DAI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          summary: { pageRole: 'unknown', quality: 'sparse' },
          authArtifactStatus: { status: 'blocked', reasonCode: 'user_verification_required' },
          observedAuthSurface: { status: 'detected', title: '安全验证' },
          tabId: 7,
        }),
        resultSummary:
          'AI context: read_refresh_delta; state=login_required; next=user_collaboration',
      });

      expect(trace.pageState).toBe('restricted');
      expect(trace.pageUrlPattern).toBe('https://content.example/website-login/captcha');

      await traceService.flushAsyncWrites();
      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.some((object) => object.canTabrixOperate === false)).toBe(true);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records bound AI feedback and appends an audit event', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        taskIntent: 'click and verify page result',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, ref: 'ref_button' },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          actionEvidenceResult: {
            business: {
              businessSuccessVerdict: 'proven',
              businessSuccessProven: true,
            },
          },
        }),
        resultSummary: 'verified result appeared',
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.94,
        reasonCode: 'ai_verified_result',
        summary: 'AI verified the expected page result appeared.',
        evaluatorModel: 'codex-test-evaluator',
        receivedAt: '2026-06-10T10:00:01.000Z',
      });

      expect(updated).toMatchObject({
        traceId: trace.traceId,
        businessSuccess: 'achieved',
        aiFeedbackScore: 0.94,
        aiFeedback: expect.objectContaining({
          sourceKind: 'ai_feedback',
          businessStatus: 'achieved',
          confidence: 0.94,
          binding: expect.objectContaining({
            traceId: trace.traceId,
            traceBindingHash: buildMemoryTraceBindingHash(trace),
          }),
        }),
      });
      expect(traceRepo.get(trace.traceId)?.businessSuccess).toBe('achieved');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        traceId: trace.traceId,
        businessStatus: 'achieved',
        experienceCandidate: true,
        accepted: true,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).not.toHaveProperty(
        'evidenceRefs',
      );
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records AI feedback rubric metadata and honors explicit non-reusable success', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-rubric-task',
        taskIntent: 'collect filtered result cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-ai-feedback-rubric-step',
        sequenceIndex: 4,
        requestParams: { tabId: 7, minResults: 10 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 3000,
        result: textResult({
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
        }),
        resultSummary: 'collected ten visible result cards',
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        evaluationScope: 'step',
        businessStatus: 'achieved',
        confidence: 0.96,
        reasonCode: 'ai_verified_but_brittle_path',
        summary: 'AI verified the requested cards, but the path was too brittle to reuse.',
        evaluationVersion: 'ai_feedback_v2',
        rubricVersion: 'tabrix_step_quality_v2',
        evaluatorModel: 'codex-test-evaluator',
        userGoalSnapshot: 'Search, filter, and collect ten result cards.',
        experienceCandidate: false,
        receivedAt: '2026-06-10T10:00:01.000Z',
      });

      expect(updated).toMatchObject({
        traceId: trace.traceId,
        businessSuccess: 'achieved',
        aiFeedbackScore: 0.96,
        aiFeedback: expect.objectContaining({
          sourceKind: 'ai_feedback',
          evaluationScope: 'step',
          businessStatus: 'achieved',
          confidence: 0.96,
          evaluationVersion: 'ai_feedback_v2',
          rubricVersion: 'tabrix_step_quality_v2',
          evaluatorModel: 'codex-test-evaluator',
          userGoalSnapshot: 'Search, filter, and collect ten result cards.',
          experienceCandidate: false,
        }),
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        traceId: trace.traceId,
        evaluationScope: 'step',
        evaluationVersion: 'ai_feedback_v2',
        rubricVersion: 'tabrix_step_quality_v2',
        evaluatorModel: 'codex-test-evaluator',
        userGoalSnapshot: 'Search, filter, and collect ten result cards.',
        businessStatus: 'achieved',
        confidence: 0.96,
        experienceCandidate: false,
        accepted: true,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('treats repeated identical AI feedback as idempotent', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-retry-task',
        taskIntent: 'retry ai feedback safely',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-ai-feedback-retry-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7, minResults: 10 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          success: true,
          selectedDataSource: 'visible_dom_result_cards',
          observedResultCount: 10,
        }),
      });
      const feedbackInput = {
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.93,
        reasonCode: 'ai_verified_top10_cards',
        summary: 'AI verified the requested top 10 result cards.',
        receivedAt: '2026-06-10T10:00:01.000Z',
      } as const;

      const first = traceService.recordAiBusinessFeedback(feedbackInput);
      const second = traceService.recordAiBusinessFeedback(feedbackInput);

      expect(first?.businessSuccess).toBe('achieved');
      expect(second?.businessSuccess).toBe('achieved');
      expect(second?.aiFeedbackScore).toBe(0.93);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps the new feedback token stable after business status changes and accepts legacy tokens', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-token-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-token-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });
      const stableHashBefore = buildMemoryTraceBindingHash(trace);
      const legacyHashBefore = buildLegacyMemoryTraceBindingHash(trace);

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: legacyHashBefore,
        businessStatus: 'achieved',
        confidence: 0.91,
        summary: 'AI verified the result using a legacy feedback token.',
      });

      expect(updated?.businessSuccess).toBe('achieved');
      expect(buildMemoryTraceBindingHash(updated!)).toBe(stableHashBefore);
      expect(buildLegacyMemoryTraceBindingHash(updated!)).not.toBe(legacyHashBefore);

      const repeated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: legacyHashBefore,
        businessStatus: 'achieved',
        confidence: 0.91,
        summary: 'AI verified the result using a legacy feedback token.',
      });
      expect(repeated?.businessSuccess).toBe('achieved');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('rejects AI feedback when the binding hash does not match the trace', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-binding-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-binding-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      expect(() =>
        traceService.recordAiBusinessFeedback({
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash: 'wrong-binding-hash',
          businessStatus: 'partial',
          confidence: 0.5,
        }),
      ).toThrow(MkeAiFeedbackValidationError);
      expect(traceRepo.get(trace.traceId)?.aiFeedback).toBeNull();
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toEqual([]);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records rejected AI feedback attempts as audit events without changing the trace verdict', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-rejected-feedback-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-rejected-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      const recorded = traceService.recordRejectedAiBusinessFeedback({
        traceId: trace.traceId,
        traceBindingHash: 'wrong-binding-hash',
        businessStatus: 'achieved',
        confidence: 0.9,
        reasonCode: 'wrong_trace_binding',
        summary: 'This feedback should be rejected.',
        sourceToolName: 'chrome_read_page',
        sourceToolCallId: 'feedback-source-step',
        rejectionCode: 'trace_binding_mismatch',
        rejectionMessage: 'The feedback token did not match this trace.',
        receivedAt: new Date(NOW_MS + 100).toISOString(),
      });

      expect(recorded).toBe(true);
      expect(traceRepo.get(trace.traceId)?.aiFeedback).toBeNull();
      expect(traceRepo.get(trace.traceId)?.businessSuccess).toBe('unknown');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)).toHaveLength(1);
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        toolCallId: trace.toolCallId,
        businessStatus: 'achieved',
        confidence: 0.9,
        accepted: false,
        rejectionCode: 'trace_binding_mismatch',
        rejectionMessage: 'The feedback token did not match this trace.',
        sourceToolName: 'chrome_read_page',
        sourceToolCallId: 'feedback-source-step',
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records high-confidence achieved AI feedback without product evidence refs', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.95,
        summary: 'AI verified the result.',
        evaluatorModel: 'codex-test-evaluator',
      });
      expect(updated?.aiFeedback).toMatchObject({
        businessStatus: 'achieved',
        confidence: 0.95,
        evaluatorModel: 'codex-test-evaluator',
      });
      expect(updated?.aiFeedback).not.toHaveProperty('evidenceRefs');
      expect(updated?.aiFeedback).not.toHaveProperty('userGoalSnapshot');
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        businessStatus: 'achieved',
        experienceCandidate: true,
        accepted: true,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).not.toHaveProperty(
        'evidenceRefs',
      );
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records high-confidence AI feedback without evaluator metadata but keeps it out of Experience', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-ai-feedback-task',
        aiClient: 'jest',
        toolName: 'chrome_click_element',
        stepId: 'trace-ai-feedback-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({ success: true }),
      });

      const updated = traceService.recordAiBusinessFeedback({
        traceId: trace.traceId,
        taskId: trace.taskId,
        toolName: trace.toolName,
        sequenceIndex: trace.sequenceIndex,
        traceBindingHash: buildMemoryTraceBindingHash(trace),
        businessStatus: 'achieved',
        confidence: 0.95,
        summary: 'AI verified the result.',
      });
      expect(updated?.aiFeedback).toMatchObject({
        businessStatus: 'achieved',
        confidence: 0.95,
      });
      expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
        businessStatus: 'achieved',
        experienceCandidate: false,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it.each([undefined, '', 'unknown', 'default', 'system', 'tabrix'])(
    'records AI feedback from untrusted evaluator %p without making it Experience-ready',
    (evaluatorModel) => {
      const { db } = openMemoryDb({ dbPath: ':memory:' });
      const traceRepo = new MemoryTraceRepository(db);
      const traceService = new MkeMemoryTraceService(traceRepo);

      try {
        const trace = traceService.recordToolCall({
          taskId: 'trace-ai-feedback-task',
          aiClient: 'jest',
          toolName: 'chrome_click_element',
          stepId: 'trace-ai-feedback-step',
          sequenceIndex: 1,
          requestParams: { tabId: 7 },
          requestAtMs: NOW_MS,
          responseAtMs: NOW_MS + 30,
          result: textResult({ success: true }),
        });

        const updated = traceService.recordAiBusinessFeedback({
          traceId: trace.traceId,
          taskId: trace.taskId,
          toolName: trace.toolName,
          sequenceIndex: trace.sequenceIndex,
          traceBindingHash: buildMemoryTraceBindingHash(trace),
          businessStatus: 'achieved',
          confidence: 0.95,
          summary: 'AI verified the result.',
          evaluatorModel,
        });
        expect(updated?.aiFeedback).toMatchObject({
          businessStatus: 'achieved',
          confidence: 0.95,
          experienceCandidate: false,
        });
        expect(traceRepo.listFeedbackEventsByTrace(trace.traceId)[0]).toMatchObject({
          businessStatus: 'achieved',
          accepted: true,
          experienceCandidate: false,
        });
      } finally {
        traceService.discardPendingAsyncWrites();
        db.close();
      }
    },
  );

  it('projects API-backed read_page results as data_source Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'trace-api-source-task',
        taskIntent: 'read list through observed API',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-api-source-step',
        sequenceIndex: 1,
        requestParams: { tabId: 9 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          kind: 'api_rows',
          page: { url: 'https://example.test/items?q=alpha' },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          sourceRoute: 'knowledge_api_endpoints',
          selectedDataSource: 'api_rows',
          endpointFamily: 'example_items_search',
          freshness: 'fresh',
          apiCdpProofBoundary: 'diagnostic boundary should not be persisted',
          tabId: 9,
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:example.test:search_results',
            chosenDataSource: 'api_rows',
            sourceConfidence: 0.92,
            sourceTruthChain: {
              primaryOrigin: 'api',
            },
          },
        }),
        resultSummary: 'fresh API-backed page read',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.objectType).sort()).toEqual(['data_source', 'page']);
      for (const object of objects) {
        expect(object.claimBoundary).toBeNull();
        expect(object.confidenceScore).toBeNull();
        expect(JSON.stringify(object.facts)).not.toContain('evidenceSummary');
      }
      expect(objects.find((object) => object.objectType === 'data_source')).toMatchObject({
        selectedDataSource: 'api_rows',
        sourceRoute: 'knowledge_api_endpoints',
        lifecycleState: 'observed',
        canTabrixOperate: true,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects collected result cards as page and result_card Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-result-cards-task',
        taskIntent: 'collect top search result cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-result-cards-step',
        sequenceIndex: 1,
        requestParams: { tabId: 19, minResults: 2 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 120,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'Search results',
            url: 'https://example.test/search?q=ai',
          },
          pageRole: 'search_list',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 19,
          requestedMinResults: 2,
          observedResultCount: 2,
          targetRefCoverageRate: 0.5,
          targetabilitySummary: {
            stableClickTargetCount: 1,
            urlFallbackCount: 1,
            untargetableCount: 0,
            targetRefCoverageRate: 0.5,
            status: 'partial_stable_targets',
          },
          complete: true,
          status: 'complete_enough',
          filterState: {
            status: 'observed',
            appliedLabels: ['图文', '最多收藏', '一周内'],
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
            appliedFilters: [
              { label: '图文', kind: 'content_type', source: 'url_parameter_adapter' },
              { label: '最多收藏', kind: 'sort', source: 'dom_active_state' },
              { label: '一周内', kind: 'time_range', source: 'dom_active_state' },
            ],
          },
          cards: [
            {
              rank: 1,
              title: 'First result',
              url: 'https://example.test/note/1?xsec_token=private-token&x=private',
              actionTarget: {
                actionType: 'click',
                targetKind: 'result_card_link',
                url: 'https://example.test/note/1?xsec_token=private-token&x=private',
                selector: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)',
                text: 'First result',
                openAction: {
                  toolName: 'chrome_navigate',
                  toolArgs: {
                    url: 'https://example.test/note/1?xsec_token=private-token&x=private',
                  },
                  executionScope: 'session_url',
                  reason: 'result_card_href',
                  confidence: 0.88,
                },
                toolName: 'chrome_click_element',
                toolArgs: {
                  candidateAction: {
                    id: 'ca_click_ref_result_card_1',
                    actionType: 'click',
                    targetRef: 'ref_result_card_1',
                    label: 'First result',
                    confidence: 0.9,
                    matchReason: 'result_card_primary_link',
                    intent: 'content.open_detail',
                    locatorChain: [
                      { type: 'ref', value: 'ref_result_card_1' },
                      { type: 'aria', value: 'First result' },
                      {
                        type: 'css',
                        value: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)',
                      },
                    ],
                  },
                },
                rect: { x: 20, y: 40, width: 160, height: 32 },
                center: { x: 100, y: 56 },
                coordinateFrame: 'viewport',
                sourceScrollY: 0,
                confidence: 0.9,
                reasons: ['title_link_match'],
              },
              primaryText: 'Author A',
              metaText: '1 day ago',
              interactionText: '123',
              imageCount: 1,
              sourceScrollY: 0,
              rect: { x: 10, y: 20, width: 200, height: 160 },
              confidence: 0.86,
              reasons: ['link_present', 'media_present'],
              sourceStrategy: 'list_container',
            },
            {
              rank: 2,
              title: 'Second result',
              url: 'https://example.test/note/2',
              actionTarget: {
                actionType: 'click',
                targetKind: 'result_card_link',
                url: 'https://example.test/note/2?x=private',
                executionScope: 'session_url',
                openAction: {
                  toolName: 'chrome_navigate',
                  toolArgs: { url: 'https://example.test/note/2?x=private' },
                  executionScope: 'session_url',
                  reason: 'result_card_href',
                  confidence: 0.74,
                },
                rect: { x: 20, y: -40, width: 160, height: 32 },
                center: { x: 100, y: 14 },
                coordinateFrame: 'viewport',
                sourceScrollY: 0,
                confidence: 0.74,
                reasons: ['visible_detail_link_unverified_hit'],
              },
              imageCount: 0,
              sourceScrollY: 480,
              rect: { x: 10, y: 220, width: 200, height: 140 },
              confidence: 0.72,
              reasons: ['link_present'],
              sourceStrategy: 'list_container',
            },
          ],
          claimBoundary: 'bounded visible DOM collection',
        }),
        resultSummary: 'collected result cards',
      });

      expect(trace).toMatchObject({
        toolName: 'chrome_collect_result_cards',
        siteFamily: 'example.test',
        pageUrlPattern: 'https://example.test/search',
        pageRole: 'search_results',
        pageState: 'complete',
        pageModelKey: 'page:example.test:search_results',
        selectedDataSource: 'visible_dom_result_cards',
      });
      expect(JSON.stringify(trace.response)).not.toContain('xsec_token');
      expect(JSON.stringify(trace.response)).not.toContain('private-token');

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.objectType).sort()).toEqual([
        'page',
        'result_card',
        'result_card',
      ]);
      const page = objects.find((object) => object.objectType === 'page');
      expect(page).toMatchObject({
        pageRole: 'search_results',
        pageModelKey: 'page:example.test:search_results',
        selectedDataSource: 'visible_dom_result_cards',
        sourceRoute: 'visible_dom_cards_bounded_scroll',
        lifecycleState: 'complete',
        canTabrixOperate: true,
      });
      expect(page?.facts).toMatchObject({
        filterState: {
          status: 'observed',
          appliedLabels: ['图文', '最多收藏', '一周内'],
          contentType: '图文',
          sort: '最多收藏',
          timeRange: '一周内',
        },
        targetRefCoverageRate: 0.5,
        targetabilitySummary: {
          stableClickTargetCount: 1,
          urlFallbackCount: 1,
          untargetableCount: 0,
          status: 'partial_stable_targets',
        },
        collectionWindow: {
          cardCount: 2,
          scrollYRange: { min: 0, max: 480 },
          viewportYRange: { min: 20, max: 360 },
          sourceStrategies: ['list_container'],
        },
      });
      const cards = objects
        .filter((object) => object.objectType === 'result_card')
        .sort((left, right) => {
          const leftRank = (left.facts as { rank?: number } | null)?.rank ?? 0;
          const rightRank = (right.facts as { rank?: number } | null)?.rank ?? 0;
          return leftRank - rightRank;
        });
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({
        parentObjectId: page?.browserObjectId,
        primaryConclusion: 'First result',
        confidenceScore: 0.86,
        canTabrixOperate: true,
        actionTypes: ['click_result_card', 'open_via_url'],
      });
      expect(cards[0].facts).toMatchObject({
        rank: 1,
        title: 'First result',
        url: 'https://example.test/note/:id',
        targetabilityStatus: 'stable_click_target',
        stableTarget: {
          targetRef: 'ref_result_card_1',
          candidateActionId: 'ca_click_ref_result_card_1',
        },
        primaryText: 'Author A',
        actionTarget: {
          actionType: 'click',
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
          openAction: {
            toolName: 'chrome_navigate',
            toolArgs: { url: 'https://example.test/note/:id' },
            executionScope: 'session_url',
            reason: 'result_card_href',
          },
          confidence: 0.9,
        },
        sessionOnlyTarget: {
          schema: 'tabrix_session_only_result_card_target_v1',
          toolName: 'chrome_click_element',
          toolArgs: {
            candidateAction: {
              targetRef: 'ref_result_card_1',
              intent: 'content.open_detail',
              locatorChain: [
                { type: 'ref', value: 'ref_result_card_1' },
                { type: 'css', value: 'body > main > article:nth-of-type(1) > a:nth-of-type(1)' },
              ],
            },
          },
          center: { x: 100, y: 56 },
          coordinateFrame: 'viewport',
          sourceScrollY: 0,
        },
        sourceWindow: {
          sourceScrollY: 0,
          sourceStrategy: 'list_container',
        },
        sourceStrategy: 'list_container',
      });
      expect(cards[0].facts).not.toMatchObject({
        actionTarget: {
          toolName: 'chrome_click_element',
          center: { x: 100, y: 56 },
        },
      });
      expect(cards[0].targetability).toMatchObject({
        targetabilityStatus: 'stable_click_target',
        stableTarget: {
          targetRef: 'ref_result_card_1',
          candidateActionId: 'ca_click_ref_result_card_1',
        },
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
        },
        sessionOnlyTarget: {
          schema: 'tabrix_session_only_result_card_target_v1',
          toolName: 'chrome_click_element',
          toolArgs: {
            candidateAction: {
              targetRef: 'ref_result_card_1',
              intent: 'content.open_detail',
            },
          },
          center: { x: 100, y: 56 },
          coordinateFrame: 'viewport',
          sourceScrollY: 0,
        },
      });
      expect(cards[0].targetability).not.toMatchObject({
        actionTarget: {
          toolName: 'chrome_click_element',
          center: { x: 100, y: 56 },
        },
      });
      expect(cards[1]).toMatchObject({
        primaryConclusion: 'Second result',
        actionTypes: ['open_via_url'],
      });
      expect(cards[1].facts).toMatchObject({
        targetabilityStatus: 'url_fallback',
        actionTarget: {
          targetKind: 'result_card_link',
          url: 'https://example.test/note/:id',
          executionScope: 'session_url',
          openAction: {
            toolName: 'chrome_navigate',
            toolArgs: { url: 'https://example.test/note/:id' },
            executionScope: 'session_url',
            reason: 'result_card_href',
          },
        },
      });
      expect(JSON.stringify(objects)).not.toContain('x=private');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps collected filter state when a later full page read refreshes the same page object', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'trace-filter-preserve-task',
        taskIntent: 'collect filtered content cards',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-filter-preserve-step-1',
        sequenceIndex: 1,
        requestParams: { tabId: 29, minResults: 10 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 120,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'AI图片创作 - 内容站',
            url: 'https://content.example/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          pageRole: 'search_results',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 29,
          requestedMinResults: 10,
          observedResultCount: 10,
          complete: true,
          status: 'complete_enough',
          filterState: {
            status: 'observed',
            appliedLabels: ['图文', '最多收藏', '一周内'],
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
          },
          cards: [
            {
              rank: 1,
              title: '内容站图文结果',
              url: 'https://content.example/explore/abc',
              imageCount: 1,
              confidence: 0.8,
            },
          ],
        }),
        resultSummary: 'collected content result cards',
      });

      await traceService.flushAsyncWrites();

      traceService.recordToolCall({
        taskId: 'trace-filter-preserve-task',
        taskIntent: 'measure full page baseline',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-filter-preserve-step-2',
        sequenceIndex: 2,
        requestParams: { tabId: 29, requestedLayer: 'L0+L1+L2' },
        requestAtMs: NOW_MS + 200,
        responseAtMs: NOW_MS + 420,
        result: textResult({
          page: {
            title: 'AI图片创作 - 内容站',
            url: 'https://content.example/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:content.example:search_results',
            chosenDataSource: 'markdown',
            tabId: 29,
          },
          browserPageObjectCompact: {
            status: 'complete',
            watchStatus: 'stable',
            operationSummary: { visibleText: true },
          },
          sourceRoute: 'markdown_snapshot',
          selectedDataSource: 'markdown',
          freshness: 'fresh',
          tabId: 29,
        }),
        resultSummary: 'full page read baseline',
      });

      await traceService.flushAsyncWrites();

      const page = browserObjectRepo
        .listRecent({ limit: 10, offset: 0 })
        .find((object) => object.objectType === 'page');

      expect(page?.facts).toMatchObject({
        filterState: {
          contentType: '图文',
          sort: '最多收藏',
          timeRange: '一周内',
        },
        observedResultCount: 10,
        requestedMinResults: 10,
        complete: true,
        lastCollectionSource: 'result_card_collection',
      });
      expect(page).toMatchObject({
        selectedDataSource: 'markdown',
        sourceRoute: 'markdown_snapshot',
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records read-page snapshot and delta summaries in page Browser Object facts', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const trace = traceService.recordToolCall({
        taskId: 'snapshot-delta-write-task',
        taskIntent: 'measure read-page object awareness',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'snapshot-delta-write-step',
        sequenceIndex: 1,
        requestParams: { tabId: 101 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 200,
        result: textResult({
          page: {
            title: 'AI搜索页面',
            url: 'https://example.test/search?keyword=ai',
          },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:example.test:search_results',
            chosenDataSource: 'markdown',
            tabId: 101,
          },
          pageContext: {
            sensingDiagnostics: {
              source: 'accessibility_tree_helper',
              coverageStatus: 'partial',
              partialErrors: [
                {
                  source: 'accessibility_tree.dynamic_surface_root.selector',
                  message: 'selector probe failed',
                  at: 1782516187000,
                },
              ],
              claimBoundary:
                'content-script diagnostics mean some low-level object-sensing probes failed; the snapshot can still be useful but should be treated as partial evidence, not business-success proof',
            },
          },
          browserPageObjectCompact: {
            status: 'complete',
            watchStatus: 'stable',
            operationSummary: { visibleText: true },
            changedGroups: ['content', 'actions'],
          },
          sourceRoute: 'markdown_snapshot',
          selectedDataSource: 'markdown',
          freshness: 'fresh',
          tabId: 101,
          pageObjectSnapshot: {
            source: 'read_page_object_snapshot',
            snapshotId: 'rpos_example_101_1',
            observedAt: '2026-06-10T10:00:30.000Z',
            pageUrl: 'https://example.test/search?keyword=ai',
            pageTitle: 'AI搜索页面',
            pageType: 'search',
            pageRole: 'search_results',
            pageState: {
              pageStability: 'stable_or_unknown',
              readiness: 'ready',
              baseUrl: 'example.test',
              frameCount: 1,
            },
            sourceProvenance: ['dom', 'cdp', 'visible_text', 'ax'],
            freshness: 'fresh',
            objects: [
              {
                objectId: 'region-search-main',
                kind: 'region',
                label: '搜索结果列表',
                regionType: 'content',
                sourceProvenance: ['dom'],
                freshness: 'fresh',
              },
            ],
            actionableTargets: [
              {
                targetId: 'target-search-first',
                label: '第一个结果',
                kind: 'link',
                targetRef: 'ref-search-result-1',
                sourceProvenance: 'dom',
                freshness: 'fresh',
              },
            ],
            objectCount: 1,
            actionableObjectCount: 1,
            claimBoundary: 'read page snapshot summary',
          },
          postActionDeltaEvidence: {
            watchId: 'watch:rpos_example_101_1',
            deltaKind: 'read_refresh_delta',
            actionId: 'act-001',
            targetObjectId: 'target-search-first',
            beforeProjectionId: 'rpos_example_101_0',
            afterProjectionId: 'rpos_example_101_1',
            producedAt: '2026-06-10T10:00:30.000Z',
            observedChangeKind: 'object_appeared',
            changedRegions: ['search_region'],
            objectDelta: {
              status: 'observed',
              changedObjectIds: ['region-search-main'],
            },
            networkSignalSummary: {
              status: 'observed',
              observedRequestCount: 9,
            },
            observedSignalDeltas: {
              requestStartedDelta: 9,
              failedRequestDelta: 1,
              errorCountDelta: 0,
              warningCountDelta: 1,
            },
            recommendedNextAction: 'continue_with_post_action_delta_context',
            claimBoundary: ['read page delta evidence'],
          },
        }),
        resultSummary: 'read-page snapshot with delta',
      });

      expect(trace.perceptionObjects).toMatchObject({
        snapshotId: 'rpos_example_101_1',
        objectCount: 1,
        actionableObjectCount: 1,
      });
      expect(trace.postObservation).toMatchObject({
        snapshotId: 'rpos_example_101_1',
        pageRole: 'search_results',
        sensingDiagnosticsSummary: {
          source: 'accessibility_tree_helper',
          coverageStatus: 'partial',
          partialErrorCount: 1,
          partialErrorSources: ['accessibility_tree.dynamic_surface_root.selector'],
        },
      });
      expect(trace.postActionDelta).toMatchObject({
        actionId: 'act-001',
        targetObjectId: 'target-search-first',
        deltaKind: 'object_appeared',
        recommendation: 'continue_with_post_action_delta_context',
      });

      await traceService.flushAsyncWrites();

      const page = browserObjectRepo
        .listRecent({ limit: 10, offset: 0 })
        .find((object) => object.objectType === 'page');

      expect(page?.facts).toMatchObject({
        snapshotSequence: 1,
      });
      expect(page?.evidenceRefs).toMatchObject([
        'read_page_object_snapshot:rpos_example_101_1',
        'post_action_delta_evidence:rpos_example_101_1',
      ]);
      expect(page?.recentEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventType: 'page_object_snapshot',
            snapshotId: 'rpos_example_101_1',
          }),
          expect.objectContaining({
            eventType: 'post_action_delta_evidence',
            actionId: 'act-001',
            targetObjectId: 'target-search-first',
            afterProjectionId: 'rpos_example_101_1',
          }),
        ]),
      );
      expect(page?.facts).toMatchObject({
        pageObjectSnapshotSummary: {
          snapshotId: 'rpos_example_101_1',
          objectCount: 1,
          actionableObjectCount: 1,
          sourceProvenance: ['dom', 'cdp', 'visible_text', 'ax'],
        },
        sensingDiagnosticsSummary: {
          source: 'accessibility_tree_helper',
          coverageStatus: 'partial',
          partialErrorCount: 1,
          partialErrorSources: ['accessibility_tree.dynamic_surface_root.selector'],
        },
        pageDeltaSummary: {
          actionId: 'act-001',
          targetObjectId: 'target-search-first',
          deltaKind: 'object_appeared',
          recommendation: 'continue_with_post_action_delta_context',
          changedRegionsCount: 1,
          changedObjectCount: 1,
          networkSignalsCount: 2,
          consoleSignalsCount: 2,
        },
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records AI-facing read-page source route and selected data source in Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'read-page-ai-source-task',
        taskIntent: 'read the current page with object awareness',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'read-page-ai-source-step',
        sequenceIndex: 1,
        requestParams: { tabId: 404 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 220,
        result: textResult({
          page: {
            title: 'Actions documentation',
            url: 'https://docs.example/actions',
          },
          summary: { pageRole: 'multi_region_page', quality: 'fresh' },
          pageProjection: {
            pageRole: 'multi_region_page',
            pageModelKey: 'page:docs.example:multi_region_page',
            chosenDataSource: 'markdown',
            tabId: 404,
          },
          selectedDataSource: 'dom_region_rows',
          sourceRouteHonesty: { verdict: 'dom_fallback' },
          freshness: 'fresh',
          tabId: 404,
          pageObjectSnapshot: {
            snapshotId: 'rpos_docs_404_1',
            pageRole: 'multi_region_page',
            sourceProvenance: ['dom', 'ax', 'cdp'],
            actionableTargets: [
              {
                targetId: 'target-doc-search',
                targetRef: 'ref-doc-search',
                label: 'Search docs',
                kind: 'input',
                sourceProvenanceDetail: ['dom', 'ax', 'cdp', 'coordinates'],
                locatorChain: [{ type: 'aria', value: 'Search docs' }],
              },
            ],
            objectCount: 1,
            actionableObjectCount: 1,
          },
          candidateActions: [
            {
              id: 'target-doc-search',
              targetRef: 'ref-doc-search',
              actionType: 'fill',
              label: 'Search docs',
              locatorChain: [{ type: 'aria', value: 'Search docs' }],
              actionability: true,
            },
          ],
        }),
        resultSummary: 'read-page with AI-facing source choice',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 20, offset: 0 });
      const page = objects.find((object) => object.objectType === 'page');
      const actionTarget = objects.find((object) => object.objectType === 'action_target');

      expect(page).toMatchObject({
        objectType: 'page',
        sourceRoute: 'dom_fallback',
        selectedDataSource: 'dom_region_rows',
        sourceFreshness: 'fresh',
      });
      expect(actionTarget).toMatchObject({
        objectType: 'action_target',
        sourceRoute: 'dom_fallback',
        selectedDataSource: 'dom_region_rows',
        sourceFreshness: 'fresh',
      });
      expect(actionTarget?.facts).toMatchObject({
        sourceProvenance: ['dom', 'ax', 'cdp'],
      });
      expect(JSON.stringify(actionTarget)).not.toContain('coordinates');
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects read-page region child objects into the Object Library graph', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'read-page-region-child-object-task',
        taskIntent: 'read a search results page as structured browser objects',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'read-page-region-child-object-step',
        sequenceIndex: 1,
        requestParams: { tabId: 303 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 180,
        result: textResult({
          page: {
            title: 'AI image creation search',
            url: 'https://example.test/search?keyword=ai-image',
          },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:example.test:search_results',
            chosenDataSource: 'dom',
            tabId: 303,
          },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 303,
          pageRegions: [
            {
              regionId: 'region_result_list',
              regionType: 'result_list',
              state: 'content_available_candidate',
              targetability: 'target_ref',
              confidence: 0.86,
              objects: [
                {
                  objectId: 'container_result_list',
                  objectType: 'container',
                  containerKind: 'result_list',
                  label: 'visible result list',
                  actionTypes: ['open_detail'],
                  sourceProvenance: ['dom', 'visible_text'],
                  freshness: 'fresh',
                  confidence: 0.8,
                },
                {
                  objectId: 'ref_card_1',
                  objectType: 'result_card',
                  parentObjectId: 'container_result_list',
                  label: 'Practical guide to AI image creation',
                  role: 'card',
                  targetRef: 'ref_card_1',
                  actionTypes: ['open_detail'],
                  sourceProvenance: ['dom', 'visible_text'],
                  freshness: 'fresh',
                  confidence: 0.88,
                  detailTarget: {
                    targetRef: 'ref_card_1',
                    candidateActionId: 'ca_click_ref_card_1',
                    actionType: 'click',
                    intent: 'content.open_detail',
                    locatorChain: [
                      { type: 'ref', value: 'ref_card_1' },
                      { type: 'css', value: 'article:nth-of-type(1) a[href]' },
                    ],
                    toolName: 'chrome_click_element',
                  },
                },
              ],
              candidateActionIds: ['ca_click_ref_card_1'],
            },
          ],
        }),
        resultSummary: 'read-page structured result list',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 20, offset: 0 });
      const page = objects.find((object) => object.objectType === 'page');
      const region = objects.find(
        (object) => object.objectType === 'region' && object.facts?.regionType === 'result_list',
      );
      const container = objects.find(
        (object) =>
          object.objectType === 'container' && object.facts?.containerKind === 'result_list',
      );
      const card = objects.find((object) => object.objectType === 'result_card');

      expect(page?.pageModelKey).toBe('page:example.test:search_results');
      expect(region?.parentObjectId).toBe(page?.browserObjectId);
      expect(container).toMatchObject({
        parentObjectId: page?.browserObjectId,
        actionTypes: ['open_detail'],
        sourceFreshness: 'fresh',
      });
      expect(container?.facts).toMatchObject({
        regionId: 'region_result_list',
        regionType: 'result_list',
        containerKind: 'result_list',
        label: 'visible result list',
        sourceProvenance: ['dom', 'visible_text'],
      });
      expect(card).toMatchObject({
        parentObjectId: container?.browserObjectId,
        objectType: 'result_card',
        actionTypes: ['open_detail'],
      });
      expect(card?.targetability).toMatchObject({
        targetRef: 'ref_card_1',
        detailTarget: {
          targetRef: 'ref_card_1',
          candidateActionId: 'ca_click_ref_card_1',
          intent: 'content.open_detail',
          toolName: 'chrome_click_element',
        },
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects snapshot-only page objects and action targets into the Object Library graph', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'read-page-snapshot-only-object-task',
        taskIntent: 'read a page object snapshot without top-level regions',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'read-page-snapshot-only-object-step',
        sequenceIndex: 1,
        requestParams: { tabId: 404 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 120,
        result: textResult({
          page: {
            title: 'Snapshot only search',
            url: 'https://example.test/search?keyword=snapshot',
          },
          summary: { pageRole: 'search_results', quality: 'fresh' },
          pageProjection: {
            pageRole: 'search_results',
            pageModelKey: 'page:example.test:search_results',
            chosenDataSource: 'dom',
            tabId: 404,
          },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 404,
          pageObjectSnapshot: {
            snapshotId: 'snapshot_only_404_1',
            observedAt: new Date(NOW_MS + 120).toISOString(),
            pageType: 'search_results',
            pageRole: 'search_results',
            pageUrl: 'https://example.test/search?keyword=snapshot',
            pageState: {
              readiness: 'ready',
              baseUrl: 'https://example.test/search',
              frameCount: 1,
            },
            freshness: 'fresh',
            objectCount: 2,
            actionableObjectCount: 1,
            sourceProvenance: ['dom', 'ax'],
            objects: [
              {
                objectId: 'snapshot_search_box',
                objectType: 'search_area',
                label: 'Search',
                role: 'textbox',
                targetRef: 'ref_search_box',
                targetability: 'locator_chain',
                actionTypes: ['input'],
                sourceProvenance: ['ax'],
                freshness: 'fresh',
                confidence: 0.91,
              },
              {
                objectId: 'snapshot_result_card_1',
                objectType: 'result_card',
                label: 'Snapshot result card',
                role: 'card',
                targetRef: 'ref_result_card_1',
                targetability: 'target_ref',
                actionTypes: ['open_detail'],
                sourceProvenance: ['dom', 'visible_text'],
                freshness: 'fresh',
                confidence: 0.88,
                detailTarget: {
                  targetRef: 'ref_result_card_1',
                  candidateActionId: 'ca_open_snapshot_result_1',
                  actionType: 'click',
                  intent: 'content.open_detail',
                  toolName: 'chrome_click_element',
                },
              },
            ],
            actionableTargets: [
              {
                targetId: 'ca_open_snapshot_result_1',
                targetRef: 'ref_result_card_1',
                actionType: 'click',
                actionability: 'actionable',
                intent: 'content.open_detail',
                matchReason: 'snapshot detail target',
              },
              {
                targetId: 'ca_disabled_snapshot_item',
                targetRef: 'ref_disabled_item',
                actionType: 'click',
                actionability: 'not_clickable',
                intent: 'content.open_detail',
                matchReason: 'snapshot item is visible but not clickable',
              },
            ],
          },
        }),
        resultSummary: 'read-page snapshot-only objects',
      });

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 20, offset: 0 });
      const page = objects.find((object) => object.objectType === 'page');
      const syntheticRegion = objects.find(
        (object) => object.objectType === 'region' && object.facts?.regionType === 'page_objects',
      );
      const searchBox = objects.find((object) => object.objectType === 'search_area');
      const resultCard = objects.find((object) => object.objectType === 'result_card');
      const actionTarget = objects.find(
        (object) =>
          object.objectType === 'action_target' &&
          object.targetability?.targetRef === 'ref_result_card_1',
      );
      const disabledActionTarget = objects.find(
        (object) =>
          object.objectType === 'action_target' &&
          object.targetability?.targetRef === 'ref_disabled_item',
      );

      expect(page).toMatchObject({
        pageModelKey: 'page:example.test:search_results',
      });
      expect(page?.facts).toMatchObject({
        pageObjectSnapshotSummary: {
          snapshotId: 'snapshot_only_404_1',
          objectCount: 2,
          actionableObjectCount: 1,
          pageState: {
            baseUrl: 'https://example.test/search',
          },
        },
      });
      expect(syntheticRegion).toMatchObject({
        parentObjectId: page?.browserObjectId,
        objectType: 'region',
      });
      expect(syntheticRegion?.facts).toMatchObject({
        regionType: 'page_objects',
        layoutHint: 'snapshot',
        candidateActionCount: 2,
      });
      expect(searchBox).toMatchObject({
        parentObjectId: page?.browserObjectId,
        actionTypes: ['input'],
        sourceFreshness: 'fresh',
        canTabrixOperate: true,
      });
      expect(searchBox?.facts).toMatchObject({
        regionId: 'page-object-snapshot',
        sourceProvenance: ['ax'],
        label: 'Search',
      });
      expect(resultCard?.targetability).toMatchObject({
        targetRef: 'ref_result_card_1',
        detailTarget: {
          candidateActionId: 'ca_open_snapshot_result_1',
          toolName: 'chrome_click_element',
        },
      });
      expect(resultCard?.canTabrixOperate).toBe(true);
      expect(actionTarget).toMatchObject({
        objectType: 'action_target',
        canTabrixOperate: true,
      });
      expect(actionTarget?.targetability).toMatchObject({
        targetRef: 'ref_result_card_1',
      });
      expect(disabledActionTarget).toMatchObject({
        objectType: 'action_target',
        canTabrixOperate: false,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps one stable page object per Base URL and page type across tabs', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      for (const [index, tabId] of [201, 202].entries()) {
        traceService.recordToolCall({
          taskId: 'base-url-object-task',
          taskIntent: 'read same search page from different tabs',
          aiClient: 'jest',
          toolName: 'chrome_read_page',
          stepId: `base-url-object-step-${index + 1}`,
          sequenceIndex: index + 1,
          requestParams: { tabId },
          requestAtMs: NOW_MS + index * 1000,
          responseAtMs: NOW_MS + index * 1000 + 80,
          result: textResult({
            page: {
              title: index === 0 ? 'Search A' : 'Search B',
              url:
                index === 0
                  ? 'https://example.test/search?keyword=ai'
                  : 'https://example.test/search?keyword=browser',
            },
            summary: { pageRole: 'search_results', quality: 'fresh' },
            pageProjection: {
              pageRole: 'search_results',
              pageModelKey: 'page:example.test:search_results',
              chosenDataSource: 'markdown',
              tabId,
            },
            browserPageObjectCompact: {
              status: 'complete',
              watchStatus: 'stable',
              operationSummary: { visibleText: true },
            },
            sourceRoute: 'markdown_snapshot',
            selectedDataSource: 'markdown',
            freshness: 'fresh',
            tabId,
          }),
          resultSummary: 'same base url page read',
        });
      }

      await traceService.flushAsyncWrites();

      const pages = browserObjectRepo
        .listRecent({ limit: 20, offset: 0 })
        .filter((object) => object.objectType === 'page');
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        siteFamily: 'example.test',
        pageModelKey: 'page:example.test:search_results',
        rootRoute: 'https://example.test/search',
        objectFingerprint:
          'page:example.test:page:example.test:search_results:https://example.test/search',
        observationCount: 2,
        tabId: 202,
      });
      expect(pages[0]?.facts).toMatchObject({
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?keyword=browser',
        lastObservedTabId: 202,
      });
      expect(pages[0]?.currentState).toMatchObject({
        tabId: 202,
        currentRoute: 'https://example.test/search?keyword=browser',
      });
      expect(pages[0]?.sourceTraceIds).toHaveLength(2);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps action-target identity stable when targetRef drifts but semantic locator stays stable', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      for (const [index, targetRef] of ['ref_search_input_a', 'ref_search_input_b'].entries()) {
        traceService.recordToolCall({
          taskId: 'stable-action-target-task',
          taskIntent: 'read search input target across refreshed snapshots',
          aiClient: 'jest',
          toolName: 'chrome_read_page',
          stepId: `stable-action-target-step-${index + 1}`,
          sequenceIndex: index + 1,
          requestParams: { tabId: 707 },
          requestAtMs: NOW_MS + index * 1000,
          responseAtMs: NOW_MS + index * 1000 + 90,
          result: textResult({
            page: {
              title: 'Search page',
              url: 'https://example.test/search?keyword=ai',
            },
            summary: { pageRole: 'search_results', quality: 'fresh' },
            pageProjection: {
              pageRole: 'search_results',
              pageModelKey: 'page:example.test:search_results',
              chosenDataSource: 'dom',
              tabId: 707,
            },
            sourceRoute: 'dom_snapshot',
            selectedDataSource: 'dom',
            freshness: 'fresh',
            tabId: 707,
            candidateActions: [
              {
                targetId: `ca_search_${index + 1}`,
                targetRef,
                actionType: 'input',
                label: 'Search',
                actionability: 'actionable',
                actionabilityReason: 'visible input is enabled',
                intent: 'search.enter_query',
                intentBoundary: 'Search input only; submit separately.',
                matchReason: 'visible_search_input',
                visibility: {
                  source: 'mixed',
                  domVisible: true,
                  inViewport: true,
                  centerHitTarget: true,
                  occluded: false,
                  reason: 'dom_and_cdp_box_model',
                },
                nextRequiredTool: 'chrome_keyboard',
                nextRequiredSelector: 'input[aria-label="Search"]',
                nextRequiredSelectorSource: 'candidate_action_locator',
                nextRequiredCheck: 'Search query should be visible before submitting.',
                sourceProvenanceDetail: ['dom', 'cdp', 'ax'],
                locatorChain: [
                  { type: 'ref', value: targetRef },
                  { type: 'css', value: 'input[aria-label="Search"]' },
                ],
              },
            ],
          }),
          resultSummary: 'read search target with drifting ref',
        });
      }

      await traceService.flushAsyncWrites();

      const actionTargets = browserObjectRepo
        .listRecent({ limit: 20, offset: 0 })
        .filter((object) => object.objectType === 'action_target');

      expect(actionTargets).toHaveLength(1);
      expect(actionTargets[0]).toMatchObject({
        objectType: 'action_target',
        observationCount: 2,
        objectFingerprint:
          'action_target:page:example.test:search_results:https://example.test/search:input:search.enter_query:Search:visible_search_input:css=input[aria-label="Search"]',
      });
      expect(actionTargets[0]?.targetability).toMatchObject({
        targetRef: 'ref_search_input_b',
        identityKey:
          'input:search.enter_query:Search:visible_search_input:css=input[aria-label="Search"]',
        actionTarget: {
          targetRef: 'ref_search_input_b',
          locatorChain: [
            { type: 'ref', value: 'ref_search_input_b' },
            { type: 'css', value: 'input[aria-label="Search"]' },
          ],
          nextRequiredTool: 'chrome_keyboard',
          nextRequiredSelector: 'input[aria-label="Search"]',
          nextRequiredSelectorSource: 'candidate_action_locator',
          nextRequiredCheck: 'Search query should be visible before submitting.',
        },
        execution: {
          actionability: 'actionable',
          actionabilityReason: 'visible input is enabled',
          visibility: {
            source: 'mixed',
            domVisible: true,
            inViewport: true,
            centerHitTarget: true,
            occluded: false,
          },
        },
      });
      expect(actionTargets[0]?.facts).toMatchObject({
        intent: 'search.enter_query',
        label: 'Search',
        stableLocatorChain: ['css=input[aria-label="Search"]'],
        sourceProvenance: ['dom', 'cdp', 'ax'],
        expectedResult: 'Search query should be visible before submitting.',
        actionability: 'actionable',
        actionabilityReason: 'visible input is enabled',
      });
      expect(actionTargets[0]?.sourceTraceIds).toHaveLength(2);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('does not use pure region-object index as reusable identity when objectId is missing', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const recordReadPage = (input: {
        suffix: string;
        sequenceIndex: number;
        objects: Array<Record<string, unknown>>;
      }) => {
        traceService.recordToolCall({
          taskId: 'region-object-identity-task',
          taskIntent: 'read filter panel objects across layout changes',
          aiClient: 'jest',
          toolName: 'chrome_read_page',
          stepId: `region-object-identity-step-${input.suffix}`,
          sequenceIndex: input.sequenceIndex,
          requestParams: { tabId: 808 },
          requestAtMs: NOW_MS + input.sequenceIndex * 1000,
          responseAtMs: NOW_MS + input.sequenceIndex * 1000 + 100,
          result: textResult({
            page: {
              title: 'Search filters',
              url: 'https://example.test/search?keyword=ai',
            },
            summary: { pageRole: 'search_results', quality: 'fresh' },
            pageProjection: {
              pageRole: 'search_results',
              pageModelKey: 'page:example.test:search_results',
              chosenDataSource: 'dom',
              tabId: 808,
            },
            sourceRoute: 'dom_snapshot',
            selectedDataSource: 'dom',
            freshness: 'fresh',
            tabId: 808,
            pageRegions: [
              {
                regionId: 'filters',
                regionType: 'filters',
                layoutHint: 'filter_panel',
                state: 'observed',
                readiness: 'ready',
                targetability: true,
                objects: input.objects,
              },
            ],
          }),
          resultSummary: 'read filter panel objects without object ids',
        });
      };

      const applyFilterButton = (targetRef: string) => ({
        objectType: 'button',
        role: 'button',
        label: 'Apply filters',
        targetRef,
        targetability: true,
        actionTypes: ['click'],
        sourceProvenance: ['dom', 'ax'],
        detailTarget: {
          targetRef,
          locatorChain: [
            { type: 'ref', value: targetRef },
            { type: 'css', value: 'button[data-filter-apply]' },
          ],
        },
      });

      recordReadPage({
        suffix: 'first',
        sequenceIndex: 1,
        objects: [applyFilterButton('ref_apply_a')],
      });
      recordReadPage({
        suffix: 'second',
        sequenceIndex: 2,
        objects: [
          {
            objectType: 'button',
            role: 'button',
            label: 'Reset filters',
            targetRef: 'ref_reset',
            targetability: true,
            actionTypes: ['click'],
            detailTarget: {
              targetRef: 'ref_reset',
              locatorChain: [
                { type: 'ref', value: 'ref_reset' },
                { type: 'css', value: 'button[data-filter-reset]' },
              ],
            },
          },
          applyFilterButton('ref_apply_b'),
        ],
      });

      await traceService.flushAsyncWrites();

      const buttons = browserObjectRepo
        .listRecent({ limit: 20, offset: 0 })
        .filter((object) => object.objectType === 'button');
      const applyButton = buttons.find((object) => object.facts?.label === 'Apply filters');
      const resetButton = buttons.find((object) => object.facts?.label === 'Reset filters');

      expect(buttons).toHaveLength(2);
      expect(applyButton).toMatchObject({
        observationCount: 2,
        objectFingerprint:
          'region_object:page:example.test:search_results:https://example.test/search:filters:filters:button:button:Apply filters:css=button[data-filter-apply]',
      });
      expect(applyButton?.targetability).toMatchObject({
        targetRef: 'ref_apply_b',
      });
      expect(resetButton).toMatchObject({
        observationCount: 1,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('projects ContentSite Top 10 result cards as stable clickable Browser Objects', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const cards = Array.from({ length: 10 }, (_, index) => {
        const rank = index + 1;
        const targetRef = `ref_result_card_${rank}`;
        const candidateActionId = `ca_click_${targetRef}`;
        const noteId = `content-note-${rank}`;
        return {
          rank,
          title: `AI图片创作图文 ${rank}`,
          url: `https://content.example/explore/${noteId}?xsec_token=private-${rank}`,
          targetRef,
          candidateActionId,
          targetabilityStatus: 'stable_click_target',
          actionTarget: {
            actionType: 'click',
            targetKind: 'result_card_link',
            url: `https://content.example/explore/${noteId}?xsec_token=private-${rank}`,
            selector: `section.note-list article:nth-of-type(${rank}) a[href]`,
            text: `AI图片创作图文 ${rank}`,
            executionScope: 'same_tab_fresh_snapshot',
            openAction: {
              toolName: 'chrome_navigate',
              toolArgs: {
                url: `https://content.example/explore/${noteId}?xsec_token=private-${rank}`,
              },
              executionScope: 'session_url',
              reason: 'result_card_href',
              confidence: 0.9,
            },
            toolName: 'chrome_click_element',
            toolArgs: {
              candidateAction: {
                id: candidateActionId,
                actionType: 'click',
                targetRef,
                label: `AI图片创作图文 ${rank}`,
                confidence: 0.91,
                matchReason: 'result_card_primary_link',
                intent: 'content.open_detail',
                locatorChain: [
                  { type: 'ref', value: targetRef },
                  { type: 'css', value: `section.note-list article:nth-of-type(${rank}) a[href]` },
                ],
              },
            },
            rect: { x: 40, y: 80 + rank * 12, width: 220, height: 36 },
            center: { x: 150, y: 98 + rank * 12 },
            coordinateFrame: 'viewport',
            sourceScrollY: rank <= 5 ? 0 : 720,
            confidence: 0.91,
            reasons: ['title_link_match'],
          },
          primaryText: `作者 ${rank}`,
          interactionText: `${rank * 100} 收藏`,
          imageCount: 1,
          sourceScrollY: rank <= 5 ? 0 : 720,
          rect: { x: 20, y: 60 + rank * 18, width: 260, height: 160 },
          confidence: 0.86,
          reasons: ['link_present', 'media_present', 'multi_line_card_text'],
        };
      });
      const cardCandidateActions = cards.map((card) => ({
        id: card.candidateActionId,
        actionType: 'click',
        targetRef: card.targetRef,
        label: card.title,
        intent: 'content.open_detail',
        matchReason: 'result_card_primary_link',
        actionability: true,
        locatorChain: [
          { type: 'ref', value: card.targetRef },
          { type: 'css', value: `section.note-list article:nth-of-type(${card.rank}) a[href]` },
        ],
      }));
      const pageRegions = [
        {
          regionId: 'search_input',
          regionType: 'search',
          layoutHint: 'visible_search_control',
          state: 'observed',
          readiness: 'ready',
          targetability: true,
          candidateActionIds: ['ca_fill_ref_search_input_content'],
        },
        {
          regionId: 'search_filters',
          regionType: 'filters',
          layoutHint: 'visible_or_inferred_filter_state',
          state: 'observed',
          readiness: 'ready',
          targetability: false,
          candidateActionIds: [],
        },
        {
          regionId: 'result_list',
          regionType: 'results',
          layoutHint: 'visible_result_card_grid_or_list',
          state: 'observed',
          readiness: 'ready',
          targetability: true,
          candidateActionIds: cardCandidateActions.map((action) => action.id),
        },
      ];
      const candidateActions = [
        {
          id: 'ca_fill_ref_search_input_content',
          actionType: 'fill',
          targetRef: 'ref_search_input_content',
          label: '搜索输入框',
          intent: 'search.enter_query',
          matchReason: 'visible_search_input',
          actionability: true,
          locatorChain: [
            { type: 'ref', value: 'ref_search_input_content' },
            { type: 'css', value: 'input[type="search"]' },
          ],
        },
        ...cardCandidateActions,
      ];

      const top10Trace = traceService.recordToolCall({
        taskId: 'trace-content-top10-task',
        taskIntent: 'collect ContentSite AI图片创作 most collected image-text cards from this week',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-content-top10-step',
        sequenceIndex: 1,
        requestParams: { tabId: 66, minResults: 10, maxScrolls: 4, startFromTop: true },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 1600,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'AI图片创作 - 内容站',
            url: 'https://content.example/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          pageRole: 'search_results',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 66,
          requestedMinResults: 10,
          observedResultCount: 10,
          targetRefCoverageRate: 1,
          targetabilitySummary: {
            stableClickTargetCount: 10,
            urlFallbackCount: 0,
            untargetableCount: 0,
            targetRefCoverageRate: 1,
            status: 'stable_target_set',
          },
          complete: true,
          status: 'complete_enough',
          filterState: {
            status: 'observed',
            appliedLabels: ['图文', '最多收藏', '一周内'],
            contentType: '图文',
            sort: '最多收藏',
            timeRange: '一周内',
          },
          pageRegions,
          candidateActions,
          cards,
        }),
        resultSummary: 'collected content top 10 stable result cards',
      });

      expect(top10Trace.perceptionObjects).toMatchObject({
        kind: 'result_card_collection',
        observedResultCount: 10,
        targetRefCoverageRate: 1,
        targetabilityStatus: 'stable_target_set',
        cards: expect.arrayContaining([
          expect.objectContaining({
            rank: 1,
            title: 'AI图片创作图文 1',
            stableTarget: {
              targetRef: 'ref_result_card_1',
              candidateActionId: 'ca_click_ref_result_card_1',
            },
          }),
        ]),
      });
      expect(top10Trace.actionTarget).toMatchObject({
        stableTargetCount: 10,
        urlFallbackCount: 0,
        untargetableCount: 0,
        primaryTargets: expect.arrayContaining([
          {
            targetRef: 'ref_result_card_1',
            candidateActionId: 'ca_click_ref_result_card_1',
          },
        ]),
      });
      expect(JSON.stringify(top10Trace.perceptionObjects)).not.toContain('xsec_token');
      expect(JSON.stringify(top10Trace.perceptionObjects)).not.toContain('private-1');

      await traceService.flushAsyncWrites();

      const objects = browserObjectRepo.listRecent({ limit: 80, offset: 0 });
      const page = objects.find((object) => object.objectType === 'page');
      expect(page).toMatchObject({
        siteFamily: 'content.example',
        pageRole: 'search_results',
        selectedDataSource: 'visible_dom_result_cards',
        lifecycleState: 'complete',
        canTabrixOperate: true,
      });
      expect(page?.facts).toMatchObject({
        observedResultCount: 10,
        requestedMinResults: 10,
        complete: true,
        targetRefCoverageRate: 1,
        targetabilitySummary: {
          stableClickTargetCount: 10,
          urlFallbackCount: 0,
          untargetableCount: 0,
          status: 'stable_target_set',
        },
        filterState: {
          contentType: '图文',
          sort: '最多收藏',
          timeRange: '一周内',
        },
      });

      const resultCards = objects
        .filter((object) => object.objectType === 'result_card')
        .sort((left, right) => {
          const leftRank = (left.facts as { rank?: number } | null)?.rank ?? 0;
          const rightRank = (right.facts as { rank?: number } | null)?.rank ?? 0;
          return leftRank - rightRank;
        });
      expect(resultCards).toHaveLength(10);
      const regions = objects.filter((object) => object.objectType === 'region');
      expect(regions.map((object) => object.objectFingerprint).sort()).toEqual(
        expect.arrayContaining([
          'region:page:content.example:search_results:https://content.example/search_result:result_list',
          'region:page:content.example:search_results:https://content.example/search_result:search_filters',
          'region:page:content.example:search_results:https://content.example/search_result:search_input',
        ]),
      );
      const actionTargets = objects.filter((object) => object.objectType === 'action_target');
      expect(actionTargets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            objectFingerprint:
              'action_target:page:content.example:search_results:https://content.example/search_result:fill:search.enter_query:搜索输入框:visible_search_input:css=input[type="search"]',
            canTabrixOperate: true,
            actionTypes: ['fill'],
          }),
          expect.objectContaining({
            objectFingerprint:
              'action_target:page:content.example:search_results:https://content.example/search_result:click:content.open_detail:AI图片创作图文 1:result_card_primary_link:css=section.note-list article:nth-of-type(1) a[href]',
            canTabrixOperate: true,
            actionTypes: ['click'],
          }),
        ]),
      );
      for (const [index, object] of resultCards.entries()) {
        const rank = index + 1;
        expect(object).toMatchObject({
          parentObjectId: page?.browserObjectId,
          primaryConclusion: `AI图片创作图文 ${rank}`,
          canTabrixOperate: true,
          actionTypes: ['click_result_card', 'open_via_url'],
        });
        expect(object.facts).toMatchObject({
          rank,
          title: `AI图片创作图文 ${rank}`,
          targetabilityStatus: 'stable_click_target',
          stableTarget: {
            targetRef: `ref_result_card_${rank}`,
            candidateActionId: `ca_click_ref_result_card_${rank}`,
          },
          sessionOnlyTarget: {
            schema: 'tabrix_session_only_result_card_target_v1',
            toolName: 'chrome_click_element',
            toolArgs: {
              candidateAction: {
                targetRef: `ref_result_card_${rank}`,
                intent: 'content.open_detail',
                locatorChain: [
                  { type: 'ref', value: `ref_result_card_${rank}` },
                  { type: 'css', value: `section.note-list article:nth-of-type(${rank}) a[href]` },
                ],
              },
            },
          },
        });
        expect(JSON.stringify(object)).not.toContain('xsec_token');
        expect(JSON.stringify(object)).not.toContain(`private-${rank}`);
      }

      traceService.recordToolCall({
        taskId: 'trace-content-top10-task-rerank',
        taskIntent: 'collect ContentSite AI图片创作 cards after result order changed',
        aiClient: 'jest',
        toolName: 'chrome_collect_result_cards',
        stepId: 'trace-content-top10-step-rerank',
        sequenceIndex: 2,
        requestParams: { tabId: 66, minResults: 10, maxScrolls: 4, startFromTop: true },
        requestAtMs: NOW_MS + 2000,
        responseAtMs: NOW_MS + 3200,
        result: textResult({
          success: true,
          kind: 'result_card_collection',
          page: {
            title: 'AI图片创作 - 内容站',
            url: 'https://content.example/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          },
          pageRole: 'search_results',
          pageState: 'complete',
          sourceRoute: 'visible_dom_cards_bounded_scroll',
          selectedDataSource: 'visible_dom_result_cards',
          freshness: 'fresh',
          tabId: 66,
          requestedMinResults: 10,
          observedResultCount: 10,
          targetRefCoverageRate: 1,
          targetabilitySummary: {
            stableClickTargetCount: 10,
            urlFallbackCount: 0,
            untargetableCount: 0,
            targetRefCoverageRate: 1,
            status: 'stable_target_set',
          },
          complete: true,
          status: 'complete_enough',
          cards: cards
            .slice()
            .reverse()
            .map((card, index) => ({ ...card, rank: index + 1 })),
        }),
        resultSummary: 'collected content top 10 stable result cards after rerank',
      });
      await traceService.flushAsyncWrites();

      const objectsAfterRerank = browserObjectRepo.listRecent({ limit: 80, offset: 0 });
      const resultCardsAfterRerank = objectsAfterRerank.filter(
        (object) => object.objectType === 'result_card',
      );
      expect(resultCardsAfterRerank).toHaveLength(10);
      const firstCardAfterRerank = resultCardsAfterRerank.find(
        (object) => object.primaryConclusion === 'AI图片创作图文 1',
      );
      expect(firstCardAfterRerank?.facts).toMatchObject({
        stableTarget: {
          targetRef: 'ref_result_card_1',
          candidateActionId: 'ca_click_ref_result_card_1',
        },
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('keeps result-card identity stable when rank and targetRef drift', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      const recordCollectedCards = (input: {
        traceSuffix: string;
        sequenceIndex: number;
        rank: number;
        targetRef: string;
        candidateActionId: string;
        sourceScrollY: number;
        firstSeenGlobalTop: number;
        observedAtOffsetMs: number;
      }) => {
        traceService.recordToolCall({
          taskId: 'result-card-identity-task',
          taskIntent: 'collect stable result cards across scroll refreshes',
          aiClient: 'jest',
          toolName: 'chrome_collect_result_cards',
          stepId: `result-card-identity-step-${input.traceSuffix}`,
          sequenceIndex: input.sequenceIndex,
          requestParams: { tabId: 909 },
          requestAtMs: NOW_MS + input.observedAtOffsetMs,
          responseAtMs: NOW_MS + input.observedAtOffsetMs + 120,
          result: textResult({
            page: {
              title: 'Search results',
              url: 'https://content.example/search?query=ai',
            },
            pageProjection: {
              pageRole: 'search_results',
              pageModelKey: 'page:content.example:search_results',
              tabId: 909,
            },
            freshness: 'fresh',
            sourceRoute: 'result_cards',
            selectedDataSource: 'dom',
            tabId: 909,
            cards: [
              {
                rank: input.rank,
                title: 'Stable AI image creation guide',
                url: 'https://content.example/explore/stable-guide?private=value',
                targetRef: input.targetRef,
                candidateActionId: input.candidateActionId,
                actionTarget: {
                  actionType: 'click',
                  targetKind: 'result_card_link',
                  url: 'https://content.example/explore/stable-guide?private=value',
                  selector: `article:nth-of-type(${input.rank}) a[href]`,
                  text: 'Stable AI image creation guide',
                  toolName: 'chrome_click_element',
                  toolArgs: {
                    candidateAction: {
                      id: input.candidateActionId,
                      actionType: 'click',
                      targetRef: input.targetRef,
                      label: 'Stable AI image creation guide',
                      confidence: 0.91,
                      matchReason: 'result_card_primary_link',
                      intent: 'content.open_detail',
                      locatorChain: [
                        { type: 'ref', value: input.targetRef },
                        { type: 'css', value: `article:nth-of-type(${input.rank}) a[href]` },
                      ],
                    },
                  },
                },
                confidence: 0.86,
                sourceScrollY: input.sourceScrollY,
                firstSeenGlobalTop: input.firstSeenGlobalTop,
                sourceStrategy: 'list_container',
              },
            ],
          }),
          resultSummary: 'collected result card with drifting session refs',
        });
      };

      recordCollectedCards({
        traceSuffix: 'first',
        sequenceIndex: 1,
        rank: 1,
        targetRef: 'ref_result_card_1',
        candidateActionId: 'ca_card_first',
        sourceScrollY: 0,
        firstSeenGlobalTop: 120,
        observedAtOffsetMs: 0,
      });
      recordCollectedCards({
        traceSuffix: 'second',
        sequenceIndex: 2,
        rank: 7,
        targetRef: 'ref_result_card_7_after_scroll',
        candidateActionId: 'ca_card_second',
        sourceScrollY: 720,
        firstSeenGlobalTop: 1840,
        observedAtOffsetMs: 1000,
      });

      await traceService.flushAsyncWrites();

      const cards = browserObjectRepo
        .listRecent({ limit: 20, offset: 0 })
        .filter((object) => object.objectType === 'result_card');

      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({
        objectType: 'result_card',
        observationCount: 2,
        objectFingerprint:
          'result_card:page:content.example:search_results:https://content.example/search:https://content.example/explore/stable-guide:Stable AI image creation guide',
      });
      expect(cards[0]?.targetability).toMatchObject({
        rank: 7,
        targetabilityStatus: 'stable_click_target',
        sourceWindow: {
          sourceScrollY: 720,
          firstSeenGlobalTop: 1840,
          sourceStrategy: 'list_container',
        },
      });
      expect(cards[0]?.facts).toMatchObject({
        sourceWindow: {
          sourceScrollY: 720,
          firstSeenGlobalTop: 1840,
          sourceStrategy: 'list_container',
        },
      });
      expect(cards[0]?.sourceTraceIds).toHaveLength(2);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('rolls back read_page Browser Object writes when a child object write fails', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const originalUpsert = browserObjectRepo.upsert.bind(browserObjectRepo);
    let upsertCalls = 0;
    const upsertSpy = jest
      .spyOn(browserObjectRepo, 'upsert')
      .mockImplementation((input: BrowserObjectInput) => {
        upsertCalls += 1;
        if (upsertCalls === 2) {
          throw new Error('forced child object write failure');
        }
        return originalUpsert(input);
      });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-transaction-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-transaction-step',
        sequenceIndex: 1,
        requestParams: { tabId: 7 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/workspaces/123?tab=overview' },
          summary: { pageRole: 'workspace', quality: 'fresh' },
          sourceRoute: 'dom_snapshot',
          selectedDataSource: 'dom',
          freshness: 'fresh',
          tabId: 7,
          pageRegions: [{ regionId: 'main', regionType: 'content', confidence: 0.9 }],
        }),
        resultSummary: 'fresh page read',
      });

      expect(trace.traceId).toBeDefined();
      expect(traceRepo.count()).toBe(1);
      expect(upsertCalls).toBe(0);
      expect(browserObjectRepo.count()).toBe(0);

      await traceService.flushAsyncWrites();

      expect(upsertCalls).toBe(2);
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      upsertSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('flushes async Browser Object write failures without throwing to callers', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);
    const transactionSpy = jest.spyOn(browserObjectRepo, 'transaction').mockImplementation(() => {
      throw new Error('forced async projection failure');
    });

    try {
      const trace = traceService.recordToolCall({
        taskId: 'trace-failure-task',
        taskIntent: 'read page object surface',
        aiClient: 'jest',
        toolName: 'chrome_read_page',
        stepId: 'trace-failure-step',
        sequenceIndex: 1,
        requestParams: { tabId: 8 },
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 25,
        result: textResult({
          page: { url: 'https://example.test/failure' },
          summary: { pageRole: 'workspace' },
        }),
        resultSummary: 'fresh page read',
      });

      await expect(traceService.flushAsyncWrites()).resolves.toBeUndefined();
      expect(traceRepo.get(trace.traceId)).toMatchObject({ traceId: trace.traceId });
      expect(browserObjectRepo.count()).toBe(0);
    } finally {
      transactionSpy.mockRestore();
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('bounds queued Browser Object writes and keeps the newest job', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo, {
      asyncBrowserObjectWriteQueueLimit: 1,
    });

    try {
      traceService.recordToolCall({
        taskId: 'bounded-queue-task',
        taskIntent: 'inspect browser context',
        aiClient: 'jest',
        toolName: 'get_windows_and_tabs',
        stepId: 'bounded-queue-step-1',
        sequenceIndex: 1,
        requestParams: {},
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 10,
        result: textResult({
          browserWorld: {
            status: 'fresh',
            windows: [{ windowId: 1, focused: true }],
            tabs: [{ tabId: 11, windowId: 1, active: true, url: 'https://first.example.test' }],
          },
        }),
        resultSummary: 'first browser inventory read',
      });
      traceService.recordToolCall({
        taskId: 'bounded-queue-task',
        taskIntent: 'inspect browser context',
        aiClient: 'jest',
        toolName: 'get_windows_and_tabs',
        stepId: 'bounded-queue-step-2',
        sequenceIndex: 2,
        requestParams: {},
        requestAtMs: NOW_MS + 20,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          browserWorld: {
            status: 'fresh',
            windows: [{ windowId: 2, focused: true }],
            tabs: [{ tabId: 22, windowId: 2, active: true, url: 'https://second.example.test' }],
          },
        }),
        resultSummary: 'second browser inventory read',
      });

      expect(traceRepo.count()).toBe(2);
      await traceService.flushAsyncWrites();

      expect(browserObjectRepo.count()).toBe(2);
      const objects = browserObjectRepo.listRecent({ limit: 10, offset: 0 });
      expect(objects.map((object) => object.windowId)).toEqual(expect.arrayContaining([2]));
      expect(objects.map((object) => object.windowId)).not.toContain(1);
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('coalesces same-Base-URL browser tabs into one Object Library page record', async () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordToolCall({
        taskId: 'browser-world-base-url-task',
        taskIntent: 'inspect open browser tabs',
        aiClient: 'jest',
        toolName: 'get_windows_and_tabs',
        stepId: 'browser-world-base-url-step',
        sequenceIndex: 1,
        requestParams: {},
        requestAtMs: NOW_MS,
        responseAtMs: NOW_MS + 30,
        result: textResult({
          browserWorld: {
            status: 'fresh',
            windows: [{ windowId: 7, focused: true, activeTabId: 302 }],
            tabs: [
              {
                tabId: 301,
                windowId: 7,
                active: false,
                status: 'complete',
                canTabrixOperate: true,
                url: 'https://example.test/search?keyword=first',
                title: 'Search first',
              },
              {
                tabId: 302,
                windowId: 7,
                active: true,
                status: 'complete',
                canTabrixOperate: true,
                url: 'https://example.test/search?keyword=second',
                title: 'Search second',
              },
            ],
          },
        }),
        resultSummary: 'browser inventory with duplicate base URL tabs',
      });

      await traceService.flushAsyncWrites();

      const tabs = browserObjectRepo
        .listCurrentBrowserSurface({ limit: 10, offset: 0 })
        .filter((object) => object.objectType === 'tab');

      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toMatchObject({
        siteFamily: 'example.test',
        pageModelKey: 'tab:example.test',
        objectFingerprint: 'browser_page:https://example.test/search',
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?keyword=second',
        tabId: 302,
        isActive: true,
        observationCount: 1,
      });
      expect(tabs[0]?.facts).toMatchObject({
        rootRoute: 'https://example.test/search',
        currentRoute: 'https://example.test/search?keyword=second',
        tabIds: [301, 302],
        openTabCount: 2,
        representativeTabId: 302,
      });
      expect(tabs[0]?.currentState).toMatchObject({
        tabIds: [301, 302],
        openTabCount: 2,
        representativeTabId: 302,
      });
    } finally {
      traceService.discardPendingAsyncWrites();
      db.close();
    }
  });

  it('records BrowserWorld snapshots into Object Library without appending Memory traces', () => {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const traceRepo = new MemoryTraceRepository(db);
    const browserObjectRepo = new BrowserObjectRepository(db);
    const traceService = new MkeMemoryTraceService(traceRepo, browserObjectRepo);

    try {
      traceService.recordBrowserWorldSnapshot({
        observedAtMs: NOW_MS,
        browserContextKey: 'heartbeat-conn',
        browserWorld: {
          status: 'fresh',
          recentActivityLedger: {
            latestPageClosed: {
              kind: 'page_closed',
              tabId: 22,
              windowId: 10,
              url: 'https://example.test/closed?token=secret',
              title: 'Closed Dashboard',
              openedBy: 'user_or_page',
              occurredAtMs: NOW_MS - 1000,
              evidence: 'browser_world_closed_tab_snapshot',
            },
          },
          windows: [{ windowId: 10, focused: true, state: 'normal', tabCount: 1 }],
          tabs: [
            {
              tabId: 21,
              windowId: 10,
              active: true,
              status: 'complete',
              openedBy: 'user_or_page',
              canTabrixOperate: true,
              url: 'https://example.test/dashboard?token=secret',
              title: 'Dashboard',
            },
          ],
        },
      });

      expect(traceRepo.count()).toBe(0);
      expect(browserObjectRepo.countCurrentBrowserSurface()).toBe(2);
      const objects = browserObjectRepo.listCurrentBrowserSurface({ limit: 10, offset: 0 });
      const tab = objects.find((object) => object.objectType === 'tab' && object.tabId === 21);
      const closedTab = objects.find(
        (object) => object.objectType === 'tab' && object.tabId === 22,
      );
      expect(tab).toMatchObject({
        browserContextKey: 'heartbeat-conn',
        objectType: 'tab',
        tabId: 21,
        lifecycleState: 'updated',
        sourceRoute: 'chrome_windows_get_all_with_browser_world_inventory',
      });
      expect(closedTab).toMatchObject({
        objectType: 'tab',
        tabId: 22,
        lifecycleState: 'closed',
        closedAt: new Date(NOW_MS - 1000).toISOString(),
        archivedAt: null,
      });
      expect(JSON.stringify(tab)).not.toContain('secret');
      expect(JSON.stringify(closedTab)).not.toContain('secret');
    } finally {
      db.close();
    }
  });
});
