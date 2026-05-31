#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  buildAcceptanceBrief as buildAuthAcceptanceBrief,
  validatePrivateAuthLifecyclePreflight,
} from './v28-private-auth-lifecycle-preflight.mjs';
import {
  buildAcceptanceBrief as buildUserTakeoverAcceptanceBrief,
  validatePrivateUserTakeoverPreflight,
} from './v28-private-user-takeover-preflight.mjs';

const REQUIRED_SCENARIOS = [
  {
    key: 'auth',
    scenarioClass: 'auth_collaboration_resume_v1',
    inputArg: 'authInput',
    validator: validatePrivateAuthLifecyclePreflight,
    briefBuilder: buildAuthAcceptanceBrief,
  },
  {
    key: 'userTakeover',
    scenarioClass: 'user_takeover_collaboration_v1',
    inputArg: 'userTakeoverInput',
    validator: validatePrivateUserTakeoverPreflight,
    briefBuilder: buildUserTakeoverAcceptanceBrief,
  },
];

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function summarizeScenario(scenario, manifest) {
  if (!manifest) {
    return {
      key: scenario.key,
      scenarioClass: scenario.scenarioClass,
      ok: false,
      status: 'MISSING_MANIFEST',
      evidenceLevel: 'preflight_only',
      requiredEvidenceLevel: 'private_scenario',
      preflightProof: {
        proofSatisfied: false,
        missingFields: [scenario.inputArg],
        invalidFields: [],
        sensitiveFields: [],
      },
    };
  }

  const result = scenario.validator(manifest);
  return {
    key: scenario.key,
    scenarioClass: result.scenarioClass,
    requiredScenarioClass: result.requiredScenarioClass,
    ok: result.ok,
    status: result.status,
    evidenceLevel: result.evidenceLevel,
    requiredEvidenceLevel: result.requiredEvidenceLevel,
    preflightProof: {
      proofSatisfied: result.preflightProof.proofSatisfied,
      missingFields: result.preflightProof.missingFields,
      invalidFields: result.preflightProof.invalidFields,
      sensitiveFields: result.preflightProof.sensitiveFields,
      privateArtifactRootPresent: result.preflightProof.privateArtifactRootPresent,
      capabilityFlagsRequired: result.preflightProof.capabilityFlagsRequired,
    },
  };
}

export function buildPrivateScenarioMatrixAcceptanceBrief() {
  return {
    matrixId: 'v28-r4-private-scenario-minimum-matrix',
    objective:
      'Gate R4 private scenario closure on both auth/modal/QR lifecycle and live user-takeover collaboration evidence.',
    requiredScenarios: REQUIRED_SCENARIOS.map((scenario) => ({
      key: scenario.key,
      scenarioClass: scenario.scenarioClass,
      acceptanceBrief: scenario.briefBuilder(),
    })),
    matrixPassBar: [
      'auth_collaboration_resume_v1 preflight is READY_FOR_PRIVATE_ACCEPTANCE before live run',
      'user_takeover_collaboration_v1 preflight is READY_FOR_PRIVATE_ACCEPTANCE before live run',
      'each scenario writes redacted artifacts outside the public repository',
      'each scenario records Browser Hygiene baseline and closeout',
      'R4 matrix PASS is forbidden until real private scenario artifacts prove both scenarios',
    ],
    claimBoundary: {
      safeToClaim:
        'the R4 private scenario matrix has a deterministic preflight gate and redacted acceptance contract',
      notSafeToClaim: [
        'R4 private scenario matrix PASS',
        'auth/modal/QR lifecycle proven',
        'user takeover proven',
        'collaboration resume proven',
        'Browser Hygiene PASS for private runs',
        'product delivery grade',
        'commercial ready',
        'release ready',
      ],
    },
  };
}

export function validatePrivateScenarioMatrixPreflight(manifests = {}) {
  const scenarioResults = REQUIRED_SCENARIOS.map((scenario) =>
    summarizeScenario(scenario, manifests[scenario.key]),
  );
  const missingScenarios = scenarioResults
    .filter((scenarioResult) => scenarioResult.status === 'MISSING_MANIFEST')
    .map((scenarioResult) => scenarioResult.key);
  const blockedScenarios = scenarioResults
    .filter((scenarioResult) => scenarioResult.status !== 'MISSING_MANIFEST' && !scenarioResult.ok)
    .map((scenarioResult) => scenarioResult.key);
  const readyScenarios = scenarioResults
    .filter((scenarioResult) => scenarioResult.ok)
    .map((scenarioResult) => scenarioResult.key);
  const proofSatisfied = missingScenarios.length === 0 && blockedScenarios.length === 0;

  return {
    ok: proofSatisfied,
    status: proofSatisfied
      ? 'READY_FOR_PRIVATE_MATRIX_ACCEPTANCE'
      : 'BLOCKED_MATRIX_PRECHECK',
    matrixId: 'v28-r4-private-scenario-minimum-matrix',
    evidenceLevel: 'preflight_only',
    requiredEvidenceLevel: 'private_scenario_matrix',
    requiredScenarioClasses: REQUIRED_SCENARIOS.map((scenario) => scenario.scenarioClass),
    matrixProof: {
      proofSatisfied,
      requiredScenarioCount: REQUIRED_SCENARIOS.length,
      readyScenarios,
      missingScenarios,
      blockedScenarios,
      scenarioResults,
    },
    claimBoundary: {
      safeToClaim:
        'R4 private scenario matrix metadata is ready for real private acceptance only when ok=true',
      notSafeToClaim: [
        'R4 private scenario matrix PASS',
        'private scenario PASS',
        'auth/modal/QR lifecycle proven',
        'user takeover proven',
        'collaboration resume proven',
        'product delivery grade',
        'commercial ready',
        'release ready',
      ],
    },
  };
}

export function parseArgs(argv) {
  const args = {
    authInput: null,
    userTakeoverInput: null,
    printAcceptanceBrief: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--auth-input') {
      args.authInput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--user-takeover-input') {
      args.userTakeoverInput = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--print-acceptance-brief') {
      args.printAcceptanceBrief = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/v28-private-scenario-matrix-gate.mjs --auth-input <manifest.json> --user-takeover-input <manifest.json>
  node scripts/v28-private-scenario-matrix-gate.mjs --print-acceptance-brief
`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.printAcceptanceBrief) {
    process.stdout.write(`${JSON.stringify(buildPrivateScenarioMatrixAcceptanceBrief(), null, 2)}\n`);
    return 0;
  }

  const manifests = {};
  if (args.authInput) {
    manifests.auth = readJsonFile(path.resolve(args.authInput));
  }
  if (args.userTakeoverInput) {
    manifests.userTakeover = readJsonFile(path.resolve(args.userTakeoverInput));
  }

  const result = validatePrivateScenarioMatrixPreflight(manifests);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
