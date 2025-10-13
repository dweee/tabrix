<template>
  <div
    :class="['workflow-node', selected ? 'selected' : '', `type-${data.node.type}`]"
    @click="onSelect()"
  >
    <div class="node-container">
      <div :class="['node-icon', `icon-${data.node.type}`]">
        <component :is="iconComp(data.node.type)" />
      </div>
      <div class="node-body">
        <div class="node-name">{{ data.node.name || getTypeLabel(data.node.type) }}</div>
        <div class="node-subtitle">{{ subtitle }}</div>
      </div>
    </div>

    <Handle
      type="target"
      :position="Position.Left"
      :class="['node-handle', hasIncoming ? 'connected' : 'unconnected']"
    />
    <Handle
      v-if="data.node.type !== 'if'"
      type="source"
      :position="Position.Right"
      :class="['node-handle', hasOutgoing ? 'connected' : 'unconnected']"
    />
  </div>
</template>

<script lang="ts" setup>
// Reusable card-like node for most operation nodes
import { computed } from 'vue';
import type { NodeBase, Edge as EdgeV2 } from '@/entrypoints/background/record-replay/types';
import { Handle, Position } from '@vue-flow/core';
import { iconComp, getTypeLabel, nodeSubtitle } from './node-util';

const props = defineProps<{
  id: string;
  data: { node: NodeBase; edges: EdgeV2[]; onSelect: (id: string) => void };
  selected?: boolean;
}>();

const subtitle = computed(() => nodeSubtitle(props.data.node));
const hasIncoming = computed(
  () => props.data.edges?.some?.((e) => e && e.to === props.data.node.id) || false,
);
const hasOutgoing = computed(
  () => props.data.edges?.some?.((e) => e && e.from === props.data.node.id) || false,
);

function onSelect() {
  // keep event as function to avoid emitting through VueFlow slots
  try {
    props.data.onSelect(props.id);
  } catch {}
}
</script>
