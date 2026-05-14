import { eq } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, messagePages, sessions } from "../db/schema.js";

export type ProjectSourceScope = {
  sessionId: string | null;
  branchId: string | null;
  floorId: string | null;
  pageId: string | null;
};

export type ProjectSourceScopeErrorReason =
  | "session_not_found"
  | "floor_not_found"
  | "page_not_found"
  | "scope_mismatch";

export class ProjectSourceScopeError extends Error {
  constructor(
    public readonly reason: ProjectSourceScopeErrorReason,
    message: string,
  ) {
    super(message);
    this.name = "ProjectSourceScopeError";
  }
}

type ProjectSourceScopeInput = {
  projectId: string;
  sourceSessionId?: string | null;
  sourceFloorId?: string | null;
  sourcePageId?: string | null;
};

/**
 * Resolves optional Session / Floor / Page references and verifies that they all belong to the same Project.
 */
export function resolveProjectSourceScope(
  db: AppDb | DbExecutor,
  input: ProjectSourceScopeInput,
): ProjectSourceScope {
  const projectId = requireNonEmpty(input.projectId, "projectId");
  const explicitSessionId = normalizeNullableString(input.sourceSessionId);
  const explicitFloorId = normalizeNullableString(input.sourceFloorId);
  const explicitPageId = normalizeNullableString(input.sourcePageId);

  let resolvedSessionId: string | null = null;
  let resolvedFloorId: string | null = null;
  let resolvedPageId: string | null = null;
  let resolvedBranchId: string | null = null;
  let resolvedProjectId: string | null = null;

  if (explicitPageId) {
    const pageRow = db
      .select({
        pageId: messagePages.id,
        floorId: floors.id,
        sessionId: sessions.id,
        branchId: floors.branchId,
        projectId: sessions.projectId,
      })
      .from(messagePages)
      .innerJoin(floors, eq(messagePages.floorId, floors.id))
      .innerJoin(sessions, eq(floors.sessionId, sessions.id))
      .where(eq(messagePages.id, explicitPageId))
      .limit(1)
      .get();

    if (!pageRow) {
      throw new ProjectSourceScopeError("page_not_found", `Page not found: ${explicitPageId}`);
    }

    resolvedPageId = pageRow.pageId;
    resolvedFloorId = pageRow.floorId;
    resolvedSessionId = pageRow.sessionId;
    resolvedBranchId = pageRow.branchId;
    resolvedProjectId = pageRow.projectId;
  }

  if (explicitFloorId) {
    if (resolvedFloorId && resolvedFloorId !== explicitFloorId) {
      throw new ProjectSourceScopeError("scope_mismatch", "Source page does not belong to source floor");
    }

    if (!resolvedFloorId) {
      const floorRow = db
        .select({
          floorId: floors.id,
          sessionId: sessions.id,
          branchId: floors.branchId,
          projectId: sessions.projectId,
        })
        .from(floors)
        .innerJoin(sessions, eq(floors.sessionId, sessions.id))
        .where(eq(floors.id, explicitFloorId))
        .limit(1)
        .get();

      if (!floorRow) {
        throw new ProjectSourceScopeError("floor_not_found", `Floor not found: ${explicitFloorId}`);
      }

      resolvedFloorId = floorRow.floorId;
      resolvedSessionId = floorRow.sessionId;
      resolvedBranchId = floorRow.branchId;
      resolvedProjectId = floorRow.projectId;
    }
  }

  if (explicitSessionId) {
    if (resolvedSessionId && resolvedSessionId !== explicitSessionId) {
      throw new ProjectSourceScopeError("scope_mismatch", "Source floor or page does not belong to source session");
    }

    if (!resolvedSessionId) {
      const sessionRow = db
        .select({ id: sessions.id, projectId: sessions.projectId })
        .from(sessions)
        .where(eq(sessions.id, explicitSessionId))
        .limit(1)
        .get();

      if (!sessionRow) {
        throw new ProjectSourceScopeError("session_not_found", `Session not found: ${explicitSessionId}`);
      }

      resolvedSessionId = sessionRow.id;
      resolvedProjectId = sessionRow.projectId;
    }
  }

  if (resolvedProjectId !== null && resolvedProjectId !== projectId) {
    throw new ProjectSourceScopeError("scope_mismatch", "Source scope does not belong to the project");
  }

  return {
    sessionId: resolvedSessionId,
    branchId: resolvedBranchId,
    floorId: resolvedFloorId,
    pageId: resolvedPageId,
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
