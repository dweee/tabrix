import type { MkeBrowserObjectSummary } from '@tabrix/shared';

export type MkeObjectViewTone = 'good' | 'warn' | 'neutral';

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
  isClosed: boolean;
  updatedAt: string;
  sections: MkeObjectViewSection[];
  objects: MkeBrowserObjectSummary[];
  searchText: string;
}

export interface MkeObjectLibraryView {
  webPages: MkeObjectWebPageView[];
}

export interface MkeObjectLibraryRuntimeContext {
  foregroundTabId?: string | null;
}

const PAGE_OBJECT_TYPES = new Set(['page', 'region', 'action_target']);
const ACTION_OBJECT_TYPES = new Set(['action_target']);
const DATA_API_OBJECT_TYPES = new Set(['data_source']);

interface ActiveTabContext {
  foregroundTabIds: Set<string>;
}

export function buildMkeObjectLibraryView(
  objects: MkeBrowserObjectSummary[],
  runtimeContext: MkeObjectLibraryRuntimeContext = {},
): MkeObjectLibraryView {
  const activeTabContext = buildActiveTabContext(objects, runtimeContext);
  const webPageRoots = selectWebPageRoots(objects, activeTabContext);
  const webPages = webPageRoots.map((root) =>
    buildWebPageView(root, findRelatedObjects(root, objects), activeTabContext),
  );

  return { webPages };
}

function selectWebPageRoots(
  objects: MkeBrowserObjectSummary[],
  activeTabContext: ActiveTabContext,
): MkeBrowserObjectSummary[] {
  const tabs = objects.filter((object) => object.objectType === 'tab');
  const tabKeys = new Set(tabs.map(objectPageGroupingKey));
  const unmatchedPages = objects.filter(
    (object) => object.objectType === 'page' && !tabKeys.has(objectPageGroupingKey(object)),
  );
  return sortWebPageRoots([...tabs, ...unmatchedPages], activeTabContext);
}

function sortWebPageRoots(
  objects: MkeBrowserObjectSummary[],
  activeTabContext: ActiveTabContext,
): MkeBrowserObjectSummary[] {
  return [...objects].sort((a, b) => {
    const aIsCurrent = isForegroundTab(a, activeTabContext);
    const bIsCurrent = isForegroundTab(b, activeTabContext);
    if (aIsCurrent !== bIsCurrent) return aIsCurrent ? -1 : 1;
    if (isClosedObject(a) !== isClosedObject(b)) return isClosedObject(a) ? 1 : -1;
    return readTime(b.updatedAt) - readTime(a.updatedAt);
  });
}

function buildWebPageView(
  root: MkeBrowserObjectSummary,
  relatedObjects: MkeBrowserObjectSummary[],
  activeTabContext: ActiveTabContext,
): MkeObjectWebPageView {
  const pageObjectCount = countByType(relatedObjects, PAGE_OBJECT_TYPES);
  const actionObjects = relatedObjects.filter((object) =>
    ACTION_OBJECT_TYPES.has(object.objectType),
  );
  const dataApiObjects = relatedObjects.filter((object) =>
    DATA_API_OBJECT_TYPES.has(object.objectType),
  );
  const lifecycle = formatLifecycle(root, activeTabContext);
  const title = formatWebPageTitle(root);
  const location = formatWebPageLocation(root);
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
    isClosed: isClosedObject(root),
    updatedAt: root.updatedAt,
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

function buildActiveTabContext(
  objects: MkeBrowserObjectSummary[],
  runtimeContext: MkeObjectLibraryRuntimeContext,
): ActiveTabContext {
  const foregroundTabId = normalizeTabId(runtimeContext.foregroundTabId);
  if (foregroundTabId) return { foregroundTabIds: new Set([foregroundTabId]) };

  const focusedWindowActiveTabIds = new Set<string>();

  for (const object of objects) {
    if (object.objectType !== 'window') continue;
    if (object.isActive !== true && readObjectFactBoolean(object, 'focused') !== true) continue;

    const activeTabId = readObjectFactNumber(object, 'activeTabId');
    if (activeTabId !== null) focusedWindowActiveTabIds.add(String(activeTabId));
  }

  if (focusedWindowActiveTabIds.size > 0) return { foregroundTabIds: focusedWindowActiveTabIds };

  const activeTabIds = new Set(
    objects
      .filter((object) => object.objectType === 'tab' && object.isActive === true)
      .map(extractTabId)
      .filter((tabId): tabId is string => tabId !== null),
  );

  return { foregroundTabIds: activeTabIds.size === 1 ? activeTabIds : new Set() };
}

function isForegroundTab(
  object: MkeBrowserObjectSummary,
  activeTabContext: ActiveTabContext,
): boolean {
  if (object.objectType !== 'tab') return false;
  const tabId = extractTabId(object);
  return tabId !== null && activeTabContext.foregroundTabIds.has(tabId);
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
    emptyText: '当前快照未记录页面对象。',
    items: counts.map(([label, count]) => ({ label, value: `${count} 个` })),
  };
}

function buildActionsSection(objects: MkeBrowserObjectSummary[]): MkeObjectViewSection {
  const actionCounts = countObjectKinds(objects, (object) => formatActionKind(object));
  return {
    id: 'actions',
    title: '候选操作目标',
    badge: `${objects.length} 个`,
    emptyText: '当前快照未记录候选操作目标。',
    items: actionCounts.map(([label, count]) => ({
      label,
      value: `${count} 个候选`,
      tone: 'neutral',
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
    badge: `${labels.length} 个`,
    emptyText: '当前快照未记录数据/API 线索。',
    items: counts.map(([label, count]) => ({
      label,
      value: count > 1 ? `${count} 条线索` : '线索',
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
        ? { label: '操作能力', value: operability, tone: formatOperabilityTone(root) }
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

function formatLifecycle(
  object: MkeBrowserObjectSummary,
  activeTabContext: ActiveTabContext,
): {
  label: string;
  tone: MkeObjectViewTone;
} {
  if (isClosedObject(object)) return { label: '已关闭', tone: 'warn' };
  if (object.tabStatus === 'loading') return { label: '加载中', tone: 'neutral' };
  if (object.canTabrixOperate === false) return { label: '受限页', tone: 'warn' };
  if (isForegroundTab(object, activeTabContext)) {
    return { label: '前台页', tone: 'good' };
  }
  if (object.canTabrixOperate === true) return { label: '已打开', tone: 'good' };
  return { label: '已打开', tone: 'good' };
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
  if (!actionType) return '候选目标';
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
    action_target: '候选目标',
    data_source: '数据/API',
  };
  return labels[value.toLowerCase()] ?? compactText(value.replace(/_/g, ' '), 18);
}

function formatFreshness(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'fresh') return '刚同步';
  if (value === 'stale') return '快照待同步';
  if (value === 'unknown') return '未知';
  return value;
}

function formatTabStatus(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === 'complete') return '已完成';
  if (value === 'loading') return '加载中';
  return value;
}

function formatOperability(object: MkeBrowserObjectSummary): string | null {
  if (object.canTabrixOperate === true) return '可访问';
  if (object.canTabrixOperate === false) return '受限';
  return '未知';
}

function formatOperabilityTone(object: MkeBrowserObjectSummary): MkeObjectViewTone {
  if (object.canTabrixOperate === true) return 'good';
  if (object.canTabrixOperate === false) return 'warn';
  return 'neutral';
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

function readObjectFactBoolean(object: MkeBrowserObjectSummary, key: string): boolean | null {
  const value = readObjectFacts(object)[key];
  return typeof value === 'boolean' ? value : null;
}

function readObjectFactNumber(object: MkeBrowserObjectSummary, key: string): number | null {
  const value = readObjectFacts(object)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeTabId(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
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
