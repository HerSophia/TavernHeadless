/**
 * AgentOutputDispatcher：R3 阶段四的统一输出调度层。
 *
 * 职责：
 *  - 把 Agent 运行结果按 deliveryTarget路由到正确去向。
 *  - 对持久输出目标执行 AgentPermissionPolicy 校验。
 *  - `return_inline` 是调用返回方式，不进入持久目标校验，也不落库。
 *  - `client_data` / `plugin_data` 在 R3 只保留合同位置，调度时明确拒绝。
 *
 * 设计取向：调度器本身不直接操作数据库，而是委托已有服务（DerivedOutputService、
 * ProjectInboxService、TemporaryConversationService.exportResult）与一个可注入的
 * session_state_proposal sink。这样既能打通目标，又不把项目级权限与状态写入逻辑搬进 agent-runtime。
 */
import {
  assertAllowedOutputTargets,
  type AgentAllowedOutputTarget,
} from "../agent-permission-policy.js";
import type { ProjectActorInput } from "../project-access-service.js";
import type {
  CreateDerivedOutputInput,
  DerivedOutputRecord,
  DerivedOutputStatus,
} from "../derived-output-service.js";
import type {
  CreateInboxItemInput,
  ProjectInboxItemRecord,
} from "../project-inbox-service.js";
import type {
  TemporaryConversationExportInput,
  TemporaryConversationExportResult,
} from "../temporary-conversation-types.js";
import type { AgentLineageRef } from "./agent-lineage-types.js";
import type { AgentMediumKind } from "./agent-medium-types.js";
import type {
  PromptRuntimeInjectionPlacementParams,
  PromptRuntimeInjectionPromptMode,
} from "../prompt-runtime-injection-types.js";
import type { PromptRuntimeInjectionWriteInput } from "../prompt-runtime/injection-service.js";

/** page_staged_write 委托面，与 TemporaryConversationService.exportResult 结构一致。 */
export interface PageStagedWriteSink {
  exportResult(input: TemporaryConversationExportInput): Promise<TemporaryConversationExportResult>;
}

/** derived_output 委托面，与 DerivedOutputService.create 结构一致。 */
export interface DerivedOutputSink {
  create(input: CreateDerivedOutputInput): DerivedOutputRecord;
}

/** project_inbox 委托面，与 ProjectInboxService.create 结构一致。 */
export interface ProjectInboxSink {
  create(input: CreateInboxItemInput): ProjectInboxItemRecord;
}

export interface SessionStateProposalDraft {
  accountId: string;
  sessionId: string;
  summary: string;
  namespace?: string;
  slot?: string;
  value?: unknown;
  lineage?: AgentLineageRef;
}

/**
 * session_state_proposal 委托面。
 *
 * R3 只承认它是内部 proposal 合同，不直写 session_state live head。
 * 真实 staging 由调用方注入的 sink 决定，本调度器不绑定具体表。
 */
export interface SessionStateProposalSink {
  stage(input: SessionStateProposalDraft): Promise<{ proposalId: string }> | {proposalId: string };
}

/**
 * prompt_runtime_injection 持久写入委托面。
 *
 * 仅用于显式 session / branch 作用域的 agent_injection 落库，
 * 与 PromptRuntimeInjectionService 的 create*Injection 子集一致。调度器本身不直连表。
 */
export interface PromptRuntimeInjectionPersistSink {
createSessionInjection(
    sessionId: string,
    accountId: string,
    input: PromptRuntimeInjectionWriteInput,
    createdBy?: string | null,
  ): { id: string };
  createBranchInjection(
    sessionId: string,
    branchId: string,
    accountId: string,
    input: PromptRuntimeInjectionWriteInput,
    createdBy?: string | null,
  ): { id: string };
}

/**
 * Agent 产出的 prompt_runtime_injection 描述。
 *
 * request scope 不落库，由调用方在目标会话下一次 respond 注入；
 * 来源链经 lineage 与 agentTypeId / agentRunId 标注，便于 trace 审计。
 */
export interface AgentPromptRuntimeInjectionDescriptor {
  sourceKind: "agent_injection";
 targetSessionId: string;
  targetBranchId?: string;
  title: string;
  content: string;
  placement: string;
  placementParams?: PromptRuntimeInjectionPlacementParams;
  order?: number;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number | null;
  agentTypeId?: string;
  agentRunId?: string;
  lineage?: AgentLineageRef;
}

export type AgentOutputDispatchRequest =
  | {
      target: "return_inline";
      payload: { text: string; value?: unknown };
    }
  | {
      target: "page_staged_write";
      accountId: string;
      conversationId: string;
      targetPageId: string;
      sourceOutputPageId?: string;
      reason?: string | null;
    }
  | {
      target: "derived_output";
      actorAccountId: string;
      actor?: ProjectActorInput;
      projectId: string;
      domain: string;
      value?: unknown;
      status?: DerivedOutputStatus | string | null;
      sourceSessionId?: string | null;
      sourceFloorId?: string | null;
      sourcePageId?: string | null;
      correlationId?:string | null;
      requestId?: string | null;
      lineage?: AgentLineageRef;
    }
  | {
      target: "project_inbox";
      actorAccountId: string;
      actor?: ProjectActorInput;
      projectId: string;
      type: string;
      title?: string | null;
      payload?: unknown;
      sourceSessionId?: string | null;
      sourceFloorId?: string | null;
      sourcePageId?: string | null;
      correlationId?: string | null;
      requestId?: string | null;
      lineage?: AgentLineageRef;
   }
  | {
      target: "session_state_proposal";
      accountId: string;
      sessionId: string;
      summary: string;
      namespace?: string;
      slot?: string;
      value?: unknown;
      lineage?: AgentLineageRef;
    }
  | {
      target: "prompt_runtime_injection";
   accountId: string;
      targetSessionId: string;
      targetBranchId?: string;
      scope?: "request" | "session" | "branch";
      sourceMediumKind?: AgentMediumKind;
      injection: {
        sourceKind: "agent_injection";
        title: string;
        content: string;
        placement: string;
        placementParams?: PromptRuntimeInjectionPlacementParams;
        order?: number;
        modeScope?: PromptRuntimeInjectionPromptMode | null;
        ttlMs?: number | null;
      };
      agentTypeId?: string;
      agentRunId?: string;
      lineage?: AgentLineageRef;
    }
  | {
      target: "client_data" | "plugin_data";
    };

export type AgentOutputDispatchResult =
  | { target: "return_inline"; inline: { text: string; value?: unknown } }
  | { target: "page_staged_write"; export: TemporaryConversationExportResult }
  | { target: "derived_output"; record: DerivedOutputRecord }
  | { target: "project_inbox"; record: ProjectInboxItemRecord }
  | { target: "session_state_proposal"; proposalId: string }
  | {
      target: "prompt_runtime_injection";
      scope: "request";
      injection: AgentPromptRuntimeInjectionDescriptor;
    }
  | {
      target: "prompt_runtime_injection";
      scope: "session" | "branch";
      injectionId: string;
      injection: AgentPromptRuntimeInjectionDescriptor;
    };

export interface AgentOutputDispatcherDeps {
  pageStagedWrite?: PageStagedWriteSink;
  derivedOutput?: DerivedOutputSink;
  projectInbox?: ProjectInboxSink;
  sessionStateProposal?: SessionStateProposalSink;
  promptRuntimeInjection?: PromptRuntimeInjectionPersistSink;
}

export class AgentOutputDispatchError extends Error {
  constructor(
    public readonly code:
      | "agent_output_target_not_activated"
      | "agent_output_sink_not_configured"
      | "agent_output_target_sync_unsupported"
      | "agent_injection_source_kind_invalid"
      | "agent_injection_persist_scope_invalid"
      | "temporary_conversation_injection_persist_not_allowed",
    message: string,
  ) {
    super(message);
    this.name = "AgentOutputDispatchError";
  }
}

export class AgentOutputDispatcher {
 constructor(private readonly deps: AgentOutputDispatcherDeps = {}) {}

  /**
   * 同步分发入口，供后台 Agent 的 Runtime Job commit 阶段在同步事务内调用。
   *
   * Background Job Runtime 的 commit 运行在 better-sqlite3 同步事务回调内，
   * 不能 await 异步 dispatch。本方法复用与 dispatch 一致的权限校验与路由，
   * 但只支持同步 sink 的持久目标：derived_output / project_inbox /
   * session_state_proposal。page_staged_write 与 prompt_runtime_injection
   * 依赖异步 / 跨会话语义，后台 commit 不走同步路径。
   */
  dispatchSync(request: AgentOutputDispatchRequest): AgentOutputDispatchResult {
    if (request.target === "return_inline") {
      return { target: "return_inline", inline: request.payload };
    }

    this.assertPersistedTargetAllowed(request.target);

    switch (request.target) {
      case "derived_output": {
        const sink = this.requireSink(this.deps.derivedOutput, "derived_output");
        const record = sink.create({
          actorAccountId: request.actorAccountId,
          actor: request.actor,
          projectId: request.projectId,
          domain: request.domain,
          value: request.value,
          status: request.status,
          sourceSessionId: request.sourceSessionId,
          sourceFloorId: request.sourceFloorId,
          sourcePageId: request.sourcePageId,
          correlationId: request.correlationId,
          requestId: request.requestId,
        });
        return { target: "derived_output", record };
      }

      case "project_inbox": {
        const sink = this.requireSink(this.deps.projectInbox, "project_inbox");
        const record = sink.create({
          actorAccountId: request.actorAccountId,
          actor: request.actor,
          projectId: request.projectId,
          type: request.type,
          title: request.title,
          payload: request.payload,
          sourceSessionId: request.sourceSessionId,
          sourceFloorId: request.sourceFloorId,
          sourcePageId: request.sourcePageId,
          correlationId: request.correlationId,
          requestId: request.requestId,
        });
        return { target: "project_inbox", record };
      }

      case "session_state_proposal": {
        const sink = this.requireSink(this.deps.sessionStateProposal, "session_state_proposal");
        const result = sink.stage({
          accountId: request.accountId,
          sessionId: request.sessionId,
          summary: request.summary,
          namespace: request.namespace,
          slot: request.slot,
          value: request.value,
          lineage: request.lineage,
        });
        if (result instanceof Promise) {
          throw new AgentOutputDispatchError(
            "agent_output_target_sync_unsupported",
            "session_state_proposal sink returned a Promise; synchronous background commit requires a synchronous sink.",
          );
        }
        return { target: "session_state_proposal", proposalId: result.proposalId };
      }

      case "page_staged_write":
      case "prompt_runtime_injection": {
        throw new AgentOutputDispatchError(
          "agent_output_target_sync_unsupported",
          `Output target '${request.target}' is not supported in synchronous background dispatch.`,
        );
      }

      case "client_data":
      case "plugin_data": {
        throw new AgentOutputDispatchError(
          "agent_output_target_not_activated",
          `Output target '${request.target}' keeps a contract slotbut is not activated yet.`,
        );
      }
    }
  }

  async dispatch(request: AgentOutputDispatchRequest): Promise<AgentOutputDispatchResult> {
    if (request.target === "return_inline") {
      // return_inline 不是持久目标，不进入 AgentPermissionPolicy 校验，也不落库。
      return { target: "return_inline", inline: request.payload };
    }

    // 其余目标都是持久输出目标，先过权限策略：校验目标合法且不是主叙事保留目标。
    this.assertPersistedTargetAllowed(request.target);

    switch (request.target) {
      case "page_staged_write": {
        const sink = this.requireSink(this.deps.pageStagedWrite, "page_staged_write");
        const result = await sink.exportResult({
          accountId: request.accountId,
          conversationId: request.conversationId,
    target: "page_staged_write",
          targetPageId: request.targetPageId,
          sourceOutputPageId: request.sourceOutputPageId,
          reason: request.reason,
        });
        return { target: "page_staged_write", export: result };
      }

      case "derived_output": {
        const sink = this.requireSink(this.deps.derivedOutput, "derived_output");
        const record = sink.create({
          actorAccountId: request.actorAccountId,
          actor: request.actor,
          projectId: request.projectId,
          domain: request.domain,
          value: request.value,
          status: request.status,
          sourceSessionId: request.sourceSessionId,
          sourceFloorId: request.sourceFloorId,
          sourcePageId: request.sourcePageId,
          correlationId: request.correlationId,
          requestId: request.requestId,
        });
        return { target: "derived_output", record };
      }

      case "project_inbox": {
        const sink = this.requireSink(this.deps.projectInbox, "project_inbox");
        const record = sink.create({
       actorAccountId: request.actorAccountId,
          actor: request.actor,
  projectId: request.projectId,
          type: request.type,
          title: request.title,
       payload: request.payload,
          sourceSessionId: request.sourceSessionId,
          sourceFloorId: request.sourceFloorId,
          sourcePageId: request.sourcePageId,
          correlationId: request.correlationId,
          requestId: request.requestId,
        });
        return { target: "project_inbox", record };
      }

      case "session_state_proposal": {
        const sink = this.requireSink(this.deps.sessionStateProposal, "session_state_proposal");
        const result = await sink.stage({
          accountId: request.accountId,
          sessionId: request.sessionId,
       summary: request.summary,
          namespace: request.namespace,
          slot: request.slot,
          value: request.value,
          lineage: request.lineage,
       });
        return { target: "session_state_proposal", proposalId: result.proposalId };
      }

      case "prompt_runtime_injection": {
        return this.dispatchPromptRuntimeInjection(request);
      }

      case "client_data":
      case "plugin_data": {
        throw new AgentOutputDispatchError(
          "agent_output_target_not_activated",
          `Output target '${request.target}' keeps a contract slot in R3 but is not activated yet; `
            + "its real adapter is decided together with T3 / R4.",
        );
      }
    }
  }

  private async dispatchPromptRuntimeInjection(
    request: Extract<AgentOutputDispatchRequest, { target: "prompt_runtime_injection" }>,
  ): Promise<AgentOutputDispatchResult> {
    // 来源不可伪造：prompt_runtime_injection 只接受 agent_injection，不允许伪造 client/system 来源。
    if (request.injection.sourceKind !== "agent_injection") {
      throw new AgentOutputDispatchError(
        "agent_injection_source_kind_invalid",
        `prompt_runtime_injection only accepts source_kind 'agent_injection', got '${String(request.injection.sourceKind)}'.`,
      );
    }

    const descriptor: AgentPromptRuntimeInjectionDescriptor = {
      sourceKind: "agent_injection",
      targetSessionId: request.targetSessionId,
      ...(request.targetBranchId ? { targetBranchId: request.targetBranchId } : {}),
      title: request.injection.title,
    content: request.injection.content,
      placement: request.injection.placement,
      ...(request.injection.placementParams ? { placementParams: request.injection.placementParams } : {}),
      ...(request.injection.order !== undefined ? { order: request.injection.order } : {}),
      ...(request.injection.modeScope !== undefined ? { modeScope: request.injection.modeScope } : {}),
      ...(request.injection.ttlMs !== undefined ? { ttlMs: request.injection.ttlMs } : {}),
      ...(request.agentTypeId ? { agentTypeId: request.agentTypeId } : {}),
      ...(request.agentRunId ? { agentRunId: request.agentRunId } : {}),
      ...(request.lineage ? { lineage: request.lineage } : {}),
    };

    const scope = request.scope ?? "request";

    // 默认 request scope：不落库、不制造持久污染，由调用方在目标会话下一次 respond 注入。
    if (scope === "request") {
      return { target: "prompt_runtime_injection", scope: "request", injection: descriptor };
    }

    // 显式持久作用域属于持久注入：临时对话来源强制 request，禁止直接写持久注入。
    if (request.sourceMediumKind === "temporary_conversation") {
      throw new AgentOutputDispatchError(
        "temporary_conversation_injection_persist_not_allowed",
        "Temporary conversation sourced prompt_runtime_injection must stay in request scope and cannot write persistent injections.",
      );
    }

    if (scope === "branch" && !request.targetBranchId) {
      throw new AgentOutputDispatchError(
        "agent_injection_persist_scope_invalid",
        "prompt_runtime_injection branch scope requires targetBranchId.",
      );
    }

    const sink = this.requireSink(this.deps.promptRuntimeInjection, "prompt_runtime_injection");
    const writeInput: PromptRuntimeInjectionWriteInput = {
      sourceKind: "agent_injection",
      title: request.injection.title,
      content: request.injection.content,
      placement: request.injection.placement,
      ...(request.injection.order !== undefined ? { order: request.injection.order } : {}),
      ...(request.injection.modeScope !== undefined ? { modeScope: request.injection.modeScope } : {}),
      ...(request.injection.ttlMs !== undefined ? { ttlMs: request.injection.ttlMs } : {}),
    };

    const createdBy = request.agentRunId ?? null;
    const created =
      scope === "branch"
        ? sink.createBranchInjection(
            request.targetSessionId,
            request.targetBranchId!,
            request.accountId,
            writeInput,
            createdBy,
          )
        : sink.createSessionInjection(
            request.targetSessionId,
            request.accountId,
            writeInput,
            createdBy,
          );

    return {
      target: "prompt_runtime_injection",
      scope,
      injectionId: created.id,
      injection: descriptor,
    };
  }


  private assertPersistedTargetAllowed(target: AgentAllowedOutputTarget): void {
    // assertAllowedOutputTargets 会拒绝主叙事保留目标，并校验目标在允许集合内。
    assertAllowedOutputTargets([target]);
  }

  private requireSink<T>(sink: T | undefined, target: string): T {
    if (!sink) {
      throw new AgentOutputDispatchError(
        "agent_output_sink_not_configured",
        `No sink configured for agent output target '${target}'.`,
      );
    }
    return sink;
  }
}
