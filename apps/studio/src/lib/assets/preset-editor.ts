/**
 * 预设编辑器薄 API（SC2-7 / 方向 3）。
 *
 * 封装结构化读（`presets.getEditor`）与整体写（`presets.update`，带 `expectedVersion` 乐观锁）。
 * 沿用 `lib/assets/library` 薄封装风格，业务映射在 `preset-editor-model` 完成。
 */
import type { PresetEditorDetail, PresetListItem } from "@tavern/sdk";

import { apiClient } from "../sdk";
import type { PresetUpdatePayload } from "./preset-editor-model";

export const presetEditorApi = {
  /** 拉取预设的结构化编辑模型（含当前 version，用作乐观锁基线）。 */
  getEditor(presetId: string): Promise<PresetEditorDetail> {
    return apiClient.presets.getEditor({ presetId });
  },

  /** 整体保存预设（whole-document PUT），带 `expectedVersion` 乐观锁。 */
  save(presetId: string, payload: PresetUpdatePayload, expectedVersion: number): Promise<PresetListItem> {
    return apiClient.presets.update({
      presetId,
      name: payload.name,
      editor: payload.editor,
      expectedVersion,
    });
  },
};
