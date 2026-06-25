import {
  buildCloseTabsSuccessHygieneChecks,
  extractCloseTabsBrowserHygieneEvidence,
  readCloseTabsBrowserHygieneEvidenceFromPayload,
} from './close-tabs-hygiene-evidence';

const browserHygieneEvidence = {
  before: {
    tabCount: 4,
    windowCount: 2,
    focusedWindowId: 1,
    activeTabId: 12,
  },
  after: {
    tabCount: 3,
    windowCount: 2,
    focusedWindowId: 1,
    activeTabId: 12,
  },
  tabWindowBaselineUnchanged: true,
  activeTabRestored: true,
  activeTabRestoreReason: 'returned_to_previous_active_tab',
};

describe('close tabs hygiene evidence', () => {
  it('parses close-tabs browser hygiene evidence from a direct payload', () => {
    const parsed = readCloseTabsBrowserHygieneEvidenceFromPayload({ browserHygieneEvidence });

    expect(parsed).toEqual(browserHygieneEvidence);
  });

  it('parses close-tabs browser hygiene evidence from call-tool text content', () => {
    const parsed = extractCloseTabsBrowserHygieneEvidence({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ browserHygieneEvidence }),
        },
      ],
    });

    expect(parsed).toEqual(browserHygieneEvidence);
  });

  it('builds browser hygiene checks without depending on register-tools internals', () => {
    const checks = buildCloseTabsSuccessHygieneChecks(
      { closedTabIds: [99], invalidTabIds: [] },
      readCloseTabsBrowserHygieneEvidenceFromPayload({ browserHygieneEvidence }),
    );

    expect(checks).toEqual([
      {
        kind: 'tab_window_baseline',
        verdict: 'pass',
        reason: 'pre_post_tab_window_baseline_unchanged',
      },
      {
        kind: 'active_tab_restore',
        verdict: 'pass',
        reason: 'active_tab_restored',
      },
      {
        kind: 'run_owned_cleanup',
        verdict: 'pass',
        reason: 'run_owned_tabs_cleaned',
      },
      {
        kind: 'user_owned_protection',
        verdict: 'pass',
        reason: 'user_owned_tabs_protected',
      },
      {
        kind: 'failure_cleanup',
        verdict: 'pass',
        reason: 'failure_cleanup_not_needed',
      },
    ]);
  });

  it('ignores invalid or non-json tool content', () => {
    expect(
      extractCloseTabsBrowserHygieneEvidence({ content: [{ type: 'text', text: 'not-json' }] }),
    ).toBeNull();
    expect(
      readCloseTabsBrowserHygieneEvidenceFromPayload({ browserHygieneEvidence: {} }),
    ).toBeNull();
  });
});
