import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
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
            businessStatus: 'definitely',
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
          feedbackToken: expect.any(String),
        },
        toolSuccess: true,
        businessFeedbackRequired: true,
        businessFeedbackGuideVersion: 'tabrix-ai-business-feedback-v1',
      },
    });
    expect(parseFirstText(result)._tabrix).not.toHaveProperty('businessStatus');
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
});
