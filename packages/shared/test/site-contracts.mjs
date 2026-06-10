import assert from 'node:assert/strict';

import {
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
  EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS,
  TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES,
  TABRIX_GITHUB_SITE_ID,
  TABRIX_SITE_ID_PATTERN,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  checkTabrixExperienceReplayPolicy,
  getTabrixExperienceReplayPolicyForSite,
  getTaskWeightsFor,
  normalizeTabrixSiteId,
} from '../dist/index.mjs';

assert.equal(normalizeTabrixSiteId(' github '), TABRIX_GITHUB_SITE_ID);
assert.equal(normalizeTabrixSiteId('Example.Test'), 'example.test');
assert.equal(normalizeTabrixSiteId('example-test_1'), 'example-test_1');
assert.equal(normalizeTabrixSiteId('bad/slash'), undefined);
assert.equal(normalizeTabrixSiteId('two words'), undefined);

const chooseContextSchema = TOOL_SCHEMAS.find(
  (schema) => schema.name === TOOL_NAMES.CONTEXT.CHOOSE,
);
assert.ok(chooseContextSchema, 'tabrix_choose_context schema must be exported');

const siteIdSchema = chooseContextSchema.inputSchema.properties.siteId;
assert.equal(siteIdSchema.type, 'string');
assert.equal(siteIdSchema.enum, undefined, 'siteId schema must not be GitHub-only enum');
assert.equal(siteIdSchema.pattern, TABRIX_SITE_ID_PATTERN.source);
assert.equal(new RegExp(siteIdSchema.pattern).test('example.test'), true);
assert.equal(new RegExp(siteIdSchema.pattern).test('bad/slash'), false);

const githubPolicy = getTabrixExperienceReplayPolicyForSite(TABRIX_GITHUB_SITE_ID);
assert.ok(githubPolicy, 'GitHub replay policy must remain exported');
assert.equal(githubPolicy.allowedPageRoles, TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES);

const githubReplay = checkTabrixExperienceReplayPolicy({
  siteFamily: TABRIX_GITHUB_SITE_ID,
  pageRole: 'repo_home',
});
assert.equal(githubReplay.allowed, true);
assert.equal(githubReplay.blockedBy, undefined);

const unconfiguredReplay = checkTabrixExperienceReplayPolicy({
  siteFamily: 'example.test',
  pageRole: 'repo_home',
});
assert.equal(unconfiguredReplay.allowed, false);
assert.equal(unconfiguredReplay.blockedBy, 'site_replay_policy_missing');

assert.equal(
  getTaskWeightsFor(TABRIX_GITHUB_SITE_ID, 'releases/new'),
  EXPERIENCE_SCORE_STEP_GITHUB_TASK_WEIGHTS.releases_new,
);
assert.equal(
  getTaskWeightsFor('example.test', 'releases/new'),
  EXPERIENCE_SCORE_STEP_BASELINE_TASK_WEIGHTS,
);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'site',
    githubReplayRoles: TABRIX_EXPERIENCE_REPLAY_GITHUB_PAGE_ROLES.size,
  }),
);
