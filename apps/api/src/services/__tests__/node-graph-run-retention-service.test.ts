import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { nodeGraphNodeRuns, nodeGraphRuns, operationLogs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { NodeGraphDefinitionService } from "../node-graph-definition-service.js";
import { NodeGraphRunService } from "../node-graph-run-service.js";
import { NodeGraphRunRetentionService } from "../node-graph-run-retention-service.js";
import { OperationLogService } from "../operation-log-service.js";
import { RuntimeMaintenanceService } from "../runtime-maintenance-service.js";
import type { NodeGraphDocument } from "@tavern/core";

const ACTOR = {
  actorType: "account" as const,
  actorAccountId: DEFAULT_ADMIN_ACCOUNT_ID,
  actorClientId: null,
};

function makeGraph(graphId = "ngraph_retention"): NodeGraphDocument {
  return {
    schemaVersion: 1,
    graphId,
    name: "Retention NodeGraph",
    mode: "native_graph",
    policies: {},
    permissions: { required: [] },
    nodes: [
      { id: "history", type: "source.chat_history", typeVersion: "1", phase: "pre_response" },
      { id: "messages", type: "compose.final_messages", typeVersion: "1", phase: "response" },
    ],
    edges: [{
      id: "e_history_messages",
      kind: "data",
      from: { nodeId: "history", port: "messages" },
      to: { nodeId: "messages", port: "messages" },
    }],
  };
}

describe("NodeGraphRunRetentionService", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: "ws_1",
      id: "proj_1",
    });
  });

  afterEach(() => {
    database?.close();
  });

  function seedRun(input: {
    status: "succeeded" | "failed" | "cancelled" | "running";
    createdAt: number;
  }): string {
    const service = new NodeGraphDefinitionService(database.db);
    const { definition, version } = service.create({ actor: ACTOR, projectId: "proj_1", document: makeGraph(`ngraph_${input.status}_${input.createdAt}`) });
    const runService = new NodeGraphRunService(database.db);
    const run = runService.createRun({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: "ws_1",
      projectId: "proj_1",
      graphId: definition.id,
      graphVersionId: version.id,
      intent: "normal",
      status: input.status,
      trace: { runtime_kind: "node_graph_run", statusCounts: { succeeded: 1 } },
      now: input.createdAt,
    });
    runService.appendNodeRun({
      graphRunId: run.id,
      nodeId: "messages",
      phase: "response",
      status: "succeeded",
      inputHash: "sha256:in",
      outputHash: "sha256:out",
      output: {
        preview: { kind: "messages", title: "Final Messages", value: [{ role: "user", content: "secret prompt body" }] },
        diagnostics: [{ severity: "info", code: "ok", message: "node detail body" }],
      },
    });
    return run.id;
  }

  it("redacts terminal run node-run bodies after the grace window and writes a summary log", () => {
    const now = 1_000_000;
    const runId = seedRun({ status: "succeeded", createdAt: now - 10_000 });

    const result = new NodeGraphRunRetentionService(database.db).run({ now, retentionGraceMs: 5_000 });

    expect(result.cleaned).toBe(1);
    expect(result.redactedNodeRuns).toBe(1);
    expect(result.cleanedByStatus.succeeded).toBe(1);

    const run = database.db.select().from(nodeGraphRuns).where(eq(nodeGraphRuns.id, runId)).get();
    expect(run?.cleanedAt).toBe(now);

    const nodeRuns = database.db.select().from(nodeGraphNodeRuns).where(eq(nodeGraphNodeRuns.graphRunId, runId)).all();
    expect(nodeRuns).toHaveLength(1);
    expect(nodeRuns[0]?.previewJson).toBeNull();
    expect(nodeRuns[0]?.diagnosticsJson).toBeNull();
    // Structure / hashes preserved for audit.
    expect(nodeRuns[0]?.inputHash).toBe("sha256:in");
    expect(nodeRuns[0]?.outputHash).toBe("sha256:out");
    expect(nodeRuns[0]?.status).toBe("succeeded");
  });

  it("does not clean runs still inside the grace window", () => {
    const now = 1_000_000;
    seedRun({ status: "succeeded", createdAt: now - 1_000 });

    const result = new NodeGraphRunRetentionService(database.db).run({ now, retentionGraceMs: 5_000 });

    expect(result.cleaned).toBe(0);
    expect(result.redactedNodeRuns).toBe(0);
  });

  it("never cleans runs that are still running", () => {
    const now = 1_000_000;
    seedRun({ status: "running", createdAt: now - 100_000 });

    const result = new NodeGraphRunRetentionService(database.db).run({ now, retentionGraceMs: 0 });

    expect(result.cleaned).toBe(0);
  });

  it("does not re-clean an already cleaned run", () => {
    const now = 1_000_000;
    seedRun({ status: "failed", createdAt: now - 10_000 });

    const service = new NodeGraphRunRetentionService(database.db);
    expect(service.run({ now, retentionGraceMs: 0 }).cleaned).toBe(1);
    expect(service.run({ now: now + 1, retentionGraceMs: 0 }).cleaned).toBe(0);
  });

  it("writes a redacted node_graph_run.cleanup operation log without bodies via RuntimeMaintenanceService", () => {
    const now = 1_000_000;
    seedRun({ status: "succeeded", createdAt: now - 10_000 });

    const result = new RuntimeMaintenanceService(database.db).run({
      now,
      promptRuntimeInjection: { enabled: false },
      temporaryConversation: { enabled: false },
      nodeGraphRun: { enabled: true, retentionGraceMs: 0 },
      operationLog: { accountId: DEFAULT_ADMIN_ACCOUNT_ID, actorType: "system", actorId: "test" },
    });
    expect(result.nodeGraphRun.cleaned).toBe(1);
    expect(result.nodeGraphRun.redactedNodeRuns).toBe(1);

    const logs = new OperationLogService(database.db).list({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      action: "node_graph_run.cleanup",
    });
    expect(logs.rows).toHaveLength(1);
    expect(logs.rows[0]?.metadata).toMatchObject({ cleanup_kind: "retention", cleaned: 1 });
    expect(JSON.stringify(logs.rows[0]?.metadata)).not.toContain("secret prompt body");
  });
});
