import type {
  NodeGraphDiagnostic,
  NodeGraphNodeRunOutput,
  NodeGraphRunIntent,
  NodeGraphRunStatus,
} from "@tavern/core";
import { and, asc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { nodeGraphNodeRuns, nodeGraphRuns } from "../db/schema.js";

export type NodeGraphRunRecord = typeof nodeGraphRuns.$inferSelect;
export type NodeGraphNodeRunRecord = typeof nodeGraphNodeRuns.$inferSelect;

export type CreateNodeGraphRunInput = {
  id?: string;
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  graphId: string;
  graphVersionId: string;
  intent: NodeGraphRunIntent;
  status?: NodeGraphRunStatus;
  trace?: unknown;
  now?: number;
};

export type AppendNodeGraphNodeRunInput = {
  graphRunId: string;
  nodeId: string;
  phase: string;
  status: "skipped" | "running" | "succeeded" | "failed" | "reused";
  inputHash?: string | null;
  outputHash?: string | null;
  output?: NodeGraphNodeRunOutput | null;
  diagnostics?: NodeGraphDiagnostic[] | null;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type CompleteNodeGraphRunInput = {
  graphRunId: string;
  status: Exclude<NodeGraphRunStatus, "running">;
  trace?: unknown;
  now?: number;
};

export type NodeGraphRunWithNodes = {
  run: NodeGraphRunRecord;
  nodeRuns: NodeGraphNodeRunRecord[];
};

type RunDb = AppDb | DbExecutor;

function stringifyNullable(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

export class NodeGraphRunService {
  constructor(private readonly db: RunDb) {}

  createRun(input: CreateNodeGraphRunInput): NodeGraphRunRecord {
    const now = input.now ?? Date.now();
    return this.db
      .insert(nodeGraphRuns)
      .values({
        id: input.id ?? `ngrun_${nanoid(12)}`,
        accountId: input.accountId,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        sessionId: input.sessionId ?? null,
        floorId: input.floorId ?? null,
        pageId: input.pageId ?? null,
        graphId: input.graphId,
        graphVersionId: input.graphVersionId,
        intent: input.intent,
        status: input.status ?? "running",
        traceJson: stringifyNullable(input.trace),
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
  }

  appendNodeRun(input: AppendNodeGraphNodeRunInput): NodeGraphNodeRunRecord {
    const preview = input.output?.preview;
    const diagnostics = input.diagnostics ?? input.output?.diagnostics ?? null;
    return this.db
      .insert(nodeGraphNodeRuns)
      .values({
        id: `ngnrun_${nanoid(12)}`,
        graphRunId: input.graphRunId,
        nodeId: input.nodeId,
        phase: input.phase,
        status: input.status,
        inputHash: input.inputHash ?? null,
        outputHash: input.outputHash ?? null,
        previewJson: stringifyNullable(preview),
        diagnosticsJson: stringifyNullable(diagnostics),
        startedAt: input.startedAt ?? null,
        finishedAt: input.finishedAt ?? null,
      })
      .returning()
      .get();
  }

  completeRun(input: CompleteNodeGraphRunInput): NodeGraphRunRecord {
    const now = input.now ?? Date.now();
    return this.db
      .update(nodeGraphRuns)
      .set({
        status: input.status,
        traceJson: stringifyNullable(input.trace),
        updatedAt: now,
      })
      .where(eq(nodeGraphRuns.id, input.graphRunId))
      .returning()
      .get();
  }

  getRun(input: { accountId: string; projectId: string; runId: string }): NodeGraphRunWithNodes | null {
    const run = this.db
      .select()
      .from(nodeGraphRuns)
      .where(and(
        eq(nodeGraphRuns.accountId, input.accountId),
        eq(nodeGraphRuns.projectId, input.projectId),
        eq(nodeGraphRuns.id, input.runId),
      ))
      .limit(1)
      .get();
    if (!run) {
      return null;
    }
    const nodeRuns = this.db
      .select()
      .from(nodeGraphNodeRuns)
      .where(eq(nodeGraphNodeRuns.graphRunId, run.id))
      .orderBy(asc(nodeGraphNodeRuns.startedAt))
      .all();
    return { run, nodeRuns };
  }
}
