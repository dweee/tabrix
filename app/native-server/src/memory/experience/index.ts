/**
 * Stage 3b Experience layer public exports.
 */

export const EXPERIENCE_ACTION_PATHS_TABLE = 'experience_action_paths';

export { buildActionPathId, normalizeIntentSignature } from './experience-signature';
export {
  ExperienceRepository,
  type ExperienceActionPathRow,
  type ExperienceActionPathStep,
  type RecordReplayStepOutcomeInput,
  type RecordReplayStepOutcomeResult,
  type RecordWritebackWarningInput,
  type SuggestActionPathsInput,
  type UpdateActionPathCompositeScoreInput,
  type UpsertActionPathInput,
  type WritebackWarningRow,
} from './experience-repository';
export {
  EXPERIENCE_SUGGEST_MIN_COMPOSITE_SCORE,
  EXPERIENCE_SUGGEST_MIN_SUCCESS_COUNT,
  EXPERIENCE_SUGGEST_MIN_SUCCESS_RATE,
  ExperienceSuggestPlanInputError,
  buildSuggestPlanResult,
  parseExperienceSuggestPlanInput,
} from './experience-suggest';
export { ExperienceQueryService } from './experience-query-service';
export {
  applyRecencyDecay,
  computeDecayedComposite,
  computeRawComposite,
  projectCompositeComponents,
  type CompositeScoreComponents,
} from './composite-score';
