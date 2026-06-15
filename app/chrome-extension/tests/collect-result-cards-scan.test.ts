// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { scanVisibleResultCardsInPage } from '@/entrypoints/background/tools/browser/collect-result-cards';

function setViewport(): void {
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 720, configurable: true });
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: 1200,
    configurable: true,
  });
}

function installRects(): void {
  const rects = new Map<string, DOMRect>();
  document.querySelectorAll<HTMLElement>('[data-rect]').forEach((element) => {
    const [x, y, width, height] = (element.dataset.rect ?? '0,0,0,0')
      .split(',')
      .map((value) => Number(value));
    rects.set(element.dataset.testid ?? '', new DOMRect(x, y, width, height));
  });

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function getRect() {
    const element = this as HTMLElement;
    return rects.get(element.dataset.testid ?? '') ?? new DOMRect(0, 0, 0, 0);
  });

  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn((x: number, y: number) => {
      const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'));
      return (
        links.find((link) => {
          const rect = link.getBoundingClientRect();
          return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
        }) ?? null
      );
    }),
  });
}

function renderCards(cards: Array<{ key: string; title: string; href: string; y: number }>): void {
  document.body.innerHTML = `
    <main role="list" data-testid="list" data-rect="0,0,1000,680">
      ${cards
        .map(
          (card, index) => `
            <article role="listitem" data-testid="card-${card.key}" data-rect="20,${card.y},260,180">
              <a
                data-testid="link-${card.key}"
                data-rect="28,${card.y + 8},240,112"
                href="${card.href}"
              >${card.title}</a>
              <span>作者 ${index + 1}</span>
              <span>${index + 1} 天前</span>
              <span>收藏 ${100 + index}</span>
            </article>
          `,
        )
        .join('')}
    </main>
  `;
  installRects();
}

describe('collect result cards DOM scan', () => {
  it('derives result-card target refs from stable card identity instead of viewport order', () => {
    setViewport();
    renderCards([
      {
        key: 'alpha',
        title: 'AI 图片创作提示词合集',
        href: 'https://example.test/note/alpha?tracking=1',
        y: 24,
      },
      {
        key: 'beta',
        title: '一周内 AI 绘图工具推荐',
        href: 'https://example.test/note/beta?tracking=2',
        y: 244,
      },
    ]);

    const first = scanVisibleResultCardsInPage();
    expect(first.pageRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: 'result_list',
          regionType: 'results',
          candidateActionIds: expect.arrayContaining([
            expect.stringMatching(/^ca_click_ref_result_card_[0-9a-f]{8}$/),
          ]),
        }),
      ]),
    );
    expect(first.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actionType: 'click',
          intent: 'content.open_detail',
          targetRef: expect.stringMatching(/^ref_result_card_[0-9a-f]{8}$/),
        }),
      ]),
    );
    const alphaRef = first.cards.find((card) => card.title.includes('提示词'))?.actionTarget
      ?.toolArgs?.candidateAction.targetRef;
    const betaRef = first.cards.find((card) => card.title.includes('工具'))?.actionTarget?.toolArgs
      ?.candidateAction.targetRef;

    renderCards([
      {
        key: 'beta',
        title: '一周内 AI 绘图工具推荐',
        href: 'https://example.test/note/beta?tracking=changed',
        y: 24,
      },
      {
        key: 'alpha',
        title: 'AI 图片创作提示词合集',
        href: 'https://example.test/note/alpha?tracking=changed',
        y: 244,
      },
    ]);

    const second = scanVisibleResultCardsInPage();

    expect(alphaRef).toMatch(/^ref_result_card_[0-9a-f]{8}$/);
    expect(betaRef).toMatch(/^ref_result_card_[0-9a-f]{8}$/);
    expect(alphaRef).not.toBe(betaRef);
    expect(
      second.cards.find((card) => card.title.includes('提示词'))?.actionTarget?.toolArgs
        ?.candidateAction.targetRef,
    ).toBe(alphaRef);
    expect(
      second.cards.find((card) => card.title.includes('工具'))?.actionTarget?.toolArgs
        ?.candidateAction.targetRef,
    ).toBe(betaRef);
  });
});
