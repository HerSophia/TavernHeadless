import process from "node:process";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDatabase } from "../src/db/client.js";
import {
  MemoryMaintenanceService,
  type MemoryMaintenancePolicy,
} from "../src/services/memory-maintenance-service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 从 monorepo 根目录加载 .env（与 apps/api/src/index.ts 保持一致）
loadDotenv({ path: resolve(__dirname, "../../../.env") });

type CliOptions = {
  databasePath?: string;
  dryRun: boolean;
  batchSize: number;
  summaryDays: number;
  openLoopDays: number;
  purgeDays: number;
};

function printHelp(): void {
  console.log(`Usage: pnpm --filter @tavern/api exec tsx scripts/memory-maintenance.ts [options]

Options:
  --db, --database <path>        SQLite database path (default: env DATABASE_URL or data/tavern-headless.db)
  --dry-run                      Only print stats, do not write/delete
  --batch-size <n>               Batch size (default: env MEMORY_MAINTENANCE_BATCH_SIZE or 500)
  --summary-days <n>             Deprecate summary older than N days (0 disables; default: env ... or 30)
  --open-loop-days <n>           Deprecate open_loop older than N days (0 disables; default: env ... or 7)
  --purge-deprecated-days <n>    Purge deprecated rows untouched for N days while deprecated (uses updatedAt; 0 disables; default: env ... or 90)
  -h, --help                     Show this help
`);
}

function parsePositiveInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseNonNegativeInt(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseArgs(args: string[]): CliOptions {
  const defaults = {
    batchSize: parsePositiveInt(process.env.MEMORY_MAINTENANCE_BATCH_SIZE) ?? 500,
    summaryDays: parseNonNegativeInt(process.env.MEMORY_MAINTENANCE_DEPRECATE_SUMMARY_DAYS) ?? 30,
    openLoopDays: parseNonNegativeInt(process.env.MEMORY_MAINTENANCE_DEPRECATE_OPEN_LOOP_DAYS) ?? 7,
    purgeDays: parseNonNegativeInt(process.env.MEMORY_MAINTENANCE_PURGE_DEPRECATED_DAYS) ?? 90,
  };

  const options: CliOptions = {
    databasePath: undefined,
    dryRun: false,
    batchSize: defaults.batchSize,
    summaryDays: defaults.summaryDays,
    openLoopDays: defaults.openLoopDays,
    purgeDays: defaults.purgeDays,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (arg === "--db" || arg === "--database") {
      const value = args[i + 1];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      options.databasePath = value;
      i += 1;
      continue;
    }

    if (arg === "--batch-size") {
      const value = args[i + 1];
      if (!value) throw new Error("--batch-size requires a value");
      const parsed = parsePositiveInt(value);
      if (!parsed) throw new Error(`Invalid --batch-size: ${value}`);
      options.batchSize = parsed;
      i += 1;
      continue;
    }

    if (arg === "--summary-days") {
      const value = args[i + 1];
      if (!value) throw new Error("--summary-days requires a value");
      const parsed = parseNonNegativeInt(value);
      if (parsed === undefined) throw new Error(`Invalid --summary-days: ${value}`);
      options.summaryDays = parsed;
      i += 1;
      continue;
    }

    if (arg === "--open-loop-days") {
      const value = args[i + 1];
      if (!value) throw new Error("--open-loop-days requires a value");
      const parsed = parseNonNegativeInt(value);
      if (parsed === undefined) throw new Error(`Invalid --open-loop-days: ${value}`);
      options.openLoopDays = parsed;
      i += 1;
      continue;
    }

    if (arg === "--purge-deprecated-days") {
      const value = args[i + 1];
      if (!value) throw new Error("--purge-deprecated-days requires a value");
      const parsed = parseNonNegativeInt(value);
      if (parsed === undefined) throw new Error(`Invalid --purge-deprecated-days: ${value}`);
      options.purgeDays = parsed;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  const database = createDatabase(options.databasePath);
  const service = new MemoryMaintenanceService(database.db);

  try {
    const dayMs = 24 * 60 * 60 * 1000;
    const policy: MemoryMaintenancePolicy = {
      ...(options.summaryDays > 0 ? { summaryMaxAgeMs: options.summaryDays * dayMs } : {}),
      ...(options.openLoopDays > 0 ? { openLoopMaxAgeMs: options.openLoopDays * dayMs } : {}),
      ...(options.purgeDays > 0 ? { deprecatedPurgeAgeMs: options.purgeDays * dayMs } : {}),
    };

    const result = await service.run({
      dryRun: options.dryRun,
      batchSize: options.batchSize,
      policy,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    database.close();
  }
}

main().catch((error) => {
  console.error("[memory:maintenance] failed", error);
  process.exit(1);
});
