/**
 * NG2-BRIDGE（批次 9 阶段 12-13）：native prompt 主链承载灰度与影子比对支撑。
 *
 * - 承载决策：`composite`（既有命令式 native 编排）或 `system_graph`（由 system graph 承载）。
 * - 灰度分层：Workspace 默认 → Project 启用 → Session override（沿用批次 8 effective config 分层）。
 * - 影子比对：并行运行两条承载路径并逐字段比对 prepared prompt，差异进入 trace，只比对不切流。
 * - 一键回退：把承载决策设回 `composite` 即回退，是配置级动作，不回滚代码。
 *
 * 仅 native prompt mode 消费本决策；compat_strict / compat_plus 永不进入 system graph 灰度。
 */
import type { TurnAssemblyResult } from "./turn-assembly-processor-types.js";

export type NativePromptCarrier = "composite" | "system_graph";

export const NATIVE_PROMPT_CARRIERS = ["composite", "system_graph"] as const satisfies readonly NativePromptCarrier[];

export interface NativePromptBridgeDecision {
  carrier: NativePromptCarrier;
  /** 影子运行：并行跑另一条承载路径并比对，差异进入 trace，不切流。 */
  shadow: boolean;
}

/** 默认承载：命令式 composite，影子关闭 —— 与 NG2-BRIDGE 前的行为完全一致。 */
export const DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION: NativePromptBridgeDecision = {
  carrier: "composite",
  shadow: false,
};

/** 灰度分层输入：每层可只声明部分字段，后层覆盖前层。 */
export interface NativePromptBridgeLayers {
  workspace?: Partial<NativePromptBridgeDecision>;
  project?: Partial<NativePromptBridgeDecision>;
  session?: Partial<NativePromptBridgeDecision>;
}

function isNativePromptCarrier(value: unknown): value is NativePromptCarrier {
  return value === "composite" || value === "system_graph";
}

/**
 * 分层解析承载决策：Workspace 默认 → Project → Session，后层覆盖前层。
 *
 * 任一层缺省字段沿用前层；全缺省退化为 `DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION`。
 */
export function resolveNativePromptBridgeDecision(layers: NativePromptBridgeLayers): NativePromptBridgeDecision {
  let decision: NativePromptBridgeDecision = { ...DEFAULT_NATIVE_PROMPT_BRIDGE_DECISION };
  for (const layer of [layers.workspace, layers.project, layers.session]) {
    if (!layer) {
      continue;
    }
    if (isNativePromptCarrier(layer.carrier)) {
      decision = { ...decision, carrier: layer.carrier };
    }
    if (typeof layer.shadow === "boolean") {
      decision = { ...decision, shadow: layer.shadow };
    }
  }
  return decision;
}

/** 从环境变量读取 Workspace 默认承载（一键回退的最外层开关）。 */
export function readNativePromptBridgeWorkspaceDefault(
  env: NodeJS.ProcessEnv = process.env,
): Partial<NativePromptBridgeDecision> {
  const layer: Partial<NativePromptBridgeDecision> = {};
  const carrier = env.NATIVE_PROMPT_SYSTEM_GRAPH_CARRIER;
  if (isNativePromptCarrier(carrier)) {
    layer.carrier = carrier;
  }
  const shadow = env.NATIVE_PROMPT_SYSTEM_GRAPH_SHADOW;
  if (shadow !== undefined) {
    layer.shadow = shadow === "true" || shadow === "1";
  }
  return layer;
}

export interface NativePromptBridgeComparison {
  /** 承载本次结果的 processor kind。 */
  carrierKind: TurnAssemblyResult["processorKind"];
  /** 影子路径的 processor kind。 */
  shadowKind: TurnAssemblyResult["processorKind"];
  /** prepared prompt 是否逐字段一致。 */
  equal: boolean;
  /** 不一致字段清单（仅字段名 / 摘要，不含正文）。 */
  diffs: string[];
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * NG2-BRIDGE：逐字段比对两条承载路径的 prepared prompt（影子门槛）。
 *
 * 比对确定性输入 hash、装配标志与 PromptIR；任一不一致即记入 `diffs`。
 * 由于两条路径复用同一 compose 闭包，正常情况下应完全一致（golden 等价），
 * diff 非空即说明承载表达引入了回归，必须在切流前修复。
 */
export function compareTurnAssemblyResults(
  carrier: TurnAssemblyResult,
  shadow: TurnAssemblyResult,
): NativePromptBridgeComparison {
  const diffs: string[] = [];
  if (carrier.assemblyInputHash !== shadow.assemblyInputHash) {
    diffs.push("assembly_input_hash");
  }
  if (carrier.characterOverridesHandledInPromptIR !== shadow.characterOverridesHandledInPromptIR) {
    diffs.push("character_overrides_handled");
  }
  if (carrier.memorySummaryHandledInPromptIR !== shadow.memorySummaryHandledInPromptIR) {
    diffs.push("memory_summary_handled");
  }
  if (stableStringify(carrier.promptIr) !== stableStringify(shadow.promptIr)) {
    diffs.push("prompt_ir");
  }
  return {
    carrierKind: carrier.processorKind,
    shadowKind: shadow.processorKind,
    equal: diffs.length === 0,
    diffs,
  };
}
