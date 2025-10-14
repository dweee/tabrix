<template>
  <div class="form-section">
    <div class="form-group">
      <label class="form-label">触发方式</label>
      <select class="form-select" v-model="(node as any).config.type">
        <option value="manual">手动</option>
        <option value="schedule">定时</option>
      </select>
    </div>
    <div v-if="(node as any).config.type === 'schedule'" class="form-group">
      <label class="form-label">Cron 表达式（可选）</label>
      <input class="form-input" v-model="(node as any).config.cron" placeholder="* * * * *" />
    </div>
    <div class="form-group">
      <label class="form-label">描述（可选）</label>
      <input
        class="form-input"
        v-model="(node as any).config.description"
        placeholder="说明此工作流的触发条件"
      />
    </div>
    <div class="text-xs text-slate-500" style="padding: 0 20px"
      >触发器仅用于画布起点提示，不会导出为可执行步骤。</div
    >
  </div>
</template>

<script lang="ts" setup>
/* eslint-disable vue/no-mutating-props */
import type { NodeBase } from '@/entrypoints/background/record-replay/types';
defineProps<{ node: NodeBase }>();
</script>

<style scoped></style>
