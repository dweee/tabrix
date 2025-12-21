/**
 * Layout Control (Phase 3.4)
 *
 * Edits inline layout styles:
 * - display (select): block/inline/inline-block/flex/grid/none
 * - flex-direction (select, shown when display=flex)
 * - justify-content, align-items (select, shown when display=flex/grid)
 * - gap (input)
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const DISPLAY_VALUES = ['block', 'inline', 'inline-block', 'flex', 'grid', 'none'] as const;
const FLEX_DIRECTION_VALUES = ['row', 'row-reverse', 'column', 'column-reverse'] as const;
const FLEX_WRAP_VALUES = ['nowrap', 'wrap', 'wrap-reverse'] as const;
const JUSTIFY_VALUES = [
  'flex-start',
  'flex-end',
  'center',
  'space-between',
  'space-around',
  'space-evenly',
] as const;
const ALIGN_VALUES = ['stretch', 'flex-start', 'flex-end', 'center', 'baseline'] as const;

type LayoutProperty =
  | 'display'
  | 'flex-direction'
  | 'flex-wrap'
  | 'justify-content'
  | 'align-items'
  | 'gap';

interface FieldState {
  property: LayoutProperty;
  element: HTMLSelectElement | HTMLInputElement;
  handle: StyleTransactionHandle | null;
  row: HTMLElement;
}

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

function normalizeLength(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return `${trimmed}px`;
  if (/^-?\d+\.$/.test(trimmed)) return `${trimmed.slice(0, -1)}px`;
  return trimmed;
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

export interface LayoutControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
}

export function createLayoutControl(options: LayoutControlOptions): DesignControl {
  const { container, transactionManager } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // Display row
  const displayRow = createSelectRow('Display', 'display', DISPLAY_VALUES);
  const displaySelect = displayRow.querySelector('select') as HTMLSelectElement;

  // Flex direction row
  const directionRow = createSelectRow('Direction', 'flex-direction', FLEX_DIRECTION_VALUES);
  const directionSelect = directionRow.querySelector('select') as HTMLSelectElement;

  // Flex wrap row
  const wrapRow = createSelectRow('Wrap', 'flex-wrap', FLEX_WRAP_VALUES);
  const wrapSelect = wrapRow.querySelector('select') as HTMLSelectElement;

  // Justify row
  const justifyRow = createSelectRow('Justify', 'justify-content', JUSTIFY_VALUES);
  const justifySelect = justifyRow.querySelector('select') as HTMLSelectElement;

  // Align row
  const alignRow = createSelectRow('Align', 'align-items', ALIGN_VALUES);
  const alignSelect = alignRow.querySelector('select') as HTMLSelectElement;

  // Gap row
  const gapRow = document.createElement('div');
  gapRow.className = 'we-field';
  const gapLabel = document.createElement('span');
  gapLabel.className = 'we-field-label';
  gapLabel.textContent = 'Gap';
  const gapInput = document.createElement('input');
  gapInput.type = 'text';
  gapInput.className = 'we-input';
  gapInput.autocomplete = 'off';
  gapInput.setAttribute('aria-label', 'Gap');
  gapRow.append(gapLabel, gapInput);

  root.append(displayRow, directionRow, wrapRow, justifyRow, alignRow, gapRow);
  container.append(root);
  disposer.add(() => root.remove());

  function createSelectRow(
    labelText: string,
    ariaLabel: string,
    values: readonly string[],
  ): HTMLDivElement {
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
      select.append(opt);
    }
    row.append(label, select);
    return row;
  }

  const fields: Record<LayoutProperty, FieldState> = {
    display: { property: 'display', element: displaySelect, handle: null, row: displayRow },
    'flex-direction': {
      property: 'flex-direction',
      element: directionSelect,
      handle: null,
      row: directionRow,
    },
    'flex-wrap': { property: 'flex-wrap', element: wrapSelect, handle: null, row: wrapRow },
    'justify-content': {
      property: 'justify-content',
      element: justifySelect,
      handle: null,
      row: justifyRow,
    },
    'align-items': { property: 'align-items', element: alignSelect, handle: null, row: alignRow },
    gap: { property: 'gap', element: gapInput, handle: null, row: gapRow },
  };

  const PROPS: readonly LayoutProperty[] = [
    'display',
    'flex-direction',
    'flex-wrap',
    'justify-content',
    'align-items',
    'gap',
  ];

  function beginTransaction(property: LayoutProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;
    const field = fields[property];
    if (field.handle) return field.handle;
    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: LayoutProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: LayoutProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of PROPS) commitTransaction(p);
  }

  function updateVisibility(): void {
    const display = displaySelect.value;
    const isFlexOrGrid = display === 'flex' || display === 'grid';
    const isFlex = display === 'flex';

    directionRow.hidden = !isFlex;
    wrapRow.hidden = !isFlex;
    justifyRow.hidden = !isFlexOrGrid;
    alignRow.hidden = !isFlexOrGrid;
    gapRow.hidden = !isFlexOrGrid;
  }

  function syncField(property: LayoutProperty, force = false): void {
    const field = fields[property];
    const el = field.element;
    const target = currentTarget;

    if (!target || !target.isConnected) {
      el.disabled = true;
      if (el instanceof HTMLInputElement) {
        el.value = '';
        el.placeholder = '';
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
      const inline = readInlineValue(target, property);
      const computed = readComputedValue(target, property);
      if (isEditing && !force) return;
      const val = inline || computed;
      // Check if value exists in options
      const hasOption = Array.from(el.options).some((o) => o.value === val);
      el.value = hasOption ? val : (el.options[0]?.value ?? '');
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
    updateVisibility();
  }

  function wireSelect(property: LayoutProperty): void {
    const field = fields[property];
    const select = field.element as HTMLSelectElement;

    const preview = () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(select.value);
      if (property === 'display') updateVisibility();
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

  function wireInput(property: LayoutProperty): void {
    const input = fields[property].element as HTMLInputElement;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (handle) handle.set(normalizeLength(input.value));
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

  wireSelect('display');
  wireSelect('flex-direction');
  wireSelect('flex-wrap');
  wireSelect('justify-content');
  wireSelect('align-items');
  wireInput('gap');

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
