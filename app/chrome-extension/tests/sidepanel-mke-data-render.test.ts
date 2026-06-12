import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('MkeDataTab render smoke', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'entrypoints/sidepanel/tabs/MkeDataTab.vue'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/App.vue'), 'utf8');

  it('keeps the compact four-library shell and object list controls', () => {
    expect(appSource).toContain('<MkeDataTab />');
    expect(appSource).not.toContain('MemoryTab');
    expect(appSource).not.toContain('ExecutionTab');

    expect(source).toContain('mke-shell');
    expect(source).toContain('mke-controls');
    expect(source).toContain('<div class="mke-tabs"');
    expect(source).toContain("label: '记忆库'");
    expect(source).toContain("label: '对象库'");
    expect(source).toContain("label: '知识库'");
    expect(source).toContain("label: '经验库'");
    expect(source).toContain('mke-toolbar--object');
    expect(source).not.toContain('mke-object-storage-toggle');
    expect(source).not.toContain('mke-object-summary-bar');
    expect(source).toContain('搜索网页、网址、状态');
    expect(source).toContain('fetchMkeBrowserObjects({ limit: objectLimit');
    expect(source).not.toContain("scope: 'object-graph'");

    expect(source).not.toContain('mke-object-workspace');
    expect(source).not.toContain('mke-webpage-detail');
    expect(source).not.toContain('mke-object-detail-tabs');
    expect(source).not.toContain('mke-object-footer-actions');
    expect(source).not.toContain('resultSummary: trace.resultSummary');
    expect(source).not.toContain('function objectToRecord(object: MkeBrowserObjectSummary)');
    expect(source).not.toContain('function formatObjectRuntimeState');
  });

  it('renders object-library rows from the product view model only', () => {
    expect(source).toContain('buildMkeObjectLibraryView');
    expect(source).toContain('currentObjectLibraryRuntimeContext');
    expect(source).toContain('readLiveForegroundTabId');
    expect(source).toContain('objectLibraryView.value.webPages.map(objectWebPageToRecord)');
    expect(source).toContain('function objectWebPageToRecord(webPage: MkeObjectWebPageView)');
    expect(source).toContain('title: webPage.title');
    expect(source).toContain('metaLine: webPage.location');
    expect(source).toContain('status: webPage.lifecycleLabel');
    expect(source).toContain('statusTone: webPage.lifecycleTone');
    expect(source).toContain("isForeground: webPage.lifecycleLabel === '前台页'");
    expect(source).toContain('detailJson: formatObjectWebPageJson(webPage)');

    expect(source).not.toContain('webPage.activityLabel');
    expect(source).not.toContain('activityLabel: webPage.activityLabel');
    expect(source).not.toContain("if (object.canTabrixOperate === true) return '可继续处理'");
    expect(source).not.toContain("if (object.canTabrixOperate === false) return '不可处理'");
    expect(source).not.toContain("if (object.tabStatus === 'complete') return '已加载'");
  });

  it('keeps the right-rail layout compact and readable', () => {
    expect(appSource).toContain('.sidepanel-root *');
    expect(appSource).toContain('box-sizing: border-box');
    expect(appSource).toContain('max-width: 100vw');
    expect(source).toContain('max-width: min(860px, 100vw)');
    expect(source).toContain('margin: 0 auto');
    expect(source).toContain('.mke-data-tab *');
    expect(source).toContain('box-sizing: border-box');
    expect(source).toContain('overflow-x: hidden;');
    expect(source).toContain('overflow-y: auto;');
    expect(source).toContain('overflow-wrap: anywhere');
    expect(source).toContain('text-overflow: ellipsis;');
    expect(source).toContain('white-space: nowrap;');
    expect(source).toContain('.mke-json-block');
    expect(source).toContain('grid-template-columns: minmax(180px, 1fr) auto');
    expect(source).not.toContain('mke-object-summary-card');
    expect(source).toContain('mke-status__pulse');
    expect(source).toContain('@keyframes mke-foreground-pulse');
    expect(source).toContain('@media (max-width: 520px)');
  });
});
