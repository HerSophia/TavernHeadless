import { eq } from "drizzle-orm";
import type { FloorRunVerifierSnapshot, TokenUsage } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floorResultSnapshots } from "../db/schema.js";

/**
 * native 多步循环的一条中间叙述（旁路展示用）。
 *
 * 来自触发工具调用且可见文本非空的步。不进 prompt 投影、不进 message 正文，
 * 仅用于前端把「中间叙述 + 工具组」按真实时序呈现。
 */
export interface StepNarration {
  /** 步序（1-based）。 */
  stepIndex: number;
  /** 该步的可见文本（中间叙述）。 */
text: string;
  /** 该步生成完成时刻（毫秒），供时序排序。 */
  createdAt: number;
}

export interface FloorCommittedResultSnapshot {
  assistantMessageId: string;
  committedAt: number;
  floorId: string;
  generatedText: string;
  outputPageId: string;
  summaries: string[];
  usage: TokenUsage;
  verifier?: FloorRunVerifierSnapshot | null;
  /** 推理（思维链）文本。模型未返回时为 null。 */
  reasoningText?: string | null;
  /** native 多步循环的中间叙述。无时为空数组。 */
  stepNarrations: StepNarration[];
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
  /**推理（思维链）文本。缺省或空串均写 null。 */
  reasoningText?: string | null;
  /** native 多步循环的中间叙述。缺省或空数组均写 null。 */
  stepNarrations?: StepNarration[] | null;
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
    summaries:safeParseJson<string[]>(row.summariesJson, []),
    usage: safeParseJson<TokenUsage>(row.usageJson, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }),
    verifier: safeParseJson<FloorRunVerifierSnapshot | null>(row.verifierJson, null),
    reasoningText: row.reasoningText ?? null,
    stepNarrations: safeParseJson<StepNarration[]>(row.stepNarrationsJson, []),
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
    reasoningText: input.reasoningText && input.reasoningText.length > 0 ? input.reasoningText : null,
    stepNarrationsJson:
      input.stepNarrations && input.stepNarrations.length > 0 ? JSON.stringify(input.stepNarrations) : null,
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
          reasoningText: row.reasoningText,
          stepNarrationsJson: row.stepNarrationsJson,
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
