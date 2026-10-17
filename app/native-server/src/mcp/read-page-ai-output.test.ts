import { stripReadPageDiagnosticNoiseForOutput } from './read-page-ai-output';

describe('read-page AI output', () => {
  it('aligns nested source diagnostics with the selected AI-facing data source', () => {
    const output = stripReadPageDiagnosticNoiseForOutput({
      selectedDataSource: 'dom_region_rows',
      pageProjection: {
        chosenDataSource: 'markdown',
        sourceLineage: 'text',
        sourceTruthChain: {
          primaryOrigin: 'text',
          fieldProvenances: [
            {
              field: 'pageProjection.readiness',
              origin: 'text',
              isFact: true,
            },
          ],
        },
      },
      sourceRouteHonesty: {
        selectedDataSource: 'markdown',
        sourceOrigins: ['text'],
        factOrigins: ['text'],
        hasFactEvidence: true,
      },
      apiCdpProofBoundary: {
        selectedDataSource: 'markdown',
      },
    });

    expect(output.pageProjection).toMatchObject({
      chosenDataSource: 'dom_region_rows',
      sourceLineage: 'dom',
      sourceTruthChain: {
        primaryOrigin: 'dom',
      },
    });
    expect(output.sourceRouteHonesty).toMatchObject({
      selectedDataSource: 'dom_region_rows',
      sourceOrigins: ['text', 'dom'],
      factOrigins: ['text', 'dom'],
      hasFactEvidence: true,
    });
    expect(output.apiCdpProofBoundary).toMatchObject({
      selectedDataSource: 'dom_region_rows',
      sourceOrigins: ['dom'],
      factOrigins: ['dom'],
    });
  });
});
