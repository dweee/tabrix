import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MkeMemoryTraceSummary } from '@tabrix/shared';
import { describe, expect, it } from 'vitest';
import {
  formatMkeAiFeedback,
  formatMkeAiFeedbackDetail,
  formatMkeAiFeedbackStatus,
  formatMkeAiFeedbackStatusTone,
} from '../entrypoints/sidepanel/tabs/mke-ai-feedback-display';

function trace(overrides: Partial<MkeMemoryTraceSummary> = {}): MkeMemoryTraceSummary {
  return {
    traceId: 'trace-1',
    toolName: 'chrome_click_element',
    requestAt: '2026-10-04T00:00:00.000Z',
    responseAt: '2026-10-04T00:00:01.000Z',
    createdAt: '2026-10-04T00:00:01.000Z',
    ...overrides,
  };
}

describe('MkeDataTab render smoke', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'entrypoints/sidepanel/tabs/MkeDataTab.vue'),
    'utf8',
  );
  const appSource = readFileSync(resolve(process.cwd(), 'entrypoints/sidepanel/App.vue'), 'utf8');
  const feedbackSource = readFileSync(
    resolve(process.cwd(), 'entrypoints/sidepanel/tabs/mke-ai-feedback-display.ts'),
    'utf8',
  );

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

  it('does not show browser inventory rows as pending AI feedback', () => {
    expect(feedbackSource).toContain("trace.aiFeedbackState === 'pending'");
    expect(feedbackSource).toContain('trace.aiFeedbackRequired === true');
    expect(feedbackSource).toContain("return '无需AI评价'");
    expect(source).not.toContain("'AI评价：无需评价'");
  });

  it('renders recorded unknown or missing feedback distinctly and keeps its summary', () => {
    const unknown = trace({
      aiFeedbackState: 'recorded',
      aiFeedback: { businessStatus: 'unknown', summary: '页面已点击，但结果未能确认。' },
    });
    const missing = trace({
      aiFeedbackState: 'recorded',
      aiFeedback: { businessStatus: null, summary: '已提交操作，缺少结果证据。' },
    });

    expect(formatMkeAiFeedbackStatus(unknown)).toBe('评价已收到，业务结果未知');
    expect(formatMkeAiFeedback(unknown).line).toBe(
      '评价已收到，业务结果未知：页面已点击，但结果未能确认',
    );
    expect(formatMkeAiFeedbackStatusTone(unknown)).toBe('neutral');
    expect(formatMkeAiFeedbackStatus(missing)).toBe('评价已收到，业务结果缺失');
    expect(formatMkeAiFeedback(missing).line).toContain('已提交操作，缺少结果证据');
    expect(formatMkeAiFeedbackDetail(unknown)).toEqual({
      status: '评价已收到，业务结果未知',
      summary: '页面已点击，但结果未能确认。',
    });
    expect(formatMkeAiFeedbackDetail(missing)).toEqual({
      status: '评价已收到，业务结果缺失',
      summary: '已提交操作，缺少结果证据。',
    });
    expect(formatMkeAiFeedbackStatus(missing)).not.toMatch(/待AI评价|无需AI评价|AI通过/);
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedbackState: 'recorded' }))).toBe(
      '评价已收到，业务结果缺失',
    );
  });

  it('preserves pending, not-required, passed, partial, and failed feedback meanings', () => {
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedbackState: 'pending' }))).toBe('待AI评价');
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedbackRequired: true }))).toBe('待AI评价');
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedbackState: 'not_required' }))).toBe(
      '无需AI评价',
    );
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedback: { businessStatus: 'achieved' } }))).toBe(
      'AI通过',
    );
    expect(formatMkeAiFeedbackStatusTone(trace({ aiFeedback: { businessStatus: 'true' } }))).toBe(
      'good',
    );
    expect(formatMkeAiFeedbackStatus(trace({ aiFeedback: { businessStatus: 'partial' } }))).toBe(
      'AI部分完成',
    );
    expect(
      formatMkeAiFeedbackStatus(trace({ aiFeedback: { businessStatus: 'not_achieved' } })),
    ).toBe('AI未通过');
    expect(formatMkeAiFeedbackStatusTone(trace({ aiFeedback: { businessStatus: 'false' } }))).toBe(
      'warn',
    );
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
