import { eq } from "drizzle-orm";
import type { PromptSnapshotRecord, PromptSnapshotRepository } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { promptSnapshots } from "../db/schema.js";

type PromptSnapshotRow = typeof promptSnapshots.$inferSelect;

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseNumberArray(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item))
      : [];
  } catch {
    return [];
  }
}

function toRecord(row: PromptSnapshotRow): PromptSnapshotRecord {
  return {
    floorId: row.floorId,
    sessionId: row.sessionId,
    presetId: row.presetId,
    presetUpdatedAt: row.presetUpdatedAt,
    worldbookId: row.worldbookId,
    worldbookUpdatedAt: row.worldbookUpdatedAt,
    regexProfileId: row.regexProfileId,
    regexProfileUpdatedAt: row.regexProfileUpdatedAt,
    worldbookActivatedEntryUids: parseNumberArray(row.worldbookActivatedEntryUidsJson),
    regexPreRuleNames: parseStringArray(row.regexPreRuleNamesJson),
    regexPostRuleNames: parseStringArray(row.regexPostRuleNamesJson),
    promptMode: row.promptMode as PromptSnapshotRecord["promptMode"],
    promptDigest: row.promptDigest,
    tokenEstimate: row.tokenEstimate,
    createdAt: row.createdAt,
  };
}

function toRow(record: PromptSnapshotRecord): typeof promptSnapshots.$inferInsert {
  return {
    floorId: record.floorId,
    sessionId: record.sessionId,
    presetId: record.presetId,
    presetUpdatedAt: record.presetUpdatedAt,
    worldbookId: record.worldbookId,
    worldbookUpdatedAt: record.worldbookUpdatedAt,
    regexProfileId: record.regexProfileId,
    regexProfileUpdatedAt: record.regexProfileUpdatedAt,
    worldbookActivatedEntryUidsJson: JSON.stringify(record.worldbookActivatedEntryUids),
    regexPreRuleNamesJson: JSON.stringify(record.regexPreRuleNames),
    regexPostRuleNamesJson: JSON.stringify(record.regexPostRuleNames),
    promptMode: record.promptMode,
    promptDigest: record.promptDigest,
    tokenEstimate: record.tokenEstimate,
    createdAt: record.createdAt,
  };
}

export class DrizzlePromptSnapshotRepository implements PromptSnapshotRepository {
  constructor(private readonly db: AppDb | DbExecutor) {}

  async insert(record: PromptSnapshotRecord): Promise<PromptSnapshotRecord> {
    const values = toRow(record);

    await this.db
      .insert(promptSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: promptSnapshots.floorId,
        set: {
          sessionId: values.sessionId,
          presetId: values.presetId,
          presetUpdatedAt: values.presetUpdatedAt,
          worldbookId: values.worldbookId,
          worldbookUpdatedAt: values.worldbookUpdatedAt,
          regexProfileId: values.regexProfileId,
          regexProfileUpdatedAt: values.regexProfileUpdatedAt,
          worldbookActivatedEntryUidsJson: values.worldbookActivatedEntryUidsJson,
          regexPreRuleNamesJson: values.regexPreRuleNamesJson,
          regexPostRuleNamesJson: values.regexPostRuleNamesJson,
          promptMode: values.promptMode,
          promptDigest: values.promptDigest,
          tokenEstimate: values.tokenEstimate,
          createdAt: values.createdAt,
        },
      })
      .run();

    const inserted = await this.findByFloorId(record.floorId);
    if (!inserted) {
      throw new Error(`Prompt snapshot ${record.floorId} was not persisted`);
    }

    return inserted;
  }

  async findByFloorId(floorId: string): Promise<PromptSnapshotRecord | null> {
    const [row] = await this.db
      .select()
      .from(promptSnapshots)
      .where(eq(promptSnapshots.floorId, floorId));

    return row ? toRecord(row) : null;
  }
}
