/**
 * 角色卡编辑器薄 API（SC2-8 / 方向 4）。
 *
 * 封装结构化读（`characters.getDetail`）与整快照写（`characters.createVersion`，
 * 编辑 = 发一份完整新快照，带 `expectedRevision` 乐观锁）。沿用 `lib/assets/library`
 * 薄封装风格，业务映射在 `character-editor-model` 完成。
 */
import type { CharacterDetail, CharacterWriteVersion } from "@tavern/sdk";

import { apiClient } from "../sdk";

export const characterEditorApi = {
  /** 拉取角色卡详情（含 `revision` 乐观锁基线 + `latestVersion.snapshot`）。 */
  getDetail(characterId: string): Promise<CharacterDetail> {
    return apiClient.characters.getDetail({ characterId });
  },

  /** 保存为新版本（append-only），带 `expectedRevision` 乐观锁。 */
  saveVersion(
    characterId: string,
    snapshot: Record<string, unknown>,
    expectedRevision: number,
  ): Promise<CharacterWriteVersion> {
    return apiClient.characters.createVersion({ characterId, snapshot, expectedRevision });
  },
};
