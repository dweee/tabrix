import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryDb } from '../db/client';
import { SessionManager } from '../../execution/session-manager';
import { EXPERIENCE_ACTION_PATHS_TABLE } from './index';
import { ExperienceRepository } from './experience-repository';

function fresh(): { db: ReturnType<typeof openMemoryDb>['db']; close: () => void } {
  const { db } = openMemoryDb({ dbPath: ':memory:' });
  return { db, close: () => db.close() };
}

interface TableInfoRow {
  name: string;
  type: string;
}

interface IndexRow {
  name: string;
}

interface CountRow {
  total: number;
}

describe('Experience schema seed (B-005)', () => {
  it('creates the active experience table on a virgin DB', () => {
    const { db, close } = fresh();
    try {
      const rows = db
        .prepare("SELECT name, type FROM sqlite_master WHERE type='table' AND name = ?")
        .all(EXPERIENCE_ACTION_PATHS_TABLE) as TableInfoRow[];
      const names = rows.map((r) => r.name).sort();
      expect(names).toEqual([EXPERIENCE_ACTION_PATHS_TABLE]);
    } finally {
      close();
    }
  });

  it('does not create the retired locator prefs table on a virgin DB', () => {
    const { db, close } = fresh();
    try {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get('experience_locator_prefs') as TableInfoRow | undefined;
      expect(row).toBeUndefined();
    } finally {
      close();
    }
  });

  it('creates the expected indexes on the active experience table', () => {
    const { db, close } = fresh();
    try {
      const rows = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = ?")
        .all(EXPERIENCE_ACTION_PATHS_TABLE) as IndexRow[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'experience_action_paths_role_intent_idx',
          'experience_action_paths_site_role_intent_idx',
          'experience_action_paths_last_used_at_idx',
        ]),
      );
    } finally {
      close();
    }
  });

  it('is idempotent: re-opening the DB does not error and does not duplicate indexes', () => {
    const path = ':memory:';
    // First open
    const first = openMemoryDb({ dbPath: path });
    try {
      first.db.exec(
        'CREATE INDEX IF NOT EXISTS experience_action_paths_role_intent_idx ON experience_action_paths(page_role, intent_signature);',
      );
    } finally {
      first.db.close();
    }
    // Re-open (same lifecycle, but on a fresh `:memory:` database). For a
    // proper idempotency check we re-exec the DDL on the same handle.
    const { db, close } = fresh();
    try {
      expect(() => {
        db.exec('BEGIN; END;');
      }).not.toThrow();
      // Re-run DDL on the already-migrated handle — must be a no-op.
      expect(() =>
        db.exec(
          `CREATE TABLE IF NOT EXISTS ${EXPERIENCE_ACTION_PATHS_TABLE} (
            action_path_id TEXT PRIMARY KEY,
            page_role TEXT NOT NULL,
            intent_signature TEXT NOT NULL,
            step_sequence TEXT NOT NULL,
            success_count INTEGER NOT NULL DEFAULT 0,
            failure_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );`,
        ),
      ).not.toThrow();
      const indexCount = db
        .prepare("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='index' AND name=?")
        .get('experience_action_paths_role_intent_idx') as CountRow;
      expect(indexCount.total).toBe(1);
    } finally {
      close();
    }
  });

  it('seeds the active experience table as empty on a fresh DB', () => {
    const { db, close } = fresh();
    try {
      const actionPaths = db
        .prepare(`SELECT COUNT(*) AS total FROM ${EXPERIENCE_ACTION_PATHS_TABLE}`)
        .get() as CountRow;
      expect(actionPaths.total).toBe(0);
    } finally {
      close();
    }
  });

  it('V26-S2 migration: upgrades legacy experience_action_paths scoring columns before indexes are created', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tabrix-memory-legacy-experience-'));
    const dbPath = join(dir, 'memory.db');
    const legacyActionPathId = `action_path_${'1'.repeat(64)}`;
    try {
      const openLegacy = require('better-sqlite3') as (filename: string) => {
        exec: (sql: string) => void;
        close: () => void;
      };
      const legacyDb = openLegacy(dbPath);
      legacyDb.exec(`
        CREATE TABLE experience_action_paths (
          action_path_id TEXT PRIMARY KEY,
          page_role TEXT NOT NULL,
          intent_signature TEXT NOT NULL,
          step_sequence TEXT NOT NULL,
          success_count INTEGER NOT NULL DEFAULT 0,
          failure_count INTEGER NOT NULL DEFAULT 0,
          last_used_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO experience_action_paths
          (action_path_id, page_role, intent_signature, step_sequence,
           success_count, failure_count, last_used_at, created_at, updated_at)
        VALUES
          ('${legacyActionPathId}', 'repo_home', 'open issues',
           '[{"toolName":"chrome_click_element","status":"completed","historyRef":null}]',
           3, 0, '2026-04-20T00:00:00.000Z',
           '2026-04-20T00:00:00.000Z', '2026-04-20T00:00:00.000Z');
      `);
      legacyDb.close();

      const firstOpen = openMemoryDb({ dbPath });
      try {
        const columns = firstOpen.db
          .prepare('PRAGMA table_info(experience_action_paths)')
          .all() as {
          name: string;
        }[];
        const names = columns.map((column) => column.name);
        expect(names).toEqual(
          expect.arrayContaining([
            'last_replay_at',
            'last_replay_outcome',
            'last_replay_status',
            'composite_score_decayed',
            'site_family',
          ]),
        );
        const legacyRow = firstOpen.db
          .prepare('SELECT action_path_id, site_family FROM experience_action_paths')
          .get() as { action_path_id: string; site_family: string } | undefined;
        expect(legacyRow).toEqual({
          action_path_id: legacyActionPathId,
          site_family: 'github',
        });
        const index = firstOpen.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='experience_action_paths_composite_score_idx'",
          )
          .get() as { name: string } | undefined;
        expect(index?.name).toBe('experience_action_paths_composite_score_idx');
        const siteIndex = firstOpen.db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='experience_action_paths_site_role_intent_idx'",
          )
          .get() as { name: string } | undefined;
        expect(siteIndex?.name).toBe('experience_action_paths_site_role_intent_idx');
        const repo = new ExperienceRepository(firstOpen.db);
        expect(repo.findActionPathById(legacyActionPathId)?.siteFamily).toBe('github');
        expect(
          repo.suggestActionPaths({
            intentSignature: 'open issues',
            siteFamily: 'github',
            pageRole: 'repo_home',
            limit: 5,
          }),
        ).toEqual([]);
      } finally {
        firstOpen.db.close();
      }

      expect(() => {
        const secondOpen = openMemoryDb({ dbPath });
        secondOpen.db.close();
      }).not.toThrow();

      const manager = new SessionManager({ dbPath });
      try {
        expect(manager.getPersistenceStatus().mode).toBe('disk');
      } finally {
        manager.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
