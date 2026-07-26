import assert from 'node:assert/strict';

import {
  P3_EXPLICIT_OPT_IN_TOOLS,
  TOOL_NAMES,
  TOOL_RISK_TIERS,
  TOOL_SCHEMAS,
  getToolRiskTier,
  isExplicitOptInTool,
} from '../dist/index.mjs';

function flattenToolNames(value, out = new Set()) {
  if (typeof value === 'string') {
    out.add(value);
    return out;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) {
      flattenToolNames(child, out);
    }
  }
  return out;
}

const allToolNames = flattenToolNames(TOOL_NAMES);
const schemaNames = TOOL_SCHEMAS.map((schema) => schema.name);
const schemaNameSet = new Set(schemaNames);
const riskTierNames = Object.keys(TOOL_RISK_TIERS);
const prohibitedTopLevelInputSchemaKeywords = ['oneOf', 'anyOf', 'allOf', 'enum', 'not'];

assert.ok(schemaNames.length > 0, 'TOOL_SCHEMAS must expose at least one tool schema');
assert.equal(
  schemaNameSet.size,
  schemaNames.length,
  'TOOL_SCHEMAS must not contain duplicate names',
);

for (const name of schemaNames) {
  assert.ok(allToolNames.has(name), `schema tool "${name}" must be declared in TOOL_NAMES`);
  assert.ok(getToolRiskTier(name), `schema tool "${name}" must have a risk tier`);
  const inputSchema = TOOL_SCHEMAS.find((schema) => schema.name === name)?.inputSchema;
  assert.equal(inputSchema?.type, 'object', `schema tool "${name}" inputSchema must be an object`);
  for (const keyword of prohibitedTopLevelInputSchemaKeywords) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(inputSchema, keyword),
      false,
      `schema tool "${name}" inputSchema must not use top-level ${keyword}`,
    );
  }
}

for (const name of riskTierNames) {
  assert.ok(allToolNames.has(name), `risk-tier key "${name}" must be declared in TOOL_NAMES`);
}

for (const name of P3_EXPLICIT_OPT_IN_TOOLS) {
  assert.equal(getToolRiskTier(name), 'P3', `explicit opt-in tool "${name}" must be P3`);
  assert.equal(isExplicitOptInTool(name), true, `explicit opt-in helper must recognize "${name}"`);
}

const taskSessionTools = [
  TOOL_NAMES.BROWSER.NAVIGATE,
  TOOL_NAMES.BROWSER.READ_PAGE,
  TOOL_NAMES.BROWSER.WEB_FETCHER,
  TOOL_NAMES.BROWSER.SWITCH_TAB,
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
  TOOL_NAMES.BROWSER.KEYBOARD,
  TOOL_NAMES.BROWSER.CLOSE_TABS,
];

for (const name of taskSessionTools) {
  const properties = TOOL_SCHEMAS.find((schema) => schema.name === name)?.inputSchema?.properties;
  assert.ok(
    properties?.taskSessionId,
    `${name} must expose taskSessionId for task-owned browser sessions`,
  );
  assert.ok(
    properties?.runtimePolicy,
    `${name} must expose runtimePolicy for task-owned browser sessions`,
  );
  assert.deepEqual(
    properties.runtimePolicy.properties?.desiredExecutionMode?.enum,
    ['run_owned', 'background', 'current_tab_readonly', 'collaboration'],
    `${name} runtimePolicy.desiredExecutionMode must expose supported execution modes`,
  );
}

const candidateActionTools = [
  TOOL_NAMES.BROWSER.CLICK,
  TOOL_NAMES.BROWSER.FILL,
  TOOL_NAMES.BROWSER.COMPUTER,
];

for (const name of candidateActionTools) {
  const candidateActionProperties = TOOL_SCHEMAS.find((schema) => schema.name === name)?.inputSchema
    ?.properties?.candidateAction?.properties;
  assert.deepEqual(
    candidateActionProperties?.executionTargetKind?.enum,
    ['page_ref', 'snapshot_locator', 'stable_ref'],
    `${name} candidateAction.executionTargetKind must preserve executable target semantics`,
  );
}

console.log(
  JSON.stringify({
    status: 'PASS',
    schemaCount: schemaNames.length,
    riskTierCount: riskTierNames.length,
    explicitOptInCount: P3_EXPLICIT_OPT_IN_TOOLS.size,
  }),
);
