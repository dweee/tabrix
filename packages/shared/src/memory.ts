/**
 * MKEP Memory read-side DTOs.
 *
 * These types describe the JSON shapes returned by the native-server's
 * read-only `GET /memory/*` routes (see `app/native-server/src/server/memory-routes.ts`).
 * They are shared between the native-server (canonical emitter) and the
 * Chrome extension read surfaces so the contract stays pinned
 * in a single place.
 *
 * Conventions:
 * - All timestamps are ISO-8601 strings in UTC.
 * - Fields marked optional mirror nullable columns in the Memory SQLite tables.
 * - No field is ever renamed across layers: the server emits the same keys
 *   the client consumes, and the extension never reshapes before display.
 * - This module intentionally does not include any writer-side types. Write
 *   paths live inside the native-server and must not leak onto the wire.
 */

export type MemoryPersistenceMode = 'disk' | 'memory' | 'off';

export type MemorySessionStatus = 'starting' | 'running' | 'completed' | 'failed' | 'aborted';

export type MemoryTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type MemoryStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type MemoryStepType = 'tool_call' | 'flow_call' | 'verification' | 'retry' | 'recovery';

/**
 * Flattened projection of `memory_sessions` joined with `memory_tasks` and
 * a `COUNT(memory_steps)` subquery. Backs the Sidepanel Memory tab list.
 */
export interface MemorySessionSummary {
  sessionId: string;
  taskId: string;
  /** Task title (copied from `memory_tasks.title`). */
  taskTitle: string;
  /** Task intent (copied from `memory_tasks.intent`). */
  taskIntent: string;
  transport: string;
  clientName: string;
  status: MemorySessionStatus;
  startedAt: string;
  endedAt?: string;
  summary?: string;
  workspaceContext?: string;
  browserContext?: string;
  /** Number of `memory_steps` rows whose `session_id` equals `sessionId`. */
  stepCount: number;
}

/**
 * Raw `memory_steps` row, emitted in index order ascending.
 */
export interface MemoryExecutionStep {
  stepId: string;
  sessionId: string;
  index: number;
  toolName: string;
  stepType: MemoryStepType;
  status: MemoryStepStatus;
  inputSummary?: string;
  resultSummary?: string;
  startedAt: string;
  endedAt?: string;
  errorCode?: string;
  errorSummary?: string;
  artifactRefs: string[];
}

/**
 * Raw `memory_tasks` row. Returned by `GET /memory/tasks/:taskId`.
 */
export interface MemoryTaskRow {
  taskId: string;
  taskType: string;
  title: string;
  intent: string;
  origin: string;
  createdAt: string;
  updatedAt: string;
  status: MemoryTaskStatus;
  owner?: string;
  projectId?: string;
  labels: string[];
}

/** `GET /memory/sessions` response envelope body. */
export interface MemorySessionsResponseData {
  sessions: MemorySessionSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/sessions/:sessionId/steps` response envelope body. */
export interface MemorySessionStepsResponseData {
  sessionId: string;
  steps: MemoryExecutionStep[];
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/tasks/:taskId` response envelope body. */
export interface MemoryTaskResponseData {
  task: MemoryTaskRow;
  persistenceMode: MemoryPersistenceMode;
}

/**
 * Sanitized projection of `tabrix_memory_traces`.
 *
 * This intentionally omits raw request/response blobs, perception objects,
 * post-observation payloads, and AI feedback bodies. The popup management UI
 * only needs query/status metadata; raw evidence stays inside the native DB.
 */
export interface MkeMemoryTraceSummary {
  traceId: string;
  taskId: string;
  taskIntent?: string | null;
  aiClient?: string | null;
  toolName: string;
  toolCallId?: string | null;
  sequenceIndex?: number | null;
  requestAt: string;
  responseAt: string;
  durationMs?: number | null;
  toolSuccess?: boolean | null;
  businessSuccess?: string | null;
  resultSummary?: string | null;
  errorCode?: string | null;
  tabId?: number | null;
  windowId?: number | null;
  siteFamily?: string | null;
  pageUrlPattern?: string | null;
  pageRole?: string | null;
  pageState?: string | null;
  pageModelKey?: string | null;
  sourceRoute?: string | null;
  selectedDataSource?: string | null;
  freshness?: string | null;
  fallbackUsed?: string | null;
  tokenTotal?: number | null;
  redactionState: string;
  createdAt: string;
}

/**
 * Sanitized projection of `tabrix_knowledge_models`.
 *
 * Large model blobs are collapsed to counts/quality metadata so UI listing
 * does not become a raw page-knowledge dump.
 */
export interface MkeKnowledgeModelSummary {
  knowledgeId: string;
  siteFamily: string;
  pageUrlPattern?: string | null;
  pageRole: string;
  pageModelKey: string;
  modelVersion: number;
  observationCount: number;
  successfulUseCount: number;
  failedUseCount: number;
  confidenceScore: number;
  driftScore?: number | null;
  sourceTraceCount: number;
  sourceExperienceCount: number;
  archivedAt?: string | null;
  lastObservedAt?: string | null;
  lastValidatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Sanitized projection of `tabrix_experience_recipes`.
 *
 * Template steps, variables, and preconditions are intentionally not exposed
 * by the list endpoint; users can inspect lifecycle and quality metadata
 * without leaking concrete operational content.
 */
export interface MkeExperienceRecipeSummary {
  experienceId: string;
  recipeName: string;
  scenarioKey: string;
  taskSignature: string;
  recipeFingerprint: string;
  recipeVersion: number;
  siteFamily?: string | null;
  pageModelKey?: string | null;
  pageRole?: string | null;
  successCount: number;
  failureCount: number;
  adoptionCount: number;
  avgDurationMs?: number | null;
  avgTokenTotal?: number | null;
  reliabilityScore?: number | null;
  speedScore?: number | null;
  tokenSavingScore?: number | null;
  usefulnessScore?: number | null;
  driftState?: string | null;
  portabilityScope: string;
  originKind: string;
  exportState: string;
  importState: string;
  redactionState: string;
  sourceTraceCount: number;
  linkedKnowledgeCount: number;
  archivedAt?: string | null;
  lastUsedAt?: string | null;
  lastVerifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `GET /memory/mke/traces` response envelope body. */
export interface MkeMemoryTracesResponseData {
  traces: MkeMemoryTraceSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/mke/knowledge` response envelope body. */
export interface MkeKnowledgeModelsResponseData {
  knowledgeModels: MkeKnowledgeModelSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

/** `GET /memory/mke/experience` response envelope body. */
export interface MkeExperienceRecipesResponseData {
  experienceRecipes: MkeExperienceRecipeSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

/** Standard success envelope used by all `/memory/*` routes. */
export interface MemoryReadSuccess<TData> {
  status: 'ok';
  data: TData;
}

/**
 * Standard error envelope emitted by the `/memory/*` routes.
 *
 * Shape mirrors what `memory-routes.ts` returns today: a top-level
 * `message` string, optionally accompanied by a typed `data` blob
 * (e.g. the `persistenceMode` on 404 responses).
 */
export interface MemoryReadError {
  status: 'error';
  message: string;
  data?: { persistenceMode?: MemoryPersistenceMode };
}

export type MemoryReadResponse<TData> = MemoryReadSuccess<TData> | MemoryReadError;
