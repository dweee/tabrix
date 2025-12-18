/**
 * Event Controller
 *
 * Capture-phase event interceptor for Web Editor V2.
 *
 * Responsibilities:
 * - Intercept document-level pointer/mouse/keyboard events in capture phase
 * - Allow editor UI events (Shadow DOM) to pass through unmodified
 * - Block page interactions while editor is active
 * - Provide hover/selecting mode state machine
 * - Trigger callbacks for element hover, selection, and deselection
 *
 * Performance considerations:
 * - Uses rAF throttling for hover updates (elementFromPoint is expensive)
 * - Supports both PointerEvents (modern) and MouseEvents (fallback)
 * - Events are blocked via stopImmediatePropagation for complete isolation
 */

import { Disposer } from '../utils/disposables';

// =============================================================================
// Types
// =============================================================================

/** Mode of the event controller state machine */
export type EventControllerMode = 'hover' | 'selecting';

/** Keyboard modifiers state */
export interface EventModifiers {
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

/** Options for creating the event controller */
export interface EventControllerOptions {
  /** Check if a DOM node belongs to the editor overlay */
  isOverlayElement: (node: unknown) => boolean;
  /** Called when hovering over an element (null when hovering over nothing) */
  onHover: (element: Element | null) => void;
  /** Called when an element is selected via click */
  onSelect: (element: Element, modifiers: EventModifiers) => void;
  /** Called when selection is cancelled (ESC key or mode change) */
  onDeselect: () => void;
  /**
   * Optional custom target finder for selection (click).
   * If not provided, uses simple elementFromPoint.
   * Only used for selection, not hover (for performance).
   */
  findTargetForSelect?: (x: number, y: number, modifiers: EventModifiers) => Element | null;
}

/** Event controller public interface */
export interface EventController {
  /** Get current interaction mode */
  getMode(): EventControllerMode;
  /** Set interaction mode programmatically */
  setMode(mode: EventControllerMode): void;
  /** Cleanup all event listeners */
  dispose(): void;
}

// =============================================================================
// Constants
// =============================================================================

/** Common capture-phase listener options */
const CAPTURE_OPTIONS: AddEventListenerOptions = {
  capture: true,
  passive: false,
};

/** Events to completely block on document (page interaction prevention) */
const BLOCKED_POINTER_EVENTS = [
  'pointerup',
  'pointercancel',
  'pointerover',
  'pointerout',
  'pointerenter',
  'pointerleave',
] as const;

const BLOCKED_MOUSE_EVENTS = [
  'mouseup',
  'click',
  'dblclick',
  'contextmenu',
  'auxclick',
  'mouseover',
  'mouseout',
  'mouseenter',
  'mouseleave',
] as const;

const BLOCKED_KEYBOARD_EVENTS = ['keyup', 'keypress'] as const;

const BLOCKED_TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create an event controller for managing editor interactions.
 *
 * The controller operates in two modes:
 * - `hover`: Mouse movement triggers onHover callbacks, click transitions to selecting
 * - `selecting`: An element is selected, ESC key returns to hover mode
 */
export function createEventController(options: EventControllerOptions): EventController {
  const { isOverlayElement, onHover, onSelect, onDeselect, findTargetForSelect } = options;
  const disposer = new Disposer();

  // Feature detection for PointerEvents
  const hasPointerEvents = typeof PointerEvent !== 'undefined';

  // ==========================================================================
  // State
  // ==========================================================================

  let mode: EventControllerMode = 'hover';
  let lastHoveredElement: Element | null = null;

  // Pointer position tracking for rAF-throttled hover updates
  let hasPointerPosition = false;
  let lastClientX = 0;
  let lastClientY = 0;

  // Single rAF management (avoids Disposer array growth)
  let hoverRafId: number | null = null;

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Check if an event originated from the editor UI (Shadow DOM safe)
   */
  function isEventFromEditorUi(event: Event): boolean {
    try {
      if (typeof event.composedPath === 'function') {
        return event.composedPath().some((node) => isOverlayElement(node));
      }
    } catch {
      // Fallback to target check
    }
    return isOverlayElement(event.target);
  }

  /**
   * Block an event from reaching the page
   */
  function blockPageEvent(event: Event): void {
    if (event.cancelable) {
      event.preventDefault();
    }
    event.stopImmediatePropagation();
    event.stopPropagation();
  }

  /** Default modifiers (all false) */
  const defaultModifiers: EventModifiers = {
    alt: false,
    shift: false,
    ctrl: false,
    meta: false,
  };

  /**
   * Extract modifiers from an event
   */
  function extractModifiers(event: MouseEvent | KeyboardEvent): EventModifiers {
    return {
      alt: event.altKey,
      shift: event.shiftKey,
      ctrl: event.ctrlKey,
      meta: event.metaKey,
    };
  }

  /**
   * Get the topmost element at a viewport coordinate (fast, for hover).
   * Uses simple elementFromPoint to maintain 60FPS hover performance.
   */
  function getTargetElementAtFast(clientX: number, clientY: number): Element | null {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    const element = document.elementFromPoint(clientX, clientY);
    if (!element) return null;

    // Skip if element is part of the editor overlay
    if (isOverlayElement(element)) return null;

    return element;
  }

  /**
   * Get the best target element for selection (can be slower, uses intelligent picking).
   * Uses custom findTargetForSelect if provided, otherwise falls back to fast method.
   */
  function getTargetElementForSelection(
    clientX: number,
    clientY: number,
    modifiers: EventModifiers,
  ): Element | null {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    // Use intelligent target finder if provided (e.g., SelectionEngine)
    if (findTargetForSelect) {
      const target = findTargetForSelect(clientX, clientY, modifiers);
      // Defensive check: ensure result is not an overlay element
      if (target && isOverlayElement(target)) return null;
      return target;
    }

    // Fallback: simple elementFromPoint
    return getTargetElementAtFast(clientX, clientY);
  }

  // ==========================================================================
  // Hover Logic (rAF throttled)
  // ==========================================================================

  /**
   * Cancel any pending hover rAF
   */
  function cancelHoverRaf(): void {
    if (hoverRafId !== null) {
      cancelAnimationFrame(hoverRafId);
      hoverRafId = null;
    }
  }
  // Register cleanup for disposal
  disposer.add(cancelHoverRaf);

  /**
   * Commit the hover update by finding element at current pointer position
   */
  function commitHoverUpdate(forceUpdate = false): void {
    hoverRafId = null;

    if (disposer.isDisposed) return;
    if (mode !== 'hover') return;
    if (!hasPointerPosition) return;

    // Use fast method for hover (60FPS performance)
    const nextElement = getTargetElementAtFast(lastClientX, lastClientY);

    // Skip if same element (pointer identity check), unless forced
    if (!forceUpdate && nextElement === lastHoveredElement) return;

    lastHoveredElement = nextElement;
    onHover(nextElement);
  }

  /**
   * Schedule a hover update on the next animation frame
   */
  function scheduleHoverUpdate(forceUpdate = false): void {
    // If already pending, don't schedule another
    if (hoverRafId !== null) return;
    if (disposer.isDisposed) return;

    // Use rAF to throttle elementFromPoint calls to once per frame
    // This prevents performance degradation from high-frequency pointer events
    hoverRafId = requestAnimationFrame(() => {
      commitHoverUpdate(forceUpdate);
    });
  }

  // ==========================================================================
  // Mode Management
  // ==========================================================================

  /**
   * Set the interaction mode
   */
  function setMode(nextMode: EventControllerMode): void {
    if (disposer.isDisposed) return;
    if (mode === nextMode) return;

    const prevMode = mode;
    mode = nextMode;

    // Handle transitions
    if (prevMode === 'hover' && nextMode === 'selecting') {
      // Entering selection mode - cancel pending hover, reset tracked element
      cancelHoverRaf();
      lastHoveredElement = null;
    } else if (prevMode === 'selecting' && nextMode === 'hover') {
      // Exiting selection - notify and force resume hover tracking
      // Reset lastHoveredElement to force onHover callback even if pointer is on same element
      lastHoveredElement = null;
      onDeselect();
      if (hasPointerPosition) {
        // Force update to re-highlight element under pointer
        scheduleHoverUpdate(true);
      }
    }
  }

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  /**
   * Handle pointer/mouse move for hover tracking
   */
  function handlePointerMove(event: PointerEvent | MouseEvent): void {
    // If event is from editor UI, clear hover highlight and return
    if (isEventFromEditorUi(event)) {
      if (mode === 'hover' && lastHoveredElement !== null) {
        lastHoveredElement = null;
        onHover(null);
      }
      return;
    }
    blockPageEvent(event);

    // Update tracked position
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    hasPointerPosition = true;

    // Only process hover in hover mode
    if (mode !== 'hover') return;
    scheduleHoverUpdate();
  }

  /**
   * Handle pointer/mouse down for element selection
   */
  function handlePointerDown(event: PointerEvent | MouseEvent): void {
    if (isEventFromEditorUi(event)) return;
    blockPageEvent(event);

    // Update tracked position
    lastClientX = event.clientX;
    lastClientY = event.clientY;
    hasPointerPosition = true;

    // Only process in hover mode, left-click only
    if (mode !== 'hover') return;
    if (event.button !== 0) return;

    // Extract modifiers for intelligent selection (e.g., Alt for drill-up)
    const modifiers = extractModifiers(event);
    // Use intelligent selection for click (can afford more computation)
    const target = getTargetElementForSelection(event.clientX, event.clientY, modifiers);
    if (!target) return;

    // Transition to selecting mode
    setMode('selecting');
    onSelect(target, modifiers);
  }

  /**
   * Handle keydown for ESC cancellation
   */
  function handleKeyDown(event: KeyboardEvent): void {
    if (isEventFromEditorUi(event)) return;
    blockPageEvent(event);

    // ESC key cancels selection
    if (event.key === 'Escape' && mode === 'selecting') {
      setMode('hover');
    }
  }

  /**
   * Generic blocker for events that should never reach the page
   */
  function handleBlockedEvent(event: Event): void {
    if (isEventFromEditorUi(event)) return;
    blockPageEvent(event);
  }

  // ==========================================================================
  // Event Registration
  // ==========================================================================

  // Register pointer events (modern browsers)
  if (hasPointerEvents) {
    disposer.listen(document, 'pointermove', handlePointerMove, CAPTURE_OPTIONS);
    disposer.listen(document, 'pointerdown', handlePointerDown, CAPTURE_OPTIONS);

    for (const eventType of BLOCKED_POINTER_EVENTS) {
      disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
    }
  }

  // Register mouse events (fallback for older browsers, or when pointer events are unavailable)
  // Note: On modern browsers with PointerEvents, mouse events still fire after pointer events,
  // so we always register them to ensure complete blocking
  disposer.listen(document, 'mousemove', handlePointerMove, CAPTURE_OPTIONS);
  disposer.listen(document, 'mousedown', handlePointerDown, CAPTURE_OPTIONS);

  for (const eventType of BLOCKED_MOUSE_EVENTS) {
    disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
  }

  // Register keyboard events
  disposer.listen(document, 'keydown', handleKeyDown, CAPTURE_OPTIONS);

  for (const eventType of BLOCKED_KEYBOARD_EVENTS) {
    disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
  }

  // Register touch events (prevent touch interactions on mobile)
  for (const eventType of BLOCKED_TOUCH_EVENTS) {
    disposer.listen(document, eventType, handleBlockedEvent, CAPTURE_OPTIONS);
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  return {
    getMode: () => mode,
    setMode,
    dispose: () => disposer.dispose(),
  };
}
