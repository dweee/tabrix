import { describe, expect, it } from '@jest/globals';
import { TaskSessionContext } from './task-session-context';

describe('TaskSessionContext run-owned tab claims', () => {
  it('finalizes run-owned tab claims during cleanup before releasing ownership', () => {
    const context = new TaskSessionContext({ readBudget: 5 });

    context.noteRunOwnedTab(123, {
      aiRunId: 'run-1',
      aiClaimId: 'claim-123',
      aiClaimState: 'claimed',
      aiClaimedAtMs: 1000,
      aiClaimReason: 'native_background_navigation_claim',
    });

    context.noteCleanup({
      action: 'chrome_close_tabs',
      targetIds: [123],
    });
    context.releaseRunOwnedTab(123);

    expect(context.isRunOwnedTab(123)).toBe(false);
    expect(context.getRunOwnedTabClaim(123)).toEqual({
      aiRunId: 'run-1',
      aiClaimId: 'claim-123',
      aiClaimState: 'finalized',
      aiClaimedAtMs: 1000,
      aiFinalizedAtMs: expect.any(Number),
      aiClaimReason: 'chrome_close_tabs_cleanup',
    });
  });
});
