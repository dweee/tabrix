import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AgentEngine, EngineExecutionContext, EngineInitOptions } from './types';
import type { AgentMessage, RealtimeEvent } from '../types';
import { detectCcr, validateCcrConfig } from '../ccr-detector';

/**
 * Tool action type for categorizing tool operations.
 */
type ToolAction = 'Edited' | 'Created' | 'Read' | 'Deleted' | 'Generated' | 'Searched' | 'Executed';

/**
 * Map of tool names to their corresponding actions.
 */
const TOOL_NAME_ACTION_MAP: Record<string, ToolAction> = {
  read: 'Read',
  read_file: 'Read',
  write: 'Created',
  write_file: 'Created',
  create_file: 'Created',
  edit: 'Edited',
  edit_file: 'Edited',
  apply_patch: 'Edited',
  patch_file: 'Edited',
  remove_file: 'Deleted',
  delete_file: 'Deleted',
  list_files: 'Searched',
  glob: 'Searched',
  glob_files: 'Searched',
  search_files: 'Searched',
  grep: 'Searched',
  bash: 'Executed',
  run: 'Executed',
  shell: 'Executed',
  todo_write: 'Generated',
  plan_write: 'Generated',
};

/**
 * ClaudeEngine integrates the Claude Agent SDK as an AgentEngine implementation.
 *
 * This engine uses the @anthropic-ai/claude-agent-sdk to interact with Claude,
 * streaming events back to the sidepanel UI via RealtimeEvent envelopes.
 */
export class ClaudeEngine implements AgentEngine {
  public readonly name = 'claude' as const;
  public readonly supportsMcp = true;

  /**
   * Maximum number of stderr lines to keep in memory.
   */
  private static readonly MAX_STDERR_LINES = 200;

  async initializeAndRun(options: EngineInitOptions, ctx: EngineExecutionContext): Promise<void> {
    const {
      sessionId,
      instruction,
      model,
      projectRoot,
      requestId,
      signal,
      attachments,
      projectId,
      resumeClaudeSessionId,
      useCcr,
    } = options;
    const repoPath = this.resolveRepoPath(projectRoot);

    // Check if already aborted
    if (signal?.aborted) {
      throw new Error('ClaudeEngine: execution was cancelled');
    }

    const normalizedInstruction = instruction.trim();
    if (!normalizedInstruction) {
      throw new Error('ClaudeEngine: instruction must not be empty');
    }

    // Dynamically import the Claude Agent SDK

    let query: (args: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<any>;
    try {
      // Dynamic import to avoid hard dependency - install @anthropic-ai/claude-agent-sdk to use this engine
      // Use string variable to bypass TypeScript module resolution
      const sdkModuleName = '@anthropic-ai/claude-agent-sdk';

      const sdk = await (Function(
        'moduleName',
        'return import(moduleName)',
      )(sdkModuleName) as Promise<any>);
      query = sdk.query;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `ClaudeEngine: Failed to load Claude Agent SDK. Please install @anthropic-ai/claude-agent-sdk. Error: ${message}`,
      );
    }

    // Resolve model
    const resolvedModel =
      model?.trim() || process.env.CLAUDE_DEFAULT_MODEL || 'claude-sonnet-4-20250514';

    // State management
    const stderrBuffer: string[] = [];
    let assistantBuffer = '';
    let assistantMessageId: string | null = null;
    let assistantCreatedAt: string | null = null;
    const streamedToolHashes = new Set<string>();

    /**
     * Emit assistant message to the stream.
     */
    const emitAssistant = (isFinal: boolean): void => {
      const content = assistantBuffer.trim();
      if (!content) return;

      if (!assistantMessageId) {
        assistantMessageId = randomUUID();
      }
      if (!assistantCreatedAt) {
        assistantCreatedAt = new Date().toISOString();
      }

      const message: AgentMessage = {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content,
        messageType: 'chat',
        cliSource: this.name,
        requestId,
        isStreaming: !isFinal,
        isFinal,
        createdAt: assistantCreatedAt,
      };

      ctx.emit({ type: 'message', data: message });
    };

    /**
     * Emit tool message with deduplication.
     */
    const dispatchToolMessage = (
      content: string,
      metadata: Record<string, unknown>,
      messageType: 'tool_use' | 'tool_result',
      isStreaming: boolean,
    ): void => {
      const trimmed = content.trim();
      if (!trimmed) return;

      const hash = this.encodeHash(
        `${messageType}:${trimmed}:${JSON.stringify(metadata)}:${sessionId}:${requestId || ''}`,
      ).slice(0, 16);
      if (streamedToolHashes.has(hash)) return;
      streamedToolHashes.add(hash);

      const message: AgentMessage = {
        id: randomUUID(),
        sessionId,
        role: 'tool',
        content: trimmed,
        messageType,
        cliSource: this.name,
        requestId,
        isStreaming,
        isFinal: !isStreaming,
        createdAt: new Date().toISOString(),
        metadata: { cli_type: 'claude', ...metadata },
      };

      ctx.emit({ type: 'message', data: message });
    };

    /**
     * Infer tool action from tool name.
     */
    const inferActionFromToolName = (toolName: unknown): ToolAction | undefined => {
      if (typeof toolName !== 'string') return undefined;
      const normalized = toolName.trim().toLowerCase();
      if (!normalized) return undefined;

      if (TOOL_NAME_ACTION_MAP[normalized]) {
        return TOOL_NAME_ACTION_MAP[normalized];
      }

      // Try suffix after colon (e.g., "mcp__server__tool" -> "tool")
      const suffix = normalized.split(':').pop() ?? normalized;
      if (suffix && TOOL_NAME_ACTION_MAP[suffix]) {
        return TOOL_NAME_ACTION_MAP[suffix];
      }

      // Infer from name patterns
      if (
        normalized.includes('edit') ||
        normalized.includes('modify') ||
        normalized.includes('patch')
      ) {
        return 'Edited';
      }
      if (normalized.includes('write') || normalized.includes('create')) {
        return 'Created';
      }
      if (normalized.includes('read') || normalized.includes('view')) {
        return 'Read';
      }
      if (normalized.includes('delete') || normalized.includes('remove')) {
        return 'Deleted';
      }
      if (
        normalized.includes('search') ||
        normalized.includes('find') ||
        normalized.includes('glob') ||
        normalized.includes('grep')
      ) {
        return 'Searched';
      }
      if (
        normalized.includes('bash') ||
        normalized.includes('shell') ||
        normalized.includes('exec')
      ) {
        return 'Executed';
      }
      if (normalized.includes('todo') || normalized.includes('plan')) {
        return 'Generated';
      }

      return undefined;
    };

    /**
     * Build tool metadata from content block.
     */
    const buildToolMetadata = (contentBlock: Record<string, unknown>): Record<string, unknown> => {
      const toolName = this.pickFirstString(contentBlock.name) || 'unknown';
      const toolId = this.pickFirstString(contentBlock.id);
      const input = contentBlock.input as Record<string, unknown> | undefined;
      const action = inferActionFromToolName(toolName);

      return {
        toolName,
        tool_name: toolName,
        toolId,
        action,
        input: input ? JSON.stringify(input).slice(0, 500) : undefined,
      };
    };

    try {
      // Use console.error for logging to avoid polluting stdout (Native Messaging protocol)
      console.error(`[ClaudeEngine] Starting query with model: ${resolvedModel}`);
      console.error(`[ClaudeEngine] Working directory: ${repoPath}`);

      // Process image attachments
      const imageFiles: string[] = [];
      if (attachments && attachments.length > 0) {
        for (const attachment of attachments) {
          if (attachment.type === 'image') {
            try {
              const tempFile = await this.writeAttachmentToTemp(attachment);
              imageFiles.push(tempFile);
            } catch (err) {
              console.error('[ClaudeEngine] Failed to write attachment to temp file:', err);
            }
          }
        }
      }

      // Start Claude Agent SDK query
      // Session resumption: if resumeClaudeSessionId is provided (from project's activeClaudeSessionId),
      // pass it as 'resume' to continue a previous Claude conversation.
      // If not provided, SDK will create a new session.

      // Build environment for Claude Code Router support
      // SDK treats options.env as a complete replacement, so we must merge with process.env
      // Reference: https://github.com/musistudio/claude-code-router/issues/855
      const claudeEnv = await this.buildClaudeEnv(useCcr);

      // Validate CCR configuration and emit friendly warning before calling into CCR
      // This prevents users from seeing cryptic "includes of undefined" errors
      if (useCcr) {
        await this.validateAndWarnCcrConfig(sessionId, requestId, ctx);
      }

      const queryOptions: Record<string, unknown> = {
        cwd: repoPath,
        additionalDirectories: [repoPath],
        model: resolvedModel,
        // Both permissionMode and allowDangerouslySkipPermissions are required for auto-approval
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        images: imageFiles.length > 0 ? imageFiles : undefined,
        executable: process.execPath,
        // Pass merged env to support Claude Code Router (CCR)
        // This allows users to set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN via:
        // 1. eval "$(ccr activate)" before launching Chrome
        // 2. Or setting env vars in shell profile
        env: claudeEnv,
        stderr: (data: string) => {
          const line = String(data).trimEnd();
          if (!line) return;
          if (stderrBuffer.length > ClaudeEngine.MAX_STDERR_LINES) {
            stderrBuffer.shift();
          }
          stderrBuffer.push(line);
          console.error(`[ClaudeEngine][stderr] ${line}`);
        },
      };

      // Add resume option if we have a valid Claude session ID
      if (resumeClaudeSessionId) {
        queryOptions.resume = resumeClaudeSessionId;
        console.error(`[ClaudeEngine] Resuming Claude session: ${resumeClaudeSessionId}`);
      }

      const response = query({
        prompt: normalizedInstruction,
        options: queryOptions,
      });

      // Process streaming response
      for await (const message of response) {
        // Check for cancellation before processing each message
        if (signal?.aborted) {
          console.error('[ClaudeEngine] Execution cancelled via abort signal');
          throw new Error('ClaudeEngine: execution was cancelled');
        }

        console.error('[ClaudeEngine] Message type:', message.type);

        if (message.type === 'stream_event') {
          const event = (message as unknown as { event?: Record<string, unknown> }).event ?? {};
          const eventType = this.pickFirstString(event.type);

          switch (eventType) {
            case 'message_start': {
              // Reset assistant state for new message
              assistantBuffer = '';
              assistantMessageId = randomUUID();
              assistantCreatedAt = new Date().toISOString();
              break;
            }

            case 'content_block_start': {
              const contentBlock = event.content_block as Record<string, unknown> | undefined;
              if (contentBlock && contentBlock.type === 'tool_use') {
                const metadata = buildToolMetadata(contentBlock);
                const toolName = this.pickFirstString(contentBlock.name) || 'tool';
                const input = contentBlock.input as Record<string, unknown> | undefined;

                // Build more informative content based on tool input
                let content = `Using tool: ${toolName}`;
                if (input) {
                  if (input.command) content = `Running: ${input.command}`;
                  else if (input.file_path) content = `Operating on: ${input.file_path}`;
                  else if (input.query) content = `Searching: ${input.query}`;
                }

                dispatchToolMessage(content, metadata, 'tool_use', true);
              } else if (contentBlock && contentBlock.type === 'tool_result') {
                // Handle tool_result in content_block_start
                const metadata = this.buildToolResultMetadata(contentBlock);
                const content = this.extractToolResultContent(contentBlock);
                const isError = contentBlock.is_error === true;

                dispatchToolMessage(
                  isError
                    ? `Error: ${content || 'Tool execution failed'}`
                    : content || 'Tool completed',
                  metadata,
                  'tool_result',
                  false,
                );
              }
              break;
            }

            case 'content_block_stop': {
              // Check if this block was a tool_result
              const contentBlock = event.content_block as Record<string, unknown> | undefined;
              if (contentBlock && contentBlock.type === 'tool_result') {
                const metadata = this.buildToolResultMetadata(contentBlock);
                const content = this.extractToolResultContent(contentBlock);
                const isError = contentBlock.is_error === true;

                dispatchToolMessage(
                  isError
                    ? `Error: ${content || 'Tool execution failed'}`
                    : content || 'Tool completed',
                  metadata,
                  'tool_result',
                  false,
                );
              }
              break;
            }

            case 'content_block_delta': {
              const delta = event.delta as Record<string, unknown> | string | undefined;
              let textChunk = '';

              if (typeof delta === 'string') {
                textChunk = delta;
              } else if (delta && typeof delta === 'object') {
                if (typeof delta.text === 'string') {
                  textChunk = delta.text;
                } else if (typeof delta.delta === 'string') {
                  textChunk = delta.delta;
                } else if (typeof delta.partial === 'string') {
                  textChunk = delta.partial;
                }
              }

              if (textChunk) {
                assistantBuffer += textChunk;
                emitAssistant(false);
              }
              break;
            }

            case 'message_stop':
            case 'message_delta': {
              // Emit final assistant message
              if (assistantBuffer.trim()) {
                emitAssistant(true);
              }
              break;
            }

            default:
              // Other stream events are ignored
              break;
          }
        } else if (message.type === 'assistant') {
          // Fallback for non-streaming assistant messages
          const content = this.extractMessageContent(message);
          if (content) {
            assistantBuffer = content;
            emitAssistant(true);
          }
        } else if (message.type === 'result') {
          // Final result - check for errors first
          const resultRecord = message as unknown as Record<string, unknown>;

          // Log full result for debugging
          console.error(`[ClaudeEngine] Result message: ${JSON.stringify(resultRecord, null, 2)}`);

          // Check if result contains errors (SDK puts error details here)
          // Note: is_error can be true even with empty errors array
          if (resultRecord.is_error) {
            const errors = resultRecord.errors as string[] | undefined;
            const resultText = resultRecord.result as string | undefined;
            const errorMsg = errors?.length
              ? errors.join('; ')
              : resultText || 'Unknown error from Claude Code';
            console.error(`[ClaudeEngine] Result error: ${errorMsg}`);

            // Check if this is a resume failure
            const isResumeFailure =
              errorMsg.includes('No conversation found') ||
              errorMsg.includes('Failed to resume session') ||
              errorMsg.includes('session ID');

            if (isResumeFailure && resumeClaudeSessionId) {
              // Clear the stored session ID so next request starts fresh
              if (ctx.persistClaudeSessionId && projectId) {
                try {
                  // Pass empty string to clear the session
                  await ctx.persistClaudeSessionId('');
                  console.error('[ClaudeEngine] Cleared invalid session ID');
                } catch {
                  // Ignore clear errors
                }
              }
              throw new Error(
                `Resume failed: ${errorMsg}. Session has been cleared - please retry.`,
              );
            }

            throw new Error(errorMsg);
          }

          // Extract content from successful result
          const resultContent = this.extractMessageContent(message);
          if (resultContent && resultContent !== assistantBuffer.trim()) {
            assistantBuffer = resultContent;
            emitAssistant(true);
          }
        } else if (message.type === 'system') {
          // Handle system messages - capture session_id from init message
          const record = message as unknown as Record<string, unknown>;
          if (record.subtype === 'init' && record.session_id) {
            const claudeSessionId = String(record.session_id);
            console.error(`[ClaudeEngine] Session initialized: ${claudeSessionId}`);

            // Persist the session ID if callback is provided and projectId exists
            if (ctx.persistClaudeSessionId && projectId) {
              try {
                await ctx.persistClaudeSessionId(claudeSessionId);
                console.error(`[ClaudeEngine] Session ID persisted for project: ${projectId}`);
              } catch (persistError) {
                // Log but don't fail the request - session persistence is best-effort
                console.error('[ClaudeEngine] Failed to persist session ID:', persistError);
              }
            }
          }
        }
      }

      // Ensure final message is emitted
      if (assistantBuffer.trim()) {
        emitAssistant(true);
      }

      console.error('[ClaudeEngine] Query completed successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Log full stderr for debugging
      console.error(`[ClaudeEngine] Error: ${message}`);
      if (stderrBuffer.length > 0) {
        console.error(`[ClaudeEngine] Stderr (${stderrBuffer.length} lines):`);
        stderrBuffer.slice(-10).forEach((line) => console.error(`  ${line}`));
      }

      // Check if this is a resume failure from stderr
      const stderrText = stderrBuffer.join('\n');
      const isResumeFailure =
        stderrText.includes('No conversation found') ||
        stderrText.includes('Failed to resume session') ||
        stderrText.includes('session ID') ||
        message.includes('Resume failed');

      if (isResumeFailure && resumeClaudeSessionId && ctx.persistClaudeSessionId && projectId) {
        // Clear the stored session ID so next request starts fresh
        try {
          await ctx.persistClaudeSessionId('');
          console.error('[ClaudeEngine] Cleared invalid session ID due to resume failure');
        } catch {
          // Ignore clear errors
        }
      }

      // Enhance error message for CCR-related errors
      const enhancedMessage = await this.enhanceCcrErrorMessage(message, stderrText);

      // Classify errors for better UX
      const errorMessage = this.classifyError(enhancedMessage, stderrBuffer);
      throw new Error(`ClaudeEngine: ${errorMessage}`);
    }
  }

  /**
   * Build environment variables for Claude Code.
   * Supports Claude Code Router (CCR) when useCcr is true:
   * 1. Auto-detecting CCR from config file (~/.claude-code-router/config.json)
   * 2. Passing through env vars if already set (via `eval "$(ccr activate)"`)
   *
   * SDK treats options.env as a complete replacement (not merged with process.env),
   * so we must explicitly include all necessary variables.
   *
   * @param useCcr - Whether CCR is enabled for this project. When false/undefined, CCR detection is skipped.
   */
  private async buildClaudeEnv(useCcr?: boolean): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Ensure Node.js bin directory is in PATH (for child processes)
    const nodeBinDir = path.dirname(process.execPath);
    const currentPath = env.PATH || env.Path || '';
    if (!currentPath.includes(nodeBinDir)) {
      env.PATH = [nodeBinDir, currentPath].filter(Boolean).join(path.delimiter);
    }

    // Only detect CCR if explicitly enabled for this project
    if (useCcr && !env.ANTHROPIC_BASE_URL) {
      try {
        const ccrResult = await detectCcr();
        if (ccrResult.detected && ccrResult.baseUrl && ccrResult.authToken) {
          env.ANTHROPIC_BASE_URL = ccrResult.baseUrl;
          env.ANTHROPIC_AUTH_TOKEN = ccrResult.authToken;
          console.error(`[ClaudeEngine] CCR auto-detected (source: ${ccrResult.source})`);
        } else if (ccrResult.error) {
          console.error(`[ClaudeEngine] CCR detection failed: ${ccrResult.error}`);
        } else {
          console.error(
            '[ClaudeEngine] CCR enabled but not detected (config not found or service not running)',
          );
        }
      } catch (err) {
        // CCR detection is best-effort, don't fail the request
        console.error(`[ClaudeEngine] CCR detection error: ${err}`);
      }
    }

    // Log CCR-related env vars for debugging (without exposing full token)
    const baseUrl = env.ANTHROPIC_BASE_URL;
    const authToken = env.ANTHROPIC_AUTH_TOKEN;
    if (baseUrl) {
      console.error(`[ClaudeEngine] Using ANTHROPIC_BASE_URL: ${baseUrl}`);
    }
    if (authToken) {
      const preview =
        authToken.length > 8 ? `${authToken.slice(0, 4)}...${authToken.slice(-4)}` : '****';
      console.error(`[ClaudeEngine] Using ANTHROPIC_AUTH_TOKEN: ${preview}`);
    }

    return env;
  }

  /**
   * Resolve project root path.
   */
  private resolveRepoPath(projectRoot?: string): string {
    const base =
      (projectRoot && projectRoot.trim()) || process.env.MCP_AGENT_PROJECT_ROOT || process.cwd();
    return path.resolve(base);
  }

  /**
   * Pick first string value from unknown input.
   */
  private pickFirstString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const candidate = this.pickFirstString(entry);
        if (candidate) return candidate;
      }
      return undefined;
    }
    return undefined;
  }

  /**
   * Extract content from SDK message.
   */
  private extractMessageContent(message: unknown): string | undefined {
    if (!message || typeof message !== 'object') return undefined;
    const record = message as Record<string, unknown>;

    // Try common content fields
    if (typeof record.content === 'string') {
      return record.content.trim();
    }
    if (typeof record.text === 'string') {
      return record.text.trim();
    }
    if (Array.isArray(record.content)) {
      const textParts: string[] = [];
      for (const part of record.content) {
        if (part && typeof part === 'object' && (part as Record<string, unknown>).type === 'text') {
          const text = (part as Record<string, unknown>).text;
          if (typeof text === 'string') {
            textParts.push(text);
          }
        }
      }
      if (textParts.length > 0) {
        return textParts.join('').trim();
      }
    }

    return undefined;
  }

  /**
   * Format error message for user display.
   * Preserves the original error message and only appends stderr context if useful.
   */
  private classifyError(message: string, stderrBuffer: string[]): string {
    // Always preserve the original error message
    // Only append stderr context if it contains useful information beyond the spawn line
    const usefulStderr = stderrBuffer.filter(
      (line) => !line.includes('Spawning Claude Code:') && line.trim().length > 0,
    );

    if (usefulStderr.length > 0) {
      const lastLines = usefulStderr.slice(-3).join(' | ');
      return `${message} (stderr: ${lastLines})`;
    }

    return message;
  }

  /**
   * Validate CCR configuration and emit a warning message if issues are found.
   * This is a best-effort check to provide actionable guidance before CCR crashes.
   */
  private async validateAndWarnCcrConfig(
    sessionId: string,
    requestId: string | undefined,
    ctx: EngineExecutionContext,
  ): Promise<void> {
    try {
      const validation = await validateCcrConfig();

      if (!validation.checked || validation.valid) {
        return;
      }

      // Build user-friendly warning message
      const lines = [
        '⚠️ Claude Code Router (CCR) configuration issue detected:',
        validation.issue ?? 'CCR configuration appears invalid.',
        '',
        validation.suggestion ?? 'Please check your CCR configuration.',
      ];

      if (validation.suggestedFix) {
        lines.push('', `Suggested fix: Router.default = "${validation.suggestedFix}"`);
      }

      const content = lines.join('\n');
      console.error(`[ClaudeEngine] CCR config warning: ${validation.issue}`);

      const warningMessage: AgentMessage = {
        id: randomUUID(),
        sessionId,
        role: 'system',
        content,
        messageType: 'status',
        cliSource: this.name,
        requestId,
        isStreaming: false,
        isFinal: true,
        createdAt: new Date().toISOString(),
        metadata: {
          cli_type: 'claude',
          warning_type: 'ccr_config',
          ccr_issue: validation.issue,
          ccr_suggested_fix: validation.suggestedFix,
        },
      };

      ctx.emit({ type: 'message', data: warningMessage });
    } catch (err) {
      // CCR config validation is best-effort, don't fail the request
      console.error('[ClaudeEngine] CCR config validation error:', err);
    }
  }

  /**
   * Enhance error messages for CCR-related errors.
   * Detects the common "includes of undefined" crash and provides actionable guidance.
   */
  private async enhanceCcrErrorMessage(message: string, stderrText: string): Promise<string> {
    const combinedText = `${message}\n${stderrText}`;

    // Detect CCR's "includes of undefined" error pattern
    const isCcrIncludesError =
      combinedText.includes('claude-code-router') &&
      (combinedText.includes("reading 'includes'") || combinedText.includes('transformRequestIn'));

    if (!isCcrIncludesError) {
      return message;
    }

    // Try to get specific fix suggestion from CCR config
    let suggestion =
      'Edit ~/.claude-code-router/config.json and set Router.default to "provider,model" format (e.g., "venus,claude-4-5-sonnet-20250929"), then restart CCR.';

    try {
      const validation = await validateCcrConfig();
      if (validation.checked && !validation.valid && validation.suggestion) {
        suggestion = validation.suggestion;
      }
    } catch {
      // Use default suggestion if validation fails
    }

    return [
      message,
      '',
      '💡 CCR Configuration Issue Detected:',
      'This error is commonly caused by Router.default being set to only a provider name',
      '(e.g., "venus") instead of the required "provider,model" format.',
      '',
      `Fix: ${suggestion}`,
    ].join('\n');
  }

  /**
   * Build metadata for tool result events.
   */
  private buildToolResultMetadata(block: Record<string, unknown>): Record<string, unknown> {
    const toolUseId = this.pickFirstString(block.tool_use_id);
    const isError = block.is_error === true;

    return {
      toolUseId,
      is_error: isError,
      status: isError ? 'failed' : 'completed',
      cli_type: 'claude',
    };
  }

  /**
   * Extract content from a tool_result block.
   */
  private extractToolResultContent(block: Record<string, unknown>): string | undefined {
    const content = block.content;
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter((c) => c && typeof c === 'object' && (c as Record<string, unknown>).type === 'text')
        .map((c) => (c as Record<string, unknown>).text as string)
        .filter(Boolean);
      if (textParts.length > 0) {
        return textParts.join('\n');
      }
    }
    return undefined;
  }

  /**
   * Encode string to base64 for hashing.
   */
  private encodeHash(value: string): string {
    return Buffer.from(value, 'utf-8').toString('base64');
  }

  /**
   * Write an attachment to a temporary file and return its path.
   */
  private async writeAttachmentToTemp(attachment: {
    type: string;
    name: string;
    mimeType: string;
    dataBase64: string;
  }): Promise<string> {
    const os = await import('node:os');
    const fs = await import('node:fs/promises');

    const tempDir = os.tmpdir();
    const ext = attachment.mimeType.split('/')[1] || 'bin';
    const sanitizedName = attachment.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const fileName = `mcp-agent-${Date.now()}-${sanitizedName}.${ext}`;
    const filePath = path.join(tempDir, fileName);

    const buffer = Buffer.from(attachment.dataBase64, 'base64');
    await fs.writeFile(filePath, buffer);

    return filePath;
  }
}
