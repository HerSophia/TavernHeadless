import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { projectToolPolicyOverrides } from "../db/schema.js";

export type ProjectToolPolicyOverrideStatus = "active" | "archived";

export type ProjectToolPolicyOverrideRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  basePolicyId: string;
  overrideJson: Record<string, unknown>;
  status: ProjectToolPolicyOverrideStatus;
  createdAt: number;
  updatedAt: number;
};

export type ProjectToolPolicyOverrideServiceErrorCode =
  | "override_not_found"
  | "override_already_exists";

export class ProjectToolPolicyOverrideServiceError extends Error {
  constructor(
    public readonly statusCode: 404 | 409,
    public readonly code: ProjectToolPolicyOverrideServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectToolPolicyOverrideServiceError";
  }
}

export class ProjectToolPolicyOverrideService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  listByProject(input: { projectId: string; accountId: string }): ProjectToolPolicyOverrideRecord[] {
    return this.db
      .select()
      .from(projectToolPolicyOverrides)
      .where(and(
        eq(projectToolPolicyOverrides.projectId, input.projectId),
        eq(projectToolPolicyOverrides.accountId, input.accountId),
      ))
      .all()
      .map(rowToRecord);
  }

  upsert(
    input: {
      workspaceId: string;
      projectId: string;
      accountId: string;
      basePolicyId: string;
      overrideJson?: Record<string, unknown>;
      status?: ProjectToolPolicyOverrideStatus;
    },
    now = Date.now(),
  ): ProjectToolPolicyOverrideRecord {
    const existing = this.db
      .select()
      .from(projectToolPolicyOverrides)
      .where(and(
        eq(projectToolPolicyOverrides.projectId, input.projectId),
        eq(projectToolPolicyOverrides.basePolicyId, input.basePolicyId),
      ))
      .limit(1)
      .all()[0];

    const overrideJson = JSON.stringify(input.overrideJson ?? {});
    const status = input.status ?? "active";

    if (existing) {
      this.db
        .update(projectToolPolicyOverrides)
        .set({
          overrideJson,
          status,
          updatedAt: now,
        })
        .where(eq(projectToolPolicyOverrides.id, existing.id))
        .run();
    } else {
      const id = `pto_${nanoid(16)}`;
      this.db
        .insert(projectToolPolicyOverrides)
        .values({
          id,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          accountId: input.accountId,
          basePolicyId: input.basePolicyId,
          overrideJson,
          status,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    const refreshed = this.db
      .select()
      .from(projectToolPolicyOverrides)
      .where(and(
        eq(projectToolPolicyOverrides.projectId, input.projectId),
        eq(projectToolPolicyOverrides.basePolicyId, input.basePolicyId),
      ))
      .limit(1)
      .all()[0];

    if (!refreshed) {
      throw new ProjectToolPolicyOverrideServiceError(
        404,
        "override_not_found",
        `Project tool policy override missing after upsert`,
      );
    }
    return rowToRecord(refreshed);
  }
}

function rowToRecord(row: typeof projectToolPolicyOverrides.$inferSelect): ProjectToolPolicyOverrideRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    basePolicyId: row.basePolicyId,
    overrideJson: parseRecordJson(row.overrideJson),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
