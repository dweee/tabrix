import { describe, expect, it } from 'vitest';
import { inferUserActivityLevel } from '../entrypoints/background/tools/browser/read-page-user-activity';

describe('read-page user activity inference', () => {
  it('reports active when the target tab is active in the focused window', async () => {
    await expect(
      inferUserActivityLevel({
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
        queryIdleState: async () => {
          throw new Error('idle state should not be queried');
        },
      }),
    ).resolves.toBe('active');
  });

  it('reports unknown when tab/window focus facts are missing', async () => {
    await expect(
      inferUserActivityLevel({
        isCurrentTabActive: null,
        isCurrentWindowFocused: true,
      }),
    ).resolves.toBe('unknown');
  });

  it('distinguishes recent system input from no observed user activity', async () => {
    await expect(
      inferUserActivityLevel({
        isCurrentTabActive: false,
        isCurrentWindowFocused: false,
        queryIdleState: async () => 'active',
      }),
    ).resolves.toBe('recent_input');

    await expect(
      inferUserActivityLevel({
        isCurrentTabActive: false,
        isCurrentWindowFocused: false,
        queryIdleState: async () => 'idle',
      }),
    ).resolves.toBe('none');
  });

  it('fails closed to none when idle state cannot be read', async () => {
    await expect(
      inferUserActivityLevel({
        isCurrentTabActive: false,
        isCurrentWindowFocused: false,
        queryIdleState: async () => {
          throw new Error('idle unavailable');
        },
      }),
    ).resolves.toBe('none');
  });
});
