import { TOOL_NAMES } from '@tabrix/shared';
import type {
  ActionKind,
  BrowserPageChangeCause,
  BuildPostActionDeltaEvidenceInput,
  PostActionDeltaEvidence,
  ReadPageCandidateActionIntent,
} from '@tabrix/shared';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TaskPageInteractionSnapshot } from '../execution/task-session-context';
import { readJsonObjectFromCallToolResult } from './register-tool-result-json';
import {
  readBoolean,
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  readStringArray,
} from './register-tool-value-readers';

export function shouldInvalidateReadAfterInteraction(toolName: string, args?: unknown): boolean {
  if (
    toolName === TOOL_NAMES.BROWSER.CLICK ||
    toolName === TOOL_NAMES.BROWSER.FILL ||
    toolName === TOOL_NAMES.BROWSER.KEYBOARD ||
    toolName === TOOL_NAMES.BROWSER.SWITCH_TAB
  ) {
    return true;
  }

  if (toolName !== TOOL_NAMES.BROWSER.NAVIGATE) return false;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  return (args as Record<string, unknown>).refresh === true;
}

export function shouldRecordPageInteractionAfterResult(
  toolName: string,
  args: unknown,
  result: CallToolResult,
): boolean {
  if (!shouldInvalidateReadAfterInteraction(toolName, args)) return false;

  const payload = readJsonObjectFromCallToolResult(result);
  if (!payload) return (result as { isError?: boolean }).isError !== true;

  const dispatchSucceeded = readBoolean(payload, 'dispatchSucceeded');
  if (dispatchSucceeded === true) return true;
  if (dispatchSucceeded === false) return false;

  const targetConsistency = readObject(payload.targetConsistency);
  const targetConsistencyVerdict = readString(targetConsistency?.verdict);
  if (
    targetConsistencyVerdict === 'blocked_by_overlay' ||
    targetConsistencyVerdict === 'target_mismatch'
  ) {
    return false;
  }

  const error = readString(payload.error);
  const reason = readString(payload.reason);
  if (
    error === 'blocked_by_overlay' ||
    error === 'target_mismatch' ||
    reason === 'blocked_by_overlay' ||
    reason === 'target_mismatch'
  ) {
    return false;
  }

  if (payload.success === false) return false;
  return (result as { isError?: boolean }).isError !== true;
}

export function inferPageInteractionChangeCause(
  toolName: string,
  result: CallToolResult,
): BrowserPageChangeCause {
  if (toolName !== TOOL_NAMES.BROWSER.CLICK) return 'unknown';
  const payload = readJsonObjectFromCallToolResult(result);
  const observedOutcome =
    payload && typeof payload.observedOutcome === 'string' ? payload.observedOutcome : null;
  if (
    observedOutcome === null ||
    observedOutcome === 'no_observed_change' ||
    observedOutcome === 'verification_unavailable'
  ) {
    return 'unknown';
  }
  return 'click';
}

export function inferActionKindForToolName(toolName: string): ActionKind {
  if (toolName === TOOL_NAMES.BROWSER.CLICK) return 'click';
  if (toolName === TOOL_NAMES.BROWSER.FILL) return 'fill';
  if (toolName === TOOL_NAMES.BROWSER.KEYBOARD) return 'keyboard';
  if (toolName === TOOL_NAMES.BROWSER.NAVIGATE) return 'navigate';
  return 'unknown';
}

export function readInteractionTargetRefs(args: unknown): string[] {
  const input = readObject(args);
  if (!input) return [];
  const refs = [
    readSafeTargetRef(input.ref),
    readSafeTargetRef(readObject(input.candidateAction)?.targetRef),
  ].filter((ref): ref is string => ref !== null);
  return refs.filter((ref, index) => refs.indexOf(ref) === index).slice(0, 3);
}

export function bindPostActionDeltaEvidenceToPendingInteraction(
  postActionDeltaEvidence: unknown,
  pageObjectSnapshot: unknown,
  pendingInteraction: TaskPageInteractionSnapshot | null,
): PostActionDeltaEvidence | null {
  const evidence = readObject(postActionDeltaEvidence);
  if (!evidence || pendingInteraction === null) return null;
  const actionId =
    readSafeIdentifier(pendingInteraction.candidateActionId) ??
    readSafeIdentifier(pendingInteraction.action);
  const targetObjectId =
    findReadPageObjectIdForTargetRefs(pageObjectSnapshot, pendingInteraction.targetRefs) ??
    readSafeIdentifier(evidence.targetObjectId);

  return {
    ...evidence,
    actionId,
    targetObjectId,
  } as unknown as PostActionDeltaEvidence;
}

function findReadPageObjectIdForTargetRefs(
  pageObjectSnapshot: unknown,
  targetRefs: readonly string[],
): string | null {
  if (targetRefs.length === 0) return null;
  const targetRefSet = new Set(targetRefs);
  const snapshot = readObject(pageObjectSnapshot);
  if (!snapshot) return null;

  const objects = Array.isArray(snapshot.objects) ? snapshot.objects : [];
  for (const object of objects) {
    const item = readObject(object);
    if (!item) continue;
    const objectId = readSafeIdentifier(item.objectId);
    if (!objectId) continue;
    const targetRef = readSafeTargetRef(item.targetRef) ?? readSafeTargetRef(item.ref);
    if (targetRef && targetRefSet.has(targetRef)) return objectId;
  }

  const actionableTargets = Array.isArray(snapshot.actionableTargets)
    ? snapshot.actionableTargets
    : [];
  for (const target of actionableTargets) {
    const item = readObject(target);
    if (!item) continue;
    const objectId = readSafeIdentifier(item.objectId) ?? readSafeIdentifier(item.targetId);
    if (!objectId) continue;
    const targetRef = readSafeTargetRef(item.targetRef) ?? readSafeTargetRef(item.ref);
    if (targetRef && targetRefSet.has(targetRef)) return objectId;
  }

  return null;
}

export function readCandidateActionMetadata(args: unknown): {
  candidateActionId: string | null;
  candidateActionIntent: ReadPageCandidateActionIntent | string | null;
} {
  const input = readObject(args);
  const candidateAction = readObject(input?.candidateAction);
  return {
    candidateActionId: readSafeIdentifier(candidateAction?.id),
    candidateActionIntent: readSafeIdentifier(candidateAction?.intent),
  };
}

export function readSafeTargetRef(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:_-]{1,96}$/.test(trimmed) ? trimmed : null;
}

function readSafeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9:._-]{1,160}$/.test(trimmed) ? trimmed : null;
}

export function shouldInvalidateReadAfterWindowFocusChange(
  toolName: string,
  args: unknown,
): boolean {
  if (toolName !== TOOL_NAMES.BROWSER.NAVIGATE) return false;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return false;
  const input = args as Record<string, unknown>;
  if (input.background === true || input.refresh === true) return false;
  if (readPositiveInteger(input, 'tabId') !== null) return false;
  const url = typeof input.url === 'string' ? input.url : null;
  if (!url || url === 'back' || url === 'forward') return false;
  return true;
}

export function buildPostActionDeltaSignalsFromEvidence(
  evidence: PostActionDeltaEvidence | null | undefined,
): Pick<
  BuildPostActionDeltaEvidenceInput,
  | 'targetObjectId'
  | 'observedChangeKind'
  | 'navigationDelta'
  | 'focusDelta'
  | 'objectDelta'
  | 'networkSignalSummary'
  | 'observedSignalDeltas'
> {
  if (!evidence) return {};
  const navigationDelta = readObject(evidence.navigationDelta);
  const focusDelta = readObject(evidence.focusDelta);
  const objectDelta = readObject(evidence.objectDelta);
  const networkSignalSummary = readObject(evidence.networkSignalSummary);
  const observedSignalDeltas = readObject(evidence.observedSignalDeltas);

  return {
    targetObjectId: readSafeIdentifier(evidence.targetObjectId),
    observedChangeKind:
      (readSafeIdentifier(evidence.observedChangeKind) as
        | BuildPostActionDeltaEvidenceInput['observedChangeKind']
        | null) ?? null,
    navigationDelta: navigationDelta
      ? {
          status:
            (readSafeIdentifier(navigationDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['navigationDelta']>['status']
              | null) ?? undefined,
          beforeUrl: readString(navigationDelta.beforeUrl),
          afterUrl: readString(navigationDelta.afterUrl),
        }
      : undefined,
    focusDelta: focusDelta
      ? {
          status:
            (readSafeIdentifier(focusDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['focusDelta']>['status']
              | null) ?? undefined,
          beforeTabId: readNumber(focusDelta.beforeTabId),
          afterTabId: readNumber(focusDelta.afterTabId),
        }
      : undefined,
    objectDelta: objectDelta
      ? {
          status:
            (readSafeIdentifier(objectDelta.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['objectDelta']>['status']
              | null) ?? undefined,
          changedObjectIds: readStringArray(objectDelta.changedObjectIds),
        }
      : undefined,
    networkSignalSummary: networkSignalSummary
      ? {
          status:
            (readSafeIdentifier(networkSignalSummary.status) as
              | NonNullable<BuildPostActionDeltaEvidenceInput['networkSignalSummary']>['status']
              | null) ?? undefined,
          observedRequestCount: readNumber(networkSignalSummary.observedRequestCount),
          observedResponseCount: readNumber(networkSignalSummary.observedResponseCount),
        }
      : undefined,
    observedSignalDeltas: observedSignalDeltas
      ? {
          requestStartedDelta: readNumber(observedSignalDeltas.requestStartedDelta),
          failedRequestDelta: readNumber(observedSignalDeltas.failedRequestDelta),
          errorCountDelta: readNumber(observedSignalDeltas.errorCountDelta),
          warningCountDelta: readNumber(observedSignalDeltas.warningCountDelta),
        }
      : undefined,
  };
}
