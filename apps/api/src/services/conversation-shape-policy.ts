import { and, eq, inArray, isNull, lt, gt, desc, asc } from "drizzle-orm";

import type { AppDb, DbExecutor } from "../db/client.js";
import { floors, messagePages, messages } from "../db/schema.js";

type QueryExecutor = AppDb | DbExecutor;
type BoundaryRole = "user" | "assistant" | "system" | null;

export interface ConversationShapeMutationRejection {
  code: "invalid_conversation_shape";
  reason: "adjacent_assistant_floors";
  message: string;
  floorId: string;
  previousFloorId: string | null;
  nextFloorId: string | null;
}

export class ConversationShapePolicyError extends Error {
  constructor(public readonly rejection: ConversationShapeMutationRejection) {
    super(rejection.message);
    this.name = "ConversationShapePolicyError";
  }
}

export class ConversationShapePolicyService {
  constructor(private readonly db: QueryExecutor) {}

  getFloorMutationRejection(floorId: string): ConversationShapeMutationRejection | null {
    const currentFloor = this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        branchId: floors.branchId,
        floorNo: floors.floorNo,
      })
      .from(floors)
      .where(and(eq(floors.id, floorId), isNull(floors.supersededAt)))
      .limit(1)
      .all()[0];

    if (!currentFloor) {
      return null;
    }

    const previousFloor = this.db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, currentFloor.sessionId),
        eq(floors.branchId, currentFloor.branchId),
        isNull(floors.supersededAt),
        lt(floors.floorNo, currentFloor.floorNo),
      ))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1)
      .all()[0] ?? null;

    const nextFloor = this.db
      .select({ id: floors.id })
      .from(floors)
      .where(and(
        eq(floors.sessionId, currentFloor.sessionId),
        eq(floors.branchId, currentFloor.branchId),
        isNull(floors.supersededAt),
        gt(floors.floorNo, currentFloor.floorNo),
      ))
      .orderBy(asc(floors.floorNo), asc(floors.createdAt))
      .limit(1)
      .all()[0] ?? null;

    const boundaries = this.loadFloorBoundaries([
      currentFloor.id,
      ...(previousFloor ? [previousFloor.id] : []),
      ...(nextFloor ? [nextFloor.id] : []),
    ]);
    const currentBoundary = boundaries.get(currentFloor.id);
    const previousBoundary = previousFloor ? boundaries.get(previousFloor.id) : undefined;
    const nextBoundary = nextFloor ? boundaries.get(nextFloor.id) : undefined;

    if (previousBoundary?.endRole === "assistant" && currentBoundary?.startRole === "assistant") {
      return {
        code: "invalid_conversation_shape",
        reason: "adjacent_assistant_floors",
        message: "This write would create consecutive assistant floors in the active conversation shape.",
        floorId: currentFloor.id,
        previousFloorId: previousFloor?.id ?? null,
        nextFloorId: null,
      };
    }

    if (currentBoundary?.endRole === "assistant" && nextBoundary?.startRole === "assistant") {
      return {
        code: "invalid_conversation_shape",
        reason: "adjacent_assistant_floors",
        message: "This write would create consecutive assistant floors in the active conversation shape.",
        floorId: currentFloor.id,
        previousFloorId: null,
        nextFloorId: nextFloor?.id ?? null,
      };
    }

    return null;
  }

  assertFloorMutationAllowed(floorId: string): void {
    const rejection = this.getFloorMutationRejection(floorId);
    if (rejection) {
      throw new ConversationShapePolicyError(rejection);
    }
  }

  private loadFloorBoundaries(floorIds: string[]): Map<string, { startRole: BoundaryRole; endRole: BoundaryRole }> {
    const uniqueFloorIds = Array.from(new Set(floorIds));
    if (uniqueFloorIds.length === 0) {
      return new Map();
    }

    const rows = this.db
      .select({
        floorId: messagePages.floorId,
        pageNo: messagePages.pageNo,
        seq: messages.seq,
        role: messages.role,
      })
      .from(messagePages)
      .innerJoin(messages, and(eq(messages.pageId, messagePages.id), eq(messages.isHidden, false)))
      .where(and(
        inArray(messagePages.floorId, uniqueFloorIds),
        eq(messagePages.isActive, true),
      ))
      .all();

    rows.sort((left, right) => {
      const floorDelta = left.floorId.localeCompare(right.floorId);
      if (floorDelta !== 0) {
        return floorDelta;
      }

      const pageDelta = left.pageNo - right.pageNo;
      if (pageDelta !== 0) {
        return pageDelta;
      }

      return left.seq - right.seq;
    });

    const groupedRoles = new Map<string, BoundaryRole[]>();
    for (const row of rows) {
      const role = mapBoundaryRole(row.role);
      if (!role) {
        continue;
      }

      const bucket = groupedRoles.get(row.floorId) ?? [];
      bucket.push(role);
      groupedRoles.set(row.floorId, bucket);
    }

    return new Map(uniqueFloorIds.map((id) => {
      const roles = groupedRoles.get(id) ?? [];
      return [id, {
        startRole: roles[0] ?? null,
        endRole: roles[roles.length - 1] ?? null,
      }];
    }));
  }
}

function mapBoundaryRole(role: string): BoundaryRole {
  switch (role) {
    case "user":
      return "user";
    case "assistant":
    case "narrator":
      return "assistant";
    case "system":
      return "system";
    default:
      return null;
  }
}
