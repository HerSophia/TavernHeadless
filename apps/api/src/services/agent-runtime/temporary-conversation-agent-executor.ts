import type {
  TemporaryConversationAppendInput,
  TemporaryConversationCreateFromProjectInput,
  TemporaryConversationCreateInput,
  TemporaryConversationExportInput,
  TemporaryConversationExportResult,
  TemporaryConversationHandle,
  TemporaryConversationRespondInput,
  TemporaryConversationResult,
} from "../temporary-conversation-types.js";
import type { AgentRuntimeMediumTrace, InlineAgentSpec } from "./inline-agent-types.js";
import type {
  AgentDeliveryTarget,
  AgentMediumPurpose,
  AgentMediumSelection,
} from "./agent-medium-types.js";
import type { AgentLineageRef } from "./agent-lineage-types.js";
import type {
  AgentOutputDispatcher,
  AgentOutputDispatchResult,
} from "./agent-output-dispatcher.js";
import type {
  PromptRuntimeInjectionPlacementParams,
  PromptRuntimeInjectionPromptMode,
} from "../prompt-runtime-injection-types.js";
import type { ProjectActorInput } from "../project-access-service.js";
import type { DerivedOutputStatus } from "../derived-output-service.js";

export type TemporaryConversationAgentSource =
  | {
      kind: "session";
      sourceSessionId: string;
      sourceBranchId?: string;
    }
  | {
      kind: "project";
      projectId: string;
    };

/**
 * derived_output 投递目标参数。
 *
 * 说明：executor 是轻量编排器，不直接访问数据库。因此 `projectId`、`domain`
 * 等参数必须由调用方（例如 prompt-agent-runner）预先解析后传入。
 * 设计里「session 来源取来源 session 所属 project」的解析发生在调用方，不在这里。
 */
export interface AgentDerivedOutputDeliveryParams {
  projectId: string;
  domain: string;
  actor?: ProjectActorInput;
  value?: unknown;
  status?: DerivedOutputStatus | string | null;
  sourceSessionId?: string | null;
  sourceFloorId?: string | null;
  sourcePageId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
}

/** project_inbox 投递目标参数。projectId 与 type 由调用方解析后传入。 */
export interface AgentProjectInboxDeliveryParams {
  projectId: string;
  type: string;
  actor?: ProjectActorInput;
  title?: string | null;
  payload?: unknown;
  sourceSessionId?: string | null;
  sourceFloorId?: string | null;
  sourcePageId?: string | null;
  correlationId?: string | null;
  requestId?: string | null;
}

/**
 * prompt_runtime_injection 投递目标参数。
 *
 * 临时对话来源强制 request scope：进入主 Session 的 injection 只走 request，
 * 避免临时对话直接制造持久污染。显式声明 session/branch 会被拒绝。
 */
export interface AgentPromptRuntimeInjectionDeliveryParams {
  targetSessionId: string;
  targetBranchId?: string;
  /** 临时对话来源强制 request；显式声明 session/branch 会被拒绝。 */
  scope?: "request" | "session" | "branch";
  /** 缺省 "Agent injection"。 */
  title?: string;
  /** 缺省取本次 Agent 输出文本。 */
  content?: string;
  /** 缺省 "after_history"。 */
  placement?: string;
  placementParams?: PromptRuntimeInjectionPlacementParams;
  order?: number;
  modeScope?: PromptRuntimeInjectionPromptMode | null;
  ttlMs?: number | null;
}

/** session_state_proposal 投递目标参数。仅对 session 来源有意义。 */
export interface AgentSessionStateProposalDeliveryParams {
  /** 缺省时取 session 来源的 sourceSessionId。 */
  sessionId?: string;
  /** 缺省时取本次 Agent 输出文本。 */
  summary?: string;
  namespace?: string;
  slot?: string;
  value?: unknown;
}

export interface TemporaryConversationAgentRequest {
  accountId: string;
  spec: InlineAgentSpec;
  medium: AgentMediumSelection;
  source: TemporaryConversationAgentSource;
  title?: string | null;
  systemMessage?: string | null;
  inputMessage?: string | null;
  /** page_staged_write 必填。 */
  targetPageId?: string;
  sourceOutputPageId?: string;
  reason?: string | null;
  /** derived_output 投递目标参数。 */
  derivedOutput?: AgentDerivedOutputDeliveryParams;
  /** project_inbox 投递目标参数。 */
  projectInbox?: AgentProjectInboxDeliveryParams;
  /** session_state_proposal 投递目标参数。 */
  sessionStateProposal?: AgentSessionStateProposalDeliveryParams;
  /** prompt_runtime_injection 投递目标参数。 */
  promptRuntimeInjection?: AgentPromptRuntimeInjectionDeliveryParams;
  lineage?: AgentLineageRef;
  respond?: Omit<TemporaryConversationRespondInput, "accountId" | "conversationId" | "inputMessage" | "abortSignal">;
  abortSignal?: AbortSignal;
}

export type TemporaryConversationAgentExecutionStatus =
  | "completed"
  | "failed"
  | "cancelled";

export interface TemporaryConversationAgentExecutionResult {
  status: TemporaryConversationAgentExecutionStatus;
  conversationId: string;
medium: AgentMediumSelection;
  result?: TemporaryConversationResult;
  /** page_staged_write 导出结果。 */
  exportResult?: TemporaryConversationExportResult;
  /** derived_output / project_inbox / session_state_proposal 的统一调度结果。 */
  dispatchResult?: AgentOutputDispatchResult;
  lineage?: AgentLineageRef;
  mediumTrace: AgentRuntimeMediumTrace;
  /**
   * 审计快照：即使 retentionPolicy=delete_on_finalize 清理正文后仍需保留的最小信息（设计第 5.4 节）。
   * T3 只保证保留语义成立，把它随执行结果结构化返回；物理清理与持久化落点交给 T4。
   */
  auditSnapshot: TemporaryConversationAgentAuditSnapshot;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * 临时对话 Agent 介质的 operation log 条目类型（设计第 5.3 节）。
 *
 * 这些条目属临时对话专用分类（category 固定），不进入主叙事 operation log。
 */
export type TemporaryConversationAgentOperationLogType =
  | "conversation_created"
  | "agent_responded"
  | "output_dispatched"
  | "finalized"
  | "discarded"
  | "cancelled";

export interface TemporaryConversationAgentOperationLogEntry {
  type: TemporaryConversationAgentOperationLogType;
  /** 固定为临时对话 Agent 专用分类，明确不进入主叙事 op log。 */
  category: "temporary_conversation_agent";
  conversationId: string;
  deliveryTarget: AgentDeliveryTarget;
  at: number;
  /** output_dispatched 时记录导出结果 id（staged write id / record id / proposal id）。 */
  outputRef?: string;
  /** 可选补充说明，例如终态错误码。 */
  detail?: string;
}

/**
 * 临时对话 Agent 介质的审计快照（设计第 5.4 节最小字段集合）。
 */
export interface TemporaryConversationAgentAuditSnapshot {
  conversationId: string;
  status: TemporaryConversationAgentExecutionStatus;
  purpose: AgentMediumPurpose;
  deliveryTarget: AgentDeliveryTarget;
  retentionPolicy: NonNullable<AgentMediumSelection["retentionPolicy"]>;
  lineage?: AgentLineageRef;
  /** 导出结果 id：page_staged_write 的 staged write id，或 dispatcher 各目标的 record/proposal id。 */
  outputRef?: string;
  /** trace 摘要，便于排障时不必回读完整 transcript。 */
  traceSummary: {
    kind: AgentRuntimeMediumTrace["kind"];
    deliveryTarget: AgentDeliveryTarget;
    status: AgentRuntimeMediumTrace["status"];
    rejectionCode?: string;
  };
  operationLog: TemporaryConversationAgentOperationLogEntry[];
}

export interface TemporaryConversationAgentService {
  create(input: TemporaryConversationCreateInput): Promise<TemporaryConversationHandle>;
  createFromProject(input: TemporaryConversationCreateFromProjectInput): Promise<TemporaryConversationHandle>;
  appendMessage(input: TemporaryConversationAppendInput): Promise<unknown>;
  respond(input: TemporaryConversationRespondInput): Promise<TemporaryConversationResult>;
  exportResult(input: TemporaryConversationExportInput): Promise<TemporaryConversationExportResult>;
  finalize(input: { accountId: string; conversationId: string }): Promise<unknown>;
  discard(input: { accountId: string; conversationId: string }): Promise<unknown>;
  cancel(input: { accountId: string; conversationId: string }): Promise<unknown>;
}

interface DispatchedOutput {
  exportResult?: TemporaryConversationExportResult;
  dispatchResult?: AgentOutputDispatchResult;
}

export class TemporaryConversationAgentExecutor {
  /**
   * @param temporaryConversationService 临时对话服务，承载创建、追加、respond、导出与生命周期。
   * @param outputDispatcher 可选的统一输出调度器。R3 新增的持久目标
   *   （derived_output / project_inbox / session_state_proposal）必须注入它才能使用；
   *   return_inline 与 page_staged_write 不依赖它。
   */
  constructor(
    private readonly temporaryConversationService: TemporaryConversationAgentService,
    private readonly outputDispatcher?:AgentOutputDispatcher,
  ) {}

  async execute(
    request: TemporaryConversationAgentRequest,
  ): Promise<TemporaryConversationAgentExecutionResult> {
    // 在创建临时对话与调用 LLM 之前先校验投递目标与来源/目标匹配。
    // 这里用明确抛错守住边界，避免对未支持目标先建容器再失败，或静默通过误导调用方。
    this.assertDeliveryRequestSupported(request);

    // operation log 在执行过程中累积。它属临时对话 Agent 专用分类，不进入主叙事 op log。
    const operationLog: TemporaryConversationAgentOperationLogEntry[] = [];

    const handle = await this.createConversation(request);
    operationLog.push(this.buildOperationLogEntry("conversation_created", handle.conversationId, request));

    try {
      if (request.systemMessage) {
        await this.temporaryConversationService.appendMessage({
          accountId: request.accountId,
          conversationId: handle.conversationId,
          role: "system",
          content: request.systemMessage,
        });
      }

      const result = await this.temporaryConversationService.respond({
        accountId: request.accountId,
        conversationId: handle.conversationId,
        inputMessage: request.inputMessage
          ? { role: "user", content: request.inputMessage }
          : undefined,
        abortSignal: request.abortSignal,
        ...request.respond,
      });
      operationLog.push(this.buildOperationLogEntry("agent_responded", handle.conversationId, request));

      const dispatched = await this.dispatchOutput(request, handle.conversationId, result);
      const outputRef = resolveOutputRef(dispatched);
      if (request.medium.deliveryTarget !== "return_inline") {
        operationLog.push(
          this.buildOperationLogEntry("output_dispatched", handle.conversationId, request, { outputRef }),
        );
      }

      await this.temporaryConversationService.finalize({
        accountId: request.accountId,
        conversationId: handle.conversationId,
      });
      operationLog.push(this.buildOperationLogEntry("finalized", handle.conversationId, request));

      const mediumTrace = this.buildMediumTrace(request, handle.conversationId, "completed");
      return {
        status: "completed",
        conversationId: handle.conversationId,
        medium: request.medium,
        result,
        exportResult: dispatched.exportResult,
        dispatchResult: dispatched.dispatchResult,
        lineage: request.lineage,
        mediumTrace,
        auditSnapshot: this.buildAuditSnapshot(request, handle.conversationId, "completed", mediumTrace, operationLog, outputRef),
      };
    } catch (error) {
      if (request.abortSignal?.aborted) {
        await this.temporaryConversationService.cancel({
          accountId: request.accountId,
          conversationId: handle.conversationId,
        });
        const errorMessage = error instanceof Error ? error.message : String(error);
        operationLog.push(
          this.buildOperationLogEntry("cancelled", handle.conversationId, request, { detail: "temporary_conversation_agent_cancelled" }),
        );
        const mediumTrace = this.buildMediumTrace(request, handle.conversationId, "cancelled", "temporary_conversation_agent_cancelled");
        return {
          status: "cancelled",
          conversationId: handle.conversationId,
          medium: request.medium,
          lineage: request.lineage,
          mediumTrace,
          auditSnapshot: this.buildAuditSnapshot(request, handle.conversationId, "cancelled", mediumTrace, operationLog),
          errorCode: "temporary_conversation_agent_cancelled",
          errorMessage,
        };
      }

      await this.temporaryConversationService.discard({
        accountId: request.accountId,
        conversationId: handle.conversationId,
      });
      const errorCode = resolveErrorCode(error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      operationLog.push(
        this.buildOperationLogEntry("discarded", handle.conversationId, request, { detail: errorCode }),
      );
      const mediumTrace = this.buildMediumTrace(request, handle.conversationId, "failed", errorCode);
      return {
        status: "failed",
        conversationId: handle.conversationId,
        medium: request.medium,
        lineage: request.lineage,
        mediumTrace,
        auditSnapshot: this.buildAuditSnapshot(request, handle.conversationId, "failed", mediumTrace, operationLog),
        errorCode,
        errorMessage,
      };
    }
  }

  /**
   * 构造一条临时对话 Agent operation log 条目。category 固定为专用分类，不进主叙事 op log。
   */
  private buildOperationLogEntry(
    type: TemporaryConversationAgentOperationLogType,
    conversationId: string,
    request: TemporaryConversationAgentRequest,
 extra?: { outputRef?: string; detail?: string },
  ): TemporaryConversationAgentOperationLogEntry {
    return {
      type,
      category: "temporary_conversation_agent",
      conversationId,
      deliveryTarget: request.medium.deliveryTarget,
      at: Date.now(),
      ...(extra?.outputRef ? { outputRef: extra.outputRef } : {}),
      ...(extra?.detail ? { detail: extra.detail } : {}),
    };
  }

  /**
   * 构造审计快照。即使 delete_on_finalize 清理正文，这些最小字段也应保留（设计第 5.4 节）。
   */
  private buildAuditSnapshot(
    request: TemporaryConversationAgentRequest,
    conversationId: string,
    status: TemporaryConversationAgentExecutionStatus,
    mediumTrace: AgentRuntimeMediumTrace,
    operationLog: TemporaryConversationAgentOperationLogEntry[],
    outputRef?: string,
  ): TemporaryConversationAgentAuditSnapshot {
    return {
      conversationId,
      status,
      purpose: request.medium.purpose ?? "agent_private",
      deliveryTarget: request.medium.deliveryTarget,
      retentionPolicy: request.medium.retentionPolicy ?? "delete_on_finalize",
      ...(request.lineage ? { lineage: request.lineage } : {}),
      ...(outputRef ? { outputRef } : {}),
      traceSummary: {
        kind: mediumTrace.kind,
        deliveryTarget: request.medium.deliveryTarget,
        status: mediumTrace.status,
        ...(mediumTrace.rejectionCode ? { rejectionCode: mediumTrace.rejectionCode } : {}),
      },
      operationLog,
    };
  }


  private buildMediumTrace(
    request: TemporaryConversationAgentRequest,
    conversationId: string,
    status: AgentRuntimeMediumTrace["status"],
    rejectionCode?: string,
  ): AgentRuntimeMediumTrace {
    return {
      kind: request.medium.kind,
      deliveryTarget: request.medium.deliveryTarget,
      status,
      conversationId,
      ...(request.medium.purpose ? { purpose: request.medium.purpose } : {}),
      ...(rejectionCode ? { rejectionCode } : {}),
      ...(request.lineage ? { lineage: request.lineage } : {}),
    };
  }

  private createConversation(request: TemporaryConversationAgentRequest): Promise<TemporaryConversationHandle> {
    const common = {
      accountId: request.accountId,
      title: request.title ?? null,
     purpose: request.medium.purpose ?? "agent_private",
      retentionPolicy: request.medium.retentionPolicy ?? "delete_on_finalize",
      visibility: request.medium.visibility ?? "internal",
      agentOrigin: request.lineage ?? null,
    } as const;

    if (request.source.kind === "session") {
      return this.temporaryConversationService.create({
        ...common,
        sourceSessionId: request.source.sourceSessionId,
        sourceBranchId: request.source.sourceBranchId,
      });
    }

    return this.temporaryConversationService.createFromProject({
      ...common,
      projectId: request.source.projectId,
    });
  }

  /**
   * 按 deliveryTarget 把Agent 输出送往目标。
   *
   * - return_inline：不落库，直接返回（不进入此处导出分支）。
   * - page_staged_write：复用临时对话服务的候选写入语义（T2 已开放的安全目标），直连 service.exportResult。
   * - derived_output / project_inbox / session_state_proposal：委托注入的 AgentOutputDispatcher，
   *   由它执行 AgentPermissionPolicy 校验并路由到对应 service sink。
   */
  private async dispatchOutput(
    request: TemporaryConversationAgentRequest,
    conversationId: string,
result: TemporaryConversationResult,
  ): Promise<DispatchedOutput> {
    const target = request.medium.deliveryTarget;

    switch (target) {
      case"return_inline":
        return {};

      case "page_staged_write": {
        const exportResult = await this.temporaryConversationService.exportResult({
          accountId: request.accountId,
          conversationId,
      target: "page_staged_write",
          targetPageId: request.targetPageId!,
          sourceOutputPageId: request.sourceOutputPageId ?? result.pageId,
          reason: request.reason,
        });
        return { exportResult };
      }

      case "derived_output": {
        const dispatcher= this.requireDispatcher(target);
        const params = request.derivedOutput!;
        const dispatchResult = await dispatcher.dispatch({
       target: "derived_output",
          actorAccountId: request.accountId,
     actor: params.actor,
          projectId: params.projectId,
          domain: params.domain,
          value: params.value ?? { text: result.text},
          status: params.status ?? null,
          sourceSessionId: params.sourceSessionId ?? null,
          sourceFloorId: params.sourceFloorId ?? null,
        sourcePageId: params.sourcePageId ?? null,
          correlationId: params.correlationId ?? null,
          requestId: params.requestId ?? null,
          lineage: request.lineage,
        });
        return { dispatchResult };
      }

      case "project_inbox": {
        const dispatcher = this.requireDispatcher(target);
        const params = request.projectInbox!;
        const dispatchResult = await dispatcher.dispatch({
          target: "project_inbox",
          actorAccountId: request.accountId,
          actor: params.actor,
          projectId: params.projectId,
          type: params.type,
          title: params.title ?? null,
          payload: params.payload ?? { text: result.text },
          sourceSessionId: params.sourceSessionId ?? null,
   sourceFloorId: params.sourceFloorId ?? null,
  sourcePageId: params.sourcePageId ?? null,
          correlationId: params.correlationId ?? null,
          requestId: params.requestId ?? null,
          lineage: request.lineage,
        });
        return { dispatchResult };
      }

      case "session_state_proposal":{
        const dispatcher = this.requireDispatcher(target);
        const params = request.sessionStateProposal ?? {};
        const sessionId =
          params.sessionId ??
          (request.source.kind === "session" ? request.source.sourceSessionId : undefined);
        if (!sessionId) {
          throw Object.assign(
            new Error("session_state_proposal requires a session source oran explicit sessionId."),
            { code: "temporary_conversation_delivery_source_invalid" },
          );
        }
        const dispatchResult = await dispatcher.dispatch({
    target: "session_state_proposal",
          accountId: request.accountId,
          sessionId,
          summary: params.summary ?? result.text,
          namespace: params.namespace,
          slot: params.slot,
          value: params.value,
          lineage: request.lineage,
        });
        return { dispatchResult };
      }

      case "prompt_runtime_injection": {
        const dispatcher = this.requireDispatcher(target);
        const params =request.promptRuntimeInjection!;
        const dispatchResult = await dispatcher.dispatch({
          target: "prompt_runtime_injection",
          accountId: request.accountId,
          targetSessionId: params.targetSessionId,
          ...(params.targetBranchId ? { targetBranchId: params.targetBranchId } : {}),
          // 临时对话来源强制 request scope，避免直接制造持久污染。
          scope: "request",
          sourceMediumKind: request.medium.kind,
          injection: {
            sourceKind: "agent_injection",
            title: params.title ?? "Agent injection",
            content: params.content ?? result.text,
            placement: params.placement ?? "after_history",
            ...(params.placementParams ? { placementParams: params.placementParams } : {}),
            ...(params.order !== undefined ? { order: params.order } : {}),
            ...(params.modeScope !== undefined ? { modeScope: params.modeScope } : {}),
            ...(params.ttlMs !== undefined ? { ttlMs: params.ttlMs } : {}),
          },
          ...(request.lineage ? { lineage: request.lineage } : {}),
        });
        return { dispatchResult };
      }

      default:
        return {};
    }
  }

  private assertDeliveryRequestSupported(request: TemporaryConversationAgentRequest): void {
    const target = request.medium.deliveryTarget;

    switch (target) {
      case "return_inline":
        return;

      case "page_staged_write": {
        if (!request.targetPageId) {
          throw Object.assign(
            new Error("targetPageId is required for page_staged_write delivery target."),
            { code: "temporary_conversation_target_page_required" },
          );
        }
        return;
      }

      case "derived_output": {
        this.requireDispatcher(target);
        const params = request.derivedOutput;
        if (!params?.projectId) {
          throw deliveryParamsInvalid("derived_output requires derivedOutput.projectId.");
      }
        if (!params.domain) {
          throw deliveryParamsInvalid("derived_output requires derivedOutput.domain.");
        }
        return;
 }

      case "project_inbox": {
        this.requireDispatcher(target);
        const params = request.projectInbox;
        if (!params?.projectId) {
          throw deliveryParamsInvalid("project_inbox requires projectInbox.projectId.");
        }
        if (!params.type) {
          throw deliveryParamsInvalid("project_inbox requires projectInbox.type.");
        }
        return;
      }

      case "session_state_proposal": {
        this.requireDispatcher(target);
        const sessionId =
          request.sessionStateProposal?.sessionId ??
          (request.source.kind === "session" ? request.source.sourceSessionId : undefined);
        if (!sessionId) {
          throw Object.assign(
            new Error("session_state_proposal requires a session source or an explicit sessionId."),
           { code: "temporary_conversation_delivery_source_invalid" },
          );
        }
        return;
      }

      case "prompt_runtime_injection": {
        this.requireDispatcher(target);
        const params = request.promptRuntimeInjection;
        if (!params?.targetSessionId) {
          throw deliveryParamsInvalid(
            "prompt_runtime_injection requires promptRuntimeInjection.targetSessionId.",
          );
        }
        // 临时对话来源强制 request scope；显式声明持久作用域直接拒绝。
        if (params.scope === "session" || params.scope === "branch") {
          throw Object.assign(
            new Error(
              "Temporary conversation sourced prompt_runtime_injection must use request scope.",
            ),
            { code: "temporary_conversation_injection_persist_not_allowed" },
          );
        }
        return;
      }

      case "client_data":
      case "plugin_data":
        throw Object.assign(
          new Error(
            `Output target '${target}' keeps a contract slotin R3 but is not activated yet.`,
          ),
          { code: "agent_output_target_not_activated" },
        );

      default:
        throw Object.assign(
          new Error(`Delivery target '${target}' is not supported by TemporaryConversationAgentExecutor.`),
          { code: "temporary_conversation_delivery_target_not_supported" },
        );
    }
  }

  private requireDispatcher(target: string): AgentOutputDispatcher {
    if (!this.outputDispatcher) {
      throw Object.assign(
        new Error(
          `Delivery target '${target}' requires an AgentOutputDispatcher to be configured.`,
        ),
        { code: "temporary_conversation_delivery_target_not_supported" },
      );
    }
    return this.outputDispatcher;
  }
}

function deliveryParamsInvalid(message: string): Error {
  return Object.assign(new Error(message), {
    code: "temporary_conversation_delivery_params_invalid",
  });
}

function resolveErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "temporary_conversation_agent_failed";
}

/**
 * 从调度结果提取导出结果 id，用于审计快照与 operation log。
 *
 * - page_staged_write：stagedWriteId。
 * - derived_output / project_inbox：record.id。
 * - session_state_proposal：proposalId。
 * - return_inline 不落库，返回 undefined。
 */
function resolveOutputRef(dispatched: DispatchedOutput):string | undefined {
  if (dispatched.exportResult) {
    return dispatched.exportResult.stagedWriteId ?? undefined;
  }
  const dispatchResult = dispatched.dispatchResult;
  if (!dispatchResult) {
    return undefined;
  }
  switch (dispatchResult.target) {
    case "page_staged_write":
      return dispatchResult.export.stagedWriteId ?? undefined;
    case "derived_output":
      return dispatchResult.record.id;
    case "project_inbox":
      return dispatchResult.record.id;
    case "session_state_proposal":
      return dispatchResult.proposalId;
    case "prompt_runtime_injection":
      return dispatchResult.scope === "request" ? undefined : dispatchResult.injectionId;
    default:
      return undefined;
  }
}

