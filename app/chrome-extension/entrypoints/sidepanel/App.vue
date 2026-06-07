<template>
  <div class="sidepanel-root" :data-agent-theme="agentTheme">
    <div class="sidepanel-body">
      <MkeDataTab />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { defineAsyncComponent, onMounted } from 'vue';
import { useAgentTheme } from '../shared/composables/usePopupTheme';

const MkeDataTab = defineAsyncComponent(() => import('./tabs/MkeDataTab.vue'));
const { theme: agentTheme, initTheme } = useAgentTheme();

onMounted(() => {
  void initTheme();
});
</script>

<style scoped>
.sidepanel-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  max-width: 100vw;
  min-width: 0;
  overflow: hidden;
  width: 100%;
  background: #f5f7fb;
  color: #1f2937;
  font-family:
    'Inter',
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}

.sidepanel-root *,
.sidepanel-root *::before,
.sidepanel-root *::after {
  box-sizing: border-box;
}

.sidepanel-root[data-agent-theme='dark-console'] {
  background:
    radial-gradient(circle at 12% -12%, rgba(34, 211, 238, 0.22), transparent 42%),
    radial-gradient(circle at 92% -20%, rgba(168, 85, 247, 0.14), transparent 40%),
    linear-gradient(160deg, #020817 0%, #051226 56%, #040b18 100%);
  color: #dbeafe;
}

.sidepanel-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  max-width: 100vw;
  overflow: hidden;
  background: transparent;
}

:global(html),
:global(body),
:global(#app) {
  margin: 0;
  max-width: 100vw;
  min-width: 0;
  overflow: hidden;
  width: 100%;
}
</style>
