/**
 * Toolbar UI (Phase 1.10)
 *
 * Shadow DOM toolbar with Apply / Undo / Redo / Close buttons.
 * Displays transaction counts and operation status.
 *
 * Design:
 * - Fixed position at top of viewport
 * - Uses CSS classes defined in shadow-host.ts
 * - Disposer pattern for cleanup
 */

import { Disposer } from '../utils/disposables';

// =============================================================================
// Types
// =============================================================================

/** Toolbar position */
export type ToolbarDock = 'top' | 'bottom';

/** Operation status */
export type ToolbarStatus = 'idle' | 'applying' | 'success' | 'error';

/** Result from apply operation */
export interface ApplyResult {
  requestId?: string;
}

/** Toolbar creation options */
export interface ToolbarOptions {
  /** Container element in Shadow DOM */
  container: HTMLElement;
  /** Position (default: top) */
  dock?: ToolbarDock;
  /** Called when Apply button is clicked */
  onApply?: () => void | ApplyResult | Promise<void | ApplyResult>;
  /** Called when Undo button is clicked */
  onUndo?: () => void;
  /** Called when Redo button is clicked */
  onRedo?: () => void;
  /** Called when Close button is clicked */
  onRequestClose?: () => void;
}

/** Toolbar public interface */
export interface Toolbar {
  /** Update undo/redo counts */
  setHistory(undoCount: number, redoCount: number): void;
  /** Update status display */
  setStatus(status: ToolbarStatus, message?: string): void;
  /** Cleanup */
  dispose(): void;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Check if value is Promise-like
 */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

/**
 * Check if value is ApplyResult
 */
function isApplyResult(value: unknown): value is ApplyResult {
  if (!value || typeof value !== 'object') return false;
  const req = (value as { requestId?: unknown }).requestId;
  return req === undefined || typeof req === 'string';
}

/**
 * Format status message with optional request ID
 */
function formatStatusMessage(base: string, result?: ApplyResult): string {
  const req = result?.requestId ? `requestId=${result.requestId}` : '';
  return req ? `${base} (${req})` : base;
}

// =============================================================================
// Status Reset Timer
// =============================================================================

const STATUS_RESET_DELAY_MS = 2400;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a Toolbar UI component
 */
export function createToolbar(options: ToolbarOptions): Toolbar {
  const disposer = new Disposer();
  const dock = options.dock ?? 'top';

  // State
  let undoCount = 0;
  let redoCount = 0;
  let status: ToolbarStatus = 'idle';
  let statusMessage = '';
  let applying = false;
  let resetTimer: number | null = null;

  // ==========================================================================
  // DOM Structure
  // ==========================================================================

  // Root container
  const root = document.createElement('div');
  root.className = 'we-toolbar';
  root.dataset.position = dock;
  root.dataset.status = status;
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', 'Web Editor Toolbar');

  // Left section: title
  const left = document.createElement('div');
  left.className = 'we-toolbar-left';

  const title = document.createElement('div');
  title.className = 'we-title';
  const titleText = document.createElement('span');
  titleText.textContent = 'Web Editor';
  const badge = document.createElement('span');
  badge.className = 'we-badge';
  badge.textContent = 'V2';
  title.append(titleText, badge);
  left.append(title);

  // Center section: counts and status
  const center = document.createElement('div');
  center.className = 'we-toolbar-center';

  const meta = document.createElement('div');
  meta.className = 'we-toolbar-meta';

  const countsEl = document.createElement('span');
  countsEl.className = 'we-toolbar-counts';

  const statusEl = document.createElement('span');
  statusEl.className = 'we-toolbar-status';
  statusEl.setAttribute('aria-live', 'polite');

  meta.append(countsEl, statusEl);
  center.append(meta);

  // Right section: buttons
  const right = document.createElement('div');
  right.className = 'we-toolbar-right';

  const applyBtn = document.createElement('button');
  applyBtn.type = 'button';
  applyBtn.className = 'we-btn we-btn--primary';
  applyBtn.textContent = 'Apply';
  applyBtn.setAttribute('aria-label', 'Apply changes to code');

  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'we-btn';
  undoBtn.textContent = 'Undo';
  undoBtn.setAttribute('aria-label', 'Undo last change');

  const redoBtn = document.createElement('button');
  redoBtn.type = 'button';
  redoBtn.className = 'we-btn';
  redoBtn.textContent = 'Redo';
  redoBtn.setAttribute('aria-label', 'Redo last undone change');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'we-btn we-btn--danger';
  closeBtn.textContent = 'Close';
  closeBtn.setAttribute('aria-label', 'Close Web Editor');

  right.append(applyBtn, undoBtn, redoBtn, closeBtn);

  // Assemble
  root.append(left, center, right);
  options.container.append(root);
  disposer.add(() => root.remove());

  // ==========================================================================
  // Timer Management
  // ==========================================================================

  function clearResetTimer(): void {
    if (resetTimer !== null) {
      window.clearTimeout(resetTimer);
      resetTimer = null;
    }
  }
  disposer.add(clearResetTimer);

  // ==========================================================================
  // Render Functions
  // ==========================================================================

  function renderCounts(): void {
    countsEl.textContent = `Undo: ${undoCount} · Redo: ${redoCount}`;
  }

  function renderButtons(): void {
    undoBtn.disabled = applying || undoCount <= 0;
    redoBtn.disabled = applying || redoCount <= 0;
    applyBtn.disabled = applying || undoCount <= 0 || !options.onApply;
    applyBtn.textContent = applying ? 'Applying…' : 'Apply';
  }

  function renderStatus(): void {
    root.dataset.status = status;
    statusEl.textContent = status === 'idle' ? '' : statusMessage;
  }

  function scheduleStatusReset(): void {
    clearResetTimer();
    resetTimer = window.setTimeout(() => setStatus('idle'), STATUS_RESET_DELAY_MS);
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  function setHistory(nextUndo: number, nextRedo: number): void {
    undoCount = Math.max(0, Math.floor(nextUndo));
    redoCount = Math.max(0, Math.floor(nextRedo));
    renderCounts();
    renderButtons();
  }

  function setStatus(nextStatus: ToolbarStatus, message?: string): void {
    status = nextStatus;
    statusMessage = (message ?? '').trim();
    renderStatus();

    if (status === 'success' || status === 'error') {
      scheduleStatusReset();
    } else {
      clearResetTimer();
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  async function handleApply(): Promise<void> {
    if (applyBtn.disabled) return;
    if (!options.onApply) return;

    applying = true;
    renderButtons();
    setStatus('applying', 'Sending…');

    try {
      const resultOrPromise = options.onApply();
      const result = isPromiseLike(resultOrPromise) ? await resultOrPromise : resultOrPromise;
      const applyResult = isApplyResult(result) ? result : undefined;
      setStatus('success', formatStatusMessage('Sent', applyResult));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setStatus('error', msg || 'Failed');
    } finally {
      applying = false;
      renderButtons();
    }
  }

  // Apply button
  disposer.listen(applyBtn, 'click', (event) => {
    event.preventDefault();
    void handleApply();
  });

  // Undo button
  disposer.listen(undoBtn, 'click', (event) => {
    event.preventDefault();
    if (undoBtn.disabled) return;
    options.onUndo?.();
  });

  // Redo button
  disposer.listen(redoBtn, 'click', (event) => {
    event.preventDefault();
    if (redoBtn.disabled) return;
    options.onRedo?.();
  });

  // Close button
  disposer.listen(closeBtn, 'click', (event) => {
    event.preventDefault();
    options.onRequestClose?.();
  });

  // Initial render
  renderCounts();
  renderButtons();
  renderStatus();

  // ==========================================================================
  // Return API
  // ==========================================================================

  return {
    setHistory,
    setStatus,
    dispose: () => disposer.dispose(),
  };
}
