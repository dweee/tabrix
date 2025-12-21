<template>
  <div class="h-full w-full bg-slate-50">
    <!-- Tab Navigation -->
    <div class="px-4 pt-4 pb-2 border-b border-slate-200">
      <div class="flex gap-2">
        <button
          :class="[
            'px-4 py-2 rounded-lg font-medium transition-all',
            activeTab === 'workflows'
              ? 'bg-white text-slate-800 shadow'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
          @click="activeTab = 'workflows'"
        >
          工作流管理
        </button>
        <button
          :class="[
            'px-4 py-2 rounded-lg font-medium transition-all',
            activeTab === 'element-markers'
              ? 'bg-white text-slate-800 shadow'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
          @click="activeTab = 'element-markers'"
        >
          元素标注管理
        </button>
        <button
          :class="[
            'px-4 py-2 rounded-lg font-medium transition-all',
            activeTab === 'agent-chat'
              ? 'bg-white text-slate-800 shadow'
              : 'text-slate-600 hover:bg-slate-100',
          ]"
          @click="activeTab = 'agent-chat'"
        >
          智能助手
        </button>
      </div>
    </div>

    <!-- Workflows Tab -->
    <div v-show="activeTab === 'workflows'" class="workflows-content">
      <div class="px-4 space-y-3">
        <!-- search and actions -->
        <div class="card p-3 flex items-center gap-2">
          <input class="input" v-model="search" placeholder="搜索名称/域/标签" />
          <button class="btn-secondary" @click="refresh">刷新</button>
          <button class="btn-primary" @click="createFlow">新建工作流</button>
        </div>

        <div class="card p-3 flex items-center justify-between">
          <label class="flex items-center gap-2 text-sm text-slate-600"
            ><input
              type="checkbox"
              v-model="onlyBound"
              class="rounded border-slate-300"
            />仅显示当前页绑定</label
          >
          <div class="text-xs text-slate-400">共 {{ filtered.length }} 条</div>
        </div>

        <!-- list -->
        <div v-if="filtered.length === 0" class="card p-6 text-center text-slate-500">
          暂无工作流
        </div>

        <div class="space-y-3">
          <div v-for="f in filtered" :key="f.id" class="card p-4">
            <div class="flex items-start justify-between">
              <div>
                <div class="text-slate-900 font-semibold">{{ f.name }}</div>
                <div class="text-slate-500 text-sm mt-0.5">{{ f.description || '无描述' }}</div>
                <div
                  v-if="f.meta?.domain || (f.meta?.tags || []).length"
                  class="mt-2 flex flex-wrap gap-2"
                >
                  <span v-if="f.meta?.domain" class="badge badge-purple">{{ f.meta.domain }}</span>
                  <span
                    v-for="t in f.meta?.tags || []"
                    :key="t"
                    class="badge bg-slate-100 text-slate-700"
                    >{{ t }}</span
                  >
                </div>
              </div>
              <div class="flex gap-2">
                <button class="btn-secondary" @click="run(f.id)">回放</button>
                <button class="btn-secondary" @click="edit(f.id)">编辑</button>
                <button
                  class="btn-secondary !text-red-600 hover:border-red-300"
                  @click="remove(f.id)"
                  >删除</button
                >
              </div>
            </div>
          </div>
        </div>

        <!-- runs -->
        <div class="card p-3 mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-slate-800 font-semibold">运行记录</div>
            <button class="btn-secondary" @click="refreshRuns">刷新</button>
          </div>
          <div v-if="runs.length === 0" class="text-slate-500 text-sm">暂无记录</div>
          <div v-else class="space-y-2">
            <div v-for="r in runs" :key="r.id" class="border border-slate-200 rounded p-2 bg-white">
              <div class="flex items-center justify-between">
                <div class="text-sm text-slate-700">
                  <span class="font-medium">{{ r.flowId }}</span>
                  <span class="mx-2 text-slate-400">|</span>
                  <span :class="r.success ? 'text-green-600' : 'text-red-600'">{{
                    r.success ? '成功' : '失败'
                  }}</span>
                  <span class="mx-2 text-slate-400">|</span>
                  <span class="text-slate-500">{{ new Date(r.startedAt).toLocaleString() }}</span>
                </div>
                <button class="btn-secondary" @click="toggleRun(r.id)">{{
                  openRunId === r.id ? '收起' : '详情'
                }}</button>
              </div>
              <div v-if="openRunId === r.id" class="mt-2 text-sm">
                <div
                  v-for="(e, idx) in r.entries"
                  :key="idx"
                  class="border-t border-slate-100 py-2"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <span
                        :class="
                          e.status === 'failed'
                            ? 'text-red-600'
                            : e.status === 'retrying'
                              ? 'text-amber-600'
                              : 'text-slate-700'
                        "
                        >#{{ idx + 1 }} {{ e.status }}</span
                      >
                      <span class="mx-2 text-slate-400">|</span>
                      <span class="text-slate-600">step={{ e.stepId }}</span>
                      <span v-if="e.tookMs" class="mx-2 text-slate-400">|</span>
                      <span v-if="e.tookMs" class="text-slate-500">{{ e.tookMs }}ms</span>
                    </div>
                  </div>
                  <div v-if="e.message" class="mt-1 text-slate-600">{{ e.message }}</div>
                  <div v-if="e.fallbackUsed" class="mt-1 text-amber-700"
                    >Fallback: {{ e.fallbackFrom }} → {{ e.fallbackTo }}</div
                  >
                  <div v-if="e.screenshotBase64" class="mt-2">
                    <img
                      :src="'data:image/png;base64,' + e.screenshotBase64"
                      class="max-w-full rounded border"
                      alt="失败截图"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- triggers -->
        <div class="card p-3 mt-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-slate-800 font-semibold">触发器</div>
            <div class="flex items-center gap-2">
              <button class="btn-secondary" @click="refreshTriggers">刷新</button>
              <button class="btn-primary" @click="createTrigger">新增触发器</button>
            </div>
          </div>
          <div v-if="triggers.length === 0" class="text-slate-500 text-sm">暂无触发器</div>
          <div v-else class="space-y-2">
            <div
              v-for="t in triggers"
              :key="t.id"
              class="border border-slate-200 rounded p-2 bg-white"
            >
              <div class="flex items-center justify-between">
                <div class="text-sm text-slate-700">
                  <span class="font-medium">{{ t.type }}</span>
                  <span class="mx-2 text-slate-400">|</span>
                  <span class="text-slate-600">flow={{ t.flowId }}</span>
                  <span class="mx-2 text-slate-400">|</span>
                  <span :class="t.enabled !== false ? 'text-green-600' : 'text-slate-500'">{{
                    t.enabled !== false ? '启用' : '禁用'
                  }}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn-secondary" @click="editTrigger(t.id)">编辑</button>
                  <button
                    class="btn-secondary !text-red-600 hover:border-red-300"
                    @click="removeTrigger(t.id)"
                    >删除</button
                  >
                </div>
              </div>
            </div>
          </div>

          <div v-if="editingTrigger" class="mt-3 border border-slate-200 rounded p-3 bg-white">
            <div class="grid grid-cols-2 gap-2">
              <label class="text-sm text-slate-600"
                >类型
                <select class="input" v-model="editingTrigger.type">
                  <option value="url">URL</option>
                  <option value="contextMenu">右键菜单</option>
                  <option value="command">快捷键</option>
                  <option value="dom">DOM观察</option>
                </select>
              </label>
              <label class="text-sm text-slate-600"
                >关联工作流
                <select class="input" v-model="editingTrigger.flowId">
                  <option v-for="f in flows" :key="f.id" :value="f.id">{{ f.name || f.id }}</option>
                </select>
              </label>
              <label class="text-sm text-slate-600"
                >启用
                <input type="checkbox" v-model="editingTrigger.enabled" class="ml-2" />
              </label>
            </div>
            <div v-if="editingTrigger.type === 'url'" class="mt-2">
              <div class="text-xs text-slate-500 mb-1">匹配规则（domain/path/url，逗号分隔）</div>
              <input
                class="input"
                v-model="urlRules"
                placeholder="domain:example.com,path:/dashboard,url:https://example.com/page"
              />
            </div>
            <div v-if="editingTrigger.type === 'contextMenu'" class="mt-2">
              <input class="input" v-model="editingTrigger.title" placeholder="菜单标题" />
            </div>
            <div v-if="editingTrigger.type === 'command'" class="mt-2">
              <select class="input" v-model="editingTrigger.commandKey">
                <option value="run_quick_trigger_1">run_quick_trigger_1</option>
                <option value="run_quick_trigger_2">run_quick_trigger_2</option>
                <option value="run_quick_trigger_3">run_quick_trigger_3</option>
              </select>
              <div class="text-xs text-slate-500 mt-1"
                >请在浏览器快捷键设置中为以上命令指定按键</div
              >
            </div>
            <div v-if="editingTrigger.type === 'dom'" class="mt-2 grid grid-cols-2 gap-2">
              <input class="input" v-model="editingTrigger.selector" placeholder="CSS Selector" />
              <label class="text-sm text-slate-600"
                >出现即触发<input type="checkbox" v-model="editingTrigger.appear" class="ml-2"
              /></label>
              <label class="text-sm text-slate-600"
                >只触发一次<input type="checkbox" v-model="editingTrigger.once" class="ml-2"
              /></label>
              <input
                class="input"
                v-model="editingTrigger.debounceMs"
                placeholder="抖动(毫秒) 默认800"
              />
            </div>
            <div class="mt-3 flex items-center gap-2">
              <button class="btn-primary" @click="saveEditingTrigger">保存</button>
              <button class="btn-secondary" @click="cancelEditing">取消</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Agent Chat Tab -->
    <div v-show="activeTab === 'agent-chat'" class="h-[calc(100%-56px)]">
      <AgentChat />
    </div>

    <!-- Element Markers Tab -->
    <div v-show="activeTab === 'element-markers'" class="element-markers-content">
      <div class="px-4 py-4">
        <!-- Add/Edit Marker Form -->
        <div class="em-card mb-4">
          <h3 class="em-section-title">{{ editingMarkerId ? '编辑标注' : '新增标注' }}</h3>

          <form @submit.prevent="saveMarker" class="em-form">
            <div class="em-form-row">
              <div class="em-field">
                <label class="em-field-label">名称</label>
                <input
                  v-model="markerForm.name"
                  class="em-input"
                  placeholder="例如: 登录按钮"
                  required
                />
              </div>
            </div>

            <div class="em-form-row em-form-row-multi">
              <div class="em-field">
                <label class="em-field-label">选择器类型</label>
                <div class="em-select-wrapper">
                  <select v-model="markerForm.selectorType" class="em-select">
                    <option value="css">CSS Selector</option>
                    <option value="xpath">XPath</option>
                  </select>
                </div>
              </div>
              <div class="em-field">
                <label class="em-field-label">匹配类型</label>
                <div class="em-select-wrapper">
                  <select v-model="markerForm.matchType" class="em-select">
                    <option value="prefix">路径前缀</option>
                    <option value="exact">精确匹配</option>
                    <option value="host">域名</option>
                  </select>
                </div>
              </div>
            </div>

            <div class="em-form-row">
              <div class="em-field">
                <label class="em-field-label">选择器</label>
                <textarea
                  v-model="markerForm.selector"
                  class="em-textarea"
                  placeholder="CSS 选择器或 XPath"
                  rows="3"
                  required
                ></textarea>
              </div>
            </div>

            <div class="em-actions">
              <button type="submit" class="em-btn em-btn-primary">
                {{ editingMarkerId ? '更新' : '保存' }}
              </button>
              <button
                v-if="editingMarkerId"
                type="button"
                class="em-btn em-btn-ghost"
                @click="cancelEdit"
              >
                取消
              </button>
              <button type="button" class="em-btn em-btn-ghost" @click="resetForm"> 清空 </button>
            </div>
          </form>
        </div>

        <!-- Markers List -->
        <div v-if="markers.length > 0" class="em-list">
          <!-- Statistics -->
          <div class="em-stats-card">
            <div class="em-stat-item">
              <span class="em-stat-label">总标注数</span>
              <span class="em-stat-value">{{ totalMarkersCount }}</span>
            </div>
            <div class="em-stat-item">
              <span class="em-stat-label">域名数</span>
              <span class="em-stat-value">{{ groupedMarkers.length }}</span>
            </div>
          </div>

          <!-- Grouped Markers by Domain -->
          <div
            v-for="domainGroup in groupedMarkers"
            :key="domainGroup.domain"
            class="em-domain-group"
          >
            <!-- Domain Header -->
            <div class="em-domain-header" @click="toggleDomain(domainGroup.domain)">
              <div class="em-domain-info">
                <svg
                  class="em-domain-icon"
                  :class="{ 'em-domain-icon-expanded': expandedDomains.has(domainGroup.domain) }"
                  viewBox="0 0 20 20"
                  width="16"
                  height="16"
                >
                  <path fill="currentColor" d="M6 8l4 4 4-4" />
                </svg>
                <h3 class="em-domain-name">{{ domainGroup.domain }}</h3>
                <span class="em-domain-count">{{ domainGroup.count }} 个标注</span>
              </div>
            </div>

            <!-- URLs and Markers -->
            <div v-if="expandedDomains.has(domainGroup.domain)" class="em-domain-content">
              <div v-for="urlGroup in domainGroup.urls" :key="urlGroup.url" class="em-url-group">
                <div class="em-url-header">
                  <span class="em-url-path">{{ urlGroup.url }}</span>
                </div>

                <div v-for="marker in urlGroup.markers" :key="marker.id" class="em-marker-card">
                  <div class="em-marker-header">
                    <div class="em-marker-info">
                      <h4 class="em-marker-name">{{ marker.name }}</h4>
                      <code class="em-marker-selector" :title="marker.selector">{{
                        marker.selector
                      }}</code>
                      <div class="em-marker-tags">
                        <span class="em-tag">{{ marker.selectorType || 'css' }}</span>
                        <span class="em-tag">{{ marker.matchType }}</span>
                      </div>
                    </div>
                    <div class="em-marker-actions">
                      <button
                        class="em-action-btn em-action-verify"
                        @click="validateMarker(marker)"
                        title="验证"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </button>
                      <button
                        class="em-action-btn em-action-edit"
                        @click="editMarker(marker)"
                        title="编辑"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                      <button
                        class="em-action-btn em-action-delete"
                        @click="deleteMarker(marker)"
                        title="删除"
                      >
                        <svg viewBox="0 0 24 24" width="18" height="18">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="em-empty">
          <p>暂无标注元素</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, onUnmounted, watch } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import type { ElementMarker, UpsertMarkerRequest } from '@/common/element-marker-types';
import AgentChat from './components/AgentChat.vue';

type FlowLite = { id: string; name: string; description?: string; meta?: any };
type RunLite = {
  id: string;
  flowId: string;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  entries: any[];
};

// Tab state
const activeTab = ref<'workflows' | 'element-markers' | 'agent-chat'>('workflows');

// Workflows state
const flows = ref<FlowLite[]>([]);
const onlyBound = ref(false);
const search = ref('');
const currentUrl = ref('');
const runs = ref<RunLite[]>([]);
const openRunId = ref<string | null>(null);
const triggers = ref<any[]>([]);
const editingTrigger = ref<any | null>(null);
const urlRules = ref('');

// Element markers state
const currentPageUrl = ref('');
const markers = ref<ElementMarker[]>([]);
const editingMarkerId = ref<string | null>(null);
const markerForm = ref<UpsertMarkerRequest>({
  url: '',
  name: '',
  selector: '',
  selectorType: 'css',
  matchType: 'prefix',
});
const expandedDomains = ref<Set<string>>(new Set());

// Group markers by domain and URL
const groupedMarkers = computed(() => {
  const groups = new Map<string, Map<string, ElementMarker[]>>();

  for (const marker of markers.value) {
    // Use pre-normalized fields from storage instead of reparsing URLs
    const domain = marker.host || '(本地文件)';
    const fullUrl = marker.url || '(未知URL)';

    if (!groups.has(domain)) {
      groups.set(domain, new Map());
    }

    const domainGroup = groups.get(domain)!;
    if (!domainGroup.has(fullUrl)) {
      domainGroup.set(fullUrl, []);
    }

    domainGroup.get(fullUrl)!.push(marker);
  }

  // Convert to array and sort
  return Array.from(groups.entries())
    .map(([domain, urlMap]) => ({
      domain,
      count: Array.from(urlMap.values()).reduce((sum, arr) => sum + arr.length, 0),
      urls: Array.from(urlMap.entries())
        .map(([url, markers]) => ({ url, markers }))
        .sort((a, b) => a.url.localeCompare(b.url)),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
});

const totalMarkersCount = computed(() => markers.value.length);

const filtered = computed(() => {
  const list = onlyBound.value ? flows.value.filter(isBoundToCurrent) : flows.value;
  const q = search.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter((f) => {
    const name = String(f.name || '').toLowerCase();
    const domain = String(f?.meta?.domain || '').toLowerCase();
    const tags = ((f?.meta?.tags || []) as any[]).join(',').toLowerCase();
    return name.includes(q) || domain.includes(q) || tags.includes(q);
  });
});

function isBoundToCurrent(f: FlowLite) {
  try {
    const bindings = f?.meta?.bindings || [];
    if (!bindings.length) return false;
    if (!currentUrl.value) return true;
    const u = new URL(currentUrl.value);
    return bindings.some((b: any) => {
      if (b.type === 'domain') return u.hostname.includes(b.value);
      if (b.type === 'path') return u.pathname.startsWith(b.value);
      if (b.type === 'url') return (u.href || '').startsWith(b.value);
      return false;
    });
  } catch {
    return false;
  }
}

async function refresh() {
  try {
    const res = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_LIST_FLOWS });
    if (res && res.success) flows.value = res.flows || [];
  } catch {}
}

async function refreshRuns() {
  try {
    const res = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_LIST_RUNS });
    if (res && res.success) runs.value = (res.runs || []).slice().reverse();
  } catch {}
}

async function refreshTriggers() {
  try {
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_LIST_TRIGGERS,
    });
    if (res && res.success) triggers.value = res.triggers || [];
  } catch {}
}

function createTrigger() {
  editingTrigger.value = {
    id: `trg_${Date.now()}`,
    type: 'url',
    enabled: true,
    flowId: flows.value[0]?.id || '',
    match: [],
    title: '运行工作流',
    commandKey: 'run_quick_trigger_1',
    selector: '',
    appear: true,
    once: true,
    debounceMs: 800,
  };
  urlRules.value = '';
}

function editTrigger(id: string) {
  const t = triggers.value.find((x) => x.id === id);
  if (!t) return;
  editingTrigger.value = JSON.parse(JSON.stringify(t));
  if (t.type === 'url')
    urlRules.value = (t.match || []).map((m: any) => `${m.kind}:${m.value}`).join(',');
}

function cancelEditing() {
  editingTrigger.value = null;
  urlRules.value = '';
}

async function saveEditingTrigger() {
  const t = editingTrigger.value;
  if (!t) return;
  if (t.type === 'url') {
    const arr: any[] = [];
    for (const seg of String(urlRules.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      const [k, ...rest] = seg.split(':');
      const v = rest.join(':');
      if (k && v) arr.push({ kind: k === 'domain' || k === 'path' ? k : 'url', value: v });
    }
    t.match = arr;
  }
  await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_SAVE_TRIGGER, trigger: t });
  editingTrigger.value = null;
  await refreshTriggers();
}

async function removeTrigger(id: string) {
  await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_DELETE_TRIGGER, id });
  await refreshTriggers();
}

function toggleRun(id: string) {
  openRunId.value = openRunId.value === id ? null : id;
}

async function run(id: string) {
  try {
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW,
      flowId: id,
      options: { returnLogs: false },
    });
    if (!(res && res.success)) console.warn('回放失败');
  } catch {}
}

function edit(id: string) {
  openBuilder({ flowId: id });
}

function createFlow() {
  openBuilder({ newFlow: true });
}

async function remove(id: string) {
  try {
    const ok = confirm('确认删除该工作流？此操作不可恢复');
    if (!ok) return;
    await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_DELETE_FLOW,
      flowId: id,
    });
    await refresh();
  } catch {}
}

function openBuilder(opts: { flowId?: string; newFlow?: boolean }) {
  // Open dedicated builder window for better UX
  const url = new URL(chrome.runtime.getURL('builder.html'));
  if (opts.flowId) url.searchParams.set('flowId', opts.flowId);
  if (opts.newFlow) url.searchParams.set('new', '1');
  chrome.windows.create({ url: url.toString(), type: 'popup', width: 1280, height: 800 });
}

// Element markers functions
function resetForm() {
  markerForm.value = {
    url: currentPageUrl.value,
    name: '',
    selector: '',
    selectorType: 'css',
    matchType: 'prefix',
  };
  editingMarkerId.value = null;
}

async function loadMarkers() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    currentPageUrl.value = String(tab?.url || '');
    markerForm.value.url = currentPageUrl.value;

    // Load all markers from all pages
    const res: any = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_LIST_ALL,
    });

    if (res?.success) {
      markers.value = res.markers || [];
    }
  } catch (e) {
    console.error('Failed to load markers:', e);
  }
}

async function saveMarker() {
  try {
    if (!markerForm.value.selector) return;

    const isEditing = !!editingMarkerId.value;

    // Only set URL for new markers, not when editing existing ones
    if (!isEditing) {
      markerForm.value.url = currentPageUrl.value;
    }

    let res: any;

    if (isEditing) {
      // Use UPDATE for editing to preserve createdAt
      const existingMarker = markers.value.find((m) => m.id === editingMarkerId.value);
      if (existingMarker) {
        const updatedMarker: ElementMarker = {
          ...existingMarker,
          ...markerForm.value,
          id: editingMarkerId.value!,
        };
        res = await chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_UPDATE,
          marker: updatedMarker,
        });
      } else {
        // Fallback to SAVE if existing marker not found in local state
        console.warn('Editing marker not found in local state, falling back to SAVE');
        res = await chrome.runtime.sendMessage({
          type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_SAVE,
          marker: { ...markerForm.value, id: editingMarkerId.value },
        });
      }
    } else {
      // Use SAVE for new markers
      res = await chrome.runtime.sendMessage({
        type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_SAVE,
        marker: { ...markerForm.value },
      });
    }

    if (res?.success) {
      resetForm();
      await loadMarkers();
    }
  } catch (e) {
    console.error('Failed to save marker:', e);
  }
}

function editMarker(marker: ElementMarker) {
  editingMarkerId.value = marker.id;
  markerForm.value = {
    url: marker.url,
    name: marker.name,
    selector: marker.selector,
    selectorType: marker.selectorType,
    listMode: marker.listMode,
    matchType: marker.matchType,
    action: marker.action,
  };
}

function cancelEdit() {
  resetForm();
}

async function deleteMarker(marker: ElementMarker) {
  try {
    const confirmed = confirm(`确定要删除标注 "${marker.name}" 吗?`);
    if (!confirmed) return;

    const res: any = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_DELETE,
      id: marker.id,
    });

    if (res?.success) {
      await loadMarkers();
    }
  } catch (e) {
    console.error('Failed to delete marker:', e);
  }
}

async function validateMarker(marker: ElementMarker) {
  try {
    const res: any = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.ELEMENT_MARKER_VALIDATE,
      selector: marker.selector,
      selectorType: marker.selectorType || 'css',
      action: 'hover',
      listMode: !!marker.listMode,
    } as any);

    // Trigger highlight in the page
    if (res?.tool?.ok !== false) {
      await highlightInTab(marker);
    }
  } catch (e) {
    console.error('Failed to validate marker:', e);
  }
}

/**
 * Check if element-marker.js is already injected in the tab
 * Uses a short timeout to avoid hanging on unresponsive tabs
 */
async function isMarkerInjected(tabId: number): Promise<boolean> {
  try {
    const response = await Promise.race([
      chrome.tabs.sendMessage(tabId, { action: 'element_marker_ping' }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 300)),
    ]);
    return response?.status === 'pong';
  } catch {
    return false;
  }
}

async function highlightInTab(marker: ElementMarker) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tabs[0]?.id;
    if (!tabId) return;

    // Check if already injected via ping to avoid duplicate injection
    const alreadyInjected = await isMarkerInjected(tabId);

    if (!alreadyInjected) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ['inject-scripts/element-marker.js'],
          world: 'ISOLATED',
        });
      } catch {
        // Script injection may fail on some pages
      }
    }

    // Send highlight message to content script
    await chrome.tabs.sendMessage(tabId, {
      action: 'element_marker_highlight',
      selector: marker.selector,
      selectorType: marker.selectorType || 'css',
      listMode: !!marker.listMode,
    });
  } catch (e) {
    // Ignore errors (tab might not support content scripts)
    console.error('Failed to highlight in tab:', e);
  }
}

function getUrlDisplay(url: string) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname + urlObj.pathname;
  } catch {
    return url;
  }
}

function toggleDomain(domain: string) {
  if (expandedDomains.value.has(domain)) {
    expandedDomains.value.delete(domain);
  } else {
    expandedDomains.value.add(domain);
  }
  // Trigger reactivity
  expandedDomains.value = new Set(expandedDomains.value);
}

// Watch tab changes to load data
watch(activeTab, async (newTab, oldTab) => {
  // Only load if tab actually changed (avoid double-loading on mount)
  if (newTab === 'element-markers' && oldTab !== undefined) {
    await loadMarkers();
  }
});

onMounted(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentUrl.value = String(tab?.url || '');
  } catch {}

  // Check URL params for initial tab
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab');
  if (tabParam === 'element-markers') {
    activeTab.value = 'element-markers';
    await loadMarkers();
  }

  await refresh();
  await refreshRuns();
  await refreshTriggers();

  // Auto-refresh flows list when storage rr_flows changes
  const onChanged = (changes: any, area: string) => {
    try {
      if (area !== 'local') return;
      if (Object.prototype.hasOwnProperty.call(changes || {}, 'rr_flows')) refresh();
    } catch {}
  };
  chrome.storage.onChanged.addListener(onChanged);
  // Keep a reference for potential cleanup
  (window as any).__rr_sidepanel_onChanged = onChanged;
});

onUnmounted(() => {
  const fn = (window as any).__rr_sidepanel_onChanged;
  if (fn && chrome?.storage?.onChanged?.removeListener) {
    try {
      chrome.storage.onChanged.removeListener(fn);
    } catch {}
  }
});
</script>

<style scoped>
/* reuse popup styles; only tune list item spacing for sidepanel width */
.rr-item {
  margin-bottom: 8px;
}
.rr-actions button {
  margin-left: 6px;
}

/* Element Markers Styles - Inspired by element-marker.js */
.element-markers-content {
  padding-bottom: 24px;
}

.em-card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 20px;
}

.em-header-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.em-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.em-label {
  font-size: 14px;
  font-weight: 500;
  color: #737373;
}

.em-value {
  font-size: 14px;
  color: #262626;
  font-weight: 500;
  flex: 1;
  margin-left: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.em-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 12px;
  background: #2563eb;
  color: #ffffff;
  font-size: 16px;
  font-weight: 600;
  border-radius: 8px;
}

.em-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin-bottom: 16px;
}

.em-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.em-form-row {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.em-form-row-multi {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.em-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.em-field-label {
  font-size: 12px;
  font-weight: 500;
  color: #737373;
}

.em-input {
  width: 100%;
  height: 44px;
  padding: 0 16px;
  background: #f5f5f5;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  color: #262626;
  font-family: inherit;
  outline: none;
  transition: background 150ms ease;
}

.em-input:focus {
  background: #e5e5e5;
}

.em-textarea {
  width: 100%;
  min-height: 80px;
  padding: 12px 16px;
  background: #f5f5f5;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  color: #262626;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  outline: none;
  transition: background 150ms ease;
  resize: vertical;
}

.em-textarea:focus {
  background: #e5e5e5;
}

.em-select-wrapper {
  position: relative;
}

.em-select {
  width: 100%;
  height: 44px;
  padding: 0 40px 0 16px;
  background: #f5f5f5;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  color: #262626;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  appearance: none;
}

.em-select-wrapper::after {
  content: '';
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 5px solid transparent;
  border-right: 5px solid transparent;
  border-top: 6px solid #737373;
  pointer-events: none;
}

.em-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.em-btn {
  flex: 1;
  height: 44px;
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 150ms ease;
}

.em-btn-primary {
  background: #2563eb;
  color: #ffffff;
}

.em-btn-primary:hover {
  background: #1d4ed8;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.em-btn-ghost {
  background: #f5f5f5;
  color: #404040;
}

.em-btn-ghost:hover {
  background: #e5e5e5;
}

.em-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.em-marker-card {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 16px;
  transition: box-shadow 150ms ease;
}

.em-marker-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.em-marker-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.em-marker-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.em-marker-name {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin: 0;
}

.em-marker-selector {
  font-size: 13px;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  color: #525252;
  background: #f5f5f5;
  padding: 6px 10px;
  border-radius: 6px;
  max-width: 100%;
  cursor: help;
  display: block;
  word-break: break-all;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  max-height: 120px;
  overflow-y: auto;
}

.em-marker-tags {
  display: flex;
  gap: 6px;
}

.em-tag {
  display: inline-block;
  padding: 4px 10px;
  background: #e5e5e5;
  color: #525252;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
}

.em-tag-url {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: help;
}

.em-marker-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.em-action-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 150ms ease;
}

.em-action-btn svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

.em-action-verify {
  background: #dbeafe;
  color: #2563eb;
}

.em-action-verify:hover {
  background: #bfdbfe;
  transform: translateY(-1px);
}

.em-action-edit {
  background: #f5f5f5;
  color: #525252;
}

.em-action-edit:hover {
  background: #e5e5e5;
  transform: translateY(-1px);
}

.em-action-delete {
  background: #fee2e2;
  color: #ef4444;
}

.em-action-delete:hover {
  background: #fecaca;
  transform: translateY(-1px);
}

.em-empty {
  text-align: center;
  padding: 48px 20px;
  color: #a3a3a3;
  font-size: 14px;
}

/* Statistics Card */
.em-stats-card {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  padding: 20px;
  margin-bottom: 20px;
  display: flex;
  justify-content: space-around;
  gap: 20px;
}

.em-stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.em-stat-label {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 500;
}

.em-stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
}

/* Domain Group */
.em-domain-group {
  margin-bottom: 16px;
}

.em-domain-header {
  background: linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
  border-radius: 12px;
  padding: 16px 20px;
  cursor: pointer;
  transition: all 150ms ease;
  user-select: none;
}

.em-domain-header:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.em-domain-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.em-domain-icon {
  flex-shrink: 0;
  color: #525252;
  transition: transform 150ms ease;
}

.em-domain-icon-expanded {
  transform: rotate(0deg);
}

.em-domain-icon:not(.em-domain-icon-expanded) {
  transform: rotate(-90deg);
}

.em-domain-name {
  font-size: 16px;
  font-weight: 600;
  color: #262626;
  margin: 0;
  flex: 1;
}

.em-domain-count {
  font-size: 13px;
  color: #737373;
  background: rgba(255, 255, 255, 0.6);
  padding: 4px 12px;
  border-radius: 12px;
  font-weight: 500;
}

/* Domain Content */
.em-domain-content {
  padding: 12px 0 0 0;
  animation: slideDown 200ms ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* URL Group */
.em-url-group {
  margin-bottom: 12px;
}

.em-url-header {
  padding: 8px 16px;
  background: #f9fafb;
  border-radius: 8px;
  margin-bottom: 8px;
}

.em-url-path {
  font-size: 13px;
  color: #525252;
  font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
  word-break: break-all;
}

/* Adjust marker card in group context */
.em-url-group .em-marker-card {
  margin-left: 16px;
  margin-bottom: 8px;
}

.em-url-group .em-marker-card:last-child {
  margin-bottom: 0;
}
</style>
