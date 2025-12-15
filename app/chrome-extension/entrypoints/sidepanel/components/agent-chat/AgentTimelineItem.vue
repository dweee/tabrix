<template>
  <div class="relative group/step">
    <!-- Timeline Node -->
    <span
      class="absolute top-1.5 w-2 h-2 rounded-full transition-colors"
      :style="{
        left: '-29px',
        backgroundColor: nodeColor,
        boxShadow: isStreaming ? 'var(--ac-timeline-node-pulse-shadow)' : 'none',
      }"
      :class="{ 'ac-pulse': isStreaming }"
    />

    <!-- Content based on item kind -->
    <TimelineNarrativeStep v-if="item.kind === 'assistant_text'" :item="item" />
    <TimelineToolCallStep v-else-if="item.kind === 'tool_use'" :item="item" />
    <TimelineToolResultCardStep v-else-if="item.kind === 'tool_result'" :item="item" />
    <TimelineStatusStep v-else-if="item.kind === 'status'" :item="item" />
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { TimelineItem } from '../../composables/useAgentThreads';
import TimelineNarrativeStep from './timeline/TimelineNarrativeStep.vue';
import TimelineToolCallStep from './timeline/TimelineToolCallStep.vue';
import TimelineToolResultCardStep from './timeline/TimelineToolResultCardStep.vue';
import TimelineStatusStep from './timeline/TimelineStatusStep.vue';

const props = defineProps<{
  item: TimelineItem;
}>();

const isStreaming = computed(() => {
  if (props.item.kind === 'assistant_text' || props.item.kind === 'tool_use') {
    return props.item.isStreaming;
  }
  if (props.item.kind === 'status') {
    return props.item.status === 'running' || props.item.status === 'starting';
  }
  return false;
});

const nodeColor = computed(() => {
  // Active/streaming node
  if (isStreaming.value) {
    return 'var(--ac-timeline-node-active)';
  }

  // Tool result nodes
  if (props.item.kind === 'tool_result') {
    if (props.item.isError) {
      return 'var(--ac-danger)';
    }
    return 'var(--ac-success)';
  }

  // Tool use / narrative nodes with accent
  if (props.item.kind === 'tool_use') {
    const tool = props.item.tool;
    if (tool.kind === 'edit') {
      return 'var(--ac-timeline-node-active)';
    }
  }

  // Assistant text with insight
  if (props.item.kind === 'assistant_text') {
    return 'var(--ac-timeline-node-active)';
  }

  // Default node color
  return 'var(--ac-timeline-node)';
});
</script>
