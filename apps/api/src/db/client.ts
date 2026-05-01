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

type SqliteTableInfoRow = {
  name: string;
};

function tableExists(sqlite: Database.Database, tableName: string): boolean {
  const row = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
    .get(tableName) as { name: string } | undefined;

  return row?.name === tableName;
}

function getTableColumnNames(sqlite: Database.Database, tableName: string): Set<string> {
  const rows = sqlite
    .prepare(`PRAGMA table_info(\`${tableName}\`)`)
    .all() as SqliteTableInfoRow[];

  return new Set(rows.map((row) => row.name));
}

/**
 * 修复已知的 additive migration 漂移。
 *
 * 这里处理的不是正常升级路径，而是历史本地库曾经处于“迁移记录已前进，
 * 但 branch_local_variable_snapshot 仍停留在旧表形状”的异常状态。
 *
 * 该漂移会让 Prompt Runtime preview 在读取 source floor snapshot 时直接触发
 * SQLITE_ERROR，而不是返回预期的 branch_local_snapshot_missing。
 *
 * 对这类旧库，追加列修复是安全的：
 * - snapshot_version 默认回填 1，继续按 v1 兼容语义读取
 * - provenance_json 默认为 NULL，旧行仍视为无 provenance
 */
function repairKnownAdditiveSchemaDrift(sqlite: Database.Database): void {
  const tableName = "branch_local_variable_snapshot";

  if (!tableExists(sqlite, tableName)) {
    return;
  }

  const columns = getTableColumnNames(sqlite, tableName);

  if (!columns.has("snapshot_version")) {
    sqlite.exec("ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `snapshot_version` integer NOT NULL DEFAULT 1;");
    columns.add("snapshot_version");
  }

  if (!columns.has("provenance_json")) {
    sqlite.exec("ALTER TABLE `branch_local_variable_snapshot` ADD COLUMN `provenance_json` text;");
  }
}

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

  sqlite.pragma(`busy_timeout = ${DEFAULT_BUSY_TIMEOUT_MS}`);

  const db = drizzle(sqlite, { schema });

  // Drizzle 的 SQLite migrator 会把整组 migration 放进单个事务。
  // 对于 0034 这类通过重建表来移除默认值的 migration，
  // 必须在进入事务前关闭 foreign_keys，否则文件内的 PRAGMA 不会生效。
  sqlite.pragma("foreign_keys = OFF");

  try {
    migrate(db, {
      migrationsFolder: resolveMigrationsPath(migrationsPath)
    });
  } finally {
    sqlite.pragma("foreign_keys = ON");
  }

  repairKnownAdditiveSchemaDrift(sqlite);

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
