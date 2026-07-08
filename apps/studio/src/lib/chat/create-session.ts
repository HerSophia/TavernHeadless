/**
 * 创建会话入参模型与纯映射函数（SC2-4）。
 *
 * 把 Studio 侧的「创建会话对话框」收集到的 `CreateSessionInput`（标题 + 四类资产选择
 * + promptMode / syncPolicy）映射为 `sessions.create` 的 `SessionsCreateOptions` 子集。
 * 逻辑抽为纯函数以便单测（无组件挂载测试环境）。
 *
 * 版本语义（对齐 SC2-3 `AssetSelection`）：
 * - 选了具体版本 → `sel.versionId` 存在 → 写对应 `*VersionId`（锁版本）。
 * - `version: null` / 无 `versionId`（跟随最新）→ **不写** versionId（绑定 profile 最新）。
 * - 资产为 null / undefined（未选）→ 不写该资产任何字段。
 * - 空输入 → 只含 `projectId`，等价于原「建空会话」，保证向后兼容。
 */
import type { SessionCharacterSyncPolicy, SessionPromptMode } from "@tavern/sdk";

import type { AssetSelection } from "../assets/types";

/** 创建会话对话框收集的入参（各资产可选、可留空）。 */
export interface CreateSessionInput {
  title?: string;
  character?: AssetSelection | null;
  preset?: AssetSelection | null;
  worldbook?: AssetSelection | null;
  regex?: AssetSelection | null;
  /** 角色卡同步策略（仅在选了角色卡时生效）。 */
  characterSyncPolicy?: SessionCharacterSyncPolicy;
  promptMode?: SessionPromptMode;
  /**
   * 会话级工具策略预设 key（SC2-10 / #b4-7b）。
   * 空 / null / 未选 → 不写入（沿用原有策略，见后端 provider 惰性接入）。
   */
  toolPresetKey?: string | null;
}

/**
 * `SessionsCreateOptions` 的可写子集（本对话框实际会设置的字段）。
 *
 * 结构与 SDK `SessionsCreateOptions` 兼容（string 可赋给其 `string | null` 字段），
 * 因此可直接展开传入 `apiClient.sessions.create`。刻意不含 graph / user / model（见设计非目标）。
 */
export interface CreateSessionOptions {
  projectId: string;
  title?: string;
  characterId?: string;
  characterVersionId?: string;
  characterSyncPolicy?: SessionCharacterSyncPolicy;
  presetId?: string;
  presetVersionId?: string;
  worldbookProfileId?: string;
  worldbookVersionId?: string;
  regexProfileId?: string;
  regexProfileVersionId?: string;
  promptMode?: SessionPromptMode;
  toolPresetKey?: string;
}

/**
 * 把 `CreateSessionInput` + `projectId` 映射为 `sessions.create` 的绑定字段（纯函数）。
 *
 * 空输入返回 `{ projectId }`（向后兼容原「建空会话」）。
 */
export function buildCreateSessionOptions(
  projectId: string,
  input?: CreateSessionInput,
): CreateSessionOptions {
  const options: CreateSessionOptions = { projectId };
  if (!input) {
    return options;
  }

  const title = input.title?.trim();
  if (title) {
    options.title = title;
  }

  if (input.character) {
    options.characterId = input.character.id;
    if (input.character.versionId) {
      options.characterVersionId = input.character.versionId;
    }
    // syncPolicy 仅在选了角色卡时才有意义。
    if (input.characterSyncPolicy) {
      options.characterSyncPolicy = input.characterSyncPolicy;
    }
  }

  if (input.preset) {
    options.presetId = input.preset.id;
    if (input.preset.versionId) {
      options.presetVersionId = input.preset.versionId;
    }
  }

  if (input.worldbook) {
    options.worldbookProfileId = input.worldbook.id;
    if (input.worldbook.versionId) {
      options.worldbookVersionId = input.worldbook.versionId;
    }
  }

  if (input.regex) {
    options.regexProfileId = input.regex.id;
    if (input.regex.versionId) {
      options.regexProfileVersionId = input.regex.versionId;
    }
  }

  if (input.promptMode) {
    options.promptMode = input.promptMode;
  }

  // 仅在显式选择了非空预设 key 时写入（null / "" / 未选 → 沿用原策略）。
  if (input.toolPresetKey) {
    options.toolPresetKey = input.toolPresetKey;
  }

  return options;
}
