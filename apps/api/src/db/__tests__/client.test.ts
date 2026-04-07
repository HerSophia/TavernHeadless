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
  let tempDir: string | undefined;
  let tempMigrationsDir: string | undefined;

  afterEach(() => {
    connection?.close();
    connection = undefined;

    seedSqlite?.close();
    seedSqlite = undefined;

    verifySqlite?.close();
    verifySqlite = undefined;

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

    const llmProfileColumns = verifySqlite
      .prepare("PRAGMA table_info(`llm_profile`)")
      .all() as Array<{ name: string; dflt_value: string | null }>;
    const llmProfileBindingColumns = verifySqlite
      .prepare("PRAGMA table_info(`llm_profile_binding`)")
      .all() as Array<{ name: string; dflt_value: string | null }>;

    expect(llmProfileColumns.find((column) => column.name === "account_id")?.dflt_value).toBeNull();
    expect(llmProfileBindingColumns.find((column) => column.name === "account_id")?.dflt_value).toBeNull();
    expect(
      verifySqlite.prepare("SELECT COUNT(*) AS count FROM llm_profile").get()
    ).toEqual({ count: 1 });
    expect(
      verifySqlite.prepare("SELECT COUNT(*) AS count FROM llm_profile_binding").get()
    ).toEqual({ count: 1 });
  });
});
