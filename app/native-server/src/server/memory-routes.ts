/**
 * MKEP Memory read routes.
 *
 * These routes expose the new MKE storage surfaces to the sidepanel. They are
 * intentionally read-focused; Memory writes are produced by MCP execution
 * traces and Object Library lifecycle capture, not by HTTP inserts.
 *
 * Auth: relies on the global `onRequest` hook in `server/index.ts`.
 * Protected routes require Bearer auth when the server is remote-exposed;
 * localhost bypass is only allowed for a local-only listen host. The routes
 * themselves add no extra auth. Public paths (`/ping`, `/status`,
 * `/auth/token`, `/auth/refresh`) are intentionally **not** extended — these
 * routes are protected by the same token as `/mcp`.
 *
 * Contract:
 * - `GET /memory/mke/traces?limit=&offset=` → sanitized MKE Memory trace summaries
 * - `GET /memory/mke/browser-objects?limit=&offset=&scope=` → sanitized browser object summaries
 * - `DELETE /memory/mke/browser-objects` → clear Object Library rows only
 * - `GET /memory/mke/object-storage-preferences` → Object Library storage preferences
 * - `PATCH /memory/mke/object-storage-preferences` → update Object Library storage preferences
 * - `GET /memory/mke/knowledge?limit=&offset=` → sanitized MKE Knowledge summaries
 * - `GET /memory/mke/experience?limit=&offset=` → sanitized MKE Experience summaries
 *
 * Memory row writes are not exposed here. Object Library write routes are
 * intentionally scoped to user settings and clearing current browser-object
 * facts; they do not insert Memory / Knowledge / Experience rows.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type {
  MkeBrowserObjectSummary,
  MkeBrowserObjectsClearResponseData,
  MkeExperienceRecipeSummary,
  MkeKnowledgeModelSummary,
  MkeMemoryAiFeedbackSummary,
  MkeMemoryTraceSummary,
  MkeObjectStoragePreferencesResponseData,
} from '@tabrix/shared';
import { HTTP_STATUS } from '../constant';
import type { SessionManager } from '../execution/session-manager';
import type { BrowserObject, ExperienceRecipe, KnowledgeModel, MemoryTrace } from '../memory/db';
import { sessionManager as defaultSessionManager } from '../execution/session-manager';
import {
  getPersonalBrowserStateStorageEnabled,
  setPersonalBrowserStateStorageEnabled,
} from '../host-config';
import {
  allowsPersonalBrowserStateStorage,
  summarizeBrowserObjectFactsForPrivacy,
  summarizeBrowserRouteForPrivacy,
} from '../policy/browser-state-privacy';

const MKE_LIST_LIMIT_MAX = 100;

interface MkeListQuery {
  limit?: string;
  offset?: string;
}

interface BrowserObjectsQuery extends MkeListQuery {
  scope?: string;
}

type BrowserObjectsScope = 'browser-surface' | 'object-graph';

interface ObjectStoragePreferencesBody {
  personalBrowserStateStorageEnabled?: boolean;
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(max, Math.max(0, Math.floor(n)));
}

function parseBrowserObjectsScope(raw: unknown): BrowserObjectsScope {
  return raw === 'object-graph' ? 'object-graph' : 'browser-surface';
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
  };
  const hasSignal = Object.values(summary).some((item) => item !== null);
  return hasSignal ? summary : null;
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_windows_and_tabs: '读取窗口和标签',
  chrome_get_web_content: '读取内容',
  chrome_read_page: '读取页面',
  chrome_navigate: '打开页面',
  chrome_click_element: '点击元素',
  chrome_fill_or_select: '填写内容',
  chrome_close_tabs: '关闭标签页',
  chrome_screenshot: '截图',
  chrome_history: '读取历史记录',
};

function formatToolLabel(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function formatTraceTitle(trace: MemoryTrace): string {
  const intent = trace.taskIntent?.trim();
  const toolLabel = formatToolLabel(trace.toolName);
  if (!intent) return toolLabel;
  const toolIntent = intent.match(/^Run MCP tool\s+(.+)$/i)?.[1]?.trim();
  if (!toolIntent) return intent.length > 36 ? `${intent.slice(0, 36)}...` : intent;
  return TOOL_DISPLAY_NAMES[toolIntent] ?? toolLabel;
}

function classifyPageIdentity(
  trace: MemoryTrace,
): NonNullable<MkeMemoryTraceSummary['pageIdentity']> {
  const url = trace.pageUrlPattern;
  const source = trace.pageUrlPattern ? 'page_url_pattern' : 'site_family';

  if (url) {
    if (url.startsWith('chrome-extension://')) {
      const label = url.includes('/sidepanel.html')
        ? 'Tabrix 侧栏'
        : url.includes('/popup.html')
          ? 'Tabrix 弹窗'
          : '扩展页面';
      return { kind: 'extension', label, url, host: null, source };
    }
    if (/^(file:|[a-z]:[\\/]|\/)/i.test(url) || url.startsWith('null/')) {
      return { kind: 'local_file', label: '本地文件', url, host: null, source };
    }
    try {
      const parsed = new URL(url);
      const isBrowserInternal = ['chrome:', 'edge:', 'about:'].includes(parsed.protocol);
      return {
        kind: isBrowserInternal ? 'browser_internal' : 'web',
        label: isBrowserInternal ? parsed.href : parsed.hostname,
        url,
        host: parsed.hostname || null,
        source,
      };
    } catch {
      return {
        kind: 'unknown',
        label: trace.siteFamily ?? url,
        url,
        host: trace.siteFamily,
        source,
      };
    }
  }

  return {
    kind: trace.siteFamily ? 'web' : 'unknown',
    label: trace.siteFamily,
    url: null,
    host: trace.siteFamily,
    source: trace.siteFamily ? 'site_family' : 'none',
  };
}

function classifyObjectPageIdentity(
  object: BrowserObject,
  routeView: {
    pageUrlPattern: string | null;
    rootRoute: string | null;
    currentRoute: string | null;
  } = {
    pageUrlPattern: object.pageUrlPattern,
    rootRoute: object.rootRoute,
    currentRoute: object.currentRoute,
  },
): NonNullable<MkeBrowserObjectSummary['pageIdentity']> {
  const url = routeView.currentRoute ?? routeView.rootRoute ?? routeView.pageUrlPattern;
  const source = routeView.currentRoute
    ? 'current_route'
    : routeView.rootRoute
      ? 'root_route'
      : routeView.pageUrlPattern
        ? 'page_url_pattern'
        : 'site_family';
  if (url) {
    if (url.startsWith('chrome-extension://')) {
      const label = url.includes('/sidepanel.html')
        ? 'Tabrix 侧栏'
        : url.includes('/popup.html')
          ? 'Tabrix 弹窗'
          : '扩展页面';
      return { kind: 'extension', label, url, host: null, source };
    }
    if (/^(file:|[a-z]:[\\/]|\/)/i.test(url) || url.startsWith('null/')) {
      return { kind: 'local_file', label: '本地文件', url, host: null, source };
    }
    try {
      const parsed = new URL(url);
      const isBrowserInternal = ['chrome:', 'edge:', 'about:'].includes(parsed.protocol);
      return {
        kind: isBrowserInternal ? 'browser_internal' : 'web',
        label: isBrowserInternal ? parsed.href : parsed.hostname,
        url,
        host: parsed.hostname || null,
        source,
      };
    } catch {
      return {
        kind: 'unknown',
        label: object.siteFamily === 'unknown' ? null : object.siteFamily,
        url,
        host: object.siteFamily === 'unknown' ? null : object.siteFamily,
        source,
      };
    }
  }
  return {
    kind: object.siteFamily === 'browser' ? 'browser_internal' : 'unknown',
    label: object.siteFamily === 'browser' ? '浏览器' : object.siteFamily,
    url: null,
    host: object.siteFamily === 'unknown' ? null : object.siteFamily,
    source: object.siteFamily === 'unknown' ? 'none' : 'site_family',
  };
}

function toTraceSummary(trace: MemoryTrace): MkeMemoryTraceSummary {
  const aiFeedback = toAiFeedbackSummary(trace.aiFeedback);
  const pageIdentity = classifyPageIdentity(trace);
  const methodLabel = formatToolLabel(trace.toolName);
  return {
    traceId: trace.traceId,
    taskIntent: trace.taskIntent,
    toolName: trace.toolName,
    requestAt: trace.requestAt,
    responseAt: trace.responseAt,
    durationMs: trace.durationMs,
    aiFeedback,
    resultSummary: trace.resultSummary,
    siteFamily: trace.siteFamily,
    pageUrlPattern: trace.pageUrlPattern,
    pageRole: trace.pageRole,
    createdAt: trace.createdAt,
    display: {
      title: formatTraceTitle(trace),
      subtitle: pageIdentity.label ? `${pageIdentity.label} · ${methodLabel}` : methodLabel,
      methodLabel,
      locationLabel: pageIdentity.label,
    },
    pageIdentity,
  };
}

const OBJECT_TYPE_LABELS: Record<string, string> = {
  window: '浏览器窗口',
  tab: '网页标签',
  page: '页面对象',
  region: '页面区域',
  action_target: '可操作对象',
  data_source: '数据源',
};

function objectFactString(facts: Record<string, unknown>, key: string): string | null {
  const value = facts[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function objectFactNumber(facts: Record<string, unknown>, key: string): number | null {
  const value = facts[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function windowStateLabel(value: string | null): string | null {
  if (!value) return null;
  if (value === 'maximized' || value === 'normal') return '可见';
  if (value === 'minimized') return '最小化';
  if (value === 'fullscreen') return '全屏';
  return value;
}

function objectTitle(object: BrowserObject, pageIdentity: MkeBrowserObjectSummary['pageIdentity']) {
  const typeLabel = OBJECT_TYPE_LABELS[object.objectType] ?? object.objectType;
  const facts = asRecord(object.facts) ?? {};
  if (object.primaryConclusion) return object.primaryConclusion;
  if (object.objectType === 'window') {
    const tabCount = objectFactNumber(facts, 'tabCount');
    const state = windowStateLabel(objectFactString(facts, 'state'));
    const parts = [
      object.isActive ? '当前浏览器窗口' : '浏览器窗口',
      tabCount === null ? null : `${tabCount} 个标签`,
      state,
    ].filter(Boolean);
    return parts.join(' · ');
  }
  if (object.objectType === 'tab') {
    const titleSummary = objectFactString(facts, 'titleSummary');
    if (titleSummary) return titleSummary;
  }
  if (object.objectType === 'tab' && pageIdentity?.label) return `${pageIdentity.label} 标签页`;
  return object.pageRole ? `${typeLabel} · ${object.pageRole}` : typeLabel;
}

function toObjectSummary(object: BrowserObject): MkeBrowserObjectSummary {
  const allowPersonalBrowserStateStorage =
    getPersonalBrowserStateStorageEnabled() &&
    allowsPersonalBrowserStateStorage(object.redactionState);
  const effectiveRedactionState = allowPersonalBrowserStateStorage
    ? object.redactionState
    : 'redacted';
  const routeView = {
    pageUrlPattern: summarizeBrowserRouteForPrivacy(object.pageUrlPattern, {
      allowPersonalBrowserStateStorage,
    }),
    rootRoute: summarizeBrowserRouteForPrivacy(object.rootRoute, {
      allowPersonalBrowserStateStorage,
    }),
    currentRoute: summarizeBrowserRouteForPrivacy(object.currentRoute, {
      allowPersonalBrowserStateStorage,
    }),
  };
  const pageIdentity = classifyObjectPageIdentity(object, routeView);
  const facts = summarizeBrowserObjectFactsForPrivacy(asRecord(object.facts), {
    allowPersonalBrowserStateStorage,
  });
  const actionTypes = Array.isArray(object.actionTypes)
    ? object.actionTypes.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    browserObjectId: object.browserObjectId,
    objectType: object.objectType,
    siteFamily: object.siteFamily,
    pageUrlPattern: routeView.pageUrlPattern,
    rootRoute: routeView.rootRoute,
    currentRoute: routeView.currentRoute,
    pageRole: object.pageRole,
    pageModelKey: object.pageModelKey,
    objectFingerprint: object.objectFingerprint,
    browserContextKey: object.browserContextKey,
    ownerType: object.ownerType,
    sourceRoute: object.sourceRoute,
    selectedDataSource: object.selectedDataSource,
    sourceFreshness: object.sourceFreshness,
    lifecycleState: object.lifecycleState,
    tabStatus: object.tabStatus,
    isActive: object.isActive,
    canTabrixOperate: object.canTabrixOperate,
    operabilityReason: object.operabilityReason,
    primaryConclusion: object.primaryConclusion,
    observationCount: object.observationCount,
    facts,
    actionTypes,
    changedGroups: object.changedGroups,
    firstTraceId: object.firstTraceId,
    lastTraceId: object.lastTraceId,
    redactionState: effectiveRedactionState,
    lastObservedAt: object.lastObservedAt,
    createdAt: object.createdAt,
    updatedAt: object.updatedAt,
    pageIdentity,
    display: {
      title: objectTitle(object, pageIdentity),
      subtitle: pageIdentity.label
        ? `${pageIdentity.label} · ${object.objectType}`
        : object.objectType,
      locationLabel: pageIdentity.label,
    },
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
    driftState: recipe.driftState,
    portabilityScope: recipe.portabilityScope,
    originKind: recipe.originKind,
    exportState: recipe.exportState,
    importState: recipe.importState,
    redactionState: recipe.redactionState,
    linkedKnowledgeCount: recipe.linkedKnowledgeIds.length,
    archivedAt: recipe.archivedAt,
    lastUsedAt: recipe.lastUsedAt,
    lastVerifiedAt: recipe.lastVerifiedAt,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

function toObjectStoragePreferences(
  sessionManager: SessionManager,
): MkeObjectStoragePreferencesResponseData {
  const persistence = sessionManager.getPersistenceStatus();
  return {
    personalBrowserStateStorageEnabled: getPersonalBrowserStateStorageEnabled(),
    persistenceMode: persistence.mode,
  };
}

function toBrowserObjectsClearResponse(
  sessionManager: SessionManager,
): MkeBrowserObjectsClearResponseData {
  const persistence = sessionManager.getPersistenceStatus();
  return {
    cleared: true,
    total: sessionManager.countMkeBrowserObjects(),
    persistenceMode: persistence.mode,
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
    '/memory/mke/traces',
    async (request: FastifyRequest<{ Querystring: MkeListQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, MKE_LIST_LIMIT_MAX);
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
    '/memory/mke/browser-objects',
    async (request: FastifyRequest<{ Querystring: BrowserObjectsQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, MKE_LIST_LIMIT_MAX);
      const offset = parsePositiveInt(request.query.offset, 0, Number.MAX_SAFE_INTEGER);
      const scope = parseBrowserObjectsScope(request.query.scope);
      const browserObjects =
        scope === 'object-graph'
          ? sessionManager.listMkeObjectLibraryGraph(limit, offset).map(toObjectSummary)
          : sessionManager.listRecentMkeBrowserObjects(limit, offset).map(toObjectSummary);
      const total =
        scope === 'object-graph'
          ? sessionManager.countMkeObjectLibraryGraph()
          : sessionManager.countMkeBrowserObjects();
      const persistence = sessionManager.getPersistenceStatus();

      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: {
          browserObjects,
          total,
          limit,
          offset,
          persistenceMode: persistence.mode,
        },
      });
    },
  );

  fastify.delete('/memory/mke/browser-objects', async (_request, reply: FastifyReply) => {
    sessionManager.clearMkeBrowserObjects();
    return reply.status(HTTP_STATUS.OK).send({
      status: 'ok',
      data: toBrowserObjectsClearResponse(sessionManager),
    });
  });

  fastify.get('/memory/mke/object-storage-preferences', async (_request, reply: FastifyReply) => {
    return reply.status(HTTP_STATUS.OK).send({
      status: 'ok',
      data: toObjectStoragePreferences(sessionManager),
    });
  });

  fastify.patch(
    '/memory/mke/object-storage-preferences',
    async (
      request: FastifyRequest<{ Body: ObjectStoragePreferencesBody }>,
      reply: FastifyReply,
    ) => {
      if (typeof request.body?.personalBrowserStateStorageEnabled !== 'boolean') {
        return reply.status(HTTP_STATUS.BAD_REQUEST).send({
          status: 'error',
          message: 'personalBrowserStateStorageEnabled must be a boolean',
        });
      }
      setPersonalBrowserStateStorageEnabled(request.body.personalBrowserStateStorageEnabled);
      return reply.status(HTTP_STATUS.OK).send({
        status: 'ok',
        data: toObjectStoragePreferences(sessionManager),
      });
    },
  );

  fastify.get(
    '/memory/mke/knowledge',
    async (request: FastifyRequest<{ Querystring: MkeListQuery }>, reply: FastifyReply) => {
      const limit = parsePositiveInt(request.query.limit, 20, MKE_LIST_LIMIT_MAX);
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
      const limit = parsePositiveInt(request.query.limit, 20, MKE_LIST_LIMIT_MAX);
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
