/**
 * Appearance Control (Phase 3.8 - Refactored)
 *
 * Edits inline appearance styles with grouped sections:
 *
 * General:
 * - overflow (select)
 * - box-sizing (select)
 * - opacity (input)
 *
 * Border (grouped):
 * - edge selector (all/top/right/bottom/left)
 * - border-width (input)
 * - border-style (select: solid/dashed/dotted/none)
 * - border-color (color picker)
 * - border-radius (input)
 *
 * Background (grouped):
 * - type selector (solid/gradient/image)
 * - solid: background-color picker
 * - gradient: gradient editor (reuses gradient-control.ts)
 * - image: background-image URL input
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import { createIconButtonGroup, type IconButtonGroup } from '../components/icon-button-group';
import { createColorField, type ColorField } from './color-field';
import { createGradientControl } from './gradient-control';
import { wireNumberStepping } from './number-stepping';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

const OVERFLOW_VALUES = ['visible', 'hidden', 'scroll', 'auto'] as const;
const BOX_SIZING_VALUES = ['content-box', 'border-box'] as const;
const BORDER_STYLE_VALUES = ['solid', 'dashed', 'dotted', 'none'] as const;

const BORDER_EDGE_VALUES = ['all', 'top', 'right', 'bottom', 'left'] as const;
type BorderEdge = (typeof BORDER_EDGE_VALUES)[number];

const BACKGROUND_TYPE_VALUES = ['solid', 'gradient', 'image'] as const;
type BackgroundType = (typeof BACKGROUND_TYPE_VALUES)[number];

// =============================================================================
// Types
// =============================================================================

/** Standard CSS properties managed by this control */
type AppearanceProperty =
  | 'overflow'
  | 'box-sizing'
  | 'opacity'
  | 'border-radius'
  | 'border-width'
  | 'border-style'
  | 'border-color'
  | 'background-color'
  | 'background-image';

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

/**
 * Create SVG icon for border edge selector
 */
function createBorderEdgeIcon(edge: BorderEdge): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  // Base outline (dimmed)
  const outline = document.createElementNS(SVG_NS, 'rect');
  outline.setAttribute('x', '3.5');
  outline.setAttribute('y', '3.5');
  outline.setAttribute('width', '8');
  outline.setAttribute('height', '8');
  outline.setAttribute('stroke', 'currentColor');
  outline.setAttribute('stroke-width', '1');
  outline.setAttribute('opacity', '0.4');
  svg.appendChild(outline);

  // Highlighted edge
  const highlight = document.createElementNS(SVG_NS, 'path');
  highlight.setAttribute('stroke', 'currentColor');
  highlight.setAttribute('stroke-width', '2');
  highlight.setAttribute('stroke-linecap', 'round');

  switch (edge) {
    case 'all':
      highlight.setAttribute('d', 'M3.5 3.5h8v8h-8z');
      break;
    case 'top':
      highlight.setAttribute('d', 'M3.5 3.5h8');
      break;
    case 'right':
      highlight.setAttribute('d', 'M11.5 3.5v8');
      break;
    case 'bottom':
      highlight.setAttribute('d', 'M3.5 11.5h8');
      break;
    case 'left':
      highlight.setAttribute('d', 'M3.5 3.5v8');
      break;
  }

  svg.appendChild(highlight);
  return svg;
}

/**
 * Infer background type from background-image CSS value
 */
function inferBackgroundType(bgImage: string): BackgroundType {
  const trimmed = bgImage.trim().toLowerCase();
  if (!trimmed || trimmed === 'none') return 'solid';
  if (/\b(?:linear|radial|conic)-gradient\s*\(/i.test(trimmed)) return 'gradient';
  if (/\burl\s*\(/i.test(trimmed)) return 'image';
  return 'solid';
}

/**
 * Extract URL from background-image: url("...") value
 */
function extractUrlFromBackgroundImage(raw: string): string {
  const match = raw.trim().match(/\burl\(\s*(['"]?)(.*?)\1\s*\)/i);
  return match?.[2]?.trim() ?? '';
}

/**
 * Normalize user input to background-image: url("...") format
 */
function normalizeBackgroundImageUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (/^none$/i.test(trimmed)) return 'none';
  if (/^url\s*\(/i.test(trimmed)) return trimmed;
  // Escape special characters
  const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `url("${escaped}")`;
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
  let currentBorderEdge: BorderEdge = 'all';
  let currentBackgroundType: BackgroundType = 'solid';

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

  function createColorRow(labelText: string): {
    row: HTMLDivElement;
    colorFieldContainer: HTMLDivElement;
  } {
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

  function createSection(title: string): HTMLDivElement {
    const section = document.createElement('div');
    section.className = 'we-spacing-section';
    const header = document.createElement('div');
    header.className = 'we-spacing-header';
    header.textContent = title;
    section.appendChild(header);
    return section;
  }

  // ===========================================================================
  // General Section
  // ===========================================================================

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

  wireNumberStepping(disposer, opacityInput, {
    mode: 'number',
    min: 0,
    max: 1,
    step: 0.01,
    shiftStep: 0.1,
    altStep: 0.001,
  });

  // ===========================================================================
  // Border Section
  // ===========================================================================

  const borderSection = createSection('Border');

  // Edge selector row
  const borderEdgeRow = document.createElement('div');
  borderEdgeRow.className = 'we-field';
  const borderEdgeLabel = document.createElement('span');
  borderEdgeLabel.className = 'we-field-label';
  borderEdgeLabel.textContent = 'Edge';
  const borderEdgeMount = document.createElement('div');
  borderEdgeMount.style.flex = '1';
  borderEdgeRow.append(borderEdgeLabel, borderEdgeMount);

  const { row: borderWidthRow, input: borderWidthInput } = createInputRow('Width', 'Border Width');
  const { row: borderStyleRow, select: borderStyleSelect } = createSelectRow(
    'Style',
    'Border Style',
    BORDER_STYLE_VALUES,
  );
  const { row: borderColorRow, colorFieldContainer: borderColorContainer } =
    createColorRow('Color');
  const { row: radiusRow, input: radiusInput } = createInputRow('Radius', 'Border Radius');

  wireNumberStepping(disposer, borderWidthInput, { mode: 'css-length' });
  wireNumberStepping(disposer, radiusInput, { mode: 'css-length' });

  borderSection.append(borderEdgeRow, borderWidthRow, borderStyleRow, borderColorRow, radiusRow);

  // ===========================================================================
  // Background Section
  // ===========================================================================

  const backgroundSection = createSection('Background');

  // Type selector
  const bgTypeRow = document.createElement('div');
  bgTypeRow.className = 'we-field';
  const bgTypeLabel = document.createElement('span');
  bgTypeLabel.className = 'we-field-label';
  bgTypeLabel.textContent = 'Type';
  const bgTypeSelect = document.createElement('select');
  bgTypeSelect.className = 'we-select';
  bgTypeSelect.setAttribute('aria-label', 'Background Type');
  for (const v of BACKGROUND_TYPE_VALUES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v.charAt(0).toUpperCase() + v.slice(1);
    bgTypeSelect.appendChild(opt);
  }
  bgTypeRow.append(bgTypeLabel, bgTypeSelect);

  // Solid color row
  const { row: bgColorRow, colorFieldContainer: bgColorContainer } = createColorRow('Color');

  // Gradient mount
  const bgGradientMount = document.createElement('div');

  // Image URL row
  const { row: bgImageRow, input: bgImageInput } = createInputRow('URL', 'Background Image URL');
  bgImageInput.placeholder = 'https://...';
  bgImageInput.spellcheck = false;

  backgroundSection.append(bgTypeRow, bgColorRow, bgGradientMount, bgImageRow);

  // ===========================================================================
  // Assemble DOM
  // ===========================================================================

  root.append(overflowRow, boxSizingRow, opacityRow, borderSection, backgroundSection);
  container.appendChild(root);
  disposer.add(() => root.remove());

  // ===========================================================================
  // Border Edge Selector
  // ===========================================================================

  const borderEdgeGroup = createIconButtonGroup<BorderEdge>({
    container: borderEdgeMount,
    ariaLabel: 'Border edge',
    columns: 5,
    value: currentBorderEdge,
    items: BORDER_EDGE_VALUES.map((edge) => ({
      value: edge,
      ariaLabel: edge,
      title: edge.charAt(0).toUpperCase() + edge.slice(1),
      icon: createBorderEdgeIcon(edge),
    })),
    onChange: (edge) => {
      if (edge === currentBorderEdge) return;
      // Commit current edge transactions before switching
      commitTransaction('border-width');
      commitTransaction('border-style');
      commitTransaction('border-color');
      currentBorderEdge = edge;
      syncAllFields();
    },
  });
  disposer.add(() => borderEdgeGroup.dispose());

  // ===========================================================================
  // Gradient Control
  // ===========================================================================

  const gradientControl = createGradientControl({
    container: bgGradientMount,
    transactionManager,
  });
  disposer.add(() => gradientControl.dispose());

  // ===========================================================================
  // Color Fields
  // ===========================================================================

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
    'border-style': {
      kind: 'select',
      property: 'border-style',
      element: borderStyleSelect,
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
    'background-image': {
      kind: 'text',
      property: 'background-image',
      element: bgImageInput,
      handle: null,
    },
  };

  const PROPS: readonly AppearanceProperty[] = [
    'overflow',
    'box-sizing',
    'opacity',
    'border-radius',
    'border-width',
    'border-style',
    'border-color',
    'background-color',
    'background-image',
  ];

  // ===========================================================================
  // CSS Property Resolution (handles border edge selection)
  // ===========================================================================

  function resolveBorderProperty(kind: 'width' | 'style' | 'color'): string {
    if (currentBorderEdge === 'all') return `border-${kind}`;
    return `border-${currentBorderEdge}-${kind}`;
  }

  function resolveCssProperty(property: AppearanceProperty): string {
    if (property === 'border-width') return resolveBorderProperty('width');
    if (property === 'border-style') return resolveBorderProperty('style');
    if (property === 'border-color') return resolveBorderProperty('color');
    return property;
  }

  // ===========================================================================
  // Transaction Management
  // ===========================================================================

  function beginTransaction(property: AppearanceProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;

    const field = fields[property];
    if (field.handle) return field.handle;

    const cssProperty = resolveCssProperty(property);
    const handle = transactionManager.beginStyle(target, cssProperty);
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
  // Background Type Visibility
  // ===========================================================================

  function updateBackgroundVisibility(): void {
    bgColorRow.hidden = currentBackgroundType !== 'solid';
    bgGradientMount.hidden = currentBackgroundType !== 'gradient';
    bgImageRow.hidden = currentBackgroundType !== 'image';
  }

  function setBackgroundType(type: BackgroundType): void {
    const target = currentTarget;
    currentBackgroundType = type;
    bgTypeSelect.value = type;
    updateBackgroundVisibility();

    if (!target || !target.isConnected) return;

    // Clear conflicting background-image when switching to solid
    if (type === 'solid') {
      // Commit any pending background-image transaction first
      commitTransaction('background-image');
      // Then clear background-image
      const handle = transactionManager.beginStyle(target, 'background-image');
      if (handle) {
        handle.set('none');
        handle.commit({ merge: true });
      }
    }
  }

  // Background type change handler
  disposer.listen(bgTypeSelect, 'change', () => {
    const type = bgTypeSelect.value as BackgroundType;
    setBackgroundType(type);
    gradientControl.refresh();
    syncAllFields();
  });

  // ===========================================================================
  // Field Synchronization
  // ===========================================================================

  function syncField(property: AppearanceProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;
    const cssProperty = resolveCssProperty(property);

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

      const inlineValue = readInlineValue(target, cssProperty);
      const computedValue = readComputedValue(target, cssProperty);
      const displayValue = inlineValue || computedValue;

      // Special handling for background-image URL field
      if (property === 'background-image') {
        input.value = extractUrlFromBackgroundImage(displayValue);
      } else {
        input.value = displayValue;
      }
      input.placeholder = '';
    } else if (field.kind === 'select') {
      const select = field.element;

      if (!target || !target.isConnected) {
        select.disabled = true;
        return;
      }

      select.disabled = false;

      const isEditing = field.handle !== null || isFieldFocused(select);
      if (isEditing && !force) return;

      const inline = readInlineValue(target, cssProperty);
      const computed = readComputedValue(target, cssProperty);
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

      const isEditing = field.handle !== null || colorField.isFocused();
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, cssProperty);
      const computedValue = readComputedValue(target, cssProperty);
      if (inlineValue) {
        colorField.setValue(inlineValue);
        colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : '');
      } else {
        colorField.setValue(computedValue);
        colorField.setPlaceholder('');
      }
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
    const hasTarget = Boolean(currentTarget && currentTarget.isConnected);
    borderEdgeGroup.setDisabled(!hasTarget);
    bgTypeSelect.disabled = !hasTarget;
    updateBackgroundVisibility();
  }

  // ===========================================================================
  // Event Wiring
  // ===========================================================================

  function getNormalizer(property: AppearanceProperty): (v: string) => string {
    if (property === 'opacity') return normalizeOpacity;
    if (property === 'border-radius' || property === 'border-width') return normalizeLength;
    if (property === 'background-image') return normalizeBackgroundImageUrl;
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

  // Wire all fields
  wireSelect('overflow');
  wireSelect('box-sizing');
  wireTextInput('opacity');
  wireTextInput('border-radius');
  wireTextInput('border-width');
  wireSelect('border-style');
  wireTextInput('background-image');

  // ===========================================================================
  // Public API
  // ===========================================================================

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) commitAllTransactions();
    currentTarget = element;

    // Infer background type from element
    if (element && element.isConnected) {
      const bgImage =
        readInlineValue(element, 'background-image') ||
        readComputedValue(element, 'background-image');
      currentBackgroundType = inferBackgroundType(bgImage);
      bgTypeSelect.value = currentBackgroundType;
    } else {
      currentBackgroundType = 'solid';
      bgTypeSelect.value = 'solid';
    }

    gradientControl.setTarget(element);
    updateBackgroundVisibility();
    syncAllFields();
  }

  function refresh(): void {
    if (disposer.isDisposed) return;
    gradientControl.refresh();
    syncAllFields();
  }

  function dispose(): void {
    commitAllTransactions();
    currentTarget = null;
    // gradientControl.dispose() is called via disposer.add() registration
    disposer.dispose();
  }

  // Initial state
  updateBackgroundVisibility();
  syncAllFields();

  return { setTarget, refresh, dispose };
}
