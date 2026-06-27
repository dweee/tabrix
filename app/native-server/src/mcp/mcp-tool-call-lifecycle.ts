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
