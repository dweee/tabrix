import { describe, expect, it } from 'vitest';

import { mergeCrossScrollObjects } from '@/entrypoints/background/tools/browser/cross-scroll-object-merge';

interface TestObject {
  key: string;
  label: string;
  firstSeenTop: number;
  confidence: number;
  fields: string[];
}

describe('mergeCrossScrollObjects', () => {
  it('deduplicates objects across scroll windows and lets callers merge richer observations', () => {
    const merged = mergeCrossScrollObjects<TestObject>({
      current: [
        {
          key: 'b',
          label: 'Second',
          firstSeenTop: 300,
          confidence: 0.6,
          fields: ['title'],
        },
        {
          key: 'a',
          label: 'First',
          firstSeenTop: 100,
          confidence: 0.7,
          fields: ['title'],
        },
      ],
      incoming: [
        {
          key: 'a',
          label: 'First enriched',
          firstSeenTop: 102,
          confidence: 0.9,
          fields: ['author', 'target'],
        },
        {
          key: '',
          label: 'No identity',
          firstSeenTop: 50,
          confidence: 1,
          fields: ['ignored'],
        },
        {
          key: 'c',
          label: 'Third',
          firstSeenTop: 500,
          confidence: 0.5,
          fields: ['title'],
        },
      ],
      limit: 2,
      keyOf: (item) => item.key,
      mergeDuplicate: (existing, incoming) => ({
        ...existing,
        label: existing.label,
        confidence: Math.max(existing.confidence, incoming.confidence),
        fields: [...new Set([...existing.fields, ...incoming.fields])],
      }),
      compare: (left, right) => left.firstSeenTop - right.firstSeenTop,
    });

    expect(merged).toEqual([
      {
        key: 'a',
        label: 'First',
        firstSeenTop: 100,
        confidence: 0.9,
        fields: ['title', 'author', 'target'],
      },
      {
        key: 'b',
        label: 'Second',
        firstSeenTop: 300,
        confidence: 0.6,
        fields: ['title'],
      },
    ]);
  });
});
