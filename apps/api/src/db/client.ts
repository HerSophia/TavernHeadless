import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

const DEFAULT_DATABASE_PATH = "data/tavern-headless.db";
const DEFAULT_MIGRATIONS_PATH = fileURLToPath(new URL("../../drizzle", import.meta.url));
const DEFAULT_BUSY_TIMEOUT_MS = 5_000;

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Transaction executor type — the `tx` parameter received inside
 * `db.transaction(tx => ...)`.  Used to replace `any` in methods
 * that accept a transaction callback parameter.
 */
export type DbExecutor = Parameters<Parameters<AppDb["transaction"]>[0]>[0];

export type DatabaseConnection = {
  db: AppDb;
  close: () => void;
};

function resolveDatabasePath(databasePath: string): string {
  if (databasePath === ":memory:") {
    return databasePath;
  }

  const resolvedPath = resolve(process.cwd(), databasePath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  return resolvedPath;
}

export function createDatabase(
  databasePath = process.env.DATABASE_URL ?? DEFAULT_DATABASE_PATH,
  migrationsPath = DEFAULT_MIGRATIONS_PATH
): DatabaseConnection {
  const sqlite = new Database(resolveDatabasePath(databasePath));

  // 基础一致性与锁竞争配置。
  // :memory: 数据库不适用 WAL，因此仅在文件数据库上启用。
  // 若后续需要更细的锁争用观测，可在数据库工厂外围补充日志采样。
  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);

  const db = drizzle(sqlite, { schema });
  migrate(db, {
    migrationsFolder: resolveMigrationsPath(migrationsPath)
  });

  return {
    db,
    close: () => sqlite.close()
  };
}

function resolveMigrationsPath(migrationsPath: string): string {
  if (migrationsPath === ":memory:") {
    return migrationsPath;
  }

  return resolve(process.cwd(), migrationsPath);
}
