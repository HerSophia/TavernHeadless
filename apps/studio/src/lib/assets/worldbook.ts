/**
 * 世界书编辑薄封装（SC2-6 / 方向 2）。
 *
 * 把世界书详情 / 条目 CRUD / 重排 / 书级改名归一为面向编辑器 store 的调用，走公共 `@tavern/sdk`
 * （`apiClient`，account 作用域）。输入类型复用 `worldbook-editor.ts` 的归一化输入（单一真源），
 * store 可通过 mock 本模块做纯单测。
 */
import type {
  WorldbookDetail,
  WorldbookEntriesBatchUpdateResult,
  WorldbookEntryRecord,
  WorldbookListItem,
} from "@tavern/sdk";

import { apiClient } from "../sdk";
import type { WorldbookEntryCreateInput, WorldbookEntryUpdateInput } from "./worldbook-editor";

/** 单本世界书一次性拉取的条目上限（编辑器内不做分页）。 */
const ENTRY_LIST_LIMIT = 200;

export const worldbookApi = {
  getDetail(worldbookId: string): Promise<WorldbookDetail> {
    return apiClient.worldbooks.getDetail({ worldbookId });
  },

  listEntries(worldbookId: string): Promise<WorldbookEntryRecord[]> {
    return apiClient.worldbookEntries.list({
      worldbookId,
      limit: ENTRY_LIST_LIMIT,
      offset: 0,
      sortBy: "order",
      sortOrder: "asc",
    });
  },

  createEntry(input: WorldbookEntryCreateInput, expectedVersion: number): Promise<WorldbookEntryRecord> {
    return apiClient.worldbookEntries.create({
      expectedVersion,
      worldbookId: input.worldbookId,
      content: input.content,
      keys: input.keys,
      keysSecondary: input.keysSecondary,
      comment: input.comment,
      position: input.position,
      role: input.role,
      depth: input.depth,
      order: input.order,
      selective: input.selective,
      selectiveLogic: input.selectiveLogic,
      constant: input.constant,
      disable: input.disable,
      scanDepth: input.scanDepth,
      caseSensitive: input.caseSensitive,
      matchWholeWords: input.matchWholeWords,
    });
  },

  updateEntry(input: WorldbookEntryUpdateInput, expectedVersion: number): Promise<WorldbookEntryRecord> {
    return apiClient.worldbookEntries.update({
      expectedVersion,
      worldbookId: input.worldbookId,
      entryId: input.entryId,
      content: input.content,
      keys: input.keys,
      keysSecondary: input.keysSecondary,
      comment: input.comment,
      position: input.position,
      role: input.role,
      depth: input.depth,
      order: input.order,
      selective: input.selective,
      selectiveLogic: input.selectiveLogic,
      constant: input.constant,
      disable: input.disable,
      scanDepth: input.scanDepth,
      caseSensitive: input.caseSensitive,
      matchWholeWords: input.matchWholeWords,
    });
  },

  async removeEntry(worldbookId: string, entryId: string, expectedVersion: number): Promise<void> {
    await apiClient.worldbookEntries.remove({ worldbookId, entryId, expectedVersion });
  },

  reorderEntries(
    worldbookId: string,
    items: Array<{ id: string; order: number }>,
    expectedVersion: number,
  ): Promise<WorldbookEntriesBatchUpdateResult> {
    return apiClient.worldbookEntries.batchReorder({ worldbookId, items, expectedVersion });
  },

  updateBook(
    worldbookId: string,
    name: string,
    data: Record<string, unknown>,
    expectedVersion: number,
  ): Promise<WorldbookListItem> {
    return apiClient.worldbooks.update({ worldbookId, name, data, expectedVersion });
  },
};
