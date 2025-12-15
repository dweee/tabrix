/**
 * Drizzle ORM Schema for Agent Storage.
 *
 * Design principles:
 * - Type-safe database access
 * - Consistent with shared types (AgentProject, AgentStoredMessage)
 * - Proper indexes for common query patterns
 * - Foreign key constraints with cascade delete
 */
import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';

// ============================================================
// Projects Table
// ============================================================

export const projects = sqliteTable(
  'projects',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    description: text(),
    rootPath: text('root_path').notNull(),
    preferredCli: text('preferred_cli'),
    selectedModel: text('selected_model'),
    /**
     * Active Claude session ID (UUID format) for session resumption.
     * Captured from SDK's system/init message.
     */
    activeClaudeSessionId: text('active_claude_session_id'),
    /**
     * Whether to use Claude Code Router (CCR) for this project.
     * Stored as '1' (true) or '0'/null (false).
     */
    useCcr: text('use_ccr'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    lastActiveAt: text('last_active_at'),
  },
  (table) => ({
    lastActiveIdx: index('projects_last_active_idx').on(table.lastActiveAt),
  }),
);

// ============================================================
// Messages Table
// ============================================================

export const messages = sqliteTable(
  'messages',
  {
    id: text().primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    conversationId: text('conversation_id'),
    role: text().notNull(), // 'user' | 'assistant' | 'tool' | 'system'
    content: text().notNull(),
    messageType: text('message_type').notNull(), // 'chat' | 'tool_use' | 'tool_result' | 'status'
    metadata: text(), // JSON string
    cliSource: text('cli_source'),
    requestId: text('request_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => ({
    projectIdIdx: index('messages_project_id_idx').on(table.projectId),
    sessionIdIdx: index('messages_session_id_idx').on(table.sessionId),
    createdAtIdx: index('messages_created_at_idx').on(table.createdAt),
    requestIdIdx: index('messages_request_id_idx').on(table.requestId),
  }),
);

// ============================================================
// Type Inference Helpers
// ============================================================

export type ProjectRow = typeof projects.$inferSelect;
export type ProjectInsert = typeof projects.$inferInsert;
export type MessageRow = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
