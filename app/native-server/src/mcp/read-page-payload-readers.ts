import type {
  BrowserPageThingProjection,
  ReadPageObjectLifecycleSummary,
  ReadPageOperationMap,
  ReadPageRegion,
  ReadPageSelectedDataSource,
} from '@tabrix/shared';
import {
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  readStringArray,
} from './register-tool-value-readers';

export function isBrowserPageThingProjectionLike(
  input: unknown,
): input is BrowserPageThingProjection {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const projection = input as Partial<BrowserPageThingProjection>;
  return (
    typeof projection.projectionId === 'string' &&
    typeof projection.contextChars === 'number' &&
    Array.isArray(projection.changedRegions) &&
    Array.isArray(projection.reusedRegions) &&
    Array.isArray(projection.invalidatedRefs) &&
    Array.isArray(projection.refreshedRefs)
  );
}

export function readSelectedDataSource(
  payload: Record<string, unknown>,
  projection: BrowserPageThingProjection,
): ReadPageSelectedDataSource {
  const aiPreferred = readString(payload.aiPreferredDataSource);
  if (aiPreferred === 'dom_region_rows' && hasReliableVisibleRows(payload)) {
    return aiPreferred;
  }
  if (projection.chosenDataSource === 'dom_region_rows' && hasReliableVisibleRows(payload)) {
    return projection.chosenDataSource;
  }
  const candidates = [
    readString(payload.selectedDataSource),
    readString(payload.dataSource),
    readString(payload.sourceDataSource),
    readString(payload.kind),
  ].filter((value): value is string => Boolean(value));
  const selected = candidates[0];
  if (candidates.includes('dom_region_rows')) {
    if (hasReliableVisibleRows(payload)) {
      return 'dom_region_rows';
    }
    return projection.chosenDataSource === 'dom_region_rows'
      ? 'dom_json'
      : projection.chosenDataSource;
  }
  return (selected ?? projection.chosenDataSource) as ReadPageSelectedDataSource;
}

export function readPayloadSelectedDataSource(
  payload: Record<string, unknown>,
): ReadPageSelectedDataSource | null {
  const candidates = [
    readString(payload.selectedDataSource),
    readString(payload.dataSource),
    readString(payload.sourceDataSource),
    readString(payload.kind),
  ].filter((value): value is string => Boolean(value));
  const selected = candidates.includes('dom_region_rows') ? 'dom_region_rows' : candidates[0];
  return selected ? (selected as ReadPageSelectedDataSource) : null;
}

export function hasReliableVisibleRows(payload: Record<string, unknown>): boolean {
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(payload, 'visibleDomRowsSelectedCount') ??
    readPositiveInteger(rowsPayload, 'rowCount');
  const coverage =
    readNumber(payload.targetRefCoverageRate) ?? readNumber(rowsPayload.targetRefCoverageRate);
  const quality =
    readNumber(payload.regionQualityScore) ?? readNumber(rowsPayload.regionQualityScore);
  const confidence =
    readNumber(payload.rowExtractionConfidence) ??
    readNumber(rowsPayload.rowExtractionConfidence) ??
    readNumber(payload.confidence) ??
    readNumber(rowsPayload.confidence);
  return (
    (payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true) &&
    rowCount !== null &&
    rowCount >= 2 &&
    (confidence === null || confidence >= 0.7) &&
    (coverage === null || coverage >= 0.95) &&
    (quality === null || quality >= 0.7)
  );
}

export function readPagePostconditionRegions(
  payload: Record<string, unknown>,
  regions: ReadPageRegion[],
): ReadPageRegion[] {
  const authFormRegion = buildAuthFormPostconditionRegion(payload.authCollaboration);
  const searchFilterRegion = buildSearchFilterPostconditionRegion(payload.searchSurface);
  return [authFormRegion, searchFilterRegion].reduce<ReadPageRegion[]>(
    (next, region) => (region ? [...next, region] : next),
    regions,
  );
}

export function readPageRegions(value: unknown): ReadPageRegion[] {
  return Array.isArray(value) ? (value as ReadPageRegion[]) : [];
}

function buildAuthFormPostconditionRegion(value: unknown): ReadPageRegion | null {
  const authCollaboration = readObject(value);
  const authForm = readObject(authCollaboration?.authForm);
  if (!authForm) return null;
  const formType = readString(authForm.formType);
  if (formType !== 'otp') return null;
  const readiness = readString(authForm.readiness) ?? 'not_proven';
  const controls = readObject(authForm.controls);
  const requestOtp = readObject(controls?.requestOtp);
  const otpInput = readObject(controls?.otpInput);
  const requestOtpState = readString(requestOtp?.state);
  const state =
    requestOtpState === 'countdown' || requestOtpState === 'sent_candidate'
      ? 'waiting_for_user_otp'
      : readiness;
  const candidateActionId = readString(requestOtp?.candidateActionId);
  const objects: ReadPageRegion['objects'] = [];
  if (requestOtp) {
    objects.push({
      objectId: 'auth_request_otp',
      label: 'auth request otp control',
      objectType: 'request_otp',
      targetRef: readString(requestOtp.targetRef) ?? undefined,
      actionTypes: candidateActionId ? ['click'] : [],
      targetability: readString(requestOtp.targetRef) ? 'target_ref' : 'not_clickable',
      confidence: readNumber(requestOtp.confidence) ?? 0.7,
      reason: 'privacy_safe_auth_form_postcondition_projection',
      state: requestOtpState ?? 'unknown',
    } as ReadPageRegion['objects'][number]);
  }
  if (otpInput) {
    objects.push({
      objectId: 'auth_otp_input',
      label: 'auth otp input',
      objectType: 'otp_input',
      targetRef: readString(otpInput.targetRef) ?? undefined,
      valueState: readString(otpInput.valueState) === 'non_empty' ? 'non_empty' : 'unknown',
      actionTypes: [],
      targetability: readString(otpInput.targetRef) ? 'target_ref' : 'not_clickable',
      confidence: readNumber(otpInput.confidence) ?? 0.7,
      reason: 'privacy_safe_auth_form_postcondition_projection',
      state: readString(otpInput.state) ?? 'unknown',
    } as ReadPageRegion['objects'][number]);
  }
  return {
    regionId: 'auth_form_postcondition',
    regionType: 'form',
    state,
    confidence: 0.74,
    label: 'auth form postcondition evidence',
    objects,
    candidateActionIds: candidateActionId ? [candidateActionId] : [],
    targetability: candidateActionId ? 'target_ref' : 'not_clickable',
    claimBoundary:
      'native postcondition auth-form projection is privacy-safe state evidence only; it does not include phone, OTP, password, cookie, Authorization, or QR payload',
  };
}

function buildSearchFilterPostconditionRegion(value: unknown): ReadPageRegion | null {
  const searchSurface = readObject(value);
  const filterState = readObject(searchSurface?.filterState);
  if (!filterState) return null;

  const objects: ReadPageRegion['objects'] = [];
  const candidateActionIds: string[] = [];
  const appliedLabels = readStringArray(filterState.appliedLabels)
    .map(safeVisibleLabel)
    .filter((label): label is string => label !== null);
  for (const label of appliedLabels.slice(0, 12)) {
    objects.push({
      objectId: `search_filter_applied_${stableLabelKey(label)}`,
      label,
      objectType: 'status_item',
      actionTypes: [],
      targetability: 'not_clickable',
      confidence: 0.78,
      reason: 'search_surface_filter_state_postcondition_projection',
      state: 'selected',
    } as ReadPageRegion['objects'][number]);
  }

  for (const groupKey of ['contentType', 'sort', 'timeRange'] as const) {
    const group = readObject(filterState[groupKey]);
    const selected = safeVisibleLabel(readString(group?.selected));
    if (!selected) continue;
    const candidateActionId = readString(group?.selectedCandidateId);
    if (candidateActionId) candidateActionIds.push(candidateActionId);
    objects.push({
      objectId: `search_filter_${groupKey}_${stableLabelKey(selected)}`,
      label: `${groupKey}:${selected}`,
      objectType: 'control',
      actionTypes: candidateActionId ? ['click'] : [],
      targetability: candidateActionId ? 'target_ref' : 'not_clickable',
      confidence: 0.82,
      reason: 'search_surface_filter_state_postcondition_projection',
      state: 'selected',
    } as ReadPageRegion['objects'][number]);
  }

  if (objects.length === 0) return null;
  return {
    regionId: 'search_filter_state_postcondition',
    regionType: 'filter_panel',
    state: 'active_filter_state_observed',
    confidence: 0.78,
    label: 'search filter state postcondition evidence',
    objects,
    candidateActionIds: [...new Set(candidateActionIds)].slice(0, 12),
    targetability: candidateActionIds.length > 0 ? 'target_ref' : 'not_clickable',
    claimBoundary:
      'native postcondition search-filter projection is visible filter-state evidence only; it does not include cookies, Authorization, secrets, or raw network bodies',
  };
}

function safeVisibleLabel(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  return normalized.slice(0, 80);
}

function stableLabelKey(value: string): string {
  const ascii = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (ascii) return ascii;
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash.toString(16);
}

export function readPageOperationMap(value: unknown): ReadPageOperationMap | null {
  const object = readObject(value);
  if (!object || !Array.isArray(object.zones)) return null;
  return object as unknown as ReadPageOperationMap;
}

export function isReadPageObjectLifecycleSummary(
  value: unknown,
): value is ReadPageObjectLifecycleSummary {
  const object = readObject(value);
  if (!object) return false;
  return (
    object.source === 'read_page_regions' &&
    (object.status === 'single_snapshot' || object.status === 'compared_snapshot') &&
    Number.isFinite(object.objectCount) &&
    Number.isFinite(object.changedObjectCount) &&
    Array.isArray(object.items) &&
    Array.isArray(object.changes) &&
    typeof object.claimBoundary === 'string'
  );
}
