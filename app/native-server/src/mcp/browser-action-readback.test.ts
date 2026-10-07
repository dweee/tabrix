import { TOOL_NAMES } from '@tabrix/shared';
import {
  buildPostActionDeltaSignalsFromEvidence,
  shouldInvalidateReadAfterInteraction,
  shouldInvalidateReadForRequiredReadback,
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

  it('invalidates cached reads when an uncertain action requires same-tab readback', () => {
    expect(
      shouldInvalidateReadForRequiredReadback(
        TOOL_NAMES.BROWSER.CLICK,
        { tabId: 42, ref: 'ref_filter_option' },
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                dispatchSucceeded: false,
                error: 'click_helper_response_timeout',
                postActionReadback: {
                  freshReadRequired: true,
                  sameTabVerificationRequired: true,
                },
              }),
            },
          ],
          isError: false,
        },
      ),
    ).toBe(true);
  });

  it('does not invalidate cached reads for a failed action with no readback requirement', () => {
    expect(
      shouldInvalidateReadForRequiredReadback(
        TOOL_NAMES.BROWSER.CLICK,
        { tabId: 42, ref: 'ref_missing' },
        {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                dispatchSucceeded: false,
                postActionReadback: {
                  freshReadRequired: false,
                  sameTabVerificationRequired: true,
                },
              }),
            },
          ],
          isError: false,
        },
      ),
    ).toBe(false);
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
