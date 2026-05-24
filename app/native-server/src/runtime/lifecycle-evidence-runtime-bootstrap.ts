import {
  ensureLifecycleEvidenceCollectorRegistered,
  resetLifecycleEvidenceCollector,
  unregisterLifecycleEvidenceCollector,
} from './lifecycle-evidence-collector';
import { resetLifecycleEvidenceArtifactStore } from './lifecycle-evidence-artifact-store';

export function startLifecycleEvidenceRuntime(): boolean {
  return ensureLifecycleEvidenceCollectorRegistered();
}

export function stopLifecycleEvidenceRuntime(): void {
  unregisterLifecycleEvidenceCollector();
  resetLifecycleEvidenceCollector();
  resetLifecycleEvidenceArtifactStore();
}
