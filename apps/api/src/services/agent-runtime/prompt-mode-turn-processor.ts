/**
 * P9：`prompt_mode` turn 级处理器。
 *
 * 承载 `compat_strict` / `compat_plus` 两种 recipe：以 deterministic processor 形式
 * 运行同一套旧 compat 编排，语义零改变、零 Agentic。
 *
 * 它不重写编排逻辑：mode 专属 compose 由调用方（`prompt-assembler.ts`）以闭包形式
 * 经 `context.composePromptModeIr` 注入，processor 只负责 recipe / 模型快照 / 确定性
 * hash / 批次 8 治理 trace 的收口。
 */
import {
  unresolvedRunModelSnapshot,
  type PreparedTurnAssembly,
  type TurnAssemblyContext,
  type TurnAssemblyProcessor,
  type TurnAssemblyResult,
} from "./turn-assembly-processor-types.js";
import type { PromptProcessorRecipe } from "./prompt-processor-recipe.js";
import { buildChatTurnGovernanceSummary, computeAssemblyInputHash } from "./turn-assembly-support.js";

export class PromptModeTurnProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptModeTurnProcessorError";
  }
}

export class PromptModeTurnProcessor implements TurnAssemblyProcessor {
  readonly kind = "prompt_mode" as const;
  readonly recipe: PromptProcessorRecipe;

  constructor(recipe: PromptProcessorRecipe) {
    if (recipe.kind === "native_prompt") {
      throw new PromptModeTurnProcessorError(
        "prompt_mode processor only accepts compat_strict / compat_plus recipes",
      );
    }
    // compat 模式必须零 Agentic：严格兼容语义不被图化 / 子 Agent 改写。
    if (recipe.enableInlineAgents) {
      throw new PromptModeTurnProcessorError(
        `compat recipe "${recipe.kind}" must not enable inline agents`,
      );
    }
    this.recipe = recipe;
  }

  prepare(context: TurnAssemblyContext): PreparedTurnAssembly {
    const modelSnapshot = context.modelSnapshot ?? unresolvedRunModelSnapshot();
    const assemblyInputHash = computeAssemblyInputHash(context.assemblyInputDigest, this.recipe);
    return {
      kind: this.kind,
      recipe: this.recipe,
      modelSnapshot,
      assemblyInputHash,
      context,
    };
  }

  execute(prepared: PreparedTurnAssembly): TurnAssemblyResult {
    const startedAt = Date.now();
    const composed = prepared.context.composePromptModeIr();
    const finishedAt = Date.now();

    const governanceSummary = buildChatTurnGovernanceSummary({
      status: "succeeded",
      reasonCode: "succeeded",
      processorKind: this.kind,
      recipe: this.recipe,
      assemblyInputHash: prepared.assemblyInputHash,
      context: prepared.context,
      modelSnapshot: prepared.modelSnapshot,
      startedAt,
      finishedAt,
      inlineAgentsEngaged: false,
    });

    return {
      processorKind: this.kind,
      recipeKind: this.recipe.kind,
      recipeVersion: this.recipe.version,
      assemblyInputHash: prepared.assemblyInputHash,
      promptIr: composed.promptIr,
      characterOverridesHandledInPromptIR: composed.characterOverridesHandledInPromptIR,
      memorySummaryHandledInPromptIR: composed.memorySummaryHandledInPromptIR,
      modelSnapshot: prepared.modelSnapshot,
      governanceSummary,
      // prompt_mode 永不携带 agentRuntimeTrace / checkpoint：零 Agentic，无可复用图中间态。
    };
  }
}

export function createPromptModeTurnProcessor(recipe: PromptProcessorRecipe): PromptModeTurnProcessor {
  return new PromptModeTurnProcessor(recipe);
}
