/**
 * Chat History Loader
 *
 * 负责从数据库加载聊天历史消息，包括分支合并与楼层范围选择。
 * 从 ChatService 提取以降低单文件认知负荷。
 */

import { eq, and, desc, inArray, isNull } from "drizzle-orm";
import type { ChatMessage } from "@tavern/core";

import type { AppDb } from "../db/client.js";
import { floors, messagePages, messages } from "../db/schema.js";
import { FloorLineageService, type FloorLineageNode } from "./floor-lineage-service.js";

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

export interface PromptHistoryMessageEntry {
  floorId: string | null;
  floorNo: number | null;
  pageId: string | null;
  pageNo: number | null;
  messageId: string | null;
  seq: number;
  role: ChatMessage["role"];
  content: string;
  fromCurrentInput?: boolean;
}

export class ChatHistoryLoader {
  private readonly lineageService: FloorLineageService;

  constructor(
    private readonly db: AppDb,
    private readonly historyMaxFloors?: number,
    lineageService?: FloorLineageService,
  ) {
    this.lineageService = lineageService ?? new FloorLineageService(db);
  }

  async loadHistory(
    sessionId: string,
    branchId = "main",
    beforeFloorNo?: number,
    visibility?: PromptVisibilityPolicy,
  ): Promise<ChatMessage[]> {
    const historyEntries = await this.loadHistoryEntries(sessionId, branchId, beforeFloorNo, visibility);
    return historyEntries.map((entry) => ({ role: entry.role, content: entry.content }));
  }

  async loadHistoryEntries(
    sessionId: string,
    branchId = "main",
    beforeFloorNo?: number,
    visibility?: PromptVisibilityPolicy,
  ): Promise<PromptHistoryMessageEntry[]> {
    const floorScope = await this.selectHistoryFloorScope(sessionId, branchId, beforeFloorNo, visibility);
    return this.loadHistoryEntriesFromFloorScope(floorScope);
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
    // ancestry 视角下，所有 branch 走同一套流程：按 ancestry 顺序（root → tip）拿到 floor。
    // `selectHistoryFloorRows` 已经返回正序列表，所以这里只需应用 visibility 过滤 + 按
    // historyMaxFloors 截断最近 N 个。
    const ancestryRows = await this.selectHistoryFloorRows(sessionId, branchId, beforeFloorNo);
    const visibleRows = applyPromptVisibilityPolicy(ancestryRows, visibility);
    const limitedRows =
      this.historyMaxFloors === undefined
        ? visibleRows
        : visibleRows.slice(-this.historyMaxFloors);

    return limitedRows.map((row) => ({ id: row.id, floorNo: row.floorNo }));
  }

  private async selectHistoryFloorRows(
    sessionId: string,
    branchId: string,
    beforeFloorNo?: number,
  ): Promise<Array<{ id: string; floorNo: number }>> {
    // 通过统一的 lineage service 取该 branch 的 ancestry floor id 列表，
    // 不再按 `floorNo` 合并 main / branch。ancestry 身份由 `parentFloorId` 链决定。
    //
    // 同时加载 supersede 索引，让 regenerate 后指向"被替代旧楼层"的 parent 链
    // 能正确穿透到更上层的祖先。
    const [nodes, supersedeIndex] = await Promise.all([
      this.lineageService.loadSessionNodes(sessionId),
      this.lineageService.loadSupersedeIndex(sessionId),
    ]);
    const ancestryIds = this.lineageService.resolveVisibleAncestryFloorIds(
      nodes,
      branchId,
      beforeFloorNo,
      supersedeIndex,
    );

    if (ancestryIds.length === 0) {
      return [];
    }

    // resolveVisibleAncestryFloorIds 返回 root → tip 顺序的 floor id 列表；
    // 这里保持同序输出 { id, floorNo } 投影，供 loadMessagesFromFloorScope 按
    // ancestry 顺序加载消息。
    const nodeById = new Map<string, FloorLineageNode>(nodes.map((node) => [node.id, node]));
    return ancestryIds
      .map((id) => nodeById.get(id))
      .filter((node): node is FloorLineageNode => node !== undefined)
      .map((node) => ({ id: node.id, floorNo: node.floorNo }));
  }

  private async loadHistoryEntriesFromFloorScope(
    floorScope: Array<{ id: string; floorNo: number }>
  ): Promise<PromptHistoryMessageEntry[]> {
    if (floorScope.length === 0) {
      return [];
    }

    const floorIds = floorScope.map((row) => row.id);
    const floorNoById = new Map(floorScope.map((row) => [row.id, row.floorNo]));

    const historyRows = await this.db
      .select({
        floorId: messagePages.floorId,
        pageId: messagePages.id,
        role: messages.role,
        content: messages.content,
        messageId: messages.id,
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

    return historyRows.map((row) => ({
      floorId: row.floorId,
      floorNo: floorNoById.get(row.floorId) ?? null,
      pageId: row.pageId,
      pageNo: row.pageNo,
      messageId: row.messageId,
      seq: row.seq,
      role: mapRole(row.role),
      content: row.content,
    }));
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
