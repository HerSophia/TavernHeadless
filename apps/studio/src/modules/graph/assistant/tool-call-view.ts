/**
 * 图助手工具调用卡片的展示纯逻辑（工具卡片样式阶段）。
 *
 * 把流式期间的 `TempStreamToolEvent` 转成 `ToolCallView` 视图模型：归一化状态种类、
 * 类别、危险标记、耗时与参数摘要，供 `ToolCallCard.vue` 纯展示。无 i18n 与 DOM 依赖，
 * 便于单测。复用既有纯函数：参数摘要、工具短名、类别归类、危险工具判定。
 *
 * 数据边界：后端不返回工具结果正文，因此这里只装配参数 + 状态 + 耗时 + message，
 * 不涉及结果内容。历史 transcript 无工具明细，本视图仅服务流式期间的进行中楼层。
 */
import { summarizeToolArgs, type ToolArgSummary } from "./pending-tool-call-view";
import { categorizeTool, isDangerTool, shortToolName, type ToolCategory } from "./tool-policy-grouping";

import type { FloorToolStep } from "@tavern/client-helpers";

import type { TempStreamToolEvent } from "../../../lib/temp-conversation";

/** 把多种 phase 收敛成有限的视觉种类，驱动卡片的图标与颜色。 */
export type ToolCallStatusKind = "running" | "success" | "error" | "blocked" | "pending";

export interface ToolCallView {
  /** 一次执行的稳定标识（executionId）。 */
  key: string;
  /**归一化后的视觉状态种类。 */
  statusKind: ToolCallStatusKind;
  /** 原始 phase，供调用方按 i18n 取阶段文案。 */
  phase: string;
  /** 工具类别（读取 / 草稿 /提案 / 新建图 / 其他）。 */
  category: ToolCategory;
  /** 去掉 `nodegraph.` 前缀的工具短名。 */
  shortName: string;
  /** 是否为 live 持久写「危险」工具或不可逆副作用。 */
  danger: boolean;
  /** 耗时（毫秒）；进行中（running）置 null。 */
  durationMs: number | null;
  /** 是否进行中，便于模板判断默认展开与隐藏耗时。 */
  running: boolean;
  /** 是否已收到参数，进行中提示「已收到参数」用。 */
  hasArgs: boolean;
  /** 附带消息（失败原因等），去空白后为空则置 null。 */
  message: string | null;
  /** 参数键值摘要（复用既有摘要逻辑）。 */
  argsSummary: ToolArgSummary;
}

/**
 * phase → 视觉状态种类映射。
 *
 * - `start` → running
 * - `success` → success
 * - `error` / `timeout` / `uncertain` → error
 * - `denied` / `blocked` → blocked
 * - `awaiting_confirmation` → pending
 * - 其余未知 phase 兜底为 pending（不抛错）。
 */
export function phaseToStatusKind(phase: string): ToolCallStatusKind {
  switch (phase) {
    case "start":
      return "running";
    case "success":
      return "success";
    case "error":
  case "timeout":
    case "uncertain":
      return "error";
    case "denied":
    case "blocked":
      return "blocked";
    case "awaiting_confirmation":
      return "pending";
    default:
      return "pending";
  }
}

/**
 * 工具执行 status → 视觉状态种类映射（历史step 用，区别于流式的 phase）。
 *
 * tool_execution_record 的 status 取值：running / queued / success / error /
 * denied / timeout / uncertain / blocked。语义与 phase 映射对齐：
 * - `success` → success
 * - `error` / `timeout` / `uncertain` → error
 * - `denied` / `blocked` → blocked
 * - `running` → running
 * - `queued` 及其余 → pending
 */
export function statusToStatusKind(status: string): ToolCallStatusKind {
  switch (status) {
    case "success":
      return "success";
    case "error":
    case "timeout":
  case "uncertain":
      return "error";
    case "denied":
    case "blocked":
      return "blocked";
    case "running":
      return "running";
   default:
      return "pending";
  }
}

/**
 * 把历史楼层的工具步（FloorStep 工具步）装配成展示视图模型。
 *
 * 与 {@link buildToolCallView} 同构，但数据来自落库的 tool_execution_record
 * （经 client-helpers 归并），用 status 而非 phase 推导视觉状态；结果正文不在卡片展示，
 * 因此只取参数 + 状态 + 耗时 + 错误消息，与流式卡片保持一致的信息密度。
 */
export function buildToolCallViewFromStep(step: FloorToolStep): ToolCallView {
  const statusKind = statusToStatusKind(step.status);
  const running = statusKind === "running";
  const danger = isDangerTool(step.toolName) || step.sideEffectLevel === "irreversible";
  const args =
    step.args && typeof step.args === "object" && !Array.isArray(step.args)
      ? (step.args as Record<string, unknown>)
      : null;
  const hasArgs = Boolean(args && Object.keys(args).length > 0);
  const message = step.errorMessage?.trim() ? step.errorMessage.trim() : null;
  return {
    key: step.executionId,
    statusKind,
    phase: step.status,
    category: categorizeTool(step.toolName),
    shortName: shortToolName(step.toolName),
    danger,
    durationMs: running ? null : step.durationMs ?? null,
    running,
    hasArgs,
    message,
    argsSummary: summarizeToolArgs(args),
  };
}

/** 把单个工具事件装配成展示视图模型。 */
export function buildToolCallView(event:TempStreamToolEvent): ToolCallView {
  const statusKind = phaseToStatusKind(event.phase);
  const running = statusKind === "running";
  const danger = isDangerTool(event.toolName) || event.sideEffectLevel === "irreversible";
  const hasArgs = Boolean(event.args && typeof event.args === "object" && Object.keys(event.args).length > 0);
  const message = event.message?.trim() ? event.message.trim() : null;
return {
    key: event.executionId,
    statusKind,
    phase: event.phase,
    category:categorizeTool(event.toolName),
    shortName: shortToolName(event.toolName),
    danger,
    durationMs: running ? null : event.durationMs ?? null,
    running,
    hasArgs,
    message,
    argsSummary: summarizeToolArgs(event.args),
  };
}

/**
 * 分组头的聚合状态：优先级 error > running > blocked > pending > success。
 * 空数组兜底为 success。
 */
export function aggregateToolCallStatus(views: readonly ToolCallView[]): ToolCallStatusKind {
  if (views.length === 0) {
    return "success";
  }
  const kinds = new Set(views.map((view) => view.statusKind));
  if (kinds.has("error")) {
    return "error";
  }
  if (kinds.has("running")) {
    return "running";
  }
  if (kinds.has("blocked")) {
    return "blocked";
  }
  if (kinds.has("pending")) {
    return "pending";
  }
  return "success";
}
