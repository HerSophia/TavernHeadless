/**
 * P9 / NG2-BRIDGE / CG11：turn 级处理器选择器。
 *
 * 按 prompt mode → recipe + carrier 选择承载处理器：
 * - native + `composite`   carrier → `CompositeTurnProcessor`（默认，命令式承载）。
 * - native + `system_graph` carrier → `NodeGraphTurnProcessor`（NG2-BRIDGE，native system graph 承载）。
 * - compat + `prompt_mode` carrier → `PromptModeTurnProcessor`（默认，命令式承载）。
 * - compat + `system_graph` carrier → `NodeGraphTurnProcessor`（CG11，compat system graph 承载）。
 *
 * carrier 仅在 `=== "system_graph"` 时触发图化；缺省（composite / prompt_mode）即命令式承载，
 * 保证既有调用方行为零回归。compat 图化必须 golden 等价（影子门槛），且仍零 Agentic。
 */
import type { PromptMode } from "../prompt-assembler.js";

import type { NativePromptCarrier } from "./native-prompt-bridge.js";
import type { CompatPromptCarrier } from "./compat-prompt-bridge.js";
import { resolvePromptProcessorRecipe } from "./prompt-processor-recipe.js";
import { CompositeTurnProcessor } from "./composite-turn-processor.js";
import { COMPAT_SYSTEM_GRAPH_CARRIER, NodeGraphTurnProcessor } from "./node-graph-turn-processor.js";
import { PromptModeTurnProcessor } from "./prompt-mode-turn-processor.js";
import type { TurnAssemblyProcessor } from "./turn-assembly-processor-types.js";

/** 承载选择：`system_graph` 触发图化；其余（composite / prompt_mode）为命令式默认承载。 */
export type TurnAssemblyCarrier = NativePromptCarrier | CompatPromptCarrier;

export function selectTurnAssemblyProcessor(
  promptMode: PromptMode,
  carrier: TurnAssemblyCarrier = "composite",
): TurnAssemblyProcessor {
  const recipe = resolvePromptProcessorRecipe(promptMode);
  if (recipe.kind === "native_prompt") {
    return carrier === "system_graph"
      ? new NodeGraphTurnProcessor(recipe)
      : new CompositeTurnProcessor(recipe);
  }
  // compat_strict / compat_plus：默认命令式 prompt_mode；仅 system_graph carrier 走 CG11 图化承载。
  return carrier === "system_graph"
    ? new NodeGraphTurnProcessor(recipe, COMPAT_SYSTEM_GRAPH_CARRIER)
    : new PromptModeTurnProcessor(recipe);
}
