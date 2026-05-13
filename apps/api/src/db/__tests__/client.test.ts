import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../client.js";
import * as schema from "../schema.js";

const MIGRATIONS_PATH = fileURLToPath(new URL("../../../drizzle", import.meta.url));

type TableInfoRow = {
  name: string;
  dflt_value: string | null;
};

function getTableColumns(sqlite: Database.Database, tableName: string): TableInfoRow[] {
  return sqlite.prepare(`PRAGMA table_info(\`${tableName}\`)`).all() as TableInfoRow[];
}

function getTableNames(sqlite: Database.Database): string[] {
  return sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")
    .all()
    .map((row) => (row as { name: string }).name);
}

function replaceMigrationHistory(
  targetSqlite: Database.Database,
  sourceSqlite: Database.Database,
): void {
  const rows = sourceSqlite
    .prepare("SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at ASC")
    .all() as Array<{ hash: string; created_at: number }>;

  targetSqlite.prepare("DELETE FROM __drizzle_migrations").run();

  if (rows.length === 0) {
    return;
  }

  const insert = targetSqlite.prepare("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)");
  const insertMany = targetSqlite.transaction((items: Array<{ hash: string; created_at: number }>) => {
    for (const item of items) {
      insert.run(item.hash, item.created_at);
    }
  });
  insertMany(rows);
}

function createMigrationsDirBeforeIndex(maxExclusive: number): string {
  const tempDir = mkdtempSync(join(tmpdir(), "tavern-db-migrations-"));
  const metaDir = join(tempDir, "meta");

  cpSync(MIGRATIONS_PATH, tempDir, {
    recursive: true,
    filter: (source) => !source.endsWith("meta\\_journal.json") && !source.endsWith("meta/_journal.json"),
  });

  const journalPath = join(MIGRATIONS_PATH, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries: Array<{ idx: number }>;
  };
  const trimmedJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < maxExclusive),
  };

  writeFileSync(join(metaDir, "_journal.json"), JSON.stringify(trimmedJournal, null, 2));

  return tempDir;
}

describe("createDatabase", () => {
  let seedSqlite: Database.Database | undefined;
  let connection: DatabaseConnection | undefined;
  let verifySqlite: Database.Database | undefined;
  let migrationSourceSqlite: Database.Database | undefined;
  let tempDir: string | undefined;
  let tempMigrationsDir: string | undefined;

  afterEach(() => {
    connection?.close();
    connection = undefined;

    seedSqlite?.close();
    seedSqlite = undefined;

    verifySqlite?.close();
    verifySqlite = undefined;

    migrationSourceSqlite?.close();
    migrationSourceSqlite = undefined;

    if (tempMigrationsDir) {
      rmSync(tempMigrationsDir, { recursive: true, force: true });
      tempMigrationsDir = undefined;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("can migrate rebuild-style tables that still have referencing rows", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tavern-db-"));
    tempMigrationsDir = createMigrationsDirBeforeIndex(34);

    const databasePath = join(tempDir, "tavern.db");
    const now = 1_700_000_000_000;

    seedSqlite = new Database(databasePath);
    seedSqlite.pragma("foreign_keys = ON");

    const seedDb = drizzle(seedSqlite, { schema });
    migrate(seedDb, { migrationsFolder: tempMigrationsDir });

    seedSqlite
      .prepare(
        `INSERT INTO llm_profile (
          id,
          preset_name,
          provider,
          model_id,
          api_key_encrypted,
          api_key_masked,
          status,
          created_at,
          updated_at,
          account_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "llm-profile-1",
        "Default",
        "openai",
        "gpt-4o-mini",
        "encrypted",
        "****",
        "active",
        now,
        now,
        "default-admin"
      );

    seedSqlite
      .prepare(
        `INSERT INTO llm_profile_binding (
          id,
          scope,
          scope_id,
          profile_id,
          created_at,
          updated_at,
          instance_slot,
          account_id,
          params_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "llm-binding-1",
        "global",
        "global",
        "llm-profile-1",
        now,
        now,
        "*",
        "default-admin",
        null
      );

    seedSqlite.close();
    seedSqlite = undefined;

    connection = createDatabase(databasePath);
    connection.close();
    connection = undefined;

    verifySqlite = new Database(databasePath);

    const llmProfileColumns = getTableColumns(verifySqlite, "llm_profile");
    const llmProfileBindingColumns = getTableColumns(verifySqlite, "llm_profile_binding");

    expect(llmProfileColumns.find((column) => column.name === "account_id")?.dflt_value).toBeNull();
    expect(llmProfileBindingColumns.find((column) => column.name === "account_id")?.dflt_value).toBeNull();
    expect(
      verifySqlite.prepare("SELECT COUNT(*) AS count FROM llm_profile").get()
    ).toEqual({ count: 1 });
    expect(
      verifySqlite.prepare("SELECT COUNT(*) AS count FROM llm_profile_binding").get()
    ).toEqual({ count: 1 });
  });

  it("repairs drifted branch_local_variable_snapshot additive columns even when migration history is already up to date", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tavern-db-"));
    tempMigrationsDir = createMigrationsDirBeforeIndex(40);

    const databasePath = join(tempDir, "tavern.db");

    seedSqlite = new Database(databasePath);
    seedSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(seedSqlite, { schema }), { migrationsFolder: tempMigrationsDir });

    expect(getTableColumns(seedSqlite, "branch_local_variable_snapshot").map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["snapshot_version", "provenance_json"]),
    );

    migrationSourceSqlite = new Database(":memory:");
    migrationSourceSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(migrationSourceSqlite, { schema }), { migrationsFolder: MIGRATIONS_PATH });

    replaceMigrationHistory(seedSqlite, migrationSourceSqlite);

    seedSqlite.close();
    seedSqlite = undefined;

    connection = createDatabase(databasePath);
    connection.close();
    connection = undefined;

    verifySqlite = new Database(databasePath);

    const repairedColumns = getTableColumns(verifySqlite, "branch_local_variable_snapshot");
    expect(repairedColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["snapshot_version", "provenance_json"]),
    );
    expect(repairedColumns.find((column) => column.name === "snapshot_version")?.dflt_value).toBe("1");

    verifySqlite.prepare(
      `INSERT OR IGNORE INTO account (
        id,
        name,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?)`
    ).run("default-admin", "default-admin", 1_735_700_000_000, 1_735_700_000_000);

    verifySqlite.prepare(
      `INSERT OR IGNORE INTO session (
        id,
        account_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?)`
    ).run("session-1", "default-admin", 1_735_700_000_000, 1_735_700_000_000);

    verifySqlite.prepare(
      `INSERT OR IGNORE INTO floor (
        id,
        session_id,
        floor_no,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run("floor-1", "session-1", 1, 1_735_700_000_000, 1_735_700_000_000);

    verifySqlite.prepare(
      `INSERT INTO branch_local_variable_snapshot (
        floor_id,
        account_id,
        session_id,
        branch_id,
        values_json,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "floor-1",
      "default-admin",
      "session-1",
      "main",
      JSON.stringify({ mood: "steady" }),
      1_735_700_000_000,
    );

    expect(
      verifySqlite.prepare("SELECT snapshot_version, provenance_json FROM branch_local_variable_snapshot WHERE floor_id = ?").get("floor-1")
    ).toEqual({ snapshot_version: 1, provenance_json: null });
  });

  it("repairs additive client-data, session-state, and session-branch structures even when migration history is already up to date", () => {
    tempDir = mkdtempSync(join(tmpdir(), "tavern-db-"));
    tempMigrationsDir = createMigrationsDirBeforeIndex(38);

    const databasePath = join(tempDir, "tavern.db");
    const now = 1_735_700_100_000;

    seedSqlite = new Database(databasePath);
    seedSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(seedSqlite, { schema }), { migrationsFolder: tempMigrationsDir });

    expect(getTableColumns(seedSqlite, "client_data_domain").map((column) => column.name)).not.toContain("version");
    expect(getTableColumns(seedSqlite, "client_data_collection").map((column) => column.name)).not.toContain("version");
    expect(getTableNames(seedSqlite)).not.toEqual(expect.arrayContaining([
      "client_data_domain_grant",
      "client_data_audit_log",
      "client_data_managed_domain",
      "session_state_mutation",
      "session_state_namespace_registration",
      "session_branch",
    ]));

    seedSqlite.prepare(
      `INSERT OR IGNORE INTO account (
        id,
        name,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?)`
    ).run("default-admin", "default-admin", now, now);

    seedSqlite.prepare(
      `INSERT INTO session (
        id,
        account_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)`
    ).run("session-drift", "default-admin", "active", now, now + 50);

    seedSqlite.prepare(
      `INSERT INTO floor (
        id,
        session_id,
        floor_no,
        branch_id,
        parent_floor_id,
        state,
        token_in,
        token_out,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run("floor-alt", "session-drift", 1, "alt", null, "committed", 0, 0, now + 10, now + 20);

    migrationSourceSqlite = new Database(":memory:");
    migrationSourceSqlite.pragma("foreign_keys = ON");
    migrate(drizzle(migrationSourceSqlite, { schema }), { migrationsFolder: MIGRATIONS_PATH });

    replaceMigrationHistory(seedSqlite, migrationSourceSqlite);

    seedSqlite.close();
    seedSqlite = undefined;

    connection = createDatabase(databasePath);
    connection.close();
    connection = undefined;

    verifySqlite = new Database(databasePath);

    expect(getTableColumns(verifySqlite, "client_data_domain").map((column) => column.name)).toContain("version");
    expect(getTableColumns(verifySqlite, "client_data_collection").map((column) => column.name)).toContain("version");
    expect(getTableNames(verifySqlite)).toEqual(expect.arrayContaining([
      "client_data_domain_grant",
      "client_data_audit_log",
      "client_data_managed_domain",
      "session_state_mutation",
      "session_state_namespace_registration",
      "session_branch",
      "workspace",
      "project",
    ]));

    expect(
      verifySqlite.prepare("SELECT branch_id FROM session_branch WHERE session_id = ? ORDER BY branch_id ASC").all("session-drift")
    ).toEqual([
      { branch_id: "alt" },
      { branch_id: "main" },
    ]);

    expect(
      verifySqlite.prepare("SELECT id, account_id, is_default FROM workspace WHERE account_id = ?").get("default-admin")
    ).toEqual({
      id: "ws_default_default-admin",
      account_id: "default-admin",
      is_default: 1,
    });
    expect(
      verifySqlite.prepare("SELECT workspace_id, project_id FROM session WHERE id = ?").get("session-drift")
    ).toEqual({
      workspace_id: "ws_default_default-admin",
      project_id: "proj_session_session-drift",
    });
    expect(
      verifySqlite.prepare("SELECT id, workspace_id, kind FROM project WHERE id = ?").get("proj_session_session-drift")
    ).toEqual({
      id: "proj_session_session-drift",
      workspace_id: "ws_default_default-admin",
      kind: "session_default",
    });
  });
});
