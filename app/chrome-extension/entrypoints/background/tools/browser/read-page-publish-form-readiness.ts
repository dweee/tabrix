import type {
  ReadPageFileInputBinding,
  ReadPagePublishFormReadiness,
  ReadPagePublishFormRequiredFieldEvidence,
  ReadPageRegion,
} from '@tabrix/shared';
import type { PageRole } from './read-page-understanding';
import type { CandidateActionSeed } from './read-page-candidate-actions';

function isPublishIntent(intent: unknown): boolean {
  return typeof intent === 'string' && intent.startsWith('publish.');
}

function normalizePublishReadinessText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function matchesPublishTitleField(name: unknown): boolean {
  return /(^|[\s:：_-])(title|headline|caption|标题|题目)([\s:：_-]|$)/i.test(
    normalizePublishReadinessText(name),
  );
}

function matchesPublishBodyField(name: unknown): boolean {
  return /(body|description|desc|content|正文|文案|描述|内容)/i.test(
    normalizePublishReadinessText(name),
  );
}

function isFillableInteractiveElement(element: { role?: unknown }): boolean {
  const role = normalizePublishReadinessText(element.role);
  return role === 'textbox' || role === 'textarea' || role === 'input' || role === 'combobox';
}

function buildPublishTextFieldEvidence(
  field: 'title' | 'body_or_description',
  interactiveElements: Array<{ ref: string; role: string; name: string; valueState?: string }>,
): ReadPagePublishFormRequiredFieldEvidence {
  const matcher = field === 'title' ? matchesPublishTitleField : matchesPublishBodyField;
  const element = interactiveElements.find(
    (candidate) => isFillableInteractiveElement(candidate) && matcher(candidate.name),
  );
  if (!element) {
    return {
      field,
      status: 'not_observed',
      evidenceSource: 'dom',
      evidence: `${field}_field_not_observed_in_current_snapshot`,
      nextRequiredCheck: 'run_fresh_same_tab_read_after_media_or_form_state_changes',
    };
  }
  const status = element.valueState === 'non_empty' ? 'present_candidate' : 'not_proven';
  return {
    field,
    status,
    evidenceSource: 'dom',
    evidence:
      status === 'present_candidate'
        ? `${field}_field_present_with_non_empty_value_state`
        : `${field}_field_observed_but_non_empty_value_not_proven`,
    targetRef: element.ref,
    nextRequiredCheck: 'fill_required_text_field_then_run_fresh_same_tab_read',
  };
}

export function buildPublishFormReadiness(params: {
  pageRole: PageRole;
  primaryRegion: string | null;
  candidateActions: CandidateActionSeed[];
  fileInputBindings: ReadPageFileInputBinding[];
  interactiveElements: Array<{ ref: string; role: string; name: string; valueState?: string }>;
}): ReadPagePublishFormReadiness | undefined {
  const hasPublishSignal =
    params.pageRole === 'publish_form' ||
    (params.primaryRegion === 'form' &&
      params.candidateActions.some((action) => isPublishIntent(action.intent)));
  if (!hasPublishSignal) return undefined;

  const uploadCandidate = params.candidateActions.find(
    (action) => action.intent === 'publish.upload_media',
  );
  const firstFileInput = params.fileInputBindings.find((binding) => !binding.disabled);
  const mediaField: ReadPagePublishFormRequiredFieldEvidence =
    uploadCandidate || firstFileInput
      ? {
          field: 'media',
          status: 'not_proven',
          evidenceSource: firstFileInput ? 'file_input_binding' : 'candidate_action',
          evidence:
            'media_upload_control_observed_but_uploaded_media_state_not_proven_by_read_only_snapshot',
          ...(uploadCandidate?.targetRef ? { targetRef: uploadCandidate.targetRef } : {}),
          ...(firstFileInput?.selector ? { selector: firstFileInput.selector } : {}),
          nextRequiredTool: 'chrome_upload_file',
          ...(firstFileInput?.selector ? { nextRequiredSelector: firstFileInput.selector } : {}),
          nextRequiredCheck:
            'run_chrome_upload_file_then_run_fresh_same_tab_read_to_prove_upload_state',
        }
      : {
          field: 'media',
          status: 'not_observed',
          evidenceSource: 'dom',
          evidence: 'media_upload_control_not_observed_in_current_snapshot',
          nextRequiredCheck: 'run_fresh_same_tab_read_after_mode_or_route_change',
        };
  const requiredFields = [
    mediaField,
    buildPublishTextFieldEvidence('title', params.interactiveElements),
    buildPublishTextFieldEvidence('body_or_description', params.interactiveElements),
  ];
  const blockingReasons = requiredFields
    .filter((field) => field.status !== 'present_candidate')
    .map((field) => `${field.field}:${field.status}`);
  const nextUploadField = requiredFields.find((field) => field.nextRequiredTool);

  return {
    status: blockingReasons.length === 0 ? 'ready_candidate' : 'not_ready_candidate',
    businessSuccessProven: false,
    requiredFields,
    blockingReasons,
    ...(nextUploadField?.nextRequiredTool
      ? { nextRequiredTool: nextUploadField.nextRequiredTool }
      : {}),
    ...(nextUploadField?.nextRequiredSelector
      ? { nextRequiredSelector: nextUploadField.nextRequiredSelector }
      : {}),
    nextRequiredCheck:
      blockingReasons.length === 0
        ? 'run_fresh_same_tab_read_and_postcondition_check_before_publish_submit'
        : 'complete_required_fields_then_run_fresh_same_tab_read_before_publish_submit',
    claimBoundary:
      'Read-only DOM/candidate-action evidence can explain publish-form readiness gaps; it does not prove upload execution, website acceptance, platform-rule compliance, final publish success, or business success.',
  };
}

export function applyPublishFormReadinessToPageRegions(
  pageRegions: ReadPageRegion[] | undefined,
  readiness: ReadPagePublishFormReadiness | undefined,
): ReadPageRegion[] | undefined {
  if (!pageRegions || !readiness) return pageRegions;
  const formState =
    readiness.status === 'not_ready_candidate'
      ? 'publish_not_ready_candidate'
      : readiness.status === 'ready_candidate'
        ? 'publish_ready_candidate'
        : null;
  if (!formState) return pageRegions;

  return pageRegions.map((region) =>
    region.regionType !== 'form'
      ? region
      : {
          ...region,
          ...(formState ? { state: formState } : {}),
          readiness: readiness.status,
          readinessBlockingReasons: readiness.blockingReasons,
          ...(readiness.nextRequiredTool ? { nextRequiredTool: readiness.nextRequiredTool } : {}),
          ...(readiness.nextRequiredSelector
            ? { nextRequiredSelector: readiness.nextRequiredSelector }
            : {}),
          nextRequiredCheck: readiness.nextRequiredCheck,
        },
  );
}
