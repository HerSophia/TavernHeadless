import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type { DatabaseConnection } from "../src/db/client.js";
import { operationLogs } from "../src/db/schema.js";
import {
  ensureTestDefaultWorkspace,
} from "../src/__tests__/helpers/workspace-project.js";
import { ClientApiKeyService } from "../src/services/client-api-key-service.js";
import { ClientService } from "../src/services/client-service.js";
import { DEFAULT_ADMIN_ACCOUNT_ID } from "../src/accounts/constants.js";

type WorkspaceResponse = {
  id: string;
  account_id: string;
  name: string;
  kind: "default" | "manual";
  is_default: boolean;
  status: "active" | "archived";
  settings: Record<string, unknown>;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

describe("workspace management routes integration", () => {
  let app: FastifyInstance;
  let database: DatabaseConnection["db"];
  let defaultWorkspaceId: string;

  beforeEach(async () => {
    const built = await buildApp({
      databasePath: ":memory:",
      logger: false,
      auth: { mode: "off" },
    });
    app = built.app;
    database = built.database;
    defaultWorkspaceId = ensureTestDefaultWorkspace(database).workspaceId;
  });

  afterEach(async () => {
    await app.close();
  });

  it("creates a manual workspace and records an audit log", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "  Growth Team  ", settings: { theme: "dark" } },
    });

    expect(response.statusCode, response.body).toBe(201);
    const body = response.json<WorkspaceResponse>();
    expect(body.name).toBe("Growth Team");
    expect(body.kind).toBe("manual");
    expect(body.is_default).toBe(false);
    expect(body.status).toBe("active");
    expect(body.archived_at).toBeNull();
    expect(body.settings).toEqual({ theme: "dark" });
    expect(body.id.startsWith("ws_")).toBe(true);

    const audit = database
      .select()
      .from(operationLogs)
      .where(eq(operationLogs.action, "workspace.create"))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.workspaceId).toBe(body.id);
    expect(audit[0]?.actorAccountId).toBe(DEFAULT_ADMIN_ACCOUNT_ID);
    expect(audit[0]?.result).toBe("allowed");
  });

  it("lists active workspaces by default and includes archived when requested", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "Manual One" },
    });
    const manualId = created.json<WorkspaceResponse>().id;

    const archived = await app.inject({ method: "POST", url: `/workspaces/${manualId}/archive` });
    expect(archived.statusCode, archived.body).toBe(200);

    const activeList = await app.inject({ method: "GET", url: "/workspaces" });
    expect(activeList.statusCode).toBe(200);
    const activeItems = activeList.json<{ items: WorkspaceResponse[] }>().items;
    expect(activeItems.some((item) => item.id === defaultWorkspaceId)).toBe(true);
    expect(activeItems.some((item) => item.id === manualId)).toBe(false);

    const archivedList = await app.inject({ method: "GET", url: "/workspaces?include_archived=true" });
    expect(archivedList.statusCode).toBe(200);
    const archivedItems = archivedList.json<{ items: WorkspaceResponse[] }>().items;
    expect(archivedItems.some((item) => item.id === manualId && item.status === "archived")).toBe(true);

    const statusFiltered = await app.inject({ method: "GET", url: "/workspaces?status=archived" });
    const statusItems = statusFiltered.json<{ items: WorkspaceResponse[] }>().items;
    expect(statusItems.every((item) => item.status === "archived")).toBe(true);
    expect(statusItems.some((item) => item.id === manualId)).toBe(true);
  });

  it("gets a workspace by id and returns 404 for unknown", async () => {
    const detail = await app.inject({ method: "GET", url: `/workspaces/${defaultWorkspaceId}` });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json<WorkspaceResponse>().is_default).toBe(true);

    const missing = await app.inject({ method: "GET", url: "/workspaces/ws_missing" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<{ error: { code: string } }>().error.code).toBe("workspace_not_found");
  });

  it("updates name and settings and rejects empty updates", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "Before" },
    });
    const manualId = created.json<WorkspaceResponse>().id;

    const updated = await app.inject({
      method: "PATCH",
      url: `/workspaces/${manualId}`,
      payload: { name: "After", settings: { locale: "en" } },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    const body = updated.json<WorkspaceResponse>();
    expect(body.name).toBe("After");
    expect(body.settings).toEqual({ locale: "en" });

    const empty = await app.inject({
      method: "PATCH",
      url: `/workspaces/${manualId}`,
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it("archives and restores a manual workspace and refuses to archive the default", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/workspaces",
      payload: { name: "Lifecycle" },
    });
    const manualId = created.json<WorkspaceResponse>().id;

    const archived = await app.inject({ method: "POST", url: `/workspaces/${manualId}/archive` });
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json<WorkspaceResponse>().status).toBe("archived");
    expect(archived.json<WorkspaceResponse>().archived_at).not.toBeNull();

    const archiveAgain = await app.inject({ method: "POST", url: `/workspaces/${manualId}/archive` });
    expect(archiveAgain.statusCode).toBe(409);
    expect(archiveAgain.json<{ error: { code: string } }>().error.code).toBe("workspace_already_archived");

    const restored = await app.inject({ method: "POST", url: `/workspaces/${manualId}/restore` });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json<WorkspaceResponse>().status).toBe("active");
    expect(restored.json<WorkspaceResponse>().archived_at).toBeNull();

    const restoreAgain = await app.inject({ method: "POST", url: `/workspaces/${manualId}/restore` });
    expect(restoreAgain.statusCode).toBe(409);
    expect(restoreAgain.json<{ error: { code: string } }>().error.code).toBe("workspace_not_archived");

    const defaultArchive = await app.inject({ method: "POST", url: `/workspaces/${defaultWorkspaceId}/archive` });
    expect(defaultArchive.statusCode).toBe(409);
    expect(defaultArchive.json<{ error: { code: string } }>().error.code).toBe("workspace_default_immutable");
  });

  it("returns 403 workspace_account_only for client actors", async () => {
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
      url: "/workspaces",
      headers: { "x-tavern-client-key": apiKey.secret },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: { code: string } }>().error.code).toBe("workspace_account_only");
  });
});
