import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { agentTypes, projectAgentBindings, runtimeJobs } from "../../db/schema.js";
import {
  createTestProject,
  createTestWorkspace,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ScopeIntegrityService } from "../scope-integrity-service.js";

describe("ScopeIntegrityService phase 5 diagnostics", () => {
  let database: DatabaseConnection;
  let service: ScopeIntegrityService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, "scope-p5-owner");
    ensureTestAccount(database.db, "scope-p5-other");
    service = new ScopeIntegrityService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("flags agent type workspace/account mismatch", () => {
    const ownerWorkspace = createTestWorkspace(database.db, { accountId: "scope-p5-owner", id: "ws-scope-p5-owner" });
    createTestProject(database.db, { accountId: "scope-p5-owner", workspaceId: ownerWorkspace.workspaceId, id: "proj-scope-p5-owner" });

    database.db.insert(agentTypes).values({
      id: "agt_scope_p5_1",
      workspaceId: ownerWorkspace.workspaceId,
      accountId: "scope-p5-other",
      key: "mismatch.agent",
      name: "Mismatch Agent",
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    const report = service.diagnose({ accountId: "scope-p5-other" });
    expect(report.issues.some((issue) => issue.code === "agent_type_workspace_account_mismatch")).toBe(true);
  });

  it("flags binding workspace mismatch against agent type workspace", () => {
    const ownerWorkspace = createTestWorkspace(database.db, { accountId: "scope-p5-owner", id: "ws-scope-p5-bind-owner" });
    const otherWorkspace = createTestWorkspace(database.db, { accountId: "scope-p5-owner", id: "ws-scope-p5-bind-other" });
    const project = createTestProject(database.db, { accountId: "scope-p5-owner", workspaceId: ownerWorkspace.workspaceId, id: "proj-scope-p5-bind" });

    database.db.insert(agentTypes).values({
      id: "agt_scope_p5_2",
      workspaceId: otherWorkspace.workspaceId,
      accountId: "scope-p5-owner",
      key: "cross.agent",
      name: "Cross Agent",
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    database.db.insert(projectAgentBindings).values({
      id: "agb_scope_p5_1",
      workspaceId: ownerWorkspace.workspaceId,
      projectId: project.projectId,
      accountId: "scope-p5-owner",
      agentTypeId: "agt_scope_p5_2",
      status: "enabled",
      scopeKind: "project",
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: "[]",
      grantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    const report = service.diagnose({ accountId: "scope-p5-owner", projectId: project.projectId });
    expect(report.issues.some((issue) => issue.code === "project_agent_binding_agent_type_workspace_mismatch")).toBe(true);
  });

  it("flags runtime job project mismatch against agent binding project", () => {
    const projectA = createTestProject(database.db, { accountId: "scope-p5-owner", id: "proj-scope-p5-a" });
    const projectB = createTestProject(database.db, { accountId: "scope-p5-owner", workspaceId: projectA.workspaceId, id: "proj-scope-p5-b" });

    database.db.insert(agentTypes).values({
      id: "agt_scope_p5_3",
      workspaceId: projectA.workspaceId,
      accountId: "scope-p5-owner",
      key: "job.agent",
      name: "Job Agent",
      scopeKind: "project",
      status: "active",
      defaultLlmProfileId: null,
      defaultToolPolicyId: null,
      defaultMcpBindingJson: "{}",
      defaultEventSubscriptionsJson: "[]",
      defaultGrantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    database.db.insert(projectAgentBindings).values({
      id: "agb_scope_p5_2",
      workspaceId: projectA.workspaceId,
      projectId: projectA.projectId,
      accountId: "scope-p5-owner",
      agentTypeId: "agt_scope_p5_3",
      status: "enabled",
      scopeKind: "project",
      llmProfileId: null,
      toolPolicyId: null,
      mcpBindingJson: "{}",
      eventSubscriptionsJson: "[]",
      grantsJson: "{}",
      metadataJson: "{}",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    database.db.insert(runtimeJobs).values({
      id: "job_scope_p5_1",
      jobType: "agent.run",
      accountId: "scope-p5-owner",
      scopeType: "agent",
      scopeKey: "scope",
      sessionId: null,
      floorId: null,
      pageId: null,
      status: "pending",
      phase: null,
      payloadJson: "{}",
      stateJson: null,
      resultJson: null,
      attemptCount: 0,
      maxAttempts: 1,
      availableAt: 1,
      startedAt: null,
      finishedAt: null,
      leaseOwner: null,
      leaseUntil: null,
      basedOnRevision: null,
      dedupeKey: null,
      progressCurrent: 0,
      progressTotal: null,
      progressMessage: null,
      lastError: null,
      lastErrorCode: null,
      lastErrorClass: null,
      workspaceId: projectA.workspaceId,
      projectId: projectB.projectId,
      actorClientId: null,
      sourceEventId: null,
      agentTypeId: "agt_scope_p5_3",
      agentBindingId: "agb_scope_p5_2",
      createdAt: 1,
      updatedAt: 1,
    }).run();

    const report = service.diagnose({ accountId: "scope-p5-owner" });
    expect(report.issues.some((issue) => issue.code === "runtime_job_agent_binding_project_mismatch")).toBe(true);
  });
});
