import type { ReadPageWindowRuntimeState } from '@tabrix/shared';

export function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

export function readSafeReuseRecord(
  value: Record<string, unknown> | null,
  allowedKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const safe: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    const item = value[key];
    if (item === null || item === undefined) continue;
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      Array.isArray(item) ||
      (typeof item === 'object' && item !== null)
    ) {
      safe[key] = item;
    }
  }
  return Object.keys(safe).length > 0 ? safe : undefined;
}

export function readFirstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readString(value);
    if (text) return text;
  }
  return null;
}

export function readUnknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function readBoolean(input: unknown, key: string): boolean | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === 'boolean' ? raw : null;
}

export function readNullableBoolean(input: unknown, key: string): boolean | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return typeof raw === 'boolean' ? raw : null;
}

export function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function clampUnitInterval(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function readNumericArray(input: unknown, key: string): number[] | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  if (!Array.isArray(raw)) return null;
  const values = raw.filter((value): value is number => Number.isInteger(value));
  return values.length > 0 ? values : null;
}

export function readPositiveInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) > 0 ? (raw as number) : null;
}

export function readInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) ? (raw as number) : null;
}

export function readNonNegativeInteger(input: unknown, key: string): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  return Number.isInteger(raw) && (raw as number) >= 0 ? (raw as number) : null;
}

export function readWindowRuntimeState(
  input: unknown,
  key: string,
): ReadPageWindowRuntimeState | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = (input as Record<string, unknown>)[key];
  if (
    raw === 'normal' ||
    raw === 'minimized' ||
    raw === 'maximized' ||
    raw === 'fullscreen' ||
    raw === 'docked' ||
    raw === 'unknown'
  ) {
    return raw;
  }
  return null;
}
