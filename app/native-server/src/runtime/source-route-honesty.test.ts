import type {
  BrowserSourceTruthChain,
  ReadPageSelectedDataSource,
  SourceTruthOrigin,
} from '@tabrix/shared';
import { classifySourceRouteHonesty } from './source-route-honesty';

function chain(args: {
  primaryOrigin: SourceTruthOrigin;
  facts?: SourceTruthOrigin[];
  inferences?: SourceTruthOrigin[];
}): BrowserSourceTruthChain {
  const facts = args.facts ?? [];
  const inferences = args.inferences ?? [];
  return {
    primaryOrigin: args.primaryOrigin,
    fieldProvenances: [
      ...facts.map((origin, index) => ({
        field: `fact.${index}`,
        origin,
        isFact: true,
      })),
      ...inferences.map((origin, index) => ({
        field: `inference.${index}`,
        origin,
        isFact: false,
      })),
    ],
    provenanceCreatedAt: '2026-05-24T00:00:00.000Z',
  };
}

function classify(
  selectedDataSource: ReadPageSelectedDataSource | null,
  sourceTruthChain?: BrowserSourceTruthChain | null,
  extra: { fallbackReason?: string | null; blockedReason?: string | null } = {},
) {
  return classifySourceRouteHonesty({
    selectedDataSource,
    sourceTruthChain,
    ...extra,
  });
}

describe('source-route-honesty — conservative proof labels', () => {
  it('labels API only when selected API rows have API fact provenance', () => {
    expect(classify('api_rows', chain({ primaryOrigin: 'api', facts: ['api'] }))).toMatchObject({
      verdict: 'api_proven',
      factOrigins: ['api'],
      hasFactEvidence: true,
      reason: 'api_fact_evidence_present',
    });
  });

  it('does not treat API provenance without fact evidence as API proof', () => {
    expect(
      classify('api_rows', chain({ primaryOrigin: 'api', inferences: ['api'] })),
    ).toMatchObject({
      verdict: 'unknown',
      factOrigins: [],
      hasFactEvidence: false,
      reason: 'api_fact_evidence_missing',
    });
  });

  it('labels CDP only when selected CDP rows have CDP fact provenance', () => {
    expect(
      classify('cdp_enhanced_api_rows', chain({ primaryOrigin: 'cdp', facts: ['cdp'] })),
    ).toMatchObject({
      verdict: 'cdp_proven',
      factOrigins: ['cdp'],
      reason: 'cdp_fact_evidence_present',
    });
  });

  it('labels DOM and text routes as fallback, not API or CDP proof', () => {
    expect(
      classify('dom_region_rows', chain({ primaryOrigin: 'dom', facts: ['dom'] }), {
        fallbackReason: 'observed_api_rows_not_available',
      }),
    ).toMatchObject({
      verdict: 'dom_fallback',
      fallbackUsed: true,
      reason: 'preferred_route_fell_back_to_dom',
    });

    expect(classify('markdown', chain({ primaryOrigin: 'text', facts: ['text'] }))).toMatchObject({
      verdict: 'dom_fallback',
      fallbackUsed: false,
      reason: 'dom_or_text_route_selected',
    });
  });

  it('labels mixed when multiple non-inference source origins are present', () => {
    expect(
      classify('api_rows', chain({ primaryOrigin: 'api', facts: ['api', 'dom'] })),
    ).toMatchObject({
      verdict: 'mixed',
      sourceOrigins: ['api', 'dom'],
      reason: 'multiple_source_origins_observed',
    });
  });

  it('labels missing and blocked inputs explicitly', () => {
    expect(classify(null)).toMatchObject({
      verdict: 'unknown',
      reason: 'selected_data_source_missing',
    });
    expect(classify('dom_json', null, { blockedReason: 'policy_denied' })).toMatchObject({
      verdict: 'blocked',
      reason: 'policy_denied',
    });
  });
});
