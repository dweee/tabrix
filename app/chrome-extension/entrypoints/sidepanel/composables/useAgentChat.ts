/**
 * Composable for managing Agent Chat state and messages.
 * Handles message sending, receiving, and cancellation.
 */
import { ref, computed } from 'vue';
import type {
  AgentMessage,
  AgentActRequest,
  AgentAttachment,
  RealtimeEvent,
  AgentStatusEvent,
  AgentCliPreference,
  AgentUsageStats,
} from 'chrome-mcp-shared';

export interface UseAgentChatOptions {
  getServerPort: () => number | null;
  getSessionId: () => string;
  ensureServer: () => Promise<boolean>;
  openEventSource: () => void;
}

export function useAgentChat(options: UseAgentChatOptions) {
  // State
  const messages = ref<AgentMessage[]>([]);
  const input = ref('');
  const sending = ref(false);
  const isStreaming = ref(false);
  const errorMessage = ref<string | null>(null);
  const currentRequestId = ref<string | null>(null);
  const cancelling = ref(false);
  const attachments = ref<AgentAttachment[]>([]);
  const lastUsage = ref<AgentUsageStats | null>(null);

  // Computed
  const canSend = computed(() => {
    return input.value.trim().length > 0 && !sending.value;
  });

  // Handle incoming realtime events
  function handleRealtimeEvent(event: RealtimeEvent): void {
    switch (event.type) {
      case 'message':
        handleMessageEvent(event.data);
        break;
      case 'status':
        handleStatusEvent(event.data);
        break;
      case 'error':
        errorMessage.value = event.error;
        isStreaming.value = false;
        break;
      case 'connected':
        console.log('[AgentChat] Connected to session:', event.data.sessionId);
        break;
      case 'heartbeat':
        // Heartbeat received, connection is alive
        break;
      case 'usage':
        lastUsage.value = event.data;
        break;
    }
  }

  // Handle message events
  function handleMessageEvent(msg: AgentMessage): void {
    const existingIndex = messages.value.findIndex((m) => m.id === msg.id);

    if (existingIndex >= 0) {
      // Update existing message (streaming update)
      messages.value[existingIndex] = msg;
    } else {
      // Add new message
      messages.value.push(msg);
    }

    // Update streaming state
    if (msg.role === 'assistant' || msg.role === 'tool') {
      isStreaming.value = msg.isStreaming === true && !msg.isFinal;
    }
  }

  // Handle status events
  function handleStatusEvent(status: AgentStatusEvent): void {
    switch (status.status) {
      case 'starting':
      case 'running':
        isStreaming.value = true;
        break;
      case 'completed':
      case 'error':
      case 'cancelled':
        isStreaming.value = false;
        currentRequestId.value = null;
        break;
    }
  }

  // Send message
  async function send(
    chatOptions: {
      cliPreference?: string;
      model?: string;
      projectId?: string;
      projectRoot?: string;
      dbSessionId?: string;
    } = {},
  ): Promise<void> {
    const trimmed = input.value.trim();
    if (!trimmed) return;

    const ready = await options.ensureServer();
    const serverPort = options.getServerPort();
    const sessionId = options.getSessionId();

    if (!ready || !serverPort) {
      errorMessage.value = 'Agent server is not available.';
      return;
    }

    // Ensure SSE is connected before sending
    options.openEventSource();

    // Create optimistic user message for immediate feedback
    const tempMessageId = `temp-${Date.now()}`;
    const optimisticMessage: AgentMessage = {
      id: tempMessageId,
      sessionId: sessionId,
      role: 'user',
      content: trimmed,
      messageType: 'chat',
      createdAt: new Date().toISOString(),
    };

    // Add user message immediately
    messages.value.push(optimisticMessage);

    const payload: AgentActRequest = {
      instruction: trimmed,
      cliPreference: chatOptions.cliPreference
        ? (chatOptions.cliPreference as AgentCliPreference)
        : undefined,
      model: chatOptions.model?.trim() || undefined,
      projectId: chatOptions.projectId || undefined,
      projectRoot: chatOptions.projectRoot?.trim() || undefined,
      dbSessionId: chatOptions.dbSessionId || undefined,
      attachments: attachments.value.length > 0 ? attachments.value : undefined,
    };

    sending.value = true;
    isStreaming.value = true; // Show streaming state while waiting for response
    errorMessage.value = null;

    // Clear input immediately for better UX
    const savedInput = input.value;
    input.value = '';
    const savedAttachments = [...attachments.value];
    attachments.value = [];

    try {
      const url = `http://127.0.0.1:${serverPort}/agent/chat/${encodeURIComponent(sessionId)}/act`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(text || `HTTP ${response.status}`);
      }

      const result = await response.json().catch(() => ({}));
      if (result.requestId) {
        currentRequestId.value = result.requestId;
        // Update optimistic message with real requestId
        const msgIndex = messages.value.findIndex((m) => m.id === tempMessageId);
        if (msgIndex >= 0) {
          messages.value[msgIndex].requestId = result.requestId;
        }
      }
    } catch (error: unknown) {
      console.error('Failed to send agent act request:', error);
      errorMessage.value =
        error instanceof Error ? error.message : 'Failed to send request to agent server.';
      // Restore input on error
      input.value = savedInput;
      attachments.value = savedAttachments;
      // Remove optimistic message on error
      const msgIndex = messages.value.findIndex((m) => m.id === tempMessageId);
      if (msgIndex >= 0) {
        messages.value.splice(msgIndex, 1);
      }
      isStreaming.value = false;
    } finally {
      sending.value = false;
    }
  }

  // Cancel current request
  async function cancelCurrentRequest(): Promise<void> {
    if (!currentRequestId.value) return;

    const serverPort = options.getServerPort();
    const sessionId = options.getSessionId();

    if (!serverPort) return;

    cancelling.value = true;
    try {
      const url = `http://127.0.0.1:${serverPort}/agent/chat/${encodeURIComponent(sessionId)}/cancel/${encodeURIComponent(currentRequestId.value)}`;

      await fetch(url, { method: 'DELETE' });
      currentRequestId.value = null;
      isStreaming.value = false;
    } catch (error) {
      console.error('Failed to cancel request:', error);
    } finally {
      cancelling.value = false;
    }
  }

  // Clear messages
  function clearMessages(): void {
    messages.value = [];
  }

  // Set messages (for loading history)
  function setMessages(newMessages: AgentMessage[]): void {
    messages.value = newMessages;
  }

  return {
    // State
    messages,
    input,
    sending,
    isStreaming,
    errorMessage,
    currentRequestId,
    cancelling,
    attachments,
    lastUsage,

    // Computed
    canSend,

    // Methods
    handleRealtimeEvent,
    send,
    cancelCurrentRequest,
    clearMessages,
    setMessages,
  };
}
