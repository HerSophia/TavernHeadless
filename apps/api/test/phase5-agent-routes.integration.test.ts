import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { createTestProject, ensureTestAccount } from "../src/__tests__/helpers/workspace-project.js";
import { ClientApiKeyService } from "../src/services/client-api-key-service.js";
import { ClientService } from "../src/services/client-service.js";

const OBSERVER = "phase5-observer";

describe("phase 5 agent routes integration", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    database = built.database;
    ensureTestAccount(database, OBSERVER);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 403 agent_type_account_only for client actor workspace agent type calls", async () => {
    const project = createTestProject(database, { accountId: "default-admin", id: "proj-phase5-client-403" });
    const client = new ClientService(database).create({
      accountId: "default-admin",
      name: "Phase5 Client",
      kind: "custom",
      now: 1,
    });
    const apiKey = new ClientApiKeyService(database).create({
      accountId: "default-admin",
      clientId: client.id,
      now: 2,
    });

    const response = await app.inject({
      method: "GET",
      url: `/workspaces/${project.workspaceId}/agent-types`,
      headers: { "x-tavern-client-key": apiKey.secret },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("agent_type_account_only");
  });

  it("creates, gets, disables, enables binding and reads settings/effective config", async () => {
    const project = createTestProject(database, { accountId: "default-admin", id: "proj-phase5-routes-1" });

    const createType = await app.inject({
      method: "POST",
      url: `/workspaces/${project.workspaceId}/agent-types`,
      payload: {
        key: "route.agent",
        name: "Route Agent",
        scope_kind: "project",
        defaults: {
          grants: { allowed_output_targets: ["derived_output"] },
          event_subscriptions: [{ type: "floor.committed" }],
        },
      },
    });
    expect(createType.statusCode, createType.body).toBe(201);
    const agentTypeId = createType.json<{ id: string }>().id;

    const getType = await app.inject({
      method: "GET",
      url: `/workspaces/${project.workspaceId}/agent-types/${agentTypeId}`,
    });
    expect(getType.statusCode, getType.body).toBe(200);
    expect(getType.json<{ id: string; key: string }>().key).toBe("route.agent");

    const createBinding = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/agent-bindings`,
      payload: {
        agent_type_id: agentTypeId,
        scope_kind: "project",
        grants: { allowed_output_targets: ["derived_output"] },
        event_subscriptions: [{ type: "floor.committed" }],
      },
    });
    expect(createBinding.statusCode, createBinding.body).toBe(201);
    const bindingId = createBinding.json<{ id: string }>().id;

    const getBinding = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/agent-bindings/${bindingId}`,
    });
    expect(getBinding.statusCode, getBinding.body).toBe(200);
    expect(getBinding.json<{ id: string; agent_type_id: string }>().agent_type_id).toBe(agentTypeId);

    const disableBinding = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/agent-bindings/${bindingId}/disable`,
    });
    expect(disableBinding.statusCode, disableBinding.body).toBe(200);
    expect(disableBinding.json<{ status: string }>().status).toBe("disabled");

    const enableBinding = await app.inject({
      method: "POST",
      url: `/projects/${project.projectId}/agent-bindings/${bindingId}/enable`,
    });
    expect(enableBinding.statusCode, enableBinding.body).toBe(200);
    expect(enableBinding.json<{ status: string }>().status).toBe("enabled");

    const effectiveConfig = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/effective-config`,
    });
    expect(effectiveConfig.statusCode, effectiveConfig.body).toBe(200);
    expect(effectiveConfig.json<{ projectId: string }>().projectId).toBe(project.projectId);

    const getLlm = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/settings/llm-profile-override`,
    });
    expect(getLlm.statusCode, getLlm.body).toBe(200);
    expect(getLlm.json<{ item: null }>().item).toBeNull();

    const upsertLlm = await app.inject({
      method: "PUT",
      url: `/projects/${project.projectId}/settings/llm-profile-override`,
      payload: {
        base_profile_id: "llm_profile_alpha",
        override_json: { temperature: 0.2 },
      },
    });
    expect(upsertLlm.statusCode, upsertLlm.body).toBe(200);
    expect(upsertLlm.json<{ base_profile_id: string }>().base_profile_id).toBe("llm_profile_alpha");

    const getMcp = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/settings/mcp-bindings`,
    });
    expect(getMcp.statusCode, getMcp.body).toBe(200);
    expect(getMcp.json<{ items: unknown[] }>().items).toEqual([]);

    const upsertMcp = await app.inject({
      method: "PUT",
      url: `/projects/${project.projectId}/settings/mcp-bindings`,
      payload: {
        mcp_server_id: "mcp_alpha",
        allowed_tools: ["search"],
      },
    });
    expect(upsertMcp.statusCode, upsertMcp.body).toBe(200);
    expect(upsertMcp.json<{ mcp_server_id: string }>().mcp_server_id).toBe("mcp_alpha");

    const getToolPolicy = await app.inject({
      method: "GET",
      url: `/projects/${project.projectId}/settings/tool-policy-overrides`,
    });
    expect(getToolPolicy.statusCode, getToolPolicy.body).toBe(200);
    expect(getToolPolicy.json<{ items: unknown[] }>().items).toEqual([]);

    const upsertToolPolicy = await app.inject({
      method: "PUT",
      url: `/projects/${project.projectId}/settings/tool-policy-overrides`,
      payload: {
        base_policy_id: "policy_alpha",
        override_json: { blacklist: ["delete_file"] },
      },
    });
    expect(upsertToolPolicy.statusCode, upsertToolPolicy.body).toBe(200);
    expect(upsertToolPolicy.json<{ base_policy_id: string }>().base_policy_id).toBe("policy_alpha");
  });
});
