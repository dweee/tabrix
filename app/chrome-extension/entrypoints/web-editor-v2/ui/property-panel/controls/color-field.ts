/**
 * Color Field
 *
 * A reusable color field component for the Web Editor property panel.
 * Features:
 * - Swatch button opens the native system color picker
 * - Hidden <input type="color"> provides native UX
 * - Text input accepts hex/rgb/var(...) formats
 */

import { Disposer } from '../../../utils/disposables';

// =============================================================================
// Types
// =============================================================================

export interface ColorFieldOptions {
  /** Container element to mount the field into */
  container: HTMLElement;
  /** Accessible label for the text input */
  ariaLabel: string;
  /** Called for live preview as the value changes */
  onInput?: (value: string) => void;
  /** Called when the user commits changes (blur/Enter or picker change) */
  onCommit?: () => void;
  /** Called when the user cancels editing (Escape) */
  onCancel?: () => void;
}

export interface ColorField {
  /** Set the current value */
  setValue(value: string): void;
  /** Set placeholder (computed value) */
  setPlaceholder(value: string): void;
  /** Enable/disable the field */
  setDisabled(disabled: boolean): void;
  /** Check if the field is focused */
  isFocused(): boolean;
  /** Cleanup */
  dispose(): void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COLOR_HEX = '#000000';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Clamp a byte value to 0-255
 */
function clampByte(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, Math.round(n)));
}

/**
 * Convert a byte to 2-digit hex string
 */
function toHexByte(n: number): string {
  return clampByte(n).toString(16).padStart(2, '0');
}

/**
 * Convert rgb(r, g, b) or rgba(r, g, b, a) string to #RRGGBB hex
 */
function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
  if (!match) return null;

  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);

  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }

  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}

/**
 * Normalize a hex color string to #RRGGBB format
 */
function normalizeHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (!v.startsWith('#')) return null;

  // Already #RRGGBB
  if (/^#[0-9a-f]{6}$/.test(v)) return v;

  // #RGB -> #RRGGBB
  if (/^#[0-9a-f]{3}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  // #RRGGBBAA -> #RRGGBB (ignore alpha)
  if (/^#[0-9a-f]{8}$/.test(v)) return v.slice(0, 7);

  // #RGBA -> #RRGGBB (ignore alpha)
  if (/^#[0-9a-f]{4}$/.test(v)) {
    const r = v[1]!;
    const g = v[2]!;
    const b = v[3]!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return null;
}

/**
 * Get active element from shadow DOM context
 */
function getActiveElement(root: HTMLElement): Element | null {
  try {
    const rootNode = root.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      return rootNode.activeElement;
    }
  } catch {
    // Best-effort focus detection
  }
  return document.activeElement;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a color field component
 */
export function createColorField(options: ColorFieldOptions): ColorField {
  const { container, ariaLabel, onInput, onCommit, onCancel } = options;
  const disposer = new Disposer();

  let currentValue = '';
  let currentPlaceholder = '';
  let lastResolvedHex = DEFAULT_COLOR_HEX;

  // Root container
  const root = document.createElement('div');
  root.className = 'we-color-field';

  // Swatch button
  const swatchBtn = document.createElement('button');
  swatchBtn.type = 'button';
  swatchBtn.className = 'we-color-swatch';
  swatchBtn.title = 'Pick color';
  swatchBtn.setAttribute('aria-label', `Pick ${ariaLabel}`);

  // Hidden native color input
  const nativeInput = document.createElement('input');
  nativeInput.type = 'color';
  nativeInput.className = 'we-color-native-input';
  nativeInput.value = lastResolvedHex;
  nativeInput.tabIndex = -1;
  nativeInput.setAttribute('aria-hidden', 'true');

  // Text input for manual entry
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.className = 'we-input we-color-text';
  textInput.autocomplete = 'off';
  textInput.spellcheck = false;
  textInput.setAttribute('aria-label', ariaLabel);

  // Hidden probe element for color resolution
  // Used to let the browser parse rgb/var(...) values
  const probe = document.createElement('span');
  probe.style.cssText =
    'position:fixed;left:-9999px;top:0;width:1px;height:1px;pointer-events:none;opacity:0';
  probe.setAttribute('aria-hidden', 'true');

  root.append(swatchBtn, nativeInput, textInput, probe);
  container.append(root);
  disposer.add(() => root.remove());

  // ==========================================================================
  // Color Resolution
  // ==========================================================================

  /**
   * Get the display value (current value or placeholder)
   */
  function getDisplayValue(): string {
    return currentValue.trim() || currentPlaceholder.trim();
  }

  /**
   * Resolve a color string to swatch display and hex for native picker
   */
  function resolveDisplayColor(raw: string): { swatch: string | null; hex: string | null } {
    const trimmed = raw.trim();
    if (!trimmed) return { swatch: null, hex: null };

    // Try direct hex parsing
    const hex = normalizeHex(trimmed);
    if (hex) return { swatch: hex, hex };

    // Use probe element to resolve rgb/var(...) etc.
    try {
      probe.style.backgroundColor = '';
      probe.style.backgroundColor = trimmed;
      if (!probe.style.backgroundColor) return { swatch: null, hex: null };

      const computed = getComputedStyle(probe).backgroundColor;
      const computedHex = rgbToHex(computed);
      return { swatch: computed || null, hex: computedHex };
    } catch {
      return { swatch: null, hex: null };
    }
  }

  /**
   * Update the swatch button color
   */
  function updateSwatch(): void {
    const display = getDisplayValue();
    const resolved = resolveDisplayColor(display);

    if (resolved.swatch) {
      swatchBtn.style.backgroundColor = resolved.swatch;
    } else {
      swatchBtn.style.backgroundColor = '';
    }

    if (resolved.hex) {
      lastResolvedHex = resolved.hex;
      nativeInput.value = resolved.hex;
    }
  }

  /**
   * Open the native color picker
   */
  function openPicker(): void {
    if (nativeInput.disabled) return;

    const display = getDisplayValue();
    const resolved = resolveDisplayColor(display);
    if (resolved.hex) lastResolvedHex = resolved.hex;
    nativeInput.value = lastResolvedHex;

    // Try modern showPicker API first, fallback to click
    const showPicker = (nativeInput as HTMLInputElement & { showPicker?: () => void }).showPicker;
    if (typeof showPicker === 'function') {
      showPicker.call(nativeInput);
    } else {
      nativeInput.click();
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  // Swatch button click -> open picker
  disposer.listen(swatchBtn, 'click', (e: MouseEvent) => {
    e.preventDefault();
    openPicker();
  });

  // Text input change
  disposer.listen(textInput, 'input', () => {
    currentValue = textInput.value;
    updateSwatch();
    onInput?.(currentValue.trim());
  });

  // Text input blur -> commit
  disposer.listen(textInput, 'blur', () => {
    onCommit?.();
  });

  // Text input keyboard
  disposer.listen(textInput, 'keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onCommit?.();
      textInput.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel?.();
    }
  });

  // Native picker input (live update)
  disposer.listen(nativeInput, 'input', () => {
    currentValue = nativeInput.value;
    textInput.value = currentValue;
    updateSwatch();
    onInput?.(currentValue);
  });

  // Native picker change (commit)
  disposer.listen(nativeInput, 'change', () => {
    onCommit?.();
  });

  // Initial swatch update
  updateSwatch();

  // ==========================================================================
  // Public Interface
  // ==========================================================================

  return {
    setValue(value: string): void {
      currentValue = String(value ?? '');
      textInput.value = currentValue;
      updateSwatch();
    },

    setPlaceholder(value: string): void {
      currentPlaceholder = String(value ?? '');
      textInput.placeholder = currentPlaceholder;
      updateSwatch();
    },

    setDisabled(disabled: boolean): void {
      swatchBtn.disabled = disabled;
      textInput.disabled = disabled;
      nativeInput.disabled = disabled;
    },

    isFocused(): boolean {
      const active = getActiveElement(root);
      return active instanceof HTMLElement ? root.contains(active) : false;
    },

    dispose(): void {
      disposer.dispose();
    },
  };
}
