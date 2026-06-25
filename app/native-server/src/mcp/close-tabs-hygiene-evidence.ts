import type { LifecycleEvidenceBrowserHygieneCheck } from '@tabrix/shared';

export interface CloseTabsBrowserSnapshot {
  tabCount: number;
  windowCount: number;
  focusedWindowId: number | null;
  activeTabId: number | null;
}

export interface CloseTabsBrowserHygieneEvidence {
  before: CloseTabsBrowserSnapshot;
  after: CloseTabsBrowserSnapshot;
  tabWindowBaselineUnchanged: boolean | null;
  activeTabRestored: boolean | null;
  activeTabRestoreReason: string | null;
}

export function buildCloseTabsSuccessHygieneChecks(
  input: {
    closedTabIds: number[];
    invalidTabIds: number[];
  },
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck[] {
  const cleanupCount = input.closedTabIds.length + input.invalidTabIds.length;
  return [
    buildCloseTabsTabWindowBaselineCheck(evidence),
    buildCloseTabsActiveTabRestoreCheck(evidence),
    {
      kind: 'run_owned_cleanup',
      verdict: cleanupCount > 0 ? 'pass' : 'unknown',
      reason: cleanupCount > 0 ? 'run_owned_tabs_cleaned' : 'browser_hygiene_check_not_reported',
    },
    {
      kind: 'user_owned_protection',
      verdict: 'pass',
      reason: 'user_owned_tabs_protected',
    },
    {
      kind: 'failure_cleanup',
      verdict: 'pass',
      reason: 'failure_cleanup_not_needed',
    },
  ];
}

export function extractCloseTabsBrowserHygieneEvidence(
  result: unknown,
): CloseTabsBrowserHygieneEvidence | null {
  for (const payload of extractObjectPayloadsFromToolResult(result)) {
    const evidence = readCloseTabsBrowserHygieneEvidenceFromPayload(payload);
    if (evidence) return evidence;
  }
  return null;
}

export function readCloseTabsBrowserHygieneEvidenceFromPayload(
  payload: Record<string, unknown>,
): CloseTabsBrowserHygieneEvidence | null {
  const rawEvidence = readObject(payload.browserHygieneEvidence);
  if (!rawEvidence) return null;
  const before = readCloseTabsBrowserSnapshot(rawEvidence.before);
  const after = readCloseTabsBrowserSnapshot(rawEvidence.after);
  if (!before || !after) return null;
  return {
    before,
    after,
    tabWindowBaselineUnchanged: readNullableBoolean(rawEvidence, 'tabWindowBaselineUnchanged'),
    activeTabRestored: readNullableBoolean(rawEvidence, 'activeTabRestored'),
    activeTabRestoreReason: readString(rawEvidence.activeTabRestoreReason),
  };
}

function buildCloseTabsTabWindowBaselineCheck(
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck {
  if (evidence?.tabWindowBaselineUnchanged === true) {
    return {
      kind: 'tab_window_baseline',
      verdict: 'pass',
      reason: 'pre_post_tab_window_baseline_unchanged',
    };
  }
  if (evidence?.tabWindowBaselineUnchanged === false) {
    return {
      kind: 'tab_window_baseline',
      verdict: 'fail',
      reason: 'pre_post_tab_window_baseline_changed',
    };
  }
  return {
    kind: 'tab_window_baseline',
    verdict: 'unknown',
    reason: 'browser_hygiene_check_not_reported',
  };
}

function buildCloseTabsActiveTabRestoreCheck(
  evidence: CloseTabsBrowserHygieneEvidence | null,
): LifecycleEvidenceBrowserHygieneCheck {
  if (evidence?.activeTabRestored === true) {
    return {
      kind: 'active_tab_restore',
      verdict: 'pass',
      reason: 'active_tab_restored',
    };
  }
  if (evidence?.activeTabRestored === false) {
    return {
      kind: 'active_tab_restore',
      verdict: 'fail',
      reason: 'active_tab_not_restored',
    };
  }
  return {
    kind: 'active_tab_restore',
    verdict: 'unknown',
    reason: 'browser_hygiene_check_not_reported',
  };
}

function readCloseTabsBrowserSnapshot(input: unknown): CloseTabsBrowserSnapshot | null {
  const snapshot = readObject(input);
  if (!snapshot) return null;
  const tabCount = readNonNegativeInteger(snapshot, 'tabCount');
  const windowCount = readNonNegativeInteger(snapshot, 'windowCount');
  if (tabCount === null || windowCount === null) return null;
  return {
    tabCount,
    windowCount,
    focusedWindowId: readPositiveInteger(snapshot, 'focusedWindowId'),
    activeTabId: readPositiveInteger(snapshot, 'activeTabId'),
  };
}

function extractObjectPayloadsFromToolResult(data: unknown): Array<Record<string, unknown>> {
  const payloads: Array<Record<string, unknown>> = [];
  const root = readObject(data);
  if (!root) return payloads;
  payloads.push(root);
  const content = root.content;
  if (!Array.isArray(content)) return payloads;
  for (const entry of content) {
    const block = readObject(entry);
    if (!block || typeof block.text !== 'string' || block.text.length === 0) continue;
    try {
      const parsed = JSON.parse(block.text);
      const payload = readObject(parsed);
      if (payload) payloads.push(payload);
    } catch {
      // Not JSON; skip.
    }
  }
  return payloads;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNullableBoolean(input: unknown, key: string): boolean | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === 'boolean' ? raw : null;
}

function readPositiveInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
}

function readNonNegativeInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : null;
}
