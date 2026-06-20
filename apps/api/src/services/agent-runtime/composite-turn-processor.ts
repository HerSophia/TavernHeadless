/**
 * P9：`composite` turn 级处理器（native_prompt）。
 *
 * native prompt 编排是「native prompt 装配（PromptGraph）+ preflight 子 Agent + Narrator +
 * post verifier」的合体表达。本 processor 把它收口为统一合同：
 *
 * - 核心装配（PromptGraph → PromptIR）由调用方经 `context.composePromptModeIr` 注入，逐字不变。
 * - inline agentic 子步骤复用既有 `InlineAgentExecutor` 体系（由 chat-service 调度），其
 *   `AgentRuntimeTrace` 经 `context.agentRuntimeTrace` 收口到本 processor 结果，行为不变。
 * - Narrator 唯一正文：本 processor 只 compose 一次 PromptIR、不生成正文，preflight / verifier
 *   只产 brief / proposal / trace。
 * - 导出 `checkpoint()` 中间态（仅结构，不接持久表），供 NG2-CORE 复用。
 */
import {
  unresolvedRunModelSnapshot,
  type PreparedTurnAssembly,
  type TurnAssemblyCheckpoint,
  type TurnAssemblyContext,
  type TurnAssemblyProcessor,
  type TurnAssemblyResult,
} from "./turn-assembly-processor-types.js";
import type { PromptProcessorRecipe } from "./prompt-processor-recipe.js";
import { buildChatTurnGovernanceSummary, computeAssemblyInputHash } from "./turn-assembly-support.js";

export class CompositeTurnProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompositeTurnProcessorError";
  }
}

export class CompositeTurnProcessor implements TurnAssemblyProcessor {
  readonly kind = "composite" as const;
  readonly recipe: PromptProcessorRecipe;

  constructor(recipe: PromptProcessorRecipe) {
    if (recipe.kind !== "native_prompt") {
      throw new CompositeTurnProcessorError(
        "composite processor only accepts the native_prompt recipe",
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

    const agentRuntimeTrace = prepared.context.agentRuntimeTrace;
    const inlineAgentsEngaged = agentRuntimeTrace !== undefined;

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
      inlineAgentsEngaged,
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
      ...(agentRuntimeTrace ? { agentRuntimeTrace } : {}),
      checkpoint: this.checkpoint(prepared, composed.characterOverridesHandledInPromptIR, composed.memorySummaryHandledInPromptIR),
    };
  }

  checkpoint(
    prepared: PreparedTurnAssembly,
    characterOverridesHandledInPromptIR?: boolean,
    memorySummaryHandledInPromptIR?: boolean,
  ): TurnAssemblyCheckpoint {
    // native 的 floor-stable / pre-response deterministic 装配可被 FloorRun 复用；
    // 这里只导出可复用中间态结构（assemblyInputHash + recipe + 装配标志），不接持久表。
    const compose = characterOverridesHandledInPromptIR === undefined
      ? prepared.context.composePromptModeIr()
      : undefined;
    return {
      kind: this.kind,
      recipeKind: this.recipe.kind,
      recipeVersion: this.recipe.version,
      assemblyInputHash: prepared.assemblyInputHash,
      characterOverridesHandledInPromptIR:
        characterOverridesHandledInPromptIR ?? compose!.characterOverridesHandledInPromptIR,
      memorySummaryHandledInPromptIR:
        memorySummaryHandledInPromptIR ?? compose!.memorySummaryHandledInPromptIR,
      createdAt: Date.now(),
    };
  }
}

export function createCompositeTurnProcessor(recipe: PromptProcessorRecipe): CompositeTurnProcessor {
  return new CompositeTurnProcessor(recipe);
}
