import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { TOOL_NAMES } from '@tabrix/shared';
import type { TaskSessionContext } from '../execution/task-session-context';
import {
  evaluateNonInterferencePreflight,
  type NonInterferencePreflightVerdict,
} from '../policy/non-interference-preflight';

type AutoFreshReadbackStatus = 'not_applicable' | 'verified' | 'still_blocked' | 'read_failed';

export interface AutoFreshReadbackOutcome {
  attempted: boolean;
  status: AutoFreshReadbackStatus;
  tabId: number | null;
  retryVerdict: NonInterferencePreflightVerdict | null;
}

export async function maybeRunAutoTaskFreshReadbackBeforeImpact(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  verdict: NonInterferencePreflightVerdict;
  readPage: (args: {
    tabId: number;
    forceRefresh: true;
    requestedLayer: 'L0+L1';
  }) => Promise<CallToolResult>;
}): Promise<AutoFreshReadbackOutcome> {
  const tabId = getAutoFreshReadbackTabId(input);
  if (tabId === null) {
    return { attempted: false, status: 'not_applicable', tabId: null, retryVerdict: null };
  }

  const readResult = await input.readPage({
    tabId,
    forceRefresh: true,
    requestedLayer: 'L0+L1',
  });
  if (readResult.isError === true) {
    return { attempted: true, status: 'read_failed', tabId, retryVerdict: null };
  }

  const retryVerdict = evaluateNonInterferencePreflight({
    toolName: input.toolName,
    args: input.args,
    taskContext: input.taskContext,
  });
  return {
    attempted: true,
    status: retryVerdict.allowed ? 'verified' : 'still_blocked',
    tabId,
    retryVerdict,
  };
}

function getAutoFreshReadbackTabId(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  verdict: NonInterferencePreflightVerdict;
}): number | null {
  if (input.verdict.allowed) return null;
  if (input.taskContext === null) return null;
  if (hasExplicitTaskContextKey(input.args)) return null;
  if (hasImpactUserConfirmation(input.args)) return null;
  if (!isAutoFreshReadbackInteractionTool(input.toolName)) return null;
  if (input.verdict.audit.verdict !== 'collaboration_required') return null;
  if (
    input.verdict.audit.reason !== 'auth_resume_verification_required' &&
    input.verdict.audit.reason !== 'task_resume_readiness_not_proven'
  ) {
    return null;
  }

  const readiness = input.verdict.audit.taskResumeReadiness;
  const handoff = readiness?.handoffSummary;
  if (readiness?.nextStep !== 'force_fresh_read_same_tab') return null;
  if (handoff?.nextAction !== 'run_chrome_read_page_force_refresh') return null;

  const targetTabId =
    input.verdict.audit.targetTabId ??
    readiness?.tabId ??
    input.verdict.audit.authResumeGate?.targetTabId ??
    null;
  return typeof targetTabId === 'number' && Number.isInteger(targetTabId) && targetTabId > 0
    ? targetTabId
    : null;
}

function isAutoFreshReadbackInteractionTool(toolName: string): boolean {
  return (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD
  );
}

function hasExplicitTaskContextKey(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  return ['taskSessionId', 'taskId', 'clientTaskId'].some((key) => {
    const value = record[key];
    return typeof value === 'string' && value.trim().length > 0;
  });
}

function hasImpactUserConfirmation(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  return (
    record.userConfirmed === true ||
    record.allowUserTabImpact === true ||
    record.riskAccepted === true
  );
}
