<template>
  <div class="page">
    <header class="topbar">
      <h1>Userscripts Manager</h1>
      <div class="switch">
        <label>
          <input type="checkbox" v-model="emergencyDisabled" @change="saveEmergency" />
          <span>Emergency OFF/ON</span>
        </label>
      </div>
    </header>

    <section class="create">
      <h2>Create / Run</h2>
      <div class="grid">
        <label>
          Name
          <input v-model="form.name" placeholder="optional" />
        </label>
        <label>
          RunAt
          <select v-model="form.runAt">
            <option value="auto">auto</option>
            <option value="document_start">document_start</option>
            <option value="document_end">document_end</option>
            <option value="document_idle">document_idle</option>
          </select>
        </label>
        <label>
          World
          <select v-model="form.world">
            <option value="auto">auto</option>
            <option value="ISOLATED">ISOLATED</option>
            <option value="MAIN">MAIN</option>
          </select>
        </label>
        <label>
          Mode
          <select v-model="form.mode">
            <option value="auto">auto</option>
            <option value="persistent">persistent</option>
            <option value="css">css</option>
            <option value="once">once</option>
          </select>
        </label>
        <label>
          All Frames
          <input type="checkbox" v-model="form.allFrames" />
        </label>
        <label>
          Persist
          <input type="checkbox" v-model="form.persist" />
        </label>
        <label>
          DNR Fallback
          <input type="checkbox" v-model="form.dnrFallback" />
        </label>
      </div>
      <label>
        Matches (comma-separated)
        <input v-model="form.matches" placeholder="e.g. https://*.example.com/*" />
      </label>
      <label>
        Excludes (comma-separated)
        <input v-model="form.excludes" placeholder="optional" />
      </label>
      <label>
        Tags (comma-separated)
        <input v-model="form.tags" placeholder="optional" />
      </label>
      <label>
        Script
        <textarea v-model="form.script" placeholder="Paste JS/CSS/TM here" rows="8" />
      </label>
      <div class="row">
        <button :disabled="submitting" @click="apply('auto')">Apply</button>
        <button :disabled="submitting" @click="apply('once')">Run Once (CDP)</button>
        <span class="hint" v-if="lastResult">{{ lastResult }}</span>
      </div>
    </section>

    <section class="filters">
      <h2>List</h2>
      <div class="grid">
        <label>
          Query
          <input v-model="filters.query" @input="reload()" />
        </label>
        <label>
          Status
          <select v-model="filters.status" @change="reload()">
            <option value="">all</option>
            <option value="enabled">enabled</option>
            <option value="disabled">disabled</option>
          </select>
        </label>
        <label>
          Domain
          <input v-model="filters.domain" @input="reload()" placeholder="example.com" />
        </label>
      </div>
      <div class="row">
        <button @click="exportAll">Export All</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>World</th>
            <th>RunAt</th>
            <th>Updated</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="it in items" :key="it.id">
            <td>{{ it.name || it.id }}</td>
            <td>
              <label>
                <input type="checkbox" :checked="it.status === 'enabled'" @change="toggle(it)" />
                {{ it.status }}
              </label>
            </td>
            <td>{{ it.world }}</td>
            <td>{{ it.runAt }}</td>
            <td>{{ formatTime(it.updatedAt) }}</td>
            <td class="actions">
              <button @click="remove(it)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { TOOL_NAMES } from 'chrome-mcp-shared';
import { STORAGE_KEYS } from '@/common/constants';

type ListItem = {
  id: string;
  name?: string;
  status: 'enabled' | 'disabled';
  world: 'ISOLATED' | 'MAIN';
  runAt: 'document_start' | 'document_end' | 'document_idle';
  updatedAt: number;
};

const emergencyDisabled = ref(false);
const items = ref<ListItem[]>([]);
const filters = ref({ query: '', status: '', domain: '' });

const form = ref({
  name: '',
  runAt: 'auto',
  world: 'auto',
  mode: 'auto',
  allFrames: true,
  persist: true,
  dnrFallback: true,
  script: '',
  matches: '',
  excludes: '',
  tags: '',
});

const submitting = ref(false);
const lastResult = ref('');

function formatTime(ts?: number) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

async function saveEmergency() {
  await globalThis.chrome?.storage?.local.set({
    [STORAGE_KEYS.USERSCRIPTS_DISABLED]: emergencyDisabled.value,
  });
}

async function loadEmergency() {
  const v = await globalThis.chrome?.storage?.local.get([STORAGE_KEYS.USERSCRIPTS_DISABLED] as any);
  emergencyDisabled.value = !!v[STORAGE_KEYS.USERSCRIPTS_DISABLED];
}

async function callTool(name: string, args: any) {
  const res = await globalThis.chrome?.runtime?.sendMessage({
    type: 'call_tool',
    name,
    args,
  } as any);
  if (!res || !res.success) throw new Error(res?.error || 'call failed');
  return res.result;
}

async function reload() {
  const result = await callTool(TOOL_NAMES.BROWSER.USERSCRIPT, {
    action: 'list',
    args: { ...filters.value },
  });
  try {
    const txt = (result?.content?.[0]?.text as string) || '{}';
    const data = JSON.parse(txt);
    items.value = data.items || [];
  } catch (e) {
    console.warn('parse list failed', e);
  }
}

async function apply(mode: 'auto' | 'once') {
  if (!form.value.script.trim()) return;
  submitting.value = true;
  lastResult.value = '';
  try {
    const args: any = {
      script: form.value.script,
      name: form.value.name || undefined,
      runAt: form.value.runAt as any,
      world: form.value.world as any,
      allFrames: !!form.value.allFrames,
      persist: !!form.value.persist,
      dnrFallback: !!form.value.dnrFallback,
      mode,
    };
    if (form.value.matches.trim())
      args.matches = form.value.matches.split(',').map((s) => s.trim());
    if (form.value.excludes.trim())
      args.excludes = form.value.excludes.split(',').map((s) => s.trim());
    if (form.value.tags.trim()) args.tags = form.value.tags.split(',').map((s) => s.trim());

    const result = await callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: 'create', args });
    lastResult.value = (result?.content?.[0]?.text as string) || '';
    await reload();
  } catch (e: any) {
    lastResult.value = 'Error: ' + (e?.message || String(e));
  } finally {
    submitting.value = false;
  }
}

async function toggle(it: ListItem) {
  try {
    await callTool(TOOL_NAMES.BROWSER.USERSCRIPT, {
      action: it.status === 'enabled' ? 'disable' : 'enable',
      args: { id: it.id },
    });
    await reload();
  } catch (e) {
    console.warn('toggle failed', e);
  }
}

async function remove(it: ListItem) {
  try {
    await callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: 'remove', args: { id: it.id } });
    await reload();
  } catch (e) {
    console.warn('remove failed', e);
  }
}

async function exportAll() {
  try {
    const res = await callTool(TOOL_NAMES.BROWSER.USERSCRIPT, { action: 'export', args: {} });
    const txt = (res?.content?.[0]?.text as string) || '{}';
    const blob = new Blob([txt], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    await globalThis.chrome?.downloads?.download({
      url,
      filename: 'userscripts-export.json',
      saveAs: true,
    } as any);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.warn('export failed', e);
  }
}

onMounted(async () => {
  await loadEmergency();
  await reload();
});
</script>

<style scoped>
.page {
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    Segoe UI,
    Roboto,
    sans-serif;
  padding: 16px;
}
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.create,
.filters {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 12px;
  margin-bottom: 16px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
label {
  display: flex;
  flex-direction: column;
  font-size: 12px;
  gap: 4px;
}
input,
select,
textarea {
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 8px;
  font-size: 12px;
}
textarea {
  resize: vertical;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}
button {
  background: #3b82f6;
  color: #fff;
  border: none;
  padding: 8px 12px;
  border-radius: 8px;
  cursor: pointer;
}
button:hover {
  background: #2563eb;
}
.hint {
  color: #374151;
  font-size: 12px;
}
.table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
.table th,
.table td {
  border-bottom: 1px solid #e5e7eb;
  text-align: left;
  padding: 8px;
  font-size: 12px;
}
.actions {
  text-align: right;
}
.switch input {
  margin-right: 6px;
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}
</style>
