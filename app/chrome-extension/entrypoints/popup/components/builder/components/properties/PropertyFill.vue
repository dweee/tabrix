<template>
  <div>
    <SelectorEditor :node="node" :allowPick="true" />
    <div class="form-section">
      <div class="form-group" data-field="fill.value">
        <label class="form-label">输入值</label>
        <input
          class="form-input"
          v-model="(node as any).config.value"
          placeholder="支持 {变量名} 格式"
        />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/* eslint-disable vue/no-mutating-props */
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
import SelectorEditor from './SelectorEditor.vue';

defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
