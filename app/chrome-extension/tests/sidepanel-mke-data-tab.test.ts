import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}

describe('Sidepanel MKE data tab', () => {
  const appSource = readSource('entrypoints/sidepanel/App.vue');
  const tabSource = readSource('entrypoints/sidepanel/tabs/MkeDataTab.vue');
  const objectViewSource = readSource('entrypoints/sidepanel/tabs/mke-object-library-view.ts');

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

  it('queries the four MKE/Object tables and Object Library preferences through the memory API client', () => {
    expect(tabSource).toContain('fetchMkeMemoryTraces');
    expect(tabSource).toContain('fetchMkeBrowserObjects');
    expect(tabSource).toContain('buildMkeObjectLibraryView');
    expect(tabSource).toContain('fetchMkeKnowledgeModels');
    expect(tabSource).toContain('fetchMkeExperienceRecipes');
    expect(tabSource).toContain('fetchMkeObjectStoragePreferences');
    expect(tabSource).toContain('updateMkeObjectStoragePreferences');
    expect(tabSource).not.toContain('clearMkeBrowserObjects');
    expect(tabSource).toContain("scope: 'object-graph'");
    expect(tabSource).toContain('type ActiveTab = MkeDataTabId');
    expect(tabSource).toContain("label: '记忆库'");
    expect(tabSource).toContain("label: '对象库'");
    expect(tabSource).toContain("label: '知识库'");
    expect(tabSource).toContain("label: '经验库'");
    expect(tabSource).not.toContain('MKE Workspace');
    expect(tabSource).not.toContain('数据控制台 / Data Console');
  });

  it('supports a non-P3 extension-internal URL entry for opening a specific data tab', () => {
    expect(tabSource).toContain('import {');
    expect(tabSource).toContain('resolveInitialMkeDataTabFromLocation');
    expect(tabSource).toContain('type MkeDataTabId');
    expect(tabSource).toContain('type ActiveTab = MkeDataTabId');
    expect(tabSource).toContain(
      'const activeTab = ref<ActiveTab>(resolveInitialMkeDataTabFromLocation())',
    );
    expect(tabSource).toContain('@click="setActiveTab(tab.id)"');
    expect(tabSource).toContain('function setActiveTab(tab: ActiveTab): void');
    expect(tabSource).toContain('function syncMkeDataTabUrl(tab: ActiveTab): void');
    expect(tabSource).toContain("url.searchParams.set('mkeTab', tab)");
    expect(tabSource).not.toContain("const activeTab = ref<ActiveTab>('memory')");
    expect(tabSource).not.toContain('@click="activeTab = tab.id"');
  });

  it('keeps all four libraries visible while Object Library uses the simple record list', () => {
    expect(tabSource).toContain('mke-shell');
    expect(tabSource).toContain('mke-controls');
    expect(tabSource).not.toContain('mke-sticky-tools');
    expect(tabSource).not.toContain('mke-dashboard');
    expect(tabSource).not.toContain('mkep-tab__header');
    expect(tabSource).not.toContain('mkep-tab__subtitle');
    expect(tabSource).toContain('mke-data-body');
    expect(tabSource).toContain('<div class="mke-tabs"');
    expect(tabSource).not.toContain('<template v-if="activeTab === \'object\'">');
    expect(tabSource).not.toContain('Tabrix · 对象库');
    expect(tabSource).not.toContain('mke-object-summary-bar');
    expect(tabSource).toContain('mke-toolbar--object');
    expect(tabSource).toContain('mke-object-storage-toggle');
    expect(tabSource).not.toContain('filteredObjectWebPages');
    expect(tabSource).not.toContain('selectedObjectWebPage');
    expect(tabSource).not.toContain('mke-webpage-row');
    expect(tabSource).not.toContain('mke-object-workspace');
    expect(tabSource).not.toContain('mke-object-detail-tabs');
    expect(tabSource).not.toContain('mke-object-count-grid');
    expect(tabSource).not.toContain('mke-object-footer-actions');
    expect(objectViewSource).toContain('页面对象');
    expect(objectViewSource).toContain('可操作功能');
    expect(objectViewSource).toContain('数据/API');
    expect(objectViewSource).toContain('生命周期');
    expect(tabSource).toContain('type="search"');
    expect(tabSource).toContain('搜索当前列表');
    expect(tabSource).toContain('mke-search-icon');
    expect(tabSource).toContain('搜索主题、对象、方法、网址、状态');
    expect(tabSource).toContain('搜索网页、对象、功能、网址、状态');
    expect(tabSource).toContain('mke-refresh-button');
    expect(tabSource).toContain('保存浏览状态：开');
    expect(tabSource).toContain('保存浏览状态：关');
    expect(tabSource).not.toContain('清除对象库');
    expect(tabSource).toContain('personalBrowserStateStorageEnabled');
    expect(tabSource).toContain('mke-icon-button--active');
    expect(tabSource).toContain('mke-icon-button--off');
    expect(tabSource).toContain('mke-icon-button--confirmed');
    expect(tabSource).toContain('preferenceToggleConfirmed');
    expect(tabSource).toContain('i-lucide-shield-check');
    expect(tabSource).toContain('i-lucide-shield-off');
    expect(tabSource).toContain('@keyframes mke-toggle-confirm');
    expect(tabSource).not.toContain('mke-object-footer-button');
    expect(tabSource).toContain('mke-record__title-row');
    expect(tabSource).toContain('mke-record__meta-line');
    expect(tabSource).toContain('mke-record__feedback');
    expect(tabSource).toContain('mke-record__feedback-row');
    expect(tabSource).toContain('mke-feedback-score');
    expect(tabSource).not.toContain('mke-record__headline-facts');
    expect(tabSource).toContain('mke-duration');
    expect(tabSource).toContain('mke-record-time');
    expect(tabSource).toContain('MKE_AUTO_REFRESH_MS');
    expect(tabSource).toContain('setInterval');
    expect(tabSource).toContain("document.visibilityState !== 'visible'");
    expect(tabSource).toContain('refreshAll({ silent: true })');
    expect(tabSource).toContain('clearInterval(autoRefreshTimer)');
    expect(tabSource).not.toContain('mke-record__summary');
    expect(tabSource).not.toContain('row.subtitle');
    expect(tabSource).not.toContain('{{ row.kicker }}');
    expect(tabSource).not.toContain('{{ filteredRows.length }}');
    expect(tabSource).not.toContain('{{ activeTotal }} 条');
    expect(tabSource).not.toContain('mke-list-status');
    expect(tabSource).not.toContain('置信度');
    expect(tabSource).not.toContain('漂移');
    expect(tabSource).not.toContain('观测次数');
    expect(tabSource).not.toContain('可靠性');
    expect(tabSource).not.toContain('formatKnowledgeStatus');
    expect(tabSource).not.toContain('formatScore');
    expect(tabSource).not.toContain("['Drift / 漂移'");
    expect(tabSource).not.toContain("['Reliability / 可靠性'");
    expect(tabSource).toContain('搜索仅覆盖已加载记录');
    expect(tabSource).toContain('mke-detail-button');
    expect(tabSource).toContain('toggleRecordJson(row.id)');
    expect(tabSource).toContain('jsonPanelId(row.id)');
    expect(tabSource).not.toContain('<summary>详情</summary>');
    expect(tabSource).not.toContain('查看详情和完整 JSON');
    expect(tabSource).toContain('mke-json-panel');
    expect(tabSource).toContain('mke-json-copy-button');
    expect(tabSource).toContain('i-lucide-copy');
    expect(tabSource).toContain("'mke-json-copy-button--copied': copiedRecordId === row.id");
    expect(tabSource).toContain("'mke-json-copy-button--failed': copyFailedRecordId === row.id");
    expect(tabSource).toContain('loadMoreLabel');
    expect(tabSource).toContain('加载更多 (${activeLoadedCount.value}/${activeTotal.value})');
    expect(tabSource).toContain('grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));');
    expect(tabSource).toContain('grid-template-columns: minmax(180px, 1fr) auto;');
    expect(tabSource).toContain('grid-template-columns: minmax(160px, 1fr) 34px auto;');
    expect(tabSource).toContain('grid-template-columns: auto minmax(118px, 1fr) auto;');
    expect(tabSource).not.toContain('grid-template-columns: 34px minmax(110px, 1fr)');
    expect(tabSource).not.toContain('mke-meta');
  });

  it('keeps technical trace records in readable product labels', () => {
    expect(tabSource).toContain("chrome_screenshot: '截图留证 / Screenshot'");
    expect(tabSource).toContain("chrome_navigate: '打开页面 / Navigate'");
    expect(tabSource).toContain("chrome_click_element: '点击页面元素 / Click'");
    expect(tabSource).toContain("chrome_history: '读取历史记录 / History'");
    expect(tabSource).toContain("chrome_get_web_content: '读取内容 / Web content'");
    expect(tabSource).not.toContain('Current tab is not a clickable web page');
    expect(tabSource).not.toContain('Page changed, read to confirm');
    expect(tabSource).not.toContain('isInternalTraceText(value)');
    expect(tabSource).toContain("if (value === 'achieved' || value === 'true') return 'AI通过'");
    expect(tabSource).toContain("if (value === 'partial') return 'AI部分完成'");
    expect(tabSource).toContain(
      "if (value === 'not_achieved' || value === 'false') return 'AI未通过'",
    );
    expect(tabSource).toContain("return '待AI评价'");
    expect(tabSource).not.toContain("return '业务通过'");
    expect(tabSource).not.toContain("return '待AI回写'");
  });

  it('makes AI feedback primary and keeps execution evidence out of the visible record', () => {
    expect(tabSource).toContain('<h3 :title="row.title">{{ row.title }}</h3>');
    expect(tabSource).toContain('v-if="row.metaLine"');
    expect(tabSource).toContain('v-if="row.feedbackLine"');
    expect(tabSource).toContain('v-if="row.feedbackScoreLabel"');
    expect(tabSource).toContain('v-if="row.duration"');
    expect(tabSource).toContain('v-if="row.createdAtLabel"');
    expect(tabSource).toContain('class="mke-status"');
    expect(tabSource).toContain(
      'const status = formatAiBusinessStatus(trace.aiFeedback?.businessStatus)',
    );
    expect(tabSource).not.toContain('formatBusinessStatus(trace.statusView?.businessStatus');
    expect(tabSource).not.toContain('trace.businessSuccess');
    expect(tabSource).toContain('const feedbackLine = formatAiFeedbackLine(trace)');
    expect(tabSource).not.toContain('feedback?.reasonCode ? `原因');
    expect(tabSource).toContain("metaLine: ''");
    expect(tabSource).not.toContain(
      'metaLine: [`方法 ${trace.toolName}`, toolLabel, formatDate(trace.createdAt)]',
    );
    expect(tabSource).toContain("duration: formatDuration(trace.durationMs) ?? ''");
    expect(tabSource).toContain('createdAtLabel: formatDate(trace.createdAt)');
    expect(tabSource).toContain("['方法', trace.toolName]");
    expect(tabSource).not.toContain(
      "['执行', formatToolStatus(trace.statusView?.executionStatus, trace.toolSuccess)]",
    );
    expect(tabSource).toContain('formatTraceLocationFact(trace)');
    expect(tabSource).not.toContain("['工具', trace.toolName]");
    expect(tabSource).not.toContain("['执行', formatToolStatus(trace.toolSuccess)]");
    expect(tabSource).not.toContain("['耗时', formatDuration(trace.durationMs)]");
    expect(tabSource).not.toContain("['时间', formatDate(trace.createdAt)]");
    expect(tabSource).not.toContain("['页面', formatTraceContext(trace)]");
    expect(tabSource).not.toContain("['工具结果', formatToolStatus(trace.toolSuccess)]");
    expect(tabSource).not.toContain("['业务', formatBusinessStatus(trace.businessSuccess)]");
    expect(tabSource).not.toContain('formatBoolean(trace.toolSuccess)');
    expect(tabSource).not.toContain("['AI反馈', formatBusinessStatus(trace.businessSuccess)]");
    expect(tabSource).not.toContain("['上下文', formatTraceContext(trace)]");
    expect(tabSource).toContain('function formatToolStatus');
    expect(tabSource).toContain('function formatAiBusinessStatusTone');
    expect(tabSource).not.toContain('function formatBusinessStatusTone');
    expect(tabSource).toContain('function formatAiBusinessStatus');
    expect(tabSource).not.toContain('function formatBusinessStatus');
    expect(tabSource).toContain('function formatAiFeedbackLine');
    expect(tabSource).toContain('function formatAiFeedbackScoreLabel');
    expect(tabSource).toContain('function formatTraceLocationFact');
    expect(tabSource).toContain('function formatReadableFeedbackLine');
    expect(tabSource).not.toContain('function formatTraceContext');
  });

  it('adds Object Library as a real data view without showing Tab IDs as primary fields', () => {
    expect(tabSource).toContain('const browserObjects = ref<MkeBrowserObjectSummary[]>([])');
    expect(tabSource).toContain('fetchMkeBrowserObjects({ limit: objectLimit');
    expect(tabSource).toContain('readLiveForegroundTabId');
    expect(tabSource).toContain('foregroundTabId: liveForegroundTabId.value');
    expect(tabSource).toContain("if (activeTab.value === 'object')");
    expect(tabSource).toContain(
      'buildMkeObjectLibraryView(browserObjects.value, currentObjectLibraryRuntimeContext.value)',
    );
    expect(tabSource).toContain('objectLibraryView.value.webPages.map(objectWebPageToRecord)');
    expect(tabSource).toContain('objectLibraryView');
    expect(tabSource).toContain('formatObjectWebPageJson');
    expect(tabSource).not.toContain('copyObjectWebPageJson');
    expect(tabSource).toContain('function objectWebPageToRecord(webPage: MkeObjectWebPageView)');
    expect(tabSource).toContain('title: webPage.title');
    expect(tabSource).toContain('metaLine: webPage.location');
    expect(tabSource).toContain('status: webPage.lifecycleLabel');
    expect(tabSource).toContain('statusTone: webPage.lifecycleTone');
    expect(tabSource).toContain("isForeground: webPage.lifecycleLabel === '前台页'");
    expect(tabSource).toContain('createdAtLabel: formatDate(webPage.updatedAt)');
    expect(tabSource).toContain('facts: []');
    expect(tabSource).toContain('detailJson: formatObjectWebPageJson(webPage)');
    expect(tabSource).not.toContain('webPage.activityLabel');
    expect(tabSource).not.toContain('activityLabel: webPage.activityLabel');
    expect(tabSource).not.toContain('function objectToRecord(object: MkeBrowserObjectSummary)');
    expect(tabSource).not.toContain('function formatObjectCardTitle');
    expect(tabSource).not.toContain('function formatObjectFacts');
    expect(tabSource).not.toContain('function formatObjectOwner');
    expect(tabSource).not.toContain('function formatObjectRuntimeState');
    expect(tabSource).not.toContain("if (object.tabStatus === 'complete') return '已加载'");
    expect(tabSource).not.toContain('function formatOperabilityReason');
    expect(tabSource).not.toContain("['操作', formatOperability(object)]");
    expect(tabSource).not.toContain('function formatOperability(object');
    expect(tabSource).not.toContain("object.operabilityReason || '否'");
    expect(tabSource).not.toContain("['Tab ID', object.tabId]");
    expect(tabSource).not.toContain("['标签页', object.tabId]");
  });

  it('does not derive default card copy from raw tool results', () => {
    expect(tabSource).not.toContain('function formatTraceSummary');
    expect(tabSource).not.toContain('readReadableResultSummary');
    expect(tabSource).not.toContain('function translateTraceMessage');
    expect(tabSource).not.toContain('已读取页面内容：');
    expect(tabSource).not.toContain("readNumberField(parsed, 'windowCount')");
    expect(tabSource).not.toContain("readNumberField(parsed, 'tabCount')");
    expect(tabSource).not.toContain('translateTraceMessage(rawSummary)');
    expect(tabSource).not.toContain('formatCollapsedTraceValue(rawSummary)');
    expect(tabSource).not.toContain('readTraceResultPageContext(trace.resultSummary)');
    expect(tabSource).not.toContain('function readTraceResultPageContext');
    expect(tabSource).toContain("return value.replace(/^null[\\\\/]+/i, '').trim()");
    expect(tabSource).toContain("const LOCAL_CONTENT_SUMMARY = '本地内容已读取，路径见详情'");
    expect(tabSource).toContain("const LOCAL_CONTENT_CONTEXT = '本地文件'");
    expect(tabSource).toContain('if (isLocalFileReference(text)) return LOCAL_CONTENT_SUMMARY');
    expect(tabSource).toContain('formatExtensionPageContext(text)');
    expect(tabSource).toContain('function isSystemPageContext');
    expect(tabSource).toContain("if (pageName === 'sidepanel.html') return 'Tabrix 侧栏'");
    expect(tabSource).toContain('function formatExtensionPageContext');
    expect(tabSource).toContain('if (host) return host');
    expect(tabSource).not.toContain('return `页面 ${host}`');
    expect(tabSource).not.toContain('if (pageContext && pageContext !== LOCAL_CONTENT_SUMMARY)');
    expect(tabSource).toContain("value.startsWith('file://')");
    expect(tabSource).toContain(
      "if (identity?.kind === 'extension' || isSystemPageContext(context)) return ['系统页', context]",
    );
    expect(tabSource).toContain("return ['网址', context ?? trace.siteFamily ?? null]");
    expect(tabSource).not.toContain("return ['文件路径', context]");
    expect(tabSource).toContain('const SYSTEM_PAGE_CONTEXT = ');
    expect(tabSource).not.toContain('if (isSystemPageContext(resultContext)) return resultContext');
    expect(tabSource).not.toContain('return `Tab ${trace.tabId}`');
    expect(tabSource).not.toContain('窗口/标签清单已读取');
    expect(tabSource).not.toContain('已读取 ${items.length} 条记录');
    expect(tabSource).not.toContain("!rawSummary.startsWith('{') && !rawSummary.startsWith('[')");
    expect(tabSource).not.toContain('结果已记录，可展开查看详情');
    expect(tabSource).not.toContain('暂无结果摘要');
    expect(tabSource).toContain('v-if="isRecordExpanded(row.id)"');
    expect(tabSource).toContain('class="mke-json-block"');
    expect(tabSource).toContain('row.detailJson');
  });

  it('supports copying a row JSON payload from the compact details area', () => {
    expect(tabSource).toContain('const copiedRecordId = ref');
    expect(tabSource).toContain('const copyFailedRecordId = ref');
    expect(tabSource).toContain('function copyRecordJson(row: ViewRecord)');
    expect(tabSource).toContain('const expandedRecordIds = ref<Set<string>>(new Set())');
    expect(tabSource).toContain('function toggleRecordJson(id: string)');
    expect(tabSource).toContain('function isRecordExpanded(id: string)');
    expect(tabSource).toContain('function jsonPanelId(id: string)');
    expect(tabSource).toContain('await writeClipboard(row.detailJson)');
    expect(tabSource).toContain('globalThis.navigator?.clipboard?.writeText');
    expect(tabSource).toContain("document.execCommand('copy')");
    expect(tabSource).toContain('display: grid;');
    expect(tabSource).toContain('grid-template-columns: auto minmax(118px, 1fr) auto;');
    expect(tabSource).toContain('justify-self: start;');
    expect(tabSource).toContain('justify-self: end;');
    expect(tabSource).not.toContain('right: 0;');
    expect(tabSource).not.toContain('top: 7px;');
    expect(tabSource).toContain('right: 20px;');
    expect(tabSource).toContain('top: 10px;');
    expect(tabSource).toContain('height: 30px;');
    expect(tabSource).toContain('width: 30px;');
    expect(tabSource).toContain('.mke-json-block');
    expect(tabSource).toContain('class="mke-json-panel"');
    expect(tabSource).toContain('class="mke-json-copy-button"');
    expect(tabSource).toContain('.mke-json-copy-button--copied');
    expect(tabSource).toContain('.mke-json-copy-button--failed');
    expect(tabSource).toContain('@keyframes mke-copy-pop');
    expect(tabSource).toContain('<i-lucide-copy aria-hidden="true" />');
    expect(tabSource).toContain('width: 100%;');
    expect(tabSource).toContain('overflow: auto;');
    expect(tabSource).toContain('padding: 12px 58px 12px 12px;');
    expect(tabSource).toContain('onUnmounted');
  });

  it('keeps long identifiers in JSON instead of the default human detail fields', () => {
    expect(tabSource).not.toContain("['Task ID / 任务', trace.taskId]");
    expect(tabSource).not.toContain("['Call ID / 调用', trace.toolCallId]");
    expect(tabSource).toContain('formatAiBusinessStatus(trace.aiFeedback?.businessStatus)');
    expect(tabSource).toContain('trace.aiFeedback?.summary');
    expect(tabSource).toContain('trace.aiFeedback?.reasonCode');
    expect(tabSource).toContain("'AI评价：待AI评价'");
    expect(tabSource).not.toContain('trace.statusView?.aiScore');
    expect(tabSource).toContain('trace.aiFeedback?.confidence');
    expect(tabSource).toContain('AI评价：${compactText');
    expect(tabSource).toContain('AI评分 ${Math.round(score * 100)}%');
    const removedSyntheticFeedbackPattern = new RegExp(
      `${['system', 'Evidence'].join('')}|${['tabrix', 'auto', 'evidence'].join('_')}`,
    );
    expect(tabSource).not.toMatch(removedSyntheticFeedbackPattern);
    expect(tabSource).not.toContain("'AI评分 待回写'");
    expect(tabSource).not.toContain('trace.aiFeedbackScore ??');
    expect(tabSource).not.toContain('`置信 ${Math.round(trace.aiFeedbackScore * 100)}%`');
    expect(tabSource).not.toContain('AI反馈：');
    expect(tabSource).toContain("replace(/DOM变化/g, '页面变化')");
    expect(tabSource).toContain("replace(/被浏览器接受/g, '已执行')");
    expect(tabSource).toContain('function isPresentString');
    expect(tabSource).not.toContain("['Tool / 工具', trace.toolName]");
    expect(tabSource).toContain('detailJson: formatMemoryTraceJson(trace)');
    expect(tabSource).toContain('function formatMemoryTraceJson');
    expect(tabSource).toContain('aiEvaluation: trace.aiFeedback ?? null');
    expect(tabSource).not.toContain('execution: {');
    expect(tabSource).not.toContain('detailJson: formatJsonDetail(trace)');
    expect(tabSource).not.toContain('v-for="item in row.meta"');
    expect(tabSource).not.toContain('compactMeta');
    expect(tabSource).not.toContain('mke-meta');
    expect(tabSource).not.toContain('shortId(');
    expect(tabSource).toContain('overflow-x: hidden;');
    expect(tabSource).toContain('overflow-y: auto;');
    expect(tabSource).toContain('overflow-wrap: anywhere;');
    expect(tabSource).toContain('text-overflow: ellipsis;');
    expect(tabSource).toContain('white-space: nowrap;');
    expect(tabSource).toContain('padding: 8px 2px 0 0;');
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
    expect(tabSource).toContain('repeat(auto-fit, minmax(74px, 1fr))');
    expect(tabSource).toContain('flex-wrap: wrap;');
    expect(tabSource).toContain('flex-wrap: nowrap;');
    expect(tabSource).toContain('align-items: baseline;');
    expect(tabSource).toContain('max-width: 100%;');
    expect(tabSource).toContain('.mke-record');
    expect(tabSource).toContain('.mke-record__title-row');
    expect(tabSource).toContain('white-space: nowrap');
    expect(tabSource).toContain('@media (max-width: 520px)');
    expect(tabSource).toContain('overflow-wrap: anywhere');
    expect(tabSource).toContain('max-width: 100%');
    expect(tabSource).toContain('max-width: min(360px, calc(100vw - 180px));');
    expect(tabSource).toContain('grid-template-columns: minmax(180px, 1fr) auto;');
    expect(tabSource).toContain('.mke-tab-button--active');
  });
});
