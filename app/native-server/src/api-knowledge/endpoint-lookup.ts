/**
 * Knowledge-driven endpoint lookup.
 *
 * Pure function module. Given a `DataNeed` and a structural
 * `EndpointKnowledgeReader` (`KnowledgeApiRepository` satisfies it),
 * picks the highest-scoring usable endpoint for the requested
 * `(site, semanticTypeWanted)` pair.
 *
 * This is the only direct-API entry point for `direct-api-executor`: the
 * executor should use what the Knowledge DB actually observed.
 *
 * Lookup contract:
 *   1. The `site` is derived from `dataNeed.urlHint` host. When the
 *      hint is missing or unparseable, we cannot look up anything and
 *      return `null`; the caller can fall through to compatibility
 *      logic or DOM L0+L1.
 *   2. We only consider rows that the repository's
 *      `scoreEndpointKnowledge` already marked as `usableForTask`.
 *      seed/deprecated seed rows remain stored as evidence, but are not
 *      executable candidates. A `mutation`/`asset`/`auth`/etc.
 *      semantic type is never a read candidate — those branches are
 *      handled exclusively by the legacy DOM `chrome_read_page` chain.
 *   3. When `semanticTypeWanted` is non-null, we prefer rows whose
 *      `semanticType` matches; rows with a different (but still
 *      usable) semanticType are only returned with
 *      `semanticValidation='fail'` so the caller can record the
 *      evidence.
 *   4. Among matching rows the highest `confidence` wins; ties break
 *      on `sampleCount` (more observations → more reliable). We never
 *      pick a row with `confidence < CONFIDENCE_FLOOR`.
 */

import type {
  DataNeed,
  EndpointKnowledgeReader,
  EndpointLookupChosenReason,
  EndpointMatch,
} from './types';
import type {
  EndpointSource,
  ScoredKnowledgeApiEndpoint,
} from '../memory/knowledge/knowledge-api-repository';

/**
 * Floor below which a Knowledge endpoint is treated as "we don't
 * trust this enough to skip the browser". Calibrated to match the
 * candidate threshold (`DIRECT_API_HIGH_CONFIDENCE_THRESHOLD = 0.7`)
 * so a knowledge-driven hit is at least as conservative as the
 * compatibility path. A row that the repository scored ≥ 0.7 already
 * required a `2xx` status class + a structured response shape + a
 * read-only semantic type, which is the same trust profile.
 */
export const KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR = 0.7;

/**
 * Look up the best candidate endpoint for the caller's `dataNeed`.
 * Returns `null` when:
 *   - the urlHint is missing / unparseable
 *   - the repository has no usable rows for that site
 *   - the highest-scoring row is below `KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR`
 *
 * The function performs no IO beyond a single `listScoredBySite`
 * call. It does not consult `Date.now()` and is therefore safe to
 * unit-test deterministically.
 */
export function lookupEndpointFamily(
  dataNeed: DataNeed,
  repo: EndpointKnowledgeReader,
): EndpointMatch | null {
  const site = deriveSiteFromUrlHint(dataNeed.urlHint);
  if (!site) return null;

  // Cap: we only ever evaluate the top-50 most recently observed
  // endpoints for a site. The repository already orders by confidence
  // → sampleCount → lastSeenAt, so the head of the list is always
  // the strongest candidate set.
  const scored = repo.listScoredBySite(site, 50);
  if (scored.length === 0) return null;

  const usable = scored.filter(
    (row) =>
      row.usableForTask &&
      row.endpointSource !== 'deprecated_seed' &&
      row.endpointSource !== 'seed_adapter',
  );
  if (usable.length === 0) return null;

  const wanted = dataNeed.semanticTypeWanted;
  let pool = wanted ? usable.filter((row) => row.semanticType === wanted) : usable.slice();

  // When no semanticType-matching row exists, fall through to "any
  // usable" but mark `semanticValidation='fail'`. The caller still
  // gets a result and the evidence contract records the mismatch so a
  // downstream post-mortem can group by it.
  let semanticValidation: EndpointMatch['semanticValidation'] = 'pass';
  if (pool.length === 0) {
    pool = usable.slice();
    semanticValidation = 'fail';
  }

  pool.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount;
    return b.lastSeenAt.localeCompare(a.lastSeenAt);
  });

  const top = selectRankedEndpointCandidate(pool);
  if (!top) return null;
  if (top.candidate.confidence < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  // The score we return is a deliberate copy of the repository's
  // `confidence`, with a small penalty when we had to widen the
  // semantic match. The penalty is large enough to
  // de-prioritize a `semanticValidation='fail'` hit relative to a
  // pass-validated peer at the same confidence, and small enough that
  // a strong observed endpoint still beats the compatibility floor.
  const score =
    semanticValidation === 'pass'
      ? top.candidate.confidence
      : Math.max(0, top.candidate.confidence - 0.05);
  if (score < KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR) return null;

  // Single-session correlation never escalates. The lookup surfaces
  // whatever the row recorded, but caps `'high_confidence'` back to
  // `'low_confidence'` so a hypothetical mis-write at the writer
  // cannot leak through. Multi-session escalation belongs at the
  // repository layer, not in lookup.
  const correlationConfidence = capSingleSessionCorrelation(top.candidate.correlationConfidence);

  const retiredPeer = top.retired
    ? {
        endpointSource: top.retired.endpointSource,
        endpointSignature: top.retired.endpointSignature,
        confidence: top.retired.confidence,
        sampleCount: top.retired.sampleCount,
      }
    : null;

  return {
    endpoint: top.candidate,
    semanticValidation,
    score,
    endpointSource: top.candidate.endpointSource,
    correlationConfidence,
    retiredPeer,
    chosenReason: top.chosenReason,
  };
}

interface RankedEndpointCandidatePick {
  candidate: ScoredKnowledgeApiEndpoint;
  retired: ScoredKnowledgeApiEndpoint | null;
  chosenReason: EndpointLookupChosenReason;
}

/** Pick the leader from a confidence-sorted pool. */
function selectRankedEndpointCandidate(
  pool: ScoredKnowledgeApiEndpoint[],
): RankedEndpointCandidatePick | null {
  const leader = pool[0];
  if (!leader) return null;

  if (leader.endpointSource === 'observed') {
    return {
      candidate: leader,
      retired: null,
      chosenReason:
        leader.confidence >= KNOWLEDGE_LOOKUP_CONFIDENCE_FLOOR
          ? 'observed_only_match'
          : 'best_available',
    };
  }
  if (leader.endpointSource === 'manual_seed') {
    return { candidate: leader, retired: null, chosenReason: 'best_available' };
  }
  return { candidate: leader, retired: null, chosenReason: 'best_available' };
}

function capSingleSessionCorrelation(
  value: EndpointMatch['correlationConfidence'],
): EndpointMatch['correlationConfidence'] {
  if (value === 'high_confidence') return 'low_confidence';
  return value;
}

/**
 * Exported for tests / future telemetry. The lookup normalises an
 * `EndpointSource` value before publishing so a legacy NULL stored at
 * the row level still ranks correctly.
 */
export function isObservedSource(value: EndpointSource | null | undefined): boolean {
  return value === 'observed';
}

/**
 * Internal — derives the `site` Knowledge row key from the URL the
 * user is currently on. `KnowledgeApiRepository` keys on the *host*
 * (lower-cased), and `api-knowledge-capture.ts` writes the same key,
 * so this normalisation must stay in lockstep.
 *
 * Returns `null` when the url is missing / unparseable so the caller
 * can fall back to the legacy candidate path.
 */
function deriveSiteFromUrlHint(urlHint: string | null): string | null {
  if (!urlHint) return null;
  try {
    const parsed = new URL(urlHint);
    const host = parsed.hostname.trim().toLowerCase();
    if (!host) return null;
    return host;
  } catch {
    return null;
  }
}
