import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetStableTargetRefRegistryForTests,
  getStableTargetRefRegistrySnapshot,
  lookupCandidateActionTargetLocatorEntry,
  lookupStableTargetRef,
  recordCandidateActionTargetLocatorsSnapshot,
  recordStableTargetRefSnapshot,
  clearStableTargetRefTab,
} from '@/entrypoints/background/tools/browser/stable-target-ref-registry';

describe('B-011 stable-targetRef registry', () => {
  beforeEach(() => {
    __resetStableTargetRefRegistryForTests();
  });

  it('records and looks up entries by tab', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('keeps tabs isolated', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_other' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupStableTargetRef(8, 'tgt_aaaaaaaaaa')).toBe('ref_other');
  });

  it('replaces the snapshot for a tab on each record call', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('drops the tab when given an empty list', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(7, []);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(getStableTargetRefRegistrySnapshot().tabIds).not.toContain(7);
  });

  it('clearTab removes only the requested tab', () => {
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordStableTargetRefSnapshot(8, [{ targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' }]);
    clearStableTargetRefTab(7);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(8, 'tgt_bbbbbbbbbb')).toBe('ref_b');
  });

  it('returns undefined for unknown tabs / refs / invalid args', () => {
    expect(lookupStableTargetRef(7, 'tgt_nope')).toBeUndefined();
    expect(lookupStableTargetRef(undefined as any, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(NaN, 'tgt_aaaaaaaaaa')).toBeUndefined();
    expect(lookupStableTargetRef(7, '')).toBeUndefined();
  });

  it('first write wins when multiple entries share the same targetRef', () => {
    recordStableTargetRefSnapshot(7, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_first' },
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_second' },
    ]);
    expect(lookupStableTargetRef(7, 'tgt_aaaaaaaaaa')).toBe('ref_first');
  });

  it('snapshot reports tab counts deterministically', () => {
    recordStableTargetRefSnapshot(8, [
      { targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' },
      { targetRef: 'tgt_bbbbbbbbbb', ref: 'ref_b' },
    ]);
    recordStableTargetRefSnapshot(7, [{ targetRef: 'tgt_cccccccccc', ref: 'ref_c' }]);
    const snap = getStableTargetRefRegistrySnapshot();
    expect(snap.tabIds).toEqual([7, 8]);
    expect(snap.entryCounts[7]).toBe(1);
    expect(snap.entryCounts[8]).toBe(2);
  });

  it('records and looks up candidate action locators by tab', () => {
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
      { targetRef: 'ref_fallback_2', selector: 'button[data-action="publish"]', frameId: 3 },
    ]);

    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toMatchObject({
      targetRef: 'ref_fallback_1',
      selector: 'nav a[href="/live"]',
      selectorType: 'css',
    });
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_2')).toMatchObject({
      targetRef: 'ref_fallback_2',
      selector: 'button[data-action="publish"]',
      selectorType: 'css',
      frameId: 3,
    });
  });

  it('replaces candidate action locator snapshot independently from stable refs', () => {
    recordStableTargetRefSnapshot(9, [{ targetRef: 'tgt_aaaaaaaaaa', ref: 'ref_a' }]);
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
    ]);
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_2', selector: 'button[data-action="publish"]' },
    ]);

    expect(lookupStableTargetRef(9, 'tgt_aaaaaaaaaa')).toBe('ref_a');
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toBeUndefined();
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_2')).toMatchObject({
      selector: 'button[data-action="publish"]',
    });
  });

  it('clearTab removes candidate action locators too', () => {
    recordCandidateActionTargetLocatorsSnapshot(9, [
      { targetRef: 'ref_fallback_1', selector: 'nav a[href="/live"]' },
    ]);
    clearStableTargetRefTab(9);
    expect(lookupCandidateActionTargetLocatorEntry(9, 'ref_fallback_1')).toBeUndefined();
  });
});
