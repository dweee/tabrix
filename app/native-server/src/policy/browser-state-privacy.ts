const USER_AUTHORIZED_REDACTION_STATE = 'user_authorized';
const ROUTE_FACT_KEYS = new Set(['pageUrlPattern', 'rootRoute', 'currentRoute']);

export function allowsPersonalBrowserStateStorage(
  redactionState: string | null | undefined,
): boolean {
  return redactionState === USER_AUTHORIZED_REDACTION_STATE;
}

export function summarizeBrowserRouteForPrivacy(
  route: string | null | undefined,
  options: { allowPersonalBrowserStateStorage: boolean },
): string | null {
  const value = typeof route === 'string' ? route.trim() : '';
  if (!value) return null;
  if (options.allowPersonalBrowserStateStorage) return value;

  if (/^(file:|[a-z]:[\\/]|\/|null\/)/i.test(value)) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return `${parsed.origin}${parsed.pathname}`;
    }
    if (
      parsed.protocol === 'chrome:' ||
      parsed.protocol === 'edge:' ||
      parsed.protocol === 'about:'
    ) {
      return parsed.href;
    }
  } catch {
    return null;
  }
  return null;
}

export function summarizeBrowserObjectFactsForPrivacy(
  facts: Record<string, unknown> | null,
  options: { allowPersonalBrowserStateStorage: boolean },
): Record<string, unknown> | null {
  if (!facts) return null;
  const summary: Record<string, unknown> = { ...facts };
  for (const key of ROUTE_FACT_KEYS) {
    const value = summary[key];
    if (typeof value !== 'string') continue;
    const sanitized = summarizeBrowserRouteForPrivacy(value, options);
    if (sanitized) {
      summary[key] = sanitized;
    } else {
      delete summary[key];
    }
  }
  return summary;
}
