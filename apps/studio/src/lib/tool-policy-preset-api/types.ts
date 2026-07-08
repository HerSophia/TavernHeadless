/**
 * 工具策略预设（Tool Policy Preset）第一方 API 类型（SC2-10 / #b4-7）。
 *
 * 预设 = 一组「哪些工具暴露给 LLM + 每个工具 auto/confirm」的命名集合，作用域为项目级。
 * 与后端 `apps/api/src/routes/tool-policy-presets.ts` 的 snake_case 契约对齐；
 * 这些路由属第一方接入面，不进 OpenAPI / @tavern/sdk 生成面。
 */

/** 单个工具的决策：自动执行或需要确认。 */
export type ToolPolicyDecision = "auto" | "confirm";

/** 工具副作用级别（与后端工具目录一致）。 */
export type ToolPolicySideEffectLevel = "none" | "sandbox" | "irreversible";

/** 工具目录分组（与后端 `services/tool-catalog.ts` 的 ToolCategory 一致）。 */
export type ToolPolicyCategory =
  | "character"
  | "worldbook"
  | "regex"
  | "preset"
  | "resource_text"
  | "nodegraph"
  | "todo";

/** 预设类型：内置（不可删除）或自定义。 */
export type ToolPolicyPresetKind = "builtin" | "custom";

/** 统一工具目录条目。 */
export interface ToolCatalogEntry {
  tool_name: string;
  category: ToolPolicyCategory;
  side_effect_level: ToolPolicySideEffectLevel;
  description: string;
}

/** 预设摘要（列表项）。 */
export interface ToolPolicyPresetSummary {
  preset_key: string;
  kind: ToolPolicyPresetKind;
  display_name: string;
  /** 内置预设是否已被项目覆盖（自定义预设恒为 true）。 */
  customized: boolean;
  enabled_count: number;
  auto_count: number;
  confirm_count: number;
}

/** 预设内单个工具的 effective 策略（默认值 + 覆盖合并后的结果）。 */
export interface ToolPolicyPresetToolItem {
  tool_name: string;
  category: ToolPolicyCategory;
  side_effect_level: ToolPolicySideEffectLevel;
  description: string;
  /** 是否启用（暴露给 LLM）。 */
  enabled: boolean;
  default_decision: ToolPolicyDecision;
  decision: ToolPolicyDecision;
  source: "default" | "override";
}

/** 预设配置（持久化形态）。 */
export interface ToolPolicyPresetConfig {
  enabled_tools: string[];
  decisions: Record<string, ToolPolicyDecision>;
  max_calls_per_turn?: number;
  allow_irreversible?: boolean;
}

/** 预设明细（摘要 + 配置 + 逐工具 effective 策略）。 */
export interface ToolPolicyPresetDetail extends ToolPolicyPresetSummary {
  config: ToolPolicyPresetConfig;
  tools: ToolPolicyPresetToolItem[];
}

/** 列表响应：统一工具目录 + 预设摘要列表。 */
export interface ToolPolicyPresetListResponse {
  tool_catalog: ToolCatalogEntry[];
  presets: ToolPolicyPresetSummary[];
}

/** 更新/新建预设的配置入参（全部可选，缺省字段交由后端校验/默认）。 */
export interface ToolPolicyPresetConfigInput {
  enabled_tools?: string[];
  decisions?: Record<string, ToolPolicyDecision>;
  max_calls_per_turn?: number;
  allow_irreversible?: boolean;
}

/** 新建自定义预设入参。 */
export interface ToolPolicyPresetCreateInput {
  preset_key: string;
  display_name: string;
  config?: ToolPolicyPresetConfigInput;
}
