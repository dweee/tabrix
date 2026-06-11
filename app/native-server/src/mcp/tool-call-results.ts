import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildPolicyDeniedPayload } from '../policy/phase0-opt-in';
import { getBridgeSnapshot, type GenericFailurePayload } from './bridge-recovery';

export function createPolicyDeniedResult(toolName: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(buildPolicyDeniedPayload(toolName)),
      },
    ],
    isError: true,
  };
}

export function createErrorResult(text: string): CallToolResult {
  return {
    content: [
      {
        type: 'text' as const,
        text,
      },
    ],
    isError: true,
  };
}

export function buildGenericFailurePayload(
  code: string,
  message: string,
  recoveryAttempted: boolean,
): GenericFailurePayload {
  const snapshot = getBridgeSnapshot();
  return {
    code,
    message,
    bridgeState: snapshot.bridgeState,
    recoveryAttempted,
    summary: code === 'TABRIX_TOOL_CALL_EXCEPTION' ? '工具调用发生异常。' : '工具调用失败。',
    hint:
      code === 'TABRIX_TOOL_CALL_EXCEPTION'
        ? '请记录当前错误信息后重试，若持续失败可重新执行一次请求。'
        : '请根据提示内容进行一次重试，必要时联系支持核实环境。',
    nextAction: null,
  };
}
