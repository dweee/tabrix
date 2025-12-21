import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { WEB_EDITOR_V2_ACTIONS, WEB_EDITOR_V1_ACTIONS } from '@/common/web-editor-types';

const CONTEXT_MENU_ID = 'web_editor_toggle';
const COMMAND_KEY = 'toggle_web_editor';
const DEFAULT_NATIVE_SERVER_PORT = 12306;

// In-memory execution status cache (per requestId)
interface ExecutionStatusEntry {
  status: string;
  message?: string;
  updatedAt: number;
  result?: { success: boolean; summary?: string; error?: string };
}
const executionStatusCache = new Map<string, ExecutionStatusEntry>();
const STATUS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cleanupExpiredStatuses(): void {
  const now = Date.now();
  for (const [key, entry] of executionStatusCache) {
    if (now - entry.updatedAt > STATUS_CACHE_TTL) {
      executionStatusCache.delete(key);
    }
  }
}

function setExecutionStatus(
  requestId: string,
  status: string,
  message?: string,
  result?: ExecutionStatusEntry['result'],
): void {
  executionStatusCache.set(requestId, {
    status,
    message,
    updatedAt: Date.now(),
    result,
  });
  // Periodic cleanup
  if (executionStatusCache.size > 100) {
    cleanupExpiredStatuses();
  }
}

function getExecutionStatus(requestId: string): ExecutionStatusEntry | undefined {
  return executionStatusCache.get(requestId);
}

// SSE connections for status updates (per sessionId)
const sseConnections = new Map<string, { abort: AbortController; lastRequestId: string }>();

/**
 * Start SSE subscription for a session to receive status updates
 */
async function subscribeToSessionStatus(
  sessionId: string,
  requestId: string,
  port: number,
): Promise<void> {
  // Close existing connection for this session if any
  const existing = sseConnections.get(sessionId);
  if (existing) {
    existing.abort.abort();
    sseConnections.delete(sessionId);
  }

  const abortController = new AbortController();
  sseConnections.set(sessionId, { abort: abortController, lastRequestId: requestId });

  // Set initial status
  setExecutionStatus(requestId, 'starting', 'Connecting to Agent...');

  const sseUrl = `http://127.0.0.1:${port}/agent/chat/${encodeURIComponent(sessionId)}/stream`;

  try {
    const response = await fetch(sseUrl, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: abortController.signal,
    });

    if (!response.ok || !response.body) {
      setExecutionStatus(requestId, 'running', 'Agent processing...');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    setExecutionStatus(requestId, 'running', 'Agent processing...');

    // Read SSE stream

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5).trim());
            handleSseEvent(requestId, data);
          } catch {
            // Ignore parse errors
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Intentionally aborted, not an error
      return;
    }
    // Connection error - mark as unknown but not failed (Agent may still be running)
    const cached = getExecutionStatus(requestId);
    if (cached && !['completed', 'failed', 'cancelled'].includes(cached.status)) {
      setExecutionStatus(requestId, 'running', 'Agent processing (connection lost)...');
    }
  } finally {
    sseConnections.delete(sessionId);
  }
}

/**
 * Handle SSE event from Agent stream
 */
function handleSseEvent(requestId: string, event: unknown): void {
  if (!event || typeof event !== 'object') return;
  const e = event as Record<string, unknown>;
  const type = e.type;
  const data = e.data as Record<string, unknown> | undefined;

  // Check if this event is for our request
  const eventRequestId = data?.requestId as string | undefined;
  if (eventRequestId && eventRequestId !== requestId) return;

  if (type === 'status' && data) {
    const status = data.status as string;
    const message = data.message as string | undefined;

    // Map Agent status to our status
    let mappedStatus = status;
    if (status === 'ready') mappedStatus = 'running';

    setExecutionStatus(requestId, mappedStatus, message);
  } else if (type === 'message' && data) {
    // Update status to show we're receiving messages
    const cached = getExecutionStatus(requestId);
    if (cached && cached.status === 'starting') {
      setExecutionStatus(requestId, 'running', 'Agent is working...');
    }

    // Check for completion indicators in message content
    const role = data.role as string | undefined;
    const isFinal = data.isFinal as boolean | undefined;
    if (role === 'assistant' && isFinal) {
      const content = data.content as string | undefined;
      setExecutionStatus(requestId, 'completed', 'Completed', {
        success: true,
        summary: content?.slice(0, 200),
      });
    }
  } else if (type === 'error') {
    const errorMsg = (e.error as string) || 'Unknown error';
    setExecutionStatus(requestId, 'failed', errorMsg, {
      success: false,
      error: errorMsg,
    });
  }
}

/**
 * Web Editor version configuration
 * - v1: Legacy inject-scripts/web-editor.js (IIFE, ~850 lines)
 * - v2: New TypeScript-based web-editor-v2.js (WXT unlisted script)
 *
 * Set USE_WEB_EDITOR_V2 to true to enable v2.
 * This flag allows gradual rollout and easy rollback.
 */
const USE_WEB_EDITOR_V2 = true;

/** Script path for v1 (legacy) */
const V1_SCRIPT_PATH = 'inject-scripts/web-editor.js';

/** Script path for v2 (WXT unlisted script output) */
const V2_SCRIPT_PATH = 'web-editor-v2.js';

/** Script path for Phase 7 props agent (MAIN world) */
const PROPS_AGENT_SCRIPT_PATH = 'inject-scripts/props-agent.js';

type WebEditorInstructionType = 'update_text' | 'update_style';

interface WebEditorFingerprint {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
}

/** Debug source from React/Vue fiber (file, line, component name) */
interface DebugSource {
  file: string;
  line?: number;
  column?: number;
  componentName?: string;
}

/** Style operation details (before/after diff) */
interface StyleOperation {
  type: 'update_style';
  before: Record<string, string>;
  after: Record<string, string>;
  removed: string[];
}

interface WebEditorApplyPayload {
  pageUrl: string;
  targetFile?: string;
  fingerprint: WebEditorFingerprint;
  techStackHint?: string[];
  instruction: {
    type: WebEditorInstructionType;
    description: string;
    text?: string;
    style?: Record<string, string>;
  };

  // V2 extended fields (best-effort, optional)
  selectorCandidates?: string[];
  debugSource?: DebugSource;
  operation?: StyleOperation;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function normalizeStyleMap(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeString(k).trim();
    const val = normalizeString(v).trim();
    if (!key || !val) continue;
    out[key] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeStyleMapAllowEmpty(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const key = normalizeString(k).trim();
    if (!key) continue;
    // Allow empty values (represents removed styles)
    out[key] = normalizeString(v).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeDebugSource(value: unknown): DebugSource | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  const file = normalizeString(obj.file).trim();
  if (!file) return undefined;

  const source: DebugSource = { file };
  const line = Number(obj.line);
  if (Number.isFinite(line) && line > 0) source.line = line;
  const column = Number(obj.column);
  if (Number.isFinite(column) && column >= 0) source.column = column;
  const componentName = normalizeString(obj.componentName).trim();
  if (componentName) source.componentName = componentName;

  return source;
}

function normalizeOperation(value: unknown): StyleOperation | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const obj = value as Record<string, unknown>;
  if (obj.type !== 'update_style') return undefined;

  const before = normalizeStyleMapAllowEmpty(obj.before);
  const after = normalizeStyleMapAllowEmpty(obj.after);
  const removed = normalizeStringArray(obj.removed);

  if (!before && !after && removed.length === 0) return undefined;

  return {
    type: 'update_style',
    before: before ?? {},
    after: after ?? {},
    removed,
  };
}

function normalizeApplyPayload(raw: unknown): WebEditorApplyPayload {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const pageUrl = normalizeString(obj.pageUrl).trim();
  const targetFile = normalizeString(obj.targetFile).trim() || undefined;
  const techStackHint = normalizeStringArray(obj.techStackHint);

  const fingerprintRaw = (
    obj.fingerprint && typeof obj.fingerprint === 'object' ? obj.fingerprint : {}
  ) as Record<string, unknown>;
  const fingerprint: WebEditorFingerprint = {
    tag: normalizeString(fingerprintRaw.tag).trim() || 'unknown',
    id: normalizeString(fingerprintRaw.id).trim() || undefined,
    classes: normalizeStringArray(fingerprintRaw.classes),
    text: normalizeString(fingerprintRaw.text).trim() || undefined,
  };

  const instructionRaw = (
    obj.instruction && typeof obj.instruction === 'object' ? obj.instruction : {}
  ) as Record<string, unknown>;
  const type = normalizeString(instructionRaw.type).trim() as WebEditorInstructionType;
  if (type !== 'update_text' && type !== 'update_style') {
    throw new Error('Invalid instruction.type');
  }

  const instruction = {
    type,
    description: normalizeString(instructionRaw.description).trim() || '',
    text: normalizeString(instructionRaw.text).trim() || undefined,
    style: normalizeStyleMap(instructionRaw.style),
  };

  if (!pageUrl) {
    throw new Error('pageUrl is required');
  }
  if (!instruction.description) {
    throw new Error('instruction.description is required');
  }

  // V2 extended fields (optional)
  const selectorCandidates = normalizeStringArray(obj.selectorCandidates);
  const debugSource = normalizeDebugSource(obj.debugSource);
  const operation = normalizeOperation(obj.operation);

  return {
    pageUrl,
    targetFile,
    fingerprint,
    techStackHint: techStackHint.length ? techStackHint : undefined,
    instruction,
    selectorCandidates: selectorCandidates.length ? selectorCandidates : undefined,
    debugSource,
    operation,
  };
}

function buildAgentPrompt(payload: WebEditorApplyPayload): string {
  const lines: string[] = [];

  // Header
  lines.push('You are a senior frontend engineer working in a local codebase.');
  lines.push(
    'Goal: persist a visual edit from the browser into the source code with minimal changes.',
  );
  lines.push('');

  // Page context
  lines.push(`Page URL: ${payload.pageUrl}`);
  lines.push('');

  // == Source Location (high-confidence if debugSource available) ==
  const ds = payload.debugSource;
  if (ds?.file) {
    lines.push('## Source Location (from React/Vue debug info)');
    const loc = ds.line ? `${ds.file}:${ds.line}${ds.column ? `:${ds.column}` : ''}` : ds.file;
    lines.push(`- file: ${loc}`);
    if (ds.componentName) lines.push(`- component: ${ds.componentName}`);
    lines.push('');
    lines.push('This is high-confidence source location extracted from framework debug info.');
    lines.push('Start your search here. Only fall back to fingerprint if this file is invalid.');
    lines.push('');
  } else if (payload.targetFile) {
    lines.push(`## Target File (best-effort): ${payload.targetFile}`);
    lines.push(
      'If this path is invalid or points to node_modules, fall back to fingerprint search.',
    );
    lines.push('');
  }

  // == Element Fingerprint ==
  lines.push('## Element Fingerprint');
  lines.push(`- tag: ${payload.fingerprint.tag}`);
  if (payload.fingerprint.id) lines.push(`- id: ${payload.fingerprint.id}`);
  if (payload.fingerprint.classes?.length) {
    lines.push(`- classes: ${payload.fingerprint.classes.join(' ')}`);
  }
  if (payload.fingerprint.text) lines.push(`- text: ${payload.fingerprint.text}`);
  lines.push('');

  // == CSS Selectors (for precise matching) ==
  if (payload.selectorCandidates?.length) {
    lines.push('## CSS Selectors (ordered by specificity)');
    for (const sel of payload.selectorCandidates.slice(0, 5)) {
      lines.push(`- ${sel}`);
    }
    lines.push('');
    lines.push('Use these selectors to grep the codebase if file location is unavailable.');
    lines.push('');
  }

  // == Tech Stack ==
  if (payload.techStackHint?.length) {
    lines.push(`## Tech Stack: ${payload.techStackHint.join(', ')}`);
    lines.push('');
  }

  // == Requested Change ==
  lines.push('## Requested Change');
  lines.push(`- type: ${payload.instruction.type}`);
  lines.push(`- description: ${payload.instruction.description}`);

  if (payload.instruction.type === 'update_text' && payload.instruction.text !== undefined) {
    lines.push(`- new text: ${JSON.stringify(payload.instruction.text)}`);
  }

  // For style updates, show detailed before/after diff if available
  if (payload.instruction.type === 'update_style') {
    const op = payload.operation;
    if (op && (Object.keys(op.before).length > 0 || Object.keys(op.after).length > 0)) {
      lines.push('');
      lines.push('### Style Changes (before → after)');
      const allKeys = new Set([...Object.keys(op.before), ...Object.keys(op.after)]);
      for (const key of allKeys) {
        const before = op.before[key] ?? '(unset)';
        const after = op.after[key] ?? '(removed)';
        if (before !== after) {
          lines.push(`  ${key}: "${before}" → "${after}"`);
        }
      }
      if (op.removed.length > 0) {
        lines.push(`  [Removed]: ${op.removed.join(', ')}`);
      }
    } else if (payload.instruction.style) {
      lines.push(`- style map: ${JSON.stringify(payload.instruction.style, null, 2)}`);
    }
  }
  lines.push('');

  // == Instructions ==
  lines.push('## How to Apply');
  if (ds?.file) {
    lines.push(`1. Open ${ds.file}${ds.line ? ` around line ${ds.line}` : ''}`);
    if (ds.componentName) {
      lines.push(`2. Locate the "${ds.componentName}" component definition`);
    }
    lines.push(
      `3. Find the element matching tag="${payload.fingerprint.tag}"${payload.fingerprint.classes?.length ? ` with classes including "${payload.fingerprint.classes[0]}"` : ''}`,
    );
    lines.push('4. Apply the requested style/text change');
  } else if (payload.targetFile) {
    lines.push(`1. Open ${payload.targetFile}`);
    lines.push('2. Search for the element by matching fingerprint (tag, classes, text)');
    lines.push('3. If not found, use repo-wide search with selectors or class names');
    lines.push('4. Apply the requested change');
  } else {
    lines.push('1. Use repo-wide search (rg) with class names or text from fingerprint');
    if (payload.selectorCandidates?.length) {
      lines.push(`2. Try searching for: "${payload.selectorCandidates[0]}"`);
    }
    lines.push('3. Locate the component/template containing this element');
    lines.push('4. Apply the requested change');
  }
  lines.push('');

  // == Constraints ==
  lines.push('## Constraints');
  lines.push('- Make the smallest safe edit possible');
  if (payload.techStackHint?.includes('Tailwind')) {
    lines.push('- Tailwind detected: prefer updating className over inline styles');
  }
  if (payload.techStackHint?.includes('React') || payload.techStackHint?.includes('Vue')) {
    lines.push('- Update the component source, not generated/bundled code');
  }
  lines.push('- If CSS Modules or styled-components are used, update the correct styling source');
  lines.push('- Do not change unrelated behavior or formatting');
  lines.push('');

  // == Output ==
  lines.push(
    '## Output\nApply the change in the repo, then reply with a short summary of what file(s) you modified and the exact change made.',
  );

  return lines.join('\n');
}

async function ensureContextMenu(): Promise<void> {
  try {
    if (!(chrome as any).contextMenus?.create) return;
    try {
      await chrome.contextMenus.remove(CONTEXT_MENU_ID);
    } catch {}
    await chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: '切换网页编辑模式',
      contexts: ['all'],
    });
  } catch (error) {
    console.warn('[WebEditor] Failed to ensure context menu:', error);
  }
}

/**
 * Get the appropriate action constants based on version
 */
function getActions() {
  return USE_WEB_EDITOR_V2 ? WEB_EDITOR_V2_ACTIONS : WEB_EDITOR_V1_ACTIONS;
}

/**
 * Ensure the web editor script is injected into the tab
 * Supports both v1 (legacy) and v2 (new) versions
 *
 * V1 and V2 use different action names to avoid conflicts:
 * - V1: web_editor_ping, web_editor_toggle, etc.
 * - V2: web_editor_ping_v2, web_editor_toggle_v2, etc.
 */
async function ensureEditorInjected(tabId: number): Promise<void> {
  const scriptPath = USE_WEB_EDITOR_V2 ? V2_SCRIPT_PATH : V1_SCRIPT_PATH;
  const logPrefix = USE_WEB_EDITOR_V2 ? '[WebEditorV2]' : '[WebEditor]';
  const actions = getActions();

  // Try to ping existing instance using version-specific action
  try {
    const pong: { status?: string; version?: number } = await chrome.tabs.sendMessage(
      tabId,
      { action: actions.PING },
      { frameId: 0 },
    );

    if (pong?.status === 'pong') {
      // Already injected with correct version
      return;
    }
  } catch {
    // No existing instance, fallthrough to inject
  }

  // Inject the script
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [scriptPath],
      world: 'ISOLATED',
    });
    console.log(`${logPrefix} Script injected successfully`);
  } catch (error) {
    console.warn(`${logPrefix} Failed to inject editor script:`, error);
  }
}

/**
 * Inject props agent into MAIN world for Phase 7 Props editing
 * Only inject for v2 editor
 */
async function ensurePropsAgentInjected(tabId: number): Promise<void> {
  if (!USE_WEB_EDITOR_V2) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [PROPS_AGENT_SCRIPT_PATH],
      world: 'MAIN',
    });
  } catch (error) {
    // Best-effort: some pages (chrome://, extensions, PDF) block injection
    console.warn('[WebEditorV2] Failed to inject props agent:', error);
  }
}

/**
 * Send cleanup event to props agent
 */
async function sendPropsAgentCleanup(tabId: number): Promise<void> {
  if (!USE_WEB_EDITOR_V2) return;

  try {
    // Dispatch cleanup event in ISOLATED world
    // CustomEvent crosses worlds and is observed by MAIN agent
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        try {
          window.dispatchEvent(new CustomEvent('web-editor-props:cleanup'));
        } catch {
          // ignore
        }
      },
      world: 'ISOLATED',
    });
  } catch (error) {
    // Best-effort cleanup; ignore failures if tab is gone or injection blocked
    console.warn('[WebEditorV2] Failed to send props agent cleanup:', error);
  }
}

// =============================================================================
// Phase 7.1.6: Early Injection for Props Agent
// =============================================================================

/**
 * Content script ID prefix for early injection (document_start).
 * Registered scripts persist across sessions and survive browser restarts.
 */
const PROPS_AGENT_EARLY_INJECTION_ID_PREFIX = 'mcp_we_props_early';

/**
 * Result of early injection registration
 */
interface EarlyInjectionResult {
  id: string;
  host: string;
  matches: string[];
  alreadyRegistered: boolean;
}

/**
 * Sanitize a string for use in content script ID
 * Only allows alphanumeric, underscore, and hyphen
 */
function sanitizeContentScriptId(input: string): string {
  const cleaned = String(input ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned.slice(0, 80) || 'site';
}

/**
 * Build match patterns from tab URL for early injection.
 * Returns patterns for the specific host only (not all URLs).
 */
function buildEarlyInjectionPatterns(tabUrl: string): { host: string; matches: string[] } {
  let url: URL;
  try {
    url = new URL(tabUrl);
  } catch {
    throw new Error('Invalid tab URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Early injection only supports http/https pages (got ${url.protocol})`);
  }

  const host = url.hostname.trim();
  if (!host) {
    throw new Error('Unable to derive host from tab URL');
  }

  // Match all paths on this host for both http and https
  return { host, matches: [`*://${host}/*`] };
}

/**
 * Register props agent for early injection (document_start, MAIN world).
 * This allows capturing React DevTools hook before React initializes.
 *
 * The registration is per-host and persists across sessions.
 */
async function registerPropsAgentEarlyInjection(tabUrl: string): Promise<EarlyInjectionResult> {
  const { host, matches } = buildEarlyInjectionPatterns(tabUrl);
  const id = `${PROPS_AGENT_EARLY_INJECTION_ID_PREFIX}_${sanitizeContentScriptId(host)}`;

  // Check if already registered (idempotent)
  let alreadyRegistered = false;
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
    alreadyRegistered = existing.some((s) => s.id === id);
  } catch {
    // API might not support getRegisteredContentScripts in all contexts
    alreadyRegistered = false;
  }

  if (!alreadyRegistered) {
    await chrome.scripting.registerContentScripts([
      {
        id,
        js: [PROPS_AGENT_SCRIPT_PATH],
        matches,
        runAt: 'document_start',
        world: 'MAIN',
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    console.log(`[WebEditorV2] Registered early injection for ${host}`);
  }

  return { id, host, matches, alreadyRegistered };
}

async function toggleEditorInTab(tabId: number): Promise<{ active?: boolean }> {
  await ensureEditorInjected(tabId);
  const logPrefix = USE_WEB_EDITOR_V2 ? '[WebEditorV2]' : '[WebEditor]';
  const actions = getActions();

  try {
    const resp: { active?: boolean } = await chrome.tabs.sendMessage(
      tabId,
      { action: actions.TOGGLE },
      { frameId: 0 },
    );
    const active = typeof resp?.active === 'boolean' ? resp.active : undefined;

    // Phase 7: Inject props agent on start; cleanup on stop
    if (active === true) {
      await ensurePropsAgentInjected(tabId);
    } else if (active === false) {
      await sendPropsAgentCleanup(tabId);
    }

    return { active };
  } catch (error) {
    console.warn(`${logPrefix} Failed to toggle editor in tab:`, error);
    return {};
  }
}

async function getActiveTabId(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs?.[0]?.id;
    return typeof tabId === 'number' ? tabId : null;
  } catch {
    return null;
  }
}

export function initWebEditorListeners(): void {
  ensureContextMenu().catch(() => {});

  if ((chrome as any).contextMenus?.onClicked?.addListener) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
      try {
        if (info.menuItemId !== CONTEXT_MENU_ID) return;
        const tabId = tab?.id;
        if (typeof tabId !== 'number') return;
        await toggleEditorInTab(tabId);
      } catch {}
    });
  }

  chrome.commands.onCommand.addListener(async (command) => {
    try {
      if (command !== COMMAND_KEY) return;
      const tabId = await getActiveTabId();
      if (typeof tabId !== 'number') return;
      await toggleEditorInTab(tabId);
    } catch {}
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    try {
      // Phase 7.1.6: Handle early injection registration request
      if (message?.type === BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_PROPS_REGISTER_EARLY_INJECTION) {
        (async () => {
          const senderTab = (_sender as chrome.runtime.MessageSender)?.tab;
          const senderTabId = senderTab?.id;
          const senderTabUrl = senderTab?.url;

          if (typeof senderTabId !== 'number' || typeof senderTabUrl !== 'string') {
            return sendResponse({
              success: false,
              error: 'Sender tab information is required',
            });
          }

          try {
            const result = await registerPropsAgentEarlyInjection(senderTabUrl);

            // Respond first, then reload (to avoid message port closing during navigation)
            sendResponse({ success: true, ...result });

            // Small delay to ensure response is sent before navigation
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Reload the tab so early injection takes effect
            try {
              await chrome.tabs.reload(senderTabId);
            } catch {
              // Best-effort: some tabs may block reload
            }
          } catch (err) {
            sendResponse({
              success: false,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        })();
        return true; // Async response
      }

      if (message?.type === BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_TOGGLE) {
        getActiveTabId()
          .then(async (tabId) => {
            if (typeof tabId !== 'number') return sendResponse({ success: false });
            const result = await toggleEditorInTab(tabId);
            sendResponse({ success: true, ...result });
          })
          .catch(() => sendResponse({ success: false }));
        return true;
      }
      if (message?.type === BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_APPLY) {
        const payload = normalizeApplyPayload(message.payload);
        (async () => {
          const senderTabId = (_sender as any)?.tab?.id;
          const sessionId =
            typeof senderTabId === 'number' ? `web-editor-${senderTabId}` : 'web-editor';

          const stored = await chrome.storage.local.get([
            'nativeServerPort',
            'agent-selected-project-id',
            'agent-project-root-override',
          ]);
          const portRaw = stored?.nativeServerPort;
          const port = Number.isFinite(Number(portRaw))
            ? Number(portRaw)
            : DEFAULT_NATIVE_SERVER_PORT;

          const projectId = normalizeString(stored?.['agent-selected-project-id']).trim() || '';
          const projectRootOverride =
            normalizeString(stored?.['agent-project-root-override']).trim() || '';

          if (!projectId && !projectRootOverride) {
            return sendResponse({
              success: false,
              error:
                'No Agent project selected. Open Side Panel → 智能助手 and select/create a project first.',
            });
          }

          const instruction = buildAgentPrompt(payload);
          const url = `http://127.0.0.1:${port}/agent/chat/${encodeURIComponent(sessionId)}/act`;

          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instruction,
              projectId: projectId || undefined,
              projectRoot: projectRootOverride || undefined,
            }),
          });

          if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            return sendResponse({
              success: false,
              error: text || `HTTP ${resp.status}`,
            });
          }

          const json: any = await resp.json().catch(() => ({}));
          const requestId = json?.requestId as string | undefined;

          if (requestId) {
            // Start SSE subscription for status updates (fire and forget)
            subscribeToSessionStatus(sessionId, requestId, port).catch(() => {});
          }

          return sendResponse({ success: true, requestId, sessionId });
        })().catch((error) => {
          sendResponse({
            success: false,
            error: String(error instanceof Error ? error.message : error),
          });
        });
        return true;
      }
      if (message?.type === BACKGROUND_MESSAGE_TYPES.WEB_EDITOR_STATUS_QUERY) {
        const { requestId } = message;
        if (!requestId || typeof requestId !== 'string') {
          sendResponse({ success: false, error: 'requestId is required' });
          return false;
        }

        const entry = getExecutionStatus(requestId);
        if (!entry) {
          // No status yet - likely still pending or not tracked
          sendResponse({ success: true, status: 'pending', message: 'Waiting for status...' });
        } else {
          sendResponse({
            success: true,
            status: entry.status,
            message: entry.message,
            result: entry.result,
          });
        }
        return false; // Synchronous response
      }
    } catch (error) {
      sendResponse({
        success: false,
        error: String(error instanceof Error ? error.message : error),
      });
    }
    return false;
  });
}
