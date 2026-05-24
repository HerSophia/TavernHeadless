import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { projectEvents } from "../../db/schema.js";
import { AgentTypeService } from "../agent-type-service.js";
import { EffectiveConfigService } from "../effective-config-service.js";
import { ProjectAgentBindingService } from "../project-agent-binding-service.js";
import { ProjectLlmProfileOverrideService } from "../project-llm-profile-override-service.js";
import { ProjectMcpBindingService } from "../project-mcp-binding-service.js";
import { ProjectToolPolicyOverrideService } from "../project-tool-policy-override-service.js";
import { ProjectEventService } from "../project-event-service.js";

const ACCOUNT_ID = "effective-owner";

describe("EffectiveConfigService", () => {
  let database: DatabaseConnection;
  let effectiveConfigService: EffectiveConfigService;
  let llmOverrideService: ProjectLlmProfileOverrideService;
  let mcpBindingService: ProjectMcpBindingService;
  let toolPolicyOverrideService: ProjectToolPolicyOverrideService;
  let agentTypeService: AgentTypeService;
  let bindingService: ProjectAgentBindingService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    llmOverrideService = new ProjectLlmProfileOverrideService(database.db);
    mcpBindingService = new ProjectMcpBindingService(database.db);
    toolPolicyOverrideService = new ProjectToolPolicyOverrideService(database.db);
    agentTypeService = new AgentTypeService(database.db);
    bindingService = new ProjectAgentBindingService(database.db, { agentTypeService });
    effectiveConfigService = new EffectiveConfigService(database.db, {
      llmOverrideService,
      mcpService: mcpBindingService,
      toolOverrideService: toolPolicyOverrideService,
    });
  });

  afterEach(() => {
    database.close();
  });

  it("returns workspace sources when project has no override", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-effective-1" });
    const view = effectiveConfigService.forProject({ projectId: project.projectId, accountId: ACCOUNT_ID });
    expect(view.projectId).toBe(project.projectId);
    expect(view.llmProfile.source).toBe("workspace");
    expect(view.mcp.source).toBe("workspace");
    expect(view.toolPolicies.overrides).toEqual([]);
  });

  it("returns project sources when overrides exist", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-effective-2" });
    llmOverrideService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      baseProfileId: "llm_profile_alpha",
      overrideJson: { temperature: 0.5 },
    });
    mcpBindingService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      mcpServerId: "mcp_alpha",
      allowedTools: ["search"],
      configOverrideJson: { timeout_ms: 1000 },
    });
    toolPolicyOverrideService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      basePolicyId: "policy_alpha",
      overrideJson: { blacklist: ["delete_file"] },
    });

    const view = effectiveConfigService.forProject({ projectId: project.projectId, accountId: ACCOUNT_ID });
    expect(view.llmProfile.source).toBe("project");
    expect(view.llmProfile.profileId).toBe("llm_profile_alpha");
    expect(view.mcp.source).toBe("project");
    expect(view.mcp.bindings[0]?.mcpServerId).toBe("mcp_alpha");
    expect(view.toolPolicies.overrides[0]?.basePolicyId).toBe("policy_alpha");
  });

  it("returns session view and leaves sessionOverrides.llmProfile null", () => {
    const session = createTestSessionWithScope(database.db, { accountId: ACCOUNT_ID, id: "sess-effective-1" });
    const view = effectiveConfigService.forSession({ sessionId: session.sessionId, accountId: ACCOUNT_ID });
    expect(view.sessionId).toBe(session.sessionId);
    expect(view.projectId).toBe(session.projectId);
    expect(view.sessionOverrides.llmProfile).toBeNull();
  });
});

describe("Project override services", () => {
  let database: DatabaseConnection;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
  });

  afterEach(() => {
    database.close();
  });

  it("upserts project llm profile override as single active record", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-override-1" });
    const service = new ProjectLlmProfileOverrideService(database.db);

    const first = service.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      baseProfileId: "llm_one",
      overrideJson: { temperature: 0.8 },
    });
    const second = service.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      baseProfileId: "llm_two",
      overrideJson: { temperature: 0.4 },
    });

    expect(second.id).toBe(first.id);
    expect(service.getActive({ projectId: project.projectId, accountId: ACCOUNT_ID })?.baseProfileId).toBe("llm_two");
  });

  it("upserts mcp binding and tool policy override by natural project key", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-override-2" });
    const mcpService = new ProjectMcpBindingService(database.db);
    const toolService = new ProjectToolPolicyOverrideService(database.db);

    const mcp1 = mcpService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      mcpServerId: "mcp_a",
      allowedTools: ["search"],
      configOverrideJson: {},
    });
    const mcp2 = mcpService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      mcpServerId: "mcp_a",
      allowedTools: ["search", "fetch"],
      configOverrideJson: { timeout_ms: 1500 },
    });
    expect(mcp2.id).toBe(mcp1.id);
    expect(mcp2.allowedTools).toEqual(["search", "fetch"]);

    const tool1 = toolService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      basePolicyId: "policy_a",
      overrideJson: { blacklist: ["delete_file"] },
    });
    const tool2 = toolService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      basePolicyId: "policy_a",
      overrideJson: { blacklist: ["rm"] },
    });
    expect(tool2.id).toBe(tool1.id);
    expect(tool2.overrideJson).toEqual({ blacklist: ["rm"] });
  });
});

describe("AgentJobTriggerService", () => {
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

  it("evaluates subscribed event and enqueues manual jobs with dryRun default true", async () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-trigger-1" });
    createTestSessionWithScope(database.db, { accountId: ACCOUNT_ID, projectId: project.projectId, id: "sess-trigger-1" });

    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "trigger.agent",
      name: "Trigger Agent",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
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
      eventSubscriptions: [{ type: "floor.committed" }],
      grants: { allowed_output_targets: ["derived_output"] },
      metadata: {},
    });

    const event = new ProjectEventService(database.db).append({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      type: "floor.committed",
      payload: { floor_id: "floor_1" },
    });

    const { AgentJobTriggerService } = await import("../agent-job-trigger-service.js");
    const triggerService = new AgentJobTriggerService(database.db, { bindingService, agentTypeService });

    const evaluated = triggerService.evaluateEvent({ accountId: ACCOUNT_ID, projectId: project.projectId, eventId: event.id });
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0]?.binding.id).toBe(binding.id);

    const result = database.db.transaction((tx) => triggerService.enqueueManual(tx, {
      accountId: ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      agentBindingId: binding.id,
    }));

    expect(result.created).toBe(true);
    expect(result.agentBindingId).toBe(binding.id);

    const row = database.db.select().from((await import("../../db/schema.js")).runtimeJobs).all()[0]!;
    const payload = JSON.parse(row.payloadJson);
    expect(payload.dryRun).toBe(true);
    expect(row.workspaceId).toBe(project.workspaceId);
    expect(row.projectId).toBe(project.projectId);
    expect(row.agentBindingId).toBe(binding.id);
    expect(row.agentTypeId).toBe(agentType.id);
  });

  it("rejects forbidden output targets during enqueue", async () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-trigger-2" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "safe.agent",
      name: "Safe Agent",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    });

    const binding = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      grants: { allowed_output_targets: ["derived_output"] },
      metadata: {},
    });

    database.db.update((await import("../../db/schema.js")).projectAgentBindings)
      .set({ grantsJson: JSON.stringify({ allowed_output_targets: ["session_messages"] }) })
      .where((await import("drizzle-orm")).eq((await import("../../db/schema.js")).projectAgentBindings.id, binding.id))
      .run();

    const { AgentJobTriggerService } = await import("../agent-job-trigger-service.js");
    const triggerService = new AgentJobTriggerService(database.db, { bindingService, agentTypeService });

    expect(() => database.db.transaction((tx) => triggerService.enqueueManual(tx, {
      accountId: ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      agentBindingId: binding.id,
    }))).toThrow(/forbidden/);
  });

  it("keeps explicit toolPolicyId in runtime job payload for later selectors", async () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, id: "proj-trigger-3" });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: ACCOUNT_ID,
      key: "policy.agent",
      name: "Policy Agent",
      scopeKind: "project",
      defaults: {
        toolPolicyId: "policy_default",
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
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
      metadata: {},
    });

    const { AgentJobTriggerService } = await import("../agent-job-trigger-service.js");
    const triggerService = new AgentJobTriggerService(database.db, { bindingService, agentTypeService });

    database.db.transaction((tx) => {
      triggerService.enqueueManual(tx, {
        accountId: ACCOUNT_ID,
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        agentBindingId: binding.id,
      });
    });

    const row = database.db.select().from((await import("../../db/schema.js")).runtimeJobs).all()[0]!;
    const payload = JSON.parse(row.payloadJson);

    expect(payload.resolvedConfig.toolPolicyId).toBe("policy_project_alpha");
    expect(row.agentBindingId).toBe(binding.id);
  });
});
