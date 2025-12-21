/**
 * Size Control (Phase 3.5)
 *
 * Design control for editing inline width and height styles.
 *
 * Features:
 * - Live preview via TransactionManager.beginStyle().set()
 * - Inline style values (not computed) shown in inputs
 * - Computed style values shown as placeholders
 * - Blur commits, Enter commits + blurs, ESC rollbacks
 * - Pure numbers default to px
 * - Empty value clears inline style
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignControl } from '../types';

// =============================================================================
// Types
// =============================================================================

type SizeProperty = 'width' | 'height';

interface FieldState {
  property: SizeProperty;
  input: HTMLInputElement;
  handle: StyleTransactionHandle | null;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize a length value.
 * - Pure numbers (e.g., "100", "10.5") get "px" suffix
 * - Values with units or keywords pass through unchanged
 * - Empty string clears the inline style
 */
function normalizeLength(raw: string): string {
  const trimmed = raw.trim();

  // Empty value -> clear inline style
  if (!trimmed) return '';

  // Pure number patterns: "10", "-10", "10.5", ".5", "-.5"
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  // Trailing dot (e.g., "10.") -> treat as integer px
  if (/^-?\d+\.$/.test(trimmed)) {
    return `${trimmed.slice(0, -1)}px`;
  }

  // Keep units/keywords/expressions as-is (50%, 10rem, auto, calc(...), etc.)
  return trimmed;
}

/**
 * Read inline style property value from element
 */
function readInlineValue(element: Element, property: SizeProperty): string {
  try {
    const style = (element as HTMLElement).style;
    if (!style || typeof style.getPropertyValue !== 'function') return '';
    return style.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

/**
 * Read computed style property value from element
 */
function readComputedValue(element: Element, property: SizeProperty): string {
  try {
    const computed = window.getComputedStyle(element);
    return computed.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface SizeControlOptions {
  /** Container element to mount the control */
  container: HTMLElement;
  /** TransactionManager for style editing with undo/redo */
  transactionManager: TransactionManager;
}

/**
 * Create a Size control for editing width/height
 */
export function createSizeControl(options: SizeControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  // State
  let currentTarget: Element | null = null;

  // ==========================================================================
  // DOM Structure
  // ==========================================================================

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Width field
  const widthRow = document.createElement('div');
  widthRow.className = 'we-field';

  const widthLabel = document.createElement('span');
  widthLabel.className = 'we-field-label';
  widthLabel.textContent = 'Width';

  const widthInput = document.createElement('input');
  widthInput.type = 'text';
  widthInput.className = 'we-input';
  widthInput.autocomplete = 'off';
  widthInput.spellcheck = false;
  widthInput.inputMode = 'decimal';
  widthInput.setAttribute('aria-label', 'Width');

  widthRow.append(widthLabel, widthInput);

  // Height field
  const heightRow = document.createElement('div');
  heightRow.className = 'we-field';

  const heightLabel = document.createElement('span');
  heightLabel.className = 'we-field-label';
  heightLabel.textContent = 'Height';

  const heightInput = document.createElement('input');
  heightInput.type = 'text';
  heightInput.className = 'we-input';
  heightInput.autocomplete = 'off';
  heightInput.spellcheck = false;
  heightInput.inputMode = 'decimal';
  heightInput.setAttribute('aria-label', 'Height');

  heightRow.append(heightLabel, heightInput);

  root.append(widthRow, heightRow);
  container.append(root);
  disposer.add(() => root.remove());

  // Field state
  const fields: Record<SizeProperty, FieldState> = {
    width: { property: 'width', input: widthInput, handle: null },
    height: { property: 'height', input: heightInput, handle: null },
  };

  // ==========================================================================
  // Transaction Management
  // ==========================================================================

  /**
   * Begin a style transaction for a property (lazy initialization)
   */
  function beginTransaction(property: SizeProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;

    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];

    // Return existing handle if already editing
    if (field.handle) return field.handle;

    // Start new transaction
    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  /**
   * Commit the current transaction for a property
   */
  function commitTransaction(property: SizeProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;

    if (handle) {
      handle.commit({ merge: true });
    }
  }

  /**
   * Rollback the current transaction for a property
   */
  function rollbackTransaction(property: SizeProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;

    if (handle) {
      handle.rollback();
    }
  }

  /**
   * Commit all active transactions
   */
  function commitAllTransactions(): void {
    commitTransaction('width');
    commitTransaction('height');
  }

  // ==========================================================================
  // Sync / Render
  // ==========================================================================

  /**
   * Check if an input element is currently focused.
   * Uses getRootNode() for Shadow DOM compatibility.
   */
  function isInputFocused(input: HTMLInputElement): boolean {
    try {
      // In Shadow DOM, document.activeElement is the shadow host.
      // We need to check the activeElement of the ShadowRoot instead.
      const rootNode = input.getRootNode();
      if (rootNode instanceof ShadowRoot) {
        return rootNode.activeElement === input;
      }
      return document.activeElement === input;
    } catch {
      return false;
    }
  }

  /**
   * Sync a single field's display with element styles
   * @param property - The property to sync
   * @param force - If true, ignore focus state and always update value
   */
  function syncField(property: SizeProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;

    // Disabled state when no target
    if (!target || !target.isConnected) {
      field.input.value = '';
      field.input.placeholder = '';
      field.input.disabled = true;
      return;
    }

    field.input.disabled = false;

    // Always update placeholder from computed style
    field.input.placeholder = readComputedValue(target, property);

    // Don't overwrite user input during active editing (unless forced)
    if (!force) {
      const isEditing = field.handle !== null || isInputFocused(field.input);
      if (isEditing) return;
    }

    // Display inline style value
    field.input.value = readInlineValue(target, property);
  }

  /**
   * Sync all fields
   */
  function syncAllFields(): void {
    syncField('width');
    syncField('height');
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Wire up event handlers for a field
   */
  function wireField(property: SizeProperty): void {
    const field = fields[property];
    const input = field.input;

    // Input: begin transaction and preview value
    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (!handle) return;

      const normalized = normalizeLength(input.value);
      handle.set(normalized);
    });

    // Blur: commit transaction
    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    // Keydown: Enter commits, ESC rollbacks
    disposer.listen(input, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction(property);
        // Force sync to update input with rollback value (ignore focus state)
        syncField(property, true);
      }
    });
  }

  wireField('width');
  wireField('height');

  // ==========================================================================
  // Public API (DesignControl interface)
  // ==========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;

    // Only commit if target actually changed
    if (element !== currentTarget) {
      // Commit any in-progress edits when selection changes
      commitAllTransactions();
    }

    currentTarget = element;
    syncAllFields();
  }

  function refresh(): void {
    if (disposer.isDisposed) return;
    syncAllFields();
  }

  function dispose(): void {
    // Commit any in-progress edits before cleanup
    commitAllTransactions();
    currentTarget = null;
    disposer.dispose();
  }

  // Initial state
  syncAllFields();

  return {
    setTarget,
    refresh,
    dispose,
  };
}
