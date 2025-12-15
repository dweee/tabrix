import type { AgentAttachment, RealtimeEvent } from '../types';

export interface EngineInitOptions {
  sessionId: string;
  instruction: string;
  model?: string;
  projectRoot?: string;
  requestId: string;
  /**
   * AbortSignal for cancellation support.
   */
  signal?: AbortSignal;
  /**
   * Optional attachments (images/files) to include with the instruction.
   */
  attachments?: AgentAttachment[];
  /**
   * Optional project ID for session persistence.
   * When provided, engines can use this to save/load session state.
   */
  projectId?: string;
  /**
   * Optional Claude session ID (UUID) for resuming a previous session.
   * Only applicable to ClaudeEngine; retrieved from project's activeClaudeSessionId.
   */
  resumeClaudeSessionId?: string;
  /**
   * Whether to use Claude Code Router (CCR) for this request.
   * Only applicable to ClaudeEngine; when true, CCR will be auto-detected.
   */
  useCcr?: boolean;
}

/**
 * Callback to persist Claude session ID after initialization.
 */
export type ClaudeSessionPersistCallback = (sessionId: string) => Promise<void>;

export type EngineName = 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';

export interface EngineExecutionContext {
  /**
   * Emit a realtime event to all connected clients for the current session.
   */
  emit(event: RealtimeEvent): void;
  /**
   * Optional callback to persist Claude session ID after SDK initialization.
   * Only called by ClaudeEngine when projectId is provided.
   */
  persistClaudeSessionId?: ClaudeSessionPersistCallback;
}

export interface AgentEngine {
  name: EngineName;
  /**
   * Whether this engine can act as an MCP client natively.
   */
  supportsMcp?: boolean;
  initializeAndRun(options: EngineInitOptions, ctx: EngineExecutionContext): Promise<void>;
}

/**
 * Represents a running engine execution that can be cancelled.
 */
export interface RunningExecution {
  requestId: string;
  sessionId: string;
  engineName: EngineName;
  abortController: AbortController;
  startedAt: Date;
}
