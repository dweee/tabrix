export interface CrossScrollObjectMergeInput<T> {
  current: readonly T[];
  incoming: readonly T[];
  limit: number;
  keyOf(item: T): string;
  mergeDuplicate(existing: T, incoming: T): T;
  compare?(left: T, right: T): number;
}

export function mergeCrossScrollObjects<T>(input: CrossScrollObjectMergeInput<T>): T[] {
  const byKey = new Map<string, T>();
  for (const item of [...input.current, ...input.incoming]) {
    const key = input.keyOf(item).trim();
    if (!key) continue;
    const existing = byKey.get(key);
    byKey.set(key, existing ? input.mergeDuplicate(existing, item) : item);
  }

  const merged = [...byKey.values()];
  if (input.compare) {
    merged.sort(input.compare);
  }
  return merged.slice(0, Math.max(0, Math.trunc(input.limit)));
}
