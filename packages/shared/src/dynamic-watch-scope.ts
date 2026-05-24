export const WATCH_SCOPE_KINDS = [
  'search',
  'form',
  'long_content',
  'loading',
  'idle',
  'unknown',
] as const;

export type WatchScopeKind = (typeof WATCH_SCOPE_KINDS)[number];

export type WatchScopeRegionPurpose = 'input' | 'output' | 'feedback' | 'navigation' | 'unknown';

export interface WatchScopeRegion {
  regionId: string;
  regionPurpose: WatchScopeRegionPurpose;
  expectedRole: string | null;
}

export interface DynamicWatchScopeEvidenceBasis {
  intentUsed: boolean;
  pageRoleUsed: boolean;
  pageStabilityUsed: boolean;
  eventWindowCountsUsed: boolean;
  urlUsed: false;
  ownershipTruthClaimed: false;
  taskIsolationClaimed: false;
  sourceRouteClaimed: false;
  realBrowserAcceptanceClaimed: false;
}

export interface DynamicWatchScope {
  scopeKind: WatchScopeKind;
  tabId: number | null;
  regions: WatchScopeRegion[];
  confidence: number;
  reason: string;
  evidenceBasis: DynamicWatchScopeEvidenceBasis;
  boundary: {
    deterministicGuidanceOnly: true;
    taskScopeProven: false;
    browserHygieneProven: false;
    realBrowserProven: false;
    commercialGradeProven: false;
  };
  producedAtMs: number;
}

export interface DeriveDynamicWatchScopeInput {
  tabId: number | null;
  intent: string | null;
  pageRole: string | null;
  pageStability: 'stable' | 'loading' | 'changing' | 'stale' | 'unknown';
  evidenceWindow: {
    startedAtMs: number;
    endedAtMs: number;
    eventsByKind: Record<string, number>;
  } | null;
  nowMs: number;
}

const REGIONS_BY_SCOPE_KIND: Record<WatchScopeKind, WatchScopeRegion[]> = {
  search: [
    { regionId: 'query_input', regionPurpose: 'input', expectedRole: 'searchbox' },
    { regionId: 'result_region', regionPurpose: 'output', expectedRole: null },
    { regionId: 'empty_state', regionPurpose: 'feedback', expectedRole: null },
  ],
  form: [
    { regionId: 'primary_input', regionPurpose: 'input', expectedRole: 'textbox' },
    { regionId: 'submit_control', regionPurpose: 'input', expectedRole: 'button' },
    { regionId: 'feedback_region', regionPurpose: 'feedback', expectedRole: 'status' },
  ],
  long_content: [
    { regionId: 'content_body', regionPurpose: 'output', expectedRole: null },
    { regionId: 'scroll_region', regionPurpose: 'navigation', expectedRole: null },
    { regionId: 'coverage_marker', regionPurpose: 'navigation', expectedRole: null },
  ],
  loading: [
    { regionId: 'loading_indicator', regionPurpose: 'feedback', expectedRole: 'progressbar' },
  ],
  idle: [],
  unknown: [],
};

const LONG_CONTENT_TERMS = ['article', 'documentation', 'doc', 'read', 'content'];
const SEARCH_TERMS = ['search', 'find', 'query', 'result'];
const FORM_TERMS = ['form', 'login', 'submit', 'input'];

export function deriveDynamicWatchScope(input: DeriveDynamicWatchScopeInput): DynamicWatchScope {
  const text = `${input.intent ?? ''} ${input.pageRole ?? ''}`.toLowerCase();
  const eventCount = countEvents(input.evidenceWindow?.eventsByKind ?? {});
  const scopeKind = deriveScopeKind(input.pageStability, text, eventCount);

  return {
    scopeKind,
    tabId: input.tabId,
    regions: REGIONS_BY_SCOPE_KIND[scopeKind].map((region) => ({ ...region })),
    confidence: confidenceFor(scopeKind),
    reason: reasonFor(scopeKind),
    evidenceBasis: {
      intentUsed: Boolean(input.intent?.trim()),
      pageRoleUsed: Boolean(input.pageRole?.trim()),
      pageStabilityUsed: true,
      eventWindowCountsUsed: input.evidenceWindow !== null,
      urlUsed: false,
      ownershipTruthClaimed: false,
      taskIsolationClaimed: false,
      sourceRouteClaimed: false,
      realBrowserAcceptanceClaimed: false,
    },
    boundary: {
      deterministicGuidanceOnly: true,
      taskScopeProven: false,
      browserHygieneProven: false,
      realBrowserProven: false,
      commercialGradeProven: false,
    },
    producedAtMs: input.nowMs,
  };
}

function deriveScopeKind(
  pageStability: DeriveDynamicWatchScopeInput['pageStability'],
  text: string,
  eventCount: number,
): WatchScopeKind {
  if (pageStability === 'loading' || pageStability === 'changing') return 'loading';
  if (matchesAny(text, LONG_CONTENT_TERMS)) return 'long_content';
  if (matchesAny(text, SEARCH_TERMS)) return 'search';
  if (matchesAny(text, FORM_TERMS)) return 'form';
  return eventCount > 0 ? 'unknown' : 'idle';
}

function matchesAny(text: string, terms: readonly string[]): boolean {
  const tokens = text.split(/[^a-z0-9]+/i).filter(Boolean);
  return terms.some((term) => tokens.includes(term));
}

function countEvents(eventsByKind: Record<string, number>): number {
  return Object.values(eventsByKind).reduce(
    (sum, value) => (Number.isFinite(value) && value > 0 ? sum + value : sum),
    0,
  );
}

function confidenceFor(scopeKind: WatchScopeKind): number {
  if (scopeKind === 'idle') return 0.8;
  if (scopeKind === 'unknown') return 0.25;
  return 0.7;
}

function reasonFor(scopeKind: WatchScopeKind): string {
  switch (scopeKind) {
    case 'loading':
      return 'page_stability_requires_wait';
    case 'long_content':
      return 'generic_long_content_category_match';
    case 'search':
      return 'generic_search_category_match';
    case 'form':
      return 'generic_form_category_match';
    case 'idle':
      return 'no_relevant_activity';
    case 'unknown':
      return 'activity_without_safe_scope_class';
  }
}
