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
});
