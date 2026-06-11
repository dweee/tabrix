/**
 * Shared site identity contract.
 *
 * `siteId` / `siteFamily` values are product-facing routing tokens, not
 * display names and not URLs. Runtime parsers should normalize incoming
 * strings through `normalizeTabrixSiteId` before persisting or comparing them.
 */

export const MAX_TABRIX_SITE_ID_CHARS = 128;

export const TABRIX_SITE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,126}[a-z0-9])?$/;

export type SiteId = string;
export type SiteFamily = SiteId;

export type TabrixSiteId = SiteId;
export type TabrixSiteFamily = SiteFamily;

export function isTabrixSiteId(value: unknown): value is SiteId {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_TABRIX_SITE_ID_CHARS &&
    TABRIX_SITE_ID_PATTERN.test(value)
  );
}

export function normalizeTabrixSiteId(value: unknown): SiteId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return isTabrixSiteId(normalized) ? normalized : undefined;
}
