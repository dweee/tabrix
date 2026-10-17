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
import { inferReadPageTaskMode } from './read-page-task-mode-signals';

const COMMIT_SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;
const NAVIGATION_SHELL_OBJECT_PATTERN =
  /^(menu action candidate|account action candidate|red|home|首页|直播|消息|发布|更多|关于我们|营业执照)$/i;

const MAX_HIGH_VALUE_OBJECTS = 6;
const MAX_VISIBLE_TEXT_ROW_FACTS = 3;
const MAX_CONTENT_DETAIL_READ_FACTS = 3;

interface HighValuePipelineParams {
  currentUrl: string;
  currentTitle: string;
  pageRole: string;
  primaryRegion: string | null;
  interactiveElements: ReadPageInteractiveElement[];
  candidateActions: ReadPageCandidateAction[];
  visibleRegionRows?: VisibleRegionRowsResult;
}

const OBJECT_LAYER_ADAPTERS: readonly ObjectLayerFamilyAdapter[] = [
  // No platform-specific layer adapters.
  // Object layer classification uses generic rules only.
];

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

  const taskMode = inferReadPageTaskMode(params, preliminaryObjects);

  // Pass 2: rescore with the resolved taskMode so the objectType/taskMode
  // alignment boost applies correctly. Reuse `initialContext` inputs untouched.
  const finalContext: ObjectLayerContext = { ...initialContext, taskMode };
  const finalScored = runObjectPipeline(finalContext, inputs);
  const ranked = rankScoredObjects(finalScored)
    .slice(0, MAX_HIGH_VALUE_OBJECTS)
    .map((item) => toHighValueObject(item, params));
  const merged = mergeContentDetailReadFacts(mergeVisibleTextRowFacts(ranked, params), params);
  const clickableRanked = merged.filter((item) => !isReadOnlyHighValueFact(item));
  const readOnlyFacts = merged.filter((item) => isReadOnlyHighValueFact(item));

  // Annotate stable targetRefs after ranking + dedup so ordinals are
  // computed against the *final* HVO order (visible to upstream callers).
  // This must happen after `rankScoredObjects` and the slice cap so two
  // reads of the same page produce the same ordinals per identity tuple.
  const annotatedClickableObjects = annotateStableTargetRefs(clickableRanked, params.pageRole);
  const highValueObjects = merged.map((item) => {
    if (isReadOnlyHighValueFact(item)) {
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
  if (NAVIGATION_SHELL_OBJECT_PATTERN.test(normalizedLabel)) return true;
  if (LOW_BUSINESS_SIGNAL_PATTERN.test(normalizedLabel)) return true;
  if (LOW_BUSINESS_HREF_PATTERN.test(normalizedHref)) return true;
  return false;
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
    const label = String(row.title || row.primaryText || '').trim();
    const normalized = normalizeHighValueLabel(label);
    if (!normalized || seenLabels.has(normalized) || isLowBusinessSignalObject(label)) {
      continue;
    }
    seenLabels.add(normalized);
    const confidence = Number.isFinite(row.confidence)
      ? Number(row.confidence.toFixed(3))
      : undefined;
    const targetRef = String(row.targetRef || '').trim();
    const reasons = Array.from(
      new Set([
        row.sourceRegion === 'visible_text' ? 'visible_text_fallback' : 'visible_region_row',
        'read_fact',
        ...(targetRef ? ['target_ref_available'] : []),
        ...row.qualityReasons,
      ]),
    );
    const fact: ReadPageHighValueObject = {
      id: `hvo_visible_region_row_${facts.length + 1}`,
      kind: 'visible_region_row',
      label,
      reason: targetRef
        ? 'visible region result row surfaced as a readable and targetable content object'
        : 'visible text fallback row surfaced as a read fact',
      objectType: 'record',
      region: row.sourceRegion,
      importance: 0.9,
      sourceKind: 'dom_semantic',
      reasons,
    };
    if (typeof confidence === 'number') fact.confidence = confidence;
    if (targetRef) {
      fact.ref = targetRef;
      fact.actionType = 'click';
      fact.actions = [{ type: 'open_detail', ref: targetRef, actionType: 'click' }];
    }
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

function isReadOnlyHighValueFact(item: ReadPageHighValueObject): boolean {
  return item.kind === 'visible_region_row' || item.kind === 'page_role_seed';
}

function buildContentDetailReadFacts(params: HighValuePipelineParams): ReadPageHighValueObject[] {
  if (params.pageRole !== 'content_detail') return [];
  const region = params.primaryRegion || 'content_detail';
  const facts: ReadPageHighValueObject[] = [
    {
      id: 'hvo_content_detail_seed_body',
      kind: 'page_role_seed',
      label: 'Content detail body',
      reason: 'page role seed for readable content detail body',
      objectType: 'doc_block',
      region,
      importance: 0.96,
      confidence: 0.78,
      sourceKind: 'dom_semantic',
      reasons: ['page_role=content_detail', 'read_fact', 'non_actionable_seed'],
    },
    {
      id: 'hvo_content_detail_seed_author',
      kind: 'page_role_seed',
      label: 'Author or account area',
      reason: 'page role seed for author/account context on a content detail page',
      objectType: 'entry',
      region: 'account',
      importance: 0.9,
      confidence: 0.66,
      sourceKind: 'dom_semantic',
      reasons: ['page_role=content_detail', 'account_context_candidate', 'non_actionable_seed'],
    },
    {
      id: 'hvo_content_detail_seed_feedback',
      kind: 'page_role_seed',
      label: 'Status or comments area',
      reason: 'page role seed for status/comments context on a content detail page',
      objectType: 'status_item',
      region: 'feedback',
      importance: 0.88,
      confidence: 0.64,
      sourceKind: 'dom_semantic',
      reasons: ['page_role=content_detail', 'feedback_context_candidate', 'non_actionable_seed'],
    },
  ];
  return facts.slice(0, MAX_CONTENT_DETAIL_READ_FACTS);
}

function mergeContentDetailReadFacts(
  rankedObjects: ReadPageHighValueObject[],
  params: HighValuePipelineParams,
): ReadPageHighValueObject[] {
  const readFacts = buildContentDetailReadFacts(params);
  if (readFacts.length === 0) return rankedObjects;

  const seenIds = new Set(readFacts.map((item) => item.id));
  const seenLabels = new Set(readFacts.map((item) => normalizeHighValueLabel(item.label)));
  const remaining = rankedObjects.filter((item) => {
    if (seenIds.has(item.id)) return false;
    const normalized = normalizeHighValueLabel(item.label);
    return normalized && !seenLabels.has(normalized);
  });
  return [...readFacts, ...remaining].slice(0, MAX_HIGH_VALUE_OBJECTS);
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
