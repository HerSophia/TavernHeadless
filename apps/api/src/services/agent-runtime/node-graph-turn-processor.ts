/**
 * NG2-BRIDGE（批次 9 阶段 12）：`node_graph` turn 级处理器。
 *
 * 让 native prompt 主链由 NodeGraph system graph 承载，但 **不重写编排逻辑**：
 * 核心 PromptIR 仍由调用方经 `context.composePromptModeIr` 注入的同一 compose 闭包产出，
 * 与 `composite` processor golden 一致。本 processor 额外：
 *
 * - 持有内置 native prompt system graph 并校验其可执行（系统图严格校验：唯一 Narrator /
 *   唯一 CommitGate + compose），把「承载表达」落到真实图上。
 * - 在治理 trace 标注承载路径（`carrier = system_graph` + 图 id / version），供影子比对与灰度观测。
 * - 保持 Narrator 唯一正文、不写 live state、checkpoint 中间态可复用等边界与 composite 一致。
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
import {
  NATIVE_PROMPT_SYSTEM_GRAPH_ID,
  NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
  assertNativePromptSystemGraphExecutable,
} from "../node-graph-runtime/system-graph/native-prompt-system-graph.js";

export class NodeGraphTurnProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeGraphTurnProcessorError";
  }
}

let systemGraphValidated = false;

/** 惰性校验内置 system graph 可执行（只做一次，失败即抛）。 */
function ensureSystemGraphExecutable(): void {
  if (!systemGraphValidated) {
    assertNativePromptSystemGraphExecutable();
    systemGraphValidated = true;
  }
}

export class NodeGraphTurnProcessor implements TurnAssemblyProcessor {
  readonly kind = "node_graph" as const;
  readonly recipe: PromptProcessorRecipe;

  constructor(recipe: PromptProcessorRecipe) {
    if (recipe.kind !== "native_prompt") {
      throw new NodeGraphTurnProcessorError(
        "node_graph processor only accepts the native_prompt recipe",
      );
    }
    ensureSystemGraphExecutable();
    this.recipe = recipe;
  }

  prepare(context: TurnAssemblyContext): PreparedTurnAssembly {
    const modelSnapshot = context.modelSnapshot ?? unresolvedRunModelSnapshot();
    // 与 composite 用同一 input-hash 算法 + 同一 native_prompt recipe → hash golden 一致。
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

    const baseSummary = buildChatTurnGovernanceSummary({
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
    // 标注承载路径：本次 native 编排由内置 system graph 承载（图 id / version 进 trace）。
    const governanceSummary = {
      ...baseSummary,
      diagnostics: {
        ...(baseSummary.diagnostics ?? {}),
        carrier: "system_graph" as const,
        system_graph_id: NATIVE_PROMPT_SYSTEM_GRAPH_ID,
        system_graph_version: NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
      },
    };

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

export function createNodeGraphTurnProcessor(recipe: PromptProcessorRecipe): NodeGraphTurnProcessor {
  return new NodeGraphTurnProcessor(recipe);
}
