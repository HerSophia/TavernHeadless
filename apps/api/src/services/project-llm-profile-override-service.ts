import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import{ projectLlmProfileOverrides } from "../db/schema.js";

export type ProjectLlmProfileOverrideStatus = "active" | "archived";

export type ProjectLlmProfileOverrideRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  baseProfileId: string;
  overrideJson: Record<string, unknown>;
  status: ProjectLlmProfileOverrideStatus;
  createdAt: number;
  updatedAt: number;
};

export type ProjectLlmProfileOverrideServiceErrorCode =
  | "override_not_found"
  | "override_already_active"
  | "override_invalid_status";

export class ProjectLlmProfileOverrideServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ProjectLlmProfileOverrideServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectLlmProfileOverrideServiceError";
  }
}

export class ProjectLlmProfileOverrideService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  getActive(input: { projectId: string; accountId: string }): ProjectLlmProfileOverrideRecord | null {
    const row = this.db
      .select()
  .from(projectLlmProfileOverrides)
      .where(and(
        eq(projectLlmProfileOverrides.projectId, input.projectId),
        eq(projectLlmProfileOverrides.accountId, input.accountId),
        eq(projectLlmProfileOverrides.status, "active"),
      ))
      .limit(1)
.all()[0];
    return row ? rowToRecord(row) : null;
  }

  upsert(
    input: {
      workspaceId: string;
      projectId: string;
      accountId: string;
      baseProfileId: string;
      overrideJson?: Record<string, unknown>;
    },
    now = Date.now(),
  ): ProjectLlmProfileOverrideRecord {
    const existing = this.getActive(input);
    if (existing) {
      this.db
        .update(projectLlmProfileOverrides)
        .set({
          baseProfileId: input.baseProfileId,
          overrideJson: JSON.stringify(input.overrideJson ?? {}),
          updatedAt: now,
        })
        .where(eq(projectLlmProfileOverrides.id, existing.id))
        .run();
      const refreshed = this.getActive(input);
      if (!refreshed) {
        throw new ProjectLlmProfileOverrideServiceError(
          404,
          "override_not_found",
          `Override missing after upsert: ${existing.id}`,
        );
      }
      return refreshed;
    }

    const id = `plo_${nanoid(16)}`;
    this.db
      .insert(projectLlmProfileOverrides)
      .values({
        id,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        accountId: input.accountId,
        baseProfileId: input.baseProfileId,
        overrideJson: JSON.stringify(input.overrideJson ?? {}),
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const refreshed = this.getActive(input);
  if (!refreshed) {
      throw new ProjectLlmProfileOverrideServiceError(404, "override_not_found", `Override not found: ${id}`);
    }
    return refreshed;
  }

  archive(input: { projectId: string; accountId: string }, now = Date.now()): void {
    const existing = this.getActive(input);
    if(!existing) {
      return;
    }
    this.db
      .update(projectLlmProfileOverrides)
      .set({ status: "archived", updatedAt: now })
      .where(eq(projectLlmProfileOverrides.id, existing.id))
      .run();
  }
}

function rowToRecord(row: typeof projectLlmProfileOverrides.$inferSelect): ProjectLlmProfileOverrideRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    baseProfileId: row.baseProfileId,
    overrideJson: parseRecordJson(row.overrideJson),
    status: row.status,
    createdAt: row.createdAt,
updatedAt: row.updatedAt,
  };
}

function parseRecordJson(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value =JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
 ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
