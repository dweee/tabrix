import { describe, expect, it } from 'vitest';

import { isRestrictedResultCardCollectionPage } from '@/entrypoints/background/tools/browser/collect-result-cards';

describe('isRestrictedResultCardCollectionPage', () => {
  it('blocks verification pages before result-card collection scans DOM', () => {
    expect(
      isRestrictedResultCardCollectionPage({
        tab: {
          title: '安全验证',
          url: 'https://content.example/website-login/captcha?redirectPath=%2Fsearch_result',
        },
        browserWorldTab: {
          url: 'https://content.example/website-login/captcha',
          pendingUrl: '',
          title: '安全验证',
          canTabrixOperate: false,
          operabilityReason: 'user_verification_required',
          status: 'complete',
        },
      }),
    ).toBe(true);
  });

  it('allows normal search-result pages to be scanned', () => {
    expect(
      isRestrictedResultCardCollectionPage({
        tab: {
          title: 'AI image creation - search',
          url: 'https://content.example/search_result?keyword=ai-image-creation',
        },
        browserWorldTab: {
          url: 'https://content.example/search_result?keyword=ai-image-creation',
          pendingUrl: '',
          title: 'AI image creation - search',
          canTabrixOperate: true,
          operabilityReason: 'operable',
          status: 'complete',
        },
      }),
    ).toBe(false);
  });
});
