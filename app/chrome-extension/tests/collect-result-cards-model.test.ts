import { describe, expect, it } from 'vitest';

import {
  type CollectedResultCard,
  mergeCollectedResultCards,
  resultCardKey,
  stableResultCardTarget,
  summarizeCollectedResultCardTargetability,
} from '@/entrypoints/background/tools/browser/collect-result-cards-model';

function card(overrides: Partial<CollectedResultCard>): CollectedResultCard {
  return {
    title: overrides.title ?? 'AI image workflow',
    url: overrides.url,
    primaryText: overrides.primaryText,
    secondaryText: overrides.secondaryText,
    metaText: overrides.metaText,
    interactionText: overrides.interactionText,
    imageCount: overrides.imageCount ?? 1,
    sourceScrollY: overrides.sourceScrollY ?? 0,
    firstSeenGlobalTop: overrides.firstSeenGlobalTop ?? 0,
    rect: overrides.rect ?? { x: 10, y: 20, width: 240, height: 160 },
    actionTarget: overrides.actionTarget,
    confidence: overrides.confidence ?? 0.68,
    reasons: overrides.reasons ?? ['link_present'],
  };
}

describe('resultCardKey', () => {
  it('deduplicates URL query variants without merging different titles', () => {
    expect(
      resultCardKey(card({ title: 'Prompt Guide', url: 'https://example.com/a?x=1#top' })),
    ).toBe('prompt guide|https://example.com/a');
    expect(resultCardKey(card({ title: 'Other Guide', url: 'https://example.com/a' }))).toBe(
      'other guide|https://example.com/a',
    );
  });

  it('deduplicates generic detail URL variants for the same content id', () => {
    expect(
      resultCardKey(
        card({
          title: 'AI image workflow',
          url: 'https://content.example/search_result/6a2be61300000000210164c2?tracking=abc',
        }),
      ),
    ).toBe('ai image workflow|https://content.example/content/6a2be61300000000210164c2');
    expect(
      resultCardKey(
        card({
          title: 'AI image workflow',
          url: 'https://content.example/explore/6a2be61300000000210164c2',
        }),
      ),
    ).toBe('ai image workflow|https://content.example/content/6a2be61300000000210164c2');
  });
});

describe('mergeCollectedResultCards', () => {
  it('keeps first visual order and fills missing fields from duplicate cards', () => {
    const merged = mergeCollectedResultCards(
      [
        card({
          title: 'Second card',
          url: 'https://example.com/2',
          firstSeenGlobalTop: 700,
          confidence: 0.6,
        }),
        card({
          title: 'First card',
          url: 'https://example.com/1?utm=abc',
          firstSeenGlobalTop: 120,
          confidence: 0.64,
          reasons: ['link_present'],
        }),
      ],
      [
        card({
          title: 'First card',
          url: 'https://example.com/1',
          primaryText: 'Author A',
          metaText: '1 day ago',
          interactionText: 'saved 129',
          actionTarget: {
            actionType: 'click',
            targetKind: 'result_card_link',
            url: 'https://example.com/1',
            selector: 'a.title',
            toolName: 'chrome_click_element',
            toolArgs: {
              candidateAction: {
                id: 'ca_click_ref_result_card_1',
                actionType: 'click',
                targetRef: 'ref_result_card_1',
                label: 'First card',
                confidence: 0.9,
                matchReason: 'result_card_primary_link',
                intent: 'content.open_detail',
                locatorChain: [
                  { type: 'ref', value: 'ref_result_card_1' },
                  { type: 'css', value: 'a.title' },
                ],
              },
            },
            rect: { x: 20, y: 30, width: 120, height: 28 },
            center: { x: 80, y: 44 },
            coordinateFrame: 'viewport',
            sourceScrollY: 0,
            confidence: 0.9,
            reasons: ['title_link_match'],
          },
          firstSeenGlobalTop: 121,
          confidence: 0.82,
          reasons: ['media_present', 'meta_text_present'],
        }),
        card({
          title: 'Third card',
          url: 'https://example.com/3',
          firstSeenGlobalTop: 900,
        }),
      ],
      10,
    );

    expect(merged.map((item) => item.title)).toEqual(['First card', 'Second card', 'Third card']);
    expect(merged[0]).toMatchObject({
      primaryText: 'Author A',
      metaText: '1 day ago',
      interactionText: 'saved 129',
      actionTarget: {
        actionType: 'click',
        targetKind: 'result_card_link',
        url: 'https://example.com/1',
        selector: 'a.title',
        toolName: 'chrome_click_element',
        toolArgs: {
          candidateAction: {
            targetRef: 'ref_result_card_1',
            intent: 'content.open_detail',
            locatorChain: expect.arrayContaining([{ type: 'css', value: 'a.title' }]),
          },
        },
        coordinateFrame: 'viewport',
        sourceScrollY: 0,
      },
      confidence: 0.82,
    });
    expect(merged[0].reasons).toEqual(['link_present', 'media_present', 'meta_text_present']);
  });

  it('respects the requested limit after sorting', () => {
    const merged = mergeCollectedResultCards(
      [],
      [
        card({ title: 'Three', firstSeenGlobalTop: 300 }),
        card({ title: 'One', firstSeenGlobalTop: 100 }),
        card({ title: 'Two', firstSeenGlobalTop: 200 }),
      ],
      2,
    );

    expect(merged.map((item) => item.title)).toEqual(['One', 'Two']);
  });

  it('prefers a later executable click target over an earlier URL-only target', () => {
    const weakTarget = {
      actionType: 'click' as const,
      targetKind: 'result_card_link' as const,
      url: 'https://example.com/1',
      executionScope: 'session_url' as const,
      rect: { x: 20, y: -40, width: 120, height: 28 },
      center: { x: 80, y: 14 },
      coordinateFrame: 'viewport' as const,
      sourceScrollY: 0,
      confidence: 0.74,
      reasons: ['visible_detail_link_unverified_hit'],
    };
    const executableTarget = {
      actionType: 'click' as const,
      targetKind: 'result_card_link' as const,
      url: 'https://example.com/1',
      selector: 'article[data-id="1"] a[href]',
      executionScope: 'same_tab_fresh_snapshot' as const,
      toolName: 'chrome_click_element' as const,
      toolArgs: {
        candidateAction: {
          id: 'ca_click_ref_result_card_1',
          actionType: 'click' as const,
          targetRef: 'ref_result_card_1',
          label: 'First card',
          confidence: 0.9,
          matchReason: 'result_card_primary_link',
          intent: 'content.open_detail' as const,
          locatorChain: [
            { type: 'ref', value: 'ref_result_card_1' },
            { type: 'css', value: 'article[data-id="1"] a[href]' },
          ],
        },
      },
      rect: { x: 20, y: 40, width: 120, height: 28 },
      center: { x: 80, y: 54 },
      coordinateFrame: 'viewport' as const,
      sourceScrollY: 320,
      confidence: 0.9,
      reasons: ['title_link_match'],
    };

    const merged = mergeCollectedResultCards(
      [
        card({
          title: 'First card',
          url: 'https://example.com/1',
          actionTarget: weakTarget,
        }),
      ],
      [
        card({
          title: 'First card',
          url: 'https://example.com/1?utm=tracking',
          actionTarget: executableTarget,
        }),
      ],
      10,
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].actionTarget).toMatchObject({
      executionScope: 'same_tab_fresh_snapshot',
      toolName: 'chrome_click_element',
      toolArgs: {
        candidateAction: {
          targetRef: 'ref_result_card_1',
          intent: 'content.open_detail',
        },
      },
    });
  });
});

describe('summarizeCollectedResultCardTargetability', () => {
  it('reports how many collected cards have stable click targets', () => {
    const stableTarget = {
      actionType: 'click' as const,
      targetKind: 'result_card_link' as const,
      url: 'https://example.com/1',
      selector: 'article a[href]',
      executionScope: 'same_tab_fresh_snapshot' as const,
      toolName: 'chrome_click_element' as const,
      toolArgs: {
        candidateAction: {
          id: 'ca_click_ref_result_card_1',
          actionType: 'click' as const,
          targetRef: 'ref_result_card_1',
          label: 'First card',
          confidence: 0.9,
          matchReason: 'result_card_primary_link',
          intent: 'content.open_detail' as const,
          locatorChain: [
            { type: 'ref', value: 'ref_result_card_1' },
            { type: 'css', value: 'article a[href]' },
          ],
        },
      },
      confidence: 0.9,
      reasons: ['title_link_match'],
    };
    const cards = [
      card({ title: 'First card', url: 'https://example.com/1', actionTarget: stableTarget }),
      card({ title: 'Second card', url: 'https://example.com/2' }),
      card({ title: 'Third card', url: undefined }),
    ];

    expect(stableResultCardTarget(cards[0])).toEqual({
      targetRef: 'ref_result_card_1',
      candidateActionId: 'ca_click_ref_result_card_1',
    });
    expect(summarizeCollectedResultCardTargetability(cards)).toEqual({
      stableClickTargetCount: 1,
      urlFallbackCount: 1,
      untargetableCount: 1,
      targetRefCoverageRate: 0.3333,
      status: 'partial_stable_targets',
    });
  });
});
