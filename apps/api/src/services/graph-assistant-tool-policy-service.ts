import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AppDb, DbExecutor } from "../db/client.js";
import { graphAssistantToolPolicies } from "../db/schema.js";
import {
  NODE_GRAPH_TOOL_CATALOG,
  type NodeGraphToolCatalogEntry,
} from "../tools/node-graph-tool-provider.js";

/** 图助手逐工具策略：自动执行或需要确认。 */
export type GraphAssistantToolDecision = "auto" | "confirm";

/** 图助手逐工具策略记录（持久行）。 */
export interface GraphAssistantToolPolicyRecord {
  id: string;
  workspaceId: string;
  projectId: string;
  accountId: string;
  toolName: string;
  decision: GraphAssistantToolDecision;
  createdAt: number;
  updatedAt: number;
}

/** 单个工具的 effective 策略（默认值与 override 合并后的结果）。 */
export interface GraphAssistantToolEffectivePolicy {
  toolName: string;
  sideEffectLevel: NodeGraphToolCatalogEntry["sideEffectLevel"];
  defaultDecision: GraphAssistantToolDecision;
  decision: GraphAssistantToolDecision;
  /** 该决策来自显式 override 还是默认值。 */
  source: "default" | "override";
}

export type GraphAssistantToolPolicyServiceErrorCode =
  | "unknown_tool"
  | "invalid_decision";

export class GraphAssistantToolPolicyServiceError extends Error {
  constructor(
    public readonly statusCode: 400,
    public readonly code: GraphAssistantToolPolicyServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GraphAssistantToolPolicyServiceError";
  }
}

/**
 * 默认归类为 `confirm` 的「live 持久写」工具。
 *
 * 这两个工具会真正改变持久产物（新建图 / 提交提案），按设计默认需要确认；
 * 其余只读 / 改草稿工具默认 `auto`。
 */
const CONFIRM_BY_DEFAULT_TOOLS = new Set<string>([
  "nodegraph.graph.create",
  "nodegraph.patch.submit_proposal",
]);

/**
 * 由目录条目推导默认决策（纯函数）。
 *
 * - `irreversible` 级别 → `confirm`（防御性：当前目录无此级别，但避免未来新增工具默认放行）。
 * - 显式列入 `CONFIRM_BY_DEFAULT_TOOLS` 的 live 写工具 → `confirm`。
 * - 其余（`none` 只读 / `sandbox` 改草稿）→ `auto`。
 */
export function deriveDefaultGraphAssistantToolDecision(
  entry: NodeGraphToolCatalogEntry,
): GraphAssistantToolDecision {
  if (entry.sideEffectLevel === "irreversible") {
    return "confirm";
  }
  if (CONFIRM_BY_DEFAULT_TOOLS.has(entry.name)) {
    return "confirm";
  }
  return "auto";
}

/** 已知图助手工具名集合。 */
const KNOWN_TOOL_NAMES = new Set(NODE_GRAPH_TOOL_CATALOG.map((entry) => entry.name));

/**
 * 图助手逐工具「自动执行 / 需要确认」策略服务。
 *
 * 项目级存储、跨临时对话持久。无显式记录的工具按默认值推导。
 */
export class GraphAssistantToolPolicyService {
  constructor(private readonly db: AppDb | DbExecutor) {}

  /** 列出某项目下的所有显式策略记录。 */
  listByProject(input: { projectId: string }): GraphAssistantToolPolicyRecord[] {
    return this.db
      .select()
      .from(graphAssistantToolPolicies)
      .where(eq(graphAssistantToolPolicies.projectId, input.projectId))
      .all()
      .map(rowToRecord);
  }

  /**
   * 解析某项目的 effective 策略：对完整工具目录，逐条返回默认值与 override合并后的决策。
   */
  resolveEffective(input: { projectId: string }): GraphAssistantToolEffectivePolicy[] {
    const overrides = new Map<string, GraphAssistantToolDecision>();
    for (const record of this.listByProject({ projectId: input.projectId })) {
      overrides.set(record.toolName, record.decision);
    }

    return NODE_GRAPH_TOOL_CATALOG.map((entry) => {
      const defaultDecision = deriveDefaultGraphAssistantToolDecision(entry);
      const override = overrides.get(entry.name);
      return {
        toolName: entry.name,
        sideEffectLevel: entry.sideEffectLevel,
        defaultDecision,
        decision: override ?? defaultDecision,
        source: override ? "override" : "default",
      } satisfies GraphAssistantToolEffectivePolicy;
    });
  }

  /**
   * 解析某项目下「应暴露给 LLM」的图助手工具名集合（effective 决策为 `auto`）。
   *
   * 阶段 2 强制语义：`confirm` 工具在确认闸落地前完全 withheld，不进入此集合。
   */
  resolveAutoToolNames(input: { projectId: string }): Set<string> {
    const autoNames = new Set<string>();
    for (const policy of this.resolveEffective({ projectId: input.projectId })) {
      if (policy.decision === "auto") {
        autoNames.add(policy.toolName);
      }
    }
    return autoNames;
  }

  /**
   * 批量 upsert 逐工具策略。
   *
   * 仅接受目录内已知工具名与合法 decision；其一非法整体拒绝（不写入）。
   */
  upsert(
    input: {
      workspaceId: string;
      projectId: string;
      accountId: string;
      policies: Array<{ toolName: string; decision: GraphAssistantToolDecision }>;
    },
    now = Date.now(),
  ): GraphAssistantToolEffectivePolicy[] {
    for (const policy of input.policies) {
      if (!KNOWN_TOOL_NAMES.has(policy.toolName)) {
        throw new GraphAssistantToolPolicyServiceError(
          400,
          "unknown_tool",
          `Unknown graph assistant tool '${policy.toolName}'.`,
        );
      }
      if (policy.decision !== "auto" && policy.decision !== "confirm") {
        throw new GraphAssistantToolPolicyServiceError(
          400,
          "invalid_decision",
          `Invalid graph assistant tool decision '${String(policy.decision)}'.`,
        );
      }
    }

    for (const policy of input.policies) {
      const existing = this.db
        .select()
        .from(graphAssistantToolPolicies)
        .where(and(
          eq(graphAssistantToolPolicies.projectId, input.projectId),
          eq(graphAssistantToolPolicies.toolName, policy.toolName),
        ))
        .limit(1)
        .all()[0];

      if (existing) {
        this.db
          .update(graphAssistantToolPolicies)
          .set({
            decision: policy.decision,
            updatedAt: now,
          })
          .where(eq(graphAssistantToolPolicies.id, existing.id))
          .run();
      } else {
        this.db
          .insert(graphAssistantToolPolicies)
          .values({
            id: `gatp_${nanoid(16)}`,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            accountId: input.accountId,
            toolName: policy.toolName,
            decision: policy.decision,
            createdAt: now,
            updatedAt: now,
          })
          .run();
      }
    }

    return this.resolveEffective({ projectId: input.projectId });
  }
}

function rowToRecord(
  row: typeof graphAssistantToolPolicies.$inferSelect,
): GraphAssistantToolPolicyRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    accountId: row.accountId,
    toolName: row.toolName,
    decision: row.decision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
