import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ReadPageObjectLibraryHint,
  ReadPageSearchSurfaceGenericFilterGroupState,
} from '@tabrix/shared';
import type { BrowserObjectRepository } from '../memory/db';
import { readJsonObjectFromCallToolResult } from './register-tool-result-json';
import {
  readFirstString,
  readObject,
  readSafeReuseRecord,
  readString,
  readUnknownArray,
} from './register-tool-value-readers';

type BrowserObjectHintRepository = Pick<BrowserObjectRepository, 'listReusableForPage'>;

export function attachObjectLibraryHintsToReadPageResult(
  result: CallToolResult,
  browserObjects: BrowserObjectHintRepository | null | undefined,
  onLookupError?: (message: string) => void,
): CallToolResult {
  if (!browserObjects || result.isError === true) return result;
  const payload = readJsonObjectFromCallToolResult(result);
  if (!payload) return result;
  if (Array.isArray(payload.objectLibraryHints) && payload.objectLibraryHints.length > 0) {
    return result;
  }
  const projection = readObject(payload.pageProjection);
  const siteFamily = readString(projection?.siteFamily);
  const pageModelKey = readString(projection?.pageModelKey);
  if (!siteFamily || !pageModelKey) return result;

  let reusableObjects: ReturnType<BrowserObjectHintRepository['listReusableForPage']> = [];
  try {
    reusableObjects = browserObjects.listReusableForPage({ siteFamily, pageModelKey, limit: 8 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onLookupError?.(message);
    return result;
  }
  if (reusableObjects.length === 0) return result;

  const hints: ReadPageObjectLibraryHint[] = reusableObjects.map((object) => {
    const confidence =
      typeof object.confidenceScore === 'number' && Number.isFinite(object.confidenceScore)
        ? Math.max(0, Math.min(1, object.confidenceScore))
        : 0.5;
    const actionTypes = Array.isArray(object.actionTypes)
      ? object.actionTypes.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : undefined;
    const freshness = mapObjectLibraryHintFreshness(object);
    const planning = planObjectLibraryHintReuse({
      objectType: object.objectType,
      actionTypes,
      freshness,
      targetability: object.targetability,
      canTabrixOperate: object.canTabrixOperate,
    });
    return {
      source: 'object_library_reuse',
      objectType: object.objectType,
      objectFingerprint: object.objectFingerprint,
      siteFamily: object.siteFamily,
      pageModelKey: object.pageModelKey,
      reuseConfidence: confidence,
      freshness,
      lastValidatedAt: object.lastValidatedAt,
      lastObservedAt: object.lastObservedAt ?? object.updatedAt,
      ...(actionTypes && actionTypes.length > 0 ? { actionTypes } : {}),
      summary: object.primaryConclusion,
      planningUse: planning.planningUse,
      canSeedAction: planning.canSeedAction,
      requiresFreshRead: planning.requiresFreshRead,
      reuseReason: planning.reuseReason,
      nextStepHint: planning.nextStepHint,
      ...buildObjectLibraryReuseSignalFields(object),
      claimBoundary:
        'objectLibraryHints are redacted historical planning hints only; they may guide current candidate selection but never replace current candidateActions or post-action verification.',
    };
  });

  return {
    ...result,
    content: result.content.map((block, index) =>
      index === 0 && block.type === 'text'
        ? { ...block, text: JSON.stringify({ ...payload, objectLibraryHints: hints }) }
        : block,
    ),
  };
}

function buildObjectLibraryReuseSignalFields(object: {
  objectType: string;
  targetability?: unknown;
  facts?: unknown;
}): Pick<ReadPageObjectLibraryHint, 'reuseSignals'> {
  const targetability = readObject(object.targetability);
  const facts = readObject(object.facts);
  const targetabilityStatus = readFirstString(
    targetability?.targetabilityStatus,
    facts?.targetabilityStatus,
  );
  const actionTarget = readObject(targetability?.actionTarget) ?? readObject(facts?.actionTarget);
  const stableTarget = readObject(targetability?.stableTarget) ?? readObject(facts?.stableTarget);
  const sessionOnlyTarget =
    readObject(targetability?.sessionOnlyTarget) ?? readObject(facts?.sessionOnlyTarget);
  const sessionCandidateAction = readObject(
    readObject(sessionOnlyTarget?.toolArgs)?.candidateAction,
  );
  const sourceWindow = readSafeReuseRecord(
    readObject(targetability?.sourceWindow) ?? readObject(facts?.sourceWindow),
    ['sourceScrollY', 'firstSeenGlobalTop', 'sourceStrategy'],
  );
  const collectionWindow = readSafeReuseRecord(
    readObject(targetability?.collectionWindow) ?? readObject(facts?.collectionWindow),
    ['cardCount', 'scrollYRange', 'globalTopRange', 'viewportYRange', 'sourceStrategies'],
  );
  const filterState = buildObjectLibraryFilterSignal(facts?.filterState);
  const stableLocatorChain = readUnknownArray(
    facts?.stableLocatorChain ?? sessionCandidateAction?.locatorChain,
  )
    .map((entry): string | null => {
      if (typeof entry === 'string') return entry;
      const locator = readObject(entry);
      const type = readString(locator?.type);
      const value = readString(locator?.value);
      if (!type || !value || type === 'ref' || type === 'coordinate' || type === 'rect') {
        return null;
      }
      if (!['css', 'xpath', 'aria', 'text', 'label'].includes(type)) return null;
      return `${type}=${value.trim().replace(/\s+/g, ' ').slice(0, 160)}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, 4);
  const signals: NonNullable<ReadPageObjectLibraryHint['reuseSignals']> = {};
  const intent = readFirstString(facts?.intent, sessionCandidateAction?.intent);
  const matchReason = readFirstString(facts?.matchReason, sessionCandidateAction?.matchReason);
  const actionTargetKind = readString(actionTarget?.targetKind);
  const executionScope = readString(actionTarget?.executionScope);

  if (targetabilityStatus) signals.targetabilityStatus = targetabilityStatus;
  if (stableTarget || targetabilityStatus === 'stable_click_target') signals.hasStableTarget = true;
  if (actionTargetKind) signals.actionTargetKind = actionTargetKind;
  if (executionScope) signals.executionScope = executionScope;
  if (intent) signals.intent = intent;
  if (matchReason) signals.matchReason = matchReason;
  if (stableLocatorChain.length > 0) signals.stableLocatorChain = stableLocatorChain;
  if (sourceWindow) signals.sourceWindow = sourceWindow;
  if (collectionWindow) signals.collectionWindow = collectionWindow;
  if (filterState) signals.filterState = filterState;

  return Object.keys(signals).length > 0 ? { reuseSignals: signals } : {};
}

function buildObjectLibraryFilterSignal(
  value: unknown,
): NonNullable<ReadPageObjectLibraryHint['reuseSignals']>['filterState'] | undefined {
  const filterState = readObject(value);
  if (!filterState) return undefined;
  const filterGroups = buildObjectLibraryFilterGroupsSignal(filterState.filterGroups);
  const appliedLabels = readUnknownArray(filterState.appliedLabels)
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 8);
  const safe = {
    status: readString(filterState.status) ?? undefined,
    ...(appliedLabels.length > 0 ? { appliedLabels } : {}),
    ...(filterGroups.length > 0 ? { filterGroups } : {}),
    contentType: readString(filterState.contentType) ?? undefined,
    sort: readString(filterState.sort) ?? undefined,
    timeRange: readString(filterState.timeRange) ?? undefined,
  };
  return Object.values(safe).some((item) => item !== undefined) ? safe : undefined;
}

function buildObjectLibraryFilterGroupsSignal(
  value: unknown,
): ReadPageSearchSurfaceGenericFilterGroupState[] {
  return readUnknownArray(value)
    .map((item) => {
      const group = readObject(item);
      if (!group) return null;
      const groupId = readString(group.groupId);
      if (!groupId) return null;
      const candidates = readUnknownArray(group.candidates)
        .map((candidate) => {
          const object = readObject(candidate);
          if (!object) return null;
          const label = readString(object.label);
          if (!label) return null;
          const selected = typeof object.selected === 'boolean' ? object.selected : false;
          const targetRef = readString(object.targetRef);
          const candidateActionId = readString(object.candidateActionId);
          return {
            label,
            selected,
            ...(targetRef ? { targetRef } : {}),
            ...(candidateActionId ? { candidateActionId } : {}),
            confidence:
              typeof object.confidence === 'number' && Number.isFinite(object.confidence)
                ? Math.max(0, Math.min(1, object.confidence))
                : 0,
            reason: readString(object.reason) ?? 'filter candidate projected from object library',
          };
        })
        .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
        .slice(0, 12);
      const groupLabel = readString(group.groupLabel);
      const selected = readString(group.selected);
      const selectedCandidateId = readString(group.selectedCandidateId);
      return {
        groupId,
        ...(groupLabel ? { groupLabel } : {}),
        ...(selected ? { selected } : {}),
        ...(selectedCandidateId ? { selectedCandidateId } : {}),
        candidates,
        ambiguous: Boolean(group.ambiguous),
        source: readUnknownArray(group.source)
          .filter((entry): entry is string => typeof entry === 'string')
          .slice(0, 4),
        reason: readString(group.reason) ?? 'filter group projected from object library',
      };
    })
    .filter((group): group is NonNullable<typeof group> => Boolean(group))
    .slice(0, 8);
}

function mapObjectLibraryHintFreshness(object: {
  sourceFreshness?: string | null;
  lastValidatedAt?: string | null;
}): ReadPageObjectLibraryHint['freshness'] {
  const freshness = String(object.sourceFreshness ?? '').toLowerCase();
  if (freshness.includes('needs_refresh') || freshness.includes('refresh')) {
    return 'needs_refresh';
  }
  if (freshness.includes('stale') || freshness.includes('expired')) {
    return 'stale';
  }
  return object.lastValidatedAt ? 'validated' : 'unknown';
}

function planObjectLibraryHintReuse(input: {
  objectType: string;
  actionTypes?: string[];
  freshness: ReadPageObjectLibraryHint['freshness'];
  targetability: unknown;
  canTabrixOperate?: boolean | null;
}): Pick<
  ReadPageObjectLibraryHint,
  'planningUse' | 'canSeedAction' | 'requiresFreshRead' | 'reuseReason' | 'nextStepHint'
> {
  const hasActionTypes = Array.isArray(input.actionTypes) && input.actionTypes.length > 0;
  const targetability = readObject(input.targetability);
  const targetabilityStatus = readString(targetability?.targetabilityStatus);
  const hasStableTarget =
    readString(targetability?.targetRef) != null ||
    readString(targetability?.targetability) === 'target_ref' ||
    readString(targetability?.targetability) === 'locator_chain' ||
    targetabilityStatus === 'stable_click_target' ||
    targetabilityStatus === 'stable_target_set';
  const isActionLike =
    input.objectType === 'action_target' ||
    input.objectType === 'result_card' ||
    input.objectType === 'region' ||
    input.objectType === 'data_source';
  const canOperate = input.canTabrixOperate !== false;

  if (input.freshness === 'needs_refresh' || input.freshness === 'stale') {
    return {
      planningUse: 'fresh_read_first',
      canSeedAction: false,
      requiresFreshRead: true,
      reuseReason: `historical_${input.freshness}_object_requires_current_read_before_action`,
      nextStepHint: 'force_fresh_read_or_collect_current_objects_before_action',
    };
  }

  if (canOperate && hasActionTypes && isActionLike && hasStableTarget) {
    return {
      planningUse: 'can_seed_action',
      canSeedAction: true,
      requiresFreshRead: false,
      reuseReason: 'validated_actionable_object_can_help_match_current_candidate',
      nextStepHint: 'match_against_current_candidateActions_before_action',
    };
  }

  return {
    planningUse: 'reference_only',
    canSeedAction: false,
    requiresFreshRead: false,
    reuseReason: hasActionTypes
      ? 'historical_object_lacks_stable_current_target_binding'
      : 'historical_object_is_page_context_not_action_seed',
    nextStepHint: 'use_as_page_context_only',
  };
}
