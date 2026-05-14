import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, projectMemberships } from "../db/schema.js";
import { ProjectAccessService } from "./project-access-service.js";

export type ProjectMembershipRole = "owner" | "observer" | "deriver";
export type ProjectAssignableMembershipRole = "observer" | "deriver";
export type ProjectMembershipStatus = "active" | "removed";

export type ProjectMemberRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  role: ProjectMembershipRole;
  status: ProjectMembershipStatus;
  createdByAccountId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type ProjectMembershipServiceErrorCode =
  | "account_not_found"
  | "account_disabled"
  | "project_not_found"
  | "project_owner_membership_conflict"
  | "project_member_not_found"
  | "project_member_role_not_supported"
  | "project_member_owner_role_conflict"
  | "project_member_role_conflict"
  | "project_member_owner_remove_not_supported";

export class ProjectMembershipServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ProjectMembershipServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectMembershipServiceError";
  }
}

export type EnsureOwnerProjectMembershipInput = {
  workspaceId: string;
  projectId: string;
  accountId: string;
  createdByAccountId?: string | null;
  now: number;
};

/**
 * Returns the deterministic owner membership id used by migrations and repair code.
 */
export function buildOwnerProjectMembershipId(projectId: string): string {
  return `pmem_owner_${projectId}`;
}

/**
 * Ensures that a Project has an active owner membership for its owning account.
 */
export function ensureOwnerProjectMembership(
  db: AppDb | DbExecutor,
  input: EnsureOwnerProjectMembershipInput,
): ProjectMemberRecord {
  const existing = db
    .select()
    .from(projectMemberships)
    .where(and(
      eq(projectMemberships.projectId, input.projectId),
      eq(projectMemberships.accountId, input.accountId),
    ))
    .limit(1)
    .get();

  if (existing) {
    if (existing.role !== "owner") {
      throw new ProjectMembershipServiceError(
        409,
        "project_owner_membership_conflict",
        `Project owner membership conflicts with an existing member: ${input.projectId}`,
      );
    }

    if (existing.status === "active") {
      return mapProjectMemberRow(existing);
    }

    const updated = db
      .update(projectMemberships)
      .set({
        status: "active",
        updatedAt: input.now,
      })
      .where(eq(projectMemberships.id, existing.id))
      .returning()
      .get();

    return mapProjectMemberRow(updated);
  }

  const inserted = db
    .insert(projectMemberships)
    .values({
      id: buildOwnerProjectMembershipId(input.projectId),
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      accountId: input.accountId,
      role: "owner",
      status: "active",
      createdByAccountId: normalizeNullableString(input.createdByAccountId),
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();

  return mapProjectMemberRow(inserted);
}

/**
 * Manages Project owner, observer and deriver membership records.
 */
export class ProjectMembershipService {
  private readonly accessService: ProjectAccessService;

  constructor(private readonly db: AppDb | DbExecutor) {
    this.accessService = new ProjectAccessService(db);
  }

  ensureOwnerMembership(input: EnsureOwnerProjectMembershipInput): ProjectMemberRecord {
    return ensureOwnerProjectMembership(this.db, input);
  }

  listMembers(projectId: string): ProjectMemberRecord[] {
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    return this.db
      .select()
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, normalizedProjectId))
      .orderBy(projectMemberships.role, projectMemberships.createdAt)
      .all()
      .map(mapProjectMemberRow)
      .sort((left, right) => {
        const roleDiff = roleSortRank(left.role) - roleSortRank(right.role);
        return roleDiff !== 0 ? roleDiff : left.createdAt - right.createdAt;
      });
  }

  addObserver(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.addMember({
      actorAccountId: input.actorAccountId,
      projectId: input.projectId,
      accountId: input.accountId,
      role: "observer",
      now: input.now,
    });
  }

  addDeriver(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.addMember({
      actorAccountId: input.actorAccountId,
      projectId: input.projectId,
      accountId: input.accountId,
      role: "deriver",
      now: input.now,
    });
  }

  addMember(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    role: string;
    now?: number;
  }): ProjectMemberRecord {
    const now = input.now ?? Date.now();
    const targetAccountId = requireNonEmpty(input.accountId, "accountId");
    const role = normalizeAssignableRole(input.role);
    const access = this.accessService.requireProjectAction(
      input.actorAccountId,
      input.projectId,
      "project.manage_members",
    );

    const targetAccount = this.db
      .select({ id: accounts.id, status: accounts.status })
      .from(accounts)
      .where(eq(accounts.id, targetAccountId))
      .limit(1)
      .get();

    if (!targetAccount) {
      throw new ProjectMembershipServiceError(
        404,
        "account_not_found",
        `Account not found: ${targetAccountId}`,
      );
    }

    if (targetAccount.status !== "active") {
      throw new ProjectMembershipServiceError(
        409,
        "account_disabled",
        `Account is disabled: ${targetAccountId}`,
      );
    }

    if (targetAccountId === access.project.accountId) {
      throw new ProjectMembershipServiceError(
        400,
        "project_member_owner_role_conflict",
        "Project owner cannot be added as project member",
      );
    }

    const existing = this.db
      .select()
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, access.project.id),
        eq(projectMemberships.accountId, targetAccountId),
      ))
      .limit(1)
      .get();

    if (existing) {
      if (existing.role === "owner") {
        throw new ProjectMembershipServiceError(
          400,
          "project_member_owner_role_conflict",
          "Project owner cannot be downgraded to another project role",
        );
      }

      if (existing.role !== role) {
        throw new ProjectMembershipServiceError(
          409,
          "project_member_role_conflict",
          `Project member already has role: ${existing.role}`,
        );
      }

      if (existing.status === "active") {
        return mapProjectMemberRow(existing);
      }

      const updated = this.db
        .update(projectMemberships)
        .set({
          status: "active",
          updatedAt: now,
        })
        .where(eq(projectMemberships.id, existing.id))
        .returning()
        .get();

      return mapProjectMemberRow(updated);
    }

    const inserted = this.db
      .insert(projectMemberships)
      .values({
        id: `pmem_${nanoid()}`,
        workspaceId: access.project.workspaceId,
        projectId: access.project.id,
        accountId: targetAccountId,
        role,
        status: "active",
        createdByAccountId: input.actorAccountId,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    return mapProjectMemberRow(inserted);
  }

  removeMember(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    const now = input.now ?? Date.now();
    const targetAccountId = requireNonEmpty(input.accountId, "accountId");
    const access = this.accessService.requireProjectAction(
      input.actorAccountId,
      input.projectId,
      "project.manage_members",
    );

    const existing = this.db
      .select()
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, access.project.id),
        eq(projectMemberships.accountId, targetAccountId),
      ))
      .limit(1)
      .get();

    if (!existing || existing.status !== "active") {
      throw new ProjectMembershipServiceError(
        404,
        "project_member_not_found",
        `Project member not found: ${targetAccountId}`,
      );
    }

    if (existing.role === "owner") {
      throw new ProjectMembershipServiceError(
        400,
        "project_member_owner_remove_not_supported",
        "Project owner cannot be removed through member routes",
      );
    }

    const updated = this.db
      .update(projectMemberships)
      .set({
        status: "removed",
        updatedAt: now,
      })
      .where(eq(projectMemberships.id, existing.id))
      .returning()
      .get();

    return mapProjectMemberRow(updated);
  }

  removeObserver(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.removeMember({
      actorAccountId: input.actorAccountId,
      projectId: input.projectId,
      accountId: input.accountId,
      now: input.now,
    });
  }
}

function mapProjectMemberRow(row: typeof projectMemberships.$inferSelect): ProjectMemberRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    role: row.role,
    status: row.status,
    createdByAccountId: row.createdByAccountId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requireNonEmpty(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function normalizeAssignableRole(role: string): ProjectAssignableMembershipRole {
  const normalizedRole = requireNonEmpty(role, "role");
  if (normalizedRole === "observer" || normalizedRole === "deriver") {
    return normalizedRole;
  }

  throw new ProjectMembershipServiceError(
    400,
    "project_member_role_not_supported",
    "Only observer and deriver roles can be added through member routes",
  );
}

function roleSortRank(role: ProjectMembershipRole): number {
  if (role === "owner") return 0;
  if (role === "observer") return 1;
  return 2;
}
