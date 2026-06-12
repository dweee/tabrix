<template>
  <section class="mkep-tab mke-data-tab" :class="`mke-data-tab--${agentTheme}`">
    <div class="mke-shell">
      <div class="mke-controls" role="status" aria-live="polite">
        <div class="mke-tabs" role="tablist" aria-label="MKE data tables">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            class="mke-tab-button"
            :class="{ 'mke-tab-button--active': activeTab === tab.id }"
            role="tab"
            :aria-selected="activeTab === tab.id"
            @click="setActiveTab(tab.id)"
          >
            <span>{{ tab.label }}</span>
            <strong>{{ tab.total }}</strong>
          </button>
        </div>

        <div class="mke-toolbar" :class="{ 'mke-toolbar--object': activeTab === 'object' }">
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
              :aria-label="activeTab === 'object' ? '搜索对象库网页' : 'Search loaded MKE rows'"
              :placeholder="
                activeTab === 'object' ? '搜索网页、网址、状态' : '搜索主题、对象、方法、网址、状态'
              "
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
            </div>

            <div v-if="row.feedbackLine || row.feedbackScoreLabel" class="mke-record__feedback-row">
              <p v-if="row.feedbackLine" class="mke-record__feedback" :title="row.feedbackLine">
                {{ row.feedbackLine }}
              </p>
              <span
                v-if="row.feedbackScoreLabel"
                class="mke-feedback-score"
                title="AI 对这一步是否推进目标的评分。"
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
              <span
                class="mke-status"
                :class="[
                  `mke-status--${row.statusTone}`,
                  { 'mke-status--foreground': row.isForeground },
                ]"
              >
                <span v-if="row.isForeground" class="mke-status__pulse" aria-hidden="true"></span>
                {{ row.status }}
              </span>
            </div>
            <div v-if="isRecordExpanded(row.id)" class="mke-json-panel">
              <button
                type="button"
                class="mke-json-copy-button"
                :class="{
                  'mke-json-copy-button--copied': copiedRecordId === row.id,
                  'mke-json-copy-button--failed': copyFailedRecordId === row.id,
                }"
                :aria-label="`复制 ${row.title} 的 JSON 数据`"
                :title="
                  copiedRecordId === row.id
                    ? '已复制'
                    : copyFailedRecordId === row.id
                      ? '复制失败'
                      : '复制 JSON'
                "
                @click="copyRecordJson(row)"
              >
                <i-lucide-copy aria-hidden="true" />
                <span class="mke-visually-hidden">{{
                  copiedRecordId === row.id
                    ? '已复制'
                    : copyFailedRecordId === row.id
                      ? '复制失败'
                      : '复制 JSON'
                }}</span>
              </button>
              <pre :id="jsonPanelId(row.id)" class="mke-json-block">{{ row.detailJson }}</pre>
            </div>
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
  MkeBrowserObjectSummary,
  MkeExperienceRecipeSummary,
  MkeKnowledgeModelSummary,
  MkeMemoryTraceSummary,
} from '@tabrix/shared';
import {
  DEFAULT_MKE_PAGE_SIZE,
  fetchMkeBrowserObjects,
  fetchMkeExperienceRecipes,
  fetchMkeKnowledgeModels,
  fetchMkeMemoryTraces,
  MemoryApiError,
} from '../../../common/memory-api-client';
import { useAgentTheme } from '../../shared/composables/usePopupTheme';
import {
  buildMkeObjectLibraryView,
  type MkeObjectLibraryRuntimeContext,
  type MkeObjectWebPageView,
} from './mke-object-library-view';
import { resolveInitialMkeDataTabFromLocation, type MkeDataTabId } from './mke-data-tab-url';

const MKE_AUTO_REFRESH_MS = 5000;

type ActiveTab = MkeDataTabId;
type StatusTone = 'good' | 'warn' | 'neutral';
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
  isForeground?: boolean;
  facts: RecordFact[];
  detailJson: string;
  searchTokens?: string[];
  searchText: string;
}

const activeTab = ref<ActiveTab>(resolveInitialMkeDataTabFromLocation());
const searchQuery = ref('');
const loading = ref(false);
const loadError = ref('');
const loadErrorDetail = ref('');
const copiedRecordId = ref('');
const copyFailedRecordId = ref('');
const expandedRecordIds = ref<Set<string>>(new Set());
const { theme: agentTheme, initTheme } = useAgentTheme();
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;

const traces = ref<MkeMemoryTraceSummary[]>([]);
const browserObjects = ref<MkeBrowserObjectSummary[]>([]);
const liveForegroundTabId = ref<string | null>(null);
const knowledgeModels = ref<MkeKnowledgeModelSummary[]>([]);
const experienceRecipes = ref<MkeExperienceRecipeSummary[]>([]);
const totals = ref<Record<ActiveTab, number>>({
  memory: 0,
  object: 0,
  knowledge: 0,
  experience: 0,
});
const offsets = ref<Record<ActiveTab, number>>({
  memory: 0,
  object: 0,
  knowledge: 0,
  experience: 0,
});

const tabs = computed(() => [
  { id: 'memory' as const, label: '记忆库', total: totals.value.memory },
  { id: 'object' as const, label: '对象库', total: totals.value.object },
  { id: 'knowledge' as const, label: '知识库', total: totals.value.knowledge },
  { id: 'experience' as const, label: '经验库', total: totals.value.experience },
]);

const currentObjectLibraryRuntimeContext = computed<MkeObjectLibraryRuntimeContext>(() => ({
  foregroundTabId: liveForegroundTabId.value,
}));

const objectLibraryView = computed(() =>
  buildMkeObjectLibraryView(browserObjects.value, currentObjectLibraryRuntimeContext.value),
);

const activeRows = computed<ViewRecord[]>(() => {
  if (activeTab.value === 'memory') return traces.value.map(traceToRecord);
  if (activeTab.value === 'object')
    return objectLibraryView.value.webPages.map(objectWebPageToRecord);
  if (activeTab.value === 'knowledge') return knowledgeModels.value.map(knowledgeToRecord);
  return experienceRecipes.value.map(experienceToRecord);
});

const filteredRows = computed<ViewRecord[]>(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return activeRows.value;
  return activeRows.value.filter((row) => row.searchText.includes(query));
});

const activeTotal = computed(() => totals.value[activeTab.value]);

const activeLoadedCount = computed(() =>
  activeTab.value === 'object' ? offsets.value.object : activeRows.value.length,
);

const canLoadMore = computed(() => activeLoadedCount.value < activeTotal.value);

const loadMoreLabel = computed(() =>
  activeTab.value === 'object'
    ? '加载更多网页'
    : `加载更多 (${activeLoadedCount.value}/${activeTotal.value})`,
);

const activeTableInfo = computed(() => {
  if (activeTab.value === 'memory') {
    return {
      kicker: '工具调用记忆',
      label: '记忆库',
      description: '查看 AI 浏览器操作记录、AI评价、耗时和网址。',
    };
  }
  if (activeTab.value === 'object') {
    return {
      kicker: '浏览器网页对象',
      label: '对象库',
      description: '查看浏览器网页、网址和生命周期状态。',
    };
  }
  if (activeTab.value === 'knowledge') {
    return {
      kicker: '页面知识',
      label: '知识库',
      description: '查看从对象库沉淀出的页面知识。',
    };
  }
  return {
    kicker: '可复用经验',
    label: '经验库',
    description: '查看由 AI 评价沉淀出的可复用经验。',
  };
});

const activeEmptyText = computed(() => {
  if (activeTab.value === 'memory') return '记忆库暂无工具调用记录。';
  if (activeTab.value === 'object') return '对象库暂无浏览器网页记录。';
  if (activeTab.value === 'knowledge') return '知识库暂无页面知识。';
  return '经验库暂无可复用经验。';
});

function setActiveTab(tab: ActiveTab): void {
  activeTab.value = tab;
  syncMkeDataTabUrl(tab);
}

function syncMkeDataTabUrl(tab: ActiveTab): void {
  try {
    const location = globalThis.location;
    const history = globalThis.history;
    if (!location?.href || !history?.replaceState) return;
    const url = new URL(location.href);
    if (tab === 'memory') {
      url.searchParams.delete('mkeTab');
    } else {
      url.searchParams.set('mkeTab', tab);
    }
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // URL state is a test/deep-link convenience; UI tab state remains authoritative.
  }
}

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
    const objectLimit = Math.max(offsets.value.object, DEFAULT_MKE_PAGE_SIZE);
    const knowledgeLimit = Math.max(offsets.value.knowledge, DEFAULT_MKE_PAGE_SIZE);
    const experienceLimit = Math.max(offsets.value.experience, DEFAULT_MKE_PAGE_SIZE);
    const [memoryData, objectData, knowledgeData, experienceData, foregroundTabId] =
      await Promise.all([
        fetchMkeMemoryTraces({ limit: memoryLimit, offset: 0 }),
        fetchMkeBrowserObjects({ limit: objectLimit, offset: 0 }),
        fetchMkeKnowledgeModels({ limit: knowledgeLimit, offset: 0 }),
        fetchMkeExperienceRecipes({ limit: experienceLimit, offset: 0 }),
        readLiveForegroundTabId(),
      ]);
    traces.value = memoryData.traces;
    browserObjects.value = objectData.browserObjects;
    liveForegroundTabId.value = foregroundTabId;
    knowledgeModels.value = knowledgeData.knowledgeModels;
    experienceRecipes.value = experienceData.experienceRecipes;
    totals.value = {
      memory: memoryData.total,
      object: objectData.total,
      knowledge: knowledgeData.total,
      experience: experienceData.total,
    };
    offsets.value = {
      memory: memoryData.traces.length,
      object: objectData.browserObjects.length,
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

async function readLiveForegroundTabId(): Promise<string | null> {
  const tabsApi = globalThis.chrome?.tabs;
  if (!tabsApi?.query) return null;
  try {
    const [tab] = await tabsApi.query({ active: true, lastFocusedWindow: true });
    return typeof tab?.id === 'number' ? String(tab.id) : null;
  } catch {
    return null;
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
    if (activeTab.value === 'object') {
      const data = await fetchMkeBrowserObjects({
        limit: DEFAULT_MKE_PAGE_SIZE,
        offset: offsets.value.object,
      });
      browserObjects.value = [...browserObjects.value, ...data.browserObjects];
      totals.value.object = data.total;
      offsets.value.object = browserObjects.value.length;
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
    copyFailedRecordId.value = '';
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      if (copiedRecordId.value === row.id) copiedRecordId.value = '';
    }, 1200);
  } catch {
    copiedRecordId.value = '';
    copyFailedRecordId.value = row.id;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      if (copyFailedRecordId.value === row.id) copyFailedRecordId.value = '';
    }, 1400);
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
  const status = formatAiBusinessStatus(trace.aiFeedback?.businessStatus);
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
    statusTone: formatAiBusinessStatusTone(trace.aiFeedback?.businessStatus),
    facts: compactFacts([['方法', trace.toolName], formatTraceLocationFact(trace)]),
    detailJson: formatMemoryTraceJson(trace),
    searchTokens: [
      trace.toolName,
      formatAiBusinessStatus(trace.aiFeedback?.businessStatus),
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

function objectWebPageToRecord(webPage: MkeObjectWebPageView): ViewRecord {
  const row: Omit<ViewRecord, 'searchText'> = {
    id: webPage.id,
    kicker: '浏览器网页',
    title: webPage.title,
    metaLine: webPage.location,
    feedbackLine: '',
    feedbackScoreLabel: '',
    duration: '',
    createdAtLabel: formatDate(webPage.updatedAt),
    status: webPage.lifecycleLabel,
    statusTone: webPage.lifecycleTone,
    isForeground: webPage.lifecycleLabel === '前台页',
    facts: [],
    detailJson: formatObjectWebPageJson(webPage),
    searchTokens: [webPage.searchText],
  };
  return withSearchText(row);
}

function knowledgeToRecord(model: MkeKnowledgeModelSummary): ViewRecord {
  const lastUpdatedAt = formatDate(model.updatedAt);
  const row: Omit<ViewRecord, 'searchText'> = {
    id: model.knowledgeId,
    kicker: '页面知识',
    title: `${model.pageRole} · ${model.siteFamily}`,
    metaLine: `${model.pageModelKey} · ${lastUpdatedAt}`,
    feedbackLine: '',
    feedbackScoreLabel: '',
    duration: '',
    createdAtLabel: formatDate(model.updatedAt),
    status: model.observationCount > 0 ? '已沉淀' : '待沉淀',
    statusTone: model.observationCount > 0 ? 'good' : 'neutral',
    facts: compactFacts([['页面模型', model.pageModelKey]]),
    detailJson: formatKnowledgeDetailJson(model),
  };
  return withSearchText(row);
}

function experienceToRecord(recipe: MkeExperienceRecipeSummary): ViewRecord {
  const lastUpdatedAt = formatDate(recipe.updatedAt);
  const row: Omit<ViewRecord, 'searchText'> = {
    id: recipe.experienceId,
    kicker: '可复用经验',
    title: recipe.recipeName,
    metaLine: `${recipe.scenarioKey} · ${lastUpdatedAt}`,
    feedbackLine: '',
    feedbackScoreLabel: '',
    duration: '',
    createdAtLabel: formatDate(recipe.updatedAt),
    status: '可复用',
    statusTone: 'good',
    facts: compactFacts([['适用范围', recipe.portabilityScope]]),
    detailJson: formatExperienceDetailJson(recipe),
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

function compactFacts(entries: Array<[string, string | null | undefined] | null>): RecordFact[] {
  return entries
    .filter((entry): entry is [string, string | null | undefined] => entry !== null)
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

function formatMemoryTraceJson(trace: MkeMemoryTraceSummary): string {
  const feedback = trace.aiFeedback;
  return formatJsonDetail({
    title: trace.display?.title || formatTraceTitle(trace),
    method: trace.toolName,
    methodLabel: trace.display?.methodLabel || formatToolLabel(trace.toolName),
    intent: trace.taskIntent,
    requestAt: trace.requestAt,
    responseAt: trace.responseAt,
    durationMs: trace.durationMs,
    aiEvaluation: feedback
      ? {
          status: formatAiBusinessStatus(feedback.businessStatus),
          score:
            typeof feedback.confidence === 'number'
              ? `${Math.round(feedback.confidence * 100)}%`
              : null,
          summary: feedback.summary ?? null,
        }
      : null,
    page: {
      siteFamily: trace.siteFamily,
      pageUrlPattern: trace.pageUrlPattern,
      pageRole: trace.pageRole,
    },
    createdAt: trace.createdAt,
  });
}

function formatObjectWebPageJson(webPage: MkeObjectWebPageView): string {
  return formatJsonDetail({
    title: webPage.title,
    url: webPage.url ?? webPage.location,
    status: webPage.lifecycleLabel,
    tabId: webPage.tabId ?? null,
    detailReason: webPage.detailReason ?? null,
    updatedAt: webPage.updatedAt,
  });
}

function formatKnowledgeDetailJson(model: MkeKnowledgeModelSummary): string {
  return formatJsonDetail({
    title: `${model.pageRole} · ${model.siteFamily}`,
    siteFamily: model.siteFamily,
    pageRole: model.pageRole,
    pageModel: model.pageModelKey,
    status: model.observationCount > 0 ? '已沉淀' : '待沉淀',
    observed: model.observationCount,
    successfulUse: model.successfulUseCount,
    failedUse: model.failedUseCount,
    lastObservedAt: model.lastObservedAt,
    lastValidatedAt: model.lastValidatedAt,
    updatedAt: model.updatedAt,
  });
}

function formatExperienceDetailJson(recipe: MkeExperienceRecipeSummary): string {
  return formatJsonDetail({
    title: recipe.recipeName,
    scenario: recipe.scenarioKey,
    siteFamily: recipe.siteFamily,
    pageRole: recipe.pageRole,
    pageModel: recipe.pageModelKey,
    status: '可复用',
    portabilityScope: recipe.portabilityScope,
    lastUsedAt: recipe.lastUsedAt,
    lastVerifiedAt: recipe.lastVerifiedAt,
    updatedAt: recipe.updatedAt,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatAiBusinessStatus(value: string | null | undefined): string {
  if (value === 'achieved' || value === 'true') return 'AI通过';
  if (value === 'partial') return 'AI部分完成';
  if (value === 'not_achieved' || value === 'false') return 'AI未通过';
  return '待AI评价';
}

function formatAiBusinessStatusTone(businessValue: string | null | undefined): StatusTone {
  if (businessValue === 'achieved' || businessValue === 'true') return 'good';
  if (businessValue === 'not_achieved' || businessValue === 'false') return 'warn';
  return 'neutral';
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
    : 'AI评价：待AI评价';
}

function formatAiFeedbackScoreLabel(trace: MkeMemoryTraceSummary): string {
  const score = trace.aiFeedback?.confidence;
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
  --mke-font-xs: 11px;
  --mke-font-sm: 12px;
  --mke-font-md: 14px;
  --mke-weight-label: 600;
  --mke-weight-title: 650;
  --mke-weight-strong: 700;
  --mke-success-bg: #dcfce7;
  --mke-success-text: #166534;
  --mke-warn-bg: #fee2e2;
  --mke-warn-text: #991b1b;
  --mke-neutral-bg: #f1f5f9;
  --mke-neutral-text: #475569;
  --mke-json-bg: #08111f;
  --mke-json-text: #dbeafe;
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
  gap: 0;
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
  --mke-bg: #08111f;
  --mke-surface: #0d1726;
  --mke-surface-2: #111d2e;
  --mke-surface-3: #0a1422;
  --mke-border: rgba(148, 163, 184, 0.2);
  --mke-border-strong: rgba(148, 163, 184, 0.34);
  --mke-text: #e2e8f0;
  --mke-muted: #94a3b8;
  --mke-soft: #cbd5e1;
  --mke-accent: #60a5fa;
  --mke-accent-bg: rgba(37, 99, 235, 0.16);
  --mke-active-ring: rgba(96, 165, 250, 0.24);
  --mke-shadow: 0 14px 28px -24px rgba(0, 0, 0, 0.72);
  --mke-success-bg: rgba(22, 101, 52, 0.34);
  --mke-success-text: #86efac;
  --mke-warn-bg: rgba(127, 29, 29, 0.36);
  --mke-warn-text: #fca5a5;
  --mke-neutral-bg: rgba(51, 65, 85, 0.5);
  --mke-neutral-text: #cbd5e1;
  --mke-json-bg: rgba(3, 10, 24, 0.96);
  --mke-json-text: #dbeafe;
}

.mke-button {
  border: 1px solid var(--mke-border-strong);
  border-radius: 8px;
  background: var(--mke-surface);
  color: var(--mke-text);
  cursor: pointer;
  flex: 0 0 auto;
  font-size: var(--mke-font-sm);
  font-weight: var(--mke-weight-strong);
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
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-label);
}

.mke-toolbar {
  display: grid;
  align-items: center;
  gap: 8px;
  grid-template-columns: minmax(180px, 1fr) auto;
}

.mke-toolbar--object {
  grid-template-columns: minmax(180px, 1fr) auto;
}

.mke-search {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--mke-muted);
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-label);
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
  grid-template-columns: repeat(auto-fit, minmax(74px, 1fr));
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
  padding: 7px 8px;
}

.mke-tab-button span {
  display: block;
  font-size: var(--mke-font-sm);
  font-weight: var(--mke-weight-title);
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

.mke-record__title-row {
  align-items: center;
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  margin-bottom: 4px;
  min-width: 0;
}

.mke-record h3 {
  color: var(--mke-text);
  flex: 1 1 auto;
  font-size: var(--mke-font-md);
  line-height: 1.35;
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-record__meta-line {
  color: var(--mke-muted);
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-label);
  line-height: 1.35;
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}

.mke-record__feedback {
  border-left: 2px solid var(--mke-accent);
  color: var(--mke-soft);
  flex: 1 1 220px;
  font-size: var(--mke-font-sm);
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
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-label);
  line-height: 1.2;
  padding: 4px 7px;
  white-space: nowrap;
}

.mke-feedback-score {
  color: var(--mke-accent);
}

.mke-status {
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 5px;
  max-width: 100%;
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-strong);
  line-height: 1.2;
  padding: 4px 7px;
  white-space: nowrap;
}

.mke-status--good {
  background: var(--mke-success-bg);
  color: var(--mke-success-text);
}

.mke-status--foreground {
  background: #bbf7d0;
  border-color: rgba(16, 185, 129, 0.34);
  color: #047857;
}

.mke-status__pulse {
  animation: mke-foreground-pulse 1.45s ease-in-out infinite;
  background: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.42);
  flex: 0 0 auto;
  height: 7px;
  width: 7px;
}

@keyframes mke-foreground-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.38);
    opacity: 1;
  }

  50% {
    box-shadow: 0 0 0 5px rgba(16, 185, 129, 0);
    opacity: 0.68;
  }
}

.mke-status--warn {
  background: var(--mke-warn-bg);
  color: var(--mke-warn-text);
}

.mke-status--neutral {
  background: var(--mke-neutral-bg);
  color: var(--mke-neutral-text);
}

.mke-data-tab--dark-console .mke-status--good {
  border-color: rgba(74, 222, 128, 0.28);
  background: var(--mke-success-bg);
  color: var(--mke-success-text);
}

.mke-data-tab--dark-console .mke-status--foreground {
  background: rgba(16, 185, 129, 0.22);
  border-color: rgba(74, 222, 128, 0.36);
  color: #86efac;
}

.mke-data-tab--dark-console .mke-status--warn {
  border-color: rgba(248, 113, 113, 0.3);
  background: var(--mke-warn-bg);
  color: var(--mke-warn-text);
}

.mke-data-tab--dark-console .mke-status--neutral {
  border-color: rgba(148, 163, 184, 0.3);
  background: var(--mke-neutral-bg);
  color: var(--mke-neutral-text);
}

@media (prefers-reduced-motion: reduce) {
  .mke-status__pulse {
    animation: none;
  }
}

.mke-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}

.mke-facts > div {
  align-items: baseline;
  background: var(--mke-surface-2);
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  display: inline-flex;
  flex-wrap: nowrap;
  gap: 5px;
  min-height: 26px;
  min-width: 0;
  max-width: 100%;
  padding: 4px 8px;
}

.mke-facts span {
  color: var(--mke-muted);
  display: inline-block;
  font-size: var(--mke-font-xs);
  line-height: 1.2;
  white-space: nowrap;
}

.mke-facts strong {
  color: var(--mke-text);
  font-size: var(--mke-font-sm);
  font-weight: var(--mke-weight-label);
  line-height: 1.2;
  margin: 0;
}

.mke-facts strong {
  max-width: min(360px, calc(100vw - 180px));
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-record-actions {
  border-top: 1px solid var(--mke-border);
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(118px, 1fr) auto;
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
.mke-json-copy-button {
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  background: var(--mke-surface-2);
  color: var(--mke-soft);
  cursor: pointer;
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-strong);
  line-height: 1.2;
  padding: 4px 9px;
  white-space: nowrap;
}

.mke-detail-button {
  color: var(--mke-accent);
  justify-self: start;
  min-width: 54px;
}

.mke-status {
  justify-self: end;
}

.mke-detail-button:hover,
.mke-json-copy-button:hover {
  border-color: var(--mke-border-strong);
  color: var(--mke-text);
}

.mke-json-panel {
  margin-top: 8px;
  position: relative;
}

.mke-json-copy-button {
  align-items: center;
  display: inline-flex;
  height: 30px;
  justify-content: center;
  padding: 0;
  position: absolute;
  right: 20px;
  top: 10px;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    transform 140ms ease;
  width: 30px;
  z-index: 1;
}

.mke-json-copy-button svg {
  height: 13px;
  width: 13px;
}

.mke-json-copy-button--copied {
  animation: mke-copy-pop 180ms ease-out;
  background: var(--mke-good-bg);
  border-color: var(--mke-good-border);
  color: var(--mke-good-text);
}

.mke-json-copy-button--failed {
  background: var(--mke-warn-bg);
  border-color: var(--mke-warn-border);
  color: var(--mke-warn-text);
}

.mke-json-copy-button--copied::after,
.mke-json-copy-button--failed::after {
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  color: var(--mke-text);
  content: '已复制';
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-strong);
  line-height: 1;
  padding: 5px 8px;
  position: absolute;
  right: 36px;
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
}

.mke-json-copy-button--failed::after {
  content: '复制失败';
}

@keyframes mke-copy-pop {
  0% {
    transform: scale(1);
  }
  55% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}

.mke-json-block {
  background: var(--mke-json-bg);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-json-text);
  font-size: var(--mke-font-xs);
  margin: 0;
  max-height: 380px;
  max-width: 100%;
  overflow: auto;
  overflow-wrap: anywhere;
  padding: 12px 58px 12px 12px;
  white-space: pre-wrap;
  width: 100%;
  word-break: break-word;
}

.mke-button:focus-visible,
.mke-tab-button:focus-visible,
.mke-search input:focus-visible,
.mke-detail-button:focus-visible,
.mke-json-copy-button:focus-visible {
  outline: 2px solid var(--mke-accent);
  outline-offset: 2px;
}

.mke-load-more {
  align-self: stretch;
}

@media (max-width: 520px) {
  .mke-data-tab {
    overflow-x: hidden;
  }

  .mke-shell {
    gap: 0;
    padding: 10px;
  }

  .mke-record__top > div {
    max-width: 100%;
  }

  .mke-button {
    max-width: 100%;
  }

  .mke-status {
    max-width: 100%;
    white-space: nowrap;
  }

  .mke-record h3 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mke-record-actions {
    grid-template-columns: auto minmax(108px, 1fr) auto;
  }

  .mke-facts strong {
    max-width: 100%;
    overflow-wrap: anywhere;
  }
}

@media (max-width: 390px) {
  .mke-toolbar--object {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}

@media (max-width: 340px) {
  .mke-record-actions {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }

  .mke-record-time {
    font-size: 10px;
  }
}
</style>
