/**
 * MKEP Memory read routes.
 *
 * These routes expose the persisted Memory tables (`memory_sessions`
 * + `memory_tasks` + `memory_steps`) to the sidepanel Memory tab. They
 * are intentionally **read-only** — the Memory write path is owned by
 * `SessionManager` via the MCP post-processor and must not be exposed
 * over HTTP.
 *
 * Auth: relies on the global `onRequest` hook in `server/index.ts`
 * (localhost is allowed through; non-localhost must present a Bearer
 * token when `tokenManager.enabled` is true). The routes themselves
 * add no extra auth. Public paths (`/ping`, `/status`, `/auth/token`,
 * `/auth/refresh`) are intentionally **not** extended — these routes
 * are protected by the same token as `/mcp`.
 *
 * Contract:
 * - `GET /memory/sessions?limit=&offset=` → recent sessions, newest first
 * - `GET /memory/sessions/:sessionId/steps` → steps for one session
 * - `GET /memory/tasks/:taskId` → single task + its sessions
 * - `GET /memory/mke/traces?limit=&offset=` → sanitized MKE Memory trace summaries
 * - `GET /memory/mke/knowledge?limit=&offset=` → sanitized MKE Knowledge summaries
 * - `GET /memory/mke/experience?limit=&offset=` → sanitized MKE Experience summaries
 *
 * Write verbs (POST/PUT/PATCH/DELETE) are not registered; Fastify
 * will respond 404 for them, which is the intended "read-only"
 * signal.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  MkeExperienceRecipeSummary,
  MkeKnowledgeModelSummary,
  MkeMemoryAiFeedbackSummary,
  MkeMemoryTraceSummary,
} from '@tabrix/shared';
import { HTTP_STATUS } from '../constant';
import type { SessionManager } from '../execution/session-manager';
import type { ExperienceRecipe, KnowledgeModel, MemoryTrace } from '../memory/db';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';
import { SESSION_SUMMARY_LIMIT_MAX } from '../memory/db';

/**
 * Default page size for `GET /memory/sessions`. Matches the sidepanel
 * Memory tab's initial render budget (20 rows).
 */
export const MEMORY_SESSIONS_DEFAULT_LIMIT = 20;

interface SessionsQuery {
  limit?: string;
  offset?: string;
}

type MkeListQuery = SessionsQuery;

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.max(0, Math.floor(n)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toAiFeedbackSummary(value: unknown): MkeMemoryAiFeedbackSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const summary = {
    businessStatus: readString(record, 'businessStatus'),
    confidence: readNumber(record, 'confidence'),
    reasonCode: readString(record, 'reasonCode'),
    summary: readString(record, 'summary'),
    receivedAt: readString(record, 'receivedAt'),
    sourceToolName: readString(record, 'sourceToolName'),
    sourceToolCallId: readString(record, 'sourceToolCallId'),
  };
  return Object.values(summary).some((item) => item !== null) ? summary : null;
}

function toTraceSummary(trace: MemoryTrace): MkeMemoryTraceSummary {
  return {
    traceId: trace.traceId,
    taskId: trace.taskId,
    taskIntent: trace.taskIntent,
    aiClient: trace.aiClient,
    toolName: trace.toolName,
    toolCallId: trace.toolCallId,
    sequenceIndex: trace.sequenceIndex,
    requestAt: trace.requestAt,
    responseAt: trace.responseAt,
    durationMs: trace.durationMs,
    toolSuccess: trace.toolSuccess,
    businessSuccess: trace.businessSuccess,
    aiFeedbackScore: trace.aiFeedbackScore,
    aiFeedback: toAiFeedbackSummary(trace.aiFeedback),
    resultSummary: trace.resultSummary,
    errorCode: trace.errorCode,
    tabId: trace.tabId,
    windowId: trace.windowId,
    siteFamily: trace.siteFamily,
    pageUrlPattern: trace.pageUrlPattern,
    pageRole: trace.pageRole,
    pageState: trace.pageState,
    pageModelKey: trace.pageModelKey,
    sourceRoute: trace.sourceRoute,
    selectedDataSource: trace.selectedDataSource,
    freshness: trace.freshness,
    fallbackUsed: trace.fallbackUsed,
    tokenTotal: trace.tokenTotal,
    redactionState: trace.redactionState,
    createdAt: trace.createdAt,
  };
}

function toKnowledgeSummary(model: KnowledgeModel): MkeKnowledgeModelSummary {
  return {
    knowledgeId: model.knowledgeId,
    siteFamily: model.siteFamily,
    pageUrlPattern: model.pageUrlPattern,
    pageRole: model.pageRole,
    pageModelKey: model.pageModelKey,
    modelVersion: model.modelVersion,
    observationCount: model.observationCount,
    successfulUseCount: model.successfulUseCount,
    failedUseCount: model.failedUseCount,
    confidenceScore: model.confidenceScore,
    driftScore: model.driftScore,
    sourceTraceCount: model.sourceTraceIds.length,
    sourceExperienceCount: model.sourceExperienceIds.length,
    archivedAt: model.archivedAt,
    lastObservedAt: model.lastObservedAt,
    lastValidatedAt: model.lastValidatedAt,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function toExperienceSummary(recipe: ExperienceRecipe): MkeExperienceRecipeSummary {
  return {
    experienceId: recipe.experienceId,
    recipeName: recipe.recipeName,
    scenarioKey: recipe.scenarioKey,
    taskSignature: recipe.taskSignature,
    recipeFingerprint: recipe.recipeFingerprint,
    recipeVersion: recipe.recipeVersion,
    siteFamily: recipe.siteFamily,
    pageModelKey: recipe.pageModelKey,
    pageRole: recipe.pageRole,
    successCount: recipe.successCount,
    failureCount: recipe.failureCount,
    adoptionCount: recipe.adoptionCount,
    avgDurationMs: recipe.avgDurationMs,
    avgTokenTotal: recipe.avgTokenTotal,
    reliabilityScore: recipe.reliabilityScore,
    speedScore: recipe.speedScore,
    tokenSavingScore: recipe.tokenSavingScore,
    usefulnessScore: recipe.usefulnessScore,
    driftState: recipe.driftState,
    portabilityScope: recipe.portabilityScope,
    originKind: recipe.originKind,
    exportState: recipe.exportState,
    importState: recipe.importState,
    redactionState: recipe.redactionState,
    sourceTraceCount: recipe.sourceTraceIds.length,
    linkedKnowledgeCount: recipe.linkedKnowledgeIds.length,
    archivedAt: recipe.archivedAt,
    lastUsedAt: recipe.lastUsedAt,
    lastVerifiedAt: recipe.lastVerifiedAt,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

/**
 * Register the MKEP Memory read routes on `fastify`.
 *
 * @param fastify         Fastify instance owned by {@link Server}.
 * @param sessionManager  Defaults to the module-level singleton. Tests
 *                        may inject a scratch instance pointing at an
 *                        in-memory DB.
 */
export function registerMemoryRoutes(
  fastify: FastifyInstance,
  sessionManager: SessionManager = defaultSessionManager,
): void {
  fastify.get(
    '/memory/sessions',
    async (request: FastifyRequest<{ Querystring: SessionsQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(
        request.query.limit,
        MEMORY_SESSIONS_DEFAULT_LIMIT,
        SESSION_SUMMARY_LIMIT_MAX,
      );
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const sessions = sessionManager.listRecentSessionSummaries(limit, offset);
      const total = sessionManager.countAllSessions();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          sessions,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/sessions/:sessionId/steps',
    async (request: FastifyRequest<{ Params: { sessionId: string } }>, reply: FastifyReply) => {
      const { sessionId } = request.params;
      if (!sessionId || typeof sessionId !== 'string') {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          status: 'error',
          message: 'sessionId is required',
        });
      }
      const steps = sessionManager.getStepsForSession(sessionId);
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          sessionId,
          steps,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/tasks/:taskId',
    async (request: FastifyRequest<{ Params: { taskId: string } }>, reply: FastifyReply) => {
      const { taskId } = request.params;
      if (!taskId || typeof taskId !== 'string') {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          status: 'error',
          message: 'taskId is required',
        });
      }
      const task = sessionManager.getTaskOrNull(taskId);
      const persistence = sessionManager.getPersistenceStatus();

      if (!task) {
        return reply.status(HTTP_STATUS.NOT_FOUND).send({
          status: 'error',
          message: 'Task not found',
          data: { persistenceMode: persistence.mode },
        });
      }

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          task,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/mke/traces',
    async (request: FastifyRequest<{ Querystring: MkeListQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, SESSION_SUMMARY_LIMIT_MAX);
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const traces = sessionManager.listRecentMkeMemoryTraces(limit, offset).map(toTraceSummary);
      const total = sessionManager.countMkeMemoryTraces();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          traces,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/mke/knowledge',
    async (request: FastifyRequest<{ Querystring: MkeListQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, SESSION_SUMMARY_LIMIT_MAX);
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const knowledgeModels = sessionManager
        .listRecentMkeKnowledgeModels(limit, offset)
        .map(toKnowledgeSummary);
      const total = sessionManager.countMkeKnowledgeModels();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          knowledgeModels,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.get(
    '/memory/mke/experience',
    async (request: FastifyRequest<{ Querystring: MkeListQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, SESSION_SUMMARY_LIMIT_MAX);
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const experienceRecipes = sessionManager
        .listRecentMkeExperienceRecipes(limit, offset)
        .map(toExperienceSummary);
      const total = sessionManager.countMkeExperienceRecipes();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          experienceRecipes,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );
}
