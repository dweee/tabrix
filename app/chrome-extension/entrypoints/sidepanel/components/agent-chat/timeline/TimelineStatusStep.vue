<template>
  <div class="flex items-center gap-2">
    <span
      class="text-[11px] font-bold uppercase tracking-wider w-8 flex-shrink-0"
      :style="{ color: 'var(--ac-text-subtle)' }"
    >
      Run
    </span>
    <span class="text-xs italic flex items-center gap-2" :style="{ color: 'var(--ac-text-muted)' }">
      {{ item.text || defaultText }}
    </span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from 'vue';
import type { TimelineItem } from '../../../composables/useAgentThreads';

const props = defineProps<{
  item: Extract<TimelineItem, { kind: 'status' }>;
}>();

const defaultText = computed(() => {
  switch (props.item.status) {
    case 'starting':
      return 'Starting...';
    case 'running':
      return 'Working...';
    case 'completed':
      return 'Done';
    case 'error':
      return 'Error';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Ready';
  }
});
</script>
