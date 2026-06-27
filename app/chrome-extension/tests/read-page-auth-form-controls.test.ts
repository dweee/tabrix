import { describe, expect, it } from 'vitest';
import {
  hasAuthFormInteractiveContext,
  supplementAuthFormInteractiveControls,
  type AuthFormInteractiveCollector,
} from '../entrypoints/background/tools/browser/read-page-auth-form-controls';

describe('read-page auth form interactive controls', () => {
  it('detects auth form context from page and visible text', () => {
    expect(hasAuthFormInteractiveContext('请输入手机号', null)).toBe(true);
    expect(hasAuthFormInteractiveContext('', '阅读并同意隐私条款')).toBe(true);
    expect(hasAuthFormInteractiveContext('普通搜索结果列表', null)).toBe(false);
  });

  it('supplements targeted auth controls without duplicating identical targets', async () => {
    const calls: Array<{ textQuery?: string; includeCoordinates?: boolean; frameId?: number }> = [];
    const collector: AuthFormInteractiveCollector = async (_tabId, options = {}) => {
      calls.push(options);
      if (options.textQuery === '手机号' || options.textQuery === '输入手机号') {
        return {
          elements: [
            {
              selector: 'input[name="phone"]',
              text: '手机号',
              tagName: 'input',
              role: 'textbox',
            },
          ],
        };
      }
      if (options.textQuery === '登录') {
        return {
          elements: [
            {
              selector: 'button.login',
              text: '登录',
              tagName: 'button',
              role: 'button',
            },
          ],
        };
      }
      if (!options.textQuery) {
        return {
          elements: [
            {
              selector: 'input[name="code"]',
              text: '验证码',
              tagName: 'input',
              role: 'textbox',
            },
          ],
        };
      }
      return { elements: [] };
    };
    const basePayload: Record<string, any> = {
      pageContent: '请输入手机号并获取验证码后登录',
      visibleTextContent: '',
      elements: [{ ref: 'ref_existing', text: '已有元素' }],
      refMap: [{ ref: 'ref_existing', selector: 'a.existing' }],
      count: 1,
    };

    await expect(
      supplementAuthFormInteractiveControls({
        tabId: 5,
        basePayload,
        frameId: 9,
        collectInteractiveElementsFallback: collector,
      }),
    ).resolves.toBe(true);

    expect(calls.some((call) => call.textQuery === '手机号' && call.includeCoordinates)).toBe(true);
    expect(calls.some((call) => !call.textQuery && call.frameId === 9)).toBe(true);
    expect(basePayload.fallbackUsed).toBe(true);
    expect(basePayload.fallbackSource).toBe('auth_form_interactive_supplement');
    expect(basePayload.elements).toHaveLength(4);
    expect(
      basePayload.elements.filter((element: any) => element.selector === 'input[name="phone"]'),
    ).toHaveLength(1);
    expect(basePayload.refMapCount).toBeGreaterThanOrEqual(3);
  });

  it('does not mutate non-auth pages', async () => {
    const basePayload: Record<string, any> = {
      pageContent: '普通内容',
      elements: [],
      refMap: [],
    };

    await expect(
      supplementAuthFormInteractiveControls({
        tabId: 1,
        basePayload,
        collectInteractiveElementsFallback: async () => {
          throw new Error('collector should not be called');
        },
      }),
    ).resolves.toBe(false);

    expect(basePayload).toEqual({
      pageContent: '普通内容',
      elements: [],
      refMap: [],
    });
  });
});
