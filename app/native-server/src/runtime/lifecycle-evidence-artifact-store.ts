import type { LifecycleEvidenceArtifact, LifecycleEvidenceFinalVerdictKind } from '@tabrix/shared';

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
  return {
    bufferedArtifacts: artifacts.length,
    droppedArtifacts,
    lastArtifactId,
    lastFinalVerdict,
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
