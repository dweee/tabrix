import { normalizeUrlPattern } from './mke-memory-sanitizer';
import { readBoolean, readString } from './mke-memory-value-readers';

export interface BrowserWorldTabProjection {
  tab: Record<string, unknown>;
  tabId: number;
  windowId: number | null;
  urlFields: ReturnType<typeof normalizeUrlPattern>;
}

export function browserPageObjectKey(tab: BrowserWorldTabProjection): string {
  return (
    tab.urlFields.rootRoute ??
    tab.urlFields.currentRoute ??
    tab.urlFields.pattern ??
    String(tab.tabId)
  );
}

export function browserWorldTabRank(tab: BrowserWorldTabProjection): number {
  if (readBoolean(tab.tab.active) === true) return 0;
  if (readString(tab.tab.status) === 'loading') return 2;
  if (readBoolean(tab.tab.canTabrixOperate) === false) return 3;
  return 1;
}

export function chooseRepresentativeBrowserWorldTab(
  current: BrowserWorldTabProjection,
  candidate: BrowserWorldTabProjection,
): BrowserWorldTabProjection {
  const currentRank = browserWorldTabRank(current);
  const candidateRank = browserWorldTabRank(candidate);
  if (candidateRank !== currentRank) return candidateRank < currentRank ? candidate : current;
  return candidate.tabId > current.tabId ? candidate : current;
}
