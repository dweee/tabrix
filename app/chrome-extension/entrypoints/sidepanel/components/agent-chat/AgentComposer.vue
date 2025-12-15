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
        class="flex items-center gap-1 px-2 py-0.5 rounded text-[11px]"
        :style="{
          backgroundColor: 'var(--ac-surface)',
          border: 'var(--ac-border-width) solid var(--ac-border)',
          color: 'var(--ac-text-muted)',
          boxShadow: 'var(--ac-shadow-card)',
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
            class="p-1.5 rounded-lg ac-btn"
            :style="{ color: 'var(--ac-text-subtle)' }"
            title="Attach image"
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
            class="px-3 py-1.5 text-xs rounded transition-colors"
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
import { ref, computed } from 'vue';
import type { AgentAttachment } from 'chrome-mcp-shared';

const props = defineProps<{
  modelValue: string;
  attachments: AgentAttachment[];
  isStreaming: boolean;
  sending: boolean;
  cancelling: boolean;
  canCancel: boolean;
  canSend: boolean;
  placeholder?: string;
}>();

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

// Expose ref for parent focus control
defineExpose({
  focus: () => textareaRef.value?.focus(),
});
</script>
