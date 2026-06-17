import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../../db/client.js";
import { accounts, agentTypes } from "../../../db/schema.js";
import { createTestProject } from "../../../__tests__/helpers/workspace-project.js";
import {
  BackgroundAgentExecutor,
  BackgroundAgentExecutorError,
} from "../background-agent-executor.js";
import type {
  BackgroundAgentExecutionContext,
  BackgroundAgentHandler,
  BackgroundAgentResult,
} from "../background-agent-types.js";
import type { AgentScopeKind } from "../../agent-scope-types.js";

function seedAgentType(database: DatabaseConnection, key: string, scopeKind: AgentScopeKind): void {
  database.db
    .insert(accounts)
    .values({ id: "acc_1", name: "acc_1", createdAt: 1, updatedAt: 1 })
    .onConflictDoNothing()
    .run();
  createTestProject(database.db, { accountId: "acc_1", workspaceId: "ws_1", id: "proj_1" });
  database.db
    .insert(agentTypes)
    .values({
      id: "agt_1",
      workspaceId: "ws_1",
 accountId: "acc_1",
      key,
      name: "Agent",
      scopeKind,
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
  })
.onConflictDoNothing()
    .run();
}

function buildContext(
  database: DatabaseConnection,
  scopeKind: AgentScopeKind,
): BackgroundAgentExecutionContext {
  return {
    db: database.db,
    accountId: "acc_1",
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentTypeId: "agt_1",
    agentBindingId: "agb_1",
    scopeKind,
    resolvedConfig: {
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindings: [],
      eventSubscriptions: [],
      grants:{},
      allowedOutputTargets: ["derived_output"],
    },
    lineage: { rootRunId: "job_1" },
    dryRun: false,
    inputJson: {},
    sourceEventId: null,
    actorClientId: null,
  };
}

class RecordingHandler implements BackgroundAgentHandler {
  ran = false;
  constructor(public readonly agentKey: string) {}
  async run(): Promise<BackgroundAgentResult> {
    this.ran = true;
    return {
      status: "completed",
      outputs: [],
      traceDraft: { deliveryTarget: "return_inline" },
      summary: "ok",
    };
  }
}

describe("BackgroundAgentExecutor", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
  });

  afterEach(() => {
    database.close();
  });

  it("dispatches to the handler resolved by agent type key in project scope", async () => {
    seedAgentType(database, "project.digest", "project");
    const handler = new RecordingHandler("project.digest");
    const executor = new BackgroundAgentExecutor([handler]);

    const result = await executor.run(buildContext(database, "project"));

    expect(handler.ran).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("dispatches in workspace scope too", async () => {
    seedAgentType(database, "workspace.maint", "workspace");
    const handler = new RecordingHandler("workspace.maint");
    const executor = new BackgroundAgentExecutor([handler]);

    const result = await executor.run(buildContext(database, "workspace"));

    expect(handler.ran).toBe(true);
    expect(result.status).toBe("completed");
  });

  it("rejects floor scope_kind with afatal error", async () => {
    seedAgentType(database, "project.digest", "floor");
    const executor = new BackgroundAgentExecutor([new RecordingHandler("project.digest")]);

    await expect(executor.run(buildContext(database, "floor"))).rejects.toMatchObject({
      kind: "fatal",
      code: "background_agent_scope_kind_not_supported",
    });
  });

  it("rejects session scope_kind with a fatal error",async () => {
    seedAgentType(database, "project.digest", "session");
    const executor = new BackgroundAgentExecutor([new RecordingHandler("project.digest")]);

    await expect(executor.run(buildContext(database, "session"))).rejects.toBeInstanceOf(
      BackgroundAgentExecutorError,
    );
  });

  it("rejectswhen no handler is registered for the resolved agent key", async () => {
    seedAgentType(database, "project.unknown", "project");
    const executor = new BackgroundAgentExecutor([new RecordingHandler("project.digest")]);

    await expect(executor.run(buildContext(database, "project"))).rejects.toMatchObject({
      kind: "fatal",
      code: "background_agent_handler_not_registered",
    });
  });

  it("rejects when the agent type cannot be resolved", async () => {
    const executor = new BackgroundAgentExecutor([new RecordingHandler("project.digest")]);

    await expect(executor.run(buildContext(database, "project"))).rejects.toMatchObject({
      kind: "fatal",
      code: "background_agent_type_not_found",
    });
  });
});
