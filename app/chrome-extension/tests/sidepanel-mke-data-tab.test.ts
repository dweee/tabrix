import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Sidepanel MKE data tab', () => {
  const appSource = readSource('entrypoints/sidepanel/App.vue');
  const tabSource = readSource('entrypoints/sidepanel/tabs/MkeDataTab.vue');

  it('exposes one user-facing sidepanel data console instead of engineering module tabs', () => {
    expect(appSource).toContain(
      "const MkeDataTab = defineAsyncComponent(() => import('./tabs/MkeDataTab.vue'))",
    );
    expect(appSource).toContain('<MkeDataTab />');
    expect(appSource).not.toContain('type SidepanelTab');
    expect(appSource).not.toContain('const tabs');
    expect(appSource).not.toContain('mkep-nav');
    expect(appSource).not.toContain("activeTab === 'memory'");
    expect(appSource).not.toContain("activeTab === 'execution'");
  });

  it('queries all three MKE tables through the existing read-only memory API client', () => {
    expect(tabSource).toContain('fetchMkeMemoryTraces');
    expect(tabSource).toContain('fetchMkeKnowledgeModels');
    expect(tabSource).toContain('fetchMkeExperienceRecipes');
    expect(tabSource).toContain("type ActiveTab = 'memory' | 'knowledge' | 'experience'");
    expect(tabSource).toContain("label: '记忆库'");
    expect(tabSource).toContain("label: '知识库'");
    expect(tabSource).toContain("label: '经验库'");
    expect(tabSource).not.toContain('MKE Workspace');
    expect(tabSource).not.toContain('数据控制台 / Data Console');
  });

  it('keeps the user task focused on three compact data lists', () => {
    expect(tabSource).toContain('mke-shell');
    expect(tabSource).toContain('mke-controls');
    expect(tabSource).not.toContain('mke-sticky-tools');
    expect(tabSource).not.toContain('mke-dashboard');
    expect(tabSource).not.toContain('mkep-tab__header');
    expect(tabSource).not.toContain('mkep-tab__subtitle');
    expect(tabSource).toContain('mke-data-body');
    expect(tabSource).toContain('type="search"');
    expect(tabSource).toContain('搜索当前列表');
    expect(tabSource).toContain('mke-search-icon');
    expect(tabSource).toContain('搜索任务、工具、页面、状态');
    expect(tabSource).toContain('mke-refresh-button');
    expect(tabSource).toContain('mke-record__meta-line');
    expect(tabSource).not.toContain('{{ filteredRows.length }}');
    expect(tabSource).not.toContain('{{ activeTotal }} 条');
    expect(tabSource).not.toContain('mke-list-status');
    expect(tabSource).toContain('搜索仅覆盖已加载记录');
    expect(tabSource).toContain('<summary>详情 / JSON</summary>');
    expect(tabSource).not.toContain('查看详情和完整 JSON');
    expect(tabSource).toContain('mke-copy-button');
    expect(tabSource).toContain("{{ copiedRecordId === row.id ? '已复制' : '复制' }}");
    expect(tabSource).toContain('加载更多');
    expect(tabSource).toContain('grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));');
    expect(tabSource).toContain('grid-template-columns: minmax(180px, 1fr) auto;');
    expect(tabSource).not.toContain('mke-meta');
  });

  it('translates technical trace records into readable product labels', () => {
    expect(tabSource).toContain("chrome_screenshot: '截图留证 / Screenshot'");
    expect(tabSource).toContain("chrome_navigate: '打开页面 / Navigate'");
    expect(tabSource).toContain("chrome_click_element: '点击页面元素 / Click'");
    expect(tabSource).toContain("chrome_history: '读取历史记录 / History'");
    expect(tabSource).toContain(
      "return '当前标签不是可点击的普通网页 / Current tab is not a clickable web page'",
    );
    expect(tabSource).toContain("return '通过 / Pass'");
    expect(tabSource).toContain("return '待验证 / Pending'");
  });

  it('keeps one primary status and avoids duplicated status/time fields in the fact strip', () => {
    expect(tabSource).toContain('<h3>{{ row.title }}</h3>');
    expect(tabSource).toContain('{{ row.metaLine }}');
    expect(tabSource).toContain('<span class="mke-status"');
    expect(tabSource).toContain(
      "['Tool result / 工具结果', formatBoolean(trace.toolSuccess) ?? '待验证']",
    );
    expect(tabSource).toContain("['Latency / 耗时', formatDuration(trace.durationMs)]");
    expect(tabSource).toContain("['Context / 上下文', formatTraceContext(trace)]");
    expect(tabSource).not.toContain(
      "['Business / 业务结果', formatBusinessStatus(trace.businessSuccess)]",
    );
    expect(tabSource).not.toContain("['Time / 时间', formatDate(trace.createdAt)]");
    expect(tabSource).toContain('function formatTraceContext');
  });

  it('does not expose raw JSON as the default record summary', () => {
    expect(tabSource).toContain('parseJsonObject(trace.resultSummary)');
    expect(tabSource).toContain("readNumberField(parsed, 'windowCount')");
    expect(tabSource).toContain("readNumberField(parsed, 'tabCount')");
    expect(tabSource).toContain('窗口/标签清单已读取');
    expect(tabSource).toContain('已读取 ${items.length} 条记录');
    expect(tabSource).toContain("!rawSummary.startsWith('{') && !rawSummary.startsWith('[')");
    expect(tabSource).toContain('结果已记录，可展开查看完整 JSON');
    expect(tabSource).toContain('<pre>{{ row.detailJson }}</pre>');
  });

  it('supports copying a row JSON payload from the compact details area', () => {
    expect(tabSource).toContain('const copiedRecordId = ref');
    expect(tabSource).toContain('function copyRecordJson(row: ViewRecord)');
    expect(tabSource).toContain('await writeClipboard(row.detailJson)');
    expect(tabSource).toContain('globalThis.navigator?.clipboard?.writeText');
    expect(tabSource).toContain("document.execCommand('copy')");
    expect(tabSource).toContain('onUnmounted');
  });

  it('keeps long identifiers in JSON instead of the default human detail fields', () => {
    expect(tabSource).not.toContain("['Task ID / 任务', trace.taskId]");
    expect(tabSource).not.toContain("['Call ID / 调用', trace.toolCallId]");
    expect(tabSource).toContain('formatBusinessStatus(trace.businessSuccess)');
    expect(tabSource).toContain('function isPresentString');
    expect(tabSource).not.toContain("['Tool / 工具', trace.toolName]");
    expect(tabSource).toContain('detailJson: formatJsonDetail(trace)');
    expect(tabSource).not.toContain('v-for="item in row.meta"');
    expect(tabSource).not.toContain('compactMeta');
    expect(tabSource).not.toContain('mke-meta');
    expect(tabSource).not.toContain('shortId(');
    expect(tabSource).toContain('overflow-x: hidden;');
    expect(tabSource).toContain('overflow-y: auto;');
    expect(tabSource).toContain('overflow-wrap: anywhere;');
    expect(tabSource).toContain('white-space: normal;');
  });

  it('has dark theme coverage for the new sidepanel surface', () => {
    expect(tabSource).toContain(':class="`mke-data-tab--${agentTheme}`"');
    expect(tabSource).toContain('useAgentTheme');
    expect(tabSource).toContain('.mke-data-tab--dark-console');
    expect(tabSource).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .mke-data-tab",
    );
    expect(tabSource).toContain('--mke-surface');
    expect(tabSource).toContain('--mke-active-ring');
    expect(tabSource).toContain('.mke-shell');
    expect(tabSource).toContain('height: 100%');
    expect(tabSource).toContain('padding: 0');
    expect(tabSource).toContain('.mke-data-tab *');
    expect(tabSource).toContain('box-sizing: border-box');
    expect(tabSource).toContain('margin: 0 auto');
    expect(appSource).toContain('max-width: 100vw');
    expect(appSource).toContain(':global(html)');
    expect(tabSource).toContain('max-width: min(860px, 100vw);');
    expect(tabSource).toContain('width: min(100%, 100vw);');
    expect(tabSource).toContain('repeat(auto-fit, minmax(136px, 1fr))');
    expect(tabSource).toContain('flex-wrap: wrap;');
    expect(tabSource).toContain('max-width: 100%;');
    expect(tabSource).toContain('.mke-record');
    expect(tabSource).toContain('.mke-record__top');
    expect(tabSource).toContain('white-space: nowrap');
    expect(tabSource).toContain('@media (max-width: 520px)');
    expect(tabSource).toContain('overflow-wrap: anywhere');
    expect(tabSource).toContain('max-width: 100%');
    expect(tabSource).toContain('grid-template-columns: minmax(180px, 1fr) auto;');
    expect(tabSource).toContain('.mke-tab-button--active');
  });
});
