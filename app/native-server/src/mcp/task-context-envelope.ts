import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildBrowserTaskStateVerdict,
  type BrowserPageThingProjection,
  type BrowserTaskStateVerdict,
  type ReadPageAuthResumeVerification,
} from '@tabrix/shared';
import type { TaskAuthResumeGate, TaskSessionContext } from '../execution/task-session-context';
import { stripReadPageDiagnosticNoiseForOutput } from './read-page-ai-output';
import {
  readBoolean,
  readObject,
  readPositiveInteger,
  readString,
} from './register-tool-value-readers';

export type TaskContextKeySource = 'external_task_key' | 'internal_task_id';

export interface TaskContextAttachment {
  toolName: string;
  taskContext: TaskSessionContext | null;
  taskContextKey: string;
  taskContextKeySource: TaskContextKeySource;
  requestArgs?: unknown;
}

export function buildTaskContextEnvelope(
  attachment: TaskContextAttachment,
): Record<string, unknown> {
  const { taskContext } = attachment;
  if (!taskContext) {
    return {
      envelopeKind: 'task_context',
      status: 'context_missing',
      source: 'unavailable',
      taskContextKey: attachment.taskContextKey,
      taskContextKeySource: attachment.taskContextKeySource,
      toolName: attachment.toolName,
      reason: 'task_session_context_unavailable',
      evidenceBoundary: {
        deterministicOnly: true,
        realBrowserProven: false,
        commercialDeliveryProven: false,
      },
    };
  }

  const runOwnedTabIds = taskContext.getRunOwnedTabIds();
  const cleanupPolicy = readRuntimePolicyString(attachment.requestArgs, 'cleanupPolicy');
  const finalizeStatus = buildTaskOwnedSessionFinalizeStatus({
    cleanupPolicy,
    runOwnedTabCount: runOwnedTabIds.length,
  });

  return {
    envelopeKind: 'task_context',
    status: 'attached',
    source: 'task_session_context',
    taskContextKey: attachment.taskContextKey,
    taskContextKeySource: attachment.taskContextKeySource,
    toolName: attachment.toolName,
    currentUrlKnown: taskContext.currentUrl !== null,
    pageRoleKnown: taskContext.pageRole !== null,
    readPageCount: taskContext.readPageCount,
    readBudget: taskContext.readBudget,
    readPageRemainingBudget: Math.max(0, taskContext.readBudget - taskContext.readPageCount),
    lastReadLayer: taskContext.lastReadLayer,
    lastReadSource: taskContext.lastReadSource,
    lifecycleEventCount: taskContext.getLifecycleTimeline().length,
    runOwnedTabCount: runOwnedTabIds.length,
    runOwnedTabIds,
    taskOwnedSession: {
      taskSessionId: attachment.taskContextKey,
      runOwnedTabCount: runOwnedTabIds.length,
      runOwnedTabIds,
      desiredExecutionMode: readRuntimePolicyString(attachment.requestArgs, 'desiredExecutionMode'),
      focusPolicy: readRuntimePolicyString(attachment.requestArgs, 'focusPolicy'),
      cleanupPolicy,
      finalizeStatus,
      nextAction: buildTaskOwnedSessionNextAction(finalizeStatus),
    },
    taskTotals: taskContext.getTaskTotals(),
    evidenceBoundary: {
      deterministicOnly: true,
      realBrowserProven: false,
      commercialDeliveryProven: false,
    },
  };
}

function readRuntimePolicyString(args: unknown, key: string): string | null {
  const record = readObject(args);
  const direct = readString(record?.[key]);
  if (direct) return direct;
  const runtimePolicy = readObject(record?.runtimePolicy);
  return readString(runtimePolicy?.[key]);
}

function buildTaskOwnedSessionFinalizeStatus(input: {
  cleanupPolicy: string | null;
  runOwnedTabCount: number;
}): 'cleanup_complete' | 'cleanup_required' | 'cleanup_not_requested' | 'cleanup_policy_unknown' {
  if (input.cleanupPolicy === 'close_run_owned') {
    return input.runOwnedTabCount === 0 ? 'cleanup_complete' : 'cleanup_required';
  }
  if (input.cleanupPolicy) return 'cleanup_not_requested';
  return input.runOwnedTabCount > 0 ? 'cleanup_policy_unknown' : 'cleanup_not_requested';
}

function buildTaskOwnedSessionNextAction(
  finalizeStatus: ReturnType<typeof buildTaskOwnedSessionFinalizeStatus>,
): 'none' | 'call_chrome_close_tabs_for_run_owned_tabs' | 'decide_cleanup_policy' {
  if (finalizeStatus === 'cleanup_required') return 'call_chrome_close_tabs_for_run_owned_tabs';
  if (finalizeStatus === 'cleanup_policy_unknown') return 'decide_cleanup_policy';
  return 'none';
}

export function attachTaskContextEnvelopeToJsonResult(
  result: CallToolResult,
  attachment: TaskContextAttachment,
  options?: { stripReadPageDiagnostics?: boolean },
): CallToolResult {
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(first.text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result;
    payload = parsed as Record<string, unknown>;
  } catch {
    return result;
  }

  payload.taskContextEnvelope = buildTaskContextEnvelope(attachment);
  let responsePayload = payload;
  if (options?.stripReadPageDiagnostics === true) {
    delete payload.aiContextEnvelope;
    responsePayload = stripReadPageDiagnosticNoiseForOutput(payload);
  }
  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}

export function buildAiFacingTaskState(args: {
  payload: Record<string, unknown>;
  projection: BrowserPageThingProjection;
  fallbackReason: string | null;
  authResumeGate?: TaskAuthResumeGate | null;
}): BrowserTaskStateVerdict {
  const authResumeReason = args.authResumeGate?.blocksTaskResume
    ? `auth_or_login_required:${args.authResumeGate.reason}`
    : null;
  const readinessReason =
    authResumeReason ??
    readString(args.payload.readinessReason) ??
    readString(args.payload.blockedReadinessReason) ??
    args.fallbackReason;
  const policyDeniedReason =
    readString(args.payload.policyDeniedReason) ?? readString(args.payload.policyReason);
  const externalBlockedReason =
    readString(args.payload.externalBlockedReason) ?? readString(args.payload.externalBlockReason);
  return buildBrowserTaskStateVerdict({
    projection: args.projection,
    readinessReason,
    policyDeniedReason,
    externalBlockedReason,
  });
}

export function readAuthResumeVerification(
  payload: Record<string, unknown>,
): ReadPageAuthResumeVerification | null {
  const authCollaboration = readObject(payload.authCollaboration);
  const evidence = readObject(authCollaboration?.evidence);
  const resumeVerification = readObject(evidence?.resumeVerification);
  if (!resumeVerification) return null;

  const status = readString(resumeVerification.status);
  if (
    status !== 'not_required' &&
    status !== 'required_after_user_action' &&
    status !== 'fresh_read_required' &&
    status !== 'postcondition_required' &&
    status !== 'not_proven'
  ) {
    return null;
  }
  const nextTool = readString(resumeVerification.nextTool);
  if (nextTool !== 'chrome_read_page') return null;

  const rawSignals = Array.isArray(resumeVerification.requiredSignals)
    ? resumeVerification.requiredSignals
    : [];
  const requiredSignals = rawSignals
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9:_-]{1,96}$/.test(value))
    .slice(0, 12);
  return {
    status,
    nextTool,
    forceRefreshRequired: readBoolean(resumeVerification, 'forceRefreshRequired') === true,
    sameTabRequired: readBoolean(resumeVerification, 'sameTabRequired') === true,
    targetTabId: readPositiveInteger(resumeVerification, 'targetTabId') ?? undefined,
    postconditionRequired: readBoolean(resumeVerification, 'postconditionRequired') === true,
    requiredSignals,
    claimBoundary:
      readString(resumeVerification.claimBoundary) ??
      'auth resume verification must be proven by fresh same-tab read and postcondition evidence',
  };
}
