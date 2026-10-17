import type { BrowserUserActivityLevel } from '@tabrix/shared';

type BrowserIdleState = 'active' | 'idle' | 'locked';

export async function inferUserActivityLevel(input: {
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  queryIdleState?: ((thresholdSeconds: number) => Promise<BrowserIdleState>) | null;
}): Promise<BrowserUserActivityLevel> {
  if (input.isCurrentTabActive === true && input.isCurrentWindowFocused === true) {
    return 'active';
  }
  if (input.isCurrentTabActive === null || input.isCurrentWindowFocused === null) {
    return 'unknown';
  }

  try {
    const queryIdleState =
      input.queryIdleState ??
      (typeof chrome !== 'undefined' && typeof chrome.idle?.queryState === 'function'
        ? (thresholdSeconds: number) => chrome.idle.queryState(thresholdSeconds)
        : null);
    if (queryIdleState) {
      const state = await queryIdleState(15);
      if (state === 'active') return 'recent_input';
    }
  } catch (error) {
    void error;
  }

  return 'none';
}
