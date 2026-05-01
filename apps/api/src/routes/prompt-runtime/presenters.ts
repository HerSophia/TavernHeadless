import type { PromptRuntimeInspectResult } from "../../services/prompt-runtime/types.js";
import {
  mapPromptSnapshotToSnakeCase,
  mapPromptRuntimeMemoryTraceToSnakeCase,
  mapRuntimeTraceToSnakeCase,
} from "../chat/presenters.js";

function toSnakeCaseName(value: string): string {
  return value.replace(/[A-Z]/g, (segment) => `_${segment.toLowerCase()}`);
}

function mapUnknownKeysToSnakeCase(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => mapUnknownKeysToSnakeCase(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      toSnakeCaseName(key),
      mapUnknownKeysToSnakeCase(item),
    ]),
  );
}

function mapScopeToSnakeCase(scope: PromptRuntimeInspectResult["scope"]): Record<string, unknown> {
  return {
    session_id: scope.sessionId,
    target_branch_id: scope.targetBranchId,
    branch_exists: scope.branchExists,
    source_floor_id: scope.sourceFloorId ?? null,
    history_source_branch_id: scope.historySourceBranchId,
    history_source_mode: scope.historySourceMode,
  };
}

function mapDiagnosticToSnakeCase(diagnostic: PromptRuntimeInspectResult["diagnostics"][number]): Record<string, unknown> {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    severity: diagnostic.severity,
    ...(diagnostic.source ? { source: diagnostic.source } : {}),
    ...(diagnostic.fieldPath ? { field_path: diagnostic.fieldPath } : {}),
    ...(diagnostic.phase ? { phase: diagnostic.phase } : {}),
  };
}

function mapSectionStatToSnakeCase(stat: PromptRuntimeInspectResult["sectionStats"][number]): Record<string, unknown> {
  return {
    section_name: stat.sectionName,
    token_count: stat.tokenCount,
  };
}

function mapTrimReasonToSnakeCase(reason: PromptRuntimeInspectResult["trimReasons"][number]): Record<string, unknown> {
  return {
    group: reason.group,
    reason: reason.reason,
    ...(reason.detail ? { detail: reason.detail } : {}),
    ...(reason.prunedTokenCount !== undefined ? { pruned_token_count: reason.prunedTokenCount } : {}),
  };
}

function mapExcludedSourceToSnakeCase(source: PromptRuntimeInspectResult["excludedSources"][number]): Record<string, unknown> {
  return {
    source: source.source,
    reason: source.reason,
    ...(source.detail ? { detail: source.detail } : {}),
  };
}

function mapPreparedTurnToSnakeCase(result: PromptRuntimeInspectResult["preparedTurn"]): Record<string, unknown> {
  return {
    messages: result.messages,
    token_estimate: result.tokenEstimate,
    available_for_reply: result.availableForReply,
    preprocessed_user_message: result.preprocessedUserMessage ?? null,
    prompt_snapshot: result.promptSnapshot ? mapPromptSnapshotToSnakeCase(result.promptSnapshot) : null,
    runtime_trace: result.runtimeTrace ? mapRuntimeTraceToSnakeCase(result.runtimeTrace) : null,
    memory_summary: result.memorySummary ?? null,
    ...(result.runtimeTrace?.memory ? { memory: mapPromptRuntimeMemoryTraceToSnakeCase(result.runtimeTrace.memory) } : {}),
    generation_params: mapUnknownKeysToSnakeCase(result.generationParams),
    requested_turn_config: result.requestedTurnConfig ? mapUnknownKeysToSnakeCase(result.requestedTurnConfig) : null,
    turn_config: result.turnConfig ? mapUnknownKeysToSnakeCase(result.turnConfig) : null,
    session_state_writes: {
      total: result.sessionStateWrites.total,
      writes: result.sessionStateWrites.writes.map((write) => ({
        namespace: write.namespace,
        slot: write.slot,
        operation: write.operation,
      })),
    },
  };
}

function mapGovernanceViewToSnakeCase(view: PromptRuntimeInspectResult["governance"]): Record<string, unknown> {
  return {
    entries: view.entries.map((entry) => ({
      source_kind: entry.sourceKind,
      declared_level: entry.declaredLevel ?? null,
      registered: entry.registered,
      effective_retention: entry.effectiveRetention,
      pinned: entry.pinned,
      prunable: entry.prunable,
      budget_groups: entry.budgetGroups,
      section_names: entry.sectionNames,
      token_count: entry.tokenCount,
      retained_token_count: entry.retainedTokenCount,
      pruned_token_count: entry.prunedTokenCount,
    })),
    mismatches: view.mismatches.map((mismatch) => ({
      code: mismatch.code,
      source_kind: mismatch.sourceKind,
      declared_level: mismatch.declaredLevel ?? null,
      effective_retention: mismatch.effectiveRetention,
      budget_groups: mismatch.budgetGroups,
      message: mismatch.message,
    })),
    limitations: view.limitations,
  };
}

function mapResolvedPolicyToSnakeCase(policy: PromptRuntimeInspectResult["policy"]): Record<string, unknown> {
  return mapUnknownKeysToSnakeCase(policy) as Record<string, unknown>;
}

function mapSourceMapToSnakeCase(sourceMap: PromptRuntimeInspectResult["sourceMap"]): Record<string, unknown> {
  return mapUnknownKeysToSnakeCase(sourceMap) as Record<string, unknown>;
}

export function mapPromptRuntimeInspectResultToSnakeCase(
  result: PromptRuntimeInspectResult,
): Record<string, unknown> {
  return {
    scope: mapScopeToSnakeCase(result.scope),
    policy: mapResolvedPolicyToSnakeCase(result.policy),
    source_map: mapSourceMapToSnakeCase(result.sourceMap),
    diagnostics: result.diagnostics.map((diagnostic) => mapDiagnosticToSnakeCase(diagnostic)),
    trim_reasons: result.trimReasons.map((reason) => mapTrimReasonToSnakeCase(reason)),
    excluded_sources: result.excludedSources.map((source) => mapExcludedSourceToSnakeCase(source)),
    section_stats: result.sectionStats.map((stat) => mapSectionStatToSnakeCase(stat)),
    limitations: result.limitations,
    prepared_turn: mapPreparedTurnToSnakeCase(result.preparedTurn),
    governance: mapGovernanceViewToSnakeCase(result.governance),
  };
}
