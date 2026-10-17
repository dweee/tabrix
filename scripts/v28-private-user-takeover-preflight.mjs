import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_SCENARIO_CLASS = 'user_takeover_collaboration_v1';
const REQUIRED_EVIDENCE_LEVEL = 'private_scenario';
const VALID_MODES = new Set(['product-acceptance']);
const VALID_RISK_LEVELS = new Set(['R1', 'R2', 'R3-stop-before-submit']);
const VALID_PROFILE_MODES = new Set(['same_profile']);
const VALID_EXPECTED_USER_ACTIONS = new Set(['select_visible_element']);
const MIN_TAKEOVER_TIMEOUT_MS = 10_000;
const MAX_TAKEOVER_TIMEOUT_MS = 600_000;

const REQUIRED_CAPABILITY_FLAGS = [
  'pageRegions',
  'userTakeoverDetection',
  'collaborationRequiredState',
  'requestElementSelection',
  'resumeAfterUserSelection',
  'beforeAfterObjectLifecycle',
  'postActionStateSummary',
  'browserHygiene',
];

const SENSITIVE_KEY_PATTERNS = [
  /cookie/i,
  /authorization/i,
  /token/i,
  /password/i,
  /secret/i,
  /rawBody/i,
  /rawHtml/i,
  /rawText/i,
  /rawSelection/i,
  /selectedElementText/i,
  /selector/i,
  /screenshot/i,
  /accountName/i,
  /profileName/i,
  /url/i,
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getField(object, pathSegments) {
  let current = object;
  for (const segment of pathSegments) {
    if (!isPlainObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function hasNonEmptyString(object, fieldPath) {
  const value = getField(object, fieldPath.split('.'));
  return typeof value === 'string' && value.trim().length > 0;
}

function hasFiniteNumber(object, fieldPath) {
  const value = getField(object, fieldPath.split('.'));
  return typeof value === 'number' && Number.isFinite(value);
}

function pushMissing(missingFields, condition, fieldName) {
  if (!condition) {
    missingFields.push(fieldName);
  }
}

function privateArtifactRootIsValid(artifactRoot) {
  if (typeof artifactRoot !== 'string' || artifactRoot.trim().length === 0) {
    return false;
  }

  const normalized = artifactRoot.replaceAll('\\', '/').toLowerCase();
  if (normalized.includes('/docs/') || normalized.endsWith('/docs')) {
    return false;
  }

  return (
    normalized.includes('tabrix-private-tests/artifacts/real-user-scenarios/') ||
    normalized.includes('.claude/test-reports/')
  );
}

function collectSensitiveKeys(value, prefix = '') {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectSensitiveKeys(item, `${prefix}[${index}]`));
  }

  if (!isPlainObject(value)) {
    return [];
  }

  const keys = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key))) {
      keys.push(childPath);
    }
    keys.push(...collectSensitiveKeys(child, childPath));
  }
  return keys;
}

function buildTemplate() {
  return {
    mode: 'product-acceptance',
    scenarioId: 'V28-RS-USER-TAKEOVER-01',
    scenarioClass: REQUIRED_SCENARIO_CLASS,
    runId: 'replace-with-run-id',
    mainTabrixHead: 'replace-with-current-head',
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
        baselineTabCount: 1,
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
      'E:/projects/AI/codex/tabrix-private-tests/artifacts/real-user-scenarios/replace-with-run-id/',
  };
}

export function buildAcceptanceBrief() {
  return {
    scenarioClass: REQUIRED_SCENARIO_CLASS,
    objective:
      'Run user_takeover_collaboration_v1 only when an owner-private target page and live user interaction are available.',
    requiredOwnerInputs: {
      privateTargetPage: 'owner-provided outside the public repo',
      liveUserInteraction:
        'owner/user must interact with the Tabrix element-selection prompt during the run',
      nonSensitiveSelectionPrompt:
        'prompt must ask for a visible non-sensitive element and allow the user to decline',
      sameProfileEvidence: 'same_profile must be confirmed before the run starts',
    },
    requiredRuntimeEvidence: {
      collaborationPreflight:
        'action preflight must expose collaboration_required before touching an active user tab',
      requestElementSelection:
        'chrome_request_element_selection must be invoked for live user selection, not simulated by deterministic code',
      takeoverObservation:
        'artifact records selection outcome kind, timing, and resume decision without raw element text or selector',
      resumeAfterUserSelection:
        'Tabrix resumes only after user selection or records an explicit decline/timeout boundary',
      browserHygiene:
        'baseline/final tab and window state must be recorded and Browser Hygiene must PASS or be explicitly BLOCKED',
    },
    artifactContract: {
      allowedPublicSummaryFields: [
        'scenarioClass',
        'runId',
        'mainTabrixHead',
        'status',
        'evidenceLevel',
        'collaborationVerdict',
        'selectionOutcomeKind',
        'resumeVerdict',
        'browserHygieneVerdict',
        'claimBoundary',
        'freshnessTimestamp',
      ],
      privateOnlyFields: [
        'privateTargetPage',
        'rawVisibleText',
        'rawSelection',
        'selectedElementText',
        'selector',
        'rawScreenshot',
        'accountIdentity',
        'cookies',
        'authorization',
        'tokens',
      ],
    },
    passBar: [
      'same-profile/private target evidence present',
      'collaboration_required preflight observed before active user-tab impact',
      'live chrome_request_element_selection prompt completed by the user',
      'resume decision recorded after selection, decline, or timeout',
      'Browser Hygiene PASS or explicit BLOCKED classification',
      'redacted private artifact written outside the public repo',
    ],
    claimBoundary: {
      safeToClaim:
        'this brief defines the private user-takeover acceptance contract and can guide a future live run',
      notSafeToClaim: [
        'private scenario PASS',
        'user takeover proven',
        'collaboration resume proven',
        'Browser Hygiene PASS for a private run',
        'product delivery grade',
        'release ready',
      ],
    },
  };
}

export function validatePrivateUserTakeoverPreflight(manifest) {
  const missingFields = [];
  const invalidFields = [];

  pushMissing(missingFields, isPlainObject(manifest), 'manifest');
  if (!isPlainObject(manifest)) {
    return buildPreflightResult({
      manifest: {},
      missingFields,
      invalidFields,
      sensitiveFields: [],
    });
  }

  pushMissing(missingFields, VALID_MODES.has(manifest.mode), 'mode');
  pushMissing(missingFields, hasNonEmptyString(manifest, 'scenarioId'), 'scenarioId');
  pushMissing(
    missingFields,
    manifest.scenarioClass === REQUIRED_SCENARIO_CLASS,
    'scenarioClass',
  );
  pushMissing(missingFields, hasNonEmptyString(manifest, 'runId'), 'runId');
  pushMissing(missingFields, hasNonEmptyString(manifest, 'mainTabrixHead'), 'mainTabrixHead');
  pushMissing(
    missingFields,
    manifest.naturalLanguageTaskPresent === true,
    'naturalLanguageTaskPresent',
  );
  pushMissing(missingFields, VALID_RISK_LEVELS.has(manifest.riskLevel), 'riskLevel');
  pushMissing(missingFields, hasNonEmptyString(manifest, 'requestedToolPath'), 'requestedToolPath');
  pushMissing(
    missingFields,
    VALID_PROFILE_MODES.has(getField(manifest, ['chrome', 'profileMode'])),
    'chrome.profileMode',
  );
  pushMissing(
    missingFields,
    hasNonEmptyString(manifest, 'chrome.profileEvidence'),
    'chrome.profileEvidence',
  );
  pushMissing(
    missingFields,
    getField(manifest, ['target', 'privateTargetConfigured']) === true,
    'target.privateTargetConfigured',
  );
  pushMissing(
    missingFields,
    hasNonEmptyString(manifest, 'target.targetEvidence'),
    'target.targetEvidence',
  );
  pushMissing(
    missingFields,
    getField(manifest, ['collaboration', 'interactiveUserTakeoverEnabled']) === true,
    'collaboration.interactiveUserTakeoverEnabled',
  );
  pushMissing(
    missingFields,
    getField(manifest, ['collaboration', 'requestElementSelectionPlanned']) === true,
    'collaboration.requestElementSelectionPlanned',
  );
  pushMissing(
    missingFields,
    getField(manifest, ['collaboration', 'userCanDecline']) === true,
    'collaboration.userCanDecline',
  );
  pushMissing(
    missingFields,
    VALID_EXPECTED_USER_ACTIONS.has(getField(manifest, ['collaboration', 'expectedUserAction'])),
    'collaboration.expectedUserAction',
  );
  pushMissing(
    missingFields,
    hasNonEmptyString(manifest, 'collaboration.nonSensitiveSelectionPrompt'),
    'collaboration.nonSensitiveSelectionPrompt',
  );
  pushMissing(
    missingFields,
    hasFiniteNumber(manifest, 'collaboration.takeoverTimeoutMs'),
    'collaboration.takeoverTimeoutMs',
  );
  pushMissing(
    missingFields,
    hasFiniteNumber(manifest, 'browserHygiene.before.baselineWindowCount'),
    'browserHygiene.before.baselineWindowCount',
  );
  pushMissing(
    missingFields,
    hasFiniteNumber(manifest, 'browserHygiene.before.baselineTabCount'),
    'browserHygiene.before.baselineTabCount',
  );
  pushMissing(
    missingFields,
    getField(manifest, ['browserHygiene', 'before', 'activeTabPresent']) === true,
    'browserHygiene.before.activeTabPresent',
  );

  const artifactRoot = getField(manifest, ['artifactRoot']);
  pushMissing(missingFields, privateArtifactRootIsValid(artifactRoot), 'artifactRoot');

  const capabilityEvidencePlanned = isPlainObject(manifest.capabilityEvidencePlanned)
    ? manifest.capabilityEvidencePlanned
    : {};
  for (const flag of REQUIRED_CAPABILITY_FLAGS) {
    pushMissing(
      missingFields,
      capabilityEvidencePlanned[flag] === true,
      `capabilityEvidencePlanned.${flag}`,
    );
  }

  const head = getField(manifest, ['mainTabrixHead']);
  if (typeof head === 'string' && !/^[0-9a-f]{7,40}$/i.test(head)) {
    invalidFields.push('mainTabrixHead');
  }

  const takeoverTimeoutMs = getField(manifest, ['collaboration', 'takeoverTimeoutMs']);
  if (
    typeof takeoverTimeoutMs === 'number' &&
    Number.isFinite(takeoverTimeoutMs) &&
    (takeoverTimeoutMs < MIN_TAKEOVER_TIMEOUT_MS ||
      takeoverTimeoutMs > MAX_TAKEOVER_TIMEOUT_MS)
  ) {
    invalidFields.push('collaboration.takeoverTimeoutMs');
  }

  const sensitiveFields = collectSensitiveKeys(manifest);
  return buildPreflightResult({ manifest, missingFields, invalidFields, sensitiveFields });
}

function buildPreflightResult({ manifest, missingFields, invalidFields, sensitiveFields }) {
  const proofSatisfied =
    missingFields.length === 0 && invalidFields.length === 0 && sensitiveFields.length === 0;

  return {
    ok: proofSatisfied,
    status: proofSatisfied ? 'READY_FOR_PRIVATE_ACCEPTANCE' : 'BLOCKED_PRECHECK',
    scenarioClass:
      typeof manifest.scenarioClass === 'string' ? manifest.scenarioClass : REQUIRED_SCENARIO_CLASS,
    requiredScenarioClass: REQUIRED_SCENARIO_CLASS,
    evidenceLevel: 'preflight_only',
    requiredEvidenceLevel: REQUIRED_EVIDENCE_LEVEL,
    preflightProof: {
      proofSatisfied,
      requiredFieldsPresent: missingFields.length === 0,
      invalidFieldsAbsent: invalidFields.length === 0,
      sensitiveFieldsAbsent: sensitiveFields.length === 0,
      missingFields,
      invalidFields,
      sensitiveFields,
      privateArtifactRootPresent: privateArtifactRootIsValid(manifest.artifactRoot),
      capabilityFlagsRequired: REQUIRED_CAPABILITY_FLAGS,
    },
    claimBoundary: {
      safeToClaim:
        'private user-takeover collaboration acceptance metadata is ready for a real run only when ok=true',
      notSafeToClaim: [
        'private scenario PASS',
        'user takeover proven',
        'collaboration resume proven',
        'Browser Hygiene PASS for a private run',
        'product delivery grade',
        'release ready',
      ],
    },
  };
}

export function parseArgs(argv) {
  const args = {
    input: null,
    printTemplate: false,
    printAcceptanceBrief: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.input = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--print-template') {
      args.printTemplate = true;
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
  node scripts/v28-private-user-takeover-preflight.mjs --input <manifest.json>
  node scripts/v28-private-user-takeover-preflight.mjs --print-template
  node scripts/v28-private-user-takeover-preflight.mjs --print-acceptance-brief
`);
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }

  if (args.printTemplate) {
    process.stdout.write(`${JSON.stringify(buildTemplate(), null, 2)}\n`);
    return 0;
  }

  if (args.printAcceptanceBrief) {
    process.stdout.write(`${JSON.stringify(buildAcceptanceBrief(), null, 2)}\n`);
    return 0;
  }

  const manifest = args.input
    ? readJsonFile(path.resolve(args.input))
    : { scenarioClass: REQUIRED_SCENARIO_CLASS };
  const result = validatePrivateUserTakeoverPreflight(manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
