import { describe, expect, it, vi } from 'vitest';

import { collectVisibleSearchSurfaceActions } from '../entrypoints/background/tools/browser/read-page-visible-search-surface-actions';

function action(id: string, label = id) {
  return {
    id,
    actionType: 'click',
    targetRef: `tgt_${id}`,
    label,
    intent: 'result.open',
    locatorChain: [{ type: 'css', value: `[data-result-id="${id}"]` }],
    confidence: 0.82,
  };
}

describe('visible search surface action collection', () => {
  it('does not scan pages that do not need search toolbar recovery', async () => {
    const executeScript = vi.fn();

    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/home',
      pageRole: 'content_detail',
      executeScript,
    });

    expect(result).toEqual({ actions: [] });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('selects the current page scan before richer unrelated frame scans', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          pageInfo: { url: 'chrome://newtab/' },
          candidateActions: [action('browser_frame')],
          cards: [{ id: 'browser_frame' }],
        },
      },
      {
        result: {
          pageInfo: { url: 'https://example.test/other' },
          candidateActions: [action('other_1'), action('other_2')],
          cards: [{ id: 'other_1' }, { id: 'other_2' }],
        },
      },
      {
        result: {
          pageInfo: { url: 'https://example.test/search?q=ai' },
          candidateActions: [action('current_1', '当前结果')],
          cards: [{ id: 'current_1' }],
        },
      },
    ]);

    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/search?q=tabrix',
      pageRole: 'search_results',
      executeScript,
    });

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 12, allFrames: true },
        world: 'MAIN',
      }),
    );
    expect(result.actions).toEqual([
      expect.objectContaining({
        id: 'current_1',
        targetRef: 'tgt_current_1',
        label: '当前结果',
      }),
    ]);
  });

  it('returns visible search filter state from the selected current-page scan', async () => {
    const filterState = {
      status: 'observed',
      appliedLabels: ['最多收藏'],
      sort: '最多收藏',
      groups: {
        sort: {
          selected: '最多收藏',
          candidates: ['综合', '最多收藏'],
          source: 'dom_active_state',
          confidence: 0.9,
          ambiguous: false,
          reason: 'active DOM state observed',
        },
      },
    };
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          pageInfo: { url: 'https://example.test/search?q=ai' },
          candidateActions: [action('current_1', '当前结果')],
          filterState,
        },
      },
    ]);

    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/search?q=ai',
      pageRole: 'search_results',
      executeScript,
    });

    expect(result.filterState).toBe(filterState);
    expect(result.actions).toHaveLength(1);
  });

  it('scans multi-region pages so visible homepage search inputs become fill targets', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          pageInfo: { url: 'https://example.test/explore' },
          candidateActions: [
            {
              id: 'ca_fill_ref_search_input',
              actionType: 'fill',
              targetRef: 'ref_search_input',
              label: 'Search ideas',
              intent: 'search.enter_query',
              matchReason: 'visible_search_input',
              locatorChain: [
                { type: 'ref', value: 'ref_search_input' },
                { type: 'css', value: 'textarea[placeholder*="Search"]' },
              ],
              confidence: 0.9,
            },
          ],
        },
      },
    ]);

    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/explore',
      pageRole: 'multi_region_page',
      executeScript,
    });

    expect(executeScript).toHaveBeenCalled();
    expect(result.actions).toEqual([
      expect.objectContaining({
        id: 'ca_fill_ref_search_input',
        actionType: 'fill',
        targetRef: 'ref_search_input',
        intent: 'search.enter_query',
      }),
    ]);
  });

  it('can be forced when visible regions prove the page has a business surface before role reconciliation', async () => {
    const executeScript = vi.fn().mockResolvedValue([
      {
        result: {
          pageInfo: { url: 'https://example.test/explore' },
          candidateActions: [
            {
              id: 'ca_fill_ref_search_input',
              actionType: 'fill',
              targetRef: 'ref_search_input',
              label: 'Learning',
              intent: 'search.enter_query',
              matchReason: 'visible_search_input',
              locatorChain: [
                { type: 'ref', value: 'ref_search_input' },
                { type: 'css', value: 'textarea#search-input' },
              ],
              confidence: 0.9,
            },
          ],
        },
      },
    ]);

    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/explore',
      pageRole: 'generic_page',
      forceScan: true,
      executeScript,
    });

    expect(executeScript).toHaveBeenCalled();
    expect(result.actions).toEqual([
      expect.objectContaining({
        id: 'ca_fill_ref_search_input',
        actionType: 'fill',
        targetRef: 'ref_search_input',
        intent: 'search.enter_query',
      }),
    ]);
  });

  it('returns a sensing diagnostic when the scan fails', async () => {
    const result = await collectVisibleSearchSurfaceActions({
      tabId: 12,
      currentUrl: 'https://example.test/search',
      pageRole: 'search_results',
      executeScript: vi.fn().mockRejectedValue(new Error('frame detached while scanning')),
    });

    expect(result.actions).toEqual([]);
    expect(result.sensingDiagnostic).toEqual({
      source: 'visible_search_surface.scan',
      message: 'visible result card action scan failed: frame detached while scanning',
    });
  });
});
