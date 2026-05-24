import { describe, expect, it } from 'vitest';
import { extractVisibleRegionRows } from '@/entrypoints/background/tools/browser/visible-region-rows';

describe('visible region rows', () => {
  it('extracts repeated generic search result cards into visible region rows', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- main "Search results for workflow" [ref=ref_main] (x=640,y=370)',
        '  - listitem "Result" [ref=ref_result_1] (x=280,y=160)',
        '    - link "Workflow planning guide for distributed teams" [ref=ref_result_1_link] (x=280,y=150) href="/items/workflow-planning"',
        '    - generic "Practical steps for coordinating browser tasks across reviewers." [ref=ref_result_1_desc] (x=280,y=186)',
        '    - generic "Updated today" [ref=ref_result_1_meta] (x=280,y=224)',
        '  - listitem "Result" [ref=ref_result_2] (x=280,y=270)',
        '    - link "Operations checklist for reliable browser handoffs" [ref=ref_result_2_link] (x=280,y=260) href="/items/browser-handoffs"',
        '    - generic "A field checklist for keeping evidence, ownership, and actions aligned." [ref=ref_result_2_desc] (x=280,y=296)',
        '    - generic "Updated yesterday" [ref=ref_result_2_meta] (x=280,y=334)',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.sourceRegion).toBe('search_results');
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Workflow planning guide for distributed teams',
      'Operations checklist for reliable browser handoffs',
    ]);
    expect(rows.rows.every((row) => row.targetRef)).toBe(true);
    expect(rows.targetRefCoverageRate).toBeGreaterThanOrEqual(0.95);
  });

  it('does not promote shell-only search controls into result rows', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- banner "Site header" [ref=ref_banner] (x=640,y=40)',
        '  - link "Home" [ref=ref_home] (x=40,y=40) href="/"',
        '- search "Search controls" [ref=ref_search] (x=420,y=96)',
        '  - searchbox "Search query" [ref=ref_query] (x=420,y=96)',
        '  - button "Search" [ref=ref_search_button] (x=760,y=96)',
        '- navigation "Result filters" [ref=ref_filters] (x=220,y=160)',
        '  - button "All" [ref=ref_all] (x=220,y=160)',
        '  - button "Recent" [ref=ref_recent] (x=280,y=160)',
        '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
        '  - link "Privacy" [ref=ref_privacy] (x=600,y=680) href="/privacy"',
        '  - link "Terms" [ref=ref_terms] (x=680,y=680) href="/terms"',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.rows).toEqual([]);
    expect(rows.visibleRegionRowsRejectedReason).toMatch(
      /footer_like_region|navigation_like_region|low_value_region/,
    );
  });

  it('recovers repeated result rows from body-visible text when the tree is shell-only', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- banner "Site header" [ref=ref_banner] (x=640,y=40)',
        '  - link "Home" [ref=ref_home] (x=40,y=40) href="/"',
        '- search "Search controls" [ref=ref_search] (x=420,y=96)',
        '  - searchbox "Search query" [ref=ref_query] (x=420,y=96)',
        '  - button "Search" [ref=ref_search_button] (x=760,y=96)',
        '- navigation "Result filters" [ref=ref_filters] (x=220,y=160)',
        '  - button "All" [ref=ref_all] (x=220,y=160)',
        '  - button "Recent" [ref=ref_recent] (x=280,y=160)',
        '- footer "Footer" [ref=ref_footer] (x=640,y=680)',
      ].join('\n'),
      visibleTextContent: [
        'Search results for workflow',
        'Workflow planning guide for distributed teams',
        'Practical steps for coordinating browser tasks across reviewers.',
        'Updated today',
        'Operations checklist for reliable browser handoffs',
        'A field checklist for keeping evidence, ownership, and actions aligned.',
        'Updated yesterday',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.rowCount).toBe(2);
    expect(rows.sourceRegion).toBe('visible_text');
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Workflow planning guide for distributed teams',
      'Operations checklist for reliable browser handoffs',
    ]);
    expect(rows.rows.every((row) => row.sourceRegion === 'visible_text')).toBe(true);
    expect(rows.visibleDomRowsCandidateCount).toBeGreaterThanOrEqual(2);
  });

  it('prefers body-visible business rows over shallow shell-dominated candidates', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: [
        '- generic "Search page shell" [ref=ref_shell] (x=1,y=1)',
        '  - button "Open menu" [ref=ref_menu] (x=30,y=24)',
        '  - button "Search or jump to" [ref=ref_search] (x=420,y=42)',
      ].join('\n'),
      fallbackInteractiveElements: [
        { ref: 'ref_nav_1', role: 'link', name: 'Homepage keyboard shortcut' },
        { ref: 'ref_filter_1', role: 'link', name: 'Repositories11.1k results' },
        { ref: 'ref_filter_2', role: 'link', name: 'Pull requests242k results' },
        { ref: 'ref_lang_1', role: 'link', name: 'Jupyter Notebook' },
      ],
      visibleTextContent: [
        'Search results for workflow',
        'Workflow planning guide for distributed teams',
        'Practical steps for coordinating browser tasks across reviewers.',
        'Updated today',
        'Operations checklist for reliable browser handoffs',
        'A field checklist for keeping evidence, ownership, and actions aligned.',
        'Updated yesterday',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(true);
    expect(rows.sourceRegion).toBe('visible_text');
    expect(rows.rows.map((row) => row.title)).toEqual([
      'Workflow planning guide for distributed teams',
      'Operations checklist for reliable browser handoffs',
    ]);
    expect(rows.rows.every((row) => row.sourceRegion === 'visible_text')).toBe(true);
  });

  it('keeps shell-only body-visible text rejected with diagnostics', () => {
    const rows = extractVisibleRegionRows({
      sourceRegion: 'search_results',
      url: 'https://example.test/search?q=workflow',
      title: 'Search results for workflow',
      viewport: { width: 1280, height: 720, dpr: 1 },
      pageContent: '',
      visibleTextContent: [
        'Search results for workflow',
        'Search query',
        'Filter results',
        'All',
        'Recent',
        'Topics',
        'Feedback',
        'Privacy',
        'Terms',
        'Help',
        'Copyright Example Corp',
      ].join('\n'),
    });

    expect(rows.visibleRegionRowsUsed).toBe(false);
    expect(rows.rowCount).toBe(0);
    expect(rows.rows).toEqual([]);
    expect(rows.rejectedRegionReasonDistribution.low_value_region).toBeGreaterThan(0);
    expect(rows.rejectedRegionReasonDistribution.footer_like_region).toBeGreaterThan(0);
    expect(rows.visibleRegionRowsRejectedReason).toMatch(/footer_like_region|low_value_region/);
  });
});
