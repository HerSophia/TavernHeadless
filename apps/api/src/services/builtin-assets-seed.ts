import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import type { STWorldBook, STWorldBookEntry } from "@tavern/adapters-sillytavern";

import { DEFAULT_ADMIN_ACCOUNT_ID } from "../accounts/constants.js";
import type { AppDb, DbExecutor } from "../db/client.js";
import { characters, characterVersions, worldbookEntries, worldbooks } from "../db/schema.js";
import type { SessionCharacterSnapshot } from "../lib/character-snapshot.js";
import {
  buildPersistedWorldbookGlobalSettings,
  buildWorldbookEntryInsertValues,
} from "../lib/worldbook-utils.js";
import { AssetVersionService } from "./asset-version-service.js";

/**
 * 内置资产（SC2-11）：批次四方案确认结论——
 * - 两张不可删除的内置角色卡 + 一本不可删除的内置世界书；
 * - 以 `source = "builtin"` 标记（复用现有列，无 schema 变更）；
 * - 仅在默认账户（单账户模式）幂等 seed；`workspaceId = null` 使其在任意工作区的资产库可见
 *   （角色/世界书列表 workspace 过滤都带 `isNull(workspaceId)` 兜底）。
 * - 幂等策略：按稳定 id 存在即跳过，不覆盖用户编辑（决策 D：内置资产可编辑、禁止删除）。
 */
export const BUILTIN_ASSET_SOURCE = "builtin";

/** 内置角色卡：TavernHeadless 助手（介绍项目）。 */
export const BUILTIN_CHARACTER_ASSISTANT_ID = "builtin-char-assistant";
/** 内置角色卡：资产管理助手（可用资产管理工具协助编辑资产）。 */
export const BUILTIN_CHARACTER_ASSET_MANAGER_ID = "builtin-char-asset-manager";
/** 内置世界书：TavernHeadless 指南（随「TavernHeadless 助手」使用）。 */
export const BUILTIN_WORLDBOOK_ID = "builtin-wb-tavernheadless";

/** 资产管理助手默认套用的工具预设 key（供 SC2-10 建会话默认绑定读取）。 */
export const BUILTIN_ASSET_MANAGER_TOOL_PRESET_KEY = "asset-management";

/** 构造一个填满默认值的世界书条目，seed 时只需给出关键字段。 */
function buildWorldbookEntry(input: {
  uid: number;
  comment: string;
  content: string;
  key?: string[];
  constant?: boolean;
}): STWorldBookEntry {
  return {
    uid: input.uid,
    key: input.key ?? [],
    keysecondary: [],
    selective: true,
    selectiveLogic: 0,
    constant: input.constant ?? false,
    content: input.content,
    comment: input.comment,
    position: 0,
    order: 100,
    depth: 4,
    role: 0,
    disable: false,
    scanDepth: null,
    caseSensitive: null,
    matchWholeWords: null,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: null,
    outletName: "",
    extra: {},
  };
}

/** 内置世界书内容（介绍性词条，常驻注入）。 */
function buildBuiltinWorldbook(): STWorldBook {
  return {
    name: "TavernHeadless 指南",
    scanDepth: 2,
    caseSensitive: false,
    matchWholeWords: false,
    recursive: false,
    maxRecursionSteps: 0,
    entries: [
      buildWorldbookEntry({
        uid: 0,
        comment: "TavernHeadless 简介",
        constant: true,
        content:
          "TavernHeadless 是一个以「资产 + 会话 + 节点图」为核心的对话创作平台：" +
          "在资产库中管理角色卡、世界书、预设与正则；在会话中与角色对话、回溯楼层、翻页重生；" +
          "用图助手（节点图）编排更复杂的多轮生成流程。",
      }),
      buildWorldbookEntry({
        uid: 1,
        comment: "资产库",
        key: ["资产", "资产库", "asset", "library"],
        content:
          "资产库按类型分为角色卡、预设、世界书、正则四类，支持导入 SillyTavern 资产、" +
          "编辑内容并保留版本历史。内置资产带「内置」标记，可编辑但不可删除。",
      }),
      buildWorldbookEntry({
        uid: 2,
        comment: "会话与楼层",
        key: ["会话", "楼层", "session", "floor"],
        content:
          "会话以「楼层」为单位组织对话，可对某一楼层原地重跑、分步重跑，或对某条消息编辑并重生；" +
          "同一楼层的多个生成版本可左右翻页切换。",
      }),
    ],
  };
}

/** 「TavernHeadless 助手」角色卡快照。 */
function buildAssistantSnapshot(): SessionCharacterSnapshot {
  return {
    name: "TavernHeadless 助手",
    description:
      "TavernHeadless 的内置向导助手，负责介绍平台的资产库、会话、图助手等功能，" +
      "并解答新用户的上手问题。",
    personality: "友好、耐心、条理清晰，乐于用简洁的语言解释平台功能。",
    scenario: "用户刚进入 TavernHeadless，需要了解平台能做什么、如何开始。",
    primaryGreeting:
      "你好，我是 TavernHeadless 助手 👋 我可以带你了解资产库、会话与图助手。" +
      "想先从哪一块开始？",
    systemPrompt:
      "你是 TavernHeadless 的内置向导助手。用清晰、友好的语气介绍平台功能，" +
      "在合适时引导用户去资产库导入/编辑资产、创建会话或使用图助手。",
    tags: ["builtin", "guide"],
    creator: "TavernHeadless",
    extensions: {
      tavernheadless: {
        builtin: true,
        builtinWorldbookId: BUILTIN_WORLDBOOK_ID,
      },
    },
    importedFormat: "v2",
  };
}

/** 「资产管理助手」角色卡快照。 */
function buildAssetManagerSnapshot(): SessionCharacterSnapshot {
  return {
    name: "资产管理助手",
    description:
      "可调用资产管理工具的助手，能协助用户在资产库中查询、创建与编辑角色卡、世界书、预设、正则等资产。",
    personality: "严谨、务实，操作前会说明意图，涉及写入/修改时先确认再执行。",
    scenario: "用户希望借助工具批量或精确地管理与编辑资产。",
    primaryGreeting:
      "我是资产管理助手，可以帮你查询和编辑资产库里的角色卡、世界书、预设与正则。" +
      "告诉我你想做什么吧。",
    systemPrompt:
      "你是资产管理助手，可使用资产管理工具（增删改查角色卡/世界书/预设/正则、文本编辑与检索）。" +
      "执行写入或修改类操作前，先向用户说明将要做的更改并取得确认。",
    tags: ["builtin", "asset-management"],
    creator: "TavernHeadless",
    extensions: {
      tavernheadless: {
        builtin: true,
        toolPresetKey: BUILTIN_ASSET_MANAGER_TOOL_PRESET_KEY,
      },
    },
    importedFormat: "v2",
  };
}

/** 幂等 upsert 一张内置角色卡（存在即跳过，不覆盖用户编辑）。 */
function ensureBuiltinCharacter(
  tx: DbExecutor,
  input: { id: string; snapshot: SessionCharacterSnapshot; now: number },
): void {
  const existing = tx
    .select({ id: characters.id })
    .from(characters)
    .where(eq(characters.id, input.id))
    .limit(1)
    .get();
  if (existing) {
    return;
  }

  const snapshotJson = JSON.stringify(input.snapshot);
  const contentHash = createHash("sha256").update(snapshotJson).digest("hex");

  tx.insert(characters)
    .values({
      id: input.id,
      name: input.snapshot.name,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: null,
      source: BUILTIN_ASSET_SOURCE,
      status: "active",
      deletedAt: null,
      revision: 0,
      latestVersionNo: 1,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();

  tx.insert(characterVersions)
    .values({
      id: nanoid(),
      characterId: input.id,
      versionNo: 1,
      dataJson: snapshotJson,
      contentHash,
      sourceArtifactJson: null,
      sourceArtifactFormat: null,
      sourceArtifactDigest: null,
      createdByOperationId: null,
      createdAt: input.now,
    })
    .run();
}

/** 幂等 upsert 内置世界书（存在即跳过）。 */
function ensureBuiltinWorldbook(
  tx: DbExecutor,
  input: { id: string; worldbook: STWorldBook; now: number },
): void {
  const existing = tx
    .select({ id: worldbooks.id })
    .from(worldbooks)
    .where(eq(worldbooks.id, input.id))
    .limit(1)
    .get();
  if (existing) {
    return;
  }

  tx.insert(worldbooks)
    .values({
      id: input.id,
      name: input.worldbook.name,
      source: BUILTIN_ASSET_SOURCE,
      accountId: DEFAULT_ADMIN_ACCOUNT_ID,
      workspaceId: null,
      dataJson: JSON.stringify(buildPersistedWorldbookGlobalSettings(input.worldbook)),
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .run();

  if (input.worldbook.entries.length > 0) {
    tx.insert(worldbookEntries)
      .values(
        input.worldbook.entries.map((entry, index) =>
          buildWorldbookEntryInsertValues(entry, {
            id: nanoid(),
            worldbookId: input.id,
            uid: entry.uid ?? index,
            createdAt: input.now,
            updatedAt: input.now,
          }),
        ),
      )
      .run();
  }

  // 与导入路径一致：为内置世界书建立初始不可变版本（versionNo 1）。
  new AssetVersionService(tx).createWorldbookVersion(input.id, {
    versionNo: 1,
    createdAt: input.now,
  });
}

/**
 * 幂等确保内置资产存在（默认账户）。在 `ensureDefaultAdminAccount` 之后于启动时调用。
 */
export async function ensureBuiltinAssets(db: AppDb, now: () => number = Date.now): Promise<void> {
  const timestamp = now();
  db.transaction((tx) => {
    ensureBuiltinCharacter(tx, {
      id: BUILTIN_CHARACTER_ASSISTANT_ID,
      snapshot: buildAssistantSnapshot(),
      now: timestamp,
    });
    ensureBuiltinCharacter(tx, {
      id: BUILTIN_CHARACTER_ASSET_MANAGER_ID,
      snapshot: buildAssetManagerSnapshot(),
      now: timestamp,
    });
    ensureBuiltinWorldbook(tx, {
      id: BUILTIN_WORLDBOOK_ID,
      worldbook: buildBuiltinWorldbook(),
      now: timestamp,
    });
  });
}
