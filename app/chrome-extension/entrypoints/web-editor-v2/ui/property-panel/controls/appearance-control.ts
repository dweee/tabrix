/**
 * Appearance Control
 *
 * Edits general appearance styles:
 * - overflow (select)
 * - box-sizing (select)
 * - opacity (input)
 *
 * Note: Border and Background controls have been split into separate controls
 * (border-control.ts and background-control.ts) for better organization.
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import { wireNumberStepping } from './number-stepping';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const OVERFLOW_VALUES = ['visible', 'hidden', 'scroll', 'auto'] as const;
const BOX_SIZING_VALUES = ['content-box', 'border-box'] as const;

// =============================================================================
// Types
// =============================================================================

type AppearanceProperty = 'overflow' | 'box-sizing' | 'opacity';

interface TextFieldState {
  kind: 'text';
  property: AppearanceProperty;
  element: HTMLInputElement;
  handle: StyleTransactionHandle | null;
}

interface SelectFieldState {
  kind: 'select';
  property: AppearanceProperty;
  element: HTMLSelectElement;
  handle: StyleTransactionHandle | null;
}

type FieldState = TextFieldState | SelectFieldState;

// =============================================================================
// Helpers
// =============================================================================

function isFieldFocused(el: HTMLElement): boolean {
  try {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) return rootNode.activeElement === el;
    return document.activeElement === el;
  } catch {
    return false;
  }
}

function normalizeOpacity(raw: string): string {
  return raw.trim();
}

function readInlineValue(element: Element, property: string): string {
  try {
    const style = (element as HTMLElement).style;
    return style?.getPropertyValue?.(property)?.trim() ?? '';
  } catch {
    return '';
  }
}

function readComputedValue(element: Element, property: string): string {
  try {
    return window.getComputedStyle(element).getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

// =============================================================================
// Factory
// =============================================================================

export interface AppearanceControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
}

export function createAppearanceControl(options: AppearanceControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // ===========================================================================
  // DOM Helpers
  // ===========================================================================

  function createInputRow(
    labelText: string,
    ariaLabel: string,
  ): { row: HTMLDivElement; input: HTMLInputElement } {
    const row = document.createElement('div');
    row.className = 'we-field';
    const label = document.createElement('span');
    label.className = 'we-field-label';
    label.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'we-input';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', ariaLabel);
    row.append(label, input);
    return { row, input };
  }

  function createSelectRow(
    labelText: string,
    ariaLabel: string,
    values: readonly string[],
  ): { row: HTMLDivElement; select: HTMLSelectElement } {
    const row = document.createElement('div');
    row.className = 'we-field';
    const label = document.createElement('span');
    label.className = 'we-field-label';
    label.textContent = labelText;
    const select = document.createElement('select');
    select.className = 'we-select';
    select.setAttribute('aria-label', ariaLabel);
    for (const v of values) {
      const opt = document.createElement('option');
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    }
    row.append(label, select);
    return { row, select };
  }

  // ===========================================================================
  // Build DOM
  // ===========================================================================

  const { row: overflowRow, select: overflowSelect } = createSelectRow(
    'Overflow',
    'Overflow',
    OVERFLOW_VALUES,
  );
  const { row: boxSizingRow, select: boxSizingSelect } = createSelectRow(
    'Box Sizing',
    'Box Sizing',
    BOX_SIZING_VALUES,
  );
  const { row: opacityRow, input: opacityInput } = createInputRow('Opacity', 'Opacity');

  wireNumberStepping(disposer, opacityInput, {
    mode: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    shiftStep: 0.1,
    altStep: 0.001,
  });

  root.append(overflowRow, boxSizingRow, opacityRow);
  container.appendChild(root);
  disposer.add(() => root.remove());

  // ===========================================================================
  // Field State Map
  // ===========================================================================

  const fields: Record<AppearanceProperty, FieldState> = {
    overflow: { kind: 'select', property: 'overflow', element: overflowSelect, handle: null },
    'box-sizing': {
      kind: 'select',
      property: 'box-sizing',
      element: boxSizingSelect,
      handle: null,
    },
    opacity: { kind: 'text', property: 'opacity', element: opacityInput, handle: null },
  };

  const PROPS: readonly AppearanceProperty[] = ['overflow', 'box-sizing', 'opacity'];

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  function beginTransaction(property: AppearanceProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.handle) return field.handle;

    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: AppearanceProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: AppearanceProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of PROPS) commitTransaction(p);
  }

  // ===========================================================================
  // Field Synchronization
  // ===========================================================================

  function syncField(property: AppearanceProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;

    if (field.kind === 'text') {
      const input = field.element;

      if (!target || !target.isConnected) {
        input.disabled = true;
        input.value = '';
        input.placeholder = '';
        return;
      }

      input.disabled = false;

      const isEditing = field.handle !== null || isFieldFocused(input);
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const computedValue = readComputedValue(target, property);
      input.value = inlineValue || computedValue;
      input.placeholder = '';
    } else {
      const select = field.element;

      if (!target || !target.isConnected) {
        select.disabled = true;
        return;
      }

      select.disabled = false;

      const isEditing = field.handle !== null || isFieldFocused(select);
      if (isEditing && !force) return;

      const inline = readInlineValue(target, property);
      const computed = readComputedValue(target, property);
      const val = inline || computed;
      const hasOption = Array.from(select.options).some((o) => o.value === val);
      select.value = hasOption ? val : (select.options[0]?.value ?? '');
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
  }

  // ===========================================================================
  // Event Wiring
  // ===========================================================================

  function wireTextInput(property: AppearanceProperty): void {
    const field = fields[property];
    if (field.kind !== 'text') return;

    const input = field.element;
    const normalize = property === 'opacity' ? normalizeOpacity : (v: string) => v.trim();

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalize(input.value));
    });

    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  function wireSelect(property: AppearanceProperty): void {
    const field = fields[property];
    if (field.kind !== 'select') return;

    const select = field.element;

    const preview = () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(select.value);
    };

    disposer.listen(select, 'input', preview);
    disposer.listen(select, 'change', preview);
    disposer.listen(select, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(select, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction(property);
        syncAllFields();
        select.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  wireSelect('overflow');
  wireSelect('box-sizing');
  wireTextInput('opacity');

  // ===========================================================================
  // Public API
  // ===========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) commitAllTransactions();
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

  syncAllFields();

  return { setTarget, refresh, dispose };
}
