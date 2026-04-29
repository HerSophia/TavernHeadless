import { eq } from "drizzle-orm";
import type {
  PromptSnapshotRecord,
  PromptSnapshotRepository,
  PromptSnapshotWorldbookActivation,
} from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { promptSnapshots } from "../db/schema.js";

type PromptSnapshotRow = typeof promptSnapshots.$inferSelect;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseWorldbookActivations(raw: string): PromptSnapshotWorldbookActivation[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): PromptSnapshotWorldbookActivation | null => {
        if (!isRecord(item) || typeof item.uid !== "number" || !Number.isFinite(item.uid) || typeof item.activationKey !== "string") {
          return null;
        }

        const source = isRecord(item.source) ? item.source : null;
        const insertion = isRecord(item.insertion) ? item.insertion : null;
        if (!source || !insertion) {
          return null;
        }

        const kind = source.kind === "character_book" ? "character_book" : source.kind === "session_worldbook" ? "session_worldbook" : null;
        const position = normalizeWorldbookInsertionPosition(insertion.position);
        if (!kind || !position || typeof source.worldbookName !== "string" || typeof source.assetScopeId !== "string") {
          return null;
        }

        return {
          uid: item.uid,
          activationKey: item.activationKey,
          source: {
            kind,
            worldbookId: typeof source.worldbookId === "string" ? source.worldbookId : null,
            worldbookName: source.worldbookName,
            assetScopeId: source.assetScopeId,
          },
          insertion: {
            position,
            ...(typeof insertion.depth === "number" && Number.isFinite(insertion.depth) ? { depth: insertion.depth } : {}),
            ...(typeof insertion.outletName === "string" ? { outletName: insertion.outletName } : {}),
            ...(insertion.role === "system" || insertion.role === "user" || insertion.role === "assistant"
              ? { role: insertion.role }
              : {}),
          },
        };
      })
      .filter((item): item is PromptSnapshotWorldbookActivation => item !== null);
  } catch {
    return [];
  }
}

function normalizeWorldbookInsertionPosition(value: unknown): PromptSnapshotWorldbookActivation["insertion"]["position"] | null {
  return value === "before"
    || value === "after"
    || value === "an_top"
    || value === "an_bottom"
    || value === "em_top"
    || value === "em_bottom"
    || value === "at_depth"
    || value === "outlet"
    ? value
    : null;
}

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
    presetVersion: row.presetVersion,
    worldbookId: row.worldbookId,
    worldbookUpdatedAt: row.worldbookUpdatedAt,
    worldbookVersion: row.worldbookVersion,
    regexProfileId: row.regexProfileId,
    regexProfileUpdatedAt: row.regexProfileUpdatedAt,
    regexProfileVersion: row.regexProfileVersion,
    characterId: row.characterId,
    characterVersionId: row.characterVersionId,
    characterImportedFormat: row.characterImportedFormat,
    characterContentHash: row.characterContentHash,
    worldbookActivatedEntryUids: parseNumberArray(row.worldbookActivatedEntryUidsJson),
    worldbookActivatedEntries: parseWorldbookActivations(row.worldbookActivatedEntriesJson),
    regexPreRuleNames: parseStringArray(row.regexPreRuleNamesJson),
    regexPostRuleNames: parseStringArray(row.regexPostRuleNamesJson),
    promptMode: row.promptMode as PromptSnapshotRecord["promptMode"],
    assetManifestDigest: row.assetManifestDigest,
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
    presetVersion: record.presetVersion,
    worldbookId: record.worldbookId,
    worldbookUpdatedAt: record.worldbookUpdatedAt,
    worldbookVersion: record.worldbookVersion,
    regexProfileId: record.regexProfileId,
    regexProfileUpdatedAt: record.regexProfileUpdatedAt,
    regexProfileVersion: record.regexProfileVersion,
    characterId: record.characterId,
    characterVersionId: record.characterVersionId,
    characterImportedFormat: record.characterImportedFormat,
    characterContentHash: record.characterContentHash,
    worldbookActivatedEntryUidsJson: JSON.stringify(record.worldbookActivatedEntryUids),
    worldbookActivatedEntriesJson: JSON.stringify(record.worldbookActivatedEntries),
    regexPreRuleNamesJson: JSON.stringify(record.regexPreRuleNames),
    regexPostRuleNamesJson: JSON.stringify(record.regexPostRuleNames),
    promptMode: record.promptMode,
    assetManifestDigest: record.assetManifestDigest,
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
          presetVersion: values.presetVersion,
          worldbookId: values.worldbookId,
          worldbookUpdatedAt: values.worldbookUpdatedAt,
          worldbookVersion: values.worldbookVersion,
          regexProfileId: values.regexProfileId,
          regexProfileUpdatedAt: values.regexProfileUpdatedAt,
          regexProfileVersion: values.regexProfileVersion,
          characterId: values.characterId,
          characterVersionId: values.characterVersionId,
          characterImportedFormat: values.characterImportedFormat,
          characterContentHash: values.characterContentHash,
          worldbookActivatedEntryUidsJson: values.worldbookActivatedEntryUidsJson,
          worldbookActivatedEntriesJson: values.worldbookActivatedEntriesJson,
          regexPreRuleNamesJson: values.regexPreRuleNamesJson,
          regexPostRuleNamesJson: values.regexPostRuleNamesJson,
          promptMode: values.promptMode,
          assetManifestDigest: values.assetManifestDigest,
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
