import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { toolPolicyPresets } from "../db/schema.js";
import {
  TOOL_CATALOG,
  TOOL_CATALOG_NAMES,
  RESOURCE_TOOL_NAMES,
  type ToolCatalogEntry,
  type ToolCategory,
} from "./tool-catalog.js";
import { TODO_TOOL_NAMES } from "../tools/todo-tool-catalog.js";

/** 逐工具策略：自动执行或需要确认。 */
export type ToolPolicyDecision = "auto" | "confirm";

/** 预设种类：内置（代码定义默认值 + 可覆盖）/ 自定义（用户创建）。 */
export type ToolPolicyPresetKind = "builtin" | "custom";

/**
 * 预设配置（持久于 `tool_policy_preset.config_json`）。
 *
 * - `enabledTools`：本预设**暴露给 LLM** 的工具名集合（其余工具不启用）。
 * - `decisions`：逐工具 auto/confirm 覆盖；缺省者由目录 sideEffectLevel 推导默认值。
 * - `maxCallsPerTurn` / `allowIrreversible`：可选的会话级上限，供会话解析层叠加使用。
 */
export interface ToolPolicyPresetConfig {
  enabledTools: string[];
  decisions: Record<string, ToolPolicyDecision>;
  maxCallsPerTurn?: number;
  allowIrreversible?: boolean;
}

/** 内置预设定义（默认值在代码中，是内置预设的唯一事实源）。 */
export interface BuiltinToolPolicyPresetDefinition {
  presetKey: string;
  /** 稳定默认展示名；前端可按 presetKey 做 i18n 覆盖。 */
  displayName: string;
  description: string;
  baseline: ToolPolicyPresetConfig;
}

/** 单个工具在某预设下的 effective 策略（默认值 ⊕ 覆盖）。 */
export interface EffectiveToolPolicy {
  toolName: string;
  category: ToolCategory;
  sideEffectLevel: ToolCatalogEntry["sideEffectLevel"];
  description: string;
  enabled: boolean;
  defaultDecision: ToolPolicyDecision;
  decision: ToolPolicyDecision;
  /** 决策来自显式覆盖还是默认值。 */
  source: "default" | "override";
}

/** 预设概要（列表用）。 */
export interface ToolPolicyPresetSummary {
  presetKey: string;
  kind: ToolPolicyPresetKind;
  displayName: string;
  /** 内置预设是否被用户覆盖过（存在 override 行）。 */
  customized: boolean;
  enabledCount: number;
  autoCount: number;
  confirmCount: number;
}

/** 预设明细（含逐工具 effective 策略）。 */
export interface ToolPolicyPresetDetail extends ToolPolicyPresetSummary {
  config: ToolPolicyPresetConfig;
  tools: EffectiveToolPolicy[];
}

/** 供会话解析层（#b4-5）使用的预设 overlay（以工具名表达）。 */
export interface ToolPolicyPresetOverlay {
  presetKey: string;
  enabledToolNames: string[];
  autoToolNames: string[];
  confirmToolNames: string[];
  allowIrreversible: boolean;
  maxCallsPerTurn?: number;
}

/** 预设作用域（项目级，决策 A）。 */
export interface ToolPolicyPresetScope {
  workspaceId: string;
  projectId: string;
  accountId: string;
}

export type ToolPolicyPresetServiceErrorCode =
  | "unknown_tool"
  | "invalid_decision"
  | "unknown_preset"
  | "builtin_preset_immutable"
  | "preset_key_conflict"
  | "invalid_preset_key"
  | "cannot_reset_custom";

export class ToolPolicyPresetServiceError extends Error {
  constructor(
    public readonly statusCode: 400 | 404 | 409,
    public readonly code: ToolPolicyPresetServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolPolicyPresetServiceError";
  }
}

/** 内置预设 key 常量。 */
export const REGULAR_CHAT_PRESET_KEY = "regular-chat";
export const ASSET_MANAGEMENT_PRESET_KEY = "asset-management";

/**
 * 内置预设定义（代码即事实源）。
 *
 * - `regular-chat`：不启用任何工具，确保普通角色扮演会话不被工具打扰。
 * - `asset-management`：启用全部资产管理工具 + TODO 工具；写工具默认 confirm、只读默认 auto
 *   （由 `deriveDefaultToolDecision` 推导，无需在此逐条列出），允许不可逆写。
 */
export const BUILTIN_TOOL_POLICY_PRESETS: BuiltinToolPolicyPresetDefinition[] = [
  {
    presetKey: REGULAR_CHAT_PRESET_KEY,
    displayName: "Regular chat",
    description: "For ordinary role-play chats; no resource or task tools are exposed.",
    baseline: {
      enabledTools: [],
      decisions: {},
      allowIrreversible: false,
    },
  },
  {
    presetKey: ASSET_MANAGEMENT_PRESET_KEY,
    displayName: "Asset management",
    description:
      "For the asset-management assistant; exposes resource CRUD tools and the to-do list. Write tools require confirmation by default.",
    baseline: {
      enabledTools: [...RESOURCE_TOOL_NAMES, ...TODO_TOOL_NAMES],
      decisions: {},
      allowIrreversible: true,
    },
  },
];

const BUILTIN_PRESET_BY_KEY = new Map(
  BUILTIN_TOOL_POLICY_PRESETS.map((preset) => [preset.presetKey, preset]),
);

/**
 * 由目录条目推导默认决策（纯函数，复用图助手思路）。
 *
 * - `irreversible`（写工具）→ `confirm`。
 * - 其余（`none` 只读 / `sandbox` 沙盒可逆）→ `auto`。
 */
export function deriveDefaultToolDecision(entry: ToolCatalogEntry): ToolPolicyDecision {
  return entry.sideEffectLevel === "irreversible" ? "confirm" : "auto";
}

const PRESET_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 解析并规整持久化的 configJson（丢弃未知工具名 / 非法决策）。 */
function normalizeConfig(value: unknown): ToolPolicyPresetConfig {
  const raw = isRecord(value) ? value : {};

  const enabledTools: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.enabledTools)) {
    for (const item of raw.enabledTools) {
      if (typeof item === "string" && TOOL_CATALOG_NAMES.has(item) && !seen.has(item)) {
        seen.add(item);
        enabledTools.push(item);
      }
    }
  }

  const decisions: Record<string, ToolPolicyDecision> = {};
  if (isRecord(raw.decisions)) {
    for (const [key, decision] of Object.entries(raw.decisions)) {
      if (TOOL_CATALOG_NAMES.has(key) && (decision === "auto" || decision === "confirm")) {
        decisions[key] = decision;
      }
    }
  }

  const config: ToolPolicyPresetConfig = { enabledTools, decisions };

  if (typeof raw.maxCallsPerTurn === "number" && Number.isFinite(raw.maxCallsPerTurn) && raw.maxCallsPerTurn > 0) {
    config.maxCallsPerTurn = Math.floor(raw.maxCallsPerTurn);
  }
  if (typeof raw.allowIrreversible === "boolean") {
    config.allowIrreversible = raw.allowIrreversible;
  }

  return config;
}

/** 校验外部传入的配置（严格：未知工具名 / 非法决策直接拒绝）。 */
function validateConfigStrict(input: unknown): ToolPolicyPresetConfig {
  const raw = isRecord(input) ? input : {};

  const enabledTools: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.enabledTools)) {
    for (const item of raw.enabledTools) {
      if (typeof item !== "string" || !TOOL_CATALOG_NAMES.has(item)) {
        throw new ToolPolicyPresetServiceError(
          400,
          "unknown_tool",
          `Unknown tool '${String(item)}' in enabledTools.`,
        );
      }
      if (!seen.has(item)) {
        seen.add(item);
        enabledTools.push(item);
      }
    }
  }

  const decisions: Record<string, ToolPolicyDecision> = {};
  if (isRecord(raw.decisions)) {
    for (const [key, decision] of Object.entries(raw.decisions)) {
      if (!TOOL_CATALOG_NAMES.has(key)) {
        throw new ToolPolicyPresetServiceError(
          400,
          "unknown_tool",
          `Unknown tool '${key}' in decisions.`,
        );
      }
      if (decision !== "auto" && decision !== "confirm") {
        throw new ToolPolicyPresetServiceError(
          400,
          "invalid_decision",
          `Invalid decision '${String(decision)}' for tool '${key}'.`,
        );
      }
      decisions[key] = decision;
    }
  }

  const config: ToolPolicyPresetConfig = { enabledTools, decisions };
  if (raw.maxCallsPerTurn !== undefined) {
    if (typeof raw.maxCallsPerTurn !== "number" || !Number.isFinite(raw.maxCallsPerTurn) || raw.maxCallsPerTurn <= 0) {
      throw new ToolPolicyPresetServiceError(400, "invalid_decision", "maxCallsPerTurn must be a positive number.");
    }
    config.maxCallsPerTurn = Math.floor(raw.maxCallsPerTurn);
  }
  if (raw.allowIrreversible !== undefined) {
    if (typeof raw.allowIrreversible !== "boolean") {
      throw new ToolPolicyPresetServiceError(400, "invalid_decision", "allowIrreversible must be a boolean.");
    }
    config.allowIrreversible = raw.allowIrreversible;
  }

  return config;
}

function parseStoredConfig(configJson: string): ToolPolicyPresetConfig {
  try {
    return normalizeConfig(JSON.parse(configJson));
  } catch {
    return { enabledTools: [], decisions: {} };
  }
}

/** 逐工具 effective 策略（对完整工具目录）。 */
function buildEffectiveTools(config: ToolPolicyPresetConfig): EffectiveToolPolicy[] {
  const enabled = new Set(config.enabledTools);
  return TOOL_CATALOG.map((entry) => {
    const defaultDecision = deriveDefaultToolDecision(entry);
    const override = config.decisions[entry.toolName];
    return {
      toolName: entry.toolName,
      category: entry.category,
      sideEffectLevel: entry.sideEffectLevel,
      description: entry.description,
      enabled: enabled.has(entry.toolName),
      defaultDecision,
      decision: override ?? defaultDecision,
      source: override ? "override" : "default",
    } satisfies EffectiveToolPolicy;
  });
}

function summarize(
  presetKey: string,
  kind: ToolPolicyPresetKind,
  displayName: string,
  customized: boolean,
  tools: EffectiveToolPolicy[],
): ToolPolicyPresetSummary {
  let enabledCount = 0;
  let autoCount = 0;
  let confirmCount = 0;
  for (const tool of tools) {
    if (!tool.enabled) {
      continue;
    }
    enabledCount += 1;
    if (tool.decision === "auto") {
      autoCount += 1;
    } else {
      confirmCount += 1;
    }
  }
  return { presetKey, kind, displayName, customized, enabledCount, autoCount, confirmCount };
}

type ToolPolicyPresetRow = typeof toolPolicyPresets.$inferSelect;

/**
 * 工具策略预设服务。
 *
 * 内置预设默认值来自代码（`BUILTIN_TOOL_POLICY_PRESETS`），无需 seed；DB 表仅存
 * 「内置预设覆盖」（kind=builtin）与「自定义预设」（kind=custom），项目级作用域。
 */
export class ToolPolicyPresetService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  /** 统一工具目录（供前端分组展示）。 */
  listToolCatalog(): ToolCatalogEntry[] {
    return TOOL_CATALOG.map((entry) => ({ ...entry }));
  }

  private loadRows(scope: ToolPolicyPresetScope): Map<string, ToolPolicyPresetRow> {
    const rows = this.db
      .select()
      .from(toolPolicyPresets)
      .where(eq(toolPolicyPresets.projectId, scope.projectId))
      .all();
    return new Map(rows.map((row) => [row.presetKey, row]));
  }

  private findRow(scope: ToolPolicyPresetScope, presetKey: string): ToolPolicyPresetRow | undefined {
    return this.db
      .select()
      .from(toolPolicyPresets)
      .where(and(
        eq(toolPolicyPresets.projectId, scope.projectId),
        eq(toolPolicyPresets.presetKey, presetKey),
      ))
      .limit(1)
      .all()[0];
  }

  /** 解析某预设的 effective 配置（内置 baseline ⊕ override 行；自定义读行）。 */
  private resolveConfigFromRow(
    presetKey: string,
    row: ToolPolicyPresetRow | undefined,
  ): { config: ToolPolicyPresetConfig; kind: ToolPolicyPresetKind; displayName: string; customized: boolean } {
    const builtin = BUILTIN_PRESET_BY_KEY.get(presetKey);
    if (builtin) {
      if (row) {
        return {
          config: parseStoredConfig(row.configJson),
          kind: "builtin",
          displayName: row.displayName || builtin.displayName,
          customized: true,
        };
      }
      return {
        config: {
          enabledTools: [...builtin.baseline.enabledTools],
          decisions: { ...builtin.baseline.decisions },
          ...(builtin.baseline.maxCallsPerTurn !== undefined ? { maxCallsPerTurn: builtin.baseline.maxCallsPerTurn } : {}),
          ...(builtin.baseline.allowIrreversible !== undefined ? { allowIrreversible: builtin.baseline.allowIrreversible } : {}),
        },
        kind: "builtin",
        displayName: builtin.displayName,
        customized: false,
      };
    }

    if (!row) {
      throw new ToolPolicyPresetServiceError(404, "unknown_preset", `Unknown tool policy preset '${presetKey}'.`);
    }

    return {
      config: parseStoredConfig(row.configJson),
      kind: "custom",
      displayName: row.displayName,
      customized: false,
    };
  }

  /** 列出某项目下的全部预设（内置 + 自定义）。 */
  listPresets(scope: ToolPolicyPresetScope): ToolPolicyPresetSummary[] {
    const rows = this.loadRows(scope);
    const summaries: ToolPolicyPresetSummary[] = [];

    for (const builtin of BUILTIN_TOOL_POLICY_PRESETS) {
      const resolved = this.resolveConfigFromRow(builtin.presetKey, rows.get(builtin.presetKey));
      summaries.push(
        summarize(builtin.presetKey, "builtin", resolved.displayName, resolved.customized, buildEffectiveTools(resolved.config)),
      );
    }

    for (const row of rows.values()) {
      if (row.kind !== "custom") {
        continue;
      }
      const config = parseStoredConfig(row.configJson);
      summaries.push(summarize(row.presetKey, "custom", row.displayName, false, buildEffectiveTools(config)));
    }

    return summaries;
  }

  /** 获取某预设的明细（逐工具 effective 策略）。 */
  getEffective(scope: ToolPolicyPresetScope, presetKey: string): ToolPolicyPresetDetail {
    const resolved = this.resolveConfigFromRow(presetKey, this.findRow(scope, presetKey));
    const tools = buildEffectiveTools(resolved.config);
    return {
      ...summarize(presetKey, resolved.kind, resolved.displayName, resolved.customized, tools),
      config: resolved.config,
      tools,
    };
  }

  /** 供会话解析层使用的 overlay（以工具名表达）。 */
  resolveOverlay(scope: ToolPolicyPresetScope, presetKey: string): ToolPolicyPresetOverlay {
    const detail = this.getEffective(scope, presetKey);
    const enabledToolNames: string[] = [];
    const autoToolNames: string[] = [];
    const confirmToolNames: string[] = [];
    for (const tool of detail.tools) {
      if (!tool.enabled) {
        continue;
      }
      enabledToolNames.push(tool.toolName);
      if (tool.decision === "auto") {
        autoToolNames.push(tool.toolName);
      } else {
        confirmToolNames.push(tool.toolName);
      }
    }
    return {
      presetKey,
      enabledToolNames,
      autoToolNames,
      confirmToolNames,
      allowIrreversible: detail.config.allowIrreversible ?? false,
      ...(detail.config.maxCallsPerTurn !== undefined ? { maxCallsPerTurn: detail.config.maxCallsPerTurn } : {}),
    };
  }

  /**
   * 更新某已存在预设（内置或自定义）的配置。
   *
   * 内置预设 → upsert override 行（kind=builtin）；自定义预设 → 更新其行。未知 key 拒绝。
   */
  upsertPreset(
    scope: ToolPolicyPresetScope,
    presetKey: string,
    input: unknown,
    now = Date.now(),
  ): ToolPolicyPresetDetail {
    const config = validateConfigStrict(input);
    const builtin = BUILTIN_PRESET_BY_KEY.get(presetKey);
    const existing = this.findRow(scope, presetKey);

    if (!builtin && !existing) {
      throw new ToolPolicyPresetServiceError(404, "unknown_preset", `Unknown tool policy preset '${presetKey}'.`);
    }

    const configJson = JSON.stringify(config);

    if (existing) {
      this.db
        .update(toolPolicyPresets)
        .set({ configJson, updatedAt: now })
        .where(eq(toolPolicyPresets.id, existing.id))
        .run();
    } else {
      this.db
        .insert(toolPolicyPresets)
        .values({
          id: `tpp_${nanoid(16)}`,
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          accountId: scope.accountId,
          presetKey,
          kind: "builtin",
          displayName: builtin?.displayName ?? "",
          configJson,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    return this.getEffective(scope, presetKey);
  }

  /**
   * 重置预设为默认值。
   *
   * 内置预设 → 删除 override 行（回到代码 baseline）；自定义预设无「默认值」可回退，拒绝。
   */
  resetPreset(scope: ToolPolicyPresetScope, presetKey: string): ToolPolicyPresetDetail {
    const builtin = BUILTIN_PRESET_BY_KEY.get(presetKey);
    if (!builtin) {
      const existing = this.findRow(scope, presetKey);
      if (!existing) {
        throw new ToolPolicyPresetServiceError(404, "unknown_preset", `Unknown tool policy preset '${presetKey}'.`);
      }
      throw new ToolPolicyPresetServiceError(
        400,
        "cannot_reset_custom",
        "Custom presets have no built-in default to reset to.",
      );
    }

    this.db
      .delete(toolPolicyPresets)
      .where(and(
        eq(toolPolicyPresets.projectId, scope.projectId),
        eq(toolPolicyPresets.presetKey, presetKey),
      ))
      .run();

    return this.getEffective(scope, presetKey);
  }

  /** 新建自定义预设。 */
  createCustomPreset(
    scope: ToolPolicyPresetScope,
    input: { presetKey: string; displayName: string; config?: unknown },
    now = Date.now(),
  ): ToolPolicyPresetDetail {
    const presetKey = input.presetKey.trim();
    if (!PRESET_KEY_PATTERN.test(presetKey)) {
      throw new ToolPolicyPresetServiceError(
        400,
        "invalid_preset_key",
        "Preset key must be 2-64 chars of lowercase letters, digits or dashes.",
      );
    }
    if (BUILTIN_PRESET_BY_KEY.has(presetKey)) {
      throw new ToolPolicyPresetServiceError(409, "preset_key_conflict", `Preset key '${presetKey}' is reserved.`);
    }
    if (this.findRow(scope, presetKey)) {
      throw new ToolPolicyPresetServiceError(409, "preset_key_conflict", `Preset '${presetKey}' already exists.`);
    }

    const config = validateConfigStrict(input.config ?? {});
    const displayName = input.displayName.trim() || presetKey;

    this.db
      .insert(toolPolicyPresets)
      .values({
        id: `tpp_${nanoid(16)}`,
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        accountId: scope.accountId,
        presetKey,
        kind: "custom",
        displayName,
        configJson: JSON.stringify(config),
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return this.getEffective(scope, presetKey);
  }

  /** 删除自定义预设（内置预设拒绝删除）。 */
  deleteCustomPreset(scope: ToolPolicyPresetScope, presetKey: string): void {
    if (BUILTIN_PRESET_BY_KEY.has(presetKey)) {
      throw new ToolPolicyPresetServiceError(
        409,
        "builtin_preset_immutable",
        "Built-in tool policy presets cannot be deleted.",
      );
    }
    const existing = this.findRow(scope, presetKey);
    if (!existing) {
      throw new ToolPolicyPresetServiceError(404, "unknown_preset", `Unknown tool policy preset '${presetKey}'.`);
    }
    this.db
      .delete(toolPolicyPresets)
      .where(eq(toolPolicyPresets.id, existing.id))
      .run();
  }
}
