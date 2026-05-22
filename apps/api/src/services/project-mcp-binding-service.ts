import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectMcpBindings } from "../db/schema.js";

export type ProjectMcpBindingStatus = "enabled" | "disabled";

export type ProjectMcpBindingRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  mcpServerId: string;
  status: ProjectMcpBindingStatus;
  allowedTools: string[];
  configOverrideJson: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMcpBindingServiceErrorCode =
  | "binding_not_found"
  | "binding_already_exists";

export class ProjectMcpBindingServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: ProjectMcpBindingServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectMcpBindingServiceError";
  }
}

export class ProjectMcpBindingService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  listByProject(input: { projectId: string; accountId: string }): ProjectMcpBindingRecord[] {
    return this.db
      .select()
      .from(projectMcpBindings)
      .where(and(
        eq(projectMcpBindings.projectId, input.projectId),
        eq(projectMcpBindings.accountId, input.accountId),
      ))
      .all()
      .map(rowToRecord);
  }

  upsert(
    input: {
      workspaceId: string;
      projectId: string;
      accountId: string;
      mcpServerId: string;
      allowedTools?: string[];
      configOverrideJson?: Record<string, unknown>;
      status?: ProjectMcpBindingStatus;
    },
    now = Date.now(),
  ): ProjectMcpBindingRecord {
    const existing = this.db
      .select()
      .from(projectMcpBindings)
      .where(and(
        eq(projectMcpBindings.projectId, input.projectId),
        eq(projectMcpBindings.mcpServerId, input.mcpServerId),
      ))
      .limit(1)
      .all()[0];

    const allowedTools = Array.from(new Set(input.allowedTools ?? []));
    const configOverrideJson = JSON.stringify(input.configOverrideJson ?? {});
    const allowedToolsJson = JSON.stringify(allowedTools);
    const status = input.status ?? "enabled";

    if (existing) {
      this.db
        .update(projectMcpBindings)
        .set({
          allowedToolsJson,
          configOverrideJson,
          status,
          updatedAt: now,
        })
        .where(eq(projectMcpBindings.id, existing.id))
        .run();
    } else {
      const id = `pmb_${nanoid(16)}`;
      this.db
        .insert(projectMcpBindings)
        .values({
          id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          accountId: input.accountId,
          mcpServerId: input.mcpServerId,
          status,
          allowedToolsJson,
          configOverrideJson,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const refreshed = this.db
      .select()
      .from(projectMcpBindings)
      .where(and(
        eq(projectMcpBindings.projectId, input.projectId),
        eq(projectMcpBindings.mcpServerId, input.mcpServerId),
      ))
      .limit(1)
      .all()[0];

    if (!refreshed) {
      throw new ProjectMcpBindingServiceError(
        404,
        "binding_not_found",
        `Project mcp binding not found after upsert`,
      );
    }
    return rowToRecord(refreshed);
  }

  remove(input: { id: string; accountId: string }): void {
    this.db
      .delete(projectMcpBindings)
      .where(and(
        eq(projectMcpBindings.id, input.id),
        eq(projectMcpBindings.accountId, input.accountId),
      ))
      .run();
  }
}

function rowToRecord(row: typeof projectMcpBindings.$inferSelect): ProjectMcpBindingRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    mcpServerId: row.mcpServerId,
    status: row.status,
    allowedTools: parseStringArrayJson(row.allowedToolsJson),
    configOverrideJson: parseRecordJson(row.configOverrideJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseStringArrayJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
  } catch {
    return [];
  }
}

function parseRecordJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
