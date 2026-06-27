import { describe, expect, test } from '@jest/globals';
import { TOOL_NAMES, TOOL_RISK_TIERS } from '@tabrix/shared';
import {
  shouldRequestAiFeedbackForTrace,
  shouldRequestAiFeedbackForTool,
} from './ai-feedback-requirement';

function trace(toolName: string, taskIntent?: string | null, extras: Record<string, unknown> = {}) {
  return {
    toolName,
    taskIntent: taskIntent ?? `Run MCP tool ${toolName}`,
    ...extras,
  };
}

describe('AI feedback requirement rule', () => {
  test('classifies every browser tool as default, task-intent, or never feedback', () => {
    const defaultFeedbackTools = new Set<string>([
      TOOL_NAMES.BROWSER.READ_PAGE,
      TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
      TOOL_NAMES.BROWSER.NAVIGATE,
      TOOL_NAMES.BROWSER.CLICK,
      TOOL_NAMES.BROWSER.FILL,
      TOOL_NAMES.BROWSER.KEYBOARD,
      TOOL_NAMES.BROWSER.CLOSE_TABS,
      TOOL_NAMES.BROWSER.SWITCH_TAB,
      TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS,
      TOOL_NAMES.BROWSER.WEB_FETCHER,
      TOOL_NAMES.BROWSER.HANDLE_DIALOG,
      TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD,
      TOOL_NAMES.BROWSER.FILE_UPLOAD,
      TOOL_NAMES.BROWSER.NETWORK_REQUEST,
      TOOL_NAMES.BROWSER.BOOKMARK_ADD,
      TOOL_NAMES.BROWSER.BOOKMARK_DELETE,
      TOOL_NAMES.BROWSER.JAVASCRIPT,
      TOOL_NAMES.BROWSER.COMPUTER,
    ]);
    const auxiliaryBrowserFeedbackTools = new Set<string>([
      TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
      TOOL_NAMES.BROWSER.SCREENSHOT,
      TOOL_NAMES.BROWSER.CONSOLE,
      TOOL_NAMES.BROWSER.NETWORK_CAPTURE,
      TOOL_NAMES.BROWSER.NETWORK_CAPTURE_START,
      TOOL_NAMES.BROWSER.NETWORK_CAPTURE_STOP,
      TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_START,
      TOOL_NAMES.BROWSER.NETWORK_DEBUGGER_STOP,
      TOOL_NAMES.BROWSER.HISTORY,
      TOOL_NAMES.BROWSER.BOOKMARK_SEARCH,
      TOOL_NAMES.BROWSER.INJECT_SCRIPT,
      TOOL_NAMES.BROWSER.SEND_COMMAND_TO_INJECT_SCRIPT,
      TOOL_NAMES.BROWSER.PERFORMANCE_ANALYZE_INSIGHT,
    ]);
    const neverFeedbackTools = new Set<string>([
      TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE,
      TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE,
    ]);
    const classified = new Set<string>([
      ...defaultFeedbackTools,
      ...auxiliaryBrowserFeedbackTools,
      ...neverFeedbackTools,
    ]);
    const browserTools = Object.values(TOOL_NAMES.BROWSER);

    expect(classified).toEqual(new Set(browserTools));
    for (const toolName of defaultFeedbackTools) {
      expect(shouldRequestAiFeedbackForTool(toolName)).toBe(true);
      expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
    }
    for (const toolName of auxiliaryBrowserFeedbackTools) {
      expect(shouldRequestAiFeedbackForTool(toolName)).toBe(false);
      expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, '用户任务中的关键浏览器步骤'))).toBe(
        true,
      );
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, '内部维护：刷新浏览器状态缓存'))).toBe(
        false,
      );
    }
    for (const toolName of neverFeedbackTools) {
      expect(shouldRequestAiFeedbackForTool(toolName)).toBe(false);
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, '用户任务中的关键浏览器步骤'))).toBe(
        false,
      );
    }
  });

  test.each([
    [TOOL_NAMES.CONTEXT.CHOOSE],
    [TOOL_NAMES.CONTEXT.RECORD_OUTCOME],
    [TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK],
    [TOOL_NAMES.BROWSER.PERFORMANCE_START_TRACE],
    [TOOL_NAMES.BROWSER.PERFORMANCE_STOP_TRACE],
  ])('does not request feedback for internal maintenance tools: %s', (toolName) => {
    expect(shouldRequestAiFeedbackForTool(toolName)).toBe(false);
    expect(shouldRequestAiFeedbackForTrace(trace(toolName, '内部维护'))).toBe(false);
  });

  test.each([
    [TOOL_NAMES.BROWSER.READ_PAGE, '读取当前页面，判断下一步操作'],
    [TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS, '收集搜索结果卡片供用户选择'],
    [TOOL_NAMES.BROWSER.NAVIGATE, '打开目标网页继续任务'],
    [TOOL_NAMES.BROWSER.CLICK, '点击筛选按钮推进任务'],
    [TOOL_NAMES.BROWSER.FILL, '填写搜索框或表单字段'],
    [TOOL_NAMES.BROWSER.KEYBOARD, '提交搜索或触发快捷键'],
  ])('requires feedback for task-meaningful browser step: %s', (toolName, taskIntent) => {
    expect(shouldRequestAiFeedbackForTrace(trace(toolName, taskIntent))).toBe(true);
  });

  test.each([
    [TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS],
    [TOOL_NAMES.BROWSER.WEB_FETCHER],
    [TOOL_NAMES.BROWSER.HANDLE_DIALOG],
    [TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD],
    [TOOL_NAMES.BROWSER.FILE_UPLOAD],
  ])('also requests feedback for other default high-signal browser tools: %s', (toolName) => {
    expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
  });

  test.each([
    [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
    [TOOL_NAMES.BROWSER.SCREENSHOT],
    [TOOL_NAMES.BROWSER.CONSOLE],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
  ])(
    'keeps auxiliary browser tools quiet only for explicit maintenance context: %s',
    (toolName) => {
      expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, '内部维护：刷新浏览器状态缓存'))).toBe(
        false,
      );
    },
  );

  test.each([
    [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
    [TOOL_NAMES.BROWSER.SCREENSHOT],
    [TOOL_NAMES.BROWSER.CONSOLE],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
  ])(
    'requests feedback for auxiliary browser tools when they serve a user task: %s',
    (toolName) => {
      expect(
        shouldRequestAiFeedbackForTrace(trace(toolName, '完成用户任务中的关键浏览器步骤')),
      ).toBe(true);
    },
  );

  test.each([
    [TOOL_NAMES.BROWSER.CONSOLE, '诊断当前页面为什么加载失败'],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE, '查看 telemetry 页面当前接口是否返回数据'],
    [TOOL_NAMES.BROWSER.SCREENSHOT, '截取 health check 页面状态给 AI 判断下一步'],
  ])(
    'does not suppress user-task diagnostics just because the intent contains diagnostic wording: %s',
    (toolName, taskIntent) => {
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, taskIntent))).toBe(true);
    },
  );

  test('does not suppress task feedback just because the step failed or was blocked', () => {
    expect(
      shouldRequestAiFeedbackForTrace({
        toolName: TOOL_NAMES.BROWSER.READ_PAGE,
        taskIntent: '读取内容站搜索结果失败，需要 AI 判断是否重试或换路径',
      }),
    ).toBe(true);
  });

  test.each([
    [
      'failed task step',
      TOOL_NAMES.BROWSER.CLICK,
      '点击筛选项失败，需要 AI 判断目标是否错误',
      { toolSuccess: false, errorCode: 'TARGET_NOT_FOUND', businessSuccess: 'false' },
    ],
    [
      'slow task step',
      TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS,
      '收集结果卡片耗时过长，需要 AI 判断路径是否值得复用',
      { durationMs: 45_000, toolSuccess: true, businessSuccess: 'unknown' },
    ],
    [
      'high-risk task step',
      TOOL_NAMES.BROWSER.FILE_UPLOAD,
      '上传用户指定文件以完成表单任务',
      { durationMs: 3_000, toolSuccess: false, errorCode: 'TABRIX_POLICY_DENIED_P3' },
    ],
  ])('does not hide feedback for %s', (_label, toolName, taskIntent, extras) => {
    if (toolName === TOOL_NAMES.BROWSER.FILE_UPLOAD) {
      expect(TOOL_RISK_TIERS[toolName]).toBe('P3');
    }

    expect(shouldRequestAiFeedbackForTrace(trace(toolName, taskIntent, extras))).toBe(true);
  });

  test.each([
    [TOOL_NAMES.BROWSER.CLOSE_TABS],
    [TOOL_NAMES.BROWSER.SWITCH_TAB],
    [TOOL_NAMES.BROWSER.NETWORK_REQUEST],
    [TOOL_NAMES.BROWSER.BOOKMARK_ADD],
    [TOOL_NAMES.BROWSER.BOOKMARK_DELETE],
    [TOOL_NAMES.BROWSER.JAVASCRIPT],
    [TOOL_NAMES.BROWSER.COMPUTER],
  ])('requires feedback for actionful generic browser tools: %s', (toolName) => {
    expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
    expect(shouldRequestAiFeedbackForTrace(trace(toolName, '内部维护：刷新浏览器状态缓存'))).toBe(
      true,
    );
  });

  test.each([
    [TOOL_NAMES.BROWSER.READ_PAGE, '后台诊断：读取页面内容以判断用户任务是否能继续'],
    [TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS, '内部维护：收集结果卡片供 AI 判断路径质量'],
    [TOOL_NAMES.BROWSER.CLICK, 'health check: click the current task filter option'],
    [TOOL_NAMES.BROWSER.FILL, 'background projection: fill the search box for the active task'],
    [TOOL_NAMES.BROWSER.KEYBOARD, '纯诊断：提交搜索并观察页面是否刷新'],
  ])(
    'does not let maintenance wording suppress default task-meaningful browser feedback: %s',
    (toolName, taskIntent) => {
      expect(shouldRequestAiFeedbackForTrace(trace(toolName, taskIntent))).toBe(true);
    },
  );

  test.each([
    ['AI feedback writeback', TOOL_NAMES.MEMORY.RECORD_AI_FEEDBACK, '回写 AI feedback 评价结果'],
    [
      'health check',
      TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS,
      'health check: refresh browser connection status',
    ],
    [
      'background projection',
      TOOL_NAMES.BROWSER.SCREENSHOT,
      'background projection: refresh object cache only',
    ],
  ])('marks pure auxiliary/system records as not_required: %s', (_label, toolName, taskIntent) => {
    expect(shouldRequestAiFeedbackForTrace(trace(toolName, taskIntent))).toBe(false);
  });

  test('uses task meaning, not only tool name, for auxiliary browser records', () => {
    expect(shouldRequestAiFeedbackForTool(TOOL_NAMES.BROWSER.SCREENSHOT)).toBe(false);
    expect(
      shouldRequestAiFeedbackForTrace(
        trace(TOOL_NAMES.BROWSER.SCREENSHOT, '确认用户要求的筛选结果是否已经显示'),
      ),
    ).toBe(true);
  });
});
