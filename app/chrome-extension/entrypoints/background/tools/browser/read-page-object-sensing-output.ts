import {
  derivePostActionDeltaEvidenceFromReadPageDelta,
  type ReadPageObjectSnapshot,
  type ReadPagePageDeltaReport,
} from '@tabrix/shared';
import {
  buildReadPagePageDeltaReport,
  buildReadPageSnapshotSourceStats,
  consumePendingActionBinding,
  getPreviousPageObjectSnapshot,
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
}

export function buildAndRememberReadPageObjectSensingOutput(
  input: ReadPageObjectSensingInput,
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
    cdpSignals: objectDeltaSignals,
    previousCdpSignals: previousSnapshot?.telemetry,
  });
  const postActionDeltaEvidence = pageDeltaReport
    ? derivePostActionDeltaEvidenceFromReadPageDelta(pageDeltaReport, {
        tabId: objectSensingInput.tabId,
      })
    : undefined;

  rememberPageObjectSnapshot(objectSensingInput.tabId, pageObjectSnapshot, objectDeltaSignals);

  return {
    pageObjectSnapshot,
    ...(pageDeltaReport ? { pageDeltaReport } : {}),
    ...(postActionDeltaEvidence ? { postActionDeltaEvidence } : {}),
  };
}
