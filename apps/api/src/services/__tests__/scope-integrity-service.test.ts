import { afterEach, beforeEach,describe,expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { derivedOutputs, operationLogs, sessions } from "../../db/schema.js";
import {
  createTestProject,
  createTestSessionWithScope,
  ensureTestAccount,
} from "../../__tests__/helpers/workspace-project.js";
import { ScopeIntegrityService } from "../scope-integrity-service.js";

const ACCOUNT = "scope-integrity-acc";
const NOW = 1_732_000_000_000;

describe("ScopeIntegrityService", () => {
  let database: DatabaseConnection;
  let service: ScopeIntegrityService;

  beforeEach(() => {
    database = createDatabase(":memory:");
    ensureTestAccount(database.db, ACCOUNT, NOW);
    service = new ScopeIntegrityService(database.db);
  });

  afterEach(() => {
    database.close();
  });

  it("reports no issues for clean data", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: "clean-proj", now: NOW });
    createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "clean-sess",
      now: NOW + 1,
    });
    const report = service.diagnose({ accountId: ACCOUNT });
    expect(report.issues).toHaveLength(0);
  });

  it("flags and repairs derived output workspace mismatch", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: "mm-proj", now: NOW });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "mm-sess",
      now: NOW + 1,
    });

    // Seed a derived output with a wrong workspace id.
    database.db
      .insert(derivedOutputs)
      .values({
        id: "dout-mismatch",
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        accountId: ACCOUNT,
        ownerAccountId: ACCOUNT,
        ownerClientId: null,
        sourceSessionId: session.sessionId,
        sourceFloorId: null,
        sourcePageId: null,
        domain: "test",
        valueJson: "{}",
        status: "draft",
        createdAt: NOW + 10,
        updatedAt: NOW + 10,
      })
      .run();

    // Force the derived output workspace id to drift to a different value.
    database.db.run(sql`PRAGMA foreign_keys = OFF`);
    database.db.run(
      sql`UPDATE derived_output SET workspace_id = 'ws_drifted' WHERE id = 'dout-mismatch'`,
    );
    database.db.run(sql`PRAGMA foreign_keys = ON`);



    const diagnose = service.diagnose({ accountId: ACCOUNT });
    const issue = diagnose.issues.find((entry) => entry.code === "derived_output_workspace_mismatch");
    expect(issue).toBeDefined();
    expect(issue?.repairable).toBe(true);

    const repair = service.repair({ accountId: ACCOUNT, now: NOW + 100 });
    expect(repair.repaired.length).toBeGreaterThanOrEqual(1);

    const after = service.diagnose({ accountId: ACCOUNT });
    expect(after.issues.find((entry) => entry.code === "derived_output_workspace_mismatch")).toBeUndefined();
  });

  it("flags missing session workspace as repairable", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: "miss-proj", now: NOW });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "miss-sess",
      now: NOW + 1,
    });

    database.db
      .update(sessions)
      .set({ workspaceId: sql`NULL` as unknown as string })
      .where(and(eq(sessions.id, session.sessionId)))
      .run();

    const diagnose = service.diagnose({ accountId: ACCOUNT });
    const issue = diagnose.issues.find((entry) => entry.code === "session_workspace_missing");
    expect(issue).toBeDefined();
    expect(issue?.repairable).toBe(true);

    service.repair({ accountId: ACCOUNT, now: NOW + 200 });
    const after = service.diagnose({ accountId: ACCOUNT });
    expect(after.issues.find((entry) => entry.code === "session_workspace_missing")).toBeUndefined();
  });

  it("summarizes a clean account with zero drift", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: "sum-clean-proj", now: NOW });
    createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "sum-clean-sess",
      now: NOW + 1,
    });

    const summary = service.summarize({ accountId: ACCOUNT });
    expect(summary.totalIssues).toBe(0);
    expect(summary.repairableIssues).toBe(0);
    expect(summary.unrepairableIssues).toBe(0);
    expect(summary.truncated).toBe(false);
    expect(summary.sessionsMissingWorkspaceId).toBe(0);
    expect(summary.sessionsMissingProjectId).toBe(0);
    expect(summary.byCode).toHaveLength(0);
  });

  it("aggregates session scope drift into per-code counts", () => {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: "sum-proj", now: NOW });
    const missingWorkspace = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "sum-miss-ws",
      now: NOW + 1,
    });
    const missingProject = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: "sum-miss-proj",
      now: NOW + 2,
    });

    database.db
      .update(sessions)
      .set({ workspaceId: sql`NULL` as unknown as string })
      .where(eq(sessions.id, missingWorkspace.sessionId))
      .run();
    database.db
      .update(sessions)
      .set({ projectId: sql`NULL` as unknown as string })
      .where(eq(sessions.id, missingProject.sessionId))
      .run();

    const summary = service.summarize({ accountId: ACCOUNT });
    expect(summary.sessionsMissingWorkspaceId).toBe(1);
    expect(summary.sessionsMissingProjectId).toBe(1);
    expect(summary.totalIssues).toBe(summary.repairableIssues + summary.unrepairableIssues);
    expect(summary.totalIssues).toBeGreaterThanOrEqual(2);

    const workspaceCode = summary.byCode.find((entry) => entry.code === "session_workspace_missing");
    expect(workspaceCode?.total).toBe(1);
    expect(workspaceCode?.repairable).toBe(1);
    const projectCode = summary.byCode.find((entry) => entry.code === "session_project_missing");
    expect(projectCode?.total).toBe(1);

    // byCode is sorted by code for stable rendering.
    const codes = summary.byCode.map((entry) => entry.code);
    const sorted = [...codes].sort((a, b) => a.localeCompare(b));
    expect(codes).toEqual(sorted);
  });

  function seedRepairableWorkspaceDrift(id: string): void {
    const project = createTestProject(database.db, { accountId: ACCOUNT, id: `${id}-proj`, now: NOW });
    const session = createTestSessionWithScope(database.db, {
      accountId: ACCOUNT,
      projectId: project.projectId,
      id: `${id}-sess`,
      now: NOW + 1,
    });
    database.db
      .update(sessions)
      .set({ workspaceId: sql`NULL` as unknown as string })
      .where(and(eq(sessions.id, session.sessionId)))
      .run();
  }

  it("audits scope_integrity.repair on a real repair with an audit actor", () => {
    seedRepairableWorkspaceDrift("audit-real");

    service.repair({
      accountId: ACCOUNT,
      now: NOW + 100,
      audit: { actorType: "system", source: "startup_repair" },
    });

    const logs = database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.repair"))
      .all();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.accountId).toBe(ACCOUNT);
    expect(logs[0]?.actorType).toBe("system");
    expect(logs[0]?.sourceType).toBe("startup_repair");
    expect(logs[0]?.result).toBe("allowed");
    const metadata = JSON.parse(logs[0]?.metadataJson ?? "{}") as {
      dry_run: boolean;
      repaired_count: number;
      repaired_by_code: Record<string, number>;
    };
    expect(metadata.dry_run).toBe(false);
    expect(metadata.repaired_count).toBeGreaterThanOrEqual(1);
    expect(metadata.repaired_by_code.session_workspace_missing).toBe(1);
  });

  it("audits scope_integrity.diagnose (not repair) on a dry-run", () => {
    seedRepairableWorkspaceDrift("audit-dry");

    service.repair({
      accountId: ACCOUNT,
      dryRun: true,
      now: NOW + 100,
      audit: { actorType: "account", actorAccountId: ACCOUNT, source: "api" },
    });

    const diagnoseLogs = database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.diagnose"))
      .all();
    expect(diagnoseLogs).toHaveLength(1);
    const metadata = JSON.parse(diagnoseLogs[0]?.metadataJson ?? "{}") as { dry_run: boolean };
    expect(metadata.dry_run).toBe(true);

    const repairLogs = database.db
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.repair"))
      .all();
    expect(repairLogs).toHaveLength(0);
  });

  it("writes no audit for a clean account or when no audit actor is supplied", () => {
    // Clean account with audit actor: nothing to report.
    service.repair({
      accountId: ACCOUNT,
      now: NOW + 100,
      audit: { actorType: "system", source: "startup_repair" },
    });

    // Drift but no audit actor: repair still applies, but no audit is written.
    seedRepairableWorkspaceDrift("audit-none");
    service.repair({ accountId: ACCOUNT, now: NOW + 200 });

    const logs = database.db
      .select()
      .from(operationLogs)
      .where(
        sql`${operationLogs.action} IN ('scope_integrity.repair', 'scope_integrity.diagnose')`,
      )
      .all();
    expect(logs).toHaveLength(0);
  });
});
