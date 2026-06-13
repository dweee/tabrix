/**
 * `tabrix_choose_context` pure input/output helpers.
 *
 * Mirrors the contract in `docs/B_018_CONTEXT_SELECTOR_V1.md`. Stays
 * deliberately small:
 *
 *  - `parseTabrixChooseContextInput` validates raw MCP args.
 *  - `chooseContextStrategy` is a pure function over already-resolved
 *    facts (`knowledgeCatalog`, `pageRole`, `siteFamily`).
 *  - `runTabrixChooseContext` is the IO orchestrator, kept tiny so it
 *    is easy to wire from `native-tool-handlers.ts` without crowding
 *    the dispatcher with chooser logic.
 *
 * Side-effect surface: the only IO this module does is the optional
 * telemetry write-back through `ChooseContextTelemetryRepository`. The
 * chooser still never calls the bridge and never reads `process.env`
 * directly; tests inject the telemetry repo plus every other dependency
 * via `chooseContextStrategy` or the runner's `deps` argument.
 *
 * `runTabrixChooseContextRecordOutcome` is the matching write-back
 * runner used by `tabrix_choose_context_record_outcome`. It validates
 * input, looks up the decision row, appends one outcome row, and
 * returns `unknown_decision` when the id is well-formed but missing.
 */

import { randomUUID } from 'node:crypto';
import {
  KNOWLEDGE_LIGHT_SAMPLE_LIMIT,
  MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS,
  MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS,
  type ContextStrategyName,
  type TabrixChooseContextArtifact,
  type TabrixChooseContextInput,
  type TabrixChooseContextOutcome,
  type TabrixChooseContextRecordOutcomeResult,
  type TabrixChooseContextResult,
  type TabrixContextSiteFamily,
  type TabrixObserveMode,
  type TabrixObserveReason,
  normalizeTabrixSiteId,
} from '@tabrix/shared';
import { normalizeIntentSignature } from '../memory/experience/experience-signature';
import type { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import type { ChooseContextTelemetryRepository } from '../memory/telemetry/choose-context-telemetry';
import {
  dispatchLayer,
  type LayerDispatchTaskType,
  type LayerDispatchUserIntentHint,
} from './choose-context-layer-dispatch';
import type { PageContextProvider } from './page-context-provider';
import { resolveApiKnowledgeCandidate } from '../api/api-knowledge';
import { logger } from '../logging/logger';
import type { ApiKnowledgeFetch } from '../api/api-knowledge';
import {
  routeDataSource,
  type DataSourceCostEstimate,
  type DataSourceFallbackPlan,
  type DataSourceKind,
  type RouterDomRegionRowsEvidence,
  type DataSourceRiskTier,
  type TaskIntentClass,
} from '../execution/data-source-router';
import { tryDirectApiExecute, type DirectApiIntentClass } from '../execution/direct-api-executor';
import type { ExperienceRecipe } from '../memory/db';
import type { DataNeed, EndpointKnowledgeReader } from '../api-knowledge/types';

const chooseContextLogger = logger.child('choose-context');

export interface TabrixChooseContextRouterTelemetry {
  chosenSource?: DataSourceKind;
  dataSource?: DataSourceKind;
  routerConfidence?: number;
  routerRiskTier?: DataSourceRiskTier;
  decisionReason?: string;
  fallbackPlan?: DataSourceFallbackPlan;
  dispatcherInputSource?: string;
  costEstimate?: DataSourceCostEstimate;
}

type TabrixChooseContextResultWithRouter = TabrixChooseContextResult &
  TabrixChooseContextRouterTelemetry;

export class TabrixChooseContextInputError extends Error {
  public readonly code: 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT';
  constructor(message: string) {
    super(message);
    this.code = 'TABRIX_CHOOSE_CONTEXT_BAD_INPUT';
    this.name = 'TabrixChooseContextInputError';
  }
}

function readString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new TabrixChooseContextInputError(`'${key}' must be a string`);
  }
  return value;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Internal: return the parsed value plus the resolved
 * `intentSignature`. Kept as a private struct because the upstream
 * MCP contract returns the signature in `resolved.*`, not at the top
 * level.
 */
export interface ParsedChooseContextInput {
  input: TabrixChooseContextInput;
  intentSignature: string;
}

/**
 * Validate raw MCP arguments. v1 deliberately silently drops:
 *   - unparseable `url` (treated as omitted),
 *   - unsafe `siteId` tokens (treated as omitted),
 *   - empty-after-trim `pageRole` (treated as omitted).
 *
 * It does NOT silently drop bad `intent`: empty / non-string intent is
 * still a typed input error, because every other behaviour is built on
 * top of the normalized signature.
 */
export function parseTabrixChooseContextInput(rawArgs: unknown): ParsedChooseContextInput {
  if (rawArgs === null || rawArgs === undefined) {
    throw new TabrixChooseContextInputError('missing arguments object');
  }
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new TabrixChooseContextInputError('arguments must be an object');
  }
  const args = rawArgs as Record<string, unknown>;

  const rawIntent = readString(args, 'intent');
  if (rawIntent === undefined) {
    throw new TabrixChooseContextInputError("'intent' is required");
  }
  const trimmedIntent = rawIntent.trim();
  if (trimmedIntent.length === 0) {
    throw new TabrixChooseContextInputError("'intent' must be a non-empty string");
  }
  const cappedIntent = trimmedIntent.slice(0, MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS);
  const intentSignature = normalizeIntentSignature(cappedIntent);
  if (intentSignature.length === 0) {
    throw new TabrixChooseContextInputError("'intent' normalized to an empty signature");
  }

  let url: string | undefined;
  const rawUrl = readString(args, 'url');
  if (rawUrl !== undefined) {
    const trimmedUrl = rawUrl.trim();
    if (trimmedUrl.length > 0) {
      url = trimmedUrl;
    }
  }

  let pageRole: string | undefined;
  const rawPageRole = readString(args, 'pageRole');
  if (rawPageRole !== undefined) {
    const trimmedRole = rawPageRole.trim();
    if (trimmedRole.length > MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS) {
      throw new TabrixChooseContextInputError(
        `'pageRole' exceeds ${MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS} chars`,
      );
    }
    if (trimmedRole.length > 0) {
      pageRole = trimmedRole;
    }
  }

  let siteId: TabrixContextSiteFamily | undefined;
  const rawSiteId = readString(args, 'siteId');
  if (rawSiteId !== undefined) {
    siteId = normalizeTabrixSiteId(rawSiteId);
  }

  return {
    input: {
      intent: cappedIntent,
      url,
      pageRole,
      siteId,
    },
    intentSignature,
  };
}

function buildDataNeedParams(
  intent: string,
): Readonly<Record<string, string | number | null | undefined>> | undefined {
  const limit = deriveRequestedRowLimit(intent);
  return limit === undefined ? undefined : { limit };
}

function deriveRequestedRowLimit(intent: string): number | undefined {
  const text = String(intent || '')
    .trim()
    .toLowerCase();
  if (!text) return undefined;

  if (
    /最近一次|最新一次|最近一条|最新一条/.test(text) ||
    /\b(latest|last|newest)\b/.test(text) ||
    /\bmost\s+recent\b/.test(text)
  ) {
    return 1;
  }

  const explicit =
    /前\s*(\d{1,2})\s*[个条项]?/.exec(text) ??
    /(?:列出|返回|读取|取)\s*(\d{1,2})\s*[个条项]?/.exec(text) ??
    /最近\s*(\d{1,2})\s*(?:次|条|个|项)/.exec(text) ??
    /\btop\s*(\d{1,2})\b/.exec(text) ??
    /\bfirst\s*(\d{1,2})\b/.exec(text);
  if (!explicit) return undefined;

  const value = Number.parseInt(explicit[1] ?? '', 10);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(1, Math.min(10, value));
}

function buildExperienceCatalog(recipe: ExperienceRecipe): {
  experienceId: string;
  summary: string;
} {
  const successCheck = readObject(recipe.successCheck);
  const collectChecks = successCheck?.collectResultCards;
  const firstCollectCheck = Array.isArray(collectChecks) ? readObject(collectChecks[0]) : null;
  const filters = readObject(firstCollectCheck?.filterState);
  const filterParts = [
    typeof filters?.sort === 'string' ? filters.sort : null,
    typeof filters?.contentType === 'string' ? filters.contentType : null,
    typeof filters?.timeRange === 'string' ? filters.timeRange : null,
  ].filter((value): value is string => Boolean(value));
  const minCount =
    typeof firstCollectCheck?.observedResultCountAtLeast === 'number'
      ? firstCollectCheck.observedResultCountAtLeast
      : null;
  const filterSummary = filterParts.length > 0 ? ` filters=${filterParts.join('/')}` : '';
  const countSummary = minCount ? ` top>=${minCount}` : '';
  return {
    experienceId: recipe.experienceId,
    summary:
      `Verified ${recipe.taskSignature}${filterSummary}${countSummary}; ` +
      `success=${recipe.successCount}, reliability=${recipe.reliabilityScore ?? 'unknown'}`,
  };
}

/**
 * Derive a `siteFamily` from an explicit safe `siteId` (highest
 * precedence) or, failing that, from the URL host. Non-GitHub hosts are
 * represented by their normalized host token and still fail closed unless
 * a matching Knowledge policy exists.
 *
 * GitHub GA adapter compatibility:
 *   - exact host `github.com` → `'github'`
 *   - any subdomain ending in `.github.com` (`api`, `gist`, `raw`,
 *     etc.) → `'github'`
 *   - everything else → `undefined`
 */
export function resolveSiteFamily(
  input: TabrixChooseContextInput,
): TabrixContextSiteFamily | undefined {
  const explicitSite = normalizeTabrixSiteId(input.siteId);
  if (explicitSite) return explicitSite;
  if (!input.url) return undefined;
  let host: string;
  try {
    host = new URL(input.url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  return normalizeTabrixSiteId(host);
}

/**
 * Pure facts the chooser routes over. Keeps `chooseContextStrategy`
 * trivially testable without standing up a SQLite handle.
 */
export interface ChooseContextFacts {
  intentSignature: string;
  pageRole?: string;
  siteFamily?: TabrixContextSiteFamily;
  experienceCatalog?: {
    experienceId: string;
    summary: string;
  };
  /**
   * Knowledge catalog summary for the resolved site family. Empty or
   * missing data means "do not pick `knowledge_light`".
   */
  knowledgeCatalog?: {
    site: string;
    totalEndpoints: number;
    sampleSignatures: string[];
  };
}

interface StrategyDecision {
  strategy: ContextStrategyName;
  fallbackStrategy?: ContextStrategyName;
  reasoning: string;
  artifacts: TabrixChooseContextArtifact[];
}

/**
 * Pure decision: facts → strategy + artifacts. Branches in the order
 * documented in `B_018_CONTEXT_SELECTOR_V1.md` §5; do NOT re-order
 * without updating the doc + the strategy-set guard test.
 */
export function chooseContextStrategy(facts: ChooseContextFacts): StrategyDecision {
  if (facts.experienceCatalog) {
    return {
      strategy: 'experience_reuse',
      fallbackStrategy: 'read_page_required',
      reasoning:
        'verified Experience exists for this site and page role. Reuse it first; fall back to chrome_read_page if the page state or filters do not match.',
      artifacts: [
        {
          kind: 'experience_recipe',
          ref: facts.experienceCatalog.experienceId,
          summary: facts.experienceCatalog.summary,
        },
      ],
    };
  }

  if (facts.knowledgeCatalog && facts.knowledgeCatalog.totalEndpoints > 0) {
    const cat = facts.knowledgeCatalog;
    const sample = cat.sampleSignatures.slice(0, KNOWLEDGE_LIGHT_SAMPLE_LIMIT);
    const summary =
      `Captured ${cat.totalEndpoints} endpoint(s) on ${cat.site}; ` +
      `sample: ${sample.join(' | ')}`;
    return {
      strategy: 'knowledge_light',
      fallbackStrategy: 'read_page_required',
      reasoning:
        `${cat.totalEndpoints} captured endpoint(s) on ${cat.site}. ` +
        `Use local Knowledge first; call chrome_read_page when the AI needs fresh page objects or action targets.`,
      artifacts: [
        {
          kind: 'knowledge_api',
          ref: cat.site,
          summary,
        },
      ],
    };
  }

  return {
    strategy: 'read_page_required',
    reasoning: 'no usable local Knowledge — fall back to chrome_read_page',
    artifacts: [],
  };
}

// ---------------------------------------------------------------------------
// Pure intent classifier for layer dispatch
// ---------------------------------------------------------------------------

/**
 * Bucket the free-text `intent` into the closed
 * {@link LayerDispatchUserIntentHint} enum. Pure function — uses
 * regex/keyword scans only, no Memory / Knowledge / network. Order
 * mirrors the layer dispatch strategy priority block; a hit on a
 * higher-priority bucket short-circuits.
 *
 * `'unknown'` means the dispatcher should fall through to task type /
 * page complexity. We never invent a bucket from the intent string.
 */
export function classifyIntentForLayerDispatch(intent: string): LayerDispatchUserIntentHint {
  if (typeof intent !== 'string' || intent.trim().length === 0) return 'unknown';
  const normalized = intent.toLowerCase();
  // priority 2.1 — summary / overview / gist / "what is this page"
  if (
    /(总结|重点|摘要|概要|简述)/.test(intent) ||
    /\b(overview|gist|summary|summari[sz]e|what\s+is\s+this\s+page|main\s+entry\s+points?)\b/.test(
      normalized,
    )
  ) {
    return 'summary';
  }
  // priority 2.4 — details / logs / tables / compare / debug / row-level inspection
  if (
    /(展开细看|详细|详情|展开|细节|对比|对照|调试)/.test(intent) ||
    /\b(detail|details|drill\s*into|expand|logs?|tables?|evidence|compare|diff|debug|row[- ]level|inspect)\b/.test(
      normalized,
    )
  ) {
    return 'details';
  }
  // priority 2.3 — fill / search / submit / form-like
  if (
    /(填写|提交|搜索|查询|表单)/.test(intent) ||
    /\b(fill|search|submit|form|input)\b/.test(normalized)
  ) {
    return 'form_or_submit';
  }
  // priority 2.2 — open / click / select a specific entry
  if (
    /(打开|点击|进入|选择|去到|跳转)/.test(intent) ||
    /\b(open|click|select|find|go\s+to|navigate)\b/.test(normalized)
  ) {
    return 'open_or_select';
  }
  return 'unknown';
}

/**
 * Derive task-type bucket from the user intent classification. Exposed
 * as a separate helper so unit tests can pin the matrix without
 * re-running the classifier. Pure function.
 */
export function deriveTaskTypeForLayerDispatch(
  hint: LayerDispatchUserIntentHint,
): LayerDispatchTaskType {
  switch (hint) {
    case 'summary':
      return 'reading_only';
    case 'details':
      return 'reading_only';
    case 'open_or_select':
      return 'action';
    case 'form_or_submit':
      return 'action';
    case 'unknown':
    default:
      return 'unknown';
  }
}

export interface RunTabrixChooseContextDeps {
  knowledgeApi:
    | (Pick<KnowledgeApiRepository, 'listBySite' | 'countAll'> &
        Partial<Pick<KnowledgeApiRepository, 'listScoredBySite'>>)
    | null;
  experienceRecipes?: {
    findReusableByContext(input: {
      siteFamily: string;
      pageRole?: string | null;
      limit?: number;
    }): ExperienceRecipe[];
  } | null;
  /**
   * Telemetry write-back. `null` means "telemetry disabled"
   * (persistence off, or the wiring opted out for a particular caller).
   * The chooser still returns a usable result; it just omits
   * `decisionId` so the caller knows there is no row to point
   * `tabrix_choose_context_record_outcome` at.
   */
  telemetry?: ChooseContextTelemetryRepository | null;
  /**
   * Honest dispatcher inputs. When provided, the chooser asks the
   * provider for `{candidateActionsCount, hvoCount, fullReadByteLength,
   * pageRole}` instead of feeding the dispatcher literal zeros. When
   * `undefined` or `null`, behaviour is bit-identical to the legacy
   * zero-input path: zeros in, `dispatcher_input_source` and
   * `fallback_cause_v26` left `null` in telemetry.
   */
  pageContext?: PageContextProvider | null;
  /**
   * Visible DOM/AX rows already extracted for this task. Kept
   * native-server-internal; public MCP schemas stay unchanged.
   */
  domRegionRowsEvidence?: RouterDomRegionRowsEvidence | null;
  /**
   * Opt-in flag the upstream caller MAY set (typically derived from
   * `process.env.TABRIX_LEARNING_MODE`) to mark this run as a "learning
   * pass". When `true` the chooser emits
   * `observeMode='foreground'` / `observeReason='learning_requested'`
   * regardless of the Knowledge state, so the upstream loop drives
   * `chrome_network_capture_start/stop` foreground and the resulting
   * traffic seeds Knowledge. When `undefined` / `false`, normal
   * execution-task semantics apply (Knowledge state alone decides).
   *
   * Closed boolean on purpose: a multi-valued enum here would
   * double-spend with `TabrixObserveReason`. Adding more learning
   * sub-modes is a separate product decision.
   */
  learningModeRequested?: boolean;
  /**
   * Test seam for deterministic ids / clocks. Defaults to
   * `randomUUID` and `() => new Date().toISOString()`.
   */
  newDecisionId?: () => string;
  now?: () => string;
}

/**
 * IO orchestrator: validates the args, fetches the two facts (best
 * Knowledge catalog snapshot), and routes through
 * the pure chooser. Always returns a `TabrixChooseContextResult` — the
 * caller wraps it into the MCP `CallToolResult` envelope.
 *
 * Knowledge is a core browser-automation input. When local endpoint
 * knowledge exists for the page/site, the chooser can route through it
 * before spending a fresh page read.
 */
export function runTabrixChooseContext(
  rawArgs: unknown,
  deps: RunTabrixChooseContextDeps,
): TabrixChooseContextResult {
  let parsed: ParsedChooseContextInput;
  try {
    parsed = parseTabrixChooseContextInput(rawArgs);
  } catch (error) {
    if (error instanceof TabrixChooseContextInputError) {
      return {
        status: 'invalid_input',
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  const { input, intentSignature } = parsed;
  const siteFamily = resolveSiteFamily(input);

  const nowIso = (deps.now ?? (() => new Date().toISOString()))();

  let experienceCatalog: ChooseContextFacts['experienceCatalog'];
  if (deps.experienceRecipes && siteFamily) {
    const reusableRecipes = deps.experienceRecipes.findReusableByContext({
      siteFamily,
      pageRole: input.pageRole ?? null,
      limit: 1,
    });
    if (reusableRecipes.length > 0 && reusableRecipes[0]) {
      experienceCatalog = buildExperienceCatalog(reusableRecipes[0]);
    }
  }

  let knowledgeCatalog: ChooseContextFacts['knowledgeCatalog'];
  const apiCandidate = resolveApiKnowledgeCandidate({
    intent: input.intent,
    url: input.url,
    pageRole: input.pageRole,
  });
  if (deps.knowledgeApi) {
    const site = apiCandidate?.endpointFamily ?? siteFamily;
    if (site) {
      const rows =
        typeof deps.knowledgeApi.listScoredBySite === 'function'
          ? deps.knowledgeApi
              .listScoredBySite(site, KNOWLEDGE_LIGHT_SAMPLE_LIMIT)
              .filter((row) => row.usableForTask)
          : deps.knowledgeApi.listBySite(site, KNOWLEDGE_LIGHT_SAMPLE_LIMIT);
      if (rows.length > 0) {
        knowledgeCatalog = {
          site,
          totalEndpoints: rows.length,
          sampleSignatures: rows.map((r) => r.endpointSignature),
        };
      }
    }
  }
  if (!knowledgeCatalog && apiCandidate) {
    knowledgeCatalog = {
      site: apiCandidate.endpointFamily,
      totalEndpoints: 1,
      sampleSignatures: [apiCandidate.endpointFamily],
    };
  }

  const decision = chooseContextStrategy({
    intentSignature,
    pageRole: input.pageRole,
    siteFamily,
    experienceCatalog,
    knowledgeCatalog,
  });

  // Layer dispatcher — runs once per chooser decision after the
  // strategy is picked. The dispatcher is pure (no IO) so this adds
  // zero hot-path Memory traffic. We feed it the same facts the
  // strategy used so rule alignment is auditable from telemetry.
  //
  // Honest dispatcher inputs. When the caller wired a
  // `PageContextProvider`, the dispatcher receives real
  // candidateActions / HVO counts + fullReadByteLength from that provider
  // instead of hard-coded zeros. The provider call itself is read-only and
  // never throws (it returns a `fallback_zero` shape on any error) so the
  // chooser hot-path stays safe. When the provider is absent (test stubs
  // / no live context) we keep the historical
  // zero-input behaviour bit-for-bit and leave `dispatcherInputSource` /
  // `fallbackCauseV26` `null` in telemetry.
  const intentHint = classifyIntentForLayerDispatch(input.intent);
  const dispatcherInputs = deps.pageContext
    ? deps.pageContext.getContext({
        url: input.url ?? null,
        pageRole: input.pageRole ?? null,
      })
    : null;
  const layerDispatch = dispatchLayer({
    pageRole: input.pageRole ?? null,
    userIntent: intentHint,
    taskType: deriveTaskTypeForLayerDispatch(intentHint),
    candidateActionsCount: dispatcherInputs?.candidateActionsCount ?? 0,
    hvoCount: dispatcherInputs?.hvoCount ?? 0,
    knowledgeAvailable: !!knowledgeCatalog && knowledgeCatalog.totalEndpoints > 0,
    searchListIntent: !!apiCandidate,
    safetyRequiresFullLayers: false,
    fullReadByteLength: dispatcherInputs?.fullReadByteLength ?? 0,
  });
  const tokensSavedEstimate = Math.max(
    0,
    layerDispatch.fullReadTokenEstimate - layerDispatch.tokenEstimate,
  );
  const effectiveSourceRoute =
    decision.strategy === 'experience_reuse' ? 'experience_reuse' : layerDispatch.sourceRoute;
  const domRegionRowsEvidence = deps.domRegionRowsEvidence ?? null;
  const routerDecision = routeDataSource({
    strategy: decision.strategy,
    sourceRoute: effectiveSourceRoute,
    chosenLayer: layerDispatch.chosenLayer,
    layerDispatchReason: layerDispatch.reason,
    tokenEstimateChosen: layerDispatch.tokenEstimate,
    tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
    tokensSavedEstimate,
    apiCandidateAvailable: !!apiCandidate,
    dispatcherInputSource: dispatcherInputs?.source ?? null,
    taskIntent: domRegionRowsEvidence ? mapIntentHintToRouterTaskIntent(intentHint) : undefined,
    readinessVerdict: domRegionRowsEvidence ? 'ready' : undefined,
    domRegionRowsEvidence,
  });
  const knowledgeEndpointFamily = knowledgeCatalog?.site ?? null;

  // Observe-mode advisory. Derived from the same Knowledge signals the
  // layer dispatcher already saw, so the chooser surface stays a single
  // source of truth. Order matters:
  //   1. `learning_requested` ALWAYS wins. The operator explicitly
  //      asked for a learning pass; we honour that even when Knowledge
  //      would have answered, because the point of the run is to grow
  //      the catalog.
  //   2. High-confidence Knowledge candidate (`apiCandidate`) →
  //      `disabled` / `not_needed`. The capture round-trip would be
  //      pure waste.
  //   3. Knowledge has rows but no usable candidate
  //      (`knowledgeCatalog && !apiCandidate`) → `background` /
  //      `confidence_low`. Passive listeners may still observe, but
  //      the upstream loop must not drive a foreground round-trip.
  //   4. No Knowledge for this site (`!knowledgeCatalog`) →
  //      `foreground` / `knowledge_missing`. Foreground capture is
  //      the only way to seed the catalog for a new site.
  //
  // The advisory is closed-enum and additive on the wire; callers that
  // ignore the field stay bit-identical.
  let observeMode: TabrixObserveMode;
  let observeReason: TabrixObserveReason;
  if (deps.learningModeRequested === true) {
    observeMode = 'foreground';
    observeReason = 'learning_requested';
  } else if (apiCandidate) {
    observeMode = 'disabled';
    observeReason = 'not_needed';
  } else if (knowledgeCatalog) {
    observeMode = 'background';
    observeReason = 'confidence_low';
  } else {
    observeMode = 'foreground';
    observeReason = 'knowledge_missing';
  }

  // Telemetry write-back. We attempt to record the decision ONLY when
  // telemetry is wired and we have a usable result to record. Failures
  // here MUST NOT poison the chooser result: a SQLite write that throws
  // (disk full, locked DB, …) becomes a missing `decisionId` field, not
  // a tool error. The caller treats "no decisionId" the same as
  // "telemetry off".
  //
  // The ranked / blocker / fallback-depth fields are intentionally NOT
  // persisted to `tabrix_choose_context_decisions` here. The telemetry
  // table schema stays frozen for compatibility; long-term ranked-depth
  // statistics belong in a dedicated migration.
  let decisionId: string | undefined;
  if (deps.telemetry) {
    const newId = deps.newDecisionId ?? randomUUID;
    const candidateId = newId();
    try {
      deps.telemetry.recordDecision({
        decisionId: candidateId,
        intentSignature,
        pageRole: input.pageRole ?? null,
        siteFamily: siteFamily ?? null,
        strategy: decision.strategy,
        fallbackStrategy: decision.fallbackStrategy ?? null,
        createdAt: nowIso,
        // Layer-dispatch telemetry
        chosenLayer: layerDispatch.chosenLayer,
        layerDispatchReason: layerDispatch.reason,
        sourceRoute: effectiveSourceRoute,
        fallbackCause: layerDispatch.fallbackCause ?? null,
        tokenEstimateChosen: layerDispatch.tokenEstimate,
        tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
        tokensSavedEstimate,
        knowledgeEndpointFamily,
        // Honest dispatcher input source. `null` when no `pageContext`
        // provider was wired (preserves the legacy null-everywhere
        // telemetry shape for callers and tests). Otherwise records the
        // closed-enum source the provider returned plus its
        // `fallbackCause` only on the `fallback_zero` branch.
        dispatcherInputSource: dispatcherInputs?.source ?? null,
        fallbackCauseV26:
          dispatcherInputs && dispatcherInputs.source === 'fallback_zero'
            ? (dispatcherInputs.fallbackCause ?? null)
            : null,
      });
      decisionId = candidateId;
    } catch (error) {
      // Telemetry breakage must not break the user-facing chooser call.
      const message = error instanceof Error ? error.message : String(error);
      chooseContextLogger.warn('telemetry recordDecision failed', { errorMessage: message });
    }
  }

  const result: TabrixChooseContextResultWithRouter = {
    status: 'ok',
    strategy: decision.strategy,
    fallbackStrategy: decision.fallbackStrategy,
    reasoning: decision.reasoning,
    artifacts: decision.artifacts,
    resolved: {
      intentSignature,
      pageRole: input.pageRole,
      siteFamily,
    },
    decisionId,
    // Layer-dispatch fields. Always present; safe defaults so older
    // callers still type-check.
    chosenLayer: layerDispatch.chosenLayer,
    layerDispatchReason: layerDispatch.reason,
    sourceRoute: effectiveSourceRoute,
    fallbackCause: layerDispatch.fallbackCause ?? undefined,
    tokenEstimateChosen: layerDispatch.tokenEstimate,
    tokenEstimateFullRead: layerDispatch.fullReadTokenEstimate,
    tokensSavedEstimate,
    // Observe-mode advisory (closed enum). Always present on
    // `status: 'ok'` so post-mortems can tally
    // `foregroundNetworkCaptureCount` deterministically.
    observeMode,
    observeReason,
    chosenSource: routerDecision.chosenSource,
    dataSource: routerDecision.dataSource,
    routerConfidence: routerDecision.confidence,
    routerRiskTier: routerDecision.riskTier,
    decisionReason: routerDecision.decisionReason,
    fallbackPlan: routerDecision.fallbackPlan,
    dispatcherInputSource: routerDecision.dispatcherInputSource,
    costEstimate: routerDecision.costEstimate,
  };
  return result;
}

function mapIntentHintToRouterTaskIntent(
  hint: LayerDispatchUserIntentHint,
): TaskIntentClass | undefined {
  switch (hint) {
    case 'form_or_submit':
      return 'search_list';
    case 'details':
      return 'detail';
    case 'summary':
      return 'document';
    case 'open_or_select':
      return 'click_or_fill';
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// `tabrix_choose_context_record_outcome`
// ---------------------------------------------------------------------------

const OUTCOME_VALUES: readonly TabrixChooseContextOutcome[] = [
  'reuse',
  'fallback',
  'completed',
  'retried',
];

const MAX_DECISION_ID_CHARS = 128;

function isOutcome(value: unknown): value is TabrixChooseContextOutcome {
  return typeof value === 'string' && (OUTCOME_VALUES as readonly string[]).includes(value);
}

interface ParsedRecordOutcomeInput {
  decisionId: string;
  outcome: TabrixChooseContextOutcome;
}

/**
 * Validate raw MCP arguments for `tabrix_choose_context_record_outcome`.
 * Mirrors the strictness of `parseTabrixChooseContextInput`:
 *   - missing / non-string `decisionId` → invalid_input
 *   - empty / over-cap `decisionId` → invalid_input
 *   - missing / out-of-set `outcome` → invalid_input
 * The schema in `tools.ts` already enforces most of this client-side,
 * but the runner duplicates the checks because the MCP host is
 * untrusted.
 */
function parseRecordOutcomeInput(rawArgs: unknown): ParsedRecordOutcomeInput {
  if (rawArgs === null || rawArgs === undefined) {
    throw new TabrixChooseContextInputError('missing arguments object');
  }
  if (typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    throw new TabrixChooseContextInputError('arguments must be an object');
  }
  const args = rawArgs as Record<string, unknown>;

  const rawDecisionId = readString(args, 'decisionId');
  if (rawDecisionId === undefined) {
    throw new TabrixChooseContextInputError("'decisionId' is required");
  }
  const decisionId = rawDecisionId.trim();
  if (decisionId.length === 0) {
    throw new TabrixChooseContextInputError("'decisionId' must be a non-empty string");
  }
  if (decisionId.length > MAX_DECISION_ID_CHARS) {
    throw new TabrixChooseContextInputError(`'decisionId' exceeds ${MAX_DECISION_ID_CHARS} chars`);
  }

  const rawOutcome = args.outcome;
  if (!isOutcome(rawOutcome)) {
    throw new TabrixChooseContextInputError(
      "'outcome' must be one of: reuse | fallback | completed | retried",
    );
  }

  return { decisionId, outcome: rawOutcome };
}

export interface RunTabrixChooseContextRecordOutcomeDeps {
  telemetry: ChooseContextTelemetryRepository | null;
  now?: () => string;
}

/**
 * Outcome write-back orchestrator. Always returns a structured
 * `TabrixChooseContextRecordOutcomeResult`:
 *   - `'invalid_input'` for malformed args (input type or value)
 *   - `'unknown_decision'` for valid args whose decisionId we don't
 *     have a row for (telemetry off / decision pruned / id typo)
 *   - `'ok'` after a successful append
 *
 * The handler in `native-tool-handlers.ts` maps `'invalid_input'`
 * to `isError: true` so the MCP host can surface it; `'unknown_decision'`
 * is NOT an error — it is a legitimate "telemetry lost" status the
 * caller can branch on.
 */
export function runTabrixChooseContextRecordOutcome(
  rawArgs: unknown,
  deps: RunTabrixChooseContextRecordOutcomeDeps,
): TabrixChooseContextRecordOutcomeResult {
  let parsed: ParsedRecordOutcomeInput;
  try {
    parsed = parseRecordOutcomeInput(rawArgs);
  } catch (error) {
    if (error instanceof TabrixChooseContextInputError) {
      return {
        status: 'invalid_input',
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }

  if (!deps.telemetry) {
    // Telemetry off: every previously-issued decisionId is by
    // definition unknown because we never persisted it. We treat this
    // as `unknown_decision` (not invalid_input) so the caller branches
    // the same way as "decision id we forgot about".
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  const now = deps.now ?? (() => new Date().toISOString());
  let result;
  try {
    result = deps.telemetry.recordOutcome({
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
      recordedAt: now(),
    });
  } catch (error) {
    // Same swallow-and-warn discipline as the chooser: telemetry
    // breakage MUST NOT escalate to a tool error. We surface
    // `unknown_decision` so the caller does not retry forever and the
    // failure is visible in the warning log.
    const message = error instanceof Error ? error.message : String(error);
    chooseContextLogger.warn('telemetry recordOutcome failed', { errorMessage: message });
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  if (result.status === 'unknown_decision') {
    return {
      status: 'unknown_decision',
      decisionId: parsed.decisionId,
      outcome: parsed.outcome,
    };
  }

  return {
    status: 'ok',
    decisionId: parsed.decisionId,
    outcome: parsed.outcome,
  };
}

// ---------------------------------------------------------------------------
// API Direct Execution Path wrapper
// ---------------------------------------------------------------------------

export interface RunTabrixChooseContextWithDirectApiDeps extends RunTabrixChooseContextDeps {
  /**
   * Optional fetch override forwarded to the direct-api-executor. When
   * omitted the executor falls through to the underlying default in
   * `readApiKnowledgeRows`. Tests inject a stub fetch.
   */
  directApiFetchFn?: ApiKnowledgeFetch;
  /**
   * Capability gate. When `false`, direct execution never fires — the
   * wrapper returns the synchronous chooser result unchanged so the
   * legacy happy path is bit-identical. Default: enabled.
   */
  directApiEnabled?: boolean;
  /**
   * Test seam for the executor's clock.
   */
  directApiNowMs?: () => number;
}

/**
 * Async wrapper that delegates to {@link runTabrixChooseContext} for
 * policy + telemetry, and then optionally executes the chosen read-only
 * API endpoint inline. The compact rows (or the
 * `'fallback_required'` / `'skipped_*'` advisory) land on
 * `result.directApiExecution`. Upstream MCP callers may then skip the
 * subsequent `chrome_navigate` + `chrome_read_page` round-trip when
 * `executionMode === 'direct_api'`.
 *
 * Hard contracts:
 *   1. Invariant for every non-`knowledge_supported_read` route AND
 *      every `directApiEnabled === false` invocation: the returned
 *      result is the exact value `runTabrixChooseContext` would have
 *      returned, with NO `directApiExecution` field. The legacy
 *      contract is preserved bit-identical.
 *   2. The wrapper NEVER throws on direct-execute failure. A failed
 *      API call collapses to `executionMode === 'fallback_required'`
 *      with a closed-enum `decisionReason` and the upstream caller
 *      falls back through the existing chrome_read_page chain
 *      (which is unchanged).
 *   3. Only `read_only` intents trigger an actual fetch. `action` /
 *      `unknown` intents short-circuit to `skipped_not_read_only`
 *      WITHOUT calling the underlying reader.
 */
export async function runTabrixChooseContextWithDirectApi(
  rawArgs: unknown,
  deps: RunTabrixChooseContextWithDirectApiDeps,
): Promise<TabrixChooseContextResult> {
  const result = runTabrixChooseContext(rawArgs, deps);
  if (result.status !== 'ok') return result;
  if (deps.directApiEnabled === false) return result;
  if (result.sourceRoute !== 'knowledge_supported_read') return result;

  // Re-parse the validated args. Cheap + deterministic — the underlying
  // chooser already accepted them so a re-parse cannot widen the
  // surface (any failure here is a programmer error). Mirrors the
  // re-resolution `persistChooseContextDecision` already does for
  // `apiCapability`.
  let parsed: ParsedChooseContextInput;
  try {
    parsed = parseTabrixChooseContextInput(rawArgs);
  } catch {
    return result;
  }

  const candidate = resolveApiKnowledgeCandidate({
    intent: parsed.input.intent,
    url: parsed.input.url,
    pageRole: parsed.input.pageRole,
  });

  // Derive the read-only gate from the layer-dispatch outcome rather
  // than re-classifying the raw user intent. Rationale:
  //   * The layer rule table routes "搜索/list" intents to
  //     `chosenLayer='L0' / sourceRoute='knowledge_supported_read'`
  //     even when `userIntent === 'form_or_submit'` (search is a
  //     DOM-land form, but an API-land read).
  //   * Rules that fire on a generic `knowledgeAvailable` action
  //     intent emit `chosenLayer='L0+L1'`, NOT `L0`. So the L0+
  //     knowledge_supported_read pair is exactly the read-only
  //     surface — the candidate's `method='GET'` is the second gate.
  // Falling back through the keyword classifier here would
  // over-suppress legitimate API search intents, which is the
  // mistake this direct-execution gate is correcting.
  const intentClass: DirectApiIntentClass = result.chosenLayer === 'L0' ? 'read_only' : 'action';

  // The executor's knowledge-driven branch is only exercised when both
  // `dataNeed` and `knowledgeRepo` are present. We only wire
  // `knowledgeRepo` through when the repository actually implements
  // `listScoredBySite` (older test seams may inject only `listBySite`),
  // which keeps the candidate-only path bit-identical for those callers.
  const knowledgeRepo: EndpointKnowledgeReader | undefined =
    deps.knowledgeApi && typeof deps.knowledgeApi.listScoredBySite === 'function'
      ? (deps.knowledgeApi as EndpointKnowledgeReader)
      : undefined;
  const dataNeed: DataNeed | undefined = knowledgeRepo
    ? {
        intent: parsed.input.intent.toLowerCase(),
        intentClass,
        // Leave the closed-enum hint at `null` for now.
        // The lookup falls through to "any usable read" semantics,
        // which is the intended minimum safe lookup behaviour. A future
        // change may map intent keywords (`search` /
        // `list` / `detail` / `pagination` / `filter`) onto the
        // closed enum once we have telemetry showing it actually
        // helps disambiguate.
        semanticTypeWanted: null,
        urlHint: parsed.input.url ?? null,
        pageRole: parsed.input.pageRole ?? null,
        params: buildDataNeedParams(parsed.input.intent),
      }
    : undefined;

  const requestedRowLimit = deriveRequestedRowLimit(parsed.input.intent);
  const exec = await tryDirectApiExecute({
    sourceRoute: result.sourceRoute,
    candidate,
    intentClass,
    fetchFn: deps.directApiFetchFn,
    nowMs: deps.directApiNowMs,
    dataNeed,
    knowledgeRepo,
    limit: requestedRowLimit,
  });

  return {
    ...result,
    directApiExecution: {
      executionMode: exec.executionMode,
      decisionReason: exec.decisionReason,
      browserNavigationSkipped: exec.browserNavigationSkipped,
      readPageAvoided: exec.readPageAvoided,
      endpointFamily: exec.endpointFamily,
      candidateConfidence: exec.candidateConfidence,
      fallbackCause: exec.fallbackCause,
      fallbackEntryLayer: exec.fallbackEntryLayer,
      rows: exec.rows?.rows ?? null,
      rowCount: exec.rows?.rowCount ?? null,
      // Surface the closed empty-result envelope so the shim and the
      // operation log can distinguish a "verified empty" API answer
      // from a 0-row miss without re-deriving it from rowCount===0.
      // Stays `null` on every non-`direct_api` branch (no reader was
      // reached).
      emptyResult: exec.rows?.emptyResult ?? null,
      emptyReason: exec.rows?.emptyReason ?? null,
      emptyMessage: exec.rows?.emptyMessage ?? null,
      apiTelemetry: exec.apiTelemetry,
      // Surface the closed-enum endpoint lineage marker so operation
      // logs and benchmark transformers can attribute every direct-API
      // call into the `observed` / `seed_adapter` / `manual_seed` /
      // `unknown` bucket without re-deriving it from the endpoint family
      // string. `null` on every short-circuit branch (the executor never
      // reached a reader).
      endpointSource: exec.endpointSource ?? null,
      // `readerMode / knowledgeEndpointId / endpointPattern /
      // endpointSemanticType / requestShapeUsed / semanticValidation`
      // exist on the executor's internal result but are intentionally
      // NOT surfaced on `TabrixDirectApiExecution` (a cross-process
      // wire type in `packages/shared/src/choose-context.ts`). Those
      // details belong in the operation-memory-log evidence contract;
      // widening the public chooser schema here would require a
      // `packages/shared` compatibility change.
    },
  };
}
