// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  scanVisibleResultCardsInPage,
  scrollPageBy,
} from '@/entrypoints/background/tools/browser/collect-result-cards';

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
  it('objectizes visible filter triggers and panel options as actionable targets', () => {
    setViewport();
    document.body.innerHTML = `
      <header>
        <button data-testid="filter-trigger" data-rect="1060,24,92,40">筛选</button>
      </header>
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,360,520">
        <button data-testid="sort-most-saved" data-rect="880,120,116,44">最多收藏</button>
        <button data-testid="type-image-text" data-rect="880,190,116,44" aria-selected="true">图文</button>
        <button data-testid="time-week" data-rect="880,260,116,44">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
        <article role="listitem" data-testid="card-beta" data-rect="300,140,260,180">
          <a data-testid="link-beta" data-rect="308,148,240,112" href="https://example.test/note/beta">一周内 AI 绘图工具推荐</a>
          <span>作者 2</span>
          <span>2 天前</span>
          <span>收藏 101</span>
        </article>
        <article role="listitem" data-testid="card-gamma" data-rect="580,140,260,180">
          <a data-testid="link-gamma" data-rect="588,148,240,112" href="https://example.test/note/gamma">AI 生图高级感关键词</a>
          <span>作者 3</span>
          <span>3 天前</span>
          <span>收藏 102</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.pageRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: 'search_filters',
          regionType: 'filters',
          targetability: true,
          layoutHint: 'visible_filter_controls_or_panel',
          candidateActionIds: expect.arrayContaining([
            expect.stringMatching(/^ca_filter_trigger_[0-9a-f]{8}$/),
            expect.stringMatching(/^ca_filter_sort_[0-9a-f]{8}$/),
            expect.stringMatching(/^ca_filter_content_type_[0-9a-f]{8}$/),
            expect.stringMatching(/^ca_filter_time_range_[0-9a-f]{8}$/),
          ]),
        }),
      ]),
    );
    expect(scan.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '筛选',
          actionType: 'click',
          intent: 'search.open_filters',
          actionability: true,
          locatorChain: expect.arrayContaining([
            expect.objectContaining({
              type: 'css',
              value: expect.stringContaining('button[data-testid="filter-trigger"]'),
            }),
          ]),
        }),
        expect.objectContaining({
          label: '最多收藏',
          actionType: 'click',
          intent: 'search.apply_filter.sort',
          actionability: true,
        }),
        expect.objectContaining({
          label: '图文',
          actionType: 'click',
          intent: 'search.apply_filter.content_type',
          actionability: true,
        }),
        expect.objectContaining({
          label: '一周内',
          actionType: 'click',
          intent: 'search.apply_filter.time_range',
          actionability: true,
        }),
      ]),
    );
    expect(scan.filterState.contentType).toBe('图文');
  });

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

  it('does not promote an inconclusive detail-link hit test to a stable click target', () => {
    setViewport();
    renderCards([
      {
        key: 'alpha',
        title: 'AI 图片创作提示词合集',
        href: 'https://content.example/search_result/alpha123?tracking=redacted',
        y: 24,
      },
    ]);
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => document.body),
    });

    const scan = scanVisibleResultCardsInPage();
    const card = scan.cards[0];

    expect(card.actionTarget?.executionScope).toBe('session_url');
    expect(card.actionTarget?.toolName).toBeUndefined();
    expect(card.actionTarget?.toolArgs?.candidateAction).toBeUndefined();
    expect(card.actionTarget?.openAction?.toolName).toBe('chrome_navigate');
    expect(scan.candidateActions.some((action) => action.intent === 'content.open_detail')).toBe(
      false,
    );
  });

  it('uses the actually hit same-href link layer as the result-card click target', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,0,1000,680">
        <article role="listitem" data-testid="card-alpha" data-rect="20,24,260,220">
          <a
            data-testid="image-link"
            data-rect="28,32,240,140"
            href="https://content.example/search_result/alpha123?tracking=redacted"
          ></a>
          <a
            data-testid="title-link"
            data-rect="28,32,240,140"
            href="https://content.example/search_result/alpha123?tracking=redacted"
          >AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();
    const imageLink = document.querySelector<HTMLAnchorElement>('[data-testid="image-link"]');
    if (!imageLink) throw new Error('expected image link');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => imageLink),
    });

    const scan = scanVisibleResultCardsInPage();
    const action = scan.cards[0]?.actionTarget?.toolArgs?.candidateAction;

    expect(scan.cards[0]?.actionTarget?.selector).toContain('a[data-testid="image-link"]');
    expect(action).toMatchObject({
      actionType: 'click',
      intent: 'content.open_detail',
      matchReason: 'result_card_primary_link',
      locatorChain: expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('a[data-testid="image-link"]'),
        }),
      ]),
    });
  });

  it('reports the result-list scroll container instead of assuming window scroll', () => {
    setViewport();
    document.body.innerHTML = `
      <section
        role="list"
        data-testid="internal-results"
        data-rect="0,80,900,560"
        style="overflow-y: auto;"
      >
        <article role="listitem" data-testid="card-alpha" data-rect="20,120,260,180">
          <a
            data-testid="link-alpha"
            data-rect="28,128,240,112"
            href="https://example.test/note/alpha"
          >AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
      </section>
    `;
    const results = document.querySelector<HTMLElement>('[data-testid="internal-results"]');
    if (!results) throw new Error('expected internal result container');
    Object.defineProperty(results, 'clientHeight', { value: 560, configurable: true });
    Object.defineProperty(results, 'scrollHeight', { value: 1400, configurable: true });
    Object.defineProperty(results, 'scrollTop', { value: 280, configurable: true });
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.pageInfo.scrollTarget).toBe('element');
    expect(scan.pageInfo.scrollY).toBe(280);
    expect(scan.pageInfo.pixelsBelow).toBe(560);
    expect(scan.cards).toHaveLength(1);
  });

  it('dispatches a wheel probe when normal page scrolling does not move', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,80,900,560">
        <article role="listitem" data-testid="card-alpha" data-rect="20,120,260,180">
          <a
            data-testid="link-alpha"
            data-rect="28,128,240,112"
            href="https://example.test/note/alpha"
          >AI 图片创作提示词合集</a>
        </article>
      </main>
    `;
    installRects();
    const list = document.querySelector<HTMLElement>('[data-testid="list"]');
    if (!list) throw new Error('expected list');
    const wheelEvents: number[] = [];
    list.addEventListener('wheel', (event) => {
      wheelEvents.push(event.deltaY);
    });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => list),
    });
    Object.defineProperty(window, 'scrollBy', {
      configurable: true,
      value: vi.fn(),
    });

    const scroll = scrollPageBy(640);

    expect(scroll.interactionDispatched).toBe(true);
    expect(wheelEvents).toEqual([640]);
  });
});
