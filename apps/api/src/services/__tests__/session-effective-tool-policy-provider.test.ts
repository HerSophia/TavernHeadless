import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { eq } from "drizzle-orm";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../../accounts/constants.js";
import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { sessions } from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestDefaultWorkspace,
} from "../../__tests__/helpers/workspace-project.js";
import { AgentTypeService } from "../agent-type-service.js";
import { ProjectAgentBindingService } from "../project-agent-binding-service.js";
import { ProjectToolPolicyOverrideService } from "../project-tool-policy-override-service.js";
import { SessionEffectiveToolPolicyProvider } from "../tooling/shared/session-effective-tool-policy-provider.js";

describe("SessionEffectiveToolPolicyProvider", () => {
  let database: DatabaseConnection;
  let defaultWorkspaceId: string;
  let agentTypeService: AgentTypeService;
  let bindingService: ProjectAgentBindingService;
  let overrideService: ProjectToolPolicyOverrideService;
  let provider: SessionEffectiveToolPolicyProvider;

  beforeEach(() => {
    database = createDatabase(":memory:");
    defaultWorkspaceId = ensureTestDefaultWorkspace(database.db, DEFAULT_ADMIN_ACCOUNT_ID).workspaceId;
    agentTypeService = new AgentTypeService(database.db);
    bindingService = new ProjectAgentBindingService(database.db, { agentTypeService });
    overrideService = new ProjectToolPolicyOverrideService(database.db);
    provider = new SessionEffectiveToolPolicyProvider(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("keeps session-base permissions when no explicit selector is present", async () => {
    const project = createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-session-policy-base",
    });
    const session = createTestSessionWithScope(database.db, {
      id: "sess-session-policy-base",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      values: {
        metadataJson: JSON.stringify({
          tool_permissions: {
            enabled: true,
            max_calls_per_turn: 5,
          },
        }),
      },
    });

    overrideService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      basePolicyId: "policy_alpha",
      overrideJson: {
        max_calls_per_turn: 2,
      },
    });

    const resolution = await provider.resolve({
      sessionId: session.sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    expect(resolution?.effectivePermissions).toEqual({
      enabled: true,
      maxCallsPerTurn: 5,
    });
    expect(resolution?.layers[1]).toMatchObject({
      kind: "project_policy_overlay",
      applied: false,
      reason: "selector_missing",
    });
  });

  it("applies the selected project tool policy from an explicit agent binding selector", async () => {
    const project = createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-session-policy-selected",
    });
    const agentType = agentTypeService.create({
      workspaceId: project.workspaceId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      key: "tool-policy.agent",
      name: "Tool Policy Agent",
      scopeKind: "project",
      defaults: {
        toolPolicyId: "policy_alpha",
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    });
    const binding = bindingService.create({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      metadata: {},
    });
    const session = createTestSessionWithScope(database.db, {
      id: "sess-session-policy-selected",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      values: {
        metadataJson: JSON.stringify({
          tool_permissions: {
            enabled: true,
            max_calls_per_turn: 5,
            allow_irreversible: true,
          },
        }),
      },
    });

    await database.db
      .update(sessions)
      .set({
        metadataJson: JSON.stringify({
          tool_permissions: {
            enabled: true,
            max_calls_per_turn: 5,
            allow_irreversible: true,
          },
          tool_policy_selector: {
            agent_binding_id: binding.id,
          },
        }),
      })
      .where(eq(sessions.id, session.sessionId))
      .run();

    overrideService.upsert({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      basePolicyId: "policy_alpha",
      overrideJson: {
        max_calls_per_turn: 2,
        allow_irreversible: false,
      },
    });

    const resolution = await provider.resolve({
      sessionId: session.sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    expect(resolution?.selector).toEqual({
      source: "agent_binding",
      policyId: "policy_alpha",
    });
    expect(resolution?.effectivePermissions).toEqual({
      enabled: true,
      maxCallsPerTurn: 2,
      allowIrreversible: false,
    });
  });

  it("applies the asset-management tool preset overlay when the session binds a preset key", async () => {
    const project = createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-session-policy-preset",
    });
    const session = createTestSessionWithScope(database.db, {
      id: "sess-session-policy-preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      values: {
        toolPresetKey: "asset-management",
      },
    });

    const resolution = await provider.resolve({
      sessionId: session.sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    expect(resolution?.effectivePermissions?.enabled).toBe(true);
    expect(resolution?.effectivePermissions?.allowIrreversible).toBe(true);
    // 预设启用集折算为每个 slot 的白名单：资源工具 + TODO 工具在列。
    expect(resolution?.effectivePermissions?.slotAllowList?.narrator).toContain("create_character");
    expect(resolution?.effectivePermissions?.slotAllowList?.narrator).toContain("update_todo_list");
    expect(resolution?.layers.at(-1)).toMatchObject({
      kind: "session_tool_preset",
      applied: true,
      reason: "applied",
      policyId: "asset-management",
    });
  });

  it("disables tools when the session binds the regular-chat preset", async () => {
    const project = createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-session-policy-regular",
    });
    const session = createTestSessionWithScope(database.db, {
      id: "sess-session-policy-regular",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      values: {
        toolPresetKey: "regular-chat",
      },
    });

    const resolution = await provider.resolve({
      sessionId: session.sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    expect(resolution?.effectivePermissions?.enabled).toBe(false);
    expect(resolution?.layers.at(-1)).toMatchObject({
      kind: "session_tool_preset",
      applied: true,
      policyId: "regular-chat",
    });
  });

  it("falls back to the base resolution when the bound preset key is unknown", async () => {
    const project = createTestProject(database.db, {
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: defaultWorkspaceId,
      id: "proj-session-policy-unknown-preset",
    });
    const session = createTestSessionWithScope(database.db, {
      id: "sess-session-policy-unknown-preset",
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      values: {
        metadataJson: JSON.stringify({
          tool_permissions: { enabled: true, max_calls_per_turn: 5 },
        }),
        toolPresetKey: "does-not-exist",
      },
    });

    const resolution = await provider.resolve({
      sessionId: session.sessionId,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
    });

    // 未知预设不改变既有 effective 权限，只追加一个未生效的层用于观测。
    expect(resolution?.effectivePermissions).toEqual({
      enabled: true,
      maxCallsPerTurn: 5,
    });
    expect(resolution?.layers.at(-1)).toMatchObject({
      kind: "session_tool_preset",
      applied: false,
      policyId: "does-not-exist",
    });
  });
});
