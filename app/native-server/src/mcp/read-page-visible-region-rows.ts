import type { TaskVisibleRegionRowsData } from '../execution/task-session-context';

import {
  readNumber,
  readObject,
  readPositiveInteger,
  readString,
  readStringArray,
} from './register-tool-value-readers';

export function buildAutoTabTaskContextKey(tabId: number): string {
  return `mcp:auto:tab:${tabId}`;
}

export function extractVisibleRegionRowsDataFromPayload(
  payload: Record<string, unknown> | null,
): TaskVisibleRegionRowsData | null {
  if (!payload) return null;
  const rowsPayload = readObject(payload.visibleRegionRows) ?? payload;
  const rawRows = Array.isArray(rowsPayload.rows)
    ? rowsPayload.rows
    : Array.isArray(payload.rows)
      ? payload.rows
      : [];
  if (rawRows.length === 0) return null;

  const rowCount =
    readPositiveInteger(payload, 'rowCount') ??
    readPositiveInteger(payload, 'visibleRegionRowCount') ??
    readPositiveInteger(rowsPayload, 'rowCount') ??
    rawRows.length;
  const sourceRegion =
    readString(rowsPayload.sourceRegion) ?? readString(payload.sourceRegion) ?? 'unknown';
  const targetableRows = rawRows
    .map((row) => readObject(row))
    .filter((row): row is Record<string, unknown> => row !== null)
    .map((row, index) => {
      const n = index + 1;
      return {
        rowId: readString(row.rowId) ?? `row_${n}`,
        title: readString(row.title) ?? readString(row.label) ?? `Result ${n}`,
        primaryText: readString(row.primaryText),
        secondaryText: readString(row.secondaryText),
        metaText: readString(row.metaText),
        interactionText: readString(row.interactionText),
        targetRef: readString(row.targetRef),
        visibleTextFields: readStringArray(row.visibleTextFields),
        qualityReasons: readStringArray(row.qualityReasons),
        sourceRegion: readString(row.sourceRegion) ?? sourceRegion,
        confidence: readNumber(row.confidence) ?? 0.7,
      };
    });
  if (targetableRows.length === 0) return null;

  const targetRefCoverageRate =
    readNumber(payload.targetRefCoverageRate) ??
    readNumber(rowsPayload.targetRefCoverageRate) ??
    targetableRows.filter((row) => row.targetRef).length / targetableRows.length;
  const rowExtractionConfidence =
    readNumber(payload.rowExtractionConfidence) ??
    readNumber(rowsPayload.rowExtractionConfidence) ??
    readNumber(rowsPayload.confidence) ??
    0.8;
  const regionQualityScore =
    readNumber(payload.regionQualityScore) ?? readNumber(rowsPayload.regionQualityScore) ?? 0.8;

  return {
    sourceDataSource: 'dom_region_rows',
    available: true,
    rowCount,
    confidence: readNumber(rowsPayload.confidence) ?? rowExtractionConfidence,
    targetRefCoverageRate,
    regionQualityScore,
    sourceTabId:
      readPositiveInteger(payload, 'sourceTabId') ??
      readPositiveInteger(rowsPayload, 'sourceTabId') ??
      readPositiveInteger(readObject(payload.pageProjection) ?? {}, 'tabId'),
    rows: targetableRows,
    visibleRegionRowsUsed:
      payload.visibleRegionRowsUsed === true || rowsPayload.visibleRegionRowsUsed === true,
    visibleRegionRowsRejectedReason: readString(payload.visibleRegionRowsRejectedReason),
    sourceRegion,
    rowExtractionConfidence,
    cardExtractorUsed: payload.cardExtractorUsed === true || rowsPayload.cardExtractorUsed === true,
    cardPatternConfidence:
      readNumber(payload.cardPatternConfidence) ??
      readNumber(rowsPayload.cardPatternConfidence) ??
      0,
    cardRowsCount:
      readPositiveInteger(payload, 'cardRowsCount') ??
      readPositiveInteger(rowsPayload, 'cardRowsCount') ??
      targetableRows.length,
    rowOrder: 'visual_order',
  };
}
