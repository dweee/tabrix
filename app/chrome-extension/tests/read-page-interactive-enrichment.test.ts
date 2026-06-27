import { describe, expect, it } from 'vitest';

import {
  attachInteractiveRects,
  attachInteractiveValueState,
} from '../entrypoints/background/tools/browser/read-page-interactive-enrichment';

describe('read-page interactive enrichment', () => {
  it('attaches finite rects by ref and ignores malformed entries', () => {
    const elements = [
      { ref: 'ref_a', name: 'A' },
      { ref: 'ref_b', name: 'B', rect: { x: 9, y: 9, width: 9, height: 9 } },
      { ref: 'ref_c', name: 'C' },
    ];

    expect(
      attachInteractiveRects(elements, [
        { ref: ' ref_a ', rect: { x: 1, y: 2, width: 3, height: 4 } },
        { ref: 'ref_b', rect: { x: Number.NaN, y: 2, width: 3, height: 4 } },
        { ref: 'ref_c', rect: null },
      ]),
    ).toEqual([
      { ref: 'ref_a', name: 'A', rect: { x: 1, y: 2, width: 3, height: 4 } },
      { ref: 'ref_b', name: 'B', rect: { x: 9, y: 9, width: 9, height: 9 } },
      { ref: 'ref_c', name: 'C' },
    ]);
  });

  it('attaches value state by ref without overwriting existing states', () => {
    const elements = [
      { ref: 'ref_empty', name: 'Empty' },
      { ref: 'ref_filled', name: 'Filled' },
      { ref: 'ref_existing', name: 'Existing', valueState: 'unknown' as const },
      { ref: 'ref_missing', name: 'Missing' },
    ];

    expect(
      attachInteractiveValueState(elements, [
        { ref: 'ref_empty', value: '' },
        { ref: 'ref_filled', currentValue: 'hello' },
        { ref: 'ref_existing', valueState: 'non_empty' },
        { ref: 'ref_missing' },
      ]),
    ).toEqual([
      { ref: 'ref_empty', name: 'Empty', valueState: 'empty' },
      { ref: 'ref_filled', name: 'Filled', valueState: 'non_empty' },
      { ref: 'ref_existing', name: 'Existing', valueState: 'unknown' },
      { ref: 'ref_missing', name: 'Missing' },
    ]);
  });
});
