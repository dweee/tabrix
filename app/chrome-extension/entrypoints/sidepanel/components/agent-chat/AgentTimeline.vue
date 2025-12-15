<template>
  <div class="pl-1 space-y-3">
    <!-- Timeline container with left border -->
    <div
      class="relative pl-6 space-y-4 ml-1"
      :style="{
        borderLeft: 'var(--ac-timeline-line-width) solid var(--ac-timeline-line)',
      }"
    >
      <AgentTimelineItem v-for="item in items" :key="item.id" :item="item" />
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { TimelineItem, AgentThreadState } from '../../composables/useAgentThreads';
import AgentTimelineItem from './AgentTimelineItem.vue';

defineProps<{
  items: TimelineItem[];
  state: AgentThreadState;
}>();
</script>
