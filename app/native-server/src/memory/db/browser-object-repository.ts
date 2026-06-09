import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from './client';

const DEFAULT_SCHEMA_VERSION = 1;
const DEFAULT_MODEL_VERSION = 1;
const DEFAULT_SITE_FAMILY = 'unknown';
const DEFAULT_PAGE_MODEL_KEY = 'unknown';
const MAX_TEXT_LENGTH = 512;
const MAX_ROUTE_LENGTH = 2048;
const MAX_BLOB_LENGTH = 8192;

export interface BrowserObjectInput {
  browserObjectId?: string;
  schemaVersion?: number;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
  rootRoute?: string | null;
  currentRoute?: string | null;
  pageRole?: string | null;
  pageModelKey?: string | null;
  objectFingerprint: string;
  objectType: string;
  parentObjectId?: string | null;
  modelVersion?: number;
  browserContextKey?: string | null;
  tabId?: number | null;
  windowId?: number | null;
  ownerType?: string | null;
  sourceRoute?: string | null;
  selectedDataSource?: string | null;
  sourceLineage?: unknown;
  sourceFreshness?: string | null;
  tabStatus?: string | null;
  lifecycleState?: string | null;
  isActive?: boolean | null;
  canTabrixOperate?: boolean | null;
  operabilityReason?: string | null;
  targetability?: unknown;
  facts?: unknown;
  actionTypes?: unknown;
  changedGroups?: unknown;
  primaryConclusion?: string | null;
  claimBoundary?: string | null;
  observationCount?: number | null;
  confidenceScore?: number | null;
  driftScore?: number | null;
  lastObservedAt?: string | null;
  lastValidatedAt?: string | null;
  firstTraceId?: string | null;
  lastTraceId?: string | null;
  sourceTraceIds?: string[];
  evidenceRefs?: unknown;
  redactionState?: string | null;
  currentState?: unknown;
  recentEvents?: unknown;
  createdAt?: string;
  updatedAt: string;
  closedAt?: string | null;
  archivedAt?: string | null;
}

export interface BrowserObject {
  browserObjectId: string;
  schemaVersion: number;
  siteFamily: string;
  pageUrlPattern: string | null;
  rootRoute: string | null;
  currentRoute: string | null;
  pageRole: string | null;
  pageModelKey: string;
  objectFingerprint: string;
  objectType: string;
  parentObjectId: string | null;
  modelVersion: number;
  browserContextKey: string | null;
  tabId: number | null;
  windowId: number | null;
  ownerType: string | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  sourceLineage: unknown;
  sourceFreshness: string | null;
  tabStatus: string | null;
  lifecycleState: string | null;
  isActive: boolean | null;
  canTabrixOperate: boolean | null;
  operabilityReason: string | null;
  targetability: unknown;
  facts: unknown;
  actionTypes: unknown;
  changedGroups: unknown;
  primaryConclusion: string | null;
  claimBoundary: string | null;
  observationCount: number;
  confidenceScore: number | null;
  driftScore: number | null;
  lastObservedAt: string | null;
  lastValidatedAt: string | null;
  firstTraceId: string | null;
  lastTraceId: string | null;
  sourceTraceIds: string[];
  evidenceRefs: unknown;
  redactionState: string;
  currentState: unknown;
  recentEvents: unknown;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  archivedAt: string | null;
}

interface BrowserObjectRow {
  browser_object_id: string;
  schema_version: number;
  site_family: string;
  page_url_pattern: string | null;
  root_route: string | null;
  current_route: string | null;
  page_role: string | null;
  page_model_key: string;
  object_fingerprint: string;
  object_type: string;
  parent_object_id: string | null;
  model_version: number;
  browser_context_key: string | null;
  tab_id: number | null;
  window_id: number | null;
  owner_type: string | null;
  source_route: string | null;
  selected_data_source: string | null;
  source_lineage_blob: string | null;
  source_freshness: string | null;
  tab_status: string | null;
  lifecycle_state: string | null;
  is_active: number | null;
  can_tabrix_operate: number | null;
  operability_reason: string | null;
  targetability_blob: string | null;
  facts_blob: string | null;
  action_types_blob: string | null;
  changed_groups_blob: string | null;
  primary_conclusion: string | null;
  claim_boundary: string | null;
  observation_count: number;
  confidence_score: number | null;
  drift_score: number | null;
  last_observed_at: string | null;
  last_validated_at: string | null;
  first_trace_id: string | null;
  last_trace_id: string | null;
  source_trace_ids_blob: string | null;
  evidence_refs_blob: string | null;
  redaction_state: string;
  current_state_blob: string | null;
  recent_events_blob: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  archived_at: string | null;
}

function text(value: string | null | undefined, fallback?: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return fallback ?? null;
  return trimmed.length > MAX_TEXT_LENGTH ? `${trimmed.slice(0, MAX_TEXT_LENGTH)}...` : trimmed;
}

function routeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ROUTE_LENGTH ? `${trimmed.slice(0, MAX_ROUTE_LENGTH)}...` : trimmed;
}

function integer(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : null;
}

function real(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: boolean | null | undefined): number | null {
  return typeof value === 'boolean' ? (value ? 1 : 0) : null;
}

function blob(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const serialized = JSON.stringify(value);
  return serialized.length > MAX_BLOB_LENGTH
    ? JSON.stringify({ truncated: true, prefix: serialized.slice(0, MAX_BLOB_LENGTH) })
    : serialized;
}

function parseBlob(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseStringArray(value: string | null): string[] {
  const parsed = parseBlob(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

function rowToBrowserObject(row: BrowserObjectRow): BrowserObject {
  return {
    browserObjectId: row.browser_object_id,
    schemaVersion: row.schema_version,
    siteFamily: row.site_family,
    pageUrlPattern: row.page_url_pattern,
    rootRoute: row.root_route,
    currentRoute: row.current_route,
    pageRole: row.page_role,
    pageModelKey: row.page_model_key,
    objectFingerprint: row.object_fingerprint,
    objectType: row.object_type,
    parentObjectId: row.parent_object_id,
    modelVersion: row.model_version,
    browserContextKey: row.browser_context_key,
    tabId: row.tab_id,
    windowId: row.window_id,
    ownerType: row.owner_type,
    sourceRoute: row.source_route,
    selectedDataSource: row.selected_data_source,
    sourceLineage: parseBlob(row.source_lineage_blob),
    sourceFreshness: row.source_freshness,
    tabStatus: row.tab_status,
    lifecycleState: row.lifecycle_state,
    isActive: row.is_active === null ? null : row.is_active === 1,
    canTabrixOperate: row.can_tabrix_operate === null ? null : row.can_tabrix_operate === 1,
    operabilityReason: row.operability_reason,
    targetability: parseBlob(row.targetability_blob),
    facts: parseBlob(row.facts_blob),
    actionTypes: parseBlob(row.action_types_blob),
    changedGroups: parseBlob(row.changed_groups_blob),
    primaryConclusion: row.primary_conclusion,
    claimBoundary: row.claim_boundary,
    observationCount: row.observation_count,
    confidenceScore: row.confidence_score,
    driftScore: row.drift_score,
    lastObservedAt: row.last_observed_at,
    lastValidatedAt: row.last_validated_at,
    firstTraceId: row.first_trace_id,
    lastTraceId: row.last_trace_id,
    sourceTraceIds: parseStringArray(row.source_trace_ids_blob),
    evidenceRefs: parseBlob(row.evidence_refs_blob),
    redactionState: row.redaction_state,
    currentState: parseBlob(row.current_state_blob),
    recentEvents: parseBlob(row.recent_events_blob),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    archivedAt: row.archived_at,
  };
}

export class BrowserObjectRepository {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly getByIdentityStmt;
  private readonly listRecentStmt;
  private readonly listCurrentBrowserSurfaceStmt;
  private readonly archiveStmt;
  private readonly countStmt;
  private readonly countCurrentBrowserSurfaceStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.upsertStmt = db.prepare(
      `INSERT INTO tabrix_browser_objects
        (browser_object_id, schema_version, site_family, page_url_pattern, root_route, current_route,
         page_role, page_model_key,
         object_fingerprint, object_type, parent_object_id, model_version, browser_context_key,
         tab_id, window_id, owner_type, source_route, selected_data_source, source_lineage_blob,
         source_freshness, tab_status, lifecycle_state, is_active, can_tabrix_operate,
         operability_reason, targetability_blob, facts_blob, action_types_blob, changed_groups_blob,
         primary_conclusion, claim_boundary, observation_count, confidence_score, drift_score,
         last_observed_at, last_validated_at, first_trace_id, last_trace_id, source_trace_ids_blob,
         evidence_refs_blob, redaction_state, current_state_blob, recent_events_blob, created_at,
         updated_at, closed_at, archived_at)
       VALUES
        (@browser_object_id, @schema_version, @site_family, @page_url_pattern, @root_route, @current_route,
         @page_role, @page_model_key,
         @object_fingerprint, @object_type, @parent_object_id, @model_version, @browser_context_key,
         @tab_id, @window_id, @owner_type, @source_route, @selected_data_source, @source_lineage_blob,
         @source_freshness, @tab_status, @lifecycle_state, @is_active, @can_tabrix_operate,
         @operability_reason, @targetability_blob, @facts_blob, @action_types_blob, @changed_groups_blob,
         @primary_conclusion, @claim_boundary, @observation_count, @confidence_score, @drift_score,
         @last_observed_at, @last_validated_at, @first_trace_id, @last_trace_id, @source_trace_ids_blob,
         @evidence_refs_blob, @redaction_state, @current_state_blob, @recent_events_blob, @created_at,
         @updated_at, @closed_at, @archived_at)
       ON CONFLICT(site_family, page_model_key, object_fingerprint, schema_version) DO UPDATE SET
         page_url_pattern = excluded.page_url_pattern,
         root_route = excluded.root_route,
         current_route = excluded.current_route,
         page_role = excluded.page_role,
         object_type = excluded.object_type,
         parent_object_id = excluded.parent_object_id,
         model_version = excluded.model_version,
         browser_context_key = excluded.browser_context_key,
         tab_id = excluded.tab_id,
         window_id = excluded.window_id,
         owner_type = excluded.owner_type,
         source_route = excluded.source_route,
         selected_data_source = excluded.selected_data_source,
         source_lineage_blob = excluded.source_lineage_blob,
         source_freshness = excluded.source_freshness,
         tab_status = excluded.tab_status,
         lifecycle_state = excluded.lifecycle_state,
         is_active = excluded.is_active,
         can_tabrix_operate = excluded.can_tabrix_operate,
         operability_reason = excluded.operability_reason,
         targetability_blob = excluded.targetability_blob,
         facts_blob = excluded.facts_blob,
         action_types_blob = excluded.action_types_blob,
         changed_groups_blob = excluded.changed_groups_blob,
         primary_conclusion = excluded.primary_conclusion,
         claim_boundary = excluded.claim_boundary,
         observation_count = tabrix_browser_objects.observation_count + 1,
         confidence_score = excluded.confidence_score,
         drift_score = excluded.drift_score,
         last_observed_at = excluded.last_observed_at,
         last_validated_at = excluded.last_validated_at,
         last_trace_id = excluded.last_trace_id,
         source_trace_ids_blob = excluded.source_trace_ids_blob,
         evidence_refs_blob = excluded.evidence_refs_blob,
         redaction_state = excluded.redaction_state,
         current_state_blob = excluded.current_state_blob,
         recent_events_blob = excluded.recent_events_blob,
         updated_at = excluded.updated_at,
         closed_at = excluded.closed_at,
         archived_at = excluded.archived_at`,
    );
    this.getStmt = db.prepare('SELECT * FROM tabrix_browser_objects WHERE browser_object_id = ?');
    this.getByIdentityStmt = db.prepare(
      `SELECT * FROM tabrix_browser_objects
        WHERE site_family = ? AND page_model_key = ? AND object_fingerprint = ? AND schema_version = ?`,
    );
    this.listRecentStmt = db.prepare(
      `SELECT * FROM tabrix_browser_objects
        WHERE archived_at IS NULL
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ? OFFSET ?`,
    );
    this.listCurrentBrowserSurfaceStmt = db.prepare(
      `SELECT * FROM tabrix_browser_objects
        WHERE archived_at IS NULL
          AND closed_at IS NULL
          AND object_type IN ('window', 'tab')
          AND COALESCE(lifecycle_state, '') NOT IN ('closed', 'removed')
          AND source_route = 'chrome_windows_get_all_with_browser_world_inventory'
          AND updated_at = (
            SELECT MAX(updated_at) FROM tabrix_browser_objects
              WHERE archived_at IS NULL
                AND closed_at IS NULL
                AND object_type IN ('window', 'tab')
                AND COALESCE(lifecycle_state, '') NOT IN ('closed', 'removed')
                AND source_route = 'chrome_windows_get_all_with_browser_world_inventory'
          )
        ORDER BY is_active DESC, updated_at DESC, created_at DESC
        LIMIT ? OFFSET ?`,
    );
    this.archiveStmt = db.prepare(
      'UPDATE tabrix_browser_objects SET archived_at = ?, updated_at = ? WHERE browser_object_id = ?',
    );
    this.countStmt = db.prepare(
      'SELECT COUNT(*) AS count FROM tabrix_browser_objects WHERE archived_at IS NULL',
    );
    this.countCurrentBrowserSurfaceStmt = db.prepare(
      `SELECT COUNT(*) AS count FROM tabrix_browser_objects
        WHERE archived_at IS NULL
          AND closed_at IS NULL
          AND object_type IN ('window', 'tab')
          AND COALESCE(lifecycle_state, '') NOT IN ('closed', 'removed')
          AND source_route = 'chrome_windows_get_all_with_browser_world_inventory'
          AND updated_at = (
            SELECT MAX(updated_at) FROM tabrix_browser_objects
              WHERE archived_at IS NULL
                AND closed_at IS NULL
                AND object_type IN ('window', 'tab')
                AND COALESCE(lifecycle_state, '') NOT IN ('closed', 'removed')
                AND source_route = 'chrome_windows_get_all_with_browser_world_inventory'
          )`,
    );
    this.clearStmt = db.prepare('DELETE FROM tabrix_browser_objects');
  }

  public upsert(input: BrowserObjectInput): BrowserObject {
    const schemaVersion = integer(input.schemaVersion) ?? DEFAULT_SCHEMA_VERSION;
    const siteFamily = text(input.siteFamily, DEFAULT_SITE_FAMILY) ?? DEFAULT_SITE_FAMILY;
    const pageModelKey = text(input.pageModelKey, DEFAULT_PAGE_MODEL_KEY) ?? DEFAULT_PAGE_MODEL_KEY;
    const row = {
      browser_object_id: input.browserObjectId ?? randomUUID(),
      schema_version: schemaVersion,
      site_family: siteFamily,
      page_url_pattern: text(input.pageUrlPattern),
      root_route: routeText(input.rootRoute ?? input.pageUrlPattern),
      current_route: routeText(input.currentRoute),
      page_role: text(input.pageRole),
      page_model_key: pageModelKey,
      object_fingerprint: text(input.objectFingerprint, 'unknown') ?? 'unknown',
      object_type: text(input.objectType, 'unknown') ?? 'unknown',
      parent_object_id: text(input.parentObjectId),
      model_version: integer(input.modelVersion) ?? DEFAULT_MODEL_VERSION,
      browser_context_key: text(input.browserContextKey),
      tab_id: integer(input.tabId),
      window_id: integer(input.windowId),
      owner_type: text(input.ownerType),
      source_route: text(input.sourceRoute),
      selected_data_source: text(input.selectedDataSource),
      source_lineage_blob: blob(input.sourceLineage),
      source_freshness: text(input.sourceFreshness),
      tab_status: text(input.tabStatus),
      lifecycle_state: text(input.lifecycleState),
      is_active: bool(input.isActive),
      can_tabrix_operate: bool(input.canTabrixOperate),
      operability_reason: text(input.operabilityReason),
      targetability_blob: blob(input.targetability),
      facts_blob: blob(input.facts),
      action_types_blob: blob(input.actionTypes),
      changed_groups_blob: blob(input.changedGroups),
      primary_conclusion: text(input.primaryConclusion),
      claim_boundary: text(input.claimBoundary),
      observation_count: integer(input.observationCount) ?? 1,
      confidence_score: real(input.confidenceScore),
      drift_score: real(input.driftScore),
      last_observed_at: input.lastObservedAt ?? input.updatedAt,
      last_validated_at: input.lastValidatedAt ?? null,
      first_trace_id: text(input.firstTraceId ?? input.lastTraceId),
      last_trace_id: text(input.lastTraceId),
      source_trace_ids_blob: blob(input.sourceTraceIds ?? []),
      evidence_refs_blob: blob(input.evidenceRefs),
      redaction_state: text(input.redactionState, 'redacted') ?? 'redacted',
      current_state_blob: blob(input.currentState),
      recent_events_blob: blob(input.recentEvents),
      created_at: input.createdAt ?? input.updatedAt,
      updated_at: input.updatedAt,
      closed_at: input.closedAt ?? null,
      archived_at: input.archivedAt ?? null,
    };
    this.upsertStmt.run(row);
    return (
      this.getByIdentity({
        siteFamily,
        pageModelKey,
        objectFingerprint: row.object_fingerprint,
        schemaVersion,
      }) ?? rowToBrowserObject(row)
    );
  }

  public get(browserObjectId: string): BrowserObject | undefined {
    const row = this.getStmt.get(browserObjectId) as BrowserObjectRow | undefined;
    return row ? rowToBrowserObject(row) : undefined;
  }

  public getByIdentity(input: {
    siteFamily: string;
    pageModelKey: string;
    objectFingerprint: string;
    schemaVersion?: number;
  }): BrowserObject | undefined {
    const row = this.getByIdentityStmt.get(
      input.siteFamily,
      input.pageModelKey,
      input.objectFingerprint,
      input.schemaVersion ?? DEFAULT_SCHEMA_VERSION,
    ) as BrowserObjectRow | undefined;
    return row ? rowToBrowserObject(row) : undefined;
  }

  public listRecent(input?: { limit?: number; offset?: number }): BrowserObject[] {
    return (
      this.listRecentStmt.all(input?.limit ?? 20, input?.offset ?? 0) as BrowserObjectRow[]
    ).map(rowToBrowserObject);
  }

  public listCurrentBrowserSurface(input?: { limit?: number; offset?: number }): BrowserObject[] {
    return (
      this.listCurrentBrowserSurfaceStmt.all(
        input?.limit ?? 20,
        input?.offset ?? 0,
      ) as BrowserObjectRow[]
    ).map(rowToBrowserObject);
  }

  public archive(input: { browserObjectId: string; archivedAt: string }): void {
    this.archiveStmt.run(input.archivedAt, input.archivedAt, input.browserObjectId);
  }

  public count(): number {
    const row = this.countStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public countCurrentBrowserSurface(): number {
    const row = this.countCurrentBrowserSurfaceStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
