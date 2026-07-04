import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { graphAssistantPromptConfig } from "../db/schema.js";

/** 静态提示词叠加模式：追加在内置默认之后，或完全覆盖内置默认。 */
export type GraphAssistantStaticPromptMode = "append" | "override";

/**
 * 图助手内置默认静态提示词（NodeGraph 引导）。
 *
 * 原先硬编码在 temporary-conversation-service 的 `GRAPH_ASSISTANT_GUIDANCE_TEXT`，
 * 现移到此处作为「内置默认」，供注入路径与设置页只读展示共用。内容一字未改。
 */
export const GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT = [
  "你是 NodeGraph 图编辑助手，可以调用一组 NodeGraph 工具来读取与编辑图。",
  "不知道有哪些图、或只知道图名不知道 graph_id 时：先用 nodegraph.graph.list 查看项目里有哪些图，或用 nodegraph.graph.find_by_name按名字拿到 graph_id。",
  "典型工作流：先用 nodegraph.graph.get / list_versions 读取现状；需要改图时用 nodegraph.draft.create_from_version 建草稿，",
  "再用 nodegraph.node.* / nodegraph.edge.* / nodegraph.group.* 修改草稿，用 nodegraph.patch.validate 校验，",
  "最后用 nodegraph.patch.submit_proposal 提交提案。",
  "建图优先用增量方式：先 nodegraph.draft.create_from_version 建草稿，再逐个 nodegraph.node.add / nodegraph.edge.add 添加，",
  "尽量不要在 nodegraph.graph.create 里一次性吐出整个 document（含 nodes / edges 两个大数组），那样更容易写错嵌套 JSON。",
  "参数里的数组（如 nodeIds、document.nodes、document.edges）必须是合法 JSON 数组，写在同一个工具调用内，不要跨调用拆分、不要加注释或尾逗号。",
  "重要边界：除 nodegraph.graph.create（从零新建一张图）外，工具不会直接改线上图；",
  "对既有图的改动只能经 submit_proposal 进入 Project Inbox，再由有权限的人创建正式版本。",
  "读图时以「节点组」为主：nodegraph.graph.get 把节点组作为一等信息（区分 kind=subgraph 封装子图、kind=visual 可视收纳），组内成员只给摘要，不属于任何组的游离节点单列。",
  "想看某个节点的完整配置，用 nodegraph.node.get：传节点 id 得该节点；传节点组 id会展开该组的全部成员（钻入子图或展开可视收纳）。",
  "若一张图来自酒馆（SillyTavern）预设导入（graph.get 的 source.imported_from_preset=true），可用 nodegraph.preset.get 查看原始预设：不带 identifier 得整体概览与 prompt_order→当前分组对照表，带 identifier 得单条 prompt 的完整原文。",
].join("");

/** 项目级提示词配置的 effective 视图（无记录时回退内置默认派生）。 */
export interface GraphAssistantPromptConfigEffective {
  staticMode: GraphAssistantStaticPromptMode;
  staticText: string;
  dynamicTemplate: string;
  /** 上下文数据块配置（阶段二起使用）；无记录或为空时为 null。 */
  contextConfig: Record<string, unknown> | null;
  /** 内置默认静态提示词，供设置页只读展示与合成预览。 */
  builtinDefault: string;
}

export interface GraphAssistantPromptConfigUpsertInput {
  workspaceId: string;
  projectId: string;
  accountId: string;
  staticMode: GraphAssistantStaticPromptMode;
  staticText: string;
  dynamicTemplate?: string;
  contextConfig?: Record<string, unknown> | null;
}

export type GraphAssistantPromptConfigServiceErrorCode = "invalid_static_mode";

export class GraphAssistantPromptConfigServiceError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly code: GraphAssistantPromptConfigServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphAssistantPromptConfigServiceError";
  }
}

function parseContextConfig(raw: string | null): Record<string, unknown> | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function defaultEffective(): GraphAssistantPromptConfigEffective {
  return {
    staticMode: "append",
    staticText: "",
    dynamicTemplate: "",
    contextConfig: null,
    builtinDefault: GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
  };
}

/**
 * 图助手「上下文与提示词」项目级配置服务。
 *
 * 项目级存储、跨临时对话持久。无显式记录时回退内置默认。
 * 静态提示词合成（`resolveStaticPrompt`）是注入路径的单一事实源：
 * append在内置默认之后追加；override 用自定义文本，且自定义为空时回退内置默认。
 */
export class GraphAssistantPromptConfigService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  /** 读取某项目的 effective 配置；无记录时返回内置默认派生。 */
  getByProject(input: { projectId: string }): GraphAssistantPromptConfigEffective {
    const row = this.db
      .select()
      .from(graphAssistantPromptConfig)
      .where(eq(graphAssistantPromptConfig.projectId, input.projectId))
      .limit(1)
      .all()[0];

if (!row) {
      return defaultEffective();
    }

    return {
      staticMode: row.staticMode,
     staticText: row.staticText ?? "",
      dynamicTemplate: row.dynamicTemplate ?? "",
      contextConfig: parseContextConfig(row.contextConfig),
      builtinDefault: GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT,
    };
  }

  /**按项目唯一 upsert 配置；非法 mode 整体拒绝。 */
  upsert(
    input: GraphAssistantPromptConfigUpsertInput,
    now = Date.now(),
  ): GraphAssistantPromptConfigEffective {
    if (input.staticMode !== "append" && input.staticMode !=="override") {
   throw new GraphAssistantPromptConfigServiceError(
        400,
        "invalid_static_mode",
        `Invalid graph assistant static prompt mode '${String(input.staticMode)}'.`,
      );
    }

    const contextConfigJson =
      input.contextConfig === undefined || input.contextConfig === null
  ? null
        : JSON.stringify(input.contextConfig);

    const existing = this.db
      .select()
      .from(graphAssistantPromptConfig)
      .where(eq(graphAssistantPromptConfig.projectId, input.projectId))
      .limit(1)
      .all()[0];

    if (existing) {
      this.db
        .update(graphAssistantPromptConfig)
        .set({
          staticMode: input.staticMode,
          staticText: input.staticText,
          dynamicTemplate: input.dynamicTemplate ?? existing.dynamicTemplate ?? "",
          contextConfig: input.contextConfig === undefined ? existing.contextConfig : contextConfigJson,
          updatedAt: now,
        })
     .where(eq(graphAssistantPromptConfig.id, existing.id))
        .run();
    } else {
      this.db
        .insert(graphAssistantPromptConfig)
        .values({
          id: `gapc_${nanoid(16)}`,
          workspaceId: input.workspaceId,
          projectId: input.projectId,
          accountId: input.accountId,
          staticMode: input.staticMode,
          staticText: input.staticText,
          dynamicTemplate: input.dynamicTemplate ?? "",
        contextConfig: contextConfigJson,
          createdAt: now,
     updatedAt: now,
 })
        .run();
    }

    return this.getByProject({ projectId: input.projectId });
  }

  /**
   * 合成某项目最终静态提示词（注入路径调用）。
   *
   * - projectId 缺省（如 session来源未绑定 project）→ 内置默认。
   * - append →内置默认 + 自定义；自定义为空则仅内置默认。
   * - override → 自定义；自定义为空则回退内置默认（避免空提示词）。
   */
  resolveStaticPrompt(input: { projectId: string | null | undefined }): string {
    if (!input.projectId) {
      return GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT;
    }
    const cfg =this.getByProject({ projectId: input.projectId });
    const custom = cfg.staticText.trim();
    if (cfg.staticMode === "override") {
      return custom.length > 0 ? custom : GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT;
}
    return custom.length > 0
      ? `${GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT}\n\n${custom}`
      : GRAPH_ASSISTANT_DEFAULT_STATIC_PROMPT;
  }
}
