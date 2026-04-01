import { eq } from "drizzle-orm";
import type { FloorRunVerifierSnapshot, TokenUsage } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floorResultSnapshots } from "../db/schema.js";

export interface FloorCommittedResultSnapshot {
  assistantMessageId: string;
  committedAt: number;
  floorId: string;
  generatedText: string;
  outputPageId: string;
  summaries: string[];
  usage: TokenUsage;
  verifier?: FloorRunVerifierSnapshot | null;
}

export interface PersistFloorCommittedResultInput {
  assistantMessageId: string;
  committedAt: number;
  floorId: string;
  generatedText: string;
  outputPageId: string;
  summaries: string[];
  usage: TokenUsage;
  verifier?: FloorRunVerifierSnapshot | null;
}

function safeParseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function toSnapshot(row: typeof floorResultSnapshots.$inferSelect): FloorCommittedResultSnapshot {
  return {
    assistantMessageId: row.assistantMessageId,
    committedAt: row.committedAt,
    floorId: row.floorId,
    generatedText: row.generatedText,
    outputPageId: row.outputPageId,
    summaries: safeParseJson<string[]>(row.summariesJson, []),
    usage: safeParseJson<TokenUsage>(row.usageJson, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }),
    verifier: safeParseJson<FloorRunVerifierSnapshot | null>(row.verifierJson, null),
  };
}

function toRow(input: PersistFloorCommittedResultInput): typeof floorResultSnapshots.$inferInsert {
  return {
    floorId: input.floorId,
    outputPageId: input.outputPageId,
    assistantMessageId: input.assistantMessageId,
    generatedText: input.generatedText,
    summariesJson: JSON.stringify(input.summaries),
    usageJson: JSON.stringify(input.usage),
    verifierJson: input.verifier ? JSON.stringify(input.verifier) : null,
    committedAt: input.committedAt,
    updatedAt: input.committedAt,
  };
}

export class FloorResultService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async upsert(input: PersistFloorCommittedResultInput): Promise<FloorCommittedResultSnapshot> {
    const row = toRow(input);

    await this.db
      .insert(floorResultSnapshots)
      .values(row)
      .onConflictDoUpdate({
        target: floorResultSnapshots.floorId,
        set: {
          outputPageId: row.outputPageId,
          assistantMessageId: row.assistantMessageId,
          generatedText: row.generatedText,
          summariesJson: row.summariesJson,
          usageJson: row.usageJson,
          verifierJson: row.verifierJson,
          committedAt: row.committedAt,
          updatedAt: row.updatedAt,
        },
      })
      .run();

    const snapshot = await this.findByFloorId(input.floorId);
    if (!snapshot) {
      throw new Error(`Failed to persist floor committed result snapshot for floor '${input.floorId}'`);
    }

    return snapshot;
  }

  async findByFloorId(floorId: string): Promise<FloorCommittedResultSnapshot | null> {
    const [row] = await this.db
      .select()
      .from(floorResultSnapshots)
      .where(eq(floorResultSnapshots.floorId, floorId));

    return row ? toSnapshot(row) : null;
  }
}
