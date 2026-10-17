type InteractiveRect = { x: number; y: number; width: number; height: number };
type InteractiveValueState = 'empty' | 'non_empty' | 'unknown';

export function attachInteractiveRects<T extends { ref?: string; rect?: unknown }>(
  elements: T[],
  refMap: unknown[],
): T[] {
  const rectByRef = new Map<string, InteractiveRect>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const object = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const ref = typeof object?.ref === 'string' ? object.ref.trim() : '';
    const rect =
      object?.rect && typeof object.rect === 'object'
        ? (object.rect as Record<string, unknown>)
        : null;
    if (
      !ref ||
      !rect ||
      !Number.isFinite(rect.x) ||
      !Number.isFinite(rect.y) ||
      !Number.isFinite(rect.width) ||
      !Number.isFinite(rect.height)
    ) {
      continue;
    }
    rectByRef.set(ref, {
      x: Number(rect.x),
      y: Number(rect.y),
      width: Number(rect.width),
      height: Number(rect.height),
    });
  }
  if (rectByRef.size === 0) return elements;
  return elements.map((element) => {
    const rect = element.ref ? rectByRef.get(element.ref) : undefined;
    return rect ? { ...element, rect } : element;
  });
}

export function attachInteractiveValueState<
  T extends { ref?: string; valueState?: InteractiveValueState },
>(elements: T[], refMap: unknown[]): T[] {
  const valueStateByRef = new Map<string, InteractiveValueState>();
  for (const entry of Array.isArray(refMap) ? refMap : []) {
    const object = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : null;
    const ref = typeof object?.ref === 'string' ? object.ref.trim() : '';
    if (!ref || !object) continue;
    if (
      object?.valueState === 'empty' ||
      object?.valueState === 'non_empty' ||
      object?.valueState === 'unknown'
    ) {
      valueStateByRef.set(ref, object.valueState);
      continue;
    }
    const rawValue =
      Object.prototype.hasOwnProperty.call(object, 'value') ||
      Object.prototype.hasOwnProperty.call(object, 'currentValue')
        ? (object.value ?? object.currentValue)
        : undefined;
    if (rawValue === undefined || rawValue === null) continue;
    valueStateByRef.set(ref, String(rawValue).length > 0 ? 'non_empty' : 'empty');
  }
  if (valueStateByRef.size === 0) return elements;
  return elements.map((element) => {
    if (!element.ref || element.valueState) return element;
    const valueState = valueStateByRef.get(element.ref);
    return valueState ? { ...element, valueState } : element;
  });
}
