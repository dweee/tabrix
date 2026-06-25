import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Sidepanel theme consistency', () => {
  const appSource = readSource('entrypoints/sidepanel/App.vue');
  const mkeDataSource = readSource('entrypoints/sidepanel/tabs/MkeDataTab.vue');

  it('propagates the saved extension theme through the sidepanel shell', () => {
    expect(appSource).toContain(':data-popup-theme="popupTheme"');
    expect(appSource).toContain('usePopupTheme');
    expect(appSource).toContain(".sidepanel-root[data-popup-theme='dark-console']");
    expect(appSource).toContain('<MkeDataTab />');
    expect(appSource).not.toContain('mkep-nav');
    expect(appSource).not.toContain('SidepanelTab');
  });

  it('keeps the active MKE data surface theme-scoped', () => {
    expect(mkeDataSource).toContain(':class="`mke-data-tab--${popupTheme}`"');
    expect(mkeDataSource).toContain('usePopupTheme');
    expect(mkeDataSource).toContain('void initTheme()');
    expect(mkeDataSource).toContain('.mke-data-tab--dark-console');
    expect(mkeDataSource).toContain(
      ":global(.sidepanel-root[data-popup-theme='dark-console']) .mke-data-tab",
    );
  });
});
