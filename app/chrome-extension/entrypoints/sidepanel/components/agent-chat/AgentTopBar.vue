<template>
  <div class="flex items-center justify-between w-full">
    <!-- Brand / Context -->
    <div class="flex items-center gap-3 overflow-hidden">
      <!-- Brand -->
      <h1
        class="text-lg font-medium tracking-tight flex-shrink-0"
        :style="{
          fontFamily: 'var(--ac-font-heading)',
          color: 'var(--ac-text)',
        }"
      >
        Claude Code
      </h1>

      <!-- Divider -->
      <div
        class="h-4 w-[1px] flex-shrink-0"
        :style="{ backgroundColor: 'var(--ac-border-strong)' }"
      />

      <!-- Project Breadcrumb -->
      <button
        class="flex items-center gap-1.5 text-xs px-2 py-1 rounded truncate group ac-btn"
        :style="{
          fontFamily: 'var(--ac-font-mono)',
          color: 'var(--ac-text-muted)',
        }"
        @click="$emit('toggle:projectMenu')"
      >
        <span class="truncate">{{ projectLabel }}</span>
        <svg
          class="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity"
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
      </button>

      <!-- Session Breadcrumb -->
      <div class="h-3 w-[1px] flex-shrink-0" :style="{ backgroundColor: 'var(--ac-border)' }" />
      <button
        class="flex items-center gap-1.5 text-xs px-2 py-1 rounded truncate group ac-btn"
        :style="{
          fontFamily: 'var(--ac-font-mono)',
          color: 'var(--ac-text-subtle)',
        }"
        @click="$emit('toggle:sessionMenu')"
      >
        <span class="truncate">{{ sessionLabel }}</span>
        <svg
          class="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity"
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
      </button>
    </div>

    <!-- Connection / Status / Settings -->
    <div class="flex items-center gap-3">
      <!-- Connection Indicator -->
      <div class="flex items-center gap-1.5" :title="connectionText">
        <span
          class="w-2 h-2 rounded-full"
          :style="{
            backgroundColor: connectionColor,
            boxShadow: connectionState === 'ready' ? `0 0 8px ${connectionColor}` : 'none',
          }"
        />
      </div>

      <!-- Settings Icon -->
      <button
        class="p-1 rounded ac-btn ac-hover-text"
        :style="{ color: 'var(--ac-text-subtle)' }"
        @click="$emit('toggle:settingsMenu')"
      >
        <svg
          class="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          <path
            d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"
          />
        </svg>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';

export type ConnectionState = 'ready' | 'connecting' | 'disconnected';

const props = defineProps<{
  projectLabel: string;
  sessionLabel: string;
  connectionState: ConnectionState;
}>();

defineEmits<{
  'toggle:projectMenu': [];
  'toggle:sessionMenu': [];
  'toggle:settingsMenu': [];
}>();

const connectionColor = computed(() => {
  switch (props.connectionState) {
    case 'ready':
      return 'var(--ac-success)';
    case 'connecting':
      return 'var(--ac-warning)';
    default:
      return 'var(--ac-text-subtle)';
  }
});

const connectionText = computed(() => {
  switch (props.connectionState) {
    case 'ready':
      return 'Connected';
    case 'connecting':
      return 'Connecting...';
    default:
      return 'Disconnected';
  }
});
</script>
