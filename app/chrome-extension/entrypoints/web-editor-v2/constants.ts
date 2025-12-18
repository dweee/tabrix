/**
 * Web Editor V2 Constants
 *
 * Centralized configuration values for the visual editor.
 * All magic strings/numbers should be defined here.
 */

/** Editor version number */
export const WEB_EDITOR_V2_VERSION = 2 as const;

/** Log prefix for console messages */
export const WEB_EDITOR_V2_LOG_PREFIX = '[WebEditorV2]' as const;

// =============================================================================
// DOM Element IDs
// =============================================================================

/** Shadow host element ID */
export const WEB_EDITOR_V2_HOST_ID = '__mcp_web_editor_v2_host__';

/** Overlay container ID (for Canvas and visual feedback) */
export const WEB_EDITOR_V2_OVERLAY_ID = '__mcp_web_editor_v2_overlay__';

/** UI container ID (for panels and controls) */
export const WEB_EDITOR_V2_UI_ID = '__mcp_web_editor_v2_ui__';

// =============================================================================
// Styling
// =============================================================================

/** Maximum z-index to ensure editor is always on top */
export const WEB_EDITOR_V2_Z_INDEX = 2147483647;

/** Default panel width */
export const WEB_EDITOR_V2_PANEL_WIDTH = 320;

// =============================================================================
// Colors (Design System)
// =============================================================================

export const WEB_EDITOR_V2_COLORS = {
  /** Hover highlight color */
  hover: '#3b82f6', // blue-500
  /** Selected element color */
  selected: '#22c55e', // green-500
  /** Selection box border */
  selectionBorder: '#6366f1', // indigo-500
  /** Drag ghost color */
  dragGhost: 'rgba(99, 102, 241, 0.3)',
  /** Insertion line color */
  insertionLine: '#f59e0b', // amber-500
} as const;
