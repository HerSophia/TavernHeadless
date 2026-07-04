import type { NodeGraphDocument } from "@tavern/core/node-graph";

/**
 * 内置示例 v2 图：**Narrator 主叙事案例**（参考酒馆 OpenAI 预设的「主提示 + 世界信息 +
 * 角色 + 历史 → 出文 → 后检」结构，落到本仓库 NodeGraph 节点体系）。
 *
 * 心智模型（见 `.limcode/design/agentic-batch10-wb10-agent-nodegraph-relationship-discussion.md`
 * 第八、九节）——**两级**：
 *
 * - **Agent（父 / run 持有者）**：整张图就是「一次主叙事回合」的编排管线（M1：父执行 = 一次 graph run）。
 * - **顾问子 Agent（advisory，只产 brief / findings，不写正文，可多个、可并行）**：
 *     - `agent.director_plan`（导演：剧情规划）
 *     - `agent.player_agency_precheck`（玩家自主性预检）
 *     - `agent.call`（世界书研究，medium=single_call；并由 condition→gate **条件门控**，演示「按需调用的子 Agent」）
 *   以及后置校验：`verify.continuity`、`verify.player_agency_postcheck`。
 * - **Narrator（特殊「叶子」子 Agent）**：`narration.narrator` 是**唯一正文生成者**（唯一持笔人），
 *   每图唯一、必经 `output.commit_gate` 才入正史，且**自身不再派生子 Agent**——其内部的「主提示块 /
 *   角色卡块 / 会话状态块 / 顾问 brief 注入块 → final_messages → narrator」整体就是
 *   **「酒馆预设的主体」**。预设三件套（采样参数 / `prompts[]`+`prompt_order` 装配 / 输出正则后处理）
 *   导入后即落进这块「Narrator 主体」。
 *
 * 表示法采用**方案 C（现在）→ B（将来）**：保留单一 `narration.narrator` 作为 canon 持笔节点
 * （零新增后端、§8.4 唯一性 + CommitGate 不变量原样成立），同时把它的装配收进可视分组
 * `g_narrator`「Narrator（预设主体）」，与父级顾问分组 `g_preflight` / 后置分组 `g_post` 区隔，
 * 从而在画布上一眼读出「父编排 ↔ Narrator 主体 ↔ 顾问/校验」的两级关系。
 *
 * 注 1：预设里的**输出正则后处理脚本**（去八股 / 反从句 / 单换行 …）对应「Narrator 主体内、
 * CommitGate 之前的一个文本清洗步」，当前节点表暂无对应 type（留作 `compose.regex_postprocess`
 * 之类的未来节点），故此示例未画该节点。
 * 注 2：执行层面 Narrator **在父图同一次 graph run 内内联执行**，不另起 nested run；只有
 * `agent.call` 型顾问才可能是 nested run（R6-1）。
 *
 * 整图刻意做成**干净可执行**（无 error 级诊断），作为画布默认演示与 `map-document` / `elk-adapter`
 * 等单测的真实夹具；刻意不给节点坐标，以验证占位列布局兜底。`systemGraph` 置 false（规避「用户另存
 * 系统图」边界），但结构仍满足 system graph 约束（唯一 Narrator + 唯一 CommitGate + 含 compose.final_messages）。
 */
export const SAMPLE_NODE_GRAPH_DOCUMENT: NodeGraphDocument = {
  schemaVersion: 2,
  graphId: "sample-narrator-turn",
  name: "示例 · Narrator 主叙事",
  description:
    "Narrator 主叙事案例（两级）：上下文源 → 顾问子 Agent（导演 / 自主性预检 / 世界书研究，含条件门控）→ 「Narrator 预设主体」装配 → 唯一 Narrator → 后置校验子 Agent → CommitGate → 受控写出。",
  mode: "native_graph",
  nodes: [
    // —— 上下文 / 检索（floor-stable 可复用，父级共享，不属于任何分组）——
    { id: "n_user", type: "source.user_input", typeVersion: "1", phase: "pre_response" },
    {
      id: "n_history",
      type: "source.chat_history",
      typeVersion: "1",
      phase: "pre_response",
      scope: "floor_stable",
    },
    {
      id: "n_session_state",
      type: "source.session_state",
      typeVersion: "1",
      phase: "pre_response",
      scope: "floor_stable",
    },
    {
      id: "n_char",
      type: "source.character",
      typeVersion: "1",
      name: "角色卡源",
      phase: "pre_response",
      scope: "floor_stable",
    },
    { id: "n_wb", type: "select.worldbook_match", typeVersion: "1", phase: "pre_response" },

    // —— Preflight 顾问子 Agent（只产 brief，不写正文）——
    {
      id: "n_director",
      type: "agent.director_plan",
      typeVersion: "1",
      name: "导演子 Agent（剧情规划）",
      phase: "pre_response",
      scope: "pre_response_stochastic",
    },
    {
      id: "n_agency_pre",
      type: "agent.player_agency_precheck",
      typeVersion: "1",
      name: "玩家自主性预检子 Agent",
      phase: "pre_response",
      scope: "pre_response_stochastic",
    },
    // 条件门控：仅当世界书有命中时才运行「世界书研究」子 Agent。
    {
      id: "n_cond",
      type: "control.condition",
      typeVersion: "1",
      phase: "pre_response",
      config: {
        condition: { op: "exists", value: { source: "variable", path: ["worldbook_focus"] } },
      },
    },
    {
      id: "n_gate",
      type: "control.gate",
      typeVersion: "1",
      phase: "pre_response",
      config: { onSkip: "use_default" },
    },
    {
      id: "n_lore",
      type: "agent.call",
      typeVersion: "1",
      name: "世界书研究子 Agent（agent.call）",
      phase: "pre_response",
      scope: "pre_response_stochastic",
      config: { medium: { kind: "single_call", deliveryTarget: "return_inline" } },
    },

    // —— ★ Narrator（预设主体 / 唯一持笔人）：预设三件套里「prompt 装配」落点 ——
    // 主提示块 / 角色卡块 = 预设里的 main/jailbreak 与 charDescription marker（authored，无上游数据边）。
    {
      id: "n_main_block",
      type: "compose.template_render",
      typeVersion: "1",
      name: "主提示块（预设 main/jailbreak）",
      phase: "pre_response",
    },
    {
      id: "n_char_block",
      type: "compose.template_render",
      typeVersion: "1",
      name: "角色卡块（预设 charDescription）",
      phase: "pre_response",
    },
    {
      id: "n_state_block",
      type: "compose.session_state_projection_block",
      typeVersion: "1",
      name: "会话状态投影块",
      phase: "pre_response",
    },
    // 顾问 brief → 渲染为 prompt block，注入 Narrator 主体装配。
    {
      id: "n_director_block",
      type: "compose.template_render",
      typeVersion: "1",
      name: "导演提示块",
      phase: "pre_response",
    },
    {
      id: "n_agency_block",
      type: "compose.template_render",
      typeVersion: "1",
      name: "玩家自主性约束块",
      phase: "pre_response",
    },
    {
      id: "n_lore_block",
      type: "compose.template_render",
      typeVersion: "1",
      name: "世界书研究块",
      phase: "pre_response",
    },
    {
      id: "n_compose",
      type: "compose.final_messages",
      typeVersion: "1",
      name: "最终消息装配",
      phase: "response",
    },
    {
      id: "n_narrator",
      type: "narration.narrator",
      typeVersion: "1",
      name: "主叙事 Narrator（唯一持笔人）",
      phase: "response",
      scope: "page_volatile",
    },

    // —— 后置校验子 Agent（只产 findings / verifier_result，不写正文）——
    {
      id: "n_continuity",
      type: "verify.continuity",
      typeVersion: "1",
      name: "连续性校验子 Agent",
      phase: "post_response",
    },
    {
      id: "n_agency_post",
      type: "verify.player_agency_postcheck",
      typeVersion: "1",
      name: "玩家自主性后检子 Agent",
      phase: "post_response",
    },

    // —— 唯一正史边界 + 受控写出（父级，不属于任何分组）——
    {
      id: "n_commit",
      type: "output.commit_gate",
      typeVersion: "1",
      name: "CommitGate（唯一正史边界）",
      phase: "commit",
    },
    {
      id: "n_state_write",
      type: "output.session_state_proposal",
      typeVersion: "1",
      name: "会话状态提案写出",
      phase: "commit",
    },
    {
      id: "n_derived",
      type: "output.derived_output",
      typeVersion: "1",
      name: "派生产物写出",
      phase: "commit",
    },
  ],
  edges: [
    // 上下文 / 检索
    { id: "e_user_wb", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_wb", port: "query" } },
    // 当前用户输入 → 各必填 user_input 端口（导演 / 自主性预检 / Narrator / 自主性后检）
    { id: "e_user_director", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_director", port: "user_input" } },
    { id: "e_user_agency_pre", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_agency_pre", port: "user_input" } },
        { id: "e_user_narrator", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_narrator", port: "user_input" } },
    { id: "e_user_agency_post", from: { nodeId: "n_user", port: "text" }, to: { nodeId: "n_agency_post", port: "user_input" } },
    // 历史消息扇出到两个顾问子 Agent 与最终装配
    { id: "e_hist_director", from: { nodeId: "n_history", port: "messages" }, to: { nodeId: "n_director", port: "messages" } },
    { id: "e_hist_agency", from: { nodeId: "n_history", port: "messages" }, to: { nodeId: "n_agency_pre", port: "messages" } },
    { id: "e_hist_compose", from: { nodeId: "n_history", port: "messages" }, to: { nodeId: "n_compose", port: "messages" } },
    // 会话状态 → 投影块；角色卡 → 角色卡块
    { id: "e_state_block", from: { nodeId: "n_session_state", port: "state" }, to: { nodeId: "n_state_block", port: "state" } },
    { id: "e_char_block", from: { nodeId: "n_char", port: "json" }, to: { nodeId: "n_char_block", port: "data" } },
    // 世界书命中 → 研究子 Agent 输入 + 条件判定
    { id: "e_wb_lore", from: { nodeId: "n_wb", port: "selection" }, to: { nodeId: "n_lore", port: "input" } },
    { id: "e_wb_cond", from: { nodeId: "n_wb", port: "selection" }, to: { nodeId: "n_cond", port: "value" } },
    { id: "e_cond_gate", from: { nodeId: "n_cond", port: "result" }, to: { nodeId: "n_gate", port: "condition" } },
    // 顾问 brief → 渲染为 prompt block
    { id: "e_director_block", from: { nodeId: "n_director", port: "brief" }, to: { nodeId: "n_director_block", port: "data" } },
    { id: "e_agency_block", from: { nodeId: "n_agency_pre", port: "brief" }, to: { nodeId: "n_agency_block", port: "data" } },
    { id: "e_lore_block", from: { nodeId: "n_lore", port: "brief" }, to: { nodeId: "n_lore_block", port: "data" } },
    // 各 block 汇入「Narrator 主体」最终装配（blocks 为多入端口）
    { id: "e_mainblock_compose", from: { nodeId: "n_main_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    { id: "e_charblock_compose", from: { nodeId: "n_char_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    { id: "e_stateblock_compose", from: { nodeId: "n_state_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    { id: "e_directorblock_compose", from: { nodeId: "n_director_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    { id: "e_agencyblock_compose", from: { nodeId: "n_agency_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    { id: "e_loreblock_compose", from: { nodeId: "n_lore_block", port: "block" }, to: { nodeId: "n_compose", port: "blocks" } },
    // 装配 → Narrator → 后置校验 + CommitGate
    { id: "e_compose_narrator", from: { nodeId: "n_compose", port: "messages" }, to: { nodeId: "n_narrator", port: "messages" } },
    { id: "e_narrator_continuity", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_continuity", port: "text" } },
    { id: "e_narrator_agency", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_agency_post", port: "text" } },
    { id: "e_narrator_commit", from: { nodeId: "n_narrator", port: "text" }, to: { nodeId: "n_commit", port: "text" } },
    { id: "e_continuity_commit", from: { nodeId: "n_continuity", port: "result" }, to: { nodeId: "n_commit", port: "verifier" } },
    { id: "e_agencypost_commit", from: { nodeId: "n_agency_post", port: "result" }, to: { nodeId: "n_commit", port: "outputs" } },
    // CommitGate 决策 → 受控写出
    { id: "e_commit_derived", from: { nodeId: "n_commit", port: "decision" }, to: { nodeId: "n_derived", port: "value" } },
    { id: "e_stateblock_write", from: { nodeId: "n_state_block", port: "text" }, to: { nodeId: "n_state_write", port: "proposal" } },
    // control 边：gate 门控「世界书研究」子 Agent 是否运行
    { id: "c_gate_lore", kind: "control", from: { nodeId: "n_gate", port: "open" }, to: { nodeId: "n_lore", port: "input" } },
  ],
  groups: [
    {
      id: "g_preflight",
      name: "Preflight 顾问子 Agent",
      kind: "visual",
      nodeIds: ["n_director", "n_agency_pre", "n_cond", "n_gate", "n_lore"],
    },
    {
      id: "g_narrator",
      name: "Narrator（预设主体 / 唯一持笔人）",
      kind: "visual",
      nodeIds: [
        "n_main_block",
        "n_char_block",
        "n_state_block",
        "n_director_block",
        "n_agency_block",
        "n_lore_block",
        "n_compose",
        "n_narrator",
      ],
    },
    {
      id: "g_post",
      name: "Post 校验子 Agent",
      kind: "visual",
      nodeIds: ["n_continuity", "n_agency_post"],
    },
  ],
  policies: { allowPersistentOutputs: true },
  permissions: {
    required: ["project.agent.run", "project.derived_output.write", "session.state.write"],
  },
  metadata: { systemGraph: false },
};
