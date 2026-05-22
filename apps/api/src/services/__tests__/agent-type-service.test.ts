import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import {
  createTestProject,
  createTestWorkspace,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { AgentTypeService } from "../agent-type-service.js";
import { ProjectAgentBindingService } from "../project-agent-binding-service.js";

const ACCOUNT_ID = "agt-svc-owner";
const OTHER_ACCOUNT_ID = "agt-svc-other";

describe("AgentTypeService", () => {
  let database: DatabaseConnection;
  let service: AgentTypeService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT_ID);
    ensureTestAccount(database.db, OTHER_ACCOUNT_ID);
    service = new AgentTypeService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("creates agent type and keeps workspace key unique per workspace", () => {
    const workspace = createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-agent-type-a" });
    const created = service.create({
      workspaceId: workspace.workspaceId,
      accountId: ACCOUNT_ID,
      key: "world.sim",
      name: "World Sim",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    });

    expect(created.id).toMatch(/^agt_/);
    expect(created.key).toBe("world.sim");

    expect(() => service.create({
      workspaceId: workspace.workspaceId,
      accountId: ACCOUNT_ID,
      key: "world.sim",
      name: "World Sim 2",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    })).toThrow(/key already exists/);
  });

  it("rejects forbidden output targets in defaults", () => {
    const workspace = createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-agent-type-b" });
    expect(() => service.create({
      workspaceId: workspace.workspaceId,
      accountId: ACCOUNT_ID,
      key: "bad.agent",
      name: "Bad Agent",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["session_messages"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    })).toThrow(/reserved for the main narrative path/);
  });

  it("blocks disabling an agent type that is still used by an enabled binding", () => {
    const workspace = createTestWorkspace(database.db, { accountId: ACCOUNT_ID, id: "ws-agent-type-c" });
    const project = createTestProject(database.db, { accountId: ACCOUNT_ID, workspaceId: workspace.workspaceId, id: "proj-binding-c" });
    const agentType = service.create({
      workspaceId: workspace.workspaceId,
      accountId: ACCOUNT_ID,
      key: "guard.agent",
      name: "Guard Agent",
      scopeKind: "project",
      defaults: {
        grants: { allowed_output_targets: ["derived_output"] },
        mcpBindings: [],
        eventSubscriptions: [],
        metadata: {},
      },
    });

    const bindingService = new ProjectAgentBindingService(database.db, { agentTypeService: service });
    bindingService.create({
      workspaceId: workspace.workspaceId,
      projectId: project.projectId,
      accountId: ACCOUNT_ID,
      agentTypeId: agentType.id,
      scopeKind: "project",
      grants: { allowed_output_targets: ["derived_output"] },
      mcpBindings: [],
      eventSubscriptions: [],
      metadata: {},
    });

    expect(() => service.setStatus({ id: agentType.id, accountId: ACCOUNT_ID, status: "disabled" }))
      .toThrow(/still enabled by project binding/);
  });
});
