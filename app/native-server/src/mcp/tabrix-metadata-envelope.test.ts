import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import type { MemoryTrace } from '../memory/db';
import {
  attachTabrixMemoryTraceEnvelope,
  readTabrixToolMetadata,
  stripTabrixToolMetadata,
  withTabrixMetadataSchema,
} from './tabrix-metadata-envelope';

function textResult(payload: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    isError: false,
  };
}

function parseFirstText(result: CallToolResult): Record<string, unknown> {
  return JSON.parse(String(result.content?.[0]?.text ?? '{}'));
}

function makeTrace(overrides: Partial<MemoryTrace> = {}): MemoryTrace {
  return {
    traceId: 'trace-1',
    taskId: 'task-1',
    taskTheme: null,
    taskIntent: 'fallback task intent',
    taskSignature: null,
    aiClient: 'mcp-server',
    toolName: 'chrome_read_page',
    toolCallId: 'step-1',
    sequenceIndex: 0,
    requestParams: {},
    requestAt: '2026-06-10T00:00:00.000Z',
    response: {},
    responseAt: '2026-06-10T00:00:01.000Z',
    durationMs: 1000,
    toolSuccess: true,
    businessSuccess: 'partial',
    resultSummary: null,
    errorCode: null,
    tabId: null,
    windowId: null,
    browserContextKey: null,
    tabLifecycle: null,
    siteFamily: null,
    pageUrlPattern: null,
    pageRole: null,
    pageState: null,
    pageModelKey: null,
    perceptionObjects: null,
    actionTarget: null,
    preObservation: null,
    postObservation: null,
    postActionDelta: null,
    sourceRoute: null,
    selectedDataSource: null,
    freshness: null,
    fallbackUsed: null,
    nextRequiredCheck: null,
    tokenPrompt: null,
    tokenCompletion: null,
    tokenTotal: null,
    aiFeedbackScore: null,
    aiFeedback: null,
    redactionState: 'unredacted',
    createdAt: '2026-06-10T00:00:01.000Z',
    ...overrides,
  };
}

describe('tabrix metadata envelope', () => {
  it('adds the optional _tabrix metadata schema without mutating existing properties', () => {
    const tool = {
      name: 'chrome_read_page',
      inputSchema: {
        type: 'object',
        properties: {
          tabId: { type: 'number' },
        },
      },
    };

    const wrapped = withTabrixMetadataSchema(tool);

    expect(wrapped).not.toBe(tool);
    expect(wrapped.inputSchema.properties.tabId).toEqual({ type: 'number' });
    expect(wrapped.inputSchema.properties._tabrix).toMatchObject({
      type: 'object',
      additionalProperties: true,
    });
    expect(tool.inputSchema.properties).not.toHaveProperty('_tabrix');
  });

  it('reads trimmed metadata, clamps feedback confidence, and drops invalid feedback', () => {
    const metadata = readTabrixToolMetadata({
      url: 'https://example.test',
      _tabrix: {
        intentTitle: '  Open issue list  ',
        intentSummary: '  Find current issues ',
        nextIntent: '  click first issue ',
        previousFeedback: [
          {
            traceId: 'trace-ok',
            taskId: 'task-ok',
            toolName: 'chrome_read_page',
            toolCallId: 'step-ok',
            sequenceIndex: 2,
            feedbackToken: 'binding-ok',
            evaluationScope: 'step',
            businessStatus: 'achieved',
            confidence: 1.4,
            reasonCode: ' ai_verified_result ',
            summary: ' done ',
          },
          {
            traceId: 'trace-bad-status',
            feedbackToken: 'binding-bad-status',
            businessStatus: 'definitely',
            confidence: 0.8,
          },
          {
            traceId: 'trace-missing-token',
            businessStatus: 'achieved',
            confidence: 0.8,
          },
        ],
      },
    });

    expect(metadata).toEqual({
      intentTitle: 'Open issue list',
      intentSummary: 'Find current issues',
      nextIntent: 'click first issue',
      previousFeedback: [
        {
          traceId: 'trace-ok',
          taskId: 'task-ok',
          toolName: 'chrome_read_page',
          toolCallId: 'step-ok',
          sequenceIndex: 2,
          feedbackToken: 'binding-ok',
          evaluationScope: 'step',
          businessStatus: 'achieved',
          confidence: 1,
          reasonCode: 'ai_verified_result',
          summary: 'done',
        },
      ],
    });
  });

  it('strips _tabrix before forwarding tool args', () => {
    expect(stripTabrixToolMetadata({ tabId: 7, _tabrix: { intentTitle: 'read' } })).toEqual({
      tabId: 7,
    });
    expect(stripTabrixToolMetadata(null)).toBeNull();
  });

  it('attaches trace feedback metadata to JSON text results', () => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({
        status: 'ok',
        _tabrix: {
          existing: true,
        },
      }),
      makeTrace(),
      {
        intentTitle: 'Read current page',
        intentSummary: 'Collect issue rows',
        nextIntent: 'Open first row',
        previousFeedback: [],
      },
      'chrome_read_page',
    );

    expect(parseFirstText(result)).toMatchObject({
      status: 'ok',
      _tabrix: {
        existing: true,
        traceId: 'trace-1',
        intentTitle: 'Read current page',
        intentSummary: 'Collect issue rows',
        nextIntent: 'Open first row',
        toolName: 'chrome_read_page',
        feedbackTarget: {
          traceId: 'trace-1',
          taskId: 'task-1',
          toolName: 'chrome_read_page',
          toolCallId: 'step-1',
          sequenceIndex: 0,
          feedbackToken: expect.any(String),
        },
        toolSuccess: true,
        aiFeedbackRequired: true,
        businessFeedbackRequired: true,
      },
    });
    expect(parseFirstText(result)._tabrix).not.toHaveProperty('businessFeedbackGuide');
    expect(parseFirstText(result)._tabrix).not.toHaveProperty('businessFeedbackGuideVersion');
    expect(parseFirstText(result)._tabrix).not.toHaveProperty('businessStatus');
  });

  it.each([
    [TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE],
    [TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE],
    [TOOL_NAMES.CONTEXT.CHOOSE],
    [TOOL_NAMES.CONTEXT.RECORD_OUTCOME],
    [TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK],
  ])('does not request AI feedback for internal maintenance traces: %s', (toolName) => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({ toolName }),
      {
        intentTitle: '读取窗口和标签',
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      toolName,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName,
      aiFeedbackRequired: false,
      businessFeedbackRequired: false,
    });
    expect(payload._tabrix).not.toHaveProperty('feedbackTarget');
  });

  it.each([
    [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
    [TOOL_NAMES.BROWSER.SCREENSHOT],
    [TOOL_NAMES.BROWSER.CONSOLE],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
    [TOOL_NAMES.BROWSER.HISTORY],
    [TOOL_NAMES.BROWSER.BOOKMARK_SEARCH],
    [TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT],
  ])('requests AI feedback for AI-requested auxiliary browser traces: %s', (toolName) => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({
        toolName,
        taskIntent: `Run MCP tool ${toolName}`,
      }),
      {
        intentTitle: null,
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      toolName,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName,
      aiFeedbackRequired: true,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it.each([
    [TOOL_NAMES.BROWSER.NETWORK_REQUEST],
    [TOOL_NAMES.BROWSER.BOOKMARK_ADD],
    [TOOL_NAMES.BROWSER.BOOKMARK_DELETE],
    [TOOL_NAMES.BROWSER.CLOSE_TABS],
    [TOOL_NAMES.BROWSER.SWITCH_TAB],
    [TOOL_NAMES.BROWSER.JAVASCRIPT],
    [TOOL_NAMES.BROWSER.COMPUTER],
  ])('requests AI feedback for default actionful browser traces: %s', (toolName) => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({
        toolName,
        taskIntent: `Run MCP tool ${toolName}`,
      }),
      {
        intentTitle: null,
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      toolName,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it('requests AI feedback for failed task-meaningful browser traces', () => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'error' }),
      makeTrace({ toolName: TOOL_NAMES.BROWSER.READ_PAGE, toolSuccess: false }),
      {
        intentTitle: '读取页面',
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      TOOL_NAMES.BROWSER.READ_PAGE,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName: TOOL_NAMES.BROWSER.READ_PAGE,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it('requests AI feedback for default high-signal browser traces', () => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({
        toolName: TOOL_NAMES.BROWSER.READ_PAGE,
        taskIntent: `Run MCP tool ${TOOL_NAMES.BROWSER.READ_PAGE}`,
      }),
      {
        intentTitle: null,
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      TOOL_NAMES.BROWSER.READ_PAGE,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName: TOOL_NAMES.BROWSER.READ_PAGE,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it('requests AI feedback for restricted or business-failed task steps', () => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({
        success: false,
        status: 'blocked',
        pageState: 'restricted',
        reasonCode: 'user_verification_required',
      }),
      makeTrace({
        toolName: TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
        taskIntent: `Run MCP tool ${TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS}`,
        businessSuccess: 'false',
        pageState: 'restricted',
      }),
      {
        intentTitle: null,
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName: TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it('requests AI feedback for default result-card collection traces', () => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({
        toolName: TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
        taskIntent: `Run MCP tool ${TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS}`,
      }),
      {
        intentTitle: null,
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName: TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it.each([
    [TOOL_NAMES.BROWSER.READ_PAGE],
    [TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS],
    [TOOL_NAMES.BROWSER.NAVIGATE],
    [TOOL_NAMES.BROWSER.CLICK],
    [TOOL_NAMES.BROWSER.FILL],
    [TOOL_NAMES.BROWSER.KEYBOARD],
    [TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS],
    [TOOL_NAMES.BROWSER.WEB_FETCHER],
    [TOOL_NAMES.BROWSER.CLOSE_TABS],
    [TOOL_NAMES.BROWSER.SWITCH_TAB],
    [TOOL_NAMES.BROWSER.SCREENSHOT],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
  ])('requests AI feedback for task-meaningful browser traces: %s', (toolName) => {
    const result = attachTabrixMemoryTraceEnvelope(
      textResult({ status: 'ok' }),
      makeTrace({ toolName }),
      {
        intentTitle: '执行关键浏览器步骤',
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      toolName,
    );

    const payload = parseFirstText(result);
    expect(payload._tabrix).toMatchObject({
      traceId: 'trace-1',
      toolName,
      businessFeedbackRequired: true,
      feedbackTarget: {
        traceId: 'trace-1',
        feedbackToken: expect.any(String),
      },
    });
  });

  it('leaves non-JSON text results unchanged', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'plain text' }],
      isError: false,
    };

    expect(
      attachTabrixMemoryTraceEnvelope(
        result,
        makeTrace(),
        {
          intentTitle: null,
          intentSummary: null,
          nextIntent: null,
          previousFeedback: [],
        },
        'chrome_read_page',
      ),
    ).toBe(result);
  });

  it('wraps plain-text error results so failed task steps can receive AI feedback', () => {
    const result: CallToolResult = {
      content: [{ type: 'text', text: 'selector not found' }],
      isError: true,
    };

    const wrapped = attachTabrixMemoryTraceEnvelope(
      result,
      makeTrace({ toolName: TOOL_NAMES.BROWSER.CLICK, toolSuccess: false }),
      {
        intentTitle: '点击搜索筛选',
        intentSummary: null,
        nextIntent: null,
        previousFeedback: [],
      },
      TOOL_NAMES.BROWSER.CLICK,
    );
    const payload = parseFirstText(wrapped);

    expect(payload).toMatchObject({
      success: false,
      error: 'selector not found',
      errorFormat: 'plain_text_wrapped',
      _tabrix: {
        traceId: 'trace-1',
        toolName: TOOL_NAMES.BROWSER.CLICK,
        toolSuccess: false,
        aiFeedbackRequired: true,
        businessFeedbackRequired: true,
        feedbackTarget: {
          traceId: 'trace-1',
          feedbackToken: expect.any(String),
        },
      },
    });
  });
});
