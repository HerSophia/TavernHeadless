import { createEventBus } from "@tavern/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { accounts, agentTypes, projectAgentBindings, runtimeJobs } from "../../db/schema.js";
import { createTestProject } from "../../__tests__/helpers/workspace-project.js";
import { createAgentRuntimeJobCatalog } from "../agent-runtime-job-definitions.js";
import {
  createAgentRuntimeJobProcessorRegistry,
  type AgentRuntimeJobProcessorDeps,
  type AgentRunJobResult,
} from "../agent-runtime-job-processor.js";
import {BackgroundAgentExecutor } from "../agent-runtime/background-agent-executor.js";
import {
  ProjectDigestAgent,
  PROJECT_DIGEST_AGENT_KEY,
} from "../agent-runtime/builtin/project-digest-agent.js";
import { AgentOutputDispatcher, type DerivedOutputSink } from "../agent-runtime/agent-output-dispatcher.js";
import type { DerivedOutputRecord } from "../derived-output-service.js";
import { RuntimeJobScheduler } from "../runtime-job-scheduler.js";
import { RuntimeWorker } from "../runtime-worker.js";
import type { AgentRunJobPayload } from "../agent-runtime-job-definitions.js";

interface SeededAgent {
  agentTypeKey: string;
  scopeKind: "floor" | "session" | "project" | "workspace";
}

function seedAccountAndProject(database: DatabaseConnection): void {
  database.db
    .insert(accounts)
    .values({ id: "default-admin", name: "default-admin", createdAt: 1, updatedAt: 1 })
  .onConflictDoNothing()
    .run();
  createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
}

function seedAgent(database: DatabaseConnection, seed: SeededAgent): void {
  database.db
    .insert(agentTypes)
    .values({
      id: "agt_1",
      workspaceId: "ws_1",
      accountId: "default-admin",
      key: seed.agentTypeKey,
      name: "Agent One",
      scopeKind: seed.scopeKind,
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

  database.db
    .insert(projectAgentBindings)
    .values({
      id: "agb_1",
      workspaceId: "ws_1",
      projectId: "proj_1",
      accountId: "default-admin",
      agentTypeId: "agt_1",
      status: "enabled",
      scopeKind: seed.scopeKind,
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: "[]",
      grantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();
}

function buildPayload(overrides: Partial<AgentRunJobPayload> = {}): AgentRunJobPayload {
  return {
    accountId: "default-admin",
    workspaceId: "ws_1",
    projectId: "proj_1",
    agentTypeId: "agt_1",
    agentBindingId: "agb_1",
    sourceEventId: null,
    actorClientId: null,
    triggerType: "manual",
    triggerReason: "test",
    scopeKind: "project",
    resolvedConfig: {
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindings: [],
      eventSubscriptions: [],
      grants:{},
      allowedOutputTargets: ["derived_output"],
    },
    dryRun: false,
    inputJson: { events: [{ id: "evt_1" }, { id: "evt_2" }] },
    ...overrides,
  };
}

describe("AgentRuntimeJobProcessor (real two-phase)", () => {
  let database: DatabaseConnection;
  let derivedCalls: Array<{ projectId: string; domain: string; value: unknown }>;

  function buildDeps(): AgentRuntimeJobProcessorDeps {
    const derivedSink: DerivedOutputSink = {
      create: (input) => {
        derivedCalls.push({ projectId: input.projectId, domain: input.domain, value: input.value });
        return { id: "do_1" } as DerivedOutputRecord;
      },
    };
    return {
      executor: new BackgroundAgentExecutor([new ProjectDigestAgent()]),
      createDispatcher: () => new AgentOutputDispatcher({ derivedOutput: derivedSink }),
    };
  }

  function enqueue(payload: AgentRunJobPayload): void {
    const catalog = createAgentRuntimeJobCatalog();
    const scheduler = new RuntimeJobScheduler(catalog, { eventBus: createEventBus() });
    database.db.transaction((tx) => {
      scheduler.enqueue(tx, {
        jobType: "agent.run",
        accountId: payload.accountId,
        scopeType: "agent",
        scopeKey: `${payload.workspaceId}:${payload.projectId}:${payload.agentTypeId}`,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        agentTypeId: payload.agentTypeId,
        agentBindingId: payload.agentBindingId,
        payload,
      });
    });
  }

  async function runOne(deps: AgentRuntimeJobProcessorDeps): Promise<void> {
    const catalog = createAgentRuntimeJobCatalog();
    const processors = createAgentRuntimeJobProcessorRegistry(deps);
    const worker = new RuntimeWorker(database.db, catalog, processors, {
      workerId: "agent-runtime-worker-test",
      pollIntervalMs: 60_000,
      jobTypes: ["agent.run"],
    });
    await expect(worker.processOneDueJob()).resolves.toBe(true);
  }

  beforeEach(() => {
    database = createDatabase(":memory:");
    derivedCalls = [];
    seedAccountAndProject(database);
  });

  afterEach(() => {
    database.close();
  });

  it("registers a processor for agent.run jobs", () => {
    const processors = createAgentRuntimeJobProcessorRegistry(buildDeps());
    expect(processors.get("agent.run")).toBeDefined();
  });

  it("runs the real path and writes a derived_output via dispatcher", async () => {
    seedAgent(database, { agentTypeKey: PROJECT_DIGEST_AGENT_KEY,scopeKind: "project" });
    enqueue(buildPayload({ dryRun: false }));

    await runOne(buildDeps());

    expect(derivedCalls).toHaveLength(1);
    expect(derivedCalls[0]).toMatchObject({ projectId: "proj_1", domain: "project_digest" });

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("succeeded");
    const result = JSON.parse(job?.resultJson ?? "{}") as AgentRunJobResult;
    expect(result.dryRun).toBe(false);
    expect(result.status).toBe("completed");
    expect(result.outputCount).toBe(1);
    expect(result.mediumTrace).toMatchObject({ kind: "background_job", status: "completed", dryRun: false });
  });

  it("only plans on dry_run and writes no persisted output", async () => {
  seedAgent(database, { agentTypeKey: PROJECT_DIGEST_AGENT_KEY, scopeKind: "project" });
    enqueue(buildPayload({ dryRun: true }));

    await runOne(buildDeps());

    expect(derivedCalls).toHaveLength(0);

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("succeeded");
    const result = JSON.parse(job?.resultJson ?? "{}") as AgentRunJobResult;
    expect(result.dryRun).toBe(true);
    expect(result.outputCount).toBe(0);
    expect(result.mediumTrace).toMatchObject({ status: "planned", dryRun:true });
  });

  it("dead-letters forbidden output targets with a fatal error", async () => {
    seedAgent(database, { agentTypeKey: PROJECT_DIGEST_AGENT_KEY, scopeKind: "project" });
    enqueue(
      buildPayload({
        resolvedConfig: {
          llmProfileId: null,
          toolPolicyId: null,
          mcpBindings: [],
          eventSubscriptions: [],
          grants: {},
          allowedOutputTargets: ["session_messages"],
        },
      }),
    );

    await runOne(buildDeps());

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("dead_letter");
    expect(job?.lastError).toBe("agent_allowed_output_target_forbidden");
    expect(job?.lastErrorClass).toBe("RuntimeJobFatalError");
    expect(derivedCalls).toHaveLength(0);
});

  it("dead-letters session scope_kind through the background medium", async () => {
    seedAgent(database, { agentTypeKey: PROJECT_DIGEST_AGENT_KEY, scopeKind: "session" });
    enqueue(buildPayload({ scopeKind: "session" }));

    await runOne(buildDeps());

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("dead_letter");
    expect(job?.lastError).toBe("background_agent_scope_kind_not_supported");
    expect(job?.lastErrorClass).toBe("RuntimeJobFatalError");
  });

  it("dead-letters when no handler is registered for the agent key", async () => {
    seedAgent(database, { agentTypeKey: "project.unknown", scopeKind: "project" });
    enqueue(buildPayload());

    await runOne(buildDeps());

    const [job] = await database.db.select().from(runtimeJobs);
    expect(job?.status).toBe("dead_letter");
    expect(job?.lastError).toBe("background_agent_handler_not_registered");
    expect(job?.lastErrorClass).toBe("RuntimeJobFatalError");
  });
});
