import { deriveDynamicWatchScope, type DeriveDynamicWatchScopeInput } from './dynamic-watch-scope';

const T0 = 1_700_000_000_000;

function baseInput(
  overrides: Partial<DeriveDynamicWatchScopeInput> = {},
): DeriveDynamicWatchScopeInput {
  return {
    tabId: 42,
    intent: null,
    pageRole: null,
    pageStability: 'stable',
    evidenceWindow: null,
    nowMs: T0,
    ...overrides,
  };
}

describe('dynamic-watch-scope — deterministic scope derivation', () => {
  it('maps loading and changing page stability to loading scope', () => {
    expect(deriveDynamicWatchScope(baseInput({ pageStability: 'loading' })).scopeKind).toBe(
      'loading',
    );
    expect(deriveDynamicWatchScope(baseInput({ pageStability: 'changing' })).scopeKind).toBe(
      'loading',
    );
  });

  it('maps generic search intent and pageRole to search scope', () => {
    const byIntent = deriveDynamicWatchScope(baseInput({ intent: 'search for release notes' }));
    const byRole = deriveDynamicWatchScope(baseInput({ pageRole: 'search_results' }));

    expect(byIntent.scopeKind).toBe('search');
    expect(byRole.scopeKind).toBe('search');
    expect(byIntent.regions.map((region) => region.regionId)).toEqual([
      'query_input',
      'result_region',
      'empty_state',
    ]);
  });

  it('maps generic long-content intent and pageRole to long_content scope', () => {
    const byIntent = deriveDynamicWatchScope(baseInput({ intent: 'read the documentation' }));
    const byRole = deriveDynamicWatchScope(baseInput({ pageRole: 'article' }));

    expect(byIntent.scopeKind).toBe('long_content');
    expect(byRole.scopeKind).toBe('long_content');
    expect(byRole.regions.map((region) => region.regionId)).toEqual([
      'content_body',
      'scroll_region',
      'coverage_marker',
    ]);
  });

  it('maps generic form intent and pageRole to form scope', () => {
    const byIntent = deriveDynamicWatchScope(baseInput({ intent: 'submit the form' }));
    const byRole = deriveDynamicWatchScope(baseInput({ pageRole: 'form_region' }));

    expect(byIntent.scopeKind).toBe('form');
    expect(byRole.scopeKind).toBe('form');
    expect(byIntent.regions.map((region) => region.regionId)).toEqual([
      'primary_input',
      'submit_control',
      'feedback_region',
    ]);
  });

  it('maps closed auth and challenge page roles to collaboration scopes', () => {
    const authScope = deriveDynamicWatchScope(baseInput({ pageRole: 'login_required' }));
    const challengeScope = deriveDynamicWatchScope(baseInput({ pageRole: 'challenge_required' }));

    expect(authScope.scopeKind).toBe('auth');
    expect(authScope.regions.map((region) => region.regionId)).toEqual([
      'credential_input',
      'auth_submit_control',
      'auth_feedback_region',
    ]);
    expect(challengeScope.scopeKind).toBe('challenge');
    expect(challengeScope.regions.map((region) => region.regionId)).toEqual([
      'challenge_prompt',
      'verification_input',
      'challenge_feedback_region',
    ]);
  });

  it('maps neutral multi-tab task context to multi_tab scope', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'review multi tab window state',
        pageRole: 'tab_management',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_tab_event: 2 },
        },
      }),
    );

    expect(scope.scopeKind).toBe('multi_tab');
    expect(scope.regions.map((region) => region.regionId)).toEqual([
      'tab_set',
      'active_tab',
      'window_focus_state',
    ]);
    expect(scope.boundary.browserHygieneProven).toBe(false);
  });

  it('maps explicit user takeover context to user_takeover scope without ownership proof', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'pause because user takeover interference is protected',
        pageRole: 'user_took_over',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_fact_snapshot: 1 },
        },
      }),
    );

    expect(scope.scopeKind).toBe('user_takeover');
    expect(scope.evidenceBasis.ownershipTruthClaimed).toBe(false);
    expect(scope.regions.map((region) => region.regionId)).toEqual([
      'user_activity_region',
      'protected_focus_region',
    ]);
  });

  it('maps null evidenceWindow and no category match to idle', () => {
    const scope = deriveDynamicWatchScope(baseInput({ intent: 'continue', evidenceWindow: null }));

    expect(scope.scopeKind).toBe('idle');
    expect(scope.regions).toEqual([]);
    expect(scope.reason).toBe('no_relevant_activity');
  });

  it('maps empty event counts and no category match to idle', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'continue',
        evidenceWindow: { startedAtMs: T0, endedAtMs: T0 + 100, eventsByKind: {} },
      }),
    );

    expect(scope.scopeKind).toBe('idle');
  });

  it('maps relevant activity without a safe category match to unknown', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'continue',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_tab_event: 1 },
        },
      }),
    );

    expect(scope.scopeKind).toBe('unknown');
    expect(scope.reason).toBe('activity_without_safe_scope_class');
  });

  it('does not misroute generic verify or interference wording into protected scopes', () => {
    const verifyResults = deriveDynamicWatchScope(
      baseInput({
        intent: 'verify results',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_fact_snapshot: 1 },
        },
      }),
    );
    const networkInterference = deriveDynamicWatchScope(
      baseInput({
        intent: 'review network interference',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_fact_snapshot: 1 },
        },
      }),
    );

    expect(verifyResults.scopeKind).toBe('unknown');
    expect(networkInterference.scopeKind).toBe('unknown');
  });
});

describe('dynamic-watch-scope — boundary and neutrality', () => {
  it('emits multi-tab regions as deterministic guidance only', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'clean up tabs and restore the baseline window',
        pageRole: 'tab_management',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_tab_event: 2 },
        },
      }),
    );

    const serialized = JSON.stringify(scope);
    expect(scope.scopeKind).toBe('multi_tab');
    expect(serialized).not.toContain('run_owned');
    expect(serialized).not.toContain('baseline_tab');
    expect(serialized).not.toContain('cleanup');
    expect(scope.boundary.browserHygieneProven).toBe(false);
  });

  it('never emits selectors, hostnames, site names, or UI text anchors in regions', () => {
    const scopes = [
      deriveDynamicWatchScope(baseInput({ intent: 'search for docs' })),
      deriveDynamicWatchScope(baseInput({ intent: 'submit form' })),
      deriveDynamicWatchScope(baseInput({ pageRole: 'login_required' })),
      deriveDynamicWatchScope(baseInput({ pageRole: 'challenge_required' })),
      deriveDynamicWatchScope(baseInput({ pageRole: 'tab_management' })),
      deriveDynamicWatchScope(baseInput({ pageRole: 'user_took_over' })),
      deriveDynamicWatchScope(baseInput({ intent: 'read article' })),
      deriveDynamicWatchScope(baseInput({ pageStability: 'loading' })),
    ];

    const regionValues = scopes
      .flatMap((scope) => scope.regions)
      .flatMap((region) => [region.regionId, region.regionPurpose, region.expectedRole ?? '']);

    for (const value of regionValues) {
      expect(value).not.toMatch(/\.|#|\[|]|:has|github|douyin|boss|xiaohongshu/i);
      expect(value).not.toMatch(/login button|sign in|search button/i);
    }
  });

  it('pins the allowed evidence basis and non-claims', () => {
    const scope = deriveDynamicWatchScope(
      baseInput({
        intent: 'search for docs',
        pageRole: 'search',
        evidenceWindow: {
          startedAtMs: T0,
          endedAtMs: T0 + 100,
          eventsByKind: { observation_fact_snapshot: 1 },
        },
      }),
    );

    expect(scope.evidenceBasis).toEqual({
      intentUsed: true,
      pageRoleUsed: true,
      pageStabilityUsed: true,
      eventWindowCountsUsed: true,
      urlUsed: false,
      ownershipTruthClaimed: false,
      taskIsolationClaimed: false,
      sourceRouteClaimed: false,
      realBrowserAcceptanceClaimed: false,
    });
    expect(scope.boundary).toEqual({
      deterministicGuidanceOnly: true,
      taskScopeProven: false,
      browserHygieneProven: false,
      realBrowserProven: false,
      commercialGradeProven: false,
    });
  });

  it('does not depend on URL input because URL is not accepted by the first-slice API', () => {
    const input = baseInput({ intent: 'search docs' }) as DeriveDynamicWatchScopeInput & {
      urlPattern?: string;
    };
    input.urlPattern = 'https://example.test/search';

    const scope = deriveDynamicWatchScope(input);

    expect(scope.scopeKind).toBe('search');
    expect(scope.evidenceBasis.urlUsed).toBe(false);
  });
});
