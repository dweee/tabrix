import type {
  ActionKind,
  LifecycleEvidenceArtifact,
  LifecycleEvidenceFinalVerdictKind,
  PostconditionVerdict,
} from '@tabrix/shared';

const DEFAULT_MAX_ARTIFACTS = 20;

const artifacts: LifecycleEvidenceArtifact[] = [];
let maxArtifacts = DEFAULT_MAX_ARTIFACTS;
let droppedArtifacts = 0;
let lastArtifactId: string | null = null;
let lastFinalVerdict: LifecycleEvidenceFinalVerdictKind | null = null;
let lastProducedAtMs: number | null = null;

export interface LifecycleEvidenceArtifactStoreSnapshot {
  bufferedArtifacts: number;
  droppedArtifacts: number;
  lastArtifactId: string | null;
  lastFinalVerdict: LifecycleEvidenceFinalVerdictKind | null;
  lastFinalVerdictReason: string | null;
  lastScenarioId: string | null;
  lastScenarioClass: string | null;
  lastActionKind: ActionKind | null;
  lastPostconditionVerdict: PostconditionVerdict | null;
  lastPostconditionReason: string | null;
  lastProducedAtMs: number | null;
  maxArtifacts: number;
}

export function recordLifecycleEvidenceArtifact(artifact: LifecycleEvidenceArtifact): void {
  artifacts.push(artifact);
  lastArtifactId = artifact.artifactId;
  lastFinalVerdict = artifact.finalVerdict.verdict;
  lastProducedAtMs = artifact.producedAtMs;

  while (artifacts.length > maxArtifacts) {
    artifacts.shift();
    droppedArtifacts += 1;
  }
}

export function listLifecycleEvidenceArtifacts(): LifecycleEvidenceArtifact[] {
  return artifacts.map(
    (artifact) => JSON.parse(JSON.stringify(artifact)) as LifecycleEvidenceArtifact,
  );
}

export function getLifecycleEvidenceArtifactStoreSnapshot(): LifecycleEvidenceArtifactStoreSnapshot {
  const lastArtifact = artifacts.at(-1) ?? null;
  const lastPostcondition = lastArtifact?.actionLog.entries.at(-1) ?? null;
  return {
    bufferedArtifacts: artifacts.length,
    droppedArtifacts,
    lastArtifactId,
    lastFinalVerdict,
    lastFinalVerdictReason: lastArtifact?.finalVerdict.reason ?? null,
    lastScenarioId: lastArtifact?.scenarioId ?? null,
    lastScenarioClass: lastArtifact?.scenarioClass ?? null,
    lastActionKind: lastPostcondition?.actionKind ?? null,
    lastPostconditionVerdict: lastPostcondition?.verdict ?? null,
    lastPostconditionReason: lastPostcondition?.reason ?? null,
    lastProducedAtMs,
    maxArtifacts,
  };
}

export function resetLifecycleEvidenceArtifactStore(): void {
  artifacts.length = 0;
  droppedArtifacts = 0;
  lastArtifactId = null;
  lastFinalVerdict = null;
  lastProducedAtMs = null;
}

export function resetLifecycleEvidenceArtifactStoreForTests(): void {
  resetLifecycleEvidenceArtifactStore();
  maxArtifacts = DEFAULT_MAX_ARTIFACTS;
}

export function setLifecycleEvidenceArtifactStoreMaxArtifactsForTests(max: number): void {
  maxArtifacts = Math.max(0, Math.floor(max));
  while (artifacts.length > maxArtifacts) {
    artifacts.shift();
    droppedArtifacts += 1;
  }
}
