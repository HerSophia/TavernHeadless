import { describe, expect, it, vi } from "vitest";

import { createDatabase } from "../../../db/client.js";
import { accounts, agentTypes, projectAgentBindings, runtimeJobs } from "../../../db/schema.js";
import { createTestProject } from "../../../__tests__/helpers/workspace-project.js";
import { AgentExecutorRouter } from "../agent-executor-router.js";
import {
  AgentJobTriggerBackgroundJobEnqueuer,
  AgentJobTriggerBackgroundJobEnqueuerError,
} from "../background-job-enqueuer.js";
import type {
  TemporaryConversationAgentExecutionResult,
  TemporaryConversationAgentExecutor,
  TemporaryConversationAgentRequest,
} from "../temporary-conversation-agent-executor.js";
import type { InlineAgentExecutionResult } from "../inline-agent-types.js";

function makeTemporaryExecutorStub(
  result: TemporaryConversationAgentExecutionResult,
): TemporaryConversationAgentExecutor {
  return {
    execute: vi.fn(async () => result),
  } as unknown as TemporaryConversationAgentExecutor;
}

const temporaryResult: TemporaryConversationAgentExecutionResult = {
  status: "completed",
  conversationId: "conv_1",
  medium: { kind: "temporary_conversation", deliveryTarget: "return_inline" },
  mediumTrace: {
    kind: "temporary_conversation",
    deliveryTarget: "return_inline",
    status: "completed",
    conversationId: "conv_1",
  },
  auditSnapshot: {
    conversationId: "conv_1",
    status: "completed",
    purpose: "agent_private",
    deliveryTarget: "return_inline",
    retentionPolicy: "delete_on_finalize",
    traceSummary: {
      kind: "temporary_conversation",
      deliveryTarget: "return_inline",
    status: "completed",
    },
    operationLog: [],
  },
};

const inlineResult: InlineAgentExecutionResult = {
  phase: "pre_response",
  records: [],
  aborted: false,
};

function seedBackgroundJobEnqueuerFixture(database: ReturnType<typeof createDatabase>): void {
  database.db
    .insert(accounts)
    .values({ id: "default-admin", name: "default-admin", createdAt: 1, updatedAt: 1 })
    .onConflictDoNothing()
    .run();
  createTestProject(database.db, { accountId: "default-admin", workspaceId: "ws_1", id: "proj_1" });
  database.db
    .insert(agentTypes)
    .values({
      id: "agt_1",
      workspaceId: "ws_1",
      accountId: "default-admin",
      key: "project.digest",
      name: "Project Digest",
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
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
      scopeKind: "project",
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: "[]",
      grantsJson: JSON.stringify({ allowed_output_targets: ["derived_output"] }),
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();
}

describe("AgentExecutorRouter", () => {
  it("single_call 路由到 inline executor adapter", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
    const route = await router.routeByMedium(
      { kind: "single_call", deliveryTarget: "return_inline" },
      { singleCallExecutor: { execute: async () => inlineResult } },
    );

    expect(route.kind).toBe("single_call");
    if (route.kind === "single_call") {
      expect(route.result.phase).toBe("pre_response");
    }
  });

  it("temporary_conversation 路由到临时对话 executor", async () => {
    const temporaryExecutor = makeTemporaryExecutorStub(temporaryResult);
    const router = new AgentExecutorRouter(temporaryExecutor);
    const request = {
      accountId: "acc_1",
      medium: { kind: "temporary_conversation", deliveryTarget: "return_inline" },
      source: { kind: "session", sourceSessionId: "sess_1" },
    } as unknown as TemporaryConversationAgentRequest;

    const route = await router.routeByMedium(
      { kind: "temporary_conversation", deliveryTarget: "return_inline" },
      { temporaryConversationRequest: request },
    );

    expect(route.kind).toBe("temporary_conversation");
    expect(temporaryExecutor.execute).toHaveBeenCalledTimes(1);
  });

  it("background_job 配置 enqueuer 时真实入队（dry_run 演练记为 planned）", async () => {
    const enqueue = vi.fn(async () => ({ jobId: "job_1", created: true, dryRun: true }));
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult), {
      backgroundJobEnqueuer: { enqueue },
    });
    const route = await router.routeByMedium(
      { kind: "background_job", deliveryTarget: "derived_output" },
      {
        backgroundJobRequest: {
          accountId: "acc_1",
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentBindingId: "agb_1",
          dryRun: true,
        },
},
    );

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(route.kind).toBe("background_job");
    if (route.kind === "background_job" && route.result.status === "enqueued") {
      expect(route.result.jobId).toBe("job_1");
      expect(route.result.dryRun).toBe(true);
      expect(route.result.mediumTrace.status).toBe("planned");
      expect(route.result.mediumTrace.dryRun).toBe(true);
    } else {
      throw new Error("expected enqueued background_job result");
    }
  });

  it("background_job 真实执行入队记为 running", async ()=> {
    const enqueue = vi.fn(async () => ({ jobId: "job_2", created: true, dryRun: false }));
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult), {
      backgroundJobEnqueuer: { enqueue },
    });
    const route = await router.routeByMedium(
      { kind: "background_job", deliveryTarget: "derived_output" },
      {
        backgroundJobRequest: {
          accountId: "acc_1",
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentBindingId: "agb_1",
          dryRun: false,
        },
      },
    );

    expect(route.kind).toBe("background_job");
    if (route.kind === "background_job" && route.result.status === "enqueued") {
      expect(route.result.mediumTrace.status).toBe("running");
      expect(route.result.dryRun).toBe(false);
    } else {
      throw new Error("expected enqueued background_job result");
    }
  });

  it("background_job 未配置 enqueuer 时回退到拒绝结果", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
   const route = await router.routeByMedium(
      { kind: "background_job", deliveryTarget: "derived_output" },
      {
     backgroundJobRequest: {
          accountId: "acc_1",
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentBindingId: "agb_1",
        },
      },
    );

    expect(route.kind).toBe("background_job");
    if (route.kind === "background_job") {
         expect(route.result.status).toBe("rejected");
    }
  });

  it("background_job 使用 AgentJobTriggerService 适配器在真实应用服务层入队", async () => {
    const database = createDatabase(":memory:");
    try {
      seedBackgroundJobEnqueuerFixture(database);
      const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult), {
        backgroundJobEnqueuer: new AgentJobTriggerBackgroundJobEnqueuer(database.db),
      });

      const route = await router.routeByMedium(
        { kind: "background_job", deliveryTarget: "derived_output" },
        {
          backgroundJobRequest: {
            accountId: "default-admin",
            workspaceId: "ws_1",
            projectId: "proj_1",
            agentBindingId: "agb_1",
            dryRun: false,
            inputJson: { source: "router" },
          },
        },
      );

      expect(route.kind).toBe("background_job");
      if (route.kind !== "background_job" || route.result.status !== "enqueued") {
        throw new Error("expected enqueued background_job result");
      }
      expect(route.result.dryRun).toBe(false);
      expect(route.result.mediumTrace.status).toBe("running");

      const [job] = await database.db.select().from(runtimeJobs);
      expect(job).toMatchObject({
        jobType: "agent.run",
        accountId: "default-admin",
        workspaceId: "ws_1",
        projectId: "proj_1",
        agentBindingId: "agb_1",
        status: "pending",
      });
      expect(JSON.parse(job?.payloadJson ?? "{}")).toMatchObject({
        dryRun: false,
        inputJson: { source: "router" },
      });
    } finally {
      database.close();
    }
  });

  it("background_job 适配器缺少项目参数时明确失败", async () => {
    const database = createDatabase(":memory:");
    try {
      const enqueuer = new AgentJobTriggerBackgroundJobEnqueuer(database.db);
      await expect(
        enqueuer.enqueue({
          accountId: "default-admin",
          workspaceId: "ws_1",
          projectId: "",
          agentBindingId: "agb_1",
        }),
      ).rejects.toMatchObject({
        code: "background_job_route_missing_project_id",
      });
      await expect(
        enqueuer.enqueue({
          accountId: "default-admin",
          workspaceId: "ws_1",
          projectId: "proj_1",
          agentBindingId: "",
        }),
      ).rejects.toBeInstanceOf(AgentJobTriggerBackgroundJobEnqueuerError);
    } finally {
      database.close();
    }
  });

  it("single_call 缺少 executor 时抛错", async () => {
    const router = new AgentExecutorRouter(makeTemporaryExecutorStub(temporaryResult));
    await expect(
      router.routeByMedium({ kind: "single_call", deliveryTarget: "return_inline" }, {}),
    ).rejects.toThrow();
  });
});
