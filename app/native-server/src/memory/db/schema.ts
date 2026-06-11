/**
 * MKE Core Storage v1.
 *
 * Product memory now starts here. The pre-launch Memory Phase 0 tables
 * (`memory_tasks`, `memory_sessions`, `memory_steps`, page snapshots,
 * action rows, and operation logs) are retired; tool-call facts must enter
 * through `tabrix_memory_traces`.
 *
 * - `tabrix_memory_traces` is append-only factual trace storage for each
 *   AI -> Tabrix tool call and Tabrix -> AI result.
 * - `tabrix_knowledge_models` is a page-object model store. It is NOT a
 *   keyword dictionary; object/data-source models must distinguish stable
 *   structural signals from weak text signals inside their JSON blobs.
 * - `tabrix_experience_recipes` is a redacted, import/export-capable recipe
 *   store derived from successful traces.
 */
export const MKE_CORE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tabrix_memory_traces (
  trace_id                 TEXT PRIMARY KEY,
  task_id                  TEXT NOT NULL,
  task_theme               TEXT,
  task_intent              TEXT,
  task_signature           TEXT,
  ai_client                TEXT,
  tool_name                TEXT NOT NULL,
  tool_call_id             TEXT,
  sequence_index           INTEGER,
  request_params_blob      TEXT NOT NULL,
  request_at               TEXT NOT NULL,
  response_blob            TEXT NOT NULL,
  response_at              TEXT NOT NULL,
  duration_ms              INTEGER,
  tool_success             INTEGER,
  business_success         TEXT,
  result_summary           TEXT,
  error_code               TEXT,
  tab_id                   INTEGER,
  window_id                INTEGER,
  browser_context_key      TEXT,
  tab_lifecycle_blob       TEXT,
  site_family              TEXT,
  page_url_pattern         TEXT,
  page_role                TEXT,
  page_state               TEXT,
  page_model_key           TEXT,
  perception_objects_blob  TEXT,
  action_target_blob       TEXT,
  pre_observation_blob     TEXT,
  post_observation_blob    TEXT,
  post_action_delta_blob   TEXT,
  source_route             TEXT,
  selected_data_source     TEXT,
  freshness                TEXT,
  fallback_used            TEXT,
  next_required_check      TEXT,
  token_prompt             INTEGER,
  token_completion         INTEGER,
  token_total              INTEGER,
  ai_feedback_score        REAL,
  ai_feedback_blob         TEXT,
  redaction_state          TEXT NOT NULL DEFAULT 'redacted',
  created_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tabrix_memory_traces_task_idx
  ON tabrix_memory_traces(task_id, created_at);
CREATE INDEX IF NOT EXISTS tabrix_memory_traces_tool_idx
  ON tabrix_memory_traces(tool_name, created_at);
CREATE INDEX IF NOT EXISTS tabrix_memory_traces_page_idx
  ON tabrix_memory_traces(site_family, page_model_key, page_role, created_at);
CREATE INDEX IF NOT EXISTS tabrix_memory_traces_success_idx
  ON tabrix_memory_traces(tool_success, business_success, created_at);

CREATE TABLE IF NOT EXISTS tabrix_knowledge_models (
  knowledge_id                 TEXT PRIMARY KEY,
  site_family                  TEXT NOT NULL,
  page_url_pattern             TEXT,
  page_role                    TEXT NOT NULL,
  page_model_key               TEXT NOT NULL,
  model_version                INTEGER NOT NULL DEFAULT 1,
  page_state_model_blob        TEXT NOT NULL,
  object_graph_blob            TEXT NOT NULL,
  action_surface_blob          TEXT NOT NULL,
  data_source_model_blob       TEXT,
  navigation_model_blob        TEXT,
  failure_signal_blob          TEXT,
  source_trace_ids_blob        TEXT,
  source_experience_ids_blob   TEXT,
  observation_count            INTEGER NOT NULL DEFAULT 0,
  successful_use_count         INTEGER NOT NULL DEFAULT 0,
  failed_use_count             INTEGER NOT NULL DEFAULT 0,
  confidence_score             REAL NOT NULL DEFAULT 0,
  drift_score                  REAL,
  archived_at                  TEXT,
  last_observed_at             TEXT,
  last_validated_at            TEXT,
  created_at                   TEXT NOT NULL,
  updated_at                   TEXT NOT NULL,
  UNIQUE(site_family, page_model_key, model_version)
);

CREATE INDEX IF NOT EXISTS tabrix_knowledge_models_lookup_idx
  ON tabrix_knowledge_models(site_family, page_role, page_model_key);
CREATE INDEX IF NOT EXISTS tabrix_knowledge_models_confidence_idx
  ON tabrix_knowledge_models(confidence_score, last_validated_at);

CREATE TABLE IF NOT EXISTS tabrix_experience_recipes (
  experience_id              TEXT PRIMARY KEY,
  recipe_name                TEXT NOT NULL,
  scenario_key               TEXT NOT NULL,
  task_signature             TEXT NOT NULL,
  recipe_fingerprint         TEXT NOT NULL,
  recipe_version             INTEGER NOT NULL DEFAULT 1,
  site_family                TEXT,
  page_model_key             TEXT,
  page_role                  TEXT,
  preconditions_blob         TEXT NOT NULL,
  variable_schema_blob       TEXT NOT NULL,
  steps_blob                 TEXT NOT NULL,
  success_check_blob         TEXT NOT NULL,
  recovery_blob              TEXT,
  source_trace_ids_blob      TEXT NOT NULL DEFAULT '[]',
  linked_knowledge_ids_blob  TEXT,
  success_count              INTEGER NOT NULL DEFAULT 0,
  failure_count              INTEGER NOT NULL DEFAULT 0,
  adoption_count             INTEGER NOT NULL DEFAULT 0,
  avg_duration_ms            INTEGER,
  avg_token_total            INTEGER,
  reliability_score          REAL,
  speed_score                REAL,
  token_saving_score         REAL,
  usefulness_score           REAL,
  drift_state                TEXT,
  portability_scope          TEXT NOT NULL DEFAULT 'local',
  origin_kind                TEXT NOT NULL DEFAULT 'local_mined',
  origin_package_id          TEXT,
  compatibility_blob         TEXT,
  export_state               TEXT NOT NULL DEFAULT 'not_exportable',
  import_state               TEXT NOT NULL DEFAULT 'native',
  redaction_state            TEXT NOT NULL DEFAULT 'template_only'
                             CHECK (redaction_state = 'template_only'),
  archived_at                TEXT,
  last_used_at               TEXT,
  last_verified_at           TEXT,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE(recipe_fingerprint, recipe_version)
);

CREATE INDEX IF NOT EXISTS tabrix_experience_recipes_lookup_idx
  ON tabrix_experience_recipes(site_family, page_model_key, page_role, task_signature);
CREATE INDEX IF NOT EXISTS tabrix_experience_recipes_score_idx
  ON tabrix_experience_recipes(reliability_score, usefulness_score);
CREATE INDEX IF NOT EXISTS tabrix_experience_recipes_import_export_idx
  ON tabrix_experience_recipes(export_state, import_state, updated_at);
`;

/**
 * Browser Object schema.
 *
 * `tabrix_browser_objects` is the current browser/page object fact layer. It
 * is additive to MKE: Memory remains the tool-call trace log, Knowledge can
 * later project from object facts, and Experience still mines validated Memory
 * paths. The table stores redacted object summaries, not raw DOM/text/body
 * evidence.
 */
export const BROWSER_OBJECT_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tabrix_browser_objects (
  browser_object_id      TEXT PRIMARY KEY,
  schema_version         INTEGER NOT NULL DEFAULT 1,
  site_family            TEXT NOT NULL DEFAULT 'unknown',
  page_url_pattern       TEXT,
  root_route             TEXT,
  current_route          TEXT,
  page_role              TEXT,
  page_model_key         TEXT NOT NULL DEFAULT 'unknown',
  object_fingerprint     TEXT NOT NULL,
  object_type            TEXT NOT NULL,
  parent_object_id       TEXT,
  model_version          INTEGER NOT NULL DEFAULT 1,
  browser_context_key    TEXT,
  tab_id                 INTEGER,
  window_id              INTEGER,
  owner_type             TEXT,
  source_route           TEXT,
  selected_data_source   TEXT,
  source_lineage_blob    TEXT,
  source_freshness       TEXT,
  tab_status             TEXT,
  lifecycle_state        TEXT,
  is_active              INTEGER,
  can_tabrix_operate     INTEGER,
  operability_reason     TEXT,
  targetability_blob     TEXT,
  facts_blob             TEXT,
  action_types_blob      TEXT,
  changed_groups_blob    TEXT,
  primary_conclusion     TEXT,
  claim_boundary         TEXT,
  observation_count      INTEGER NOT NULL DEFAULT 0,
  confidence_score       REAL,
  drift_score            REAL,
  last_observed_at       TEXT,
  last_validated_at      TEXT,
  first_trace_id         TEXT,
  last_trace_id          TEXT,
  source_trace_ids_blob  TEXT,
  evidence_refs_blob     TEXT,
  redaction_state        TEXT NOT NULL DEFAULT 'redacted',
  current_state_blob     TEXT,
  recent_events_blob     TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  closed_at              TEXT,
  archived_at            TEXT,
  UNIQUE(site_family, page_model_key, object_fingerprint, schema_version)
);

CREATE INDEX IF NOT EXISTS tabrix_browser_objects_lookup_idx
  ON tabrix_browser_objects(site_family, page_model_key, object_type, updated_at);
CREATE INDEX IF NOT EXISTS tabrix_browser_objects_lifecycle_idx
  ON tabrix_browser_objects(lifecycle_state, source_freshness, updated_at);
CREATE INDEX IF NOT EXISTS tabrix_browser_objects_tab_idx
  ON tabrix_browser_objects(browser_context_key, window_id, tab_id, updated_at);
CREATE INDEX IF NOT EXISTS tabrix_browser_objects_operability_idx
  ON tabrix_browser_objects(can_tabrix_operate, owner_type, updated_at);
`;

/**
 * Experience schema.
 *
 * Co-located in the same `memory.db` file as Memory: Experience is a
 * derived view of Memory data, and keeping them in one DB keeps
 * projection reads/writes local to one SQLite handle.
 *
 * Same idempotency rules as Memory: every `CREATE … IF NOT EXISTS`.
 */
export const EXPERIENCE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS experience_action_paths (
  action_path_id           TEXT PRIMARY KEY,
  site_family              TEXT NOT NULL DEFAULT 'unknown',
  page_role                TEXT NOT NULL,
  intent_signature         TEXT NOT NULL,
  step_sequence            TEXT NOT NULL,    -- JSON: ordered [{ toolName, status, historyRef }]
  success_count            INTEGER NOT NULL DEFAULT 0,
  failure_count            INTEGER NOT NULL DEFAULT 0,
  last_used_at             TEXT,
  -- Replay-outcome write-back fields. All nullable because
  -- they are only populated once a replay (or a direct
  -- experience_score_step call) has run against the row.
  --   last_replay_at        : ISO 8601 timestamp the writer used.
  --   last_replay_outcome   : last ClickObservedOutcome recorded.
  --   last_replay_status    : projected {ok|failed} the writer
  --                           chose via isClickSuccessOutcome.
  --   composite_score_decayed : deterministic recency-decayed
  --                             composite score (see
  --                             composite-score.ts).
  last_replay_at           TEXT,
  last_replay_outcome      TEXT,
  last_replay_status       TEXT,
  composite_score_decayed  REAL,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS experience_action_paths_role_intent_idx
  ON experience_action_paths(page_role, intent_signature);
CREATE INDEX IF NOT EXISTS experience_action_paths_site_role_intent_idx
  ON experience_action_paths(site_family, page_role, intent_signature);
CREATE INDEX IF NOT EXISTS experience_action_paths_last_used_at_idx
  ON experience_action_paths(last_used_at);
-- Lets the chooser ORDER BY composite_score_decayed
-- without a full table scan. Partial index condition is safe under
-- SQLite; rows that have not been scored yet drop out of the index.
CREATE INDEX IF NOT EXISTS experience_action_paths_composite_score_idx
  ON experience_action_paths(composite_score_decayed)
  WHERE composite_score_decayed IS NOT NULL;
`;

/**
 * Knowledge schema (opt-in via TABRIX_POLICY_CAPABILITIES=api_knowledge).
 *
 * `knowledge_api_endpoints` is the storage side of "API Knowledge capture
 * v1": a deduplicated, redaction-only-metadata view of API endpoints that
 * Tabrix has observed traversing the user's browser tabs while a
 * `chrome_network_capture` session was active. It exists to power future
 * "skip the page, ask the API" decisions — never to replay or
 * call user APIs from the agent side.
 *
 * Hard rules baked into the schema:
 *  - `endpoint_signature` is a *normalized* `<METHOD> <host><path-template>`
 *    string; no query string, no path-id leakage. `(site, endpoint_signature)`
 *    is the dedup key (UNIQUE) so re-observing the same endpoint upserts
 *    sample_count + last_seen_at instead of growing unbounded rows.
 *  - `request_summary_blob` / `response_summary_blob` are JSON metadata
 *    only: header *names* (lower-cased), query *keys* (no values), body
 *    *keys* / shape, response content-type / size, and at most a small
 *    deterministic excerpt of the response shape. No raw header values,
 *    no Authorization, no Cookie, no body payloads.
 *  - `source_*` columns are informational pointers back into the current
 *    trace/object evidence surfaces.
 *
 * Idempotent CREATE: same pattern as `EXPERIENCE_CREATE_TABLES_SQL`.
 * Old DBs that pre-date this table simply
 * pick up the new table on next `openMemoryDb()`; no ALTER needed.
 */
export const KNOWLEDGE_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS knowledge_api_endpoints (
  endpoint_id            TEXT PRIMARY KEY,
  site                   TEXT NOT NULL,
  family                 TEXT NOT NULL,
  method                 TEXT NOT NULL,
  url_pattern            TEXT NOT NULL,
  endpoint_signature     TEXT NOT NULL,
  semantic_tag           TEXT,
  status_class           TEXT,
  request_summary_blob   TEXT NOT NULL,
  response_summary_blob  TEXT NOT NULL,
  source_session_id      TEXT,
  source_step_id         TEXT,
  source_history_ref     TEXT,
  sample_count           INTEGER NOT NULL DEFAULT 1,
  first_seen_at          TEXT NOT NULL,
  last_seen_at           TEXT NOT NULL,
  -- Generic classifier outputs persisted alongside the
  -- seed-derived semantic_tag. NULLABLE so legacy
  -- DBs and older callers stay valid; the classifier writer
  -- always populates them on new upserts.
  --   semantic_type: closed enum (search/list/detail/pagination/
  --     filter/mutation/asset/analytics/auth/private/telemetry/unknown).
  --   query_params_shape: deterministic CSV of sorted query *keys*
  --     (no values), e.g. order,q,sort.
  --   response_shape_summary: deterministic short string derived from
  --     the response shape descriptor, e.g. object:keys=3 /
  --     array:n=12,keys=4. Plain string, never raw body.
  --   usable_for_task: 0/1 -- classifier verdict on whether this row
  --     can plausibly serve a future on-demand reader call. Same
  --     value as the runtime usableForTask derivation but persisted
  --     so the chooser can score without re-running the classifier.
  --   noise_reason: structured reason, populated when usable_for_task=0.
  semantic_type            TEXT,
  query_params_shape       TEXT,
  response_shape_summary   TEXT,
  usable_for_task          INTEGER,
  noise_reason             TEXT,
  -- Additive lineage columns. NULLABLE so legacy DBs
  -- and older callers stay valid; the lineage writer sets them on
  -- new upserts. The migration helper
  -- ensureKnowledgeApiEndpointsLineageColumns() in client.ts stays in
  -- lockstep with this list 1:1.
  --
  --   endpoint_source: closed enum
  --     observed | seed_adapter | manual_seed | unknown | deprecated_seed
  --     NULL is treated as 'unknown' on read; rowToEndpoint() derives
  --     a back-compat value from the family column so legacy rows
  --     written with family='github' surface as seed_adapter and rows
  --     written with family='observed' surface as observed. The
  --     'deprecated_seed' value is the retirement-state writer's
  --     explicit way to express "this seed_adapter row has been
  --     superseded by an observed peer"; the seed row is NEVER deleted.
  --
  --   correlation_confidence: closed enum
  --     unknown_candidate | low_confidence | high_confidence
  --     the single-session correlator never writes high_confidence;
  --     multi-session escalation is the only writer that may.
  --
  --   correlated_region_id: brand-neutral region tag (e.g. main_list)
  --     when the correlator attributed the endpoint to a single DOM region.
  --
  --   confidence_reason: closed-enum-ish reason populated when the
  --     lookup downgrades / promotes a row.
  --
  --   retirement_candidate: 0/1. Set to 1 when an observed peer
  --     stably outperforms a seed_adapter peer for the same site +
  --     semantic type. The seed_adapter row is NEVER deleted.
  --
  --   source_lineage_blob: deterministic JSON. Carries the closed-enum
  --     lineage breadcrumb (e.g. semantic source: capture | classifier |
  --     correlator). NULL when the writer has no lineage to record.
  --
  --   schema_version: 1 = legacy row. 2 = lineage-aware row.
  --     Reader collapses NULL to 1 so legacy rows still report a
  --     concrete number.
  --
  --   last_failure_reason: closed-enum-ish reason recorded by the
  --     writer when the most recent upsert evidence carried
  --     a failure signal (timeout, 4xx/5xx status, semantic
  --     mismatch, shape drift, empty response, etc.). NULL when the
  --     writer has no failure evidence to record. The reader never
  --     invents a value here; absence is meaningful.
  endpoint_source          TEXT,
  correlation_confidence   TEXT,
  correlated_region_id     TEXT,
  confidence_reason        TEXT,
  retirement_candidate     INTEGER,
  source_lineage_blob      TEXT,
  schema_version           INTEGER,
  last_failure_reason      TEXT,
  UNIQUE (site, endpoint_signature)
);

CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_site_idx
  ON knowledge_api_endpoints(site);
CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_family_idx
  ON knowledge_api_endpoints(family);
CREATE INDEX IF NOT EXISTS knowledge_api_endpoints_last_seen_at_idx
  ON knowledge_api_endpoints(last_seen_at);
`;

/**
 * Telemetry schema for `tabrix_choose_context`.
 *
 * Two tables, both append-only:
 *  - `tabrix_choose_context_decisions` — one row per chooser invocation
 *    that returned `status='ok'`. Captures the resolved bucket
 *    (intent_signature / pageRole / siteFamily) plus the chosen
 *    strategy and fallback. Lets us answer "which strategy did the
 *    chooser pick last week?" without having to replay.
 *  - `tabrix_choose_context_outcomes` — one row per
 *    `tabrix_choose_context_record_outcome` call. Pure write-back.
 *    `decision_id` is a FK back to the decisions table so the
 *    aggregation script can compute reuse/fallback ratios per
 *    strategy.
 *
 * Both tables are gated by the same Memory persistence check the
 * rest of the native server uses; when persistence is `'off'` the
 * tables still exist (idempotent CREATE) but the chooser writer is a
 * no-op so we never silently grow the file in tests.
 *
 * No personally identifying info: `intent_signature` is normalized
 * and already pre-redacted, `page_role` is a structural label, and
 * `site_family` is a safe routing token. We do NOT
 * store the raw `intent` string to avoid leaking session content into
 * a long-horizon table.
 */
export const CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tabrix_choose_context_decisions (
  decision_id              TEXT PRIMARY KEY,
  intent_signature         TEXT NOT NULL,
  page_role                TEXT,
  site_family              TEXT,
  strategy                 TEXT NOT NULL,
  fallback_strategy        TEXT,
  created_at               TEXT NOT NULL,
  -- Layer-dispatch telemetry. All NULLABLE so legacy DBs and
  -- older callers stay valid. See
  -- docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md section 11 and the
  -- strategy table for value semantics. knowledge_endpoint_family
  -- is a derived telemetry-only label and MUST NOT drive any route.
  chosen_layer             TEXT,
  layer_dispatch_reason    TEXT,
  source_route             TEXT,
  fallback_cause           TEXT,
  token_estimate_chosen    INTEGER,
  token_estimate_full_read INTEGER,
  tokens_saved_estimate    INTEGER,
  knowledge_endpoint_family TEXT,
  -- Ranked-replay audit fields. Append-only; nullable for legacy rows.
  ranked_candidate_count       INTEGER,
  replay_eligible_blocked_by   TEXT,
  replay_fallback_depth        INTEGER,
  -- Honest dispatcher inputs.
  --   dispatcher_input_source is a closed enum:
  --     'live_snapshot' | 'memory_snapshot' | 'fallback_zero'
  --   fallback_cause_v26 is the structured reason for the
  --   'fallback_zero' branch:
  --     'persistence_off' | 'no_session_snapshots' |
  --     'no_task_snapshots' | 'provider_error'
  -- Intentionally distinct from the existing fallback_cause column
  -- (layer-dispatcher reason) so audits can replay both layers
  -- independently. Both NULLABLE so legacy rows + tests that
  -- pre-date these inputs stay valid.
  dispatcher_input_source      TEXT,
  fallback_cause_v26           TEXT
);

CREATE INDEX IF NOT EXISTS tabrix_choose_context_decisions_strategy_idx
  ON tabrix_choose_context_decisions(strategy);
CREATE INDEX IF NOT EXISTS tabrix_choose_context_decisions_created_at_idx
  ON tabrix_choose_context_decisions(created_at);

CREATE TABLE IF NOT EXISTS tabrix_choose_context_outcomes (
  outcome_id    TEXT PRIMARY KEY,
  decision_id   TEXT NOT NULL REFERENCES tabrix_choose_context_decisions(decision_id) ON DELETE CASCADE,
  outcome       TEXT NOT NULL,
  recorded_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tabrix_choose_context_outcomes_decision_id_idx
  ON tabrix_choose_context_outcomes(decision_id);
CREATE INDEX IF NOT EXISTS tabrix_choose_context_outcomes_recorded_at_idx
  ON tabrix_choose_context_outcomes(recorded_at);
`;

/**
 * Isolation telemetry — `experience_score_step` write-back warnings.
 *
 * Every row represents one Experience write-back attempt that the
 * runtime caught and isolated. The active writer is the per-step
 * `experience_score_step` MCP handler when counter-delta SQL throws.
 *
 * Hard rules baked into the schema:
 *  - Append-only — no UPDATE / DELETE in the writer; auditors rely on
 *    full row history.
 *  - `payload_blob` is small JSON (cap enforced at write time) so the
 *    table stays bounded even under bridge-flap conditions.
 *  - No FK to `experience_action_paths` because
 *    the warning has to outlive an aggressive Memory rotation.
 *  - The table exists regardless of capability state (idempotent
 *    CREATE) so a write that races a freshly-disabled persistence
 *    knob still has somewhere to land.
 */
export const EXPERIENCE_WRITEBACK_WARNINGS_CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS experience_writeback_warnings (
  warning_id        TEXT PRIMARY KEY,
  source            TEXT NOT NULL,            -- 'experience_score_step'
  action_path_id    TEXT,
  step_index        INTEGER,
  session_id        TEXT,
  replay_id         TEXT,
  observed_outcome  TEXT,
  error_code        TEXT,
  error_message     TEXT,
  payload_blob      TEXT,                     -- JSON: { historyRef?, evidence?, components? } — bounded
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS experience_writeback_warnings_source_idx
  ON experience_writeback_warnings(source);
CREATE INDEX IF NOT EXISTS experience_writeback_warnings_action_path_idx
  ON experience_writeback_warnings(action_path_id);
CREATE INDEX IF NOT EXISTS experience_writeback_warnings_created_at_idx
  ON experience_writeback_warnings(created_at);
`;

export const MEMORY_DB_ACTIVE_TABLE_MANIFEST = [
  {
    name: 'tabrix_memory_traces',
    layer: 'mke_memory',
    surface: 'mke_sidepanel',
    purpose: 'Redacted AI-to-Tabrix tool-call trace source for MKE projections.',
    retention: 'active',
  },
  {
    name: 'tabrix_knowledge_models',
    layer: 'mke_knowledge',
    surface: 'mke_sidepanel',
    purpose: 'Page/object knowledge model that must be derived from Object Library facts.',
    retention: 'projection_gap',
  },
  {
    name: 'tabrix_experience_recipes',
    layer: 'mke_experience',
    surface: 'mke_sidepanel',
    purpose: 'Template-only reusable recipe store derived from successful Memory evidence.',
    retention: 'projection_gap',
  },
  {
    name: 'tabrix_browser_objects',
    layer: 'object_library',
    surface: 'mke_sidepanel',
    purpose: 'Current browser window/tab/page-object fact layer for lifecycle-aware operation.',
    retention: 'active',
  },
  {
    name: 'experience_action_paths',
    layer: 'experience',
    surface: 'mcp_tools',
    purpose: 'Executable reusable action paths for suggest/replay/score tools.',
    retention: 'active',
  },
  {
    name: 'knowledge_api_endpoints',
    layer: 'knowledge',
    surface: 'mcp_routing',
    purpose: 'Redacted API endpoint catalogue for data-source routing decisions.',
    retention: 'active',
  },
  {
    name: 'tabrix_choose_context_decisions',
    layer: 'policy',
    surface: 'execution_insights',
    purpose: 'Chooser strategy decision telemetry for token-savings and routing audits.',
    retention: 'active',
  },
  {
    name: 'tabrix_choose_context_outcomes',
    layer: 'policy',
    surface: 'execution_insights',
    purpose: 'Chooser decision outcome write-back for reuse/fallback quality metrics.',
    retention: 'active',
  },
  {
    name: 'experience_writeback_warnings',
    layer: 'experience',
    surface: 'internal_diagnostics',
    purpose: 'Append-only isolation warnings for replay/composite-score write-back failures.',
    retention: 'visibility_gap',
  },
] as const;

export const MEMORY_DB_ACTIVE_TABLES = MEMORY_DB_ACTIVE_TABLE_MANIFEST.map((table) => table.name);

export const MEMORY_DB_RETIRED_TABLES = [
  {
    name: 'memory_tasks',
    retiredAt: '2026-06-11',
    reason:
      'Pre-launch task envelope table replaced by in-process execution context plus tabrix_memory_traces.',
  },
  {
    name: 'memory_sessions',
    retiredAt: '2026-06-11',
    reason:
      'Pre-launch session-history table replaced by tabrix_memory_traces; no legacy-user migration required before launch.',
  },
  {
    name: 'memory_steps',
    retiredAt: '2026-06-11',
    reason: 'Pre-launch ordered-step table replaced by append-only tabrix_memory_traces records.',
  },
  {
    name: 'memory_page_snapshots',
    retiredAt: '2026-06-11',
    reason:
      'Pre-launch page snapshot table replaced by Object Library facts and memory trace observation blobs.',
  },
  {
    name: 'memory_actions',
    retiredAt: '2026-06-11',
    reason:
      'Pre-launch action evidence table replaced by memory trace request/result evidence and future trace-derived experience mining.',
  },
  {
    name: 'operation_memory_logs',
    retiredAt: '2026-06-11',
    reason: 'Pre-launch operation-log table replaced by the richer tabrix_memory_traces schema.',
  },
  {
    name: 'experience_locator_prefs',
    retiredAt: '2026-06-11',
    reason:
      'Reserved locator-preference table had no production reader, writer, MCP API, or sidepanel surface.',
  },
] as const;
