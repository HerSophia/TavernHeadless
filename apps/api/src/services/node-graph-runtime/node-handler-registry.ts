import type {
  NodeGraphNode,
  NodeGraphNodeRunOutput,
  NodeGraphRunIntent,
} from "@tavern/core";

import type { AgentExecutorRouter } from "../agent-runtime/agent-executor-router.js";
import type { AgentOutputDispatcher } from "../agent-runtime/agent-output-dispatcher.js";
import type { NodeGraphRunService } from "../node-graph-run-service.js";
import type { NodeGraphRuntimeBudget } from "./budget.js";

export type NodeGraphNodeInputs = Record<string, unknown>;

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
