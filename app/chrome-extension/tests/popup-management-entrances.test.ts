import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const popupSource = readFileSync(resolve(process.cwd(), 'entrypoints/popup/App.vue'), 'utf8');
const popupStyleSource = readFileSync(
  resolve(process.cwd(), 'entrypoints/popup/style.css'),
  'utf8',
);

describe('popup management entrances layout', () => {
  it('keeps Token and MKE management below the MCP config and connection controls', () => {
    const managementIndex = popupSource.indexOf('popupManagementEntrancesTitle');
    const mcpConfigIndex = popupSource.indexOf('class="mcp-config-section"');
    const portIndex = popupSource.indexOf('class="port-section"');
    const connectIndex = popupSource.indexOf("'connect-button'");

    expect(mcpConfigIndex).toBeGreaterThanOrEqual(0);
    expect(portIndex).toBeGreaterThanOrEqual(0);
    expect(connectIndex).toBeGreaterThanOrEqual(0);
    expect(managementIndex).toBeGreaterThan(mcpConfigIndex);
    expect(managementIndex).toBeGreaterThan(portIndex);
    expect(managementIndex).toBeGreaterThan(connectIndex);
  });

  it('keeps the document inside Chrome action popup bounds with one content scroll path', () => {
    expect(popupStyleSource).toContain('html {\n  width: 408px;\n  height: 600px;');
    expect(popupStyleSource).toContain('body {\n  margin: 0;\n  padding: 0;');
    expect(popupStyleSource).toContain('height: 600px;');
    expect(popupStyleSource).toContain('max-height: 600px;');
    expect(popupStyleSource).not.toContain('height: 760px;');
    expect(popupStyleSource).not.toContain('max-height: 760px;');
    expect(popupStyleSource).not.toContain('height: min(760px, 100vh);');
    expect(popupStyleSource).not.toContain('max-height: 100vh;');
    expect(popupStyleSource).toContain('overscroll-behavior: none;');
    expect(popupStyleSource).toContain('#app {\n  width: 100%;\n  height: 100%;');
    expect(popupStyleSource).toContain('min-height: 0;');
    expect(popupStyleSource).toContain('max-height: 100%;');
    expect(popupSource).toContain('max-height: 100%;\n  overflow: hidden;');
    expect(popupSource).toContain('.home-view {\n  display: flex;\n  flex-direction: column;');
    expect(popupSource).toContain('height: 100%;\n  min-height: 0;\n  overflow: hidden;');
    expect(popupSource).toContain('flex: 1 1 auto;');
    expect(popupSource).toContain('min-height: 0;\n  padding: 8px 14px 14px;');
    expect(popupSource).toContain('scrollbar-width: thin');
    expect(popupSource).toContain('overflow-x: hidden');
    expect(popupSource).toContain('.content::-webkit-scrollbar-thumb');
    expect(popupSource).not.toContain('.content::-webkit-scrollbar {\n  display: none;');
    expect(popupSource).toContain('.mcp-config-content');
    expect(popupSource).toContain('max-height: 128px;');
    expect(popupSource).toContain('overflow: auto;');
    expect(popupSource).toContain('.footer {\n  flex-shrink: 0;');
  });

  it('keeps Token in the popup and opens MKE data in the sidepanel workspace', () => {
    expect(popupSource).toContain('@click="currentView = \'token-management\'"');
    expect(popupSource).toContain('@click="openSidepanelAndClose(\'mke-data\')"');
    expect(popupSource).toContain('path: `sidepanel.html?tab=${tab}`');
    expect(popupSource).toContain("getMessage('popupTokenManagementTitle')");
    expect(popupSource).toContain("getMessage('popupMkeDataManagementTitle')");
    expect(popupSource).not.toContain('MkeDataManagementPage');
    expect(popupSource).not.toContain('mke-data-management');
  });

  it('shows Token and MKE as sibling management entries instead of stacking MKE below the fold', () => {
    expect(popupSource).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(popupSource).toContain('min-height: 62px;');
    expect(popupSource).toContain('.management-entry-block .entry-arrow');
    expect(popupSource).toContain('display: none;');
    expect(popupSource).toContain('overflow: visible;');
    expect(popupSource).toContain('background: transparent;');
    expect(popupSource).toContain('border: 0;');
    expect(popupSource).toContain('padding: 0;');
  });

  it('keeps the config preview bounded and masks bearer tokens on screen', () => {
    expect(popupSource).toContain('{{ displayConfigJson }}');
    expect(popupSource).toContain('const displayConfigJson = computed(() => {');
    expect(popupSource).toContain('maskTokenForDisplay');
    expect(popupSource).toContain('activeConfigJson.value.replace(`Bearer ${token}`');
  });

  it('treats disconnect as a subdued dangerous action instead of the dominant CTA', () => {
    expect(popupSource).toContain('PowerIcon');
    expect(popupSource).toContain('.connect-button.is-disconnect');
    expect(popupSource).toContain('background: #fff1f2;');
    expect(popupSource).toContain('box-shadow: none;');
    expect(popupSource).not.toContain('background: linear-gradient(180deg, #fb7185');
  });
});
