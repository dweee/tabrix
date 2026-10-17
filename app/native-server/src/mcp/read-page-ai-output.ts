import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  buildReadPageBrowserPageObjectView,
  type BrowserSourceLineage,
  type BrowserPageThingProjection,
  type ReadPageBrowserPageObjectCompactView,
  type ReadPageObjectLifecycleSummary,
  type ReadPageOwnershipRuntimeSummary,
  type ReadPageSelectedDataSource,
  type SourceTruthOrigin,
} from '@tabrix/shared';

export function buildCachedReadPageObjectSummary(args: {
  warning: string;
  projection: BrowserPageThingProjection;
  ownershipRuntime: ReadPageOwnershipRuntimeSummary;
  selectedDataSource: ReadPageSelectedDataSource | null;
}): ReadPageBrowserPageObjectCompactView {
  const lifecycle: ReadPageObjectLifecycleSummary = {
    source: 'read_page_regions',
    status: 'single_snapshot',
    objectCount: 0,
    changedObjectCount: 0,
    items: [],
    changes: [],
    claimBoundary:
      'Cached read warning has no fresh page-region lifecycle objects; this summary is derived from cached projection plus current Window/Tab runtime fields.',
  };
  const view = buildReadPageBrowserPageObjectView({
    objectLifecycle: lifecycle,
    pageProjection: args.projection,
    ownershipRuntime: args.ownershipRuntime,
    selectedDataSource: args.selectedDataSource,
  });
  const compact = view.compact!;
  const degraded =
    args.ownershipRuntime.currentWindowState === 'minimized' ||
    args.ownershipRuntime.isCurrentWindowFocused === false ||
    args.ownershipRuntime.isCurrentTabActive === false;
  return {
    ...compact,
    watchStatus: degraded ? 'runtime_degraded' : 'stable_or_unknown',
    primaryConclusion: degraded
      ? `Cached page state reused for ${args.warning}; current runtime is visually degraded, so do not claim fresh visual/page proof.`
      : `Cached page state reused for ${args.warning}; Window/Tab runtime facts are attached, but page content was not freshly read.`,
    changedGroups: degraded
      ? ['window_state', 'tab_state', 'visual_reliability', 'evidence_state']
      : ['evidence_state'],
    transitionCount: degraded ? 4 : 1,
    evidenceSummary:
      'cached_read_warning: pageProjection is reused; Window/Tab facts come from the latest runtime fields; no fresh DOM/API/CDP read happened.',
    claimBoundary:
      'Cached pageObjectSummary is AI-facing runtime context only. It does not prove page content freshness, login/logout success, API/CDP reuse, or task completion.',
  };
}

function stripReadPageDiagnosticNoise(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (seen.has(object)) return;
  seen.add(object);

  delete object.claimBoundary;
  delete object.evidenceBoundary;
  delete object.evidenceSummary;

  for (const item of Object.values(object)) {
    if (Array.isArray(item)) {
      for (const child of item) stripReadPageDiagnosticNoise(child, seen);
    } else if (item && typeof item === 'object') {
      stripReadPageDiagnosticNoise(item, seen);
    }
  }
}

export function stripReadPageDiagnosticNoiseForOutput(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
  alignReadPageSourceFieldsForOutput(clone);
  stripReadPageDiagnosticNoise(clone);
  return clone;
}

function alignReadPageSourceFieldsForOutput(payload: Record<string, unknown>): void {
  const selectedDataSource =
    typeof payload.selectedDataSource === 'string'
      ? (payload.selectedDataSource as ReadPageSelectedDataSource)
      : null;
  if (!selectedDataSource) return;

  const origin = inferOutputSourceOrigin(selectedDataSource);
  const lineage = inferOutputSourceLineage(selectedDataSource);
  const projection = asRecord(payload.pageProjection);
  if (projection) {
    projection.chosenDataSource = selectedDataSource;
    if (lineage) {
      projection.sourceLineage = lineage;
    }
    const truthChain = asRecord(projection.sourceTruthChain);
    if (truthChain && origin) {
      truthChain.primaryOrigin = origin;
      truthChain.fieldProvenances = appendSourceFieldProvenance(
        truthChain.fieldProvenances,
        origin,
      );
    }
  }

  alignSelectedDataSourceObject(payload.sourceRouteHonesty, selectedDataSource, origin);
  alignSelectedDataSourceObject(payload.apiCdpProofBoundary, selectedDataSource, origin);
}

function alignSelectedDataSourceObject(
  value: unknown,
  selectedDataSource: ReadPageSelectedDataSource,
  origin: SourceTruthOrigin | null,
): void {
  const object = asRecord(value);
  if (!object) return;
  object.selectedDataSource = selectedDataSource;
  if (!origin) return;
  object.sourceOrigins = appendUniqueString(object.sourceOrigins, origin);
  object.factOrigins = appendUniqueString(object.factOrigins, origin);
  if (object.hasFactEvidence === false) {
    object.hasFactEvidence = true;
  }
}

function appendSourceFieldProvenance(value: unknown, origin: SourceTruthOrigin): unknown[] {
  const entries = Array.isArray(value) ? [...value] : [];
  const hasChosenDataSource = entries.some(
    (entry) =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>).field === 'pageProjection.chosenDataSource' &&
      (entry as Record<string, unknown>).origin === origin,
  );
  if (!hasChosenDataSource) {
    entries.push({
      field: 'pageProjection.chosenDataSource',
      origin,
      isFact: true,
    });
  }
  return entries;
}

function appendUniqueString(value: unknown, entry: string): string[] {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
  return values.includes(entry) ? values : [...values, entry];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function inferOutputSourceOrigin(
  selectedDataSource: ReadPageSelectedDataSource,
): SourceTruthOrigin | null {
  if (selectedDataSource === 'api_rows') return 'api';
  if (selectedDataSource === 'cdp_enhanced_api_rows') return 'cdp';
  if (selectedDataSource === 'markdown') return 'text';
  if (selectedDataSource === 'dom_json' || selectedDataSource === 'dom_region_rows') return 'dom';
  return null;
}

function inferOutputSourceLineage(
  selectedDataSource: ReadPageSelectedDataSource,
): BrowserSourceLineage | null {
  const origin = inferOutputSourceOrigin(selectedDataSource);
  if (origin === 'api' || origin === 'cdp' || origin === 'text' || origin === 'dom') {
    return origin;
  }
  return null;
}

export function stripReadPageDiagnosticNoiseFromJsonResult(result: CallToolResult): CallToolResult {
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

  delete payload.aiContextEnvelope;
  const responsePayload = stripReadPageDiagnosticNoiseForOutput(payload);
  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify(responsePayload) }
        : block,
    ) as CallToolResult['content'],
  };
}
