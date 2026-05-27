import { describe, expect, it } from 'vitest';

import {
  buildReadPageBrowserPageObjectView,
  buildReadPageObjectLifecycle,
  type BrowserPageThingProjection,
  type ReadPageOperationMap,
  type ReadPageObjectLifecycleSummary,
  type ReadPageOwnershipRuntimeSummary,
  type ReadPageRegion,
} from '@tabrix/shared';

function region(overrides: Partial<ReadPageRegion>): ReadPageRegion {
  return {
    regionId: 'region_unknown',
    regionType: 'unknown',
    state: 'unknown',
    confidence: 0.5,
    objects: [],
    candidateActionIds: [],
    targetability: 'unknown',
    claimBoundary: 'region candidate only',
    ...overrides,
  };
}

function operationMap(overrides: Partial<ReadPageOperationMap> = {}): ReadPageOperationMap {
  return {
    summary: 'operation map candidate only',
    zones: [],
    claimBoundary: 'operation map candidate only',
    ...overrides,
  };
}

function pageProjection(
  overrides: Partial<BrowserPageThingProjection> = {},
): BrowserPageThingProjection {
  return {
    projectionId: 'projection_test',
    projectionKind: 'read_snapshot_projection',
    projectionCreatedAt: '2026-05-27T00:00:00.000Z',
    sourceObservedAt: '2026-05-27T00:00:00.000Z',
    sourceLineage: 'dom',
    regionEvidenceRefs: [],
    pageId: 'tab:42',
    tabId: 42,
    ownerType: 'run_owned',
    readiness: 'ready',
    stability: 'stable',
    contextVersion: 'ctx_1',
    previousContextVersion: null,
    changedByActionId: null,
    changeCause: 'unknown',
    activeRegion: 'viewport',
    changedRegions: [],
    reusedRegions: [],
    invalidatedRefs: [],
    refreshedRefs: [],
    chosenDataSource: 'dom_region_rows',
    sourceConfidence: 0.82,
    sourceFreshness: 'fresh',
    contextChars: 120,
    contextSavedChars: 0,
    userActivityLevel: 'unknown',
    interferenceRisk: 'medium',
    sourceTruthChain: {
      primaryOrigin: 'dom',
      provenanceCreatedAt: '2026-05-27T00:00:00.000Z',
      fieldProvenances: [],
    },
    ...overrides,
  };
}

function ownershipRuntime(
  overrides: Partial<ReadPageOwnershipRuntimeSummary> = {},
): ReadPageOwnershipRuntimeSummary {
  return {
    currentTabId: 42,
    currentWindowId: 7,
    currentWindowState: 'normal',
    currentWindowWidth: 1280,
    currentWindowHeight: 720,
    currentWindowLeft: 10,
    currentWindowTop: 20,
    isCurrentTabActive: true,
    isCurrentWindowFocused: true,
    browserActiveTabId: 42,
    browserActiveTabIdKnown: true,
    isReadTargetBrowserActiveTab: true,
    currentOwnerType: 'run_owned',
    currentTabRunOwnershipVerdict: 'run_owned_by_task',
    currentTabPrimaryRelationVerdict: 'current_tab_is_primary',
    protectedScopeVerdict: 'protected',
    cleanupEligibility: 'not_eligible',
    protectReason: 'current_tab_is_primary',
    isCurrentTabRunOwnedByTask: true,
    runOwnedTabIds: [42],
    runOwnedTabCount: 1,
    defaultProtection: 'protect_unknown_and_user_owned',
    bridgeState: 'READY',
    primaryTabId: 42,
    primaryTabReuseRate: 1,
    benchmarkOwnedTabCount: 1,
    heartbeatTabCount: 2,
    heartbeatWindowCount: 1,
    ...overrides,
  };
}

describe('read_page object lifecycle', () => {
  it('derives redacted object families from page regions without carrying private labels', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_account',
        regionType: 'account',
        state: 'logged_in_candidate',
        targetability: 'not_clickable',
        objects: [
          {
            objectId: 'private_profile',
            label: 'Private Name',
            objectType: 'identity_badge',
            actionTypes: [],
            targetability: 'not_clickable',
            confidence: 0.8,
            reason: 'visible account signal',
          },
        ],
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        targetability: 'not_clickable',
        objects: [
          {
            objectId: 'qr_visual',
            label: 'sensitive QR payload',
            objectType: 'qr_visual',
            locatorChain: [{ type: 'css', value: '#qr' }],
            actionTypes: [],
            targetability: 'locator_chain',
            confidence: 0.9,
            reason: 'visual QR candidate',
          },
        ],
      }),
    ]);

    expect(lifecycle.status).toBe('single_snapshot');
    expect(lifecycle.changes).toEqual([]);
    expect(lifecycle.items.map((item) => item.objectFamily)).toEqual(
      expect.arrayContaining(['account_identity', 'qr_code']),
    );
    expect(JSON.stringify(lifecycle)).not.toContain('Private Name');
    expect(JSON.stringify(lifecycle)).not.toContain('private_profile');
    expect(JSON.stringify(lifecycle)).not.toContain('sensitive QR payload');
    expect(lifecycle.claimBoundary).toContain('not proof of completion');
  });

  it('compares fresh before and after region snapshots conservatively', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
    ]);

    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_menu',
          regionType: 'menu',
          state: 'action_available_candidate',
          targetability: 'target_ref',
          candidateActionIds: ['ca_logout'],
          objects: [
            {
              objectId: 'ref_more',
              label: 'More',
              menuItemRole: 'overflow_menu_trigger',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu trigger candidate',
            },
            {
              objectId: 'ref_logout',
              label: 'Sign out',
              menuItemRole: 'secondary_menu_action',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu action candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    expect(after.status).toBe('compared_snapshot');
    expect(after.changedObjectCount).toBeGreaterThan(0);
    expect(after.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: 'region:menu:region_menu',
          changeKind: 'changed',
          beforeState: 'collapsed_or_expandable_candidate',
          afterState: 'action_available_candidate',
        }),
        expect.objectContaining({
          objectKey: 'object:menu:ref_logout',
          changeKind: 'appeared',
        }),
      ]),
    );
    expect(after.claimBoundary).toContain('not login, logout, purchase');
  });

  it('condenses menu object changes into an AI-facing menu_expanded event', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_menu',
          regionType: 'menu',
          state: 'action_available_candidate',
          targetability: 'target_ref',
          candidateActionIds: ['ca_action_1', 'ca_action_2'],
          objects: [
            {
              objectId: 'ref_more',
              label: 'More',
              menuItemRole: 'overflow_menu_trigger',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu trigger candidate',
            },
            {
              objectId: 'ref_action_1',
              label: 'Action 1',
              menuItemRole: 'secondary_menu_action',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu action candidate',
            },
            {
              objectId: 'ref_action_2',
              label: 'Action 2',
              menuItemRole: 'secondary_menu_action',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu action candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({
      pageRegions: [],
      objectLifecycle: after,
      selectedDataSource: 'dom_json',
      sourceRouteHonestyVerdict: 'dom_fallback',
    });

    expect(view.rawLifecycleStats.changedObjectCount).toBeGreaterThan(1);
    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'menu_expanded',
          targetGroup: 'menu_state',
          postconditionStatus: 'candidate_only',
        }),
      ]),
    );
    expect(JSON.stringify(view)).not.toContain('Action 1');
    expect(view.attributeGroups.evidence_state.summary).toContain('dom_fallback');
    expect(view.attributeGroups.task_relation.summary).toContain('Menu expanded candidate');
    expect(view.attributeGroups.task_relation.summary).toContain('menu action(s) appeared');
    expect(view.attributeGroups.task_relation.summary).not.toContain('menu action object');
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('Menu expanded candidate'),
      changedGroups: expect.arrayContaining(['menu_state']),
      transitionCount: expect.any(Number),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('Menu expanded candidate');
    expect(view.dynamicAttributeSummary?.summary).toContain('Postcondition verification');
  });

  it('summarizes noisy object changes as changed attribute groups instead of raw object counts', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_form',
        regionType: 'form',
        state: 'empty_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_query',
            label: 'Search',
            objectType: 'field',
            actionTypes: ['fill'],
            targetability: 'target_ref',
            confidence: 0.72,
            reason: 'form field candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_form',
          regionType: 'form',
          state: 'input_changed_candidate',
          targetability: 'target_ref',
          objects: [
            {
              objectId: 'ref_query',
              label: 'Search',
              objectType: 'field',
              actionTypes: ['fill'],
              targetability: 'target_ref',
              confidence: 0.72,
              reason: 'form field candidate',
            },
            {
              objectId: 'ref_status',
              label: 'Saved',
              objectType: 'status',
              actionTypes: [],
              targetability: 'not_clickable',
              confidence: 0.68,
              reason: 'feedback candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: after,
    });

    expect(view.rawLifecycleStats.changedObjectCount).toBeGreaterThan(0);
    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'content_changed',
          targetGroup: 'action_state',
          targetObjectFamily: 'form_control',
          postconditionStatus: 'unknown',
          summary: expect.stringContaining('form/search outcome is not proven'),
        }),
      ]),
    );
    expect(view.attributeGroups.task_relation.summary).toContain(
      'form/search outcome is not proven',
    );
    expect(view.attributeGroups.task_relation.summary).not.toContain('low-level object change');
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'form/search outcome is not proven',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toContain('low-level object');
  });

  it('summarizes appeared content areas as a content panel reveal candidate', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'collapsed_candidate',
        targetability: 'not_clickable',
        objects: [],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_content',
          regionType: 'content',
          state: 'expanded_candidate',
          targetability: 'not_clickable',
          objects: [
            {
              objectId: 'ref_panel_body',
              label: 'Panel body',
              objectType: 'article',
              actionTypes: [],
              targetability: 'not_clickable',
              confidence: 0.7,
              reason: 'content area candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({
      pageRegions: [],
      objectLifecycle: after,
      selectedDataSource: 'dom_json',
      sourceRouteHonestyVerdict: 'dom_fallback',
    });

    expect(view.rawLifecycleStats.changedObjectCount).toBeGreaterThan(0);
    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'content_changed',
          targetGroup: 'content_state',
          targetObjectFamily: 'content_collection',
          summary: expect.stringContaining('Content/panel'),
          postconditionStatus: 'candidate_only',
        }),
      ]),
    );
    expect(view.attributeGroups.task_relation.summary).toContain(
      'Content/panel visibility changed candidate',
    );
    expect(view.attributeGroups.task_relation.summary).not.toMatch(/\d+ content area/);
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain('Content/panel');
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain('postcondition verification');
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toMatch(/\d+ content area/);
    expect(JSON.stringify(view)).not.toContain('Panel body');
  });

  it('summarizes menu content and action groups as AI-usable conclusions', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        candidateActionIds: ['ca_open_menu'],
        objects: [
          {
            objectId: 'ref_menu',
            label: 'Menu trigger',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        targetability: 'not_clickable',
        objects: [
          {
            objectId: 'ref_article',
            label: 'Article body',
            objectType: 'article',
            actionTypes: [],
            targetability: 'not_clickable',
            confidence: 0.7,
            reason: 'content candidate',
          },
        ],
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageOperationMap: operationMap({
        zones: [
          {
            zoneId: 'zone_menu',
            regionId: 'region_menu',
            regionType: 'menu',
            purpose: 'open_menu',
            label: 'Menu',
            state: 'collapsed_or_expandable_candidate',
            readiness: 'ready',
            targetability: 'target_ref',
            candidateActionIds: ['ca_open_menu'],
            evidenceLevel: 'candidate',
            claimBoundary: 'candidate only',
          },
          {
            zoneId: 'zone_content',
            regionId: 'region_content',
            regionType: 'content',
            purpose: 'read_content',
            label: 'Content',
            state: 'content_available_candidate',
            readiness: 'ready',
            targetability: 'not_clickable',
            candidateActionIds: [],
            evidenceLevel: 'candidate',
            claimBoundary: 'candidate only',
          },
        ],
      }),
    });

    expect(view.attributeGroups.menu_state.summary).toContain('Menu/navigation visible');
    expect(view.attributeGroups.menu_state.summary).not.toContain('menu_state:');
    expect(view.attributeGroups.content_state.summary).toContain('Content visible');
    expect(view.attributeGroups.content_state.summary).not.toContain('content_state:');
    expect(view.attributeGroups.action_state.summary).toContain('Ready operation purposes');
    expect(view.attributeGroups.action_state.summary).toContain('open_menu');
    expect(view.attributeGroups.action_state.summary).toContain('read_content');
    expect(view.attributeGroups.action_state.summary).not.toContain('operation zone(s)');
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'single_snapshot_only',
      primaryConclusion: expect.stringContaining('Current BrowserPageObject snapshot'),
      changedGroups: [],
      transitionCount: 0,
    });
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain('Menu/navigation visible');
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain('Ready operation purposes');
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'No before/after dynamic transition is proven',
    );
    expect(view.dynamicAttributeSummary?.summary).toContain('Single snapshot only');
  });

  it('keeps account-like handles and numeric stats out of visible menu entry summaries', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_navigation',
        regionType: 'navigation',
        state: 'global_menu_available_candidate',
        layoutHint: 'bottom_navigation',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_handle',
            label: '@example_user',
            role: 'link',
            actionTypes: ['click'],
            targetability: 'locator_chain',
            confidence: 0.7,
            reason: 'content link candidate',
          },
          {
            objectId: 'ref_count',
            label: '35,786',
            role: 'link',
            actionTypes: ['click'],
            targetability: 'locator_chain',
            confidence: 0.7,
            reason: 'numeric stats candidate',
          },
          {
            objectId: 'ref_repositories',
            label: 'Repositories',
            role: 'link',
            menuItemRole: 'primary_navigation',
            actionTypes: ['click'],
            targetability: 'locator_chain',
            confidence: 0.82,
            reason: 'navigation item candidate',
          },
          {
            objectId: 'ref_trending',
            label: 'Trending',
            role: 'link',
            menuItemRole: 'primary_navigation',
            actionTypes: ['click'],
            targetability: 'locator_chain',
            confidence: 0.82,
            reason: 'navigation item candidate',
          },
        ],
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageRegions: lifecycle.items.length
        ? [
            region({
              regionId: 'region_navigation',
              regionType: 'navigation',
              state: 'global_menu_available_candidate',
              layoutHint: 'bottom_navigation',
              targetability: 'locator_chain',
              objects: [
                {
                  objectId: 'ref_handle',
                  label: '@example_user',
                  role: 'link',
                  actionTypes: ['click'],
                  targetability: 'locator_chain',
                  confidence: 0.7,
                  reason: 'content link candidate',
                },
                {
                  objectId: 'ref_count',
                  label: '35,786',
                  role: 'link',
                  actionTypes: ['click'],
                  targetability: 'locator_chain',
                  confidence: 0.7,
                  reason: 'numeric stats candidate',
                },
                {
                  objectId: 'ref_repositories',
                  label: 'Repositories',
                  role: 'link',
                  menuItemRole: 'primary_navigation',
                  actionTypes: ['click'],
                  targetability: 'locator_chain',
                  confidence: 0.82,
                  reason: 'navigation item candidate',
                },
                {
                  objectId: 'ref_trending',
                  label: 'Trending',
                  role: 'link',
                  menuItemRole: 'primary_navigation',
                  actionTypes: ['click'],
                  targetability: 'locator_chain',
                  confidence: 0.82,
                  reason: 'navigation item candidate',
                },
              ],
            }),
          ]
        : [],
    });

    const summary = view.attributeGroups.menu_state.summary;
    expect(summary).toContain('Repositories');
    expect(summary).toContain('Trending');
    expect(summary).not.toContain('@example_user');
    expect(summary).not.toContain('35,786');
  });

  it('surfaces existing page projection action linkage as candidate evidence only', () => {
    const pageRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_menu',
            label: 'Private Workspace Menu',
            objectType: 'control',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.82,
            reason: 'visible menu trigger candidate',
          },
        ],
      }),
    ];
    const lifecycle = buildReadPageObjectLifecycle(pageRegions);
    const previousProjection = pageProjection({
      projectionId: 'projection_before',
      contextVersion: 'ctx_before',
      changedByActionId: null,
      changeCause: 'unknown',
    });
    const currentProjection = pageProjection({
      projectionId: 'projection_after',
      contextVersion: 'ctx_after',
      previousContextVersion: 'ctx_before',
      changedByActionId: 'chrome_click_element',
      changeCause: 'click',
      invalidatedRefs: ['ref_menu'],
    });

    const view = buildReadPageBrowserPageObjectView({
      pageRegions,
      objectLifecycle: lifecycle,
      previousPageProjection: previousProjection,
      pageProjection: currentProjection,
      pageOperationMap: operationMap(),
    });

    expect(view.attributeGroups.action_state.status).toBe('action_linkage_candidate');
    expect(view.attributeGroups.action_state.summary).toContain(
      'Last action linkage candidate: chrome_click_element caused click on target ref_menu (menu trigger candidate)',
    );
    expect(view.attributeGroups.action_state.summary).toContain(
      'verify postcondition before claiming success',
    );
    expect(view.attributeGroups.action_state.summary).not.toContain('Private Workspace Menu');
    expect(view.attributeGroups.action_state.facts).toMatchObject({
      lastActionId: 'chrome_click_element',
      lastChangeCause: 'click',
      lastTargetRefs: ['ref_menu'],
      lastTargetRoles: ['menu trigger candidate'],
    });
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'page_transition_candidate',
      changedGroups: expect.arrayContaining(['action_state', 'task_relation']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('last action linkage candidate');
    expect(view.dynamicAttributeSummary?.summary).toContain('on target ref_menu');
    expect(view.dynamicAttributeSummary?.claimBoundary).toContain('candidate evidence only');
  });

  it('links a verified semantic transition candidate to the preceding safe target action', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            objectType: 'control',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.82,
            reason: 'visible menu trigger candidate',
          },
        ],
      }),
    ]);
    const expandedRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'action_available_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            objectType: 'control',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.82,
            reason: 'visible menu trigger candidate',
          },
          {
            objectId: 'ref_private_account',
            label: 'secret.owner@example.com',
            objectType: 'identity_badge',
            menuItemRole: 'account_entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.6,
            reason: 'private account candidate',
          },
          {
            objectId: 'ref_settings',
            label: 'Settings',
            objectType: 'control',
            menuItemRole: 'secondary_menu_action',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.78,
            reason: 'menu action candidate',
          },
        ],
      }),
    ];
    const after = buildReadPageObjectLifecycle(expandedRegions, { previous: before });
    const view = buildReadPageBrowserPageObjectView({
      pageRegions: expandedRegions,
      objectLifecycle: after,
      previousPageProjection: pageProjection({
        projectionId: 'projection_before',
        contextVersion: 'ctx_before',
      }),
      pageProjection: pageProjection({
        projectionId: 'projection_after',
        contextVersion: 'ctx_after',
        previousContextVersion: 'ctx_before',
        changedByActionId: 'chrome_click_element',
        changeCause: 'click',
        invalidatedRefs: ['ref_more'],
      }),
      pageOperationMap: operationMap(),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('Action-linked semantic change candidate'),
      changedGroups: expect.arrayContaining(['menu_state', 'action_state']),
    });
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'chrome_click_element on target ref_more (menu trigger candidate)',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'was followed by a menu expanded candidate',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'postcondition verification is still required',
    );
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'Action-linked semantic change candidate',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toContain('secret.owner');
  });

  it('describes linked action targets by safe generic role without leaking account labels', () => {
    const pageRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_account',
        regionType: 'account',
        state: 'visible_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_private_account',
            label: 'secret.owner@example.com',
            objectType: 'identity_badge',
            menuItemRole: 'account_entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.78,
            reason: 'account entry candidate',
          },
        ],
      }),
    ];
    const lifecycle = buildReadPageObjectLifecycle(pageRegions);
    const view = buildReadPageBrowserPageObjectView({
      pageRegions,
      objectLifecycle: lifecycle,
      pageProjection: pageProjection({
        changedByActionId: 'chrome_click_element',
        changeCause: 'click',
        invalidatedRefs: ['ref_private_account'],
      }),
      pageOperationMap: operationMap(),
    });

    expect(view.attributeGroups.action_state.summary).toContain(
      'ref_private_account (account entry candidate)',
    );
    expect(view.attributeGroups.action_state.summary).not.toContain('secret.owner');
    expect(view.attributeGroups.action_state.facts).toMatchObject({
      lastTargetRefs: ['ref_private_account'],
      lastTargetRoles: ['account entry candidate'],
    });
  });

  it('keeps attempted target linkage separate from verified page-change success', () => {
    const pageRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_unknown',
        regionType: 'unknown',
        state: 'unknown',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'tgt_generic',
            label: 'Private Visible Label',
            objectType: 'entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.55,
            reason: 'generic target candidate',
          },
        ],
      }),
    ];
    const lifecycle = buildReadPageObjectLifecycle(pageRegions);
    const view = buildReadPageBrowserPageObjectView({
      pageRegions,
      objectLifecycle: lifecycle,
      pageProjection: pageProjection({
        changedByActionId: 'chrome_click_element',
        changeCause: 'unknown',
        invalidatedRefs: ['tgt_generic'],
      }),
      pageOperationMap: operationMap(),
    });

    expect(view.attributeGroups.action_state.summary).toContain(
      'chrome_click_element attempted on target tgt_generic (page target candidate)',
    );
    expect(view.attributeGroups.action_state.summary).toContain(
      'no verified page-change cause was proven',
    );
    expect(view.attributeGroups.action_state.summary).toContain(
      'verify postcondition before claiming success',
    );
    expect(view.attributeGroups.action_state.summary).not.toContain('caused click');
    expect(view.attributeGroups.action_state.summary).not.toContain('Private Visible Label');
  });

  it('lists safe visible navigation labels without leaking account or auth labels', () => {
    const pageRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_left_nav',
        regionType: 'navigation',
        state: 'visible_candidate',
        layoutHint: 'left_sidebar',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_home',
            label: 'Home',
            objectType: 'nav_entry',
            menuItemRole: 'primary_navigation',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.9,
            reason: 'visible nav entry',
          },
          {
            objectId: 'ref_messages',
            label: 'Messages',
            objectType: 'nav_entry',
            menuItemRole: 'primary_navigation',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.9,
            reason: 'visible nav entry',
          },
          {
            objectId: 'ref_more',
            label: 'More',
            objectType: 'control',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.85,
            reason: 'visible menu trigger',
          },
          {
            objectId: 'ref_private_account',
            label: 'private.user@example.com',
            objectType: 'identity_badge',
            menuItemRole: 'account_entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.7,
            reason: 'visible account entry',
          },
          {
            objectId: 'ref_login',
            label: 'Sign in',
            objectType: 'control',
            menuItemRole: 'auth_entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.7,
            reason: 'visible auth entry',
          },
        ],
      }),
    ];
    const lifecycle = buildReadPageObjectLifecycle(pageRegions);

    const view = buildReadPageBrowserPageObjectView({
      pageRegions,
      objectLifecycle: lifecycle,
    });

    expect(view.attributeGroups.menu_state.summary).toContain(
      'Visible entries: Home, Messages, More.',
    );
    expect(view.attributeGroups.menu_state.summary).toContain('Layout: left_sidebar.');
    expect(view.attributeGroups.menu_state.summary).not.toContain('private.user');
    expect(view.attributeGroups.menu_state.summary).not.toContain('Sign in');
    expect(view.attributeGroups.menu_state.summary).not.toContain('ref_private_account');
  });

  it('includes safe visible menu entries in menu expansion dynamic summaries', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
    ]);
    const expandedRegions: ReadPageRegion[] = [
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'action_available_candidate',
        targetability: 'target_ref',
        layoutHint: 'left_sidebar',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
          {
            objectId: 'ref_settings',
            label: 'Settings',
            menuItemRole: 'secondary_menu_action',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu action candidate',
          },
          {
            objectId: 'ref_help',
            label: 'Help',
            menuItemRole: 'secondary_menu_action',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu action candidate',
          },
          {
            objectId: 'ref_account',
            label: 'private.user@example.com',
            objectType: 'identity_badge',
            menuItemRole: 'account_entry',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.7,
            reason: 'account candidate',
          },
        ],
      }),
    ];
    const after = buildReadPageObjectLifecycle(expandedRegions, { previous: before });

    const view = buildReadPageBrowserPageObjectView({
      pageRegions: expandedRegions,
      objectLifecycle: after,
    });

    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'menu_expanded',
          summary: expect.stringContaining('Current visible entries: More, Settings, Help.'),
        }),
      ]),
    );
    expect(view.semanticEvents[0].summary).not.toContain('private.user');
    expect(view.attributeGroups.task_relation.summary).toContain('State changes:');
    expect(view.attributeGroups.task_relation.summary).toContain('menu_state');
    expect(view.attributeGroups.task_relation.summary).not.toContain('raw changedObjectCount');
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('Current visible entries: More, Settings, Help.'),
      changedGroups: expect.arrayContaining(['menu_state']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'Current visible entries: More, Settings, Help.',
    );
    expect(view.dynamicAttributeSummary?.summary).not.toContain('private.user');
  });

  it('summarizes window tab page and visual reliability runtime groups', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      ownershipRuntime: ownershipRuntime(),
      selectedDataSource: 'dom_region_rows',
    });

    expect(view.attributeGroups.window_state.summary).toContain('window 7');
    expect(view.attributeGroups.window_state.summary).toContain('state=normal');
    expect(view.attributeGroups.window_state.summary).toContain('focus=true');
    expect(view.attributeGroups.window_state.summary).toContain('readTargetTab=42');
    expect(view.attributeGroups.window_state.summary).toContain('browserActiveTab=42');
    expect(view.attributeGroups.window_state.summary).toContain('readTargetIsBrowserActive=true');
    expect(view.attributeGroups.window_state.summary).toContain('size=1280x720');
    expect(view.attributeGroups.window_state.facts).toMatchObject({
      objectKind: 'BrowserWindowObject',
      currentWindowId: 7,
      readTargetTabId: 42,
      currentActiveTabId: 42,
      browserActiveTabId: 42,
      browserActiveTabIdKnown: true,
      isReadTargetBrowserActiveTab: true,
      currentWindowState: 'normal',
      isFocused: true,
      isMinimized: false,
      width: 1280,
      height: 720,
      heartbeatTabCount: 2,
      heartbeatWindowCount: 1,
    });
    expect(view.attributeGroups.tab_state.summary).toContain('readTargetTab=42');
    expect(view.attributeGroups.tab_state.summary).toContain('browserActiveTab=42');
    expect(view.attributeGroups.tab_state.summary).toContain('readTargetIsBrowserActive=true');
    expect(view.attributeGroups.tab_state.summary).toContain('primaryRunTab=42');
    expect(view.attributeGroups.tab_state.summary).toContain('owner=run_owned');
    expect(view.attributeGroups.tab_state.facts).toMatchObject({
      objectKind: 'BrowserTabObject',
      readTargetTabId: 42,
      currentTabId: 42,
      primaryRunTabId: 42,
      primaryTabId: 42,
      browserActiveTabId: 42,
      isReadTargetTabActive: true,
      isReadTargetBrowserActiveTab: true,
      isActive: true,
      ownerType: 'run_owned',
      cleanupEligibility: 'not_eligible',
      protectedScopeVerdict: 'protected',
      readTargetPrimaryRelationVerdict: 'current_tab_is_primary',
      isRunOwnedByTask: true,
      runOwnedTabCount: 1,
      runOwnedTabIds: [42],
    });
    expect(view.attributeGroups.page_state.summary).toContain('readiness=ready');
    expect(view.attributeGroups.page_state.summary).toContain('sourceFreshness=fresh');
    expect(view.attributeGroups.page_state.facts).toMatchObject({
      objectKind: 'BrowserPageObject',
      pageId: 'tab:42',
      tabId: 42,
      readiness: 'ready',
      stability: 'stable',
      sourceFreshness: 'fresh',
      activeRegion: 'viewport',
      contextChars: 120,
      sourceConfidence: 0.82,
      userActivityLevel: 'unknown',
      interferenceRisk: 'medium',
    });
    expect(view.attributeGroups.visual_reliability.status).toBe('candidate_reliable');
    expect(view.attributeGroups.visual_reliability.summary).toContain('fresh capture');
    expect(view.attributeGroups.visual_reliability.facts).toMatchObject({
      objectKind: 'BrowserVisualReliability',
      isCurrentWindowFocused: true,
      isReadTargetTabActive: true,
      isCurrentTabActive: true,
      currentWindowState: 'normal',
      isWindowMinimized: false,
      visualReliabilityCandidate: true,
      degraded: false,
      claimScreenshotProofAllowed: false,
    });
    expect(view.attributeGroups.runtime_state.summary).toContain(
      'selectedDataSource=dom_region_rows',
    );
    expect(view.compact).toMatchObject({
      source: 'read_page_browser_page_object_compact',
      rootObjectId: view.rootObjectId,
      watchStatus: 'single_snapshot_only',
      primaryConclusion: expect.stringContaining('Current BrowserPageObject snapshot'),
      facts: {
        window: expect.objectContaining({
          objectKind: 'BrowserWindowObject',
          exists: true,
          currentWindowId: 7,
          readTargetTabId: 42,
          currentActiveTabId: 42,
          browserActiveTabId: 42,
          browserActiveTabIdKnown: true,
          isReadTargetBrowserActiveTab: true,
          currentWindowState: 'normal',
          isFocused: true,
          isMinimized: false,
          isVisible: true,
          width: 1280,
          height: 720,
          left: 10,
          top: 20,
          heartbeatTabCount: 2,
          heartbeatWindowCount: 1,
        }),
        tab: expect.objectContaining({
          objectKind: 'BrowserTabObject',
          readTargetTabId: 42,
          currentTabId: 42,
          primaryRunTabId: 42,
          primaryTabId: 42,
          browserActiveTabId: 42,
          isReadTargetTabActive: true,
          isReadTargetBrowserActiveTab: true,
          isActive: true,
          ownerType: 'run_owned',
          currentTabRunOwnershipVerdict: 'run_owned_by_task',
          readTargetPrimaryRelationVerdict: 'current_tab_is_primary',
          currentTabPrimaryRelationVerdict: 'current_tab_is_primary',
          isRunOwnedByTask: true,
          runOwnedTabCount: 1,
        }),
        page: expect.objectContaining({
          objectKind: 'BrowserPageObject',
          readiness: 'ready',
          selectedDataSource: 'dom_region_rows',
        }),
        visualReliability: expect.objectContaining({
          objectKind: 'BrowserVisualReliability',
          isReadTargetTabActive: true,
          visualReliabilityCandidate: true,
          degraded: false,
        }),
      },
      operationSummary: expect.any(String),
      claimBoundary: expect.stringContaining('candidate evidence only'),
    });
    expect(view.compact?.primaryConclusion).toContain('Content visible');
    expect(view.compact?.primaryConclusion).toContain(
      'No before/after dynamic transition is proven',
    );
    expect(JSON.stringify(view.compact)).not.toContain('semanticEvents');
    expect(JSON.stringify(view.compact)).not.toContain('attributeGroups');
  });

  it('downgrades visual reliability when the window or tab is not observable', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      ownershipRuntime: ownershipRuntime({
        isCurrentTabActive: false,
        isCurrentWindowFocused: false,
      }),
    });

    expect(view.attributeGroups.window_state.status).toBe('unfocused');
    expect(view.attributeGroups.tab_state.status).toBe('background');
    expect(view.attributeGroups.visual_reliability.status).toBe('degraded');
    expect(view.attributeGroups.window_state.facts).toMatchObject({
      isFocused: false,
      isMinimized: false,
    });
    expect(view.attributeGroups.tab_state.facts).toMatchObject({
      isReadTargetTabActive: false,
      isActive: false,
    });
    expect(view.attributeGroups.visual_reliability.facts).toMatchObject({
      isCurrentWindowFocused: false,
      isReadTargetTabActive: false,
      isCurrentTabActive: false,
      visualReliabilityCandidate: false,
      degraded: true,
      degradationReasons: ['window_unfocused', 'read_target_tab_inactive'],
      claimScreenshotProofAllowed: false,
    });
    expect(view.attributeGroups.visual_reliability.summary).toContain(
      'reasons=window_unfocused, read_target_tab_inactive',
    );
    expect(view.attributeGroups.visual_reliability.summary).toContain(
      'do not claim reliable visual proof',
    );
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'runtime_degraded',
      primaryConclusion: expect.stringContaining('Runtime visibility degraded'),
      changedGroups: expect.arrayContaining(['visual_reliability', 'window_state', 'tab_state']),
    });
  });

  it('labels background reads as read-target tab state without asserting browser active-tab identity', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection({
        pageId: 'tab:84',
        tabId: 84,
        ownerType: 'run_owned',
      }),
      ownershipRuntime: ownershipRuntime({
        currentTabId: 84,
        isCurrentTabActive: false,
        browserActiveTabId: 42,
        browserActiveTabIdKnown: true,
        isReadTargetBrowserActiveTab: false,
        currentTabPrimaryRelationVerdict: 'current_tab_differs_from_primary',
        protectedScopeVerdict: 'not_protected',
        cleanupEligibility: 'eligible',
        primaryTabId: 42,
        runOwnedTabIds: [42, 84],
        runOwnedTabCount: 2,
      }),
    });

    expect(view.attributeGroups.window_state.summary).toContain('readTargetTab=84');
    expect(view.attributeGroups.window_state.summary).toContain('browserActiveTab=42');
    expect(view.attributeGroups.window_state.summary).toContain('readTargetIsBrowserActive=false');
    expect(view.attributeGroups.window_state.facts).toMatchObject({
      readTargetTabId: 84,
      currentActiveTabId: 84,
      browserActiveTabId: 42,
      browserActiveTabIdKnown: true,
      isReadTargetBrowserActiveTab: false,
    });
    expect(view.attributeGroups.tab_state.status).toBe('background');
    expect(view.attributeGroups.tab_state.summary).toContain('readTargetTab=84');
    expect(view.attributeGroups.tab_state.summary).toContain('background/not active in its window');
    expect(view.attributeGroups.tab_state.summary).toContain('browserActiveTab=42');
    expect(view.attributeGroups.tab_state.summary).toContain('readTargetIsBrowserActive=false');
    expect(view.attributeGroups.tab_state.summary).toContain('primaryRunTab=42');
    expect(view.attributeGroups.tab_state.facts).toMatchObject({
      readTargetTabId: 84,
      currentTabId: 84,
      primaryRunTabId: 42,
      browserActiveTabId: 42,
      isReadTargetTabActive: false,
      isReadTargetBrowserActiveTab: false,
      isActive: false,
      readTargetPrimaryRelationVerdict: 'current_tab_differs_from_primary',
      cleanupEligibility: 'eligible',
      protectedScopeVerdict: 'not_protected',
    });
    expect(view.attributeGroups.visual_reliability.summary).toContain('readTargetTabActive=false');
    expect(view.attributeGroups.visual_reliability.facts).toMatchObject({
      isReadTargetTabActive: false,
      isCurrentTabActive: false,
      visualReliabilityCandidate: false,
      degraded: true,
      degradationReasons: ['read_target_tab_inactive'],
    });
    expect(view.compact?.facts.visualReliability).toMatchObject({
      degradationReasons: ['read_target_tab_inactive'],
    });
    expect(view.compact?.facts.window).toMatchObject({
      readTargetTabId: 84,
      browserActiveTabId: 42,
      browserActiveTabIdKnown: true,
      isReadTargetBrowserActiveTab: false,
    });
    expect(view.compact?.facts.tab).toMatchObject({
      readTargetTabId: 84,
      primaryRunTabId: 42,
      browserActiveTabId: 42,
      isReadTargetTabActive: false,
      isReadTargetBrowserActiveTab: false,
    });
  });

  it('keeps browser active tab identity unknown when runtime evidence is unavailable', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      ownershipRuntime: ownershipRuntime({
        browserActiveTabId: null,
        browserActiveTabIdKnown: false,
        isReadTargetBrowserActiveTab: null,
      }),
    });

    expect(view.attributeGroups.window_state.summary).toContain('browserActiveTab=unknown');
    expect(view.attributeGroups.window_state.summary).toContain(
      'readTargetIsBrowserActive=unknown',
    );
    expect(view.attributeGroups.window_state.facts).toMatchObject({
      readTargetTabId: 42,
      browserActiveTabId: null,
      browserActiveTabIdKnown: false,
      isReadTargetBrowserActiveTab: null,
    });
    expect(view.attributeGroups.tab_state.summary).toContain('browserActiveTab=unknown');
    expect(view.attributeGroups.tab_state.facts).toMatchObject({
      readTargetTabId: 42,
      browserActiveTabId: null,
      isReadTargetBrowserActiveTab: null,
    });
    expect(view.compact?.facts.window).toMatchObject({
      browserActiveTabId: null,
      browserActiveTabIdKnown: false,
      isReadTargetBrowserActiveTab: null,
    });
  });

  it('downgrades visual reliability when Chrome reports the window is minimized', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      ownershipRuntime: ownershipRuntime({
        currentWindowState: 'minimized',
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
      }),
    });

    expect(view.attributeGroups.window_state.status).toBe('minimized');
    expect(view.attributeGroups.window_state.summary).toContain('state=minimized');
    expect(view.attributeGroups.visual_reliability.status).toBe('degraded');
    expect(view.attributeGroups.visual_reliability.summary).toContain('windowState=minimized');
    expect(view.attributeGroups.visual_reliability.summary).toContain('reasons=window_minimized');
    expect(view.attributeGroups.visual_reliability.facts).toMatchObject({
      degradationReasons: ['window_minimized'],
    });
    expect(view.compact.facts.window).toMatchObject({
      objectKind: 'BrowserWindowObject',
      exists: true,
      currentWindowState: 'minimized',
      isFocused: true,
      isMinimized: true,
      isVisible: false,
      width: 1280,
      height: 720,
    });
    expect(view.compact.facts.tab).toMatchObject({
      objectKind: 'BrowserTabObject',
      currentTabId: 42,
      isActive: true,
      isRunOwnedByTask: true,
    });
    expect(view.compact.facts.visualReliability).toMatchObject({
      degraded: true,
      degradationReasons: ['window_minimized'],
    });
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'runtime_degraded',
      changedGroups: expect.arrayContaining(['visual_reliability', 'window_state']),
    });
  });

  it('condenses window and tab runtime changes into a dynamic attribute summary', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      previousOwnershipRuntime: ownershipRuntime({
        currentWindowState: 'minimized',
        currentWindowWidth: 800,
        currentWindowHeight: 600,
        currentWindowLeft: 0,
        currentWindowTop: 0,
        isCurrentTabActive: false,
        isCurrentWindowFocused: false,
      }),
      ownershipRuntime: ownershipRuntime({
        currentWindowState: 'normal',
        currentWindowWidth: 1280,
        currentWindowHeight: 720,
        currentWindowLeft: 10,
        currentWindowTop: 20,
        isCurrentTabActive: true,
        isCurrentWindowFocused: true,
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'runtime_transition_candidate',
      primaryConclusion: expect.stringContaining('Runtime state changed'),
      changedGroups: expect.arrayContaining(['window_state', 'tab_state', 'visual_reliability']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('window state minimized -> normal');
    expect(view.dynamicAttributeSummary?.summary).toContain('window focus false -> true');
    expect(view.dynamicAttributeSummary?.summary).toContain('active tab false -> true');
    expect(view.dynamicAttributeSummary?.summary).toContain('window size 800x600 -> 1280x720');
  });

  it('condenses task-owned tab and cleanup runtime changes into a dynamic attribute summary', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      pageProjection: pageProjection(),
      previousOwnershipRuntime: ownershipRuntime({
        currentTabRunOwnershipVerdict: 'run_owned_by_task',
        cleanupEligibility: 'not_eligible',
        isCurrentTabRunOwnedByTask: true,
        runOwnedTabIds: [42, 43],
        runOwnedTabCount: 2,
      }),
      ownershipRuntime: ownershipRuntime({
        currentTabRunOwnershipVerdict: 'not_run_owned_by_task',
        cleanupEligibility: 'eligible',
        isCurrentTabRunOwnedByTask: false,
        runOwnedTabIds: [43],
        runOwnedTabCount: 1,
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'runtime_transition_candidate',
      primaryConclusion: expect.stringContaining('Runtime state changed'),
      changedGroups: expect.arrayContaining(['tab_state', 'task_relation']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('run-owned tab count 2 -> 1');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'current tab run ownership run_owned_by_task -> not_run_owned_by_task',
    );
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'cleanup eligibility not_eligible -> eligible',
    );
  });

  it('condenses page projection changes into a dynamic attribute summary', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      previousPageProjection: pageProjection({
        readiness: 'blocked',
        stability: 'loading',
        sourceFreshness: 'stale',
        activeRegion: 'search_form',
        contextChars: 300,
        sourceConfidence: 0.42,
        userActivityLevel: 'active',
        interferenceRisk: 'high',
      }),
      pageProjection: pageProjection({
        readiness: 'ready',
        stability: 'stable',
        sourceFreshness: 'fresh',
        activeRegion: 'search_results',
        changedRegions: ['search_results'],
        refreshedRefs: ['tgt_result_1', 'tgt_result_2'],
        contextChars: 1200,
        sourceConfidence: 0.84,
        userActivityLevel: 'none',
        interferenceRisk: 'none',
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'page_transition_candidate',
      primaryConclusion: expect.stringContaining('Page state changed'),
      changedGroups: expect.arrayContaining([
        'page_state',
        'layout_regions',
        'content_state',
        'evidence_state',
      ]),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('readiness blocked -> ready');
    expect(view.dynamicAttributeSummary?.summary).toContain('stability loading -> stable');
    expect(view.dynamicAttributeSummary?.summary).toContain('source freshness stale -> fresh');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'active region search_form -> search_results',
    );
    expect(view.dynamicAttributeSummary?.summary).toContain('context chars 300 -> 1200');
    expect(view.dynamicAttributeSummary?.summary).toContain('source confidence 0.42 -> 0.84');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'Use postcondition verification before treating this as task success',
    );
  });

  it('does not treat viewport-only page projection churn as result/content proof', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      previousPageProjection: pageProjection({
        activeRegion: 'search_form',
        changedRegions: [],
        refreshedRefs: [],
        sourceConfidence: 0.72,
      }),
      pageProjection: pageProjection({
        activeRegion: 'search_form',
        changedRegions: ['viewport'],
        refreshedRefs: ['tgt_search_1'],
        sourceConfidence: 0.73,
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'page_transition_candidate',
      primaryConclusion:
        'Only viewport or target-reference state changed; no result/content transition is proven.',
      changedGroups: expect.arrayContaining(['layout_regions', 'content_state', 'evidence_state']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('changed regions viewport');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'target refs invalidated=0 refreshed=1',
    );
  });

  it('summarizes small same-document content deltas as content-area candidates instead of raw context chars', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: lifecycle,
      previousPageProjection: pageProjection({
        readiness: 'ready',
        stability: 'stable',
        sourceFreshness: 'fresh',
        activeRegion: 'viewport',
        changedRegions: [],
        refreshedRefs: [],
        contextChars: 10839,
        sourceConfidence: 0.82,
      }),
      pageProjection: pageProjection({
        readiness: 'ready',
        stability: 'loading',
        sourceFreshness: 'fresh',
        activeRegion: 'viewport',
        changedRegions: [],
        refreshedRefs: [],
        contextChars: 10841,
        sourceConfidence: 0.82,
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'page_transition_candidate',
      primaryConclusion:
        'Same-document content area changed candidate: visible page content or DOM state changed after the action; postcondition verification is still required.',
      changedGroups: expect.arrayContaining(['page_state', 'content_state']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('context chars 10839 -> 10841');
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toContain(
      'Page state changed: context chars',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toContain(
      'Page state changed: stability',
    );
  });

  it('prioritizes AI-usable semantic conclusions over page-state noise', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_nav',
          regionType: 'navigation',
          state: 'visible_candidate',
          targetability: 'target_ref',
          objects: [
            {
              objectId: 'ref_home',
              label: 'Homepage',
              menuItemRole: 'primary_navigation',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'navigation candidate',
            },
            {
              objectId: 'ref_domains',
              label: 'Domains',
              menuItemRole: 'primary_navigation',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'navigation candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: after,
      previousPageProjection: pageProjection({
        readiness: 'blocked',
        activeRegion: 'viewport',
        contextChars: 1400,
        sourceConfidence: 0,
      }),
      pageProjection: pageProjection({
        readiness: 'ready',
        activeRegion: 'result_list',
        changedRegions: ['result_list'],
        contextChars: 300,
        sourceConfidence: 0.72,
      }),
    });

    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: 'Menu expanded candidate: 3 menu action(s) appeared.',
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('Menu expanded candidate');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'Page changed: readiness blocked -> ready',
    );
  });

  it('prioritizes form/search state changes over incidental menu expansion', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_form',
        regionType: 'form',
        state: 'empty_search_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_search',
            label: 'Search',
            objectType: 'searchbox',
            actionTypes: ['fill'],
            targetability: 'target_ref',
            confidence: 0.82,
            reason: 'search input candidate',
          },
        ],
      }),
      region({
        regionId: 'region_menu',
        regionType: 'menu',
        state: 'collapsed_or_expandable_candidate',
        targetability: 'target_ref',
        objects: [
          {
            objectId: 'ref_more',
            label: 'More',
            menuItemRole: 'overflow_menu_trigger',
            actionTypes: ['click'],
            targetability: 'target_ref',
            confidence: 0.8,
            reason: 'menu trigger candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_form',
          regionType: 'form',
          state: 'filled_search_candidate',
          targetability: 'target_ref',
          objects: [
            {
              objectId: 'ref_search',
              label: 'Search',
              objectType: 'searchbox',
              actionTypes: ['fill'],
              targetability: 'target_ref',
              confidence: 0.82,
              reason: 'search input candidate',
            },
          ],
        }),
        region({
          regionId: 'region_menu',
          regionType: 'menu',
          state: 'expanded_candidate',
          targetability: 'target_ref',
          objects: [
            {
              objectId: 'ref_more',
              label: 'More',
              menuItemRole: 'overflow_menu_trigger',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'menu trigger candidate',
            },
            {
              objectId: 'ref_item_1',
              label: 'Help',
              menuItemRole: 'primary_navigation',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.78,
              reason: 'menu item candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({
      objectLifecycle: after,
    });

    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'content_changed',
          targetGroup: 'action_state',
          targetObjectFamily: 'form_control',
          summary: expect.stringContaining('form/search control change'),
        }),
        expect.objectContaining({
          eventType: 'menu_expanded',
          targetGroup: 'menu_state',
        }),
      ]),
    );
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('form/search control change'),
      changedGroups: expect.arrayContaining(['action_state', 'menu_state']),
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('form/search outcome is not proven');
    expect(view.dynamicAttributeSummary?.summary).toContain(
      'Postcondition verification is still required',
    );
  });

  it('detects privacy-safe empty to non-empty form value state changes', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_form',
        regionType: 'form',
        state: 'input_available_candidate',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_search',
            label: 'search area',
            objectType: 'control',
            role: 'textbox',
            valueState: 'empty',
            actionTypes: ['fill'],
            targetability: 'locator_chain',
            confidence: 0.78,
            reason: 'form input candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_form',
          regionType: 'form',
          state: 'input_available_candidate',
          targetability: 'locator_chain',
          objects: [
            {
              objectId: 'ref_search',
              label: 'search area',
              objectType: 'control',
              role: 'textbox',
              valueState: 'non_empty',
              actionTypes: ['fill'],
              targetability: 'locator_chain',
              confidence: 0.78,
              reason: 'form input candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: after });

    expect(after.changedObjectCount).toBeGreaterThan(0);
    expect(view.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'content_changed',
          targetGroup: 'action_state',
          targetObjectFamily: 'form_control',
          postconditionStatus: 'unknown',
          summary: expect.stringContaining('form/search control change'),
        }),
      ]),
    );
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('form/search control change'),
      changedGroups: expect.arrayContaining(['action_state']),
    });
    expect(JSON.stringify(view)).not.toContain('secret-search-query');
  });

  it('reports unknown_or_noise when raw lifecycle changes do not prove a target transition', () => {
    const noisy: ReadPageObjectLifecycleSummary = {
      source: 'read_page_regions',
      status: 'compared_snapshot',
      objectCount: 32,
      changedObjectCount: 32,
      items: [],
      changes: Array.from({ length: 32 }, (_, index) => ({
        objectKey: `object:unknown:ref_noise_${index}`,
        objectFamily: 'unknown',
        regionType: 'unknown',
        beforeState: 'visible_candidate',
        afterState: 'visible_candidate_changed',
        changeKind: 'changed',
        claimBoundary: 'test noise only',
      })),
      claimBoundary: 'compared snapshot only',
    };

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: noisy });

    expect(view.semanticEvents).toEqual([
      expect.objectContaining({
        eventType: 'unknown_or_noise',
        targetGroup: 'task_relation',
      }),
    ]);
    expect(view.semanticEvents[0].summary).toContain('State changes: unknown_state changed');
    expect(view.semanticEvents[0].summary).not.toContain('unknown_state 32');
    expect(view.semanticEvents[0].summary).not.toContain('low-level object changes');
    expect(view.attributeGroups.task_relation.summary).toContain(
      'State changes: unknown_state changed',
    );
    expect(view.attributeGroups.task_relation.summary).not.toContain('unknown_state 32');
    expect(view.attributeGroups.task_relation.summary).toContain(
      'no AI-usable target-state transition',
    );
    expect(view.attributeGroups.task_relation.summary).not.toContain('low-level object changes');
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'changed_without_target_transition',
      primaryConclusion:
        'No AI-usable target transition was proven. State changes: unknown_state changed.',
      changedGroups: ['task_relation'],
      transitionCount: 32,
    });
    expect(view.dynamicAttributeSummary?.summary).toContain('State changes: unknown_state changed');
    expect(view.dynamicAttributeSummary?.summary).not.toContain('unknown_state 32');
    expect(view.dynamicAttributeSummary?.summary).not.toContain('low-level object changes');
  });

  it('keeps QR refresh as QR evidence instead of login success proof', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_modal',
        regionType: 'modal',
        state: 'auth_prompt_candidate',
        confidence: 0.8,
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_qr',
            label: 'QR visual',
            objectType: 'qr_visual',
            actionTypes: [],
            targetability: 'locator_chain',
            confidence: 0.8,
            reason: 'QR candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_modal',
          regionType: 'modal',
          state: 'auth_prompt_candidate',
          confidence: 0.8,
        }),
        region({
          regionId: 'region_qr',
          regionType: 'qr_code',
          state: 'waiting_scan_refreshed_candidate',
          targetability: 'locator_chain',
          objects: [
            {
              objectId: 'ref_qr',
              label: 'QR visual changed',
              objectType: 'qr_visual',
              actionTypes: [],
              targetability: 'locator_chain',
              confidence: 0.8,
              reason: 'QR candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: after });

    expect(view.semanticEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining(['qr_waiting', 'qr_refreshed']),
    );
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('QR object changed candidate'),
      changedGroups: expect.arrayContaining(['qr_state']),
    });
    expect(view.semanticEvents.map((event) => event.eventType)).not.toContain(
      'auth_succeeded_candidate',
    );
  });

  it('reports expired QR state as refresh-needed instead of plain waiting', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_modal',
        regionType: 'modal',
        state: 'auth_prompt_candidate',
        confidence: 0.8,
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'expired_or_refresh_available_candidate',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_qr',
            label: 'QR visual',
            objectType: 'qr_visual',
            actionTypes: ['capture_element'],
            targetability: 'locator_chain',
            confidence: 0.8,
            reason: 'visible_text_qr_expired_signal',
          },
        ],
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: lifecycle });

    expect(view.attributeGroups.qr_state.status).toBe('expired_or_refresh_needed');
    expect(view.attributeGroups.qr_state.summary).toContain('BLOCKED_USER_INTERACTION_REQUIRED');
    expect(view.semanticEvents.map((event) => event.eventType)).toContain('qr_expired_candidate');
    expect(view.semanticEvents.map((event) => event.eventType)).not.toContain('qr_waiting');
    expect(view.semanticEvents[0]).toMatchObject({
      targetGroup: 'qr_state',
      postconditionStatus: 'candidate_only',
    });
    expect(view.semanticEvents[0].summary).toContain('refresh');
    expect(view.semanticEvents[0].summary).toContain('BLOCKED_USER_INTERACTION_REQUIRED');
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'QR/auth object appears expired',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'BLOCKED_USER_INTERACTION_REQUIRED',
    );
  });

  it('reports waiting-to-expired QR transition as blocked user interaction instead of waiting', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_modal',
        regionType: 'modal',
        state: 'auth_prompt_candidate',
        confidence: 0.8,
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_qr',
            label: 'QR visual',
            objectType: 'qr_visual',
            actionTypes: [],
            targetability: 'locator_chain',
            confidence: 0.8,
            reason: 'QR candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_modal',
          regionType: 'modal',
          state: 'auth_prompt_candidate',
          confidence: 0.8,
        }),
        region({
          regionId: 'region_qr',
          regionType: 'qr_code',
          state: 'expired_or_refresh_available_candidate',
          targetability: 'locator_chain',
          objects: [
            {
              objectId: 'ref_qr',
              label: 'QR visual',
              objectType: 'qr_visual',
              actionTypes: ['capture_element'],
              targetability: 'locator_chain',
              confidence: 0.8,
              reason: 'visible_text_qr_expired_signal',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: after });
    const eventTypes = view.semanticEvents.map((event) => event.eventType);

    expect(eventTypes).toContain('qr_expired_candidate');
    expect(eventTypes).not.toContain('qr_waiting');
    expect(view.attributeGroups.qr_state.status).toBe('expired_or_refresh_needed');
    expect(view.attributeGroups.qr_state.summary).toContain('BLOCKED_USER_INTERACTION_REQUIRED');
    expect(view.dynamicAttributeSummary).toMatchObject({
      status: 'semantic_transition_candidate',
      primaryConclusion: expect.stringContaining('BLOCKED_USER_INTERACTION_REQUIRED'),
      changedGroups: expect.arrayContaining(['qr_state']),
    });
    expect(view.dynamicAttributeSummary?.primaryConclusion).not.toContain('login success');
  });

  it('does not keep waiting on content QR after an auth modal disappears and account state appears', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_modal',
        regionType: 'modal',
        state: 'auth_prompt_candidate',
        confidence: 0.8,
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        targetability: 'locator_chain',
        objects: [
          {
            objectId: 'ref_auth_qr',
            label: 'QR visual',
            objectType: 'qr_visual',
            actionTypes: [],
            targetability: 'locator_chain',
            confidence: 0.8,
            reason: 'auth QR candidate',
          },
        ],
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_account',
          regionType: 'account',
          state: 'logged_in_candidate',
          confidence: 0.8,
        }),
        region({
          regionId: 'region_content',
          regionType: 'content',
          state: 'content_available_candidate',
          confidence: 0.7,
          objects: [
            {
              objectId: 'ref_content_qr',
              label: 'Content QR image',
              objectType: 'qr_visual',
              actionTypes: [],
              targetability: 'not_clickable',
              confidence: 0.7,
              reason: 'content image candidate',
            },
          ],
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: after });
    const eventTypes = view.semanticEvents.map((event) => event.eventType);

    expect(eventTypes).toContain('auth_succeeded_candidate');
    expect(eventTypes).not.toContain('qr_waiting');
    expect(view.attributeGroups.qr_state.status).toBe('stale_invalidated');
    expect(view.attributeGroups.content_state.status).toBe('changed_candidate');
    expect(view.attributeGroups.task_relation.summary).toContain(
      'Authentication success candidate',
    );
    expect(view.dynamicAttributeSummary?.primaryConclusion).toContain(
      'Authentication success candidate',
    );
    expect(view.attributeGroups.task_relation.summary).not.toContain(
      'QR/auth object is visible and waiting',
    );
  });

  it('keeps content-only QR-like objects out of auth QR state', () => {
    const lifecycle = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
        objects: [
          {
            objectId: 'ref_content_qr',
            label: 'Content QR image',
            objectType: 'qr_visual',
            actionTypes: [],
            targetability: 'not_clickable',
            confidence: 0.7,
            reason: 'content image candidate',
          },
        ],
      }),
    ]);

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: lifecycle });

    expect(lifecycle.items.map((item) => item.objectFamily)).not.toContain('qr_code');
    expect(lifecycle.items.map((item) => item.objectFamily)).toContain('content_collection');
    expect(view.attributeGroups.qr_state.status).toBe('not_applicable_content_qr_only');
    expect(view.semanticEvents.map((event) => event.eventType)).not.toContain('qr_waiting');
  });

  it('keeps auth and logout transitions as candidates with explicit boundaries', () => {
    const authBefore = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_modal',
        regionType: 'modal',
        state: 'auth_prompt_candidate',
        confidence: 0.8,
      }),
      region({
        regionId: 'region_qr',
        regionType: 'qr_code',
        state: 'waiting_scan_candidate',
        confidence: 0.8,
      }),
    ]);
    const authAfter = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_account',
          regionType: 'account',
          state: 'logged_in_candidate',
          confidence: 0.8,
        }),
      ],
      { previous: authBefore },
    );
    const loginView = buildReadPageBrowserPageObjectView({ objectLifecycle: authAfter });

    expect(loginView.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'auth_succeeded_candidate',
          postconditionStatus: 'candidate_only',
        }),
      ]),
    );
    expect(loginView.semanticEvents[0].claimBoundary).toContain('candidate');

    const logoutAfter = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_modal',
          regionType: 'modal',
          state: 'auth_prompt_candidate',
          confidence: 0.8,
        }),
      ],
      { previous: authAfter },
    );
    const logoutView = buildReadPageBrowserPageObjectView({ objectLifecycle: logoutAfter });

    expect(logoutView.semanticEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'logout_succeeded_candidate',
          postconditionStatus: 'candidate_only',
        }),
      ]),
    );
  });

  it('does not report logout when an auth prompt appears without a prior logged-in account', () => {
    const before = buildReadPageObjectLifecycle([
      region({
        regionId: 'region_content',
        regionType: 'content',
        state: 'content_available_candidate',
        confidence: 0.7,
      }),
    ]);
    const after = buildReadPageObjectLifecycle(
      [
        region({
          regionId: 'region_modal',
          regionType: 'modal',
          state: 'auth_prompt_candidate',
          confidence: 0.8,
        }),
        region({
          regionId: 'region_account',
          regionType: 'account',
          state: 'logged_out_candidate',
          confidence: 0.8,
        }),
      ],
      { previous: before },
    );

    const view = buildReadPageBrowserPageObjectView({ objectLifecycle: after });

    expect(view.semanticEvents.map((event) => event.eventType)).not.toContain(
      'logout_succeeded_candidate',
    );
  });
});
