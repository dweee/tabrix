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

  it('keeps the document locked and home content as the only scroll path', () => {
    expect(popupStyleSource).toContain('html {\n  width: 408px;\n  height: 760px;');
    expect(popupStyleSource).toContain('body {\n  margin: 0;\n  padding: 0;');
    expect(popupStyleSource).toContain('max-height: 760px;');
    expect(popupStyleSource).toContain('overscroll-behavior: none;');
    expect(popupStyleSource).toContain('#app {\n  width: 100%;\n  height: 100%;');
    expect(popupStyleSource).toContain('min-height: 0;');
    expect(popupStyleSource).toContain('max-height: 100%;');
    expect(popupSource).toContain('max-height: 100%;\n  overflow: hidden;');
    expect(popupSource).toContain('.home-view {\n  display: flex;\n  flex-direction: column;');
    expect(popupSource).toContain('height: 100%;\n  min-height: 0;\n  overflow: hidden;');
    expect(popupSource).toContain('flex: 1 1 auto;');
    expect(popupSource).toContain('min-height: 0;\n  padding: 8px 14px 12px;');
    expect(popupSource).toContain('scrollbar-width: thin');
    expect(popupSource).toContain('overflow-x: hidden');
    expect(popupSource).toContain('.content::-webkit-scrollbar-thumb');
    expect(popupSource).not.toContain('.content::-webkit-scrollbar {\n  display: none;');
    expect(popupSource).toContain('.mcp-config-content');
    expect(popupSource).toContain('overflow: visible;');
    expect(popupSource).toContain('max-height: none;');
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
});
