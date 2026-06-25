export function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readNestedObject(
  object: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  return object ? readObject(object[key]) : null;
}

export function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return null;
}

export function readNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  }
  return null;
}

export function readFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function readBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return null;
}

export function readActionabilityBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') continue;
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (
      normalized === 'actionable' ||
      normalized === 'available' ||
      normalized === 'enabled' ||
      normalized === 'target_ref' ||
      normalized === 'locator_chain'
    ) {
      return true;
    }
    if (
      normalized === 'not_actionable' ||
      normalized === 'unavailable' ||
      normalized === 'disabled' ||
      normalized === 'restricted' ||
      normalized === 'blocked' ||
      normalized === 'not_clickable' ||
      normalized === 'not_targetable'
    ) {
      return false;
    }
  }
  return null;
}

export function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
