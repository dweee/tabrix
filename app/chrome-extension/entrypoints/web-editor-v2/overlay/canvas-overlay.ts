/**
 * Canvas Overlay
 *
 * High-performance overlay renderer for visual feedback (hover, selection, guides).
 *
 * Features:
 * - DPR-aware rendering for crisp visuals on HiDPI displays
 * - rAF-coalesced rendering via markDirty() pattern
 * - ResizeObserver-backed automatic sizing
 * - Separate layers for hover, selection, and future guides
 *
 * Performance considerations:
 * - Uses `desynchronized: true` for lower latency
 * - Batches all drawing to single rAF
 * - Only redraws when dirty flag is set
 * - Pixel-aligned strokes for crisp lines
 */

import { WEB_EDITOR_V2_COLORS, WEB_EDITOR_V2_LOG_PREFIX } from '../constants';
import { Disposer } from '../utils/disposables';

// =============================================================================
// Types
// =============================================================================

/** Rectangle in viewport coordinates */
export type ViewportRect = Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>;

/** Box style configuration */
export interface BoxStyle {
  /** Stroke color */
  strokeColor: string;
  /** Fill color (with alpha for transparency) */
  fillColor: string;
  /** Line width in CSS pixels */
  lineWidth: number;
  /** Dash pattern (empty array for solid line) */
  dashPattern: number[];
}

/** Canvas overlay interface */
export interface CanvasOverlay {
  /** The underlying canvas element */
  canvas: HTMLCanvasElement;
  /** Mark state as dirty and schedule a render on next animation frame */
  markDirty(): void;
  /** Render immediately if dirty (called by RAF engine) */
  render(): void;
  /** Clear all visual elements */
  clear(): void;
  /** Update hover highlight */
  setHoverRect(rect: ViewportRect | null): void;
  /** Update selection highlight */
  setSelectionRect(rect: ViewportRect | null): void;
  /** Dispose and cleanup */
  dispose(): void;
}

/** Options for creating canvas overlay */
export interface CanvasOverlayOptions {
  /** Container element (should be overlayRoot from ShadowHost) */
  container: HTMLElement;
}

// =============================================================================
// Constants
// =============================================================================

const CANVAS_ATTR = 'data-mcp-canvas';
const CANVAS_ATTR_VALUE = 'overlay';

/** Default styles for different box types */
const BOX_STYLES = {
  hover: {
    strokeColor: WEB_EDITOR_V2_COLORS.hover,
    fillColor: `${WEB_EDITOR_V2_COLORS.hover}15`, // 15 = ~8% opacity
    lineWidth: 2,
    dashPattern: [6, 4],
  },
  selection: {
    strokeColor: WEB_EDITOR_V2_COLORS.selected,
    fillColor: `${WEB_EDITOR_V2_COLORS.selected}20`, // 20 = ~12% opacity
    lineWidth: 2,
    dashPattern: [],
  },
} satisfies Record<string, BoxStyle>;

// =============================================================================
// Helpers
// =============================================================================

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isValidRect(rect: ViewportRect | null): rect is ViewportRect {
  if (!rect) return false;
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    isFinitePositive(rect.width) &&
    isFinitePositive(rect.height)
  );
}

// =============================================================================
// Implementation
// =============================================================================

/**
 * Create a canvas overlay for rendering visual feedback.
 */
export function createCanvasOverlay(options: CanvasOverlayOptions): CanvasOverlay {
  const { container } = options;
  const disposer = new Disposer();

  // Cleanup any existing canvas from previous instance
  const existing = container.querySelector<HTMLCanvasElement>(
    `canvas[${CANVAS_ATTR}="${CANVAS_ATTR_VALUE}"]`,
  );
  if (existing) {
    existing.remove();
  }

  // Create canvas element
  const canvas = document.createElement('canvas');
  canvas.setAttribute(CANVAS_ATTR, CANVAS_ATTR_VALUE);
  canvas.setAttribute('aria-hidden', 'true');

  // Style for fullscreen coverage
  Object.assign(canvas.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    display: 'block',
  });

  container.append(canvas);
  disposer.add(() => canvas.remove());

  // Get 2D context with performance options
  const ctx = canvas.getContext('2d', {
    alpha: true,
    desynchronized: true, // Lower latency on supported browsers
  });

  if (!ctx) {
    disposer.dispose();
    throw new Error(`${WEB_EDITOR_V2_LOG_PREFIX} Failed to get canvas 2D context`);
  }

  // ==========================================================================
  // State
  // ==========================================================================

  let hoverRect: ViewportRect | null = null;
  let selectionRect: ViewportRect | null = null;

  let viewportWidth = 1;
  let viewportHeight = 1;
  let devicePixelRatio = 1;

  let dirty = true;
  let rafId: number | null = null;

  // ==========================================================================
  // RAF Management
  // ==========================================================================

  function cancelRaf(): void {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
  disposer.add(cancelRaf);

  function scheduleRaf(): void {
    if (rafId !== null || disposer.isDisposed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      render();
    });
  }

  // ==========================================================================
  // Canvas Sizing (DPR-aware)
  // ==========================================================================

  function updateCanvasSize(): boolean {
    const nextDpr = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, viewportWidth);
    const cssHeight = Math.max(1, viewportHeight);

    const pixelWidth = Math.round(cssWidth * nextDpr);
    const pixelHeight = Math.round(cssHeight * nextDpr);

    const needsResize =
      canvas.width !== pixelWidth ||
      canvas.height !== pixelHeight ||
      Math.abs(devicePixelRatio - nextDpr) > 0.001;

    if (!needsResize) return false;

    devicePixelRatio = nextDpr;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;

    // Reset transform after resize (canvas state is cleared)
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    return true;
  }

  // ==========================================================================
  // Drawing Functions
  // ==========================================================================

  function clearCanvas(): void {
    updateCanvasSize();
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);
  }

  function drawBox(rect: ViewportRect | null, style: BoxStyle): void {
    if (!isValidRect(rect)) return;

    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w <= 0 || h <= 0) return;

    // Pixel-align for crisp strokes (add 0.5 for even line widths)
    const x = Math.round(rect.left) + 0.5;
    const y = Math.round(rect.top) + 0.5;

    ctx.save();

    // Configure stroke
    ctx.lineWidth = style.lineWidth;
    ctx.strokeStyle = style.strokeColor;
    ctx.fillStyle = style.fillColor;
    ctx.setLineDash(style.dashPattern);

    // Draw rectangle
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();

    ctx.restore();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  function markDirty(): void {
    if (disposer.isDisposed) return;
    dirty = true;
    scheduleRaf();
  }

  function render(): void {
    if (disposer.isDisposed || !dirty) return;

    // Cancel any pending RAF (in case render() is called manually)
    cancelRaf();

    // Reset dirty flag before drawing
    dirty = false;

    // Clear and redraw
    clearCanvas();
    drawBox(hoverRect, BOX_STYLES.hover);
    drawBox(selectionRect, BOX_STYLES.selection);

    // If something marked dirty during render, schedule another frame
    if (dirty) {
      scheduleRaf();
    }
  }

  function setHoverRect(rect: ViewportRect | null): void {
    hoverRect = rect;
    markDirty();
  }

  function setSelectionRect(rect: ViewportRect | null): void {
    selectionRect = rect;
    markDirty();
  }

  function clear(): void {
    hoverRect = null;
    selectionRect = null;
    markDirty();
  }

  // ==========================================================================
  // Initialization
  // ==========================================================================

  // Initial size measurement
  try {
    const rect = container.getBoundingClientRect();
    viewportWidth = Math.max(1, rect.width);
    viewportHeight = Math.max(1, rect.height);
  } catch (error) {
    console.warn(`${WEB_EDITOR_V2_LOG_PREFIX} Initial size measurement failed:`, error);
  }

  // Setup ResizeObserver for automatic sizing
  disposer.observeResize(container, (entries) => {
    const entry = entries[0];
    const rect = entry?.contentRect;
    if (!rect) return;

    const nextWidth = Math.max(1, rect.width);
    const nextHeight = Math.max(1, rect.height);

    // Skip if size hasn't changed significantly
    if (Math.abs(nextWidth - viewportWidth) < 0.5 && Math.abs(nextHeight - viewportHeight) < 0.5) {
      return;
    }

    viewportWidth = nextWidth;
    viewportHeight = nextHeight;
    markDirty();
  });

  // Initial render
  markDirty();

  return {
    canvas,
    markDirty,
    render,
    clear,
    setHoverRect,
    setSelectionRect,
    dispose: () => disposer.dispose(),
  };
}
