import { describe, expect, it } from 'vitest';
import type { ReadPageCandidateAction, ReadPageInteractiveElement } from '@tabrix/shared';
import { buildCandidateActions } from '@/entrypoints/background/tools/browser/read-page-candidate-actions';
import { buildPageOperationMap } from '@/entrypoints/background/tools/browser/read-page-operation-map';

function element(overrides: Partial<ReadPageInteractiveElement>): ReadPageInteractiveElement {
  return {
    ref: overrides.ref ?? 'ref_1',
    role: overrides.role ?? 'button',
    name: overrides.name ?? 'Search',
    matchSource: overrides.matchSource ?? 'visible_text',
    actionability: overrides.actionability ?? 'actionable',
  };
}

describe('read_page candidate action intents', () => {
  it('marks search inputs as query entry without leaking their label into locatorChain', () => {
    const actions = buildCandidateActions(
      [element({ ref: 'ref_search_input', role: 'searchbox', name: 'Search projects' })],
      [{ ref: 'ref_search_input', selector: 'input[type="search"]' }],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'fill',
      targetRef: 'ref_search_input',
      intent: 'search.enter_query',
    });
    expect(actions[0].locatorChain).toEqual([
      { type: 'ref', value: 'ref_search_input' },
      { type: 'css', value: 'input[type="search"]' },
    ]);
  });

  it('marks search buttons as search submit while preserving auth intent precedence', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_search_button', role: 'button', name: 'Search' }),
        element({ ref: 'ref_login_button', role: 'button', name: 'Login' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_search_button')?.intent).toBe(
      'search.submit',
    );
    expect(actions.find((action) => action.targetRef === 'ref_login_button')?.intent).toBe(
      'auth.submit_login',
    );
  });

  it('does not turn placeholder-only action words into clickable search submit intent', () => {
    const actions = buildCandidateActions(
      [
        element({
          ref: 'ref_placeholder',
          role: 'button',
          name: 'Search',
          matchSource: 'placeholder',
        }),
      ],
      [],
    );

    expect(actions[0]).toMatchObject({
      actionType: 'click',
      targetRef: 'ref_placeholder',
    });
    expect(actions[0].intent).toBeUndefined();
  });

  it('preserves candidate action intent in derived operation-map executable actions', () => {
    const candidateAction: ReadPageCandidateAction = {
      id: 'ca_click_ref_search',
      actionType: 'click',
      targetRef: 'ref_search',
      confidence: 0.93,
      matchReason: 'primary action inferred from interactive label',
      locatorChain: [{ type: 'ref', value: 'ref_search' }],
      intent: 'search.submit',
    };

    const operationMap = buildPageOperationMap([], {
      candidateActions: [candidateAction],
      interactiveElements: [element({ ref: 'ref_search', role: 'button', name: 'Search' })],
    });

    const zone = operationMap.zones.find(
      (item) => item.zoneId === 'zone_search_entry_ca_click_ref_search',
    );
    expect(zone?.primaryAction?.toolArgs.candidateAction.intent).toBe('search.submit');
  });

  it('marks explicit detail links as detail-opening intent without treating search links as detail', () => {
    const actions = buildCandidateActions(
      [
        element({ ref: 'ref_detail', role: 'link', name: 'View details' }),
        element({ ref: 'ref_search', role: 'link', name: 'Search results' }),
      ],
      [],
    );

    expect(actions.find((action) => action.targetRef === 'ref_detail')?.intent).toBe(
      'content.open_detail',
    );
    expect(actions.find((action) => action.targetRef === 'ref_search')?.intent).toBe(
      'search.submit',
    );
  });
});
