/**
 * Composable for grouping messages into conversation threads.
 * Transforms flat AgentMessage[] into structured AgentThread[] for UI rendering.
 */
import { computed, type Ref } from 'vue';
import type { AgentMessage } from 'chrome-mcp-shared';

/** Thread state */
export type AgentThreadState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

/** Tool kinds for presentation */
export type ToolKind = 'grep' | 'read' | 'edit' | 'run' | 'plan' | 'generic';

/** Tool severity for styling */
export type ToolSeverity = 'info' | 'success' | 'warning' | 'error';

/** Structured tool presentation */
export interface ToolPresentation {
  kind: ToolKind;
  label: string;
  title: string;
  subtitle?: string;
  details?: string;
  files?: string[];
  command?: string;
  query?: string;
  engine?: string;
  severity: ToolSeverity;
  phase: 'use' | 'result';
  raw: { content: string; metadata?: Record<string, unknown> };
}

/** Timeline item types */
export type TimelineItem =
  | {
      kind: 'assistant_text';
      id: string;
      requestId?: string;
      createdAt: string;
      messageId: string;
      text: string;
      isStreaming: boolean;
    }
  | {
      kind: 'tool_use';
      id: string;
      requestId?: string;
      createdAt: string;
      messageId: string;
      tool: ToolPresentation;
      isStreaming: boolean;
    }
  | {
      kind: 'tool_result';
      id: string;
      requestId?: string;
      createdAt: string;
      messageId: string;
      tool: ToolPresentation;
      isError: boolean;
    }
  | {
      kind: 'status';
      id: string;
      requestId?: string;
      createdAt: string;
      status: string;
      text?: string;
    };

/** A grouped conversation thread */
export interface AgentThread {
  id: string;
  requestId?: string;
  title: string;
  createdAt: string;
  state: AgentThreadState;
  items: TimelineItem[];
}

/** Options for useAgentThreads */
export interface UseAgentThreadsOptions {
  messages: Ref<AgentMessage[]>;
  isStreaming: Ref<boolean>;
  currentRequestId: Ref<string | null>;
}

/**
 * Normalize a string for comparison
 */
function normalize(s: string | undefined): string {
  return (s ?? '').toLowerCase().trim();
}

/**
 * Get first string from multiple candidates
 */
function firstString(...args: unknown[]): string | undefined {
  for (const arg of args) {
    if (typeof arg === 'string' && arg.trim()) {
      return arg.trim();
    }
  }
  return undefined;
}

/**
 * Extract text after a prefix (e.g., "Running: <command>")
 */
function extractAfterPrefix(content: string, prefix: string): string | undefined {
  const idx = content.indexOf(prefix);
  if (idx === -1) return undefined;
  return content.slice(idx + prefix.length).trim();
}

/**
 * Summarize content to one line
 */
function summarizeOneLine(content: string): string {
  const line = content.split('\n')[0]?.trim() ?? '';
  return line.length > 60 ? line.slice(0, 57) + '...' : line;
}

/**
 * Title case a string
 */
function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Present a tool message as ToolPresentation
 */
function presentTool(msg: AgentMessage): ToolPresentation {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>;
  const phase = msg.messageType === 'tool_use' ? 'use' : 'result';
  const engine = msg.cliSource;

  const toolName =
    firstString(meta.toolName as string, meta.tool_name as string) ??
    (typeof engine === 'string' ? engine : undefined) ??
    'tool';

  const isError =
    meta.is_error === true ||
    meta.isError === true ||
    (typeof msg.content === 'string' && msg.content.trimStart().startsWith('Error:'));

  // Rule 1: Plan (Codex todo_list)
  if (meta.planPhase || normalize(toolName) === 'plan') {
    return {
      kind: 'plan',
      label: 'Plan',
      title: summarizeOneLine(msg.content) || 'Plan update',
      details: phase === 'result' ? msg.content : undefined,
      engine,
      severity: isError ? 'error' : 'info',
      phase,
      raw: { content: msg.content, metadata: meta },
    };
  }

  // Rule 2: File summary (Codex file_change -> metadata.files)
  const files = Array.isArray(meta.files)
    ? (meta.files as string[]).filter((x) => typeof x === 'string')
    : [];
  if (files.length > 0) {
    const title = files.length === 1 ? files[0] : `${files.length} files`;
    return {
      kind: 'edit',
      label: 'Edit',
      title,
      subtitle: files.length > 1 ? files.slice(0, 3).join(', ') : undefined,
      files,
      details: phase === 'result' ? msg.content : undefined,
      engine,
      severity: isError ? 'error' : 'success',
      phase,
      raw: { content: msg.content, metadata: meta },
    };
  }

  // Rule 3: Command (Codex bash, or Claude "Running:")
  const command = firstString(meta.command as string);
  if (
    normalize(toolName) === 'bash' ||
    normalize(toolName).includes('shell') ||
    typeof command === 'string' ||
    msg.content.startsWith('Running:') ||
    msg.content.startsWith('Ran:')
  ) {
    const extractedCommand =
      command ??
      extractAfterPrefix(msg.content, 'Running:') ??
      extractAfterPrefix(msg.content, 'Ran:') ??
      undefined;

    const details =
      firstString(meta.output as string) ?? (phase === 'result' ? msg.content : undefined);

    return {
      kind: 'run',
      label: 'Run',
      title: extractedCommand?.trim() || 'Command',
      command: extractedCommand?.trim(),
      details,
      engine,
      severity: isError ? 'error' : phase === 'result' ? 'success' : 'info',
      phase,
      raw: { content: msg.content, metadata: meta },
    };
  }

  // Rule 4: Search / Grep (Claude "Searching:")
  const queryFromContent = extractAfterPrefix(msg.content, 'Searching:');
  if (queryFromContent) {
    return {
      kind: 'grep',
      label: 'Grep',
      title: queryFromContent.trim(),
      query: queryFromContent.trim(),
      engine,
      severity: isError ? 'error' : 'info',
      phase,
      raw: { content: msg.content, metadata: meta },
    };
  }

  // Rule 5: Read / Edit by action
  const action = firstString(meta.action as string);
  const fileFromContent = extractAfterPrefix(msg.content, 'Operating on:')?.trim();
  const inferredKind =
    action === 'Read'
      ? 'read'
      : action === 'Edited' || action === 'Created' || action === 'Deleted'
        ? 'edit'
        : null;

  if (fileFromContent || inferredKind) {
    const kind: ToolKind = inferredKind ?? 'read';
    return {
      kind,
      label: kind === 'read' ? 'Read' : 'Edit',
      title: fileFromContent || toolName,
      engine,
      severity: isError ? 'error' : phase === 'result' ? 'success' : 'info',
      phase,
      raw: { content: msg.content, metadata: meta },
    };
  }

  // Fallback: generic tool
  return {
    kind: 'generic',
    label: titleCase(toolName),
    title: summarizeOneLine(msg.content) || `Using ${toolName}`,
    details: phase === 'result' ? msg.content : undefined,
    engine,
    severity: isError ? 'error' : 'info',
    phase,
    raw: { content: msg.content, metadata: meta },
  };
}

/**
 * Map a message to a timeline item
 */
function mapMessageToTimelineItem(msg: AgentMessage): TimelineItem | null {
  const createdAt = msg.createdAt;
  const requestId = msg.requestId?.trim() || undefined;

  if (msg.role === 'assistant' && msg.messageType === 'chat') {
    return {
      kind: 'assistant_text',
      id: msg.id,
      requestId,
      createdAt,
      messageId: msg.id,
      text: msg.content,
      isStreaming: msg.isStreaming === true && !msg.isFinal,
    };
  }

  if (msg.role === 'tool' && msg.messageType === 'tool_use') {
    return {
      kind: 'tool_use',
      id: msg.id,
      requestId,
      createdAt,
      messageId: msg.id,
      tool: presentTool(msg),
      isStreaming: msg.isStreaming === true && !msg.isFinal,
    };
  }

  if (msg.role === 'tool' && msg.messageType === 'tool_result') {
    const tool = presentTool(msg);
    return {
      kind: 'tool_result',
      id: msg.id,
      requestId,
      createdAt,
      messageId: msg.id,
      tool,
      isError: tool.severity === 'error',
    };
  }

  // Status messages
  if (msg.messageType === 'status' || msg.role === 'system') {
    return {
      kind: 'status',
      id: `status:${requestId ?? 'legacy'}:${msg.id}`,
      requestId,
      createdAt,
      status: 'ready',
      text: msg.content,
    };
  }

  return null;
}

/**
 * Build threads from messages
 */
function buildThreads(
  messages: AgentMessage[],
  isStreaming: boolean,
  currentRequestId: string | null,
): AgentThread[] {
  // Sort messages by createdAt
  const sortedMessages = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  // Group messages by requestId or legacy grouping
  let legacyCounter = 0;
  let currentLegacyKey: string | null = null;

  const groups = new Map<
    string,
    {
      key: string;
      requestId?: string;
      firstAt: string;
      title?: string;
      items: TimelineItem[];
    }
  >();

  function ensureGroup(key: string, requestId: string | undefined, createdAt: string) {
    if (!groups.has(key)) {
      groups.set(key, { key, requestId, firstAt: createdAt, items: [] });
    }
    return groups.get(key)!;
  }

  for (const msg of sortedMessages) {
    const rid = msg.requestId?.trim() || undefined;

    // Determine group key
    let key: string;
    if (rid) {
      key = `rid:${rid}`;
    } else {
      if (msg.role === 'user') {
        currentLegacyKey = `legacy:${legacyCounter++}`;
      }
      key = currentLegacyKey ?? 'legacy:orphan';
    }

    const group = ensureGroup(key, rid, msg.createdAt);

    // Title: first user chat message in group wins
    if (!group.title && msg.role === 'user' && msg.messageType === 'chat') {
      group.title = msg.content.trim() || 'Untitled request';
      group.firstAt = msg.createdAt;
    }

    // Map message to timeline item
    const item = mapMessageToTimelineItem(msg);
    if (item) group.items.push(item);

    // Update earliest timestamp
    if (msg.createdAt < group.firstAt) group.firstAt = msg.createdAt;
  }

  // Convert groups to threads
  const threads: AgentThread[] = [];

  for (const g of groups.values()) {
    const requestId = g.requestId;

    // Determine thread state
    let state: AgentThreadState = 'completed';
    if (isStreaming && currentRequestId && requestId === currentRequestId) {
      state = 'running';
    } else if (g.items.some((item) => item.kind === 'status')) {
      state = 'idle';
    }

    // Sort items by createdAt
    const items = [...g.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Add streaming status item if running
    if (state === 'running') {
      items.push({
        kind: 'status',
        id: `status:streaming:${requestId ?? 'current'}:${Date.now()}`,
        requestId,
        createdAt: new Date().toISOString(),
        status: 'running',
        text: 'Working...',
      });
    }

    threads.push({
      id: g.key,
      requestId,
      title: g.title ?? 'Untitled request',
      createdAt: g.firstAt,
      state,
      items,
    });
  }

  // Sort threads by createdAt
  return threads.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Composable for managing agent threads
 */
export function useAgentThreads(options: UseAgentThreadsOptions) {
  const threads = computed(() => {
    return buildThreads(
      options.messages.value,
      options.isStreaming.value,
      options.currentRequestId.value,
    );
  });

  return {
    threads,
  };
}
