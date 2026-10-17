/**
 * Current-task live observed API data selector.
 *
 * This module converts a just-stopped `chrome_network_capture` bundle
 * into safe compact rows for the same task. It never persists or
 * returns raw request/response bodies; the raw response body is parsed
 * in memory only long enough to build `ApiKnowledgeCompactRow[]`.
 */

import type { ApiKnowledgeCompactRow } from '../api/api-knowledge';
import {
  type CapturedNetworkBundle,
  type CapturedNetworkRequest,
  type CaptureKnowledgeContext,
  deriveEndpointCandidateFromRequest,
  deriveKnowledgeFromRequest,
} from '../memory/knowledge/api-knowledge-capture';
import type {
  EndpointCandidate,
  EndpointCandidateSemanticType,
} from '../memory/knowledge/network-observe-classifier';
import type { CorrelationConfidenceLevel } from '../memory/knowledge/knowledge-api-repository';
import { findSensitivePaths, isSensitiveKeyName } from '../runtime/privacy-gate';
import { compactGenericRows } from './knowledge-driven-reader';

const LIVE_OBSERVED_ROW_LIMIT = 10;
const LIVE_OBSERVED_CONTENT_TEXT_CAP = 24_000;
const LIVE_OBSERVED_CONTENT_SECTION_LIMIT = 24;
const LIVE_OBSERVED_CONTENT_SECTION_VALUE_CAP = LIVE_OBSERVED_CONTENT_TEXT_CAP;
const LIVE_OBSERVED_CONFIDENCE_FLOOR = 0.7;
const LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR = 0.72;
const LIVE_OBSERVED_DOM_CORRELATION_FLOOR = 0.9;

const READ_SHAPED_TYPES: ReadonlySet<EndpointCandidateSemanticType> = new Set([
  'search',
  'list',
  'pagination',
  'filter',
  'detail',
]);
const SAFE_SUMMARY_STRING_VALUE_CAP = 240;
const SENSITIVE_FIELD_RE =
  /(authorization|cookie|password|passwd|token|secret|session|csrf|xsrf|api[_-]?key)/i;

interface LiveObservedEndpointIdentity {
  endpointFamily: string;
  endpointSignature: string;
}

export type LiveObservedSelectedDataSource = 'api_rows' | 'api_detail' | 'cdp_enhanced_api_rows';
export type LiveObservedContentSelectedDataSource = 'api_content';

export interface LiveObservedContentSection {
  path: string;
  text: string;
  chars: number;
}

export interface LiveObservedCdpEvidence {
  observationMode: 'no_cdp' | 'cdp_enhanced';
  cdpUsed: boolean;
  cdpReason: string | null;
  cdpAttachDurationMs: number | null;
  cdpDetachSuccess: boolean;
  debuggerConflict: boolean;
  responseBodySource: 'debugger_api' | 'not_available';
  rawBodyPersisted: false;
  bodyCompacted: boolean;
}

export interface LiveObservedApiEvidence extends LiveObservedCdpEvidence {
  endpointSource: 'observed';
  liveObservedEndpointId: string | null;
  endpointSignature: string;
  semanticType: EndpointCandidateSemanticType;
  pageRegion: string;
  correlationScore: number;
  fieldShapeSummaryAvailable: boolean;
  privacyCheck: 'passed' | 'failed';
  fallbackCause: string | null;
  fallbackUsed: boolean;
  knowledgeUpserted: boolean;
  responseSummarySource: 'browser_context_summary' | 'debugger_body_probe' | 'not_available';
  rawBodyPersisted: false;
  capturedAfterArm: boolean | null;
  bridgePath: 'main_world_to_content_to_native' | 'not_available';
  responseSummaryRejectedReason: string | null;
}

export interface LiveObservedApiData extends LiveObservedApiEvidence {
  selectedDataSource: LiveObservedSelectedDataSource | LiveObservedContentSelectedDataSource;
  endpointFamily: string;
  dataPurpose: string;
  rows: ApiKnowledgeCompactRow[];
  rowCount: number;
  contentText: string | null;
  contentChars: number;
  contentSections: LiveObservedContentSection[];
  contentSectionCount: number;
  emptyResult: boolean;
  emptyReason: 'no_matching_records' | null;
  emptyMessage: string | null;
  compact: true;
  rawBodyStored: false;
}

export interface DeriveLiveObservedApiDataInput {
  bundle: CapturedNetworkBundle;
  ctx: CaptureKnowledgeContext;
  upsertedBySignature: ReadonlyMap<
    string,
    {
      endpointId: string | null;
      knowledgeUpserted: boolean;
      correlationConfidence: CorrelationConfidenceLevel | null;
      correlatedRegionId: string | null;
    }
  >;
  selectorContext?: {
    currentPageUrl?: string | null;
    pageRole?: string | null;
    expectedTaskQueryKeys?: readonly string[];
  };
}

export interface DeriveLiveObservedApiDataResult {
  selected: LiveObservedApiData[];
  rejected: LiveObservedApiEvidence[];
}

export function deriveLiveObservedApiDataFromBundle(
  input: DeriveLiveObservedApiDataInput,
): DeriveLiveObservedApiDataResult {
  const selected: LiveObservedApiData[] = [];
  const rejected: LiveObservedApiEvidence[] = [];
  const commonReq = input.bundle.commonRequestHeaders ?? {};
  const commonRes = input.bundle.commonResponseHeaders ?? {};

  const bundleCdpEvidence = buildCdpEvidence(input.bundle);
  for (const req of input.bundle.requests ?? []) {
    const upsert = deriveKnowledgeFromRequest(req, commonReq, commonRes, input.ctx);
    const candidate = deriveEndpointCandidateFromRequest(req, commonRes);
    if (!candidate) continue;
    const identity = upsert ? null : buildObservedEndpointIdentity(req);
    if (!upsert && !identity) continue;
    if (upsert && upsert.endpointSource !== 'observed') continue;

    const endpointSignature = upsert?.endpointSignature ?? identity!.endpointSignature;
    const endpointFamily = upsert?.urlPattern ?? identity!.endpointFamily;
    const upsertState = input.upsertedBySignature.get(endpointSignature);
    const contentResult = buildLiveContent(req, candidate, bundleCdpEvidence);
    const relevance = buildRelevanceEvidence({
      req,
      candidate,
      upsertState,
      contentAvailable: contentResult.ok,
      selectorContext: input.selectorContext,
    });
    const baseEvidence = buildEvidence({
      endpointSignature,
      candidate,
      req,
      upsertState,
      pageRegion: relevance.pageRegion,
      correlationScore: relevance.correlationScore,
      bundleCdpEvidence,
    });

    const allowTaskMatchedSafeSummaryRows =
      relevance.relevant &&
      relevance.pageRegion === 'task_query_network' &&
      responsePayloadMatchesCurrentTask(req, input.selectorContext);
    const rowsResult = buildLiveRows(req, candidate, bundleCdpEvidence, {
      allowTaskMatchedSafeSummaryRows,
    });
    if (!rowsResult.ok) {
      if (
        contentResult.ok &&
        relevance.relevant &&
        canSelectLiveContent(req, relevance.pageRegion)
      ) {
        selected.push({
          ...baseEvidence,
          selectedDataSource: 'api_content',
          endpointFamily,
          dataPurpose: `observed_${candidate.semanticType}_content`,
          rows: [],
          rowCount: 0,
          contentText: contentResult.contentText,
          contentChars: contentResult.contentChars,
          contentSections: contentResult.contentSections,
          contentSectionCount: contentResult.contentSections.length,
          emptyResult: contentResult.contentChars === 0,
          emptyReason: contentResult.contentChars === 0 ? 'no_matching_records' : null,
          emptyMessage:
            contentResult.contentChars === 0
              ? `Observed API endpoint ${endpointFamily} succeeded but returned no safe content.`
              : null,
          compact: true,
          rawBodyStored: false,
        });
        continue;
      }
      rejected.push({
        ...baseEvidence,
        privacyCheck: privacyCheckForRowsFailure(rowsResult.cause),
        fallbackCause: rowsResult.cause,
        fallbackUsed: true,
      });
      continue;
    }
    if (!relevance.relevant) {
      rejected.push({
        ...baseEvidence,
        fallbackCause: relevance.fallbackCause,
        fallbackUsed: true,
      });
      continue;
    }

    selected.push({
      ...baseEvidence,
      selectedDataSource: rowsResult.selectedDataSource,
      endpointFamily,
      dataPurpose: `observed_${candidate.semanticType}`,
      rows: rowsResult.rows,
      rowCount: rowsResult.rows.length,
      contentText: null,
      contentChars: 0,
      contentSections: [],
      contentSectionCount: 0,
      emptyResult: rowsResult.rows.length === 0,
      emptyReason: rowsResult.rows.length === 0 ? 'no_matching_records' : null,
      emptyMessage:
        rowsResult.rows.length === 0
          ? `Observed API endpoint ${endpointFamily} succeeded but returned no records.`
          : null,
      compact: true,
      rawBodyStored: false,
    });
  }

  selected.sort(
    (a, b) =>
      liveObservedDataSourcePriority(b.selectedDataSource) -
        liveObservedDataSourcePriority(a.selectedDataSource) ||
      b.correlationScore - a.correlationScore,
  );
  return { selected, rejected };
}

function liveObservedDataSourcePriority(
  selectedDataSource: LiveObservedApiData['selectedDataSource'],
): number {
  switch (selectedDataSource) {
    case 'cdp_enhanced_api_rows':
      return 4;
    case 'api_rows':
      return 3;
    case 'api_detail':
      return 2;
    case 'api_content':
      return 1;
  }
}

function buildObservedEndpointIdentity(
  req: CapturedNetworkRequest,
): LiveObservedEndpointIdentity | null {
  const method = String(req.method || 'GET').toUpperCase();
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return null;
  }
  const collapsed = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      if (/^\d+$/.test(segment)) return ':id';
      if (/^[0-9a-f]{16,}$/i.test(segment)) return ':id';
      if (segment.length > 24 && /^[a-z0-9_-]+$/i.test(segment)) return ':slug';
      return segment.toLowerCase();
    })
    .join('/');
  const path = collapsed.length > 0 ? `/${collapsed}` : '/';
  const endpointFamily = `${parsed.hostname.toLowerCase()}${path}`;
  return {
    endpointFamily,
    endpointSignature: `${method} ${endpointFamily}`,
  };
}

function buildEvidence(input: {
  endpointSignature: string;
  candidate: EndpointCandidate;
  req: CapturedNetworkRequest;
  upsertState:
    | {
        endpointId: string | null;
        knowledgeUpserted: boolean;
        correlationConfidence: CorrelationConfidenceLevel | null;
        correlatedRegionId: string | null;
      }
    | undefined;
  pageRegion: string;
  correlationScore: number;
  bundleCdpEvidence: LiveObservedCdpEvidence;
}): LiveObservedApiEvidence {
  const summary = input.req.safeResponseSummary;
  return {
    endpointSource: 'observed',
    ...input.bundleCdpEvidence,
    liveObservedEndpointId: input.upsertState?.endpointId ?? null,
    endpointSignature: input.endpointSignature,
    semanticType: input.candidate.semanticType,
    pageRegion: input.pageRegion,
    correlationScore: input.correlationScore,
    fieldShapeSummaryAvailable: input.candidate.shapeSummaryAvailable,
    privacyCheck: 'passed',
    fallbackCause: null,
    fallbackUsed: false,
    knowledgeUpserted: input.upsertState?.knowledgeUpserted === true,
    responseSummarySource:
      summary?.responseSummarySource === 'browser_context_summary'
        ? 'browser_context_summary'
        : typeof input.req.responseBody === 'string'
          ? 'debugger_body_probe'
          : 'not_available',
    rawBodyPersisted: false,
    capturedAfterArm:
      typeof summary?.capturedAfterArm === 'boolean' ? summary.capturedAfterArm : null,
    bridgePath:
      summary?.bridgePath === 'main_world_to_content_to_native'
        ? 'main_world_to_content_to_native'
        : 'not_available',
    responseSummaryRejectedReason:
      typeof summary?.rejectedReason === 'string' && summary.rejectedReason.length > 0
        ? summary.rejectedReason
        : null,
  };
}

function buildLiveRows(
  req: CapturedNetworkRequest,
  candidate: EndpointCandidate,
  cdpEvidence: LiveObservedCdpEvidence,
  options?: {
    allowTaskMatchedSafeSummaryRows?: boolean;
  },
):
  | {
      ok: true;
      selectedDataSource: LiveObservedSelectedDataSource;
      rows: ApiKnowledgeCompactRow[];
    }
  | {
      ok: false;
      cause: string;
    } {
  const status =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  if (status !== null && (status < 200 || status >= 300)) {
    if (candidate.semanticType === 'error') {
      return { ok: false, cause: candidate.noiseReason ?? 'endpoint_error' };
    }
    return { ok: false, cause: 'endpoint_error' };
  }

  const summary = req.safeResponseSummary;
  if (summary?.responseSummarySource === 'browser_context_summary') {
    if (summary.rawBodyPersisted !== false) {
      return { ok: false, cause: 'raw_body_persistence_risk' };
    }
    if (summary.capturedAfterArm !== true) {
      return { ok: false, cause: 'response_summary_before_arm' };
    }
    const requestTime = req.requestTime;
    const samplerArmedAt = summary.samplerArmedAt;
    if (isEpochMs(requestTime) && isEpochMs(samplerArmedAt) && requestTime < samplerArmedAt) {
      return { ok: false, cause: 'response_before_sampler_arm' };
    }
    if (summary.privacyCheck === 'failed') {
      return { ok: false, cause: summary.rejectedReason ?? 'privacy_check_failed' };
    }
    if (
      candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR &&
      options?.allowTaskMatchedSafeSummaryRows !== true
    ) {
      return { ok: false, cause: 'low_confidence' };
    }
    if (summary.fieldShapeSummaryAvailable !== true && summary.emptyResult !== true) {
      return { ok: false, cause: 'field_shape_unavailable' };
    }
    if (summary.emptyResult === true) {
      return { ok: true, selectedDataSource: 'api_rows', rows: [] };
    }
    const sensitiveField = findSensitiveSummaryFieldName(summary.rows ?? []);
    if (sensitiveField !== null) {
      return { ok: false, cause: 'sensitive_row_content' };
    }
    const rows = Array.isArray(summary.rows)
      ? compactSafeSummaryRows(summary.rows, LIVE_OBSERVED_ROW_LIMIT)
      : [];
    if (rows.length === 0) {
      return { ok: false, cause: summary.rejectedReason ?? 'compact_rows_unavailable' };
    }
    const safeSummaryPrivacy = findLiveRowsPrivacyLeak(rows);
    if (safeSummaryPrivacy !== null) {
      return { ok: false, cause: safeSummaryPrivacy };
    }
    return {
      ok: true,
      selectedDataSource:
        cdpEvidence.observationMode === 'cdp_enhanced'
          ? 'cdp_enhanced_api_rows'
          : candidate.semanticType === 'detail'
            ? 'api_detail'
            : 'api_rows',
      rows,
    };
  }

  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.cdpDetachSuccess !== true) {
    return { ok: false, cause: 'cdp_detach_failed' };
  }
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.debuggerConflict === true) {
    return { ok: false, cause: 'debugger_conflict' };
  }
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.rawBodyPersisted !== false) {
    return { ok: false, cause: 'raw_body_persistence_risk' };
  }
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.bodyCompacted !== true) {
    return { ok: false, cause: 'compact_rows_unavailable' };
  }
  if (!body || req.base64Encoded === true) {
    return {
      ok: false,
      cause: candidate.responseBodyUnavailable
        ? 'response_summary_unavailable'
        : 'response_body_unavailable',
    };
  }
  if (candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR) {
    return { ok: false, cause: 'low_confidence' };
  }
  if (!candidate.shapeSummaryAvailable) {
    return { ok: false, cause: 'field_shape_unavailable' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, cause: 'compact_rows_unavailable' };
  }
  const parsedPrivacy = findLiveRowsPrivacyLeak(parsed);
  if (parsedPrivacy !== null) {
    return { ok: false, cause: parsedPrivacy };
  }

  if (candidate.semanticType === 'empty') {
    return { ok: true, selectedDataSource: 'api_rows', rows: [] };
  }
  if (!READ_SHAPED_TYPES.has(candidate.semanticType)) {
    if (candidate.semanticType === 'noise') {
      return { ok: false, cause: candidate.noiseReason ?? 'noise_endpoint' };
    }
    if (candidate.semanticType === 'unknown_candidate') {
      return { ok: false, cause: candidate.noiseReason ?? 'unknown_semantic_type' };
    }
    return { ok: false, cause: 'compact_rows_unavailable' };
  }

  const rows = compactGenericRows(parsed, LIVE_OBSERVED_ROW_LIMIT);
  if (rows.length === 0) {
    return { ok: false, cause: 'compact_rows_unavailable' };
  }
  return {
    ok: true,
    selectedDataSource:
      cdpEvidence.observationMode === 'cdp_enhanced'
        ? 'cdp_enhanced_api_rows'
        : candidate.semanticType === 'detail'
          ? 'api_detail'
          : 'api_rows',
    rows,
  };
}

function isEpochMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1_000_000_000_000;
}

function buildLiveContent(
  req: CapturedNetworkRequest,
  candidate: EndpointCandidate,
  cdpEvidence: LiveObservedCdpEvidence,
):
  | {
      ok: true;
      contentText: string;
      contentChars: number;
      contentSections: LiveObservedContentSection[];
    }
  | {
      ok: false;
      cause: string;
    } {
  const status =
    typeof req.statusCode === 'number'
      ? req.statusCode
      : typeof req.status === 'number'
        ? req.status
        : null;
  if (status !== null && (status < 200 || status >= 300))
    return { ok: false, cause: 'endpoint_error' };
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.cdpDetachSuccess !== true) {
    return { ok: false, cause: 'cdp_detach_failed' };
  }
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.debuggerConflict === true) {
    return { ok: false, cause: 'debugger_conflict' };
  }
  if (cdpEvidence.observationMode === 'cdp_enhanced' && cdpEvidence.rawBodyPersisted !== false) {
    return { ok: false, cause: 'raw_body_persistence_risk' };
  }
  if (candidate.semanticType === 'noise' || candidate.semanticType === 'error') {
    return { ok: false, cause: candidate.noiseReason ?? 'noise_endpoint' };
  }
  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  if (!body || req.base64Encoded === true) {
    return {
      ok: false,
      cause: candidate.responseBodyUnavailable
        ? 'response_summary_unavailable'
        : 'response_body_unavailable',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, cause: 'content_parse_failed' };
  }
  const sections = extractContentSections(parsed);
  if (sections.length === 0) return { ok: false, cause: 'content_text_unavailable' };
  if (
    candidate.confidence < LIVE_OBSERVED_CONFIDENCE_FLOOR &&
    !isContentSourceCandidate(req) &&
    sections.length === 0
  ) {
    return { ok: false, cause: 'low_confidence' };
  }
  const contentPrivacy = findLiveRowsPrivacyLeak(sections);
  if (contentPrivacy !== null) return { ok: false, cause: contentPrivacy };
  const text = sections.map((section) => section.text).join('\n\n');
  return {
    ok: true,
    contentText:
      text.length > LIVE_OBSERVED_CONTENT_TEXT_CAP
        ? text.slice(0, LIVE_OBSERVED_CONTENT_TEXT_CAP)
        : text,
    contentChars: text.length,
    contentSections: sections,
  };
}

function canSelectLiveContent(req: CapturedNetworkRequest, pageRegion: string): boolean {
  if (isContentSourceCandidate(req)) return true;
  return pageRegion !== 'task_query_network' && pageRegion !== 'current_page_network';
}

function extractContentSections(value: unknown): LiveObservedContentSection[] {
  const sections: LiveObservedContentSection[] = [];
  collectContentSections(value, [], sections);
  return sections.sort((a, b) => b.chars - a.chars).slice(0, LIVE_OBSERVED_CONTENT_SECTION_LIMIT);
}

function collectContentSections(
  value: unknown,
  path: readonly string[],
  out: LiveObservedContentSection[],
): void {
  if (out.length >= LIVE_OBSERVED_CONTENT_SECTION_LIMIT * 2) return;
  if (typeof value === 'string') {
    const normalized = normalizeContentText(value);
    if (normalized.length >= 80 && path.some(isContentFieldName)) {
      out.push({
        path: path.join('.'),
        text:
          normalized.length > LIVE_OBSERVED_CONTENT_SECTION_VALUE_CAP
            ? normalized.slice(0, LIVE_OBSERVED_CONTENT_SECTION_VALUE_CAP)
            : normalized,
        chars: normalized.length,
      });
    }
    return;
  }
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.slice(0, 12).forEach((entry, index) => {
      collectContentSections(entry, [...path, String(index)], out);
    });
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_RE.test(key)) continue;
    collectContentSections(child, [...path, key], out);
  }
}

function normalizeContentText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isContentFieldName(value: string): boolean {
  return /\b(content|text|body|markdown|message|answer|summary|description|title)\b/i.test(value);
}

function isContentSourceCandidate(req: CapturedNetworkRequest): boolean {
  try {
    const path = new URL(req.url).pathname;
    return /\b(content|article|detail|conversation|thread|document|doc|page|body|post)\b/i.test(
      path,
    );
  } catch {
    return false;
  }
}

function buildCdpEvidence(bundle: CapturedNetworkBundle): LiveObservedCdpEvidence {
  const cdpEnhanced = bundle.observationMode === 'cdp_enhanced' || bundle.cdpUsed === true;
  return {
    observationMode: cdpEnhanced ? 'cdp_enhanced' : 'no_cdp',
    cdpUsed: bundle.cdpUsed === true,
    cdpReason: typeof bundle.cdpReason === 'string' ? bundle.cdpReason : null,
    cdpAttachDurationMs:
      typeof bundle.cdpAttachDurationMs === 'number' ? bundle.cdpAttachDurationMs : null,
    cdpDetachSuccess: cdpEnhanced ? bundle.cdpDetachSuccess === true : false,
    debuggerConflict: bundle.debuggerConflict === true,
    responseBodySource:
      bundle.responseBodySource === 'debugger_api' ? 'debugger_api' : 'not_available',
    rawBodyPersisted: false,
    bodyCompacted: bundle.bodyCompacted === true,
  };
}

function compactSafeSummaryRows(
  rows: readonly Record<string, unknown>[],
  limit: number,
): ApiKnowledgeCompactRow[] {
  const out: ApiKnowledgeCompactRow[] = [];
  for (const raw of rows.slice(0, limit)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const row: ApiKnowledgeCompactRow = {};
    for (const key of Object.keys(raw)) {
      if (shouldDropSafeSummaryField(key)) continue;
      const value = raw[key];
      if (
        value === null ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'string'
      ) {
        const compacted = compactSafeSummaryScalarValue(key, value);
        if (compacted !== undefined) row[key] = compacted;
      }
    }
    const publicUrl = findSafeSummaryPublicUrl(raw);
    if (publicUrl !== undefined) row.publicUrl = publicUrl;
    if (Object.keys(row).length > 0) out.push(row);
  }
  return out;
}

function shouldDropSafeSummaryField(key: string): boolean {
  return (
    SENSITIVE_FIELD_RE.test(key) || isSensitiveKeyName(key) || /(^|_)(object|record)?id$/i.test(key)
  );
}

function compactSafeSummaryScalarValue(
  key: string,
  value: string | number | boolean | null,
): string | number | boolean | null | undefined {
  if (typeof value !== 'string') return value;
  if (/(^|_)(url|href|link|permalink)$/i.test(key)) {
    return undefined;
  }
  if (/^publicUrl$/i.test(key)) {
    return sanitizeSummaryUrl(value);
  }
  if (value.length >= 32 && /^[A-Za-z0-9_-]+$/.test(value.trim())) return undefined;
  return value.length > SAFE_SUMMARY_STRING_VALUE_CAP
    ? value.slice(0, SAFE_SUMMARY_STRING_VALUE_CAP)
    : value;
}

function sanitizeSummaryUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function findSafeSummaryPublicUrl(row: Record<string, unknown>): string | undefined {
  for (const key of ['url', 'href', 'link', 'permalink', 'publicUrl']) {
    const value = row[key];
    if (typeof value !== 'string') continue;
    const sanitized = sanitizeSummaryUrl(value);
    if (sanitized !== undefined) return sanitized;
  }
  return undefined;
}

function findSensitiveSummaryFieldName(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = findSensitiveSummaryFieldName(entry);
      if (nested !== null) return nested;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_FIELD_RE.test(key)) return key;
    const nested = findSensitiveSummaryFieldName(child);
    if (nested !== null) return nested;
  }
  return null;
}

function findLiveRowsPrivacyLeak(value: unknown): string | null {
  const leaks = findSensitivePaths(value);
  if (leaks.length === 0) return null;
  const hasSensitiveValue = leaks.some((leak) => leak.reason === 'sensitive_value_shape');
  return hasSensitiveValue ? 'sensitive_row_content' : 'privacy_check_failed';
}

function privacyCheckForRowsFailure(cause: string): 'passed' | 'failed' {
  return /privacy|sensitive|secret|token|cookie|authorization|pii/i.test(cause)
    ? 'failed'
    : 'passed';
}

function buildRelevanceEvidence(args: {
  req: CapturedNetworkRequest;
  candidate: EndpointCandidate;
  contentAvailable: boolean;
  upsertState:
    | {
        endpointId: string | null;
        knowledgeUpserted: boolean;
        correlationConfidence: CorrelationConfidenceLevel | null;
        correlatedRegionId: string | null;
      }
    | undefined;
  selectorContext:
    | {
        currentPageUrl?: string | null;
        pageRole?: string | null;
        expectedTaskQueryKeys?: readonly string[];
      }
    | undefined;
}): {
  relevant: boolean;
  fallbackCause: string;
  pageRegion: string;
  correlationScore: number;
} {
  const domRegionId = sanitizeRegion(args.upsertState?.correlatedRegionId ?? null);
  const correlationConfidence = args.upsertState?.correlationConfidence ?? null;
  const hasConcreteDomRegion = domRegionId !== null && domRegionId !== 'current_page_network';
  if (hasConcreteDomRegion && correlationConfidence === 'low_confidence') {
    return {
      relevant: false,
      fallbackCause: 'low_correlation_confidence',
      pageRegion: domRegionId,
      correlationScore: args.candidate.confidence,
    };
  }
  if (hasConcreteDomRegion && correlationConfidence === 'high_confidence') {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: domRegionId,
      correlationScore: Math.max(args.candidate.confidence, LIVE_OBSERVED_DOM_CORRELATION_FLOOR),
    };
  }

  if (args.req.safeResponseSummary?.taskQueryValueMatched === true) {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'task_query_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }
  if (args.req.safeResponseSummary?.taskQueryValueMatched === false) {
    return {
      relevant: false,
      fallbackCause: 'task_query_value_unproven',
      pageRegion: 'current_page_network',
      correlationScore: args.candidate.confidence,
    };
  }

  const taskQueryRelevance = evaluateTaskQueryRelevance(args.req, args.selectorContext);
  if (taskQueryRelevance.status === 'matched') {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'task_query_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }
  if (
    READ_SHAPED_TYPES.has(args.candidate.semanticType) &&
    responsePayloadMatchesCurrentTask(args.req, args.selectorContext)
  ) {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'task_query_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }
  if (
    args.contentAvailable &&
    isContentSourceCandidate(args.req) &&
    sameOriginAsCurrentPage(args.req, args.selectorContext)
  ) {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'content_source_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }
  if (
    args.contentAvailable &&
    isContentSourceCandidate(args.req) &&
    responsePayloadMatchesCurrentTask(args.req, args.selectorContext)
  ) {
    return {
      relevant: true,
      fallbackCause: '',
      pageRegion: 'content_source_network',
      correlationScore: Math.max(
        args.candidate.confidence,
        LIVE_OBSERVED_TASK_QUERY_RELEVANCE_FLOOR,
      ),
    };
  }
  return {
    relevant: false,
    fallbackCause:
      taskQueryRelevance.status === 'value_unproven'
        ? 'task_query_value_unproven'
        : args.selectorContext?.currentPageUrl
          ? 'relevance_unproven'
          : 'dom_region_correlation_missing',
    pageRegion: 'current_page_network',
    correlationScore: args.candidate.confidence,
  };
}

function sameOriginAsCurrentPage(
  req: CapturedNetworkRequest,
  selectorContext:
    | {
        currentPageUrl?: string | null;
      }
    | undefined,
): boolean {
  const currentUrl = parseUrl(selectorContext?.currentPageUrl ?? null);
  const requestUrl = parseUrl(req.url);
  if (!currentUrl || !requestUrl) return false;
  return currentUrl.origin === requestUrl.origin;
}

function responsePayloadMatchesCurrentTask(
  req: CapturedNetworkRequest,
  selectorContext:
    | {
        currentPageUrl?: string | null;
      }
    | undefined,
): boolean {
  const body = typeof req.responseBody === 'string' ? req.responseBody : null;
  const currentUrl = parseUrl(selectorContext?.currentPageUrl ?? null);
  if (!currentUrl) return false;
  const currentTerms = extractComparableSearchValues(currentUrl);
  if (currentTerms.length === 0) return false;
  const normalizedPayload = normalizeQueryValue(
    body ?? safeSummaryRowsComparableText(req.safeResponseSummary?.rows),
  );
  if (!normalizedPayload) return false;
  return currentTerms.some((term) => term.length >= 3 && normalizedPayload.includes(term));
}

function safeSummaryRowsComparableText(
  rows: readonly Record<string, unknown>[] | undefined,
): string {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const values: string[] = [];
  for (const row of rows.slice(0, LIVE_OBSERVED_ROW_LIMIT)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const value of Object.values(row)) {
      if (typeof value === 'string') values.push(value);
      else if (typeof value === 'number' || typeof value === 'boolean') values.push(String(value));
    }
  }
  return values.join(' ');
}

function sanitizeRegion(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type TaskQueryRelevance =
  | { status: 'matched' }
  | { status: 'value_unproven' }
  | { status: 'missing' };

function evaluateTaskQueryRelevance(
  req: CapturedNetworkRequest,
  selectorContext:
    | {
        currentPageUrl?: string | null;
        pageRole?: string | null;
        expectedTaskQueryKeys?: readonly string[];
      }
    | undefined,
): TaskQueryRelevance {
  const currentUrl = parseUrl(selectorContext?.currentPageUrl ?? null);
  const requestUrl = parseUrl(req.url);
  if (!currentUrl || !requestUrl) return { status: 'missing' };
  if (!hostLooksRelated(currentUrl.hostname, requestUrl.hostname)) return { status: 'missing' };

  const requestSearchValues = extractComparableSearchValues(requestUrl);
  const currentSearchValues = extractComparableSearchValues(currentUrl);
  if (requestSearchValues.length > 0 && currentSearchValues.length > 0) {
    return intersects(requestSearchValues, currentSearchValues)
      ? { status: 'matched' }
      : { status: 'value_unproven' };
  }

  const requestRelevant = filterRelevantKeys(extractQueryKeys(requestUrl));
  const currentRelevant = filterRelevantKeys(extractQueryKeys(currentUrl));
  const expectedTaskQueryKeys = filterRelevantKeys(
    normalizeKeys(selectorContext?.expectedTaskQueryKeys ?? []),
  );
  if (
    requestRelevant.length > 0 &&
    (currentRelevant.length > 0 || expectedTaskQueryKeys.length > 0)
  ) {
    return { status: 'value_unproven' };
  }

  const pagePathLooksLikeSearch = /(?:^|\/)(search|query|discover)(?:\/|$)/i.test(
    currentUrl.pathname,
  );
  const requestPathLooksLikeSearch = /(?:^|\/)(search|query|list)(?:\/|$)/i.test(
    requestUrl.pathname,
  );
  return pagePathLooksLikeSearch && requestPathLooksLikeSearch
    ? { status: 'value_unproven' }
    : { status: 'missing' };
}

function parseUrl(value: string | null | undefined): URL | null {
  if (!value || typeof value !== 'string') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function extractQueryKeys(url: URL): string[] {
  const keys: string[] = [];
  for (const key of url.searchParams.keys()) {
    keys.push(key.toLowerCase());
  }
  return Array.from(new Set(keys)).sort();
}

function normalizeKeys(values: readonly string[]): string[] {
  return Array.from(
    new Set(values.map((item) => item.trim().toLowerCase()).filter((item) => item.length > 0)),
  ).sort();
}

function extractComparableSearchValues(url: URL): string[] {
  const SEARCH_VALUE_KEYS = new Set(['q', 'query', 'search', 'keyword', 'keywords', 'term']);
  const values: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (!SEARCH_VALUE_KEYS.has(key.toLowerCase())) continue;
    const normalized = normalizeQueryValue(value);
    if (normalized.length > 0) values.push(normalized);
  }
  return Array.from(new Set(values)).sort();
}

function normalizeQueryValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hostLooksRelated(currentHost: string, requestHost: string): boolean {
  if (currentHost === requestHost) return true;
  return currentHost.endsWith(`.${requestHost}`) || requestHost.endsWith(`.${currentHost}`);
}

function filterRelevantKeys(keys: readonly string[]): string[] {
  const RELEVANT_KEYS = new Set([
    'q',
    'query',
    'search',
    'keyword',
    'keywords',
    'term',
    'filter',
    'sort',
    'order',
    'tag',
    'tags',
    'page',
    'cursor',
  ]);
  return keys.filter((key) => RELEVANT_KEYS.has(key));
}

function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(right);
  for (const item of left) {
    if (set.has(item)) return true;
  }
  return false;
}
