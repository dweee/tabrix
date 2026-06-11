<template>
  <section class="mkep-tab mke-data-tab" :class="`mke-data-tab--${agentTheme}`">
    <div class="mke-shell">
      <div class="mke-controls" role="status" aria-live="polite">
        <template v-if="activeTab === 'object'">
          <header class="mke-object-header">
            <div class="mke-object-title">
              <span class="mke-object-logo" aria-hidden="true">
                <i-lucide-database />
              </span>
              <div>
                <h2>Tabrix · 对象库</h2>
                <p>浏览器标签页、页面对象、可操作目标和生命周期现场</p>
              </div>
            </div>
            <div class="mke-object-header__actions">
              <button
                type="button"
                class="mke-icon-button"
                :disabled="loading"
                title="刷新对象库"
                @click="refreshAll()"
              >
                <i-lucide-refresh-cw aria-hidden="true" />
                <span class="mke-visually-hidden">刷新对象库</span>
              </button>
              <button
                type="button"
                class="mke-icon-button"
                :class="{ 'mke-icon-button--active': personalBrowserStateStorageEnabled }"
                :aria-pressed="personalBrowserStateStorageEnabled"
                :disabled="preferenceLoading"
                :title="
                  personalBrowserStateStorageEnabled
                    ? '个人浏览状态存储已开启'
                    : '个人浏览状态存储已关闭'
                "
                @click="togglePersonalBrowserStateStorage"
              >
                <i-lucide-shield-check aria-hidden="true" />
                <span class="mke-visually-hidden">切换个人浏览状态存储</span>
              </button>
            </div>
          </header>

          <div class="mke-object-summary-bar" role="status" aria-live="polite">
            <div class="mke-object-summary-card mke-object-summary-card--live">
              <span class="mke-object-summary-card__dot" aria-hidden="true"></span>
              <strong>{{ objectLibraryView.summary.liveLabel }}</strong>
            </div>
            <div class="mke-object-summary-card">
              <i-lucide-panel-top aria-hidden="true" />
              <span>已打开</span>
              <strong>{{ objectLibraryView.summary.openWebPages }}</strong>
            </div>
            <div class="mke-object-summary-card">
              <i-lucide-clock-3 aria-hidden="true" />
              <span>最近关闭</span>
              <strong>{{ objectLibraryView.summary.closedWebPages }}</strong>
            </div>
            <div class="mke-object-summary-card">
              <i-lucide-mouse-pointer-click aria-hidden="true" />
              <span>可操作</span>
              <strong>{{ objectLibraryView.summary.actions }}</strong>
            </div>
          </div>

          <div class="mke-object-toolbar">
            <div class="mke-object-toolbar__title">
              <h3>当前网页</h3>
              <span
                :title="
                  personalBrowserStateStorageEnabled
                    ? '已开启，保存完整当前路由'
                    : '已关闭，仅保存最小页面身份'
                "
              >
                {{
                  personalBrowserStateStorageEnabled ? '个人状态存储已开启' : '个人状态存储已关闭'
                }}
              </span>
            </div>
            <label class="mke-search mke-object-search">
              <span class="mke-visually-hidden">搜索当前网页对象</span>
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
                aria-label="搜索对象库网页"
                placeholder="搜索网页、对象、功能、网址、状态"
              />
            </label>
            <button type="button" class="mke-filter-button" title="当前按最近活跃排序">
              <i-lucide-arrow-down-wide-narrow aria-hidden="true" />
              <span>最近活跃</span>
            </button>
          </div>
        </template>

        <template v-else>
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
                placeholder="搜索主题、对象、方法、网址、状态"
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
        </template>

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
        <div
          v-else-if="activeTab === 'object' && filteredObjectWebPages.length === 0"
          class="mke-empty"
        >
          {{ searchQuery ? '没有匹配当前搜索的网页对象。' : activeEmptyText }}
        </div>
        <div v-else-if="activeTab !== 'object' && filteredRows.length === 0" class="mke-empty">
          {{ searchQuery ? '没有匹配当前搜索的记录。' : activeEmptyText }}
        </div>

        <section v-else-if="activeTab === 'object'" class="mke-object-workspace">
          <ol class="mke-webpage-list" aria-label="当前网页列表">
            <li v-for="webPage in filteredObjectWebPages" :key="webPage.id">
              <button
                type="button"
                class="mke-webpage-row"
                :class="{
                  'mke-webpage-row--active': selectedObjectWebPage?.id === webPage.id,
                  'mke-webpage-row--closed': webPage.isClosed,
                }"
                :aria-pressed="selectedObjectWebPage?.id === webPage.id"
                @click="selectObjectWebPage(webPage.id)"
              >
                <span class="mke-webpage-row__icon" aria-hidden="true">
                  <i-lucide-globe-2 v-if="!webPage.isActive && !webPage.isClosed" />
                  <i-lucide-circle-check v-else-if="webPage.isActive" />
                  <i-lucide-circle-slash v-else />
                </span>
                <span class="mke-webpage-row__copy">
                  <strong :title="webPage.title">{{ webPage.title }}</strong>
                  <span :title="webPage.location">{{ webPage.location }}</span>
                </span>
                <span class="mke-webpage-row__metrics" aria-label="网页对象统计">
                  <small v-for="metric in webPage.metrics" :key="metric.label">
                    {{ metric.label }} {{ metric.value }}
                  </small>
                </span>
                <span
                  class="mke-status mke-webpage-row__status"
                  :class="`mke-status--${webPage.lifecycleTone}`"
                >
                  {{ webPage.lifecycleLabel }}
                </span>
                <i-lucide-more-vertical class="mke-webpage-row__more" aria-hidden="true" />
              </button>
            </li>
          </ol>

          <article v-if="selectedObjectWebPage" class="mke-webpage-detail">
            <header class="mke-webpage-detail__header">
              <span class="mke-webpage-detail__icon" aria-hidden="true">
                <i-lucide-globe-2 />
              </span>
              <div>
                <span>选中网页</span>
                <h3 :title="selectedObjectWebPage.title">{{ selectedObjectWebPage.title }}</h3>
                <p :title="selectedObjectWebPage.location">{{ selectedObjectWebPage.location }}</p>
              </div>
              <button
                type="button"
                class="mke-icon-button mke-webpage-detail__close"
                title="回到 MKE 总览"
                @click="setActiveTab('memory')"
              >
                <i-lucide-x aria-hidden="true" />
                <span class="mke-visually-hidden">回到 MKE 总览</span>
              </button>
            </header>

            <nav class="mke-object-detail-tabs" aria-label="对象库详情分组">
              <button
                v-for="section in selectedObjectWebPage.sections"
                :key="section.id"
                type="button"
                :class="{ 'mke-object-detail-tab--active': section.id === 'pageObjects' }"
              >
                <i-lucide-layout-grid v-if="section.id === 'pageObjects'" aria-hidden="true" />
                <i-lucide-mouse-pointer-click
                  v-else-if="section.id === 'actions'"
                  aria-hidden="true"
                />
                <i-lucide-database v-else-if="section.id === 'dataApi'" aria-hidden="true" />
                <i-lucide-history v-else aria-hidden="true" />
                <span>{{ section.title }}</span>
                <strong>{{ section.badge }}</strong>
              </button>
            </nav>

            <section class="mke-object-count-grid" aria-label="页面对象">
              <div
                v-for="item in objectSectionPreview(selectedObjectWebPage, 'pageObjects', 4)"
                :key="`page-object-${item.label}`"
                class="mke-object-count-card"
              >
                <span class="mke-object-count-card__icon" aria-hidden="true">
                  <i-lucide-layout-grid />
                </span>
                <span>{{ item.label }}</span>
                <strong>{{ item.value.replace(' 个', '') }}</strong>
              </div>
              <p
                v-if="objectSection(selectedObjectWebPage, 'pageObjects')?.items.length === 0"
                class="mke-object-empty-line"
              >
                {{ objectSection(selectedObjectWebPage, 'pageObjects')?.emptyText }}
              </p>
            </section>

            <section class="mke-object-strip" aria-label="可操作功能">
              <div class="mke-object-strip__header">
                <strong>可操作功能</strong>
                <span>{{ objectSection(selectedObjectWebPage, 'actions')?.badge }}</span>
              </div>
              <div
                v-if="objectSection(selectedObjectWebPage, 'actions')?.items.length"
                class="mke-object-action-list"
              >
                <span
                  v-for="item in objectSectionPreview(selectedObjectWebPage, 'actions', 5)"
                  :key="`action-${item.label}-${item.value}`"
                  class="mke-object-action-chip"
                  :class="item.tone ? `mke-object-action-chip--${item.tone}` : ''"
                >
                  <i-lucide-mouse-pointer-click aria-hidden="true" />
                  {{ item.label }}
                  <strong>{{ item.value }}</strong>
                </span>
              </div>
              <p v-else class="mke-object-empty-line">
                {{ objectSection(selectedObjectWebPage, 'actions')?.emptyText }}
              </p>
            </section>

            <section class="mke-object-strip" aria-label="数据/API 接口">
              <div class="mke-object-strip__header">
                <strong>数据/API 接口</strong>
                <span>{{ objectSection(selectedObjectWebPage, 'dataApi')?.badge }}</span>
              </div>
              <div
                v-if="objectSection(selectedObjectWebPage, 'dataApi')?.items.length"
                class="mke-object-api-list"
              >
                <div
                  v-for="item in objectSectionPreview(selectedObjectWebPage, 'dataApi', 6)"
                  :key="`api-${item.label}-${item.value}`"
                  class="mke-object-api-row"
                >
                  <span>DATA</span>
                  <strong>{{ item.label }}</strong>
                  <em>{{ item.value }}</em>
                </div>
              </div>
              <p v-else class="mke-object-empty-line">
                {{ objectSection(selectedObjectWebPage, 'dataApi')?.emptyText }}
              </p>
            </section>

            <section class="mke-object-strip" aria-label="生命周期状态">
              <div class="mke-object-strip__header">
                <strong>生命周期状态</strong>
                <time>{{ formatDate(selectedObjectWebPage.updatedAt) }}</time>
              </div>
              <ol class="mke-object-lifecycle">
                <li
                  v-for="item in objectSectionPreview(selectedObjectWebPage, 'lifecycle', 5)"
                  :key="`lifecycle-${item.label}-${item.value}`"
                  :class="item.tone ? `mke-object-lifecycle--${item.tone}` : ''"
                >
                  <span aria-hidden="true"></span>
                  <strong>{{ item.value }}</strong>
                  <small>{{ item.label }}</small>
                </li>
              </ol>
            </section>

            <footer class="mke-object-footer-actions">
              <button type="button" class="mke-object-footer-button" @click="refreshAll()">
                <i-lucide-refresh-cw aria-hidden="true" />
                刷新现场
              </button>
              <button
                type="button"
                class="mke-object-footer-button"
                :disabled="loading || preferenceLoading || totals.object === 0"
                title="只清除对象库，不影响记忆库、知识库、经验库"
                @click="clearObjectLibrary"
              >
                <i-lucide-trash-2 aria-hidden="true" />
                清除对象库
              </button>
              <button
                type="button"
                class="mke-object-footer-button mke-object-footer-button--primary"
                @click="setActiveTab('memory')"
              >
                <i-lucide-database aria-hidden="true" />
                打开 MKE
              </button>
            </footer>

            <div class="mke-record-actions mke-webpage-detail__actions">
              <button
                type="button"
                class="mke-detail-button"
                :aria-expanded="isRecordExpanded(selectedObjectWebPage.id)"
                :aria-controls="jsonPanelId(selectedObjectWebPage.id)"
                @click="toggleRecordJson(selectedObjectWebPage.id)"
              >
                {{ isRecordExpanded(selectedObjectWebPage.id) ? '收起' : '详情' }}
              </button>
              <time class="mke-record-time">{{ formatDate(selectedObjectWebPage.updatedAt) }}</time>
              <button
                type="button"
                class="mke-detail-button"
                @click="copyObjectWebPageJson(selectedObjectWebPage)"
              >
                复制 JSON
              </button>
            </div>

            <div v-if="isRecordExpanded(selectedObjectWebPage.id)" class="mke-json-panel">
              <pre :id="jsonPanelId(selectedObjectWebPage.id)" class="mke-json-block">{{
                formatObjectWebPageJson(selectedObjectWebPage)
              }}</pre>
            </div>
          </article>
        </section>

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
              <span class="mke-status" :class="`mke-status--${row.statusTone}`">
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
  clearMkeBrowserObjects,
  fetchMkeBrowserObjects,
  fetchMkeExperienceRecipes,
  fetchMkeKnowledgeModels,
  fetchMkeMemoryTraces,
  fetchMkeObjectStoragePreferences,
  MemoryApiError,
  updateMkeObjectStoragePreferences,
} from '../../../common/memory-api-client';
import { useAgentTheme } from '../../shared/composables/usePopupTheme';
import {
  buildMkeObjectLibraryView,
  type MkeObjectViewSection,
  type MkeObjectWebPageView,
} from './mke-object-library-view';
import { resolveInitialMkeDataTabFromLocation, type MkeDataTabId } from './mke-data-tab-url';

const MKE_AUTO_REFRESH_MS = 5000;

type ActiveTab = MkeDataTabId;
type StatusTone = 'good' | 'warn' | 'neutral';
type TraceBusinessStatus = NonNullable<MkeMemoryTraceSummary['statusView']>['businessStatus'];
type TraceExecutionStatus = NonNullable<MkeMemoryTraceSummary['statusView']>['executionStatus'];
type MkeObjectSectionId = MkeObjectViewSection['id'];

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

const activeTab = ref<ActiveTab>(resolveInitialMkeDataTabFromLocation());
const searchQuery = ref('');
const loading = ref(false);
const loadError = ref('');
const loadErrorDetail = ref('');
const preferenceLoading = ref(false);
const personalBrowserStateStorageEnabled = ref(false);
const copiedRecordId = ref('');
const copyFailedRecordId = ref('');
const expandedRecordIds = ref<Set<string>>(new Set());
const selectedObjectWebPageId = ref('');
const { theme: agentTheme, initTheme } = useAgentTheme();
let copyResetTimer: ReturnType<typeof setTimeout> | null = null;
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let refreshInFlight = false;

const traces = ref<MkeMemoryTraceSummary[]>([]);
const browserObjects = ref<MkeBrowserObjectSummary[]>([]);
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

const objectLibraryView = computed(() => buildMkeObjectLibraryView(browserObjects.value));

const filteredObjectWebPages = computed(() => {
  const query = searchQuery.value.toLowerCase();
  if (!query) return objectLibraryView.value.webPages;
  return objectLibraryView.value.webPages.filter((webPage) => webPage.searchText.includes(query));
});

const selectedObjectWebPage = computed<MkeObjectWebPageView | null>(() => {
  const pages = filteredObjectWebPages.value;
  if (pages.length === 0) return null;
  return pages.find((webPage) => webPage.id === selectedObjectWebPageId.value) ?? pages[0];
});

const activeRows = computed<ViewRecord[]>(() => {
  if (activeTab.value === 'memory') return traces.value.map(traceToRecord);
  if (activeTab.value === 'object') return browserObjects.value.map(objectToRecord);
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
  if (activeTab.value === 'object') {
    return {
      kicker: 'Browser objects / 浏览器对象',
      label: '对象库',
      description: '查看当前浏览器窗口、标签、页面对象和处理状态。',
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
  if (activeTab.value === 'object') return '对象库暂无浏览器对象 / No browser objects yet.';
  if (activeTab.value === 'knowledge') return '知识库暂无页面模型 / No knowledge models yet.';
  return '经验库暂无复用经验 / No experience recipes yet.';
});

function setActiveTab(tab: ActiveTab): void {
  activeTab.value = tab;
  syncMkeDataTabUrl(tab);
}

function selectObjectWebPage(id: string): void {
  selectedObjectWebPageId.value = id;
}

function objectSection(
  webPage: MkeObjectWebPageView,
  sectionId: MkeObjectSectionId,
): MkeObjectViewSection | null {
  return webPage.sections.find((section) => section.id === sectionId) ?? null;
}

function objectSectionPreview(
  webPage: MkeObjectWebPageView,
  sectionId: MkeObjectSectionId,
  limit: number,
): MkeObjectViewSection['items'] {
  return objectSection(webPage, sectionId)?.items.slice(0, limit) ?? [];
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
    const [memoryData, objectData, knowledgeData, experienceData, preferenceData] =
      await Promise.all([
        fetchMkeMemoryTraces({ limit: memoryLimit, offset: 0 }),
        fetchMkeBrowserObjects({ limit: objectLimit, offset: 0, scope: 'object-graph' }),
        fetchMkeKnowledgeModels({ limit: knowledgeLimit, offset: 0 }),
        fetchMkeExperienceRecipes({ limit: experienceLimit, offset: 0 }),
        fetchMkeObjectStoragePreferences(),
      ]);
    traces.value = memoryData.traces;
    browserObjects.value = objectData.browserObjects;
    knowledgeModels.value = knowledgeData.knowledgeModels;
    experienceRecipes.value = experienceData.experienceRecipes;
    personalBrowserStateStorageEnabled.value = preferenceData.personalBrowserStateStorageEnabled;
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

async function togglePersonalBrowserStateStorage(): Promise<void> {
  if (preferenceLoading.value) return;
  preferenceLoading.value = true;
  loadError.value = '';
  loadErrorDetail.value = '';
  const nextEnabled = !personalBrowserStateStorageEnabled.value;
  try {
    const data = await updateMkeObjectStoragePreferences({
      personalBrowserStateStorageEnabled: nextEnabled,
    });
    personalBrowserStateStorageEnabled.value = data.personalBrowserStateStorageEnabled;
    await refreshAll({ silent: true });
  } catch (error) {
    const formatted = formatError(error);
    loadError.value = formatted.title;
    loadErrorDetail.value = formatted.detail;
  } finally {
    preferenceLoading.value = false;
  }
}

async function clearObjectLibrary(): Promise<void> {
  const confirmed = globalThis.confirm
    ? globalThis.confirm('只清除对象库当前记录，不影响记忆库、知识库、经验库。继续？')
    : true;
  if (!confirmed) return;

  preferenceLoading.value = true;
  loadError.value = '';
  loadErrorDetail.value = '';
  try {
    const data = await clearMkeBrowserObjects();
    browserObjects.value = [];
    totals.value.object = data.total;
    offsets.value.object = 0;
    expandedRecordIds.value = new Set();
    await refreshAll({ silent: true });
  } catch (error) {
    const formatted = formatError(error);
    loadError.value = formatted.title;
    loadErrorDetail.value = formatted.detail;
  } finally {
    preferenceLoading.value = false;
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
        scope: 'object-graph',
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

async function copyObjectWebPageJson(webPage: MkeObjectWebPageView): Promise<void> {
  try {
    await writeClipboard(formatObjectWebPageJson(webPage));
    copiedRecordId.value = webPage.id;
    copyFailedRecordId.value = '';
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      if (copiedRecordId.value === webPage.id) copiedRecordId.value = '';
    }, 1200);
  } catch {
    copiedRecordId.value = '';
    copyFailedRecordId.value = webPage.id;
    if (copyResetTimer) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      if (copyFailedRecordId.value === webPage.id) copyFailedRecordId.value = '';
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
      ['执行', formatToolStatus(trace.statusView?.executionStatus, trace.toolSuccess)],
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

function objectToRecord(object: MkeBrowserObjectSummary): ViewRecord {
  const status = formatObjectStatus(object);
  const location =
    object.currentRoute ||
    object.pageIdentity?.url ||
    object.display?.locationLabel ||
    object.pageIdentity?.label ||
    object.siteFamily;
  const locationLabel = formatObjectLocation(
    compactText(location ?? '', 96),
    object.pageIdentity?.kind,
  );
  const row: Omit<ViewRecord, 'searchText'> = {
    id: object.browserObjectId,
    kicker: '对象事实',
    title: formatObjectCardTitle(object),
    metaLine: formatObjectMetaLine(object, locationLabel),
    feedbackLine: object.claimBoundary ? `边界：${compactText(object.claimBoundary, 88)}` : '',
    feedbackScoreLabel: formatObjectConfidenceLabel(object.confidenceScore),
    duration: '',
    createdAtLabel: formatDate(object.updatedAt),
    status,
    statusTone: formatObjectStatusTone(object),
    facts: formatObjectFacts(object),
    detailJson: formatJsonDetail(object),
    searchTokens: [
      object.objectType,
      object.siteFamily,
      object.rootRoute,
      object.currentRoute,
      object.pageUrlPattern,
      object.pageRole,
      object.pageModelKey,
      object.sourceRoute,
      object.selectedDataSource,
      object.sourceFreshness,
      object.lifecycleState,
      object.tabStatus,
      object.ownerType,
      readObjectFactString(object, 'titleSummary'),
      object.display?.title,
      object.display?.subtitle,
      object.display?.locationLabel,
      object.pageIdentity?.url,
      object.primaryConclusion,
      object.claimBoundary,
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

function formatObjectWebPageJson(webPage: MkeObjectWebPageView): string {
  return formatJsonDetail({
    id: webPage.id,
    title: webPage.title,
    location: webPage.location,
    lifecycleLabel: webPage.lifecycleLabel,
    activityLabel: webPage.activityLabel,
    metrics: webPage.metrics,
    sections: webPage.sections,
    objects: webPage.objects,
  });
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

const OBJECT_TYPE_NAMES: Record<string, string> = {
  window: '窗口',
  tab: '网页',
  page: '页面',
  region: '区域',
  action_target: '操作对象',
  data_source: '数据源',
};

function formatObjectType(value: string): string {
  return OBJECT_TYPE_NAMES[value] ?? value;
}

function formatObjectCardTitle(object: MkeBrowserObjectSummary): string {
  if (object.objectType === 'window') return formatWindowObjectTitle(object);
  const type = formatObjectType(object.objectType);
  if (object.objectType === 'tab') {
    const tabTitle = readObjectFactString(object, 'titleSummary');
    if (tabTitle) return compactText(tabTitle, 42);
    if (object.display?.title) return compactText(object.display.title, 42);
    if (object.pageIdentity?.label) return `${object.pageIdentity.label} 网页`;
  }
  if (object.display?.title) return object.display.title;
  if (object.pageRole) return `${type} · ${object.pageRole}`;
  return type;
}

function formatWindowObjectTitle(object: MkeBrowserObjectSummary): string {
  const tabCount = readObjectFactNumber(object, 'tabCount');
  const state = formatWindowState(readObjectFactString(object, 'state'));
  const parts = [
    object.isActive ? '当前浏览器窗口' : '浏览器窗口',
    tabCount === null ? null : `${tabCount} 个标签`,
    state,
  ].filter(isPresentString);
  return parts.join(' · ');
}

function formatObjectMetaLine(
  object: MkeBrowserObjectSummary,
  locationLabel: string | null,
): string {
  if (object.objectType === 'tab' && locationLabel) return locationLabel;
  if (object.objectType === 'window') {
    const activeTabId = readObjectFactNumber(object, 'activeTabId');
    const reason = formatOperabilityReason(object.operabilityReason);
    const parts = [
      object.isActive ? '当前聚焦窗口' : null,
      activeTabId === null ? null : `当前标签已识别`,
      object.canTabrixOperate === false && reason ? reason : null,
    ].filter(isPresentString);
    return parts.join(' · ');
  }
  if (object.primaryConclusion) return compactText(object.primaryConclusion, 72);
  if (locationLabel) return locationLabel;
  return '';
}

function formatObjectFacts(object: MkeBrowserObjectSummary): RecordFact[] {
  if (object.objectType === 'window') {
    return compactFacts([
      ['标签', formatObjectTabCount(object)],
      object.isActive === true ? ['标记', '当前窗口'] : null,
      ['窗口状态', formatWindowState(readObjectFactString(object, 'state'))],
    ]);
  }
  if (object.objectType === 'tab') {
    return compactFacts([
      object.isActive === true ? ['标记', '当前页'] : null,
      ['状态', formatObjectRuntimeState(object)],
      ['打开方', formatObjectOwner(object.ownerType)],
    ]);
  }
  return compactFacts([
    ['类型', formatObjectType(object.objectType)],
    ['状态', formatObjectRuntimeState(object)],
  ]);
}

function formatObjectStatus(object: MkeBrowserObjectSummary): string {
  if (object.lifecycleState === 'closed' || object.lifecycleState === 'removed') return '已关闭';
  if (object.sourceFreshness === 'stale') return '需刷新';
  if (object.canTabrixOperate === true) return '可继续处理';
  if (object.canTabrixOperate === false) return '不可处理';
  return '待观察';
}

function formatObjectStatusTone(object: MkeBrowserObjectSummary): StatusTone {
  if (object.canTabrixOperate === true && object.sourceFreshness !== 'stale') return 'good';
  if (
    object.canTabrixOperate === false ||
    object.lifecycleState === 'closed' ||
    object.lifecycleState === 'removed' ||
    object.sourceFreshness === 'stale'
  ) {
    return 'warn';
  }
  return 'neutral';
}

function formatObjectFreshness(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'fresh') return '新鲜';
  if (value === 'stale') return '过期';
  if (value === 'unknown') return '未知';
  return value;
}

function readObjectFacts(object: MkeBrowserObjectSummary): Record<string, unknown> {
  return object.facts && typeof object.facts === 'object' && !Array.isArray(object.facts)
    ? object.facts
    : {};
}

function readObjectFactString(object: MkeBrowserObjectSummary, key: string): string | null {
  const value = readObjectFacts(object)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readObjectFactNumber(object: MkeBrowserObjectSummary, key: string): number | null {
  const value = readObjectFacts(object)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatWindowState(value: string | null): string | null {
  if (!value) return null;
  if (value === 'maximized' || value === 'normal') return null;
  if (value === 'minimized') return '最小化';
  if (value === 'fullscreen') return '全屏';
  return value;
}

function formatObjectRuntimeState(object: MkeBrowserObjectSummary): string | null {
  if (object.lifecycleState === 'closed' || object.lifecycleState === 'removed') return '已关闭';
  if (object.sourceFreshness === 'stale') return '需刷新';
  if (object.tabStatus === 'loading') return '加载中';
  return null;
}

function formatObjectTabCount(object: MkeBrowserObjectSummary): string | null {
  const tabCount = readObjectFactNumber(object, 'tabCount');
  return tabCount === null ? null : `${tabCount} 个`;
}

function formatObjectOwner(value: string | null | undefined): string | null {
  if (!value) return null;
  const owners: Record<string, string> = {
    ai: 'AI打开',
    ai_or_page: 'AI打开',
    page: '用户打开',
    user: '用户打开',
    user_or_page: '用户打开',
    unknown: '未知来源',
  };
  return owners[value] ?? value.replace(/_/g, '/');
}

function formatOperabilityReason(value: string | null | undefined): string | null {
  if (!value) return null;
  const reasons: Record<string, string> = {
    active_tab_not_operable: '当前标签不可操作',
    active_tab_not_observed: '未识别当前标签',
    active_window_not_observed: '未识别当前窗口',
    browser_internal_page: '浏览器内部页',
    regular_web_page: '普通网页',
    tab_not_observed: '未观察到标签',
    window_minimized: '窗口已最小化',
  };
  return reasons[value] ?? value.replace(/_/g, ' ');
}

function formatObjectConfidenceLabel(value: number | null | undefined): string {
  return typeof value === 'number' ? `可信度 ${Math.round(value * 100)}%` : '';
}

function formatObjectLocation(
  value: string | null | undefined,
  kind: string | null | undefined,
): string | null {
  if (!value) return null;
  if (kind === 'extension') return value;
  if (kind === 'browser_internal') return value;
  if (value === 'browser') return '浏览器';
  if (value === 'unknown') return null;
  return value;
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
  return '待AI回写';
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

.mke-object-header {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-width: 0;
  padding: 2px 0 0;
}

.mke-object-title {
  align-items: center;
  display: flex;
  gap: 10px;
  min-width: 0;
}

.mke-object-logo {
  align-items: center;
  background: #f7d7ca;
  border-radius: 8px;
  color: #c65d3d;
  display: inline-flex;
  flex: 0 0 auto;
  height: 32px;
  justify-content: center;
  width: 32px;
}

.mke-object-logo svg,
.mke-icon-button svg,
.mke-filter-button svg,
.mke-object-footer-button svg {
  height: 16px;
  width: 16px;
}

.mke-object-title h2 {
  color: var(--mke-text);
  font-size: 20px;
  font-weight: 700;
  line-height: 1.15;
  margin: 0;
}

.mke-object-title p {
  color: var(--mke-muted);
  font-size: 11px;
  line-height: 1.35;
  margin: 3px 0 0;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-header__actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 8px;
}

.mke-icon-button {
  align-items: center;
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-soft);
  cursor: pointer;
  display: inline-flex;
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;
}

.mke-icon-button--active,
.mke-icon-button:hover {
  border-color: var(--mke-border-strong);
  color: var(--mke-accent);
}

.mke-icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.mke-object-summary-bar {
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  display: grid;
  grid-template-columns: minmax(126px, 1.2fr) repeat(3, minmax(76px, 1fr));
  min-width: 0;
  overflow: hidden;
}

.mke-object-summary-card {
  align-items: center;
  color: var(--mke-soft);
  display: flex;
  gap: 7px;
  justify-content: center;
  min-height: 48px;
  min-width: 0;
  padding: 8px 10px;
}

.mke-object-summary-card + .mke-object-summary-card {
  border-left: 1px solid var(--mke-border);
}

.mke-object-summary-card span {
  color: var(--mke-muted);
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-summary-card strong {
  color: var(--mke-text);
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
}

.mke-object-summary-card svg {
  color: var(--mke-muted);
  flex: 0 0 auto;
  height: 16px;
  width: 16px;
}

.mke-object-summary-card--live {
  justify-content: flex-start;
}

.mke-object-summary-card__dot {
  background: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 0 5px rgba(16, 185, 129, 0.12);
  flex: 0 0 auto;
  height: 8px;
  width: 8px;
}

.mke-object-toolbar {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(96px, auto) minmax(160px, 1fr) auto;
  min-width: 0;
}

.mke-object-toolbar__title {
  min-width: 0;
}

.mke-object-toolbar__title h3 {
  color: var(--mke-text);
  font-size: 14px;
  line-height: 1.2;
  margin: 0;
}

.mke-object-toolbar__title span {
  color: var(--mke-muted);
  display: block;
  font-size: 10px;
  line-height: 1.25;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-filter-button {
  align-items: center;
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-soft);
  cursor: default;
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
  font-size: 12px;
  font-weight: 650;
  height: 34px;
  padding: 0 10px;
  white-space: nowrap;
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

.mke-object-workspace {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  width: 100%;
}

.mke-webpage-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.mke-webpage-row {
  align-items: center;
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-text);
  cursor: pointer;
  display: grid;
  gap: 10px;
  grid-template-columns: 34px minmax(110px, 1fr) minmax(92px, auto) auto 18px;
  min-width: 0;
  padding: 10px;
  text-align: left;
  width: 100%;
}

.mke-webpage-row--active {
  border-color: var(--mke-accent);
  box-shadow: inset 3px 0 0 var(--mke-accent);
}

.mke-webpage-row--closed {
  opacity: 0.72;
}

.mke-webpage-row__icon {
  align-items: center;
  background: var(--mke-surface-2);
  border-radius: 8px;
  color: var(--mke-muted);
  display: flex;
  height: 34px;
  justify-content: center;
  width: 34px;
}

.mke-webpage-row--active .mke-webpage-row__icon {
  background: var(--mke-accent-bg);
  color: var(--mke-accent);
}

.mke-webpage-row__icon svg {
  height: 19px;
  width: 19px;
}

.mke-webpage-row__copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.mke-webpage-row__copy strong {
  color: var(--mke-text);
  font-size: 13px;
  font-weight: var(--mke-weight-title);
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-webpage-row__copy span {
  color: var(--mke-muted);
  font-size: 12px;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-webpage-row__metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  justify-content: flex-end;
  min-width: 0;
}

.mke-webpage-row__metrics small {
  background: var(--mke-surface-2);
  border: 1px solid var(--mke-border);
  border-radius: 999px;
  color: var(--mke-soft);
  font-size: 10px;
  line-height: 1.2;
  padding: 3px 6px;
  white-space: nowrap;
}

.mke-webpage-row__more {
  color: var(--mke-muted);
  height: 16px;
  width: 16px;
}

.mke-webpage-detail {
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  box-shadow: var(--mke-shadow);
  min-width: 0;
  padding: 12px;
}

.mke-webpage-detail__header {
  align-items: center;
  border-bottom: 1px solid var(--mke-border);
  display: grid;
  gap: 10px;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  min-width: 0;
  padding-bottom: 11px;
}

.mke-webpage-detail__header > div {
  min-width: 0;
}

.mke-webpage-detail__icon {
  align-items: center;
  background: var(--mke-surface-2);
  border-radius: 8px;
  color: var(--mke-muted);
  display: flex;
  height: 40px;
  justify-content: center;
  width: 40px;
}

.mke-webpage-detail__icon svg {
  height: 22px;
  width: 22px;
}

.mke-webpage-detail__header > div > span {
  color: var(--mke-muted);
  display: block;
  font-size: var(--mke-font-xs);
  font-weight: var(--mke-weight-label);
  margin-bottom: 3px;
}

.mke-webpage-detail__header h3 {
  color: var(--mke-text);
  font-size: 16px;
  line-height: 1.25;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-webpage-detail__header p {
  color: var(--mke-muted);
  font-size: 12px;
  line-height: 1.3;
  margin: 4px 0 0;
  overflow-wrap: anywhere;
}

.mke-webpage-detail__close {
  color: var(--mke-muted);
}

.mke-object-detail-tabs {
  border-bottom: 1px solid var(--mke-border);
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0 -12px;
}

.mke-object-detail-tabs button {
  align-items: center;
  background: var(--mke-surface-2);
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--mke-soft);
  cursor: default;
  display: flex;
  gap: 6px;
  justify-content: center;
  min-width: 0;
  padding: 10px 6px 9px;
}

.mke-object-detail-tabs button + button {
  border-left: 1px solid var(--mke-border);
}

.mke-object-detail-tabs svg {
  height: 15px;
  width: 15px;
}

.mke-object-detail-tabs span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-detail-tabs strong {
  color: var(--mke-muted);
  font-size: 10px;
  font-weight: 650;
}

.mke-object-detail-tab--active {
  border-bottom-color: var(--mke-accent) !important;
  color: var(--mke-accent) !important;
}

.mke-object-count-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 12px;
}

.mke-object-count-card {
  align-items: center;
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  display: grid;
  gap: 4px;
  grid-template-columns: 28px minmax(0, 1fr);
  min-width: 0;
  padding: 9px;
}

.mke-object-count-card__icon {
  align-items: center;
  background: var(--mke-accent-bg);
  border-radius: 7px;
  color: var(--mke-accent);
  display: flex;
  grid-row: span 2;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.mke-object-count-card svg {
  height: 15px;
  width: 15px;
}

.mke-object-count-card span {
  color: var(--mke-soft);
  font-size: 11px;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-count-card strong {
  color: var(--mke-text);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.2;
}

.mke-object-strip {
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  margin-top: 10px;
  min-width: 0;
  padding: 10px;
}

.mke-object-strip__header {
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  margin-bottom: 8px;
  min-width: 0;
}

.mke-object-strip__header strong {
  color: var(--mke-text);
  font-size: 13px;
}

.mke-object-strip__header span,
.mke-object-strip__header time {
  color: var(--mke-muted);
  font-size: 11px;
  white-space: nowrap;
}

.mke-object-empty-line {
  color: var(--mke-muted);
  font-size: 12px;
  line-height: 1.45;
  margin: 0;
  overflow-wrap: anywhere;
}

.mke-object-action-list {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(92px, 1fr));
}

.mke-object-action-chip {
  align-items: center;
  background: var(--mke-surface-2);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-soft);
  display: flex;
  gap: 6px;
  justify-content: center;
  min-width: 0;
  padding: 9px 8px;
  text-align: center;
}

.mke-object-action-chip svg {
  color: var(--mke-muted);
  flex: 0 0 auto;
  height: 15px;
  width: 15px;
}

.mke-object-action-chip strong {
  color: var(--mke-text);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-action-chip--good {
  border-color: rgba(22, 101, 52, 0.22);
}

.mke-object-action-chip--warn {
  border-color: rgba(153, 27, 27, 0.24);
}

.mke-object-api-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mke-object-api-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: 44px minmax(0, 1fr) auto;
  min-width: 0;
}

.mke-object-api-row span {
  background: var(--mke-accent-bg);
  border-radius: 999px;
  color: var(--mke-accent);
  font-size: 10px;
  font-weight: 700;
  padding: 3px 7px;
  text-align: center;
}

.mke-object-api-row strong {
  color: var(--mke-text);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mke-object-api-row em {
  color: var(--mke-muted);
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.mke-object-lifecycle {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  list-style: none;
  margin: 0;
  padding: 0;
}

.mke-object-lifecycle li {
  align-items: center;
  color: var(--mke-muted);
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  text-align: center;
}

.mke-object-lifecycle li > span {
  background: var(--mke-neutral-bg);
  border: 2px solid var(--mke-surface);
  border-radius: 50%;
  box-shadow: 0 0 0 1px var(--mke-border);
  height: 15px;
  width: 15px;
}

.mke-object-lifecycle strong {
  color: var(--mke-text);
  font-size: 12px;
  line-height: 1.2;
}

.mke-object-lifecycle small {
  font-size: 10px;
  line-height: 1.25;
}

.mke-object-lifecycle--good > span {
  background: var(--mke-success-text) !important;
}

.mke-object-lifecycle--warn > span {
  background: var(--mke-warn-text) !important;
}

.mke-object-footer-actions {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin-top: 12px;
}

.mke-object-footer-button {
  align-items: center;
  background: var(--mke-surface);
  border: 1px solid var(--mke-border);
  border-radius: 8px;
  color: var(--mke-soft);
  cursor: pointer;
  display: inline-flex;
  gap: 8px;
  justify-content: center;
  min-height: 42px;
  min-width: 0;
  padding: 0 10px;
  white-space: nowrap;
}

.mke-object-footer-button--primary {
  background: #2563eb;
  border-color: #2563eb;
  color: #ffffff;
}

.mke-object-footer-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.mke-webpage-detail__actions {
  grid-template-columns: auto minmax(80px, 1fr) auto;
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
  border: 1px solid transparent;
  border-radius: 999px;
  flex: 0 0 auto;
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
.mke-webpage-row:focus-visible,
.mke-icon-button:focus-visible,
.mke-filter-button:focus-visible,
.mke-object-footer-button:focus-visible,
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
  .mke-object-header {
    align-items: flex-start;
  }

  .mke-object-title p {
    max-width: min(260px, calc(100vw - 124px));
  }

  .mke-object-summary-bar,
  .mke-object-toolbar,
  .mke-object-count-grid,
  .mke-object-footer-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .mke-object-summary-card + .mke-object-summary-card {
    border-left: 0;
    border-top: 1px solid var(--mke-border);
  }

  .mke-object-toolbar {
    align-items: stretch;
  }

  .mke-filter-button {
    justify-content: center;
  }

  .mke-webpage-row {
    grid-template-columns: 34px minmax(0, 1fr) auto;
  }

  .mke-webpage-row__metrics,
  .mke-webpage-row__more {
    display: none;
  }

  .mke-webpage-row__status {
    justify-self: end;
  }

  .mke-object-detail-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mke-object-detail-tabs button:nth-child(odd) {
    border-left: 0;
  }

  .mke-object-api-row {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .mke-object-api-row em {
    grid-column: 2;
    white-space: normal;
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
