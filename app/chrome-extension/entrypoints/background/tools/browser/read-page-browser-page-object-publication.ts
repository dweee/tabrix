import {
  buildReadPageBrowserPageObjectView,
  type ReadPageBrowserPageObjectView,
  type ReadPageCompactSnapshot,
  type ReadPageMode,
} from '@tabrix/shared';

import { buildBoundedWatchLoopSnapshot } from './read-page-object-delta';

type BrowserPageObjectPublicationParams = {
  tabId: number;
  currentUrl: string;
  mode: ReadPageMode;
  pageRegions: ReadPageCompactSnapshot['pageRegions'];
  pageOperationMap: ReadPageCompactSnapshot['pageOperationMap'];
  objectLifecycle: NonNullable<ReadPageCompactSnapshot['objectLifecycle']>;
  pageProjection: NonNullable<ReadPageCompactSnapshot['pageProjection']>;
  ownershipRuntime: NonNullable<ReadPageCompactSnapshot['ownershipRuntime']>;
  selectedDataSource: ReadPageCompactSnapshot['selectedDataSource'];
  publishFormReadiness: ReadPageCompactSnapshot['publishFormReadiness'];
};

export type BrowserPageObjectPublication = {
  objectLifecycle: NonNullable<ReadPageCompactSnapshot['objectLifecycle']>;
  browserPageObjectCompact: ReadPageCompactSnapshot['browserPageObjectCompact'];
  browserPageObject?: ReadPageBrowserPageObjectView;
  browserPageObjectForAuth: ReadPageBrowserPageObjectView;
};

export function buildBrowserPageObjectPublication(
  params: BrowserPageObjectPublicationParams,
): BrowserPageObjectPublication {
  const watchLoopSnapshot = buildBoundedWatchLoopSnapshot({
    tabId: params.tabId,
    url: params.currentUrl,
    pageRegions: params.pageRegions,
    lifecycle: params.objectLifecycle,
    pageProjection: params.pageProjection,
    ownershipRuntime: params.ownershipRuntime,
  });
  const browserPageObject = buildReadPageBrowserPageObjectView({
    pageRegions: params.pageRegions,
    pageOperationMap: params.pageOperationMap,
    objectLifecycle: watchLoopSnapshot.objectLifecycle,
    previousPageProjection: watchLoopSnapshot.previousPageProjection,
    pageProjection: params.pageProjection,
    previousOwnershipRuntime: watchLoopSnapshot.previousOwnershipRuntime,
    ownershipRuntime: params.ownershipRuntime,
    selectedDataSource: params.selectedDataSource,
    publishFormReadiness: params.publishFormReadiness,
    sourceRouteHonestyVerdict: null,
  });

  return {
    objectLifecycle: watchLoopSnapshot.objectLifecycle,
    browserPageObjectCompact: browserPageObject.compact,
    ...(params.mode === 'compact' ? {} : { browserPageObject }),
    browserPageObjectForAuth: browserPageObject,
  };
}
