import type {
  ReadPageObjectLifecycleChange,
  ReadPageObjectLifecycleFamily,
  ReadPageObjectLifecycleItem,
  ReadPageObjectLifecycleSummary,
  ReadPageRegion,
  ReadPageRegionObject,
  ReadPageRegionType,
} from './read-page-contract';

interface BuildObjectLifecycleOptions {
  previous?: ReadPageObjectLifecycleSummary | null;
}

const SINGLE_SNAPSHOT_BOUNDARY =
  'Object lifecycle is derived from one read_page snapshot; it is not proof of completion. Fresh before/after reads are required for state transitions.';

const COMPARED_SNAPSHOT_BOUNDARY =
  'Object lifecycle compares two read_page region snapshots. It proves only redacted region/object state changes, not login, logout, purchase, or other business completion.';

export function buildReadPageObjectLifecycle(
  pageRegions: readonly ReadPageRegion[],
  options: BuildObjectLifecycleOptions = {},
): ReadPageObjectLifecycleSummary {
  const items = flattenLifecycleItems(pageRegions);
  return compareReadPageObjectLifecycleItems(options.previous?.items ?? null, items);
}

export function compareReadPageObjectLifecycleSummaries(
  previous: ReadPageObjectLifecycleSummary | null | undefined,
  current: ReadPageObjectLifecycleSummary,
): ReadPageObjectLifecycleSummary {
  return compareReadPageObjectLifecycleItems(previous?.items ?? null, current.items);
}

function compareReadPageObjectLifecycleItems(
  previousItems: readonly ReadPageObjectLifecycleItem[] | null,
  currentItems: readonly ReadPageObjectLifecycleItem[],
): ReadPageObjectLifecycleSummary {
  const compared = Array.isArray(previousItems);
  const changes = compared ? buildLifecycleChanges(previousItems, currentItems) : [];
  const changedObjectCount = changes.filter((change) => change.changeKind !== 'unchanged').length;

  return {
    source: 'read_page_regions',
    status: compared ? 'compared_snapshot' : 'single_snapshot',
    objectCount: currentItems.length,
    changedObjectCount: compared ? changedObjectCount : 0,
    items: [...currentItems],
    changes,
    claimBoundary: compared ? COMPARED_SNAPSHOT_BOUNDARY : SINGLE_SNAPSHOT_BOUNDARY,
  };
}

function flattenLifecycleItems(
  pageRegions: readonly ReadPageRegion[],
): ReadPageObjectLifecycleItem[] {
  const items: ReadPageObjectLifecycleItem[] = [];
  for (const region of pageRegions) {
    items.push(regionLifecycleItem(region));
    for (const object of region.objects) {
      items.push(objectLifecycleItem(region, object));
    }
  }
  return dedupeByObjectKey(items);
}

function regionLifecycleItem(region: ReadPageRegion): ReadPageObjectLifecycleItem {
  return {
    objectKey: `region:${region.regionType}:${stablePart(region.regionId)}`,
    regionId: region.regionId,
    regionType: region.regionType,
    objectFamily: familyForRegion(region.regionType),
    state: region.state || 'unknown',
    targetability: region.targetability,
    actionTypes: [],
    candidateActionIds: [...region.candidateActionIds],
    evidenceRefs: [...region.candidateActionIds],
    confidence: clampConfidence(region.confidence),
    claimBoundary: `Region-level ${region.regionType} object candidate; ${region.claimBoundary}`,
  };
}

function objectLifecycleItem(
  region: ReadPageRegion,
  object: ReadPageRegionObject,
): ReadPageObjectLifecycleItem {
  const evidenceRefs = [
    safePublicRef(object.targetRef),
    ...(object.locatorChain?.map((item) => `locator:${item.type}`) ?? []),
    ...region.candidateActionIds,
  ].filter((item): item is string => Boolean(item));
  const objectId = safePublicRef(object.objectId);

  return {
    objectKey: `object:${region.regionType}:${stableObjectKey(object.targetRef || object.objectId)}`,
    regionId: region.regionId,
    regionType: region.regionType,
    ...(objectId ? { objectId } : {}),
    objectFamily: familyForObject(region.regionType, object),
    objectType: object.objectType ? String(object.objectType) : undefined,
    state: region.state || 'unknown',
    targetability: object.targetability,
    actionTypes: [...object.actionTypes],
    candidateActionIds: [...region.candidateActionIds],
    evidenceRefs,
    confidence: clampConfidence(Math.min(region.confidence, object.confidence)),
    claimBoundary:
      'Redacted browser object candidate derived from visible region evidence; raw labels, account identity, QR payloads, and private text are not carried.',
  };
}

function buildLifecycleChanges(
  previousItems: readonly ReadPageObjectLifecycleItem[],
  currentItems: readonly ReadPageObjectLifecycleItem[],
): ReadPageObjectLifecycleChange[] {
  const previousByKey = new Map(previousItems.map((item) => [item.objectKey, item]));
  const currentByKey = new Map(currentItems.map((item) => [item.objectKey, item]));
  const keys = new Set([...previousByKey.keys(), ...currentByKey.keys()]);
  const changes: ReadPageObjectLifecycleChange[] = [];

  for (const key of keys) {
    const before = previousByKey.get(key);
    const after = currentByKey.get(key);
    const representative = after ?? before;
    if (!representative) continue;

    changes.push({
      objectKey: key,
      objectFamily: representative.objectFamily,
      regionType: representative.regionType,
      beforeState: before?.state,
      afterState: after?.state,
      changeKind: lifecycleChangeKind(before, after),
      claimBoundary: COMPARED_SNAPSHOT_BOUNDARY,
    });
  }

  return changes.sort((a, b) => a.objectKey.localeCompare(b.objectKey));
}

function lifecycleChangeKind(
  before: ReadPageObjectLifecycleItem | undefined,
  after: ReadPageObjectLifecycleItem | undefined,
): ReadPageObjectLifecycleChange['changeKind'] {
  if (!before && after) return 'appeared';
  if (before && !after) return 'disappeared';
  if (!before || !after) return 'unknown';
  if (signatureForLifecycleItem(before) !== signatureForLifecycleItem(after)) return 'changed';
  return 'unchanged';
}

function signatureForLifecycleItem(item: ReadPageObjectLifecycleItem): string {
  return JSON.stringify({
    family: item.objectFamily,
    regionType: item.regionType,
    state: item.state,
    targetability: item.targetability,
    actionTypes: [...item.actionTypes].sort(),
    candidateActionIds: [...item.candidateActionIds].sort(),
  });
}

function familyForObject(
  regionType: ReadPageRegionType,
  object: ReadPageRegionObject,
): ReadPageObjectLifecycleFamily {
  const objectType = String(object.objectType || '').toLowerCase();
  if (regionType === 'content') return 'content_collection';
  if (
    regionType === 'qr_code' ||
    ((regionType === 'modal' || regionType === 'form') && objectType.includes('qr'))
  ) {
    return 'qr_code';
  }
  if (regionType === 'modal' || object.menuItemRole === 'auth_entry') return 'auth_surface';
  if (regionType === 'account' || object.menuItemRole === 'account_entry')
    return 'account_identity';
  if (regionType === 'menu' && object.menuItemRole === 'overflow_menu_trigger')
    return 'menu_surface';
  if (regionType === 'menu' || regionType === 'navigation') return 'menu_item';
  if (regionType === 'form') return 'form_control';
  if (regionType === 'feedback') return 'feedback_surface';
  return 'unknown';
}

function familyForRegion(regionType: ReadPageRegionType): ReadPageObjectLifecycleFamily {
  switch (regionType) {
    case 'qr_code':
      return 'qr_code';
    case 'modal':
      return 'auth_surface';
    case 'account':
      return 'account_identity';
    case 'menu':
      return 'menu_surface';
    case 'navigation':
      return 'menu_item';
    case 'form':
      return 'form_control';
    case 'feedback':
      return 'feedback_surface';
    case 'content':
      return 'content_collection';
    default:
      return 'unknown';
  }
}

function stablePart(value: string | undefined): string {
  const raw = String(value || 'unknown').trim();
  return raw.replace(/[^a-zA-Z0-9:_-]/g, '_').slice(0, 80) || 'unknown';
}

function stableObjectKey(value: string | undefined): string {
  const raw = String(value || 'unknown').trim();
  const publicRef = safePublicRef(raw);
  if (publicRef) return stablePart(publicRef);
  return `anon_${simpleHash(raw || 'unknown')}`;
}

function safePublicRef(value: string | undefined): string | undefined {
  const raw = String(value || '').trim();
  if (/^(ref_|tgt_|ca_)[a-zA-Z0-9:_-]+$/.test(raw)) return raw;
  if (/^region_[a-zA-Z0-9:_-]+$/.test(raw)) return raw;
  return undefined;
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function dedupeByObjectKey(
  items: readonly ReadPageObjectLifecycleItem[],
): ReadPageObjectLifecycleItem[] {
  const seen = new Set<string>();
  const deduped: ReadPageObjectLifecycleItem[] = [];
  for (const item of items) {
    if (seen.has(item.objectKey)) continue;
    seen.add(item.objectKey);
    deduped.push(item);
  }
  return deduped;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Number(Math.min(1, Math.max(0, value)).toFixed(3));
}
