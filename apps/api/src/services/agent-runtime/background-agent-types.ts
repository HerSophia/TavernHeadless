/**
 * 后台 Agent 执行的类型与上下文合同（R4 阶段一）。
 *
 * 本文件只定义类型与处理逻辑接口，不引入任何真实执行逻辑。
 * 它复用 R3 已有的 AgentLineageRef、AgentDeliveryTarget 与 AgentOutputDispatchRequest，
 * 不重复定义输出与血缘模型。
 *
 * 关键约束：
 *  - 后台 Agent 只在 project / workspace scope下执行；floor / session scope 不通过后台介质执行。
 *  - 后台 Agent 的真实写入延后到 Processor 的 commit 阶段，由 AgentOutputDispatcher 统一落库。
 *  - dry_run = true 时只产出演练结果，不产出实际写入描述。
 */
import type { AppDb } from "../../db/client.js";
import type { AgentScopeKind } from "../agent-scope-types.js";
import type { AgentRunJobPayload } from "../agent-runtime-job-definitions.js";
import type { AgentDeliveryTarget } from "./agent-medium-types.js";
import type { AgentLineageRef } from "./agent-lineage-types.js";
import type { AgentOutputDispatchRequest } from "./agent-output-dispatcher.js";

/**
 * 入队时已固化的 effective 配置结构。
 *
 * 直接复用 agent.run job payload 中的 resolvedConfig，避免版本漂移。
 */
export type BackgroundAgentResolvedConfig = AgentRunJobPayload["resolvedConfig"];

/**
 * 后台 Agent 执行上下文。
 *
 * 由 Processor 的 prepare 阶段构造，承载执行所需的全部只读信息。
 * 其中 db 仅用于在 project / workspace scope 下只读地读取快照数据，
 * 后台 Agent 不通过 db 直接写持久输出。
 */
export interface BackgroundAgentExecutionContext {
  db: AppDb;
  accountId: string;
  workspaceId: string;
  projectId: string;
  agentTypeId: string;
  agentBindingId: string;
  scopeKind: AgentScopeKind;
  resolvedConfig: BackgroundAgentResolvedConfig;
  lineage: AgentLineageRef;
  dryRun: boolean;
  inputJson: Record<string, unknown>;
  sourceEventId: string | null;
  actorClientId: string | null;
}

export type BackgroundAgentRunStatus = "completed" | "failed" | "skipped";

/**
 * trace 草稿。
 *
 * 用于在 commit 阶段构造 AgentRuntimeMediumTrace（kind = "background_job"）。
 * runtimeJobId、status、dryRun 由 Processor 在 commit 阶段补齐。
 */
export interface BackgroundAgentTraceDraft {
  deliveryTarget: AgentDeliveryTarget;
  purpose?: string;
  lineage?: AgentLineageRef;
}

/**
 * 后台 Agent 执行结果。
 *
 * outputs 是待写输出描述数组，每项是一个 AgentOutputDispatchRequest，
 * 但延后到 commit 阶段统一执行。dry_run = true 时 outputs 必须为空。
 */
export interface BackgroundAgentResult {
  status: BackgroundAgentRunStatus;
  outputs: AgentOutputDispatchRequest[];
  traceDraft: BackgroundAgentTraceDraft;
  summary: string;
}

/**
 * 后台 Agent 处理逻辑接口。
 *
 * 按 agent type key 分发。新增后台 Agent 类型只需实现本接口，
 * 不需要再补执行底座。
 */
export interface BackgroundAgentHandler {
  agentKey: string;
  run(context: BackgroundAgentExecutionContext): Promise<BackgroundAgentResult>;
}
