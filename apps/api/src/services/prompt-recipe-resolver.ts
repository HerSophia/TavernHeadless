/**
 * LI11-3 阶段 3a/3b：提示词配方解析层（PromptRecipeResolver）。
 *
 * 背景（设计 §6.1）：提示词配方来源当前是会话级单一预设（`session.presetId`），四个角色槽位共享。
 * 本解析层把「预设主体来源」抽成一个可被楼层模板图节点覆盖的解析结果，但 **不改变默认路径**：
 * 节点未声明 `presetRef` 时返回 `narratorPresetRef = null`，`assemblePrompt` 据此回退到
 * `session.presetId` / `session.presetVersionId`，PromptIR 与现状逐字节一致。
 *
 * 回退链（设计 §5、§7）：楼层图 Narrator 节点 `config.presetRef` →（兼容窗口）narrator slot 的
 * `llm_instance_config.preset_id` → `session.presetId`，三路在兼容窗口内等价。职责分工：
 * - 本 resolver 只负责**第一路**：读楼层图 Narrator 节点 `config.presetRef`，命中则作为 override；
 *   未命中返回 null，交 `assemblePrompt` 回退 session。
 * - **第二、三路（slot.preset_id → session.presetId）已由上游 `turn-model-service.buildSessionPromptInfo`
 *   承担**：它把 narrator slot的 `preset_id` 解析进 `sessionInfo.presetId`（`resolvedTurnModels.narrator?.presetId
 *   ?? bindingPresetId`），缺省再落到session.presetId。故 resolver 无需重复 slot 分支，否则会双重解析。
 * - 三路合起来：节点 override（本 resolver）优先；缺省时 assemblePrompt 用已含 slot/session 回退的
 *   `sessionInfo.presetId`。LI11-3（3d）废弃 `preset_id` 时，回退链最终收敛为只读节点 config。
 *
 * 结构解析与引用有效性校验分离：
 * - `resolvePromptRecipe` 是纯函数，只读图节点 `config.presetRef` 的结构，不查库。
 * - `assertNarratorPresetRefResolvable` 是后端侧异步步骤，校验 presetId 是否真实存在且属当前 account；
 *   无效引用一步到位阻断报错（设计 §6.6 已确认，不设静默降级）。
 * - 命名边界：这是「配方解析」，与平台层 `Runtime` 无关，不使用 runtime 命名。
 */
import type { NodeGraphDocument, NodeGraphNode } from "@tavern/core";

/** Narrator 节点承载的「预设主体引用」（指向 preset 表）。与 `session.presetId` 同语义。 */
export interface PromptPresetRef {
  presetId: string;
  presetVersionId: string | null;
}

/**
 * 配方来源标注（治理诊断用，设计 §6.5）。
 *
 * - `node_preset_ref`：配方来自楼层图 Narrator 节点的 `config.presetRef`（图级覆盖）。
 * - `session_fallback`：无图级覆盖，回退到 `session.presetId`（含未提供楼层图的情形）。
 */
export type PromptRecipeSource = "node_preset_ref" | "session_fallback";

/**
 * 配方解析结果。
 *
 * `narratorPresetRef` 为 null 表示无图级覆盖，调用方（assemblePrompt）应回退到 `session.presetId`。
 * `source` 同步标注本次配方来源，供治理诊断记录。
 */
export interface ResolvedPromptRecipe {
  narratorPresetRef: PromptPresetRef | null;
  source: PromptRecipeSource;
}

/** Narrator 节点类型（与 core registry / 楼层模板图一致）。 */
const NARRATOR_NODE_TYPE = "narration.narrator";

export interface ResolvePromptRecipeInput {
  /**
   * 当前楼层运行所用的楼层模板图文档（可选）。
*
   * 「会话→楼层运行图绑定」是 LI11-3 的外部前置依赖（设计 §2.5、§5），当前 turn 装配点没有该绑定来源，
   * 调用方暂传 null，resolver 因此返回无覆盖结果，`assemblePrompt` 走 session 默认路径，行为与现状一致。
   *该能力就绪后把绑定图喂入即可让 presetRef 全链路生效。
   */
  floorGraph?: NodeGraphDocument | null;
}

/**
 * 解析楼层运行的提示词配方。
 *
 * 3a 行为：在楼层图中定位唯一 `narration.narrator` 节点，读其 `config.presetRef`；
 * 存在且结构有效则作为 `narratorPresetRef`，否则返回 null（无覆盖）。
 *
 * @param input - 解析输入；当前只消费可选的楼层模板图文档。
 * @returns 配方解析结果；`narratorPresetRef` 为 null 表示交由 assemblePrompt 回退到 session 默认。
 */
export function resolvePromptRecipe(input: ResolvePromptRecipeInput): ResolvedPromptRecipe {
  const narratorPresetRef = input.floorGraph ? readNarratorPresetRef(input.floorGraph) : null;
  const source: PromptRecipeSource = narratorPresetRef ? "node_preset_ref" : "session_fallback";
  return { narratorPresetRef, source };
}

function readNarratorPresetRef(graph: NodeGraphDocument): PromptPresetRef | null {
  const narratorNode = graph.nodes.find((node) => node.type === NARRATOR_NODE_TYPE);
  if (!narratorNode) {
    return null;
  }
  return parsePresetRef(narratorNode);
}

/** LI11-3（3b）：无效配方引用错误码（阻断本回合，提示配方引用失效）。 */
export const PROMPT_RECIPE_PRESET_REF_INVALID_CODE = "prompt_recipe_preset_ref_invalid" as const;

/** LI11-3（3b）：配方引用无效时抛出。无效引用一步到位阻断，不静默降级（设计 §6.6）。 */
export class PromptRecipePresetRefError extends Error {
  readonly code = PROMPT_RECIPE_PRESET_REF_INVALID_CODE;
  readonly presetId: string;

  constructor(presetId: string) {
    super(`Prompt recipe references a preset '${presetId}' that does not exist or is not accessible.`);
    this.name = "PromptRecipePresetRefError";
    this.presetId = presetId;
  }
}

/**
 * 校验已解析配方中的 Narrator 预设引用是否可解析（存在且属当前 account）。
 *
 * 由后端在解析出 `narratorPresetRef`后、传入 `assemblePrompt` 前调用。`narratorPresetRef` 为 null
 * （无图级覆盖，走 session 回退）时直接返回，不做任何校验。引用无效时**抛出**
 * `PromptRecipePresetRefError`，一步到位阻断本回合（设计 §6.6）。
 *
 * @param recipe - 已解析的配方。
 * @param presetExists - 注入的存在性探测：给定 presetId 返回其是否存在且属当前 account。
 *   以回调注入而非直接依赖 DB，保持本模块可单测、不耦合具体存储实现。
 */
export async function assertNarratorPresetRefResolvable(
  recipe: ResolvedPromptRecipe,
  presetExists: (presetId: string) => Promise<boolean>,
): Promise<void> {
  const ref = recipe.narratorPresetRef;
  if (!ref) {
    return;
  }
  const exists = await presetExists(ref.presetId);
  if (!exists) {
    throw new PromptRecipePresetRefError(ref.presetId);
  }
}

function parsePresetRef(node: NodeGraphNode): PromptPresetRef | null {
  const config = node.config;
  if (!config || typeof config !== "object") {
    return null;
  }
  const presetRef = (config as { presetRef?: unknown }).presetRef;
  if (!presetRef || typeof presetRef !== "object") {
    return null;
  }
  const presetId = (presetRef as { presetId?: unknown }).presetId;
  if (typeof presetId !== "string" || presetId.length === 0) {
    return null;
  }
  const rawVersionId = (presetRef as { presetVersionId?: unknown }).presetVersionId;
  const presetVersionId =
    typeof rawVersionId === "string" && rawVersionId.length > 0 ? rawVersionId : null;
  return { presetId, presetVersionId };
}
