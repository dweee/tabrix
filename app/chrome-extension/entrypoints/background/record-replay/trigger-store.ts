import { STORAGE_KEYS } from '@/common/constants';

export type TriggerType = 'url' | 'contextMenu' | 'command' | 'dom';

export interface BaseTrigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  flowId: string;
  args?: Record<string, any>;
}

export interface UrlTrigger extends BaseTrigger {
  type: 'url';
  match: Array<{ kind: 'url' | 'domain' | 'path'; value: string }>;
}

export interface ContextMenuTrigger extends BaseTrigger {
  type: 'contextMenu';
  title: string;
  contexts?: chrome.contextMenus.ContextType[];
}

export interface CommandTrigger extends BaseTrigger {
  type: 'command';
  commandKey: string; // e.g., run_quick_trigger_1
}

export interface DomTrigger extends BaseTrigger {
  type: 'dom';
  selector: string;
  appear?: boolean; // default true
  once?: boolean; // default true
  debounceMs?: number; // default 800
}

export type FlowTrigger = UrlTrigger | ContextMenuTrigger | CommandTrigger | DomTrigger;

export async function listTriggers(): Promise<FlowTrigger[]> {
  const res = await chrome.storage.local.get([STORAGE_KEYS.RR_TRIGGERS]);
  const arr = (res[STORAGE_KEYS.RR_TRIGGERS] as FlowTrigger[]) || [];
  return arr;
}

export async function saveTrigger(t: FlowTrigger): Promise<void> {
  const arr = await listTriggers();
  const idx = arr.findIndex((x) => x.id === t.id);
  if (idx >= 0) arr[idx] = t;
  else arr.push(t);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_TRIGGERS]: arr });
}

export async function deleteTrigger(id: string): Promise<void> {
  const arr = await listTriggers();
  const filtered = arr.filter((x) => x.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.RR_TRIGGERS]: filtered });
}

export function toId(prefix = 'trg') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
