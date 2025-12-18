/**
 * Transaction Manager
 *
 * Locator-based undo/redo system for inline style edits.
 *
 * Design principles:
 * - Uses CSS selectors (not DOM references) for element identification
 * - Supports transaction merging for continuous edits (e.g., slider drag)
 * - Provides handle-based API for batched operations
 * - Emits change events for UI synchronization
 */

import type { ElementLocator, Transaction, TransactionSnapshot } from '@/common/web-editor-types';
import { Disposer } from '../utils/disposables';
import { createElementLocator, locateElement, locatorKey } from './locator';

// =============================================================================
// Types
// =============================================================================

/** Change event action types */
export type TransactionChangeAction = 'push' | 'merge' | 'undo' | 'redo' | 'clear' | 'rollback';

/** Change event emitted when transaction state changes */
export interface TransactionChangeEvent {
  action: TransactionChangeAction;
  transaction: Transaction | null;
  undoCount: number;
  redoCount: number;
}

/** Options for creating the Transaction Manager */
export interface TransactionManagerOptions {
  /** Maximum transactions to keep in history (oldest dropped) */
  maxHistory?: number;
  /** Time window (ms) for merging consecutive edits to same property */
  mergeWindowMs?: number;
  /** Enable Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z keyboard shortcuts */
  enableKeyBindings?: boolean;
  /** Check if event is from editor UI (to ignore keybindings) */
  isEventFromEditorUi?: (event: Event) => boolean;
  /** Custom time source (for testing) */
  now?: () => number;
  /** Called when transaction state changes */
  onChange?: (event: TransactionChangeEvent) => void;
  /** Called when applying a transaction fails */
  onApplyError?: (error: unknown) => void;
}

/** Handle for an in-progress style transaction (for batching) */
export interface StyleTransactionHandle {
  /** Unique handle ID */
  readonly id: string;
  /** CSS property being edited */
  readonly property: string;
  /** Target element locator */
  readonly targetLocator: ElementLocator;
  /** Update the style value (live preview) */
  set(value: string): void;
  /** Commit the transaction and record to history */
  commit(options?: { merge?: boolean }): Transaction | null;
  /** Rollback to original value without recording */
  rollback(): void;
}

/** Transaction Manager public interface */
export interface TransactionManager {
  /** Begin an interactive style edit (returns handle for batching) */
  beginStyle(target: Element, property: string): StyleTransactionHandle | null;
  /** Apply a style change immediately and record transaction */
  applyStyle(
    target: Element,
    property: string,
    value: string,
    options?: { merge?: boolean },
  ): Transaction | null;
  /** Record a style transaction without applying (for external changes) */
  recordStyle(
    locator: ElementLocator,
    property: string,
    beforeValue: string,
    afterValue: string,
    options?: { merge?: boolean },
  ): Transaction | null;
  /** Undo the last transaction */
  undo(): Transaction | null;
  /** Redo the last undone transaction */
  redo(): Transaction | null;
  /** Check if undo is available */
  canUndo(): boolean;
  /** Check if redo is available */
  canRedo(): boolean;
  /** Get current undo stack (readonly) */
  getUndoStack(): readonly Transaction[];
  /** Get current redo stack (readonly) */
  getRedoStack(): readonly Transaction[];
  /** Clear all transaction history */
  clear(): void;
  /** Cleanup resources */
  dispose(): void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_MAX_HISTORY = 100;
const DEFAULT_MERGE_WINDOW_MS = 800;

const KEYBIND_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: false,
};

// =============================================================================
// Style Helpers
// =============================================================================

/**
 * Normalize CSS property name to kebab-case.
 * Preserves custom properties (--var-name).
 */
function normalizePropertyName(property: string): string {
  const p = property.trim();
  if (!p) return '';

  // Preserve custom properties
  if (p.startsWith('--')) return p;

  // Already kebab-case
  if (p.includes('-')) return p.toLowerCase();

  // Convert camelCase to kebab-case
  return p.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`).toLowerCase();
}

/**
 * Safely get CSSStyleDeclaration from element
 */
function getInlineStyle(element: Element): CSSStyleDeclaration | null {
  const htmlElement = element as HTMLElement;
  const style = htmlElement.style;

  if (!style) return null;
  if (typeof style.getPropertyValue !== 'function') return null;
  if (typeof style.setProperty !== 'function') return null;
  if (typeof style.removeProperty !== 'function') return null;

  return style;
}

/**
 * Read inline style property value
 */
function readStyleValue(style: CSSStyleDeclaration, property: string): string {
  const prop = normalizePropertyName(property);
  if (!prop) return '';
  return style.getPropertyValue(prop).trim();
}

/**
 * Write inline style property value
 */
function writeStyleValue(style: CSSStyleDeclaration, property: string, value: string): void {
  const prop = normalizePropertyName(property);
  if (!prop) return;

  const v = value.trim();
  if (!v) {
    style.removeProperty(prop);
  } else {
    style.setProperty(prop, v);
  }
}

/**
 * Apply a styles snapshot to an element
 */
function applyStylesSnapshot(element: Element, styles: Record<string, string> | undefined): void {
  if (!styles) return;

  const inlineStyle = getInlineStyle(element);
  if (!inlineStyle) return;

  for (const [property, value] of Object.entries(styles)) {
    writeStyleValue(inlineStyle, property, value);
  }
}

// =============================================================================
// Transaction Helpers
// =============================================================================

let transactionSeq = 0;

/**
 * Generate unique transaction ID
 */
function generateTransactionId(timestamp: number): string {
  transactionSeq += 1;
  return `tx_${timestamp.toString(36)}_${transactionSeq.toString(36)}`;
}

/**
 * Create a style transaction record
 */
function createStyleTransaction(
  id: string,
  locator: ElementLocator,
  property: string,
  beforeValue: string,
  afterValue: string,
  timestamp: number,
): Transaction {
  const prop = normalizePropertyName(property);

  const beforeSnapshot: TransactionSnapshot = {
    locator,
    styles: { [prop]: beforeValue },
  };

  const afterSnapshot: TransactionSnapshot = {
    locator,
    styles: { [prop]: afterValue },
  };

  return {
    id,
    type: 'style',
    targetLocator: locator,
    before: beforeSnapshot,
    after: afterSnapshot,
    timestamp,
    merged: false,
  };
}

/**
 * Get the single style property from a transaction (if applicable)
 */
function getSingleStyleProperty(tx: Transaction): string | null {
  const keys = new Set<string>();

  if (tx.before.styles) {
    for (const k of Object.keys(tx.before.styles)) keys.add(k);
  }
  if (tx.after.styles) {
    for (const k of Object.keys(tx.after.styles)) keys.add(k);
  }

  return keys.size === 1 ? Array.from(keys)[0]! : null;
}

/**
 * Check if two transactions can be merged
 */
function canMerge(prev: Transaction, next: Transaction, mergeWindowMs: number): boolean {
  // Only merge style transactions
  if (prev.type !== 'style' || next.type !== 'style') return false;

  // Check time window
  if (Math.abs(next.timestamp - prev.timestamp) > mergeWindowMs) return false;

  // Check same target element
  if (locatorKey(prev.targetLocator) !== locatorKey(next.targetLocator)) return false;

  // Check same property
  const prevProp = getSingleStyleProperty(prev);
  const nextProp = getSingleStyleProperty(next);
  if (!prevProp || !nextProp || prevProp !== nextProp) return false;

  return true;
}

/**
 * Merge next transaction into prev (mutates prev)
 */
function mergeInto(prev: Transaction, next: Transaction): boolean {
  const prop = getSingleStyleProperty(prev);
  if (!prop) return false;

  const nextValue = next.after.styles?.[prop];
  if (nextValue === undefined) return false;

  // Update prev's after state
  if (!prev.after.styles) prev.after.styles = {};
  prev.after.styles[prop] = nextValue;
  prev.timestamp = next.timestamp;
  prev.merged = true;

  return true;
}

/**
 * Apply a transaction (undo or redo)
 * Returns true on success, false on failure
 */
function applyTransaction(tx: Transaction, direction: 'undo' | 'redo'): boolean {
  if (tx.type !== 'style') return true;

  const target = locateElement(tx.targetLocator);
  if (!target) {
    return false;
  }

  const snapshot = direction === 'undo' ? tx.before : tx.after;
  applyStylesSnapshot(target, snapshot.styles);
  return true;
}

// =============================================================================
// Transaction Manager Implementation
// =============================================================================

/**
 * Create a Transaction Manager instance
 */
export function createTransactionManager(
  options: TransactionManagerOptions = {},
): TransactionManager {
  const disposer = new Disposer();

  // Configuration
  const maxHistory = Math.max(1, options.maxHistory ?? DEFAULT_MAX_HISTORY);
  const mergeWindowMs = Math.max(0, options.mergeWindowMs ?? DEFAULT_MERGE_WINDOW_MS);
  const now = options.now ?? (() => Date.now());

  // State
  const undoStack: Transaction[] = [];
  const redoStack: Transaction[] = [];

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  function emit(action: TransactionChangeAction, transaction: Transaction | null): void {
    options.onChange?.({
      action,
      transaction,
      undoCount: undoStack.length,
      redoCount: redoStack.length,
    });
  }

  // ==========================================================================
  // Stack Management
  // ==========================================================================

  function enforceMaxHistory(): void {
    if (undoStack.length > maxHistory) {
      undoStack.splice(0, undoStack.length - maxHistory);
    }
  }

  function pushTransaction(tx: Transaction, allowMerge: boolean): void {
    const hadRedo = redoStack.length > 0;

    // Clear redo stack on new action
    if (hadRedo) {
      redoStack.length = 0;
    }

    // Try to merge with previous transaction
    if (!hadRedo && allowMerge && undoStack.length > 0) {
      const last = undoStack[undoStack.length - 1]!;
      if (canMerge(last, tx, mergeWindowMs) && mergeInto(last, tx)) {
        emit('merge', last);
        return;
      }
    }

    undoStack.push(tx);
    enforceMaxHistory();
    emit('push', tx);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  function recordStyle(
    locator: ElementLocator,
    property: string,
    beforeValue: string,
    afterValue: string,
    recordOptions?: { merge?: boolean },
  ): Transaction | null {
    if (disposer.isDisposed) return null;

    const prop = normalizePropertyName(property);
    if (!prop) return null;

    const before = beforeValue.trim();
    const after = afterValue.trim();
    if (before === after) return null;

    const id = generateTransactionId(now());
    const tx = createStyleTransaction(id, locator, prop, before, after, now());
    pushTransaction(tx, recordOptions?.merge !== false);

    return tx;
  }

  function beginStyle(target: Element, property: string): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;

    const inlineStyle = getInlineStyle(target);
    if (!inlineStyle) return null;

    const prop = normalizePropertyName(property);
    if (!prop) return null;

    const locator = createElementLocator(target);
    const beforeValue = readStyleValue(inlineStyle, prop);
    const id = generateTransactionId(now());

    let completed = false;

    function set(value: string): void {
      if (completed || disposer.isDisposed) return;
      writeStyleValue(inlineStyle, prop, value);
    }

    function commit(commitOptions?: { merge?: boolean }): Transaction | null {
      if (completed || disposer.isDisposed) return null;
      completed = true;

      const afterValue = readStyleValue(inlineStyle, prop);
      if (afterValue === beforeValue) return null;

      const tx = createStyleTransaction(id, locator, prop, beforeValue, afterValue, now());
      pushTransaction(tx, commitOptions?.merge !== false);
      return tx;
    }

    function rollback(): void {
      if (completed || disposer.isDisposed) return;
      completed = true;

      writeStyleValue(inlineStyle, prop, beforeValue);
      emit('rollback', null);
    }

    return {
      id,
      property: prop,
      targetLocator: locator,
      set,
      commit,
      rollback,
    };
  }

  function applyStyle(
    target: Element,
    property: string,
    value: string,
    applyOptions?: { merge?: boolean },
  ): Transaction | null {
    const handle = beginStyle(target, property);
    if (!handle) return null;

    handle.set(value);
    return handle.commit(applyOptions);
  }

  function undo(): Transaction | null {
    if (disposer.isDisposed) return null;

    const tx = undoStack.pop();
    if (!tx) return null;

    // Try to apply the undo
    const success = applyTransaction(tx, 'undo');
    if (!success) {
      // Restore stack state on failure
      undoStack.push(tx);
      options.onApplyError?.(new Error(`Failed to locate element for undo: ${tx.id}`));
      return null;
    }

    redoStack.push(tx);
    emit('undo', tx);
    return tx;
  }

  function redo(): Transaction | null {
    if (disposer.isDisposed) return null;

    const tx = redoStack.pop();
    if (!tx) return null;

    // Try to apply the redo
    const success = applyTransaction(tx, 'redo');
    if (!success) {
      // Restore stack state on failure
      redoStack.push(tx);
      options.onApplyError?.(new Error(`Failed to locate element for redo: ${tx.id}`));
      return null;
    }

    undoStack.push(tx);
    enforceMaxHistory();
    emit('redo', tx);
    return tx;
  }

  function canUndo(): boolean {
    return undoStack.length > 0;
  }

  function canRedo(): boolean {
    return redoStack.length > 0;
  }

  function getUndoStack(): readonly Transaction[] {
    return undoStack.slice();
  }

  function getRedoStack(): readonly Transaction[] {
    return redoStack.slice();
  }

  function clear(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    emit('clear', null);
  }

  // ==========================================================================
  // Keyboard Bindings
  // ==========================================================================

  if (options.enableKeyBindings) {
    disposer.listen(
      window,
      'keydown',
      (event: KeyboardEvent) => {
        // Skip if event is from editor UI
        if (options.isEventFromEditorUi?.(event)) return;

        // Check for Ctrl/Cmd modifier
        const isMod = event.metaKey || event.ctrlKey;
        if (!isMod || event.altKey) return;

        const key = event.key.toLowerCase();

        // Ctrl/Cmd+Z: Undo, Ctrl/Cmd+Shift+Z: Redo, Ctrl/Cmd+Y: Redo
        if (key === 'z') {
          if (event.shiftKey) {
            redo();
          } else {
            undo();
          }
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        } else if (key === 'y') {
          redo();
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
        }
      },
      KEYBIND_OPTIONS,
    );
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  function dispose(): void {
    undoStack.length = 0;
    redoStack.length = 0;
    disposer.dispose();
  }

  return {
    beginStyle,
    applyStyle,
    recordStyle,
    undo,
    redo,
    canUndo,
    canRedo,
    getUndoStack,
    getRedoStack,
    clear,
    dispose,
  };
}
