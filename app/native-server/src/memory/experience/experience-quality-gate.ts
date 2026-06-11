import type { ClickObservedOutcome } from '@tabrix/shared';
import type { ExperienceActionPathRow } from './experience-repository';

export const EXPERIENCE_SUGGEST_MIN_SUCCESS_COUNT = 3;
export const EXPERIENCE_SUGGEST_MIN_SUCCESS_RATE = 0.7;
export const EXPERIENCE_SUGGEST_MIN_COMPOSITE_SCORE = 0.7;

const EXPERIENCE_REPLAY_STRONG_SUCCESS_OUTCOMES = new Set<ClickObservedOutcome>([
  'cross_document_navigation',
  'spa_route_change',
  'hash_change',
  'new_tab_opened',
  'dialog_opened',
  'menu_opened',
  'state_toggled',
  'selection_changed',
  'download_intercepted',
]);

export function computeExperienceSuccessRate(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  if (total <= 0) return 0;
  return successCount / total;
}

export function isSuggestableExperience(row: ExperienceActionPathRow): boolean {
  return (
    row.successCount >= EXPERIENCE_SUGGEST_MIN_SUCCESS_COUNT &&
    computeExperienceSuccessRate(row.successCount, row.failureCount) >=
      EXPERIENCE_SUGGEST_MIN_SUCCESS_RATE &&
    typeof row.compositeScoreDecayed === 'number' &&
    Number.isFinite(row.compositeScoreDecayed) &&
    row.compositeScoreDecayed >= EXPERIENCE_SUGGEST_MIN_COMPOSITE_SCORE
  );
}

export function isExperienceReplayOutcomeSuccess(outcome: ClickObservedOutcome): boolean {
  return EXPERIENCE_REPLAY_STRONG_SUCCESS_OUTCOMES.has(outcome);
}
