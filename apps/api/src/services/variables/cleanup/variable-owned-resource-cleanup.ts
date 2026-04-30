import { buildBranchVariableScopeId } from "@tavern/shared";
import { and, eq, inArray, like } from "drizzle-orm";

import type { DbExecutor } from "../../../db/client.js";
import { floors, messagePages, variables } from "../../../db/schema.js";

export function deleteVariablesForPages(
  tx: DbExecutor,
  accountId: string,
  pageIds: readonly string[],
): void {
  if (pageIds.length === 0) {
    return;
  }

  tx
    .delete(variables)
    .where(
      and(
        eq(variables.accountId, accountId),
        eq(variables.scope, "page"),
        inArray(variables.scopeId, Array.from(new Set(pageIds))),
      ),
    )
    .run();
}

export function deleteVariablesForFloor(
  tx: DbExecutor,
  input: {
    accountId: string;
    floorId: string;
  },
): void {
  const pageIds = listPageIdsForFloorIds(tx, [input.floorId]);
  deleteVariablesForPages(tx, input.accountId, pageIds);

  tx
    .delete(variables)
    .where(
      and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "floor"),
        eq(variables.scopeId, input.floorId),
      ),
    )
    .run();

}

export function deleteVariablesForBranch(
  tx: DbExecutor,
  input: {
    accountId: string;
    sessionId: string;
    branchId: string;
    floorIds?: readonly string[];
  },
): void {
  const floorIds = input.floorIds
    ? Array.from(new Set(input.floorIds))
    : tx
        .select({ id: floors.id })
        .from(floors)
        .where(
          and(
            eq(floors.sessionId, input.sessionId),
            eq(floors.branchId, input.branchId),
          ),
        )
        .all()
        .map((row) => row.id);

  const pageIds = listPageIdsForFloorIds(tx, floorIds);
  deleteVariablesForPages(tx, input.accountId, pageIds);

  if (floorIds.length > 0) {
    tx
      .delete(variables)
      .where(
        and(
          eq(variables.accountId, input.accountId),
          eq(variables.scope, "floor"),
          inArray(variables.scopeId, floorIds),
        ),
      )
      .run();
  }

  tx
    .delete(variables)
    .where(
      and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "branch"),
        eq(variables.scopeId, buildBranchVariableScopeId(input.sessionId, input.branchId)),
      ),
    )
    .run();
}

export function deleteVariablesForSession(
  tx: DbExecutor,
  input: {
    accountId: string;
    sessionId: string;
  },
): void {
  const floorIds = tx
    .select({ id: floors.id })
    .from(floors)
    .where(eq(floors.sessionId, input.sessionId))
    .all()
    .map((row) => row.id);

  const pageIds = listPageIdsForFloorIds(tx, floorIds);
  deleteVariablesForPages(tx, input.accountId, pageIds);

  if (floorIds.length > 0) {
    tx
      .delete(variables)
      .where(
        and(
          eq(variables.accountId, input.accountId),
          eq(variables.scope, "floor"),
          inArray(variables.scopeId, floorIds),
        ),
      )
      .run();
  }

  tx
    .delete(variables)
    .where(
      and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "chat"),
        eq(variables.scopeId, input.sessionId),
      ),
    )
    .run();

  tx
    .delete(variables)
    .where(
      and(
        eq(variables.accountId, input.accountId),
        eq(variables.scope, "branch"),
        like(variables.scopeId, buildBranchScopeSessionPrefix(input.sessionId)),
      ),
    )
    .run();
}

function listPageIdsForFloorIds(tx: DbExecutor, floorIds: readonly string[]): string[] {
  if (floorIds.length === 0) {
    return [];
  }

  return tx
    .select({ id: messagePages.id })
    .from(messagePages)
    .where(inArray(messagePages.floorId, Array.from(new Set(floorIds))))
    .all()
    .map((row) => row.id);
}

function buildBranchScopeSessionPrefix(sessionId: string): string {
  return `branch:${encodeURIComponent(sessionId)}:%`;
}
