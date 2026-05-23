import {
  ensureLifecycleEvidenceCollectorRegistered,
  resetLifecycleEvidenceCollector,
  unregisterLifecycleEvidenceCollector,
} from './lifecycle-evidence-collector';

export function startLifecycleEvidenceRuntime(): boolean {
  return ensureLifecycleEvidenceCollectorRegistered();
}

export function stopLifecycleEvidenceRuntime(): void {
  unregisterLifecycleEvidenceCollector();
  resetLifecycleEvidenceCollector();
}
