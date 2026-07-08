import type { FastifyInstance } from "fastify";
import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { operationLogs, sessions } from "../src/db/schema.js";
import {
  createTestSessionWithScope,
  ensureTestDefaultWorkspace,
} from "../src/__tests__/helpers/workspace-project.js";
import { ClientApiKeyService } from "../src/services/client-api-key-service.js";
import { ClientService } from "../src/services/client-service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";

type ScopeIssue = {
  id: string;
  severity: "error" | "warning";
  table: string;
  record_id: string;
  code: string;
  message: string;
  repairable: boolean;
};

type ReportResponse = {
  summary: {
    total_issues: number;
    repairable_issues: number;
    unrepairable_issues: number;
    truncated: boolean;
    sessions_missing_workspace_id: number;
    sessions_missing_project_id: number;
    by_code: { code: string; severity: string; total: number; repairable: number; unrepairable: number }[];
  };
  issues: ScopeIssue[];
};

type RepairResponse = {
  dry_run: boolean;
  repaired_count: number;
  remaining_count: number;
  repaired: ScopeIssue[];
  remaining: ScopeIssue[];
};

describe("scope integrity routes integration", () => {
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
    ensureTestDefaultWorkspace(database);
  });

  afterEach(async () => {
    await app.close();
  });

  /** Seeds a session and drops its workspace_id to create repairable drift. */
  function seedSessionWorkspaceDrift(id: string): void {
    const session = createTestSessionWithScope(database, { id, now: 1 });
    database
      .update(sessions)
      .set({ workspaceId: sql`NULL` as unknown as string })
      .where(and(eq(sessions.id, session.sessionId)))
      .run();
  }

  it("reports aggregated scope drift for the current account", async () => {
    seedSessionWorkspaceDrift("scope-report-sess");

    const response = await app.inject({ method: "GET", url: "/scope-integrity/report" });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<ReportResponse>();

    expect(body.summary.total_issues).toBeGreaterThanOrEqual(1);
    expect(body.summary.sessions_missing_workspace_id).toBe(1);
    expect(body.summary.repairable_issues).toBeGreaterThanOrEqual(1);
    const wsCode = body.summary.by_code.find((entry) => entry.code === "session_workspace_missing");
    expect(wsCode?.total).toBe(1);
    expect(body.issues.some((issue) => issue.code === "session_workspace_missing")).toBe(true);
  });

  it("defaults to a dry-run preview that does not mutate and audits scope_integrity.diagnose", async () => {
    seedSessionWorkspaceDrift("scope-dryrun-sess");

    const response = await app.inject({ method: "POST", url: "/scope-integrity/repair", payload: {} });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RepairResponse>();
    expect(body.dry_run).toBe(true);
    expect(body.repaired_count).toBeGreaterThanOrEqual(1);

    // Dry-run must not actually repair.
    const after = await app.inject({ method: "GET", url: "/scope-integrity/report" });
    expect(after.json<ReportResponse>().summary.sessions_missing_workspace_id).toBe(1);

    const diagnoseAudit = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.diagnose"))
      .all();
    expect(diagnoseAudit.length).toBeGreaterThanOrEqual(1);
    expect(diagnoseAudit[0]?.accountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
    expect(diagnoseAudit[0]?.result).toBe("allowed");

    // A dry-run must never write a real repair audit.
    const repairAudit = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.repair"))
      .all();
    expect(repairAudit).toHaveLength(0);
  });

  it("performs a real repair with dry_run=false and audits scope_integrity.repair", async () => {
    seedSessionWorkspaceDrift("scope-real-sess");

    const response = await app.inject({
      method: "POST",
      url: "/scope-integrity/repair",
      payload: { dry_run: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json<RepairResponse>();
    expect(body.dry_run).toBe(false);
    expect(body.repaired_count).toBeGreaterThanOrEqual(1);

    // The drift is fixed.
    const after = await app.inject({ method: "GET", url: "/scope-integrity/report" });
    expect(after.json<ReportResponse>().summary.sessions_missing_workspace_id).toBe(0);

    const repairAudit = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "scope_integrity.repair"))
      .all();
    expect(repairAudit.length).toBeGreaterThanOrEqual(1);
    expect(repairAudit[0]?.accountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
  });

  it("does not audit when the account is clean", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/scope-integrity/repair",
      payload: { dry_run: false },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json<RepairResponse>().repaired_count).toBe(0);

    const audits = database
      .select()
      .from(operationLogs)
      .where(
        sql`${operationLogs.action} IN ('scope_integrity.repair', 'scope_integrity.diagnose')`,
      )
      .all();
    expect(audits).toHaveLength(0);
  });

  it("returns 403 scope_integrity_account_only for client actors", async () => {
    const client = new ClientService(database).create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      name: "Automation Client",
      kind: "custom",
      now: 1,
    });
    const apiKey = new ClientApiKeyService(database).create({
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      clientId: client.id,
      now: 2,
    });

    const response = await app.inject({
      method: "GET",
      url: "/scope-integrity/report",
      headers: { "x-tavern-client-key": apiKey.secret },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("scope_integrity_account_only");
  });
});
