import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MkeDataTab render smoke', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'entrypoints/sidepanel/tabs/MkeDataTab.vue'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/App.vue'), 'utf8');

  it('keeps the user-visible three-table query controls in the template', () => {
    expect(source).toContain('mke-shell');
    expect(source).toContain('mke-controls');
    expect(source).not.toContain('mke-sticky-tools');
    expect(source).not.toContain('mke-dashboard');
    expect(source).not.toContain('数据控制台 / Data Console');
    expect(source).not.toContain('MKE Workspace');
    expect(source).not.toContain('mkep-tab__header');
    expect(source).not.toContain('mkep-tab__subtitle');
    expect(source).toContain('mke-data-body');
    expect(source).toContain('搜索当前列表');
    expect(source).toContain('mke-search-icon');
    expect(source).toContain('搜索主题、工具、页面、状态');
    expect(source).toContain('mke-refresh-button');
    expect(source).toContain('mke-record__meta-line');
    expect(source).not.toContain('{{ filteredRows.length }}');
    expect(source).not.toContain('{{ activeTotal }} 条');
    expect(source).toContain('<summary>详情</summary>');
    expect(source).not.toContain('查看详情和完整 JSON');
    expect(source).toContain('mke-copy-button');
    expect(source).toContain('loadMoreLabel');
    expect(source).toContain('加载更多 (${activeRows.value.length}/${activeTotal.value})');
  });

  it('keeps sidepanel chrome compact enough for a browser right rail', () => {
    expect(appSource).toContain(':data-agent-theme="agentTheme"');
    expect(appSource).toContain('<MkeDataTab />');
    expect(appSource).not.toContain('class="mkep-nav"');
    expect(appSource).not.toContain('MemoryTab');
    expect(appSource).not.toContain('ExecutionTab');
    expect(appSource).toContain('.sidepanel-root *');
    expect(appSource).toContain('box-sizing: border-box');
    expect(appSource).toContain(".sidepanel-root[data-agent-theme='dark-console']");
    expect(source).toContain('grid-template-columns: minmax(180px, 1fr) auto');
    expect(appSource).toContain('max-width: 100vw');
    expect(source).toContain('max-width: min(860px, 100vw)');
    expect(source).toContain('margin: 0 auto');
    expect(source).toContain('.mke-data-tab *');
    expect(source).toContain('box-sizing: border-box');
    expect(source).toContain('repeat(auto-fit, minmax(136px, 1fr))');
    expect(source).toContain(':class="`mke-data-tab--${agentTheme}`"');
    expect(source).toContain('.mke-data-tab--dark-console');
    expect(source).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .mke-data-tab",
    );
    expect(source).not.toContain('.mke-list-status');
    expect(source).toContain('.mke-visually-hidden');
    expect(source).not.toContain("['Task ID / 任务', trace.taskId]");
    expect(source).not.toContain("['Call ID / 调用', trace.toolCallId]");
    expect(source).toContain('formatBusinessStatus(trace.businessSuccess)');
    expect(source).toContain('formatToolStatus(trace.toolSuccess)');
    expect(source).toContain('function isPresentString');
    expect(source).not.toContain("['Tool / 工具', trace.toolName]");
    expect(source).not.toContain('return `Tab ${trace.tabId}`');
    expect(source).toContain('readTraceResultPageContext(trace.resultSummary)');
    expect(source).not.toContain("['Tool result / 工具结果'");
    expect(source).not.toContain('v-for="item in row.meta"');
    expect(source).not.toContain('compactMeta');
    expect(source).not.toContain('mke-meta');
    expect(source).toContain('@media (max-width: 520px)');
    expect(source).toContain('overflow-x: hidden;');
    expect(source).toContain('overflow-y: auto;');
    expect(source).toContain('overflow-wrap: anywhere');
    expect(source).toContain('white-space: normal;');
    expect(source).toContain('.mke-json pre');
    expect(source).toContain('width: 100%;');
    expect(source).toContain('top: 7px;');
  });
});
