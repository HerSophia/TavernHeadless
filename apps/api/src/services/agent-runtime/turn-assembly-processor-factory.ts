/**
 * P9 / NG2-BRIDGE：turn 级处理器选择器。
 *
 * 按 prompt mode → recipe → processor kind 选择承载处理器：
 * - compat_strict / compat_plus → `PromptModeTurnProcessor`（carrier 不参与，永不图化）。
 * - native + `composite`   carrier → `CompositeTurnProcessor`（默认，命令式承载）。
 * - native + `system_graph` carrier → `NodeGraphTurnProcessor`（NG2-BRIDGE 灰度承载）。
 *
 * carrier 缺省为 `composite`，保证既有调用方行为零回归。
 */
import type { PromptMode } from "../prompt-assembler.js";

import type { NativePromptCarrier } from "./native-prompt-bridge.js";
import { resolvePromptProcessorRecipe } from "./prompt-processor-recipe.js";
import { CompositeTurnProcessor } from "./composite-turn-processor.js";
import { NodeGraphTurnProcessor } from "./node-graph-turn-processor.js";
import { PromptModeTurnProcessor } from "./prompt-mode-turn-processor.js";
import type { TurnAssemblyProcessor } from "./turn-assembly-processor-types.js";

export function selectTurnAssemblyProcessor(
  promptMode: PromptMode,
  carrier: NativePromptCarrier = "composite",
): TurnAssemblyProcessor {
  const recipe = resolvePromptProcessorRecipe(promptMode);
  if (recipe.kind === "native_prompt") {
    return carrier === "system_graph"
      ? new NodeGraphTurnProcessor(recipe)
      : new CompositeTurnProcessor(recipe);
  }
  // compat_strict / compat_plus 永不进入 system graph 灰度。
  return new PromptModeTurnProcessor(recipe);
}
