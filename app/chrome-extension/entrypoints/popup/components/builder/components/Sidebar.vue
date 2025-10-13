<template>
  <aside class="sidebar">
    <div class="search-box">
      <svg class="search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="1.5" />
        <path d="m10 10 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
      </svg>
      <input class="search-input" placeholder="Insert node..." />
    </div>

    <div class="nodes-section">
      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('navigate', $event)"
        @click="$emit('addNode', 'navigate')"
        title="导航"
      >
        <div class="btn-icon icon-navigate">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2v12M2 8h12"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">导航</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('click', $event)"
        @click="$emit('addNode', 'click')"
        title="点击"
      >
        <div class="btn-icon icon-click">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="3" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </div>
        <span class="btn-label">点击</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('fill', $event)"
        @click="$emit('addNode', 'fill')"
        title="填充"
      >
        <div class="btn-icon icon-fill">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="3"
              y="5"
              width="10"
              height="8"
              rx="1"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </div>
        <span class="btn-label">填充</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('wait', $event)"
        @click="$emit('addNode', 'wait')"
        title="等待"
      >
        <div class="btn-icon icon-wait">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
            <path d="M8 4v4l3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <span class="btn-label">等待</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('key', $event)"
        @click="$emit('addNode', 'key')"
        title="键盘"
      >
        <div class="btn-icon icon-key">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm6 0h4m0 0v2m0-2v-2"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">键盘</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('assert', $event)"
        @click="$emit('addNode', 'assert')"
        title="断言"
      >
        <div class="btn-icon icon-assert">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M5 8l2 2 4-4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <span class="btn-label">断言</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('delay', $event)"
        @click="$emit('addNode', 'delay')"
        title="延迟"
      >
        <div class="btn-icon icon-delay">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path
              d="M8 4v8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              opacity=".4"
            />
          </svg>
        </div>
        <span class="btn-label">延迟</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('extract', $event)"
        @click="$emit('addNode', 'extract')"
        title="提取"
      >
        <div class="btn-icon icon-extract">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M3 8h10M8 3v10"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">提取</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('screenshot', $event)"
        @click="$emit('addNode', 'screenshot')"
        title="截图"
      >
        <div class="btn-icon icon-screenshot">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="3"
              y="4"
              width="10"
              height="8"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <path d="M5 3h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <span class="btn-label">截图</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('triggerEvent', $event)"
        @click="$emit('addNode', 'triggerEvent')"
        title="触发事件"
      >
        <div class="btn-icon icon-trigger">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 8h12M8 2v12"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">触发事件</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('setAttribute', $event)"
        @click="$emit('addNode', 'setAttribute')"
        title="设置属性"
      >
        <div class="btn-icon icon-attr">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M4 4h8v8H4z" stroke="currentColor" stroke-width="1.5" />
            <path
              d="M5 7h6M5 9h6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">设置属性</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('loopElements', $event)"
        @click="$emit('addNode', 'loopElements')"
        title="循环元素"
      >
        <div class="btn-icon icon-loop">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 8a5 5 0 1 0 5-5" stroke="currentColor" stroke-width="1.5" />
            <path d="M8 1v3H5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <span class="btn-label">循环元素</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('switchFrame', $event)"
        @click="$emit('addNode', 'switchFrame')"
        title="切换框架"
      >
        <div class="btn-icon icon-frame">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="2"
              y="3"
              width="12"
              height="10"
              rx="1.5"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <rect x="5" y="6" width="6" height="4" rx="1" fill="currentColor" />
          </svg>
        </div>
        <span class="btn-label">切换Frame</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('executeFlow', $event)"
        @click="$emit('addNode', 'executeFlow')"
        title="执行子工作流"
      >
        <div class="btn-icon icon-exec">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M3 4h10v8H3z" stroke="currentColor" stroke-width="1.5" />
            <path d="M6 6l4 2-4 2V6z" fill="currentColor" />
          </svg>
        </div>
        <span class="btn-label">执行工作流</span>
      </button>
    </div>

    <div class="section-divider">
      <span class="divider-label">Tools</span>
    </div>

    <div class="nodes-section">
      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('http', $event)"
        @click="$emit('addNode', 'http')"
        title="HTTP"
      >
        <div class="btn-icon icon-http">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5" />
          </svg>
        </div>
        <span class="btn-label">HTTP</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('handleDownload', $event)"
        @click="$emit('addNode', 'handleDownload')"
        title="下载处理"
      >
        <div class="btn-icon icon-download">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v6m0 0l3-3M8 9L5 6M3 11h10"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">下载处理</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('script', $event)"
        @click="$emit('addNode', 'script')"
        title="脚本"
      >
        <div class="btn-icon icon-script">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M5 4 3 8l2 4M11 4l2 4-2 4"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">脚本</span>
      </button>
    </div>

    <div class="section-divider">
      <span class="divider-label">Tabs</span>
    </div>

    <div class="nodes-section">
      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('openTab', $event)"
        @click="$emit('addNode', 'openTab')"
        title="打开标签"
      >
        <div class="btn-icon icon-openTab">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect
              x="3"
              y="4"
              width="10"
              height="8"
              rx="1"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </div>
        <span class="btn-label">打开标签</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('switchTab', $event)"
        @click="$emit('addNode', 'switchTab')"
        title="切换标签"
      >
        <div class="btn-icon icon-switchTab">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M5 5h6M5 8h6M5 11h6"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">切换标签</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('closeTab', $event)"
        @click="$emit('addNode', 'closeTab')"
        title="关闭标签"
      >
        <div class="btn-icon icon-closeTab">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M5 5l6 6M11 5 5 11"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">关闭标签</span>
      </button>
    </div>

    <div class="section-divider">
      <span class="divider-label">Logic</span>
    </div>

    <div class="nodes-section">
      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('if', $event)"
        @click="$emit('addNode', 'if')"
        title="条件"
      >
        <div class="btn-icon icon-if">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 3v10M5 8l3-3 3 3"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        <span class="btn-label">If / else</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('foreach', $event)"
        @click="$emit('addNode', 'foreach')"
        title="循环"
      >
        <div class="btn-icon icon-foreach">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M13 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0z"
              stroke="currentColor"
              stroke-width="1.5"
            />
          </svg>
        </div>
        <span class="btn-label">For each</span>
      </button>

      <button
        class="node-btn"
        draggable="true"
        @dragstart="onDragStart('while', $event)"
        @click="$emit('addNode', 'while')"
        title="While"
      >
        <div class="btn-icon icon-while">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M4 8h8M8 4v8"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <span class="btn-label">While</span>
      </button>
    </div>
  </aside>
</template>

<script lang="ts" setup>
import { ref } from 'vue';
import type { Flow as FlowV2, NodeBase } from '@/entrypoints/background/record-replay/types';

const props = defineProps<{
  flow: FlowV2;
  paletteTypes: NodeBase['type'][];
  subflowIds?: string[];
  currentSubflowId?: string | null;
}>();
defineEmits<{
  (e: 'addNode', t: NodeBase['type']): void;
  (e: 'switchMain'): void;
  (e: 'switchSubflow', id: string): void;
  (e: 'addSubflow', id: string): void;
  (e: 'removeSubflow', id: string): void;
}>();
// Give component a multi-word name to satisfy lint rule and improve debug readability
defineOptions({ name: 'BuilderSidebar' });

function onDragStart(t: NodeBase['type'], e: DragEvent) {
  // Set multiple MIME types for broader compatibility across environments
  try {
    const dt = e.dataTransfer;
    if (!dt) return;
    dt.setData('application/node-type', String(t));
    dt.setData('text/node-type', String(t));
    dt.setData('text/plain', String(t));
    dt.effectAllowed = 'copy';
  } catch {}
}
</script>

<style scoped>
.sidebar {
  background: var(--rr-card);
  border: 1px solid var(--rr-border);
  border-radius: 16px;
  padding: 16px 12px;
  margin: 16px;
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  /* Ensure the sidebar never exceeds viewport height; allow internal scroll */
  max-height: calc(100vh - 72px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
}

/* 搜索框 */
.search-box {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  color: var(--rr-text-weak);
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 8px 10px 8px 32px;
  border: 1px solid var(--rr-border);
  border-radius: 8px;
  background: var(--rr-subtle);
  font-size: 13px;
  outline: none;
  transition: all 0.15s;
}
.search-input:focus {
  background: var(--rr-card);
  border-color: var(--rr-text-weak);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.06);
}

/* 节点区域 */
.nodes-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 节点按钮 */
.node-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  position: relative;
}

.node-btn:hover {
  background: var(--rr-hover);
}

.node-btn:active {
  transform: scale(0.98);
}

/* 节点图标 - 彩色圆形 */
.btn-icon {
  width: 30px;
  height: 30px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #fff;
}

.icon-navigate {
  background: #667eea;
}
.icon-click {
  background: #f5576c;
}
.icon-fill {
  background: #4facfe;
}
.icon-wait {
  background: #43e97b;
}
.icon-extract {
  background: #fa709a;
}
.icon-http {
  background: #30cfd0;
}
.icon-download {
  background: #34d399;
}
.icon-script {
  background: #a8edea;
  color: #111;
}
.icon-screenshot {
  background: #06b6d4;
}
.icon-trigger {
  background: #f59e0b;
}
.icon-attr {
  background: #8b5cf6;
}
.icon-loop {
  background: #22c55e;
}
.icon-frame {
  background: #64748b;
}
.icon-exec {
  background: #111827;
}
.icon-key {
  background: #8ec5fc;
  color: #111;
}
.icon-assert {
  background: #16a34a;
}
.icon-delay {
  background: #f6d365;
  color: #111;
}
.icon-if {
  background: #ff9a56;
}
.icon-foreach,
.icon-while {
  background: #fcb69f;
  color: #111;
}
.icon-openTab,
.icon-switchTab,
.icon-closeTab {
  background: #96fbc4;
  color: #111;
}

/* Thinner, light scrollbars inside the sidebar */
.sidebar :deep(::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}
.sidebar :deep(::-webkit-scrollbar-thumb) {
  background-color: rgba(0, 0, 0, 0.25);
  border-radius: 6px;
}
.sidebar :deep(::-webkit-scrollbar-track) {
  background: transparent;
}

/* 节点标签 */
.btn-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--rr-text);
  flex: 1;
}

/* 分割线 */
.section-divider {
  display: flex;
  align-items: center;
  margin: 12px 0 8px;
}

.divider-label {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--rr-text-weak);
  white-space: nowrap;
}
</style>
