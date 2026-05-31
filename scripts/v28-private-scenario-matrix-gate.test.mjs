import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPrivateScenarioMatrixAcceptanceBrief,
  parseArgs,
  validatePrivateScenarioMatrixPreflight,
} from './v28-private-scenario-matrix-gate.mjs';

function validAuthManifest(overrides = {}) {
  return {
    mode: 'product-acceptance',
    scenarioId: 'V28-RS-AUTH-COLLABORATION-01',
    scenarioClass: 'auth_collaboration_resume_v1',
    runId: 'v28-auth-2026-06-01T00-00-00-000Z',
    mainTabrixHead: '990ad64',
    naturalLanguageTaskPresent: true,
    riskLevel: 'R1',
    requestedToolPath: 'ACP -> Claude -> Tabrix MCP -> real Chrome',
    chrome: {
      profileMode: 'same_profile',
      profileEvidence: 'confirmed_default_profile',
      accountState: 'login_required',
      accountStateEvidence: 'read_page_or_visible_browser_state',
    },
    browserHygiene: {
      before: {
        baselineWindowCount: 1,
        baselineTabCount: 2,
        activeTabPresent: true,
      },
    },
    capabilityEvidencePlanned: {
      pageRegions: true,
      accountState: true,
      modalState: true,
      qrState: true,
      beforeAfterObjectLifecycle: true,
      postActionStateSummary: true,
      collaborationResume: true,
      browserHygiene: true,
    },
    artifactRoot:
      'E:/projects/AI/codex/tabrix-private-tests/artifacts/real-user-scenarios/v28-auth-2026-06-01T00-00-00-000Z/',
    ...overrides,
  };
}

function validUserTakeoverManifest(overrides = {}) {
  return {
    mode: 'product-acceptance',
    scenarioId: 'V28-RS-USER-TAKEOVER-01',
    scenarioClass: 'user_takeover_collaboration_v1',
    runId: 'v28-user-takeover-2026-06-01T00-00-00-000Z',
    mainTabrixHead: '990ad64',
    naturalLanguageTaskPresent: true,
    riskLevel: 'R2',
    requestedToolPath: 'ACP -> Claude -> Tabrix MCP -> real Chrome',
    chrome: {
      profileMode: 'same_profile',
      profileEvidence: 'confirmed_default_profile',
    },
    target: {
      privateTargetConfigured: true,
      targetEvidence: 'owner_private_page_configured_outside_public_repo',
    },
    collaboration: {
      interactiveUserTakeoverEnabled: true,
      requestElementSelectionPlanned: true,
      userCanDecline: true,
      expectedUserAction: 'select_visible_element',
      nonSensitiveSelectionPrompt: 'Select one visible non-sensitive element to confirm takeover.',
      takeoverTimeoutMs: 180000,
    },
    browserHygiene: {
      before: {
        baselineWindowCount: 1,
        baselineTabCount: 2,
        activeTabPresent: true,
      },
    },
    capabilityEvidencePlanned: {
      pageRegions: true,
      userTakeoverDetection: true,
      collaborationRequiredState: true,
      requestElementSelection: true,
      resumeAfterUserSelection: true,
      beforeAfterObjectLifecycle: true,
      postActionStateSummary: true,
      browserHygiene: true,
    },
    artifactRoot:
      'E:/projects/AI/codex/tabrix-private-tests/artifacts/real-user-scenarios/v28-user-takeover-2026-06-01T00-00-00-000Z/',
    ...overrides,
  };
}

test('validatePrivateScenarioMatrixPreflight accepts both required private scenario manifests', () => {
  const result = validatePrivateScenarioMatrixPreflight({
    auth: validAuthManifest(),
    userTakeover: validUserTakeoverManifest(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'READY_FOR_PRIVATE_MATRIX_ACCEPTANCE');
  assert.equal(result.evidenceLevel, 'preflight_only');
  assert.equal(result.requiredEvidenceLevel, 'private_scenario_matrix');
  assert.deepEqual(result.matrixProof.readyScenarios, ['auth', 'userTakeover']);
  assert.deepEqual(result.matrixProof.missingScenarios, []);
  assert.deepEqual(result.matrixProof.blockedScenarios, []);
});

test('validatePrivateScenarioMatrixPreflight blocks when a required scenario manifest is missing', () => {
  const result = validatePrivateScenarioMatrixPreflight({
    auth: validAuthManifest(),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED_MATRIX_PRECHECK');
  assert.deepEqual(result.matrixProof.readyScenarios, ['auth']);
  assert.deepEqual(result.matrixProof.missingScenarios, ['userTakeover']);
  assert.deepEqual(result.matrixProof.blockedScenarios, []);
  assert.equal(
    result.matrixProof.scenarioResults.find((scenario) => scenario.key === 'userTakeover').status,
    'MISSING_MANIFEST',
  );
});

test('validatePrivateScenarioMatrixPreflight blocks when a scenario preflight is blocked', () => {
  const result = validatePrivateScenarioMatrixPreflight({
    auth: validAuthManifest({ scenarioClass: 'wrong_class' }),
    userTakeover: validUserTakeoverManifest(),
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.matrixProof.readyScenarios, ['userTakeover']);
  assert.deepEqual(result.matrixProof.missingScenarios, []);
  assert.deepEqual(result.matrixProof.blockedScenarios, ['auth']);
  assert.ok(
    result.matrixProof.scenarioResults
      .find((scenario) => scenario.key === 'auth')
      .preflightProof.missingFields.includes('scenarioClass'),
  );
});

test('validatePrivateScenarioMatrixPreflight reports sensitive fields without leaking values', () => {
  const result = validatePrivateScenarioMatrixPreflight({
    auth: validAuthManifest({ cookie: 'must-not-be-present' }),
    userTakeover: validUserTakeoverManifest(),
  });

  const authResult = result.matrixProof.scenarioResults.find((scenario) => scenario.key === 'auth');
  assert.equal(result.ok, false);
  assert.deepEqual(result.matrixProof.blockedScenarios, ['auth']);
  assert.deepEqual(authResult.preflightProof.sensitiveFields, ['cookie']);
  assert.doesNotMatch(JSON.stringify(result), /must-not-be-present/);
});

test('parseArgs supports private matrix inputs and acceptance brief output', () => {
  assert.deepEqual(parseArgs(['--auth-input', 'auth.json', '--user-takeover-input', 'user.json']), {
    authInput: 'auth.json',
    userTakeoverInput: 'user.json',
    printAcceptanceBrief: false,
  });
  assert.deepEqual(parseArgs(['--print-acceptance-brief']), {
    authInput: null,
    userTakeoverInput: null,
    printAcceptanceBrief: true,
  });
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('buildPrivateScenarioMatrixAcceptanceBrief preserves non-claim boundaries', () => {
  const brief = buildPrivateScenarioMatrixAcceptanceBrief();

  assert.equal(brief.matrixId, 'v28-r4-private-scenario-minimum-matrix');
  assert.deepEqual(
    brief.requiredScenarios.map((scenario) => scenario.scenarioClass),
    ['auth_collaboration_resume_v1', 'user_takeover_collaboration_v1'],
  );
  assert.ok(
    brief.matrixPassBar.includes(
      'R4 matrix PASS is forbidden until real private scenario artifacts prove both scenarios',
    ),
  );
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('R4 private scenario matrix PASS'));
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('product delivery grade'));
});
