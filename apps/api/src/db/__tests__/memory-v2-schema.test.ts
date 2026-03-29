import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { fileURLToPath } from "node:url";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import * as schema from "../schema.js";

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

const MIGRATIONS_PATH = fileURLToPath(new URL("../../../drizzle", import.meta.url));
const MEMORY_V2_MIGRATION_PATH = fileURLToPath(new URL("../../../drizzle/0020_memory_v2_schema_infra.sql", import.meta.url));

function getTableColumns(sqlite: Database.Database, tableName: string): TableInfoRow[] {
  return sqlite.prepare(`PRAGMA table_info(\`${tableName}\`)`).all() as TableInfoRow[];
}

function createPreMemoryV2MigrationsDir(): string {
  const tempDir = mkdtempSync(join(tmpdir(), "tavern-memory-v2-migrations-"));
  const metaDir = join(tempDir, "meta");
  cpSync(MIGRATIONS_PATH, tempDir, {
    recursive: true,
    filter: (source) => !source.endsWith("0020_memory_v2_schema_infra.sql") && !source.endsWith("meta\\_journal.json") && !source.endsWith("meta/_journal.json"),
  });

  const journalPath = join(MIGRATIONS_PATH, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries: Array<{ idx: number }>;
  };
  const trimmedJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 20),
  };
  writeFileSync(join(metaDir, "_journal.json"), JSON.stringify(trimmedJournal, null, 2));

  return tempDir;
}

describe("Memory V2 schema infrastructure", () => {
  let sqlite: Database.Database | undefined;
  let tempMigrationsDir: string | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
    if (tempMigrationsDir) {
      rmSync(tempMigrationsDir, { recursive: true, force: true });
      tempMigrationsDir = undefined;
    }
  });

  it("applies Memory V2 memory tables and columns through migrations", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_PATH });

    const memoryItemColumns = getTableColumns(sqlite, "memory_item");

    expect(memoryItemColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "summary_tier",
        "lifecycle_status",
        "source_job_id",
        "token_count_estimate",
        "last_used_at",
        "coverage_start_floor_no",
        "coverage_end_floor_no",
        "derived_from_count",
      ]),
    );

    const tableRows = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('memory_scope_state', 'memory_job')")
      .all() as Array<{ name: string }>;

    expect(tableRows.map((row) => row.name).sort()).toEqual([
      "memory_job",
      "memory_scope_state",
    ]);

    const indexRows = sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('memory_job_status_available_idx', 'memory_scope_state_account_scope_scope_id_uq')",
      )
      .all() as Array<{ name: string }>;

    expect(indexRows.map((row) => row.name).sort()).toEqual([
      "memory_job_status_available_idx",
      "memory_scope_state_account_scope_scope_id_uq",
    ]);

    const memoryEdgeRow = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_edge'")
      .get() as { sql: string } | undefined;

    expect(memoryEdgeRow?.sql).toContain("'derived_from'");
    expect(memoryEdgeRow?.sql).toContain("'compacts'");
    expect(memoryEdgeRow?.sql).toContain("'resolves'");
  });

  it("can roll back the 0020 Memory V2 migration inside a transactional savepoint", () => {
    sqlite = new Database(":memory:");
    sqlite.pragma("foreign_keys = ON");

    tempMigrationsDir = createPreMemoryV2MigrationsDir();
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: tempMigrationsDir });

    expect(getTableColumns(sqlite, "memory_item").map((column) => column.name)).not.toContain("summary_tier");

    const migrationSql = readFileSync(MEMORY_V2_MIGRATION_PATH, "utf-8");

    sqlite.exec("SAVEPOINT memory_v2_phase1;");
    sqlite.exec(migrationSql);

    expect(getTableColumns(sqlite, "memory_item").map((column) => column.name)).toEqual(
      expect.arrayContaining(["summary_tier", "lifecycle_status", "source_job_id"]),
    );
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_job'").get()).toBeDefined();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_scope_state'").get()).toBeDefined();

    sqlite.exec("ROLLBACK TO memory_v2_phase1;");
    sqlite.exec("RELEASE memory_v2_phase1;");

    const memoryItemColumns = getTableColumns(sqlite, "memory_item").map((column) => column.name);
    expect(memoryItemColumns).not.toContain("summary_tier");
    expect(memoryItemColumns).not.toContain("lifecycle_status");
    expect(memoryItemColumns).not.toContain("source_job_id");

    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_job'").get()).toBeUndefined();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_scope_state'").get()).toBeUndefined();

    const memoryEdgeRow = sqlite
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_edge'")
      .get() as { sql: string } | undefined;
    expect(memoryEdgeRow?.sql).not.toContain("'derived_from'");
    expect(memoryEdgeRow?.sql).not.toContain("'compacts'");
    expect(memoryEdgeRow?.sql).not.toContain("'resolves'");
  });
});
