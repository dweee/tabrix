import type {
  ReadPageCandidateAction,
  ReadPageHighValueObject,
  ReadPageInteractiveElement,
  ReadPageTaskMode,
} from '@tabrix/shared';
import type {
  CollectInputs,
  ObjectLayerContext,
  ObjectLayerFamilyAdapter,
  ScoredCandidateObject,
} from './read-page-high-value-objects-core';
import {
  classifyCandidateObject,
  collectCandidateObjects,
  scoreCandidateObject,
} from './read-page-high-value-objects-core';
import { annotateStableTargetRefs } from './stable-target-ref';
import type { VisibleRegionRowsResult } from './visible-region-rows';
import {
  LOW_BUSINESS_HREF_PATTERN,
  LOW_BUSINESS_SIGNAL_PATTERN,
} from './read-page-perception-neutral';

const COMPARE_HINT_PATTERN = /\b(compare|diff|review changes)\b/i;
const EXTRACT_HINT_PATTERN = /\b(export|download|copy|artifact|csv|json)\b/i;
const MONITOR_HINT_PATTERN = /\b(summary|jobs?|logs?|annotations?|workflow run|runs?)\b/i;
const SEARCH_HINT_PATTERN =
  /\b(search(?: issues?)?|filter(?: issues?)?|find|labels?|milestone|assignee|query|new issue|issue entries)\b/i;
const COMMIT_SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

const MAX_HIGH_VALUE_OBJECTS = 6;
const MAX_VISIBLE_TEXT_ROW_FACTS = 3;

type RankedTaskMode = Exclude<ReadPageTaskMode, 'read'>;

interface HighValuePipelineParams {
  currentUrl: string;
  currentTitle: string;
  pageRole: string;
  primaryRegion: string | null;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  visibleRegionRows?: VisibleRegionRowsResult;
}

interface TaskModeSignalContext {
  url: string;
  title: string;
  pageRole: string;
  primaryRegion: string;
  hasVisibleRegionRows: boolean;
  signalText: string[];
  highValueText: string[];
}

const OBJECT_LAYER_ADAPTERS: readonly ObjectLayerFamilyAdapter[] = [
  // No platform-specific layer adapters.
  // Object layer classification uses generic rules only.
];

// T5.4.0 intentionally scopes out generic task-mode inference. These role/region
// hints drive the taskMode (read/search/monitor/...) scoring, not the object
// layer priors, and remain GitHub-flavoured today. A later pass (expected in
// the T5.4+ task-mode cleanup) will lift them behind a family adapter; until
// then they stay here to avoid scope creep on the object-layer boundary work.
const PAGE_ROLE_TASK_MODE_HINTS: Partial<Record<string, ReadPageTaskMode>> = {
  repo_home: 'read',
  issues_list: 'search',
  actions_list: 'monitor',
  workflow_run_detail: 'monitor',
  workflow_run_shell: 'monitor',
  login_required: 'read',
};

const PRIMARY_REGION_TASK_MODE_HINTS: Partial<Record<string, ReadPageTaskMode>> = {
  repo_primary_nav: 'read',
  issues_results: 'search',
  workflow_runs_list: 'monitor',
  workflow_run_summary: 'monitor',
  workflow_run_shell: 'monitor',
  login_gate: 'read',
  login_form: 'read',
};

const TASK_MODE_SIGNAL_PATTERNS: Record<RankedTaskMode, RegExp[]> = {
  search: [SEARCH_HINT_PATTERN],
  monitor: [MONITOR_HINT_PATTERN],
  compare: [COMPARE_HINT_PATTERN],
  extract: [EXTRACT_HINT_PATTERN],
};

export function normalizeHighValueLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase();
}

export function buildHighValueObjects(
  params: HighValuePipelineParams,
  initialContext: ObjectLayerContext,
): { highValueObjects: ReadPageHighValueObject[]; taskMode: ReadPageTaskMode } {
  const inputs: CollectInputs = {
    interactiveElements: params.interactiveElements,
    candidateActions: params.candidateActions,
  };

  // Pass 1: score without a taskMode hint so we can infer taskMode from a
  // neutral baseline (taskMode alignment is a small +0.06 boost that cannot
  // dominate the ranking on its own).
  const preliminaryScored = runObjectPipeline(initialContext, inputs);
  const preliminaryObjects = rankScoredObjects(preliminaryScored)
    .slice(0, MAX_HIGH_VALUE_OBJECTS)
    .map((item) => toHighValueObject(item, params));

  const taskMode = inferTaskMode(params, preliminaryObjects);

  // Pass 2: rescore with the resolved taskMode so the objectType/taskMode
  // alignment boost applies correctly. Reuse `initialContext` inputs untouched.
  const finalContext: ObjectLayerContext = { ...initialContext, taskMode };
  const finalScored = runObjectPipeline(finalContext, inputs);
  const ranked = rankScoredObjects(finalScored)
    .slice(0, MAX_HIGH_VALUE_OBJECTS)
    .map((item) => toHighValueObject(item, params));
  const merged = mergeVisibleTextRowFacts(ranked, params);
  const clickableRanked = merged.filter((item) => item.kind !== 'visible_region_row');
  const readOnlyFacts = merged.filter((item) => item.kind === 'visible_region_row');

  // Annotate stable targetRefs after ranking + dedup so ordinals are
  // computed against the *final* HVO order (visible to upstream callers).
  // This must happen after `rankScoredObjects` and the slice cap so two
  // reads of the same page produce the same ordinals per identity tuple.
  const annotatedClickableObjects = annotateStableTargetRefs(clickableRanked, params.pageRole);
  const highValueObjects = merged.map((item) => {
    if (item.kind === 'visible_region_row') {
      return readOnlyFacts.shift() ?? item;
    }
    return annotatedClickableObjects.shift() ?? item;
  });

  return { highValueObjects, taskMode };
}

function isTaskModeNoiseLabel(label: string): boolean {
  const normalized = String(label || '').trim();
  if (!normalized) return true;
  if (COMMIT_SHA_PATTERN.test(normalized)) return true;
  if (/^\d+[smhd]$/i.test(normalized)) return true;
  if (/^commit\b/i.test(normalized)) return true;
  if (/^fix\(|^feat\(|^docs\(|^chore\(/i.test(normalized)) return true;
  if (/^search or jump to/i.test(normalized)) return true;
  if (/^open copilot/i.test(normalized)) return true;
  if (/^skip to content$/i.test(normalized)) return true;
  if (LOW_BUSINESS_SIGNAL_PATTERN.test(normalized)) return true;
  return false;
}

function isLowBusinessSignalObject(label: string, href?: string): boolean {
  const normalizedLabel = String(label || '').trim();
  const normalizedHref = String(href || '').trim();
  if (!normalizedLabel) return true;
  if (LOW_BUSINESS_SIGNAL_PATTERN.test(normalizedLabel)) return true;
  if (LOW_BUSINESS_HREF_PATTERN.test(normalizedHref)) return true;
  return false;
}

function getCandidateActionLabel(
  action: ReadPageCandidateAction,
  interactiveByRef: Map<string, ReadPageInteractiveElement>,
): string {
  const target = interactiveByRef.get(action.targetRef);
  const ariaLabel = action.locatorChain.find((item) => item.type === 'aria')?.value;
  return String(target?.name || ariaLabel || action.targetRef || action.id).trim();
}

function buildInteractiveMap(elements: ReadPageInteractiveElement[]) {
  const map = new Map<string, ReadPageInteractiveElement>();
  for (const element of elements) {
    if (!element?.ref) continue;
    map.set(element.ref, element);
  }
  return map;
}

function countPatternMatches(patterns: RegExp[], values: string[]): number {
  let matchCount = 0;
  for (const value of values) {
    if (!value) continue;
    if (patterns.some((pattern) => pattern.test(value))) {
      matchCount += 1;
    }
  }
  return matchCount;
}

function buildTaskModeSignalContext(
  params: HighValuePipelineParams,
  highValueObjects: ReadPageHighValueObject[],
): TaskModeSignalContext {
  const interactiveByRef = buildInteractiveMap(params.interactiveElements);
  const candidateLabels = params.candidateActions
    .map((item) => getCandidateActionLabel(item, interactiveByRef))
    .filter((item) => !isTaskModeNoiseLabel(item));
  const actionHints = params.candidateActions
    .map((item) => String(item?.matchReason || item?.actionType || '').trim())
    .filter(Boolean);
  const interactiveLabels = params.interactiveElements
    .map((item) => String(item?.name || '').trim())
    .filter((item) => !isTaskModeNoiseLabel(item));
  return {
    url: String(params.currentUrl || '').toLowerCase(),
    title: String(params.currentTitle || '').toLowerCase(),
    pageRole: String(params.pageRole || ''),
    primaryRegion: String(params.primaryRegion || ''),
    hasVisibleRegionRows: Boolean(params.visibleRegionRows?.visibleRegionRowsUsed),
    signalText: [...interactiveLabels, ...candidateLabels, ...actionHints].map((item) =>
      item.toLowerCase(),
    ),
    highValueText: highValueObjects
      .slice(0, 4)
      .map((item) =>
        String(item?.label || '')
          .trim()
          .toLowerCase(),
      )
      .filter((item) => !isTaskModeNoiseLabel(item)),
  };
}

function scoreTaskMode(mode: RankedTaskMode, context: TaskModeSignalContext): number {
  let score = 0;
  const hasRoleOrRegionHint =
    PAGE_ROLE_TASK_MODE_HINTS[context.pageRole] === mode ||
    PRIMARY_REGION_TASK_MODE_HINTS[context.primaryRegion] === mode;
  if (PAGE_ROLE_TASK_MODE_HINTS[context.pageRole] === mode) {
    score += 6;
  }
  if (PRIMARY_REGION_TASK_MODE_HINTS[context.primaryRegion] === mode) {
    score += 5;
  }

  const patterns = TASK_MODE_SIGNAL_PATTERNS[mode];
  const titleMatchCount = countPatternMatches(patterns, [context.title]);
  score += titleMatchCount * (mode === 'search' && !context.hasVisibleRegionRows ? 1 : 3);
  score += countPatternMatches(patterns, context.signalText) * 2;
  score += countPatternMatches(patterns, context.highValueText) * 3;

  if (mode === 'search' && context.hasVisibleRegionRows && titleMatchCount > 0) {
    score += 3;
  }
  if (mode === 'search' && /\/issues(?:\/?|$)/i.test(context.url)) {
    score += 4;
  }
  if (mode === 'monitor' && /\/actions(?:\/?|$)/i.test(context.url)) {
    score += 4;
  }
  if (mode === 'compare' && COMPARE_HINT_PATTERN.test(context.url)) {
    score += 4;
  }
  if (mode === 'extract' && EXTRACT_HINT_PATTERN.test(context.url)) {
    score += 4;
  }

  if (
    mode === 'search' &&
    !context.hasVisibleRegionRows &&
    !hasRoleOrRegionHint &&
    !/\/issues(?:\/?|$)/i.test(context.url)
  ) {
    return Math.min(score, 4);
  }
  return score;
}

function scoreReadTaskMode(context: TaskModeSignalContext): number {
  let score = 0;
  if (PAGE_ROLE_TASK_MODE_HINTS[context.pageRole] === 'read') {
    score += 6;
  }
  if (PRIMARY_REGION_TASK_MODE_HINTS[context.primaryRegion] === 'read') {
    score += 5;
  }
  return score;
}

function inferTaskMode(
  params: HighValuePipelineParams,
  highValueObjects: ReadPageHighValueObject[],
): ReadPageTaskMode {
  const context = buildTaskModeSignalContext(params, highValueObjects);
  const readScore = scoreReadTaskMode(context);
  const rankedModes: RankedTaskMode[] = ['monitor', 'search', 'extract', 'compare'];
  const ranked = rankedModes
    .map((mode) => ({ mode, score: scoreTaskMode(mode, context) }))
    .sort((left, right) => right.score - left.score);

  if (ranked[0]?.score >= 5 && ranked[0].score > readScore) {
    return ranked[0].mode;
  }

  if (readScore > 0) {
    return 'read';
  }
  return 'read';
}

function originPriority(origin: ScoredCandidateObject['origin']): number {
  switch (origin) {
    case 'page_role_seed':
      return 3;
    case 'candidate_action':
      return 2;
    case 'interactive_element':
      return 1;
    default:
      return 0;
  }
}

function originToKind(origin: ScoredCandidateObject['origin']): ReadPageHighValueObject['kind'] {
  return origin;
}

function buildReason(scored: ScoredCandidateObject, params: HighValuePipelineParams): string {
  if (scored.matchReason) return scored.matchReason;
  if (scored.origin === 'interactive_element') {
    const role = scored.role || 'element';
    return params.primaryRegion
      ? `high-value ${role} surfaced from ${params.primaryRegion}`
      : `high-value ${role} surfaced from compact snapshot`;
  }
  return scored.classificationReasons[0] || 'scored high-value object';
}

function toHighValueObject(
  scored: ScoredCandidateObject,
  params: HighValuePipelineParams,
): ReadPageHighValueObject {
  const confidence = Number.isFinite(scored.confidence)
    ? Number(scored.confidence.toFixed(3))
    : undefined;
  const importance = Number.isFinite(scored.importance)
    ? Number(scored.importance.toFixed(3))
    : undefined;
  const combinedReasons = [...scored.classificationReasons, ...scored.scoringReasons];

  const out: ReadPageHighValueObject = {
    id: scored.id,
    kind: originToKind(scored.origin),
    label: scored.label,
    reason: buildReason(scored, params),
  };
  if (scored.ref) out.ref = scored.ref;
  if (scored.role) out.role = scored.role;
  if (scored.actionType) out.actionType = scored.actionType;
  if (typeof confidence === 'number') out.confidence = confidence;
  if (scored.objectType) out.objectType = scored.objectType;
  if (scored.objectSubType) out.objectSubType = scored.objectSubType;
  if (scored.region !== undefined) out.region = scored.region;
  if (typeof importance === 'number') out.importance = importance;
  if (combinedReasons.length > 0) out.reasons = combinedReasons;
  if (scored.actions && scored.actions.length > 0) out.actions = scored.actions;
  if (scored.sourceKind) out.sourceKind = scored.sourceKind;
  if (scored.href) out.href = scored.href;
  return out;
}

function buildVisibleTextRowFacts(params: HighValuePipelineParams): ReadPageHighValueObject[] {
  const rows = params.visibleRegionRows;
  if (!rows?.visibleRegionRowsUsed || !Array.isArray(rows.rows) || rows.rows.length === 0) {
    return [];
  }

  const facts: ReadPageHighValueObject[] = [];
  const seenLabels = new Set<string>();
  for (const row of rows.rows) {
    if (facts.length >= MAX_VISIBLE_TEXT_ROW_FACTS) break;
    if (row.sourceRegion !== 'visible_text' || row.targetRef) continue;
    const label = String(row.title || row.primaryText || '').trim();
    const normalized = normalizeHighValueLabel(label);
    if (!normalized || seenLabels.has(normalized) || isLowBusinessSignalObject(label)) {
      continue;
    }
    seenLabels.add(normalized);
    const confidence = Number.isFinite(row.confidence)
      ? Number(row.confidence.toFixed(3))
      : undefined;
    const reasons = Array.from(
      new Set(['visible_text_fallback', 'read_fact', ...row.qualityReasons]),
    );
    const fact: ReadPageHighValueObject = {
      id: `hvo_visible_region_row_${facts.length + 1}`,
      kind: 'visible_region_row',
      label,
      reason: 'visible text fallback row surfaced as a read fact',
      objectType: 'record',
      region: row.sourceRegion,
      importance: 0.9,
      sourceKind: 'dom_semantic',
      reasons,
    };
    if (typeof confidence === 'number') fact.confidence = confidence;
    facts.push(fact);
  }
  return facts;
}

function mergeVisibleTextRowFacts(
  rankedObjects: ReadPageHighValueObject[],
  params: HighValuePipelineParams,
): ReadPageHighValueObject[] {
  const rowFacts = buildVisibleTextRowFacts(params);
  if (rowFacts.length === 0) return rankedObjects;

  const seenLabels = new Set(rowFacts.map((item) => normalizeHighValueLabel(item.label)));
  const remaining = rankedObjects.filter((item) => {
    const normalized = normalizeHighValueLabel(item.label);
    return normalized && !seenLabels.has(normalized);
  });
  return [...rowFacts, ...remaining].slice(0, MAX_HIGH_VALUE_OBJECTS);
}

function runObjectPipeline(
  context: ObjectLayerContext,
  inputs: CollectInputs,
): ScoredCandidateObject[] {
  const candidates = collectCandidateObjects(context, inputs, OBJECT_LAYER_ADAPTERS);
  const scored: ScoredCandidateObject[] = [];
  for (const candidate of candidates) {
    const classified = classifyCandidateObject(candidate, context, OBJECT_LAYER_ADAPTERS);
    scored.push(scoreCandidateObject(classified, context, OBJECT_LAYER_ADAPTERS));
  }
  return scored;
}

function rankScoredObjects(scored: readonly ScoredCandidateObject[]): ScoredCandidateObject[] {
  const indexed = scored.map((item, index) => ({ item, index }));
  indexed.sort((left, right) => {
    if (right.item.importance !== left.item.importance) {
      return right.item.importance - left.item.importance;
    }
    if (right.item.confidence !== left.item.confidence) {
      return right.item.confidence - left.item.confidence;
    }
    const originDelta = originPriority(right.item.origin) - originPriority(left.item.origin);
    if (originDelta !== 0) return originDelta;
    return left.index - right.index;
  });

  const seenLabels = new Set<string>();
  const deduped: ScoredCandidateObject[] = [];
  for (const { item } of indexed) {
    if (isLowBusinessSignalObject(item.label, item.href)) continue;
    const normalized = normalizeHighValueLabel(item.label);
    if (!normalized) continue;
    if (seenLabels.has(normalized)) continue;
    seenLabels.add(normalized);
    deduped.push(item);
  }
  return deduped;
}
