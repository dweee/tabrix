import assert from 'node:assert/strict';

import {
  LAYER_DISPATCH_REASON_VALUES,
  LAYER_SOURCE_ROUTE_VALUES,
  READ_PAGE_COVERAGE_STATUS_VALUES,
  READ_PAGE_EVIDENCE_SOURCE_VALUES,
  READ_PAGE_MODE_MINIMUM_FIELDS,
  READ_PAGE_OBSERVATION_PROFILE_VALUES,
  READ_PAGE_REGION_TARGETABILITY_VALUES,
  READ_PAGE_REGION_TYPES,
  READ_PAGE_OPERATION_PURPOSES,
  READ_PAGE_OPERATION_READINESS_VALUES,
  READ_PAGE_REGION_LAYOUT_HINTS,
  READ_PAGE_REGION_MENU_ITEM_ROLES,
  READ_PAGE_OBJECT_LIFECYCLE_CHANGE_KINDS,
  READ_PAGE_OBJECT_LIFECYCLE_FAMILIES,
  READ_PAGE_AUTH_ARTIFACT_STATUS_VALUES,
  READ_PAGE_AUTH_CHALLENGE_TYPES,
  READ_PAGE_AUTH_COLLABORATION_STATUS_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES,
  READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES,
  READ_PAGE_REQUESTED_LAYER_VALUES,
  READ_PAGE_TASK_PROTOCOL_FIELDS,
  STABLE_TARGET_REF_PREFIX,
  estimateTokensFromBytes,
  estimateTokensFromString,
} from '../dist/index.mjs';

assert.deepEqual(READ_PAGE_REQUESTED_LAYER_VALUES, ['L0', 'L0+L1', 'L0+L1+L2']);

assert.deepEqual(READ_PAGE_OBSERVATION_PROFILE_VALUES, [
  'compact',
  'task',
  'delta',
  'full',
  'debug',
]);

assert.deepEqual(READ_PAGE_COVERAGE_STATUS_VALUES, [
  'covered',
  'degraded',
  'unsupported',
  'visible_unresolved',
]);

assert.deepEqual(READ_PAGE_EVIDENCE_SOURCE_VALUES, [
  'dom',
  'ax',
  'visible_text',
  'network',
  'api',
  'cdp',
  'watch_delta',
  'screenshot_fallback',
  'experience',
]);

assert.deepEqual(LAYER_SOURCE_ROUTE_VALUES, [
  'read_page_required',
  'knowledge_supported_read',
  'dispatcher_fallback_safe',
]);

assert.deepEqual(LAYER_DISPATCH_REASON_VALUES, [
  'safety_required_full_layers',
  'user_intent_summary',
  'user_intent_open_or_select',
  'user_intent_form_or_submit',
  'user_intent_details_or_compare',
  'task_type_reading_only',
  'task_type_action',
  'simple_page_low_density',
  'medium_page_overview',
  'complex_page_detail_required',
  'knowledge_supports_summary',
  'knowledge_with_action',
  'dispatcher_fallback_safe',
]);

assert.deepEqual(READ_PAGE_TASK_PROTOCOL_FIELDS, [
  'taskMode',
  'complexityLevel',
  'sourceKind',
  'highValueObjects',
  'pageRegions',
  'pageOperationMap',
  'objectLifecycle',
  'watchScope',
  'L0',
  'L1',
  'L2',
]);

assert.deepEqual(READ_PAGE_REGION_TYPES, [
  'navigation',
  'content',
  'account',
  'menu',
  'modal',
  'qr_code',
  'form',
  'feedback',
  'unknown',
]);

assert.deepEqual(READ_PAGE_REGION_TARGETABILITY_VALUES, [
  'target_ref',
  'locator_chain',
  'not_clickable',
  'unknown',
]);

assert.deepEqual(READ_PAGE_REGION_LAYOUT_HINTS, [
  'left_sidebar',
  'top_navigation',
  'right_sidebar',
  'bottom_navigation',
  'top_right',
  'inline',
  'unknown',
]);

assert.deepEqual(READ_PAGE_REGION_MENU_ITEM_ROLES, [
  'primary_navigation',
  'overflow_menu_trigger',
  'account_entry',
  'secondary_menu_action',
  'auth_entry',
  'content_action',
  'unknown',
]);

assert.deepEqual(READ_PAGE_OPERATION_PURPOSES, [
  'navigate',
  'search',
  'read_content',
  'open_menu',
  'account',
  'auth',
  'scan_qr',
  'prepare_publish',
  'submit_form',
  'observe_feedback',
  'unknown',
]);

assert.deepEqual(READ_PAGE_OPERATION_READINESS_VALUES, [
  'ready',
  'needs_expand',
  'blocked',
  'not_targetable',
  'unknown',
]);

assert.deepEqual(READ_PAGE_OBJECT_LIFECYCLE_FAMILIES, [
  'auth_surface',
  'qr_code',
  'account_identity',
  'menu_surface',
  'menu_item',
  'form_control',
  'feedback_surface',
  'content_collection',
  'unknown',
]);

assert.deepEqual(READ_PAGE_OBJECT_LIFECYCLE_CHANGE_KINDS, [
  'appeared',
  'disappeared',
  'changed',
  'unchanged',
  'unknown',
]);

assert.deepEqual(READ_PAGE_AUTH_ARTIFACT_STATUS_VALUES, [
  'not_requested',
  'not_applicable',
  'blocked',
  'ready',
  'failed',
]);

assert.deepEqual(READ_PAGE_AUTH_COLLABORATION_STATUS_VALUES, [
  'not_required',
  'required',
  'waiting_for_user',
  'succeeded_candidate',
  'not_proven',
]);

assert.deepEqual(READ_PAGE_AUTH_CHALLENGE_TYPES, [
  'qr',
  'otp',
  'password_form',
  'captcha',
  'sso_external',
  'unknown',
]);

assert.deepEqual(READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES, [
  'auth',
  'search',
  'extract_content',
  'unknown',
]);

assert.deepEqual(READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES, [
  'qr',
  'otp',
  'manual',
  'auto',
]);

assert.deepEqual(READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES, [
  'auth_surface',
  'qr_image',
  'phone_input',
  'otp_input',
  'search_input',
  'result_cards',
  'detail_metrics',
]);

assert.deepEqual(READ_PAGE_MODE_MINIMUM_FIELDS, {
  compact: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs'],
  normal: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'diagnostics'],
  full: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'fullSnapshot'],
});

assert.equal(STABLE_TARGET_REF_PREFIX, 'tgt_');
assert.equal(estimateTokensFromBytes(null), 0);
assert.equal(estimateTokensFromBytes(0), 0);
assert.equal(estimateTokensFromBytes(1), 1);
assert.equal(estimateTokensFromBytes(4), 1);
assert.equal(estimateTokensFromBytes(5), 2);
assert.equal(estimateTokensFromString('abcd'), 1);

console.log(
  JSON.stringify({
    status: 'PASS',
    contract: 'read-page',
    requestedLayerCount: READ_PAGE_REQUESTED_LAYER_VALUES.length,
    sourceRouteCount: LAYER_SOURCE_ROUTE_VALUES.length,
    dispatchReasonCount: LAYER_DISPATCH_REASON_VALUES.length,
  }),
);
