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
import type { PromptProcessorRecipe, PromptProcessorRecipeKind } from "./prompt-processor-recipe.js";
import { buildChatTurnGovernanceSummary, computeAssemblyInputHash } from "./turn-assembly-support.js";
import {
  NATIVE_PROMPT_SYSTEM_GRAPH_ID,
  NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
  assertNativePromptSystemGraphExecutable,
} from "../node-graph-runtime/system-graph/native-prompt-system-graph.js";
import {
  COMPAT_PROMPT_SYSTEM_GRAPH_ID,
  COMPAT_PROMPT_SYSTEM_GRAPH_VERSION,
  assertCompatPromptSystemGraphExecutable,
} from "../node-graph-runtime/system-graph/compat-prompt-system-graph.js";

export class NodeGraphTurnProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NodeGraphTurnProcessorError";
  }
}

/**
 * CG11：system graph 承载描述符。把「承载哪张内置 system graph + 接受哪些 recipe」抽象出来，
 * 使 `NodeGraphTurnProcessor` 同时服务 native（NG2-BRIDGE）与 compat（CG11）两条承载路径。
 */
export interface TurnSystemGraphCarrier {
  /** 内置 system graph id（进入承载 trace）。 */
  id: string;
  /** 内置 system graph 版本（进入承载 trace）。 */
  version: string;
  /** 惰性断言该 system graph 可执行（只做一次，失败即抛）。 */
  assertExecutable(): void;
  /** 该承载是否接受给定 recipe kind。 */
  acceptsRecipeKind(kind: PromptProcessorRecipeKind): boolean;
}

let nativeSystemGraphValidated = false;
let compatSystemGraphValidated = false;

/** NG2-BRIDGE：native prompt system graph 承载描述符（默认）。 */
export const NATIVE_SYSTEM_GRAPH_CARRIER: TurnSystemGraphCarrier = {
  id: NATIVE_PROMPT_SYSTEM_GRAPH_ID,
  version: NATIVE_PROMPT_SYSTEM_GRAPH_VERSION,
  assertExecutable(): void {
    if (!nativeSystemGraphValidated) {
      assertNativePromptSystemGraphExecutable();
      nativeSystemGraphValidated = true;
    }
  },
  acceptsRecipeKind: (kind) => kind === "native_prompt",
};

/** CG11：compat prompt system graph 承载描述符（接受 compat_strict / compat_plus）。 */
export const COMPAT_SYSTEM_GRAPH_CARRIER: TurnSystemGraphCarrier = {
  id: COMPAT_PROMPT_SYSTEM_GRAPH_ID,
  version: COMPAT_PROMPT_SYSTEM_GRAPH_VERSION,
  assertExecutable(): void {
    if (!compatSystemGraphValidated) {
      assertCompatPromptSystemGraphExecutable();
      compatSystemGraphValidated = true;
    }
  },
  acceptsRecipeKind: (kind) => kind === "compat_strict" || kind === "compat_plus",
};

export class NodeGraphTurnProcessor implements TurnAssemblyProcessor {
  readonly kind = "node_graph" as const;
  readonly recipe: PromptProcessorRecipe;
  private readonly carrier: TurnSystemGraphCarrier;

  constructor(recipe: PromptProcessorRecipe, carrier: TurnSystemGraphCarrier = NATIVE_SYSTEM_GRAPH_CARRIER) {
    if (!carrier.acceptsRecipeKind(recipe.kind)) {
      throw new NodeGraphTurnProcessorError(
        `node_graph carrier "${carrier.id}" does not accept recipe "${recipe.kind}"`,
      );
    }
    carrier.assertExecutable();
    this.recipe = recipe;
    this.carrier = carrier;
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
    // 标注承载路径：本次编排由内置 system graph 承载（图 id / version 进 trace）。
    const governanceSummary = {
      ...baseSummary,
      diagnostics: {
        ...(baseSummary.diagnostics ?? {}),
        carrier: "system_graph" as const,
        system_graph_id: this.carrier.id,
        system_graph_version: this.carrier.version,
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
