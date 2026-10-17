import {
  READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES,
  type ReadPageAssistantGuidance,
  type ReadPageWindowRuntimeState,
} from '@tabrix/shared';

export function normalizeAssistantGuidance(raw: unknown): ReadPageAssistantGuidance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const input = raw as Record<string, unknown>;
  const guidance: ReadPageAssistantGuidance = {
    claimBoundary:
      'assistant guidance is a closed-enum observation hint only; Tabrix remains eyes/hands and does not plan or prove task success',
  };
  if (
    typeof input.taskKind === 'string' &&
    (READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES as readonly string[]).includes(input.taskKind)
  ) {
    guidance.taskKind = input.taskKind as ReadPageAssistantGuidance['taskKind'];
  }
  if (
    typeof input.authPreference === 'string' &&
    (READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES as readonly string[]).includes(
      input.authPreference,
    )
  ) {
    guidance.authPreference = input.authPreference as ReadPageAssistantGuidance['authPreference'];
  }
  if (Array.isArray(input.requestedObjects)) {
    const requestedObjects = input.requestedObjects
      .filter(
        (value): value is NonNullable<ReadPageAssistantGuidance['requestedObjects']>[number] =>
          typeof value === 'string' &&
          (READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES as readonly string[]).includes(
            value,
          ),
      )
      .slice(0, 8);
    if (requestedObjects.length > 0) guidance.requestedObjects = [...new Set(requestedObjects)];
  }
  const target =
    input.assistantProvidedTarget &&
    typeof input.assistantProvidedTarget === 'object' &&
    !Array.isArray(input.assistantProvidedTarget)
      ? (input.assistantProvidedTarget as Record<string, unknown>)
      : null;
  if (target) {
    const purpose =
      typeof target.purpose === 'string' &&
      ['auth_qr_image', 'click', 'fill', 'observe'].includes(target.purpose)
        ? target.purpose
        : undefined;
    const targetRef =
      typeof target.targetRef === 'string' &&
      /^(?:ref|tgt)_[A-Za-z0-9:_-]{1,80}$/.test(target.targetRef)
        ? target.targetRef
        : undefined;
    const selector =
      typeof target.selector === 'string' && target.selector.trim().length > 0
        ? target.selector.trim().slice(0, 500)
        : undefined;
    const frameId =
      typeof target.frameId === 'number' && Number.isInteger(target.frameId) && target.frameId >= 0
        ? target.frameId
        : undefined;
    if (purpose || targetRef || selector || typeof frameId === 'number') {
      guidance.assistantProvidedTarget = {
        ...(purpose ? { purpose } : {}),
        ...(targetRef ? { targetRef } : {}),
        ...(selector ? { selector } : {}),
        ...(typeof frameId === 'number' ? { frameId } : {}),
      };
    }
  }
  return Object.keys(guidance).length > 1 ? guidance : undefined;
}

export function normalizeWindowRuntimeState(value: unknown): ReadPageWindowRuntimeState | null {
  if (
    value === 'normal' ||
    value === 'minimized' ||
    value === 'maximized' ||
    value === 'fullscreen' ||
    value === 'docked'
  ) {
    return value;
  }
  return typeof value === 'string' ? 'unknown' : null;
}

export function readWindowInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}
