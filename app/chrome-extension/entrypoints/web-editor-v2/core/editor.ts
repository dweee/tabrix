/**
 * Web Editor V2 Core
 *
 * Main orchestrator for the visual editor.
 * Manages lifecycle of all subsystems (Shadow Host, Canvas, Interaction Engine, etc.)
 */

import type { WebEditorState, WebEditorV2Api } from '@/common/web-editor-types';
import { WEB_EDITOR_V2_VERSION, WEB_EDITOR_V2_LOG_PREFIX } from '../constants';
import { mountShadowHost, type ShadowHostManager } from '../ui/shadow-host';
import { createToolbar, type Toolbar } from '../ui/toolbar';
import { createCanvasOverlay, type CanvasOverlay } from '../overlay/canvas-overlay';
import {
  createEventController,
  type EventController,
  type EventModifiers,
} from './event-controller';
import { createPositionTracker, type PositionTracker, type TrackedRects } from './position-tracker';
import { createSelectionEngine, type SelectionEngine } from '../selection/selection-engine';
import {
  createTransactionManager,
  type TransactionManager,
  type TransactionChangeEvent,
} from './transaction-manager';
import { sendTransactionToAgent } from './payload-builder';

// =============================================================================
// Types
// =============================================================================

/** Internal editor state */
interface EditorInternalState {
  active: boolean;
  shadowHost: ShadowHostManager | null;
  canvasOverlay: CanvasOverlay | null;
  eventController: EventController | null;
  positionTracker: PositionTracker | null;
  selectionEngine: SelectionEngine | null;
  transactionManager: TransactionManager | null;
  toolbar: Toolbar | null;
  /** Currently hovered element (for hover highlight) */
  hoveredElement: Element | null;
  /** Currently selected element (for selection highlight) */
  selectedElement: Element | null;
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create the Web Editor V2 instance.
 *
 * This is the main factory function that creates the editor API.
 * The returned object implements WebEditorV2Api and is exposed on window.__MCP_WEB_EDITOR_V2__
 */
export function createWebEditorV2(): WebEditorV2Api {
  const state: EditorInternalState = {
    active: false,
    shadowHost: null,
    canvasOverlay: null,
    eventController: null,
    positionTracker: null,
    selectionEngine: null,
    transactionManager: null,
    toolbar: null,
    hoveredElement: null,
    selectedElement: null,
  };

  // ===========================================================================
  // Event Handlers (wired to EventController callbacks)
  // ===========================================================================

  /**
   * Handle hover state changes from EventController
   */
  function handleHover(element: Element | null): void {
    state.hoveredElement = element;

    // Delegate position tracking to PositionTracker
    // Use forceUpdate to avoid extra rAF frame delay
    if (state.positionTracker) {
      state.positionTracker.setHoverElement(element);
      state.positionTracker.forceUpdate();
    }
  }

  /**
   * Handle element selection from EventController
   */
  function handleSelect(element: Element, modifiers: EventModifiers): void {
    state.selectedElement = element;
    state.hoveredElement = null;

    // Delegate position tracking to PositionTracker
    // Clear hover, set selection, then force immediate update
    if (state.positionTracker) {
      state.positionTracker.setHoverElement(null);
      state.positionTracker.setSelectionElement(element);
      state.positionTracker.forceUpdate();
    }

    // Log selection with modifier info for debugging
    const modInfo = modifiers.alt ? ' (Alt: drill-up)' : '';
    console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Selected${modInfo}:`, element.tagName, element);
  }

  /**
   * Handle deselection (ESC key) from EventController
   */
  function handleDeselect(): void {
    state.selectedElement = null;

    // Clear selection tracking and force immediate update
    if (state.positionTracker) {
      state.positionTracker.setSelectionElement(null);
      state.positionTracker.forceUpdate();
    }

    console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Deselected`);
  }

  /**
   * Handle position updates from PositionTracker (scroll/resize sync)
   */
  function handlePositionUpdate(rects: TrackedRects): void {
    if (!state.canvasOverlay) return;

    // Update canvas overlay with new positions
    state.canvasOverlay.setHoverRect(rects.hover);
    state.canvasOverlay.setSelectionRect(rects.selection);

    // Force immediate render to avoid extra rAF delay
    // This collapses the render to the same frame as position calculation
    state.canvasOverlay.render();
  }

  /**
   * Handle transaction changes from TransactionManager
   */
  function handleTransactionChange(event: TransactionChangeEvent): void {
    // Log transaction events for debugging
    const { action, undoCount, redoCount } = event;
    console.log(
      `${WEB_EDITOR_V2_LOG_PREFIX} Transaction: ${action} (undo: ${undoCount}, redo: ${redoCount})`,
    );

    // Update toolbar UI with undo/redo counts
    state.toolbar?.setHistory(undoCount, redoCount);
  }

  /**
   * Apply the latest transaction to Agent (Apply to Code)
   */
  async function applyLatestTransaction(): Promise<{ requestId?: string }> {
    const tm = state.transactionManager;
    if (!tm) {
      throw new Error('Transaction manager not ready');
    }

    const undoStack = tm.getUndoStack();
    const tx = undoStack.length > 0 ? undoStack[undoStack.length - 1] : null;
    if (!tx) {
      throw new Error('No changes to apply');
    }

    const resp = await sendTransactionToAgent(tx);
    const r = resp as { success?: unknown; requestId?: unknown; error?: unknown } | null;

    if (r && r.success === true) {
      return { requestId: typeof r.requestId === 'string' ? r.requestId : undefined };
    }

    const err = typeof r?.error === 'string' ? r.error : 'Agent request failed';
    throw new Error(err);
  }

  /**
   * Handle transaction apply errors
   */
  function handleTransactionError(error: unknown): void {
    console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Transaction apply error:`, error);
  }

  /**
   * Start the editor
   */
  function start(): void {
    if (state.active) {
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Already active`);
      return;
    }

    try {
      // Mount Shadow DOM host
      state.shadowHost = mountShadowHost({
        onRequestClose: () => stop(),
      });

      // Initialize Canvas Overlay
      const elements = state.shadowHost.getElements();
      if (!elements?.overlayRoot) {
        throw new Error('Shadow host overlayRoot not available');
      }
      state.canvasOverlay = createCanvasOverlay({
        container: elements.overlayRoot,
      });

      // Initialize Selection Engine for intelligent element picking
      state.selectionEngine = createSelectionEngine({
        isOverlayElement: state.shadowHost.isOverlayElement,
      });

      // Initialize Event Controller for interaction handling
      // Wire up SelectionEngine's findBestTarget for intelligent selection (click only)
      // Hover uses fast elementFromPoint for 60FPS performance
      state.eventController = createEventController({
        isOverlayElement: state.shadowHost.isOverlayElement,
        onHover: handleHover,
        onSelect: handleSelect,
        onDeselect: handleDeselect,
        findTargetForSelect: (x, y, modifiers) =>
          state.selectionEngine?.findBestTarget(x, y, modifiers) ?? null,
      });

      // Initialize Position Tracker for scroll/resize synchronization
      state.positionTracker = createPositionTracker({
        onPositionUpdate: handlePositionUpdate,
      });

      // Initialize Transaction Manager for undo/redo support
      // Use isEventFromUi (not isOverlayElement) to properly check event source
      state.transactionManager = createTransactionManager({
        enableKeyBindings: true,
        isEventFromEditorUi: state.shadowHost.isEventFromUi,
        onChange: handleTransactionChange,
        onApplyError: handleTransactionError,
      });

      // Initialize Toolbar UI (must have uiRoot from shadow host)
      if (!elements.uiRoot) {
        throw new Error('Shadow host uiRoot not available');
      }
      state.toolbar = createToolbar({
        container: elements.uiRoot,
        dock: 'top',
        onApply: applyLatestTransaction,
        onUndo: () => state.transactionManager?.undo(),
        onRedo: () => state.transactionManager?.redo(),
        onRequestClose: () => stop(),
      });

      // Initialize toolbar history display
      state.toolbar.setHistory(
        state.transactionManager.getUndoStack().length,
        state.transactionManager.getRedoStack().length,
      );

      state.active = true;
      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Started`);
    } catch (error) {
      // Cleanup on failure (reverse order)
      state.toolbar?.dispose();
      state.toolbar = null;
      state.transactionManager?.dispose();
      state.transactionManager = null;
      state.positionTracker?.dispose();
      state.positionTracker = null;
      state.eventController?.dispose();
      state.eventController = null;
      state.selectionEngine?.dispose();
      state.selectionEngine = null;
      state.canvasOverlay?.dispose();
      state.canvasOverlay = null;
      state.shadowHost?.dispose();
      state.shadowHost = null;
      state.hoveredElement = null;
      state.selectedElement = null;
      state.active = false;

      console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Failed to start:`, error);
    }
  }

  /**
   * Stop the editor
   */
  function stop(): void {
    if (!state.active) {
      return;
    }

    state.active = false;

    try {
      // Cleanup in reverse order of initialization

      // Cleanup Toolbar UI
      state.toolbar?.dispose();
      state.toolbar = null;

      // Cleanup Transaction Manager (clears history)
      state.transactionManager?.dispose();
      state.transactionManager = null;

      // Cleanup Position Tracker (stops scroll/resize monitoring)
      state.positionTracker?.dispose();
      state.positionTracker = null;

      // Cleanup Event Controller (stops event interception)
      state.eventController?.dispose();
      state.eventController = null;

      // Cleanup Selection Engine
      state.selectionEngine?.dispose();
      state.selectionEngine = null;

      // Cleanup Canvas Overlay
      state.canvasOverlay?.dispose();
      state.canvasOverlay = null;

      // Cleanup Shadow DOM host
      state.shadowHost?.dispose();
      state.shadowHost = null;

      // Clear element references
      state.hoveredElement = null;
      state.selectedElement = null;

      console.log(`${WEB_EDITOR_V2_LOG_PREFIX} Stopped`);
    } catch (error) {
      console.error(`${WEB_EDITOR_V2_LOG_PREFIX} Error during cleanup:`, error);

      // Force cleanup
      state.toolbar = null;
      state.transactionManager = null;
      state.positionTracker = null;
      state.eventController = null;
      state.selectionEngine = null;
      state.canvasOverlay = null;
      state.shadowHost = null;
      state.hoveredElement = null;
      state.selectedElement = null;
    }
  }

  /**
   * Toggle the editor on/off
   */
  function toggle(): boolean {
    if (state.active) {
      stop();
    } else {
      start();
    }
    return state.active;
  }

  /**
   * Get current editor state
   */
  function getState(): WebEditorState {
    return {
      active: state.active,
      version: WEB_EDITOR_V2_VERSION,
    };
  }

  return {
    start,
    stop,
    toggle,
    getState,
  };
}
