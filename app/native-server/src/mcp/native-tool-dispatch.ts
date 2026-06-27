import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { SessionManager } from '../execution/session-manager';
import type { TaskSessionContext } from '../execution/task-session-context';
import type { ExecutionSession, ExecutionStep, Task } from '../execution/types';
import { getNativeToolHandler } from './native-tool-handlers';
import type { TaskContextAttachment } from './task-context-envelope';
import { finishToolCallLifecycle } from './mcp-tool-call-lifecycle';
import { summarizeNativeToolErrorResult } from './tool-result-summary';

type TraceAttachmentInput = {
  requestParams?: unknown;
  resultSummary?: string | null;
  errorCode?: string | null;
  browserContextKey?: string | null;
};

type NativeToolDispatchInput = {
  name: string;
  args: unknown;
  sessionManager: SessionManager;
  taskContext: TaskSessionContext | null;
  taskContextAttachment: TaskContextAttachment;
  session: ExecutionSession;
  step: ExecutionStep;
  recordAndAttachMkeMemoryTrace: (
    result: CallToolResult,
    input?: TraceAttachmentInput,
  ) => CallToolResult;
};

export type NativeToolDispatchResult =
  | { handled: false }
  | { handled: true; result: CallToolResult };

export async function dispatchNativeToolIfAvailable(
  input: NativeToolDispatchInput,
): Promise<NativeToolDispatchResult> {
  const nativeHandler = getNativeToolHandler(input.name);
  if (!nativeHandler) return { handled: false };

  const nativeResult = await nativeHandler(input.args, {
    sessionManager: input.sessionManager,
    taskContext: input.taskContext,
  });

  if (nativeResult.isError) {
    const errorSummary = summarizeNativeToolErrorResult(
      nativeResult,
      `Native tool ${input.name} failed`,
    );
    finishToolCallLifecycle({
      sessionManager: input.sessionManager,
      sessionId: input.session.sessionId,
      stepId: input.step.stepId,
      step: {
        status: 'failed',
        errorCode: 'native_tool_error',
        errorSummary,
        resultSummary: `Native tool ${input.name} failed`,
      },
      session: {
        status: 'failed',
        summary: `Native tool ${input.name} failed`,
      },
    });
    return {
      handled: true,
      result: input.recordAndAttachMkeMemoryTrace(nativeResult, {
        requestParams: input.args,
        resultSummary: `Native tool ${input.name} failed`,
        errorCode: 'native_tool_error',
        browserContextKey: input.taskContextAttachment.taskContextKey,
      }),
    };
  }

  finishToolCallLifecycle({
    sessionManager: input.sessionManager,
    sessionId: input.session.sessionId,
    stepId: input.step.stepId,
    step: {
      status: 'completed',
      resultSummary: `Native tool ${input.name} completed`,
    },
    session: {
      status: 'completed',
      summary: `Native tool ${input.name} completed`,
    },
  });
  return {
    handled: true,
    result: input.recordAndAttachMkeMemoryTrace(nativeResult, {
      requestParams: input.args,
      resultSummary: `Native tool ${input.name} completed`,
      browserContextKey: input.taskContextAttachment.taskContextKey,
    }),
  };
}
