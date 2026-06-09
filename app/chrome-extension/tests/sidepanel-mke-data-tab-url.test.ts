import { describe, expect, it } from 'vitest';

import {
  resolveInitialMkeDataTab,
  resolveInitialMkeDataTabFromLocation,
} from '@/entrypoints/sidepanel/tabs/mke-data-tab-url';

describe('MKE data tab URL entry', () => {
  it('defaults to Memory when no extension-internal tab hint is present', () => {
    expect(resolveInitialMkeDataTab({ search: '', hash: '' })).toBe('memory');
  });

  it('selects Object Library from query params for non-P3 screenshot validation', () => {
    expect(resolveInitialMkeDataTab({ search: '?mkeTab=object', hash: '' })).toBe('object');
    expect(resolveInitialMkeDataTab({ search: '?tab=object-library', hash: '' })).toBe('object');
    expect(resolveInitialMkeDataTab({ search: '?tab=%E5%AF%B9%E8%B1%A1%E5%BA%93', hash: '' })).toBe(
      'object',
    );
  });

  it('supports hash-only selection without requiring a click target', () => {
    expect(resolveInitialMkeDataTab({ search: '', hash: '#knowledge' })).toBe('knowledge');
    expect(resolveInitialMkeDataTab({ search: '', hash: '#tab=experience' })).toBe('experience');
    expect(resolveInitialMkeDataTab({ search: '', hash: '#mkeTab=objects' })).toBe('object');
  });

  it('keeps query params authoritative and falls back safely for unknown values', () => {
    expect(resolveInitialMkeDataTab({ search: '?mkeTab=object', hash: '#memory' })).toBe('object');
    expect(resolveInitialMkeDataTab({ search: '?mkeTab=not-a-tab', hash: '#object' })).toBe(
      'object',
    );
    expect(resolveInitialMkeDataTab({ search: '?mkeTab=not-a-tab', hash: '#also-nope' })).toBe(
      'memory',
    );
  });

  it('can read the current jsdom location without replacing window.location', () => {
    window.history.replaceState(null, '', '/sidepanel.html?mkeTab=object');
    try {
      expect(resolveInitialMkeDataTabFromLocation()).toBe('object');
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
