<template>
  <div class="flex items-baseline gap-2">
    <!-- Label -->
    <span
      class="text-[11px] font-bold uppercase tracking-wider w-8 flex-shrink-0"
      :style="{
        color: labelColor,
      }"
    >
      {{ item.tool.label }}
    </span>

    <!-- Content based on tool kind -->
    <code
      v-if="item.tool.kind === 'grep' || item.tool.kind === 'read'"
      class="text-xs px-1.5 py-0.5 rounded cursor-pointer ac-chip-hover"
      :style="{
        fontFamily: 'var(--ac-font-mono)',
        backgroundColor: 'var(--ac-chip-bg)',
        color: 'var(--ac-chip-text)',
      }"
    >
      {{ item.tool.title }}
    </code>

    <span
      v-else
      class="text-xs"
      :style="{
        fontFamily: 'var(--ac-font-mono)',
        color: 'var(--ac-text-muted)',
      }"
    >
      {{ item.tool.title }}
    </span>

    <!-- Streaming indicator -->
    <span
      v-if="item.isStreaming"
      class="text-xs italic"
      :style="{ color: 'var(--ac-text-subtle)' }"
    >
      ...
    </span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { TimelineItem } from '../../../composables/useAgentThreads';

const props = defineProps<{
  item: Extract<TimelineItem, { kind: 'tool_use' }>;
}>();

const labelColor = computed(() => {
  if (props.item.tool.kind === 'edit') {
    return 'var(--ac-accent)';
  }
  return 'var(--ac-text-subtle)';
});
</script>
