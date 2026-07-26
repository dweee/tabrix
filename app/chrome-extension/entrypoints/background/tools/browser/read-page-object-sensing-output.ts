import {
  derivePostActionDeltaEvidenceFromReadPageDelta,
  type ReadPageObjectSnapshot,
  type ReadPagePageDeltaReport,
  type ReadPageSearchResultDelta,
} from '@tabrix/shared';
import {
  buildReadPagePageDeltaReport,
  buildReadPageSnapshotSourceStats,
  consumePendingActionBinding,
  getPreviousPageObjectSnapshot,
  type PendingActionBinding,
  rememberPageObjectSnapshot,
  resolveTargetObjectId,
} from './read-page-object-delta';
import {
  buildReadPageObjectDeltaSignals,
  buildReadPageObjectSensingInput,
  type ReadPageObjectSensingInput,
} from './read-page-object-sensing-input';

export interface ReadPageObjectSensingOutput {
  pageObjectSnapshot: ReadPageObjectSnapshot;
  pageDeltaReport?: ReadPagePageDeltaReport;
  postActionDeltaEvidence?: ReturnType<typeof derivePostActionDeltaEvidenceFromReadPageDelta>;
  searchResultDelta?: ReadPageSearchResultDelta;
}

export function bindSearchResultDeltaToPostActionEvidence(
  resultDelta: ReadPageSearchResultDelta | undefined,
  postActionDeltaEvidence:
    | ReturnType<typeof derivePostActionDeltaEvidenceFromReadPageDelta>
    | undefined,
  pendingActionBinding?: PendingActionBinding | null,
): ReadPageSearchResultDelta | undefined {
  if (!resultDelta) return undefined;
  const resultChangingIntents = new Set([
    'search.submit',
    'search.category_select',
    'filter.option_select',
    'filter.time_range_select',
  ]);
  const isResultChangingIntent = (intent: string | null | undefined): boolean =>
    Boolean(
      intent && (resultChangingIntents.has(intent) || intent.startsWith('search.apply_filter.')),
    );
  const observation = resultDelta.observation;
  const observedAtMs = observation ? Date.parse(observation.observedAt) : Number.NaN;
  const previousObservedAtMs =
    observation?.previousObservedAt != null
      ? Date.parse(observation.previousObservedAt)
      : Number.NaN;
  const authoritativeActionId = postActionDeltaEvidence?.actionId;
  const bindingMatchesObservationWindow =
    Boolean(observation) &&
    observation!.previousSequence !== null &&
    observation!.sequence > observation!.previousSequence! &&
    Number.isFinite(observedAtMs) &&
    Number.isFinite(previousObservedAtMs) &&
    Boolean(pendingActionBinding) &&
    pendingActionBinding!.recordedAtMs >= previousObservedAtMs &&
    pendingActionBinding!.recordedAtMs <= observedAtMs;
  const bindingIsAuthoritative =
    resultDelta.status === 'changed' &&
    resultDelta.changedEnough === true &&
    Boolean(authoritativeActionId) &&
    authoritativeActionId === pendingActionBinding?.actionId &&
    isResultChangingIntent(pendingActionBinding?.actionIntent) &&
    bindingMatchesObservationWindow;
  if (!bindingIsAuthoritative) {
    return {
      ...resultDelta,
      attribution: 'observation_only',
      actionId: null,
      postActionWatchId: undefined,
      claimBoundary:
        'Result delta is DOM/AX result-card observation evidence only. Action attribution requires a result-changing action intent and a matching action timestamp between the previous and current observations; this delta must not be presented as action-caused or as task success.',
    };
  }
  return {
    ...resultDelta,
    attribution: 'action_bound',
    actionId: authoritativeActionId!,
    postActionWatchId: postActionDeltaEvidence?.watchId,
    claimBoundary:
      'Result delta is DOM/AX result-card evidence bound through postActionDeltaEvidence to the named pending action. The binding is temporal evidence, not proof that the action caused the change or that the task succeeded.',
  };
}

export function buildAndRememberReadPageObjectSensingOutput(
  input: ReadPageObjectSensingInput & { searchResultDelta?: ReadPageSearchResultDelta },
): ReadPageObjectSensingOutput {
  const objectSensingInput = buildReadPageObjectSensingInput(input);
  const objectDeltaSignals = buildReadPageObjectDeltaSignals(objectSensingInput);
  const pageObjectSnapshot = buildReadPageSnapshotSourceStats(objectSensingInput);
  const previousSnapshot = getPreviousPageObjectSnapshot(objectSensingInput.tabId);
  const consumedPendingActionBinding = consumePendingActionBinding(objectSensingInput.tabId);
  const pendingActionBinding = consumedPendingActionBinding
    ? {
        ...consumedPendingActionBinding,
        targetObjectId: resolveTargetObjectId(consumedPendingActionBinding, pageObjectSnapshot),
      }
    : null;
  const pageDeltaReport = buildReadPagePageDeltaReport({
    tabId: objectSensingInput.tabId,
    currentSnapshot: pageObjectSnapshot,
    previousSnapshot: previousSnapshot?.snapshot ?? null,
    pendingActionBinding,
    searchResultDelta: input.searchResultDelta,
    cdpSignals: objectDeltaSignals,
    previousCdpSignals: previousSnapshot?.telemetry,
  });
  const postActionDeltaEvidence = pageDeltaReport
    ? derivePostActionDeltaEvidenceFromReadPageDelta(pageDeltaReport, {
        tabId: objectSensingInput.tabId,
      })
    : undefined;
  const searchResultDelta = bindSearchResultDeltaToPostActionEvidence(
    input.searchResultDelta,
    postActionDeltaEvidence,
    pendingActionBinding,
  );

  rememberPageObjectSnapshot(objectSensingInput.tabId, pageObjectSnapshot, objectDeltaSignals);

  return {
    pageObjectSnapshot,
    ...(pageDeltaReport ? { pageDeltaReport } : {}),
    ...(postActionDeltaEvidence ? { postActionDeltaEvidence } : {}),
    ...(searchResultDelta ? { searchResultDelta } : {}),
  };
}
