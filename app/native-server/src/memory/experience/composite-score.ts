/**
 * Pure Experience composite-score module.
 *
 * Deterministic, side-effect-free maths used by:
 *   - replay score write-back (`experience_score_step`);
 *   - chooser ranking when a stored `composite_score_decayed`
 *     is absent.
 *
 * The four component axes (`accuracy`, `speed`, `token`, `stability`)
 * and the recency half-life live in
 * `@tabrix/shared/experience-score-step` so any consumer (extension,
 * benchmark scripts, reports) reads the same constants.
 *
 * Failure handling: every public function returns a finite number and
 * does not perform IO.
 */

import {
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
  EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS,
  type TabrixTaskWeights,
} from '@tabrix/shared';
/** The four composite-score axes; values are clamped to `[0, 1]`. */
export interface CompositeScoreComponents {
  accuracy: number;
  speed: number;
  token: number;
  stability: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Clamp to `[0, 1]` and treat non-finite as 0 (defensive). */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/**
 * Project per-session signals into the four composite axes. All
 * inputs are optional; missing axes degrade to `0`. Pure function —
 * no IO, no time source, no randomness.
 *
 * Mapping rules:
 *   - `accuracy`: success rate of the recorded steps. `successCount /
 *     (successCount + failureCount)`; both `0`/`0` and missing
 *     yields `0` (no evidence is not "perfect").
 *   - `speed`: normalised against the session budget. Caller passes
 *     the observed wall-time in ms and the budget the upstream
 *     intends; `1 - elapsed/budget` clipped to `[0, 1]`. Missing
 *     budget = 0 (we do not invent a baseline).
 *   - `token`: token-saving ratio (read_page rounds avoided / total
 *     potential rounds). Caller is responsible for capping ≥ 0.
 *   - `stability`: `1 - variancePenalty` where the caller measured
 *     locator-hit variance across the run. The aggregator passes
 *     `failureRate`-derived stability so the first session has signal
 *     even before any benchmark fixture lands.
 *
 * The four axes are deliberately additive (no max / min folding) so
 * a degenerate "all zeros" session returns `0` rather than NaN.
 */
export function projectCompositeComponents(input: {
  successCount?: number;
  failureCount?: number;
  elapsedMs?: number;
  budgetMs?: number;
  tokenSavingRatio?: number;
  stability?: number;
}): CompositeScoreComponents {
  const success = Math.max(0, input.successCount ?? 0);
  const failure = Math.max(0, input.failureCount ?? 0);
  const total = success + failure;
  const accuracy = total > 0 ? success / total : 0;
  const speed =
    input.budgetMs && input.budgetMs > 0 && input.elapsedMs !== undefined
      ? 1 - input.elapsedMs / input.budgetMs
      : 0;
  const token = input.tokenSavingRatio ?? 0;
  const stability = input.stability ?? (total > 0 ? 1 - failure / total : 0);
  return {
    accuracy: clamp01(accuracy),
    speed: clamp01(speed),
    token: clamp01(token),
    stability: clamp01(stability),
  };
}

/**
 * Pure weighted sum. Weights are normalised (sum-to-1) at compute
 * time so callers can pass either probabilities (`{0.4, 0.2, 0.3, 0.1}`)
 * or counts (`{4, 2, 3, 1}`) and get the same result. Zero or
 * negative weights are clamped to 0; an all-zero weight vector
 * collapses to the unweighted mean of the components.
 */
export function computeRawComposite(
  components: CompositeScoreComponents,
  weights: TabrixTaskWeights = EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
): number {
  const a = Math.max(0, weights.accuracy);
  const s = Math.max(0, weights.speed);
  const t = Math.max(0, weights.token);
  const st = Math.max(0, weights.stability);
  const sum = a + s + t + st;
  if (sum <= 0) {
    return (
      (clamp01(components.accuracy) +
        clamp01(components.speed) +
        clamp01(components.token) +
        clamp01(components.stability)) /
      4
    );
  }
  const score =
    (clamp01(components.accuracy) * a +
      clamp01(components.speed) * s +
      clamp01(components.token) * t +
      clamp01(components.stability) * st) /
    sum;
  return clamp01(score);
}

/**
 * Apply exponential recency decay using the half-life from
 * `@tabrix/shared`. `nowIso` is required (no `Date.now()` call so
 * tests stay deterministic). When `lastReplayAt` is missing or in the
 * future relative to `nowIso`, the raw score is returned unchanged.
 *
 * Formula: `decayed = raw * 0.5^(daysSince / halfLife)`.
 */
export function applyRecencyDecay(
  rawScore: number,
  lastReplayAt: string | undefined | null,
  nowIso: string,
): number {
  if (!lastReplayAt) return clamp01(rawScore);
  const last = Date.parse(lastReplayAt);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(last) || !Number.isFinite(now) || now <= last) {
    return clamp01(rawScore);
  }
  const days = (now - last) / MS_PER_DAY;
  const decay = Math.pow(0.5, days / EXPERIENCE_SCORE_STEP_RECENCY_HALF_LIFE_DAYS);
  return clamp01(rawScore * decay);
}

/**
 * Convenience full-pipeline wrapper. Used by the aggregator's
 * session-end writer and by tests.
 */
export function computeDecayedComposite(input: {
  components: CompositeScoreComponents;
  weights?: TabrixTaskWeights;
  lastReplayAt: string;
  nowIso: string;
}): number {
  const raw = computeRawComposite(input.components, input.weights);
  return applyRecencyDecay(raw, input.lastReplayAt, input.nowIso);
}
