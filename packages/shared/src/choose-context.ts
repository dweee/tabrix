import type {
  LayerDispatchReason,
  LayerSourceRoute,
  ReadPageRequestedLayer,
} from './read-page-contract';
import type { SiteFamily, SiteId } from './site';

/**
 * Tabrix MKEP `tabrix_choose_context` public contract.
 *
 * Current public contract:
 *  - Closed strategy set (no unreviewed `api_only` / auto-execute branch).
 *  - No `tokenEstimate` (we have no calibration data; an invented number
 *    would mislead upstream planners).
 *  - Site-neutral `siteId` / `siteFamily` tokens. Unknown or unsupported
 *    site policies fall through to safe read paths.
 *
 * This module is types + constants only — pure data, no IO. The runtime
 * lives in the native-server (`mcp/choose-context.ts`).
 */

/** Maximum length of the `intent` argument before truncation. */
export const MAX_TABRIX_CHOOSE_CONTEXT_INTENT_CHARS = 1024;

/** Maximum length of the optional `pageRole` filter. */
export const MAX_TABRIX_CHOOSE_CONTEXT_PAGE_ROLE_CHARS = 128;

/**
 * Maximum number of endpoint signatures echoed in the `knowledge_light`
 * artifact summary. Keeps payload bounded even when a site has many
 * captured endpoints.
 */
export const KNOWLEDGE_LIGHT_SAMPLE_LIMIT = 5;

/**
 * Site family token resolved from `siteId` or URL-derived knowledge.
 * Tokens are site-neutral identifiers and do not imply bundled platform
 * behavior.
 */
export type TabrixContextSiteFamily = SiteFamily;

/** Public `siteId` input token for the chooser. */
export type TabrixContextSiteId = SiteId;

/**
 * Closed v1 strategy set. Adding a new value here is itself a v2 design
 * decision — never silently widen this in a feature branch.
 *
 * `read_page_markdown` joins the set as the
 * text-heavy reading branch. It points the caller at
 * `chrome_read_page(render='markdown')`, which is a
 * READING surface — the JSON HVOs / candidateActions / `targetRef`
 * stay the execution truth. The chooser only picks this branch when
 * (a) no experience hit, (b) no usable knowledge catalog, and
 * (c) `pageRole` is in a small known-text whitelist (see
 * `MARKDOWN_FRIENDLY_PAGE_ROLES`). Outside that whitelist the chooser
 * still returns `read_page_required` so JSON-only callers see no
 * behavior change.
 */
export type ContextStrategyName =
  | 'experience_reuse'
  | 'knowledge_light'
  | 'read_page_markdown'
  | 'read_page_required';

/**
 * Small, hand-curated set of `pageRole` values
 * for which the chooser will route the no-experience / no-knowledge
 * fallback to `read_page_markdown` instead of `read_page_required`.
 *
 * Why a hand-curated set: only a subset of page roles are
 * "long-form reading" pages where Markdown beats the JSON snapshot for
 * token cost. Forward-compatible tokens are generic document/detail roles so
 * when the understanding layer starts emitting them, the routing flips on
 * automatically without another shared-contract change.
 *
 * Anything outside this list keeps the v1 fallback (`read_page_required`).
 */
export const MARKDOWN_FRIENDLY_PAGE_ROLES: readonly string[] = Object.freeze([
  'content_detail',
  'article',
  'document',
  'document_detail',
  'knowledge_article',
  'help_article',
  'release_notes',
]);

/**
 * Validated public input. Built from raw MCP args by
 * `parseTabrixChooseContextInput` in the native-server.
 */
export interface TabrixChooseContextInput {
  /** Free-text intent. Non-empty after trim. Truncated before normalization. */
  intent: string;
  /** Optional page URL. Unparseable values are silently ignored (see doc §3.1). */
  url?: string;
  /** Optional `pageRole` filter, mirroring the chooser contract. */
  pageRole?: string;
  /**
   * Optional explicit site-family override. Must be a shared safe token.
   * Values are accepted by the public contract and then fail closed when no
   * matching Knowledge policy is configured.
   */
  siteId?: TabrixContextSiteId;
}

/**
 * One reusable artifact reference returned alongside the chosen
 * strategy. `ref` is opaque to the caller and owned by whichever native
 * subsystem produced it.
 */
export interface TabrixChooseContextArtifact {
  kind: 'experience_recipe' | 'knowledge_api' | 'knowledge_page_model' | 'read_page';
  ref: string;
  /** Compact human-readable label, ≤ 200 chars. Not a UI string. */
  summary: string;
  /**
   * Optional executable guidance for `kind: 'experience_recipe'`.
   *
   * This is a compact, privacy-safe recipe envelope: callers can use it
   * to replay the successful pattern, but it must not contain raw page
   * payloads, cookies, tokens, concrete tab ids, or session-only DOM refs.
   */
  recipe?: {
    schema: 'tabrix_experience_recipe_hint_v1';
    siteFamily?: string | null;
    pageRole?: string | null;
    taskSignature?: string | null;
    successCount?: number;
    reliabilityScore?: number | null;
    driftState?: string | null;
    steps?: unknown[];
    successCheck?: unknown;
    fallback?: string;
  };
  /**
   * Optional privacy-safe page capability hint distilled from Object Library
   * records. This is read-only guidance for AI context selection; it is not an
   * execution recipe and must not contain raw page payloads or session DOM refs.
   */
  knowledgeModel?: {
    schema: 'tabrix_knowledge_page_model_hint_v1';
    siteFamily?: string | null;
    pageRole?: string | null;
    pageModelKey?: string | null;
    observationCount?: number;
    confidenceScore?: number | null;
    lastObservedAt?: string | null;
    objectTypeCounts?: Record<string, number>;
    reusableActionKinds?: string[];
    dataSourceKinds?: string[];
  };
}

/**
 * Echo of what the tool resolved from input.
 */
export interface TabrixChooseContextResolved {
  intentSignature: string;
  pageRole?: string;
  siteFamily?: TabrixContextSiteFamily;
}

export interface TabrixChooseContextErrorBody {
  code: string;
  message: string;
}

/**
 * Public response. `status: 'invalid_input'` carries only `error`
 * (everything else is omitted) so the caller can branch on the
 * discriminator without writing optional-chains for every field.
 */
export interface TabrixChooseContextResult {
  status: 'ok' | 'invalid_input';
  strategy?: ContextStrategyName;
  /**
   * Concrete next-step the caller should fall back to if `strategy`
   * cannot be acted on. In v1 this is always `'read_page_required'`
   * when `strategy` is something else, and omitted when `strategy`
   * already is `'read_page_required'`.
   */
  fallbackStrategy?: ContextStrategyName;
  /** Short rationale, stable enough to grep in logs. */
  reasoning?: string;
  /** Always a list when `status === 'ok'`; possibly empty. */
  artifacts?: TabrixChooseContextArtifact[];
  resolved?: TabrixChooseContextResolved;
  error?: TabrixChooseContextErrorBody;
  /**
   * Opaque decision id (UUIDv4). Present when
   * `status === 'ok'` AND a telemetry row was successfully written.
   * Absent when telemetry is disabled / failed (the chooser still
   * succeeds; outcome write-back simply has nothing to point at).
   *
   * Upstream callers MAY persist this id and pass it back to
   * `tabrix_choose_context_record_outcome` to close the loop on
   * "did this strategy actually save us a `read_page` round-trip?".
   * The id has no semantics beyond being a primary key; do NOT parse it.
   */
  decisionId?: string;
  /**
   * Chosen layer envelope the dispatcher selected for this
   * decision. Optional so older callers / tests that mock the result
   * stay valid; populated whenever `status === 'ok'` and the v25
   * dispatcher ran.
   */
  chosenLayer?: ReadPageRequestedLayer;
  /**
   * Closed-enum reason that maps to the Layer Dispatch Strategy Table.
   * See {@link
   * ./read-page-contract.LayerDispatchReason}.
   */
  layerDispatchReason?: LayerDispatchReason;
  /**
   * Closed-enum routing instruction telling the caller whether
   * `chrome_read_page` is required, Knowledge supports the read, or the
   * dispatcher fell back. See {@link ./read-page-contract.LayerSourceRoute}.
   */
  sourceRoute?: LayerSourceRoute;
  /**
   * Short rationale string for the dispatcher's fallback
   * branch. Empty / omitted on non-fallback branches. Intended for
   * post-mortems and release reports.
   */
  fallbackCause?: string;
  /**
   * `ceil(byteLength/4)` token estimate of the layer the
   * dispatcher chose to ask for. `0` means the dispatcher did not
   * derive an estimate (e.g. unknown page size).
   */
  tokenEstimateChosen?: number;
  /**
   * `ceil(byteLength/4)` token estimate of the equivalent
   * full `L0+L1+L2` read. `0` when unknown. Always `>= tokenEstimateChosen`
   * when both are known.
   */
  tokenEstimateFullRead?: number;
  /**
   * `max(0, tokenEstimateFullRead - tokenEstimateChosen)`.
   * Pre-computed for telemetry ergonomics. Always `0` when either side
   * is unknown.
   */
  tokensSavedEstimate?: number;
  /**
   * Closed-enum advisory the chooser writes to tell the
   * upstream MCP loop how (and whether) to drive
   * `chrome_network_capture_start/stop` for this task. Defaults to
   * `'disabled'`/`'not_needed'` for a normal execution task with
   * Knowledge support; only `'foreground'` truly requires the caller
   * to drive the foreground capture round-trip. Absent when the
   * chooser short-circuits on `status: 'invalid_input'`.
   *
   * Hard rules:
   *   - Closed enum values; no synonyms (the post-mortem groups
   *     `foregroundNetworkCaptureCount` by these tokens).
   *   - The chooser does NOT itself invoke the capture tool. It only
   *     emits the advisory; the upstream caller (or the bridge
   *     dispatcher) decides whether to honour it.
   */
  observeMode?: TabrixObserveMode;
  /**
   * Closed-enum reason the chooser picked the
   * {@link observeMode} value above. Same evidence-field discipline
   * as {@link layerDispatchReason} / {@link directApiExecution}: one
   * deterministic token per branch so post-mortems stay groupable.
   */
  observeReason?: TabrixObserveReason;
  /**
   * Optional inline API execution envelope. Present only
   * when (a) the chooser routed to `'knowledge_supported_read'`, (b)
   * a high-confidence read-only endpoint candidate was resolved, and
   * (c) the executor actually attempted the call. The closed-enum
   * `executionMode` discriminator distinguishes:
   *   - `'direct_api'`           — rows are present; upstream MAY
   *                                skip the chrome_navigate +
   *                                chrome_read_page round-trip.
   *   - `'fallback_required'`    — the API call failed (timeout /
   *                                rate-limit / decode error /
   *                                semantic mismatch); upstream MUST
   *                                fall back to chrome_read_page at
   *                                the suggested entry layer.
   *   - `'skipped_*'`            — the executor short-circuited
   *                                without attempting a call (low
   *                                confidence / non-read-only intent
   *                                / no candidate / route mismatch);
   *                                upstream behaves exactly like a
   *                                legacy chooser caller.
   *
   * Absent on every other strategy / status combination so legacy
   * callers stay bit-identical. Field is additive on
   * the JSON wire shape; no MCP `tools.ts` schema change.
   */
  directApiExecution?: TabrixDirectApiExecution;
}

/**
 * Closed-enum advisory for whether the upstream caller
 * should drive a foreground `chrome_network_capture_start/stop`
 * round-trip for this task.
 *
 *   - `'foreground'` — the chooser EXPLICITLY asked for foreground
 *     capture. Today this fires only on `learning_requested` (env
 *     opt-in) or `knowledge_missing` (no Knowledge for the site
 *     family). The upstream caller is expected to drive
 *     `chrome_network_capture_start/stop` synchronously.
 *   - `'background'` — the chooser did NOT need the capture for
 *     this read, but a passive background subsystem (network
 *     capture listener) MAY still observe traffic for
 *     post-hoc Knowledge upserts. The upstream caller MUST NOT
 *     drive a foreground round-trip.
 *   - `'disabled'` — the chooser asserts the capture round-trip is
 *     wasted work for this task (e.g. high-confidence Knowledge
 *     hit). The upstream caller MUST NOT drive
 *     `chrome_network_capture_start/stop`; defense-in-depth gates
 *     in the extension may hard-skip the call if it leaks through.
 */
export type TabrixObserveMode = 'foreground' | 'background' | 'disabled';

/**
 * Closed-enum reason the chooser chose its
 * {@link TabrixObserveMode}. Tokens are deterministic so post-mortem
 * aggregations stay groupable.
 *
 *   - `'learning_requested'`     — caller requested a foreground learning pass
 *     (`TABRIX_LEARNING_MODE` truthy) flagged this run as a learning
 *     pass; foreground observe is required to seed Knowledge.
 *   - `'knowledge_missing'`      — no Knowledge catalog entry exists
 *     for the resolved site family; foreground observe is the only
 *     way to enrich the catalog.
 *   - `'confidence_low'`         — Knowledge exists but the
 *     candidate did not clear the confidence gate; passive
 *     background observe is acceptable.
 *   - `'not_needed'`             — Knowledge has a high-confidence
 *     candidate; the capture round-trip is redundant work and is
 *     `disabled`.
 */
export type TabrixObserveReason =
  | 'learning_requested'
  | 'knowledge_missing'
  | 'confidence_low'
  | 'not_needed';

/**
 * Closed-enum executor state surfaced on
 * {@link TabrixChooseContextResult.directApiExecution}.
 */
export type TabrixDirectApiExecutionMode =
  | 'direct_api'
  | 'fallback_required'
  | 'skipped_low_confidence'
  | 'skipped_not_read_only'
  | 'skipped_no_candidate'
  | 'skipped_route_mismatch';

/**
 * Closed-enum reason the executor reached its
 * {@link TabrixDirectApiExecutionMode}. The
 * `'api_call_failed_<reason>'` family is intentionally a string union
 * over the underlying API knowledge fallback reasons (rate_limited /
 * network_timeout / decode_error / …) so a post-mortem can group by
 * the failure class without parsing free-form strings.
 */
export type TabrixDirectApiDecisionReason =
  | 'endpoint_knowledge_high_confidence'
  | 'endpoint_low_confidence'
  | 'endpoint_not_resolved'
  | 'route_mismatch_not_knowledge_supported'
  | 'intent_not_read_only'
  | `api_call_failed_${string}`;

/**
 * Compact API row shape mirrored from the underlying
 * reader (`ApiKnowledgeCompactRow`). Kept as a flat string-or-scalar
 * map so the JSON wire shape never carries nested raw bodies.
 */
export type TabrixDirectApiCompactRow = Record<string, string | number | boolean | null>;

/**
 * Public view of the executor result the chooser ships.
 * Intentionally narrower than the internal
 * `DirectApiExecutionResult` to keep the wire surface stable while
 * the underlying lookup module may evolve.
 */
export interface TabrixDirectApiExecution {
  executionMode: TabrixDirectApiExecutionMode;
  decisionReason: TabrixDirectApiDecisionReason;
  /** True iff `executionMode === 'direct_api'`. */
  browserNavigationSkipped: boolean;
  /** Mirrors {@link browserNavigationSkipped}; preserved for the chrome_read_page contract. */
  readPageAvoided: boolean;
  /** Endpoint family the executor (would have) called; null when no candidate was eligible. */
  endpointFamily: string | null;
  /** Confidence score the executor saw on the candidate; null when the candidate was missing. */
  candidateConfidence: number | null;
  /**
   * Closed-enum reader fallback cause; null on `direct_api` and on
   * the `'skipped_*'` short-circuits. Surfaced so operation logs can record
   * a single closed-enum value to the operation log.
   */
  fallbackCause: string | null;
  /** Suggested entry layer when `'fallback_required'`; null otherwise. */
  fallbackEntryLayer: 'L0+L1' | null;
  /**
   * Compact rows; present ONLY when `executionMode === 'direct_api'`.
   * Same scrubbed shape `chrome_read_page`'s API path returns —
   * upstream consumers can treat the two surfaces interchangeably.
   */
  rows: TabrixDirectApiCompactRow[] | null;
  /** Row count; null when no fetch was attempted. */
  rowCount: number | null;
  /**
   * `true` iff the API call succeeded but returned zero
   * rows; `false` on the non-empty happy path. `null` when the
   * executor never reached a reader (no API attempt). Optional so
   * legacy callers stay bit-identical; current consumers can
   * distinguish "verified empty" from "API failed" without
   * re-deriving from `rowCount`.
   */
  emptyResult?: boolean | null;
  /**
   * Closed-enum reason for the empty result; `null` on
   * the non-empty happy path. Omitted when the executor never reached
   * a reader.
   */
  emptyReason?: 'no_matching_records' | null;
  /**
   * Human-readable message for the empty result; `null`
   * on the non-empty happy path. Omitted when the executor never
   * reached a reader.
   */
  emptyMessage?: string | null;
  /** Optional API telemetry forwarded from the underlying reader. */
  apiTelemetry?: TabrixDirectApiTelemetry | null;
  /**
   * Closed-enum lineage marker that classifies how the
   * endpoint we (would have) called was sourced. Mirrors the
   * executor's internal `endpointSource` field so the Gate B
   * benchmark transformer / report can split the run mix into
   * `observed` (mainline, came from `chrome_network_capture`) vs
   * `seed_adapter` (legacy hardcoded family) vs `manual_seed`
   * (operator-curated). `null` on every short-circuit branch where
   * no fetch was attempted; left optional so legacy callers stay
   * bit-identical on the wire.
   */
  endpointSource?: 'observed' | 'seed_adapter' | 'manual_seed' | null;
}

/** Read-only API telemetry fields surfaced upward. */
export interface TabrixDirectApiTelemetry {
  endpointFamily?: string;
  method: string;
  reason: string;
  status: number | null;
  waitedMs: number;
  readAllowed: boolean;
  fallbackEntryLayer: 'L0+L1' | 'none';
}

/**
 * Closed outcome label set for the chooser
 * write-back loop. `reuse` means the suggested strategy was acted on
 * AND saved a `read_page`; `fallback` means the caller had to fall
 * back to `read_page` anyway; `completed` means the whole task
 * completed successfully on top of the suggested strategy; `retried`
 * means the caller went back and re-issued `tabrix_choose_context`
 * (signalling the first decision wasn't useful).
 *
 * Closed on purpose so the outcome aggregation in
 * `release:choose-context-stats` can keep its grouping deterministic.
 */
export type TabrixChooseContextOutcome = 'reuse' | 'fallback' | 'completed' | 'retried';

/** Validated public input for `tabrix_choose_context_record_outcome`. */
export interface TabrixChooseContextRecordOutcomeInput {
  decisionId: string;
  outcome: TabrixChooseContextOutcome;
}

/**
 * Public response for `tabrix_choose_context_record_outcome`.
 * `status: 'invalid_input'` carries only `error`. `status: 'unknown_decision'`
 * means the decision id was well-formed but no telemetry row matched;
 * the caller should treat that as "decision lost" rather than "permission
 * denied" or a transport error.
 */
export interface TabrixChooseContextRecordOutcomeResult {
  status: 'ok' | 'invalid_input' | 'unknown_decision';
  decisionId?: string;
  outcome?: TabrixChooseContextOutcome;
  error?: TabrixChooseContextErrorBody;
}
