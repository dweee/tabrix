import type { ReadPageCompactSnapshot } from '@tabrix/shared';

import { evaluateStructuredReadGate } from './structured-read-gate';

const T0 = 1_700_000_000_000;

function snapshot(overrides: Partial<ReadPageCompactSnapshot> = {}): ReadPageCompactSnapshot {
  return {
    mode: 'compact',
    summary: {
      pageRole: 'article',
      primaryRegion: 'content',
      quality: 'usable',
    },
    interactiveElements: [],
    artifactRefs: [],
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<ReadPageCompactSnapshot>,
  readMode: 'compact' | 'normal' | 'full' = 'normal',
) {
  return evaluateStructuredReadGate({
    snapshot: snapshot(overrides),
    readMode,
    nowMs: T0,
    gateId: 'gate-test',
  });
}

describe('structured-read-gate — verdicts', () => {
  it('marks full long article metadata as complete', () => {
    const result = evaluate(
      {
        taskMode: 'read',
        complexityLevel: 'complex',
        completeTextRegion: {
          sourceDataSource: 'web_content_text',
          sourceRoute: 'visible_text_sample',
          charCount: 5_200,
          normalizedLength: 5_000,
          lineCount: 42,
          completeTextAvailable: true,
          structureSparse: false,
          contentSparse: false,
          quality: 'usable',
          recommendation: 'use_chrome_get_web_content_for_full_body',
          reason: 'complete text metadata available',
        },
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [],
          rowCount: 8,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'content',
          rowExtractionConfidence: 0.9,
          cardExtractorUsed: false,
          cardPatternConfidence: 0,
          cardRowsCount: 0,
          rowOrder: 'visual_order',
          targetRefCoverageRate: 0.82,
          regionQualityScore: 0.81,
          visibleDomRowsCandidateCount: 8,
          visibleDomRowsSelectedCount: 8,
          lowValueRegionRejectedCount: 0,
          footerLikeRejectedCount: 0,
          navigationLikeRejectedCount: 0,
          targetRefCoverageRejectedCount: 0,
          rejectedRegionReasonDistribution: {},
          pageInfo: {
            scrollY: 0,
            viewportHeight: 800,
            documentHeight: 3200,
          },
        },
      },
      'full',
    );

    expect(result.verdict).toBe('complete');
    expect(result.gapDescription).toBeNull();
    expect(result.recommendedAction).toBeNull();
    expect(result.metrics.bodyCharCount).toBe(5_200);
    expect(result.metrics.coverageRatio).toBe(1);
  });

  it('marks compact shallow long-content candidates as mode_insufficient before summary_only', () => {
    const result = evaluate(
      {
        taskMode: 'read',
        completeTextRegion: {
          sourceDataSource: 'web_content_text',
          sourceRoute: 'visible_text_sample',
          charCount: 300,
          normalizedLength: 300,
          lineCount: 2,
          completeTextAvailable: false,
          structureSparse: false,
          contentSparse: true,
          quality: 'sparse',
          recommendation: 'use_chrome_get_web_content_for_full_body',
          reason: 'shallow compact read',
        },
      },
      'compact',
    );

    expect(result.verdict).toBe('mode_insufficient');
  });

  it('marks title and summary-only metadata as summary_only', () => {
    const result = evaluate({
      taskMode: 'read',
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 420,
        normalizedLength: 410,
        lineCount: 4,
        completeTextAvailable: false,
        structureSparse: false,
        contentSparse: true,
        quality: 'sparse',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'summary only',
      },
    });

    expect(result.verdict).toBe('summary_only');
    expect(result.gapDescription).toContain('body content');
  });

  it('marks low coverage content-region evidence as coverage_insufficient', () => {
    const result = evaluate({
      taskMode: 'read',
      summary: {
        pageRole: 'article',
        primaryRegion: 'navigation',
        quality: 'usable',
      },
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 1_200,
        normalizedLength: 1_100,
        lineCount: 12,
        completeTextAvailable: true,
        structureSparse: false,
        contentSparse: false,
        quality: 'usable',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'partial content',
      },
      visibleRegionRows: {
        sourceDataSource: 'dom_region_rows',
        rows: [],
        rowCount: 2,
        visibleRegionRowsUsed: true,
        visibleRegionRowsRejectedReason: null,
        sourceRegion: 'navigation',
        rowExtractionConfidence: 0.4,
        cardExtractorUsed: false,
        cardPatternConfidence: 0,
        cardRowsCount: 0,
        rowOrder: 'visual_order',
        targetRefCoverageRate: 0.25,
        regionQualityScore: 0.25,
        visibleDomRowsCandidateCount: 2,
        visibleDomRowsSelectedCount: 2,
        lowValueRegionRejectedCount: 0,
        footerLikeRejectedCount: 0,
        navigationLikeRejectedCount: 0,
        targetRefCoverageRejectedCount: 0,
        rejectedRegionReasonDistribution: {},
        pageInfo: {
          scrollY: 0,
          viewportHeight: 800,
          documentHeight: 3000,
        },
      },
    });

    expect(result.verdict).toBe('coverage_insufficient');
  });

  it('marks substantial unstructured body metadata as structure_sparse', () => {
    const result = evaluate({
      taskMode: 'read',
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 3_100,
        normalizedLength: 3_000,
        lineCount: 30,
        completeTextAvailable: true,
        structureSparse: true,
        contentSparse: false,
        quality: 'complete_text_sparse_structure',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'single block',
      },
      targetRefCoverageRate: 0.8,
    });

    expect(result.verdict).toBe('structure_sparse');
  });

  it('does not mark long text complete when structured section evidence is too low', () => {
    const result = evaluate(
      {
        taskMode: 'read',
        complexityLevel: 'complex',
        completeTextRegion: {
          sourceDataSource: 'web_content_text',
          sourceRoute: 'visible_text_sample',
          charCount: 4_287,
          normalizedLength: 4_100,
          lineCount: 34,
          completeTextAvailable: true,
          structureSparse: false,
          contentSparse: false,
          quality: 'usable',
          recommendation: 'use_chrome_get_web_content_for_full_body',
          reason: 'complete text metadata available',
        },
        visibleRegionRows: {
          sourceDataSource: 'dom_region_rows',
          rows: [],
          rowCount: 5,
          visibleRegionRowsUsed: true,
          visibleRegionRowsRejectedReason: null,
          sourceRegion: 'content',
          rowExtractionConfidence: 0.9,
          cardExtractorUsed: false,
          cardPatternConfidence: 0,
          cardRowsCount: 0,
          rowOrder: 'visual_order',
          targetRefCoverageRate: 0.92,
          regionQualityScore: 0.91,
          visibleDomRowsCandidateCount: 5,
          visibleDomRowsSelectedCount: 5,
          lowValueRegionRejectedCount: 0,
          footerLikeRejectedCount: 0,
          navigationLikeRejectedCount: 0,
          targetRefCoverageRejectedCount: 0,
          rejectedRegionReasonDistribution: {},
          pageInfo: {
            scrollY: 0,
            viewportHeight: 800,
            documentHeight: 3200,
          },
        },
      },
      'full',
    );

    expect(result.verdict).toBe('structure_sparse');
    expect(result.metrics.sectionCount).toBe(5);
    expect(result.gapDescription).toContain('structure');
  });

  it('returns not_applicable for non-long-content snapshots instead of complete', () => {
    const result = evaluate({
      taskMode: 'search',
      summary: {
        pageRole: 'search_results',
        primaryRegion: 'results',
        quality: 'usable',
      },
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 5_000,
        normalizedLength: 4_900,
        lineCount: 40,
        completeTextAvailable: true,
        structureSparse: false,
        contentSparse: false,
        quality: 'usable',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'search results text',
      },
      targetRefCoverageRate: 0.9,
    });

    expect(result.verdict).toBe('not_applicable');
    expect(result.gapDescription).toBeNull();
  });

  it('returns unknown when read_page metadata is insufficient', () => {
    const result = evaluateStructuredReadGate({
      snapshot: {
        mode: 'compact',
        summary: {
          pageRole: '',
          primaryRegion: null,
          quality: 'usable',
        },
        interactiveElements: [],
        artifactRefs: [],
      },
      readMode: 'normal',
      nowMs: T0,
    });

    expect(result.verdict).toBe('unknown');
  });
});

describe('structured-read-gate — precedence and boundaries', () => {
  it('prefers summary_only over structure_sparse when body content is too low', () => {
    const result = evaluate({
      taskMode: 'read',
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 500,
        normalizedLength: 500,
        lineCount: 5,
        completeTextAvailable: true,
        structureSparse: true,
        contentSparse: false,
        quality: 'complete_text_sparse_structure',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'short and sparse',
      },
    });

    expect(result.verdict).toBe('summary_only');
  });

  it('does not let raw fullSnapshot.pageContent affect verdict or metrics', () => {
    const baseSnapshot = {
      taskMode: 'read' as const,
      fullSnapshot: {
        pageContent: 'short raw text',
        refMap: [],
        fallbackElements: [],
        fallbackCount: 0,
        markedElements: [],
        stats: { processed: 1, included: 1, durationMs: 1 },
        contentSummary: {
          charCount: 2_800,
          normalizedLength: 2_700,
          lineCount: 24,
          quality: 'usable' as const,
        },
        tips: '',
        reason: null,
      },
      completeTextRegion: {
        sourceDataSource: 'web_content_text' as const,
        sourceRoute: 'visible_text_sample' as const,
        charCount: 2_800,
        normalizedLength: 2_700,
        lineCount: 24,
        completeTextAvailable: true,
        structureSparse: false,
        contentSparse: false,
        quality: 'usable' as const,
        recommendation: 'use_chrome_get_web_content_for_full_body' as const,
        reason: 'metadata available',
      },
      targetRefCoverageRate: 0.7,
    };

    const first = evaluate(baseSnapshot, 'full');
    const second = evaluate(
      {
        ...baseSnapshot,
        fullSnapshot: {
          ...baseSnapshot.fullSnapshot,
          pageContent: 'changed raw page content that the gate must ignore'.repeat(100),
        },
      },
      'full',
    );

    expect(first.verdict).toBe(second.verdict);
    expect(first.metrics).toEqual(second.metrics);
  });

  it('pins approved evidence basis and boundary non-claims', () => {
    const result = evaluate({
      taskMode: 'read',
      complexityLevel: 'complex',
      completeTextRegion: {
        sourceDataSource: 'web_content_text',
        sourceRoute: 'visible_text_sample',
        charCount: 2_800,
        normalizedLength: 2_700,
        lineCount: 24,
        completeTextAvailable: true,
        structureSparse: false,
        contentSparse: false,
        quality: 'usable',
        recommendation: 'use_chrome_get_web_content_for_full_body',
        reason: 'metadata available',
      },
      targetRefCoverageRate: 0.7,
    });

    expect(result.evidenceBasis).toEqual([
      'summary',
      'taskMode',
      'complexityLevel',
      'completeTextRegion',
    ]);
    expect(result.boundary).toEqual({
      metadataOnly: true,
      rawContentInspected: false,
      browserIoPerformed: false,
      llmUsed: false,
      publicContractChanged: false,
      realBrowserProven: false,
      commercialGradeProven: false,
    });
  });
});
