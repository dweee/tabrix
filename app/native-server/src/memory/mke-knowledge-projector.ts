import { createHash } from 'node:crypto';

import type { KnowledgeModel, KnowledgeModelRepository, MemoryTraceRepository } from './db';
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

interface TraceGroup {
  siteFamily: string;
  pageModelKey: string;
  pageUrlPattern: string | null;
  pageRole: string;
  traces: MemoryTrace[];
}

const PROJECTABLE_TOOLS = new Set([
  'chrome_read_page',
  'chrome_click_element',
  'chrome_fill_or_select',
  'chrome_navigate',
  'chrome_close_tabs',
]);

export function buildMkePageModelKey(trace: MemoryTrace): string | null {
  if (trace.pageModelKey) return trace.pageModelKey;
  if (!trace.siteFamily) return null;
  const basis = JSON.stringify({
    siteFamily: trace.siteFamily,
    pageRole: trace.pageRole ?? 'unknown_page_role',
    pageUrlPattern: trace.pageUrlPattern ?? 'unknown_page_url_pattern',
  });
  return `page:${createHash('sha256').update(basis).digest('hex').slice(0, 16)}`;
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

function isBusinessAchieved(trace: MemoryTrace): boolean {
  return (
    trace.businessSuccess === 'achieved' ||
    trace.businessSuccess === 'proven' ||
    trace.businessSuccess === 'true'
  );
}

function isBusinessFailed(trace: MemoryTrace): boolean {
  return (
    trace.businessSuccess === 'not_achieved' ||
    trace.businessSuccess === 'not_proven' ||
    trace.businessSuccess === 'failed' ||
    trace.businessSuccess === 'false'
  );
}

function roundedScore(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function groupProjectableTraces(traces: MemoryTrace[]): {
  groups: TraceGroup[];
  skippedTraceCount: number;
} {
  const groups = new Map<string, TraceGroup>();
  let skippedTraceCount = 0;

  for (const trace of traces) {
    if (!PROJECTABLE_TOOLS.has(trace.toolName)) {
      skippedTraceCount += 1;
      continue;
    }
    if (!trace.siteFamily) {
      skippedTraceCount += 1;
      continue;
    }
    const pageModelKey = buildMkePageModelKey(trace);
    if (!pageModelKey) {
      skippedTraceCount += 1;
      continue;
    }
    const groupKey = `${trace.siteFamily}\u0000${pageModelKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.traces.push(trace);
      if (!existing.pageUrlPattern && trace.pageUrlPattern) {
        existing.pageUrlPattern = trace.pageUrlPattern;
      }
      if (existing.pageRole === 'unknown_page_role' && trace.pageRole) {
        existing.pageRole = trace.pageRole;
      }
      continue;
    }
    groups.set(groupKey, {
      siteFamily: trace.siteFamily,
      pageModelKey,
      pageUrlPattern: trace.pageUrlPattern,
      pageRole: trace.pageRole ?? 'unknown_page_role',
      traces: [trace],
    });
  }

  return { groups: [...groups.values()], skippedTraceCount };
}

function buildKnowledgeInput(
  group: TraceGroup,
  nowIso: string,
): Parameters<KnowledgeModelRepository['upsert']>[0] {
  const toolCounts = new Map<string, number>();
  const pageStateCounts = new Map<string, number>();
  const dataSourceCounts = new Map<string, number>();
  const sourceRouteCounts = new Map<string, number>();
  const freshnessCounts = new Map<string, number>();
  const fallbackCounts = new Map<string, number>();
  const errorCounts = new Map<string, number>();
  const sourceTraceIds: string[] = [];
  let successful = 0;
  let failed = 0;
  let totalDurationMs = 0;
  let durationCount = 0;

  for (const trace of group.traces) {
    sourceTraceIds.push(trace.traceId);
    incrementCounter(toolCounts, trace.toolName);
    incrementCounter(pageStateCounts, trace.pageState);
    incrementCounter(dataSourceCounts, trace.selectedDataSource);
    incrementCounter(sourceRouteCounts, trace.sourceRoute);
    incrementCounter(freshnessCounts, trace.freshness);
    incrementCounter(fallbackCounts, trace.fallbackUsed);
    incrementCounter(errorCounts, trace.errorCode);
    if (isBusinessAchieved(trace)) successful += 1;
    if (isBusinessFailed(trace) || trace.toolSuccess === false) failed += 1;
    if (typeof trace.durationMs === 'number') {
      totalDurationMs += trace.durationMs;
      durationCount += 1;
    }
  }

  const observationCount = group.traces.length;
  const distinctPageStateCount = pageStateCounts.size;
  const failureRate = ratio(failed, observationCount);
  const stateDrift =
    distinctPageStateCount > 1 ? Math.min(0.6, (distinctPageStateCount - 1) * 0.2) : 0;
  const driftScore = roundedScore(Math.max(stateDrift, failureRate * 0.8));
  const confidenceScore = roundedScore(
    0.2 +
      Math.min(0.35, observationCount * 0.08) +
      ratio(successful, observationCount) * 0.45 -
      driftScore * 0.25,
  );
  const lastObservedAt = group.traces[group.traces.length - 1]?.createdAt ?? nowIso;

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
      sourceTraceCount: observationCount,
      toolCounts: countersToObject(toolCounts),
      rawPayloadCopied: false,
    },
    actionSurface: {
      schema: 'tabrix_mke_action_surface_summary_v1',
      toolCounts: countersToObject(toolCounts),
      reusableActionKinds: [...toolCounts.keys()]
        .filter((toolName) => toolName !== 'chrome_read_page')
        .sort(),
    },
    dataSourceModel: {
      schema: 'tabrix_mke_data_source_model_v1',
      selectedDataSourceCounts: countersToObject(dataSourceCounts),
      sourceRouteCounts: countersToObject(sourceRouteCounts),
      freshnessCounts: countersToObject(freshnessCounts),
      fallbackCounts: countersToObject(fallbackCounts),
    },
    navigationModel: {
      schema: 'tabrix_mke_navigation_model_v1',
      pageUrlPattern: group.pageUrlPattern,
      averageDurationMs: durationCount > 0 ? Math.round(totalDurationMs / durationCount) : null,
    },
    failureSignal: {
      schema: 'tabrix_mke_failure_signal_v1',
      failedTraceCount: failed,
      errorCounts: countersToObject(errorCounts),
    },
    sourceTraceIds,
    observationCount,
    successfulUseCount: successful,
    failedUseCount: failed,
    confidenceScore,
    driftScore,
    lastObservedAt,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export class MkeKnowledgeProjector {
  constructor(
    private readonly traceRepo: MemoryTraceRepository,
    private readonly knowledgeRepo: KnowledgeModelRepository,
  ) {}

  public projectIdleBatch(input: MkeKnowledgeProjectionInput = {}): MkeKnowledgeProjectionResult {
    const traces = this.traceRepo.listAfter({
      cursorCreatedAt: input.cursorCreatedAt ?? null,
      limit: input.limit ?? 100,
    });
    if (traces.length === 0) {
      return {
        processedTraceCount: 0,
        skippedTraceCount: 0,
        upsertedKnowledgeCount: 0,
        nextCursorCreatedAt: input.cursorCreatedAt ?? null,
        knowledgeIds: [],
      };
    }

    const nowIso = input.nowIso ?? new Date().toISOString();
    const { groups, skippedTraceCount } = groupProjectableTraces(traces);
    const upserted: KnowledgeModel[] = [];
    for (const group of groups) {
      upserted.push(this.knowledgeRepo.upsert(buildKnowledgeInput(group, nowIso)));
    }

    return {
      processedTraceCount: traces.length,
      skippedTraceCount,
      upsertedKnowledgeCount: upserted.length,
      nextCursorCreatedAt: traces[traces.length - 1]?.createdAt ?? input.cursorCreatedAt ?? null,
      knowledgeIds: upserted.map((knowledge) => knowledge.knowledgeId),
    };
  }
}
