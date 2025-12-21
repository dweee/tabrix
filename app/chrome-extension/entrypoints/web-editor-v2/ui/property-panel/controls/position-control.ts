/**
 * Position Control (Phase 3.3)
 *
 * Edits inline positioning styles:
 * - position (select): static/relative/absolute/fixed/sticky
 * - top/right/bottom/left (inputs)
 * - z-index (input)
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignControl } from '../types';

// =============================================================================
// Types
// =============================================================================

type PositionProperty = 'position' | 'top' | 'right' | 'bottom' | 'left' | 'z-index';
type FieldElement = HTMLInputElement | HTMLSelectElement;

interface FieldState {
  property: PositionProperty;
  element: FieldElement;
  handle: StyleTransactionHandle | null;
}

// =============================================================================
// Constants
// =============================================================================

const POSITION_VALUES = ['static', 'relative', 'absolute', 'fixed', 'sticky'] as const;
const POSITION_PROPERTIES: readonly PositionProperty[] = [
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
];

// =============================================================================
// Helpers
// =============================================================================

function isFieldFocused(el: FieldElement): boolean {
  try {
    const rootNode = el.getRootNode();
    if (rootNode instanceof ShadowRoot) {
      return rootNode.activeElement === el;
    }
    return document.activeElement === el;
  } catch {
    return false;
  }
}

function normalizeLength(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return `${trimmed}px`;
  if (/^-?\d+\.$/.test(trimmed)) return `${trimmed.slice(0, -1)}px`;
  return trimmed;
}

function normalizeZIndex(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^-?\d+\.$/.test(trimmed)) return trimmed.slice(0, -1);
  return trimmed;
}

function readInlineValue(element: Element, property: PositionProperty): string {
  try {
    const style = (element as HTMLElement).style;
    if (!style || typeof style.getPropertyValue !== 'function') return '';
    return style.getPropertyValue(property).trim();
  } catch {
    return '';
  }
}

function readComputedValue(element: Element, property: PositionProperty): string {
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

export interface PositionControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
}

export function createPositionControl(options: PositionControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  // ==========================================================================
  // DOM Structure
  // ==========================================================================

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Position select
  const positionRow = document.createElement('div');
  positionRow.className = 'we-field';

  const positionLabel = document.createElement('span');
  positionLabel.className = 'we-field-label';
  positionLabel.textContent = 'Position';

  const positionSelect = document.createElement('select');
  positionSelect.className = 'we-select';
  positionSelect.setAttribute('aria-label', 'Position');

  for (const value of POSITION_VALUES) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = value;
    positionSelect.append(opt);
  }

  positionRow.append(positionLabel, positionSelect);

  // Top/Right row
  const rowTR = document.createElement('div');
  rowTR.className = 'we-field-row';

  const topInput = createInput('Top');
  const rightInput = createInput('Right');

  const topField = createFieldWithLabel('T', topInput);
  const rightField = createFieldWithLabel('R', rightInput);

  rowTR.append(topField, rightField);

  // Bottom/Left row
  const rowBL = document.createElement('div');
  rowBL.className = 'we-field-row';

  const bottomInput = createInput('Bottom');
  const leftInput = createInput('Left');

  const bottomField = createFieldWithLabel('B', bottomInput);
  const leftField = createFieldWithLabel('L', leftInput);

  rowBL.append(bottomField, leftField);

  // Z-index row
  const zRow = document.createElement('div');
  zRow.className = 'we-field';

  const zLabel = document.createElement('span');
  zLabel.className = 'we-field-label';
  zLabel.textContent = 'Z-Index';

  const zInput = createInput('z-index');

  zRow.append(zLabel, zInput);

  root.append(positionRow, rowTR, rowBL, zRow);
  container.append(root);
  disposer.add(() => root.remove());

  function createInput(ariaLabel: string): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'we-input';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', ariaLabel);
    return input;
  }

  function createFieldWithLabel(labelText: string, input: HTMLInputElement): HTMLDivElement {
    const field = document.createElement('div');
    field.className = 'we-field';

    const label = document.createElement('span');
    label.className = 'we-field-label we-field-label--short';
    label.textContent = labelText;

    field.append(label, input);
    return field;
  }

  // Field state
  const fields: Record<PositionProperty, FieldState> = {
    position: { property: 'position', element: positionSelect, handle: null },
    top: { property: 'top', element: topInput, handle: null },
    right: { property: 'right', element: rightInput, handle: null },
    bottom: { property: 'bottom', element: bottomInput, handle: null },
    left: { property: 'left', element: leftInput, handle: null },
    'z-index': { property: 'z-index', element: zInput, handle: null },
  };

  // ==========================================================================
  // Transaction Management
  // ==========================================================================

  function beginTransaction(property: PositionProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.handle) return field.handle;

    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: PositionProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: PositionProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of POSITION_PROPERTIES) commitTransaction(p);
  }

  // ==========================================================================
  // Sync
  // ==========================================================================

  function syncField(property: PositionProperty, force = false): void {
    const field = fields[property];
    const el = field.element;
    const target = currentTarget;

    if (!target || !target.isConnected) {
      el.disabled = true;
      if (el instanceof HTMLInputElement) {
        el.value = '';
        el.placeholder = '';
      } else {
        el.value = 'static';
      }
      return;
    }

    el.disabled = false;
    const isEditing = field.handle !== null || isFieldFocused(el);

    if (el instanceof HTMLInputElement) {
      el.placeholder = readComputedValue(target, property);
      if (isEditing && !force) return;
      el.value = readInlineValue(target, property);
    } else {
      // Select
      const inline = readInlineValue(target, property);
      const computed = readComputedValue(target, property);
      el.title = inline ? '' : computed ? `Computed: ${computed}` : '';
      if (isEditing && !force) return;
      const val = inline || computed;
      el.value = (POSITION_VALUES as readonly string[]).includes(val) ? val : 'static';
    }
  }

  function syncAllFields(): void {
    for (const p of POSITION_PROPERTIES) syncField(p);
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  function wireInput(property: PositionProperty, normalize: (v: string) => string): void {
    const field = fields[property];
    const input = field.element as HTMLInputElement;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalize(input.value));
    });

    disposer.listen(input, 'blur', () => {
      commitTransaction(property);
      syncAllFields();
    });

    disposer.listen(input, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction(property);
        syncAllFields();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction(property);
        syncField(property, true);
      }
    });
  }

  function wireSelect(): void {
    const select = positionSelect;

    const preview = () => {
      const handle = beginTransaction('position');
      if (handle) handle.set(select.value);
    };

    disposer.listen(select, 'input', preview);
    disposer.listen(select, 'change', preview);

    disposer.listen(select, 'blur', () => {
      commitTransaction('position');
      syncAllFields();
    });

    disposer.listen(select, 'keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commitTransaction('position');
        syncAllFields();
        select.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        rollbackTransaction('position');
        syncField('position', true);
      }
    });
  }

  wireSelect();
  wireInput('top', normalizeLength);
  wireInput('right', normalizeLength);
  wireInput('bottom', normalizeLength);
  wireInput('left', normalizeLength);
  wireInput('z-index', normalizeZIndex);

  // ==========================================================================
  // Public API
  // ==========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
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

  syncAllFields();

  return { setTarget, refresh, dispose };
}
