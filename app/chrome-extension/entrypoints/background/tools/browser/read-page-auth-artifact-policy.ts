import type { BrowserPageOwnerType, ReadPageAuthArtifactStatus } from '@tabrix/shared';
import type { BrowserWorldTabObject } from '../../browser-world-inventory';
import { AUTH_QR_CLAIM_BOUNDARY } from './read-page-auth-guidance-copy';

export function buildNotRequestedAuthArtifactStatus(): ReadPageAuthArtifactStatus {
  return {
    requested: false,
    status: 'not_requested',
    reason: 'includeAuthArtifacts_false',
    claimBoundary: AUTH_QR_CLAIM_BOUNDARY,
  };
}

export function ownerTypeFromBrowserWorldTab(
  tab: Pick<BrowserWorldTabObject, 'openedBy'> | null,
): BrowserPageOwnerType | 'unknown' {
  if (tab?.openedBy === 'ai') return 'run_owned';
  if (tab?.openedBy === 'user_or_page') return 'user_owned';
  return 'unknown';
}

export function canExtractAuthArtifactForTab(tab: BrowserWorldTabObject | null): {
  allowed: boolean;
  ownerType: BrowserPageOwnerType | 'unknown';
  reason: string;
} {
  const ownerType = ownerTypeFromBrowserWorldTab(tab);
  if (!tab) {
    return {
      allowed: false,
      ownerType,
      reason: 'browser_world_tab_unknown',
    };
  }
  if (tab.openedBy !== 'ai') {
    return {
      allowed: false,
      ownerType,
      reason: 'current_tab_not_ai_owned_for_auth_artifact',
    };
  }
  if (tab.canTabrixOperate === false) {
    return {
      allowed: false,
      ownerType,
      reason: tab.operabilityReason || 'current_tab_not_operable_for_auth_artifact',
    };
  }
  return {
    allowed: true,
    ownerType,
    reason: 'ai_owned_tab_auth_artifact_allowed',
  };
}
