import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { SessionManager } from '../execution/session-manager';

type StepCompletion = Parameters<SessionManager['completeStep']>[2];
type SessionCompletion = Parameters<SessionManager['finishSession']>[1];

export function finishToolCallLifecycle(input: {
  sessionManager: Pick<SessionManager, 'completeStep' | 'finishSession'>;
  sessionId: string;
  stepId: string;
  step: StepCompletion;
  session: SessionCompletion;
}): void {
  input.sessionManager.completeStep(input.sessionId, input.stepId, input.step);
  input.sessionManager.finishSession(input.sessionId, input.session);
}

type TraceAttachmentInput = {
  requestParams?: unknown;
  resultSummary?: string | null;
  errorCode?: string | null;
  browserContextKey?: string | null;
};

export function finishAndRecordToolCallResult(input: {
  sessionManager: Pick<SessionManager, 'completeStep' | 'finishSession'>;
  sessionId: string;
  stepId: string;
  step: StepCompletion;
  session: SessionCompletion;
  result: CallToolResult;
  recordTrace: (result: CallToolResult, input?: TraceAttachmentInput) => CallToolResult;
  trace?: TraceAttachmentInput;
}): CallToolResult {
  finishToolCallLifecycle({
    sessionManager: input.sessionManager,
    sessionId: input.sessionId,
    stepId: input.stepId,
    step: input.step,
    session: input.session,
  });
  return input.recordTrace(input.result, input.trace);
}
