import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import * as schema from "./schema";

const DEFAULT_DATABASE_PATH = "data/tavern-headless.db";
const DEFAULT_MIGRATIONS_PATH = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;
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
  sqlite.pragma("foreign_keys = ON");

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
