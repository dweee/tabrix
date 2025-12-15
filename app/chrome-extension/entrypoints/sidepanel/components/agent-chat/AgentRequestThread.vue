<template>
  <div class="group">
    <!-- User Query Header -->
    <div class="mb-4 flex justify-between items-start">
      <h2
        class="text-lg font-medium leading-snug"
        :style="{
          color: 'var(--ac-text)',
        }"
      >
        {{ thread.title }}
      </h2>

      <!-- Edit button (placeholder, appears on hover) -->
      <button
        class="opacity-0 group-hover:opacity-100 transition-opacity p-1"
        :style="{ color: 'var(--ac-text-subtle)' }"
        title="Edit (coming soon)"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
          />
        </svg>
      </button>
    </div>

    <!-- Timeline -->
    <AgentTimeline :items="thread.items" :state="thread.state" />
  </div>
</template>

<script lang="ts" setup>
import type { AgentThread } from '../../composables/useAgentThreads';
import AgentTimeline from './AgentTimeline.vue';

defineProps<{
  thread: AgentThread;
}>();
</script>
