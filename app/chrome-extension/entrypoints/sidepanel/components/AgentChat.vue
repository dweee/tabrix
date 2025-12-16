<template>
  <div class="agent-theme relative h-full" :data-agent-theme="themeState.theme.value">
    <AgentChatShell :error-message="chat.errorMessage.value" :usage="chat.lastUsage.value">
      <!-- Header -->
      <template #header>
        <AgentTopBar
          :project-label="projectLabel"
          :session-label="sessionLabel"
          :connection-state="connectionState"
          @toggle:project-menu="toggleProjectMenu"
          @toggle:session-menu="toggleSessionMenu"
          @toggle:settings-menu="toggleSettingsMenu"
        />
      </template>

      <!-- Content -->
      <template #content>
        <AgentConversation :threads="threadState.threads.value" />
      </template>

      <!-- Composer -->
      <template #composer>
        <AgentComposer
          :model-value="chat.input.value"
          :attachments="attachments.attachments.value"
          :is-streaming="chat.isStreaming.value"
          :sending="chat.sending.value"
          :cancelling="chat.cancelling.value"
          :can-cancel="!!chat.currentRequestId.value"
          :can-send="chat.canSend.value"
          placeholder="Ask Claude to write code..."
          @update:model-value="chat.input.value = $event"
          @submit="handleSend"
          @cancel="chat.cancelCurrentRequest()"
          @attachment:add="handleAttachmentAdd"
          @attachment:remove="attachments.removeAttachment"
        />
      </template>
    </AgentChatShell>

    <!-- Click-outside handler for menus (z-40) -->
    <div
      v-if="projectMenuOpen || sessionMenuOpen || settingsMenuOpen"
      class="fixed inset-0 z-40"
      @click="closeMenus"
    />

    <!-- Dropdown menus (z-50, outside stacking context) -->
    <AgentProjectMenu
      :open="projectMenuOpen"
      :projects="projects.projects.value"
      :selected-project-id="projects.selectedProjectId.value"
      :selected-cli="selectedCli"
      :model="model"
      :use-ccr="useCcr"
      :project-root-override="projects.projectRootOverride.value"
      :engines="server.engines.value"
      :is-picking="isPickingDirectory"
      :is-saving="isSavingPreference"
      :error="projects.projectError.value"
      @project:select="handleProjectSelect"
      @project:new="handleNewProject"
      @cli:update="selectedCli = $event"
      @model:update="model = $event"
      @ccr:update="useCcr = $event"
      @root:update="projects.projectRootOverride.value = $event"
      @save="handleSaveSettings"
    />

    <AgentSessionMenu
      :open="sessionMenuOpen"
      :sessions="sessions.sessions.value"
      :selected-session-id="sessions.selectedSessionId.value"
      :is-loading="sessions.isLoadingSessions.value"
      :is-creating="sessions.isCreatingSession.value"
      :error="sessions.sessionError.value"
      @session:select="handleSessionSelect"
      @session:new="handleNewSession"
      @session:delete="handleDeleteSession"
      @session:rename="handleRenameSession"
      @session:settings="handleOpenSessionSettings"
      @session:reset="handleResetSession"
    />

    <AgentSettingsMenu
      :open="settingsMenuOpen"
      :theme="themeState.theme.value"
      @theme:set="handleThemeChange"
      @reconnect="handleReconnect"
    />

    <!-- Session Settings Panel -->
    <AgentSessionSettingsPanel
      :open="sessionSettingsOpen"
      :session="sessions.selectedSession.value"
      :management-info="currentManagementInfo"
      :is-loading="sessionSettingsLoading"
      :is-saving="sessionSettingsSaving"
      @close="handleCloseSessionSettings"
      @save="handleSaveSessionSettings"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import type { AgentStoredMessage, AgentMessage } from 'chrome-mcp-shared';

// Composables
import {
  useAgentServer,
  useAgentChat,
  useAgentProjects,
  useAgentSessions,
  useAttachments,
  useAgentTheme,
  useAgentThreads,
  type AgentThemeId,
} from '../composables';

// New UI Components
import {
  AgentChatShell,
  AgentTopBar,
  AgentComposer,
  AgentConversation,
  AgentProjectMenu,
  AgentSessionMenu,
  AgentSettingsMenu,
  AgentSessionSettingsPanel,
} from './agent-chat';
import type { SessionSettings } from './agent-chat/AgentSessionSettingsPanel.vue';

// Model utilities
import { getModelsForCli } from '@/common/agent-models';

// Local UI state
const selectedCli = ref('');
const model = ref('');
const useCcr = ref(false);
const isSavingPreference = ref(false);

/**
 * Get normalized model value that is valid for the current CLI.
 * Returns empty string if:
 * - No CLI selected (use server default)
 * - Model is invalid for selected CLI
 */
function getNormalizedModel(): string {
  const trimmedModel = model.value.trim();
  if (!trimmedModel) return '';
  // No CLI selected = don't override model, let server use default
  if (!selectedCli.value) return '';
  const models = getModelsForCli(selectedCli.value);
  if (models.length === 0) return ''; // Unknown CLI
  const isValid = models.some((m) => m.id === trimmedModel);
  return isValid ? trimmedModel : '';
}
const isPickingDirectory = ref(false);
const projectMenuOpen = ref(false);
const sessionMenuOpen = ref(false);
const settingsMenuOpen = ref(false);

// Session settings panel state
const sessionSettingsOpen = ref(false);
const sessionSettingsLoading = ref(false);
const sessionSettingsSaving = ref(false);
const currentManagementInfo = ref<import('chrome-mcp-shared').AgentManagementInfo | null>(null);

// Initialize composables - sessions must be declared first for sessionId access
const sessions = useAgentSessions({
  getServerPort: () => server.serverPort.value,
  ensureServer: () => server.ensureNativeServer(),
  onSessionChanged: (sessionId: string) => {
    // Reconnect SSE and reload history when session changes
    if (projects.selectedProjectId.value) {
      server.openEventSource();
      loadSessionHistory(sessionId);
    }
  },
});

const server = useAgentServer({
  getSessionId: () => sessions.selectedSessionId.value,
  onMessage: (event) => chat.handleRealtimeEvent(event),
  onError: (error) => {
    chat.errorMessage.value = error;
  },
});

const chat = useAgentChat({
  getServerPort: () => server.serverPort.value,
  getSessionId: () => sessions.selectedSessionId.value,
  ensureServer: () => server.ensureNativeServer(),
  openEventSource: () => server.openEventSource(),
});

const projects = useAgentProjects({
  getServerPort: () => server.serverPort.value,
  ensureServer: () => server.ensureNativeServer(),
  onHistoryLoaded: (messages: AgentStoredMessage[]) => {
    const converted = convertStoredMessages(messages);
    chat.setMessages(converted);
  },
});

const attachments = useAttachments();
const themeState = useAgentTheme();

// Thread state for grouping messages
const threadState = useAgentThreads({
  messages: chat.messages,
  isStreaming: chat.isStreaming,
  currentRequestId: chat.currentRequestId,
});

// Computed values
const projectLabel = computed(() => {
  const project = projects.selectedProject.value;
  return project?.name ?? 'No project';
});

const sessionLabel = computed(() => {
  const session = sessions.selectedSession.value;
  // Priority: preview (first user message) > name > 'New Session'
  return session?.preview || session?.name || 'New Session';
});

const connectionState = computed(() => {
  if (server.isServerReady.value) return 'ready';
  if (server.nativeConnected.value) return 'connecting';
  return 'disconnected';
});

// Load chat history for a specific session
async function loadSessionHistory(sessionId: string): Promise<void> {
  const serverPort = server.serverPort.value;
  if (!serverPort || !sessionId) return;

  try {
    const url = `http://127.0.0.1:${serverPort}/agent/sessions/${encodeURIComponent(sessionId)}/history`;
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const messages = data.messages || [];
      const converted = convertStoredMessages(messages);
      chat.setMessages(converted);
    } else {
      chat.setMessages([]);
    }
  } catch (error) {
    console.error('Failed to load session history:', error);
    chat.setMessages([]);
  }
}

// Convert stored messages to AgentMessage format
function convertStoredMessages(stored: AgentStoredMessage[]): AgentMessage[] {
  return stored.map((m) => ({
    id: m.id,
    sessionId: m.sessionId,
    role: m.role,
    content: m.content,
    messageType: m.messageType,
    cliSource: m.cliSource ?? undefined,
    requestId: m.requestId,
    createdAt: m.createdAt ?? new Date().toISOString(),
    metadata: m.metadata,
  }));
}

// Menu handlers
function toggleProjectMenu(): void {
  projectMenuOpen.value = !projectMenuOpen.value;
  if (projectMenuOpen.value) {
    sessionMenuOpen.value = false;
    settingsMenuOpen.value = false;
  }
}

function toggleSessionMenu(): void {
  sessionMenuOpen.value = !sessionMenuOpen.value;
  if (sessionMenuOpen.value) {
    projectMenuOpen.value = false;
    settingsMenuOpen.value = false;
  }
}

function toggleSettingsMenu(): void {
  settingsMenuOpen.value = !settingsMenuOpen.value;
  if (settingsMenuOpen.value) {
    projectMenuOpen.value = false;
    sessionMenuOpen.value = false;
  }
}

function closeMenus(): void {
  projectMenuOpen.value = false;
  sessionMenuOpen.value = false;
  settingsMenuOpen.value = false;
}

// Theme handler
async function handleThemeChange(theme: AgentThemeId): Promise<void> {
  await themeState.setTheme(theme);
  closeMenus();
}

// Server reconnect
async function handleReconnect(): Promise<void> {
  closeMenus();
  await server.reconnect();
}

// Session handlers
async function handleSessionSelect(sessionId: string): Promise<void> {
  await sessions.selectSession(sessionId);
  closeMenus();
}

async function handleNewSession(): Promise<void> {
  const projectId = projects.selectedProjectId.value;
  if (!projectId) return;

  const session = await sessions.createSession(projectId, {
    engineName: (selectedCli.value as 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm') || 'claude',
    name: `Session ${sessions.sessions.value.length + 1}`,
  });

  if (session) {
    chat.setMessages([]);
  }
  closeMenus();
}

async function handleDeleteSession(sessionId: string): Promise<void> {
  await sessions.deleteSession(sessionId);
}

async function handleRenameSession(sessionId: string, name: string): Promise<void> {
  await sessions.renameSession(sessionId, name);
}

async function handleOpenSessionSettings(sessionId: string): Promise<void> {
  closeMenus();
  sessionSettingsOpen.value = true;
  sessionSettingsLoading.value = true;
  currentManagementInfo.value = null;

  try {
    // Fetch Claude SDK management info if this is a Claude session
    const session = sessions.sessions.value.find((s) => s.id === sessionId);
    if (session?.engineName === 'claude') {
      const info = await sessions.fetchClaudeInfo(sessionId);
      if (info) {
        currentManagementInfo.value = info.managementInfo;
      }
    }
  } finally {
    sessionSettingsLoading.value = false;
  }
}

async function handleResetSession(sessionId: string): Promise<void> {
  closeMenus();
  const result = await sessions.resetConversation(sessionId);
  if (result) {
    chat.setMessages([]);
  }
}

function handleCloseSessionSettings(): void {
  sessionSettingsOpen.value = false;
  currentManagementInfo.value = null;
}

async function handleSaveSessionSettings(settings: SessionSettings): Promise<void> {
  const sessionId = sessions.selectedSessionId.value;
  if (!sessionId) return;

  sessionSettingsSaving.value = true;
  try {
    await sessions.updateSession(sessionId, {
      model: settings.model || null,
      permissionMode: settings.permissionMode || null,
      systemPromptConfig: settings.systemPromptConfig,
    });
    sessionSettingsOpen.value = false;
    currentManagementInfo.value = null;
  } finally {
    sessionSettingsSaving.value = false;
  }
}

// Project handlers
async function handleProjectSelect(projectId: string): Promise<void> {
  projects.selectedProjectId.value = projectId;
  await projects.handleProjectChanged();
  const project = projects.selectedProject.value;
  if (project) {
    selectedCli.value = project.preferredCli ?? '';
    model.value = project.selectedModel ?? '';
    useCcr.value = project.useCcr ?? false;
  }
  // Load sessions for the new project
  await sessions.ensureDefaultSession(
    projectId,
    (selectedCli.value as 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm') || 'claude',
  );
  closeMenus();
}

async function handleNewProject(): Promise<void> {
  isPickingDirectory.value = true;
  try {
    const path = await projects.pickDirectory();
    if (path) {
      // Extract directory name from path, handling trailing slashes
      const segments = path.split(/[/\\]/).filter((s) => s.length > 0);
      const dirName = segments.pop() || 'New Project';
      const project = await projects.createProjectFromPath(path, dirName);
      if (project) {
        selectedCli.value = project.preferredCli ?? '';
        model.value = project.selectedModel ?? '';
        useCcr.value = project.useCcr ?? false;
      }
    }
  } finally {
    isPickingDirectory.value = false;
    closeMenus();
  }
}

async function handleSaveSettings(): Promise<void> {
  if (!projects.selectedProject.value) return;

  isSavingPreference.value = true;
  try {
    // Use normalized model to ensure valid value is saved
    const normalizedModel = getNormalizedModel();
    // Only save CCR if Claude CLI is selected
    const normalizedCcr = selectedCli.value === 'claude' ? useCcr.value : false;
    await projects.saveProjectPreference(selectedCli.value, normalizedModel, normalizedCcr);
    await projects.saveProjectRootOverride();
    // Sync local state with normalized values
    model.value = normalizedModel;
    useCcr.value = normalizedCcr;
  } finally {
    isSavingPreference.value = false;
    closeMenus();
  }
}

// Attachment handlers
function handleAttachmentAdd(): void {
  // Create and click a hidden file input
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = (e) => attachments.handleFileSelect(e);
  input.click();
}

// Send handler
async function handleSend(): Promise<void> {
  const dbSessionId = sessions.selectedSessionId.value;
  if (!dbSessionId) {
    chat.errorMessage.value = 'No session selected.';
    return;
  }

  // Capture input before clearing for preview update
  const messageText = chat.input.value;

  chat.attachments.value = attachments.attachments.value;

  // Session-level config is now used by backend; no need to pass cliPreference/model
  await chat.send({
    projectId: projects.selectedProjectId.value || undefined,
    projectRoot: projects.projectRootOverride.value || undefined,
    dbSessionId,
  });

  // Update session preview with first user message (if not already set)
  sessions.updateSessionPreview(dbSessionId, messageText);

  attachments.clearAttachments();
}

// Initialize
onMounted(async () => {
  // Initialize theme
  await themeState.initTheme();

  // Initialize server
  await server.initialize();

  // Load project root override from storage
  await projects.loadProjectRootOverride();

  if (server.isServerReady.value) {
    // Ensure default project exists and load projects
    await projects.ensureDefaultProject();
    await projects.fetchProjects();

    // Load selected project or use first one
    await projects.loadSelectedProjectId();
    const hasValidSelection =
      projects.selectedProjectId.value &&
      projects.projects.value.some((p) => p.id === projects.selectedProjectId.value);

    if (!hasValidSelection && projects.projects.value.length > 0) {
      projects.selectedProjectId.value = projects.projects.value[0].id;
      await projects.saveSelectedProjectId();
    }

    // Load settings and sessions
    if (projects.selectedProjectId.value) {
      const project = projects.selectedProject.value;
      if (project) {
        selectedCli.value = project.preferredCli ?? '';
        model.value = project.selectedModel ?? '';
        useCcr.value = project.useCcr ?? false;
      }

      // Load sessions for the project and ensure a default session exists
      await sessions.loadSelectedSessionId();
      await sessions.ensureDefaultSession(
        projects.selectedProjectId.value,
        (selectedCli.value as 'claude' | 'codex' | 'cursor' | 'qwen' | 'glm') || 'claude',
      );

      // Open SSE connection and load history for the selected session
      if (sessions.selectedSessionId.value) {
        server.openEventSource();
        await loadSessionHistory(sessions.selectedSessionId.value);
      }
    }
  }
});

// Watch for server ready
watch(
  () => server.isServerReady.value,
  async (ready) => {
    if (ready && projects.projects.value.length === 0) {
      await projects.ensureDefaultProject();
      await projects.fetchProjects();

      const hasValidSelection =
        projects.selectedProjectId.value &&
        projects.projects.value.some((p) => p.id === projects.selectedProjectId.value);

      if (!hasValidSelection && projects.projects.value.length > 0) {
        projects.selectedProjectId.value = projects.projects.value[0].id;
        await projects.saveSelectedProjectId();
      }
    }
  },
);

// Close menus on Escape key
const handleEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeMenus();
  }
};

onMounted(() => {
  document.addEventListener('keydown', handleEscape);
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape);
});
</script>
