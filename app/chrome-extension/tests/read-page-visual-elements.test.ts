import { describe, expect, it, vi } from 'vitest';

import {
  collectQrVisualElementHints,
  QR_VISUAL_ELEMENT_SELECTOR,
  selectQrVisualElementHints,
} from '../entrypoints/background/tools/browser/read-page-visual-elements';

describe('read-page visual elements', () => {
  it('does not run the fallback scan without QR context', async () => {
    const collectFallback = vi.fn();

    const hints = await collectQrVisualElementHints({
      pageContent: '普通登录页面',
      visibleTextContent: '请输入手机号',
      collectFallback,
    });

    expect(hints).toEqual([]);
    expect(collectFallback).not.toHaveBeenCalled();
  });

  it('uses the shared QR selector and returns scored visual hints', async () => {
    const collectFallback = vi.fn().mockResolvedValue({
      elements: [
        {
          selector: 'img.qrcode',
          tagName: 'img',
          alt: '扫码登录二维码',
          coordinates: { rect: { x: 120, y: 80, width: 180, height: 180 } },
          visualSignature: 'visual_12ab34cd',
        },
        {
          selector: 'img.logo',
          tagName: 'img',
          alt: '品牌图标',
          coordinates: { rect: { x: 12, y: 12, width: 48, height: 48 } },
        },
      ],
    });

    const hints = await collectQrVisualElementHints({
      pageContent: '请扫码登录',
      visibleTextContent: '微信扫码或二维码登录',
      frameId: 7,
      collectFallback,
    });

    expect(collectFallback).toHaveBeenCalledWith({
      selector: QR_VISUAL_ELEMENT_SELECTOR,
      includeCoordinates: true,
      frameId: 7,
    });
    expect(hints).toEqual([
      expect.objectContaining({
        selector: 'img.qrcode',
        qrSignal: true,
        reason: 'qr_visual_element_signal',
        visualSignature: 'visual_12ab34cd',
      }),
    ]);
  });

  it('filters out non-QR visual candidates', () => {
    expect(
      selectQrVisualElementHints([
        {
          selector: 'img.avatar',
          tagName: 'img',
          alt: '用户头像',
          coordinates: { rect: { x: 0, y: 0, width: 120, height: 120 } },
        },
      ]),
    ).toEqual([]);
  });
});
