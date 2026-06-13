import { describe, expect, it } from 'vitest';

import {
  type CollectedResultCard,
  mergeCollectedResultCards,
  resultCardKey,
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
});
