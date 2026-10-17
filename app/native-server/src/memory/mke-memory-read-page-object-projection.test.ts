import {
  buildPageObjectEvidenceRefs,
  buildPageObjectRecentEvents,
  mergeReadPageFactsWithExistingCollectionFacts,
  summarizeReadPageSnapshot,
  summarizeReadPageUnifiedDelta,
} from './mke-memory-read-page-object-projection';

describe('read-page object projection helpers', () => {
  it('summarizes page snapshots without retaining raw content or sensitive URL tokens', () => {
    const summary = summarizeReadPageSnapshot({
      snapshotId: 'snapshot-1',
      observedAt: '2026-06-27T01:00:00.000Z',
      pageType: 'search',
      pageRole: 'results',
      pageUrl: 'https://example.test/search?q=ai&xsec_token=secret-token',
      pageState: {
        pageStability: 'stable',
        readiness: 'ready',
        baseUrl: 'https://example.test/search?token=private-token',
        frameCount: 2,
      },
      objectCount: 12,
      actionableObjectCount: 5,
      sourceProvenance: ['dom', 'ax', 'cdp', 'network', 'screenshot', 'extra'],
      rawBody: '{"token":"secret-token"}',
      cookie: 'sid=secret-cookie',
      requestHeaders: { Authorization: 'Bearer secret-token' },
    });

    expect(summary).toMatchObject({
      snapshotId: 'snapshot-1',
      pageType: 'search',
      pageRole: 'results',
      objectCount: 12,
      actionableObjectCount: 5,
      sourceProvenance: ['dom', 'ax', 'cdp'],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('xsec_token');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-cookie');
    expect(serialized).not.toContain('rawBody');
    expect(serialized).not.toContain('Authorization');
  });

  it('summarizes unified delta without retaining raw response bodies or headers', () => {
    const summary = summarizeReadPageUnifiedDelta({
      postActionDeltaEvidence: {
        observedChangeKind: 'result_list_updated',
        recommendedNextAction: 'continue',
        actionId: 'action-1',
        targetObjectId: 'target-1',
        beforeProjectionId: 'before-1',
        afterProjectionId: 'after-1',
        changedRegions: [{ id: 'results' }],
        objectDelta: {
          changedObjectIds: ['card-1', 'card-2'],
        },
        observedSignalDeltas: {
          requestStartedDelta: 2,
          failedRequestDelta: 0,
          errorCountDelta: 0,
          warningCountDelta: 1,
        },
        responseBody: '{"token":"secret-token"}',
        requestHeaders: { Cookie: 'sid=secret-cookie' },
      },
    });

    expect(summary).toMatchObject({
      deltaKind: 'result_list_updated',
      recommendation: 'continue',
      actionId: 'action-1',
      targetObjectId: 'target-1',
      beforeProjectionId: 'before-1',
      afterProjectionId: 'after-1',
      changedRegionsCount: 1,
      changedObjectCount: 2,
      networkSignalsCount: 2,
      consoleSignalsCount: 2,
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain('responseBody');
    expect(serialized).not.toContain('requestHeaders');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('secret-cookie');
  });

  it('preserves result-card collection facts while advancing read-page snapshot sequence', () => {
    const merged = mergeReadPageFactsWithExistingCollectionFacts(
      {
        pageObjectSnapshotSummary: { snapshotId: 'snapshot-2' },
        pageDeltaSummary: { deltaKind: 'dom_changed' },
      },
      {
        source: 'chrome_collect_result_cards',
        filterState: { sort: 'most_collected' },
        observedResultCount: 10,
        targetRefCoverageRate: 0.9,
        snapshotSequence: 1,
        pageObjectSnapshotSummary: { snapshotId: 'snapshot-1' },
        pageDeltaSummary: { deltaKind: 'initial' },
      },
    );

    expect(merged).toMatchObject({
      filterState: { sort: 'most_collected' },
      observedResultCount: 10,
      targetRefCoverageRate: 0.9,
      snapshotSequence: 2,
      lastCollectionSource: 'chrome_collect_result_cards',
      lastPageObjectSnapshotSummary: { snapshotId: 'snapshot-1' },
      lastPageDeltaSummary: { deltaKind: 'initial' },
    });
  });

  it('builds compact evidence references and recent event summaries', () => {
    const snapshotSummary = { snapshotId: 'snapshot-1', observedAt: '2026-06-27T01:00:00.000Z' };
    const deltaSummary = {
      deltaKind: 'result_list_updated',
      actionId: 'action-1',
      targetObjectId: 'target-1',
      beforeProjectionId: 'before-1',
      afterProjectionId: 'after-1',
    };

    expect(buildPageObjectEvidenceRefs({ snapshotSummary, deltaSummary })).toEqual([
      'read_page_object_snapshot:snapshot-1',
      'post_action_delta_evidence:after-1',
    ]);
    expect(
      buildPageObjectRecentEvents({
        snapshotSummary,
        deltaSummary,
        observedAt: '2026-06-27T01:01:00.000Z',
      }),
    ).toEqual([
      {
        eventType: 'page_object_snapshot',
        snapshotId: 'snapshot-1',
        observedAt: '2026-06-27T01:00:00.000Z',
      },
      {
        eventType: 'post_action_delta_evidence',
        deltaKind: 'result_list_updated',
        actionId: 'action-1',
        targetObjectId: 'target-1',
        beforeProjectionId: 'before-1',
        afterProjectionId: 'after-1',
        observedAt: '2026-06-27T01:01:00.000Z',
      },
    ]);
  });
});
