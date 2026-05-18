import { TOOL_NAMES } from '@tabrix/shared';
import type { TaskSessionContext } from '../execution/task-session-context';

export type NonInterferenceVerdictReason =
  | 'not_impact_tool'
  | 'new_run_owned_tab'
  | 'run_owned_tab'
  | 'legacy_explicit_tab_allowed'
  | 'user_confirmed'
  | 'active_user_tab_unprotected'
  | 'non_run_owned_tab'
  | 'close_non_run_owned_tab';

export interface RuntimePolicyAudit {
  policy: 'non_interference';
  mode: 'default' | 'strict';
  toolName: string;
  verdict: 'allow' | 'block';
  reason: NonInterferenceVerdictReason;
  targetTabId: number | null;
  targetTabIds: number[];
  runOwnedTabIds: number[];
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

  if (!IMPACT_TOOL_NAMES.has(input.toolName)) {
    return allow(input, mode, 'not_impact_tool', targetTabId, targetTabIds, runOwnedTabIds);
  }

  if (hasUserConfirmation(input.args)) {
    return allow(input, mode, 'user_confirmed', targetTabId, targetTabIds, runOwnedTabIds);
  }

  if (input.toolName === TOOL_NAMES.BROWSER.NAVIGATE) {
    const url = readString(input.args, 'url');
    if (targetTabId === null && url !== null) {
      return allow(input, mode, 'new_run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
    }
    if (targetTabId !== null && input.taskContext?.isRunOwnedTab(targetTabId)) {
      return allow(input, mode, 'run_owned_tab', targetTabId, targetTabIds, runOwnedTabIds);
    }
    if (targetTabId === null) {
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
    },
  };
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

function readString(args: unknown, key: string): string | null {
  if (!args || typeof args !== 'object') return null;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
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
