import { and, desc, eq, isNull } from "drizzle-orm";

import type { AppDb } from "../../db/client.js";
import { floors } from "../../db/schema.js";
import { OwnedFloorRepository, OwnedMessageRepository } from "../owned-resource-repositories.js";
import { ChatHistoryLoader } from "../chat-history-loader.js";

import type {
  ChatServiceErrorFactory,
  EditableMessageTarget,
  RegenerationTargetFloor,
  ResolvedRespondBranchContext,
  RetryTargetFloor,
} from "./types.js";

export class ChatTargetResolver {
  constructor(
    private readonly db: AppDb,
    private readonly historyLoader: ChatHistoryLoader,
    private readonly createError: ChatServiceErrorFactory,
  ) {}

  async resolveRespondBranchContext(
    sessionId: string,
    branchId: string,
    sourceFloorId?: string,
  ): Promise<ResolvedRespondBranchContext> {
    const generatingFloorInBranch = await this.historyLoader.getLatestGeneratingFloorInBranch(sessionId, branchId);

    if (generatingFloorInBranch) {
      throw this.createError(
        "invalid_state",
        `Branch '${branchId}' already has a generating floor '${generatingFloorInBranch.id}'`,
      );
    }

    const lastFloorInBranch = await this.historyLoader.getLatestFloorInBranch(sessionId, branchId);
    const lastCommittedFloorInBranch = await this.historyLoader.getLatestCommittedFloorInBranch(sessionId, branchId);

    if (lastFloorInBranch) {
      return {
        branchExists: true,
        historySourceBranchId: branchId,
        historySourceMode: "existing_branch",
        nextFloorNo: lastFloorInBranch.floorNo + 1,
        parentFloorId: lastCommittedFloorInBranch?.id ?? lastFloorInBranch.parentFloorId ?? null,
      };
    }

    let sourceFloor: { id: string; floorNo: number; branchId: string } | null = null;

    if (sourceFloorId) {
      const [row] = await this.db
        .select({ id: floors.id, floorNo: floors.floorNo, branchId: floors.branchId })
        .from(floors)
        .where(
          and(
            eq(floors.id, sourceFloorId),
            eq(floors.sessionId, sessionId),
            eq(floors.state, "committed"),
            isNull(floors.supersededAt),
          ),
        )
        .limit(1);

      if (!row) {
        throw this.createError(
          "source_floor_not_found",
          `Source floor '${sourceFloorId}' was not found in session '${sessionId}'`,
        );
      }

      sourceFloor = row;
    } else {
      const [latestMainFloor] = await this.db
        .select({ id: floors.id, floorNo: floors.floorNo, branchId: floors.branchId })
        .from(floors)
        .where(
          and(
            eq(floors.sessionId, sessionId),
            eq(floors.state, "committed"),
            eq(floors.branchId, "main"),
            isNull(floors.supersededAt),
          ),
        )
        .orderBy(desc(floors.floorNo))
        .limit(1);

      sourceFloor = latestMainFloor ?? null;
    }

    return {
      branchExists: false,
      historySourceBranchId: sourceFloor?.branchId ?? "main",
      historySourceMode: sourceFloorId ? "source_floor_branch" : "main_fallback",
      nextFloorNo: (sourceFloor?.floorNo ?? -1) + 1,
      parentFloorId: sourceFloor?.id ?? null,
      ...(sourceFloor ? { inheritanceSource: { floorId: sourceFloor.id, branchId: sourceFloor.branchId } } : {}),
    };
  }

  async requireRegenerationTarget(sessionId: string): Promise<RegenerationTargetFloor> {
    const targetFloor = await this.historyLoader.getLatestCommittedFloorInBranch(sessionId, "main");
    if (!targetFloor) {
      throw this.createError("no_floor_to_regenerate", "No committed floor found to regenerate");
    }
    return targetFloor;
  }

  async revalidateRegenerationTarget(
    sessionId: string,
    expectedFloorId: string,
  ): Promise<RegenerationTargetFloor> {
    const targetFloor = await this.requireRegenerationTarget(sessionId);
    if (targetFloor.id !== expectedFloorId) {
      throw this.createError(
        "generation_target_stale",
        "Latest committed floor changed while the regenerate request was waiting to run",
      );
    }
    return targetFloor;
  }

  requireRetryTargetFloor(floorId: string, accountId: string): RetryTargetFloor {
    const targetFloor = new OwnedFloorRepository(this.db).getById(accountId, floorId);
    if (!targetFloor) {
      throw this.createError("floor_not_found", `Floor '${floorId}' not found`);
    }

    if (targetFloor.state !== "committed") {
      throw this.createError("invalid_state", `Floor '${floorId}' is not committed`);
    }

    return targetFloor;
  }

  async revalidateRetryTargetFloor(
    floorId: string,
    accountId: string,
    expected: Pick<RetryTargetFloor, "sessionId" | "floorNo" | "branchId" | "parentFloorId">,
  ): Promise<RetryTargetFloor> {
    const targetFloor = this.requireRetryTargetFloor(floorId, accountId);
    if (
      targetFloor.sessionId !== expected.sessionId
      || targetFloor.floorNo !== expected.floorNo
      || targetFloor.branchId !== expected.branchId
      || targetFloor.parentFloorId !== expected.parentFloorId
    ) {
      throw this.createError(
        "generation_target_stale",
        "Retry target changed while the request was waiting to run",
      );
    }

    return targetFloor;
  }

  resolveEditableMessage(messageId: string, accountId: string): EditableMessageTarget {
    const row = new OwnedMessageRepository(this.db).getContextById(accountId, messageId);

    if (!row) {
      throw this.createError("message_not_found", `Message '${messageId}' not found`);
    }

    if (row.role !== "user") {
      throw this.createError("invalid_message_role", "Only user messages can be edited");
    }

    if (row.pageKind !== "input" || !row.pageIsActive) {
      throw this.createError(
        "invalid_message_scope",
        "Target message must belong to an active input page",
      );
    }

    if (row.floorState !== "committed") {
      throw this.createError(
        "invalid_state",
        "Target message must belong to a committed floor",
      );
    }

    return {
      messageId: row.id,
      floorId: row.floorId,
      floorNo: row.floorNo,
      branchId: row.branchId,
      sessionId: row.sessionId,
    };
  }

  revalidateEditableMessageTarget(
    messageId: string,
    accountId: string,
    expected: Omit<EditableMessageTarget, "messageId">,
  ): EditableMessageTarget {
    const source = this.resolveEditableMessage(messageId, accountId);
    if (
      source.floorId !== expected.floorId
      || source.floorNo !== expected.floorNo
      || source.branchId !== expected.branchId
      || source.sessionId !== expected.sessionId
    ) {
      throw this.createError(
        "generation_target_stale",
        "Edit target changed while the request was waiting to run",
      );
    }
    return source;
  }
}
