import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadPageCandidateAction, ReadPageInteractiveElement } from '@tabrix/shared';
import {
  __flushStableTargetRefRegistryPersistenceForTests,
  __resetStableTargetRefRegistryForTests,
  getStableTargetRefRegistrySnapshot,
  hydrateStableTargetRefRegistryFromStorage,
  flushStableTargetRefRegistryPersistence,
  lookupCandidateActionTargetLocatorEntry,
  lookupStableTargetRef,
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
  clearStableTargetRefTab,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';
import { recordReadPageTargetPublication } from '@/entrypoints/background/tools/browser/read-page-object-publication';

function makeStorageArea(
  store: Record<string, unknown>,
  hooks: { onSet?: () => Promise<void> | void } = {},
) {
  return {
    get: vi.fn(async (keys: string | string[]) => {
      const result: Record<string, unknown> = {};
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        if (Object.prototype.hasOwnProperty.call(store, key)) {
          result[key] = store[key];
        }
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      await hooks.onSet?.();
      Object.assign(store, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete store[key];
      }
    }),
  };
}

describe('B-011 stable-targetRef registry', () => {
  beforeEach(() => {
    __resetStableTargetRefRegistryForTests();
  });

  it('records and looks up entries by tab', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('keeps tabs isolated', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_other' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(8, 'tgt_aaaaaaaaaa')).toBe('ref_other');
  });

  it('replaces the snapshot for a tab on each record call', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('drops the tab when given an empty list', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, []);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(getStableTargetRefRegistrySnapshot().tabIds).not.toContain(7);
  });

  it('clearTab removes only the requested tab', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    clearStableTargetRefTab(7);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(8, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('returns undefined for unknown tabs / refs / invalid args', () => {
    expect(lookupStableTargetRef(7, 'tgt_nope')).toBeUndefined();
    expect(lookupStableTargetRef(undefined as any, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(NaN, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, '')).toBeUndefined();
  });

  it('first write wins when multiple entries share the same targetRef', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_first' },
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_second' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_first');
  });

  it('snapshot reports tab counts deterministically', () => {
    recordStableTargetRefSnapshot(8, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_cccccccccc', ref: 'ref_c' }]);
    const snap = getStableTargetRefRegistrySnapshot();
    expect(snap.tabIds).toEqual([7, 8]);
    expect(snap.entryCounts[7]).toBe(1);
    expect(snap.entryCounts[8]).toBe(2);
  });

  it('records and looks up candidate action locators by tab', () => {
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
      { targetRef: 'ref_fallback_2', selector: 'button[data-action="publish"]', frameId: 3 },
    ]);

    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toMatchObject({
      targetRef: 'ref_fallback_1',
      selector: 'nav a[href="/live"]',
      selectorType: 'css',
    });
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_2')).toMatchObject({
      targetRef: 'ref_fallback_2',
      selector: 'button[data-action="publish"]',
      selectorType: 'css',
      frameId: 3,
    });
  });

  it('preserves xpath candidate action locators for synthetic read_page refs', () => {
    recordCandidateActionTargetLocatorsSnapshot(9, [
      {
        targetRef: 'ref_filter_time_range_84d3437b',
        selector: '//*[@role="button" and normalize-space(.)="一周内"]',
        selectorType: 'xpath',
        frameId: 4,
      },
    ]);

    expect(
      lookupCandidateActionTargetLocatorEntry(9, 'ref_filter_time_range_84d3437b'),
    ).toMatchObject({
      targetRef: 'ref_filter_time_range_84d3437b',
      selector: '//*[@role="button" and normalize-space(.)="一周内"]',
      selectorType: 'xpath',
      frameId: 4,
    });
  });

  it('records read_page candidate action xpath before css fallback', () => {
    recordReadPageTargetPublication({
      tabId: 9,
      candidateActions: [
        {
          id: 'ca_filter_sort',
          actionType: 'click',
          targetRef: 'ref_filter_sort_c4ba7440',
          label: '最多收藏',
          intent: 'filter.option_select',
          confidence: 0.92,
          matchReason: 'filter option visible in current panel',
          locatorChain: [
            { type: 'ref', value: 'ref_filter_sort_c4ba7440' },
            { type: 'aria', value: '最多收藏' },
            { type: 'css', value: 'body > div:nth-of-type(9) button:nth-of-type(5)' },
            { type: 'xpath', value: '//*[@role="button" and normalize-space(.)="最多收藏"]' },
          ],
        } satisfies ReadPageCandidateAction,
      ],
    });

    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_filter_sort_c4ba7440')).toMatchObject({
      selector: '//*[@role="button" and normalize-space(.)="最多收藏"]',
      selectorType: 'xpath',
    });
  });

  it('records actionable interactive element refs so visible synthetic refs can be clicked later', () => {
    recordReadPageTargetPublication({
      tabId: 9,
      interactiveElements: [
        {
          ref: 'ref_text_search_toolbar_123',
          role: 'button',
          name: '筛选',
          selector: 'main [data-role="filter-trigger"]',
          actionability: 'actionable',
          matchSource: 'visible_text',
        } satisfies ReadPageInteractiveElement,
        {
          ref: 'ref_text_search_toolbar_hidden',
          role: 'button',
          name: '隐藏筛选',
          selector: 'main [data-role="hidden-filter-trigger"]',
          actionability: 'not_actionable',
          matchSource: 'visible_text',
        } satisfies ReadPageInteractiveElement,
      ],
    });

    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_text_search_toolbar_123')).toMatchObject(
      {
        selector: 'main [data-role="filter-trigger"]',
        selectorType: 'css',
      },
    );
    expect(
      lookupCandidateActionTargetLocatorEntry(9, 'ref_text_search_toolbar_hidden'),
    ).toBeUndefined();
  });

  it('replaces candidate action locator snapshot independently from stable refs', () => {
    recordStableTargetRefSnapshot(9, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
    ]);
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_2', selector: 'button[data-action="publish"]' },
    ]);

    expect(lookupStableTargetRef(9, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toBeUndefined();
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_2')).toMatchObject({
      selector: 'button[data-action="publish"]',
    });
  });

  it('clearTab removes candidate action locators too', () => {
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
    ]);
    clearStableTargetRefTab(9);
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toBeUndefined();
  });

  it('hydrates read_page candidate action locators from chrome storage session', async () => {
    const originalSession = (chrome.storage as any).session;
    const store: Record<string, unknown> = {};
    (chrome.storage as any).session = makeStorageArea(store);
    try {
      recordReadPageTargetPublication({
        tabId: 9,
        candidateActions: [
          {
            id: 'ca_filter_sort',
            actionType: 'click',
            targetRef: 'ref_filter_sort_c4ba7440',
            label: 'Most saved',
            intent: 'search.apply_filter.sort',
            confidence: 0.92,
            matchReason: 'filter option visible in current panel',
            locatorChain: [
              { type: 'ref', value: 'ref_filter_sort_c4ba7440' },
              { type: 'xpath', value: '//*[@role="button" and normalize-space(.)="Most saved"]' },
            ],
          } satisfies ReadPageCandidateAction,
        ],
      });
      await __flushStableTargetRefRegistryPersistenceForTests();

      __resetStableTargetRefRegistryForTests();
      expect(
        lookupCandidateActionTargetLocatorEntry(9, 'ref_filter_sort_c4ba7440'),
      ).toBeUndefined();

      await hydrateStableTargetRefRegistryFromStorage(9);

      expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_filter_sort_c4ba7440')).toMatchObject({
        selector: '//*[@role="button" and normalize-space(.)="Most saved"]',
        selectorType: 'xpath',
      });
    } finally {
      (chrome.storage as any).session = originalSession;
    }
  });

  it('flushes queued storage persistence before read_page output returns', async () => {
    const originalSession = (chrome.storage as any).session;
    const store: Record<string, unknown> = {};
    let releaseSet: (() => void) | null = null;
    let setCompleted = false;
    (chrome.storage as any).session = makeStorageArea(store, {
      onSet: () =>
        new Promise<void>((resolve) => {
          releaseSet = () => {
            setCompleted = true;
            resolve();
          };
        }),
    });
    try {
      recordCandidateActionTargetLocatorsSnapshot(9, [
        { targetRef: 'ref_filter_sort_c4ba7440', selector: '[data-sort="saved"]' },
      ]);

      const flushed = flushStableTargetRefRegistryPersistence();
      for (let i = 0; i < 10 && !releaseSet; i += 1) {
        await Promise.resolve();
      }
      expect(typeof releaseSet).toBe('function');
      expect(setCompleted).toBe(false);

      releaseSet?.();
      await flushed;

      expect(setCompleted).toBe(true);
      expect(store).toHaveProperty('tabrix.stableTargetRefRegistry.v1');
    } finally {
      (chrome.storage as any).session = originalSession;
    }
  });
});
