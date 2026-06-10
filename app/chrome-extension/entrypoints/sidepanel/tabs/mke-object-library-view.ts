import type { MkeBrowserObjectSummary } from '@tabrix/shared';

export type MkeObjectViewTone = 'good' | 'warn' | 'neutral';

export interface MkeObjectViewMetric {
  label: string;
  value: string;
}

export interface MkeObjectViewItem {
  label: string;
  value: string;
  tone?: MkeObjectViewTone;
}

export interface MkeObjectViewSection {
  id: 'pageObjects' | 'actions' | 'dataApi' | 'lifecycle';
  title: string;
  badge: string;
  emptyText: string;
  items: MkeObjectViewItem[];
}

export interface MkeObjectWebPageView {
  id: string;
  title: string;
  location: string;
  lifecycleLabel: string;
  lifecycleTone: MkeObjectViewTone;
  activityLabel: string;
  isActive: boolean;
  isClosed: boolean;
  updatedAt: string;
  metrics: MkeObjectViewMetric[];
  sections: MkeObjectViewSection[];
  objects: MkeBrowserObjectSummary[];
  searchText: string;
}

export interface MkeObjectLibraryView {
  summary: {
    liveLabel: string;
    openWebPages: number;
    closedWebPages: number;
    pageObjects: number;
    actions: number;
    dataApis: number;
  };
  webPages: MkeObjectWebPageView[];
}

const PAGE_OBJECT_TYPES = new Set(['page', 'region']);
const ACTION_OBJECT_TYPES = new Set(['action_target']);
const DATA_API_OBJECT_TYPES = new Set(['data_source']);

export function buildMkeObjectLibraryView(
  objects: MkeBrowserObjectSummary[],
): MkeObjectLibraryView {
  const webPageRoots = selectWebPageRoots(objects);
  const webPages = webPageRoots.map((root) =>
    buildWebPageView(root, findRelatedObjects(root, objects)),
  );
  const openWebPages = webPages.filter((page) => !page.isClosed).length;
  const closedWebPages = webPages.filter((page) => page.isClosed).length;
  const pageObjects = countByType(objects, PAGE_OBJECT_TYPES);
  const actions = countByType(objects, ACTION_OBJECT_TYPES);
  const dataApis = countByType(objects, DATA_API_OBJECT_TYPES);

  return {
    summary: {
      liveLabel: '实时监控中',
      openWebPages,
      closedWebPages,
      pageObjects,
      actions,
      dataApis,
    },
    webPages,
  };
}

function selectWebPageRoots(objects: MkeBrowserObjectSummary[]): MkeBrowserObjectSummary[] {
  const tabs = objects.filter((object) => object.objectType === 'tab');
  const tabKeys = new Set(tabs.map(objectPageGroupingKey));
  const unmatchedPages = objects.filter(
    (object) => object.objectType === 'page' && !tabKeys.has(objectPageGroupingKey(object)),
  );
  return sortWebPageRoots([...tabs, ...unmatchedPages]);
}

function sortWebPageRoots(objects: MkeBrowserObjectSummary[]): MkeBrowserObjectSummary[] {
  return [...objects].sort((a, b) => {
    if (Boolean(a.isActive) !== Boolean(b.isActive)) return a.isActive ? -1 : 1;
    if (isClosedObject(a) !== isClosedObject(b)) return isClosedObject(a) ? 1 : -1;
    return readTime(b.updatedAt) - readTime(a.updatedAt);
  });
}

function buildWebPageView(
  root: MkeBrowserObjectSummary,
  relatedObjects: MkeBrowserObjectSummary[],
): MkeObjectWebPageView {
  const pageObjectCount = countByType(relatedObjects, PAGE_OBJECT_TYPES);
  const actionObjects = relatedObjects.filter((object) =>
    ACTION_OBJECT_TYPES.has(object.objectType),
  );
  const dataApiObjects = relatedObjects.filter((object) =>
    DATA_API_OBJECT_TYPES.has(object.objectType),
  );
  const lifecycle = formatLifecycle(root);
  const activityLabel = root.isActive
    ? '当前激活'
    : root.lifecycleState === 'closed'
      ? '最近关闭'
      : '后台观察';
  const title = formatWebPageTitle(root);
  const location = formatWebPageLocation(root);
  const metrics = compactMetrics([
    ['页面对象', String(pageObjectCount)],
    ['可操作', String(actionObjects.length)],
    ['数据/API', String(dataApiObjects.length)],
  ]);
  const sections = [
    buildPageObjectsSection(relatedObjects, pageObjectCount),
    buildActionsSection(actionObjects),
    buildDataApiSection(dataApiObjects, root),
    buildLifecycleSection(root, lifecycle),
  ];

  const searchText = [
    title,
    location,
    lifecycle.label,
    activityLabel,
    root.siteFamily,
    root.pageRole,
    root.pageModelKey,
    root.ownerType,
    root.sourceFreshness,
    ...relatedObjects.flatMap((object) => [
      object.objectType,
      object.pageRole,
      object.selectedDataSource,
      object.sourceRoute,
      ...(object.actionTypes ?? []),
    ]),
    ...sections.flatMap((section) => [
      section.title,
      section.badge,
      ...section.items.flatMap((item) => [item.label, item.value]),
    ]),
  ]
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .join(' ')
    .toLowerCase();

  return {
    id: root.browserObjectId,
    title,
    location,
    lifecycleLabel: lifecycle.label,
    lifecycleTone: lifecycle.tone,
    activityLabel,
    isActive: Boolean(root.isActive),
    isClosed: isClosedObject(root),
    updatedAt: root.updatedAt,
    metrics,
    sections,
    objects: relatedObjects,
    searchText,
  };
}

function findRelatedObjects(
  root: MkeBrowserObjectSummary,
  objects: MkeBrowserObjectSummary[],
): MkeBrowserObjectSummary[] {
  const rootKey = objectPageGroupingKey(root);
  return objects.filter((object) => objectPageGroupingKey(object) === rootKey);
}

function objectPageGroupingKey(object: MkeBrowserObjectSummary): string {
  const route = objectRouteKey(object);
  const tabId = extractTabId(object);
  return tabId ? `tab:${tabId}::${route}` : `route::${route}`;
}

function objectRouteKey(object: MkeBrowserObjectSummary): string {
  return (
    object.currentRoute ||
    object.rootRoute ||
    object.pageUrlPattern ||
    object.pageIdentity?.url ||
    object.pageIdentity?.label ||
    object.siteFamily ||
    'unknown'
  );
}

function extractTabId(object: MkeBrowserObjectSummary): string | null {
  const contextMatch = object.browserContextKey?.match(/(?:^|:)tab:(\d+)$/);
  if (contextMatch) return contextMatch[1];

  if (object.objectType === 'tab') {
    const tabFingerprintMatch = object.objectFingerprint.match(/^tab:[^:]+:(\d+)$/);
    if (tabFingerprintMatch) return tabFingerprintMatch[1];
  }

  const trailingTabIdMatch = object.objectFingerprint.match(/:(\d+)$/);
  return trailingTabIdMatch ? trailingTabIdMatch[1] : null;
}

function buildPageObjectsSection(
  objects: MkeBrowserObjectSummary[],
  pageObjectCount: number,
): MkeObjectViewSection {
  const counts = countObjectKinds(
    objects.filter((object) => PAGE_OBJECT_TYPES.has(object.objectType)),
    (object) => formatPageObjectKind(object),
  );
  return {
    id: 'pageObjects',
    title: '页面对象',
    badge: `${pageObjectCount} 个`,
    emptyText: '读取当前网页后会显示按钮、表单、列表、表格、菜单、弹窗等对象。',
    items: counts.map(([label, count]) => ({ label, value: `${count} 个` })),
  };
}

function buildActionsSection(objects: MkeBrowserObjectSummary[]): MkeObjectViewSection {
  const actionCounts = countObjectKinds(objects, (object) => formatActionKind(object));
  return {
    id: 'actions',
    title: '可操作功能',
    badge: `${objects.length} 个`,
    emptyText: '读取当前网页后会显示 AI 可点击、可输入、可筛选、可下载的目标。',
    items: actionCounts.map(([label, count]) => ({
      label,
      value: `${count} 个目标`,
      tone: 'good',
    })),
  };
}

function buildDataApiSection(
  objects: MkeBrowserObjectSummary[],
  root: MkeBrowserObjectSummary,
): MkeObjectViewSection {
  const dataSourceLabels = objects
    .map((object) => object.selectedDataSource || object.sourceRoute || object.pageRole)
    .filter((item): item is string => typeof item === 'string' && item.length > 0);
  const labels =
    dataSourceLabels.length > 0
      ? dataSourceLabels
      : root.selectedDataSource
        ? [root.selectedDataSource]
        : [];
  const counts = countLabels(labels.map(formatDataSourceLabel));
  return {
    id: 'dataApi',
    title: '数据/API',
    badge: `${objects.length} 个`,
    emptyText: '观察到安全的数据接口后，会在这里显示只读、提交、搜索等接口能力。',
    items: counts.map(([label, count]) => ({
      label,
      value: count > 1 ? `${count} 条线索` : '已观察',
      tone: label.includes('提交') || label.includes('写入') ? 'warn' : 'neutral',
    })),
  };
}

function buildLifecycleSection(
  root: MkeBrowserObjectSummary,
  lifecycle: { label: string; tone: MkeObjectViewTone },
): MkeObjectViewSection {
  const sourceFreshness = formatFreshness(root.sourceFreshness);
  const tabStatus = formatTabStatus(root.tabStatus);
  const operability = formatOperability(root);
  return {
    id: 'lifecycle',
    title: '生命周期',
    badge: lifecycle.label,
    emptyText: '暂无生命周期状态。',
    items: [
      { label: '当前状态', value: lifecycle.label, tone: lifecycle.tone },
      sourceFreshness ? { label: '证据新鲜度', value: sourceFreshness } : null,
      tabStatus ? { label: '浏览器加载', value: tabStatus } : null,
      operability
        ? { label: '操作能力', value: operability, tone: root.canTabrixOperate ? 'good' : 'warn' }
        : null,
    ].filter((item): item is MkeObjectViewItem => item !== null),
  };
}

function countByType(objects: MkeBrowserObjectSummary[], types: Set<string>): number {
  return objects.filter((object) => types.has(object.objectType)).length;
}

function countObjectKinds(
  objects: MkeBrowserObjectSummary[],
  readKind: (object: MkeBrowserObjectSummary) => string,
): Array<[string, number]> {
  return countLabels(objects.map(readKind));
}

function countLabels(labels: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function compactMetrics(
  entries: Array<[string, string | null | undefined]>,
): MkeObjectViewMetric[] {
  return entries
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }));
}

function formatWebPageTitle(object: MkeBrowserObjectSummary): string {
  const titleSummary = readObjectFactString(object, 'titleSummary');
  return compactText(
    titleSummary ||
      object.display?.title ||
      object.pageIdentity?.label ||
      object.pageRole ||
      '未命名网页',
    48,
  );
}

function formatWebPageLocation(object: MkeBrowserObjectSummary): string {
  return compactText(
    object.display?.locationLabel ||
      object.currentRoute ||
      object.rootRoute ||
      object.pageUrlPattern ||
      object.pageIdentity?.label ||
      object.siteFamily ||
      '未知位置',
    84,
  );
}

function formatLifecycle(object: MkeBrowserObjectSummary): {
  label: string;
  tone: MkeObjectViewTone;
} {
  if (isClosedObject(object)) return { label: '已关闭', tone: 'warn' };
  if (object.sourceFreshness === 'stale') return { label: '状态过期', tone: 'warn' };
  if (object.tabStatus === 'loading') return { label: '加载中', tone: 'neutral' };
  if (object.isActive) return { label: '当前激活', tone: 'good' };
  if (object.canTabrixOperate === true) return { label: '加载完成', tone: 'good' };
  if (object.canTabrixOperate === false) return { label: '不可操作', tone: 'warn' };
  return { label: '观察中', tone: 'neutral' };
}

function formatPageObjectKind(object: MkeBrowserObjectSummary): string {
  const regionType = readObjectFactString(object, 'regionType');
  if (regionType) return translateKnownLabel(regionType);
  if (object.objectType === 'page') return '页面';
  if (object.objectType === 'region') return '区域';
  return translateKnownLabel(object.objectType);
}

function formatActionKind(object: MkeBrowserObjectSummary): string {
  const actionType = object.actionTypes?.find(
    (item) => typeof item === 'string' && item.length > 0,
  );
  if (!actionType) return '可操作目标';
  return translateKnownLabel(actionType);
}

function formatDataSourceLabel(value: string): string {
  const text = value.toLowerCase();
  if (text.includes('api') || text.includes('endpoint')) return '接口线索';
  if (text.includes('submit') || text.includes('post') || text.includes('write')) return '提交接口';
  if (text.includes('search')) return '搜索接口';
  if (text.includes('list')) return '列表接口';
  if (text.includes('detail')) return '详情接口';
  return translateKnownLabel(value);
}

function translateKnownLabel(value: string): string {
  const labels: Record<string, string> = {
    button: '按钮',
    buttons: '按钮',
    click: '点击',
    input: '输入',
    fill: '输入',
    form: '表单',
    forms: '表单',
    list: '列表',
    table: '表格',
    menu: '菜单',
    dialog: '弹窗',
    modal: '弹窗',
    download: '下载',
    upload: '上传',
    select: '选择',
    submit: '提交',
    filter: '筛选',
    page: '页面',
    region: '区域',
    action_target: '可操作目标',
    data_source: '数据/API',
  };
  return labels[value.toLowerCase()] ?? compactText(value.replace(/_/g, ' '), 18);
}

function formatFreshness(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'fresh') return '新鲜';
  if (value === 'stale') return '过期';
  if (value === 'unknown') return '未知';
  return value;
}

function formatTabStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'complete') return '加载完成';
  if (value === 'loading') return '加载中';
  return value;
}

function formatOperability(object: MkeBrowserObjectSummary): string | null {
  if (object.canTabrixOperate === true) return '可操作';
  if (object.canTabrixOperate === false) return '不可操作';
  return null;
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

function isClosedObject(object: MkeBrowserObjectSummary): boolean {
  return object.lifecycleState === 'closed' || object.lifecycleState === 'removed';
}

function readTime(value: string | null | undefined): number {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
}

function compactText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}
