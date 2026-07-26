import { describe, expect, it } from 'vitest';
import type { ReadPageCandidateAction, ReadPageInteractiveElement } from '@tabrix/shared';
import { buildGlobalMenuRegionObjects } from '@/entrypoints/background/tools/browser/read-page-global-menu-objects';
import { buildPageOperationMap } from '@/entrypoints/background/tools/browser/read-page-operation-map';

function completeCandidateAction(
  overrides: Partial<ReadPageCandidateAction> = {},
): ReadPageCandidateAction {
  return {
    id: 'ca_click_ref_search',
    actionType: 'click',
    targetRef: 'ref_search',
    label: 'Search',
    frameId: 7,
    confidence: 0.93,
    matchReason: 'visible search action from the current structured snapshot',
    actionability: 'actionable',
    actionabilityReason: 'visible and unobstructed in the current snapshot',
    intentBoundary: 'search submission still requires post-action verification',
    nextRequiredTool: 'chrome_read_page',
    nextRequiredSelector: '[data-results]',
    nextRequiredSelectorSource: 'dom_snapshot',
    nextRequiredCheck: 'run a fresh same-tab read',
    snapshotRect: { x: 120, y: 48, width: 240, height: 40 },
    locatorChain: [
      { type: 'ref', value: 'ref_search' },
      { type: 'css', value: '[data-action="search"]' },
    ],
    intent: 'search.submit',
    visibility: {
      source: 'mixed',
      domVisible: true,
      inViewport: true,
      centerHitTarget: true,
      occluded: false,
      reason: 'current viewport hit-test matched the target',
    },
    ...overrides,
  };
}

function menuElement(ref: string, name: string, index: number): ReadPageInteractiveElement {
  return {
    ref,
    role: 'button',
    name,
    actionability: 'actionable',
    rect: { x: 24, y: 72 + index * 48, width: 160, height: 40 },
  };
}

describe('read_page executable action projection contract', () => {
  it('preserves complete candidate execution evidence in derived operation-map actions', () => {
    const candidateAction = completeCandidateAction();

    const operationMap = buildPageOperationMap([], {
      candidateActions: [candidateAction],
      interactiveElements: [
        {
          ref: candidateAction.targetRef,
          role: 'button',
          name: candidateAction.label ?? '',
        },
      ],
    });

    const searchZone = operationMap.zones.find(
      (zone) => zone.primaryAction?.candidateActionId === candidateAction.id,
    );
    expect(searchZone?.primaryAction?.toolArgs.candidateAction).toEqual(candidateAction);
  });

  it('preserves complete candidate execution evidence in global-menu object actions', () => {
    const elements = [
      menuElement('ref_home', 'Home', 0),
      menuElement('ref_search', 'Search', 1),
      menuElement('ref_messages', 'Messages', 2),
      menuElement('ref_more', 'More', 3),
    ];
    const candidateAction = completeCandidateAction();
    const otherActions = elements
      .filter((element) => element.ref !== candidateAction.targetRef)
      .map((element) =>
        completeCandidateAction({
          id: `ca_click_${element.ref}`,
          targetRef: element.ref,
          label: element.name,
          frameId: undefined,
          snapshotRect: element.rect,
          locatorChain: [{ type: 'ref', value: element.ref }],
          intent: 'navigation.open',
        }),
      );
    const actions = [candidateAction, ...otherActions];
    const candidateByTargetRef = new Map<string, ReadPageCandidateAction[]>();
    for (const action of actions) {
      candidateByTargetRef.set(action.targetRef, [action]);
    }

    const objects = buildGlobalMenuRegionObjects({
      interactiveElements: elements,
      candidateByTargetRef,
      aiFacingCandidateByTargetRef: candidateByTargetRef,
      viewport: { width: 1280, height: 720, dpr: 1 },
    });

    const searchObject = objects.find((object) => object.targetRef === candidateAction.targetRef);
    expect(searchObject?.primaryAction?.toolArgs.candidateAction).toEqual(candidateAction);
  });
});
