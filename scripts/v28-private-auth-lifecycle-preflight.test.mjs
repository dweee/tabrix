import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAcceptanceBrief,
  parseArgs,
  validatePrivateAuthLifecyclePreflight,
} from './v28-private-auth-lifecycle-preflight.mjs';

function validManifest(overrides = {}) {
  return {
    mode: 'product-acceptance',
    scenarioId: 'V28-RS-AUTH-COLLABORATION-01',
    scenarioClass: 'auth_collaboration_resume_v1',
    runId: 'v28-auth-2026-06-01T00-00-00-000Z',
    mainTabrixHead: '1657261',
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

test('validatePrivateAuthLifecyclePreflight accepts a complete private auth manifest', () => {
  const result = validatePrivateAuthLifecyclePreflight(validManifest());

  assert.equal(result.ok, true);
  assert.equal(result.status, 'READY_FOR_PRIVATE_ACCEPTANCE');
  assert.equal(result.evidenceLevel, 'preflight_only');
  assert.equal(result.requiredEvidenceLevel, 'private_scenario');
  assert.equal(result.preflightProof.proofSatisfied, true);
  assert.deepEqual(result.preflightProof.missingFields, []);
});

test('validatePrivateAuthLifecyclePreflight blocks missing profile/account/hygiene evidence', () => {
  const manifest = validManifest({
    chrome: {
      profileMode: 'unknown',
      accountState: 'unknown',
    },
    browserHygiene: {
      before: {
        baselineWindowCount: 1,
      },
    },
  });
  const result = validatePrivateAuthLifecyclePreflight(manifest);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED_PRECHECK');
  assert.ok(result.preflightProof.missingFields.includes('chrome.profileMode'));
  assert.ok(result.preflightProof.missingFields.includes('chrome.profileEvidence'));
  assert.ok(result.preflightProof.missingFields.includes('chrome.accountState'));
  assert.ok(result.preflightProof.missingFields.includes('browserHygiene.before.baselineTabCount'));
  assert.ok(result.preflightProof.missingFields.includes('browserHygiene.before.activeTabPresent'));
});

test('validatePrivateAuthLifecyclePreflight rejects public docs artifact roots', () => {
  const result = validatePrivateAuthLifecyclePreflight(
    validManifest({
      artifactRoot: 'E:/projects/AI/codex/main_tabrix/docs/private-auth-result/',
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.missingFields.includes('artifactRoot'));
  assert.equal(result.preflightProof.privateArtifactRootPresent, false);
});

test('validatePrivateAuthLifecyclePreflight rejects sensitive raw fields', () => {
  const result = validatePrivateAuthLifecyclePreflight(
    validManifest({
      cookie: 'must-not-be-present',
      chrome: {
        profileMode: 'same_profile',
        profileEvidence: 'confirmed_default_profile',
        accountState: 'login_required',
        accountStateEvidence: 'read_page_or_visible_browser_state',
        qrPayload: 'must-not-be-present',
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.sensitiveFields.includes('cookie'));
  assert.ok(result.preflightProof.sensitiveFields.includes('chrome.qrPayload'));
});

test('validatePrivateAuthLifecyclePreflight blocks non-auth scenario classes', () => {
  const result = validatePrivateAuthLifecyclePreflight(
    validManifest({
      scenarioClass: 'search_result_delta_v1',
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.missingFields.includes('scenarioClass'));
  assert.equal(result.requiredScenarioClass, 'auth_collaboration_resume_v1');
});

test('parseArgs supports input and template options', () => {
  assert.deepEqual(parseArgs(['--input', 'manifest.json']), {
    input: 'manifest.json',
    printTemplate: false,
    printAcceptanceBrief: false,
  });
  assert.deepEqual(parseArgs(['--print-template']), {
    input: null,
    printTemplate: true,
    printAcceptanceBrief: false,
  });
  assert.deepEqual(parseArgs(['--print-acceptance-brief']), {
    input: null,
    printTemplate: false,
    printAcceptanceBrief: true,
  });
  assert.throws(() => parseArgs(['--unknown']), /Unknown argument/);
});

test('buildAcceptanceBrief defines private auth acceptance evidence without pass claims', () => {
  const brief = buildAcceptanceBrief();

  assert.equal(brief.scenarioClass, 'auth_collaboration_resume_v1');
  assert.match(brief.objective, /owner-private inputs/);
  assert.ok(brief.requiredOwnerInputs.privateTargetUrl);
  assert.ok(brief.requiredRuntimeEvidence.qrObjectLifecycle);
  assert.ok(brief.passBar.includes('Browser Hygiene PASS or explicit BLOCKED classification'));
  assert.ok(brief.artifactContract.privateOnlyFields.includes('rawQrImage'));
  assert.ok(brief.artifactContract.privateOnlyFields.includes('privateTargetUrl'));
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('private scenario PASS'));
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('product delivery grade'));
});
