import type { NodeGraphNodeRunOutput } from "@tavern/core";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { nodeGraphCheckpoints } from "../db/schema.js";

export type NodeGraphCheckpointRecord = typeof nodeGraphCheckpoints.$inferSelect;

/**
 * NG2-CORE：一次 floor + graph version 维度下，单个节点已计算的可复用 checkpoint。
 */
export interface NodeGraphFloorCheckpoint {
  nodeId: string;
  inputHash: string;
  configHash: string;
  phase: string;
  scope: string | null;
  output: NodeGraphNodeRunOutput | null;
}

export interface LoadFloorCheckpointsInput {
  accountId: string;
  floorId: string;
  graphVersionId: string;
}

export interface SaveNodeGraphCheckpointInput {
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId: string;
  graphId: string;
  graphVersionId: string;
  nodeId: string;
  phase: string;
  scope?: string | null;
  inputHash: string;
  configHash: string;
  output: NodeGraphNodeRunOutput | null;
  now?: number;
}

type CheckpointDb = AppDb | DbExecutor;

function parseOutput(json: string | null): NodeGraphNodeRunOutput | null {
  if (!json) {
    return null;
  }
  try {
    return JSON.parse(json) as NodeGraphNodeRunOutput;
  } catch {
    return null;
  }
}

/**
 * NG2-CORE 持久 checkpoint 读写（B9-DESIGN 3.3）。
 *
 * checkpoint 按 `(floorId, graphVersionId, nodeId)` 唯一，graph version 进入主键 →
 * 新版本天然失效旧 checkpoint。复用判定（input/config hash 比对）由 core 的
 * `classifyNodeGraphCheckpointReuse` 收口，本服务只负责持久读写。
 */
export class NodeGraphCheckpointService {
  constructor(private readonly db: CheckpointDb) {}

  /** 读入某 floor + graph version 下全部节点 checkpoint，按 nodeId 索引（已清理正文的 output 为 null）。 */
  loadFloorCheckpoints(input: LoadFloorCheckpointsInput): Map<string, NodeGraphFloorCheckpoint> {
    const rows = this.db
      .select()
      .from(nodeGraphCheckpoints)
      .where(and(
        eq(nodeGraphCheckpoints.accountId, input.accountId),
        eq(nodeGraphCheckpoints.floorId, input.floorId),
        eq(nodeGraphCheckpoints.graphVersionId, input.graphVersionId),
      ))
      .all();

    const byNodeId = new Map<string, NodeGraphFloorCheckpoint>();
    for (const row of rows) {
      byNodeId.set(row.nodeId, {
        nodeId: row.nodeId,
        inputHash: row.inputHash,
        configHash: row.configHash,
        phase: row.phase,
        scope: row.scope,
        output: parseOutput(row.outputJson),
      });
    }
    return byNodeId;
  }

  /** Upsert 单个 checkpoint（同 floor + version + node 覆盖；清理标记重置）。 */
  saveCheckpoint(input: SaveNodeGraphCheckpointInput): NodeGraphCheckpointRecord {
    const now = input.now ?? Date.now();
    const outputJson = input.output === null || input.output === undefined
      ? null
      : JSON.stringify(input.output);
    return this.db
      .insert(nodeGraphCheckpoints)
      .values({
        id: `ngcp_${nanoid(12)}`,
        accountId: input.accountId,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        sessionId: input.sessionId ?? null,
        floorId: input.floorId,
        graphId: input.graphId,
        graphVersionId: input.graphVersionId,
        nodeId: input.nodeId,
        phase: input.phase,
        scope: input.scope ?? null,
        inputHash: input.inputHash,
        configHash: input.configHash,
        outputJson,
        cleanedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          nodeGraphCheckpoints.floorId,
          nodeGraphCheckpoints.graphVersionId,
          nodeGraphCheckpoints.nodeId,
        ],
        set: {
          phase: input.phase,
          scope: input.scope ?? null,
          inputHash: input.inputHash,
          configHash: input.configHash,
          outputJson,
          cleanedAt: null,
          updatedAt: now,
        },
      })
      .returning()
      .get();
  }
}
