import type { ReadPageAssistantGuidance, ReadPageMode } from '@tabrix/shared';
import { shouldRecoverSearchToolbarTargets } from './read-page-target-recovery';
import type { VisibleRegionRowsResult } from './visible-region-rows';

export function shouldSampleVisibleText(input: {
  treeOk: boolean;
  userControlled: boolean;
  mode: ReadPageMode;
  requestedDepth: number | undefined;
  focusRefId: string | undefined;
  rows: VisibleRegionRowsResult;
  pageRole?: string;
  assistantGuidance?: ReadPageAssistantGuidance;
}): boolean {
  if (!input.treeOk) return false;
  if (input.focusRefId) return false;
  if (input.mode === 'full') return true;
  if (input.pageRole === 'publish_form') return true;
  if (shouldRecoverSearchToolbarTargets(input.assistantGuidance, input.pageRole)) return true;
  if (!input.userControlled) return true;
  if (input.rows.visibleRegionRowsUsed) return false;
  if (input.pageRole === 'search_results') return true;
  return input.requestedDepth !== undefined && input.requestedDepth <= 3;
}
