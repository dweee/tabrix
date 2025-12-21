/**
 * Web Editor V2 - Shared Type Definitions
 *
 * This module defines types shared between:
 * - Background script (injection control)
 * - Inject script (web-editor-v2.ts)
 * - Future: UI panels
 */

// =============================================================================
// Editor State
// =============================================================================

/** Current state of the web editor */
export interface WebEditorState {
  /** Whether the editor is currently active */
  active: boolean;
  /** Editor version for compatibility checks */
  version: 2;
}

// =============================================================================
// Message Protocol (Background <-> Inject Script)
// =============================================================================

/**
 * Action types for web editor V2 messages
 *
 * IMPORTANT: V2 uses versioned action names (suffix _v2) to avoid
 * conflicts with V1 when both scripts might be injected in the same tab.
 * This prevents double-response race conditions.
 *
 * V1 uses: web_editor_ping, web_editor_toggle, etc.
 * V2 uses: web_editor_ping_v2, web_editor_toggle_v2, etc.
 */
export const WEB_EDITOR_V2_ACTIONS = {
  /** Check if V2 editor is injected and get status */
  PING: 'web_editor_ping_v2',
  /** Toggle V2 editor on/off */
  TOGGLE: 'web_editor_toggle_v2',
  /** Start V2 editor */
  START: 'web_editor_start_v2',
  /** Stop V2 editor */
  STOP: 'web_editor_stop_v2',
} as const;

/**
 * Legacy V1 action types (for reference and background compatibility)
 * These are used when USE_WEB_EDITOR_V2 is false
 */
export const WEB_EDITOR_V1_ACTIONS = {
  PING: 'web_editor_ping',
  TOGGLE: 'web_editor_toggle',
  START: 'web_editor_start',
  STOP: 'web_editor_stop',
  APPLY: 'web_editor_apply',
} as const;

export type WebEditorV2Action = (typeof WEB_EDITOR_V2_ACTIONS)[keyof typeof WEB_EDITOR_V2_ACTIONS];
export type WebEditorV1Action = (typeof WEB_EDITOR_V1_ACTIONS)[keyof typeof WEB_EDITOR_V1_ACTIONS];

/** Editor version literal type */
export type WebEditorVersion = 1 | 2;

/** Ping request (V2) */
export interface WebEditorV2PingRequest {
  action: typeof WEB_EDITOR_V2_ACTIONS.PING;
}

/** Ping response (V2) */
export interface WebEditorV2PingResponse {
  status: 'pong';
  active: boolean;
  version: 2;
}

/** Toggle request (V2) */
export interface WebEditorV2ToggleRequest {
  action: typeof WEB_EDITOR_V2_ACTIONS.TOGGLE;
}

/** Toggle response (V2) */
export interface WebEditorV2ToggleResponse {
  active: boolean;
}

/** Start request (V2) */
export interface WebEditorV2StartRequest {
  action: typeof WEB_EDITOR_V2_ACTIONS.START;
}

/** Start response (V2) */
export interface WebEditorV2StartResponse {
  active: boolean;
}

/** Stop request (V2) */
export interface WebEditorV2StopRequest {
  action: typeof WEB_EDITOR_V2_ACTIONS.STOP;
}

/** Stop response (V2) */
export interface WebEditorV2StopResponse {
  active: boolean;
}

/** Union types for V2 type-safe message handling */
export type WebEditorV2Request =
  | WebEditorV2PingRequest
  | WebEditorV2ToggleRequest
  | WebEditorV2StartRequest
  | WebEditorV2StopRequest;

export type WebEditorV2Response =
  | WebEditorV2PingResponse
  | WebEditorV2ToggleResponse
  | WebEditorV2StartResponse
  | WebEditorV2StopResponse;

// =============================================================================
// Element Locator (Phase 1 - Basic Structure)
// =============================================================================

/**
 * Framework debug source information
 * Extracted from React Fiber or Vue component instance
 */
export interface DebugSource {
  /** Source file path */
  file: string;
  /** Line number (1-based) */
  line?: number;
  /** Column number (1-based) */
  column?: number;
  /** Component name (if available) */
  componentName?: string;
}

/**
 * Element Locator - Primary key for element identification
 *
 * Uses multiple strategies to locate elements, supporting:
 * - HMR/DOM changes recovery
 * - Cross-session persistence
 * - Framework-agnostic identification
 */
export interface ElementLocator {
  /** CSS selector candidates (ordered by specificity) */
  selectors: string[];
  /** Structural fingerprint for similarity matching */
  fingerprint: string;
  /** Framework debug information (React/Vue) */
  debugSource?: DebugSource;
  /** DOM tree path (child indices from root) */
  path: number[];
  /** iframe selector chain (from top to target frame) - Phase 4 */
  frameChain?: string[];
  /** Shadow DOM host selector chain - Phase 2 */
  shadowHostChain?: string[];
}

// =============================================================================
// Transaction System (Phase 1 - Basic Structure, Low Priority)
// =============================================================================

/** Transaction operation types */
export type TransactionType = 'style' | 'text' | 'class' | 'move' | 'structure';

/**
 * Transaction snapshot for undo/redo
 * Captures element state before/after changes
 */
export interface TransactionSnapshot {
  /** Element locator for re-identification */
  locator: ElementLocator;
  /** innerHTML snapshot (for structure changes) */
  html?: string;
  /** Changed style properties */
  styles?: Record<string, string>;
  /** Class list tokens (from `class` attribute) */
  classes?: string[];
  /** Text content */
  text?: string;
}

/**
 * Move position data
 * Captures a concrete insertion point under a parent element
 */
export interface MoveOperationData {
  /** Target parent element locator */
  parentLocator: ElementLocator;
  /** Insert position index (among element children) */
  insertIndex: number;
  /** Anchor sibling element locator (for stable positioning) */
  anchorLocator?: ElementLocator;
  /** Position relative to anchor */
  anchorPosition: 'before' | 'after';
}

/**
 * Move transaction data
 * Captures both source and destination for undo/redo
 */
export interface MoveTransactionData {
  /** Original location before move */
  from: MoveOperationData;
  /** Target location after move */
  to: MoveOperationData;
}

/**
 * Structure operation data
 * For wrap/unwrap/delete/duplicate operations (Phase 5.5)
 */
export interface StructureOperationData {
  /** Structure action type */
  action: 'wrap' | 'unwrap' | 'delete' | 'duplicate';
  /** Wrapper tag for wrap/unwrap actions */
  wrapperTag?: string;
  /** Wrapper inline styles for wrap/unwrap actions */
  wrapperStyles?: Record<string, string>;
  /**
   * Deterministic insertion position for undo/redo.
   * Required for delete (restore) and duplicate (re-create).
   */
  position?: MoveOperationData;
  /**
   * Serialized element HTML for undo/redo.
   * Must be a single-root element outerHTML string.
   * Used by delete (restore original) and duplicate (re-create clone).
   */
  html?: string;
}

/**
 * Transaction record for undo/redo system
 */
export interface Transaction {
  /** Unique transaction ID */
  id: string;
  /** Operation type */
  type: TransactionType;
  /** Target element locator */
  targetLocator: ElementLocator;
  /** State before change */
  before: TransactionSnapshot;
  /** State after change */
  after: TransactionSnapshot;
  /** Move-specific data */
  moveData?: MoveTransactionData;
  /** Structure-specific data */
  structureData?: StructureOperationData;
  /** Timestamp */
  timestamp: number;
  /** Whether merged with previous transaction */
  merged: boolean;
}

// =============================================================================
// Public API Interface
// =============================================================================

/**
 * Web Editor V2 Public API
 * Exposed on window.__MCP_WEB_EDITOR_V2__
 */
export interface WebEditorV2Api {
  /** Start the editor */
  start: () => void;
  /** Stop the editor */
  stop: () => void;
  /** Toggle editor on/off, returns new state */
  toggle: () => boolean;
  /** Get current state */
  getState: () => WebEditorState;
}

// =============================================================================
// Global Declaration
// =============================================================================

declare global {
  interface Window {
    __MCP_WEB_EDITOR_V2__?: WebEditorV2Api;
  }
}
