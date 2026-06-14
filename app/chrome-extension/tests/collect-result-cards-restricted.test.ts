import { describe, expect, it } from 'vitest';

import { isRestrictedResultCardCollectionPage } from '@/entrypoints/background/tools/browser/collect-result-cards';

describe('isRestrictedResultCardCollectionPage', () => {
  it('blocks Xiaohongshu verification pages before result-card collection scans DOM', () => {
    expect(
      isRestrictedResultCardCollectionPage({
        tab: {
          title: '安全验证',
          url: 'https://www.xiaohongshu.com/website-login/captcha?redirectPath=%2Fsearch_result',
        },
        browserWorldTab: {
          url: 'https://www.xiaohongshu.com/website-login/captcha',
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
          title: 'AI图片创作 - 小红书搜索',
          url: 'https://www.xiaohongshu.com/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
        },
        browserWorldTab: {
          url: 'https://www.xiaohongshu.com/search_result?keyword=AI%E5%9B%BE%E7%89%87%E5%88%9B%E4%BD%9C',
          pendingUrl: '',
          title: 'AI图片创作 - 小红书搜索',
          canTabrixOperate: true,
          operabilityReason: 'operable',
          status: 'complete',
        },
      }),
    ).toBe(false);
  });
});
