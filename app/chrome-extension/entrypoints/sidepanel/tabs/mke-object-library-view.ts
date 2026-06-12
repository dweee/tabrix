import type { MkeBrowserObjectSummary, MkeBrowserPageStatus } from '@tabrix/shared';

export type MkeObjectViewTone = 'good' | 'warn' | 'neutral';

export interface MkeObjectWebPageView {
  id: string;
  tabId?: string | null;
  title: string;
  url?: string | null;
  location: string;
  lifecycleLabel: string;
  lifecycleTone: MkeObjectViewTone;
  isClosed: boolean;
  updatedAt: string;
  detailReason?: string | null;
  searchText: string;
}

export interface MkeObjectLibraryView {
  webPages: MkeObjectWebPageView[];
}

export interface MkeObjectLibraryRuntimeContext {
  foregroundTabId?: string | null;
}

const STATUS_LABELS: Record<MkeBrowserPageStatus, string> = {
  foreground: '前台页',
  running: '运行中',
  loading: '加载中',
  closed: '已关闭',
  restricted: '受限页',
};

const STATUS_TONES: Record<MkeBrowserPageStatus, MkeObjectViewTone> = {
  foreground: 'good',
  running: 'good',
  loading: 'neutral',
  closed: 'warn',
  restricted: 'warn',
};

export function buildMkeObjectLibraryView(
  objects: MkeBrowserObjectSummary[],
  runtimeContext: MkeObjectLibraryRuntimeContext = {},
): MkeObjectLibraryView {
  const foregroundTabId = normalizeTabId(runtimeContext.foregroundTabId);
  const webPages = [...objects].map((object) => buildWebPageView(object, foregroundTabId));

  return {
    webPages: sortWebPages(webPages),
  };
}

function buildWebPageView(
  object: MkeBrowserObjectSummary,
  foregroundTabId: string | null,
): MkeObjectWebPageView {
  const tabId = normalizeTabId(object.tabId);
  const status: MkeBrowserPageStatus =
    tabId !== null && tabId === foregroundTabId && object.status !== 'closed'
      ? 'foreground'
      : object.status;
  const title = compactText(object.title || '未命名网页', 56);
  const location = compactText(object.location || object.url || '未知位置', 96);
  const searchText = [
    title,
    location,
    object.url,
    STATUS_LABELS[status],
    object.detailReason,
    tabId,
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' ')
    .toLowerCase();

  return {
    id: object.objectId,
    tabId,
    title,
    url: object.url ?? null,
    location,
    lifecycleLabel: STATUS_LABELS[status],
    lifecycleTone: STATUS_TONES[status],
    isClosed: status === 'closed',
    updatedAt: object.updatedAt,
    detailReason: object.detailReason,
    searchText,
  };
}

function sortWebPages(webPages: MkeObjectWebPageView[]): MkeObjectWebPageView[] {
  return webPages.sort((a, b) => {
    if (a.lifecycleLabel === '前台页' || b.lifecycleLabel === '前台页') {
      return a.lifecycleLabel === '前台页' ? -1 : 1;
    }
    if (a.isClosed !== b.isClosed) return a.isClosed ? 1 : -1;
    return readTime(b.updatedAt) - readTime(a.updatedAt);
  });
}

function normalizeTabId(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readTime(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}
