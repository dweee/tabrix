/**
 * Stable targetRef to per-snapshot ref registry.
 *
 * Why this exists:
 *   - HVO `targetRef` is a stable identity that survives reloads.
 *   - The actual click bridge still talks to the content-script accessibility
 *     tree via per-snapshot `ref_*` handles.
 *   - Without this registry, the click bridge would have no way to translate
 *     a stable `tgt_*` back into the live `ref_*` of the most recent snapshot
 *     for the same tab.
 *
 * Design choices (intentionally tiny; this is not a generic UI-state store):
 *   - In-memory Map keyed by tabId. No persistence: if the service worker is
 *     evicted, lookups return `undefined` and the click bridge fails closed
 *     with a clear "re-read the page" message — which is the safe behavior.
 *   - Each `record(tabId, …)` call replaces the entire snapshot for that tab,
 *     because a fresh `read_page` invalidates whatever ref handles existed
 *     before.
 *   - `clearTab(tabId)` is exposed so background lifecycle hooks can drop
 *     entries when a tab closes (caller responsibility).
 */

export interface StableTargetRefEntry {
  targetRef: string;
  ref: string;
  frameId?: number;
}

export interface CandidateActionTargetLocatorEntry {
  targetRef: string;
  selector: string;
  selectorType?: 'css' | 'xpath';
  frameId?: number;
}

export interface StableTargetRefRegistrySnapshot {
  /** Tabs currently tracked (for diagnostics / tests). */
  tabIds: number[];
  /** Per-tab entry counts (for diagnostics / tests). */
  entryCounts: Record<number, number>;
  /** Per-tab candidate locator counts (for diagnostics / tests). */
  candidateLocatorCounts: Record<number, number>;
}

interface PersistedTabSnapshot {
  stableEntries?: StableTargetRefEntry[];
  candidateLocators?: CandidateActionTargetLocatorEntry[];
  updatedAt: number;
}

interface PersistedRegistrySnapshot {
  version: 1;
  tabs: Record<string, PersistedTabSnapshot>;
}

const PERSISTED_REGISTRY_STORAGE_KEY = 'tabrix.stableTargetRefRegistry.v1';

/**
 * Pure interface so the click bridge can depend on a thin contract instead
 * of importing the singleton directly. Makes unit-testing the bridge trivial.
 */
export interface StableTargetRefLookup {
  lookup(tabId: number, targetRef: string): string | undefined;
}

class StableTargetRefRegistry implements StableTargetRefLookup {
  private byTab = new Map<number, Map<string, StableTargetRefEntry>>();
  private candidateLocatorsByTab = new Map<
    number,
    Map<string, CandidateActionTargetLocatorEntry>
  >();

  record(tabId: number | undefined | null, entries: readonly StableTargetRefEntry[]): void {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      this.byTab.delete(tabId);
      return;
    }
    const map = new Map<string, StableTargetRefEntry>();
    for (const entry of entries) {
      if (!entry || typeof entry.targetRef !== 'string' || typeof entry.ref !== 'string') continue;
      if (!entry.targetRef || !entry.ref) continue;
      // First write wins so the highest-ranked HVO for a given identity tuple
      // (which `read-page-task-protocol` placed first) is the one a click
      // resolves to. Visual duplicates with different ordinals already get
      // distinct targetRefs and so do not collide here.
      if (!map.has(entry.targetRef)) {
        map.set(entry.targetRef, {
          targetRef: entry.targetRef,
          ref: entry.ref,
          ...(typeof entry.frameId === 'number' && Number.isFinite(entry.frameId)
            ? { frameId: entry.frameId }
            : {}),
        });
      }
    }
    if (map.size === 0) {
      this.byTab.delete(tabId);
      return;
    }
    this.byTab.set(tabId, map);
  }

  recordCandidateLocators(
    tabId: number | undefined | null,
    entries: readonly CandidateActionTargetLocatorEntry[],
  ): void {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      this.candidateLocatorsByTab.delete(tabId);
      return;
    }
    const map = new Map<string, CandidateActionTargetLocatorEntry>();
    for (const entry of entries) {
      if (!entry || typeof entry.targetRef !== 'string' || typeof entry.selector !== 'string') {
        continue;
      }
      const targetRef = entry.targetRef.trim();
      const selector = entry.selector.trim();
      if (!targetRef || !selector) continue;
      if (!map.has(targetRef)) {
        const selectorType = entry.selectorType === 'xpath' ? 'xpath' : 'css';
        map.set(targetRef, {
          targetRef,
          selector,
          selectorType,
          ...(typeof entry.frameId === 'number' && Number.isFinite(entry.frameId)
            ? { frameId: entry.frameId }
            : {}),
        });
      }
    }
    if (map.size === 0) {
      this.candidateLocatorsByTab.delete(tabId);
      return;
    }
    this.candidateLocatorsByTab.set(tabId, map);
  }

  lookup(tabId: number | undefined | null, targetRef: string): string | undefined {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return undefined;
    if (typeof targetRef !== 'string' || !targetRef) return undefined;
    const map = this.byTab.get(tabId);
    if (!map) return undefined;
    return map.get(targetRef)?.ref;
  }

  lookupEntry(
    tabId: number | undefined | null,
    targetRef: string,
  ): StableTargetRefEntry | undefined {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return undefined;
    if (typeof targetRef !== 'string' || !targetRef) return undefined;
    const map = this.byTab.get(tabId);
    if (!map) return undefined;
    const entry = map.get(targetRef);
    if (!entry) return undefined;
    return { ...entry };
  }

  lookupCandidateLocator(
    tabId: number | undefined | null,
    targetRef: string,
  ): CandidateActionTargetLocatorEntry | undefined {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return undefined;
    if (typeof targetRef !== 'string' || !targetRef) return undefined;
    const map = this.candidateLocatorsByTab.get(tabId);
    if (!map) return undefined;
    const entry = map.get(targetRef);
    if (!entry) return undefined;
    return { ...entry };
  }

  clearTab(tabId: number | undefined | null): void {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
    this.byTab.delete(tabId);
    this.candidateLocatorsByTab.delete(tabId);
  }

  tabSnapshot(tabId: number | undefined | null): {
    stableEntries: StableTargetRefEntry[];
    candidateLocators: CandidateActionTargetLocatorEntry[];
  } {
    if (typeof tabId !== 'number' || !Number.isFinite(tabId)) {
      return { stableEntries: [], candidateLocators: [] };
    }
    return {
      stableEntries: Array.from(this.byTab.get(tabId)?.values() ?? []).map((entry) => ({
        ...entry,
      })),
      candidateLocators: Array.from(this.candidateLocatorsByTab.get(tabId)?.values() ?? []).map(
        (entry) => ({ ...entry }),
      ),
    };
  }

  /** For diagnostics + unit tests; not part of the production hot path. */
  snapshot(): StableTargetRefRegistrySnapshot {
    const tabIds: number[] = [];
    const entryCounts: Record<number, number> = {};
    const candidateLocatorCounts: Record<number, number> = {};
    for (const [tabId, map] of this.byTab.entries()) {
      tabIds.push(tabId);
      entryCounts[tabId] = map.size;
    }
    for (const [tabId, map] of this.candidateLocatorsByTab.entries()) {
      if (!tabIds.includes(tabId)) tabIds.push(tabId);
      candidateLocatorCounts[tabId] = map.size;
    }
    tabIds.sort((a, b) => a - b);
    return { tabIds, entryCounts, candidateLocatorCounts };
  }

  /** Test-only: drop everything. Not exported on the singleton path. */
  __resetForTests(): void {
    this.byTab.clear();
    this.candidateLocatorsByTab.clear();
  }
}

const singleton = new StableTargetRefRegistry();
let persistenceQueue: Promise<void> = Promise.resolve();

function getRegistryStorageArea(): Pick<
  chrome.storage.StorageArea,
  'get' | 'set' | 'remove'
> | null {
  const storage = globalThis.chrome?.storage;
  const area = storage?.session;
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') return null;
  return area;
}

function asPersistedRegistrySnapshot(value: unknown): PersistedRegistrySnapshot {
  if (!value || typeof value !== 'object') {
    return { version: 1, tabs: {} };
  }
  const object = value as Partial<PersistedRegistrySnapshot>;
  if (object.version !== 1 || !object.tabs || typeof object.tabs !== 'object') {
    return { version: 1, tabs: {} };
  }
  return { version: 1, tabs: object.tabs };
}

async function readPersistedRegistrySnapshot(): Promise<PersistedRegistrySnapshot> {
  const area = getRegistryStorageArea();
  if (!area) return { version: 1, tabs: {} };
  const stored = await area.get(PERSISTED_REGISTRY_STORAGE_KEY);
  return asPersistedRegistrySnapshot(
    stored && typeof stored === 'object'
      ? (stored as Record<string, unknown>)[PERSISTED_REGISTRY_STORAGE_KEY]
      : undefined,
  );
}

async function persistTabSnapshot(tabId: number | undefined | null): Promise<void> {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
  const area = getRegistryStorageArea();
  if (!area) return;
  const persisted = await readPersistedRegistrySnapshot();
  const tabKey = String(tabId);
  const snapshot = singleton.tabSnapshot(tabId);
  if (snapshot.stableEntries.length === 0 && snapshot.candidateLocators.length === 0) {
    delete persisted.tabs[tabKey];
  } else {
    persisted.tabs[tabKey] = {
      stableEntries: snapshot.stableEntries,
      candidateLocators: snapshot.candidateLocators,
      updatedAt: Date.now(),
    };
  }
  if (Object.keys(persisted.tabs).length === 0) {
    await area.remove(PERSISTED_REGISTRY_STORAGE_KEY);
    return;
  }
  await area.set({ [PERSISTED_REGISTRY_STORAGE_KEY]: persisted });
}

function schedulePersistTabSnapshot(tabId: number | undefined | null): void {
  persistenceQueue = persistenceQueue.then(() => persistTabSnapshot(tabId)).catch(() => undefined);
}

export function recordStableTargetRefSnapshot(
  tabId: number | undefined | null,
  entries: readonly StableTargetRefEntry[],
): void {
  singleton.record(tabId, entries);
  schedulePersistTabSnapshot(tabId);
}

export function recordCandidateActionTargetLocatorsSnapshot(
  tabId: number | undefined | null,
  entries: readonly CandidateActionTargetLocatorEntry[],
): void {
  singleton.recordCandidateLocators(tabId, entries);
  schedulePersistTabSnapshot(tabId);
}

export function lookupStableTargetRef(
  tabId: number | undefined | null,
  targetRef: string,
): string | undefined {
  return singleton.lookup(tabId, targetRef);
}

export function lookupStableTargetRefEntry(
  tabId: number | undefined | null,
  targetRef: string,
): StableTargetRefEntry | undefined {
  return singleton.lookupEntry(tabId, targetRef);
}

export function lookupCandidateActionTargetLocatorEntry(
  tabId: number | undefined | null,
  targetRef: string,
): CandidateActionTargetLocatorEntry | undefined {
  return singleton.lookupCandidateLocator(tabId, targetRef);
}

export function clearStableTargetRefTab(tabId: number | undefined | null): void {
  singleton.clearTab(tabId);
  schedulePersistTabSnapshot(tabId);
}

export function getStableTargetRefRegistrySnapshot(): StableTargetRefRegistrySnapshot {
  return singleton.snapshot();
}

/** Test-only export. Not part of the public surface. */
export function __resetStableTargetRefRegistryForTests(): void {
  singleton.__resetForTests();
}

export async function hydrateStableTargetRefRegistryFromStorage(
  tabId: number | undefined | null,
): Promise<void> {
  if (typeof tabId !== 'number' || !Number.isFinite(tabId)) return;
  const persisted = await readPersistedRegistrySnapshot();
  const snapshot = persisted.tabs[String(tabId)];
  if (!snapshot) return;
  if (Array.isArray(snapshot.stableEntries)) {
    singleton.record(tabId, snapshot.stableEntries);
  }
  if (Array.isArray(snapshot.candidateLocators)) {
    singleton.recordCandidateLocators(tabId, snapshot.candidateLocators);
  }
}

/** Test-only export. Waits for fire-and-forget persistence writes. */
export async function __flushStableTargetRefRegistryPersistenceForTests(): Promise<void> {
  await persistenceQueue;
}
