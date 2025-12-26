/**
 * Composable for managing Web Editor TX (Transaction) state in Sidepanel.
 *
 * Responsibilities:
 * - Listen to WEB_EDITOR_TX_CHANGED messages from background
 * - Persist and recover state from chrome.storage.session
 * - Manage excluded element keys for selective Apply
 * - Provide reactive state for AgentChat chips UI
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import type {
  ElementChangeSummary,
  WebEditorElementKey,
  WebEditorTxChangedPayload,
  WebEditorTxChangeAction,
} from '@/common/web-editor-types';

// =============================================================================
// Constants
// =============================================================================

const WEB_EDITOR_TX_CHANGED_SESSION_KEY_PREFIX = 'web-editor-v2-tx-changed-';
const WEB_EDITOR_EXCLUDED_KEYS_SESSION_KEY_PREFIX = 'web-editor-v2-excluded-keys-';

const VALID_TX_ACTIONS = new Set<WebEditorTxChangeAction>([
  'push',
  'merge',
  'undo',
  'redo',
  'clear',
  'rollback',
]);

// =============================================================================
// Internal Helpers
// =============================================================================

function isValidTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function buildTxSessionKey(tabId: number): string {
  return `${WEB_EDITOR_TX_CHANGED_SESSION_KEY_PREFIX}${tabId}`;
}

function buildExcludedKeysSessionKey(tabId: number): string {
  return `${WEB_EDITOR_EXCLUDED_KEYS_SESSION_KEY_PREFIX}${tabId}`;
}

/**
 * Normalize and validate TX changed payload from storage or message.
 * Returns null if the payload is invalid.
 */
function normalizeTxChangedPayload(raw: unknown): WebEditorTxChangedPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const tabId = Number(obj.tabId);
  if (!Number.isFinite(tabId) || tabId <= 0) return null;

  const actionRaw = typeof obj.action === 'string' ? obj.action : '';
  if (!VALID_TX_ACTIONS.has(actionRaw as WebEditorTxChangeAction)) return null;
  const action = actionRaw as WebEditorTxChangeAction;

  // Filter elements to ensure minimal validity (elementKey must be a non-empty string)
  const rawElements = Array.isArray(obj.elements) ? obj.elements : [];
  const elements = rawElements.filter(
    (e): e is ElementChangeSummary =>
      e &&
      typeof e === 'object' &&
      typeof (e as any).elementKey === 'string' &&
      (e as any).elementKey,
  );

  const undoCountRaw = Number(obj.undoCount);
  const redoCountRaw = Number(obj.redoCount);
  const undoCount = Number.isFinite(undoCountRaw) && undoCountRaw >= 0 ? undoCountRaw : 0;
  const redoCount = Number.isFinite(redoCountRaw) && redoCountRaw >= 0 ? redoCountRaw : 0;

  const hasApplicableChanges = Boolean(obj.hasApplicableChanges);
  const pageUrl = typeof obj.pageUrl === 'string' ? obj.pageUrl : undefined;

  return {
    tabId,
    action,
    elements,
    undoCount,
    redoCount,
    hasApplicableChanges,
    pageUrl,
  };
}

/**
 * Normalize and deduplicate excluded keys array from storage.
 * Filters out invalid entries and removes duplicates.
 */
function normalizeExcludedKeys(raw: unknown): WebEditorElementKey[] {
  if (!Array.isArray(raw)) return [];

  const result: WebEditorElementKey[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    const key = String(item ?? '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  return result;
}

/**
 * Persist excluded keys to session storage (per-tab).
 * Best-effort: silently ignores failures.
 */
async function persistExcludedKeys(
  tabId: number,
  keys: readonly WebEditorElementKey[],
): Promise<void> {
  if (!isValidTabId(tabId)) return;

  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.session?.set) return;
    const storageKey = buildExcludedKeysSessionKey(tabId);
    await chrome.storage.session.set({ [storageKey]: [...keys] });
  } catch (error) {
    console.error('[useWebEditorTxState] Failed to persist excluded keys:', error);
  }
}

/**
 * Default implementation for getting active tab ID.
 */
async function getActiveTabIdDefault(): Promise<number | null> {
  try {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return null;
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    return typeof tabId === 'number' ? tabId : null;
  } catch {
    return null;
  }
}

// =============================================================================
// Public API
// =============================================================================

export interface UseWebEditorTxStateOptions {
  /**
   * Optional override for resolving the "current tab" in sidepanel.
   * Defaults to chrome.tabs.query({ active: true, currentWindow: true }).
   */
  getActiveTabId?: () => Promise<number | null>;
  /**
   * If provided, skips querying the active tab on mount.
   */
  initialTabId?: number | null;
}

export function useWebEditorTxState(options: UseWebEditorTxStateOptions = {}) {
  // ==========================================================================
  // State
  // ==========================================================================

  /** Current tab ID being tracked */
  const tabId = ref<number | null>(
    isValidTabId(options.initialTabId) ? options.initialTabId : null,
  );

  /** Current TX state from web-editor */
  const txState = ref<WebEditorTxChangedPayload | null>(null);

  /** Excluded element keys (user-deselected elements) */
  const excludedKeys = ref<WebEditorElementKey[]>([]);

  // ==========================================================================
  // Computed
  // ==========================================================================

  /** All elements from TX state */
  const allElements = computed<ElementChangeSummary[]>(() => txState.value?.elements ?? []);

  /** Set of excluded keys for O(1) lookup */
  const excludedKeySet = computed(() => new Set(excludedKeys.value));

  /** Elements that will be applied (not excluded) */
  const applicableElements = computed<ElementChangeSummary[]>(() => {
    const set = excludedKeySet.value;
    return allElements.value.filter((e) => !set.has(e.elementKey));
  });

  /** Elements that are excluded by user */
  const excludedElements = computed<ElementChangeSummary[]>(() => {
    const set = excludedKeySet.value;
    return allElements.value.filter((e) => set.has(e.elementKey));
  });

  /** Whether there are applicable changes to send to Agent */
  const hasChanges = computed<boolean>(() => applicableElements.value.length > 0);

  // ==========================================================================
  // Actions
  // ==========================================================================

  /**
   * Toggle an element's excluded state.
   * Automatically persists to session storage.
   */
  function toggleExclude(elementKey: WebEditorElementKey): void {
    const key = String(elementKey ?? '').trim();
    if (!key) return;

    const current = excludedKeys.value;
    const idx = current.indexOf(key);
    if (idx >= 0) {
      // Remove from excluded list
      excludedKeys.value = [...current.slice(0, idx), ...current.slice(idx + 1)];
    } else {
      // Add to excluded list
      excludedKeys.value = [...current, key];
    }

    // Persist to session storage
    if (isValidTabId(tabId.value)) {
      void persistExcludedKeys(tabId.value, excludedKeys.value);
    }
  }

  /**
   * Clear all excluded elements.
   * Automatically persists to session storage.
   */
  function clearExcluded(): void {
    excludedKeys.value = [];

    // Persist to session storage
    if (isValidTabId(tabId.value)) {
      void persistExcludedKeys(tabId.value, excludedKeys.value);
    }
  }

  /**
   * Remove excluded keys that no longer exist in the current TX state.
   * This prevents stale keys when elements are undone/cleared.
   */
  function pruneStaleExcludedKeys(elements: readonly ElementChangeSummary[] | null): void {
    if (!elements || !isValidTabId(tabId.value)) return;

    const validKeys = new Set(elements.map((e) => e.elementKey));
    const prunedKeys = excludedKeys.value.filter((k) => validKeys.has(k));

    // Only update if there are stale keys to remove
    if (prunedKeys.length === excludedKeys.value.length) return;

    excludedKeys.value = prunedKeys;
    void persistExcludedKeys(tabId.value, prunedKeys);
  }

  /** Sequence counter to prevent stale async updates */
  let refreshSeq = 0;

  /**
   * Refresh TX state from session storage for a specific tab.
   * Also restores excluded keys from storage.
   * On tab change, immediately clears state to prevent cross-tab pollution.
   */
  async function refreshFromStorage(targetTabId: number): Promise<void> {
    if (!isValidTabId(targetTabId)) {
      tabId.value = null;
      txState.value = null;
      excludedKeys.value = [];
      return;
    }

    // On tab change, immediately clear state to prevent UI showing stale data
    const isTabChange = tabId.value !== targetTabId;
    if (isTabChange) {
      txState.value = null;
      excludedKeys.value = [];
    }
    tabId.value = targetTabId;

    const seq = ++refreshSeq;
    const txKey = buildTxSessionKey(targetTabId);
    const excludedKey = buildExcludedKeysSessionKey(targetTabId);

    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.session?.get) {
        txState.value = null;
        excludedKeys.value = [];
        return;
      }

      // Fetch both TX state and excluded keys in one call
      const result = (await chrome.storage.session.get([txKey, excludedKey])) as Record<
        string,
        unknown
      >;

      // Check for stale async response
      if (seq !== refreshSeq) return;

      // Update TX state
      const nextTxState = normalizeTxChangedPayload(result?.[txKey]);
      txState.value = nextTxState;

      // Restore excluded keys from storage
      excludedKeys.value = normalizeExcludedKeys(result?.[excludedKey]);

      // Prune stale excluded keys based on current elements
      pruneStaleExcludedKeys(nextTxState?.elements ?? null);
    } catch (error) {
      console.error('[useWebEditorTxState] Failed to refresh from session storage:', error);
      // On error, ensure clean state to prevent showing stale data
      txState.value = null;
      excludedKeys.value = [];
    }
  }

  // ==========================================================================
  // Message Listeners
  // ==========================================================================

  /**
   * Handle runtime messages from background.
   */
  const onRuntimeMessage = (
    message: unknown,
    _sender: chrome.runtime.MessageSender,
    _sendResponse: (response?: unknown) => void,
  ): void => {
    const msg =
      message && typeof message === 'object' ? (message as Record<string, unknown>) : null;
    if (!msg) return;

    if (msg.type !== BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TX_CHANGED) return;

    const next = normalizeTxChangedPayload(msg.payload);
    if (!next) return;

    // Only process messages for the current tab
    if (!isValidTabId(tabId.value)) return;
    if (next.tabId !== tabId.value) return;

    txState.value = next;

    // Prune excluded keys that no longer exist (e.g., after undo/clear)
    pruneStaleExcludedKeys(next.elements);
  };

  /**
   * Handle session storage changes (fallback for cold start).
   * Only handles TX state changes; excluded keys are managed explicitly.
   */
  const onSessionChanged = (changes: { [key: string]: chrome.storage.StorageChange }): void => {
    if (!isValidTabId(tabId.value)) return;
    const txKey = buildTxSessionKey(tabId.value);

    const change = changes?.[txKey];
    if (!change) return;

    if (change.newValue === undefined) {
      txState.value = null;
      // Clear excluded keys when TX state is cleared
      pruneStaleExcludedKeys([]);
      return;
    }

    const next = normalizeTxChangedPayload(change.newValue);
    txState.value = next;

    // Prune stale excluded keys
    pruneStaleExcludedKeys(next?.elements ?? []);
  };

  /** Cleanup function for storage listener */
  let removeStorageListener: (() => void) | null = null;

  // ==========================================================================
  // Lifecycle
  // ==========================================================================

  onMounted(async () => {
    // Register runtime message listener
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.addListener) {
        chrome.runtime.onMessage.addListener(onRuntimeMessage);
      }
    } catch (error) {
      console.error('Failed to register WebEditor TX runtime listener:', error);
    }

    // Register session storage listener
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.session?.onChanged?.addListener) {
        // Prefer session-specific listener if available
        chrome.storage.session.onChanged.addListener(onSessionChanged);
        removeStorageListener = () => {
          try {
            chrome.storage.session.onChanged.removeListener(onSessionChanged);
          } catch {}
        };
      } else if (typeof chrome !== 'undefined' && chrome.storage?.onChanged?.addListener) {
        // Fallback to generic storage listener with area filter
        const onChanged = (
          changes: { [key: string]: chrome.storage.StorageChange },
          areaName: chrome.storage.AreaName,
        ) => {
          if (areaName !== 'session') return;
          onSessionChanged(changes);
        };

        chrome.storage.onChanged.addListener(onChanged);
        removeStorageListener = () => {
          try {
            chrome.storage.onChanged.removeListener(onChanged);
          } catch {}
        };
      }
    } catch (error) {
      console.error('Failed to register WebEditor TX storage listener:', error);
    }

    // Initialize tab ID if not provided
    const getActiveTabId = options.getActiveTabId ?? getActiveTabIdDefault;

    if (!isValidTabId(tabId.value)) {
      const active = await getActiveTabId().catch(() => null);
      if (isValidTabId(active)) {
        tabId.value = active;
      }
    }

    // Load initial state from storage
    if (isValidTabId(tabId.value)) {
      await refreshFromStorage(tabId.value);
    }
  });

  onUnmounted(() => {
    // Clean up runtime message listener
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage?.removeListener) {
        chrome.runtime.onMessage.removeListener(onRuntimeMessage);
      }
    } catch {}

    // Clean up storage listener
    removeStorageListener?.();
    removeStorageListener = null;
  });

  // ==========================================================================
  // Return
  // ==========================================================================

  return {
    // State
    tabId,
    txState,
    excludedKeys,

    // UI State (computed)
    allElements,
    hasChanges,
    applicableElements,
    excludedElements,

    // Actions
    toggleExclude,
    clearExcluded,
    refreshFromStorage,
  };
}
