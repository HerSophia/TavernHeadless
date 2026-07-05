/**
 * LI11-3 阶段 3a/3b + NG2-8：提示词配方解析层（PromptRecipeResolver）。
 *
 * 背景（LI11-3 设计 §6.1）：提示词配方来源当前是会话级单一预设（`session.presetId`），四个角色槽位共享。
 * 本解析层把「预设主体来源」抽成一个可被楼层模板图节点覆盖的解析结果，但 **不改变默认路径**：
 * 节点未声明 `presetRef` 时返回 `narratorPresetRef = null`，`assemblePrompt` 据此回退到
 * `session.presetId` / `session.presetVersionId`，PromptIR 与现状逐字节一致。
 *
 * 承载来源二选一（NG2-7 / NG2-8）：`narration.narrator` 承载节点的执行来源二选一——要么承载
 * **一份酒馆预设**（`presetRef`，走传统 `assemblePrompt` / compat 链路，忠实还原酒馆提示词编排），
 * 要么承载**一张子图**（`subgraphRef`，走 `subgraphRunner` 图链路）。本 resolver 只负责**预设分支**：
 * 以 NG2-7 的 `resolveNodeGraphAgentSource` 判定有效来源，只有有效来源为 `preset` 时才产出预设覆盖。
 *
 * - **有效来源 = preset**：承载预设 = 传统链路。图**不**逐节点执行预设内容——导入图里的
 *   `compose.template_render.content` / narrator `sampling` / `outputRegex` 都不驱动真实生成；
 *   预设作为**整体资产**被引用（`presetRefOverride` 覆盖「预设主体来源」，世界书 / 正则仍取 session）。
 *   要让"跑预设"与真实运行严格一致，走 NG2-10 的「整体引用」模式。
 * - **有效来源 = subgraph**：本 resolver 返回 `narratorPresetRef = null` + `source =
 *   "subgraph_deferred"` + `carrierSource = "subgraph"`，**不产出预设覆盖**。子图真正的运行分派
 *   由 **NG2-9** 落地（含 §10.4「Narrator 强制内联」执行例外）。NG2-9 未接通前，`assemblePrompt`
 *   因 override 为 null 而回退 `session.presetId`——即**子图分支尚未接通时，暂按 session 预设叙事**。
 *   这是**预期的中间态**（trace 标注 `carrierSource=subgraph` + `source=subgraph_deferred`），
 *   不是"配置了子图却按 session 预设跑"的 bug。
 *
 * 回退链（LI11-3 设计 §5、§7）：楼层图 Narrator 节点 `config.presetRef` →（兼容窗口）narrator slot 的
 * `llm_instance_config.preset_id` → `session.presetId`，三路在兼容窗口内等价。职责分工：
 * - 本 resolver 只负责**第一路**：读楼层图 Narrator 节点 `config.presetRef`，命中则作为 override；
 *   未命中返回 null，交 `assemblePrompt` 回退 session。
 * - **第二、三路（slot.preset_id → session.presetId）已由上游 `turn-model-service.buildSessionPromptInfo`
 *   承担**：它把 narrator slot 的 `preset_id` 解析进 `sessionInfo.presetId`（`resolvedTurnModels.narrator?.presetId
 *   ?? bindingPresetId`），缺省再落到 session.presetId。故 resolver 无需重复 slot 分支，否则会双重解析。
 * - 三路合起来：节点 override（本 resolver）优先；缺省时 assemblePrompt 用已含 slot/session 回退的
 *   `sessionInfo.presetId`。LI11-3（3d）废弃 `preset_id` 时，回退链最终收敛为只读节点 config。
 *
 * 结构解析与引用有效性校验分离：
 * - `resolvePromptRecipe` 是纯函数，只读图节点 `config`（source / presetRef）的结构，不查库。
 *   承载来源与 presetRef 读取全部**收敛到 core `agent-source` 助手**（`resolveNodeGraphAgentSource` /
 *   `readNodeGraphPresetRef`），与 validator / 前端判定同源，消除多处漂移（原本地 `parsePresetRef` 已删除）。
 * - `assertNarratorPresetRefResolvable` 是后端侧异步步骤，校验 presetId 是否真实存在且属当前 account；
 *   无效引用一步到位阻断报错（LI11-3 设计 §6.6 已确认，不设静默降级）。只对 `narratorPresetRef !== null`
 *   生效——子图来源（null override）不触发 preset 有效性校验。
 * - 命名边界：这是「配方解析」，与平台层 `Runtime` 无关，不使用 runtime 命名。
 */
import {
  readNodeGraphPresetRef,
  resolveNodeGraphAgentSource,
  type NodeGraphDocument,
} from "@tavern/core";

/** Narrator 节点承载的「预设主体引用」（指向 preset 表）。与 `session.presetId` 同语义。 */
export interface PromptPresetRef {
  presetId: string;
  presetVersionId: string | null;
}

/**
 * 配方来源标注（治理诊断用，LI11-3 设计 §6.5 + NG2-8 §4.3）。
 *
 * - `node_preset_ref`：配方来自楼层图 Narrator 节点的 `config.presetRef`（图级覆盖）。
 * - `session_fallback`：无图级覆盖，回退到 `session.presetId`（含未提供楼层图的情形）。
 * - `subgraph_deferred`：承载节点有效来源为子图（NG2-7），本回合不产出预设覆盖；子图运行分派待 NG2-9，
 *   中间态暂按 `session.presetId` 叙事（见文件头注释）。
 */
export type PromptRecipeSource = "node_preset_ref" | "session_fallback" | "subgraph_deferred";

/**
 * 承载来源（NG2-7 有效来源），供治理诊断与 NG2-9 子图分派判据。
 *
 * - `preset`：承载一份酒馆预设（走传统 assemblePrompt / compat 链路）。
 * - `subgraph`：承载一张子图（走 NodeGraph 图链路；运行分派待 NG2-9）。
 */
export type PromptRecipeCarrierSource = "preset" | "subgraph";

/**
 * 配方解析结果。
 *
 * `narratorPresetRef` 为 null 表示无图级预设覆盖，调用方（assemblePrompt）应回退到 `session.presetId`。
 * `source` 同步标注本次配方来源，`carrierSource` 标注 NG2-7 有效来源，供治理诊断记录与 NG2-9 分派判据。
 */
export interface ResolvedPromptRecipe {
  narratorPresetRef: PromptPresetRef | null;
  source: PromptRecipeSource;
  carrierSource: PromptRecipeCarrierSource;
}

/** Narrator 节点类型（与 core registry / 楼层模板图一致）。 */
const NARRATOR_NODE_TYPE = "narration.narrator";

export interface ResolvePromptRecipeInput {
  /**
   * 当前楼层运行所用的楼层模板图文档（可选）。
   *
   * 「会话→楼层运行图绑定」是 LI11-3 的外部前置依赖（设计 §2.5、§5）；当前 turn 装配点已由
   * `prepared-prompt-artifacts-builder` 传入绑定图。未提供绑定图时，resolver 返回无覆盖结果
   * （`session_fallback` + `carrierSource=preset`），`assemblePrompt` 走 session 默认路径，行为与现状一致。
   */
  floorGraph?: NodeGraphDocument | null;
}

/**
 * 解析楼层运行的提示词配方。
 *
 * 行为（NG2-8 §3.2）：在楼层图中定位唯一 `narration.narrator` 节点，以 NG2-7 的
 * `resolveNodeGraphAgentSource` 判定有效来源：
 * - 有效来源 = preset：读 `config.presetRef`，结构有效则作为 `narratorPresetRef`（`node_preset_ref`），
 *   否则返回 null（`session_fallback`，交 assemblePrompt 回退 session）。
 * - 有效来源 = subgraph：返回 null override（`subgraph_deferred` + `carrierSource=subgraph`），
 *   不产出预设覆盖；子图运行分派待 NG2-9。
 * - source 取值非法（既非 preset 亦非 subgraph；NG2-7 校验层已阻断该图，防御性按预设分支回退处理）。
 *
 * 无楼层图 / 无 narrator 节点时按 `session_fallback` + `carrierSource=preset` 处理，与现状一致。
 *
 * @param input - 解析输入；当前只消费可选的楼层模板图文档。
 * @returns 配方解析结果；`narratorPresetRef` 为 null 表示交由 assemblePrompt 回退到 session 默认。
 */
export function resolvePromptRecipe(input: ResolvePromptRecipeInput): ResolvedPromptRecipe {
  const narratorNode = input.floorGraph
    ? input.floorGraph.nodes.find((node) => node.type === NARRATOR_NODE_TYPE)
    : undefined;

  // 无楼层图 / 无 narrator 节点：与现状一致，回退 session 预设（承载来源按预设处理）。
  if (!narratorNode) {
    return { narratorPresetRef: null, source: "session_fallback", carrierSource: "preset" };
  }

  // NG2-7 有效来源判定（收敛到 core 助手）。source 非法（resolve 返回 null）时防御性按预设分支处理，
  // 该结构本应已被 NG2-7 校验层（node_graph_agent_source_invalid）阻断。
  const carrierSource: PromptRecipeCarrierSource =
    resolveNodeGraphAgentSource(narratorNode) === "subgraph" ? "subgraph" : "preset";

  if (carrierSource === "subgraph") {
    // 承载子图：不产出预设覆盖；运行分派待 NG2-9（中间态，见文件头注释）。
    return { narratorPresetRef: null, source: "subgraph_deferred", carrierSource: "subgraph" };
  }

  // 承载预设：读节点 presetRef（收敛到 core 助手）。命中则 override，否则回退 session。
  const narratorPresetRef = readNodeGraphPresetRef(narratorNode);
  const source: PromptRecipeSource = narratorPresetRef ? "node_preset_ref" : "session_fallback";
  return { narratorPresetRef, source, carrierSource: "preset" };
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
 * 由后端在解析出 `narratorPresetRef` 后、传入 `assemblePrompt` 前调用。`narratorPresetRef` 为 null
 * （无图级覆盖，走 session 回退；含子图来源 `subgraph_deferred`）时直接返回，不做任何校验。引用无效时
 * **抛出** `PromptRecipePresetRefError`，一步到位阻断本回合（设计 §6.6）。
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
