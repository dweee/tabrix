export function normalizePageRoleForMemory(value: string | null): string | null {
  if (value === 'search_list') return 'search_results';
  return value;
}

export function objectFingerprint(...parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => (part === null || part === undefined || part === '' ? 'unknown' : String(part)))
    .join(':');
}

export function pageObjectIdentityRoute(...values: Array<string | null | undefined>): string {
  return (
    values.find((value): value is string => typeof value === 'string' && value.length > 0) ??
    'unknown'
  );
}

export function normalizeOwnerType(value: string | null): string | null {
  if (!value) return null;
  if (value === 'ai' || value === 'run_owned') return 'ai';
  if (value === 'user_or_page' || value === 'user_owned' || value === 'page_opener') {
    return 'user_or_page';
  }
  return 'unknown';
}

export function sourceTraceIds(trace: { traceId?: string | null }): string[] {
  return trace.traceId ? [trace.traceId] : [];
}
