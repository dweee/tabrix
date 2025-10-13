<template>
  <div v-if="visible" class="builder-modal">
    <div class="builder rr-theme" data-theme="dark">
      <div class="topbar">
        <div class="topbar-left">
          <button class="btn-back" @click="$emit('close')" title="返回">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="m12 15-5-5 5-5"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <input class="workflow-title" v-model="store.flowLocal.name" placeholder="New workflow" />
          <span class="draft-badge">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 1v12M1 7h12"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            Draft
          </span>
        </div>
        <div class="topbar-right">
          <div class="toolbar-group">
            <button class="toolbar-btn" @click="store.undo" title="撤销">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M3.5 9h8a2 2 0 0 0 0-4h-2"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <path
                  d="m6 6.5-2.5 2.5L6 11.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button class="toolbar-btn" @click="store.redo" title="重做">
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M14.5 9h-8a2 2 0 0 1 0-4h2"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                />
                <path
                  d="m12 6.5 2.5 2.5-2.5 2.5"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
          </div>

          <button class="toolbar-btn" @click="store.layoutAuto" title="自动排版">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect
                x="2"
                y="2"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <rect
                x="11"
                y="2"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <rect
                x="2"
                y="11"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <rect
                x="11"
                y="11"
                width="5"
                height="5"
                rx="1"
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </button>

          <button class="toolbar-btn" @click="fitAll" title="适应画布">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path
                d="M2 6V2h4M16 6V2h-4M2 12v4h4M16 12v4h-4"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <div class="toolbar-divider"></div>

          <button
            class="toolbar-btn"
            :disabled="!selectedId"
            @click="runFromSelected"
            title="从选中节点运行"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M5 3l10 6-10 6V3z" fill="currentColor" />
            </svg>
          </button>

          <button class="btn-primary" @click="runAll" title="预览工作流">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
              <path
                d="M8 4.5v7M4.5 8h7"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            Preview
          </button>

          <button class="btn-publish" @click="save">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 12V4m0 0L5 7m3-3 3 3"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            Publish
          </button>

          <button
            class="toolbar-btn-icon"
            @click="toggleErrors"
            v-if="errorsCount > 0"
            title="查看错误"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" stroke="currentColor" stroke-width="1.5" />
              <path
                d="M9 5v5M9 12v1"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <span class="error-badge-count">{{ errorsCount }}</span>
          </button>

          <button class="toolbar-btn-icon" title="更多选项">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="4.5" r="1.5" fill="currentColor" />
              <circle cx="9" cy="9" r="1.5" fill="currentColor" />
              <circle cx="9" cy="13.5" r="1.5" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      <!-- Top notice bar for fallback suggestion with undo -->
      <div v-if="fallbackNotice" class="notice-top">
        <span>已应用回退建议：提升 {{ fallbackNotice.type }} 优先级</span>
        <button class="mini" @click="undoFallbackPromotion">撤销</button>
      </div>

      <div class="main">
        <Sidebar
          :flow="store.flowLocal"
          :palette-types="store.paletteTypes"
          :subflow-ids="store.listSubflowIds()"
          :current-subflow-id="store.currentSubflowId"
          @add-node="store.addNode"
          @switch-main="store.switchToMain"
          @switch-subflow="store.switchToSubflow"
          @add-subflow="store.addSubflow"
          @remove-subflow="store.removeSubflow"
        />
        <Canvas
          ref="canvasRef"
          :nodes="store.nodes"
          :edges="store.edges"
          :focus-node-id="focusNodeId"
          :fit-seq="fitSeq"
          @select-node="store.selectNode"
          @duplicate-node="store.duplicateNode"
          @remove-node="store.removeNode"
          @connect-from="store.connectFrom"
          @connect="store.onConnect"
          @node-dragged="store.setNodePosition"
          @add-node-at="onAddNodeAt"
        />
        <PropertyPanel
          :node="activeNode"
          :variables="store.flowLocal.variables || []"
          :highlight-field="highlightField"
          :subflow-ids="store.listSubflowIds()"
          @create-subflow="store.addSubflow"
          @switch-to-subflow="store.switchToSubflow"
          @remove-node="store.removeNode"
        />
        <div v-if="showErrors && errorsCount > 0" class="error-panel">
          <div class="err-title">校验错误（点击定位）</div>
          <div class="err-list">
            <div
              v-for="(errs, nid) in validation.nodeErrors"
              :key="nid"
              class="err-item"
              @click="focusError(String(nid), errs[0])"
            >
              <div class="nid">{{ String(nid) }}</div>
              <div class="elist">
                <div v-for="e in errs" :key="e" class="e">• {{ e }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom toolbar: zoom controls moved here -->
      <div class="bottombar">
        <div class="status">{{ saveLabel }}</div>
        <div class="zoom-group">
          <button class="zoom-btn" @click="zoomOut" title="缩小">−</button>
          <button class="zoom-btn" @click="fitAll" title="适应画布">适配</button>
          <button class="zoom-btn" @click="zoomIn" title="放大">＋</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, watch, onMounted, onUnmounted, ref } from 'vue';
import type { Flow as FlowV2 } from '@/entrypoints/background/record-replay/types';
import { useBuilderStore } from './builder/store/useBuilderStore';
import { nodesToSteps } from './builder/model/transforms';
import { validateFlow } from './builder/model/validation';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import Canvas from './builder/components/Canvas.vue';
import Sidebar from './builder/components/Sidebar.vue';
import PropertyPanel from './builder/components/PropertyPanel.vue';

const props = defineProps<{
  visible: boolean;
  flow: FlowV2 | null;
  initialFocusNodeId?: string | null;
  fallbackHint?: { nodeId: string; toType: string } | null;
}>();
const emit = defineEmits(['close', 'save']);

const store = useBuilderStore();

watch(
  () => props.flow,
  (f) => {
    if (f) store.initFromFlow(f);
  },
  { immediate: true },
);

// 由于 store.activeNodeId 是一个 Ref，这里统一取其值避免 TS 比较报错
const selectedId = computed<string | null>(() => (store.activeNodeId as any)?.value ?? null);
const activeNode = computed(() => store.nodes.find((n) => n.id === selectedId.value) || null);
const validation = computed(() => validateFlow(store.nodes));
const errorsCount = computed(() => validation.value.totalErrors);
const showErrors = ref(false);
function toggleErrors() {
  showErrors.value = !showErrors.value;
}

// 搜索与聚焦
const search = ref('');
const focusNodeId = ref<string | null>(null);
const highlightField = ref<string | null>(null);
const fitSeq = ref(0);
function focusSearch() {
  const q = search.value.trim().toLowerCase();
  if (!q) return;
  const matches = (n: any): boolean => {
    if ((n.name || '').toLowerCase().includes(q)) return true;
    if ((n.type || '').toLowerCase().includes(q)) return true;
    try {
      // search first selector
      if ((n.config?.target?.candidates?.[0]?.value || '').toLowerCase().includes(q)) return true;
      // deep search string fields including variable placeholders {var}
      const walk = (v: any): boolean => {
        if (v == null) return false;
        if (typeof v === 'string')
          return v.toLowerCase().includes(q) || v.toLowerCase().includes(`{${q}}`);
        if (Array.isArray(v)) return v.some(walk);
        if (typeof v === 'object') return Object.values(v).some(walk);
        return false;
      };
      return walk(n.config);
    } catch {
      return false;
    }
  };
  const hit = store.nodes.find((n) => matches(n));
  if (hit) {
    store.selectNode(hit.id);
    focusNodeId.value = hit.id;
    setTimeout(() => (focusNodeId.value = null), 300);
  }
}

function importFromSteps() {
  store.importFromSteps();
}
function exportToSteps() {
  store.flowLocal.steps = nodesToSteps(store.nodes, store.edges);
}
function save() {
  // Only map steps when editing main graph
  if (store.isEditingMain()) store.flowLocal.steps = nodesToSteps(store.nodes, store.edges);
  const result = JSON.parse(
    JSON.stringify({ ...store.flowLocal, nodes: store.nodes, edges: store.edges }),
  );
  emit('save', result);
}

// Fallback suggestion notice + apply/undo helpers
const fallbackNotice = ref<{ nodeId: string; type: string; prevIndex: number } | null>(null);
function applyFallbackPromotion(nodeId: string, toType: string) {
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== 'click' && node.type !== 'fill')) return;
  const cands = (node as any).config?.target?.candidates as Array<{ type: string; value: string }>;
  if (!Array.isArray(cands) || !cands.length) return;
  const idx = cands.findIndex((c) => c.type === String(toType));
  if (idx > 0) {
    const cand = cands.splice(idx, 1)[0];
    cands.unshift(cand);
    fallbackNotice.value = { nodeId, type: String(toType), prevIndex: idx };
    focusNode(nodeId);
    highlightField.value = 'target.candidates';
    setTimeout(() => (highlightField.value = null), 1500);
  }
}
function undoFallbackPromotion() {
  const n = fallbackNotice.value;
  if (!n) return;
  const node = store.nodes.find((x) => x.id === n.nodeId);
  if (!node || (node.type !== 'click' && node.type !== 'fill')) {
    fallbackNotice.value = null;
    return;
  }
  const cands = (node as any).config?.target?.candidates as Array<{ type: string; value: string }>;
  if (!Array.isArray(cands) || cands.length === 0) {
    fallbackNotice.value = null;
    return;
  }
  const currentIdx = cands.findIndex((c) => c.type === n.type);
  if (currentIdx >= 0 && n.prevIndex >= 0 && n.prevIndex < cands.length) {
    const cand = cands.splice(currentIdx, 1)[0];
    cands.splice(n.prevIndex, 0, cand);
  }
  fallbackNotice.value = null;
}

async function runFromSelected() {
  if (!selectedId.value || !store.flowLocal?.id) return;
  try {
    await save();
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW,
      flowId: store.flowLocal.id,
      options: {
        ...(((store.flowLocal as any).meta && (store.flowLocal as any).meta.runOptions) || {}),
        returnLogs: true,
        startNodeId: selectedId.value,
      },
    });
    if (!(res && res.success)) {
      console.warn('从选中节点回放失败');
      return;
    }
    // Focus first failed step/node if any
    try {
      const logs = res.result?.logs || [];
      const failed = logs.find((l: any) => l.status === 'failed');
      if (failed && failed.stepId) {
        focusNode(String(failed.stepId));
      }
      // If selector fallback was used for this step, promote the matched type
      const thisStepLogs = logs.filter((l: any) => l.stepId === selectedId.value);
      const fb = thisStepLogs.find((l: any) => l.fallbackUsed && l.fallbackTo);
      if (fb && fb.fallbackTo) applyFallbackPromotion(selectedId.value, String(fb.fallbackTo));
    } catch {}
  } catch (e) {
    console.error('从选中节点回放失败:', e);
  }
}

async function runAll() {
  if (!store.flowLocal?.id) return;
  try {
    await save();
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW,
      flowId: store.flowLocal.id,
      options: {
        ...(((store.flowLocal as any).meta && (store.flowLocal as any).meta.runOptions) || {}),
        returnLogs: true,
      },
    });
    if (!(res && res.success)) return;
    try {
      const logs = res.result?.logs || [];
      const failed = logs.find((l: any) => l.status === 'failed');
      if (failed && failed.stepId) focusNode(String(failed.stepId));
    } catch {}
  } catch (e) {
    console.error('整流回放失败:', e);
  }
}

function onAddNodeAt(type: string, x: number, y: number) {
  try {
    store.addNodeAt(type as any, x, y);
  } catch {}
}

function focusNode(id: string) {
  store.selectNode(id);
  focusNodeId.value = id;
  setTimeout(() => (focusNodeId.value = null), 300);
}

// Auto focus when parent passes a node id (e.g., failed step)
watch(
  () => props.initialFocusNodeId,
  (nid) => {
    if (nid) focusNode(nid);
  },
  { immediate: true },
);

// Apply fallback hint from parent (promote matched candidate type)
watch(
  () => props.fallbackHint,
  (hint) => {
    if (!hint) return;
    applyFallbackPromotion(hint.nodeId, String(hint.toType));
  },
  { immediate: true },
);

function focusError(nid: string, msg: string) {
  const node = store.nodes.find((n) => n.id === nid);
  if (!node) return focusNode(nid);
  focusNode(nid);
  const t = node.type;
  let field: string | null = null;
  if (t === 'http') field = 'http.url';
  else if (t === 'extract')
    field = msg.includes('保存变量名') ? 'extract.saveAs' : 'extract.selector';
  else if (t === 'switchTab') field = 'switchTab.match';
  else if (t === 'navigate') field = 'navigate.url';
  else if (t === 'fill') field = msg.includes('输入值') ? 'fill.value' : 'target.candidates';
  else if (t === 'click' || t === 'dblclick') field = 'target.candidates';
  else if (t === 'script') field = msg.includes('缺少代码') ? 'script.code' : 'script.assign';
  else field = null;
  highlightField.value = field;
  setTimeout(() => (highlightField.value = null), 1500);
}

function fitAll() {
  fitSeq.value++;
}

// Canvas controls via template ref
const canvasRef = ref<any | null>(null);
function zoomIn() {
  try {
    canvasRef.value?.zoomIn?.();
  } catch {}
}
function zoomOut() {
  try {
    canvasRef.value?.zoomOut?.();
  } catch {}
}

async function exportFlow() {
  try {
    await save();
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_EXPORT_FLOW,
      flowId: store.flowLocal.id,
    });
    if (res && res.success) {
      const blob = new Blob([res.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      await chrome.downloads.download({
        url,
        filename: `${store.flowLocal.name || 'flow'}.json`,
        saveAs: true,
      } as any);
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    console.error('导出失败:', e);
  }
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const txt = await file.text();
    const res = await chrome.runtime.sendMessage({
      type: BACKGROUND_MESSAGE_TYPES.RR_IMPORT_FLOW,
      json: txt,
    });
    if (res && res.success) {
      if (Array.isArray(res.flows) && res.flows.length) {
        store.initFromFlow(res.flows[0]);
      }
    }
  } catch (err) {
    console.error('导入失败:', err);
  } finally {
    input.value = '';
  }
}

// 快捷键：Delete/Backspace 删除选中，Cmd/Ctrl+D 复制，Cmd/Ctrl+S 保存
function onKey(e: KeyboardEvent) {
  const id = selectedId.value;
  const isMeta = e.metaKey || e.ctrlKey;
  if ((e.key === 'Delete' || e.key === 'Backspace') && id) {
    e.preventDefault();
    store.removeNode(id);
  } else if (isMeta && e.key.toLowerCase?.() === 'd') {
    if (id) {
      e.preventDefault();
      store.duplicateNode(id);
    }
  } else if (isMeta && e.key.toLowerCase?.() === 'c') {
    // copy (single selection)
    e.preventDefault();
    if (id) (window as any).__builder_clipboard = id;
  } else if (isMeta && e.key.toLowerCase?.() === 'v') {
    // paste (duplicate selected or copied id)
    e.preventDefault();
    const srcId = id || (window as any).__builder_clipboard;
    if (srcId) store.duplicateNode(srcId);
  } else if (isMeta && e.key.toLowerCase?.() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo();
    else store.undo();
  } else if (isMeta && e.key.toLowerCase?.() === 's') {
    e.preventDefault();
    save();
  }
}
onMounted(() => document.addEventListener('keydown', onKey));
onUnmounted(() => document.removeEventListener('keydown', onKey));

// 自动保存（去抖）
const saveState = ref<'idle' | 'saving' | 'saved'>('idle');
const saveLabel = computed(() =>
  saveState.value === 'saving' ? '保存中…' : saveState.value === 'saved' ? '已保存' : '',
);
let saveTimer: any = null;
let statusTimer: any = null;
function scheduleAutoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      saveState.value = 'saving';
      await new Promise((r) => setTimeout(r, 0));
      save();
      saveState.value = 'saved';
      if (statusTimer) clearTimeout(statusTimer);
      statusTimer = setTimeout(() => (saveState.value = 'idle'), 1200);
    } catch {
      saveState.value = 'idle';
    }
  }, 800);
}
watch(
  () => [store.nodes, store.edges, store.flowLocal.name, (store.flowLocal as any).description],
  scheduleAutoSave,
  { deep: true },
);
</script>

<style scoped>
.builder-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(4px);
}
.builder {
  width: 96vw;
  height: 92vh;
  background: var(--rr-bg);
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.25);
}
.builder.rr-theme {
  --rr-bg: #0a0a0a;
  --rr-topbar: #1a1a1a;
  --rr-card: #1a1a1a;
  --rr-elevated: #262626;
  --rr-border: #2a2a2a;
  --rr-border-light: #333333;
  --rr-subtle: #1f1f1f;
  --rr-text: #e5e5e5;
  --rr-text-secondary: #a3a3a3;
  --rr-text-weak: #737373;
  --rr-muted: #525252;
  --rr-brand: #f59e0b;
  --rr-brand-strong: #d97706;
  --rr-accent: #3b82f6;
  --rr-success: #22c55e;
  --rr-warn: #f59e0b;
  --rr-danger: #ef4444;
  --rr-hover: #262626;
}

/* 顶部工具栏 */
.topbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--rr-border);
  background: #ededed;
  gap: 20px;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.btn-back {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--rr-text-secondary);
  transition: all 0.15s;
}

.btn-back:hover {
  background: var(--rr-hover);
  color: var(--rr-text);
}

.workflow-title {
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: var(--rr-text);
  padding: 8px 12px;
  border-radius: 6px;
  outline: none;
  max-width: 400px;
}

.workflow-title:hover {
  background: var(--rr-hover);
}

.workflow-title:focus {
  background: var(--rr-hover);
}

.draft-badge {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--rr-subtle);
  color: var(--rr-text-secondary);
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 工具栏按钮组 */
.toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: var(--rr-subtle);
  border-radius: 8px;
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  color: var(--rr-text-secondary);
  transition: all 0.15s;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--rr-card);
  color: var(--rr-text);
}

.toolbar-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toolbar-divider {
  width: 1px;
  height: 24px;
  background: var(--rr-border);
  margin: 0 4px;
}

/* 主按钮 */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  background: var(--rr-text);
  color: var(--rr-card);
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-primary:hover {
  background: var(--rr-text-secondary);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.btn-publish {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  background: var(--rr-brand);
  color: #fff;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-publish:hover {
  background: var(--rr-brand-strong);
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
}

/* 图标按钮 */
.toolbar-btn-icon {
  position: relative;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rr-border);
  background: var(--rr-card);
  border-radius: 8px;
  cursor: pointer;
  color: var(--rr-text-secondary);
  transition: all 0.15s;
}

.toolbar-btn-icon:hover {
  background: var(--rr-hover);
  border-color: var(--rr-text-weak);
  color: var(--rr-text);
}

.error-badge-count {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 5px;
  background: var(--rr-danger);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  border-radius: 9px;
  border: 2px solid var(--rr-topbar);
}

.main {
  flex: 1;
  display: grid;
  grid-template-columns: 180px 1fr 420px;
  gap: 0;
  padding: 0;
  overflow: hidden;
  background: var(--rr-bg);
}

/* 底部工具栏 */
.bottombar {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-top: 1px solid var(--rr-border);
  background: #f0f0f0;
}
.bottombar .status {
  color: var(--rr-muted);
  font-size: 12px;
}
.zoom-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.zoom-btn {
  min-width: 40px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--rr-border);
  background: var(--rr-card);
  color: var(--rr-text);
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.zoom-btn:hover {
  background: var(--rr-hover);
}

/* 错误面板 */
.error-panel {
  position: absolute;
  right: 360px;
  top: 80px;
  width: 380px;
  max-height: 60vh;
  background: var(--rr-card);
  border: 1px solid var(--rr-border);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 16px;
  overflow: auto;
  z-index: 50;
}
.err-title {
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 12px;
  color: var(--rr-text);
}
.err-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.err-item {
  display: grid;
  grid-template-columns: 100px 1fr;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--rr-border-light);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.err-item:hover {
  background: var(--rr-subtle);
  border-color: var(--rr-border);
}
.err-item .nid {
  font-size: 12px;
  font-weight: 600;
  color: var(--rr-text-secondary);
}
.err-item .elist {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.err-item .e {
  font-size: 12px;
  color: var(--rr-danger);
  line-height: 1.4;
}

/* 通知栏 */
.notice-top {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  color: #fff;
  padding: 10px 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}
.notice-top .mini {
  padding: 4px 12px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}
.notice-top .mini:hover {
  background: rgba(255, 255, 255, 0.3);
}
</style>
