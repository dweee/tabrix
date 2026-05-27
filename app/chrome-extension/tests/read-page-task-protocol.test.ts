import { describe, expect, it } from 'vitest';
import {
  buildTaskProtocol,
  redactSensitiveCandidateActionsForAi,
  redactSensitiveInteractiveElementsForAi,
} from '@/entrypoints/background/tools/browser/read-page-task-protocol';
import { buildVisualElementRegionObjects } from '@/entrypoints/background/tools/browser/read-page-region-signal-objects';
import { buildPageOperationMap } from '@/entrypoints/background/tools/browser/read-page-operation-map';

function createBaseParams(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'compact' as const,
    currentUrl: 'https://example.com',
    currentTitle: 'Example',
    pageType: 'web_page',
    pageRole: 'web_page',
    primaryRegion: null,
    interactiveElements: [] as any[],
    candidateActions: [] as any[],
    artifactRefs: [
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
      { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
    ],
    pageContext: {
      filter: 'interactive',
      depth: 3,
      focus: null,
      scheme: 'https',
      viewport: { width: 1280, height: 720, dpr: 1 },
      sparse: false,
      fallbackUsed: false,
      fallbackSource: null,
      refMapCount: 4,
      markedElementsCount: 0,
    },
    contentSummary: {
      charCount: 1000,
      normalizedLength: 900,
      lineCount: 24,
      quality: 'usable',
    },
    ...overrides,
  };
}

describe('read_page task protocol', () => {
  it('does not promote generic visual elements to QR regions without explicit QR signal', () => {
    expect(
      buildVisualElementRegionObjects([
        {
          id: 'visual_generic_square',
          label: 'QR visual element candidate',
          selector: 'main img:nth-of-type(1)',
          role: 'img',
          rect: { x: 10, y: 10, width: 160, height: 160 },
          visualSignature: 'visual_11111111',
          reason: 'qr_visual_element_signal',
          confidence: 0.82,
        },
      ]),
    ).toEqual([]);
  });

  it('keeps explicitly signaled QR visual elements targetable for element capture', () => {
    expect(
      buildVisualElementRegionObjects([
        {
          id: 'visual_qr',
          label: 'QR visual element candidate',
          selector: '[data-testid="login-qr"] img',
          role: 'img',
          rect: { x: 10, y: 10, width: 160, height: 160 },
          visualSignature: 'visual_22222222',
          qrSignal: true,
          reason: 'qr_visual_element_signal',
          confidence: 0.82,
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        regionType: 'qr_code',
        object: expect.objectContaining({
          objectId: 'visual_qr',
          objectType: 'qr_visual:visual_22222222',
          targetability: 'locator_chain',
        }),
      }),
    ]);
  });

  it('keeps workflow_run_shell in monitor mode before detail diagnostics are visible', () => {
    const protocol = buildTaskProtocol({
      mode: 'compact',
      currentUrl: 'https://github.com/example/project/actions/runs/42',
      currentTitle: 'Release Tabrix',
      pageType: 'web_page',
      pageRole: 'workflow_run_shell',
      primaryRegion: 'workflow_run_shell',
      interactiveElements: [
        { ref: 'ref_actions', role: 'link', name: 'Actions' },
        { ref: 'ref_run', role: 'link', name: 'Run 42' },
      ],
      candidateActions: [
        {
          id: 'ca_click_ref_run',
          actionType: 'click',
          targetRef: 'ref_run',
          confidence: 0.72,
          matchReason: 'interactive clickable candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Run 42' }],
        },
      ],
      artifactRefs: [
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/normal' },
        { kind: 'dom_snapshot', ref: 'artifact://read_page/tab-1/full' },
      ],
      pageContext: {
        filter: 'interactive',
        depth: 3,
        focus: null,
        scheme: 'https',
        viewport: { width: 1280, height: 720, dpr: 1 },
        sparse: false,
        fallbackUsed: false,
        fallbackSource: null,
        refMapCount: 2,
        markedElementsCount: 0,
      },
      contentSummary: {
        charCount: 320,
        normalizedLength: 280,
        lineCount: 8,
        quality: 'usable',
      },
    });

    expect(protocol.taskMode).toBe('monitor');
  });

  it('prioritizes repo navigation over commit headlines on repo_home', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          {
            ref: 'ref_commit',
            role: 'link',
            name: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
          },
          { ref: 'ref_issues', role: 'link', name: 'Issues' },
          { ref: 'ref_pulls', role: 'link', name: 'Pull requests' },
          { ref: 'ref_actions', role: 'link', name: 'Actions' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_commit',
            actionType: 'click',
            targetRef: 'ref_commit',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [
              {
                type: 'aria',
                value: 'fix(t4): stabilize workflow run detail baseline for v2.0.9 release',
              },
            ],
          },
          {
            id: 'ca_click_ref_issues',
            actionType: 'click',
            targetRef: 'ref_issues',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Issues' }],
          },
          {
            id: 'ca_click_ref_actions',
            actionType: 'click',
            targetRef: 'ref_actions',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Actions' }],
          },
        ],
      }),
    );

    expect(protocol.taskMode).toBe('read');
    expect(protocol.highValueObjects[0]?.label).toBe('Issues');
    expect(protocol.highValueObjects.slice(0, 3).map((item) => item.label)).toEqual([
      'Issues',
      'Actions',
      'Pull requests',
    ]);
    expect(protocol.L0.summary).toContain('focus on Issues, Actions, Pull requests');
    expect(protocol.L0.summary).not.toContain('fix(t4): stabilize workflow run detail baseline');
  });

  it('carries privacy-safe form value state into page regions and lifecycle', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        interactiveElements: [
          {
            ref: 'ref_search',
            role: 'textbox',
            name: 'Search',
            valueState: 'non_empty',
          },
        ],
        candidateActions: [
          {
            id: 'ca_fill_ref_search',
            actionType: 'fill',
            targetRef: 'ref_search',
            confidence: 0.72,
            matchReason: 'primary action inferred from interactive label',
            locatorChain: [{ type: 'ref', value: 'ref_search' }],
          },
        ],
      }),
    );

    const formRegion = protocol.pageRegions.find((region) => region.regionType === 'form');
    expect(formRegion?.objects.find((object) => object.objectId === 'ref_search')).toMatchObject({
      objectId: 'ref_search',
      valueState: 'non_empty',
    });
    expect(protocol.objectLifecycle.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectKey: 'object:form:ref_search',
          state: 'input_available_candidate:value_non_empty',
        }),
      ]),
    );
  });

  it('falls back to generic high-value objects when snapshot has no repo tabs', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: 'ref_go_to_file', role: 'combobox', name: 'Go to file' },
          { ref: 'ref_watch', role: 'button', name: 'Watching a repository' },
          { ref: 'ref_branch', role: 'button', name: 'main branch' },
        ],
        candidateActions: [
          {
            id: 'ca_fill_ref_go_to_file',
            actionType: 'fill',
            targetRef: 'ref_go_to_file',
            confidence: 0.68,
            matchReason: 'form input candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Go to file' }],
          },
          {
            id: 'ca_click_ref_watch',
            actionType: 'click',
            targetRef: 'ref_watch',
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Watching a repository' }],
          },
        ],
      }),
    );

    expect(protocol.taskMode).toBe('read');
    // Without platform-specific adapters, high-value objects come from actual page elements,
    // not injected seeds. The Knowledge layer (MKEP) provides platform knowledge.
    expect(protocol.highValueObjects[0]?.label).toBe('Watching a repository');
    expect(protocol.highValueObjects[1]?.label).toBe('Go to file');
    expect(protocol.highValueObjects[2]?.label).toBe('main branch');
  });

  it('filters certificate and compliance links out of high-value objects', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://example.com/search',
        currentTitle: 'Search results',
        pageRole: 'web_page',
        primaryRegion: 'visible_results',
        interactiveElements: [
          {
            ref: 'ref_result_1',
            role: 'link',
            name: 'Practical workflow guide for solo teams',
            href: '/items/1',
          },
          {
            ref: 'ref_certificate',
            role: 'link',
            name: 'Internet drug information service certificate',
            href: '/service/info',
          },
          {
            ref: 'ref_license',
            role: 'link',
            name: '业务经营许可证',
            href: '/public/credential',
          },
          {
            ref: 'ref_icp',
            role: 'link',
            name: 'ICP备案',
            href: '/footer/record',
          },
          {
            ref: 'ref_security',
            role: 'link',
            name: '公网安备',
            href: '/site/security',
          },
          {
            ref: 'ref_result_2',
            role: 'link',
            name: 'Automation checklist for daily operations',
            href: '/items/2',
          },
        ],
      }),
    );

    const labels = protocol.highValueObjects.map((item) => item.label);
    expect(labels).toEqual([
      'Practical workflow guide for solo teams',
      'Automation checklist for daily operations',
    ]);
    expect(labels.join(' ')).not.toMatch(
      /certificate|license|许可证|ICP备|公网安备|compliance|permit/i,
    );
  });

  it('surfaces selected visible text rows as read-only facts before shell controls', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://example.com/search',
        currentTitle: 'Search results',
        pageRole: 'web_page',
        primaryRegion: 'visible_results',
        interactiveElements: [
          { ref: 'ref_home', role: 'link', name: 'Home', href: '/' },
          { ref: 'ref_search', role: 'button', name: 'Search' },
          { ref: 'ref_download', role: 'link', name: 'Download app', href: '/download-app' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_home',
            actionType: 'click',
            targetRef: 'ref_home',
            confidence: 0.72,
            matchReason: 'navigation shell candidate',
            locatorChain: [{ type: 'aria', value: 'Home' }],
          },
        ],
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [
            {
              rowId: 'visible_text_1',
              title: 'Practical automation planning guide for small teams',
              primaryText: 'Practical automation planning guide for small teams',
              secondaryText: 'Workflow Lab',
              metaText: '2 hours ago',
              interactionText: '89 likes',
              visibleTextFields: ['Practical automation planning guide for small teams'],
              targetRef: null,
              targetRefCoverageRate: 0,
              boundingBox: null,
              regionId: 'visible_text_1',
              sourceRegion: 'visible_text',
              confidence: 0.7,
              qualityReasons: ['visible_text_fallback'],
            },
            {
              rowId: 'visible_text_2',
              title: 'Reliable operations checklist for browser based AI assistants',
              primaryText: 'Reliable operations checklist for browser based AI assistants',
              secondaryText: 'Ops Review',
              metaText: 'yesterday',
              interactionText: '34 comments',
              visibleTextFields: ['Reliable operations checklist for browser based AI assistants'],
              targetRef: null,
              targetRefCoverageRate: 0,
              boundingBox: null,
              regionId: 'visible_text_2',
              sourceRegion: 'visible_text',
              confidence: 0.7,
              qualityReasons: ['visible_text_fallback'],
            },
          ],
          rowCount: 2,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'visible_text',
          rowExtractionConfidence: 0.7,
          cardExtractorUsed: true,
          cardPatternConfidence: 0.58,
          cardRowsCount: 2,
          rowOrder: 'visual_order',
          targetRefCoverageRate: 0,
          regionQualityScore: 0.43,
          visibleDomRowsCandidateCount: 2,
          visibleDomRowsSelectedCount: 2,
          lowValueRegionRejectedCount: 3,
          footerLikeRejectedCount: 1,
          navigationLikeRejectedCount: 2,
          targetRefCoverageRejectedCount: 0,
          rejectedRegionReasonDistribution: {
            low_value_region: 3,
            footer_like_region: 1,
            navigation_like_region: 2,
            target_ref_coverage_insufficient: 0,
            single_isolated_text: 0,
            empty_shell: 0,
          },
          pageInfo: {
            url: 'https://example.com/search',
            title: 'Search results',
            viewport: { width: 1280, height: 720, dpr: 1 },
            scrollY: 0,
            pixelsAbove: 0,
            pixelsBelow: 0,
            candidateRegionCount: 2,
          },
        },
      }),
    );

    const topObjects = protocol.highValueObjects.slice(0, 2);
    expect(topObjects.map((item) => item.label)).toEqual([
      'Practical automation planning guide for small teams',
      'Reliable operations checklist for browser based AI assistants',
    ]);
    for (const object of topObjects) {
      expect(object).toMatchObject({
        kind: 'visible_region_row',
        objectType: 'record',
        region: 'visible_text',
        sourceKind: 'dom_semantic',
      });
      expect(object.ref).toBeUndefined();
      expect(object.targetRef).toBeUndefined();
      expect(object.actions).toBeUndefined();
      expect(object.reasons).toEqual(
        expect.arrayContaining(['visible_text_fallback', 'read_fact']),
      );
    }
    expect(protocol.L0.focusObjectIds.slice(0, 2)).toEqual(topObjects.map((item) => item.id));
    expect(protocol.L0.summary).toContain(
      'focus on Practical automation planning guide for small teams, Reliable operations checklist for browser based AI assistants',
    );
    expect(protocol.L1.highValueObjectIds.slice(0, 2)).toEqual(topObjects.map((item) => item.id));
    expect(protocol.L1.overview).toContain(
      'Top objects: Practical automation planning guide for small teams, Reliable operations checklist for browser based AI assistants',
    );
    expect(protocol.watchScope).toMatchObject({
      scopeKind: 'search',
      tabId: null,
      reason: 'generic_search_category_match',
      boundary: {
        deterministicGuidanceOnly: true,
        realBrowserProven: false,
        commercialGradeProven: false,
      },
    });
    expect(protocol.watchScope.regions.map((region) => region.regionId)).toEqual([
      'query_input',
      'result_region',
      'empty_state',
    ]);
    expect(protocol.highValueObjects.map((item) => item.label).join(' ')).not.toMatch(
      /Download app/i,
    );
  });

  it('keeps neutral read pages idle instead of treating read mode as long_content', () => {
    const protocol = buildTaskProtocol(createBaseParams({ pageRole: 'web_page' }) as any);

    expect(protocol.taskMode).toBe('read');
    expect(protocol.watchScope.scopeKind).toBe('idle');
    expect(protocol.watchScope.regions).toEqual([]);
  });

  it('surfaces V3 collaboration watch scopes through the read_page task protocol', () => {
    const cases = [
      {
        name: 'auth',
        params: createBaseParams({ pageRole: 'login_required', primaryRegion: 'login_form' }),
        expectedScope: 'auth',
        expectedRegions: ['credential_input', 'auth_submit_control', 'auth_feedback_region'],
      },
      {
        name: 'challenge',
        params: createBaseParams({ pageRole: 'challenge_required' }),
        expectedScope: 'challenge',
        expectedRegions: ['challenge_prompt', 'verification_input', 'challenge_feedback_region'],
      },
      {
        name: 'multi_tab',
        params: createBaseParams({
          pageRole: 'tab_management',
          primaryRegion: 'window_state',
        }),
        expectedScope: 'multi_tab',
        expectedRegions: ['tab_set', 'active_tab', 'window_focus_state'],
      },
      {
        name: 'user_takeover',
        params: createBaseParams({ pageRole: 'user_took_over' }),
        expectedScope: 'user_takeover',
        expectedRegions: ['user_activity_region', 'protected_focus_region'],
      },
      {
        name: 'error_recovery',
        params: createBaseParams({ pageRole: 'error_page_detected' }),
        expectedScope: 'error_recovery',
        expectedRegions: ['error_indicator', 'retry_control', 'recovery_feedback_region'],
      },
    ] as const;

    for (const item of cases) {
      const protocol = buildTaskProtocol(item.params as any);

      expect(protocol.watchScope.scopeKind).toBe(item.expectedScope);
      expect(protocol.watchScope.regions.map((region) => region.regionId)).toEqual(
        item.expectedRegions,
      );
      expect(protocol.watchScope.boundary).toMatchObject({
        deterministicGuidanceOnly: true,
        browserHygieneProven: false,
        realBrowserProven: false,
        commercialGradeProven: false,
      });
    }
  });

  it.each([
    {
      name: 'maps repo_home to read from role and primary region',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: 'ref_issues', role: 'link', name: 'Issues' },
          { ref: 'ref_pulls', role: 'link', name: 'Pull requests' },
          { ref: 'ref_actions', role: 'link', name: 'Actions' },
        ],
      }),
      expected: 'read',
    },
    {
      name: 'maps issues_list to search from role region and controls',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/issues',
        currentTitle: 'Issues',
        pageRole: 'issues_list',
        primaryRegion: 'issues_results',
        interactiveElements: [
          { ref: 'ref_search', role: 'textbox', name: 'Search Issues' },
          { ref: 'ref_filter', role: 'combobox', name: 'Filter issues' },
          { ref: 'ref_entry', role: 'link', name: 'Issue entries' },
        ],
      }),
      expected: 'search',
    },
    {
      name: 'maps actions_list to monitor from workflow controls',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/actions',
        currentTitle: 'Actions',
        pageRole: 'actions_list',
        primaryRegion: 'workflow_runs_list',
        interactiveElements: [
          { ref: 'ref_filter', role: 'textbox', name: 'Filter workflow runs' },
          { ref: 'ref_run', role: 'link', name: 'Run detail entry' },
        ],
      }),
      expected: 'monitor',
    },
    {
      name: 'maps workflow_run_detail to monitor from diagnostics region',
      params: createBaseParams({
        currentUrl: 'https://github.com/example/project/actions/runs/42',
        currentTitle: 'Workflow run detail',
        pageRole: 'workflow_run_detail',
        primaryRegion: 'workflow_run_summary',
        interactiveElements: [
          { ref: 'ref_summary', role: 'link', name: 'Summary' },
          { ref: 'ref_jobs', role: 'button', name: 'Jobs' },
          { ref: 'ref_logs', role: 'link', name: 'Logs' },
        ],
      }),
      expected: 'monitor',
    },
    {
      name: 'detects compare from compare-specific title and controls',
      params: createBaseParams({
        currentUrl: 'https://example.com/review/diff',
        currentTitle: 'Compare revisions',
        interactiveElements: [
          { ref: 'ref_compare', role: 'link', name: 'Compare selected versions' },
        ],
      }),
      expected: 'compare',
    },
    {
      name: 'detects extract from export-oriented controls and high-value labels',
      params: createBaseParams({
        currentUrl: 'https://example.com/admin/report',
        currentTitle: 'Monthly report',
        interactiveElements: [
          { ref: 'ref_export', role: 'button', name: 'Export CSV' },
          { ref: 'ref_download', role: 'link', name: 'Download JSON' },
        ],
        candidateActions: [
          {
            id: 'ca_click_ref_export',
            actionType: 'click',
            targetRef: 'ref_export',
            confidence: 0.84,
            matchReason: 'primary export action in results toolbar',
            locatorChain: [{ type: 'aria', value: 'Export CSV' }],
          },
        ],
      }),
      expected: 'extract',
    },
  ])('$name', ({ params, expected }) => {
    const protocol = buildTaskProtocol(params as any);
    expect(protocol.taskMode).toBe(expected);
  });

  it('does not infer search from a non-GitHub issues route without structured search evidence', () => {
    const protocol = buildTaskProtocol(
      createBaseParams({
        currentUrl: 'https://example.com/issues',
        currentTitle: 'Issues',
        pageRole: 'web_page',
        primaryRegion: 'main_content',
        interactiveElements: [{ ref: 'ref_article', role: 'link', name: 'Known platform issues' }],
        candidateActions: [
          {
            id: 'ca_click_ref_article',
            actionType: 'click',
            targetRef: 'ref_article',
            confidence: 0.72,
            matchReason: 'content item from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Known platform issues' }],
          },
        ],
      }) as any,
    );

    expect(protocol.taskMode).toBe('read');
    expect(protocol.watchScope.scopeKind).not.toBe('search');
  });

  // ----- B-011: stable targetRef on HVO ----------------------------------
  describe('B-011 stable targetRef integration', () => {
    function buildRepoHomeParams(refSuffix: string) {
      return createBaseParams({
        currentUrl: 'https://github.com/example/project',
        currentTitle: 'example/project',
        pageRole: 'repo_home',
        primaryRegion: 'repo_primary_nav',
        interactiveElements: [
          { ref: `ref_issues_${refSuffix}`, role: 'link', name: 'Issues' },
          { ref: `ref_pulls_${refSuffix}`, role: 'link', name: 'Pull requests' },
          { ref: `ref_actions_${refSuffix}`, role: 'link', name: 'Actions' },
        ],
        candidateActions: [
          {
            id: `ca_click_ref_issues_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_issues_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Issues' }],
          },
          {
            id: `ca_click_ref_pulls_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_pulls_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Pull requests' }],
          },
          {
            id: `ca_click_ref_actions_${refSuffix}`,
            actionType: 'click',
            targetRef: `ref_actions_${refSuffix}`,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: 'Actions' }],
          },
        ],
      });
    }

    it('emits a tgt_<10-hex> targetRef on every link-bearing HVO', () => {
      const protocol = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const top = protocol.highValueObjects.slice(0, 3);
      for (const obj of top) {
        expect(obj.targetRef).toMatch(/^tgt_[0-9a-f]{10}$/);
      }
    });

    it('keeps targetRef stable across re-reads when only per-snapshot ref values churn', () => {
      const a = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const b = buildTaskProtocol(buildRepoHomeParams('b') as any);
      const issuesA = a.highValueObjects.find((o) => o.label === 'Issues');
      const issuesB = b.highValueObjects.find((o) => o.label === 'Issues');
      expect(issuesA?.targetRef).toBeTruthy();
      expect(issuesA?.targetRef).toBe(issuesB?.targetRef);
      // Note: the synthesized repo-nav-tab HVO carries no per-snapshot ref
      // (seed-only path), but the targetRef equality above is the contract
      // we rely on for cross-reload upstream reuse, not the underlying ref.
    });

    it('produces distinct targetRefs for distinct logical objects', () => {
      const protocol = buildTaskProtocol(buildRepoHomeParams('a') as any);
      const labels = ['Issues', 'Pull requests', 'Actions'];
      const refs = labels
        .map((l) => protocol.highValueObjects.find((o) => o.label === l)?.targetRef)
        .filter((v): v is string => Boolean(v));
      expect(refs.length).toBe(3);
      expect(new Set(refs).size).toBe(3);
    });
  });

  describe('R4A page region perception', () => {
    it('emits generic navigation content form and feedback regions from neutral page evidence', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/workspace',
          currentTitle: 'Workspace',
          pageRole: 'web_page',
          primaryRegion: 'main_content',
          interactiveElements: [
            { ref: 'ref_home', role: 'link', name: 'Home navigation' },
            { ref: 'ref_article', role: 'link', name: 'Main article content' },
            { ref: 'ref_search', role: 'textbox', name: 'Search form input' },
            { ref: 'ref_status', role: 'status', name: 'Success message saved' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_home',
              actionType: 'click',
              targetRef: 'ref_home',
              confidence: 0.7,
              matchReason: 'navigation candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: 'Home navigation' }],
            },
            {
              id: 'ca_fill_ref_search',
              actionType: 'fill',
              targetRef: 'ref_search',
              confidence: 0.7,
              matchReason: 'form input candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: 'Search form input' }],
            },
          ],
        }) as any,
      );

      const regionTypes = protocol.pageRegions.map((item) => item.regionType);
      expect(regionTypes).toEqual(
        expect.arrayContaining(['navigation', 'content', 'form', 'feedback']),
      );
      expect(protocol.pageRegions.find((item) => item.regionType === 'form')?.targetability).toBe(
        'target_ref',
      );
      expect(
        protocol.pageRegions.find((item) => item.regionType === 'feedback')?.claimBoundary,
      ).toContain('region candidate');
      expect(protocol.pageOperationMap.zones.map((item) => item.purpose)).toEqual(
        expect.arrayContaining(['navigate', 'read_content', 'search', 'observe_feedback']),
      );
      expect(protocol.pageOperationMap.claimBoundary).toContain('planning guidance');
      expect(protocol.pageOperationMap.claimBoundary).toContain('AI assistant');
      expect(protocol.pageOperationMap.summary).toContain(
        'candidate zones needing AI interpretation',
      );
    });

    it('builds a visible global menu map from left sidebar app-shell entries', () => {
      const menuItems = [
        ['ref_home', '首页'],
        ['ref_discover', '点点'],
        ['ref_live', '直播'],
        ['ref_publish', '发布'],
        ['ref_messages', '消息'],
        ['ref_me', '我'],
        ['ref_more', '更多'],
        ['ref_about', '关于我们'],
      ].map(([ref, name], index) => ({
        ref,
        role: 'button',
        name,
        rect: { x: 24, y: 72 + index * 56, width: 160, height: 44 },
      }));
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral app shell',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: menuItems,
          candidateActions: menuItems.map((item) => ({
            id: `ca_click_${item.ref}`,
            actionType: 'click',
            targetRef: item.ref,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: item.name }],
          })),
        }) as any,
      );

      const navigationRegion = protocol.pageRegions.find(
        (item) => item.regionType === 'navigation',
      );
      const navigationZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionId === navigationRegion?.regionId,
      );

      expect(navigationRegion).toMatchObject({
        state: 'global_menu_available_candidate',
        layoutHint: 'left_sidebar',
        targetability: 'target_ref',
      });
      expect(navigationRegion?.label).toContain('left_sidebar global menu');
      expect(navigationRegion?.objects.map((item) => item.label)).toEqual(
        expect.arrayContaining(['首页', '点点', '直播', '发布', '消息', '我', '更多', '关于我们']),
      );
      expect(navigationRegion?.objects.find((item) => item.label === '更多')).toMatchObject({
        menuItemRole: 'overflow_menu_trigger',
        layoutHint: 'left_sidebar',
      });
      expect(navigationRegion?.candidateActionIds).toEqual(
        expect.arrayContaining(['ca_click_ref_more', 'ca_click_ref_me']),
      );
      expect(navigationZone).toMatchObject({
        purpose: 'navigate',
        label: 'global navigation menu',
        readiness: 'ready',
      });
      expect(navigationZone?.claimBoundary).toContain('selected-page success');
    });

    it('does not promote content author profile links into global menu labels', () => {
      const navItems = [
        ['ref_home', 'Home', '/'],
        ['ref_more', 'More', '/more'],
        ['ref_settings', 'Settings', '/settings'],
        ['ref_help', 'Help', '/help'],
      ].map(([ref, name, href], index) => ({
        ref,
        role: 'link',
        name,
        href,
        rect: { x: 24 + index * 84, y: 24, width: 72, height: 32 },
      }));
      const authorLinks = [
        ['ref_author_1', 'surprisetalk', '/user?id=surprisetalk'],
        ['ref_author_2', 'crescit_eundo', '/user?id=crescit_eundo'],
      ].map(([ref, name, href], index) => ({
        ref,
        role: 'link',
        name,
        href,
        rect: { x: 24 + index * 120, y: 96, width: 100, height: 24 },
      }));
      const elements = [...navItems, ...authorLinks];
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/list',
          currentTitle: 'Neutral list page',
          pageRole: 'web_page',
          primaryRegion: 'list',
          interactiveElements: elements,
          candidateActions: elements.map((item) => ({
            id: `ca_click_${item.ref}`,
            actionType: 'click',
            targetRef: item.ref,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: item.name }],
          })),
        }) as any,
      );

      const menuLabels = protocol.pageRegions
        .filter((item) => item.regionType === 'navigation' || item.regionType === 'menu')
        .flatMap((item) => item.objects.map((object) => object.label));

      expect(menuLabels).toEqual(expect.arrayContaining(['Home', 'More', 'Settings', 'Help']));
      expect(menuLabels).not.toContain('surprisetalk');
      expect(menuLabels).not.toContain('crescit_eundo');
    });

    it('adds a derived search zone for menu search triggers without treating auth entries as search', () => {
      const menuItems = [
        ['ref_docs', 'Docs'],
        ['ref_blog', 'Blog'],
        ['ref_search', 'Search the site'],
        ['ref_tools', 'Tools'],
        ['ref_signin', 'Sign in'],
      ].map(([ref, name], index) => ({
        ref,
        role: 'button',
        name,
        rect: { x: 720 + index * 84, y: 24, width: 76, height: 32 },
      }));
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/docs',
          currentTitle: 'Docs',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: menuItems,
          candidateActions: menuItems.map((item) => ({
            id: `ca_click_${item.ref}`,
            actionType: 'click',
            targetRef: item.ref,
            confidence: 0.72,
            matchReason: 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: item.name }],
          })),
        }) as any,
      );

      const searchZones = protocol.pageOperationMap.zones.filter(
        (item) => item.purpose === 'search',
      );
      const derivedSearchZone = searchZones.find((item) => item.label === 'search entry trigger');

      expect(derivedSearchZone).toMatchObject({
        purpose: 'search',
        state: 'search_entry_needs_expand_candidate',
        readiness: 'needs_expand',
        primaryAction: {
          candidateActionId: 'ca_click_ref_search',
          toolName: 'chrome_click_element',
        },
      });
      expect(derivedSearchZone?.claimBoundary).toContain('fresh post-action page read');
      expect(
        searchZones.some((item) => item.primaryAction?.candidateActionId === 'ca_click_ref_signin'),
      ).toBe(false);
    });

    it('keeps search entry visible in operation map when the region map is sparse', () => {
      const elements = [
        {
          ref: 'ref_search',
          role: 'button',
          name: 'Search the site',
          rect: { x: 980, y: 32, width: 112, height: 32 },
        },
        {
          ref: 'ref_signin',
          role: 'button',
          name: 'Sign in',
          rect: { x: 1110, y: 32, width: 80, height: 32 },
        },
      ];
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/docs',
          currentTitle: 'Docs',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: elements,
          candidateActions: elements.map((item) => ({
            id: `ca_click_${item.ref}`,
            actionType: 'click',
            targetRef: item.ref,
            confidence: 0.72,
            matchReason: 'primary action inferred from interactive label',
            locatorChain: [{ type: 'aria', value: item.name }],
          })),
        }) as any,
      );

      expect(protocol.pageRegions.some((item) => item.regionType === 'navigation')).toBe(false);
      expect(protocol.pageOperationMap.zones).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            purpose: 'search',
            label: 'search entry trigger',
            primaryAction: expect.objectContaining({
              candidateActionId: 'ca_click_ref_search',
              toolName: 'chrome_click_element',
            }),
          }),
        ]),
      );
      expect(
        protocol.pageOperationMap.zones
          .filter((item) => item.purpose === 'search')
          .some((item) => item.primaryAction?.candidateActionId === 'ca_click_ref_signin'),
      ).toBe(false);
    });

    it('does not redact a search dialog input as auth just because it lives in a dialog', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/docs',
          currentTitle: 'Docs',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            {
              ref: 'ref_dialog_search',
              role: 'searchbox',
              name: 'Search the site',
              rect: { x: 420, y: 180, width: 360, height: 42 },
            },
          ],
          candidateActions: [
            {
              id: 'ca_fill_ref_dialog_search',
              actionType: 'fill',
              targetRef: 'ref_dialog_search',
              confidence: 0.9,
              matchReason: 'primary action inferred from interactive label',
              locatorChain: [{ type: 'css', value: 'body > dialog > form > input' }],
            },
          ],
        }) as any,
      );

      const searchZone = protocol.pageOperationMap.zones.find(
        (item) => item.purpose === 'search' && item.primaryAction?.actionType === 'fill',
      );

      expect(searchZone).toMatchObject({
        label: 'search area',
        readiness: 'ready',
        primaryAction: {
          candidateActionId: 'ca_fill_ref_dialog_search',
          toolName: 'chrome_fill_or_select',
        },
      });
      expect(JSON.stringify(searchZone)).not.toContain('redacted_auth_action_signal');
    });

    it('keeps a search trigger actionable when it was grouped under content', () => {
      const operationMap = buildPageOperationMap([
        {
          regionId: 'region_content',
          regionType: 'content',
          state: 'content_available_candidate',
          confidence: 0.7,
          label: 'content: Ad',
          candidateActionIds: ['ca_click_ref_ad', 'ca_click_ref_search'],
          targetability: 'target_ref',
          claimBoundary: 'region candidate only',
          objects: [
            {
              objectId: 'ref_ad',
              label: 'Ad',
              role: 'button',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.7,
              reason: 'candidate_action_region_signal',
              primaryAction: {
                candidateActionId: 'ca_click_ref_ad',
                actionType: 'click',
                targetRef: 'ref_ad',
                locatorChain: [{ type: 'aria', value: 'Ad' }],
                toolName: 'chrome_click_element',
                toolArgs: {
                  candidateAction: {
                    id: 'ca_click_ref_ad',
                    actionType: 'click',
                    targetRef: 'ref_ad',
                    confidence: 0.7,
                    matchReason: 'primary action inferred from interactive label',
                    locatorChain: [{ type: 'aria', value: 'Ad' }],
                  },
                },
                claimBoundary: 'execution hint only',
              },
            },
            {
              objectId: 'ref_search',
              label: 'Search the site',
              role: 'button',
              actionTypes: ['click'],
              targetability: 'target_ref',
              confidence: 0.8,
              reason: 'candidate_action_region_signal',
              primaryAction: {
                candidateActionId: 'ca_click_ref_search',
                actionType: 'click',
                targetRef: 'ref_search',
                locatorChain: [{ type: 'aria', value: 'Search the site' }],
                toolName: 'chrome_click_element',
                toolArgs: {
                  candidateAction: {
                    id: 'ca_click_ref_search',
                    actionType: 'click',
                    targetRef: 'ref_search',
                    confidence: 0.8,
                    matchReason: 'primary action inferred from interactive label',
                    locatorChain: [{ type: 'aria', value: 'Search the site' }],
                  },
                },
                claimBoundary: 'execution hint only',
              },
            },
          ],
        },
      ] as any);

      const contentZone = operationMap.zones.find((item) => item.regionType === 'content');
      const searchZone = operationMap.zones.find(
        (item) => item.purpose === 'search' && item.label === 'search entry trigger',
      );

      expect(contentZone?.candidateActionIds).toContain('ca_click_ref_search');
      expect(searchZone).toMatchObject({
        state: 'search_entry_needs_expand_candidate',
        readiness: 'needs_expand',
        primaryAction: {
          candidateActionId: 'ca_click_ref_search',
          toolName: 'chrome_click_element',
        },
      });
    });

    it('recognizes global menu maps in common desktop and mobile placements', () => {
      const placements = [
        {
          expectedLayout: 'top_navigation',
          rectForIndex: (index: number) => ({ x: 420 + index * 120, y: 24, width: 88, height: 40 }),
        },
        {
          expectedLayout: 'top_right',
          rectForIndex: (index: number) => ({ x: 960 + index * 58, y: 24, width: 48, height: 40 }),
        },
        {
          expectedLayout: 'right_sidebar',
          rectForIndex: (index: number) => ({
            x: 1030,
            y: 280 + index * 52,
            width: 120,
            height: 40,
          }),
        },
        {
          expectedLayout: 'bottom_navigation',
          rectForIndex: (index: number) => ({
            x: 220 + index * 120,
            y: 650,
            width: 84,
            height: 44,
          }),
        },
      ] as const;

      for (const placement of placements) {
        const menuItems = ['Home', 'Messages', 'Create', 'More'].map((name, index) => ({
          ref: `ref_${placement.expectedLayout}_${index}`,
          role: 'button',
          name,
          rect: placement.rectForIndex(index),
        }));
        const protocol = buildTaskProtocol(
          createBaseParams({
            currentUrl: 'https://example.com/app',
            currentTitle: 'Neutral app shell',
            pageRole: 'web_page',
            primaryRegion: 'app_shell',
            interactiveElements: menuItems,
            candidateActions: menuItems.map((item) => ({
              id: `ca_click_${item.ref}`,
              actionType: 'click',
              targetRef: item.ref,
              confidence: 0.72,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: item.name }],
            })),
          }) as any,
        );

        const navigationRegion = protocol.pageRegions.find(
          (item) => item.regionType === 'navigation',
        );
        expect(navigationRegion).toMatchObject({
          state: 'global_menu_available_candidate',
          layoutHint: placement.expectedLayout,
        });
        expect(navigationRegion?.targetability).not.toBe('not_clickable');
        expect(navigationRegion?.objects.map((item) => item.label)).toEqual(
          expect.arrayContaining(['Home', 'Messages', 'Create', 'More']),
        );
      }
    });

    it('promotes visible text app-shell menu labels when the accessibility tree is sparse', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral app shell',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            {
              ref: 'ref_messages',
              role: 'link',
              name: '消息',
              rect: { x: 24, y: 320, width: 116, height: 48 },
            },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_messages',
              actionType: 'click',
              targetRef: 'ref_messages',
              confidence: 0.72,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: '消息' }],
            },
          ],
          visibleTextContent: [
            '首页',
            '工作台',
            'ai',
            '直播',
            '发布',
            '消息',
            '我',
            'ICP备案 | 营业执照 | 网络文化经营许可证',
            '更多',
            '关于我们',
            '推荐',
            '今日内容列表',
          ].join('\n'),
        }) as any,
      );

      const navigationRegion = protocol.pageRegions.find(
        (item) => item.regionType === 'navigation',
      );
      const labels = navigationRegion?.objects.map((item) => item.label) ?? [];

      expect(navigationRegion).toMatchObject({
        state: 'global_menu_available_candidate',
        layoutHint: 'unknown',
      });
      expect(labels).toEqual(
        expect.arrayContaining([
          '首页',
          '工作台 ai',
          '直播',
          '发布',
          '消息',
          '我',
          '更多',
          '关于我们',
        ]),
      );
      expect(labels).not.toEqual(
        expect.arrayContaining(['ICP备案', '营业执照', '网络文化经营许可证']),
      );
      expect(navigationRegion?.objects.find((item) => item.label === '工作台 ai')).toMatchObject({
        reason: 'visible_text_global_menu_item_signal',
        targetability: 'not_clickable',
      });
      expect(navigationRegion?.objects.find((item) => item.label === '更多')).toMatchObject({
        menuItemRole: 'overflow_menu_trigger',
      });
      expect(navigationRegion?.objects.find((item) => item.label === '我')).toMatchObject({
        menuItemRole: 'account_entry',
      });
      expect(navigationRegion?.candidateActionIds).toContain('ca_click_ref_messages');
      expect(navigationRegion?.claimBoundary).toContain('menu map candidate only');
    });

    it('emits generic account and menu regions with bounded targetability', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Operator console',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_profile', role: 'button', name: 'Private Name account profile' },
            { ref: 'ref_more', role: 'button', name: 'More actions' },
            { ref: 'ref_logout', role: 'menuitem', name: 'Sign out' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_more',
              actionType: 'click',
              targetRef: 'ref_more',
              confidence: 0.72,
              matchReason: 'expand account menu candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: 'More actions' }],
            },
            {
              id: 'ca_click_ref_logout',
              actionType: 'click',
              targetRef: 'ref_logout',
              confidence: 0.74,
              matchReason: 'logout action candidate from expanded menu',
              locatorChain: [{ type: 'aria', value: 'Sign out' }],
            },
          ],
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');
      const menuRegion = protocol.pageRegions.find((item) => item.regionType === 'menu');

      expect(accountRegion?.state).toBe('account_menu_trigger_candidate');
      expect(accountRegion?.targetability).toBe('target_ref');
      expect(accountRegion?.claimBoundary).toContain('auth success or logout success requires');
      expect(accountRegion?.objects.map((item) => item.label)).toEqual(
        expect.arrayContaining(['account action candidate']),
      );
      expect(menuRegion?.state).toBe('action_available_candidate');
      expect(menuRegion?.candidateActionIds).toContain('ca_click_ref_logout');
      expect(menuRegion?.claimBoundary).toContain(
        'click success or timeout is not business success',
      );
      expect(menuRegion?.objects.map((item) => item.label)).toEqual(
        expect.arrayContaining(['logout action candidate']),
      );

      const accountZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionType === 'account',
      );
      const menuZone = protocol.pageOperationMap.zones.find((item) => item.regionType === 'menu');
      expect(accountZone).toMatchObject({
        purpose: 'open_menu',
        label: 'account menu trigger candidate',
        readiness: 'needs_expand',
      });
      expect(menuZone).toMatchObject({
        purpose: 'open_menu',
        label: 'menu actions candidate',
        readiness: 'ready',
      });
      expect(menuZone?.candidateActionIds).toContain('ca_click_ref_logout');
      expect(JSON.stringify(protocol.pageRegions)).not.toContain('Private Name');
      expect(JSON.stringify(protocol.pageRegions)).not.toContain('Sign out');
      expect(JSON.stringify(protocol)).not.toContain('Private Name');
      expect(JSON.stringify(protocol)).not.toContain('Sign out');
    });

    it('keeps expanded logout menu items targetable after global menu mapping', () => {
      const menuItems = [
        ['ref_home', 'Home'],
        ['ref_messages', 'Messages'],
        ['ref_me', 'Me'],
        ['ref_more', 'More'],
        ['ref_logout', '退出登录'],
      ].map(([ref, name], index) => ({
        ref,
        role: ref === 'ref_logout' ? 'menuitem' : 'button',
        name,
        rect: { x: 24, y: 72 + index * 56, width: 160, height: 44 },
      }));
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral app shell',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: menuItems,
          candidateActions: menuItems.map((item) => ({
            id: `ca_click_${item.ref}`,
            actionType: 'click',
            targetRef: item.ref,
            confidence: 0.72,
            matchReason:
              item.ref === 'ref_logout'
                ? 'logout action candidate from expanded menu'
                : 'interactive clickable candidate from structured snapshot',
            locatorChain: [{ type: 'aria', value: item.name }],
          })),
        }) as any,
      );

      const navigationRegion = protocol.pageRegions.find(
        (item) => item.regionType === 'navigation',
      );
      const menuRegion = protocol.pageRegions.find((item) => item.regionType === 'menu');

      expect(navigationRegion?.objects.map((item) => item.label)).not.toEqual(
        expect.arrayContaining(['logout action candidate']),
      );
      expect(menuRegion).toMatchObject({
        state: 'action_available_candidate',
      });
      expect(menuRegion?.targetability).not.toBe('not_clickable');
      expect(menuRegion?.candidateActionIds).toContain('ca_click_ref_logout');
      expect(menuRegion?.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'logout action candidate',
            targetRef: 'ref_logout',
            targetability: 'locator_chain',
            primaryAction: expect.objectContaining({
              candidateActionId: 'ca_click_ref_logout',
              toolName: 'chrome_click_element',
              toolArgs: {
                candidateAction: expect.objectContaining({
                  targetRef: 'ref_logout',
                  matchReason: 'redacted_logout_action_signal',
                  locatorChain: [{ type: 'ref', value: 'ref_logout' }],
                }),
              },
            }),
          }),
        ]),
      );
      expect(
        menuRegion?.objects.find((item) => item.targetRef === 'ref_logout')?.primaryAction,
      ).toMatchObject({
        actionType: 'click',
        targetRef: 'ref_logout',
        claimBoundary: expect.stringContaining('post-action verification'),
      });
      expect(
        protocol.pageOperationMap.zones.find((item) => item.regionType === 'menu')?.primaryAction,
      ).toMatchObject({
        candidateActionId: 'ca_click_ref_logout',
        toolName: 'chrome_click_element',
      });
      expect(JSON.stringify(protocol)).not.toContain('退出登录');
    });

    it('surfaces an executable primaryAction payload for visible navigation entries', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral app shell',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            {
              ref: 'ref_docs',
              role: 'link',
              name: 'Docs',
              href: 'https://example.com/docs',
              rect: { x: 16, y: 12, width: 72, height: 32 },
            },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_docs',
              actionType: 'click',
              targetRef: 'ref_docs',
              confidence: 0.82,
              matchReason: 'navigation candidate from structured snapshot',
              locatorChain: [
                { type: 'aria', value: 'Docs' },
                { type: 'css', value: 'nav a[href="/docs"]' },
              ],
            },
          ],
        }) as any,
      );

      const navigationRegion = protocol.pageRegions.find(
        (item) => item.regionType === 'navigation',
      );
      const docsObject = navigationRegion?.objects.find((item) => item.label === 'Docs');
      expect(docsObject?.primaryAction).toMatchObject({
        candidateActionId: 'ca_click_ref_docs',
        actionType: 'click',
        targetRef: 'ref_docs',
        toolName: 'chrome_click_element',
        toolArgs: {
          candidateAction: {
            id: 'ca_click_ref_docs',
            actionType: 'click',
            targetRef: 'ref_docs',
            confidence: 0.82,
            matchReason: 'navigation candidate from structured snapshot',
            locatorChain: [
              { type: 'aria', value: 'Docs' },
              { type: 'css', value: 'nav a[href="/docs"]' },
            ],
          },
        },
      });
      expect(
        protocol.pageOperationMap.zones.find((item) => item.regionType === 'navigation')
          ?.primaryAction,
      ).toMatchObject({
        candidateActionId: 'ca_click_ref_docs',
        toolName: 'chrome_click_element',
      });
    });

    it('keeps visible-text logout menu signals out of the primary navigation map', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral app shell',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          visibleTextContent: [
            'Home',
            'Messages',
            'Me',
            'More',
            'Settings',
            '退出登录',
            'About',
          ].join('\n'),
        }) as any,
      );

      const navigationRegion = protocol.pageRegions.find(
        (item) => item.regionType === 'navigation',
      );
      const menuRegion = protocol.pageRegions.find((item) => item.regionType === 'menu');

      expect(navigationRegion?.objects.map((item) => item.label)).not.toEqual(
        expect.arrayContaining(['退出登录', 'logout action candidate']),
      );
      expect(menuRegion).toMatchObject({
        state: 'action_available_candidate',
        targetability: 'not_clickable',
      });
      expect(menuRegion?.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'logout action candidate',
            targetability: 'not_clickable',
          }),
        ]),
      );
      expect(JSON.stringify(protocol)).not.toContain('退出登录');
    });

    it('redacts account/menu/auth action labels in default AI-facing read surfaces', () => {
      const interactiveElements = [
        { ref: 'ref_profile', role: 'button', name: 'Private Name account profile' },
        { ref: 'ref_logout', role: 'menuitem', name: 'Sign out' },
        { ref: 'ref_home', role: 'link', name: 'Home navigation' },
      ];
      const candidateActions = [
        {
          id: 'ca_click_ref_profile',
          actionType: 'click',
          targetRef: 'ref_profile',
          confidence: 0.72,
          matchReason: 'expand account menu candidate for Private Name',
          locatorChain: [{ type: 'aria', value: 'Private Name account profile' }],
        },
        {
          id: 'ca_click_ref_logout',
          actionType: 'click',
          targetRef: 'ref_logout',
          confidence: 0.74,
          matchReason: 'logout action candidate from expanded menu',
          locatorChain: [
            { type: 'aria', value: 'Sign out' },
            { type: 'css', value: 'nav [data-testid="logout"]' },
          ],
        },
        {
          id: 'ca_click_ref_home',
          actionType: 'click',
          targetRef: 'ref_home',
          confidence: 0.7,
          matchReason: 'navigation candidate from structured snapshot',
          locatorChain: [{ type: 'aria', value: 'Home navigation' }],
        },
      ];

      const aiFacingInteractive = redactSensitiveInteractiveElementsForAi(
        interactiveElements,
        candidateActions,
      );
      const aiFacingActions = redactSensitiveCandidateActionsForAi(
        candidateActions,
        interactiveElements,
      );

      expect(aiFacingInteractive).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ref: 'ref_profile', name: 'menu action candidate' }),
          expect.objectContaining({ ref: 'ref_logout', name: 'logout action candidate' }),
          expect.objectContaining({ ref: 'ref_home', name: 'Home navigation' }),
        ]),
      );
      expect(aiFacingActions.find((item) => item.id === 'ca_click_ref_profile')).toMatchObject({
        matchReason: 'redacted_menu_action_signal',
        locatorChain: [{ type: 'ref', value: 'ref_profile' }],
      });
      expect(aiFacingActions.find((item) => item.id === 'ca_click_ref_logout')).toMatchObject({
        matchReason: 'redacted_logout_action_signal',
        locatorChain: [{ type: 'css', value: 'nav [data-testid="logout"]' }],
      });
      expect(aiFacingActions.find((item) => item.id === 'ca_click_ref_home')).toMatchObject({
        matchReason: 'navigation candidate from structured snapshot',
        locatorChain: [{ type: 'aria', value: 'Home navigation' }],
      });
      expect(JSON.stringify(aiFacingInteractive)).not.toContain('Private Name');
      expect(JSON.stringify(aiFacingInteractive)).not.toContain('Sign out');
      expect(JSON.stringify(aiFacingActions)).not.toContain('Private Name');
      expect(JSON.stringify(aiFacingActions)).not.toContain('Sign out');
    });

    it('surfaces unlabeled clickable controls as exploratory operation entries, not account facts', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral application',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_icon_button', role: 'button', name: '' },
            { ref: 'ref_content', role: 'link', name: 'Main content item' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_icon_button',
              actionType: 'click',
              targetRef: 'ref_icon_button',
              confidence: 0.57,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [{ type: 'css', value: '[data-test-id="neutral-action"]' }],
            },
          ],
        }) as any,
      );

      const exploratoryRegion = protocol.pageRegions.find((item) => item.regionType === 'unknown');
      const exploratoryZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionId === exploratoryRegion?.regionId,
      );

      expect(exploratoryRegion?.objects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: 'unlabeled clickable control',
            reason: 'targetable_unclassified_action_control',
          }),
        ]),
      );
      expect(exploratoryRegion?.candidateActionIds).toContain('ca_click_ref_icon_button');
      expect(exploratoryZone).toMatchObject({
        purpose: 'open_menu',
        label: 'unlabeled action/menu candidate',
        readiness: 'needs_expand',
        evidenceLevel: 'targetable_exploratory_control',
      });
      expect(exploratoryZone?.claimBoundary).toContain(
        'not proven menu, account, or logout actions',
      );
      expect(protocol.pageRegions.some((item) => item.regionType === 'account')).toBe(false);
    });

    it('promotes account-like candidate action signals into account regions before exploratory fallback', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral application',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_plain', role: 'button', name: '' },
            { ref: 'ref_profile_like', role: 'button', name: '' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_plain',
              actionType: 'click',
              targetRef: 'ref_plain',
              confidence: 0.9,
              matchReason: 'generic clickable control',
              locatorChain: [{ type: 'ref', value: 'ref_plain' }],
            },
            {
              id: 'ca_click_ref_profile_like',
              actionType: 'click',
              targetRef: 'ref_profile_like',
              confidence: 0.45,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [{ type: 'aria', value: 'account profile button' }],
            },
          ],
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');
      const unknownRegion = protocol.pageRegions.find((item) => item.regionType === 'unknown');

      expect(accountRegion).toMatchObject({
        targetability: 'target_ref',
        candidateActionIds: ['ca_click_ref_profile_like'],
      });
      expect(accountRegion?.objects[0]).toMatchObject({
        label: 'account action candidate',
        reason: 'redacted_account_action_signal',
      });
      expect(unknownRegion?.candidateActionIds).not.toContain('ca_click_ref_profile_like');
      expect(
        protocol.pageOperationMap.zones.find((item) => item.regionId === accountRegion?.regionId),
      ).toMatchObject({
        purpose: 'account',
        state: 'profile_route_candidate',
        readiness: 'unknown',
        evidenceLevel: 'targetable_account_route_signal',
      });
    });

    it('distinguishes account menu triggers from profile route targets before choosing account actions', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral application',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_profile_route', role: 'link', name: 'Profile', href: '/profile/me' },
            { ref: 'ref_account_menu', role: 'button', name: '' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_profile_route',
              actionType: 'click',
              targetRef: 'ref_profile_route',
              confidence: 0.95,
              matchReason: 'profile route link candidate',
              locatorChain: [{ type: 'aria', value: 'Profile' }],
            },
            {
              id: 'ca_click_ref_account_menu',
              actionType: 'click',
              targetRef: 'ref_account_menu',
              confidence: 0.42,
              matchReason: 'expand account menu candidate',
              locatorChain: [{ type: 'aria', value: 'Account menu' }],
            },
          ],
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');
      const accountZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionId === accountRegion?.regionId,
      );

      expect(accountRegion).toMatchObject({
        state: 'account_menu_trigger_candidate',
        candidateActionIds: ['ca_click_ref_account_menu', 'ca_click_ref_profile_route'],
      });
      expect(accountZone).toMatchObject({
        purpose: 'open_menu',
        label: 'account menu trigger candidate',
        readiness: 'needs_expand',
      });
      expect(accountZone?.claimBoundary).toContain('fresh post-action page read');
    });

    it('treats labeled but unclassified clickable groups as exploratory entries', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral application',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_alpha', role: 'link', name: 'Alpha' },
            { ref: 'ref_beta', role: 'link', name: 'Beta' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_alpha',
              actionType: 'click',
              targetRef: 'ref_alpha',
              confidence: 0.72,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [],
            },
            {
              id: 'ca_click_ref_beta',
              actionType: 'click',
              targetRef: 'ref_beta',
              confidence: 0.72,
              matchReason: 'interactive clickable candidate from structured snapshot',
              locatorChain: [],
            },
          ],
        }) as any,
      );

      const exploratoryRegion = protocol.pageRegions.find((item) => item.regionType === 'unknown');
      const exploratoryZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionId === exploratoryRegion?.regionId,
      );

      expect(exploratoryRegion).toMatchObject({
        targetability: 'target_ref',
        candidateActionIds: ['ca_click_ref_alpha', 'ca_click_ref_beta'],
      });
      expect(exploratoryZone).toMatchObject({
        purpose: 'open_menu',
        label: 'unlabeled action/menu candidate',
        readiness: 'needs_expand',
        evidenceLevel: 'targetable_exploratory_control',
      });
      expect(protocol.pageRegions.some((item) => item.regionType === 'account')).toBe(false);
      expect(exploratoryZone?.claimBoundary).toContain(
        'not proven menu, account, or logout actions',
      );
    });

    it('prioritizes generic account/menu exploratory candidates without exposing raw private labels', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/app',
          currentTitle: 'Neutral application',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_plain', role: 'button', name: '' },
            { ref: 'ref_menu_candidate', role: 'button', name: '' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_plain',
              actionType: 'click',
              targetRef: 'ref_plain',
              confidence: 0.9,
              matchReason: 'generic clickable control',
              locatorChain: [{ type: 'ref', value: 'ref_plain' }],
            },
            {
              id: 'ca_click_ref_menu_candidate',
              actionType: 'click',
              targetRef: 'ref_menu_candidate',
              confidence: 0.4,
              matchReason: 'expand account menu candidate for Private Name',
              locatorChain: [{ type: 'aria', value: 'Private Name account menu' }],
            },
          ],
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');
      const accountZone = protocol.pageOperationMap.zones.find(
        (item) => item.regionId === accountRegion?.regionId,
      );

      expect(accountRegion?.candidateActionIds[0]).toBe('ca_click_ref_menu_candidate');
      expect(accountRegion?.objects.map((item) => item.label)).toEqual(
        expect.arrayContaining(['account action candidate']),
      );
      expect(accountZone).toMatchObject({
        purpose: 'open_menu',
        label: 'account menu trigger candidate',
        readiness: 'needs_expand',
        evidenceLevel: 'targetable_candidate_region_signal_needs_verification',
      });
      expect(JSON.stringify(protocol.pageRegions)).not.toContain('Private Name');
      expect(JSON.stringify(protocol.pageOperationMap)).not.toContain('Private Name');
    });

    it('emits auth modal and QR regions without treating QR presence as login success', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/auth',
          currentTitle: 'Sign in',
          pageRole: 'login_required',
          primaryRegion: 'login_form',
          interactiveElements: [
            { ref: 'ref_dialog', role: 'dialog', name: 'Login dialog' },
            { ref: 'ref_qr', role: 'img', name: 'QR code for scan login' },
            { ref: 'ref_refresh', role: 'button', name: 'Refresh QR code' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_refresh',
              actionType: 'click',
              targetRef: 'ref_refresh',
              confidence: 0.7,
              matchReason: 'refresh qr code candidate from auth modal',
              locatorChain: [{ type: 'aria', value: 'Refresh QR code' }],
            },
          ],
        }) as any,
      );

      const modalRegion = protocol.pageRegions.find((item) => item.regionType === 'modal');
      const qrRegion = protocol.pageRegions.find((item) => item.regionType === 'qr_code');

      expect(modalRegion?.state).toBe('open_candidate');
      expect(qrRegion?.state).toBe('waiting_scan_candidate');
      expect(qrRegion?.candidateActionIds).toContain('ca_click_ref_refresh');
      expect(qrRegion?.claimBoundary).toContain('login success is not proven');

      const authZone = protocol.pageOperationMap.zones.find((item) => item.purpose === 'auth');
      const qrZone = protocol.pageOperationMap.zones.find((item) => item.purpose === 'scan_qr');
      expect(authZone?.label).toBe('auth area candidate');
      expect(qrZone?.claimBoundary).toContain('not login success');
    });

    it('promotes QR visual elements into the QR region with a bounded locator chain', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/auth',
          currentTitle: 'Sign in',
          pageRole: 'login_required',
          primaryRegion: 'login_form',
          interactiveElements: [
            { ref: 'ref_dialog', role: 'dialog', name: 'Login dialog' },
            { ref: 'ref_refresh', role: 'button', name: 'Refresh QR code' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_refresh',
              actionType: 'click',
              targetRef: 'ref_refresh',
              confidence: 0.7,
              matchReason: 'refresh qr code candidate from auth modal',
              locatorChain: [{ type: 'aria', value: 'Refresh QR code' }],
            },
          ],
          visualElements: [
            {
              id: 'qr_visual_1',
              label: 'QR visual element candidate',
              selector: '[data-testid="qr-code"]',
              role: 'img',
              rect: { x: 200, y: 160, width: 180, height: 180 },
              qrSignal: true,
              reason: 'qr_visual_element_signal',
              confidence: 0.88,
            },
          ],
        }) as any,
      );

      const qrRegion = protocol.pageRegions.find((item) => item.regionType === 'qr_code');
      const qrZone = protocol.pageOperationMap.zones.find((item) => item.purpose === 'scan_qr');

      expect(qrRegion?.objects[0]).toMatchObject({
        objectType: 'qr_visual',
        label: 'QR scan area candidate',
        targetability: 'locator_chain',
        actionTypes: ['capture_element'],
        locatorChain: [{ type: 'css', value: '[data-testid="qr-code"]' }],
        reason: 'redacted_qr_region_signal',
      });
      expect(qrRegion?.state).toBe('waiting_scan_candidate');
      expect(qrRegion?.claimBoundary).toContain('login success is not proven');
      expect(qrZone).toMatchObject({
        purpose: 'scan_qr',
        readiness: 'ready',
      });
      expect(qrZone?.claimBoundary).toContain('not login success');
    });

    it('derives account navigation content and feedback regions from bounded visible text signals', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/dynamic-app',
          currentTitle: 'Dynamic app',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [{ ref: 'ref_generic', role: 'generic', name: '' }],
          candidateActions: [],
          visibleTextContent: [
            'window.__APP_STATE__={"authenticated":true,"userInfo":{"id":"private-user-id","displayName":"Private Name"}};',
            'Home Messages Notifications Publish navigation area.',
            'Warning: some optional browser feature is unavailable.',
            'Main feed content '.repeat(40),
          ].join(' '),
        }) as any,
      );

      const regionTypes = protocol.pageRegions.map((item) => item.regionType);
      expect(regionTypes).toEqual(
        expect.arrayContaining(['account', 'navigation', 'content', 'feedback']),
      );
      expect(protocol.pageRegions.find((item) => item.regionType === 'account')?.state).toBe(
        'logged_in_candidate',
      );
      expect(
        protocol.pageRegions.find((item) => item.regionType === 'account')?.targetability,
      ).toBe('not_clickable');
      const serialized = JSON.stringify(protocol.pageRegions);
      expect(serialized).not.toContain('private-user-id');
      expect(serialized).not.toContain('Private Name');
      const operationMap = JSON.stringify(protocol.pageOperationMap);
      expect(operationMap).not.toContain('private-user-id');
      expect(operationMap).not.toContain('Private Name');
      expect(
        protocol.pageOperationMap.zones.find((item) => item.purpose === 'account'),
      ).toMatchObject({
        label: 'account area candidate',
        readiness: 'not_targetable',
        evidenceLevel: 'candidate_text_signal_needs_verification',
      });
    });

    it('does not turn hidden login QR state text into a QR region', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/dynamic-app',
          currentTitle: 'Dynamic app',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [],
          candidateActions: [],
          visibleTextContent:
            'window.__APP_STATE__={"authenticated":true,"showLogin":false,"qrData":{"status":"un_scanned"}}; Home Messages',
        }) as any,
      );

      expect(protocol.pageRegions.find((item) => item.regionType === 'account')?.state).toBe(
        'logged_in_candidate',
      );
      expect(protocol.pageRegions.some((item) => item.regionType === 'qr_code')).toBe(false);
      expect(protocol.pageRegions.some((item) => item.regionType === 'modal')).toBe(false);
      expect(protocol.pageOperationMap.zones.some((item) => item.purpose === 'scan_qr')).toBe(
        false,
      );
    });

    it('treats a public sign-in link as an account entry, not an open auth modal', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/docs',
          currentTitle: 'Public docs',
          pageRole: 'unknown',
          primaryRegion: null,
          interactiveElements: [{ ref: 'ref_signin', role: 'link', name: 'Sign in' }],
          candidateActions: [
            {
              id: 'ca_click_ref_signin',
              actionType: 'click',
              targetRef: 'ref_signin',
              confidence: 0.72,
              matchReason: 'primary action inferred from interactive label',
              locatorChain: [{ type: 'aria', value: 'Sign in' }],
            },
          ],
          visibleTextContent:
            'Search the site References HTML JavaScript HTTP response status codes Sign in Create an account',
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');

      expect(accountRegion?.state).toBe('logged_out_candidate');
      expect(protocol.pageRegions.some((item) => item.regionType === 'modal')).toBe(false);
      expect(protocol.pageOperationMap.zones.some((item) => item.regionType === 'modal')).toBe(
        false,
      );
    });

    it('does not report logged-in account state when a visible auth modal and QR prompt are present', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/dynamic-app',
          currentTitle: 'Dynamic app',
          pageRole: 'web_page',
          primaryRegion: 'app_shell',
          interactiveElements: [
            { ref: 'ref_profile', role: 'link', name: 'Profile' },
            { ref: 'ref_login', role: 'button', name: 'Login' },
          ],
          candidateActions: [
            {
              id: 'ca_click_ref_profile',
              actionType: 'click',
              targetRef: 'ref_profile',
              confidence: 0.62,
              matchReason: 'account area candidate',
              locatorChain: [{ type: 'ref', value: 'ref_profile' }],
            },
          ],
          visibleTextContent:
            'window.__APP_STATE__={"authenticated":true,"showLogin":true}; 登录弹窗 扫码登录 二维码 登录后推荐更懂你的内容',
        }) as any,
      );

      expect(protocol.pageRegions.find((item) => item.regionType === 'modal')?.state).toBe(
        'open_candidate',
      );
      expect(protocol.pageRegions.find((item) => item.regionType === 'qr_code')?.state).toBe(
        'waiting_scan_candidate',
      );
      expect(protocol.pageRegions.find((item) => item.regionType === 'account')?.state).toBe(
        'logged_out_candidate',
      );
      expect(
        protocol.pageOperationMap.zones.find((item) => item.regionType === 'account')?.purpose,
      ).toBe('auth');
    });

    it('emits auth modal and QR regions from visible modal text signals', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/auth',
          currentTitle: 'Sign in',
          pageRole: 'login_required',
          primaryRegion: 'login_form',
          interactiveElements: [],
          candidateActions: [],
          visibleTextContent:
            'window.__APP_STATE__={"authenticated":false,"showLogin":true}; 登录弹窗 扫码登录 二维码 等待扫码',
        }) as any,
      );

      const accountRegion = protocol.pageRegions.find((item) => item.regionType === 'account');
      const modalRegion = protocol.pageRegions.find((item) => item.regionType === 'modal');
      const qrRegion = protocol.pageRegions.find((item) => item.regionType === 'qr_code');

      expect(accountRegion?.state).toBe('logged_out_candidate');
      expect(modalRegion?.state).toBe('open_candidate');
      expect(qrRegion?.state).toBe('waiting_scan_candidate');
      expect(qrRegion?.targetability).toBe('not_clickable');
      expect(qrRegion?.claimBoundary).toContain('login success is not proven');
      expect(protocol.objectLifecycle.status).toBe('single_snapshot');
      expect(protocol.objectLifecycle.items.map((item) => item.objectFamily)).toEqual(
        expect.arrayContaining(['auth_surface', 'qr_code', 'account_identity']),
      );
      expect(protocol.objectLifecycle.claimBoundary).toContain('Fresh before/after reads');

      expect(protocol.pageOperationMap.zones.map((item) => item.purpose)).toEqual(
        expect.arrayContaining(['auth', 'scan_qr']),
      );
      expect(
        protocol.pageOperationMap.zones.find((item) => item.purpose === 'scan_qr'),
      ).toMatchObject({
        label: 'QR scan area candidate',
        readiness: 'not_targetable',
      });
    });

    it('marks visible expired QR modal text as refresh-needed QR state', () => {
      const protocol = buildTaskProtocol(
        createBaseParams({
          currentUrl: 'https://example.com/auth',
          currentTitle: 'Sign in',
          pageRole: 'login_required',
          primaryRegion: 'login_form',
          interactiveElements: [{ ref: 'ref_refresh', role: 'button', name: 'Refresh' }],
          candidateActions: [
            {
              id: 'ca_click_ref_refresh',
              actionType: 'click',
              targetRef: 'ref_refresh',
              confidence: 0.72,
              matchReason: 'refresh expired QR candidate from auth modal',
              locatorChain: [{ type: 'aria', value: 'Refresh' }],
            },
          ],
          visibleTextContent:
            'window.__APP_STATE__={"authenticated":false,"showLogin":true}; 登录弹窗 扫码登录 二维码已过期 点击刷新',
        }) as any,
      );

      const qrRegion = protocol.pageRegions.find((item) => item.regionType === 'qr_code');

      expect(qrRegion?.state).toBe('expired_or_refresh_available_candidate');
      expect(qrRegion?.claimBoundary).toContain('login success is not proven');
      expect(
        protocol.pageOperationMap.zones.find((item) => item.purpose === 'scan_qr'),
      ).toMatchObject({
        label: 'QR scan area candidate',
      });
    });
  });
});
