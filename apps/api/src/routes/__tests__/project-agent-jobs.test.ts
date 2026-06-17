/**
 * ProjectAgentTaskBoard 路由 HTTP 集成测试（R4 阶段七）。
 *
 * 覆盖：
 *  - 列表 / 详情映射与 snake_case 字段。
 *  - 取消未运行的后台 job。
 *  - dead letter 可查：配置不允许 derived_output 导致 fatal，task board 能看到 last_error。
 *  - 鉴权：observer 可读不可取消；无关账户被拒绝。
 */
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../../app.js";
import type { DatabaseConnection } from "../../db/client.js";
import { agentTypes, projectAgentBindings } from "../../db/schema.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { AgentJobTriggerService } from "../../services/agent-job-trigger-service.js";
import { AgentRuntimeWorker } from "../../services/agent-runtime-worker.js";
import { ProjectMembershipService } from "../../services/project-membership-service.js";
import { PROJECT_DIGEST_AGENT_KEY } from "../../services/agent-runtime/builtin/project-digest-agent.js";

const OWNER_ACCOUNT_ID = "agent-jobs-owner";
const OBSERVER_ACCOUNT_ID = "agent-jobs-observer";
const OTHER_ACCOUNT_ID = "agent-jobs-other";
const OWNER_KEY = "agent-jobs-owner-key";
const OBSERVER_KEY = "agent-jobs-observer-key";
const OTHER_KEY = "agent-jobs-other-key";

const WORKSPACE_ID = "ws_agent_jobs";
const PROJECT_ID = "proj_agent_jobs";
const DIGEST_EVENT_TYPE = "project.digest.requested";

type TestApp = {
  app: FastifyInstance;
  database: DatabaseConnection["db"];
};

async function buildAgentJobsApp(): Promise<TestApp> {
  const built = await buildApp({
    databasePath: ":memory:",
    logger: false,
    accountMode: "multi",
    auth: {
      mode: "api_key",
      apiKeys: [OWNER_KEY, OBSERVER_KEY, OTHER_KEY],
      apiKeyAccountMap: {
        [OWNER_KEY]: OWNER_ACCOUNT_ID,
        [OBSERVER_KEY]: OBSERVER_ACCOUNT_ID,
        [OTHER_KEY]:OTHER_ACCOUNT_ID,
      },
    },
  });

  ensureTestAccount(built.database, OWNER_ACCOUNT_ID);
  ensureTestAccount(built.database, OBSERVER_ACCOUNT_ID);
  ensureTestAccount(built.database, OTHER_ACCOUNT_ID);

  createTestProject(built.database, {
    accountId: OWNER_ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    id: PROJECT_ID,
  });

  new ProjectMembershipService(built.database).addObserver({
    actorAccountId: OWNER_ACCOUNT_ID,
    projectId: PROJECT_ID,
    accountId: OBSERVER_ACCOUNT_ID,
  });

  seedAgentBinding(built.database, {
    agentTypeId: "agt_digest",
    bindingId: "agb_digest",
    agentKey: PROJECT_DIGEST_AGENT_KEY,
    allowedOutputTargets: ["derived_output"],
  });
  // 未注册 handler 的 agent key：executor 解析到 key 但找不到 handler，抛 fatal，
  // job 进入 dead letter，用于验证 task board 能查到错误。
  seedAgentBinding(built.database, {
    agentTypeId: "agt_dead_letter",
    bindingId: "agb_dead_letter",
    agentKey: "project.unregistered.deadletter",
    allowedOutputTargets: ["derived_output"],
  });

  return { app: built.app, database: built.database };
}

function seedAgentBinding(
  database: DatabaseConnection["db"],
  input: {
    agentTypeId: string;
    bindingId: string;
    agentKey: string;
    allowedOutputTargets: string[];
  },
): void {
  const grants = JSON.stringify({ allowed_output_targets: input.allowedOutputTargets });
  database
    .insert(agentTypes)
    .values({
      id: input.agentTypeId,
      workspaceId: WORKSPACE_ID,
      accountId: OWNER_ACCOUNT_ID,
      key: input.agentKey,
      name: `Digest ${input.agentTypeId}`,
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: JSON.stringify([{ type: DIGEST_EVENT_TYPE }]),
      defaultGrantsJson: grants,
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();

  database
    .insert(projectAgentBindings)
    .values({
      id: input.bindingId,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      accountId: OWNER_ACCOUNT_ID,
      agentTypeId: input.agentTypeId,
      status:"enabled",
  scopeKind: "project",
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: JSON.stringify([{ type: DIGEST_EVENT_TYPE}]),
      grantsJson: grants,
metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    })
    .onConflictDoNothing()
    .run();
}

function enqueueManualJob(
  database: DatabaseConnection["db"],
  input: { bindingId:string; dryRun: boolean },
): string {
  const trigger = new AgentJobTriggerService(database);
  const result = database.transaction((tx) =>
    trigger.enqueueManual(tx, {
      accountId: OWNER_ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      projectId: PROJECT_ID,
      agentBindingId: input.bindingId,
      triggerReason: "manual-test",
      dryRun: input.dryRun,
      inputJson: {},
    }),
  );
  return result.jobId;
}

function authHeaders(apiKey: string) {
  return { "x-api-key": apiKey };
}

describe("project agent jobs routes", () => {
  let testApp: TestApp;

  beforeEach(async () => {
    testApp = await buildAgentJobsApp();
  });

  afterEach(async () => {
    await testApp.app.close();
  });

  it("lists agent jobs with agent dimension fields for the owner", async () => {
    const jobId = enqueueManualJob(testApp.database, { bindingId: "agb_digest", dryRun: true });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/agent-jobs`,
      headers: authHeaders(OWNER_KEY),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<Record<string, unknown>>; total: number }>();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    const job = body.items[0]!;
    expect(job.id).toBe(jobId);
    expect(job.agent_type_id).toBe("agt_digest");
    expect(job.agent_binding_id).toBe("agb_digest");
    expect(job.trigger_type).toBe("manual");
    expect(job.dry_run).toBe(true);
    expect(Array.isArray(job.delivery_targets)).toBe(true);
  });

  it("returns a single job detail by job_id", async () => {
    const jobId = enqueueManualJob(testApp.database, { bindingId: "agb_digest", dryRun: true });

    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/agent-jobs/${jobId}`,
      headers: authHeaders(OWNER_KEY),
    });

    expect(response.statusCode).toBe(200);
    const job = response.json<Record<string, unknown>>();
    expect(job.id).toBe(jobId);
    expect(job.status).toBe("pending");
  });

  it("cancels a pending job", async () => {
    const jobId = enqueueManualJob(testApp.database, { bindingId: "agb_digest", dryRun: true });

    const response = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/agent-jobs/${jobId}/cancel`,
      headers: authHeaders(OWNER_KEY),
    });

    expect(response.statusCode).toBe(200);
    const job = response.json<Record<string, unknown>>();
    expect(job.id).toBe(jobId);
    expect(job.status).toBe("cancelled");
  });

 it("surfaces dead letter errors after a forbidden-config job fails", async () => {
    const jobId = enqueueManualJob(testApp.database, { bindingId: "agb_dead_letter", dryRun: false });

    const worker = new AgentRuntimeWorker(testApp.database, {
      workerId: "agent-jobs-worker",
      pollIntervalMs: 60_000,
    });
    await worker.processOneDueJob();

    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/agent-jobs/${jobId}`,
      headers: authHeaders(OWNER_KEY),
    });

    expect(response.statusCode).toBe(200);
    const job = response.json<Record<string, unknown>>();
    expect(job.dry_run).toBe(false);
    expect(typeof job.last_error).toBe("string");
    expect((job.last_error as string).length).toBeGreaterThan(0);
    expect(job.status).not.toBe("succeeded");
  });

  it("allows an observer to read but rejects cancel", async () => {
    const jobId = enqueueManualJob(testApp.database, { bindingId: "agb_digest", dryRun: true });

    const readResponse = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/agent-jobs`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(readResponse.statusCode).toBe(200);

    const cancelResponse = await testApp.app.inject({
      method: "POST",
      url: `/projects/${PROJECT_ID}/agent-jobs/${jobId}/cancel`,
      headers: authHeaders(OBSERVER_KEY),
    });
    expect(cancelResponse.statusCode).toBe(403);
  });

  it("rejects an unrelated account", async () => {
    const response = await testApp.app.inject({
      method: "GET",
      url: `/projects/${PROJECT_ID}/agent-jobs`,
      headers: authHeaders(OTHER_KEY),
    });
    expect(response.statusCode).toBe(403);
  });
});
