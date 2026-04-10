/**
 * Chat History Loader
 *
 * 负责从数据库加载聊天历史消息，包括分支合并与楼层范围选择。
 * 从 ChatService 提取以降低单文件认知负荷。
 */

import { asc, eq, and, desc, lt, inArray, isNull } from "drizzle-orm";
import type { ChatMessage } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { floors, messagePages, messages } from "../db/schema.js";

export interface FloorVisibilityRange {
  startFloorNo: number;
  endFloorNo: number;
}

export interface PromptVisibilityPolicy {
  hiddenFloorRanges?: FloorVisibilityRange[];
  visibleFloorRanges?: FloorVisibilityRange[];
  hiddenFloorIds?: string[];
  mode?: "allow_all_except_hidden" | "deny_all_except_visible";
}

export interface PromptVisibilityTrace {
  hiddenFloorRanges?: FloorVisibilityRange[];
  filteredFloorNos?: number[];
}

export class ChatHistoryLoader {
  constructor(
    private readonly db: AppDb,
    private readonly historyMaxFloors?: number
  ) {}

  async loadHistory(
    sessionId: string,
    branchId = "main",
    beforeFloorNo?: number,
    visibility?: PromptVisibilityPolicy,
  ): Promise<ChatMessage[]> {
    const floorScope = await this.selectHistoryFloorScope(sessionId, branchId, beforeFloorNo, visibility);
    return this.loadMessagesFromFloorScope(floorScope);
  }

  async loadHistoryBeforeFloor(
    sessionId: string,
    floorNo: number,
    branchId = "main",
    visibility?: PromptVisibilityPolicy,
  ): Promise<ChatMessage[]> {
    return this.loadHistory(sessionId, branchId, floorNo, visibility);
  }

  /**
   * 获取最后一个 committed 楼层（main 分支）。
   */
  async getLastCommittedFloor(sessionId: string) {
    const [row] = await this.db
      .select()
      .from(floors)
      .where(
        and(
          eq(floors.sessionId, sessionId),
          isNull(floors.supersededAt),
          eq(floors.state, "committed"),
          eq(floors.branchId, "main")
        )
      )
      .orderBy(desc(floors.floorNo))
      .limit(1);

    return row ?? null;
  }

  async getLatestFloorInBranch(
    sessionId: string,
    branchId: string,
    options?: { states?: Array<typeof floors.$inferSelect["state"]> },
  ) {
    const conditions = [
      eq(floors.sessionId, sessionId),
      eq(floors.branchId, branchId),
      isNull(floors.supersededAt),
    ];

    if (options?.states && options.states.length > 0) {
      conditions.push(inArray(floors.state, options.states));
    }

    const [lastFloor] = await this.db
      .select({
        id: floors.id,
        sessionId: floors.sessionId,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
        parentFloorId: floors.parentFloorId,
        state: floors.state,
      })
      .from(floors)
      .where(and(...conditions))
      .orderBy(desc(floors.floorNo), desc(floors.createdAt))
      .limit(1);

    return lastFloor ?? null;
  }

  async getLatestCommittedFloorInBranch(sessionId: string, branchId: string) {
    return this.getLatestFloorInBranch(sessionId, branchId, {
      states: ["committed"],
    });
  }

  async getLatestGeneratingFloorInBranch(sessionId: string, branchId: string) {
    return this.getLatestFloorInBranch(sessionId, branchId, {
      states: ["generating"],
    });
  }

  async previewVisibility(
    sessionId: string,
    branchId = "main",
    beforeFloorNo?: number,
    visibility?: PromptVisibilityPolicy,
  ): Promise<PromptVisibilityTrace> {
    const baseRows = await this.selectHistoryFloorRows(sessionId, branchId, beforeFloorNo);
    const visibleRows = applyPromptVisibilityPolicy(baseRows, visibility);
    const visibleFloorNos = new Set(visibleRows.map((row) => row.floorNo));
    const filteredFloorNos = baseRows
      .filter((row) => !visibleFloorNos.has(row.floorNo))
      .map((row) => row.floorNo);

    return {
      ...(visibility?.hiddenFloorRanges ? { hiddenFloorRanges: visibility.hiddenFloorRanges } : {}),
      filteredFloorNos,
    };
  }

  // ── 私有方法 ────────────────────────────────────────

  private async selectHistoryFloorScope(
    sessionId: string,
    branchId: string,
    beforeFloorNo?: number,
    visibility?: PromptVisibilityPolicy,
  ): Promise<Array<{ id: string; floorNo: number }>> {
    const mainOrMergedRows = await this.selectHistoryFloorRows(sessionId, branchId, beforeFloorNo);

    if (branchId === "main") {
      const mainRows = mainOrMergedRows;
      const visibleRows = applyPromptVisibilityPolicy(mainRows, visibility);
      const limitedRows =
        this.historyMaxFloors === undefined ? visibleRows : visibleRows.slice(0, this.historyMaxFloors);

      return limitedRows.reverse();
    }

    const mergedRows = mainOrMergedRows;
    const visibleRows = applyPromptVisibilityPolicy(mergedRows, visibility);
    const limitedRows =
      this.historyMaxFloors === undefined ? visibleRows : visibleRows.slice(-this.historyMaxFloors);

    return limitedRows.map((row) => ({ id: row.id, floorNo: row.floorNo }));
  }

  private async selectHistoryFloorRows(
    sessionId: string,
    branchId: string,
    beforeFloorNo?: number,
  ): Promise<Array<{ id: string; floorNo: number }>> {
    const baseConditions = [
      eq(floors.sessionId, sessionId),
      eq(floors.state, "committed"),
      isNull(floors.supersededAt),
    ];

    if (beforeFloorNo !== undefined) {
      baseConditions.push(lt(floors.floorNo, beforeFloorNo));
    }

    if (branchId === "main") {
      return this.db
        .select({ id: floors.id, floorNo: floors.floorNo })
        .from(floors)
        .where(and(...baseConditions, eq(floors.branchId, "main")))
        .orderBy(desc(floors.floorNo));
    }

    const branchRows = await this.db
      .select({
        id: floors.id,
        floorNo: floors.floorNo,
        branchId: floors.branchId,
      })
      .from(floors)
      .where(and(...baseConditions, inArray(floors.branchId, ["main", branchId])))
      .orderBy(asc(floors.floorNo), asc(floors.createdAt));

    const mergedByFloorNo = new Map<number, { id: string; floorNo: number; branchId: string }>();

    for (const row of branchRows) {
      const existing = mergedByFloorNo.get(row.floorNo);

      if (!existing) {
        mergedByFloorNo.set(row.floorNo, row);
        continue;
      }

      if (row.branchId === branchId && existing.branchId !== branchId) {
        mergedByFloorNo.set(row.floorNo, row);
      }
    }

    return Array.from(mergedByFloorNo.values()).sort((a, b) => a.floorNo - b.floorNo).map((row) => ({ id: row.id, floorNo: row.floorNo }));
  }

  private async loadMessagesFromFloorScope(
    floorScope: Array<{ id: string; floorNo: number }>
  ): Promise<ChatMessage[]> {
    if (floorScope.length === 0) {
      return [];
    }

    const floorIds = floorScope.map((row) => row.id);
    const floorNoById = new Map(floorScope.map((row) => [row.id, row.floorNo]));

    const historyRows = await this.db
      .select({
        floorId: messagePages.floorId,
        role: messages.role,
        content: messages.content,
        pageNo: messagePages.pageNo,
        seq: messages.seq,
      })
      .from(messagePages)
      .innerJoin(
        messages,
        and(eq(messages.pageId, messagePages.id), eq(messages.isHidden, false))
      )
      .where(and(inArray(messagePages.floorId, floorIds), eq(messagePages.isActive, true)));

    historyRows.sort((a, b) => {
      const floorDelta = (floorNoById.get(a.floorId) ?? 0) - (floorNoById.get(b.floorId) ?? 0);
      if (floorDelta !== 0) return floorDelta;
      const pageDelta = a.pageNo - b.pageNo;
      if (pageDelta !== 0) return pageDelta;
      return a.seq - b.seq;
    });

    return historyRows.map((row) => ({ role: mapRole(row.role), content: row.content }));
  }
}

// ── 工具函数 ──────────────────────────────────────────

function applyPromptVisibilityPolicy<T extends { id: string; floorNo: number }>(
  rows: T[],
  visibility?: PromptVisibilityPolicy,
): T[] {
  if (!visibility) {
    return rows;
  }

  const hiddenFloorIds = new Set(visibility.hiddenFloorIds ?? []);
  const mode = visibility.mode ?? "allow_all_except_hidden";

  return rows.filter((row) => {
    const inVisibleRanges = matchesFloorRanges(row.floorNo, visibility.visibleFloorRanges);
    const inHiddenRanges = matchesFloorRanges(row.floorNo, visibility.hiddenFloorRanges);
    const isHiddenById = hiddenFloorIds.has(row.id);

    if (mode === "deny_all_except_visible") {
      if (!inVisibleRanges) {
        return false;
      }
      return !inHiddenRanges && !isHiddenById;
    }

    if (isHiddenById || inHiddenRanges) {
      return false;
    }

    return true;
  });
}

function matchesFloorRanges(
  floorNo: number,
  ranges?: FloorVisibilityRange[],
): boolean {
  if (!ranges || ranges.length === 0) {
    return false;
  }

  return ranges.some((range) => floorNo >= range.startFloorNo && floorNo <= range.endFloorNo);
}

/**
 * 将 DB 的消息角色映射为 LLM ChatMessage 角色。
 * narrator → assistant, 其余保持。
 */
function mapRole(dbRole: string): ChatMessage["role"] {
  switch (dbRole) {
    case "user":
      return "user";
    case "assistant":
    case "narrator":
      return "assistant";
    case "system":
      return "system";
    default:
      return "user";
  }
}
