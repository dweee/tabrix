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
        class="flex items-center gap-1.5 text-xs px-2 py-1 truncate group ac-btn"
        :style="{
          fontFamily: 'var(--ac-font-mono)',
          color: 'var(--ac-text-muted)',
          borderRadius: 'var(--ac-radius-button)',
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
        class="flex items-center gap-1.5 text-xs px-2 py-1 truncate group ac-btn"
        :style="{
          fontFamily: 'var(--ac-font-mono)',
          color: 'var(--ac-text-subtle)',
          borderRadius: 'var(--ac-radius-button)',
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

      <!-- Theme & Settings Icon (Color Palette) -->
      <button
        class="p-1 ac-btn ac-hover-text"
        :style="{ color: 'var(--ac-text-subtle)', borderRadius: 'var(--ac-radius-button)' }"
        @click="$emit('toggle:settingsMenu')"
      >
        <svg
          class="w-5 h-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
          <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
          <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path
            d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"
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
