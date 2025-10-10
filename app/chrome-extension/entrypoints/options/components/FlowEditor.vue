<template>
  <section class="flow-editor">
    <h2>Flow Editor（录制流编辑器）</h2>
    <div class="container">
      <div class="left">
        <div class="toolbar">
          <input v-model="query" placeholder="搜索名称/描述" @input="loadFlows" />
          <button @click="exportAll">导出全部</button>
          <label class="import-btn">
            导入
            <input type="file" accept="application/json" @change="onImport" />
          </label>
        </div>
        <div class="list">
          <div
            v-for="f in filteredFlows"
            :key="f.id"
            class="item"
            :class="{ active: selectedFlow && selectedFlow.id === f.id }"
            @click="selectFlow(f)"
          >
            <div class="name">{{ f.name }}</div>
            <div class="desc">{{ f.description || '' }}</div>
          </div>
        </div>
      </div>
      <div class="right" v-if="selectedFlow">
        <div class="row">
          <label>名称<input v-model="selectedFlow.name" /></label>
          <label>描述<input v-model="selectedFlow.description" /></label>
        </div>
        <div class="row">
          <label
            >绑定
            <div class="bindings">
              <div class="binding" v-for="(b, i) in selectedFlow.meta?.bindings || []" :key="i">
                <select v-model="b.type">
                  <option value="domain">domain</option>
                  <option value="path">path</option>
                  <option value="url">url</option>
                </select>
                <input v-model="b.value" placeholder="值" />
                <button class="link" @click="removeBinding(i)">移除</button>
              </div>
              <button @click="addBinding">添加绑定</button>
            </div>
          </label>
        </div>

        <h3>变量</h3>
        <div class="vars">
          <div class="var" v-for="(v, i) in selectedFlow.variables || []" :key="i">
            <input v-model="v.key" placeholder="key" />
            <input v-model="v.label" placeholder="label" />
            <input v-model="v.default" placeholder="default" />
            <label class="chk"><input type="checkbox" v-model="v.sensitive" />敏感</label>
            <button class="link" @click="removeVar(i)">移除</button>
          </div>
          <button @click="addVar">添加变量</button>
        </div>

        <h3>步骤（选中步骤以编辑属性）</h3>
        <div class="steps">
          <div
            class="step"
            v-for="(s, i) in selectedFlow.steps"
            :key="s.id || i"
            :class="{ active: activeStepIndex === i }"
            @click="activeStepIndex = i"
          >
            <div class="title">{{ i + 1 }}. {{ s.type }}</div>
            <div class="subtitle">{{ summarizeStep(s) }}</div>
            <div class="step-actions">
              <button class="link" @click.stop="moveStep(i, -1)">上移</button>
              <button class="link" @click.stop="moveStep(i, 1)">下移</button>
            </div>
            <button class="link danger" @click.stop="removeStep(i)">删除</button>
          </div>
        </div>

        <div v-if="activeStep" class="panel">
          <h4>属性面板</h4>
          <div class="grid">
            <label>超时(ms)<input type="number" v-model.number="activeStep.timeoutMs" /></label>
            <label class="chk"
              ><input type="checkbox" v-model="activeStep.screenshotOnFail" />失败截图</label
            >
          </div>

          <div class="grid">
            <label class="chk">
              <input
                type="checkbox"
                :checked="!!activeStep.retry"
                @change="onToggleRetry($event)"
              />
              启用重试
            </label>
            <template v-if="activeStep.retry">
              <label
                >重试次数<input type="number" v-model.number="activeStep.retry.count" min="0"
              /></label>
              <label
                >间隔(ms)<input type="number" v-model.number="activeStep.retry.intervalMs" min="0"
              /></label>
              <label>
                退避
                <select v-model="activeStep.retry.backoff">
                  <option value="none">none</option>
                  <option value="exp">exp</option>
                </select>
              </label>
            </template>
          </div>

          <div
            v-if="
              activeStep.type === 'click' ||
              activeStep.type === 'dblclick' ||
              activeStep.type === 'fill' ||
              activeStep.type === 'scroll'
            "
          >
            <h5>选择器候选（拖动排序或上下移动）</h5>
            <div class="cands">
              <div class="cand" v-for="(c, ci) in activeStep.target?.candidates || []" :key="ci">
                <select v-model="c.type">
                  <option value="css">css</option>
                  <option value="attr">attr</option>
                  <option value="aria">aria</option>
                  <option value="text">text</option>
                  <option value="xpath">xpath</option>
                </select>
                <input v-model="c.value" />
                <button class="link" @click="moveCandidate(ci, -1)">上移</button>
                <button class="link" @click="moveCandidate(ci, 1)">下移</button>
                <button class="link danger" @click="removeCandidate(ci)">删除</button>
              </div>
              <button @click="addCandidate">添加候选</button>
            </div>
            <div v-if="activeStep.type === 'scroll'" class="grid">
              <label>
                模式
                <select v-model="activeStep.mode">
                  <option value="offset">offset</option>
                  <option value="element">element</option>
                  <option value="container">container</option>
                </select>
              </label>
              <template v-if="activeStep.mode === 'offset'">
                <label
                  >X<input type="number" v-model.number="(activeStep.offset ||= {}).x"
                /></label>
                <label
                  >Y<input type="number" v-model.number="(activeStep.offset ||= {}).y"
                /></label>
              </template>
            </div>
          </div>

          <div v-if="activeStep.type === 'drag'">
            <h5>起点选择器候选</h5>
            <div class="cands">
              <div
                class="cand"
                v-for="(c, ci) in activeStep.start?.candidates || []"
                :key="'s' + ci"
              >
                <select v-model="c.type">
                  <option value="css">css</option>
                  <option value="attr">attr</option>
                  <option value="aria">aria</option>
                  <option value="text">text</option>
                  <option value="xpath">xpath</option>
                </select>
                <input v-model="c.value" />
                <button class="link" @click="moveCandidateFor(activeStep.start, ci, -1)"
                  >上移</button
                >
                <button class="link" @click="moveCandidateFor(activeStep.start, ci, 1)"
                  >下移</button
                >
                <button class="link danger" @click="removeCandidateFor(activeStep.start, ci)"
                  >删除</button
                >
              </div>
              <button @click="addCandidateFor(activeStep.start)">添加候选</button>
            </div>
            <h5>终点选择器候选</h5>
            <div class="cands">
              <div class="cand" v-for="(c, ci) in activeStep.end?.candidates || []" :key="'e' + ci">
                <select v-model="c.type">
                  <option value="css">css</option>
                  <option value="attr">attr</option>
                  <option value="aria">aria</option>
                  <option value="text">text</option>
                  <option value="xpath">xpath</option>
                </select>
                <input v-model="c.value" />
                <button class="link" @click="moveCandidateFor(activeStep.end, ci, -1)">上移</button>
                <button class="link" @click="moveCandidateFor(activeStep.end, ci, 1)">下移</button>
                <button class="link danger" @click="removeCandidateFor(activeStep.end, ci)"
                  >删除</button
                >
              </div>
              <button @click="addCandidateFor(activeStep.end)">添加候选</button>
            </div>
          </div>

          <div v-if="activeStep.type === 'click' || activeStep.type === 'dblclick'" class="grid">
            <label class="chk">
              <input
                type="checkbox"
                :checked="!!activeStep.before?.scrollIntoView"
                @change="onToggleBeforeScrollIntoView($event)"
              />
              点击前滚动到可见
            </label>
            <label class="chk">
              <input
                type="checkbox"
                :checked="!!activeStep.after?.waitForNavigation"
                @change="onToggleAfterWaitNav($event)"
              />
              点击后等待导航
            </label>
          </div>

          <div v-if="activeStep.type === 'wait'" class="grid">
            <label>
              条件类型
              <select
                :value="waitType"
                @change="onChangeWaitType(($event.target as HTMLSelectElement).value)"
              >
                <option value="text">text</option>
                <option value="selector">selector</option>
                <option value="navigation">navigation</option>
                <option value="networkIdle">networkIdle</option>
              </select>
            </label>
            <template v-if="waitType === 'text'">
              <label>文本<input v-model="activeStep.condition.text" /></label>
              <label class="chk"
                ><input type="checkbox" v-model="activeStep.condition.appear" />出现</label
              >
            </template>
            <template v-if="waitType === 'selector'">
              <label>选择器<input v-model="activeStep.condition.selector" /></label>
              <label class="chk"
                ><input type="checkbox" v-model="activeStep.condition.visible" />可见</label
              >
            </template>
            <template v-if="waitType === 'navigation'">
              <div>等待导航中...</div>
            </template>
            <template v-if="waitType === 'networkIdle'">
              <div>等待网络空闲中...</div>
            </template>
          </div>

          <div v-if="activeStep.type === 'assert'" class="grid">
            <label>
              断言类型
              <select
                :value="assertType"
                @change="onChangeAssertType(($event.target as HTMLSelectElement).value)"
              >
                <option value="exists">exists</option>
                <option value="visible">visible</option>
                <option value="textPresent">textPresent</option>
                <option value="attribute">attribute</option>
              </select>
            </label>
            <template v-if="assertType === 'exists'">
              <label>选择器<input v-model="activeStep.assert.exists" /></label>
            </template>
            <template v-if="assertType === 'visible'">
              <label>选择器<input v-model="activeStep.assert.visible" /></label>
            </template>
            <template v-if="assertType === 'textPresent'">
              <label>文本<input v-model="activeStep.assert.textPresent" /></label>
            </template>
            <template v-if="assertType === 'attribute'">
              <label>选择器<input v-model="activeStep.assert.attribute.selector" /></label>
              <label>属性名<input v-model="activeStep.assert.attribute.name" /></label>
              <label>equals<input v-model="activeStep.assert.attribute.equals" /></label>
              <label>matches<input v-model="activeStep.assert.attribute.matches" /></label>
            </template>
          </div>

          <div v-if="activeStep.type === 'script'" class="grid">
            <label>
              world
              <select v-model="activeStep.world">
                <option value="MAIN">MAIN</option>
                <option value="ISOLATED">ISOLATED</option>
              </select>
            </label>
            <label>
              when
              <select v-model="activeStep.when">
                <option value="before">before</option>
                <option value="after">after</option>
              </select>
            </label>
            <label style="grid-column: 1 / span 2">
              代码
              <textarea v-model="activeStep.code" rows="6" style="width: 100%"></textarea>
            </label>
          </div>

          <div v-if="activeStep.type === 'navigate'" class="grid">
            <label style="grid-column: 1 / span 2">URL<input v-model="activeStep.url" /></label>
          </div>

          <div class="row buttons">
            <button @click="save">保存</button>
            <button @click="exportOne">导出</button>
            <button @click="run">测试回放</button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';

interface FlowRef {
  id: string;
  name: string;
  description?: string;
  steps: any[];
  variables?: any[];
  meta?: any;
}

const flows = ref<FlowRef[]>([]);
const selectedFlow = ref<FlowRef | null>(null);
const query = ref('');
const activeStepIndex = ref<number>(-1);

const filteredFlows = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return flows.value;
  return flows.value.filter((f) =>
    (f.name + ' ' + (f.description || '')).toLowerCase().includes(q),
  );
});

const activeStep = computed<any>(() => {
  if (!selectedFlow.value) return null;
  return selectedFlow.value.steps[activeStepIndex.value] || null;
});

function summarizeStep(s: any) {
  if (s.type === 'fill') return `填充 ${s.target?.candidates?.[0]?.value || s.target?.ref || ''}`;
  if (s.type === 'click' || s.type === 'dblclick')
    return `点击 ${s.target?.candidates?.[0]?.value || s.target?.ref || ''}`;
  if (s.type === 'key') return `按键 ${s.keys}`;
  if (s.type === 'wait') return `等待 ...`;
  return s.type;
}

async function loadFlows() {
  const res = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_LIST_FLOWS });
  if (res && res.success) flows.value = res.flows || [];
}

function selectFlow(f: FlowRef) {
  selectedFlow.value = JSON.parse(JSON.stringify(f));
  activeStepIndex.value = -1;
}

function addBinding() {
  if (!selectedFlow.value) return;
  if (!selectedFlow.value.meta) selectedFlow.value.meta = {};
  if (!selectedFlow.value.meta.bindings) selectedFlow.value.meta.bindings = [];
  selectedFlow.value.meta.bindings.push({ type: 'path', value: '/' });
}
function removeBinding(i: number) {
  if (!selectedFlow.value?.meta?.bindings) return;
  selectedFlow.value.meta.bindings.splice(i, 1);
}

function addVar() {
  if (!selectedFlow.value) return;
  if (!selectedFlow.value.variables) selectedFlow.value.variables = [];
  selectedFlow.value.variables.push({ key: 'var', label: '', default: '', sensitive: false });
}
function removeVar(i: number) {
  if (!selectedFlow.value?.variables) return;
  selectedFlow.value.variables.splice(i, 1);
}

function removeStep(i: number) {
  if (!selectedFlow.value) return;
  selectedFlow.value.steps.splice(i, 1);
  if (activeStepIndex.value >= selectedFlow.value.steps.length)
    activeStepIndex.value = selectedFlow.value.steps.length - 1;
}

function moveStep(i: number, delta: number) {
  if (!selectedFlow.value) return;
  const arr = selectedFlow.value.steps;
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
  activeStepIndex.value = j;
}

function addCandidate() {
  if (!activeStep.value) return;
  if (!activeStep.value.target) activeStep.value.target = { candidates: [] };
  if (!activeStep.value.target.candidates) activeStep.value.target.candidates = [];
  activeStep.value.target.candidates.push({ type: 'css', value: '' });
}
function moveCandidate(i: number, delta: number) {
  if (!activeStep.value?.target?.candidates) return;
  const arr = activeStep.value.target.candidates;
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function removeCandidate(i: number) {
  if (!activeStep.value?.target?.candidates) return;
  activeStep.value.target.candidates.splice(i, 1);
}

function addCandidateFor(target: any) {
  if (!target) return;
  if (!target.candidates) target.candidates = [];
  target.candidates.push({ type: 'css', value: '' });
}
function moveCandidateFor(target: any, i: number, delta: number) {
  if (!target?.candidates) return;
  const arr = target.candidates;
  const j = i + delta;
  if (j < 0 || j >= arr.length) return;
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function removeCandidateFor(target: any, i: number) {
  if (!target?.candidates) return;
  target.candidates.splice(i, 1);
}

function onToggleRetry(e: Event) {
  if (!activeStep.value) return;
  const checked = (e.target as HTMLInputElement).checked;
  if (checked) {
    activeStep.value.retry ||= { count: 2, intervalMs: 500, backoff: 'exp' };
  } else {
    delete activeStep.value.retry;
  }
}

function onToggleAfterWaitNav(e: Event) {
  const step = activeStep.value;
  if (!step) return;
  const checked = (e.target as HTMLInputElement).checked;
  step.after ||= {};
  step.after.waitForNavigation = checked;
}
function onToggleBeforeScrollIntoView(e: Event) {
  const step = activeStep.value;
  if (!step) return;
  const checked = (e.target as HTMLInputElement).checked;
  step.before ||= {};
  step.before.scrollIntoView = checked;
}

const waitType = computed<string>(() => {
  const s = activeStep.value;
  if (!s || s.type !== 'wait') return 'text';
  const c = s.condition as any;
  if ('text' in c) return 'text';
  if ('selector' in c) return 'selector';
  if ('navigation' in c) return 'navigation';
  if ('networkIdle' in c) return 'networkIdle';
  return 'text';
});
function onChangeWaitType(val: string) {
  const s = activeStep.value;
  if (!s || s.type !== 'wait') return;
  if (val === 'text') s.condition = { text: '', appear: true } as any;
  else if (val === 'selector') s.condition = { selector: '', visible: true } as any;
  else if (val === 'navigation') s.condition = { navigation: true } as any;
  else if (val === 'networkIdle') s.condition = { networkIdle: true } as any;
}

const assertType = computed<string>(() => {
  const s = activeStep.value;
  if (!s || s.type !== 'assert') return 'exists';
  const a = s.assert as any;
  if ('exists' in a) return 'exists';
  if ('visible' in a) return 'visible';
  if ('textPresent' in a) return 'textPresent';
  if ('attribute' in a) return 'attribute';
  return 'exists';
});
function onChangeAssertType(val: string) {
  const s = activeStep.value;
  if (!s || s.type !== 'assert') return;
  if (val === 'exists') s.assert = { exists: '' } as any;
  else if (val === 'visible') s.assert = { visible: '' } as any;
  else if (val === 'textPresent') s.assert = { textPresent: '' } as any;
  else if (val === 'attribute') s.assert = { attribute: { selector: '', name: '' } } as any;
}

async function save() {
  if (!selectedFlow.value) return;
  const res = await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.RR_SAVE_FLOW,
    flow: selectedFlow.value,
  });
  if (res && res.success) await loadFlows();
}

async function exportOne() {
  if (!selectedFlow.value) return;
  const res = await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.RR_EXPORT_FLOW,
    flowId: selectedFlow.value.id,
  });
  if (res && res.success) {
    const blob = new Blob([res.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({
      url,
      filename: `${selectedFlow.value.name || 'flow'}.json`,
      saveAs: true,
    } as any);
    URL.revokeObjectURL(url);
  }
}

async function exportAll() {
  const res = await chrome.runtime.sendMessage({ type: BACKGROUND_MESSAGE_TYPES.RR_EXPORT_ALL });
  if (res && res.success) {
    const blob = new Blob([res.json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await chrome.downloads.download({ url, filename: 'flows-export.json', saveAs: true } as any);
    URL.revokeObjectURL(url);
  }
}

async function onImport(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const txt = await file.text();
  const res = await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.RR_IMPORT_FLOW,
    json: txt,
  });
  if (res && res.success) await loadFlows();
  input.value = '';
}

async function run() {
  if (!selectedFlow.value) return;
  const res = await chrome.runtime.sendMessage({
    type: BACKGROUND_MESSAGE_TYPES.RR_RUN_FLOW,
    flowId: selectedFlow.value.id,
    options: { returnLogs: true },
  });
  if (!(res && res.success)) {
    console.warn('回放失败');
  }
}

onMounted(loadFlows);
</script>

<style scoped>
.flow-editor {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}
.container {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 12px;
}
.left {
  border-right: 1px solid #eee;
  padding-right: 12px;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.toolbar input {
  flex: 1;
}
.import-btn {
  position: relative;
  overflow: hidden;
}
.import-btn input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 360px;
  overflow: auto;
}
.item {
  padding: 6px;
  border: 1px solid #eee;
  border-radius: 8px;
  cursor: pointer;
}
.item.active {
  border-color: #3b82f6;
  background: #eff6ff;
}
.item .name {
  font-weight: 600;
}
.item .desc {
  font-size: 12px;
  color: #666;
}
.right {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.row {
  display: flex;
  gap: 8px;
}
.row.buttons {
  gap: 12px;
}
.bindings {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.binding {
  display: flex;
  gap: 6px;
  align-items: center;
}
.vars {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.var {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 100px auto;
  gap: 6px;
  align-items: center;
}
.chk {
  display: flex;
  gap: 4px;
  align-items: center;
}
.steps {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.step {
  border: 1px solid #eee;
  border-radius: 8px;
  padding: 8px;
  cursor: pointer;
  position: relative;
}
.step .title {
  font-weight: 600;
}
.step .subtitle {
  font-size: 12px;
  color: #555;
}
.step .danger {
  color: #ef4444;
  position: absolute;
  right: 8px;
  top: 8px;
}
.step.active {
  border-color: #3b82f6;
  background: #eff6ff;
}
.panel {
  border-top: 1px dashed #ddd;
  padding-top: 8px;
}
.grid {
  display: grid;
  grid-template-columns: 200px 200px;
  gap: 8px;
}
.cands {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cand {
  display: grid;
  grid-template-columns: 120px 1fr auto auto auto;
  gap: 6px;
  align-items: center;
}
button {
  background: #3b82f6;
  color: #fff;
  border: none;
  padding: 6px 10px;
  border-radius: 8px;
  cursor: pointer;
}
button.link {
  background: transparent;
  color: #2563eb;
  padding: 0;
}
button.link.danger {
  color: #ef4444;
}
input,
select {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 6px;
  font-size: 12px;
}
</style>
