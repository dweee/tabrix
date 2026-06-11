/**
 * MKEP storage read-side DTOs.
 *
 * These types describe the JSON shapes returned by the native-server's
 * read-only `GET /memory/*` routes (see `app/native-server/src/server/memory-routes.ts`).
 * They are shared between the native-server (canonical emitter) and the
 * Chrome extension read surfaces so the contract stays pinned
 * in a single place.
 *
 * These are the public browser-extension contracts for the four storage
 * surfaces: Memory traces, Object Library, Knowledge models, and Experience
 * recipes. Pre-launch `/memory/sessions` task/session/step DTOs were retired;
 * execution session objects are now internal runtime wrappers only.
 */

export type MemoryPersistenceMode = 'disk' | 'memory' | 'off';

/**
 * Sanitized projection of `tabrix_memory_traces`.
 *
 * This intentionally omits raw request/response blobs, perception objects,
 * post-observation payloads, and raw AI feedback bodies. The popup management
 * UI only receives whitelisted AI feedback fields. Internal execution
 * provenance stays inside the native DB and is not part of the product-facing
 * Memory list contract.
 */
export type MkeMemoryAiFeedbackScope = 'step' | 'task';

export interface MkeMemoryAiFeedbackBindingSummary {
  taskId?: string | null;
  toolName?: string | null;
  toolCallId?: string | null;
  sequenceIndex?: number | null;
  traceBindingHash?: string | null;
}

export interface MkeMemoryAiFeedbackSummary {
  sourceKind?: 'ai_feedback' | string | null;
  evaluationScope?: MkeMemoryAiFeedbackScope | string | null;
  evaluationVersion?: string | null;
  rubricVersion?: string | null;
  evaluatorModel?: string | null;
  businessStatus?: string | null;
  confidence?: number | null;
  reasonCode?: string | null;
  summary?: string | null;
  userGoalSnapshot?: string | null;
  experienceCandidate?: boolean | null;
  binding?: MkeMemoryAiFeedbackBindingSummary | null;
  receivedAt?: string | null;
  sourceToolName?: string | null;
  sourceToolCallId?: string | null;
}

export type MkePageIdentityKind =
  | 'web'
  | 'extension'
  | 'local_file'
  | 'browser_internal'
  | 'unknown';

export interface MkePageIdentitySummary {
  kind: MkePageIdentityKind;
  label: string | null;
  url?: string | null;
  host?: string | null;
  source:
    | 'result_payload'
    | 'current_route'
    | 'root_route'
    | 'page_url_pattern'
    | 'site_family'
    | 'none';
}

export interface MkeTraceDisplaySummary {
  title: string;
  subtitle?: string | null;
  methodLabel: string;
  locationLabel?: string | null;
}

export type MkeTraceExecutionStatus = 'succeeded' | 'failed' | 'unknown';

export interface MkeTraceStatusViewSummary {
  executionStatus: MkeTraceExecutionStatus;
  feedbackRequired: boolean;
}

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
  aiFeedback?: MkeMemoryAiFeedbackSummary | null;
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
  display?: MkeTraceDisplaySummary;
  pageIdentity?: MkePageIdentitySummary;
  statusView?: MkeTraceStatusViewSummary;
}

export type MkeBrowserObjectType =
  | 'window'
  | 'tab'
  | 'page'
  | 'region'
  | 'action_target'
  | 'data_source'
  | 'unknown'
  | string;

export interface MkeBrowserObjectDisplaySummary {
  title: string;
  subtitle?: string | null;
  locationLabel?: string | null;
}

/**
 * Sanitized projection of `tabrix_browser_objects`.
 *
 * The Object Library is a current browser/page-object fact layer. List views
 * receive only user-readable fields and small allowlisted facts; raw DOM,
 * page text, request/response payloads, and sensitive values stay out of the
 * API contract.
 */
export interface MkeBrowserObjectSummary {
  browserObjectId: string;
  objectType: MkeBrowserObjectType;
  siteFamily: string;
  pageUrlPattern?: string | null;
  rootRoute?: string | null;
  currentRoute?: string | null;
  pageRole?: string | null;
  pageModelKey: string;
  objectFingerprint: string;
  browserContextKey?: string | null;
  ownerType?: string | null;
  sourceRoute?: string | null;
  selectedDataSource?: string | null;
  sourceFreshness?: string | null;
  lifecycleState?: string | null;
  tabStatus?: string | null;
  isActive?: boolean | null;
  canTabrixOperate?: boolean | null;
  operabilityReason?: string | null;
  primaryConclusion?: string | null;
  observationCount: number;
  facts?: Record<string, unknown> | null;
  actionTypes?: string[];
  changedGroups?: unknown;
  firstTraceId?: string | null;
  lastTraceId?: string | null;
  redactionState: string;
  lastObservedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  pageIdentity?: MkePageIdentitySummary;
  display?: MkeBrowserObjectDisplaySummary;
}

/**
 * Sanitized projection of `tabrix_knowledge_models`.
 *
 * Large model blobs and internal quality scores stay out of the list endpoint.
 * The Knowledge Library list is a compact product surface for page knowledge.
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
 * Template steps, variables, preconditions, and internal score projections are
 * intentionally not exposed by the list endpoint.
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
  driftState?: string | null;
  portabilityScope: string;
  originKind: string;
  exportState: string;
  importState: string;
  redactionState: string;
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

/** `GET /memory/mke/browser-objects` response envelope body. */
export interface MkeBrowserObjectsResponseData {
  browserObjects: MkeBrowserObjectSummary[];
  total: number;
  limit: number;
  offset: number;
  persistenceMode: MemoryPersistenceMode;
}

export interface MkeObjectStoragePreferencesResponseData {
  personalBrowserStateStorageEnabled: boolean;
  persistenceMode: MemoryPersistenceMode;
}

/** `DELETE /memory/mke/browser-objects` response envelope body. */
export interface MkeBrowserObjectsClearResponseData {
  cleared: boolean;
  total: number;
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
