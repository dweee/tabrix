import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import { SessionManager } from '../execution/session-manager';
import { TaskSessionContext } from '../execution/task-session-context';
import {
  runPostProcessor,
  chromeReadPagePostProcessor,
  chromeNetworkCapturePostProcessor,
  TOOL_POST_PROCESSORS,
} from './tool-post-processors';

function wrap(body: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(body) }] };
}

const readPageBody = {
  mode: 'compact',
  page: {
    url: 'https://code.example/openclaw/openclaw',
    title: 'openclaw/openclaw',
    pageType: 'web_page',
  },
  summary: { pageRole: 'workspace_home', primaryRegion: 'main', quality: 'usable' },
  interactiveElements: [],
  artifactRefs: [],
  highValueObjects: [],
  historyRef: null,
};

describe('runPostProcessor', () => {
  it('returns raw result untouched for tools without a processor', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_screenshot',
      });
      const raw = wrap(readPageBody);
      const out = runPostProcessor({
        toolName: 'chrome_screenshot',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
    } finally {
      manager.close();
    }
  });
});

describe('chromeReadPagePostProcessor', () => {
  it('strips retired historyRef from read_page JSON bodies without creating artifact refs', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw = wrap(readPageBody);
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: { tabId: 9 },
      });

      expect(out.extraArtifactRefs).toEqual([]);

      const parsed = JSON.parse((out.rawResult.content as any[])[0].text);
      expect(parsed.historyRef).toBeUndefined();

      // Original raw result must not have been mutated.
      const original = JSON.parse((raw.content as any[])[0].text);
      expect(original.historyRef).toBeNull();
    } finally {
      manager.close();
    }
  });

  it('degrades silently when Memory is off (persistenceEnabled=false)', () => {
    const manager = new SessionManager({ persistenceEnabled: false });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw = wrap(readPageBody);
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      expect(out.extraArtifactRefs).toEqual([]);
      const parsed = JSON.parse((out.rawResult.content as any[])[0].text);
      expect(parsed.historyRef).toBeUndefined();
    } finally {
      manager.close();
    }
  });

  it('degrades when the body is not JSON, without throwing', () => {
    const manager = new SessionManager({ dbPath: ':memory:' });
    try {
      const task = manager.createTask({
        taskType: 'tool-call',
        title: 't',
        intent: 'i',
        origin: 'jest',
      });
      const session = manager.startSession({
        taskId: task.taskId,
        transport: 'stdio',
        clientName: 'jest',
      });
      const step = manager.startStep({
        sessionId: session.sessionId,
        toolName: 'chrome_read_page',
      });

      const raw: CallToolResult = { content: [{ type: 'text', text: 'not a json string' }] };
      const out = chromeReadPagePostProcessor({
        toolName: 'chrome_read_page',
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      expect(out.extraArtifactRefs).toEqual([]);
      expect(out.rawResult).toBe(raw);
    } finally {
      manager.close();
    }
  });
});

describe('TOOL_POST_PROCESSORS registry', () => {
  it('registers only active post-processors and leaves retired action memory writers unhooked', () => {
    expect(TOOL_POST_PROCESSORS.chrome_read_page).toBe(chromeReadPagePostProcessor);
    expect(TOOL_POST_PROCESSORS[TOOL_NAMES.BROWSER.NETWORK_CAPTURE]).toBe(
      chromeNetworkCapturePostProcessor,
    );
    expect(TOOL_POST_PROCESSORS[TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP]).toBe(
      chromeNetworkCapturePostProcessor,
    );
    expect(TOOL_POST_PROCESSORS[TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_STOP]).toBe(
      chromeNetworkCapturePostProcessor,
    );
    for (const name of [
      'chrome_click_element',
      'chrome_fill_or_select',
      'chrome_navigate',
      'chrome_keyboard',
    ]) {
      expect(TOOL_POST_PROCESSORS[name]).toBeUndefined();
    }
  });
});

/**
 * B-017 end-to-end — proves the default capture + redaction contract
 * actually fires through the post-processor that real `chrome_network_capture`
 * results flow through.
 *
 * The shape we feed `runPostProcessor` here mirrors the JSON body the
 * extension's `network-capture-debugger.ts` / `network-capture-web-request.ts`
 * tools serialize when `action: "stop"` returns. We do NOT mock the
 * post-processor itself — we want the registry → derive → upsert
 * chain to be the unit under test.
 */
describe('chromeNetworkCapturePostProcessor (B-017 integration)', () => {
  const SAMPLE_BUNDLE = {
    requests: [
      {
        url: 'https://api.code.example/search/repositories?q=AI助手&sort=stars&order=desc',
        method: 'GET',
        type: 'xmlhttprequest',
        statusCode: 200,
        mimeType: 'application/json',
        specificRequestHeaders: {
          Authorization: 'Bearer ghp_SUPERSECRET_token_VALUE_should_never_persist',
          Cookie: 'session=cookie-payload-PII; tracking=xyz',
          'User-Agent': 'tabrix-test/1.0',
          Accept: 'application/json',
        },
        specificResponseHeaders: {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'session=NEW_VALUE_PII; HttpOnly',
        },
        requestBody: 'raw-request-body-PII=should_never_persist',
        responseBody: JSON.stringify({
          items: [{ id: 1, full_name: 'octocat/private-title-PII', owner: { login: 'octocat' } }],
        }),
      },
      // A request without usable XHR/fetch or JSON evidence must be silently dropped.
      {
        url: 'https://example.com/api/things?secret=hunter2',
        method: 'GET',
        statusCode: 200,
        responseBody: '{}',
      },
      // A private telemetry-like Workspace endpoint must not become
      // unclassified endpoint knowledge.
      {
        url: 'https://api.code.example/_private/browser/stats?token=raw_query_secret',
        method: 'GET',
        statusCode: 200,
        mimeType: 'application/json',
        responseBody: '{}',
      },
    ],
  };

  function bootstrap() {
    const manager = new SessionManager({ dbPath: ':memory:' });
    const task = manager.createTask({
      taskType: 'tool-call',
      title: 't',
      intent: 'i',
      origin: 'jest',
    });
    const session = manager.startSession({
      taskId: task.taskId,
      transport: 'stdio',
      clientName: 'jest',
    });
    const step = manager.startStep({
      sessionId: session.sessionId,
      toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
    });
    return { manager, session, step };
  }

  it('is registered for the canonical NETWORK_CAPTURE tool name', () => {
    expect(TOOL_POST_PROCESSORS[TOOL_NAMES.BROWSER.NETWORK_CAPTURE]).toBe(
      chromeNetworkCapturePostProcessor,
    );
  });

  it('captures useful API rows by default', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      // Result is unchanged (Knowledge capture is invisible side-effect).
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
      // Useful, redacted API knowledge landed by default.
      expect(manager.knowledgeApi!.countAll()).toBe(1);
    } finally {
      manager.close();
    }
  });

  it('captures classified rows without persisted capability config', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });

      // Exactly one row — example.com was dropped at the classifier.
      expect(manager.knowledgeApi!.countAll()).toBe(1);
      const rows = manager.knowledgeApi!.listBySite('api.code.example');
      expect(rows).toHaveLength(1);
      const row = rows[0];

      // Useful, redacted generic observed shape:
      expect(row.semanticTag).toBeNull();
      expect(row.family).toBe('observed');
      expect(row.urlPattern).toBe('api.code.example/search/repositories');
      expect(row.method).toBe('GET');
      expect(row.statusClass).toBe('2xx');
      expect(row.requestSummary.hasAuth).toBe(true);
      expect(row.requestSummary.hasCookie).toBe(true);
      expect(row.requestSummary.queryKeys).toEqual(['order', 'q', 'sort']);
      expect(row.responseSummary.shape).toMatchObject({
        kind: 'object',
      });
      expect(row.sourceSessionId).toBe(session.sessionId);
      expect(row.sourceStepId).toBe(step.stepId);

      // Hard PII guarantee: no raw secret leaked anywhere into the row.
      const blob = JSON.stringify(row);
      const FORBIDDEN = [
        'ghp_SUPERSECRET',
        'SUPERSECRET',
        'cookie-payload-PII',
        'NEW_VALUE_PII',
        'private-title-PII',
        'raw-request-body-PII',
        'raw_query_secret',
        '_private/browser/stats',
        'AI助手',
        'stars',
        'hunter2',
        'octocat',
      ];
      for (const needle of FORBIDDEN) {
        expect(blob).not.toContain(needle);
      }
    } finally {
      manager.close();
    }
  });

  it('does not mutate the MCP response on success (response stays byte-identical)', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      const originalText = (raw.content as any[])[0].text;
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(out.extraArtifactRefs).toEqual([]);
      expect((raw.content as any[])[0].text).toBe(originalText);
    } finally {
      manager.close();
    }
  });

  it('degrades silently on malformed bundle JSON', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw: CallToolResult = { content: [{ type: 'text', text: 'not json' }] };
      const out = runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        args: {},
      });
      expect(out.rawResult).toBe(raw);
      expect(manager.knowledgeApi!.countAll()).toBe(0);
    } finally {
      manager.close();
    }
  });

  it('upsert dedup: re-running the same bundle does not double-count', () => {
    const { manager, session, step } = bootstrap();
    try {
      const raw = wrap(SAMPLE_BUNDLE);
      for (let i = 0; i < 3; i++) {
        runPostProcessor({
          toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
          rawResult: raw,
          stepId: step.stepId,
          sessionId: session.sessionId,
          sessionManager: manager,
          args: {},
        });
      }
      expect(manager.knowledgeApi!.countAll()).toBe(1);
      const [row] = manager.knowledgeApi!.listBySite('api.code.example');
      expect(row.sampleCount).toBe(3);
      // First-seen provenance sticks to the first observation; even after
      // 3 hits, sourceSessionId is still the original session.
      expect(row.sourceSessionId).toBe(session.sessionId);
    } finally {
      manager.close();
    }
  });

  it('uses capture tabUrl as live observed relevance context when task currentUrl is absent', () => {
    const { manager, session, step } = bootstrap();
    const taskContext = new TaskSessionContext();
    const raw = wrap({
      tabUrl: 'https://neutral-social.example.test/search?keyword=desk&page=1',
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 8,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      requests: [
        {
          url: 'https://api.neutral-social.example.test/v1/search/items?keyword=desk&page=1',
          method: 'GET',
          statusCode: 200,
          mimeType: 'application/json',
          specificResponseHeaders: { 'Content-Type': 'application/json; charset=utf-8' },
          responseBody: JSON.stringify({
            items: [
              { title: 'Desk Alpha', score: 1 },
              { title: 'Desk Beta', score: 2 },
            ],
          }),
          base64Encoded: false,
          responseBodySource: 'debugger_api',
          rawBodyPersisted: false,
          bodyCompacted: true,
        },
      ],
    });

    try {
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        taskContext,
        args: {},
      });

      expect(taskContext.currentUrl).toBeNull();
      expect(taskContext.peekLiveObservedApiData()).toMatchObject({
        selectedDataSource: 'cdp_enhanced_api_rows',
        endpointSource: 'observed',
        responseSummarySource: 'debugger_body_probe',
        responseBodySource: 'debugger_api',
        rowCount: 2,
      });
    } finally {
      manager.close();
    }
  });

  it('keeps shape-evidenced cross-origin POST search rows in task context', () => {
    const { manager, session, step } = bootstrap();
    const taskContext = new TaskSessionContext();
    const raw = wrap({
      tabUrl: 'https://hn.algolia.com/?q=browser%20automation',
      observationMode: 'cdp_enhanced',
      cdpUsed: true,
      cdpReason: 'need_response_body',
      cdpAttachDurationMs: 8,
      cdpDetachSuccess: true,
      debuggerConflict: false,
      responseBodySource: 'debugger_api',
      rawBodyPersisted: false,
      bodyCompacted: true,
      requests: [
        {
          url: 'https://search-provider.example.test/1/indexes/Item_dev/query',
          method: 'POST',
          type: 'xmlhttprequest',
          statusCode: 200,
          mimeType: 'application/json',
          specificResponseHeaders: { 'Content-Type': 'application/json; charset=UTF-8' },
          responseBody: JSON.stringify({
            hits: [
              {
                title: 'browser automation tools',
                points: 42,
                comments: 7,
              },
            ],
          }),
          base64Encoded: false,
          responseBodySource: 'debugger_api',
          rawBodyPersisted: false,
          bodyCompacted: true,
        },
      ],
    });

    try {
      runPostProcessor({
        toolName: TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
        rawResult: raw,
        stepId: step.stepId,
        sessionId: session.sessionId,
        sessionManager: manager,
        taskContext,
        args: {},
      });

      expect(taskContext.peekLiveObservedApiData()).toMatchObject({
        selectedDataSource: 'cdp_enhanced_api_rows',
        semanticType: 'search',
        endpointSource: 'observed',
        pageRegion: 'task_query_network',
        responseSummarySource: 'debugger_body_probe',
        responseBodySource: 'debugger_api',
        rowCount: 1,
      });
    } finally {
      manager.close();
    }
  });
});
