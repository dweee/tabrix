<template>
  <div>
    <!-- Attachment Pills -->
    <div
      v-if="attachments.length > 0"
      class="flex gap-2 mb-2 overflow-x-auto ac-scroll-hidden px-1"
    >
      <div
        v-for="(attachment, index) in attachments"
        :key="index"
        class="flex items-center gap-1 px-2 py-0.5 text-[11px]"
        :style="{
          backgroundColor: 'var(--ac-surface)',
          border: 'var(--ac-border-width) solid var(--ac-border)',
          color: 'var(--ac-text-muted)',
          boxShadow: 'var(--ac-shadow-card)',
          borderRadius: 'var(--ac-radius-button)',
        }"
      >
        <svg
          class="w-3 h-3"
          :style="{ color: 'var(--ac-text-subtle)' }"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        <span class="truncate max-w-[100px]">{{ attachment.name }}</span>
        <button class="ml-1 hover:text-red-500" @click="$emit('attachment:remove', index)">
          &times;
        </button>
      </div>
    </div>

    <!-- Floating Input Card -->
    <div
      class="flex flex-col transition-all"
      :style="{
        backgroundColor: 'var(--ac-surface)',
        borderRadius: 'var(--ac-radius-card)',
        border: 'var(--ac-border-width) solid var(--ac-border)',
        boxShadow: 'var(--ac-shadow-float)',
      }"
    >
      <textarea
        ref="textareaRef"
        :value="modelValue"
        class="w-full bg-transparent border-none focus:ring-0 focus:outline-none resize-none p-3 text-sm min-h-[50px] max-h-[200px]"
        :style="{
          fontFamily: 'var(--ac-font-body)',
          color: 'var(--ac-text)',
        }"
        :placeholder="placeholder"
        rows="1"
        @input="handleInput"
        @keydown.enter.exact.prevent="handleEnter"
      />

      <div class="flex items-center justify-between px-2 pb-2">
        <!-- Left Tools -->
        <div class="flex items-center gap-1">
          <!-- Attach Button -->
          <button
            class="p-1.5 ac-btn"
            :style="{ color: 'var(--ac-text-subtle)', borderRadius: 'var(--ac-radius-button)' }"
            data-tooltip="Attach image"
            @click="$emit('attachment:add')"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>

          <!-- Model Selector (auto-width) -->
          <div v-if="availableModels.length > 0" class="relative" data-tooltip="Switch model">
            <!-- Hidden span to measure text width -->
            <span
              ref="modelWidthRef"
              class="invisible absolute whitespace-nowrap px-1.5 text-[10px]"
              :style="{ fontFamily: 'var(--ac-font-mono)' }"
            >
              {{ selectedModelName }}
            </span>
            <select
              :value="selectedModel"
              class="py-0.5 text-[10px] border-none bg-transparent cursor-pointer appearance-none pr-4 pl-1.5"
              :style="{
                color: 'var(--ac-text-muted)',
                fontFamily: 'var(--ac-font-mono)',
                width: modelSelectWidth,
                borderRadius: 'var(--ac-radius-button)',
              }"
              @change="handleModelChange"
            >
              <option v-for="m in availableModels" :key="m.id" :value="m.id">
                {{ m.name }}
              </option>
            </select>
            <!-- Dropdown arrow -->
            <svg
              class="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
              :style="{ color: 'var(--ac-text-subtle)' }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </div>

          <!-- Reasoning Effort (Codex only) -->
          <select
            v-if="
              isCodexEngine && availableReasoningEfforts && availableReasoningEfforts.length > 0
            "
            :value="reasoningEffort"
            class="px-1.5 py-0.5 text-[10px] border-none bg-transparent cursor-pointer"
            :style="{
              color: 'var(--ac-text-muted)',
              fontFamily: 'var(--ac-font-mono)',
              borderRadius: 'var(--ac-radius-button)',
            }"
            data-tooltip="Reasoning effort"
            @change="handleReasoningEffortChange"
          >
            <option v-for="effort in availableReasoningEfforts" :key="effort" :value="effort">
              {{ effort }}
            </option>
          </select>

          <!-- Reset Button -->
          <button
            class="p-1 ac-btn"
            :style="{ color: 'var(--ac-text-subtle)', borderRadius: 'var(--ac-radius-button)' }"
            data-tooltip="Reset conversation"
            @click="handleReset"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          <!-- Session Settings Button -->
          <button
            class="p-1 ac-btn"
            :style="{ color: 'var(--ac-text-subtle)', borderRadius: 'var(--ac-radius-button)' }"
            data-tooltip="Session settings"
            @click="handleOpenSettings"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"
              />
            </svg>
          </button>

          <!-- Status Text -->
          <div class="text-[11px] ml-1 flex items-center gap-1" :style="{ color: statusColor }">
            <span
              v-if="sending || isStreaming"
              class="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
              :style="{ backgroundColor: 'var(--ac-accent)' }"
            />
            {{ statusText }}
          </div>
        </div>

        <!-- Right Actions -->
        <div class="flex gap-2">
          <!-- Stop Button -->
          <button
            v-if="isStreaming && canCancel"
            class="px-3 py-1.5 text-xs transition-colors"
            :style="{
              backgroundColor: 'var(--ac-hover-bg)',
              color: 'var(--ac-text)',
              borderRadius: 'var(--ac-radius-button)',
            }"
            :disabled="cancelling"
            @click="$emit('cancel')"
          >
            {{ cancelling ? 'Stopping...' : 'Stop' }}
          </button>

          <!-- Send Button -->
          <button
            class="p-1.5 transition-colors"
            :style="{
              backgroundColor: canSend ? 'var(--ac-accent)' : 'var(--ac-surface-muted)',
              color: canSend ? 'var(--ac-accent-contrast)' : 'var(--ac-text-subtle)',
              borderRadius: 'var(--ac-radius-button)',
              cursor: canSend ? 'pointer' : 'not-allowed',
            }"
            :disabled="!canSend || sending"
            @click="handleSubmit"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 10l7-7m0 0l7 7m-7-7v18"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, nextTick } from 'vue';
import type { AgentAttachment, CodexReasoningEffort } from 'chrome-mcp-shared';
import type { ModelDefinition } from '@/common/agent-models';

const props = defineProps<{
  modelValue: string;
  attachments: AgentAttachment[];
  isStreaming: boolean;
  sending: boolean;
  cancelling: boolean;
  canCancel: boolean;
  canSend: boolean;
  placeholder?: string;
  // Model selection props
  engineName?: string;
  selectedModel: string;
  availableModels: ModelDefinition[];
  // Codex reasoning effort props
  reasoningEffort?: CodexReasoningEffort;
  availableReasoningEfforts?: readonly CodexReasoningEffort[];
}>();

const isCodexEngine = computed(() => props.engineName === 'codex');

// Model selector auto-width
const modelWidthRef = ref<HTMLSpanElement | null>(null);
const modelSelectWidth = ref('auto');

const selectedModelName = computed(() => {
  const model = props.availableModels.find((m) => m.id === props.selectedModel);
  return model?.name || props.selectedModel || '';
});

// Update width when model changes
watch(
  [selectedModelName, () => props.availableModels],
  async () => {
    await nextTick();
    if (modelWidthRef.value) {
      const width = modelWidthRef.value.offsetWidth;
      // Add extra space for dropdown arrow (16px)
      modelSelectWidth.value = `${width + 16}px`;
    }
  },
  { immediate: true },
);

const statusText = computed(() => {
  if (props.sending) return 'Sending...';
  if (props.isStreaming) return 'Agent is thinking...';
  return 'Ready';
});

const statusColor = computed(() => {
  if (props.sending || props.isStreaming) return 'var(--ac-accent)';
  return 'var(--ac-text-subtle)';
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  submit: [];
  cancel: [];
  'attachment:add': [];
  'attachment:remove': [index: number];
  'model:change': [modelId: string];
  'reasoning-effort:change': [effort: CodexReasoningEffort];
  'session:settings': [];
  'session:reset': [];
}>();

const textareaRef = ref<HTMLTextAreaElement | null>(null);

function handleInput(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value;
  emit('update:modelValue', value);
}

function handleEnter(): void {
  emit('submit');
}

function handleSubmit(): void {
  emit('submit');
}

function handleModelChange(event: Event): void {
  const modelId = (event.target as HTMLSelectElement).value;
  emit('model:change', modelId);
}

function handleReasoningEffortChange(event: Event): void {
  const effort = (event.target as HTMLSelectElement).value as CodexReasoningEffort;
  emit('reasoning-effort:change', effort);
}

function handleReset(): void {
  if (
    confirm(
      'Reset this conversation? All messages will be deleted and the session will start fresh.',
    )
  ) {
    emit('session:reset');
  }
}

function handleOpenSettings(): void {
  emit('session:settings');
}

// Expose ref for parent focus control
defineExpose({
  focus: () => textareaRef.value?.focus(),
});
</script>
