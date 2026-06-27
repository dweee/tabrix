import { TOOL_NAMES } from '@tabrix/shared';
import {
  buildPostActionDeltaSignalsFromEvidence,
  shouldInvalidateReadAfterInteraction,
} from './browser-action-readback';

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

describe('post-action delta signal readback', () => {
  it('preserves bounded target state changes and drops malformed changes', () => {
    const signals = buildPostActionDeltaSignalsFromEvidence({
      targetObjectId: 'obj-card-1',
      observedChangeKind: 'target_state_changed',
      objectDelta: {
        status: 'observed',
        changedObjectIds: ['obj-card-1'],
        targetStateChanges: [
          {
            targetId: 'target-open-card',
            objectId: 'obj-card-1',
            changeKind: 'actionability_and_visibility',
            beforeActionability: 'blocked',
            afterActionability: 'actionable',
            beforeVisibility: {
              domVisible: true,
              inViewport: false,
              centerHitTarget: null,
              occluded: null,
            },
            afterVisibility: {
              domVisible: true,
              inViewport: true,
              centerHitTarget: true,
              occluded: false,
            },
          },
          {
            targetId: 'target-bad',
            objectId: 'obj-bad',
            changeKind: 'unexpected',
          },
        ],
      },
    } as never);

    expect(signals.objectDelta).toMatchObject({
      status: 'observed',
      changedObjectIds: ['obj-card-1'],
      targetStateChanges: [
        {
          targetId: 'target-open-card',
          objectId: 'obj-card-1',
          changeKind: 'actionability_and_visibility',
          beforeActionability: 'blocked',
          afterActionability: 'actionable',
          beforeVisibility: {
            domVisible: true,
            inViewport: false,
            centerHitTarget: null,
            occluded: null,
          },
          afterVisibility: {
            domVisible: true,
            inViewport: true,
            centerHitTarget: true,
            occluded: false,
          },
        },
      ],
    });
  });
});
