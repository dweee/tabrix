import { openMemoryDb } from '../db/client';
import {
  ExperienceRepository,
  EXPERIENCE_SUGGEST_MIN_COMPOSITE_SCORE,
  EXPERIENCE_SUGGEST_MIN_SUCCESS_COUNT,
  EXPERIENCE_SUGGEST_MIN_SUCCESS_RATE,
  ExperienceSuggestPlanInputError,
  buildSuggestPlanResult,
  parseExperienceSuggestPlanInput,
} from './index';

describe('parseExperienceSuggestPlanInput (B-013)', () => {
  it('rejects missing args', () => {
    expect(() => parseExperienceSuggestPlanInput(undefined)).toThrow(
      ExperienceSuggestPlanInputError,
    );
    expect(() => parseExperienceSuggestPlanInput(null)).toThrow(ExperienceSuggestPlanInputError);
  });

  it('rejects non-object args', () => {
    expect(() => parseExperienceSuggestPlanInput('hi')).toThrow(ExperienceSuggestPlanInputError);
    expect(() => parseExperienceSuggestPlanInput(['intent'])).toThrow(
      ExperienceSuggestPlanInputError,
    );
  });

  it('requires non-empty intent', () => {
    expect(() => parseExperienceSuggestPlanInput({})).toThrow(/intent.*required/i);
    expect(() => parseExperienceSuggestPlanInput({ intent: '' })).toThrow(/intent/i);
    expect(() => parseExperienceSuggestPlanInput({ intent: '   ' })).toThrow(/intent/i);
  });

  it('rejects wrong types for intent / pageRole / limit', () => {
    expect(() => parseExperienceSuggestPlanInput({ intent: 123 })).toThrow(/string/);
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', pageRole: 7 })).toThrow(
      /string/,
    );
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', limit: '3' })).toThrow(
      /number/,
    );
    expect(() => parseExperienceSuggestPlanInput({ intent: 'open issues', limit: 1.5 })).toThrow(
      /integer/,
    );
    expect(() =>
      parseExperienceSuggestPlanInput({ intent: 'open issues', limit: Number.NaN }),
    ).toThrow(/finite/);
  });

  it('normalizes intent identically to the aggregator (whitespace + case)', () => {
    const a = parseExperienceSuggestPlanInput({ intent: '  Open   Issues  ' });
    const b = parseExperienceSuggestPlanInput({ intent: 'open issues' });
    expect(a.intentSignature).toBe('open issues');
    expect(b.intentSignature).toBe('open issues');
  });

  it('truncates long intent before normalization to keep the bucket stable', () => {
    const longIntent = 'open issues '.repeat(200);
    const parsed = parseExperienceSuggestPlanInput({ intent: longIntent });
    expect(parsed.intent.length).toBeLessThanOrEqual(1024);
    // Normalization still collapses whitespace, so signature is bounded too.
    expect(parsed.intentSignature.length).toBeLessThanOrEqual(1024);
  });

  it('treats blank pageRole as "no filter"', () => {
    const parsed = parseExperienceSuggestPlanInput({
      intent: 'open issues',
      pageRole: '   ',
    });
    expect(parsed.pageRole).toBeUndefined();
  });

  it('rejects pageRole longer than the cap', () => {
    expect(() =>
      parseExperienceSuggestPlanInput({
        intent: 'open issues',
        pageRole: 'r'.repeat(200),
      }),
    ).toThrow(/pageRole.*128/);
  });

  it('clamps limit to [1, 5] and defaults to 1', () => {
    expect(parseExperienceSuggestPlanInput({ intent: 'i' }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 0 }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: -3 }).limit).toBe(1);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 5 }).limit).toBe(5);
    expect(parseExperienceSuggestPlanInput({ intent: 'i', limit: 99 }).limit).toBe(5);
  });
});

describe('buildSuggestPlanResult (B-013, pure)', () => {
  it('emits no_match for empty rows', () => {
    const result = buildSuggestPlanResult([], 'disk');
    expect(result).toEqual({
      status: 'no_match',
      plans: [],
      persistenceMode: 'disk',
    });
  });

  it('computes successRate and projects step shape from rows', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-1',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [
            { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
            { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
          ],
          successCount: 3,
          failureCount: 1,
          compositeScoreDecayed: 0.8,
          lastUsedAt: '2026-04-21T10:00:00.000Z',
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('ok');
    expect(result.persistenceMode).toBe('disk');
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0]).toMatchObject({
      actionPathId: 'ap-1',
      pageRole: 'repo_home',
      intentSignature: 'open issues',
      successCount: 3,
      failureCount: 1,
      lastUsedAt: '2026-04-21T10:00:00.000Z',
      steps: [
        { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
        { toolName: 'chrome_read_page', status: 'completed', historyRef: null },
      ],
    });
    expect(result.plans[0].successRate).toBeCloseTo(0.75, 5);
  });

  it('filters rows with zero successful observations', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-empty',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 0,
          failureCount: 0,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'memory',
    );
    expect(result.status).toBe('no_match');
    expect(result.plans).toEqual([]);
    expect(result.persistenceMode).toBe('memory');
  });

  it('filters rows below the suggestion evidence gate', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-zero',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 0,
          failureCount: 4,
          compositeScoreDecayed: 0.9,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
        {
          actionPathId: 'ap-low-sample',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 1,
          failureCount: 0,
          compositeScoreDecayed: 0.9,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('no_match');
    expect(result.plans).toEqual([]);
    expect(EXPERIENCE_SUGGEST_MIN_SUCCESS_COUNT).toBe(3);
    expect(EXPERIENCE_SUGGEST_MIN_SUCCESS_RATE).toBe(0.7);
    expect(EXPERIENCE_SUGGEST_MIN_COMPOSITE_SCORE).toBe(0.7);
  });

  it('filters rows without a scored composite quality signal', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-unscored',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 10,
          failureCount: 0,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('no_match');
    expect(result.plans).toEqual([]);
  });

  it('filters rows below the composite score gate', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-low-score',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 10,
          failureCount: 0,
          compositeScoreDecayed: 0.69,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('no_match');
    expect(result.plans).toEqual([]);
  });

  it('keeps rows that clear the full suggestion evidence gate', () => {
    const result = buildSuggestPlanResult(
      [
        {
          actionPathId: 'ap-good',
          pageRole: 'repo_home',
          intentSignature: 'open issues',
          stepSequence: [],
          successCount: 3,
          failureCount: 1,
          compositeScoreDecayed: 0.8,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z',
        },
      ],
      'disk',
    );
    expect(result.status).toBe('ok');
    expect(result.plans.map((p) => p.actionPathId)).toEqual(['ap-good']);
    expect(result.plans[0].successRate).toBeCloseTo(0.75, 5);
  });
});

describe('ExperienceRepository.suggestActionPaths (B-013, SQL)', () => {
  function bootstrap() {
    const { db } = openMemoryDb({ dbPath: ':memory:' });
    const repo = new ExperienceRepository(db);
    return { db, repo, close: () => db.close() };
  }

  function seed(
    repo: ExperienceRepository,
    overrides: Partial<{
      actionPathId: string;
      siteFamily: string;
      pageRole: string;
      intentSignature: string;
      successDelta: number;
      failureDelta: number;
      lastUsedAt: string;
      stepSequence: { toolName: string; status: string; historyRef: string | null }[];
      compositeScoreDecayed: number | null;
    }>,
  ) {
    repo.upsertActionPath({
      actionPathId: overrides.actionPathId ?? 'ap-x',
      siteFamily: overrides.siteFamily ?? 'github',
      pageRole: overrides.pageRole ?? 'repo_home',
      intentSignature: overrides.intentSignature ?? 'open issues',
      stepSequence: overrides.stepSequence ?? [
        { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://a' },
      ],
      successDelta: overrides.successDelta ?? 1,
      failureDelta: overrides.failureDelta ?? 0,
      lastUsedAt: overrides.lastUsedAt ?? '2026-04-20T00:00:00.000Z',
      createdAt: '2026-04-20T00:00:00.000Z',
      updatedAt: '2026-04-20T00:00:00.000Z',
    });
    const compositeScoreDecayed = Object.hasOwn(overrides, 'compositeScoreDecayed')
      ? (overrides.compositeScoreDecayed ?? null)
      : 0.8;
    if (compositeScoreDecayed !== null) {
      repo.updateCompositeScoreForActionPath({
        actionPathId: overrides.actionPathId ?? 'ap-x',
        compositeScoreDecayed,
        nowIso: '2026-04-20T00:00:00.000Z',
      });
    }
  }

  it('returns [] when no row matches the intent signature', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, { intentSignature: 'open issues' });
      const rows = repo.suggestActionPaths({
        intentSignature: 'something else',
        siteFamily: 'github',
        limit: 1,
      });
      expect(rows).toEqual([]);
    } finally {
      close();
    }
  });

  it('returns the matching row(s) ordered by composite score then success_count', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-low',
        pageRole: 'repo_home',
        successDelta: 3,
        failureDelta: 1,
        compositeScoreDecayed: 0.9,
        lastUsedAt: '2026-04-20T01:00:00.000Z',
      });
      seed(repo, {
        actionPathId: 'ap-high',
        pageRole: 'issues_list',
        successDelta: 5,
        failureDelta: 0,
        compositeScoreDecayed: 0.8,
        lastUsedAt: '2026-04-20T02:00:00.000Z',
      });

      const rows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        limit: 5,
      });
      expect(rows.map((r) => r.actionPathId)).toEqual(['ap-low', 'ap-high']);
    } finally {
      close();
    }
  });

  it('respects pageRole filter and never returns rows from other roles', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-repo',
        pageRole: 'repo_home',
        successDelta: 10,
      });
      seed(repo, {
        actionPathId: 'ap-issues',
        pageRole: 'issues_list',
        successDelta: 3,
      });

      const onlyIssues = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        pageRole: 'issues_list',
        limit: 5,
      });
      expect(onlyIssues.map((r) => r.actionPathId)).toEqual(['ap-issues']);
    } finally {
      close();
    }
  });

  it('clamps limit to >= 1 even when caller passes 0 or negative', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, { actionPathId: 'ap-only', successDelta: 3, failureDelta: 0 });
      const zero = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        limit: 0,
      });
      expect(zero).toHaveLength(1);
      const negative = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        limit: -10,
      });
      expect(negative).toHaveLength(1);
    } finally {
      close();
    }
  });

  it('breaks ties on last_used_at DESC then action_path_id ASC', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-old',
        successDelta: 3,
        failureDelta: 0,
        compositeScoreDecayed: 0.8,
        lastUsedAt: '2026-04-19T00:00:00.000Z',
      });
      seed(repo, {
        actionPathId: 'ap-new',
        successDelta: 3,
        failureDelta: 0,
        compositeScoreDecayed: 0.8,
        lastUsedAt: '2026-04-21T00:00:00.000Z',
      });
      const rows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        limit: 5,
      });
      expect(rows.map((r) => r.actionPathId)).toEqual(['ap-new', 'ap-old']);
    } finally {
      close();
    }
  });

  it('fails closed when the caller does not provide a known siteFamily', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, { actionPathId: 'ap-github', siteFamily: 'github', successDelta: 5 });
      expect(
        repo.suggestActionPaths({
          intentSignature: 'open issues',
          limit: 5,
        }),
      ).toEqual([]);
      expect(
        repo.suggestActionPaths({
          intentSignature: 'open issues',
          siteFamily: 'unknown',
          limit: 5,
        }),
      ).toEqual([]);
    } finally {
      close();
    }
  });

  it('keeps identical pageRole and intent isolated by siteFamily', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-github',
        siteFamily: 'github',
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        successDelta: 10,
      });
      seed(repo, {
        actionPathId: 'ap-example',
        siteFamily: 'example.com',
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        successDelta: 3,
      });

      const githubRows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'github',
        pageRole: 'repo_home',
        limit: 5,
      });
      expect(githubRows.map((r) => r.actionPathId)).toEqual(['ap-github']);

      const exampleRows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'example.com',
        pageRole: 'repo_home',
        limit: 5,
      });
      expect(exampleRows.map((r) => r.actionPathId)).toEqual(['ap-example']);
    } finally {
      close();
    }
  });

  it('preserves the existing siteFamily when a same-id upsert omits siteFamily', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-site-preserve',
        siteFamily: 'example.com',
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        successDelta: 2,
      });
      repo.upsertActionPath({
        actionPathId: 'ap-site-preserve',
        pageRole: 'repo_home',
        intentSignature: 'open issues',
        stepSequence: [
          { toolName: 'chrome_click_element', status: 'completed', historyRef: 'h://later' },
        ],
        successDelta: 2,
        failureDelta: 0,
        lastUsedAt: '2026-04-21T00:00:00.000Z',
        createdAt: '2026-04-21T00:00:00.000Z',
        updatedAt: '2026-04-21T00:00:00.000Z',
      });

      const rows = repo.suggestActionPaths({
        intentSignature: 'open issues',
        siteFamily: 'example.com',
        pageRole: 'repo_home',
        limit: 5,
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        actionPathId: 'ap-site-preserve',
        siteFamily: 'example.com',
        successCount: 4,
      });
      expect(
        repo.suggestActionPaths({
          intentSignature: 'open issues',
          siteFamily: 'unknown',
          pageRole: 'repo_home',
          limit: 5,
        }),
      ).toEqual([]);
    } finally {
      close();
    }
  });

  it('filters SQL rows that have enough wins but no composite score', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-unscored',
        successDelta: 10,
        failureDelta: 0,
        compositeScoreDecayed: null,
      });
      expect(
        repo.suggestActionPaths({
          intentSignature: 'open issues',
          siteFamily: 'github',
          limit: 5,
        }),
      ).toEqual([]);
    } finally {
      close();
    }
  });

  it('filters SQL rows below the composite score gate', () => {
    const { repo, close } = bootstrap();
    try {
      seed(repo, {
        actionPathId: 'ap-low-score',
        successDelta: 10,
        failureDelta: 0,
        compositeScoreDecayed: 0.69,
      });
      expect(
        repo.suggestActionPaths({
          intentSignature: 'open issues',
          siteFamily: 'github',
          limit: 5,
        }),
      ).toEqual([]);
    } finally {
      close();
    }
  });
});
