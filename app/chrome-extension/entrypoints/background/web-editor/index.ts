import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

const CONTEXT_MENU_ID = 'web_editor_toggle';
const COMMAND_KEY = 'toggle_web_editor';
const DEFAULT_NATIVE_SERVER_PORT = 12306;

type WebEditorInstructionType = 'update_text' | 'update_style';

interface WebEditorFingerprint {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
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

  return {
    pageUrl,
    targetFile,
    fingerprint,
    techStackHint: techStackHint.length ? techStackHint : undefined,
    instruction,
  };
}

function buildAgentPrompt(payload: WebEditorApplyPayload): string {
  const lines: string[] = [];
  lines.push('You are a senior frontend engineer working in a local codebase.');
  lines.push(
    'Goal: persist a visual edit from the browser into the source code with minimal changes.',
  );
  lines.push('');
  lines.push(`Page URL: ${payload.pageUrl}`);
  lines.push('');
  lines.push('Selected element fingerprint (best-effort):');
  lines.push(`- tag: ${payload.fingerprint.tag}`);
  if (payload.fingerprint.id) lines.push(`- id: ${payload.fingerprint.id}`);
  if (payload.fingerprint.classes?.length)
    lines.push(`- classes: ${payload.fingerprint.classes.join(' ')}`);
  if (payload.fingerprint.text) lines.push(`- text: ${payload.fingerprint.text}`);
  lines.push('');

  if (payload.targetFile) {
    lines.push(`Target file (best-effort): ${payload.targetFile}`);
    lines.push(
      'If this path is invalid or points to node_modules, ignore it and locate by fingerprint instead.',
    );
    lines.push('');
  }

  if (payload.techStackHint?.length) {
    lines.push(`Tech hints: ${payload.techStackHint.join(', ')}`);
    lines.push('');
  }

  lines.push('Requested change:');
  lines.push(`- type: ${payload.instruction.type}`);
  lines.push(`- description: ${payload.instruction.description}`);
  if (payload.instruction.type === 'update_text' && payload.instruction.text) {
    lines.push(`- new text: ${JSON.stringify(payload.instruction.text)}`);
  }
  if (payload.instruction.type === 'update_style' && payload.instruction.style) {
    lines.push(`- style map: ${JSON.stringify(payload.instruction.style, null, 2)}`);
  }
  lines.push('');

  lines.push('How to locate the code to change:');
  if (payload.targetFile) {
    lines.push(
      `1) Open ${payload.targetFile} and locate the element by matching classes/text/fingerprint.`,
    );
    lines.push(
      '2) If not found, fall back to repo-wide search using the fingerprint text/classes.',
    );
  } else {
    lines.push(
      '1) Use repo-wide search (rg) with the fingerprint text/classes to find the component.',
    );
  }
  lines.push('');

  lines.push('Constraints:');
  lines.push('- Prefer the smallest safe edit.');
  lines.push('- If Tailwind is used, prefer updating className instead of adding inline styles.');
  lines.push('- If CSS Modules / styled-components are used, update the correct styling source.');
  lines.push('- Do not change unrelated behavior.');
  lines.push('');

  lines.push(
    'Output: apply the change in the repo, then reply with a short summary of what you changed.',
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

async function ensureEditorInjected(tabId: number): Promise<void> {
  try {
    const pong: any = await chrome.tabs.sendMessage(
      tabId,
      { action: 'web_editor_ping' } as any,
      { frameId: 0 } as any,
    );
    if (pong?.status === 'pong') return;
  } catch {
    // Fallthrough to executeScript
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['inject-scripts/web-editor.js'],
      world: 'ISOLATED',
    } as any);
  } catch (error) {
    console.warn('[WebEditor] Failed to inject editor script:', error);
  }
}

async function toggleEditorInTab(tabId: number): Promise<{ active?: boolean }> {
  await ensureEditorInjected(tabId);
  try {
    const resp: any = await chrome.tabs.sendMessage(
      tabId,
      { action: 'web_editor_toggle' } as any,
      { frameId: 0 } as any,
    );
    return { active: typeof resp?.active === 'boolean' ? resp.active : undefined };
  } catch (error) {
    console.warn('[WebEditor] Failed to toggle editor in tab:', error);
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
          return sendResponse({ success: true, requestId: json?.requestId });
        })().catch((error) => {
          sendResponse({
            success: false,
            error: String(error instanceof Error ? error.message : error),
          });
        });
        return true;
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
