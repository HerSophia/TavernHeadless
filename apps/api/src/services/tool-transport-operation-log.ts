import type { PromptRuntimeToolTransportTrace } from "@tavern/core";

import type { AppDb, DbExecutor } from "../db/client.js";
import { OperationLogService } from "./operation-log-service.js";
import type { TurnCommitOperationLogContext } from "./turn-commit-service.js";
import { GOVERNANCE_OPERATION_ACTIONS } from "./governance/operation-log-names.js";
import {
  buildToolTransportGovernanceTraceSummary,
  summarizePayloadForOperationLog,
  summarizeToolTransportDiagnosticsByReason,
} from "./governance/trace-summary.js";

type AppendToolTransportOperationLogsInput = {
  accountId: string;
  workspaceId?: string | null;
  projectId?: string | null;
  sessionId: string;
  branchId: string;
  floorId: string;
  runId: string | null;
  trace?: PromptRuntimeToolTransportTrace;
  operationLog?: TurnCommitOperationLogContext;
  createdAt: number;
};

export function appendToolTransportOperationLogs(
  tx: AppDb | DbExecutor,
  input: AppendToolTransportOperationLogsInput,
): void {
  if (!input.trace) {
    return;
  }

  const service = new OperationLogService(tx);
  const targetRef = buildToolTransportTargetRef(input);
  const summary = buildToolTransportGovernanceTraceSummary({
    trace: input.trace,
    runId: input.runId,
    rootRunId: input.runId,
    accountId: input.accountId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    sessionId: input.sessionId,
    branchId: input.branchId,
    floorId: input.floorId,
    requestId: input.operationLog?.requestId,
    route: input.operationLog?.route,
    finishedAt: input.createdAt,
  });
  const diagnosticsByReason = summarizeToolTransportDiagnosticsByReason(input.trace);
  const operationGroupId = input.operationLog?.operationGroupId;
  const requestId = input.operationLog?.requestId;
  const route = input.operationLog?.route;

  if (shouldLogToolTransportSelection(input.trace)) {
    service.append({
      accountId: input.accountId,
      actorType: "system",
      actorId: "tool_transport",
      operationGroupId,
      requestId,
      sourceType: "tool_transport",
      action: input.trace.selection.reasonCode === "instance_not_supports_function_call"
        ? GOVERNANCE_OPERATION_ACTIONS.toolTransport.fallback
        : GOVERNANCE_OPERATION_ACTIONS.toolTransport.selection,
      status: "succeeded",
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      actorAccountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runId: input.runId,
      targetType: "tool_transport",
      targetId: input.trace.selection.transport,
      afterRef: targetRef,
      metadata: {
        route,
        trace_summary: summary,
        selection: {
          transport: input.trace.selection.transport,
          reason_code: input.trace.selection.reasonCode,
        },
        tool_list: input.trace.toolList
          ? {
              injected: input.trace.toolList.injected,
              tool_count: input.trace.toolList.toolCount,
              token_count: input.trace.toolList.tokenCount ?? null,
              budget_group: input.trace.toolList.budgetGroup ?? null,
            }
          : null,
      },
      createdAt: input.createdAt,
    });
  }

  if (input.trace.toolResult?.writtenBack) {
    service.append({
      accountId: input.accountId,
      actorType: "system",
      actorId: "tool_transport",
      operationGroupId,
      requestId,
      sourceType: "tool_transport",
      action: GOVERNANCE_OPERATION_ACTIONS.toolTransport.toolResultWriteback,
      status: "succeeded",
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      actorAccountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runId: input.runId,
      targetType: "tool_result_prompt",
      targetId: input.floorId,
      afterRef: {
        floor_id: input.floorId,
        run_id: input.runId,
        block_count: input.trace.toolResult.blockCount,
        token_count: input.trace.toolResult.tokenCount,
        budget_group: input.trace.toolResult.budgetGroup,
      },
      metadata: {
        route,
        trace_summary: summary,
        payload_summary: summarizePayloadForOperationLog({
          block_count: input.trace.toolResult.blockCount,
          token_count: input.trace.toolResult.tokenCount,
          budget_group: input.trace.toolResult.budgetGroup,
        }),
      },
      createdAt: input.createdAt,
    });
  }

  if (input.trace.parsing && input.trace.parsing.rejectedCount > 0) {
    service.append({
      accountId: input.accountId,
      actorType: "system",
      actorId: "tool_transport",
      operationGroupId,
      requestId,
      sourceType: "tool_transport",
      action: GOVERNANCE_OPERATION_ACTIONS.toolTransport.parseFailed,
      status: "failed",
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      actorAccountId: input.accountId,
      sessionId: input.sessionId,
      branchId: input.branchId,
      floorId: input.floorId,
      runId: input.runId,
      targetType: "tool_transport_parse",
      targetId: input.floorId,
      reason: firstDiagnosticReason(input.trace),
      afterRef: {
        floor_id: input.floorId,
        run_id: input.runId,
        transport: input.trace.selection.transport,
        block_count: input.trace.parsing.blockCount,
        accepted_count: input.trace.parsing.acceptedCount,
        rejected_count: input.trace.parsing.rejectedCount,
        diagnostics_by_reason: diagnosticsByReason,
      },
      metadata: {
        route,
        trace_summary: summary,
        diagnostics_by_reason: diagnosticsByReason,
        diagnostics: input.trace.parsing.diagnostics.map((diagnostic) => ({
          call_id: diagnostic.callId,
          tool_name: diagnostic.toolName,
          reason: diagnostic.reason,
          excerpt_summary: summarizePayloadForOperationLog(diagnostic.excerpt),
        })),
      },
      createdAt: input.createdAt,
    });
  }
}

function shouldLogToolTransportSelection(trace: PromptRuntimeToolTransportTrace): boolean {
  return trace.selection.transport === "text_protocol"
    || trace.selection.transport === "none"
    || trace.selection.reasonCode !== "default_native_function_call";
}

function firstDiagnosticReason(trace: PromptRuntimeToolTransportTrace): string | null {
  return trace.parsing?.diagnostics[0]?.reason ?? null;
}

function buildToolTransportTargetRef(input: AppendToolTransportOperationLogsInput): Record<string, unknown> {
  return {
    account_id: input.accountId,
    workspace_id: input.workspaceId ?? null,
    project_id: input.projectId ?? null,
    session_id: input.sessionId,
    branch_id: input.branchId,
    floor_id: input.floorId,
    run_id: input.runId,
    transport: input.trace?.selection.transport ?? null,
    reason_code: input.trace?.selection.reasonCode ?? null,
  };
}
