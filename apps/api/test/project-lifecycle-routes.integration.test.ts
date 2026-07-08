import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { operationLogs } from "../src/db/schema.js";
import {
  createTestProject,
  ensureTestDefaultWorkspace,
} from "../src/__tests__/helpers/workspace-project.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";

type ProjectResponse = {
  id: string;
  workspace_id: string;
  account_id: string;
  name: string;
  description: string | null;
  kind: "session_default" | "manual";
  status: "active" | "archived";
  role: string;
  settings_override: unknown;
  created_at: number;
  updated_at: number;
};

describe("project lifecycle routes integration", () => {
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

  it("creates a manual project and records an audit log", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "  Growth  ", description: "  a project  ", settings: { model: "gpt" } },
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<ProjectResponse>();
    expect(body.name).toBe("Growth");
    expect(body.description).toBe("a project");
    expect(body.kind).toBe("manual");
    expect(body.status).toBe("active");
    expect(body.role).toBe("owner");
    expect(body.settings_override).toEqual({ model: "gpt" });
    expect(body.id.startsWith("proj_")).toBe(true);

    const audit = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "project.create"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.projectId).toBe(body.id);
    expect(audit[0]?.actorAccountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
    expect(audit[0]?.result).toBe("allowed");
  });

  it("updates a project and rejects empty updates", async () => {
    const created = await app.inject({ method: "POST", url: "/projects", payload: { name: "Before" } });
    const id = created.json<ProjectResponse>().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/projects/${id}`,
      payload: { name: "After", settings: { locale: "zh" } },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const body = updated.json<ProjectResponse>();
    expect(body.name).toBe("After");
    expect(body.settings_override).toEqual({ locale: "zh" });

    const empty = await app.inject({ method: "PATCH", url: `/projects/${id}`, payload: {} });
    expect(empty.statusCode).toBe(400);
  });

  it("archives and restores a manual project with lifecycle guards", async () => {
    const created = await app.inject({ method: "POST", url: "/projects", payload: { name: "Lifecycle" } });
    const id = created.json<ProjectResponse>().id;

    const archived = await app.inject({ method: "POST", url: `/projects/${id}/archive` });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json<ProjectResponse>().status).toBe("archived");

    const activeList = await app.inject({ method: "GET", url: "/projects" });
    expect(activeList.json<{ items: ProjectResponse[] }>().items.some((p) => p.id === id)).toBe(false);

    const archivedList = await app.inject({ method: "GET", url: "/projects?status=archived" });
    expect(archivedList.json<{ items: ProjectResponse[] }>().items.some((p) => p.id === id)).toBe(true);

    const restored = await app.inject({ method: "POST", url: `/projects/${id}/restore` });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json<ProjectResponse>().status).toBe("active");

    const restoreAgain = await app.inject({ method: "POST", url: `/projects/${id}/restore` });
    expect(restoreAgain.statusCode).toBe(409);
    expect(restoreAgain.json<{ error: { code: string } }>().error.code).toBe("project_not_archived");
  });

  it("refuses to archive the session_default project", async () => {
    const scope = createTestProject(database, { id: "proj_session_default_route" });
    const response = await app.inject({ method: "POST", url: `/projects/${scope.projectId}/archive` });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("project_session_default_immutable");
  });

  it("duplicates a project into a new manual project", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Original", settings: { flag: true } },
    });
    const id = created.json<ProjectResponse>().id;

    const copy = await app.inject({ method: "POST", url: `/projects/${id}/duplicate`, payload: {} });
    expect(copy.statusCode, copy.body).toBe(201);
    const body = copy.json<ProjectResponse>();
    expect(body.id).not.toBe(id);
    expect(body.kind).toBe("manual");
    expect(body.name).toBe("Original (\u526f\u672c)");
    expect(body.settings_override).toEqual({ flag: true });
  });

  it("returns 404 for unknown project updates", async () => {
    const response = await app.inject({ method: "PATCH", url: "/projects/proj_missing", payload: { name: "x" } });
    expect(response.statusCode).toBe(404);
  });
});
