/**
 * Read-page execution representation contract.
 *
 * T3.2 goal:
 * - lock a small stable layer for downstream tools
 * - keep candidate/action/memory-related fields as evolvable extensions
 */

export type ReadPageMode = 'compact' | 'normal' | 'full';

export const READ_PAGE_OBSERVATION_PROFILE_VALUES = [
  'compact',
  'task',
  'delta',
  'full',
  'debug',
] as const;

export type ReadPageObservationProfile = (typeof READ_PAGE_OBSERVATION_PROFILE_VALUES)[number];

export const READ_PAGE_COVERAGE_STATUS_VALUES = [
  'covered',
  'degraded',
  'unsupported',
  'visible_unresolved',
] as const;

export type ReadPageCoverageStatus = (typeof READ_PAGE_COVERAGE_STATUS_VALUES)[number];

export const READ_PAGE_EVIDENCE_SOURCE_VALUES = [
  'dom',
  'ax',
  'visible_text',
  'network',
  'api',
  'cdp',
  'watch_delta',
  'screenshot_fallback',
  'experience',
] as const;

export type ReadPageEvidenceSource = (typeof READ_PAGE_EVIDENCE_SOURCE_VALUES)[number];

export interface ReadPageObservationCoverage {
  overall: ReadPageCoverageStatus;
  iframe: ReadPageCoverageStatus;
  shadowDom: ReadPageCoverageStatus;
  virtualList: ReadPageCoverageStatus;
  dynamicPanel: ReadPageCoverageStatus;
  unresolvedVisibleTextCount?: number;
  capabilityGaps?: string[];
  claimBoundary: string;
}

/**
 * Render mode for `read_page`.
 *
 * `'json'` (default) is the existing behavior: a structured DOM-semantic
 * snapshot whose HVOs / candidateActions / `targetRef` are the execution
 * truth (see `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §4.1).
 *
 * `'markdown'` adds a low-token Markdown projection of the same snapshot
 * for text-heavy reading. The Markdown projection is a READING surface,
 * NOT an execution surface (§4.3): the JSON HVOs / candidateActions /
 * `targetRef` are still emitted unchanged so click resolution stays
 * deterministic. `L2` source routing (`markdownRef`) lets upstream
 * planners pick the right detail source instead of dumping both.
 */
export type ReadPageRenderMode = 'json' | 'markdown';

export type ReadPagePageType =
  | 'web_page'
  | 'extension_page'
  | 'browser_internal_page'
  | 'devtools_page'
  | 'unsupported_page';

export type ReadPageQuality = 'usable' | 'sparse' | string;

export type ReadPagePrimaryRegionConfidence = 'low' | 'medium' | 'high' | null;

export interface ReadPagePage {
  url: string;
  title: string;
  pageType: ReadPagePageType;
}

export interface ReadPageSummary {
  pageRole: string;
  primaryRegion: string | null;
  quality: ReadPageQuality;
}

export interface ReadPageInteractiveElement {
  ref: string;
  role: string;
  name: string;
  /**
   * Optional privacy-safe form value state. This deliberately never carries
   * the raw input value; it only lets BrowserPageObject detect empty/non-empty
   * form/search state changes across read_page snapshots.
   */
  valueState?: 'empty' | 'non_empty' | 'unknown';
  checked?: boolean | 'mixed' | 'unknown';
  /**
   * Optional raw `href` captured from the DOM snapshot. Present only for
   * link-like elements. Consumers MUST treat this as optional; older
   * snapshots do not emit it.
   *
   * Added in T5.4.5 to let downstream pickers disambiguate between
   * same-label links that point to different URLs (e.g. a workflow file
   * vs a workflow run on GitHub `/actions`).
   */
  href?: string;
  /**
   * Optional snapshot-local CSS selector for fallback-discovered elements.
   * This is additive and advisory: callers should prefer stable refs when
   * available, and must treat selectors as current-snapshot only.
   */
  selector?: string;
  /**
   * Optional evidence about why a text lookup matched this element. This lets
   * callers distinguish a real action button from an input whose placeholder
   * happens to contain action words such as "get code".
   */
  matchSource?:
    | 'visible_text'
    | 'aria'
    | 'label'
    | 'placeholder'
    | 'value'
    | 'title'
    | 'fallback'
    | string;
  actionability?: 'actionable' | 'not_actionable' | 'blocked' | 'unknown' | string;
  /**
   * Optional viewport rectangle captured from the current DOM snapshot.
   * Consumers MUST treat this as advisory and snapshot-local. It exists so
   * AI-facing planning can distinguish common app-shell menu locations such
   * as left sidebars, top navigation, bottom navigation, and top-right
   * account menus without falling back to screenshots or coordinates.
   */
  rect?: ReadPageElementRect;
}

export interface ReadPageElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ReadPageArtifactRef {
  kind: 'dom_snapshot' | string;
  ref: string;
  localPath?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  producedAtMs?: number;
  expiresAtMs?: number;
  method?: string;
  sourceRegionId?: string;
  sourceObjectId?: string;
  failureReason?: string;
  claimBoundary?: string;
}

export const READ_PAGE_AUTH_ARTIFACT_STATUS_VALUES = [
  'not_requested',
  'not_applicable',
  'blocked',
  'ready',
  'failed',
] as const;

export type ReadPageAuthArtifactStatusValue =
  (typeof READ_PAGE_AUTH_ARTIFACT_STATUS_VALUES)[number];

export interface ReadPageAuthArtifactStatus {
  requested: boolean;
  status: ReadPageAuthArtifactStatusValue;
  reason: string;
  artifactRef?: string;
  ownerType?: import('./browser-task-thing-contract').BrowserPageOwnerType | string | null;
  failureReason?: string;
  claimBoundary: string;
}

export const READ_PAGE_AUTH_COLLABORATION_STATUS_VALUES = [
  'not_required',
  'required',
  'waiting_for_user',
  'succeeded_candidate',
  'not_proven',
] as const;

export type ReadPageAuthCollaborationStatus =
  (typeof READ_PAGE_AUTH_COLLABORATION_STATUS_VALUES)[number];

export const READ_PAGE_AUTH_CHALLENGE_TYPES = [
  'qr',
  'otp',
  'password_form',
  'captcha',
  'sso_external',
  'unknown',
] as const;

export type ReadPageAuthChallengeType = (typeof READ_PAGE_AUTH_CHALLENGE_TYPES)[number];

export const READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES = [
  'auth',
  'search',
  'extract_content',
  'unknown',
] as const;

export type ReadPageAssistantGuidanceTaskKind =
  (typeof READ_PAGE_ASSISTANT_GUIDANCE_TASK_KIND_VALUES)[number];

export const READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES = [
  'qr',
  'otp',
  'manual',
  'auto',
] as const;

export type ReadPageAssistantGuidanceAuthPreference =
  (typeof READ_PAGE_ASSISTANT_GUIDANCE_AUTH_PREFERENCE_VALUES)[number];

export const READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES = [
  'auth_surface',
  'qr_image',
  'phone_input',
  'otp_input',
  'search_input',
  'result_cards',
  'detail_metrics',
] as const;

export type ReadPageAssistantGuidanceRequestedObject =
  (typeof READ_PAGE_ASSISTANT_GUIDANCE_REQUESTED_OBJECT_VALUES)[number];

export interface ReadPageAssistantProvidedTarget {
  purpose?: 'auth_qr_image' | 'click' | 'fill' | 'observe' | string;
  targetRef?: string;
  selector?: string;
  frameId?: number;
  reason?: string;
}

export interface ReadPageAssistantGuidance {
  /**
   * AI-provided observation guidance. This is only a filter/priority hint for
   * Tabrix-as-eyes, not Tabrix-side task planning or business-success proof.
   */
  taskKind?: ReadPageAssistantGuidanceTaskKind;
  authPreference?: ReadPageAssistantGuidanceAuthPreference;
  requestedObjects?: ReadPageAssistantGuidanceRequestedObject[];
  assistantProvidedTarget?: ReadPageAssistantProvidedTarget;
  claimBoundary?: string;
}

export interface ReadPageSearchSurfaceControl {
  kind:
    | 'search_input'
    | 'filter_trigger'
    | 'sort_most_collected'
    | 'submit_search'
    | 'category_tab'
    | 'unknown'
    | string;
  targetRef?: string;
  candidateActionId?: string;
  label?: string;
  confidence: number;
  actionability?: string;
  source?: 'interactive_elements' | 'text_recovery' | 'visible_text_unresolved' | string;
  rect?: ReadPageElementRect;
  state?: {
    selected?: boolean;
    expanded?: boolean;
    current?: boolean;
    ambiguous?: boolean;
    reason?: string;
  };
  reason: string;
}

export interface ReadPageSearchResultCard {
  id: string;
  title: string;
  targetRef?: string;
  candidateActionId?: string;
  primaryText?: string;
  secondaryText?: string;
  metaText?: string;
  interactionText?: string;
  metricText?: string;
  collectionCountCandidate?: number;
  confidence: number;
  reason: string;
}

export interface ReadPageSearchSurface {
  status: 'not_detected' | 'detected' | 'ambiguous';
  queryState?: 'unknown' | 'empty' | 'non_empty';
  controls: ReadPageSearchSurfaceControl[];
  categoryTabs?: ReadPageSearchSurfaceControl[];
  categoryState?: {
    selectedLabels: string[];
    ambiguousLabels: string[];
    unresolvedLabels: string[];
    reason: string;
  };
  visibleButUnresolved?: ReadPageSearchSurfaceControl[];
  resultCards: ReadPageSearchResultCard[];
  filterPanel?: {
    status: 'open_candidate' | 'closed_or_not_observed' | 'ambiguous' | string;
    optionLabels: string[];
    targetableOptions?: ReadPageSearchSurfaceControl[];
    appliedFilterLabels: string[];
    clearActionObserved: boolean;
    confirmActionObserved: boolean;
    reason: string;
  };
  sortEvidence?: {
    requestedSort?: 'most_collected' | 'sort_menu' | 'unknown' | string;
    currentSortLabel?: string;
    menuOpenCandidate?: boolean;
    optionLabels?: string[];
    appliedCandidate: boolean;
    reason: string;
  };
  topNCompleteness?: {
    requestedMinResults?: number;
    observedResultCount: number;
    status: 'not_requested' | 'sufficient' | 'insufficient' | 'not_proven' | string;
    reason: string;
  };
  resultCoverage?: {
    observedResultCount: number;
    visibleRowsUsed: boolean;
    pixelsBelow?: number | null;
    loadMoreCandidateObserved: boolean;
    virtualizedListCandidate: boolean;
    status: 'complete_enough' | 'scroll_or_load_more_required' | 'not_proven' | string;
    reason: string;
  };
  observationCoverage?: {
    frameCoverage: 'responding_frame_only' | 'not_available' | string;
    iframeCoverage: 'explicit_frame_read' | 'not_proven' | string;
    shadowDomCoverage: 'not_inspected' | 'not_proven' | string;
    capabilityGaps: string[];
    reason: string;
  };
  claimBoundary: string;
}

export interface ReadPageObservedAuthSurfaceCandidate {
  kind:
    | 'auth_surface'
    | 'qr_image'
    | 'phone_input'
    | 'otp_input'
    | 'request_otp'
    | 'refresh_qr'
    | 'submit'
    | 'unknown'
    | string;
  targetRef?: string;
  selector?: string;
  candidateActionId?: string;
  confidence: number;
  actionability?: string;
  reason: string;
}

export interface ReadPageObservedAuthSurface {
  status: 'not_detected' | 'detected' | 'ambiguous';
  surfaceRef?: string;
  surfaceRole?: 'auth_surface' | 'modal' | 'form' | 'unknown' | string;
  preferredChallengeType?: ReadPageAuthChallengeType;
  alternativeChallengeTypes?: ReadPageAuthChallengeType[];
  candidateObjectRefs: ReadPageObservedAuthSurfaceCandidate[];
  guidanceApplied: boolean;
  claimBoundary: string;
}

export interface ReadPageAssistantHandoff {
  status: 'not_needed' | 'needed';
  reason?:
    | 'qr_target_ambiguous'
    | 'auth_surface_ambiguous'
    | 'target_not_found'
    | 'protected_tab'
    | 'not_proven'
    | string;
  requestedAssistantAction?:
    | 'choose_auth_qr_target'
    | 'choose_click_target'
    | 'provide_selector_or_target_ref'
    | 'manual_user_action'
    | string;
  candidateRefs?: string[];
  surfaceRef?: string;
  claimBoundary: string;
}

export interface ReadPageAuthCollaborationUserAction {
  required: boolean;
  instruction: string;
  artifactRef?: string;
  expiresAtMs?: number;
  retryRecommendation?: string;
}

export interface ReadPageAuthResumeVerification {
  status:
    | 'not_required'
    | 'required_after_user_action'
    | 'fresh_read_required'
    | 'postcondition_required'
    | 'not_proven';
  nextTool: 'chrome_read_page';
  forceRefreshRequired: boolean;
  sameTabRequired: boolean;
  targetTabId?: number;
  postconditionRequired: boolean;
  requiredSignals: string[];
  claimBoundary: string;
}

export interface ReadPageAuthCollaborationEvidence {
  pageFreshness: 'single_snapshot' | 'compared_snapshot' | 'unknown';
  tabId?: number;
  ownerType?: import('./browser-task-thing-contract').BrowserPageOwnerType | string | null;
  canTabrixOperate?: boolean | null;
  operationBinding: 'ai_operable_tab' | 'protected_or_unknown_tab';
  artifactExtractionEligibility?: 'eligible' | 'blocked' | 'unknown';
  actionOperability?: 'operable' | 'protected_or_unknown' | 'unknown' | 'not_proven';
  artifactStatus?: ReadPageAuthArtifactStatusValue;
  semanticEventTypes: ReadPageBrowserPageSemanticEventType[];
  postconditionStatus: 'candidate_only' | 'not_evaluated' | 'not_proven';
  resumeVerification?: ReadPageAuthResumeVerification;
  claimBoundary: string;
}

export const READ_PAGE_AUTH_FORM_READINESS_VALUES = [
  'not_detected',
  'blocked_by_agreement',
  'ready_to_request_otp',
  'otp_requested',
  'waiting_for_user_otp',
  'login_succeeded_candidate',
  'not_proven',
] as const;

export type ReadPageAuthFormReadiness = (typeof READ_PAGE_AUTH_FORM_READINESS_VALUES)[number];

export const READ_PAGE_AUTH_FORM_NEXT_ACTION_VALUES = [
  'fill_phone',
  'accept_terms',
  'confirm_agreement',
  'request_otp',
  'wait_for_user_otp',
  'verify_login',
  'manual_user_action',
  'not_proven',
] as const;

export type ReadPageAuthFormNextAction = (typeof READ_PAGE_AUTH_FORM_NEXT_ACTION_VALUES)[number];

export type ReadPageAuthFormControlKey =
  | 'phoneInput'
  | 'otpInput'
  | 'requestOtp'
  | 'agreementCheckbox'
  | 'agreementConfirm'
  | 'submit';

export interface ReadPageAuthFormControl {
  role: string;
  label: string;
  targetRef?: string;
  locatorChain?: ReadPageCandidateActionLocator[];
  candidateActionId?: string;
  confidence: number;
  reason: string;
  state:
    | 'empty'
    | 'non_empty'
    | 'checked'
    | 'unchecked'
    | 'countdown'
    | 'sent_candidate'
    | 'visible'
    | 'not_actionable'
    | 'unknown'
    | string;
  valueState?: 'empty' | 'non_empty' | 'unknown';
  matchSource?: string;
  actionability: 'actionable' | 'not_actionable' | 'blocked' | 'unknown' | string;
}

export interface ReadPageAuthFormBlocker {
  kind:
    | 'agreement_required'
    | 'agreement_modal'
    | 'missing_phone'
    | 'target_not_actionable'
    | 'protected_tab'
    | 'unknown'
    | string;
  message: string;
  control?: ReadPageAuthFormControlKey;
}

export interface ReadPageAuthForm {
  formType: 'otp' | 'unknown';
  readiness: ReadPageAuthFormReadiness;
  nextAction: ReadPageAuthFormNextAction;
  controls: Partial<Record<ReadPageAuthFormControlKey, ReadPageAuthFormControl>>;
  blockers: ReadPageAuthFormBlocker[];
  claimBoundary: string;
}

export interface ReadPageAuthCollaboration {
  status: ReadPageAuthCollaborationStatus;
  challengeType: ReadPageAuthChallengeType;
  preferredChallengeType?: ReadPageAuthChallengeType;
  alternativeChallengeTypes?: ReadPageAuthChallengeType[];
  userAction: ReadPageAuthCollaborationUserAction;
  evidence: ReadPageAuthCollaborationEvidence;
  authForm?: ReadPageAuthForm;
  observedAuthSurface?: ReadPageObservedAuthSurface;
  assistantHandoff?: ReadPageAssistantHandoff;
  claimBoundary: string;
}

export interface ReadPageCandidateActionLocator {
  type: 'ref' | 'aria' | 'css' | string;
  value: string;
}

export type ReadPageCandidateActionIntent =
  | 'auth.accept_terms'
  | 'auth.confirm_agreement'
  | 'auth.request_otp'
  | 'auth.submit_login'
  | 'search.enter_query'
  | 'search.submit'
  | 'search.category_select'
  | 'content.open_detail'
  | 'publish.open_entry'
  | 'publish.select_media_type'
  | 'publish.upload_media'
  | 'publish.submit'
  | (string & {});

export interface ReadPageCandidateAction {
  id: string;
  actionType: 'click' | 'fill' | string;
  targetRef: string;
  /**
   * Optional AI-facing action label copied from the source interactive element
   * after redaction. This is planning/evidence text only; execution still uses
   * targetRef / locatorChain.
   */
  label?: string;
  /**
   * Optional Chrome frame id for frame-targeted execution.
   *
   * Present only when the source snapshot/action is known to belong to a
   * specific frame. Callers should pass this through to click/fill tools; when
   * omitted, execution remains tab-main-frame/default-frame scoped.
   */
  frameId?: number;
  confidence: number;
  matchReason: string;
  /**
   * Optional source-element actionability copied from the current structured
   * snapshot. This is browser-action readiness only; it does not prove that a
   * business workflow such as publishing, login, checkout, or form submission
   * has enough completed fields to succeed.
   */
  actionability?: 'actionable' | 'not_actionable' | 'blocked' | 'unknown' | string;
  /**
   * Short AI-facing explanation for the actionability/intent boundary. It is
   * intentionally generic and must not carry raw private form values.
   */
  actionabilityReason?: string;
  /**
   * Optional boundary for high-level intent labels, especially where a visible
   * label may be an entry/navigation affordance rather than final business
   * success.
   */
  intentBoundary?: string;
  /**
   * Optional AI-facing follow-up tool hint for actions that are only workflow
   * entry points. This is planning/evidence text only; it does not grant a new
   * MCP capability or prove business success.
   */
  nextRequiredTool?: string;
  /**
   * Optional selector for the next required tool when the current candidate is
   * only a visible workflow affordance. For example, a visible upload button can
   * point at the snapshot-local file input selector that chrome_upload_file
   * should use next. This is a tool-argument hint only; it does not prove that
   * the follow-up tool is authorized or that the business workflow succeeded.
   */
  nextRequiredSelector?: string;
  /**
   * Optional provenance for nextRequiredSelector. Consumers must treat it as
   * snapshot-local evidence and re-read after actions.
   */
  nextRequiredSelectorSource?: string;
  /**
   * Optional AI-facing verification boundary for the next step after this
   * action candidate. Must stay privacy-safe and must not include raw form
   * values or account data.
   */
  nextRequiredCheck?: string;
  locatorChain: ReadPageCandidateActionLocator[];
  /**
   * Optional AI-facing action intent. It lets the executor choose the right
   * post-action verification path without adding another public MCP tool.
   */
  intent?: ReadPageCandidateActionIntent;
}

export interface ReadPageFileInputBinding {
  selector: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  visible?: boolean;
  bindingSource: 'dom_input_type_file' | string;
  nextRequiredTool: 'chrome_upload_file' | string;
  nextRequiredCheck: string;
  claimBoundary: string;
}

export type ReadPagePublishFormRequiredField =
  | 'media'
  | 'title'
  | 'body_or_description'
  | (string & {});

export type ReadPagePublishFormRequiredFieldStatus =
  | 'present_candidate'
  | 'not_proven'
  | 'not_observed'
  | 'unknown'
  | (string & {});

export interface ReadPagePublishFormRequiredFieldEvidence {
  field: ReadPagePublishFormRequiredField;
  status: ReadPagePublishFormRequiredFieldStatus;
  evidenceSource: 'dom' | 'candidate_action' | 'file_input_binding' | string;
  evidence: string;
  targetRef?: string;
  selector?: string;
  nextRequiredTool?: string;
  nextRequiredSelector?: string;
  nextRequiredCheck?: string;
}

export interface ReadPagePublishFormReadiness {
  status: 'not_ready_candidate' | 'ready_candidate' | 'unknown' | (string & {});
  businessSuccessProven: boolean;
  requiredFields: ReadPagePublishFormRequiredFieldEvidence[];
  blockingReasons: string[];
  nextRequiredTool?: string;
  nextRequiredSelector?: string;
  nextRequiredCheck: string;
  claimBoundary: string;
}

export interface ReadPageExecutableAction {
  candidateActionId: string;
  actionType: 'click' | 'fill' | string;
  targetRef: string;
  locatorChain: ReadPageCandidateActionLocator[];
  toolName: string;
  toolArgs: {
    candidateAction: ReadPageCandidateAction;
  };
  claimBoundary: string;
}

export interface ReadPagePageContext {
  filter: string;
  depth: number | null;
  focus: { refId: string; found: boolean } | null;
  scheme: string;
  viewport: { width: number | null; height: number | null; dpr: number | null };
  sparse: boolean;
  fallbackUsed: boolean;
  fallbackSource: string | null;
  refMapCount: number;
  markedElementsCount: number;
  /**
   * Optional runtime load-readiness evidence for this snapshot.
   *
   * This is intentionally about whether the browser document was stable
   * enough to trust the current object map. It is not task success proof and
   * must not be treated as login/search/form completion evidence.
   */
  loadReadiness?: ReadPageLoadReadiness;
}

export interface ReadPageLoadReadiness {
  status: 'stable' | 'settled_after_wait' | 'loading_after_wait' | 'stale' | 'unknown' | string;
  pageStability: 'stable' | 'loading' | 'changing' | 'stale' | 'unknown' | string;
  initialTabStatus: string | null;
  finalTabStatus: string | null;
  waitedForPendingDocument: boolean;
  settled: boolean | null;
  timedOut: boolean | null;
  settleReason: string | null;
  waitedMs: number | null;
  readyState: string | null;
  canUseSnapshotForBusinessAction: boolean;
  nextStepHint: string;
  claimBoundary: string;
  /**
   * Optional Chrome DevTools Protocol sensing summary.
   *
   * This is low-level browser evidence used to decide whether to wait,
   * refresh, or trust the current snapshot. It deliberately excludes raw URL
   * query/hash values, cookies, request/response bodies, and page text.
   */
  cdpSensing?: ReadPageCDPSensingSummary;
}

export interface ReadPageCDPSensingSummary {
  source: 'cdp_page_sensing';
  available: boolean;
  readiness: 'loading' | 'interactive' | 'complete' | 'unknown' | string;
  likelyLoading: boolean;
  visibilityState?: string;
  focused?: boolean;
  activeElement?: {
    tagName: string;
    type?: string;
    role?: string;
    idPresent: boolean;
    namePresent: boolean;
  };
  frameCount?: number;
  navigation?: {
    responseEndMs: number | null;
    domContentLoadedMs: number | null;
    loadEventMs: number | null;
  };
  claimBoundary: string;
}

export interface ReadPageFrameContext {
  frameId?: number;
  frameUrl?: string;
  frameName?: string;
  frameScope?: 'top' | 'subframe' | 'unknown';
  isTopFrame?: boolean | null;
  source?: 'content_script_runtime' | 'unsupported_page' | 'not_available';
  coverage?: 'responding_frame_only' | 'not_available';
  claimBoundary?: string;
}

export interface ReadPageMemoryHint {
  key: string;
  value: string;
  confidence?: number;
}

export type ReadPageTaskMode = 'search' | 'read' | 'compare' | 'extract' | 'monitor';

export type ReadPageComplexityLevel = 'simple' | 'medium' | 'complex';

export type ReadPageSourceKind = 'embedded_state' | 'page_api' | 'dom_semantic' | 'artifact';

export type ReadPageSelectedDataSource =
  | 'api_rows'
  | 'cdp_enhanced_api_rows'
  | 'dom_region_rows'
  | 'dom_json'
  | 'markdown'
  | string;

export type ReadPageReadinessVerdict = 'ready' | 'empty' | 'error' | 'blocked' | 'unknown' | string;

/**
 * T5.4 object-type enumeration. Source of truth: Feishu
 * `Tabrix T5.4 高价值对象提取 正式产品级规格 v2026.04.20.1`.
 *
 * These are *semantic* types (what the object IS in task terms), distinct
 * from the legacy `kind` field (where the object came FROM).
 */
export type ReadPageObjectType =
  | 'nav_entry'
  | 'record'
  | 'entry'
  | 'control'
  | 'status_item'
  | 'metric_card'
  | 'doc_block';

export interface ReadPageHighValueObjectAction {
  type: 'open_detail' | 'click' | 'fill' | 'navigate' | 'expand' | string;
  ref?: string;
  actionType?: string;
}

export const READ_PAGE_REGION_TYPES = [
  'navigation',
  'content',
  'account',
  'menu',
  'modal',
  'qr_code',
  'form',
  'feedback',
  'unknown',
] as const;

export type ReadPageRegionType = (typeof READ_PAGE_REGION_TYPES)[number];

export const READ_PAGE_REGION_TARGETABILITY_VALUES = [
  'target_ref',
  'locator_chain',
  'not_clickable',
  'unknown',
] as const;

export type ReadPageRegionTargetability = (typeof READ_PAGE_REGION_TARGETABILITY_VALUES)[number];

export const READ_PAGE_REGION_LAYOUT_HINTS = [
  'left_sidebar',
  'top_navigation',
  'right_sidebar',
  'bottom_navigation',
  'top_right',
  'inline',
  'unknown',
] as const;

export type ReadPageRegionLayoutHint = (typeof READ_PAGE_REGION_LAYOUT_HINTS)[number];

export const READ_PAGE_REGION_MENU_ITEM_ROLES = [
  'primary_navigation',
  'overflow_menu_trigger',
  'account_entry',
  'secondary_menu_action',
  'auth_entry',
  'content_action',
  'unknown',
] as const;

export type ReadPageRegionMenuItemRole = (typeof READ_PAGE_REGION_MENU_ITEM_ROLES)[number];

export interface ReadPageRegionObject {
  objectId: string;
  label: string;
  objectType?: ReadPageObjectType | string;
  role?: string;
  /**
   * Optional privacy-safe form value state. Never contains raw user input.
   */
  valueState?: 'empty' | 'non_empty' | 'unknown';
  targetRef?: string;
  /**
   * Optional non-action locator chain for region objects that are visible and
   * inspectable but not semantically clickable, such as QR image/canvas areas.
   * This is not an execution authority; callers still need a tool-specific
   * action and postcondition check.
   */
  locatorChain?: ReadPageCandidateActionLocator[];
  actionTypes: string[];
  targetability: ReadPageRegionTargetability;
  confidence: number;
  reason: string;
  primaryAction?: ReadPageExecutableAction;
  layoutHint?: ReadPageRegionLayoutHint;
  menuItemRole?: ReadPageRegionMenuItemRole;
}

export interface ReadPageRegion {
  regionId: string;
  regionType: ReadPageRegionType;
  state: string;
  confidence: number;
  label?: string;
  /**
   * Optional AI-facing readiness projection for the region. This is a
   * condensed view of already-emitted read_page evidence and is not execution
   * authority, business-success proof, or platform-rule proof.
   */
  readiness?: string;
  readinessBlockingReasons?: string[];
  nextRequiredTool?: string;
  nextRequiredSelector?: string;
  nextRequiredCheck?: string;
  objects: ReadPageRegionObject[];
  candidateActionIds: string[];
  targetability: ReadPageRegionTargetability;
  layoutHint?: ReadPageRegionLayoutHint;
  claimBoundary: string;
}

export const READ_PAGE_OPERATION_PURPOSES = [
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
] as const;

export type ReadPageOperationPurpose = (typeof READ_PAGE_OPERATION_PURPOSES)[number];

export const READ_PAGE_OPERATION_READINESS_VALUES = [
  'ready',
  'needs_expand',
  'blocked',
  'not_targetable',
  'unknown',
] as const;

export type ReadPageOperationReadiness = (typeof READ_PAGE_OPERATION_READINESS_VALUES)[number];

export interface ReadPageOperationZone {
  zoneId: string;
  regionId: string;
  regionType: ReadPageRegionType;
  purpose: ReadPageOperationPurpose;
  label: string;
  state: string;
  readiness: ReadPageOperationReadiness;
  /**
   * Optional region/business readiness details carried from pageRegions.
   * This is intentionally separate from the operation readiness enum:
   * a zone can expose a targetable next action while the business form is
   * still not ready.
   */
  regionReadiness?: string;
  readinessBlockingReasons?: string[];
  nextRequiredTool?: string;
  nextRequiredSelector?: string;
  nextRequiredCheck?: string;
  targetability: ReadPageRegionTargetability;
  candidateActionIds: string[];
  primaryAction?: ReadPageExecutableAction;
  evidenceLevel: string;
  claimBoundary: string;
}

export interface ReadPageOperationMap {
  summary: string;
  zones: ReadPageOperationZone[];
  claimBoundary: string;
}

export const READ_PAGE_OBJECT_LIFECYCLE_FAMILIES = [
  'auth_surface',
  'qr_code',
  'account_identity',
  'menu_surface',
  'menu_item',
  'form_control',
  'feedback_surface',
  'content_collection',
  'unknown',
] as const;

export type ReadPageObjectLifecycleFamily = (typeof READ_PAGE_OBJECT_LIFECYCLE_FAMILIES)[number];

export const READ_PAGE_OBJECT_LIFECYCLE_CHANGE_KINDS = [
  'appeared',
  'disappeared',
  'changed',
  'unchanged',
  'unknown',
] as const;

export type ReadPageObjectLifecycleChangeKind =
  (typeof READ_PAGE_OBJECT_LIFECYCLE_CHANGE_KINDS)[number];

export interface ReadPageObjectLifecycleItem {
  objectKey: string;
  regionId: string;
  regionType: ReadPageRegionType;
  objectId?: string;
  objectFamily: ReadPageObjectLifecycleFamily;
  objectType?: string;
  state: string;
  targetability: ReadPageRegionTargetability;
  actionTypes: string[];
  candidateActionIds: string[];
  evidenceRefs: string[];
  confidence: number;
  claimBoundary: string;
}

export interface ReadPageObjectLifecycleChange {
  objectKey: string;
  objectFamily: ReadPageObjectLifecycleFamily;
  regionType: ReadPageRegionType;
  beforeState?: string;
  afterState?: string;
  changeKind: ReadPageObjectLifecycleChangeKind;
  claimBoundary: string;
}

export interface ReadPageObjectLifecycleSummary {
  source: 'read_page_regions';
  status: 'single_snapshot' | 'compared_snapshot';
  objectCount: number;
  changedObjectCount: number;
  items: ReadPageObjectLifecycleItem[];
  changes: ReadPageObjectLifecycleChange[];
  claimBoundary: string;
}

export const READ_PAGE_BROWSER_PAGE_OBJECT_ATTRIBUTE_GROUPS = [
  'identity',
  'window_state',
  'tab_state',
  'page_state',
  'visual_reliability',
  'runtime_state',
  'layout_regions',
  'menu_state',
  'auth_state',
  'qr_state',
  'content_state',
  'action_state',
  'evidence_state',
  'task_relation',
] as const;

export type ReadPageBrowserPageObjectAttributeGroup =
  (typeof READ_PAGE_BROWSER_PAGE_OBJECT_ATTRIBUTE_GROUPS)[number];

export const READ_PAGE_BROWSER_PAGE_SEMANTIC_EVENT_TYPES = [
  'menu_expanded',
  'qr_waiting',
  'qr_expired_candidate',
  'qr_refreshed',
  'auth_required_candidate',
  'auth_succeeded_candidate',
  'logout_succeeded_candidate',
  'content_changed',
  'unknown_or_noise',
] as const;

export type ReadPageBrowserPageSemanticEventType =
  (typeof READ_PAGE_BROWSER_PAGE_SEMANTIC_EVENT_TYPES)[number];

export type ReadPageBrowserPageSemanticPostconditionStatus =
  | 'not_evaluated'
  | 'candidate_only'
  | 'unknown'
  | 'failed';

export interface ReadPageBrowserPageSemanticEvent {
  eventType: ReadPageBrowserPageSemanticEventType;
  summary: string;
  targetGroup: ReadPageBrowserPageObjectAttributeGroup;
  targetObjectFamily?: ReadPageObjectLifecycleFamily;
  beforeState?: string;
  afterState?: string;
  confidence: number;
  evidenceRefs: string[];
  postconditionStatus: ReadPageBrowserPageSemanticPostconditionStatus;
  claimBoundary: string;
}

export const READ_PAGE_BROWSER_PAGE_OBJECT_WATCH_STATUSES = [
  'single_snapshot_only',
  'semantic_transition_candidate',
  'page_transition_candidate',
  'runtime_transition_candidate',
  'runtime_degraded',
  'changed_without_target_transition',
  'stable_or_unknown',
] as const;

export type ReadPageBrowserPageObjectWatchStatus =
  (typeof READ_PAGE_BROWSER_PAGE_OBJECT_WATCH_STATUSES)[number];

export interface ReadPageBrowserPageObjectWatchSummary {
  status: ReadPageBrowserPageObjectWatchStatus;
  primaryConclusion?: string;
  summary: string;
  changedGroups: ReadPageBrowserPageObjectAttributeGroup[];
  transitionCount: number;
  confidence: number;
  evidenceRefs: string[];
  claimBoundary: string;
}

export interface ReadPageBrowserPageObjectGroupState {
  status: string;
  summary: string;
  facts?: Record<string, string | number | boolean | null | string[] | number[]>;
  confidence: number;
  evidenceRefs: string[];
  claimBoundary: string;
}

export interface ReadPageBrowserPageObjectCompactView {
  source: 'read_page_browser_page_object_compact';
  rootObjectId: string;
  status: ReadPageBrowserPageObjectView['status'];
  watchStatus: ReadPageBrowserPageObjectWatchStatus;
  primaryConclusion: string;
  changedGroups: ReadPageBrowserPageObjectAttributeGroup[];
  transitionCount: number;
  facts: {
    window?: Record<string, string | number | boolean | null | string[] | number[]>;
    tab?: Record<string, string | number | boolean | null | string[] | number[]>;
    page?: Record<string, string | number | boolean | null | string[] | number[]>;
    visualReliability?: Record<string, string | number | boolean | null | string[] | number[]>;
  };
  operationSummary?: string;
  evidenceSummary?: string;
  claimBoundary: string;
}

export interface ReadPageBrowserPageObjectView {
  source: 'read_page_browser_page_object';
  rootObjectId: string;
  status: 'single_snapshot' | 'compared_snapshot';
  attributeGroups: Record<
    ReadPageBrowserPageObjectAttributeGroup,
    ReadPageBrowserPageObjectGroupState
  >;
  semanticEvents: ReadPageBrowserPageSemanticEvent[];
  dynamicAttributeSummary?: ReadPageBrowserPageObjectWatchSummary;
  rawLifecycleStats: {
    status: ReadPageObjectLifecycleSummary['status'];
    objectCount: number;
    changedObjectCount: number;
  };
  compact?: ReadPageBrowserPageObjectCompactView;
  claimBoundary: string;
}

/**
 * T3.2 legacy shape is preserved for backward compatibility. T5.4 adds
 * optional semantic fields (objectType / region / importance / reasons /
 * actions / sourceKind). The protocol starts emitting them at T5.4.4.
 * Until then the T3.2 fields are the only stable surface; downstream
 * consumers MUST treat T5.4 fields as optional.
 */
export interface ReadPageHighValueObject {
  id: string;
  kind: 'candidate_action' | 'interactive_element' | 'page_role_seed' | string;
  label: string;
  ref?: string;
  role?: string;
  actionType?: string;
  confidence?: number;
  reason: string;
  objectType?: ReadPageObjectType;
  /**
   * Optional family-specific sub-type that refines `objectType`. Carries
   * namespaced values like `'github.workflow_run_entry'` or
   * `'github.repo_nav_tab'`. Added in T5.4.5 to let downstream pickers
   * select the RIGHT link on visually-ambiguous pages (e.g. GitHub
   * `/actions` where workflow files and workflow runs look the same).
   *
   * Recommended GitHub values (non-exhaustive):
   *   - `github.repo_nav_tab`            (Issues / PRs / Actions / Security / Insights top nav)
   *   - `github.security_quality_tab`    (independent "Security and quality" tab)
   *   - `github.workflow_run_entry`      (a specific `/actions/runs/<id>` row)
   *   - `github.workflow_file_entry`     (a `.github/workflows/<name>.yml` link under /actions)
   *   - `github.workflow_filter_control` (filter button / `/actions?query=...`)
   *   - `github.page_anchor`             (in-page `#fragment` link like `#start-of-content`)
   *
   * Consumers MUST treat this as optional and use string-prefix matching
   * (`startsWith('github.')`) rather than exhaustive switches so new
   * values can be added without breaking downstream code.
   */
  objectSubType?: string;
  region?: string | null;
  importance?: number;
  reasons?: string[];
  actions?: ReadPageHighValueObjectAction[];
  sourceKind?: ReadPageSourceKind;
  /**
   * Optional raw `href` mirrored from the originating interactive element.
   * Present only for link-like objects. Added in T5.4.5 so an LLM / test
   * picker can match a target by URL instead of fragile label text.
   */
  href?: string;
  /**
   * Stable targetRef. Format: `tgt_<10-hex>`, derived deterministically
   * from `(pageRole | objectSubType | role | normalizedLabel | hrefPathBucket
   * | ordinal)` so that the same logical DOM object surfaces the same value
   * across reloads, cosmetic class toggles, and minor list churn.
   *
   * Distinct from `id` (which is derived from per-snapshot `ref` and
   * therefore volatile) and from `ref` (the per-snapshot accessibility-tree
   * handle). Upstream callers MAY persist this value across turns and feed
   * it back as `candidateAction.targetRef` on `chrome_click_element` /
   * `chrome_fill_or_select` / `chrome_computer left_click|fill`. The click
   * bridge resolves it through an internal per-tab snapshot registry; if the
   * registry has no mapping (e.g. caller has not re-read the page since the
   * last navigation), the click bridge fails closed with a clear message
   * rather than silently aiming at a stale ref.
   *
   * Optional: present whenever the snapshot has enough signal to derive a
   * deterministic key. Older snapshots and degraded snapshots may omit it.
   */
  targetRef?: string;
}

/**
 * Prefix marking a stable targetRef. Pure constant so the click
 * bridge can deterministically distinguish stable refs from per-snapshot
 * refs without parsing or guessing.
 */
export const STABLE_TARGET_REF_PREFIX = 'tgt_' as const;

export interface ReadPageTaskLevel0 {
  summary: string;
  taskMode: ReadPageTaskMode;
  pageRole: string;
  primaryRegion: string | null;
  focusObjectIds: string[];
}

export interface ReadPageTaskLevel1 {
  overview: string;
  highValueObjectIds: string[];
  candidateActionIds: string[];
}

export interface ReadPageTaskLevel2 {
  available: boolean;
  defaultAccess: 'artifact_ref' | 'inline_full_snapshot';
  detailRefs: string[];
  expansions: string[];
  boundary: string;
  /**
   * Explicit source routing (per
   * `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §11.5). `L2` should
   * point the caller at the *right* deeper source instead of emitting all
   * three at once. Each field is optional and may be `null` when the
   * corresponding source is not currently available for this snapshot.
   *
   * - `domJsonRef`   — artifact ref for the structured DOM-semantic
   *   snapshot. Always populated in v1 because DOM JSON is the execution
   *   truth (§4.1).
   * - `markdownRef`  — artifact ref for the Markdown projection. Present
   *   only when `read_page(render='markdown')` was requested AND a
   *   markdown projection was successfully generated.
   * - `knowledgeRef` — placeholder for API Knowledge structured-data
   *   sources (`knowledge_api_endpoints`). Always `null` in v1
   *   because the runtime call surface does not yet exist; reserved so
   *   downstream consumers can start coding against the field shape.
   */
  domJsonRef?: string | null;
  markdownRef?: string | null;
  knowledgeRef?: string | null;
}

export interface ReadPageVisibleRegionBoundingBox {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
}

export interface ReadPageVisibleRegionRow {
  rowId: string;
  title: string;
  primaryText: string | null;
  secondaryText: string | null;
  summary: string | null;
  metaText: string | null;
  interactionText: string | null;
  visibleTextFields: string[];
  targetRef: string | null;
  targetRefCoverageRate: number;
  boundingBox: ReadPageVisibleRegionBoundingBox | null;
  regionId: string;
  sourceRegion: string;
  confidence: number;
  qualityReasons: string[];
}

export interface ReadPageVisibleRegionPageInfo {
  url: string | null;
  title: string | null;
  viewport: { width: number | null; height: number | null; dpr: number | null };
  scrollY: number | null;
  pixelsAbove: number | null;
  pixelsBelow: number | null;
  visibleRegionCount: number;
  candidateRegionCount: number;
}

export type ReadPageVisibleRegionRejectionReason =
  | 'low_value_region'
  | 'footer_like_region'
  | 'navigation_like_region'
  | 'target_ref_coverage_insufficient'
  | 'single_isolated_text'
  | 'empty_shell'
  | 'broad_page_shell'
  | 'dom_region_rows_unavailable';

export interface ReadPageVisibleRegionRows {
  sourceDataSource: 'dom_region_rows';
  rows: ReadPageVisibleRegionRow[];
  rowCount: number;
  visibleRegionRowsUsed: boolean;
  visibleRegionRowsRejectedReason: string | null;
  sourceRegion: string;
  rowExtractionConfidence: number;
  cardExtractorUsed: boolean;
  cardPatternConfidence: number;
  cardRowsCount: number;
  rowOrder: 'visual_order';
  targetRefCoverageRate: number;
  regionQualityScore: number;
  visibleDomRowsCandidateCount: number;
  visibleDomRowsSelectedCount: number;
  lowValueRegionRejectedCount: number;
  footerLikeRejectedCount: number;
  navigationLikeRejectedCount: number;
  targetRefCoverageRejectedCount: number;
  rejectedRegionReasonDistribution: Record<ReadPageVisibleRegionRejectionReason, number>;
  pageInfo: ReadPageVisibleRegionPageInfo;
}

export interface ReadPageCompleteTextRegion {
  sourceDataSource: 'web_content_text';
  sourceRoute: 'visible_text_sample';
  charCount: number;
  normalizedLength: number;
  lineCount: number;
  completeTextAvailable: boolean;
  structureSparse: boolean;
  contentSparse: boolean;
  quality: 'complete_text_sparse_structure' | 'usable' | 'sparse';
  recommendation: 'use_chrome_get_web_content_for_full_body';
  reason: string;
}

export type ReadPageCurrentTabRunOwnershipVerdict =
  | 'run_owned_by_task'
  | 'not_run_owned_by_task'
  | 'unknown';

export type ReadPageCurrentTabPrimaryRelationVerdict =
  | 'current_tab_is_primary'
  | 'current_tab_differs_from_primary'
  | 'primary_tab_unknown'
  | 'current_tab_unknown';

export type ReadPageProtectedScopeVerdict = 'protected' | 'not_protected' | 'unknown';

export type ReadPageCleanupEligibilityVerdict = 'eligible' | 'not_eligible' | 'unknown';

export type ReadPageProtectReason =
  | 'current_tab_unknown'
  | 'not_run_owned_by_task'
  | 'current_tab_is_primary'
  | 'primary_tab_unknown'
  | null;

export type ReadPageWindowRuntimeState =
  | 'normal'
  | 'minimized'
  | 'maximized'
  | 'fullscreen'
  | 'docked'
  | 'unknown';

export interface ReadPageOwnershipRuntimeSummary {
  currentTabId: number | null;
  currentWindowId: number | null;
  currentWindowState: ReadPageWindowRuntimeState | null;
  currentWindowWidth: number | null;
  currentWindowHeight: number | null;
  currentWindowLeft: number | null;
  currentWindowTop: number | null;
  isCurrentTabActive: boolean | null;
  isCurrentWindowFocused: boolean | null;
  browserActiveTabId: number | null;
  browserActiveTabIdKnown: boolean;
  isReadTargetBrowserActiveTab: boolean | null;
  currentTabUrl?: string | null;
  currentTabPendingUrl?: string | null;
  currentTabTitle?: string | null;
  currentTabStatus?: string | null;
  currentTabDiscarded?: boolean | null;
  currentTabAudible?: boolean | null;
  currentTabMuted?: boolean | null;
  currentTabPinned?: boolean | null;
  currentTabOpenerTabId?: number | null;
  currentTabOpenedBy?: 'ai' | 'user_or_page' | 'unknown' | null;
  currentTabOpenedBySource?: 'ai_tool' | 'page_opener' | 'user_or_unknown' | 'unknown' | null;
  currentTabOpenedByConfidence?: number | null;
  currentTabOpenedByReason?: string | null;
  currentTabAiOperationState?: 'idle' | 'recently_operated' | 'closed' | null;
  currentTabLastAiOperation?: string | null;
  currentTabLastAiOperationAtMs?: number | null;
  currentTabLastAiOperationConfidence?: number | null;
  currentTabLastAiOperationReason?: string | null;
  currentTabCanTabrixOperate?: boolean | null;
  currentTabOperabilityReason?: string | null;
  currentTabRuntimeStateSource?: 'browser_world_inventory' | 'chrome_tab_snapshot' | 'unknown';
  /**
   * Optional AI-facing Browser World summary for the current read_page target.
   * This is browser lifecycle/object-routing evidence only. It must not be
   * treated as page content understanding, task success, account-state proof,
   * or API/CDP reuse proof.
   */
  browserWorldObjectChangeSummary?: string | null;
  browserWorldActionableObjectChangeSummary?: string | null;
  browserWorldCurrentOperationConclusion?: string | null;
  browserWorldRoutingDecisionSummary?: string | null;
  currentOwnerType: import('./browser-task-thing-contract').BrowserPageOwnerType;
  currentTabRunOwnershipVerdict: ReadPageCurrentTabRunOwnershipVerdict;
  currentTabPrimaryRelationVerdict: ReadPageCurrentTabPrimaryRelationVerdict;
  protectedScopeVerdict: ReadPageProtectedScopeVerdict;
  cleanupEligibility: ReadPageCleanupEligibilityVerdict;
  protectReason: ReadPageProtectReason;
  isCurrentTabRunOwnedByTask: boolean;
  runOwnedTabIds: number[];
  runOwnedTabCount: number;
  defaultProtection: 'protect_unknown_and_user_owned';
  bridgeState: string | null;
  primaryTabId: number | null;
  primaryTabReuseRate: number | null;
  benchmarkOwnedTabCount: number | null;
  heartbeatTabCount: number | null;
  heartbeatWindowCount: number | null;
}

export interface ReadPageExtensionFields {
  /**
   * Additive observation-kernel profile for the snapshot.
   *
   * `mode` remains the backward-compatible verbosity selector. This field tells
   * upstream agents how the snapshot should be interpreted in the Observe ->
   * Act -> Verify -> Learn loop: compact execution view, task-cropped view,
   * delta/change view, full detail, or debug diagnostics.
   */
  observationProfile?: ReadPageObservationProfile;
  /**
   * Additive coverage boundary for browser-state observation.
   *
   * This field reports whether important dynamic browser surfaces were
   * structurally covered, degraded, unsupported, or visible but unresolved. It
   * is not click evidence and not business-success proof.
   */
  coverage?: ReadPageObservationCoverage;
  /**
   * Additive evidence-source tags used to build this snapshot.
   *
   * The tags are evidence provenance only. They do not grant actionability:
   * execution still requires targetRef, candidateAction, or locatorChain and
   * business success still requires postcondition verification.
   */
  evidenceSource?: ReadPageEvidenceSource[];
  currentWindowId?: number | null;
  currentWindowState?: ReadPageWindowRuntimeState | null;
  currentWindowWidth?: number | null;
  currentWindowHeight?: number | null;
  currentWindowLeft?: number | null;
  currentWindowTop?: number | null;
  isCurrentTabActive?: boolean | null;
  isCurrentWindowFocused?: boolean | null;
  browserActiveTabId?: number | null;
  browserActiveTabIdKnown?: boolean;
  isReadTargetBrowserActiveTab?: boolean | null;
  /**
   * Resolved Chrome tab id for this read target.
   *
   * Runtime routing evidence only. This lets AI callers bind DOM/readback
   * evidence to a concrete browser tab without inferring from screenshots,
   * active-tab state, or nested diagnostics. It is not business-success proof.
   */
  tabId?: number | null;
  candidateActions?: ReadPageCandidateAction[];
  /**
   * Additive read-only evidence for file-upload inputs present in the current
   * DOM snapshot. This is a selector-binding candidate for `chrome_upload_file`,
   * not proof that upload is authorized, attempted, completed, or accepted by
   * the website.
   */
  fileInputBindings?: ReadPageFileInputBinding[];
  /**
   * Additive read-only publish-form readiness evidence.
   *
   * This summarizes current DOM/candidate-action/file-input evidence into the
   * required-field boundary an AI executor needs before attempting publish-like
   * business actions. It is not upload proof, not platform-rule compliance
   * proof, and not final publish success proof.
   */
  publishFormReadiness?: ReadPagePublishFormReadiness;
  pageContext?: ReadPagePageContext;
  frameContext?: ReadPageFrameContext | null;
  historyRef?: string | null;
  memoryHints?: ReadPageMemoryHint[];
  taskMode?: ReadPageTaskMode;
  complexityLevel?: ReadPageComplexityLevel;
  sourceKind?: ReadPageSourceKind;
  highValueObjects?: ReadPageHighValueObject[];
  /**
   * V28 R4A additive page-region perception output.
   *
   * This is an AI-facing page understanding surface, not an execution
   * authority. Click/fill execution still uses `targetRef` and
   * `candidateActions`. Region states are bounded evidence claims and must
   * not be treated as proof that login/logout/business completion succeeded.
   */
  pageRegions?: ReadPageRegion[];
  /**
   * V28 R4A additive page-operation planning map.
   *
   * This tells an AI assistant what the page appears able to do before it
   * chooses a tool action. It deliberately summarizes regions into generic
   * purposes and readiness states. It must not carry raw account identifiers,
   * QR payloads, cookies, tokens, or private page text. Execution still goes
   * through `candidateActions` / `targetRef`; this map is planning guidance,
   * not a click authority or proof of business completion.
   */
  pageOperationMap?: ReadPageOperationMap;
  /**
   * V28 R4C additive browser-object lifecycle summary.
   *
   * This is a redacted evidence surface derived from pageRegions and
   * pageOperationMap. It is not an execution authority, not proof of login or
   * business completion, and not a replacement for postcondition verification.
   * A single snapshot can only say which browser objects are currently
   * candidate-visible; state transitions require fresh before/after reads.
   */
  objectLifecycle?: ReadPageObjectLifecycleSummary;
  /**
   * V28 R4C additive AI-facing BrowserPageThing view.
   *
   * This is a derived projection over pageRegions, pageOperationMap, and
   * objectLifecycle. It groups dynamic page attributes and condenses noisy
   * lifecycle deltas into semantic events. It is not an execution authority,
   * not proof of login/logout/business completion, and not API/CDP proof.
   */
  browserPageObject?: ReadPageBrowserPageObjectView;
  /**
   * Compact V28 BrowserPageObject projection for default AI reads.
   *
   * It preserves the current conclusion, changed attribute groups, key
   * BrowserWindow/BrowserTab/BrowserPage facts, operation summary, and claim
   * boundary without dumping all nested attribute groups and semantic events.
   * It is candidate evidence only and never an execution authority.
   */
  browserPageObjectCompact?: ReadPageBrowserPageObjectCompactView;
  /**
   * Additive login-collaboration artifact status.
   *
   * `chrome_read_page` detects auth/QR state by default, but only attempts to
   * extract a sendable QR image when the caller sets `includeAuthArtifacts`.
   * The image artifact is temporary, auth-scoped, and must not be treated as
   * login success proof or stored in long-term memory.
   */
  authArtifactStatus?: ReadPageAuthArtifactStatus;
  /**
   * Additive login-collaboration state for AI planning.
   *
   * This tells an upstream assistant whether the current page appears to need
   * user login help, what kind of help is likely required, and whether the
   * evidence is only a candidate. It is not a password manager, not proof of
   * login success, and not permission to operate protected user-owned tabs.
   */
  authCollaboration?: ReadPageAuthCollaboration;
  /**
   * Additive search-page observation map for Tabrix-as-eyes.
   *
   * This is a privacy-safe summary of visible search controls and candidate
   * result cards. It is not a business-success proof: sorting and Top-N
   * selection still require a fresh same-tab readback and AI-side reasoning.
   */
  searchSurface?: ReadPageSearchSurface;
  /**
   * Additive echo of closed-enum AI guidance used to prioritize this read.
   *
   * This does not carry the user's raw task text and is not proof that Tabrix
   * understood the task. It only tells downstream agents which observation
   * filter was applied for this snapshot.
   */
  assistantGuidanceEcho?: ReadPageAssistantGuidance;
  L0?: ReadPageTaskLevel0;
  L1?: ReadPageTaskLevel1;
  L2?: ReadPageTaskLevel2;
  visibleRegionRows?: ReadPageVisibleRegionRows;
  completeTextRegion?: ReadPageCompleteTextRegion | null;
  /**
   * V27 additive AI-facing data-source router evidence.
   * Mirrors `visibleRegionRows` only when DOM region rows are actually used,
   * so gates and agents do not need to parse nested diagnostic details to
   * know which source was selected.
   */
  kind?: ReadPageSelectedDataSource;
  selectedDataSource?: ReadPageSelectedDataSource;
  /**
   * V28 additive page/runtime truth projection.
   * Built from the same read_page snapshot payload so downstream agents can
   * consume lifecycle, data-source, ref-refresh, and context-size evidence
   * without re-parsing nested read_page diagnostics. This is not an
   * execution authority and does not replace `targetRef` / `candidateActions`.
   */
  pageProjection?: import('./browser-task-thing-contract').BrowserPageThingProjection;
  /**
   * BNS-03 additive attention guidance for the current read snapshot.
   *
   * This is deterministic guidance for AI planning, not proof that the
   * browser task scope is correct. It carries abstract scope kinds and
   * region purposes, not selectors, hostnames, or site-specific anchors.
   */
  watchScope?: import('./dynamic-watch-scope').DynamicWatchScope;
  ownershipRuntime?: ReadPageOwnershipRuntimeSummary;
  readinessVerdict?: ReadPageReadinessVerdict;
  rowCount?: number;
  visibleRegionRowsUsed?: boolean;
  targetRefCoverageRate?: number;
  regionQualityScore?: number;
  visibleDomRowsCandidateCount?: number;
  visibleDomRowsSelectedCount?: number;
  lowValueRegionRejectedCount?: number;
  footerLikeRejectedCount?: number;
  navigationLikeRejectedCount?: number;
  targetRefCoverageRejectedCount?: number;
  rejectedRegionReasonDistribution?: Record<ReadPageVisibleRegionRejectionReason, number>;
  /**
   * Which render mode was requested for this snapshot.
   * `'json'` is the default and matches the legacy contract. `'markdown'`
   * means a Markdown projection was opportunistically attached (see
   * `markdown` below); the JSON HVO/candidateActions/targetRef payload
   * is still emitted unchanged so execution paths are unaffected.
   *
   * Optional so older snapshots that pre-date render-mode support stay valid against
   * the contract.
   */
  renderMode?: ReadPageRenderMode;
  /**
   * Optional Markdown projection of the snapshot's
   * top objects + interactive labels, intended as a *reading surface*
   * (per `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` §4.3).
   *
   * MUST NOT be used as the source of truth for click/fill targeting;
   * `targetRef` / `candidateActions` remain authoritative. Present iff
   * `renderMode === 'markdown'` AND the projection succeeded.
   */
  markdown?: string | null;
}

export interface ReadPageStableSnapshot {
  mode: ReadPageMode;
  page: ReadPagePage;
  summary: ReadPageSummary;
  interactiveElements: ReadPageInteractiveElement[];
  artifactRefs: ReadPageArtifactRef[];
}

export interface ReadPageCompactSnapshot extends ReadPageStableSnapshot, ReadPageExtensionFields {}

export interface ReadPageDiagnostics {
  stats: { processed: number; included: number; durationMs: number };
  contentSummary: {
    charCount: number;
    normalizedLength: number;
    lineCount: number;
    quality: ReadPageQuality;
  };
  tips: string;
  reason: string | null;
}

export interface ReadPageNormalSnapshot extends ReadPageCompactSnapshot {
  summary: ReadPageSummary & {
    primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
    footerOnly?: boolean;
    anchorTexts?: string[];
  };
  diagnostics: ReadPageDiagnostics;
}

export interface ReadPageFullSnapshot extends ReadPageCompactSnapshot {
  summary: ReadPageSummary & {
    primaryRegionConfidence?: ReadPagePrimaryRegionConfidence;
    footerOnly?: boolean;
    anchorTexts?: string[];
  };
  fullSnapshot: {
    pageContent: string;
    refMap: unknown[];
    fallbackElements: unknown[];
    fallbackCount: number;
    markedElements: unknown[];
    stats: { processed: number; included: number; durationMs: number };
    contentSummary: {
      charCount: number;
      normalizedLength: number;
      lineCount: number;
      quality: ReadPageQuality;
    };
    tips: string;
    reason: string | null;
  };
}

export const READ_PAGE_MODE_MINIMUM_FIELDS: Record<ReadPageMode, readonly string[]> = {
  compact: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs'],
  normal: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'diagnostics'],
  full: ['mode', 'page', 'summary', 'interactiveElements', 'artifactRefs', 'fullSnapshot'],
};

export const READ_PAGE_TASK_PROTOCOL_FIELDS = [
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
] as const;

// ---------------------------------------------------------------------------
// Layer Dispatch Runtime contract
// ---------------------------------------------------------------------------

/**
 * Which layer envelope the caller wants
 * `chrome_read_page` to materialize. `L0+L1` is the default shape when
 * this field is omitted; `L0+L1+L2` is the explicit full expansion.
 *
 * The values are intentionally serialization-stable strings (not bit
 * flags) so they can land in the MCP schema and the SQLite telemetry
 * column without a side index. Order of the values mirrors §11 of
 * `docs/TABRIX_THREE_LAYER_DATA_COORDINATION_V1.md` (smallest first).
 */
export type ReadPageRequestedLayer = 'L0' | 'L0+L1' | 'L0+L1+L2';

export const READ_PAGE_REQUESTED_LAYER_VALUES = ['L0', 'L0+L1', 'L0+L1+L2'] as const;

/**
 * Closed enum of dispatcher reasons. Each value corresponds to
 * one row of the Layer Dispatch Strategy Table.
 * Stable for telemetry; new reasons MUST be appended, not reordered or
 * renamed, because release gates aggregate against these names.
 */
export type LayerDispatchReason =
  // priority 1: safety override
  | 'safety_required_full_layers'
  // priority 2: user intent override
  | 'user_intent_summary'
  | 'user_intent_open_or_select'
  | 'user_intent_form_or_submit'
  | 'user_intent_details_or_compare'
  // priority 3: task type
  | 'task_type_reading_only'
  | 'task_type_action'
  // priority 4: page complexity
  | 'simple_page_low_density'
  | 'medium_page_overview'
  | 'complex_page_detail_required'
  // priority 5: MKEP support
  | 'knowledge_supports_summary'
  | 'knowledge_with_action'
  // priority 6: fail-safe
  | 'dispatcher_fallback_safe';

export const LAYER_DISPATCH_REASON_VALUES: readonly LayerDispatchReason[] = [
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
] as const;

/**
 * Locked 3-value `LayerSourceRoute` enum.
 * Source of truth for both telemetry and release gates.
 *
 * - `read_page_required` — caller MUST call `chrome_read_page` with
 *   the chosen layer; the chooser cannot pre-build context for it.
 * - `knowledge_supported_read` — caller should call `chrome_read_page`
 *   but the chooser surfaced API Knowledge shape evidence as well.
 * - `dispatcher_fallback_safe` — dispatcher could not classify the
 *   input and returns the full safe layer; execution fallback plans
 *   may clamp this back to compact DOM reads before calling
 *   `chrome_read_page`.
 *
 * Adding another value requires a full enum migration in
 * the release gate library, the telemetry column allow-list, and the
 * benchmark transformer's `KNOWN_SOURCE_ROUTES`.
 */
export type LayerSourceRoute =
  | 'read_page_required'
  | 'knowledge_supported_read'
  | 'dispatcher_fallback_safe';

export const LAYER_SOURCE_ROUTE_VALUES: readonly LayerSourceRoute[] = [
  'read_page_required',
  'knowledge_supported_read',
  'dispatcher_fallback_safe',
] as const;

/**
 * Token estimate helper — `ceil(byteLength / 4)`. Pure, no
 * dependencies. Mirrors the locked decision so the
 * dispatcher, the read-page tool, and the release gate all derive the
 * same numbers from the same source string.
 *
 * `null`/`undefined` input → 0. Callers MUST pass the UTF-8 byte
 * length explicitly when they have it (so rendered token counts stay
 * stable across surrogate pairs).
 */
export function estimateTokensFromBytes(byteLength: number | null | undefined): number {
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength) || byteLength <= 0) {
    return 0;
  }
  return Math.ceil(byteLength / 4);
}

/**
 * Convenience wrapper — most callers have a serialized JSON string.
 * Uses TextEncoder when available (browser + node 20+); falls back to
 * Buffer in plain Node.js test environments. Pure besides the global
 * lookup.
 */
export function estimateTokensFromString(serialized: string | null | undefined): number {
  if (typeof serialized !== 'string' || serialized.length === 0) {
    return 0;
  }
  let bytes: number;
  // Prefer the platform-native path so chrome-extension and native-server
  // agree on the count without pulling Buffer into the bundler graph.
  if (typeof TextEncoder !== 'undefined') {
    bytes = new TextEncoder().encode(serialized).length;
  } else {
    // Fallback: Node.js Buffer. Only reached in legacy test runners.

    const buf = (globalThis as { Buffer?: { byteLength(s: string, enc: string): number } }).Buffer;
    bytes = buf ? buf.byteLength(serialized, 'utf8') : serialized.length;
  }
  return estimateTokensFromBytes(bytes);
}
