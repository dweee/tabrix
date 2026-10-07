import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ReadPageRequestedLayer } from '@tabrix/shared';
import type { DataSourceDecision } from '../execution/data-source-router';
import type {
  TaskReadPageContextMeasurement,
  TaskVisibleRegionRowsData,
} from '../execution/task-session-context';
import { readJsonObjectFromCallToolResult } from './register-tool-result-json';
import { readObject, readPositiveInteger, readString } from './register-tool-value-readers';

export interface ReadPageIdentity {
  url: string | null;
  pageRole: string | null;
}

export function extractReadPageIdentity(payload: Record<string, unknown> | null): ReadPageIdentity {
  if (!payload) return { url: null, pageRole: null };

  const page = readObject(payload.page);
  const summary = readObject(payload.summary);
  const pageObjectSnapshot = readObject(payload.pageObjectSnapshot);
  const compactFacts = readObject(readObject(payload.browserPageObjectCompact)?.facts);
  const compactTab = readObject(compactFacts?.tab);

  return {
    url:
      readString(page?.url) ??
      readString(payload.url) ??
      readString(payload.pageUrl) ??
      readString(pageObjectSnapshot?.pageUrl) ??
      readString(compactTab?.currentTabUrl),
    pageRole:
      readString(summary?.pageRole) ??
      readString(payload.pageRole) ??
      readString(pageObjectSnapshot?.pageRole),
  };
}

export function buildReadPageContextMeasurement(
  payload: Record<string, unknown> | null,
  requestedLayer: ReadPageRequestedLayer,
): TaskReadPageContextMeasurement | null {
  if (!payload) return null;
  let fullReadByteLength = 0;
  if (requestedLayer === 'L0+L1+L2') {
    try {
      fullReadByteLength = JSON.stringify(payload).length;
    } catch {
      return null;
    }
    if (!Number.isFinite(fullReadByteLength) || fullReadByteLength <= 0) return null;
  }

  const identity = extractReadPageIdentity(payload);
  const candidateActions = Array.isArray(payload.candidateActions) ? payload.candidateActions : [];
  const highValueObjects = Array.isArray(payload.highValueObjects) ? payload.highValueObjects : [];
  return {
    url: identity.url,
    pageRole: identity.pageRole,
    fullReadByteLength,
    candidateActionsCount: candidateActions.length,
    highValueObjectCount: highValueObjects.length,
  };
}

export function evaluateReadPageTargetBinding(
  result: CallToolResult,
  requestedTabId: number,
): {
  verdict: 'matched' | 'unknown' | 'mismatch';
  requestedTabId: number;
  observedTabIds: number[];
  matchedTabId: number | null;
  reason: string;
} {
  const payload = readJsonObjectFromCallToolResult(result);
  const observedTabIds = payload ? collectReadPageObservedTabIds(payload) : [];
  const uniqueObserved = Array.from(new Set(observedTabIds));
  if (uniqueObserved.length === 0) {
    return {
      verdict: 'unknown',
      requestedTabId,
      observedTabIds: [],
      matchedTabId: null,
      reason: 'read_page response did not expose a target tab id; legacy response tolerated',
    };
  }
  if (uniqueObserved.some((tabId) => tabId !== requestedTabId)) {
    return {
      verdict: 'mismatch',
      requestedTabId,
      observedTabIds: uniqueObserved,
      matchedTabId: uniqueObserved.includes(requestedTabId) ? requestedTabId : null,
      reason:
        'read_page response included tab-bound evidence that did not match the explicit requested tabId',
    };
  }
  return {
    verdict: 'matched',
    requestedTabId,
    observedTabIds: uniqueObserved,
    matchedTabId: requestedTabId,
    reason: 'all observed read_page tab-bound evidence matched the explicit requested tabId',
  };
}

export function shouldPreferVisibleRowsForMarkdownAiContext(
  visibleRows: TaskVisibleRegionRowsData,
  routerDecision: DataSourceDecision,
): boolean {
  if (routerDecision.selectedDataSource !== 'dom_region_rows') return false;

  const region = visibleRows.sourceRegion.toLowerCase();
  const semanticListRegion =
    region.includes('result') ||
    region.includes('list') ||
    region.includes('search') ||
    region.includes('feed') ||
    region.includes('grid') ||
    region.includes('card');

  return semanticListRegion || visibleRows.cardRowsCount > 0 || visibleRows.cardExtractorUsed;
}

export function shouldRecordDomRegionRowsReadback(visibleRows: TaskVisibleRegionRowsData): boolean {
  if (!visibleRows.visibleRegionRowsUsed || visibleRows.rowCount <= 0) return false;
  const coverage = visibleRows.targetRefCoverageRate ?? 0;
  const quality = visibleRows.regionQualityScore ?? 0;
  return visibleRows.rowExtractionConfidence >= 0.7 && coverage >= 0.95 && quality >= 0.7;
}

function collectReadPageObservedTabIds(payload: Record<string, unknown>): number[] {
  const ids: number[] = [];
  const push = (value: number | null) => {
    if (value !== null) ids.push(value);
  };

  push(readPositiveInteger(payload, 'tabId'));
  push(readPositiveInteger(payload, 'currentTabId'));
  push(readPositiveInteger(payload, 'readTargetTabId'));

  const pageProjection = readObject(payload.pageProjection);
  push(readPositiveInteger(pageProjection, 'tabId'));

  const ownershipRuntime = readObject(payload.ownershipRuntime);
  push(readPositiveInteger(ownershipRuntime, 'currentTabId'));

  const compactTab = readObject(
    readObject(readObject(payload.browserPageObjectCompact)?.facts)?.tab,
  );
  push(readPositiveInteger(compactTab, 'tabId'));
  push(readPositiveInteger(compactTab, 'readTargetTabId'));
  push(readPositiveInteger(compactTab, 'currentActiveTabId'));

  const artifacts = payload.artifactRefs;
  if (Array.isArray(artifacts)) {
    for (const artifact of artifacts) {
      const ref = readString(readObject(artifact)?.ref);
      if (!ref) continue;
      for (const pattern of [/\/tab-(\d+)\//g, /read_page\/(\d+)\//g]) {
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(ref)) !== null) {
          const parsed = Number(match[1]);
          if (Number.isInteger(parsed) && parsed > 0) ids.push(parsed);
        }
      }
    }
  }

  return ids;
}
