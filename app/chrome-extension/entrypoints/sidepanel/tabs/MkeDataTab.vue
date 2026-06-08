<template>
  <section class="mkep-tab mke-data-tab" :class="`mke-data-tab--${agentTheme}`">
    <div class="mke-shell">
      <div class="mke-controls" role="status" aria-live="polite">
        <h2 class="mke-visually-hidden">{{ activeTableInfo.label }}</h2>
        <div class="mke-tabs" role="tablist" aria-label="MKE data tables">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="mke-tab-button"
            :class="{ 'mke-tab-button--active': activeTab === tab.id }"
            role="tab"
            :aria-selected="activeTab === tab.id"
            @click="activeTab = tab.id"
          >
            <span>{{ tab.label }}</span>
            <strong>{{ tab.total }}</strong>
          </button>
        </div>

        <div class="mke-toolbar">
          <label class="mke-search">
            <span class="mke-visually-hidden">搜索当前列表</span>
            <svg
              class="mke-search-icon"
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              v-model.trim="searchQuery"
              type="search"
              aria-label="Search loaded MKE rows"
              placeholder="搜索主题、方法、网址、状态"
            />
          </label>
          <button
            type="button"
            class="mke-button mke-refresh-button"
            :disabled="loading"
            title="刷新当前数据"
            @click="refreshAll()"
          >
            {{ loading ? '刷新中' : '刷新' }}
          </button>
        </div>

        <p v-if="searchQuery" class="mke-filter-note">搜索仅覆盖已加载记录，列表按最新时间倒序。</p>
      </div>

      <main class="mke-data-body">
        <div v-if="loadError" class="mke-error" role="alert">
          <strong>{{ loadError }}</strong>
          <p v-if="loadErrorDetail">{{ loadErrorDetail }}</p>
        </div>

        <div v-if="loading && activeRows.length === 0" class="mke-empty">
          正在加载数据 / Loading rows...
        </div>
        <div v-else-if="filteredRows.length === 0" class="mke-empty">
          {{ searchQuery ? '没有匹配当前搜索的记录。' : activeEmptyText }}
        </div>

        <ol v-else class="mke-records" :aria-label="`${activeTableInfo.kicker} rows`">
          <li v-for="row in filteredRows" :key="row.id" class="mke-record">
            <div class="mke-record__top">
              <div>
                <div class="mke-record__title-row">
                  <h3 :title="row.title">{{ row.title }}</h3>
                  <span v-if="row.duration" class="mke-duration">{{ row.duration }}</span>
                </div>
                <p v-if="row.metaLine" class="mke-record__meta-line" :title="row.metaLine">
                  {{ row.metaLine }}
                </p>
              </div>
              <div class="mke-record__headline-facts">
                <span class="mke-status" :class="`mke-status--${row.statusTone}`">
                  {{ row.status }}
                </span>
              </div>
            </div>

            <div v-if="row.feedbackLine || row.feedbackScoreLabel" class="mke-record__feedback-row">
              <p v-if="row.feedbackLine" class="mke-record__feedback" :title="row.feedbackLine">
                {{ row.feedbackLine }}
              </p>
              <span
                v-if="row.feedbackScoreLabel"
                class="mke-feedback-score"
                title="AI 根据页面证据对上一任务完成度的自评，不代表真实平台验收。"
              >
                {{ row.feedbackScoreLabel }}
              </span>
            </div>

            <div class="mke-facts">
              <div v-for="fact in row.facts" :key="fact.label">
                <span>{{ fact.label }}</span>
                <strong :title="fact.value">{{ fact.value }}</strong>
              </div>
            </div>

            <div class="mke-record-actions">
              <button
                type="button"
                class="mke-detail-button"
                :aria-expanded="isRecordExpanded(row.id)"
                :aria-controls="jsonPanelId(row.id)"
                @click="toggleRecordJson(row.id)"
              >
                {{ isRecordExpanded(row.id) ? '收起' : '详情' }}
              </button>
              <time v-if="row.createdAtLabel" class="mke-record-time">{{
                row.createdAtLabel
              }}</time>
              <button
                type="button"
                class="mke-copy-button"
                :title="`复制 ${row.title} 的 JSON 数据`"
                @click="copyRecordJson(row)"
              >
                {{ copiedRecordId === row.id ? '已复制' : '复制' }}
              </button>
            </div>
            <pre v-if="isRecordExpanded(row.id)" :id="jsonPanelId(row.id)" class="mke-json-block">{{
              row.detailJson
            }}</pre>
          </li>
        </ol>

        <button
          v-if="canLoadMore"
          type="button"
          class="mke-button mke-load-more"
          :disabled="loading"
          @click="loadMore"
        >
          {{ loading ? '加载中' : loadMoreLabel }}
        </button>
      </main>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type {
  MkeExperienceRecipeSummary,
  MkeKnowledgeModelSummary,
  MkeMemoryTraceSummary,
} from '@tabrix/shared';
import {
  DEFAULT_MKE_PAGE_SIZE,
  fetchMkeExperienceRecipes,
  fetchMkeKnowledgeModels,
  fetchMkeMemoryTraces,
  MemoryApiError,
} from '../../../common/memory-api-client';
import { useAgentTheme } from '../../shared/composables/usePopupTheme';

const MKE_AUTO_REFRESH_MS = 5000;

type ActiveTab = 'memory' | 'knowledge' | 'experience';
type StatusTone = 'good' | 'warn' | 'neutral';
type TraceBusinessStatus = NonNullable<MkeMemoryTraceSummary['statusView']>['businessStatus'];
type TraceExecutionStatus = NonNullable<MkeMemoryTraceSummary['statusView']>['executionStatus'];

interface RecordFact {
  label: string;
  value: string;
}

interface ViewRecord {
  id: string;
  kicker: string;
  title: string;
  metaLine: string;
  feedbackLine: string;
  feedbackScoreLabel: string;
  duration: string;
  createdAtLabel: string;
  status: string;
  statusTone: StatusTone;
  facts: RecordFact[];
  detailJson: string;
  searchTokens?: string[];
  searchText: string;
}

const activeTab = ref<ActiveTab>('memory');
const searchQuery = ref('');
const loading = ref(false);
const loadError = ref('');
const loadErrorDetail = ref('');
const copiedRecordId = ref('');
const expandedRecordIds = ref<Set<string>>(new Set());
const { theme: agentTheme, initTheme } = useAgentTheme();
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;

const traces = ref<MkeMemoryTraceSummary[]>([]);
const knowledgeModels = ref<MkeKnowledgeModelSummary[]>([]);
const experienceRecipes = ref<MkeExperienceRecipeSummary[]>([]);
const totals = ref<Record<ActiveTab, number>>({ memory: 0, knowledge: 0, experience: 0 });
const offsets = ref<Record<ActiveTab, number>>({ memory: 0, knowledge: 0, experience: 0 });

const tabs = computed(() => [
  { id: 'memory' as const, label: '记忆库', total: totals.value.memory },
  { id: 'knowledge' as const, label: '知识库', total: totals.value.knowledge },
  { id: 'experience' as const, label: '经验库', total: totals.value.experience },
]);

const activeRows = computed<ViewRecord[]>(() => {
  if (activeTab.value === 'memory') return traces.value.map(traceToRecord);
  if (activeTab.value === 'knowledge') return knowledgeModels.value.map(knowledgeToRecord);
  return experienceRecipes.value.map(experienceToRecord);
});

const filteredRows = computed<ViewRecord[]>(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return activeRows.value;
  return activeRows.value.filter((row) => row.searchText.includes(query));
});

const activeTotal = computed(() => totals.value[activeTab.value]);

const canLoadMore = computed(() => activeRows.value.length < activeTotal.value);

const loadMoreLabel = computed(() => `加载更多 (${activeRows.value.length}/${activeTotal.value})`);

const activeTableInfo = computed(() => {
  if (activeTab.value === 'memory') {
    return {
      kicker: 'Memory traces / 工具调用记忆',
      label: '记忆库',
      description: '查看最近工具调用、结果状态、耗时和网址。',
    };
  }
  if (activeTab.value === 'knowledge') {
    return {
      kicker: 'Knowledge models / 页面知识模型',
      label: '知识库',
      description: '查看已沉淀的页面模型、置信度、漂移和观测次数。',
    };
  }
  return {
    kicker: 'Experience recipes / 可复用经验',
    label: '经验库',
    description: '查看可复用的脱敏步骤经验、可靠性和采用情况。',
  };
});

const activeEmptyText = computed(() => {
  if (activeTab.value === 'memory') return '记忆库暂无工具调用记录 / No memory traces yet.';
  if (activeTab.value === 'knowledge') return '知识库暂无页面模型 / No knowledge models yet.';
  return '经验库暂无复用经验 / No experience recipes yet.';
});

onMounted(() => {
  void initTheme();
  void refreshAll();
  autoRefreshTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    void refreshAll({ silent: true });
  }, MKE_AUTO_REFRESH_MS);
});

onUnmounted(() => {
  if (copyResetTimer) clearTimeout(copyResetTimer);
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
});

async function refreshAll(options: { silent?: boolean } = {}): Promise<void> {
  if (refreshInFlight) return;
  refreshInFlight = true;
  if (!options.silent) loading.value = true;
  loadError.value = '';
  loadErrorDetail.value = '';
  try {
    const memoryLimit = Math.max(offsets.value.memory, DEFAULT_MKE_PAGE_SIZE);
    const knowledgeLimit = Math.max(offsets.value.knowledge, DEFAULT_MKE_PAGE_SIZE);
    const experienceLimit = Math.max(offsets.value.experience, DEFAULT_MKE_PAGE_SIZE);
    const [memoryData, knowledgeData, experienceData] = await Promise.all([
      fetchMkeMemoryTraces({ limit: memoryLimit, offset: 0 }),
      fetchMkeKnowledgeModels({ limit: knowledgeLimit, offset: 0 }),
      fetchMkeExperienceRecipes({ limit: experienceLimit, offset: 0 }),
    ]);
    traces.value = memoryData.traces;
    knowledgeModels.value = knowledgeData.knowledgeModels;
    experienceRecipes.value = experienceData.experienceRecipes;
    totals.value = {
      memory: memoryData.total,
      knowledge: knowledgeData.total,
      experience: experienceData.total,
    };
    offsets.value = {
      memory: memoryData.traces.length,
      knowledge: knowledgeData.knowledgeModels.length,
      experience: experienceData.experienceRecipes.length,
    };
  } catch (error) {
    const formatted = formatError(error);
    loadError.value = formatted.title;
    loadErrorDetail.value = formatted.detail;
  } finally {
    if (!options.silent) loading.value = false;
    refreshInFlight = false;
  }
}

async function loadMore(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  loadErrorDetail.value = '';
  try {
    if (activeTab.value === 'memory') {
      const data = await fetchMkeMemoryTraces({
        limit: DEFAULT_MKE_PAGE_SIZE,
        offset: offsets.value.memory,
      });
      traces.value = [...traces.value, ...data.traces];
      totals.value.memory = data.total;
      offsets.value.memory = traces.value.length;
      return;
    }
    if (activeTab.value === 'knowledge') {
      const data = await fetchMkeKnowledgeModels({
        limit: DEFAULT_MKE_PAGE_SIZE,
        offset: offsets.value.knowledge,
      });
      knowledgeModels.value = [...knowledgeModels.value, ...data.knowledgeModels];
      totals.value.knowledge = data.total;
      offsets.value.knowledge = knowledgeModels.value.length;
      return;
    }
    const data = await fetchMkeExperienceRecipes({
      limit: DEFAULT_MKE_PAGE_SIZE,
      offset: offsets.value.experience,
    });
    experienceRecipes.value = [...experienceRecipes.value, ...data.experienceRecipes];
    totals.value.experience = data.total;
    offsets.value.experience = experienceRecipes.value.length;
  } catch (error) {
    const formatted = formatError(error);
    loadError.value = formatted.title;
    loadErrorDetail.value = formatted.detail;
  } finally {
    loading.value = false;
  }
}

async function copyRecordJson(row: ViewRecord): Promise<void> {
  try {
    await writeClipboard(row.detailJson);
    copiedRecordId.value = row.id;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      if (copiedRecordId.value === row.id) copiedRecordId.value = '';
    }, 1200);
  } catch {
    copiedRecordId.value = '';
  }
}

function toggleRecordJson(id: string): void {
  const next = new Set(expandedRecordIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedRecordIds.value = next;
}

function isRecordExpanded(id: string): boolean {
  return expandedRecordIds.value.has(id);
}

function jsonPanelId(id: string): string {
  return `mke-json-${id.replace(/[^a-z0-9_-]/gi, '-')}`;
}

async function writeClipboard(value: string): Promise<void> {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = value;
  textArea.setAttribute('readonly', 'true');
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
}

function traceToRecord(trace: MkeMemoryTraceSummary): ViewRecord {
  const status = formatBusinessStatus(trace.statusView?.businessStatus, trace.businessSuccess);
  const title = trace.display?.title || formatTraceTitle(trace);
  const feedbackLine = formatAiFeedbackLine(trace);
  const row: Omit<ViewRecord, 'searchText'> = {
    id: trace.traceId,
    kicker: '记忆轨迹',
    title,
    metaLine: '',
    feedbackLine,
    feedbackScoreLabel: formatAiFeedbackScoreLabel(trace),
    duration: formatDuration(trace.durationMs) ?? '',
    createdAtLabel: formatDate(trace.createdAt),
    status,
    statusTone: formatBusinessStatusTone(trace.statusView?.businessStatus, trace.toolSuccess),
    facts: compactFacts([
      ['方法', trace.toolName],
      ['工具执行', formatToolStatus(trace.statusView?.executionStatus, trace.toolSuccess)],
      formatTraceLocationFact(trace),
    ]),
    detailJson: formatJsonDetail(trace),
    searchTokens: [
      trace.toolName,
      trace.taskId,
      trace.toolCallId,
      formatBusinessStatus(trace.statusView?.businessStatus, trace.businessSuccess),
      trace.display?.title,
      trace.display?.locationLabel,
      trace.pageIdentity?.label,
      trace.pageIdentity?.host,
      trace.aiFeedback?.summary,
      trace.aiFeedback?.reasonCode,
      trace.aiFeedback?.businessStatus,
    ].filter(isPresentString),
  };
  return withSearchText(row);
}

function knowledgeToRecord(model: MkeKnowledgeModelSummary): ViewRecord {
  const row: Omit<ViewRecord, 'searchText'> = {
    id: model.knowledgeId,
    kicker: 'Knowledge Model / 页面理解',
    title: `${model.pageRole} · ${model.siteFamily}`,
    metaLine: `${model.pageModelKey} · ${formatDate(model.updatedAt)}`,
    feedbackLine: '',
    feedbackScoreLabel: '',
    duration: '',
    createdAtLabel: formatDate(model.updatedAt),
    status: formatKnowledgeStatus(model.confidenceScore),
    statusTone:
      model.confidenceScore >= 0.7 ? 'good' : model.confidenceScore > 0 ? 'neutral' : 'warn',
    facts: compactFacts([
      ['Model / 模型', model.pageModelKey],
      ['Observations / 观测', String(model.observationCount)],
      ['Drift / 漂移', formatScore(model.driftScore)],
    ]),
    detailJson: formatJsonDetail(model),
  };
  return withSearchText(row);
}

function experienceToRecord(recipe: MkeExperienceRecipeSummary): ViewRecord {
  const row: Omit<ViewRecord, 'searchText'> = {
    id: recipe.experienceId,
    kicker: 'Experience Recipe / 脱敏复用',
    title: recipe.recipeName,
    metaLine: `${recipe.scenarioKey} · ${formatDate(recipe.updatedAt)}`,
    feedbackLine: '',
    feedbackScoreLabel: '',
    duration: '',
    createdAtLabel: formatDate(recipe.updatedAt),
    status: recipe.redactionState === 'template_only' ? '模板 / Template' : recipe.redactionState,
    statusTone: recipe.redactionState === 'template_only' ? 'good' : 'warn',
    facts: compactFacts([
      ['Scope / 范围', recipe.portabilityScope],
      ['Success / 成功', String(recipe.successCount)],
      ['Failure / 失败', String(recipe.failureCount)],
      ['Reliability / 可靠性', formatScore(recipe.reliabilityScore)],
    ]),
    detailJson: formatJsonDetail(recipe),
  };
  return withSearchText(row);
}

function withSearchText(row: Omit<ViewRecord, 'searchText'>): ViewRecord {
  const haystack = [
    row.kicker,
    row.title,
    row.metaLine,
    row.status,
    ...(row.searchTokens ?? []),
    ...row.facts.flatMap((item) => [item.label, item.value]),
  ];
  return { ...row, searchText: haystack.join(' ').toLowerCase() };
}

function compactFacts(entries: Array<[string, string | null | undefined]>): RecordFact[] {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => ({ label, value: String(value) }));
}

function isPresentString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function formatTraceTitle(trace: MkeMemoryTraceSummary): string {
  const toolLabel = formatToolLabel(trace.toolName);
  const intent = trace.taskIntent?.trim();
  if (!intent) return toolLabel || '未命名任务';
  const toolIntent = intent.match(/^Run MCP tool\s+(.+)$/i)?.[1]?.trim();
  if (toolIntent && toolIntent === trace.toolName) return toolLabel;
  if (toolIntent && TOOL_DISPLAY_NAMES[toolIntent]) return TOOL_DISPLAY_NAMES[toolIntent];
  return compactText(intent, 36);
}

function formatJsonDetail(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatNullableNumber(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toFixed(2);
}

function formatKnowledgeStatus(value: number | null | undefined): string {
  if (value === null || value === undefined) return '待观察';
  if (value >= 0.7) return '可信';
  if (value > 0) return '需复核';
  return '待观察';
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatBusinessStatus(
  viewValue: TraceBusinessStatus | undefined,
  legacyValue?: string | null,
): string {
  const value = viewValue ?? legacyValue;
  if (value === 'achieved') return '业务通过';
  if (value === 'partial') return '部分完成';
  if (value === 'not_achieved') return '未完成';
  if (value === 'true') return '业务通过';
  if (value === 'false') return '未完成';
  return '待判断';
}

function formatBusinessStatusTone(
  businessValue: TraceBusinessStatus | string | null | undefined,
  toolSuccess: boolean | null | undefined,
): StatusTone {
  if (businessValue === 'achieved' || businessValue === 'true') return 'good';
  if (businessValue === 'not_achieved' || businessValue === 'false') return 'warn';
  if (toolSuccess === false) return 'warn';
  return 'neutral';
}

function formatToolStatus(
  executionStatus: TraceExecutionStatus | null | undefined,
  legacyValue: boolean | null | undefined,
): string {
  if (executionStatus === 'succeeded' || legacyValue === true) return '通过';
  if (executionStatus === 'failed' || legacyValue === false) return '失败';
  return '待验证';
}

function formatDuration(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value >= 1000) return `耗时 ${(value / 1000).toFixed(1)} 秒`;
  return `耗时 ${value}ms`;
}

function formatAiFeedbackLine(trace: MkeMemoryTraceSummary): string {
  const feedback = trace.aiFeedback;
  return feedback?.summary
    ? `AI评价：${compactText(formatReadableFeedbackLine(feedback.summary), 88)}`
    : '';
}

function formatAiFeedbackScoreLabel(trace: MkeMemoryTraceSummary): string {
  const score = trace.statusView?.aiScore ?? trace.aiFeedbackScore ?? trace.aiFeedback?.confidence;
  return typeof score === 'number' ? `AI评分 ${Math.round(score * 100)}%` : '';
}

function formatReadableFeedbackLine(value: string): string {
  return value
    .replace(/DOM变化/g, '页面变化')
    .replace(/被浏览器接受/g, '已执行')
    .replace(/targetRef/g, '可点击目标')
    .replace(/post_action_delta|page_projection_delta|data=markdown/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[，,。；;]\s*$/u, '')
    .trim();
}

function formatTraceLocationFact(trace: MkeMemoryTraceSummary): [string, string | null] {
  const identity = trace.pageIdentity;
  const context =
    trace.display?.locationLabel ||
    identity?.label ||
    formatCollapsedTraceValue(trace.pageUrlPattern);
  if (identity?.kind === 'extension' || isSystemPageContext(context)) return ['系统页', context];
  if (
    identity?.kind === 'local_file' ||
    context === LOCAL_CONTENT_CONTEXT ||
    context === LOCAL_CONTENT_SUMMARY
  )
    return ['文件', context];
  return ['网址', context ?? trace.siteFamily ?? null];
}

function formatCollapsedTraceValue(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = stripNullPathPrefix(value);
  if (isLocalFileReference(text)) return LOCAL_CONTENT_SUMMARY;
  if (isExtensionPageReference(text)) return formatExtensionPageContext(text);
  const host = readUrlHost(text);
  if (host) return host;
  return text;
}

function stripNullPathPrefix(value: string): string {
  return value.replace(/^null[\\/]+/i, '').trim();
}

function isLocalFileReference(value: string): boolean {
  return (
    value.startsWith('file://') ||
    /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith('/') ||
    value.startsWith('\\\\')
  );
}

function isExtensionPageReference(value: string): boolean {
  return value.startsWith('chrome-extension://') || value.startsWith('extension://');
}

function isSystemPageContext(value: string | null): boolean {
  return (
    typeof value === 'string' &&
    (value.startsWith(SYSTEM_PAGE_CONTEXT) || value.startsWith('Tabrix '))
  );
}

function formatExtensionPageContext(value: string): string {
  try {
    const url = new URL(value);
    const pageName = url.pathname.split('/').filter(Boolean).pop();
    if (pageName === 'sidepanel.html') return 'Tabrix 侧栏';
    if (pageName === 'popup.html') return 'Tabrix 弹窗';
    if (pageName === 'options.html') return 'Tabrix 设置';
    return pageName ? `${SYSTEM_PAGE_CONTEXT} ${pageName}` : SYSTEM_PAGE_CONTEXT;
  } catch {
    return SYSTEM_PAGE_CONTEXT;
  }
}

function readUrlHost(value: string): string | null {
  try {
    const url = new URL(value);
    return url.hostname || null;
  } catch {
    return null;
  }
}

function formatToolLabel(toolName: string): string {
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function formatError(error: unknown): { title: string; detail: string } {
  if (error instanceof MemoryApiError) {
    if (error.kind === 'network') {
      return {
        title: '无法连接 Tabrix 服务 / Service unavailable',
        detail:
          '请确认 Native Server 正在运行，然后刷新右侧栏。Confirm the native server is running, then refresh.',
      };
    }
    return { title: '数据读取失败 / Read failed', detail: error.message };
  }
  return {
    title: '数据读取失败 / Read failed',
    detail: error instanceof Error ? error.message : String(error),
  };
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  chrome_navigate: '打开页面 / Navigate',
  chrome_click_element: '点击页面元素 / Click',
  chrome_screenshot: '截图留证 / Screenshot',
  chrome_history: '读取历史记录 / History',
  chrome_get_web_content: '读取内容 / Web content',
  chrome_read_page: '读取页面 / Read page',
  read_page: '读取页面 / Read page',
  get_windows_and_tabs: '读取窗口和标签 / Browser inventory',
};

const LOCAL_CONTENT_SUMMARY = '本地内容已读取，路径见详情';
const LOCAL_CONTENT_CONTEXT = '本地文件';
const SYSTEM_PAGE_CONTEXT = '系统页';
</script>

<style scoped>
.mke-data-tab {
  --mke-bg: #f5f7fb;
  --mke-surface: #ffffff;
  --mke-surface-2: #f3f6fb;
  --mke-surface-3: #eef3fb;
  --mke-border: #dbe3ef;
  --mke-border-strong: #cbd5e1;
  --mke-text: #111827;
  --mke-muted: #64748b;
  --mke-soft: #475569;
  --mke-accent: #304fe2;
  --mke-accent-bg: #eef2ff;
  --mke-active-ring: rgba(48, 79, 226, 0.28);
  --mke-shadow: 0 8px 22px -20px rgba(15, 23, 42, 0.38);
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  background: var(--mke-bg);
  color: var(--mke-text);
}

.mke-data-tab,
.mke-data-tab * {
  box-sizing: border-box;
}

.mke-shell {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 10px;
  margin: 0 auto;
  max-width: min(860px, 100vw);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding: 10px 12px 12px;
  width: min(100%, 100vw);
}

.mke-data-tab--dark-console,
:global(.sidepanel-root[data-agent-theme='dark-console']) .mke-data-tab {
  --mke-bg: transparent;
  --mke-surface: rgba(6, 18, 36, 0.9);
  --mke-surface-2: rgba(9, 25, 48, 0.88);
  --mke-surface-3: rgba(4, 13, 28, 0.94);
  --mke-border: rgba(56, 189, 248, 0.26);
  --mke-border-strong: rgba(56, 189, 248, 0.46);
  --mke-text: #dbeafe;
  --mke-muted: #94b9dd;
  --mke-soft: #c7e6ff;
  --mke-accent: #67e8f9;
  --mke-accent-bg: rgba(34, 211, 238, 0.12);
  --mke-active-ring: rgba(34, 211, 238, 0.24);
  --mke-shadow: 0 14px 28px -24px rgba(34, 211, 238, 0.58);
}

.mke-record__top {
  display: grid;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
}

.mke-button {
  border: 1px solid var(--mke-border-strong);
  border-radius: 8px;
  background: var(--mke-surface);
  color: var(--mke-text);
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  padding: 8px 10px;
}

.mke-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.mke-controls,
.mke-data-body,
.mke-records,
.mke-tabs,
.mke-toolbar {
  display: flex;
  max-width: 100%;
  min-width: 0;
  width: 100%;
}

.mke-controls,
.mke-data-body,
.mke-records {
  flex-direction: column;
}

.mke-controls {
  flex: 0 0 auto;
  gap: 8px;
  border-bottom: 1px solid var(--mke-border);
  padding-bottom: 8px;
}

.mke-error,
.mke-empty,
.mke-record {
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  background: var(--mke-surface);
  box-shadow: var(--mke-shadow);
  max-width: 100%;
  min-width: 0;
}

.mke-data-body {
  flex: 1 1 auto;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 2px 0 0;
}

.mke-record__kicker {
  margin: 0 0 3px;
  color: var(--mke-muted);
  font-size: 11px;
  font-weight: 800;
}

.mke-toolbar {
  display: grid;
  align-items: center;
  gap: 8px;
  grid-template-columns: minmax(180px, 1fr) auto;
}

.mke-search {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mke-muted);
  font-size: 11px;
  font-weight: 800;
  position: relative;
}

.mke-search input {
  border: 1px solid var(--mke-border-strong);
  border-radius: 8px;
  background: var(--mke-surface-3);
  color: var(--mke-text);
  font-size: 13px;
  min-width: 0;
  padding: 8px 10px 8px 34px;
  width: 100%;
}

.mke-search-icon {
  color: var(--mke-muted);
  height: 15px;
  left: 12px;
  pointer-events: none;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 15px;
}

.mke-visually-hidden {
  border: 0;
  clip: rect(0 0 0 0);
  height: 1px;
  margin: -1px;
  overflow: hidden;
  padding: 0;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

.mke-search input::placeholder {
  color: var(--mke-muted);
}

.mke-filter-note {
  color: var(--mke-muted);
  font-size: 11px;
  line-height: 1.35;
  margin: -2px 0 0;
}

.mke-tabs {
  display: grid;
  gap: 7px;
  grid-template-columns: repeat(auto-fit, minmax(136px, 1fr));
}

.mke-tab-button {
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  background: var(--mke-surface-2);
  color: var(--mke-soft);
  cursor: pointer;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 7px 10px;
}

.mke-tab-button span {
  display: block;
  font-size: 12px;
  font-weight: 850;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-tab-button strong {
  border-radius: 999px;
  background: var(--mke-surface);
  color: var(--mke-text);
  flex: 0 0 auto;
  min-width: 18px;
  padding: 3px 6px;
  text-align: center;
}

.mke-tab-button--active {
  border-color: var(--mke-accent);
  background: var(--mke-accent-bg);
  box-shadow: inset 0 0 0 1px var(--mke-active-ring);
  color: var(--mke-accent);
}

.mke-tab-button--active strong {
  color: var(--mke-accent);
}

.mke-error {
  border-color: #fca5a5;
  color: #991b1b;
  padding: 10px 12px;
}

.mke-data-tab--dark-console .mke-error {
  background: rgba(69, 10, 10, 0.72);
  color: #fecaca;
}

.mke-error p,
.mke-record p {
  margin: 0;
}

.mke-empty {
  color: var(--mke-muted);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.mke-empty {
  background: var(--mke-surface);
  border-style: dashed;
  padding: 18px;
  text-align: center;
}

.mke-records {
  gap: 9px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.mke-record {
  overflow: hidden;
  padding: 11px;
}

.mke-record__top > div {
  min-width: 0;
}

.mke-record__headline-facts {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  flex-direction: row;
  flex-wrap: nowrap;
  gap: 6px;
  justify-content: flex-end;
  max-width: 100%;
}

.mke-record__title-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
  min-width: 0;
}

.mke-record h3 {
  color: var(--mke-text);
  flex: 0 1 auto;
  font-size: 14px;
  line-height: 1.35;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.mke-record__meta-line {
  color: var(--mke-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}

.mke-record__feedback {
  border-left: 2px solid var(--mke-accent);
  color: var(--mke-soft);
  flex: 1 1 220px;
  font-size: 12px;
  line-height: 1.4;
  margin-top: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  padding-left: 8px;
}

.mke-record__feedback-row {
  align-items: flex-start;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  max-width: 100%;
}

.mke-feedback-score,
.mke-duration {
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  background: var(--mke-surface-2);
  color: var(--mke-soft);
  flex: 0 0 auto;
  font-size: 11px;
  font-weight: 850;
  line-height: 1.2;
  padding: 4px 7px;
  white-space: nowrap;
}

.mke-feedback-score {
  color: var(--mke-accent);
}

.mke-status {
  align-self: flex-start;
  border: 1px solid transparent;
  border-radius: 999px;
  flex: 0 0 auto;
  max-width: 100%;
  font-size: 11px;
  font-weight: 850;
  line-height: 1.2;
  padding: 4px 7px;
  white-space: nowrap;
}

.mke-status--good {
  background: #dcfce7;
  color: #166534;
}

.mke-status--warn {
  background: #fee2e2;
  color: #991b1b;
}

.mke-status--neutral {
  background: #eef2ff;
  color: #3730a3;
}

.mke-data-tab--dark-console .mke-status--good {
  border-color: rgba(74, 222, 128, 0.28);
  background: rgba(22, 101, 52, 0.34);
  color: #86efac;
}

.mke-data-tab--dark-console .mke-status--warn {
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(127, 29, 29, 0.36);
  color: #fca5a5;
}

.mke-data-tab--dark-console .mke-status--neutral {
  border-color: rgba(129, 140, 248, 0.28);
  background: rgba(49, 46, 129, 0.36);
  color: #c4b5fd;
}

.mke-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.mke-facts > div {
  align-items: center;
  background: var(--mke-surface-2);
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  display: inline-flex;
  flex-wrap: wrap;
  gap: 5px;
  min-height: 28px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 8px;
}

.mke-facts span {
  color: var(--mke-muted);
  display: block;
  font-size: 11px;
}

.mke-facts strong {
  color: var(--mke-text);
  font-size: 12px;
  font-weight: 780;
  margin: 0;
}

.mke-facts strong {
  max-width: min(420px, 100%);
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

.mke-record-actions {
  border-top: 1px solid var(--mke-border);
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  margin-top: 9px;
  padding-top: 8px;
}

.mke-record-time {
  color: var(--mke-muted);
  font-size: 11px;
  line-height: 1.35;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-detail-button,
.mke-copy-button {
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  background: var(--mke-surface-2);
  color: var(--mke-soft);
  cursor: pointer;
  font-size: 11px;
  font-weight: 850;
  line-height: 1.2;
  padding: 4px 9px;
  white-space: nowrap;
}

.mke-detail-button {
  color: var(--mke-accent);
}

.mke-detail-button:hover,
.mke-copy-button:hover {
  border-color: var(--mke-border-strong);
  color: var(--mke-text);
}

.mke-json-block {
  background: #08111f;
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: #dbeafe;
  font-size: 11px;
  margin: 8px 0 0;
  max-width: 100%;
  overflow-x: auto;
  overflow-wrap: anywhere;
  padding: 10px;
  white-space: pre-wrap;
  width: 100%;
  word-break: break-word;
}

.mke-load-more {
  align-self: stretch;
}

@media (max-width: 520px) {
  .mke-data-tab {
    overflow-x: hidden;
  }

  .mke-shell {
    gap: 10px;
    padding: 10px;
  }

  .mke-record__top {
    grid-template-columns: minmax(0, 1fr);
  }

  .mke-record__top > div {
    max-width: 100%;
  }

  .mke-record__headline-facts {
    align-items: flex-start;
    flex-wrap: wrap;
    justify-content: flex-start;
  }

  .mke-button {
    max-width: 100%;
  }

  .mke-status {
    max-width: 100%;
    white-space: normal;
  }

  .mke-record h3 {
    overflow-wrap: anywhere;
    white-space: normal;
  }

  .mke-record-actions {
    grid-template-columns: auto auto;
  }

  .mke-record-time {
    grid-column: 1 / -1;
  }

  .mke-facts strong {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
}
</style>
