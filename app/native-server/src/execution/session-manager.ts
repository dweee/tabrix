import { randomUUID } from 'node:crypto';
import {
  ExecutionSession,
  ExecutionSessionStatus,
  ExecutionStep,
  ExecutionStepStatus,
  ExecutionStepType,
  Task,
} from './types';
import {
  openMemoryDb,
  resolveMemoryDbPath,
  BrowserObjectRepository,
  MemoryTraceRepository,
  KnowledgeModelRepository,
  ExperienceRecipeRepository,
  type ExperienceRecipe,
  type BrowserObject,
  type KnowledgeModel,
  type MemoryTrace,
  type SqliteDatabase,
} from '../memory/db';
import { MkeMemoryTraceService } from '../memory/mke-memory-trace-service';
import {
  MkeKnowledgeProjector,
  buildMkePageModelKey,
  type MkeKnowledgeProjectionInput,
  type MkeKnowledgeProjectionResult,
} from '../memory/mke-knowledge-projector';
import {
  MkeExperienceProjector,
  type MkeExperienceProjectionInput,
  type MkeExperienceProjectionResult,
} from '../memory/mke-experience-projector';
import { KnowledgeApiRepository } from '../memory/knowledge/knowledge-api-repository';
import {
  ChooseContextTelemetryRepository,
  type SelectedChooseContextArtifactAudit,
} from '../memory/telemetry/choose-context-telemetry';
import { TaskSessionContext } from './task-session-context';

const MKE_IDLE_PROJECTION_BATCH_LIMIT = 250;
const MKE_IDLE_PROJECTION_MAX_BATCHES = 20;

function mergeKnowledgeProjectionResults(
  previous: MkeKnowledgeProjectionResult | null,
  current: MkeKnowledgeProjectionResult,
): MkeKnowledgeProjectionResult {
  if (!previous) return { ...current, knowledgeIds: [...current.knowledgeIds] };
  return {
    processedTraceCount: previous.processedTraceCount + current.processedTraceCount,
    skippedTraceCount: previous.skippedTraceCount + current.skippedTraceCount,
    upsertedKnowledgeCount: previous.upsertedKnowledgeCount + current.upsertedKnowledgeCount,
    nextCursorCreatedAt: current.nextCursorCreatedAt ?? previous.nextCursorCreatedAt,
    knowledgeIds: [...new Set([...previous.knowledgeIds, ...current.knowledgeIds])],
  };
}

function mergeExperienceProjectionResults(
  previous: MkeExperienceProjectionResult | null,
  current: MkeExperienceProjectionResult,
): MkeExperienceProjectionResult {
  if (!previous) return { ...current, experienceIds: [...current.experienceIds] };
  return {
    processedTraceCount: previous.processedTraceCount + current.processedTraceCount,
    skippedTraceCount: previous.skippedTraceCount + current.skippedTraceCount,
    rejectedSensitiveSequenceCount:
      previous.rejectedSensitiveSequenceCount + current.rejectedSensitiveSequenceCount,
    missingAiFeedbackTraceCount:
      previous.missingAiFeedbackTraceCount + current.missingAiFeedbackTraceCount,
    rejectedBusinessFailureTraceCount:
      previous.rejectedBusinessFailureTraceCount + current.rejectedBusinessFailureTraceCount,
    rejectedUnreplayableQualityTraceCount:
      previous.rejectedUnreplayableQualityTraceCount +
      current.rejectedUnreplayableQualityTraceCount,
    noReplayableActionSequenceCount:
      previous.noReplayableActionSequenceCount + current.noReplayableActionSequenceCount,
    missingPageAnchorSequenceCount:
      previous.missingPageAnchorSequenceCount + current.missingPageAnchorSequenceCount,
    missingKnowledgeSequenceCount:
      previous.missingKnowledgeSequenceCount + current.missingKnowledgeSequenceCount,
    savedExperienceCount: previous.savedExperienceCount + current.savedExperienceCount,
    nextCursorCreatedAt: current.nextCursorCreatedAt ?? previous.nextCursorCreatedAt,
    experienceIds: [...new Set([...previous.experienceIds, ...current.experienceIds])],
  };
}

export interface CreateTaskInput {
  taskType: string;
  title: string;
  intent: string;
  origin: string;
  owner?: string;
  projectId?: string;
  labels?: string[];
}

export interface StartSessionInput {
  taskId: string;
  transport: string;
  clientName: string;
  workspaceContext?: string;
  browserContext?: string;
}

export interface StartStepInput {
  sessionId: string;
  toolName: string;
  stepType?: ExecutionStepType;
  inputSummary?: string;
}

export interface SessionManagerOptions {
  /**
   * Override SQLite path. Use ':memory:' for an ephemeral in-process
   * DB (used by tests). When omitted, defaults to
   * `~/.chrome-mcp-agent/memory.db` in production and to ':memory:'
   * when `NODE_ENV=test` or `JEST_WORKER_ID` is set so that the
   * module-level singleton never writes to a developer's real data
   * file during tests.
   */
  dbPath?: string;
  /**
   * When `false`, skip DB initialization entirely and run with pure
   * in-memory Maps (same shape as pre-persistence behavior). Useful
   * as a kill-switch; also controlled globally by
   * `TABRIX_MEMORY_PERSIST=false`.
   */
  persistenceEnabled?: boolean;
}

export type SessionPersistenceMode = 'disk' | 'memory' | 'off';

interface Repos {
  browserObject: BrowserObjectRepository;
  memoryTrace: MemoryTraceRepository;
  knowledgeModel: KnowledgeModelRepository;
  experienceRecipe: ExperienceRecipeRepository;
  knowledgeApi: KnowledgeApiRepository;
  chooseContextTelemetry: ChooseContextTelemetryRepository;
}

interface StorageInit {
  repos: Repos | null;
  dbHandle: SqliteDatabase | null;
  persistenceMode: SessionPersistenceMode;
  browserObject: BrowserObjectRepository | null;
  memoryTrace: MkeMemoryTraceService | null;
  knowledgeProjector: MkeKnowledgeProjector | null;
  experienceProjector: MkeExperienceProjector | null;
  knowledgeApi: KnowledgeApiRepository | null;
  chooseContextTelemetry: ChooseContextTelemetryRepository | null;
}

const nowIso = () => new Date().toISOString();

/**
 * Hard cap on the number of distinct external task-session keys we
 * hold in memory. Sized for "every reasonable daemon-mode workflow
 * fits comfortably" (a single agent rarely runs more than ~30 logical
 * tasks in a session) while still bounded so a misbehaving client
 * cannot exhaust memory by minting fresh `taskSessionId`s per call.
 */
const EXTERNAL_TASK_CONTEXT_CAP = 256;

function resolveRuntimeDbPath(options?: SessionManagerOptions): string {
  if (options?.dbPath !== undefined) return options.dbPath;
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return ':memory:';
  }
  return resolveMemoryDbPath({});
}

function initStorage(options?: SessionManagerOptions): StorageInit {
  const persistenceOptOut =
    options?.persistenceEnabled === false || process.env.TABRIX_MEMORY_PERSIST === 'false';
  if (persistenceOptOut) {
    return {
      repos: null,
      dbHandle: null,
      persistenceMode: 'off',
      browserObject: null,
      memoryTrace: null,
      knowledgeProjector: null,
      experienceProjector: null,
      knowledgeApi: null,
      chooseContextTelemetry: null,
    };
  }

  try {
    const dbPath = resolveRuntimeDbPath(options);
    const opened = openMemoryDb({ dbPath });
    const browserObjectRepo = new BrowserObjectRepository(opened.db);
    const memoryTraceRepo = new MemoryTraceRepository(opened.db);
    const knowledgeModelRepo = new KnowledgeModelRepository(opened.db);
    const experienceRecipeRepo = new ExperienceRecipeRepository(opened.db);
    const knowledgeApiRepo = new KnowledgeApiRepository(opened.db);
    const chooseContextTelemetryRepo = new ChooseContextTelemetryRepository(opened.db);
    const repos: Repos = {
      browserObject: browserObjectRepo,
      memoryTrace: memoryTraceRepo,
      knowledgeModel: knowledgeModelRepo,
      experienceRecipe: experienceRecipeRepo,
      knowledgeApi: knowledgeApiRepo,
      chooseContextTelemetry: chooseContextTelemetryRepo,
    };
    return {
      repos,
      dbHandle: opened.db,
      persistenceMode: opened.persistenceMode,
      browserObject: browserObjectRepo,
      memoryTrace: new MkeMemoryTraceService(memoryTraceRepo, browserObjectRepo, {}),
      knowledgeProjector: new MkeKnowledgeProjector(browserObjectRepo, knowledgeModelRepo),
      experienceProjector: new MkeExperienceProjector(
        memoryTraceRepo,
        knowledgeModelRepo,
        experienceRecipeRepo,
      ),
      knowledgeApi: knowledgeApiRepo,
      chooseContextTelemetry: chooseContextTelemetryRepo,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    console.warn(`[tabrix/memory] falling back to in-memory session storage: ${message}`);
    return {
      repos: null,
      dbHandle: null,
      persistenceMode: 'off',
      browserObject: null,
      memoryTrace: null,
      knowledgeProjector: null,
      experienceProjector: null,
      knowledgeApi: null,
      chooseContextTelemetry: null,
    };
  }
}

export class SessionManager {
  private tasks = new Map<string, Task>();
  private sessions = new Map<string, ExecutionSession>();
  /**
   * Per-task in-process read-budget gate. Attached on `startSession`,
   * detached on `finishSession`, and never persisted. The
   * `register-tools` `chrome_read_page` shim consults this before
   * forwarding to the extension.
   */
  private readonly taskContexts = new Map<string, TaskSessionContext>();
  /**
   * Externally keyed read-budget gates. `handleToolCall` mints a
   * fresh internal `taskId` per invocation, so `taskContexts` cannot
   * accumulate state across multiple calls of the same logical agent
   * task. Callers can pass a stable `taskSessionId` (or `taskId` /
   * `clientTaskId` alias); this map keeps that context alive across
   * `handleToolCall` round-trips so the read budget fires in the
   * production path.
   *
   * Lifetime: independent of `startSession` / `finishSession` (the
   * external key has no relation to the internal `taskId`). To keep
   * memory bounded for long-running daemons we cap at
   * {@link EXTERNAL_TASK_CONTEXT_CAP} entries and evict the oldest
   * by insertion order (Map preserves insertion order, so the first
   * `keys()` iterator value is the LRU candidate).
   */
  private readonly externalTaskContexts = new Map<string, TaskSessionContext>();
  private readonly repos: Repos | null;
  private readonly dbHandle: SqliteDatabase | null;
  private readonly persistenceMode: SessionPersistenceMode;
  private readonly memoryTraceService: MkeMemoryTraceService | null;
  private readonly mkeKnowledgeProjector: MkeKnowledgeProjector | null;
  private readonly mkeExperienceProjector: MkeExperienceProjector | null;
  private readonly knowledgeApiRepo: KnowledgeApiRepository | null;
  private readonly chooseContextTelemetryRepo: ChooseContextTelemetryRepository | null;
  private mkeKnowledgeProjectionCursor: string | null = null;
  private mkeExperienceProjectionCursor: string | null = null;

  constructor(options?: SessionManagerOptions) {
    const storage = initStorage(options);
    this.repos = storage.repos;
    this.dbHandle = storage.dbHandle;
    this.persistenceMode = storage.persistenceMode;
    this.memoryTraceService = storage.memoryTrace;
    this.mkeKnowledgeProjector = storage.knowledgeProjector;
    this.mkeExperienceProjector = storage.experienceProjector;
    this.knowledgeApiRepo = storage.knowledgeApi;
    this.chooseContextTelemetryRepo = storage.chooseContextTelemetry;
  }

  /**
   * MKE Memory trace writer. `null` when persistence is off. MCP tool-call
   * handlers must treat writes as best-effort evidence capture and never as
   * part of the browser action success path.
   */
  public get memoryTraces(): MkeMemoryTraceService | null {
    return this.memoryTraceService;
  }

  /**
   * Browser Object repository. Read paths may use this to surface redacted
   * object-library reuse hints, but browser control must continue to rely on
   * fresh extension observations.
   */
  public get browserObjects(): BrowserObjectRepository | null {
    return this.repos?.browserObject ?? null;
  }

  public flushMkeMemoryTraceWrites(): Promise<void> {
    return this.memoryTraceService?.flushAsyncWrites() ?? Promise.resolve();
  }

  public async flushAndProjectMkeIdle(input?: { resetExperienceCursor?: boolean }): Promise<{
    knowledge: MkeKnowledgeProjectionResult | null;
    experience: MkeExperienceProjectionResult | null;
  }> {
    await this.flushMkeMemoryTraceWrites();
    const knowledge = this.drainMkeKnowledgeProjectionIdle();
    if (input?.resetExperienceCursor) {
      this.mkeExperienceProjectionCursor = null;
    }
    const experience = this.drainMkeExperienceProjectionIdle();
    return { knowledge, experience };
  }

  public scheduleMkeProjectionIdle(): void {
    setImmediate(() => {
      void this.flushAndProjectMkeIdle()
        .then(() => {
          setTimeout(() => {
            void this.flushAndProjectMkeIdle().catch((error: unknown) => {
              const message = error instanceof Error ? error.message : String(error);
              console.warn(`[tabrix/memory] delayed MKE projection failed: ${message}`);
            });
          }, 250);
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[tabrix/memory] MKE projection failed: ${message}`);
        });
    });
  }

  public scheduleMkeProjectionAfterTrace(): void {
    this.scheduleMkeProjectionIdle();
  }

  public scheduleMkeProjectionAfterAiFeedback(): void {
    this.mkeExperienceProjectionCursor = null;
    this.scheduleMkeProjectionIdle();
  }

  public async flushAndProjectMkeAfterAiFeedback(traceId?: string): Promise<{
    knowledge: MkeKnowledgeProjectionResult | null;
    experience: MkeExperienceProjectionResult | null;
  }> {
    if (traceId && this.mkeExperienceProjector) {
      await this.flushMkeMemoryTraceWrites();
      const knowledge = this.drainMkeKnowledgeProjectionIdle();
      const experience = this.mkeExperienceProjector.projectIdleBatch({
        contextTraceId: traceId,
      });
      return { knowledge, experience };
    }
    return this.flushAndProjectMkeIdle({ resetExperienceCursor: true });
  }

  public projectMkeKnowledgeIdle(
    input?: MkeKnowledgeProjectionInput,
  ): MkeKnowledgeProjectionResult | null {
    return this.mkeKnowledgeProjector?.projectIdleBatch(input) ?? null;
  }

  public projectMkeExperienceIdle(
    input?: MkeExperienceProjectionInput,
  ): MkeExperienceProjectionResult | null {
    return this.mkeExperienceProjector?.projectIdleBatch(input) ?? null;
  }

  private drainMkeKnowledgeProjectionIdle(): MkeKnowledgeProjectionResult | null {
    if (!this.mkeKnowledgeProjector) return null;
    let cursor = this.mkeKnowledgeProjectionCursor;
    let aggregate: MkeKnowledgeProjectionResult | null = null;

    for (let batch = 0; batch < MKE_IDLE_PROJECTION_MAX_BATCHES; batch += 1) {
      const result = this.mkeKnowledgeProjector.projectIdleBatch({
        cursorCreatedAt: cursor,
        limit: MKE_IDLE_PROJECTION_BATCH_LIMIT,
      });
      aggregate = mergeKnowledgeProjectionResults(aggregate, result);
      if (result.processedTraceCount === 0 || !result.nextCursorCreatedAt) break;
      if (result.nextCursorCreatedAt === cursor) break;
      cursor = result.nextCursorCreatedAt;
      if (result.processedTraceCount < MKE_IDLE_PROJECTION_BATCH_LIMIT) break;
    }

    this.mkeKnowledgeProjectionCursor = cursor;
    return aggregate;
  }

  private drainMkeExperienceProjectionIdle(): MkeExperienceProjectionResult | null {
    if (!this.mkeExperienceProjector) return null;
    let cursor = this.mkeExperienceProjectionCursor;
    let aggregate: MkeExperienceProjectionResult | null = null;

    for (let batch = 0; batch < MKE_IDLE_PROJECTION_MAX_BATCHES; batch += 1) {
      const result = this.mkeExperienceProjector.projectIdleBatch({
        cursorCreatedAt: cursor,
        limit: MKE_IDLE_PROJECTION_BATCH_LIMIT,
      });
      aggregate = mergeExperienceProjectionResults(aggregate, result);
      if (result.processedTraceCount === 0 || !result.nextCursorCreatedAt) break;
      if (result.nextCursorCreatedAt === cursor) break;
      cursor = result.nextCursorCreatedAt;
      if (result.processedTraceCount < MKE_IDLE_PROJECTION_BATCH_LIMIT) break;
    }

    this.mkeExperienceProjectionCursor = cursor;
    return aggregate;
  }

  /**
   * Knowledge API endpoint repository. Capture writes go through here from
   * the `chrome_network_capture` post-processor. `null` when persistence is
   * off, in which case the post-processor short-circuits.
   */
  public get knowledgeApi(): KnowledgeApiRepository | null {
    return this.knowledgeApiRepo;
  }

  /**
   * Telemetry repository for `tabrix_choose_context` decisions and outcome
   * write-backs. `null` when persistence is off. Native handlers must treat
   * `null` as "telemetry disabled, skip the decisionId write-back" — the
   * chooser still returns a usable result without a `decisionId`.
   */
  public get chooseContextTelemetry(): ChooseContextTelemetryRepository | null {
    return this.chooseContextTelemetryRepo;
  }

  public createTask(input: CreateTaskInput): Task {
    const timestamp = nowIso();
    const task: Task = {
      taskId: randomUUID(),
      taskType: input.taskType,
      title: input.title,
      intent: input.intent,
      origin: input.origin,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: 'pending',
      owner: input.owner,
      projectId: input.projectId,
      labels: input.labels ?? [],
    };

    this.tasks.set(task.taskId, task);
    return task;
  }

  public startSession(input: StartSessionInput): ExecutionSession {
    const task = this.getTask(input.taskId);
    const session: ExecutionSession = {
      sessionId: randomUUID(),
      taskId: task.taskId,
      transport: input.transport,
      clientName: input.clientName,
      startedAt: nowIso(),
      status: 'running',
      workspaceContext: input.workspaceContext,
      browserContext: input.browserContext,
      steps: [],
    };

    this.sessions.set(session.sessionId, session);
    this.updateTaskStatus(task.taskId, 'running');
    // Attach a fresh per-task read-budget gate. Idempotent: `startSession`
    // may be called more than once per task (e.g. retry after an aborted
    // session) and we deliberately keep the existing context so the budget
    // already spent on the prior session still counts. A truly virgin task
    // gets a brand-new context with the env-resolved budget.
    if (!this.taskContexts.has(task.taskId)) {
      this.taskContexts.set(task.taskId, new TaskSessionContext());
    }
    return session;
  }

  public startStep(input: StartStepInput): ExecutionStep {
    const session = this.getSession(input.sessionId);
    const step: ExecutionStep = {
      stepId: randomUUID(),
      sessionId: session.sessionId,
      index: session.steps.length + 1,
      toolName: input.toolName,
      stepType: input.stepType ?? 'tool_call',
      status: 'running',
      inputSummary: input.inputSummary,
      startedAt: nowIso(),
      artifactRefs: [],
    };

    session.steps.push(step);
    return step;
  }

  public completeStep(
    sessionId: string,
    stepId: string,
    updates?: {
      status?: Extract<ExecutionStepStatus, 'completed' | 'failed' | 'skipped'>;
      resultSummary?: string;
      errorCode?: string;
      errorSummary?: string;
      artifactRefs?: string[];
      operationLog?: {
        urlPattern?: string | null;
        pageRole?: string | null;
        requestedLayer?: string | null;
        selectedDataSource?: string | null;
        sourceRoute?: string | null;
        decisionReason?: string | null;
        resultKind?: string | null;
        fallbackUsed?: string | null;
        readCount?: number | null;
        tokensSaved?: number | null;
        success?: boolean;
        tabHygiene?: unknown;
        /**
         * Partial structured "why" envelope. Forwarded verbatim to the
         * repository, which fills in any missing field with
         * `'not_applicable'`. Pass through whatever the call site already
         * knows (decisionReason, sourceRoute, fallbackPlan, etc.) — do NOT
         * invent values.
         */
        metadata?: Record<string, unknown>;
      };
    },
  ): ExecutionStep {
    const session = this.getSession(sessionId);
    const step = this.getStep(session, stepId);

    step.status = updates?.status ?? 'completed';
    step.resultSummary = updates?.resultSummary;
    step.errorCode = updates?.errorCode;
    step.errorSummary = updates?.errorSummary;
    step.artifactRefs = updates?.artifactRefs ?? step.artifactRefs;
    step.endedAt = nowIso();

    return step;
  }

  public finishSession(
    sessionId: string,
    updates?: {
      status?: Extract<ExecutionSessionStatus, 'completed' | 'failed' | 'aborted'>;
      summary?: string;
    },
  ): ExecutionSession {
    const session = this.getSession(sessionId);
    session.status = updates?.status ?? 'completed';
    session.summary = updates?.summary;
    session.endedAt = nowIso();

    const taskStatusMap: Record<
      Extract<ExecutionSessionStatus, 'completed' | 'failed' | 'aborted'>,
      Task['status']
    > = {
      completed: 'completed',
      failed: 'failed',
      aborted: 'cancelled',
    };

    this.updateTaskStatus(session.taskId, taskStatusMap[session.status]);
    this.projectMkeExperienceIdle();
    // Release the per-task read-budget gate. The task is logically finished
    // (completed / failed / aborted) so any future tool call against the same
    // taskId should start a fresh budget. Detach is best-effort: if
    // `taskContexts` does not have the entry, we silently no-op.
    this.taskContexts.delete(session.taskId);
    return session;
  }

  /**
   * Read-only accessor used by the `register-tools::handleToolCall`
   * `chrome_read_page` shim. Returns `null` when no context is attached (e.g.
   * the task finished, the caller bypassed `startSession`, or
   * persistence/runtime state was reset between sessions).
   */
  public getTaskContext(taskId: string): TaskSessionContext | null {
    return this.taskContexts.get(taskId) ?? null;
  }

  /**
   * Convenience used by `register-tools` when only the `sessionId` is in
   * scope. Walks `session → task → context` defensively so a missing session
   * does not throw.
   */
  public getTaskContextForSession(sessionId: string): TaskSessionContext | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.getTaskContext(session.taskId);
  }

  /**
   * Test seam. Lets unit / integration tests pre-seed a context (e.g. drive
   * `readPageCount` over the budget) without going through `startSession`.
   * Production callers must prefer `getTaskContext` — this method exists so
   * `register-tools` integration tests can simulate a long-running task
   * without ceremony. Returns the existing context when one is already
   * attached so callers cannot accidentally clobber state.
   */
  public ensureTaskContext(taskId: string, context?: TaskSessionContext): TaskSessionContext {
    const existing = this.taskContexts.get(taskId);
    if (existing) return existing;
    const taskContext = context ?? new TaskSessionContext();
    this.taskContexts.set(taskId, taskContext);
    return taskContext;
  }

  /**
   * Return (or lazily create) the {@link TaskSessionContext} keyed by
   * an externally supplied stable id. The MCP `handleToolCall`
   * derives this key from
   * `args.taskSessionId` / `args.taskId` / `args.clientTaskId` so the
   * read-budget gate accumulates state across consecutive tool calls
   * within the same logical agent task (the previous behaviour reset
   * the budget on every `handleToolCall`).
   *
   * Lifetime is independent of any `startSession` / `finishSession`
   * pair. We bound memory at {@link EXTERNAL_TASK_CONTEXT_CAP}
   * entries and evict the oldest insertion when the cap is hit
   * (Map iteration order is insertion order). The eviction is
   * intentionally simple — no LRU-on-read promotion — because the
   * only real-world failure mode is a runaway client minting fresh
   * keys per call, and FIFO is enough to bound that.
   *
   * Returns the existing context unmodified on repeat lookups so
   * callers cannot accidentally clobber budget / page state.
   */
  public getOrCreateExternalTaskContext(externalKey: string): TaskSessionContext {
    const existing = this.externalTaskContexts.get(externalKey);
    if (existing) return existing;
    if (this.externalTaskContexts.size >= EXTERNAL_TASK_CONTEXT_CAP) {
      const oldestExternalKey = this.externalTaskContexts.keys().next().value;
      if (oldestExternalKey !== undefined) this.externalTaskContexts.delete(oldestExternalKey);
    }
    const taskContext = new TaskSessionContext();
    this.externalTaskContexts.set(externalKey, taskContext);
    return taskContext;
  }

  /**
   * Test seam. Returns `null` when no external context exists and
   * never lazily creates one. Lets tests assert "we did NOT
   * contaminate session A from a session B call".
   */
  public peekExternalTaskContext(externalKey: string): TaskSessionContext | null {
    return this.externalTaskContexts.get(externalKey) ?? null;
  }

  public releaseExternalTaskContext(externalKey: string): boolean {
    return this.externalTaskContexts.delete(externalKey);
  }

  public noteWindowFocusMayHaveChangedForExternalTaskContexts(input: {
    action: string;
    sourceExternalKey?: string | null;
    tabId?: number | null;
  }): number {
    let invalidatedCount = 0;
    for (const [externalKey, taskContext] of this.externalTaskContexts) {
      if (input.sourceExternalKey && externalKey === input.sourceExternalKey) continue;
      taskContext.notePageInteraction({
        action: input.action,
        tabId: input.tabId ?? null,
      });
      invalidatedCount += 1;
    }
    return invalidatedCount;
  }

  public getTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    return task;
  }

  public getSession(sessionId: string): ExecutionSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown execution session: ${sessionId}`);
    }
    return session;
  }

  public listTasks(): Task[] {
    return Array.from(this.tasks.values());
  }

  public listSessions(): ExecutionSession[] {
    return Array.from(this.sessions.values());
  }

  public listRecentMkeMemoryTraces(limit: number, offset: number): MemoryTrace[] {
    if (!this.repos) return [];
    return this.repos.memoryTrace.listRecent({ limit, offset });
  }

  public countMkeMemoryTraces(): number {
    if (!this.repos) return 0;
    return this.repos.memoryTrace.count();
  }

  public listRecentMkeBrowserObjects(limit: number, offset: number): BrowserObject[] {
    if (!this.repos) return [];
    return this.repos.browserObject.listCurrentBrowserSurface({ limit, offset });
  }

  public listMkeObjectLibraryGraph(limit: number, offset: number): BrowserObject[] {
    if (!this.repos) return [];
    return this.repos.browserObject.listObjectLibraryGraphSurface({ limit, offset });
  }

  public countMkeBrowserObjects(): number {
    if (!this.repos) return 0;
    return this.repos.browserObject.countCurrentBrowserSurface();
  }

  public countMkeObjectLibraryGraph(): number {
    if (!this.repos) return 0;
    return this.repos.browserObject.countObjectLibraryGraphSurface();
  }

  public clearMkeBrowserObjects(): void {
    this.memoryTraceService?.discardPendingAsyncWrites();
    this.repos?.browserObject.clear();
  }

  public recordMkeBrowserWorldSnapshot(input: {
    browserWorld: unknown;
    observedAtMs?: number;
    browserContextKey?: string | null;
  }): void {
    this.memoryTraceService?.recordBrowserWorldSnapshot(input);
  }

  public listRecentMkeKnowledgeModels(limit: number, offset: number): KnowledgeModel[] {
    if (!this.repos) return [];
    return this.repos.knowledgeModel.listRecent({ limit, offset });
  }

  public findLatestMkeKnowledgeModel(input: {
    siteFamily: string;
    pageModelKey: string;
  }): KnowledgeModel | undefined {
    if (!this.repos) return undefined;
    return this.repos.knowledgeModel.findLatestByPage(input);
  }

  public countMkeKnowledgeModels(): number {
    if (!this.repos) return 0;
    return this.repos.knowledgeModel.count();
  }

  public listRecentMkeExperienceRecipes(limit: number, offset: number): ExperienceRecipe[] {
    if (!this.repos) return [];
    return this.repos.experienceRecipe.listRecent({ limit, offset });
  }

  public findReusableMkeExperienceRecipes(input: {
    siteFamily: string;
    pageRole?: string | null;
    limit?: number;
  }): ExperienceRecipe[] {
    if (!this.repos) return [];
    return this.repos.experienceRecipe.findReusableByContext(input);
  }

  public recordMkeSelectedArtifactOutcome(input: {
    successful: boolean;
    adopted: boolean;
    selectedArtifacts: SelectedChooseContextArtifactAudit[];
    recordedAt: string;
  }): { updatedExperienceCount: number; updatedKnowledgeCount: number } {
    if (!this.repos) {
      return { updatedExperienceCount: 0, updatedKnowledgeCount: 0 };
    }

    let updatedExperienceCount = 0;
    let updatedKnowledgeCount = 0;
    const seen = new Set<string>();
    for (const artifact of input.selectedArtifacts) {
      const identity = `${artifact.kind}:${artifact.ref}`;
      if (seen.has(identity)) continue;
      seen.add(identity);

      if (artifact.kind === 'experience_recipe') {
        if (!this.repos.experienceRecipe.get(artifact.ref)) continue;
        this.repos.experienceRecipe.recordUseOutcome({
          experienceId: artifact.ref,
          successful: input.successful,
          adopted: input.adopted,
          nowIso: input.recordedAt,
        });
        updatedExperienceCount += 1;
        continue;
      }

      if (artifact.kind === 'knowledge_page_model') {
        const knowledge = this.repos.knowledgeModel.get(artifact.ref);
        if (!knowledge) continue;
        const nextSuccessfulUseCount = knowledge.successfulUseCount + (input.successful ? 1 : 0);
        const nextFailedUseCount = knowledge.failedUseCount + (input.successful ? 0 : 1);
        const totalUseCount = nextSuccessfulUseCount + nextFailedUseCount;
        this.repos.knowledgeModel.markValidated({
          knowledgeId: artifact.ref,
          successful: input.successful,
          confidenceScore:
            totalUseCount > 0
              ? Number((nextSuccessfulUseCount / totalUseCount).toFixed(4))
              : knowledge.confidenceScore,
          nowIso: input.recordedAt,
        });
        updatedKnowledgeCount += 1;
        continue;
      }

      if (artifact.kind === 'knowledge_api') {
        const updated = this.repos.knowledgeApi.recordUseOutcome({
          endpointId: artifact.ref,
          successful: input.successful,
          nowIso: input.recordedAt,
        });
        if (updated) updatedKnowledgeCount += 1;
      }
    }

    return { updatedExperienceCount, updatedKnowledgeCount };
  }

  public revokeMkeExperienceForTrace(input: {
    traceId: string;
    nowIso?: string;
    revalidateScenario?: boolean;
  }): {
    updatedCount: number;
    archivedCount: number;
    affectedExperienceIds: string[];
  } {
    if (!this.repos) {
      return { updatedCount: 0, archivedCount: 0, affectedExperienceIds: [] };
    }
    const nowIso = input.nowIso ?? new Date().toISOString();
    const sourceTraceResult = this.repos.experienceRecipe.removeSourceTrace({
      traceId: input.traceId,
      nowIso,
    });
    const trace = this.repos.memoryTrace.get(input.traceId);
    const pageModelKey = trace ? buildMkePageModelKey(trace) : null;
    const scenarioRevalidationResult =
      input.revalidateScenario === true && trace?.siteFamily && pageModelKey
        ? this.repos.experienceRecipe.requireScenarioRevalidation({
            scenarioKey: `mke:${trace.siteFamily}:${pageModelKey}`,
            nowIso,
            excludeExperienceIds: sourceTraceResult.affectedExperienceIds,
          })
        : { updatedCount: 0, archivedCount: 0, affectedExperienceIds: [] };
    const affectedExperienceIds = [
      ...new Set([
        ...sourceTraceResult.affectedExperienceIds,
        ...scenarioRevalidationResult.affectedExperienceIds,
      ]),
    ];

    return {
      updatedCount: affectedExperienceIds.length,
      archivedCount: sourceTraceResult.archivedCount + scenarioRevalidationResult.archivedCount,
      affectedExperienceIds,
    };
  }

  public countMkeExperienceRecipes(): number {
    if (!this.repos) return 0;
    return this.repos.experienceRecipe.count();
  }

  public getPersistenceStatus(): {
    mode: SessionPersistenceMode;
    enabled: boolean;
  } {
    return { mode: this.persistenceMode, enabled: this.repos !== null };
  }

  public reset(): void {
    this.memoryTraceService?.discardPendingAsyncWrites();
    if (this.repos) {
      this.repos.browserObject.clear();
      this.repos.memoryTrace.clear();
      this.repos.knowledgeModel.clear();
      this.repos.experienceRecipe.clear();
      this.repos.knowledgeApi.clear();
      this.repos.chooseContextTelemetry.clear();
    }
    this.tasks.clear();
    this.sessions.clear();
    // Clear externally-keyed task contexts too, so a test calling `reset()`
    // between cases starts with a virgin budget. Internal `taskContexts` is
    // intentionally not touched here: those entries are owned by
    // `startSession`/`finishSession` and would have been collected already if
    // the corresponding sessions had finished cleanly; clearing them blindly
    // risks hiding leaks in failing tests.
    this.externalTaskContexts.clear();
  }

  /**
   * Close the underlying DB handle. Intended for graceful shutdown
   * and test teardown. Safe to call when persistence is off.
   */
  public close(): void {
    this.memoryTraceService?.discardPendingAsyncWrites();
    this.dbHandle?.close();
  }

  /**
   * Re-tag a task's intent column as best-effort audit decoration.
   * Intentionally narrow: only intent + updated_at are mutated, never
   * task status / title. No-op when the task is unknown or persistence
   * is disabled.
   */
  public updateTaskIntent(taskId: string, intent: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.intent = intent;
    task.updatedAt = nowIso();
  }

  private getStep(session: ExecutionSession, stepId: string): ExecutionStep {
    const step = session.steps.find((candidate) => candidate.stepId === stepId);
    if (!step) {
      throw new Error(`Unknown execution step: ${stepId}`);
    }
    return step;
  }

  private updateTaskStatus(taskId: string, status: Task['status']): void {
    const task = this.getTask(taskId);
    task.status = status;
    task.updatedAt = nowIso();
  }
}

export const sessionManager = new SessionManager();
