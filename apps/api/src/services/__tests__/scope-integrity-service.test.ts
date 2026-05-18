import { afterEach, beforeEach,describe,expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { createDatabase, type DatabaseConnection } from "../../db/client.js";
import { derivedOutputs, sessions } from "../../db/schema.js";
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
});
