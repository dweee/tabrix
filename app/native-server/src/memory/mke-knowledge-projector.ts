import type {
  BrowserObject,
  BrowserObjectRepository,
  KnowledgeModel,
  KnowledgeModelRepository,
} from './db';
import type { MemoryTrace } from './db';

export interface MkeKnowledgeProjectionInput {
  cursorCreatedAt?: string | null;
  limit?: number;
  nowIso?: string;
}

export interface MkeKnowledgeProjectionResult {
  processedTraceCount: number;
  skippedTraceCount: number;
  upsertedKnowledgeCount: number;
  nextCursorCreatedAt: string | null;
  knowledgeIds: string[];
}

interface ObjectGroup {
  siteFamily: string;
  pageModelKey: string;
  pageUrlPattern: string | null;
  pageRole: string;
  objects: BrowserObject[];
}

interface BlockedKnowledgeKey {
  siteFamily: string;
  pageModelKey: string;
}

export function buildMkePageModelKey(trace: MemoryTrace): string | null {
  if (trace.pageModelKey) return trace.pageModelKey;
  if (!trace.siteFamily) return null;
  return `page:${trace.siteFamily}:${trace.pageRole ?? 'unknown_page_role'}`;
}

function incrementCounter(map: Map<string, number>, value: string | null | undefined): void {
  if (!value) return;
  map.set(value, (map.get(value) ?? 0) + 1);
}

function countersToObject(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function ratio(part: number, total: number): number {
  if (total <= 0) return 0;
  return part / total;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : [];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPositionalSelector(selector: string | null): boolean {
  if (!selector) return false;
  return /\b:nth-of-type\(/i.test(selector) || /\b:nth-child\(/i.test(selector);
}

function isSnapshotTargetRef(targetRef: string | null): boolean {
  if (!targetRef) return false;
  return /^(ref_|ref_text_|ref_fallback_)/i.test(targetRef);
}

const BLOCKED_PAGE_SIGNAL_PATTERN =
  /\b(captcha|recaptcha|challenge|verification|security[-_]?check|human[-_]?check|verify(uuid|type|biz)?|user[_-]?verification[_-]?required|login[_-]?required|auth[_-]?required|access[_-]?denied|restricted)\b|安全验证|人机验证|滑块验证|验证码|登录验证/i;

function stringHasBlockedPageSignal(value: string | null | undefined): boolean {
  return typeof value === 'string' && BLOCKED_PAGE_SIGNAL_PATTERN.test(value);
}

function valueHasBlockedPageSignal(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return stringHasBlockedPageSignal(value);
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  if (Array.isArray(value)) return value.some(valueHasBlockedPageSignal);
  if (typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([key, entry]) => stringHasBlockedPageSignal(key) || valueHasBlockedPageSignal(entry),
  );
}

function isExplicitlyNotOperable(value: unknown): boolean {
  return value === false || value === 0;
}

function isExplicitlyOperable(value: unknown): boolean {
  return value === true || value === 1;
}

function isBlockedKnowledgeSource(object: BrowserObject): boolean {
  return (
    isExplicitlyNotOperable(object.canTabrixOperate) ||
    stringHasBlockedPageSignal(object.operabilityReason) ||
    stringHasBlockedPageSignal(object.lifecycleState) ||
    stringHasBlockedPageSignal(object.pageUrlPattern) ||
    stringHasBlockedPageSignal(object.rootRoute) ||
    stringHasBlockedPageSignal(object.currentRoute) ||
    valueHasBlockedPageSignal(object.facts) ||
    valueHasBlockedPageSignal(object.targetability)
  );
}

function isSessionScopedAction(object: BrowserObject, actionType: string): boolean {
  const facts = readObject(object.facts);
  const targetability = readObject(object.targetability);
  const actionTarget = readObject(facts?.actionTarget) ?? readObject(targetability?.actionTarget);
  const sessionOnlyTarget =
    readObject(facts?.sessionOnlyTarget) ?? readObject(targetability?.sessionOnlyTarget);
  const selector =
    typeof actionTarget?.selector === 'string'
      ? actionTarget.selector
      : typeof sessionOnlyTarget?.selector === 'string'
        ? sessionOnlyTarget.selector
        : null;
  if (object.objectType === 'action_target') {
    const targetRef = typeof targetability?.targetRef === 'string' ? targetability.targetRef : null;
    if (isSnapshotTargetRef(targetRef)) return true;
    if (actionType !== 'click') return false;
    return Boolean(
      targetRef ||
      isPositionalSelector(selector) ||
      readObject(actionTarget?.center) ||
      readObject(actionTarget?.rect) ||
      readObject(sessionOnlyTarget?.center) ||
      readObject(sessionOnlyTarget?.rect) ||
      targetability?.rect,
    );
  }
  if (actionType !== 'click_result_card') return false;
  return Boolean(
    isPositionalSelector(selector) ||
    readObject(actionTarget?.center) ||
    readObject(actionTarget?.rect) ||
    readObject(sessionOnlyTarget?.center) ||
    readObject(sessionOnlyTarget?.rect) ||
    readObject(sessionOnlyTarget?.cardRect) ||
    targetability?.rect,
  );
}

function roundedScore(value: number | null): number {
  if (value === null) return 0;
  return Math.max(0, Math.min(1, Math.round(value * 100) / 100));
}

function groupProjectableObjects(objects: BrowserObject[]): {
  groups: ObjectGroup[];
  skippedObjectCount: number;
  blockedKnowledgeKeys: BlockedKnowledgeKey[];
} {
  const groups = new Map<string, ObjectGroup>();
  const blockedKeys = new Map<string, BlockedKnowledgeKey>();
  let skippedObjectCount = 0;

  for (const object of objects) {
    if (object.siteFamily === 'unknown' || object.pageModelKey === 'unknown') {
      skippedObjectCount += 1;
      continue;
    }
    if (isBlockedKnowledgeSource(object)) {
      blockedKeys.set(`${object.siteFamily}\u0000${object.pageModelKey}`, {
        siteFamily: object.siteFamily,
        pageModelKey: object.pageModelKey,
      });
      skippedObjectCount += 1;
      continue;
    }
    const groupKey = `${object.siteFamily}\u0000${object.pageModelKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.objects.push(object);
      if (!existing.pageUrlPattern && object.pageUrlPattern) {
        existing.pageUrlPattern = object.pageUrlPattern;
      }
      if (existing.pageRole === 'unknown_page_role' && object.pageRole) {
        existing.pageRole = object.pageRole;
      }
      continue;
    }
    groups.set(groupKey, {
      siteFamily: object.siteFamily,
      pageModelKey: object.pageModelKey,
      pageUrlPattern: object.pageUrlPattern,
      pageRole: object.pageRole ?? 'unknown_page_role',
      objects: [object],
    });
  }

  for (const groupKey of blockedKeys.keys()) {
    const grouped = groups.get(groupKey);
    if (grouped) {
      skippedObjectCount += grouped.objects.length;
      groups.delete(groupKey);
    }
  }

  return {
    groups: [...groups.values()],
    skippedObjectCount,
    blockedKnowledgeKeys: [...blockedKeys.values()],
  };
}

function buildKnowledgeInput(
  group: ObjectGroup,
  nowIso: string,
): Parameters<KnowledgeModelRepository['upsert']>[0] {
  const objectTypeCounts = new Map<string, number>();
  const pageStateCounts = new Map<string, number>();
  const dataSourceCounts = new Map<string, number>();
  const sourceRouteCounts = new Map<string, number>();
  const freshnessCounts = new Map<string, number>();
  const actionKindCounts = new Map<string, number>();
  const reusableActionKindCounts = new Map<string, number>();
  const sessionScopedActionKindCounts = new Map<string, number>();
  const sourceTraceIds: string[] = [];
  const sourceObjectIds: string[] = [];
  const confidenceScores: number[] = [];
  const resultCardActionKinds = new Map<string, number>();
  const resultCardRanks: number[] = [];
  let freshResultCardUrlRequiredCount = 0;
  let unavailableObjectCount = 0;
  let observationCount = 0;
  let resultCardCount = 0;
  let clickableResultCardCount = 0;

  for (const object of group.objects) {
    sourceObjectIds.push(object.browserObjectId);
    sourceTraceIds.push(...object.sourceTraceIds);
    observationCount += object.observationCount;
    incrementCounter(objectTypeCounts, object.objectType);
    incrementCounter(pageStateCounts, object.lifecycleState);
    incrementCounter(dataSourceCounts, object.selectedDataSource);
    incrementCounter(sourceRouteCounts, object.sourceRoute);
    incrementCounter(freshnessCounts, object.sourceFreshness);
    for (const actionType of readStringArray(object.actionTypes)) {
      incrementCounter(actionKindCounts, actionType);
      if (isSessionScopedAction(object, actionType)) {
        incrementCounter(sessionScopedActionKindCounts, actionType);
      } else {
        incrementCounter(reusableActionKindCounts, actionType);
      }
      if (object.objectType === 'result_card') {
        incrementCounter(resultCardActionKinds, actionType);
      }
    }
    if (object.confidenceScore !== null) confidenceScores.push(object.confidenceScore);
    if (isExplicitlyNotOperable(object.canTabrixOperate)) unavailableObjectCount += 1;
    if (object.objectType === 'result_card') {
      resultCardCount += 1;
      const actionTypes = readStringArray(object.actionTypes);
      if (actionTypes.includes('open_via_url')) {
        freshResultCardUrlRequiredCount += 1;
      }
      if (
        isExplicitlyOperable(object.canTabrixOperate) ||
        readStringArray(object.actionTypes).length > 0
      ) {
        clickableResultCardCount += 1;
      }
      const rank = readFiniteNumber(readObject(object.facts)?.rank);
      if (rank !== null) resultCardRanks.push(rank);
    }
  }

  const lastObservedAt =
    group.objects
      .map((object) => object.updatedAt)
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? nowIso;
  const archivedAt = stringHasBlockedPageSignal(group.pageUrlPattern) ? nowIso : null;

  return {
    siteFamily: group.siteFamily,
    pageUrlPattern: group.pageUrlPattern,
    pageRole: group.pageRole,
    pageModelKey: group.pageModelKey,
    modelVersion: 1,
    pageStateModel: {
      schema: 'tabrix_mke_page_state_model_v1',
      states: countersToObject(pageStateCounts),
      observationCount,
      lastObservedAt,
    },
    objectGraph: {
      schema: 'tabrix_mke_object_graph_summary_v1',
      sourceObjectCount: group.objects.length,
      objectTypeCounts: countersToObject(objectTypeCounts),
      resultCardCount,
      resultCardSummary: {
        schema: 'tabrix_mke_result_card_summary_v1',
        count: resultCardCount,
        clickableCount: clickableResultCardCount,
        rankRange:
          resultCardRanks.length > 0
            ? {
                min: Math.min(...resultCardRanks),
                max: Math.max(...resultCardRanks),
              }
            : null,
        rawCardTextCopied: false,
      },
      sourceObjectIds: uniqueStrings(sourceObjectIds).slice(0, 200),
      rawPayloadCopied: false,
    },
    actionSurface: {
      schema: 'tabrix_mke_action_surface_summary_v1',
      actionKindCounts: countersToObject(actionKindCounts),
      reusableActionKinds: [...reusableActionKindCounts.keys()].sort(),
      sessionScopedActionKinds: countersToObject(sessionScopedActionKindCounts),
      resultCardActionKinds: countersToObject(resultCardActionKinds),
      resultCardReusePolicy: {
        schema: 'tabrix_mke_result_card_reuse_policy_v1',
        freshResultCardUrlRequired: freshResultCardUrlRequiredCount > 0,
        freshResultCardUrlRequiredCount,
        reusableActionMeaning:
          'result cards require a fresh chrome_collect_result_cards read before opening the current card URL',
        nonReusableTargetKinds: ['selector', 'rect', 'center', 'snapshot_ref'],
      },
    },
    dataSourceModel: {
      schema: 'tabrix_mke_data_source_model_v1',
      selectedDataSourceCounts: countersToObject(dataSourceCounts),
      sourceRouteCounts: countersToObject(sourceRouteCounts),
      freshnessCounts: countersToObject(freshnessCounts),
    },
    navigationModel: {
      schema: 'tabrix_mke_navigation_model_v1',
      pageUrlPattern: group.pageUrlPattern,
    },
    failureSignal: {
      schema: 'tabrix_mke_failure_signal_v1',
      unavailableObjectCount,
    },
    sourceTraceIds: uniqueStrings(sourceTraceIds),
    observationCount,
    successfulUseCount: 0,
    failedUseCount: 0,
    confidenceScore: roundedScore(average(confidenceScores)),
    driftScore: null,
    archivedAt,
    lastObservedAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export class MkeKnowledgeProjector {
  constructor(
    private readonly browserObjectRepo: BrowserObjectRepository,
    private readonly knowledgeRepo: KnowledgeModelRepository,
  ) {}

  public projectIdleBatch(input: MkeKnowledgeProjectionInput = {}): MkeKnowledgeProjectionResult {
    const objects = this.browserObjectRepo.listUpdatedAfter({
      cursorUpdatedAt: input.cursorCreatedAt ?? null,
      limit: input.limit ?? 100,
    });
    if (objects.length === 0) {
      return {
        processedTraceCount: 0,
        skippedTraceCount: 0,
        upsertedKnowledgeCount: 0,
        nextCursorCreatedAt: input.cursorCreatedAt ?? null,
        knowledgeIds: [],
      };
    }

    const nowIso = input.nowIso ?? new Date().toISOString();
    const { groups, skippedObjectCount, blockedKnowledgeKeys } = groupProjectableObjects(objects);
    for (const key of blockedKnowledgeKeys) {
      const existing = this.knowledgeRepo.findLatestByPage(key);
      if (existing) {
        this.knowledgeRepo.archive({ knowledgeId: existing.knowledgeId, archivedAt: nowIso });
      }
    }
    const upserted: KnowledgeModel[] = [];
    for (const group of groups) {
      upserted.push(this.knowledgeRepo.upsert(buildKnowledgeInput(group, nowIso)));
    }

    return {
      processedTraceCount: objects.length,
      skippedTraceCount: skippedObjectCount,
      upsertedKnowledgeCount: upserted.length,
      nextCursorCreatedAt: objects[objects.length - 1]?.updatedAt ?? input.cursorCreatedAt ?? null,
      knowledgeIds: upserted.map((knowledge) => knowledge.knowledgeId),
    };
  }
}
