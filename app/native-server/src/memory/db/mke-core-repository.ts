import { randomUUID } from 'node:crypto';

import type { SqliteDatabase } from './client';

function optionalInteger(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value as number));
}

function optionalNumber(value: number | null | undefined): number | null {
  return Number.isFinite(value) ? (value as number) : null;
}

function blob(value: unknown | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function requiredBlob(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseBlob<T = unknown>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export type BusinessSuccessVerdict = 'true' | 'false' | 'unknown' | string;

export interface MemoryTraceInsert {
  traceId?: string;
  taskId: string;
  taskTheme?: string | null;
  taskIntent?: string | null;
  taskSignature?: string | null;
  aiClient?: string | null;
  toolName: string;
  toolCallId?: string | null;
  sequenceIndex?: number | null;
  requestParams: unknown;
  requestAt: string;
  response: unknown;
  responseAt: string;
  durationMs?: number | null;
  toolSuccess?: boolean | null;
  businessSuccess?: BusinessSuccessVerdict | null;
  resultSummary?: string | null;
  errorCode?: string | null;
  tabId?: number | null;
  windowId?: number | null;
  browserContextKey?: string | null;
  tabLifecycle?: unknown;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
  pageRole?: string | null;
  pageState?: string | null;
  pageModelKey?: string | null;
  perceptionObjects?: unknown;
  actionTarget?: unknown;
  preObservation?: unknown;
  postObservation?: unknown;
  postActionDelta?: unknown;
  sourceRoute?: string | null;
  selectedDataSource?: string | null;
  freshness?: string | null;
  fallbackUsed?: string | null;
  nextRequiredCheck?: string | null;
  tokenPrompt?: number | null;
  tokenCompletion?: number | null;
  tokenTotal?: number | null;
  aiFeedbackScore?: number | null;
  aiFeedback?: unknown;
  systemEvidenceScore?: number | null;
  systemEvidence?: unknown;
  redactionState?: string;
  createdAt: string;
}

export interface MemoryTrace {
  traceId: string;
  taskId: string;
  taskTheme: string | null;
  taskIntent: string | null;
  taskSignature: string | null;
  aiClient: string | null;
  toolName: string;
  toolCallId: string | null;
  sequenceIndex: number | null;
  requestParams: unknown;
  requestAt: string;
  response: unknown;
  responseAt: string;
  durationMs: number | null;
  toolSuccess: boolean | null;
  businessSuccess: string | null;
  resultSummary: string | null;
  errorCode: string | null;
  tabId: number | null;
  windowId: number | null;
  browserContextKey: string | null;
  tabLifecycle: unknown | null;
  siteFamily: string | null;
  pageUrlPattern: string | null;
  pageRole: string | null;
  pageState: string | null;
  pageModelKey: string | null;
  perceptionObjects: unknown | null;
  actionTarget: unknown | null;
  preObservation: unknown | null;
  postObservation: unknown | null;
  postActionDelta: unknown | null;
  sourceRoute: string | null;
  selectedDataSource: string | null;
  freshness: string | null;
  fallbackUsed: string | null;
  nextRequiredCheck: string | null;
  tokenPrompt: number | null;
  tokenCompletion: number | null;
  tokenTotal: number | null;
  aiFeedbackScore: number | null;
  aiFeedback: unknown | null;
  systemEvidenceScore: number | null;
  systemEvidence: unknown | null;
  redactionState: string;
  createdAt: string;
}

export interface MemoryTraceAiFeedbackUpdate {
  traceId: string;
  aiFeedbackScore?: number | null;
  aiFeedback?: unknown;
}

interface MemoryTraceRow {
  trace_id: string;
  task_id: string;
  task_theme: string | null;
  task_intent: string | null;
  task_signature: string | null;
  ai_client: string | null;
  tool_name: string;
  tool_call_id: string | null;
  sequence_index: number | null;
  request_params_blob: string;
  request_at: string;
  response_blob: string;
  response_at: string;
  duration_ms: number | null;
  tool_success: number | null;
  business_success: string | null;
  result_summary: string | null;
  error_code: string | null;
  tab_id: number | null;
  window_id: number | null;
  browser_context_key: string | null;
  tab_lifecycle_blob: string | null;
  site_family: string | null;
  page_url_pattern: string | null;
  page_role: string | null;
  page_state: string | null;
  page_model_key: string | null;
  perception_objects_blob: string | null;
  action_target_blob: string | null;
  pre_observation_blob: string | null;
  post_observation_blob: string | null;
  post_action_delta_blob: string | null;
  source_route: string | null;
  selected_data_source: string | null;
  freshness: string | null;
  fallback_used: string | null;
  next_required_check: string | null;
  token_prompt: number | null;
  token_completion: number | null;
  token_total: number | null;
  ai_feedback_score: number | null;
  ai_feedback_blob: string | null;
  system_evidence_score: number | null;
  system_evidence_blob: string | null;
  redaction_state: string;
  created_at: string;
}

interface AutomaticEvidenceFeedback {
  score: number;
  feedback: Record<string, unknown>;
}

function buildAutomaticEvidenceFeedback(row: MemoryTraceRow): AutomaticEvidenceFeedback | null {
  if (row.ai_feedback_score !== null || row.ai_feedback_blob !== null) return null;

  const toolSuccess = row.tool_success === null ? null : row.tool_success === 1;
  let score: number | null = null;
  let businessStatus = row.business_success ?? 'unknown';
  let reasonCode = 'tool_result_unscored';
  let summary = '历史工具调用缺少AI评分，系统按已有执行证据补充了低置信评价。';

  if (toolSuccess === false) {
    score = 0;
    businessStatus = 'not_achieved';
    reasonCode = row.error_code ?? 'tool_failed';
    summary = '工具调用失败，不能沉淀为成功经验。';
  } else if (
    row.business_success === 'achieved' ||
    row.business_success === 'proven' ||
    row.business_success === 'true'
  ) {
    score = 0.9;
    businessStatus = 'achieved';
    reasonCode = 'tabrix_business_success_evidence';
    summary = 'Tabrix结果中已有业务成功证据，可作为经验候选。';
  } else if (row.business_success === 'partial') {
    score = 0.6;
    businessStatus = 'partial';
    reasonCode = 'tabrix_partial_business_evidence';
    summary = 'Tabrix结果只证明部分进展，需要后续确认后才可沉淀为经验。';
  } else if (
    row.business_success === 'not_achieved' ||
    row.business_success === 'failed' ||
    row.business_success === 'false'
  ) {
    score = 0.15;
    businessStatus = 'not_achieved';
    reasonCode = 'tabrix_business_not_achieved';
    summary = 'Tabrix结果显示业务目标未达成，不能沉淀为成功经验。';
  } else if (toolSuccess === true) {
    score = 0.45;
    businessStatus = 'unknown';
    reasonCode = 'tool_completed_business_unknown';
    summary = '工具调用已记录，但当前结果没有足够业务成功证据，需后续读取或AI评价确认。';
  }

  if (score === null) return null;

  return {
    score,
    feedback: {
      sourceKind: 'tabrix_auto_evidence',
      businessStatus,
      confidence: score,
      reasonCode,
      summary,
      resultSummary: row.result_summary,
      receivedAt: row.response_at || row.created_at,
      sourceToolName: row.tool_name,
      sourceToolCallId: row.tool_call_id,
    },
  };
}

function rowToMemoryTrace(row: MemoryTraceRow): MemoryTrace {
  const storedAiFeedback = parseBlob(row.ai_feedback_blob);
  const storedAiFeedbackRecord = asRecord(storedAiFeedback);
  const legacyAutomaticFeedback =
    storedAiFeedbackRecord?.sourceKind === 'tabrix_auto_evidence'
      ? {
          score: row.ai_feedback_score,
          feedback: storedAiFeedback,
        }
      : null;
  const automaticFeedback = buildAutomaticEvidenceFeedback(row);
  const systemEvidence =
    parseBlob(row.system_evidence_blob) ??
    legacyAutomaticFeedback?.feedback ??
    automaticFeedback?.feedback ??
    null;
  const systemEvidenceScore =
    row.system_evidence_score ?? legacyAutomaticFeedback?.score ?? automaticFeedback?.score ?? null;
  return {
    traceId: row.trace_id,
    taskId: row.task_id,
    taskTheme: row.task_theme,
    taskIntent: row.task_intent,
    taskSignature: row.task_signature,
    aiClient: row.ai_client,
    toolName: row.tool_name,
    toolCallId: row.tool_call_id,
    sequenceIndex: row.sequence_index,
    requestParams: parseBlob(row.request_params_blob),
    requestAt: row.request_at,
    response: parseBlob(row.response_blob),
    responseAt: row.response_at,
    durationMs: row.duration_ms,
    toolSuccess: row.tool_success === null ? null : row.tool_success === 1,
    businessSuccess: row.business_success,
    resultSummary: row.result_summary,
    errorCode: row.error_code,
    tabId: row.tab_id,
    windowId: row.window_id,
    browserContextKey: row.browser_context_key,
    tabLifecycle: parseBlob(row.tab_lifecycle_blob),
    siteFamily: row.site_family,
    pageUrlPattern: row.page_url_pattern,
    pageRole: row.page_role,
    pageState: row.page_state,
    pageModelKey: row.page_model_key,
    perceptionObjects: parseBlob(row.perception_objects_blob),
    actionTarget: parseBlob(row.action_target_blob),
    preObservation: parseBlob(row.pre_observation_blob),
    postObservation: parseBlob(row.post_observation_blob),
    postActionDelta: parseBlob(row.post_action_delta_blob),
    sourceRoute: row.source_route,
    selectedDataSource: row.selected_data_source,
    freshness: row.freshness,
    fallbackUsed: row.fallback_used,
    nextRequiredCheck: row.next_required_check,
    tokenPrompt: row.token_prompt,
    tokenCompletion: row.token_completion,
    tokenTotal: row.token_total,
    aiFeedbackScore: legacyAutomaticFeedback ? null : row.ai_feedback_score,
    aiFeedback: legacyAutomaticFeedback ? null : storedAiFeedback,
    systemEvidenceScore,
    systemEvidence,
    redactionState: row.redaction_state,
    createdAt: row.created_at,
  };
}

export class MemoryTraceRepository {
  private readonly insertStmt;
  private readonly updateAiFeedbackStmt;
  private readonly getStmt;
  private readonly listRecentStmt;
  private readonly listByTaskStmt;
  private readonly listByPageStmt;
  private readonly listAfterStmt;
  private readonly countStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO tabrix_memory_traces
        (trace_id, task_id, task_theme, task_intent, task_signature, ai_client,
         tool_name, tool_call_id, sequence_index, request_params_blob, request_at,
         response_blob, response_at, duration_ms, tool_success, business_success,
         result_summary, error_code, tab_id, window_id, browser_context_key,
         tab_lifecycle_blob, site_family, page_url_pattern, page_role, page_state,
         page_model_key, perception_objects_blob, action_target_blob,
         pre_observation_blob, post_observation_blob, post_action_delta_blob,
          source_route, selected_data_source, freshness, fallback_used,
          next_required_check, token_prompt, token_completion, token_total,
          ai_feedback_score, ai_feedback_blob, system_evidence_score, system_evidence_blob,
          redaction_state, created_at)
       VALUES
        (@trace_id, @task_id, @task_theme, @task_intent, @task_signature, @ai_client,
         @tool_name, @tool_call_id, @sequence_index, @request_params_blob, @request_at,
         @response_blob, @response_at, @duration_ms, @tool_success, @business_success,
         @result_summary, @error_code, @tab_id, @window_id, @browser_context_key,
         @tab_lifecycle_blob, @site_family, @page_url_pattern, @page_role, @page_state,
         @page_model_key, @perception_objects_blob, @action_target_blob,
         @pre_observation_blob, @post_observation_blob, @post_action_delta_blob,
          @source_route, @selected_data_source, @freshness, @fallback_used,
          @next_required_check, @token_prompt, @token_completion, @token_total,
          @ai_feedback_score, @ai_feedback_blob, @system_evidence_score, @system_evidence_blob,
          @redaction_state, @created_at)`,
    );
    this.updateAiFeedbackStmt = db.prepare(
      `UPDATE tabrix_memory_traces
       SET ai_feedback_score = @ai_feedback_score,
           ai_feedback_blob = @ai_feedback_blob
       WHERE trace_id = @trace_id`,
    );
    this.getStmt = db.prepare('SELECT * FROM tabrix_memory_traces WHERE trace_id = ?');
    this.listRecentStmt = db.prepare(
      `SELECT * FROM tabrix_memory_traces
        ORDER BY created_at DESC, sequence_index DESC
        LIMIT ? OFFSET ?`,
    );
    this.listByTaskStmt = db.prepare(
      'SELECT * FROM tabrix_memory_traces WHERE task_id = ? ORDER BY created_at ASC, sequence_index ASC',
    );
    this.listByPageStmt = db.prepare(
      `SELECT * FROM tabrix_memory_traces
        WHERE site_family = ? AND page_model_key = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    );
    this.listAfterStmt = db.prepare(
      `SELECT * FROM tabrix_memory_traces
        WHERE created_at > ?
        ORDER BY created_at ASC, sequence_index ASC
        LIMIT ?`,
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS count FROM tabrix_memory_traces');
    this.clearStmt = db.prepare('DELETE FROM tabrix_memory_traces');
  }

  public append(input: MemoryTraceInsert): MemoryTrace {
    const row = {
      trace_id: input.traceId ?? randomUUID(),
      task_id: input.taskId,
      task_theme: input.taskTheme ?? null,
      task_intent: input.taskIntent ?? null,
      task_signature: input.taskSignature ?? null,
      ai_client: input.aiClient ?? null,
      tool_name: input.toolName,
      tool_call_id: input.toolCallId ?? null,
      sequence_index: optionalInteger(input.sequenceIndex),
      request_params_blob: requiredBlob(input.requestParams),
      request_at: input.requestAt,
      response_blob: requiredBlob(input.response),
      response_at: input.responseAt,
      duration_ms: optionalInteger(input.durationMs),
      tool_success:
        input.toolSuccess === undefined || input.toolSuccess === null
          ? null
          : input.toolSuccess
            ? 1
            : 0,
      business_success: input.businessSuccess ?? null,
      result_summary: input.resultSummary ?? null,
      error_code: input.errorCode ?? null,
      tab_id: optionalInteger(input.tabId),
      window_id: optionalInteger(input.windowId),
      browser_context_key: input.browserContextKey ?? null,
      tab_lifecycle_blob: blob(input.tabLifecycle),
      site_family: input.siteFamily ?? null,
      page_url_pattern: input.pageUrlPattern ?? null,
      page_role: input.pageRole ?? null,
      page_state: input.pageState ?? null,
      page_model_key: input.pageModelKey ?? null,
      perception_objects_blob: blob(input.perceptionObjects),
      action_target_blob: blob(input.actionTarget),
      pre_observation_blob: blob(input.preObservation),
      post_observation_blob: blob(input.postObservation),
      post_action_delta_blob: blob(input.postActionDelta),
      source_route: input.sourceRoute ?? null,
      selected_data_source: input.selectedDataSource ?? null,
      freshness: input.freshness ?? null,
      fallback_used: input.fallbackUsed ?? null,
      next_required_check: input.nextRequiredCheck ?? null,
      token_prompt: optionalInteger(input.tokenPrompt),
      token_completion: optionalInteger(input.tokenCompletion),
      token_total: optionalInteger(input.tokenTotal),
      ai_feedback_score: optionalNumber(input.aiFeedbackScore),
      ai_feedback_blob: blob(input.aiFeedback),
      system_evidence_score: optionalNumber(input.systemEvidenceScore),
      system_evidence_blob: blob(input.systemEvidence),
      redaction_state: input.redactionState ?? 'redacted',
      created_at: input.createdAt,
    };
    this.insertStmt.run(row);
    return rowToMemoryTrace(row);
  }

  public updateAiFeedback(input: MemoryTraceAiFeedbackUpdate): MemoryTrace | undefined {
    this.updateAiFeedbackStmt.run({
      trace_id: input.traceId,
      ai_feedback_score: optionalNumber(input.aiFeedbackScore),
      ai_feedback_blob: blob(input.aiFeedback),
    });
    return this.get(input.traceId);
  }

  public get(traceId: string): MemoryTrace | undefined {
    const row = this.getStmt.get(traceId) as MemoryTraceRow | undefined;
    return row ? rowToMemoryTrace(row) : undefined;
  }

  public listRecent(input?: { limit?: number; offset?: number }): MemoryTrace[] {
    return (
      this.listRecentStmt.all(input?.limit ?? 20, input?.offset ?? 0) as MemoryTraceRow[]
    ).map(rowToMemoryTrace);
  }

  public listByTask(taskId: string): MemoryTrace[] {
    return (this.listByTaskStmt.all(taskId) as MemoryTraceRow[]).map(rowToMemoryTrace);
  }

  public listByPage(input: {
    siteFamily: string;
    pageModelKey: string;
    limit?: number;
  }): MemoryTrace[] {
    return (
      this.listByPageStmt.all(
        input.siteFamily,
        input.pageModelKey,
        input.limit ?? 20,
      ) as MemoryTraceRow[]
    ).map(rowToMemoryTrace);
  }

  public listAfter(input?: { cursorCreatedAt?: string | null; limit?: number }): MemoryTrace[] {
    return (
      this.listAfterStmt.all(input?.cursorCreatedAt ?? '', input?.limit ?? 100) as MemoryTraceRow[]
    ).map(rowToMemoryTrace);
  }

  public count(): number {
    const row = this.countStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}

export interface KnowledgeModelInput {
  knowledgeId?: string;
  siteFamily: string;
  pageUrlPattern?: string | null;
  pageRole: string;
  pageModelKey: string;
  modelVersion?: number;
  pageStateModel: unknown;
  objectGraph: unknown;
  actionSurface: unknown;
  dataSourceModel?: unknown;
  navigationModel?: unknown;
  failureSignal?: unknown;
  sourceTraceIds?: string[];
  sourceExperienceIds?: string[];
  observationCount?: number;
  successfulUseCount?: number;
  failedUseCount?: number;
  confidenceScore?: number;
  driftScore?: number | null;
  archivedAt?: string | null;
  lastObservedAt?: string | null;
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeModel extends Required<
  Omit<
    KnowledgeModelInput,
    | 'knowledgeId'
    | 'modelVersion'
    | 'pageUrlPattern'
    | 'dataSourceModel'
    | 'navigationModel'
    | 'failureSignal'
    | 'sourceTraceIds'
    | 'sourceExperienceIds'
    | 'driftScore'
    | 'archivedAt'
    | 'lastObservedAt'
    | 'lastValidatedAt'
  >
> {
  knowledgeId: string;
  modelVersion: number;
  pageUrlPattern: string | null;
  dataSourceModel: unknown | null;
  navigationModel: unknown | null;
  failureSignal: unknown | null;
  sourceTraceIds: string[];
  sourceExperienceIds: string[];
  driftScore: number | null;
  archivedAt: string | null;
  lastObservedAt: string | null;
  lastValidatedAt: string | null;
}

interface KnowledgeModelRow {
  knowledge_id: string;
  site_family: string;
  page_url_pattern: string | null;
  page_role: string;
  page_model_key: string;
  model_version: number;
  page_state_model_blob: string;
  object_graph_blob: string;
  action_surface_blob: string;
  data_source_model_blob: string | null;
  navigation_model_blob: string | null;
  failure_signal_blob: string | null;
  source_trace_ids_blob: string | null;
  source_experience_ids_blob: string | null;
  observation_count: number;
  successful_use_count: number;
  failed_use_count: number;
  confidence_score: number;
  drift_score: number | null;
  archived_at: string | null;
  last_observed_at: string | null;
  last_validated_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseStringArray(value: string | null): string[] {
  const parsed = parseBlob<unknown>(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === 'string')
    : [];
}

const EXPERIENCE_TEMPLATE_ONLY_REDACTION_STATE = 'template_only';

const EXPERIENCE_FORBIDDEN_RAW_KEYS = new Set([
  'account',
  'authorization',
  'captcha',
  'code',
  'cookie',
  'cookies',
  'credential',
  'credentials',
  'email',
  'formvalue',
  'formvalues',
  'otp',
  'password',
  'phone',
  'raw',
  'rawbody',
  'rawinput',
  'rawvalue',
  'secret',
  'session',
  'sessionid',
  'smscode',
  'submittedvalue',
  'submittedvalues',
  'token',
  'username',
  'verificationcode',
  '验证码',
  '账号',
  '手机号',
  '密码',
]);

function normalizeExperienceTemplateKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase();
}

function assertNoRawExperienceTemplateFields(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawExperienceTemplateFields(item, `${path}[${index}]`));
    return;
  }
  if (typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeExperienceTemplateKey(key);
    if (EXPERIENCE_FORBIDDEN_RAW_KEYS.has(normalizedKey)) {
      throw new Error(
        `TABRIX_EXPERIENCE_TEMPLATE_ONLY: raw-sensitive field is not allowed in Experience recipe (${path}.${key})`,
      );
    }
    assertNoRawExperienceTemplateFields(child, `${path}.${key}`);
  }
}

function assertExperienceTemplateOnly(input: ExperienceRecipeInput): void {
  const redactionState = input.redactionState ?? EXPERIENCE_TEMPLATE_ONLY_REDACTION_STATE;
  if (redactionState !== EXPERIENCE_TEMPLATE_ONLY_REDACTION_STATE) {
    throw new Error(
      `TABRIX_EXPERIENCE_TEMPLATE_ONLY: Experience recipes must be template-only, got redactionState=${redactionState}`,
    );
  }

  assertNoRawExperienceTemplateFields(input.preconditions, 'preconditions');
  assertNoRawExperienceTemplateFields(input.variableSchema, 'variableSchema');
  assertNoRawExperienceTemplateFields(input.steps, 'steps');
  assertNoRawExperienceTemplateFields(input.successCheck, 'successCheck');
  assertNoRawExperienceTemplateFields(input.recovery, 'recovery');
  assertNoRawExperienceTemplateFields(input.compatibility, 'compatibility');
}

function rowToKnowledgeModel(row: KnowledgeModelRow): KnowledgeModel {
  return {
    knowledgeId: row.knowledge_id,
    siteFamily: row.site_family,
    pageUrlPattern: row.page_url_pattern,
    pageRole: row.page_role,
    pageModelKey: row.page_model_key,
    modelVersion: row.model_version,
    pageStateModel: parseBlob(row.page_state_model_blob),
    objectGraph: parseBlob(row.object_graph_blob),
    actionSurface: parseBlob(row.action_surface_blob),
    dataSourceModel: parseBlob(row.data_source_model_blob),
    navigationModel: parseBlob(row.navigation_model_blob),
    failureSignal: parseBlob(row.failure_signal_blob),
    sourceTraceIds: parseStringArray(row.source_trace_ids_blob),
    sourceExperienceIds: parseStringArray(row.source_experience_ids_blob),
    observationCount: row.observation_count,
    successfulUseCount: row.successful_use_count,
    failedUseCount: row.failed_use_count,
    confidenceScore: row.confidence_score,
    driftScore: row.drift_score,
    archivedAt: row.archived_at,
    lastObservedAt: row.last_observed_at,
    lastValidatedAt: row.last_validated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KnowledgeModelRepository {
  private readonly upsertStmt;
  private readonly getStmt;
  private readonly listRecentStmt;
  private readonly getByIdentityStmt;
  private readonly findLatestByPageStmt;
  private readonly markValidatedStmt;
  private readonly countStmt;
  private readonly archiveStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.upsertStmt = db.prepare(
      `INSERT INTO tabrix_knowledge_models
        (knowledge_id, site_family, page_url_pattern, page_role, page_model_key, model_version,
         page_state_model_blob, object_graph_blob, action_surface_blob, data_source_model_blob,
         navigation_model_blob, failure_signal_blob, source_trace_ids_blob, source_experience_ids_blob,
         observation_count, successful_use_count, failed_use_count, confidence_score, drift_score,
         archived_at, last_observed_at, last_validated_at, created_at, updated_at)
       VALUES
        (@knowledge_id, @site_family, @page_url_pattern, @page_role, @page_model_key, @model_version,
         @page_state_model_blob, @object_graph_blob, @action_surface_blob, @data_source_model_blob,
         @navigation_model_blob, @failure_signal_blob, @source_trace_ids_blob, @source_experience_ids_blob,
         @observation_count, @successful_use_count, @failed_use_count, @confidence_score, @drift_score,
         @archived_at, @last_observed_at, @last_validated_at, @created_at, @updated_at)
       ON CONFLICT(site_family, page_model_key, model_version) DO UPDATE SET
         page_url_pattern = excluded.page_url_pattern,
         page_role = excluded.page_role,
         page_state_model_blob = excluded.page_state_model_blob,
         object_graph_blob = excluded.object_graph_blob,
         action_surface_blob = excluded.action_surface_blob,
         data_source_model_blob = excluded.data_source_model_blob,
         navigation_model_blob = excluded.navigation_model_blob,
         failure_signal_blob = excluded.failure_signal_blob,
         source_trace_ids_blob = excluded.source_trace_ids_blob,
         source_experience_ids_blob = excluded.source_experience_ids_blob,
         observation_count = excluded.observation_count,
         successful_use_count = excluded.successful_use_count,
         failed_use_count = excluded.failed_use_count,
         confidence_score = excluded.confidence_score,
         drift_score = excluded.drift_score,
         archived_at = excluded.archived_at,
         last_observed_at = excluded.last_observed_at,
         last_validated_at = excluded.last_validated_at,
         updated_at = excluded.updated_at`,
    );
    this.getStmt = db.prepare('SELECT * FROM tabrix_knowledge_models WHERE knowledge_id = ?');
    this.listRecentStmt = db.prepare(
      `SELECT * FROM tabrix_knowledge_models
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ? OFFSET ?`,
    );
    this.getByIdentityStmt = db.prepare(
      `SELECT * FROM tabrix_knowledge_models
        WHERE site_family = ? AND page_model_key = ? AND model_version = ?`,
    );
    this.findLatestByPageStmt = db.prepare(
      `SELECT * FROM tabrix_knowledge_models
        WHERE site_family = ? AND page_model_key = ? AND archived_at IS NULL
        ORDER BY model_version DESC
        LIMIT 1`,
    );
    this.markValidatedStmt = db.prepare(
      `UPDATE tabrix_knowledge_models
        SET successful_use_count = successful_use_count + @successful_delta,
            failed_use_count = failed_use_count + @failed_delta,
            confidence_score = @confidence_score,
            last_validated_at = @last_validated_at,
            updated_at = @updated_at
        WHERE knowledge_id = @knowledge_id`,
    );
    this.archiveStmt = db.prepare(
      'UPDATE tabrix_knowledge_models SET archived_at = ?, updated_at = ? WHERE knowledge_id = ?',
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS count FROM tabrix_knowledge_models');
    this.clearStmt = db.prepare('DELETE FROM tabrix_knowledge_models');
  }

  public upsert(input: KnowledgeModelInput): KnowledgeModel {
    const row = {
      knowledge_id: input.knowledgeId ?? randomUUID(),
      site_family: input.siteFamily,
      page_url_pattern: input.pageUrlPattern ?? null,
      page_role: input.pageRole,
      page_model_key: input.pageModelKey,
      model_version: input.modelVersion ?? 1,
      page_state_model_blob: requiredBlob(input.pageStateModel),
      object_graph_blob: requiredBlob(input.objectGraph),
      action_surface_blob: requiredBlob(input.actionSurface),
      data_source_model_blob: blob(input.dataSourceModel),
      navigation_model_blob: blob(input.navigationModel),
      failure_signal_blob: blob(input.failureSignal),
      source_trace_ids_blob: requiredBlob(input.sourceTraceIds ?? []),
      source_experience_ids_blob: requiredBlob(input.sourceExperienceIds ?? []),
      observation_count: optionalInteger(input.observationCount) ?? 0,
      successful_use_count: optionalInteger(input.successfulUseCount) ?? 0,
      failed_use_count: optionalInteger(input.failedUseCount) ?? 0,
      confidence_score: optionalNumber(input.confidenceScore) ?? 0,
      drift_score: optionalNumber(input.driftScore),
      archived_at: input.archivedAt ?? null,
      last_observed_at: input.lastObservedAt ?? null,
      last_validated_at: input.lastValidatedAt ?? null,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    };
    this.upsertStmt.run(row);
    return (
      this.getByIdentity(input.siteFamily, input.pageModelKey, row.model_version) ??
      rowToKnowledgeModel(row)
    );
  }

  public get(knowledgeId: string): KnowledgeModel | undefined {
    const row = this.getStmt.get(knowledgeId) as KnowledgeModelRow | undefined;
    return row ? rowToKnowledgeModel(row) : undefined;
  }

  public listRecent(input?: { limit?: number; offset?: number }): KnowledgeModel[] {
    return (
      this.listRecentStmt.all(input?.limit ?? 20, input?.offset ?? 0) as KnowledgeModelRow[]
    ).map(rowToKnowledgeModel);
  }

  public getByIdentity(
    siteFamily: string,
    pageModelKey: string,
    modelVersion = 1,
  ): KnowledgeModel | undefined {
    const row = this.getByIdentityStmt.get(siteFamily, pageModelKey, modelVersion) as
      | KnowledgeModelRow
      | undefined;
    return row ? rowToKnowledgeModel(row) : undefined;
  }

  public findLatestByPage(input: {
    siteFamily: string;
    pageModelKey: string;
  }): KnowledgeModel | undefined {
    const row = this.findLatestByPageStmt.get(input.siteFamily, input.pageModelKey) as
      | KnowledgeModelRow
      | undefined;
    return row ? rowToKnowledgeModel(row) : undefined;
  }

  public markValidated(input: {
    knowledgeId: string;
    successful: boolean;
    confidenceScore: number;
    nowIso: string;
  }): void {
    this.markValidatedStmt.run({
      knowledge_id: input.knowledgeId,
      successful_delta: input.successful ? 1 : 0,
      failed_delta: input.successful ? 0 : 1,
      confidence_score: input.confidenceScore,
      last_validated_at: input.nowIso,
      updated_at: input.nowIso,
    });
  }

  public archive(input: { knowledgeId: string; archivedAt: string }): void {
    this.archiveStmt.run(input.archivedAt, input.archivedAt, input.knowledgeId);
  }

  public count(): number {
    const row = this.countStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}

export interface ExperienceRecipeInput {
  experienceId?: string;
  recipeName: string;
  scenarioKey: string;
  taskSignature: string;
  recipeFingerprint: string;
  recipeVersion?: number;
  siteFamily?: string | null;
  pageModelKey?: string | null;
  pageRole?: string | null;
  preconditions: unknown;
  variableSchema: unknown;
  steps: unknown;
  successCheck: unknown;
  recovery?: unknown;
  sourceTraceIds?: string[];
  linkedKnowledgeIds?: string[];
  successCount?: number;
  failureCount?: number;
  adoptionCount?: number;
  avgDurationMs?: number | null;
  avgTokenTotal?: number | null;
  reliabilityScore?: number | null;
  speedScore?: number | null;
  tokenSavingScore?: number | null;
  usefulnessScore?: number | null;
  driftState?: string | null;
  portabilityScope?: string;
  originKind?: string;
  originPackageId?: string | null;
  compatibility?: unknown;
  exportState?: string;
  importState?: string;
  redactionState?: string;
  archivedAt?: string | null;
  lastUsedAt?: string | null;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExperienceRecipe extends Required<
  Omit<
    ExperienceRecipeInput,
    | 'experienceId'
    | 'recipeVersion'
    | 'siteFamily'
    | 'pageModelKey'
    | 'pageRole'
    | 'recovery'
    | 'sourceTraceIds'
    | 'linkedKnowledgeIds'
    | 'avgDurationMs'
    | 'avgTokenTotal'
    | 'reliabilityScore'
    | 'speedScore'
    | 'tokenSavingScore'
    | 'usefulnessScore'
    | 'driftState'
    | 'originPackageId'
    | 'compatibility'
    | 'archivedAt'
    | 'lastUsedAt'
    | 'lastVerifiedAt'
  >
> {
  experienceId: string;
  recipeVersion: number;
  siteFamily: string | null;
  pageModelKey: string | null;
  pageRole: string | null;
  recovery: unknown | null;
  sourceTraceIds: string[];
  linkedKnowledgeIds: string[];
  avgDurationMs: number | null;
  avgTokenTotal: number | null;
  reliabilityScore: number | null;
  speedScore: number | null;
  tokenSavingScore: number | null;
  usefulnessScore: number | null;
  driftState: string | null;
  originPackageId: string | null;
  compatibility: unknown | null;
  archivedAt: string | null;
  lastUsedAt: string | null;
  lastVerifiedAt: string | null;
}

export type ExperienceRecipeExport = Pick<
  ExperienceRecipe,
  | 'recipeName'
  | 'scenarioKey'
  | 'taskSignature'
  | 'recipeFingerprint'
  | 'recipeVersion'
  | 'siteFamily'
  | 'pageModelKey'
  | 'pageRole'
  | 'preconditions'
  | 'variableSchema'
  | 'steps'
  | 'successCheck'
  | 'recovery'
  | 'linkedKnowledgeIds'
  | 'portabilityScope'
  | 'compatibility'
  | 'redactionState'
>;

interface ExperienceRecipeRow {
  experience_id: string;
  recipe_name: string;
  scenario_key: string;
  task_signature: string;
  recipe_fingerprint: string;
  recipe_version: number;
  site_family: string | null;
  page_model_key: string | null;
  page_role: string | null;
  preconditions_blob: string;
  variable_schema_blob: string;
  steps_blob: string;
  success_check_blob: string;
  recovery_blob: string | null;
  source_trace_ids_blob: string;
  linked_knowledge_ids_blob: string | null;
  success_count: number;
  failure_count: number;
  adoption_count: number;
  avg_duration_ms: number | null;
  avg_token_total: number | null;
  reliability_score: number | null;
  speed_score: number | null;
  token_saving_score: number | null;
  usefulness_score: number | null;
  drift_state: string | null;
  portability_scope: string;
  origin_kind: string;
  origin_package_id: string | null;
  compatibility_blob: string | null;
  export_state: string;
  import_state: string;
  redaction_state: string;
  archived_at: string | null;
  last_used_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToExperienceRecipe(row: ExperienceRecipeRow): ExperienceRecipe {
  return {
    experienceId: row.experience_id,
    recipeName: row.recipe_name,
    scenarioKey: row.scenario_key,
    taskSignature: row.task_signature,
    recipeFingerprint: row.recipe_fingerprint,
    recipeVersion: row.recipe_version,
    siteFamily: row.site_family,
    pageModelKey: row.page_model_key,
    pageRole: row.page_role,
    preconditions: parseBlob(row.preconditions_blob),
    variableSchema: parseBlob(row.variable_schema_blob),
    steps: parseBlob(row.steps_blob),
    successCheck: parseBlob(row.success_check_blob),
    recovery: parseBlob(row.recovery_blob),
    sourceTraceIds: parseStringArray(row.source_trace_ids_blob),
    linkedKnowledgeIds: parseStringArray(row.linked_knowledge_ids_blob),
    successCount: row.success_count,
    failureCount: row.failure_count,
    adoptionCount: row.adoption_count,
    avgDurationMs: row.avg_duration_ms,
    avgTokenTotal: row.avg_token_total,
    reliabilityScore: row.reliability_score,
    speedScore: row.speed_score,
    tokenSavingScore: row.token_saving_score,
    usefulnessScore: row.usefulness_score,
    driftState: row.drift_state,
    portabilityScope: row.portability_scope,
    originKind: row.origin_kind,
    originPackageId: row.origin_package_id,
    compatibility: parseBlob(row.compatibility_blob),
    exportState: row.export_state,
    importState: row.import_state,
    redactionState: row.redaction_state,
    archivedAt: row.archived_at,
    lastUsedAt: row.last_used_at,
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class ExperienceRecipeRepository {
  private readonly insertStmt;
  private readonly updateOutcomeStmt;
  private readonly getStmt;
  private readonly listRecentStmt;
  private readonly findByFingerprintStmt;
  private readonly findByScenarioStmt;
  private readonly countStmt;
  private readonly archiveStmt;
  private readonly clearStmt;

  constructor(private readonly db: SqliteDatabase) {
    this.insertStmt = db.prepare(
      `INSERT INTO tabrix_experience_recipes
        (experience_id, recipe_name, scenario_key, task_signature, recipe_fingerprint,
         recipe_version, site_family, page_model_key, page_role, preconditions_blob,
         variable_schema_blob, steps_blob, success_check_blob, recovery_blob,
         source_trace_ids_blob, linked_knowledge_ids_blob, success_count, failure_count,
         adoption_count, avg_duration_ms, avg_token_total, reliability_score, speed_score,
         token_saving_score, usefulness_score, drift_state, portability_scope, origin_kind,
         origin_package_id, compatibility_blob, export_state, import_state, redaction_state,
         archived_at, last_used_at, last_verified_at, created_at, updated_at)
       VALUES
        (@experience_id, @recipe_name, @scenario_key, @task_signature, @recipe_fingerprint,
         @recipe_version, @site_family, @page_model_key, @page_role, @preconditions_blob,
         @variable_schema_blob, @steps_blob, @success_check_blob, @recovery_blob,
         @source_trace_ids_blob, @linked_knowledge_ids_blob, @success_count, @failure_count,
         @adoption_count, @avg_duration_ms, @avg_token_total, @reliability_score, @speed_score,
         @token_saving_score, @usefulness_score, @drift_state, @portability_scope, @origin_kind,
         @origin_package_id, @compatibility_blob, @export_state, @import_state, @redaction_state,
         @archived_at, @last_used_at, @last_verified_at, @created_at, @updated_at)
       ON CONFLICT(recipe_fingerprint, recipe_version) DO UPDATE SET
         recipe_name = excluded.recipe_name,
         scenario_key = excluded.scenario_key,
         task_signature = excluded.task_signature,
         site_family = excluded.site_family,
         page_model_key = excluded.page_model_key,
         page_role = excluded.page_role,
         preconditions_blob = excluded.preconditions_blob,
         variable_schema_blob = excluded.variable_schema_blob,
         steps_blob = excluded.steps_blob,
         success_check_blob = excluded.success_check_blob,
         recovery_blob = excluded.recovery_blob,
         linked_knowledge_ids_blob = excluded.linked_knowledge_ids_blob,
         compatibility_blob = excluded.compatibility_blob,
         export_state = excluded.export_state,
         redaction_state = excluded.redaction_state,
         updated_at = excluded.updated_at`,
    );
    this.updateOutcomeStmt = db.prepare(
      `UPDATE tabrix_experience_recipes
        SET success_count = success_count + @success_delta,
            failure_count = failure_count + @failure_delta,
            adoption_count = adoption_count + @adoption_delta,
            reliability_score = @reliability_score,
            last_used_at = @last_used_at,
            updated_at = @updated_at
        WHERE experience_id = @experience_id`,
    );
    this.getStmt = db.prepare('SELECT * FROM tabrix_experience_recipes WHERE experience_id = ?');
    this.listRecentStmt = db.prepare(
      `SELECT * FROM tabrix_experience_recipes
        ORDER BY updated_at DESC, created_at DESC
        LIMIT ? OFFSET ?`,
    );
    this.findByFingerprintStmt = db.prepare(
      'SELECT * FROM tabrix_experience_recipes WHERE recipe_fingerprint = ? AND recipe_version = ?',
    );
    this.findByScenarioStmt = db.prepare(
      `SELECT * FROM tabrix_experience_recipes
        WHERE scenario_key = ? AND archived_at IS NULL
        ORDER BY reliability_score IS NULL ASC, reliability_score DESC, updated_at DESC
        LIMIT ?`,
    );
    this.archiveStmt = db.prepare(
      'UPDATE tabrix_experience_recipes SET archived_at = ?, updated_at = ? WHERE experience_id = ?',
    );
    this.countStmt = db.prepare('SELECT COUNT(*) AS count FROM tabrix_experience_recipes');
    this.clearStmt = db.prepare('DELETE FROM tabrix_experience_recipes');
  }

  public save(input: ExperienceRecipeInput): ExperienceRecipe {
    assertExperienceTemplateOnly(input);

    const row = {
      experience_id: input.experienceId ?? randomUUID(),
      recipe_name: input.recipeName,
      scenario_key: input.scenarioKey,
      task_signature: input.taskSignature,
      recipe_fingerprint: input.recipeFingerprint,
      recipe_version: input.recipeVersion ?? 1,
      site_family: input.siteFamily ?? null,
      page_model_key: input.pageModelKey ?? null,
      page_role: input.pageRole ?? null,
      preconditions_blob: requiredBlob(input.preconditions),
      variable_schema_blob: requiredBlob(input.variableSchema),
      steps_blob: requiredBlob(input.steps),
      success_check_blob: requiredBlob(input.successCheck),
      recovery_blob: blob(input.recovery),
      source_trace_ids_blob: requiredBlob(input.sourceTraceIds ?? []),
      linked_knowledge_ids_blob: requiredBlob(input.linkedKnowledgeIds ?? []),
      success_count: optionalInteger(input.successCount) ?? 0,
      failure_count: optionalInteger(input.failureCount) ?? 0,
      adoption_count: optionalInteger(input.adoptionCount) ?? 0,
      avg_duration_ms: optionalInteger(input.avgDurationMs),
      avg_token_total: optionalInteger(input.avgTokenTotal),
      reliability_score: optionalNumber(input.reliabilityScore),
      speed_score: optionalNumber(input.speedScore),
      token_saving_score: optionalNumber(input.tokenSavingScore),
      usefulness_score: optionalNumber(input.usefulnessScore),
      drift_state: input.driftState ?? null,
      portability_scope: input.portabilityScope ?? 'local',
      origin_kind: input.originKind ?? 'local_mined',
      origin_package_id: input.originPackageId ?? null,
      compatibility_blob: blob(input.compatibility),
      export_state: input.exportState ?? 'not_exportable',
      import_state: input.importState ?? 'native',
      redaction_state: EXPERIENCE_TEMPLATE_ONLY_REDACTION_STATE,
      archived_at: input.archivedAt ?? null,
      last_used_at: input.lastUsedAt ?? null,
      last_verified_at: input.lastVerifiedAt ?? null,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
    };
    this.insertStmt.run(row);
    return (
      this.findByFingerprint(row.recipe_fingerprint, row.recipe_version) ??
      rowToExperienceRecipe(row)
    );
  }

  public get(experienceId: string): ExperienceRecipe | undefined {
    const row = this.getStmt.get(experienceId) as ExperienceRecipeRow | undefined;
    return row ? rowToExperienceRecipe(row) : undefined;
  }

  public listRecent(input?: { limit?: number; offset?: number }): ExperienceRecipe[] {
    return (
      this.listRecentStmt.all(input?.limit ?? 20, input?.offset ?? 0) as ExperienceRecipeRow[]
    ).map(rowToExperienceRecipe);
  }

  public findByFingerprint(
    recipeFingerprint: string,
    recipeVersion = 1,
  ): ExperienceRecipe | undefined {
    const row = this.findByFingerprintStmt.get(recipeFingerprint, recipeVersion) as
      | ExperienceRecipeRow
      | undefined;
    return row ? rowToExperienceRecipe(row) : undefined;
  }

  public findByScenario(scenarioKey: string, limit = 5): ExperienceRecipe[] {
    return (this.findByScenarioStmt.all(scenarioKey, limit) as ExperienceRecipeRow[]).map(
      rowToExperienceRecipe,
    );
  }

  public recordUseOutcome(input: {
    experienceId: string;
    successful: boolean;
    adopted?: boolean;
    reliabilityScore?: number | null;
    nowIso: string;
  }): void {
    this.updateOutcomeStmt.run({
      experience_id: input.experienceId,
      success_delta: input.successful ? 1 : 0,
      failure_delta: input.successful ? 0 : 1,
      adoption_delta: input.adopted ? 1 : 0,
      reliability_score: optionalNumber(input.reliabilityScore),
      last_used_at: input.nowIso,
      updated_at: input.nowIso,
    });
  }

  public exportRecipe(experienceId: string): ExperienceRecipeExport | undefined {
    const recipe = this.get(experienceId);
    if (!recipe || recipe.redactionState !== 'template_only') return undefined;
    return {
      recipeName: recipe.recipeName,
      scenarioKey: recipe.scenarioKey,
      taskSignature: recipe.taskSignature,
      recipeFingerprint: recipe.recipeFingerprint,
      recipeVersion: recipe.recipeVersion,
      siteFamily: recipe.siteFamily,
      pageModelKey: recipe.pageModelKey,
      pageRole: recipe.pageRole,
      preconditions: recipe.preconditions,
      variableSchema: recipe.variableSchema,
      steps: recipe.steps,
      successCheck: recipe.successCheck,
      recovery: recipe.recovery,
      linkedKnowledgeIds: recipe.linkedKnowledgeIds,
      portabilityScope: recipe.portabilityScope,
      compatibility: recipe.compatibility,
      redactionState: recipe.redactionState,
    };
  }

  public importRecipe(
    input: ExperienceRecipeExport & { originPackageId?: string; importedAt: string },
  ): ExperienceRecipe {
    return this.save({
      recipeName: input.recipeName,
      scenarioKey: input.scenarioKey,
      taskSignature: input.taskSignature,
      recipeFingerprint: input.recipeFingerprint,
      recipeVersion: input.recipeVersion,
      siteFamily: input.siteFamily,
      pageModelKey: input.pageModelKey,
      pageRole: input.pageRole,
      preconditions: input.preconditions,
      variableSchema: input.variableSchema,
      steps: input.steps,
      successCheck: input.successCheck,
      recovery: input.recovery,
      sourceTraceIds: [],
      linkedKnowledgeIds: input.linkedKnowledgeIds,
      portabilityScope: input.portabilityScope,
      originKind: 'imported',
      originPackageId: input.originPackageId ?? null,
      compatibility: input.compatibility,
      exportState: 'not_exportable',
      importState: 'imported_unverified',
      redactionState: input.redactionState,
      createdAt: input.importedAt,
      updatedAt: input.importedAt,
    });
  }

  public archive(input: { experienceId: string; archivedAt: string }): void {
    this.archiveStmt.run(input.archivedAt, input.archivedAt, input.experienceId);
  }

  public count(): number {
    const row = this.countStmt.get() as { count: number } | undefined;
    return row?.count ?? 0;
  }

  public clear(): void {
    this.clearStmt.run();
  }
}
