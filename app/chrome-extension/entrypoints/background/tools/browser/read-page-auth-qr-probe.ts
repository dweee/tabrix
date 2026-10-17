import type { ReadPageRegion, ReadPageRegionObject } from '@tabrix/shared';
import { AUTH_QR_EXPIRED_PATTERN } from './read-page-auth-guidance-copy';

export interface AuthQrArtifactCandidate {
  regionId: string;
  objectId: string;
  targetRef?: string;
  selector: string;
  width: number | null;
  height: number | null;
}

function selectCssLocator(object: ReadPageRegionObject): string | null {
  const locators = Array.isArray(object.locatorChain) ? object.locatorChain : [];
  const cssLocator = locators.find(
    (locator) => locator?.type === 'css' && typeof locator.value === 'string',
  );
  return cssLocator?.value?.trim() || null;
}

export function selectAuthQrArtifactCandidate(
  pageRegions: ReadPageRegion[] | undefined,
): AuthQrArtifactCandidate | null {
  return selectAuthQrArtifactCandidates(pageRegions, 1)[0] ?? null;
}

export function selectAuthQrArtifactCandidates(
  pageRegions: ReadPageRegion[] | undefined,
  limit = 3,
): AuthQrArtifactCandidate[] {
  const regions = Array.isArray(pageRegions) ? pageRegions : [];
  const hasAuthSurface = regions.some((region) => {
    if (region.regionType === 'modal') return true;
    if (region.regionType === 'account' && /logged_out|auth|login|登录/i.test(region.state)) {
      return true;
    }
    return /\bauth|login\b|登录|授权/i.test(
      `${region.regionId} ${region.state} ${region.label || ''}`,
    );
  });
  if (!hasAuthSurface) return [];

  const candidates: AuthQrArtifactCandidate[] = [];
  for (const region of regions) {
    if (region.regionType !== 'qr_code') continue;
    for (const object of region.objects || []) {
      const selector = selectCssLocator(object);
      const typeSignal = `${object.objectType || ''} ${object.label || ''} ${object.reason || ''}`;
      if (!selector || !/\bqr|qrcode|scan\b|二维码|扫码/i.test(typeSignal)) continue;
      candidates.push({
        regionId: region.regionId,
        objectId: object.objectId,
        targetRef: object.targetRef,
        selector,
        width: null,
        height: null,
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}

export function findAuthQrCandidateByTargetRef(
  candidates: AuthQrArtifactCandidate[],
  targetRef: string | undefined,
): AuthQrArtifactCandidate | null {
  if (!targetRef) return null;
  return candidates.find((candidate) => candidate.targetRef === targetRef) ?? null;
}

export function uniqueSelectors(selectors: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const selector of selectors) {
    const value = typeof selector === 'string' ? selector.trim() : '';
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function regionContainsExpiredQrSignal(region: ReadPageRegion): boolean {
  const haystack = [
    region.regionType,
    region.state,
    region.label,
    ...region.objects.flatMap((object) => [
      object.objectType,
      object.label,
      object.role,
      object.reason,
      object.primaryAction?.actionType,
      object.primaryAction?.toolArgs?.candidateAction?.intent,
      object.primaryAction?.toolArgs?.candidateAction?.matchReason,
    ]),
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ');
  return AUTH_QR_EXPIRED_PATTERN.test(haystack);
}

export function hasExpiredAuthQrSignal(pageRegions: ReadPageRegion[] | undefined): boolean {
  if (!Array.isArray(pageRegions)) return false;
  return pageRegions.some((region) => {
    const authScoped =
      region.regionType === 'qr_code' ||
      region.regionType === 'modal' ||
      region.regionType === 'form' ||
      /auth|login|logged_out|扫码|二维码|登录/i.test(`${region.state} ${region.label ?? ''}`);
    return authScoped && regionContainsExpiredQrSignal(region);
  });
}

export function hasObservedAuthSurfaceForQrExtraction(
  pageRegions: ReadPageRegion[] | undefined,
): boolean {
  if (!Array.isArray(pageRegions)) return false;
  return pageRegions.some((region) => {
    if (region.regionType === 'modal' || region.regionType === 'form') {
      return /\bauth|login|sign[ -]?in\b|登录|授权|扫码|二维码/i.test(
        `${region.regionId} ${region.state} ${region.label ?? ''}`,
      );
    }
    if (region.regionType === 'account') {
      return /logged_out|auth|login|sign[ -]?in|登录|授权/i.test(
        `${region.state} ${region.label ?? ''}`,
      );
    }
    if (region.regionType === 'qr_code') {
      return region.objects.some((object) =>
        /\bqr|qrcode|scan\b|二维码|扫码/i.test(
          `${object.objectType ?? ''} ${object.label ?? ''} ${object.reason ?? ''}`,
        ),
      );
    }
    return false;
  });
}

export function hasAuthScopedQrRegion(pageRegions: ReadPageRegion[] | undefined): boolean {
  return selectAuthQrArtifactCandidate(pageRegions) !== null;
}
