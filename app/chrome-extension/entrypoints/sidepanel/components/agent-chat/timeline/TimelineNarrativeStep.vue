<template>
  <div class="py-1">
    <p
      class="text-sm leading-relaxed"
      :style="{
        color: 'var(--ac-text)',
        fontFamily: 'var(--ac-font-body)',
      }"
    >
      {{ item.text }}
    </p>
    <span
      v-if="item.isStreaming"
      class="inline-block w-1.5 h-4 ml-0.5 ac-pulse"
      :style="{ backgroundColor: 'var(--ac-accent)' }"
    />
  </div>
</template>

<script lang="ts" setup>
import type { TimelineItem } from '../../../composables/useAgentThreads';

defineProps<{
  item: Extract<TimelineItem, { kind: 'assistant_text' }>;
}>();
</script>
