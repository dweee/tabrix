/**
 * BNS-05 lifecycle evidence artifact producer.
 *
 * Pure fixture-tested artifact builder. This slice summarizes BNS-01 events,
 * BNS-02 semantic signals, BNS-03 watch scopes, and BNS-04 postcondition results.
 */
import type {
  BrowserSourceTruthChain,
  BrowserTaskEvidenceLevel,
  BrowserTaskScenarioClass,
  BrowserStreamEvent,
  LifecycleEvidenceArtifact,
  LifecycleEvidenceBrowserHygiene,
  LifecycleEvidenceBrowserHygieneCheck,
  LifecycleEvidenceFinalVerdict,
  LifecycleEvidenceKeyEvent,
  LifecycleEvidenceScopeTransition,
  LifecycleEvidenceScopeTransitions,
  LifecycleEvidenceSignalSequence,
  LifecycleEvidenceUnavailableSection,
  PostconditionResult,
  PostconditionVerdict,
  SemanticSignal,
} from '@tabrix/shared';
import { LIFECYCLE_EVIDENCE_BROWSER_HYGIENE_CHECK_KINDS } from '@tabrix/shared';

const DEFAULT_MAX_KEY_EVENTS = 50;

export interface ProduceLifecycleEvidenceArtifactInput {
  artifactId: string;
  evidenceLevel: BrowserTaskEvidenceLevel;
  scenarioId: string;
  scenarioClass: BrowserTaskScenarioClass | string;
  startedAtMs: number;
  streamEvents?: BrowserStreamEvent[];
  semanticSignals?: SemanticSignal[];
  scopeTransitions?: LifecycleEvidenceScopeTransition[];
  sourceTruthChain?: BrowserSourceTruthChain | null;
  browserHygiene?: Partial<LifecycleEvidenceBrowserHygiene> | null;
  postconditionEvidence?: {
    source: 'bns_04_verifier';
    results: PostconditionResult[];
  };
}

export interface ProduceLifecycleEvidenceArtifactOptions {
  now?: () => number;
  maxKeyEvents?: number;
}

export function produceLifecycleEvidenceArtifact(
  input: ProduceLifecycleEvidenceArtifactInput,
  options: ProduceLifecycleEvidenceArtifactOptions = {},
): LifecycleEvidenceArtifact {
  const producedAtMs = options.now ? options.now() : Date.now();
  const maxKeyEvents = Math.max(0, options.maxKeyEvents ?? DEFAULT_MAX_KEY_EVENTS);
  const streamEvents = input.streamEvents ?? [];
  const postconditionResults =
    input.postconditionEvidence?.source === 'bns_04_verifier'
      ? input.postconditionEvidence.results
      : [];
  const browserHygiene = buildBrowserHygiene(input.browserHygiene);

  return {
    artifactId: input.artifactId,
    version: 1,
    evidenceLevel: input.evidenceLevel,
    scenarioId: input.scenarioId,
    scenarioClass: input.scenarioClass,
    baseline: {
      scenarioId: input.scenarioId,
      scenarioClass: input.scenarioClass,
      evidenceLevel: input.evidenceLevel,
      startedAtMs: input.startedAtMs,
    },
    eventTimeline: {
      available: streamEvents.length > 0,
      totalEvents: streamEvents.length,
      eventsByKind: countEventsByKind(streamEvents),
      firstEventAtMs: firstObservedAt(streamEvents),
      lastEventAtMs: lastObservedAt(streamEvents),
      keyEvents: streamEvents.slice(0, maxKeyEvents).map(toKeyEvent),
    },
    signalSequence: buildSignalSequence(input.semanticSignals),
    scopeTransitions: buildScopeTransitions(input.scopeTransitions),
    actionLog: buildActionLog(postconditionResults),
    browserHygiene,
    sourceTruthChain: input.sourceTruthChain ?? null,
    claimBoundary: {
      deterministicArtifactOnly:
        input.evidenceLevel !== 'real_browser' && input.evidenceLevel !== 'competitor',
      realBrowserProven: false,
      commercialGradeProven: false,
      competitorSuperiorityProven: false,
      fallbackSuccessSeparated: false,
      sourceRouteProven: false,
    },
    finalVerdict: deriveFinalVerdict(postconditionResults, browserHygiene),
    producedAtMs,
  };
}

function buildScopeTransitions(
  transitions: LifecycleEvidenceScopeTransition[] | undefined,
): LifecycleEvidenceScopeTransitions | LifecycleEvidenceUnavailableSection {
  if (!transitions || transitions.length === 0) {
    return {
      available: false,
      reason: 'bns_03_not_available',
    };
  }

  return {
    available: true,
    totalTransitions: transitions.length,
    transitions: transitions.map((transition) => ({
      ...transition,
      regions: transition.regions.map((region) => ({ ...region })),
    })),
  };
}

function countEventsByKind(events: BrowserStreamEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  }
  return counts;
}

function buildSignalSequence(
  signals: SemanticSignal[] | undefined,
): LifecycleEvidenceSignalSequence | LifecycleEvidenceUnavailableSection {
  if (!signals || signals.length === 0) {
    return {
      available: false,
      reason: 'bns_02_not_available',
    };
  }

  return {
    available: true,
    totalSignals: signals.length,
    signalsByKind: countSignalsByKind(signals),
    firstSignalAtMs: Math.min(...signals.map((signal) => signal.producedAtMs)),
    lastSignalAtMs: Math.max(...signals.map((signal) => signal.producedAtMs)),
    signals,
  };
}

function countSignalsByKind(signals: SemanticSignal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const signal of signals) {
    counts[signal.kind] = (counts[signal.kind] ?? 0) + 1;
  }
  return counts;
}

function firstObservedAt(events: BrowserStreamEvent[]): number | null {
  if (events.length === 0) return null;
  return Math.min(...events.map((event) => event.observedAtMs));
}

function lastObservedAt(events: BrowserStreamEvent[]): number | null {
  if (events.length === 0) return null;
  return Math.max(...events.map((event) => event.observedAtMs));
}

function toKeyEvent(event: BrowserStreamEvent): LifecycleEvidenceKeyEvent {
  return {
    streamEventId: event.streamEventId,
    kind: event.kind,
    observedAtMs: event.observedAtMs,
    tabId: event.tabId,
    urlPattern: event.urlPattern,
    sourceObservationKind: event.sourceObservationKind,
  };
}

function buildActionLog(entries: PostconditionResult[]) {
  return {
    available: entries.length > 0,
    totalActions: entries.length,
    passed: countVerdict(entries, 'passed'),
    failed: countVerdict(entries, 'failed'),
    unknown: countVerdict(entries, 'unknown'),
    entries,
  };
}

function countVerdict(entries: PostconditionResult[], verdict: PostconditionVerdict): number {
  return entries.filter((entry) => entry.verdict === verdict).length;
}

function buildBrowserHygiene(
  input: Partial<LifecycleEvidenceBrowserHygiene> | null | undefined,
): LifecycleEvidenceBrowserHygiene {
  return {
    available: input?.available ?? false,
    baselineTabs: input?.baselineTabs ?? null,
    runOwnedTabsClosed: input?.runOwnedTabsClosed ?? null,
    baselineChanged: input?.baselineChanged ?? null,
    checks: buildBrowserHygieneChecks(input?.checks),
    notes: input?.notes ? [...input.notes] : [],
  };
}

function buildBrowserHygieneChecks(
  input: LifecycleEvidenceBrowserHygieneCheck[] | undefined,
): LifecycleEvidenceBrowserHygieneCheck[] {
  const byKind = new Map(input?.map((check) => [check.kind, check]));

  return LIFECYCLE_EVIDENCE_BROWSER_HYGIENE_CHECK_KINDS.filter((kind) => kind !== 'unknown').map(
    (kind) => {
      const reported = byKind.get(kind);
      if (reported) {
        return { ...reported };
      }
      return {
        kind,
        verdict: 'unknown',
        reason: 'browser_hygiene_check_not_reported',
      };
    },
  );
}

function deriveFinalVerdict(
  entries: PostconditionResult[],
  browserHygiene: LifecycleEvidenceBrowserHygiene,
): LifecycleEvidenceFinalVerdict {
  if (entries.length === 0) {
    return { verdict: 'unknown', confidence: 0, reason: 'no_postcondition_results' };
  }
  if (entries.some((entry) => entry.verdict === 'failed')) {
    return { verdict: 'task_failed', confidence: 0.85, reason: 'postcondition_failed' };
  }
  const passed = entries.some((entry) => entry.verdict === 'passed');
  const unknown = entries.some((entry) => entry.verdict === 'unknown');
  if (passed && unknown) {
    return { verdict: 'partial_success', confidence: 0.6, reason: 'mixed_postcondition_results' };
  }
  if (passed) {
    if (!browserHygiene.available) {
      return { verdict: 'unknown', confidence: 0.3, reason: 'browser_hygiene_unavailable' };
    }
    if (browserHygiene.baselineChanged) {
      return { verdict: 'blocked', confidence: 0.7, reason: 'browser_hygiene_changed' };
    }
    if (browserHygiene.checks.some((check) => check.verdict === 'fail')) {
      return { verdict: 'blocked', confidence: 0.75, reason: 'browser_hygiene_check_failed' };
    }
    const requiredChecksPassed = LIFECYCLE_EVIDENCE_BROWSER_HYGIENE_CHECK_KINDS.filter(
      (kind) => kind !== 'unknown',
    ).every((kind) =>
      browserHygiene.checks.some((check) => check.kind === kind && check.verdict === 'pass'),
    );
    if (!requiredChecksPassed) {
      return { verdict: 'unknown', confidence: 0.4, reason: 'browser_hygiene_check_incomplete' };
    }
    return { verdict: 'task_success', confidence: 0.8, reason: 'postconditions_passed' };
  }
  return { verdict: 'unknown', confidence: 0.2, reason: 'postconditions_unknown' };
}
