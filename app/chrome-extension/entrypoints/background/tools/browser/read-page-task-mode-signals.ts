import type {
  ReadPageCandidateAction,
  ReadPageHighValueObject,
  ReadPageInteractiveElement,
  ReadPageTaskMode,
} from '@tabrix/shared';
import type { VisibleRegionRowsResult } from './visible-region-rows';
import { LOW_BUSINESS_SIGNAL_PATTERN } from './read-page-perception-neutral';

const COMPARE_HINT_PATTERN = /\b(compare|diff|review changes)\b/i;
const EXTRACT_HINT_PATTERN = /\b(export|download|copy|artifact|csv|json)\b/i;
const MONITOR_HINT_PATTERN = /\b(summary|jobs?|logs?|annotations?|workflow run|runs?)\b/i;
const SEARCH_HINT_PATTERN =
  /\b(search(?: issues?)?|filter(?: issues?)?|find|labels?|milestone|assignee|query|new issue|issue entries)\b/i;
const COMMIT_SHA_PATTERN = /\b[0-9a-f]{7,40}\b/i;

type RankedTaskMode = Exclude<ReadPageTaskMode, 'read'>;

export interface TaskModeInferenceParams {
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
  hostname: string;
  pageRole: string;
  primaryRegion: string;
  hasVisibleRegionRows: boolean;
  signalText: string[];
  highValueText: string[];
}

interface RouteTaskModeHint {
  hostPattern: RegExp;
  pathPattern: RegExp;
  taskMode: RankedTaskMode;
  score: number;
}

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

const ROUTE_TASK_MODE_HINTS: readonly RouteTaskModeHint[] = [
  {
    hostPattern: /(^|\.)github\.com$/i,
    pathPattern: /\/[^/]+\/[^/]+\/issues(?:\/?|$)/i,
    taskMode: 'search',
    score: 4,
  },
  {
    hostPattern: /(^|\.)github\.com$/i,
    pathPattern: /\/[^/]+\/[^/]+\/actions(?:\/?|$)/i,
    taskMode: 'monitor',
    score: 4,
  },
];

function normalizeTaskLabel(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase();
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getPathname(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return String(url || '').toLowerCase();
  }
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
  params: TaskModeInferenceParams,
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
    hostname: getHostname(params.currentUrl),
    pageRole: String(params.pageRole || ''),
    primaryRegion: String(params.primaryRegion || ''),
    hasVisibleRegionRows: Boolean(params.visibleRegionRows?.visibleRegionRowsUsed),
    signalText: [...interactiveLabels, ...candidateLabels, ...actionHints].map((item) =>
      item.toLowerCase(),
    ),
    highValueText: highValueObjects
      .slice(0, 4)
      .map((item) => normalizeTaskLabel(item?.label || ''))
      .filter((item) => !isTaskModeNoiseLabel(item)),
  };
}

function routeHintScore(mode: RankedTaskMode, context: TaskModeSignalContext): number {
  const path = getPathname(context.url);
  return ROUTE_TASK_MODE_HINTS.filter(
    (hint) =>
      hint.taskMode === mode &&
      hint.hostPattern.test(context.hostname) &&
      hint.pathPattern.test(path),
  ).reduce((sum, hint) => sum + hint.score, 0);
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
  score += routeHintScore(mode, context);
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
    routeHintScore(mode, context) === 0
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

export function inferReadPageTaskMode(
  params: TaskModeInferenceParams,
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

  return 'read';
}
