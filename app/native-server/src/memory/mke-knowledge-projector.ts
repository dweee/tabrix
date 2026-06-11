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

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

function groupProjectableObjects(objects: BrowserObject[]): {
  groups: ObjectGroup[];
  skippedObjectCount: number;
} {
  const groups = new Map<string, ObjectGroup>();
  let skippedObjectCount = 0;

  for (const object of objects) {
    if (object.siteFamily === 'unknown' || object.pageModelKey === 'unknown') {
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

  return { groups: [...groups.values()], skippedObjectCount };
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
  const sourceTraceIds: string[] = [];
  const sourceObjectIds: string[] = [];
  let unavailableObjectCount = 0;
  let observationCount = 0;

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
    }
    if (object.canTabrixOperate === false) unavailableObjectCount += 1;
  }

  const lastObservedAt =
    group.objects
      .map((object) => object.updatedAt)
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? nowIso;

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
      sourceObjectIds: uniqueStrings(sourceObjectIds).slice(0, 200),
      rawPayloadCopied: false,
    },
    actionSurface: {
      schema: 'tabrix_mke_action_surface_summary_v1',
      actionKindCounts: countersToObject(actionKindCounts),
      reusableActionKinds: [...actionKindCounts.keys()].sort(),
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
    confidenceScore: 0,
    driftScore: null,
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
    const { groups, skippedObjectCount } = groupProjectableObjects(objects);
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
