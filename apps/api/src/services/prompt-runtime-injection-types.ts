export const PROMPT_RUNTIME_INJECTION_PLACEMENTS = [
  // I1 通用结构位置（18 个）
  "before_system_prompt",
  "after_system_prompt",
  "before_character",
  "after_character",
  "before_persona",
  "after_persona",
  "before_worldbook",
  "after_worldbook",
  "before_memory",
  "after_memory",
  "before_examples",
  "after_examples",
  "before_history",
  "after_history",
  "before_current_user_input",
  "after_current_user_input",
  "before_output_instruction",
  "before_assistant_prefill",
  // I3 楼层相对位置（4 个）
  "before_floor",
  "after_floor",
  "before_floor_from_end",
  "after_floor_from_end",
  // I3 世界书细分位置（4 个，compat_plus / native）
  "worldbook_depth",
  "worldbook_before",
  "worldbook_after",
  "worldbook_author_note_top",
  // I3 native 专属位置（2 个，仅 native）
  "before_contributor_block",
  "after_contributor_block",
] as const;

export type PromptRuntimeInjectionPlacement =
  typeof PROMPT_RUNTIME_INJECTION_PLACEMENTS[number];

export type PromptRuntimeInjectionPromptMode =
  | "compat_strict"
  | "compat_plus"
  | "native";

export type PromptRuntimeInjectionScope = "request" | "session" | "branch";

/**
 * I3 受控来源枚举。
 *
 * - `client_injection`：客户端请求体 / I2 持久资源，公开可声明。
 * - `agent_injection`：Agent Runtime 经 Agent 桥产生，内部来源。
 * - `debug_injection`：受权调试路径，按可见性裁剪 trace 内容。
 * - `system_override`：引擎内部，公共 schema 不可声明。
 */
export type PromptRuntimeInjectionSourceKind =
  | "client_injection"
  | "agent_injection"
  | "debug_injection"
  | "system_override";

export type PromptRuntimeInjectionNotAppliedReason =
  | "placement_not_available_in_mode"
  | "unknown_placement"
  | "empty_title_or_content"
  | "prompt_section_absent"
  | "disabled"
  | "expired"
  | "mode_scope_mismatch"
  | "scope_quota_exceeded"
  | "content_length_exceeded"
  | "content_token_limit_exceeded"
  | "total_token_limit_exceeded"
  // I3 楼层 / 参数相关
  | "missing_placement_params"
  | "invalid_placement_params"
  | "floor_no_out_of_history_window"
  | "floor_offset_out_of_history_window";

/**
 * I3 高级位置参数。
 *
 * 仅在需要参数的 placement 上有意义；字段全部为可选非负整数。
 * HTTP JSON 层使用 snake_case（floor_no / offset / depth），内部映射为camelCase。
 */
export interface PromptRuntimeInjectionPlacementParams {
  floorNo?: number;
  offset?: number;
  depth?: number;
}

/**
 * I3 锚点描述。
 *
 * resolver 把语义位置解析为锚点；客户端与调用方永不接触内部数字 order。
 * floor 锚点的 resolvedDepth 由装配前的楼层解析阶段回填（基于历史窗口）。
 */
export type PromptRuntimeInjectionAnchor =
  | { kind: "section"; internalKey: string }
  | { kind: "floor_by_no"; floorNo: number; edge: "before" | "after"; resolvedDepth?: number }
  | { kind: "floor_from_end"; offset: number; edge: "before" | "after" }
  | { kind: "worldbook_depth"; depth: number }
  | { kind: "worldbook_edge"; edge: "before" | "after" }
  | { kind: "worldbook_author_note_top" }
  | { kind: "contributor_block"; edge: "before" | "after" };

/**
 * I3 来源链。便于在 trace 中追踪一条 injection 从哪里来。
 */
export interface PromptRuntimeInjectionSourceChain {
  agentTypeId?: string;
  agentRunId?: string;
  temporaryConversationId?: string;
  debugSessionTag?: string;
}

export interface PromptRuntimeClientInjectionInput {
  sourceKind: "client_injection";
  title: string;
  content: string;
  placement: string;
  placementParams?: PromptRuntimeInjectionPlacementParams;
  order?: number;
  scope?: Extract<PromptRuntimeInjectionScope, "request">;
}

export interface PromptRuntimeInjectionBuilderInput {
  sourceKind: string;
  title: string;
  content: string;
  placement: string;
  placementParams?: PromptRuntimeInjectionPlacementParams;
  order?: number;
  scope?: PromptRuntimeInjectionScope;
  injectionId?: string;
  enabled?: boolean;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number | null;
  createdAt?: number;
  sourceChain?: PromptRuntimeInjectionSourceChain;
}

export interface PromptRuntimeInjectionPlacementResolverInput {
  placement: string;
  promptMode: PromptRuntimeInjectionPromptMode;
  placementParams?: PromptRuntimeInjectionPlacementParams;
}

export interface PromptRuntimeInjectionPlacementResolverOutput {
  resolved: boolean;
  reason?: Extract<
    PromptRuntimeInjectionNotAppliedReason,
    | "placement_not_available_in_mode"
    | "unknown_placement"
 | "missing_placement_params"
    | "invalid_placement_params"
  >;
  internalKey?: string;
  anchor?: PromptRuntimeInjectionAnchor;
}

export type PromptRuntimeInjectionVisibility =
  | "client"
  | "agent_private"
  | "debug"
  | "system";

export type PromptRuntimeInjectionBudgetStatus =
  | "within_budget"
  | "rejected_by_item_limit"
  | "rejected_by_total_limit";

export interface PromptRuntimeInjectionTraceItem {
  requestIndex: number;
  sourceKind: string;
  visibility: PromptRuntimeInjectionVisibility;
  injectionId?: string;
  enabled?: boolean;
  scope: PromptRuntimeInjectionScope;
  placementRequested: string;
  placementParamsRequested?: PromptRuntimeInjectionPlacementParams;
  orderRequested: number;
  title: string;
  contentLength: number;
  tokenCount?: number;
  budgetGroup?: string;
  budgetStatus?: PromptRuntimeInjectionBudgetStatus;
  applied: boolean;
  notAppliedReason?: PromptRuntimeInjectionNotAppliedReason;
  placementResolved?: string;
  anchorResolved?: PromptRuntimeInjectionAnchor;
  sourceChain?: PromptRuntimeInjectionSourceChain;
}

export interface PromptRuntimeInjectionTrace {
  items: PromptRuntimeInjectionTraceItem[];
  requestedCount?: number;
  appliedCount?: number;
  rejectedCount?: number;
  tokenCount?: number;
  budgetGroup?: string;
}

export interface PromptRuntimeAssemblyContributor {
  sourceKind: string;
  title: string;
  content: string;
  tokenCount?: number;
  budgetGroup?: string;
  internalPlacementKey?: string;
  requestIndex?: number;
  requestedPlacement?: string;
  requestedOrder?: number;
  scope?: PromptRuntimeInjectionScope;
  anchor?: PromptRuntimeInjectionAnchor;
  sourceChain?: PromptRuntimeInjectionSourceChain;
}

export interface PromptRuntimeInjectionBuildResult {
  renderables: PromptRuntimeAssemblyContributor[];
  items: PromptRuntimeInjectionTraceItem[];
  requestedCount?: number;
  appliedCount?: number;
  rejectedCount?: number;
  tokenCount?: number;
  budgetGroup?: string;
}
