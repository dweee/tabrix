import type { BrowserPageThingProjection } from '@tabrix/shared';

import {
  readPagePostconditionRegions,
  readPayloadSelectedDataSource,
  readSelectedDataSource,
} from './read-page-payload-readers';

function projection(chosenDataSource: BrowserPageThingProjection['chosenDataSource']) {
  return {
    chosenDataSource,
  } as BrowserPageThingProjection;
}

describe('read-page payload readers', () => {
  it('keeps dom_region_rows when the AI-facing payload has reliable visible rows', () => {
    expect(
      readSelectedDataSource(
        {
          selectedDataSource: 'markdown',
          kind: 'dom_region_rows',
          sourceDataSource: 'dom_region_rows',
          visibleRegionRowsUsed: true,
          visibleDomRowsSelectedCount: 5,
          rowExtractionConfidence: 0.9,
          targetRefCoverageRate: 1,
          regionQualityScore: 0.88,
        },
        projection('markdown'),
      ),
    ).toBe('dom_region_rows');
    expect(
      readPayloadSelectedDataSource({
        selectedDataSource: 'markdown',
        kind: 'dom_region_rows',
        sourceDataSource: 'dom_region_rows',
      }),
    ).toBe('dom_region_rows');
  });

  it('does not promote a sparse single-row payload to dom_region_rows', () => {
    expect(
      readSelectedDataSource(
        {
          selectedDataSource: 'dom_region_rows',
          visibleRegionRowsUsed: true,
          rowCount: 1,
          rowExtractionConfidence: 0.9,
          targetRefCoverageRate: 1,
          regionQualityScore: 0.88,
        },
        projection('markdown'),
      ),
    ).toBe('markdown');
  });

  it('projects visible search filter state into postcondition regions', () => {
    const regions = readPagePostconditionRegions(
      {
        searchSurface: {
          filterState: {
            appliedLabels: ['图文', '最新', '一周内'],
            contentType: { selected: '图文', selectedCandidateId: 'ca_filter_content_type' },
            sort: { selected: '最新', selectedCandidateId: 'ca_filter_sort_latest' },
            timeRange: { selected: '一周内', selectedCandidateId: 'ca_filter_time_week' },
          },
        },
      },
      [],
    );

    expect(regions).toEqual([
      expect.objectContaining({
        regionId: 'search_filter_state_postcondition',
        regionType: 'filter_panel',
        state: 'active_filter_state_observed',
        candidateActionIds: [
          'ca_filter_content_type',
          'ca_filter_sort_latest',
          'ca_filter_time_week',
        ],
        objects: expect.arrayContaining([
          expect.objectContaining({
            label: 'sort:最新',
            objectType: 'control',
            state: 'selected',
          }),
        ]),
      }),
    ]);
  });
});
