import { type ReadPageCDPSensingSummary } from '@tabrix/shared';
import {
  captureCDPPageSensingSnapshot,
  type CDPPageSensingSnapshot,
} from '@/utils/cdp-page-sensing';

export async function captureReadPageCDPSensingSummary(input: {
  tabId: number;
  currentUrl: string;
  supportedForContentScript: boolean;
}): Promise<CDPPageSensingSnapshot | undefined> {
  if (!input.supportedForContentScript || !/^https?:\/\//i.test(input.currentUrl)) {
    return undefined;
  }

  return captureCDPPageSensingSnapshot(input.tabId);
}

export function buildReadPageCDPSensingSummary(
  snapshot: CDPPageSensingSnapshot,
): ReadPageCDPSensingSummary | undefined {
  if (!snapshot.available) return undefined;

  return {
    source: 'cdp_page_sensing',
    available: true,
    readiness: snapshot.readiness,
    likelyLoading: snapshot.likelyLoading,
    ...(snapshot.route ? { route: snapshot.route } : {}),
    ...(snapshot.visibilityState ? { visibilityState: snapshot.visibilityState } : {}),
    ...(typeof snapshot.focused === 'boolean' ? { focused: snapshot.focused } : {}),
    ...(snapshot.activeElement ? { activeElement: snapshot.activeElement } : {}),
    ...(typeof snapshot.frameCount === 'number' ? { frameCount: snapshot.frameCount } : {}),
    ...(snapshot.navigation
      ? {
          navigation: {
            responseEndMs: snapshot.navigation.responseEndMs,
            domContentLoadedMs: snapshot.navigation.domContentLoadedMs,
            loadEventMs: snapshot.navigation.loadEventMs,
          },
        }
      : {}),
    ...(snapshot.networkActivity ? { networkActivity: snapshot.networkActivity } : {}),
    ...(snapshot.networkResources ? { networkResources: snapshot.networkResources } : {}),
    ...(snapshot.console ? { console: snapshot.console } : {}),
    ...(snapshot.accessibility ? { accessibility: snapshot.accessibility } : {}),
    ...(snapshot.partialErrors?.length ? { partialErrors: snapshot.partialErrors } : {}),
    claimBoundary:
      'cdp_page_sensing is read-only browser state evidence; it is not page-object completeness, action success, login success, or business success proof',
  };
}
