import type {
  ReadPageCandidateAction,
  ReadPageExecutableAction,
  ReadPageInteractiveElement,
  ReadPageOperationMap,
  ReadPageOperationPurpose,
  ReadPageOperationReadiness,
  ReadPageOperationZone,
  ReadPageRegion,
  ReadPageRegionObject,
} from '@tabrix/shared';

export function buildPageOperationMap(
  pageRegions: ReadPageRegion[],
  params: {
    candidateActions?: readonly ReadPageCandidateAction[];
    interactiveElements?: readonly ReadPageInteractiveElement[];
  } = {},
): ReadPageOperationMap {
  const candidateActionById = new Map<string, ReadPageCandidateAction>(
    (params.candidateActions ?? []).map((action) => [action.id, action]),
  );
  const zones = pageRegions.map((region) => {
    const purpose = operationPurposeForRegion(region, candidateActionById);
    return buildOperationZone(region, purpose, candidateActionById);
  });
  zones.push(...buildDerivedSearchEntryZones(pageRegions, params, candidateActionById));
  const readyCount = zones.filter((zone) => zone.readiness === 'ready').length;
  const candidateCount = zones.filter((zone) => isCandidateState(zone.state)).length;
  const purposeList = Array.from(new Set(zones.map((zone) => zone.purpose))).join(', ');
  return {
    summary:
      zones.length > 0
        ? `operation map has ${zones.length} zones; ready zones: ${readyCount}; candidate zones needing AI interpretation: ${candidateCount}; purposes: ${purposeList}`
        : 'operation map has no confident zones',
    zones,
    claimBoundary:
      'operation map is AI planning guidance only; ambiguous candidates may be interpreted by the AI assistant, but execution still requires candidateActions/targetRef and Tabrix post-action verification',
  };
}

function buildOperationZone(
  region: ReadPageRegion,
  purpose: ReadPageOperationPurpose,
  candidateActionById: ReadonlyMap<string, ReadPageCandidateAction>,
): ReadPageOperationZone {
  return {
    zoneId: `zone_${region.regionType}`,
    regionId: region.regionId,
    regionType: region.regionType,
    purpose,
    label: operationLabelForRegion(region, purpose),
    state: region.state,
    readiness: operationReadinessForRegion(region, purpose),
    ...(region.readiness ? { regionReadiness: region.readiness } : {}),
    ...(region.readinessBlockingReasons?.length
      ? { readinessBlockingReasons: region.readinessBlockingReasons }
      : {}),
    ...(region.nextRequiredTool ? { nextRequiredTool: region.nextRequiredTool } : {}),
    ...(region.nextRequiredSelector ? { nextRequiredSelector: region.nextRequiredSelector } : {}),
    ...(region.nextRequiredCheck ? { nextRequiredCheck: region.nextRequiredCheck } : {}),
    targetability: region.targetability,
    candidateActionIds: region.candidateActionIds,
    primaryAction: selectPrimaryActionForRegion(region, purpose, candidateActionById),
    evidenceLevel: operationEvidenceLevel(region),
    claimBoundary: operationClaimBoundaryForRegion(region, purpose),
  };
}

function buildDerivedSearchEntryZones(
  pageRegions: ReadPageRegion[],
  params: {
    candidateActions?: readonly ReadPageCandidateAction[];
    interactiveElements?: readonly ReadPageInteractiveElement[];
  },
  candidateActionById: ReadonlyMap<string, ReadPageCandidateAction>,
): ReadPageOperationZone[] {
  const zones: ReadPageOperationZone[] = [];
  const representedCandidateIds = new Set<string>(
    pageRegions
      .filter(
        (region) =>
          (region.regionType === 'form' || region.regionType === 'search_area') &&
          operationPurposeForRegion(region, candidateActionById) === 'search',
      )
      .flatMap((region) => region.candidateActionIds),
  );
  for (const region of pageRegions) {
    if (!['menu', 'navigation', 'unknown', 'account', 'content'].includes(region.regionType)) {
      continue;
    }
    const object = region.objects.find(isSearchEntryObject);
    if (!object?.primaryAction) continue;
    representedCandidateIds.add(object.primaryAction.candidateActionId);
    zones.push({
      zoneId: `zone_${region.regionType}_search_entry_${object.objectId}`,
      regionId: region.regionId,
      regionType: region.regionType,
      purpose: 'search',
      label: 'search entry trigger',
      state: 'search_entry_needs_expand_candidate',
      readiness: object.primaryAction.actionType === 'fill' ? 'ready' : 'needs_expand',
      targetability: object.targetability,
      candidateActionIds: object.primaryAction.candidateActionId
        ? [object.primaryAction.candidateActionId]
        : [],
      primaryAction: object.primaryAction,
      evidenceLevel: 'targetable_search_entry_signal_needs_post_action_read',
      claimBoundary:
        'zone is planning guidance, not execution authority; search entry trigger must be clicked and verified by a fresh post-action page read before treating a search input as available',
    });
  }
  const interactiveByRef = new Map<string, ReadPageInteractiveElement>();
  for (const element of params.interactiveElements ?? []) {
    if (element.ref) interactiveByRef.set(element.ref, element);
  }
  for (const action of params.candidateActions ?? []) {
    if (representedCandidateIds.has(action.id)) continue;
    const element = interactiveByRef.get(action.targetRef);
    if (!isSearchEntryAction(action, element)) continue;
    representedCandidateIds.add(action.id);
    zones.push({
      zoneId: `zone_search_entry_${action.id}`,
      regionId: `candidate_${action.targetRef}`,
      regionType: 'unknown',
      purpose: 'search',
      label: 'search entry trigger',
      state: 'search_entry_needs_expand_candidate',
      readiness: action.actionType === 'fill' ? 'ready' : 'needs_expand',
      targetability: action.locatorChain.length > 0 ? 'locator_chain' : 'target_ref',
      candidateActionIds: [action.id],
      primaryAction: projectCandidateActionToExecutableAction(action),
      evidenceLevel: 'targetable_search_entry_signal_needs_post_action_read',
      claimBoundary:
        'zone is planning guidance, not execution authority; search entry trigger is derived from candidateActions and must be verified by a fresh post-action page read before treating a search input as available',
    });
  }
  return zones;
}

function selectPrimaryActionForRegion(
  region: ReadPageRegion,
  purpose: ReadPageOperationPurpose,
  candidateActionById: ReadonlyMap<string, ReadPageCandidateAction>,
) {
  const actionableObjects = region.objects.filter((object) => object.primaryAction);
  if (purpose === 'prepare_publish') {
    const uploadCandidateAction = region.candidateActionIds
      .map((candidateActionId) => candidateActionById.get(candidateActionId))
      .find(
        (action): action is ReadPageCandidateAction =>
          action?.intent === 'publish.upload_media' &&
          (action.actionType === 'click' || action.actionType === 'fill'),
      );
    if (uploadCandidateAction)
      return projectCandidateActionToExecutableAction(uploadCandidateAction);
    return (
      actionableObjects.find(
        (object) =>
          object.primaryAction?.toolArgs.candidateAction?.intent === 'publish.upload_media',
      )?.primaryAction ?? actionableObjects[0]?.primaryAction
    );
  }
  if (region.regionType === 'menu') {
    return (
      actionableObjects.find(
        (object) =>
          object.menuItemRole &&
          object.menuItemRole !== 'overflow_menu_trigger' &&
          object.menuItemRole !== 'unknown',
      )?.primaryAction ??
      actionableObjects.find((object) => object.menuItemRole !== 'overflow_menu_trigger')
        ?.primaryAction ??
      actionableObjects[0]?.primaryAction
    );
  }
  return actionableObjects[0]?.primaryAction;
}

function isSearchEntryObject(object: ReadPageRegionObject): boolean {
  const action = object.primaryAction;
  if (!action) return false;
  const text = [
    object.label,
    object.role,
    object.reason,
    object.menuItemRole,
    action.actionType,
    action.toolName,
    action.toolArgs?.candidateAction?.matchReason,
    ...(action.locatorChain ?? []).map((locator) => locator.value),
  ]
    .filter(Boolean)
    .join(' ');
  if (!/\b(search|find|query)\b|搜索|查找/i.test(text)) return false;
  return !/\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|password|credential)\b|登录|登陆|授权|验证|密码|账号/i.test(
    text,
  );
}

function isSearchEntryAction(
  action: ReadPageCandidateAction,
  element: ReadPageInteractiveElement | undefined,
): boolean {
  if (action.actionType !== 'click' && action.actionType !== 'fill') return false;
  const text = [
    element?.role,
    element?.name,
    element?.href,
    action.actionType,
    action.matchReason,
    ...action.locatorChain.map((locator) => locator.value),
  ]
    .filter(Boolean)
    .join(' ');
  if (!/\b(search|find|query)\b|搜索|查找/i.test(text)) return false;
  return !/\b(log[ -]?in|sign[ -]?in|signin|auth|authorize|password|credential)\b|登录|登陆|授权|验证|密码|账号/i.test(
    text,
  );
}

export function projectCandidateActionToExecutableAction(
  action: ReadPageCandidateAction,
): ReadPageExecutableAction {
  return {
    candidateActionId: action.id,
    actionType: action.actionType,
    targetRef: action.targetRef,
    locatorChain: action.locatorChain,
    toolName: action.actionType === 'fill' ? 'chrome_fill_or_select' : 'chrome_click_element',
    toolArgs: {
      candidateAction: {
        id: action.id,
        actionType: action.actionType,
        targetRef: action.targetRef,
        ...(action.label ? { label: action.label } : {}),
        ...(typeof action.frameId === 'number' ? { frameId: action.frameId } : {}),
        confidence: action.confidence,
        matchReason: action.matchReason,
        ...(action.actionability ? { actionability: action.actionability } : {}),
        ...(action.actionabilityReason ? { actionabilityReason: action.actionabilityReason } : {}),
        ...(action.intentBoundary ? { intentBoundary: action.intentBoundary } : {}),
        ...(action.nextRequiredTool ? { nextRequiredTool: action.nextRequiredTool } : {}),
        ...(action.nextRequiredSelector
          ? { nextRequiredSelector: action.nextRequiredSelector }
          : {}),
        ...(action.nextRequiredSelectorSource
          ? { nextRequiredSelectorSource: action.nextRequiredSelectorSource }
          : {}),
        ...(action.nextRequiredCheck ? { nextRequiredCheck: action.nextRequiredCheck } : {}),
        ...(action.snapshotRect ? { snapshotRect: action.snapshotRect } : {}),
        locatorChain: action.locatorChain,
        ...(action.intent ? { intent: action.intent } : {}),
        ...(action.visibility ? { visibility: action.visibility } : {}),
      },
    },
    claimBoundary:
      'primaryAction is an execution hint only; success still requires Tabrix tool result and post-action verification',
  };
}

function operationPurposeForRegion(
  region: ReadPageRegion,
  candidateActionById: ReadonlyMap<string, ReadPageCandidateAction>,
): ReadPageOperationPurpose {
  switch (region.regionType) {
    case 'navigation':
      return 'navigate';
    case 'search_area':
      return 'search';
    case 'filter_panel':
      return 'filter_results';
    case 'result_list':
    case 'detail_area':
      return 'read_content';
    case 'content':
      return 'read_content';
    case 'account':
      if (region.state === 'account_menu_trigger_candidate') return 'open_menu';
      return region.state === 'logged_out_candidate' ? 'auth' : 'account';
    case 'menu':
      return 'open_menu';
    case 'modal':
      return 'auth';
    case 'qr_code':
      return 'scan_qr';
    case 'form':
      if (hasPublishPreparationOnlyIntent(region, candidateActionById)) return 'prepare_publish';
      return /search|query|搜索/i.test(`${region.label ?? ''} ${region.state}`)
        ? 'search'
        : 'submit_form';
    case 'feedback':
      return 'observe_feedback';
    case 'unknown':
      if (isExploratoryActionRegion(region)) return 'open_menu';
      return 'unknown';
  }
}

function operationReadinessForRegion(
  region: ReadPageRegion,
  purpose: ReadPageOperationPurpose,
): ReadPageOperationReadiness {
  if (region.state === 'error_candidate') return 'blocked';
  if (region.state === 'profile_route_candidate') return 'unknown';
  if (
    region.readiness === 'not_ready_candidate' ||
    region.state === 'publish_not_ready_candidate'
  ) {
    return 'needs_expand';
  }
  if (purpose === 'scan_qr' && region.state === 'expired_or_refresh_available_candidate') {
    return region.candidateActionIds.length > 0 ? 'blocked' : 'not_targetable';
  }
  if (purpose === 'read_content' || purpose === 'observe_feedback') return 'ready';
  if (purpose === 'open_menu' && region.regionType === 'account') return 'needs_expand';
  if (purpose === 'open_menu' && region.regionType === 'unknown') return 'needs_expand';
  if (
    region.candidateActionIds.length > 0 &&
    (region.targetability === 'target_ref' || region.targetability === 'locator_chain')
  ) {
    return 'ready';
  }
  if (region.regionType === 'menu' && /collapsed|expandable|unknown/i.test(region.state)) {
    return 'needs_expand';
  }
  if (region.targetability === 'not_clickable') return 'not_targetable';
  return 'unknown';
}

function operationEvidenceLevel(region: ReadPageRegion): string {
  if (
    region.candidateActionIds.length > 0 &&
    (region.targetability === 'target_ref' || region.targetability === 'locator_chain')
  ) {
    if (isExploratoryActionRegion(region)) return 'targetable_exploratory_control';
    if (region.state === 'profile_route_candidate') return 'targetable_account_route_signal';
    if (isCandidateState(region.state))
      return 'targetable_candidate_region_signal_needs_verification';
    return 'targetable_region_signal';
  }
  if (region.objects.every((object) => object.reason.startsWith('visible_text_'))) {
    if (isCandidateState(region.state)) return 'candidate_text_signal_needs_verification';
    return 'bounded_text_signal';
  }
  if (isCandidateState(region.state)) return 'candidate_region_signal_needs_verification';
  if (region.objects.length > 0) return 'region_signal';
  return 'unknown';
}

function operationLabelForRegion(
  region: ReadPageRegion,
  purpose: ReadPageOperationPurpose,
): string {
  switch (purpose) {
    case 'navigate':
      return region.state === 'global_menu_available_candidate'
        ? 'global navigation menu'
        : 'navigation entries';
    case 'search':
      return 'search area';
    case 'filter_results':
      return 'filter panel';
    case 'read_content':
      return 'content area';
    case 'open_menu':
      if (region.regionType === 'account') return 'account menu trigger candidate';
      if (region.regionType === 'unknown') return 'unlabeled action/menu candidate';
      return region.state === 'action_available_candidate'
        ? 'menu actions candidate'
        : 'menu trigger candidate';
    case 'account':
      return 'account area candidate';
    case 'auth':
      return region.regionType === 'account'
        ? 'login/account area candidate'
        : 'auth area candidate';
    case 'scan_qr':
      return region.state === 'expired_or_refresh_available_candidate'
        ? 'QR refresh required candidate'
        : 'QR scan area candidate';
    case 'prepare_publish':
      return 'publish preparation area';
    case 'submit_form':
      return 'form action area';
    case 'observe_feedback':
      return 'feedback/status area';
    case 'unknown':
      return 'unknown operation area';
  }
}

function operationClaimBoundaryForRegion(
  region: ReadPageRegion,
  purpose: ReadPageOperationPurpose,
): string {
  const base = 'zone is planning guidance, not execution authority';
  if (purpose === 'account' || purpose === 'auth') {
    if (region.state === 'profile_route_candidate') {
      return `${base}; this looks like an account/profile route, not proof of a menu, login, or logout state change`;
    }
    return `${base}; raw account identity is intentionally not exposed; auth success requires post-action state evidence`;
  }
  if (purpose === 'scan_qr') {
    if (region.state === 'expired_or_refresh_available_candidate') {
      return `${base}; QR appears expired or refresh-needed, so scanning is blocked until a fresh QR is produced; this is not login success`;
    }
    return `${base}; QR presence means scan collaboration may be needed, not login success`;
  }
  if (purpose === 'filter_results') {
    return `${base}; filter controls can narrow or reorder results, but selected filter success requires a fresh post-action page read`;
  }
  if (purpose === 'prepare_publish') {
    return `${base}; publish preparation/upload controls are visible, but final publish submission is not proven available`;
  }
  if (purpose === 'navigate' && region.state === 'global_menu_available_candidate') {
    return `${base}; menu map shows visible navigation entries but not selected-page success or expanded submenu state`;
  }
  if (purpose === 'open_menu') {
    if (region.regionType === 'account') {
      return `${base}; account menu expansion must be verified by a fresh post-action page read`;
    }
    if (region.regionType === 'unknown') {
      return `${base}; targetable unlabeled controls may need exploration but are not proven menu, account, or logout actions`;
    }
    return `${base}; menu action availability must be verified after expand/click`;
  }
  if (region.targetability === 'not_clickable') {
    return `${base}; region is not currently targetable`;
  }
  return base;
}

function hasPublishPreparationOnlyIntent(
  region: ReadPageRegion,
  candidateActionById: ReadonlyMap<string, ReadPageCandidateAction>,
): boolean {
  const intents = [
    ...region.objects.map((object) => object.primaryAction?.toolArgs?.candidateAction?.intent),
    ...region.candidateActionIds.map(
      (candidateActionId) => candidateActionById.get(candidateActionId)?.intent,
    ),
  ].filter((intent): intent is string => typeof intent === 'string' && intent.length > 0);
  if (intents.length === 0) return false;
  if (intents.some((intent) => intent === 'publish.submit')) return false;
  return intents.some(
    (intent) =>
      intent === 'publish.open_entry' ||
      intent === 'publish.select_media_type' ||
      intent === 'publish.upload_media',
  );
}

function isExploratoryActionRegion(region: ReadPageRegion): boolean {
  return (
    region.regionType === 'unknown' &&
    region.candidateActionIds.length > 0 &&
    (region.objects.some((object) => object.reason === 'targetable_unclassified_action_control') ||
      (region.targetability === 'target_ref' &&
        region.objects.some((object) => object.actionTypes.includes('click'))))
  );
}

function isCandidateState(state: string): boolean {
  return /candidate/i.test(state);
}
