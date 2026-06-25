import assert from 'node:assert/strict';

import {
  TABRIX_SITE_ID_PATTERN,
  TOOL_NAMES,
  TOOL_SCHEMAS,
  normalizeTabrixSiteId,
} from '../dist/index.mjs';

assert.equal(normalizeTabrixSiteId(' example.test '), 'example.test');
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
assert.equal(siteIdSchema.enum, undefined, 'siteId schema must not be platform-only enum');
assert.equal(siteIdSchema.pattern, TABRIX_SITE_ID_PATTERN.source);
assert.equal(new RegExp(siteIdSchema.pattern).test('example.test'), true);
assert.equal(new RegExp(siteIdSchema.pattern).test('bad/slash'), false);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'site',
    siteIdPattern: TABRIX_SITE_ID_PATTERN.source,
  }),
);
