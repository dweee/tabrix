<template>
  <div
    v-if="open"
    class="fixed top-12 left-4 right-4 z-50 py-2 max-w-[calc(100%-2rem)]"
    :style="{
      backgroundColor: 'var(--ac-surface, #ffffff)',
      border: 'var(--ac-border-width, 1px) solid var(--ac-border, #e5e5e5)',
      borderRadius: 'var(--ac-radius-inner, 8px)',
      boxShadow: 'var(--ac-shadow-float, 0 4px 20px -2px rgba(0,0,0,0.1))',
    }"
  >
    <!-- Projects Section -->
    <div
      class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      :style="{ color: 'var(--ac-text-subtle, #a8a29e)' }"
    >
      Projects
    </div>

    <!-- Project List -->
    <div class="max-h-[200px] overflow-y-auto ac-scroll">
      <button
        v-for="p in projects"
        :key="p.id"
        class="w-full px-3 py-2 text-left text-sm flex items-center justify-between ac-menu-item"
        :style="{
          color:
            selectedProjectId === p.id ? 'var(--ac-accent, #c87941)' : 'var(--ac-text, #1a1a1a)',
        }"
        @click="$emit('project:select', p.id)"
      >
        <div class="flex-1 min-w-0">
          <div class="truncate">{{ p.name }}</div>
          <div
            class="text-[10px] truncate"
            :style="{
              fontFamily: 'var(--ac-font-mono, monospace)',
              color: 'var(--ac-text-subtle, #a8a29e)',
            }"
          >
            {{ p.rootPath }}
          </div>
        </div>
        <svg
          v-if="selectedProjectId === p.id"
          class="w-4 h-4 flex-shrink-0 ml-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M5 13l4 4L19 7"
          />
        </svg>
      </button>
    </div>

    <!-- New Project -->
    <button
      class="w-full px-3 py-2 text-left text-sm ac-menu-item"
      :style="{ color: 'var(--ac-link, #3b82f6)' }"
      :disabled="isPicking"
      @click="$emit('project:new')"
    >
      {{ isPicking ? 'Selecting...' : '+ New Project' }}
    </button>

    <!-- Divider -->
    <div
      class="my-2"
      :style="{ borderTop: 'var(--ac-border-width, 1px) solid var(--ac-border, #e5e5e5)' }"
    />

    <!-- CLI & Model Settings -->
    <div
      class="px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
      :style="{ color: 'var(--ac-text-subtle, #a8a29e)' }"
    >
      Settings
    </div>

    <!-- CLI Selection -->
    <div class="px-3 py-2 flex items-center gap-2">
      <span class="text-xs w-12" :style="{ color: 'var(--ac-text-muted, #6e6e6e)' }"> CLI </span>
      <select
        :value="selectedCli"
        class="flex-1 px-2 py-1 text-xs rounded"
        :style="{
          backgroundColor: 'var(--ac-surface-muted, #f2f0eb)',
          border: 'var(--ac-border-width, 1px) solid var(--ac-border, #e5e5e5)',
          color: 'var(--ac-text, #1a1a1a)',
          borderRadius: 'var(--ac-radius-button, 8px)',
        }"
        @change="handleCliChange"
      >
        <option value="">Auto</option>
        <option v-for="e in engines" :key="e.name" :value="e.name">
          {{ e.name }}
        </option>
      </select>
    </div>

    <!-- Model Selection -->
    <div class="px-3 py-2 flex items-center gap-2">
      <span class="text-xs w-12" :style="{ color: 'var(--ac-text-muted, #6e6e6e)' }"> Model </span>
      <select
        :value="normalizedModel"
        class="flex-1 px-2 py-1 text-xs rounded"
        :style="{
          backgroundColor: 'var(--ac-surface-muted, #f2f0eb)',
          border: 'var(--ac-border-width, 1px) solid var(--ac-border, #e5e5e5)',
          color: 'var(--ac-text, #1a1a1a)',
          borderRadius: 'var(--ac-radius-button, 8px)',
        }"
        :disabled="isModelDisabled"
        @change="handleModelChange"
      >
        <option value="">Default</option>
        <option v-for="m in availableModels" :key="m.id" :value="m.id">
          {{ m.name }}
        </option>
      </select>
    </div>

    <!-- CCR Option (Claude Code Router) - only shown when Claude CLI is selected -->
    <div v-if="showCcrOption" class="px-3 py-2 flex items-center gap-2">
      <span class="text-xs w-12" :style="{ color: 'var(--ac-text-muted, #6e6e6e)' }"> CCR </span>
      <label
        class="flex items-center gap-2 cursor-pointer"
        title="Use Claude Code Router for API routing"
      >
        <input
          type="checkbox"
          :checked="useCcr"
          class="w-4 h-4 rounded"
          :style="{
            accentColor: 'var(--ac-accent, #c87941)',
          }"
          @change="handleCcrChange"
        />
        <span class="text-xs" :style="{ color: 'var(--ac-text, #1a1a1a)' }">
          Use Claude Code Router
        </span>
      </label>
    </div>

    <!-- Root Override -->
    <div class="px-3 py-2 flex items-center gap-2">
      <span class="text-xs w-12" :style="{ color: 'var(--ac-text-muted, #6e6e6e)' }"> Root </span>
      <input
        :value="projectRootOverride"
        type="text"
        placeholder="Override workspace path"
        class="flex-1 px-2 py-1 text-xs rounded outline-none focus:ring-1 focus:ring-blue-500"
        :style="{
          fontFamily: 'var(--ac-font-mono, monospace)',
          backgroundColor: 'var(--ac-surface-muted, #f2f0eb)',
          border: 'var(--ac-border-width, 1px) solid var(--ac-border, #e5e5e5)',
          color: 'var(--ac-text, #1a1a1a)',
          borderRadius: 'var(--ac-radius-button, 8px)',
        }"
        @input="handleRootInput"
      />
    </div>

    <!-- Save Button -->
    <div class="px-3 py-2">
      <button
        class="w-full px-3 py-1.5 text-xs rounded transition-colors hover:opacity-90"
        :style="{
          backgroundColor: 'var(--ac-accent, #c87941)',
          color: 'var(--ac-accent-contrast, #ffffff)',
          borderRadius: 'var(--ac-radius-button, 8px)',
        }"
        :disabled="isSaving"
        @click="handleSave"
      >
        {{ isSaving ? 'Saving...' : 'Save Settings' }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="error" class="px-3 py-1 text-[10px]" :style="{ color: 'var(--ac-danger, #dc2626)' }">
      {{ error }}
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { AgentProject, AgentEngineInfo } from 'chrome-mcp-shared';
import {
  getModelsForCli,
  getDefaultModelForCli,
  type ModelDefinition,
} from '@/common/agent-models';

const props = defineProps<{
  open: boolean;
  projects: AgentProject[];
  selectedProjectId: string;
  selectedCli: string;
  model: string;
  useCcr: boolean;
  projectRootOverride: string;
  engines: AgentEngineInfo[];
  isPicking: boolean;
  isSaving: boolean;
  error: string | null;
}>();

const emit = defineEmits<{
  'project:select': [projectId: string];
  'project:new': [];
  'cli:update': [cli: string];
  'model:update': [model: string];
  'ccr:update': [useCcr: boolean];
  'root:update': [root: string];
  save: [];
}>();

// Get available models based on selected CLI
const availableModels = computed<ModelDefinition[]>(() => {
  return getModelsForCli(props.selectedCli);
});

// Normalize model value: ensure it exists in available models or fallback to empty
const normalizedModel = computed(() => {
  const trimmedModel = props.model.trim();
  if (!trimmedModel) return '';
  // No CLI selected = model disabled, show empty (server will use default)
  if (!props.selectedCli) return '';
  const models = availableModels.value;
  // If CLI selected but no models defined, fallback to empty
  if (models.length === 0) return '';
  // Check if current model is valid for selected CLI
  const isValid = models.some((m) => m.id === trimmedModel);
  return isValid ? trimmedModel : '';
});

// Check if Model select should be disabled
const isModelDisabled = computed(() => {
  return !props.selectedCli || availableModels.value.length === 0;
});

// Show CCR option only when Claude CLI is selected
const showCcrOption = computed(() => {
  return props.selectedCli === 'claude';
});

// Handle CLI change - auto-select default model for the CLI
function handleCliChange(event: Event): void {
  const cli = (event.target as HTMLSelectElement).value;
  emit('cli:update', cli);

  // Auto-select default model when CLI changes
  if (cli) {
    const defaultModel = getDefaultModelForCli(cli);
    // Validate default model exists in available models
    const models = getModelsForCli(cli);
    const isValidDefault = models.some((m) => m.id === defaultModel);
    emit('model:update', isValidDefault ? defaultModel : (models[0]?.id ?? ''));
  } else {
    emit('model:update', '');
  }

  // Reset CCR when switching away from Claude
  if (cli !== 'claude') {
    emit('ccr:update', false);
  }
}

function handleCcrChange(event: Event): void {
  emit('ccr:update', (event.target as HTMLInputElement).checked);
}

function handleModelChange(event: Event): void {
  emit('model:update', (event.target as HTMLSelectElement).value);
}

function handleRootInput(event: Event): void {
  emit('root:update', (event.target as HTMLInputElement).value);
}

function handleSave(): void {
  emit('save');
}
</script>
