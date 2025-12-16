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
   * Optional database session ID (sessions.id). When provided, the backend
   * will load session-level configuration (engine, model, permission mode,
   * resume ids, etc.) from the sessions table.
   */
  dbSessionId?: string;
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
// Session Types
// ============================================================

/**
 * System prompt configuration for a session.
 */
export type AgentSystemPromptConfig =
  | { type: 'custom'; text: string }
  | { type: 'preset'; preset: 'claude_code'; append?: string };

/**
 * Tools configuration - can be a list of tool names or a preset.
 */
export type AgentToolsConfig = string[] | { type: 'preset'; preset: 'claude_code' };

/**
 * Session options configuration.
 */
export interface AgentSessionOptionsConfig {
  settingSources?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  tools?: AgentToolsConfig;
  betas?: string[];
  maxThinkingTokens?: number;
  maxTurns?: number;
  maxBudgetUsd?: number;
  mcpServers?: Record<string, unknown>;
  outputFormat?: Record<string, unknown>;
  enableFileCheckpointing?: boolean;
  sandbox?: Record<string, unknown>;
  env?: Record<string, string>;
}

/**
 * Cached management information from Claude SDK.
 */
export interface AgentManagementInfo {
  tools?: string[];
  agents?: string[];
  plugins?: Array<{ name: string; path?: string }>;
  skills?: string[];
  mcpServers?: Array<{ name: string; status: string }>;
  slashCommands?: string[];
  model?: string;
  permissionMode?: string;
  cwd?: string;
  outputStyle?: string;
  betas?: string[];
  claudeCodeVersion?: string;
  apiKeySource?: string;
  lastUpdated?: string;
}

/**
 * Agent session - represents an independent conversation within a project.
 */
export interface AgentSession {
  id: string;
  projectId: string;
  engineName: AgentCliPreference;
  engineSessionId?: string;
  name?: string;
  /** Preview text from first user message, for display in session list */
  preview?: string;
  model?: string;
  permissionMode: string;
  allowDangerouslySkipPermissions: boolean;
  systemPromptConfig?: AgentSystemPromptConfig;
  optionsConfig?: AgentSessionOptionsConfig;
  managementInfo?: AgentManagementInfo;
  createdAt: string;
  updatedAt: string;
}

/**
 * Options for creating a new session.
 */
export interface CreateAgentSessionInput {
  engineName: AgentCliPreference;
  name?: string;
  model?: string;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  systemPromptConfig?: AgentSystemPromptConfig;
  optionsConfig?: AgentSessionOptionsConfig;
}

/**
 * Options for updating a session.
 */
export interface UpdateAgentSessionInput {
  name?: string | null;
  model?: string | null;
  permissionMode?: string | null;
  allowDangerouslySkipPermissions?: boolean | null;
  systemPromptConfig?: AgentSystemPromptConfig | null;
  optionsConfig?: AgentSessionOptionsConfig | null;
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
