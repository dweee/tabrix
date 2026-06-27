import { type ReadPageAssistantGuidance, type ReadPageSensingDiagnostic } from '@tabrix/shared';

import { scanVisibleResultCardsInPage } from './collect-result-cards';
import type { CandidateActionSeed } from './read-page-candidate-actions';
import {
  itemUrlMatchesReadPage,
  normalizeVisibleSearchSurfaceAction,
  shouldRecoverSearchToolbarTargets,
} from './read-page-target-recovery';

export interface VisibleSearchSurfaceActionsResult {
  actions: CandidateActionSeed[];
  sensingDiagnostic?: ReadPageSensingDiagnostic;
}

type VisibleSearchSurfaceScan = {
  candidateActions: unknown[];
  cards?: unknown[];
  pageInfo?: { url?: string };
};

type VisibleSearchSurfaceScriptResult = {
  result?: unknown;
};

export type VisibleSearchSurfaceScriptExecutor = (details: {
  target: { tabId: number; allFrames: true };
  func: typeof scanVisibleResultCardsInPage;
  world: 'MAIN';
}) => Promise<VisibleSearchSurfaceScriptResult[]>;

function isVisibleSearchSurfaceScan(value: unknown): value is VisibleSearchSurfaceScan {
  return Boolean(
    value &&
    typeof value === 'object' &&
    Array.isArray((value as Partial<VisibleSearchSurfaceScan>).candidateActions),
  );
}

function selectBestVisibleSearchSurfaceScan(
  scans: VisibleSearchSurfaceScan[],
  currentUrl: string,
): VisibleSearchSurfaceScan | null {
  return (
    scans
      .filter((item) => !/^(about|chrome|edge|devtools):/i.test(item.pageInfo?.url || ''))
      .sort((left, right) => {
        const urlMatchRight = itemUrlMatchesReadPage(right, currentUrl) ? 1 : 0;
        const urlMatchLeft = itemUrlMatchesReadPage(left, currentUrl) ? 1 : 0;
        if (urlMatchRight !== urlMatchLeft) return urlMatchRight - urlMatchLeft;
        const actionDelta =
          (right.candidateActions?.length ?? 0) - (left.candidateActions?.length ?? 0);
        if (actionDelta !== 0) return actionDelta;
        return (right.cards?.length ?? 0) - (left.cards?.length ?? 0);
      })[0] ?? null
  );
}

async function executeVisibleSearchSurfaceScan(
  tabId: number,
  executeScript?: VisibleSearchSurfaceScriptExecutor,
): Promise<VisibleSearchSurfaceScriptResult[]> {
  const executor =
    executeScript ??
    ((details) =>
      chrome.scripting.executeScript(
        details as Parameters<typeof chrome.scripting.executeScript>[0],
      ) as Promise<VisibleSearchSurfaceScriptResult[]>);
  return executor({
    target: { tabId, allFrames: true },
    func: scanVisibleResultCardsInPage,
    world: 'MAIN',
  });
}

export async function collectVisibleSearchSurfaceActions(params: {
  tabId: number;
  currentUrl: string;
  assistantGuidance?: ReadPageAssistantGuidance;
  pageRole?: string;
  executeScript?: VisibleSearchSurfaceScriptExecutor;
}): Promise<VisibleSearchSurfaceActionsResult> {
  if (!shouldRecoverSearchToolbarTargets(params.assistantGuidance, params.pageRole)) {
    return { actions: [] };
  }
  try {
    const results = await executeVisibleSearchSurfaceScan(params.tabId, params.executeScript);
    const scans = (Array.isArray(results) ? results : [])
      .map((entry) => entry?.result)
      .filter(isVisibleSearchSurfaceScan);
    const scan = selectBestVisibleSearchSurfaceScan(scans, params.currentUrl);
    if (!scan) return { actions: [] };
    const actions = (scan.candidateActions ?? [])
      .map((action) => normalizeVisibleSearchSurfaceAction(action))
      .filter(
        (action: CandidateActionSeed | null): action is CandidateActionSeed => action !== null,
      );
    return { actions };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      actions: [],
      sensingDiagnostic: {
        source: 'visible_search_surface.scan',
        message: `visible result card action scan failed: ${message.replace(/\s+/g, ' ').slice(0, 120)}`,
      },
    };
  }
}
