import type { ReadPageMode, ReadPageRequestedLayer } from '@tabrix/shared';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function shouldIncludeVerboseReadPageContext(
  args: unknown,
  requestedLayer: ReadPageRequestedLayer,
): boolean {
  const input = readRecord(args);
  return requestedLayer === 'L0+L1+L2' || readReadPageMode(input?.mode) === 'full';
}

export function readReadPageMode(value: unknown): ReadPageMode {
  return value === 'normal' || value === 'full' || value === 'compact' ? value : 'compact';
}

export function buildReadPageRequestKey(
  args: unknown,
  requestedLayer: ReadPageRequestedLayer,
): string {
  const input = readRecord(args) ?? {};
  const mode = readReadPageMode(input.mode);
  const render = extractReadPageRenderMode(input) ?? 'json';
  const filter = typeof input.filter === 'string' ? input.filter : 'all';
  const depth =
    typeof input.depth === 'number' && Number.isFinite(input.depth) ? input.depth : null;
  const refId = typeof input.refId === 'string' ? input.refId : '';
  const includeAuthArtifacts = input.includeAuthArtifacts === true;
  const forceRefresh = input.forceRefresh === true;
  const assistantGuidance = normalizeReadPageAssistantGuidanceForCacheKey(input.assistantGuidance);
  return JSON.stringify({
    requestedLayer,
    mode,
    render,
    filter,
    depth,
    refId,
    includeAuthArtifacts,
    assistantGuidance,
    forceRefresh,
  });
}

function normalizeReadPageAssistantGuidanceForCacheKey(
  value: unknown,
): Record<string, unknown> | null {
  const input = readRecord(value);
  if (!input) return null;
  const output: Record<string, unknown> = {};
  if (
    typeof input.taskKind === 'string' &&
    ['auth', 'search', 'extract_content', 'unknown'].includes(input.taskKind)
  ) {
    output.taskKind = input.taskKind;
  }
  if (
    typeof input.authPreference === 'string' &&
    ['qr', 'otp', 'manual', 'auto'].includes(input.authPreference)
  ) {
    output.authPreference = input.authPreference;
  }
  if (Array.isArray(input.requestedObjects)) {
    const requestedObjects = input.requestedObjects
      .filter(
        (item): item is string =>
          typeof item === 'string' &&
          [
            'auth_surface',
            'qr_image',
            'phone_input',
            'otp_input',
            'search_input',
            'result_cards',
            'detail_metrics',
          ].includes(item),
      )
      .slice(0, 8);
    if (requestedObjects.length > 0) output.requestedObjects = [...new Set(requestedObjects)];
  }
  const target = readRecord(input.assistantProvidedTarget);
  if (target) {
    const assistantProvidedTarget: Record<string, unknown> = {};
    if (
      typeof target.purpose === 'string' &&
      ['auth_qr_image', 'click', 'fill', 'observe'].includes(target.purpose)
    ) {
      assistantProvidedTarget.purpose = target.purpose;
    }
    if (
      typeof target.targetRef === 'string' &&
      /^(?:ref|tgt)_[A-Za-z0-9:_-]{1,80}$/.test(target.targetRef)
    ) {
      assistantProvidedTarget.targetRef = target.targetRef;
    }
    if (typeof target.selector === 'string' && target.selector.trim().length > 0) {
      assistantProvidedTarget.selector = target.selector.trim().slice(0, 500);
    }
    if (
      typeof target.frameId === 'number' &&
      Number.isInteger(target.frameId) &&
      target.frameId >= 0
    ) {
      assistantProvidedTarget.frameId = target.frameId;
    }
    if (Object.keys(assistantProvidedTarget).length > 0) {
      output.assistantProvidedTarget = assistantProvidedTarget;
    }
  }
  return Object.keys(output).length > 0 ? output : null;
}

export function extractReadPageRenderMode(input: unknown): 'json' | 'markdown' | null {
  const record = readRecord(input);
  if (!record) return null;
  const render = record.render;
  return render === 'json' || render === 'markdown' ? render : null;
}
