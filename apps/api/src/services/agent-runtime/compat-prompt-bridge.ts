/**
 * CG11（批次 11）：compat prompt 主链承载灰度与影子比对支撑。
 *
 * 与 NG2-BRIDGE 的 native bridge 同构：
 * - 承载决策：`prompt_mode`（既有命令式 compat 编排，默认）或 `system_graph`（由 compat system graph 承载）。
 * - 灰度分层：Workspace 默认（env）→ Project → Session，后层覆盖前层。
 * - 影子比对：并行跑两条承载路径并逐字段比对 prepared prompt（复用 `compareTurnAssemblyResults`），只比对不切流。
 * - 一键回退：把承载决策设回 `prompt_mode` 即回退，是配置级动作，不回滚代码。
 *
 * 仅 compat_strict / compat_plus 消费本决策；native 走独立的 `native-prompt-bridge`。
 * 关键边界：compat 图化必须 golden 等价（shadow diff 非空即说明承载表达回归，切流前必须修复），
 * 守住 SillyTavern 兼容底线；compat 仍零 Agentic。
 */
export type CompatPromptCarrier = "prompt_mode" | "system_graph";

export const COMPAT_PROMPT_CARRIERS = ["prompt_mode", "system_graph"] as const satisfies readonly CompatPromptCarrier[];

export interface CompatPromptBridgeDecision {
  carrier: CompatPromptCarrier;
  /** 影子运行：并行跑另一条承载路径并比对，差异进入 trace，不切流。 */
  shadow: boolean;
}

/** 默认承载：命令式 prompt_mode，影子关闭 —— 与 CG11 前的行为完全一致。 */
export const DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION: CompatPromptBridgeDecision = {
  carrier: "prompt_mode",
  shadow: false,
};

/** 灰度分层输入：每层可只声明部分字段，后层覆盖前层。 */
export interface CompatPromptBridgeLayers {
  workspace?: Partial<CompatPromptBridgeDecision>;
  project?: Partial<CompatPromptBridgeDecision>;
  session?: Partial<CompatPromptBridgeDecision>;
}

function isCompatPromptCarrier(value: unknown): value is CompatPromptCarrier {
  return value === "prompt_mode" || value === "system_graph";
}

/**
 * 分层解析承载决策：Workspace 默认 → Project → Session，后层覆盖前层。
 *
 * 任一层缺省字段沿用前层；全缺省退化为 `DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION`。
 */
export function resolveCompatPromptBridgeDecision(layers: CompatPromptBridgeLayers): CompatPromptBridgeDecision {
  let decision: CompatPromptBridgeDecision = { ...DEFAULT_COMPAT_PROMPT_BRIDGE_DECISION };
  for (const layer of [layers.workspace, layers.project, layers.session]) {
    if (!layer) {
      continue;
    }
    if (isCompatPromptCarrier(layer.carrier)) {
      decision = { ...decision, carrier: layer.carrier };
    }
    if (typeof layer.shadow === "boolean") {
      decision = { ...decision, shadow: layer.shadow };
    }
  }
  return decision;
}

/** 从环境变量读取 Workspace 默认承载（一键回退的最外层开关）。 */
export function readCompatPromptBridgeWorkspaceDefault(
  env: NodeJS.ProcessEnv = process.env,
): Partial<CompatPromptBridgeDecision> {
  const layer: Partial<CompatPromptBridgeDecision> = {};
  const carrier = env.COMPAT_PROMPT_SYSTEM_GRAPH_CARRIER;
  if (isCompatPromptCarrier(carrier)) {
    layer.carrier = carrier;
  }
  const shadow = env.COMPAT_PROMPT_SYSTEM_GRAPH_SHADOW;
  if (shadow !== undefined) {
    layer.shadow = shadow === "true" || shadow === "1";
  }
  return layer;
}
