import { TOOL_NAMES } from '@tabrix/shared';
import { shouldInvalidateReadAfterInteraction } from './browser-action-readback';

describe('browser action readback interaction gating', () => {
  it('treats same-tab and history navigation as requiring a fresh readback', () => {
    expect(
      shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, {
        tabId: 42,
        url: 'https://example.com/results',
      }),
    ).toBe(true);
    expect(
      shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, {
        url: 'back',
      }),
    ).toBe(true);
    expect(
      shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, {
        refresh: true,
      }),
    ).toBe(true);
  });

  it('does not treat malformed navigation args as page-changing evidence', () => {
    expect(
      shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, {
        url: 'https://example.com/new-tab',
      }),
    ).toBe(false);
    expect(shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, {})).toBe(false);
    expect(shouldInvalidateReadAfterInteraction(TOOL_NAMES.BROWSER.NAVIGATE, null)).toBe(false);
  });
});
