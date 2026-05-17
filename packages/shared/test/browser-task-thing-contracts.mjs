import assert from 'node:assert/strict';

import {
  BROWSER_CLEANUP_POLICY_VALUES,
  BROWSER_DATA_PREFERENCE_VALUES,
  BROWSER_EVIDENCE_FRESHNESS_VALUES,
  BROWSER_EXECUTION_MODE_VALUES,
  BROWSER_FOCUS_POLICY_VALUES,
  BROWSER_INTERFERENCE_RISK_VALUES,
  BROWSER_PAGE_CHANGE_CAUSE_VALUES,
  BROWSER_PAGE_OWNER_TYPE_VALUES,
  BROWSER_PAGE_STABILITY_VALUES,
  BROWSER_RISK_POLICY_VALUES,
  BROWSER_SOURCE_FRESHNESS_VALUES,
  BROWSER_TASK_EVIDENCE_LEVEL_VALUES,
  BROWSER_TASK_SCENARIO_CLASS_VALUES,
  BROWSER_TASK_STATUS_VALUES,
  BROWSER_TASK_THING_CONTRACT_VERSION,
  BROWSER_USER_ACTIVITY_LEVEL_VALUES,
  TOOL_SCHEMAS,
} from '../dist/index.mjs';

assert.equal(BROWSER_TASK_THING_CONTRACT_VERSION, 'v1');
assert.ok(BROWSER_TASK_STATUS_VALUES.includes('pass_with_gaps'));
assert.ok(BROWSER_TASK_SCENARIO_CLASS_VALUES.includes('search_result_delta_v1'));
assert.ok(BROWSER_EXECUTION_MODE_VALUES.includes('run_owned'));
assert.ok(BROWSER_FOCUS_POLICY_VALUES.includes('no_steal'));
assert.ok(BROWSER_CLEANUP_POLICY_VALUES.includes('close_run_owned'));
assert.ok(BROWSER_RISK_POLICY_VALUES.includes('read_only'));
assert.ok(BROWSER_DATA_PREFERENCE_VALUES.includes('prefer_structured_rows'));
assert.ok(BROWSER_PAGE_OWNER_TYPE_VALUES.includes('baseline'));
assert.ok(BROWSER_PAGE_STABILITY_VALUES.includes('stale'));
assert.ok(BROWSER_PAGE_CHANGE_CAUSE_VALUES.includes('background_refresh'));
assert.ok(BROWSER_SOURCE_FRESHNESS_VALUES.includes('fresh'));
assert.ok(BROWSER_USER_ACTIVITY_LEVEL_VALUES.includes('recent_input'));
assert.ok(BROWSER_INTERFERENCE_RISK_VALUES.includes('high'));
assert.ok(BROWSER_TASK_EVIDENCE_LEVEL_VALUES.includes('real_browser'));
assert.ok(BROWSER_EVIDENCE_FRESHNESS_VALUES.includes('expired'));

const summary = {
  taskId: 'btt_001',
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

const projection = {
  projectionId: 'projection_001',
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

const evidence = {
  evidenceId: 'evidence_001',
  scenarioId: 'V28-RS-SEARCH-DELTA-01',
  scenarioClass: 'search_result_delta_v1',
  artifactPath: '.claude/test-reports/example.json',
  evidenceLevel: 'real_browser',
  freshness: 'fresh',
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
  policyAudit: [
    {
      attribute: 'focusPolicy',
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
