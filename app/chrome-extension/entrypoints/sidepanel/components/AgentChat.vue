<template>
  <div class="agent-theme relative h-full" :data-agent-theme="themeState.theme.value">
    <AgentChatShell :error-message="chat.errorMessage.value">
      <!-- Header -->
      <template #header>
        <AgentTopBar
          :project-label="projectLabel"
          :connection-state="connectionState"
          @toggle:project-menu="toggleProjectMenu"
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
      v-if="projectMenuOpen || settingsMenuOpen"
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
      :project-root-override="projects.projectRootOverride.value"
      :engines="server.engines.value"
      :is-picking="isPickingDirectory"
      :is-saving="isSavingPreference"
      :error="projects.projectError.value"
      @project:select="handleProjectSelect"
      @project:new="handleNewProject"
      @cli:update="selectedCli = $event"
      @model:update="model = $event"
      @root:update="projects.projectRootOverride.value = $event"
      @save="handleSaveSettings"
    />

    <AgentSettingsMenu
      :open="settingsMenuOpen"
      :theme="themeState.theme.value"
      @theme:set="handleThemeChange"
      @reconnect="handleReconnect"
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
  AgentSettingsMenu,
} from './agent-chat';

// Local UI state
const selectedCli = ref('');
const model = ref('');
const isSavingPreference = ref(false);
const isPickingDirectory = ref(false);
const projectMenuOpen = ref(false);
const settingsMenuOpen = ref(false);

// Initialize composables
const server = useAgentServer({
  onMessage: (event) => chat.handleRealtimeEvent(event),
  onError: (error) => {
    chat.errorMessage.value = error;
  },
});

const chat = useAgentChat({
  getServerPort: () => server.serverPort.value,
  getSessionId: () => server.sessionId.value,
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

const connectionState = computed(() => {
  if (server.isServerReady.value) return 'ready';
  if (server.nativeConnected.value) return 'connecting';
  return 'disconnected';
});

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
  if (projectMenuOpen.value) settingsMenuOpen.value = false;
}

function toggleSettingsMenu(): void {
  settingsMenuOpen.value = !settingsMenuOpen.value;
  if (settingsMenuOpen.value) projectMenuOpen.value = false;
}

function closeMenus(): void {
  projectMenuOpen.value = false;
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

// Project handlers
async function handleProjectSelect(projectId: string): Promise<void> {
  projects.selectedProjectId.value = projectId;
  await projects.handleProjectChanged();
  const project = projects.selectedProject.value;
  if (project) {
    selectedCli.value = project.preferredCli ?? '';
    model.value = project.selectedModel ?? '';
  }
  closeMenus();
}

async function handleNewProject(): Promise<void> {
  isPickingDirectory.value = true;
  try {
    const path = await projects.pickDirectory();
    if (path) {
      const dirName = path.split(/[/\\]/).pop() || 'New Project';
      const project = await projects.createProjectFromPath(path, dirName);
      if (project) {
        selectedCli.value = project.preferredCli ?? '';
        model.value = project.selectedModel ?? '';
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
    await projects.saveProjectPreference(selectedCli.value, model.value);
    await projects.saveProjectRootOverride();
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
  chat.attachments.value = attachments.attachments.value;

  await chat.send({
    cliPreference: selectedCli.value || undefined,
    model: model.value || undefined,
    projectId: projects.selectedProjectId.value || undefined,
    projectRoot: projects.projectRootOverride.value || undefined,
  });

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

    // Load chat history and settings
    if (projects.selectedProjectId.value) {
      await projects.loadChatHistory(projects.selectedProjectId.value);
      const project = projects.selectedProject.value;
      if (project) {
        selectedCli.value = project.preferredCli ?? '';
        model.value = project.selectedModel ?? '';
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
