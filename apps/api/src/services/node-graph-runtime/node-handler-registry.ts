import type {
  NodeGraphDiagnostic,
  NodeGraphNode,
  NodeGraphNodeRunOutput,
  NodeGraphRunIntent,
} from "@tavern/core";

import type { AgentExecutorRouter } from "../agent-runtime/agent-executor-router.js";
import type { AgentOutputDispatcher } from "../agent-runtime/agent-output-dispatcher.js";
import type { NodeGraphRunService } from "../node-graph-run-service.js";
import type { NodeGraphRuntimeBudget } from "./budget.js";

export type NodeGraphNodeInputs = Record<string, unknown>;

/**
 * NG2-β：`group.node`（NodeGroup 实例）递归执行的注入式运行器。
 *
 * handler 负责把父图实例端口值映射为子图边界输入（按 portName），调用 runner 加载并以
 * **嵌套 graph run** 执行被引用的子图，再把子图边界输出按 portName 映射回实例输出。
 * runner 的实际实现（加载子图版本 + 复用 executor 递归 + 血缘 + 环检测）由运行编排处注入；
 * 不注入时 handler 走 dry/synthetic 兜底（不崩溃）。
 */
export type NodeGraphSubgraphRunInput = {
  ref: { graphId: string; versionId?: string };
  /** 父图实例输入端口值（key = group.node 输入端口名 = 子图 group.input 的 portName）。 */
  inputsByPort: Record<string, unknown>;
  parentNode: NodeGraphNode;
};

export type NodeGraphSubgraphRunResult = {
  status: "succeeded" | "failed";
  /** 子图边界输出（key = 子图 group.output 的 portName = group.node 输出端口名）。 */
  outputsByPort: Record<string, unknown>;
  diagnostics?: NodeGraphDiagnostic[];
};

export type NodeGraphSubgraphRunner = (
  input: NodeGraphSubgraphRunInput,
  context: NodeGraphRuntimeContext,
) => Promise<NodeGraphSubgraphRunResult>;

export type NodeGraphRuntimeContext = {
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId?: string | null;
  floorId?: string | null;
  pageId?: string | null;
  intent: NodeGraphRunIntent;
  dryRun: boolean;
  input?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  userInput?: string;
  chatHistory?: Array<{ role: string; content: string }>;
  character?: Record<string, unknown>;
  persona?: Record<string, unknown>;
  worldbookEntries?: unknown[];
  memorySelection?: unknown;
  sessionState?: unknown;
  cachedNodeOutputs?: Record<string, NodeGraphNodeRunOutput>;
  agentRouter?: AgentExecutorRouter;
  outputDispatcher?: AgentOutputDispatcher;
  runService?: NodeGraphRunService;
  actorClientId?: string | null;
  /**
   * B8-GOV R6-1 nested lineage（缺口 3）。
   *
   * graph run 在 prepare 阶段预生成的 run id 与 root run id，
   * 让 `agent.call` 入队的后台 job 能携带 parent_run_id / root_run_id 反查父级运行。
   */
  graphRunId?: string | null;
  rootRunId?: string | null;
  /**
   * R6-2 NodeGraph runtime budget（缺口 4）。
   *
   * 不传时 executor 使用默认运行预算；preview 路径传入更严格的同步预算。
   */
  budget?: NodeGraphRuntimeBudget;
  /** NG2-CORE：运行的 graph version id（checkpoint 复用键的一部分）。 */
  graphVersionId?: string | null;
  /**
   * NG2-CORE：控制流节点的受控条件求值上下文，由 executor 为 control.* 节点注入；
   * 形如 `{ variable, session_state, node_output, runtime }`。其他节点不可见。
   */
  conditionContext?: Record<string, unknown>;
  /** NG2-β：`group.node` 递归执行运行器（由运行编排注入；缺省走 dry/synthetic 兜底）。 */
  subgraphRunner?: NodeGraphSubgraphRunner;
  /** NG2-β：当前递归路径上的 graphId 栈（含顶层），用于子图引用环检测。 */
  subgraphStack?: string[];
};

export interface NodeGraphNodeHandler {
  readonly type: string;
  execute(input: {
    node: NodeGraphNode;
    inputs: NodeGraphNodeInputs;
    context: NodeGraphRuntimeContext;
  }): Promise<NodeGraphNodeRunOutput> | NodeGraphNodeRunOutput;
}

export class NodeGraphNodeHandlerRegistry {
  private readonly handlers = new Map<string, NodeGraphNodeHandler>();

  register(handler: NodeGraphNodeHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`NodeGraph handler already registered: ${handler.type}`);
    }
    this.handlers.set(handler.type, handler);
  }

  get(type: string): NodeGraphNodeHandler {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`NodeGraph handler not registered: ${type}`);
    }
    return handler;
  }
}
