/**
 * Appearance Control (Phase 3.8)
 *
 * Edits inline appearance styles:
 * - overflow (select)
 * - box-sizing (select)
 * - opacity (input)
 * - border-radius (input)
 * - border-width (input)
 * - border-color (color picker)
 * - background-color (color picker)
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import { createColorField, type ColorField } from './color-field';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const OVERFLOW_VALUES = ['visible', 'hidden', 'scroll', 'auto'] as const;
const BOX_SIZING_VALUES = ['content-box', 'border-box'] as const;

// =============================================================================
// Types
// =============================================================================

type AppearanceProperty =
  | 'overflow'
  | 'box-sizing'
  | 'opacity'
  | 'border-radius'
  | 'border-width'
  | 'border-color'
  | 'background-color';

/** Text input field state */
interface TextFieldState {
  kind: 'text';
  property: AppearanceProperty;
  element: HTMLInputElement;
  handle: StyleTransactionHandle | null;
}

/** Select field state */
interface SelectFieldState {
  kind: 'select';
  property: AppearanceProperty;
  element: HTMLSelectElement;
  handle: StyleTransactionHandle | null;
}

/** Color field state */
interface ColorFieldState {
  kind: 'color';
  property: AppearanceProperty;
  field: ColorField;
  handle: StyleTransactionHandle | null;
}

type FieldState = TextFieldState | SelectFieldState | ColorFieldState;

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

function normalizeOpacity(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Keep as-is (browser will validate)
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

  // -------------------------------------------------------------------------
  // Helper: Create a standard text input row
  // -------------------------------------------------------------------------
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

  // -------------------------------------------------------------------------
  // Helper: Create a select row
  // -------------------------------------------------------------------------
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
      select.append(opt);
    }
    row.append(label, select);
    return { row, select };
  }

  // -------------------------------------------------------------------------
  // Helper: Create a color field row (swatch + text input)
  // -------------------------------------------------------------------------
  function createColorRow(
    labelText: string,
    ariaLabel: string,
  ): { row: HTMLDivElement; colorFieldContainer: HTMLDivElement } {
    const row = document.createElement('div');
    row.className = 'we-field';
    const label = document.createElement('span');
    label.className = 'we-field-label';
    label.textContent = labelText;
    const colorFieldContainer = document.createElement('div');
    colorFieldContainer.style.flex = '1';
    colorFieldContainer.style.minWidth = '0';
    row.append(label, colorFieldContainer);
    return { row, colorFieldContainer };
  }

  // -------------------------------------------------------------------------
  // Create rows
  // -------------------------------------------------------------------------
  const { row: overflowRow, select: overflowSelect } = createSelectRow(
    'Overflow',
    'Overflow',
    OVERFLOW_VALUES,
  );
  const { row: boxSizingRow, select: boxSizingSelect } = createSelectRow(
    'Box Size',
    'Box Sizing',
    BOX_SIZING_VALUES,
  );
  const { row: opacityRow, input: opacityInput } = createInputRow('Opacity', 'Opacity');
  const { row: radiusRow, input: radiusInput } = createInputRow('Radius', 'Border Radius');
  const { row: borderWidthRow, input: borderWidthInput } = createInputRow(
    'Border W',
    'Border Width',
  );
  const { row: borderColorRow, colorFieldContainer: borderColorContainer } = createColorRow(
    'Border C',
    'Border Color',
  );
  const { row: bgColorRow, colorFieldContainer: bgColorContainer } = createColorRow(
    'Bg Color',
    'Background Color',
  );

  root.append(
    overflowRow,
    boxSizingRow,
    opacityRow,
    radiusRow,
    borderWidthRow,
    borderColorRow,
    bgColorRow,
  );
  container.append(root);
  disposer.add(() => root.remove());

  // -------------------------------------------------------------------------
  // Create ColorField instances for color properties
  // -------------------------------------------------------------------------
  const borderColorField = createColorField({
    container: borderColorContainer,
    ariaLabel: 'Border Color',
    onInput: (value) => {
      const handle = beginTransaction('border-color');
      if (handle) handle.set(value);
    },
    onCommit: () => {
      commitTransaction('border-color');
      syncAllFields();
    },
    onCancel: () => {
      rollbackTransaction('border-color');
      syncField('border-color', true);
    },
  });
  disposer.add(() => borderColorField.dispose());

  const bgColorField = createColorField({
    container: bgColorContainer,
    ariaLabel: 'Background Color',
    onInput: (value) => {
      const handle = beginTransaction('background-color');
      if (handle) handle.set(value);
    },
    onCommit: () => {
      commitTransaction('background-color');
      syncAllFields();
    },
    onCancel: () => {
      rollbackTransaction('background-color');
      syncField('background-color', true);
    },
  });
  disposer.add(() => bgColorField.dispose());

  // -------------------------------------------------------------------------
  // Field state map
  // -------------------------------------------------------------------------
  const fields: Record<AppearanceProperty, FieldState> = {
    overflow: { kind: 'select', property: 'overflow', element: overflowSelect, handle: null },
    'box-sizing': {
      kind: 'select',
      property: 'box-sizing',
      element: boxSizingSelect,
      handle: null,
    },
    opacity: { kind: 'text', property: 'opacity', element: opacityInput, handle: null },
    'border-radius': {
      kind: 'text',
      property: 'border-radius',
      element: radiusInput,
      handle: null,
    },
    'border-width': {
      kind: 'text',
      property: 'border-width',
      element: borderWidthInput,
      handle: null,
    },
    'border-color': {
      kind: 'color',
      property: 'border-color',
      field: borderColorField,
      handle: null,
    },
    'background-color': {
      kind: 'color',
      property: 'background-color',
      field: bgColorField,
      handle: null,
    },
  };

  const PROPS: readonly AppearanceProperty[] = [
    'overflow',
    'box-sizing',
    'opacity',
    'border-radius',
    'border-width',
    'border-color',
    'background-color',
  ];

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
      input.placeholder = readComputedValue(target, property);

      const isEditing = field.handle !== null || isFieldFocused(input);
      if (isEditing && !force) return;

      input.value = readInlineValue(target, property);
    } else if (field.kind === 'select') {
      // Select field
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
    } else {
      // Color field
      const colorField = field.field;

      if (!target || !target.isConnected) {
        colorField.setDisabled(true);
        colorField.setValue('');
        colorField.setPlaceholder('');
        return;
      }

      colorField.setDisabled(false);
      colorField.setPlaceholder(readComputedValue(target, property));

      const isEditing = field.handle !== null || colorField.isFocused();
      if (isEditing && !force) return;

      colorField.setValue(readInlineValue(target, property));
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
  }

  function getNormalizer(property: AppearanceProperty): (v: string) => string {
    if (property === 'opacity') return normalizeOpacity;
    if (property === 'border-radius' || property === 'border-width') return normalizeLength;
    return (v) => v.trim();
  }

  function wireTextInput(property: AppearanceProperty): void {
    const field = fields[property];
    if (field.kind !== 'text') return;

    const input = field.element;
    const normalize = getNormalizer(property);

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

  // Wire select fields
  wireSelect('overflow');
  wireSelect('box-sizing');

  // Wire text inputs (color fields are wired via their own callbacks)
  wireTextInput('opacity');
  wireTextInput('border-radius');
  wireTextInput('border-width');

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
