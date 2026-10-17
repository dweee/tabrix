import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAcceptanceBrief,
  parseArgs,
  validatePrivateUserTakeoverPreflight,
} from './v28-private-user-takeover-preflight.mjs';

function validManifest(overrides = {}) {
  return {
    mode: 'product-acceptance',
    scenarioId: 'V28-RS-USER-TAKEOVER-01',
    scenarioClass: 'user_takeover_collaboration_v1',
    runId: 'v28-user-takeover-2026-06-01T00-00-00-000Z',
    mainTabrixHead: '0a8ce18',
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

test('validatePrivateUserTakeoverPreflight accepts a complete user takeover manifest', () => {
  const result = validatePrivateUserTakeoverPreflight(validManifest());

  assert.equal(result.ok, true);
  assert.equal(result.status, 'READY_FOR_PRIVATE_ACCEPTANCE');
  assert.equal(result.evidenceLevel, 'preflight_only');
  assert.equal(result.requiredEvidenceLevel, 'private_scenario');
  assert.equal(result.preflightProof.proofSatisfied, true);
  assert.deepEqual(result.preflightProof.missingFields, []);
});

test('validatePrivateUserTakeoverPreflight blocks missing target/collaboration/hygiene evidence', () => {
  const manifest = validManifest({
    target: {
      privateTargetConfigured: false,
    },
    collaboration: {
      interactiveUserTakeoverEnabled: false,
      requestElementSelectionPlanned: false,
      expectedUserAction: 'simulated_click',
    },
    browserHygiene: {
      before: {
        baselineWindowCount: 1,
      },
    },
  });
  const result = validatePrivateUserTakeoverPreflight(manifest);

  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED_PRECHECK');
  assert.ok(result.preflightProof.missingFields.includes('target.privateTargetConfigured'));
  assert.ok(result.preflightProof.missingFields.includes('target.targetEvidence'));
  assert.ok(
    result.preflightProof.missingFields.includes('collaboration.interactiveUserTakeoverEnabled'),
  );
  assert.ok(
    result.preflightProof.missingFields.includes('collaboration.requestElementSelectionPlanned'),
  );
  assert.ok(result.preflightProof.missingFields.includes('collaboration.userCanDecline'));
  assert.ok(result.preflightProof.missingFields.includes('collaboration.expectedUserAction'));
  assert.ok(
    result.preflightProof.missingFields.includes('collaboration.nonSensitiveSelectionPrompt'),
  );
  assert.ok(result.preflightProof.missingFields.includes('collaboration.takeoverTimeoutMs'));
  assert.ok(result.preflightProof.missingFields.includes('browserHygiene.before.baselineTabCount'));
  assert.ok(result.preflightProof.missingFields.includes('browserHygiene.before.activeTabPresent'));
});

test('validatePrivateUserTakeoverPreflight rejects unsafe timeout and public docs artifact roots', () => {
  const result = validatePrivateUserTakeoverPreflight(
    validManifest({
      collaboration: {
        interactiveUserTakeoverEnabled: true,
        requestElementSelectionPlanned: true,
        userCanDecline: true,
        expectedUserAction: 'select_visible_element',
        nonSensitiveSelectionPrompt:
          'Select one visible non-sensitive element to confirm takeover.',
        takeoverTimeoutMs: 1000,
      },
      artifactRoot: 'E:/projects/AI/codex/main_tabrix/docs/user-takeover-result/',
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.missingFields.includes('artifactRoot'));
  assert.ok(result.preflightProof.invalidFields.includes('collaboration.takeoverTimeoutMs'));
  assert.equal(result.preflightProof.privateArtifactRootPresent, false);
});

test('validatePrivateUserTakeoverPreflight rejects sensitive raw fields', () => {
  const result = validatePrivateUserTakeoverPreflight(
    validManifest({
      selectedElementText: 'must-not-be-present',
      target: {
        privateTargetConfigured: true,
        targetEvidence: 'owner_private_page_configured_outside_public_repo',
        url: 'https://private.example.invalid',
      },
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.sensitiveFields.includes('selectedElementText'));
  assert.ok(result.preflightProof.sensitiveFields.includes('target.url'));
});

test('validatePrivateUserTakeoverPreflight blocks non-user-takeover scenario classes', () => {
  const result = validatePrivateUserTakeoverPreflight(
    validManifest({
      scenarioClass: 'auth_collaboration_resume_v1',
    }),
  );

  assert.equal(result.ok, false);
  assert.ok(result.preflightProof.missingFields.includes('scenarioClass'));
  assert.equal(result.requiredScenarioClass, 'user_takeover_collaboration_v1');
});

test('parseArgs supports input, template, and acceptance brief options', () => {
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

test('buildAcceptanceBrief defines user takeover evidence without pass claims', () => {
  const brief = buildAcceptanceBrief();

  assert.equal(brief.scenarioClass, 'user_takeover_collaboration_v1');
  assert.match(brief.objective, /live user interaction/);
  assert.ok(brief.requiredOwnerInputs.privateTargetPage);
  assert.ok(brief.requiredRuntimeEvidence.requestElementSelection);
  assert.ok(brief.passBar.includes('live chrome_request_element_selection prompt completed by the user'));
  assert.ok(brief.artifactContract.privateOnlyFields.includes('selectedElementText'));
  assert.ok(brief.artifactContract.privateOnlyFields.includes('privateTargetPage'));
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('private scenario PASS'));
  assert.ok(brief.claimBoundary.notSafeToClaim.includes('product delivery grade'));
});
