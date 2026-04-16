/**
 * Prompt Runtime Source Resolution
 *
 * 执行前统一解析 source 准入状态。
 * 所有 live / dry-run / preview 路径在进入 assembler 前
 * 都应先消费这一层的解析结果。
 *
 * 本模块只做"解析+标记"，不做实际的 prompt 组装。
 */

import type { PromptSourceSelectionPolicy } from "./prompt-assembler.js";

// ─── 内部类型 ──────────────────────────────────────────────────

/**
 * 单个 source 的准入解析结果。
 */
export interface ResolvedSourceGateEntry {
  /** 是否允许进入真实组装 */
  enabled: boolean;
  /** 如果被禁用，原因说明 */
  reason?: "disabled_by_policy" | "not_available" | "default";
}

/**
 * 全部 source 的准入门控结果。
 */
export interface ResolvedPromptSourceGates {
  worldbook: ResolvedSourceGateEntry;
  examples: ResolvedSourceGateEntry;
  memory: ResolvedSourceGateEntry;
  history: ResolvedSourceGateEntry;
}

/**
 * 历史窗口解析结果。
 *
 * - `mode = "full"`：不做额外 message-window 截断。
 * - `mode = "windowed"`：进入 assemble 前先按 maxMessages 截断。
 */
export interface ResolvedHistoryWindow {
  mode: "full" | "windowed";
  /** windowed 模式下的截断消息数；full 模式下为 undefined */
  maxMessages?: number;
}

/**
 * 执行前 source 解析的完整结果，供 assembler 消费。
 */
export interface PromptSourceResolution {
  gates: ResolvedPromptSourceGates;
  historyWindow: ResolvedHistoryWindow;
}

// ─── 解析函数 ──────────────────────────────────────────────────

/**
 * 从 sourceSelection policy 解析全部 source 的准入状态和历史窗口。
 *
 * 如果 sourceSelection 为空或未提供，全部 source 默认 enabled。
 */
export function resolvePromptSourceGates(
  sourceSelection?: PromptSourceSelectionPolicy,
): PromptSourceResolution {
  const worldbookEnabled = sourceSelection?.worldbook?.enabled;
  const examplesEnabled = sourceSelection?.examples?.enabled;
  const memoryEnabled = sourceSelection?.memory?.enabled;
  const historyMode = sourceSelection?.history?.mode ?? "full";
  const maxMessages = sourceSelection?.history?.maxMessages;

  return {
    gates: {
      worldbook: resolveGateEntry(worldbookEnabled),
      examples: resolveGateEntry(examplesEnabled),
      memory: resolveGateEntry(memoryEnabled),
      history: { enabled: true, reason: "default" },
    },
    historyWindow: {
      mode: historyMode,
      maxMessages: historyMode === "windowed" && maxMessages != null && maxMessages > 0
        ? maxMessages
        : undefined,
    },
  };
}

function resolveGateEntry(
  enabled?: boolean,
): ResolvedSourceGateEntry {
  if (enabled === false) {
    return { enabled: false, reason: "disabled_by_policy" };
  }
  return { enabled: true, reason: "default" };
}

/**
 * 在 assembler 内部根据 source gate 截断 memorySummary。
 *
 * 如果 memory gate 为 disabled，返回 undefined。
 */
export function applyMemorySourceGate(
  memorySummary: string | undefined,
  gate: ResolvedSourceGateEntry,
): string | undefined {
  if (!gate.enabled) return undefined;
  return memorySummary;
}

/**
 * 在 assembler 内部根据 history window 截断 chatHistory。
 *
 * windowed 模式下，保留最近 maxMessages 条消息。
 * full 模式下，原样返回。
 */
export function applyHistoryWindow<T>(
  history: T[],
  window: ResolvedHistoryWindow,
): T[] {
  if (window.mode === "windowed" && window.maxMessages != null && history.length > window.maxMessages) {
    return history.slice(-window.maxMessages);
  }
  return history;
}
