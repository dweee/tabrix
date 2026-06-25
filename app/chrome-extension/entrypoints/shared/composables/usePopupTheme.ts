/**
 * Minimal popup/extension theme composable.
 *
 * This module owns the popup and sidepanel light/dark theme toggle. It is
 * intentionally small so the theme surface stays independent from any removed
 * assistant UI runtime.
 *
 * The theme identifier is persisted in `chrome.storage.local` so the
 * popup restores the user's last choice across sessions. Falls back to
 * `localStorage` when running outside an extension (tests, local dev).
 */
import { onUnmounted, ref, type Ref } from 'vue';

export type PopupThemeId = 'warm-editorial' | 'dark-console';

const STORAGE_KEY = 'tabrix.popup.theme';
const DEFAULT_THEME: PopupThemeId = 'warm-editorial';

let preloadedTheme: PopupThemeId | null = null;

function hasChromeStorage(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    !!chrome?.storage?.local &&
    typeof chrome.storage.local.get === 'function'
  );
}

async function readStoredTheme(): Promise<PopupThemeId> {
  if (hasChromeStorage()) {
    return new Promise<PopupThemeId>((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (items) => {
          const raw = items?.[STORAGE_KEY];
          resolve(raw === 'dark-console' ? 'dark-console' : DEFAULT_THEME);
        });
      } catch {
        resolve(DEFAULT_THEME);
      }
    });
  }
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    return raw === 'dark-console' ? 'dark-console' : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

async function writeStoredTheme(theme: PopupThemeId): Promise<void> {
  if (hasChromeStorage()) {
    return new Promise<void>((resolve) => {
      try {
        chrome.storage.local.set({ [STORAGE_KEY]: theme }, () => resolve());
      } catch {
        resolve();
      }
    });
  }
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore persistence errors in non-DOM contexts
  }
}

/**
 * Eager-load the theme from storage so the first render can avoid a flash.
 * Kept as a no-throw best-effort primitive.
 */
export async function preloadPopupTheme(): Promise<PopupThemeId> {
  preloadedTheme = await readStoredTheme();
  return preloadedTheme;
}

interface UsePopupThemeResult {
  theme: Ref<PopupThemeId>;
  initTheme: () => Promise<void>;
  setTheme: (next: PopupThemeId) => Promise<void>;
}

export function usePopupTheme(): UsePopupThemeResult {
  const theme = ref<PopupThemeId>(preloadedTheme ?? DEFAULT_THEME);
  const storageChangeListener =
    hasChromeStorage() && chrome.storage.onChanged
      ? (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
          if (areaName !== 'local') return;
          const next = changes[STORAGE_KEY]?.newValue;
          theme.value = next === 'dark-console' ? 'dark-console' : DEFAULT_THEME;
        }
      : null;

  if (storageChangeListener) {
    chrome.storage.onChanged.addListener(storageChangeListener);
    onUnmounted(() => chrome.storage.onChanged.removeListener(storageChangeListener));
  }

  const initTheme = async () => {
    theme.value = await readStoredTheme();
  };

  const setTheme = async (next: PopupThemeId) => {
    theme.value = next;
    await writeStoredTheme(next);
  };

  return { theme, initTheme, setTheme };
}
