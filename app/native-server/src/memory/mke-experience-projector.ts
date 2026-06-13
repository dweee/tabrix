import { createHash } from 'node:crypto';

import type {
  ExperienceRecipe,
  ExperienceRecipeRepository,
  KnowledgeModelRepository,
  MemoryTrace,
  MemoryTraceRepository,
} from './db';
import { buildMkePageModelKey } from './mke-knowledge-projector';

export interface MkeExperienceProjectionInput {
  cursorCreatedAt?: string | null;
  limit?: number;
  nowIso?: string;
}

export interface MkeExperienceProjectionResult {
  processedTraceCount: number;
  skippedTraceCount: number;
  rejectedSensitiveSequenceCount: number;
  savedExperienceCount: number;
  nextCursorCreatedAt: string | null;
  experienceIds: string[];
}

interface TaskTraceGroup {
  taskId: string;
  traces: MemoryTrace[];
}

interface RecipeBasis {
  taskId: string;
  siteFamily: string;
  pageModelKey: string;
  pageRole: string | null;
  pageUrlPattern: string | null;
  sourceTraceIds: string[];
  linkedKnowledgeIds: string[];
  actionTraces: MemoryTrace[];
  avgDurationMs: number | null;
}

const REPLAYABLE_ACTION_TOOLS = new Set([
  'chrome_collect_result_cards',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_navigate',
]);

const UNTRUSTED_EVALUATOR_NAMES = new Set(['', 'unknown', 'default', 'system', 'tabrix']);

const SENSITIVE_KEY_FRAGMENTS = [
  'account',
  'authorization',
  'captcha',
  'cookie',
  'credential',
  'email',
  'formvalue',
  'otp',
  'password',
  'phone',
  'rawbody',
  'rawinput',
  'rawvalue',
  'secret',
  'sessionid',
  'smscode',
  'submittedvalue',
  'token',
  'username',
  'verificationcode',
  '验证码',
  '账号',
  '手机号',
  '密码',
];

const INTERNAL_SAFE_KEY_NAMES = new Set([
  'feedbacktoken',
  'tasksessionid',
  'tracebindinghash',
  'tokenssavedestimatetotal',
]);

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
}

function hasSensitiveKey(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(hasSensitiveKey);
  if (typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    if (INTERNAL_SAFE_KEY_NAMES.has(normalized)) continue;
    if (SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) return true;
    if (hasSensitiveKey(child)) return true;
  }
  return false;
}

function traceContainsSensitiveData(trace: MemoryTrace): boolean {
  return (
    trace.redactionState !== 'redacted' ||
    hasSensitiveKey(trace.requestParams) ||
    hasSensitiveKey(trace.response) ||
    hasSensitiveKey(trace.actionTarget) ||
    hasSensitiveKey(trace.preObservation) ||
    hasSensitiveKey(trace.postObservation) ||
    hasSensitiveKey(trace.postActionDelta)
  );
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function hasVerifiedAiSuccessFeedback(trace: MemoryTrace): boolean {
  const feedback = readObject(trace.aiFeedback);
  const sourceKind = readString(feedback?.sourceKind);
  const businessStatus = readString(feedback?.businessStatus);
  const summary = readString(feedback?.summary);
  const confidence =
    typeof feedback?.confidence === 'number' && Number.isFinite(feedback.confidence)
      ? feedback.confidence
      : null;
  return (
    sourceKind === 'ai_feedback' &&
    businessStatus === 'achieved' &&
    typeof confidence === 'number' &&
    confidence >= 0.9 &&
    typeof summary === 'string' &&
    summary.trim().length >= 8
  );
}

function isBusinessAchieved(trace: MemoryTrace): boolean {
  return hasVerifiedAiSuccessFeedback(trace);
}

function groupByTask(traces: MemoryTrace[]): TaskTraceGroup[] {
  const groups = new Map<string, MemoryTrace[]>();
  for (const trace of traces) {
    const taskTraces = groups.get(trace.taskId);
    if (taskTraces) {
      taskTraces.push(trace);
    } else {
      groups.set(trace.taskId, [trace]);
    }
  }
  return [...groups.entries()].map(([taskId, taskTraces]) => ({
    taskId,
    traces: taskTraces,
  }));
}

function containsSensitiveTrace(group: TaskTraceGroup): boolean {
  return group.traces.some(traceContainsSensitiveData);
}

function traceTimeMs(trace: MemoryTrace): number {
  const createdAt = Date.parse(trace.createdAt);
  return Number.isFinite(createdAt) ? createdAt : 0;
}

function chooseContextualPageAnchor(input: {
  actionTraces: MemoryTrace[];
  allTraces: MemoryTrace[];
  groupTraceIds: Set<string>;
}): MemoryTrace | null {
  const candidates = input.allTraces.filter(
    (trace) =>
      !input.groupTraceIds.has(trace.traceId) &&
      !traceContainsSensitiveData(trace) &&
      trace.siteFamily &&
      buildMkePageModelKey(trace) &&
      typeof trace.tabId === 'number' &&
      input.actionTraces.some((action) => action.tabId === trace.tabId),
  );

  let best: { trace: MemoryTrace; score: number } | null = null;
  for (const action of input.actionTraces) {
    if (typeof action.tabId !== 'number') continue;
    const actionTime = traceTimeMs(action);
    for (const candidate of candidates) {
      if (candidate.tabId !== action.tabId) continue;
      const candidateTime = traceTimeMs(candidate);
      const isBeforeAction = candidateTime <= actionTime;
      const distance = Math.abs(actionTime - candidateTime);
      // Prefer the most recent prior page read/collection for the same tab.
      // A post-action detail read is useful fallback evidence, but it should not
      // replace the page model where the action target was discovered.
      const score = distance + (isBeforeAction ? 0 : 1_000_000_000);
      if (!best || score < best.score) best = { trace: candidate, score };
    }
  }
  return best?.trace ?? null;
}

function choosePageAnchor(input: {
  traces: MemoryTrace[];
  actionTraces: MemoryTrace[];
  allTraces: MemoryTrace[];
}): MemoryTrace | null {
  const direct =
    input.traces.find((trace) => trace.siteFamily && buildMkePageModelKey(trace)) ??
    input.traces.find((trace) => trace.siteFamily) ??
    null;
  if (direct) return direct;
  return chooseContextualPageAnchor({
    actionTraces: input.actionTraces,
    allTraces: input.allTraces,
    groupTraceIds: new Set(input.traces.map((trace) => trace.traceId)),
  });
}

function buildTargetTemplate(trace: MemoryTrace): Record<string, unknown> {
  const request = readObject(trace.requestParams);
  return {
    targetPolicy: readString(request?.ref)
      ? 'reuse_current_page_target_hint'
      : 'discover_current_page_target',
    selectorType: readString(request?.selectorType) ?? null,
    candidateActionId: readString(request?.candidateActionId) ?? null,
  };
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readResponseDigest(trace: MemoryTrace): Record<string, unknown> | null {
  const response = readObject(trace.response);
  return readObject(response?.payloadDigest) ?? response;
}

function readCollectResultCardsReuseProfile(trace: MemoryTrace): {
  minResults: number;
  maxScrolls: number | null;
  startFromTop: boolean;
  selectedDataSource: string | null;
  observedResultCount: number | null;
} {
  const request = readObject(trace.requestParams);
  const response = readResponseDigest(trace);
  const collection = readObject(response?.collection);
  return {
    minResults:
      readFiniteNumber(request?.minResults) ??
      readFiniteNumber(response?.requestedMinResults) ??
      readFiniteNumber(response?.observedResultCount) ??
      10,
    maxScrolls: readFiniteNumber(request?.maxScrolls),
    startFromTop:
      readBoolean(request?.startFromTop) ?? readBoolean(collection?.startFromTop) ?? true,
    selectedDataSource: readString(response?.selectedDataSource),
    observedResultCount: readFiniteNumber(response?.observedResultCount),
  };
}

function buildStepTemplate(trace: MemoryTrace, order: number): Record<string, unknown> | null {
  if (!REPLAYABLE_ACTION_TOOLS.has(trace.toolName)) return null;
  if (trace.toolSuccess !== true || !isBusinessAchieved(trace)) return null;

  if (trace.toolName === 'chrome_fill_or_select') {
    return {
      order,
      toolName: trace.toolName,
      argsTemplate: {
        tab: '{{targetTabId}}',
        target: buildTargetTemplate(trace),
        inputSlot: '{{inputText}}',
      },
    };
  }

  if (trace.toolName === 'chrome_navigate') {
    return {
      order,
      toolName: trace.toolName,
      argsTemplate: {
        tab: '{{targetTabId}}',
        navigationTarget: '{{targetUrl}}',
      },
    };
  }

  if (trace.toolName === 'chrome_collect_result_cards') {
    const reuseProfile = readCollectResultCardsReuseProfile(trace);
    return {
      order,
      toolName: trace.toolName,
      argsTemplate: {
        tab: '{{targetTabId}}',
        minResults: '{{minResults}}',
        maxScrolls: '{{maxScrolls}}',
        startFromTop: '{{startFromTop}}',
      },
      reuseProfile: {
        minResults: reuseProfile.minResults,
        maxScrolls: reuseProfile.maxScrolls,
        startFromTop: reuseProfile.startFromTop,
        selectedDataSource: reuseProfile.selectedDataSource,
        observedResultCount: reuseProfile.observedResultCount,
      },
    };
  }

  if (trace.toolName === 'chrome_close_tabs') {
    return {
      order,
      toolName: trace.toolName,
      argsTemplate: {
        cleanupScope: 'run_owned_tabs',
      },
    };
  }

  return {
    order,
    toolName: trace.toolName,
    argsTemplate: {
      tab: '{{targetTabId}}',
      target: buildTargetTemplate(trace),
    },
  };
}

function buildRecipeFingerprint(input: {
  siteFamily: string;
  pageModelKey: string;
  actionTools: string[];
  actionProfiles: Array<Record<string, unknown>>;
}): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

function buildActionProfile(trace: MemoryTrace): Record<string, unknown> {
  if (trace.toolName === 'chrome_collect_result_cards') {
    const reuseProfile = readCollectResultCardsReuseProfile(trace);
    return {
      toolName: trace.toolName,
      minResults: reuseProfile.minResults,
      maxScrolls: reuseProfile.maxScrolls,
      startFromTop: reuseProfile.startFromTop,
      selectedDataSource: reuseProfile.selectedDataSource,
    };
  }
  return { toolName: trace.toolName };
}

function buildCollectSuccessChecks(actionTraces: MemoryTrace[]): Array<Record<string, unknown>> {
  return actionTraces
    .filter((trace) => trace.toolName === 'chrome_collect_result_cards')
    .map((trace) => {
      const reuseProfile = readCollectResultCardsReuseProfile(trace);
      return {
        toolName: trace.toolName,
        observedResultCountAtLeast: reuseProfile.minResults,
        selectedDataSource: reuseProfile.selectedDataSource,
        requiredStatus: 'complete_enough',
      };
    });
}

function buildRecipeBasis(
  group: TaskTraceGroup,
  knowledgeRepo: KnowledgeModelRepository,
  allTraces: MemoryTrace[],
): RecipeBasis | null {
  const actionTraces = group.traces.filter(
    (trace) =>
      REPLAYABLE_ACTION_TOOLS.has(trace.toolName) &&
      trace.toolSuccess === true &&
      isBusinessAchieved(trace),
  );
  if (actionTraces.length === 0) return null;

  const anchor = choosePageAnchor({
    traces: group.traces,
    actionTraces,
    allTraces,
  });
  if (!anchor?.siteFamily) return null;
  const pageModelKey = buildMkePageModelKey(anchor);
  if (!pageModelKey) return null;
  const knowledge = knowledgeRepo.findLatestByPage({
    siteFamily: anchor.siteFamily,
    pageModelKey,
  });
  if (!knowledge) return null;

  const durationValues = group.traces
    .map((trace) => trace.durationMs)
    .filter((duration): duration is number => typeof duration === 'number');

  return {
    taskId: group.taskId,
    siteFamily: anchor.siteFamily,
    pageModelKey,
    pageRole: anchor.pageRole,
    pageUrlPattern: anchor.pageUrlPattern,
    sourceTraceIds: [...new Set([...group.traces.map((trace) => trace.traceId), anchor.traceId])],
    linkedKnowledgeIds: [knowledge.knowledgeId],
    actionTraces,
    avgDurationMs:
      durationValues.length > 0
        ? Math.round(
            durationValues.reduce((sum, duration) => sum + duration, 0) / durationValues.length,
          )
        : null,
  };
}

function buildRecipeInput(
  basis: RecipeBasis,
  nowIso: string,
): Parameters<ExperienceRecipeRepository['save']>[0] {
  const steps = basis.actionTraces
    .map((trace, index) => buildStepTemplate(trace, index + 1))
    .filter((step): step is Record<string, unknown> => step !== null);
  const actionTools = basis.actionTraces.map((trace) => trace.toolName);
  const actionProfiles = basis.actionTraces.map(buildActionProfile);
  const collectSuccessChecks = buildCollectSuccessChecks(basis.actionTraces);
  const recipeFingerprint = buildRecipeFingerprint({
    siteFamily: basis.siteFamily,
    pageModelKey: basis.pageModelKey,
    actionTools,
    actionProfiles,
  });

  return {
    recipeName: `MKE recipe ${recipeFingerprint.slice(0, 8)}`,
    scenarioKey: `mke:${basis.siteFamily}:${basis.pageModelKey}`,
    taskSignature: `tools:${actionTools.join('>')}`,
    recipeFingerprint,
    recipeVersion: 1,
    siteFamily: basis.siteFamily,
    pageModelKey: basis.pageModelKey,
    pageRole: basis.pageRole,
    preconditions: {
      schema: 'tabrix_mke_preconditions_v1',
      siteFamily: basis.siteFamily,
      pageModelKey: basis.pageModelKey,
      pageRole: basis.pageRole,
    },
    variableSchema: {
      schema: 'tabrix_mke_recipe_variables_v1',
      targetTabId: { type: 'number', required: true },
      targetUrl: { type: 'string', required: false },
      inputText: { type: 'string', required: false },
      minResults: { type: 'number', required: false, default: 10 },
      maxScrolls: { type: 'number', required: false },
      startFromTop: { type: 'boolean', required: false, default: true },
    },
    steps,
    successCheck: {
      schema: 'tabrix_mke_success_check_v1',
      requiredFreshRead: true,
      acceptedToolOutcome: 'completed',
      ...(collectSuccessChecks.length > 0 ? { collectResultCards: collectSuccessChecks } : {}),
    },
    recovery: {
      schema: 'tabrix_mke_recovery_v1',
      onMismatch: 'require_fresh_read_and_replan',
    },
    sourceTraceIds: basis.sourceTraceIds,
    linkedKnowledgeIds: basis.linkedKnowledgeIds,
    successCount: 1,
    failureCount: 0,
    avgDurationMs: basis.avgDurationMs,
    driftState: 'unverified_template',
    portabilityScope: 'local',
    originKind: 'local_mined',
    compatibility: {
      schema: 'tabrix_mke_recipe_compatibility_v1',
      pageUrlPattern: basis.pageUrlPattern,
      requiresKnowledgeMatch: true,
    },
    exportState: 'not_exportable',
    importState: 'native',
    redactionState: 'template_only',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export class MkeExperienceProjector {
  constructor(
    private readonly traceRepo: MemoryTraceRepository,
    private readonly knowledgeRepo: KnowledgeModelRepository,
    private readonly experienceRepo: ExperienceRecipeRepository,
  ) {}

  public projectIdleBatch(input: MkeExperienceProjectionInput = {}): MkeExperienceProjectionResult {
    const traces = this.traceRepo.listAfter({
      cursorCreatedAt: input.cursorCreatedAt ?? null,
      limit: input.limit ?? 100,
    });
    if (traces.length === 0) {
      return {
        processedTraceCount: 0,
        skippedTraceCount: 0,
        rejectedSensitiveSequenceCount: 0,
        savedExperienceCount: 0,
        nextCursorCreatedAt: input.cursorCreatedAt ?? null,
        experienceIds: [],
      };
    }

    const nowIso = input.nowIso ?? new Date().toISOString();
    const savedById = new Map<string, ExperienceRecipe>();
    let skippedTraceCount = 0;
    let rejectedSensitiveSequenceCount = 0;

    for (const group of groupByTask(traces)) {
      if (containsSensitiveTrace(group)) {
        rejectedSensitiveSequenceCount += 1;
        skippedTraceCount += group.traces.length;
        continue;
      }
      const basis = buildRecipeBasis(group, this.knowledgeRepo, traces);
      if (!basis) {
        skippedTraceCount += group.traces.length;
        continue;
      }
      const recipe = this.experienceRepo.save(buildRecipeInput(basis, nowIso));
      savedById.set(recipe.experienceId, recipe);
    }
    const saved = [...savedById.values()];

    return {
      processedTraceCount: traces.length,
      skippedTraceCount,
      rejectedSensitiveSequenceCount,
      savedExperienceCount: saved.length,
      nextCursorCreatedAt: traces[traces.length - 1]?.createdAt ?? input.cursorCreatedAt ?? null,
      experienceIds: saved.map((recipe) => recipe.experienceId),
    };
  }
}
