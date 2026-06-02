import {
  TOOL_NAMES,
  type BrowserPolicyAuditEvent,
  type BrowserRuntimePolicy,
} from '@tabrix/shared';
import type {
  TaskAuthResumeGate,
  TaskResumeReadinessSnapshot,
  TaskSessionContext,
} from '../execution/task-session-context';

export type NonInterferenceVerdictReason =
  | 'not_impact_tool'
  | 'new_run_owned_tab'
  | 'run_owned_tab'
  | 'legacy_explicit_tab_allowed'
  | 'user_confirmed'
  | 'auth_resume_completion_action'
  | 'form_input_continuation_action'
  | 'corrective_search_continuation_action'
  | 'auth_collaboration_continuation_action'
  | 'collaboration_requested'
  | 'auth_resume_verification_required'
  | 'task_resume_readiness_not_proven'
  | 'active_user_tab_unprotected'
  | 'non_run_owned_tab'
  | 'close_non_run_owned_tab';

export type ActionPreflightVerdictKind = 'allow' | 'block' | 'collaboration_required';

export interface RuntimePolicyAudit {
  policy: 'non_interference';
  mode: 'default' | 'strict';
  toolName: string;
  verdict: ActionPreflightVerdictKind;
  reason: NonInterferenceVerdictReason;
  targetTabId: number | null;
  targetTabIds: number[];
  runOwnedTabIds: number[];
  authResumeGate?: TaskAuthResumeGate;
  taskResumeReadiness?: TaskResumeReadinessSnapshot;
  browserPolicyAudit: BrowserPolicyAuditEvent[];
}

export interface NonInterferencePreflightVerdict {
  allowed: boolean;
  message: string | null;
  audit: RuntimePolicyAudit;
}

const IMPACT_TOOL_NAMES = new Set<string>([
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
  TOOL_NAMES.BROWSER.KEYBOARD,
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.CLOSE_TABS,
]);

export function evaluateNonInterferencePreflight(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
}): NonInterferencePreflightVerdict {
  const mode = readStrictPolicyMode(input.args) ? 'strict' : 'default';
  const runOwnedTabIds = input.taskContext ? [...input.taskContext.getRunOwnedTabIds()] : [];
  const targetTabId = readPositiveInteger(input.args, 'tabId');
  const targetTabIds = readPositiveIntegerArray(input.args, 'tabIds');
  const wantsCollaboration = readDesiredExecutionMode(input.args) === 'collaboration';

  if (!IMPACT_TOOL_NAMES.has(input.toolName)) {
    return allow(input, mode, 'not_impact_tool', targetTabId, targetTabIds, runOwnedTabIds);
  }

  if (input.toolName === TOOL_NAMES.BROWSER.NAVIGATE) {
    const url = readString(input.args, 'url');
    if (targetTabId === null && url !== null) {
      return allow(input, mode, 'new_run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
    }
  }

  const authResumeGate = input.taskContext?.peekLastAuthResumeGate() ?? null;
  const taskResumeReadiness = input.taskContext?.buildTaskResumeReadiness({
    tabId: targetTabId,
    nowMs: Date.now(),
  });
  if (
    input.toolName === TOOL_NAMES.BROWSER.CLOSE_TABS &&
    targetTabIds.length > 0 &&
    targetTabIds.every((tabId) => input.taskContext?.isRunOwnedTab(tabId))
  ) {
    return allow(input, mode, 'run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
  }
  if (authResumeGate?.blocksTaskResume) {
    if (
      shouldAllowAuthCollaborationContinuationAction({
        toolName: input.toolName,
        args: input.args,
        taskContext: input.taskContext,
        targetTabId,
      })
    ) {
      return allow(
        input,
        mode,
        'auth_collaboration_continuation_action',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    const message = buildTaskResumeReadinessMessage(taskResumeReadiness);
    if (taskResumeReadiness?.nextStep === 'stop_not_proven') {
      return block(
        input,
        mode,
        'auth_resume_verification_required',
        message,
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
        taskResumeReadiness,
        authResumeGate,
      );
    }
    return collaborationRequired(
      input,
      mode,
      'auth_resume_verification_required',
      message,
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
      authResumeGate,
      taskResumeReadiness,
    );
  }

  if (
    taskResumeReadiness &&
    shouldGateImpactActionForTaskResumeReadiness(input.toolName, taskResumeReadiness)
  ) {
    if (
      shouldAllowFormInputContinuationAction({
        toolName: input.toolName,
        taskContext: input.taskContext,
        targetTabId,
        readiness: taskResumeReadiness,
        userConfirmed: hasUserConfirmation(input.args),
      })
    ) {
      return allow(
        input,
        mode,
        'form_input_continuation_action',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    if (
      shouldAllowAuthResumeCompletionAction({
        toolName: input.toolName,
        args: input.args,
        taskContext: input.taskContext,
        targetTabId,
        readiness: taskResumeReadiness,
      })
    ) {
      return allow(
        input,
        mode,
        'auth_resume_completion_action',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    if (
      shouldAllowCorrectiveSearchContinuationAction({
        toolName: input.toolName,
        args: input.args,
        taskContext: input.taskContext,
        targetTabId,
        readiness: taskResumeReadiness,
        userConfirmed: hasUserConfirmation(input.args),
        strictMode: mode === 'strict',
      })
    ) {
      return allow(
        input,
        mode,
        'corrective_search_continuation_action',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    const message = buildTaskResumeReadinessMessage(taskResumeReadiness);
    if (taskResumeReadiness.nextStep === 'stop_not_proven') {
      return block(
        input,
        mode,
        'task_resume_readiness_not_proven',
        message,
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
        taskResumeReadiness,
      );
    }
    return collaborationRequired(
      input,
      mode,
      'task_resume_readiness_not_proven',
      message,
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
      undefined,
      taskResumeReadiness,
    );
  }

  if (hasUserConfirmation(input.args)) {
    return allow(input, mode, 'user_confirmed', targetTabId, targetTabIds, runOwnedTabIds);
  }

  if (input.toolName === TOOL_NAMES.BROWSER.NAVIGATE) {
    if (targetTabId !== null && input.taskContext?.isRunOwnedTab(targetTabId)) {
      return allow(input, mode, 'run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
    }
    if (targetTabId === null) {
      if (wantsCollaboration) {
        return collaborationRequired(
          input,
          mode,
          'collaboration_requested',
          'Navigation requires foreground collaboration before touching the current active user tab.',
          targetTabId,
          targetTabIds,
          runOwnedTabIds,
        );
      }
      return block(
        input,
        mode,
        'active_user_tab_unprotected',
        'Blocked navigation against the current active user tab. Open a run-owned tab or pass an explicit confirmed tab target.',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    return mode === 'strict'
      ? block(
          input,
          mode,
          'non_run_owned_tab',
          'Blocked navigation against a tab that is not owned by this task.',
          targetTabId,
          targetTabIds,
          runOwnedTabIds,
        )
      : allow(
          input,
          mode,
          'legacy_explicit_tab_allowed',
          targetTabId,
          targetTabIds,
          runOwnedTabIds,
        );
  }

  if (input.toolName === TOOL_NAMES.BROWSER.CLOSE_TABS) {
    if (targetTabIds.length === 0) {
      return block(
        input,
        mode,
        'active_user_tab_unprotected',
        'Blocked close request without explicit tabIds. Current active user tab close is not allowed.',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    const allRunOwned = targetTabIds.every((tabId) => input.taskContext?.isRunOwnedTab(tabId));
    if (allRunOwned) {
      return allow(input, mode, 'run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
    }
    return mode === 'strict'
      ? block(
          input,
          mode,
          'close_non_run_owned_tab',
          'Blocked close request containing tabs that are not owned by this task.',
          targetTabId,
          targetTabIds,
          runOwnedTabIds,
        )
      : allow(
          input,
          mode,
          'legacy_explicit_tab_allowed',
          targetTabId,
          targetTabIds,
          runOwnedTabIds,
        );
  }

  if (targetTabId === null) {
    if (wantsCollaboration) {
      return collaborationRequired(
        input,
        mode,
        'collaboration_requested',
        'Impact action requires foreground collaboration before touching the current active user tab.',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      );
    }
    return block(
      input,
      mode,
      'active_user_tab_unprotected',
      'Blocked impact action against the current active user tab. Use a run-owned tab, explicit tabId, or user confirmation.',
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
    );
  }

  if (input.taskContext?.isRunOwnedTab(targetTabId)) {
    return allow(input, mode, 'run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
  }

  return mode === 'strict'
    ? block(
        input,
        mode,
        'non_run_owned_tab',
        'Blocked impact action against a tab that is not owned by this task.',
        targetTabId,
        targetTabIds,
        runOwnedTabIds,
      )
    : allow(input, mode, 'legacy_explicit_tab_allowed', targetTabId, targetTabIds, runOwnedTabIds);
}

export function isImpactToolName(toolName: string): boolean {
  return IMPACT_TOOL_NAMES.has(toolName);
}

export function attachRuntimePolicyAuditToResult<T extends { content?: unknown }>(
  result: T,
  audit: RuntimePolicyAudit,
): T {
  const content = Array.isArray(result.content) ? result.content : null;
  if (!content) return result;

  return {
    ...result,
    content: content.map((block, index) => {
      if (index !== 0 || !block || typeof block !== 'object') return block;
      const text = (block as { text?: unknown }).text;
      if (typeof text !== 'string' || text.length === 0) return block;
      let payload: Record<string, unknown>;
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return block;
        payload = parsed as Record<string, unknown>;
      } catch {
        payload = { message: text };
      }
      return {
        ...block,
        text: JSON.stringify({
          ...payload,
          actionPreflight: {
            verdict: audit.verdict,
            reason: audit.reason,
          },
          runtimePolicyAudit: audit,
        }),
      };
    }),
  };
}

function allow(
  input: { toolName: string },
  mode: RuntimePolicyAudit['mode'],
  reason: NonInterferenceVerdictReason,
  targetTabId: number | null,
  targetTabIds: number[],
  runOwnedTabIds: number[],
): NonInterferencePreflightVerdict {
  return {
    allowed: true,
    message: null,
    audit: {
      policy: 'non_interference',
      mode,
      toolName: input.toolName,
      verdict: 'allow',
      reason,
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
      browserPolicyAudit: buildBrowserPolicyAudit({
        reason,
        verdict: 'allow',
        source: 'runtime',
      }),
    },
  };
}

function block(
  input: { toolName: string },
  mode: RuntimePolicyAudit['mode'],
  reason: NonInterferenceVerdictReason,
  message: string,
  targetTabId: number | null,
  targetTabIds: number[],
  runOwnedTabIds: number[],
  taskResumeReadiness?: TaskResumeReadinessSnapshot,
  authResumeGate?: TaskAuthResumeGate,
): NonInterferencePreflightVerdict {
  return {
    allowed: false,
    message,
    audit: {
      policy: 'non_interference',
      mode,
      toolName: input.toolName,
      verdict: 'block',
      reason,
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
      ...(authResumeGate ? { authResumeGate } : {}),
      ...(taskResumeReadiness ? { taskResumeReadiness } : {}),
      browserPolicyAudit: buildBrowserPolicyAudit({
        reason,
        verdict: 'block',
        source: 'policy',
      }),
    },
  };
}

function collaborationRequired(
  input: { toolName: string },
  mode: RuntimePolicyAudit['mode'],
  reason: NonInterferenceVerdictReason,
  message: string,
  targetTabId: number | null,
  targetTabIds: number[],
  runOwnedTabIds: number[],
  authResumeGate?: TaskAuthResumeGate,
  taskResumeReadiness?: TaskResumeReadinessSnapshot,
): NonInterferencePreflightVerdict {
  return {
    allowed: false,
    message,
    audit: {
      policy: 'non_interference',
      mode,
      toolName: input.toolName,
      verdict: 'collaboration_required',
      reason,
      targetTabId,
      targetTabIds,
      runOwnedTabIds,
      ...(authResumeGate ? { authResumeGate } : {}),
      ...(taskResumeReadiness ? { taskResumeReadiness } : {}),
      browserPolicyAudit: buildBrowserPolicyAudit({
        reason,
        verdict: 'collaboration_required',
        source: 'policy',
      }),
    },
  };
}

function shouldGateImpactActionForTaskResumeReadiness(
  toolName: string,
  readiness: TaskResumeReadinessSnapshot,
): boolean {
  if (toolName === TOOL_NAMES.BROWSER.CLOSE_TABS) return false;
  if (readiness.canResumeOriginalTask) return false;
  if (readiness.evidenceKinds.length === 0) return false;
  if (readiness.evidenceKinds.includes('page_load_readiness')) {
    return (
      toolName === TOOL_NAMES.BROWSER.CLICK ||
      toolName === TOOL_NAMES.BROWSER.FILL ||
      toolName === TOOL_NAMES.BROWSER.KEYBOARD
    );
  }
  return (
    readiness.status === 'postcondition_unknown_not_proven' ||
    readiness.status === 'postcondition_failed_stop' ||
    readiness.status === 'blocked_by_auth_verification'
  );
}

function shouldAllowFormInputContinuationAction(input: {
  toolName: string;
  taskContext: TaskSessionContext | null;
  targetTabId: number | null;
  readiness: TaskResumeReadinessSnapshot;
  userConfirmed: boolean;
}): boolean {
  if (!isFormContinuationImpactTool(input.toolName)) return false;
  if (input.readiness.status !== 'postcondition_unknown_not_proven') return false;
  if (input.readiness.nextStep !== 'force_fresh_read_same_tab') return false;
  if (!input.readiness.evidenceKinds.includes('pending_page_interaction')) return false;
  if (!input.readiness.evidenceKinds.includes('business_verification_plan')) return false;
  if (
    !input.readiness.reason.startsWith(
      'pending_business_verification_requires_fresh_read:form_value_state_changed:',
    )
  ) {
    return false;
  }

  const targetTabId = input.targetTabId;
  const targetTabMatches =
    targetTabId !== null &&
    (input.readiness.tabId === null || input.readiness.tabId === targetTabId);
  if (!targetTabMatches) return false;
  if (targetTabId !== null && input.taskContext?.isRunOwnedTab(targetTabId) === true) return true;
  return input.userConfirmed;
}

function isFormContinuationImpactTool(toolName: string): boolean {
  return (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD
  );
}

function shouldAllowAuthResumeCompletionAction(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  targetTabId: number | null;
  readiness: TaskResumeReadinessSnapshot;
}): boolean {
  if (input.toolName !== TOOL_NAMES.BROWSER.CLICK) return false;
  if (input.readiness.status !== 'blocked_by_auth_verification') return false;
  if (input.readiness.nextStep !== 'wait_for_user_collaboration') return false;
  if (!input.readiness.evidenceKinds.includes('user_collaboration_required')) return false;
  if (readCandidateActionIntent(input.args) !== 'auth.submit_login') return false;
  return input.targetTabId !== null && input.taskContext?.isRunOwnedTab(input.targetTabId) === true;
}

function shouldAllowCorrectiveSearchContinuationAction(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  targetTabId: number | null;
  readiness: TaskResumeReadinessSnapshot;
  userConfirmed: boolean;
  strictMode: boolean;
}): boolean {
  if (!isFormContinuationImpactTool(input.toolName)) return false;
  if (input.readiness.status !== 'postcondition_failed_stop') return false;
  if (input.readiness.nextStep !== 'stop_not_proven') return false;
  if (!input.readiness.evidenceKinds.includes('region_state_postcondition')) return false;
  if (!input.readiness.reason.includes('search_results_updated_failed:')) return false;

  const intent = readCandidateActionIntent(input.args);
  if (
    intent !== 'search.focus_input' &&
    intent !== 'search.enter_query' &&
    intent !== 'search.submit'
  ) {
    return false;
  }

  const targetTabId = input.targetTabId;
  const targetTabMatches =
    targetTabId !== null &&
    (input.readiness.tabId === null || input.readiness.tabId === targetTabId);
  if (!targetTabMatches) return false;
  if (targetTabId !== null && input.taskContext?.isRunOwnedTab(targetTabId) === true) return true;
  if (input.strictMode) return false;
  return input.userConfirmed || hasExplicitLegacyTabTarget(input.args);
}

function shouldAllowAuthCollaborationContinuationAction(input: {
  toolName: string;
  args: unknown;
  taskContext: TaskSessionContext | null;
  targetTabId: number | null;
}): boolean {
  if (input.toolName !== TOOL_NAMES.BROWSER.CLICK) return false;
  if (readCandidateActionIntent(input.args) !== 'auth.refresh_qr') return false;
  return input.targetTabId !== null && input.taskContext?.isRunOwnedTab(input.targetTabId) === true;
}

function buildTaskResumeReadinessMessage(
  readiness: TaskResumeReadinessSnapshot | null | undefined,
): string {
  return (
    readiness?.handoffSummary.message ??
    'Do not continue the original task yet. Verify the business postcondition with fresh page evidence first.'
  );
}

function buildBrowserPolicyAudit(input: {
  reason: NonInterferenceVerdictReason;
  verdict: ActionPreflightVerdictKind;
  source: BrowserPolicyAuditEvent['source'];
}): BrowserPolicyAuditEvent[] {
  const field: keyof BrowserRuntimePolicy =
    input.verdict === 'block' ? 'riskPolicy' : 'desiredExecutionMode';
  return [
    {
      field,
      requestedValue: input.reason,
      previousValue: 'unknown',
      effectiveValue: input.verdict === 'block' ? 'read_only' : 'run_owned',
      verdict: input.verdict === 'block' ? 'rejected' : 'applied',
      reason: input.reason,
      at: new Date().toISOString(),
      source: input.source,
    },
  ];
}

function hasUserConfirmation(args: unknown): boolean {
  return (
    readBoolean(args, 'userConfirmed') === true ||
    readBoolean(args, 'allowUserTabImpact') === true ||
    readBoolean(args, 'riskAccepted') === true
  );
}

function readStrictPolicyMode(args: unknown): boolean {
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  if (record.nonInterferencePolicy === 'strict') return true;
  const runtimePolicy = record.runtimePolicy;
  return (
    runtimePolicy !== null &&
    typeof runtimePolicy === 'object' &&
    (runtimePolicy as Record<string, unknown>).nonInterference === 'strict'
  );
}

function readDesiredExecutionMode(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  if (typeof record.desiredExecutionMode === 'string') return record.desiredExecutionMode;
  const runtimePolicy = record.runtimePolicy;
  return runtimePolicy !== null &&
    typeof runtimePolicy === 'object' &&
    typeof (runtimePolicy as Record<string, unknown>).desiredExecutionMode === 'string'
    ? (runtimePolicy as Record<string, string>).desiredExecutionMode
    : null;
}

function readString(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readCandidateActionIntent(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const candidateAction = (args as Record<string, unknown>).candidateAction;
  if (!candidateAction || typeof candidateAction !== 'object') return null;
  return readString(candidateAction, 'intent');
}

function hasExplicitLegacyTabTarget(args: unknown): boolean {
  return readPositiveInteger(args, 'tabId') !== null;
}

function readBoolean(args: unknown, key: string): boolean | null {
  if (!args || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

function readPositiveInteger(args: unknown, key: string): number | null {
  if (!args || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>)[key];
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : null;
}

function readPositiveIntegerArray(args: unknown, key: string): number[] {
  if (!args || typeof args !== 'object') return [];
  const value = (args as Record<string, unknown>)[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => Number.isInteger(entry) && entry > 0);
}
