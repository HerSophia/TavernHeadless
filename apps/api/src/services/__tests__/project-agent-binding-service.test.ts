import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { AgentTypeService } from "../agent-type-service.js";
import { ProjectAgentBindingService } from "../project-agent-binding-service.js";

const ACCOUNT_ID = "binding-owner";

describe("ProjectAgentBindingService", () => {
  let database: DatabaseConnection;
  let agentTypeService: AgentTypeService;
  let bindingService: ProjectAgentBindingService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    agentTypeService = new AgentTypeService(database.db);
    bindingService = new ProjectAgentBindingService(database.db, { agentTypeService });
  });

  afterEach(() => {
    database.close();
  });

  it("creates binding idempotently for the same project and agent type", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-bind-1" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "writer.agent",
      name: "Writer",
      scopeKind: "project",
      defaults: {
        grants: {
          allowed_output_targets: ["derived_output", "project_inbox"],
          actions: ["project.agent.read", "project.config.read"],
        },
        mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search", "fetch"] }],
        eventSubscriptions: [{ type: "floor.committed" }, { type: "message.created" }],
        metadata: {},
      },
    });

    const first = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      grants: {
        allowed_output_targets: ["derived_output"],
        actions: ["project.agent.read"],
      },
      mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search"] }],
      eventSubscriptions: [{ type: "floor.committed" }],
      metadata: { lane: "primary" },
    });

    const second = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      grants: {
        allowed_output_targets: ["derived_output"],
        actions: ["project.agent.read"],
      },
      mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search"] }],
      eventSubscriptions: [{ type: "floor.committed" }],
      metadata: { lane: "primary" },
    });

    expect(second.id).toBe(first.id);
  });

  it("rejects scope mismatch and narrowing expansion", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-bind-2" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "strict.agent",
      name: "Strict",
      scopeKind: "project",
      defaults: {
        grants: {
          allowed_output_targets: ["derived_output"],
          actions: ["project.agent.read"],
        },
        mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search"] }],
        eventSubscriptions: [{ type: "floor.committed" }],
        metadata: {},
      },
    });

    expect(() => bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "workspace",
      grants: { allowed_output_targets: ["derived_output"] },
      mcpBindings: [],
      eventSubscriptions: [],
      metadata: {},
    })).toThrow(/scope_kind must equal agent type scope_kind/);

    expect(() => bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      grants: { allowed_output_targets: ["derived_output", "project_inbox"] },
      mcpBindings: [],
      eventSubscriptions: [],
      metadata: {},
    })).toThrow(/cannot expand allowed_output_targets/);
  });

  it("resolves effective config by falling back to agent type defaults", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-bind-3" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "effective.agent",
      name: "Effective",
      scopeKind: "project",
      defaults: {
        llmProfileId: "llm_default",
        toolPolicyId: "policy_default",
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search"] }],
        eventSubscriptions: [{ type: "floor.committed" }],
        metadata: {},
      },
    });

    const binding = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      metadata: {},
    });

    const effective = bindingService.resolveEffective({ id: binding.id, accountId: ACCOUNT_ID });
    expect(effective.effective.llmProfileId).toBe("llm_default");
    expect(effective.effective.toolPolicyId).toBe("policy_default");
    expect(effective.effective.allowedOutputTargets).toEqual(["derived_output"]);
    expect(effective.effective.eventSubscriptions[0]?.type).toBe("floor.committed");
  });

  it("keeps binding-local toolPolicyId and mcpBindings for explicit selector and narrowing", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-bind-4" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "agent.selector",
      name: "Selector",
      scopeKind: "project",
      defaults: {
        llmProfileId: "llm_default",
        toolPolicyId: null,
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search", "fetch"] }],
        eventSubscriptions: [{ type: "floor.committed" }],
        metadata: {},
      },
    });

    const binding = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      toolPolicyId: "policy_project_alpha",
      mcpBindings: [{ mcpServerId: "mcp_a", allowedTools: ["search"] }],
      metadata: {},
    });

    const effective = bindingService.resolveEffective({ id: binding.id, accountId: ACCOUNT_ID });
    expect(effective.effective.toolPolicyId).toBe("policy_project_alpha");
    expect(effective.effective.mcpBindings).toEqual([
      { mcpServerId: "mcp_a", allowedTools: ["search"], configOverrideJson: null },
    ]);
  });
});
