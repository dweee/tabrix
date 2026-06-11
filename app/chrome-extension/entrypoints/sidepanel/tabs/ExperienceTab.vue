<template>
  <section class="mkep-tab" :data-agent-theme="agentTheme">
    <header class="mkep-tab__header">
      <h2 class="mkep-tab__title">Experience</h2>
      <p class="mkep-tab__subtitle"> Learnable, reusable action paths and recovery strategies. </p>
    </header>

    <div class="mkep-placeholder">
      <div class="mkep-placeholder__badge">Coming in Stage 4</div>
      <h3 class="mkep-placeholder__heading">Experience Deck</h3>
      <p class="mkep-placeholder__body">
        The Experience layer promotes high-quality Memory traces into reusable, token-efficient
        action recipes only after AI evaluation confirms that the step helped complete the user's
        goal.
      </p>
      <ul class="mkep-placeholder__points">
        <li>Promote only AI-approved Memory traces</li>
        <li>Track goal, score, freshness, and source trace</li>
        <li>Use recipes to reduce repeated page reads and trial-and-error</li>
      </ul>
      <p class="mkep-placeholder__hint">
        See <code>docs/MKEP_STAGE_3_PLUS_ROADMAP.md</code> § Stage 4.
      </p>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { onMounted } from 'vue';
import { useAgentTheme } from '../../shared/composables/usePopupTheme';

const { theme: agentTheme, initTheme } = useAgentTheme();

onMounted(() => {
  void initTheme();
});
</script>

<style scoped>
@import './mkep-tab.css';
</style>
