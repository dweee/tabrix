import { describe, expect, test } from '@jest/globals';
import { TOOL_NAMES } from '@tabrix/shared';
import {
  shouldRequestAiFeedbackForTrace,
  shouldRequestAiFeedbackForTool,
} from './ai-feedback-requirement';

function trace(toolName: string, taskIntent?: string | null) {
  return {
    toolName,
    taskIntent: taskIntent ?? `Run MCP tool ${toolName}`,
  };
}

describe('AI feedback requirement rule', () => {
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
    [TOOL_NAMES.BROWSER.READ_PAGE],
    [TOOL_NAMES.BROWSER.COLLECT_RESULT_CARDS],
    [TOOL_NAMES.BROWSER.NAVIGATE],
    [TOOL_NAMES.BROWSER.CLICK],
    [TOOL_NAMES.BROWSER.FILL],
    [TOOL_NAMES.BROWSER.KEYBOARD],
    [TOOL_NAMES.BROWSER.GET_INTERACTIVE_ELEMENTS],
    [TOOL_NAMES.BROWSER.WEB_FETCHER],
    [TOOL_NAMES.BROWSER.HANDLE_DIALOG],
    [TOOL_NAMES.BROWSER.HANDLE_DOWNLOAD],
    [TOOL_NAMES.BROWSER.FILE_UPLOAD],
  ])('requests feedback for default high-signal browser tools: %s', (toolName) => {
    expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(true);
  });

  test.each([
    [TOOL_NAMES.BROWSER.GET_WINDOWS_AND_TABS],
    [TOOL_NAMES.BROWSER.SCREENSHOT],
    [TOOL_NAMES.BROWSER.CONSOLE],
    [TOOL_NAMES.BROWSER.NETWORK_CAPTURE],
    [TOOL_NAMES.BROWSER.CLOSE_TABS],
    [TOOL_NAMES.BROWSER.SWITCH_TAB],
  ])(
    'keeps auxiliary browser tools quiet for generic or maintenance-only context: %s',
    (toolName) => {
      expect(shouldRequestAiFeedbackForTrace(trace(toolName))).toBe(false);
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
    [TOOL_NAMES.BROWSER.CLOSE_TABS],
    [TOOL_NAMES.BROWSER.SWITCH_TAB],
  ])(
    'requests feedback for auxiliary browser tools when they serve a user task: %s',
    (toolName) => {
      expect(
        shouldRequestAiFeedbackForTrace(trace(toolName, '完成用户任务中的关键浏览器步骤')),
      ).toBe(true);
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

  test('uses task meaning, not only tool name, for auxiliary browser records', () => {
    expect(shouldRequestAiFeedbackForTool(TOOL_NAMES.BROWSER.SCREENSHOT)).toBe(false);
    expect(
      shouldRequestAiFeedbackForTrace(
        trace(TOOL_NAMES.BROWSER.SCREENSHOT, '确认用户要求的筛选结果是否已经显示'),
      ),
    ).toBe(true);
  });
});
