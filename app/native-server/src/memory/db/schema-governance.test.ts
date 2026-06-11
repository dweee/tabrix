import { openMemoryDb } from './client';
import {
  BROWSER_OBJECT_CREATE_TABLES_SQL,
  CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL,
  EXPERIENCE_CREATE_TABLES_SQL,
  EXPERIENCE_WRITEBACK_WARNINGS_CREATE_TABLES_SQL,
  KNOWLEDGE_CREATE_TABLES_SQL,
  MEMORY_CREATE_TABLES_SQL,
  MEMORY_DB_ACTIVE_TABLES,
  MEMORY_DB_ACTIVE_TABLE_MANIFEST,
  MEMORY_DB_RETIRED_TABLES,
  MKE_CORE_CREATE_TABLES_SQL,
  OPERATION_MEMORY_LOG_CREATE_TABLES_SQL,
} from './schema';

const SCHEMA_SQL_BLOCKS = [
  MEMORY_CREATE_TABLES_SQL,
  OPERATION_MEMORY_LOG_CREATE_TABLES_SQL,
  MKE_CORE_CREATE_TABLES_SQL,
  BROWSER_OBJECT_CREATE_TABLES_SQL,
  EXPERIENCE_CREATE_TABLES_SQL,
  KNOWLEDGE_CREATE_TABLES_SQL,
  CHOOSE_CONTEXT_TELEMETRY_CREATE_TABLES_SQL,
  EXPERIENCE_WRITEBACK_WARNINGS_CREATE_TABLES_SQL,
];

function extractCreatedTables(sqlBlocks: string[]): string[] {
  const tableNames = new Set<string>();
  const createTablePattern = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/gi;
  for (const sql of sqlBlocks) {
    for (const match of sql.matchAll(createTablePattern)) {
      tableNames.add(match[1]);
    }
  }
  return [...tableNames].sort();
}

describe('Memory DB schema governance', () => {
  it('keeps the active table manifest in lockstep with CREATE TABLE statements', () => {
    expect(extractCreatedTables(SCHEMA_SQL_BLOCKS)).toEqual([...MEMORY_DB_ACTIVE_TABLES].sort());
  });

  it('requires every active table to declare its product identity', () => {
    expect(MEMORY_DB_ACTIVE_TABLE_MANIFEST).toHaveLength(MEMORY_DB_ACTIVE_TABLES.length);
    for (const table of MEMORY_DB_ACTIVE_TABLE_MANIFEST) {
      expect(table.name).toMatch(/^[a-z0-9_]+$/);
      expect(table.layer).toMatch(/^[a-z0-9_]+$/);
      expect(table.surface).toMatch(/^[a-z0-9_]+$/);
      expect(table.purpose.length).toBeGreaterThan(20);
      expect(table.retention).toMatch(
        /^(active|migration_candidate|visibility_gap|projection_gap)$/,
      );
    }
  });

  it('does not create retired tables for new databases', () => {
    const opened = openMemoryDb({ dbPath: ':memory:' });
    try {
      for (const retiredTable of MEMORY_DB_RETIRED_TABLES) {
        const row = opened.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(retiredTable.name) as { name: string } | undefined;
        expect(row).toBeUndefined();
      }
    } finally {
      opened.db.close();
    }
  });
});
