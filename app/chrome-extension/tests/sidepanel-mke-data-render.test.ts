import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MkeDataTab render smoke', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'entrypoints/sidepanel/tabs/MkeDataTab.vue'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/App.vue'), 'utf8');

  it('keeps the user-visible MKE/Object query controls in the template', () => {
    expect(source).toContain('mke-shell');
    expect(source).toContain('mke-controls');
    expect(source).not.toContain('mke-sticky-tools');
    expect(source).not.toContain('mke-dashboard');
    expect(source).not.toContain('数据控制台 / Data Console');
    expect(source).not.toContain('MKE Workspace');
    expect(source).not.toContain('mkep-tab__header');
    expect(source).not.toContain('mkep-tab__subtitle');
    expect(source).toContain('mke-data-body');
    expect(source).toContain('mke-object-workspace');
    expect(source).toContain('mke-webpage-list');
    expect(source).toContain('mke-webpage-row');
    expect(source).toContain('mke-webpage-detail');
    expect(source).toContain('Tabrix · 对象库');
    expect(source).toContain('mke-object-summary-bar');
    expect(source).toContain('mke-object-detail-tabs');
    expect(source).toContain('mke-object-count-grid');
    expect(source).toContain('mke-object-footer-actions');
    expect(source).toContain("scope: 'object-graph'");
    expect(source).toContain('搜索当前列表');
    expect(source).toContain('mke-search-icon');
    expect(source).toContain('搜索主题、对象、方法、网址、状态');
    expect(source).toContain("label: '对象库'");
    expect(source).toContain('fetchMkeBrowserObjects');
    expect(source).toContain('fetchMkeObjectStoragePreferences');
    expect(source).toContain('updateMkeObjectStoragePreferences');
    expect(source).toContain('clearMkeBrowserObjects');
    expect(source).toContain('个人浏览状态存储已开启');
    expect(source).toContain('清除对象库');
    expect(source).toContain('mke-icon-button--active');
    expect(source).toContain('mke-object-footer-button');
    expect(source).toContain('function objectToRecord(object: MkeBrowserObjectSummary)');
    expect(source).toContain('object.currentRoute ||');
    expect(source).toContain('object.rootRoute,');
    expect(source).toContain('object.pageUrlPattern,');
    expect(source).toContain('object.pageIdentity?.url');
    expect(source).toContain('function formatObjectCardTitle(object: MkeBrowserObjectSummary)');
    expect(source).toContain('function formatObjectFacts(');
    expect(source).toContain('buildMkeObjectLibraryView');
    expect(source).toContain('formatObjectWebPageJson');
    expect(source).toContain("if (object.objectType === 'window')");
    expect(source).toContain("['标签', formatObjectTabCount(object)]");
    expect(source).toContain('const locationLabel = formatObjectLocation');
    expect(source).toContain('metaLine: formatObjectMetaLine(object, locationLabel)');
    expect(source).not.toContain(
      "['网址', formatObjectLocation(compactText(location ?? '', 96), object.pageIdentity?.kind)]",
    );
    expect(source).toContain("active_tab_not_operable: '当前标签不可操作'");
    expect(source).toContain('mke-record__title-row');
    expect(source).toContain('mke-refresh-button');
    expect(source).toContain('mke-record__meta-line');
    expect(source).toContain('mke-record__feedback');
    expect(source).toContain('mke-record__feedback-row');
    expect(source).toContain('mke-feedback-score');
    expect(source).not.toContain('mke-record__headline-facts');
    expect(source).toContain('mke-duration');
    expect(source).toContain('mke-record-time');
    expect(source).not.toContain('mke-record__summary');
    expect(source).not.toContain('row.subtitle');
    expect(source).not.toContain('{{ filteredRows.length }}');
    expect(source).not.toContain('{{ activeTotal }} 条');
    expect(source).toContain('mke-detail-button');
    expect(source).toContain('toggleRecordJson(row.id)');
    expect(source).toContain('jsonPanelId(row.id)');
    expect(source).not.toContain('<summary>详情</summary>');
    expect(source).not.toContain('查看详情和完整 JSON');
    expect(source).toContain('mke-json-panel');
    expect(source).toContain('mke-json-copy-button');
    expect(source).toContain('i-lucide-copy');
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
    expect(source).toContain('repeat(auto-fit, minmax(74px, 1fr))');
    expect(source).toContain(':class="`mke-data-tab--${agentTheme}`"');
    expect(source).toContain('.mke-data-tab--dark-console');
    expect(source).toContain(
      ":global(.sidepanel-root[data-agent-theme='dark-console']) .mke-data-tab",
    );
    expect(source).not.toContain('.mke-list-status');
    expect(source).toContain('.mke-visually-hidden');
    expect(source).not.toContain("['Task ID / 任务', trace.taskId]");
    expect(source).not.toContain("['Call ID / 调用', trace.toolCallId]");
    expect(source).toContain(
      'formatBusinessStatus(trace.statusView?.businessStatus, trace.businessSuccess)',
    );
    expect(source).toContain(
      'formatToolStatus(trace.statusView?.executionStatus, trace.toolSuccess)',
    );
    expect(source).toContain('formatAiFeedbackLine(trace)');
    expect(source).toContain('formatAiFeedbackScoreLabel(trace)');
    expect(source).toContain("duration: formatDuration(trace.durationMs) ?? ''");
    expect(source).toContain('createdAtLabel: formatDate(trace.createdAt)');
    expect(source).toContain("['方法', trace.toolName]");
    expect(source).toContain(
      "['执行', formatToolStatus(trace.statusView?.executionStatus, trace.toolSuccess)]",
    );
    expect(source).toContain("const tabTitle = readObjectFactString(object, 'titleSummary')");
    expect(source).toContain('if (tabTitle) return compactText(tabTitle, 42)');
    expect(source).toContain('const locationLabel = formatObjectLocation');
    expect(source).toContain('metaLine: formatObjectMetaLine(object, locationLabel)');
    expect(source).toContain("['打开方', formatObjectOwner(object.ownerType)]");
    expect(source).toContain('function formatObjectOwner');
    expect(source).toContain("ai: 'AI打开'");
    expect(source).toContain("user_or_page: '用户打开'");
    expect(source).toContain("if (object.canTabrixOperate === true) return '可继续处理'");
    expect(source).toContain("if (object.canTabrixOperate === false) return '不可处理'");
    expect(source).toContain("if (object.tabStatus === 'loading') return '加载中'");
    expect(source).not.toContain("if (object.tabStatus === 'complete') return '已加载'");
    expect(source).toContain('formatTraceLocationFact(trace)');
    expect(source).not.toContain("['工具', trace.toolName]");
    expect(source).not.toContain("['执行', formatToolStatus(trace.toolSuccess)]");
    expect(source).not.toContain("['耗时', formatDuration(trace.durationMs)]");
    expect(source).not.toContain("['时间', formatDate(trace.createdAt)]");
    expect(source).not.toContain("['页面', formatTraceContext(trace)]");
    expect(source).not.toContain("['工具结果', formatToolStatus(trace.toolSuccess)]");
    expect(source).not.toContain('function formatTraceSummary');
    expect(source).not.toContain('translateTraceMessage(rawSummary)');
    expect(source).not.toContain('formatCollapsedTraceValue(rawSummary)');
    expect(source).toContain('function formatReadableFeedbackLine');
    expect(source).toContain('function formatAiFeedbackScoreLabel');
    expect(source).toContain(
      "if (identity?.kind === 'extension' || isSystemPageContext(context)) return ['系统页', context]",
    );
    expect(source).toContain("return ['网址', context ?? trace.siteFamily ?? null]");
    expect(source).not.toContain("return ['文件路径', context]");
    expect(source).not.toContain("'AI评价：待回写'");
    expect(source).not.toContain("'AI评分 待回写'");
    expect(source).toContain('formatExtensionPageContext(text)');
    expect(source).toContain('function isPresentString');
    expect(source).not.toContain("['Tool / 工具', trace.toolName]");
    expect(source).not.toContain('return `Tab ${trace.tabId}`');
    expect(source).not.toContain('readTraceResultPageContext(trace.resultSummary)');
    expect(source).not.toContain('function readTraceResultPageContext');
    expect(source).not.toContain("['Tool result / 工具结果'");
    expect(source).not.toContain('v-for="item in row.meta"');
    expect(source).not.toContain('compactMeta');
    expect(source).not.toContain('mke-meta');
    expect(source).toContain('@media (max-width: 520px)');
    expect(source).toContain('overflow-x: hidden;');
    expect(source).toContain('overflow-y: auto;');
    expect(source).toContain('overflow-wrap: anywhere');
    expect(source).toContain('text-overflow: ellipsis;');
    expect(source).toContain('white-space: nowrap;');
    expect(source).toContain('.mke-json-block');
    expect(source).toContain('width: 100%;');
    expect(source).toContain('grid-template-columns: auto minmax(118px, 1fr) auto;');
    expect(source).toContain('grid-template-columns: auto minmax(108px, 1fr) auto;');
    expect(source).toContain(
      'grid-template-columns: 34px minmax(110px, 1fr) minmax(92px, auto) auto 18px;',
    );
    expect(source).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
    expect(source).toContain('right: 20px;');
    expect(source).toContain('top: 10px;');
    expect(source).toContain('height: 30px;');
    expect(source).toContain('width: 30px;');
    expect(source).toContain('padding: 12px 58px 12px 12px;');
    expect(source).toContain('justify-self: start;');
    expect(source).toContain('justify-self: end;');
    expect(source).not.toContain('top: 7px;');
    expect(source).toContain('max-width: min(360px, calc(100vw - 180px));');
  });
});
