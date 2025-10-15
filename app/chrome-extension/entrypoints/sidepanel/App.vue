<template>
  <div class="h-full w-full bg-slate-50">
    <div class="px-4 pt-4 pb-2">
      <h1 class="text-2xl font-bold text-slate-800">工作流管理</h1>
    </div>

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
              <button class="btn-secondary !text-red-600 hover:border-red-300" @click="remove(f.id)"
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
              <div v-for="(e, idx) in r.entries" :key="idx" class="border-t border-slate-100 py-2">
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
            <div class="text-xs text-slate-500 mt-1">请在浏览器快捷键设置中为以上命令指定按键</div>
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
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

type FlowLite = { id: string; name: string; description?: string; meta?: any };
type RunLite = {
  id: string;
  flowId: string;
  startedAt: string;
  finishedAt?: string;
  success?: boolean;
  entries: any[];
};

const flows = ref<FlowLite[]>([]);
const onlyBound = ref(false);
const search = ref('');
const currentUrl = ref('');
const runs = ref<RunLite[]>([]);
const openRunId = ref<string | null>(null);
const triggers = ref<any[]>([]);
const editingTrigger = ref<any | null>(null);
const urlRules = ref('');

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

onMounted(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentUrl.value = String(tab?.url || '');
  } catch {}
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
</style>
