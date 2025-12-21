/**
 * Spacing Control (Phase 3.6)
 *
 * Box-model style editor for inline margin and padding.
 *
 * Features:
 * - Visual box model representation (like Chrome DevTools)
 * - 8 input fields: margin-top/right/bottom/left, padding-top/right/bottom/left
 * - Inline style values shown in inputs
 * - Computed style values as placeholders
 * - Live preview via TransactionManager.beginStyle().set()
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

type SpacingBox = 'margin' | 'padding';
type SpacingEdge = 'top' | 'right' | 'bottom' | 'left';
type SpacingProperty = `${SpacingBox}-${SpacingEdge}`;

interface FieldState {
  property: SpacingProperty;
  input: HTMLInputElement;
  handle: StyleTransactionHandle | null;
}

// =============================================================================
// Constants
// =============================================================================

const SPACING_PROPERTIES: readonly SpacingProperty[] = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
];

/** Scrub sensitivity: pixels moved per 1px value change */
const SCRUB_SENSITIVITY = 2;

/** Minimum drag distance to start scrubbing (prevents accidental scrub on clicks) */
const SCRUB_THRESHOLD = 3;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Normalize a length value.
 * - Pure numbers get "px" suffix
 * - Values with units or keywords pass through unchanged
 * - Empty string clears inline style
 */
function normalizeLength(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';

  // Pure number patterns: "10", "-10", "10.5", ".5", "-.5"
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return `${trimmed}px`;
  }

  // Trailing dot (e.g., "10.") -> treat as integer px
  if (/^-?\d+\.$/.test(trimmed)) {
    return `${trimmed.slice(0, -1)}px`;
  }

  return trimmed;
}

/**
 * Check if an input is focused (Shadow DOM compatible)
 */
function isInputFocused(input: HTMLInputElement): boolean {
  try {
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
 * Read inline style property value
 */
function readInlineValue(element: Element, property: SpacingProperty): string {
  try {
    const style = (element as HTMLElement).style;
    if (!style || typeof style.getPropertyValue !== 'function') return '';
    return style.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

/**
 * Read computed style property value
 */
function readComputedValue(element: Element, property: SpacingProperty): string {
  try {
    const computed = window.getComputedStyle(element);
    return computed.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

/**
 * Parse a CSS length value to a number (in pixels).
 * Returns NaN if parsing fails.
 */
function parseLength(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return 0;

  // Pure number - treat as px
  const num = parseFloat(trimmed);
  if (Number.isNaN(num)) return NaN;

  // Check unit (only support px for scrubbing)
  const unit = trimmed
    .replace(/^-?[\d.]+/, '')
    .trim()
    .toLowerCase();
  if (unit === '' || unit === 'px') {
    return num;
  }

  // Other units not supported for scrubbing
  return NaN;
}

/**
 * Create an edge input element
 */
function createEdgeInput(edge: SpacingEdge, ariaLabel: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = `we-spacing-input we-spacing-input--${edge}`;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', ariaLabel);
  return input;
}

// =============================================================================
// Factory
// =============================================================================

export interface SpacingControlOptions {
  /** Container element to mount the control */
  container: HTMLElement;
  /** TransactionManager for style editing with undo/redo */
  transactionManager: TransactionManager;
}

/**
 * Create a Spacing control for editing margin/padding
 */
export function createSpacingControl(options: SpacingControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  // State
  let currentTarget: Element | null = null;

  // ==========================================================================
  // DOM Structure - Box Model Visual
  // ==========================================================================

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Outer box (margin area)
  const box = document.createElement('div');
  box.className = 'we-spacing-box';

  // Margin label
  const marginLabel = document.createElement('div');
  marginLabel.className = 'we-spacing-label we-spacing-label--margin';
  marginLabel.textContent = 'Margin';

  // Margin inputs
  const marginTopInput = createEdgeInput('top', 'Margin top');
  const marginRightInput = createEdgeInput('right', 'Margin right');
  const marginBottomInput = createEdgeInput('bottom', 'Margin bottom');
  const marginLeftInput = createEdgeInput('left', 'Margin left');

  // Inner box (padding area)
  const inner = document.createElement('div');
  inner.className = 'we-spacing-inner';
  // Position relative for padding inputs to position correctly
  inner.style.position = 'relative';

  // Padding label (centered in inner box)
  const paddingLabel = document.createElement('div');
  paddingLabel.className = 'we-spacing-label we-spacing-label--padding';
  paddingLabel.textContent = 'Padding';

  // Padding inputs
  const paddingTopInput = createEdgeInput('top', 'Padding top');
  const paddingRightInput = createEdgeInput('right', 'Padding right');
  const paddingBottomInput = createEdgeInput('bottom', 'Padding bottom');
  const paddingLeftInput = createEdgeInput('left', 'Padding left');

  // Assemble inner box (padding)
  inner.append(
    paddingLabel,
    paddingTopInput,
    paddingRightInput,
    paddingBottomInput,
    paddingLeftInput,
  );

  // Assemble outer box (margin + inner)
  box.append(
    marginLabel,
    marginTopInput,
    marginRightInput,
    marginBottomInput,
    marginLeftInput,
    inner,
  );

  root.append(box);
  container.append(root);
  disposer.add(() => root.remove());

  // Field state mapping
  const fields: Record<SpacingProperty, FieldState> = {
    'margin-top': { property: 'margin-top', input: marginTopInput, handle: null },
    'margin-right': { property: 'margin-right', input: marginRightInput, handle: null },
    'margin-bottom': { property: 'margin-bottom', input: marginBottomInput, handle: null },
    'margin-left': { property: 'margin-left', input: marginLeftInput, handle: null },
    'padding-top': { property: 'padding-top', input: paddingTopInput, handle: null },
    'padding-right': { property: 'padding-right', input: paddingRightInput, handle: null },
    'padding-bottom': { property: 'padding-bottom', input: paddingBottomInput, handle: null },
    'padding-left': { property: 'padding-left', input: paddingLeftInput, handle: null },
  };

  // ==========================================================================
  // Transaction Management
  // ==========================================================================

  /**
   * Begin a style transaction for a property
   */
  function beginTransaction(property: SpacingProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;

    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.handle) return field.handle;

    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  /**
   * Commit transaction for a property
   */
  function commitTransaction(property: SpacingProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;

    if (handle) {
      handle.commit({ merge: true });
    }
  }

  /**
   * Rollback transaction for a property
   */
  function rollbackTransaction(property: SpacingProperty): void {
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
    for (const prop of SPACING_PROPERTIES) {
      commitTransaction(prop);
    }
  }

  // ==========================================================================
  // Sync / Render
  // ==========================================================================

  /**
   * Sync a single field with element styles
   */
  function syncField(property: SpacingProperty, force = false): void {
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
    for (const prop of SPACING_PROPERTIES) {
      syncField(prop);
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  // Scrub state
  interface ScrubState {
    property: SpacingProperty;
    startX: number;
    startValue: number;
    isScrubbing: boolean;
  }
  let scrubState: ScrubState | null = null;

  /**
   * Get the current numeric value for a property (from input or computed)
   */
  function getCurrentValue(property: SpacingProperty): number {
    const field = fields[property];
    const target = currentTarget;

    // First try input value
    const inputVal = parseLength(field.input.value);
    if (!Number.isNaN(inputVal)) {
      return inputVal;
    }

    // Fall back to computed style
    if (target && target.isConnected) {
      const computed = readComputedValue(target, property);
      const computedVal = parseLength(computed);
      if (!Number.isNaN(computedVal)) {
        return computedVal;
      }
    }

    return 0;
  }

  /**
   * Handle scrub start (pointerdown on input)
   */
  function handleScrubStart(property: SpacingProperty, e: PointerEvent): void {
    // Only handle left mouse button
    if (e.button !== 0) return;

    // Don't interfere with text selection if input is focused
    const field = fields[property];
    if (document.activeElement === field.input || isInputFocused(field.input)) {
      return;
    }

    // Prepare scrub state
    scrubState = {
      property,
      startX: e.clientX,
      startValue: getCurrentValue(property),
      isScrubbing: false,
    };

    // Capture pointer for tracking movement
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  /**
   * Handle scrub move (pointermove while scrubbing)
   */
  function handleScrubMove(e: PointerEvent): void {
    if (!scrubState) return;

    const dx = e.clientX - scrubState.startX;

    // Check threshold before starting actual scrub
    if (!scrubState.isScrubbing) {
      if (Math.abs(dx) < SCRUB_THRESHOLD) {
        return;
      }
      // Start scrubbing
      scrubState.isScrubbing = true;
      const field = fields[scrubState.property];
      field.input.classList.add('we-spacing-input--scrubbing');
      document.body.style.cursor = 'ew-resize';
    }

    // Calculate new value
    const deltaValue = Math.round(dx / SCRUB_SENSITIVITY);
    const newValue = Math.max(0, scrubState.startValue + deltaValue);

    // Begin transaction if needed and apply value
    const handle = beginTransaction(scrubState.property);
    if (handle) {
      handle.set(`${newValue}px`);
      // Also update input for visual feedback
      fields[scrubState.property].input.value = String(newValue);
    }
  }

  /**
   * Handle scrub end (pointerup/pointercancel)
   */
  function handleScrubEnd(e: PointerEvent): void {
    if (!scrubState) return;

    const field = fields[scrubState.property];
    field.input.classList.remove('we-spacing-input--scrubbing');
    document.body.style.cursor = '';

    // Release pointer capture
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignore if already released
    }

    if (scrubState.isScrubbing) {
      // Commit the scrubbed value
      commitTransaction(scrubState.property);
      syncAllFields();
    } else {
      // If never started scrubbing, this was a click - focus the input
      rollbackTransaction(scrubState.property);
      field.input.focus();
      field.input.select();
    }

    scrubState = null;
  }

  /**
   * Wire up event handlers for a field
   */
  function wireField(property: SpacingProperty): void {
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
        // Force sync to update input with rollback value
        syncField(property, true);
      }
    });

    // Scrub: pointer events for drag-to-adjust
    disposer.listen(input, 'pointerdown', (e: PointerEvent) => handleScrubStart(property, e));
    disposer.listen(input, 'pointermove', handleScrubMove);
    disposer.listen(input, 'pointerup', handleScrubEnd);
    disposer.listen(input, 'pointercancel', handleScrubEnd);
  }

  // Wire all fields
  for (const prop of SPACING_PROPERTIES) {
    wireField(prop);
  }

  // ==========================================================================
  // Public API (DesignControl interface)
  // ==========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;

    // Only commit if target actually changed
    if (element !== currentTarget) {
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
