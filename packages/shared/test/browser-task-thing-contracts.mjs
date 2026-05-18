import assert from 'node:assert/strict';

import {
  BROWSER_CLEANUP_POLICY_VALUES,
  BROWSER_COMPARISON_MODE_VALUES,
  BROWSER_COMPETITOR_LANE_VALUES,
  BROWSER_DATA_PREFERENCE_VALUES,
  BROWSER_EVIDENCE_FRESHNESS_VALUES,
  BROWSER_EXECUTION_MODE_VALUES,
  BROWSER_FOCUS_POLICY_VALUES,
  BROWSER_INTERFERENCE_RISK_VALUES,
  BROWSER_PAGE_CHANGE_CAUSE_VALUES,
  BROWSER_PAGE_OWNER_TYPE_VALUES,
  BROWSER_PAGE_STABILITY_VALUES,
  BROWSER_RISK_POLICY_VALUES,
  BROWSER_SOURCE_LINEAGE_VALUES,
  BROWSER_SOURCE_FRESHNESS_VALUES,
  BROWSER_TASK_SCENARIO_PRIORITY_ORDER,
  BROWSER_TASK_EVIDENCE_LEVEL_VALUES,
  BROWSER_TASK_FIXTURE_ARTIFACT_KIND,
  BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES,
  BROWSER_TASK_SCENARIO_CLASS_VALUES,
  BROWSER_TASK_STATUS_VALUES,
  BROWSER_TASK_THING_CONTRACT_VERSION,
  BROWSER_PROFILE_MODE_VALUES,
  BROWSER_PROJECTION_KIND_VALUES,
  BROWSER_PAGE_PROJECTION_DELTA_KIND_VALUES,
  BROWSER_ASSISTANT_CLIENT_VALUES,
  BROWSER_USER_BOUNDARY_MODE_VALUES,
  BROWSER_USER_ACTIVITY_LEVEL_VALUES,
  TOOL_SCHEMAS,
  buildBrowserPageProjectionDelta,
  buildBrowserPageThingProjectionFromReadPage,
  isBrowserPageProjectionDeltaArtifact,
  isBrowserTaskDeterministicFixtureArtifact,
  isBrowserTaskPrivacyRedactionSafe,
} from '../dist/index.mjs';

assert.equal(BROWSER_TASK_THING_CONTRACT_VERSION, 'v1');
assert.ok(BROWSER_TASK_STATUS_VALUES.includes('pass_with_gaps'));
assert.ok(BROWSER_TASK_SCENARIO_CLASS_VALUES.includes('search_result_delta_v1'));
assert.deepEqual(BROWSER_TASK_SCENARIO_PRIORITY_ORDER.slice(0, 2), [
  'search_result_delta_v1',
  'article_long_content_read_v1',
]);
assert.ok(BROWSER_ASSISTANT_CLIENT_VALUES.includes('claude_code'));
assert.ok(BROWSER_PROFILE_MODE_VALUES.includes('same_profile'));
assert.ok(BROWSER_COMPARISON_MODE_VALUES.includes('reference_only'));
assert.ok(BROWSER_USER_BOUNDARY_MODE_VALUES.includes('protected_user_workspace'));
assert.ok(BROWSER_EXECUTION_MODE_VALUES.includes('run_owned'));
assert.ok(BROWSER_FOCUS_POLICY_VALUES.includes('no_steal'));
assert.ok(BROWSER_CLEANUP_POLICY_VALUES.includes('close_run_owned'));
assert.ok(BROWSER_RISK_POLICY_VALUES.includes('read_only'));
assert.ok(BROWSER_DATA_PREFERENCE_VALUES.includes('prefer_structured_rows'));
assert.ok(BROWSER_PAGE_OWNER_TYPE_VALUES.includes('baseline'));
assert.ok(BROWSER_PAGE_STABILITY_VALUES.includes('stale'));
assert.ok(BROWSER_PAGE_CHANGE_CAUSE_VALUES.includes('background_refresh'));
assert.ok(BROWSER_PROJECTION_KIND_VALUES.includes('read_snapshot_projection'));
assert.ok(BROWSER_PAGE_PROJECTION_DELTA_KIND_VALUES.includes('initial_overview'));
assert.ok(BROWSER_PAGE_PROJECTION_DELTA_KIND_VALUES.includes('post_action_delta'));
assert.ok(BROWSER_SOURCE_LINEAGE_VALUES.includes('dom'));
assert.ok(BROWSER_SOURCE_FRESHNESS_VALUES.includes('fresh'));
assert.ok(BROWSER_USER_ACTIVITY_LEVEL_VALUES.includes('recent_input'));
assert.ok(BROWSER_INTERFERENCE_RISK_VALUES.includes('high'));
assert.ok(BROWSER_TASK_EVIDENCE_LEVEL_VALUES.includes('real_browser'));
assert.ok(BROWSER_EVIDENCE_FRESHNESS_VALUES.includes('expired'));
assert.ok(BROWSER_COMPETITOR_LANE_VALUES.includes('same_profile_extension'));
assert.equal(BROWSER_TASK_FIXTURE_ARTIFACT_KIND, 'deterministic_fixture');
assert.ok(BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES.includes('unit'));
assert.equal(BROWSER_TASK_FIXTURE_EVIDENCE_LEVEL_VALUES.includes('real_browser'), false);

const summary = {
  taskId: 'btt_001',
  runId: 'run_001',
  assistantClient: 'claude_code',
  profileMode: 'same_profile',
  comparisonMode: 'same_profile',
  userBoundaryMode: 'protected_user_workspace',
  startedAt: '2026-05-18T00:00:00.000Z',
  endedAt: null,
  scenarioId: 'V28-RS-SEARCH-DELTA-01',
  scenarioClass: 'search_result_delta_v1',
  status: 'running',
  requestedToolPath: 'Tabrix MCP',
  actualToolPath: 'Claude via ACP -> Tabrix MCP -> user real Chrome',
  runtimePolicy: {
    desiredExecutionMode: 'run_owned',
    focusPolicy: 'no_steal',
    cleanupPolicy: 'close_run_owned',
    riskPolicy: 'read_only',
    dataPreference: 'prefer_structured_rows',
    contextBudget: {
      maxChars: 12000,
      preferDelta: true,
    },
  },
  currentPageId: 'page_main',
  currentPageProjectionId: 'projection_001',
  evidenceIds: ['evidence_001'],
  browserHygieneSummary: {
    runOwnedTabsLeft: 0,
    userTabsClosed: 0,
    focusSteal: false,
    protectedTabImpact: false,
  },
  gaps: [],
};

assert.equal(summary.runtimePolicy.focusPolicy, 'no_steal');
assert.equal(summary.browserHygieneSummary.runOwnedTabsLeft, 0);
assert.equal(summary.profileMode, 'same_profile');

const projection = {
  projectionId: 'projection_001',
  projectionKind: 'read_snapshot_projection',
  projectionCreatedAt: '2026-05-18T00:00:01.000Z',
  sourceObservedAt: '2026-05-18T00:00:01.000Z',
  sourceLineage: 'dom',
  regionEvidenceRefs: ['region:search_results', 'row:row_001'],
  pageId: 'page_main',
  tabId: 123,
  ownerType: 'run_owned',
  readiness: 'ready',
  stability: 'stable',
  contextVersion: 'ctx_002',
  previousContextVersion: 'ctx_001',
  changedByActionId: 'action_search_001',
  changeCause: 'search',
  activeRegion: 'search_results',
  changedRegions: ['search_results'],
  reusedRegions: ['global_nav'],
  invalidatedRefs: ['tgt_old'],
  refreshedRefs: ['tgt_new'],
  chosenDataSource: 'dom_region_rows',
  sourceConfidence: 0.84,
  sourceFreshness: 'fresh',
  contextChars: 8000,
  contextSavedChars: 4200,
  userActivityLevel: 'none',
  interferenceRisk: 'none',
};

assert.equal(projection.chosenDataSource, 'dom_region_rows');
assert.ok(projection.contextSavedChars > 0);
assert.deepEqual(projection.changedRegions, ['search_results']);
assert.equal(projection.projectionKind, 'read_snapshot_projection');
assert.equal(projection.sourceLineage, 'dom');

const mappedProjection = buildBrowserPageThingProjectionFromReadPage({
  snapshot: {
    mode: 'compact',
    page: {
      url: 'https://example.test/search?q=redacted',
      title: 'Example Search',
      pageType: 'web_page',
    },
    summary: {
      pageRole: 'search_results_page',
      primaryRegion: 'search_results',
      quality: 'usable',
    },
    interactiveElements: [],
    artifactRefs: [],
    selectedDataSource: 'dom_region_rows',
    readinessVerdict: 'ready',
    visibleRegionRows: {
      sourceDataSource: 'dom_region_rows',
      rows: [
        {
          rowId: 'row_001',
          title: 'Repository A',
          primaryText: 'A useful repository',
          secondaryText: null,
          summary: null,
          metaText: '10 stars',
          interactionText: null,
          visibleTextFields: ['title', 'primaryText', 'metaText'],
          targetRef: 'tgt_repo_a',
          targetRefCoverageRate: 1,
          boundingBox: null,
          regionId: 'search_results',
          sourceRegion: 'search_results',
          confidence: 0.91,
          qualityReasons: ['title_and_target_ref'],
        },
      ],
      rowCount: 1,
      visibleRegionRowsUsed: true,
      visibleRegionRowsRejectedReason: null,
      sourceRegion: 'search_results',
      rowExtractionConfidence: 0.91,
      cardExtractorUsed: true,
      cardPatternConfidence: 0.86,
      cardRowsCount: 1,
      rowOrder: 'visual_order',
      targetRefCoverageRate: 1,
      regionQualityScore: 0.88,
      visibleDomRowsCandidateCount: 1,
      visibleDomRowsSelectedCount: 1,
      lowValueRegionRejectedCount: 0,
      footerLikeRejectedCount: 0,
      navigationLikeRejectedCount: 0,
      targetRefCoverageRejectedCount: 0,
      rejectedRegionReasonDistribution: {},
      pageInfo: {
        url: 'https://example.test/search',
        title: 'Example Search',
        viewport: { width: 1280, height: 720, dpr: 1 },
        scrollY: 0,
        pixelsAbove: 0,
        pixelsBelow: 0,
        visibleRegionCount: 1,
        candidateRegionCount: 1,
      },
    },
  },
  projectionId: 'projection_from_fixture',
  observedAt: '2026-05-18T00:00:02.000Z',
  pageId: 'page_fixture',
  tabId: 456,
  ownerType: 'run_owned',
  contextVersion: 'ctx_003',
  previousContextVersion: 'ctx_002',
  changedByActionId: 'action_search_002',
  changeCause: 'search',
  reusedRegions: ['global_nav'],
  previousContextChars: 200,
  userActivityLevel: 'none',
  interferenceRisk: 'none',
});

assert.equal(mappedProjection.readiness, 'ready');
assert.equal(mappedProjection.activeRegion, 'search_results');
assert.equal(mappedProjection.chosenDataSource, 'dom_region_rows');
assert.deepEqual(mappedProjection.refreshedRefs, ['tgt_repo_a']);
assert.equal(mappedProjection.projectionKind, 'read_snapshot_projection');
assert.equal(mappedProjection.projectionCreatedAt, '2026-05-18T00:00:02.000Z');
assert.equal(mappedProjection.sourceObservedAt, '2026-05-18T00:00:02.000Z');
assert.equal(mappedProjection.sourceLineage, 'dom');
assert.deepEqual(mappedProjection.regionEvidenceRefs, ['region:search_results', 'row:row_001']);
assert.ok(mappedProjection.contextSavedChars > 0);

const initialDelta = buildBrowserPageProjectionDelta({
  previousProjection: null,
  currentProjection: projection,
  deltaId: 'delta_initial_001',
  deltaKind: 'initial_overview',
});

assert.equal(initialDelta.deltaKind, 'initial_overview');
assert.equal(initialDelta.fromProjectionId, null);
assert.equal(initialDelta.toProjectionId, 'projection_001');
assert.deepEqual(initialDelta.changedRegions, ['search_results']);
assert.deepEqual(initialDelta.reusedRegions, ['global_nav']);
assert.deepEqual(initialDelta.invalidatedRefs, ['tgt_old']);
assert.deepEqual(initialDelta.refreshedRefs, ['tgt_new']);
assert.equal(initialDelta.previousContextChars, null);
assert.equal(initialDelta.contextSavedChars, 0);
assert.equal(initialDelta.contextSavedRatio, 0);
assert.equal(initialDelta.evidenceBoundary.evidenceLevel, 'unit');
assert.equal(initialDelta.evidenceBoundary.realBrowserClaim, false);

const previousProjection = {
  ...projection,
  projectionId: 'projection_previous_001',
  contextChars: 12000,
  changedRegions: ['initial_results'],
  reusedRegions: [],
  invalidatedRefs: [],
  refreshedRefs: ['tgt_old'],
};
const currentProjection = {
  ...projection,
  projectionId: 'projection_current_001',
  contextChars: 8000,
  changedRegions: ['search_results'],
  reusedRegions: ['global_nav'],
  invalidatedRefs: ['tgt_old'],
  refreshedRefs: ['tgt_new'],
};
const postActionDelta = buildBrowserPageProjectionDelta({
  previousProjection,
  currentProjection,
  deltaId: 'delta_post_action_001',
  deltaKind: 'post_action_delta',
  evidenceBoundary: { evidenceLevel: 'integration', realBrowserClaim: false },
});

assert.equal(postActionDelta.deltaKind, 'post_action_delta');
assert.equal(postActionDelta.fromProjectionId, 'projection_previous_001');
assert.equal(postActionDelta.toProjectionId, 'projection_current_001');
assert.deepEqual(postActionDelta.changedRegions, ['search_results']);
assert.deepEqual(postActionDelta.reusedRegions, ['global_nav']);
assert.deepEqual(postActionDelta.invalidatedRefs, ['tgt_old']);
assert.deepEqual(postActionDelta.refreshedRefs, ['tgt_new']);
assert.equal(postActionDelta.previousContextChars, 12000);
assert.equal(postActionDelta.contextChars, 8000);
assert.ok(postActionDelta.contextSavedChars > 0);
assert.ok(postActionDelta.contextSavedRatio >= 0 && postActionDelta.contextSavedRatio <= 1);

const realBrowserDelta = buildBrowserPageProjectionDelta({
  previousProjection,
  currentProjection,
  deltaId: 'delta_real_browser_001',
  deltaKind: 'post_action_delta',
  evidenceBoundary: { evidenceLevel: 'real_browser', realBrowserClaim: true },
});
assert.equal(realBrowserDelta.evidenceBoundary.evidenceLevel, 'real_browser');
assert.equal(realBrowserDelta.evidenceBoundary.realBrowserClaim, true);

assert.throws(
  () =>
    buildBrowserPageProjectionDelta({
      previousProjection: null,
      currentProjection,
      deltaId: 'delta_invalid_001',
      deltaKind: 'post_action_delta',
    }),
  /post_action_delta requires previousProjection/,
);

const deltaArtifact = {
  artifactKind: 'deterministic_fixture',
  contractVersion: BROWSER_TASK_THING_CONTRACT_VERSION,
  generatedAt: '2026-05-18T00:00:04.000Z',
  deltaProjection: postActionDelta,
  evidenceBoundary: { evidenceLevel: 'integration', realBrowserClaim: false },
};

assert.equal(isBrowserPageProjectionDeltaArtifact(deltaArtifact), true);
assert.equal(
  isBrowserPageProjectionDeltaArtifact({
    ...deltaArtifact,
    evidenceBoundary: { evidenceLevel: 'integration', realBrowserClaim: true },
  }),
  false,
);
assert.equal(
  isBrowserPageProjectionDeltaArtifact({
    ...deltaArtifact,
    deltaProjection: {
      ...postActionDelta,
      evidenceBoundary: { evidenceLevel: 'unit', realBrowserClaim: false },
    },
  }),
  false,
);

const evidence = {
  evidenceId: 'evidence_001',
  scenarioId: 'V28-RS-SEARCH-DELTA-01',
  scenarioClass: 'search_result_delta_v1',
  artifactPath: '.claude/test-reports/example.json',
  evidenceLevel: 'real_browser',
  freshness: 'fresh',
  competitorLane: 'not_applicable',
  browserHygiene: {
    before: {},
    after: {},
    delta: summary.browserHygieneSummary,
  },
  dataSourceDecision: {
    availableSources: ['api_rows', 'dom_region_rows'],
    selectedSource: 'dom_region_rows',
    selectedReason: 'fresh region rows cover required visible content',
    rejectedSources: [{ source: 'api_rows', reason: 'no correlated observed API rows' }],
    regionCorrelation: 0.91,
    taskRelevance: 0.88,
    privacySafety: 'safe',
    metadataCompleteness: 0.76,
    sourceFreshness: 'fresh',
    sourceConfidence: 0.84,
    fallbackReason: null,
  },
  runtimePolicyAudit: [
    {
      field: 'focusPolicy',
      requestedValue: 'no_steal',
      previousValue: null,
      effectiveValue: 'no_steal',
      verdict: 'applied',
      reason: null,
      at: '2026-05-18T00:00:00.000Z',
      source: 'policy',
    },
  ],
  privacyRedaction: {
    userTypedContentPersisted: false,
    formValuesPersisted: false,
    fullApiBodiesPersisted: false,
    credentialsOrTokensPersisted: false,
    redactionNotes: [],
  },
  claimCoverage: {
    claims: ['delta_context'],
    supportedClaims: ['delta_context'],
    unsupportedClaims: [],
  },
};

assert.equal(evidence.dataSourceDecision.selectedSource, 'dom_region_rows');
assert.equal(evidence.dataSourceDecision.rejectedSources[0].source, 'api_rows');
assert.equal(evidence.privacyRedaction.fullApiBodiesPersisted, false);
assert.equal(evidence.runtimePolicyAudit[0].field, 'focusPolicy');
assert.equal(evidence.competitorLane, 'not_applicable');
assert.equal(isBrowserTaskPrivacyRedactionSafe(evidence.privacyRedaction), true);

const fixtureEvidence = {
  ...evidence,
  evidenceId: 'evidence_fixture_001',
  evidenceLevel: 'unit',
  artifactPath: '.claude/test-reports/v28-fixture-example.json',
};

const deterministicFixtureArtifact = {
  artifactKind: 'deterministic_fixture',
  contractVersion: BROWSER_TASK_THING_CONTRACT_VERSION,
  generatedAt: '2026-05-18T00:00:03.000Z',
  summary,
  pageProjection: projection,
  evidence: fixtureEvidence,
  evidenceBoundary: {
    evidenceLevel: 'unit',
    realBrowserClaim: false,
  },
};

assert.equal(isBrowserTaskDeterministicFixtureArtifact(deterministicFixtureArtifact), true);
assert.equal(
  isBrowserTaskDeterministicFixtureArtifact({
    ...deterministicFixtureArtifact,
    evidenceBoundary: { evidenceLevel: 'unit', realBrowserClaim: true },
  }),
  false,
);
assert.equal(
  isBrowserTaskDeterministicFixtureArtifact({
    ...deterministicFixtureArtifact,
    evidence: { ...fixtureEvidence, evidenceLevel: 'real_browser' },
  }),
  false,
);
assert.equal(
  isBrowserTaskPrivacyRedactionSafe({
    ...fixtureEvidence.privacyRedaction,
    fullApiBodiesPersisted: true,
  }),
  false,
);

const schemaNames = new Set(TOOL_SCHEMAS.map((schema) => schema.name));
assert.equal(schemaNames.has('browser_task_thing'), false);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'browser-task-thing',
    statusCount: BROWSER_TASK_STATUS_VALUES.length,
    scenarioClassCount: BROWSER_TASK_SCENARIO_CLASS_VALUES.length,
  }),
);
