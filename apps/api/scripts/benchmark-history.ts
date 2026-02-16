import { performance } from "node:perf_hooks";

import { nanoid } from "nanoid";
import type { TurnOrchestrator, TurnOutput } from "@tavern/core";
import { SimpleTokenCounter } from "@tavern/core";

import { createDatabase } from "../src/db/client.js";
import { floors, messagePages, messages, sessions } from "../src/db/schema.js";
import { ChatService } from "../src/services/chat-service.js";
import { eq } from "drizzle-orm";

type BenchmarkOptions = {
  floors: number;
  rounds: number;
  userMessageSize: number;
  historyMaxFloors?: number;
};

const DEFAULT_OPTIONS: BenchmarkOptions = {
  floors: 300,
  rounds: 5,
  userMessageSize: 64,
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const database = createDatabase(":memory:");

  const mockTurnOutput: TurnOutput = {
    floorId: "",
    generatedText: "Benchmark assistant output.",
    rawText: "Benchmark assistant output.",
    summaries: [],
    totalUsage: {
      promptTokens: 100,
      completionTokens: 30,
      totalTokens: 130,
    },
    finalState: "committed",
  };

  const mockOrchestrator: TurnOrchestrator = {
    executeTurn: async (input) => {
      await database.db
        .update(floors)
        .set({ state: "committed", updatedAt: Date.now() })
        .where(eq(floors.id, input.floorId));

      return {
        ...mockTurnOutput,
        floorId: input.floorId,
      };
    },
  } as TurnOrchestrator;

  const chatService = new ChatService(
    database.db,
    mockOrchestrator,
    new SimpleTokenCounter(),
    { historyMaxFloors: options.historyMaxFloors }
  );

  const sessionId = nanoid();
  await seedSession(database.db, sessionId, options.floors);

  const inputMessage = "x".repeat(options.userMessageSize);
  const latenciesMs: number[] = [];

  for (let i = 0; i < options.rounds; i += 1) {
    const startedAt = performance.now();
    await chatService.respond(sessionId, { message: inputMessage });
    latenciesMs.push(performance.now() - startedAt);
  }

  database.close();

  const stats = summarizeLatencies(latenciesMs);
  const appliedHistoryCap = options.historyMaxFloors ?? "unlimited";

  console.log("[benchmark-history] done");
  console.log(`floors=${options.floors}, rounds=${options.rounds}, history_max_floors=${appliedHistoryCap}`);
  console.log(`user_message_size=${options.userMessageSize}`);
  console.log(`latency_ms avg=${stats.avg.toFixed(2)} p50=${stats.p50.toFixed(2)} p95=${stats.p95.toFixed(2)}`);
}

function parseArgs(args: string[]): BenchmarkOptions {
  const parsed: BenchmarkOptions = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=");
    const nextValue = inlineValue ?? args[i + 1];
    const consumeNext = inlineValue === undefined;

    switch (key) {
      case "floors": {
        parsed.floors = readPositiveInt(nextValue, "floors");
        break;
      }
      case "rounds": {
        parsed.rounds = readPositiveInt(nextValue, "rounds");
        break;
      }
      case "user-message-size": {
        parsed.userMessageSize = readPositiveInt(nextValue, "user-message-size");
        break;
      }
      case "history-max-floors": {
        parsed.historyMaxFloors = readPositiveInt(nextValue, "history-max-floors");
        break;
      }
      case "help": {
        printUsage();
        process.exit(0);
        break;
      }
      default:
        throw new Error(`Unknown option: --${key}`);
    }

    if (consumeNext) {
      i += 1;
    }
  }

  return parsed;
}

function readPositiveInt(value: string | undefined, optionName: string): number {
  if (!value) {
    throw new Error(`Missing value for --${optionName}`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${optionName} must be a positive integer`);
  }

  return parsed;
}

function printUsage(): void {
  console.log("Usage: pnpm --filter @tavern/api bench:history -- [options]");
  console.log("Options:");
  console.log("  --floors <n>              Seeded committed floors (default: 300)");
  console.log("  --rounds <n>              Number of benchmark rounds (default: 5)");
  console.log("  --user-message-size <n>   User message length in chars (default: 64)");
  console.log("  --history-max-floors <n>  Optional history cap for prompt context");
}

function summarizeLatencies(samples: number[]): { avg: number; p50: number; p95: number } {
  if (samples.length === 0) {
    return { avg: 0, p50: 0, p95: 0 };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((sum, value) => sum + value, 0) / samples.length;

  return {
    avg,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

async function seedSession(db: ReturnType<typeof createDatabase>["db"], sessionId: string, floorCount: number): Promise<void> {
  const now = Date.now();

  await db.insert(sessions).values({
    id: sessionId,
    title: "Benchmark Session",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  for (let floorNo = 0; floorNo < floorCount; floorNo += 1) {
    const floorId = nanoid();
    const inputPageId = nanoid();
    const outputPageId = nanoid();

    await db.insert(floors).values({
      id: floorId,
      sessionId,
      floorNo,
      branchId: "main",
      parentFloorId: null,
      state: "committed",
      tokenIn: 12,
      tokenOut: 18,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(messagePages).values({
      id: inputPageId,
      floorId,
      pageNo: 0,
      pageKind: "input",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(messages).values({
      id: nanoid(),
      pageId: inputPageId,
      seq: 0,
      role: "user",
      content: `Seed user message #${floorNo}`,
      contentFormat: "text",
      tokenCount: 12,
      isHidden: false,
      source: "benchmark",
      createdAt: now,
    });

    await db.insert(messagePages).values({
      id: outputPageId,
      floorId,
      pageNo: 1,
      pageKind: "output",
      isActive: true,
      version: 1,
      checksum: null,
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(messages).values({
      id: nanoid(),
      pageId: outputPageId,
      seq: 0,
      role: "assistant",
      content: `Seed assistant message #${floorNo}`,
      contentFormat: "text",
      tokenCount: 18,
      isHidden: false,
      source: "benchmark",
      createdAt: now,
    });
  }
}

main().catch((error) => {
  console.error("[benchmark-history] failed", error);
  process.exit(1);
});
