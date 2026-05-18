import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { accounts, clients, projectMemberships } from "../db/schema.js";
import { ProjectAccessService, type ProjectActorInput } from "./project-access-service.js";

export type ProjectMembershipRole = "owner" | "observer" | "deriver";
export type ProjectAssignableMembershipRole = "observer" | "deriver";
export type ProjectMembershipStatus = "active" | "removed";
export type ProjectMemberSubjectType = "account" | "client";

export type ProjectMemberSubject = {
  subjectType: ProjectMemberSubjectType;
  subjectId: string;
};

export type ProjectMemberRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  role: ProjectMembershipRole;
  status: ProjectMembershipStatus;
  subjectType: ProjectMemberSubjectType;
  subjectId: string;
  clientId: string | null;
  createdByAccountId: string | null;
  createdByClientId: string | null;
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
  | "project_member_owner_remove_not_supported"
  | "project_member_subject_invalid"
  | "project_member_client_not_found"
  | "project_member_default_client_owner_conflict";

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
      eq(projectMemberships.subjectType, "account"),
      eq(projectMemberships.subjectId, input.accountId),
    ))
    .limit(1)
    .get();

  if (existing) {
    if (existing.role !== "owner") {
      throw new ProjectMembershipServiceError(
        409,
        "project_owner_membership_conflict",
        `Project owner membershipconflicts with an existing member: ${input.projectId}`,
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
      subjectType: "account",
      subjectId: input.accountId,
      clientId: null,
      createdByAccountId: normalizeNullableString(input.createdByAccountId),
      createdByClientId: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning()
    .get();

  return mapProjectMemberRow(inserted);
}

export type AddSubjectMemberInput = {
  actor: ProjectActorInput;
  projectId: string;
  subjectType: ProjectMemberSubjectType;
  subjectId: string;
  role: ProjectAssignableMembershipRole | string;
  now?: number;
};

export type RemoveSubjectMemberInput = {
  actor: ProjectActorInput;
  projectId: string;
  subjectType: ProjectMemberSubjectType;
  subjectId: string;
  now?: number;
};

/**
 * Manages Project owner, observerand deriver membership records.
 *
 * In phase 4 the service supports both account subjects and client subjects.
 * Legacy account-only methods (`addObserver`, `addDeriver`, `addMember`,
 * `removeMember`, `removeObserver`) keep their old signatures for backwards
 * compatibility and route to the subject-aware path internally.
 */
export class ProjectMembershipService {
  private readonly accessService: ProjectAccessService;

  constructor(private readonly db: AppDb | DbExecutor) {
    this.accessService = new ProjectAccessService(db);
  }

  ensureOwnerMembership(input: EnsureOwnerProjectMembershipInput): ProjectMemberRecord {
    return ensureOwnerProjectMembership(this.db, input);
  }

  listMembers(projectId:string): ProjectMemberRecord[]{
    const normalizedProjectId = requireNonEmpty(projectId, "projectId");
    return this.db
      .select()
      .from(projectMemberships)
      .where(eq(projectMemberships.projectId, normalizedProjectId))
      .all()
      .map(mapProjectMemberRow)
    .sort((left, right) => {
        const rank = subjectSortRank(left) - subjectSortRank(right);
        return rank !== 0 ? rank : left.createdAt - right.createdAt;
      });
  }

  addObserver(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.addSubjectMember({
      actor: legacyAccountActor(input.actorAccountId),
      projectId: input.projectId,
      subjectType: "account",
      subjectId: input.accountId,
      role: "observer",
    now: input.now,
    });
  }

  addDeriver(input: {
   actorAccountId: string;
    projectId:string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.addSubjectMember({
      actor: legacyAccountActor(input.actorAccountId),
      projectId: input.projectId,
      subjectType: "account",
      subjectId: input.accountId,
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
    return this.addSubjectMember({
      actor: legacyAccountActor(input.actorAccountId),
      projectId: input.projectId,
      subjectType: "account",
      subjectId: input.accountId,
      role: input.role,
      now: input.now,
    });
  }

  removeMember(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.removeSubjectMember({
   actor: legacyAccountActor(input.actorAccountId),
     projectId: input.projectId,
      subjectType: "account",
      subjectId: input.accountId,
now: input.now,
    });
  }

  removeObserver(input: {
    actorAccountId: string;
    projectId: string;
    accountId: string;
    now?: number;
  }): ProjectMemberRecord {
    return this.removeSubjectMember({
      actor: legacyAccountActor(input.actorAccountId),
      projectId: input.projectId,
      subjectType: "account",
      subjectId: input.accountId,
      now: input.now,
    });
  }

  addSubjectMember(input: AddSubjectMemberInput):ProjectMemberRecord {
    const now = input.now ?? Date.now();
    const subjectType = normalizeSubjectType(input.subjectType);
    const subjectId = requireNonEmpty(input.subjectId, "subject_id");
    const role = normalizeAssignableRole(input.role);
    const access = this.accessService.requireProjectActionForActor(
      input.actor,
      input.projectId,
      "project.manage_members",
    );

    let resolvedClientId: string | null = null;
    let resolvedAccountId: string;

    if (subjectType === "account") {
      const account = this.db
        .select({ id: accounts.id, status: accounts.status })
        .from(accounts)
        .where(eq(accounts.id, subjectId))
        .limit(1)
        .get();

      if (!account) {
        throw new ProjectMembershipServiceError(
          404,
      "account_not_found",
          `Account not found: ${subjectId}`,
  );
      }

      if (account.status !== "active") {
        throw new ProjectMembershipServiceError(
          409,
          "account_disabled",
          `Account is disabled: ${subjectId}`,
        );
      }

      if (subjectId === access.project.accountId) {
        throw new ProjectMembershipServiceError(
          400,
          "project_member_owner_role_conflict",
          "Project owner cannot be added as project member",
        );
      }

      resolvedAccountId = subjectId;
    } else {
      const client = this.db
        .select({
          id: clients.id,
      accountId: clients.accountId,
          status: clients.status,
     isDefault: clients.isDefault,
        })
        .from(clients)
        .where(eq(clients.id, subjectId))
        .limit(1)
    .get();

      if (!client) {
        throw new ProjectMembershipServiceError(
          404,
          "project_member_client_not_found",
          `Client not found: ${subjectId}`,
        );
      }

      if (client.status !=="active") {
        throw new ProjectMembershipServiceError(
         409,
          "project_member_client_not_found",
          `Client is not active: ${subjectId}`,
        );
      }

      if (client.isDefault && client.accountId === access.project.accountId) {
        throw new ProjectMembershipServiceError(
          400,
     "project_member_default_client_owner_conflict",
        "Default client of the project owner cannot be added as a project member",
        );
      }

      resolvedAccountId = client.accountId;
      resolvedClientId = client.id;
    }

    const existing = this.db
      .select()
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, access.project.id),
        eq(projectMemberships.subjectType, subjectType),
        eq(projectMemberships.subjectId, subjectId),
      ))
      .limit(1)
      .get();

    if (existing) {
if (existing.role ==="owner") {
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

      const updated =this.db
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
        accountId: resolvedAccountId,
        role,
        status: "active",
        subjectType,
        subjectId,
        clientId: resolvedClientId,
        createdByAccountId: input.actor.actorAccountId,
        createdByClientId: input.actor.actorClientId ?? null,
createdAt: now,
   updatedAt: now,
      })
      .returning()
      .get();

    return mapProjectMemberRow(inserted);
  }

  removeSubjectMember(input: RemoveSubjectMemberInput): ProjectMemberRecord {
    const now = input.now ?? Date.now();
    const subjectType = normalizeSubjectType(input.subjectType);
   const subjectId = requireNonEmpty(input.subjectId,"subject_id");
    const access = this.accessService.requireProjectActionForActor(
      input.actor,
      input.projectId,
      "project.manage_members",
    );

const existing = this.db
      .select()
      .from(projectMemberships)
      .where(and(
        eq(projectMemberships.projectId, access.project.id),
        eq(projectMemberships.subjectType, subjectType),
        eq(projectMemberships.subjectId, subjectId),
))
      .limit(1)
      .get();

    if (!existing || existing.status !== "active") {
      throw new ProjectMembershipServiceError(
      404,
        "project_member_not_found",
`Project member not found: ${subjectId}`,
      );
    }

    if (existing.role === "owner") {
      throw new ProjectMembershipServiceError(
        400,
        "project_member_owner_remove_not_supported",
        "Project owner cannot beremoved through member routes",
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
}

function mapProjectMemberRow(row: typeof projectMemberships.$inferSelect): ProjectMemberRecord {
  const subjectType = (row.subjectType ?? "account") as ProjectMemberSubjectType;
  const subjectId = row.subjectId ?? row.accountId;
  return {
    id:row.id,
    workspaceId: row.workspaceId,
  projectId: row.projectId,
    accountId: row.accountId,
role: row.role,
    status: row.status,
    subjectType,
    subjectId,
    clientId: row.clientId,
    createdByAccountId: row.createdByAccountId,
    createdByClientId: row.createdByClientId,
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
  const trimmed = typeof value === "string" ? value.trim() : "";
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

function normalizeSubjectType(value: string): ProjectMemberSubjectType {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "account" || normalized === "client") {
    return normalized;
  }
  throw new ProjectMembershipServiceError(
    400,
    "project_member_subject_invalid",
    "Project member subject type must be 'account' or 'client'",
  );
}

function subjectSortRank(member: ProjectMemberRecord): number {
  if (member.role === "owner") return 0;
  if (member.subjectType === "account" && member.role === "observer") return 1;
 if (member.subjectType === "account" && member.role === "deriver") return 2;
  if (member.subjectType === "client"&& member.role === "observer") return 3;
  if(member.subjectType === "client" && member.role === "deriver") return 4;
  return 5;
}

function legacyAccountActor(actorAccountId: string): ProjectActorInput {
  return {
    actorType: "account",
    actorAccountId,
    actorClientId: null,
  };
}
