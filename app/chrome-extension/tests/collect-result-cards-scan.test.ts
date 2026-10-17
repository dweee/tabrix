// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
  scanVisibleResultCardsInPage,
  scrollPageBy,
  scrollPageToTop,
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
  it('keeps the injected scanner self-contained for CDP fallback', () => {
    const scannerSource = scanVisibleResultCardsInPage.toString();

    expect(scannerSource).not.toContain('MAX_VISIBLE_FILTER_ACTIONS');
  });

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
    expect(
      scan.candidateActions.find((action) => action.intent === 'search.open_filters'),
    ).toMatchObject({
      matchReason: 'visible_filter_trigger.related_floating_surface',
    });
    const oneWeekAction = scan.candidateActions.find(
      (action) => action.label === '一周内' && action.intent === 'search.apply_filter.time_range',
    );
    const xpathLocators = oneWeekAction?.locatorChain.filter((locator) => locator.type === 'xpath');
    expect(xpathLocators).toHaveLength(1);
    expect(xpathLocators?.[0]?.value).toMatch(/^\/html|^\/\/\*\[@id=/);
    expect(xpathLocators?.some((locator) => locator.value.includes('normalize-space'))).toBe(false);
  });

  it('objectizes a visible semantic filter surface as a snapshot-local hover target', () => {
    setViewport();
    document.body.innerHTML = `
      <section role="toolbar" data-testid="toolbar" data-rect="20,80,760,48">
        <form role="search" data-testid="search-form" data-rect="24,84,560,40">
          <input type="search" data-testid="search-input" data-rect="32,88,520,32" />
        </form>
        <div
          class="filter-entry active"
          data-testid="filter-trigger"
          data-rect="640,84,112,40"
          style="cursor: pointer"
        >
          <span data-testid="filter-label" data-rect="656,94,56,20">Filtered</span>
          <svg data-testid="filter-icon" data-rect="720,96,16,16"></svg>
        </div>
      </section>
      <main role="list" data-testid="list" data-rect="0,140,900,520">
        <article role="listitem" data-testid="card-alpha" data-rect="20,160,260,180">
          <a data-testid="link-alpha" data-rect="28,168,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
        <article role="listitem" data-testid="card-beta" data-rect="300,160,260,180">
          <a data-testid="link-beta" data-rect="308,168,240,112" href="https://example.test/note/beta">AI 绘图工具推荐</a>
          <span>作者 2</span>
          <span>2 天前</span>
          <span>收藏 101</span>
        </article>
        <article role="listitem" data-testid="card-gamma" data-rect="580,160,260,180">
          <a data-testid="link-gamma" data-rect="588,168,240,112" href="https://example.test/note/gamma">AI 生图高级感关键词</a>
          <span>作者 3</span>
          <span>3 天前</span>
          <span>收藏 102</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const trigger = scan.candidateActions.find(
      (action) => action.label === 'Filtered' && action.intent === 'search.open_filters',
    );

    expect(trigger).toMatchObject({
      actionType: 'click',
      executionTargetKind: 'snapshot_locator',
      actionability: true,
      matchReason: 'visible_filter_trigger.search_toolbar',
    });
    expect(trigger?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('div[data-testid="filter-trigger"]'),
        }),
      ]),
    );
  });

  it('does not objectize a semantic filter label without an interaction signal', () => {
    setViewport();
    document.body.innerHTML = `
      <aside data-testid="help-panel" data-rect="920,80,300,240">
        <span data-testid="help-filter-label" data-rect="940,100,56,24">Filter</span>
      </aside>
      <main role="list" data-testid="list" data-rect="0,140,900,520">
        <article role="listitem" data-testid="card-alpha" data-rect="20,160,260,180">
          <a data-testid="link-alpha" data-rect="28,168,240,112" href="https://example.test/note/alpha">Image creation guide</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(
      scan.candidateActions.find(
        (action) => action.label === 'Filter' && action.intent === 'search.open_filters',
      ),
    ).toBeUndefined();
  });

  it('objectizes an exact visible query suggestion from the current search surface', () => {
    setViewport();
    document.body.innerHTML = `
      <header data-testid="search-header" data-rect="0,0,980,160">
        <form role="search" data-testid="search-form" data-rect="24,16,900,40">
          <input type="search" value="Image creation" data-testid="search-input" data-rect="32,20,640,32" />
          <ul role="listbox" data-testid="suggestions" data-rect="32,60,640,88">
            <li role="option" data-testid="query-suggestion" data-rect="48,72,360,32">Image creation</li>
          </ul>
        </form>
      </header>
      <main role="list" data-testid="list" data-rect="0,180,880,500">
        <article role="listitem" data-testid="card-alpha" data-rect="20,220,260,180">
          <a data-testid="link-alpha" data-rect="28,228,240,112" href="https://example.test/note/alpha">Image creation</a>
        </article>
      </main>
    `;
    installRects();
    expect((document.querySelector('[data-testid="search-input"]') as HTMLInputElement).value).toBe(
      'Image creation',
    );

    const scan = scanVisibleResultCardsInPage();
    const suggestions = scan.candidateActions.filter(
      (action) => action.intent === 'search.select_suggestion',
    );

    expect(suggestions).toEqual([
      expect.objectContaining({
        label: 'Image creation',
        actionability: true,
        executionTargetKind: 'snapshot_locator',
        matchReason: 'visible_search_suggestion.exact_current_query',
        locatorChain: expect.arrayContaining([
          expect.objectContaining({
            type: 'css',
            value: expect.stringContaining('li[data-testid="query-suggestion"]'),
          }),
        ]),
      }),
    ]);
  });

  it('does not promote a same-label complementary control without search-surface ownership', () => {
    setViewport();
    document.body.innerHTML = `
      <header data-testid="search-header" data-rect="0,0,900,72">
        <form role="search" data-testid="search-form" data-rect="24,16,640,40">
          <input type="search" data-testid="search-input" data-rect="32,20,480,32" />
        </form>
      </header>
      <aside role="complementary" data-testid="support-panel" data-rect="940,80,280,360">
        <button class="filter" data-testid="support-filter" data-rect="1000,100,96,36">Filter</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,880,520">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">Image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(
      scan.candidateActions.find(
        (action) => action.label === 'Filter' && action.intent === 'search.open_filters',
      ),
    ).toBeUndefined();
  });

  it('objectizes a toolbar-owned filter control without a pre-opened panel', () => {
    setViewport();
    document.body.innerHTML = `
      <header data-testid="search-header" data-rect="0,0,980,72">
        <form role="search" data-testid="search-form" data-rect="24,16,900,40">
          <input type="search" data-testid="search-input" data-rect="32,20,640,32" />
          <button data-testid="toolbar-filter" data-rect="700,20,96,32">Filter</button>
        </form>
      </header>
      <main role="list" data-testid="list" data-rect="0,100,880,520">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">Image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(
      scan.candidateActions.find(
        (action) => action.label === 'Filter' && action.intent === 'search.open_filters',
      ),
    ).toMatchObject({
      matchReason: 'visible_filter_trigger.search_toolbar',
      targetRef: expect.stringMatching(/^ref_filter_trigger_[0-9a-f]{8}$/),
    });
  });

  it('objectizes grouped options from a generic hover-revealed floating panel', () => {
    setViewport();
    document.body.innerHTML = `
      <header>
        <button data-testid="filter-trigger" data-rect="1060,24,92,40">筛选</button>
      </header>
      <section
        role="dialog"
        aria-label="Filters"
        class="floating-popover-panel"
        data-testid="floating-filter-panel"
        data-rect="820,80,420,560"
      >
        <div data-testid="group-sort" data-rect="852,112,96,24">排序依据</div>
        <button data-testid="sort-default" data-rect="852,144,96,40">综合</button>
        <button data-testid="sort-latest" data-rect="960,144,96,40">最新</button>
        <div data-testid="group-type" data-rect="852,208,96,24">笔记类型</div>
        <div role="option" data-testid="type-image-text" data-rect="852,240,96,40">图文</div>
        <div role="option" data-testid="type-video" data-rect="960,240,96,40">视频</div>
        <div data-testid="group-scope" data-rect="852,304,96,24">搜索范围</div>
        <button data-testid="scope-seen" data-rect="852,336,96,40">已看过</button>
        <button data-testid="scope-unseen" data-rect="960,336,96,40">未看过</button>
        <div data-testid="group-source" data-rect="852,400,96,24">内容来源</div>
        <button data-testid="source-original" data-rect="852,432,96,40">原创</button>
        <button data-testid="source-official" data-rect="960,432,96,40">官方</button>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.floatingSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceType: 'floating_surface',
          classification: 'filter_panel',
          panelRef: expect.stringMatching(/^ref_floating_surface_[0-9a-f]{8}$/),
          classificationEvidence: expect.arrayContaining(['search_filter_semantics']),
        }),
      ]),
    );
    expect(scan.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '原创',
          intent: 'search.apply_filter.unknown',
          matchReason: 'visible_filter_option',
          executionTargetKind: 'snapshot_locator',
          actionability: true,
          snapshotRect: expect.objectContaining({
            width: expect.any(Number),
            height: expect.any(Number),
          }),
          visibility: {
            source: 'dom',
            domVisible: true,
            inViewport: true,
            centerHitTarget: expect.any(Boolean),
            occluded: expect.any(Boolean),
            reason: expect.any(String),
          },
          provenance: expect.objectContaining({
            surfaceType: 'floating_surface',
            panelRef: expect.stringMatching(/^ref_floating_surface_[0-9a-f]{8}$/),
            groupId: '内容来源',
            optionRef: expect.stringMatching(/^ref_floating_option_[0-9a-f]{8}$/),
          }),
          locatorChain: expect.arrayContaining([
            expect.objectContaining({
              type: 'css',
              value: expect.stringContaining('button[data-testid="source-original"]'),
            }),
          ]),
        }),
        expect.objectContaining({
          label: '官方',
          intent: 'search.apply_filter.unknown',
          matchReason: 'visible_filter_option',
          actionability: true,
        }),
      ]),
    );
    expect(scan.filterState.filterGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: '内容来源',
          groupLabel: '内容来源',
          candidates: ['原创', '官方'],
          source: 'visible_floating_panel',
          provenance: expect.objectContaining({
            surfaceType: 'floating_surface',
            panelRef: expect.stringMatching(/^ref_floating_surface_[0-9a-f]{8}$/),
            groupId: '内容来源',
            optionRefs: expect.arrayContaining([
              expect.stringMatching(/^ref_floating_option_[0-9a-f]{8}$/),
            ]),
          }),
        }),
        expect.objectContaining({
          groupId: '搜索范围',
          groupLabel: '搜索范围',
          candidates: ['已看过', '未看过'],
          source: 'visible_floating_panel',
        }),
      ]),
    );
    expect(scan.pageRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: 'search_filters',
          candidateActionIds: expect.arrayContaining([
            expect.stringMatching(/^ca_filter_unknown_[0-9a-f]{8}$/),
          ]),
        }),
      ]),
    );
  });

  it.each(['fixed', 'absolute'] as const)(
    'objectizes delegated choices from a neutral %s portal without duplicating visual layers',
    (position) => {
      setViewport();
      document.body.innerHTML = `
      <input
        type="search"
        aria-label="Search catalog"
        data-testid="search-input"
        data-rect="20,20,360,40"
      />
      ${Array.from(
        { length: 24 },
        (_, index) => `
          <div
            data-testid="decorative-layer-${index}"
            data-rect="${20 + index},80,140,90"
            style="position: absolute"
          >decorative layer ${index}</div>
        `,
      ).join('')}
      <button data-testid="background-any" data-rect="20,80,96,40">不限</button>
      <section
        data-testid="portal-surface"
        data-rect="820,80,420,360"
        style="position: ${position}"
      >
        ${Array.from(
          { length: 140 },
          (_, index) => `<span aria-hidden="true" data-testid="portal-wrapper-${index}"></span>`,
        ).join('')}
        <div data-testid="delivery-group" data-rect="852,112,120,24" style="cursor: pointer">
          配送范围
        </div>
        <div data-testid="delivery-choices" data-rect="852,144,312,40" style="cursor: pointer">
          <div
            class="choice active"
            data-testid="delivery-any-shadow"
            data-rect="852,144,96,40"
            style="position: absolute; cursor: pointer"
          ><span>不限</span></div>
          <div
            class="choice"
            data-testid="delivery-any"
            data-rect="852,144,96,40"
            style="cursor: pointer"
          ><span>不限</span></div>
          <div
            class="choice"
            data-testid="delivery-local-shadow"
            data-rect="960,144,96,40"
            style="position: absolute; cursor: pointer"
          ><span>同城</span></div>
          <div
            class="choice"
            data-testid="delivery-local"
            data-rect="960,144,96,40"
            style="cursor: pointer; color: rgb(255, 36, 66); background-color: rgb(255, 240, 243); font-weight: 600"
          ><span>同城</span></div>
        </div>
        <div data-testid="source-group" data-rect="852,208,120,24" style="cursor: pointer">
          内容来源
        </div>
        <div data-testid="source-choices" data-rect="852,240,312,40" style="cursor: pointer">
          <div
            class="choice"
            data-testid="source-any-shadow"
            data-rect="852,240,96,40"
            style="position: absolute; cursor: pointer"
          ><span>不限</span></div>
          <div
            class="choice"
            data-testid="source-any"
            data-rect="852,240,96,40"
            style="cursor: pointer"
          ><span>不限</span></div>
          <div
            class="choice active"
            data-testid="source-official-shadow"
            data-rect="960,240,96,40"
            style="position: absolute; cursor: pointer"
          ><span>官方</span></div>
          <div
            class="choice active"
            data-testid="source-official"
            data-rect="960,240,96,40"
            style="cursor: pointer"
          ><span>官方</span></div>
        </div>
        <div data-testid="type-group" data-rect="852,304,120,24" style="cursor: pointer">
          内容类型
        </div>
        <div data-testid="type-choices" data-rect="852,336,312,40" style="cursor: pointer">
          <div
            class="choice"
            data-testid="type-any"
            data-rect="852,336,96,40"
            style="cursor: pointer; color: rgb(255, 36, 66); background-color: rgb(255, 240, 243); font-weight: 600"
          ><span>不限</span></div>
          <div
            class="choice"
            data-testid="type-video"
            data-rect="960,336,96,40"
            style="cursor: pointer"
          ><span>视频</span></div>
        </div>
        <div data-testid="operations" data-rect="852,392,312,40" style="cursor: pointer">
          <div data-testid="reset" data-rect="852,392,140,40" style="cursor: pointer">重置</div>
          <div data-testid="collapse" data-rect="1004,392,140,40" style="cursor: pointer">收起</div>
          <div data-testid="clear" data-rect="852,440,80,40" style="cursor: pointer">Clear</div>
          <div data-testid="apply" data-rect="944,440,80,40" style="cursor: pointer">Apply</div>
          <div data-testid="confirm" data-rect="1036,440,80,40" style="cursor: pointer">Confirm</div>
        </div>
      </section>
    `;
      installRects();

      const scan = scanVisibleResultCardsInPage();
      const panelActions = scan.candidateActions.filter(
        (action) => action.matchReason === 'visible_filter_option',
      );

      expect(scan.floatingSurfaces).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            surfaceType: 'floating_surface',
            classification: 'filter_panel',
            panelRef: expect.stringMatching(/^ref_floating_surface_[0-9a-f]{8}$/),
            classificationEvidence: expect.arrayContaining([`${position}_position`]),
          }),
        ]),
      );
      expect(scan.filterState.filterGroups).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            groupId: '配送范围',
            candidates: ['不限', '同城'],
            selected: '同城',
          }),
          expect.objectContaining({
            groupId: '内容来源',
            candidates: ['不限', '官方'],
            selected: '官方',
          }),
          expect.objectContaining({
            groupId: '内容类型',
            candidates: ['不限', '视频'],
            selected: '不限',
          }),
        ]),
      );
      expect(panelActions).toHaveLength(6);
      expect(panelActions.filter((action) => action.label === '不限')).toHaveLength(3);
      expect(new Set(panelActions.map((action) => action.targetRef)).size).toBe(6);
      expect(
        panelActions
          .filter(
            (action) =>
              action.provenance?.groupId === '配送范围' ||
              action.provenance?.groupId === '内容来源',
          )
          .every((action) => action.intent === 'search.apply_filter.unknown'),
      ).toBe(true);
      expect(
        panelActions
          .filter((action) => action.provenance?.groupId === '内容类型')
          .every((action) => action.intent === 'search.apply_filter.content_type'),
      ).toBe(true);
      expect(
        panelActions.some((action) => /重置|收起|clear|apply|confirm/i.test(action.label)),
      ).toBe(false);
      expect(
        panelActions.every(
          (action) =>
            action.executionTargetKind === 'snapshot_locator' &&
            action.provenance?.surfaceType === 'floating_surface',
        ),
      ).toBe(true);
      expect(
        panelActions.some((action) =>
          action.locatorChain.some((locator) => locator.value.includes('background-any')),
        ),
      ).toBe(false);
      expect(
        panelActions.some((action) =>
          action.locatorChain.some((locator) => locator.value.includes('-shadow')),
        ),
      ).toBe(false);
    },
  );

  it('does not mark every option selected when a group shares bold brand styling', () => {
    setViewport();
    document.body.innerHTML = `
      <input type="search" aria-label="Search catalog" data-testid="search-input" data-rect="20,20,360,40" />
      <section data-testid="portal-surface" data-rect="820,80,420,320" style="position: fixed">
        <h5 data-testid="time-heading" data-rect="852,112,120,24">时间范围</h5>
        <div data-testid="time-choices" data-rect="852,144,312,40" style="cursor: pointer">
          <button data-testid="time-any" data-rect="852,144,96,40" style="color: rgb(32, 96, 180); font-weight: 600">不限</button>
          <button data-testid="time-week" data-rect="960,144,96,40" style="color: rgb(32, 96, 180); font-weight: 600">一周内</button>
        </div>
        <h6 data-testid="type-heading" data-rect="852,208,120,24">内容类型</h6>
        <div data-testid="type-choices" data-rect="852,240,312,40" style="cursor: pointer">
          <button data-testid="type-all" data-rect="852,240,96,40" style="color: rgb(32, 96, 180); font-weight: 600">全部</button>
          <button data-testid="type-video" data-rect="960,240,96,40" style="color: rgb(32, 96, 180); font-weight: 600">视频</button>
        </div>
      </section>
    `;
    installRects();

    const groups = scanVisibleResultCardsInPage().filterState.filterGroups;

    expect(groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: '时间范围', selected: null, ambiguous: false }),
        expect.objectContaining({ groupId: '内容类型', selected: null, ambiguous: false }),
      ]),
    );
  });

  it('keeps unrelated help and account dialogs as generic floating surfaces', () => {
    setViewport();
    document.body.innerHTML = `
      <input type="search" aria-label="Search catalog" data-testid="search-input" data-rect="20,20,360,40" />
      <section role="dialog" aria-label="Help center" data-testid="help-dialog" data-rect="820,80,420,260">
        <button class="active" data-testid="help-latest" data-rect="852,120,120,40">最新</button>
        <button data-testid="help-video" data-rect="984,120,120,40">视频</button>
        <button data-testid="help-week" data-rect="852,176,120,40">一周内</button>
      </section>
      <section role="dialog" aria-label="Account settings" data-testid="account-dialog" data-rect="820,360,420,260">
        <button class="selected" data-testid="account-image" data-rect="852,400,120,40">图文</button>
        <button data-testid="account-popular" data-rect="984,400,120,40">最热</button>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.floatingSurfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          surfaceType: 'floating_surface',
          classification: 'generic',
          label: 'Help center',
          classificationEvidence: [],
        }),
        expect.objectContaining({
          surfaceType: 'floating_surface',
          classification: 'generic',
          label: 'Account settings',
          classificationEvidence: [],
        }),
      ]),
    );
    expect(scan.filterState.status).toBe('not_observed');
    expect(scan.filterState.filterGroups).toEqual([]);
    expect(
      scan.candidateActions.some((action) => action.intent.startsWith('search.apply_filter.')),
    ).toBe(false);
  });

  it('extracts nested option text once and keeps the concrete panel option target', () => {
    setViewport();
    document.body.innerHTML = `
      <button
        aria-controls="filter-surface"
        aria-expanded="true"
        data-testid="filter-trigger"
        data-rect="1060,24,92,40"
      >筛选</button>
      <section
        id="filter-surface"
        role="dialog"
        aria-label="Filters"
        data-testid="filter-panel"
        data-rect="820,80,420,300"
      >
        <div data-testid="group-source" data-rect="852,112,120,24">内容来源</div>
        <div data-testid="original-wrapper" data-rect="852,144,120,40">
          <button data-testid="source-original" data-rect="852,144,120,40"><span>原创</span></button>
        </div>
        <div data-testid="official-wrapper" data-rect="984,144,120,40">
          <button data-testid="source-official" data-rect="984,144,120,40"><span>官方</span></button>
        </div>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,240,260,180">
          <a data-testid="link-alpha" data-rect="28,248,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const originalActions = scan.candidateActions.filter(
      (action) => action.label === '原创' && action.intent === 'search.apply_filter.unknown',
    );

    expect(originalActions).toHaveLength(1);
    expect(originalActions[0]?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('button[data-testid="source-original"]'),
        }),
      ]),
    );
    expect(scan.filterState.filterGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: '内容来源',
          candidates: ['原创', '官方'],
        }),
      ]),
    );
  });

  it('never rebinds a panel option to a same-label control elsewhere on the page', () => {
    setViewport();
    document.body.innerHTML = `
      <nav data-testid="page-nav" data-rect="0,0,600,72">
        <button data-testid="outside-original" data-rect="20,16,120,40">原创</button>
      </nav>
      <section
        role="dialog"
        aria-label="Filters"
        data-testid="filter-panel"
        data-rect="820,80,420,300"
      >
        <div data-testid="group-source" data-rect="852,112,120,24">内容来源</div>
        <button data-testid="panel-original" data-rect="852,144,120,40">原创</button>
        <button data-testid="panel-official" data-rect="984,144,120,40">官方</button>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const action = scan.candidateActions.find(
      (candidate) =>
        candidate.label === '原创' && candidate.intent === 'search.apply_filter.unknown',
    );

    expect(action?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('button[data-testid="panel-original"]'),
        }),
      ]),
    );
    expect(action?.locatorChain).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('button[data-testid="outside-original"]'),
        }),
      ]),
    );
  });

  it('scopes active state to classified filter panels and marks conflicting panel options ambiguous', () => {
    setViewport();
    document.body.innerHTML = `
      <nav data-testid="global-tabs" data-rect="0,0,600,72">
        <button class="active" data-testid="global-video" data-rect="20,16,120,40">视频</button>
      </nav>
      <section
        role="dialog"
        aria-label="Filters"
        data-testid="filter-panel"
        data-rect="820,80,420,300"
      >
        <div data-testid="group-sort" data-rect="852,112,120,24">排序依据</div>
        <button class="active" data-testid="sort-latest" data-rect="852,144,120,40">最新</button>
        <button aria-selected="true" data-testid="sort-popular" data-rect="984,144,120,40">最热</button>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const sortGroup = scan.filterState.filterGroups.find((group) => group.groupId === '排序依据');

    expect(scan.filterState.contentType).toBeUndefined();
    expect(scan.filterState.appliedLabels).not.toContain('视频');
    expect(scan.filterState.sort).toBeUndefined();
    expect(sortGroup).toMatchObject({
      selected: null,
      candidates: ['最新', '最热'],
      ambiguous: true,
    });
  });

  it('objectizes a visible search input as a fillable search target', () => {
    setViewport();
    document.body.innerHTML = `
      <header data-testid="toolbar" data-rect="0,0,1280,88">
        <form role="search" data-testid="search-form" data-rect="16,18,420,48">
          <input
            type="search"
            aria-label="Search projects"
            data-testid="search-input"
            data-rect="20,24,360,40"
          />
        </form>
      </header>
      <main role="list" data-testid="list" data-rect="0,100,820,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const searchAction = scan.candidateActions.find(
      (action) => action.actionType === 'fill' && action.intent === 'search.enter_query',
    );

    expect(searchAction).toMatchObject({
      actionType: 'fill',
      intent: 'search.enter_query',
      actionability: true,
      matchReason: 'visible_search_input',
    });
    expect(searchAction?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('input[data-testid="search-input"]'),
        }),
      ]),
    );
    expect(scan.pageRegions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          regionId: 'search_input',
          regionType: 'search',
          targetability: true,
          candidateActionIds: expect.arrayContaining([searchAction?.id]),
        }),
      ]),
    );
  });

  it('objectizes a visible textarea search surface even when the placeholder is only a hint', () => {
    setViewport();
    document.body.innerHTML = `
      <header data-testid="toolbar" data-rect="0,0,1280,88">
        <section data-testid="search-shell" class="global-search-shell" data-rect="16,18,420,48">
          <textarea
            id="search-input"
            name="assistantSearchTextarea"
            class="textarea"
            placeholder="Learning"
            data-testid="search-textarea"
            data-rect="20,24,360,40"
          ></textarea>
        </section>
      </header>
      <main role="list" data-testid="list" data-rect="0,100,820,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const searchAction = scan.candidateActions.find(
      (action) => action.actionType === 'fill' && action.intent === 'search.enter_query',
    );

    expect(searchAction).toMatchObject({
      actionType: 'fill',
      intent: 'search.enter_query',
      actionability: true,
      matchReason: 'visible_search_input',
    });
    expect(searchAction?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: 'textarea#search-input',
        }),
      ]),
    );
  });

  it('does not objectize an out-of-band side panel filter label as search filter trigger', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,100,820,580">
        <section data-testid="toolbar" data-rect="20,80,760,48">
          <button data-testid="sort-current" data-rect="40,88,80,36" aria-selected="true">综合</button>
        </section>
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
          <a data-testid="link-gamma" data-rect="588,148,220,112" href="https://example.test/note/gamma">AI 生图高级感关键词</a>
          <span>作者 3</span>
          <span>3 天前</span>
          <span>收藏 102</span>
        </article>
      </main>
      <aside data-testid="assistant-panel" data-rect="1000,80,240,580">
        <span data-testid="assistant-filter-label" data-rect="1160,92,40,24">筛选</span>
        <p data-testid="assistant-copy" data-rect="1008,132,200,80">这里是内容摘要，不是搜索筛选工具栏。</p>
      </aside>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(
      scan.candidateActions.find(
        (action) => action.label === '筛选' && action.intent === 'search.open_filters',
      ),
    ).toBeUndefined();
    expect(scan.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: '综合',
          intent: 'search.apply_filter.sort',
        }),
      ]),
    );
  });

  it('does not promote a conversational side-surface control into a search filter trigger', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,100,820,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI image workflow</a>
        </article>
      </main>
      <aside class="assistant-chat" aria-label="Assistant conversation" data-testid="assistant-panel" data-rect="960,80,280,580">
        <button class="filter" data-testid="assistant-filter" data-rect="1120,96,72,36">筛选</button>
      </aside>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(
      scan.candidateActions.find(
        (action) => action.label === '筛选' && action.intent === 'search.open_filters',
      ),
    ).toBeUndefined();
  });

  it('strips sensitive and opaque query parameters from result-card URLs', () => {
    setViewport();
    renderCards([
      {
        key: 'tokenized',
        title: 'AI 图片创作提示词合集',
        href: 'https://example.test/note/alpha?xsec_token=PRIVATE_TOKEN_VALUE_123456789&xsec_source=web_feed&signature=abcdef1234567890abcdef1234567890&keep=public',
        y: 140,
      },
    ]);

    const scan = scanVisibleResultCardsInPage();
    const [card] = scan.cards;

    expect(card.url).toBe('https://example.test/note/alpha?keep=public');
    expect(card.actionTarget?.url).toBe('https://example.test/note/alpha?keep=public');
    expect(card.actionTarget?.openAction?.toolArgs.url).toBe(
      'https://example.test/note/alpha?keep=public',
    );
    expect(JSON.stringify(card)).not.toContain('xsec_token');
    expect(JSON.stringify(card)).not.toContain('PRIVATE_TOKEN_VALUE');
    expect(JSON.stringify(card)).not.toContain('signature');
  });

  it('prefers unobstructed duplicate filter options over covered labels', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,420,240">
        <button data-testid="covered-filter" data-rect="880,120,116,44">最多收藏</button>
        <button data-testid="visible-filter" data-rect="1010,120,116,44">最多收藏</button>
        <div data-testid="covering-panel" data-rect="890,126,96,32">遮挡层</div>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();
    const covered = document.querySelector('[data-testid="covered-filter"]');
    const visible = document.querySelector('[data-testid="visible-filter"]');
    const coveringPanel = document.querySelector('[data-testid="covering-panel"]');
    vi.mocked(document.elementFromPoint).mockImplementation((x: number, y: number) => {
      const pointInside = (element: Element | null): boolean => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
      };
      if (pointInside(coveringPanel)) return coveringPanel;
      if (pointInside(visible)) return visible;
      if (pointInside(covered)) return covered;
      return null;
    });

    const scan = scanVisibleResultCardsInPage();
    const action = scan.candidateActions.find(
      (candidate) =>
        candidate.label === '最多收藏' && candidate.intent === 'search.apply_filter.sort',
    );

    expect(action).toBeTruthy();
    expect(action?.locatorChain).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('button[data-testid="visible-filter"]'),
        }),
      ]),
    );
    expect(action?.locatorChain).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('button[data-testid="covered-filter"]'),
        }),
      ]),
    );
  });

  it('keeps applied filter state to one selected value per group while preserving visible filter actions', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,360,520">
        <button class="active" data-testid="sort-default" data-rect="880,120,116,44">综合</button>
        <button class="active" data-testid="sort-most-saved" data-rect="1010,120,116,44">最多收藏</button>
        <button aria-selected="true" data-testid="type-image-text" data-rect="880,190,116,44">图文</button>
        <button class="active" data-testid="time-default" data-rect="880,260,116,44">不限</button>
        <button class="active" data-testid="time-week" data-rect="1010,260,116,44">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.filterState).toMatchObject({
      appliedLabels: ['图文', '最多收藏', '一周内'],
      contentType: '图文',
      sort: '最多收藏',
      timeRange: '一周内',
    });
    expect(scan.filterState.filterGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: 'content_type', selected: '图文' }),
        expect.objectContaining({ groupId: 'sort', selected: '最多收藏' }),
        expect.objectContaining({ groupId: 'time_range', selected: '一周内' }),
      ]),
    );
    expect(scan.filterState.appliedFilters.map((filter) => filter.label)).toEqual([
      '图文',
      '最多收藏',
      '一周内',
    ]);
    expect(scan.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '综合', intent: 'search.apply_filter.sort' }),
        expect.objectContaining({ label: '不限', intent: 'search.apply_filter.time_range' }),
      ]),
    );
  });

  it('recognizes substring active classes without treating result-card text as selected filters', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,460,520">
        <button class="filter-option selected-state" data-testid="sort-default" data-rect="880,120,116,44">综合</button>
        <button class="filter-option is-active" data-testid="sort-most-saved" data-rect="1010,120,116,44">最多收藏</button>
        <button class="tab-item tab-active" data-testid="type-image-text" data-rect="880,190,116,44">图文</button>
        <button class="filter-option option-selected" data-testid="time-default" data-rect="880,260,116,44">不限</button>
        <button class="filter-option is-active" data-testid="time-week" data-rect="1010,260,116,44">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作最新视频排行榜</a>
          <span>作者 1</span>
          <span>一周内</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.filterState).toMatchObject({
      appliedLabels: ['图文', '最多收藏', '一周内'],
      contentType: '图文',
      sort: '最多收藏',
      timeRange: '一周内',
    });
    expect(scan.filterState.groups.sort).toMatchObject({
      selected: '最多收藏',
      candidates: ['综合', '最多收藏'],
      ambiguous: false,
    });
    expect(scan.filterState.groups.timeRange).toMatchObject({
      selected: '一周内',
      candidates: ['不限', '一周内'],
      ambiguous: false,
    });
  });

  it('infers selected filters from visible styles inside a generic filter panel', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,460,520">
        <button data-testid="sort-default" data-rect="880,120,116,44" style="background: rgb(248, 248, 248); color: rgb(128, 128, 128); font-weight: 400;">综合</button>
        <div class="active" tabindex="-1" data-testid="sort-latest-shadow" data-rect="880,172,116,44" style="position: absolute;">最新</div>
        <button data-testid="sort-latest" data-rect="880,172,116,44" style="background: rgb(248, 248, 248); color: rgb(128, 128, 128); font-weight: 400;">最新</button>
        <button data-testid="sort-most-saved" data-rect="1010,120,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">最多收藏</button>
        <button data-testid="type-video" data-rect="880,190,116,44" style="background: rgb(248, 248, 248); color: rgb(128, 128, 128); font-weight: 400;">视频</button>
        <button data-testid="type-image-text" data-rect="1010,190,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">图文</button>
        <button data-testid="time-default" data-rect="880,260,116,44" style="background: rgb(248, 248, 248); color: rgb(128, 128, 128); font-weight: 400;">不限</button>
        <button data-testid="time-week" data-rect="1010,260,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage({ maxCards: 10 });

    expect(scan.filterState).toMatchObject({
      appliedLabels: ['图文', '最多收藏', '一周内'],
      contentType: '图文',
      sort: '最多收藏',
      timeRange: '一周内',
    });
    expect(scan.filterState.filterGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: 'content_type', source: 'mixed' }),
        expect.objectContaining({ groupId: 'sort', source: 'mixed' }),
        expect.objectContaining({ groupId: 'time_range', source: 'mixed' }),
      ]),
    );
  });

  it('does not infer style-selected filters from result card text outside filter context', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a
            data-testid="link-alpha"
            data-rect="28,148,240,112"
            href="https://example.test/note/alpha"
            style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;"
          >一周内</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage({ maxCards: 10 });

    expect(scan.filterState.status).toBe('not_observed');
    expect(scan.filterState.appliedLabels).toEqual([]);
  });

  it('does not infer selected filters from unrelated dialog content with filter-like labels', () => {
    setViewport();
    document.body.innerHTML = `
      <section role="dialog" aria-label="推荐内容" data-testid="content-dialog" data-rect="840,80,420,360">
        <button data-testid="topic-video" data-rect="880,120,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">视频</button>
        <button data-testid="topic-latest" data-rect="1010,120,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">最新</button>
        <button data-testid="topic-week" data-rect="880,190,116,44" style="background: rgb(255, 238, 242); color: rgb(255, 36, 66); font-weight: 700;">一周内</button>
      </section>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage({ maxCards: 10 });

    expect(scan.filterState.status).toBe('not_observed');
    expect(scan.filterState.appliedLabels).toEqual([]);
  });

  it('keeps rendered offscreen selected filters as page state while not turning them into visible actions', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,-360,460,520">
        <button class="filter-option selected-state" data-testid="sort-default" data-rect="880,-320,116,44">综合</button>
        <button class="filter-option is-active" data-testid="sort-most-saved" data-rect="1010,-320,116,44">最多收藏</button>
        <button class="tab-item tab-active" data-testid="type-image-text" data-rect="880,-250,116,44">图文</button>
        <button class="filter-option option-selected" data-testid="time-default" data-rect="880,-180,116,44">不限</button>
        <button class="filter-option is-active" data-testid="time-week" data-rect="1010,-180,116,44">一周内</button>
        <button class="filter-option is-active" data-testid="location-default" data-rect="880,24,116,44">不限</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.filterState).toMatchObject({
      appliedLabels: ['图文', '最多收藏', '一周内'],
      contentType: '图文',
      sort: '最多收藏',
      timeRange: '一周内',
    });
    expect(scan.candidateActions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '最多收藏', actionability: true }),
        expect.objectContaining({ label: '一周内', actionability: true }),
      ]),
    );
  });

  it('ignores hidden selected filter templates when collecting rendered page state', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="hidden-filter-template" data-rect="840,80,460,520" style="display: none;">
        <button class="filter-option is-active" data-testid="hidden-sort-most-saved" data-rect="880,120,116,44">最多收藏</button>
        <button class="tab-item tab-active" data-testid="hidden-type-image-text" data-rect="880,190,116,44">图文</button>
        <button class="filter-option is-active" data-testid="hidden-time-week" data-rect="1010,260,116,44">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/content/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.filterState.status).toBe('not_observed');
    expect(scan.filterState.appliedLabels).toEqual([]);
    expect(scan.filterState.contentType).toBeUndefined();
    expect(scan.filterState.sort).toBeUndefined();
    expect(scan.filterState.timeRange).toBeUndefined();
  });

  it('does not prefer task-specific filter labels when a group has multiple non-default active values', () => {
    setViewport();
    document.body.innerHTML = `
      <aside role="dialog" data-testid="filter-panel" data-rect="840,80,360,520">
        <button class="active" data-testid="sort-latest" data-rect="880,120,116,44">最新</button>
        <button class="active" data-testid="sort-most-saved" data-rect="1010,120,116,44">最多收藏</button>
        <button aria-selected="true" data-testid="type-image-text" data-rect="880,190,116,44">图文</button>
        <button class="active" data-testid="time-week" data-rect="1010,260,116,44">一周内</button>
      </aside>
      <main role="list" data-testid="list" data-rect="0,100,780,580">
        <article role="listitem" data-testid="card-alpha" data-rect="20,140,260,180">
          <a data-testid="link-alpha" data-rect="28,148,240,112" href="https://example.test/note/alpha">AI 图片创作提示词合集</a>
          <span>作者 1</span>
          <span>1 天前</span>
          <span>收藏 100</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();

    expect(scan.filterState.sort).toBeUndefined();
    expect(scan.filterState.appliedLabels).toEqual(['图文', '一周内']);
    expect(scan.filterState.groups.sort).toMatchObject({
      selected: null,
      candidates: ['最新', '最多收藏'],
      ambiguous: true,
      reason:
        'multiple non-default active candidates were observed; selected value is intentionally withheld',
    });
    expect(scan.filterState.appliedFilters.map((filter) => filter.label)).not.toContain('最多收藏');
    expect(scan.candidateActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '最新', intent: 'search.apply_filter.sort' }),
        expect.objectContaining({ label: '最多收藏', intent: 'search.apply_filter.sort' }),
      ]),
    );
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

  it('promotes a visible detail link with a CSS locator to a stable click target', () => {
    setViewport();
    renderCards([
      {
        key: 'alpha',
        title: 'AI 图片创作提示词合集',
        href: 'https://content.example/search_result/alpha123?tracking=redacted',
        y: 24,
      },
    ]);
    const link = document.querySelector('[data-testid="link-alpha"]');
    if (!link) throw new Error('expected alpha link');
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => link),
    });

    const scan = scanVisibleResultCardsInPage();
    const card = scan.cards[0];
    const action = card.actionTarget?.toolArgs?.candidateAction;

    expect(card.actionTarget?.executionScope).toBe('same_tab_fresh_snapshot');
    expect(card.actionTarget?.toolName).toBe('chrome_click_element');
    expect(action).toMatchObject({
      actionType: 'click',
      intent: 'content.open_detail',
      matchReason: 'result_card_primary_link',
      locatorChain: expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('a[data-testid="link-alpha"]'),
        }),
      ]),
    });
    expect(card.actionTarget?.openAction?.toolName).toBe('chrome_navigate');
    expect(scan.candidateActions.some((action) => action.intent === 'content.open_detail')).toBe(
      true,
    );
  });

  it('keeps unverified visible detail links as URL fallback instead of stable click actions', () => {
    setViewport();
    renderCards([
      {
        key: 'alpha',
        title: 'AI 图片创作提示词合集',
        href: 'https://content.example/search_result/alpha123?tracking=redacted',
        y: -120,
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
    expect(card.actionTarget?.toolArgs).toBeUndefined();
    expect(card.actionTarget?.openAction?.toolName).toBe('chrome_navigate');
    expect(scan.candidateActions.some((action) => action.intent === 'content.open_detail')).toBe(
      false,
    );
  });

  it('prefers the first meaningful title link over longer description links in generic result cards', () => {
    setViewport();
    document.body.innerHTML = `
      <main role="list" data-testid="list" data-rect="0,0,1000,680">
        <article role="listitem" data-testid="card-alpha" data-rect="20,24,520,220">
          <a
            data-testid="title-link"
            data-rect="28,32,220,32"
            href="https://code.example/owner/repo"
          >owner/repo</a>
          <a
            data-testid="description-link"
            data-rect="28,76,480,64"
            href="https://code.example/owner/repo"
          >AI browser intelligence extension for automatic tab classification and browser control</a>
          <span>Updated yesterday</span>
          <span>Stars 128</span>
        </article>
      </main>
    `;
    installRects();

    const scan = scanVisibleResultCardsInPage();
    const card = scan.cards[0];
    const action = card?.actionTarget?.toolArgs?.candidateAction;

    expect(card?.title).toBe('owner/repo');
    expect(card?.actionTarget?.selector).toContain('a[data-testid="title-link"]');
    expect(action).toMatchObject({
      label: 'owner/repo',
      actionType: 'click',
      intent: 'content.open_detail',
      matchReason: 'result_card_primary_link',
      locatorChain: expect.arrayContaining([
        expect.objectContaining({
          type: 'css',
          value: expect.stringContaining('a[data-testid="title-link"]'),
        }),
      ]),
    });
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

  it('scrolls the nearest result-card container for class-based card streams', () => {
    setViewport();
    document.body.innerHTML = `
      <div
        data-testid="outer-shell"
        data-rect="0,60,960,620"
        style="overflow-y: auto;"
      >
        <a href="https://example.test/nav/a">Nav A</a>
        <a href="https://example.test/nav/b">Nav B</a>
        <section
          data-testid="inner-results"
          data-rect="0,80,900,560"
          style="overflow-y: auto;"
        >
          <div class="note-card" data-testid="card-alpha" data-rect="20,120,260,180">
            <a
              data-testid="link-alpha"
              data-rect="28,128,240,112"
              href="https://example.test/note/alpha"
            >AI 图片创作提示词合集</a>
          </div>
          <div class="note-card" data-testid="card-beta" data-rect="300,120,260,180">
            <a
              data-testid="link-beta"
              data-rect="308,128,240,112"
              href="https://example.test/note/beta"
            >一周内 AI 绘图工具推荐</a>
          </div>
        </section>
      </div>
    `;
    const outerShell = document.querySelector<HTMLElement>('[data-testid="outer-shell"]');
    const innerResults = document.querySelector<HTMLElement>('[data-testid="inner-results"]');
    if (!outerShell || !innerResults) throw new Error('expected nested scroll containers');
    Object.defineProperty(outerShell, 'clientHeight', { value: 620, configurable: true });
    Object.defineProperty(outerShell, 'scrollHeight', { value: 1800, configurable: true });
    Object.defineProperty(outerShell, 'scrollTop', { value: 0, configurable: true });
    Object.defineProperty(innerResults, 'clientHeight', { value: 560, configurable: true });
    Object.defineProperty(innerResults, 'scrollHeight', { value: 1600, configurable: true });
    let innerScrollTop = 120;
    Object.defineProperty(innerResults, 'scrollTop', {
      configurable: true,
      get: () => innerScrollTop,
      set: (value: number) => {
        innerScrollTop = value;
      },
    });
    Object.defineProperty(innerResults, 'scrollBy', {
      configurable: true,
      value: vi.fn((_x: number, y: number) => {
        innerScrollTop += y;
      }),
    });
    installRects();

    const scroll = scrollPageBy(640);

    expect(scroll.scrollTarget).toBe('element');
    expect(scroll.beforeY).toBe(120);
    expect(scroll.afterY).toBe(760);
    expect(scroll.pixelsBelow).toBe(280);
    expect(outerShell.scrollTop).toBe(0);
  });

  it('resets the nearest result-card container to top before cross-scroll collection', () => {
    setViewport();
    document.body.innerHTML = `
      <section
        data-testid="inner-results"
        data-rect="0,80,900,560"
        style="overflow-y: auto;"
      >
        <div class="result-card" data-testid="card-alpha" data-rect="20,120,260,180">
          <a
            data-testid="link-alpha"
            data-rect="28,128,240,112"
            href="https://example.test/note/alpha"
          >AI 图片创作提示词合集</a>
        </div>
      </section>
    `;
    const innerResults = document.querySelector<HTMLElement>('[data-testid="inner-results"]');
    if (!innerResults) throw new Error('expected inner result container');
    Object.defineProperty(innerResults, 'clientHeight', { value: 560, configurable: true });
    Object.defineProperty(innerResults, 'scrollHeight', { value: 1600, configurable: true });
    let innerScrollTop = 480;
    Object.defineProperty(innerResults, 'scrollTop', {
      configurable: true,
      get: () => innerScrollTop,
      set: (value: number) => {
        innerScrollTop = value;
      },
    });
    installRects();

    const scroll = scrollPageToTop();

    expect(scroll.scrollTarget).toBe('element');
    expect(scroll.beforeY).toBe(480);
    expect(scroll.afterY).toBe(0);
    expect(innerScrollTop).toBe(0);
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

  it('falls back to scrolling the lowest visible result card into view', () => {
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
        <article role="listitem" data-testid="card-beta" data-rect="20,360,260,180">
          <a
            data-testid="link-beta"
            data-rect="28,368,240,112"
            href="https://example.test/note/beta"
          >一周内 AI 绘图工具推荐</a>
        </article>
      </main>
    `;
    installRects();
    const list = document.querySelector<HTMLElement>('[data-testid="list"]');
    const betaCard = document.querySelector<HTMLElement>('[data-testid="card-beta"]');
    if (!list || !betaCard) throw new Error('expected result list and beta card');
    const scrollIntoView = vi.fn();
    Object.defineProperty(betaCard, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
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
    expect(scroll.scrollIntoViewDispatched).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });
  });
});
