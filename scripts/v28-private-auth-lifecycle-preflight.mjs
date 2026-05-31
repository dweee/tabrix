import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REQUIRED_SCENARIO_CLASS = 'auth_collaboration_resume_v1';
const REQUIRED_EVIDENCE_LEVEL = 'private_scenario';
const VALID_MODES = new Set(['product-acceptance']);
const VALID_RISK_LEVELS = new Set(['R1', 'R2', 'R3-stop-before-submit']);
const VALID_PROFILE_MODES = new Set(['same_profile']);
const VALID_ACCOUNT_STATES = new Set([
  'confirmed_logged_in',
  'confirmed_logged_out',
  'login_required',
  'challenge_required',
]);

const REQUIRED_CAPABILITY_FLAGS = [
  'pageRegions',
  'accountState',
  'modalState',
  'qrState',
  'beforeAfterObjectLifecycle',
  'postActionStateSummary',
  'collaborationResume',
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
  /qrPayload/i,
  /qrImage/i,
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
    scenarioId: 'V28-RS-AUTH-COLLABORATION-01',
    scenarioClass: REQUIRED_SCENARIO_CLASS,
    runId: 'replace-with-run-id',
    mainTabrixHead: 'replace-with-current-head',
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
        baselineTabCount: 1,
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
      'E:/projects/AI/codex/tabrix-private-tests/artifacts/real-user-scenarios/replace-with-run-id/',
  };
}

export function validatePrivateAuthLifecyclePreflight(manifest) {
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
    VALID_ACCOUNT_STATES.has(getField(manifest, ['chrome', 'accountState'])),
    'chrome.accountState',
  );
  pushMissing(
    missingFields,
    hasNonEmptyString(manifest, 'chrome.accountStateEvidence'),
    'chrome.accountStateEvidence',
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
        'private auth/modal/QR lifecycle acceptance metadata is ready for a real run only when ok=true',
      notSafeToClaim: [
        'private scenario PASS',
        'login/logout success',
        'modal lifecycle proven',
        'QR lifecycle proven',
        'collaboration resume proven',
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
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      args.input = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === '--print-template') {
      args.printTemplate = true;
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
  node scripts/v28-private-auth-lifecycle-preflight.mjs --input <manifest.json>
  node scripts/v28-private-auth-lifecycle-preflight.mjs --print-template
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

  const manifest = args.input
    ? readJsonFile(path.resolve(args.input))
    : { scenarioClass: REQUIRED_SCENARIO_CLASS };
  const result = validatePrivateAuthLifecyclePreflight(manifest);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ok ? 0 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCli();
}
