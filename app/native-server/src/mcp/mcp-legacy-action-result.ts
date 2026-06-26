import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildActionEvidenceResult, TOOL_NAMES } from '@tabrix/shared';
import { readSafeTargetRef } from './browser-action-readback';
import { readObject, readPositiveInteger, readString } from './register-tool-value-readers';

export function ensureStructuredLegacyActionResult(
  toolName: string,
  result: CallToolResult,
  args?: unknown,
): CallToolResult {
  if (toolName !== TOOL_NAMES.BROWSER.CLICK) return result;
  const first = result.content?.[0];
  if (!first || first.type !== 'text' || typeof first.text !== 'string') return result;
  let structuredPayload: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(first.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      structuredPayload = parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through and wrap the legacy text result.
  }
  if (structuredPayload) {
    if (readObject(structuredPayload.actionEvidenceResult)) return result;
    const resultShape = readString(structuredPayload.resultShape);
    if (
      resultShape !== 'legacy_text_error_normalized' &&
      resultShape !== 'legacy_text_normalized'
    ) {
      return result;
    }
  }

  const legacyWasError =
    readString(structuredPayload?.resultShape) === 'legacy_text_error_normalized' ||
    (result as { isError?: boolean }).isError === true;
  const input = readObject(args);
  const requestedTargetRef =
    readSafeTargetRef(input?.ref) ??
    readSafeTargetRef(readObject(input?.candidateAction)?.targetRef);
  const dispatchTarget =
    requestedTargetRef !== null
      ? 'ref'
      : readString(input?.selector) !== null
        ? 'selector'
        : readObject(input?.coordinates)
          ? 'coordinates'
          : 'unknown';
  const actionKind = readString(input?.interaction) === 'hover' ? 'hover' : 'click';
  const actionEvidenceResult = buildActionEvidenceResult({
    actionId: legacyWasError
      ? 'mcp:chrome_click_element:legacy_text_error_normalized'
      : 'mcp:chrome_click_element:legacy_text_normalized',
    actionKind,
    tabId: readPositiveInteger(input, 'tabId'),
    toolSuccess: !legacyWasError,
    targetBinding: {
      requestedTargetRef,
      resolvedTargetRef: null,
      dispatchTarget,
      targetBindingProven: false,
      claimBoundary:
        'Legacy text click normalization cannot prove final target binding; use structured click output or fresh readback.',
    },
    dispatch: {
      dispatched: !legacyWasError,
      acceptedByBrowser: !legacyWasError,
      errorCode: legacyWasError ? 'legacy_text_error_normalized' : null,
    },
    source: {
      selectedDataSource: 'unknown',
      sourceRouteHonestyVerdict: 'not_checked',
      fallbackUsed: null,
    },
    postAction: {
      postActionReadbackStatus: legacyWasError ? 'not_available' : 'required',
      postconditionVerdict: 'unknown',
      freshReadRequired: !legacyWasError,
      readbackSource: null,
    },
    business: {
      businessSuccessVerdict: 'not_proven',
      businessSuccessProven: false,
      negativeEvidence: legacyWasError
        ? ['legacy_text_error_without_structured_dispatch']
        : ['legacy_text_result_without_structured_postcondition'],
      nextRequiredCheck: legacyWasError ? 'fix_target_or_retry_with_fresh_refs' : 'fresh_read_page',
    },
    browserHygiene: {
      required: false,
      status: 'not_checked',
      leakedTabsOrWindows: null,
    },
  });
  const payload = structuredPayload
    ? { ...structuredPayload, actionEvidenceResult }
    : {
        success: false,
        dispatchSucceeded: !legacyWasError,
        observedOutcome: legacyWasError ? 'no_observed_change' : 'verification_unavailable',
        verification: {
          navigationOccurred: false,
          urlChanged: false,
          newTabOpened: false,
          domChanged: false,
          stateChanged: false,
          focusChanged: false,
        },
        clickDiff: { kind: 'unknown' },
        navigationOccurred: false,
        lane: 'tabrix_owned',
        message: legacyWasError
          ? 'Legacy text click error was normalized; click dispatch and post-action state are not proven'
          : 'Legacy text click result was normalized; post-action state is not proven without structured click signals or a follow-up read',
        clickMethod: 'unknown',
        resultShape: legacyWasError ? 'legacy_text_error_normalized' : 'legacy_text_normalized',
        rawTextLength: first.text.length,
        actionEvidenceResult,
      };

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text' ? { ...block, text: JSON.stringify(payload) } : block,
    ) as CallToolResult['content'],
  };
}
