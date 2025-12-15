/**
 * Agent-side shared data contracts.
 * These types are shared between native-server and chrome-extension to ensure consistency.
 *
 * English is used for technical contracts; Chinese comments explain design choices.
 */

// ============================================================
// Core Types
// ============================================================

export type AgentRole = 'user' | 'assistant' | 'tool' | 'system';

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: AgentRole;
  content: string;
  messageType: 'chat' | 'tool_use' | 'tool_result' | 'status';
  cliSource?: string;
  requestId?: string;
  isStreaming?: boolean;
  isFinal?: boolean;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

// ============================================================
// Stream Events
// ============================================================

export type StreamTransport = 'sse' | 'websocket';

export interface AgentStatusEvent {
  sessionId: string;
  status: 'starting' | 'ready' | 'running' | 'completed' | 'error' | 'cancelled';
  message?: string;
  requestId?: string;
}

export interface AgentConnectedEvent {
  sessionId: string;
  transport: StreamTransport;
  timestamp: string;
}

export interface AgentHeartbeatEvent {
  timestamp: string;
}

/** Usage statistics for a request */
export interface AgentUsageStats {
  sessionId: string;
  requestId?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
}

export type RealtimeEvent =
  | { type: 'message'; data: AgentMessage }
  | { type: 'status'; data: AgentStatusEvent }
  | { type: 'error'; error: string; data?: { sessionId?: string; requestId?: string } }
  | { type: 'connected'; data: AgentConnectedEvent }
  | { type: 'heartbeat'; data: AgentHeartbeatEvent }
  | { type: 'usage'; data: AgentUsageStats };

// ============================================================
// HTTP API Contracts
// ============================================================

export interface AgentAttachment {
  type: 'file' | 'image';
  name: string;
  mimeType: string;
  dataBase64: string;
}

export type AgentCliPreference = 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm';

export interface AgentActRequest {
  instruction: string;
  cliPreference?: AgentCliPreference;
  model?: string;
  attachments?: AgentAttachment[];
  /**
   * Optional logical project identifier. When provided, the backend
   * can resolve a stable workspace configuration instead of relying
   * solely on ad-hoc paths.
   */
  projectId?: string;
  /**
   * Optional project root / workspace directory on the local filesystem
   * that the engine should use as its working directory.
   */
  projectRoot?: string;
  /**
   * Optional request id from client; server will generate one if missing.
   */
  requestId?: string;
}

export interface AgentActResponse {
  requestId: string;
  sessionId: string;
  status: 'accepted';
}

// ============================================================
// Project & Engine Types
// ============================================================

export interface AgentProject {
  id: string;
  name: string;
  description?: string;
  /**
   * Absolute filesystem path for this project workspace.
   */
  rootPath: string;
  preferredCli?: AgentCliPreference;
  selectedModel?: string;
  /**
   * Active Claude session ID (UUID format) for session resumption.
   * Captured from SDK's system/init message and used for the 'resume' parameter.
   */
  activeClaudeSessionId?: string;
  /**
   * Whether to use Claude Code Router (CCR) for this project.
   * When enabled, the engine will auto-detect CCR configuration.
   */
  useCcr?: boolean;
  createdAt: string;
  updatedAt: string;
  lastActiveAt?: string;
}

export interface AgentEngineInfo {
  name: string;
  supportsMcp?: boolean;
}

// ============================================================
// Stored Message (for persistence)
// ============================================================

export interface AgentStoredMessage {
  id: string;
  projectId: string;
  sessionId: string;
  conversationId?: string | null;
  role: AgentRole;
  content: string;
  messageType: AgentMessage['messageType'];
  metadata?: Record<string, unknown>;
  cliSource?: string | null;
  createdAt?: string;
  requestId?: string;
}
