import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Sidepanel theme consistency', () => {
  const appSource = readSource('entrypoints/sidepanel/App.vue');
  const memorySource = readSource('entrypoints/sidepanel/tabs/MemoryTab.vue');
  const memoryStepsSource = readSource('entrypoints/sidepanel/tabs/MemorySessionSteps.vue');
  const knowledgeSource = readSource('entrypoints/sidepanel/tabs/KnowledgeTab.vue');
  const experienceSource = readSource('entrypoints/sidepanel/tabs/ExperienceTab.vue');
  const sharedTabCss = readSource('entrypoints/sidepanel/tabs/mkep-tab.css');

  it('propagates the saved extension theme through the sidepanel shell', () => {
    expect(appSource).toContain(':data-agent-theme="agentTheme"');
    expect(appSource).toContain('useAgentTheme');
    expect(appSource).toContain(".sidepanel-root[data-agent-theme='dark-console']");
    expect(appSource).toContain('<MkeDataTab />');
    expect(appSource).not.toContain('mkep-nav');
    expect(appSource).not.toContain('SidepanelTab');
  });

  it('keeps legacy MKE tabs from falling back to white cards in dark mode', () => {
    for (const source of [memorySource, knowledgeSource, experienceSource]) {
      expect(source).toContain(':data-agent-theme="agentTheme"');
      expect(source).toContain('useAgentTheme');
      expect(source).toContain('void initTheme()');
    }

    expect(sharedTabCss).toContain(".mkep-tab[data-agent-theme='dark-console']");
    expect(sharedTabCss).toContain(".mkep-tab[data-agent-theme='dark-console'] .mkep-placeholder");
    expect(sharedTabCss).toContain(".mkep-tab[data-agent-theme='dark-console'] .mkep-tab__title");
    expect(sharedTabCss).not.toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .mkep-placeholder",
    );
  });

  it('covers Memory rows and expanded step details with the same dark surface', () => {
    expect(memorySource).toContain('class="mkep-tab memory-tab"');
    expect(memorySource).toContain(".memory-tab[data-agent-theme='dark-console'] .memory-row");
    expect(memorySource).toContain(".memory-tab[data-agent-theme='dark-console'] .memory-search");
    expect(memorySource).toContain(
      ".memory-tab[data-agent-theme='dark-console'] .memory-row__title",
    );

    expect(memoryStepsSource).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .memory-steps",
    );
    expect(memoryStepsSource).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .memory-step",
    );
    expect(memoryStepsSource).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .memory-step__tool",
    );
  });
});
