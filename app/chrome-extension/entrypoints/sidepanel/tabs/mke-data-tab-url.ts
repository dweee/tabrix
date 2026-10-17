export const MKE_DATA_TAB_IDS = ['memory', 'object', 'knowledge', 'experience'] as const;

export type MkeDataTabId = (typeof MKE_DATA_TAB_IDS)[number];

const TAB_ALIASES: Record<string, MkeDataTabId> = {
  experience: 'experience',
  experiences: 'experience',
  knowledge: 'knowledge',
  memory: 'memory',
  memories: 'memory',
  object: 'object',
  objects: 'object',
  'object-library': 'object',
  经验库: 'experience',
  对象库: 'object',
  知识库: 'knowledge',
  记忆库: 'memory',
};

export function resolveInitialMkeDataTab(input: {
  search?: string | null;
  hash?: string | null;
}): MkeDataTabId {
  return (
    normalizeTabCandidate(readQueryTab(input.search)) ??
    normalizeTabCandidate(readHashTab(input.hash)) ??
    'memory'
  );
}

export function resolveInitialMkeDataTabFromLocation(
  location: Pick<Location, 'search' | 'hash'> | undefined = globalThis.location,
): MkeDataTabId {
  return resolveInitialMkeDataTab({
    search: location?.search,
    hash: location?.hash,
  });
}

function readQueryTab(search: string | null | undefined): string | null {
  if (!search) return null;
  try {
    const params = new URLSearchParams(search);
    return params.get('mkeTab') ?? params.get('tab');
  } catch {
    return null;
  }
}

function readHashTab(hash: string | null | undefined): string | null {
  if (!hash) return null;
  const text = hash.replace(/^#/, '').trim();
  if (!text) return null;
  if (!text.includes('=') && !text.includes('&')) return text;
  try {
    const params = new URLSearchParams(text);
    return params.get('mkeTab') ?? params.get('tab');
  } catch {
    return null;
  }
}

function normalizeTabCandidate(value: string | null | undefined): MkeDataTabId | null {
  if (!value) return null;
  return TAB_ALIASES[value.trim().toLowerCase()] ?? null;
}
