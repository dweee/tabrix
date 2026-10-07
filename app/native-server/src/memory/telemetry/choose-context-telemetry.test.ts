/**
 * V23-04 / B-018 v1.5 — `ChooseContextTelemetryRepository` unit tests.
 *
 * Uses a real in-memory SQLite handle so the assertions exercise the
 * actual schema (`tabrix_choose_context_decisions` /
 * `tabrix_choose_context_outcomes`) — this is the fastest signal that
 * the DDL in `memory/db/schema.ts` and the repo SQL stay in sync.
 */

import { openMemoryDb } from '../db/client';
import {
  ChooseContextTelemetryRepository,
  type RecordChooseContextDecisionInput,
  type RecordChooseContextOutcomeInput,
} from './choose-context-telemetry';

interface Harness {
  repo: ChooseContextTelemetryRepository;
  db: ReturnType<typeof openMemoryDb>['db'];
  close: () => void;
}

function fresh(): Harness {
  const opened = openMemoryDb({ dbPath: ':memory:' });
  return {
    repo: new ChooseContextTelemetryRepository(opened.db),
    db: opened.db,
    close: () => opened.db.close(),
  };
}

function decision(
  overrides: Partial<RecordChooseContextDecisionInput> = {},
): RecordChooseContextDecisionInput {
  return {
    decisionId: 'dc-1',
    intentSignature: 'open issues',
    pageRole: 'workspace_home',
    siteFamily: 'workspace',
    strategy: 'knowledge_light',
    fallbackStrategy: 'read_page_required',
    createdAt: '2026-04-22T10:00:00.000Z',
    ...overrides,
  };
}

function outcome(
  overrides: Partial<RecordChooseContextOutcomeInput> = {},
): RecordChooseContextOutcomeInput {
  return {
    decisionId: 'dc-1',
    outcome: 'reuse',
    recordedAt: '2026-04-22T11:00:00.000Z',
    ...overrides,
  };
}

describe('ChooseContextTelemetryRepository', () => {
  it('appends a decision row and reads it back', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-1' }));
      const row = repo.findDecision('dc-1');
      expect(row).toEqual({
        decisionId: 'dc-1',
        intentSignature: 'open issues',
        pageRole: 'workspace_home',
        siteFamily: 'workspace',
        strategy: 'knowledge_light',
        fallbackStrategy: 'read_page_required',
        createdAt: '2026-04-22T10:00:00.000Z',
      });
    } finally {
      close();
    }
  });

  it('rejects duplicate decisionId (PK collision)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-dup' }));
      expect(() => repo.recordDecision(decision({ decisionId: 'dc-dup' }))).toThrow();
    } finally {
      close();
    }
  });

  it('preserves null pageRole / siteFamily / fallbackStrategy', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-null',
          pageRole: null,
          siteFamily: null,
          strategy: 'read_page_required',
          fallbackStrategy: null,
        }),
      );
      const row = repo.findDecision('dc-null');
      expect(row).toMatchObject({
        decisionId: 'dc-null',
        pageRole: null,
        siteFamily: null,
        strategy: 'read_page_required',
        fallbackStrategy: null,
      });
    } finally {
      close();
    }
  });

  it('stores only redacted selected artifact pointers', () => {
    const { repo, db, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-selected-artifact',
          strategy: 'experience_reuse',
          selectedArtifacts: [
            {
              kind: 'experience_recipe',
              ref: 'exp-content-top10',
              recipeSchema: 'tabrix_experience_recipe_hint_v1',
              siteFamily: 'content.example',
              pageRole: 'search_results',
              taskSignature: 'tools:chrome_collect_result_cards',
            },
          ],
        }),
      );
      const row = db
        .prepare(
          `SELECT selected_artifacts_blob
             FROM tabrix_choose_context_decisions
            WHERE decision_id = ?`,
        )
        .get('dc-selected-artifact') as { selected_artifacts_blob: string | null };
      const payload = JSON.parse(row.selected_artifacts_blob ?? '{}') as {
        schema?: string;
        items?: Array<Record<string, unknown>>;
      };
      expect(payload).toEqual({
        schema: 'tabrix_choose_context_selected_artifacts_v1',
        items: [
          {
            kind: 'experience_recipe',
            ref: 'exp-content-top10',
            recipeSchema: 'tabrix_experience_recipe_hint_v1',
            siteFamily: 'content.example',
            pageRole: 'search_results',
            taskSignature: 'tools:chrome_collect_result_cards',
          },
        ],
      });
      expect(row.selected_artifacts_blob).not.toContain('steps');
      expect(row.selected_artifacts_blob).not.toContain('successCheck');
      expect(row.selected_artifacts_blob).not.toContain('summary');
    } finally {
      close();
    }
  });

  it('returns unknown_decision when outcome targets a missing decisionId', () => {
    const { repo, close } = fresh();
    try {
      const result = repo.recordOutcome(outcome({ decisionId: 'dc-missing' }));
      expect(result).toEqual({ status: 'unknown_decision' });
    } finally {
      close();
    }
  });

  it('appends an outcome row when the decisionId exists', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-2' }));
      const result = repo.recordOutcome(outcome({ decisionId: 'dc-2', outcome: 'reuse' }));
      expect(result.status).toBe('ok');
      const aggregates = repo.aggregateStrategies();
      const knowledge = aggregates.find((a) => a.strategy === 'knowledge_light');
      expect(knowledge).toBeDefined();
      expect(knowledge!.decisions).toBe(1);
      expect(knowledge!.outcomes.reuse).toBe(1);
    } finally {
      close();
    }
  });

  it('aggregates multiple outcomes per decision (e.g. retried then completed)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-3', strategy: 'read_page_markdown' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-3', outcome: 'retried' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-3', outcome: 'completed' }));
      const aggregates = repo.aggregateStrategies();
      const md = aggregates.find((a) => a.strategy === 'read_page_markdown');
      expect(md!.decisions).toBe(1);
      expect(md!.outcomes.retried).toBe(1);
      expect(md!.outcomes.completed).toBe(1);
      expect(md!.outcomes.reuse).toBe(0);
    } finally {
      close();
    }
  });

  it('projects a first retried outcome as failed usage and ignores later outcomes', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-artifact-use',
          strategy: 'experience_reuse',
          selectedArtifacts: [
            { kind: 'experience_recipe', ref: 'experience-1' },
            { kind: 'knowledge_page_model', ref: 'knowledge-1' },
          ],
        }),
      );

      const applyArtifactUsage = jest.fn();
      const retried = repo.recordOutcome(
        outcome({ decisionId: 'dc-artifact-use', outcome: 'retried' }),
        applyArtifactUsage,
      );
      expect(retried).toMatchObject({
        status: 'ok',
        artifactUsage: {
          successful: false,
          adopted: false,
          selectedArtifacts: [
            { kind: 'experience_recipe', ref: 'experience-1' },
            { kind: 'knowledge_page_model', ref: 'knowledge-1' },
          ],
        },
      });
      expect(applyArtifactUsage).toHaveBeenCalledTimes(1);
      expect(applyArtifactUsage).toHaveBeenCalledWith({
        successful: false,
        adopted: false,
        selectedArtifacts: [
          { kind: 'experience_recipe', ref: 'experience-1' },
          { kind: 'knowledge_page_model', ref: 'knowledge-1' },
        ],
      });

      const completed = repo.recordOutcome(
        outcome({
          decisionId: 'dc-artifact-use',
          outcome: 'completed',
          recordedAt: '2026-04-22T11:01:00.000Z',
        }),
        applyArtifactUsage,
      );
      expect(completed).toMatchObject({ status: 'ok' });
      if (completed.status === 'ok') {
        expect(completed.artifactUsage).toBeUndefined();
      }

      const duplicate = repo.recordOutcome(
        outcome({
          decisionId: 'dc-artifact-use',
          outcome: 'reuse',
          recordedAt: '2026-04-22T11:02:00.000Z',
        }),
        applyArtifactUsage,
      );
      expect(duplicate).toMatchObject({ status: 'ok' });
      if (duplicate.status === 'ok') {
        expect(duplicate.artifactUsage).toBeUndefined();
      }
      expect(applyArtifactUsage).toHaveBeenCalledTimes(1);
    } finally {
      close();
    }
  });

  it('does not project retried after another definitive outcome', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-artifact-completed-first',
          selectedArtifacts: [{ kind: 'experience_recipe', ref: 'experience-2' }],
        }),
      );

      const completed = repo.recordOutcome(
        outcome({ decisionId: 'dc-artifact-completed-first', outcome: 'completed' }),
      );
      expect(completed).toMatchObject({
        status: 'ok',
        artifactUsage: {
          successful: true,
          adopted: true,
          selectedArtifacts: [{ kind: 'experience_recipe', ref: 'experience-2' }],
        },
      });

      const retried = repo.recordOutcome(
        outcome({
          decisionId: 'dc-artifact-completed-first',
          outcome: 'retried',
          recordedAt: '2026-04-22T11:01:00.000Z',
        }),
      );
      expect(retried).toMatchObject({ status: 'ok' });
      if (retried.status === 'ok') {
        expect(retried.artifactUsage).toBeUndefined();
      }
    } finally {
      close();
    }
  });

  it('maps a first fallback outcome to an unsuccessful artifact-use signal', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-artifact-fallback',
          selectedArtifacts: [{ kind: 'knowledge_page_model', ref: 'knowledge-2' }],
        }),
      );
      const result = repo.recordOutcome(
        outcome({ decisionId: 'dc-artifact-fallback', outcome: 'fallback' }),
      );
      expect(result).toMatchObject({
        status: 'ok',
        artifactUsage: {
          successful: false,
          adopted: false,
          selectedArtifacts: [{ kind: 'knowledge_page_model', ref: 'knowledge-2' }],
        },
      });
    } finally {
      close();
    }
  });

  it('rolls back the outcome when the atomic artifact-use writer fails', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-artifact-write-failed',
          selectedArtifacts: [{ kind: 'experience_recipe', ref: 'experience-3' }],
        }),
      );
      expect(() =>
        repo.recordOutcome(
          outcome({ decisionId: 'dc-artifact-write-failed', outcome: 'completed' }),
          () => {
            throw new Error('library write failed');
          },
        ),
      ).toThrow('library write failed');

      const aggregate = repo
        .aggregateStrategies()
        .find((row) => row.strategy === 'knowledge_light');
      expect(aggregate?.outcomes.completed).toBe(0);
    } finally {
      close();
    }
  });

  it('respects the optional `since` filter on aggregateStrategies', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(
        decision({
          decisionId: 'dc-old',
          strategy: 'read_page_required',
          createdAt: '2026-04-01T00:00:00.000Z',
        }),
      );
      repo.recordDecision(
        decision({
          decisionId: 'dc-new',
          strategy: 'knowledge_light',
          createdAt: '2026-04-22T00:00:00.000Z',
        }),
      );
      const recent = repo.aggregateStrategies('2026-04-15T00:00:00.000Z');
      const strategies = recent.map((a) => a.strategy).sort();
      expect(strategies).toEqual(['knowledge_light']);
    } finally {
      close();
    }
  });

  it('clear() empties both tables (test convenience)', () => {
    const { repo, close } = fresh();
    try {
      repo.recordDecision(decision({ decisionId: 'dc-c' }));
      repo.recordOutcome(outcome({ decisionId: 'dc-c' }));
      repo.clear();
      expect(repo.findDecision('dc-c')).toBeNull();
      expect(repo.aggregateStrategies()).toEqual([]);
    } finally {
      close();
    }
  });
});
