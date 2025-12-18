/**
 * Shadow DOM Host
 *
 * Creates an isolated container for the Web Editor UI using Shadow DOM.
 * Provides:
 * - Style isolation (no CSS bleed in/out)
 * - Event isolation (UI events don't bubble to page)
 * - Overlay container for Canvas/visual feedback
 * - UI container for panels/controls
 */

import {
  WEB_EDITOR_V2_HOST_ID,
  WEB_EDITOR_V2_OVERLAY_ID,
  WEB_EDITOR_V2_UI_ID,
  WEB_EDITOR_V2_Z_INDEX,
} from '../constants';
import { Disposer } from '../utils/disposables';

// =============================================================================
// Types
// =============================================================================

/** Elements exposed by the shadow host */
export interface ShadowHostElements {
  /** The host element attached to the document */
  host: HTMLDivElement;
  /** The shadow root */
  shadowRoot: ShadowRoot;
  /** Container for overlay elements (Canvas, guides, etc.) */
  overlayRoot: HTMLDivElement;
  /** Container for UI elements (panels, toolbar, etc.) */
  uiRoot: HTMLDivElement;
}

/** Options for mounting the shadow host */
export interface ShadowHostOptions {
  /** Callback when user requests to close the editor */
  onRequestClose?: () => void;
}

/** Interface for the shadow host manager */
export interface ShadowHostManager {
  /** Get the shadow host elements (null if not mounted) */
  getElements(): ShadowHostElements | null;
  /** Check if a node is part of the editor overlay */
  isOverlayElement(node: unknown): boolean;
  /** Check if an event originated from the editor UI */
  isEventFromUi(event: Event): boolean;
  /** Dispose and unmount the shadow host */
  dispose(): void;
}

// =============================================================================
// Styles
// =============================================================================

const SHADOW_HOST_STYLES = /* css */ `
  :host {
    all: initial;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

  /* Overlay container - for Canvas and visual feedback */
  #${WEB_EDITOR_V2_OVERLAY_ID} {
    position: fixed;
    inset: 0;
    pointer-events: none;
    contain: layout style;
  }

  /* UI container - for panels and controls */
  #${WEB_EDITOR_V2_UI_ID} {
    position: fixed;
    top: 16px;
    right: 16px;
    pointer-events: auto;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #0f172a;
    -webkit-font-smoothing: antialiased;
  }

  /* Panel styles */
  .we-panel {
    width: 320px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid rgba(148, 163, 184, 0.5);
    border-radius: 12px;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 10px 20px -5px rgba(0, 0, 0, 0.15);
    overflow: hidden;
    contain: layout style paint;
  }

  .we-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: rgba(248, 250, 252, 0.95);
    border-bottom: 1px solid rgba(226, 232, 240, 0.8);
    user-select: none;
  }

  .we-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 600;
    color: #1e293b;
  }

  .we-badge {
    font-size: 10px;
    font-weight: 500;
    padding: 2px 6px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border-radius: 4px;
  }

  .we-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    color: #475569;
    background: white;
    border: 1px solid rgba(148, 163, 184, 0.5);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .we-btn:hover {
    background: #f8fafc;
    border-color: rgba(148, 163, 184, 0.7);
  }

  .we-btn:active {
    background: #f1f5f9;
  }

  .we-btn:focus-visible {
    outline: 2px solid #6366f1;
    outline-offset: 2px;
  }

  .we-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .we-btn--primary {
    background: linear-gradient(135deg, #0f172a, #1e293b);
    color: #ffffff;
    border-color: rgba(15, 23, 42, 0.5);
  }

  .we-btn--primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #1e293b, #334155);
    border-color: rgba(15, 23, 42, 0.65);
  }

  .we-btn--danger {
    color: #b91c1c;
    border-color: rgba(248, 113, 113, 0.45);
  }

  .we-btn--danger:hover:not(:disabled) {
    background: rgba(248, 113, 113, 0.08);
    border-color: rgba(248, 113, 113, 0.6);
  }

  /* Toolbar */
  .we-toolbar {
    position: fixed;
    left: 50%;
    top: 16px;
    transform: translateX(-50%);
    width: min(720px, calc(100vw - 32px));
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid rgba(148, 163, 184, 0.5);
    border-radius: 12px;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.1),
      0 10px 20px -5px rgba(0, 0, 0, 0.15);
    pointer-events: auto;
    user-select: none;
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 13px;
    color: #0f172a;
  }

  .we-toolbar[data-position="bottom"] {
    top: auto;
    bottom: 16px;
  }

  .we-toolbar-left,
  .we-toolbar-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .we-toolbar-center {
    flex: 1;
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  .we-toolbar-meta {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px;
    background: rgba(248, 250, 252, 0.9);
    border: 1px solid rgba(226, 232, 240, 0.9);
    border-radius: 999px;
    color: #475569;
    font-size: 12px;
    white-space: nowrap;
  }

  .we-toolbar-status {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(100, 116, 139, 0.12);
    color: #334155;
  }

  .we-toolbar[data-status="idle"] .we-toolbar-status {
    display: none;
  }

  .we-toolbar[data-status="applying"] .we-toolbar-status {
    background: rgba(59, 130, 246, 0.12);
    color: #1d4ed8;
  }

  .we-toolbar[data-status="success"] .we-toolbar-status {
    background: rgba(34, 197, 94, 0.12);
    color: #15803d;
  }

  .we-toolbar[data-status="error"] .we-toolbar-status {
    background: rgba(248, 113, 113, 0.14);
    color: #b91c1c;
  }

  .we-body {
    padding: 14px;
    color: #475569;
    font-size: 12px;
  }

  .we-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(34, 197, 94, 0.1);
    border-radius: 6px;
    color: #15803d;
    font-size: 12px;
  }

  .we-status-dot {
    width: 8px;
    height: 8px;
    background: #22c55e;
    border-radius: 50%;
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

// =============================================================================
// Implementation
// =============================================================================

/**
 * Set a CSS property with !important flag
 */
function setImportantStyle(element: HTMLElement, property: string, value: string): void {
  element.style.setProperty(property, value, 'important');
}

/**
 * Create the initial panel UI
 */
function createPanelContent(onRequestClose?: () => void): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'we-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Web Editor');

  // Header
  const header = document.createElement('div');
  header.className = 'we-header';

  const title = document.createElement('div');
  title.className = 'we-title';
  title.innerHTML = `
    <span>Web Editor</span>
    <span class="we-badge">V2</span>
  `;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'we-btn';
  closeBtn.textContent = 'Exit';
  closeBtn.setAttribute('aria-label', 'Exit Web Editor');
  closeBtn.addEventListener('click', () => onRequestClose?.());

  header.append(title, closeBtn);

  // Body
  const body = document.createElement('div');
  body.className = 'we-body';

  const status = document.createElement('div');
  status.className = 'we-status';
  status.innerHTML = `
    <span class="we-status-dot"></span>
    <span>Editor active - Hover to select elements</span>
  `;
  body.append(status);

  panel.append(header, body);
  return panel;
}

/**
 * Mount the Shadow DOM host and return a manager interface
 */
export function mountShadowHost(options: ShadowHostOptions = {}): ShadowHostManager {
  const disposer = new Disposer();
  let elements: ShadowHostElements | null = null;

  // Clean up any existing host (from crash/reload)
  const existing = document.getElementById(WEB_EDITOR_V2_HOST_ID);
  if (existing) {
    try {
      existing.remove();
    } catch {
      // Best-effort cleanup
    }
  }

  // Create host element
  const host = document.createElement('div');
  host.id = WEB_EDITOR_V2_HOST_ID;
  host.setAttribute('data-mcp-web-editor', 'v2');

  // Apply host styles with !important to resist page CSS
  setImportantStyle(host, 'position', 'fixed');
  setImportantStyle(host, 'inset', '0');
  setImportantStyle(host, 'z-index', String(WEB_EDITOR_V2_Z_INDEX));
  setImportantStyle(host, 'pointer-events', 'none');
  setImportantStyle(host, 'contain', 'layout style paint');
  setImportantStyle(host, 'isolation', 'isolate');

  // Create shadow root
  const shadowRoot = host.attachShadow({ mode: 'open' });

  // Add styles
  const styleEl = document.createElement('style');
  styleEl.textContent = SHADOW_HOST_STYLES;
  shadowRoot.append(styleEl);

  // Create overlay container (for Canvas)
  const overlayRoot = document.createElement('div');
  overlayRoot.id = WEB_EDITOR_V2_OVERLAY_ID;

  // Create UI container (for panels)
  const uiRoot = document.createElement('div');
  uiRoot.id = WEB_EDITOR_V2_UI_ID;
  uiRoot.append(createPanelContent(options.onRequestClose));

  shadowRoot.append(overlayRoot, uiRoot);

  // Mount to document
  const mountPoint = document.documentElement ?? document.body;
  mountPoint.append(host);
  disposer.add(() => host.remove());

  elements = { host, shadowRoot, overlayRoot, uiRoot };

  // Event isolation: prevent UI events from bubbling to page
  const blockedEvents = [
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointerenter',
    'pointerleave',
    'mousedown',
    'mouseup',
    'mousemove',
    'mouseenter',
    'mouseleave',
    'click',
    'dblclick',
    'contextmenu',
    'keydown',
    'keyup',
    'keypress',
    'wheel',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'focus',
    'blur',
    'input',
    'change',
  ];

  const stopPropagation = (event: Event) => {
    event.stopPropagation();
  };

  for (const eventType of blockedEvents) {
    disposer.listen(uiRoot, eventType, stopPropagation);
  }

  // Helper: check if a node is part of the editor
  const isOverlayElement = (node: unknown): boolean => {
    if (!(node instanceof Node)) return false;
    if (node === host) return true;

    const root = typeof node.getRootNode === 'function' ? node.getRootNode() : null;
    return root instanceof ShadowRoot && root.host === host;
  };

  // Helper: check if an event came from the editor UI
  const isEventFromUi = (event: Event): boolean => {
    try {
      if (typeof event.composedPath === 'function') {
        return event.composedPath().some((el) => isOverlayElement(el));
      }
    } catch {
      // Fallback to target
    }
    return isOverlayElement(event.target);
  };

  return {
    getElements: () => elements,
    isOverlayElement,
    isEventFromUi,
    dispose: () => {
      elements = null;
      disposer.dispose();
    },
  };
}
