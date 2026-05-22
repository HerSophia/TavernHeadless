import { describe, expect, it, vi } from "vitest";

import { createTavernClient } from "../index.js";

const baseUrl = "http://localhost:3000";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

describe("sdk project agent bindings and settings resources", () => {
  it("creates binding, runs it, reads effective config and session effective config", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        id: "agb_1",
        workspace_id: "ws_1",
        project_id: "proj_1",
        account_id: "acc_1",
        agent_type_id: "agt_1",
        status: "enabled",
        scope_kind: "project",
        llm_profile_id: null,
        tool_policy_id: null,
        mcp_bindings: [],
        event_subscriptions: [{ type: "floor.committed", filter_json: null }],
        grants: { allowed_output_targets: ["derived_output"] },
        metadata: {},
        created_at: 1,
        updated_at: 2,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        job_id: "job_1",
        created: true,
        agent_binding_id: "agb_1",
        dedupe_key: null,
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        projectId: "proj_1",
        workspaceId: "ws_1",
        llmProfile: { source: "workspace", profileId: null, override: null },
        toolPolicies: { overrides: [] },
        mcp: { source: "workspace", bindings: [] },
      }))
      .mockResolvedValueOnce(jsonResponse({
        projectId: "proj_1",
        workspaceId: "ws_1",
        llmProfile: { source: "workspace", profileId: null, override: null },
        toolPolicies: { overrides: [] },
        mcp: { source: "workspace", bindings: [] },
        sessionId: "sess_1",
        sessionOverrides: { llmProfile: null },
      }));

    const client = createTavernClient({ baseUrl, fetchImpl });

    const binding = await client.projects.agentBindings.create("proj_1", {
      agentTypeId: "agt_1",
      scopeKind: "project",
      grants: { allowed_output_targets: ["derived_output"] },
      eventSubscriptions: [{ type: "floor.committed" }],
    }, { accountId: "acc_1" });
    expect(binding.agentTypeId).toBe("agt_1");

    const runResult = await client.projects.agentBindings.run("proj_1", "agb_1", {
      dryRun: true,
      triggerReason: "manual-test",
      inputJson: { source: "sdk" },
    }, { accountId: "acc_1" });
    expect(runResult.jobId).toBe("job_1");

    const effective = await client.projects.getEffectiveConfig("proj_1", { accountId: "acc_1" });
    expect(effective.projectId).toBe("proj_1");

    const sessionEffective = await client.sessions.getEffectiveConfig({ sessionId: "sess_1", accountId: "acc_1" });
    expect(sessionEffective.sessionId).toBe("sess_1");
    expect(sessionEffective.sessionOverrides.llmProfile).toBeNull();

    expect(fetchImpl.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({
      agent_type_id: "agt_1",
      scope_kind: "project",
      event_subscriptions: [{ type: "floor.committed" }],
      grants: { allowed_output_targets: ["derived_output"] },
    }));
    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      trigger_reason: "manual-test",
      dry_run: true,
      input_json: { source: "sdk" },
    }));
  });

  it("reads and updates project settings resources", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ item: null }))
      .mockResolvedValueOnce(jsonResponse({
        id: "plo_1",
        workspace_id: "ws_1",
        project_id: "proj_1",
        base_profile_id: "llm_alpha",
        override_json: { temperature: 0.3 },
        status: "active",
        created_at: 1,
        updated_at: 2,
      }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({
        id: "pmb_1",
        workspace_id: "ws_1",
        project_id: "proj_1",
        mcp_server_id: "mcp_alpha",
        status: "enabled",
        allowed_tools: ["search"],
        config_override_json: { timeout_ms: 1000 },
        created_at: 3,
        updated_at: 4,
      }))
      .mockResolvedValueOnce(jsonResponse({ items: [] }))
      .mockResolvedValueOnce(jsonResponse({
        id: "pto_1",
        workspace_id: "ws_1",
        project_id: "proj_1",
        base_policy_id: "policy_alpha",
        override_json: { blacklist: ["delete_file"] },
        status: "active",
        created_at: 5,
        updated_at: 6,
      }));

    const client = createTavernClient({ baseUrl, fetchImpl });

    expect(await client.projects.settings.getLlm("proj_1", { accountId: "acc_1" })).toBeNull();
    const llm = await client.projects.settings.updateLlm("proj_1", {
      baseProfileId: "llm_alpha",
      overrideJson: { temperature: 0.3 },
    }, { accountId: "acc_1" });
    expect(llm.baseProfileId).toBe("llm_alpha");

    expect(await client.projects.settings.getMcp("proj_1", { accountId: "acc_1" })).toEqual([]);
    const mcp = await client.projects.settings.updateMcp("proj_1", {
      mcpServerId: "mcp_alpha",
      allowedTools: ["search"],
      configOverrideJson: { timeout_ms: 1000 },
    }, { accountId: "acc_1" });
    expect(mcp.mcpServerId).toBe("mcp_alpha");

    expect(await client.projects.settings.getToolPolicy("proj_1", { accountId: "acc_1" })).toEqual([]);
    const toolPolicy = await client.projects.settings.updateToolPolicy("proj_1", {
      basePolicyId: "policy_alpha",
      overrideJson: { blacklist: ["delete_file"] },
    }, { accountId: "acc_1" });
    expect(toolPolicy.basePolicyId).toBe("policy_alpha");

    expect(fetchImpl.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({
      base_profile_id: "llm_alpha",
      override_json: { temperature: 0.3 },
    }));
    expect(fetchImpl.mock.calls[3]?.[1]?.body).toBe(JSON.stringify({
      mcp_server_id: "mcp_alpha",
      allowed_tools: ["search"],
      config_override_json: { timeout_ms: 1000 },
    }));
    expect(fetchImpl.mock.calls[5]?.[1]?.body).toBe(JSON.stringify({
      base_policy_id: "policy_alpha",
      override_json: { blacklist: ["delete_file"] },
    }));
  });
});
