/**
 * Typography Control (Phase 3.7)
 *
 * Edits inline typography styles:
 * - font-family (select + custom input)
 * - font-size (input)
 * - font-weight (select)
 * - line-height (input)
 * - letter-spacing (input)
 * - text-align (icon button group)
 * - vertical-align (icon button group)
 * - color (input with optional token picker)
 *
 * Phase 5.4: Added optional DesignTokensService integration for color field.
 */

import { Disposer } from '../../../utils/disposables';
import type { StyleTransactionHandle, TransactionManager } from '../../../core/transaction-manager';
import type { DesignTokensService } from '../../../core/design-tokens';
import { createColorField, type ColorField } from './color-field';
import { createInputContainer, type InputContainer } from '../components/input-container';
import { createIconButtonGroup, type IconButtonGroup } from '../components/icon-button-group';
import { combineLengthValue, formatLengthForDisplay, hasExplicitUnit } from './css-helpers';
import { wireNumberStepping } from './number-stepping';
import type { DesignControl } from '../types';

// =============================================================================
// Constants
// =============================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';

const FONT_WEIGHT_VALUES = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
const TEXT_ALIGN_VALUES = ['left', 'center', 'right', 'justify'] as const;
const VERTICAL_ALIGN_VALUES = ['baseline', 'middle', 'top', 'bottom'] as const;

type TextAlignValue = (typeof TEXT_ALIGN_VALUES)[number];
type VerticalAlignValue = (typeof VERTICAL_ALIGN_VALUES)[number];
const FONT_FAMILY_PRESET_VALUES = [
  'inherit',
  'system-ui',
  'sans-serif',
  'serif',
  'monospace',
] as const;
const FONT_FAMILY_CUSTOM_VALUE = 'custom';

type TypographyProperty =
  | 'font-family'
  | 'font-size'
  | 'font-weight'
  | 'line-height'
  | 'letter-spacing'
  | 'text-align'
  | 'vertical-align'
  | 'color';

/** Standard input/select field state */
interface StandardFieldState {
  kind: 'standard';
  property: TypographyProperty;
  element: HTMLSelectElement | HTMLInputElement;
  handle: StyleTransactionHandle | null;
  /** InputContainer reference for input fields (null/undefined for selects) */
  container?: InputContainer;
}

/** Font-family field state (preset select + optional custom input) */
interface FontFamilyFieldState {
  kind: 'font-family';
  property: 'font-family';
  select: HTMLSelectElement;
  custom: InputContainer;
  controlsContainer: HTMLElement;
  handle: StyleTransactionHandle | null;
}

/** Text-align field state (icon button group) */
interface TextAlignFieldState {
  kind: 'text-align';
  property: 'text-align';
  group: IconButtonGroup<TextAlignValue>;
  handle: StyleTransactionHandle | null;
}

/** Vertical-align field state (icon button group) */
interface VerticalAlignFieldState {
  kind: 'vertical-align';
  property: 'vertical-align';
  group: IconButtonGroup<VerticalAlignValue>;
  handle: StyleTransactionHandle | null;
}

/** Color field state */
interface ColorFieldState {
  kind: 'color';
  property: TypographyProperty;
  field: ColorField;
  handle: StyleTransactionHandle | null;
}

type FieldState =
  | StandardFieldState
  | FontFamilyFieldState
  | TextAlignFieldState
  | VerticalAlignFieldState
  | ColorFieldState;

// =============================================================================
// SVG Icon Helpers
// =============================================================================

function createBaseIconSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 15 15');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

function applyStroke(el: SVGElement, strokeWidth = '1.4'): void {
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', strokeWidth);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
}

function createTextAlignIcon(value: TextAlignValue): SVGElement {
  const svg = createBaseIconSvg();
  const path = document.createElementNS(SVG_NS, 'path');
  applyStroke(path, '1.4');

  const iconPaths: Record<TextAlignValue, string> = {
    left: 'M2.5 4.5H12.5M2.5 7.5H8.5M2.5 10.5H10.5',
    center: 'M3.5 4.5H11.5M5.5 7.5H9.5M4.5 10.5H10.5',
    right: 'M2.5 4.5H12.5M6.5 7.5H12.5M4.5 10.5H12.5',
    justify: 'M2.5 4.5H12.5M2.5 7.5H12.5M2.5 10.5H12.5',
  };

  path.setAttribute('d', iconPaths[value]);
  svg.append(path);
  return svg;
}

function createVerticalAlignIcon(value: VerticalAlignValue): SVGElement {
  const svg = createBaseIconSvg();

  // Baseline/guide line
  const guide = document.createElementNS(SVG_NS, 'path');
  applyStroke(guide, '1.2');

  // Content box representation
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('x', '4.5');
  rect.setAttribute('width', '6');
  rect.setAttribute('rx', '1');
  rect.setAttribute('fill', 'none');
  applyStroke(rect, '1.2');

  let lineY = 10.5;
  let rectY = 4;
  let rectH = 6.5;

  switch (value) {
    case 'top':
      lineY = 2.5;
      rectY = 2.5;
      rectH = 6.5;
      break;
    case 'middle':
      lineY = 7.5;
      rectY = 4.5;
      rectH = 6;
      break;
    case 'bottom':
      lineY = 12.5;
      rectY = 6;
      rectH = 6.5;
      break;
    case 'baseline':
      lineY = 10.5;
      rectY = 4;
      rectH = 6.5;
      break;
  }

  guide.setAttribute('d', `M2.5 ${lineY}H12.5`);
  rect.setAttribute('y', String(rectY));
  rect.setAttribute('height', String(rectH));

  svg.append(guide, rect);

  // For baseline, add descender indicator
  if (value === 'baseline') {
    const desc = document.createElementNS(SVG_NS, 'rect');
    desc.setAttribute('x', '8.5');
    desc.setAttribute('y', String(lineY));
    desc.setAttribute('width', '2.5');
    desc.setAttribute('height', '2.5');
    desc.setAttribute('rx', '0.8');
    desc.setAttribute('fill', 'none');
    applyStroke(desc, '1.2');
    svg.append(desc);
  }

  return svg;
}

function isTextAlignValue(value: string): value is TextAlignValue {
  return (TEXT_ALIGN_VALUES as readonly string[]).includes(value);
}

function isVerticalAlignValue(value: string): value is VerticalAlignValue {
  return (VERTICAL_ALIGN_VALUES as readonly string[]).includes(value);
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

/**
 * Normalize line-height value.
 * Keeps unitless numbers as-is (e.g., "1.5" stays "1.5", not "1.5px")
 * because unitless line-height is relative to font-size.
 */
function normalizeLineHeight(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Keep unitless numbers as-is for line-height
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

export interface TypographyControlOptions {
  container: HTMLElement;
  transactionManager: TransactionManager;
  /** Optional: DesignTokensService for token picker integration (Phase 5.4) */
  tokensService?: DesignTokensService;
}

export function createTypographyControl(options: TypographyControlOptions): DesignControl {
  const { container, transactionManager, tokensService } = options;
  const disposer = new Disposer();

  let currentTarget: Element | null = null;

  const root = document.createElement('div');
  root.className = 'we-field-group';

  // ---------------------------------------------------------------------------
  // Font Family (preset select + optional custom input)
  // ---------------------------------------------------------------------------
  const fontFamilyRow = document.createElement('div');
  fontFamilyRow.className = 'we-field';
  const fontFamilyLabel = document.createElement('span');
  fontFamilyLabel.className = 'we-field-label';
  fontFamilyLabel.textContent = 'Font';

  const fontFamilyControls = document.createElement('div');
  fontFamilyControls.className = 'we-field-content';
  fontFamilyControls.style.display = 'flex';
  fontFamilyControls.style.flexDirection = 'column';
  fontFamilyControls.style.gap = '4px';

  const fontFamilySelect = document.createElement('select');
  fontFamilySelect.className = 'we-select';
  fontFamilySelect.setAttribute('aria-label', 'Font Family');
  for (const v of FONT_FAMILY_PRESET_VALUES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    fontFamilySelect.append(opt);
  }
  const customFontOpt = document.createElement('option');
  customFontOpt.value = FONT_FAMILY_CUSTOM_VALUE;
  customFontOpt.textContent = 'Custom…';
  fontFamilySelect.append(customFontOpt);

  const fontFamilyCustomContainer = createInputContainer({
    ariaLabel: 'Custom Font Family',
    prefix: null,
    suffix: null,
    placeholder: 'e.g. Inter, system-ui',
  });
  fontFamilyCustomContainer.root.style.display = 'none';
  fontFamilyCustomContainer.input.disabled = true;

  fontFamilyControls.append(fontFamilySelect, fontFamilyCustomContainer.root);
  fontFamilyRow.append(fontFamilyLabel, fontFamilyControls);

  // ---------------------------------------------------------------------------
  // Font Size (with input-container for suffix support)
  // ---------------------------------------------------------------------------
  const fontSizeRow = document.createElement('div');
  fontSizeRow.className = 'we-field';
  const fontSizeLabel = document.createElement('span');
  fontSizeLabel.className = 'we-field-label';
  fontSizeLabel.textContent = 'Size';
  const fontSizeContainer = createInputContainer({
    ariaLabel: 'Font Size',
    inputMode: 'decimal',
    prefix: null,
    suffix: 'px',
  });
  fontSizeRow.append(fontSizeLabel, fontSizeContainer.root);

  // Font Weight
  const fontWeightRow = document.createElement('div');
  fontWeightRow.className = 'we-field';
  const fontWeightLabel = document.createElement('span');
  fontWeightLabel.className = 'we-field-label';
  fontWeightLabel.textContent = 'Weight';
  const fontWeightSelect = document.createElement('select');
  fontWeightSelect.className = 'we-select';
  fontWeightSelect.setAttribute('aria-label', 'Font Weight');
  for (const v of FONT_WEIGHT_VALUES) {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    fontWeightSelect.append(opt);
  }
  fontWeightRow.append(fontWeightLabel, fontWeightSelect);

  // Line Height (with input-container, suffix only shown if value has unit)
  const lineHeightRow = document.createElement('div');
  lineHeightRow.className = 'we-field';
  const lineHeightLabel = document.createElement('span');
  lineHeightLabel.className = 'we-field-label';
  lineHeightLabel.textContent = 'Line Height';
  const lineHeightContainer = createInputContainer({
    ariaLabel: 'Line Height',
    inputMode: 'decimal',
    prefix: null,
    suffix: null, // Will be set dynamically based on value
  });
  lineHeightRow.append(lineHeightLabel, lineHeightContainer.root);

  // ---------------------------------------------------------------------------
  // Letter Spacing
  // ---------------------------------------------------------------------------
  const letterSpacingRow = document.createElement('div');
  letterSpacingRow.className = 'we-field';
  const letterSpacingLabel = document.createElement('span');
  letterSpacingLabel.className = 'we-field-label';
  letterSpacingLabel.textContent = 'Spacing';
  const letterSpacingContainer = createInputContainer({
    ariaLabel: 'Letter Spacing',
    inputMode: 'decimal',
    prefix: null,
    suffix: 'px',
  });
  letterSpacingRow.append(letterSpacingLabel, letterSpacingContainer.root);

  // Wire up keyboard stepping for arrow up/down
  wireNumberStepping(disposer, fontSizeContainer.input, { mode: 'css-length' });
  wireNumberStepping(disposer, lineHeightContainer.input, {
    mode: 'css-length',
    step: 0.1,
    shiftStep: 1,
    altStep: 0.01,
  });
  wireNumberStepping(disposer, letterSpacingContainer.input, {
    mode: 'css-length',
    step: 0.1,
    shiftStep: 1,
    altStep: 0.01,
  });

  // ---------------------------------------------------------------------------
  // Text Align (icon button group)
  // ---------------------------------------------------------------------------
  const textAlignRow = document.createElement('div');
  textAlignRow.className = 'we-field';
  const textAlignLabel = document.createElement('span');
  textAlignLabel.className = 'we-field-label';
  textAlignLabel.textContent = 'Text Align';
  const textAlignMount = document.createElement('div');
  textAlignMount.className = 'we-field-content';
  textAlignRow.append(textAlignLabel, textAlignMount);

  // ---------------------------------------------------------------------------
  // Vertical Align (icon button group)
  // ---------------------------------------------------------------------------
  const verticalAlignRow = document.createElement('div');
  verticalAlignRow.className = 'we-field';
  const verticalAlignLabel = document.createElement('span');
  verticalAlignLabel.className = 'we-field-label';
  verticalAlignLabel.textContent = 'Vertical Align';
  const verticalAlignMount = document.createElement('div');
  verticalAlignMount.className = 'we-field-content';
  verticalAlignRow.append(verticalAlignLabel, verticalAlignMount);

  // ---------------------------------------------------------------------------
  // Color (with ColorField - TokenPill and TokenPicker are now built into ColorField)
  // ---------------------------------------------------------------------------
  const colorRow = document.createElement('div');
  colorRow.className = 'we-field';

  const colorLabel = document.createElement('span');
  colorLabel.className = 'we-field-label';
  colorLabel.textContent = 'Color';

  const colorFieldContainer = document.createElement('div');
  colorFieldContainer.style.minWidth = '0';

  colorRow.append(colorLabel, colorFieldContainer);

  root.append(
    fontFamilyRow,
    fontSizeRow,
    fontWeightRow,
    lineHeightRow,
    letterSpacingRow,
    textAlignRow,
    verticalAlignRow,
    colorRow,
  );
  container.append(root);
  disposer.add(() => root.remove());

  // -------------------------------------------------------------------------
  // Create IconButtonGroup instances for text-align and vertical-align
  // -------------------------------------------------------------------------
  const textAlignGroup = createIconButtonGroup<TextAlignValue>({
    container: textAlignMount,
    ariaLabel: 'Text Align',
    columns: 4,
    items: TEXT_ALIGN_VALUES.map((v) => ({
      value: v,
      ariaLabel: `text-align: ${v}`,
      title: v.charAt(0).toUpperCase() + v.slice(1),
      icon: createTextAlignIcon(v),
    })),
    onChange: (value) => {
      const handle = beginTransaction('text-align');
      if (handle) handle.set(value);
      commitTransaction('text-align');
      syncAllFields();
    },
  });
  disposer.add(() => textAlignGroup.dispose());

  const verticalAlignGroup = createIconButtonGroup<VerticalAlignValue>({
    container: verticalAlignMount,
    ariaLabel: 'Vertical Align',
    columns: 4,
    items: VERTICAL_ALIGN_VALUES.map((v) => ({
      value: v,
      ariaLabel: `vertical-align: ${v}`,
      title: v.charAt(0).toUpperCase() + v.slice(1),
      icon: createVerticalAlignIcon(v),
    })),
    onChange: (value) => {
      const handle = beginTransaction('vertical-align');
      if (handle) handle.set(value);
      commitTransaction('vertical-align');
      syncAllFields();
    },
  });
  disposer.add(() => verticalAlignGroup.dispose());

  // -------------------------------------------------------------------------
  // Create ColorField instance for text color
  // (TokenPill and TokenPicker are built into ColorField when tokensService is provided)
  // -------------------------------------------------------------------------
  const textColorField = createColorField({
    container: colorFieldContainer,
    ariaLabel: 'Text Color',
    tokensService,
    getTokenTarget: () => currentTarget,
    onInput: (value) => {
      const handle = beginTransaction('color');
      if (handle) handle.set(value);
    },
    onCommit: () => {
      commitTransaction('color');
      syncAllFields();
    },
    onCancel: () => {
      rollbackTransaction('color');
      syncField('color', true);
    },
  });
  disposer.add(() => textColorField.dispose());

  // -------------------------------------------------------------------------
  // Field state map
  // -------------------------------------------------------------------------
  const fields: Record<TypographyProperty, FieldState> = {
    'font-family': {
      kind: 'font-family',
      property: 'font-family',
      select: fontFamilySelect,
      custom: fontFamilyCustomContainer,
      controlsContainer: fontFamilyControls,
      handle: null,
    },
    'font-size': {
      kind: 'standard',
      property: 'font-size',
      element: fontSizeContainer.input,
      container: fontSizeContainer,
      handle: null,
    },
    'font-weight': {
      kind: 'standard',
      property: 'font-weight',
      element: fontWeightSelect,
      handle: null,
    },
    'line-height': {
      kind: 'standard',
      property: 'line-height',
      element: lineHeightContainer.input,
      container: lineHeightContainer,
      handle: null,
    },
    'letter-spacing': {
      kind: 'standard',
      property: 'letter-spacing',
      element: letterSpacingContainer.input,
      container: letterSpacingContainer,
      handle: null,
    },
    'text-align': {
      kind: 'text-align',
      property: 'text-align',
      group: textAlignGroup,
      handle: null,
    },
    'vertical-align': {
      kind: 'vertical-align',
      property: 'vertical-align',
      group: verticalAlignGroup,
      handle: null,
    },
    color: { kind: 'color', property: 'color', field: textColorField, handle: null },
  };

  const PROPS: readonly TypographyProperty[] = [
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-align',
    'vertical-align',
    'color',
  ];

  function beginTransaction(property: TypographyProperty): StyleTransactionHandle | null {
    if (disposer.isDisposed) return null;
    const target = currentTarget;
    if (!target || !target.isConnected) return null;
    const field = fields[property];
    if (field.handle) return field.handle;
    const handle = transactionManager.beginStyle(target, property);
    field.handle = handle;
    return handle;
  }

  function commitTransaction(property: TypographyProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.commit({ merge: true });
  }

  function rollbackTransaction(property: TypographyProperty): void {
    const field = fields[property];
    const handle = field.handle;
    field.handle = null;
    if (handle) handle.rollback();
  }

  function commitAllTransactions(): void {
    for (const p of PROPS) commitTransaction(p);
  }

  function syncField(property: TypographyProperty, force = false): void {
    const field = fields[property];
    const target = currentTarget;

    // Handle font-family field (preset select + custom input)
    if (field.kind === 'font-family') {
      const presetValues = FONT_FAMILY_PRESET_VALUES as readonly string[];

      if (!target || !target.isConnected) {
        field.select.disabled = true;
        field.select.value = presetValues[0] ?? 'inherit';
        field.custom.input.disabled = true;
        field.custom.input.value = '';
        field.custom.root.style.display = 'none';
        return;
      }

      field.select.disabled = false;

      const isEditing =
        field.handle !== null || isFieldFocused(field.select) || isFieldFocused(field.custom.input);
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const displayValue = inlineValue || readComputedValue(target, property);
      const normalized = displayValue.trim().toLowerCase();

      if (presetValues.includes(normalized)) {
        field.select.value = normalized;
        field.custom.root.style.display = 'none';
        field.custom.input.disabled = true;
      } else {
        field.select.value = FONT_FAMILY_CUSTOM_VALUE;
        field.custom.root.style.display = '';
        field.custom.input.disabled = false;
        field.custom.input.value = displayValue;
      }
      return;
    }

    // Handle text-align (icon button group)
    if (field.kind === 'text-align') {
      const group = field.group;

      if (!target || !target.isConnected) {
        group.setDisabled(true);
        group.setValue(null);
        return;
      }

      group.setDisabled(false);
      const isEditing = field.handle !== null;
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const computedValue = readComputedValue(target, property);
      const raw = (inlineValue || computedValue).trim();
      group.setValue(isTextAlignValue(raw) ? raw : 'left');
      return;
    }

    // Handle vertical-align (icon button group)
    if (field.kind === 'vertical-align') {
      const group = field.group;

      if (!target || !target.isConnected) {
        group.setDisabled(true);
        group.setValue(null);
        return;
      }

      group.setDisabled(false);
      const isEditing = field.handle !== null;
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const computedValue = readComputedValue(target, property);
      const raw = (inlineValue || computedValue).trim();
      // Default to baseline if value is not in our common values
      group.setValue(isVerticalAlignValue(raw) ? raw : 'baseline');
      return;
    }

    if (field.kind === 'color') {
      // Handle ColorField
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

      // Display real value: prefer inline style, fallback to computed style
      const inlineValue = readInlineValue(target, property);
      const computedValue = readComputedValue(target, property);
      if (inlineValue) {
        colorField.setValue(inlineValue);
        // Pass computed value as placeholder when using CSS variables
        // so color-field can resolve the actual color for swatch display
        colorField.setPlaceholder(/\bvar\s*\(/i.test(inlineValue) ? computedValue : '');
      } else {
        colorField.setValue(computedValue);
        colorField.setPlaceholder('');
      }
      return;
    }

    // Handle standard input/select (remaining fields)
    const el = field.element;

    if (!target || !target.isConnected) {
      el.disabled = true;
      if (el instanceof HTMLInputElement) {
        el.value = '';
        el.placeholder = '';
        // Reset suffix to defaults
        if (field.container) {
          if (property === 'font-size' || property === 'letter-spacing') {
            field.container.setSuffix('px');
          } else if (property === 'line-height') {
            field.container.setSuffix(null);
          }
        }
      }
      return;
    }

    el.disabled = false;
    const isEditing = field.handle !== null || isFieldFocused(el);

    if (el instanceof HTMLInputElement) {
      if (isEditing && !force) return;

      const inlineValue = readInlineValue(target, property);
      const displayValue = inlineValue || readComputedValue(target, property);

      // Update value and suffix dynamically
      if (field.container) {
        if (property === 'font-size' || property === 'letter-spacing') {
          const formatted = formatLengthForDisplay(displayValue);
          el.value = formatted.value;
          field.container.setSuffix(formatted.suffix);
        } else if (property === 'line-height') {
          // Line-height: only show suffix if value has explicit unit
          if (hasExplicitUnit(displayValue)) {
            const formatted = formatLengthForDisplay(displayValue);
            el.value = formatted.value;
            field.container.setSuffix(formatted.suffix);
          } else {
            el.value = displayValue;
            field.container.setSuffix(null);
          }
        } else {
          el.value = displayValue;
        }
      } else {
        el.value = displayValue;
      }
      el.placeholder = '';
    } else {
      const inline = readInlineValue(target, property);
      const computed = readComputedValue(target, property);
      if (isEditing && !force) return;
      const val = inline || computed;
      const hasOption = Array.from(el.options).some((o) => o.value === val);
      el.value = hasOption ? val : (el.options[0]?.value ?? '');
    }
  }

  function syncAllFields(): void {
    for (const p of PROPS) syncField(p);
  }

  function wireSelect(property: TypographyProperty): void {
    const field = fields[property];
    if (field.kind !== 'standard') return;

    const select = field.element as HTMLSelectElement;

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

  function wireInput(
    property: TypographyProperty,
    normalize: (v: string, suffix: string | null) => string = (v) => v.trim(),
  ): void {
    const field = fields[property];
    if (field.kind !== 'standard') return;

    const input = field.element as HTMLInputElement;

    disposer.listen(input, 'input', () => {
      const handle = beginTransaction(property);
      if (!handle) return;
      // Get current suffix from container to preserve unit
      const suffix = field.container?.getSuffixText() ?? null;
      handle.set(normalize(input.value, suffix));
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

  // ---------------------------------------------------------------------------
  // Wire font-family (preset select + custom input)
  // ---------------------------------------------------------------------------
  function wireFontFamily(): void {
    const field = fields['font-family'];
    if (field.kind !== 'font-family') return;

    const { select, custom, controlsContainer } = field;

    const updateCustomVisibility = () => {
      const isCustom = select.value === FONT_FAMILY_CUSTOM_VALUE;
      custom.root.style.display = isCustom ? '' : 'none';
      custom.input.disabled = !isCustom;
      if (isCustom) custom.input.focus();
    };

    const previewSelect = () => {
      updateCustomVisibility();
      if (select.value === FONT_FAMILY_CUSTOM_VALUE) return;
      const handle = beginTransaction('font-family');
      if (handle) handle.set(select.value);
    };

    disposer.listen(select, 'input', previewSelect);
    disposer.listen(select, 'change', previewSelect);

    disposer.listen(custom.input, 'input', () => {
      const handle = beginTransaction('font-family');
      if (handle) handle.set(custom.input.value.trim());
    });

    // Commit when focus leaves the whole font-family control
    disposer.listen(controlsContainer, 'focusout', (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && controlsContainer.contains(next)) return;
      commitTransaction('font-family');
      syncAllFields();
    });

    disposer.listen(select, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction('font-family');
        syncAllFields();
        select.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction('font-family');
        syncField('font-family', true);
      }
    });

    disposer.listen(custom.input, 'keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitTransaction('font-family');
        syncAllFields();
        custom.input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        rollbackTransaction('font-family');
        syncField('font-family', true);
      }
    });
  }

  // Wire standard inputs/selects (color field is wired via its own callbacks)
  // Note: text-align and vertical-align are now handled by IconButtonGroup with onChange callbacks
  wireFontFamily();
  wireInput('font-size', combineLengthValue);
  wireSelect('font-weight');
  // line-height is special: can be unitless (like 1.5) or with unit (like 24px)
  wireInput('line-height', (v, suffix) => {
    const trimmed = v.trim();
    if (!trimmed) return '';
    // If user typed a unit explicitly (like "24px"), use as-is
    if (/[a-zA-Z%]/.test(trimmed)) return trimmed;
    // For pure numbers, append suffix if exists, otherwise keep unitless
    return suffix ? `${trimmed}${suffix}` : trimmed;
  });
  wireInput('letter-spacing', combineLengthValue);

  function setTarget(element: Element | null): void {
    if (disposer.isDisposed) return;
    if (element !== currentTarget) commitAllTransactions();
    currentTarget = element;
    syncAllFields();
    // Token picker target is now managed by ColorField internally via getTokenTarget callback
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
